import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { CurrencyDollar, CheckCircle, Warning, QrCode } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { PromptPayQR } from './PromptPayQR'
import { useKV } from '@github/spark/hooks'

export interface PaymentData {
  method: 'CASH' | 'CARD' | 'TRANSFER' | 'PROMPTPAY' | 'OTHER'
  amount: number
  reference?: string
  confirmed: boolean
}

interface PaymentCollectionProps {
  data: PaymentData
  onChange: (data: PaymentData) => void
  amountDue: number
  label?: string
  required?: boolean
}

export function PaymentCollection({ 
  data, 
  onChange, 
  amountDue, 
  label = "Payment Collection",
  required = true 
}: PaymentCollectionProps) {
  const [showQR, setShowQR] = useState(false)
  const [promptPayId] = useKV('hotel-promptpay-id', '')

  const updateField = (field: keyof PaymentData, value: string | number | boolean) => {
    onChange({ ...data, [field]: value })
  }

  const handleQuickPay = () => {
    updateField('amount', amountDue)
    updateField('confirmed', true)
  }

  const isFullPayment = data.amount >= amountDue
  const hasPaymentDetails = data.method && data.amount > 0

  return (
    <Card className={cn(
      "p-3 border-2",
      amountDue > 0 ? "border-rose-200 bg-rose-50/50" : "border-green-200 bg-green-50/50"
    )}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CurrencyDollar className={amountDue > 0 ? "text-rose-600" : "text-green-600"} size={20} weight="bold" />
          <h3 className="font-semibold text-sm">{label}</h3>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Amount Due</div>
          <div className={cn(
            "text-xl font-bold",
            amountDue > 0 ? "text-rose-900" : "text-green-900"
          )}>
            ฿{amountDue.toLocaleString()}
          </div>
        </div>
      </div>

      {amountDue > 0 && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="text-xs">Payment Method {required && '*'}</Label>
            <RadioGroup 
              value={data.method} 
              onValueChange={(v) => {
                updateField('method', v as typeof data.method)
                if (v === 'PROMPTPAY' && promptPayId) {
                  setShowQR(true)
                  updateField('amount', amountDue)
                } else {
                  setShowQR(false)
                }
              }}
            >
              <div className="grid grid-cols-3 gap-1.5">
                <div className="flex items-center space-x-1.5 border rounded-md p-1.5 hover:bg-slate-50 cursor-pointer">
                  <RadioGroupItem value="CASH" id="payment-cash" />
                  <Label htmlFor="payment-cash" className="cursor-pointer text-xs flex-1">Cash</Label>
                </div>
                <div className="flex items-center space-x-1.5 border rounded-md p-1.5 hover:bg-slate-50 cursor-pointer">
                  <RadioGroupItem value="CARD" id="payment-card" />
                  <Label htmlFor="payment-card" className="cursor-pointer text-xs flex-1">Card</Label>
                </div>
                <div className="flex items-center space-x-1.5 border rounded-md p-1.5 hover:bg-blue-50 bg-blue-50/30 border-blue-300 cursor-pointer">
                  <RadioGroupItem value="PROMPTPAY" id="payment-promptpay" />
                  <Label htmlFor="payment-promptpay" className="cursor-pointer text-xs flex-1 font-semibold text-blue-700">
                    <QrCode size={14} className="inline mr-1" weight="bold" />
                    QR
                  </Label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div className="flex items-center space-x-1.5 border rounded-md p-1.5 hover:bg-slate-50 cursor-pointer">
                  <RadioGroupItem value="TRANSFER" id="payment-transfer" />
                  <Label htmlFor="payment-transfer" className="cursor-pointer text-xs flex-1">Transfer</Label>
                </div>
                <div className="flex items-center space-x-1.5 border rounded-md p-1.5 hover:bg-slate-50 cursor-pointer">
                  <RadioGroupItem value="OTHER" id="payment-other" />
                  <Label htmlFor="payment-other" className="cursor-pointer text-xs flex-1">Other</Label>
                </div>
              </div>
            </RadioGroup>
          </div>

          {data.method === 'PROMPTPAY' && !promptPayId && (
            <div className="flex items-start gap-1.5 p-2 bg-amber-50 border border-amber-200 rounded-md">
              <Warning className="text-amber-600 flex-shrink-0 mt-0.5" size={14} weight="bold" />
              <p className="text-xs text-amber-800">
                PromptPay is not configured. Add a PromptPay ID in Settings before collecting QR payments.
              </p>
            </div>
          )}

          {data.method === 'PROMPTPAY' && showQR && promptPayId && (
            <PromptPayQR 
              amount={amountDue}
              promptPayId={promptPayId}
              onConfirm={(ref) => {
                updateField('reference', ref)
                updateField('confirmed', true)
                setShowQR(false)
              }}
              onCancel={() => setShowQR(false)}
            />
          )}

          {data.method !== 'PROMPTPAY' && (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="payment-amount" className="text-xs">Amount {required && '*'}</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleQuickPay}
                    className="h-6 px-2 text-xs text-blue-600 hover:text-blue-700"
                  >
                    Pay Full Amount
                  </Button>
                </div>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold text-sm">฿</span>
                  <Input
                    id="payment-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={data.amount || ''}
                    onChange={(e) => updateField('amount', Number(e.target.value))}
                    className={cn(
                      "pl-7 h-9 text-base font-semibold",
                      isFullPayment && "border-green-300 bg-green-50"
                    )}
                    placeholder="0.00"
                  />
                </div>
                {data.amount > 0 && !isFullPayment && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <Warning size={12} weight="bold" />
                    Remaining: ฿{(amountDue - data.amount).toLocaleString()}
                  </p>
                )}
                {isFullPayment && data.amount > 0 && (
                  <p className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle size={12} weight="bold" />
                    Full payment
                  </p>
                )}
              </div>

              {(data.method === 'CARD' || data.method === 'TRANSFER' || data.method === 'OTHER') && (
                <div className="space-y-1.5">
                  <Label htmlFor="payment-reference" className="text-xs">
                    Reference
                    {(data.method === 'CARD' || data.method === 'TRANSFER') && ' *'}
                  </Label>
                  <Input
                    id="payment-reference"
                    className="h-8 text-sm"
                    placeholder={
                      data.method === 'CARD' ? 'Last 4 digits' :
                      data.method === 'TRANSFER' ? 'Transfer ref' :
                      'Reference'
                    }
                    value={data.reference || ''}
                    onChange={(e) => updateField('reference', e.target.value)}
                  />
                </div>
              )}

              <div className="flex items-start gap-2 pt-2 border-t">
                <Checkbox
                  id="payment-confirmed"
                  checked={data.confirmed}
                  onCheckedChange={(checked) => updateField('confirmed', checked as boolean)}
                />
                <div className="flex-1">
                  <label htmlFor="payment-confirmed" className="text-xs font-medium cursor-pointer">
                    Payment confirmed
                  </label>
                </div>
              </div>
            </>
          )}

          {hasPaymentDetails && !data.confirmed && data.method !== 'PROMPTPAY' && (
            <div className="flex items-start gap-1.5 p-2 bg-amber-50 border border-amber-200 rounded-md">
              <Warning className="text-amber-600 flex-shrink-0 mt-0.5" size={14} weight="bold" />
              <p className="text-xs text-amber-800">
                Confirm payment to proceed
              </p>
            </div>
          )}
        </div>
      )}

      {amountDue === 0 && (
        <div className="flex items-center gap-2 text-xs text-green-700">
          <CheckCircle size={16} weight="bold" />
          <span>No payment required</span>
        </div>
      )}
    </Card>
  )
}
