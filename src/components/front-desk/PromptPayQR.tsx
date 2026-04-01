import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QrCode, CheckCircle, X, Copy, Check, Warning } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { generatePromptPayQR, formatPromptPayPhone } from '@/lib/promptpay'

interface PromptPayQRProps {
  amount: number
  onConfirm: (reference: string) => void
  onCancel: () => void
  promptPayId?: string
}

export function PromptPayQR({ amount, onConfirm, onCancel, promptPayId = '0812345678' }: PromptPayQRProps) {
  const [reference, setReference] = useState('')
  const [copied, setCopied] = useState(false)
  const [countdown, setCountdown] = useState(300)
  const [qrDataURL, setQrDataURL] = useState<string>('')
  const [isGenerating, setIsGenerating] = useState(true)
  
  const formattedPromptPayId = formatPromptPayPhone(promptPayId)
  
  useEffect(() => {
    const generateQR = async () => {
      try {
        setIsGenerating(true)
        const qr = await generatePromptPayQR({
          identifier: formattedPromptPayId,
          amount: amount
        })
        setQrDataURL(qr)
      } catch (error) {
        console.error('Failed to generate QR code:', error)
        toast.error('Failed to generate QR code')
      } finally {
        setIsGenerating(false)
      }
    }
    
    generateQR()
  }, [amount, formattedPromptPayId])
  
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    
    return () => clearInterval(timer)
  }, [])

  const minutes = Math.floor(countdown / 60)
  const seconds = countdown % 60

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedPromptPayId)
      setCopied(true)
      toast.success('PromptPay ID copied')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Failed to copy')
    }
  }

  const handleConfirm = () => {
    if (!reference.trim()) {
      toast.error('Please enter transaction reference')
      return
    }
    onConfirm(reference)
  }

  return (
    <Card className="p-4 bg-blue-50 border-2 border-blue-300">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <QrCode className="text-blue-600" size={20} weight="bold" />
          <h3 className="font-semibold text-sm">PromptPay QR Payment</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-7 w-7 p-0"
        >
          <X size={16} />
        </Button>
      </div>

      <div className="bg-white rounded-lg p-4 mb-3">
        <div className="aspect-square bg-slate-100 rounded-lg flex items-center justify-center mb-3 overflow-hidden relative">
          {isGenerating ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-muted-foreground">Generating QR...</span>
            </div>
          ) : qrDataURL ? (
            <img 
              src={qrDataURL} 
              alt="PromptPay QR Code" 
              className="w-full h-full object-contain p-4"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-center p-4">
              <Warning size={32} className="text-amber-500" weight="bold" />
              <span className="text-xs text-muted-foreground">Failed to generate QR code</span>
            </div>
          )}
        </div>
        
        <div className="text-center space-y-1 mb-3">
          <div className="text-2xl font-bold text-blue-900">฿{amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="text-xs text-muted-foreground">Amount to Pay</div>
        </div>

        <div className="bg-slate-50 rounded-md p-2 mb-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1">
              <div className="text-xs text-muted-foreground">PromptPay ID</div>
              <div className="font-mono font-semibold text-sm">{formattedPromptPayId}</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-8 px-2"
            >
              {copied ? (
                <Check size={16} className="text-green-600" weight="bold" />
              ) : (
                <Copy size={16} />
              )}
            </Button>
          </div>
        </div>

        <div className={cn(
          "text-xs text-center font-medium",
          countdown < 60 ? "text-rose-600" : "text-muted-foreground"
        )}>
          QR expires in {minutes}:{seconds.toString().padStart(2, '0')}
        </div>
      </div>

      <div className="space-y-2 mb-3">
        <Label htmlFor="qr-reference" className="text-xs">Transaction Reference *</Label>
        <Input
          id="qr-reference"
          placeholder="Enter reference from banking app"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          className="h-8 text-sm"
        />
        <p className="text-xs text-muted-foreground">
          After scanning and completing payment, enter the transaction reference here
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={onCancel}
          className="flex-1 h-9 text-sm"
        >
          Cancel
        </Button>
        <Button
          onClick={handleConfirm}
          className="flex-1 h-9 text-sm bg-blue-600 hover:bg-blue-700"
        >
          <CheckCircle className="mr-1.5" size={16} weight="bold" />
          Confirm Payment
        </Button>
      </div>

      <div className="mt-3 p-2 bg-blue-100 rounded-md">
        <p className="text-xs text-blue-800">
          <strong>Instructions:</strong> Open your Thai banking app (e.g., SCB Easy, Krungthai NEXT, Bangkok Bank Mobile), select PromptPay/QR Payment, scan the QR code above, verify the amount (฿{amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}), complete the payment, and enter the transaction reference below.
        </p>
      </div>
    </Card>
  )
}
