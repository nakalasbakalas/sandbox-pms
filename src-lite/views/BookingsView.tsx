import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { liteApi } from '../api'
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
  close: () => void
}

function BookingForm({ reservation, roomTypes, close }: BookingFormProps) {
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
  const mutation = useMutation({
    mutationFn: async () => {
      const common = {
        checkIn,
        checkOut,
        roomTypeCode,
        adults: Number(adults),
        children: Number(children),
        childAges: [],
        ratePerNight: Number(rate),
      }
      if (reservation) return liteApi.updateReservation(reservation.id, common)
      return liteApi.createReservation({
        ...common,
        guest: { firstName, lastName },
        source: 'DIRECT',
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
      <label>{t('children')}<input min="0" type="number" value={children} onChange={(event) => setChildren(event.target.value)} /></label>
      {mutation.error ? <div className="form-error">{mutation.error.message}</div> : null}
      <footer className="form-actions">
        <button type="button" className="button button--secondary" onClick={close}>{t('close')}</button>
        <button className="button button--primary" disabled={mutation.isPending}>{mutation.isPending ? '…' : t('save')}</button>
      </footer>
      <p className="form-note">{language === 'th' ? 'ระบบจะตรวจสอบจำนวนห้องว่างและบันทึกในฐานข้อมูลก่อนยืนยัน' : 'Availability is checked and committed on the server before confirmation.'}</p>
    </form>
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
  const [modal, setModal] = useState<'new' | ReservationSummary | null>(null)
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

  const roomTypes = useMemo(() => setup.data?.roomTypes || [], [setup.data])
  const canCreateOrEdit = ['ADMIN', 'MANAGER', 'FRONT_DESK'].includes(role)
  const canCancel = ['ADMIN', 'MANAGER'].includes(role)
  const canOpenEditor = canCreateOrEdit && roomTypes.length > 0 && !setup.error
  const cancelBooking = (reservation: ReservationSummary) => {
    const reason = window.prompt(language === 'th' ? 'ระบุเหตุผลการยกเลิก' : 'Enter the operational cancellation reason:')
    if (reason?.trim()) cancelMutation.mutate({ id: reservation.id, reason: reason.trim() })
  }

  return (
    <div className="view-stack">
      <header className="view-heading">
        <div><p className="eyebrow">{query.data?.page.total ?? 0} {language === 'th' ? 'รายการทั้งหมด' : 'matching bookings'}</p><h1>{t('bookings')}</h1></div>
        {canCreateOrEdit ? <button className="button button--primary" disabled={!canOpenEditor} onClick={() => setModal('new')}>{t('newBooking')}</button> : null}
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
                        {canOpenEditor && !['CHECKED_OUT', 'CANCELLED', 'NO_SHOW'].includes(reservation.status) ? <button className="text-button" onClick={() => setModal(reservation)}>{language === 'th' ? 'แก้ไข' : 'Edit'}</button> : null}
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
        <Modal title={modal === 'new' ? t('newBooking') : `${language === 'th' ? 'แก้ไข' : 'Edit'} ${modal.confirmationCode}`} close={() => setModal(null)}>
          <BookingForm reservation={modal === 'new' ? undefined : modal} roomTypes={roomTypes} close={() => setModal(null)} />
        </Modal>
      ) : null}
    </div>
  )
}
