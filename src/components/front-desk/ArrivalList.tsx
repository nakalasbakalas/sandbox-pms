import type { ArrivalItem } from '@/types/front-desk'
import type { BoardRoomCard } from '@/types/board'
import type { UserRole } from '@/types/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MoneyDisplay } from '@/components/ui/money-display'
import { Bed, CheckCircle, CreditCard, IdentificationCard, SignIn, Warning } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import {
  amountDueForArrival,
  buildCheckInGuards,
  findRoomForArrival,
  getArrivalPrimaryAction,
} from '@/lib/front-desk-workflow'

interface ArrivalListProps {
  arrivals: ArrivalItem[]
  rooms: BoardRoomCard[]
  hotelDateKey: string
  role?: UserRole | null
  onCheckIn: (arrival: ArrivalItem, mode: 'express' | 'guided') => void
}

function ActionIcon({ intent }: { intent: ReturnType<typeof getArrivalPrimaryAction>['intent'] }) {
  if (intent === 'collect-payment') return <CreditCard size={15} weight="bold" />
  if (intent === 'assign-room' || intent === 'room-not-ready') return <Bed size={15} weight="bold" />
  if (intent === 'fix-issues') return <Warning size={15} weight="bold" />
  return <CheckCircle size={15} weight="bold" />
}

export function ArrivalList({ arrivals, rooms, hotelDateKey, role, onCheckIn }: ArrivalListProps) {
  if (arrivals.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-6 text-center text-sm text-muted-foreground">
        <SignIn className="mx-auto mb-2" size={30} weight="duotone" />
        No arrivals today
      </div>
    )
  }

  return (
    <div className="divide-y rounded-lg border bg-white">
      {arrivals.map((arrival) => {
        const room = findRoomForArrival(arrival, rooms)
        const summary = buildCheckInGuards(arrival, room, { hotelDateKey, role })
        const action = getArrivalPrimaryAction(summary, arrival)
        const mode = action.intent === 'express-check-in' ? 'express' : 'guided'
        const due = amountDueForArrival(arrival)

        return (
          <div key={arrival.id} className="grid gap-3 p-3 md:grid-cols-[1.3fr_1fr_auto] md:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="truncate font-semibold">{arrival.guestName}</div>
                <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
                  {arrival.confirmationCode || arrival.reservationId.slice(0, 8)}
                </Badge>
                {summary.isExpressReady && (
                  <Badge className="h-5 border-emerald-200 bg-emerald-50 px-1.5 text-[11px] text-emerald-700">
                    Ready
                  </Badge>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{arrival.roomType}</span>
                <span>{arrival.roomNumber ? `Room ${arrival.roomNumber}` : 'Assign room'}</span>
                <span>{arrival.arrivalTime || arrival.estimatedArrival || arrival.checkInTime}</span>
                <span>{arrival.nights} night{arrival.nights === 1 ? '' : 's'}</span>
                <span>{arrival.adults + arrival.children} guest{arrival.adults + arrival.children === 1 ? '' : 's'}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-4">
              <StatusChip label="Room" value={arrival.roomReady ? 'Ready' : 'Not ready'} ok={arrival.roomReady} />
              <StatusChip label="ID" value={arrival.documentVerified ? 'Recorded' : 'Missing'} ok={arrival.documentVerified} />
              <StatusChip label="Due" value={due > 0 ? `THB ${due.toLocaleString('en-US')}` : 'Clear'} ok={due <= 0} />
              <StatusChip label="Paid" value={arrival.paymentStatus || (due > 0 ? 'UNPAID' : 'PAID')} ok={due <= 0} />
            </div>

            <div className="flex items-center justify-between gap-3 md:justify-end">
              <div className="text-right">
                <div className="text-[11px] text-muted-foreground">Total stay</div>
                <MoneyDisplay amount={arrival.totalAmount} className="font-semibold" />
              </div>
              <Button
                size="sm"
                disabled={action.disabled}
                onClick={() => onCheckIn(arrival, mode)}
                className={cn(
                  'min-w-[136px] gap-1.5',
                  action.intent === 'express-check-in' && 'bg-emerald-600 hover:bg-emerald-700',
                  action.intent === 'collect-payment' && 'bg-rose-600 hover:bg-rose-700',
                  action.intent === 'room-not-ready' && 'bg-amber-600 hover:bg-amber-700',
                )}
              >
                <ActionIcon intent={action.intent} />
                {action.label}
              </Button>
            </div>

            {summary.blockers.length > 0 && (
              <div className="md:col-span-3">
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {summary.blockers.slice(0, 3).map((item) => (
                    <span key={item.id} className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700">
                      <Warning size={12} weight="bold" />
                      {item.label}: {item.quickActionLabel}
                    </span>
                  ))}
                  {summary.warnings.slice(0, 2).map((item) => (
                    <span key={item.id} className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
                      <IdentificationCard size={12} weight="bold" />
                      {item.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function StatusChip({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className={cn(
      'rounded-md border px-2 py-1',
      ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900',
    )}>
      <div className="text-[10px] uppercase text-current/60">{label}</div>
      <div className="truncate font-semibold">{value}</div>
    </div>
  )
}
