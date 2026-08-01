import { useEffect, useCallback, useRef } from 'react'
import { useKV } from '@github/spark/hooks'
import { toast } from 'sonner'
import { format, addDays, eachDayOfInterval } from 'date-fns'
import { SERVER_API_ENABLED, ratePushApi } from '@/lib/pms-api-client'

export interface RatePushLog {
  id: string
  timestamp: string
  roomTypeId: string
  date: string
  rate: number
  channels: string[]
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED'
  successfulChannels: string[]
  failedChannels: string[]
  error?: string
  triggeredBy: 'MANUAL' | 'AUTO_BASE_RATE' | 'AUTO_RULE' | 'AUTO_OVERRIDE'
}

export interface RatePushSettings {
  autoEnabled: boolean
  pushOnBaseRateChange: boolean
  pushOnRuleChange: boolean
  pushOnOverrideChange: boolean
  pushWindow: number
  selectedChannels: string[]
  retryFailedPushes: boolean
  retryAttempts: number
  enforceConfirmedOverridesOnly: boolean
}

export interface PendingRatePush {
  id: string
  roomTypeId: string
  dates: string[]
  channels: string[]
  reason: string
  createdAt: string
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
}

interface RoomType {
  id: string
  name: string
  baseRate: number
}

interface Channel {
  id: string
  name: string
  enabled: boolean
  connected: boolean
  connectionMode?: 'ICAL'
  status: string
  provider?: 'BOOKING_COM' | 'AGODA' | 'EXPEDIA' | 'AIRBNB'
}

type SourceStatus = 'CONFIRMED' | 'PROJECTED'
type SourceStatusFilter = SourceStatus | 'ALL'
type WorkerPlatform = 'booking' | 'agoda' | 'trip' | 'expedia' | 'unknown'

interface RateOverride {
  id: string
  roomTypeId: string
  date: string
  rate: number
  reason: string
  demandTier?: string
  rateMultiplier?: number
  sourceStatus?: SourceStatus
  reviewRepriceDate?: string
  sourceVersion?: string
}

interface ResolvedRate {
  rate: number
  sourceStatus?: SourceStatus
  sourceKind: 'BASE_RATE' | 'RULE' | 'OVERRIDE'
}

const DEFAULT_SETTINGS: RatePushSettings = {
  autoEnabled: false,
  pushOnBaseRateChange: false,
  pushOnRuleChange: false,
  pushOnOverrideChange: false,
  pushWindow: 90,
  selectedChannels: [],
  retryFailedPushes: true,
  retryAttempts: 3,
  enforceConfirmedOverridesOnly: true
}

const MIN_RATE = 1
const MAX_RATE = 999999

function resolveWorkerPlatform(channel?: Pick<Channel, 'provider' | 'id'> | undefined): WorkerPlatform {
  if (!channel) return 'unknown'
  const source = String(channel.provider || channel.id || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')

  if (source === 'booking' || source === 'booking_com' || source === 'bookingcom') {
    return 'booking'
  }
  if (source === 'agoda') return 'agoda'
  if (source === 'trip' || source === 'trip_com' || source === 'tripcom') return 'trip'
  if (source === 'expedia') return 'expedia'
  return 'unknown'
}

export function useRatePush() {
  const [pushLogs, setPushLogs] = useKV<RatePushLog[]>('rate-push-logs', [])
  const [settings, setSettings] = useKV<RatePushSettings>('rate-push-settings', DEFAULT_SETTINGS)
  const [pendingPushes, setPendingPushes] = useKV<PendingRatePush[]>('pending-rate-pushes', [])

  const [roomTypes] = useKV<RoomType[]>('room-types-config', [])
  const [channels] = useKV<Channel[]>('channels', [])

  const previousRoomTypesRef = useRef<RoomType[]>([])
  const previousRateRulesRef = useRef<string>('')
  const previousRateOverridesRef = useRef<string>('')

  const [rateRules] = useKV<any[]>('rate-rules', [])
  const [rateOverrides] = useKV<RateOverride[]>('rate-overrides', [])

  const normalizeOverrideSourceStatus = useCallback((value: unknown): SourceStatus => {
    const normalized = String(value || '').trim().toUpperCase()
    return normalized === 'PROJECTED' ? 'PROJECTED' : 'CONFIRMED'
  }, [])

  const getOverrideSourceFilter = useCallback(() => {
    return settings.enforceConfirmedOverridesOnly ? 'CONFIRMED' : 'ALL'
  }, [settings.enforceConfirmedOverridesOnly])

  const resolveRateForDate = useCallback((
    roomTypeId: string,
    date: Date,
    sourceStatusFilter: SourceStatusFilter = 'CONFIRMED'
  ): ResolvedRate | null => {
    const roomType = roomTypes.find(rt => rt.id === roomTypeId)
    if (!roomType) return null

    const dateStr = format(date, 'yyyy-MM-dd')
    const matchesFilter = (candidateStatus: unknown): boolean => {
      if (sourceStatusFilter === 'ALL') return true
      return normalizeOverrideSourceStatus(candidateStatus) === sourceStatusFilter
    }

    const matchingOverride = rateOverrides.find(o =>
      o.roomTypeId === roomTypeId &&
      o.date === dateStr &&
      matchesFilter(o.sourceStatus)
    )

    if (matchingOverride && Number.isFinite(matchingOverride.rate)) {
      return {
        rate: Math.round(matchingOverride.rate),
        sourceStatus: normalizeOverrideSourceStatus(matchingOverride.sourceStatus),
        sourceKind: 'OVERRIDE'
      }
    }

    let rate = roomType.baseRate

    const applicableRules = rateRules
      .filter(rule => {
        if (rule.roomTypeId !== roomTypeId) return false
        if (!rule.enabled) return false
        if (rule.startDate && new Date(rule.startDate) > date) return false
        if (rule.endDate && new Date(rule.endDate) < date) return false
        if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
          if (!rule.daysOfWeek.includes(date.getDay())) return false
        }
        return true
      })
      .sort((a, b) => b.priority - a.priority)

    applicableRules.forEach(rule => {
      if (rule.type === 'PERCENTAGE') {
        rate += rate * (rule.value / 100)
      } else if (rule.type === 'FIXED_DELTA') {
        rate += rule.value
      }
    })

    return {
      rate: Math.round(rate),
      sourceKind: 'RULE'
    }
  }, [roomTypes, rateOverrides, rateRules, normalizeOverrideSourceStatus])

  const validateRatePayload = useCallback((roomTypeId: string, rate: number): { ok: boolean; errors: string[] } => {
    const errors: string[] = []
    const roomType = roomTypes.find(rt => rt.id === roomTypeId)

    if (!roomType) {
      errors.push(`Unknown room type id ${roomTypeId}`)
    }

    if (!Number.isFinite(rate)) {
      errors.push(`Invalid rate ${rate}`)
    } else if (!Number.isInteger(rate)) {
      errors.push(`Rate must be integer THB; got ${rate}`)
    } else if (rate < MIN_RATE || rate > MAX_RATE) {
      errors.push(`Rate out of bounds: ${rate}`)
    }

    return { ok: errors.length === 0, errors }
  }, [roomTypes])

  const pushRateToChannel = async (
    channelId: string,
    roomTypeId: string,
    date: string,
    rate: number,
    failureReasons: string[] = []
  ): Promise<boolean> => {
    const channel = channels.find(c => c.id === channelId)
    if (!channel?.connected || !channel?.enabled || channel.connectionMode === 'ICAL') {
      return false
    }

    const validation = validateRatePayload(roomTypeId, rate)
    if (!validation.ok) {
      failureReasons.push(...validation.errors)
      return false
    }

    if (SERVER_API_ENABLED) {
      const platform = resolveWorkerPlatform(channel)
      if (platform === 'unknown') {
        failureReasons.push(`Channel ${channel?.name || channelId} does not map to a supported rate push platform.`)
        return false
      }

      try {
        const response = await ratePushApi.push(undefined, {
          roomTypeId,
          channelId,
          platform,
          date,
          rate,
          message: `Rate push dry-run: ${channel?.name || channelId} ${roomTypeId} @ THB ${rate} for ${date}`,
          dryRun: true,
        })

        const result = response?.data?.result
        if (!result) {
          failureReasons.push('Rate push worker returned no result')
          return false
        }

        if (result.status !== 'SUCCEEDED') {
          failureReasons.push(result.errorMessage || result.summary || `Rate push worker completed with ${result.status}`)
          return false
        }
        return true
      } catch (error) {
        failureReasons.push(error instanceof Error ? error.message : 'Rate push worker request failed')
        return false
      }
    }

    // Local-mode connectors are not available yet; preserve explicit non-live failure semantics.
    return false
  }

  const pushRatesToChannels = useCallback(async (
    roomTypeId: string,
    dates: string[],
    targetChannels: string[],
    triggeredBy: RatePushLog['triggeredBy']
  ): Promise<RatePushLog> => {
    const pushId = `push_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const timestamp = new Date().toISOString()
    const sourceFilter = getOverrideSourceFilter()

    const activeChannels = targetChannels.filter(channelId => {
      const channel = channels.find(c => c.id === channelId)
      return channel?.connected && channel?.enabled && channel.connectionMode !== 'ICAL'
    })

    if (activeChannels.length === 0) {
      const log: RatePushLog = {
        id: pushId,
        timestamp,
        roomTypeId,
        date: dates[0] || '',
        rate: 0,
        channels: targetChannels,
        status: 'FAILED',
        successfulChannels: [],
        failedChannels: targetChannels,
        error: 'No active channels available',
        triggeredBy
      }
      setPushLogs(current => [log, ...current.slice(0, 499)])
      return log
    }

    const roomType = roomTypes.find(rt => rt.id === roomTypeId)
    const successfulChannels: string[] = []
    const failedChannels: string[] = []
    const payloadErrors: string[] = []

    for (const date of dates) {
      const resolved = resolveRateForDate(roomTypeId, new Date(date), sourceFilter)
      if (!resolved) {
        payloadErrors.push(`Room type ${roomTypeId} not found`)
        activeChannels.forEach(channelId => {
          if (!failedChannels.includes(channelId)) {
            failedChannels.push(channelId)
          }
        })
        continue
      }

      const validation = validateRatePayload(roomTypeId, resolved.rate)
        if (!validation.ok) {
          payloadErrors.push(...validation.errors)
          activeChannels.forEach(channelId => {
            if (!failedChannels.includes(channelId)) {
              failedChannels.push(channelId)
            }
          })
          continue
        }

      for (const channelId of activeChannels) {
        const success = await pushRateToChannel(channelId, roomTypeId, date, resolved.rate, payloadErrors)

        if (success) {
          if (!successfulChannels.includes(channelId)) {
            successfulChannels.push(channelId)
          }
        } else {
          if (!failedChannels.includes(channelId)) {
            failedChannels.push(channelId)
          }
        }
      }
    }

    const status: RatePushLog['status'] =
      failedChannels.length === 0 ? 'SUCCESS' :
      successfulChannels.length === 0 ? 'FAILED' :
      'PARTIAL'

    const firstRate = resolveRateForDate(roomTypeId, new Date(dates[0]), sourceFilter)?.rate || 0
    const payloadLabel = sourceFilter === 'ALL'
      ? 'including PROJECTED'
      : 'CONFIRMED-only'

    const log: RatePushLog = {
      id: pushId,
      timestamp,
      roomTypeId,
      date: dates[0],
      rate: firstRate,
      channels: activeChannels,
      status,
      successfulChannels,
      failedChannels,
      error: status === 'SUCCESS'
        ? undefined
        : [...new Set(payloadErrors)].length > 0
          ? [...new Set(payloadErrors)].join('; ')
          : 'No live channel connector configured',
      triggeredBy
    }

    setPushLogs(current => [log, ...current.slice(0, 499)])

    if (status === 'SUCCESS') {
      toast.success(`Rates pushed to ${successfulChannels.length} channel${successfulChannels.length > 1 ? 's' : ''}`, {
        description: `${dates.length} date${dates.length > 1 ? 's' : ''} updated for ${roomType?.name || roomTypeId} (${payloadLabel})`
      })
    } else if (status === 'PARTIAL') {
      toast.warning(`Rates partially pushed`, {
        description: `Some channels failed for ${roomType?.name || roomTypeId}`
      })
    } else {
      toast.error(`Failed to push rates`, {
        description: `All channels failed for ${roomType?.name || roomTypeId}`
      })
    }

    return log
  }, [
    roomTypes,
    rateOverrides,
    channels,
    validateRatePayload,
    resolveRateForDate,
    pushRateToChannel,
    setPushLogs,
    getOverrideSourceFilter,
    settings.enforceConfirmedOverridesOnly
  ])

  const createPendingPush = useCallback((
    roomTypeId: string,
    dates: string[],
    targetChannels: string[],
    reason: string
  ) => {
    const push: PendingRatePush = {
      id: `pending_${Date.now()}`,
      roomTypeId,
      dates,
      channels: targetChannels,
      reason,
      createdAt: new Date().toISOString(),
      status: 'PENDING'
    }

    setPendingPushes(current => [push, ...current])
    return push
  }, [setPendingPushes])

  const executePendingPush = useCallback(async (pushId: string) => {
    const push = pendingPushes.find(p => p.id === pushId)
    if (!push || push.status !== 'PENDING') return

    setPendingPushes(current =>
      current.map(p =>
        p.id === pushId ? { ...p, status: 'IN_PROGRESS' as const } : p
      )
    )

    try {
      await pushRatesToChannels(
        push.roomTypeId,
        push.dates,
        push.channels,
        'MANUAL'
      )

      setPendingPushes(current =>
        current.map(p =>
          p.id === pushId ? { ...p, status: 'COMPLETED' as const } : p
        )
      )
    } catch (error) {
      setPendingPushes(current =>
        current.map(p =>
          p.id === pushId ? { ...p, status: 'FAILED' as const } : p
        )
      )
    }
  }, [pendingPushes, pushRatesToChannels, setPendingPushes])

  const clearCompletedPushes = useCallback(() => {
    setPendingPushes(current =>
      current.filter(p => p.status === 'PENDING' || p.status === 'IN_PROGRESS')
    )
  }, [setPendingPushes])

  const manualPushRates = useCallback(async (
    roomTypeId: string,
    startDate: string,
    endDate: string,
    targetChannels: string[]
  ) => {
    const dates = eachDayOfInterval({
      start: new Date(startDate),
      end: new Date(endDate)
    }).map(d => format(d, 'yyyy-MM-dd'))

    return await pushRatesToChannels(roomTypeId, dates, targetChannels, 'MANUAL')
  }, [pushRatesToChannels])

  const updateSettings = useCallback((newSettings: Partial<RatePushSettings>) => {
    setSettings(current => ({ ...current, ...newSettings }))
  }, [setSettings])

  const getActivePushes = useCallback(() => {
    return pendingPushes.filter(p => p.status === 'PENDING' || p.status === 'IN_PROGRESS')
  }, [pendingPushes])

  const getRecentPushes = useCallback((limit: number = 20) => {
    return pushLogs.slice(0, limit)
  }, [pushLogs])

  const getPushesByChannel = useCallback((channelId: string) => {
    return pushLogs.filter(log =>
      log.successfulChannels.includes(channelId) ||
      log.failedChannels.includes(channelId)
    )
  }, [pushLogs])

  const getSuccessRate = useCallback(() => {
    if (pushLogs.length === 0) return 0

    const successful = pushLogs.filter(log => log.status === 'SUCCESS').length
    return Math.round((successful / pushLogs.length) * 100)
  }, [pushLogs])

  useEffect(() => {
    if (!settings.autoEnabled) return

    const targetChannels = settings.selectedChannels.length > 0
      ? settings.selectedChannels
      : channels.filter(c => c.connected && c.enabled && c.connectionMode !== 'ICAL').map(c => c.id)

    if (targetChannels.length === 0) return

    const endDate = format(addDays(new Date(), settings.pushWindow), 'yyyy-MM-dd')
    const startDate = format(new Date(), 'yyyy-MM-dd')
    const dates = eachDayOfInterval({
      start: new Date(startDate),
      end: new Date(endDate)
    }).map(d => format(d, 'yyyy-MM-dd'))

    if (settings.pushOnBaseRateChange && previousRoomTypesRef.current.length > 0) {
      roomTypes.forEach(currentRoom => {
        const previousRoom = previousRoomTypesRef.current.find(r => r.id === currentRoom.id)
        if (previousRoom && previousRoom.baseRate !== currentRoom.baseRate) {
          pushRatesToChannels(
            currentRoom.id,
            dates,
            targetChannels,
            'AUTO_BASE_RATE'
          )
        }
      })
    }

    previousRoomTypesRef.current = roomTypes

    const rateRulesHash = JSON.stringify(rateRules)
    if (settings.pushOnRuleChange && previousRateRulesRef.current && previousRateRulesRef.current !== rateRulesHash) {
      const affectedRoomTypes = new Set<string>()
      rateRules.forEach(rule => {
        if (rule.enabled) {
          affectedRoomTypes.add(rule.roomTypeId)
        }
      })

      affectedRoomTypes.forEach(roomTypeId => {
        pushRatesToChannels(
          roomTypeId,
          dates,
          targetChannels,
          'AUTO_RULE'
        )
      })
    }
    previousRateRulesRef.current = rateRulesHash

    const rateOverridesHash = JSON.stringify(rateOverrides)
    if (settings.pushOnOverrideChange && previousRateOverridesRef.current && previousRateOverridesRef.current !== rateOverridesHash) {
      const overrideSourceFilter = getOverrideSourceFilter()
      const affectedRoomTypes = new Set<string>()

      rateOverrides.forEach(override => {
        if (overrideSourceFilter === 'CONFIRMED' && normalizeOverrideSourceStatus(override.sourceStatus) !== 'CONFIRMED') {
          return
        }
        affectedRoomTypes.add(override.roomTypeId)
      })

      affectedRoomTypes.forEach(roomTypeId => {
        const relevantDates = rateOverrides
          .filter(o => o.roomTypeId === roomTypeId)
          .filter(o => overrideSourceFilter === 'ALL' || normalizeOverrideSourceStatus(o.sourceStatus) === 'CONFIRMED')
          .map(o => o.date)
          .filter(d => dates.includes(d))

        if (relevantDates.length > 0) {
          pushRatesToChannels(
            roomTypeId,
            relevantDates,
            targetChannels,
            'AUTO_OVERRIDE'
          )
        }
      })
    }
    previousRateOverridesRef.current = rateOverridesHash

  }, [
    roomTypes,
    rateRules,
    rateOverrides,
    settings,
    channels,
    pushRatesToChannels,
    normalizeOverrideSourceStatus,
    getOverrideSourceFilter
  ])

  return {
    pushLogs,
    settings,
    pendingPushes,
    pushRatesToChannels,
    createPendingPush,
    executePendingPush,
    clearCompletedPushes,
    manualPushRates,
    updateSettings,
    getActivePushes,
    getRecentPushes,
    getPushesByChannel,
    getSuccessRate
  }
}
