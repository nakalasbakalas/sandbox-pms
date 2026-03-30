import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useDailySummary } from '@/hooks/use-daily-summary'
import { useNavigation } from '@/hooks/use-navigation'
import { Calendar, Clock, Mail, MessengerLogo, Bell, CheckCircle, WarningCircle, XCircle, Eye } from '@phosphor-icons/react'
import { toast } from 'sonner'

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
]

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  FRONT_DESK: 'Front Desk',
  HOUSEKEEPING: 'Housekeeping',
  CASHIER: 'Cashier',
  MAINTENANCE: 'Maintenance',
}

export function DailySummarySettings() {
  const {
    settings,
    setSettings,
    reportLogs,
    lastGeneratedReport,
    generateAndSend,
    getRecipients,
  } = useDailySummary()
  
  const { navigate } = useNavigation()

  const recipients = getRecipients()

  const handleTestReport = async () => {
    toast.loading('Generating test report...', { id: 'test-report' })
    try {
      await generateAndSend()
      toast.success('Test report sent successfully', { id: 'test-report' })
    } catch (error) {
      toast.error('Failed to send test report', { id: 'test-report' })
    }
  }

  const toggleDay = (day: number) => {
    if (!settings) return
    
    setSettings((current) => {
      if (!current) return current
      
      const currentDays = current.schedule.daysOfWeek
      const newDays = currentDays.includes(day)
        ? currentDays.filter(d => d !== day)
        : [...currentDays, day].sort((a, b) => a - b)
      
      return {
        ...current,
        schedule: {
          ...current.schedule,
          daysOfWeek: newDays,
        },
      }
    })
  }

  const toggleRole = (role: string) => {
    if (!settings) return
    
    setSettings((current) => {
      if (!current) return current
      
      const currentRoles = current.recipients.roles
      const newRoles = currentRoles.includes(role as any)
        ? currentRoles.filter(r => r !== role)
        : [...currentRoles, role as any]
      
      return {
        ...current,
        recipients: {
          ...current.recipients,
          roles: newRoles,
        },
      }
    })
  }

  const toggleMetric = (metric: keyof typeof settings.includeMetrics) => {
    if (!settings) return
    
    setSettings((current) => {
      if (!current) return current
      
      return {
        ...current,
        includeMetrics: {
          ...current.includeMetrics,
          [metric]: !current.includeMetrics[metric],
        },
      }
    })
  }

  if (!settings) return null

  const recentLogs = reportLogs.slice(0, 5)

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>Daily Summary Reports</CardTitle>
              <CardDescription>
                Automated daily reports on room readiness and operational status
              </CardDescription>
            </div>
            <Switch
              checked={settings.enabled}
              onCheckedChange={(checked) =>
                setSettings((current) => current ? { ...current, enabled: checked } : current)
              }
            />
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-4">
            <div>
              <Label className="text-sm font-medium">Schedule</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Configure when daily reports should be generated and sent
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Clock className="size-4 text-muted-foreground" />
                <Label htmlFor="report-time" className="text-sm">Time</Label>
                <Input
                  id="report-time"
                  type="time"
                  value={settings.schedule.time}
                  onChange={(e) =>
                    setSettings((current) =>
                      current
                        ? {
                            ...current,
                            schedule: {
                              ...current.schedule,
                              time: e.target.value,
                            },
                          }
                        : current
                    )
                  }
                  className="w-32"
                  disabled={!settings.enabled}
                />
              </div>

              <div className="flex items-center gap-3">
                <Calendar className="size-4 text-muted-foreground" />
                <Label className="text-sm">Days</Label>
                <div className="flex gap-2">
                  {DAYS_OF_WEEK.map((day) => (
                    <Button
                      key={day.value}
                      variant={
                        settings.schedule.daysOfWeek.includes(day.value)
                          ? 'default'
                          : 'outline'
                      }
                      size="sm"
                      className="w-12"
                      onClick={() => toggleDay(day.value)}
                      disabled={!settings.enabled}
                    >
                      {day.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-4">
            <div>
              <Label className="text-sm font-medium">Delivery Channels</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Choose how reports should be delivered
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <MessengerLogo className="size-4 text-muted-foreground" />
                  <Label className="text-sm">LINE Messaging</Label>
                </div>
                <Switch
                  checked={settings.channels.line}
                  onCheckedChange={(checked) =>
                    setSettings((current) =>
                      current
                        ? {
                            ...current,
                            channels: { ...current.channels, line: checked },
                          }
                        : current
                    )
                  }
                  disabled={!settings.enabled}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Mail className="size-4 text-muted-foreground" />
                  <Label className="text-sm">Email</Label>
                </div>
                <Switch
                  checked={settings.channels.email}
                  onCheckedChange={(checked) =>
                    setSettings((current) =>
                      current
                        ? {
                            ...current,
                            channels: { ...current.channels, email: checked },
                          }
                        : current
                    )
                  }
                  disabled={!settings.enabled}
                />
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-4">
            <div>
              <Label className="text-sm font-medium">Recipients</Label>
              <p className="text-xs text-muted-foreground mt-1">
                {recipients.length} staff member(s) will receive reports
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {Object.entries(ROLE_LABELS).map(([role, label]) => (
                <Button
                  key={role}
                  variant={settings.recipients.roles.includes(role as any) ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => toggleRole(role)}
                  disabled={!settings.enabled}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-4">
            <div>
              <Label className="text-sm font-medium">Report Content</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Select metrics to include in daily reports
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-normal">Room Status Overview</Label>
                <Switch
                  checked={settings.includeMetrics.roomStatus}
                  onCheckedChange={() => toggleMetric('roomStatus')}
                  disabled={!settings.enabled}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-sm font-normal">Housekeeping Progress</Label>
                <Switch
                  checked={settings.includeMetrics.housekeepingProgress}
                  onCheckedChange={() => toggleMetric('housekeepingProgress')}
                  disabled={!settings.enabled}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-sm font-normal">Arrivals & Departures</Label>
                <Switch
                  checked={settings.includeMetrics.arrivalsAndDepartures}
                  onCheckedChange={() => toggleMetric('arrivalsAndDepartures')}
                  disabled={!settings.enabled}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-sm font-normal">Maintenance Issues</Label>
                <Switch
                  checked={settings.includeMetrics.maintenanceIssues}
                  onCheckedChange={() => toggleMetric('maintenanceIssues')}
                  disabled={!settings.enabled}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-sm font-normal">Readiness Score</Label>
                <Switch
                  checked={settings.includeMetrics.readinessScore}
                  onCheckedChange={() => toggleMetric('readinessScore')}
                  disabled={!settings.enabled}
                />
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-4">
            <div>
              <Label className="text-sm font-medium">Alert Thresholds</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Configure when warnings should be included
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Label htmlFor="readiness-threshold" className="text-sm w-48">
                  Low Readiness Warning
                </Label>
                <Input
                  id="readiness-threshold"
                  type="number"
                  min="0"
                  max="100"
                  value={settings.thresholds.lowReadinessWarning}
                  onChange={(e) =>
                    setSettings((current) =>
                      current
                        ? {
                            ...current,
                            thresholds: {
                              ...current.thresholds,
                              lowReadinessWarning: Number(e.target.value),
                            },
                          }
                        : current
                    )
                  }
                  className="w-24"
                  disabled={!settings.enabled}
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>

              <div className="flex items-center gap-3">
                <Label htmlFor="priority-threshold" className="text-sm w-48">
                  High Priority Room Count
                </Label>
                <Input
                  id="priority-threshold"
                  type="number"
                  min="1"
                  value={settings.thresholds.highPriorityRoomCount}
                  onChange={(e) =>
                    setSettings((current) =>
                      current
                        ? {
                            ...current,
                            thresholds: {
                              ...current.thresholds,
                              highPriorityRoomCount: Number(e.target.value),
                            },
                          }
                        : current
                    )
                  }
                  className="w-24"
                  disabled={!settings.enabled}
                />
                <span className="text-sm text-muted-foreground">rooms</span>
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex items-center gap-3">
            <Button onClick={handleTestReport} disabled={!settings.enabled || recipients.length === 0}>
              <Bell />
              Generate Test Report
            </Button>
            {lastGeneratedReport && (
              <Button onClick={() => navigate('daily-summary')} variant="outline">
                <Eye />
                View Latest Report
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              Send a test report now to verify settings
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Reports</CardTitle>
          <CardDescription>History of generated daily summary reports</CardDescription>
        </CardHeader>

        <CardContent>
          {recentLogs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">No reports generated yet</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {recentLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      {log.deliveryStatus === 'SENT' && (
                        <CheckCircle className="size-4 text-green-600" />
                      )}
                      {log.deliveryStatus === 'FAILED' && (
                        <XCircle className="size-4 text-red-600" />
                      )}
                      {log.deliveryStatus === 'PENDING' && (
                        <WarningCircle className="size-4 text-yellow-600" />
                      )}
                      <span className="text-sm font-medium">
                        {new Date(log.reportDate).toLocaleDateString()}
                      </span>
                      {log.deliveryStatus === 'SENT' && log.sentVia.length > 0 && (
                        <div className="flex gap-1">
                          {log.sentVia.map((channel) => (
                            <Badge key={channel} variant="secondary" className="text-xs">
                              {channel.toUpperCase()}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>Clean: {log.reportSummary.cleanRooms}</span>
                      <span>Dirty: {log.reportSummary.dirtyRooms}</span>
                      <span>Arrivals: {log.reportSummary.arrivals}</span>
                      <span>Score: {log.reportSummary.readinessScore}%</span>
                    </div>
                    {log.failureReason && (
                      <p className="text-xs text-red-600">{log.failureReason}</p>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {log.sentAt
                      ? new Date(log.sentAt).toLocaleTimeString()
                      : new Date(log.generatedAt).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {lastGeneratedReport && (
        <Card>
          <CardHeader>
            <CardTitle>Latest Report Preview</CardTitle>
            <CardDescription>
              Generated at {new Date(lastGeneratedReport.generatedAt).toLocaleString()}
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Readiness Score</span>
                <span className="text-2xl font-semibold">
                  {lastGeneratedReport.readinessScore.score}%
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Clean Rooms</span>
                <span className="text-2xl font-semibold">
                  {lastGeneratedReport.roomStatus.clean + lastGeneratedReport.roomStatus.inspected}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Arrivals Today</span>
                <span className="text-2xl font-semibold">
                  {lastGeneratedReport.todaySchedule.arrivals}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Rooms Ready</span>
                <span className="text-2xl font-semibold">
                  {lastGeneratedReport.todaySchedule.roomsReadyForArrivals}
                </span>
              </div>
            </div>

            {lastGeneratedReport.alerts.length > 0 && (
              <>
                <Separator />
                <div className="flex flex-col gap-3">
                  <Label className="text-sm font-medium">Active Alerts</Label>
                  {lastGeneratedReport.alerts.map((alert, index) => (
                    <div
                      key={index}
                      className={`flex items-start gap-3 p-3 rounded-lg border ${
                        alert.severity === 'CRITICAL'
                          ? 'bg-red-50 border-red-200'
                          : alert.severity === 'WARNING'
                          ? 'bg-yellow-50 border-yellow-200'
                          : 'bg-blue-50 border-blue-200'
                      }`}
                    >
                      {alert.severity === 'CRITICAL' && (
                        <XCircle className="size-5 text-red-600 flex-shrink-0" />
                      )}
                      {alert.severity === 'WARNING' && (
                        <WarningCircle className="size-5 text-yellow-600 flex-shrink-0" />
                      )}
                      {alert.severity === 'INFO' && (
                        <Bell className="size-5 text-blue-600 flex-shrink-0" />
                      )}
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-medium">{alert.message}</span>
                        {alert.rooms && alert.rooms.length > 0 && (
                          <div className="flex flex-wrap gap-1">
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
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
