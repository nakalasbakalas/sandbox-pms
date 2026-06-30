export type OtaPlatform = 'booking' | 'agoda' | 'trip' | 'expedia' | 'all' | 'unknown'

export type HotelOpsTaskType =
  | 'READ_RESERVATIONS'
  | 'READ_GUEST_MESSAGES'
  | 'DRAFT_GUEST_REPLY'
  | 'SEND_GUEST_REPLY'
  | 'READ_RATES'
  | 'UPDATE_RATE'
  | 'READ_AVAILABILITY'
  | 'UPDATE_AVAILABILITY'
  | 'CLOSE_ROOM'
  | 'OPEN_ROOM'
  | 'UPDATE_DESCRIPTION'
  | 'UPDATE_PHOTOS'
  | 'SCAN_BOOKINGS'
  | 'GENERATE_RECOMMENDATION'
  | 'NO_OP_CLARIFY'
  | 'FORBIDDEN'

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'FORBIDDEN'

export type HotelOpsTaskStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'DENIED'
  | 'CANCELLED'
  | 'NEEDS_HUMAN'

export type HotelOpsRole = 'OWNER' | 'HOTEL_MANAGER' | 'STAFF' | 'VIEWER' | 'SYSTEM'

export type HotelOpsApprovalStatus = 'PENDING' | 'APPROVED' | 'DENIED'

export type DateRange = {
  start: string | null
  end: string | null
}

export type Money = {
  amount: number | null
  currency: string
}

export type AvailabilityChange = {
  rooms: number | null
  status: 'open' | 'closed' | null
}

export type ParsedHotelOpsTask = {
  taskType: HotelOpsTaskType
  platform: OtaPlatform
  hotelId: string
  roomType: string | null
  dateRange: DateRange
  rate?: Money
  availability?: AvailabilityChange
  message?: string | null
  riskLevel: RiskLevel
  approvalRequired: boolean
  confidence: number
  missingFields: string[]
  rationale: string
}

export type PermissionDecision = {
  allowed: boolean
  approvalRequired: boolean
  requiredApprovalRole?: HotelOpsRole
  riskLevel: RiskLevel
  reason: string
  blockedByEmergencyStop?: boolean
}

export type ProofScreenshot = {
  id?: string
  kind: 'before' | 'after' | 'error' | 'trace'
  storageUrl: string
  capturedAt: string
  redactionStatus: 'UNKNOWN' | 'REDACTED' | 'SAFE' | 'FAILED'
}

export type HotelOpsApproval = {
  id: string
  taskId: string
  requiredRole: HotelOpsRole
  status: HotelOpsApprovalStatus
  requestedAt: string
  decidedAt?: string | null
  decidedBy?: string | null
  notes?: string | null
  task?: HotelOpsTask
}

export type HotelOpsTaskLog = {
  id: string
  taskId: string
  action: string
  message: string
  metadata?: unknown
  actor?: string | null
  createdAt: string
}

export type HotelOpsNotification = {
  id: string
  propertyId: string
  taskId?: string | null
  trendAlertId?: string | null
  type: 'TASK_UPDATE' | 'APPROVAL_REQUEST' | 'TREND_ALERT' | 'NEEDS_HUMAN' | 'EMERGENCY_STOP'
  channel: 'IN_APP' | 'EMAIL'
  status: 'RECORDED' | 'PENDING_PROVIDER' | 'SENT' | 'FAILED'
  recipientRole?: HotelOpsRole | null
  recipientUserId?: string | null
  recipientAddress?: string | null
  title: string
  summary: string
  actionUrl?: string | null
  metadata?: unknown
  sentAt?: string | null
  createdAt: string
}

export type HotelOpsTask = ParsedHotelOpsTask & {
  id: string
  requesterUserId: string
  requesterLabel?: string | null
  rawMessage: string
  sourceChannel: 'web' | 'line' | 'whatsapp' | 'telegram' | 'email' | 'system'
  status: HotelOpsTaskStatus
  idempotencyKey: string
  permissionDecision?: PermissionDecision
  proofScreenshots?: ProofScreenshot[]
  executionSummary?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  approvals?: HotelOpsApproval[]
  logs?: HotelOpsTaskLog[]
  notifications?: HotelOpsNotification[]
  createdAt: string
  updatedAt: string
}

export type HotelOpsCommandResult = {
  task: HotelOpsTask
  parsed: ParsedHotelOpsTask
  decision: PermissionDecision
  duplicate?: boolean
}

export type HotelOpsTrendAlert = {
  id: string
  hotelId: string
  alertType:
    | 'HIGH_DEMAND'
    | 'LOW_DEMAND'
    | 'CANCELLATION_SPIKE'
    | 'WEEKEND_SPIKE'
    | 'ROOM_IMBALANCE'
    | 'OTA_IMBALANCE'
    | 'INFO'
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  title: string
  summary: string
  platform?: OtaPlatform | null
  roomType?: string | null
  dateRange?: DateRange
  metrics: Record<string, unknown>
  recommendedAction?: ParsedHotelOpsTask | null
  status?: 'CREATED' | 'ACKNOWLEDGED' | 'RECOMMENDATION_APPROVED' | 'RESOLVED'
  createdAt: string
  updatedAt?: string
}

export type HotelOpsEmergencyStop = {
  id: string
  propertyId: string
  enabled: boolean
  reason?: string | null
  updatedBy?: string | null
  createdAt: string
  updatedAt: string
}

export type HotelOpsOtaStatus = {
  dryRun: boolean
  workerConfigured: boolean
  workerBaseUrlConfigured?: boolean
  workerSecretConfigured?: boolean
  scanPolicy?: {
    schedule: {
      configured: boolean
      mode: 'manual' | 'cron' | 'interval'
      cron?: string | null
      intervalMinutes?: number | null
      timezone: string
      message: string
    }
    thresholds: {
      horizonDays: number
      highDemandOccupancy: number
      highDemandVelocityRatio: number
      lowDemandOccupancy: number
      bookingVelocityWindowHours: number
      bookingVelocityBaselineDays: number
      cancellationRecentHours: number
      cancellationBaselineDays: number
      cancellationSpikeMultiplier: number
      weekendVelocityRatio: number
      otaImbalanceMinimumReservations: number
      otaImbalanceDominanceRatio: number
      highDemandRecommendedRate: number
      lowDemandRecommendedRate: number
      currency: string
    }
  }
  platforms: Array<{
    platform: OtaPlatform
    configured: boolean
    status: string
    message?: string
  }>
}
