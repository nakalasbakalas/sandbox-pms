import { useState, useMemo } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { 
  CurrencyCircleDollar,
  TrendUp,
  TrendDown,
  CalendarBlank,
  Receipt,
  ChartLine,
  Download,
  FileText
} from '@phosphor-icons/react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfDay, endOfDay } from 'date-fns'
import { cn } from '@/lib/utils'

interface AccountingEntry {
  id: string
  date: string
  type: 'REVENUE' | 'EXPENSE' | 'REFUND' | 'ADJUSTMENT'
  category: string
  subcategory?: string
  amount: number
  description: string
  referenceType?: 'FOLIO' | 'RESERVATION' | 'MANUAL'
  referenceId?: string
  paymentMethod?: string
  taxAmount?: number
  createdBy: string
  createdAt: string
}

interface RevenueCategory {
  id: string
  name: string
  subcategories: string[]
  glCode?: string
}

interface ExpenseCategory {
  id: string
  name: string
  subcategories: string[]
  glCode?: string
}

export function AccountingDashboard() {
  const [entries, setEntries] = useKV<AccountingEntry[]>('accounting-entries', [])
  const [folios] = useKV<any[]>('folios', [])
  const [selectedMonth, setSelectedMonth] = useState(new Date())
  
  const revenueCategories: RevenueCategory[] = [
    {
      id: 'room-revenue',
      name: 'Room Revenue',
      subcategories: ['Rack Rate', 'Corporate Rate', 'Walk-in', 'OTA Bookings'],
      glCode: '4100'
    },
    {
      id: 'food-beverage',
      name: 'Food & Beverage',
      subcategories: ['Restaurant', 'Room Service', 'Minibar', 'Bar'],
      glCode: '4200'
    },
    {
      id: 'other-revenue',
      name: 'Other Revenue',
      subcategories: ['Extra Guest Fee', 'Child Fee', 'Late Checkout', 'Early Checkin', 'Laundry', 'Parking'],
      glCode: '4300'
    },
    {
      id: 'service-charges',
      name: 'Service Charges',
      subcategories: ['Service Charge', 'Tourism Fee'],
      glCode: '4400'
    }
  ]

  const expenseCategories: ExpenseCategory[] = [
    {
      id: 'cost-of-sales',
      name: 'Cost of Sales',
      subcategories: ['F&B Cost', 'Minibar Cost', 'Laundry Cost'],
      glCode: '5100'
    },
    {
      id: 'staff-costs',
      name: 'Staff Costs',
      subcategories: ['Salaries', 'Benefits', 'Training'],
      glCode: '6100'
    },
    {
      id: 'operations',
      name: 'Operations',
      subcategories: ['Utilities', 'Maintenance', 'Supplies', 'Cleaning'],
      glCode: '6200'
    },
    {
      id: 'marketing',
      name: 'Marketing & Sales',
      subcategories: ['OTA Commissions', 'Advertising', 'Photography'],
      glCode: '6300'
    },
    {
      id: 'administrative',
      name: 'Administrative',
      subcategories: ['Office Supplies', 'Software', 'Bank Fees', 'Professional Services'],
      glCode: '6400'
    }
  ]

  const monthStart = startOfMonth(selectedMonth)
  const monthEnd = endOfMonth(selectedMonth)
  
  const monthEntries = useMemo(() => {
    return entries.filter(entry => {
      const entryDate = new Date(entry.date)
      return entryDate >= monthStart && entryDate <= monthEnd
    })
  }, [entries, monthStart, monthEnd])

  const monthRevenue = useMemo(() => {
    return monthEntries
      .filter(e => e.type === 'REVENUE')
      .reduce((sum, e) => sum + e.amount, 0)
  }, [monthEntries])

  const monthExpenses = useMemo(() => {
    return monthEntries
      .filter(e => e.type === 'EXPENSE')
      .reduce((sum, e) => sum + e.amount, 0)
  }, [monthEntries])

  const monthRefunds = useMemo(() => {
    return monthEntries
      .filter(e => e.type === 'REFUND')
      .reduce((sum, e) => sum + e.amount, 0)
  }, [monthEntries])

  const netIncome = monthRevenue - monthExpenses - monthRefunds

  const revenueByCategoryData = useMemo(() => {
    const categoryTotals = new Map<string, number>()
    
    monthEntries
      .filter(e => e.type === 'REVENUE')
      .forEach(entry => {
        const current = categoryTotals.get(entry.category) || 0
        categoryTotals.set(entry.category, current + entry.amount)
      })
    
    return Array.from(categoryTotals.entries()).map(([category, amount]) => ({
      category,
      amount,
      percentage: (amount / monthRevenue) * 100
    })).sort((a, b) => b.amount - a.amount)
  }, [monthEntries, monthRevenue])

  const expenseByCategoryData = useMemo(() => {
    const categoryTotals = new Map<string, number>()
    
    monthEntries
      .filter(e => e.type === 'EXPENSE')
      .forEach(entry => {
        const current = categoryTotals.get(entry.category) || 0
        categoryTotals.set(entry.category, current + entry.amount)
      })
    
    return Array.from(categoryTotals.entries()).map(([category, amount]) => ({
      category,
      amount,
      percentage: (amount / monthExpenses) * 100
    })).sort((a, b) => b.amount - a.amount)
  }, [monthEntries, monthExpenses])

  const dailyRevenueData = useMemo(() => {
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
    
    return days.map(day => {
      const dayStart = startOfDay(day)
      const dayEnd = endOfDay(day)
      
      const dayRevenue = entries
        .filter(e => {
          const entryDate = new Date(e.date)
          return e.type === 'REVENUE' && entryDate >= dayStart && entryDate <= dayEnd
        })
        .reduce((sum, e) => sum + e.amount, 0)
      
      return {
        date: format(day, 'MMM d'),
        revenue: dayRevenue
      }
    })
  }, [entries, monthStart, monthEnd])

  const maxDailyRevenue = Math.max(...dailyRevenueData.map(d => d.revenue))

  const paymentMethodBreakdown = useMemo(() => {
    const methodTotals = new Map<string, number>()
    
    monthEntries
      .filter(e => e.type === 'REVENUE' && e.paymentMethod)
      .forEach(entry => {
        const method = entry.paymentMethod || 'Unknown'
        const current = methodTotals.get(method) || 0
        methodTotals.set(method, current + entry.amount)
      })
    
    return Array.from(methodTotals.entries())
      .map(([method, amount]) => ({
        method,
        amount,
        percentage: (amount / monthRevenue) * 100
      }))
      .sort((a, b) => b.amount - a.amount)
  }, [monthEntries, monthRevenue])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Financial Dashboard</h2>
          <p className="text-muted-foreground">{format(selectedMonth, 'MMMM yyyy')}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setSelectedMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
          >
            Previous Month
          </Button>
          <Button
            variant="outline"
            onClick={() => setSelectedMonth(new Date())}
          >
            Current Month
          </Button>
          <Button
            variant="outline"
            onClick={() => setSelectedMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
          >
            Next Month
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
              <TrendUp className="w-4 h-4 text-green-500" />
            </div>
            <p className="text-3xl font-bold">฿{monthRevenue.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {monthEntries.filter(e => e.type === 'REVENUE').length} transactions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">Total Expenses</p>
              <TrendDown className="w-4 h-4 text-red-500" />
            </div>
            <p className="text-3xl font-bold">฿{monthExpenses.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {monthEntries.filter(e => e.type === 'EXPENSE').length} transactions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">Refunds</p>
              <Receipt className="w-4 h-4 text-orange-500" />
            </div>
            <p className="text-3xl font-bold">฿{monthRefunds.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {monthEntries.filter(e => e.type === 'REFUND').length} refunds
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">Net Income</p>
              <CurrencyCircleDollar className="w-4 h-4 text-primary" />
            </div>
            <p className={cn(
              "text-3xl font-bold",
              netIncome >= 0 ? "text-green-600" : "text-red-600"
            )}>
              ฿{netIncome.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Profit Margin: {monthRevenue > 0 ? ((netIncome / monthRevenue) * 100).toFixed(1) : 0}%
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <Card className="col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ChartLine className="w-5 h-5" />
              Daily Revenue Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {dailyRevenueData.map((data, index) => (
                <div key={index} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-12">{data.date}</span>
                  <div className="flex-1 bg-muted rounded-full h-6 overflow-hidden">
                    <div
                      className="bg-primary h-full flex items-center justify-end px-2 transition-all"
                      style={{ width: `${(data.revenue / maxDailyRevenue) * 100}%` }}
                    >
                      {data.revenue > 0 && (
                        <span className="text-xs font-medium text-primary-foreground">
                          ฿{data.revenue.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment Methods</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <div className="space-y-4">
                {paymentMethodBreakdown.map((data, index) => (
                  <div key={index}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{data.method}</span>
                      <span className="text-sm text-muted-foreground">
                        {data.percentage.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-muted rounded-full h-2">
                        <div
                          className="bg-primary h-full rounded-full"
                          style={{ width: `${data.percentage}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium">฿{data.amount.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="revenue" className="space-y-4">
        <TabsList>
          <TabsTrigger value="revenue">Revenue Breakdown</TabsTrigger>
          <TabsTrigger value="expenses">Expense Breakdown</TabsTrigger>
          <TabsTrigger value="transactions">Transaction Log</TabsTrigger>
        </TabsList>

        <TabsContent value="revenue">
          <Card>
            <CardHeader>
              <CardTitle>Revenue by Category</CardTitle>
              <CardDescription>Detailed revenue breakdown for {format(selectedMonth, 'MMMM yyyy')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {revenueByCategoryData.map((data, index) => (
                  <div key={index} className="p-4 border rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h4 className="font-semibold">{data.category}</h4>
                        <p className="text-sm text-muted-foreground">{data.percentage.toFixed(1)}% of total revenue</p>
                      </div>
                      <p className="text-2xl font-bold">฿{data.amount.toLocaleString()}</p>
                    </div>
                    <div className="bg-muted rounded-full h-2">
                      <div
                        className="bg-green-500 h-full rounded-full"
                        style={{ width: `${data.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expenses">
          <Card>
            <CardHeader>
              <CardTitle>Expenses by Category</CardTitle>
              <CardDescription>Detailed expense breakdown for {format(selectedMonth, 'MMMM yyyy')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {expenseByCategoryData.map((data, index) => (
                  <div key={index} className="p-4 border rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h4 className="font-semibold">{data.category}</h4>
                        <p className="text-sm text-muted-foreground">{data.percentage.toFixed(1)}% of total expenses</p>
                      </div>
                      <p className="text-2xl font-bold text-red-600">฿{data.amount.toLocaleString()}</p>
                    </div>
                    <div className="bg-muted rounded-full h-2">
                      <div
                        className="bg-red-500 h-full rounded-full"
                        style={{ width: `${data.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transactions">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Transaction History</CardTitle>
                <Button variant="outline" size="sm">
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {monthEntries.slice().reverse().map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant={
                            entry.type === 'REVENUE' ? 'default' :
                            entry.type === 'EXPENSE' ? 'destructive' :
                            'secondary'
                          }>
                            {entry.type}
                          </Badge>
                          <span className="text-sm font-medium">{entry.category}</span>
                          {entry.subcategory && (
                            <span className="text-xs text-muted-foreground">• {entry.subcategory}</span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{entry.description}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {format(new Date(entry.date), 'MMM d, yyyy HH:mm')}
                          {entry.paymentMethod && ` • ${entry.paymentMethod}`}
                        </p>
                      </div>
                      <p className={cn(
                        "text-lg font-bold",
                        entry.type === 'REVENUE' ? 'text-green-600' :
                        entry.type === 'EXPENSE' ? 'text-red-600' :
                        'text-orange-600'
                      )}>
                        {entry.type === 'REVENUE' ? '+' : '-'}฿{entry.amount.toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
