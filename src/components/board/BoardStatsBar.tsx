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
    <div className="grid grid-cols-6 gap-2">
      <Card className="p-2.5 border-l-[3px] border-l-primary/50 bg-gradient-to-br from-primary/5 to-transparent hover:shadow-sm transition-shadow">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-primary/10 flex-shrink-0">
            <Users weight="bold" className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-xl font-bold leading-none">{stats.occupied}</div>
            <div className="text-[9px] font-medium text-muted-foreground mt-0.5 uppercase tracking-wide">Occupied</div>
          </div>
        </div>
      </Card>

      <Card className="p-2.5 border-l-[3px] border-l-green-500/50 bg-gradient-to-br from-green-50 to-transparent hover:shadow-sm transition-shadow">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-green-500/10 flex-shrink-0">
            <DoorOpen weight="bold" className="w-4 h-4 text-green-600" />
          </div>
          <div className="min-w-0">
            <div className="text-xl font-bold leading-none">{stats.vacant}</div>
            <div className="text-[9px] font-medium text-muted-foreground mt-0.5 uppercase tracking-wide">Vacant</div>
          </div>
        </div>
      </Card>

      <Card className="p-2.5 border-l-[3px] border-l-emerald-500/50 bg-gradient-to-br from-emerald-50 to-transparent hover:shadow-sm transition-shadow">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-emerald-500/10 flex-shrink-0">
            <TrendUp weight="bold" className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <div className="text-xl font-bold leading-none">{stats.arrivalsToday}</div>
            <div className="text-[9px] font-medium text-muted-foreground mt-0.5 uppercase tracking-wide">Arrivals</div>
          </div>
        </div>
      </Card>

      <Card className="p-2.5 border-l-[3px] border-l-red-500/50 bg-gradient-to-br from-red-50 to-transparent hover:shadow-sm transition-shadow">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-red-500/10 flex-shrink-0">
            <TrendDown weight="bold" className="w-4 h-4 text-red-600" />
          </div>
          <div className="min-w-0">
            <div className="text-xl font-bold leading-none">{stats.departuresToday}</div>
            <div className="text-[9px] font-medium text-muted-foreground mt-0.5 uppercase tracking-wide">Departures</div>
          </div>
        </div>
      </Card>

      <Card className="p-2.5 border-l-[3px] border-l-orange-500/50 bg-gradient-to-br from-orange-50 to-transparent hover:shadow-sm transition-shadow">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-orange-500/10 flex-shrink-0">
            <Broom weight="bold" className="w-4 h-4 text-orange-600" />
          </div>
          <div className="min-w-0">
            <div className="text-xl font-bold leading-none">{stats.dirty}</div>
            <div className="text-[9px] font-medium text-muted-foreground mt-0.5 uppercase tracking-wide">Dirty</div>
          </div>
        </div>
      </Card>

      <Card className={cn(
        "p-2.5 border-l-[3px] bg-gradient-to-br to-transparent hover:shadow-sm transition-shadow",
        stats.occupancyRate >= 80 ? "border-l-green-500/50 from-green-50" :
        stats.occupancyRate >= 60 ? "border-l-blue-500/50 from-blue-50" :
        "border-l-orange-500/50 from-orange-50"
      )}>
        <div className="flex items-center gap-2">
          <div className={cn(
            "p-1.5 rounded-md flex-shrink-0",
            stats.occupancyRate >= 80 ? "bg-green-500/10" :
            stats.occupancyRate >= 60 ? "bg-blue-500/10" :
            "bg-orange-500/10"
          )}>
            <ChartBar weight="bold" className={cn("w-4 h-4", occupancyColor)} />
          </div>
          <div className="min-w-0">
            <div className={cn("text-xl font-bold leading-none", occupancyColor)}>
              {stats.occupancyRate.toFixed(0)}%
            </div>
            <div className="text-[9px] font-medium text-muted-foreground mt-0.5 uppercase tracking-wide">Occupancy</div>
          </div>
        </div>
      </Card>
    </div>
  )
}
