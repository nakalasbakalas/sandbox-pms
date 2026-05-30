import { useMemo } from 'react'
import { format } from 'date-fns'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  CurrencyCircleDollar,
  TrendUp,
  ChartBar,
  Percent
} from '@phosphor-icons/react'
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useReportsData } from '@/hooks/use-reports-data'

interface RevenueReportViewProps {
  dateRange: {
    from: Date
    to: Date
  }
}

const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))']

export function RevenueReportView({ dateRange }: RevenueReportViewProps) {
  const { revenueData } = useReportsData(dateRange)

  const chartData = useMemo(() => {
    if (!revenueData) return []
    
    return revenueData.dailyStats.map(stat => ({
      date: format(stat.date, 'MMM dd'),
      revenue: stat.totalRevenue,
      roomRevenue: stat.roomRevenue,
      extrasRevenue: stat.extrasRevenue,
      adr: stat.adr,
      revpar: stat.revpar,
    }))
  }, [revenueData])

  const roomTypeChartData = useMemo(() => {
    if (!revenueData) return []
    return revenueData.byRoomType.map(rt => ({
      name: rt.roomTypeName,
      revenue: rt.revenue,
    }))
  }, [revenueData])

  const channelChartData = useMemo(() => {
    if (!revenueData) return []
    return revenueData.byChannel.map(ch => ({
      name: ch.channel,
      revenue: ch.revenue,
      percentage: ch.percentage,
    }))
  }, [revenueData])

  if (!revenueData) {
    return <div className="text-muted-foreground">Loading revenue data...</div>
  }

  const summary = revenueData.summary

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('th-TH', {
      style: 'currency',
      currency: 'THB',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <CurrencyCircleDollar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary.totalRevenue)}</div>
            <p className="text-xs text-muted-foreground">
              Room: {formatCurrency(summary.roomRevenue)} | Extras: {formatCurrency(summary.extrasRevenue)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ADR</CardTitle>
            <TrendUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary.avgADR)}</div>
            <p className="text-xs text-muted-foreground">
              Average Daily Rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">RevPAR</CardTitle>
            <ChartBar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary.avgRevPAR)}</div>
            <p className="text-xs text-muted-foreground">
              Revenue Per Available Room
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Occupancy</CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(summary.avgOccupancy * 100).toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">
              {summary.totalRoomNights} room nights sold
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Revenue Trend</CardTitle>
            <CardDescription>Daily revenue over the selected period</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                <Legend />
                <Bar dataKey="roomRevenue" stackId="a" fill="hsl(var(--chart-1))" name="Room Revenue" />
                <Bar dataKey="extrasRevenue" stackId="a" fill="hsl(var(--chart-2))" name="Extras Revenue" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ADR & RevPAR Trend</CardTitle>
            <CardDescription>Performance metrics over time</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="adr" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={2}
                  name="ADR"
                />
                <Line 
                  type="monotone" 
                  dataKey="revpar" 
                  stroke="hsl(var(--chart-2))" 
                  strokeWidth={2}
                  name="RevPAR"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Revenue by Room Type</CardTitle>
            <CardDescription>Breakdown by room type</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={roomTypeChartData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={(entry) => entry.name}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="revenue"
                  >
                    {roomTypeChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {revenueData.byRoomType.map((rt, index) => (
                  <div key={rt.roomTypeId} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      <span>{rt.roomTypeName}</span>
                    </div>
                    <div className="text-right space-x-4">
                      <span className="font-medium">{formatCurrency(rt.revenue)}</span>
                      <span className="text-muted-foreground">ADR {formatCurrency(rt.adr)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Revenue by Channel</CardTitle>
            <CardDescription>Performance by booking source</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {revenueData.byChannel.map((channel, index) => (
                <div key={channel.channel} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{channel.channel}</span>
                    <span className="text-muted-foreground">{channel.percentage.toFixed(1)}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full rounded-full transition-all"
                      style={{ 
                        width: `${channel.percentage}%`,
                        backgroundColor: COLORS[index % COLORS.length]
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{channel.reservations} reservations</span>
                    <span>{formatCurrency(channel.revenue)} | ADR {formatCurrency(channel.adr)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Financial Summary</CardTitle>
          <CardDescription>Detailed financial breakdown</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Deposits Collected</div>
              <div className="text-2xl font-bold text-emerald-600">{formatCurrency(summary.depositsCollected)}</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Deposits Pending</div>
              <div className="text-2xl font-bold text-amber-600">{formatCurrency(summary.depositsPending)}</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Outstanding Balance</div>
              <div className="text-2xl font-bold text-red-600">{formatCurrency(summary.outstandingBalance)}</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Refunds Issued</div>
              <div className="text-2xl font-bold">{formatCurrency(summary.refundsIssued)}</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Room Nights Sold</div>
              <div className="text-2xl font-bold">{summary.totalRoomNights}</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Avg Occupancy</div>
              <div className="text-2xl font-bold">{(summary.avgOccupancy * 100).toFixed(1)}%</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
