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
    { label: 'Occupied', value: stats.occupied, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Available', value: stats.vacant, icon: DoorOpen, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Arrivals', value: stats.arrivalsToday, icon: TrendUp, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'Departures', value: stats.departuresToday, icon: TrendDown, color: 'text-rose-600', bg: 'bg-rose-50' },
    { label: 'Dirty', value: stats.dirty, icon: Broom, color: 'text-orange-600', bg: 'bg-orange-50' },
  ]

  return (
    <div className="flex items-stretch gap-3">
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className="flex-1 flex items-center gap-2.5 rounded-lg bg-card border border-border/50 px-3 py-2 transition-colors hover:border-border"
        >
          <div className={cn('flex items-center justify-center w-8 h-8 rounded-lg', kpi.bg)}>
            <kpi.icon weight="duotone" className={cn('w-4 h-4', kpi.color)} />
          </div>
          <div className="min-w-0">
            <div className={cn('text-xl font-semibold leading-none tracking-tight', kpi.color)}>{kpi.value}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5 font-medium">{kpi.label}</div>
          </div>
        </div>
      ))}

      <div className="flex-1 flex items-center gap-2.5 rounded-lg bg-card border border-border/50 px-3 py-2 transition-colors hover:border-border">
        <div className={cn(
          'flex items-center justify-center w-8 h-8 rounded-lg',
          stats.occupancyRate >= 80 ? 'bg-emerald-50' :
          stats.occupancyRate >= 60 ? 'bg-blue-50' :
          'bg-amber-50'
        )}>
          <ChartBar weight="duotone" className={cn('w-4 h-4', occupancyColor)} />
        </div>
        <div className="min-w-0">
          <div className={cn('text-xl font-semibold leading-none tracking-tight', occupancyColor)}>
            {stats.occupancyRate.toFixed(0)}%
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5 font-medium">Occupancy</div>
        </div>
      </div>
    </div>
  )
}
