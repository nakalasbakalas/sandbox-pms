export type LiteRole = 'ADMIN' | 'MANAGER' | 'FRONT_DESK' | 'HOUSEKEEPING' | 'CASHIER' | 'CAFE_STAFF'

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
  vip: boolean
  blacklisted: boolean
}

export type RoomTypeSummary = {
  id: string
  code: string
  name: string
  baseRateSatang: number
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
  subtotalSatang: number
  taxSatang: number
  totalSatang: number
  paidSatang: number
  balanceSatang: number
  paymentState: 'SETTLED' | 'PARTIAL' | 'UNPAID'
  updatedAt: string | null
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
  source: string
  providerCode: string | null
  externalReservationId: string | null
  channelRef: string | null
  sourceEmailEventId: string | null
  ratePerNightSatang: number
  totalAmountSatang: number
  depositAmountSatang: number
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
  providerCode: string | null
  receivedAt: string | null
  checkIn: string | null
  checkOut: string | null
  amountSatang: number | null
  currency: string
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

export type ReservationSegment = ReservationSummary & {
  segmentStart: string
  segmentEnd: string
}

export type BoardPayload = {
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
  guest: {
    displayName: string
  }
}

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
  pendingReviewEmail: PendingReviewEmailSummary
}

/** Authorized review DTO for Channel Desk. Raw email, headers and parsedDetails stay server-side. */
export type BookingEmailEvent = {
  id: string
  eventType: 'NEW_BOOKING' | 'MODIFICATION' | 'CANCELLATION' | 'PAYMENT_NOTICE' | 'GUEST_MESSAGE' | 'UNKNOWN'
  status: 'NEEDS_REVIEW' | 'PROCESSED' | 'ERROR' | 'IGNORED'
  providerCode: string | null
  receivedAt: string | null
  channelRef: string | null
  reservationId: string | null
  guestName: string | null
  checkIn: string | null
  checkOut: string | null
  roomType: string | null
  amountSatang: number | null
  currency: string
  confidence: number
  reviewReason: string | null
  errorReason: string | null
}

export type ManualChannelProviderCode = 'booking_com' | 'agoda' | 'trip_com'

export type ManualChannelConnection = {
  id: string
  providerCode: ManualChannelProviderCode
  displayName: string
  deliveryMode: 'MANUAL' | 'CHANNEX'
  externalPropertyId: string | null
  extranetUrl: string | null
  enabled: boolean
  configured: boolean
  mappings: Array<{
    id: string
    roomTypeId: string
    roomTypeName: string | null
    externalRoomTypeId: string
    externalRoomTypeName: string
    externalRatePlanId: string | null
    active: boolean
  }>
}

export type ManualChannelTask = {
  id: string
  providerCode: ManualChannelProviderCode | null
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
  completedAt: string | null
  completedBy: string | null
  completionNotes: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
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
  tasks: ManualChannelTask[]
  counts: Record<string, number>
  warning: string
}

export type VersionPayload = {
  apiVersion: string
  dtoVersion: string
  uiVariant: 'lite'
  commitSha: string | null
  buildTime: string | null
  assetIdentifier: string | null
  releaseId: string | null
  serviceName: string | null
  environment: string
  generatedAt: string
}

export type Language = 'en' | 'th'
