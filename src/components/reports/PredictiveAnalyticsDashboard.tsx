import { useState, useMemo, useEffect } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
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
  Lightning,
  ChartLine,
  Brain,
  Target,
  Warning,
  CheckCircle,
  CurrencyDollar,
  Users,
  Bed,
  CalendarBlank,
  ArrowUp,
  ArrowDown,
  Sparkle,
  Fire,
  CloudArrowDown,
  Lightbulb,
  Crown,
  ChartBar,
  ArrowsClockwise,
} from '@phosphor-icons/react'
import { format, addDays, subDays, startOfDay, differenceInDays } from 'date-fns'

interface PredictiveMetric {
  label: string
  current: number
  predicted: number
  confidence: number
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
  confidence: number
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

export function PredictiveAnalyticsDashboard() {
  const [timeHorizon, setTimeHorizon] = useState<'7d' | '14d' | '30d' | '90d'>('30d')
  const [selectedMetric, setSelectedMetric] = useState<'revenue' | 'occupancy' | 'adr' | 'revpar'>('revenue')
  const [isGenerating, setIsGenerating] = useState(false)
  const [insights, setInsights] = useKV<Insight[]>('predictive-insights', [])
  const [lastGenerated, setLastGenerated] = useKV<string>('insights-last-generated', '')

  const predictiveMetrics = useMemo<PredictiveMetric[]>(() => {
    const horizonDays = parseInt(timeHorizon)
    
    return [
      {
        label: 'Revenue',
        current: 1245000,
        predicted: 1345000,
        confidence: 87,
        trend: 'up',
        change: 8.03,
        unit: '฿'
      },
      {
        label: 'Occupancy Rate',
        current: 78.5,
        predicted: 82.3,
        confidence: 91,
        trend: 'up',
        change: 4.84,
        unit: '%'
      },
      {
        label: 'ADR',
        current: 3250,
        predicted: 3420,
        confidence: 84,
        trend: 'up',
        change: 5.23,
        unit: '฿'
      },
      {
        label: 'RevPAR',
        current: 2551,
        predicted: 2815,
        confidence: 89,
        trend: 'up',
        change: 10.35,
        unit: '฿'
      },
      {
        label: 'Booking Pace',
        current: 42,
        predicted: 38,
        confidence: 76,
        trend: 'down',
        change: -9.52,
        unit: 'bookings'
      },
      {
        label: 'Cancellation Rate',
        current: 8.2,
        predicted: 6.5,
        confidence: 82,
        trend: 'down',
        change: -20.73,
        unit: '%'
      },
      {
        label: 'Length of Stay',
        current: 2.8,
        predicted: 3.2,
        confidence: 79,
        trend: 'up',
        change: 14.29,
        unit: 'nights'
      },
      {
        label: 'Guest Satisfaction',
        current: 4.6,
        predicted: 4.8,
        confidence: 73,
        trend: 'up',
        change: 4.35,
        unit: '/5'
      }
    ]
  }, [timeHorizon])

  const anomalies = useMemo<AnomalyDetection[]>(() => {
    return [
      {
        metric: 'Weekend Occupancy',
        detected: true,
        severity: 'high',
        description: 'Last 3 weekends showed 15% lower occupancy than seasonal average',
        expectedRange: [85, 95],
        actualValue: 72
      },
      {
        metric: 'Midweek ADR',
        detected: true,
        severity: 'medium',
        description: 'Tuesday-Wednesday rates dropping below optimal pricing threshold',
        expectedRange: [3200, 3600],
        actualValue: 2890
      },
      {
        metric: 'Cancellation Spike',
        detected: true,
        severity: 'low',
        description: 'Slight increase in cancellations for future dates (within normal variance)',
        expectedRange: [5, 8],
        actualValue: 9.2
      }
    ]
  }, [])

  const generateInsights = async () => {
    setIsGenerating(true)
    
    try {
      const prompt = spark.llmPrompt`You are an expert hotel revenue management analyst. Based on the following metrics and trends, generate 6 actionable insights for a boutique hotel in Thailand:

Current Performance:
- Revenue: ฿1,245,000 (trending +8% next 30 days)
- Occupancy: 78.5% (trending +4.8% next 30 days)
- ADR: ฿3,250 (trending +5.2% next 30 days)
- RevPAR: ฿2,551 (trending +10.4% next 30 days)

Anomalies Detected:
- Weekend occupancy down 15% vs. seasonal average (72% vs 85-95% expected)
- Midweek ADR below optimal (฿2,890 vs ฿3,200-3,600 expected)
- Cancellation rate slightly elevated (9.2% vs 5-8% normal)

Generate insights in the following categories:
1. One HIGH priority revenue opportunity
2. One HIGH priority operational warning
3. One MEDIUM priority pricing optimization
4. One MEDIUM priority demand forecast insight
5. One LOW priority guest satisfaction opportunity
6. One LOW priority operational efficiency tip

For each insight, provide:
- A clear, specific title (max 8 words)
- A detailed description (2 sentences max)
- An actionable recommendation (1 sentence)
- The expected impact (1 sentence, include estimated financial or operational benefit)
- A confidence score (60-95)

Return as a JSON object with a single "insights" property containing an array of insight objects with properties: type (opportunity/warning/info/success), priority (high/medium/low), title, description, recommendation, impact, confidence.`

      const response = await spark.llm(prompt, 'gpt-4o', true)
      const parsed = JSON.parse(response)
      
      const insightsWithIds = parsed.insights.map((insight: Omit<Insight, 'id'>, index: number) => ({
        ...insight,
        id: `insight-${Date.now()}-${index}`
      }))
      
      setInsights(insightsWithIds)
      setLastGenerated(new Date().toISOString())
    } catch (error) {
      console.error('Failed to generate insights:', error)
    } finally {
      setIsGenerating(false)
    }
  }

  const forecastData = useMemo(() => {
    const days = parseInt(timeHorizon)
    const data: ForecastPoint[] = []
    
    for (let i = 0; i < days; i++) {
      const date = addDays(new Date(), i)
      const dayOfWeek = date.getDay()
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
      
      const baseOccupancy = isWeekend ? 85 : 72
      const variance = (Math.sin(i / 7) * 8) + (Math.random() * 10 - 5)
      const occupancy = Math.max(40, Math.min(100, baseOccupancy + variance))
      
      const baseADR = isWeekend ? 3600 : 3200
      const adrVariance = (Math.random() * 400 - 200)
      const adr = baseADR + adrVariance
      
      const revenue = (occupancy / 100) * adr * 30
      
      data.push({
        date: format(date, 'MMM dd'),
        fullDate: format(date, 'yyyy-MM-dd'),
        occupancy: Math.round(occupancy * 10) / 10,
        adr: Math.round(adr),
        revenue: Math.round(revenue),
        revpar: Math.round((occupancy / 100) * adr),
        isWeekend
      })
    }
    
    return data
  }, [timeHorizon])

  const kpiCards = [
    {
      title: 'Predicted Revenue Growth',
      value: '+8.03%',
      subValue: '฿100,000 increase',
      icon: TrendUp,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      confidence: 87
    },
    {
      title: 'Occupancy Forecast',
      value: '82.3%',
      subValue: '+3.8% vs current',
      icon: Bed,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      confidence: 91
    },
    {
      title: 'ADR Trajectory',
      value: '฿3,420',
      subValue: '+5.2% improvement',
      icon: CurrencyDollar,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
      confidence: 84
    },
    {
      title: 'Anomalies Detected',
      value: anomalies.filter(a => a.detected).length.toString(),
      subValue: 'Require attention',
      icon: Warning,
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
      confidence: null
    }
  ]

  const timeHorizonDays = parseInt(timeHorizon)

  return (
    <div className="flex flex-col gap-3 p-4 h-full overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Brain className="text-purple-600" weight="fill" />
            Predictive Analytics
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            AI-powered insights and forecasting for revenue optimization
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={timeHorizon} onValueChange={(v: any) => setTimeHorizon(v)}>
            <SelectTrigger className="w-32 h-8 text-xs">
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
      </div>

      <div className="grid grid-cols-4 gap-3">
        {kpiCards.map((kpi) => (
          <Card key={kpi.title} className="professional-card">
            <CardContent className="p-3">
              <div className="flex items-start justify-between mb-2">
                <div className={`p-1.5 rounded ${kpi.bgColor}`}>
                  <kpi.icon className={`${kpi.color} w-4 h-4`} weight="fill" />
                </div>
                {kpi.confidence && (
                  <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">
                    {kpi.confidence}% confidence
                  </Badge>
                )}
              </div>
              <div className="text-2xl font-bold">{kpi.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{kpi.subValue}</div>
              <div className="text-xs font-medium text-muted-foreground mt-1">{kpi.title}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="predictions" className="flex-1">
        <TabsList className="h-8">
          <TabsTrigger value="predictions" className="text-xs h-7">
            <ChartLine className="w-3.5 h-3.5 mr-1.5" />
            Predictions
          </TabsTrigger>
          <TabsTrigger value="insights" className="text-xs h-7">
            <Sparkle className="w-3.5 h-3.5 mr-1.5" />
            AI Insights
            {insights.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-xs">
                {insights.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="anomalies" className="text-xs h-7">
            <Warning className="w-3.5 h-3.5 mr-1.5" />
            Anomalies
            {anomalies.filter(a => a.detected).length > 0 && (
              <Badge variant="destructive" className="ml-1.5 h-4 px-1 text-xs">
                {anomalies.filter(a => a.detected).length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="forecasts" className="text-xs h-7">
            <Target className="w-3.5 h-3.5 mr-1.5" />
            Detailed Forecast
          </TabsTrigger>
        </TabsList>

        <TabsContent value="predictions" className="mt-3 space-y-3">
          <Card className="professional-card">
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-sm font-semibold">Key Performance Predictions</CardTitle>
              <CardDescription className="text-xs">
                Next {timeHorizonDays} days forecast based on historical trends and market patterns
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <div className="grid grid-cols-2 gap-3">
                {predictiveMetrics.map((metric) => (
                  <div key={metric.label} className="border rounded-lg p-3">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-1">
                          {metric.label}
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm text-muted-foreground">
                            {metric.unit}{metric.current.toLocaleString()}
                          </span>
                          <span className="text-base font-bold">
                            {metric.unit}{metric.predicted.toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <Badge
                        variant={metric.trend === 'up' ? 'default' : metric.trend === 'down' ? 'destructive' : 'secondary'}
                        className="text-xs px-1.5 h-5"
                      >
                        {metric.trend === 'up' ? <ArrowUp className="w-3 h-3" /> : metric.trend === 'down' ? <ArrowDown className="w-3 h-3" /> : null}
                        {Math.abs(metric.change).toFixed(1)}%
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Confidence</span>
                        <span className="font-medium">{metric.confidence}%</span>
                      </div>
                      <Progress value={metric.confidence} className="h-1" />
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
                  <CardTitle className="text-sm font-semibold">Revenue Trajectory</CardTitle>
                  <CardDescription className="text-xs">
                    Projected revenue and occupancy trends
                  </CardDescription>
                </div>
                <Select value={selectedMetric} onValueChange={(v: any) => setSelectedMetric(v)}>
                  <SelectTrigger className="w-32 h-7 text-xs">
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
              <div className="h-48 flex items-end gap-0.5">
                {forecastData.map((day, idx) => {
                  const maxValue = Math.max(...forecastData.map(d => d[selectedMetric]))
                  const height = (day[selectedMetric] / maxValue) * 100
                  
                  return (
                    <div
                      key={day.fullDate}
                      className="flex-1 group relative"
                    >
                      <div
                        className={`w-full transition-all ${
                          day.isWeekend ? 'bg-blue-500' : 'bg-purple-500'
                        } hover:opacity-80 rounded-t`}
                        style={{ height: `${height}%` }}
                      />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                          <div className="font-medium">{day.date}</div>
                          <div>
                            {selectedMetric === 'revenue' && `฿${day.revenue.toLocaleString()}`}
                            {selectedMetric === 'occupancy' && `${day.occupancy}%`}
                            {selectedMetric === 'adr' && `฿${day.adr.toLocaleString()}`}
                            {selectedMetric === 'revpar' && `฿${day.revpar.toLocaleString()}`}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex items-center justify-center gap-4 mt-3 text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 bg-purple-500 rounded" />
                  <span>Weekday</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 bg-blue-500 rounded" />
                  <span>Weekend</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="insights" className="mt-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {lastGenerated && `Last updated: ${format(new Date(lastGenerated), 'MMM dd, yyyy HH:mm')}`}
            </div>
            <Button
              size="sm"
              onClick={generateInsights}
              disabled={isGenerating}
              className="h-7 text-xs"
            >
              {isGenerating ? (
                <>
                  <ArrowsClockwise className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkle className="w-3.5 h-3.5 mr-1.5" />
                  Generate AI Insights
                </>
              )}
            </Button>
          </div>

          {insights.length === 0 ? (
            <Card className="professional-card">
              <CardContent className="p-8 text-center">
                <Brain className="w-12 h-12 mx-auto mb-3 text-muted-foreground" weight="duotone" />
                <h3 className="font-semibold mb-1">No Insights Generated</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Click "Generate AI Insights" to analyze your data and receive actionable recommendations
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {insights
                .sort((a, b) => {
                  const priorityOrder = { high: 0, medium: 1, low: 2 }
                  return priorityOrder[a.priority] - priorityOrder[b.priority]
                })
                .map((insight) => {
                  const iconMap = {
                    opportunity: Lightbulb,
                    warning: Warning,
                    info: ChartBar,
                    success: CheckCircle
                  }
                  const Icon = iconMap[insight.type]
                  
                  const colorMap = {
                    opportunity: 'text-blue-600 bg-blue-50 border-blue-200',
                    warning: 'text-orange-600 bg-orange-50 border-orange-200',
                    info: 'text-purple-600 bg-purple-50 border-purple-200',
                    success: 'text-green-600 bg-green-50 border-green-200'
                  }
                  
                  return (
                    <Card key={insight.id} className={`professional-card border-l-4 ${colorMap[insight.type]}`}>
                      <CardContent className="p-3">
                        <div className="flex items-start gap-3">
                          <div className={`p-1.5 rounded ${colorMap[insight.type]}`}>
                            <Icon className="w-4 h-4" weight="fill" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <h4 className="font-semibold text-sm">{insight.title}</h4>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <Badge
                                  variant={
                                    insight.priority === 'high' ? 'destructive' :
                                    insight.priority === 'medium' ? 'default' : 'secondary'
                                  }
                                  className="text-xs px-1.5 h-5"
                                >
                                  {insight.priority}
                                </Badge>
                                <Badge variant="outline" className="text-xs px-1.5 h-5">
                                  {insight.confidence}% confidence
                                </Badge>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground mb-2">
                              {insight.description}
                            </p>
                            <div className="bg-background/60 rounded p-2 mb-2">
                              <div className="text-xs font-medium mb-0.5 flex items-center gap-1">
                                <Target className="w-3 h-3" />
                                Recommendation
                              </div>
                              <div className="text-xs">{insight.recommendation}</div>
                            </div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Fire className="w-3 h-3" />
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
          )}
        </TabsContent>

        <TabsContent value="anomalies" className="mt-3 space-y-3">
          <Card className="professional-card">
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-sm font-semibold">Anomaly Detection</CardTitle>
              <CardDescription className="text-xs">
                Unusual patterns detected in your performance metrics
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <div className="space-y-2">
                {anomalies.map((anomaly, idx) => (
                  <div key={idx}>
                    {idx > 0 && <Separator className="my-2" />}
                    <div className="flex items-start gap-3">
                      <div className={`p-1.5 rounded shrink-0 ${
                        anomaly.severity === 'high' ? 'bg-red-50' :
                        anomaly.severity === 'medium' ? 'bg-orange-50' : 'bg-yellow-50'
                      }`}>
                        <Warning
                          className={`w-4 h-4 ${
                            anomaly.severity === 'high' ? 'text-red-600' :
                            anomaly.severity === 'medium' ? 'text-orange-600' : 'text-yellow-600'
                          }`}
                          weight="fill"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h4 className="font-semibold text-sm">{anomaly.metric}</h4>
                          <Badge
                            variant={
                              anomaly.severity === 'high' ? 'destructive' :
                              anomaly.severity === 'medium' ? 'default' : 'secondary'
                            }
                            className="text-xs px-1.5 h-5 shrink-0"
                          >
                            {anomaly.severity} severity
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">
                          {anomaly.description}
                        </p>
                        <div className="flex items-center gap-4 text-xs">
                          <div>
                            <span className="text-muted-foreground">Expected:</span>
                            <span className="font-medium ml-1">
                              {anomaly.expectedRange[0]} - {anomaly.expectedRange[1]}
                              {anomaly.metric.includes('Occupancy') || anomaly.metric.includes('Rate') ? '%' : ''}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Actual:</span>
                            <span className={`font-medium ml-1 ${
                              anomaly.actualValue < anomaly.expectedRange[0] || anomaly.actualValue > anomaly.expectedRange[1]
                                ? 'text-red-600'
                                : ''
                            }`}>
                              {anomaly.actualValue}
                              {anomaly.metric.includes('Occupancy') || anomaly.metric.includes('Rate') ? '%' : ''}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="professional-card border-l-4 border-blue-500">
            <CardContent className="p-3">
              <div className="flex items-start gap-3">
                <div className="p-1.5 rounded bg-blue-50 shrink-0">
                  <Lightbulb className="w-4 h-4 text-blue-600" weight="fill" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm mb-1">Anomaly Investigation Tips</h4>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    <li>• Check for seasonal patterns or local events affecting demand</li>
                    <li>• Review competitor pricing and availability in the area</li>
                    <li>• Analyze channel performance for unusual booking patterns</li>
                    <li>• Consider implementing dynamic pricing adjustments</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="forecasts" className="mt-3 space-y-3">
          <Card className="professional-card">
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-sm font-semibold">Daily Forecast Breakdown</CardTitle>
              <CardDescription className="text-xs">
                Detailed predictions for the next {timeHorizonDays} days
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <div className="border rounded-lg overflow-hidden">
                <div className="max-h-96 overflow-auto">
                  <table className="w-full text-xs compact-table">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        <th className="text-left font-semibold p-2">Date</th>
                        <th className="text-right font-semibold p-2">Occupancy</th>
                        <th className="text-right font-semibold p-2">ADR</th>
                        <th className="text-right font-semibold p-2">RevPAR</th>
                        <th className="text-right font-semibold p-2">Revenue</th>
                        <th className="text-center font-semibold p-2">Day Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {forecastData.map((day) => (
                        <tr key={day.fullDate} className="border-t hover:bg-muted/50">
                          <td className="p-2 font-medium">{day.date}</td>
                          <td className="p-2 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <div className="flex-1 max-w-[60px]">
                                <Progress value={day.occupancy} className="h-1" />
                              </div>
                              <span>{day.occupancy}%</span>
                            </div>
                          </td>
                          <td className="p-2 text-right font-medium">฿{day.adr.toLocaleString()}</td>
                          <td className="p-2 text-right">฿{day.revpar.toLocaleString()}</td>
                          <td className="p-2 text-right font-semibold">฿{day.revenue.toLocaleString()}</td>
                          <td className="p-2 text-center">
                            <Badge variant={day.isWeekend ? 'default' : 'secondary'} className="text-xs px-1.5 h-5">
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

          <div className="grid grid-cols-3 gap-3">
            <Card className="professional-card">
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground mb-1">Average Occupancy</div>
                <div className="text-2xl font-bold mb-1">
                  {(forecastData.reduce((sum, d) => sum + d.occupancy, 0) / forecastData.length).toFixed(1)}%
                </div>
                <div className="text-xs text-green-600 flex items-center gap-1">
                  <TrendUp className="w-3 h-3" />
                  +3.2% vs last period
                </div>
              </CardContent>
            </Card>
            
            <Card className="professional-card">
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground mb-1">Average ADR</div>
                <div className="text-2xl font-bold mb-1">
                  ฿{Math.round(forecastData.reduce((sum, d) => sum + d.adr, 0) / forecastData.length).toLocaleString()}
                </div>
                <div className="text-xs text-green-600 flex items-center gap-1">
                  <TrendUp className="w-3 h-3" />
                  +4.8% vs last period
                </div>
              </CardContent>
            </Card>
            
            <Card className="professional-card">
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground mb-1">Total Revenue</div>
                <div className="text-2xl font-bold mb-1">
                  ฿{Math.round(forecastData.reduce((sum, d) => sum + d.revenue, 0)).toLocaleString()}
                </div>
                <div className="text-xs text-green-600 flex items-center gap-1">
                  <TrendUp className="w-3 h-3" />
                  +8.1% vs last period
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
