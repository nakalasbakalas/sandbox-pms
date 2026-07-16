import { useCallback, useEffect, useMemo, useState } from 'react'
import { addDays, eachDayOfInterval, endOfWeek, format, startOfWeek } from 'date-fns'
import {
  ArrowClockwise,
  Calendar as CalendarIcon,
  ChartLineUp,
  Check,
  Lightbulb,
  LockKey,
  Plus,
  Warning,
  X,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/hooks/use-auth'
import {
  ratesApi,
  type ServerEffectiveRate,
  type ServerRateCalendarEntry,
  type ServerRateRecommendation,
  type ServerRateRoomType,
  type ServerRateRule,
} from '@/lib/rates-api-client'
import { cn } from '@/lib/utils'
import { formatMoneySatang, type MoneySatang } from '@/types/money'

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Request failed.')
}

function bahtInputToSatang(value: string, allowNegative = false): MoneySatang {
  const normalized = value.trim().replace(/,/g, '')
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/)
  if (!match || (!allowNegative && match[1])) throw new Error('Enter a valid baht amount with no more than 2 decimals.')
  const whole = BigInt(match[2])
  const fraction = BigInt((match[3] || '').padEnd(2, '0') || '0')
  const satang = whole * 100n + fraction
  return `${match[1] ? -satang : satang}` as MoneySatang
}

function percentageInputToBasisPoints(value: string) {
  const match = value.trim().match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/)
  if (!match) throw new Error('Enter a percentage with no more than 2 decimals.')
  const whole = Number(match[2]) * 100
  const fraction = Number((match[3] || '').padEnd(2, '0') || '0')
  return (match[1] ? -1 : 1) * (whole + fraction)
}

function satangToBahtInput(value: MoneySatang) {
  const satang = BigInt(value)
  const negative = satang < 0n
  const absolute = negative ? -satang : satang
  return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`
}

function positiveIntegerOrNull(value: string) {
  if (!value.trim()) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) throw new Error('Stay limits must be whole numbers from 1 to 365.')
  return parsed
}

function dateKey(value: Date) {
  return format(value, 'yyyy-MM-dd')
}

function displayAdjustment(rule: ServerRateRule) {
  if (rule.adjustmentType === 'PERCENTAGE') {
    const percent = Number(rule.adjustmentBasisPoints || 0) / 100
    return `${percent > 0 ? '+' : ''}${percent}%`
  }
  return rule.adjustmentSatang ? formatMoneySatang(rule.adjustmentSatang) : '—'
}

type CalendarForm = {
  date: string
  rateBaht: string
  minStay: string
  maxStay: string
  stopSell: boolean
  closeToArrival: boolean
  closeToDeparture: boolean
  notes: string
  reason: string
}

const emptyCalendarForm: CalendarForm = {
  date: '',
  rateBaht: '',
  minStay: '',
  maxStay: '',
  stopSell: false,
  closeToArrival: false,
  closeToDeparture: false,
  notes: '',
  reason: '',
}

export function ServerRatesView() {
  const { hasPermission } = useAuth()
  const canEditRates = hasPermission('edit:rates')
  const [roomTypes, setRoomTypes] = useState<ServerRateRoomType[]>([])
  const [selectedRoomType, setSelectedRoomType] = useState('')
  const [selectedWeek, setSelectedWeek] = useState(new Date())
  const [rules, setRules] = useState<ServerRateRule[]>([])
  const [calendar, setCalendar] = useState<ServerRateCalendarEntry[]>([])
  const [effectiveRates, setEffectiveRates] = useState<ServerEffectiveRate[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [ruleName, setRuleName] = useState('')
  const [ruleDescription, setRuleDescription] = useState('')
  const [ruleType, setRuleType] = useState<ServerRateRule['adjustmentType']>('PERCENTAGE')
  const [ruleValue, setRuleValue] = useState('')
  const [ruleStartDate, setRuleStartDate] = useState('')
  const [ruleEndDate, setRuleEndDate] = useState('')
  const [ruleDays, setRuleDays] = useState<number[]>([])
  const [ruleReason, setRuleReason] = useState('')

  const [calendarDialogOpen, setCalendarDialogOpen] = useState(false)
  const [calendarForm, setCalendarForm] = useState<CalendarForm>(emptyCalendarForm)
  const [pendingRule, setPendingRule] = useState<ServerRateRule | null>(null)
  const [toggleReason, setToggleReason] = useState('')

  const [recommendationDate, setRecommendationDate] = useState(dateKey(new Date()))
  const [proposedRate, setProposedRate] = useState('')
  const [rationale, setRationale] = useState('')
  const [recommendation, setRecommendation] = useState<ServerRateRecommendation | null>(null)

  const weekDays = useMemo(() => eachDayOfInterval({
    start: startOfWeek(selectedWeek, { weekStartsOn: 1 }),
    end: endOfWeek(selectedWeek, { weekStartsOn: 1 }),
  }), [selectedWeek])
  const weekStart = dateKey(weekDays[0])
  const weekEnd = dateKey(weekDays[weekDays.length - 1])
  const selectedRoom = roomTypes.find((roomType) => roomType.id === selectedRoomType)
  const calendarByDate = useMemo(() => new Map(calendar.map((entry) => [entry.date, entry])), [calendar])
  const effectiveByDate = useMemo(() => new Map(effectiveRates.map((entry) => [entry.date, entry])), [effectiveRates])

  const loadRoomTypes = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const nextRoomTypes = await ratesApi.listRoomTypes()
      setRoomTypes(nextRoomTypes)
      setSelectedRoomType((current) => current || nextRoomTypes[0]?.id || '')
      if (!nextRoomTypes.length) setError('No active room types were found. Configure room inventory before managing rates.')
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadRates = useCallback(async () => {
    if (!selectedRoomType) return
    setLoading(true)
    setError(null)
    setRules([])
    setCalendar([])
    setEffectiveRates([])
    try {
      const [nextRules, nextCalendar, nextEffective] = await Promise.all([
        ratesApi.listRules(selectedRoomType),
        ratesApi.listCalendar(selectedRoomType, weekStart, weekEnd),
        Promise.all(weekDays.map((day) => ratesApi.effective(selectedRoomType, dateKey(day)))),
      ])
      setRules(nextRules)
      setCalendar(nextCalendar)
      setEffectiveRates(nextEffective)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }, [selectedRoomType, weekEnd, weekStart])

  useEffect(() => {
    void loadRoomTypes()
  }, [loadRoomTypes])

  useEffect(() => {
    void loadRates()
  }, [loadRates])

  const resetRuleForm = () => {
    setRuleName('')
    setRuleDescription('')
    setRuleType('PERCENTAGE')
    setRuleValue('')
    setRuleStartDate('')
    setRuleEndDate('')
    setRuleDays([])
    setRuleReason('')
  }

  const createRule = async () => {
    if (!selectedRoomType || ruleName.trim().length < 1 || ruleReason.trim().length < 3) {
      toast.error('Rule name and an operational reason of at least 3 characters are required.')
      return
    }
    try {
      setSaving(true)
      const adjustment = ruleType === 'PERCENTAGE'
        ? { adjustmentBasisPoints: percentageInputToBasisPoints(ruleValue) }
        : { adjustmentSatang: bahtInputToSatang(ruleValue, ruleType === 'FIXED_AMOUNT') }
      await ratesApi.createRule({
        name: ruleName.trim(),
        description: ruleDescription.trim() || null,
        roomTypeId: selectedRoomType,
        priority: rules.length,
        startDate: ruleStartDate || null,
        endDate: ruleEndDate || null,
        daysOfWeek: ruleDays,
        adjustmentType: ruleType,
        ...adjustment,
        active: true,
        reason: ruleReason.trim(),
      })
      setRuleDialogOpen(false)
      resetRuleForm()
      await loadRates()
      toast.success('Rate rule saved to the PMS.')
    } catch (requestError) {
      toast.error(errorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  const toggleRule = async () => {
    if (!pendingRule || toggleReason.trim().length < 3) {
      toast.error('Enter an operational reason of at least 3 characters.')
      return
    }
    try {
      setSaving(true)
      await ratesApi.updateRule(pendingRule.id, { active: !pendingRule.active, reason: toggleReason.trim() })
      setPendingRule(null)
      setToggleReason('')
      await loadRates()
      toast.success(`Rate rule ${pendingRule.active ? 'disabled' : 'enabled'} in the PMS.`)
    } catch (requestError) {
      toast.error(errorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  const openCalendarEntry = (day: Date) => {
    const key = dateKey(day)
    const existing = calendarByDate.get(key)
    const effective = effectiveByDate.get(key)
    const satang = existing?.rateSatang || effective?.effectiveRateSatang || selectedRoom?.baseRateSatang || ('0' as MoneySatang)
    setCalendarForm({
      date: key,
      rateBaht: satangToBahtInput(satang),
      minStay: existing?.minStay?.toString() || '',
      maxStay: existing?.maxStay?.toString() || '',
      stopSell: existing?.stopSell || false,
      closeToArrival: existing?.closeToArrival || false,
      closeToDeparture: existing?.closeToDeparture || false,
      notes: existing?.notes || '',
      reason: '',
    })
    setCalendarDialogOpen(true)
  }

  const saveCalendarEntry = async () => {
    if (!selectedRoomType || calendarForm.reason.trim().length < 3) {
      toast.error('An operational reason of at least 3 characters is required.')
      return
    }
    try {
      setSaving(true)
      const minStay = positiveIntegerOrNull(calendarForm.minStay)
      const maxStay = positiveIntegerOrNull(calendarForm.maxStay)
      if (minStay && maxStay && minStay > maxStay) throw new Error('Minimum stay cannot exceed maximum stay.')
      await ratesApi.saveCalendar({
        roomTypeId: selectedRoomType,
        date: calendarForm.date,
        rateSatang: bahtInputToSatang(calendarForm.rateBaht),
        minStay,
        maxStay,
        stopSell: calendarForm.stopSell,
        closeToArrival: calendarForm.closeToArrival,
        closeToDeparture: calendarForm.closeToDeparture,
        notes: calendarForm.notes.trim() || null,
        reason: calendarForm.reason.trim(),
      })
      setCalendarDialogOpen(false)
      setCalendarForm(emptyCalendarForm)
      await loadRates()
      toast.success('Rate calendar entry saved to the PMS.')
    } catch (requestError) {
      toast.error(errorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  const generateRecommendation = async () => {
    if (!selectedRoomType || rationale.trim().length < 3) {
      toast.error('A rationale of at least 3 characters is required.')
      return
    }
    try {
      setSaving(true)
      const result = await ratesApi.recommend({
        roomTypeId: selectedRoomType,
        date: recommendationDate,
        proposedRateSatang: bahtInputToSatang(proposedRate),
        rationale: rationale.trim(),
      })
      setRecommendation(result)
      toast.success('Suggestion generated. No rate was changed.')
    } catch (requestError) {
      toast.error(errorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2"><ChartLineUp className="h-6 w-6 text-primary" /></div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">Rates & Pricing</h1>
                <Badge variant="outline">Server authoritative</Badge>
              </div>
              <p className="text-sm text-muted-foreground">Exact-money rates, audited restrictions, and suggest-only recommendations</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedRoomType} onValueChange={setSelectedRoomType} disabled={!roomTypes.length}>
              <SelectTrigger className="w-[220px]"><SelectValue placeholder="Select room type" /></SelectTrigger>
              <SelectContent>
                {roomTypes.map((roomType) => <SelectItem key={roomType.id} value={roomType.id}>{roomType.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => void loadRates()} disabled={loading || !selectedRoomType}>
              <ArrowClockwise className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} /> Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-6">
        {!canEditRates && (
          <Card className="border-amber-300 bg-amber-50/60">
            <CardContent className="flex items-center gap-3 py-3 text-sm text-amber-900">
              <LockKey className="h-5 w-5" /> Your role can inspect rates but only managers and administrators can change them.
            </CardContent>
          </Card>
        )}
        {error && (
          <Card className="border-destructive/50">
            <CardContent className="flex items-start gap-3 py-4 text-sm text-destructive">
              <Warning className="mt-0.5 h-5 w-5 shrink-0" />
              <div><p className="font-semibold">Rates could not be loaded from the PMS</p><p>{error}</p></div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="calendar">
          <TabsList>
            <TabsTrigger value="calendar">Rate calendar</TabsTrigger>
            <TabsTrigger value="rules">Rules ({rules.length})</TabsTrigger>
            <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
          </TabsList>

          <TabsContent value="calendar" className="space-y-4 pt-3">
            <div className="grid gap-4 md:grid-cols-[1fr_auto]">
              <Card>
                <CardHeader>
                  <CardDescription>Base rate for {selectedRoom?.name || 'selected room type'}</CardDescription>
                  <CardTitle className="text-3xl">{selectedRoom ? formatMoneySatang(selectedRoom.baseRateSatang) : '—'}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardContent className="flex h-full items-center gap-2 p-4">
                  <Button variant="outline" onClick={() => setSelectedWeek((week) => addDays(week, -7))}>Previous</Button>
                  <Button variant="outline" onClick={() => setSelectedWeek(new Date())}>This week</Button>
                  <Button variant="outline" onClick={() => setSelectedWeek((week) => addDays(week, 7))}>Next</Button>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
              {weekDays.map((day) => {
                const key = dateKey(day)
                const effective = effectiveByDate.get(key)
                const override = calendarByDate.get(key)
                return (
                  <Card key={key} className={cn(!effective?.sellable && 'border-destructive/60', override && 'border-primary/60')}>
                    <CardHeader className="space-y-1 p-4 pb-2">
                      <CardDescription>{format(day, 'EEE')}</CardDescription>
                      <CardTitle className="text-base">{format(day, 'MMM d')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 p-4 pt-0">
                      <div>
                        <p className="text-xl font-bold">{effective ? formatMoneySatang(effective.effectiveRateSatang) : '—'}</p>
                        <Badge variant={effective?.source === 'CALENDAR' ? 'default' : 'secondary'}>{effective?.source || 'Loading'}</Badge>
                      </div>
                      {!effective?.sellable && <Badge variant="destructive">Not sellable</Badge>}
                      {effective?.restrictions.minStay && <p className="text-xs text-muted-foreground">Min {effective.restrictions.minStay} nights</p>}
                      {canEditRates && <Button className="w-full" size="sm" variant="outline" onClick={() => openCalendarEntry(day)}>Edit</Button>}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </TabsContent>

          <TabsContent value="rules" className="space-y-4 pt-3">
            <div className="flex items-center justify-between">
              <div><h2 className="text-lg font-semibold">Audited rate rules</h2><p className="text-sm text-muted-foreground">Global rules and rules for {selectedRoom?.name}</p></div>
              {canEditRates && <Button onClick={() => setRuleDialogOpen(true)}><Plus className="mr-2 h-4 w-4" />Add rule</Button>}
            </div>
            {!rules.length ? (
              <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No rate rules are configured for this room type.</CardContent></Card>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {rules.map((rule) => (
                  <Card key={rule.id} className={!rule.active ? 'opacity-65' : undefined}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div><CardTitle className="text-base">{rule.name}</CardTitle><CardDescription>{rule.description || 'No description'}</CardDescription></div>
                        <Badge variant={rule.active ? 'default' : 'outline'}>{rule.active ? 'Active' : 'Inactive'}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">{rule.adjustmentType.replace('_', ' ')}</Badge>
                        <Badge variant="outline">{displayAdjustment(rule)}</Badge>
                        {!rule.roomTypeId && <Badge variant="outline">All room types</Badge>}
                      </div>
                      {(rule.startDate || rule.endDate) && <p className="text-sm text-muted-foreground">{rule.startDate || 'Always'} — {rule.endDate || 'No end'}</p>}
                      {!!rule.daysOfWeek.length && <p className="text-sm text-muted-foreground">{rule.daysOfWeek.map((day) => dayNames[day]).join(', ')}</p>}
                      {canEditRates && <Button variant="outline" size="sm" onClick={() => setPendingRule(rule)}>{rule.active ? 'Disable' : 'Enable'}</Button>}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="recommendations" className="space-y-4 pt-3">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2"><Lightbulb className="h-5 w-5 text-amber-600" /><CardTitle>Suggest-only rate analysis</CardTitle></div>
                <CardDescription>This compares a proposed exact rate with the effective PMS rate. It never changes a rate or pushes a provider update.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2"><Label>Date</Label><Input type="date" value={recommendationDate} onChange={(event) => setRecommendationDate(event.target.value)} /></div>
                <div className="space-y-2"><Label>Proposed rate (THB)</Label><Input inputMode="decimal" value={proposedRate} onChange={(event) => setProposedRate(event.target.value)} placeholder="2500.00" /></div>
                <div className="space-y-2 md:col-span-3"><Label>Rationale</Label><Textarea value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="Explain the observed demand or operating condition." /></div>
                <div><Button onClick={() => void generateRecommendation()} disabled={saving || !selectedRoomType}>Generate suggestion</Button></div>
              </CardContent>
            </Card>
            {recommendation && (
              <Card className="border-amber-300">
                <CardHeader><CardTitle className="text-lg">Recommendation only</CardTitle><CardDescription>{recommendation.date} · {recommendation.rationale}</CardDescription></CardHeader>
                <CardContent className="flex flex-wrap gap-6">
                  <div><p className="text-xs text-muted-foreground">Current</p><p className="text-xl font-semibold">{formatMoneySatang(recommendation.currentRateSatang)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Proposed</p><p className="text-xl font-semibold">{formatMoneySatang(recommendation.proposedRateSatang)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Difference</p><p className="text-xl font-semibold">{formatMoneySatang(recommendation.differenceSatang)}</p></div>
                  <Badge variant="outline">No write performed</Badge>
                  <Badge variant="outline">Approval required</Badge>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Add audited rate rule</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2"><Label>Name</Label><Input value={ruleName} onChange={(event) => setRuleName(event.target.value)} /></div>
            <div className="space-y-2"><Label>Description</Label><Textarea value={ruleDescription} onChange={(event) => setRuleDescription(event.target.value)} /></div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Adjustment type</Label>
                <Select value={ruleType} onValueChange={(value) => setRuleType(value as ServerRateRule['adjustmentType'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="PERCENTAGE">Percentage</SelectItem><SelectItem value="FIXED_AMOUNT">Fixed amount</SelectItem><SelectItem value="OVERRIDE">Override rate</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>{ruleType === 'PERCENTAGE' ? 'Percentage' : 'Amount (THB)'}</Label><Input inputMode="decimal" value={ruleValue} onChange={(event) => setRuleValue(event.target.value)} /></div>
              <div className="space-y-2"><Label>Start date (optional)</Label><Input type="date" value={ruleStartDate} onChange={(event) => setRuleStartDate(event.target.value)} /></div>
              <div className="space-y-2"><Label>End date (optional)</Label><Input type="date" value={ruleEndDate} onChange={(event) => setRuleEndDate(event.target.value)} /></div>
            </div>
            <div className="space-y-2"><Label>Days (optional)</Label><div className="flex flex-wrap gap-2">{dayNames.map((name, day) => <Button key={name} type="button" size="sm" variant={ruleDays.includes(day) ? 'default' : 'outline'} onClick={() => setRuleDays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day])}>{name}</Button>)}</div></div>
            <div className="space-y-2"><Label>Operational reason</Label><Textarea value={ruleReason} onChange={(event) => setRuleReason(event.target.value)} placeholder="Required for audit evidence" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setRuleDialogOpen(false)}>Cancel</Button><Button onClick={() => void createRule()} disabled={saving}>Save rule</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={calendarDialogOpen} onOpenChange={setCalendarDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle><CalendarIcon className="mr-2 inline h-5 w-5" />Rate calendar · {calendarForm.date}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2"><Label>Rate (THB)</Label><Input inputMode="decimal" value={calendarForm.rateBaht} onChange={(event) => setCalendarForm((current) => ({ ...current, rateBaht: event.target.value }))} /></div>
              <div className="space-y-2"><Label>Minimum stay</Label><Input inputMode="numeric" value={calendarForm.minStay} onChange={(event) => setCalendarForm((current) => ({ ...current, minStay: event.target.value }))} /></div>
              <div className="space-y-2"><Label>Maximum stay</Label><Input inputMode="numeric" value={calendarForm.maxStay} onChange={(event) => setCalendarForm((current) => ({ ...current, maxStay: event.target.value }))} /></div>
            </div>
            {[['Stop sell', 'stopSell'], ['Close to arrival', 'closeToArrival'], ['Close to departure', 'closeToDeparture']].map(([label, key]) => (
              <div key={key} className="flex items-center justify-between rounded-md border p-3"><Label>{label}</Label><Switch checked={calendarForm[key as 'stopSell' | 'closeToArrival' | 'closeToDeparture']} onCheckedChange={(checked) => setCalendarForm((current) => ({ ...current, [key]: checked }))} /></div>
            ))}
            <div className="space-y-2"><Label>Notes</Label><Textarea value={calendarForm.notes} onChange={(event) => setCalendarForm((current) => ({ ...current, notes: event.target.value }))} /></div>
            <div className="space-y-2"><Label>Operational reason</Label><Textarea value={calendarForm.reason} onChange={(event) => setCalendarForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Required for audit evidence" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCalendarDialogOpen(false)}>Cancel</Button><Button onClick={() => void saveCalendarEntry()} disabled={saving}>Save to PMS</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(pendingRule)} onOpenChange={(open) => !open && setPendingRule(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{pendingRule?.active ? 'Disable' : 'Enable'} {pendingRule?.name}</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2"><Label>Operational reason</Label><Textarea value={toggleReason} onChange={(event) => setToggleReason(event.target.value)} placeholder="Required for audit evidence" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setPendingRule(null)}>Cancel</Button><Button onClick={() => void toggleRule()} disabled={saving}>{pendingRule?.active ? <X className="mr-2 h-4 w-4" /> : <Check className="mr-2 h-4 w-4" />}{pendingRule?.active ? 'Disable' : 'Enable'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
