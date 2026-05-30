import { useOnboarding } from '@/hooks/use-onboarding'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PropertySetup } from '@/types/onboarding'

export function PropertyStep() {
  const { state, updateProperty } = useOnboarding()
  
  if (!state) return null
  
  const property = state.data.property

  const handleChange = (field: keyof PropertySetup, value: string) => {
    updateProperty({ [field]: value })
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="name">Property Name *</Label>
          <Input
            id="name"
            value={property.name}
            onChange={(e) => handleChange('name', e.target.value)}
            placeholder="Property name"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email *</Label>
          <Input
            id="email"
            type="email"
            value={property.email}
            onChange={(e) => handleChange('email', e.target.value)}
            placeholder="reservations@property.com"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Phone *</Label>
          <Input
            id="phone"
            value={property.phone}
            onChange={(e) => handleChange('phone', e.target.value)}
            placeholder="+66 2 123 4567"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="country">Country *</Label>
          <Input
            id="country"
            value={property.country}
            onChange={(e) => handleChange('country', e.target.value)}
            placeholder="Thailand"
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="address">Address</Label>
          <Input
            id="address"
            value={property.address}
            onChange={(e) => handleChange('address', e.target.value)}
            placeholder="Street address"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="city">City</Label>
          <Input
            id="city"
            value={property.city}
            onChange={(e) => handleChange('city', e.target.value)}
            placeholder="Bangkok"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="website">Website</Label>
          <Input
            id="website"
            value={property.website}
            onChange={(e) => handleChange('website', e.target.value)}
            placeholder="https://property.com"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="timeZone">Time Zone *</Label>
          <Input
            id="timeZone"
            value={property.timeZone}
            onChange={(e) => handleChange('timeZone', e.target.value)}
            placeholder="Asia/Bangkok"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="currency">Currency *</Label>
          <Input
            id="currency"
            value={property.currency}
            onChange={(e) => handleChange('currency', e.target.value)}
            placeholder="THB"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="defaultCheckIn">Check-in Time *</Label>
          <Input
            id="defaultCheckIn"
            type="time"
            value={property.defaultCheckIn}
            onChange={(e) => handleChange('defaultCheckIn', e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="defaultCheckOut">Check-out Time *</Label>
          <Input
            id="defaultCheckOut"
            type="time"
            value={property.defaultCheckOut}
            onChange={(e) => handleChange('defaultCheckOut', e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
