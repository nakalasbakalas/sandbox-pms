import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  ChartLine,
  TrendUp,
  CurrencyDollar,
  Users,
  Bed,
  ArrowUp,
  ArrowDown,
} from '@phosphor-icons/react'
import { addDays, format, subDays } from 'date-fns'

interface RevenueData {
  date: string
  roomRevenue: number
  extraGuestRevenue: number
  serviceRevenue: number
  totalRevenue: number
  occupancyRate: number
  adr: number
  revpar: number
}

export function AdvancedRevenueAnalyticsView() {
  const [dateRange, setDateRange] = useState<'7d' | '30d' | 'mtd' | 'ytd'>('30d')
  const [compareWith, setCompareWith] = useState<'previous' | 'last-year' | 'none'>('previous')

  const generateMockData = (daysBack: number): RevenueData[] => {
    const data: RevenueData[] = []
    for (let i = daysBack; i >= 0; i--) {
      const date = subDays(new Date(), i)
      const baseRevenue = 30000 + Math.random() * 20000
      const occupancy = 0.5 + Math.random() * 0.4
      const adr = baseRevenue / (30 * occupancy)
      
      data.push({
        date: format(date, 'yyyy-MM-dd'),
        roomRevenue: baseRevenue,
        extraGuestRevenue: Math.random() * 3000,
        serviceRevenue: Math.random() * 5000,
        totalRevenue: baseRevenue + Math.random() * 8000,
        occupancyRate: occupancy * 100,
        adr,
        revpar: adr * occupancy,
      })
    }
    return data
  }

  const currentData = useMemo(() => {
    switch (dateRange) {
      case '7d':
        return generateMockData(7)
      case '30d':
        return generateMockData(30)
      case 'mtd':
        return generateMockData(new Date().getDate())
      default:
        return generateMockData(30)
    }
  }, [dateRange])

  const previousData = useMemo(() => {
    return compareWith === 'previous' ? generateMockData(currentData.length) : []
  }, [compareWith, currentData.length])

  const currentTotals = useMemo(() => {
    return {
      totalRevenue: currentData.reduce((sum, d) => sum + d.totalRevenue, 0),
      roomRevenue: currentData.reduce((sum, d) => sum + d.roomRevenue, 0),
      extraGuestRevenue: currentData.reduce((sum, d) => sum + d.extraGuestRevenue, 0),
      serviceRevenue: currentData.reduce((sum, d) => sum + d.serviceRevenue, 0),
      avgOccupancy: currentData.reduce((sum, d) => sum + d.occupancyRate, 0) / currentData.length,
      avgAdr: currentData.reduce((sum, d) => sum + d.adr, 0) / currentData.length,
      avgRevpar: currentData.reduce((sum, d) => sum + d.revpar, 0) / currentData.length,
    }
  }, [currentData])

  const previousTotals = useMemo(() => {
    if (previousData.length === 0) return null
    return {
      totalRevenue: previousData.reduce((sum, d) => sum + d.totalRevenue, 0),
      avgOccupancy: previousData.reduce((sum, d) => sum + d.occupancyRate, 0) / previousData.length,
      avgAdr: previousData.reduce((sum, d) => sum + d.adr, 0) / previousData.length,
      avgRevpar: previousData.reduce((sum, d) => sum + d.revpar, 0) / previousData.length,
    }
  }, [previousData])

  const changes = useMemo(() => {
    if (!previousTotals) return null
    return {
      revenue: ((currentTotals.totalRevenue - previousTotals.totalRevenue) / previousTotals.totalRevenue) * 100,
      occupancy: currentTotals.avgOccupancy - previousTotals.avgOccupancy,
      adr: ((currentTotals.avgAdr - previousTotals.avgAdr) / previousTotals.avgAdr) * 100,
      revpar: ((currentTotals.avgRevpar - previousTotals.avgRevpar) / previousTotals.avgRevpar) * 100,
    }
  }, [currentTotals, previousTotals])

  const trendSummary = useMemo(() => {
    const sampleSize = Math.min(7, currentData.length)
    const opening = currentData.slice(0, sampleSize)
    const closing = currentData.slice(-sampleSize)
    const average = (data: RevenueData[], key: keyof RevenueData) =>
      data.reduce((sum, day) => sum + Number(day[key]), 0) / Math.max(data.length, 1)

    return {
      revenueMomentum: ((average(closing, 'totalRevenue') - average(opening, 'totalRevenue')) / average(opening, 'totalRevenue')) * 100,
      occupancyMomentum: average(closing, 'occupancyRate') - average(opening, 'occupancyRate'),
      adrMomentum: ((average(closing, 'adr') - average(opening, 'adr')) / average(opening, 'adr')) * 100,
      bestDay: [...currentData].sort((a, b) => b.totalRevenue - a.totalRevenue)[0],
      softestDay: [...currentData].sort((a, b) => a.totalRevenue - b.totalRevenue)[0],
    }
  }, [currentData])

  const forecastRows = useMemo(() => {
    const recent = currentData.slice(-7)
    const recentRevenue = recent.reduce((sum, day) => sum + day.totalRevenue, 0) / Math.max(recent.length, 1)
    const recentOccupancy = recent.reduce((sum, day) => sum + day.occupancyRate, 0) / Math.max(recent.length, 1)
    const dailyMomentum = Math.max(-0.03, Math.min(0.03, trendSummary.revenueMomentum / 100 / 7))
    const lastDate = new Date(currentData[currentData.length - 1].date)

    return Array.from({ length: 7 }, (_, index) => {
      const factor = 1 + dailyMomentum * (index + 1)
      const projectedRevenue = recentRevenue * factor
      const projectedOccupancy = Math.max(0, Math.min(100, recentOccupancy + trendSummary.occupancyMomentum * ((index + 1) / 7)))

      return {
        date: addDays(lastDate, index + 1),
        projectedRevenue,
        projectedOccupancy,
        projectedAdr: projectedRevenue / Math.max(1, 30 * (projectedOccupancy / 100)),
      }
    })
  }, [currentData, trendSummary])

  const MetricCard = ({ 
    title, 
    value, 
    suffix, 
    change, 
    icon 
  }: { 
    title: string
    value: number
    suffix?: string
    change?: number
    icon: React.ReactNode
  }) => (
    <Card className="p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="text-muted-foreground">{icon}</div>
      </div>
      <div className="text-2xl font-bold mb-1">
        {suffix === '฿' && suffix}
        {value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        {suffix && suffix !== '฿' && suffix}
      </div>
      {change !== undefined && (
        <div className={`text-xs flex items-center gap-1 ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {change >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
          {Math.abs(change).toFixed(1)}% vs previous
        </div>
      )}
    </Card>
  )

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="border-b border-border bg-card">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-semibold flex items-center gap-2">
                <ChartLine className="w-6 h-6" />
                Advanced Revenue Analytics
              </h1>
              <p className="text-sm text-muted-foreground mt-1">Comprehensive revenue insights and performance metrics</p>
            </div>
            <div className="flex gap-2">
              <Select value={dateRange} onValueChange={(v) => setDateRange(v as any)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 Days</SelectItem>
                  <SelectItem value="30d">Last 30 Days</SelectItem>
                  <SelectItem value="mtd">Month to Date</SelectItem>
                  <SelectItem value="ytd">Year to Date</SelectItem>
                </SelectContent>
              </Select>
              <Select value={compareWith} onValueChange={(v) => setCompareWith(v as any)}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Comparison</SelectItem>
                  <SelectItem value="previous">Previous Period</SelectItem>
                  <SelectItem value="last-year">Same Period Last Year</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <MetricCard
              title="Total Revenue"
              value={currentTotals.totalRevenue}
              suffix="฿"
              change={changes?.revenue}
              icon={<CurrencyDollar className="w-5 h-5" />}
            />
            <MetricCard
              title="Avg Occupancy"
              value={currentTotals.avgOccupancy}
              suffix="%"
              change={changes?.occupancy}
              icon={<Bed className="w-5 h-5" />}
            />
            <MetricCard
              title="Avg ADR"
              value={currentTotals.avgAdr}
              suffix="฿"
              change={changes?.adr}
              icon={<Users className="w-5 h-5" />}
            />
            <MetricCard
              title="Avg RevPAR"
              value={currentTotals.avgRevpar}
              suffix="฿"
              change={changes?.revpar}
              icon={<TrendUp className="w-5 h-5" />}
            />
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="flex-1 flex flex-col">
        <div className="border-b border-border px-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="breakdown">Revenue Breakdown</TabsTrigger>
            <TabsTrigger value="trends">Trends</TabsTrigger>
            <TabsTrigger value="forecast">Forecast</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="flex-1 p-6 mt-0 space-y-6">
          <div className="grid grid-cols-3 gap-6">
            <Card className="p-6">
              <h3 className="font-semibold mb-4">Revenue by Source</h3>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Room Revenue</span>
                    <span className="font-medium">฿{currentTotals.roomRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-600" 
                      style={{ width: `${(currentTotals.roomRevenue / currentTotals.totalRevenue) * 100}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Extra Guest</span>
                    <span className="font-medium">฿{currentTotals.extraGuestRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-green-600" 
                      style={{ width: `${(currentTotals.extraGuestRevenue / currentTotals.totalRevenue) * 100}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Services</span>
                    <span className="font-medium">฿{currentTotals.serviceRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-purple-600" 
                      style={{ width: `${(currentTotals.serviceRevenue / currentTotals.totalRevenue) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="font-semibold mb-4">Performance Metrics</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Average Occupancy</span>
                  <span className="font-medium">{currentTotals.avgOccupancy.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Average ADR</span>
                  <span className="font-medium">฿{currentTotals.avgAdr.toFixed(0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Average RevPAR</span>
                  <span className="font-medium">฿{currentTotals.avgRevpar.toFixed(0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Room Nights</span>
                  <span className="font-medium">{(currentData.length * 30 * currentTotals.avgOccupancy / 100).toFixed(0)}</span>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="font-semibold mb-4">Best Performing Days</h3>
              <div className="space-y-2">
                {currentData
                  .sort((a, b) => b.totalRevenue - a.totalRevenue)
                  .slice(0, 5)
                  .map(day => (
                    <div key={day.date} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{format(new Date(day.date), 'MMM dd')}</span>
                      <span className="font-medium">฿{day.totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    </div>
                  ))}
              </div>
            </Card>
          </div>

          <Card className="p-6">
            <h3 className="font-semibold mb-4">Daily Revenue Trend</h3>
            <div className="h-64 flex items-end gap-1">
              {currentData.map(day => (
                <div 
                  key={day.date} 
                  className="flex-1 bg-blue-500 rounded-t hover:bg-blue-600 transition-colors relative group"
                  style={{ height: `${(day.totalRevenue / Math.max(...currentData.map(d => d.totalRevenue))) * 100}%` }}
                >
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                    {format(new Date(day.date), 'MMM dd')}: ฿{day.totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-between text-xs text-muted-foreground">
              <span>{format(new Date(currentData[0].date), 'MMM dd')}</span>
              <span>{format(new Date(currentData[currentData.length - 1].date), 'MMM dd')}</span>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="breakdown" className="flex-1 p-6 mt-0">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Room Revenue</TableHead>
                  <TableHead className="text-right">Extra Guest</TableHead>
                  <TableHead className="text-right">Services</TableHead>
                  <TableHead className="text-right">Total Revenue</TableHead>
                  <TableHead className="text-right">Occupancy</TableHead>
                  <TableHead className="text-right">ADR</TableHead>
                  <TableHead className="text-right">RevPAR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentData.map(day => (
                  <TableRow key={day.date}>
                    <TableCell className="font-medium">{format(new Date(day.date), 'MMM dd, yyyy')}</TableCell>
                    <TableCell className="text-right">฿{day.roomRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                    <TableCell className="text-right">฿{day.extraGuestRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                    <TableCell className="text-right">฿{day.serviceRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                    <TableCell className="text-right font-semibold">฿{day.totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                    <TableCell className="text-right">{day.occupancyRate.toFixed(1)}%</TableCell>
                    <TableCell className="text-right">฿{day.adr.toFixed(0)}</TableCell>
                    <TableCell className="text-right">฿{day.revpar.toFixed(0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="trends" className="flex-1 p-6 mt-0">
          <div className="grid grid-cols-3 gap-6">
            <Card className="p-6">
              <h3 className="font-semibold mb-4">Momentum</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Revenue trend</span>
                  <span className={trendSummary.revenueMomentum >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                    {trendSummary.revenueMomentum >= 0 ? '+' : ''}{trendSummary.revenueMomentum.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Occupancy trend</span>
                  <span className={trendSummary.occupancyMomentum >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                    {trendSummary.occupancyMomentum >= 0 ? '+' : ''}{trendSummary.occupancyMomentum.toFixed(1)} pts
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ADR trend</span>
                  <span className={trendSummary.adrMomentum >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                    {trendSummary.adrMomentum >= 0 ? '+' : ''}{trendSummary.adrMomentum.toFixed(1)}%
                  </span>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="font-semibold mb-4">Peak Revenue Day</h3>
              <div className="text-2xl font-bold mb-2">
                {format(new Date(trendSummary.bestDay.date), 'MMM dd')}
              </div>
              <p className="text-sm text-muted-foreground">
                THB {trendSummary.bestDay.totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })} at {trendSummary.bestDay.occupancyRate.toFixed(1)}% occupancy
              </p>
            </Card>

            <Card className="p-6">
              <h3 className="font-semibold mb-4">Softest Revenue Day</h3>
              <div className="text-2xl font-bold mb-2">
                {format(new Date(trendSummary.softestDay.date), 'MMM dd')}
              </div>
              <p className="text-sm text-muted-foreground">
                THB {trendSummary.softestDay.totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })} at {trendSummary.softestDay.occupancyRate.toFixed(1)}% occupancy
              </p>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="forecast" className="flex-1 p-6 mt-0">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Projected Revenue</TableHead>
                  <TableHead className="text-right">Projected Occupancy</TableHead>
                  <TableHead className="text-right">Projected ADR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {forecastRows.map(day => (
                  <TableRow key={day.date.toISOString()}>
                    <TableCell className="font-medium">{format(day.date, 'MMM dd, yyyy')}</TableCell>
                    <TableCell className="text-right">THB {day.projectedRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                    <TableCell className="text-right">{day.projectedOccupancy.toFixed(1)}%</TableCell>
                    <TableCell className="text-right">THB {day.projectedAdr.toFixed(0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
