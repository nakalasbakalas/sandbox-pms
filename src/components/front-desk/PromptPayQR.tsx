import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QrCode, CheckCircle, X, Copy, Check } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface PromptPayQRProps {
  amount: number
  onConfirm: (reference: string) => void
  onCancel: () => void
}

function generatePromptPayQR(phoneNumber: string, amount: number): string {
  const payload = `00020101021129370016A000000677010111${phoneNumber.padStart(13, '0')}5802TH5303764${String(amount).padStart(13, '0')}`
  return `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
      <rect width="200" height="200" fill="white"/>
      <text x="100" y="100" text-anchor="middle" font-family="monospace" font-size="8" fill="black">
        ${payload}
      </text>
      <text x="100" y="120" text-anchor="middle" font-family="sans-serif" font-size="10" fill="black">
        Scan with Banking App
      </text>
      <text x="100" y="135" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="bold" fill="black">
        ฿${amount.toLocaleString()}
      </text>
    </svg>
  `)}`
}

export function PromptPayQR({ amount, onConfirm, onCancel }: PromptPayQRProps) {
  const [reference, setReference] = useState('')
  const [copied, setCopied] = useState(false)
  const [countdown, setCountdown] = useState(300)
  
  const promptPayNumber = '0812345678'
  const qrData = generatePromptPayQR(promptPayNumber, amount)
  
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
      await navigator.clipboard.writeText(promptPayNumber)
      setCopied(true)
      toast.success('Phone number copied')
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
        <div className="aspect-square bg-slate-100 rounded-lg flex items-center justify-center mb-3 overflow-hidden">
          <img 
            src={qrData} 
            alt="PromptPay QR Code" 
            className="w-full h-full object-contain"
          />
        </div>
        
        <div className="text-center space-y-1 mb-3">
          <div className="text-2xl font-bold text-blue-900">฿{amount.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Amount to Pay</div>
        </div>

        <div className="bg-slate-50 rounded-md p-2 mb-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1">
              <div className="text-xs text-muted-foreground">PromptPay ID</div>
              <div className="font-mono font-semibold text-sm">{promptPayNumber}</div>
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
          <strong>Instructions:</strong> Open your Thai banking app, scan the QR code above, verify the amount, and complete the payment. Then enter the transaction reference to confirm.
        </p>
      </div>
    </Card>
  )
}
