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
  Broom,
  CheckCircle,
  Clock,
  Warning
} from '@phosphor-icons/react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useReportsData } from '@/hooks/use-reports-data'

interface HousekeepingReportViewProps {
  dateRange: {
    from: Date
    to: Date
  }
}

export function HousekeepingReportView({ dateRange }: HousekeepingReportViewProps) {
  const { housekeepingData } = useReportsData(dateRange)

  const chartData = useMemo(() => {
    if (!housekeepingData) return []
    
    return housekeepingData.dailyStats.map(stat => ({
      date: format(stat.date, 'MMM dd'),
      checkouts: stat.checkouts,
      turnovers: stat.turnovers,
      cleaned: stat.cleanedRooms,
      inspected: stat.inspectedRooms,
      sameDayTurnovers: stat.sameDayTurnovers,
    }))
  }, [housekeepingData])

  if (!housekeepingData) {
    return <div className="text-muted-foreground">Loading housekeeping data...</div>
  }

  const summary = housekeepingData.summary

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cleanings</CardTitle>
            <Broom className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalCleanings}</div>
            <p className="text-xs text-muted-foreground">
              {summary.totalInspections} inspections completed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Clean Time</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.avgCleaningTime} min</div>
            <p className="text-xs text-muted-foreground">
              Per room average
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">On-Time Readiness</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(summary.onTimeReadinessRate * 100).toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">
              Rooms ready by check-in time
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Room Days Lost</CardTitle>
            <Warning className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.maintenanceRoomDays + summary.blockedRoomDays}</div>
            <p className="text-xs text-muted-foreground">
              Maintenance: {summary.maintenanceRoomDays} | Blocked: {summary.blockedRoomDays}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Daily Cleaning Activity</CardTitle>
            <CardDescription>Rooms cleaned and inspected per day</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="cleaned" fill="hsl(var(--chart-1))" name="Cleaned" />
                <Bar dataKey="inspected" fill="hsl(var(--chart-2))" name="Inspected" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Turnover Activity</CardTitle>
            <CardDescription>Checkout and same-day turnover volume</CardDescription>
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
                  dataKey="checkouts" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={2}
                  name="Checkouts"
                />
                <Line 
                  type="monotone" 
                  dataKey="turnovers" 
                  stroke="hsl(var(--chart-2))" 
                  strokeWidth={2}
                  name="Turnovers"
                />
                <Line 
                  type="monotone" 
                  dataKey="sameDayTurnovers" 
                  stroke="hsl(var(--chart-3))" 
                  strokeWidth={2}
                  name="Same Day"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daily Housekeeping Detail</CardTitle>
          <CardDescription>Detailed breakdown by date</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Checkouts</TableHead>
                  <TableHead className="text-right">Turnovers</TableHead>
                  <TableHead className="text-right">Same Day</TableHead>
                  <TableHead className="text-right">Cleaned</TableHead>
                  <TableHead className="text-right">Inspected</TableHead>
                  <TableHead className="text-right">Avg Time</TableHead>
                  <TableHead className="text-right">Delayed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {housekeepingData.dailyStats.map((stat) => (
                  <TableRow key={stat.date.toISOString()}>
                    <TableCell className="font-medium">
                      {format(stat.date, 'EEE, MMM dd')}
                    </TableCell>
                    <TableCell className="text-right">{stat.checkouts}</TableCell>
                    <TableCell className="text-right">{stat.turnovers}</TableCell>
                    <TableCell className="text-right">
                      {stat.sameDayTurnovers > 0 ? (
                        <span className="text-amber-600 font-medium">{stat.sameDayTurnovers}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{stat.cleanedRooms}</TableCell>
                    <TableCell className="text-right">{stat.inspectedRooms}</TableCell>
                    <TableCell className="text-right">
                      {stat.avgCleanTime > 0 ? `${stat.avgCleanTime} min` : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {stat.delayedReadiness > 0 ? (
                        <Badge variant="destructive">{stat.delayedReadiness}</Badge>
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
          <CardTitle>Room Performance</CardTitle>
          <CardDescription>Individual room statistics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Room</TableHead>
                  <TableHead className="text-right">Cleanings</TableHead>
                  <TableHead className="text-right">Avg Clean Time</TableHead>
                  <TableHead className="text-right">Maintenance Days</TableHead>
                  <TableHead className="text-right">Blocked Days</TableHead>
                  <TableHead className="text-right">Total Lost Days</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {housekeepingData.byRoom
                  .sort((a, b) => (b.maintenanceDays + b.blockedDays) - (a.maintenanceDays + a.blockedDays))
                  .map((room) => (
                  <TableRow key={room.roomNumber}>
                    <TableCell className="font-medium">{room.roomNumber}</TableCell>
                    <TableCell className="text-right">{room.cleanings}</TableCell>
                    <TableCell className="text-right">
                      {room.avgCleanTime > 0 ? `${room.avgCleanTime} min` : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {room.maintenanceDays > 0 ? (
                        <span className="text-purple-600">{room.maintenanceDays}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {room.blockedDays > 0 ? (
                        <span className="text-gray-600">{room.blockedDays}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {room.maintenanceDays + room.blockedDays > 0 ? (
                        <Badge variant={room.maintenanceDays + room.blockedDays > 5 ? 'destructive' : 'secondary'}>
                          {room.maintenanceDays + room.blockedDays}
                        </Badge>
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
    </div>
  )
}
