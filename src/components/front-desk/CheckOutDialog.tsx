import { useEffect, useState } from 'react'
import type { CheckOutData, DepartureItem, WorkflowGuardItem } from '@/types/front-desk'
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
import { CheckCircle, CreditCard, Key, Lightning, SignOut, Warning } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { buildCheckOutGuards, isManagerRole } from '@/lib/front-desk-workflow'

interface CheckOutDialogProps {
  departure: DepartureItem | null
  mode: 'express' | 'guided'
  role?: UserRole | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (data: CheckOutData) => void
}

type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'PROMPTPAY' | 'OTHER'
const paymentMethods: PaymentMethod[] = ['CASH', 'CARD', 'TRANSFER', 'PROMPTPAY', 'OTHER']

export function CheckOutDialog({ departure, mode, role, open, onOpenChange, onConfirm }: CheckOutDialogProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [paymentAmount, setPaymentAmount] = useState(0)
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentConfirmed, setPaymentConfirmed] = useState(false)
  const [keyReturned, setKeyReturned] = useState(true)
  const [guestDeparted, setGuestDeparted] = useState(true)
  const [feedbackRequested, setFeedbackRequested] = useState(false)
  const [forceCheckout, setForceCheckout] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [notes, setNotes] = useState('')
  const managerOverride = isManagerRole(role)

  useEffect(() => {
    if (!open || !departure) return
    setPaymentMethod('CASH')
    setPaymentAmount(departure.balanceDue > 0 ? departure.balanceDue : 0)
    setPaymentReference('')
    setPaymentConfirmed(departure.balanceDue === 0)
    setKeyReturned(true)
    setGuestDeparted(true)
    setFeedbackRequested(false)
    setForceCheckout(false)
    setOverrideReason('')
    setNotes('')
  }, [departure, open])

  if (!departure) return null

  const paidNow = paymentConfirmed ? Math.min(paymentAmount, departure.balanceDue) : 0
  const effectiveDeparture: DepartureItem = {
    ...departure,
    balanceDue: Math.max(0, departure.balanceDue - paidNow),
    paymentStatus: departure.balanceDue - paidNow <= 0 ? 'PAID' : departure.paymentStatus,
  }
  const summary = buildCheckOutGuards(effectiveDeparture, { role })
  const unresolvedBlockers = summary.blockers.filter((item) =>
    !isCheckoutBlockerResolvedByOverride(item, forceCheckout && managerOverride && Boolean(overrideReason.trim())),
  )
  const canComplete = unresolvedBlockers.length === 0 && keyReturned && guestDeparted
  const confirmationLabel = !canComplete
    ? 'Fix Required Items'
    : mode === 'express'
      ? 'Confirm Express Check-Out'
      : summary.warnings.length > 0
        ? 'Complete with Note'
        : 'Complete Check-Out'

  const complete = () => {
    if (!canComplete) {
      toast.error('Resolve checkout blockers before completing departure.')
      return
    }
    onConfirm({
      reservationId: departure.reservationId,
      actualCheckOut: new Date(),
      paymentMethod: paidNow > 0 ? paymentMethod : undefined,
      paymentReference: paymentReference || undefined,
      paymentAmount: paidNow > 0 ? paidNow : undefined,
      balanceSettled: effectiveDeparture.balanceDue === 0,
      keyReturned,
      roomConditionCheck: 'GOOD',
      feedbackRequested,
      forceCheckout,
      overrideReason: overrideReason || undefined,
      additionalNotes: notes || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            {mode === 'express' ? <Lightning className="text-emerald-600" size={21} weight="bold" /> : <SignOut className="text-amber-600" size={21} weight="bold" />}
            {mode === 'express' ? 'Express Check-Out' : 'Check Out'}: {departure.guestName}
          </DialogTitle>
          <DialogDescription>
            Room {departure.roomNumber} - {departure.nights} night{departure.nights === 1 ? '' : 's'} - checkout {departure.checkOutTime}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <GuardList
            blockers={unresolvedBlockers}
            warnings={summary.warnings}
            onCollectBalance={() => {
              setPaymentAmount(departure.balanceDue)
              setPaymentConfirmed(true)
            }}
          />

          <section className="grid gap-3 md:grid-cols-3">
            <SummaryBox label="Guest" value={departure.guestName} />
            <SummaryBox label="Room" value={departure.roomNumber} />
            <SummaryBox label="Actual checkout" value={new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} />
          </section>

          {mode === 'express' && summary.isExpressReady ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              Balance THB 0. Room will be marked dirty and sent to housekeeping after confirmation.
            </div>
          ) : (
            <>
              <section className="rounded-lg border p-3">
                <div className="mb-3 flex items-center gap-2 font-semibold">
                  <CreditCard size={17} weight="bold" />
                  Folio Review
                </div>
                <div className="grid gap-2 sm:grid-cols-4">
                  <SummaryBox label="Folio total" value={`THB ${departure.folioTotal.toLocaleString('en-US')}`} />
                  <SummaryBox label="Paid" value={`THB ${(departure.paidAmount || Math.max(0, departure.folioTotal - departure.balanceDue)).toLocaleString('en-US')}`} />
                  <SummaryBox label="Balance due" value={`THB ${Math.max(0, departure.balanceDue - paidNow).toLocaleString('en-US')}`} tone={departure.balanceDue - paidNow > 0 ? 'danger' : 'ok'} />
                  <SummaryBox label="Folio status" value={departure.folioStatus || 'OPEN'} />
                </div>

                {departure.balanceDue > 0 && (
                  <div className="mt-3 grid gap-2 md:grid-cols-[150px_1fr_1fr_140px]">
                    <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}>
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
                      value={paymentAmount || ''}
                      onChange={(event) => setPaymentAmount(Number(event.target.value))}
                      placeholder="Amount"
                    />
                    <Input
                      value={paymentReference}
                      onChange={(event) => setPaymentReference(event.target.value)}
                      placeholder="Reference"
                    />
                    <label className="flex items-center gap-2 rounded-md border px-2 text-xs">
                      <Checkbox checked={paymentConfirmed} onCheckedChange={(checked) => setPaymentConfirmed(Boolean(checked))} />
                      Confirmed
                    </label>
                  </div>
                )}

                {managerOverride && departure.balanceDue - paidNow > 0 && (
                  <label className="mt-3 flex items-center gap-2 text-xs">
                    <Checkbox checked={forceCheckout} onCheckedChange={(checked) => setForceCheckout(Boolean(checked))} />
                    Force checkout with unresolved balance
                  </label>
                )}
              </section>

              <section className="rounded-lg border p-3">
                <div className="mb-3 flex items-center gap-2 font-semibold">
                  <Key size={17} weight="bold" />
                  Final Confirmation
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <Checkbox checked={keyReturned} onCheckedChange={(checked) => setKeyReturned(Boolean(checked))} />
                    Keys returned
                  </label>
                  <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <Checkbox checked={guestDeparted} onCheckedChange={(checked) => setGuestDeparted(Boolean(checked))} />
                    Guest departed
                  </label>
                  <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <Checkbox checked={feedbackRequested} onCheckedChange={(checked) => setFeedbackRequested(Boolean(checked))} />
                    Feedback requested
                  </label>
                </div>
              </section>
            </>
          )}

          {(forceCheckout || summary.warnings.length > 0) && (
            <div className="space-y-1">
              <Label htmlFor="checkout-note">Reason / note</Label>
              <Textarea
                id="checkout-note"
                value={overrideReason || notes}
                onChange={(event) => {
                  setOverrideReason(event.target.value)
                  setNotes(event.target.value)
                }}
                rows={2}
                placeholder="Required for forced checkout; useful for warning-only completion."
              />
            </div>
          )}

          <Separator />
          <div className="grid gap-2 text-sm sm:grid-cols-4">
            <ChecklistItem label="Folio settled" ok={effectiveDeparture.balanceDue === 0 || (forceCheckout && managerOverride && Boolean(overrideReason.trim()))} />
            <ChecklistItem label="Keys returned" ok={keyReturned} />
            <ChecklistItem label="Guest departed" ok={guestDeparted} />
            <ChecklistItem label="Room dirty handoff" ok />
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

function isCheckoutBlockerResolvedByOverride(item: WorkflowGuardItem, forceCheckout: boolean) {
  return item.id === 'unsettled_balance' && forceCheckout
}

function GuardList({
  blockers,
  warnings,
  onCollectBalance,
}: {
  blockers: WorkflowGuardItem[]
  warnings: WorkflowGuardItem[]
  onCollectBalance: () => void
}) {
  if (blockers.length === 0 && warnings.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
        All checkout requirements are satisfied.
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
          {item.id === 'unsettled_balance' ? (
            <Button size="sm" variant="outline" onClick={onCollectBalance}>Collect Balance</Button>
          ) : (
            <Badge variant="outline">{item.quickActionLabel}</Badge>
          )}
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

function SummaryBox({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'danger' }) {
  return (
    <div className={cn(
      'rounded-md border px-3 py-2',
      tone === 'ok' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
      tone === 'danger' && 'border-rose-200 bg-rose-50 text-rose-800',
    )}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate font-semibold">{value}</div>
    </div>
  )
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
