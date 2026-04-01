import { useState, useEffect } from 'react'
import type { DepartureItem, CheckOutData } from '@/types/front-desk'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { CheckCircle, Warning, CurrencyDollar, Plus, Trash, QrCode } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { PromptPayQR } from './PromptPayQR'

interface CheckOutDialogProps {
  departure: DepartureItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (data: CheckOutData) => void
}

interface AdditionalCharge {
  description: string
  amount: number
}

export function CheckOutDialog({ departure, open, onOpenChange, onConfirm }: CheckOutDialogProps) {
  const [minibarCharges, setMinibarCharges] = useState(0)
  const [damageFees, setDamageFees] = useState(0)
  const [additionalCharges, setAdditionalCharges] = useState<AdditionalCharge[]>([])
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'TRANSFER' | 'PROMPTPAY' | 'OTHER'>('CARD')
  const [paymentReference, setPaymentReference] = useState('')
  const [balanceSettled, setBalanceSettled] = useState(false)
  const [showQR, setShowQR] = useState(false)
  const [autoChecklist, setAutoChecklist] = useState({
    key: false,
    feedback: false,
    roomGood: false
  })
  const [additionalNotes, setAdditionalNotes] = useState('')

  useEffect(() => {
    if (open && departure) {
      setAutoChecklist({
        key: true,
        feedback: true,
        roomGood: true
      })
    }
  }, [open, departure])

  if (!departure) return null

  const totalAdditional = minibarCharges + damageFees + 
    additionalCharges.reduce((sum, charge) => sum + charge.amount, 0)
  
  const finalTotal = departure.folioTotal + totalAdditional
  const totalDue = departure.balanceDue + totalAdditional

  const allChecksComplete = (totalDue === 0 || balanceSettled) && autoChecklist.key && autoChecklist.feedback

  const handleAddCharge = () => {
    setAdditionalCharges([...additionalCharges, { description: '', amount: 0 }])
  }

  const handleRemoveCharge = (index: number) => {
    setAdditionalCharges(additionalCharges.filter((_, i) => i !== index))
  }

  const handleChargeChange = (index: number, field: 'description' | 'amount', value: string | number) => {
    const updated = [...additionalCharges]
    updated[index] = { ...updated[index], [field]: value }
    setAdditionalCharges(updated)
  }

  const handleQuickPay = () => {
    setBalanceSettled(true)
  }

  const handleSubmit = () => {
    if (totalDue > 0 && !balanceSettled) {
      toast.error('Please settle the balance before checking out')
      return
    }

    if (!autoChecklist.key) {
      toast.error('Please confirm key return')
      return
    }

    const checkOutData: CheckOutData = {
      reservationId: departure.reservationId,
      actualCheckOut: new Date(),
      minibarCharges: minibarCharges || undefined,
      damageFees: damageFees || undefined,
      additionalCharges: additionalCharges.length > 0 ? additionalCharges : undefined,
      paymentMethod: totalDue > 0 ? paymentMethod : undefined,
      balanceSettled,
      keyReturned: autoChecklist.key,
      roomConditionCheck: autoChecklist.roomGood ? 'GOOD' : 'MINOR_DAMAGE',
      feedbackRequested: autoChecklist.feedback,
      additionalNotes: additionalNotes || undefined,
    }

    onConfirm(checkOutData)
    resetForm()
  }

  const resetForm = () => {
    setMinibarCharges(0)
    setDamageFees(0)
    setAdditionalCharges([])
    setPaymentMethod('CARD')
    setPaymentReference('')
    setBalanceSettled(false)
    setShowQR(false)
    setAutoChecklist({
      key: false,
      feedback: false,
      roomGood: false
    })
    setAdditionalNotes('')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { 
      if (!o) resetForm() 
      onOpenChange(o)
    }}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <CheckCircle className="text-amber-600" weight="duotone" size={22} />
            Check Out: {departure.guestName}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Room {departure.roomNumber} • {departure.nights} nights
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Additional Charges (Optional)</Label>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="minibar" className="text-xs">Minibar</Label>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">฿</span>
                  <Input
                    id="minibar"
                    type="number"
                    min="0"
                    value={minibarCharges || ''}
                    onChange={(e) => setMinibarCharges(Number(e.target.value))}
                    className="pl-6 h-8 text-sm"
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="damage" className="text-xs">Damage</Label>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">฿</span>
                  <Input
                    id="damage"
                    type="number"
                    min="0"
                    value={damageFees || ''}
                    onChange={(e) => setDamageFees(Number(e.target.value))}
                    className="pl-6 h-8 text-sm"
                    placeholder="0"
                  />
                </div>
              </div>
            </div>

            {additionalCharges.map((charge, index) => (
              <div key={index} className="flex gap-1.5">
                <Input
                  placeholder="Description"
                  value={charge.description}
                  onChange={(e) => handleChargeChange(index, 'description', e.target.value)}
                  className="flex-1 h-8 text-sm"
                />
                <div className="relative w-24">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">฿</span>
                  <Input
                    type="number"
                    min="0"
                    value={charge.amount || ''}
                    onChange={(e) => handleChargeChange(index, 'amount', Number(e.target.value))}
                    className="pl-6 h-8 text-sm"
                    placeholder="0"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveCharge(index)}
                  className="h-8 w-8 p-0 text-rose-600"
                >
                  <Trash size={14} />
                </Button>
              </div>
            ))}

            <Button
              variant="outline"
              size="sm"
              onClick={handleAddCharge}
              className="w-full h-7 text-xs"
            >
              <Plus size={12} weight="bold" className="mr-1" />
              Add Charge
            </Button>
          </div>

          {totalAdditional > 0 && (
            <Card className="p-2 bg-blue-50 border-blue-200">
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium">Extra Charges:</span>
                <span className="font-bold text-blue-900">฿{totalAdditional.toLocaleString()}</span>
              </div>
            </Card>
          )}

          <div className="border-t pt-2">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-semibold">Total Amount:</span>
              <span className="text-xl font-bold">฿{finalTotal.toLocaleString()}</span>
            </div>
            
            {totalDue > 0 ? (
              <Card className="p-2 bg-rose-50 border-rose-200 mb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <CurrencyDollar className="text-rose-600" size={16} weight="bold" />
                    <span className="text-sm font-semibold text-rose-900">Balance Due:</span>
                  </div>
                  <span className="text-lg font-bold text-rose-900">฿{totalDue.toLocaleString()}</span>
                </div>
              </Card>
            ) : (
              <Card className="p-2 bg-green-50 border-green-200 mb-2">
                <div className="flex items-center gap-1.5 text-sm text-green-700">
                  <CheckCircle size={14} weight="bold" />
                  <span>Fully paid</span>
                </div>
              </Card>
            )}
          </div>

          {totalDue > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Payment Method</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleQuickPay}
                  className="h-6 px-2 text-xs text-green-600 hover:text-green-700"
                >
                  <CheckCircle size={12} weight="bold" className="mr-1" />
                  Mark as Paid
                </Button>
              </div>
              
              {!balanceSettled && (
                <>
                  <RadioGroup 
                    value={paymentMethod} 
                    onValueChange={(v) => {
                      setPaymentMethod(v as typeof paymentMethod)
                      if (v === 'PROMPTPAY') {
                        setShowQR(true)
                      } else {
                        setShowQR(false)
                      }
                    }}
                  >
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="flex items-center space-x-1.5 border rounded-md p-1.5 hover:bg-slate-50 cursor-pointer">
                        <RadioGroupItem value="CASH" id="co-cash" />
                        <Label htmlFor="co-cash" className="cursor-pointer text-xs flex-1">Cash</Label>
                      </div>
                      <div className="flex items-center space-x-1.5 border rounded-md p-1.5 hover:bg-slate-50 cursor-pointer">
                        <RadioGroupItem value="CARD" id="co-card" />
                        <Label htmlFor="co-card" className="cursor-pointer text-xs flex-1">Card</Label>
                      </div>
                      <div className="flex items-center space-x-1.5 border rounded-md p-1.5 hover:bg-blue-50 bg-blue-50/30 border-blue-300 cursor-pointer">
                        <RadioGroupItem value="PROMPTPAY" id="co-promptpay" />
                        <Label htmlFor="co-promptpay" className="cursor-pointer text-xs flex-1 font-semibold text-blue-700">
                          <QrCode size={12} className="inline mr-0.5" weight="bold" />
                          QR
                        </Label>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="flex items-center space-x-1.5 border rounded-md p-1.5 hover:bg-slate-50 cursor-pointer">
                        <RadioGroupItem value="TRANSFER" id="co-transfer" />
                        <Label htmlFor="co-transfer" className="cursor-pointer text-xs flex-1">Transfer</Label>
                      </div>
                      <div className="flex items-center space-x-1.5 border rounded-md p-1.5 hover:bg-slate-50 cursor-pointer">
                        <RadioGroupItem value="OTHER" id="co-other" />
                        <Label htmlFor="co-other" className="cursor-pointer text-xs flex-1">Other</Label>
                      </div>
                    </div>
                  </RadioGroup>

                  {paymentMethod === 'PROMPTPAY' && showQR && (
                    <PromptPayQR 
                      amount={totalDue}
                      onConfirm={(ref) => {
                        setPaymentReference(ref)
                        setBalanceSettled(true)
                        setShowQR(false)
                      }}
                      onCancel={() => setShowQR(false)}
                    />
                  )}

                  {paymentMethod !== 'PROMPTPAY' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="co-reference" className="text-xs">Reference (Optional)</Label>
                      <Input
                        id="co-reference"
                        placeholder="Transaction reference"
                        value={paymentReference}
                        onChange={(e) => setPaymentReference(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                  )}
                </>
              )}

              {balanceSettled && (
                <Card className="p-2 bg-green-50 border-green-200">
                  <div className="flex items-center gap-1.5 text-sm text-green-700">
                    <CheckCircle size={14} weight="bold" />
                    <span className="font-medium">Payment confirmed</span>
                    {paymentReference && <span className="text-xs">({paymentReference})</span>}
                  </div>
                </Card>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs font-semibold">Quick Checklist</Label>
            <div className="grid grid-cols-1 gap-2 text-xs">
              <div className="flex items-center gap-2 p-2 bg-slate-50 rounded border">
                <Checkbox 
                  id="co-key" 
                  checked={autoChecklist.key}
                  onCheckedChange={(checked) => setAutoChecklist(prev => ({ ...prev, key: checked as boolean }))}
                />
                <label htmlFor="co-key" className="cursor-pointer flex-1 font-medium">
                  Room key returned
                </label>
              </div>
              <div className="flex items-center gap-2 p-2 bg-slate-50 rounded border">
                <Checkbox 
                  id="co-feedback" 
                  checked={autoChecklist.feedback}
                  onCheckedChange={(checked) => setAutoChecklist(prev => ({ ...prev, feedback: checked as boolean }))}
                />
                <label htmlFor="co-feedback" className="cursor-pointer flex-1 font-medium">
                  Feedback requested
                </label>
              </div>
              <div className="flex items-center gap-2 p-2 bg-slate-50 rounded border">
                <Checkbox 
                  id="co-room" 
                  checked={autoChecklist.roomGood}
                  onCheckedChange={(checked) => setAutoChecklist(prev => ({ ...prev, roomGood: checked as boolean }))}
                />
                <label htmlFor="co-room" className="cursor-pointer flex-1 font-medium">
                  Room in good condition
                </label>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="co-notes" className="text-xs">Notes (Optional)</Label>
            <Textarea
              id="co-notes"
              placeholder="Damage details or special observations..."
              value={additionalNotes}
              onChange={(e) => setAdditionalNotes(e.target.value)}
              rows={2}
              className="text-sm resize-none"
            />
          </div>

          {!allChecksComplete && (
            <div className="flex items-start gap-1.5 p-2 bg-amber-50 border border-amber-200 rounded-md">
              <Warning className="text-amber-600 flex-shrink-0 mt-0.5" size={14} weight="bold" />
              <div className="text-xs text-amber-800">
                <p className="font-medium">Complete required items:</p>
                <ul className="mt-0.5 space-y-0.5">
                  {totalDue > 0 && !balanceSettled && <li>• Settle payment</li>}
                  {!autoChecklist.key && <li>• Confirm key return</li>}
                  {!autoChecklist.feedback && <li>• Request feedback</li>}
                </ul>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button 
            variant="outline" 
            onClick={() => {
              resetForm()
              onOpenChange(false)
            }}
            className="h-9"
          >
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={!allChecksComplete}
            className={cn(
              "h-9",
              allChecksComplete ? "bg-amber-600 hover:bg-amber-700" : ""
            )}
          >
            <CheckCircle className="mr-1.5" size={16} weight="bold" />
            Complete Check-Out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
