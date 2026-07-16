import { useCallback, useEffect, useRef, useState } from 'react'
import { housekeepingApi, type HousekeepingServerSnapshot } from '@/lib/housekeeping-api-client'

const EMPTY_SNAPSHOT: HousekeepingServerSnapshot = {
  propertyName: 'Hotel',
  rooms: [],
  tasks: [],
  issues: [],
}

const HOUSEKEEPING_EVENT_TYPES = [
  'ROOM_HOUSEKEEPING_UPDATED',
  'HOUSEKEEPING_TASK_CREATED',
  'HOUSEKEEPING_TASK_ASSIGNED',
  'HOUSEKEEPING_TASK_STATUS_CHANGED',
  'HOUSEKEEPING_ISSUE_CREATED',
  'HOUSEKEEPING_ISSUE_STATUS_CHANGED',
] as const

export function useHousekeepingServer(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<HousekeepingServerSnapshot>(EMPTY_SNAPSHOT)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const refreshTimer = useRef<number | null>(null)

  const refresh = useCallback(async (showLoading = false) => {
    if (!enabled) return
    if (showLoading) setLoading(true)
    try {
      const next = await housekeepingApi.snapshot()
      setSnapshot(next)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Housekeeping data could not be loaded.')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [enabled])

  const run = useCallback(async <T,>(actionId: string, action: () => Promise<T>) => {
    setPendingAction(actionId)
    setError(null)
    try {
      const result = await action()
      await refresh(false)
      return result
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : 'The housekeeping action failed.'
      setError(message)
      await refresh(false)
      throw actionError
    } finally {
      setPendingAction(null)
    }
  }, [refresh])

  useEffect(() => {
    if (!enabled) return
    void refresh(true)

    const source = new EventSource('/api/events', { withCredentials: true })
    const refetch = () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current)
      refreshTimer.current = window.setTimeout(() => void refresh(false), 150)
    }
    for (const eventType of HOUSEKEEPING_EVENT_TYPES) source.addEventListener(eventType, refetch)
    return () => {
      source.close()
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current)
    }
  }, [enabled, refresh])

  return { snapshot, loading, error, pendingAction, refresh, run }
}
