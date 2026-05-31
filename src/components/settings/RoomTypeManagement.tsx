import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { useKV } from '@github/spark/hooks'
import { Plus, Trash, DoorOpen, Bed, Users, CurrencyDollar, PencilSimple } from '@phosphor-icons/react'
import { toast } from 'sonner'
import type { RoomTypeSetup, RoomSetup } from '@/types/onboarding'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SERVER_API_ENABLED, pmsApi } from '@/lib/pms-api-client'

type RoomFormData = {
  id?: string
  roomTypeId: string
  number: string
  floor: string
  status: RoomSetup['status']
  notes: string
}

function floorFromRoomNumber(value: string) {
  const firstDigit = value.match(/\d/)?.[0]
  return firstDigit ? Number(firstDigit) : 1
}

function roomTypeCodeFromName(name: string) {
  const normalized = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (normalized.includes('DOUBLE')) return 'DOUBLE'
  if (normalized.includes('TWIN')) return 'TWIN'
  return normalized.slice(0, 16) || `TYPE_${Date.now()}`
}

function mapServerRoomType(record: any): RoomTypeSetup {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    baseRate: record.baseRate,
    baseOccupancy: record.standardOcc,
    maxOccupancy: record.maxOccupancy,
    extraGuestFee: record.extraGuestFee ?? 0,
    childFreeAge: 5,
    childFeeAge: 11,
    childFee: record.childFee ?? 0,
  }
}

function mapServerRoom(record: any): RoomSetup {
  return {
    id: record.id,
    number: record.number,
    roomTypeId: record.roomTypeId,
    floor: record.floor,
    status: record.operationalStatus === 'OUT_OF_SERVICE' ? 'out-of-service' : 'available',
    notes: record.notes || '',
  }
}

export function RoomTypeManagement() {
  const [roomTypes, setRoomTypes] = useKV<RoomTypeSetup[]>('onboarding-room-types', [])
  const [rooms, setRooms] = useKV<RoomSetup[]>('onboarding-rooms', [])
  const authToken = null
  const [serverRoomTypes, setServerRoomTypes] = useState<RoomTypeSetup[]>([])
  const [serverRooms, setServerRooms] = useState<RoomSetup[]>([])
  const [isLoadingServerSetup, setIsLoadingServerSetup] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  
  const [isAddTypeDialogOpen, setIsAddTypeDialogOpen] = useState(false)
  const [isAddRoomDialogOpen, setIsAddRoomDialogOpen] = useState(false)
  const [isEditRoomDialogOpen, setIsEditRoomDialogOpen] = useState(false)
  const [editingType, setEditingType] = useState<RoomTypeSetup | null>(null)
  const [editingRoom, setEditingRoom] = useState<RoomSetup | null>(null)

  const [typeFormData, setTypeFormData] = useState<Partial<RoomTypeSetup>>({
    code: '',
    name: '',
    baseOccupancy: 2,
    maxOccupancy: 2,
    baseRate: 2000,
    extraGuestFee: 300,
    childFreeAge: 5,
    childFeeAge: 11,
    childFee: 300,
  })

  const [roomFormData, setRoomFormData] = useState<RoomFormData>({
    roomTypeId: '',
    number: '',
    floor: '',
    status: 'available',
    notes: '',
  })

  const effectiveRoomTypes = SERVER_API_ENABLED ? serverRoomTypes : roomTypes
  const effectiveRooms = SERVER_API_ENABLED ? serverRooms : rooms

  const loadServerRoomSetup = async () => {
    if (!SERVER_API_ENABLED) return
    setIsLoadingServerSetup(true)
    setServerError(null)
    try {
      const payload = await pmsApi<{ ok: true; data: { roomTypes: any[]; rooms: any[] } }>('/api/settings/room-setup', authToken)
      setServerRoomTypes(payload.data.roomTypes.map(mapServerRoomType))
      setServerRooms(payload.data.rooms.map(mapServerRoom))
    } catch (error) {
      setServerError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoadingServerSetup(false)
    }
  }

  useEffect(() => {
    void loadServerRoomSetup()
  }, [])

  const resetTypeForm = () => {
    setTypeFormData({
      code: '',
      name: '',
      baseOccupancy: 2,
      maxOccupancy: 2,
      baseRate: 2000,
      extraGuestFee: 300,
      childFreeAge: 5,
      childFeeAge: 11,
      childFee: 300,
    })
    setEditingType(null)
  }

  const handleSaveRoomType = async () => {
    if (!typeFormData.name) {
      toast.error('Please provide a room type name')
      return
    }

    if ((typeFormData.maxOccupancy || 0) < (typeFormData.baseOccupancy || 1)) {
      toast.error('Max occupancy must be at least base occupancy')
      return
    }

    const nextRoomType: RoomTypeSetup = {
      id: editingType?.id || `type-${Date.now()}`,
      code: typeFormData.code?.trim().toUpperCase() || roomTypeCodeFromName(typeFormData.name),
      name: typeFormData.name,
      baseRate: Number(typeFormData.baseRate || 1),
      baseOccupancy: Number(typeFormData.baseOccupancy || 2),
      maxOccupancy: Number(typeFormData.maxOccupancy || 2),
      extraGuestFee: Number(typeFormData.extraGuestFee || 0),
      childFreeAge: Number(typeFormData.childFreeAge || 5),
      childFeeAge: Number(typeFormData.childFeeAge || 11),
      childFee: Number(typeFormData.childFee || 0),
    }

    if (SERVER_API_ENABLED) {
      try {
        const path = editingType ? `/api/settings/room-types/${editingType.id}` : '/api/settings/room-types'
        await pmsApi(path, authToken, {
          method: editingType ? 'PATCH' : 'POST',
          body: JSON.stringify(nextRoomType),
        })
        await loadServerRoomSetup()
        toast.success(editingType ? 'Room type updated successfully' : 'Room type created successfully')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to save room type')
        return
      }
      setIsAddTypeDialogOpen(false)
      resetTypeForm()
      return
    }

    if (editingType) {
      setRoomTypes((current) =>
        current.map((type) =>
          type.id === editingType.id
            ? nextRoomType
            : type
        )
      )
      toast.success('Room type updated successfully')
    } else {
      setRoomTypes((current) => [...current, nextRoomType])
      toast.success('Room type created successfully')
    }

    setIsAddTypeDialogOpen(false)
    resetTypeForm()
  }

  const handleDeleteRoomType = async (typeId: string) => {
    const roomCount = effectiveRooms.filter((r) => r.roomTypeId === typeId).length
    if (roomCount > 0) {
      toast.error(`Cannot delete room type with ${roomCount} assigned rooms`)
      return
    }

    if (SERVER_API_ENABLED) {
      try {
        await pmsApi(`/api/settings/room-types/${typeId}`, authToken, { method: 'DELETE' })
        await loadServerRoomSetup()
        toast.success('Room type deleted')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to delete room type')
      }
      return
    }

    setRoomTypes((current) => current.filter((t) => t.id !== typeId))
    toast.success('Room type deleted')
  }

  const handleEditRoomType = (type: RoomTypeSetup) => {
    setEditingType(type)
    setTypeFormData(type)
    setIsAddTypeDialogOpen(true)
  }

  const handleAddRoom = async () => {
    if (!roomFormData.roomTypeId || !roomFormData.number) {
      toast.error('Please fill in all fields')
      return
    }

    const roomNumber = roomFormData.number.trim()
    if (!/^[A-Za-z0-9-]+$/.test(roomNumber)) {
      toast.error('Room number may only contain letters, numbers, and hyphens')
      return
    }

    if (effectiveRooms.some((r) => r.number === roomNumber)) {
      toast.error(`Room ${roomNumber} already exists`)
      return
    }

    const nextRoom: RoomSetup = {
      id: `room-${Date.now()}`,
      number: roomNumber,
      roomTypeId: roomFormData.roomTypeId,
      floor: Number(roomFormData.floor || floorFromRoomNumber(roomNumber)),
      status: roomFormData.status,
      notes: roomFormData.notes.trim(),
    }

    if (SERVER_API_ENABLED) {
      try {
        await pmsApi('/api/settings/rooms', authToken, {
          method: 'POST',
          body: JSON.stringify(nextRoom),
        })
        await loadServerRoomSetup()
        toast.success(`Added room ${roomNumber}`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to add room')
        return
      }
    } else {
      setRooms((current) => [...current, nextRoom])
      toast.success(`Added room ${roomNumber}`)
    }

    setIsAddRoomDialogOpen(false)
    setRoomFormData({ roomTypeId: '', number: '', floor: '', status: 'available', notes: '' })
  }

  const handleDeleteRoom = async (roomId: string) => {
    if (SERVER_API_ENABLED) {
      try {
        await pmsApi(`/api/settings/rooms/${roomId}`, authToken, { method: 'DELETE' })
        await loadServerRoomSetup()
        toast.success('Room deleted')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to delete room')
      }
      return
    }

    setRooms((current) => current.filter((r) => r.id !== roomId))
    toast.success('Room deleted')
  }

  const getRoomsByType = (typeId: string) => {
    return effectiveRooms.filter((r) => r.roomTypeId === typeId).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
  }

  const handleEditRoom = (room: RoomSetup) => {
    setEditingRoom(room)
    setRoomFormData({
      id: room.id,
      roomTypeId: room.roomTypeId,
      number: room.number,
      floor: String(room.floor || floorFromRoomNumber(room.number)),
      status: room.status,
      notes: room.notes || '',
    })
    setIsEditRoomDialogOpen(true)
  }

  const handleSaveRoom = async () => {
    if (!editingRoom || !roomFormData.roomTypeId || !roomFormData.number.trim()) {
      toast.error('Please fill in all room fields')
      return
    }

    const roomNumber = roomFormData.number.trim()
    const duplicate = effectiveRooms.some((room) => room.id !== editingRoom.id && room.number === roomNumber)
    if (duplicate) {
      toast.error(`Room ${roomNumber} already exists`)
      return
    }

    const nextRoom: RoomSetup = {
      ...editingRoom,
      number: roomNumber,
      roomTypeId: roomFormData.roomTypeId,
      floor: Number(roomFormData.floor || floorFromRoomNumber(roomNumber)),
      status: roomFormData.status,
      notes: roomFormData.notes.trim(),
    }

    if (SERVER_API_ENABLED) {
      try {
        await pmsApi(`/api/settings/rooms/${editingRoom.id}`, authToken, {
          method: 'PATCH',
          body: JSON.stringify(nextRoom),
        })
        await loadServerRoomSetup()
        toast.success(`Room ${roomNumber} updated`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to update room')
        return
      }
    } else {
      setRooms((current) => current.map((room) => room.id === editingRoom.id ? nextRoom : room))
      toast.success(`Room ${roomNumber} updated`)
    }

    setIsEditRoomDialogOpen(false)
    setEditingRoom(null)
    setRoomFormData({ roomTypeId: '', number: '', floor: '', status: 'available', notes: '' })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bed className="text-primary" weight="duotone" />
                Room Types
              </CardTitle>
              <CardDescription>
                Configure room types and their pricing policies
                {SERVER_API_ENABLED ? ' in the database.' : '.'}
              </CardDescription>
            </div>
            <Dialog open={isAddTypeDialogOpen} onOpenChange={setIsAddTypeDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={resetTypeForm}>
                  <Plus className="mr-2" size={16} />
                  Add Room Type
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>{editingType ? 'Edit Room Type' : 'Add Room Type'}</DialogTitle>
                  <DialogDescription>
                    Configure occupancy limits and guest fees
                  </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-2 gap-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="typeName">Room Type Name *</Label>
                    <Input
                      id="typeName"
                      placeholder="e.g., Standard Twin, Superior Double"
                      value={typeFormData.name}
                      onChange={(e) => setTypeFormData({ ...typeFormData, name: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="typeCode">Room Type Code</Label>
                    <Input
                      id="typeCode"
                      placeholder="e.g., TWIN"
                      value={typeFormData.code || ''}
                      onChange={(e) => setTypeFormData({ ...typeFormData, code: e.target.value.toUpperCase() })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="baseOccupancy">Base Occupancy</Label>
                    <Input
                      id="baseOccupancy"
                      type="number"
                      min={1}
                      value={typeFormData.baseOccupancy}
                      onChange={(e) => setTypeFormData({ ...typeFormData, baseOccupancy: parseInt(e.target.value) })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="maxOccupancy">Max Occupancy</Label>
                    <Input
                      id="maxOccupancy"
                      type="number"
                      min={1}
                      value={typeFormData.maxOccupancy}
                      onChange={(e) => setTypeFormData({ ...typeFormData, maxOccupancy: parseInt(e.target.value) })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="baseRate">Base Rate (THB)</Label>
                    <Input
                      id="baseRate"
                      type="number"
                      min={1}
                      value={typeFormData.baseRate || ''}
                      onChange={(e) => setTypeFormData({ ...typeFormData, baseRate: parseInt(e.target.value) || 0 })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="extraGuestFee">Extra Guest Fee (THB)</Label>
                    <Input
                      id="extraGuestFee"
                      type="number"
                      min={0}
                      value={typeFormData.extraGuestFee}
                      onChange={(e) => setTypeFormData({ ...typeFormData, extraGuestFee: parseInt(e.target.value) })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="childFee">Child Fee (THB)</Label>
                    <Input
                      id="childFee"
                      type="number"
                      min={0}
                      value={typeFormData.childFee}
                      onChange={(e) => setTypeFormData({ ...typeFormData, childFee: parseInt(e.target.value) })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="childFreeAge">Child Free Age (0-X)</Label>
                    <Input
                      id="childFreeAge"
                      type="number"
                      min={0}
                      value={typeFormData.childFreeAge}
                      onChange={(e) => setTypeFormData({ ...typeFormData, childFreeAge: parseInt(e.target.value) })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="childFeeAge">Child Fee Applies Until Age</Label>
                    <Input
                      id="childFeeAge"
                      type="number"
                      min={0}
                      value={typeFormData.childFeeAge}
                      onChange={(e) => setTypeFormData({ ...typeFormData, childFeeAge: parseInt(e.target.value) })}
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddTypeDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSaveRoomType}>
                    {editingType ? 'Update' : 'Create'} Room Type
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Occupancy</TableHead>
                <TableHead>Extra Guest</TableHead>
                <TableHead>Child Fees</TableHead>
                <TableHead>Rooms</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingServerSetup ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Loading room setup...
                  </TableCell>
                </TableRow>
              ) : effectiveRoomTypes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No room types configured. Add your first room type to get started.
                  </TableCell>
                </TableRow>
              ) : (
                effectiveRoomTypes.map((type) => (
                  <TableRow key={type.id}>
                    <TableCell className="font-medium">{type.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Users size={16} className="text-muted-foreground" />
                        {type.baseOccupancy} / {type.maxOccupancy}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <CurrencyDollar size={16} className="text-muted-foreground" />
                        {type.extraGuestFee} THB
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      0-{type.childFreeAge} free, {type.childFreeAge + 1}-{type.childFeeAge}: {type.childFee} THB
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{getRoomsByType(type.id).length} rooms</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="sm" onClick={() => handleEditRoomType(type)}>
                          <PencilSimple size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteRoomType(type.id)}
                        >
                          <Trash size={16} className="text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <DoorOpen className="text-primary" weight="duotone" />
                Rooms
              </CardTitle>
              <CardDescription>
                Manage individual room inventory
              </CardDescription>
            </div>
            <Dialog open={isAddRoomDialogOpen} onOpenChange={setIsAddRoomDialogOpen}>
              <DialogTrigger asChild>
                <Button disabled={effectiveRoomTypes.length === 0}>
                  <Plus className="mr-2" size={16} />
                  Add Room
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Room</DialogTitle>
                  <DialogDescription>
                    Add one real room number to the inventory
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="roomType">Room Type *</Label>
                    <Select
                      value={roomFormData.roomTypeId}
                      onValueChange={(value) => setRoomFormData({ ...roomFormData, roomTypeId: value })}
                    >
                      <SelectTrigger id="roomType">
                        <SelectValue placeholder="Select room type" />
                      </SelectTrigger>
                      <SelectContent>
                        {effectiveRoomTypes.map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            {type.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="roomNumber">Room Number</Label>
                      <Input
                        id="roomNumber"
                        placeholder="e.g., 201"
                        value={roomFormData.number}
                        onChange={(e) => setRoomFormData({ ...roomFormData, number: e.target.value, floor: roomFormData.floor || String(floorFromRoomNumber(e.target.value)) })}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="roomFloor">Floor</Label>
                      <Input
                        id="roomFloor"
                        type="number"
                        min={0}
                        placeholder="e.g., 2"
                        value={roomFormData.floor}
                        onChange={(e) => setRoomFormData({ ...roomFormData, floor: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="roomStatus">Status</Label>
                    <Select
                      value={roomFormData.status}
                      onValueChange={(value) => setRoomFormData({ ...roomFormData, status: value as RoomSetup['status'] })}
                    >
                      <SelectTrigger id="roomStatus">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="available">Available</SelectItem>
                        <SelectItem value="out-of-service">Out of service</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="roomNotes">Notes</Label>
                    <Input
                      id="roomNotes"
                      placeholder="Optional room notes"
                      value={roomFormData.notes}
                      onChange={(e) => setRoomFormData({ ...roomFormData, notes: e.target.value })}
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddRoomDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddRoom}>Add Room</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {serverError && (
            <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {serverError}
            </div>
          )}

          {effectiveRoomTypes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Add room types first before creating rooms
            </div>
          ) : (
            <div className="space-y-6">
              {effectiveRoomTypes.map((type) => {
                const typeRooms = getRoomsByType(type.id)
                if (typeRooms.length === 0) return null

                return (
                  <div key={type.id}>
                    <h3 className="font-semibold mb-3">{type.name}</h3>
                    <div className="grid grid-cols-8 gap-2">
                      {typeRooms.map((room) => (
                        <div
                          key={room.id}
                          className="relative group border rounded p-2 text-center hover:border-primary transition-colors"
                        >
                          <div className="font-medium text-sm">{room.number}</div>
                          <Badge variant={room.status === 'available' ? 'outline' : 'secondary'} className="text-xs mt-1">
                            {room.status === 'available' ? 'OK' : 'OOS'}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="absolute -top-2 -right-2 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleDeleteRoom(room.id)}
                          >
                            <Trash size={12} className="text-destructive" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="absolute -top-2 -left-2 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleEditRoom(room)}
                          >
                            <PencilSimple size={12} />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}

              {effectiveRooms.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No rooms added yet. Click "Add Room" to get started.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isEditRoomDialogOpen} onOpenChange={setIsEditRoomDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Room</DialogTitle>
            <DialogDescription>
              Update room number, room type, operational status, and notes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="editRoomType">Room Type</Label>
              <Select
                value={roomFormData.roomTypeId}
                onValueChange={(value) => setRoomFormData({ ...roomFormData, roomTypeId: value })}
              >
                <SelectTrigger id="editRoomType">
                  <SelectValue placeholder="Select room type" />
                </SelectTrigger>
                <SelectContent>
                  {effectiveRoomTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="editRoomNumber">Room Number</Label>
                <Input
                  id="editRoomNumber"
                  value={roomFormData.number}
                  onChange={(e) => setRoomFormData({ ...roomFormData, number: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="editRoomFloor">Floor</Label>
                <Input
                  id="editRoomFloor"
                  type="number"
                  min={0}
                  value={roomFormData.floor}
                  onChange={(e) => setRoomFormData({ ...roomFormData, floor: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="editRoomStatus">Status</Label>
              <Select
                value={roomFormData.status}
                onValueChange={(value) => setRoomFormData({ ...roomFormData, status: value as RoomSetup['status'] })}
              >
                <SelectTrigger id="editRoomStatus">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="out-of-service">Out of service</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="editRoomNotes">Notes</Label>
              <Input
                id="editRoomNotes"
                value={roomFormData.notes}
                onChange={(e) => setRoomFormData({ ...roomFormData, notes: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditRoomDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveRoom}>Save Room</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
