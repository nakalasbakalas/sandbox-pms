import { useEffect, useCallback, useRef } from 'react'
import { useKV } from '@github/spark/hooks'
import { toast } from 'sonner'
import { format, addDays, eachDayOfInterval } from 'date-fns'

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
  status: string
}

const DEFAULT_SETTINGS: RatePushSettings = {
  autoEnabled: true,
  pushOnBaseRateChange: true,
  pushOnRuleChange: true,
  pushOnOverrideChange: true,
  pushWindow: 90,
  selectedChannels: [],
  retryFailedPushes: true,
  retryAttempts: 3
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
  const [rateOverrides] = useKV<any[]>('rate-overrides', [])

  const pushRateToChannel = async (
    channelId: string,
    roomTypeId: string,
    date: string,
    rate: number
  ): Promise<boolean> => {
    await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 300))
    
    const channel = channels.find(c => c.id === channelId)
    if (!channel?.connected || !channel?.enabled) {
      return false
    }

    if (Math.random() > 0.95) {
      return false
    }

    return true
  }

  const calculateRateForDate = (roomTypeId: string, date: Date): number => {
    const roomType = roomTypes.find(rt => rt.id === roomTypeId)
    if (!roomType) return 0

    let rate = roomType.baseRate

    const dateStr = format(date, 'yyyy-MM-dd')
    const override = rateOverrides.find(o => 
      o.roomTypeId === roomTypeId && 
      o.date === dateStr
    )

    if (override) {
      return override.rate
    }

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

    return Math.round(rate)
  }

  const pushRatesToChannels = useCallback(async (
    roomTypeId: string,
    dates: string[],
    targetChannels: string[],
    triggeredBy: RatePushLog['triggeredBy']
  ): Promise<RatePushLog> => {
    const pushId = `push_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const timestamp = new Date().toISOString()

    const activeChannels = targetChannels.filter(channelId => {
      const channel = channels.find(c => c.id === channelId)
      return channel?.connected && channel?.enabled
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

    const successfulChannels: string[] = []
    const failedChannels: string[] = []

    for (const date of dates) {
      const rate = calculateRateForDate(roomTypeId, new Date(date))
      
      for (const channelId of activeChannels) {
        const success = await pushRateToChannel(channelId, roomTypeId, date, rate)
        
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

    const firstRate = calculateRateForDate(roomTypeId, new Date(dates[0]))

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
      triggeredBy
    }

    setPushLogs(current => [log, ...current.slice(0, 499)])

    const roomType = roomTypes.find(rt => rt.id === roomTypeId)
    const channelNames = successfulChannels
      .map(id => channels.find(c => c.id === id)?.name)
      .filter(Boolean)
      .join(', ')

    if (status === 'SUCCESS') {
      toast.success(`Rates pushed to ${channelNames}`, {
        description: `${dates.length} date${dates.length > 1 ? 's' : ''} updated for ${roomType?.name}`
      })
    } else if (status === 'PARTIAL') {
      toast.warning(`Rates partially pushed`, {
        description: `Success: ${channelNames}. Some channels failed.`
      })
    } else {
      toast.error(`Failed to push rates`, {
        description: `All channels failed for ${roomType?.name}`
      })
    }

    return log
  }, [channels, roomTypes, rateRules, rateOverrides, setPushLogs])

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
    if (pushLogs.length === 0) return 100

    const successful = pushLogs.filter(log => log.status === 'SUCCESS').length
    return Math.round((successful / pushLogs.length) * 100)
  }, [pushLogs])

  useEffect(() => {
    if (!settings.autoEnabled) return

    const targetChannels = settings.selectedChannels.length > 0 
      ? settings.selectedChannels 
      : channels.filter(c => c.connected && c.enabled).map(c => c.id)

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
      const affectedRoomTypes = new Set<string>()
      rateOverrides.forEach(override => {
        affectedRoomTypes.add(override.roomTypeId)
      })

      affectedRoomTypes.forEach(roomTypeId => {
        const relevantDates = rateOverrides
          .filter(o => o.roomTypeId === roomTypeId)
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

  }, [roomTypes, rateRules, rateOverrides, settings, channels, pushRatesToChannels])

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
