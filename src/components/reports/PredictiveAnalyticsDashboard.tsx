import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  TrendUp,
  TrendDown,
  ChartLine,
  Brain,
  Target,
  Warning,
  CheckCircle,
  CurrencyDollar,
  Bed,
  ArrowUp,
  ArrowDown,
  Sparkle,
  Lightbulb,
  ChartBar,
} from '@phosphor-icons/react'
import { addDays, format, subDays } from 'date-fns'
import { useReportsData } from '@/hooks/use-reports-data'

interface PredictiveMetric {
  label: string
  current: number
  forward: number
  trend: 'up' | 'down' | 'stable'
  change: number
  unit?: string
}

interface Insight {
  id: string
  type: 'opportunity' | 'warning' | 'info' | 'success'
  priority: 'high' | 'medium' | 'low'
  title: string
  description: string
  recommendation: string
  impact: string
}

interface AnomalyDetection {
  metric: string
  detected: boolean
  severity: 'high' | 'medium' | 'low'
  description: string
  expectedRange: [number, number]
  actualValue: number
}

interface ForecastPoint {
  date: string
  fullDate: string
  occupancy: number
  adr: number
  revenue: number
  revpar: number
  isWeekend: boolean
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function percentChange(current: number, previous: number): number {
  if (!previous) return current > 0 ? 100 : 0
  return ((current - previous) / previous) * 100
}

function trendFromChange(change: number): PredictiveMetric['trend'] {
  if (Math.abs(change) < 0.5) return 'stable'
  return change > 0 ? 'up' : 'down'
}

export function PredictiveAnalyticsDashboard() {
  const [timeHorizon, setTimeHorizon] = useState<'7d' | '14d' | '30d' | '90d'>('30d')
  const [selectedMetric, setSelectedMetric] = useState<'revenue' | 'occupancy' | 'adr' | 'revpar'>('revenue')
  const today = useMemo(() => new Date(), [])
  const horizonDays = Number.parseInt(timeHorizon, 10)
  const currentRange = useMemo(() => ({ from: subDays(today, 29), to: today }), [today])
  const forwardRange = useMemo(() => ({ from: today, to: addDays(today, horizonDays - 1) }), [today, horizonDays])
  const currentReports = useReportsData(currentRange)
  const forwardReports = useReportsData(forwardRange)

  const currentRevenue = currentReports.revenueData.summary
  const forwardRevenue = forwardReports.revenueData.summary
  const currentReservations = currentReports.reservationData.summary
  const forwardReservations = forwardReports.reservationData.summary

  const predictiveMetrics = useMemo<PredictiveMetric[]>(() => {
    const metrics = [
      {
        label: 'On-the-books Revenue',
        current: currentRevenue.totalRevenue,
        forward: forwardRevenue.totalRevenue,
        unit: 'THB',
      },
      {
        label: 'Occupancy Rate',
        current: currentRevenue.avgOccupancy * 100,
        forward: forwardRevenue.avgOccupancy * 100,
        unit: '%',
      },
      {
        label: 'ADR',
        current: currentRevenue.avgADR,
        forward: forwardRevenue.avgADR,
        unit: 'THB',
      },
      {
        label: 'RevPAR',
        current: currentRevenue.avgRevPAR,
        forward: forwardRevenue.avgRevPAR,
        unit: 'THB',
      },
      {
        label: 'Room Nights',
        current: currentRevenue.totalRoomNights,
        forward: forwardRevenue.totalRoomNights,
        unit: 'nights',
      },
      {
        label: 'Cancellation Rate',
        current: currentReservations.cancellationRate * 100,
        forward: forwardReservations.cancellationRate * 100,
        unit: '%',
      },
    ]

    return metrics.map((metric) => {
      const change = percentChange(metric.forward, metric.current)
      return {
        ...metric,
        change,
        trend: trendFromChange(change),
      }
    })
  }, [currentRevenue, forwardRevenue, currentReservations, forwardReservations])

  const anomalies = useMemo<AnomalyDetection[]>(() => {
    const forwardOccupancy = forwardRevenue.avgOccupancy * 100
    const cancellationRate = forwardReservations.cancellationRate * 100
    const outstandingBalance = currentRevenue.outstandingBalance

    return [
      {
        metric: 'Forward Occupancy',
        detected: forwardRevenue.totalRoomNights > 0 && forwardOccupancy < 35,
        severity: 'medium',
        description: 'Future on-the-books occupancy is below the launch review threshold.',
        expectedRange: [35, 100],
        actualValue: Number(forwardOccupancy.toFixed(1)),
      },
      {
        metric: 'Outstanding Balance',
        detected: outstandingBalance > 0,
        severity: outstandingBalance > currentRevenue.totalRevenue * 0.15 ? 'high' : 'low',
        description: 'Recorded folios still have unpaid balances that cashier should review.',
        expectedRange: [0, 0],
        actualValue: Math.round(outstandingBalance),
      },
      {
        metric: 'Cancellation Rate',
        detected: cancellationRate > 10,
        severity: cancellationRate > 20 ? 'high' : 'medium',
        description: 'Cancellation rate is above the operational review threshold for this window.',
        expectedRange: [0, 10],
        actualValue: Number(cancellationRate.toFixed(1)),
      },
    ]
  }, [currentRevenue, forwardRevenue, forwardReservations])

  const insights = useMemo<Insight[]>(() => {
    const items: Insight[] = []
    const forwardOccupancy = forwardRevenue.avgOccupancy * 100

    if (forwardRevenue.totalRoomNights === 0) {
      items.push({
        id: 'pickup-required',
        type: 'warning',
        priority: 'high',
        title: 'No Future Pickup Recorded',
        description: `No room nights are currently on the books for the next ${horizonDays} days.`,
        recommendation: 'Review availability, direct booking visibility, and OTA connectivity before launch.',
        impact: 'Prevents staff from relying on an empty forecast as actual demand.',
      })
    } else if (forwardOccupancy < 50) {
      items.push({
        id: 'occupancy-soft',
        type: 'opportunity',
        priority: 'medium',
        title: 'Forward Occupancy Is Soft',
        description: `Forward occupancy is ${forwardOccupancy.toFixed(1)}% for the selected horizon.`,
        recommendation: 'Check open room types and confirm rates are loaded on the active sales channels.',
        impact: 'Improves pickup using real inventory instead of speculative forecasts.',
      })
    } else {
      items.push({
        id: 'occupancy-healthy',
        type: 'success',
        priority: 'low',
        title: 'Forward Pickup Looks Healthy',
        description: `Forward occupancy is ${forwardOccupancy.toFixed(1)}% for the selected horizon.`,
        recommendation: 'Keep checking unpaid balances and room readiness as arrivals approach.',
        impact: 'Keeps front desk, cashier, and housekeeping aligned on confirmed demand.',
      })
    }

    if (currentRevenue.outstandingBalance > 0) {
      items.push({
        id: 'cashier-balance',
        type: 'warning',
        priority: 'high',
        title: 'Unpaid Folios Need Review',
        description: `${formatCurrency(currentRevenue.outstandingBalance)} is still outstanding in the selected period.`,
        recommendation: 'Cashier should review unpaid and partial folios before night audit.',
        impact: 'Reduces settlement surprises at checkout.',
      })
    }

    if (forwardReservations.totalReservations > 0) {
      items.push({
        id: 'arrival-planning',
        type: 'info',
        priority: 'medium',
        title: 'Plan Staffing From Arrivals',
        description: `${forwardReservations.totalReservations} future reservations are in the selected horizon.`,
        recommendation: 'Use arrivals, departures, and dirty-room counts together when assigning housekeeping work.',
        impact: 'Helps reception and housekeeping prepare from recorded reservations.',
      })
    }

    return items
  }, [currentRevenue, forwardRevenue, forwardReservations, horizonDays])

  const forecastData = useMemo<ForecastPoint[]>(() => forwardReports.revenueData.dailyStats.map((day) => ({
    date: format(day.date, 'MMM dd'),
    fullDate: format(day.date, 'yyyy-MM-dd'),
    occupancy: Number((day.occupancyRate * 100).toFixed(1)),
    adr: Math.round(day.adr),
    revenue: Math.round(day.totalRevenue),
    revpar: Math.round(day.revpar),
    isWeekend: [0, 6].includes(day.date.getDay()),
  })), [forwardReports])

  const kpiCards = [
    {
      title: 'On-the-books Revenue',
      value: formatCurrency(forwardRevenue.totalRevenue),
      subValue: `${forwardRevenue.totalRoomNights} room nights`,
      icon: TrendUp,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      title: 'Forward Occupancy',
      value: `${(forwardRevenue.avgOccupancy * 100).toFixed(1)}%`,
      subValue: `Next ${horizonDays} days`,
      icon: Bed,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      title: 'Forward ADR',
      value: formatCurrency(forwardRevenue.avgADR),
      subValue: 'From recorded reservations',
      icon: CurrencyDollar,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
    {
      title: 'Detected Review Items',
      value: anomalies.filter((item) => item.detected).length.toString(),
      subValue: 'From actual PMS data',
      icon: Warning,
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
    },
  ]

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Brain className="text-purple-600" weight="fill" />
            Predictive Analytics
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            On-the-books forward view from confirmed PMS reservations
          </p>
        </div>
        <Select value={timeHorizon} onValueChange={(value) => setTimeHorizon(value as typeof timeHorizon)}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">7 Days</SelectItem>
            <SelectItem value="14d">14 Days</SelectItem>
            <SelectItem value="30d">30 Days</SelectItem>
            <SelectItem value="90d">90 Days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((kpi) => (
          <Card key={kpi.title} className="professional-card">
            <CardContent className="p-3">
              <div className="mb-2 flex items-start justify-between">
                <div className={`rounded p-1.5 ${kpi.bgColor}`}>
                  <kpi.icon className={`${kpi.color} size-4`} weight="fill" />
                </div>
                <Badge variant="outline" className="h-5 px-1.5 py-0 text-xs">
                  live data
                </Badge>
              </div>
              <div className="text-2xl font-bold">{kpi.value}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{kpi.subValue}</div>
              <div className="mt-1 text-xs font-medium text-muted-foreground">{kpi.title}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="predictions" className="flex-1">
        <TabsList className="h-8">
          <TabsTrigger value="predictions" className="h-7 text-xs">
            <ChartLine className="mr-1.5 size-3.5" />
            Forward View
          </TabsTrigger>
          <TabsTrigger value="insights" className="h-7 text-xs">
            <Sparkle className="mr-1.5 size-3.5" />
            Data Insights
            {insights.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-xs">
                {insights.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="anomalies" className="h-7 text-xs">
            <Warning className="mr-1.5 size-3.5" />
            Review Items
            {anomalies.filter((item) => item.detected).length > 0 && (
              <Badge variant="destructive" className="ml-1.5 h-4 px-1 text-xs">
                {anomalies.filter((item) => item.detected).length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="forecasts" className="h-7 text-xs">
            <Target className="mr-1.5 size-3.5" />
            Daily Breakdown
          </TabsTrigger>
        </TabsList>

        <TabsContent value="predictions" className="mt-3 space-y-3">
          <Card className="professional-card">
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-sm font-semibold">Current vs Forward On-the-books</CardTitle>
              <CardDescription className="text-xs">
                Future values are based only on reservations already recorded in the PMS
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {predictiveMetrics.map((metric) => (
                  <div key={metric.label} className="rounded-lg border p-3">
                    <div className="mb-2 flex items-start justify-between">
                      <div>
                        <div className="mb-1 text-xs font-medium text-muted-foreground">{metric.label}</div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm text-muted-foreground">
                            {metric.unit === 'THB' ? formatCurrency(metric.current) : `${metric.current.toLocaleString()}${metric.unit === '%' ? '%' : ''}`}
                          </span>
                          <span className="text-base font-bold">
                            {metric.unit === 'THB' ? formatCurrency(metric.forward) : `${metric.forward.toLocaleString()}${metric.unit === '%' ? '%' : ''}`}
                          </span>
                        </div>
                      </div>
                      <Badge
                        variant={metric.trend === 'up' ? 'default' : metric.trend === 'down' ? 'destructive' : 'secondary'}
                        className="h-5 px-1.5 text-xs"
                      >
                        {metric.trend === 'up' ? <ArrowUp className="size-3" /> : metric.trend === 'down' ? <ArrowDown className="size-3" /> : null}
                        {Math.abs(metric.change).toFixed(1)}%
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Forward share</span>
                        <span className="font-medium">{Math.min(100, Math.abs(metric.change)).toFixed(0)}%</span>
                      </div>
                      <Progress value={Math.min(100, Math.abs(metric.change))} className="h-1" />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="professional-card">
            <CardHeader className="p-3 pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold">Forward Pickup</CardTitle>
                  <CardDescription className="text-xs">Recorded revenue, occupancy, ADR, and RevPAR by arrival horizon</CardDescription>
                </div>
                <Select value={selectedMetric} onValueChange={(value) => setSelectedMetric(value as typeof selectedMetric)}>
                  <SelectTrigger className="h-7 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="revenue">Revenue</SelectItem>
                    <SelectItem value="occupancy">Occupancy</SelectItem>
                    <SelectItem value="adr">ADR</SelectItem>
                    <SelectItem value="revpar">RevPAR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <div className="flex h-48 items-end gap-0.5">
                {forecastData.map((day) => {
                  const maxValue = Math.max(1, ...forecastData.map((item) => item[selectedMetric]))
                  const height = (day[selectedMetric] / maxValue) * 100

                  return (
                    <div key={day.fullDate} className="group relative flex-1">
                      <div
                        className={`w-full rounded-t transition-all hover:opacity-80 ${day.isWeekend ? 'bg-blue-500' : 'bg-purple-500'}`}
                        style={{ height: `${Math.max(2, height)}%` }}
                      />
                      <div className="pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 opacity-0 transition-opacity group-hover:opacity-100">
                        <div className="whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white">
                          <div className="font-medium">{day.date}</div>
                          <div>
                            {selectedMetric === 'revenue' && formatCurrency(day.revenue)}
                            {selectedMetric === 'occupancy' && `${day.occupancy}%`}
                            {selectedMetric === 'adr' && formatCurrency(day.adr)}
                            {selectedMetric === 'revpar' && formatCurrency(day.revpar)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-3 flex items-center justify-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="size-3 rounded bg-purple-500" />
                  <span>Weekday</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="size-3 rounded bg-blue-500" />
                  <span>Weekend</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="insights" className="mt-3 space-y-3">
          <div className="grid gap-3">
            {insights.map((insight) => {
              const iconMap = {
                opportunity: Lightbulb,
                warning: Warning,
                info: ChartBar,
                success: CheckCircle,
              }
              const Icon = iconMap[insight.type]
              const colorMap = {
                opportunity: 'text-blue-600 bg-blue-50 border-blue-200',
                warning: 'text-orange-600 bg-orange-50 border-orange-200',
                info: 'text-purple-600 bg-purple-50 border-purple-200',
                success: 'text-green-600 bg-green-50 border-green-200',
              }

              return (
                <Card key={insight.id} className={`professional-card border-l-4 ${colorMap[insight.type]}`}>
                  <CardContent className="p-3">
                    <div className="flex items-start gap-3">
                      <div className={`rounded p-1.5 ${colorMap[insight.type]}`}>
                        <Icon className="size-4" weight="fill" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <h4 className="text-sm font-semibold">{insight.title}</h4>
                          <Badge
                            variant={insight.priority === 'high' ? 'destructive' : insight.priority === 'medium' ? 'default' : 'secondary'}
                            className="h-5 shrink-0 px-1.5 text-xs"
                          >
                            {insight.priority}
                          </Badge>
                        </div>
                        <p className="mb-2 text-xs text-muted-foreground">{insight.description}</p>
                        <div className="mb-2 rounded bg-background/60 p-2">
                          <div className="mb-0.5 flex items-center gap-1 text-xs font-medium">
                            <Target className="size-3" />
                            Recommendation
                          </div>
                          <div className="text-xs">{insight.recommendation}</div>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <span className="font-medium">Expected Impact:</span>
                          <span>{insight.impact}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </TabsContent>

        <TabsContent value="anomalies" className="mt-3 space-y-3">
          <Card className="professional-card">
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-sm font-semibold">Operational Review Items</CardTitle>
              <CardDescription className="text-xs">
                Threshold checks from recorded reservations and folios
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <div className="space-y-2">
                {anomalies.map((anomaly, index) => (
                  <div key={anomaly.metric}>
                    {index > 0 && <Separator className="my-2" />}
                    <div className="flex items-start gap-3">
                      <div className={`shrink-0 rounded p-1.5 ${anomaly.detected ? 'bg-orange-50' : 'bg-green-50'}`}>
                        {anomaly.detected ? (
                          <Warning className="size-4 text-orange-600" weight="fill" />
                        ) : (
                          <CheckCircle className="size-4 text-green-600" weight="fill" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <h4 className="text-sm font-semibold">{anomaly.metric}</h4>
                          <Badge
                            variant={anomaly.detected ? (anomaly.severity === 'high' ? 'destructive' : 'default') : 'secondary'}
                            className="h-5 shrink-0 px-1.5 text-xs"
                          >
                            {anomaly.detected ? `${anomaly.severity} severity` : 'ok'}
                          </Badge>
                        </div>
                        <p className="mb-2 text-xs text-muted-foreground">{anomaly.description}</p>
                        <div className="flex items-center gap-4 text-xs">
                          <div>
                            <span className="text-muted-foreground">Expected:</span>
                            <span className="ml-1 font-medium">{anomaly.expectedRange[0]} - {anomaly.expectedRange[1]}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Actual:</span>
                            <span className={`ml-1 font-medium ${anomaly.detected ? 'text-red-600' : ''}`}>{anomaly.actualValue}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="forecasts" className="mt-3 space-y-3">
          <Card className="professional-card">
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-sm font-semibold">Daily On-the-books Breakdown</CardTitle>
              <CardDescription className="text-xs">
                Recorded reservations for the next {horizonDays} days
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <div className="overflow-hidden rounded-lg border">
                <div className="max-h-96 overflow-auto">
                  <table className="compact-table w-full text-xs">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        <th className="p-2 text-left font-semibold">Date</th>
                        <th className="p-2 text-right font-semibold">Occupancy</th>
                        <th className="p-2 text-right font-semibold">ADR</th>
                        <th className="p-2 text-right font-semibold">RevPAR</th>
                        <th className="p-2 text-right font-semibold">Revenue</th>
                        <th className="p-2 text-center font-semibold">Day Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {forecastData.map((day) => (
                        <tr key={day.fullDate} className="border-t hover:bg-muted/50">
                          <td className="p-2 font-medium">{day.date}</td>
                          <td className="p-2 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <div className="max-w-[60px] flex-1">
                                <Progress value={day.occupancy} className="h-1" />
                              </div>
                              <span>{day.occupancy}%</span>
                            </div>
                          </td>
                          <td className="p-2 text-right font-medium">{formatCurrency(day.adr)}</td>
                          <td className="p-2 text-right">{formatCurrency(day.revpar)}</td>
                          <td className="p-2 text-right font-semibold">{formatCurrency(day.revenue)}</td>
                          <td className="p-2 text-center">
                            <Badge variant={day.isWeekend ? 'default' : 'secondary'} className="h-5 px-1.5 text-xs">
                              {day.isWeekend ? 'Weekend' : 'Weekday'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Card className="professional-card">
              <CardContent className="p-3">
                <div className="mb-1 text-xs text-muted-foreground">Average Occupancy</div>
                <div className="mb-1 text-2xl font-bold">{(forwardRevenue.avgOccupancy * 100).toFixed(1)}%</div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <TrendUp className="size-3" />
                  On-the-books only
                </div>
              </CardContent>
            </Card>
            <Card className="professional-card">
              <CardContent className="p-3">
                <div className="mb-1 text-xs text-muted-foreground">Average ADR</div>
                <div className="mb-1 text-2xl font-bold">{formatCurrency(forwardRevenue.avgADR)}</div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <TrendDown className="size-3" />
                  Recorded rates
                </div>
              </CardContent>
            </Card>
            <Card className="professional-card">
              <CardContent className="p-3">
                <div className="mb-1 text-xs text-muted-foreground">Total Revenue</div>
                <div className="mb-1 text-2xl font-bold">{formatCurrency(forwardRevenue.totalRevenue)}</div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <ChartBar className="size-3" />
                  Posted reservations
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
