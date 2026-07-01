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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { bookingEmailApi, SERVER_API_ENABLED } from '@/lib/pms-api-client'
import { resolveBookingEmailCapabilities } from '@/lib/booking-email-capabilities'
import {
  bookingEmailActionRequiresReason,
  bookingEmailDefaultApprovalMode,
  bookingEmailDetailsForm,
  buildBookingEmailApprovePayload,
  type BookingEmailApprovalMode,
  type BookingEmailDetailsForm,
} from '@/lib/booking-email-workflow'
import { useBookingEmailInbox } from '@/hooks/use-booking-email-inbox'
import { useNavigation } from '@/hooks/use-navigation'
import { cn } from '@/lib/utils'
import type { BookingEmailEvent, BookingEmailEventStatus } from '@/types/booking-email'

type InboxTab = 'NEEDS_REVIEW' | 'PROCESSED' | 'ERROR' | 'IGNORED' | 'SOURCES'

type BookingEmailActionDialog = {
  kind: 'edit' | 'link'
  event: BookingEmailEvent
  form: BookingEmailDetailsForm
  mode: BookingEmailApprovalMode
  reservationId: string
  reason: string
}

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
  return `${event.currency || 'THB'} ${event.amount.toLocaleString('en-US')}${event.paymentStatus ? ` - ${event.paymentStatus}` : ''}`
}

function statusTone(status: BookingEmailEventStatus) {
  if (status === 'NEEDS_REVIEW') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (status === 'PROCESSED') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'ERROR') return 'border-rose-200 bg-rose-50 text-rose-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function credentialModeLabel(mode?: string) {
  if (mode === 'access_token') return 'Gmail access token'
  if (mode === 'refresh_token') return 'Gmail refresh token'
  if (mode === 'not-required') return 'No mailbox credential required'
  return 'Not configured'
}

export function BookingInboxView() {
  const { events, sources, status, loading, error, notConfigured, apiAvailable, mode, reload } = useBookingEmailInbox()
  const { navigate } = useNavigation()
  const [activeTab, setActiveTab] = useState<InboxTab>('NEEDS_REVIEW')
  const [actionDialog, setActionDialog] = useState<BookingEmailActionDialog | null>(null)
  const authToken = null
  const capabilities = resolveBookingEmailCapabilities({
    serverApiEnabled: SERVER_API_ENABLED,
    apiAvailable,
    mailboxConfigured: !notConfigured,
  })
  const canUseBackend = capabilities.canApplyEvents
  const canSyncMailbox = capabilities.canSyncMailbox

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
    toast.info('Booking-email API routes are required before this action can apply PMS changes.')
  }

  const requireMailboxConfig = () => {
    toast.info('Mailbox sync needs server-side Gmail or OAuth credentials before it can fetch new mail.')
  }

  const openEditDialog = (event: BookingEmailEvent) => {
    setActionDialog({
      kind: 'edit',
      event,
      form: bookingEmailDetailsForm(event),
      mode: 'apply_parsed',
      reservationId: event.reservationId || '',
      reason: '',
    })
  }

  const openLinkDialog = (event: BookingEmailEvent) => {
    setActionDialog({
      kind: 'link',
      event,
      form: bookingEmailDetailsForm(event),
      mode: event.eventType === 'NEW_BOOKING' && !event.reservationId ? 'create_reservation' : 'link_reservation',
      reservationId: event.reservationId || '',
      reason: '',
    })
  }

  const updateActionForm = (field: keyof BookingEmailDetailsForm, value: string) => {
    setActionDialog((current) => current ? { ...current, form: { ...current.form, [field]: value } } : current)
  }

  const submitActionDialog = async () => {
    if (!actionDialog) return
    if (!canUseBackend) {
      requireBackend()
      return
    }
    if (bookingEmailActionRequiresReason(actionDialog.event) && !actionDialog.reason.trim()) {
      toast.error('Cancellation email actions require an operational reason.')
      return
    }
    try {
      const payload = buildBookingEmailApprovePayload({
        mode: actionDialog.mode,
        form: actionDialog.form,
        reservationId: actionDialog.reservationId,
        reason: actionDialog.reason,
      })
      const result = await bookingEmailApi.approveEvent(authToken, actionDialog.event.id, payload)
      toast.success(result.message || 'Booking email event applied.')
      setActionDialog(null)
      await reload()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not apply booking email event.')
    }
  }

  const handleSync = async () => {
    if (!canUseBackend) {
      requireBackend()
      return
    }
    if (!canSyncMailbox) {
      requireMailboxConfig()
      return
    }
    try {
      const payload = await bookingEmailApi.sync(authToken)
      toast.success(payload.message || 'Booking email sync started.')
      if (payload.hotelOpsCommands?.accepted) {
        toast.success(`${payload.hotelOpsCommands.accepted} Hotel Ops command${payload.hotelOpsCommands.accepted === 1 ? '' : 's'} queued from allowlisted email.`)
      }
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
    const requiresReason = bookingEmailActionRequiresReason(event)
    const reason = requiresReason
      ? window.prompt('Operational reason for applying this cancellation email?')?.trim()
      : undefined
    if (requiresReason && !reason) {
      toast.error('Cancellation email actions require an operational reason.')
      return
    }
    const mode = bookingEmailDefaultApprovalMode(event)
    try {
      const payload = await bookingEmailApi.approveEvent(authToken, event.id, { mode, reservationId: event.reservationId, reason })
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
                  <div className="font-semibold">{capabilities.bannerTitle || 'Booking-email attention needed'}</div>
                  <p className="mt-1 text-sm text-amber-900/80">
                    {error || status?.message || 'Configure booking-email connectivity before staff can sync new mailbox events.'}
                  </p>
                  {canUseBackend && !canSyncMailbox && (
                    <p className="mt-1 text-xs text-amber-900/70">
                      Review, approve, reject, and reprocess actions remain available for events already in the PMS.
                    </p>
                  )}
                  <p className="mt-1 text-xs text-amber-900/70">
                    Current mode: {mode === 'local-draft' ? 'local draft data only' : 'server API checked'}.
                    {status?.credentialMode ? ` Mailbox credential: ${credentialModeLabel(status.credentialMode)}.` : ''}
                  </p>
                </div>
              </div>
              <Button variant="outline" className="border-amber-300 bg-white/70" onClick={() => setActiveTab('SOURCES')}>
                View source settings
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
                  description={!canUseBackend
                    ? 'Connect the booking-email backend to populate this queue.'
                    : !canSyncMailbox
                      ? 'Mailbox sync credentials are missing; no imported events currently match this tab.'
                      : 'No booking email events currently match this tab.'}
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
                      onEditDetails={openEditDialog}
                      onLinkOrCreate={openLinkDialog}
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
                    <div className="mt-2 text-xs text-muted-foreground">
                      Mailbox credential mode: {credentialModeLabel(status?.credentialMode)}
                    </div>
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
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold">Backend route contract</div>
                      <Badge variant="outline" className={apiAvailable ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}>
                        {apiAvailable ? 'API available' : 'API not available'}
                      </Badge>
                    </div>
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
      <Dialog open={Boolean(actionDialog)} onOpenChange={(open) => !open && setActionDialog(null)}>
        {actionDialog && (
          <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{actionDialog.kind === 'edit' ? 'Edit Parsed Details Then Apply' : 'Link or Create Reservation'}</DialogTitle>
              <DialogDescription>
                {actionDialog.kind === 'edit'
                  ? 'Correct the extracted booking details before applying the email event through the backend service.'
                  : 'Link this email event to an existing reservation or create a reservation from the extracted details.'}
              </DialogDescription>
            </DialogHeader>

            {actionDialog.kind === 'link' && (
              <div className="grid gap-2">
                <Label htmlFor="booking-email-action-mode">Action</Label>
                <select
                  id="booking-email-action-mode"
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  value={actionDialog.mode}
                  onChange={(event) => setActionDialog((current) => current ? { ...current, mode: event.target.value as BookingEmailApprovalMode } : current)}
                >
                  <option value="link_reservation">Link existing reservation</option>
                  {actionDialog.event.eventType === 'NEW_BOOKING' && <option value="create_reservation">Create reservation from parsed details</option>}
                </select>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <BookingEmailField label="Guest name" value={actionDialog.form.guestName} onChange={(value) => updateActionForm('guestName', value)} />
              <BookingEmailField label="Guest email" value={actionDialog.form.guestEmail} onChange={(value) => updateActionForm('guestEmail', value)} />
              <BookingEmailField label="Guest phone" value={actionDialog.form.guestPhone} onChange={(value) => updateActionForm('guestPhone', value)} />
              <BookingEmailField label="Channel reference" value={actionDialog.form.channelRef} onChange={(value) => updateActionForm('channelRef', value)} />
              <BookingEmailField label="Check-in" type="date" value={actionDialog.form.checkIn} onChange={(value) => updateActionForm('checkIn', value)} />
              <BookingEmailField label="Check-out" type="date" value={actionDialog.form.checkOut} onChange={(value) => updateActionForm('checkOut', value)} />
              <BookingEmailField label="Room type" value={actionDialog.form.roomType} onChange={(value) => updateActionForm('roomType', value)} />
              <BookingEmailField label="Adults" type="number" value={actionDialog.form.adults} onChange={(value) => updateActionForm('adults', value)} />
              <BookingEmailField label="Children" type="number" value={actionDialog.form.children} onChange={(value) => updateActionForm('children', value)} />
              <BookingEmailField label="Amount" type="number" value={actionDialog.form.amount} onChange={(value) => updateActionForm('amount', value)} />
              <BookingEmailField label="Currency" value={actionDialog.form.currency} onChange={(value) => updateActionForm('currency', value)} />
              <BookingEmailField label="Payment status" value={actionDialog.form.paymentStatus} onChange={(value) => updateActionForm('paymentStatus', value)} />
              <BookingEmailField label="Payment method" value={actionDialog.form.paymentMethod} onChange={(value) => updateActionForm('paymentMethod', value)} />
              <BookingEmailField label="Payment reference" value={actionDialog.form.paymentReference} onChange={(value) => updateActionForm('paymentReference', value)} />
              {actionDialog.kind === 'link' && actionDialog.mode === 'link_reservation' && (
                <BookingEmailField label="Reservation ID" value={actionDialog.reservationId} onChange={(value) => setActionDialog((current) => current ? { ...current, reservationId: value } : current)} />
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="booking-email-special-requests">Special requests</Label>
                <Textarea
                  id="booking-email-special-requests"
                  value={actionDialog.form.specialRequests}
                  onChange={(event) => updateActionForm('specialRequests', event.target.value)}
                  rows={3}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="booking-email-notes">Notes</Label>
                <Textarea
                  id="booking-email-notes"
                  value={actionDialog.form.notes}
                  onChange={(event) => updateActionForm('notes', event.target.value)}
                  rows={3}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="booking-email-action-reason">Operational reason{actionDialog.event.eventType === 'CANCELLATION' ? ' required' : ''}</Label>
              <Textarea
                id="booking-email-action-reason"
                value={actionDialog.reason}
                onChange={(event) => setActionDialog((current) => current ? { ...current, reason: event.target.value } : current)}
                placeholder="Example: Matched OTA cancellation notice to reservation after checking guest name and dates."
                rows={2}
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setActionDialog(null)}>Cancel</Button>
              <Button onClick={() => void submitActionDialog()}>
                {actionDialog.kind === 'edit'
                  ? 'Apply Edited Details'
                  : actionDialog.mode === 'create_reservation'
                    ? 'Create Reservation'
                    : 'Link Reservation'}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
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
  onEditDetails,
  onLinkOrCreate,
}: {
  event: BookingEmailEvent
  canUseBackend: boolean
  onApprove: (event: BookingEmailEvent) => void
  onReject: (event: BookingEmailEvent) => void
  onReprocess: (event: BookingEmailEvent) => void
  onOpenReservation: () => void
  onEditDetails: (event: BookingEmailEvent) => void
  onLinkOrCreate: (event: BookingEmailEvent) => void
}) {
  const backendTitle = canUseBackend ? undefined : 'Requires booking-email API routes.'

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
          <Button variant="outline" className="justify-start gap-1.5" title={backendTitle} disabled={!canUseBackend || event.status !== 'NEEDS_REVIEW'} onClick={() => onEditDetails(event)}>
            <ListMagnifyingGlass size={16} weight="bold" />
            Edit Parsed Details Then Apply
          </Button>
          <Button variant="outline" className="justify-start gap-1.5" title={backendTitle} disabled={!canUseBackend || event.status !== 'NEEDS_REVIEW'} onClick={() => onLinkOrCreate(event)}>
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

function BookingEmailField({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'date' | 'number'
}) {
  const id = `booking-email-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
