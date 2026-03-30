export interface DailySummarySettings {
  enabled: boolean
  
  schedule: {
    time: string
    daysOfWeek: number[]
  }
  
  channels: {
    line: boolean
    email: boolean
  }
  
  recipients: {
    roles: ('ADMIN' | 'MANAGER' | 'FRONT_DESK' | 'HOUSEKEEPING' | 'CASHIER' | 'MAINTENANCE')[]
    staffIds: string[]
  }
  
  includeMetrics: {
    roomStatus: boolean
    housekeepingProgress: boolean
    arrivalsAndDepartures: boolean
    maintenanceIssues: boolean
    readinessScore: boolean
  }
  
  thresholds: {
    lowReadinessWarning: number
    highPriorityRoomCount: number
  }
}

export interface DailySummaryReport {
  id: string
  generatedAt: Date
  reportDate: Date
  
  roomStatus: {
    total: number
    clean: number
    inspected: number
    dirty: number
    cleaning: number
    outOfService: number
  }
  
  housekeepingProgress: {
    totalTasks: number
    completed: number
    inProgress: number
    notStarted: number
    averageCompletionTime: number
  }
  
  todaySchedule: {
    departures: number
    departuresCompleted: number
    arrivals: number
    roomsReadyForArrivals: number
    readinessPercentage: number
  }
  
  maintenanceIssues: {
    total: number
    urgent: number
    high: number
    roomsBlocked: number
    oldestIssueAge: number
  }
  
  readinessScore: {
    score: number
    factors: {
      cleanRoomRatio: number
      arrivalReadiness: number
      maintenanceHealth: number
      housekeepingVelocity: number
    }
  }
  
  alerts: DailySummaryAlert[]
  
  roomDetails: DailySummaryRoomDetail[]
}

export interface DailySummaryAlert {
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  category: 'HOUSEKEEPING' | 'ARRIVALS' | 'MAINTENANCE' | 'OPERATIONS'
  message: string
  rooms?: string[]
  actionable: boolean
}

export interface DailySummaryRoomDetail {
  roomNumber: string
  status: 'CLEAN' | 'DIRTY' | 'INSPECTED' | 'CLEANING' | 'OUT_OF_SERVICE'
  hasArrival: boolean
  hasDeparture: boolean
  arrivalTime?: string
  guestName?: string
  priority: number
  needsAttention: boolean
  notes?: string
}

export interface DailySummaryLog {
  id: string
  reportDate: Date
  generatedAt: Date
  sentAt?: Date
  sentVia: ('line' | 'email')[]
  recipientCount: number
  deliveryStatus: 'PENDING' | 'SENT' | 'FAILED'
  failureReason?: string
  reportSummary: {
    cleanRooms: number
    dirtyRooms: number
    arrivals: number
    readinessScore: number
  }
}

export const DEFAULT_DAILY_SUMMARY_SETTINGS: DailySummarySettings = {
  enabled: true,
  
  schedule: {
    time: '07:00',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  },
  
  channels: {
    line: true,
    email: true,
  },
  
  recipients: {
    roles: ['MANAGER', 'FRONT_DESK'],
    staffIds: [],
  },
  
  includeMetrics: {
    roomStatus: true,
    housekeepingProgress: true,
    arrivalsAndDepartures: true,
    maintenanceIssues: true,
    readinessScore: true,
  },
  
  thresholds: {
    lowReadinessWarning: 80,
    highPriorityRoomCount: 3,
  },
}
