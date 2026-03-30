import type { BoardStats } from '@/types/board'
import { Card } from '@/components/ui/card'
import { TrendUp, Users, DoorOpen, Broom, Wrench } from '@phosphor-icons/react'

interface BoardStatsBarProps {
  stats: BoardStats
}

export function BoardStatsBar({ stats }: BoardStatsBarProps) {
  return (
    <div className="grid grid-cols-6 gap-2">
      <Card className="p-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-blue-500/10 flex-shrink-0">
            <Users weight="bold" className="w-4 h-4 text-blue-600" />
          </div>
          <div className="min-w-0">
            <div className="text-xl font-bold leading-none">{stats.occupied}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Occupied</div>
          </div>
        </div>
      </Card>

      <Card className="p-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-emerald-500/10 flex-shrink-0">
            <DoorOpen weight="bold" className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <div className="text-xl font-bold leading-none">{stats.vacant}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Vacant</div>
          </div>
        </div>
      </Card>

      <Card className="p-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-green-500/10 flex-shrink-0">
            <TrendUp weight="bold" className="w-4 h-4 text-green-600" />
          </div>
          <div className="min-w-0">
            <div className="text-xl font-bold leading-none">{stats.arrivalsToday}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Arrivals</div>
          </div>
        </div>
      </Card>

      <Card className="p-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-red-500/10 flex-shrink-0">
            <TrendUp weight="bold" className="w-4 h-4 text-red-600 rotate-180" />
          </div>
          <div className="min-w-0">
            <div className="text-xl font-bold leading-none">{stats.departuresToday}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Departures</div>
          </div>
        </div>
      </Card>

      <Card className="p-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-amber-500/10 flex-shrink-0">
            <Broom weight="bold" className="w-4 h-4 text-amber-600" />
          </div>
          <div className="min-w-0">
            <div className="text-xl font-bold leading-none">{stats.dirty}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Dirty</div>
          </div>
        </div>
      </Card>

      <Card className="p-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-purple-500/10 flex-shrink-0">
            <TrendUp weight="bold" className="w-4 h-4 text-purple-600" />
          </div>
          <div className="min-w-0">
            <div className="text-xl font-bold leading-none">{stats.occupancyRate.toFixed(0)}%</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Occupancy</div>
          </div>
        </div>
      </Card>
    </div>
  )
}
