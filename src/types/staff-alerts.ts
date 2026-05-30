export type AlertType = 
  | 'NEW_BOOKING' 
  | 'DEPOSIT_PENDING' 
  | 'ARRIVAL_TODAY' 
  | 'DEPARTURE_TODAY'
  | 'NO_SHOW_CANDIDATE' 
  | 'SYNC_FAILURE' 
  | 'HOUSEKEEPING_URGENT'
  | 'MAINTENANCE_REQUIRED'
  | 'MANAGER_EXCEPTION'
  | 'PAYMENT_OVERDUE'
  | 'INVENTORY_CONFLICT'

export type AlertPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export type StaffRole = 
  | 'ADMIN'
  | 'MANAGER' 
  | 'FRONT_DESK'
  | 'HOUSEKEEPING'
  | 'CASHIER'
  | 'MAINTENANCE'

export interface StaffMember {
  id: string
  name: string
  role: StaffRole
  lineUserId?: string
  phoneNumber?: string
  email?: string
  active: boolean
  receiveAlerts: boolean
  createdAt: Date
}

export interface AlertRecipient {
  staffId: string
  staffName: string
  role: StaffRole
  lineUserId?: string
  phoneNumber?: string
  email?: string
}

export interface AlertRoutingRule {
  id: string
  alertType: AlertType
  priority: AlertPriority
  enabled: boolean
  
  channels: {
    line: boolean
    email: boolean
    sms: boolean
  }
  
  recipients: AlertRecipient[]
  
  recipientsByRole: StaffRole[]
  
  throttle: {
    enabled: boolean
    maxPerHour: number
    maxPerDay: number
  }
  
  schedule: {
    enabled: boolean
    onlyDuringBusinessHours: boolean
    businessHoursStart: string
    businessHoursEnd: string
    daysOfWeek: number[]
  }
  
  conditions?: {
    minAmount?: number
    minDaysUntil?: number
    roomTypes?: string[]
  }
  
  testMode: boolean
  testRecipients: string[]
  
  createdAt: Date
  updatedAt: Date
}

export interface AlertInstance {
  id: string
  alertType: AlertType
  priority: AlertPriority
  title: string
  message: string
  
  context: {
    reservationId?: string
    guestName?: string
    roomNumber?: string
    amount?: number
    date?: string
    source?: string
    error?: string
  }
  
  routingRuleId: string
  
  recipients: AlertRecipient[]
  
  status: 'PENDING' | 'SENT' | 'FAILED' | 'THROTTLED' | 'SUPPRESSED'
  
  deliveryStatus: {
    recipientId: string
    channel: 'line' | 'email' | 'sms'
    status: 'SENT' | 'DELIVERED' | 'FAILED'
    sentAt?: Date
    deliveredAt?: Date
    failureReason?: string
  }[]
  
  acknowledged: boolean
  acknowledgedBy?: string
  acknowledgedAt?: Date
  
  createdAt: Date
  sentAt?: Date
}

export const DEFAULT_ALERT_ROUTING_RULES: AlertRoutingRule[] = [
  {
    id: 'new-booking',
    alertType: 'NEW_BOOKING',
    priority: 'MEDIUM',
    enabled: true,
    channels: { line: true, email: false, sms: false },
    recipients: [],
    recipientsByRole: ['FRONT_DESK', 'MANAGER'],
    throttle: { enabled: false, maxPerHour: 999, maxPerDay: 999 },
    schedule: { 
      enabled: false, 
      onlyDuringBusinessHours: false, 
      businessHoursStart: '08:00',
      businessHoursEnd: '20:00',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6]
    },
    testMode: false,
    testRecipients: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'deposit-pending',
    alertType: 'DEPOSIT_PENDING',
    priority: 'HIGH',
    enabled: true,
    channels: { line: true, email: true, sms: false },
    recipients: [],
    recipientsByRole: ['FRONT_DESK', 'MANAGER', 'CASHIER'],
    throttle: { enabled: true, maxPerHour: 5, maxPerDay: 20 },
    schedule: { 
      enabled: true, 
      onlyDuringBusinessHours: true, 
      businessHoursStart: '08:00',
      businessHoursEnd: '20:00',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6]
    },
    testMode: false,
    testRecipients: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'arrival-today',
    alertType: 'ARRIVAL_TODAY',
    priority: 'MEDIUM',
    enabled: true,
    channels: { line: true, email: false, sms: false },
    recipients: [],
    recipientsByRole: ['FRONT_DESK', 'HOUSEKEEPING'],
    throttle: { enabled: true, maxPerHour: 1, maxPerDay: 2 },
    schedule: { 
      enabled: true, 
      onlyDuringBusinessHours: false, 
      businessHoursStart: '07:00',
      businessHoursEnd: '22:00',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6]
    },
    testMode: false,
    testRecipients: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'departure-today',
    alertType: 'DEPARTURE_TODAY',
    priority: 'MEDIUM',
    enabled: true,
    channels: { line: true, email: false, sms: false },
    recipients: [],
    recipientsByRole: ['FRONT_DESK', 'HOUSEKEEPING'],
    throttle: { enabled: true, maxPerHour: 1, maxPerDay: 2 },
    schedule: { 
      enabled: true, 
      onlyDuringBusinessHours: false, 
      businessHoursStart: '07:00',
      businessHoursEnd: '22:00',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6]
    },
    testMode: false,
    testRecipients: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'no-show-candidate',
    alertType: 'NO_SHOW_CANDIDATE',
    priority: 'HIGH',
    enabled: true,
    channels: { line: true, email: true, sms: false },
    recipients: [],
    recipientsByRole: ['FRONT_DESK', 'MANAGER'],
    throttle: { enabled: true, maxPerHour: 10, maxPerDay: 30 },
    schedule: { 
      enabled: true, 
      onlyDuringBusinessHours: true, 
      businessHoursStart: '14:00',
      businessHoursEnd: '23:00',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6]
    },
    testMode: false,
    testRecipients: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'sync-failure',
    alertType: 'SYNC_FAILURE',
    priority: 'CRITICAL',
    enabled: true,
    channels: { line: true, email: true, sms: false },
    recipients: [],
    recipientsByRole: ['ADMIN', 'MANAGER'],
    throttle: { enabled: true, maxPerHour: 2, maxPerDay: 10 },
    schedule: { 
      enabled: false, 
      onlyDuringBusinessHours: false, 
      businessHoursStart: '08:00',
      businessHoursEnd: '20:00',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6]
    },
    testMode: false,
    testRecipients: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'housekeeping-urgent',
    alertType: 'HOUSEKEEPING_URGENT',
    priority: 'HIGH',
    enabled: true,
    channels: { line: true, email: false, sms: false },
    recipients: [],
    recipientsByRole: ['HOUSEKEEPING', 'MANAGER'],
    throttle: { enabled: true, maxPerHour: 10, maxPerDay: 50 },
    schedule: { 
      enabled: true, 
      onlyDuringBusinessHours: true, 
      businessHoursStart: '08:00',
      businessHoursEnd: '20:00',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6]
    },
    testMode: false,
    testRecipients: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'maintenance-required',
    alertType: 'MAINTENANCE_REQUIRED',
    priority: 'HIGH',
    enabled: true,
    channels: { line: true, email: true, sms: false },
    recipients: [],
    recipientsByRole: ['MAINTENANCE', 'MANAGER'],
    throttle: { enabled: true, maxPerHour: 5, maxPerDay: 20 },
    schedule: { 
      enabled: true, 
      onlyDuringBusinessHours: true, 
      businessHoursStart: '08:00',
      businessHoursEnd: '18:00',
      daysOfWeek: [1, 2, 3, 4, 5]
    },
    testMode: false,
    testRecipients: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'manager-exception',
    alertType: 'MANAGER_EXCEPTION',
    priority: 'CRITICAL',
    enabled: true,
    channels: { line: true, email: true, sms: false },
    recipients: [],
    recipientsByRole: ['MANAGER', 'ADMIN'],
    throttle: { enabled: true, maxPerHour: 5, maxPerDay: 20 },
    schedule: { 
      enabled: false, 
      onlyDuringBusinessHours: false, 
      businessHoursStart: '08:00',
      businessHoursEnd: '20:00',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6]
    },
    testMode: false,
    testRecipients: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'payment-overdue',
    alertType: 'PAYMENT_OVERDUE',
    priority: 'HIGH',
    enabled: true,
    channels: { line: true, email: true, sms: false },
    recipients: [],
    recipientsByRole: ['CASHIER', 'MANAGER'],
    throttle: { enabled: true, maxPerHour: 3, maxPerDay: 10 },
    schedule: { 
      enabled: true, 
      onlyDuringBusinessHours: true, 
      businessHoursStart: '09:00',
      businessHoursEnd: '18:00',
      daysOfWeek: [1, 2, 3, 4, 5]
    },
    testMode: false,
    testRecipients: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'inventory-conflict',
    alertType: 'INVENTORY_CONFLICT',
    priority: 'CRITICAL',
    enabled: true,
    channels: { line: true, email: true, sms: false },
    recipients: [],
    recipientsByRole: ['ADMIN', 'MANAGER', 'FRONT_DESK'],
    throttle: { enabled: true, maxPerHour: 2, maxPerDay: 5 },
    schedule: { 
      enabled: false, 
      onlyDuringBusinessHours: false, 
      businessHoursStart: '08:00',
      businessHoursEnd: '20:00',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6]
    },
    testMode: false,
    testRecipients: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
]

export const ALERT_TYPE_METADATA = {
  NEW_BOOKING: {
    label: 'New Booking',
    description: 'Notify when a new reservation is created',
    icon: '📝',
    defaultPriority: 'MEDIUM' as AlertPriority,
  },
  DEPOSIT_PENDING: {
    label: 'Deposit Pending',
    description: 'Alert when deposit payment is not received',
    icon: '💰',
    defaultPriority: 'HIGH' as AlertPriority,
  },
  ARRIVAL_TODAY: {
    label: 'Arrivals Today',
    description: 'Daily summary of today\'s arrivals',
    icon: '✈️',
    defaultPriority: 'MEDIUM' as AlertPriority,
  },
  DEPARTURE_TODAY: {
    label: 'Departures Today',
    description: 'Daily summary of today\'s departures',
    icon: '🚪',
    defaultPriority: 'MEDIUM' as AlertPriority,
  },
  NO_SHOW_CANDIDATE: {
    label: 'No-Show Candidate',
    description: 'Guest has not checked in after deadline',
    icon: '⚠️',
    defaultPriority: 'HIGH' as AlertPriority,
  },
  SYNC_FAILURE: {
    label: 'OTA Sync Failure',
    description: 'Channel sync operation failed',
    icon: '🔴',
    defaultPriority: 'CRITICAL' as AlertPriority,
  },
  HOUSEKEEPING_URGENT: {
    label: 'Housekeeping Urgent',
    description: 'Critical housekeeping request',
    icon: '🧹',
    defaultPriority: 'HIGH' as AlertPriority,
  },
  MAINTENANCE_REQUIRED: {
    label: 'Maintenance Required',
    description: 'Room maintenance issue reported',
    icon: '🔧',
    defaultPriority: 'HIGH' as AlertPriority,
  },
  MANAGER_EXCEPTION: {
    label: 'Manager Exception',
    description: 'Action requiring manager approval',
    icon: '🔔',
    defaultPriority: 'CRITICAL' as AlertPriority,
  },
  PAYMENT_OVERDUE: {
    label: 'Payment Overdue',
    description: 'Guest payment is overdue',
    icon: '⏰',
    defaultPriority: 'HIGH' as AlertPriority,
  },
  INVENTORY_CONFLICT: {
    label: 'Inventory Conflict',
    description: 'Room availability conflict detected',
    icon: '❌',
    defaultPriority: 'CRITICAL' as AlertPriority,
  },
} as const
