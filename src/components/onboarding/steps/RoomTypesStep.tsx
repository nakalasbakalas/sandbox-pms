import { useOnboarding } from '@/hooks/use-onboarding'
import { Card } from '@/components/ui/card'

export function RoomTypesStep() {
  const { state } = useOnboarding()
  
  if (!state) return null
  
  const roomTypes = state.data.roomTypes

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        These are the default room types for Sandbox Hotel. You can modify them after setup.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {roomTypes.map((roomType) => (
          <Card key={roomType.id} className="p-4">
            <h3 className="font-semibold text-lg mb-3">{roomType.name}</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Base Occupancy:</span>
                <span className="font-medium">{roomType.baseOccupancy}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Max Occupancy:</span>
                <span className="font-medium">{roomType.maxOccupancy}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Extra Guest Fee:</span>
                <span className="font-medium">{roomType.extraGuestFee} THB/night</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Child 0-{roomType.childFreeAge}:</span>
                <span className="font-medium">Free</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Child 6-{roomType.childFeeAge}:</span>
                <span className="font-medium">{roomType.childFee} THB/night</span>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
