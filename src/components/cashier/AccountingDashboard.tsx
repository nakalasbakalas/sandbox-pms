import { useState, useMemo, useEffect } from 'react'
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
  FileText,
  Plus
} from '@phosphor-icons/react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfDay, endOfDay } from 'date-fns'
import { cn } from '@/lib/utils'
import { ManualEntryForm } from './ManualEntryForm'

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

function generateSampleAccountingEntries(): AccountingEntry[] {
  const entries: AccountingEntry[] = []
  const now = new Date()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()
  
  const revenueCategories = [
    { category: 'Room Revenue', subcategories: ['Rack Rate', 'Corporate Rate', 'Walk-in', 'OTA Bookings'] },
    { category: 'Food & Beverage', subcategories: ['Restaurant', 'Room Service', 'Minibar', 'Bar'] },
    { category: 'Other Revenue', subcategories: ['Extra Guest Fee', 'Child Fee', 'Late Checkout', 'Laundry'] },
    { category: 'Service Charges', subcategories: ['Service Charge', 'Tourism Fee'] }
  ]
  
  const expenseCategories = [
    { category: 'Cost of Sales', subcategories: ['F&B Cost', 'Minibar Cost', 'Laundry Cost'] },
    { category: 'Staff Costs', subcategories: ['Salaries', 'Benefits', 'Training'] },
    { category: 'Operations', subcategories: ['Utilities', 'Maintenance', 'Supplies', 'Cleaning'] },
    { category: 'Marketing & Sales', subcategories: ['OTA Commissions', 'Advertising', 'Photography'] },
    { category: 'Administrative', subcategories: ['Office Supplies', 'Software', 'Bank Fees'] }
  ]
  
  const paymentMethods = ['CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER', 'MOBILE_PAYMENT']
  const users = ['Sarah (Front Desk)', 'Michael (Manager)', 'Emma (Cashier)', 'Admin']
  
  let idCounter = 1
  
  for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
    const date = new Date(currentYear, currentMonth, dayOffset + 1)
    const dateStr = date.toISOString()
    
    const roomRevenueCount = Math.floor(Math.random() * 8) + 5
    for (let i = 0; i < roomRevenueCount; i++) {
      const roomType = ['Standard Room', 'Deluxe Room', 'Suite'][Math.floor(Math.random() * 3)]
      const basePrice = roomType === 'Suite' ? 4500 : roomType === 'Deluxe Room' ? 3200 : 2500
      const amount = basePrice + Math.floor(Math.random() * 1000)
      const taxAmount = amount * 0.07
      const subcategory = revenueCategories[0].subcategories[Math.floor(Math.random() * 4)]
      
      entries.push({
        id: `ACC${String(idCounter++).padStart(6, '0')}`,
        date: dateStr,
        type: 'REVENUE',
        category: 'Room Revenue',
        subcategory,
        amount: amount + taxAmount,
        description: `${roomType} - ${subcategory}`,
        referenceType: 'FOLIO',
        referenceId: `FOLIO${Math.floor(Math.random() * 1000)}`,
        paymentMethod: paymentMethods[Math.floor(Math.random() * paymentMethods.length)],
        taxAmount,
        createdBy: users[Math.floor(Math.random() * users.length)],
        createdAt: dateStr
      })
    }
    
    if (Math.random() < 0.8) {
      const fbItems = Math.floor(Math.random() * 5) + 1
      for (let i = 0; i < fbItems; i++) {
        const subcategory = revenueCategories[1].subcategories[Math.floor(Math.random() * 4)]
        const baseAmount = Math.floor(Math.random() * 800) + 200
        const taxAmount = baseAmount * 0.07
        
        entries.push({
          id: `ACC${String(idCounter++).padStart(6, '0')}`,
          date: dateStr,
          type: 'REVENUE',
          category: 'Food & Beverage',
          subcategory,
          amount: baseAmount + taxAmount,
          description: subcategory === 'Restaurant' ? 'Breakfast/Lunch Service' : 
                       subcategory === 'Room Service' ? 'In-Room Dining' :
                       subcategory === 'Minibar' ? 'Minibar Consumption' : 'Bar Service',
          referenceType: Math.random() < 0.7 ? 'FOLIO' : 'MANUAL',
          referenceId: Math.random() < 0.7 ? `FOLIO${Math.floor(Math.random() * 1000)}` : undefined,
          paymentMethod: paymentMethods[Math.floor(Math.random() * paymentMethods.length)],
          taxAmount,
          createdBy: users[Math.floor(Math.random() * users.length)],
          createdAt: dateStr
        })
      }
    }
    
    if (Math.random() < 0.4) {
      const subcategory = revenueCategories[2].subcategories[Math.floor(Math.random() * 4)]
      const amount = subcategory === 'Extra Guest Fee' ? 500 :
                     subcategory === 'Child Fee' ? 300 :
                     subcategory === 'Late Checkout' ? 800 : 250
      const taxAmount = amount * 0.07
      
      entries.push({
        id: `ACC${String(idCounter++).padStart(6, '0')}`,
        date: dateStr,
        type: 'REVENUE',
        category: 'Other Revenue',
        subcategory,
        amount: amount + taxAmount,
        description: `${subcategory} Service`,
        referenceType: 'FOLIO',
        referenceId: `FOLIO${Math.floor(Math.random() * 1000)}`,
        paymentMethod: paymentMethods[Math.floor(Math.random() * paymentMethods.length)],
        taxAmount,
        createdBy: users[Math.floor(Math.random() * users.length)],
        createdAt: dateStr
      })
    }
    
    if (dayOffset % 3 === 0) {
      const subcategory = expenseCategories[1].subcategories[Math.floor(Math.random() * 3)]
      const amount = subcategory === 'Salaries' ? Math.floor(Math.random() * 50000) + 30000 :
                     subcategory === 'Benefits' ? Math.floor(Math.random() * 10000) + 5000 :
                     Math.floor(Math.random() * 3000) + 500
      
      entries.push({
        id: `ACC${String(idCounter++).padStart(6, '0')}`,
        date: dateStr,
        type: 'EXPENSE',
        category: 'Staff Costs',
        subcategory,
        amount,
        description: `${subcategory} - ${format(date, 'MMMM yyyy')}`,
        referenceType: 'MANUAL',
        paymentMethod: 'BANK_TRANSFER',
        createdBy: 'Admin',
        createdAt: dateStr
      })
    }
    
    if (dayOffset % 2 === 0) {
      const subcategory = expenseCategories[2].subcategories[Math.floor(Math.random() * 4)]
      const amount = subcategory === 'Utilities' ? Math.floor(Math.random() * 15000) + 5000 :
                     subcategory === 'Maintenance' ? Math.floor(Math.random() * 8000) + 2000 :
                     Math.floor(Math.random() * 3000) + 500
      
      entries.push({
        id: `ACC${String(idCounter++).padStart(6, '0')}`,
        date: dateStr,
        type: 'EXPENSE',
        category: 'Operations',
        subcategory,
        amount,
        description: `${subcategory} - Daily Operations`,
        referenceType: 'MANUAL',
        paymentMethod: Math.random() < 0.5 ? 'BANK_TRANSFER' : 'CASH',
        createdBy: users[1],
        createdAt: dateStr
      })
    }
    
    if (Math.random() < 0.3) {
      const subcategory = expenseCategories[0].subcategories[Math.floor(Math.random() * 3)]
      const amount = Math.floor(Math.random() * 5000) + 1000
      
      entries.push({
        id: `ACC${String(idCounter++).padStart(6, '0')}`,
        date: dateStr,
        type: 'EXPENSE',
        category: 'Cost of Sales',
        subcategory,
        amount,
        description: `${subcategory} - Inventory Purchase`,
        referenceType: 'MANUAL',
        paymentMethod: Math.random() < 0.7 ? 'BANK_TRANSFER' : 'CASH',
        createdBy: users[1],
        createdAt: dateStr
      })
    }
    
    if (dayOffset % 5 === 0) {
      const subcategory = expenseCategories[3].subcategories[Math.floor(Math.random() * 3)]
      const amount = subcategory === 'OTA Commissions' ? Math.floor(Math.random() * 12000) + 5000 :
                     subcategory === 'Advertising' ? Math.floor(Math.random() * 8000) + 2000 :
                     Math.floor(Math.random() * 4000) + 1000
      
      entries.push({
        id: `ACC${String(idCounter++).padStart(6, '0')}`,
        date: dateStr,
        type: 'EXPENSE',
        category: 'Marketing & Sales',
        subcategory,
        amount,
        description: `${subcategory} - ${format(date, 'MMM yyyy')}`,
        referenceType: 'MANUAL',
        paymentMethod: 'BANK_TRANSFER',
        createdBy: users[1],
        createdAt: dateStr
      })
    }
    
    if (Math.random() < 0.15) {
      const subcategory = expenseCategories[4].subcategories[Math.floor(Math.random() * 3)]
      const amount = subcategory === 'Software' ? Math.floor(Math.random() * 5000) + 1000 :
                     Math.floor(Math.random() * 2000) + 300
      
      entries.push({
        id: `ACC${String(idCounter++).padStart(6, '0')}`,
        date: dateStr,
        type: 'EXPENSE',
        category: 'Administrative',
        subcategory,
        amount,
        description: `${subcategory} - Administrative Expenses`,
        referenceType: 'MANUAL',
        paymentMethod: Math.random() < 0.8 ? 'BANK_TRANSFER' : 'CREDIT_CARD',
        createdBy: 'Admin',
        createdAt: dateStr
      })
    }
    
    if (Math.random() < 0.05) {
      const amount = Math.floor(Math.random() * 3000) + 500
      
      entries.push({
        id: `ACC${String(idCounter++).padStart(6, '0')}`,
        date: dateStr,
        type: 'REFUND',
        category: 'Room Revenue',
        subcategory: 'Cancellation Refund',
        amount,
        description: 'Reservation Cancellation Refund',
        referenceType: 'RESERVATION',
        referenceId: `RES${Math.floor(Math.random() * 1000)}`,
        paymentMethod: 'BANK_TRANSFER',
        createdBy: users[Math.floor(Math.random() * 2)],
        createdAt: dateStr
      })
    }
  }
  
  return entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export function AccountingDashboard() {
  const [entries, setEntries] = useKV<AccountingEntry[]>('accounting-entries', [])
  const [folios] = useKV<any[]>('folios', [])
  const [selectedMonth, setSelectedMonth] = useState(new Date())
  const [manualEntryOpen, setManualEntryOpen] = useState(false)
  
  useEffect(() => {
    if (entries.length === 0) {
      setEntries(generateSampleAccountingEntries())
    }
  }, [])

  const handleManualEntrySubmit = (entry: Omit<AccountingEntry, 'id' | 'createdAt' | 'createdBy'>) => {
    const newEntry: AccountingEntry = {
      ...entry,
      id: `ACC${String(Date.now()).slice(-6)}`,
      createdBy: 'Current User',
      createdAt: new Date().toISOString()
    }
    
    setEntries((currentEntries) => [newEntry, ...currentEntries])
  }
  
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
    if (!Array.isArray(entries)) return []
    return entries.filter(entry => {
      const entryDate = new Date(entry.date)
      return entryDate >= monthStart && entryDate <= monthEnd
    })
  }, [entries, monthStart, monthEnd])

  const monthRevenue = useMemo(() => {
    const revenueEntries = monthEntries.filter(e => e.type === 'REVENUE')
    return Array.isArray(revenueEntries) ? revenueEntries.reduce((sum, e) => sum + e.amount, 0) : 0
  }, [monthEntries])

  const monthExpenses = useMemo(() => {
    const expenseEntries = monthEntries.filter(e => e.type === 'EXPENSE')
    return Array.isArray(expenseEntries) ? expenseEntries.reduce((sum, e) => sum + e.amount, 0) : 0
  }, [monthEntries])

  const monthRefunds = useMemo(() => {
    const refundEntries = monthEntries.filter(e => e.type === 'REFUND')
    return Array.isArray(refundEntries) ? refundEntries.reduce((sum, e) => sum + e.amount, 0) : 0
  }, [monthEntries])

  const netIncome = monthRevenue - monthExpenses - monthRefunds

  const revenueByCategoryData = useMemo(() => {
    const categoryTotals = new Map<string, number>()
    
    if (!Array.isArray(monthEntries)) return []
    
    monthEntries
      .filter(e => e.type === 'REVENUE')
      .forEach(entry => {
        const current = categoryTotals.get(entry.category) || 0
        categoryTotals.set(entry.category, current + entry.amount)
      })
    
    return Array.from(categoryTotals.entries()).map(([category, amount]) => ({
      category,
      amount,
      percentage: monthRevenue > 0 ? (amount / monthRevenue) * 100 : 0
    })).sort((a, b) => b.amount - a.amount)
  }, [monthEntries, monthRevenue])

  const expenseByCategoryData = useMemo(() => {
    const categoryTotals = new Map<string, number>()
    
    if (!Array.isArray(monthEntries)) return []
    
    monthEntries
      .filter(e => e.type === 'EXPENSE')
      .forEach(entry => {
        const current = categoryTotals.get(entry.category) || 0
        categoryTotals.set(entry.category, current + entry.amount)
      })
    
    return Array.from(categoryTotals.entries()).map(([category, amount]) => ({
      category,
      amount,
      percentage: monthExpenses > 0 ? (amount / monthExpenses) * 100 : 0
    })).sort((a, b) => b.amount - a.amount)
  }, [monthEntries, monthExpenses])

  const dailyRevenueData = useMemo(() => {
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
    
    return days.map(day => {
      const dayStart = startOfDay(day)
      const dayEnd = endOfDay(day)
      
      const dayEntries = Array.isArray(entries) ? entries.filter(e => {
        const entryDate = new Date(e.date)
        return e.type === 'REVENUE' && entryDate >= dayStart && entryDate <= dayEnd
      }) : []
      
      const dayRevenue = dayEntries.reduce((sum, e) => sum + e.amount, 0)
      
      return {
        date: format(day, 'MMM d'),
        revenue: dayRevenue
      }
    })
  }, [entries, monthStart, monthEnd])

  const maxDailyRevenue = dailyRevenueData.length > 0 
    ? Math.max(...dailyRevenueData.map(d => d.revenue), 1) 
    : 1

  const paymentMethodBreakdown = useMemo(() => {
    const methodTotals = new Map<string, number>()
    
    if (!Array.isArray(monthEntries)) return []
    
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
        percentage: monthRevenue > 0 ? (amount / monthRevenue) * 100 : 0
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
            onClick={() => setManualEntryOpen(true)}
            className="gap-2"
          >
            <Plus size={18} weight="bold" />
            Post Entry
          </Button>
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

      <ManualEntryForm 
        open={manualEntryOpen}
        onOpenChange={setManualEntryOpen}
        onSubmit={handleManualEntrySubmit}
      />
    </div>
  )
}
