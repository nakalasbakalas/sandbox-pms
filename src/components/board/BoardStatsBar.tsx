import type { BoardStats } from '@/types/board'
import { TrendUp, TrendDown, Users, DoorOpen, Broom, ChartBar } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

interface BoardStatsBarProps {
  stats: BoardStats
}

export function BoardStatsBar({ stats }: BoardStatsBarProps) {
  const occupancyColor = 
    stats.occupancyRate >= 80 ? 'text-emerald-600' :
    stats.occupancyRate >= 60 ? 'text-blue-600' :
    stats.occupancyRate >= 40 ? 'text-amber-600' :
    'text-muted-foreground'

  const kpis = [
    { label: 'Occupied', value: stats.occupied, icon: Users, color: 'text-blue-700', bg: 'bg-blue-100/70' },
    { label: 'Available', value: stats.vacant, icon: DoorOpen, color: 'text-emerald-700', bg: 'bg-emerald-100/70' },
    { label: 'Arrivals', value: stats.arrivalsToday, icon: TrendUp, color: 'text-amber-700', bg: 'bg-amber-100/70' },
    { label: 'Departures', value: stats.departuresToday, icon: TrendDown, color: 'text-rose-700', bg: 'bg-rose-100/70' },
    { label: 'Dirty', value: stats.dirty, icon: Broom, color: 'text-orange-700', bg: 'bg-orange-100/70' },
  ]

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className="flex items-center gap-2 rounded-lg bg-card border border-border/60 px-2.5 py-1.5 transition-colors hover:border-border/80"
        >
          <div className={cn('flex items-center justify-center w-7 h-7 rounded-md', kpi.bg)}>
            <kpi.icon weight="duotone" className={cn('w-3.5 h-3.5', kpi.color)} />
          </div>
          <div className="min-w-0">
            <div className={cn('text-base font-semibold leading-none tracking-tight', kpi.color)}>{kpi.value}</div>
            <div className="text-[9px] text-muted-foreground mt-0.5 font-medium uppercase tracking-wide">{kpi.label}</div>
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2 rounded-lg bg-card border border-border/60 px-2.5 py-1.5 transition-colors hover:border-border/80">
        <div className={cn(
          'flex items-center justify-center w-7 h-7 rounded-md',
          stats.occupancyRate >= 80 ? 'bg-emerald-50' :
          stats.occupancyRate >= 60 ? 'bg-blue-50' :
          'bg-amber-50'
        )}>
          <ChartBar weight="duotone" className={cn('w-3.5 h-3.5', occupancyColor)} />
        </div>
        <div className="min-w-0">
          <div className={cn('text-base font-semibold leading-none tracking-tight', occupancyColor)}>
            {stats.occupancyRate.toFixed(0)}%
          </div>
          <div className="text-[9px] text-muted-foreground mt-0.5 font-medium uppercase tracking-wide">Occupancy</div>
        </div>
      </div>
    </div>
  )
}
