import { useEffect, useCallback, useRef } from 'react'
import { useKV } from '@github/spark/hooks'
import { toast } from 'sonner'
import { format, addDays, eachDayOfInterval, differenceInDays, startOfDay } from 'date-fns'

export interface RateSnapshot {
  roomTypeId: string
  date: string
  pmsRate: number
  channelRates: Record<string, number>
  lastChecked: string
}

export interface ParityViolation {
  id: string
  roomTypeId: string
  date: string
  pmsRate: number
  channelId: string
  channelRate: number
  variance: number
  variancePercent: number
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  status: 'DETECTED' | 'ACKNOWLEDGED' | 'RESOLVED' | 'IGNORED'
  detectedAt: string
  resolvedAt?: string
  resolvedBy?: string
}

export interface RateParityCheck {
  id: string
  timestamp: string
  roomTypeId: string
  dateRange: { start: string; end: string }
  channelsChecked: string[]
  violationsFound: number
  duration: number
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED'
  errors?: string[]
}

export interface RateParitySettings {
  autoCheckEnabled: boolean
  checkInterval: number
  alertThreshold: number
  channels: string[]
  roomTypes: string[]
}

export interface ChannelRateHealth {
  channelId: string
  channelName: string
  lastCheck: string
  violationCount: number
  averageVariance: number
  parityScore: number
  status: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR'
}

const DEFAULT_SETTINGS: RateParitySettings = {
  autoCheckEnabled: true,
  checkInterval: 3600000,
  alertThreshold: 5,
  channels: [],
  roomTypes: []
}

export function useRateParity() {
  const [rateSnapshots, setRateSnapshots] = useKV<RateSnapshot[]>('rate-snapshots', [])
  const [violations, setViolations] = useKV<ParityViolation[]>('parity-violations', [])
  const [parityChecks, setParityChecks] = useKV<RateParityCheck[]>('parity-checks', [])
  const [settings, setSettings] = useKV<RateParitySettings>('rate-parity-settings', DEFAULT_SETTINGS)
  
  const checkIntervalRef = useRef<NodeJS.Timeout>()

  const calculateSeverity = (variancePercent: number): ParityViolation['severity'] => {
    const absVariance = Math.abs(variancePercent)
    if (absVariance >= 15) return 'CRITICAL'
    if (absVariance >= 10) return 'HIGH'
    if (absVariance >= 5) return 'MEDIUM'
    return 'LOW'
  }

  const fetchChannelRate = async (
    channelId: string,
    roomTypeId: string,
    date: string
  ): Promise<number> => {
    await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 200))
    
    if (Math.random() > 0.98) {
      throw new Error('Rate fetch failed')
    }

    const baseRate = 2500
    const variance = (Math.random() - 0.5) * 0.15
    return Math.round(baseRate * (1 + variance))
  }

  const checkRateParity = useCallback(async (
    roomTypeId: string,
    startDate: string,
    endDate: string,
    channelIds: string[]
  ) => {
    const checkId = `check_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const startTime = Date.now()

    const check: RateParityCheck = {
      id: checkId,
      timestamp: new Date().toISOString(),
      roomTypeId,
      dateRange: { start: startDate, end: endDate },
      channelsChecked: channelIds,
      violationsFound: 0,
      duration: 0,
      status: 'SUCCESS'
    }

    const dates = eachDayOfInterval({
      start: new Date(startDate),
      end: new Date(endDate)
    })

    const newViolations: ParityViolation[] = []
    const errors: string[] = []

    for (const date of dates) {
      const dateStr = format(date, 'yyyy-MM-dd')
      
      const pmsRate = 2500

      const channelRates: Record<string, number> = {}
      
      for (const channelId of channelIds) {
        try {
          const rate = await fetchChannelRate(channelId, roomTypeId, dateStr)
          channelRates[channelId] = rate

          const variance = rate - pmsRate
          const variancePercent = (variance / pmsRate) * 100

          if (Math.abs(variancePercent) >= settings.alertThreshold) {
            const violation: ParityViolation = {
              id: `viol_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              roomTypeId,
              date: dateStr,
              pmsRate,
              channelId,
              channelRate: rate,
              variance,
              variancePercent,
              severity: calculateSeverity(variancePercent),
              status: 'DETECTED',
              detectedAt: new Date().toISOString()
            }
            newViolations.push(violation)
          }
        } catch (error) {
          errors.push(`${channelId}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }

      const snapshot: RateSnapshot = {
        roomTypeId,
        date: dateStr,
        pmsRate,
        channelRates,
        lastChecked: new Date().toISOString()
      }

      setRateSnapshots(current => {
        const filtered = current.filter(
          s => !(s.roomTypeId === roomTypeId && s.date === dateStr)
        )
        return [...filtered, snapshot]
      })
    }

    check.violationsFound = newViolations.length
    check.duration = Date.now() - startTime
    check.status = errors.length > 0 ? 'PARTIAL' : 'SUCCESS'
    if (errors.length > 0) {
      check.errors = errors
    }

    setParityChecks(current => [check, ...current.slice(0, 499)])

    if (newViolations.length > 0) {
      setViolations(current => [...newViolations, ...current])
      
      const criticalCount = newViolations.filter(v => v.severity === 'CRITICAL').length
      const highCount = newViolations.filter(v => v.severity === 'HIGH').length
      
      if (criticalCount > 0) {
        toast.error(`${criticalCount} critical rate parity violation${criticalCount > 1 ? 's' : ''} detected`)
      } else if (highCount > 0) {
        toast.warning(`${highCount} high priority rate parity violation${highCount > 1 ? 's' : ''} detected`)
      }
    }

    return check
  }, [setRateSnapshots, setParityChecks, setViolations, settings.alertThreshold])

  const performAutoCheck = useCallback(async () => {
    if (!settings.autoCheckEnabled) return
    if (settings.channels.length === 0 || settings.roomTypes.length === 0) return

    const startDate = format(new Date(), 'yyyy-MM-dd')
    const endDate = format(addDays(new Date(), 30), 'yyyy-MM-dd')

    for (const roomTypeId of settings.roomTypes) {
      await checkRateParity(roomTypeId, startDate, endDate, settings.channels)
    }
  }, [settings, checkRateParity])

  const acknowledgeViolation = useCallback((violationId: string) => {
    setViolations(current =>
      current.map(v =>
        v.id === violationId
          ? { ...v, status: 'ACKNOWLEDGED' }
          : v
      )
    )
  }, [setViolations])

  const resolveViolation = useCallback((violationId: string, resolvedBy: string) => {
    setViolations(current =>
      current.map(v =>
        v.id === violationId
          ? {
              ...v,
              status: 'RESOLVED',
              resolvedAt: new Date().toISOString(),
              resolvedBy
            }
          : v
      )
    )
    toast.success('Rate parity violation resolved')
  }, [setViolations])

  const ignoreViolation = useCallback((violationId: string) => {
    setViolations(current =>
      current.map(v =>
        v.id === violationId
          ? { ...v, status: 'IGNORED' }
          : v
      )
    )
  }, [setViolations])

  const bulkResolveViolations = useCallback((violationIds: string[], resolvedBy: string) => {
    setViolations(current =>
      current.map(v =>
        violationIds.includes(v.id)
          ? {
              ...v,
              status: 'RESOLVED',
              resolvedAt: new Date().toISOString(),
              resolvedBy
            }
          : v
      )
    )
    toast.success(`${violationIds.length} violation${violationIds.length > 1 ? 's' : ''} resolved`)
  }, [setViolations])

  const getActiveViolations = useCallback(() => {
    return violations.filter(v => v.status === 'DETECTED' || v.status === 'ACKNOWLEDGED')
  }, [violations])

  const getViolationsByChannel = useCallback((channelId: string) => {
    return violations.filter(v => v.channelId === channelId)
  }, [violations])

  const getViolationsByRoomType = useCallback((roomTypeId: string) => {
    return violations.filter(v => v.roomTypeId === roomTypeId)
  }, [violations])

  const getChannelHealth = useCallback((channelId: string, channelName: string): ChannelRateHealth => {
    const channelViolations = violations.filter(v => v.channelId === channelId)
    const activeViolations = channelViolations.filter(v => v.status === 'DETECTED' || v.status === 'ACKNOWLEDGED')
    
    const recentChecks = parityChecks
      .filter(check => check.channelsChecked.includes(channelId))
      .slice(0, 10)

    const lastCheck = recentChecks[0]?.timestamp || new Date().toISOString()

    const averageVariance = activeViolations.length > 0
      ? Math.abs(activeViolations.reduce((sum, v) => sum + v.variancePercent, 0) / activeViolations.length)
      : 0

    const totalCheckedRates = recentChecks.reduce((sum, check) => {
      const days = differenceInDays(new Date(check.dateRange.end), new Date(check.dateRange.start)) + 1
      return sum + days
    }, 0)

    const parityScore = totalCheckedRates > 0
      ? Math.max(0, 100 - (activeViolations.length / totalCheckedRates) * 100)
      : 100

    let status: ChannelRateHealth['status'] = 'EXCELLENT'
    if (parityScore < 95) status = 'GOOD'
    if (parityScore < 85) status = 'FAIR'
    if (parityScore < 75) status = 'POOR'

    return {
      channelId,
      channelName,
      lastCheck,
      violationCount: activeViolations.length,
      averageVariance,
      parityScore: Math.round(parityScore),
      status
    }
  }, [violations, parityChecks])

  const getOverallParityScore = useCallback(() => {
    const activeViolations = getActiveViolations()
    const recentChecks = parityChecks.slice(0, 20)
    
    const totalCheckedRates = recentChecks.reduce((sum, check) => {
      const days = differenceInDays(new Date(check.dateRange.end), new Date(check.dateRange.start)) + 1
      return sum + days * check.channelsChecked.length
    }, 0)

    if (totalCheckedRates === 0) return 100

    const score = Math.max(0, 100 - (activeViolations.length / totalCheckedRates) * 100)
    return Math.round(score)
  }, [violations, parityChecks, getActiveViolations])

  const getRateSnapshot = useCallback((
    roomTypeId: string,
    date: string
  ): RateSnapshot | undefined => {
    return rateSnapshots.find(
      snap => snap.roomTypeId === roomTypeId && snap.date === date
    )
  }, [rateSnapshots])

  const updateSettings = useCallback((newSettings: Partial<RateParitySettings>) => {
    setSettings(current => ({ ...current, ...newSettings }))
  }, [setSettings])

  useEffect(() => {
    if (settings.autoCheckEnabled && settings.checkInterval > 0) {
      checkIntervalRef.current = setInterval(() => {
        performAutoCheck()
      }, settings.checkInterval)

      performAutoCheck()

      return () => {
        if (checkIntervalRef.current) {
          clearInterval(checkIntervalRef.current)
        }
      }
    }
  }, [settings.autoCheckEnabled, settings.checkInterval, performAutoCheck])

  return {
    rateSnapshots,
    violations,
    parityChecks,
    settings,
    checkRateParity,
    acknowledgeViolation,
    resolveViolation,
    ignoreViolation,
    bulkResolveViolations,
    getActiveViolations,
    getViolationsByChannel,
    getViolationsByRoomType,
    getChannelHealth,
    getOverallParityScore,
    getRateSnapshot,
    updateSettings,
    performAutoCheck
  }
}
