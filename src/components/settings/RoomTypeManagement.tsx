import { useState } from 'react'
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

export function RoomTypeManagement() {
  const [roomTypes, setRoomTypes] = useKV<RoomTypeSetup[]>('onboarding-room-types', [])
  const [rooms, setRooms] = useKV<RoomSetup[]>('onboarding-rooms', [])
  
  const [isAddTypeDialogOpen, setIsAddTypeDialogOpen] = useState(false)
  const [isAddRoomDialogOpen, setIsAddRoomDialogOpen] = useState(false)
  const [editingType, setEditingType] = useState<RoomTypeSetup | null>(null)

  const [typeFormData, setTypeFormData] = useState<Partial<RoomTypeSetup>>({
    name: '',
    baseOccupancy: 2,
    maxOccupancy: 3,
    extraGuestFee: 200,
    childFreeAge: 5,
    childFeeAge: 11,
    childFee: 100,
  })

  const [roomFormData, setRoomFormData] = useState({
    roomTypeId: '',
    startNumber: '',
    endNumber: '',
  })

  const resetTypeForm = () => {
    setTypeFormData({
      name: '',
      baseOccupancy: 2,
      maxOccupancy: 3,
      extraGuestFee: 200,
      childFreeAge: 5,
      childFeeAge: 11,
      childFee: 100,
    })
    setEditingType(null)
  }

  const handleSaveRoomType = () => {
    if (!typeFormData.name) {
      toast.error('Please provide a room type name')
      return
    }

    if (editingType) {
      setRoomTypes((current) =>
        current.map((type) =>
          type.id === editingType.id
            ? { ...type, ...typeFormData }
            : type
        )
      )
      toast.success('Room type updated successfully')
    } else {
      const newType: RoomTypeSetup = {
        id: `type-${Date.now()}`,
        name: typeFormData.name!,
        baseOccupancy: typeFormData.baseOccupancy || 2,
        maxOccupancy: typeFormData.maxOccupancy || 3,
        extraGuestFee: typeFormData.extraGuestFee || 200,
        childFreeAge: typeFormData.childFreeAge || 5,
        childFeeAge: typeFormData.childFeeAge || 11,
        childFee: typeFormData.childFee || 100,
      }
      setRoomTypes((current) => [...current, newType])
      toast.success('Room type created successfully')
    }

    setIsAddTypeDialogOpen(false)
    resetTypeForm()
  }

  const handleDeleteRoomType = (typeId: string) => {
    const roomCount = rooms.filter((r) => r.roomTypeId === typeId).length
    if (roomCount > 0) {
      toast.error(`Cannot delete room type with ${roomCount} assigned rooms`)
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

  const handleAddRooms = () => {
    if (!roomFormData.roomTypeId || !roomFormData.startNumber || !roomFormData.endNumber) {
      toast.error('Please fill in all fields')
      return
    }

    const start = parseInt(roomFormData.startNumber)
    const end = parseInt(roomFormData.endNumber)

    if (isNaN(start) || isNaN(end) || start > end) {
      toast.error('Invalid room number range')
      return
    }

    const newRooms: RoomSetup[] = []
    for (let i = start; i <= end; i++) {
      const roomNumber = i.toString()
      if (rooms.some((r) => r.number === roomNumber)) {
        toast.error(`Room ${roomNumber} already exists`)
        return
      }

      newRooms.push({
        id: `room-${Date.now()}-${i}`,
        number: roomNumber,
        roomTypeId: roomFormData.roomTypeId,
        status: 'available',
      })
    }

    setRooms((current) => [...current, ...newRooms])
    toast.success(`Added ${newRooms.length} rooms successfully`)
    setIsAddRoomDialogOpen(false)
    setRoomFormData({ roomTypeId: '', startNumber: '', endNumber: '' })
  }

  const handleDeleteRoom = (roomId: string) => {
    setRooms((current) => current.filter((r) => r.id !== roomId))
    toast.success('Room deleted')
  }

  const getRoomsByType = (typeId: string) => {
    return rooms.filter((r) => r.roomTypeId === typeId).sort((a, b) => a.number.localeCompare(b.number))
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
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor="typeName">Room Type Name *</Label>
                    <Input
                      id="typeName"
                      placeholder="e.g., Twin Room, Double Room"
                      value={typeFormData.name}
                      onChange={(e) => setTypeFormData({ ...typeFormData, name: e.target.value })}
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
              {roomTypes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No room types configured. Add your first room type to get started.
                  </TableCell>
                </TableRow>
              ) : (
                roomTypes.map((type) => (
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
                <Button disabled={roomTypes.length === 0}>
                  <Plus className="mr-2" size={16} />
                  Add Rooms
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Rooms</DialogTitle>
                  <DialogDescription>
                    Add a range of room numbers at once
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
                        {roomTypes.map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            {type.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="startNumber">Start Room Number</Label>
                      <Input
                        id="startNumber"
                        placeholder="e.g., 201"
                        value={roomFormData.startNumber}
                        onChange={(e) => setRoomFormData({ ...roomFormData, startNumber: e.target.value })}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="endNumber">End Room Number</Label>
                      <Input
                        id="endNumber"
                        placeholder="e.g., 215"
                        value={roomFormData.endNumber}
                        onChange={(e) => setRoomFormData({ ...roomFormData, endNumber: e.target.value })}
                      />
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    This will create rooms from {roomFormData.startNumber || '...'} to {roomFormData.endNumber || '...'}{' '}
                    {roomFormData.startNumber && roomFormData.endNumber
                      ? `(${parseInt(roomFormData.endNumber) - parseInt(roomFormData.startNumber) + 1} rooms)`
                      : ''}
                  </p>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddRoomDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddRooms}>Add Rooms</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {roomTypes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Add room types first before creating rooms
            </div>
          ) : (
            <div className="space-y-6">
              {roomTypes.map((type) => {
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
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}

              {rooms.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No rooms added yet. Click "Add Rooms" to get started.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
