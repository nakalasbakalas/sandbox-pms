import { useKV } from '@github/spark/hooks'
import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import type { 
  RoomReadyNotificationSettings, 
  RoomReadyNotificationLog,
  DEFAULT_ROOM_READY_SETTINGS 
} from '@/types/room-ready-notification'
import type { StaffMember } from '@/types/staff-alerts'
import type { HousekeepingRoom, CleanStatus } from '@/types/housekeeping'

export function useRoomReadyNotifications() {
  const [settings, setSettings] = useKV<RoomReadyNotificationSettings>(
    'room-ready-notification-settings',
    {
      enabled: true,
      notifyOnClean: true,
      notifyOnInspected: true,
      onlyForArrivals: true,
      channels: { line: true, email: false },
      recipients: { roles: ['FRONT_DESK', 'MANAGER'], staffIds: [] },
      messageTemplate: {
        title: '✅ Room {{roomNumber}} Ready',
        body: 'Room {{roomNumber}} is now {{status}} and ready for the next guest{{arrivalInfo}}.',
      },
      throttle: { enabled: true, minMinutesBetweenNotifications: 5 },
      schedule: {
        enabled: true,
        startTime: '06:00',
        endTime: '23:00',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      },
    }
  )
  
  const [notificationLogs, setNotificationLogs] = useKV<RoomReadyNotificationLog[]>(
    'room-ready-notification-logs',
    []
  )
  
  const [staffMembers] = useKV<StaffMember[]>('staff-members', [])

  const checkThrottle = useCallback((roomId: string): boolean => {
    if (!settings?.throttle.enabled) return true
    
    const recentLogs = (notificationLogs || [])
      .filter(log => log.roomId === roomId && log.notificationSent)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    
    if (recentLogs.length === 0) return true
    
    const lastNotification = recentLogs[0]
    const timeSinceLastMs = Date.now() - new Date(lastNotification.createdAt).getTime()
    const minMsBetween = settings.throttle.minMinutesBetweenNotifications * 60 * 1000
    
    return timeSinceLastMs >= minMsBetween
  }, [settings, notificationLogs])

  const checkSchedule = useCallback((): boolean => {
    if (!settings?.schedule.enabled) return true
    
    const now = new Date()
    const currentDay = now.getDay()
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
    
    if (!settings.schedule.daysOfWeek.includes(currentDay)) {
      return false
    }
    
    if (currentTime < settings.schedule.startTime || currentTime > settings.schedule.endTime) {
      return false
    }
    
    return true
  }, [settings])

  const getRecipients = useCallback((): StaffMember[] => {
    const activeStaff = (staffMembers || []).filter(s => s.active && s.receiveAlerts)
    
    const recipients = activeStaff.filter(staff => {
      const roleMatch = settings?.recipients.roles.includes(staff.role)
      const idMatch = settings?.recipients.staffIds.includes(staff.id)
      return roleMatch || idMatch
    })
    
    return recipients
  }, [staffMembers, settings])

  const sendNotification = useCallback(async (
    room: HousekeepingRoom,
    status: 'CLEAN' | 'INSPECTED'
  ): Promise<RoomReadyNotificationLog> => {
    
    if (!settings?.enabled) {
      const log: RoomReadyNotificationLog = {
        id: `log-${Date.now()}`,
        roomNumber: room.number,
        roomId: room.roomId,
        status,
        hasArrivalToday: room.isArrivalToday,
        arrivalTime: room.arrivalTime,
        guestName: room.guestName,
        notificationSent: false,
        sentVia: [],
        recipientCount: 0,
        suppressedReason: 'DISABLED',
        createdAt: new Date(),
      }
      
      setNotificationLogs((current) => [log, ...(current || [])].slice(0, 100))
      return log
    }

    if (settings.onlyForArrivals && !room.isArrivalToday) {
      const log: RoomReadyNotificationLog = {
        id: `log-${Date.now()}`,
        roomNumber: room.number,
        roomId: room.roomId,
        status,
        hasArrivalToday: false,
        notificationSent: false,
        sentVia: [],
        recipientCount: 0,
        suppressedReason: 'NO_ARRIVAL',
        createdAt: new Date(),
      }
      
      setNotificationLogs((current) => [log, ...(current || [])].slice(0, 100))
      return log
    }

    if (!checkSchedule()) {
      const log: RoomReadyNotificationLog = {
        id: `log-${Date.now()}`,
        roomNumber: room.number,
        roomId: room.roomId,
        status,
        hasArrivalToday: room.isArrivalToday,
        arrivalTime: room.arrivalTime,
        guestName: room.guestName,
        notificationSent: false,
        sentVia: [],
        recipientCount: 0,
        suppressedReason: 'SCHEDULE',
        createdAt: new Date(),
      }
      
      setNotificationLogs((current) => [log, ...(current || [])].slice(0, 100))
      return log
    }

    if (!checkThrottle(room.roomId)) {
      const log: RoomReadyNotificationLog = {
        id: `log-${Date.now()}`,
        roomNumber: room.number,
        roomId: room.roomId,
        status,
        hasArrivalToday: room.isArrivalToday,
        arrivalTime: room.arrivalTime,
        guestName: room.guestName,
        notificationSent: false,
        sentVia: [],
        recipientCount: 0,
        suppressedReason: 'THROTTLED',
        createdAt: new Date(),
      }
      
      setNotificationLogs((current) => [log, ...(current || [])].slice(0, 100))
      return log
    }

    const recipients = getRecipients()
    
    if (recipients.length === 0) {
      const log: RoomReadyNotificationLog = {
        id: `log-${Date.now()}`,
        roomNumber: room.number,
        roomId: room.roomId,
        status,
        hasArrivalToday: room.isArrivalToday,
        arrivalTime: room.arrivalTime,
        guestName: room.guestName,
        notificationSent: false,
        sentVia: [],
        recipientCount: 0,
        suppressedReason: 'NO_RECIPIENTS',
        createdAt: new Date(),
      }
      
      setNotificationLogs((current) => [log, ...(current || [])].slice(0, 100))
      return log
    }

    const arrivalInfo = room.isArrivalToday 
      ? ` (Arrival at ${room.arrivalTime}${room.guestName ? ` - ${room.guestName}` : ''})`
      : ''
    
    const title = settings.messageTemplate.title
      .replace('{{roomNumber}}', room.number)
      .replace('{{status}}', status)
    
    const body = settings.messageTemplate.body
      .replace('{{roomNumber}}', room.number)
      .replace('{{status}}', status.toLowerCase())
      .replace('{{arrivalInfo}}', arrivalInfo)

    const sentVia: ('line' | 'email')[] = []
    
    if (settings.channels.line) {
      const lineRecipients = recipients.filter(r => r.lineUserId)
      if (lineRecipients.length > 0) {
        sentVia.push('line')
      }
    }
    
    if (settings.channels.email) {
      const emailRecipients = recipients.filter(r => r.email)
      if (emailRecipients.length > 0) {
        sentVia.push('email')
      }
    }

    const log: RoomReadyNotificationLog = {
      id: `log-${Date.now()}`,
      roomNumber: room.number,
      roomId: room.roomId,
      status,
      hasArrivalToday: room.isArrivalToday,
      arrivalTime: room.arrivalTime,
      guestName: room.guestName,
      notificationSent: true,
      sentAt: new Date(),
      sentVia,
      recipientCount: recipients.length,
      createdAt: new Date(),
    }

    setNotificationLogs((current) => [log, ...(current || [])].slice(0, 100))

    toast.success('Room Ready Notification Sent', {
      description: `${recipients.length} staff notified via ${sentVia.join(', ').toUpperCase()}`,
      duration: 4000,
    })

    return log
  }, [settings, checkSchedule, checkThrottle, getRecipients, setNotificationLogs])

  const shouldNotify = useCallback((status: CleanStatus): boolean => {
    if (!settings?.enabled) return false
    
    if (status === 'CLEAN' && !settings.notifyOnClean) return false
    if (status === 'INSPECTED' && !settings.notifyOnInspected) return false
    
    return true
  }, [settings])

  return {
    settings,
    setSettings,
    notificationLogs: notificationLogs || [],
    sendNotification,
    shouldNotify,
    getRecipients,
  }
}
