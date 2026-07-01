import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowClockwise,
  ArrowSquareOut,
  Brain,
  CheckCircle,
  ClipboardText,
  Copy,
  PauseCircle,
  PlayCircle,
  ShieldWarning,
  Warning,
  XCircle,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useNavigation } from '@/hooks/use-navigation'
import { SERVER_AUTH_ENABLED } from '@/lib/auth-mode'
import { hotelOpsApi } from '@/lib/hotel-ops-api-client'
import type { HotelOpsScanForce } from '@/lib/hotel-ops-api-client'
import { createHotelOpsCommandIdempotencyKey } from '@/lib/hotel-ops-idempotency'
import type {
  HotelOpsApproval,
  HotelOpsCommandResult,
  HotelOpsEmergencyStop,
  HotelOpsNotification,
  HotelOpsOtaStatus,
  HotelOpsPolicy,
  HotelOpsTaskPolicyRule,
  HotelOpsTaskType,
  HotelOpsTask,
  HotelOpsTaskStatus,
  HotelOpsTrendAlert,
  RiskLevel,
} from '@/types/hotel-ops'
import type { NavigationRoute } from '@/types/navigation'

type HotelOpsTab = 'chat' | 'approvals' | 'tasks' | 'intelligence' | 'settings'
type PendingReasonAction =
  | { kind: 'approve-task'; task: HotelOpsTask }
  | { kind: 'deny-task'; task: HotelOpsTask }
  | { kind: 'cancel-task'; task: HotelOpsTask }
  | { kind: 'approve-recommendation'; alert: HotelOpsTrendAlert }
  | { kind: 'resolve-alert'; alert: HotelOpsTrendAlert }
  | { kind: 'emergency-stop'; enabled: boolean }

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

function formatOpsLabel(value: string) {
  return value.replace(/_/g, ' ')
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
  return parts.length > 0 ? parts.join(' - ') : task.rationale
}

function formatPercentValue(value?: number) {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : 'Not set'
}

function formatDateTimeValue(value?: string | null) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString()
}

function numericMetric(alert: HotelOpsTrendAlert, key: string) {
  const value = alert.metrics?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringMetric(alert: HotelOpsTrendAlert, key: string) {
  const value = alert.metrics?.[key]
  return typeof value === 'string' ? value : null
}

function roomTypeMetric(alert: HotelOpsTrendAlert, key: string) {
  const value = alert.metrics?.[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const metric = value as Record<string, unknown>
  const occupancy = metric.occupancy
  const activeReservations = metric.activeReservations
  const sellableRooms = metric.sellableRooms
  return {
    roomType: typeof metric.roomType === 'string' ? metric.roomType : null,
    occupancy: typeof occupancy === 'number' && Number.isFinite(occupancy) ? occupancy : null,
    activeReservations: typeof activeReservations === 'number' && Number.isFinite(activeReservations) ? activeReservations : null,
    sellableRooms: typeof sellableRooms === 'number' && Number.isFinite(sellableRooms) ? sellableRooms : null,
  }
}

function policyRuleEntries(policy: HotelOpsPolicy | null) {
  if (!policy?.taskRules) return [] as Array<[HotelOpsTaskType, HotelOpsTaskPolicyRule]>
  return Object.entries(policy.taskRules) as Array<[HotelOpsTaskType, HotelOpsTaskPolicyRule]>
}

function canOpenProofUrl(url: string) {
  return /^https?:\/\//i.test(url)
}

function reasonActionCopy(action: PendingReasonAction | null) {
  if (!action) {
    return {
      title: 'Record reason',
      description: 'This action requires an audit reason.',
      placeholder: 'Record the operational reason...',
      confirmLabel: 'Submit',
      destructive: false,
    }
  }
  if (action.kind === 'approve-task') {
    return {
      title: 'Approve Hotel Ops task',
      description: `${action.task.taskType.replace(/_/g, ' ')} will be queued for signed dry-run worker execution. Record why this change is approved.`,
      placeholder: 'Example: Owner approved weekend rate change after pickup review.',
      confirmLabel: 'Approve task',
      destructive: false,
    }
  }
  if (action.kind === 'deny-task') {
    return {
      title: 'Deny Hotel Ops task',
      description: `${action.task.taskType.replace(/_/g, ' ')} will be closed without worker execution. Record why this approval is being denied.`,
      placeholder: 'Example: Rate change is not approved for this date range.',
      confirmLabel: 'Deny task',
      destructive: true,
    }
  }
  if (action.kind === 'cancel-task') {
    return {
      title: 'Cancel Hotel Ops task',
      description: `${action.task.taskType.replace(/_/g, ' ')} will be cancelled before completion. Record why staff should not continue this task.`,
      placeholder: 'Example: Duplicate request; newer task replaces this one.',
      confirmLabel: 'Cancel task',
      destructive: true,
    }
  }
  if (action.kind === 'approve-recommendation') {
    return {
      title: 'Queue recommendation',
      description: `${action.alert.title} will create a new approval-gated Hotel Ops task. Record why this recommendation should enter the task queue.`,
      placeholder: 'Example: Pickup trend reviewed; prepare a rate task for owner approval.',
      confirmLabel: 'Queue recommendation',
      destructive: false,
    }
  }
  if (action.kind === 'resolve-alert') {
    return {
      title: 'Resolve intelligence alert',
      description: `${action.alert.title} will leave the active alert queue. Record what changed or what action was taken.`,
      placeholder: 'Example: Rates reviewed and no change needed.',
      confirmLabel: 'Resolve alert',
      destructive: false,
    }
  }
  return {
    title: action.enabled ? 'Enable emergency stop' : 'Disable emergency stop',
    description: action.enabled
      ? 'Hotel Ops write tasks will be blocked until this is disabled. Record the operational reason.'
      : 'Hotel Ops write tasks can be reviewed and queued again. Record why it is safe to resume.',
    placeholder: action.enabled ? 'Example: OTA rates are being reconciled manually.' : 'Example: OTA checks complete; normal approvals may resume.',
    confirmLabel: action.enabled ? 'Enable stop' : 'Disable stop',
    destructive: action.enabled,
  }
}

async function copyProofUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url)
    toast.success('Proof reference copied.')
  } catch {
    toast.error('Could not copy proof reference.')
  }
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

        {!compact && task.proofScreenshots && task.proofScreenshots.length > 0 && (
          <div className="space-y-2 rounded border bg-background px-3 py-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Proof Artifacts</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {task.proofScreenshots.map((proof, index) => (
                <div key={proof.id || `${proof.kind}-${index}`} className="rounded border bg-muted/30 px-2 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{proof.kind}</Badge>
                    <Badge variant={proof.redactionStatus === 'FAILED' ? 'destructive' : 'secondary'}>{proof.redactionStatus}</Badge>
                  </div>
                  <div className="mt-1 truncate text-muted-foreground" title={proof.storageUrl}>{proof.storageUrl}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">{new Date(proof.capturedAt).toLocaleString()}</span>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void copyProofUrl(proof.storageUrl)}>
                      <Copy className="mr-1" />
                      Copy
                    </Button>
                    {canOpenProofUrl(proof.storageUrl) && (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild>
                        <a href={proof.storageUrl} target="_blank" rel="noreferrer">
                          <ArrowSquareOut className="mr-1" />
                          Open
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!compact && task.logs && task.logs.length > 0 && (
          <div className="space-y-2 rounded border bg-background px-3 py-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Activity Timeline</div>
            <div className="space-y-2">
              {task.logs.slice(0, 6).map((log) => (
                <div key={log.id} className="rounded border bg-muted/30 px-2 py-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge variant="outline">{log.action.replace(/_/g, ' ')}</Badge>
                    <span className="text-[11px] text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{log.message}</p>
                  <div className="mt-1 text-[11px] text-muted-foreground">Actor: {log.actor || 'system'}</div>
                </div>
              ))}
            </div>
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
  const [commandIdempotencyKey, setCommandIdempotencyKey] = useState(() => createHotelOpsCommandIdempotencyKey(exampleCommands[0]))
  const [commandResult, setCommandResult] = useState<HotelOpsCommandResult | null>(null)
  const [tasks, setTasks] = useState<HotelOpsTask[]>([])
  const [approvals, setApprovals] = useState<HotelOpsApproval[]>([])
  const [notifications, setNotifications] = useState<HotelOpsNotification[]>([])
  const [alerts, setAlerts] = useState<HotelOpsTrendAlert[]>([])
  const [emergencyStop, setEmergencyStop] = useState<HotelOpsEmergencyStop | null>(null)
  const [otaStatus, setOtaStatus] = useState<HotelOpsOtaStatus | null>(null)
  const [opsPolicy, setOpsPolicy] = useState<HotelOpsPolicy | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingReasonAction, setPendingReasonAction] = useState<PendingReasonAction | null>(null)
  const [reasonText, setReasonText] = useState('')
  const [reasonSubmitting, setReasonSubmitting] = useState(false)

  const pendingApprovalTasks = useMemo(
    () => approvals.map((approval) => approval.task).filter(Boolean) as HotelOpsTask[],
    [approvals],
  )
  const pendingReasonCopy = useMemo(() => reasonActionCopy(pendingReasonAction), [pendingReasonAction])

  const refresh = async () => {
    if (!SERVER_AUTH_ENABLED) {
      setError(serverModeRequiredMessage)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [tasksPayload, approvalsPayload, notificationsPayload, alertsPayload, stopPayload, otaPayload, policyPayload] = await Promise.all([
        hotelOpsApi.listTasks({ limit: 80 }),
        hotelOpsApi.listApprovals(),
        hotelOpsApi.listNotifications({ limit: 20 }),
        hotelOpsApi.listAlerts({ limit: 50 }),
        hotelOpsApi.getEmergencyStop(),
        hotelOpsApi.getOtaStatus(),
        hotelOpsApi.getPolicy(),
      ])
      setTasks(tasksPayload.data)
      setApprovals(approvalsPayload.data)
      setNotifications(notificationsPayload.data)
      setAlerts(alertsPayload.data)
      setEmergencyStop(stopPayload.data)
      setOtaStatus(otaPayload.data)
      setOpsPolicy(policyPayload.data)
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

  const updateCommandDraft = (value: string) => {
    setCommand(value)
    setCommandIdempotencyKey(createHotelOpsCommandIdempotencyKey(value))
  }

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
      const payload = await hotelOpsApi.submitCommand(command, 'web', commandIdempotencyKey)
      setCommandResult(payload.data)
      toast.success(payload.data.duplicate ? 'Duplicate command returned existing task.' : payload.message || 'Command accepted.')
      setCommandIdempotencyKey(createHotelOpsCommandIdempotencyKey(command))
      await refresh()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not submit command.'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const approveTask = (task: HotelOpsTask) => {
    if (!SERVER_AUTH_ENABLED) {
      toast.error('Hotel Ops backend is not connected.')
      return
    }
    setPendingReasonAction({ kind: 'approve-task', task })
    setReasonText('')
  }

  const denyTask = async (task: HotelOpsTask) => {
    if (!SERVER_AUTH_ENABLED) {
      toast.error('Hotel Ops backend is not connected.')
      return
    }
    setPendingReasonAction({ kind: 'deny-task', task })
    setReasonText('')
  }

  const cancelTask = async (task: HotelOpsTask) => {
    if (!SERVER_AUTH_ENABLED) {
      toast.error('Hotel Ops backend is not connected.')
      return
    }
    setPendingReasonAction({ kind: 'cancel-task', task })
    setReasonText('')
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

  const runScan = async (force?: HotelOpsScanForce) => {
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
    setPendingReasonAction({ kind: 'approve-recommendation', alert })
    setReasonText('')
  }

  const acknowledgeAlert = async (alert: HotelOpsTrendAlert) => {
    if (!SERVER_AUTH_ENABLED) {
      toast.error('Hotel Ops backend is not connected.')
      return
    }
    try {
      const payload = await hotelOpsApi.acknowledgeAlert(alert.id)
      toast.success(payload.message || 'Alert acknowledged.')
      await refresh()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not acknowledge alert.')
    }
  }

  const resolveAlert = async (alert: HotelOpsTrendAlert) => {
    if (!SERVER_AUTH_ENABLED) {
      toast.error('Hotel Ops backend is not connected.')
      return
    }
    setPendingReasonAction({ kind: 'resolve-alert', alert })
    setReasonText('')
  }

  const toggleEmergencyStop = async (enabled: boolean) => {
    if (!SERVER_AUTH_ENABLED) {
      toast.error('Hotel Ops backend is not connected.')
      return
    }
    setPendingReasonAction({ kind: 'emergency-stop', enabled })
    setReasonText('')
  }

  const closeReasonDialog = () => {
    if (reasonSubmitting) return
    setPendingReasonAction(null)
    setReasonText('')
  }

  const submitReasonAction = async () => {
    if (!pendingReasonAction) return
    const reason = reasonText.trim()
    if (!reason) {
      toast.error('Record a reason before continuing.')
      return
    }
    setReasonSubmitting(true)
    try {
      if (pendingReasonAction.kind === 'approve-task') {
        const payload = await hotelOpsApi.approveTask(pendingReasonAction.task.id, reason)
        toast.success(payload.message || 'Task approved.')
      } else if (pendingReasonAction.kind === 'deny-task') {
        const payload = await hotelOpsApi.denyTask(pendingReasonAction.task.id, reason)
        toast.success(payload.message || 'Task denied.')
      } else if (pendingReasonAction.kind === 'cancel-task') {
        const payload = await hotelOpsApi.cancelTask(pendingReasonAction.task.id, reason)
        toast.success(payload.message || 'Task cancelled.')
      } else if (pendingReasonAction.kind === 'approve-recommendation') {
        const payload = await hotelOpsApi.approveRecommendation(pendingReasonAction.alert.id, reason)
        toast.success(payload.message || 'Recommendation queued.')
        setCommandResult(payload.data)
      } else if (pendingReasonAction.kind === 'resolve-alert') {
        const payload = await hotelOpsApi.resolveAlert(pendingReasonAction.alert.id, reason)
        toast.success(payload.message || 'Alert resolved.')
      } else {
        const payload = await hotelOpsApi.setEmergencyStop(pendingReasonAction.enabled, reason)
        setEmergencyStop(payload.data)
        toast.success(payload.message || 'Emergency stop updated.')
      }
      setPendingReasonAction(null)
      setReasonText('')
      await refresh()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not complete Hotel Ops action.')
    } finally {
      setReasonSubmitting(false)
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
                  onChange={(event) => updateCommandDraft(event.target.value)}
                  className="min-h-32"
                  placeholder="Example: Change Agoda Deluxe Room to 2,200 THB this Friday and Saturday."
                />
                <div className="flex flex-wrap gap-2">
                  {exampleCommands.map((example) => (
                    <Button key={example} variant="outline" size="sm" onClick={() => updateCommandDraft(example)}>
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
                      {commandResult.duplicate && <Badge variant="outline">Duplicate replay</Badge>}
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
                <Button variant="outline" onClick={() => void runScan('room-imbalance')} disabled={loading}>Room Imbalance Demo</Button>
                <Button variant="outline" onClick={() => void runScan('ota-imbalance')} disabled={loading}>OTA Imbalance Demo</Button>
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
                            <Badge variant={alert.status === 'RESOLVED' ? 'secondary' : 'outline'}>{(alert.status || 'CREATED').replace(/_/g, ' ')}</Badge>
                          </div>
                          <h3 className="mt-2 font-semibold">{alert.title}</h3>
                          <p className="mt-1 text-sm text-muted-foreground">{alert.summary}</p>
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-2">
                          {alert.status === 'CREATED' && (
                            <Button size="sm" variant="outline" onClick={() => void acknowledgeAlert(alert)}>
                              Acknowledge
                            </Button>
                          )}
                          {alert.recommendedAction && alert.status !== 'RECOMMENDATION_APPROVED' && alert.status !== 'RESOLVED' && (
                            <Button size="sm" onClick={() => void approveRecommendation(alert)}>
                              Queue Recommendation
                            </Button>
                          )}
                          {alert.status !== 'RESOLVED' && (
                            <Button size="sm" variant="ghost" onClick={() => void resolveAlert(alert)}>
                              Resolve
                            </Button>
                          )}
                        </div>
                      </div>
                      {alert.recommendedAction && (
                        <div className="rounded border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                          Recommendation: {alert.recommendedAction.taskType.replace(/_/g, ' ')} - {alert.recommendedAction.roomType || 'room type pending'}
                        </div>
                      )}
                      {alert.alertType === 'ROOM_IMBALANCE' && (
                        <div className="grid gap-2 rounded border bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:grid-cols-2">
                          {(() => {
                            const strongest = roomTypeMetric(alert, 'strongestRoomType')
                            const weakest = roomTypeMetric(alert, 'weakestRoomType')
                            return (
                              <>
                                <div>
                                  <span className="font-medium text-foreground">Strong room type</span>
                                  <div>{strongest?.roomType || alert.roomType || 'Not set'}</div>
                                  <div>{formatPercentValue(strongest?.occupancy ?? undefined)} occupancy</div>
                                  <div>{strongest?.activeReservations ?? 0} of {strongest?.sellableRooms ?? 0} rooms</div>
                                </div>
                                <div>
                                  <span className="font-medium text-foreground">Weak room type</span>
                                  <div>{weakest?.roomType || 'Not set'}</div>
                                  <div>{formatPercentValue(weakest?.occupancy ?? undefined)} occupancy</div>
                                  <div>{weakest?.activeReservations ?? 0} of {weakest?.sellableRooms ?? 0} rooms</div>
                                </div>
                              </>
                            )
                          })()}
                        </div>
                      )}
                      {alert.alertType === 'OTA_IMBALANCE' && (
                        <div className="grid gap-2 rounded border bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:grid-cols-3">
                          <div>
                            <span className="font-medium text-foreground">Dominant platform</span>
                            <div>{stringMetric(alert, 'dominantPlatformLabel') || alert.platform || 'Unknown OTA'}</div>
                          </div>
                          <div>
                            <span className="font-medium text-foreground">OTA share</span>
                            <div>{formatPercentValue(numericMetric(alert, 'dominantShare') ?? undefined)}</div>
                          </div>
                          <div>
                            <span className="font-medium text-foreground">Reservation count</span>
                            <div>{numericMetric(alert, 'dominantReservations') ?? 0} of {numericMetric(alert, 'totalOtaReservations') ?? 0}</div>
                          </div>
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

            <Card className="rounded-lg lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg"><ShieldWarning /> Permission and Approval Policy</CardTitle>
                <CardDescription>Backend-enforced task policy, approval roles, emergency-stop coverage, and MVP execution boundaries.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">Policy {opsPolicy?.version || 'unavailable'}</Badge>
                  <Badge variant={opsPolicy?.defaults.dryRun ? 'secondary' : 'destructive'}>{opsPolicy?.defaults.dryRun ? 'Dry-run required' : 'Dry-run off'}</Badge>
                  <Badge variant="outline">{opsPolicy?.defaults.timezone || 'Asia/Bangkok'}</Badge>
                  <Badge variant="outline">{opsPolicy?.defaults.currency || 'THB'}</Badge>
                </div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {policyRuleEntries(opsPolicy).map(([taskType, rule]) => (
                    <div key={taskType} className="rounded border bg-background px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{formatOpsLabel(taskType)}</span>
                        <Badge variant={riskTone(rule.riskLevel)}>{rule.riskLevel}</Badge>
                        {!rule.enabledInMvp && <Badge variant="destructive">MVP disabled</Badge>}
                        {!rule.execute && <Badge variant="outline">No worker</Badge>}
                      </div>
                      <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                        <div>
                          Approval: <span className="text-foreground">{rule.approvalRequired ? rule.requiredApprovalRole || 'Required' : 'Not required'}</span>
                        </div>
                        <div>
                          Roles: <span className="text-foreground">{rule.allowedRoles.join(', ') || 'None'}</span>
                        </div>
                        {(rule.limits?.minRate || rule.limits?.maxRate || rule.limits?.preventClosingAllRooms) && (
                          <div>
                            Limits:{' '}
                            <span className="text-foreground">
                              {[
                                rule.limits.minRate ? `min ${rule.limits.minRate}` : null,
                                rule.limits.maxRate ? `max ${rule.limits.maxRate}` : null,
                                rule.limits.preventClosingAllRooms ? 'no all-room close' : null,
                              ].filter(Boolean).join(', ')}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {opsPolicy && (
                  <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Emergency stop blocks {opsPolicy.emergencyStop.blockTaskTypes.map(formatOpsLabel).join(', ')} at {opsPolicy.emergencyStop.checkpoints.map(formatOpsLabel).join(', ')}. Read-only work remains allowed.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-lg lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg"><Brain /> Booking Intelligence Policy</CardTitle>
                <CardDescription>Backend scan schedule and thresholds used to create operational trend alerts.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={otaStatus?.scanPolicy?.schedule.configured ? 'secondary' : 'outline'}>
                    {otaStatus?.scanPolicy?.schedule.configured ? 'Schedule configured' : 'Manual or external schedule'}
                  </Badge>
                  <Badge variant="outline">{otaStatus?.scanPolicy?.schedule.mode || 'manual'}</Badge>
                  <Badge variant="outline">{otaStatus?.scanPolicy?.schedule.timezone || 'Asia/Bangkok'}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {otaStatus?.scanPolicy?.schedule.message || 'Scan policy is not available from the backend yet.'}
                </p>
                {otaStatus?.scanPolicy?.scheduler && (
                  <div className="grid gap-2 text-sm md:grid-cols-3">
                    <div className="rounded border px-3 py-2">
                      <div className="font-medium">Scheduler state</div>
                      <div className="text-xs text-muted-foreground">
                        {otaStatus.scanPolicy.scheduler.started ? 'Running in this server process' : otaStatus.scanPolicy.scheduler.enabled ? 'Configured but not started' : 'Not started'}
                      </div>
                    </div>
                    <div className="rounded border px-3 py-2">
                      <div className="font-medium">Last scan</div>
                      <div className="text-xs text-muted-foreground">
                        {otaStatus.scanPolicy.scheduler.status} - {formatDateTimeValue(otaStatus.scanPolicy.scheduler.lastRunAt)}
                      </div>
                    </div>
                    <div className="rounded border px-3 py-2">
                      <div className="font-medium">Next action</div>
                      <div className="text-xs text-muted-foreground">
                        {otaStatus.scanPolicy.scheduler.lastError
                          ? otaStatus.scanPolicy.scheduler.lastError
                          : otaStatus.scanPolicy.scheduler.started
                            ? `Next scan ${formatDateTimeValue(otaStatus.scanPolicy.scheduler.nextRunAt)}`
                            : otaStatus.scanPolicy.scheduler.disabledReason || 'Manual scan only'}
                      </div>
                    </div>
                  </div>
                )}
                {otaStatus?.scanPolicy?.thresholds && (
                  <div className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded border px-3 py-2">
                      <div className="font-medium">Scan horizon</div>
                      <div className="text-xs text-muted-foreground">{otaStatus.scanPolicy.thresholds.horizonDays} day forward window</div>
                    </div>
                    <div className="rounded border px-3 py-2">
                      <div className="font-medium">High demand</div>
                      <div className="text-xs text-muted-foreground">
                        {formatPercentValue(otaStatus.scanPolicy.thresholds.highDemandOccupancy)} occupancy and {otaStatus.scanPolicy.thresholds.highDemandVelocityRatio}x velocity
                      </div>
                    </div>
                    <div className="rounded border px-3 py-2">
                      <div className="font-medium">Low demand</div>
                      <div className="text-xs text-muted-foreground">Below {formatPercentValue(otaStatus.scanPolicy.thresholds.lowDemandOccupancy)} occupancy</div>
                    </div>
                    <div className="rounded border px-3 py-2">
                      <div className="font-medium">Booking velocity</div>
                      <div className="text-xs text-muted-foreground">
                        {otaStatus.scanPolicy.thresholds.bookingVelocityWindowHours}h window over {otaStatus.scanPolicy.thresholds.bookingVelocityBaselineDays}d baseline
                      </div>
                    </div>
                    <div className="rounded border px-3 py-2">
                      <div className="font-medium">Cancellation spike</div>
                      <div className="text-xs text-muted-foreground">
                        {otaStatus.scanPolicy.thresholds.cancellationRecentHours}h count over {otaStatus.scanPolicy.thresholds.cancellationBaselineDays}d baseline x{otaStatus.scanPolicy.thresholds.cancellationSpikeMultiplier}
                      </div>
                    </div>
                    <div className="rounded border px-3 py-2">
                      <div className="font-medium">OTA imbalance</div>
                      <div className="text-xs text-muted-foreground">
                        {otaStatus.scanPolicy.thresholds.otaImbalanceMinimumReservations}+ OTA reservations and {formatPercentValue(otaStatus.scanPolicy.thresholds.otaImbalanceDominanceRatio)} on one platform
                      </div>
                    </div>
                    <div className="rounded border px-3 py-2">
                      <div className="font-medium">Room imbalance</div>
                      <div className="text-xs text-muted-foreground">
                        Strong room type at {formatPercentValue(otaStatus.scanPolicy.thresholds.strongRoomOccupancyMin)} and weak room type at or below {formatPercentValue(otaStatus.scanPolicy.thresholds.weakRoomOccupancyMax)}
                      </div>
                    </div>
                    <div className="rounded border px-3 py-2">
                      <div className="font-medium">Rate recommendation band</div>
                      <div className="text-xs text-muted-foreground">
                        {otaStatus.scanPolicy.thresholds.lowDemandRecommendedRate.toLocaleString()}-{otaStatus.scanPolicy.thresholds.highDemandRecommendedRate.toLocaleString()} {otaStatus.scanPolicy.thresholds.currency}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <Dialog open={Boolean(pendingReasonAction)} onOpenChange={(open) => {
          if (!open) closeReasonDialog()
        }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{pendingReasonCopy.title}</DialogTitle>
              <DialogDescription>{pendingReasonCopy.description}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="hotel-ops-action-reason">Audit reason</Label>
              <Textarea
                id="hotel-ops-action-reason"
                value={reasonText}
                onChange={(event) => setReasonText(event.target.value)}
                placeholder={pendingReasonCopy.placeholder}
                className="min-h-28"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeReasonDialog} disabled={reasonSubmitting}>Keep open</Button>
              <Button
                variant={pendingReasonCopy.destructive ? 'destructive' : 'default'}
                onClick={() => void submitReasonAction()}
                disabled={reasonSubmitting}
              >
                {pendingReasonCopy.confirmLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
