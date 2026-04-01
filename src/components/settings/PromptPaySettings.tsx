import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useKV } from '@github/spark/hooks'
import { QrCode, CheckCircle, Warning, Info } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { validatePromptPayPhone, formatPromptPayPhone, generatePromptPayQR } from '@/lib/promptpay'

export function PromptPaySettings() {
  const [promptPayId, setPromptPayId] = useKV('hotel-promptpay-id', '')
  const [inputValue, setInputValue] = useState('')
  const [isValid, setIsValid] = useState(false)
  const [testAmount] = useState(100)
  const [testQR, setTestQR] = useState<string>('')
  const [isTesting, setIsTesting] = useState(false)

  useEffect(() => {
    setInputValue(promptPayId)
  }, [promptPayId])

  useEffect(() => {
    if (inputValue) {
      const valid = validatePromptPayPhone(inputValue)
      setIsValid(valid)
    } else {
      setIsValid(false)
    }
  }, [inputValue])

  const handleSave = () => {
    if (!isValid) {
      toast.error('Please enter a valid Thai phone number')
      return
    }

    const formatted = formatPromptPayPhone(inputValue)
    setPromptPayId(formatted)
    toast.success('PromptPay ID saved successfully')
  }

  const handleTestQR = async () => {
    if (!promptPayId) {
      toast.error('Please save a PromptPay ID first')
      return
    }

    try {
      setIsTesting(true)
      const qr = await generatePromptPayQR({
        identifier: promptPayId,
        amount: testAmount
      })
      setTestQR(qr)
      toast.success('Test QR code generated')
    } catch (error) {
      console.error('Failed to generate test QR:', error)
      toast.error('Failed to generate test QR code')
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <QrCode size={20} weight="bold" className="text-blue-600" />
          <CardTitle>PromptPay Settings</CardTitle>
        </div>
        <CardDescription>
          Configure PromptPay for QR code payments (Thai banking)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="promptpay-id">PromptPay Phone Number</Label>
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                id="promptpay-id"
                placeholder="0812345678 or +66812345678"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className={inputValue && !isValid ? 'border-rose-500' : ''}
              />
            </div>
            <Button
              onClick={handleSave}
              disabled={!isValid || inputValue === promptPayId}
            >
              <CheckCircle size={16} weight="bold" className="mr-2" />
              Save
            </Button>
          </div>
          
          {inputValue && !isValid && (
            <Alert variant="destructive" className="py-2">
              <Warning size={16} weight="bold" />
              <AlertDescription className="text-xs">
                Invalid phone number. Must be a Thai mobile number (e.g., 081-234-5678 or +66 81 234 5678)
              </AlertDescription>
            </Alert>
          )}

          {isValid && (
            <Alert className="py-2 bg-green-50 border-green-200">
              <CheckCircle size={16} weight="bold" className="text-green-600" />
              <AlertDescription className="text-xs text-green-800">
                Valid PromptPay phone number: {formatPromptPayPhone(inputValue)}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <Alert className="bg-blue-50 border-blue-200">
          <Info size={16} weight="bold" className="text-blue-600" />
          <AlertDescription className="text-xs text-blue-800">
            <strong>About PromptPay:</strong> PromptPay is Thailand's national QR payment system. 
            Customers can scan the QR code with any Thai banking app and pay instantly. 
            Enter your registered PromptPay phone number (must be registered with a Thai bank).
          </AlertDescription>
        </Alert>

        {promptPayId && (
          <div className="pt-4 border-t space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Test QR Code</h4>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestQR}
                disabled={isTesting}
              >
                {isTesting ? 'Generating...' : 'Generate Test QR'}
              </Button>
            </div>

            {testQR && (
              <div className="bg-slate-50 rounded-lg p-4">
                <div className="max-w-[200px] mx-auto mb-2">
                  <img src={testQR} alt="Test QR Code" className="w-full h-auto" />
                </div>
                <div className="text-center">
                  <div className="text-sm text-muted-foreground">Test Amount</div>
                  <div className="text-xl font-bold">฿{testAmount.toFixed(2)}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Scan with your banking app to verify
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="pt-4 border-t">
          <h4 className="text-sm font-semibold mb-2">Supported Banks</h4>
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div>• Siam Commercial Bank (SCB)</div>
            <div>• Krungthai Bank (KTB)</div>
            <div>• Bangkok Bank (BBL)</div>
            <div>• Kasikorn Bank (KBANK)</div>
            <div>• Krungsri Bank (BAY)</div>
            <div>• TMB Thanachart Bank</div>
            <div>• All Thai banks with PromptPay</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
