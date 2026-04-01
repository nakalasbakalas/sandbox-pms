import type { BoardStats } from '@/types/board'
import { Card } from '@/components/ui/card'
import { TrendUp, TrendDown, Users, DoorOpen, Broom, ChartBar } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

interface BoardStatsBarProps {
  stats: BoardStats
}

export function BoardStatsBar({ stats }: BoardStatsBarProps) {
  const occupancyColor = 
    stats.occupancyRate >= 80 ? 'text-green-700' :
    stats.occupancyRate >= 60 ? 'text-blue-700' :
    stats.occupancyRate >= 40 ? 'text-orange-700' :
    'text-muted-foreground'

  return (
    <div className="grid grid-cols-6 gap-1">
      <Card className="p-1 border-l-2 border-l-primary shadow-none hover:shadow-sm transition-shadow">
        <div className="flex items-center gap-1">
          <div className="p-0.5 rounded bg-primary/10 flex-shrink-0">
            <Users weight="bold" className="w-2.5 h-2.5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold leading-none">{stats.occupied}</div>
            <div className="text-[7px] font-medium text-muted-foreground mt-0.5 uppercase tracking-wide">Occupied</div>
          </div>
        </div>
      </Card>

      <Card className="p-1 border-l-2 border-l-green-600 shadow-none hover:shadow-sm transition-shadow">
        <div className="flex items-center gap-1">
          <div className="p-0.5 rounded bg-green-600/10 flex-shrink-0">
            <DoorOpen weight="bold" className="w-2.5 h-2.5 text-green-700" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold leading-none">{stats.vacant}</div>
            <div className="text-[7px] font-medium text-muted-foreground mt-0.5 uppercase tracking-wide">Vacant</div>
          </div>
        </div>
      </Card>

      <Card className="p-1 border-l-2 border-l-emerald-600 shadow-none hover:shadow-sm transition-shadow">
        <div className="flex items-center gap-1">
          <div className="p-0.5 rounded bg-emerald-600/10 flex-shrink-0">
            <TrendUp weight="bold" className="w-2.5 h-2.5 text-emerald-700" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold leading-none">{stats.arrivalsToday}</div>
            <div className="text-[7px] font-medium text-muted-foreground mt-0.5 uppercase tracking-wide">Arrivals</div>
          </div>
        </div>
      </Card>

      <Card className="p-1 border-l-2 border-l-red-600 shadow-none hover:shadow-sm transition-shadow">
        <div className="flex items-center gap-1">
          <div className="p-0.5 rounded bg-red-600/10 flex-shrink-0">
            <TrendDown weight="bold" className="w-2.5 h-2.5 text-red-700" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold leading-none">{stats.departuresToday}</div>
            <div className="text-[7px] font-medium text-muted-foreground mt-0.5 uppercase tracking-wide">Departures</div>
          </div>
        </div>
      </Card>

      <Card className="p-1 border-l-2 border-l-orange-600 shadow-none hover:shadow-sm transition-shadow">
        <div className="flex items-center gap-1">
          <div className="p-0.5 rounded bg-orange-600/10 flex-shrink-0">
            <Broom weight="bold" className="w-2.5 h-2.5 text-orange-700" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold leading-none">{stats.dirty}</div>
            <div className="text-[7px] font-medium text-muted-foreground mt-0.5 uppercase tracking-wide">Dirty</div>
          </div>
        </div>
      </Card>

      <Card className={cn(
        "p-1 border-l-2 shadow-none hover:shadow-sm transition-shadow",
        stats.occupancyRate >= 80 ? "border-l-green-600" :
        stats.occupancyRate >= 60 ? "border-l-blue-600" :
        "border-l-orange-600"
      )}>
        <div className="flex items-center gap-1">
          <div className={cn(
            "p-0.5 rounded flex-shrink-0",
            stats.occupancyRate >= 80 ? "bg-green-600/10" :
            stats.occupancyRate >= 60 ? "bg-blue-600/10" :
            "bg-orange-600/10"
          )}>
            <ChartBar weight="bold" className={cn("w-2.5 h-2.5", occupancyColor)} />
          </div>
          <div className="min-w-0">
            <div className={cn("text-sm font-bold leading-none", occupancyColor)}>
              {stats.occupancyRate.toFixed(0)}%
            </div>
            <div className="text-[7px] font-medium text-muted-foreground mt-0.5 uppercase tracking-wide">Occupancy</div>
          </div>
        </div>
      </Card>
    </div>
  )
}
