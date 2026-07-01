import { useCallback, useEffect, useMemo, useState } from 'react'
import { useKV } from '@github/spark/hooks'
import { bookingEmailApi, isBookingEmailApiNotConfigured, SERVER_API_ENABLED } from '@/lib/pms-api-client'
import type { BookingEmailEvent, BookingEmailSource, BookingEmailStatus } from '@/types/booking-email'

interface BookingEmailInboxState {
  events: BookingEmailEvent[]
  sources: BookingEmailSource[]
  status: BookingEmailStatus | null
  loading: boolean
  error: string | null
  notConfigured: boolean
  apiAvailable: boolean
  mode: 'server' | 'local-draft'
  reload: () => Promise<void>
}

function summarizeLocalStatus(events: BookingEmailEvent[], sources: BookingEmailSource[]): BookingEmailStatus {
  const todayKey = new Date().toISOString().slice(0, 10)
  return {
    configured: false,
    needsReview: events.filter((event) => event.status === 'NEEDS_REVIEW').length,
    processedToday: events.filter((event) => event.status === 'PROCESSED' && event.receivedAt?.slice(0, 10) === todayKey).length,
    errors: events.filter((event) => event.status === 'ERROR').length,
    ignored: events.filter((event) => event.status === 'IGNORED').length,
    sources,
    message: 'Booking-email automation backend is not connected in this environment.',
  }
}

export function useBookingEmailInbox(): BookingEmailInboxState {
  const [localEvents] = useKV<BookingEmailEvent[]>('booking-email-events', [])
  const [localSources] = useKV<BookingEmailSource[]>('booking-email-sources', [])
  const [events, setEvents] = useState<BookingEmailEvent[]>([])
  const [sources, setSources] = useState<BookingEmailSource[]>([])
  const [status, setStatus] = useState<BookingEmailStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notConfigured, setNotConfigured] = useState(false)
  const [apiAvailable, setApiAvailable] = useState(false)
  const [mode, setMode] = useState<'server' | 'local-draft'>('server')
  const authToken = null

  const loadLocal = useCallback(() => {
    const nextEvents = localEvents || []
    const nextSources = localSources || []
    setEvents(nextEvents)
    setSources(nextSources)
    setStatus(summarizeLocalStatus(nextEvents, nextSources))
    setNotConfigured(true)
    setApiAvailable(false)
    setMode('local-draft')
    setError(null)
    setLoading(false)
  }, [localEvents, localSources])

  const reload = useCallback(async () => {
    setLoading(true)
    if (!SERVER_API_ENABLED) {
      loadLocal()
      return
    }

    try {
      const [statusPayload, eventsPayload, sourcesPayload] = await Promise.all([
        bookingEmailApi.status(authToken),
        bookingEmailApi.listEvents(authToken, { limit: 100 }),
        bookingEmailApi.listSources(authToken),
      ])
      setStatus(statusPayload.data)
      setEvents(eventsPayload.data)
      setSources(sourcesPayload.data)
      setNotConfigured(!statusPayload.data.configured)
      setApiAvailable(true)
      setMode('server')
      setError(statusPayload.data.configured ? null : statusPayload.data.message || null)
    } catch (caught) {
      if (isBookingEmailApiNotConfigured(caught)) {
        setEvents([])
        setSources([])
        setStatus(summarizeLocalStatus([], []))
        setNotConfigured(true)
        setApiAvailable(false)
        setMode('server')
        setError('Booking-email API routes are not available on this server yet.')
      } else {
        setError(caught instanceof Error ? caught.message : 'Could not load booking email inbox.')
      }
    } finally {
      setLoading(false)
    }
  }, [authToken, loadLocal])

  useEffect(() => {
    void reload()
  }, [reload])

  return useMemo(() => ({
    events,
    sources,
    status,
    loading,
    error,
    notConfigured,
    apiAvailable,
    mode,
    reload,
  }), [apiAvailable, error, events, loading, mode, notConfigured, reload, sources, status])
}
