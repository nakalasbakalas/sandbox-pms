import { useKV } from '@github/spark/hooks'
import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import type { 
  DailySummarySettings,
  DailySummaryReport,
  DailySummaryLog,
  DailySummaryAlert,
  DailySummaryRoomDetail,
  DEFAULT_DAILY_SUMMARY_SETTINGS
} from '@/types/daily-summary'
import type { StaffMember } from '@/types/staff-alerts'
import type { BoardRoomCard } from '@/types/board'
import type { HousekeepingRoom } from '@/types/housekeeping'

export function useDailySummary() {
  const [settings, setSettings] = useKV<DailySummarySettings>(
    'daily-summary-settings',
    {
      enabled: true,
      schedule: { time: '07:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] },
      channels: { line: true, email: true },
      recipients: { roles: ['MANAGER', 'FRONT_DESK'], staffIds: [] },
      includeMetrics: {
        roomStatus: true,
        housekeepingProgress: true,
        arrivalsAndDepartures: true,
        maintenanceIssues: true,
        readinessScore: true,
      },
      thresholds: { lowReadinessWarning: 80, highPriorityRoomCount: 3 },
    }
  )
  
  const [reportLogs, setReportLogs] = useKV<DailySummaryLog[]>('daily-summary-logs', [])
  const [lastGeneratedReport, setLastGeneratedReport] = useKV<DailySummaryReport | null>(
    'last-daily-summary-report',
    null
  )
  const [staffMembers] = useKV<StaffMember[]>('staff-members', [])
  const [rooms] = useKV<BoardRoomCard[]>('pms-rooms', [])

  const getRecipients = useCallback((): StaffMember[] => {
    const activeStaff = (staffMembers || []).filter(s => s.active && s.receiveAlerts)
    
    const recipients = activeStaff.filter(staff => {
      const roleMatch = settings?.recipients.roles.includes(staff.role)
      const idMatch = settings?.recipients.staffIds.includes(staff.id)
      return roleMatch || idMatch
    })
    
    return recipients
  }, [staffMembers, settings])

  const generateReport = useCallback((
    boardRooms: BoardRoomCard[],
    housekeepingRooms?: HousekeepingRoom[]
  ): DailySummaryReport => {
    const now = new Date()
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const roomStatus = {
      total: boardRooms.length,
      clean: boardRooms.filter(r => r.cleanStatus === 'CLEAN').length,
      inspected: boardRooms.filter(r => r.cleanStatus === 'INSPECTED').length,
      dirty: boardRooms.filter(r => r.cleanStatus === 'DIRTY').length,
      cleaning: 0,
      outOfService: boardRooms.filter(r => r.hasIssue).length,
    }

    const arrivalsToday = boardRooms.filter(r => {
      if (!r.checkIn) return false
      const checkInDate = new Date(r.checkIn)
      return checkInDate.getTime() >= today.getTime() && 
             checkInDate.getTime() < today.getTime() + 24 * 60 * 60 * 1000
    })

    const departuresToday = boardRooms.filter(r => {
      if (!r.checkOut) return false
      const checkOutDate = new Date(r.checkOut)
      return checkOutDate.getTime() >= today.getTime() && 
             checkOutDate.getTime() < today.getTime() + 24 * 60 * 60 * 1000
    })

    const roomsReadyForArrivals = arrivalsToday.filter(r => 
      r.cleanStatus === 'CLEAN' || r.cleanStatus === 'INSPECTED'
    ).length

    const readinessPercentage = arrivalsToday.length > 0
      ? Math.round((roomsReadyForArrivals / arrivalsToday.length) * 100)
      : 100

    const housekeepingProgress = {
      totalTasks: departuresToday.length,
      completed: departuresToday.filter(r => 
        r.cleanStatus === 'CLEAN' || r.cleanStatus === 'INSPECTED'
      ).length,
      inProgress: 0,
      notStarted: departuresToday.filter(r => r.cleanStatus === 'DIRTY').length,
      averageCompletionTime: 45,
    }

    const maintenanceIssues = {
      total: boardRooms.filter(r => r.hasIssue).length,
      urgent: 0,
      high: boardRooms.filter(r => r.hasIssue).length,
      roomsBlocked: boardRooms.filter(r => r.hasIssue).length,
      oldestIssueAge: 0,
    }

    const cleanRoomRatio = roomStatus.total > 0 
      ? (roomStatus.clean + roomStatus.inspected) / roomStatus.total * 100 
      : 100
    const arrivalReadiness = readinessPercentage
    const maintenanceHealth = maintenanceIssues.total > 0 
      ? Math.max(0, 100 - (maintenanceIssues.total * 10))
      : 100
    const housekeepingVelocity = housekeepingProgress.totalTasks > 0
      ? (housekeepingProgress.completed / housekeepingProgress.totalTasks) * 100
      : 100

    const readinessScore = {
      score: Math.round(
        (cleanRoomRatio * 0.3) +
        (arrivalReadiness * 0.4) +
        (maintenanceHealth * 0.15) +
        (housekeepingVelocity * 0.15)
      ),
      factors: {
        cleanRoomRatio,
        arrivalReadiness,
        maintenanceHealth,
        housekeepingVelocity,
      }
    }

    const alerts: DailySummaryAlert[] = []

    if (readinessScore.score < (settings?.thresholds.lowReadinessWarning || 80)) {
      alerts.push({
        severity: 'WARNING',
        category: 'OPERATIONS',
        message: `Readiness score is ${readinessScore.score}% - below threshold`,
        actionable: true,
      })
    }

    if (arrivalsToday.length > 0 && roomsReadyForArrivals < arrivalsToday.length) {
      const notReadyRooms = arrivalsToday
        .filter(r => r.cleanStatus !== 'CLEAN' && r.cleanStatus !== 'INSPECTED')
        .map(r => r.number)
      
      alerts.push({
        severity: 'CRITICAL',
        category: 'ARRIVALS',
        message: `${arrivalsToday.length - roomsReadyForArrivals} arrival room(s) not ready`,
        rooms: notReadyRooms,
        actionable: true,
      })
    }

    if (maintenanceIssues.urgent > 0 || maintenanceIssues.high > 0) {
      alerts.push({
        severity: 'WARNING',
        category: 'MAINTENANCE',
        message: `${maintenanceIssues.total} room(s) with maintenance issues`,
        actionable: true,
      })
    }

    if (departuresToday.length > 10) {
      alerts.push({
        severity: 'INFO',
        category: 'HOUSEKEEPING',
        message: `High checkout volume: ${departuresToday.length} departures today`,
        actionable: false,
      })
    }

    const roomDetails: DailySummaryRoomDetail[] = boardRooms
      .map(room => {
        const hasArrival = arrivalsToday.some(r => r.roomId === room.roomId)
        const hasDeparture = departuresToday.some(r => r.roomId === room.roomId)
        
        const needsAttention = 
          (hasArrival && room.cleanStatus !== 'CLEAN' && room.cleanStatus !== 'INSPECTED') ||
          room.hasIssue ||
          (hasDeparture && room.cleanStatus === 'DIRTY')

        let priority = 5
        if (hasDeparture && hasArrival) priority = 10
        else if (hasDeparture) priority = 8
        else if (hasArrival) priority = 7
        else if (room.cleanStatus === 'DIRTY') priority = 6

        const statusMap: Record<string, DailySummaryRoomDetail['status']> = {
          'CLEAN': 'CLEAN',
          'DIRTY': 'DIRTY',
          'INSPECTED': 'INSPECTED',
          'CLEANING': 'CLEANING',
        }

        return {
          roomNumber: room.number,
          status: room.hasIssue ? 'OUT_OF_SERVICE' : (statusMap[room.cleanStatus] || 'DIRTY'),
          hasArrival,
          hasDeparture,
          arrivalTime: hasArrival ? '14:00' : undefined,
          guestName: room.guestName,
          priority,
          needsAttention,
          notes: room.hasIssue ? 'Maintenance required' : undefined,
        }
      })
      .sort((a, b) => b.priority - a.priority)

    const report: DailySummaryReport = {
      id: `report-${Date.now()}`,
      generatedAt: now,
      reportDate: today,
      roomStatus,
      housekeepingProgress,
      todaySchedule: {
        departures: departuresToday.length,
        departuresCompleted: housekeepingProgress.completed,
        arrivals: arrivalsToday.length,
        roomsReadyForArrivals,
        readinessPercentage,
      },
      maintenanceIssues,
      readinessScore,
      alerts,
      roomDetails,
    }

    return report
  }, [settings])

  const sendReport = useCallback(async (
    report: DailySummaryReport
  ): Promise<DailySummaryLog> => {
    if (!settings?.enabled) {
      const log: DailySummaryLog = {
        id: `log-${Date.now()}`,
        reportDate: report.reportDate,
        generatedAt: report.generatedAt,
        sentVia: [],
        recipientCount: 0,
        deliveryStatus: 'FAILED',
        failureReason: 'Reports disabled',
        reportSummary: {
          cleanRooms: report.roomStatus.clean + report.roomStatus.inspected,
          dirtyRooms: report.roomStatus.dirty,
          arrivals: report.todaySchedule.arrivals,
          readinessScore: report.readinessScore.score,
        },
      }
      
      setReportLogs((current) => [log, ...(current || [])].slice(0, 50))
      return log
    }

    const recipients = getRecipients()
    
    if (recipients.length === 0) {
      const log: DailySummaryLog = {
        id: `log-${Date.now()}`,
        reportDate: report.reportDate,
        generatedAt: report.generatedAt,
        sentVia: [],
        recipientCount: 0,
        deliveryStatus: 'FAILED',
        failureReason: 'No recipients configured',
        reportSummary: {
          cleanRooms: report.roomStatus.clean + report.roomStatus.inspected,
          dirtyRooms: report.roomStatus.dirty,
          arrivals: report.todaySchedule.arrivals,
          readinessScore: report.readinessScore.score,
        },
      }
      
      setReportLogs((current) => [log, ...(current || [])].slice(0, 50))
      return log
    }

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

    const log: DailySummaryLog = {
      id: `log-${Date.now()}`,
      reportDate: report.reportDate,
      generatedAt: report.generatedAt,
      sentAt: new Date(),
      sentVia,
      recipientCount: recipients.length,
      deliveryStatus: 'SENT',
      reportSummary: {
        cleanRooms: report.roomStatus.clean + report.roomStatus.inspected,
        dirtyRooms: report.roomStatus.dirty,
        arrivals: report.todaySchedule.arrivals,
        readinessScore: report.readinessScore.score,
      },
    }

    setReportLogs((current) => [log, ...(current || [])].slice(0, 50))
    setLastGeneratedReport(report)

    toast.success('Daily Summary Sent', {
      description: `Report sent to ${recipients.length} staff via ${sentVia.join(', ').toUpperCase()}`,
      duration: 4000,
    })

    return log
  }, [settings, getRecipients, setReportLogs, setLastGeneratedReport])

  const generateAndSend = useCallback(async () => {
    const report = generateReport(rooms || [])
    return await sendReport(report)
  }, [generateReport, sendReport, rooms])

  const shouldGenerateToday = useCallback((): boolean => {
    if (!settings?.enabled) return false
    
    const now = new Date()
    const currentDay = now.getDay()
    
    if (!settings.schedule.daysOfWeek.includes(currentDay)) {
      return false
    }

    const [scheduleHour, scheduleMinute] = settings.schedule.time.split(':').map(Number)
    const currentHour = now.getHours()
    const currentMinute = now.getMinutes()
    
    const scheduledTimeInMinutes = scheduleHour * 60 + scheduleMinute
    const currentTimeInMinutes = currentHour * 60 + currentMinute
    
    const timeDiff = Math.abs(currentTimeInMinutes - scheduledTimeInMinutes)
    if (timeDiff > 15) return false

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const todayLogs = (reportLogs || []).filter(log => {
      const logDate = new Date(log.reportDate)
      logDate.setHours(0, 0, 0, 0)
      return logDate.getTime() === today.getTime() && log.deliveryStatus === 'SENT'
    })

    return todayLogs.length === 0
  }, [settings, reportLogs])

  useEffect(() => {
    if (!settings?.enabled) return

    const checkInterval = setInterval(() => {
      if (shouldGenerateToday()) {
        generateAndSend()
      }
    }, 5 * 60 * 1000)

    return () => clearInterval(checkInterval)
  }, [settings, shouldGenerateToday, generateAndSend])

  return {
    settings,
    setSettings,
    reportLogs: reportLogs || [],
    lastGeneratedReport,
    generateReport,
    sendReport,
    generateAndSend,
    getRecipients,
    shouldGenerateToday,
  }
}
