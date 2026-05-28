import { useState, useMemo } from 'react'
import { useKV } from '@github/spark/hooks'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import {
  MagnifyingGlass,
  TrendUp,
  TrendDown,
  Equals,
  Plus,
  Trash,
  ArrowClockwise,
  ChartBar,
  Target
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

interface Competitor {
  id: string
  name: string
  url: string
  category: 'DIRECT' | 'NEARBY' | 'SIMILAR'
  enabled: boolean
  lastChecked?: string
}

interface CompetitorRate {
  id: string
  competitorId: string
  roomType: string
  date: string
  rate: number
  availability: 'HIGH' | 'MEDIUM' | 'LOW' | 'SOLD_OUT'
  timestamp: string
}

export function CompetitiveRateAnalysis() {
  const [competitors, setCompetitors] = useKV<Competitor[]>('competitors', [])
  const [competitorRates, setCompetitorRates] = useKV<CompetitorRate[]>('competitor-rates', [])
  const [roomTypes] = useKV<any[]>('room-types-config', [])
  
  const [showAddCompetitorDialog, setShowAddCompetitorDialog] = useState(false)
  const [selectedRoomType, setSelectedRoomType] = useState('')
  
  const [competitorName, setCompetitorName] = useState('')
  const [competitorUrl, setCompetitorUrl] = useState('')
  const [competitorCategory, setCompetitorCategory] = useState<'DIRECT' | 'NEARBY' | 'SIMILAR'>('NEARBY')

  const handleAddCompetitor = () => {
    if (!competitorName) {
      toast.error('Please enter competitor name')
      return
    }

    const newCompetitor: Competitor = {
      id: `comp_${Date.now()}`,
      name: competitorName,
      url: competitorUrl,
      category: competitorCategory,
      enabled: true
    }

    setCompetitors(current => [...current, newCompetitor])
    resetForm()
    setShowAddCompetitorDialog(false)
    toast.success('Competitor added')
  }

  const handleDeleteCompetitor = (id: string) => {
    setCompetitors(current => current.filter(c => c.id !== id))
    setCompetitorRates(current => current.filter(r => r.competitorId !== id))
    toast.success('Competitor removed')
  }

  const toggleCompetitor = (id: string) => {
    setCompetitors(current =>
      current.map(c => c.id === id ? { ...c, enabled: !c.enabled } : c)
    )
  }

  const handleRateImportNotConfigured = () => {
    toast.info('Live competitor rate import is not enabled. Connect a rate source before importing competitor prices.')
  }

  const resetForm = () => {
    setCompetitorName('')
    setCompetitorUrl('')
    setCompetitorCategory('NEARBY')
  }

  const getOurRate = (roomTypeId: string, date: string): number => {
    const roomType = roomTypes.find(rt => rt.id === roomTypeId)
    return roomType?.baseRate || 2500
  }

  const calculatePricePosition = (ourRate: number, competitorRate: number): 'HIGHER' | 'LOWER' | 'EQUAL' => {
    const diff = Math.abs(ourRate - competitorRate)
    if (diff < 50) return 'EQUAL'
    return ourRate > competitorRate ? 'HIGHER' : 'LOWER'
  }

  const groupedRates = useMemo(() => {
    const grouped: Record<string, CompetitorRate[]> = {}
    competitorRates.forEach(rate => {
      const key = `${rate.date}_${rate.roomType}`
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(rate)
    })
    return grouped
  }, [competitorRates])

  const activeCompetitors = competitors.filter(c => c.enabled)
  const averagePriceGap = useMemo(() => {
    const gaps = competitorRates
      .map((rate) => {
        const ourRate = getOurRate(rate.roomType, rate.date)
        return rate.rate > 0 ? ((ourRate - rate.rate) / rate.rate) * 100 : null
      })
      .filter((gap): gap is number => gap !== null)
    return gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : null
  }, [competitorRates, roomTypes])
  const competitiveIndex = averagePriceGap === null ? null : Math.max(0, Math.round(100 - Math.abs(averagePriceGap)))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Competitors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-3xl font-bold">{activeCompetitors.length}</span>
              <MagnifyingGlass className="w-6 h-6 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg Price Gap</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className={`text-3xl font-bold ${averagePriceGap !== null && averagePriceGap > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {averagePriceGap === null ? '--' : `${averagePriceGap > 0 ? '+' : ''}${averagePriceGap.toFixed(1)}%`}
              </span>
              {averagePriceGap !== null && averagePriceGap > 0 ? (
                <TrendUp className="w-6 h-6 text-red-600" />
              ) : (
                <TrendDown className="w-6 h-6 text-green-600" />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Competitive Index</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-3xl font-bold">{competitiveIndex === null ? '--' : competitiveIndex}</span>
              <ChartBar className="w-6 h-6 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Last Updated</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">
                {competitors.some(c => c.lastChecked) 
                  ? format(new Date(Math.max(...competitors.filter(c => c.lastChecked).map(c => new Date(c.lastChecked!).getTime()))), 'HH:mm')
                  : '--:--'
                }
              </span>
              <ArrowClockwise className="w-6 h-6 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <Card className="col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Rate Comparison</CardTitle>
                <CardDescription>Compare your rates against competitors</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={handleRateImportNotConfigured}>
                <ArrowClockwise className="w-4 h-4 mr-2" />
                Import Rates
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              {Object.keys(groupedRates).length === 0 ? (
                <div className="text-center py-12">
                  <ChartBar className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground mb-2">No competitor data available</p>
                  <p className="text-sm text-muted-foreground">Add competitors and import verified rates to start analysis</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(groupedRates).slice(0, 14).map(([key, rates]) => {
                    const [date, roomTypeId] = key.split('_')
                    const roomType = roomTypes.find(rt => rt.id === roomTypeId)
                    const ourRate = getOurRate(roomTypeId, date)
                    const avgCompRate = rates.reduce((sum, r) => sum + r.rate, 0) / rates.length

                    return (
                      <Card key={key} className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h4 className="font-semibold text-sm">{format(new Date(date), 'MMM d, yyyy')}</h4>
                            <p className="text-xs text-muted-foreground">{roomType?.name}</p>
                          </div>
                          <Badge variant={ourRate < avgCompRate ? 'default' : ourRate > avgCompRate ? 'secondary' : 'outline'}>
                            {ourRate < avgCompRate ? 'Competitive' : ourRate > avgCompRate ? 'Premium' : 'Market Rate'}
                          </Badge>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between p-2 bg-primary/10 rounded">
                            <span className="text-sm font-semibold">Our Rate</span>
                            <span className="text-lg font-bold">฿{ourRate.toLocaleString()}</span>
                          </div>

                          {rates.map(rate => {
                            const competitor = competitors.find(c => c.id === rate.competitorId)
                            const position = calculatePricePosition(ourRate, rate.rate)
                            
                            return (
                              <div key={rate.id} className="flex items-center justify-between p-2 border rounded">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm">{competitor?.name}</span>
                                  {position === 'HIGHER' && <TrendUp className="w-3 h-3 text-red-500" />}
                                  {position === 'LOWER' && <TrendDown className="w-3 h-3 text-green-500" />}
                                  {position === 'EQUAL' && <Equals className="w-3 h-3 text-gray-500" />}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold">฿{rate.rate.toLocaleString()}</span>
                                  <Badge variant="outline" className="text-xs">
                                    {rate.availability}
                                  </Badge>
                                </div>
                              </div>
                            )
                          })}
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
            <div className="flex items-center justify-between">
              <CardTitle>Competitors</CardTitle>
              <Button size="sm" onClick={() => setShowAddCompetitorDialog(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              {competitors.length === 0 ? (
                <div className="text-center py-12">
                  <Target className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">No competitors added</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {competitors.map(comp => (
                    <Card key={comp.id} className="p-3">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <h4 className="font-semibold text-sm mb-1">{comp.name}</h4>
                          <Badge variant="outline" className="text-xs mb-2">
                            {comp.category}
                          </Badge>
                          {comp.lastChecked && (
                            <p className="text-xs text-muted-foreground">
                              Updated: {format(new Date(comp.lastChecked), 'MMM d, HH:mm')}
                            </p>
                          )}
                        </div>
                        <Badge variant={comp.enabled ? 'default' : 'secondary'} className="text-xs">
                          {comp.enabled ? 'Active' : 'Paused'}
                        </Badge>
                      </div>
                      <div className="flex gap-1">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="h-7 text-xs flex-1"
                          onClick={handleRateImportNotConfigured}
                          disabled={!comp.enabled}
                        >
                          <ArrowClockwise className="w-3 h-3 mr-1" />
                          Import
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 text-xs"
                          onClick={() => toggleCompetitor(comp.id)}
                        >
                          {comp.enabled ? 'Pause' : 'Enable'}
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 w-7 p-0 text-destructive"
                          onClick={() => handleDeleteCompetitor(comp.id)}
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

      <Dialog open={showAddCompetitorDialog} onOpenChange={setShowAddCompetitorDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Competitor</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Competitor Name *</Label>
              <Input
                placeholder="e.g., Sunset Hotel"
                value={competitorName}
                onChange={(e) => setCompetitorName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Website URL</Label>
              <Input
                placeholder="https://..."
                value={competitorUrl}
                onChange={(e) => setCompetitorUrl(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant={competitorCategory === 'DIRECT' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setCompetitorCategory('DIRECT')}
                >
                  Direct
                </Button>
                <Button
                  variant={competitorCategory === 'NEARBY' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setCompetitorCategory('NEARBY')}
                >
                  Nearby
                </Button>
                <Button
                  variant={competitorCategory === 'SIMILAR' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setCompetitorCategory('SIMILAR')}
                >
                  Similar
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowAddCompetitorDialog(false)
              resetForm()
            }}>
              Cancel
            </Button>
            <Button onClick={handleAddCompetitor}>Add Competitor</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
