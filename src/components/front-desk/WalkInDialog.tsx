import { useMemo, useState } from 'react'
import type { BoardRoomCard } from '@/types/board'
import type { PaymentCollection } from '@/types/front-desk'
import type { UserRole } from '@/types/auth'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Bed, CheckCircle, CreditCard, UserPlus, Warning } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { calculateStayPricing, getBangkokDateKey, SANDBOX_HOTEL_RULES } from '@/lib/hotel/business-rules'
import { findBestAvailableRoom, isManagerRole } from '@/lib/front-desk-workflow'

export interface WalkInPayload {
  guest: {
    firstName: string
    lastName: string
    email?: string
    phone?: string
    nationality?: string
    idType?: string
    idNumber?: string
  }
  roomTypeCode: 'TWIN' | 'DOUBLE'
  checkIn: string
  checkOut: string
  adults: number
  children: number
  childAges: number[]
  ratePerNight: number
  assignedRoomId?: string
  payment?: PaymentCollection
  allowPayLater?: boolean
  payLaterReason?: string
  recordIdentityLater?: boolean
  recordIdentityLaterReason?: string
  overrideReason?: string
  notes?: string
  source: 'WALK_IN'
}

interface WalkInDialogProps {
  open: boolean
  rooms: BoardRoomCard[]
  role?: UserRole | null
  onOpenChange: (open: boolean) => void
  onConfirm: (payload: WalkInPayload) => void
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function parseChildAges(value: string, children: number) {
  const parsed = value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((age) => Number.isFinite(age) && age >= 0)
  if (parsed.length >= children) return parsed.slice(0, children)
  return [...parsed, ...Array.from({ length: Math.max(0, children - parsed.length) }, () => 6)]
}

export function WalkInDialog({ open, rooms, role, onOpenChange, onConfirm }: WalkInDialogProps) {
  const todayKey = getBangkokDateKey(new Date())
  const [roomType, setRoomType] = useState<'TWIN' | 'DOUBLE'>('TWIN')
  const [nights, setNights] = useState(1)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [nationality, setNationality] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [adults, setAdults] = useState(1)
  const [children, setChildren] = useState(0)
  const [childAgeText, setChildAgeText] = useState('')
  const [ratePerNight, setRatePerNight] = useState(1500)
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentCollection['method']>('CASH')
  const [paymentAmount, setPaymentAmount] = useState(0)
  const [paymentConfirmed, setPaymentConfirmed] = useState(false)
  const [payLater, setPayLater] = useState(false)
  const [recordIdentityLater, setRecordIdentityLater] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [notes, setNotes] = useState('')
  const managerOverride = isManagerRole(role)

  const checkOutKey = getBangkokDateKey(addDays(new Date(`${todayKey}T00:00:00`), Math.max(1, nights)))
  const childAges = parseChildAges(childAgeText, children)
  const pricing = calculateStayPricing({
    checkIn: todayKey,
    checkOut: checkOutKey,
    ratePerNight,
    adults,
    childAges,
  })
  const fakeArrival = {
    reservationId: 'walk-in',
    roomType,
    checkInDate: todayKey,
    checkOutDate: checkOutKey,
  }
  const bestRoom = useMemo(() => findBestAvailableRoom(rooms, fakeArrival), [rooms, roomType, todayKey, checkOutKey])
  const selectedRoom = rooms.find((room) => room.roomId === selectedRoomId) || bestRoom
  const identityComplete = Boolean(nationality.trim() && idNumber.trim())
  const dueAfterPayment = Math.max(0, pricing.total - (paymentConfirmed ? paymentAmount : 0))
  const canPayLater = managerOverride && payLater && Boolean(overrideReason.trim())
  const canRecordLater = managerOverride && recordIdentityLater && Boolean(overrideReason.trim())
  const canComplete = Boolean(
    firstName.trim() &&
    lastName.trim() &&
    selectedRoom &&
    pricing.warnings.length === 0 &&
    (identityComplete || canRecordLater) &&
    (dueAfterPayment === 0 || canPayLater),
  )

  const resetAndClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setFirstName('')
      setLastName('')
      setPhone('')
      setEmail('')
      setNationality('')
      setIdNumber('')
      setAdults(1)
      setChildren(0)
      setChildAgeText('')
      setRoomType('TWIN')
      setNights(1)
      setRatePerNight(1500)
      setSelectedRoomId('')
      setPaymentAmount(0)
      setPaymentConfirmed(false)
      setPayLater(false)
      setRecordIdentityLater(false)
      setOverrideReason('')
      setNotes('')
    }
    onOpenChange(nextOpen)
  }

  const submit = () => {
    if (!canComplete || !selectedRoom) {
      toast.error('Complete required walk-in details before check-in.')
      return
    }
    onConfirm({
      guest: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        nationality: nationality.trim() || undefined,
        idType: idNumber.trim() ? 'PASSPORT' : undefined,
        idNumber: idNumber.trim() || undefined,
      },
      roomTypeCode: roomType,
      checkIn: todayKey,
      checkOut: checkOutKey,
      adults,
      children,
      childAges,
      ratePerNight,
      assignedRoomId: selectedRoom.roomId,
      payment: paymentConfirmed && paymentAmount > 0 ? {
        reservationId: 'walk-in',
        amount: Math.min(paymentAmount, pricing.total),
        method: paymentMethod,
      } : undefined,
      allowPayLater: payLater,
      payLaterReason: payLater ? overrideReason : undefined,
      recordIdentityLater,
      recordIdentityLaterReason: recordIdentityLater ? overrideReason : undefined,
      overrideReason: overrideReason || undefined,
      notes: notes || undefined,
      source: 'WALK_IN',
    })
  }

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <UserPlus className="text-blue-600" size={21} weight="bold" />
            Walk-In Check-In
          </DialogTitle>
          <DialogDescription>
            Create reservation, assign a clean room, post payment, and check in from one panel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <section className="grid gap-3 md:grid-cols-4">
            <label className="space-y-1">
              <span className="text-xs font-medium">Room type</span>
              <Select value={roomType} onValueChange={(value) => {
                const type = value as 'TWIN' | 'DOUBLE'
                setRoomType(type)
                setRatePerNight(type === 'TWIN' ? 1500 : 1800)
                setSelectedRoomId('')
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TWIN">Twin</SelectItem>
                  <SelectItem value="DOUBLE">Double</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium">Nights</span>
              <Input type="number" min="1" value={nights} onChange={(event) => setNights(Math.max(1, Number(event.target.value)))} />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium">Rate / night</span>
              <Input type="number" min="1" value={ratePerNight} onChange={(event) => setRatePerNight(Number(event.target.value))} />
            </label>
            <div className="rounded-md border bg-muted/30 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">Stay total</div>
              <div className="font-semibold">THB {pricing.total.toLocaleString('en-US')}</div>
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border p-3">
              <div className="mb-3 font-semibold">Guest</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input placeholder="First name" value={firstName} onChange={(event) => setFirstName(event.target.value)} />
                <Input placeholder="Last name" value={lastName} onChange={(event) => setLastName(event.target.value)} />
                <Input placeholder="Phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
                <Input placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
                <Input placeholder="Nationality" value={nationality} onChange={(event) => setNationality(event.target.value)} />
                <Input placeholder="ID/passport" value={idNumber} onChange={(event) => setIdNumber(event.target.value)} />
              </div>
              {managerOverride && !identityComplete && (
                <label className="mt-3 flex items-center gap-2 text-xs">
                  <Checkbox checked={recordIdentityLater} onCheckedChange={(checked) => setRecordIdentityLater(Boolean(checked))} />
                  Record ID later with manager/admin reason
                </label>
              )}
            </div>

            <div className="rounded-lg border p-3">
              <div className="mb-3 flex items-center gap-2 font-semibold">
                <Bed size={17} weight="bold" />
                Room and Guests
              </div>
              <div className="grid gap-2">
                <Select value={selectedRoomId || bestRoom?.roomId || ''} onValueChange={setSelectedRoomId}>
                  <SelectTrigger><SelectValue placeholder="Assign best clean room" /></SelectTrigger>
                  <SelectContent>
                    {rooms.filter((room) => room.type === roomType).map((room) => (
                      <SelectItem key={room.roomId} value={room.roomId}>
                        Room {room.number} - {room.cleanStatus} - {room.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" disabled={!bestRoom} onClick={() => bestRoom && setSelectedRoomId(bestRoom.roomId)}>
                  Assign Best Room {bestRoom ? bestRoom.number : ''}
                </Button>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <Input type="number" min="1" value={adults} onChange={(event) => setAdults(Math.max(1, Number(event.target.value)))} />
                <Input type="number" min="0" value={children} onChange={(event) => setChildren(Math.max(0, Number(event.target.value)))} />
                <Input placeholder="Child ages" value={childAgeText} onChange={(event) => setChildAgeText(event.target.value)} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Standard occupancy {SANDBOX_HOTEL_RULES.standardOccupancy}, max {SANDBOX_HOTEL_RULES.maxOccupancy}. Enter child ages comma-separated.
              </div>
            </div>
          </section>

          <section className="rounded-lg border p-3">
            <div className="mb-3 flex items-center gap-2 font-semibold">
              <CreditCard size={17} weight="bold" />
              Payment
            </div>
            <div className="grid gap-2 md:grid-cols-[150px_1fr_auto_auto]">
              <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as PaymentCollection['method'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['CASH', 'CARD', 'TRANSFER', 'OTHER'] as PaymentCollection['method'][]).map((method) => <SelectItem key={method} value={method}>{method}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="number" min="0" value={paymentAmount || ''} onChange={(event) => setPaymentAmount(Number(event.target.value))} placeholder="Amount" />
              <Button type="button" variant="outline" onClick={() => {
                setPaymentAmount(pricing.total)
                setPaymentConfirmed(true)
              }}>
                Pay Full
              </Button>
              <label className="flex items-center gap-2 rounded-md border px-2 text-xs">
                <Checkbox checked={paymentConfirmed} onCheckedChange={(checked) => setPaymentConfirmed(Boolean(checked))} />
                Confirmed
              </label>
            </div>
            {managerOverride && dueAfterPayment > 0 && (
              <label className="mt-3 flex items-center gap-2 text-xs">
                <Checkbox checked={payLater} onCheckedChange={(checked) => setPayLater(Boolean(checked))} />
                Pay later with manager/admin reason
              </label>
            )}
          </section>

          {(payLater || recordIdentityLater || notes) && (
            <div className="space-y-1">
              <Label htmlFor="walkin-notes">Reason / note</Label>
              <Textarea
                id="walkin-notes"
                rows={2}
                value={overrideReason || notes}
                onChange={(event) => {
                  setOverrideReason(event.target.value)
                  setNotes(event.target.value)
                }}
                placeholder="Required for overrides."
              />
            </div>
          )}

          {(pricing.warnings.length > 0 || !selectedRoom || dueAfterPayment > 0 || !identityComplete) && (
            <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              {!selectedRoom && <Blocker text="No clean available room is selected." />}
              {!identityComplete && !canRecordLater && <Blocker text="Guest identity is missing." />}
              {dueAfterPayment > 0 && !canPayLater && <Blocker text="Payment is not fully handled." />}
              {pricing.warnings.map((warning) => <Blocker key={warning} text={warning} />)}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => resetAndClose(false)}>Cancel</Button>
          <Button disabled={!canComplete} onClick={submit} className="bg-blue-600 hover:bg-blue-700">
            <CheckCircle size={15} weight="bold" />
            Complete Walk-In Check-In
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Blocker({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Warning size={13} weight="bold" />
      {text}
    </div>
  )
}
