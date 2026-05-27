import { useEffect, useCallback, useRef } from 'react'
import { useKV } from '@github/spark/hooks'
import { toast } from 'sonner'
import { format, addDays, eachDayOfInterval } from 'date-fns'

export interface InventorySnapshot {
  roomTypeId: string
  date: string
  totalUnits: number
  availableUnits: number
  reservedUnits: number
  blockedUnits: number
}

export interface InventorySyncEvent {
  id: string
  timestamp: string
  eventType: 'RESERVATION_CREATED' | 'RESERVATION_CANCELLED' | 'ROOM_BLOCKED' | 'ROOM_UNBLOCKED' | 'MANUAL_ADJUSTMENT'
  roomTypeId: string
  affectedDates: string[]
  delta: number
  triggeredBy: string
  syncedToChannels: string[]
  syncStatus: 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED'
  errors?: Record<string, string>
}

export interface InventorySyncLog {
  id: string
  timestamp: string
  channelId: string
  operation: 'PUSH_INVENTORY' | 'PUSH_RATES' | 'PUSH_RESTRICTIONS'
  dateRange: { start: string; end: string }
  recordsUpdated: number
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED'
  duration: number
  errors?: string[]
}

interface ChannelInventoryState {
  channelId: string
  lastSyncTimestamp: string
  pendingEvents: number
  syncEnabled: boolean
}

export function useInventorySync() {
  const [inventory, setInventory] = useKV<InventorySnapshot[]>('inventory-snapshots', [])
  const [syncEvents, setSyncEvents] = useKV<InventorySyncEvent[]>('inventory-sync-events', [])
  const [syncLogs, setSyncLogs] = useKV<InventorySyncLog[]>('inventory-sync-logs', [])
  const [channelStates, setChannelStates] = useKV<ChannelInventoryState[]>('channel-inventory-states', [])
  const [autoSyncEnabled, setAutoSyncEnabled] = useKV<boolean>('auto-sync-enabled', true)
  
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pendingEventsRef = useRef<InventorySyncEvent[]>([])

  const calculateInventoryForDate = useCallback((roomTypeId: string, date: string): InventorySnapshot => {
    const existingSnapshot = inventory.find(
      snap => snap.roomTypeId === roomTypeId && snap.date === date
    )
    
    if (existingSnapshot) {
      return existingSnapshot
    }

    return {
      roomTypeId,
      date,
      totalUnits: 10,
      availableUnits: 8,
      reservedUnits: 2,
      blockedUnits: 0
    }
  }, [inventory])

  const recordInventoryEvent = useCallback(async (
    eventType: InventorySyncEvent['eventType'],
    roomTypeId: string,
    affectedDates: string[],
    delta: number,
    triggeredBy: string = 'system'
  ) => {
    const event: InventorySyncEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      eventType,
      roomTypeId,
      affectedDates,
      delta,
      triggeredBy,
      syncedToChannels: [],
      syncStatus: 'PENDING'
    }

    setSyncEvents(current => [event, ...current.slice(0, 499)])
    pendingEventsRef.current.push(event)

    affectedDates.forEach(date => {
      const snapshot = calculateInventoryForDate(roomTypeId, date)
      const updatedSnapshot: InventorySnapshot = {
        ...snapshot,
        availableUnits: Math.max(0, snapshot.availableUnits + delta),
        reservedUnits: snapshot.reservedUnits - delta
      }

      setInventory(current => {
        const filtered = current.filter(
          s => !(s.roomTypeId === roomTypeId && s.date === date)
        )
        return [...filtered, updatedSnapshot]
      })
    })

    if (autoSyncEnabled) {
      setTimeout(() => processPendingEvents(), 2000)
    }

    return event.id
  }, [calculateInventoryForDate, setInventory, setSyncEvents, autoSyncEnabled])

  const processPendingEvents = useCallback(async () => {
    if (pendingEventsRef.current.length === 0) return

    const eventsToProcess = [...pendingEventsRef.current]
    pendingEventsRef.current = []

    const groupedByRoomType = eventsToProcess.reduce((acc, event) => {
      if (!acc[event.roomTypeId]) {
        acc[event.roomTypeId] = []
      }
      acc[event.roomTypeId].push(event)
      return acc
    }, {} as Record<string, InventorySyncEvent[]>)

    for (const [roomTypeId, events] of Object.entries(groupedByRoomType)) {
      const allDates = new Set<string>()
      events.forEach(evt => evt.affectedDates.forEach(d => allDates.add(d)))
      
      const dateRange = {
        start: Array.from(allDates).sort()[0],
        end: Array.from(allDates).sort().reverse()[0]
      }

      await syncInventoryToChannels(roomTypeId, dateRange.start, dateRange.end, events)
    }
  }, [])

  const syncInventoryToChannels = async (
    roomTypeId: string,
    startDate: string,
    endDate: string,
    triggeringEvents: InventorySyncEvent[]
  ) => {
    const channels = channelStates.filter(ch => ch.syncEnabled)
    
    for (const channel of channels) {
      const startTime = Date.now()
      
      try {
        const dates = eachDayOfInterval({
          start: new Date(startDate),
          end: new Date(endDate)
        })

        const inventoryUpdates = dates.map(date => {
          const dateStr = format(date, 'yyyy-MM-dd')
          const snapshot = calculateInventoryForDate(roomTypeId, dateStr)
          return {
            date: dateStr,
            available: snapshot.availableUnits
          }
        })

        await simulateChannelSync(channel.channelId, inventoryUpdates)

        const log: InventorySyncLog = {
          id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date().toISOString(),
          channelId: channel.channelId,
          operation: 'PUSH_INVENTORY',
          dateRange: { start: startDate, end: endDate },
          recordsUpdated: inventoryUpdates.length,
          status: 'SUCCESS',
          duration: Date.now() - startTime
        }

        setSyncLogs(current => [log, ...current.slice(0, 499)])

        triggeringEvents.forEach(event => {
          setSyncEvents(current => 
            current.map(evt => 
              evt.id === event.id
                ? {
                    ...evt,
                    syncStatus: 'SUCCESS',
                    syncedToChannels: [...evt.syncedToChannels, channel.channelId]
                  }
                : evt
            )
          )
        })

        setChannelStates(current =>
          current.map(ch =>
            ch.channelId === channel.channelId
              ? { ...ch, lastSyncTimestamp: new Date().toISOString(), pendingEvents: 0 }
              : ch
          )
        )

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        
        const log: InventorySyncLog = {
          id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date().toISOString(),
          channelId: channel.channelId,
          operation: 'PUSH_INVENTORY',
          dateRange: { start: startDate, end: endDate },
          recordsUpdated: 0,
          status: 'FAILED',
          duration: Date.now() - startTime,
          errors: [errorMsg]
        }

        setSyncLogs(current => [log, ...current.slice(0, 499)])

        triggeringEvents.forEach(event => {
          setSyncEvents(current => 
            current.map(evt => 
              evt.id === event.id
                ? {
                    ...evt,
                    syncStatus: 'FAILED',
                    errors: { ...evt.errors, [channel.channelId]: errorMsg }
                  }
                : evt
            )
          )
        })
      }
    }
  }

  const simulateChannelSync = async (channelId: string, updates: any[]): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500))
    
    if (Math.random() > 0.95) {
      throw new Error('Network timeout')
    }
  }

  const manualSyncAllChannels = useCallback(async (roomTypeId: string, days: number = 90) => {
    const startDate = format(new Date(), 'yyyy-MM-dd')
    const endDate = format(addDays(new Date(), days), 'yyyy-MM-dd')

    const manualEvent: InventorySyncEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      eventType: 'MANUAL_ADJUSTMENT',
      roomTypeId,
      affectedDates: [startDate, endDate],
      delta: 0,
      triggeredBy: 'manual',
      syncedToChannels: [],
      syncStatus: 'IN_PROGRESS'
    }

    setSyncEvents(current => [manualEvent, ...current])

    try {
      await syncInventoryToChannels(roomTypeId, startDate, endDate, [manualEvent])
      toast.success('Inventory synced to all channels')
    } catch (error) {
      toast.error('Sync failed for some channels')
    }
  }, [setSyncEvents])

  const getInventoryForDateRange = useCallback((
    roomTypeId: string,
    startDate: string,
    endDate: string
  ): InventorySnapshot[] => {
    const dates = eachDayOfInterval({
      start: new Date(startDate),
      end: new Date(endDate)
    })

    return dates.map(date => {
      const dateStr = format(date, 'yyyy-MM-dd')
      return calculateInventoryForDate(roomTypeId, dateStr)
    })
  }, [calculateInventoryForDate])

  const getPendingEventCount = useCallback(() => {
    return syncEvents.filter(evt => evt.syncStatus === 'PENDING').length
  }, [syncEvents])

  const getChannelSyncHealth = useCallback(() => {
    return channelStates.map(channel => {
      const recentLogs = syncLogs
        .filter(log => log.channelId === channel.channelId)
        .slice(0, 10)

      const successRate = recentLogs.length > 0
        ? (recentLogs.filter(log => log.status === 'SUCCESS').length / recentLogs.length) * 100
        : 100

      const avgDuration = recentLogs.length > 0
        ? recentLogs.reduce((sum, log) => sum + log.duration, 0) / recentLogs.length
        : 0

      return {
        channelId: channel.channelId,
        lastSync: channel.lastSyncTimestamp,
        pendingEvents: channel.pendingEvents,
        successRate,
        avgDuration,
        health: successRate >= 95 ? 'HEALTHY' : successRate >= 80 ? 'DEGRADED' : 'ERROR'
      }
    })
  }, [channelStates, syncLogs])

  useEffect(() => {
    if (autoSyncEnabled) {
      syncIntervalRef.current = setInterval(() => {
        if (pendingEventsRef.current.length > 0) {
          processPendingEvents()
        }
      }, 30000)

      return () => {
        if (syncIntervalRef.current) {
          clearInterval(syncIntervalRef.current)
        }
      }
    }
  }, [autoSyncEnabled, processPendingEvents])

  return {
    inventory,
    syncEvents,
    syncLogs,
    channelStates,
    autoSyncEnabled,
    setAutoSyncEnabled,
    recordInventoryEvent,
    manualSyncAllChannels,
    getInventoryForDateRange,
    getPendingEventCount,
    getChannelSyncHealth,
    setChannelStates
  }
}
