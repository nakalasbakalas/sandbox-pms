import { useState, useMemo } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfDay, endOfDay, subDays } from 'date-fns'
import { cn } from '@/lib/utils'
import { ManualEntryForm } from './ManualEntryForm'
import { toast } from 'sonner'

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

type CsvValue = string | number | undefined | null

const GL_CODE_BY_CATEGORY: Record<string, string> = {
  'Room Revenue': '4100',
  'Food & Beverage': '4200',
  'Other Revenue': '4300',
  'Service Charges': '4400',
  'Folio Payments': '4100',
  'Cost of Sales': '5100',
  'Staff Costs': '6100',
  Operations: '6200',
  'Marketing & Sales': '6300',
  Administrative: '6400',
}

function parseDateInput(value: string): Date {
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function escapeCsv(value: CsvValue): string {
  if (value === undefined || value === null) return ''
  const text = String(value)
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function downloadCsv(filename: string, rows: CsvValue[][]) {
  const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function AccountingDashboard() {
  const [entries, setEntries] = useKV<AccountingEntry[]>('accounting-entries', [])
  const [folios] = useKV<any[]>('folios', [])
  const [selectedMonth, setSelectedMonth] = useState(new Date())
  const [manualEntryOpen, setManualEntryOpen] = useState(false)
  const [exportStartDate, setExportStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [exportEndDate, setExportEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'))
  
  const handleManualEntrySubmit = (entry: Omit<AccountingEntry, 'id' | 'createdAt' | 'createdBy'>) => {
    const newEntry: AccountingEntry = {
      ...entry,
      id: `ACC${String(Date.now()).slice(-6)}`,
      createdBy: 'Current User',
      createdAt: new Date().toISOString()
    }
    
    setEntries((currentEntries) => [newEntry, ...(Array.isArray(currentEntries) ? currentEntries : [])])
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
  const exportStart = startOfDay(parseDateInput(exportStartDate))
  const exportEnd = endOfDay(parseDateInput(exportEndDate))
  const isExportRangeValid = exportStart <= exportEnd
  
  const monthEntries = useMemo(() => {
    if (!Array.isArray(entries)) return []
    return entries.filter(entry => {
      const entryDate = new Date(entry.date)
      return entryDate >= monthStart && entryDate <= monthEnd
    })
  }, [entries, monthStart, monthEnd])

  const exportPeriodEntries = useMemo(() => {
    if (!Array.isArray(entries) || !isExportRangeValid) return []
    return entries.filter(entry => {
      const entryDate = new Date(entry.date)
      return entryDate >= exportStart && entryDate <= exportEnd
    })
  }, [entries, exportStart, exportEnd, isExportRangeValid])

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

  const exportPeriodSummary = useMemo(() => {
    const revenue = exportPeriodEntries
      .filter(e => e.type === 'REVENUE')
      .reduce((sum, e) => sum + e.amount, 0)
    const expenses = exportPeriodEntries
      .filter(e => e.type === 'EXPENSE')
      .reduce((sum, e) => sum + e.amount, 0)
    const refunds = exportPeriodEntries
      .filter(e => e.type === 'REFUND')
      .reduce((sum, e) => sum + e.amount, 0)
    const adjustments = exportPeriodEntries
      .filter(e => e.type === 'ADJUSTMENT')
      .reduce((sum, e) => sum + e.amount, 0)
    const taxCollected = exportPeriodEntries.reduce((sum, e) => sum + (e.taxAmount || 0), 0)
    const missingReferences = exportPeriodEntries.filter(e => e.referenceType && !e.referenceId).length
    const missingPaymentMethods = exportPeriodEntries.filter(e => (e.type === 'REVENUE' || e.type === 'REFUND') && !e.paymentMethod).length
    const unmappedGlEntries = exportPeriodEntries.filter(e => !GL_CODE_BY_CATEGORY[e.category]).length

    return {
      revenue,
      expenses,
      refunds,
      adjustments,
      taxCollected,
      netIncome: revenue - expenses - refunds - adjustments,
      netRevenueBeforeTax: revenue - taxCollected,
      missingReferences,
      missingPaymentMethods,
      unmappedGlEntries,
    }
  }, [exportPeriodEntries])

  const exportPaymentBreakdown = useMemo(() => {
    const totals = new Map<string, number>()
    exportPeriodEntries
      .filter(entry => entry.paymentMethod)
      .forEach(entry => {
        const method = entry.paymentMethod || 'Unknown'
        totals.set(method, (totals.get(method) || 0) + entry.amount)
      })

    return Array.from(totals.entries())
      .map(([method, amount]) => ({ method, amount }))
      .sort((a, b) => b.amount - a.amount)
  }, [exportPeriodEntries])

  const glSummary = useMemo(() => {
    const totals = new Map<string, { glCode: string; category: string; type: string; debit: number; credit: number }>()

    exportPeriodEntries.forEach(entry => {
      const glCode = GL_CODE_BY_CATEGORY[entry.category] || 'UNMAPPED'
      const key = `${glCode}-${entry.category}-${entry.type}`
      const current = totals.get(key) || {
        glCode,
        category: entry.category,
        type: entry.type,
        debit: 0,
        credit: 0,
      }

      if (entry.type === 'REVENUE') {
        current.credit += entry.amount
      } else {
        current.debit += entry.amount
      }

      totals.set(key, current)
    })

    return Array.from(totals.values()).sort((a, b) => a.glCode.localeCompare(b.glCode))
  }, [exportPeriodEntries])

  const outstandingFolios = useMemo(() => {
    if (!Array.isArray(folios)) return { count: 0, balance: 0 }
    const open = folios.filter(folio => Number(folio?.balance || 0) > 0)
    return {
      count: open.length,
      balance: open.reduce((sum, folio) => sum + Number(folio?.balance || 0), 0),
    }
  }, [folios])

  const controlFindings = [
    {
      label: 'Unmapped GL categories',
      count: exportPeriodSummary.unmappedGlEntries,
      detail: 'Map these before sending a ledger import to an accountant.',
    },
    {
      label: 'Revenue/refunds missing payment method',
      count: exportPeriodSummary.missingPaymentMethods,
      detail: 'Needed for cash, bank, card, and PromptPay reconciliation.',
    },
    {
      label: 'Referenced entries missing reference ID',
      count: exportPeriodSummary.missingReferences,
      detail: 'Referenced transactions should point to a folio or reservation.',
    },
    {
      label: 'Open folios with balance',
      count: outstandingFolios.count,
      detail: `Outstanding receivables: à¸¿${outstandingFolios.balance.toLocaleString()}.`,
    },
  ]

  const applyExportPreset = (preset: 'month' | 'last7' | 'last30' | 'today') => {
    const today = new Date()
    if (preset === 'today') {
      setExportStartDate(format(today, 'yyyy-MM-dd'))
      setExportEndDate(format(today, 'yyyy-MM-dd'))
      return
    }
    if (preset === 'last7') {
      setExportStartDate(format(subDays(today, 6), 'yyyy-MM-dd'))
      setExportEndDate(format(today, 'yyyy-MM-dd'))
      return
    }
    if (preset === 'last30') {
      setExportStartDate(format(subDays(today, 29), 'yyyy-MM-dd'))
      setExportEndDate(format(today, 'yyyy-MM-dd'))
      return
    }

    setExportStartDate(format(startOfMonth(today), 'yyyy-MM-dd'))
    setExportEndDate(format(endOfMonth(today), 'yyyy-MM-dd'))
  }

  const validateExportRange = () => {
    if (!isExportRangeValid) {
      toast.error('Export start date must be before the end date.')
      return false
    }
    return true
  }

  const handleExportTransactions = () => {
    if (!validateExportRange()) return
    if (exportPeriodEntries.length === 0) {
      toast.message('No accounting entries found for this period.')
      return
    }

    const rows: CsvValue[][] = [
      ['date', 'entry_id', 'type', 'gl_code', 'category', 'subcategory', 'description', 'gross_amount', 'tax_amount', 'net_amount', 'payment_method', 'reference_type', 'reference_id', 'created_by'],
      ...exportPeriodEntries.map(entry => {
        const taxAmount = entry.taxAmount || 0
        return [
          format(new Date(entry.date), 'yyyy-MM-dd HH:mm'),
          entry.id,
          entry.type,
          GL_CODE_BY_CATEGORY[entry.category] || '',
          entry.category,
          entry.subcategory || '',
          entry.description,
          entry.amount.toFixed(2),
          taxAmount.toFixed(2),
          (entry.amount - taxAmount).toFixed(2),
          entry.paymentMethod || '',
          entry.referenceType || '',
          entry.referenceId || '',
          entry.createdBy,
        ]
      }),
    ]

    downloadCsv(`accounting-transactions-${exportStartDate}-to-${exportEndDate}.csv`, rows)
    toast.success('Accounting transactions exported.')
  }

  const handleExportAccountingPack = () => {
    if (!validateExportRange()) return

    const rows: CsvValue[][] = [
      ['section', 'metric', 'value', 'extra_1', 'extra_2', 'extra_3'],
      ['summary', 'period_start', exportStartDate],
      ['summary', 'period_end', exportEndDate],
      ['summary', 'gross_revenue', exportPeriodSummary.revenue.toFixed(2)],
      ['summary', 'net_revenue_before_tax', exportPeriodSummary.netRevenueBeforeTax.toFixed(2)],
      ['summary', 'tax_collected', exportPeriodSummary.taxCollected.toFixed(2)],
      ['summary', 'expenses', exportPeriodSummary.expenses.toFixed(2)],
      ['summary', 'refunds', exportPeriodSummary.refunds.toFixed(2)],
      ['summary', 'adjustments', exportPeriodSummary.adjustments.toFixed(2)],
      ['summary', 'net_income', exportPeriodSummary.netIncome.toFixed(2)],
      ['summary', 'outstanding_folio_balance', outstandingFolios.balance.toFixed(2), `${outstandingFolios.count} folios`],
      [],
      ['gl_summary', 'gl_code', 'category', 'type', 'debit', 'credit'],
      ...glSummary.map(row => ['gl_summary', row.glCode, row.category, row.type, row.debit.toFixed(2), row.credit.toFixed(2)]),
      [],
      ['payment_methods', 'method', 'amount'],
      ...exportPaymentBreakdown.map(row => ['payment_methods', row.method, row.amount.toFixed(2)]),
      [],
      ['control_checks', 'check', 'count', 'detail'],
      ...controlFindings.map(row => ['control_checks', row.label, row.count, row.detail]),
    ]

    downloadCsv(`accounting-close-pack-${exportStartDate}-to-${exportEndDate}.csv`, rows)
    toast.success('Accounting close pack exported.')
  }

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

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="export-start" className="text-xs">Export from</Label>
              <Input
                id="export-start"
                type="date"
                value={exportStartDate}
                onChange={(event) => setExportStartDate(event.target.value)}
                className="h-8 w-[150px] text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="export-end" className="text-xs">Export to</Label>
              <Input
                id="export-end"
                type="date"
                value={exportEndDate}
                onChange={(event) => setExportEndDate(event.target.value)}
                className="h-8 w-[150px] text-xs"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => applyExportPreset('today')}>Today</Button>
              <Button variant="outline" size="sm" onClick={() => applyExportPreset('last7')}>7 days</Button>
              <Button variant="outline" size="sm" onClick={() => applyExportPreset('last30')}>30 days</Button>
              <Button variant="outline" size="sm" onClick={() => applyExportPreset('month')}>This month</Button>
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={handleExportTransactions}>
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
              <Button size="sm" onClick={handleExportAccountingPack}>
                <FileText className="w-4 h-4 mr-2" />
                Close Pack
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3 text-sm">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Period revenue</div>
              <div className="font-bold text-emerald-600">à¸¿{exportPeriodSummary.revenue.toLocaleString()}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Tax collected</div>
              <div className="font-bold">à¸¿{exportPeriodSummary.taxCollected.toLocaleString()}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Period net</div>
              <div className={cn('font-bold', exportPeriodSummary.netIncome >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                à¸¿{exportPeriodSummary.netIncome.toLocaleString()}
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Control flags</div>
              <div className="font-bold text-orange-600">
                {controlFindings.reduce((sum, item) => sum + item.count, 0)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

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
          <TabsTrigger value="tax-gl">Tax & GL</TabsTrigger>
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
                <Button variant="outline" size="sm" onClick={handleExportTransactions}>
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

        <TabsContent value="tax-gl">
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Tax Summary</CardTitle>
                <CardDescription>{exportStartDate} to {exportEndDate}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Gross revenue</span>
                  <span className="font-semibold">à¸¿{exportPeriodSummary.revenue.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tax collected</span>
                  <span className="font-semibold">à¸¿{exportPeriodSummary.taxCollected.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Revenue before tax</span>
                  <span className="font-semibold">à¸¿{exportPeriodSummary.netRevenueBeforeTax.toLocaleString()}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>GL Summary</CardTitle>
                <CardDescription>Debit and credit export preview</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[220px]">
                  <div className="space-y-2">
                    {glSummary.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No entries in this period.</p>
                    ) : (
                      glSummary.map((row) => (
                        <div key={`${row.glCode}-${row.category}-${row.type}`} className="rounded-md border p-2 text-xs">
                          <div className="flex justify-between font-medium">
                            <span>{row.glCode} {row.category}</span>
                            <Badge variant="outline" className="text-[10px]">{row.type}</Badge>
                          </div>
                          <div className="mt-1 flex justify-between text-muted-foreground">
                            <span>Debit à¸¿{row.debit.toLocaleString()}</span>
                            <span>Credit à¸¿{row.credit.toLocaleString()}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Accounting Controls</CardTitle>
                <CardDescription>Pre-export checks for the selected period</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {controlFindings.map((finding) => (
                  <div key={finding.label} className="rounded-md border p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{finding.label}</span>
                      <Badge variant={finding.count > 0 ? 'destructive' : 'secondary'}>{finding.count}</Badge>
                    </div>
                    <p className="mt-1 text-muted-foreground">{finding.detail}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
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
