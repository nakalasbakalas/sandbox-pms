import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useKV } from '@github/spark/hooks'
import { Buildings, Clock, MapPin, Phone, EnvelopeSimple, Globe, IdentificationCard, Palette } from '@phosphor-icons/react'
import { toast } from 'sonner'
import type { PropertySetup, RoomTypeSetup, RoomSetup } from '@/types/onboarding'
import { Separator } from '@/components/ui/separator'

export function PropertySettings() {
  const [propertyData, setPropertyData] = useKV<PropertySetup>('onboarding-property', {
    name: 'SANDBOX HOTEL',
    address: '626/1 Karom Rd., Pho Sadet',
    city: 'Mueang, Nakhon Si Thammarat 80000',
    country: 'Thailand',
    phone: '+66 88-578-3478',
    email: 'booking@sandboxhotel.com',
    website: 'https://www.sandboxhotel.com',
    taxId: '',
    timeZone: 'Asia/Bangkok',
    currency: 'THB',
    defaultCheckIn: '14:00',
    defaultCheckOut: '12:00',
    logoUrl: '',
    brandColor: '#B87333',
    receiptFooter: '',
  })

  const [roomTypes, setRoomTypes] = useKV<RoomTypeSetup[]>('onboarding-room-types', [])
  const [rooms, setRooms] = useKV<RoomSetup[]>('onboarding-rooms', [])

  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState<PropertySetup>(propertyData)

  const handleSave = () => {
    setPropertyData(formData)
    setIsEditing(false)
    toast.success('Property settings saved successfully')
  }

  const handleCancel = () => {
    setFormData(propertyData)
    setIsEditing(false)
  }

  const timeZones = [
    'Asia/Bangkok',
    'Asia/Singapore',
    'Asia/Hong_Kong',
    'Asia/Tokyo',
    'Asia/Seoul',
    'Asia/Shanghai',
    'UTC',
  ]

  const currencies = [
    { code: 'THB', name: 'Thai Baht (฿)' },
    { code: 'USD', name: 'US Dollar ($)' },
    { code: 'EUR', name: 'Euro (€)' },
    { code: 'GBP', name: 'British Pound (£)' },
    { code: 'SGD', name: 'Singapore Dollar (S$)' },
    { code: 'JPY', name: 'Japanese Yen (¥)' },
  ]

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Buildings className="text-primary" weight="duotone" />
                Property Information
              </CardTitle>
              <CardDescription>
                Basic information about your property
              </CardDescription>
            </div>
            {!isEditing ? (
              <Button onClick={() => setIsEditing(true)}>Edit Property</Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleCancel}>Cancel</Button>
                <Button onClick={handleSave}>Save Changes</Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Property Name *</Label>
              <Input
                id="name"
                value={isEditing ? formData.name : propertyData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                disabled={!isEditing}
                placeholder="Property name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="taxId">Tax ID / Registration Number</Label>
              <div className="relative">
                <IdentificationCard className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <Input
                  id="taxId"
                  className="pl-9"
                  value={isEditing ? formData.taxId : propertyData.taxId}
                  onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
                  disabled={!isEditing}
                  placeholder="e.g., 0123456789012"
                />
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <MapPin size={16} className="text-primary" />
              Location Details
            </h3>
            
            <div className="space-y-2">
              <Label htmlFor="address">Street Address</Label>
              <Input
                id="address"
                value={isEditing ? formData.address : propertyData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                disabled={!isEditing}
                placeholder="e.g., 123 Sukhumvit Road"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">City *</Label>
                <Input
                  id="city"
                  value={isEditing ? formData.city : propertyData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  disabled={!isEditing}
                  placeholder="e.g., Bangkok"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="country">Country *</Label>
                <Input
                  id="country"
                  value={isEditing ? formData.country : propertyData.country}
                  onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                  disabled={!isEditing}
                  placeholder="e.g., Thailand"
                />
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Phone size={16} className="text-primary" />
              Contact Information
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number *</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                  <Input
                    id="phone"
                    className="pl-9"
                    value={isEditing ? formData.phone : propertyData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    disabled={!isEditing}
                    placeholder="e.g., +66 2 123 4567"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email Address *</Label>
                <div className="relative">
                  <EnvelopeSimple className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                  <Input
                    id="email"
                    type="email"
                    className="pl-9"
                    value={isEditing ? formData.email : propertyData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    disabled={!isEditing}
                    placeholder="reservations@property.com"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <Input
                  id="website"
                  className="pl-9"
                  value={isEditing ? formData.website : propertyData.website}
                  onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                  disabled={!isEditing}
                  placeholder="https://property.com"
                />
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Clock size={16} className="text-primary" />
              Operating Settings
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="timezone">Time Zone *</Label>
                <Select
                  value={isEditing ? formData.timeZone : propertyData.timeZone}
                  onValueChange={(value) => setFormData({ ...formData, timeZone: value })}
                  disabled={!isEditing}
                >
                  <SelectTrigger id="timezone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {timeZones.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="currency">Currency *</Label>
                <Select
                  value={isEditing ? formData.currency : propertyData.currency}
                  onValueChange={(value) => setFormData({ ...formData, currency: value })}
                  disabled={!isEditing}
                >
                  <SelectTrigger id="currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currencies.map((curr) => (
                      <SelectItem key={curr.code} value={curr.code}>
                        {curr.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="checkIn">Default Check-In Time *</Label>
                <Input
                  id="checkIn"
                  type="time"
                  value={isEditing ? formData.defaultCheckIn : propertyData.defaultCheckIn}
                  onChange={(e) => setFormData({ ...formData, defaultCheckIn: e.target.value })}
                  disabled={!isEditing}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="checkOut">Default Check-Out Time *</Label>
                <Input
                  id="checkOut"
                  type="time"
                  value={isEditing ? formData.defaultCheckOut : propertyData.defaultCheckOut}
                  onChange={(e) => setFormData({ ...formData, defaultCheckOut: e.target.value })}
                  disabled={!isEditing}
                />
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Palette size={16} className="text-primary" />
              Branding & Receipts
            </h3>

            <div className="space-y-2">
              <Label htmlFor="brandColor">Brand Color</Label>
              <div className="flex gap-2">
                <Input
                  id="brandColor"
                  type="color"
                  value={isEditing ? formData.brandColor : propertyData.brandColor}
                  onChange={(e) => setFormData({ ...formData, brandColor: e.target.value })}
                  disabled={!isEditing}
                  className="w-20 h-10"
                />
                <Input
                  value={isEditing ? formData.brandColor : propertyData.brandColor}
                  onChange={(e) => setFormData({ ...formData, brandColor: e.target.value })}
                  disabled={!isEditing}
                  placeholder="#B87333"
                  className="flex-1"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                This color will be used in receipts and branding elements
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="receiptFooter">Receipt Footer Text</Label>
              <Textarea
                id="receiptFooter"
                value={isEditing ? formData.receiptFooter : propertyData.receiptFooter}
                onChange={(e) => setFormData({ ...formData, receiptFooter: e.target.value })}
                disabled={!isEditing}
                placeholder="e.g., Thank you for staying with us! We hope to see you again soon."
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                This text will appear at the bottom of all receipts and invoices
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Room Configuration</CardTitle>
              <CardDescription>
                Summary of your room types and rooms
              </CardDescription>
            </div>
            <Button variant="outline" onClick={() => window.location.hash = '#room-types'}>
              Manage Room Types & Rooms
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold mb-3">Room Types</h3>
              <div className="space-y-2">
                {roomTypes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No room types configured</p>
                ) : (
                  roomTypes.map((type) => (
                    <div key={type.id} className="flex items-center justify-between p-2 border rounded">
                      <span className="font-medium">{type.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {rooms.filter(r => r.roomTypeId === type.id).length} rooms
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-3">Total Rooms</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 border rounded-lg text-center">
                  <div className="text-3xl font-bold text-primary">{rooms.length}</div>
                  <div className="text-sm text-muted-foreground">Total Rooms</div>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <div className="text-3xl font-bold text-green-600">
                    {rooms.filter(r => r.status === 'available').length}
                  </div>
                  <div className="text-sm text-muted-foreground">Available</div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
