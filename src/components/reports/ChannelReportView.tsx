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
  ArrowsClockwise,
  CheckCircle,
  Warning,
  Clock
} from '@phosphor-icons/react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { useReportsData } from '@/hooks/use-reports-data'

interface ChannelReportViewProps {
  dateRange: {
    from: Date
    to: Date
  }
}

const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))']

export function ChannelReportView({ dateRange }: ChannelReportViewProps) {
  const { channelData } = useReportsData(dateRange)

  const performanceChartData = useMemo(() => {
    if (!channelData) return []
    return channelData.byChannel
  }, [channelData])

  const revenueChartData = useMemo(() => {
    if (!channelData) return []
    return channelData.byChannel.map(ch => ({
      name: ch.channel,
      revenue: ch.revenue,
    }))
  }, [channelData])

  if (!channelData) {
    return <div className="text-muted-foreground">Loading channel data...</div>
  }

  const summary = channelData.summary

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
            <CardTitle className="text-sm font-medium">Channel Revenue</CardTitle>
            <ArrowsClockwise className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary.totalChannelRevenue)}</div>
            <p className="text-xs text-muted-foreground">
              {summary.totalChannelReservations} reservations
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Direct vs OTA</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.directBookingPercentage.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">
              {summary.otaBookingPercentage.toFixed(1)}% from OTAs
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Channel ADR</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary.avgChannelADR)}</div>
            <p className="text-xs text-muted-foreground">
              Direct: {formatCurrency(summary.avgDirectADR)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Top Channel</CardTitle>
            <Warning className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold truncate">{summary.mostPerformingChannel}</div>
            <p className="text-xs text-muted-foreground">
              Best performing
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Revenue by Channel</CardTitle>
            <CardDescription>Total revenue contribution</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={revenueChartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry) => entry.name}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="revenue"
                >
                  {revenueChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reservations by Channel</CardTitle>
            <CardDescription>Volume comparison</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={performanceChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="channel" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="reservations" fill="hsl(var(--chart-1))" name="Reservations" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Channel Performance Detail</CardTitle>
          <CardDescription>Detailed metrics by channel</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead className="text-right">Reservations</TableHead>
                  <TableHead className="text-right">Room Nights</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">ADR</TableHead>
                  <TableHead className="text-right">Cancellations</TableHead>
                  <TableHead className="text-right">Modifications</TableHead>
                  <TableHead className="text-right">Avg Lead Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channelData.byChannel
                  .sort((a, b) => b.revenue - a.revenue)
                  .map((channel) => (
                  <TableRow key={channel.channel}>
                    <TableCell className="font-medium">{channel.channel}</TableCell>
                    <TableCell className="text-right">{channel.reservations}</TableCell>
                    <TableCell className="text-right">{channel.roomNights}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(channel.revenue)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(channel.adr)}</TableCell>
                    <TableCell className="text-right">
                      {channel.cancellations > 0 ? (
                        <span className="text-amber-600">{channel.cancellations}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {channel.modifications > 0 ? channel.modifications : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">{channel.avgLeadTime.toFixed(0)} days</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Channel Sync Health</CardTitle>
          <CardDescription>Integration status and reliability</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Last Sync</TableHead>
                  <TableHead className="text-right">Total Syncs</TableHead>
                  <TableHead className="text-right">Success Rate</TableHead>
                  <TableHead className="text-right">Conflicts</TableHead>
                  <TableHead className="text-right">Unmapped Rooms</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channelData.syncHealth.map((sync) => (
                  <TableRow key={sync.channel}>
                    <TableCell className="font-medium">{sync.channel}</TableCell>
                    <TableCell>
                      <div className="text-sm">{format(sync.lastSyncTime, 'MMM dd, HH:mm')}</div>
                      <div className="text-xs text-muted-foreground">
                        {format(sync.lastSyncTime, 'yyyy')}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{sync.totalSyncs}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={sync.successRate > 0.95 ? 'default' : sync.successRate > 0.8 ? 'secondary' : 'destructive'}>
                        {(sync.successRate * 100).toFixed(1)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {sync.conflicts > 0 ? (
                        <Badge variant="destructive">{sync.conflicts}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {sync.unmappedRooms > 0 ? (
                        <Badge variant="destructive">{sync.unmappedRooms}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant={
                          sync.successRate > 0.95 && sync.conflicts === 0 && sync.unmappedRooms === 0
                            ? 'default'
                            : sync.successRate > 0.8
                            ? 'secondary'
                            : 'destructive'
                        }
                      >
                        {sync.successRate > 0.95 && sync.conflicts === 0 && sync.unmappedRooms === 0
                          ? 'Healthy'
                          : sync.successRate > 0.8
                          ? 'Warning'
                          : 'Critical'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
