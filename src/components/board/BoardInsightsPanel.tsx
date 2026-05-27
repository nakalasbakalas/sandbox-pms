import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { 
  ChartBar, 
  TrendUp, 
  TrendDown, 
  Users, 
  DoorOpen, 
  Broom,
  CurrencyCircleDollar,
  CalendarBlank,
  Warning,
  CheckCircle,
  Clock,
  Star
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import type { BoardRoomCard } from '@/types/board'

interface BoardInsightsPanelProps {
  rooms: BoardRoomCard[]
  viewMode: '7day' | '14day' | '30day'
}

export function BoardInsightsPanel({ rooms, viewMode }: BoardInsightsPanelProps) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const occupied = rooms.filter(r => r.status === 'OCCUPIED').length
  const vacantClean = rooms.filter(r => r.status === 'VACANT_CLEAN').length
  const vacantDirty = rooms.filter(r => r.status === 'VACANT_DIRTY').length
  const outOfService = rooms.filter(r => r.status === 'OUT_OF_SERVICE').length
  const totalRooms = rooms.length
  const availableRooms = vacantClean

  const arrivalsToday = rooms.filter(r => 
    r.reservation?.checkIn && new Date(r.reservation.checkIn).toDateString() === today.toDateString()
  ).length

  const departuresToday = rooms.filter(r => 
    r.reservation?.checkOut && new Date(r.reservation.checkOut).toDateString() === today.toDateString()
  ).length

  const vipGuests = rooms.filter(r => r.reservation?.isVIP).length
  const pendingDeposits = rooms.filter(r => r.reservation?.depositStatus === 'PENDING').length
  const maintenanceIssues = rooms.filter(r => r.hasIssues).length

  const occupancyRate = ((occupied / totalRooms) * 100) || 0
  const cleanlinessRate = (((occupied + vacantClean) / totalRooms) * 100) || 0

  const turnoverPressure = departuresToday > 0 && arrivalsToday > 0
  const highOccupancy = occupancyRate >= 80
  const lowAvailability = availableRooms <= 3

  const futureReservations = rooms.filter(r => 
    r.reservation?.checkIn && new Date(r.reservation.checkIn) > today
  ).length

  const stayoverRooms = rooms.filter(r => 
    r.status === 'OCCUPIED' && 
    r.reservation?.checkOut && 
    new Date(r.reservation.checkOut) > today
  ).length

  const expectedRevenue = rooms
    .filter(r => r.reservation)
    .reduce((sum, r) => sum + (r.reservation?.totalAmount || 0), 0)

  return (
    <Card className="shadow-lg border-2">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <ChartBar weight="duotone" className="w-5 h-5 text-primary" />
              Property Insights
            </CardTitle>
            <CardDescription className="text-xs">
              Real-time operational overview
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-xs font-mono">
            {viewMode.replace('day', 'd')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pb-4">
        
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-medium">Occupancy</span>
              <span className={cn(
                "font-bold",
                highOccupancy ? "text-green-700" : "text-primary"
              )}>
                {occupancyRate.toFixed(0)}%
              </span>
            </div>
            <Progress value={occupancyRate} className="h-1.5" />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-medium">Cleanliness</span>
              <span className={cn(
                "font-bold",
                cleanlinessRate >= 80 ? "text-green-700" : "text-orange-600"
              )}>
                {cleanlinessRate.toFixed(0)}%
              </span>
            </div>
            <Progress value={cleanlinessRate} className="h-1.5" />
          </div>
        </div>

        <Separator />

        <div className="grid grid-cols-3 gap-2">
          <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-50 dark:bg-blue-950/20">
            <Users weight="duotone" className="w-4 h-4 text-blue-700" />
            <div>
              <div className="text-sm font-bold text-blue-900 dark:text-blue-100">{occupied}</div>
              <div className="text-[10px] text-blue-700 dark:text-blue-300">Occupied</div>
            </div>
          </div>

          <div className="flex items-center gap-2 p-2 rounded-lg bg-green-50 dark:bg-green-950/20">
            <DoorOpen weight="duotone" className="w-4 h-4 text-green-700" />
            <div>
              <div className="text-sm font-bold text-green-900 dark:text-green-100">{availableRooms}</div>
              <div className="text-[10px] text-green-700 dark:text-green-300">Available</div>
            </div>
          </div>

          <div className="flex items-center gap-2 p-2 rounded-lg bg-orange-50 dark:bg-orange-950/20">
            <Broom weight="duotone" className="w-4 h-4 text-orange-700" />
            <div>
              <div className="text-sm font-bold text-orange-900 dark:text-orange-100">{vacantDirty}</div>
              <div className="text-[10px] text-orange-700 dark:text-orange-300">Dirty</div>
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <TrendUp weight="duotone" className="w-3.5 h-3.5 text-emerald-600" />
              <span>Arrivals Today</span>
            </div>
            <span className="font-bold text-emerald-700">{arrivalsToday}</span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <TrendDown weight="duotone" className="w-3.5 h-3.5 text-red-600" />
              <span>Departures Today</span>
            </div>
            <span className="font-bold text-red-700">{departuresToday}</span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <CalendarBlank weight="duotone" className="w-3.5 h-3.5 text-blue-600" />
              <span>Stayover Rooms</span>
            </div>
            <span className="font-bold">{stayoverRooms}</span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <CalendarBlank weight="duotone" className="w-3.5 h-3.5 text-purple-600" />
              <span>Future Reservations</span>
            </div>
            <span className="font-bold text-purple-700">{futureReservations}</span>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Star weight="duotone" className="w-3.5 h-3.5 text-amber-600" />
              <span>VIP Guests</span>
            </div>
            <Badge variant={vipGuests > 0 ? "default" : "outline"} className="h-5 text-xs">
              {vipGuests}
            </Badge>
          </div>

          {pendingDeposits > 0 && (
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-orange-600">
                <Clock weight="duotone" className="w-3.5 h-3.5" />
                <span>Pending Deposits</span>
              </div>
              <Badge variant="outline" className="h-5 text-xs border-orange-600 text-orange-700">
                {pendingDeposits}
              </Badge>
            </div>
          )}

          {maintenanceIssues > 0 && (
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-red-600">
                <Warning weight="duotone" className="w-3.5 h-3.5" />
                <span>Maintenance Issues</span>
              </div>
              <Badge variant="destructive" className="h-5 text-xs">
                {maintenanceIssues}
              </Badge>
            </div>
          )}

          {outOfService > 0 && (
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Warning weight="duotone" className="w-3.5 h-3.5" />
                <span>Out of Service</span>
              </div>
              <Badge variant="outline" className="h-5 text-xs">
                {outOfService}
              </Badge>
            </div>
          )}
        </div>

        {expectedRevenue > 0 && (
          <>
            <Separator />
            <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-primary/5">
              <div className="flex items-center gap-1.5 text-muted-foreground font-medium">
                <CurrencyCircleDollar weight="duotone" className="w-4 h-4 text-primary" />
                <span>Expected Revenue</span>
              </div>
              <span className="font-bold text-primary">
                ฿{expectedRevenue.toLocaleString()}
              </span>
            </div>
          </>
        )}

        {(turnoverPressure || lowAvailability) && (
          <>
            <Separator />
            <div className="space-y-2">
              {turnoverPressure && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800">
                  <Clock weight="duotone" className="w-4 h-4 text-yellow-700 flex-shrink-0" />
                  <span className="text-[10px] font-medium text-yellow-900 dark:text-yellow-100">
                    High turnover pressure today
                  </span>
                </div>
              )}
              {lowAvailability && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
                  <Warning weight="duotone" className="w-4 h-4 text-red-700 flex-shrink-0" />
                  <span className="text-[10px] font-medium text-red-900 dark:text-red-100">
                    Low room availability
                  </span>
                </div>
              )}
            </div>
          </>
        )}

        {!turnoverPressure && !lowAvailability && !maintenanceIssues && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
            <CheckCircle weight="duotone" className="w-4 h-4 text-green-700 flex-shrink-0" />
            <span className="text-[10px] font-medium text-green-900 dark:text-green-100">
              All systems operational
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
