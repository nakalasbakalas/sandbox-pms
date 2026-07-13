import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { liteApi } from '../api'
import { EmptyBlock, ErrorBlock, GuestStay, LoadingBlock, Modal, StatusPill, formatMoney } from '../components'
import { useI18n } from '../i18n'
import type { ReservationSummary } from '../types'

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function plusDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function datesBetween(from: string, to: string) {
  const result: string[] = []
  let current = from
  while (current < to && result.length < 90) {
    result.push(current)
    current = plusDays(current, 1)
  }
  return result
}

function overlapsDate(reservation: ReservationSummary, date: string) {
  const checkIn = reservation.checkIn.slice(0, 10)
  const checkOut = reservation.checkOut.slice(0, 10)
  return checkIn <= date && checkOut > date
}

export function BoardView() {
  const { t, language } = useI18n()
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(plusDays(today(), 14))
  const [selected, setSelected] = useState<ReservationSummary | null>(null)
  const requestedRange = useMemo(() => datesBetween(from, to), [from, to])
  const validRange = Boolean(from && to && from < to && requestedRange.length > 0 && requestedRange.length <= 90)
  const query = useQuery({
    queryKey: ['lite', 'board', from, to],
    queryFn: () => liteApi.board(from, to),
    enabled: validRange,
    refetchInterval: 30_000,
  })

  if (!validRange) return <ErrorBlock error={language === 'th' ? 'ช่วงวันที่ต้องอยู่ระหว่าง 1 ถึง 90 วัน' : 'Choose a board range between 1 and 90 days.'} />
  if (query.isLoading) return <LoadingBlock />
  if (query.error || !query.data) return <ErrorBlock error={query.error || 'Booking board unavailable.'} retry={() => query.refetch()} />

  const data = query.data
  const range = data.range.days
  const todayKey = today()
  return (
    <div className="view-stack view-stack--wide">
      <header className="view-heading">
        <div><p className="eyebrow">{data.rooms.length} {language === 'th' ? 'ห้อง' : 'rooms'}</p><h1>{t('board')}</h1></div>
        <div className="date-filter">
          <label>{language === 'th' ? 'จาก' : 'From'}<input type="date" value={from} onChange={(event) => { const next = event.target.value; setFrom(next); if (to <= next) setTo(plusDays(next, 14)) }} /></label>
          <label>{language === 'th' ? 'ถึง' : 'To'}<input type="date" min={plusDays(from, 1)} max={plusDays(from, 90)} value={to} onChange={(event) => setTo(event.target.value)} /></label>
        </div>
      </header>
      {data.pendingReviewEmail.total > 0 ? (
        <div className="notice notice--warning"><strong>{data.pendingReviewEmail.total}</strong> {t('pendingReview')}</div>
      ) : null}
      <section className="board-shell" aria-label={t('board')}>
        <div className="board-grid" style={{ gridTemplateColumns: `132px repeat(${range.length}, minmax(88px, 1fr))` }}>
          <div className="board-cell board-cell--corner">{t('room')}</div>
          {range.map((date) => (
            <div key={date} className={`board-cell board-cell--date ${date === todayKey ? 'is-today' : ''}`}>
              <strong>{new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', { weekday: 'short' }).format(new Date(`${date}T12:00:00Z`))}</strong>
              <span>{date.slice(8, 10)}/{date.slice(5, 7)}</span>
            </div>
          ))}
          {data.rooms.map((room) => (
            <div className="board-row" key={room.id} style={{ display: 'contents' }}>
              <div className="board-cell board-cell--room">
                <strong>{room.number}</strong>
                <span>{room.roomType.name}</span>
                <StatusPill value={room.housekeepingStatus} />
              </div>
              {range.map((date) => {
                const reservations = data.reservationSegments.filter((reservation) => reservation.assignedRoomId === room.id && overlapsDate(reservation, date))
                return (
                  <div key={`${room.id}-${date}`} className={`board-cell board-cell--stay ${date === todayKey ? 'is-today' : ''}`}>
                    {reservations.map((reservation) => (
                      <button
                        key={reservation.id}
                        className={`stay-chip stay-chip--${reservation.status.toLowerCase()} ${reservation.checkIn.slice(0, 10) === date ? 'stay-chip--start' : ''}`}
                        onClick={() => setSelected(reservation)}
                        title={`${reservation.guest.firstName} ${reservation.guest.lastName}`}
                      >
                        {reservation.checkIn.slice(0, 10) === date ? `${reservation.guest.firstName} ${reservation.guest.lastName}` : '•'}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <header className="panel__header"><h2>{t('unassignedBookings')}</h2><span className="count-badge">{data.unassignedBookings.length}</span></header>
        {data.unassignedBookings.length === 0 ? <EmptyBlock /> : (
          <div className="unassigned-grid">
            {data.unassignedBookings.map((reservation) => (
              <button key={reservation.id} className="unassigned-card" onClick={() => setSelected(reservation)}>
                <GuestStay reservation={reservation} />
                <StatusPill value={reservation.status} />
              </button>
            ))}
          </div>
        )}
      </section>
      {selected ? (
        <Modal title={`${selected.guest.firstName} ${selected.guest.lastName}`} close={() => setSelected(null)}>
          <div className="detail-list">
            <div><span>{t('confirmation')}</span><strong>{selected.confirmationCode}</strong></div>
            <div><span>{t('stay')}</span><strong>{selected.checkIn.slice(0, 10)} → {selected.checkOut.slice(0, 10)}</strong></div>
            <div><span>{t('roomType')}</span><strong>{selected.roomType.name} · {selected.assignedRoom?.number || t('unassigned')}</strong></div>
            <div><span>{t('source')}</span><strong>{selected.source.replaceAll('_', ' ')}</strong></div>
            <div><span>{t('balance')}</span><strong>{formatMoney(selected.folio?.balanceSatang, language)}</strong></div>
            <div><span>{t('status')}</span><StatusPill value={selected.status} /></div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
