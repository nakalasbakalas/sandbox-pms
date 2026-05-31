import { useEffect, useMemo, useState } from 'react'
import type { ArrivalItem, CheckInData, PaymentCollection, WorkflowGuardItem } from '@/types/front-desk'
import type { BoardRoomCard } from '@/types/board'
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
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Bed, CheckCircle, CreditCard, IdentificationCard, Lightning, Warning } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  amountDueForArrival,
  buildCheckInGuards,
  findBestAvailableRoom,
  findRoomForArrival,
  isManagerRole,
} from '@/lib/front-desk-workflow'

interface CheckInDialogProps {
  arrival: ArrivalItem | null
  rooms: BoardRoomCard[]
  mode: 'express' | 'guided'
  role?: UserRole | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (data: CheckInData) => void
  onMarkRoomReady?: (roomId: string) => void
}

const paymentMethods: PaymentCollection['method'][] = ['CASH', 'CARD', 'TRANSFER', 'OTHER']

export function CheckInDialog({
  arrival,
  rooms,
  mode,
  role,
  open,
  onOpenChange,
  onConfirm,
  onMarkRoomReady,
}: CheckInDialogProps) {
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const [nationality, setNationality] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [recordIdentityLater, setRecordIdentityLater] = useState(false)
  const [payment, setPayment] = useState<PaymentCollection>({
    reservationId: '',
    amount: 0,
    method: 'CASH',
  })
  const [paymentConfirmed, setPaymentConfirmed] = useState(false)
  const [payLater, setPayLater] = useState(false)
  const [allowRoomOverride, setAllowRoomOverride] = useState(false)
  const [allowDateOverride, setAllowDateOverride] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [notes, setNotes] = useState('')

  const managerOverride = isManagerRole(role)

  useEffect(() => {
    if (!open || !arrival) return
    const assigned = findRoomForArrival(arrival, rooms)
    setSelectedRoomId(assigned?.roomId || '')
    setNationality(arrival.guestNationality || '')
    setIdNumber(arrival.guestIdNumber || '')
    setRecordIdentityLater(false)
    setPayment({
      reservationId: arrival.reservationId,
      amount: 0,
      method: 'CASH',
    })
    setPaymentConfirmed(false)
    setPayLater(false)
    setAllowRoomOverride(false)
    setAllowDateOverride(false)
    setOverrideReason('')
    setNotes('')
  }, [arrival, open, rooms])

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.roomId === selectedRoomId) || (arrival ? findRoomForArrival(arrival, rooms) : undefined),
    [arrival, rooms, selectedRoomId],
  )

  const bestRoom = useMemo(() => arrival ? findBestAvailableRoom(rooms, arrival) : undefined, [arrival, rooms])

  if (!arrival) return null

  const originalDue = amountDueForArrival(arrival)
  const paidNow = paymentConfirmed ? Math.min(payment.amount, originalDue) : 0
  const identityComplete = Boolean((arrival.documentVerified || (nationality.trim() && idNumber.trim())))
  const effectiveArrival: ArrivalItem = {
    ...arrival,
    assignedRoomId: selectedRoom?.roomId || arrival.assignedRoomId,
    roomNumber: selectedRoom?.number || arrival.roomNumber,
    documentVerified: identityComplete,
    guestNationality: nationality || arrival.guestNationality,
    guestIdNumber: idNumber || arrival.guestIdNumber,
    balanceDue: Math.max(0, originalDue - paidNow),
  }
  const summary = buildCheckInGuards(effectiveArrival, selectedRoom, { role })
  const unresolvedBlockers = summary.blockers.filter((item) =>
    !isCheckInBlockerResolvedByOverride(item, {
      payLater: payLater && managerOverride && Boolean(overrideReason.trim()),
      recordIdentityLater: recordIdentityLater && managerOverride && Boolean(overrideReason.trim()),
      roomOverride: allowRoomOverride && managerOverride && Boolean(overrideReason.trim()),
      dateOverride: allowDateOverride && managerOverride && Boolean(overrideReason.trim()),
    }),
  )
  const canComplete = unresolvedBlockers.length === 0
  const showGuidedFields = mode === 'guided' || !summary.isExpressReady
  const confirmationLabel = !canComplete
    ? 'Fix Required Items'
    : mode === 'express'
      ? 'Confirm Express Check-In'
      : summary.warnings.length > 0
        ? 'Complete with Note'
        : 'Complete Check-In'

  const complete = () => {
    if (!selectedRoom) {
      toast.error('Assign a room before check-in.')
      return
    }
    if (!canComplete) {
      toast.error('Resolve blockers before check-in.')
      return
    }
    onConfirm({
      reservationId: arrival.reservationId,
      roomId: selectedRoom.roomId,
      actualCheckIn: new Date(),
      guestVerified: identityComplete || recordIdentityLater,
      depositConfirmed: originalDue === 0 || paidNow >= originalDue || payLater,
      documentsCollected: identityComplete,
      roomConditionNoted: true,
      welcomePackProvided: true,
      nationality: nationality || undefined,
      idNumber: idNumber || undefined,
      recordIdentityLater,
      payment: paidNow > 0 ? { ...payment, amount: paidNow } : undefined,
      payLaterReason: payLater ? overrideReason : undefined,
      overrideReason: overrideReason || undefined,
      allowRoomReadinessOverride: allowRoomOverride,
      allowDateOverride,
      additionalNotes: notes || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto p-4 sm:max-h-[calc(100dvh-2rem)] sm:max-w-[min(1040px,calc(100vw-2rem))] sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            {mode === 'express' ? <Lightning className="text-emerald-600" size={21} weight="bold" /> : <CheckCircle className="text-blue-600" size={21} weight="bold" />}
            {mode === 'express' ? 'Express Check-In' : 'Check In'}: {arrival.guestName}
          </DialogTitle>
          <DialogDescription>
            {arrival.confirmationCode || arrival.reservationId.slice(0, 8)} - {arrival.roomType} - {arrival.nights} night{arrival.nights === 1 ? '' : 's'} - {selectedRoom ? `Room ${selectedRoom.number}` : 'Room TBD'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <GuardList
            blockers={unresolvedBlockers}
            warnings={summary.warnings}
            onAssignBest={bestRoom ? () => setSelectedRoomId(bestRoom.roomId) : undefined}
            onMarkRoomReady={selectedRoom && onMarkRoomReady ? () => onMarkRoomReady(selectedRoom.roomId) : undefined}
            onCollectPayment={() => {
              setPayment((current) => ({ ...current, amount: originalDue }))
              setPaymentConfirmed(true)
            }}
          />

          {mode === 'express' && summary.isExpressReady && (
            <div className="grid gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 sm:grid-cols-3">
              <div><span className="text-emerald-700">Guest</span><div className="font-semibold">{arrival.guestName}</div></div>
              <div><span className="text-emerald-700">Room</span><div className="font-semibold">{selectedRoom?.number || arrival.roomNumber}</div></div>
              <div><span className="text-emerald-700">Balance</span><div className="font-semibold">THB 0</div></div>
            </div>
          )}

          {showGuidedFields && (
            <>
              <section className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <div className="mb-3 flex items-center gap-2 font-semibold">
                    <IdentificationCard size={17} weight="bold" />
                    Guest
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs font-medium">Nationality</span>
                      <Input value={nationality} onChange={(event) => setNationality(event.target.value)} placeholder="Thai, USA, UK" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium">ID/passport</span>
                      <Input value={idNumber} onChange={(event) => setIdNumber(event.target.value)} placeholder="ID or passport number" />
                    </label>
                  </div>
                  {nationality && !/^thai?land$|^thai$/i.test(nationality.trim()) && (
                    <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs text-blue-800">
                      Non-Thai guest: confirm passport details for immigration reporting.
                    </div>
                  )}
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
                    Room
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    <Select value={selectedRoomId} onValueChange={setSelectedRoomId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select clean available room" />
                      </SelectTrigger>
                      <SelectContent>
                        {rooms
                          .filter((room) => room.type === arrival.roomType)
                          .map((room) => (
                            <SelectItem key={room.roomId} value={room.roomId}>
                              Room {room.number} - {room.cleanStatus} - {room.status}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" disabled={!bestRoom} onClick={() => bestRoom && setSelectedRoomId(bestRoom.roomId)}>
                      Assign Best Room
                    </Button>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Best clean room: {bestRoom ? `Room ${bestRoom.number}` : 'none available'}
                  </div>
                  {managerOverride && selectedRoom && !summary.isExpressReady && (
                    <label className="mt-3 flex items-center gap-2 text-xs">
                      <Checkbox checked={allowRoomOverride} onCheckedChange={(checked) => setAllowRoomOverride(Boolean(checked))} />
                      Override dirty/uninspected room readiness
                    </label>
                  )}
                </div>
              </section>

              <section className="rounded-lg border p-3">
                <div className="mb-3 flex items-center gap-2 font-semibold">
                  <CreditCard size={17} weight="bold" />
                  Payment / Folio
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                  <div>
                    <div className="text-xs text-muted-foreground">Total stay</div>
                    <div className="text-xl font-semibold">THB {arrival.totalAmount.toLocaleString('en-US')}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Amount due at check-in</div>
                    <div className={cn('text-xl font-semibold', originalDue > 0 ? 'text-rose-700' : 'text-emerald-700')}>
                      THB {Math.max(0, originalDue - paidNow).toLocaleString('en-US')}
                    </div>
                  </div>
                  {originalDue > 0 && (
                    <Button type="button" onClick={() => {
                      setPayment((current) => ({ ...current, amount: originalDue }))
                      setPaymentConfirmed(true)
                    }}>
                      Pay Full Amount
                    </Button>
                  )}
                </div>

                {originalDue > 0 && (
                  <div className="mt-3 grid gap-2 md:grid-cols-[150px_1fr_140px]">
                    <Select value={payment.method} onValueChange={(method) => setPayment((current) => ({ ...current, method: method as PaymentCollection['method'] }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {paymentMethods.map((method) => <SelectItem key={method} value={method}>{method}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min="0"
                      value={payment.amount || ''}
                      onChange={(event) => setPayment((current) => ({ ...current, amount: Number(event.target.value) }))}
                      placeholder="Payment amount"
                    />
                    <label className="flex items-center gap-2 rounded-md border px-2 text-xs">
                      <Checkbox checked={paymentConfirmed} onCheckedChange={(checked) => setPaymentConfirmed(Boolean(checked))} />
                      Confirmed
                    </label>
                  </div>
                )}

                {managerOverride && originalDue - paidNow > 0 && (
                  <label className="mt-3 flex items-center gap-2 text-xs">
                    <Checkbox checked={payLater} onCheckedChange={(checked) => setPayLater(Boolean(checked))} />
                    Pay later with manager/admin reason
                  </label>
                )}
              </section>

              {managerOverride && summary.blockers.some((item) => item.id === 'date_mismatch') && (
                <label className="flex items-center gap-2 rounded-lg border p-3 text-xs">
                  <Checkbox checked={allowDateOverride} onCheckedChange={(checked) => setAllowDateOverride(Boolean(checked))} />
                  Override arrival date mismatch
                </label>
              )}

              {(recordIdentityLater || payLater || allowRoomOverride || allowDateOverride || summary.warnings.length > 0) && (
                <div className="space-y-1">
                  <Label htmlFor="checkin-override-note">Reason / note</Label>
                  <Textarea
                    id="checkin-override-note"
                    value={overrideReason || notes}
                    onChange={(event) => {
                      setOverrideReason(event.target.value)
                      setNotes(event.target.value)
                    }}
                    rows={2}
                    placeholder="Required for overrides; useful for warning-only completion."
                  />
                </div>
              )}
            </>
          )}

          <Separator />
          <div className="grid gap-2 text-sm sm:grid-cols-4">
            <ChecklistItem label="Room assigned" ok={Boolean(selectedRoom)} />
            <ChecklistItem label="Room ready" ok={Boolean(selectedRoom && summary.blockers.every((item) => item.id !== 'room_not_ready')) || allowRoomOverride} />
            <ChecklistItem label="Identity handled" ok={identityComplete || (recordIdentityLater && managerOverride && Boolean(overrideReason.trim()))} />
            <ChecklistItem label="Balance handled" ok={originalDue - paidNow <= 0 || (payLater && managerOverride && Boolean(overrideReason.trim()))} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canComplete} onClick={complete} className={mode === 'express' ? 'bg-emerald-600 hover:bg-emerald-700' : undefined}>
            {confirmationLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function isCheckInBlockerResolvedByOverride(
  item: WorkflowGuardItem,
  state: { payLater: boolean; recordIdentityLater: boolean; roomOverride: boolean; dateOverride: boolean },
) {
  if (item.id === 'payment_due') return state.payLater
  if (item.id === 'missing_identity') return state.recordIdentityLater
  if (item.id === 'room_not_ready') return state.roomOverride
  if (item.id === 'date_mismatch') return state.dateOverride
  return false
}

function GuardList({
  blockers,
  warnings,
  onAssignBest,
  onMarkRoomReady,
  onCollectPayment,
}: {
  blockers: WorkflowGuardItem[]
  warnings: WorkflowGuardItem[]
  onAssignBest?: () => void
  onMarkRoomReady?: () => void
  onCollectPayment: () => void
}) {
  if (blockers.length === 0 && warnings.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
        All check-in requirements are satisfied.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {blockers.map((item) => (
        <div key={item.id} className="flex flex-col gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold">{item.label}</div>
            <div className="text-xs text-rose-800/80">{item.status} - {item.requiredAction}</div>
          </div>
          <QuickAction item={item} onAssignBest={onAssignBest} onMarkRoomReady={onMarkRoomReady} onCollectPayment={onCollectPayment} />
        </div>
      ))}
      {warnings.map((item) => (
        <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          <span><span className="font-semibold">{item.label}</span> - {item.requiredAction}</span>
          <Badge variant="outline" className="border-amber-300 text-amber-800">Warning</Badge>
        </div>
      ))}
    </div>
  )
}

function QuickAction({
  item,
  onAssignBest,
  onMarkRoomReady,
  onCollectPayment,
}: {
  item: WorkflowGuardItem
  onAssignBest?: () => void
  onMarkRoomReady?: () => void
  onCollectPayment: () => void
}) {
  if (item.id === 'no_room_assigned' && onAssignBest) {
    return <Button size="sm" variant="outline" onClick={onAssignBest}>Assign Best Room</Button>
  }
  if (item.id === 'room_not_ready' && onMarkRoomReady) {
    return <Button size="sm" variant="outline" onClick={onMarkRoomReady}>Mark Clean/Inspected</Button>
  }
  if (item.id === 'payment_due') {
    return <Button size="sm" variant="outline" onClick={onCollectPayment}>Collect Payment</Button>
  }
  return <Badge variant="outline">{item.quickActionLabel}</Badge>
}

function ChecklistItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={cn(
      'rounded-md border px-2 py-1.5',
      ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800',
    )}>
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        {ok ? <CheckCircle size={13} weight="bold" /> : <Warning size={13} weight="bold" />}
        {label}
      </div>
    </div>
  )
}
