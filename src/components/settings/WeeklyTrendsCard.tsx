import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import type { WeeklyTrends } from '@/types/daily-summary'
import {
  TrendUp,
  TrendDown,
  Minus,
  Lightbulb,
  ChartLine,
  CheckCircle,
  Broom,
  Wrench,
  Users,
} from '@phosphor-icons/react'

interface WeeklyTrendsCardProps {
  trends: WeeklyTrends | null
}

export function WeeklyTrendsCard({ trends }: WeeklyTrendsCardProps) {
  if (!trends) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ChartLine className="size-5" />
            Weekly Performance Trends
          </CardTitle>
          <CardDescription>Not enough data yet - trends appear after multiple days</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <ChartLine className="size-12 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              Daily reports will be tracked to show weekly performance trends
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const getTrendIcon = (trend: 'up' | 'down' | 'stable') => {
    switch (trend) {
      case 'up':
        return <TrendUp className="size-4 text-green-600" weight="bold" />
      case 'down':
        return <TrendDown className="size-4 text-red-600" weight="bold" />
      case 'stable':
        return <Minus className="size-4 text-muted-foreground" weight="bold" />
    }
  }

  const getTrendColor = (trend: 'up' | 'down' | 'stable', higherIsBetter = true) => {
    if (trend === 'stable') return 'text-muted-foreground'
    
    if (higherIsBetter) {
      return trend === 'up' ? 'text-green-600' : 'text-red-600'
    } else {
      return trend === 'up' ? 'text-red-600' : 'text-green-600'
    }
  }

  const formatChange = (change: number, showPlus = true) => {
    const formatted = Math.abs(change).toFixed(1)
    if (change > 0 && showPlus) return `+${formatted}`
    if (change < 0) return `-${formatted}`
    return formatted
  }

  return (
    <Card className="col-span-full">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ChartLine className="size-5" />
              Weekly Performance Trends
            </CardTitle>
            <CardDescription>
              Comparing current week to previous week ({trends.currentWeek.length} vs {trends.previousWeek.length} days)
            </CardDescription>
          </div>
          <Badge variant="outline" className="gap-1">
            <CheckCircle className="size-3" />
            {trends.currentWeek.length} Days Tracked
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="flex flex-col gap-3 p-4 rounded-lg border bg-card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-primary/10">
                  <CheckCircle className="size-4 text-primary" />
                </div>
                <span className="text-sm font-medium">Readiness Score</span>
              </div>
              {getTrendIcon(trends.trends.readinessScore.trend)}
            </div>
            
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{trends.trends.readinessScore.current.toFixed(0)}</span>
              <span className="text-lg text-muted-foreground">%</span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">vs. last week</span>
              <span className={`font-semibold ${getTrendColor(trends.trends.readinessScore.trend, true)}`}>
                {formatChange(trends.trends.readinessScore.change)}%
              </span>
            </div>

            <Progress value={trends.trends.readinessScore.current} className="h-1.5" />
          </div>

          <div className="flex flex-col gap-3 p-4 rounded-lg border bg-card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-blue-100">
                  <Broom className="size-4 text-blue-600" />
                </div>
                <span className="text-sm font-medium">Clean Rooms</span>
              </div>
              {getTrendIcon(trends.trends.cleanRoomPercentage.trend)}
            </div>
            
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{trends.trends.cleanRoomPercentage.current.toFixed(0)}</span>
              <span className="text-lg text-muted-foreground">%</span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">vs. last week</span>
              <span className={`font-semibold ${getTrendColor(trends.trends.cleanRoomPercentage.trend, true)}`}>
                {formatChange(trends.trends.cleanRoomPercentage.change)}%
              </span>
            </div>

            <Progress value={trends.trends.cleanRoomPercentage.current} className="h-1.5" />
          </div>

          <div className="flex flex-col gap-3 p-4 rounded-lg border bg-card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-green-100">
                  <Broom className="size-4 text-green-600" />
                </div>
                <span className="text-sm font-medium">Housekeeping</span>
              </div>
              {getTrendIcon(trends.trends.housekeepingEfficiency.trend)}
            </div>
            
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{trends.trends.housekeepingEfficiency.current.toFixed(0)}</span>
              <span className="text-lg text-muted-foreground">%</span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">vs. last week</span>
              <span className={`font-semibold ${getTrendColor(trends.trends.housekeepingEfficiency.trend, true)}`}>
                {formatChange(trends.trends.housekeepingEfficiency.change)}%
              </span>
            </div>

            <Progress value={trends.trends.housekeepingEfficiency.current} className="h-1.5" />
          </div>

          <div className="flex flex-col gap-3 p-4 rounded-lg border bg-card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-orange-100">
                  <Wrench className="size-4 text-orange-600" />
                </div>
                <span className="text-sm font-medium">Maintenance</span>
              </div>
              {getTrendIcon(trends.trends.maintenanceIssues.trend)}
            </div>
            
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{trends.trends.maintenanceIssues.current.toFixed(1)}</span>
              <span className="text-lg text-muted-foreground">avg</span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">vs. last week</span>
              <span className={`font-semibold ${getTrendColor(trends.trends.maintenanceIssues.trend, false)}`}>
                {formatChange(trends.trends.maintenanceIssues.change)}
              </span>
            </div>

            <Progress 
              value={Math.max(0, 100 - (trends.trends.maintenanceIssues.current * 10))} 
              className="h-1.5" 
            />
          </div>

          <div className="flex flex-col gap-3 p-4 rounded-lg border bg-card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-purple-100">
                  <Users className="size-4 text-purple-600" />
                </div>
                <span className="text-sm font-medium">Occupancy</span>
              </div>
              {getTrendIcon(trends.trends.occupancyRate.trend)}
            </div>
            
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{trends.trends.occupancyRate.current.toFixed(0)}</span>
              <span className="text-lg text-muted-foreground">%</span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">vs. last week</span>
              <span className={`font-semibold ${getTrendColor(trends.trends.occupancyRate.trend, true)}`}>
                {formatChange(trends.trends.occupancyRate.change)}%
              </span>
            </div>

            <Progress value={trends.trends.occupancyRate.current} className="h-1.5" />
          </div>

          <div className="flex flex-col gap-3 p-4 rounded-lg border bg-gradient-to-br from-primary/5 to-accent/5">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <TrendUp className="size-4 text-primary" weight="duotone" />
              </div>
              <span className="text-sm font-medium">Weekly Summary</span>
            </div>
            
            <div className="flex flex-col gap-2 mt-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Days tracked</span>
                <span className="font-semibold">{trends.currentWeek.length} / 7</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Avg arrivals/day</span>
                <span className="font-semibold">
                  {(trends.currentWeek.reduce((sum, d) => sum + d.arrivals, 0) / trends.currentWeek.length).toFixed(1)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Avg clean time</span>
                <span className="font-semibold">
                  {(trends.currentWeek.reduce((sum, d) => sum + d.averageCleanTime, 0) / trends.currentWeek.length).toFixed(0)}m
                </span>
              </div>
            </div>
          </div>
        </div>

        {trends.insights.length > 0 && (
          <div className="rounded-lg border bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-blue-100 flex-shrink-0">
                <Lightbulb className="size-5 text-blue-600" weight="duotone" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-sm mb-2">Performance Insights</h4>
                <ul className="flex flex-col gap-2">
                  {trends.insights.map((insight, index) => (
                    <li key={index} className="text-sm text-foreground/90 flex items-start gap-2">
                      <span className="text-blue-600 mt-0.5">•</span>
                      <span>{insight}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
