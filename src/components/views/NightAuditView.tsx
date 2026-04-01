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
import { toast } from 'sonner'
import { format, addDays } from 'date-fns'

const AUDIT_STEPS = [
  { id: 'rollover-date', name: 'Rollover System Date', description: 'Advance system date to next day' },
  { id: 'post-charges', name: 'Post Room Charges', description: 'Apply nightly room charges to all occupied rooms' },
  { id: 'process-no-shows', name: 'Process No-Shows', description: 'Mark expected arrivals as no-show if not checked in' },
  { id: 'calculate-occupancy', name: 'Calculate Occupancy', description: 'Calculate occupancy rates and room statistics' },
  { id: 'reconcile-payments', name: 'Reconcile Payments', description: 'Verify payments and outstanding balances' },
  { id: 'backup-data', name: 'Backup Data', description: 'Create system backup' },
  { id: 'generate-reports', name: 'Generate Reports', description: 'Create daily operational reports' },
  { id: 'close-shift', name: 'Close Shift', description: 'Finalize shift and prepare for next day' },
]

export function NightAuditView() {
  const [auditLogs, setAuditLogs] = useKV<NightAuditLog[]>('night-audit-logs', [])
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

  const latestAudit = auditLogs[0]

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
      statistics: {
        date: new Date(),
        occupancy: {
          totalRooms: 30,
          occupiedRooms: 0,
          availableRooms: 0,
          outOfServiceRooms: 0,
          occupancyRate: 0,
        },
        revenue: {
          roomRevenue: 0,
          extraGuestRevenue: 0,
          serviceRevenue: 0,
          totalRevenue: 0,
        },
        arrivals: {
          expected: 0,
          actual: 0,
          noShows: 0,
          walkIns: 0,
        },
        departures: {
          expected: 0,
          actual: 0,
          stayOvers: 0,
          earlyCheckouts: 0,
          lateCheckouts: 0,
        },
        housekeeping: {
          cleanedRooms: 0,
          dirtyRooms: 0,
          inspectedRooms: 0,
          maintenanceRooms: 0,
        },
        payments: {
          cashReceived: 0,
          cardReceived: 0,
          transferReceived: 0,
          totalReceived: 0,
          outstandingBalance: 0,
        },
      },
      errors: [],
    }

    setCurrentAudit(audit)

    for (let i = 0; i < audit.steps.length; i++) {
      const step = audit.steps[i]
      step.status = 'IN_PROGRESS'
      step.startedAt = new Date()
      
      setCurrentAudit({ ...audit })

      await new Promise(resolve => setTimeout(resolve, 1500))

      step.status = 'COMPLETED'
      step.completedAt = new Date()
      step.duration = step.completedAt.getTime() - step.startedAt.getTime()
      
      setCurrentAudit({ ...audit })
    }

    audit.status = 'COMPLETED'
    audit.completedAt = new Date()
    audit.statistics = {
      ...audit.statistics,
      occupancy: {
        totalRooms: 30,
        occupiedRooms: 18,
        availableRooms: 10,
        outOfServiceRooms: 2,
        occupancyRate: 60,
      },
      revenue: {
        roomRevenue: 42500,
        extraGuestRevenue: 1500,
        serviceRevenue: 3200,
        totalRevenue: 47200,
      },
      arrivals: {
        expected: 8,
        actual: 7,
        noShows: 1,
        walkIns: 2,
      },
      departures: {
        expected: 6,
        actual: 5,
        stayOvers: 12,
        earlyCheckouts: 0,
        lateCheckouts: 1,
      },
      housekeeping: {
        cleanedRooms: 25,
        dirtyRooms: 3,
        inspectedRooms: 25,
        maintenanceRooms: 0,
      },
      payments: {
        cashReceived: 12500,
        cardReceived: 28400,
        transferReceived: 6300,
        totalReceived: 47200,
        outstandingBalance: 2500,
      },
    }

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
