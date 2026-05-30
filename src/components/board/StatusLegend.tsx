import { cn } from '@/lib/utils'

export function StatusLegend() {
  const legendItems = [
    { label: 'Occupied', color: 'bg-blue-200 border-l-[3px] border-l-blue-500', description: 'In-house guest' },
    { label: 'Vacant Clean', color: 'bg-emerald-100 border-l-[3px] border-l-emerald-500', description: 'Ready to sell' },
    { label: 'Vacant Dirty', color: 'bg-orange-100 border-l-[3px] border-l-orange-500', description: 'Needs cleaning' },
    { label: 'Out of Service', color: 'bg-gray-200 border-l-[3px] border-l-gray-400', description: 'Maintenance' },
  ]

  const indicators = [
    { label: 'VIP', className: 'text-amber-700 bg-amber-50' },
    { label: 'OOS', className: 'text-rose-600 bg-rose-50' },
    { label: 'BLK', className: 'text-gray-600 bg-gray-100' },
    { label: 'IN', className: 'text-amber-700 bg-amber-100' },
    { label: 'OUT', className: 'text-rose-700 bg-rose-100' },
  ]

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-[11px] font-medium mb-2 text-foreground">Room Status</h3>
        <div className="space-y-1.5">
          {legendItems.map((item) => (
            <div key={item.label} className="flex items-center gap-2.5">
              <div className={cn("w-8 h-5 rounded", item.color)} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-foreground">{item.label}</div>
                <div className="text-[10px] text-muted-foreground">{item.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border/40 pt-3">
        <h3 className="text-[11px] font-medium mb-2 text-foreground">Badges</h3>
        <div className="flex flex-wrap gap-1.5">
          {indicators.map((item) => (
            <span
              key={item.label}
              className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded", item.className)}
            >
              {item.label}
            </span>
          ))}
        </div>
      </div>

      <div className="border-t border-border/40 pt-3">
        <h3 className="text-[11px] font-medium mb-1.5 text-foreground">Color System</h3>
        <div className="space-y-0.5 text-[10px] text-muted-foreground">
          <div><span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1.5" />Blue — In-house / Occupied</div>
          <div><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5" />Green — Clean / Ready</div>
          <div><span className="inline-block w-2 h-2 rounded-full bg-orange-500 mr-1.5" />Orange — Dirty / Arrival</div>
          <div><span className="inline-block w-2 h-2 rounded-full bg-rose-500 mr-1.5" />Red — Blocked / Urgent</div>
          <div><span className="inline-block w-2 h-2 rounded-full bg-gray-400 mr-1.5" />Gray — Inactive / Neutral</div>
        </div>
      </div>
    </div>
  )
}
