import { useMemo } from 'react'
import { format, eachDayOfInterval, differenceInDays } from 'date-fns'
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
  ArrowUp,
  ArrowDown,
  CalendarCheck,
  CalendarX,
  Users,
  DoorOpen,
  Minus,
  Broom,
  Warning
} from '@phosphor-icons/react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useReportsData } from '@/hooks/use-reports-data'

interface OperationsReportViewProps {
  dateRange: {
    from: Date
    to: Date
  }
}

export function OperationsReportView({ dateRange }: OperationsReportViewProps) {
  const { operationsData } = useReportsData(dateRange)

  const chartData = useMemo(() => {
    if (!operationsData) return []
    
    return operationsData.dailyStats.map(stat => ({
      date: format(stat.date, 'MMM dd'),
      arrivals: stat.arrivals,
      departures: stat.departures,
      inHouse: stat.inHouse,
      occupancy: Math.round(stat.occupancyRate * 100),
    }))
  }, [operationsData])

  if (!operationsData) {
    return <div className="text-muted-foreground">Loading operations data...</div>
  }

  const summary = operationsData.summary

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Arrivals</CardTitle>
            <CalendarCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalArrivals}</div>
            <p className="text-xs text-muted-foreground">
              Avg {(summary.totalArrivals / operationsData.dailyStats.length).toFixed(1)} per day
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Departures</CardTitle>
            <CalendarX className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalDepartures}</div>
            <p className="text-xs text-muted-foreground">
              Avg {(summary.totalDepartures / operationsData.dailyStats.length).toFixed(1)} per day
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Occupancy</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(summary.avgOccupancyRate * 100).toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">
              Peak: {(summary.peakOccupancyRate * 100).toFixed(0)}% on {format(summary.peakOccupancyDate, 'MMM dd')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cancellations</CardTitle>
            <Warning className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalCancellations}</div>
            <p className="text-xs text-muted-foreground">
              {(summary.cancellationRate * 100).toFixed(1)}% cancellation rate
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Occupancy Trend</CardTitle>
            <CardDescription>Daily occupancy rate over the selected period</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="occupancy" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={2}
                  name="Occupancy %"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Arrivals vs Departures</CardTitle>
            <CardDescription>Daily flow of guests</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="arrivals" fill="hsl(var(--chart-1))" name="Arrivals" />
                <Bar dataKey="departures" fill="hsl(var(--chart-2))" name="Departures" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daily Operations Detail</CardTitle>
          <CardDescription>Detailed breakdown by date</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Arrivals</TableHead>
                  <TableHead className="text-right">Departures</TableHead>
                  <TableHead className="text-right">In-House</TableHead>
                  <TableHead className="text-right">Occupancy</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Turnovers</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {operationsData.dailyStats.map((stat) => (
                  <TableRow key={stat.date.toISOString()}>
                    <TableCell className="font-medium">
                      {format(stat.date, 'EEE, MMM dd')}
                    </TableCell>
                    <TableCell className="text-right">{stat.arrivals}</TableCell>
                    <TableCell className="text-right">{stat.departures}</TableCell>
                    <TableCell className="text-right">{stat.inHouse}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={stat.occupancyRate > 0.8 ? 'default' : 'secondary'}>
                        {(stat.occupancyRate * 100).toFixed(0)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{stat.availableRooms}</TableCell>
                    <TableCell className="text-right">
                      {stat.turnoverCount > 0 ? (
                        <span className="text-amber-600 font-medium">{stat.turnoverCount}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Room Status Summary</CardTitle>
          <CardDescription>Current and historical room status distribution</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
              <div className="space-y-2">
                <div className="text-sm font-medium text-muted-foreground">Clean</div>
                <div className="text-2xl font-bold text-emerald-600">
                  {operationsData.dailyStats[operationsData.dailyStats.length - 1]?.roomsClean || 0}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium text-muted-foreground">Dirty</div>
                <div className="text-2xl font-bold text-amber-600">
                  {operationsData.dailyStats[operationsData.dailyStats.length - 1]?.roomsDirty || 0}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium text-muted-foreground">Inspected</div>
                <div className="text-2xl font-bold text-blue-600">
                  {operationsData.dailyStats[operationsData.dailyStats.length - 1]?.roomsInspected || 0}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium text-muted-foreground">Maintenance</div>
                <div className="text-2xl font-bold text-purple-600">
                  {operationsData.dailyStats[operationsData.dailyStats.length - 1]?.roomsMaintenance || 0}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium text-muted-foreground">Blocked</div>
                <div className="text-2xl font-bold text-gray-600">
                  {operationsData.dailyStats[operationsData.dailyStats.length - 1]?.roomsBlocked || 0}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
