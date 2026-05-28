import { useState } from 'react'
import { useKV } from '@github/spark/hooks'
import type { PropertySetup } from '@/types/onboarding'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Image, Palette, FileText } from '@phosphor-icons/react'
import { toast } from 'sonner'

export function BrandingSettings() {
  const [propertyData] = useKV<PropertySetup>('onboarding-property', {} as PropertySetup)
  const [logoUrl, setLogoUrl] = useState(propertyData?.logoUrl || '')
  const [brandColor, setBrandColor] = useState(propertyData?.brandColor || '#000000')
  const [receiptFooter, setReceiptFooter] = useState(propertyData?.receiptFooter || 'Thank you for staying with us!\nWe hope to see you again soon.')
  const [, setProperty] = useKV<PropertySetup>('onboarding-property', {} as PropertySetup)

  const handleSave = () => {
    setProperty((current) => ({
      ...(current || propertyData),
      logoUrl,
      brandColor,
      receiptFooter,
    } as PropertySetup))
    toast.success('Branding settings saved')
  }

  const handleReset = () => {
    setLogoUrl(propertyData?.logoUrl || '')
    setBrandColor(propertyData?.brandColor || '#000000')
    setReceiptFooter(propertyData?.receiptFooter || 'Thank you for staying with us!\nWe hope to see you again soon.')
    toast.info('Changes discarded')
  }

  const hasChanges = 
    logoUrl !== (propertyData?.logoUrl || '') ||
    brandColor !== (propertyData?.brandColor || '#000000') ||
    receiptFooter !== (propertyData?.receiptFooter || 'Thank you for staying with us!\nWe hope to see you again soon.')

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Image weight="duotone" size={24} />
            Hotel Logo
          </CardTitle>
          <CardDescription>
            Upload or link to your hotel's logo. This will appear on receipts and invoices.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="logo-url">Logo URL</Label>
            <Input
              id="logo-url"
              type="url"
              placeholder="https://sandboxhotel.co.th/logo.png"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Provide a direct link to your logo image. Recommended size: 200x80px
            </p>
          </div>

          {logoUrl && (
            <div className="border rounded-lg p-4 bg-muted/20">
              <p className="text-sm font-medium mb-2">Preview:</p>
              <img 
                src={logoUrl} 
                alt="Hotel logo preview" 
                className="max-h-20 object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                  toast.error('Failed to load logo image')
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette weight="duotone" size={24} />
            Brand Color
          </CardTitle>
          <CardDescription>
            Choose a primary brand color for your receipts and documents.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="brand-color">Primary Brand Color</Label>
            <div className="flex gap-3 items-center">
              <Input
                id="brand-color"
                type="color"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="w-20 h-10 cursor-pointer"
              />
              <Input
                type="text"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                placeholder="#000000"
                className="flex-1 font-mono"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              This color will be used for headers and accents on receipts
            </p>
          </div>

          <div className="border rounded-lg p-4 bg-muted/20">
            <p className="text-sm font-medium mb-2">Preview:</p>
            <div 
              className="h-12 rounded border"
              style={{ backgroundColor: brandColor }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText weight="duotone" size={24} />
            Receipt Footer
          </CardTitle>
          <CardDescription>
            Customize the message that appears at the bottom of receipts and invoices.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="receipt-footer">Footer Message</Label>
            <Textarea
              id="receipt-footer"
              value={receiptFooter}
              onChange={(e) => setReceiptFooter(e.target.value)}
              placeholder="Thank you for staying with us!"
              rows={4}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Add a personal touch to your receipts. Line breaks are supported.
            </p>
          </div>
        </CardContent>
      </Card>

      {hasChanges && (
        <div className="flex justify-end gap-3 sticky bottom-6 bg-background/80 backdrop-blur-sm border rounded-lg p-4">
          <Button variant="outline" onClick={handleReset}>
            Discard Changes
          </Button>
          <Button onClick={handleSave}>
            Save Branding Settings
          </Button>
        </div>
      )}
    </div>
  )
}
