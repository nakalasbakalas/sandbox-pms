import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { WeeklyPerformanceMetrics } from '@/types/daily-summary'
import { Database, Trash } from '@phosphor-icons/react'

export function TrendDataManager() {
  const [historicalMetrics, setHistoricalMetrics] = useKV<WeeklyPerformanceMetrics[]>(
    'weekly-performance-history',
    []
  )

  const seedBaselineData = () => {
    const now = new Date()
    const baselineData: WeeklyPerformanceMetrics[] = []

    for (let i = 13; i >= 0; i--) {
      const date = new Date(now)
      date.setDate(now.getDate() - i)
      date.setHours(7, 0, 0, 0)

      const isCurrentWeek = i < 7
      const baseReadiness = isCurrentWeek ? 88 : 82
      const baseClean = isCurrentWeek ? 92 : 87
      const baseHousekeeping = isCurrentWeek ? 94 : 88
      const baseMaintenance = isCurrentWeek ? 2 : 4
      const baseOccupancy = isCurrentWeek ? 78 : 72

      const deterministicVariation = (offset: number) => Math.sin((i + 1) * offset) * 3
      const occupiedRoomEstimate = Math.round(30 * (baseOccupancy / 100))

      baselineData.push({
        date,
        readinessScore: Math.max(70, Math.min(98, baseReadiness + deterministicVariation(0.7))),
        cleanRoomPercentage: Math.max(75, Math.min(98, baseClean + deterministicVariation(0.9))),
        arrivalReadiness: Math.max(80, Math.min(100, baseReadiness + deterministicVariation(1.1))),
        housekeepingCompletionRate: Math.max(75, Math.min(100, baseHousekeeping + deterministicVariation(1.3))),
        maintenanceIssues: Math.max(0, Math.round(baseMaintenance + ((i % 3) - 1))),
        totalRooms: 30,
        arrivals: Math.max(0, occupiedRoomEstimate - (i % 4)),
        departures: Math.max(0, occupiedRoomEstimate - ((i + 2) % 4)),
        averageCleanTime: 38 + ((i % 5) - 2) * 3,
      })
    }

    setHistoricalMetrics(baselineData)
  }

  const clearData = () => {
    setHistoricalMetrics([])
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="size-5" />
          Trend Data Management
        </CardTitle>
        <CardDescription>
          Manage historical performance data for weekly trends
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
          <div>
            <p className="text-sm font-medium">Historical Data Points</p>
            <p className="text-xs text-muted-foreground">
              {historicalMetrics?.length || 0} days recorded
            </p>
          </div>
          <Badge variant="outline" className="font-mono">
            {historicalMetrics?.length || 0} / 90
          </Badge>
        </div>

        <div className="flex gap-2">
          <Button onClick={seedBaselineData} variant="outline" className="flex-1">
            <Database />
            Create Baseline Data
          </Button>
          <Button 
            onClick={clearData} 
            variant="destructive" 
            disabled={!historicalMetrics || historicalMetrics.length === 0}
          >
            <Trash />
            Clear All
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Use deterministic baseline data only when no historical daily reports exist. Actual reports will automatically record data over time.
        </p>
      </CardContent>
    </Card>
  )
}
