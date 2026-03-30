import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function StatusLegend() {
  const legendItems = [
    {
      label: 'Occupied Clean',
      color: 'bg-primary/20 border-primary/40',
      description: 'Guest checked in, room clean'
    },
    {
      label: 'Occupied Dirty',
      color: 'bg-destructive/20 border-destructive/40',
      description: 'Guest checked in, room needs cleaning'
    },
    {
      label: 'Vacant Clean',
      color: 'bg-green-500/10 border-green-500/30',
      description: 'Ready to sell'
    },
    {
      label: 'Vacant Dirty',
      color: 'bg-orange-500/10 border-orange-500/30',
      description: 'Available but needs cleaning'
    },
  ]

  const indicatorItems = [
    {
      label: 'Clean',
      color: 'bg-green-500',
      type: 'dot'
    },
    {
      label: 'Dirty',
      color: 'bg-orange-500',
      type: 'dot'
    },
    {
      label: 'Inspected',
      color: 'bg-blue-500',
      type: 'dot'
    },
    {
      label: 'Deposit Pending',
      color: 'bg-orange-500',
      type: 'dot'
    },
    {
      label: 'Out of Service',
      color: 'bg-destructive',
      type: 'dot'
    },
    {
      label: 'Blocked',
      color: 'bg-orange-500',
      type: 'dot'
    },
  ]

  return (
    <Card className="p-4">
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold mb-3">Reservation Status</h3>
          <div className="grid grid-cols-2 gap-3">
            {legendItems.map((item) => (
              <div key={item.label} className="flex items-start gap-2">
                <div 
                  className={cn(
                    "w-8 h-6 rounded border flex-shrink-0 mt-0.5",
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

        <div className="pt-3 border-t border-border">
          <h3 className="text-sm font-semibold mb-3">Status Indicators</h3>
          <div className="grid grid-cols-2 gap-2">
            {indicatorItems.map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <div className={cn("w-2 h-2 rounded-full flex-shrink-0", item.color)} />
                <div className="text-xs">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}
