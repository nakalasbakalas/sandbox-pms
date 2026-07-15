import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { liteApi } from '../api'
import { EmptyBlock, ErrorBlock, LoadingBlock, StatCard, StatusPill } from '../components'
import { isDateKey } from '../date-utils'
import { statusLabel, useI18n } from '../i18n'
import type { HousekeepingRoom, HousekeepingStay, Language } from '../types'

function hotelDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function nextAction(status: string) {
  if (['VACANT_DIRTY', 'OCCUPIED_DIRTY'].includes(status)) return 'CLEANING'
  if (status === 'CLEANING') return 'CLEAN'
  if (status === 'VACANT_CLEAN') return 'INSPECTED'
  return null
}

function StayNotice({ label, reservation, language }: { label: string; reservation: HousekeepingStay; language: Language }) {
  return (
    <div className="occupancy-note">
      <span>{label}</span>
      <strong>{statusLabel(reservation.status, language)}</strong>
      <span>{reservation.checkIn} → {reservation.checkOut}</span>
    </div>
  )
}

function RoomOccupancy({ room, language }: { room: HousekeepingRoom; language: Language }) {
  const notices = [
    ...room.departures.map((stay) => <StayNotice key={`departure-${stay.id}`} label={language === 'th' ? 'ออกวันนี้' : 'Departure today'} reservation={stay} language={language} />),
    ...room.arrivals.map((stay) => <StayNotice key={`arrival-${stay.id}`} label={language === 'th' ? 'เข้าพักวันนี้' : 'Arrival today'} reservation={stay} language={language} />),
    ...room.inHouse.map((stay) => <StayNotice key={`in-house-${stay.id}`} label={language === 'th' ? 'ผู้เข้าพัก' : 'Guest in room'} reservation={stay} language={language} />),
  ]
  return notices.length > 0 ? <>{notices}</> : <div className="occupancy-note muted">{language === 'th' ? 'ไม่มีผู้เข้าพัก' : 'Vacant'}</div>
}

export function HousekeepingView() {
  const { t, language } = useI18n()
  const queryClient = useQueryClient()
  const [date, setDate] = useState(hotelDate())
  const validDate = isDateKey(date)
  const query = useQuery({
    queryKey: ['lite', 'housekeeping', date],
    queryFn: () => liteApi.housekeeping(date),
    enabled: validDate,
    refetchInterval: 30_000,
  })
  const mutation = useMutation({
    mutationFn: ({ roomId, status, notes }: { roomId: string; status: string; notes?: string }) => liteApi.updateHousekeeping(roomId, status, notes),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lite'] }),
  })

  if (!validDate) return <div className="view-stack"><header className="view-heading"><div><h1>{t('housekeeping')}</h1></div><input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label={language === 'th' ? 'วันที่งานแม่บ้าน' : 'Housekeeping date'} /></header><ErrorBlock error={language === 'th' ? 'กรุณาเลือกวันที่ที่ถูกต้อง' : 'Choose a valid housekeeping date.'} /></div>
  if (query.isLoading) return <LoadingBlock />
  if (query.error || !query.data) return <ErrorBlock error={language === 'th' ? 'ไม่สามารถโหลดข้อมูลงานแม่บ้านได้' : query.error || 'Housekeeping unavailable.'} retry={() => query.refetch()} />
  const data = query.data
  const ordered = data.rooms

  const maintenance = (roomId: string) => {
    const reason = window.prompt(language === 'th' ? 'ระบุเหตุผลที่ปิดห้องซ่อม' : 'Enter the maintenance reason:')
    if (reason?.trim()) mutation.mutate({ roomId, status: 'MAINTENANCE', notes: reason.trim() })
  }

  return (
    <div className="view-stack">
      <header className="view-heading">
        <div><p className="eyebrow">{data.hotelDate}</p><h1>{t('housekeeping')}</h1></div>
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label={language === 'th' ? 'วันที่งานแม่บ้าน' : 'Housekeeping date'} />
      </header>
      <div className="stats-grid stats-grid--compact">
        <StatCard label={t('dirty')} value={data.summary.dirty || 0} tone="warning" />
        <StatCard label={t('cleaning')} value={data.summary.cleaning || 0} tone="blue" />
        <StatCard label={t('readyRooms')} value={data.summary.ready} tone="green" />
        <StatCard label={t('inspected')} value={data.summary.inspected || 0} />
      </div>
      {mutation.error ? <ErrorBlock error={language === 'th' ? 'ไม่สามารถอัปเดตสถานะห้องได้' : mutation.error} /> : null}
      <section className="housekeeping-grid">
        {ordered.length === 0 ? <EmptyBlock /> : ordered.map((room) => {
          const next = nextAction(room.housekeepingStatus)
          return (
            <article key={room.id} className={`room-task room-task--${room.housekeepingStatus.toLowerCase()}`}>
              <header>
                <div><strong>{t('room')} {room.number}</strong><span>{room.roomType.name} · {language === 'th' ? `ชั้น ${room.floor}` : `Floor ${room.floor}`}</span></div>
                <StatusPill value={room.housekeepingStatus} />
              </header>
              <RoomOccupancy room={room} language={language} />
              <footer>
                {next ? (
                  <button className="button button--primary" disabled={mutation.isPending} onClick={() => mutation.mutate({ roomId: room.id, status: next })}>
                    {next === 'CLEANING' ? t('cleaning') : next === 'CLEAN' ? t('clean') : t('inspected')}
                  </button>
                ) : null}
                {room.operationalStatus === 'AVAILABLE' ? <button className="button button--secondary" disabled={mutation.isPending} onClick={() => maintenance(room.id)}>{t('maintenance')}</button> : null}
              </footer>
            </article>
          )
        })}
      </section>
    </div>
  )
}
