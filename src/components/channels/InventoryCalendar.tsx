import { useKV } from '@github/spark/hooks'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { 
  Calendar,
  TrendUp,
  TrendDown,
  Minus
} from '@phosphor-icons/react'
import { useInventorySync } from '@/hooks/use-inventory-sync'
import { format, addDays } from 'date-fns'
import { cn } from '@/lib/utils'

interface InventoryCalendarProps {
  roomTypeId: string
  roomTypeName: string
  days?: number
}

export function InventoryCalendar({ roomTypeId, roomTypeName, days = 30 }: InventoryCalendarProps) {
  const { getInventoryForDateRange } = useInventorySync()

  const startDate = format(new Date(), 'yyyy-MM-dd')
  const endDate = format(addDays(new Date(), days), 'yyyy-MM-dd')
  const inventory = getInventoryForDateRange(roomTypeId, startDate, endDate)

  const getAvailabilityLabel = (available: number, total: number) => {
    if (total <= 0) return 'No inventory'
    const percentage = (available / total) * 100
    if (percentage >= 70) return 'Good'
    if (percentage >= 40) return 'Limited'
    if (percentage > 0) return 'Low'
    return 'Sold Out'
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">{roomTypeName}</CardTitle>
            <CardDescription>Next {days} days inventory availability</CardDescription>
          </div>
          <Badge variant="outline" className="text-sm">
            {roomTypeId}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px]">
          <div className="space-y-2">
            {inventory.map((snap, index) => {
              const percentage = snap.totalUnits > 0 ? (snap.availableUnits / snap.totalUnits) * 100 : 0
              const isWeekend = new Date(snap.date).getDay() === 0 || new Date(snap.date).getDay() === 6
              
              return (
                <div
                  key={snap.date}
                  className={cn(
                    "p-3 rounded-lg border transition-all",
                    isWeekend ? "bg-blue-50/50 border-blue-200" : "bg-muted border-border"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <Calendar className={cn("w-4 h-4", isWeekend && "text-blue-600")} />
                      <div>
                        <p className="font-semibold text-sm">
                          {format(new Date(snap.date), 'EEE, MMM d')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {snap.availableUnits} / {snap.totalUnits} available
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {snap.availableUnits > snap.reservedUnits && (
                        <TrendUp className="w-4 h-4 text-green-600" />
                      )}
                      {snap.availableUnits < snap.reservedUnits && (
                        <TrendDown className="w-4 h-4 text-red-600" />
                      )}
                      {snap.availableUnits === snap.reservedUnits && (
                        <Minus className="w-4 h-4 text-gray-600" />
                      )}
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs font-semibold",
                          percentage >= 70 && "bg-green-50 text-green-700 border-green-200",
                          percentage >= 40 && percentage < 70 && "bg-orange-50 text-orange-700 border-orange-200",
                          percentage < 40 && percentage > 0 && "bg-red-50 text-red-700 border-red-200",
                          percentage === 0 && "bg-gray-100 text-gray-700 border-gray-300"
                        )}
                      >
                        {getAvailabilityLabel(snap.availableUnits, snap.totalUnits)}
                      </Badge>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Progress value={percentage} className="h-2" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Reserved: {snap.reservedUnits}</span>
                      {snap.blockedUnits > 0 && (
                        <span>Blocked: {snap.blockedUnits}</span>
                      )}
                      <span>{percentage.toFixed(0)}% available</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

export function InventoryOverview() {
  const { getInventoryForDateRange } = useInventorySync()
  const [roomTypes] = useKV<Array<{ id: string; name: string }>>('room-types-config', [])

  if (roomTypes.length === 0) return null

  const overviewStats = roomTypes.map(roomType => {
    const inventory = getInventoryForDateRange(
      roomType.id,
      format(new Date(), 'yyyy-MM-dd'),
      format(addDays(new Date(), 6), 'yyyy-MM-dd')
    )

    const totalUnits = inventory[0]?.totalUnits || 0
    const totalAvailable = inventory.reduce((sum, snap) => sum + snap.availableUnits, 0)
    const totalReserved = inventory.reduce((sum, snap) => sum + snap.reservedUnits, 0)
    const avgOccupancy = totalUnits > 0 ? ((totalReserved / (totalUnits * 7)) * 100).toFixed(1) : '0.0'

    return {
      ...roomType,
      totalAvailable,
      totalReserved,
      avgOccupancy: parseFloat(avgOccupancy)
    }
  })

  return (
    <div className="grid grid-cols-3 gap-4">
      {overviewStats.map(stat => (
        <Card key={stat.id}>
          <CardHeader>
            <CardTitle className="text-base">{stat.name}</CardTitle>
            <CardDescription>Next 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Available</p>
                  <p className="text-2xl font-bold text-green-600">{stat.totalAvailable}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Reserved</p>
                  <p className="text-2xl font-bold text-blue-600">{stat.totalReserved}</p>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">Avg Occupancy</span>
                  <span className="text-sm font-bold">{stat.avgOccupancy}%</span>
                </div>
                <Progress value={stat.avgOccupancy} className="h-2" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
