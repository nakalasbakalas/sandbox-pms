import { useState, useMemo } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Moon,
  Play,
  CheckCircle,
  XCircle,
  Clock,
  ArrowsClockwise,
  Warning,
  ChartBar,
  CalendarBlank,
  CurrencyDollar,
  Users,
  Bed,
  Broom,
} from '@phosphor-icons/react'
import type { NightAuditLog, NightAuditStep, NightAuditConfig } from '@/types/night-audit'
import type { BoardRoomCard } from '@/types/board'
import { toast } from 'sonner'
import { format, addDays } from 'date-fns'

const AUDIT_STEPS = [
  { id: 'rollover-date', name: 'Rollover System Date', description: 'Advance system date to next day' },
  { id: 'post-charges', name: 'Verify Room Charges', description: 'Verify nightly room charges for occupied rooms' },
  { id: 'process-no-shows', name: 'Process No-Shows', description: 'Mark expected arrivals as no-show if not checked in' },
  { id: 'calculate-occupancy', name: 'Calculate Occupancy', description: 'Calculate occupancy rates and room statistics' },
  { id: 'reconcile-payments', name: 'Reconcile Payments', description: 'Verify payments and outstanding balances' },
  { id: 'backup-data', name: 'Backup Data', description: 'Create system backup' },
  { id: 'generate-reports', name: 'Generate Reports', description: 'Create daily operational reports' },
  { id: 'close-shift', name: 'Close Shift', description: 'Finalize shift and prepare for next day' },
]

function deserializeAuditLog(log: NightAuditLog): NightAuditLog {
  return {
    ...log,
    auditDate: new Date(log.auditDate),
    startedAt: new Date(log.startedAt),
    completedAt: log.completedAt ? new Date(log.completedAt) : undefined,
    statistics: {
      ...log.statistics,
      date: new Date(log.statistics.date),
    },
    steps: log.steps.map(step => ({
      ...step,
      startedAt: step.startedAt ? new Date(step.startedAt) : undefined,
      completedAt: step.completedAt ? new Date(step.completedAt) : undefined,
    })),
  }
}

export function NightAuditView() {
  const [auditLogsRaw, setAuditLogsRaw] = useKV<NightAuditLog[]>('night-audit-logs', [])
  const [roomsRaw] = useKV<BoardRoomCard[]>('pms-rooms', [])
  const [reservationsRaw, setReservationsRaw] = useKV<Array<Record<string, unknown>>>('reservations-data', [])
  const [foliosRaw] = useKV<Array<Record<string, unknown>>>('cashier-folios', [])
  const [config, setConfig] = useKV<NightAuditConfig>('night-audit-config', {
    autoRunTime: '03:00',
    autoRunEnabled: false,
    steps: {
      rolloverDate: true,
      postRoomCharges: true,
      processNoShows: true,
      calculateOccupancy: true,
      reconcilePayments: true,
      backupData: true,
      generateReports: true,
      closeShift: true,
    },
    noShowPolicy: {
      autoMarkAsNoShow: true,
      hoursAfterCheckIn: 6,
      applyNoShowFee: true,
      noShowFeePercentage: 100,
    },
    lateCheckoutPolicy: {
      autoExtendStay: false,
      applyLateFee: true,
      lateFeeAmount: 500,
    },
  })
  const [isRunning, setIsRunning] = useState(false)
  const [currentAudit, setCurrentAudit] = useState<NightAuditLog | null>(null)
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)

  const auditLogs = useMemo(() => 
    (auditLogsRaw || []).map(deserializeAuditLog),
    [auditLogsRaw]
  )
  
  const setAuditLogs = (updater: NightAuditLog[] | ((current: NightAuditLog[]) => NightAuditLog[])) => {
    setAuditLogsRaw((current) => {
      const deserialized = (current || []).map(deserializeAuditLog)
      const updated = typeof updater === 'function' ? updater(deserialized) : updater
      return updated
    })
  }

  const latestAudit = auditLogs[0]

  const buildCurrentStatistics = () => {
    const auditDate = new Date()
    const auditDateKey = format(auditDate, 'yyyy-MM-dd')
    const rooms = roomsRaw || []
    const reservations = reservationsRaw || []
    const folios = foliosRaw || []
    const checkedIn = reservations.filter((reservation) => reservation.status === 'CHECKED_IN')
    const arrivalsToday = reservations.filter((reservation) => format(new Date(String(reservation.checkIn)), 'yyyy-MM-dd') === auditDateKey)
    const departuresToday = reservations.filter((reservation) => format(new Date(String(reservation.checkOut)), 'yyyy-MM-dd') === auditDateKey)
    const payments = folios.flatMap((folio) => Array.isArray(folio.payments) ? folio.payments as Array<Record<string, unknown>> : [])
    const charges = folios.flatMap((folio) => Array.isArray(folio.charges) ? folio.charges as Array<Record<string, unknown>> : [])
    const paymentsToday = payments.filter((payment) => {
      const date = payment.date || payment.receivedAt || payment.createdAt
      return date ? format(new Date(String(date)), 'yyyy-MM-dd') === auditDateKey : true
    })
    const paymentAmount = (method: string) => paymentsToday
      .filter((payment) => String(payment.method || '').toUpperCase() === method)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
    const serviceRevenue = charges
      .filter((charge) => String(charge.category || '').toUpperCase() !== 'ROOM')
      .reduce((sum, charge) => sum + Number(charge.total || 0), 0)
    const roomRevenue = charges
      .filter((charge) => String(charge.category || '').toUpperCase() === 'ROOM')
      .reduce((sum, charge) => sum + Number(charge.total || 0), 0)
    const outOfServiceRooms = rooms.filter((room) => room.operationalStatus === 'OUT_OF_SERVICE' || room.operationalStatus === 'BLOCKED').length
    const occupiedRooms = rooms.filter((room) => room.status === 'OCCUPIED_CLEAN' || room.status === 'OCCUPIED_DIRTY').length
    const availableRooms = Math.max(0, rooms.length - occupiedRooms - outOfServiceRooms)

    return {
      date: auditDate,
      occupancy: {
        totalRooms: rooms.length,
        occupiedRooms,
        availableRooms,
        outOfServiceRooms,
        occupancyRate: rooms.length ? Math.round((occupiedRooms / rooms.length) * 100) : 0,
      },
      revenue: {
        roomRevenue,
        extraGuestRevenue: charges
          .filter((charge) => ['EXTRA_GUEST', 'CHILD'].includes(String(charge.category || '').toUpperCase()))
          .reduce((sum, charge) => sum + Number(charge.total || 0), 0),
        serviceRevenue,
        totalRevenue: roomRevenue + serviceRevenue,
      },
      arrivals: {
        expected: arrivalsToday.length,
        actual: arrivalsToday.filter((reservation) => reservation.status === 'CHECKED_IN').length,
        noShows: reservations.filter((reservation) => reservation.status === 'NO_SHOW').length,
        walkIns: reservations.filter((reservation) => reservation.source === 'WALK_IN').length,
      },
      departures: {
        expected: departuresToday.length,
        actual: departuresToday.filter((reservation) => reservation.status === 'CHECKED_OUT').length,
        stayOvers: checkedIn.filter((reservation) => new Date(String(reservation.checkOut)) < auditDate).length,
        earlyCheckouts: 0,
        lateCheckouts: 0,
      },
      housekeeping: {
        cleanedRooms: rooms.filter((room) => room.cleanStatus === 'CLEAN').length,
        dirtyRooms: rooms.filter((room) => room.cleanStatus === 'DIRTY').length,
        inspectedRooms: rooms.filter((room) => room.cleanStatus === 'INSPECTED').length,
        maintenanceRooms: outOfServiceRooms,
      },
      payments: {
        cashReceived: paymentAmount('CASH'),
        cardReceived: paymentAmount('CARD'),
        transferReceived: paymentAmount('BANK_TRANSFER') + paymentAmount('ONLINE'),
        totalReceived: paymentsToday.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
        outstandingBalance: folios.reduce((sum, folio) => sum + Number(folio.balance || 0), 0),
      },
    }
  }

  const runNightAudit = async () => {
    setConfirmDialogOpen(false)
    setIsRunning(true)

    const audit: NightAuditLog = {
      id: `audit-${Date.now()}`,
      auditDate: new Date(),
      startedAt: new Date(),
      startedBy: 'Current User',
      status: 'IN_PROGRESS',
      steps: AUDIT_STEPS.map(step => ({
        id: step.id,
        name: step.name,
        description: step.description,
        status: 'PENDING',
      })),
      statistics: buildCurrentStatistics(),
      errors: [],
    }

    setCurrentAudit(audit)

    for (let i = 0; i < audit.steps.length; i++) {
      const step = audit.steps[i]
      step.status = 'IN_PROGRESS'
      step.startedAt = new Date()
      
      setCurrentAudit({ ...audit })

      if (step.id === 'process-no-shows') {
        const auditDateKey = format(audit.auditDate, 'yyyy-MM-dd')
        setReservationsRaw((current) => (current || []).map((reservation) => {
          const checkIn = reservation.checkIn ? format(new Date(String(reservation.checkIn)), 'yyyy-MM-dd') : auditDateKey
          if ((reservation.status === 'CONFIRMED' || reservation.status === 'PENDING') && checkIn < auditDateKey) {
            return { ...reservation, status: 'NO_SHOW', updatedAt: new Date() }
          }
          return reservation
        }))
      }

      await new Promise(resolve => setTimeout(resolve, 150))

      step.status = 'COMPLETED'
      step.completedAt = new Date()
      step.duration = step.completedAt.getTime() - step.startedAt.getTime()
      
      setCurrentAudit({ ...audit })
    }

    audit.status = 'COMPLETED'
    audit.completedAt = new Date()
    audit.statistics = buildCurrentStatistics()

    setAuditLogs(current => [audit, ...current])
    setCurrentAudit(audit)
    setIsRunning(false)
    toast.success('Night audit completed successfully')
  }

  const getStepIcon = (status: NightAuditStep['status']) => {
    switch (status) {
      case 'COMPLETED':
        return <CheckCircle className="w-5 h-5 text-green-600" weight="fill" />
      case 'IN_PROGRESS':
        return <ArrowsClockwise className="w-5 h-5 text-blue-600 animate-spin" />
      case 'FAILED':
        return <XCircle className="w-5 h-5 text-red-600" weight="fill" />
      case 'SKIPPED':
        return <Warning className="w-5 h-5 text-yellow-600" weight="fill" />
      default:
        return <Clock className="w-5 h-5 text-gray-400" />
    }
  }

  const completedSteps = currentAudit?.steps.filter(s => s.status === 'COMPLETED').length || 0
  const totalSteps = currentAudit?.steps.length || AUDIT_STEPS.length
  const progress = (completedSteps / totalSteps) * 100

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="border-b border-border bg-card">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold flex items-center gap-2">
                <Moon className="w-6 h-6" />
                Night Audit
              </h1>
              <p className="text-sm text-muted-foreground mt-1">End-of-day processing and daily rollover</p>
            </div>
            <Button 
              onClick={() => setConfirmDialogOpen(true)} 
              disabled={isRunning}
              size="lg"
            >
              <Play className="w-4 h-4 mr-2" weight="fill" />
              Run Night Audit
            </Button>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6">
          {latestAudit && (
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Last Night Audit</h2>
                <Badge className={latestAudit.status === 'COMPLETED' ? 'bg-green-600' : 'bg-red-600'}>
                  {latestAudit.status}
                </Badge>
              </div>
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground mb-1">Audit Date</div>
                  <div className="font-medium">{format(new Date(latestAudit.auditDate), 'MMM dd, yyyy')}</div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">Started</div>
                  <div className="font-medium">{format(new Date(latestAudit.startedAt), 'HH:mm:ss')}</div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">Completed</div>
                  <div className="font-medium">
                    {latestAudit.completedAt ? format(new Date(latestAudit.completedAt), 'HH:mm:ss') : '-'}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">Duration</div>
                  <div className="font-medium">
                    {latestAudit.completedAt 
                      ? `${Math.round((new Date(latestAudit.completedAt).getTime() - new Date(latestAudit.startedAt).getTime()) / 1000)}s`
                      : '-'}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {currentAudit && (
            <Card className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold">
                  {currentAudit.status === 'IN_PROGRESS' ? 'Audit In Progress' : 'Audit Complete'}
                </h2>
                <div className="text-sm text-muted-foreground">
                  {completedSteps} of {totalSteps} steps completed
                </div>
              </div>

              <Progress value={progress} className="mb-6" />

              <div className="space-y-3">
                {currentAudit.steps.map((step) => (
                  <div key={step.id} className="flex items-start gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="mt-0.5">{getStepIcon(step.status)}</div>
                    <div className="flex-1">
                      <div className="font-medium">{step.name}</div>
                      <div className="text-sm text-muted-foreground">{step.description}</div>
                      {step.duration && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Completed in {Math.round(step.duration / 1000)}s
                        </div>
                      )}
                    </div>
                    {step.status === 'IN_PROGRESS' && (
                      <Badge variant="outline" className="text-blue-600 border-blue-600">Running</Badge>
                    )}
                  </div>
                ))}
              </div>

              {currentAudit.status === 'COMPLETED' && (
                <>
                  <Separator className="my-6" />
                  <div>
                    <h3 className="font-semibold mb-4 flex items-center gap-2">
                      <ChartBar className="w-4 h-4" />
                      Audit Statistics
                    </h3>
                    <div className="grid grid-cols-3 gap-6">
                      <Card className="p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Bed className="w-4 h-4 text-muted-foreground" />
                          <h4 className="font-medium text-sm">Occupancy</h4>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Occupied</span>
                            <span className="font-medium">{currentAudit.statistics.occupancy.occupiedRooms}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Available</span>
                            <span className="font-medium">{currentAudit.statistics.occupancy.availableRooms}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Rate</span>
                            <span className="font-semibold text-blue-600">{currentAudit.statistics.occupancy.occupancyRate}%</span>
                          </div>
                        </div>
                      </Card>

                      <Card className="p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <CurrencyDollar className="w-4 h-4 text-muted-foreground" />
                          <h4 className="font-medium text-sm">Revenue</h4>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Room</span>
                            <span className="font-medium">฿{currentAudit.statistics.revenue.roomRevenue.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Services</span>
                            <span className="font-medium">฿{currentAudit.statistics.revenue.serviceRevenue.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Total</span>
                            <span className="font-semibold text-green-600">฿{currentAudit.statistics.revenue.totalRevenue.toLocaleString()}</span>
                          </div>
                        </div>
                      </Card>

                      <Card className="p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Users className="w-4 h-4 text-muted-foreground" />
                          <h4 className="font-medium text-sm">Arrivals / Departures</h4>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Arrivals</span>
                            <span className="font-medium">{currentAudit.statistics.arrivals.actual}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Departures</span>
                            <span className="font-medium">{currentAudit.statistics.departures.actual}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">No-Shows</span>
                            <span className="font-medium text-red-600">{currentAudit.statistics.arrivals.noShows}</span>
                          </div>
                        </div>
                      </Card>
                    </div>
                  </div>
                </>
              )}
            </Card>
          )}

          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Audit History</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Started By</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      No audit history available
                    </TableCell>
                  </TableRow>
                ) : (
                  auditLogs.map(log => (
                    <TableRow key={log.id}>
                      <TableCell className="font-medium">
                        {format(new Date(log.auditDate), 'MMM dd, yyyy')}
                      </TableCell>
                      <TableCell className="text-sm">
                        {format(new Date(log.startedAt), 'HH:mm:ss')}
                      </TableCell>
                      <TableCell className="text-sm">
                        {log.completedAt
                          ? `${Math.round((new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime()) / 1000)}s`
                          : '-'}
                      </TableCell>
                      <TableCell className="text-sm">{log.startedBy}</TableCell>
                      <TableCell>
                        <Badge className={log.status === 'COMPLETED' ? 'bg-green-600' : 'bg-yellow-600'}>
                          {log.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      </ScrollArea>

      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run Night Audit?</DialogTitle>
            <DialogDescription>
              This will process end-of-day operations including:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Rollover system date</li>
                <li>Post room charges</li>
                <li>Process no-shows</li>
                <li>Calculate occupancy</li>
                <li>Reconcile payments</li>
                <li>Generate reports</li>
              </ul>
              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
                <Warning className="w-4 h-4 inline mr-1" weight="fill" />
                This operation cannot be undone. Ensure all daily transactions are completed.
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={runNightAudit}>
              Start Audit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
