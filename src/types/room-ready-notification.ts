export interface RoomReadyNotificationSettings {
  enabled: boolean
  notifyOnClean: boolean
  notifyOnInspected: boolean
  onlyForArrivals: boolean
  
  channels: {
    line: boolean
    email: boolean
  }
  
  recipients: {
    roles: ('ADMIN' | 'MANAGER' | 'FRONT_DESK' | 'HOUSEKEEPING' | 'CASHIER' | 'MAINTENANCE')[]
    staffIds: string[]
  }
  
  messageTemplate: {
    title: string
    body: string
  }
  
  throttle: {
    enabled: boolean
    minMinutesBetweenNotifications: number
  }
  
  schedule: {
    enabled: boolean
    startTime: string
    endTime: string
    daysOfWeek: number[]
  }
}

export interface RoomReadyNotificationLog {
  id: string
  roomNumber: string
  roomId: string
  status: 'CLEAN' | 'INSPECTED'
  hasArrivalToday: boolean
  arrivalTime?: string
  guestName?: string
  
  notificationSent: boolean
  sentAt?: Date
  sentVia: ('line' | 'email')[]
  recipientCount: number
  
  suppressedReason?: 'THROTTLED' | 'SCHEDULE' | 'NO_ARRIVAL' | 'DISABLED' | 'NO_RECIPIENTS'
  
  createdAt: Date
}

export const DEFAULT_ROOM_READY_SETTINGS: RoomReadyNotificationSettings = {
  enabled: true,
  notifyOnClean: true,
  notifyOnInspected: true,
  onlyForArrivals: true,
  
  channels: {
    line: true,
    email: false,
  },
  
  recipients: {
    roles: ['FRONT_DESK', 'MANAGER'],
    staffIds: [],
  },
  
  messageTemplate: {
    title: '✅ Room {{roomNumber}} Ready',
    body: 'Room {{roomNumber}} is now {{status}} and ready for the next guest{{arrivalInfo}}.',
  },
  
  throttle: {
    enabled: true,
    minMinutesBetweenNotifications: 5,
  },
  
  schedule: {
    enabled: true,
    startTime: '06:00',
    endTime: '23:00',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  },
}
