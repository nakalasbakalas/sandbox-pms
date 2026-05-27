import type { ArrivalItem } from '@/types/front-desk'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MoneyDisplay } from '@/components/ui/money-display'
import { 
  SignIn, 
  CheckCircle, 
  Warning, 
  Phone, 
  Envelope, 
  Clock,
  Bed
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import type { Icon } from '@phosphor-icons/react'

interface ArrivalListProps {
  arrivals: ArrivalItem[]
  onCheckIn: (arrival: ArrivalItem) => void
  onViewDetails: (arrival: ArrivalItem) => void
}

export function ArrivalList({ arrivals, onCheckIn, onViewDetails }: ArrivalListProps) {
  const getStatusBadge = (arrival: ArrivalItem) => {
    switch (arrival.status) {
      case 'CHECKED_IN':
        return <Badge className="bg-green-100 text-green-800 border-green-200">Checked In</Badge>
      case 'READY':
        return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Ready</Badge>
      case 'DUE_IN':
        return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Due In</Badge>
      case 'NO_SHOW':
        return <Badge className="bg-rose-100 text-rose-800 border-rose-200">No Show</Badge>
    }
  }

  const getReadinessIndicators = (arrival: ArrivalItem) => {
    const indicators: Array<{ icon: Icon; label: string; color: string }> = []
    
    if (!arrival.roomReady) {
      indicators.push({ icon: Bed, label: 'Room not ready', color: 'text-rose-600' })
    }
    if (!arrival.depositPaid) {
      indicators.push({ icon: Warning, label: 'Deposit pending', color: 'text-amber-600' })
    }
    if (!arrival.documentVerified) {
      indicators.push({ icon: Warning, label: 'Documents pending', color: 'text-blue-600' })
    }
    
    return indicators
  }

  if (arrivals.length === 0) {
    return (
      <Card className="p-8 text-center">
        <SignIn className="mx-auto mb-3 text-muted-foreground" size={48} weight="thin" />
        <p className="text-sm text-muted-foreground">No arrivals today</p>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      {arrivals.map((arrival) => {
        const readinessIndicators = getReadinessIndicators(arrival)
        const canCheckIn = arrival.status !== 'CHECKED_IN' && arrival.status !== 'NO_SHOW' && readinessIndicators.length === 0
        
        return (
          <Card
            key={arrival.id}
            className={cn(
              'p-4 transition-all hover:shadow-md cursor-pointer',
              arrival.status === 'CHECKED_IN' && 'opacity-60 bg-slate-50',
              arrival.status === 'READY' && 'border-blue-300 bg-blue-50/30',
            )}
            onClick={() => onViewDetails(arrival)}
          >
            <div className="flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-base">{arrival.guestName}</h3>
                      {getStatusBadge(arrival)}
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      {arrival.roomNumber && (
                        <span className="font-medium text-foreground">Room {arrival.roomNumber}</span>
                      )}
                      <span>{arrival.roomType}</span>
                      <span>•</span>
                      <span>{arrival.nights} nights</span>
                      <span>•</span>
                      <span>{arrival.adults} adults{arrival.children > 0 && `, ${arrival.children} children`}</span>
                    </div>
                  </div>
                  
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm text-muted-foreground mb-1">Check-in</div>
                    <div className="font-medium">{arrival.checkInTime}</div>
                    {arrival.estimatedArrival && (
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1 justify-end">
                        <Clock size={12} />
                        ETA: {arrival.estimatedArrival}
                      </div>
                    )}
                  </div>
                </div>

                {arrival.specialRequests && (
                  <div className="text-sm text-muted-foreground mb-2 italic">
                    "{arrival.specialRequests}"
                  </div>
                )}

                <div className="flex items-center gap-4 text-sm">
                  {arrival.phone && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Phone size={14} weight="bold" />
                      <span className="font-mono text-xs">{arrival.phone}</span>
                    </div>
                  )}
                  {arrival.email && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Envelope size={14} weight="bold" />
                      <span className="text-xs">{arrival.email}</span>
                    </div>
                  )}
                  <div className="ml-auto text-xs text-muted-foreground">
                    {arrival.source}
                  </div>
                </div>

                {readinessIndicators.length > 0 && (
                  <div className="flex items-center gap-3 mt-3 pt-3 border-t">
                    {readinessIndicators.map((indicator, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 text-xs">
                        <indicator.icon className={indicator.color} size={16} weight="bold" />
                        <span className={indicator.color}>{indicator.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 flex-shrink-0">
                <div className="text-right mb-2">
                  <div className="text-xs text-muted-foreground">Total</div>
                  <div className="text-lg font-bold"><MoneyDisplay amount={arrival.totalAmount} /></div>
                </div>
                
                {arrival.status !== 'CHECKED_IN' && arrival.status !== 'NO_SHOW' && (
                  <Button
                    size="sm"
                    disabled={!canCheckIn}
                    onClick={(e) => {
                      e.stopPropagation()
                      onCheckIn(arrival)
                    }}
                    className={cn(
                      'gap-1.5',
                      canCheckIn && 'bg-blue-600 hover:bg-blue-700'
                    )}
                  >
                    {canCheckIn && <CheckCircle weight="bold" size={16} />}
                    Check In
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
