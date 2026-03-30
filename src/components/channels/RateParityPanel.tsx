import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  CheckCircle,
  Warning,
  XCircle,
  Eye,
  EyeSlash,
  ArrowsClockwise,
  Gauge,
  Calendar,
  TrendUp,
  TrendDown,
  Check,
  X,
  Minus,
  CurrencyCircleDollar,
  Bell,
  SlidersHorizontal
} from '@phosphor-icons/react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { useRateParity } from '@/hooks/use-rate-parity'
import { toast } from 'sonner'

interface Channel {
  id: string
  name: string
  provider: string
  enabled: boolean
  connected: boolean
}

interface RateParityPanelProps {
  connectedChannels: Channel[]
}

export function RateParityPanel({ connectedChannels }: RateParityPanelProps) {
  const {
    violations,
    parityChecks,
    settings,
    checkRateParity,
    acknowledgeViolation,
    resolveViolation,
    ignoreViolation,
    bulkResolveViolations,
    getActiveViolations,
    getChannelHealth,
    getOverallParityScore,
    updateSettings,
    performAutoCheck
  } = useRateParity()

  const [checking, setChecking] = useState(false)
  const [selectedViolation, setSelectedViolation] = useState<string | null>(null)
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [selectedViolations, setSelectedViolations] = useState<Set<string>>(new Set())
  const [filterSeverity, setFilterSeverity] = useState<string>('all')
  const [filterChannel, setFilterChannel] = useState<string>('all')

  const activeViolations = getActiveViolations()
  const overallScore = getOverallParityScore()
  const enabledChannels = connectedChannels.filter(c => c.enabled && c.connected)

  const roomTypes = [
    { id: 'deluxe', name: 'Deluxe Room' },
    { id: 'superior', name: 'Superior Room' },
    { id: 'suite', name: 'Suite' }
  ]

  const handleCheckNow = async () => {
    if (enabledChannels.length === 0) {
      toast.error('No channels connected')
      return
    }

    setChecking(true)
    
    const today = format(new Date(), 'yyyy-MM-dd')
    const endDate = format(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd')

    for (const roomType of roomTypes) {
      await checkRateParity(
        roomType.id,
        today,
        endDate,
        enabledChannels.map(c => c.id)
      )
    }

    setChecking(false)
    toast.success('Rate parity check completed')
  }

  const handleResolveSelected = () => {
    if (selectedViolations.size === 0) return
    bulkResolveViolations(Array.from(selectedViolations), 'staff')
    setSelectedViolations(new Set())
  }

  const toggleViolationSelection = (violationId: string) => {
    const newSelection = new Set(selectedViolations)
    if (newSelection.has(violationId)) {
      newSelection.delete(violationId)
    } else {
      newSelection.add(violationId)
    }
    setSelectedViolations(newSelection)
  }

  const selectAllViolations = () => {
    const filtered = getFilteredViolations()
    setSelectedViolations(new Set(filtered.map(v => v.id)))
  }

  const clearSelection = () => {
    setSelectedViolations(new Set())
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': return 'text-red-600 bg-red-50 border-red-200'
      case 'HIGH': return 'text-orange-600 bg-orange-50 border-orange-200'
      case 'MEDIUM': return 'text-yellow-600 bg-yellow-50 border-yellow-200'
      case 'LOW': return 'text-blue-600 bg-blue-50 border-blue-200'
      default: return 'text-gray-600 bg-gray-50 border-gray-200'
    }
  }

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': return <XCircle className="w-4 h-4" />
      case 'HIGH': return <Warning className="w-4 h-4" />
      case 'MEDIUM': return <Warning className="w-4 h-4" />
      case 'LOW': return <Warning className="w-4 h-4" />
      default: return <Minus className="w-4 h-4" />
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 95) return 'text-green-600'
    if (score >= 85) return 'text-blue-600'
    if (score >= 75) return 'text-yellow-600'
    return 'text-red-600'
  }

  const getScoreStatus = (score: number) => {
    if (score >= 95) return 'EXCELLENT'
    if (score >= 85) return 'GOOD'
    if (score >= 75) return 'FAIR'
    return 'POOR'
  }

  const getFilteredViolations = () => {
    return activeViolations.filter(v => {
      if (filterSeverity !== 'all' && v.severity !== filterSeverity) return false
      if (filterChannel !== 'all' && v.channelId !== filterChannel) return false
      return true
    })
  }

  const filteredViolations = getFilteredViolations()

  const channelHealthData = enabledChannels.map(channel =>
    getChannelHealth(channel.id, channel.name)
  )

  const criticalCount = activeViolations.filter(v => v.severity === 'CRITICAL').length
  const highCount = activeViolations.filter(v => v.severity === 'HIGH').length
  const mediumCount = activeViolations.filter(v => v.severity === 'MEDIUM').length
  const lowCount = activeViolations.filter(v => v.severity === 'LOW').length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">Parity Score</span>
              <Gauge className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className={cn("text-4xl font-bold", getScoreColor(overallScore))}>
                {overallScore}
              </span>
              <span className="text-lg text-muted-foreground">/100</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {getScoreStatus(overallScore)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">Active Issues</span>
              <Warning className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold">
                {activeViolations.length}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Across {enabledChannels.length} channels
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">Critical</span>
              <XCircle className="w-4 h-4 text-red-600" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-red-600">
                {criticalCount}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Requires immediate action
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">Last Check</span>
              <Calendar className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">
              {parityChecks.length > 0
                ? format(new Date(parityChecks[0].timestamp), 'MMM d, HH:mm')
                : 'Never'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Auto-check: {settings.autoCheckEnabled ? 'ON' : 'OFF'}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold">Rate Parity Monitor</h3>
          {checking && <Badge variant="outline">Checking...</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettingsDialog(true)}
          >
            <SlidersHorizontal className="w-4 h-4 mr-2" />
            Settings
          </Button>
          <Button
            size="sm"
            onClick={handleCheckNow}
            disabled={checking || enabledChannels.length === 0}
          >
            <ArrowsClockwise className={cn("w-4 h-4 mr-2", checking && "animate-spin")} />
            Check Now
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {channelHealthData.map(health => (
          <Card key={health.channelId}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{health.channelName}</CardTitle>
                <Badge variant={
                  health.status === 'EXCELLENT' ? 'default' :
                  health.status === 'GOOD' ? 'secondary' :
                  health.status === 'FAIR' ? 'outline' : 'destructive'
                }>
                  {health.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-muted-foreground">Parity Score</span>
                  <span className={cn("text-sm font-bold", getScoreColor(health.parityScore))}>
                    {health.parityScore}%
                  </span>
                </div>
                <Progress value={health.parityScore} className="h-2" />
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-muted-foreground">Violations</p>
                  <p className="font-bold">{health.violationCount}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Avg Variance</p>
                  <p className="font-bold">{health.averageVariance.toFixed(1)}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Active Violations ({filteredViolations.length})</CardTitle>
              <CardDescription>Rate discrepancies requiring attention</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={filterSeverity} onValueChange={setFilterSeverity}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Severity</SelectItem>
                  <SelectItem value="CRITICAL">Critical</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="LOW">Low</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterChannel} onValueChange={setFilterChannel}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Channels</SelectItem>
                  {enabledChannels.map(channel => (
                    <SelectItem key={channel.id} value={channel.id}>
                      {channel.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {selectedViolations.size > 0 && (
            <div className="flex items-center gap-2 pt-2">
              <Button size="sm" variant="outline" onClick={clearSelection}>
                Clear ({selectedViolations.size})
              </Button>
              <Button size="sm" onClick={handleResolveSelected}>
                <Check className="w-4 h-4 mr-2" />
                Resolve Selected
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            {filteredViolations.length === 0 ? (
              <div className="text-center py-12">
                <CheckCircle className="w-16 h-16 mx-auto text-green-600 mb-4" />
                <h3 className="text-lg font-semibold mb-2">Perfect Rate Parity</h3>
                <p className="text-sm text-muted-foreground">
                  All channel rates match your PMS rates
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 mb-2 pb-2 border-b">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={selectAllViolations}
                  >
                    Select All
                  </Button>
                  <div className="flex gap-2 text-xs">
                    <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                      Critical: {criticalCount}
                    </Badge>
                    <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                      High: {highCount}
                    </Badge>
                    <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
                      Medium: {mediumCount}
                    </Badge>
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                      Low: {lowCount}
                    </Badge>
                  </div>
                </div>

                {filteredViolations.map(violation => {
                  const channel = connectedChannels.find(c => c.id === violation.channelId)
                  const roomType = roomTypes.find(r => r.id === violation.roomTypeId)
                  const isSelected = selectedViolations.has(violation.id)

                  return (
                    <Card key={violation.id} className={cn(
                      "transition-colors",
                      isSelected && "border-primary"
                    )}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-4">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleViolationSelection(violation.id)}
                            className="mt-1"
                          />
                          <div className="flex-1">
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className={cn("font-medium", getSeverityColor(violation.severity))}>
                                  {getSeverityIcon(violation.severity)}
                                  <span className="ml-1">{violation.severity}</span>
                                </Badge>
                                <span className="text-sm font-medium">{channel?.name}</span>
                                <span className="text-sm text-muted-foreground">•</span>
                                <span className="text-sm text-muted-foreground">{roomType?.name}</span>
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(violation.detectedAt), 'MMM d, HH:mm')}
                              </span>
                            </div>

                            <div className="grid grid-cols-3 gap-4 mb-3">
                              <div>
                                <p className="text-xs text-muted-foreground mb-1">Date</p>
                                <p className="text-sm font-medium">
                                  {format(new Date(violation.date), 'MMM d, yyyy')}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground mb-1">PMS Rate</p>
                                <p className="text-sm font-medium">
                                  ฿{violation.pmsRate.toLocaleString()}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground mb-1">Channel Rate</p>
                                <p className="text-sm font-medium flex items-center gap-1">
                                  ฿{violation.channelRate.toLocaleString()}
                                  {violation.variance > 0 ? (
                                    <TrendUp className="w-4 h-4 text-red-600" />
                                  ) : (
                                    <TrendDown className="w-4 h-4 text-blue-600" />
                                  )}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">
                                  Variance: 
                                </span>
                                <span className={cn(
                                  "text-sm font-bold",
                                  violation.variance > 0 ? "text-red-600" : "text-blue-600"
                                )}>
                                  {violation.variance > 0 ? '+' : ''}฿{violation.variance.toLocaleString()}
                                  ({violation.variancePercent > 0 ? '+' : ''}{violation.variancePercent.toFixed(1)}%)
                                </span>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => acknowledgeViolation(violation.id)}
                                  disabled={violation.status === 'ACKNOWLEDGED'}
                                >
                                  <Eye className="w-4 h-4 mr-1" />
                                  {violation.status === 'ACKNOWLEDGED' ? 'Acknowledged' : 'Acknowledge'}
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => resolveViolation(violation.id, 'staff')}
                                >
                                  <Check className="w-4 h-4 mr-1" />
                                  Resolve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => ignoreViolation(violation.id)}
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
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

      <Dialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rate Parity Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Auto-Check Enabled</Label>
                <p className="text-xs text-muted-foreground">Automatically check rates periodically</p>
              </div>
              <Switch
                checked={settings.autoCheckEnabled}
                onCheckedChange={(checked) => updateSettings({ autoCheckEnabled: checked })}
              />
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Alert Threshold (%)</Label>
              <Input
                type="number"
                value={settings.alertThreshold}
                onChange={(e) => updateSettings({ alertThreshold: parseFloat(e.target.value) })}
                min="0"
                max="100"
                step="0.5"
              />
              <p className="text-xs text-muted-foreground">
                Trigger alert when rate variance exceeds this percentage
              </p>
            </div>

            <div className="space-y-2">
              <Label>Check Interval (minutes)</Label>
              <Input
                type="number"
                value={settings.checkInterval / 60000}
                onChange={(e) => updateSettings({ checkInterval: parseInt(e.target.value) * 60000 })}
                min="5"
                max="1440"
              />
              <p className="text-xs text-muted-foreground">
                How often to automatically check rate parity
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowSettingsDialog(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
