import { useMemo, useState, type ReactNode } from 'react'
import type { Icon } from '@phosphor-icons/react'
import { Broom, CheckCircle, ClipboardText, Eye, FunnelSimple, Hammer, Sparkle, Warning } from '@phosphor-icons/react'
import { useKV } from '@github/spark/hooks'
import type { BoardRoomCard } from '@/types/board'
import type { CleanStatus } from '@/types/housekeeping'
import type { PropertySetup } from '@/types/onboarding'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusPill } from '@/components/ui/status-pill'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useRoomSync } from '@/hooks/use-room-sync'
import { useHousekeepingServer } from '@/hooks/use-housekeeping-server'
import { useAuth } from '@/hooks/use-auth'
import { createAuditRecord, type AuditRecord } from '@/lib/hotel/operations'
import { housekeepingApi, type HousekeepingIssueStatus, type HousekeepingTaskStatus, type ServerHousekeepingIssue, type ServerHousekeepingTask } from '@/lib/housekeeping-api-client'
import { formatBangkokTime, useI18n } from '@/lib/i18n'
import { SERVER_API_ENABLED } from '@/lib/pms-api-client'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

type HousekeepingFilter = 'ALL' | 'DIRTY' | 'CLEANING' | 'CLEAN' | 'INSPECTED' | 'PRIORITY'

function getHousekeepingStatus(room: BoardRoomCard): 'DIRTY' | 'CLEANING' | 'CLEAN' | 'INSPECTED' | 'MAINTENANCE' {
  if (room.operationalStatus === 'OUT_OF_ORDER' || room.hasIssue) return 'MAINTENANCE'
  if (room.housekeepingStatus === 'CLEANING') return 'CLEANING'
  return room.cleanStatus
}

function getRoomPriority(room: BoardRoomCard) {
  if (room.operationalStatus === 'OUT_OF_ORDER' || room.hasIssue) return 95
  if (room.isDepartureToday && room.isArrivalToday) return 90
  if (room.isArrivalToday && room.cleanStatus !== 'INSPECTED') return 80
  if (room.isDepartureToday) return 70
  if (room.cleanStatus === 'DIRTY') return 60
  if (room.housekeepingStatus === 'CLEANING') return 50
  return 10
}

function getContextLabel(room: BoardRoomCard, t: ReturnType<typeof useI18n>['t']) {
  if (room.isDepartureToday && room.isArrivalToday) return `${t('housekeeping.departureToday')} / ${t('housekeeping.arrivalToday')}`
  if (room.isArrivalToday) return t('housekeeping.arrivalToday')
  if (room.isDepartureToday) return t('housekeeping.departureToday')
  if (room.guestName) return t('housekeeping.stayover')
  return t('housekeeping.vacant')
}

function getNextHousekeepingAction(room: BoardRoomCard, t: ReturnType<typeof useI18n>['t']) {
  const status = getHousekeepingStatus(room)
  if (status === 'MAINTENANCE') return t('housekeeping.maintenance')
  if (status === 'DIRTY') return t('housekeeping.startCleaning')
  if (status === 'CLEANING') return t('housekeeping.markClean')
  if (status === 'CLEAN') return t('housekeeping.inspect')
  return t('common.ready')
}

function sortRoomsForHousekeeping(a: BoardRoomCard, b: BoardRoomCard) {
  const priorityDiff = getRoomPriority(b) - getRoomPriority(a)
  return priorityDiff !== 0 ? priorityDiff : Number(a.number) - Number(b.number)
}

export function HousekeepingBoardView() {
  return SERVER_API_ENABLED ? <ServerHousekeepingBoardView /> : <DemoHousekeepingBoardView />
}

function DemoHousekeepingBoardView() {
  const { rooms, updateRoomStatus, setRooms } = useRoomSync()
  const [auditRecords, setAuditRecords] = useKV<AuditRecord[]>('audit-records', [])
  const [propertyData] = useKV<PropertySetup>('onboarding-property', {} as PropertySetup)

  const addAudit = (record: AuditRecord) => {
    setAuditRecords((current) => [record, ...(current || [])].slice(0, 200))
  }

  const updateStatus = (room: BoardRoomCard, status: CleanStatus | 'MAINTENANCE') => {
    if (status === 'MAINTENANCE') {
      setRooms((current) => current.map((currentRoom) => currentRoom.roomId === room.roomId
        ? {
            ...currentRoom,
            operationalStatus: 'OUT_OF_ORDER',
            housekeepingStatus: 'MAINTENANCE',
            hasIssue: true,
            lastUpdatedAt: new Date().toISOString(),
            lastUpdatedBy: 'Housekeeping',
          }
        : currentRoom))
      addAudit(createAuditRecord('housekeeping', room.roomId, 'MAINTENANCE', `Room ${room.number} marked for maintenance.`, 'Housekeeping'))
      toast.success(`Room ${room.number} marked for maintenance.`)
      return
    }

    updateRoomStatus({
      roomId: room.roomId,
      cleanStatus: status,
      lastCleaned: status === 'CLEAN' || status === 'INSPECTED' ? new Date() : room.lastCleaned,
      cleanedBy: 'Housekeeping',
    })

    addAudit(createAuditRecord('housekeeping', room.roomId, status, `Room ${room.number} marked ${status.toLowerCase()}.`, 'Housekeeping'))
    toast.success(`Room ${room.number} marked ${status.toLowerCase()}.`)
  }

  return (
    <HousekeepingBoardContent
      rooms={rooms}
      propertyName={propertyData?.name || 'Hotel'}
      auditMessage={auditRecords.length > 0 ? auditRecords[0].message : undefined}
      onUpdateStatus={updateStatus}
    />
  )
}

function ServerHousekeepingBoardView() {
  const { user } = useAuth()
  const { snapshot, loading, error, pendingAction, run } = useHousekeepingServer(true)
  const canManageAssignments = user?.role === 'admin' || user?.role === 'manager'
  const canWorkQueue = canManageAssignments || user?.role === 'housekeeping'

  const act = async (actionId: string, action: () => Promise<unknown>, success: string) => {
    try {
      await run(actionId, action)
      toast.success(success)
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : 'The housekeeping action failed.')
    }
  }

  const updateStatus = (room: BoardRoomCard, status: CleanStatus | 'MAINTENANCE') => {
    void act(
      `room:${room.roomId}`,
      () => housekeepingApi.updateRoomStatus(room.roomId, status, `Housekeeping board changed room ${room.number} to ${status}.`),
      `Room ${room.number} marked ${status.toLowerCase()}.`,
    )
  }

  const createTask = (room: BoardRoomCard) => {
    const kind = getHousekeepingStatus(room) === 'CLEAN' ? 'INSPECTION' : room.isDepartureToday ? 'TURNOVER' : 'CLEANING'
    const priority = getRoomPriority(room) >= 80 ? 'HIGH' : 'NORMAL'
    void act(
      `create-task:${room.roomId}`,
      () => housekeepingApi.createTask({
        roomId: room.roomId,
        kind,
        priority,
        title: `${kind === 'INSPECTION' ? 'Inspect' : 'Service'} room ${room.number}`,
        description: room.guestName ? `Guest context recorded for room ${room.number}.` : `Vacant room ${room.number}.`,
        reason: `Housekeeping board task for room ${room.number}.`,
      }),
      `Task created for room ${room.number}.`,
    )
  }

  const createMaintenanceIssue = (room: BoardRoomCard) => {
    void act(
      `issue:${room.roomId}`,
      async () => {
        await housekeepingApi.createIssue({
          roomId: room.roomId,
          category: 'MAINTENANCE',
          severity: 'HIGH',
          title: `Maintenance review for room ${room.number}`,
          description: 'Housekeeping reported that this room requires maintenance review.',
          reason: `Housekeeping escalated room ${room.number} for maintenance.`,
        })
        try {
          await housekeepingApi.updateRoomStatus(room.roomId, 'MAINTENANCE', 'Housekeeping maintenance issue reported.')
        } catch (statusError) {
          throw new Error(`The maintenance issue was saved, but the room could not be blocked: ${statusError instanceof Error ? statusError.message : 'status update failed'}`)
        }
      },
      `Maintenance issue created for room ${room.number}.`,
    )
  }

  const transitionTask = (task: ServerHousekeepingTask, status: HousekeepingTaskStatus) => {
    void act(
      `task:${task.id}`,
      () => housekeepingApi.transitionTask(task.id, status, `Housekeeping board moved task to ${status}.`),
      `Task marked ${status.toLowerCase().replace('_', ' ')}.`,
    )
  }

  const transitionIssue = (issue: ServerHousekeepingIssue, status: HousekeepingIssueStatus) => {
    void act(
      `issue:${issue.id}`,
      () => housekeepingApi.transitionIssue(issue.id, status, `Housekeeping board moved issue to ${status}.`),
      `Issue marked ${status.toLowerCase().replace('_', ' ')}.`,
    )
  }

  const assignToMe = (task: ServerHousekeepingTask) => {
    if (!user) return
    void act(
      `task:${task.id}`,
      () => housekeepingApi.assignTask(task.id, user.id, `Assigned to ${user.displayName} from the housekeeping board.`),
      `Task assigned to ${user.displayName}.`,
    )
  }

  return (
    <HousekeepingBoardContent
      rooms={snapshot.rooms}
      propertyName={snapshot.propertyName}
      error={error}
      loading={loading}
      pendingAction={pendingAction}
      onUpdateStatus={updateStatus}
      onCreateTask={createTask}
      onCreateMaintenanceIssue={createMaintenanceIssue}
      footer={(
        <ServerWorkPanels
          rooms={snapshot.rooms}
          tasks={snapshot.tasks}
          issues={snapshot.issues}
          pendingAction={pendingAction}
          canManageAssignments={canManageAssignments}
          canWorkQueue={canWorkQueue}
          onAssignToMe={assignToMe}
          onTransitionTask={transitionTask}
          onTransitionIssue={transitionIssue}
        />
      )}
    />
  )
}

interface ServerWorkPanelsProps {
  rooms: BoardRoomCard[]
  tasks: ServerHousekeepingTask[]
  issues: ServerHousekeepingIssue[]
  pendingAction: string | null
  canManageAssignments: boolean
  canWorkQueue: boolean
  onAssignToMe: (task: ServerHousekeepingTask) => void
  onTransitionTask: (task: ServerHousekeepingTask, status: HousekeepingTaskStatus) => void
  onTransitionIssue: (issue: ServerHousekeepingIssue, status: HousekeepingIssueStatus) => void
}

function ServerWorkPanels({ rooms, tasks, issues, pendingAction, canManageAssignments, canWorkQueue, onAssignToMe, onTransitionTask, onTransitionIssue }: ServerWorkPanelsProps) {
  const activeTasks = tasks.filter((task) => task.status !== 'DONE' && task.status !== 'CANCELLED')
  const activeIssues = issues.filter((issue) => issue.status !== 'CLOSED')
  const roomNumbers = new Map(rooms.map((room) => [room.roomId, room.number]))

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="rounded-lg bg-white py-0 shadow-sm">
        <CardContent className="space-y-3 p-4">
          <div>
            <h2 className="font-semibold">Persistent task queue</h2>
            <p className="text-xs text-muted-foreground">Assignments and progress are recorded by the PMS and survive reload.</p>
          </div>
          {activeTasks.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No active housekeeping tasks.</div>
          ) : activeTasks.map((task) => {
            const pending = pendingAction === `task:${task.id}`
            const assignee = task.assignedTo ? `${task.assignedTo.firstName} ${task.assignedTo.lastName}`.trim() : 'Unassigned'
            return (
              <div key={task.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">Room {task.room?.number || task.roomId} · {task.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{task.priority} · {task.status.replace('_', ' ')} · {assignee}</div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {canManageAssignments && !task.assignedToUserId && (
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => onAssignToMe(task)}>Assign to me</Button>
                    )}
                    {canWorkQueue && ['OPEN', 'ASSIGNED', 'BLOCKED'].includes(task.status) && (
                      <Button size="sm" disabled={pending} onClick={() => onTransitionTask(task, 'IN_PROGRESS')}>{task.status === 'BLOCKED' ? 'Resume' : 'Start'}</Button>
                    )}
                    {canWorkQueue && task.status === 'IN_PROGRESS' && (
                      <>
                        <Button size="sm" disabled={pending} onClick={() => onTransitionTask(task, 'DONE')}>Complete</Button>
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => onTransitionTask(task, 'BLOCKED')}>Block</Button>
                      </>
                    )}
                    {canWorkQueue && !['DONE', 'CANCELLED'].includes(task.status) && (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => onTransitionTask(task, 'CANCELLED')}>Cancel</Button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card className="rounded-lg bg-white py-0 shadow-sm">
        <CardContent className="space-y-3 p-4">
          <div>
            <h2 className="font-semibold">Issues and maintenance escalation</h2>
            <p className="text-xs text-muted-foreground">Reported issues remain visible until an authorized staff member closes them.</p>
          </div>
          {activeIssues.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No open housekeeping issues.</div>
          ) : activeIssues.map((issue) => {
            const pending = pendingAction === `issue:${issue.id}`
            return (
              <div key={issue.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">Room {roomNumbers.get(issue.roomId) || issue.roomId} · {issue.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{issue.severity} · {issue.category} · {issue.status.replace('_', ' ')}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{issue.description}</div>
                  </div>
                  {canWorkQueue && (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {issue.status === 'OPEN' && <Button size="sm" variant="outline" disabled={pending} onClick={() => onTransitionIssue(issue, 'ACKNOWLEDGED')}>Acknowledge</Button>}
                      {['OPEN', 'ACKNOWLEDGED'].includes(issue.status) && <Button size="sm" disabled={pending} onClick={() => onTransitionIssue(issue, 'IN_PROGRESS')}>Start</Button>}
                      {issue.status === 'IN_PROGRESS' && (issue.severity !== 'CRITICAL' || canManageAssignments) && <Button size="sm" disabled={pending} onClick={() => onTransitionIssue(issue, 'RESOLVED')}>Resolve</Button>}
                      {issue.status === 'RESOLVED' && (issue.severity !== 'CRITICAL' || canManageAssignments) && <Button size="sm" disabled={pending} onClick={() => onTransitionIssue(issue, 'CLOSED')}>Close</Button>}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}

interface HousekeepingBoardContentProps {
  rooms: BoardRoomCard[]
  propertyName: string
  auditMessage?: string
  error?: string | null
  loading?: boolean
  pendingAction?: string | null
  onUpdateStatus: (room: BoardRoomCard, status: CleanStatus | 'MAINTENANCE') => void
  onCreateTask?: (room: BoardRoomCard) => void
  onCreateMaintenanceIssue?: (room: BoardRoomCard) => void
  footer?: ReactNode
}

function HousekeepingBoardContent({ rooms: operationalRooms, propertyName, auditMessage, error, loading, pendingAction, onUpdateStatus, onCreateTask, onCreateMaintenanceIssue, footer }: HousekeepingBoardContentProps) {
  const { t, language } = useI18n()
  const [filter, setFilter] = useState<HousekeepingFilter>('ALL')

  const counts = useMemo(() => ({
    dirty: operationalRooms.filter((room) => getHousekeepingStatus(room) === 'DIRTY').length,
    cleaning: operationalRooms.filter((room) => getHousekeepingStatus(room) === 'CLEANING').length,
    clean: operationalRooms.filter((room) => getHousekeepingStatus(room) === 'CLEAN').length,
    inspected: operationalRooms.filter((room) => getHousekeepingStatus(room) === 'INSPECTED').length,
    priority: operationalRooms.filter((room) => getRoomPriority(room) >= 70).length,
  }), [operationalRooms])

  const filteredRooms = useMemo(() => {
    return operationalRooms
      .filter((room) => {
        const status = getHousekeepingStatus(room)
        if (filter === 'ALL') return true
        if (filter === 'PRIORITY') return getRoomPriority(room) >= 70
        return status === filter
      })
      .sort(sortRoomsForHousekeeping)
  }, [filter, operationalRooms])

  return (
    <div className="min-h-full bg-[#f7f4ef]">
      <section className="border-b bg-white">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#9a6535]">
              <Broom size={15} weight="bold" />
              {propertyName}
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t('housekeeping.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('housekeeping.subtitle')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FilterButton active={filter === 'ALL'} onClick={() => setFilter('ALL')} label="All" />
            <FilterButton active={filter === 'PRIORITY'} onClick={() => setFilter('PRIORITY')} label={`${t('housekeeping.priority')} ${counts.priority}`} />
            <FilterButton active={filter === 'DIRTY'} onClick={() => setFilter('DIRTY')} label={`${t('rooms.dirty')} ${counts.dirty}`} />
            <FilterButton active={filter === 'CLEANING'} onClick={() => setFilter('CLEANING')} label={`${t('housekeeping.startCleaning')} ${counts.cleaning}`} />
            <FilterButton active={filter === 'INSPECTED'} onClick={() => setFilter('INSPECTED')} label={`${t('housekeeping.inspect')} ${counts.inspected}`} />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-4 lg:px-6">
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Housekeeping data is not fully synchronized</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading && <div className="rounded-lg border bg-white p-4 text-sm text-muted-foreground">Loading authoritative housekeeping data…</div>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard label={t('rooms.dirty')} value={counts.dirty} icon={Warning} tone="border-orange-100 bg-orange-50 text-orange-700" />
          <SummaryCard label={t('housekeeping.startCleaning')} value={counts.cleaning} icon={Broom} tone="border-cyan-100 bg-cyan-50 text-cyan-700" />
          <SummaryCard label={t('housekeeping.markClean')} value={counts.clean} icon={Sparkle} tone="border-green-100 bg-green-50 text-green-700" />
          <SummaryCard label={t('housekeeping.inspect')} value={counts.inspected} icon={Eye} tone="border-teal-100 bg-teal-50 text-teal-700" />
          <SummaryCard label={t('housekeeping.priority')} value={counts.priority} icon={ClipboardText} tone="border-rose-100 bg-rose-50 text-rose-700" />
        </div>

        <Card className="rounded-lg bg-white py-0 shadow-sm">
          <CardContent className="p-0">
            {filteredRooms.length === 0 ? (
              <EmptyState className="m-4" icon={<FunnelSimple size={32} weight="thin" />} title={t('housekeeping.noRooms')} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="w-[110px]">{t('common.room')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead>{t('housekeeping.guestContext')}</TableHead>
                    <TableHead>{t('housekeeping.priority')}</TableHead>
                    <TableHead>{t('today.lastUpdated')}</TableHead>
                    <TableHead>{t('housekeeping.updatedBy')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRooms.map((room) => {
                    const status = getHousekeepingStatus(room)
                    const priority = getRoomPriority(room)
                    return (
                      <TableRow key={room.roomId} className={cn(priority >= 70 && 'bg-amber-50/40')}>
                        <TableCell>
                          <div className="text-base font-semibold tabular-nums">{room.number}</div>
                          <div className="text-[11px] font-medium uppercase text-muted-foreground">{room.type}</div>
                        </TableCell>
                        <TableCell>
                          <StatusPill group="housekeeping" status={status} />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{getContextLabel(room, t)}</div>
                          <div className="text-xs text-muted-foreground">{room.guestName || t('housekeeping.vacant')}</div>
                          <div className="mt-1 text-xs font-medium text-foreground">Next: {getNextHousekeepingAction(room, t)}</div>
                        </TableCell>
                        <TableCell>
                          <span className={cn('rounded-md px-2 py-1 text-xs font-semibold', priority >= 80 ? 'bg-rose-100 text-rose-800' : priority >= 60 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700')}>
                            {priority >= 80 ? 'High' : priority >= 60 ? 'Normal' : 'Low'}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {room.lastUpdatedAt ? formatBangkokTime(room.lastUpdatedAt, language) : t('common.none')}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {room.lastUpdatedBy || t('common.none')}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1.5">
                            {status === 'DIRTY' && (
                              <Button size="sm" variant="outline" disabled={pendingAction === `room:${room.roomId}`} onClick={() => onUpdateStatus(room, 'CLEANING')}>
                                {t('housekeeping.startCleaning')}
                              </Button>
                            )}
                            {(status === 'DIRTY' || status === 'CLEANING') && (
                              <Button size="sm" disabled={pendingAction === `room:${room.roomId}`} onClick={() => onUpdateStatus(room, 'CLEAN')}>
                                {t('housekeeping.markClean')}
                              </Button>
                            )}
                            {status === 'CLEAN' && (
                              <Button size="sm" disabled={pendingAction === `room:${room.roomId}`} onClick={() => onUpdateStatus(room, 'INSPECTED')}>
                                {t('housekeeping.inspect')}
                              </Button>
                            )}
                            {status !== 'DIRTY' && (
                              <Button size="sm" variant="outline" disabled={pendingAction === `room:${room.roomId}`} onClick={() => onUpdateStatus(room, 'DIRTY')}>
                                {t('housekeeping.markDirty')}
                              </Button>
                            )}
                            {onCreateTask && (
                              <Button size="sm" variant="outline" disabled={pendingAction === `create-task:${room.roomId}`} onClick={() => onCreateTask(room)} aria-label={`Create task for room ${room.number}`}>
                                <ClipboardText size={14} />
                              </Button>
                            )}
                            <Button size="sm" variant="outline" disabled={pendingAction === `issue:${room.roomId}` || pendingAction === `room:${room.roomId}`} onClick={() => onCreateMaintenanceIssue ? onCreateMaintenanceIssue(room) : onUpdateStatus(room, 'MAINTENANCE')} aria-label={t('housekeeping.maintenance')}>
                              <Hammer size={14} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {footer}

        <div className="text-xs text-muted-foreground">
          {auditMessage ? `${t('reservation.timeline')}: ${auditMessage}` : t('common.taxInclusive')}
        </div>
      </div>
    </div>
  )
}

function FilterButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <Button
      size="sm"
      variant={active ? 'default' : 'outline'}
      onClick={onClick}
      className="h-8"
    >
      {label}
    </Button>
  )
}

function SummaryCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: Icon; tone: string }) {
  return (
    <Card className="rounded-lg bg-white py-0">
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <div className="text-xs font-semibold text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        </div>
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-md border', tone)}>
          <Icon size={20} weight="duotone" />
        </div>
      </CardContent>
    </Card>
  )
}
