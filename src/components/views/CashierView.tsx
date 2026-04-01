import { useState, useMemo } from 'react'
import { useKV } from '@github/spark/hooks'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { 
  MagnifyingGlass, Plus, Receipt, CreditCard, Money, CalendarBlank,
  Warning, CheckCircle, Clock, Printer, Download
} from '@phosphor-icons/react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { AccountingDashboard } from '@/components/cashier/AccountingDashboard'

function calculateTax(amount: number, taxRate: number = 7) {
  const subtotal = amount / (1 + taxRate / 100)
  const taxAmount = amount - subtotal
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    total: Math.round(amount * 100) / 100
  }
}

interface FolioCharge {
  id: string
  date: Date
  category: 'ROOM' | 'FOOD' | 'BEVERAGE' | 'LAUNDRY' | 'MINIBAR' | 'PHONE' | 'SPA' | 'OTHER'
  description: string
  quantity: number
  unitPrice: number
  subtotal: number
  tax: number
  total: number
  postedBy: string
}

interface FolioPayment {
  id: string
  date: Date
  method: 'CASH' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'BANK_TRANSFER' | 'MOBILE_PAYMENT'
  amount: number
  reference?: string
  receivedBy: string
}

interface Folio {
  id: string
  reservationId: string
  guestName: string
  roomNumber: string
  checkIn: Date
  checkOut?: Date
  status: 'OPEN' | 'CLOSED' | 'VOID'
  
  charges: FolioCharge[]
  payments: FolioPayment[]
  
  subtotal: number
  tax: number
  total: number
  paid: number
  balance: number
  
  createdAt: Date
  updatedAt: Date
  closedAt?: Date
}

function generateMockFolios(): Folio[] {
  const folios: Folio[] = []
  const guestNames = ['Sarah Johnson', 'Michael Chen', 'Emma Williams', 'James Brown', 'Lisa Anderson']
  
  for (let i = 0; i < 20; i++) {
    const charges: FolioCharge[] = []
    const roomCharge = 2500 + Math.floor(Math.random() * 1500)
    const nights = Math.floor(Math.random() * 5) + 1
    
    for (let n = 0; n < nights; n++) {
      const chargeDate = new Date(Date.now() - (nights - n) * 24 * 60 * 60 * 1000)
      const taxCalc = calculateTax(roomCharge)
      
      charges.push({
        id: `CHG${i}-${n}`,
        date: chargeDate,
        category: 'ROOM',
        description: `Room ${201 + i} - Night ${n + 1}`,
        quantity: 1,
        unitPrice: roomCharge,
        subtotal: taxCalc.subtotal,
        tax: taxCalc.taxAmount,
        total: taxCalc.total,
        postedBy: 'system'
      })
    }
    
    if (Math.random() < 0.6) {
      const foodAmount = Math.floor(Math.random() * 800) + 200
      const taxCalc = calculateTax(foodAmount)
      charges.push({
        id: `CHG${i}-food`,
        date: new Date(),
        category: 'FOOD',
        description: 'Breakfast Service',
        quantity: 1,
        unitPrice: foodAmount,
        subtotal: taxCalc.subtotal,
        tax: taxCalc.taxAmount,
        total: taxCalc.total,
        postedBy: 'staff'
      })
    }
    
    if (Math.random() < 0.3) {
      const minibarAmount = Math.floor(Math.random() * 400) + 100
      const taxCalc = calculateTax(minibarAmount)
      charges.push({
        id: `CHG${i}-minibar`,
        date: new Date(),
        category: 'MINIBAR',
        description: 'Minibar Consumption',
        quantity: 1,
        unitPrice: minibarAmount,
        subtotal: taxCalc.subtotal,
        tax: taxCalc.taxAmount,
        total: taxCalc.total,
        postedBy: 'system'
      })
    }
    
    const subtotal = charges.reduce((sum, c) => sum + c.subtotal, 0)
    const tax = charges.reduce((sum, c) => sum + c.tax, 0)
    const total = charges.reduce((sum, c) => sum + c.total, 0)
    
    const payments: FolioPayment[] = []
    let paid = 0
    
    if (Math.random() < 0.7) {
      const depositAmount = Math.floor(total * 0.3)
      payments.push({
        id: `PAY${i}-deposit`,
        date: new Date(Date.now() - nights * 24 * 60 * 60 * 1000),
        method: 'CREDIT_CARD',
        amount: depositAmount,
        reference: `CC-${Math.floor(Math.random() * 100000)}`,
        receivedBy: 'front-desk'
      })
      paid = depositAmount
    }
    
    const status: Folio['status'] = Math.random() < 0.3 ? 'CLOSED' : 'OPEN'
    
    if (status === 'CLOSED') {
      const remainingBalance = total - paid
      if (remainingBalance > 0) {
        payments.push({
          id: `PAY${i}-final`,
          date: new Date(),
          method: Math.random() < 0.5 ? 'CASH' : 'CREDIT_CARD',
          amount: remainingBalance,
          reference: Math.random() < 0.5 ? `CC-${Math.floor(Math.random() * 100000)}` : undefined,
          receivedBy: 'front-desk'
        })
        paid = total
      }
    }
    
    folios.push({
      id: `FOLIO${1000 + i}`,
      reservationId: `RES${1000 + i}`,
      guestName: guestNames[i % guestNames.length],
      roomNumber: `${Math.random() < 0.5 ? '2' : '3'}${String(i % 15 + 1).padStart(2, '0')}`,
      checkIn: new Date(Date.now() - nights * 24 * 60 * 60 * 1000),
      checkOut: status === 'CLOSED' ? new Date() : undefined,
      status,
      charges,
      payments,
      subtotal,
      tax,
      total,
      paid,
      balance: total - paid,
      createdAt: new Date(Date.now() - nights * 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
      closedAt: status === 'CLOSED' ? new Date() : undefined
    })
  }
  
  return folios.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
}

export function CashierView() {
  const [folios, setFolios] = useKV<Folio[]>('cashier-folios', [])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFolio, setSelectedFolio] = useState<Folio | null>(null)
  const [selectedTab, setSelectedTab] = useState<'open' | 'closed' | 'all' | 'accounting'>('open')
  
  useState(() => {
    if (folios.length === 0) {
      setFolios(generateMockFolios())
    }
  })
  
  const filteredFolios = useMemo(() => {
    let result = folios
    
    switch (selectedTab) {
      case 'open':
        result = result.filter(f => f.status === 'OPEN')
        break
      case 'closed':
        result = result.filter(f => f.status === 'CLOSED')
        break
    }
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(f =>
        f.guestName.toLowerCase().includes(query) ||
        f.roomNumber.includes(query) ||
        f.id.toLowerCase().includes(query)
      )
    }
    
    return result
  }, [folios, selectedTab, searchQuery])
  
  const stats = useMemo(() => {
    const open = folios.filter(f => f.status === 'OPEN')
    const totalOutstanding = open.reduce((sum, f) => sum + f.balance, 0)
    const totalRevenue = folios.reduce((sum, f) => sum + f.total, 0)
    const totalCollected = folios.reduce((sum, f) => sum + f.paid, 0)
    
    return {
      openFolios: open.length,
      totalOutstanding,
      totalRevenue,
      totalCollected
    }
  }, [folios])
  
  const getCategoryColor = (category: FolioCharge['category']) => {
    switch (category) {
      case 'ROOM': return 'bg-blue-100 text-blue-800'
      case 'FOOD': return 'bg-green-100 text-green-800'
      case 'BEVERAGE': return 'bg-purple-100 text-purple-800'
      case 'LAUNDRY': return 'bg-cyan-100 text-cyan-800'
      case 'MINIBAR': return 'bg-pink-100 text-pink-800'
      case 'PHONE': return 'bg-orange-100 text-orange-800'
      case 'SPA': return 'bg-violet-100 text-violet-800'
      default: return 'bg-slate-100 text-slate-800'
    }
  }
  
  const getPaymentMethodColor = (method: FolioPayment['method']) => {
    switch (method) {
      case 'CASH': return 'bg-emerald-100 text-emerald-800'
      case 'CREDIT_CARD': return 'bg-blue-100 text-blue-800'
      case 'DEBIT_CARD': return 'bg-cyan-100 text-cyan-800'
      case 'BANK_TRANSFER': return 'bg-violet-100 text-violet-800'
      case 'MOBILE_PAYMENT': return 'bg-pink-100 text-pink-800'
    }
  }
  
  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="flex-none border-b border-border bg-card">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Cashier</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Manage guest folios and payments
              </p>
            </div>
            <Button className="gap-2">
              <Plus size={18} weight="bold" />
              Post Charge
            </Button>
          </div>
          
          <div className="relative max-w-md">
            <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
            <Input
              placeholder="Search by guest, room, or folio number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        
        <div className="px-6 pb-4">
          <div className="grid grid-cols-4 gap-3">
            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">Open Folios</div>
              <div className="text-2xl font-bold text-foreground">{stats.openFolios}</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">Outstanding Balance</div>
              <div className="text-2xl font-bold text-orange-600">฿{stats.totalOutstanding.toLocaleString()}</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">Total Revenue</div>
              <div className="text-2xl font-bold text-emerald-600">฿{stats.totalRevenue.toLocaleString()}</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">Collected</div>
              <div className="text-2xl font-bold text-blue-600">฿{stats.totalCollected.toLocaleString()}</div>
            </Card>
          </div>
        </div>
      </div>
      
      <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as any)} className="flex-1 flex flex-col">
        <div className="flex-none border-b border-border bg-card px-6">
          <TabsList className="bg-transparent">
            <TabsTrigger value="open">Open Folios</TabsTrigger>
            <TabsTrigger value="closed">Closed Folios</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="accounting">Accounting</TabsTrigger>
          </TabsList>
        </div>
        
        <TabsContent value="accounting" className="flex-1 m-0 p-6">
          <ScrollArea className="h-full">
            <AccountingDashboard />
          </ScrollArea>
        </TabsContent>
        
        <TabsContent value={selectedTab} className="flex-1 m-0 p-6">
          <ScrollArea className="h-full">
            <div className="space-y-3">
              {filteredFolios.length === 0 ? (
                <Card className="p-12 text-center">
                  <Receipt className="mx-auto mb-4 text-muted-foreground" size={48} weight="light" />
                  <h3 className="text-lg font-medium text-foreground mb-2">No folios found</h3>
                  <p className="text-sm text-muted-foreground">
                    {searchQuery ? 'Try adjusting your search terms' : 'No folios in this category'}
                  </p>
                </Card>
              ) : (
                filteredFolios.map(folio => (
                  <Card 
                    key={folio.id}
                    className="p-4 hover:border-primary/50 transition-colors cursor-pointer"
                    onClick={() => setSelectedFolio(folio)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-base font-semibold text-foreground">{folio.guestName}</h3>
                          <Badge variant="outline" className="text-xs">
                            Room {folio.roomNumber}
                          </Badge>
                          <Badge 
                            className={cn(
                              'text-xs border',
                              folio.status === 'OPEN' && 'bg-blue-100 text-blue-800 border-blue-200',
                              folio.status === 'CLOSED' && 'bg-slate-100 text-slate-600 border-slate-200'
                            )}
                          >
                            {folio.status}
                          </Badge>
                          {folio.balance > 0 && folio.status === 'OPEN' && (
                            <Badge className="bg-orange-100 text-orange-800 border-orange-200 text-xs">
                              <Warning size={12} weight="fill" className="mr-1" />
                              Balance Due
                            </Badge>
                          )}
                        </div>
                        
                        <div className="grid grid-cols-4 gap-4 text-sm text-muted-foreground">
                          <div>
                            <span className="font-medium">Folio:</span> #{folio.id}
                          </div>
                          <div className="flex items-center gap-1">
                            <CalendarBlank size={16} />
                            {format(folio.checkIn, 'MMM d')} - {folio.checkOut ? format(folio.checkOut, 'MMM d, yyyy') : 'In-house'}
                          </div>
                          <div>
                            <span className="font-medium">Charges:</span> {folio.charges.length}
                          </div>
                          <div>
                            <span className="font-medium">Payments:</span> {folio.payments.length}
                          </div>
                        </div>
                      </div>
                      
                      <div className="text-right ml-6 min-w-[200px]">
                        <div className="space-y-1 text-sm mb-2">
                          <div className="flex justify-between text-muted-foreground">
                            <span>Subtotal:</span>
                            <span>฿{folio.subtotal.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-muted-foreground">
                            <span>Tax (7%):</span>
                            <span>฿{folio.tax.toLocaleString()}</span>
                          </div>
                          <Separator className="my-1" />
                          <div className="flex justify-between font-semibold text-base text-foreground">
                            <span>Total:</span>
                            <span>฿{folio.total.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-emerald-600">
                            <span>Paid:</span>
                            <span>฿{folio.paid.toLocaleString()}</span>
                          </div>
                          {folio.balance > 0 && (
                            <div className="flex justify-between font-bold text-orange-600">
                              <span>Balance:</span>
                              <span>฿{folio.balance.toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                        {folio.balance === 0 && folio.status === 'CLOSED' && (
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs w-full justify-center">
                            <CheckCircle size={12} weight="fill" className="mr-1" />
                            Paid in Full
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
      
      {selectedFolio && (
        <Dialog open={!!selectedFolio} onOpenChange={() => setSelectedFolio(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <span>Folio #{selectedFolio.id}</span>
                    <Badge 
                      className={cn(
                        'text-xs',
                        selectedFolio.status === 'OPEN' && 'bg-blue-100 text-blue-800',
                        selectedFolio.status === 'CLOSED' && 'bg-slate-100 text-slate-600'
                      )}
                    >
                      {selectedFolio.status}
                    </Badge>
                  </div>
                  <div className="text-sm font-normal text-muted-foreground mt-1">
                    {selectedFolio.guestName} • Room {selectedFolio.roomNumber}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="gap-2">
                    <Printer size={16} />
                    Print
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Download size={16} />
                    Export
                  </Button>
                </div>
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-6 py-4">
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Receipt size={18} />
                  Charges
                </h4>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-3 font-medium text-muted-foreground">Date</th>
                        <th className="text-left p-3 font-medium text-muted-foreground">Category</th>
                        <th className="text-left p-3 font-medium text-muted-foreground">Description</th>
                        <th className="text-right p-3 font-medium text-muted-foreground">Qty</th>
                        <th className="text-right p-3 font-medium text-muted-foreground">Unit Price</th>
                        <th className="text-right p-3 font-medium text-muted-foreground">Tax</th>
                        <th className="text-right p-3 font-medium text-muted-foreground">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {selectedFolio.charges.map(charge => (
                        <tr key={charge.id} className="hover:bg-muted/50">
                          <td className="p-3 text-muted-foreground">{format(charge.date, 'MMM d, HH:mm')}</td>
                          <td className="p-3">
                            <Badge variant="outline" className={cn('text-xs', getCategoryColor(charge.category))}>
                              {charge.category}
                            </Badge>
                          </td>
                          <td className="p-3 text-foreground">{charge.description}</td>
                          <td className="p-3 text-right text-muted-foreground">{charge.quantity}</td>
                          <td className="p-3 text-right text-foreground">฿{charge.unitPrice.toLocaleString()}</td>
                          <td className="p-3 text-right text-muted-foreground">฿{charge.tax.toLocaleString()}</td>
                          <td className="p-3 text-right font-medium text-foreground">฿{charge.total.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              
              {selectedFolio.payments.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <CreditCard size={18} />
                    Payments
                  </h4>
                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted">
                        <tr>
                          <th className="text-left p-3 font-medium text-muted-foreground">Date</th>
                          <th className="text-left p-3 font-medium text-muted-foreground">Method</th>
                          <th className="text-left p-3 font-medium text-muted-foreground">Reference</th>
                          <th className="text-left p-3 font-medium text-muted-foreground">Received By</th>
                          <th className="text-right p-3 font-medium text-muted-foreground">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {selectedFolio.payments.map(payment => (
                          <tr key={payment.id} className="hover:bg-muted/50">
                            <td className="p-3 text-muted-foreground">{format(payment.date, 'MMM d, HH:mm')}</td>
                            <td className="p-3">
                              <Badge variant="outline" className={cn('text-xs', getPaymentMethodColor(payment.method))}>
                                {payment.method.replace('_', ' ')}
                              </Badge>
                            </td>
                            <td className="p-3 text-muted-foreground font-mono text-xs">{payment.reference || '—'}</td>
                            <td className="p-3 text-muted-foreground">{payment.receivedBy}</td>
                            <td className="p-3 text-right font-medium text-emerald-600">฿{payment.amount.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              
              <div className="bg-muted p-4 rounded-lg">
                <div className="space-y-2 text-sm max-w-md ml-auto">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal:</span>
                    <span>฿{selectedFolio.subtotal.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Tax (7%):</span>
                    <span>฿{selectedFolio.tax.toLocaleString()}</span>
                  </div>
                  <Separator className="my-2" />
                  <div className="flex justify-between font-semibold text-base text-foreground">
                    <span>Total:</span>
                    <span>฿{selectedFolio.total.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-emerald-600">
                    <span>Paid:</span>
                    <span>฿{selectedFolio.paid.toLocaleString()}</span>
                  </div>
                  <Separator className="my-2" />
                  <div className={cn(
                    "flex justify-between font-bold text-lg",
                    selectedFolio.balance > 0 ? 'text-orange-600' : 'text-emerald-600'
                  )}>
                    <span>Balance Due:</span>
                    <span>฿{selectedFolio.balance.toLocaleString()}</span>
                  </div>
                </div>
              </div>
              
              {selectedFolio.status === 'OPEN' && selectedFolio.balance > 0 && (
                <div className="flex gap-3">
                  <Button className="flex-1 gap-2">
                    <Money size={18} />
                    Collect Payment
                  </Button>
                  <Button variant="outline" className="flex-1 gap-2">
                    <Plus size={18} />
                    Add Charge
                  </Button>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
