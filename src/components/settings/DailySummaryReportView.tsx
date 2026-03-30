import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { useDailySummary } from '@/hooks/use-daily-summary'
import { useWeeklyTrends } from '@/hooks/use-weekly-trends'
import { WeeklyTrendsCard } from './WeeklyTrendsCard'
import { useKV } from '@github/spark/hooks'
import type { BoardRoomCard } from '@/types/board'
import {
  CheckCircle,
  XCircle,
  WarningCircle,
  Broom,
  SignIn,
  SignOut,
  Wrench,
  TrendUp,
  Bell,
  Download,
  ArrowRight,
} from '@phosphor-icons/react'

export function DailySummaryReportView() {
  const { lastGeneratedReport, generateAndSend, settings } = useDailySummary()
  const { weeklyTrends } = useWeeklyTrends()
  const [rooms] = useKV<BoardRoomCard[]>('pms-rooms', [])

  if (!lastGeneratedReport) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-6xl mx-auto">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
              <Bell className="size-12 text-muted-foreground" />
              <div className="text-center">
                <h3 className="text-lg font-semibold mb-2">No Reports Generated Yet</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Generate your first daily summary report to see operational insights
                </p>
                <Button onClick={generateAndSend}>Generate Report Now</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  const report = lastGeneratedReport
  const criticalAlerts = report.alerts.filter(a => a.severity === 'CRITICAL')
  const warningAlerts = report.alerts.filter(a => a.severity === 'WARNING')
  const infoAlerts = report.alerts.filter(a => a.severity === 'INFO')

  const highPriorityRooms = report.roomDetails.filter(r => r.needsAttention)

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <TrendUp weight="duotone" size={24} className="text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Daily Summary Report</h1>
                <p className="text-sm text-muted-foreground">
                  {new Date(report.reportDate).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                Generated {new Date(report.generatedAt).toLocaleTimeString()}
              </span>
              <Button onClick={generateAndSend} variant="outline">
                <Download />
                Regenerate
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-6xl mx-auto flex flex-col gap-6">
        <WeeklyTrendsCard trends={weeklyTrends} />

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Readiness Score</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold">{report.readinessScore.score}</span>
                <span className="text-lg text-muted-foreground">%</span>
              </div>
              <Progress value={report.readinessScore.score} className="mt-3" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Clean Rooms</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold">
                  {report.roomStatus.clean + report.roomStatus.inspected}
                </span>
                <span className="text-lg text-muted-foreground">
                  / {report.roomStatus.total}
                </span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {Math.round(
                  ((report.roomStatus.clean + report.roomStatus.inspected) /
                    report.roomStatus.total) *
                    100
                )}
                % of inventory
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Arrivals Today</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold">{report.todaySchedule.arrivals}</span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {report.todaySchedule.roomsReadyForArrivals} ready (
                {report.todaySchedule.readinessPercentage}%)
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Maintenance Issues</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold">{report.maintenanceIssues.total}</span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {report.maintenanceIssues.roomsBlocked} room(s) blocked
              </div>
            </CardContent>
          </Card>
        </div>

        {report.alerts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="size-5" />
                Active Alerts
                <Badge variant="destructive">{report.alerts.length}</Badge>
              </CardTitle>
              <CardDescription>Issues requiring attention</CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-3">
              {criticalAlerts.map((alert, index) => (
                <div
                  key={`critical-${index}`}
                  className="flex items-start gap-3 p-4 rounded-lg border-2 border-destructive bg-destructive/5"
                >
                  <XCircle className="size-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="destructive" className="text-xs">CRITICAL</Badge>
                      <span className="text-xs text-muted-foreground">{alert.category}</span>
                    </div>
                    <p className="text-sm font-medium">{alert.message}</p>
                    {alert.rooms && alert.rooms.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {alert.rooms.map((room) => (
                          <Badge key={room} variant="outline" className="text-xs">
                            {room}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {warningAlerts.map((alert, index) => (
                <div
                  key={`warning-${index}`}
                  className="flex items-start gap-3 p-4 rounded-lg border border-yellow-500 bg-yellow-50"
                >
                  <WarningCircle className="size-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className="text-xs bg-yellow-600">WARNING</Badge>
                      <span className="text-xs text-muted-foreground">{alert.category}</span>
                    </div>
                    <p className="text-sm font-medium">{alert.message}</p>
                    {alert.rooms && alert.rooms.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {alert.rooms.map((room) => (
                          <Badge key={room} variant="outline" className="text-xs">
                            {room}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {infoAlerts.map((alert, index) => (
                <div
                  key={`info-${index}`}
                  className="flex items-start gap-3 p-4 rounded-lg border border-blue-200 bg-blue-50"
                >
                  <Bell className="size-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className="text-xs bg-blue-600">INFO</Badge>
                      <span className="text-xs text-muted-foreground">{alert.category}</span>
                    </div>
                    <p className="text-sm">{alert.message}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Broom className="size-5" />
                Room Status
              </CardTitle>
              <CardDescription>Current cleanliness distribution</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="size-4 text-green-600" />
                    <span className="text-sm">Inspected</span>
                  </div>
                  <span className="text-sm font-semibold">{report.roomStatus.inspected}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="size-4 text-blue-600" />
                    <span className="text-sm">Clean</span>
                  </div>
                  <span className="text-sm font-semibold">{report.roomStatus.clean}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <XCircle className="size-4 text-orange-600" />
                    <span className="text-sm">Dirty</span>
                  </div>
                  <span className="text-sm font-semibold">{report.roomStatus.dirty}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wrench className="size-4 text-red-600" />
                    <span className="text-sm">Out of Service</span>
                  </div>
                  <span className="text-sm font-semibold">{report.roomStatus.outOfService}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between font-semibold">
                  <span className="text-sm">Total Rooms</span>
                  <span className="text-sm">{report.roomStatus.total}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SignIn className="size-5" />
                Today's Schedule
              </CardTitle>
              <CardDescription>Arrival and departure overview</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <SignOut className="size-4 text-muted-foreground" />
                    <span className="text-sm">Departures</span>
                  </div>
                  <span className="text-sm font-semibold">{report.todaySchedule.departures}</span>
                </div>
                <div className="flex items-center justify-between pl-6">
                  <span className="text-sm text-muted-foreground">Completed</span>
                  <span className="text-sm">{report.todaySchedule.departuresCompleted}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <SignIn className="size-4 text-muted-foreground" />
                    <span className="text-sm">Arrivals</span>
                  </div>
                  <span className="text-sm font-semibold">{report.todaySchedule.arrivals}</span>
                </div>
                <div className="flex items-center justify-between pl-6">
                  <span className="text-sm text-muted-foreground">Rooms Ready</span>
                  <span className="text-sm">{report.todaySchedule.roomsReadyForArrivals}</span>
                </div>
                <Separator />
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Arrival Readiness</span>
                    <span className="text-sm font-semibold">
                      {report.todaySchedule.readinessPercentage}%
                    </span>
                  </div>
                  <Progress value={report.todaySchedule.readinessPercentage} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Broom className="size-5" />
                Housekeeping Progress
              </CardTitle>
              <CardDescription>Cleaning task completion status</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col items-center p-3 rounded-lg bg-green-50 border border-green-200">
                    <span className="text-2xl font-bold text-green-700">
                      {report.housekeepingProgress.completed}
                    </span>
                    <span className="text-xs text-green-700">Completed</span>
                  </div>
                  <div className="flex flex-col items-center p-3 rounded-lg bg-yellow-50 border border-yellow-200">
                    <span className="text-2xl font-bold text-yellow-700">
                      {report.housekeepingProgress.inProgress}
                    </span>
                    <span className="text-xs text-yellow-700">In Progress</span>
                  </div>
                  <div className="flex flex-col items-center p-3 rounded-lg bg-gray-50 border border-gray-200">
                    <span className="text-2xl font-bold text-gray-700">
                      {report.housekeepingProgress.notStarted}
                    </span>
                    <span className="text-xs text-gray-700">Not Started</span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm">Completion Rate</span>
                    <span className="text-sm font-semibold">
                      {report.housekeepingProgress.totalTasks > 0
                        ? Math.round(
                            (report.housekeepingProgress.completed /
                              report.housekeepingProgress.totalTasks) *
                              100
                          )
                        : 0}
                      %
                    </span>
                  </div>
                  <Progress
                    value={
                      report.housekeepingProgress.totalTasks > 0
                        ? (report.housekeepingProgress.completed /
                            report.housekeepingProgress.totalTasks) *
                          100
                        : 0
                    }
                  />
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Avg. Clean Time</span>
                  <span className="font-medium">
                    {report.housekeepingProgress.averageCompletionTime} min
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendUp className="size-5" />
                Readiness Factors
              </CardTitle>
              <CardDescription>Components of readiness score</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm">Arrival Readiness</span>
                    <span className="text-sm font-semibold">
                      {Math.round(report.readinessScore.factors.arrivalReadiness)}%
                    </span>
                  </div>
                  <Progress value={report.readinessScore.factors.arrivalReadiness} />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm">Clean Room Ratio</span>
                    <span className="text-sm font-semibold">
                      {Math.round(report.readinessScore.factors.cleanRoomRatio)}%
                    </span>
                  </div>
                  <Progress value={report.readinessScore.factors.cleanRoomRatio} />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm">Housekeeping Velocity</span>
                    <span className="text-sm font-semibold">
                      {Math.round(report.readinessScore.factors.housekeepingVelocity)}%
                    </span>
                  </div>
                  <Progress value={report.readinessScore.factors.housekeepingVelocity} />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm">Maintenance Health</span>
                    <span className="text-sm font-semibold">
                      {Math.round(report.readinessScore.factors.maintenanceHealth)}%
                    </span>
                  </div>
                  <Progress value={report.readinessScore.factors.maintenanceHealth} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {highPriorityRooms.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <WarningCircle className="size-5" />
                Rooms Needing Attention
                <Badge variant="outline">{highPriorityRooms.length}</Badge>
              </CardTitle>
              <CardDescription>High-priority rooms requiring immediate action</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {highPriorityRooms.slice(0, 12).map((room) => (
                  <div
                    key={room.roomNumber}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-semibold">{room.roomNumber}</span>
                      <div className="flex items-center gap-2">
                        {room.hasArrival && (
                          <Badge variant="default" className="text-xs">
                            <SignIn className="size-3" />
                            Arrival
                          </Badge>
                        )}
                        {room.hasDeparture && (
                          <Badge variant="secondary" className="text-xs">
                            <SignOut className="size-3" />
                            Departure
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant={
                        room.status === 'CLEAN' || room.status === 'INSPECTED'
                          ? 'default'
                          : room.status === 'OUT_OF_SERVICE'
                          ? 'destructive'
                          : 'outline'
                      }
                      className="text-xs"
                    >
                      {room.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>All Rooms</CardTitle>
            <CardDescription>
              Complete room status for {new Date(report.reportDate).toLocaleDateString()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {report.roomDetails.map((room) => (
                <div
                  key={room.roomNumber}
                  className={`flex flex-col gap-1 p-3 rounded-lg border ${
                    room.needsAttention
                      ? 'border-orange-300 bg-orange-50'
                      : 'border-border bg-card'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold text-sm">{room.roomNumber}</span>
                    {room.needsAttention && <WarningCircle className="size-4 text-orange-600" />}
                  </div>
                  <Badge
                    variant={
                      room.status === 'CLEAN' || room.status === 'INSPECTED'
                        ? 'default'
                        : room.status === 'OUT_OF_SERVICE'
                        ? 'destructive'
                        : 'outline'
                    }
                    className="text-xs w-full justify-center"
                  >
                    {room.status}
                  </Badge>
                  {(room.hasArrival || room.hasDeparture) && (
                    <div className="flex gap-1 mt-1">
                      {room.hasDeparture && <SignOut className="size-3 text-muted-foreground" />}
                      {room.hasArrival && <SignIn className="size-3 text-muted-foreground" />}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
