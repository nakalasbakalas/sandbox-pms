import { useState, useMemo, useCallback, useEffect } from 'react'
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
import { CashReconciliation } from '@/components/cashier/CashReconciliation'
import { useRoomSync } from '@/hooks/use-room-sync'
import { nightsBetween } from '@/lib/hotel/business-rules'
import { pmsApi, SERVER_API_ENABLED } from '@/lib/pms-api-client'
import { toast } from 'sonner'
import type { BoardRoomCard } from '@/types/board'

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
  category: 'ROOM' | 'EXTRA_GUEST' | 'CHILD' | 'CAFE' | 'LAUNDRY' | 'MINIBAR' | 'DAMAGE' | 'OTHER'
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
  method: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'ONLINE' | 'OTHER'
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
  return []
}

function folioFromRoom(room: BoardRoomCard): Folio | null {
  if (!room.guestName || !room.checkIn) return null

  const balance = room.balanceDue || 0
  const total = room.reservation?.totalAmount ?? balance
  const nights = room.checkOut ? Math.max(1, nightsBetween(room.checkIn, room.checkOut)) : 1
  const paid = Math.max(0, total - balance)
  const roomRate = nights > 0 ? Math.round(total / nights) : total
  const checkIn = new Date(room.checkIn)
  const updatedAt = room.lastUpdatedAt ? new Date(room.lastUpdatedAt) : new Date()

  return {
    id: `folio-${room.reservationId || room.currentReservationId || room.roomId}`,
    reservationId: room.reservationId || room.currentReservationId || room.roomId,
    guestName: room.guestName,
    roomNumber: room.number,
    checkIn,
    checkOut: room.checkOut ? new Date(room.checkOut) : undefined,
    status: room.status === 'VACANT_DIRTY' ? 'CLOSED' : 'OPEN',
    charges: total > 0 ? [{
      id: `charge-${room.roomId}`,
      date: checkIn,
      category: 'ROOM',
      description: `Room ${room.number} - ${nights} night${nights === 1 ? '' : 's'}`,
      quantity: nights,
      unitPrice: roomRate,
      subtotal: total,
      tax: 0,
      total,
      postedBy: 'Front desk',
    }] : [],
    payments: paid > 0 ? [{
      id: `payment-${room.roomId}`,
      date: updatedAt,
      method: room.depositStatus === 'PAID' ? 'CASH' : 'BANK_TRANSFER',
      amount: paid,
      reference: room.depositStatus === 'PAID' ? 'Deposit recorded' : undefined,
      receivedBy: 'Front desk',
    }] : [],
    subtotal: total,
    tax: 0,
    total,
    paid,
    balance,
    createdAt: checkIn,
    updatedAt,
    closedAt: room.status === 'VACANT_DIRTY' ? updatedAt : undefined,
  }
}

function normalizeChargeCategory(category: string): FolioCharge['category'] {
  if (['ROOM', 'EXTRA_GUEST', 'CHILD', 'CAFE', 'LAUNDRY', 'MINIBAR', 'DAMAGE'].includes(category)) {
    return category as FolioCharge['category']
  }
  return 'OTHER'
}

function normalizePaymentMethod(method: string): FolioPayment['method'] {
  if (['CASH', 'CARD', 'BANK_TRANSFER', 'ONLINE'].includes(method)) {
    return method as FolioPayment['method']
  }
  return 'OTHER'
}

function folioFromServerReservation(record: any): Folio | null {
  if (!record?.folio) return null

  const guestName = record.guest
    ? `${record.guest.firstName || ''} ${record.guest.lastName || ''}`.trim()
    : 'Guest'
  const roomNumber = record.assignedRoom?.number || 'Unassigned'
  const charges = (record.folio.charges || []).map((charge: any): FolioCharge => ({
    id: charge.id,
    date: new Date(charge.date || charge.createdAt || record.checkIn),
    category: normalizeChargeCategory(charge.category),
    description: charge.description || 'Folio charge',
    quantity: Number(charge.quantity || 1),
    unitPrice: Number(charge.amount || charge.total || 0),
    subtotal: Number(charge.total || 0),
    tax: 0,
    total: Number(charge.total || 0),
    postedBy: charge.createdBy || 'System',
  }))
  const payments = (record.folio.payments || []).map((payment: any): FolioPayment => ({
    id: payment.id,
    date: new Date(payment.createdAt || payment.date || record.updatedAt || new Date()),
    method: normalizePaymentMethod(payment.method),
    amount: Number(payment.amount || 0),
    reference: payment.reference || undefined,
    receivedBy: payment.processedBy || 'Cashier',
  }))
  const status = record.folio.status === 'CLOSED' || record.status === 'CHECKED_OUT' && Number(record.folio.balance || 0) <= 0
    ? 'CLOSED'
    : 'OPEN'

  return {
    id: record.folio.id,
    reservationId: record.id,
    guestName,
    roomNumber,
    checkIn: new Date(record.checkIn),
    checkOut: record.checkOut ? new Date(record.checkOut) : undefined,
    status,
    charges,
    payments,
    subtotal: Number(record.folio.subtotal || 0),
    tax: Number(record.folio.tax || 0),
    total: Number(record.folio.total || 0),
    paid: Number(record.folio.paid || 0),
    balance: Number(record.folio.balance || 0),
    createdAt: new Date(record.folio.createdAt || record.createdAt || record.checkIn),
    updatedAt: new Date(record.folio.updatedAt || record.updatedAt || new Date()),
    closedAt: status === 'CLOSED' ? new Date(record.actualCheckOut || record.folio.updatedAt || new Date()) : undefined,
  }
}

function deserializeFolio(folio: Folio): Folio {
  return {
    ...folio,
    checkIn: new Date(folio.checkIn),
    checkOut: folio.checkOut ? new Date(folio.checkOut) : undefined,
    createdAt: new Date(folio.createdAt),
    updatedAt: new Date(folio.updatedAt),
    closedAt: folio.closedAt ? new Date(folio.closedAt) : undefined,
    charges: folio.charges.map(charge => ({
      ...charge,
      date: new Date(charge.date)
    })),
    payments: folio.payments.map(payment => ({
      ...payment,
      date: new Date(payment.date)
    }))
  }
}

export function CashierView() {
  const [foliosRaw, setFoliosRaw] = useKV<Folio[]>('cashier-folios', [])
  const [authToken] = useKV<string | null>('auth:pms-token', null)
  const { rooms } = useRoomSync()
  const [serverFolios, setServerFolios] = useState<Folio[]>([])
  const [isLoadingFolios, setIsLoadingFolios] = useState(false)
  const [folioError, setFolioError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFolio, setSelectedFolio] = useState<Folio | null>(null)
  const [selectedTab, setSelectedTab] = useState<'open' | 'closed' | 'all' | 'accounting' | 'reconciliation'>('open')
  const [paymentFolio, setPaymentFolio] = useState<Folio | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<FolioPayment['method']>('CASH')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false)

  const refreshServerFolios = useCallback(async () => {
    if (!SERVER_API_ENABLED || !authToken) return []
    setIsLoadingFolios(true)
    setFolioError(null)
    try {
      const payload = await pmsApi<{ ok: true; data: any[] }>('/api/reservations', authToken)
      const nextFolios = payload.data.map(folioFromServerReservation).filter(Boolean) as Folio[]
      setServerFolios(nextFolios)
      return nextFolios
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load cashier folios.'
      setFolioError(message)
      return []
    } finally {
      setIsLoadingFolios(false)
    }
  }, [authToken])

  useEffect(() => {
    void refreshServerFolios()
  }, [refreshServerFolios])
  
  const folios = useMemo(() => {
    if (SERVER_API_ENABLED && authToken) return serverFolios

    const merged = new Map<string, Folio>()
    ;(foliosRaw || []).map(deserializeFolio).forEach((folio) => {
      merged.set(folio.id, folio)
    })
    rooms.map(folioFromRoom).filter(Boolean).forEach((folio) => {
      if (folio && !merged.has(folio.id)) merged.set(folio.id, folio)
    })
    return [...merged.values()]
  }, [authToken, foliosRaw, rooms, serverFolios])
  
  const setFolios = (updater: Folio[] | ((current: Folio[]) => Folio[])) => {
    setFoliosRaw((current) => {
      const deserialized = (current || []).map(deserializeFolio)
      const updated = typeof updater === 'function' ? updater(deserialized) : updater
      return updated
    })
  }
  
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
      case 'EXTRA_GUEST': return 'bg-green-100 text-green-800'
      case 'CHILD': return 'bg-amber-100 text-amber-800'
      case 'CAFE': return 'bg-purple-100 text-purple-800'
      case 'LAUNDRY': return 'bg-cyan-100 text-cyan-800'
      case 'MINIBAR': return 'bg-pink-100 text-pink-800'
      case 'DAMAGE': return 'bg-red-100 text-red-800'
      default: return 'bg-slate-100 text-slate-800'
    }
  }
  
  const getPaymentMethodColor = (method: FolioPayment['method']) => {
    switch (method) {
      case 'CASH': return 'bg-emerald-100 text-emerald-800'
      case 'CARD': return 'bg-blue-100 text-blue-800'
      case 'BANK_TRANSFER': return 'bg-violet-100 text-violet-800'
      case 'ONLINE': return 'bg-pink-100 text-pink-800'
      case 'OTHER': return 'bg-slate-100 text-slate-800'
    }
  }

  const openPaymentDialog = (folio: Folio) => {
    setPaymentFolio(folio)
    setPaymentAmount(folio.balance > 0 ? String(folio.balance.toFixed(2)) : '')
    setPaymentMethod('CASH')
    setPaymentReference('')
    setPaymentError(null)
  }

  const handleSubmitPayment = async () => {
    if (!paymentFolio) return
    const amount = Number(paymentAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentError('Payment amount must be greater than zero.')
      return
    }
    if (amount > paymentFolio.balance) {
      setPaymentError('Payment cannot exceed the remaining balance.')
      return
    }

    setIsSubmittingPayment(true)
    setPaymentError(null)
    try {
      if (SERVER_API_ENABLED && authToken) {
        await pmsApi('/api/payments', authToken, {
          method: 'POST',
          body: JSON.stringify({
            folioId: paymentFolio.id,
            amount,
            method: paymentMethod,
            reference: paymentReference.trim() || undefined,
          }),
        })
        const nextFolios = await refreshServerFolios()
        const updated = nextFolios.find((folio) => folio.id === paymentFolio.id)
        if (updated) setSelectedFolio(updated)
      } else {
        const payment: FolioPayment = {
          id: `payment-${Date.now()}`,
          date: new Date(),
          method: paymentMethod,
          amount,
          reference: paymentReference.trim() || undefined,
          receivedBy: 'Cashier',
        }
        setFolios((current) => current.map((folio) => {
          if (folio.id !== paymentFolio.id) return folio
          const paid = Math.round((folio.paid + amount) * 100) / 100
          const balance = Math.round(Math.max(0, folio.total - paid) * 100) / 100
          const updated = {
            ...folio,
            payments: [...folio.payments, payment],
            paid,
            balance,
            status: balance <= 0 ? 'CLOSED' as const : 'OPEN' as const,
            updatedAt: new Date(),
            closedAt: balance <= 0 ? new Date() : folio.closedAt,
          }
          setSelectedFolio(updated)
          return updated
        }))
      }
      toast.success(`Payment recorded for folio ${paymentFolio.id}.`)
      setPaymentFolio(null)
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'Payment could not be recorded.')
    } finally {
      setIsSubmittingPayment(false)
    }
  }
  
  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="flex-none border-b border-border bg-card">
        <div className="px-4 py-2.5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-lg font-semibold text-foreground">Cashier</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Manage guest folios and payments
              </p>
            </div>
            <Button size="sm" className="gap-1.5 h-7 text-xs">
              <Plus size={14} weight="bold" />
              Post Charge
            </Button>
          </div>
          
          <div className="relative max-w-sm">
            <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
            <Input
              placeholder="Search by guest, room, or folio..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-7 text-xs"
            />
          </div>
          {folioError && (
            <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {folioError}
            </div>
          )}
        </div>
        
        <div className="px-4 pb-2.5">
          <div className="grid grid-cols-4 gap-2">
            <Card className="p-2">
              <div className="text-[10px] font-medium text-muted-foreground mb-0.5">Open Folios</div>
              <div className="text-lg font-bold text-foreground">{stats.openFolios}</div>
            </Card>
            <Card className="p-2">
              <div className="text-[10px] font-medium text-muted-foreground mb-0.5">Outstanding</div>
              <div className="text-lg font-bold text-orange-600">฿{stats.totalOutstanding.toLocaleString()}</div>
            </Card>
            <Card className="p-2">
              <div className="text-[10px] font-medium text-muted-foreground mb-0.5">Revenue</div>
              <div className="text-lg font-bold text-emerald-600">฿{stats.totalRevenue.toLocaleString()}</div>
            </Card>
            <Card className="p-2">
              <div className="text-[10px] font-medium text-muted-foreground mb-0.5">Collected</div>
              <div className="text-lg font-bold text-blue-600">฿{stats.totalCollected.toLocaleString()}</div>
            </Card>
          </div>
        </div>
      </div>
      
      <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as any)} className="flex-1 flex flex-col">
        <div className="flex-none border-b border-border bg-card px-4">
          <TabsList className="bg-transparent h-8">
            <TabsTrigger value="open" className="text-xs">Open</TabsTrigger>
            <TabsTrigger value="closed" className="text-xs">Closed</TabsTrigger>
            <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
            <TabsTrigger value="accounting" className="text-xs">Accounting</TabsTrigger>
            <TabsTrigger value="reconciliation" className="text-xs">Reconciliation</TabsTrigger>
          </TabsList>
        </div>
        
        <TabsContent value="accounting" className="flex-1 m-0 p-4">
          <ScrollArea className="h-full">
            <AccountingDashboard />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="reconciliation" className="flex-1 m-0 p-4">
          <ScrollArea className="h-full">
            <CashReconciliation />
          </ScrollArea>
        </TabsContent>
        
        <TabsContent value={selectedTab} className="flex-1 m-0 p-4">
          <ScrollArea className="h-full">
            <div className="space-y-2">
              {filteredFolios.length === 0 ? (
                <Card className="p-8 text-center">
                  <Receipt className="mx-auto mb-3 text-muted-foreground" size={40} weight="light" />
                  <h3 className="text-base font-medium text-foreground mb-1.5">
                    {isLoadingFolios ? 'Loading folios...' : 'No folios found'}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {isLoadingFolios ? 'Checking persistent cashier records.' : searchQuery ? 'Try adjusting your search terms' : 'No folios in this category'}
                  </p>
                </Card>
              ) : (
                filteredFolios.map(folio => (
                  <Card 
                    key={folio.id}
                    className="p-3 hover:border-primary/50 transition-colors cursor-pointer"
                    onClick={() => setSelectedFolio(folio)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1.5">
                          <h3 className="text-sm font-semibold text-foreground">{folio.guestName}</h3>
                          <Badge variant="outline" className="text-[10px] py-0 h-4">
                            Room {folio.roomNumber}
                          </Badge>
                          <Badge 
                            className={cn(
                              'text-[10px] border py-0 h-4',
                              folio.status === 'OPEN' && 'bg-blue-100 text-blue-800 border-blue-200',
                              folio.status === 'CLOSED' && 'bg-slate-100 text-slate-600 border-slate-200'
                            )}
                          >
                            {folio.status}
                          </Badge>
                          {folio.balance > 0 && folio.status === 'OPEN' && (
                            <Badge className="bg-orange-100 text-orange-800 border-orange-200 text-[10px] py-0 h-4">
                              <Warning size={10} weight="fill" className="mr-0.5" />
                              Due
                            </Badge>
                          )}
                        </div>
                        
                        <div className="grid grid-cols-4 gap-3 text-xs text-muted-foreground">
                          <div>
                            <span className="font-medium">Folio:</span> #{folio.id}
                          </div>
                          <div className="flex items-center gap-1">
                            <CalendarBlank size={12} />
                            {format(folio.checkIn, 'MMM d')} - {folio.checkOut ? format(folio.checkOut, 'MMM d, yy') : 'In-house'}
                          </div>
                          <div>
                            <span className="font-medium">Charges:</span> {folio.charges.length}
                          </div>
                          <div>
                            <span className="font-medium">Payments:</span> {folio.payments.length}
                          </div>
                        </div>
                      </div>
                      
                      <div className="text-right ml-4 min-w-[160px]">
                        <div className="space-y-0.5 text-xs mb-1.5">
                          <div className="flex justify-between text-muted-foreground">
                            <span>Subtotal:</span>
                            <span>฿{folio.subtotal.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-muted-foreground">
                            <span>Included tax:</span>
                            <span>฿{folio.tax.toLocaleString()}</span>
                          </div>
                          <Separator className="my-0.5" />
                          <div className="flex justify-between font-semibold text-sm text-foreground">
                            <span>Total:</span>
                            <span>฿{folio.total.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-emerald-600 text-xs">
                            <span>Paid:</span>
                            <span>฿{folio.paid.toLocaleString()}</span>
                          </div>
                          {folio.balance > 0 && (
                            <div className="flex justify-between font-bold text-orange-600 text-xs">
                              <span>Balance:</span>
                              <span>฿{folio.balance.toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                        {folio.balance === 0 && folio.status === 'CLOSED' && (
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px] w-full justify-center py-0 h-4">
                            <CheckCircle size={10} weight="fill" className="mr-0.5" />
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
                    <span>Included tax:</span>
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
                  <Button className="flex-1 gap-2" onClick={() => openPaymentDialog(selectedFolio)}>
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

      {paymentFolio && (
        <Dialog open={!!paymentFolio} onOpenChange={(open) => !open && setPaymentFolio(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Collect payment</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div className="font-medium">{paymentFolio.guestName}</div>
                <div className="text-muted-foreground">Folio #{paymentFolio.id} · Room {paymentFolio.roomNumber}</div>
                <div className="mt-2 font-semibold text-orange-600">
                  Balance due: ฿{paymentFolio.balance.toLocaleString()}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="payment-amount">Payment amount</Label>
                <Input
                  id="payment-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Payment method</Label>
                <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as FolioPayment['method'])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">Cash</SelectItem>
                    <SelectItem value="CARD">Card</SelectItem>
                    <SelectItem value="BANK_TRANSFER">Bank transfer</SelectItem>
                    <SelectItem value="ONLINE">Online / PromptPay</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="payment-reference">Reference</Label>
                <Input
                  id="payment-reference"
                  value={paymentReference}
                  onChange={(event) => setPaymentReference(event.target.value)}
                  placeholder="Receipt, transfer, or card reference"
                />
              </div>

              {paymentError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {paymentError}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPaymentFolio(null)} disabled={isSubmittingPayment}>
                  Cancel
                </Button>
                <Button onClick={handleSubmitPayment} disabled={isSubmittingPayment}>
                  {isSubmittingPayment ? 'Recording...' : 'Record payment'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
