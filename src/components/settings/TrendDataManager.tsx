import { useKV } from '@github/spark/hooks'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { WeeklyPerformanceMetrics } from '@/types/daily-summary'
import { Database } from '@phosphor-icons/react'

export function TrendDataManager() {
  const [historicalMetrics] = useKV<WeeklyPerformanceMetrics[]>(
    'weekly-performance-history',
    []
  )

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

        <p className="text-xs text-muted-foreground">
          Historical trends are recorded from actual daily reports. No synthetic baseline data is created.
        </p>
      </CardContent>
    </Card>
  )
}
