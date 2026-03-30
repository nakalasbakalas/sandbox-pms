import { useState, useEffect } from 'react'
import { useKV } from '@github/spark/hooks'
import type { PropertySetup, TaxConfiguration, TaxRate } from '@/types/onboarding'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Plus, Trash, Receipt, Percent } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { getDefaultTaxConfiguration } from '@/lib/tax-calculator'

export function TaxSettings() {
  const [propertyData, setPropertyData] = useKV<PropertySetup>('onboarding-property', {} as PropertySetup)
  const [taxConfig, setTaxConfig] = useState<TaxConfiguration>(() => 
    propertyData?.taxConfiguration || getDefaultTaxConfiguration()
  )

  useEffect(() => {
    if (propertyData?.taxConfiguration) {
      setTaxConfig(propertyData.taxConfiguration)
    }
  }, [propertyData])

  const handleToggleTax = (enabled: boolean) => {
    setTaxConfig(prev => ({ ...prev, enabled }))
  }

  const handleTogglePricesIncludeTax = (pricesIncludeTax: boolean) => {
    setTaxConfig(prev => ({ ...prev, pricesIncludeTax }))
  }

  const handleAddTax = () => {
    const newTax: TaxRate = {
      id: `tax_${Date.now()}`,
      name: 'New Tax',
      rate: 0,
      appliesTo: 'ALL',
      included: taxConfig.pricesIncludeTax
    }
    setTaxConfig(prev => ({
      ...prev,
      taxes: [...prev.taxes, newTax]
    }))
  }

  const handleRemoveTax = (id: string) => {
    setTaxConfig(prev => ({
      ...prev,
      taxes: prev.taxes.filter(t => t.id !== id)
    }))
  }

  const handleUpdateTax = (id: string, updates: Partial<TaxRate>) => {
    setTaxConfig(prev => ({
      ...prev,
      taxes: prev.taxes.map(t => t.id === id ? { ...t, ...updates } : t)
    }))
  }

  const handleSave = () => {
    setPropertyData(prev => ({
      ...prev,
      taxConfiguration: taxConfig
    }))
    toast.success('Tax settings saved successfully')
  }

  const handleReset = () => {
    const defaultConfig = getDefaultTaxConfiguration()
    setTaxConfig(defaultConfig)
    setPropertyData(prev => ({
      ...prev,
      taxConfiguration: defaultConfig
    }))
    toast.success('Tax settings reset to Thailand defaults')
  }

  const totalTaxRate = taxConfig.taxes.reduce((sum, tax) => sum + tax.rate, 0)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Receipt className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle>Tax Configuration</CardTitle>
              <CardDescription>Configure automatic tax calculation for receipts and invoices</CardDescription>
            </div>
          </div>
          <Button variant="outline" onClick={handleReset} size="sm">
            Reset to Defaults
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
          <div className="space-y-1">
            <Label className="text-base font-semibold">Enable Tax Calculation</Label>
            <p className="text-sm text-muted-foreground">
              Automatically calculate and display taxes on receipts
            </p>
          </div>
          <Switch
            checked={taxConfig.enabled}
            onCheckedChange={handleToggleTax}
          />
        </div>

        {taxConfig.enabled && (
          <>
            <Separator />

            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
              <div className="space-y-1">
                <Label className="text-base font-semibold">Prices Include Tax</Label>
                <p className="text-sm text-muted-foreground">
                  Display prices are tax-inclusive (recommended for Thailand)
                </p>
              </div>
              <Switch
                checked={taxConfig.pricesIncludeTax}
                onCheckedChange={handleTogglePricesIncludeTax}
              />
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base font-semibold">Tax Rates</Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Define tax rates and what they apply to
                  </p>
                </div>
                <Button onClick={handleAddTax} size="sm" variant="outline" className="gap-2">
                  <Plus size={16} weight="bold" />
                  Add Tax
                </Button>
              </div>

              {taxConfig.taxes.length === 0 ? (
                <Card className="p-8 text-center border-dashed">
                  <Percent className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">No taxes configured</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Click "Add Tax" to configure your first tax rate
                  </p>
                </Card>
              ) : (
                <div className="space-y-3">
                  {taxConfig.taxes.map((tax) => (
                    <Card key={tax.id} className="p-4">
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Tax Name</Label>
                            <Input
                              value={tax.name}
                              onChange={(e) => handleUpdateTax(tax.id, { name: e.target.value })}
                              placeholder="e.g., VAT, Service Charge"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Rate (%)</Label>
                            <div className="relative">
                              <Input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={tax.rate}
                                onChange={(e) => handleUpdateTax(tax.id, { rate: parseFloat(e.target.value) || 0 })}
                                placeholder="0.00"
                                className="pr-8"
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                                %
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="flex-1 space-y-2">
                            <Label>Applies To</Label>
                            <Select
                              value={tax.appliesTo}
                              onValueChange={(value: TaxRate['appliesTo']) =>
                                handleUpdateTax(tax.id, { appliesTo: value })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ALL">All Charges</SelectItem>
                                <SelectItem value="ROOM">Room Charges Only</SelectItem>
                                <SelectItem value="FOOD">Food Only</SelectItem>
                                <SelectItem value="BEVERAGE">Beverage Only</SelectItem>
                                <SelectItem value="EXTRAS">Food, Beverage & Extras</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveTax(tax.id)}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10 mt-8"
                          >
                            <Trash size={18} weight="bold" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {taxConfig.taxes.length > 0 && (
                <Card className="p-4 bg-blue-50 border-blue-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-blue-900">Combined Tax Rate</p>
                      <p className="text-sm text-blue-700 mt-1">
                        {taxConfig.pricesIncludeTax
                          ? 'Prices shown include all taxes'
                          : 'Taxes added at checkout'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-bold text-blue-900">{totalTaxRate}%</p>
                    </div>
                  </div>
                </Card>
              )}
            </div>

            <Separator />

            <div className="bg-muted/30 rounded-lg p-4 space-y-2">
              <h4 className="font-semibold text-sm">Example Calculation</h4>
              <div className="text-sm space-y-1">
                {taxConfig.pricesIncludeTax ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Displayed Price:</span>
                      <span className="font-medium">฿1,000</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Base Amount:</span>
                      <span className="font-medium">
                        ฿{(1000 / (1 + totalTaxRate / 100)).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Tax ({totalTaxRate}%):</span>
                      <span className="font-medium">
                        ฿{(1000 - 1000 / (1 + totalTaxRate / 100)).toFixed(2)}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Base Amount:</span>
                      <span className="font-medium">฿1,000</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tax ({totalTaxRate}%):</span>
                      <span className="font-medium">฿{(1000 * (totalTaxRate / 100)).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-semibold">
                      <span>Total:</span>
                      <span>฿{(1000 * (1 + totalTaxRate / 100)).toFixed(2)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => setTaxConfig(propertyData?.taxConfiguration || getDefaultTaxConfiguration())}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Tax Settings
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
