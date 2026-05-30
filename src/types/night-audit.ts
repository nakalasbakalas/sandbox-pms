export interface NightAuditLog {
  id: string
  auditDate: Date
  startedAt: Date
  completedAt?: Date
  startedBy: string
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK'
  steps: NightAuditStep[]
  statistics: NightAuditStatistics
  errors: NightAuditError[]
  notes?: string
}

export interface NightAuditStep {
  id: string
  name: string
  description: string
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'SKIPPED'
  startedAt?: Date
  completedAt?: Date
  duration?: number
  result?: any
  error?: string
}

export interface NightAuditStatistics {
  date: Date
  occupancy: {
    totalRooms: number
    occupiedRooms: number
    availableRooms: number
    outOfServiceRooms: number
    occupancyRate: number
  }
  revenue: {
    roomRevenue: number
    extraGuestRevenue: number
    serviceRevenue: number
    totalRevenue: number
  }
  arrivals: {
    expected: number
    actual: number
    noShows: number
    walkIns: number
  }
  departures: {
    expected: number
    actual: number
    stayOvers: number
    earlyCheckouts: number
    lateCheckouts: number
  }
  housekeeping: {
    cleanedRooms: number
    dirtyRooms: number
    inspectedRooms: number
    maintenanceRooms: number
  }
  payments: {
    cashReceived: number
    cardReceived: number
    transferReceived: number
    totalReceived: number
    outstandingBalance: number
  }
}

export interface NightAuditError {
  step: string
  severity: 'WARNING' | 'ERROR' | 'CRITICAL'
  message: string
  details?: any
  timestamp: Date
}

export interface NightAuditConfig {
  autoRunTime: string
  autoRunEnabled: boolean
  steps: {
    rolloverDate: boolean
    postRoomCharges: boolean
    processNoShows: boolean
    calculateOccupancy: boolean
    reconcilePayments: boolean
    backupData: boolean
    generateReports: boolean
    closeShift: boolean
  }
  noShowPolicy: {
    autoMarkAsNoShow: boolean
    hoursAfterCheckIn: number
    applyNoShowFee: boolean
    noShowFeePercentage: number
  }
  lateCheckoutPolicy: {
    autoExtendStay: boolean
    applyLateFee: boolean
    lateFeeAmount: number
  }
}
