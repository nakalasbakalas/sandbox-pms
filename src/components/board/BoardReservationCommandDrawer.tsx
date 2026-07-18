import { useState, type ReactNode } from 'react'
import { FloppyDisk, LockSimple, Plus, UserCircle, WarningCircle } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DurableAttemptDescriptor } from '@/lib/durable-attempt-key'
import { pmsApi } from '@/lib/pms-api-client'
import type { ServerBookingBoardReservation } from '@/types/server-booking-board'

type CommandRequest = (idempotencyKey: string) => Promise<unknown>

type Props = {
  reservation: ServerBookingBoardReservation
  mutationInFlight: boolean
  canCancel: boolean
  canEditGuest: boolean
  canPostCharge: boolean
  operationsAvailable: boolean
  accountingAvailable: boolean
  onClose: () => void
  onMutation: (attempt: DurableAttemptDescriptor, successMessage: string, request: CommandRequest) => Promise<boolean>
}

/** Converts a user-entered baht decimal into satang without IEEE-754 rounding. */
export function bahtStringToSatang(value: string): string | null {
  const normalized = value.trim().replaceAll(',', '')
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized)
  if (!match) return null
  const whole = BigInt(match[1])
  const fractional = (match[2] || '').padEnd(2, '0')
  const satang = whole * 100n + BigInt(fractional || '0')
  return satang > 0n ? satang.toString() : null
}

function GateNotice({ children }: { children: ReactNode }) {
  return <p className="flex items-center gap-1 text-xs text-muted-foreground"><LockSimple />{children}</p>
}

export function BoardReservationCommandDrawer({
  reservation,
  mutationInFlight,
  canCancel,
  canEditGuest,
  canPostCharge,
  operationsAvailable,
  accountingAvailable,
  onClose,
  onMutation,
}: Props) {
  const [reasonAction, setReasonAction] = useState<'cancel' | 'no-show' | null>(null)
  const [reason, setReason] = useState('')
  const [firstName, setFirstName] = useState(reservation.guest.firstName)
  const [lastName, setLastName] = useState(reservation.guest.lastName)
  const [email, setEmail] = useState(reservation.guest.email || '')
  const [phone, setPhone] = useState(reservation.guest.phone || '')
  const [vipStatus, setVipStatus] = useState(reservation.guest.vipStatus)
  const [extraDescription, setExtraDescription] = useState('')
  const [extraCategory, setExtraCategory] = useState('OTHER')
  const [extraAmount, setExtraAmount] = useState('')
  const [extraQuantity, setExtraQuantity] = useState('1')
  const [extraError, setExtraError] = useState<string | null>(null)

  const submitLifecycle = async () => {
    if (!reasonAction) return
    const trimmedReason = reason.trim()
    if (!trimmedReason) return
    const endpoint = reasonAction === 'cancel' ? 'cancel' : 'no-show'
    const attempt = {
      operation: reasonAction === 'cancel' ? 'reservation-cancel' as const : 'reservation-no-show' as const,
      entityId: reservation.id,
      material: { reason: trimmedReason, expectedUpdatedAt: reservation.updatedAt },
    }
    const applied = await onMutation(attempt, reasonAction === 'cancel' ? 'Reservation cancelled.' : 'Reservation marked no-show.', (idempotencyKey) => pmsApi(`/api/reservations/${encodeURIComponent(reservation.id)}/${endpoint}`, null, {
      method: 'POST', credentials: 'same-origin', headers: {
        'content-type': 'application/json',
        'x-idempotency-key': idempotencyKey,
        'x-reservation-expected-updated-at': reservation.updatedAt,
      }, body: JSON.stringify({ reason: trimmedReason, expectedUpdatedAt: reservation.updatedAt }),
    }))
    if (applied) {
      setReasonAction(null)
      setReason('')
    }
  }

  const saveGuest = async () => {
    const payload = { firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim() || null, phone: phone.trim() || null, vipStatus, expectedGuestUpdatedAt: reservation.guest.updatedAt }
    if (!payload.firstName || !payload.lastName) return
    await onMutation({ operation: 'reservation-update-guest', entityId: reservation.id, material: { guestId: reservation.guest.id, ...payload } }, 'Guest details saved.', (idempotencyKey) => pmsApi(`/api/reservations/${encodeURIComponent(reservation.id)}/guest`, null, {
      method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-idempotency-key': idempotencyKey }, body: JSON.stringify(payload),
    }))
  }

  const postExtra = async () => {
    const description = extraDescription.trim()
    const amountSatang = bahtStringToSatang(extraAmount)
    const quantity = Number(extraQuantity)
    if (!description) return setExtraError('Describe the posted extra.')
    if (!amountSatang) return setExtraError('Enter a positive baht amount with up to two decimals.')
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) return setExtraError('Quantity must be a whole number from 1 to 999.')
    if (!reservation.folio) return setExtraError('This reservation has no open folio for an extra.')
    setExtraError(null)
    const payload = { folioId: reservation.folio.id, description, category: extraCategory, amountSatang, quantity }
    const applied = await onMutation({ operation: 'folio-post-charge', entityId: reservation.folio.id, material: payload }, 'Extra posted to the folio.', (idempotencyKey) => pmsApi('/api/charges', null, {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-idempotency-key': idempotencyKey }, body: JSON.stringify(payload),
    }))
    if (applied) {
      setExtraDescription('')
      setExtraAmount('')
      setExtraQuantity('1')
    }
  }

  const knownLifecycle = ['CANCELLED', 'NO_SHOW'].includes(reservation.status)
  return (
    <section className="mt-4 rounded-lg border bg-muted/30 p-3" aria-label="Reservation command drawer" data-board-command-drawer={reservation.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-sm font-semibold">{reservation.guestName}</p><p className="text-xs text-muted-foreground">{reservation.confirmationCode} · {reservation.status.replaceAll('_', ' ')}</p></div>
        <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={mutationInFlight}>Close drawer</Button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <section className="rounded-md border bg-background p-3" aria-label="Reservation lifecycle">
          <p className="font-medium">Lifecycle</p>
          {!operationsAvailable ? <GateNotice>Reservation commands are unavailable in the server capability registry.</GateNotice> : !canCancel ? <GateNotice>Cancel reservation permission required.</GateNotice> : knownLifecycle ? <GateNotice>This reservation is already closed as {reservation.status.replaceAll('_', ' ').toLowerCase()}.</GateNotice> : (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setReasonAction('cancel')} disabled={mutationInFlight}>Cancel</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setReasonAction('no-show')} disabled={mutationInFlight}>Mark no-show</Button>
            </div>
          )}
          {reasonAction && <div className="mt-3 grid gap-2 rounded border border-amber-200 bg-amber-50 p-2"><label className="grid gap-1 text-xs font-medium">Reason required<textarea className="min-h-16 rounded-md border bg-background p-2 text-sm" value={reason} onChange={(event) => setReason(event.target.value)} disabled={mutationInFlight} /></label><div className="flex gap-2"><Button type="button" size="sm" variant="destructive" onClick={() => void submitLifecycle()} disabled={mutationInFlight || !reason.trim()}>Confirm {reasonAction === 'cancel' ? 'cancellation' : 'no-show'}</Button><Button type="button" size="sm" variant="ghost" onClick={() => { setReasonAction(null); setReason('') }} disabled={mutationInFlight}>Back</Button></div></div>}
        </section>

        <section className="rounded-md border bg-background p-3" aria-label="Guest details">
          <p className="flex items-center gap-1 font-medium"><UserCircle />Guest and VIP</p>
          {!operationsAvailable ? <GateNotice>Guest editing is unavailable in the server capability registry.</GateNotice> : !canEditGuest ? <GateNotice>Reservation edit and guest-view permissions required.</GateNotice> : <div className="mt-2 grid gap-2"><div className="grid grid-cols-2 gap-2"><label className="grid gap-1 text-xs font-medium">First name<Input aria-label="Guest first name" value={firstName} onChange={(event) => setFirstName(event.target.value)} disabled={mutationInFlight} /></label><label className="grid gap-1 text-xs font-medium">Last name<Input aria-label="Guest last name" value={lastName} onChange={(event) => setLastName(event.target.value)} disabled={mutationInFlight} /></label></div><label className="grid gap-1 text-xs font-medium">Email<Input aria-label="Guest email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={mutationInFlight} /></label><label className="grid gap-1 text-xs font-medium">Phone<Input aria-label="Guest phone" value={phone} onChange={(event) => setPhone(event.target.value)} disabled={mutationInFlight} /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={vipStatus} onChange={(event) => setVipStatus(event.target.checked)} disabled={mutationInFlight} />VIP guest</label><Button type="button" size="sm" variant="outline" onClick={() => void saveGuest()} disabled={mutationInFlight || !firstName.trim() || !lastName.trim()}><FloppyDisk />Save guest</Button></div>}
        </section>

        <section className="rounded-md border bg-background p-3" aria-label="Folio extras">
          <p className="flex items-center gap-1 font-medium"><Plus />Post extra</p>
          {!accountingAvailable ? <GateNotice>Folio charge posting is unavailable in the server capability registry.</GateNotice> : !canPostCharge ? <GateNotice>Post charges permission required.</GateNotice> : !reservation.folio ? <GateNotice>No folio is available for this reservation.</GateNotice> : reservation.folio.status !== 'OPEN' ? <GateNotice>This folio is {reservation.folio.status.toLowerCase()} and cannot receive extras.</GateNotice> : <div className="mt-2 grid gap-2"><label className="grid gap-1 text-xs font-medium">Description<Input aria-label="Extra description" placeholder="Laundry, minibar, transfer…" value={extraDescription} onChange={(event) => setExtraDescription(event.target.value)} disabled={mutationInFlight} /></label><label className="grid gap-1 text-xs font-medium">Category<select className="h-9 rounded-md border bg-background px-2 text-sm" value={extraCategory} onChange={(event) => setExtraCategory(event.target.value)} disabled={mutationInFlight}><option value="OTHER">Other</option><option value="MINIBAR">Minibar</option><option value="LAUNDRY">Laundry</option><option value="CAFE">Cafe</option><option value="DAMAGE">Damage</option><option value="EXTRA_GUEST">Extra guest</option><option value="CHILD">Child fee</option></select></label><div className="grid grid-cols-2 gap-2"><label className="grid gap-1 text-xs font-medium">Unit amount (THB)<Input aria-label="Extra amount in baht" inputMode="decimal" placeholder="0.00" value={extraAmount} onChange={(event) => setExtraAmount(event.target.value)} disabled={mutationInFlight} /></label><label className="grid gap-1 text-xs font-medium">Quantity<Input aria-label="Extra quantity" inputMode="numeric" value={extraQuantity} onChange={(event) => setExtraQuantity(event.target.value)} disabled={mutationInFlight} /></label></div>{extraError && <p className="flex items-center gap-1 text-xs text-destructive"><WarningCircle />{extraError}</p>}<Button type="button" size="sm" variant="outline" onClick={() => void postExtra()} disabled={mutationInFlight}><Plus />Post to folio</Button></div>}
        </section>
      </div>
    </section>
  )
}
