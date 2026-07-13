import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { liteApi, thbInputToSatang } from '../api'
import { EmptyBlock, ErrorBlock, formatMoney, GuestStay, LoadingBlock, Modal, StatusPill } from '../components'
import { useI18n } from '../i18n'
import type { LiteRole, ReservationSummary, RoomTypeSummary } from '../types'

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function plusDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

type BookingFormProps = {
  reservation?: ReservationSummary
  roomTypes: RoomTypeSummary[]
  walkIn?: boolean
  close: () => void
}

function BookingForm({ reservation, roomTypes, walkIn = false, close }: BookingFormProps) {
  const { t, language } = useI18n()
  const queryClient = useQueryClient()
  const [firstName, setFirstName] = useState(reservation?.guest.firstName || '')
  const [lastName, setLastName] = useState(reservation?.guest.lastName || '')
  const [checkIn, setCheckIn] = useState(reservation?.checkIn.slice(0, 10) || today())
  const [checkOut, setCheckOut] = useState(reservation?.checkOut.slice(0, 10) || plusDays(today(), 1))
  const [roomTypeCode, setRoomTypeCode] = useState(reservation?.roomType.code || roomTypes[0]?.code || '')
  const [rate, setRate] = useState(reservation ? String(reservation.ratePerNightSatang / 100) : String((roomTypes[0]?.baseRateSatang || 0) / 100))
  const [adults, setAdults] = useState(String(reservation?.adults || 1))
  const [children, setChildren] = useState(String(reservation?.children || 0))
  const [childAges, setChildAges] = useState<string[]>(() => Array.from(
    { length: reservation?.children || 0 },
    (_, index) => reservation?.childAges?.[index] == null ? '' : String(reservation.childAges[index]),
  ))
  const mutation = useMutation({
    mutationFn: async () => {
      const childCount = Number(children)
      const childAgeInputs = childAges.slice(0, childCount)
      const parsedChildAges = childAgeInputs.map((value) => Number(value))
      if (!Number.isSafeInteger(childCount) || childCount < 0 || childAgeInputs.some((value) => !value.trim()) || parsedChildAges.length !== childCount || parsedChildAges.some((age) => !Number.isSafeInteger(age) || age < 0 || age > 17)) {
        throw new Error(language === 'th' ? 'กรอกอายุของเด็กทุกคน' : 'Enter one valid age for every child.')
      }
      const common = {
        checkIn,
        checkOut,
        roomTypeCode,
        adults: Number(adults),
        children: Number(children),
        childAges: parsedChildAges,
        ratePerNightSatang: thbInputToSatang(rate, language === 'th' ? 'ราคาต่อคืน' : 'Nightly rate'),
        ...(reservation?.updatedAt ? { expectedUpdatedAt: reservation.updatedAt } : {}),
      }
      if (reservation) return liteApi.updateReservation(reservation.id, common)
      return liteApi.createReservation({
        ...common,
        guest: { firstName, lastName },
        source: walkIn ? 'WALK_IN' : 'DIRECT',
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['lite'] })
      close()
    },
  })

  useEffect(() => {
    const selected = roomTypes.find((item) => String(item.code) === roomTypeCode)
    if (!reservation && selected) setRate(String(selected.baseRateSatang / 100))
  }, [reservation, roomTypeCode, roomTypes])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    mutation.mutate()
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      {!reservation ? (
        <>
          <label>{t('firstName')}<input required value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
          <label>{t('lastName')}<input required value={lastName} onChange={(event) => setLastName(event.target.value)} /></label>
        </>
      ) : null}
      <label>{t('checkInDate')}<input required type="date" value={checkIn} onChange={(event) => setCheckIn(event.target.value)} /></label>
      <label>{t('checkOutDate')}<input required type="date" min={plusDays(checkIn, 1)} value={checkOut} onChange={(event) => setCheckOut(event.target.value)} /></label>
      <label>{t('roomType')}
        <select required value={roomTypeCode} onChange={(event) => setRoomTypeCode(event.target.value)}>
          {roomTypes.map((roomType) => <option key={roomType.id} value={roomType.code}>{roomType.name}</option>)}
        </select>
      </label>
      <label>{t('nightlyRate')}<input required min="0" step="0.01" type="number" value={rate} onChange={(event) => setRate(event.target.value)} /></label>
      <label>{t('adults')}<input required min="1" type="number" value={adults} onChange={(event) => setAdults(event.target.value)} /></label>
      <label>{t('children')}<input min="0" step="1" type="number" value={children} onChange={(event) => {
        const value = event.target.value
        setChildren(value)
        const count = Number(value)
        if (Number.isSafeInteger(count) && count >= 0) {
          setChildAges((current) => Array.from({ length: count }, (_, index) => current[index] || ''))
        }
      }} /></label>
      {childAges.map((age, index) => (
        <label key={index}>{language === 'th' ? `อายุเด็กคนที่ ${index + 1}` : `Child ${index + 1} age`}<input required min="0" max="17" step="1" type="number" value={age} onChange={(event) => setChildAges((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /></label>
      ))}
      {mutation.error ? <div className="form-error">{mutation.error.message}</div> : null}
      <footer className="form-actions">
        <button type="button" className="button button--secondary" onClick={close}>{t('close')}</button>
        <button className="button button--primary" disabled={mutation.isPending}>{mutation.isPending ? '…' : t('save')}</button>
      </footer>
      <p className="form-note">{language === 'th' ? 'ระบบจะตรวจสอบจำนวนห้องว่างและบันทึกในฐานข้อมูลก่อนยืนยัน' : 'Availability is checked and committed on the server before confirmation.'}</p>
    </form>
  )
}

function FolioPanel({ reservation, role, close }: { reservation: ReservationSummary; role: LiteRole; close: () => void }) {
  const { t, language } = useI18n()
  const queryClient = useQueryClient()
  const folio = reservation.folio
  const [action, setAction] = useState<'charge' | 'payment' | null>(null)
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('OTHER')
  const [amount, setAmount] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [method, setMethod] = useState('CASH')
  const [reference, setReference] = useState('')
  const canPost = ['ADMIN', 'MANAGER', 'FRONT_DESK', 'CASHIER'].includes(role)
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

  if (!folio) return <div className="state-card">{language === 'th' ? 'ไม่พบโฟลิโอสำหรับการจองนี้' : 'No folio is available for this booking.'}</div>
  return (
    <div className="folio-detail">
      <div className="folio-summary">
        <div><span>{language === 'th' ? 'ยอดรวม' : 'Total'}</span><strong>{formatMoney(folio.totalSatang, language)}</strong></div>
        <div><span>{language === 'th' ? 'ชำระแล้ว' : 'Paid'}</span><strong>{formatMoney(folio.paidSatang, language)}</strong></div>
        <div><span>{t('balance')}</span><strong>{formatMoney(folio.balanceSatang, language)}</strong></div>
      </div>
      <section className="ledger-section">
        <h3>{language === 'th' ? 'รายการค่าใช้จ่าย' : 'Charges'}</h3>
        {folio.charges.length === 0 ? <EmptyBlock /> : folio.charges.map((charge) => (
          <div className={`ledger-row ${charge.void ? 'is-void' : ''}`} key={charge.id}>
            <div><strong>{charge.description}</strong><span>{charge.date} · {charge.category.replaceAll('_', ' ')}</span></div>
            <span>{charge.quantity} × {formatMoney(charge.amountSatang, language)}</span>
            <strong>{formatMoney(charge.totalSatang, language)}</strong>
          </div>
        ))}
      </section>
      <section className="ledger-section">
        <h3>{language === 'th' ? 'การชำระเงิน' : 'Payments'}</h3>
        {folio.payments.length === 0 ? <EmptyBlock /> : folio.payments.map((payment) => (
          <div className="ledger-row" key={payment.id}>
            <div><strong>{payment.method.replaceAll('_', ' ')}</strong><span>{payment.reference || payment.processedBy}</span></div>
            <span />
            <strong>{formatMoney(payment.amountSatang, language)}</strong>
          </div>
        ))}
      </section>
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
              <label>{language === 'th' ? 'หมวดหมู่' : 'Category'}<select value={category} onChange={(event) => setCategory(event.target.value)}>{['OTHER', 'CAFE', 'MINIBAR', 'LAUNDRY', 'DAMAGE', 'EXTRA_GUEST', 'CHILD'].map((value) => <option key={value}>{value}</option>)}</select></label>
              <label>{language === 'th' ? 'จำนวน' : 'Quantity'}<input required min="1" step="1" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
            </>
          ) : (
            <>
              <label>{language === 'th' ? 'วิธีชำระ' : 'Method'}<select value={method} onChange={(event) => setMethod(event.target.value)}>{['CASH', 'CARD', 'BANK_TRANSFER', 'ONLINE', 'OTHER'].map((value) => <option key={value}>{value}</option>)}</select></label>
              {method !== 'CASH' && method !== 'OTHER' ? <label>{language === 'th' ? 'เลขอ้างอิง' : 'Reference'}<input required value={reference} onChange={(event) => setReference(event.target.value)} /></label> : null}
            </>
          )}
          <label>{language === 'th' ? 'จำนวนเงิน (บาท)' : 'Amount (THB)'}<input required min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          {mutation.error ? <div className="form-error">{mutation.error.message}</div> : null}
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
  const [draftSearch, setDraftSearch] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [modal, setModal] = useState<{ kind: 'new' | 'walk-in' | 'edit'; reservation?: ReservationSummary } | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const setup = useQuery({
    queryKey: ['lite', 'booking-room-types'],
    queryFn: () => liteApi.board(today(), plusDays(today(), 1)),
    staleTime: 60_000,
  })
  const query = useQuery({
    queryKey: ['lite', 'bookings', search, status, source, cursor],
    queryFn: () => liteApi.bookings({ query: search, status, source, cursor, limit: 30 }),
    refetchInterval: 30_000,
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
  const canCreateOrEdit = ['ADMIN', 'MANAGER', 'FRONT_DESK'].includes(role)
  const canCancel = ['ADMIN', 'MANAGER'].includes(role)
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
        <input value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder={t('search')} />
        <select value={status} onChange={(event) => { setCursor(null); setStatus(event.target.value) }}>
          <option value="">{t('allStatuses')}</option>
          {['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'].map((item) => <option key={item}>{item}</option>)}
        </select>
        <select value={source} onChange={(event) => { setCursor(null); setSource(event.target.value) }}>
          <option value="">{t('allSources')}</option>
          {['DIRECT', 'WALK_IN', 'PHONE', 'EMAIL', 'WEBSITE', 'BOOKING_COM', 'AGODA', 'TRIP_COM'].map((item) => <option key={item}>{item}</option>)}
        </select>
        <button className="button button--secondary">{t('search').split(' ')[0]}</button>
      </form>
      {setup.error && canCreateOrEdit ? <ErrorBlock error={language === 'th' ? 'ไม่สามารถโหลดประเภทห้องได้ ปิดการแก้ไขการจองไว้ชั่วคราว' : 'Room types could not be loaded, so booking edits are temporarily disabled.'} retry={() => setup.refetch()} /> : null}
      {cancelMutation.error ? <ErrorBlock error={cancelMutation.error} /> : null}
      {noShowMutation.error ? <ErrorBlock error={noShowMutation.error} /> : null}
      {query.isLoading ? <LoadingBlock /> : query.error || !query.data ? <ErrorBlock error={query.error || 'Bookings unavailable.'} retry={() => query.refetch()} /> : (
        query.data.items.length === 0 ? <EmptyBlock /> : (
          <section className="panel table-panel">
            <div className="table-scroll">
              <table>
                <thead><tr><th>{t('guest')}</th><th>{t('stay')}</th><th>{t('roomType')}</th><th>{t('source')}</th><th>{t('status')}</th><th>{t('balance')}</th><th /></tr></thead>
                <tbody>
                  {query.data.items.map((reservation) => (
                    <tr key={reservation.id}>
                      <td><GuestStay reservation={reservation} compact /></td>
                      <td>{reservation.checkIn.slice(0, 10)} → {reservation.checkOut.slice(0, 10)}</td>
                      <td>{reservation.roomType.name}<span className="muted">{reservation.assignedRoom?.number || t('unassigned')}</span></td>
                      <td>{reservation.source.replaceAll('_', ' ')}</td>
                      <td><StatusPill value={reservation.status} /></td>
                      <td>{formatMoney(reservation.folio?.balanceSatang, language)}</td>
                      <td className="row-actions">
                        <button className="text-button" onClick={() => setDetailId(reservation.id)}>{language === 'th' ? 'โฟลิโอ' : 'Folio'}</button>
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
          <BookingForm reservation={modal.reservation} walkIn={modal.kind === 'walk-in'} roomTypes={roomTypes} close={() => setModal(null)} />
        </Modal>
      ) : null}
      {detailReservation ? <Modal title={`${language === 'th' ? 'โฟลิโอ' : 'Folio'} · ${detailReservation.confirmationCode}`} close={() => setDetailId(null)}><FolioPanel reservation={detailReservation} role={role} close={() => setDetailId(null)} /></Modal> : null}
    </div>
  )
}
