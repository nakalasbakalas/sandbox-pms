import type { HotelOpsNotification } from '@/types/hotel-ops'
import type { Notification, NotificationPriority } from '@/hooks/use-notifications'

const DISPLAY_ID_PREFIX = 'hotel-ops:'

type HotelOpsNotificationDisplayOptions = {
  readIds?: string[]
  dismissedIds?: string[]
}

export function hotelOpsNotificationDisplayId(notificationId: string) {
  return `${DISPLAY_ID_PREFIX}${notificationId}`
}

export function hotelOpsNotificationBackendId(displayId: string) {
  return displayId.startsWith(DISPLAY_ID_PREFIX) ? displayId.slice(DISPLAY_ID_PREFIX.length) : displayId
}

export function hotelOpsNotificationPriority(notification: Pick<HotelOpsNotification, 'type' | 'status' | 'channel'>): NotificationPriority {
  if (notification.type === 'EMERGENCY_STOP' || notification.type === 'NEEDS_HUMAN') return 'URGENT'
  if (notification.status === 'FAILED' || notification.type === 'APPROVAL_REQUEST') return 'HIGH'
  if (notification.status === 'PENDING_PROVIDER' || notification.type === 'TREND_ALERT') return 'MEDIUM'
  return 'LOW'
}

export function hotelOpsNotificationActionRequired(notification: Pick<HotelOpsNotification, 'type' | 'status' | 'channel'>) {
  return (
    notification.type === 'APPROVAL_REQUEST' ||
    notification.type === 'NEEDS_HUMAN' ||
    notification.type === 'EMERGENCY_STOP' ||
    notification.status === 'FAILED' ||
    (notification.channel === 'EMAIL' && notification.status === 'PENDING_PROVIDER')
  )
}

export function hotelOpsNotificationMessage(notification: Pick<HotelOpsNotification, 'summary' | 'channel' | 'status'>) {
  const summary = String(notification.summary || '').trim()
  const suffixes: string[] = []

  if (notification.channel === 'EMAIL' && notification.status === 'PENDING_PROVIDER') {
    suffixes.push('Email delivery is pending provider setup.')
  } else if (notification.status === 'FAILED') {
    suffixes.push('Delivery failed and needs staff review.')
  }

  return [summary, ...suffixes].filter(Boolean).join(' ')
}

export function toHotelOpsNotificationDisplay(
  notification: HotelOpsNotification,
  options: HotelOpsNotificationDisplayOptions = {},
): Notification {
  const backendId = notification.id
  const readIds = options.readIds || []
  const dismissedIds = options.dismissedIds || []

  return {
    id: hotelOpsNotificationDisplayId(backendId),
    type: 'HOTEL_OPS',
    priority: hotelOpsNotificationPriority(notification),
    title: notification.title,
    message: hotelOpsNotificationMessage(notification),
    timestamp: new Date(notification.createdAt),
    read: readIds.includes(backendId),
    dismissed: dismissedIds.includes(backendId),
    actionRequired: hotelOpsNotificationActionRequired(notification),
    actionUrl: notification.actionUrl || undefined,
    actionLabel: 'Open Ops',
    metadata: {
      source: 'hotel-ops',
      hotelOpsNotificationId: backendId,
      channel: notification.channel,
      status: notification.status,
      taskId: notification.taskId,
      trendAlertId: notification.trendAlertId,
      notificationType: notification.type,
    },
  }
}
