import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { liteApi } from './api'
import { formatMoney } from './components'
import { addDateKey, isDateKey } from './date-utils'
import { statusLabel, useI18n } from './i18n'
import type { LiteRole, RoomTypeSummary } from './types'

function hotelDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function walkInError(error: unknown, language: string) {
  const message = error instanceof Error ? error.message : String(error || '')
  if (language !== 'th') return message || 'Walk-in check-in could not be completed.'
  if (/quote changed/i.test(message)) return 'ราคาเข้าพักมีการเปลี่ยนแปลง กรุณาตรวจสอบราคาใหม่ก่อนรับชำระ'
  if (/no clean available room|no .*room.*available|no sellable rooms/i.test(message)) return 'ไม่มีห้องสะอาดพร้อมขายสำหรับวันที่เลือก'
  if (/no longer ready|changed state|already has a reservation|not available/i.test(message)) return 'ห้องที่เลือกไม่พร้อมแล้ว กรุณาเลือกห้องใหม่และลองอีกครั้ง'
  if (/identity|nationality|passport/i.test(message)) return 'ต้องระบุสัญชาติและเลขบัตรหรือหนังสือเดินทางก่อนเช็คอิน'
  if (/payment reference/i.test(message)) return 'ต้องระบุเลขอ้างอิงสำหรับวิธีชำระเงินนี้'
  if (/pay-later|manager or admin|override/i.test(message)) return 'การชำระภายหลังต้องได้รับอนุมัติจากผู้จัดการหรือแอดมินพร้อมเหตุผล'
  if (/check-out|check-in|hotel date/i.test(message)) return 'กรุณาตรวจสอบวันที่เข้าพัก Walk-in วันนี้'
  return 'ไม่สามารถเช็คอิน Walk-in ได้ กรุณาตรวจสอบข้อมูลและลองอีกครั้ง'
}

type WalkInCheckInFormProps = {
  roomTypes: RoomTypeSummary[]
  role: LiteRole
  close: () => void
}

export function WalkInCheckInForm({ roomTypes, role, close }: WalkInCheckInFormProps) {
  const { language, t } = useI18n()
  const queryClient = useQueryClient()
  const checkIn = hotelDate()
  const [checkOut, setCheckOut] = useState(addDateKey(checkIn, 1))
  const [roomTypeCode, setRoomTypeCode] = useState(roomTypes[0]?.code || '')
  const [assignedRoomId, setAssignedRoomId] = useState('')
  const [adults, setAdults] = useState('1')
  const [children, setChildren] = useState('0')
  const [childAges, setChildAges] = useState<string[]>([])
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [nationality, setNationality] = useState('')
  const [idType, setIdType] = useState('PASSPORT')
  const [idNumber, setIdNumber] = useState('')
  const [settlement, setSettlement] = useState<'PAY_NOW' | 'PAY_LATER'>('PAY_NOW')
  const [method, setMethod] = useState('CASH')
  const [reference, setReference] = useState('')
  const [payLaterReason, setPayLaterReason] = useState('')
  const canPayLater = role === 'ADMIN' || role === 'MANAGER'
  const childCount = Number(children)
  const parsedChildAges = useMemo(() => childAges.map(Number), [childAges])
  const occupancyValid = Number.isSafeInteger(Number(adults))
    && Number(adults) >= 1
    && Number.isSafeInteger(childCount)
    && childCount >= 0
    && childAges.length === childCount
    && childAges.every((age) => age.trim() !== '')
    && parsedChildAges.every((age) => Number.isSafeInteger(age) && age >= 0 && age <= 17)
  const stayValid = Boolean(isDateKey(checkOut) && checkOut > checkIn)
  const quoteInput = useMemo(() => ({
    checkIn,
    checkOut,
    roomTypeCode,
    adults: Number(adults),
    children: childCount,
    childAges: parsedChildAges,
  }), [adults, checkIn, checkOut, childCount, parsedChildAges, roomTypeCode])
  const quote = useQuery({
    queryKey: ['lite', 'walk-in-quote', checkIn, checkOut, roomTypeCode, adults, children, childAges.join(',')],
    queryFn: () => liteApi.walkInQuote(quoteInput),
    enabled: Boolean(roomTypeCode && stayValid && occupancyValid),
    staleTime: 0,
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    if (!roomTypeCode && roomTypes[0]) setRoomTypeCode(roomTypes[0].code)
  }, [roomTypeCode, roomTypes])

  useEffect(() => {
    const rooms = quote.data?.readyRooms || []
    if (!rooms.some((room) => room.id === assignedRoomId)) setAssignedRoomId(rooms[0]?.id || '')
  }, [assignedRoomId, quote.data])

  const mutation = useMutation({
    mutationFn: async () => {
      if (!occupancyValid || !stayValid) {
        throw new Error(language === 'th' ? 'กรุณาตรวจสอบวันเข้าพักและจำนวนผู้เข้าพัก' : 'Check the stay dates and occupancy.')
      }
      if (!firstName.trim() || !lastName.trim() || !nationality.trim() || !idNumber.trim()) {
        throw new Error(language === 'th' ? 'ต้องระบุชื่อ สัญชาติ และเลขเอกสารของผู้เข้าพัก' : 'Guest name, nationality, and identity number are required.')
      }
      if (settlement === 'PAY_LATER' && (!canPayLater || !payLaterReason.trim())) {
        throw new Error(language === 'th' ? 'ผู้จัดการหรือแอดมินต้องระบุเหตุผลสำหรับการชำระภายหลัง' : 'A manager or admin must enter a pay-later reason.')
      }
      if (settlement === 'PAY_NOW' && ['CARD', 'BANK_TRANSFER', 'ONLINE'].includes(method) && !reference.trim()) {
        throw new Error(language === 'th' ? 'ต้องระบุเลขอ้างอิงการชำระเงิน' : 'A payment reference is required.')
      }

      const freshQuote = await liteApi.walkInQuote(quoteInput)
      if (!freshQuote.readyRooms.some((room) => room.id === assignedRoomId)) {
        throw new Error(language === 'th' ? 'ห้องที่เลือกไม่พร้อมแล้ว กรุณาเลือกห้องใหม่' : 'The selected room is no longer ready. Choose another room.')
      }
      return liteApi.createWalkIn({
        checkIn: freshQuote.checkIn,
        checkOut: freshQuote.checkOut,
        roomTypeCode: freshQuote.roomType.code,
        assignedRoomId,
        adults: freshQuote.occupancy.adults,
        children: freshQuote.occupancy.children,
        childAges: freshQuote.occupancy.childAges,
        expectedTotalSatang: freshQuote.pricing.totalSatang,
        guest: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          nationality: nationality.trim(),
          idType,
          idNumber: idNumber.trim(),
        },
        ...(settlement === 'PAY_NOW'
          ? {
              payment: {
                amountSatang: freshQuote.paymentPolicy.amountDueSatang,
                method,
                ...(reference.trim() ? { reference: reference.trim() } : {}),
              },
            }
          : { allowPayLater: true, payLaterReason: payLaterReason.trim() }),
      })
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
    <form className="walk-in-form" onSubmit={submit}>
      <section className="walk-in-section">
        <div className="walk-in-section__heading"><span>01</span><div><h3>{language === 'th' ? 'ผู้เข้าพักและเอกสาร' : 'Guest & identity'}</h3><p>{language === 'th' ? 'จำเป็นสำหรับการเช็คอินทันที' : 'Required for immediate check-in.'}</p></div></div>
        <div className="walk-in-grid">
          <label>{t('firstName')}<input autoComplete="given-name" required value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
          <label>{t('lastName')}<input autoComplete="family-name" required value={lastName} onChange={(event) => setLastName(event.target.value)} /></label>
          <label>{language === 'th' ? 'อีเมล (ไม่บังคับ)' : 'Email (optional)'}<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>{language === 'th' ? 'โทรศัพท์ (ไม่บังคับ)' : 'Phone (optional)'}<input type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
          <label>{language === 'th' ? 'สัญชาติ' : 'Nationality'}<input required value={nationality} onChange={(event) => setNationality(event.target.value)} /></label>
          <label>{language === 'th' ? 'ประเภทเอกสาร' : 'Identity type'}<select value={idType} onChange={(event) => setIdType(event.target.value)}><option value="PASSPORT">{language === 'th' ? 'หนังสือเดินทาง' : 'Passport'}</option><option value="NATIONAL_ID">{language === 'th' ? 'บัตรประชาชน' : 'National ID'}</option><option value="OTHER">{language === 'th' ? 'เอกสารอื่น' : 'Other ID'}</option></select></label>
          <label className="walk-in-span">{language === 'th' ? 'เลขเอกสาร' : 'Identity number'}<input required autoComplete="off" value={idNumber} onChange={(event) => setIdNumber(event.target.value)} /></label>
        </div>
      </section>

      <section className="walk-in-section">
        <div className="walk-in-section__heading"><span>02</span><div><h3>{language === 'th' ? 'การเข้าพักและห้อง' : 'Stay & room'}</h3><p>{language === 'th' ? 'แสดงเฉพาะห้องที่สะอาดและพร้อมเช็คอิน' : 'Only clean, assignable rooms are shown.'}</p></div></div>
        <div className="walk-in-grid">
          <label>{language === 'th' ? 'เช็คอินวันนี้' : 'Check-in today'}<input readOnly value={checkIn} /></label>
          <label>{t('checkOutDate')}<input required min={addDateKey(checkIn, 1)} type="date" value={checkOut} onChange={(event) => setCheckOut(event.target.value)} /></label>
          <label>{t('roomType')}<select required value={roomTypeCode} onChange={(event) => setRoomTypeCode(event.target.value)}>{roomTypes.map((roomType) => <option value={roomType.code} key={roomType.id}>{roomType.name}</option>)}</select></label>
          <label>{language === 'th' ? 'ห้องพร้อมใช้' : 'Ready room'}<select required disabled={!quote.data?.readyRooms.length} value={assignedRoomId} onChange={(event) => setAssignedRoomId(event.target.value)}><option value="">{quote.isFetching ? (language === 'th' ? 'กำลังตรวจสอบ…' : 'Checking…') : (language === 'th' ? 'เลือกห้อง' : 'Select room')}</option>{quote.data?.readyRooms.map((room) => <option value={room.id} key={room.id}>{language === 'th' ? 'ห้อง' : 'Room'} {room.number} · {room.housekeepingStatus === 'INSPECTED' ? (language === 'th' ? 'ตรวจแล้ว' : 'Inspected') : (language === 'th' ? 'สะอาด' : 'Clean')}</option>)}</select></label>
          <label>{t('adults')}<input required min="1" step="1" type="number" value={adults} onChange={(event) => setAdults(event.target.value)} /></label>
          <label>{t('children')}<input min="0" step="1" type="number" value={children} onChange={(event) => {
            const value = event.target.value
            setChildren(value)
            const count = Number(value)
            if (Number.isSafeInteger(count) && count >= 0) setChildAges((current) => Array.from({ length: count }, (_, index) => current[index] || ''))
          }} /></label>
          {childAges.map((age, index) => <label key={index}>{language === 'th' ? `อายุเด็กคนที่ ${index + 1}` : `Child ${index + 1} age`}<input required min="0" max="17" step="1" type="number" value={age} onChange={(event) => setChildAges((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /></label>)}
        </div>
        {quote.error ? <div className="form-error" role="alert">{walkInError(quote.error, language)}</div> : null}
        {quote.data && quote.data.readyRooms.length === 0 ? <div className="notice notice--warning">{language === 'th' ? 'ไม่มีห้องสะอาดพร้อมเช็คอินสำหรับประเภทและวันที่เลือก' : 'No clean room is ready for the selected room type and stay.'}</div> : null}
      </section>

      <section className="walk-in-section walk-in-section--quote">
        <div className="walk-in-section__heading"><span>03</span><div><h3>{language === 'th' ? 'ราคาและการชำระ' : 'Quote & settlement'}</h3><p>{language === 'th' ? 'คำนวณจากอัตราและกฎของโรงแรมบนเซิร์ฟเวอร์' : 'Calculated from server-stored rates and hotel rules.'}</p></div></div>
        {quote.data ? (
          <div className="walk-in-quote">
            <div><span>{quote.data.pricing.nights} {language === 'th' ? 'คืน × ราคาห้อง' : quote.data.pricing.nights === 1 ? 'night × room rate' : 'nights × room rate'}</span><strong>{formatMoney(quote.data.pricing.roomSubtotalSatang, language)}</strong></div>
            {quote.data.pricing.extraGuestFeeSatang > 0 ? <div><span>{language === 'th' ? 'ค่าผู้เข้าพักเพิ่ม' : 'Extra guest fee'}</span><strong>{formatMoney(quote.data.pricing.extraGuestFeeSatang, language)}</strong></div> : null}
            {quote.data.pricing.childFeeSatang > 0 ? <div><span>{language === 'th' ? 'ค่าเด็กพักร่วม' : 'Child sharing fee'}</span><strong>{formatMoney(quote.data.pricing.childFeeSatang, language)}</strong></div> : null}
            <div className="walk-in-quote__total"><span>{language === 'th' ? 'ยอดที่ต้องชำระ' : 'Amount due'}</span><strong>{formatMoney(quote.data.paymentPolicy.amountDueSatang, language)}</strong></div>
          </div>
        ) : <div className="state-card">{quote.isFetching ? (language === 'th' ? 'กำลังคำนวณราคา…' : 'Calculating quote…') : (language === 'th' ? 'กรอกข้อมูลการเข้าพักเพื่อดูราคา' : 'Complete stay details to see the quote.')}</div>}
        <div className="walk-in-grid walk-in-settlement">
          <label>{language === 'th' ? 'การชำระ' : 'Settlement'}<select value={settlement} onChange={(event) => setSettlement(event.target.value as 'PAY_NOW' | 'PAY_LATER')}><option value="PAY_NOW">{language === 'th' ? 'รับชำระเต็มจำนวนตอนนี้' : 'Collect full payment now'}</option>{canPayLater ? <option value="PAY_LATER">{language === 'th' ? 'ชำระภายหลัง (ผู้จัดการ)' : 'Pay later (manager override)'}</option> : null}</select></label>
          {settlement === 'PAY_NOW' ? <><label>{language === 'th' ? 'วิธีชำระ' : 'Payment method'}<select value={method} onChange={(event) => setMethod(event.target.value)}>{['CASH', 'CARD', 'BANK_TRANSFER', 'ONLINE', 'OTHER'].map((value) => <option key={value} value={value}>{statusLabel(value, language)}</option>)}</select></label>{['CARD', 'BANK_TRANSFER', 'ONLINE'].includes(method) ? <label className="walk-in-span">{language === 'th' ? 'เลขอ้างอิงการชำระ' : 'Payment reference'}<input required value={reference} onChange={(event) => setReference(event.target.value)} /></label> : null}</> : <label className="walk-in-span">{language === 'th' ? 'เหตุผลที่อนุมัติให้ชำระภายหลัง' : 'Approved pay-later reason'}<textarea required rows={2} value={payLaterReason} onChange={(event) => setPayLaterReason(event.target.value)} /></label>}
        </div>
      </section>

      {mutation.error ? <div className="form-error walk-in-error" role="alert">{walkInError(mutation.error, language)}</div> : null}
      <footer className="walk-in-footer"><p>{language === 'th' ? 'การยืนยันจะสร้างการจอง มอบหมายห้อง เปิดโฟลิโอ บันทึกการชำระ และเช็คอินในธุรกรรมเดียว' : 'Confirmation creates the booking, assigns the room, opens the folio, records settlement, and checks in atomically.'}</p><div><button type="button" className="button button--secondary" onClick={close}>{t('cancel')}</button><button className="button button--primary" disabled={mutation.isPending || quote.isFetching || !quote.data || !assignedRoomId}>{mutation.isPending ? (language === 'th' ? 'กำลังเช็คอิน…' : 'Checking in…') : (language === 'th' ? 'ยืนยันและเช็คอิน' : 'Confirm & check in')}</button></div></footer>
    </form>
  )
}
