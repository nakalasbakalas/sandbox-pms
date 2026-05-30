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
  CalendarPlus,
  Clock,
  Moon,
  Warning
} from '@phosphor-icons/react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { useReportsData } from '@/hooks/use-reports-data'

interface ReservationReportViewProps {
  dateRange: {
    from: Date
    to: Date
  }
}

const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))']

export function ReservationReportView({ dateRange }: ReservationReportViewProps) {
  const { reservationData } = useReportsData(dateRange)

  const bookingPaceChartData = useMemo(() => {
    if (!reservationData) return []
    
    return reservationData.bookingPace.map(bp => ({
      date: format(bp.bookingDate, 'MMM dd'),
      reservations: bp.reservationsBooked,
      roomNights: bp.roomNightsBooked,
    }))
  }, [reservationData])

  const leadTimeChartData = useMemo(() => {
    if (!reservationData) return []
    
    const lt = reservationData.leadTime
    return [
      { name: 'Same Day', value: lt.sameDay },
      { name: '1-3 Days', value: lt.days1to3 },
      { name: '4-7 Days', value: lt.days4to7 },
      { name: '8-14 Days', value: lt.days8to14 },
      { name: '15-30 Days', value: lt.days15to30 },
      { name: '31-60 Days', value: lt.days31to60 },
      { name: '61-90 Days', value: lt.days61to90 },
      { name: '90+ Days', value: lt.over90Days },
    ].filter(item => item.value > 0)
  }, [reservationData])

  const stayLengthChartData = useMemo(() => {
    if (!reservationData) return []
    
    const sl = reservationData.stayLength
    return [
      { name: '1 Night', value: sl.oneNight },
      { name: '2 Nights', value: sl.twoNights },
      { name: '3-4 Nights', value: sl.threeFourNights },
      { name: '5-6 Nights', value: sl.fiveSixNights },
      { name: '1 Week', value: sl.oneWeek },
      { name: '2 Weeks', value: sl.twoWeeks },
      { name: '2+ Weeks', value: sl.overTwoWeeks },
    ].filter(item => item.value > 0)
  }, [reservationData])

  if (!reservationData) {
    return <div className="text-muted-foreground">Loading reservation data...</div>
  }

  const summary = reservationData.summary

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
            <CardTitle className="text-sm font-medium">Total Reservations</CardTitle>
            <CalendarPlus className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalReservations}</div>
            <p className="text-xs text-muted-foreground">
              {summary.totalRoomNights} room nights
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Stay Length</CardTitle>
            <Moon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.avgStayLength.toFixed(1)} nights</div>
            <p className="text-xs text-muted-foreground">
              Average per reservation
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Lead Time</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.avgLeadTime.toFixed(0)} days</div>
            <p className="text-xs text-muted-foreground">
              Booking to arrival
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cancellation Rate</CardTitle>
            <Warning className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(summary.cancellationRate * 100).toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">
              {summary.totalCancellations} cancellations
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Booking Pace</CardTitle>
            <CardDescription>Reservations booked by date</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={bookingPaceChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="reservations" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={2}
                  name="Reservations"
                />
                <Line 
                  type="monotone" 
                  dataKey="roomNights" 
                  stroke="hsl(var(--chart-2))" 
                  strokeWidth={2}
                  name="Room Nights"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lead Time Distribution</CardTitle>
            <CardDescription>Time between booking and arrival</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={leadTimeChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(var(--chart-1))" name="Reservations" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Stay Length Distribution</CardTitle>
            <CardDescription>Number of nights per reservation</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={stayLengthChartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry) => `${entry.name}: ${entry.value}`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {stayLengthChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Booking Source Performance</CardTitle>
            <CardDescription>Performance by source</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {reservationData.sourceBreakdown.map((source) => (
                <div key={source.source} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="font-medium">{source.source}</div>
                      <div className="text-xs text-muted-foreground">
                        {source.reservations} reservations · {source.roomNights} room nights
                      </div>
                    </div>
                    <div className="text-right space-y-1">
                      <div className="font-medium">{formatCurrency(source.revenue)}</div>
                      <div className="text-xs text-muted-foreground">
                        ADR {formatCurrency(source.adr)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <Badge variant={source.cancellationRate > 0.2 ? 'destructive' : 'secondary'}>
                      {(source.cancellationRate * 100).toFixed(1)}% cancellation
                    </Badge>
                    <span className="text-muted-foreground">
                      {source.cancellations} cancelled
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reservation Summary</CardTitle>
          <CardDescription>Key metrics overview</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Total Reservations</div>
              <div className="text-2xl font-bold">{summary.totalReservations}</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Total Room Nights</div>
              <div className="text-2xl font-bold">{summary.totalRoomNights}</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Total Cancellations</div>
              <div className="text-2xl font-bold text-amber-600">{summary.totalCancellations}</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Total Modifications</div>
              <div className="text-2xl font-bold">{summary.totalModifications}</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Direct Booking Rate</div>
              <div className="text-2xl font-bold text-emerald-600">{(summary.directBookingRate * 100).toFixed(1)}%</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Modification Rate</div>
              <div className="text-2xl font-bold">{(summary.modificationRate * 100).toFixed(1)}%</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
