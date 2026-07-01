import { useKV } from '@github/spark/hooks'
import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'

export type NotificationPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
export type NotificationType = 
  | 'HOUSEKEEPING_URGENT'
  | 'MAINTENANCE_URGENT' 
  | 'ARRIVAL_IMMINENT'
  | 'CHECKOUT_DELAYED'
  | 'ROOM_BLOCKED'
  | 'GUEST_REQUEST'
  | 'SYSTEM_ALERT'
  | 'HOTEL_OPS'

export interface Notification {
  id: string
  type: NotificationType
  priority: NotificationPriority
  title: string
  message: string
  roomNumber?: string
  roomId?: string
  timestamp: Date
  read: boolean
  dismissed: boolean
  actionRequired: boolean
  actionUrl?: string
  actionLabel?: string
  metadata?: Record<string, any>
}

export function useNotifications() {
  const [notifications, setNotifications] = useKV<Notification[]>('housekeeping-notifications', [])
  const [unreadCount, setUnreadCount] = useState(0)
  const [soundEnabled, setSoundEnabled] = useKV<boolean>('notification-sound-enabled', true)

  useEffect(() => {
    const unread = (notifications || []).filter(n => !n.read && !n.dismissed).length
    setUnreadCount(unread)
  }, [notifications])

  const addNotification = useCallback((notification: Omit<Notification, 'id' | 'timestamp' | 'read' | 'dismissed'>) => {
    const newNotification: Notification = {
      ...notification,
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      read: false,
      dismissed: false
    }

    setNotifications((current) => {
      const updated = [newNotification, ...(current || [])]
      return updated.slice(0, 100)
    })

    if (soundEnabled && (notification.priority === 'URGENT' || notification.priority === 'HIGH')) {
      playNotificationSound(notification.priority)
    }

    if (notification.priority === 'URGENT') {
      toast.error(notification.title, {
        description: notification.message,
        duration: 8000,
      })
    } else if (notification.priority === 'HIGH') {
      toast.warning(notification.title, {
        description: notification.message,
        duration: 5000,
      })
    }

    return newNotification.id
  }, [setNotifications, soundEnabled])

  const markAsRead = useCallback((notificationId: string) => {
    setNotifications((current) => 
      (current || []).map(n => 
        n.id === notificationId ? { ...n, read: true } : n
      )
    )
  }, [setNotifications])

  const markAllAsRead = useCallback(() => {
    setNotifications((current) => 
      (current || []).map(n => ({ ...n, read: true }))
    )
  }, [setNotifications])

  const dismissNotification = useCallback((notificationId: string) => {
    setNotifications((current) => 
      (current || []).map(n => 
        n.id === notificationId ? { ...n, dismissed: true, read: true } : n
      )
    )
  }, [setNotifications])

  const clearDismissed = useCallback(() => {
    setNotifications((current) => 
      (current || []).filter(n => !n.dismissed)
    )
  }, [setNotifications])

  const clearAll = useCallback(() => {
    setNotifications([])
  }, [setNotifications])

  const getActiveNotifications = useCallback(() => {
    return (notifications || []).filter(n => !n.dismissed).sort((a, b) => {
      const priorityOrder = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority]
      }
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    })
  }, [notifications])

  const getUnreadNotifications = useCallback(() => {
    return getActiveNotifications().filter(n => !n.read)
  }, [getActiveNotifications])

  const toggleSound = useCallback(() => {
    setSoundEnabled((current) => !current)
  }, [setSoundEnabled])

  return {
    notifications: notifications || [],
    activeNotifications: getActiveNotifications(),
    unreadNotifications: getUnreadNotifications(),
    unreadCount,
    soundEnabled,
    addNotification,
    markAsRead,
    markAllAsRead,
    dismissNotification,
    clearDismissed,
    clearAll,
    toggleSound,
  }
}

function playNotificationSound(priority: NotificationPriority) {
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
  const oscillator = audioContext.createOscillator()
  const gainNode = audioContext.createGain()

  oscillator.connect(gainNode)
  gainNode.connect(audioContext.destination)

  if (priority === 'URGENT') {
    oscillator.frequency.value = 880
    gainNode.gain.value = 0.3

    oscillator.start()
    setTimeout(() => {
      oscillator.frequency.value = 660
    }, 150)
    setTimeout(() => {
      oscillator.frequency.value = 880
    }, 300)
    setTimeout(() => {
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5)
      oscillator.stop(audioContext.currentTime + 0.5)
    }, 450)
  } else {
    oscillator.frequency.value = 523.25
    gainNode.gain.value = 0.2

    oscillator.start()
    setTimeout(() => {
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3)
      oscillator.stop(audioContext.currentTime + 0.3)
    }, 100)
  }
}
