export type LiteRole = 'ADMIN' | 'MANAGER' | 'FRONT_DESK' | 'HOUSEKEEPING' | 'CASHIER' | 'CAFE_STAFF'

/** Integer Thai baht subunits. API writes reject fractional and unsafe values at runtime. */
export type MoneySatang = number

/** Extensible provider identifier. Supported write targets are validated by the API. */
export type ProviderCode = string

export type LiteUser = {
  id: string
  username: string
  email?: string | null
  role: LiteRole
  displayName: string
  active?: boolean
}

export type PropertySummary = {
  id: string
  code: string
  name: string
  timezone: string
  currency: string
  defaultCheckIn: string
  defaultCheckOut: string
}

export type GuestSummary = {
  id: string
  firstName: string
  lastName: string
  displayName: string
  nationality: string | null
  idType: string | null
  identityComplete: boolean
  idNumberLast4: string | null
  vip: boolean
  blacklisted: boolean
}

export type RoomTypeSummary = {
  id: string
  code: string
  name: string
  baseRateSatang: MoneySatang
  maxOccupancy?: number
  standardOccupancy?: number
}

export type AssignedRoomSummary = {
  id: string
  number: string
  floor: number
  roomTypeId: string
  operationalStatus: string
  housekeepingStatus: string
}

export type RoomSummary = AssignedRoomSummary & {
  roomType: Pick<RoomTypeSummary, 'id' | 'code' | 'name' | 'baseRateSatang'>
  blockedUntil: string | null
  statusUpdatedAt: string | null
}

export type FolioSummary = {
  id: string
  status: string
  subtotalSatang: MoneySatang
  taxSatang: MoneySatang
  totalSatang: MoneySatang
  paidSatang: MoneySatang
  balanceSatang: MoneySatang
  paymentState: 'SETTLED' | 'PARTIAL' | 'UNPAID'
  charges: FolioCharge[]
  payments: FolioPayment[]
  updatedAt: string | null
}

export type FolioCharge = {
  id: string
  date: string
  description: string
  category: string
  amountSatang: MoneySatang
  quantity: number
  totalSatang: MoneySatang
  void: boolean
  voidReason: string | null
  createdBy: string
  createdAt: string | null
}

export type FolioPayment = {
  id: string
  amountSatang: MoneySatang
  method: string
  reference: string | null
  notes: string | null
  processedBy: string
  createdAt: string | null
}

export type ReservationSummary = {
  id: string
  confirmationCode: string
  checkIn: string
  checkOut: string
  actualCheckIn: string | null
  actualCheckOut: string | null
  nights: number
  status: string
  adults: number
  children: number
  childAges: number[]
  source: string
  providerCode: ProviderCode | null
  externalReservationId: string | null
  channelRef: string | null
  sourceEmailEventId: string | null
  ratePerNightSatang: MoneySatang
  totalAmountSatang: MoneySatang
  depositAmountSatang: MoneySatang
  depositPaid: boolean
  guest: GuestSummary
  roomType: RoomTypeSummary
  assignedRoomId: string | null
  assignedRoom: AssignedRoomSummary | null
  folio: FolioSummary | null
  createdAt: string | null
  updatedAt: string | null
}

export type PendingReviewEmailEvent = {
  id: string
  eventType: string
  status: 'NEEDS_REVIEW'
  providerCode: ProviderCode | null
  receivedAt: string | null
  checkIn: string | null
  checkOut: string | null
  amountSatang: MoneySatang | null
  currency: string | null
  confidence: number
  linkedToReservation: boolean
}

export type PendingReviewEmailSummary = {
  total: number
  returned: number
  truncated: boolean
  latestReceivedAt: string | null
  sampleByEventType: Record<string, number>
  sampleByProviderCode: Record<string, number>
  events: PendingReviewEmailEvent[]
  piiBoundary: string
}

export type FrontDeskPayload = {
  property: PropertySummary
  hotelDate: string
  summary: {
    arrivals: number
    departures: number
    inHouse: number
    unpaidDepartures: number
    roomsTotal: number
    roomsReady: number
    roomsDirty: number
    roomsBlocked: number
  }
  arrivals: ReservationSummary[]
  departures: ReservationSummary[]
  inHouse: ReservationSummary[]
  pendingReviewEmail: PendingReviewEmailSummary
}

export type BookingPage = {
  property: PropertySummary
  filters: {
    from: string | null
    to: string | null
    statuses: string[]
    sources: string[]
    query: string | null
  }
  page: {
    limit: number
    total: number
    hasMore: boolean
    nextCursor: string | null
  }
  items: ReservationSummary[]
  pendingReviewEmail: PendingReviewEmailSummary
}

export type ReservationAuditAction =
  | 'CREATED'
  | 'MODIFIED'
  | 'ASSIGNED_ROOM'
  | 'CHECKED_IN'
  | 'CHECKED_OUT'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'RATE_ADJUSTED'
  | 'MOVED_ROOM'
  | 'DEPOSIT_PAID'
  | 'WALK_IN_CHECKED_IN'
  | 'OTHER'

export type ReservationAuditEvent = {
  id: string
  action: ReservationAuditAction
  label: string
  actorLabel: string
  occurredAt: string | null
  source: 'RESERVATION_LOG'
}

export type BookingDetail = {
  property: PropertySummary
  reservation: ReservationSummary
  auditTimeline: {
    order: 'newest_first'
    total: number
    returned: number
    truncated: boolean
    events: ReservationAuditEvent[]
    privacyBoundary: string
  }
}

export type ReservationSegment = ReservationSummary & {
  segmentStart: string
  segmentEnd: string
}

export type BoardRangeDto = {
  property: PropertySummary
  range: {
    from: string
    to: string
    days: string[]
    dayCount: number
    semantics: '[from,to)'
    maximumDays: number
  }
  roomTypes: Array<RoomTypeSummary & { roomCount: number }>
  rooms: RoomSummary[]
  reservationSegments: ReservationSegment[]
  unassignedBookings: ReservationSegment[]
  counts: {
    rooms: number
    assignedSegments: number
    unassignedBookings: number
  }
  pendingReviewEmail: PendingReviewEmailSummary
}

export type HousekeepingRoom = RoomSummary & {
  priority: 'BLOCKED' | 'TURNOVER' | 'ARRIVAL_NOT_READY' | 'CLEANING' | 'DIRTY' | 'INSPECTED' | 'READY'
  priorityRank: number
  readyForArrival: boolean
  arrivals: HousekeepingStay[]
  departures: HousekeepingStay[]
  inHouse: HousekeepingStay[]
}

export type HousekeepingStay = {
  id: string
  assignedRoomId: string | null
  checkIn: string
  checkOut: string
  status: string
}

/** Backwards-compatible client name for the public board range DTO. */
export type BoardPayload = BoardRangeDto

export type HousekeepingPayload = {
  property: PropertySummary
  hotelDate: string
  statusSemantics: string
  summary: {
    total: number
    ready: number
    dirty: number
    cleaning: number
    inspected: number
    blocked: number
    arrivalNotReady: number
    turnover: number
  }
  rooms: HousekeepingRoom[]
}

/** Authorized review DTO for Channel Desk. Raw email, headers and parsedDetails stay server-side. */
export type BookingEmailEvent = {
  id: string
  eventType: 'NEW_BOOKING' | 'MODIFICATION' | 'CANCELLATION' | 'PAYMENT_NOTICE' | 'GUEST_MESSAGE' | 'UNKNOWN'
  status: 'NEEDS_REVIEW' | 'PROCESSED' | 'ERROR' | 'IGNORED'
  providerCode: ProviderCode | null
  receivedAt: string | null
  channelRef: string | null
  reservationId: string | null
  guestName: string | null
  checkIn: string | null
  checkOut: string | null
  roomType: string | null
  amountSatang: MoneySatang | null
  currency: string | null
  confidence: number
  reviewReason: string | null
  errorReason: string | null
  adults: number | null
  children: number | null
  childAges: number[]
}

/** @deprecated Use ProviderCode. Retained while older client imports migrate. */
export type ManualChannelProviderCode = ProviderCode

export type ManualChannelRoomType = {
  id: string
  code: string
  name: string
  physicalRoomCount: number
}

export type ManualChannelMapping = {
  id: string
  roomTypeId: string
  roomTypeName: string | null
  externalRoomTypeId: string
  externalRoomTypeName: string
  externalRatePlanId: string | null
  active: boolean
}

export type ManualChannelConnection = {
  id: string
  providerCode: ProviderCode
  displayName: string
  deliveryMode: 'MANUAL' | 'CHANNEX'
  externalPropertyId: string | null
  extranetUrl: string | null
  enabled: boolean
  configured: boolean
  mappings: ManualChannelMapping[]
}

export type SaveManualChannelConnectionInput = {
  displayName?: string
  deliveryMode: 'MANUAL'
  externalPropertyId: string | null
  extranetUrl: string | null
  enabled: boolean
  initialReconcileDays?: number
  reason: string
}

export type SaveManualChannelMappingInput = {
  connectionId: string
  roomTypeId: string
  externalRoomTypeId: string
  externalRoomTypeName: string
  externalRatePlanId: string | null
  active: boolean
  reason: string
}

export type ManualChannelTask = {
  id: string
  providerCode: ProviderCode | null
  connectionId: string
  roomTypeId: string
  roomTypeName: string
  externalRoomTypeId: string | null
  externalRoomTypeName: string | null
  externalRatePlanId: string | null
  stayDate: string
  desiredAvailability: number
  confirmedAvailability: number | null
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SUPERSEDED' | 'FAILED'
  revision: number
  extranetUrl: string | null
  createdAt: string | null
  ageMinutes: number | null
  completedAt: string | null
  completedBy: string | null
  completionNotes: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
}

export type ManualChannelReconcileResult = {
  created: ManualChannelTask[]
  superseded: ManualChannelTask[]
  retargeted: ManualChannelTask[]
  coalesced: ManualChannelTask[]
  unchanged: ManualChannelTask[]
  unmapped: Array<{
    connectionId: string
    providerCode: ProviderCode
    roomTypeId: string
    stayDateKeys: string[]
    cellCount: number
    errorCode: string
  }>
  unmappedCellCount: number
  skippedPastCellCount: number
}

export type ChannelDeskPayload = {
  syncHealth: {
    enabled: boolean
    credentialReady: boolean
    watchReady: boolean
    lastSyncAt: string | null
    lastPushAt: string | null
    lastReconciledAt: string | null
    watchExpiresAt: string | null
    lastError: string | null
    pendingDeliveries: number
    failedDeliveries: number
    consecutiveFailures: number
    missingConfiguration: string[]
  }
  reviewEvents: BookingEmailEvent[]
  connections: ManualChannelConnection[]
  roomTypes: ManualChannelRoomType[]
  tasks: ManualChannelTask[]
  pagination: {
    reviewEvents: { limit: number; returned: number; total: number; truncated: boolean }
    tasks: { limit: number; returned: number; total: number; truncated: boolean }
  }
  counts: {
    reviewEvents: number
    parserErrors: number
    activeReviewWork: number
    pendingTasks: number
    inProgressTasks: number
    failedTasks: number
    activeTasks: number
    pendingDeliveries: number
    failedDeliveries: number
  }
  warning: string
}

export type VersionPayload = {
  apiVersion: string
  dtoVersion: string
  uiVariant: 'legacy' | 'lite' | 'unknown'
  commitSha: string | null
  buildTime: string | null
  assetIdentifier: string | null
  releaseId: string | null
  serviceName: string | null
  environment: string
  generatedAt: string
}

export type Language = 'en' | 'th'
