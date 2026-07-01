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

function text(value: unknown) {
  return String(value || '').trim()
}

function numberOrUndefined(value: string, label: string) {
  const normalized = text(value)
  if (!normalized) return undefined
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid number.`)
  return parsed
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
    amount: details.amount === undefined && event.amount === undefined ? '' : String(details.amount ?? event.amount),
    currency: text(details.currency || event.currency || 'THB'),
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
  return event.eventType === 'CANCELLATION'
}

export function bookingEmailParsedDetailsFromForm(form: BookingEmailDetailsForm): BookingEmailParsedDetails {
  const amount = numberOrUndefined(form.amount, 'Amount')
  const adults = numberOrUndefined(form.adults, 'Adults')
  const children = numberOrUndefined(form.children, 'Children')
  const details: BookingEmailParsedDetails = {}

  const assign = <K extends keyof BookingEmailParsedDetails>(key: K, value: BookingEmailParsedDetails[K] | undefined) => {
    if (value !== undefined && value !== '') details[key] = value
  }

  assign('guestName', text(form.guestName) || undefined)
  assign('guestEmail', text(form.guestEmail) || undefined)
  assign('guestPhone', text(form.guestPhone) || undefined)
  assign('checkIn', text(form.checkIn) || undefined)
  assign('checkOut', text(form.checkOut) || undefined)
  assign('roomType', text(form.roomType) || undefined)
  assign('adults', adults)
  assign('children', children)
  assign('amount', amount)
  assign('currency', text(form.currency) || undefined)
  assign('paymentStatus', text(form.paymentStatus) || undefined)
  assign('paymentMethod', (text(form.paymentMethod) || undefined) as BookingEmailParsedDetails['paymentMethod'] | undefined)
  assign('paymentReference', text(form.paymentReference) || undefined)
  assign('channelRef', text(form.channelRef) || undefined)
  assign('specialRequests', text(form.specialRequests) || undefined)
  assign('notes', text(form.notes) || undefined)

  return details
}

export function buildBookingEmailApprovePayload(input: BookingEmailApplyInput): BookingEmailApprovePayload {
  const reservationId = text(input.reservationId)
  const reason = text(input.reason)
  if (input.mode === 'link_reservation' && !reservationId) {
    throw new Error('Reservation ID is required before linking an email event.')
  }

  return {
    mode: input.mode,
    reservationId: reservationId || undefined,
    reason: reason || undefined,
    editedDetails: bookingEmailParsedDetailsFromForm(input.form),
  }
}
