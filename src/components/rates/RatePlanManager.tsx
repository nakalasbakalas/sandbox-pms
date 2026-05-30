import { useState } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { 
  Plus,
  Trash,
  Copy,
  Tag,
  TrendUp,
  CalendarBlank,
  Users,
  CheckCircle
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface RatePlan {
  id: string
  name: string
  code: string
  description: string
  roomTypeId: string
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'
  baseRate: number
  isMasterPlan: boolean
  isDerived: boolean
  parentPlanId?: string
  derivationType?: 'MARKUP' | 'MARKDOWN' | 'FIXED_DELTA'
  derivationValue?: number
  restrictions: {
    minStayNights?: number
    maxStayNights?: number
    advanceBookingDays?: number
    maxAdvanceBookingDays?: number
    closedToArrival: boolean
    closedToDeparture: boolean
    stopSell: boolean
  }
  availability: {
    daysOfWeek?: number[]
    seasonalDates?: { start: string; end: string }[]
  }
  inclusions: string[]
  cancellationPolicy: string
  depositPolicy: string
  createdAt: string
  updatedAt: string
}

export function RatePlanManager() {
  const [ratePlans, setRatePlans] = useKV<RatePlan[]>('rate-plans', [])
  const [roomTypes] = useKV<any[]>('room-types-config', [])
  
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [editingPlan, setEditingPlan] = useState<RatePlan | null>(null)
  
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [roomTypeId, setRoomTypeId] = useState('')
  const [baseRate, setBaseRate] = useState('')
  const [isDerived, setIsDerived] = useState(false)
  const [parentPlanId, setParentPlanId] = useState('')
  const [derivationType, setDerivationType] = useState<'MARKUP' | 'MARKDOWN' | 'FIXED_DELTA'>('MARKUP')
  const [derivationValue, setDerivationValue] = useState('')
  const [minStayNights, setMinStayNights] = useState('')
  const [advanceBookingDays, setAdvanceBookingDays] = useState('')
  const [inclusions, setInclusions] = useState('')
  const [cancellationPolicy, setCancellationPolicy] = useState('')
  const [depositPolicy, setDepositPolicy] = useState('')

  const handleCreatePlan = () => {
    if (!name || !code || !roomTypeId || (!isDerived && !baseRate)) {
      toast.error('Please fill in all required fields')
      return
    }

    const newPlan: RatePlan = {
      id: `plan_${Date.now()}`,
      name,
      code: code.toUpperCase(),
      description,
      roomTypeId,
      status: 'ACTIVE',
      baseRate: isDerived ? 0 : parseFloat(baseRate),
      isMasterPlan: !isDerived,
      isDerived,
      parentPlanId: isDerived ? parentPlanId : undefined,
      derivationType: isDerived ? derivationType : undefined,
      derivationValue: isDerived ? parseFloat(derivationValue) : undefined,
      restrictions: {
        minStayNights: minStayNights ? parseInt(minStayNights) : undefined,
        advanceBookingDays: advanceBookingDays ? parseInt(advanceBookingDays) : undefined,
        closedToArrival: false,
        closedToDeparture: false,
        stopSell: false
      },
      availability: {},
      inclusions: inclusions.split('\n').filter(i => i.trim()),
      cancellationPolicy,
      depositPolicy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    setRatePlans(current => [...current, newPlan])
    resetForm()
    setShowAddDialog(false)
    toast.success('Rate plan created successfully')
  }

  const handleDuplicatePlan = (plan: RatePlan) => {
    const duplicated: RatePlan = {
      ...plan,
      id: `plan_${Date.now()}`,
      name: `${plan.name} (Copy)`,
      code: `${plan.code}_COPY`,
      status: 'INACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    setRatePlans(current => [...current, duplicated])
    toast.success('Rate plan duplicated')
  }

  const handleDeletePlan = (planId: string) => {
    setRatePlans(current => current.filter(p => p.id !== planId))
    toast.success('Rate plan deleted')
  }

  const togglePlanStatus = (planId: string) => {
    setRatePlans(current =>
      current.map(p =>
        p.id === planId
          ? { ...p, status: p.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', updatedAt: new Date().toISOString() }
          : p
      )
    )
  }

  const resetForm = () => {
    setName('')
    setCode('')
    setDescription('')
    setRoomTypeId('')
    setBaseRate('')
    setIsDerived(false)
    setParentPlanId('')
    setDerivationValue('')
    setMinStayNights('')
    setAdvanceBookingDays('')
    setInclusions('')
    setCancellationPolicy('')
    setDepositPolicy('')
  }

  const calculateDerivedRate = (plan: RatePlan): number => {
    if (!plan.isDerived || !plan.parentPlanId) return plan.baseRate

    const parentPlan = ratePlans.find(p => p.id === plan.parentPlanId)
    if (!parentPlan) return 0

    const parentRate = parentPlan.baseRate

    switch (plan.derivationType) {
      case 'MARKUP':
        return parentRate * (1 + (plan.derivationValue || 0) / 100)
      case 'MARKDOWN':
        return parentRate * (1 - (plan.derivationValue || 0) / 100)
      case 'FIXED_DELTA':
        return parentRate + (plan.derivationValue || 0)
      default:
        return parentRate
    }
  }

  const activePlans = ratePlans.filter(p => p.status === 'ACTIVE')
  const inactivePlans = ratePlans.filter(p => p.status === 'INACTIVE')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Rate Plans</h2>
          <p className="text-sm text-muted-foreground">Manage pricing strategies and rate plan configurations</p>
        </div>
        <Button onClick={() => setShowAddDialog(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Create Rate Plan
        </Button>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              Active Rate Plans ({activePlans.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px] pr-4">
              {activePlans.length === 0 ? (
                <div className="text-center py-12">
                  <Tag className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">No active rate plans</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activePlans.map(plan => {
                    const roomType = roomTypes.find(rt => rt.id === plan.roomTypeId)
                    const calculatedRate = plan.isDerived ? calculateDerivedRate(plan) : plan.baseRate

                    return (
                      <Card key={plan.id} className="overflow-hidden">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-semibold text-lg">{plan.name}</h3>
                                <Badge variant="outline" className="font-mono text-xs">
                                  {plan.code}
                                </Badge>
                                {plan.isMasterPlan && (
                                  <Badge variant="secondary" className="text-xs">Master</Badge>
                                )}
                                {plan.isDerived && (
                                  <Badge variant="outline" className="text-xs">Derived</Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground mb-2">{plan.description}</p>
                              <div className="flex items-center gap-4 text-sm">
                                <div className="flex items-center gap-1">
                                  <Tag className="w-4 h-4 text-muted-foreground" />
                                  <span className="text-muted-foreground">{roomType?.name || 'Unknown'}</span>
                                </div>
                                {plan.restrictions.minStayNights && (
                                  <div className="flex items-center gap-1">
                                    <CalendarBlank className="w-4 h-4 text-muted-foreground" />
                                    <span className="text-muted-foreground">Min {plan.restrictions.minStayNights}N</span>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-3xl font-bold">฿{Math.round(calculatedRate).toLocaleString()}</p>
                              <p className="text-xs text-muted-foreground">per night</p>
                              {plan.isDerived && (
                                <p className="text-xs text-primary mt-1">
                                  {plan.derivationType === 'MARKUP' && `+${plan.derivationValue}%`}
                                  {plan.derivationType === 'MARKDOWN' && `-${plan.derivationValue}%`}
                                  {plan.derivationType === 'FIXED_DELTA' && `${(plan.derivationValue ?? 0) >= 0 ? '+' : ''}฿${plan.derivationValue ?? 0}`}
                                </p>
                              )}
                            </div>
                          </div>

                          {plan.inclusions.length > 0 && (
                            <div className="mb-3 p-2 bg-muted/50 rounded text-xs">
                              <p className="font-medium mb-1">Inclusions:</p>
                              <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                                {plan.inclusions.slice(0, 3).map((inc, i) => (
                                  <li key={i}>{inc}</li>
                                ))}
                                {plan.inclusions.length > 3 && (
                                  <li className="text-primary">+{plan.inclusions.length - 3} more</li>
                                )}
                              </ul>
                            </div>
                          )}

                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => togglePlanStatus(plan.id)}
                            >
                              Deactivate
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDuplicatePlan(plan)}
                            >
                              <Copy className="w-4 h-4 mr-1" />
                              Duplicate
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => handleDeletePlan(plan.id)}
                            >
                              <Trash className="w-4 h-4 mr-1" />
                              Delete
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {inactivePlans.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-muted-foreground">
                Inactive Rate Plans ({inactivePlans.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {inactivePlans.map(plan => (
                  <div key={plan.id} className="flex items-center justify-between p-3 bg-muted/30 rounded">
                    <div>
                      <p className="font-medium text-sm">{plan.name}</p>
                      <p className="text-xs text-muted-foreground">{plan.code}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => togglePlanStatus(plan.id)}
                      >
                        Activate
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeletePlan(plan.id)}
                      >
                        <Trash className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Rate Plan</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Plan Name *</Label>
                <Input
                  placeholder="e.g., Best Available Rate"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Plan Code *</Label>
                <Input
                  placeholder="e.g., BAR"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                placeholder="Describe this rate plan..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>Room Type *</Label>
              <Select value={roomTypeId} onValueChange={setRoomTypeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select room type" />
                </SelectTrigger>
                <SelectContent>
                  {roomTypes.map(rt => (
                    <SelectItem key={rt.id} value={rt.id}>{rt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <Switch checked={isDerived} onCheckedChange={setIsDerived} />
              <Label className="cursor-pointer">Derived from another rate plan</Label>
            </div>

            {!isDerived ? (
              <div className="space-y-2">
                <Label>Base Rate (฿) *</Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={baseRate}
                  onChange={(e) => setBaseRate(e.target.value)}
                />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Parent Rate Plan *</Label>
                  <Select value={parentPlanId} onValueChange={setParentPlanId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select parent plan" />
                    </SelectTrigger>
                    <SelectContent>
                      {ratePlans.filter(p => p.roomTypeId === roomTypeId && !p.isDerived).map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Derivation Type</Label>
                    <Select value={derivationType} onValueChange={(v: any) => setDerivationType(v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MARKUP">Markup %</SelectItem>
                        <SelectItem value="MARKDOWN">Markdown %</SelectItem>
                        <SelectItem value="FIXED_DELTA">Fixed Amount</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Value</Label>
                    <Input
                      type="number"
                      placeholder={derivationType === 'FIXED_DELTA' ? '฿ amount' : '% value'}
                      value={derivationValue}
                      onChange={(e) => setDerivationValue(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Min Stay Nights</Label>
                <Input
                  type="number"
                  placeholder="Optional"
                  value={minStayNights}
                  onChange={(e) => setMinStayNights(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Advance Booking Days</Label>
                <Input
                  type="number"
                  placeholder="Optional"
                  value={advanceBookingDays}
                  onChange={(e) => setAdvanceBookingDays(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Inclusions (one per line)</Label>
              <Textarea
                placeholder="Breakfast included&#10;Free WiFi&#10;Late checkout"
                value={inclusions}
                onChange={(e) => setInclusions(e.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label>Cancellation Policy</Label>
              <Textarea
                placeholder="e.g., Free cancellation up to 48 hours before arrival"
                value={cancellationPolicy}
                onChange={(e) => setCancellationPolicy(e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>Deposit Policy</Label>
              <Textarea
                placeholder="e.g., 50% deposit required at booking"
                value={depositPolicy}
                onChange={(e) => setDepositPolicy(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowAddDialog(false)
              resetForm()
            }}>
              Cancel
            </Button>
            <Button onClick={handleCreatePlan}>Create Rate Plan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
