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
      <Card className="p-3 border-l-4 border-l-primary/60 bg-gradient-to-br from-primary/8 to-transparent hover:shadow-md transition-all hover:scale-[1.02] shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-primary/15 flex-shrink-0 shadow-sm">
            <Users weight="bold" className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-extrabold leading-none tracking-tight">{stats.occupied}</div>
            <div className="text-[10px] font-bold text-muted-foreground mt-1 uppercase tracking-wider">Occupied</div>
          </div>
        </div>
      </Card>

      <Card className="p-3 border-l-4 border-l-green-500/60 bg-gradient-to-br from-green-50 to-transparent hover:shadow-md transition-all hover:scale-[1.02] shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-green-500/15 flex-shrink-0 shadow-sm">
            <DoorOpen weight="bold" className="w-4 h-4 text-green-600" />
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-extrabold leading-none tracking-tight">{stats.vacant}</div>
            <div className="text-[10px] font-bold text-muted-foreground mt-1 uppercase tracking-wider">Vacant</div>
          </div>
        </div>
      </Card>

      <Card className="p-3 border-l-4 border-l-emerald-500/60 bg-gradient-to-br from-emerald-50 to-transparent hover:shadow-md transition-all hover:scale-[1.02] shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-emerald-500/15 flex-shrink-0 shadow-sm">
            <TrendUp weight="bold" className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-extrabold leading-none tracking-tight">{stats.arrivalsToday}</div>
            <div className="text-[10px] font-bold text-muted-foreground mt-1 uppercase tracking-wider">Arrivals</div>
          </div>
        </div>
      </Card>

      <Card className="p-3 border-l-4 border-l-red-500/60 bg-gradient-to-br from-red-50 to-transparent hover:shadow-md transition-all hover:scale-[1.02] shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-red-500/15 flex-shrink-0 shadow-sm">
            <TrendDown weight="bold" className="w-4 h-4 text-red-600" />
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-extrabold leading-none tracking-tight">{stats.departuresToday}</div>
            <div className="text-[10px] font-bold text-muted-foreground mt-1 uppercase tracking-wider">Departures</div>
          </div>
        </div>
      </Card>

      <Card className="p-3 border-l-4 border-l-orange-500/60 bg-gradient-to-br from-orange-50 to-transparent hover:shadow-md transition-all hover:scale-[1.02] shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-orange-500/15 flex-shrink-0 shadow-sm">
            <Broom weight="bold" className="w-4 h-4 text-orange-600" />
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-extrabold leading-none tracking-tight">{stats.dirty}</div>
            <div className="text-[10px] font-bold text-muted-foreground mt-1 uppercase tracking-wider">Dirty</div>
          </div>
        </div>
      </Card>

      <Card className={cn(
        "p-3 border-l-4 bg-gradient-to-br to-transparent hover:shadow-md transition-all hover:scale-[1.02] shadow-sm",
        stats.occupancyRate >= 80 ? "border-l-green-500/60 from-green-50" :
        stats.occupancyRate >= 60 ? "border-l-blue-500/60 from-blue-50" :
        "border-l-orange-500/60 from-orange-50"
      )}>
        <div className="flex items-center gap-2.5">
          <div className={cn(
            "p-2 rounded-lg flex-shrink-0 shadow-sm",
            stats.occupancyRate >= 80 ? "bg-green-500/15" :
            stats.occupancyRate >= 60 ? "bg-blue-500/15" :
            "bg-orange-500/15"
          )}>
            <ChartBar weight="bold" className={cn("w-4 h-4", occupancyColor)} />
          </div>
          <div className="min-w-0">
            <div className={cn("text-2xl font-extrabold leading-none tracking-tight", occupancyColor)}>
              {stats.occupancyRate.toFixed(0)}%
            </div>
            <div className="text-[10px] font-bold text-muted-foreground mt-1 uppercase tracking-wider">Occupancy</div>
          </div>
        </div>
      </Card>
    </div>
  )
}
