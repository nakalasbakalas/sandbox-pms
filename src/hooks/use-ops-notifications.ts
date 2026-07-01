import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { SERVER_AUTH_ENABLED } from '@/lib/auth-mode'
import { hotelOpsApi } from '@/lib/hotel-ops-api-client'
import {
  hotelOpsNotificationBackendId,
  toHotelOpsNotificationDisplay,
} from '@/lib/ops-notification-display'
import type { Notification } from '@/hooks/use-notifications'
import type { HotelOpsNotification } from '@/types/hotel-ops'

export type UseOpsNotificationsResult = {
  notifications: Notification[]
  activeNotifications: Notification[]
  unreadNotifications: Notification[]
  unreadCount: number
  loading: boolean
  loadError: string | null
  refresh: () => Promise<void>
  markAsRead: (notificationId: string) => Promise<void>
  markAllAsRead: () => Promise<void>
  dismissNotification: (notificationId: string) => Promise<void>
  clearAll: () => Promise<void>
}

export function useOpsNotifications(): UseOpsNotificationsResult {
  const { hasAnyPermission } = useAuth()
  const canLoadOpsNotifications = SERVER_AUTH_ENABLED && hasAnyPermission(['view:ops'])
  const [serverNotifications, setServerNotifications] = useState<HotelOpsNotification[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!canLoadOpsNotifications) {
      setServerNotifications([])
      setLoadError(null)
      return
    }

    setLoading(true)
    try {
      const payload = await hotelOpsApi.listNotifications({ dismissed: false, limit: 30 })
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

  const replaceNotification = useCallback((updatedNotification: HotelOpsNotification) => {
    setServerNotifications((current) => current.map((notification) =>
      notification.id === updatedNotification.id ? updatedNotification : notification
    ))
  }, [])

  const notifications = useMemo(
    () => serverNotifications.map((notification) => toHotelOpsNotificationDisplay(notification)),
    [serverNotifications],
  )

  const activeNotifications = useMemo(
    () => notifications.filter((notification) => !notification.dismissed),
    [notifications],
  )

  const unreadNotifications = useMemo(
    () => activeNotifications.filter((notification) => !notification.read),
    [activeNotifications],
  )

  const markAsRead = useCallback(async (notificationId: string) => {
    const backendId = hotelOpsNotificationBackendId(notificationId)
    try {
      const payload = await hotelOpsApi.readNotification(backendId)
      replaceNotification(payload.data)
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Hotel Ops notification could not be marked read.')
    }
  }, [replaceNotification])

  const markAllAsRead = useCallback(async () => {
    const unreadIds = serverNotifications
      .filter((notification) => !notification.readAt && !notification.dismissedAt)
      .map((notification) => notification.id)
    if (unreadIds.length === 0) return
    try {
      const payloads = await Promise.all(unreadIds.map((notificationId) => hotelOpsApi.readNotification(notificationId)))
      setServerNotifications((current) => current.map((notification) => {
        const updated = payloads.find((payload) => payload.data.id === notification.id)?.data
        return updated || notification
      }))
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Hotel Ops notifications could not be marked read.')
    }
  }, [serverNotifications])

  const dismissNotification = useCallback(async (notificationId: string) => {
    const backendId = hotelOpsNotificationBackendId(notificationId)
    try {
      const payload = await hotelOpsApi.dismissNotification(backendId)
      replaceNotification(payload.data)
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Hotel Ops notification could not be dismissed.')
    }
  }, [replaceNotification])

  const clearAll = useCallback(async () => {
    const activeIds = activeNotifications.map((notification) => hotelOpsNotificationBackendId(notification.id))
    if (activeIds.length === 0) return
    try {
      const payloads = await Promise.all(activeIds.map((notificationId) => hotelOpsApi.dismissNotification(notificationId)))
      setServerNotifications((current) => current.map((notification) => {
        const updated = payloads.find((payload) => payload.data.id === notification.id)?.data
        return updated || notification
      }))
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Hotel Ops notifications could not be dismissed.')
    }
  }, [activeNotifications])

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
