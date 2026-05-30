import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { 
  CalendarBlank,
  Plus,
  X,
  Receipt,
  CreditCard,
  Money
} from '@phosphor-icons/react'
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

interface ManualEntryFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (entry: Omit<AccountingEntry, 'id' | 'createdAt' | 'createdBy'>) => void
}

const revenueCategories = [
  {
    name: 'Room Revenue',
    subcategories: ['Rack Rate', 'Corporate Rate', 'Walk-in', 'OTA Bookings', 'Package Rate']
  },
  {
    name: 'Food & Beverage',
    subcategories: ['Restaurant', 'Room Service', 'Minibar', 'Bar', 'Catering']
  },
  {
    name: 'Other Revenue',
    subcategories: ['Extra Guest Fee', 'Child Fee', 'Late Checkout', 'Early Checkin', 'Laundry', 'Parking', 'Airport Transfer']
  },
  {
    name: 'Service Charges',
    subcategories: ['Service Charge', 'Tourism Fee', 'Government Tax']
  }
]

const expenseCategories = [
  {
    name: 'Cost of Sales',
    subcategories: ['F&B Cost', 'Minibar Cost', 'Laundry Cost', 'Amenities Cost']
  },
  {
    name: 'Staff Costs',
    subcategories: ['Salaries', 'Benefits', 'Training', 'Uniforms', 'Staff Meals']
  },
  {
    name: 'Operations',
    subcategories: ['Utilities', 'Maintenance', 'Supplies', 'Cleaning', 'Repairs', 'Contract Services']
  },
  {
    name: 'Marketing & Sales',
    subcategories: ['OTA Commissions', 'Advertising', 'Photography', 'Website', 'Social Media']
  },
  {
    name: 'Administrative',
    subcategories: ['Office Supplies', 'Software', 'Bank Fees', 'Professional Services', 'Insurance', 'Licenses']
  }
]

const paymentMethods = [
  'CASH',
  'CREDIT_CARD',
  'DEBIT_CARD',
  'BANK_TRANSFER',
  'MOBILE_PAYMENT',
  'CHECK',
  'WIRE_TRANSFER'
]

export function ManualEntryForm({ open, onOpenChange, onSubmit }: ManualEntryFormProps) {
  const [entryType, setEntryType] = useState<'REVENUE' | 'EXPENSE' | 'REFUND' | 'ADJUSTMENT'>('REVENUE')
  const [category, setCategory] = useState<string>('')
  const [subcategory, setSubcategory] = useState<string>('')
  const [amount, setAmount] = useState<string>('')
  const [includeTax, setIncludeTax] = useState(true)
  const [taxRate, setTaxRate] = useState<string>('7')
  const [description, setDescription] = useState<string>('')
  const [referenceType, setReferenceType] = useState<'FOLIO' | 'RESERVATION' | 'MANUAL'>('MANUAL')
  const [referenceId, setReferenceId] = useState<string>('')
  const [paymentMethod, setPaymentMethod] = useState<string>('')
  const [date, setDate] = useState<Date>(new Date())

  const availableCategories = entryType === 'REVENUE' || entryType === 'REFUND' 
    ? revenueCategories 
    : expenseCategories

  const selectedCategoryData = availableCategories.find(c => c.name === category)

  const calculateTaxAmount = () => {
    const baseAmount = parseFloat(amount) || 0
    if (!includeTax || baseAmount === 0) return 0
    const rate = parseFloat(taxRate) || 0
    return (baseAmount * rate) / 100
  }

  const calculateTotal = () => {
    const baseAmount = parseFloat(amount) || 0
    const tax = calculateTaxAmount()
    return baseAmount + tax
  }

  const handleSubmit = () => {
    if (!category || !amount || !description) {
      toast.error('Please fill in all required fields')
      return
    }

    const baseAmount = parseFloat(amount)
    if (isNaN(baseAmount) || baseAmount <= 0) {
      toast.error('Please enter a valid amount')
      return
    }

    const taxAmount = calculateTaxAmount()
    const totalAmount = calculateTotal()

    const entry: Omit<AccountingEntry, 'id' | 'createdAt' | 'createdBy'> = {
      date: date.toISOString(),
      type: entryType,
      category,
      subcategory: subcategory || undefined,
      amount: totalAmount,
      description,
      referenceType: referenceType === 'MANUAL' ? undefined : referenceType,
      referenceId: referenceId || undefined,
      paymentMethod: paymentMethod || undefined,
      taxAmount: includeTax ? taxAmount : undefined
    }

    onSubmit(entry)
    
    setCategory('')
    setSubcategory('')
    setAmount('')
    setDescription('')
    setReferenceId('')
    setPaymentMethod('')
    setDate(new Date())
    
    toast.success('Transaction posted successfully')
    onOpenChange(false)
  }

  const handleCancel = () => {
    onOpenChange(false)
    setCategory('')
    setSubcategory('')
    setAmount('')
    setDescription('')
    setReferenceId('')
    setPaymentMethod('')
    setDate(new Date())
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-4">
        <DialogHeader className="pb-2">
          <DialogTitle className="flex items-center gap-1.5 text-base">
            <Receipt size={20} />
            Post Manual Accounting Entry
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="entry-type" className="text-xs">Transaction Type *</Label>
              <Select value={entryType} onValueChange={(v) => {
                setEntryType(v as any)
                setCategory('')
                setSubcategory('')
              }}>
                <SelectTrigger id="entry-type" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="REVENUE">
                    <div className="flex items-center gap-1.5">
                      <Badge className="bg-green-100 text-green-800 text-[10px] px-1.5 py-0">Revenue</Badge>
                    </div>
                  </SelectItem>
                  <SelectItem value="EXPENSE">
                    <div className="flex items-center gap-1.5">
                      <Badge className="bg-red-100 text-red-800 text-[10px] px-1.5 py-0">Expense</Badge>
                    </div>
                  </SelectItem>
                  <SelectItem value="REFUND">
                    <div className="flex items-center gap-1.5">
                      <Badge className="bg-orange-100 text-orange-800 text-[10px] px-1.5 py-0">Refund</Badge>
                    </div>
                  </SelectItem>
                  <SelectItem value="ADJUSTMENT">
                    <div className="flex items-center gap-1.5">
                      <Badge className="bg-blue-100 text-blue-800 text-[10px] px-1.5 py-0">Adjustment</Badge>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="date" className="text-xs">Transaction Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id="date"
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal h-8 text-xs",
                      !date && "text-muted-foreground"
                    )}
                  >
                    <CalendarBlank className="mr-1.5" size={14} />
                    {date ? format(date, 'MMM d, yyyy') : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(d) => d && setDate(d)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="category" className="text-xs">Category *</Label>
              <Select value={category} onValueChange={(v) => {
                setCategory(v)
                setSubcategory('')
              }}>
                <SelectTrigger id="category" className="h-8 text-xs">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {availableCategories.map((cat) => (
                    <SelectItem key={cat.name} value={cat.name}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="subcategory" className="text-xs">Subcategory</Label>
              <Select 
                value={subcategory} 
                onValueChange={setSubcategory}
                disabled={!category}
              >
                <SelectTrigger id="subcategory" className="h-8 text-xs">
                  <SelectValue placeholder="Select subcategory" />
                </SelectTrigger>
                <SelectContent>
                  {selectedCategoryData?.subcategories.map((sub) => (
                    <SelectItem key={sub} value={sub}>
                      {sub}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="description" className="text-xs">Description *</Label>
            <Textarea
              id="description"
              placeholder="Enter transaction description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="text-sm min-h-[60px]"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="amount" className="text-xs">Base Amount (฿) *</Label>
              <Input
                id="amount"
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="0"
                step="0.01"
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="tax-rate" className="text-xs">Tax Rate (%)</Label>
              <div className="flex gap-1.5">
                <Input
                  id="tax-rate"
                  type="number"
                  placeholder="7"
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  disabled={!includeTax}
                  min="0"
                  step="0.01"
                  className="h-8 text-sm"
                />
                <Button
                  type="button"
                  variant={includeTax ? "default" : "outline"}
                  size="sm"
                  onClick={() => setIncludeTax(!includeTax)}
                  className="px-2 h-8 text-xs"
                >
                  {includeTax ? 'On' : 'Off'}
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Tax Amount (฿)</Label>
              <div className="h-8 px-2 py-1.5 border rounded-md bg-muted flex items-center">
                <span className="text-xs font-medium">
                  {calculateTaxAmount().toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          <div className="p-2.5 bg-muted rounded-lg border-2 border-primary/20">
            <div className="flex items-center justify-between text-base font-bold">
              <span className="text-xs">Total Amount:</span>
              <span className={cn(
                "text-sm",
                entryType === 'REVENUE' ? 'text-green-600' : 'text-red-600'
              )}>
                ฿{calculateTotal().toFixed(2)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="reference-type" className="text-xs">Reference Type</Label>
              <Select value={referenceType} onValueChange={(v) => setReferenceType(v as any)}>
                <SelectTrigger id="reference-type" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MANUAL">Manual Entry</SelectItem>
                  <SelectItem value="FOLIO">Folio</SelectItem>
                  <SelectItem value="RESERVATION">Reservation</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="reference-id" className="text-xs">Reference ID</Label>
              <Input
                id="reference-id"
                placeholder={referenceType === 'FOLIO' ? 'FOLIO1001' : referenceType === 'RESERVATION' ? 'RES1001' : 'Optional'}
                value={referenceId}
                onChange={(e) => setReferenceId(e.target.value)}
                disabled={referenceType === 'MANUAL'}
                className="h-8 text-sm"
              />
            </div>
          </div>

          {(entryType === 'REVENUE' || entryType === 'REFUND') && (
            <div className="space-y-1">
              <Label htmlFor="payment-method" className="text-xs">Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger id="payment-method" className="h-8 text-xs">
                  <SelectValue placeholder="Select payment method" />
                </SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((method) => (
                    <SelectItem key={method} value={method}>
                      <div className="flex items-center gap-1.5">
                        {method === 'CASH' ? (
                          <Money size={14} />
                        ) : (
                          <CreditCard size={14} />
                        )}
                        <span className="text-xs">{method.replace(/_/g, ' ')}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter className="pt-3">
          <Button variant="outline" onClick={handleCancel} className="h-8 text-xs">
            <X size={14} className="mr-1.5" />
            Cancel
          </Button>
          <Button onClick={handleSubmit} className="h-8 text-xs">
            <Plus size={14} className="mr-1.5" />
            Post Transaction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
