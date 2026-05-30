import { useOnboarding } from '@/hooks/use-onboarding'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { RoomTypeSetup } from '@/types/onboarding'

function toNumber(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function RoomTypesStep() {
  const { state, updateRoomTypes } = useOnboarding()

  if (!state) return null

  const roomTypes = state.data.roomTypes

  const updateRoomType = (id: string, updates: Partial<RoomTypeSetup>) => {
    updateRoomTypes(roomTypes.map((roomType) =>
      roomType.id === id ? { ...roomType, ...updates } : roomType,
    ))
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Confirm the room categories your property sells. These values drive setup rates and room inventory.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {roomTypes.map((roomType) => (
          <Card key={roomType.id} className="p-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`room-type-name-${roomType.id}`}>Room Type Name</Label>
              <Input
                id={`room-type-name-${roomType.id}`}
                value={roomType.name}
                onChange={(event) => updateRoomType(roomType.id, { name: event.target.value })}
                placeholder="Standard Twin"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor={`base-occ-${roomType.id}`}>Base Occupancy</Label>
                <Input
                  id={`base-occ-${roomType.id}`}
                  type="number"
                  min={1}
                  value={roomType.baseOccupancy}
                  onChange={(event) => updateRoomType(roomType.id, { baseOccupancy: toNumber(event.target.value, roomType.baseOccupancy) })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`max-occ-${roomType.id}`}>Max Occupancy</Label>
                <Input
                  id={`max-occ-${roomType.id}`}
                  type="number"
                  min={1}
                  value={roomType.maxOccupancy}
                  onChange={(event) => updateRoomType(roomType.id, { maxOccupancy: toNumber(event.target.value, roomType.maxOccupancy) })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor={`extra-fee-${roomType.id}`}>Extra Guest Fee</Label>
                <Input
                  id={`extra-fee-${roomType.id}`}
                  type="number"
                  min={0}
                  value={roomType.extraGuestFee}
                  onChange={(event) => updateRoomType(roomType.id, { extraGuestFee: toNumber(event.target.value, roomType.extraGuestFee) })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`child-fee-${roomType.id}`}>Child Fee</Label>
                <Input
                  id={`child-fee-${roomType.id}`}
                  type="number"
                  min={0}
                  value={roomType.childFee}
                  onChange={(event) => updateRoomType(roomType.id, { childFee: toNumber(event.target.value, roomType.childFee) })}
                />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
