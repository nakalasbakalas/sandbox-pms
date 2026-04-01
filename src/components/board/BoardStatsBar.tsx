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
    <div className="grid grid-cols-6 gap-2">
      <Card className="p-2 border-l-4 border-l-primary shadow-sm hover:shadow-md transition-all hover:scale-[1.02]">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-lg bg-primary/10 flex-shrink-0">
            <Users weight="bold" className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-extrabold leading-none">{stats.occupied}</div>
            <div className="text-[8px] font-bold text-muted-foreground mt-1 uppercase tracking-wider">Occupied</div>
          </div>
        </div>
      </Card>

      <Card className="p-2 border-l-4 border-l-green-600 shadow-sm hover:shadow-md transition-all hover:scale-[1.02]">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-lg bg-green-600/10 flex-shrink-0">
            <DoorOpen weight="bold" className="w-3.5 h-3.5 text-green-700" />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-extrabold leading-none">{stats.vacant}</div>
            <div className="text-[8px] font-bold text-muted-foreground mt-1 uppercase tracking-wider">Vacant</div>
          </div>
        </div>
      </Card>

      <Card className="p-2 border-l-4 border-l-emerald-600 shadow-sm hover:shadow-md transition-all hover:scale-[1.02]">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-lg bg-emerald-600/10 flex-shrink-0">
            <TrendUp weight="bold" className="w-3.5 h-3.5 text-emerald-700" />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-extrabold leading-none">{stats.arrivalsToday}</div>
            <div className="text-[8px] font-bold text-muted-foreground mt-1 uppercase tracking-wider">Arrivals</div>
          </div>
        </div>
      </Card>

      <Card className="p-2 border-l-4 border-l-red-600 shadow-sm hover:shadow-md transition-all hover:scale-[1.02]">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-lg bg-red-600/10 flex-shrink-0">
            <TrendDown weight="bold" className="w-3.5 h-3.5 text-red-700" />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-extrabold leading-none">{stats.departuresToday}</div>
            <div className="text-[8px] font-bold text-muted-foreground mt-1 uppercase tracking-wider">Departures</div>
          </div>
        </div>
      </Card>

      <Card className="p-2 border-l-4 border-l-orange-600 shadow-sm hover:shadow-md transition-all hover:scale-[1.02]">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-lg bg-orange-600/10 flex-shrink-0">
            <Broom weight="bold" className="w-3.5 h-3.5 text-orange-700" />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-extrabold leading-none">{stats.dirty}</div>
            <div className="text-[8px] font-bold text-muted-foreground mt-1 uppercase tracking-wider">Dirty</div>
          </div>
        </div>
      </Card>

      <Card className={cn(
        "p-2 border-l-4 shadow-sm hover:shadow-md transition-all hover:scale-[1.02]",
        stats.occupancyRate >= 80 ? "border-l-green-600" :
        stats.occupancyRate >= 60 ? "border-l-blue-600" :
        "border-l-orange-600"
      )}>
        <div className="flex items-center gap-2">
          <div className={cn(
            "p-1 rounded-lg flex-shrink-0",
            stats.occupancyRate >= 80 ? "bg-green-600/10" :
            stats.occupancyRate >= 60 ? "bg-blue-600/10" :
            "bg-orange-600/10"
          )}>
            <ChartBar weight="bold" className={cn("w-3.5 h-3.5", occupancyColor)} />
          </div>
          <div className="min-w-0">
            <div className={cn("text-lg font-extrabold leading-none", occupancyColor)}>
              {stats.occupancyRate.toFixed(0)}%
            </div>
            <div className="text-[8px] font-bold text-muted-foreground mt-1 uppercase tracking-wider">Occupancy</div>
          </div>
        </div>
      </Card>
    </div>
  )
}
