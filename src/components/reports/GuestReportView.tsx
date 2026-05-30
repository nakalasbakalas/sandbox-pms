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
  Users,
  Star,
  Warning,
  Globe
} from '@phosphor-icons/react'
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useReportsData } from '@/hooks/use-reports-data'

interface GuestReportViewProps {
  dateRange: {
    from: Date
    to: Date
  }
}

const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))']

export function GuestReportView({ dateRange }: GuestReportViewProps) {
  const { guestData } = useReportsData(dateRange)

  const nationalityChartData = useMemo(() => {
    if (!guestData) return []
    return guestData.nationalityBreakdown.slice(0, 10)
  }, [guestData])

  if (!guestData) {
    return <div className="text-muted-foreground">Loading guest data...</div>
  }

  const summary = guestData.summary

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
            <CardTitle className="text-sm font-medium">Total Guests</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalUniqueGuests}</div>
            <p className="text-xs text-muted-foreground">
              {summary.newGuests} new | {summary.returningGuests} returning
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Repeat Guest Rate</CardTitle>
            <Star className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(summary.repeatGuestRate * 100).toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">
              Returning guests
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">VIP Guests</CardTitle>
            <Star className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.vipGuests}</div>
            <p className="text-xs text-muted-foreground">
              Special attention
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Caution Flags</CardTitle>
            <Warning className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{summary.cautionFlagGuests}</div>
            <p className="text-xs text-muted-foreground">
              Requires attention
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top Nationalities</CardTitle>
            <CardDescription>Guest distribution by country</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={nationalityChartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry) => `${entry.nationality}: ${entry.percentage.toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="guestCount"
                >
                  {nationalityChartData.map((entry, index) => (
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
            <CardTitle>Guest Type Distribution</CardTitle>
            <CardDescription>New vs returning guests</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">New Guests</span>
                  <span className="text-muted-foreground">
                    {((summary.newGuests / summary.totalUniqueGuests) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="h-3 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full rounded-full bg-chart-1 transition-all"
                    style={{ width: `${(summary.newGuests / summary.totalUniqueGuests) * 100}%` }}
                  />
                </div>
                <div className="text-2xl font-bold">{summary.newGuests}</div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Returning Guests</span>
                  <span className="text-muted-foreground">
                    {((summary.returningGuests / summary.totalUniqueGuests) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="h-3 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full rounded-full bg-chart-2 transition-all"
                    style={{ width: `${(summary.returningGuests / summary.totalUniqueGuests) * 100}%` }}
                  />
                </div>
                <div className="text-2xl font-bold">{summary.returningGuests}</div>
              </div>

              <div className="pt-4 border-t">
                <div className="text-sm text-muted-foreground">Avg Guests Per Reservation</div>
                <div className="text-2xl font-bold">{summary.avgGuestsPerReservation.toFixed(1)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nationality Breakdown</CardTitle>
          <CardDescription>Detailed guest demographics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nationality</TableHead>
                  <TableHead className="text-right">Guests</TableHead>
                  <TableHead className="text-right">Reservations</TableHead>
                  <TableHead className="text-right">Percentage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {guestData.nationalityBreakdown.map((nat, index) => (
                  <TableRow key={nat.nationality}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        />
                        {nat.nationality}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{nat.guestCount}</TableCell>
                    <TableCell className="text-right">{nat.reservations}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">{nat.percentage.toFixed(1)}%</Badge>
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
          <CardTitle>Top Repeat Guests</CardTitle>
          <CardDescription>Most loyal customers</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Guest</TableHead>
                  <TableHead className="text-right">Total Stays</TableHead>
                  <TableHead className="text-right">Total Nights</TableHead>
                  <TableHead className="text-right">Total Revenue</TableHead>
                  <TableHead>Last Stay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {guestData.repeatGuests.slice(0, 20).map((guest) => (
                  <TableRow key={guest.guestId}>
                    <TableCell className="font-medium">{guest.guestName}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={guest.totalStays >= 5 ? 'default' : 'secondary'}>
                        {guest.totalStays}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{guest.totalNights}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(guest.totalRevenue)}</TableCell>
                    <TableCell>{format(guest.lastStayDate, 'MMM dd, yyyy')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Guest Summary</CardTitle>
          <CardDescription>Overall guest statistics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Total Unique Guests</div>
              <div className="text-2xl font-bold">{summary.totalUniqueGuests}</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">New Guests</div>
              <div className="text-2xl font-bold text-blue-600">{summary.newGuests}</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Returning Guests</div>
              <div className="text-2xl font-bold text-emerald-600">{summary.returningGuests}</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Repeat Guest Rate</div>
              <div className="text-2xl font-bold">{(summary.repeatGuestRate * 100).toFixed(1)}%</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">VIP Guests</div>
              <div className="text-2xl font-bold text-purple-600">{summary.vipGuests}</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Avg Guests Per Reservation</div>
              <div className="text-2xl font-bold">{summary.avgGuestsPerReservation.toFixed(1)}</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
