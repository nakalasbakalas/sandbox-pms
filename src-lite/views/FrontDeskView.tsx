import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { liteApi, thbInputToSatang } from '../api'
import { EmptyBlock, ErrorBlock, formatMoney, GuestStay, LoadingBlock, Modal, StatCard, StatusPill } from '../components'
import { addDateKey, isDateKey } from '../date-utils'
import { statusLabel, useI18n } from '../i18n'
import { ReservationBookingForm } from '../reservation-booking-form'
import type { LiteRole, ReservationSummary, RoomSummary } from '../types'

function hotelDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function PaymentFields({ amount, setAmount, method, setMethod, reference, setReference }: {
  amount: string
  setAmount: (value: string) => void
  method: string
  setMethod: (value: string) => void
  reference: string
  setReference: (value: string) => void
}) {
  const { language } = useI18n()
  return (
    <>
      <label>{language === 'th' ? 'ยอดรับชำระ (บาท)' : 'Payment amount (THB)'}<input min="0" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <label>{language === 'th' ? 'วิธีชำระ' : 'Payment method'}<select value={method} onChange={(event) => setMethod(event.target.value)}>{['CASH', 'CARD', 'BANK_TRANSFER', 'ONLINE', 'OTHER'].map((value) => <option key={value} value={value}>{statusLabel(value, language)}</option>)}</select></label>
      {method !== 'CASH' && method !== 'OTHER' ? <label>{language === 'th' ? 'เลขอ้างอิง' : 'Payment reference'}<input required value={reference} onChange={(event) => setReference(event.target.value)} /></label> : null}
    </>
  )
}

function StayActionDialog({ reservation, action, role, close }: { reservation: ReservationSummary; action: 'check-in' | 'check-out'; role: LiteRole; close: () => void }) {
  const { t, language } = useI18n()
  const queryClient = useQueryClient()
  const balanceSatang = reservation.folio?.balanceSatang || 0
  const [nationality, setNationality] = useState(reservation.guest.nationality || '')
  const [idType, setIdType] = useState(reservation.guest.idType || 'PASSPORT')
  const [idNumber, setIdNumber] = useState('')
  const [amount, setAmount] = useState(balanceSatang > 0 ? (balanceSatang / 100).toFixed(2) : '')
  const [method, setMethod] = useState('CASH')
  const [reference, setReference] = useState('')
  const [override, setOverride] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const canOverride = ['ADMIN', 'MANAGER'].includes(role)
  const mutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {}
      if (action === 'check-in' && (!reservation.guest.identityComplete || idNumber.trim())) {
        payload.guest = {
          nationality: nationality.trim(),
          idType: idType.trim(),
          idNumber: idNumber.trim(),
        }
      }
      if (amount.trim()) {
        const amountSatang = thbInputToSatang(amount, language === 'th' ? 'ยอดรับชำระ' : 'Payment amount')
        if (amountSatang > 0) {
          payload.payment = {
            amountSatang,
            method,
            ...(reference.trim() ? { reference: reference.trim() } : {}),
          }
        }
      }
      if (override) {
        if (action === 'check-in') payload.allowPayLater = true
        else payload.allowUnpaidOverride = true
        payload.overrideReason = overrideReason.trim()
        if (action === 'check-in') payload.payLaterReason = overrideReason.trim()
      }
      return liteApi.reservationAction(reservation.id, action, payload)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['lite'] })
      close()
    },
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    mutation.mutate()
  }
  return (
    <form className="form-grid" onSubmit={submit}>
      {action === 'check-in' ? (
        <>
          <div className="identity-note">
            <strong>{language === 'th' ? 'ตรวจสอบตัวตนผู้เข้าพัก' : 'Guest identity check'}</strong>
            <span>{reservation.guest.identityComplete ? (language === 'th' ? `มีเอกสารลงท้าย ${reservation.guest.idNumberLast4 || '—'} อยู่แล้ว` : `ID ending ${reservation.guest.idNumberLast4 || '—'} is already on file.`) : (language === 'th' ? 'ต้องบันทึกสัญชาติและเลขบัตร/พาสปอร์ตก่อนเช็กอิน' : 'Nationality and ID/passport number are required before check-in.')}</span>
          </div>
          <label>{language === 'th' ? 'สัญชาติ' : 'Nationality'}<input required={!reservation.guest.identityComplete} value={nationality} onChange={(event) => setNationality(event.target.value)} /></label>
          <label>{language === 'th' ? 'ประเภทเอกสาร' : 'ID type'}<select required={!reservation.guest.identityComplete} value={idType} onChange={(event) => setIdType(event.target.value)}><option value="PASSPORT">{statusLabel('PASSPORT', language)}</option><option value="NATIONAL_ID">{statusLabel('NATIONAL_ID', language)}</option><option value="OTHER">{statusLabel('OTHER', language)}</option></select></label>
          <label>{language === 'th' ? 'เลขบัตร/พาสปอร์ต' : 'ID/passport number'}<input required={!reservation.guest.identityComplete} autoComplete="off" value={idNumber} onChange={(event) => setIdNumber(event.target.value)} placeholder={reservation.guest.identityComplete ? (language === 'th' ? 'เว้นว่างเพื่อใช้ข้อมูลเดิม' : 'Leave blank to keep the ID on file') : ''} /></label>
        </>
      ) : null}
      {balanceSatang > 0 ? <PaymentFields amount={amount} setAmount={setAmount} method={method} setMethod={setMethod} reference={reference} setReference={setReference} /> : <div className="notice"><strong>{language === 'th' ? 'ไม่มียอดค้างชำระ' : 'No balance due'}</strong></div>}
      {balanceSatang > 0 && canOverride ? (
        <>
          <label className="checkbox-field"><input type="checkbox" checked={override} onChange={(event) => setOverride(event.target.checked)} />{action === 'check-in' ? (language === 'th' ? 'ผู้จัดการอนุมัติให้ชำระภายหลัง' : 'Manager authorizes pay later') : (language === 'th' ? 'ผู้จัดการอนุมัติเช็กเอาต์พร้อมยอดค้าง' : 'Manager authorizes checkout with balance')}</label>
          {override ? <label>{language === 'th' ? 'เหตุผลการอนุมัติ' : 'Override reason'}<textarea required value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} /></label> : null}
        </>
      ) : null}
      {mutation.error ? <div className="form-error">{language === 'th' ? 'ไม่สามารถบันทึกการเช็กอินหรือเช็กเอาต์ได้ กรุณาตรวจสอบข้อมูลอีกครั้ง' : mutation.error.message}</div> : null}
      <footer className="form-actions"><button type="button" className="button button--secondary" onClick={close}>{t('close')}</button><button className="button button--primary" disabled={mutation.isPending}>{action === 'check-in' ? t('checkIn') : t('checkOut')}</button></footer>
    </form>
  )
}

function ReservationActions({ reservation, rooms, role }: { reservation: ReservationSummary; rooms: RoomSummary[]; role: LiteRole }) {
  const { t, language } = useI18n()
  const queryClient = useQueryClient()
  const [roomId, setRoomId] = useState('')
  const [dialog, setDialog] = useState<'check-in' | 'check-out' | null>(null)
  const canOperateStay = ['ADMIN', 'MANAGER', 'FRONT_DESK'].includes(role)
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
            onClick={() => mutation.mutate({ action: 'assign-room', payload: { roomId, expectedUpdatedAt: reservation.updatedAt } })}
          >
            {language === 'th' ? 'จัดห้อง' : 'Assign'}
          </button>
        </div>
      ) : null}
      {canOperateStay && ['PENDING', 'CONFIRMED'].includes(reservation.status) ? (
        <button
          className="button button--primary"
          disabled={!reservation.assignedRoom || !['VACANT_CLEAN', 'INSPECTED'].includes(reservation.assignedRoom.housekeepingStatus) || mutation.isPending}
          onClick={() => setDialog('check-in')}
        >
          {t('checkIn')}
        </button>
      ) : null}
      {canOperateStay && reservation.status === 'CHECKED_IN' ? (
        <button className="button button--primary" disabled={mutation.isPending} onClick={() => setDialog('check-out')}>{t('checkOut')}</button>
      ) : null}
      {mutation.error ? <span className="inline-error">{language === 'th' ? 'ไม่สามารถอัปเดตการจองได้' : mutation.error.message}</span> : null}
      {dialog ? <Modal title={`${dialog === 'check-in' ? t('checkIn') : t('checkOut')} · ${reservation.guest.displayName}`} close={() => setDialog(null)}><StayActionDialog reservation={reservation} action={dialog} role={role} close={() => setDialog(null)} /></Modal> : null}
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
  const { t, language } = useI18n()
  const [date, setDate] = useState(hotelDate())
  const [walkInOpen, setWalkInOpen] = useState(false)
  const validDate = isDateKey(date)
  const boardTo = addDateKey(date, 14)
  const query = useQuery({
    queryKey: ['lite', 'front-desk', date],
    queryFn: () => liteApi.frontDesk(date),
    enabled: validDate,
    refetchInterval: 30_000,
  })
  const board = useQuery({
    queryKey: ['lite', 'board', date, boardTo],
    queryFn: () => liteApi.board(date, boardTo),
    enabled: validDate && Boolean(boardTo),
    refetchInterval: 30_000,
  })

  if (!validDate) return <div className="view-stack"><header className="view-heading"><div><h1>{t('frontDesk')}</h1></div><input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label={t('dateRange')} /></header><ErrorBlock error={language === 'th' ? 'กรุณาเลือกวันที่ที่ถูกต้อง' : 'Choose a valid hotel date.'} /></div>
  if (query.isLoading) return <LoadingBlock />
  if (query.error || !query.data) return <ErrorBlock error={language === 'th' ? 'ไม่สามารถโหลดข้อมูลฟรอนต์ออฟฟิศได้' : query.error || 'Front Desk data unavailable.'} retry={() => query.refetch()} />

  const data = query.data
  const rooms = board.data?.rooms || []
  const roomTypes = board.data?.roomTypes || []
  const canCreateWalkIn = ['ADMIN', 'MANAGER', 'FRONT_DESK'].includes(role)
  return (
    <div className="view-stack">
      <header className="view-heading">
        <div><p className="eyebrow">{data.hotelDate}</p><h1>{t('frontDesk')}</h1></div>
        <div className="heading-actions">
          {canCreateWalkIn ? <button className="button button--primary" disabled={board.isLoading || Boolean(board.error) || roomTypes.length === 0} onClick={() => setWalkInOpen(true)}>{language === 'th' ? 'จอง Walk-in วันนี้' : 'Today walk-in'}</button> : null}
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label={t('dateRange')} />
        </div>
      </header>
      {board.error && canCreateWalkIn ? <ErrorBlock error={language === 'th' ? 'ไม่สามารถโหลดประเภทห้องได้ ปิดการจอง Walk-in ไว้ชั่วคราว' : 'Room types could not be loaded, so walk-in booking is temporarily disabled.'} retry={() => board.refetch()} /> : null}
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
      {walkInOpen ? <Modal title={language === 'th' ? 'จอง Walk-in วันนี้' : 'Today walk-in booking'} close={() => setWalkInOpen(false)}><ReservationBookingForm walkIn roomTypes={roomTypes} close={() => setWalkInOpen(false)} /></Modal> : null}
    </div>
  )
}
