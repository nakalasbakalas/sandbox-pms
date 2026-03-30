import { NotificationType, NotificationPriority } from '@/hooks/use-notifications'

export interface DemoNotification {
  type: NotificationType
  priority: NotificationPriority
  title: string
  message: string
  roomNumber?: string
  roomId?: string
  actionRequired: boolean
  metadata?: Record<string, any>
}

export const demoNotifications: DemoNotification[] = [
  {
    type: 'HOUSEKEEPING_URGENT',
    priority: 'URGENT',
    title: '🚨 URGENT: Room 305 Needs Immediate Cleaning',
    message: 'VIP guest arriving in 30 minutes. Room currently dirty.',
    roomNumber: '305',
    roomId: 'room-305',
    actionRequired: true,
    metadata: { vip: true, arrivalTime: '14:00' }
  },
  {
    type: 'MAINTENANCE_URGENT',
    priority: 'URGENT',
    title: '🚨 URGENT Maintenance: Room 212',
    message: 'AC: Air conditioning completely non-functional. Guest complaint.',
    roomNumber: '212',
    roomId: 'room-212',
    actionRequired: true,
    metadata: { category: 'AC', guestComplaint: true }
  },
  {
    type: 'ARRIVAL_IMMINENT',
    priority: 'HIGH',
    title: '⚠️ Guest Arriving Soon - Room 308',
    message: 'Guest checking in at 14:00. Room status: Cleaning in progress.',
    roomNumber: '308',
    roomId: 'room-308',
    actionRequired: true,
    metadata: { estimatedCompletion: '13:45', arrivalTime: '14:00' }
  },
  {
    type: 'MAINTENANCE_URGENT',
    priority: 'HIGH',
    title: '⚠️ Maintenance: Room 201',
    message: 'PLUMBING: Shower drain slow. Needs attention today.',
    roomNumber: '201',
    roomId: 'room-201',
    actionRequired: true,
    metadata: { category: 'PLUMBING', priority: 'HIGH' }
  },
  {
    type: 'CHECKOUT_DELAYED',
    priority: 'HIGH',
    title: '⚠️ Late Checkout - Room 314',
    message: 'Guest has not checked out. Checkout time was 11:00.',
    roomNumber: '314',
    roomId: 'room-314',
    actionRequired: true,
    metadata: { scheduledCheckout: '11:00', currentTime: '12:30' }
  },
  {
    type: 'ROOM_BLOCKED',
    priority: 'MEDIUM',
    title: 'Room 216 Blocked',
    message: 'Maintenance: Electrical issue. Room unavailable for booking.',
    roomNumber: '216',
    roomId: 'room-216',
    actionRequired: false,
    metadata: { reason: 'electrical', estimatedResolution: 'Tomorrow' }
  },
  {
    type: 'GUEST_REQUEST',
    priority: 'MEDIUM',
    title: 'Guest Request - Room 310',
    message: 'Extra towels and pillows requested.',
    roomNumber: '310',
    roomId: 'room-310',
    actionRequired: true,
    metadata: { items: ['towels', 'pillows'], requestTime: new Date().toISOString() }
  },
  {
    type: 'HOUSEKEEPING_URGENT',
    priority: 'MEDIUM',
    title: 'Stayover Service - Room 207',
    message: 'Guest requested room service. Currently occupied.',
    roomNumber: '207',
    roomId: 'room-207',
    actionRequired: true,
    metadata: { serviceType: 'stayover', preferredTime: '15:00' }
  },
  {
    type: 'SYSTEM_ALERT',
    priority: 'LOW',
    title: 'Daily Report Ready',
    message: 'Housekeeping summary for today is now available.',
    actionRequired: false,
    metadata: { reportType: 'daily', roomsCleaned: 12, roomsPending: 3 }
  },
  {
    type: 'SYSTEM_ALERT',
    priority: 'LOW',
    title: 'Inventory Update',
    message: 'Cleaning supplies inventory updated. 5 items low stock.',
    actionRequired: false,
    metadata: { lowStockItems: 5, criticalItems: 1 }
  }
]

export function getRandomDemoNotification(): DemoNotification {
  return demoNotifications[Math.floor(Math.random() * demoNotifications.length)]
}

export function getDemoNotificationsByPriority(priority: NotificationPriority): DemoNotification[] {
  return demoNotifications.filter(n => n.priority === priority)
}

export function getDemoNotificationsByType(type: NotificationType): DemoNotification[] {
  return demoNotifications.filter(n => n.type === type)
}
