import { useState } from 'react'
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
import { CheckCircle, Warning, CurrencyDollar, Plus, Trash } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'

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
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'TRANSFER' | 'OTHER'>('CARD')
  const [balanceSettled, setBalanceSettled] = useState(false)
  const [keyReturned, setKeyReturned] = useState(false)
  const [roomConditionCheck, setRoomConditionCheck] = useState<'GOOD' | 'MINOR_DAMAGE' | 'MAJOR_DAMAGE'>('GOOD')
  const [feedbackRequested, setFeedbackRequested] = useState(false)
  const [additionalNotes, setAdditionalNotes] = useState('')

  if (!departure) return null

  const totalAdditional = minibarCharges + damageFees + 
    additionalCharges.reduce((sum, charge) => sum + charge.amount, 0)
  
  const finalTotal = departure.folioTotal + totalAdditional
  const totalDue = departure.balanceDue + totalAdditional

  const allChecksComplete = balanceSettled && keyReturned && feedbackRequested

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

  const handleSubmit = () => {
    if (totalDue > 0 && !balanceSettled) {
      toast.error('Please settle the balance before checking out')
      return
    }

    if (!keyReturned) {
      toast.error('Please confirm key return')
      return
    }

    if (roomConditionCheck === 'MAJOR_DAMAGE' && !additionalNotes) {
      toast.error('Please add notes about major damage')
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
      keyReturned,
      roomConditionCheck,
      feedbackRequested,
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
    setBalanceSettled(false)
    setKeyReturned(false)
    setRoomConditionCheck('GOOD')
    setFeedbackRequested(false)
    setAdditionalNotes('')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { 
      if (!o) resetForm() 
      onOpenChange(o)
    }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <CheckCircle className="text-amber-600" weight="duotone" size={24} />
            Check Out Guest
          </DialogTitle>
          <DialogDescription>
            Complete the check-out process for {departure.guestName} - Room {departure.roomNumber}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Guest:</span>
                <p className="font-semibold">{departure.guestName}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Room:</span>
                <p className="font-semibold">{departure.roomNumber} ({departure.roomType})</p>
              </div>
              <div>
                <span className="text-muted-foreground">Nights Stayed:</span>
                <p className="font-semibold">{departure.nights} nights</p>
              </div>
              <div>
                <span className="text-muted-foreground">Original Total:</span>
                <p className="font-semibold">฿{departure.folioTotal.toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <Label className="text-base font-semibold">Additional Charges</Label>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="minibar">Minibar Charges</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">฿</span>
                  <Input
                    id="minibar"
                    type="number"
                    min="0"
                    value={minibarCharges || ''}
                    onChange={(e) => setMinibarCharges(Number(e.target.value))}
                    className="pl-7"
                    placeholder="0"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="damage">Damage Fees</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">฿</span>
                  <Input
                    id="damage"
                    type="number"
                    min="0"
                    value={damageFees || ''}
                    onChange={(e) => setDamageFees(Number(e.target.value))}
                    className="pl-7"
                    placeholder="0"
                  />
                </div>
              </div>
            </div>

            {additionalCharges.map((charge, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  placeholder="Description"
                  value={charge.description}
                  onChange={(e) => handleChargeChange(index, 'description', e.target.value)}
                  className="flex-1"
                />
                <div className="relative w-32">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">฿</span>
                  <Input
                    type="number"
                    min="0"
                    value={charge.amount || ''}
                    onChange={(e) => handleChargeChange(index, 'amount', Number(e.target.value))}
                    className="pl-7"
                    placeholder="0"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveCharge(index)}
                  className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                >
                  <Trash size={18} />
                </Button>
              </div>
            ))}

            <Button
              variant="outline"
              size="sm"
              onClick={handleAddCharge}
              className="w-full gap-2"
            >
              <Plus size={16} weight="bold" />
              Add Charge
            </Button>
          </div>

          {totalAdditional > 0 && (
            <Card className="p-4 bg-blue-50 border-blue-200">
              <div className="flex justify-between items-center">
                <span className="font-medium">Additional Charges:</span>
                <span className="text-lg font-bold text-blue-900">฿{totalAdditional.toLocaleString()}</span>
              </div>
            </Card>
          )}

          <div className="border-t pt-4">
            <div className="flex justify-between items-center mb-4">
              <span className="text-lg font-semibold">Final Total:</span>
              <span className="text-2xl font-bold">฿{finalTotal.toLocaleString()}</span>
            </div>
            
            {totalDue > 0 && (
              <Card className="p-4 bg-rose-50 border-rose-200 mb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CurrencyDollar className="text-rose-600" size={20} weight="bold" />
                    <span className="font-semibold text-rose-900">Balance Due:</span>
                  </div>
                  <span className="text-xl font-bold text-rose-900">฿{totalDue.toLocaleString()}</span>
                </div>
              </Card>
            )}
          </div>

          {totalDue > 0 && (
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <RadioGroup value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as typeof paymentMethod)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="CARD" id="card" />
                  <Label htmlFor="card" className="cursor-pointer">Credit/Debit Card</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="CASH" id="cash" />
                  <Label htmlFor="cash" className="cursor-pointer">Cash</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="TRANSFER" id="transfer" />
                  <Label htmlFor="transfer" className="cursor-pointer">Bank Transfer</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="OTHER" id="other" />
                  <Label htmlFor="other" className="cursor-pointer">Other</Label>
                </div>
              </RadioGroup>
            </div>
          )}

          <div className="space-y-3">
            <Label className="text-base font-semibold">Check-out Checklist</Label>
            
            <div className="space-y-3 pl-1">
              {totalDue > 0 && (
                <div className="flex items-start gap-3">
                  <Checkbox 
                    id="balance-settled" 
                    checked={balanceSettled}
                    onCheckedChange={(checked) => setBalanceSettled(checked as boolean)}
                  />
                  <div className="flex-1">
                    <label htmlFor="balance-settled" className="text-sm font-medium cursor-pointer">
                      Balance settled (฿{totalDue.toLocaleString()})
                    </label>
                    <p className="text-xs text-muted-foreground">Payment collected and recorded</p>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3">
                <Checkbox 
                  id="key-returned" 
                  checked={keyReturned}
                  onCheckedChange={(checked) => setKeyReturned(checked as boolean)}
                />
                <div className="flex-1">
                  <label htmlFor="key-returned" className="text-sm font-medium cursor-pointer">
                    Room key returned
                  </label>
                  <p className="text-xs text-muted-foreground">All keys collected from guest</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Checkbox 
                  id="feedback-requested" 
                  checked={feedbackRequested}
                  onCheckedChange={(checked) => setFeedbackRequested(checked as boolean)}
                />
                <div className="flex-1">
                  <label htmlFor="feedback-requested" className="text-sm font-medium cursor-pointer">
                    Feedback requested
                  </label>
                  <p className="text-xs text-muted-foreground">Guest invited to leave review</p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Room Condition</Label>
            <RadioGroup value={roomConditionCheck} onValueChange={(v) => setRoomConditionCheck(v as typeof roomConditionCheck)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="GOOD" id="good" />
                <Label htmlFor="good" className="cursor-pointer">Good condition</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="MINOR_DAMAGE" id="minor" />
                <Label htmlFor="minor" className="cursor-pointer">Minor damage (items replaced)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="MAJOR_DAMAGE" id="major" />
                <Label htmlFor="major" className="cursor-pointer">Major damage (requires maintenance)</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="checkout-notes">Additional Notes {roomConditionCheck === 'MAJOR_DAMAGE' && '*'}</Label>
            <Textarea
              id="checkout-notes"
              placeholder="Any special notes about the check-out..."
              value={additionalNotes}
              onChange={(e) => setAdditionalNotes(e.target.value)}
              rows={3}
            />
          </div>

          {!allChecksComplete && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <Warning className="text-amber-600 flex-shrink-0 mt-0.5" size={18} weight="bold" />
              <p className="text-sm text-amber-800">
                Please complete all checklist items to proceed with check-out
              </p>
            </div>
          )}

          {totalDue > 0 && !balanceSettled && (
            <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-lg">
              <CurrencyDollar className="text-rose-600 flex-shrink-0 mt-0.5" size={18} weight="bold" />
              <p className="text-sm text-rose-800">
                Outstanding balance of ฿{totalDue.toLocaleString()} must be collected
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button 
            variant="outline" 
            onClick={() => {
              resetForm()
              onOpenChange(false)
            }}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={!allChecksComplete || (totalDue > 0 && !balanceSettled)}
            className="bg-amber-600 hover:bg-amber-700"
          >
            <CheckCircle className="mr-2" size={18} weight="bold" />
            Complete Check-Out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
