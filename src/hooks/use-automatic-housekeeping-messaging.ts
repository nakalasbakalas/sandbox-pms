import { useEffect, useCallback } from 'react'
import { useKV } from '@github/spark/hooks'
import { toast } from 'sonner'
import type { BoardRoomCard } from '@/types/board'
import type { InternalMessage, StaffDepartment } from '@/types/messaging'
import { format } from 'date-fns'

export interface HousekeepingAutomationConfig {
  enabled: boolean
  checkOutNotifications: boolean
  earlyCheckInNotifications: boolean
  maintenanceRequestNotifications: boolean
  priorityRoomNotifications: boolean
  noShowNotifications: boolean
  extendedStayNotifications: boolean
}

export interface AutomatedMessageLog {
  id: string
  roomNumber: string
  trigger: 'CHECK_OUT' | 'EARLY_CHECK_IN' | 'MAINTENANCE' | 'PRIORITY' | 'NO_SHOW' | 'EXTENDED_STAY'
  message: string
  sentAt: Date
  guestName?: string
}

const DEFAULT_CONFIG: HousekeepingAutomationConfig = {
  enabled: true,
  checkOutNotifications: true,
  earlyCheckInNotifications: true,
  maintenanceRequestNotifications: true,
  priorityRoomNotifications: true,
  noShowNotifications: true,
  extendedStayNotifications: true,
}

export function useAutomaticHousekeepingMessaging(rooms: BoardRoomCard[]) {
  const [config, setConfig] = useKV<HousekeepingAutomationConfig>('housekeeping-automation-config', DEFAULT_CONFIG)
  const [messages, setMessages] = useKV<InternalMessage[]>('internal-messages', [])
  const [messageLog, setMessageLog] = useKV<AutomatedMessageLog[]>('automated-message-log', [])
  const [lastProcessed, setLastProcessed] = useKV<Record<string, Date>>('automation-last-processed', {})

  const sendAutomatedMessage = useCallback((
    roomNumber: string,
    trigger: AutomatedMessageLog['trigger'],
    body: string,
    priority: 'NORMAL' | 'HIGH' | 'URGENT' = 'NORMAL',
    guestName?: string
  ) => {
    const newMessage: InternalMessage = {
      id: `auto-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'CHANNEL',
      priority,
      senderId: 'system',
      senderName: 'Automated System',
      senderDepartment: 'MANAGEMENT',
      channelId: 'housekeeping',
      channelName: 'housekeeping',
      department: 'HOUSEKEEPING',
      subject: `🤖 Automatic: ${trigger.replace(/_/g, ' ')} - Room ${roomNumber}`,
      body,
      isRead: false,
      readBy: [],
      isPinned: false,
      isUrgent: priority === 'URGENT',
      requiresAcknowledgment: priority === 'URGENT',
      acknowledgedBy: [],
      mentions: [],
      tags: ['automated', trigger.toLowerCase()],
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    setMessages((current) => [newMessage, ...current])

    const logEntry: AutomatedMessageLog = {
      id: newMessage.id,
      roomNumber,
      trigger,
      message: body,
      sentAt: new Date(),
      guestName,
    }

    setMessageLog((current) => [logEntry, ...current])

    return newMessage
  }, [setMessages, setMessageLog])

  const processCheckOutNotifications = useCallback(() => {
    if (!config.checkOutNotifications) return

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    rooms.forEach((room) => {
      if (room.status === 'DEPARTING' || (room.checkOut && 
          room.checkOut.getTime() === today.getTime())) {
        
        const lastProcessedKey = `checkout-${room.roomId}-${format(today, 'yyyy-MM-dd')}`
        if (lastProcessed[lastProcessedKey]) return

        const message = `🚪 Guest ${room.guestName || 'Unknown'} is checking out from Room ${room.roomNumber} today.\n\n` +
          `✅ Please prioritize cleaning this room for next arrival.\n` +
          `📅 Check-out time: ${format(room.checkOut || new Date(), 'h:mm a')}\n\n` +
          `Room type: ${room.roomType}\n` +
          `Next status: ${room.nextReservation ? 'Occupied' : 'Vacant'}`

        sendAutomatedMessage(
          room.roomNumber,
          'CHECK_OUT',
          message,
          room.isVIP ? 'HIGH' : 'NORMAL',
          room.guestName
        )

        setLastProcessed((current) => ({
          ...current,
          [lastProcessedKey]: new Date()
        }))

        toast.success(`Housekeeping notified: Room ${room.roomNumber} checkout`)
      }
    })
  }, [rooms, config, lastProcessed, sendAutomatedMessage, setLastProcessed])

  const processEarlyCheckInNotifications = useCallback(() => {
    if (!config.earlyCheckInNotifications) return

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    rooms.forEach((room) => {
      if (room.status === 'ARRIVING' && room.checkIn) {
        const checkInToday = room.checkIn.getTime() === today.getTime()
        
        if (checkInToday && room.housekeepingStatus !== 'CLEAN') {
          const lastProcessedKey = `arrival-${room.roomId}-${format(today, 'yyyy-MM-dd')}`
          if (lastProcessed[lastProcessedKey]) return

          const message = `🔑 Early check-in expected for Room ${room.roomNumber}!\n\n` +
            `Guest: ${room.guestName || 'Unknown'}\n` +
            `Expected arrival: ${format(room.checkIn, 'h:mm a')}\n` +
            `Current status: ${room.housekeepingStatus || 'DIRTY'}\n\n` +
            `⚡ Please clean and prepare ASAP for early arrival.`

          sendAutomatedMessage(
            room.roomNumber,
            'EARLY_CHECK_IN',
            message,
            'HIGH',
            room.guestName
          )

          setLastProcessed((current) => ({
            ...current,
            [lastProcessedKey]: new Date()
          }))

          toast.info(`Priority cleaning: Room ${room.roomNumber}`)
        }
      }
    })
  }, [rooms, config, lastProcessed, sendAutomatedMessage, setLastProcessed])

  const processMaintenanceNotifications = useCallback(() => {
    if (!config.maintenanceRequestNotifications) return

    rooms.forEach((room) => {
      if (room.maintenanceIssue) {
        const lastProcessedKey = `maintenance-${room.roomId}-${room.maintenanceIssue}`
        if (lastProcessed[lastProcessedKey]) return

        const message = `🔧 Maintenance issue reported in Room ${room.roomNumber}\n\n` +
          `Issue: ${room.maintenanceIssue}\n` +
          `Status: ${room.status}\n` +
          `Guest: ${room.guestName || 'Vacant'}\n\n` +
          `⚠️ Please coordinate with maintenance team and update room status once resolved.`

        sendAutomatedMessage(
          room.roomNumber,
          'MAINTENANCE',
          message,
          'HIGH'
        )

        setLastProcessed((current) => ({
          ...current,
          [lastProcessedKey]: new Date()
        }))
      }
    })
  }, [rooms, config, lastProcessed, sendAutomatedMessage, setLastProcessed])

  const processPriorityRoomNotifications = useCallback(() => {
    if (!config.priorityRoomNotifications) return

    rooms.forEach((room) => {
      if (room.isVIP && room.housekeepingStatus !== 'CLEAN') {
        const today = format(new Date(), 'yyyy-MM-dd')
        const lastProcessedKey = `vip-${room.roomId}-${today}`
        if (lastProcessed[lastProcessedKey]) return

        const message = `⭐ VIP Room ${room.roomNumber} requires attention\n\n` +
          `Guest: ${room.guestName || 'Incoming VIP'}\n` +
          `Status: ${room.status}\n` +
          `Housekeeping: ${room.housekeepingStatus || 'DIRTY'}\n\n` +
          `👑 Please ensure exceptional cleaning standards and amenities.`

        sendAutomatedMessage(
          room.roomNumber,
          'PRIORITY',
          message,
          'HIGH',
          room.guestName
        )

        setLastProcessed((current) => ({
          ...current,
          [lastProcessedKey]: new Date()
        }))
      }
    })
  }, [rooms, config, lastProcessed, sendAutomatedMessage, setLastProcessed])

  const processNoShowNotifications = useCallback(() => {
    if (!config.noShowNotifications) return

    const now = new Date()
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    rooms.forEach((room) => {
      if (room.status === 'ARRIVING' && room.checkIn) {
        const checkInToday = room.checkIn.getTime() === today.getTime()
        const checkInTime = new Date(room.checkIn)
        checkInTime.setHours(15, 0, 0, 0)
        
        if (checkInToday && now > checkInTime && room.housekeepingStatus !== 'CLEAN') {
          const lastProcessedKey = `noshow-${room.roomId}-${format(today, 'yyyy-MM-dd')}`
          if (lastProcessed[lastProcessedKey]) return

          const message = `❓ Possible no-show for Room ${room.roomNumber}\n\n` +
            `Guest: ${room.guestName || 'Unknown'}\n` +
            `Expected: ${format(room.checkIn, 'h:mm a')}\n` +
            `Current time: ${format(now, 'h:mm a')}\n\n` +
            `Please check with front desk before cleaning this room.`

          sendAutomatedMessage(
            room.roomNumber,
            'NO_SHOW',
            message,
            'NORMAL',
            room.guestName
          )

          setLastProcessed((current) => ({
            ...current,
            [lastProcessedKey]: new Date()
          }))
        }
      }
    })
  }, [rooms, config, lastProcessed, sendAutomatedMessage, setLastProcessed])

  const processExtendedStayNotifications = useCallback(() => {
    if (!config.extendedStayNotifications) return

    rooms.forEach((room) => {
      if (room.status === 'OCCUPIED' && room.extendedStay) {
        const today = format(new Date(), 'yyyy-MM-dd')
        const lastProcessedKey = `extended-${room.roomId}-${today}`
        if (lastProcessed[lastProcessedKey]) return

        const message = `📅 Extended stay confirmed for Room ${room.roomNumber}\n\n` +
          `Guest: ${room.guestName || 'Unknown'}\n` +
          `Original checkout: ${room.checkOut ? format(room.checkOut, 'MMM d') : 'N/A'}\n` +
          `New checkout: ${room.checkOut ? format(room.checkOut, 'MMM d') : 'N/A'}\n\n` +
          `Please adjust cleaning schedule accordingly.`

        sendAutomatedMessage(
          room.roomNumber,
          'EXTENDED_STAY',
          message,
          'NORMAL',
          room.guestName
        )

        setLastProcessed((current) => ({
          ...current,
          [lastProcessedKey]: new Date()
        }))
      }
    })
  }, [rooms, config, lastProcessed, sendAutomatedMessage, setLastProcessed])

  useEffect(() => {
    if (!config.enabled) return

    const interval = setInterval(() => {
      processCheckOutNotifications()
      processEarlyCheckInNotifications()
      processMaintenanceNotifications()
      processPriorityRoomNotifications()
      processNoShowNotifications()
      processExtendedStayNotifications()
    }, 60000)

    processCheckOutNotifications()
    processEarlyCheckInNotifications()
    processMaintenanceNotifications()
    processPriorityRoomNotifications()
    processNoShowNotifications()
    processExtendedStayNotifications()

    return () => clearInterval(interval)
  }, [
    config.enabled,
    processCheckOutNotifications,
    processEarlyCheckInNotifications,
    processMaintenanceNotifications,
    processPriorityRoomNotifications,
    processNoShowNotifications,
    processExtendedStayNotifications
  ])

  const triggerManualCheckOut = useCallback((room: BoardRoomCard) => {
    if (!config.enabled) {
      toast.error('Automated messaging is disabled')
      return
    }

    const message = `🚪 Manual checkout notification for Room ${room.roomNumber}\n\n` +
      `Guest: ${room.guestName || 'Unknown'}\n` +
      `Check-out: ${room.checkOut ? format(room.checkOut, 'MMM d, h:mm a') : 'Now'}\n\n` +
      `✅ Please clean and prepare this room immediately.`

    sendAutomatedMessage(
      room.roomNumber,
      'CHECK_OUT',
      message,
      room.isVIP ? 'HIGH' : 'NORMAL',
      room.guestName
    )

    toast.success(`Housekeeping notified for Room ${room.roomNumber}`)
  }, [config.enabled, sendAutomatedMessage])

  const triggerManualMaintenance = useCallback((room: BoardRoomCard, issue: string) => {
    if (!config.enabled) {
      toast.error('Automated messaging is disabled')
      return
    }

    const message = `🔧 Maintenance issue reported in Room ${room.roomNumber}\n\n` +
      `Issue: ${issue}\n` +
      `Reported by: Manual entry\n` +
      `Status: ${room.status}\n\n` +
      `⚠️ Please coordinate with maintenance and update status.`

    sendAutomatedMessage(
      room.roomNumber,
      'MAINTENANCE',
      message,
      'URGENT'
    )

    toast.success(`Maintenance alert sent for Room ${room.roomNumber}`)
  }, [config.enabled, sendAutomatedMessage])

  return {
    config,
    setConfig,
    messageLog,
    triggerManualCheckOut,
    triggerManualMaintenance,
    sendAutomatedMessage,
  }
}
