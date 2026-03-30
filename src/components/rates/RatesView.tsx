import { useState, useMemo } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { 
  ChartLineUp, 
  Plus,
  Calendar as CalendarIcon,
  Percent,
  CurrencyCircleDollar,
  TrendUp,
  TrendDown,
  Lightning,
  Edit,
  Trash,
  Copy,
  Check,
  X,
  ArrowUp
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { format, addDays, startOfWeek, endOfWeek, eachDayOfInterval } from 'date-fns'
import { cn } from '@/lib/utils'
import { RatePushPanel } from './RatePushPanel'
import { RatePlanManager } from './RatePlanManager'
import { TaxDiscountManager } from './TaxDiscountManager'

interface RoomType {
  id: string
  name: string
  baseRate: number
}

interface RateRule {
  id: string
  name: string
  roomTypeId: string
  type: 'PERCENTAGE' | 'FIXED_DELTA' | 'LONG_STAY_DISCOUNT' | 'SEASONAL'
  value: number
  startDate?: string
  endDate?: string
  daysOfWeek?: number[]
  minStayNights?: number
  enabled: boolean
  priority: number
}

interface RateOverride {
  id: string
  roomTypeId: string
  date: string
  rate: number
  reason: string
}

export function RatesView() {
  const [roomTypes, setRoomTypes] = useKV<RoomType[]>('room-types-config', [
    { id: 'deluxe', name: 'Deluxe Room', baseRate: 2500 },
    { id: 'superior', name: 'Superior Room', baseRate: 3000 },
    { id: 'suite', name: 'Suite', baseRate: 4500 }
  ])
  const [rateRules, setRateRules] = useKV<RateRule[]>('rate-rules', [])
  const [rateOverrides, setRateOverrides] = useKV<RateOverride[]>('rate-overrides', [])

  const [selectedRoomType, setSelectedRoomType] = useState<string>(roomTypes[0]?.id || '')
  const [showAddRuleDialog, setShowAddRuleDialog] = useState(false)
  const [showEditBaseRateDialog, setShowEditBaseRateDialog] = useState(false)
  const [showAddOverrideDialog, setShowAddOverrideDialog] = useState(false)
  const [selectedWeek, setSelectedWeek] = useState<Date>(new Date())

  const [ruleName, setRuleName] = useState('')
  const [ruleType, setRuleType] = useState<'PERCENTAGE' | 'FIXED_DELTA' | 'LONG_STAY_DISCOUNT' | 'SEASONAL'>('PERCENTAGE')
  const [ruleValue, setRuleValue] = useState('')
  const [ruleStartDate, setRuleStartDate] = useState<Date>()
  const [ruleEndDate, setRuleEndDate] = useState<Date>()
  const [ruleMinStay, setRuleMinStay] = useState('')
  const [ruleDaysOfWeek, setRuleDaysOfWeek] = useState<number[]>([])

  const [newBaseRate, setNewBaseRate] = useState('')
  const [overrideDate, setOverrideDate] = useState<Date>()
  const [overrideRate, setOverrideRate] = useState('')
  const [overrideReason, setOverrideReason] = useState('')

  const selectedRoom = roomTypes.find(rt => rt.id === selectedRoomType)
  const roomRules = rateRules.filter(r => r.roomTypeId === selectedRoomType && r.enabled)

  const calculateRate = (baseRate: number, date: Date): { rate: number, breakdown: string[] } => {
    const breakdown: string[] = [`Base: ฿${baseRate}`]
    let rate = baseRate

    const override = rateOverrides.find(o => 
      o.roomTypeId === selectedRoomType && 
      format(new Date(o.date), 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
    )

    if (override) {
      return { rate: override.rate, breakdown: [`Override: ฿${override.rate} (${override.reason})`] }
    }

    const applicableRules = roomRules
      .filter(rule => {
        if (rule.startDate && new Date(rule.startDate) > date) return false
        if (rule.endDate && new Date(rule.endDate) < date) return false
        if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
          if (!rule.daysOfWeek.includes(date.getDay())) return false
        }
        return true
      })
      .sort((a, b) => b.priority - a.priority)

    applicableRules.forEach(rule => {
      if (rule.type === 'PERCENTAGE') {
        const adjustment = rate * (rule.value / 100)
        rate += adjustment
        breakdown.push(`${rule.name}: ${rule.value > 0 ? '+' : ''}${rule.value}% (฿${adjustment.toFixed(0)})`)
      } else if (rule.type === 'FIXED_DELTA') {
        rate += rule.value
        breakdown.push(`${rule.name}: ${rule.value > 0 ? '+' : ''}฿${rule.value}`)
      }
    })

    return { rate: Math.round(rate), breakdown }
  }

  const weekDays = eachDayOfInterval({
    start: startOfWeek(selectedWeek, { weekStartsOn: 1 }),
    end: endOfWeek(selectedWeek, { weekStartsOn: 1 })
  })

  const handleAddRule = () => {
    if (!ruleName || !ruleValue) {
      toast.error('Please fill in all required fields')
      return
    }

    const value = parseFloat(ruleValue)
    if (isNaN(value)) {
      toast.error('Invalid value')
      return
    }

    const newRule: RateRule = {
      id: `rule_${Date.now()}`,
      name: ruleName,
      roomTypeId: selectedRoomType,
      type: ruleType,
      value,
      startDate: ruleStartDate?.toISOString(),
      endDate: ruleEndDate?.toISOString(),
      daysOfWeek: ruleDaysOfWeek.length > 0 ? ruleDaysOfWeek : undefined,
      minStayNights: ruleMinStay ? parseInt(ruleMinStay) : undefined,
      enabled: true,
      priority: rateRules.length + 1
    }

    setRateRules(current => [...current, newRule])
    resetRuleForm()
    setShowAddRuleDialog(false)
    toast.success('Rate rule added successfully')
  }

  const handleUpdateBaseRate = () => {
    if (!selectedRoom || !newBaseRate) return

    const rate = parseFloat(newBaseRate)
    if (isNaN(rate) || rate <= 0) {
      toast.error('Invalid rate')
      return
    }

    setRoomTypes(current => 
      current.map(rt => 
        rt.id === selectedRoomType ? { ...rt, baseRate: rate } : rt
      )
    )

    setShowEditBaseRateDialog(false)
    setNewBaseRate('')
    toast.success('Base rate updated')
  }

  const handleAddOverride = () => {
    if (!overrideDate || !overrideRate || !overrideReason) {
      toast.error('Please fill in all fields')
      return
    }

    const rate = parseFloat(overrideRate)
    if (isNaN(rate) || rate <= 0) {
      toast.error('Invalid rate')
      return
    }

    const newOverride: RateOverride = {
      id: `override_${Date.now()}`,
      roomTypeId: selectedRoomType,
      date: format(overrideDate, 'yyyy-MM-dd'),
      rate,
      reason: overrideReason
    }

    setRateOverrides(current => [...current, newOverride])
    setOverrideDate(undefined)
    setOverrideRate('')
    setOverrideReason('')
    setShowAddOverrideDialog(false)
    toast.success('Rate override added')
  }

  const deleteRule = (ruleId: string) => {
    setRateRules(current => current.filter(r => r.id !== ruleId))
    toast.success('Rule deleted')
  }

  const toggleRule = (ruleId: string) => {
    setRateRules(current => 
      current.map(r => 
        r.id === ruleId ? { ...r, enabled: !r.enabled } : r
      )
    )
  }

  const deleteOverride = (overrideId: string) => {
    setRateOverrides(current => current.filter(o => o.id !== overrideId))
    toast.success('Override deleted')
  }

  const resetRuleForm = () => {
    setRuleName('')
    setRuleValue('')
    setRuleStartDate(undefined)
    setRuleEndDate(undefined)
    setRuleMinStay('')
    setRuleDaysOfWeek([])
  }

  const toggleDayOfWeek = (day: number) => {
    setRuleDaysOfWeek(current => 
      current.includes(day) 
        ? current.filter(d => d !== day)
        : [...current, day]
    )
  }

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="flex-none border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <ChartLineUp className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Rates & Pricing</h1>
              <p className="text-sm text-muted-foreground">Dynamic pricing rules and rate management</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Select value={selectedRoomType} onValueChange={setSelectedRoomType}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roomTypes.map(rt => (
                  <SelectItem key={rt.id} value={rt.id}>
                    {rt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-6">
        <Tabs defaultValue="rates" className="h-full flex flex-col">
          <TabsList>
            <TabsTrigger value="rates">Rate Calendar</TabsTrigger>
            <TabsTrigger value="rate-plans">Rate Plans</TabsTrigger>
            <TabsTrigger value="taxes-discounts">Taxes & Discounts</TabsTrigger>
            <TabsTrigger value="rate-push">
              <ArrowUp className="w-4 h-4 mr-2" />
              Channel Push
            </TabsTrigger>
          </TabsList>

          <TabsContent value="rates" className="flex-1 mt-6 overflow-hidden">
            <div className="h-full grid grid-cols-3 gap-6">
        <div className="col-span-2 flex flex-col gap-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Base Rate</CardTitle>
                  <CardDescription>Foundation rate for {selectedRoom?.name}</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => {
                  setNewBaseRate(selectedRoom?.baseRate.toString() || '')
                  setShowEditBaseRateDialog(true)
                }}>
                  <Edit className="w-4 h-4 mr-2" />
                  Edit
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold">฿{selectedRoom?.baseRate.toLocaleString()}</span>
                <span className="text-muted-foreground">per night</span>
              </div>
            </CardContent>
          </Card>

          <Card className="flex-1">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Rate Calendar</CardTitle>
                  <CardDescription>View calculated rates for the week</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setSelectedWeek(d => addDays(d, -7))}
                  >
                    Previous Week
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setSelectedWeek(new Date())}
                  >
                    This Week
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setSelectedWeek(d => addDays(d, 7))}
                  >
                    Next Week
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[calc(100vh-450px)]">
                <div className="grid grid-cols-7 gap-2">
                  {weekDays.map((day, index) => {
                    const { rate, breakdown } = selectedRoom ? calculateRate(selectedRoom.baseRate, day) : { rate: 0, breakdown: [] }
                    const isToday = format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')
                    const hasOverride = rateOverrides.some(o => 
                      o.roomTypeId === selectedRoomType && 
                      format(new Date(o.date), 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd')
                    )

                    return (
                      <div key={index} className={cn(
                        "p-4 rounded-lg border-2 transition-all",
                        isToday ? "border-primary bg-primary/5" : "border-border",
                        hasOverride && "bg-orange-50 border-orange-300"
                      )}>
                        <div className="text-center mb-2">
                          <p className="text-xs text-muted-foreground font-medium mb-1">
                            {dayNames[index]}
                          </p>
                          <p className="text-sm font-semibold">
                            {format(day, 'MMM d')}
                          </p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold mb-1">฿{rate.toLocaleString()}</p>
                          {hasOverride && (
                            <Badge variant="secondary" className="text-xs">Override</Badge>
                          )}
                        </div>
                        <div className="mt-3 space-y-1">
                          {breakdown.map((item, i) => (
                            <p key={i} className="text-xs text-muted-foreground">
                              {item}
                            </p>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Active Rules</CardTitle>
                <Button size="sm" onClick={() => setShowAddRuleDialog(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Rule
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                {roomRules.length === 0 ? (
                  <div className="text-center py-8">
                    <Percent className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground">No active rules</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {roomRules.map(rule => (
                      <Card key={rule.id} className="p-3">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-semibold text-sm">{rule.name}</h4>
                              {rule.type === 'PERCENTAGE' && (
                                <Badge variant="outline" className="text-xs">
                                  {rule.value > 0 ? '+' : ''}{rule.value}%
                                </Badge>
                              )}
                              {rule.type === 'FIXED_DELTA' && (
                                <Badge variant="outline" className="text-xs">
                                  {rule.value > 0 ? '+' : ''}฿{rule.value}
                                </Badge>
                              )}
                            </div>
                            {rule.daysOfWeek && rule.daysOfWeek.length > 0 && (
                              <p className="text-xs text-muted-foreground">
                                {rule.daysOfWeek.map(d => dayNames[d === 0 ? 6 : d - 1]).join(', ')}
                              </p>
                            )}
                            {rule.startDate && rule.endDate && (
                              <p className="text-xs text-muted-foreground">
                                {format(new Date(rule.startDate), 'MMM d')} - {format(new Date(rule.endDate), 'MMM d')}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-1">
                            <Button 
                              variant="ghost" 
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => toggleRule(rule.id)}
                            >
                              {rule.enabled ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => deleteRule(rule.id)}
                            >
                              <Trash className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="flex-1">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Rate Overrides</CardTitle>
                <Button size="sm" onClick={() => setShowAddOverrideDialog(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[calc(100vh-680px)]">
                {rateOverrides.filter(o => o.roomTypeId === selectedRoomType).length === 0 ? (
                  <div className="text-center py-8">
                    <Lightning className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground">No overrides set</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {rateOverrides
                      .filter(o => o.roomTypeId === selectedRoomType)
                      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                      .map(override => (
                        <Card key={override.id} className="p-3">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="font-semibold text-sm mb-1">
                                {format(new Date(override.date), 'MMM d, yyyy')}
                              </p>
                              <p className="text-xl font-bold mb-1">฿{override.rate.toLocaleString()}</p>
                              <p className="text-xs text-muted-foreground">{override.reason}</p>
                            </div>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => deleteOverride(override.id)}
                            >
                              <Trash className="w-3 h-3" />
                            </Button>
                          </div>
                        </Card>
                      ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
            </div>
          </TabsContent>

          <TabsContent value="rate-plans" className="flex-1 mt-6 overflow-auto">
            <RatePlanManager />
          </TabsContent>

          <TabsContent value="taxes-discounts" className="flex-1 mt-6 overflow-auto">
            <TaxDiscountManager />
          </TabsContent>

          <TabsContent value="rate-push" className="flex-1 mt-6">
            <RatePushPanel />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={showAddRuleDialog} onOpenChange={setShowAddRuleDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Rate Rule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Rule Name</Label>
              <Input
                placeholder="e.g., Weekend Premium, Low Season Discount"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={ruleType} onValueChange={(v: any) => setRuleType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENTAGE">Percentage Adjustment</SelectItem>
                  <SelectItem value="FIXED_DELTA">Fixed Amount</SelectItem>
                  <SelectItem value="LONG_STAY_DISCOUNT">Long Stay Discount</SelectItem>
                  <SelectItem value="SEASONAL">Seasonal Rate</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Value {ruleType === 'PERCENTAGE' ? '(%)' : '(฿)'}</Label>
              <Input
                type="number"
                placeholder={ruleType === 'PERCENTAGE' ? 'e.g., 20 for +20%' : 'e.g., 500 for +฿500'}
                value={ruleValue}
                onChange={(e) => setRuleValue(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date (Optional)</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarIcon className="w-4 h-4 mr-2" />
                      {ruleStartDate ? format(ruleStartDate, 'MMM d, yyyy') : 'Select date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={ruleStartDate}
                      onSelect={setRuleStartDate}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>End Date (Optional)</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarIcon className="w-4 h-4 mr-2" />
                      {ruleEndDate ? format(ruleEndDate, 'MMM d, yyyy') : 'Select date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={ruleEndDate}
                      onSelect={setRuleEndDate}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Days of Week (Optional)</Label>
              <div className="flex gap-2">
                {dayNames.map((day, index) => (
                  <Button
                    key={day}
                    variant={ruleDaysOfWeek.includes(index + 1) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleDayOfWeek(index + 1)}
                  >
                    {day}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowAddRuleDialog(false)
              resetRuleForm()
            }}>
              Cancel
            </Button>
            <Button onClick={handleAddRule}>Add Rule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditBaseRateDialog} onOpenChange={setShowEditBaseRateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Base Rate</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>New Base Rate (฿)</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={newBaseRate}
                onChange={(e) => setNewBaseRate(e.target.value)}
              />
              <p className="text-sm text-muted-foreground">
                Current rate: ฿{selectedRoom?.baseRate.toLocaleString()}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditBaseRateDialog(false)}>Cancel</Button>
            <Button onClick={handleUpdateBaseRate}>Update Rate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddOverrideDialog} onOpenChange={setShowAddOverrideDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Rate Override</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <CalendarIcon className="w-4 h-4 mr-2" />
                    {overrideDate ? format(overrideDate, 'MMM d, yyyy') : 'Select date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={overrideDate}
                    onSelect={setOverrideDate}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>Rate (฿)</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={overrideRate}
                onChange={(e) => setOverrideRate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Input
                placeholder="e.g., Special event, High demand"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddOverrideDialog(false)}>Cancel</Button>
            <Button onClick={handleAddOverride}>Add Override</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
