import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

export function StatusLegend() {
  const legendItems = [
    {
      label: 'Occupied Clean',
      color: 'bg-gradient-to-br from-primary/25 to-primary/15 border-primary/40 border-l-4 border-l-primary',
      description: 'Guest checked in, room is clean',
      icon: '🟦'
    },
    {
      label: 'Occupied Dirty',
      color: 'bg-gradient-to-br from-destructive/25 to-destructive/15 border-destructive/40 border-l-4 border-l-destructive',
      description: 'Guest checked in, needs cleaning',
      icon: '🟥'
    },
    {
      label: 'Vacant Clean',
      color: 'bg-gradient-to-br from-green-500/15 to-green-500/8 border-green-500/40 border-l-4 border-l-green-500',
      description: 'Ready to sell',
      icon: '🟩'
    },
    {
      label: 'Vacant Dirty',
      color: 'bg-gradient-to-br from-orange-500/15 to-orange-500/8 border-orange-500/40 border-l-4 border-l-orange-500',
      description: 'Available but needs cleaning',
      icon: '🟧'
    },
  ]

  const statusIndicators = [
    {
      label: 'Clean',
      color: 'bg-green-500 ring-2 ring-green-500/30',
      type: 'dot'
    },
    {
      label: 'Dirty',
      color: 'bg-orange-500 ring-2 ring-orange-500/30',
      type: 'dot'
    },
    {
      label: 'Inspected',
      color: 'bg-blue-500 ring-2 ring-blue-500/30',
      type: 'dot'
    },
  ]

  const badges = [
    {
      label: 'VIP',
      variant: 'outline' as const,
      className: 'bg-amber-50 text-amber-700 border-amber-300'
    },
    {
      label: 'OOS',
      variant: 'destructive' as const,
      className: ''
    },
    {
      label: 'BLK',
      variant: 'outline' as const,
      className: 'bg-orange-50 text-orange-700 border-orange-300'
    },
    {
      label: 'IN',
      variant: 'default' as const,
      className: 'bg-green-600'
    },
    {
      label: 'OUT',
      variant: 'default' as const,
      className: 'bg-destructive'
    },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-bold mb-3 uppercase tracking-wide">Reservation Status</h3>
        <div className="space-y-2.5">
          {legendItems.map((item) => (
            <div key={item.label} className="flex items-start gap-3">
              <div 
                className={cn(
                  "w-12 h-9 rounded-md border-2 flex-shrink-0",
                  item.color
                )}
              />
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="text-sm font-semibold">{item.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{item.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="text-sm font-bold mb-3 uppercase tracking-wide">Clean Status</h3>
        <div className="space-y-2">
          {statusIndicators.map((item) => (
            <div key={item.label} className="flex items-center gap-3">
              <div className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0", item.color)} />
              <div className="text-sm font-medium">{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="text-sm font-bold mb-3 uppercase tracking-wide">Status Badges</h3>
        <div className="flex flex-wrap gap-2">
          {badges.map((item) => (
            <Badge 
              key={item.label} 
              variant={item.variant}
              className={cn("text-xs font-semibold", item.className)}
            >
              {item.label}
            </Badge>
          ))}
        </div>
        <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
          <div><span className="font-semibold">VIP</span> — VIP guest</div>
          <div><span className="font-semibold">OOS</span> — Out of service</div>
          <div><span className="font-semibold">BLK</span> — Blocked room</div>
          <div><span className="font-semibold">IN</span> — Arriving today</div>
          <div><span className="font-semibold">OUT</span> — Departing today</div>
        </div>
      </div>
    </div>
  )
}
