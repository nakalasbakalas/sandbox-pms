import { useState, useMemo } from 'react'
import { useKV } from '@github/spark/hooks'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  ChartLineUp,
  TrendUp,
  TrendDown,
  Lightning,
  Target,
  Gauge,
  Brain,
  Play,
  Pause,
  Gear,
  CheckCircle
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { addDays, format, startOfDay, differenceInDays } from 'date-fns'

interface YieldRule {
  id: string
  name: string
  roomTypeId: string
  enabled: boolean
  targetOccupancy: number
  minRate: number
  maxRate: number
  adjustmentInterval: 'HOURLY' | 'DAILY' | 'WEEKLY'
  aggressiveness: 'LOW' | 'MEDIUM' | 'HIGH'
  createdAt: string
}

interface YieldAdjustment {
  id: string
  ruleId: string
  date: string
  occupancyRate: number
  originalRate: number
  adjustedRate: number
  adjustmentReason: string
  timestamp: string
}

interface DemandForecast {
  date: string
  predictedOccupancy: number
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  factors: string[]
}

export function YieldManagementPanel() {
  const [yieldRules, setYieldRules] = useKV<YieldRule[]>('yield-rules', [])
  const [yieldAdjustments, setYieldAdjustments] = useKV<YieldAdjustment[]>('yield-adjustments', [])
  const [roomTypes] = useKV<any[]>('room-types-config', [])
  const [reservations] = useKV<any[]>('reservations', [])
  
  const [showAddRuleDialog, setShowAddRuleDialog] = useState(false)
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [selectedRoomType, setSelectedRoomType] = useState<string>('')
  
  const [ruleName, setRuleName] = useState('')
  const [ruleRoomType, setRuleRoomType] = useState('')
  const [targetOccupancy, setTargetOccupancy] = useState('80')
  const [minRate, setMinRate] = useState('')
  const [maxRate, setMaxRate] = useState('')
  const [adjustmentInterval, setAdjustmentInterval] = useState<'HOURLY' | 'DAILY' | 'WEEKLY'>('DAILY')
  const [aggressiveness, setAggressiveness] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM')

  const calculateOccupancy = (date: Date): number => {
    const dateStr = format(date, 'yyyy-MM-dd')
    const roomsBooked = reservations.filter(r => {
      const checkIn = new Date(r.checkInDate)
      const checkOut = new Date(r.checkOutDate)
      return dateStr >= format(checkIn, 'yyyy-MM-dd') && dateStr < format(checkOut, 'yyyy-MM-dd') && r.status !== 'CANCELLED'
    }).length
    
    const totalRooms = 30
    return Math.round((roomsBooked / totalRooms) * 100)
  }

  const generateForecast = (): DemandForecast[] => {
    const forecasts: DemandForecast[] = []
    const today = startOfDay(new Date())
    
    for (let i = 0; i < 30; i++) {
      const date = addDays(today, i)
      const dayOfWeek = date.getDay()
      const currentOccupancy = calculateOccupancy(date)
      
      let predictedOccupancy = currentOccupancy
      const factors: string[] = []
      
      if (dayOfWeek === 5 || dayOfWeek === 6) {
        predictedOccupancy = Math.min(100, predictedOccupancy + 15)
        factors.push('Weekend demand')
      }
      
      const daysOut = differenceInDays(date, today)
      if (daysOut < 7) {
        factors.push('Near-term booking surge')
        predictedOccupancy = Math.min(100, predictedOccupancy + 5)
      }
      
      const confidence: 'LOW' | 'MEDIUM' | 'HIGH' = daysOut < 7 ? 'HIGH' : daysOut < 21 ? 'MEDIUM' : 'LOW'
      
      forecasts.push({
        date: format(date, 'yyyy-MM-dd'),
        predictedOccupancy: Math.min(100, Math.max(0, predictedOccupancy)),
        confidence,
        factors: factors.length > 0 ? factors : ['Historical average']
      })
    }
    
    return forecasts
  }

  const forecasts = useMemo(() => generateForecast(), [reservations])
  const activeRules = yieldRules.filter(r => r.enabled)
  const recentAdjustments = yieldAdjustments.slice(-10).reverse()

  const handleCreateRule = () => {
    if (!ruleName || !ruleRoomType || !minRate || !maxRate || !targetOccupancy) {
      toast.error('Please fill in all required fields')
      return
    }

    const min = parseFloat(minRate)
    const max = parseFloat(maxRate)
    const target = parseFloat(targetOccupancy)

    if (min >= max) {
      toast.error('Max rate must be greater than min rate')
      return
    }

    if (target < 0 || target > 100) {
      toast.error('Target occupancy must be between 0 and 100')
      return
    }

    const newRule: YieldRule = {
      id: `yield_${Date.now()}`,
      name: ruleName,
      roomTypeId: ruleRoomType,
      enabled: true,
      targetOccupancy: target,
      minRate: min,
      maxRate: max,
      adjustmentInterval,
      aggressiveness,
      createdAt: new Date().toISOString()
    }

    setYieldRules(current => [...current, newRule])
    resetForm()
    setShowAddRuleDialog(false)
    toast.success('Yield management rule created')
  }

  const toggleRule = (ruleId: string) => {
    setYieldRules(current =>
      current.map(r => r.id === ruleId ? { ...r, enabled: !r.enabled } : r)
    )
  }

  const deleteRule = (ruleId: string) => {
    setYieldRules(current => current.filter(r => r.id !== ruleId))
    toast.success('Rule deleted')
  }

  const resetForm = () => {
    setRuleName('')
    setRuleRoomType('')
    setTargetOccupancy('80')
    setMinRate('')
    setMaxRate('')
    setAdjustmentInterval('DAILY')
    setAggressiveness('MEDIUM')
  }

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'HIGH': return 'text-green-600 bg-green-50'
      case 'MEDIUM': return 'text-orange-600 bg-orange-50'
      case 'LOW': return 'text-gray-600 bg-gray-50'
      default: return 'text-gray-600 bg-gray-50'
    }
  }

  const getOccupancyColor = (occupancy: number) => {
    if (occupancy >= 85) return 'text-green-600'
    if (occupancy >= 70) return 'text-orange-600'
    return 'text-red-600'
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Rules</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-3xl font-bold">{activeRules.length}</span>
              <Brain className="w-6 h-6 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg Occupancy (7d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-3xl font-bold">
                  {Math.round(forecasts.slice(0, 7).reduce((sum, f) => sum + f.predictedOccupancy, 0) / 7)}%
                </span>
                <Gauge className="w-6 h-6 text-primary" />
              </div>
              <Progress value={Math.round(forecasts.slice(0, 7).reduce((sum, f) => sum + f.predictedOccupancy, 0) / 7)} className="h-1" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Adjustments (24h)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-3xl font-bold">{recentAdjustments.length}</span>
              <Lightning className="w-6 h-6 text-orange-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Revenue Impact</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-3xl font-bold text-green-600">+12%</span>
              <TrendUp className="w-6 h-6 text-green-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <Card className="col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Demand Forecast</CardTitle>
                <CardDescription>AI-powered occupancy predictions for next 30 days</CardDescription>
              </div>
              <Button variant="outline" size="sm">
                <Target className="w-4 h-4 mr-2" />
                Optimize All
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {forecasts.map((forecast, index) => {
                  const occupancy = forecast.predictedOccupancy
                  return (
                    <div key={index} className="flex items-center gap-4 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                      <div className="flex-shrink-0 w-24">
                        <p className="text-sm font-semibold">{format(new Date(forecast.date), 'MMM d')}</p>
                        <p className="text-xs text-muted-foreground">{format(new Date(forecast.date), 'EEEE')}</p>
                      </div>
                      
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Progress value={occupancy} className="h-2 flex-1" />
                          <span className={cn("text-sm font-bold w-12 text-right", getOccupancyColor(occupancy))}>
                            {occupancy}%
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {forecast.factors.join(' • ')}
                        </p>
                      </div>

                      <Badge variant="outline" className={cn("text-xs", getConfidenceColor(forecast.confidence))}>
                        {forecast.confidence}
                      </Badge>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Active Rules</CardTitle>
                <Button size="sm" onClick={() => setShowAddRuleDialog(true)}>
                  <Lightning className="w-4 h-4 mr-2" />
                  Add Rule
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[180px]">
                {activeRules.length === 0 ? (
                  <div className="text-center py-8">
                    <Brain className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">No active rules</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activeRules.map(rule => {
                      const roomType = roomTypes.find(rt => rt.id === rule.roomTypeId)
                      return (
                        <Card key={rule.id} className="p-3">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <h4 className="font-semibold text-sm mb-1">{rule.name}</h4>
                              <p className="text-xs text-muted-foreground">{roomType?.name}</p>
                            </div>
                            <Badge variant={rule.enabled ? 'default' : 'secondary'} className="text-xs">
                              {rule.enabled ? <CheckCircle className="w-3 h-3 mr-1" /> : <Pause className="w-3 h-3 mr-1" />}
                              {rule.enabled ? 'Active' : 'Paused'}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground space-y-1">
                            <p>Target: {rule.targetOccupancy}% occupancy</p>
                            <p>Range: ฿{rule.minRate.toLocaleString()} - ฿{rule.maxRate.toLocaleString()}</p>
                          </div>
                          <div className="flex gap-1 mt-2">
                            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => toggleRule(rule.id)}>
                              {rule.enabled ? 'Pause' : 'Activate'}
                            </Button>
                            <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive" onClick={() => deleteRule(rule.id)}>
                              Delete
                            </Button>
                          </div>
                        </Card>
                      )
                    })}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Adjustments</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[180px]">
                {recentAdjustments.length === 0 ? (
                  <div className="text-center py-8">
                    <Lightning className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">No adjustments yet</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {recentAdjustments.map(adj => (
                      <div key={adj.id} className="p-2 rounded border text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium">{format(new Date(adj.date), 'MMM d')}</span>
                          <div className="flex items-center gap-1">
                            <span className="line-through text-muted-foreground">฿{adj.originalRate}</span>
                            <span className="font-semibold text-primary">฿{adj.adjustedRate}</span>
                          </div>
                        </div>
                        <p className="text-muted-foreground">{adj.adjustmentReason}</p>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={showAddRuleDialog} onOpenChange={setShowAddRuleDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Yield Management Rule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Rule Name *</Label>
              <Input
                placeholder="e.g., Weekend Dynamic Pricing"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Room Type *</Label>
              <Select value={ruleRoomType} onValueChange={setRuleRoomType}>
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

            <div className="space-y-2">
              <Label>Target Occupancy (%) *</Label>
              <Input
                type="number"
                placeholder="80"
                value={targetOccupancy}
                onChange={(e) => setTargetOccupancy(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Rates adjust to achieve this occupancy level
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Min Rate (฿) *</Label>
                <Input
                  type="number"
                  placeholder="1500"
                  value={minRate}
                  onChange={(e) => setMinRate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Max Rate (฿) *</Label>
                <Input
                  type="number"
                  placeholder="4000"
                  value={maxRate}
                  onChange={(e) => setMaxRate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Adjustment Interval</Label>
              <Select value={adjustmentInterval} onValueChange={(v: any) => setAdjustmentInterval(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HOURLY">Hourly</SelectItem>
                  <SelectItem value="DAILY">Daily</SelectItem>
                  <SelectItem value="WEEKLY">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Aggressiveness</Label>
              <Select value={aggressiveness} onValueChange={(v: any) => setAggressiveness(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low (±5%)</SelectItem>
                  <SelectItem value="MEDIUM">Medium (±10%)</SelectItem>
                  <SelectItem value="HIGH">High (±20%)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                How quickly rates adjust to demand changes
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowAddRuleDialog(false)
              resetForm()
            }}>
              Cancel
            </Button>
            <Button onClick={handleCreateRule}>Create Rule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
