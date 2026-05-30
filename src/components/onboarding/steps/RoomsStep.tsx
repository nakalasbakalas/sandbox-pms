import { useMemo, useState } from 'react'
import { useOnboarding } from '@/hooks/use-onboarding'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { RoomSetup } from '@/types/onboarding'

function buildRoomNumbers(from: string, to: string) {
  const start = Number.parseInt(from, 10)
  const end = Number.parseInt(to, 10)
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return []

  const width = Math.max(from.trim().length, to.trim().length)
  return Array.from({ length: end - start + 1 }, (_, index) => String(start + index).padStart(width, '0'))
}

export function RoomsStep() {
  const { state, updateRooms } = useOnboarding()
  const [roomTypeId, setRoomTypeId] = useState('')
  const [fromRoom, setFromRoom] = useState('')
  const [toRoom, setToRoom] = useState('')

  const selectedRoomTypeId = roomTypeId || state?.data.roomTypes[0]?.id || ''

  const groupedRooms = useMemo(() => {
    const groups = new Map<string, RoomSetup[]>()
    for (const room of state?.data.rooms || []) {
      groups.set(room.roomTypeId, [...(groups.get(room.roomTypeId) || []), room])
    }
    return groups
  }, [state?.data.rooms])

  if (!state) return null

  const { rooms, roomTypes } = state.data

  const addRooms = () => {
    const numbers = buildRoomNumbers(fromRoom, toRoom || fromRoom)
    if (numbers.length === 0 || !selectedRoomTypeId) return

    const existingNumbers = new Set(rooms.map((room) => room.number))
    const nextRooms = [
      ...rooms,
      ...numbers
        .filter((number) => !existingNumbers.has(number))
        .map((number) => ({
          id: `room-${number}`,
          number,
          roomTypeId: selectedRoomTypeId,
          status: 'available' as const,
          notes: '',
        })),
    ].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))

    updateRooms(nextRooms)
    setFromRoom('')
    setToRoom('')
  }

  const updateRoomStatus = (roomId: string, status: RoomSetup['status']) => {
    updateRooms(rooms.map((room) => room.id === roomId ? { ...room, status } : room))
  }

  const removeRoom = (roomId: string) => {
    updateRooms(rooms.filter((room) => room.id !== roomId))
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Add real room numbers in ranges. Rooms start available and clean; mark rooms out of service only if they should not be sold.
      </p>

      <Card className="p-4">
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
          <div className="space-y-2">
            <Label>Room Type</Label>
            <Select value={selectedRoomTypeId} onValueChange={setRoomTypeId}>
              <SelectTrigger>
                <SelectValue placeholder="Select room type" />
              </SelectTrigger>
              <SelectContent>
                {roomTypes.map((roomType) => (
                  <SelectItem key={roomType.id} value={roomType.id}>
                    {roomType.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="from-room">From Room</Label>
            <Input
              id="from-room"
              value={fromRoom}
              onChange={(event) => setFromRoom(event.target.value)}
              placeholder="First room number"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="to-room">To Room</Label>
            <Input
              id="to-room"
              value={toRoom}
              onChange={(event) => setToRoom(event.target.value)}
              placeholder="Last room number"
            />
          </div>

          <Button onClick={addRooms} disabled={!fromRoom || !selectedRoomTypeId}>
            Add Rooms
          </Button>
        </div>
      </Card>

      <div className="space-y-6">
        {roomTypes.map((roomType) => {
          const roomList = (groupedRooms.get(roomType.id) || []).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
          const available = roomList.filter((room) => room.status === 'available').length
          const outOfService = roomList.length - available

          return (
            <div key={roomType.id}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-lg">{roomType.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {available} available, {outOfService} out of service
                </p>
              </div>
              {roomList.length === 0 ? (
                <Card className="p-4 text-sm text-muted-foreground">No rooms added for this room type.</Card>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {roomList.map((room) => (
                    <div key={room.id} className="flex items-center gap-1 rounded-md border bg-background p-1">
                      <Badge variant={room.status === 'available' ? 'secondary' : 'outline'} className="px-3 py-1">
                        {room.number}
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => updateRoomStatus(room.id, room.status === 'available' ? 'out-of-service' : 'available')}
                      >
                        {room.status === 'available' ? 'OOS' : 'Sell'}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => removeRoom(room.id)}>
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="bg-muted/50 rounded-lg p-4 text-sm">
        <p className="font-medium mb-1">Total: {rooms.length} rooms</p>
        <p className="text-muted-foreground">
          Room, guest, reservation, and payment ledgers start empty after setup.
        </p>
      </div>
    </div>
  )
}
