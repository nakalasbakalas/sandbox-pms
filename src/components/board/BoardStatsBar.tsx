import type { BoardStats } from '@/types/board'
import { Card } from '@/components/ui/card'
import { TrendUp, TrendDown, Users, DoorOpen, Broom, ChartBar } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

interface BoardStatsBarProps {
  stats: BoardStats
}

export function BoardStatsBar({ stats }: BoardStatsBarProps) {
  const occupancyColor = 
    stats.occupancyRate >= 80 ? 'text-green-600' :
    stats.occupancyRate >= 60 ? 'text-blue-600' :
    stats.occupancyRate >= 40 ? 'text-orange-600' :
    'text-muted-foreground'

  return (
    <div className="grid grid-cols-6 gap-3">
      <Card className="p-3.5 border-l-4 border-l-primary/50 bg-gradient-to-br from-primary/5 to-transparent hover:shadow-md transition-shadow">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10 flex-shrink-0">
            <Users weight="bold" className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-bold leading-none">{stats.occupied}</div>
            <div className="text-[11px] font-medium text-muted-foreground mt-1 uppercase tracking-wide">Occupied</div>
          </div>
        </div>
      </Card>

      <Card className="p-3.5 border-l-4 border-l-green-500/50 bg-gradient-to-br from-green-50 to-transparent hover:shadow-md transition-shadow">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-green-500/10 flex-shrink-0">
            <DoorOpen weight="bold" className="w-5 h-5 text-green-600" />
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-bold leading-none">{stats.vacant}</div>
            <div className="text-[11px] font-medium text-muted-foreground mt-1 uppercase tracking-wide">Vacant</div>
          </div>
        </div>
      </Card>

      <Card className="p-3.5 border-l-4 border-l-emerald-500/50 bg-gradient-to-br from-emerald-50 to-transparent hover:shadow-md transition-shadow">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 flex-shrink-0">
            <TrendUp weight="bold" className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-bold leading-none">{stats.arrivalsToday}</div>
            <div className="text-[11px] font-medium text-muted-foreground mt-1 uppercase tracking-wide">Arrivals</div>
          </div>
        </div>
      </Card>

      <Card className="p-3.5 border-l-4 border-l-red-500/50 bg-gradient-to-br from-red-50 to-transparent hover:shadow-md transition-shadow">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-500/10 flex-shrink-0">
            <TrendDown weight="bold" className="w-5 h-5 text-red-600" />
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-bold leading-none">{stats.departuresToday}</div>
            <div className="text-[11px] font-medium text-muted-foreground mt-1 uppercase tracking-wide">Departures</div>
          </div>
        </div>
      </Card>

      <Card className="p-3.5 border-l-4 border-l-orange-500/50 bg-gradient-to-br from-orange-50 to-transparent hover:shadow-md transition-shadow">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-orange-500/10 flex-shrink-0">
            <Broom weight="bold" className="w-5 h-5 text-orange-600" />
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-bold leading-none">{stats.dirty}</div>
            <div className="text-[11px] font-medium text-muted-foreground mt-1 uppercase tracking-wide">Dirty</div>
          </div>
        </div>
      </Card>

      <Card className={cn(
        "p-3.5 border-l-4 bg-gradient-to-br to-transparent hover:shadow-md transition-shadow",
        stats.occupancyRate >= 80 ? "border-l-green-500/50 from-green-50" :
        stats.occupancyRate >= 60 ? "border-l-blue-500/50 from-blue-50" :
        "border-l-orange-500/50 from-orange-50"
      )}>
        <div className="flex items-center gap-3">
          <div className={cn(
            "p-2 rounded-lg flex-shrink-0",
            stats.occupancyRate >= 80 ? "bg-green-500/10" :
            stats.occupancyRate >= 60 ? "bg-blue-500/10" :
            "bg-orange-500/10"
          )}>
            <ChartBar weight="bold" className={cn("w-5 h-5", occupancyColor)} />
          </div>
          <div className="min-w-0">
            <div className={cn("text-2xl font-bold leading-none", occupancyColor)}>
              {stats.occupancyRate.toFixed(0)}%
            </div>
            <div className="text-[11px] font-medium text-muted-foreground mt-1 uppercase tracking-wide">Occupancy</div>
          </div>
        </div>
      </Card>
    </div>
  )
}
