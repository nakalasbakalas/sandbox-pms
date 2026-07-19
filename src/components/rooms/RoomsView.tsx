import { useEffect, useMemo, useState } from 'react'
import { parseISO, startOfDay } from 'date-fns'
import { Bed, Broom, House, SquaresFour } from '@phosphor-icons/react'
import type { BoardRoomCard } from '@/types/board'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { MoneyDisplay } from '@/components/ui/money-display'
import { RoomStatusBadge } from '@/components/ui/status-pill'
import { useNavigation } from '@/hooks/use-navigation'
import { useRoomSync } from '@/hooks/use-room-sync'
import { useServerBookingBoard } from '@/hooks/use-server-booking-board'
import { useAuth } from '@/hooks/use-auth'
import { formatBangkokTime, useI18n } from '@/lib/i18n'
import { getBangkokDateKey } from '@/lib/hotel/business-rules'
import { getOperationalRoomStatus, isRoomReadyForArrival } from '@/lib/hotel/rooms'
import { cn } from '@/lib/utils'
import { SERVER_API_ENABLED } from '@/lib/pms-api-client'
import { useKV } from '@github/spark/hooks'
import type { PropertySetup, RoomTypeSetup } from '@/types/onboarding'

interface RoomSectionData {
  id: string
  title: string
  rooms: RoomCardView[]
}

type RoomDisplayStatus = ReturnType<typeof getOperationalRoomStatus>

interface RoomCardView {
  roomId: string
  number: string
  floor: number
  roomTypeId?: string
  roomTypeCode?: string
  roomTypeName?: string
  status: RoomDisplayStatus
  ready: boolean
  guestName?: string
  balanceDue?: number
}

function roomSort(a: RoomCardView, b: RoomCardView) {
  const floorDelta = (a.floor || 0) - (b.floor || 0)
  if (floorDelta !== 0) return floorDelta
  return String(a.number).localeCompare(String(b.number), undefined, { numeric: true })
}

function normalizeRoomTypeLabel(value?: string) {
  return String(value || '')
    .trim()
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function roomTypeKey(room: RoomCardView) {
  return String(room.roomTypeId || room.roomTypeCode || 'unknown').trim() || 'unknown'
}

function roomTypeLabel(room: RoomCardView, configuredLabels: Map<string, string>) {
  const key = roomTypeKey(room)
  return configuredLabels.get(key)
    || room.roomTypeName
    || configuredLabels.get(room.roomTypeCode || '')
    || normalizeRoomTypeLabel(room.roomTypeCode || key)
    || 'Room Type'
}

function RoomTile({ room, onOpen, showBalance }: { room: RoomCardView; onOpen: () => void; showBalance: boolean }) {
  const { t } = useI18n()
  const displayType = room.roomTypeName || normalizeRoomTypeLabel(room.roomTypeCode)

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'min-h-[116px] rounded-lg border bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        room.status === 'occupied' && 'border-sky-200 bg-sky-50/50',
        room.status === 'dirty' && 'border-orange-200 bg-orange-50/60',
        room.status === 'blocked' && 'border-slate-300 bg-slate-100',
        room.status === 'out_of_order' && 'border-red-200 bg-red-50/60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xl font-semibold tabular-nums">{room.number}</div>
          <div className="text-xs font-medium uppercase text-muted-foreground">{displayType}</div>
        </div>
        <RoomStatusBadge status={room.status} />
      </div>
      <div className="mt-3 min-h-8 text-xs">
        {room.guestName ? (
          <>
            <div className="truncate font-semibold text-foreground">{room.guestName}</div>
            {showBalance && room.balanceDue !== undefined && (
              <div className="mt-1 text-muted-foreground">
                <MoneyDisplay amount={room.balanceDue} className="font-semibold text-rose-700" />
              </div>
            )}
          </>
        ) : (
          <div className="text-muted-foreground">{room.ready ? t('rooms.ready') : t('common.none')}</div>
        )}
      </div>
    </button>
  )
}

export function RoomsView() {
  return SERVER_API_ENABLED ? <ServerRoomsView /> : <DemoRoomsView />
}

function serverToday() {
  return startOfDay(parseISO(getBangkokDateKey(new Date())))
}

function serverRoomsToCards(
  data: NonNullable<ReturnType<typeof useServerBookingBoard>['data']>,
  canViewCashier: boolean,
): RoomCardView[] {
  const today = getBangkokDateKey(new Date())
  const reservationsByRoom = new Map(data.reservations
    .filter((reservation) => (
      reservation.assignedRoomId
      && reservation.status === 'CHECKED_IN'
      && reservation.checkIn <= today
      && reservation.checkOut > today
    ))
    .map((reservation) => [reservation.assignedRoomId as string, reservation]))

  return data.rooms.map((room) => {
    const reservation = reservationsByRoom.get(room.id)
    const status: RoomDisplayStatus = room.operationalStatus === 'BLOCKED'
      ? 'blocked'
      : room.operationalStatus === 'OUT_OF_ORDER' || room.operationalStatus === 'OUT_OF_SERVICE'
        ? 'out_of_order'
        : reservation || room.currentStatus.startsWith('OCCUPIED')
          ? 'occupied'
          : room.currentStatus === 'VACANT_DIRTY' || room.currentStatus === 'CLEANING'
            ? 'dirty'
            : room.currentStatus === 'INSPECTED'
              ? 'inspected'
              : room.currentStatus === 'VACANT_CLEAN'
                ? 'clean'
                : 'available'
    return {
      roomId: room.id,
      number: room.number,
      floor: room.floor,
      roomTypeId: room.roomType.id,
      roomTypeCode: room.roomType.code,
      roomTypeName: room.roomType.name,
      status,
      ready: room.operationalStatus === 'AVAILABLE'
        && !reservation
        && (room.currentStatus === 'VACANT_CLEAN' || room.currentStatus === 'INSPECTED'),
      guestName: reservation?.guestName || undefined,
      balanceDue: canViewCashier && reservation?.balance !== null ? reservation?.balance ?? undefined : undefined,
    }
  })
}

function demoRoomToCard(room: BoardRoomCard): RoomCardView {
  return {
    roomId: room.roomId,
    number: room.number,
    floor: room.floor,
    roomTypeId: room.roomTypeId,
    roomTypeCode: room.roomTypeCode || room.roomType,
    roomTypeName: room.roomTypeName,
    status: getOperationalRoomStatus(room),
    ready: isRoomReadyForArrival(room),
    guestName: room.guestName,
    balanceDue: room.balanceDue,
  }
}

function QuickLinks() {
  const { navigate } = useNavigation()
  const { hasPermission } = useAuth()
  const { t } = useI18n()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
        Authoritative server snapshot
      </div>
      {hasPermission('view:housekeeping') && (
        <Button variant="outline" onClick={() => navigate('housekeeping')}>
          <Broom size={16} weight="bold" />
          {t('nav.housekeeping')}
        </Button>
      )}
      {hasPermission('view:board') && (
        <Button onClick={() => navigate('front-desk')}>
          <SquaresFour size={16} weight="bold" />
          {t('nav.frontDeskBoard')}
        </Button>
      )}
    </div>
  )
}

function ServerRoomsView() {
  const { t } = useI18n()
  const { navigate } = useNavigation()
  const { hasPermission } = useAuth()
  const { data, loading, error, reload } = useServerBookingBoard(serverToday(), 7)
  const canViewCashier = hasPermission('view:cashier')
  const rooms = useMemo(() => data ? serverRoomsToCards(data, canViewCashier) : [], [canViewCashier, data])
  const roomTypeLabels = useMemo(() => new Map((data?.roomTypes || []).flatMap((roomType) => [
    [roomType.id, roomType.name],
    [roomType.code, roomType.name],
  ])), [data?.roomTypes])
  const roomTypeOrder = useMemo(() => new Map((data?.roomTypes || []).flatMap((roomType, index) => [
    [roomType.id, index],
    [roomType.code, index],
  ])), [data?.roomTypes])

  if (loading) {
    return (
      <div className="min-h-full bg-[#f7f4ef] p-6" aria-busy="true">
        <Card className="mx-auto max-w-3xl p-6">
          <div className="text-lg font-semibold">Loading authoritative rooms…</div>
          <div className="mt-1 text-sm text-muted-foreground">Retrieving the current room and stay snapshot from the PMS.</div>
        </Card>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-full bg-[#f7f4ef] p-6">
        <Card data-testid="server-rooms-error" className="mx-auto max-w-3xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold">Rooms unavailable</h1>
              <p className="mt-1 text-sm text-muted-foreground">{error || 'The PMS did not return an authoritative room snapshot. Browser data is not shown.'}</p>
            </div>
            <Button onClick={reload}>Retry</Button>
          </div>
        </Card>
      </div>
    )
  }

  const roomSections = buildRoomSections(rooms, roomTypeLabels, roomTypeOrder)
  const statusCounts = roomStatusCounts(rooms)
  return (
    <div data-testid="server-rooms-view" className="min-h-full bg-[#f7f4ef]">
      <section className="border-b bg-white">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#9a6535]">
              <Bed size={15} weight="bold" />
              {data.propertyDisplay.name}
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t('rooms.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('rooms.subtitle')}</p>
          </div>
          <QuickLinks />
        </div>
      </section>
      <RoomsContent rooms={rooms} roomSections={roomSections} statusCounts={statusCounts} onOpenRoom={() => navigate('board')} showBalance={canViewCashier} />
    </div>
  )
}

function DemoRoomsView() {
  const { t, language } = useI18n()
  const { navigate } = useNavigation()
  const { rooms } = useRoomSync()
  const [propertyData] = useKV<PropertySetup>('onboarding-property', {} as PropertySetup)
  const [configuredRoomTypes] = useKV<RoomTypeSetup[]>('onboarding-room-types', [])
  const [rateRoomTypes] = useKV<Array<{ id: string; code?: string; name: string }>>('room-types-config', [])
  const [lastUpdated, setLastUpdated] = useState(() => new Date())

  useEffect(() => {
    setLastUpdated(new Date())
  }, [rooms])

  const operationalRooms = useMemo(() => rooms.map(demoRoomToCard), [rooms])

  const roomTypeLabels = useMemo(() => {
    const labels = new Map<string, string>()
    for (const roomType of rateRoomTypes || []) {
      if (roomType.id && roomType.name) labels.set(roomType.id, roomType.name)
      if (roomType.code && roomType.name) labels.set(roomType.code, roomType.name)
    }
    for (const roomType of configuredRoomTypes || []) {
      if (roomType.id && roomType.name) labels.set(roomType.id, roomType.name)
      if (roomType.code && roomType.name) labels.set(roomType.code, roomType.name)
    }
    return labels
  }, [configuredRoomTypes, rateRoomTypes])

  const roomSections = useMemo<RoomSectionData[]>(() => {
    const roomTypeOrder = new Map<string, number>()
    const orderedRoomTypes = configuredRoomTypes.length > 0 ? configuredRoomTypes : rateRoomTypes
    orderedRoomTypes.forEach((roomType, index) => {
      if (roomType.id) roomTypeOrder.set(roomType.id, index)
      if (roomType.code) roomTypeOrder.set(roomType.code, index)
    })

    const groups = new Map<string, RoomSectionData>()
    operationalRooms.forEach((room) => {
      const id = roomTypeKey(room)
      const title = roomTypeLabel(room, roomTypeLabels)
      const current = groups.get(id) || { id, title, rooms: [] }
      current.rooms.push(room)
      groups.set(id, current)
    })

    return Array.from(groups.values())
      .map((section) => ({ ...section, rooms: [...section.rooms].sort(roomSort) }))
      .sort((a, b) => {
        const orderDelta = (roomTypeOrder.get(a.id) ?? 999) - (roomTypeOrder.get(b.id) ?? 999)
        if (orderDelta !== 0) return orderDelta
        return a.title.localeCompare(b.title)
      })
  }, [configuredRoomTypes, operationalRooms, rateRoomTypes, roomTypeLabels])

  const statusCounts = useMemo(() => roomStatusCounts(operationalRooms), [operationalRooms])

  return (
    <div className="min-h-full bg-[#f7f4ef]">
      <section className="border-b bg-white">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#9a6535]">
              <Bed size={15} weight="bold" />
              {propertyData?.name || 'Hotel'}
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t('rooms.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('rooms.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {t('today.lastUpdated')}: <span className="font-semibold text-foreground">{formatBangkokTime(lastUpdated, language)}</span>
            </div>
            <Button variant="outline" onClick={() => navigate('housekeeping')}>
              <Broom size={16} weight="bold" />
              {t('nav.housekeeping')}
            </Button>
            <Button onClick={() => navigate('front-desk')}>
              <SquaresFour size={16} weight="bold" />
              {t('nav.frontDeskBoard')}
            </Button>
          </div>
        </div>
      </section>

      <RoomsContent rooms={operationalRooms} roomSections={roomSections} statusCounts={statusCounts} onOpenRoom={() => navigate('front-desk')} showBalance />
    </div>
  )
}

function buildRoomSections(rooms: RoomCardView[], labels: Map<string, string>, order: Map<string, number>) {
  const groups = new Map<string, RoomSectionData>()
  rooms.forEach((room) => {
    const id = roomTypeKey(room)
    const title = roomTypeLabel(room, labels)
    const current = groups.get(id) || { id, title, rooms: [] }
    current.rooms.push(room)
    groups.set(id, current)
  })
  return Array.from(groups.values())
    .map((section) => ({ ...section, rooms: [...section.rooms].sort(roomSort) }))
    .sort((left, right) => (order.get(left.id) ?? 999) - (order.get(right.id) ?? 999) || left.title.localeCompare(right.title))
}

function roomStatusCounts(rooms: RoomCardView[]) {
  const counts = { ready: 0, occupied: 0, dirty: 0, blocked: 0 }
  rooms.forEach((room) => {
    if (room.ready) counts.ready += 1
    if (room.status === 'occupied') counts.occupied += 1
    if (room.status === 'dirty') counts.dirty += 1
    if (room.status === 'blocked' || room.status === 'out_of_order') counts.blocked += 1
  })
  return counts
}

function RoomsContent({ rooms, roomSections, statusCounts, onOpenRoom, showBalance }: {
  rooms: RoomCardView[]
  roomSections: RoomSectionData[]
  statusCounts: { ready: number; occupied: number; dirty: number; blocked: number }
  onOpenRoom: (room: RoomCardView) => void
  showBalance: boolean
}) {
  const { t } = useI18n()
  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-4 lg:px-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <RoomSummary label={t('rooms.ready')} value={statusCounts.ready} icon={House} tone="text-emerald-700 bg-emerald-50 border-emerald-100" />
        <RoomSummary label={t('rooms.occupied')} value={statusCounts.occupied} icon={Bed} tone="text-sky-700 bg-sky-50 border-sky-100" />
        <RoomSummary label={t('rooms.dirty')} value={statusCounts.dirty} icon={Broom} tone="text-orange-700 bg-orange-50 border-orange-100" />
        <RoomSummary label={t('rooms.blocked')} value={statusCounts.blocked} icon={SquaresFour} tone="text-slate-700 bg-slate-100 border-slate-200" />
      </div>
      {rooms.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">No rooms are configured for this property.</Card>
      ) : roomSections.map((section) => (
        <RoomSection key={section.id} title={section.title} rooms={section.rooms} onOpenRoom={onOpenRoom} showBalance={showBalance} />
      ))}
    </div>
  )
}

function RoomSummary({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: number
  icon: typeof House
  tone: string
}) {
  return (
    <Card className="rounded-lg bg-white py-0">
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

function RoomSection({ title, rooms, onOpenRoom, showBalance }: { title: string; rooms: RoomCardView[]; onOpenRoom: (room: RoomCardView) => void; showBalance: boolean }) {
  const counts = rooms.reduce(
    (summary, room) => {
      if (room.ready) summary.ready += 1
      if (room.status === 'occupied') summary.occupied += 1
      if (room.status === 'dirty') summary.dirty += 1
      if (room.status === 'blocked' || room.status === 'out_of_order') summary.blocked += 1
      return summary
    },
    { ready: 0, occupied: 0, dirty: 0, blocked: 0 },
  )

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h2>
        <span className="text-xs text-muted-foreground">
          {rooms.length} rooms · {counts.ready} ready · {counts.occupied} occupied · {counts.dirty} dirty · {counts.blocked} blocked
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-[repeat(15,minmax(0,1fr))]">
        {rooms.map((room) => (
          <RoomTile key={room.roomId} room={room} onOpen={() => onOpenRoom(room)} showBalance={showBalance} />
        ))}
      </div>
    </section>
  )
}
