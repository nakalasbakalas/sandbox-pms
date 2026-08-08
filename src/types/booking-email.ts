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
  externalRoomType?: string
  adults?: number
  children?: number
  childAges?: number[]
  amount?: number
  amountSatang?: string
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
  amountSatang?: string | null
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
  automationDecision?: {
    version?: string
    stage?: 'EXTRACTED' | 'EVALUATING' | 'REVIEW_REQUIRED' | 'AUTO_APPLIED' | 'AUTO_LINKED_DUPLICATE' | 'AUTO_LINKED_EXISTING' | 'ERROR' | string
    confidence?: number
    corroborationCount?: number
    corroboratingEventIds?: string[]
    conflictingFields?: string[]
    blockers?: string[]
    provider?: string
    channelMappingIds?: string[]
    resolvedRoomTypeId?: string
    resolvedRoomTypeCode?: string
    assignedRoomId?: string
    reservationId?: string
    duplicateOfEventId?: string | null
    evaluatedAt?: string
  }
  managerReviewNotifiedAt?: string
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
  credentialMode?: 'access_token' | 'refresh_token' | 'missing' | 'not-required'
  credentialStatus?: {
    gmailOauthClientConfigured: boolean
    refreshTokenConfigured: boolean
    accessTokenConfigured?: boolean
    targetMailboxConfigured: boolean
    targetMailbox?: string
    userId?: string
    scopes?: string[]
    missing?: string[]
    remediation?: string
    connectionTest?: {
      checked: boolean
      status: 'pass' | 'fail' | 'not_configured' | 'not_required' | 'not_tested'
      message?: string
      authenticatedMailbox?: string
      targetMailboxMatchesAuthenticatedAccount?: boolean
    }
  }
  workspaceJson?: {
    requested: boolean
    configured: boolean
    folderConfigured: boolean
    driveScopeConfigured: boolean
    requireForAutonomy: boolean
    missing: string[]
  }
  lastSyncAt?: string
  nextSyncAt?: string
  needsReview: number
  processedToday: number
  errors: number
  ignored: number
  automation?: {
    version: string
    requested: boolean
    configured: boolean
    operationalMutationsEnabled: boolean
    autoAssignRooms: boolean
    notifyManager: boolean
    requireAuthenticationResults: boolean
    requireCorroboration: boolean
    requireWorkspaceJson: boolean
    workspaceJsonConfigured: boolean
    minimumConfidence: number
    trustedSenderDomainCount: number
    missing: string[]
  }
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
