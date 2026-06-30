import { useMemo, useState } from 'react'
import {
  ArrowsClockwise,
  CheckCircle,
  EnvelopeSimple,
  LinkSimple,
  ListMagnifyingGlass,
  Plugs,
  Prohibit,
  Receipt,
  Warning,
} from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { bookingEmailApi, SERVER_API_ENABLED } from '@/lib/pms-api-client'
import { useBookingEmailInbox } from '@/hooks/use-booking-email-inbox'
import { useNavigation } from '@/hooks/use-navigation'
import { cn } from '@/lib/utils'
import type { BookingEmailEvent, BookingEmailEventStatus } from '@/types/booking-email'

type InboxTab = 'NEEDS_REVIEW' | 'PROCESSED' | 'ERROR' | 'IGNORED' | 'SOURCES'

const tabLabels: Record<InboxTab, string> = {
  NEEDS_REVIEW: 'Needs Review',
  PROCESSED: 'Processed',
  ERROR: 'Errors',
  IGNORED: 'Ignored',
  SOURCES: 'Sources / Settings',
}

function formatEventType(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase())
}

function eventReason(event: BookingEmailEvent) {
  return event.reviewReason || event.errorReason || event.completedAction || event.proposedAction || 'Review extracted details before applying.'
}

function confidenceLabel(confidence?: number) {
  if (confidence === undefined) return 'Not scored'
  const normalized = confidence <= 1 ? confidence * 100 : confidence
  return `${Math.round(normalized)}% confidence`
}

function formatDate(value?: string) {
  if (!value) return 'Not extracted'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return format(date, 'MMM d, yyyy')
}

function formatReceived(value?: string) {
  if (!value) return 'Time not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return format(date, 'MMM d, HH:mm')
}

function amountLabel(event: BookingEmailEvent) {
  if (typeof event.amount !== 'number') return event.paymentStatus || 'Amount not extracted'
  return `${event.currency || 'THB'} ${event.amount.toLocaleString('en-US')}${event.paymentStatus ? ` · ${event.paymentStatus}` : ''}`
}

function statusTone(status: BookingEmailEventStatus) {
  if (status === 'NEEDS_REVIEW') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (status === 'PROCESSED') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'ERROR') return 'border-rose-200 bg-rose-50 text-rose-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

export function BookingInboxView() {
  const { events, sources, status, loading, error, notConfigured, mode, reload } = useBookingEmailInbox()
  const { navigate } = useNavigation()
  const [activeTab, setActiveTab] = useState<InboxTab>('NEEDS_REVIEW')
  const authToken = null
  const canUseBackend = SERVER_API_ENABLED && !notConfigured

  const counts = useMemo(() => ({
    NEEDS_REVIEW: events.filter((event) => event.status === 'NEEDS_REVIEW').length,
    PROCESSED: events.filter((event) => event.status === 'PROCESSED').length,
    ERROR: events.filter((event) => event.status === 'ERROR').length,
    IGNORED: events.filter((event) => event.status === 'IGNORED').length,
  }), [events])

  const filteredEvents = useMemo(() => (
    activeTab === 'SOURCES' ? [] : events.filter((event) => event.status === activeTab)
  ), [activeTab, events])

  const requireBackend = () => {
    toast.info('Booking-email backend routes are required before this action can apply PMS changes.')
  }

  const requireAdvancedEditor = () => {
    toast.info('Detailed edit/link/create workflows need the next booking-email backend and parser editor pass.')
  }

  const handleSync = async () => {
    if (!canUseBackend) {
      requireBackend()
      return
    }
    try {
      const payload = await bookingEmailApi.sync(authToken)
      toast.success(payload.message || 'Booking email sync started.')
      await reload()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Booking email sync failed.')
    }
  }

  const approve = async (event: BookingEmailEvent) => {
    if (!canUseBackend) {
      requireBackend()
      return
    }
    try {
      const payload = await bookingEmailApi.approveEvent(authToken, event.id, { mode: event.reservationId ? 'link_reservation' : 'apply_parsed', reservationId: event.reservationId })
      toast.success(payload.message || 'Booking email event applied.')
      await reload()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not apply booking email event.')
    }
  }

  const reject = async (event: BookingEmailEvent) => {
    if (!canUseBackend) {
      requireBackend()
      return
    }
    const reason = window.prompt('Reason for rejecting or ignoring this booking email event?')
    if (!reason?.trim()) return
    try {
      const payload = await bookingEmailApi.rejectEvent(authToken, event.id, { reason: reason.trim() })
      toast.success(payload.message || 'Booking email event ignored.')
      await reload()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not ignore booking email event.')
    }
  }

  const reprocess = async (event: BookingEmailEvent) => {
    if (!canUseBackend) {
      requireBackend()
      return
    }
    try {
      const payload = await bookingEmailApi.reprocessEvent(authToken, event.id)
      toast.success(payload.message || 'Booking email event queued for reprocessing.')
      await reload()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not reprocess booking email event.')
    }
  }

  return (
    <div className="min-h-full bg-[#f7f4ef]">
      <section className="border-b border-black/10 bg-[#25211d] text-white">
        <div className="mx-auto flex max-w-[1700px] flex-col gap-4 px-4 py-5 lg:flex-row lg:items-end lg:justify-between lg:px-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#d8a15f]">
              <EnvelopeSimple size={15} weight="bold" />
              Booking Email Intake
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Booking Inbox</h1>
              <p className="mt-1 text-sm text-white/65">Review email-derived booking events before they change PMS reservations, folios, or rooms.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" className="gap-1.5" onClick={() => void reload()}>
              <ArrowsClockwise size={16} weight="bold" />
              Refresh
            </Button>
            <Button className="gap-1.5 bg-[#d8a15f] text-[#241f1b] hover:bg-[#c89252]" onClick={handleSync}>
              <EnvelopeSimple size={16} weight="bold" />
              Sync Mailbox
            </Button>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-[1700px] space-y-4 px-4 py-4 lg:px-6">
        {(notConfigured || error) && (
          <Card className="rounded-lg border-amber-200 bg-amber-50 py-0 text-amber-950">
            <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between">
              <div className="flex gap-3">
                <Plugs className="mt-0.5 h-5 w-5 flex-none" weight="bold" />
                <div>
                  <div className="font-semibold">Booking-email backend connection needed</div>
                  <p className="mt-1 text-sm text-amber-900/80">
                    {error || status?.message || 'Configure the booking-email routes before staff can sync, approve, or apply email-derived booking events.'}
                  </p>
                  <p className="mt-1 text-xs text-amber-900/70">
                    Current mode: {mode === 'local-draft' ? 'local draft data only' : 'server API checked'}.
                  </p>
                </div>
              </div>
              <Button variant="outline" className="border-amber-300 bg-white/70" onClick={() => setActiveTab('SOURCES')}>
                View required routes
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <InboxMetric label="Needs review" value={counts.NEEDS_REVIEW} icon={ListMagnifyingGlass} tone="border-amber-100 bg-amber-50 text-amber-800" />
          <InboxMetric label="Processed" value={counts.PROCESSED} icon={CheckCircle} tone="border-emerald-100 bg-emerald-50 text-emerald-800" />
          <InboxMetric label="Errors" value={counts.ERROR} icon={Warning} tone="border-rose-100 bg-rose-50 text-rose-800" />
          <InboxMetric label="Ignored" value={counts.IGNORED} icon={Prohibit} tone="border-slate-100 bg-slate-50 text-slate-700" />
        </div>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as InboxTab)} className="space-y-4">
          <TabsList className="h-auto flex-wrap justify-start bg-white p-1 shadow-sm">
            <TabsTrigger value="NEEDS_REVIEW">Needs Review ({counts.NEEDS_REVIEW})</TabsTrigger>
            <TabsTrigger value="PROCESSED">Processed ({counts.PROCESSED})</TabsTrigger>
            <TabsTrigger value="ERROR">Errors ({counts.ERROR})</TabsTrigger>
            <TabsTrigger value="IGNORED">Ignored ({counts.IGNORED})</TabsTrigger>
            <TabsTrigger value="SOURCES">Sources / Settings</TabsTrigger>
          </TabsList>

          {(['NEEDS_REVIEW', 'PROCESSED', 'ERROR', 'IGNORED'] as InboxTab[]).map((tab) => (
            <TabsContent key={tab} value={tab} className="m-0">
              {loading ? (
                <Card className="rounded-lg bg-white p-8 text-center text-sm text-muted-foreground">Loading booking email events...</Card>
              ) : filteredEvents.length === 0 ? (
                <EmptyState
                  className="rounded-lg border bg-white p-8"
                  icon={<EnvelopeSimple size={34} weight="thin" />}
                  title={`No ${tabLabels[tab].toLowerCase()} events`}
                  description={notConfigured ? 'Connect the booking-email backend to populate this queue.' : 'No booking email events currently match this tab.'}
                />
              ) : (
                <div className="grid gap-3">
                  {filteredEvents.map((event) => (
                    <BookingEmailEventCard
                      key={event.id}
                      event={event}
                      canUseBackend={canUseBackend}
                      onApprove={approve}
                      onReject={reject}
                      onReprocess={reprocess}
                      onOpenReservation={() => event.reservationId ? navigate('reservations') : requireBackend()}
                      onRequireAdvancedEditor={requireAdvancedEditor}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          ))}

          <TabsContent value="SOURCES" className="m-0">
            <Card className="rounded-lg bg-white py-0 shadow-sm">
              <CardHeader className="border-b px-4 py-3">
                <CardTitle className="text-base">Sources and backend contract</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 p-4">
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="text-sm font-semibold">Configured sources</div>
                    {sources.length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">No mailbox sources are configured in the PMS backend yet.</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {sources.map((source) => (
                          <div key={source.id} className="rounded-md border bg-background p-3 text-sm">
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-semibold">{source.name}</div>
                              <Badge variant="outline" className={source.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-700'}>
                                {source.enabled ? 'Enabled' : 'Disabled'}
                              </Badge>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">{source.mailbox || source.provider}</div>
                            {source.lastError && <div className="mt-2 text-xs text-rose-700">{source.lastError}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="text-sm font-semibold">Required backend routes</div>
                    <div className="mt-3 grid gap-1.5 text-xs text-muted-foreground">
                      <code>GET /api/booking-email/status</code>
                      <code>POST /api/booking-email/sync</code>
                      <code>GET /api/booking-email/events</code>
                      <code>GET /api/booking-email/events/:id</code>
                      <code>POST /api/booking-email/events/:id/approve</code>
                      <code>POST /api/booking-email/events/:id/reject</code>
                      <code>POST /api/booking-email/events/:id/reprocess</code>
                      <code>GET /api/booking-email/sources</code>
                      <code>POST /api/booking-email/sources</code>
                      <code>PATCH /api/booking-email/sources/:id</code>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}

function InboxMetric({ label, value, icon: Icon, tone }: { label: string; value: number; icon: Icon; tone: string }) {
  return (
    <Card className="rounded-lg bg-white py-0 shadow-sm">
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <div className="text-xs font-semibold text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        </div>
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-md border', tone)}>
          <Icon size={20} weight="duotone" />
        </div>
      </CardContent>
    </Card>
  )
}

function BookingEmailEventCard({
  event,
  canUseBackend,
  onApprove,
  onReject,
  onReprocess,
  onOpenReservation,
  onRequireAdvancedEditor,
}: {
  event: BookingEmailEvent
  canUseBackend: boolean
  onApprove: (event: BookingEmailEvent) => void
  onReject: (event: BookingEmailEvent) => void
  onReprocess: (event: BookingEmailEvent) => void
  onOpenReservation: () => void
  onRequireAdvancedEditor: () => void
}) {
  const backendTitle = canUseBackend ? undefined : 'Requires booking-email backend routes.'

  return (
    <Card className="rounded-lg bg-white py-0 shadow-sm">
      <CardContent className="grid gap-3 p-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn('border', statusTone(event.status))}>{tabLabels[event.status]}</Badge>
            <Badge variant="outline">{formatEventType(event.eventType)}</Badge>
            <Badge variant="outline">{confidenceLabel(event.confidence)}</Badge>
            {event.duplicateOfEventId && <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-800">Possible duplicate</Badge>}
          </div>

          <div>
            <div className="truncate text-base font-semibold">{event.guestName || event.parsedDetails?.guestName || 'Guest not extracted'}</div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{event.sourceName || event.source}</span>
              <span>{event.sender}</span>
              <span>{formatReceived(event.receivedAt)}</span>
              {event.channelRef && <span>Ref {event.channelRef}</span>}
            </div>
          </div>

          <div className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <EventFact label="Stay" value={`${formatDate(event.checkIn || event.parsedDetails?.checkIn)} - ${formatDate(event.checkOut || event.parsedDetails?.checkOut)}`} />
            <EventFact label="Room type" value={event.roomType || event.parsedDetails?.roomType || 'Not extracted'} />
            <EventFact label="Amount / payment" value={amountLabel(event)} />
            <EventFact label="Reservation" value={event.reservationConfirmation || event.reservationId || 'Not matched'} />
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="font-medium">Operational reason</div>
            <div className="mt-1 text-muted-foreground">{eventReason(event)}</div>
            {event.subject && <div className="mt-2 truncate text-xs text-muted-foreground">Subject: {event.subject}</div>}
          </div>
        </div>

        <div className="flex flex-col gap-2 xl:items-stretch">
          <Button className="justify-start gap-1.5 bg-emerald-600 hover:bg-emerald-700" title={backendTitle} disabled={!canUseBackend || event.status !== 'NEEDS_REVIEW'} onClick={() => onApprove(event)}>
            <CheckCircle size={16} weight="bold" />
            Approve & Apply
          </Button>
          <Button variant="outline" className="justify-start gap-1.5" title={backendTitle} disabled={!canUseBackend || event.status !== 'NEEDS_REVIEW'} onClick={onRequireAdvancedEditor}>
            <ListMagnifyingGlass size={16} weight="bold" />
            Edit Parsed Details Then Apply
          </Button>
          <Button variant="outline" className="justify-start gap-1.5" title={backendTitle} disabled={!canUseBackend || event.status !== 'NEEDS_REVIEW'} onClick={onRequireAdvancedEditor}>
            <LinkSimple size={16} weight="bold" />
            Link / Create Reservation
          </Button>
          <Button variant="outline" className="justify-start gap-1.5" title={backendTitle} disabled={!canUseBackend || event.status === 'PROCESSED'} onClick={() => onReject(event)}>
            <Prohibit size={16} weight="bold" />
            Reject / Ignore
          </Button>
          <Button variant="outline" className="justify-start gap-1.5" title={backendTitle} disabled={!canUseBackend} onClick={() => onReprocess(event)}>
            <ArrowsClockwise size={16} weight="bold" />
            Reprocess
          </Button>
          <div className="grid grid-cols-2 gap-2">
            {event.rawEmailUrl ? (
              <Button variant="outline" className="gap-1.5" asChild>
                <a href={event.rawEmailUrl} target="_blank" rel="noreferrer">
                  <EnvelopeSimple size={15} weight="bold" />
                  Raw
                </a>
              </Button>
            ) : (
              <Button variant="outline" className="gap-1.5" disabled>
                <EnvelopeSimple size={15} weight="bold" />
                Raw
              </Button>
            )}
            <Button variant="outline" className="gap-1.5" onClick={onOpenReservation}>
              <Receipt size={15} weight="bold" />
              Reservation
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function EventFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-medium">{value}</div>
    </div>
  )
}
