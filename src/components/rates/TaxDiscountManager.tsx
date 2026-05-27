import { useState } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { 
  Plus,
  Trash,
  Percent,
  Tag,
  CalendarBlank,
  Receipt,
  CheckCircle
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'

interface TaxRule {
  id: string
  name: string
  code: string
  rate: number
  type: 'VAT' | 'SERVICE_CHARGE' | 'TOURISM_FEE' | 'CITY_TAX' | 'OTHER'
  isIncludedInPrice: boolean
  isCompounded: boolean
  applicableCategories: string[]
  status: 'ACTIVE' | 'INACTIVE'
  effectiveFrom: string
  effectiveTo?: string
  createdAt: string
}

interface DiscountRule {
  id: string
  name: string
  code: string
  type: 'PERCENTAGE' | 'FIXED_AMOUNT'
  value: number
  applicableOn: 'ROOM_RATE' | 'TOTAL_BILL' | 'SPECIFIC_CATEGORY'
  minSpend?: number
  maxDiscount?: number
  categories?: string[]
  isStackable: boolean
  requiresApproval: boolean
  validFrom: string
  validTo: string
  daysOfWeek?: number[]
  usageLimit?: number
  usageCount: number
  status: 'ACTIVE' | 'INACTIVE' | 'EXPIRED'
  createdAt: string
}

export function TaxDiscountManager() {
  const [taxRules, setTaxRules] = useKV<TaxRule[]>('tax-rules', [])
  const [discountRules, setDiscountRules] = useKV<DiscountRule[]>('discount-rules', [])
  
  const [showAddTaxDialog, setShowAddTaxDialog] = useState(false)
  const [showAddDiscountDialog, setShowAddDiscountDialog] = useState(false)
  
  const [taxName, setTaxName] = useState('')
  const [taxCode, setTaxCode] = useState('')
  const [taxRate, setTaxRate] = useState('')
  const [taxType, setTaxType] = useState<'VAT' | 'SERVICE_CHARGE' | 'TOURISM_FEE' | 'CITY_TAX' | 'OTHER'>('VAT')
  const [taxIncluded, setTaxIncluded] = useState(true)
  const [taxCompounded, setTaxCompounded] = useState(false)
  
  const [discountName, setDiscountName] = useState('')
  const [discountCode, setDiscountCode] = useState('')
  const [discountType, setDiscountType] = useState<'PERCENTAGE' | 'FIXED_AMOUNT'>('PERCENTAGE')
  const [discountValue, setDiscountValue] = useState('')
  const [discountApplicableOn, setDiscountApplicableOn] = useState<'ROOM_RATE' | 'TOTAL_BILL' | 'SPECIFIC_CATEGORY'>('ROOM_RATE')
  const [discountMinSpend, setDiscountMinSpend] = useState('')
  const [discountMaxDiscount, setDiscountMaxDiscount] = useState('')
  const [discountStackable, setDiscountStackable] = useState(false)
  const [discountRequiresApproval, setDiscountRequiresApproval] = useState(false)
  const [discountValidFrom, setDiscountValidFrom] = useState<Date>()
  const [discountValidTo, setDiscountValidTo] = useState<Date>()
  const [discountUsageLimit, setDiscountUsageLimit] = useState('')

  const handleAddTax = () => {
    if (!taxName || !taxCode || !taxRate) {
      toast.error('Please fill in all required fields')
      return
    }

    const rate = parseFloat(taxRate)
    if (isNaN(rate) || rate < 0) {
      toast.error('Invalid tax rate')
      return
    }

    const newTax: TaxRule = {
      id: `tax_${Date.now()}`,
      name: taxName,
      code: taxCode.toUpperCase(),
      rate,
      type: taxType,
      isIncludedInPrice: taxIncluded,
      isCompounded: taxCompounded,
      applicableCategories: [],
      status: 'ACTIVE',
      effectiveFrom: new Date().toISOString(),
      createdAt: new Date().toISOString()
    }

    setTaxRules(current => [...current, newTax])
    resetTaxForm()
    setShowAddTaxDialog(false)
    toast.success('Tax rule created successfully')
  }

  const handleAddDiscount = () => {
    if (!discountName || !discountCode || !discountValue || !discountValidFrom || !discountValidTo) {
      toast.error('Please fill in all required fields')
      return
    }

    const value = parseFloat(discountValue)
    if (isNaN(value) || value <= 0) {
      toast.error('Invalid discount value')
      return
    }

    const newDiscount: DiscountRule = {
      id: `discount_${Date.now()}`,
      name: discountName,
      code: discountCode.toUpperCase(),
      type: discountType,
      value,
      applicableOn: discountApplicableOn,
      minSpend: discountMinSpend ? parseFloat(discountMinSpend) : undefined,
      maxDiscount: discountMaxDiscount ? parseFloat(discountMaxDiscount) : undefined,
      isStackable: discountStackable,
      requiresApproval: discountRequiresApproval,
      validFrom: discountValidFrom.toISOString(),
      validTo: discountValidTo.toISOString(),
      usageLimit: discountUsageLimit ? parseInt(discountUsageLimit) : undefined,
      usageCount: 0,
      status: 'ACTIVE',
      createdAt: new Date().toISOString()
    }

    setDiscountRules(current => [...current, newDiscount])
    resetDiscountForm()
    setShowAddDiscountDialog(false)
    toast.success('Discount rule created successfully')
  }

  const handleDeleteTax = (taxId: string) => {
    setTaxRules(current => current.filter(t => t.id !== taxId))
    toast.success('Tax rule deleted')
  }

  const handleDeleteDiscount = (discountId: string) => {
    setDiscountRules(current => current.filter(d => d.id !== discountId))
    toast.success('Discount rule deleted')
  }

  const toggleTaxStatus = (taxId: string) => {
    setTaxRules(current =>
      current.map(t =>
        t.id === taxId ? { ...t, status: t.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } : t
      )
    )
  }

  const toggleDiscountStatus = (discountId: string) => {
    setDiscountRules(current =>
      current.map(d =>
        d.id === discountId ? { ...d, status: d.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } : d
      )
    )
  }

  const resetTaxForm = () => {
    setTaxName('')
    setTaxCode('')
    setTaxRate('')
    setTaxType('VAT')
    setTaxIncluded(true)
    setTaxCompounded(false)
  }

  const resetDiscountForm = () => {
    setDiscountName('')
    setDiscountCode('')
    setDiscountValue('')
    setDiscountApplicableOn('ROOM_RATE')
    setDiscountMinSpend('')
    setDiscountMaxDiscount('')
    setDiscountStackable(false)
    setDiscountRequiresApproval(false)
    setDiscountValidFrom(undefined)
    setDiscountValidTo(undefined)
    setDiscountUsageLimit('')
  }

  const activeTaxes = taxRules.filter(t => t.status === 'ACTIVE')
  const activeDiscounts = discountRules.filter(d => d.status === 'ACTIVE')

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Receipt className="w-5 h-5" />
                  Tax Rules
                </CardTitle>
                <CardDescription>Manage tax and fee configurations</CardDescription>
              </div>
              <Button onClick={() => setShowAddTaxDialog(true)} size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Add Tax
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px] pr-4">
              {activeTaxes.length === 0 ? (
                <div className="text-center py-12">
                  <Receipt className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">No tax rules configured</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeTaxes.map(tax => (
                    <Card key={tax.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-semibold">{tax.name}</h4>
                              <Badge variant="outline" className="font-mono text-xs">
                                {tax.code}
                              </Badge>
                              <Badge variant={tax.isIncludedInPrice ? 'secondary' : 'default'} className="text-xs">
                                {tax.isIncludedInPrice ? 'Inclusive' : 'Exclusive'}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">{tax.type.replace('_', ' ')}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-2xl font-bold">{tax.rate}%</p>
                            {tax.isCompounded && (
                              <p className="text-xs text-primary">Compounded</p>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleTaxStatus(tax.id)}
                          >
                            Deactivate
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleDeleteTax(tax.id)}
                          >
                            <Trash className="w-4 h-4 mr-1" />
                            Delete
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Tag className="w-5 h-5" />
                  Discount Rules
                </CardTitle>
                <CardDescription>Manage promotional discounts</CardDescription>
              </div>
              <Button onClick={() => setShowAddDiscountDialog(true)} size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Add Discount
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px] pr-4">
              {activeDiscounts.length === 0 ? (
                <div className="text-center py-12">
                  <Tag className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">No discount rules configured</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeDiscounts.map(discount => (
                    <Card key={discount.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-semibold">{discount.name}</h4>
                              <Badge variant="outline" className="font-mono text-xs">
                                {discount.code}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mb-2">
                              Valid: {format(new Date(discount.validFrom), 'MMM d')} - {format(new Date(discount.validTo), 'MMM d')}
                            </p>
                            {discount.minSpend && (
                              <p className="text-xs text-muted-foreground">
                                Min spend: ฿{discount.minSpend.toLocaleString()}
                              </p>
                            )}
                            {discount.usageLimit && (
                              <p className="text-xs text-muted-foreground">
                                Used: {discount.usageCount} / {discount.usageLimit}
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            <p className="text-2xl font-bold text-green-600">
                              {discount.type === 'PERCENTAGE' ? `${discount.value}%` : `฿${discount.value}`}
                            </p>
                            {discount.requiresApproval && (
                              <Badge variant="secondary" className="text-xs mt-1">
                                Requires Approval
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleDiscountStatus(discount.id)}
                          >
                            Deactivate
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleDeleteDiscount(discount.id)}
                          >
                            <Trash className="w-4 h-4 mr-1" />
                            Delete
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Dialog open={showAddTaxDialog} onOpenChange={setShowAddTaxDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Tax Rule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tax Name *</Label>
                <Input
                  placeholder="e.g., VAT"
                  value={taxName}
                  onChange={(e) => setTaxName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Tax Code *</Label>
                <Input
                  placeholder="e.g., VAT"
                  value={taxCode}
                  onChange={(e) => setTaxCode(e.target.value.toUpperCase())}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Tax Type</Label>
              <Select value={taxType} onValueChange={(v: any) => setTaxType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VAT">VAT</SelectItem>
                  <SelectItem value="SERVICE_CHARGE">Service Charge</SelectItem>
                  <SelectItem value="TOURISM_FEE">Tourism Fee</SelectItem>
                  <SelectItem value="CITY_TAX">City Tax</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Tax Rate (%) *</Label>
              <Input
                type="number"
                placeholder="e.g., 7"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                step="0.01"
              />
            </div>

            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <Switch checked={taxIncluded} onCheckedChange={setTaxIncluded} />
              <Label className="cursor-pointer">Tax included in displayed prices</Label>
            </div>

            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <Switch checked={taxCompounded} onCheckedChange={setTaxCompounded} />
              <Label className="cursor-pointer">Compounded (applied on subtotal + previous taxes)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowAddTaxDialog(false)
              resetTaxForm()
            }}>
              Cancel
            </Button>
            <Button onClick={handleAddTax}>Add Tax Rule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddDiscountDialog} onOpenChange={setShowAddDiscountDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Discount Rule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Discount Name *</Label>
                <Input
                  placeholder="e.g., Early Bird"
                  value={discountName}
                  onChange={(e) => setDiscountName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Discount Code *</Label>
                <Input
                  placeholder="e.g., EARLY20"
                  value={discountCode}
                  onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={discountType} onValueChange={(v: any) => setDiscountType(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERCENTAGE">Percentage</SelectItem>
                    <SelectItem value="FIXED_AMOUNT">Fixed Amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Value *</Label>
                <Input
                  type="number"
                  placeholder={discountType === 'PERCENTAGE' ? 'e.g., 20' : 'e.g., 500'}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Applicable On</Label>
              <Select value={discountApplicableOn} onValueChange={(v: any) => setDiscountApplicableOn(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ROOM_RATE">Room Rate Only</SelectItem>
                  <SelectItem value="TOTAL_BILL">Total Bill</SelectItem>
                  <SelectItem value="SPECIFIC_CATEGORY">Specific Category</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Min Spend (฿)</Label>
                <Input
                  type="number"
                  placeholder="Optional"
                  value={discountMinSpend}
                  onChange={(e) => setDiscountMinSpend(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Max Discount (฿)</Label>
                <Input
                  type="number"
                  placeholder="Optional"
                  value={discountMaxDiscount}
                  onChange={(e) => setDiscountMaxDiscount(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Valid From *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarBlank className="w-4 h-4 mr-2" />
                      {discountValidFrom ? format(discountValidFrom, 'MMM d, yyyy') : 'Select date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={discountValidFrom}
                      onSelect={setDiscountValidFrom}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>Valid To *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarBlank className="w-4 h-4 mr-2" />
                      {discountValidTo ? format(discountValidTo, 'MMM d, yyyy') : 'Select date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={discountValidTo}
                      onSelect={setDiscountValidTo}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Usage Limit</Label>
              <Input
                type="number"
                placeholder="Leave blank for unlimited"
                value={discountUsageLimit}
                onChange={(e) => setDiscountUsageLimit(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <Switch checked={discountStackable} onCheckedChange={setDiscountStackable} />
              <Label className="cursor-pointer">Allow stacking with other discounts</Label>
            </div>

            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <Switch checked={discountRequiresApproval} onCheckedChange={setDiscountRequiresApproval} />
              <Label className="cursor-pointer">Requires manager approval</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowAddDiscountDialog(false)
              resetDiscountForm()
            }}>
              Cancel
            </Button>
            <Button onClick={handleAddDiscount}>Add Discount Rule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
