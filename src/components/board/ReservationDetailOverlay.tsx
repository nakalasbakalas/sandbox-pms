import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { differenceInCalendarDays, format } from 'date-fns'
import {
  Bed,
  CaretDown,
  CheckCircle,
  CreditCard,
  EnvelopeSimple,
  FileText,
  Pencil,
  Printer,
  Receipt,
  SignIn,
  SignOut,
  Trash,
  Users,
  X,
} from '@phosphor-icons/react'

import type { BoardRoomCard } from '@/types/board'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { ReservationDocumentAction } from '@/lib/reservation-document-actions'
import { cn } from '@/lib/utils'

export type ReservationStatusAction = 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT'
export type ReservationExtraItemCategory = 'EXTRA_GUEST' | 'CHILD' | 'CAFE' | 'LAUNDRY' | 'MINIBAR' | 'DAMAGE' | 'OTHER'

export interface ReservationExtraItemDraft {
  category: ReservationExtraItemCategory
  description: string
  quantity: number
  unitPrice: number
}

export interface ReservationExtraItem {
  id: string
  date: Date | string
  category: ReservationExtraItemCategory | 'ROOM'
  description: string
  quantity: number
  unitPrice: number
  total: number
  postedBy?: string
}

export interface ReservationBillingSummary {
  currency: string
  roomTotal?: number
  extraPersonTotal: number
  extrasTotal: number
  total?: number
  received?: number
  outstanding?: number
  items: ReservationExtraItem[]
}

interface ReservationDetailOverlayProps {
  room: BoardRoomCard
  billing?: ReservationBillingSummary
  onClose: () => void
  onEdit: (room: BoardRoomCard) => void
  onCancelReservation: (room: BoardRoomCard) => void
  onPrint: (room: BoardRoomCard, action: ReservationDocumentAction) => void
  onEmail: (room: BoardRoomCard, action: ReservationDocumentAction) => void
  onAddExtraItem: (room: BoardRoomCard, item: ReservationExtraItemDraft) => void
  onRecordPayment: (room: BoardRoomCard) => void
  onCheckIn: (room: BoardRoomCard) => void
  onCheckOut: (room: BoardRoomCard) => void
  onStatusChange: (room: BoardRoomCard, status: ReservationStatusAction) => void
}

type OverlayTab = 'details' | 'guests' | 'inclusions' | 'extras' | 'payments' | 'notes' | 'invoices'

interface ReservationOverlayDetails {
  guest: ReturnType<typeof splitGuestName>
  checkIn?: Date
  checkOut?: Date
  nights?: number
  reservationId: string
  outstanding?: number
  total?: number
  received?: number
  paymentLabel: string
  status: string
  statusCode: ReservationStatusAction
  email?: string
  phone?: string
}

function parseDate(value?: Date | string) {
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function humanize(value?: string) {
  if (!value) return 'Not recorded'
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatDate(value?: Date) {
  return value ? format(value, 'dd MMM yyyy') : 'Not set'
}

function formatShortDate(value?: Date) {
  return value ? format(value, 'MMM d') : 'Not set'
}

function formatAmount(value?: number, currency = 'THB') {
  return typeof value === 'number' ? `${currency} ${value.toLocaleString()}` : 'Not set'
}

function splitGuestName(name?: string) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
    fullName: parts.length ? parts.join(' ') : 'Guest name required',
  }
}

function checkedIn(room: BoardRoomCard) {
  return room.reservation?.status === 'CHECKED_IN' || room.status === 'OCCUPIED_CLEAN' || room.status === 'OCCUPIED_DIRTY'
}

function Field({
  label,
  value,
  className,
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className="mb-1 block text-[11px] font-medium text-foreground">{label}</span>
      <Input value={value} readOnly className="h-8 truncate bg-background text-xs" />
    </label>
  )
}

function SummaryLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 text-xs', strong && 'font-semibold')}>
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span className={cn('shrink-0 text-right tabular-nums text-foreground', strong && 'text-red-600')}>{value}</span>
    </div>
  )
}

export function ReservationDetailOverlay({
  room,
  billing,
  onClose,
  onEdit,
  onCancelReservation,
  onPrint,
  onEmail,
  onAddExtraItem,
  onRecordPayment,
  onCheckIn,
  onCheckOut,
  onStatusChange,
}: ReservationDetailOverlayProps) {
  const [expanded, setExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState<OverlayTab>('details')

  useEffect(() => {
    setExpanded(false)
    setActiveTab('details')
  }, [room.roomId, room.reservationId, room.currentReservationId])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (expanded) {
        setExpanded(false)
        return
      }
      onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [expanded, onClose])

  const details = useMemo<ReservationOverlayDetails>(() => {
    const guest = splitGuestName(room.guestName || room.reservation?.guestName)
    const checkIn = parseDate(room.checkIn || room.reservation?.checkIn)
    const checkOut = parseDate(room.checkOut || room.reservation?.checkOut)
    const nights = checkIn && checkOut ? Math.max(1, differenceInCalendarDays(checkOut, checkIn)) : undefined
    const reservationId = room.reservationId || room.currentReservationId || room.reservation?.id || `ROOM-${room.number}`
    const outstanding = room.balanceDue ?? room.reservation?.balanceDue
    const reservationTotal = room.reservation?.totalAmount
    const total = typeof reservationTotal === 'number' ? reservationTotal : outstanding
    const received = typeof total === 'number' && typeof outstanding === 'number'
      ? Math.max(0, total - outstanding)
      : undefined
    const paymentLabel = outstanding === 0 || room.depositStatus === 'PAID'
      ? 'Paid'
      : typeof outstanding === 'number' && outstanding > 0
        ? 'Balance due'
        : 'Payment not recorded'
    const rawStatus = room.reservation?.status || (checkedIn(room) ? 'CHECKED_IN' : 'CONFIRMED')
    const statusCode: ReservationStatusAction = rawStatus === 'CHECKED_OUT'
      ? 'CHECKED_OUT'
      : rawStatus === 'CHECKED_IN'
        ? 'CHECKED_IN'
        : 'CONFIRMED'
    const status = humanize(statusCode)

    return {
      guest,
      checkIn,
      checkOut,
      nights,
      reservationId,
      outstanding,
      total,
      received,
      paymentLabel,
      status,
      statusCode,
      email: room.guestEmail || room.reservation?.guestEmail,
      phone: room.guestPhone || room.reservation?.guestPhone,
    }
  }, [room])

  const roomTypeLabel = `${humanize(room.type)} room`
  const guestsLabel = `${room.guestCount || 1} ${(room.guestCount || 1) === 1 ? 'guest' : 'guests'}`
  const canCheckIn = !checkedIn(room)
  const billingSummary = billing || {
    currency: 'THB',
    roomTotal: details.total,
    extraPersonTotal: 0,
    extrasTotal: 0,
    total: details.total,
    received: details.received,
    outstanding: details.outstanding,
    items: [],
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 p-3 sm:p-6" role="dialog" aria-modal="true">
      <div
        className={cn(
          'w-full overflow-hidden rounded-lg border border-border/70 bg-background shadow-2xl transition-all duration-200',
          expanded
            ? 'max-h-[calc(100vh-2rem)] w-[min(1120px,calc(100vw-2rem))] max-w-none'
            : 'mt-6 max-w-[640px] sm:mt-10'
        )}
      >
        {!expanded ? (
          <CompactReservationView
            room={room}
            details={details}
            billing={billingSummary}
            roomTypeLabel={roomTypeLabel}
            guestsLabel={guestsLabel}
            onClose={onClose}
            onExpand={() => setExpanded(true)}
            onCancelReservation={() => onCancelReservation(room)}
            onPrint={(action) => onPrint(room, action)}
            onEmail={(action) => onEmail(room, action)}
            onStatusChange={(status) => onStatusChange(room, status)}
          />
        ) : (
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as OverlayTab)} className="max-h-[calc(100vh-2rem)] gap-0">
            <div className="flex items-center justify-between bg-[#ef6b45]">
              <TabsList className="h-10 w-auto rounded-none bg-transparent p-0 text-white">
                <TabButton value="details">Details</TabButton>
                <TabButton value="guests">Guests</TabButton>
                <TabButton value="inclusions">Inclusions</TabButton>
                <TabButton value="extras">Extra items</TabButton>
                <TabButton value="payments">Payments</TabButton>
                <TabButton value="notes">Notes</TabButton>
                <TabButton value="invoices">Invoices</TabButton>
              </TabsList>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Close reservation"
                onClick={onClose}
                className="mr-2 h-8 w-8 p-0 text-white hover:bg-white/15 hover:text-white"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="max-h-[calc(100vh-7.5rem)] overflow-y-auto">
              <TabsContent value="details" className="m-0">
                <ExpandedDetailsTab
                  room={room}
                  details={details}
                  billing={billingSummary}
                  roomTypeLabel={roomTypeLabel}
                  guestsLabel={guestsLabel}
                  onRecordPayment={() => onRecordPayment(room)}
                />
              </TabsContent>
              <TabsContent value="guests" className="m-0">
                <SimpleTabPanel title="Guest Profile">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="First name" value={details.guest.firstName || 'Not recorded'} />
                    <Field label="Last name" value={details.guest.lastName || 'Not recorded'} />
                    <Field label="Guest count" value={guestsLabel} />
                    <Field label="VIP status" value={room.isVIP ? 'VIP' : 'Standard'} />
                  </div>
                </SimpleTabPanel>
              </TabsContent>
              <TabsContent value="inclusions" className="m-0">
                <SimpleTabPanel title="Inclusions">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <InfoTile icon={<Bed className="h-4 w-4" />} label="Room" value={roomTypeLabel} />
                    <InfoTile icon={<Users className="h-4 w-4" />} label="Occupancy" value={guestsLabel} />
                    <InfoTile icon={<CheckCircle className="h-4 w-4" />} label="Status" value={details.status} />
                  </div>
                </SimpleTabPanel>
              </TabsContent>
              <TabsContent value="extras" className="m-0">
                <ExtraItemsTab
                  billing={billingSummary}
                  onAddExtraItem={(item) => onAddExtraItem(room, item)}
                />
              </TabsContent>
              <TabsContent value="payments" className="m-0">
                <SimpleTabPanel title="Payments">
                  <div className="max-w-md space-y-3">
                    <SummaryLine label="Reservation total" value={formatAmount(billingSummary.total, billingSummary.currency)} />
                    <SummaryLine label="Total received" value={formatAmount(billingSummary.received, billingSummary.currency)} />
                    <SummaryLine label="Total outstanding" value={formatAmount(billingSummary.outstanding, billingSummary.currency)} strong />
                    <Button onClick={() => onRecordPayment(room)} className="w-full gap-2">
                      <CreditCard className="h-4 w-4" />
                      Record Payment
                    </Button>
                  </div>
                </SimpleTabPanel>
              </TabsContent>
              <TabsContent value="notes" className="m-0">
                <SimpleTabPanel title="Notes">
                  <Textarea value={room.notes || 'No notes recorded'} readOnly className="min-h-32 resize-none text-sm" />
                </SimpleTabPanel>
              </TabsContent>
              <TabsContent value="invoices" className="m-0">
                <SimpleTabPanel title="Invoices">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <InfoTile icon={<Printer className="h-4 w-4" />} label="Registration card" value="Ready to print" />
                    <InfoTile icon={<CreditCard className="h-4 w-4" />} label="Outstanding" value={formatAmount(billingSummary.outstanding, billingSummary.currency)} />
                  </div>
                </SimpleTabPanel>
              </TabsContent>
            </div>

            <div className="flex flex-col gap-2 border-t border-border bg-background px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <Button variant="ghost" size="sm" onClick={() => onCancelReservation(room)} className="justify-start gap-1.5 text-red-600 hover:text-red-700">
                <Trash className="h-4 w-4" />
                Cancel Booking
              </Button>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <EmailDropdown onEmail={(action) => onEmail(room, action)} />
                <PrintDropdown onPrint={(action) => onPrint(room, action)} />
                <Button variant="outline" size="sm" onClick={() => onEdit(room)} className="gap-1.5">
                  <Pencil className="h-4 w-4" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  onClick={() => (canCheckIn ? onCheckIn(room) : onCheckOut(room))}
                  className={cn('gap-1.5', canCheckIn ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700')}
                >
                  {canCheckIn ? <SignIn className="h-4 w-4" /> : <SignOut className="h-4 w-4" />}
                  {canCheckIn ? 'Check In' : 'Check Out'}
                </Button>
                <StatusDropdown
                  status={details.statusCode}
                  label={details.status}
                  onStatusChange={(status) => onStatusChange(room, status)}
                />
                <Button size="sm" variant="secondary" onClick={onClose}>
                  Close
                </Button>
              </div>
            </div>
          </Tabs>
        )}
      </div>
    </div>
  )
}

function CompactReservationView({
  room,
  details,
  billing,
  roomTypeLabel,
  guestsLabel,
  onClose,
  onExpand,
  onCancelReservation,
  onPrint,
  onEmail,
  onStatusChange,
}: {
  room: BoardRoomCard
  details: ReservationOverlayDetails
  billing: ReservationBillingSummary
  roomTypeLabel: string
  guestsLabel: string
  onClose: () => void
  onExpand: () => void
  onCancelReservation: () => void
  onPrint: (action: ReservationDocumentAction) => void
  onEmail: (action: ReservationDocumentAction) => void
  onStatusChange: (status: ReservationStatusAction) => void
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-medium text-foreground">
            Reservation {details.reservationId} for {details.guest.fullName}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{details.status}</Badge>
            {room.isVIP && <Badge className="bg-amber-500 hover:bg-amber-600">VIP</Badge>}
          </div>
        </div>
        <Button variant="ghost" size="sm" aria-label="Close reservation" onClick={onClose} className="h-8 w-8 p-0">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-4 px-4 py-4 md:grid-cols-[1fr_240px]">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">Primary contact</h3>
            <dl className="space-y-2 text-xs">
              <DetailRow label="Guest" value={details.guest.fullName} />
              <DetailRow label="Email" value={details.email || 'Not recorded'} />
              <DetailRow label="Phone" value={details.phone || 'Not recorded'} />
            </dl>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">Reservation details</h3>
            <dl className="space-y-2 text-xs">
              <DetailRow label="Stay" value={details.nights ? `${details.nights} nights` : 'Not set'} />
              <DetailRow label="Dates" value={`${formatShortDate(details.checkIn)} - ${formatShortDate(details.checkOut)}`} />
              <DetailRow label="Rooms" value={`${roomTypeLabel}, Room ${room.number}`} />
              <DetailRow label="Guests" value={guestsLabel} />
            </dl>
          </div>
          <div className="sm:col-span-2">
            <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Guest comments</h3>
            <p className="min-h-9 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs text-foreground">
              {room.notes || 'No comments recorded'}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-md border border-green-600 bg-green-100 px-3 py-3 text-green-900">
            <div className="mb-2 text-sm font-semibold">{details.paymentLabel}</div>
            <SummaryLine label="Reservation total" value={formatAmount(billing.total, billing.currency)} />
            <SummaryLine label="Total outstanding" value={formatAmount(billing.outstanding, billing.currency)} />
          </div>
          <div className="flex flex-col items-end gap-1">
            <PrintDropdown onPrint={onPrint} variant="compact" />
            <EmailDropdown onEmail={onEmail} variant="compact" />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" size="sm" onClick={onCancelReservation} className="justify-start gap-1.5 text-red-600 hover:text-red-700">
          <Trash className="h-4 w-4" />
          Cancel reservation
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onExpand} className="min-w-48">
            View reservation
          </Button>
          <StatusDropdown
            status={details.statusCode}
            label={details.status}
            onStatusChange={onStatusChange}
            className="min-w-36"
          />
        </div>
      </div>
    </>
  )
}

function ExpandedDetailsTab({
  room,
  details,
  billing,
  roomTypeLabel,
  guestsLabel,
  onRecordPayment,
}: {
  room: BoardRoomCard
  details: ReservationOverlayDetails
  billing: ReservationBillingSummary
  roomTypeLabel: string
  guestsLabel: string
  onRecordPayment: () => void
}) {
  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <div className="border-b border-border pb-4">
          <div className="grid gap-3 lg:grid-cols-[180px_180px_minmax(0,1fr)]">
            <Field label="Check in" value={formatDate(details.checkIn)} />
            <Field label="Check out" value={formatDate(details.checkOut)} />
            <div className="flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2 self-end text-xs">
              <label className="flex h-8 max-w-full items-center gap-2 rounded-md border border-border bg-background px-3">
                <input type="checkbox" readOnly checked className="h-3.5 w-3.5 shrink-0 accent-[#8c44c7]" />
                <span className="whitespace-nowrap">Keep rates for existing dates</span>
              </label>
              <span className="text-muted-foreground">|</span>
              <span className="whitespace-nowrap">Length of stay: <strong>{details.nights || 0} Nights</strong></span>
              <span className="text-muted-foreground">|</span>
              <span className="whitespace-nowrap">Booking status: <span className="text-green-600">{details.status}</span></span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md bg-muted/40 p-3">
          <div className="grid min-w-[860px] grid-cols-[1.3fr_1.3fr_1fr_.7fr_.8fr_.8fr_1.2fr_.7fr] gap-2">
            <Field label="Room type" value={roomTypeLabel} />
            <Field label="Room rate" value={formatAmount(billing.roomTotal, billing.currency)} />
            <Field label="Room #" value={`Room ${room.number}`} />
            <Field label="Adults" value={String(room.guestCount || 1)} />
            <Field label="Children" value="0" />
            <Field label="Infants" value="0" />
            <Field label="Room" value={formatAmount(billing.roomTotal, billing.currency)} />
            <Field label="Discount" value="0" />
          </div>
        </div>

        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase text-[#ef6b45]">Primary Contact</h3>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="First name" value={details.guest.firstName || 'Not recorded'} />
            <Field label="Last name" value={details.guest.lastName || 'Not recorded'} />
            <Field label="Email" value={details.email || 'Not recorded'} />
            <Field label="Phone number" value={details.phone || 'Not recorded'} />
            <Field label="Address" value="Not recorded" />
            <Field label="City" value="Not recorded" />
            <Field label="Payment" value={details.paymentLabel} />
            <Field label="Other Details" value="Arrival time not set" />
            <Field label="ID document type" value="Not recorded" />
            <Field label="ID document number" value="Not recorded" />
            <Field label="Source of reservation" value="Board" />
          </div>
          <label className="mt-3 block">
            <span className="mb-1 block text-[11px] font-medium text-foreground">Guest comments</span>
            <Textarea value={room.notes || 'No comments recorded'} readOnly className="min-h-16 resize-none text-xs" />
          </label>
        </section>
      </div>

      <aside className="rounded-md bg-muted/50 p-4">
        <h3 className="mb-4 text-base font-semibold">Booking Summary</h3>
        <div className="space-y-2">
          <SummaryLine label="Room Total" value={formatAmount(billing.roomTotal, billing.currency)} />
          <SummaryLine label="Extra Person Total" value={formatAmount(billing.extraPersonTotal, billing.currency)} />
          <SummaryLine label="Extras Total" value={formatAmount(billing.extrasTotal, billing.currency)} />
          <SummaryLine label="Discount Total" value={formatAmount(0, billing.currency)} />
          <SummaryLine label="Credit Card Surcharges" value={formatAmount(0, billing.currency)} />
          <div className="my-4 border-t border-border" />
          <SummaryLine label="Total" value={formatAmount(billing.total, billing.currency)} />
          <SummaryLine label="Total Received" value={formatAmount(billing.received, billing.currency)} />
          <div className="my-4 border-t border-border" />
          <SummaryLine label="Total Outstanding" value={formatAmount(billing.outstanding, billing.currency)} strong />
          <Button variant="outline" className="mt-4 w-full" size="sm" onClick={onRecordPayment}>
            Record Payment
          </Button>
        </div>
        <div className="mt-4 rounded-md border border-border bg-background p-3 text-xs">
          <div className="font-semibold text-foreground">Reservation</div>
          <div className="mt-1 text-muted-foreground">{details.reservationId}</div>
          <div className="mt-2 text-muted-foreground">{roomTypeLabel}, {guestsLabel}</div>
        </div>
      </aside>
    </div>
  )
}

function TabButton({ value, children }: { value: OverlayTab; children: ReactNode }) {
  return (
    <TabsTrigger
      value={value}
      className="h-10 rounded-none border-0 px-4 text-xs font-semibold uppercase text-white shadow-none data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-none"
    >
      {children}
    </TabsTrigger>
  )
}

function ExtraItemsTab({
  billing,
  onAddExtraItem,
}: {
  billing: ReservationBillingSummary
  onAddExtraItem: (item: ReservationExtraItemDraft) => void
}) {
  const [category, setCategory] = useState<ReservationExtraItemCategory>('OTHER')
  const [description, setDescription] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const amount = Number(unitPrice)
    const qty = Number(quantity)

    if (!description.trim()) {
      setError('Description is required.')
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Unit amount must be greater than zero.')
      return
    }
    if (!Number.isInteger(qty) || qty < 1) {
      setError('Quantity must be at least 1.')
      return
    }

    onAddExtraItem({
      category,
      description: description.trim(),
      quantity: qty,
      unitPrice: amount,
    })
    setDescription('')
    setUnitPrice('')
    setQuantity('1')
    setCategory('OTHER')
    setError(null)
  }

  return (
    <SimpleTabPanel title="Extra Items">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <div className="rounded-md border border-border">
            <div className="grid grid-cols-[120px_1fr_64px_96px] gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-semibold uppercase text-muted-foreground">
              <span>Category</span>
              <span>Description</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Total</span>
            </div>
            {billing.items.length ? billing.items.map((item) => (
              <div key={item.id} className="grid grid-cols-[120px_1fr_64px_96px] gap-2 border-b border-border/60 px-3 py-2 text-xs last:border-b-0">
                <span className="truncate font-medium">{humanize(item.category)}</span>
                <span className="min-w-0 truncate">{item.description}</span>
                <span className="text-right tabular-nums">{item.quantity}</span>
                <span className="text-right tabular-nums">{formatAmount(item.total, billing.currency)}</span>
              </div>
            )) : (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No billable extras posted yet.
              </div>
            )}
          </div>

          <div className="grid gap-3 rounded-md border border-border bg-background p-3 md:grid-cols-[180px_minmax(0,1fr)_110px_90px_auto]">
            <div className="space-y-1.5">
              <Label className="text-[11px]">Category</Label>
              <Select value={category} onValueChange={(value) => setCategory(value as ReservationExtraItemCategory)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EXTRA_GUEST">Extra guest</SelectItem>
                  <SelectItem value="CHILD">Child</SelectItem>
                  <SelectItem value="CAFE">Cafe</SelectItem>
                  <SelectItem value="MINIBAR">Minibar</SelectItem>
                  <SelectItem value="LAUNDRY">Laundry</SelectItem>
                  <SelectItem value="DAMAGE">Damage</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reservation-extra-description" className="text-[11px]">Description</Label>
              <Input
                id="reservation-extra-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="h-8 text-xs"
                placeholder="Late checkout, minibar, laundry"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reservation-extra-unit" className="text-[11px]">Unit amount</Label>
              <Input
                id="reservation-extra-unit"
                type="number"
                min="0.01"
                step="0.01"
                value={unitPrice}
                onChange={(event) => setUnitPrice(event.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reservation-extra-quantity" className="text-[11px]">Qty</Label>
              <Input
                id="reservation-extra-quantity"
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex items-end">
              <Button type="button" size="sm" onClick={submit} className="h-8 w-full">
                Add
              </Button>
            </div>
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive md:col-span-5">
                {error}
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-2 rounded-md bg-muted/50 p-4">
          <SummaryLine label="Room total" value={formatAmount(billing.roomTotal, billing.currency)} />
          <SummaryLine label="Extra person total" value={formatAmount(billing.extraPersonTotal, billing.currency)} />
          <SummaryLine label="Extras total" value={formatAmount(billing.extrasTotal, billing.currency)} />
          <div className="my-3 border-t border-border" />
          <SummaryLine label="Reservation total" value={formatAmount(billing.total, billing.currency)} />
          <SummaryLine label="Outstanding" value={formatAmount(billing.outstanding, billing.currency)} strong />
        </aside>
      </div>
    </SimpleTabPanel>
  )
}

function PrintDropdown({
  onPrint,
  variant = 'default',
}: {
  onPrint: (action: ReservationDocumentAction) => void
  variant?: 'default' | 'compact'
}) {
  const buttonClass = variant === 'compact'
    ? 'gap-1.5 text-xs text-blue-600'
    : 'gap-1.5'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={buttonClass}>
          <Printer className="h-4 w-4" />
          Print
          <CaretDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => onPrint('invoice')}>
          <Receipt className="mr-2 h-4 w-4" />
          Invoice
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPrint('summary')}>
          <FileText className="mr-2 h-4 w-4" />
          Summary
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPrint('confirmation')}>
          <CheckCircle className="mr-2 h-4 w-4" />
          Confirmation
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPrint('registration-card')}>
          <Users className="mr-2 h-4 w-4" />
          Registration form
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function EmailDropdown({
  onEmail,
  variant = 'default',
}: {
  onEmail: (action: ReservationDocumentAction) => void
  variant?: 'default' | 'compact'
}) {
  const buttonClass = variant === 'compact'
    ? 'gap-1.5 text-xs text-blue-600'
    : 'gap-1.5'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={buttonClass}>
          <EnvelopeSimple className="h-4 w-4" />
          Email
          <CaretDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => onEmail('confirmation')}>
          <EnvelopeSimple className="mr-2 h-4 w-4" />
          Confirmation email
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onEmail('registration-card')}>
          <Printer className="mr-2 h-4 w-4" />
          Registration card email
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function StatusDropdown({
  status,
  label,
  onStatusChange,
  className,
}: {
  status: ReservationStatusAction
  label: string
  onStatusChange: (status: ReservationStatusAction) => void
  className?: string
}) {
  const options: Array<{ value: ReservationStatusAction; label: string; icon: ReactNode }> = [
    { value: 'CONFIRMED', label: 'Confirmed', icon: <CheckCircle className="mr-2 h-4 w-4" /> },
    { value: 'CHECKED_IN', label: 'Check in', icon: <SignIn className="mr-2 h-4 w-4" /> },
    { value: 'CHECKED_OUT', label: 'Check out', icon: <SignOut className="mr-2 h-4 w-4" /> },
  ]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className={cn('min-w-28 bg-[#ef7d1f] hover:bg-[#dc6f16]', className)}>
          {label}
          <CaretDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            disabled={status === option.value}
            onClick={() => onStatusChange(option.value)}
          >
            {option.icon}
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-2">
      <dt className="font-semibold text-muted-foreground">{label}:</dt>
      <dd className="min-w-0 break-words text-foreground">{value}</dd>
    </div>
  )
}

function SimpleTabPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="p-4">
      <h3 className="mb-4 text-base font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function InfoTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  )
}
