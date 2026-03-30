import { useOnboarding } from '@/hooks/use-onboarding'
import { Badge } from '@/components/ui/badge'

export function RoomsStep() {
  const { state } = useOnboarding()
  
  if (!state) return null
  
  const rooms = state.data.rooms
  const roomTypes = state.data.roomTypes
  
  const twinRooms = rooms.filter(r => r.roomTypeId === 'twin')
  const doubleRooms = rooms.filter(r => r.roomTypeId === 'double')
  
  const renderRoomList = (roomList: typeof rooms, title: string) => {
    const available = roomList.filter(r => r.status === 'available')
    const outOfService = roomList.filter(r => r.status === 'out-of-service')
    
    return (
      <div>
        <h3 className="font-semibold text-lg mb-3">{title}</h3>
        <div className="flex flex-wrap gap-2">
          {available.map((room) => (
            <Badge key={room.id} variant="secondary" className="px-3 py-1">
              {room.number}
            </Badge>
          ))}
          {outOfService.map((room) => (
            <Badge key={room.id} variant="outline" className="px-3 py-1 opacity-50">
              {room.number} (OOS)
            </Badge>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {available.length} available, {outOfService.length} out of service
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Default rooms for Sandbox Hotel. Rooms 216 and 316 are marked as out of service.
      </p>

      <div className="space-y-6">
        {renderRoomList(twinRooms, 'Twin Rooms (201-216)')}
        {renderRoomList(doubleRooms, 'Double Rooms (301-316)')}
      </div>

      <div className="bg-muted/50 rounded-lg p-4 text-sm">
        <p className="font-medium mb-1">Total: {rooms.length} rooms</p>
        <p className="text-muted-foreground">
          You can modify room assignments and statuses after setup in the Settings module.
        </p>
      </div>
    </div>
  )
}
