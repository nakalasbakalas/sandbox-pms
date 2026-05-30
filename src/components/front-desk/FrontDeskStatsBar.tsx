import type { FrontDeskStats } from '@/types/front-desk'
import { Card } from '@/components/ui/card'
import { SignIn, SignOut, Users, Clock, CurrencyDollar, Warning } from '@phosphor-icons/react'

interface FrontDeskStatsBarProps {
  stats: FrontDeskStats
}

export function FrontDeskStatsBar({ stats }: FrontDeskStatsBarProps) {
  return (
    <div className="grid grid-cols-6 gap-3">
      <Card className="p-4 bg-blue-50 border-blue-200">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="text-xs font-medium text-blue-700 mb-1">Arrivals</div>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-bold text-blue-900">
                {stats.arrivalsCheckedIn}/{stats.arrivalsToday}
              </div>
            </div>
            <div className="text-xs text-blue-600 mt-1">
              {stats.arrivalsRemaining} pending
            </div>
          </div>
          <SignIn className="text-blue-600" weight="duotone" size={24} />
        </div>
      </Card>

      <Card className="p-4 bg-amber-50 border-amber-200">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="text-xs font-medium text-amber-700 mb-1">Departures</div>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-bold text-amber-900">
                {stats.departuresCheckedOut}/{stats.departuresToday}
              </div>
            </div>
            <div className="text-xs text-amber-600 mt-1">
              {stats.departuresRemaining} pending
            </div>
          </div>
          <SignOut className="text-amber-600" weight="duotone" size={24} />
        </div>
      </Card>

      <Card className="p-4 bg-green-50 border-green-200">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="text-xs font-medium text-green-700 mb-1">In-House</div>
            <div className="text-2xl font-bold text-green-900">{stats.inHouse}</div>
            <div className="text-xs text-green-600 mt-1">guests</div>
          </div>
          <Users className="text-green-600" weight="duotone" size={24} />
        </div>
      </Card>

      <Card className="p-4 bg-purple-50 border-purple-200">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="text-xs font-medium text-purple-700 mb-1">Late / No-Show</div>
            <div className="text-2xl font-bold text-purple-900">
              {stats.lateCheckouts + stats.noShows}
            </div>
            <div className="text-xs text-purple-600 mt-1">
              {stats.lateCheckouts} late, {stats.noShows} no-show
            </div>
          </div>
          <Clock className="text-purple-600" weight="duotone" size={24} />
        </div>
      </Card>

      <Card className="p-4 bg-rose-50 border-rose-200">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="text-xs font-medium text-rose-700 mb-1">Pending Deposits</div>
            <div className="text-2xl font-bold text-rose-900">{stats.pendingDeposits}</div>
            <div className="text-xs text-rose-600 mt-1">bookings</div>
          </div>
          <Warning className="text-rose-600" weight="duotone" size={24} />
        </div>
      </Card>

      <Card className="p-4 bg-slate-50 border-slate-200">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="text-xs font-medium text-slate-700 mb-1">Outstanding</div>
            <div className="text-2xl font-bold text-slate-900">
              ฿{stats.outstandingBalance.toLocaleString()}
            </div>
            <div className="text-xs text-slate-600 mt-1">balance due</div>
          </div>
          <CurrencyDollar className="text-slate-600" weight="duotone" size={24} />
        </div>
      </Card>
    </div>
  )
}
