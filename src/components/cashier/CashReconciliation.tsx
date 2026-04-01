import { useState, useMemo, useEffect } from 'react'
import { useKV } from '@github/spark/hooks'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  Money,
  CheckCircle,
  Warning,
  Clock,
  Calculator,
  Printer,
  CheckSquare,
  XCircle,
  ArrowRight,
  Calendar
} from '@phosphor-icons/react'
import { format, startOfDay, endOfDay } from 'date-fns'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface CashDenomination {
  value: number
  count: number
  total: number
}

interface CashCount {
  bills: CashDenomination[]
  coins: CashDenomination[]
  total: number
}

interface CashReconciliationRecord {
  id: string
  date: string
  shiftType: 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT'
  openingBalance: number
  
  expectedCash: number
  actualCash: number
  variance: number
  variancePercentage: number
  
  cashSales: number
  cashPayments: number
  cashRefunds: number
  cashWithdrawals: number
  
  cashCount: CashCount
  
  status: 'IN_PROGRESS' | 'BALANCED' | 'OVER' | 'SHORT'
  notes?: string
  reconcileBy: string
  reviewedBy?: string
  
  createdAt: string
  completedAt?: string
}

const THAI_BILLS = [1000, 500, 100, 50, 20]
const THAI_COINS = [10, 5, 2, 1, 0.5, 0.25]

function createEmptyCashCount(): CashCount {
  return {
    bills: THAI_BILLS.map(value => ({ value, count: 0, total: 0 })),
    coins: THAI_COINS.map(value => ({ value, count: 0, total: 0 })),
    total: 0
  }
}

function calculateCashCount(count: CashCount): number {
  const billTotal = count.bills.reduce((sum, d) => sum + d.total, 0)
  const coinTotal = count.coins.reduce((sum, d) => sum + d.total, 0)
  return billTotal + coinTotal
}

export function CashReconciliation() {
  const [reconciliations, setReconciliations] = useKV<CashReconciliationRecord[]>('cash-reconciliations', [])
  const [entries] = useKV<any[]>('accounting-entries', [])
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [isReconciling, setIsReconciling] = useState(false)
  const [currentReconciliation, setCurrentReconciliation] = useState<CashReconciliationRecord | null>(null)
  const [cashCount, setCashCount] = useState<CashCount>(createEmptyCashCount())
  const [notes, setNotes] = useState('')
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false)
  const [selectedReconciliation, setSelectedReconciliation] = useState<CashReconciliationRecord | null>(null)

  const todayStart = startOfDay(selectedDate)
  const todayEnd = endOfDay(selectedDate)

  const todayCashTransactions = useMemo(() => {
    if (!Array.isArray(entries)) return { sales: 0, payments: 0, refunds: 0, withdrawals: 0 }
    
    const cashEntries = entries.filter(entry => {
      const entryDate = new Date(entry.date)
      return entry.paymentMethod === 'CASH' && entryDate >= todayStart && entryDate <= todayEnd
    })

    const sales = cashEntries
      .filter(e => e.type === 'REVENUE')
      .reduce((sum, e) => sum + e.amount, 0)
    
    const refunds = cashEntries
      .filter(e => e.type === 'REFUND')
      .reduce((sum, e) => sum + e.amount, 0)

    const withdrawals = cashEntries
      .filter(e => e.type === 'EXPENSE')
      .reduce((sum, e) => sum + e.amount, 0)

    return {
      sales,
      payments: sales,
      refunds,
      withdrawals
    }
  }, [entries, todayStart, todayEnd])

  const todayReconciliations = useMemo(() => {
    if (!Array.isArray(reconciliations)) return []
    return reconciliations.filter(rec => {
      const recDate = new Date(rec.date)
      return recDate >= todayStart && recDate <= todayEnd
    })
  }, [reconciliations, todayStart, todayEnd])

  const lastReconciliation = useMemo(() => {
    if (todayReconciliations.length === 0) {
      const sorted = [...reconciliations].sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      )
      return sorted[0] || null
    }
    const sorted = [...todayReconciliations].sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    )
    return sorted[0] || null
  }, [reconciliations, todayReconciliations])

  const openingBalance = lastReconciliation?.actualCash || 5000

  const expectedCash = useMemo(() => {
    return openingBalance + todayCashTransactions.sales - todayCashTransactions.refunds - todayCashTransactions.withdrawals
  }, [openingBalance, todayCashTransactions])

  const handleStartReconciliation = () => {
    const newReconciliation: CashReconciliationRecord = {
      id: `REC${Date.now()}`,
      date: new Date().toISOString(),
      shiftType: getShiftType(),
      openingBalance,
      expectedCash,
      actualCash: 0,
      variance: 0,
      variancePercentage: 0,
      cashSales: todayCashTransactions.sales,
      cashPayments: todayCashTransactions.payments,
      cashRefunds: todayCashTransactions.refunds,
      cashWithdrawals: todayCashTransactions.withdrawals,
      cashCount: createEmptyCashCount(),
      status: 'IN_PROGRESS',
      reconcileBy: 'Current User',
      createdAt: new Date().toISOString()
    }
    
    setCurrentReconciliation(newReconciliation)
    setCashCount(createEmptyCashCount())
    setNotes('')
    setIsReconciling(true)
  }

  const getShiftType = (): CashReconciliationRecord['shiftType'] => {
    const hour = new Date().getHours()
    if (hour >= 6 && hour < 12) return 'MORNING'
    if (hour >= 12 && hour < 18) return 'AFTERNOON'
    if (hour >= 18 && hour < 24) return 'EVENING'
    return 'NIGHT'
  }

  const handleDenominationChange = (type: 'bills' | 'coins', index: number, count: number) => {
    setCashCount(current => {
      const updated = { ...current }
      const denomination = updated[type][index]
      denomination.count = count
      denomination.total = denomination.value * count
      updated.total = calculateCashCount(updated)
      return updated
    })
  }

  const handleCompleteReconciliation = () => {
    if (!currentReconciliation) return

    const actualCash = calculateCashCount(cashCount)
    const variance = actualCash - expectedCash
    const variancePercentage = expectedCash > 0 ? (variance / expectedCash) * 100 : 0

    let status: CashReconciliationRecord['status'] = 'BALANCED'
    if (Math.abs(variance) > 0.01) {
      status = variance > 0 ? 'OVER' : 'SHORT'
    }

    const completedReconciliation: CashReconciliationRecord = {
      ...currentReconciliation,
      actualCash,
      variance,
      variancePercentage,
      cashCount,
      status,
      notes: notes || undefined,
      completedAt: new Date().toISOString()
    }

    setReconciliations(current => [completedReconciliation, ...current])
    
    if (status === 'BALANCED') {
      toast.success('Cash Balanced', {
        description: `Reconciliation completed successfully. Cash drawer balanced at ฿${actualCash.toLocaleString()}`
      })
    } else if (status === 'OVER') {
      toast.warning('Cash Over', {
        description: `Cash drawer is over by ฿${Math.abs(variance).toLocaleString()}. Please review and document.`
      })
    } else {
      toast.error('Cash Short', {
        description: `Cash drawer is short by ฿${Math.abs(variance).toLocaleString()}. Manager review required.`
      })
    }

    setIsReconciling(false)
    setCurrentReconciliation(null)
    setCashCount(createEmptyCashCount())
    setNotes('')
  }

  const handleCancelReconciliation = () => {
    setIsReconciling(false)
    setCurrentReconciliation(null)
    setCashCount(createEmptyCashCount())
    setNotes('')
  }

  const getStatusColor = (status: CashReconciliationRecord['status']) => {
    switch (status) {
      case 'BALANCED': return 'bg-emerald-100 text-emerald-800 border-emerald-200'
      case 'OVER': return 'bg-orange-100 text-orange-800 border-orange-200'
      case 'SHORT': return 'bg-red-100 text-red-800 border-red-200'
      default: return 'bg-blue-100 text-blue-800 border-blue-200'
    }
  }

  const getStatusIcon = (status: CashReconciliationRecord['status']) => {
    switch (status) {
      case 'BALANCED': return <CheckCircle size={16} weight="fill" />
      case 'OVER': return <Warning size={16} weight="fill" />
      case 'SHORT': return <XCircle size={16} weight="fill" />
      default: return <Clock size={16} weight="fill" />
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Money size={32} weight="fill" className="text-primary" />
            Cash Reconciliation
          </h2>
          <p className="text-muted-foreground mt-1">
            End-of-day cash drawer reconciliation and tracking
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleStartReconciliation}
            disabled={isReconciling}
            className="gap-2"
          >
            <Calculator size={18} />
            Start Reconciliation
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">Opening Balance</p>
              <Money className="w-4 h-4 text-blue-500" />
            </div>
            <p className="text-3xl font-bold">฿{openingBalance.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">Starting cash drawer</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">Cash Sales</p>
              <CheckCircle className="w-4 h-4 text-green-500" />
            </div>
            <p className="text-3xl font-bold text-green-600">
              +฿{todayCashTransactions.sales.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Today's cash revenue</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">Cash Out</p>
              <XCircle className="w-4 h-4 text-red-500" />
            </div>
            <p className="text-3xl font-bold text-red-600">
              -฿{(todayCashTransactions.refunds + todayCashTransactions.withdrawals).toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Refunds & withdrawals</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">Expected Cash</p>
              <Calculator className="w-4 h-4 text-primary" />
            </div>
            <p className="text-3xl font-bold text-primary">฿{expectedCash.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">Should be in drawer</p>
          </CardContent>
        </Card>
      </div>

      {isReconciling && currentReconciliation && (
        <Card className="border-2 border-primary">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator size={24} weight="fill" className="text-primary" />
              Cash Count in Progress
              <Badge className="bg-blue-100 text-blue-800">
                <Clock size={14} className="mr-1" weight="fill" />
                {getShiftType()} Shift
              </Badge>
            </CardTitle>
            <CardDescription>
              Count all bills and coins in the cash drawer
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h4 className="font-semibold mb-4 flex items-center gap-2">
                  <Money size={18} weight="fill" />
                  Banknotes
                </h4>
                <div className="space-y-3">
                  {cashCount.bills.map((denom, index) => (
                    <div key={denom.value} className="flex items-center gap-3">
                      <Label className="w-20 text-right font-mono text-lg">
                        ฿{denom.value}
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        value={denom.count || ''}
                        onChange={(e) => handleDenominationChange('bills', index, parseInt(e.target.value) || 0)}
                        className="w-24 text-center"
                        placeholder="0"
                      />
                      <ArrowRight size={16} className="text-muted-foreground" />
                      <div className="flex-1 text-right font-mono font-semibold">
                        ฿{denom.total.toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
                <Separator className="my-4" />
                <div className="flex items-center justify-between text-lg font-bold">
                  <span>Bills Total:</span>
                  <span>฿{cashCount.bills.reduce((s, d) => s + d.total, 0).toLocaleString()}</span>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-4 flex items-center gap-2">
                  <Money size={18} weight="fill" />
                  Coins
                </h4>
                <div className="space-y-3">
                  {cashCount.coins.map((denom, index) => (
                    <div key={denom.value} className="flex items-center gap-3">
                      <Label className="w-20 text-right font-mono text-lg">
                        ฿{denom.value.toFixed(2)}
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        value={denom.count || ''}
                        onChange={(e) => handleDenominationChange('coins', index, parseInt(e.target.value) || 0)}
                        className="w-24 text-center"
                        placeholder="0"
                      />
                      <ArrowRight size={16} className="text-muted-foreground" />
                      <div className="flex-1 text-right font-mono font-semibold">
                        ฿{denom.total.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
                <Separator className="my-4" />
                <div className="flex items-center justify-between text-lg font-bold">
                  <span>Coins Total:</span>
                  <span>฿{cashCount.coins.reduce((s, d) => s + d.total, 0).toFixed(2)}</span>
                </div>
              </div>
            </div>

            <Separator />

            <div className="bg-primary/5 p-6 rounded-lg space-y-4">
              <div className="grid grid-cols-2 gap-4 text-lg">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Expected Cash:</span>
                  <span className="font-mono font-semibold">฿{expectedCash.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Actual Cash:</span>
                  <span className="font-mono font-semibold">฿{cashCount.total.toLocaleString()}</span>
                </div>
              </div>
              
              <Separator />
              
              <div className="flex items-center justify-between text-2xl font-bold">
                <span>Variance:</span>
                <span className={cn(
                  'font-mono',
                  Math.abs(cashCount.total - expectedCash) < 0.01 ? 'text-emerald-600' :
                  cashCount.total > expectedCash ? 'text-orange-600' : 'text-red-600'
                )}>
                  {cashCount.total - expectedCash >= 0 ? '+' : ''}฿{(cashCount.total - expectedCash).toLocaleString()}
                </span>
              </div>

              {Math.abs(cashCount.total - expectedCash) > 0.01 && (
                <div className="pt-4">
                  <Label htmlFor="reconciliation-notes">Variance Notes (Required)</Label>
                  <Textarea
                    id="reconciliation-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Explain the reason for the variance..."
                    rows={3}
                    className="mt-2"
                  />
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <Button
                onClick={handleCompleteReconciliation}
                disabled={Math.abs(cashCount.total - expectedCash) > 0.01 && !notes.trim()}
                className="flex-1 gap-2"
                size="lg"
              >
                <CheckSquare size={20} weight="fill" />
                Complete Reconciliation
              </Button>
              <Button
                onClick={handleCancelReconciliation}
                variant="outline"
                size="lg"
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Reconciliation History</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">
                <Calendar size={16} className="mr-2" />
                {format(selectedDate, 'MMM d, yyyy')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            <div className="space-y-3">
              {todayReconciliations.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Calculator className="mx-auto mb-4" size={48} weight="light" />
                  <p>No reconciliations recorded for today</p>
                  <p className="text-sm mt-1">Start a new reconciliation to track your cash drawer</p>
                </div>
              ) : (
                todayReconciliations.map(rec => (
                  <Card
                    key={rec.id}
                    className="cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => {
                      setSelectedReconciliation(rec)
                      setReviewDialogOpen(true)
                    }}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge className={cn('text-xs border', getStatusColor(rec.status))}>
                              {getStatusIcon(rec.status)}
                              <span className="ml-1">{rec.status}</span>
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {rec.shiftType}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(rec.date), 'HH:mm')}
                            </span>
                            <span className="text-xs text-muted-foreground">• By {rec.reconcileBy}</span>
                          </div>
                          
                          <div className="grid grid-cols-4 gap-4 text-sm">
                            <div>
                              <span className="text-muted-foreground">Opening:</span>
                              <span className="ml-2 font-semibold">฿{rec.openingBalance.toLocaleString()}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Expected:</span>
                              <span className="ml-2 font-semibold">฿{rec.expectedCash.toLocaleString()}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Actual:</span>
                              <span className="ml-2 font-semibold">฿{rec.actualCash.toLocaleString()}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Variance:</span>
                              <span className={cn(
                                'ml-2 font-bold',
                                Math.abs(rec.variance) < 0.01 ? 'text-emerald-600' :
                                rec.variance > 0 ? 'text-orange-600' : 'text-red-600'
                              )}>
                                {rec.variance >= 0 ? '+' : ''}฿{rec.variance.toLocaleString()}
                              </span>
                            </div>
                          </div>

                          {rec.notes && (
                            <p className="text-sm text-muted-foreground mt-2 italic">
                              Note: {rec.notes}
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {selectedReconciliation && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <span>Reconciliation Details</span>
                  <Badge className={cn('text-xs border', getStatusColor(selectedReconciliation.status))}>
                    {getStatusIcon(selectedReconciliation.status)}
                    <span className="ml-1">{selectedReconciliation.status}</span>
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  {format(new Date(selectedReconciliation.date), 'EEEE, MMMM d, yyyy • HH:mm')} • {selectedReconciliation.shiftType} Shift
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-muted-foreground mb-1">Opening Balance</p>
                      <p className="text-2xl font-bold">฿{selectedReconciliation.openingBalance.toLocaleString()}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-muted-foreground mb-1">Cash Sales</p>
                      <p className="text-2xl font-bold text-green-600">
                        +฿{selectedReconciliation.cashSales.toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-muted-foreground mb-1">Cash Refunds</p>
                      <p className="text-2xl font-bold text-red-600">
                        -฿{selectedReconciliation.cashRefunds.toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-muted-foreground mb-1">Withdrawals</p>
                      <p className="text-2xl font-bold text-red-600">
                        -฿{selectedReconciliation.cashWithdrawals.toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                <Separator />

                <div>
                  <h4 className="font-semibold mb-3">Cash Count Breakdown</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="border rounded-lg p-4">
                      <h5 className="font-medium mb-3">Banknotes</h5>
                      <div className="space-y-2 text-sm">
                        {selectedReconciliation.cashCount.bills.filter(d => d.count > 0).map(denom => (
                          <div key={denom.value} className="flex justify-between">
                            <span className="text-muted-foreground">
                              ฿{denom.value} × {denom.count}
                            </span>
                            <span className="font-semibold">฿{denom.total.toLocaleString()}</span>
                          </div>
                        ))}
                        {selectedReconciliation.cashCount.bills.filter(d => d.count > 0).length === 0 && (
                          <p className="text-muted-foreground italic">No bills counted</p>
                        )}
                      </div>
                    </div>
                    <div className="border rounded-lg p-4">
                      <h5 className="font-medium mb-3">Coins</h5>
                      <div className="space-y-2 text-sm">
                        {selectedReconciliation.cashCount.coins.filter(d => d.count > 0).map(denom => (
                          <div key={denom.value} className="flex justify-between">
                            <span className="text-muted-foreground">
                              ฿{denom.value.toFixed(2)} × {denom.count}
                            </span>
                            <span className="font-semibold">฿{denom.total.toFixed(2)}</span>
                          </div>
                        ))}
                        {selectedReconciliation.cashCount.coins.filter(d => d.count > 0).length === 0 && (
                          <p className="text-muted-foreground italic">No coins counted</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="bg-muted p-4 rounded-lg space-y-3">
                  <div className="flex justify-between text-lg">
                    <span className="text-muted-foreground">Expected Cash:</span>
                    <span className="font-mono font-semibold">
                      ฿{selectedReconciliation.expectedCash.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between text-lg">
                    <span className="text-muted-foreground">Actual Cash:</span>
                    <span className="font-mono font-semibold">
                      ฿{selectedReconciliation.actualCash.toLocaleString()}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-2xl font-bold">
                    <span>Variance:</span>
                    <span className={cn(
                      'font-mono',
                      Math.abs(selectedReconciliation.variance) < 0.01 ? 'text-emerald-600' :
                      selectedReconciliation.variance > 0 ? 'text-orange-600' : 'text-red-600'
                    )}>
                      {selectedReconciliation.variance >= 0 ? '+' : ''}฿{selectedReconciliation.variance.toLocaleString()}
                    </span>
                  </div>
                  {Math.abs(selectedReconciliation.variancePercentage) > 0.01 && (
                    <p className="text-sm text-muted-foreground text-center">
                      {Math.abs(selectedReconciliation.variancePercentage).toFixed(2)}% variance
                    </p>
                  )}
                </div>

                {selectedReconciliation.notes && (
                  <div>
                    <Label>Notes</Label>
                    <div className="mt-2 p-3 bg-muted rounded-lg text-sm">
                      {selectedReconciliation.notes}
                    </div>
                  </div>
                )}

                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Reconciled by: {selectedReconciliation.reconcileBy}</p>
                  <p>Completed: {selectedReconciliation.completedAt && format(new Date(selectedReconciliation.completedAt), 'PPpp')}</p>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" className="gap-2">
                  <Printer size={16} />
                  Print Report
                </Button>
                <Button onClick={() => setReviewDialogOpen(false)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
