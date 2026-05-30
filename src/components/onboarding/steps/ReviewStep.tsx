import { useOnboarding } from '@/hooks/use-onboarding'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { CheckCircle } from '@phosphor-icons/react'
import { useNavigation } from '@/hooks/use-navigation'
import { toast } from 'sonner'

export function ReviewStep() {
  const { state, completeOnboarding } = useOnboarding()
  const { navigate } = useNavigation()
  
  if (!state) return null
  
  const { property, roomTypes, rooms, rates, adminUser } = state.data
  
  const availableRooms = rooms.filter(r => r.status === 'available').length
  const outOfServiceRooms = rooms.filter(r => r.status === 'out-of-service').length

  const handleComplete = async () => {
    try {
      await completeOnboarding()
      toast.success('Setup complete. Sign in with the admin account.')
      navigate('today')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to complete setup. Please try again.')
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-muted/50 rounded-lg p-4 flex items-start gap-3">
        <CheckCircle className="h-5 w-5 text-primary mt-0.5" weight="fill" />
        <div>
          <p className="font-medium">Ready to Save Setup</p>
          <p className="text-sm text-muted-foreground">
            Review the setup below. Operational ledgers will start empty.
          </p>
        </div>
      </div>

      <Card className="p-6">
        <h3 className="font-semibold text-lg mb-4">Property Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Name</p>
            <p className="font-medium">{property.name}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Email</p>
            <p className="font-medium">{property.email}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Phone</p>
            <p className="font-medium">{property.phone}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Country</p>
            <p className="font-medium">{property.country}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Time Zone</p>
            <p className="font-medium">{property.timeZone}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Currency</p>
            <p className="font-medium">{property.currency}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Check-in</p>
            <p className="font-medium">{property.defaultCheckIn}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Check-out</p>
            <p className="font-medium">{property.defaultCheckOut}</p>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold text-lg mb-4">Room Types & Rates</h3>
        <div className="space-y-4">
          {roomTypes.map((roomType) => {
            const rate = rates.find(r => r.roomTypeId === roomType.id)
            return (
              <div key={roomType.id}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium">{roomType.name}</h4>
                  <Badge variant="secondary">
                    {rate?.baseRate?.toLocaleString()} {property.currency}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground">
                  <div>Occupancy: {roomType.baseOccupancy}-{roomType.maxOccupancy}</div>
                  <div>Extra: {roomType.extraGuestFee} {property.currency}</div>
                  <div>Child 0-{roomType.childFreeAge}: Free</div>
                  <div>Child 6-{roomType.childFeeAge}: {roomType.childFee} {property.currency}</div>
                </div>
                {rate?.weekendRate && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Weekend: {rate.weekendRate.toLocaleString()} {property.currency}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold text-lg mb-4">Rooms</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
          <div className="p-4 bg-muted/50 rounded-lg">
            <p className="text-3xl font-bold">{rooms.length}</p>
            <p className="text-sm text-muted-foreground">Total Rooms</p>
          </div>
          <div className="p-4 bg-primary/10 rounded-lg">
            <p className="text-3xl font-bold text-primary">{availableRooms}</p>
            <p className="text-sm text-muted-foreground">Available</p>
          </div>
          <div className="p-4 bg-muted/50 rounded-lg">
            <p className="text-3xl font-bold">{outOfServiceRooms}</p>
            <p className="text-sm text-muted-foreground">Out of Service</p>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold text-lg mb-4">Admin User</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Name</span>
            <span className="font-medium">{adminUser.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium">{adminUser.email}</span>
          </div>
          {adminUser.phone && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Phone</span>
              <span className="font-medium">{adminUser.phone}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Role</span>
            <Badge>Admin</Badge>
          </div>
        </div>
      </Card>

      <Separator />

      <div className="flex justify-center">
        <Button size="lg" onClick={handleComplete} className="px-8">
          Complete Setup
        </Button>
      </div>
    </div>
  )
}
