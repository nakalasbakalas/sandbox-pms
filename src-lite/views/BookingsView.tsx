import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { liteApi, thbInputToSatang } from '../api'
import { EmptyBlock, ErrorBlock, formatMoney, GuestStay, LoadingBlock, Modal, StatusPill } from '../components'
import { addDateKey } from '../date-utils'
import { providerLabel, statusLabel, useI18n } from '../i18n'
import { ReservationBookingForm } from '../reservation-booking-form'
import type { BookingDetail, LiteRole, ReservationAuditEvent, ReservationSummary } from '../types'

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function auditActionLabel(event: ReservationAuditEvent, language: string) {
  if (language !== 'th') return event.label
  const labels: Partial<Record<ReservationAuditEvent['action'], string>> = {
    CREATED: 'สร้างการจอง',
    MODIFIED: 'แก้ไขการจอง',
    ASSIGNED_ROOM: 'มอบหมายห้อง',
    CHECKED_IN: 'เช็คอินแขก',
    CHECKED_OUT: 'เช็คเอาต์แขก',
    CANCELLED: 'ยกเลิกการจอง',
    NO_SHOW: 'บันทึกว่าไม่เข้าพัก',
    RATE_ADJUSTED: 'ปรับราคา',
    MOVED_ROOM: 'ย้ายห้อง',
    DEPOSIT_PAID: 'บันทึกเงินมัดจำแล้ว',
    WALK_IN_CHECKED_IN: 'สร้างและเช็คอิน Walk-in',
  }
  return labels[event.action] || 'อัปเดตการจอง'
}

function maskedIdentitySuffix(value: string | null | undefined) {
  const suffix = String(value || '').replace(/\s+/g, '').slice(-4)
  return suffix ? `•••• ${suffix}` : '—'
}

function localizedError(error: unknown, language: string, englishFallback: string, thaiFallback: string) {
  if (language === 'th') return thaiFallback
  return error instanceof Error && error.message ? error.message : englishFallback
}

function yesNo(value: boolean, language: string) {
  if (language === 'th') return value ? 'ใช่' : 'ไม่ใช่'
  return value ? 'Yes' : 'No'
}

function BookingProfile({ reservation, role }: { reservation: ReservationSummary; role: LiteRole }) {
  const { language, t } = useI18n()
  const guest = reservation.guest
  if (role === 'CASHIER') {
    return (
      <section className="booking-profile" aria-label={language === 'th' ? 'ข้อมูลสำหรับตรวจสอบการชำระเงิน' : 'Payment reconciliation context'}>
        <header className="booking-profile__header">
          <div><span>{t('guest')}</span><strong>{guest.displayName}</strong></div>
          <StatusPill value={reservation.status} />
        </header>
        <div className="booking-profile__grid">
          <article>
            <h3>{language === 'th' ? 'ข้อมูลอ้างอิงการชำระเงิน' : 'Payment reference context'}</h3>
            <dl>
              <div><dt>{t('confirmation')}</dt><dd>{reservation.confirmationCode}</dd></div>
              <div><dt>{language === 'th' ? 'ยอดชำระแล้ว' : 'Paid'}</dt><dd>{formatMoney(reservation.folio?.paidSatang, language)}</dd></div>
              <div><dt>{t('balance')}</dt><dd>{formatMoney(reservation.folio?.balanceSatang, language)}</dd></div>
            </dl>
          </article>
        </div>
      </section>
    )
  }
  return (
    <section className="booking-profile" aria-label={language === 'th' ? 'ข้อมูลผู้เข้าพักและแหล่งการจอง' : 'Guest and booking source details'}>
      <header className="booking-profile__header">
        <div><span>{t('guest')}</span><strong>{guest.displayName}</strong></div>
        <StatusPill value={reservation.status} />
      </header>
      <div className="booking-profile__grid">
        <article>
          <h3>{language === 'th' ? 'ข้อมูลผู้เข้าพัก' : 'Guest profile'}</h3>
          <dl>
            <div><dt>{t('firstName')}</dt><dd>{guest.firstName || '—'}</dd></div>
            <div><dt>{t('lastName')}</dt><dd>{guest.lastName || '—'}</dd></div>
            <div><dt>{language === 'th' ? 'สัญชาติ' : 'Nationality'}</dt><dd>{guest.nationality || '—'}</dd></div>
            <div><dt>{language === 'th' ? 'ประเภทเอกสาร' : 'Identity type'}</dt><dd>{guest.idType ? statusLabel(guest.idType, language) : '—'}</dd></div>
            <div><dt>{language === 'th' ? 'เลขเอกสาร' : 'Identity number'}</dt><dd>{maskedIdentitySuffix(guest.idNumberLast4)}</dd></div>
            <div><dt>{language === 'th' ? 'ข้อมูลยืนยันตัวตนครบ' : 'Identity complete'}</dt><dd>{yesNo(Boolean(guest.identityComplete), language)}</dd></div>
            <div><dt>VIP</dt><dd>{yesNo(Boolean(guest.vip), language)}</dd></div>
            <div><dt>{language === 'th' ? 'บัญชีเฝ้าระวัง' : 'Watchlist'}</dt><dd>{yesNo(Boolean(guest.blacklisted), language)}</dd></div>
          </dl>
        </article>
        <article>
          <h3>{language === 'th' ? 'แหล่งที่มาและเลขอ้างอิง' : 'Source and references'}</h3>
          <dl>
            <div><dt>{t('source')}</dt><dd>{statusLabel(reservation.source, language)}</dd></div>
            <div><dt>{t('provider')}</dt><dd>{providerLabel(reservation.providerCode)}</dd></div>
            <div><dt>{t('confirmation')}</dt><dd>{reservation.confirmationCode}</dd></div>
            <div><dt>{language === 'th' ? 'เลขอ้างอิง OTA' : 'OTA reference'}</dt><dd>{reservation.channelRef || '—'}</dd></div>
            <div><dt>{language === 'th' ? 'รหัสการจองภายนอก' : 'External reservation ID'}</dt><dd>{reservation.externalReservationId || '—'}</dd></div>
            <div><dt>{language === 'th' ? 'เชื่อมโยงจากอีเมล' : 'Linked from email'}</dt><dd>{yesNo(Boolean(reservation.sourceEmailEventId), language)}</dd></div>
          </dl>
        </article>
        <article>
          <h3>{language === 'th' ? 'รายละเอียดการเข้าพัก' : 'Stay details'}</h3>
          <dl>
            <div><dt>{t('stay')}</dt><dd>{reservation.checkIn.slice(0, 10)} → {reservation.checkOut.slice(0, 10)}</dd></div>
            <div><dt>{t('roomType')}</dt><dd>{reservation.roomType.name}</dd></div>
            <div><dt>{t('assignedRoom')}</dt><dd>{reservation.assignedRoom?.number || t('unassigned')}</dd></div>
            <div><dt>{language === 'th' ? 'ผู้เข้าพัก' : 'Occupancy'}</dt><dd>{reservation.adults} {t('adults')} · {reservation.children} {t('children')}</dd></div>
            <div><dt>{language === 'th' ? 'ราคาต่อคืน' : 'Nightly rate'}</dt><dd>{formatMoney(reservation.ratePerNightSatang, language)}</dd></div>
            <div><dt>{language === 'th' ? 'ยอดการจอง' : 'Booking total'}</dt><dd>{formatMoney(reservation.totalAmountSatang, language)}</dd></div>
          </dl>
        </article>
      </div>
      {guest.blacklisted ? <p className="notice notice--error">{language === 'th' ? 'โปรไฟล์นี้อยู่ในบัญชีเฝ้าระวัง โปรดให้ผู้จัดการตรวจสอบก่อนดำเนินการ' : 'This guest profile is on the watchlist. Ask a manager to review it before proceeding.'}</p> : null}
    </section>
  )
}

function auditTime(value: string | null, language: string) {
  if (!value) return language === 'th' ? 'ไม่ทราบเวลา' : 'Time unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return language === 'th' ? 'ไม่ทราบเวลา' : 'Time unavailable'
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(date)
}

function AuditTimeline({ timeline }: { timeline: NonNullable<BookingDetail['auditTimeline']> }) {
  const { language } = useI18n()
  return (
    <section className="audit-timeline">
      <div className="audit-timeline__heading">
        <h3>{language === 'th' ? 'ประวัติการจอง' : 'Booking history'}</h3>
        <span>{timeline.total} {language === 'th' ? 'เหตุการณ์' : 'events'}</span>
      </div>
      {timeline.events.length === 0 ? <EmptyBlock /> : timeline.events.map((event) => (
        <div className="audit-event" key={event.id}>
          <span className="audit-event__dot" aria-hidden="true" />
          <div><strong>{auditActionLabel(event, language)}</strong><span>{event.actorLabel}</span></div>
          <time dateTime={event.occurredAt || undefined}>{auditTime(event.occurredAt, language)}</time>
        </div>
      ))}
      {timeline.truncated ? <p className="form-note">{language === 'th' ? `แสดง ${timeline.returned} เหตุการณ์ล่าสุด` : `Showing the latest ${timeline.returned} events.`}</p> : null}
    </section>
  )
}

function FolioPanel({ detail, role, close }: { detail: BookingDetail; role: LiteRole; close: () => void }) {
  const { t, language } = useI18n()
  const queryClient = useQueryClient()
  const reservation = detail.reservation
  const folio = reservation.folio
  const [action, setAction] = useState<'charge' | 'payment' | null>(null)
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('OTHER')
  const [amount, setAmount] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [method, setMethod] = useState('CASH')
  const [reference, setReference] = useState('')
  const canPost = ['ADMIN', 'MANAGER', 'FRONT_DESK', 'CASHIER'].includes(role)
  const canReversePayments = role === 'ADMIN'
  const canVoidCharges = ['ADMIN', 'MANAGER'].includes(role)
  const mutation = useMutation({
    mutationFn: async () => {
      if (!folio) throw new Error(language === 'th' ? 'ไม่พบโฟลิโอ' : 'Folio is unavailable.')
      const amountSatang = thbInputToSatang(amount, language === 'th' ? 'จำนวนเงิน' : 'Amount')
      if (amountSatang <= 0) throw new Error(language === 'th' ? 'จำนวนเงินต้องมากกว่าศูนย์' : 'Amount must be greater than zero.')
      if (action === 'charge') {
        return liteApi.createCharge({
          folioId: folio.id,
          description,
          category,
          amountSatang,
          quantity: Number(quantity),
        })
      }
      return liteApi.createPayment({
        folioId: folio.id,
        amountSatang,
        method,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['lite'] })
      setAction(null)
      setAmount('')
      setDescription('')
      setReference('')
    },
  })
  const reversalMutation = useMutation({
    mutationFn: ({ paymentId, reason }: { paymentId: string; reason: string }) => liteApi.reversePayment(paymentId, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lite'] }),
  })
  const voidMutation = useMutation({
    mutationFn: ({ chargeId, reason }: { chargeId: string; reason: string }) => liteApi.voidCharge(chargeId, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lite'] }),
  })
  const reversedByPayment = useMemo(() => {
    const totals = new Map<string, number>()
    for (const payment of folio?.payments || []) {
      if (payment.entryKind === 'REVERSAL' && payment.reversesPaymentId) {
        totals.set(payment.reversesPaymentId, (totals.get(payment.reversesPaymentId) || 0) + Math.abs(payment.amountSatang))
      }
    }
    return totals
  }, [folio])
  const requireReason = (prompt: string, missing: string) => {
    const reason = window.prompt(prompt)
    if (reason === null) return null
    if (!reason.trim()) {
      window.alert(missing)
      return null
    }
    return reason.trim()
  }
  const reversePayment = (paymentId: string) => {
    const reason = requireReason(
      language === 'th' ? 'ระบุเหตุผลในการกลับรายการชำระเงินเต็มจำนวน' : 'Enter the reason for reversing the full remaining payment:',
      language === 'th' ? 'ต้องระบุเหตุผลในการกลับรายการชำระเงิน' : 'A payment reversal reason is required.',
    )
    if (reason) reversalMutation.mutate({ paymentId, reason })
  }
  const voidCharge = (chargeId: string) => {
    const reason = requireReason(
      language === 'th' ? 'ระบุเหตุผลในการยกเลิกรายการค่าใช้จ่าย' : 'Enter the reason for voiding this charge:',
      language === 'th' ? 'ต้องระบุเหตุผลในการยกเลิกรายการค่าใช้จ่าย' : 'A charge void reason is required.',
    )
    if (reason) voidMutation.mutate({ chargeId, reason })
  }

  if (!folio) return <div className="booking-detail"><BookingProfile reservation={reservation} role={role} /><div className="state-card">{language === 'th' ? 'ไม่พบโฟลิโอสำหรับการจองนี้' : 'No folio is available for this booking.'}</div>{detail.auditTimeline ? <AuditTimeline timeline={detail.auditTimeline} /> : null}<div className="form-actions modal-footer"><button type="button" className="button button--secondary" onClick={close}>{t('close')}</button></div></div>
  return (
    <div className="folio-detail">
      <BookingProfile reservation={reservation} role={role} />
      <div className="folio-summary">
        <div><span>{language === 'th' ? 'ยอดรวม' : 'Total'}</span><strong>{formatMoney(folio.totalSatang, language)}</strong></div>
        <div><span>{language === 'th' ? 'ชำระแล้ว' : 'Paid'}</span><strong>{formatMoney(folio.paidSatang, language)}</strong></div>
        <div><span>{t('balance')}</span><strong>{formatMoney(folio.balanceSatang, language)}</strong></div>
      </div>
      <section className="ledger-section">
        <h3>{language === 'th' ? 'รายการค่าใช้จ่าย' : 'Charges'}</h3>
        {folio.charges.length === 0 ? <EmptyBlock /> : folio.charges.map((charge) => (
          <div className={`ledger-row ${charge.void ? 'is-void' : ''}`} key={charge.id}>
            <div>
              <strong>{charge.description}</strong>
              <span>{charge.date} · {statusLabel(charge.category, language)}{charge.void ? ` · ${language === 'th' ? 'ยกเลิกแล้ว' : 'Voided'}${charge.voidedBy ? ` (${charge.voidedBy})` : ''}` : ''}</span>
              {canVoidCharges && !charge.void && charge.category !== 'ROOM' ? <button type="button" className="text-button text-button--danger" disabled={voidMutation.isPending} onClick={() => voidCharge(charge.id)}>{language === 'th' ? 'ยกเลิกรายการ' : 'Void charge'}</button> : null}
            </div>
            <span>{charge.quantity} × {formatMoney(charge.amountSatang, language)}</span>
            <strong>{formatMoney(charge.totalSatang, language)}</strong>
          </div>
        ))}
        {voidMutation.error ? <div className="form-error">{localizedError(voidMutation.error, language, 'The charge could not be voided.', 'ไม่สามารถยกเลิกรายการค่าใช้จ่ายได้')}</div> : null}
      </section>
      <section className="ledger-section">
        <h3>{language === 'th' ? 'การชำระเงิน' : 'Payments'}</h3>
        {folio.payments.length === 0 ? <EmptyBlock /> : folio.payments.map((payment) => {
          const isReversal = payment.entryKind === 'REVERSAL'
          const remainingSatang = isReversal ? 0 : Math.max(0, payment.amountSatang - (reversedByPayment.get(payment.id) || 0))
          return (
            <div className="ledger-row" key={payment.id}>
              <div>
                <strong>{isReversal ? (language === 'th' ? 'กลับรายการชำระเงิน' : 'Payment reversal') : statusLabel(payment.method, language)}</strong>
                <span>{isReversal ? payment.reversalReason || payment.processedBy : payment.reference || payment.processedBy}</span>
                {canReversePayments && !isReversal && remainingSatang > 0 ? <button type="button" className="text-button text-button--danger" disabled={reversalMutation.isPending} onClick={() => reversePayment(payment.id)}>{language === 'th' ? 'กลับรายการเต็มจำนวน' : 'Reverse full payment'}</button> : null}
              </div>
              <span />
              <strong>{formatMoney(payment.amountSatang, language)}</strong>
            </div>
          )
        })}
        {reversalMutation.error ? <div className="form-error">{localizedError(reversalMutation.error, language, 'The payment could not be reversed.', 'ไม่สามารถกลับรายการชำระเงินได้')}</div> : null}
      </section>
      {detail.auditTimeline ? <AuditTimeline timeline={detail.auditTimeline} /> : null}
      {canPost && folio.status === 'OPEN' ? (
        <div className="folio-actions">
          <button type="button" className="button button--secondary" onClick={() => { setAction('charge'); setAmount('') }}>{language === 'th' ? 'เพิ่มค่าใช้จ่าย' : 'Add charge'}</button>
          <button type="button" className="button button--primary" disabled={folio.balanceSatang <= 0} onClick={() => { setAction('payment'); setAmount((folio.balanceSatang / 100).toFixed(2)) }}>{language === 'th' ? 'บันทึกการชำระ' : 'Record payment'}</button>
        </div>
      ) : null}
      {action ? (
        <form className="form-grid folio-form" onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}>
          {action === 'charge' ? (
            <>
              <label>{language === 'th' ? 'รายละเอียด' : 'Description'}<input required value={description} onChange={(event) => setDescription(event.target.value)} /></label>
              <label>{language === 'th' ? 'หมวดหมู่' : 'Category'}<select value={category} onChange={(event) => setCategory(event.target.value)}>{['OTHER', 'CAFE', 'MINIBAR', 'LAUNDRY', 'DAMAGE', 'EXTRA_GUEST', 'CHILD'].map((value) => <option key={value} value={value}>{statusLabel(value, language)}</option>)}</select></label>
              <label>{language === 'th' ? 'จำนวน' : 'Quantity'}<input required min="1" step="1" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
            </>
          ) : (
            <>
              <label>{language === 'th' ? 'วิธีชำระ' : 'Method'}<select value={method} onChange={(event) => setMethod(event.target.value)}>{['CASH', 'CARD', 'BANK_TRANSFER', 'ONLINE', 'OTHER'].map((value) => <option key={value} value={value}>{statusLabel(value, language)}</option>)}</select></label>
              {method !== 'CASH' && method !== 'OTHER' ? <label>{language === 'th' ? 'เลขอ้างอิง' : 'Reference'}<input required value={reference} onChange={(event) => setReference(event.target.value)} /></label> : null}
            </>
          )}
          <label>{language === 'th' ? 'จำนวนเงิน (บาท)' : 'Amount (THB)'}<input required min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          {mutation.error ? <div className="form-error">{localizedError(mutation.error, language, 'The folio entry could not be saved.', 'ไม่สามารถบันทึกรายการโฟลิโอได้')}</div> : null}
          <footer className="form-actions"><button type="button" className="button button--secondary" onClick={() => setAction(null)}>{t('cancel')}</button><button className="button button--primary" disabled={mutation.isPending}>{t('save')}</button></footer>
        </form>
      ) : (
        <div className="form-actions modal-footer"><button type="button" className="button button--secondary" onClick={close}>{t('close')}</button></div>
      )}
    </div>
  )
}

export function BookingsView({ role }: { role: LiteRole }) {
  const { t, language } = useI18n()
  const queryClient = useQueryClient()
  const canCreateOrEdit = ['ADMIN', 'MANAGER', 'FRONT_DESK'].includes(role)
  const [draftSearch, setDraftSearch] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [modal, setModal] = useState<{ kind: 'new' | 'walk-in' | 'edit'; reservation?: ReservationSummary } | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const setup = useQuery({
    queryKey: ['lite', 'booking-room-types'],
    queryFn: () => liteApi.board(today(), addDateKey(today(), 1)),
    staleTime: 60_000,
    enabled: canCreateOrEdit,
  })
  const query = useQuery({
    queryKey: ['lite', 'bookings', search, status, source, cursor],
    queryFn: () => liteApi.bookings({ query: search, status, source, cursor, limit: 30 }),
    refetchInterval: 30_000,
  })
  const detailQuery = useQuery({
    queryKey: ['lite', 'booking-detail', detailId],
    queryFn: () => {
      if (!detailId) throw new Error('Booking id is required.')
      return liteApi.bookingDetail(detailId)
    },
    enabled: Boolean(detailId),
  })
  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => liteApi.reservationAction(id, 'cancel', { reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lite'] }),
  })
  const noShowMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => liteApi.reservationAction(id, 'no-show', { reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lite'] }),
  })

  const roomTypes = useMemo(() => setup.data?.roomTypes || [], [setup.data])
  const canCancel = ['ADMIN', 'MANAGER'].includes(role)
  const cashierOnly = role === 'CASHIER'
  const canOpenEditor = canCreateOrEdit && roomTypes.length > 0 && !setup.error
  const cancelBooking = (reservation: ReservationSummary) => {
    const reason = window.prompt(language === 'th' ? 'ระบุเหตุผลการยกเลิก' : 'Enter the operational cancellation reason:')
    if (reason?.trim()) cancelMutation.mutate({ id: reservation.id, reason: reason.trim() })
  }
  const markNoShow = (reservation: ReservationSummary) => {
    const reason = window.prompt(language === 'th' ? 'ระบุเหตุผลการไม่เข้าพัก' : 'Enter the operational no-show reason:')
    if (reason?.trim()) noShowMutation.mutate({ id: reservation.id, reason: reason.trim() })
  }
  const detailReservation = query.data?.items.find((reservation) => reservation.id === detailId) || null

  return (
    <div className="view-stack">
      <header className="view-heading">
        <div><p className="eyebrow">{query.data?.page.total ?? 0} {language === 'th' ? 'รายการทั้งหมด' : 'matching bookings'}</p><h1>{t('bookings')}</h1></div>
        {canCreateOrEdit ? <div className="heading-actions"><button className="button button--secondary" disabled={!canOpenEditor} onClick={() => setModal({ kind: 'walk-in' })}>{language === 'th' ? 'จอง Walk-in วันนี้' : 'Today walk-in'}</button><button className="button button--primary" disabled={!canOpenEditor} onClick={() => setModal({ kind: 'new' })}>{t('newBooking')}</button></div> : null}
      </header>
      <form className="filter-bar" onSubmit={(event) => { event.preventDefault(); setCursor(null); setSearch(draftSearch.trim()) }}>
        <input value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder={t('search')} aria-label={t('search')} />
        <select value={status} aria-label={language === 'th' ? 'กรองตามสถานะ' : 'Filter by status'} onChange={(event) => { setCursor(null); setStatus(event.target.value) }}>
          <option value="">{t('allStatuses')}</option>
          {['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'].map((item) => <option key={item} value={item}>{statusLabel(item, language)}</option>)}
        </select>
        {!cashierOnly ? <select value={source} aria-label={language === 'th' ? 'กรองตามช่องทาง' : 'Filter by source'} onChange={(event) => { setCursor(null); setSource(event.target.value) }}>
          <option value="">{t('allSources')}</option>
          {['DIRECT', 'WALK_IN', 'PHONE', 'EMAIL', 'WEBSITE', 'BOOKING_COM', 'AGODA', 'TRIP_COM'].map((item) => <option key={item} value={item}>{statusLabel(item, language)}</option>)}
        </select> : null}
        <button className="button button--secondary">{t('search').split(' ')[0]}</button>
      </form>
      {setup.error && canCreateOrEdit ? <ErrorBlock error={language === 'th' ? 'ไม่สามารถโหลดประเภทห้องได้ ปิดการแก้ไขการจองไว้ชั่วคราว' : 'Room types could not be loaded, so booking edits are temporarily disabled.'} retry={() => setup.refetch()} /> : null}
      {cancelMutation.error ? <ErrorBlock error={localizedError(cancelMutation.error, language, 'The booking could not be cancelled.', 'ไม่สามารถยกเลิกการจองได้')} /> : null}
      {noShowMutation.error ? <ErrorBlock error={localizedError(noShowMutation.error, language, 'The booking could not be marked as a no-show.', 'ไม่สามารถบันทึกสถานะไม่เข้าพักได้')} /> : null}
      {query.isLoading ? <LoadingBlock /> : query.error || !query.data ? <ErrorBlock error={localizedError(query.error, language, 'Bookings are unavailable.', 'ไม่สามารถโหลดรายการจองได้')} retry={() => query.refetch()} /> : (
        query.data.items.length === 0 ? <EmptyBlock /> : (
          <section className="panel table-panel">
            <div className="table-scroll">
              <table className={cashierOnly ? 'cashier-table' : undefined}>
                <thead><tr><th>{t('guest')}</th>{!cashierOnly ? <><th>{t('stay')}</th><th>{t('roomType')}</th><th>{t('source')}</th></> : null}<th>{t('status')}</th><th>{t('balance')}</th><th /></tr></thead>
                <tbody>
                  {query.data.items.map((reservation) => (
                    <tr key={reservation.id}>
                      <td><GuestStay reservation={reservation} compact /></td>
                      {!cashierOnly ? <><td>{reservation.checkIn.slice(0, 10)} → {reservation.checkOut.slice(0, 10)}</td>
                      <td>{reservation.roomType.name}<span className="muted">{reservation.assignedRoom?.number || t('unassigned')}</span></td>
                      <td>{statusLabel(reservation.source, language)}</td></> : null}
                      <td><StatusPill value={reservation.status} /></td>
                      <td>{formatMoney(reservation.folio?.balanceSatang, language)}</td>
                      <td className="row-actions">
                        <button className="text-button" onClick={() => setDetailId(reservation.id)}>{language === 'th' ? 'รายละเอียด' : 'Details'}</button>
                        {canOpenEditor && !['CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'].includes(reservation.status) ? <button className="text-button" onClick={() => setModal({ kind: 'edit', reservation })}>{language === 'th' ? 'แก้ไข' : 'Edit'}</button> : null}
                        {canCancel && reservation.checkIn.slice(0, 10) <= today() && ['PENDING', 'CONFIRMED', 'HOLD'].includes(reservation.status) ? <button className="text-button" onClick={() => markNoShow(reservation)}>{language === 'th' ? 'ไม่เข้าพัก' : 'No show'}</button> : null}
                        {canCancel && !['CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'].includes(reservation.status) ? <button className="text-button text-button--danger" onClick={() => cancelBooking(reservation)}>{t('cancel')}</button> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      )}
      <div className="pagination">
        <button className="button button--secondary" disabled={!cursor} onClick={() => setCursor(null)}>{language === 'th' ? 'หน้าแรก' : 'First page'}</button>
        <button className="button button--secondary" disabled={!query.data?.page.hasMore || !query.data.page.nextCursor} onClick={() => setCursor(query.data?.page.nextCursor || null)}>{language === 'th' ? 'หน้าถัดไป' : 'Next page'}</button>
      </div>
      {modal ? (
        <Modal title={modal.kind === 'edit' ? `${language === 'th' ? 'แก้ไข' : 'Edit'} ${modal.reservation?.confirmationCode}` : modal.kind === 'walk-in' ? (language === 'th' ? 'จอง Walk-in วันนี้' : 'Today walk-in booking') : t('newBooking')} close={() => setModal(null)}>
          <ReservationBookingForm reservation={modal.reservation} walkIn={modal.kind === 'walk-in'} roomTypes={roomTypes} close={() => setModal(null)} />
        </Modal>
      ) : null}
      {detailId ? (
        <Modal title={`${language === 'th' ? 'รายละเอียดการจอง' : 'Booking details'} · ${detailQuery.data?.reservation.confirmationCode || detailReservation?.confirmationCode || '…'}`} close={() => setDetailId(null)}>
          {detailQuery.isLoading ? <LoadingBlock /> : detailQuery.error || !detailQuery.data ? <ErrorBlock error={localizedError(detailQuery.error, language, 'Booking details are unavailable.', 'ไม่สามารถโหลดรายละเอียดการจองได้')} retry={() => detailQuery.refetch()} /> : <FolioPanel detail={detailQuery.data} role={role} close={() => setDetailId(null)} />}
        </Modal>
      ) : null}
    </div>
  )
}
