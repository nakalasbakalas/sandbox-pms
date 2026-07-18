import { useEffect, useMemo, useState } from 'react'
import {
  addDays,
  differenceInCalendarDays,
  format,
  isSameDay,
  parseISO,
  startOfDay,
} from 'date-fns'
import {
  ArrowClockwise,
  Broom,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  Crown,
  CurrencyDollar,
  EnvelopeSimple,
  LockSimple,
  Plus,
  Users,
  WarningCircle,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NewReservationDialog, type NewReservationData } from '@/components/board/NewReservationDialog'
import { useAuth } from '@/hooks/use-auth'
import { useNavigation } from '@/hooks/use-navigation'
import { useServerBookingBoard } from '@/hooks/use-server-booking-board'
import { getBangkokDateKey } from '@/lib/hotel/business-rules'
import { createPmsIdempotencyKey, PmsApiError, pmsApi } from '@/lib/pms-api-client'
import { durableAttemptKeys, type DurableAttemptDescriptor } from '@/lib/durable-attempt-key'
import type {
  BookingBoardRangeDays,
  ServerBookingBoardReservation,
  ServerBookingBoardRoom,
} from '@/types/server-booking-board'

const RANGE_OPTIONS: BookingBoardRangeDays[] = [7, 14, 30]
const ROOM_COLUMN_WIDTH = 176

function hotelToday() {
  return startOfDay(parseISO(getBangkokDateKey(new Date())))
}

type PositionedReservation = ServerBookingBoardReservation & {
  left: number
  width: number
  lane: number
}

function reservationColor(status: string) {
  switch (status) {
    case 'CHECKED_IN':
      return 'border-emerald-700 bg-emerald-600 text-white'
    case 'CONFIRMED':
      return 'border-blue-700 bg-blue-600 text-white'
    case 'HOLD':
    case 'PENDING':
      return 'border-amber-600 bg-amber-500 text-amber-950'
    default:
      return 'border-slate-600 bg-slate-500 text-white'
  }
}

function roomStatusLabel(room: ServerBookingBoardRoom) {
  if (room.operationalStatus !== 'AVAILABLE') return room.operationalStatus.replaceAll('_', ' ')
  return room.currentStatus.replaceAll('_', ' ')
}

function roomStatusTone(room: ServerBookingBoardRoom) {
  if (room.operationalStatus !== 'AVAILABLE') return 'border-red-300 bg-red-50 text-red-800'
  if (room.currentStatus.includes('DIRTY')) return 'border-amber-300 bg-amber-50 text-amber-800'
  if (room.currentStatus === 'INSPECTED' || room.currentStatus.includes('CLEAN')) {
    return 'border-emerald-300 bg-emerald-50 text-emerald-800'
  }
  return 'border-slate-300 bg-slate-50 text-slate-700'
}

function positionReservations(
  reservations: ServerBookingBoardReservation[],
  rangeStart: Date,
  days: number,
  dayWidth: number,
): PositionedReservation[] {
  const rangeEnd = addDays(rangeStart, days)
  const visible = reservations
    .filter((reservation) => {
      const checkIn = startOfDay(parseISO(reservation.checkIn))
      const checkOut = startOfDay(parseISO(reservation.checkOut))
      return checkIn < rangeEnd && checkOut > rangeStart
    })
    .map((reservation) => {
      const rawStart = differenceInCalendarDays(startOfDay(parseISO(reservation.checkIn)), rangeStart)
      const rawEnd = differenceInCalendarDays(startOfDay(parseISO(reservation.checkOut)), rangeStart)
      const start = Math.max(0, rawStart)
      const end = Math.min(days, Math.max(start + 1, rawEnd))
      return {
        ...reservation,
        left: start * dayWidth,
        width: Math.max(dayWidth * 0.7, (end - start) * dayWidth),
        lane: 0,
        _start: start,
        _end: end,
      }
    })
    .sort((a, b) => a._start - b._start || a._end - b._end)

  const laneEnds: number[] = []
  return visible.map(({ _start, _end, ...reservation }) => {
    let lane = laneEnds.findIndex((laneEnd) => _start >= laneEnd)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(_end)
    } else {
      laneEnds[lane] = _end
    }
    return { ...reservation, lane }
  })
}

function BoardLoading() {
  return (
    <div className="flex min-h-[420px] items-center justify-center">
      <div className="flex items-center gap-3 text-sm text-muted-foreground" role="status">
        <ArrowClockwise className="size-5 animate-spin" />
        Loading the authoritative booking board…
      </div>
    </div>
  )
}

export function ServerBookingBoard() {
  const [days, setDays] = useState<BookingBoardRangeDays>(14)
  const [startDate, setStartDate] = useState(hotelToday)
  const [newReservationOpen, setNewReservationOpen] = useState(false)
  const [selectedReservationId, setSelectedReservationId] = useState<string | null>(null)
  const [plannedCheckIn, setPlannedCheckIn] = useState('')
  const [plannedCheckOut, setPlannedCheckOut] = useState('')
  const [dateDraftDirty, setDateDraftDirty] = useState(false)
  const [mutationInFlight, setMutationInFlight] = useState(false)
  const { data, loading, error, reload, range } = useServerBookingBoard(startDate, days)
  const { hasPermission, hasAnyPermission } = useAuth()
  const { navigate } = useNavigation()
  const canCreate = hasPermission('create:reservation')
  const canEdit = hasPermission('edit:reservation')
  const dayWidth = days === 30 ? 56 : days === 14 ? 76 : 96
  const dateColumns = useMemo(
    () => Array.from({ length: days }, (_, index) => addDays(range.start, index)),
    [days, range.start],
  )

  const groups = useMemo(() => {
    if (!data) return []
    const byType = new Map<string, { name: string; rooms: ServerBookingBoardRoom[] }>()
    for (const room of data.rooms) {
      const key = room.roomType.id || room.roomType.code || room.roomType.name
      const existing = byType.get(key)
      if (existing) existing.rooms.push(room)
      else byType.set(key, { name: room.roomType.name, rooms: [room] })
    }
    return [...byType.entries()]
      .map(([id, group]) => ({
        id,
        name: group.name,
        rooms: group.rooms.sort((a, b) => a.floor - b.floor || a.number.localeCompare(b.number, undefined, { numeric: true })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [data])

  const reservationsByRoom = useMemo(() => {
    const result = new Map<string, ServerBookingBoardReservation[]>()
    for (const reservation of data?.reservations || []) {
      if (!reservation.assignedRoomId) continue
      const current = result.get(reservation.assignedRoomId) || []
      current.push(reservation)
      result.set(reservation.assignedRoomId, current)
    }
    return result
  }, [data])

  const unassignedCount = data?.reservations.filter((reservation) => !reservation.assignedRoomId).length || 0
  const selectedReservation = useMemo(
    () => data?.reservations.find((reservation) => reservation.id === selectedReservationId) || null,
    [data, selectedReservationId],
  )

  useEffect(() => {
    if (!selectedReservation || dateDraftDirty) return
    setPlannedCheckIn(format(parseISO(selectedReservation.checkIn), 'yyyy-MM-dd'))
    setPlannedCheckOut(format(parseISO(selectedReservation.checkOut), 'yyyy-MM-dd'))
  }, [dateDraftDirty, selectedReservation?.checkIn, selectedReservation?.checkOut, selectedReservation?.id, selectedReservation?.updatedAt, selectedReservation?.version])
  const visibleReservationCount = data?.reservations.filter((reservation) => {
    const checkIn = startOfDay(parseISO(reservation.checkIn))
    const checkOut = startOfDay(parseISO(reservation.checkOut))
    return checkIn < range.end && checkOut > range.start
  }).length || 0
  const blocksByRoom = useMemo(() => {
    const result = new Map<string, NonNullable<typeof data>['inventoryBlocks']>()
    for (const block of data?.inventoryBlocks || []) {
      const current = result.get(block.roomId) || []
      current.push(block)
      result.set(block.roomId, current)
    }
    return result
  }, [data])

  const quickLinks = [
    {
      route: 'front-desk' as const,
      label: 'Front Desk Today',
      icon: Users,
      visible: hasAnyPermission(['view:board', 'check-in:guest', 'check-out:guest']),
    },
    {
      route: 'reservations' as const,
      label: 'Reservations',
      icon: CalendarBlank,
      visible: hasPermission('view:reservations'),
    },
    {
      route: 'housekeeping' as const,
      label: 'Housekeeping',
      icon: Broom,
      visible: hasPermission('view:housekeeping'),
    },
    {
      route: 'cashier' as const,
      label: 'Cashier',
      icon: CurrencyDollar,
      visible: hasPermission('view:cashier'),
    },
    {
      route: 'booking-inbox' as const,
      label: 'Booking Inbox',
      icon: EnvelopeSimple,
      visible: hasAnyPermission(['view:reservations', 'view:messaging']),
    },
  ].filter((link) => link.visible)

  const createReservation = async (reservation: NewReservationData) => {
    const response = await pmsApi<{ ok: true; message?: string }>('/api/reservations', null, {
      method: 'POST',
      headers: { 'x-idempotency-key': createPmsIdempotencyKey('booking-board-reservation') },
      body: JSON.stringify({
        guest: {
          firstName: reservation.guest.firstName,
          lastName: reservation.guest.lastName,
          email: reservation.guest.email || undefined,
          phone: reservation.guest.phone || undefined,
          nationality: reservation.guest.nationality || undefined,
          vipStatus: reservation.guest.vipStatus,
        },
        roomTypeCode: reservation.roomTypeCode,
        assignedRoomId: reservation.assignedRoomId || undefined,
        checkIn: getBangkokDateKey(reservation.checkIn),
        checkOut: getBangkokDateKey(reservation.checkOut),
        adults: reservation.adults,
        children: reservation.children,
        childAges: reservation.childAges || [],
        ratePerNight: reservation.ratePerNight,
        source: reservation.source,
        specialRequests: reservation.specialRequests || undefined,
        notes: reservation.notes || undefined,
      }),
    })
    toast.success(response.message || 'Reservation created.')
    setNewReservationOpen(false)
    reload()
  }

  const selectReservation = (reservation: ServerBookingBoardReservation) => {
    setSelectedReservationId(reservation.id)
    setDateDraftDirty(false)
    setPlannedCheckIn(format(parseISO(reservation.checkIn), 'yyyy-MM-dd'))
    setPlannedCheckOut(format(parseISO(reservation.checkOut), 'yyyy-MM-dd'))
  }

  const runBoardMutation = async (attempt: DurableAttemptDescriptor, successMessage: string, request: (idempotencyKey: string) => Promise<unknown>) => {
    const idempotencyKey = await durableAttemptKeys.getOrCreate(attempt)
    setMutationInFlight(true)
    try {
      await request(idempotencyKey)
      await durableAttemptKeys.confirmSuccess(attempt)
      setDateDraftDirty(false)
      toast.success(successMessage)
      reload()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'The server could not apply that booking-board change.')
      if (caught instanceof PmsApiError) {
        // Known HTTP outcomes can safely refetch. A 409 also discards stale local date drafts.
        if (caught.status === 409) setDateDraftDirty(false)
        reload()
      } else {
        // A lost response is ambiguous. Keep this in-memory key so the operator's retry is idempotent.
        toast.message('Connection outcome is unknown. Retry the same action to reuse its protected request key.')
      }
    } finally {
      setMutationInFlight(false)
    }
  }

  const assignSelectedReservation = async (room: ServerBookingBoardRoom) => {
    if (!selectedReservation) return
    const action = selectedReservation.assignedRoomId ? 'move' : 'assign'
    const attempt = {
      operation: 'reservation-assign-room' as const,
      entityId: selectedReservation.id,
      material: { action, roomId: room.id, version: selectedReservation.version },
    }
    await runBoardMutation(
      attempt,
      action === 'move' ? `Moved to Room ${room.number}.` : `Assigned to Room ${room.number}.`,
      (idempotencyKey) => pmsApi(`/api/reservations/${encodeURIComponent(selectedReservation.id)}/assign-room`, null, {
        method: 'POST',
        headers: { 'x-idempotency-key': idempotencyKey },
        body: JSON.stringify({ roomId: room.id }),
      }),
    )
  }

  const resizeSelectedStay = async () => {
    if (!selectedReservation) return
    if (!plannedCheckIn || !plannedCheckOut || plannedCheckIn >= plannedCheckOut) {
      toast.error('Check-out must be after check-in.')
      return
    }
    const attempt = {
      operation: 'reservation-resize-stay' as const,
      entityId: selectedReservation.id,
      material: {
        checkIn: plannedCheckIn,
        checkOut: plannedCheckOut,
        expectedUpdatedAt: selectedReservation.updatedAt,
        version: selectedReservation.version,
      },
    }
    await runBoardMutation(
      attempt,
      'Stay dates updated.',
      (idempotencyKey) => pmsApi(`/api/reservations/${encodeURIComponent(selectedReservation.id)}`, null, {
        method: 'PATCH',
        headers: {
          'x-idempotency-key': idempotencyKey,
          'x-reservation-expected-updated-at': selectedReservation.updatedAt,
          'x-reservation-expected-version': selectedReservation.version,
        },
        body: JSON.stringify({ checkIn: plannedCheckIn, checkOut: plannedCheckOut }),
      }),
    )
  }

  return (
    <div className="flex min-h-full flex-col bg-muted/20">
      <header className="border-b bg-background px-4 py-4 lg:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <CalendarBlank className="size-6 text-primary" weight="duotone" />
              <h1 className="text-xl font-semibold tracking-tight">Booking Board</h1>
              <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">
                Server authoritative
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {data?.propertyDisplay.name || data?.property.name || 'Property'} · {format(range.start, 'd MMM')}–{format(addDays(range.end, -1), 'd MMM yyyy')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-md border bg-background">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Previous ${days} days`}
                onClick={() => setStartDate((current) => addDays(current, -days))}
              >
                <CaretLeft />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setStartDate(hotelToday())}
                disabled={isSameDay(startDate, hotelToday())}
              >
                Today
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Next ${days} days`}
                onClick={() => setStartDate((current) => addDays(current, days))}
              >
                <CaretRight />
              </Button>
            </div>
            <div className="flex rounded-md border bg-muted/40 p-0.5" aria-label="Booking board range">
              {RANGE_OPTIONS.map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={days === option ? 'default' : 'ghost'}
                  onClick={() => setDays(option)}
                  aria-pressed={days === option}
                >
                  {option} days
                </Button>
              ))}
            </div>
            <Button type="button" size="sm" variant="outline" onClick={reload} disabled={loading}>
              <ArrowClockwise className={loading ? 'animate-spin' : ''} />
              Refresh
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setNewReservationOpen(true)}
              disabled={!canCreate || !data || data.roomTypes.length === 0}
              title={canCreate ? 'Create a persisted reservation' : 'Create reservation permission required'}
            >
              {canCreate ? <Plus /> : <LockSimple />}
              New reservation
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary">{data?.rooms.length || 0} rooms</Badge>
          <Badge variant="secondary">{visibleReservationCount} stays in range</Badge>
          {unassignedCount > 0 && (
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
              {unassignedCount} unassigned
            </Badge>
          )}
          {!canEdit && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <LockSimple />
              Reservation changes require edit permission
            </span>
          )}
        </div>

        <nav className="mt-3 flex flex-wrap gap-1.5" aria-label="Front desk workspaces">
          {quickLinks.map((link) => (
            <Button key={link.route} type="button" size="sm" variant="ghost" onClick={() => navigate(link.route)}>
              <link.icon />
              {link.label}
            </Button>
          ))}
        </nav>

        {canEdit && selectedReservation && (
          <section className="mt-4 rounded-lg border bg-muted/30 p-3" aria-label="Selected reservation actions">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{selectedReservation.guestName}</p>
                <p className="text-xs text-muted-foreground">
                  {selectedReservation.confirmationCode} · Select a compatible available room below to {selectedReservation.assignedRoomId ? 'move' : 'assign'}.
                </p>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setSelectedReservationId(null); setDateDraftDirty(false) }} disabled={mutationInFlight}>
                Clear selection
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="grid gap-1 text-xs font-medium">
                Check-in
                <Input type="date" value={plannedCheckIn} onChange={(event) => { setPlannedCheckIn(event.target.value); setDateDraftDirty(true) }} disabled={mutationInFlight} />
              </label>
              <label className="grid gap-1 text-xs font-medium">
                Check-out
                <Input type="date" value={plannedCheckOut} onChange={(event) => { setPlannedCheckOut(event.target.value); setDateDraftDirty(true) }} disabled={mutationInFlight} />
              </label>
              <Button type="button" size="sm" variant="outline" onClick={() => void resizeSelectedStay()} disabled={mutationInFlight}>
                Update stay dates
              </Button>
            </div>
          </section>
        )}

        {canEdit && data && unassignedCount > 0 && (
          <section className="mt-3" aria-label="Unassigned reservations">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Unassigned stays — select one, then choose a room on the board.</p>
            <div className="flex flex-wrap gap-2">
              {data.reservations.filter((reservation) => !reservation.assignedRoomId).map((reservation) => (
                <Button
                  key={reservation.id}
                  type="button"
                  size="sm"
                  variant={selectedReservationId === reservation.id ? 'default' : 'outline'}
                  data-board-reservation-select={reservation.id}
                  onClick={() => selectReservation(reservation)}
                  disabled={mutationInFlight}
                >
                  {reservation.guestName} · {format(parseISO(reservation.checkIn), 'd MMM')}
                </Button>
              ))}
            </div>
          </section>
        )}
      </header>

      {loading && !data ? (
        <BoardLoading />
      ) : error ? (
        <div className="flex min-h-[420px] items-center justify-center p-6">
          <div className="max-w-md rounded-lg border bg-background p-6 text-center shadow-sm" role="alert">
            <WarningCircle className="mx-auto size-8 text-destructive" weight="duotone" />
            <h2 className="mt-3 font-semibold">Booking board unavailable</h2>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <Button className="mt-4" onClick={reload}>
              <ArrowClockwise />
              Retry
            </Button>
          </div>
        </div>
      ) : data && data.rooms.length === 0 ? (
        <div className="flex min-h-[420px] items-center justify-center p-6">
          <div className="max-w-md rounded-lg border bg-background p-6 text-center">
            <h2 className="font-semibold">No rooms configured</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Add rooms and room types in Settings before using the booking board.
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto" data-testid="server-booking-board">
          <div style={{ minWidth: ROOM_COLUMN_WIDTH + days * dayWidth }}>
            <div
              className="sticky top-0 z-30 grid border-b bg-background/95 shadow-sm backdrop-blur"
              style={{ gridTemplateColumns: `${ROOM_COLUMN_WIDTH}px repeat(${days}, ${dayWidth}px)` }}
            >
              <div className="sticky left-0 z-40 flex items-end border-r bg-background px-3 py-2 text-xs font-semibold text-muted-foreground">
                Room / type
              </div>
              {dateColumns.map((date) => (
                <div
                  key={date.toISOString()}
                  className={`border-r px-1 py-2 text-center ${isSameDay(date, hotelToday()) ? 'bg-primary/10 text-primary' : ''}`}
                >
                  <div className="text-[10px] uppercase text-muted-foreground">{format(date, 'EEE')}</div>
                  <div className="text-sm font-semibold">{format(date, 'd')}</div>
                  <div className="text-[10px] text-muted-foreground">{format(date, 'MMM')}</div>
                </div>
              ))}
            </div>

            {groups.map((group) => (
              <section key={group.id}>
                <div className="sticky left-0 z-20 flex h-8 items-center border-b bg-muted px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.name} · {group.rooms.length}
                </div>
                {group.rooms.map((room) => {
                  const positioned = positionReservations(reservationsByRoom.get(room.id) || [], range.start, days, dayWidth)
                  const roomBlocks = blocksByRoom.get(room.id) || []
                  const lanes = Math.max(1, ...positioned.map((reservation) => reservation.lane + 1))
                  const rowHeight = Math.max(54, 12 + lanes * 34)
                  const selectedRoomTypeMatches = !selectedReservation
                    || selectedReservation.roomTypeId === room.roomType.id
                    || selectedReservation.roomTypeCode === room.roomType.code

                  return (
                    <div
                      key={room.id}
                      data-board-room-id={room.id}
                      className="grid border-b bg-background hover:bg-muted/20"
                      style={{
                        gridTemplateColumns: `${ROOM_COLUMN_WIDTH}px ${days * dayWidth}px`,
                        minHeight: rowHeight,
                      }}
                    >
                      <div className="sticky left-0 z-20 flex items-center justify-between gap-2 border-r bg-background px-3 py-2 shadow-[2px_0_3px_-3px_rgba(0,0,0,0.35)]">
                        <div className="min-w-0">
                          <div className="font-semibold">Room {room.number}</div>
                          <div className="text-[10px] text-muted-foreground">Floor {room.floor}</div>
                        </div>
                        <span className={`max-w-[78px] rounded border px-1.5 py-0.5 text-right text-[9px] font-medium uppercase leading-tight ${roomStatusTone(room)}`}>
                          {roomStatusLabel(room)}
                        </span>
                        {canEdit && selectedReservation && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[10px]"
                            data-board-room-action={room.id}
                            disabled={
                              mutationInFlight
                              || selectedReservation.assignedRoomId === room.id
                              || !selectedRoomTypeMatches
                              || room.operationalStatus !== 'AVAILABLE'
                            }
                            onClick={() => void assignSelectedReservation(room)}
                            title={selectedRoomTypeMatches
                              ? 'The PMS validates availability, inventory blocks, and concurrent changes before saving.'
                              : `${selectedReservation.roomTypeName} cannot be assigned to this ${room.roomType.name} room.`}
                          >
                            {selectedReservation.assignedRoomId ? 'Move here' : 'Assign'}
                          </Button>
                        )}
                      </div>
                      <div
                        className="relative"
                        style={{
                          height: rowHeight,
                          backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${dayWidth - 1}px, var(--border) ${dayWidth - 1}px, var(--border) ${dayWidth}px)`,
                        }}
                      >
                        {roomBlocks.map((block) => {
                          const offset = differenceInCalendarDays(startOfDay(parseISO(block.date)), range.start)
                          if (offset < 0 || offset >= days) return null
                          return (
                            <div
                              key={block.id}
                              className="absolute inset-y-0 z-[1] border-x border-red-300 bg-red-100/70"
                              style={{ left: offset * dayWidth, width: dayWidth }}
                              title={`${block.status.replaceAll('_', ' ')}${block.notes ? `: ${block.notes}` : ''}`}
                              aria-label={`Room ${room.number} blocked on ${format(parseISO(block.date), 'd MMM')}`}
                            />
                          )
                        })}
                        {positioned.map((reservation) => {
                          const content = (
                            <>
                              {reservation.isVip && <Crown className="size-3 shrink-0" weight="fill" />}
                              <span className="truncate font-semibold">{reservation.guestName}</span>
                              <span className="hidden truncate opacity-80 lg:inline">· {reservation.confirmationCode}</span>
                            </>
                          )
                          const selected = reservation.id === selectedReservationId
                          const className = `absolute z-[2] flex h-7 items-center gap-1 overflow-hidden rounded border px-2 text-[11px] shadow-sm ${reservationColor(reservation.status)} ${selected ? 'ring-2 ring-primary ring-offset-1' : ''}`
                          const style = {
                            left: reservation.left + 2,
                            top: 6 + reservation.lane * 34,
                            width: Math.max(38, reservation.width - 4),
                          }
                          const title = `${reservation.guestName} · ${format(parseISO(reservation.checkIn), 'd MMM')} to ${format(parseISO(reservation.checkOut), 'd MMM')} · ${reservation.status.replaceAll('_', ' ')}`

                          return canEdit ? (
                            <button
                              key={reservation.id}
                              type="button"
                              className={`${className} cursor-pointer text-left ring-offset-background hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                              data-board-reservation-id={reservation.id}
                              style={style}
                              title={`${title}. Select to change dates or move rooms.`}
                              aria-pressed={selected}
                              onClick={() => selectReservation(reservation)}
                            >
                              {content}
                            </button>
                          ) : (
                            <div key={reservation.id} className={className} style={style} title={title}>
                              {content}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </section>
            ))}
          </div>
        </div>
      )}

      <footer className="border-t bg-background px-4 py-2 text-xs text-muted-foreground">
        Booking Board changes are validated and persisted by the PMS. Room availability, blocks, room type, and concurrency conflicts are verified by the server before a change is accepted.
      </footer>

      <NewReservationDialog
        open={newReservationOpen}
        onClose={() => setNewReservationOpen(false)}
        onSubmit={createReservation}
        roomTypes={data?.roomTypes || []}
        propertyDisplay={data?.propertyDisplay}
      />
    </div>
  )
}
