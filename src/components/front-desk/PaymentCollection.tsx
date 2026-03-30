import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { CurrencyDollar, CheckCircle, Warning } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

export interface PaymentData {
  method: 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER'
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
  const updateField = (field: keyof PaymentData, value: string | number | boolean) => {
    onChange({ ...data, [field]: value })
  }

  const isFullPayment = data.amount >= amountDue
  const hasPaymentDetails = data.method && data.amount > 0

  return (
    <Card className={cn(
      "p-4 border-2",
      amountDue > 0 ? "border-rose-200 bg-rose-50/50" : "border-green-200 bg-green-50/50"
    )}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CurrencyDollar className={amountDue > 0 ? "text-rose-600" : "text-green-600"} size={20} weight="bold" />
          <h3 className="font-semibold">{label}</h3>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Amount Due</div>
          <div className={cn(
            "text-lg font-bold",
            amountDue > 0 ? "text-rose-900" : "text-green-900"
          )}>
            ฿{amountDue.toLocaleString()}
          </div>
        </div>
      </div>

      {amountDue > 0 && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Payment Method {required && '*'}</Label>
            <RadioGroup 
              value={data.method} 
              onValueChange={(v) => updateField('method', v as typeof data.method)}
            >
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center space-x-2 border rounded-md p-2 hover:bg-slate-50">
                  <RadioGroupItem value="CARD" id="payment-card" />
                  <Label htmlFor="payment-card" className="cursor-pointer flex-1">Credit/Debit Card</Label>
                </div>
                <div className="flex items-center space-x-2 border rounded-md p-2 hover:bg-slate-50">
                  <RadioGroupItem value="CASH" id="payment-cash" />
                  <Label htmlFor="payment-cash" className="cursor-pointer flex-1">Cash</Label>
                </div>
                <div className="flex items-center space-x-2 border rounded-md p-2 hover:bg-slate-50">
                  <RadioGroupItem value="TRANSFER" id="payment-transfer" />
                  <Label htmlFor="payment-transfer" className="cursor-pointer flex-1">Bank Transfer</Label>
                </div>
                <div className="flex items-center space-x-2 border rounded-md p-2 hover:bg-slate-50">
                  <RadioGroupItem value="OTHER" id="payment-other" />
                  <Label htmlFor="payment-other" className="cursor-pointer flex-1">Other</Label>
                </div>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="payment-amount">Amount Collected {required && '*'}</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">฿</span>
              <Input
                id="payment-amount"
                type="number"
                min="0"
                step="0.01"
                value={data.amount || ''}
                onChange={(e) => updateField('amount', Number(e.target.value))}
                className={cn(
                  "pl-8 text-lg font-semibold",
                  isFullPayment && "border-green-300 bg-green-50"
                )}
                placeholder="0.00"
              />
            </div>
            {data.amount > 0 && !isFullPayment && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <Warning size={14} weight="bold" />
                Partial payment: ฿{(amountDue - data.amount).toLocaleString()} remaining
              </p>
            )}
            {isFullPayment && data.amount > 0 && (
              <p className="text-xs text-green-600 flex items-center gap-1">
                <CheckCircle size={14} weight="bold" />
                Full payment collected
              </p>
            )}
          </div>

          {(data.method === 'CARD' || data.method === 'TRANSFER' || data.method === 'OTHER') && (
            <div className="space-y-2">
              <Label htmlFor="payment-reference">
                Reference/Transaction ID
                {(data.method === 'CARD' || data.method === 'TRANSFER') && ' *'}
              </Label>
              <Input
                id="payment-reference"
                placeholder={
                  data.method === 'CARD' ? 'Last 4 digits or approval code' :
                  data.method === 'TRANSFER' ? 'Transfer reference number' :
                  'Reference'
                }
                value={data.reference || ''}
                onChange={(e) => updateField('reference', e.target.value)}
              />
            </div>
          )}

          <div className="flex items-start gap-3 pt-2 border-t">
            <Checkbox
              id="payment-confirmed"
              checked={data.confirmed}
              onCheckedChange={(checked) => updateField('confirmed', checked as boolean)}
            />
            <div className="flex-1">
              <label htmlFor="payment-confirmed" className="text-sm font-medium cursor-pointer">
                Payment confirmed and recorded
              </label>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isFullPayment ? 
                  'I confirm full payment of the balance' : 
                  'I confirm partial payment has been received'}
              </p>
            </div>
          </div>

          {hasPaymentDetails && !data.confirmed && (
            <div className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-200 rounded-md">
              <Warning className="text-amber-600 flex-shrink-0 mt-0.5" size={16} weight="bold" />
              <p className="text-xs text-amber-800">
                Please confirm payment before proceeding
              </p>
            </div>
          )}
        </div>
      )}

      {amountDue === 0 && (
        <div className="flex items-center gap-2 text-sm text-green-700">
          <CheckCircle size={18} weight="bold" />
          <span>No payment required - balance fully settled</span>
        </div>
      )}
    </Card>
  )
}
