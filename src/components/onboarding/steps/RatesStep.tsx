import { useOnboarding } from '@/hooks/use-onboarding'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

export function RatesStep() {
  const { state, updateRates } = useOnboarding()
  
  if (!state) return null
  
  const rates = state.data.rates
  const roomTypes = state.data.roomTypes

  const handleRateChange = (roomTypeId: string, field: 'baseRate' | 'weekendRate', value: string) => {
    const numValue = value === '' ? undefined : parseFloat(value)
    const updatedRates = rates.map(rate =>
      rate.roomTypeId === roomTypeId
        ? { ...rate, [field]: numValue }
        : rate
    )
    updateRates(updatedRates)
  }

  const handleTaxInclusiveChange = (roomTypeId: string, checked: boolean) => {
    const updatedRates = rates.map(rate =>
      rate.roomTypeId === roomTypeId
        ? { ...rate, taxInclusive: checked }
        : rate
    )
    updateRates(updatedRates)
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Set base rates for each room type. You can configure seasonal pricing and discounts later in the Rates module.
      </p>

      <div className="space-y-4">
        {roomTypes.map((roomType) => {
          const rate = rates.find(r => r.roomTypeId === roomType.id)
          if (!rate) return null

          return (
            <Card key={roomType.id} className="p-6">
              <h3 className="font-semibold text-lg mb-4">{roomType.name}</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor={`baseRate-${roomType.id}`}>
                    Base Rate (Weekday) *
                  </Label>
                  <div className="relative">
                    <Input
                      id={`baseRate-${roomType.id}`}
                      type="number"
                      min="0"
                      step="100"
                      value={rate.baseRate || ''}
                      onChange={(e) => handleRateChange(roomType.id, 'baseRate', e.target.value)}
                      className="pr-16"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      THB
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`weekendRate-${roomType.id}`}>
                    Weekend Rate (Fri/Sat)
                  </Label>
                  <div className="relative">
                    <Input
                      id={`weekendRate-${roomType.id}`}
                      type="number"
                      min="0"
                      step="100"
                      value={rate.weekendRate || ''}
                      onChange={(e) => handleRateChange(roomType.id, 'weekendRate', e.target.value)}
                      placeholder={`${rate.baseRate || 0}`}
                      className="pr-16"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      THB
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Leave empty to use base rate
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <div className="space-y-0.5">
                  <Label htmlFor={`taxInclusive-${roomType.id}`}>
                    Tax Inclusive Pricing
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Rates include all taxes (recommended for Thailand)
                  </p>
                </div>
                <Switch
                  id={`taxInclusive-${roomType.id}`}
                  checked={rate.taxInclusive}
                  onCheckedChange={(checked) => handleTaxInclusiveChange(roomType.id, checked)}
                />
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
