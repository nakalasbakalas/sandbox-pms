import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { liteApi, thbInputToSatang } from './api'
import { addDateKey, isDateKey } from './date-utils'
import { useI18n } from './i18n'
import type { ReservationSummary, RoomTypeSummary } from './types'

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

type ReservationBookingFormProps = {
  reservation?: ReservationSummary
  roomTypes: RoomTypeSummary[]
  walkIn?: boolean
  close: () => void
}

export function ReservationBookingForm({ reservation, roomTypes, walkIn = false, close }: ReservationBookingFormProps) {
  const { t, language } = useI18n()
  const queryClient = useQueryClient()
  const [firstName, setFirstName] = useState(reservation?.guest.firstName || '')
  const [lastName, setLastName] = useState(reservation?.guest.lastName || '')
  const [checkIn, setCheckIn] = useState(reservation?.checkIn.slice(0, 10) || today())
  const [checkOut, setCheckOut] = useState(reservation?.checkOut.slice(0, 10) || addDateKey(today(), 1))
  const [roomTypeCode, setRoomTypeCode] = useState(reservation?.roomType.code || roomTypes[0]?.code || '')
  const [rate, setRate] = useState(reservation ? String(reservation.ratePerNightSatang / 100) : String((roomTypes[0]?.baseRateSatang || 0) / 100))
  const [adults, setAdults] = useState(String(reservation?.adults || 1))
  const [children, setChildren] = useState(String(reservation?.children || 0))
  const [childAges, setChildAges] = useState<string[]>(() => Array.from(
    { length: reservation?.children || 0 },
    (_, index) => reservation?.childAges?.[index] == null ? '' : String(reservation.childAges[index]),
  ))
  const earliestCheckOut = addDateKey(checkIn, 1)
  const stayDatesValid = Boolean(earliestCheckOut && isDateKey(checkOut) && checkOut >= earliestCheckOut)
  const mutation = useMutation({
    mutationFn: async () => {
      if (!stayDatesValid) throw new Error(language === 'th' ? 'กรุณาระบุวันเข้าพักที่ถูกต้อง' : 'Enter a valid stay date range.')
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
        children: childCount,
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
      <label>{t('checkOutDate')}<input required type="date" min={earliestCheckOut || undefined} value={checkOut} onChange={(event) => setCheckOut(event.target.value)} /></label>
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
      {mutation.error ? <div className="form-error">{language === 'th' ? 'ไม่สามารถบันทึกการจองได้ กรุณาตรวจสอบข้อมูลอีกครั้ง' : mutation.error.message}</div> : null}
      <footer className="form-actions">
        <button type="button" className="button button--secondary" onClick={close}>{t('close')}</button>
        <button className="button button--primary" disabled={mutation.isPending || !stayDatesValid}>{mutation.isPending ? '…' : t('save')}</button>
      </footer>
      <p className="form-note">{language === 'th' ? 'ระบบจะตรวจสอบจำนวนห้องว่างและบันทึกในฐานข้อมูลก่อนยืนยัน' : 'Availability is checked and committed on the server before confirmation.'}</p>
    </form>
  )
}
