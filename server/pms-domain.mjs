export const HOTEL_TIME_ZONE = 'Asia/Bangkok'

export const SANDBOX_RULES = {
  propertyCode: 'SANDBOX',
  propertyName: 'SANDBOX HOTEL',
  checkInTime: '14:00',
  checkOutTime: '12:00',
  standardOccupancy: 2,
  maxOccupancy: 4,
  extraGuestFeePerNight: 300,
  childSharingFeePerNight: 300,
  childFreeMaxAge: 5,
  childSharingMaxAge: 11,
}

const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: HOTEL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export class PmsValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message)
    this.name = 'PmsValidationError'
    this.statusCode = statusCode
  }
}

export function getBangkokDateKey(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new PmsValidationError('Enter a valid date.')
  }

  const parts = DATE_FORMATTER.formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return `${year}-${month}-${day}`
}

export function dateFromKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    throw new PmsValidationError('Enter dates in YYYY-MM-DD format.')
  }
  return new Date(`${key}T00:00:00.000Z`)
}

function dayNumber(value) {
  const [year, month, day] = getBangkokDateKey(value).split('-').map(Number)
  return Date.UTC(year, month - 1, day) / 86_400_000
}

export function nightsBetween(checkIn, checkOut) {
  return Math.max(0, dayNumber(checkOut) - dayNumber(checkIn))
}

export function stayDates(checkIn, checkOut) {
  const start = dayNumber(checkIn)
  const end = dayNumber(checkOut)
  if (end <= start) return []

  return Array.from({ length: end - start }, (_, index) => {
    const date = new Date((start + index) * 86_400_000)
    return date.toISOString().slice(0, 10)
  })
}

export function reservationsOverlap(firstCheckIn, firstCheckOut, secondCheckIn, secondCheckOut) {
  const firstStart = dayNumber(firstCheckIn)
  const firstEnd = dayNumber(firstCheckOut)
  const secondStart = dayNumber(secondCheckIn)
  const secondEnd = dayNumber(secondCheckOut)
  if (firstEnd <= firstStart || secondEnd <= secondStart) return false
  return firstStart < secondEnd && firstEnd > secondStart
}

export function isSellableRoomNumber(roomNumber) {
  return String(roomNumber || '').trim().length > 0
}

export function validateStayInput(input) {
  const checkInKey = getBangkokDateKey(input.checkIn)
  const checkOutKey = getBangkokDateKey(input.checkOut)
  const nights = nightsBetween(checkInKey, checkOutKey)
  if (nights <= 0) {
    throw new PmsValidationError('Check-out date must be after check-in date.')
  }
  return { checkInKey, checkOutKey, nights, dates: stayDates(checkInKey, checkOutKey) }
}

export function calculateStayPricing(input) {
  const { nights } = validateStayInput(input)
  const adults = Number(input.adults)
  const childAges = Array.isArray(input.childAges) ? input.childAges.map(Number) : []
  const ratePerNight = Number(input.ratePerNight)
  const standardOccupancy = Number(input.standardOccupancy ?? SANDBOX_RULES.standardOccupancy)
  const maxOccupancy = Number(input.maxOccupancy ?? SANDBOX_RULES.maxOccupancy)
  const extraGuestFeePerNight = Number(input.extraGuestFeePerNight ?? SANDBOX_RULES.extraGuestFeePerNight)
  const childSharingFeePerNight = Number(input.childSharingFeePerNight ?? SANDBOX_RULES.childSharingFeePerNight)

  if (!Number.isInteger(adults) || adults < 1) {
    throw new PmsValidationError('At least one adult is required.')
  }
  if (!Number.isFinite(ratePerNight) || ratePerNight <= 0) {
    throw new PmsValidationError('Rate per night must be greater than zero.')
  }
  if (!Number.isInteger(standardOccupancy) || standardOccupancy < 1) {
    throw new PmsValidationError('Standard occupancy must be at least one guest.')
  }
  if (!Number.isInteger(maxOccupancy) || maxOccupancy < standardOccupancy) {
    throw new PmsValidationError('Maximum occupancy must be at least the standard occupancy.')
  }
  if (childAges.some((age) => !Number.isInteger(age) || age < 0)) {
    throw new PmsValidationError('Child ages must be valid non-negative numbers.')
  }

  const totalGuests = adults + childAges.length
  if (totalGuests > maxOccupancy) {
    throw new PmsValidationError(`Maximum occupancy is ${maxOccupancy} guests per room.`)
  }

  const extraAdults = Math.max(0, adults - standardOccupancy)
  const chargedChildren = childAges.filter((age) =>
    age > SANDBOX_RULES.childFreeMaxAge && age <= SANDBOX_RULES.childSharingMaxAge
  ).length
  const roomSubtotal = ratePerNight * nights
  const extraGuestFee = extraAdults * extraGuestFeePerNight * nights
  const childFee = chargedChildren * childSharingFeePerNight * nights

  return {
    nights,
    roomSubtotal,
    extraGuestFee,
    childFee,
    total: roundMoney(roomSubtotal + extraGuestFee + childFee),
  }
}

export function roundMoney(amount) {
  return Math.round((Number(amount) + Number.EPSILON) * 100) / 100
}

export function normalizePaymentMethod(method) {
  const value = String(method || '').toUpperCase()
  if (value === 'CREDIT_CARD' || value === 'CARD') return 'CARD'
  if (value === 'TRANSFER' || value === 'PROMPTPAY') return 'BANK_TRANSFER'
  if (['CASH', 'BANK_TRANSFER', 'ONLINE', 'OTHER'].includes(value)) return value
  throw new PmsValidationError('Select a valid payment method.')
}

export function activeReservationStatuses() {
  return ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'HOLD']
}

export function checkedInRoomStatus(currentStatus) {
  return currentStatus === 'VACANT_DIRTY' || currentStatus === 'OCCUPIED_DIRTY'
    ? 'OCCUPIED_DIRTY'
    : 'OCCUPIED_CLEAN'
}

export function roomStatusForHousekeeping(currentStatus, cleanStatus) {
  const occupied = currentStatus === 'OCCUPIED_CLEAN' || currentStatus === 'OCCUPIED_DIRTY' || currentStatus === 'OCCUPIED'
  if (cleanStatus === 'DIRTY') return occupied ? 'OCCUPIED_DIRTY' : 'VACANT_DIRTY'
  if (cleanStatus === 'CLEANING') return 'CLEANING'
  if (cleanStatus === 'INSPECTED') return 'INSPECTED'
  return occupied ? 'OCCUPIED_CLEAN' : 'VACANT_CLEAN'
}
