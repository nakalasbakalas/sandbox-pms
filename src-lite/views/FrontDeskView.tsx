import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { liteApi } from '../api'
import { EmptyBlock, ErrorBlock, formatMoney, GuestStay, LoadingBlock, StatCard, StatusPill } from '../components'
import { useI18n } from '../i18n'
import type { LiteRole, ReservationSummary, RoomSummary } from '../types'

function hotelDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function ReservationActions({ reservation, rooms, role }: { reservation: ReservationSummary; rooms: RoomSummary[]; role: LiteRole }) {
  const { t, language } = useI18n()
  const queryClient = useQueryClient()
  const [roomId, setRoomId] = useState('')
  const canOperateStay = ['ADMIN', 'MANAGER', 'FRONT_DESK'].includes(role)
  const canOverrideCheckout = ['ADMIN', 'MANAGER'].includes(role)
  const availableRooms = useMemo(
    () => rooms.filter((room) =>
      room.roomTypeId === reservation.roomType.id &&
      room.operationalStatus === 'AVAILABLE' &&
      ['VACANT_CLEAN', 'INSPECTED'].includes(room.housekeepingStatus)
    ),
    [reservation.roomType.id, rooms],
  )
  const mutation = useMutation({
    mutationFn: async ({ action, payload }: { action: 'check-in' | 'check-out' | 'assign-room'; payload?: Record<string, unknown> }) => {
      return liteApi.reservationAction(reservation.id, action, payload)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['lite'] })
      setRoomId('')
    },
  })

  const balance = Number(reservation.folio?.balanceSatang || 0)
  const checkOut = () => {
    if (balance <= 0 || !canOverrideCheckout) {
      mutation.mutate({ action: 'check-out', payload: {} })
      return
    }
    const reason = window.prompt(language === 'th' ? 'มียอดค้างชำระ ระบุเหตุผลสำหรับการอนุมัติข้ามขั้นตอน' : 'A balance remains. Enter the authorized override reason:')
    if (reason?.trim()) {
      mutation.mutate({ action: 'check-out', payload: { allowUnpaidOverride: true, overrideReason: reason.trim() } })
    }
  }

  return (
    <div className="reservation-actions">
      {canOperateStay && !reservation.assignedRoom ? (
        <div className="inline-field">
          <select value={roomId} onChange={(event) => setRoomId(event.target.value)} aria-label={t('assignedRoom')}>
            <option value="">{t('unassigned')}</option>
            {availableRooms.map((room) => <option key={room.id} value={room.id}>{room.number} · {room.roomType.name}</option>)}
          </select>
          <button
            className="button button--secondary"
            disabled={!roomId || mutation.isPending}
            onClick={() => mutation.mutate({ action: 'assign-room', payload: { roomId } })}
          >
            {language === 'th' ? 'จัดห้อง' : 'Assign'}
          </button>
        </div>
      ) : null}
      {canOperateStay && ['PENDING', 'CONFIRMED'].includes(reservation.status) ? (
        <button
          className="button button--primary"
          disabled={!reservation.assignedRoom || !['VACANT_CLEAN', 'INSPECTED'].includes(reservation.assignedRoom.housekeepingStatus) || mutation.isPending}
          onClick={() => mutation.mutate({ action: 'check-in', payload: {} })}
        >
          {t('checkIn')}
        </button>
      ) : null}
      {canOperateStay && reservation.status === 'CHECKED_IN' ? (
        <button className="button button--primary" disabled={mutation.isPending} onClick={checkOut}>{t('checkOut')}</button>
      ) : null}
      {mutation.error ? <span className="inline-error">{mutation.error.message}</span> : null}
    </div>
  )
}

function StaySection({ title, reservations, rooms, role }: { title: string; reservations: ReservationSummary[]; rooms: RoomSummary[]; role: LiteRole }) {
  const { t, language } = useI18n()
  return (
    <section className="panel">
      <header className="panel__header"><h2>{title}</h2><span className="count-badge">{reservations.length}</span></header>
      {reservations.length === 0 ? <EmptyBlock /> : (
        <div className="reservation-list">
          {reservations.map((reservation) => (
            <article key={reservation.id} className="reservation-row">
              <GuestStay reservation={reservation} />
              <div className="reservation-row__meta">
                <StatusPill value={reservation.status} />
                <span>{t('balance')}: <strong>{formatMoney(reservation.folio?.balanceSatang, language)}</strong></span>
              </div>
              <ReservationActions reservation={reservation} rooms={rooms} role={role} />
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export function FrontDeskView({ role }: { role: LiteRole }) {
  const { t } = useI18n()
  const [date, setDate] = useState(hotelDate())
  const query = useQuery({
    queryKey: ['lite', 'front-desk', date],
    queryFn: () => liteApi.frontDesk(date),
    refetchInterval: 30_000,
  })
  const board = useQuery({
    queryKey: ['lite', 'board', date, addDays(date, 14)],
    queryFn: () => liteApi.board(date, addDays(date, 14)),
    refetchInterval: 30_000,
  })

  if (query.isLoading) return <LoadingBlock />
  if (query.error || !query.data) return <ErrorBlock error={query.error || 'Front Desk data unavailable.'} retry={() => query.refetch()} />

  const data = query.data
  const rooms = board.data?.rooms || []
  return (
    <div className="view-stack">
      <header className="view-heading">
        <div><p className="eyebrow">{data.hotelDate}</p><h1>{t('frontDesk')}</h1></div>
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label={t('dateRange')} />
      </header>
      <div className="stats-grid">
        <StatCard label={t('arrivals')} value={data.summary.arrivals} tone="blue" />
        <StatCard label={t('departures')} value={data.summary.departures} tone="gold" />
        <StatCard label={t('inHouse')} value={data.summary.inHouse} tone="green" />
        <StatCard label={t('readyRooms')} value={data.summary.roomsReady} />
        <StatCard label={t('dirtyRooms')} value={data.summary.roomsDirty} tone="warning" />
        <StatCard label={t('paymentBlockers')} value={data.summary.unpaidDepartures} tone="danger" />
      </div>
      <StaySection title={t('arrivals')} reservations={data.arrivals} rooms={rooms} role={role} />
      <StaySection title={t('departures')} reservations={data.departures} rooms={rooms} role={role} />
      <StaySection title={t('inHouse')} reservations={data.inHouse} rooms={rooms} role={role} />
    </div>
  )
}
