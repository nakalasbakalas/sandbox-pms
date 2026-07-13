import type { BookingEmailApprovePayload, BookingEmailEvent, BookingEmailParsedDetails } from '@/types/booking-email'

export type BookingEmailApprovalMode = BookingEmailApprovePayload['mode']

export interface BookingEmailDetailsForm {
  guestName: string
  guestEmail: string
  guestPhone: string
  checkIn: string
  checkOut: string
  roomType: string
  adults: string
  children: string
  childAges: string[]
  amount: string
  currency: string
  paymentStatus: string
  paymentMethod: string
  paymentReference: string
  channelRef: string
  specialRequests: string
  notes: string
}

export interface BookingEmailApplyInput {
  mode: BookingEmailApprovalMode
  form: BookingEmailDetailsForm
  reservationId?: string
  reason?: string
}

const APPROVAL_MODES: BookingEmailApprovalMode[] = ['apply_parsed', 'create_reservation', 'link_reservation']
const PAYMENT_METHOD_ALIASES: Record<string, NonNullable<BookingEmailParsedDetails['paymentMethod']>> = {
  CASH: 'CASH',
  CARD: 'CARD',
  BANK: 'BANK_TRANSFER',
  BANK_TRANSFER: 'BANK_TRANSFER',
  TRANSFER: 'BANK_TRANSFER',
  ONLINE: 'ONLINE',
  OTA: 'ONLINE',
  OTHER: 'OTHER',
}

function text(value: unknown) {
  return String(value || '').trim()
}

function numberOrUndefined(value: string, label: string, options: { integer?: boolean; min?: number; exclusiveMin?: number } = {}) {
  const normalized = text(value)
  if (!normalized) return undefined
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid number.`)
  if (options.integer && !Number.isInteger(parsed)) throw new Error(`${label} must be a whole number.`)
  if (options.exclusiveMin !== undefined && parsed <= options.exclusiveMin) throw new Error(`${label} must be greater than ${options.exclusiveMin}.`)
  if (options.min !== undefined && parsed < options.min) throw new Error(`${label} must be at least ${options.min}.`)
  return parsed
}

function normalizedDateOrUndefined(value: string, label: string) {
  const normalized = text(value)
  if (!normalized) return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error(`${label} must use YYYY-MM-DD format.`)
  const parsed = new Date(`${normalized}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`${label} must be a valid calendar date.`)
  }
  return normalized
}

function normalizedPaymentMethod(value: string): BookingEmailParsedDetails['paymentMethod'] | undefined {
  const key = text(value).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!key) return undefined
  const method = PAYMENT_METHOD_ALIASES[key]
  if (!method) throw new Error('Payment method must be one of: CASH, CARD, BANK_TRANSFER, ONLINE, OTHER.')
  return method
}

function normalizedApprovalMode(mode: BookingEmailApprovalMode): BookingEmailApprovalMode {
  if (APPROVAL_MODES.includes(mode)) return mode
  throw new Error('Booking email approval mode is not supported.')
}

export function bookingEmailDetailsForm(event: BookingEmailEvent): BookingEmailDetailsForm {
  const details = event.parsedDetails || {}
  return {
    guestName: text(details.guestName || event.guestName),
    guestEmail: text(details.guestEmail),
    guestPhone: text(details.guestPhone),
    checkIn: text(details.checkIn || event.checkIn),
    checkOut: text(details.checkOut || event.checkOut),
    roomType: text(details.roomType || event.roomType),
    adults: details.adults === undefined ? '' : String(details.adults),
    children: details.children === undefined ? '' : String(details.children),
    childAges: Array.isArray(details.childAges) ? details.childAges.map(String) : [],
    amount: details.amount === undefined && event.amount === undefined ? '' : String(details.amount ?? event.amount),
    currency: text(details.currency || event.currency),
    paymentStatus: text(details.paymentStatus || event.paymentStatus),
    paymentMethod: text(details.paymentMethod),
    paymentReference: text(details.paymentReference),
    channelRef: text(details.channelRef || event.channelRef),
    specialRequests: text(details.specialRequests),
    notes: text(details.notes),
  }
}

export function bookingEmailDefaultApprovalMode(event: Pick<BookingEmailEvent, 'eventType' | 'reservationId'>): BookingEmailApprovalMode {
  return event.eventType === 'NEW_BOOKING' && event.reservationId ? 'link_reservation' : 'apply_parsed'
}

export function bookingEmailActionRequiresReason(event: Pick<BookingEmailEvent, 'eventType'>) {
  return event.eventType === 'CANCELLATION' || event.eventType === 'MODIFICATION'
}

export function bookingEmailParsedDetailsFromForm(form: BookingEmailDetailsForm): BookingEmailParsedDetails {
  const checkIn = normalizedDateOrUndefined(form.checkIn, 'Check-in')
  const checkOut = normalizedDateOrUndefined(form.checkOut, 'Check-out')
  if (checkIn && checkOut && checkOut <= checkIn) throw new Error('Check-out must be after check-in.')

  const adults = numberOrUndefined(form.adults, 'Adults', { integer: true, min: 1 })
  const children = numberOrUndefined(form.children, 'Children', { integer: true, min: 0 })
  const childAgeInputs = Array.isArray(form.childAges) ? form.childAges.map(text) : []
  let childAges: number[] | undefined
  if (children !== undefined) {
    if (childAgeInputs.length !== children || childAgeInputs.some((value) => value === '')) {
      throw new Error('Enter one age for every child.')
    }
    childAges = childAgeInputs.map(Number)
    if (childAges.some((age) => !Number.isInteger(age) || age < 0 || age > 17)) {
      throw new Error('Child ages must be whole numbers from 0 to 17.')
    }
  } else if (childAgeInputs.some(Boolean)) {
    throw new Error('Enter the number of children before entering child ages.')
  }
  const details: BookingEmailParsedDetails = {}

  const assign = <K extends keyof BookingEmailParsedDetails>(key: K, value: BookingEmailParsedDetails[K] | undefined) => {
    if (value !== undefined && value !== '') details[key] = value
  }

  assign('guestName', text(form.guestName) || undefined)
  assign('guestEmail', text(form.guestEmail) || undefined)
  assign('guestPhone', text(form.guestPhone) || undefined)
  assign('checkIn', checkIn)
  assign('checkOut', checkOut)
  assign('roomType', text(form.roomType) || undefined)
  assign('adults', adults)
  assign('children', children)
  assign('childAges', childAges)
  assign('paymentStatus', text(form.paymentStatus) || undefined)
  assign('paymentMethod', normalizedPaymentMethod(form.paymentMethod))
  assign('paymentReference', text(form.paymentReference) || undefined)
  assign('channelRef', text(form.channelRef) || undefined)
  assign('specialRequests', text(form.specialRequests) || undefined)
  assign('notes', text(form.notes) || undefined)

  return details
}

export function buildBookingEmailApprovePayload(input: BookingEmailApplyInput): BookingEmailApprovePayload {
  const mode = normalizedApprovalMode(input.mode)
  const reservationId = text(input.reservationId)
  const reason = text(input.reason)
  if (mode === 'link_reservation' && !reservationId) {
    throw new Error('Reservation ID is required before linking an email event.')
  }

  return {
    mode,
    reservationId: reservationId || undefined,
    reason: reason || undefined,
    ...(mode === 'link_reservation' ? {} : { editedDetails: bookingEmailParsedDetailsFromForm(input.form) }),
  }
}
