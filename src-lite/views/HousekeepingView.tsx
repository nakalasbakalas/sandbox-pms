import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { liteApi } from '../api'
import { EmptyBlock, ErrorBlock, LoadingBlock, Modal, StatCard, StatusPill } from '../components'
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
  const [roomAction, setRoomAction] = useState<{ roomId: string; roomNumber: string; kind: 'maintenance' | 'restore' | 'dirty' } | null>(null)
  const [reason, setReason] = useState('')
  const validDate = isDateKey(date)
  const query = useQuery({
    queryKey: ['lite', 'housekeeping', date],
    queryFn: () => liteApi.housekeeping(date),
    enabled: validDate,
    refetchInterval: 30_000,
  })
  const mutation = useMutation({
    mutationFn: ({ roomId, status, notes, operational }: { roomId: string; status: string; notes?: string; operational?: boolean }) => operational
      ? liteApi.updateRoomOperationalStatus(roomId, status, notes || '')
      : liteApi.updateHousekeeping(roomId, status, notes),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['lite'] })
      setRoomAction(null)
      setReason('')
    },
  })

  if (!validDate) return <div className="view-stack"><header className="view-heading"><div><h1>{t('housekeeping')}</h1></div><input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label={language === 'th' ? 'วันที่งานแม่บ้าน' : 'Housekeeping date'} /></header><ErrorBlock error={language === 'th' ? 'กรุณาเลือกวันที่ที่ถูกต้อง' : 'Choose a valid housekeeping date.'} /></div>
  if (query.isLoading) return <LoadingBlock />
  if (query.error || !query.data) return <ErrorBlock error={language === 'th' ? 'ไม่สามารถโหลดข้อมูลงานแม่บ้านได้' : query.error || 'Housekeeping unavailable.'} retry={() => query.refetch()} />
  const data = query.data
  const ordered = data.rooms

  const submitRoomAction = () => {
    if (!roomAction || !reason.trim()) return
    if (roomAction.kind === 'maintenance') mutation.mutate({ roomId: roomAction.roomId, status: 'MAINTENANCE', notes: reason.trim() })
    else if (roomAction.kind === 'restore') mutation.mutate({ roomId: roomAction.roomId, status: 'AVAILABLE', notes: reason.trim(), operational: true })
    else mutation.mutate({ roomId: roomAction.roomId, status: 'DIRTY', notes: reason.trim() })
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
                <div className="room-status-stack"><StatusPill value={room.housekeepingStatus} />{room.operationalStatus !== 'AVAILABLE' ? <StatusPill value={room.operationalStatus} /> : null}</div>
              </header>
              <RoomOccupancy room={room} language={language} />
              <footer>
                {next ? (
                  <button className="button button--primary" disabled={mutation.isPending && mutation.variables?.roomId === room.id} onClick={() => mutation.mutate({ roomId: room.id, status: next })}>
                    {next === 'CLEANING' ? t('cleaning') : next === 'CLEAN' ? t('clean') : t('inspected')}
                  </button>
                ) : null}
                {room.operationalStatus === 'AVAILABLE' && !['VACANT_DIRTY', 'OCCUPIED_DIRTY', 'CLEANING'].includes(room.housekeepingStatus) ? <button className="text-button" disabled={mutation.isPending && mutation.variables?.roomId === room.id} onClick={() => { setRoomAction({ roomId: room.id, roomNumber: room.number, kind: 'dirty' }); setReason('') }}>{language === 'th' ? 'ทำเครื่องหมายว่าสกปรก' : 'Mark dirty'}</button> : null}
                {room.operationalStatus === 'AVAILABLE' ? <button className="button button--secondary" disabled={mutation.isPending && mutation.variables?.roomId === room.id} onClick={() => { setRoomAction({ roomId: room.id, roomNumber: room.number, kind: 'maintenance' }); setReason('') }}>{t('maintenance')}</button> : <button className="button button--primary" disabled={mutation.isPending && mutation.variables?.roomId === room.id} onClick={() => { setRoomAction({ roomId: room.id, roomNumber: room.number, kind: 'restore' }); setReason('') }}>{language === 'th' ? 'คืนห้องเข้าสู่บริการ' : 'Return to service'}</button>}
              </footer>
            </article>
          )
        })}
      </section>
      {roomAction ? <Modal title={`${roomAction.kind === 'maintenance' ? t('maintenance') : roomAction.kind === 'restore' ? (language === 'th' ? 'คืนห้องเข้าสู่บริการ' : 'Return room to service') : (language === 'th' ? 'ทำเครื่องหมายว่าสกปรก' : 'Mark room dirty')} · ${t('room')} ${roomAction.roomNumber}`} close={() => setRoomAction(null)}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); submitRoomAction() }}>
        <p className="form-note">{roomAction.kind === 'restore' ? (language === 'th' ? 'ห้องจะกลับมาขายได้ แต่ยังต้องผ่านขั้นตอนทำความสะอาดและตรวจห้องตามสถานะปัจจุบัน' : 'The room becomes sellable again but must still complete its current cleaning and inspection cycle.') : (language === 'th' ? 'เหตุผลนี้จะถูกบันทึกเป็นหลักฐานการปฏิบัติงาน' : 'This reason is recorded as operational evidence.')}</p>
        <label className="form-span">{language === 'th' ? 'เหตุผล' : 'Reason'}<textarea autoFocus required rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        {mutation.error ? <div className="form-error" role="alert">{language === 'th' ? 'ไม่สามารถอัปเดตสถานะห้องได้' : mutation.error.message}</div> : null}
        <footer className="form-actions"><button type="button" className="button button--secondary" onClick={() => setRoomAction(null)}>{t('cancel')}</button><button className={`button ${roomAction.kind === 'maintenance' ? 'button--danger' : 'button--primary'}`} disabled={mutation.isPending || !reason.trim()}>{roomAction.kind === 'maintenance' ? (language === 'th' ? 'ปิดห้องซ่อม' : 'Take out of service') : roomAction.kind === 'restore' ? (language === 'th' ? 'ยืนยันคืนห้อง' : 'Confirm return') : (language === 'th' ? 'ยืนยันสถานะสกปรก' : 'Confirm dirty')}</button></footer>
      </form></Modal> : null}
    </div>
  )
}
