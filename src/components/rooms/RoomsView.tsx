import { useEffect, useMemo, useState } from 'react'
import { Bed, Broom, House, SquaresFour } from '@phosphor-icons/react'
import type { BoardRoomCard } from '@/types/board'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { MoneyDisplay } from '@/components/ui/money-display'
import { RoomStatusBadge } from '@/components/ui/status-pill'
import { useNavigation } from '@/hooks/use-navigation'
import { useRoomSync } from '@/hooks/use-room-sync'
import { formatBangkokTime, useI18n } from '@/lib/i18n'
import { getOperationalRoomStatus, isRoomReadyForArrival } from '@/lib/hotel/rooms'
import { cn } from '@/lib/utils'
import { useKV } from '@github/spark/hooks'
import type { PropertySetup, RoomTypeSetup } from '@/types/onboarding'

interface RoomSectionData {
  id: string
  title: string
  rooms: BoardRoomCard[]
}

function roomSort(a: BoardRoomCard, b: BoardRoomCard) {
  const floorDelta = (a.floor || 0) - (b.floor || 0)
  if (floorDelta !== 0) return floorDelta
  return String(a.number).localeCompare(String(b.number), undefined, { numeric: true })
}

function normalizeRoomTypeLabel(value?: string) {
  return String(value || '')
    .trim()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function RoomTile({ room, onOpen }: { room: BoardRoomCard; onOpen: () => void }) {
  const { t } = useI18n()
  const status = getOperationalRoomStatus(room)
  const isReady = isRoomReadyForArrival(room)

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'min-h-[116px] rounded-lg border bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        status === 'occupied' && 'border-sky-200 bg-sky-50/50',
        status === 'dirty' && 'border-orange-200 bg-orange-50/60',
        status === 'blocked' && 'border-slate-300 bg-slate-100',
        status === 'out_of_order' && 'border-red-200 bg-red-50/60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xl font-semibold tabular-nums">{room.number}</div>
          <div className="text-xs font-medium uppercase text-muted-foreground">{room.type}</div>
        </div>
        <RoomStatusBadge status={status} />
      </div>
      <div className="mt-3 min-h-8 text-xs">
        {room.guestName ? (
          <>
            <div className="truncate font-semibold text-foreground">{room.guestName}</div>
            <div className="mt-1 text-muted-foreground">
              {room.balanceDue ? <MoneyDisplay amount={room.balanceDue} className="font-semibold text-rose-700" /> : t('common.balance') + ': 0'}
            </div>
          </>
        ) : (
          <div className="text-muted-foreground">{isReady ? t('rooms.ready') : t('common.none')}</div>
        )}
      </div>
    </button>
  )
}

export function RoomsView() {
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

  const operationalRooms = rooms

  const roomTypeLabels = useMemo(() => {
    const labels = new Map<string, string>()
    for (const roomType of rateRoomTypes || []) {
      if (roomType.id && roomType.name) labels.set(roomType.id, roomType.name)
    }
    for (const roomType of configuredRoomTypes || []) {
      if (roomType.id && roomType.name) labels.set(roomType.id, roomType.name)
    }
    return labels
  }, [configuredRoomTypes, rateRoomTypes])

  const roomSections = useMemo<RoomSectionData[]>(() => {
    const roomTypeOrder = new Map<string, number>()
    const orderedRoomTypes = configuredRoomTypes.length > 0 ? configuredRoomTypes : rateRoomTypes
    orderedRoomTypes.forEach((roomType, index) => {
      if (roomType.id) roomTypeOrder.set(roomType.id, index)
    })

    const groups = new Map<string, RoomSectionData>()
    operationalRooms.forEach((room) => {
      const id = room.roomTypeId || room.roomType || room.type || 'unknown'
      const title = roomTypeLabels.get(id) || normalizeRoomTypeLabel(room.type || id) || t('rooms.title')
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
  }, [configuredRoomTypes, operationalRooms, rateRoomTypes, roomTypeLabels, t])

  const statusCounts = useMemo(() => {
    const counts = { ready: 0, occupied: 0, dirty: 0, blocked: 0 }
    operationalRooms.forEach((room) => {
      const status = getOperationalRoomStatus(room)
      if (isRoomReadyForArrival(room)) counts.ready += 1
      if (status === 'occupied') counts.occupied += 1
      if (status === 'dirty') counts.dirty += 1
      if (status === 'blocked' || status === 'out_of_order') counts.blocked += 1
    })
    return counts
  }, [operationalRooms])

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
            <Button onClick={() => navigate('board')}>
              <SquaresFour size={16} weight="bold" />
              {t('nav.frontDeskBoard')}
            </Button>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-4 lg:px-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <RoomSummary label={t('rooms.ready')} value={statusCounts.ready} icon={House} tone="text-emerald-700 bg-emerald-50 border-emerald-100" />
          <RoomSummary label={t('rooms.occupied')} value={statusCounts.occupied} icon={Bed} tone="text-sky-700 bg-sky-50 border-sky-100" />
          <RoomSummary label={t('rooms.dirty')} value={statusCounts.dirty} icon={Broom} tone="text-orange-700 bg-orange-50 border-orange-100" />
          <RoomSummary label={t('rooms.blocked')} value={statusCounts.blocked} icon={SquaresFour} tone="text-slate-700 bg-slate-100 border-slate-200" />
        </div>

        {roomSections.map((section) => (
          <RoomSection key={section.id} title={section.title} rooms={section.rooms} onOpenRoom={() => navigate('board')} />
        ))}
      </div>
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

function RoomSection({ title, rooms, onOpenRoom }: { title: string; rooms: BoardRoomCard[]; onOpenRoom: (room: BoardRoomCard) => void }) {
  const counts = rooms.reduce(
    (summary, room) => {
      const status = getOperationalRoomStatus(room)
      if (isRoomReadyForArrival(room)) summary.ready += 1
      if (status === 'occupied') summary.occupied += 1
      if (status === 'dirty') summary.dirty += 1
      if (status === 'blocked' || status === 'out_of_order') summary.blocked += 1
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
          <RoomTile key={room.roomId} room={room} onOpen={() => onOpenRoom(room)} />
        ))}
      </div>
    </section>
  )
}
