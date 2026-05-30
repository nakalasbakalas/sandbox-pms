export const HOTEL_TIME_ZONE = 'Asia/Bangkok'

export const SANDBOX_HOTEL_RULES = {
  propertyName: 'SANDBOX HOTEL',
  currency: 'THB',
  taxInclusiveRates: false,
  checkInTime: '14:00',
  checkOutTime: '12:00',
  standardOccupancy: 2,
  maxOccupancy: 4,
  extraGuestFeePerNight: 300,
  childSharingFeePerNight: 300,
  childFreeMaxAge: 5,
  childSharingMaxAge: 11,
} as const

export interface PricingInput {
  checkIn: Date | string
  checkOut: Date | string
  ratePerNight: number
  adults: number
  childAges?: number[]
  standardOccupancy?: number
  maxOccupancy?: number
  extraGuestFeePerNight?: number
  childSharingFeePerNight?: number
}

export interface PricingResult {
  nights: number
  roomSubtotal: number
  extraGuestFee: number
  childFee: number
  total: number
  taxInclusive: boolean
  isValidOccupancy: boolean
  warnings: string[]
}

export interface RoomAssignmentCandidate {
  number: string
  status: string
  operationalStatus: string
  reservationId?: string
  checkIn?: Date | string
  checkOut?: Date | string
}

export interface RoomAssignmentRequest {
  checkIn: Date | string
  checkOut: Date | string
  excludeReservationId?: string
}

export interface RoomAssignmentDecision {
  assignable: boolean
  reason: 'assignable' | 'non_sellable' | 'blocked' | 'out_of_order' | 'occupied' | 'invalid_dates'
}

const DATE_KEY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: HOTEL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function getBangkokDateKey(value: Date | string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value.slice(0, 10)
  }

  const date = value instanceof Date ? value : new Date(value)
  const parts = DATE_KEY_FORMATTER.formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'

  return `${year}-${month}-${day}`
}

function toDayNumber(value: Date | string): number {
  const [year, month, day] = getBangkokDateKey(value).split('-').map(Number)
  return Date.UTC(year, month - 1, day) / 86_400_000
}

export function nightsBetween(checkIn: Date | string, checkOut: Date | string): number {
  return Math.max(0, toDayNumber(checkOut) - toDayNumber(checkIn))
}

export function reservationsOverlap(
  firstCheckIn: Date | string,
  firstCheckOut: Date | string,
  secondCheckIn: Date | string,
  secondCheckOut: Date | string,
): boolean {
  const firstStart = toDayNumber(firstCheckIn)
  const firstEnd = toDayNumber(firstCheckOut)
  const secondStart = toDayNumber(secondCheckIn)
  const secondEnd = toDayNumber(secondCheckOut)

  if (firstEnd <= firstStart || secondEnd <= secondStart) return false

  return firstStart < secondEnd && firstEnd > secondStart
}

export function calculateStayPricing(input: PricingInput): PricingResult {
  const nights = nightsBetween(input.checkIn, input.checkOut)
  const childAges = input.childAges ?? []
  const warnings: string[] = []
  const adults = Math.max(0, input.adults)
  const ratePerNight = Math.max(0, input.ratePerNight)
  const standardOccupancy = input.standardOccupancy ?? SANDBOX_HOTEL_RULES.standardOccupancy
  const maxOccupancy = input.maxOccupancy ?? SANDBOX_HOTEL_RULES.maxOccupancy
  const extraGuestFeePerNight = input.extraGuestFeePerNight ?? SANDBOX_HOTEL_RULES.extraGuestFeePerNight
  const childSharingFeePerNight = input.childSharingFeePerNight ?? SANDBOX_HOTEL_RULES.childSharingFeePerNight
  const adultExtraGuests = Math.max(0, adults - standardOccupancy)
  const chargedChildren = childAges.filter(
    (age) => age >= SANDBOX_HOTEL_RULES.childFreeMaxAge + 1 && age <= SANDBOX_HOTEL_RULES.childSharingMaxAge,
  ).length
  const totalGuests = adults + childAges.length

  if (nights === 0) {
    warnings.push('Check-out must be after check-in.')
  }

  if (input.adults < 1) {
    warnings.push('At least one adult is required.')
  }

  if (input.ratePerNight < 0) {
    warnings.push('Rate per night cannot be negative.')
  }

  if (childAges.some((age) => age < 0 || !Number.isFinite(age))) {
    warnings.push('Child ages must be valid non-negative numbers.')
  }

  if (totalGuests > maxOccupancy) {
    warnings.push(`Maximum occupancy is ${maxOccupancy} guests per room.`)
  }

  const roomSubtotal = ratePerNight * nights
  const extraGuestFee = adultExtraGuests * extraGuestFeePerNight * nights
  const childFee = chargedChildren * childSharingFeePerNight * nights

  return {
    nights,
    roomSubtotal,
    extraGuestFee,
    childFee,
    total: roomSubtotal + extraGuestFee + childFee,
    taxInclusive: SANDBOX_HOTEL_RULES.taxInclusiveRates,
    isValidOccupancy: totalGuests <= maxOccupancy,
    warnings,
  }
}

export function isSellableRoomNumber(roomNumber: string): boolean {
  return String(roomNumber || '').trim().length > 0
}

export function getRoomAssignmentDecision(
  room: RoomAssignmentCandidate,
  request: RoomAssignmentRequest,
): RoomAssignmentDecision {
  if (nightsBetween(request.checkIn, request.checkOut) === 0) {
    return { assignable: false, reason: 'invalid_dates' }
  }

  if (!isSellableRoomNumber(room.number)) {
    return { assignable: false, reason: 'non_sellable' }
  }

  if (room.operationalStatus === 'BLOCKED') {
    return { assignable: false, reason: 'blocked' }
  }

  if (room.operationalStatus === 'OUT_OF_ORDER' || room.operationalStatus === 'OUT_OF_SERVICE') {
    return { assignable: false, reason: 'out_of_order' }
  }

  if (
    room.reservationId &&
    room.reservationId !== request.excludeReservationId &&
    room.checkIn &&
    room.checkOut &&
    reservationsOverlap(request.checkIn, request.checkOut, room.checkIn, room.checkOut)
  ) {
    return { assignable: false, reason: 'occupied' }
  }

  if (room.status === 'OCCUPIED_CLEAN' || room.status === 'OCCUPIED_DIRTY') {
    return { assignable: false, reason: 'occupied' }
  }

  return { assignable: true, reason: 'assignable' }
}
