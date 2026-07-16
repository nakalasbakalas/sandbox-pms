import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import {
  ArrowsClockwise,
  CalendarBlank,
  CheckCircle,
  CurrencyDollar,
  Moon,
  Play,
  ShieldWarning,
  Warning,
  XCircle,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/hooks/use-auth'
import { nightAuditApi, type NightAuditBlocker, type NightAuditRun } from '@/lib/night-audit-api-client'

const BLOCKER_LABELS: Record<string, string> = {
  EMERGENCY_STOP: 'Hotel Ops emergency stop is active',
  UNPOSTED_ROOM_CHARGES: 'Occupied stays have unposted room charges',
  UNRESOLVED_ARRIVALS: 'Arrivals remain unresolved',
  UNRESOLVED_DEPARTURES: 'Departures remain unresolved',
  HOUSEKEEPING_BLOCKERS: 'Urgent or blocked housekeeping work remains',
  CRITICAL_HOUSEKEEPING_ISSUES: 'Critical housekeeping issues remain',
}

function todayKey() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

function createIdempotencyKey(businessDate: string) {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `night-audit:${businessDate}:${random}`
}

function formatSatang(value: string) {
  try {
    const satang = BigInt(value)
    const negative = satang < 0n
    const absolute = negative ? -satang : satang
    const baht = absolute / 100n
    const remainder = absolute % 100n
    return `${negative ? '-' : ''}฿${baht.toLocaleString()}.${remainder.toString().padStart(2, '0')}`
  } catch {
    return '—'
  }
}

function blockerLabel(blocker: NightAuditBlocker) {
  return BLOCKER_LABELS[blocker.code] || blocker.code.replaceAll('_', ' ').toLowerCase()
}

function statusBadge(status: NightAuditRun['status']) {
  if (status === 'COMPLETED') return <Badge className="bg-green-600">Completed</Badge>
  if (status === 'BLOCKED') return <Badge variant="destructive">Blocked</Badge>
  if (status === 'FAILED') return <Badge variant="destructive">Failed</Badge>
  return <Badge variant="outline">Running</Badge>
}

export function ServerNightAuditView() {
  const { user, hasPermission } = useAuth()
  const [runs, setRuns] = useState<NightAuditRun[]>([])
  const [selectedRun, setSelectedRun] = useState<NightAuditRun | null>(null)
  const [businessDate, setBusinessDate] = useState(todayKey)
  const [reason, setReason] = useState('')
  const [overrideBlockers, setOverrideBlockers] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canRun = hasPermission('run:night-audit')
  const canOverride = user?.role === 'admin'
  const latestRun = runs[0] || null

  const loadRuns = useCallback(async () => {
    setLoading(true)
    try {
      const response = await nightAuditApi.listRuns()
      setRuns(response.data)
      setSelectedRun((current) => current
        ? response.data.find((run) => run.runId === current.runId) || response.data[0] || null
        : response.data[0] || null)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Night audit history could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRuns()
  }, [loadRuns])

  const submitClose = async () => {
    const trimmedReason = reason.trim()
    const trimmedOverrideReason = overrideReason.trim()
    if (trimmedReason.length < 3) {
      setError('Enter an operational reason before attempting the close.')
      return
    }
    if (overrideBlockers && trimmedOverrideReason.length < 3) {
      setError('Enter a separate reason for the blocker override.')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const response = await nightAuditApi.close({
        businessDate,
        idempotencyKey: createIdempotencyKey(businessDate),
        reason: trimmedReason,
        overrideBlockers,
        ...(overrideBlockers ? { overrideReason: trimmedOverrideReason } : {}),
      })
      setSelectedRun(response.data)
      await loadRuns()
      setDialogOpen(false)
      if (response.data.status === 'COMPLETED') {
        toast.success(response.data.businessDateAlreadyClosed ? 'Business date was already closed.' : 'Night audit close persisted.')
      } else if (response.data.status === 'BLOCKED') {
        toast.warning('Night audit remains blocked. Resolve the recorded blockers before closing.')
      } else {
        toast.error(`Night audit persisted with status ${response.data.status}.`)
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Night audit close failed.')
    } finally {
      setSubmitting(false)
    }
  }

  const snapshotCards = useMemo(() => {
    if (!selectedRun) return []
    const snapshot = selectedRun.snapshot
    return [
      ['Unresolved arrivals', snapshot.unresolvedArrivals],
      ['Unresolved departures', snapshot.unresolvedDepartures],
      ['In-house reservations', snapshot.inHouseReservations],
      ['Open folios', snapshot.openFolios],
      ['Housekeeping blockers', snapshot.housekeepingBlockers],
      ['Unposted room charges', snapshot.unpostedRoomCharges],
    ] as const
  }, [selectedRun])

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Moon className="h-6 w-6" />
              Night Audit
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Persisted business-date close with enforced operational blockers</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void loadRuns()} disabled={loading || submitting}>
              <ArrowsClockwise className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button onClick={() => setDialogOpen(true)} disabled={!canRun || submitting || loading}>
              <Play className="mr-2 h-4 w-4" weight="fill" />
              Close Business Date
            </Button>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-6 p-6">
          {!canRun && (
            <Card className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              You can review audit evidence, but your role cannot close a business date.
            </Card>
          )}
          {error && (
            <Card className="border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
              <div className="flex items-start gap-2">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" weight="fill" />
                <span>{error}</span>
              </div>
            </Card>
          )}

          {latestRun && (
            <Card className="p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-muted-foreground">Latest persisted run</p>
                  <h2 className="text-lg font-semibold">{format(new Date(`${latestRun.businessDate}T00:00:00`), 'MMMM d, yyyy')}</h2>
                </div>
                {statusBadge(latestRun.status)}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Posting mode: verify existing charges only. This workflow does not simulate or silently post missing charges.
              </p>
            </Card>
          )}

          {selectedRun && (
            <Card className="p-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Audit evidence</h2>
                  <p className="text-sm text-muted-foreground">Business date {selectedRun.businessDate} · run {selectedRun.runId}</p>
                </div>
                {statusBadge(selectedRun.status)}
              </div>

              {selectedRun.blockers.length > 0 ? (
                <div className="mb-6 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 font-medium text-amber-900">
                    <ShieldWarning className="h-5 w-5" weight="fill" />
                    Recorded blockers
                  </div>
                  {selectedRun.blockers.map((blocker) => (
                    <div key={blocker.code} className="flex flex-wrap items-center justify-between gap-2 text-sm text-amber-900">
                      <span>{blockerLabel(blocker)}</span>
                      <span className="font-medium">{blocker.count} · {blocker.overridable ? 'admin-overridable' : 'cannot be overridden'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mb-6 flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-900">
                  <CheckCircle className="h-5 w-5" weight="fill" />
                  This persisted run recorded no blockers.
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {snapshotCards.map(([label, value]) => (
                  <div key={label} className="rounded-lg border p-3">
                    <div className="text-sm text-muted-foreground">{label}</div>
                    <div className="mt-1 text-xl font-semibold">{value}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><CurrencyDollar className="h-4 w-4" /> Charges</div>
                  <div className="mt-1 font-semibold">{formatSatang(selectedRun.snapshot.chargesTotalSatang)}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><CurrencyDollar className="h-4 w-4" /> Payments</div>
                  <div className="mt-1 font-semibold">{formatSatang(selectedRun.snapshot.paymentsTotalSatang)}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><CurrencyDollar className="h-4 w-4" /> Folio balance</div>
                  <div className="mt-1 font-semibold">{formatSatang(selectedRun.snapshot.balanceTotalSatang)}</div>
                </div>
              </div>
            </Card>
          )}

          <Card className="p-6">
            <h2 className="mb-4 text-lg font-semibold">Persisted audit history</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Blockers</TableHead>
                  <TableHead>Override</TableHead>
                  <TableHead>Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && runs.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Loading persisted audit history…</TableCell></TableRow>
                ) : runs.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No persisted night audit runs are available.</TableCell></TableRow>
                ) : runs.map((run) => (
                  <TableRow key={run.runId} className="cursor-pointer" onClick={() => setSelectedRun(run)}>
                    <TableCell className="font-medium">{run.businessDate}</TableCell>
                    <TableCell>{statusBadge(run.status)}</TableCell>
                    <TableCell>{run.blockers.reduce((total, blocker) => total + blocker.count, 0)}</TableCell>
                    <TableCell>{run.overrideApplied ? 'Applied' : '—'}</TableCell>
                    <TableCell>{run.completedAt ? format(new Date(run.completedAt), 'MMM d, HH:mm') : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      </ScrollArea>

      <Dialog open={dialogOpen} onOpenChange={(open) => !submitting && setDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close a business date</DialogTitle>
            <DialogDescription>
              The backend will calculate and persist the result in one serializable transaction. A blocked result is evidence, not a completed close.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="block space-y-1 text-sm font-medium">
              <span>Business date</span>
              <input
                type="date"
                value={businessDate}
                max={todayKey()}
                onChange={(event) => setBusinessDate(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                disabled={submitting}
              />
            </label>
            <label className="block space-y-1 text-sm font-medium">
              <span>Operational reason</span>
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} disabled={submitting} />
            </label>
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <Warning className="mr-1 inline h-4 w-4" weight="fill" />
              Emergency stop and missing room-charge blockers can never be overridden. Other blockers require an admin and a separate reason.
            </div>
            {canOverride && (
              <>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={overrideBlockers}
                    onChange={(event) => setOverrideBlockers(event.target.checked)}
                    className="mt-1"
                    disabled={submitting}
                  />
                  <span>Attempt an admin override if the backend finds only operationally overridable blockers.</span>
                </label>
                {overrideBlockers && (
                  <label className="block space-y-1 text-sm font-medium">
                    <span>Override reason</span>
                    <Textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} maxLength={1000} disabled={submitting} />
                  </label>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>Cancel</Button>
            <Button onClick={() => void submitClose()} disabled={submitting || !businessDate || reason.trim().length < 3 || (overrideBlockers && overrideReason.trim().length < 3)}>
              {submitting ? <ArrowsClockwise className="mr-2 h-4 w-4 animate-spin" /> : <CalendarBlank className="mr-2 h-4 w-4" />}
              {submitting ? 'Persisting…' : 'Attempt Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
