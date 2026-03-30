import type { DepartureItem } from '@/types/front-desk'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SignOut, CheckCircle, Warning, Clock } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

interface DepartureListProps {
  departures: DepartureItem[]
  onCheckOut: (departure: DepartureItem) => void
  onViewDetails: (departure: DepartureItem) => void
}

export function DepartureList({ departures, onCheckOut, onViewDetails }: DepartureListProps) {
  const getStatusBadge = (departure: DepartureItem) => {
    switch (departure.status) {
      case 'CHECKED_OUT':
        return <Badge className="bg-green-100 text-green-800 border-green-200">Checked Out</Badge>
      case 'IN_HOUSE':
        return <Badge className="bg-blue-100 text-blue-800 border-blue-200">In House</Badge>
      case 'LATE_CHECKOUT':
        return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Late Checkout</Badge>
    }
  }

  const getPaymentBadge = (departure: DepartureItem) => {
    switch (departure.paymentStatus) {
      case 'PAID':
        return <Badge className="bg-green-100 text-green-800 border-green-200">Paid</Badge>
      case 'PARTIAL':
        return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Partial</Badge>
      case 'UNPAID':
        return <Badge className="bg-rose-100 text-rose-800 border-rose-200">Unpaid</Badge>
    }
  }

  if (departures.length === 0) {
    return (
      <Card className="p-8 text-center">
        <SignOut className="mx-auto mb-3 text-muted-foreground" size={48} weight="thin" />
        <p className="text-sm text-muted-foreground">No departures today</p>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      {departures.map((departure) => {
        const canCheckOut = departure.status !== 'CHECKED_OUT' && departure.balanceDue === 0
        const hasUnpaidBalance = departure.balanceDue > 0
        
        return (
          <Card
            key={departure.id}
            className={cn(
              'p-4 transition-all hover:shadow-md cursor-pointer',
              departure.status === 'CHECKED_OUT' && 'opacity-60 bg-slate-50',
              hasUnpaidBalance && 'border-rose-300 bg-rose-50/30',
              departure.status === 'LATE_CHECKOUT' && 'border-amber-300 bg-amber-50/30',
            )}
            onClick={() => onViewDetails(departure)}
          >
            <div className="flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-base">{departure.guestName}</h3>
                      {getStatusBadge(departure)}
                      {getPaymentBadge(departure)}
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Room {departure.roomNumber}</span>
                      <span>{departure.roomType}</span>
                      <span>•</span>
                      <span>{departure.nights} nights</span>
                    </div>
                  </div>
                  
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm text-muted-foreground mb-1">Check-out</div>
                    <div className="font-medium">{departure.checkOutTime}</div>
                    {departure.lateCheckoutUntil && (
                      <div className="text-xs text-amber-600 mt-1 flex items-center gap-1 justify-end">
                        <Clock size={12} />
                        Until: {departure.lateCheckoutUntil}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Folio:</span>
                    <span className="font-semibold">฿{departure.folioTotal.toLocaleString()}</span>
                  </div>
                  {hasUnpaidBalance && (
                    <div className="flex items-center gap-2 text-rose-600">
                      <Warning size={16} weight="bold" />
                      <span className="font-semibold">฿{departure.balanceDue.toLocaleString()} due</span>
                    </div>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-muted-foreground">Room:</span>
                    <Badge variant={departure.roomStatus === 'CLEAN' ? 'secondary' : 'outline'}>
                      {departure.roomStatus}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 flex-shrink-0">
                {departure.status !== 'CHECKED_OUT' && (
                  <Button
                    size="sm"
                    disabled={!canCheckOut}
                    onClick={(e) => {
                      e.stopPropagation()
                      onCheckOut(departure)
                    }}
                    className={cn(
                      'gap-1.5',
                      canCheckOut && 'bg-amber-600 hover:bg-amber-700'
                    )}
                  >
                    {canCheckOut && <CheckCircle weight="bold" size={16} />}
                    Check Out
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
