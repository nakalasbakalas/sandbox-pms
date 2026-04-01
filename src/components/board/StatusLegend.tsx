import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

export function StatusLegend() {
  const legendItems = [
    {
      label: 'Occupied Clean',
      color: 'bg-blue-500/90',
      description: 'Guest in, clean',
    },
    {
      label: 'Occupied Dirty',
      color: 'bg-blue-500/70 border-2 border-red-400',
      description: 'Guest in, needs cleaning',
    },
    {
      label: 'Vacant Clean',
      color: 'bg-emerald-500/90',
      description: 'Ready to sell',
    },
    {
      label: 'Vacant Dirty',
      color: 'bg-amber-500/90',
      description: 'Needs cleaning',
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
      className: 'bg-gray-100 text-gray-700 border-gray-300'
    },
    {
      label: 'IN',
      variant: 'default' as const,
      className: 'bg-green-600'
    },
    {
      label: 'OUT',
      variant: 'default' as const,
      className: 'bg-red-600'
    },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-semibold mb-2 uppercase tracking-wide text-muted-foreground">Room Status</h3>
        <div className="space-y-2">
          {legendItems.map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <div 
                className={cn(
                  "w-10 h-7 rounded flex-shrink-0",
                  item.color
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium">{item.label}</div>
                <div className="text-[10px] text-muted-foreground">{item.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="text-xs font-semibold mb-2 uppercase tracking-wide text-muted-foreground">Badges</h3>
        <div className="flex flex-wrap gap-1.5">
          {badges.map((item) => (
            <Badge 
              key={item.label} 
              variant={item.variant}
              className={cn("text-[10px] font-semibold h-5 px-1.5", item.className)}
            >
              {item.label}
            </Badge>
          ))}
        </div>
        <div className="mt-2 space-y-0.5 text-[10px] text-muted-foreground">
          <div><span className="font-medium">VIP</span> — VIP guest</div>
          <div><span className="font-medium">OOS</span> — Out of service</div>
          <div><span className="font-medium">BLK</span> — Blocked</div>
          <div><span className="font-medium">IN</span> — Arriving today</div>
          <div><span className="font-medium">OUT</span> — Departing today</div>
        </div>
      </div>
    </div>
  )
}
