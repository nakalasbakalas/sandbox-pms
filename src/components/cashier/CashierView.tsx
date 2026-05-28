import { useState, useMemo, useEffect } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { 
  MagnifyingGlass, 
  CurrencyCircleDollar,
  Receipt,
  Plus,
  CreditCard,
  Money,
  Bank,
  Wallet,
  CheckCircle,
  Printer,
  X,
  ChartLine,
  FileText,
  Download
} from '@phosphor-icons/react'
import type { ChargeCategory, PaymentMethod, Reservation, Guest } from '@/types'
import { toast } from 'sonner'
import { format, startOfDay, endOfDay } from 'date-fns'
import { cn } from '@/lib/utils'
import { AccountingDashboard } from './AccountingDashboard'

interface Folio {
  id: string
  reservationId: string
  guestId: string
  guestName: string
  roomNumber: string
  checkIn: string
  checkOut: string
  status: 'OPEN' | 'CLOSED' | 'VOIDED'
  depositRequired: number
  depositPaid: number
  charges: FolioCharge[]
  payments: FolioPayment[]
  balance: number
  createdAt: string
  closedAt?: string
}

interface FolioCharge {
  id: string
  folioId: string
  category: ChargeCategory
  description: string
  amount: number
  quantity: number
  total: number
  date: string
  createdAt: string
  createdBy: string
  voided: boolean
  voidedAt?: string
  voidReason?: string
  notes?: string
}

interface FolioPayment {
  id: string
  folioId: string
  method: PaymentMethod
  amount: number
  reference?: string
  receivedAt: string
  receivedBy: string
  voided: boolean
  voidedAt?: string
  voidReason?: string
  isDeposit: boolean
}

export function CashierView() {
  const [folios, setFolios] = useKV<Folio[]>('folios', [])
  const [reservations] = useKV<Reservation[]>('reservations', [])
  const [guests] = useKV<Guest[]>('guests', [])
  
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFolio, setSelectedFolio] = useState<Folio | null>(null)
  const [currentView, setCurrentView] = useState<'folios' | 'daily-report' | 'accounting'>('folios')
  
  const [showAddChargeDialog, setShowAddChargeDialog] = useState(false)
  const [showAddPaymentDialog, setShowAddPaymentDialog] = useState(false)
  const [showVoidDialog, setShowVoidDialog] = useState(false)
  const [showPrintDialog, setShowPrintDialog] = useState(false)
  
  const [chargeCategory, setChargeCategory] = useState<ChargeCategory>('ROOM')
  const [chargeDescription, setChargeDescription] = useState('')
  const [chargeAmount, setChargeAmount] = useState('')
  const [chargeQuantity, setChargeQuantity] = useState('1')
  const [chargeNotes, setChargeNotes] = useState('')

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [isDepositPayment, setIsDepositPayment] = useState(false)
  
  const [voidReason, setVoidReason] = useState('')
  const [itemToVoid, setItemToVoid] = useState<{type: 'charge' | 'payment', item: FolioCharge | FolioPayment} | null>(null)
  
  useEffect(() => {
    syncFoliosWithReservations()
  }, [reservations])
  
  const syncFoliosWithReservations = () => {
    const checkedInReservations = reservations.filter(r => 
      r.status === 'CHECKED_IN' || r.status === 'CHECKED_OUT'
    )
    
    checkedInReservations.forEach(reservation => {
      const existingFolio = folios.find(f => f.reservationId === reservation.id)
      
      if (!existingFolio) {
        const guest = guests.find(g => g.id === reservation.guestId)
        const nights = Math.ceil((new Date(reservation.checkOut).getTime() - new Date(reservation.checkIn).getTime()) / (1000 * 60 * 60 * 24))
        const roomCharge = (reservation.ratePerNight || 0) * nights
        
        const newFolio: Folio = {
          id: `folio_${Date.now()}_${reservation.id}`,
          reservationId: reservation.id,
          guestId: reservation.guestId,
          guestName: guest ? `${guest.firstName} ${guest.lastName}` : 'Guest name required',
          roomNumber: reservation.assignedRoomId || 'TBD',
          checkIn: new Date(reservation.checkIn).toISOString(),
          checkOut: new Date(reservation.checkOut).toISOString(),
          status: reservation.status === 'CHECKED_OUT' ? 'CLOSED' : 'OPEN',
          depositRequired: (reservation as any).depositAmount || 0,
          depositPaid: (reservation as any).depositPaid || 0,
          charges: [{
            id: `charge_${Date.now()}`,
            folioId: '',
            category: 'ROOM',
            description: `Room ${reservation.assignedRoomId || 'TBD'} - ${nights} night${nights > 1 ? 's' : ''}`,
            amount: reservation.ratePerNight || 0,
            quantity: nights,
            total: roomCharge,
            date: new Date(reservation.checkIn).toISOString(),
            createdAt: new Date().toISOString(),
            createdBy: 'system',
            voided: false
          }],
          payments: [],
          balance: roomCharge,
          createdAt: new Date().toISOString(),
          closedAt: reservation.status === 'CHECKED_OUT' ? new Date().toISOString() : undefined
        }
        
        newFolio.charges[0].folioId = newFolio.id
        
        setFolios(current => [...current, newFolio])
      }
    })
  }

  const filteredFolios = useMemo(() => {
    if (!searchQuery) return folios

    const query = searchQuery.toLowerCase()
    return folios.filter(f => 
      f.guestName.toLowerCase().includes(query) ||
      f.roomNumber.toLowerCase().includes(query) ||
      f.id.toLowerCase().includes(query)
    )
  }, [folios, searchQuery])

  const openFolios = filteredFolios.filter(f => f.status === 'OPEN')
  const closedFolios = filteredFolios.filter(f => f.status === 'CLOSED')
  const foliosWithBalance = openFolios.filter(f => f.balance > 0)
  const depositsPending = openFolios.filter(f => f.depositRequired > 0 && f.depositPaid < f.depositRequired)

  const dailyStats = useMemo(() => {
    const today = startOfDay(new Date())
    const todayEnd = endOfDay(new Date())
    
    const todayPayments = folios.flatMap(f => 
      f.payments.filter(p => 
        !p.voided && 
        new Date(p.receivedAt) >= today && 
        new Date(p.receivedAt) <= todayEnd
      )
    )
    
    return {
      cashReceived: todayPayments.filter(p => p.method === 'CASH').reduce((sum, p) => sum + p.amount, 0),
      cardReceived: todayPayments.filter(p => p.method === 'CREDIT_CARD').reduce((sum, p) => sum + p.amount, 0),
      bankTransferReceived: todayPayments.filter(p => p.method === 'BANK_TRANSFER').reduce((sum, p) => sum + p.amount, 0),
      totalReceived: todayPayments.reduce((sum, p) => sum + p.amount, 0),
      depositsTaken: todayPayments.filter(p => p.isDeposit).reduce((sum, p) => sum + p.amount, 0),
      transactionCount: todayPayments.length
    }
  }, [folios])

  const calculateBalance = (charges: FolioCharge[], payments: FolioPayment[]): number => {
    const totalCharges = charges.filter(c => !c.voided).reduce((sum, c) => sum + c.total, 0)
    const totalPayments = payments.filter(p => !p.voided).reduce((sum, p) => sum + p.amount, 0)
    return Math.max(0, totalCharges - totalPayments)
  }

  const handleAddCharge = () => {
    if (!selectedFolio || !chargeDescription || !chargeAmount) {
      toast.error('Please fill in all required fields')
      return
    }

    const amount = parseFloat(chargeAmount)
    const quantity = parseInt(chargeQuantity)

    if (isNaN(amount) || isNaN(quantity) || amount <= 0 || quantity <= 0) {
      toast.error('Invalid amount or quantity')
      return
    }

    const newCharge: FolioCharge = {
      id: `charge_${Date.now()}`,
      folioId: selectedFolio.id,
      category: chargeCategory,
      description: chargeDescription,
      amount,
      quantity,
      total: amount * quantity,
      date: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      createdBy: 'current_user',
      voided: false,
      notes: chargeNotes || undefined
    }

    setFolios(current => 
      current.map(f => {
        if (f.id === selectedFolio.id) {
          const updatedCharges = [...f.charges, newCharge]
          const newBalance = calculateBalance(updatedCharges, f.payments)
          return { ...f, charges: updatedCharges, balance: newBalance }
        }
        return f
      })
    )

    setSelectedFolio(prev => {
      if (!prev) return null
      const updatedCharges = [...prev.charges, newCharge]
      const newBalance = calculateBalance(updatedCharges, prev.payments)
      return { ...prev, charges: updatedCharges, balance: newBalance }
    })

    setChargeDescription('')
    setChargeAmount('')
    setChargeQuantity('1')
    setChargeNotes('')
    setShowAddChargeDialog(false)
    toast.success('Charge added successfully')
  }

  const handleAddPayment = () => {
    if (!selectedFolio || !paymentAmount) {
      toast.error('Please enter payment amount')
      return
    }

    const amount = parseFloat(paymentAmount)

    if (isNaN(amount) || amount <= 0) {
      toast.error('Invalid payment amount')
      return
    }

    if (amount > selectedFolio.balance && !isDepositPayment) {
      toast.error('Payment amount exceeds balance due')
      return
    }

    const newPayment: FolioPayment = {
      id: `payment_${Date.now()}`,
      folioId: selectedFolio.id,
      method: paymentMethod,
      amount,
      reference: paymentReference || undefined,
      receivedAt: new Date().toISOString(),
      receivedBy: 'current_user',
      voided: false,
      isDeposit: isDepositPayment
    }

    setFolios(current => 
      current.map(f => {
        if (f.id === selectedFolio.id) {
          const updatedPayments = [...f.payments, newPayment]
          const newBalance = calculateBalance(f.charges, updatedPayments)
          const newDepositPaid = isDepositPayment ? f.depositPaid + amount : f.depositPaid
          const newStatus = newBalance === 0 && !isDepositPayment ? 'CLOSED' : f.status
          return { ...f, payments: updatedPayments, balance: newBalance, depositPaid: newDepositPaid, status: newStatus, closedAt: newStatus === 'CLOSED' ? new Date().toISOString() : f.closedAt }
        }
        return f
      })
    )

    setSelectedFolio(prev => {
      if (!prev) return null
      const updatedPayments = [...prev.payments, newPayment]
      const newBalance = calculateBalance(prev.charges, updatedPayments)
      const newDepositPaid = isDepositPayment ? prev.depositPaid + amount : prev.depositPaid
      const newStatus = newBalance === 0 && !isDepositPayment ? 'CLOSED' : prev.status
      return { ...prev, payments: updatedPayments, balance: newBalance, depositPaid: newDepositPaid, status: newStatus }
    })

    setPaymentAmount('')
    setPaymentReference('')
    setIsDepositPayment(false)
    setShowAddPaymentDialog(false)
    toast.success('Payment recorded successfully')
  }

  const handleVoid = () => {
    if (!itemToVoid || !voidReason.trim()) {
      toast.error('Please provide a reason for voiding')
      return
    }

    if (!selectedFolio) return

    if (itemToVoid.type === 'charge') {
      const charge = itemToVoid.item as FolioCharge
      setFolios(current => 
        current.map(f => {
          if (f.id === selectedFolio.id) {
            const updatedCharges = f.charges.map(c => 
              c.id === charge.id ? { ...c, voided: true, voidedAt: new Date().toISOString(), voidReason } : c
            )
            const newBalance = calculateBalance(updatedCharges, f.payments)
            return { ...f, charges: updatedCharges, balance: newBalance }
          }
          return f
        })
      )

      setSelectedFolio(prev => {
        if (!prev) return null
        const updatedCharges = prev.charges.map(c => 
          c.id === charge.id ? { ...c, voided: true, voidedAt: new Date().toISOString(), voidReason } : c
        )
        const newBalance = calculateBalance(updatedCharges, prev.payments)
        return { ...prev, charges: updatedCharges, balance: newBalance }
      })
      toast.success('Charge voided')
    } else {
      const payment = itemToVoid.item as FolioPayment
      setFolios(current => 
        current.map(f => {
          if (f.id === selectedFolio.id) {
            const updatedPayments = f.payments.map(p => 
              p.id === payment.id ? { ...p, voided: true, voidedAt: new Date().toISOString(), voidReason } : p
            )
            const newBalance = calculateBalance(f.charges, updatedPayments)
            const newDepositPaid = payment.isDeposit ? f.depositPaid - payment.amount : f.depositPaid
            return { ...f, payments: updatedPayments, balance: newBalance, depositPaid: newDepositPaid, status: 'OPEN' }
          }
          return f
        })
      )

      setSelectedFolio(prev => {
        if (!prev) return null
        const updatedPayments = prev.payments.map(p => 
          p.id === payment.id ? { ...p, voided: true, voidedAt: new Date().toISOString(), voidReason } : p
        )
        const newBalance = calculateBalance(prev.charges, updatedPayments)
        const newDepositPaid = payment.isDeposit ? prev.depositPaid - payment.amount : prev.depositPaid
        return { ...prev, payments: updatedPayments, balance: newBalance, depositPaid: newDepositPaid, status: 'OPEN' }
      })
      toast.success('Payment voided')
    }

    setVoidReason('')
    setItemToVoid(null)
    setShowVoidDialog(false)
  }

  const printReceipt = () => {
    toast.success('Receipt sent to printer')
    setShowPrintDialog(false)
  }

  const getCategoryColor = (category: ChargeCategory) => {
    switch (category) {
      case 'ROOM': return 'bg-blue-500/10 text-blue-700'
      case 'FOOD': return 'bg-orange-500/10 text-orange-700'
      case 'BEVERAGE': return 'bg-purple-500/10 text-purple-700'
      case 'EXTRA_GUEST': return 'bg-green-500/10 text-green-700'
      case 'CHILD_FEE': return 'bg-cyan-500/10 text-cyan-700'
      case 'DAMAGE': return 'bg-red-500/10 text-red-700'
      default: return 'bg-gray-500/10 text-gray-700'
    }
  }

  const getPaymentMethodIcon = (method: PaymentMethod) => {
    switch (method) {
      case 'CASH': return <Money className="w-4 h-4" />
      case 'CREDIT_CARD': return <CreditCard className="w-4 h-4" />
      case 'BANK_TRANSFER': return <Bank className="w-4 h-4" />
      default: return <Wallet className="w-4 h-4" />
    }
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="flex-none border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <CurrencyCircleDollar className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Cashier</h1>
              <p className="text-sm text-muted-foreground">Financial operations & folio management</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button 
              variant={currentView === 'folios' ? 'default' : 'outline'}
              onClick={() => setCurrentView('folios')}
            >
              <Receipt className="w-4 h-4 mr-2" />
              Folios
            </Button>
            <Button 
              variant={currentView === 'daily-report' ? 'default' : 'outline'}
              onClick={() => setCurrentView('daily-report')}
            >
              <ChartLine className="w-4 h-4 mr-2" />
              Daily Report
            </Button>
            <Button 
              variant={currentView === 'accounting' ? 'default' : 'outline'}
              onClick={() => setCurrentView('accounting')}
            >
              <CurrencyCircleDollar className="w-4 h-4 mr-2" />
              Accounting
            </Button>
          </div>
        </div>

        {currentView === 'folios' && (
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by guest, room, or folio..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-2">
              <Badge variant="secondary" className="px-3 py-1">
                {foliosWithBalance.length} with balance
              </Badge>
              <Badge variant="outline" className="px-3 py-1">
                {depositsPending.length} deposits pending
              </Badge>
            </div>
          </div>
        )}
      </div>

      {currentView === 'folios' ? (
        <div className="flex-1 overflow-hidden grid grid-cols-2 gap-6 p-6">
          <div className="flex flex-col gap-4">
            <Tabs defaultValue="open" className="flex-1 flex flex-col">
              <TabsList className="w-full">
                <TabsTrigger value="open" className="flex-1">
                  Open Folios ({openFolios.length})
                </TabsTrigger>
                <TabsTrigger value="closed" className="flex-1">
                  Closed ({closedFolios.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="open" className="flex-1 mt-4">
                <ScrollArea className="h-[calc(100vh-280px)]">
                  <div className="space-y-3 pr-4">
                    {openFolios.length === 0 ? (
                      <Card className="p-12 text-center">
                        <Receipt className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                        <p className="text-muted-foreground">No open folios</p>
                      </Card>
                    ) : (
                      openFolios.map(folio => (
                        <Card 
                          key={folio.id}
                          className={cn(
                            "cursor-pointer transition-all hover:shadow-md hover:border-primary/50",
                            selectedFolio?.id === folio.id && "ring-2 ring-primary border-primary"
                          )}
                          onClick={() => setSelectedFolio(folio)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <h3 className="font-semibold text-base">{folio.guestName}</h3>
                                <p className="text-sm text-muted-foreground">Room {folio.roomNumber}</p>
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                <Badge variant={folio.balance > 0 ? "destructive" : "default"}>
                                  {folio.balance > 0 ? 'Balance Due' : 'Paid'}
                                </Badge>
                                {folio.depositRequired > 0 && folio.depositPaid < folio.depositRequired && (
                                  <Badge variant="outline" className="text-xs">
                                    Deposit Pending
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">
                                {format(new Date(folio.checkIn), 'MMM d')} - {format(new Date(folio.checkOut), 'MMM d')}
                              </span>
                              <span className="font-bold text-lg">
                                ฿{folio.balance.toLocaleString()}
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="closed" className="flex-1 mt-4">
                <ScrollArea className="h-[calc(100vh-280px)]">
                  <div className="space-y-3 pr-4">
                    {closedFolios.length === 0 ? (
                      <Card className="p-12 text-center">
                        <CheckCircle className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                        <p className="text-muted-foreground">No closed folios</p>
                      </Card>
                    ) : (
                      closedFolios.map(folio => (
                        <Card 
                          key={folio.id}
                          className={cn(
                            "cursor-pointer transition-all hover:shadow-md",
                            selectedFolio?.id === folio.id && "ring-2 ring-primary"
                          )}
                          onClick={() => setSelectedFolio(folio)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <h3 className="font-semibold">{folio.guestName}</h3>
                                <p className="text-sm text-muted-foreground">Room {folio.roomNumber}</p>
                              </div>
                              <Badge variant="outline">Closed</Badge>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">
                                {format(new Date(folio.checkIn), 'MMM d')} - {format(new Date(folio.checkOut), 'MMM d')}
                              </span>
                              <span className="font-medium text-green-600">
                                Paid in Full
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>

          <div className="flex flex-col gap-4">
            {selectedFolio ? (
              <>
                <Card>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-xl">{selectedFolio.guestName}</CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                          Room {selectedFolio.roomNumber} • {format(new Date(selectedFolio.checkIn), 'MMM d, yyyy')} - {format(new Date(selectedFolio.checkOut), 'MMM d, yyyy')}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setShowPrintDialog(true)}>
                        <Printer className="w-4 h-4 mr-2" />
                        Print
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">Total Charges</p>
                        <p className="text-2xl font-bold">
                          ฿{selectedFolio.charges.filter(c => !c.voided).reduce((sum, c) => sum + c.total, 0).toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">Total Payments</p>
                        <p className="text-2xl font-bold text-green-600">
                          ฿{selectedFolio.payments.filter(p => !p.voided).reduce((sum, p) => sum + p.amount, 0).toLocaleString()}
                        </p>
                      </div>
                      {selectedFolio.depositRequired > 0 && (
                        <div className="col-span-2 pt-3 border-t border-border">
                          <div className="flex items-center justify-between">
                            <p className="text-sm text-muted-foreground">Deposit Status</p>
                            <p className="text-sm font-medium">
                              ฿{selectedFolio.depositPaid.toLocaleString()} / ฿{selectedFolio.depositRequired.toLocaleString()}
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="col-span-2 pt-3 border-t border-border">
                        <p className="text-sm text-muted-foreground mb-1">Balance Due</p>
                        <p className={cn(
                          "text-3xl font-bold",
                          selectedFolio.balance === 0 ? "text-green-600" : "text-destructive"
                        )}>
                          ฿{selectedFolio.balance.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="flex gap-2">
                  <Button 
                    className="flex-1" 
                    variant="outline"
                    onClick={() => setShowAddChargeDialog(true)}
                    disabled={selectedFolio.status === 'CLOSED'}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Charge
                  </Button>
                  <Button 
                    className="flex-1" 
                    onClick={() => setShowAddPaymentDialog(true)}
                    disabled={selectedFolio.status === 'CLOSED'}
                  >
                    <CurrencyCircleDollar className="w-4 h-4 mr-2" />
                    Add Payment
                  </Button>
                </div>

                <Tabs defaultValue="charges" className="flex-1 flex flex-col">
                  <TabsList className="w-full">
                    <TabsTrigger value="charges" className="flex-1">
                      Charges ({selectedFolio.charges.filter(c => !c.voided).length})
                    </TabsTrigger>
                    <TabsTrigger value="payments" className="flex-1">
                      Payments ({selectedFolio.payments.filter(p => !p.voided).length})
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="charges" className="flex-1 mt-4">
                    <ScrollArea className="h-[calc(100vh-600px)]">
                      <div className="space-y-2 pr-4">
                        {selectedFolio.charges.length === 0 ? (
                          <Card className="p-8 text-center">
                            <p className="text-sm text-muted-foreground">No charges</p>
                          </Card>
                        ) : (
                          selectedFolio.charges.map(charge => (
                            <Card key={charge.id} className={cn(charge.voided && "opacity-50 bg-muted/30")}>
                              <CardContent className="p-3">
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <Badge variant="outline" className={getCategoryColor(charge.category)}>
                                        {charge.category.replace('_', ' ')}
                                      </Badge>
                                      {charge.voided && (
                                        <Badge variant="destructive" className="text-xs">VOIDED</Badge>
                                      )}
                                    </div>
                                    <p className="font-medium text-sm">{charge.description}</p>
                                    {charge.notes && (
                                      <p className="text-xs text-muted-foreground mt-1">{charge.notes}</p>
                                    )}
                                    <p className="text-xs text-muted-foreground mt-1">
                                      {format(new Date(charge.createdAt), 'MMM d, yyyy HH:mm')}
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <p className="font-bold">฿{charge.total.toLocaleString()}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {charge.quantity} × ฿{charge.amount.toLocaleString()}
                                    </p>
                                    {!charge.voided && selectedFolio.status === 'OPEN' && (
                                      <Button 
                                        variant="ghost" 
                                        size="sm"
                                        className="h-7 px-2 mt-1 text-destructive hover:text-destructive"
                                        onClick={() => {
                                          setItemToVoid({type: 'charge', item: charge})
                                          setShowVoidDialog(true)
                                        }}
                                      >
                                        <X className="w-3 h-3 mr-1" />
                                        Void
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="payments" className="flex-1 mt-4">
                    <ScrollArea className="h-[calc(100vh-600px)]">
                      <div className="space-y-2 pr-4">
                        {selectedFolio.payments.length === 0 ? (
                          <Card className="p-8 text-center">
                            <p className="text-sm text-muted-foreground">No payments</p>
                          </Card>
                        ) : (
                          selectedFolio.payments.map(payment => (
                            <Card key={payment.id} className={cn(payment.voided && "opacity-50 bg-muted/30")}>
                              <CardContent className="p-3">
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <div className="flex items-center gap-1 text-sm font-medium">
                                        {getPaymentMethodIcon(payment.method)}
                                        <span>{payment.method.replace('_', ' ')}</span>
                                      </div>
                                      {payment.isDeposit && (
                                        <Badge variant="secondary" className="text-xs">DEPOSIT</Badge>
                                      )}
                                      {payment.voided && (
                                        <Badge variant="destructive" className="text-xs">VOIDED</Badge>
                                      )}
                                    </div>
                                    {payment.reference && (
                                      <p className="text-sm text-muted-foreground">Ref: {payment.reference}</p>
                                    )}
                                    <p className="text-xs text-muted-foreground mt-1">
                                      {format(new Date(payment.receivedAt), 'MMM d, yyyy HH:mm')}
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <p className="font-bold text-green-600">฿{payment.amount.toLocaleString()}</p>
                                    {!payment.voided && selectedFolio.status === 'OPEN' && (
                                      <Button 
                                        variant="ghost" 
                                        size="sm"
                                        className="h-7 px-2 mt-1 text-destructive hover:text-destructive"
                                        onClick={() => {
                                          setItemToVoid({type: 'payment', item: payment})
                                          setShowVoidDialog(true)
                                        }}
                                      >
                                        <X className="w-3 h-3 mr-1" />
                                        Void
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </>
            ) : (
              <Card className="flex-1 flex items-center justify-center">
                <div className="text-center p-12">
                  <Receipt className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Select a Folio</h3>
                  <p className="text-sm text-muted-foreground">
                    Choose a folio from the list to view details and manage charges
                  </p>
                </div>
              </Card>
            )}
          </div>
        </div>
      ) : currentView === 'daily-report' ? (
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ChartLine className="w-5 h-5" />
                  Daily Cash Report
                </CardTitle>
                <CardDescription>
                  {format(new Date(), 'EEEE, MMMM d, yyyy')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-green-500/10 rounded-lg border border-green-500/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Money className="w-5 h-5 text-green-600" />
                      <p className="text-sm font-medium text-green-700">Cash Received</p>
                    </div>
                    <p className="text-3xl font-bold text-green-700">
                      ฿{dailyStats.cashReceived.toLocaleString()}
                    </p>
                  </div>
                  <div className="p-4 bg-blue-500/10 rounded-lg border border-blue-500/20">
                    <div className="flex items-center gap-2 mb-2">
                      <CreditCard className="w-5 h-5 text-blue-600" />
                      <p className="text-sm font-medium text-blue-700">Card Received</p>
                    </div>
                    <p className="text-3xl font-bold text-blue-700">
                      ฿{dailyStats.cardReceived.toLocaleString()}
                    </p>
                  </div>
                  <div className="p-4 bg-purple-500/10 rounded-lg border border-purple-500/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Bank className="w-5 h-5 text-purple-600" />
                      <p className="text-sm font-medium text-purple-700">Bank Transfer</p>
                    </div>
                    <p className="text-3xl font-bold text-purple-700">
                      ฿{dailyStats.bankTransferReceived.toLocaleString()}
                    </p>
                  </div>
                  <div className="p-4 bg-primary/10 rounded-lg border border-primary/20">
                    <div className="flex items-center gap-2 mb-2">
                      <CurrencyCircleDollar className="w-5 h-5 text-primary" />
                      <p className="text-sm font-medium text-primary">Total Received</p>
                    </div>
                    <p className="text-3xl font-bold text-primary">
                      ฿{dailyStats.totalReceived.toLocaleString()}
                    </p>
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Transactions</p>
                    <p className="text-2xl font-bold">{dailyStats.transactionCount}</p>
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Deposits Taken</p>
                    <p className="text-2xl font-bold">฿{dailyStats.depositsTaken.toLocaleString()}</p>
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Open Folios</p>
                    <p className="text-2xl font-bold">{openFolios.length}</p>
                  </div>
                </div>

                <div className="flex gap-2 pt-4">
                  <Button variant="outline" className="flex-1">
                    <Download className="w-4 h-4 mr-2" />
                    Export Report
                  </Button>
                  <Button variant="outline" className="flex-1">
                    <FileText className="w-4 h-4 mr-2" />
                    Print Report
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Outstanding Balances</CardTitle>
                <CardDescription>
                  Folios with pending payments
                </CardDescription>
              </CardHeader>
              <CardContent>
                {foliosWithBalance.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-3" />
                    <p className="text-sm text-muted-foreground">All folios are settled</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {foliosWithBalance.map(folio => (
                      <div key={folio.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div>
                          <p className="font-medium">{folio.guestName}</p>
                          <p className="text-sm text-muted-foreground">Room {folio.roomNumber}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-destructive">฿{folio.balance.toLocaleString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-6">
          <AccountingDashboard />
        </div>
      )}

      <Dialog open={showAddChargeDialog} onOpenChange={setShowAddChargeDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Charge to Folio</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={chargeCategory} onValueChange={(v) => setChargeCategory(v as ChargeCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ROOM">Room Charge</SelectItem>
                  <SelectItem value="FOOD">Food</SelectItem>
                  <SelectItem value="BEVERAGE">Beverage</SelectItem>
                  <SelectItem value="EXTRA_GUEST">Extra Guest</SelectItem>
                  <SelectItem value="CHILD_FEE">Child Fee</SelectItem>
                  <SelectItem value="DAMAGE">Damage / Loss</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Description *</Label>
              <Input
                placeholder="e.g., Extra towels, Minibar items"
                value={chargeDescription}
                onChange={(e) => setChargeDescription(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Amount (฿) *</Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={chargeAmount}
                  onChange={(e) => setChargeAmount(e.target.value)}
                  min="0"
                  step="0.01"
                />
              </div>
              <div className="space-y-2">
                <Label>Quantity *</Label>
                <Input
                  type="number"
                  placeholder="1"
                  value={chargeQuantity}
                  onChange={(e) => setChargeQuantity(e.target.value)}
                  min="1"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes (Optional)</Label>
              <Textarea
                placeholder="Additional details..."
                value={chargeNotes}
                onChange={(e) => setChargeNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddChargeDialog(false)}>Cancel</Button>
            <Button onClick={handleAddCharge}>Add Charge</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddPaymentDialog} onOpenChange={setShowAddPaymentDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">Cash</SelectItem>
                  <SelectItem value="CREDIT_CARD">Credit Card</SelectItem>
                  <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount (฿) *</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                min="0"
                step="0.01"
              />
              {selectedFolio && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Balance due:</span>
                  <span className="font-medium">฿{selectedFolio.balance.toLocaleString()}</span>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Reference (Optional)</Label>
              <Input
                placeholder="Transaction ID, Receipt #, etc."
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
              />
            </div>
            {selectedFolio && selectedFolio.depositRequired > 0 && selectedFolio.depositPaid < selectedFolio.depositRequired && (
              <div className="flex items-center gap-2 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                <input
                  type="checkbox"
                  id="isDeposit"
                  checked={isDepositPayment}
                  onChange={(e) => setIsDepositPayment(e.target.checked)}
                  className="rounded"
                />
                <Label htmlFor="isDeposit" className="cursor-pointer text-sm">
                  Mark as deposit payment
                </Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddPaymentDialog(false)}>Cancel</Button>
            <Button onClick={handleAddPayment}>Record Payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showVoidDialog} onOpenChange={setShowVoidDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Void {itemToVoid?.type === 'charge' ? 'Charge' : 'Payment'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-4 bg-destructive/10 rounded-lg border border-destructive/20">
              <p className="text-sm font-medium text-destructive mb-2">
                This action requires manager approval
              </p>
              <p className="text-xs text-muted-foreground">
                Voiding a {itemToVoid?.type} will adjust the folio balance and create an audit trail
              </p>
            </div>
            <div className="space-y-2">
              <Label>Reason for Voiding *</Label>
              <Textarea
                placeholder="Explain why this item is being voided..."
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowVoidDialog(false)
              setVoidReason('')
              setItemToVoid(null)
            }}>Cancel</Button>
            <Button variant="destructive" onClick={handleVoid}>
              Void {itemToVoid?.type === 'charge' ? 'Charge' : 'Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPrintDialog} onOpenChange={setShowPrintDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Print Receipt</DialogTitle>
          </DialogHeader>
          <div className="py-4 text-center">
            <Printer className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              Ready to print receipt for {selectedFolio?.guestName}
            </p>
            <div className="space-y-2">
              <Button className="w-full" onClick={printReceipt}>
                <Printer className="w-4 h-4 mr-2" />
                Print Receipt
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setShowPrintDialog(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
