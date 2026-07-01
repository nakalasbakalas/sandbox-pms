import { useCallback, useEffect, useMemo, useState } from 'react'
import { useKV } from '@github/spark/hooks'
import { useAuth } from '@/hooks/use-auth'
import { SERVER_AUTH_ENABLED } from '@/lib/auth-mode'
import { hotelOpsApi } from '@/lib/hotel-ops-api-client'
import {
  hotelOpsNotificationBackendId,
  toHotelOpsNotificationDisplay,
} from '@/lib/ops-notification-display'
import type { Notification } from '@/hooks/use-notifications'
import type { HotelOpsNotification } from '@/types/hotel-ops'

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)))
}

export type UseOpsNotificationsResult = {
  notifications: Notification[]
  activeNotifications: Notification[]
  unreadNotifications: Notification[]
  unreadCount: number
  loading: boolean
  loadError: string | null
  refresh: () => Promise<void>
  markAsRead: (notificationId: string) => void
  markAllAsRead: () => void
  dismissNotification: (notificationId: string) => void
  clearAll: () => void
}

export function useOpsNotifications(): UseOpsNotificationsResult {
  const { hasAnyPermission } = useAuth()
  const canLoadOpsNotifications = SERVER_AUTH_ENABLED && hasAnyPermission(['view:ops'])
  const [serverNotifications, setServerNotifications] = useState<HotelOpsNotification[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [readIds, setReadIds] = useKV<string[]>('hotel-ops-notification-read-ids', [])
  const [dismissedIds, setDismissedIds] = useKV<string[]>('hotel-ops-notification-dismissed-ids', [])

  const refresh = useCallback(async () => {
    if (!canLoadOpsNotifications) {
      setServerNotifications([])
      setLoadError(null)
      return
    }

    setLoading(true)
    try {
      const payload = await hotelOpsApi.listNotifications({ limit: 30 })
      setServerNotifications(payload.data)
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Hotel Ops notifications could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [canLoadOpsNotifications])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const notifications = useMemo(
    () => serverNotifications.map((notification) => toHotelOpsNotificationDisplay(notification, {
      readIds: readIds || [],
      dismissedIds: dismissedIds || [],
    })),
    [dismissedIds, readIds, serverNotifications],
  )

  const activeNotifications = useMemo(
    () => notifications.filter((notification) => !notification.dismissed),
    [notifications],
  )

  const unreadNotifications = useMemo(
    () => activeNotifications.filter((notification) => !notification.read),
    [activeNotifications],
  )

  const markAsRead = useCallback((notificationId: string) => {
    const backendId = hotelOpsNotificationBackendId(notificationId)
    setReadIds((current) => uniqueIds([...(current || []), backendId]))
  }, [setReadIds])

  const markAllAsRead = useCallback(() => {
    setReadIds((current) => uniqueIds([...(current || []), ...serverNotifications.map((notification) => notification.id)]))
  }, [serverNotifications, setReadIds])

  const dismissNotification = useCallback((notificationId: string) => {
    const backendId = hotelOpsNotificationBackendId(notificationId)
    setReadIds((current) => uniqueIds([...(current || []), backendId]))
    setDismissedIds((current) => uniqueIds([...(current || []), backendId]))
  }, [setDismissedIds, setReadIds])

  const clearAll = useCallback(() => {
    const activeIds = activeNotifications.map((notification) => hotelOpsNotificationBackendId(notification.id))
    setReadIds((current) => uniqueIds([...(current || []), ...activeIds]))
    setDismissedIds((current) => uniqueIds([...(current || []), ...activeIds]))
  }, [activeNotifications, setDismissedIds, setReadIds])

  return {
    notifications,
    activeNotifications,
    unreadNotifications,
    unreadCount: unreadNotifications.length,
    loading,
    loadError,
    refresh,
    markAsRead,
    markAllAsRead,
    dismissNotification,
    clearAll,
  }
}
