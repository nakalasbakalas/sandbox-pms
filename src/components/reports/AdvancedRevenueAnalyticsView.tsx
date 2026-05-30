import { useMemo, useState, type ReactNode } from 'react'
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
import { format, startOfMonth, startOfYear, subDays, subYears } from 'date-fns'
import { useReportsData } from '@/hooks/use-reports-data'

type RangeKey = '7d' | '30d' | 'mtd' | 'ytd'
type ComparisonKey = 'previous' | 'last-year' | 'none'

interface DateRange {
  from: Date
  to: Date
}

function getDateRange(range: RangeKey): DateRange {
  const today = new Date()
  switch (range) {
    case '7d':
      return { from: subDays(today, 6), to: today }
    case 'mtd':
      return { from: startOfMonth(today), to: today }
    case 'ytd':
      return { from: startOfYear(today), to: today }
    case '30d':
    default:
      return { from: subDays(today, 29), to: today }
  }
}

function getComparisonRange(currentRange: DateRange, comparison: ComparisonKey): DateRange {
  const days = Math.max(1, Math.round((currentRange.to.getTime() - currentRange.from.getTime()) / 86_400_000) + 1)
  if (comparison === 'last-year') {
    return { from: subYears(currentRange.from, 1), to: subYears(currentRange.to, 1) }
  }
  return {
    from: subDays(currentRange.from, days),
    to: subDays(currentRange.from, 1),
  }
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function percentChange(current: number, previous: number): number | undefined {
  if (!previous) return undefined
  return ((current - previous) / previous) * 100
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

export function AdvancedRevenueAnalyticsView() {
  const [dateRangeKey, setDateRangeKey] = useState<RangeKey>('30d')
  const [compareWith, setCompareWith] = useState<ComparisonKey>('previous')
  const currentRange = useMemo(() => getDateRange(dateRangeKey), [dateRangeKey])
  const comparisonRange = useMemo(() => getComparisonRange(currentRange, compareWith), [currentRange, compareWith])
  const { revenueData } = useReportsData(currentRange)
  const comparison = useReportsData(comparisonRange)

  const currentTotals = revenueData.summary
  const previousTotals = compareWith === 'none' ? null : comparison.revenueData.summary
  const changes = previousTotals ? {
    revenue: percentChange(currentTotals.totalRevenue, previousTotals.totalRevenue),
    occupancy: currentTotals.avgOccupancy * 100 - previousTotals.avgOccupancy * 100,
    adr: percentChange(currentTotals.avgADR, previousTotals.avgADR),
    revpar: percentChange(currentTotals.avgRevPAR, previousTotals.avgRevPAR),
  } : null

  const trendSummary = useMemo(() => {
    const sampleSize = Math.min(7, revenueData.dailyStats.length)
    const opening = revenueData.dailyStats.slice(0, sampleSize)
    const closing = revenueData.dailyStats.slice(-sampleSize)
    const openingRevenue = average(opening.map((day) => day.totalRevenue))
    const closingRevenue = average(closing.map((day) => day.totalRevenue))
    const bestDay = [...revenueData.dailyStats].sort((a, b) => b.totalRevenue - a.totalRevenue)[0]
    const softestDay = [...revenueData.dailyStats].sort((a, b) => a.totalRevenue - b.totalRevenue)[0]

    return {
      revenueMomentum: percentChange(closingRevenue, openingRevenue),
      occupancyMomentum: average(closing.map((day) => day.occupancyRate * 100)) - average(opening.map((day) => day.occupancyRate * 100)),
      adrMomentum: percentChange(average(closing.map((day) => day.adr)), average(opening.map((day) => day.adr))),
      bestDay,
      softestDay,
    }
  }, [revenueData])

  const hasRevenueData = currentTotals.totalRevenue > 0 || currentTotals.totalRoomNights > 0
  const maxDailyRevenue = Math.max(1, ...revenueData.dailyStats.map((day) => day.totalRevenue))

  const MetricCard = ({
    title,
    value,
    change,
    icon,
  }: {
    title: string
    value: string
    change?: number
    icon: ReactNode
  }) => (
    <Card className="p-4">
      <div className="mb-2 flex items-start justify-between">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="text-muted-foreground">{icon}</div>
      </div>
      <div className="mb-1 text-2xl font-bold">{value}</div>
      {change !== undefined && Number.isFinite(change) && (
        <div className={`flex items-center gap-1 text-xs ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {change >= 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
          {Math.abs(change).toFixed(1)}% vs comparison
        </div>
      )}
    </Card>
  )

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b border-border bg-card">
        <div className="px-6 py-4">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-semibold">
                <ChartLine className="size-6" />
                Advanced Revenue Analytics
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Revenue performance from recorded reservations and folios
              </p>
            </div>
            <div className="flex gap-2">
              <Select value={dateRangeKey} onValueChange={(value) => setDateRangeKey(value as RangeKey)}>
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
              <Select value={compareWith} onValueChange={(value) => setCompareWith(value as ComparisonKey)}>
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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Total Revenue"
              value={formatCurrency(currentTotals.totalRevenue)}
              change={changes?.revenue}
              icon={<CurrencyDollar className="size-5" />}
            />
            <MetricCard
              title="Avg Occupancy"
              value={`${(currentTotals.avgOccupancy * 100).toFixed(1)}%`}
              change={changes?.occupancy}
              icon={<Bed className="size-5" />}
            />
            <MetricCard
              title="Avg ADR"
              value={formatCurrency(currentTotals.avgADR)}
              change={changes?.adr}
              icon={<Users className="size-5" />}
            />
            <MetricCard
              title="Avg RevPAR"
              value={formatCurrency(currentTotals.avgRevPAR)}
              change={changes?.revpar}
              icon={<TrendUp className="size-5" />}
            />
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="flex flex-1 flex-col">
        <div className="border-b border-border px-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="breakdown">Revenue Breakdown</TabsTrigger>
            <TabsTrigger value="trends">Trends</TabsTrigger>
            <TabsTrigger value="forecast">Forecast</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-0 flex-1 space-y-6 p-6">
          {!hasRevenueData && (
            <Card className="p-6">
              <h3 className="mb-2 font-semibold">No posted revenue for this period</h3>
              <p className="text-sm text-muted-foreground">
                Revenue appears here after reservations, folio charges, and payments are recorded.
              </p>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="p-6">
              <h3 className="mb-4 font-semibold">Revenue by Source</h3>
              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-muted-foreground">Room Revenue</span>
                    <span className="font-medium">{formatCurrency(currentTotals.roomRevenue)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-blue-600" style={{ width: `${Math.min(100, (currentTotals.roomRevenue / Math.max(1, currentTotals.totalRevenue)) * 100)}%` }} />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-muted-foreground">Other Folio Charges</span>
                    <span className="font-medium">{formatCurrency(currentTotals.extrasRevenue)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-green-600" style={{ width: `${Math.min(100, (currentTotals.extrasRevenue / Math.max(1, currentTotals.totalRevenue)) * 100)}%` }} />
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="mb-4 font-semibold">Performance Metrics</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Room Nights Sold</span>
                  <span className="font-medium">{currentTotals.totalRoomNights}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Deposits Collected</span>
                  <span className="font-medium">{formatCurrency(currentTotals.depositsCollected)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Deposits Pending</span>
                  <span className="font-medium">{formatCurrency(currentTotals.depositsPending)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Outstanding Balance</span>
                  <span className="font-medium">{formatCurrency(currentTotals.outstandingBalance)}</span>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="mb-4 font-semibold">Best Performing Days</h3>
              <div className="space-y-2">
                {[...revenueData.dailyStats]
                  .sort((a, b) => b.totalRevenue - a.totalRevenue)
                  .slice(0, 5)
                  .map((day) => (
                    <div key={day.date.toISOString()} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{format(day.date, 'MMM dd')}</span>
                      <span className="font-medium">{formatCurrency(day.totalRevenue)}</span>
                    </div>
                  ))}
              </div>
            </Card>
          </div>

          <Card className="p-6">
            <h3 className="mb-4 font-semibold">Daily Revenue Trend</h3>
            <div className="flex h-64 items-end gap-1">
              {revenueData.dailyStats.map((day) => (
                <div
                  key={day.date.toISOString()}
                  className="group relative flex-1 rounded-t bg-blue-500 transition-colors hover:bg-blue-600"
                  style={{ height: `${Math.max(2, (day.totalRevenue / maxDailyRevenue) * 100)}%` }}
                >
                  <div className="absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white group-hover:block">
                    {format(day.date, 'MMM dd')}: {formatCurrency(day.totalRevenue)}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-between text-xs text-muted-foreground">
              <span>{format(currentRange.from, 'MMM dd')}</span>
              <span>{format(currentRange.to, 'MMM dd')}</span>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="breakdown" className="mt-0 flex-1 p-6">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Room Revenue</TableHead>
                  <TableHead className="text-right">Other Charges</TableHead>
                  <TableHead className="text-right">Total Revenue</TableHead>
                  <TableHead className="text-right">Occupancy</TableHead>
                  <TableHead className="text-right">ADR</TableHead>
                  <TableHead className="text-right">RevPAR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revenueData.dailyStats.map((day) => (
                  <TableRow key={day.date.toISOString()}>
                    <TableCell className="font-medium">{format(day.date, 'MMM dd, yyyy')}</TableCell>
                    <TableCell className="text-right">{formatCurrency(day.roomRevenue)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(day.extrasRevenue)}</TableCell>
                    <TableCell className="text-right font-semibold">{formatCurrency(day.totalRevenue)}</TableCell>
                    <TableCell className="text-right">{(day.occupancyRate * 100).toFixed(1)}%</TableCell>
                    <TableCell className="text-right">{formatCurrency(day.adr)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(day.revpar)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="trends" className="mt-0 flex-1 p-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="p-6">
              <h3 className="mb-4 font-semibold">Momentum</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Revenue trend</span>
                  <span className={(trendSummary.revenueMomentum || 0) >= 0 ? 'font-medium text-green-600' : 'font-medium text-red-600'}>
                    {trendSummary.revenueMomentum === undefined ? 'No comparison' : `${trendSummary.revenueMomentum >= 0 ? '+' : ''}${trendSummary.revenueMomentum.toFixed(1)}%`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Occupancy trend</span>
                  <span className={trendSummary.occupancyMomentum >= 0 ? 'font-medium text-green-600' : 'font-medium text-red-600'}>
                    {trendSummary.occupancyMomentum >= 0 ? '+' : ''}{trendSummary.occupancyMomentum.toFixed(1)} pts
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ADR trend</span>
                  <span className={(trendSummary.adrMomentum || 0) >= 0 ? 'font-medium text-green-600' : 'font-medium text-red-600'}>
                    {trendSummary.adrMomentum === undefined ? 'No comparison' : `${trendSummary.adrMomentum >= 0 ? '+' : ''}${trendSummary.adrMomentum.toFixed(1)}%`}
                  </span>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="mb-4 font-semibold">Peak Revenue Day</h3>
              <div className="mb-2 text-2xl font-bold">
                {trendSummary.bestDay ? format(trendSummary.bestDay.date, 'MMM dd') : 'No data'}
              </div>
              <p className="text-sm text-muted-foreground">
                {trendSummary.bestDay
                  ? `${formatCurrency(trendSummary.bestDay.totalRevenue)} at ${(trendSummary.bestDay.occupancyRate * 100).toFixed(1)}% occupancy`
                  : 'Revenue is not posted for this period.'}
              </p>
            </Card>

            <Card className="p-6">
              <h3 className="mb-4 font-semibold">Softest Revenue Day</h3>
              <div className="mb-2 text-2xl font-bold">
                {trendSummary.softestDay ? format(trendSummary.softestDay.date, 'MMM dd') : 'No data'}
              </div>
              <p className="text-sm text-muted-foreground">
                {trendSummary.softestDay
                  ? `${formatCurrency(trendSummary.softestDay.totalRevenue)} at ${(trendSummary.softestDay.occupancyRate * 100).toFixed(1)}% occupancy`
                  : 'Revenue is not posted for this period.'}
              </p>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="forecast" className="mt-0 flex-1 p-6">
          <Card className="p-6">
            <h3 className="mb-2 font-semibold">Forecasting Not Enabled</h3>
            <p className="text-sm text-muted-foreground">
              This launch build shows recorded revenue only. Enable a forecasting model or use the predictive analytics on-the-books view before publishing future revenue projections.
            </p>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
