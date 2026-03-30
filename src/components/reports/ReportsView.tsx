import { useState } from 'react'
import { 
  ChartBar,
  ChartLineUp,
  CurrencyCircleDollar,
  CalendarBlank,
  Broom,
  ArrowsClockwise,
  Users,
  Download,
  Funnel,
  CaretDown
} from '@phosphor-icons/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { format, subDays, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns'
import { cn } from '@/lib/utils'
import { OperationsReportView } from './OperationsReportView'
import { RevenueReportView } from './RevenueReportView'
import { ReservationReportView } from './ReservationReportView'
import { HousekeepingReportView } from './HousekeepingReportView'
import { ChannelReportView } from './ChannelReportView'
import { GuestReportView } from './GuestReportView'
import { useReportsData } from '@/hooks/use-reports-data'
import {
  exportOperationsReportCSV,
  exportRevenueReportCSV,
  exportReservationReportCSV,
  exportHousekeepingReportCSV,
  exportChannelReportCSV,
  exportGuestReportCSV
} from '@/lib/report-export'
import { toast } from 'sonner'

type DateRange = {
  from: Date
  to: Date
}

type QuickRange = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'lastYear' | 'custom'

const quickRanges: { value: QuickRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 Days' },
  { value: 'last30', label: 'Last 30 Days' },
  { value: 'thisMonth', label: 'This Month' },
  { value: 'lastMonth', label: 'Last Month' },
  { value: 'thisYear', label: 'This Year' },
  { value: 'lastYear', label: 'Last Year' },
  { value: 'custom', label: 'Custom Range' },
]

function getDateRangeFromQuick(range: QuickRange): DateRange | null {
  const today = new Date()
  const yesterday = subDays(today, 1)

  switch (range) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday':
      return { from: yesterday, to: yesterday }
    case 'last7':
      return { from: subDays(today, 6), to: today }
    case 'last30':
      return { from: subDays(today, 29), to: today }
    case 'thisMonth':
      return { from: startOfMonth(today), to: endOfMonth(today) }
    case 'lastMonth': {
      const lastMonth = subDays(startOfMonth(today), 1)
      return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) }
    }
    case 'thisYear':
      return { from: startOfYear(today), to: endOfYear(today) }
    case 'lastYear': {
      const lastYear = new Date(today.getFullYear() - 1, 0, 1)
      return { from: startOfYear(lastYear), to: endOfYear(lastYear) }
    }
    case 'custom':
      return null
    default:
      return { from: subDays(today, 29), to: today }
  }
}

export function ReportsView() {
  const [activeTab, setActiveTab] = useState<string>('operations')
  const [quickRange, setQuickRange] = useState<QuickRange>('last30')
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const today = new Date()
    return { from: subDays(today, 29), to: today }
  })
  const [showCustomCalendar, setShowCustomCalendar] = useState(false)
  
  const reportsData = useReportsData(dateRange)

  const handleQuickRangeChange = (value: QuickRange) => {
    setQuickRange(value)
    if (value === 'custom') {
      setShowCustomCalendar(true)
    } else {
      setShowCustomCalendar(false)
      const range = getDateRangeFromQuick(value)
      if (range) {
        setDateRange(range)
      }
    }
  }

  const handleExport = (format: 'csv' | 'pdf' | 'excel') => {
    if (format !== 'csv') {
      toast.info(`${format.toUpperCase()} export coming soon`)
      return
    }

    try {
      switch (activeTab) {
        case 'operations':
          if (reportsData.operationsData) {
            exportOperationsReportCSV(reportsData.operationsData)
            toast.success('Operations report exported successfully')
          }
          break
        case 'revenue':
          if (reportsData.revenueData) {
            exportRevenueReportCSV(reportsData.revenueData)
            toast.success('Revenue report exported successfully')
          }
          break
        case 'reservations':
          if (reportsData.reservationData) {
            exportReservationReportCSV(reportsData.reservationData)
            toast.success('Reservation report exported successfully')
          }
          break
        case 'housekeeping':
          if (reportsData.housekeepingData) {
            exportHousekeepingReportCSV(reportsData.housekeepingData)
            toast.success('Housekeeping report exported successfully')
          }
          break
        case 'channels':
          if (reportsData.channelData) {
            exportChannelReportCSV(reportsData.channelData)
            toast.success('Channel report exported successfully')
          }
          break
        case 'guests':
          if (reportsData.guestData) {
            exportGuestReportCSV(reportsData.guestData)
            toast.success('Guest report exported successfully')
          }
          break
      }
    } catch (error) {
      toast.error('Failed to export report')
      console.error('Export error:', error)
    }
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="border-b bg-card">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Reports & Analytics</h1>
              <p className="text-sm text-muted-foreground">
                Operational intelligence and performance metrics
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Select value={quickRange} onValueChange={(v) => handleQuickRangeChange(v as QuickRange)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent>
                  {quickRanges.map((range) => (
                    <SelectItem key={range.value} value={range.value}>
                      {range.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {showCustomCalendar && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[280px] justify-start text-left font-normal">
                      <CalendarBlank className="mr-2 h-4 w-4" />
                      {dateRange?.from ? (
                        dateRange.to ? (
                          <>
                            {format(dateRange.from, "LLL dd, y")} -{" "}
                            {format(dateRange.to, "LLL dd, y")}
                          </>
                        ) : (
                          format(dateRange.from, "LLL dd, y")
                        )
                      ) : (
                        <span>Pick a date range</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="range"
                      defaultMonth={dateRange?.from}
                      selected={{ from: dateRange?.from, to: dateRange?.to }}
                      onSelect={(range) => {
                        if (range?.from) {
                          setDateRange({ from: range.from, to: range.to || range.from })
                        }
                      }}
                      numberOfMonths={2}
                    />
                  </PopoverContent>
                </Popover>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <Download className="mr-2 h-4 w-4" />
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleExport('csv')}>
                    Export as CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport('pdf')}>
                    Export as PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport('excel')}>
                    Export as Excel
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {!showCustomCalendar && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarBlank className="h-4 w-4" />
              <span>
                {format(dateRange.from, "MMM d, yyyy")} - {format(dateRange.to, "MMM d, yyyy")}
              </span>
              <span className="text-xs">
                ({Math.ceil((dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24)) + 1} days)
              </span>
            </div>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="px-6">
          <TabsList className="grid w-full grid-cols-6 h-auto">
            <TabsTrigger value="operations" className="flex items-center gap-2 py-3">
              <ChartBar className="h-4 w-4" />
              <span className="hidden sm:inline">Operations</span>
            </TabsTrigger>
            <TabsTrigger value="revenue" className="flex items-center gap-2 py-3">
              <CurrencyCircleDollar className="h-4 w-4" />
              <span className="hidden sm:inline">Revenue</span>
            </TabsTrigger>
            <TabsTrigger value="reservations" className="flex items-center gap-2 py-3">
              <CalendarBlank className="h-4 w-4" />
              <span className="hidden sm:inline">Reservations</span>
            </TabsTrigger>
            <TabsTrigger value="housekeeping" className="flex items-center gap-2 py-3">
              <Broom className="h-4 w-4" />
              <span className="hidden sm:inline">Housekeeping</span>
            </TabsTrigger>
            <TabsTrigger value="channels" className="flex items-center gap-2 py-3">
              <ArrowsClockwise className="h-4 w-4" />
              <span className="hidden sm:inline">Channels</span>
            </TabsTrigger>
            <TabsTrigger value="guests" className="flex items-center gap-2 py-3">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Guests</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-6">
          <TabsContent value="operations" className="mt-0">
            <OperationsReportView dateRange={dateRange} />
          </TabsContent>

          <TabsContent value="revenue" className="mt-0">
            <RevenueReportView dateRange={dateRange} />
          </TabsContent>

          <TabsContent value="reservations" className="mt-0">
            <ReservationReportView dateRange={dateRange} />
          </TabsContent>

          <TabsContent value="housekeeping" className="mt-0">
            <HousekeepingReportView dateRange={dateRange} />
          </TabsContent>

          <TabsContent value="channels" className="mt-0">
            <ChannelReportView dateRange={dateRange} />
          </TabsContent>

          <TabsContent value="guests" className="mt-0">
            <GuestReportView dateRange={dateRange} />
          </TabsContent>
        </div>
      </div>
    </div>
  )
}
