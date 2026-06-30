export type BookingEmailEventStatus = 'NEEDS_REVIEW' | 'PROCESSED' | 'ERROR' | 'IGNORED'

export type BookingEmailEventType =
  | 'NEW_BOOKING'
  | 'MODIFICATION'
  | 'CANCELLATION'
  | 'PAYMENT_NOTICE'
  | 'GUEST_MESSAGE'
  | 'UNKNOWN'

export interface BookingEmailParsedDetails {
  guestName?: string
  guestEmail?: string
  guestPhone?: string
  checkIn?: string
  checkOut?: string
  roomType?: string
  adults?: number
  children?: number
  childAges?: number[]
  amount?: number
  currency?: string
  paymentStatus?: string
  paymentMethod?: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'ONLINE' | 'OTHER'
  paymentReference?: string
  specialRequests?: string
  notes?: string
  channelRef?: string
  confirmationCode?: string
}

export interface BookingEmailEvent {
  id: string
  sourceId?: string
  sourceName?: string
  source: string
  sender: string
  subject?: string
  receivedAt: string
  eventType: BookingEmailEventType
  status: BookingEmailEventStatus
  channelRef?: string
  guestName?: string
  checkIn?: string
  checkOut?: string
  roomType?: string
  amount?: number
  currency?: string
  paymentStatus?: string
  confidence?: number
  proposedAction?: string
  completedAction?: string
  reviewReason?: string
  errorReason?: string
  rawEmailUrl?: string
  reservationId?: string
  reservationConfirmation?: string
  duplicateOfEventId?: string
  sourceEmailId?: string
  parsedDetails?: BookingEmailParsedDetails
  createdAt?: string
  updatedAt?: string
}

export interface BookingEmailSource {
  id: string
  name: string
  provider: 'gmail' | 'imap' | 'forwarded-mailbox' | 'manual' | 'other'
  enabled: boolean
  mailbox?: string
  lastSyncAt?: string
  lastError?: string
  autoProcessSafeEvents: boolean
  reviewThreshold: number
}

export interface BookingEmailStatus {
  configured: boolean
  lastSyncAt?: string
  nextSyncAt?: string
  needsReview: number
  processedToday: number
  errors: number
  ignored: number
  sources: BookingEmailSource[]
  message?: string
}

export interface BookingEmailEventFilters {
  status?: BookingEmailEventStatus
  sourceId?: string
  limit?: number
}

export interface BookingEmailApprovePayload {
  mode: 'apply_parsed' | 'create_reservation' | 'link_reservation'
  reservationId?: string
  editedDetails?: BookingEmailParsedDetails
  reason?: string
}

export interface BookingEmailRejectPayload {
  reason: string
}
