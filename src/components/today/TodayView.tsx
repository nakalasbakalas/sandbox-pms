import { useEffect, useMemo, useState } from 'react'
import { useKV } from '@github/spark/hooks'
import { format } from 'date-fns'
import {
  Bed,
  Broom,
  CalendarBlank,
  CurrencyCircleDollar,
  EnvelopeSimple,
  House,
  SignIn,
  SignOut,
  Users,
  Warning,
} from '@phosphor-icons/react'
import type { BoardRoomCard } from '@/types/board'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { MoneyDisplay } from '@/components/ui/money-display'
import { StatusPill } from '@/components/ui/status-pill'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useNavigation } from '@/hooks/use-navigation'
import { useRoomSync } from '@/hooks/use-room-sync'
import { useBookingEmailInbox } from '@/hooks/use-booking-email-inbox'
import { formatBangkokDate, formatBangkokTime, useI18n } from '@/lib/i18n'
import { SANDBOX_HOTEL_RULES } from '@/lib/hotel/business-rules'
import { getOperationalRoomStatus, isRoomReadyForArrival } from '@/lib/hotel/rooms'
import { cn } from '@/lib/utils'
import type { PropertySetup } from '@/types/onboarding'
import type { NavigationRoute } from '@/types/navigation'
import type { BookingEmailEvent } from '@/types/booking-email'

interface UnassignedReservation {
  id: string
  guestName: string
  roomType: 'TWIN' | 'DOUBLE'
  checkIn?: string | Date
  checkOut?: string | Date
  source?: string
  needsAttention?: boolean
}

interface ActionItem {
  id: string
  label: string
  detail: string
  route: NavigationRoute
  actionLabel: string
  statusGroup: 'room' | 'payment' | 'reservation'
  status: string
  amount?: number
}

function toInputDate(date: Date) {
  return format(date, 'yyyy-MM-dd')
}

function isSameInputDate(value: Date | string | undefined, inputDate: string) {
  if (!value) return false
  return format(value instanceof Date ? value : new Date(value), 'yyyy-MM-dd') === inputDate
}

function getAvailableTonight(rooms: BoardRoomCard[]) {
  return rooms.filter((room) =>
    room.operationalStatus === 'AVAILABLE' &&
    (room.status === 'VACANT_CLEAN' || room.status === 'VACANT_DIRTY') &&
    !room.reservationId
  )
}

function buildActionQueue(
  rooms: BoardRoomCard[],
  unassignedReservations: UnassignedReservation[],
  emailEvents: BookingEmailEvent[],
  inputDate: string,
  t: ReturnType<typeof useI18n>['t'],
): ActionItem[] {
  const emailActions = emailEvents
    .filter((event) => event.status === 'NEEDS_REVIEW' || event.status === 'ERROR')
    .slice(0, 4)
    .map<ActionItem>((event) => ({
      id: `booking-email-${event.id}`,
      label: event.guestName || event.parsedDetails?.guestName || 'Booking email event',
      detail: `${event.sourceName || event.source} · ${event.channelRef || event.sender} · ${event.reviewReason || event.errorReason || 'Needs staff review'}`,
      route: 'booking-inbox',
      actionLabel: event.status === 'ERROR' ? 'Review error' : 'Review email',
      statusGroup: 'reservation',
      status: event.status === 'ERROR' ? 'blocked' : 'pending',
      amount: event.amount,
    }))

  const unassignedActions = unassignedReservations
    .filter((reservation) => !reservation.checkIn || isSameInputDate(reservation.checkIn, inputDate))
    .map<ActionItem>((reservation) => ({
      id: `unassigned-${reservation.id}`,
      label: reservation.guestName,
      detail: `${reservation.roomType} · ${reservation.source ?? 'Direct'} · room not assigned`,
      route: 'board',
      actionLabel: t('today.assignRoom'),
      statusGroup: 'reservation',
      status: reservation.needsAttention ? 'pending' : 'confirmed',
    }))

  const arrivalActions = rooms
    .filter((room) => isSameInputDate(room.checkIn, inputDate) && room.guestName)
    .filter((room) => !isRoomReadyForArrival(room) || room.depositStatus === 'PENDING' || !!room.balanceDue)
    .map<ActionItem>((room) => ({
      id: `arrival-${room.roomId}`,
      label: `${room.guestName}`,
      detail: `Room ${room.number} · ${room.type} · arrival needs readiness check`,
      route: room.depositStatus === 'PENDING' || room.balanceDue ? 'cashier' : 'housekeeping',
      actionLabel: room.depositStatus === 'PENDING' || room.balanceDue ? t('today.takePayment') : t('today.markRoomClean'),
      statusGroup: room.depositStatus === 'PENDING' || room.balanceDue ? 'payment' : 'room',
      status: room.depositStatus === 'PENDING' || room.balanceDue ? 'partial' : getOperationalRoomStatus(room),
      amount: room.balanceDue,
    }))

  const departureActions = rooms
    .filter((room) => isSameInputDate(room.checkOut, inputDate) && room.guestName)
    .filter((room) => !!room.balanceDue)
    .map<ActionItem>((room) => ({
      id: `departure-${room.roomId}`,
      label: `${room.guestName}`,
      detail: `Room ${room.number} · balance must be settled before check-out`,
      route: 'cashier',
      actionLabel: t('today.takePayment'),
      statusGroup: 'payment',
      status: 'unpaid',
      amount: room.balanceDue,
    }))

  const housekeepingActions = rooms
    .filter((room) => room.cleanStatus === 'DIRTY')
    .slice(0, 4)
    .map<ActionItem>((room) => ({
      id: `hk-${room.roomId}`,
      label: `Room ${room.number}`,
      detail: `${room.type} · dirty room requires housekeeping`,
      route: 'housekeeping',
      actionLabel: t('today.markRoomClean'),
      statusGroup: 'room',
      status: 'dirty',
    }))

  return [...emailActions, ...unassignedActions, ...arrivalActions, ...departureActions, ...housekeepingActions].slice(0, 12)
}

export function TodayView() {
  const { t, language } = useI18n()
  const { navigate } = useNavigation()
  const { rooms } = useRoomSync()
  const { events: bookingEmailEvents, status: bookingEmailStatus, notConfigured: bookingEmailNotConfigured } = useBookingEmailInbox()
  const [unassignedReservations] = useKV<UnassignedReservation[]>('unassigned-reservations', [])
  const [propertyData] = useKV<PropertySetup>('onboarding-property', {} as PropertySetup)
  const [selectedDate, setSelectedDate] = useState(() => toInputDate(new Date()))
  const [lastUpdated, setLastUpdated] = useState(() => new Date())

  useEffect(() => {
    setLastUpdated(new Date())
  }, [rooms, unassignedReservations, selectedDate])

  const operationalRooms = rooms

  const metrics = useMemo(() => {
    const arrivals = operationalRooms.filter((room) => isSameInputDate(room.checkIn, selectedDate))
    const departures = operationalRooms.filter((room) => isSameInputDate(room.checkOut, selectedDate))
    const inHouse = operationalRooms.filter((room) => room.status === 'OCCUPIED_CLEAN' || room.status === 'OCCUPIED_DIRTY')
    const availableTonight = getAvailableTonight(operationalRooms)
    const dirty = operationalRooms.filter((room) => room.cleanStatus === 'DIRTY' || room.status === 'VACANT_DIRTY' || room.status === 'OCCUPIED_DIRTY')
    const readyForArrival = operationalRooms.filter(isRoomReadyForArrival)
    const paymentIssues = operationalRooms.filter((room) => !!room.balanceDue || room.depositStatus === 'PENDING')
    const emailNeedsReview = bookingEmailEvents.filter((event) => event.status === 'NEEDS_REVIEW')
    const emailErrors = bookingEmailEvents.filter((event) => event.status === 'ERROR')
    const outOfOrder = operationalRooms.filter((room) => room.operationalStatus === 'OUT_OF_ORDER' || room.operationalStatus === 'OUT_OF_SERVICE' || room.operationalStatus === 'BLOCKED')
    const earlyArrivals = arrivals.filter((room) => room.checkIn && new Date(room.checkIn).getHours() < 14)
    const lateCheckouts = departures.filter((room) => room.checkOut && new Date(room.checkOut).getHours() > 11)

    return {
      arrivals,
      departures,
      inHouse,
      availableTonight,
      dirty,
      readyForArrival,
      paymentIssues,
      emailNeedsReview,
      emailErrors,
      outOfOrder,
      unassigned: unassignedReservations.filter((reservation) => !reservation.checkIn || isSameInputDate(reservation.checkIn, selectedDate)),
      earlyArrivals,
      lateCheckouts,
      noShows: 0,
    }
  }, [bookingEmailEvents, operationalRooms, selectedDate, unassignedReservations])

  const actionQueue = useMemo(
    () => buildActionQueue(operationalRooms, unassignedReservations, bookingEmailEvents, selectedDate, t),
    [bookingEmailEvents, operationalRooms, selectedDate, t, unassignedReservations],
  )

  const metricCards = [
    { label: t('today.arrivals'), value: metrics.arrivals.length, icon: SignIn, tone: 'text-sky-700 bg-sky-50 border-sky-100' },
    { label: t('today.departures'), value: metrics.departures.length, icon: SignOut, tone: 'text-amber-700 bg-amber-50 border-amber-100' },
    { label: t('today.inHouse'), value: metrics.inHouse.length, icon: Users, tone: 'text-indigo-700 bg-indigo-50 border-indigo-100' },
    { label: t('today.availableTonight'), value: metrics.availableTonight.length, icon: House, tone: 'text-emerald-700 bg-emerald-50 border-emerald-100' },
    { label: t('today.dirtyRooms'), value: metrics.dirty.length, icon: Broom, tone: 'text-orange-700 bg-orange-50 border-orange-100' },
    { label: t('today.readyRooms'), value: metrics.readyForArrival.length, icon: Bed, tone: 'text-teal-700 bg-teal-50 border-teal-100' },
    { label: t('today.paymentIssues'), value: metrics.paymentIssues.length, icon: CurrencyCircleDollar, tone: 'text-rose-700 bg-rose-50 border-rose-100' },
    { label: t('today.unassigned'), value: metrics.unassigned.length, icon: Warning, tone: 'text-yellow-800 bg-yellow-50 border-yellow-100' },
    { label: 'Booking emails', value: metrics.emailNeedsReview.length + metrics.emailErrors.length, icon: EnvelopeSimple, tone: 'text-fuchsia-800 bg-fuchsia-50 border-fuchsia-100' },
    { label: 'Out of order', value: metrics.outOfOrder.length, icon: Warning, tone: 'text-slate-800 bg-slate-50 border-slate-200' },
  ]

  return (
    <div className="min-h-full bg-[#f7f4ef]">
      <section className="border-b border-black/10 bg-[#25211d] text-white">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-5 lg:flex-row lg:items-end lg:justify-between lg:px-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#d8a15f]">
              <CalendarBlank size={15} weight="bold" />
              {propertyData?.name || 'Hotel'} · {propertyData?.defaultCheckIn || SANDBOX_HOTEL_RULES.checkInTime} / {propertyData?.defaultCheckOut || SANDBOX_HOTEL_RULES.checkOutTime}
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{t('today.title')}</h1>
              <p className="mt-1 text-sm text-white/65">{t('today.subtitle')}</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="space-y-1">
              <span className="text-xs font-medium text-white/70">{t('today.date')}</span>
              <Input
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="h-9 border-white/15 bg-white text-foreground"
              />
            </label>
            <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
              <div>{t('today.lastUpdated')}</div>
              <div className="font-semibold text-white">{formatBangkokTime(lastUpdated, language)}</div>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-4 lg:px-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metricCards.map((metric) => (
            <Card key={metric.label} className="rounded-lg border bg-white py-0 shadow-sm">
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-muted-foreground">{metric.label}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{metric.value}</div>
                </div>
                <div className={cn('flex h-10 w-10 items-center justify-center rounded-md border', metric.tone)}>
                  <metric.icon size={20} weight="duotone" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <Card className="rounded-lg border bg-white py-0 shadow-sm">
            <CardHeader className="border-b px-4 py-3">
              <CardTitle className="text-base">{t('today.actionQueue')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {actionQueue.length === 0 ? (
                <EmptyState
                  className="m-4"
                  icon={<CalendarBlank size={34} weight="thin" />}
                  title={t('today.noActions')}
                  description={formatBangkokDate(selectedDate, language, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead>{t('common.guest')}</TableHead>
                      <TableHead>{t('common.status')}</TableHead>
                      <TableHead>{t('common.balance')}</TableHead>
                      <TableHead className="text-right">{t('common.action')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {actionQueue.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="font-semibold">{item.label}</div>
                          <div className="text-xs text-muted-foreground">{item.detail}</div>
                        </TableCell>
                        <TableCell>
                          <StatusPill group={item.statusGroup} status={item.status} />
                        </TableCell>
                        <TableCell>
                          {item.amount ? <MoneyDisplay amount={item.amount} className="font-semibold text-rose-700" /> : <span className="text-muted-foreground">{t('common.none')}</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => navigate(item.route)}>
                            {item.actionLabel}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="rounded-lg border bg-white py-0 shadow-sm">
              <CardHeader className="border-b px-4 py-3">
                <CardTitle className="text-base">{t('today.quickActions')}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 p-4">
                <Button className="justify-start" onClick={() => navigate('board')}>
                  <House size={16} weight="bold" />
                  {t('today.openBoard')}
                </Button>
                <Button variant="outline" className="justify-start" onClick={() => navigate('housekeeping')}>
                  <Broom size={16} weight="bold" />
                  {t('today.openHousekeeping')}
                </Button>
                <Button variant="outline" className="justify-start" onClick={() => navigate('cashier')}>
                  <CurrencyCircleDollar size={16} weight="bold" />
                  {t('today.openCashier')}
                </Button>
                <Button variant="outline" className="justify-start" onClick={() => navigate('booking-inbox')}>
                  <EnvelopeSimple size={16} weight="bold" />
                  Booking Inbox
                </Button>
                <Button variant="outline" className="justify-start" onClick={() => navigate('reservations')}>
                  <CalendarBlank size={16} weight="bold" />
                  {t('today.createReservation')}
                </Button>
              </CardContent>
            </Card>

            <Card className="rounded-lg border bg-white py-0 shadow-sm">
              <CardHeader className="border-b px-4 py-3">
                <CardTitle className="text-base">{t('today.watchList')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-4 text-sm">
                <WatchItem label={t('today.earlyArrivals')} value={metrics.earlyArrivals.length} />
                <WatchItem label={t('today.lateCheckouts')} value={metrics.lateCheckouts.length} />
                <WatchItem label={t('today.noShows')} value={metrics.noShows} />
                <WatchItem label="Email processing errors" value={metrics.emailErrors.length} />
                <WatchItem label="Mailbox not configured" value={bookingEmailNotConfigured && !bookingEmailStatus?.configured ? 1 : 0} />
                <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                  {t('common.taxInclusive')} · Asia/Bangkok · 24-hour time
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

function WatchItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-semibold tabular-nums', value > 0 ? 'text-amber-700' : 'text-emerald-700')}>{value}</span>
    </div>
  )
}
