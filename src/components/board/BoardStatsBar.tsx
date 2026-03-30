import type { BoardStats } from '@/types/board'
import { Card } from '@/components/ui/card'
import { TrendUp, Users, DoorOpen, Broom, Wrench } from '@phosphor-icons/react'

interface BoardStatsBarProps {
  stats: BoardStats
}

export function BoardStatsBar({ stats }: BoardStatsBarProps) {
  return (
    <div className="grid grid-cols-6 gap-3">
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/10">
            <Users weight="bold" className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <div className="text-2xl font-bold">{stats.occupied}</div>
            <div className="text-xs text-muted-foreground">Occupied</div>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10">
            <DoorOpen weight="bold" className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <div className="text-2xl font-bold">{stats.vacant}</div>
            <div className="text-xs text-muted-foreground">Vacant</div>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-green-500/10">
            <TrendUp weight="bold" className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <div className="text-2xl font-bold">{stats.arrivalsToday}</div>
            <div className="text-xs text-muted-foreground">Arrivals</div>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-500/10">
            <TrendUp weight="bold" className="w-5 h-5 text-red-600 rotate-180" />
          </div>
          <div>
            <div className="text-2xl font-bold">{stats.departuresToday}</div>
            <div className="text-xs text-muted-foreground">Departures</div>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <Broom weight="bold" className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <div className="text-2xl font-bold">{stats.dirty}</div>
            <div className="text-xs text-muted-foreground">Dirty</div>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-500/10">
            <Wrench weight="bold" className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <div className="text-2xl font-bold">{stats.occupancyRate.toFixed(0)}%</div>
            <div className="text-xs text-muted-foreground">Occupancy</div>
          </div>
        </div>
      </Card>
    </div>
  )
}
