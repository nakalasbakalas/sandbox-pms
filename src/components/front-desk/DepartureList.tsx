import type { DepartureItem } from '@/types/front-desk'
import type { UserRole } from '@/types/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MoneyDisplay } from '@/components/ui/money-display'
import { CheckCircle, CreditCard, SignOut, Warning } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { buildCheckOutGuards, getDeparturePrimaryAction } from '@/lib/front-desk-workflow'

interface DepartureListProps {
  departures: DepartureItem[]
  hotelDateKey: string
  role?: UserRole | null
  onCheckOut: (departure: DepartureItem, mode: 'express' | 'guided') => void
}

function ActionIcon({ intent }: { intent: ReturnType<typeof getDeparturePrimaryAction>['intent'] }) {
  if (intent === 'settle-balance') return <CreditCard size={15} weight="bold" />
  if (intent === 'review-charges') return <Warning size={15} weight="bold" />
  return <CheckCircle size={15} weight="bold" />
}

export function DepartureList({ departures, hotelDateKey, role, onCheckOut }: DepartureListProps) {
  if (departures.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-6 text-center text-sm text-muted-foreground">
        <SignOut className="mx-auto mb-2" size={30} weight="duotone" />
        No departures today
      </div>
    )
  }

  return (
    <div className="divide-y rounded-lg border bg-white">
      {departures.map((departure) => {
        const summary = buildCheckOutGuards(departure, { hotelDateKey, role })
        const action = getDeparturePrimaryAction(summary, departure)
        const mode = action.intent === 'express-check-out' ? 'express' : 'guided'

        return (
          <div key={departure.id} className="grid gap-3 p-3 md:grid-cols-[1.25fr_1fr_auto] md:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="truncate font-semibold">{departure.guestName}</div>
                <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
                  Room {departure.roomNumber}
                </Badge>
                {summary.isExpressReady && (
                  <Badge className="h-5 border-emerald-200 bg-emerald-50 px-1.5 text-[11px] text-emerald-700">
                    Ready
                  </Badge>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{departure.roomType}</span>
                <span>Checkout {departure.checkOutTime}</span>
                <span>{departure.nights} night{departure.nights === 1 ? '' : 's'}</span>
                <span>{departure.folioStatus || 'OPEN'} folio</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <StatusChip label="Balance" value={departure.balanceDue > 0 ? `THB ${departure.balanceDue.toLocaleString('en-US')}` : 'THB 0'} ok={departure.balanceDue <= 0} />
              <StatusChip label="Payment" value={departure.paymentStatus} ok={departure.balanceDue <= 0} />
              <StatusChip label="Room" value={departure.roomStatus} ok />
            </div>

            <div className="flex items-center justify-between gap-3 md:justify-end">
              <div className="text-right">
                <div className="text-[11px] text-muted-foreground">Folio</div>
                <MoneyDisplay amount={departure.folioTotal} className="font-semibold" />
              </div>
              <Button
                size="sm"
                disabled={action.disabled}
                onClick={() => onCheckOut(departure, mode)}
                className={cn(
                  'min-w-[136px] gap-1.5',
                  action.intent === 'express-check-out' && 'bg-emerald-600 hover:bg-emerald-700',
                  action.intent === 'settle-balance' && 'bg-rose-600 hover:bg-rose-700',
                  action.intent === 'review-charges' && 'bg-amber-600 hover:bg-amber-700',
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
      ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800',
    )}>
      <div className="text-[10px] uppercase text-current/60">{label}</div>
      <div className="truncate font-semibold">{value}</div>
    </div>
  )
}
