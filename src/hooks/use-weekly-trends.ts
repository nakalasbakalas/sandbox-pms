import { useKV } from '@github/spark/hooks'
import { useCallback, useMemo } from 'react'
import type { 
  WeeklyPerformanceMetrics,
  WeeklyTrends,
  DailySummaryReport 
} from '@/types/daily-summary'

export function useWeeklyTrends() {
  const [historicalMetrics, setHistoricalMetrics] = useKV<WeeklyPerformanceMetrics[]>(
    'weekly-performance-history',
    []
  )

  const recordDailyMetrics = useCallback((report: DailySummaryReport) => {
    const metrics: WeeklyPerformanceMetrics = {
      date: report.reportDate,
      readinessScore: report.readinessScore.score,
      cleanRoomPercentage: report.roomStatus.total > 0 
        ? ((report.roomStatus.clean + report.roomStatus.inspected) / report.roomStatus.total) * 100 
        : 100,
      arrivalReadiness: report.todaySchedule.readinessPercentage,
      housekeepingCompletionRate: report.housekeepingProgress.totalTasks > 0
        ? (report.housekeepingProgress.completed / report.housekeepingProgress.totalTasks) * 100
        : 100,
      maintenanceIssues: report.maintenanceIssues.total,
      totalRooms: report.roomStatus.total,
      arrivals: report.todaySchedule.arrivals,
      departures: report.todaySchedule.departures,
      averageCleanTime: report.housekeepingProgress.averageCompletionTime,
    }

    setHistoricalMetrics((current) => {
      const updated = [...(current || []), metrics]
      return updated.slice(-90)
    })
  }, [setHistoricalMetrics])

  const weeklyTrends = useMemo((): WeeklyTrends | null => {
    if (!historicalMetrics || historicalMetrics.length < 2) {
      return null
    }

    const now = new Date()
    const currentWeekStart = new Date(now)
    currentWeekStart.setDate(now.getDate() - now.getDay())
    currentWeekStart.setHours(0, 0, 0, 0)

    const previousWeekStart = new Date(currentWeekStart)
    previousWeekStart.setDate(currentWeekStart.getDate() - 7)

    const currentWeekMetrics = historicalMetrics.filter(m => {
      const date = new Date(m.date)
      return date >= currentWeekStart && date < now
    })

    const previousWeekMetrics = historicalMetrics.filter(m => {
      const date = new Date(m.date)
      return date >= previousWeekStart && date < currentWeekStart
    })

    if (currentWeekMetrics.length === 0) {
      return null
    }

    const calculateAverage = (metrics: WeeklyPerformanceMetrics[], key: keyof WeeklyPerformanceMetrics): number => {
      if (metrics.length === 0) return 0
      const sum = metrics.reduce((acc, m) => acc + (m[key] as number), 0)
      return sum / metrics.length
    }

    const calculateSum = (metrics: WeeklyPerformanceMetrics[], key: keyof WeeklyPerformanceMetrics): number => {
      return metrics.reduce((acc, m) => acc + (m[key] as number), 0)
    }

    const getTrend = (current: number, previous: number, higherIsBetter = true) => {
      const change = current - previous
      const threshold = 2
      
      if (Math.abs(change) < threshold) {
        return 'stable' as const
      }
      
      if (higherIsBetter) {
        return change > 0 ? 'up' as const : 'down' as const
      } else {
        return change > 0 ? 'down' as const : 'up' as const
      }
    }

    const currentReadiness = calculateAverage(currentWeekMetrics, 'readinessScore')
    const previousReadiness = calculateAverage(previousWeekMetrics, 'readinessScore')
    
    const currentCleanRoom = calculateAverage(currentWeekMetrics, 'cleanRoomPercentage')
    const previousCleanRoom = calculateAverage(previousWeekMetrics, 'cleanRoomPercentage')
    
    const currentHousekeeping = calculateAverage(currentWeekMetrics, 'housekeepingCompletionRate')
    const previousHousekeeping = calculateAverage(previousWeekMetrics, 'housekeepingCompletionRate')
    
    const currentMaintenance = calculateAverage(currentWeekMetrics, 'maintenanceIssues')
    const previousMaintenance = calculateAverage(previousWeekMetrics, 'maintenanceIssues')

    const currentOccupancyRate = currentWeekMetrics.length > 0
      ? (calculateSum(currentWeekMetrics, 'arrivals') / (currentWeekMetrics[0].totalRooms * currentWeekMetrics.length)) * 100
      : 0
    
    const previousOccupancyRate = previousWeekMetrics.length > 0 && previousWeekMetrics[0]
      ? (calculateSum(previousWeekMetrics, 'arrivals') / (previousWeekMetrics[0].totalRooms * previousWeekMetrics.length)) * 100
      : 0

    const insights: string[] = []

    if (currentReadiness - previousReadiness >= 5) {
      insights.push(`Readiness score improved by ${(currentReadiness - previousReadiness).toFixed(1)}% this week`)
    } else if (previousReadiness - currentReadiness >= 5) {
      insights.push(`Readiness score declined by ${(previousReadiness - currentReadiness).toFixed(1)}% - attention needed`)
    }

    if (currentHousekeeping > 90) {
      insights.push('Housekeeping team maintaining excellent completion rate')
    } else if (currentHousekeeping < 70) {
      insights.push('Housekeeping completion rate below target - consider additional support')
    }

    if (currentMaintenance > previousMaintenance + 2) {
      insights.push(`Maintenance issues increased by ${Math.round(currentMaintenance - previousMaintenance)} - proactive inspection recommended`)
    } else if (currentMaintenance < previousMaintenance - 2) {
      insights.push('Maintenance issues decreasing - preventive efforts paying off')
    }

    if (currentOccupancyRate > previousOccupancyRate + 5) {
      insights.push(`Occupancy increased ${(currentOccupancyRate - previousOccupancyRate).toFixed(1)}% week-over-week`)
    }

    const avgCleanTime = calculateAverage(currentWeekMetrics, 'averageCleanTime')
    if (avgCleanTime < 35) {
      insights.push('Room turnaround time excellent - under 35 minutes average')
    } else if (avgCleanTime > 60) {
      insights.push('Room turnaround time above 60 minutes - efficiency review needed')
    }

    if (insights.length === 0) {
      insights.push('Operations stable - metrics within normal ranges')
    }

    return {
      currentWeek: currentWeekMetrics,
      previousWeek: previousWeekMetrics,
      trends: {
        readinessScore: {
          current: currentReadiness,
          previous: previousReadiness,
          change: currentReadiness - previousReadiness,
          trend: getTrend(currentReadiness, previousReadiness, true),
        },
        cleanRoomPercentage: {
          current: currentCleanRoom,
          previous: previousCleanRoom,
          change: currentCleanRoom - previousCleanRoom,
          trend: getTrend(currentCleanRoom, previousCleanRoom, true),
        },
        housekeepingEfficiency: {
          current: currentHousekeeping,
          previous: previousHousekeeping,
          change: currentHousekeeping - previousHousekeeping,
          trend: getTrend(currentHousekeeping, previousHousekeeping, true),
        },
        maintenanceIssues: {
          current: currentMaintenance,
          previous: previousMaintenance,
          change: currentMaintenance - previousMaintenance,
          trend: getTrend(currentMaintenance, previousMaintenance, false),
        },
        occupancyRate: {
          current: currentOccupancyRate,
          previous: previousOccupancyRate,
          change: currentOccupancyRate - previousOccupancyRate,
          trend: getTrend(currentOccupancyRate, previousOccupancyRate, true),
        },
      },
      insights,
    }
  }, [historicalMetrics])

  return {
    weeklyTrends,
    recordDailyMetrics,
    historicalMetrics: historicalMetrics || [],
  }
}
