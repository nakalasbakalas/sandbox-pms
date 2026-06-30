import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowClockwise,
  Brain,
  CheckCircle,
  ClipboardText,
  PauseCircle,
  PlayCircle,
  ShieldWarning,
  Warning,
  XCircle,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useNavigation } from '@/hooks/use-navigation'
import { SERVER_AUTH_ENABLED } from '@/lib/auth-mode'
import { hotelOpsApi } from '@/lib/hotel-ops-api-client'
import type {
  HotelOpsApproval,
  HotelOpsCommandResult,
  HotelOpsEmergencyStop,
  HotelOpsNotification,
  HotelOpsOtaStatus,
  HotelOpsTask,
  HotelOpsTaskStatus,
  HotelOpsTrendAlert,
  RiskLevel,
} from '@/types/hotel-ops'
import type { NavigationRoute } from '@/types/navigation'

type HotelOpsTab = 'chat' | 'approvals' | 'tasks' | 'intelligence' | 'settings'

const tabRoutes: Record<HotelOpsTab, NavigationRoute> = {
  chat: 'ops-chat',
  approvals: 'ops-approvals',
  tasks: 'ops-tasks',
  intelligence: 'ops-intelligence',
  settings: 'ops-settings',
}

const routeTabs: Partial<Record<NavigationRoute, HotelOpsTab>> = {
  'ops-chat': 'chat',
  'ops-approvals': 'approvals',
  'ops-tasks': 'tasks',
  'ops-intelligence': 'intelligence',
  'ops-settings': 'settings',
}

const exampleCommands = [
  'Check bookings for next weekend.',
  'Change Agoda Deluxe Room to 2,200 THB this Friday and Saturday.',
  'Raise Booking price to 3000.',
]
const serverModeRequiredMessage = 'Hotel Ops command execution requires server API mode. Enable VITE_PMS_API_MODE=server with the PMS backend and database migrations applied.'

function riskTone(risk?: RiskLevel) {
  if (risk === 'FORBIDDEN' || risk === 'CRITICAL') return 'destructive'
  if (risk === 'HIGH') return 'default'
  if (risk === 'MEDIUM') return 'secondary'
  return 'outline'
}

function statusTone(status?: HotelOpsTaskStatus) {
  if (status === 'SUCCEEDED') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (status === 'FAILED' || status === 'DENIED' || status === 'CANCELLED') return 'bg-red-50 text-red-700 border-red-200'
  if (status === 'PENDING_APPROVAL' || status === 'NEEDS_HUMAN') return 'bg-amber-50 text-amber-800 border-amber-200'
  if (status === 'RUNNING' || status === 'QUEUED' || status === 'APPROVED') return 'bg-blue-50 text-blue-700 border-blue-200'
  return 'bg-slate-50 text-slate-700 border-slate-200'
}

function notificationTone(notification: HotelOpsNotification) {
  if (notification.type === 'NEEDS_HUMAN' || notification.type === 'EMERGENCY_STOP') return 'border-red-200 bg-red-50 text-red-800'
  if (notification.type === 'APPROVAL_REQUEST' || notification.status === 'PENDING_PROVIDER') return 'border-amber-200 bg-amber-50 text-amber-900'
  if (notification.type === 'TREND_ALERT') return 'border-blue-200 bg-blue-50 text-blue-800'
  return 'border-emerald-200 bg-emerald-50 text-emerald-800'
}

function formatDateRange(task: Pick<HotelOpsTask, 'dateRange'>) {
  const start = task.dateRange?.start
  const end = task.dateRange?.end
  if (!start && !end) return 'Dates not set'
  if (start === end) return start
  return [start, end].filter(Boolean).join(' to ')
}

function formatTaskSummary(task: HotelOpsTask) {
  const parts = [
    task.platform !== 'unknown' ? task.platform : null,
    task.roomType,
    formatDateRange(task),
    task.rate?.amount ? `${task.rate.amount.toLocaleString()} ${task.rate.currency}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : task.rationale
}

function TaskCard({
  task,
  onApprove,
  onDeny,
  onCancel,
  onRun,
  compact = false,
}: {
  task: HotelOpsTask
  onApprove?: (task: HotelOpsTask) => void
  onDeny?: (task: HotelOpsTask) => void
  onCancel?: (task: HotelOpsTask) => void
  onRun?: (task: HotelOpsTask) => void
  compact?: boolean
}) {
  return (
    <Card className="rounded-lg">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={riskTone(task.riskLevel)}>{task.riskLevel}</Badge>
              <span className={`rounded border px-2 py-0.5 text-xs font-medium ${statusTone(task.status)}`}>{task.status.replace(/_/g, ' ')}</span>
              {task.approvalRequired && <Badge variant="outline">Approval required</Badge>}
            </div>
            <div className="text-sm font-semibold">{task.taskType.replace(/_/g, ' ')}</div>
            <p className="text-sm text-muted-foreground">{formatTaskSummary(task)}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {task.status === 'PENDING_APPROVAL' && onApprove && (
              <Button size="sm" onClick={() => onApprove(task)}>
                <CheckCircle className="mr-2" />
                Approve
              </Button>
            )}
            {task.status === 'PENDING_APPROVAL' && onDeny && (
              <Button size="sm" variant="outline" onClick={() => onDeny(task)}>
                <XCircle className="mr-2" />
                Deny
              </Button>
            )}
            {['QUEUED', 'APPROVED'].includes(task.status) && onRun && (
              <Button size="sm" onClick={() => onRun(task)}>
                <PlayCircle className="mr-2" />
                Run
              </Button>
            )}
            {['DRAFT', 'PENDING_APPROVAL', 'QUEUED', 'APPROVED'].includes(task.status) && onCancel && (
              <Button size="sm" variant="ghost" onClick={() => onCancel(task)}>
                Cancel
              </Button>
            )}
          </div>
        </div>

        {!compact && (
          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
            <div>Requester: <span className="text-foreground">{task.requesterLabel || task.requesterUserId}</span></div>
            <div>Confidence: <span className="text-foreground">{Math.round(task.confidence * 100)}%</span></div>
            <div>Created: <span className="text-foreground">{new Date(task.createdAt).toLocaleString()}</span></div>
            <div>Proof: <span className="text-foreground">{task.proofScreenshots?.length || 0} item(s)</span></div>
          </div>
        )}

        {task.missingFields.length > 0 && (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Needs details: {task.missingFields.join(', ')}
          </div>
        )}

        {task.executionSummary && (
          <div className="rounded border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {task.executionSummary}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function HotelOpsCommandCenterView({ tab: routeTab }: { tab?: HotelOpsTab }) {
  const { currentRoute, navigate } = useNavigation()
  const activeTab = routeTab || routeTabs[currentRoute] || 'chat'
  const [command, setCommand] = useState(exampleCommands[0])
  const [commandResult, setCommandResult] = useState<HotelOpsCommandResult | null>(null)
  const [tasks, setTasks] = useState<HotelOpsTask[]>([])
  const [approvals, setApprovals] = useState<HotelOpsApproval[]>([])
  const [notifications, setNotifications] = useState<HotelOpsNotification[]>([])
  const [alerts, setAlerts] = useState<HotelOpsTrendAlert[]>([])
  const [emergencyStop, setEmergencyStop] = useState<HotelOpsEmergencyStop | null>(null)
  const [otaStatus, setOtaStatus] = useState<HotelOpsOtaStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pendingApprovalTasks = useMemo(
    () => approvals.map((approval) => approval.task).filter(Boolean) as HotelOpsTask[],
    [approvals],
  )

  const refresh = async () => {
    if (!SERVER_AUTH_ENABLED) {
      setError(serverModeRequiredMessage)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [tasksPayload, approvalsPayload, notificationsPayload, alertsPayload, stopPayload, otaPayload] = await Promise.all([
        hotelOpsApi.listTasks({ limit: 80 }),
        hotelOpsApi.listApprovals(),
        hotelOpsApi.listNotifications({ limit: 20 }),
        hotelOpsApi.listAlerts({ limit: 50 }),
        hotelOpsApi.getEmergencyStop(),
        hotelOpsApi.getOtaStatus(),
      ])
      setTasks(tasksPayload.data)
      setApprovals(approvalsPayload.data)
      setNotifications(notificationsPayload.data)
      setAlerts(alertsPayload.data)
      setEmergencyStop(stopPayload.data)
      setOtaStatus(otaPayload.data)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Hotel Ops backend is not available.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const submitCommand = async () => {
    if (!command.trim()) {
      toast.error('Enter a Hotel Ops command.')
      return
    }
    if (!SERVER_AUTH_ENABLED) {
      setError(serverModeRequiredMessage)
      toast.error('Hotel Ops backend is not connected.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const payload = await hotelOpsApi.submitCommand(command)
      setCommandResult(payload.data)
      toast.success(payload.message || 'Command accepted.')
      await refresh()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not submit command.'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const approveTask = async (task: HotelOpsTask) => {
    if (!SERVER_AUTH_ENABLED) {
      toast.error('Hotel Ops backend is not connected.')
      return
    }
    try {
      const payload = await hotelOpsApi.approveTask(task.id)
      toast.success(payload.message || 'Task approved.')
      await refresh()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not approve task.')
    }
  }

  const denyTask = async (task: HotelOpsTask) => {
    if (!SERVER_AUTH_ENABLED) {
      toast.error('Hotel Ops backend is not connected.')
      return
    }
    const reason = window.prompt('Reason for denial?')?.trim()
    if (!reason) return
    try {
      const payload = await hotelOpsApi.denyTask(task.id, reason)
      toast.success(payload.message || 'Task denied.')
      await refresh()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not deny task.')
    }
  }

  const cancelTask = async (task: HotelOpsTask) => {
    if (!SERVER_AUTH_ENABLED) {
      toast.error('Hotel Ops backend is not connected.')
      return
    }
    const reason = window.prompt('Reason for cancellation?')?.trim()
    if (!reason) return
    try {
      const payload = await hotelOpsApi.cancelTask(task.id, reason)
      toast.success(payload.message || 'Task cancelled.')
      await refresh()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not cancel task.')
    }
  }

  const runTask = async (task: HotelOpsTask) => {
    if (!SERVER_AUTH_ENABLED) {
      toast.error('Hotel Ops backend is not connected.')
      return
    }
    try {
      const payload = await hotelOpsApi.runTask(task.id)
      toast.success(payload.message || 'Queued task ran.')
      await refresh()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not run queued task.')
    }
  }

  const runScan = async (force?: 'high-demand' | 'low-demand' | 'cancellation-spike' | 'weekend-spike') => {
    if (!SERVER_AUTH_ENABLED) {
      toast.error('Hotel Ops backend is not connected.')
      return
    }
    setLoading(true)
    try {
      const payload = await hotelOpsApi.runScan(force)
      toast.success(payload.message || `Created ${payload.data.length} alert(s).`)
      await refresh()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not run scan.')
    } finally {
      setLoading(false)
    }
  }

  const approveRecommendation = async (alert: HotelOpsTrendAlert) => {
    if (!SERVER_AUTH_ENABLED) {
      toast.error('Hotel Ops backend is not connected.')
      return
    }
    try {
      const payload = await hotelOpsApi.approveRecommendation(alert.id)
      toast.success(payload.message || 'Recommendation queued.')
      setCommandResult(payload.data)
      await refresh()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not approve recommendation.')
    }
  }

  const toggleEmergencyStop = async (enabled: boolean) => {
    if (!SERVER_AUTH_ENABLED) {
      toast.error('Hotel Ops backend is not connected.')
      return
    }
    const reason = window.prompt(enabled ? 'Reason for enabling emergency stop?' : 'Reason for disabling emergency stop?')?.trim()
    if (!reason) return
    try {
      const payload = await hotelOpsApi.setEmergencyStop(enabled, reason)
      setEmergencyStop(payload.data)
      toast.success(payload.message || 'Emergency stop updated.')
      await refresh()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not update emergency stop.')
    }
  }

  return (
    <div className="min-h-full bg-slate-50/70">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Hotel Ops Command Center</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Controlled command intake, approvals, signed dry-run execution, trend alerts, and emergency stop for manager-led operations.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
              <ArrowClockwise className="mr-2" />
              Refresh
            </Button>
            <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${emergencyStop?.enabled ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
              {emergencyStop?.enabled ? <PauseCircle /> : <PlayCircle />}
              {emergencyStop?.enabled ? 'Emergency stop on' : 'Writes allowed'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {Object.entries(tabRoutes).map(([tab, route]) => (
            <Button
              key={tab}
              variant={activeTab === tab ? 'default' : 'outline'}
              size="sm"
              onClick={() => navigate(route)}
            >
              {tab === 'chat' ? 'Chat' : tab === 'approvals' ? 'Approvals' : tab === 'tasks' ? 'Tasks' : tab === 'intelligence' ? 'Intelligence' : 'Settings'}
            </Button>
          ))}
        </div>

        {error && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="flex gap-3 p-4 text-sm text-amber-900">
              <Warning className="mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold">Hotel Ops backend connection needed</div>
                <div>{error}</div>
              </div>
            </CardContent>
          </Card>
        )}

        {notifications.length > 0 && (
          <Card className="rounded-lg">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Ops Notifications</CardTitle>
              <CardDescription>In-app notices and email provider intents generated by task and intelligence lifecycle events.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-2">
              {notifications.slice(0, 6).map((notification) => (
                <div key={notification.id} className={`rounded border px-3 py-2 text-sm ${notificationTone(notification)}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{notification.title}</span>
                    <Badge variant="outline">{notification.channel.replace(/_/g, ' ')}</Badge>
                    <Badge variant="outline">{notification.status.replace(/_/g, ' ')}</Badge>
                  </div>
                  <p className="mt-1 text-xs opacity-90">{notification.summary}</p>
                  <div className="mt-1 text-[11px] opacity-75">
                    {new Date(notification.createdAt).toLocaleString()}
                    {notification.recipientAddress ? ` - ${notification.recipientAddress}` : ''}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {activeTab === 'chat' && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg"><Brain /> Manager Command</CardTitle>
                <CardDescription>Submit a plain-language instruction. The backend parses, risk-scores, logs, and either executes dry-run read tasks or requests approval.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  className="min-h-32"
                  placeholder="Example: Change Agoda Deluxe Room to 2,200 THB this Friday and Saturday."
                />
                <div className="flex flex-wrap gap-2">
                  {exampleCommands.map((example) => (
                    <Button key={example} variant="outline" size="sm" onClick={() => setCommand(example)}>
                      {example}
                    </Button>
                  ))}
                </div>
                <Button onClick={submitCommand} disabled={loading}>
                  Parse & Submit
                </Button>
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle className="text-lg">Parsed Preview</CardTitle>
                <CardDescription>Latest backend decision for the submitted command.</CardDescription>
              </CardHeader>
              <CardContent>
                {commandResult ? (
                  <div className="space-y-3 text-sm">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={riskTone(commandResult.parsed.riskLevel)}>{commandResult.parsed.riskLevel}</Badge>
                      <Badge variant={commandResult.decision.allowed ? 'secondary' : 'destructive'}>{commandResult.decision.allowed ? 'Allowed' : 'Blocked'}</Badge>
                      {commandResult.decision.approvalRequired && <Badge variant="outline">Approval required</Badge>}
                    </div>
                    <div className="font-semibold">{commandResult.parsed.taskType.replace(/_/g, ' ')}</div>
                    <div className="text-muted-foreground">{commandResult.decision.reason}</div>
                    <TaskCard task={commandResult.task} compact onApprove={approveTask} onDeny={denyTask} onCancel={cancelTask} onRun={runTask} />
                  </div>
                ) : (
                  <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Submit a command to see the parsed task and permission decision.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'approvals' && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Pending Approvals</h2>
              <Badge variant="outline">{pendingApprovalTasks.length} pending</Badge>
            </div>
            {pendingApprovalTasks.length === 0 ? (
              <Card className="rounded-lg"><CardContent className="p-8 text-center text-sm text-muted-foreground">No Hotel Ops tasks need approval.</CardContent></Card>
            ) : (
              pendingApprovalTasks.map((task) => <TaskCard key={task.id} task={task} onApprove={approveTask} onDeny={denyTask} onCancel={cancelTask} onRun={runTask} />)
            )}
          </section>
        )}

        {activeTab === 'tasks' && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Task History</h2>
              <Badge variant="outline">{tasks.length} tasks</Badge>
            </div>
            {tasks.length === 0 ? (
              <Card className="rounded-lg"><CardContent className="p-8 text-center text-sm text-muted-foreground">No Hotel Ops tasks recorded yet.</CardContent></Card>
            ) : (
              tasks.map((task) => <TaskCard key={task.id} task={task} onApprove={approveTask} onDeny={denyTask} onCancel={cancelTask} onRun={runTask} />)
            )}
          </section>
        )}

        {activeTab === 'intelligence' && (
          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Booking Intelligence</h2>
                <p className="text-sm text-muted-foreground">Trend alerts create recommendations; recommendations become approval-gated tasks.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void runScan()} disabled={loading}>Run Scan</Button>
                <Button variant="outline" onClick={() => void runScan('high-demand')} disabled={loading}>High-demand Demo</Button>
                <Button variant="outline" onClick={() => void runScan('low-demand')} disabled={loading}>Low-demand Demo</Button>
              </div>
            </div>
            {alerts.length === 0 ? (
              <Card className="rounded-lg"><CardContent className="p-8 text-center text-sm text-muted-foreground">No trend alerts yet. Run a scan to create the first booking intelligence alert.</CardContent></Card>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {alerts.map((alert) => (
                  <Card key={alert.id} className="rounded-lg">
                    <CardContent className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant={riskTone(alert.severity as RiskLevel)}>{alert.severity}</Badge>
                            <Badge variant="outline">{alert.alertType.replace(/_/g, ' ')}</Badge>
                          </div>
                          <h3 className="mt-2 font-semibold">{alert.title}</h3>
                          <p className="mt-1 text-sm text-muted-foreground">{alert.summary}</p>
                        </div>
                        {alert.recommendedAction && alert.status !== 'RECOMMENDATION_APPROVED' && (
                          <Button size="sm" onClick={() => void approveRecommendation(alert)}>
                            Queue Recommendation
                          </Button>
                        )}
                      </div>
                      {alert.recommendedAction && (
                        <div className="rounded border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                          Recommendation: {alert.recommendedAction.taskType.replace(/_/g, ' ')} · {alert.recommendedAction.roomType || 'room type pending'}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === 'settings' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg"><ShieldWarning /> Emergency Stop</CardTitle>
                <CardDescription>Blocks Hotel Ops write tasks before approval, queueing, and worker execution.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <Label htmlFor="ops-emergency-stop">Block write tasks</Label>
                    <p className="text-sm text-muted-foreground">{emergencyStop?.reason || 'No active reason recorded.'}</p>
                  </div>
                  <Switch id="ops-emergency-stop" checked={Boolean(emergencyStop?.enabled)} onCheckedChange={(checked) => void toggleEmergencyStop(checked)} />
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg"><ClipboardText /> OTA Worker Status</CardTitle>
                <CardDescription>Signed worker boundary, dry-run adapter readiness, and platform-specific OTA implementation status.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={otaStatus?.dryRun ? 'secondary' : 'destructive'}>{otaStatus?.dryRun ? 'Dry-run on' : 'Dry-run off'}</Badge>
                  <Badge variant={otaStatus?.workerConfigured ? 'secondary' : 'outline'}>{otaStatus?.workerConfigured ? 'Worker configured' : 'Mock worker only'}</Badge>
                  <Badge variant={otaStatus?.workerSecretConfigured ? 'secondary' : 'outline'}>{otaStatus?.workerSecretConfigured ? 'Signing secret set' : 'Signing secret missing'}</Badge>
                </div>
                <div className="grid gap-2">
                  {otaStatus?.platforms?.map((platform) => (
                    <div key={platform.platform} className="rounded border px-3 py-2 text-sm">
                      <div className="font-medium capitalize">{platform.platform}</div>
                      <div className="text-xs text-muted-foreground">{platform.message || platform.status}</div>
                    </div>
                  )) || <div className="text-sm text-muted-foreground">OTA status unavailable.</div>}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
