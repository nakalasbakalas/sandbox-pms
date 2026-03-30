import { useState, useMemo } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { 
  MagnifyingGlass, 
  CurrencyCircleDollar,
  Receipt,
  Plus,
  Minus,
  CreditCard,
  Money,
  Bank,
  Wallet,
  Warning,
  CheckCircle,
  Printer,
  X
} from '@phosphor-icons/react'
import type { FolioWithDetails, ChargeCategory, PaymentMethod } from '@/types'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'

interface Folio {
  id: string
  reservationId: string
  guestName: string
  roomNumber: string
  checkIn: string
  checkOut: string
  status: 'OPEN' | 'CLOSED' | 'VOIDED'
  charges: FolioCharge[]
  payments: FolioPayment[]
  balance: number
}

interface FolioCharge {
  id: string
  folioId: string
  category: ChargeCategory
  description: string
  amount: number
  quantity: number
  total: number
  createdAt: string
  createdBy: string
  voided: boolean
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
}

export function CashierView() {
  const [folios, setFolios] = useKV<Folio[]>('folios', [])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFolio, setSelectedFolio] = useState<Folio | null>(null)
  const [showAddChargeDialog, setShowAddChargeDialog] = useState(false)
  const [showAddPaymentDialog, setShowAddPaymentDialog] = useState(false)
  const [showPrintDialog, setShowPrintDialog] = useState(false)

  const [chargeCategory, setChargeCategory] = useState<ChargeCategory>('ROOM')
  const [chargeDescription, setChargeDescription] = useState('')
  const [chargeAmount, setChargeAmount] = useState('')
  const [chargeQuantity, setChargeQuantity] = useState('1')

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentReference, setPaymentReference] = useState('')

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
      createdAt: new Date().toISOString(),
      createdBy: 'current_user',
      voided: false
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

    if (amount > selectedFolio.balance) {
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
      voided: false
    }

    setFolios(current => 
      current.map(f => {
        if (f.id === selectedFolio.id) {
          const updatedPayments = [...f.payments, newPayment]
          const newBalance = calculateBalance(f.charges, updatedPayments)
          const newStatus = newBalance === 0 ? 'CLOSED' : 'OPEN'
          return { ...f, payments: updatedPayments, balance: newBalance, status: newStatus }
        }
        return f
      })
    )

    setSelectedFolio(prev => {
      if (!prev) return null
      const updatedPayments = [...prev.payments, newPayment]
      const newBalance = calculateBalance(prev.charges, updatedPayments)
      const newStatus = newBalance === 0 ? 'CLOSED' : 'OPEN'
      return { ...prev, payments: updatedPayments, balance: newBalance, status: newStatus }
    })

    setPaymentAmount('')
    setPaymentReference('')
    setShowAddPaymentDialog(false)
    toast.success('Payment recorded successfully')
  }

  const calculateBalance = (charges: FolioCharge[], payments: FolioPayment[]): number => {
    const totalCharges = charges.filter(c => !c.voided).reduce((sum, c) => sum + c.total, 0)
    const totalPayments = payments.filter(p => !p.voided).reduce((sum, p) => sum + p.amount, 0)
    return Math.max(0, totalCharges - totalPayments)
  }

  const voidCharge = (chargeId: string) => {
    if (!selectedFolio) return

    setFolios(current => 
      current.map(f => {
        if (f.id === selectedFolio.id) {
          const updatedCharges = f.charges.map(c => 
            c.id === chargeId ? { ...c, voided: true } : c
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
        c.id === chargeId ? { ...c, voided: true } : c
      )
      const newBalance = calculateBalance(updatedCharges, prev.payments)
      return { ...prev, charges: updatedCharges, balance: newBalance }
    })

    toast.success('Charge voided')
  }

  const voidPayment = (paymentId: string) => {
    if (!selectedFolio) return

    setFolios(current => 
      current.map(f => {
        if (f.id === selectedFolio.id) {
          const updatedPayments = f.payments.map(p => 
            p.id === paymentId ? { ...p, voided: true } : p
          )
          const newBalance = calculateBalance(f.charges, updatedPayments)
          return { ...f, payments: updatedPayments, balance: newBalance, status: 'OPEN' }
        }
        return f
      })
    )

    setSelectedFolio(prev => {
      if (!prev) return null
      const updatedPayments = prev.payments.map(p => 
        p.id === paymentId ? { ...p, voided: true } : p
      )
      const newBalance = calculateBalance(prev.charges, updatedPayments)
      return { ...prev, payments: updatedPayments, balance: newBalance, status: 'OPEN' }
    })

    toast.success('Payment voided')
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <CurrencyCircleDollar className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Cashier</h1>
              <p className="text-sm text-muted-foreground">Payments, folios, and charges</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by guest, room, or folio..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 w-80"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden grid grid-cols-2 gap-6 p-6">
        <div className="flex flex-col gap-4">
          <Tabs defaultValue="open" className="flex-1 flex flex-col">
            <TabsList className="w-full">
              <TabsTrigger value="open" className="flex-1">
                Open Folios ({openFolios.length})
              </TabsTrigger>
              <TabsTrigger value="closed" className="flex-1">
                Closed Folios ({closedFolios.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="open" className="flex-1 mt-4">
              <ScrollArea className="h-[calc(100vh-280px)]">
                <div className="space-y-3">
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
                            <Badge variant={folio.balance > 0 ? "destructive" : "default"}>
                              {folio.balance > 0 ? 'Balance Due' : 'Paid'}
                            </Badge>
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
                <div className="space-y-3">
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
                  <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
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
                    <div className="col-span-2 pt-4 border-t">
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
                  onClick={() => setShowAddChargeDialog(true)}
                  disabled={selectedFolio.status === 'CLOSED'}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Charge
                </Button>
                <Button 
                  className="flex-1" 
                  variant="default"
                  onClick={() => setShowAddPaymentDialog(true)}
                  disabled={selectedFolio.status === 'CLOSED' || selectedFolio.balance === 0}
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
                    <div className="space-y-2">
                      {selectedFolio.charges.map(charge => (
                        <Card key={charge.id} className={cn(charge.voided && "opacity-50")}>
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge variant="outline" className={getCategoryColor(charge.category)}>
                                    {charge.category}
                                  </Badge>
                                  {charge.voided && (
                                    <Badge variant="destructive">VOIDED</Badge>
                                  )}
                                </div>
                                <p className="font-medium">{charge.description}</p>
                                <p className="text-sm text-muted-foreground mt-1">
                                  {format(new Date(charge.createdAt), 'MMM d, yyyy HH:mm')}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="font-bold">฿{charge.total.toLocaleString()}</p>
                                <p className="text-xs text-muted-foreground">
                                  {charge.quantity} × ฿{charge.amount}
                                </p>
                                {!charge.voided && selectedFolio.status === 'OPEN' && (
                                  <Button 
                                    variant="ghost" 
                                    size="sm"
                                    className="h-6 px-2 mt-1"
                                    onClick={() => voidCharge(charge.id)}
                                  >
                                    <X className="w-3 h-3 mr-1" />
                                    Void
                                  </Button>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="payments" className="flex-1 mt-4">
                  <ScrollArea className="h-[calc(100vh-600px)]">
                    <div className="space-y-2">
                      {selectedFolio.payments.map(payment => (
                        <Card key={payment.id} className={cn(payment.voided && "opacity-50")}>
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <div className="flex items-center gap-1 text-sm font-medium">
                                    {getPaymentMethodIcon(payment.method)}
                                    <span>{payment.method.replace('_', ' ')}</span>
                                  </div>
                                  {payment.voided && (
                                    <Badge variant="destructive">VOIDED</Badge>
                                  )}
                                </div>
                                {payment.reference && (
                                  <p className="text-sm text-muted-foreground">Ref: {payment.reference}</p>
                                )}
                                <p className="text-sm text-muted-foreground mt-1">
                                  {format(new Date(payment.receivedAt), 'MMM d, yyyy HH:mm')}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="font-bold text-green-600">฿{payment.amount.toLocaleString()}</p>
                                {!payment.voided && selectedFolio.status === 'OPEN' && (
                                  <Button 
                                    variant="ghost" 
                                    size="sm"
                                    className="h-6 px-2 mt-1"
                                    onClick={() => voidPayment(payment.id)}
                                  >
                                    <X className="w-3 h-3 mr-1" />
                                    Void
                                  </Button>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
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

      <Dialog open={showAddChargeDialog} onOpenChange={setShowAddChargeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Charge</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={chargeCategory} onValueChange={(v) => setChargeCategory(v as ChargeCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ROOM">Room</SelectItem>
                  <SelectItem value="FOOD">Food</SelectItem>
                  <SelectItem value="BEVERAGE">Beverage</SelectItem>
                  <SelectItem value="EXTRA_GUEST">Extra Guest</SelectItem>
                  <SelectItem value="CHILD_FEE">Child Fee</SelectItem>
                  <SelectItem value="DAMAGE">Damage</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                placeholder="e.g., Extra towels, Minibar items"
                value={chargeDescription}
                onChange={(e) => setChargeDescription(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Amount (฿)</Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={chargeAmount}
                  onChange={(e) => setChargeAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Quantity</Label>
                <Input
                  type="number"
                  placeholder="1"
                  value={chargeQuantity}
                  onChange={(e) => setChargeQuantity(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddChargeDialog(false)}>Cancel</Button>
            <Button onClick={handleAddCharge}>Add Charge</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddPaymentDialog} onOpenChange={setShowAddPaymentDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Payment</DialogTitle>
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
              <Label>Amount (฿)</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
              />
              {selectedFolio && (
                <p className="text-sm text-muted-foreground">
                  Balance due: ฿{selectedFolio.balance.toLocaleString()}
                </p>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddPaymentDialog(false)}>Cancel</Button>
            <Button onClick={handleAddPayment}>Record Payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPrintDialog} onOpenChange={setShowPrintDialog}>
        <DialogContent>
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
