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
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className="flex min-w-0 items-center gap-1.5 rounded-md bg-card border border-border/60 px-2 py-1 transition-colors hover:border-border/80"
        >
          <div className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', kpi.bg)}>
            <kpi.icon weight="duotone" className={cn('w-3 h-3', kpi.color)} />
          </div>
          <div className="min-w-0">
            <div className={cn('text-sm font-semibold leading-none tracking-tight', kpi.color)}>{kpi.value}</div>
            <div className="truncate text-[8px] text-muted-foreground mt-0.5 font-medium uppercase tracking-wide">{kpi.label}</div>
          </div>
        </div>
      ))}

      <div className="flex min-w-0 items-center gap-1.5 rounded-md bg-card border border-border/60 px-2 py-1 transition-colors hover:border-border/80">
        <div className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
          stats.occupancyRate >= 80 ? 'bg-emerald-50' :
          stats.occupancyRate >= 60 ? 'bg-blue-50' :
          'bg-amber-50'
        )}>
          <ChartBar weight="duotone" className={cn('w-3 h-3', occupancyColor)} />
        </div>
        <div className="min-w-0">
          <div className={cn('text-sm font-semibold leading-none tracking-tight', occupancyColor)}>
            {stats.occupancyRate.toFixed(0)}%
          </div>
          <div className="truncate text-[8px] text-muted-foreground mt-0.5 font-medium uppercase tracking-wide">Occupancy</div>
        </div>
      </div>
    </div>
  )
}
