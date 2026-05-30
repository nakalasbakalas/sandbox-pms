import { useState, useMemo } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { 
  Users, 
  Plus, 
  Trash,
  UserCircle,
  CheckCircle,
  Circle,
  Lightning,
  ListChecks,
  CaretRight,
  Broom,
  UserList
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import type { HousekeepingRoom, CleanStatus } from '@/types/housekeeping'

interface HousekeepingStaff {
  id: string
  name: string
  phone?: string
  email?: string
  floor?: number
  isActive: boolean
  shiftStart?: string
  shiftEnd?: string
  color: string
  assignedRooms: string[]
}

interface StaffAssignmentViewProps {
  rooms: HousekeepingRoom[]
  onBack: () => void
}

export function StaffAssignmentView({ rooms, onBack }: StaffAssignmentViewProps) {
  const [staff, setStaff] = useKV<HousekeepingStaff[]>('housekeeping-staff', [])
  const [assignments, setAssignments] = useKV<Record<string, string>>('room-staff-assignments', {})
  const [showAddStaffDialog, setShowAddStaffDialog] = useState(false)
  const [showAssignDialog, setShowAssignDialog] = useState(false)
  const [selectedStaff, setSelectedStaff] = useState<HousekeepingStaff | null>(null)
  const [editingStaff, setEditingStaff] = useState<HousekeepingStaff | null>(null)

  const activeStaff = useMemo(() => 
    (staff || []).filter(s => s.isActive).sort((a, b) => a.name.localeCompare(b.name)),
    [staff]
  )

  const getStaffStats = (staffId: string) => {
    const assignedRoomIds = Object.entries(assignments || {})
      .filter(([_, id]) => id === staffId)
      .map(([roomId]) => roomId)
    
    const assignedRooms = rooms.filter(r => assignedRoomIds.includes(r.roomId))
    
    return {
      totalAssigned: assignedRooms.length,
      dirty: assignedRooms.filter(r => r.cleanStatus === 'DIRTY').length,
      cleaning: assignedRooms.filter(r => r.cleanStatus === 'CLEANING').length,
      clean: assignedRooms.filter(r => r.cleanStatus === 'CLEAN').length,
      inspected: assignedRooms.filter(r => r.cleanStatus === 'INSPECTED').length,
      arrivals: assignedRooms.filter(r => r.isArrivalToday).length,
      departures: assignedRooms.filter(r => r.isDepartureToday).length,
      rooms: assignedRooms
    }
  }

  const handleAddStaff = (newStaff: Omit<HousekeepingStaff, 'id' | 'assignedRooms'>) => {
    const staff: HousekeepingStaff = {
      ...newStaff,
      id: `staff-${Date.now()}`,
      assignedRooms: []
    }
    
    setStaff((current) => [...(current || []), staff])
    toast.success(`${staff.name} added to housekeeping team`)
  }

  const handleUpdateStaff = (updatedStaff: HousekeepingStaff) => {
    setStaff((current) => 
      (current || []).map(s => s.id === updatedStaff.id ? updatedStaff : s)
    )
    toast.success(`${updatedStaff.name} updated`)
  }

  const handleRemoveStaff = (staffId: string) => {
    const staffMember = staff?.find(s => s.id === staffId)
    if (!staffMember) return

    const assignedCount = Object.values(assignments || {}).filter(id => id === staffId).length
    
    if (assignedCount > 0) {
      toast.error(`Cannot remove ${staffMember.name} - unassign their ${assignedCount} rooms first`)
      return
    }

    setStaff((current) => (current || []).filter(s => s.id !== staffId))
    toast.success(`${staffMember.name} removed`)
  }

  const handleAssignRoom = (roomId: string, staffId: string | null) => {
    setAssignments((current) => {
      const updated = { ...(current || {}) }
      if (staffId) {
        updated[roomId] = staffId
      } else {
        delete updated[roomId]
      }
      return updated
    })
  }

  const handleBulkAssignByFloor = (floor: number, staffId: string) => {
    const floorRooms = rooms.filter(r => r.floor === floor && r.cleanStatus === 'DIRTY')
    
    setAssignments((current) => {
      const updated = { ...(current || {}) }
      floorRooms.forEach(room => {
        updated[room.roomId] = staffId
      })
      return updated
    })

    const staffMember = staff?.find(s => s.id === staffId)
    toast.success(`Assigned ${floorRooms.length} Floor ${floor} rooms to ${staffMember?.name}`)
  }

  const handleAutoDistribute = () => {
    if (!activeStaff.length) {
      toast.error('Add staff members first')
      return
    }

    const dirtyRooms = rooms.filter(r => r.cleanStatus === 'DIRTY').sort((a, b) => {
      if (a.isArrivalToday && !b.isArrivalToday) return -1
      if (!a.isArrivalToday && b.isArrivalToday) return 1
      if (a.isDepartureToday && !b.isDepartureToday) return -1
      if (!a.isDepartureToday && b.isDepartureToday) return 1
      return b.priority - a.priority
    })

    const roomsPerStaff = Math.ceil(dirtyRooms.length / activeStaff.length)
    const newAssignments: Record<string, string> = { ...(assignments || {}) }

    dirtyRooms.forEach((room, index) => {
      const staffIndex = Math.floor(index / roomsPerStaff)
      const staff = activeStaff[Math.min(staffIndex, activeStaff.length - 1)]
      newAssignments[room.roomId] = staff.id
    })

    setAssignments(newAssignments)
    toast.success(`Distributed ${dirtyRooms.length} rooms among ${activeStaff.length} staff members`)
  }

  const handleClearAllAssignments = () => {
    setAssignments({})
    toast.success('All assignments cleared')
  }

  return (
    <div className="min-h-screen bg-background pb-6">
      <div className="sticky top-0 z-10 bg-primary text-primary-foreground px-6 py-4 shadow-md">
        <button 
          onClick={onBack}
          className="mb-3 text-primary-foreground hover:opacity-80 transition-opacity flex items-center gap-2"
        >
          ← Back
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <UserList size={24} weight="bold" />
              Staff Assignment
            </h1>
            <p className="text-sm opacity-90 mt-1">
              Distribute rooms among housekeeping team
            </p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Housekeeping Team</h2>
            <p className="text-sm text-muted-foreground">
              {activeStaff.length} active staff members
            </p>
          </div>
          <Button onClick={() => setShowAddStaffDialog(true)} className="gap-2">
            <Plus size={18} weight="bold" />
            Add Staff
          </Button>
        </div>

        {activeStaff.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button 
              onClick={handleAutoDistribute}
              variant="outline"
              className="gap-2"
            >
              <Lightning size={18} weight="fill" />
              Auto-Distribute
            </Button>
            <Button 
              onClick={handleClearAllAssignments}
              variant="outline"
              className="gap-2"
            >
              <Circle size={18} />
              Clear All
            </Button>
          </div>
        )}

        {activeStaff.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <UserCircle size={64} className="mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="font-semibold mb-2">No Staff Members Yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Add housekeeping staff to start assigning rooms
              </p>
              <Button onClick={() => setShowAddStaffDialog(true)} className="gap-2">
                <Plus size={18} weight="bold" />
                Add First Staff Member
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {activeStaff.map(staffMember => {
              const stats = getStaffStats(staffMember.id)
              return (
                <Card key={staffMember.id}>
                  <CardHeader className="pb-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div 
                          className="w-12 h-12 rounded-full flex items-center justify-center font-semibold text-white text-lg"
                          style={{ backgroundColor: staffMember.color }}
                        >
                          {staffMember.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <CardTitle className="text-base">{staffMember.name}</CardTitle>
                          <div className="text-sm text-muted-foreground space-y-0.5 mt-1">
                            {staffMember.floor && <div>Floor {staffMember.floor}</div>}
                            {staffMember.phone && <div>{staffMember.phone}</div>}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingStaff(staffMember)
                            setShowAddStaffDialog(true)
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRemoveStaff(staffMember.id)}
                        >
                          <Trash size={16} />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-4 gap-3 text-center">
                      <div>
                        <div className="text-2xl font-bold">{stats.totalAssigned}</div>
                        <div className="text-xs text-muted-foreground">Total</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-orange-600">{stats.dirty}</div>
                        <div className="text-xs text-muted-foreground">Dirty</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-green-600">{stats.clean}</div>
                        <div className="text-xs text-muted-foreground">Clean</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-blue-600">{stats.arrivals}</div>
                        <div className="text-xs text-muted-foreground">Arrivals</div>
                      </div>
                    </div>

                    {stats.rooms.length > 0 && (
                      <>
                        <Separator />
                        <div>
                          <div className="text-sm font-medium mb-2">Assigned Rooms</div>
                          <div className="flex flex-wrap gap-2">
                            {stats.rooms
                              .sort((a, b) => a.number.localeCompare(b.number))
                              .map(room => (
                                <Badge
                                  key={room.roomId}
                                  variant="outline"
                                  className="gap-1.5"
                                  style={{ borderColor: staffMember.color }}
                                >
                                  <StatusIndicator status={room.cleanStatus} />
                                  {room.number}
                                  {room.isArrivalToday && <span className="text-green-600">↓</span>}
                                  {room.isDepartureToday && <span className="text-orange-600">↑</span>}
                                </Badge>
                              ))}
                          </div>
                        </div>
                      </>
                    )}

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 gap-2"
                        onClick={() => {
                          setSelectedStaff(staffMember)
                          setShowAssignDialog(true)
                        }}
                      >
                        <ListChecks size={16} weight="bold" />
                        Manage Rooms
                      </Button>
                      {staffMember.floor && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleBulkAssignByFloor(staffMember.floor!, staffMember.id)}
                        >
                          Auto-assign Floor {staffMember.floor}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      <AddStaffDialog
        open={showAddStaffDialog}
        onClose={() => {
          setShowAddStaffDialog(false)
          setEditingStaff(null)
        }}
        onSubmit={(staffData) => {
          if (editingStaff) {
            handleUpdateStaff({ ...editingStaff, ...staffData })
            setEditingStaff(null)
          } else {
            handleAddStaff(staffData)
          }
          setShowAddStaffDialog(false)
        }}
        editingStaff={editingStaff}
      />

      {selectedStaff && (
        <AssignRoomsDialog
          open={showAssignDialog}
          onClose={() => {
            setShowAssignDialog(false)
            setSelectedStaff(null)
          }}
          staff={selectedStaff}
          rooms={rooms}
          assignments={assignments || {}}
          onAssign={handleAssignRoom}
          allStaff={activeStaff}
        />
      )}
    </div>
  )
}

interface AddStaffDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (staff: Omit<HousekeepingStaff, 'id' | 'assignedRooms'>) => void
  editingStaff?: HousekeepingStaff | null
}

function AddStaffDialog({ open, onClose, onSubmit, editingStaff }: AddStaffDialogProps) {
  const [name, setName] = useState(editingStaff?.name || '')
  const [phone, setPhone] = useState(editingStaff?.phone || '')
  const [email, setEmail] = useState(editingStaff?.email || '')
  const [floor, setFloor] = useState<string>(editingStaff?.floor?.toString() || '')
  const [shiftStart, setShiftStart] = useState(editingStaff?.shiftStart || '08:00')
  const [shiftEnd, setShiftEnd] = useState(editingStaff?.shiftEnd || '17:00')
  const [color, setColor] = useState(editingStaff?.color || '#3b82f6')
  const [isActive, setIsActive] = useState(editingStaff?.isActive ?? true)

  const colors = [
    { name: 'Blue', value: '#3b82f6' },
    { name: 'Green', value: '#10b981' },
    { name: 'Purple', value: '#8b5cf6' },
    { name: 'Orange', value: '#f59e0b' },
    { name: 'Pink', value: '#ec4899' },
    { name: 'Teal', value: '#14b8a6' },
    { name: 'Red', value: '#ef4444' },
    { name: 'Indigo', value: '#6366f1' },
  ]

  const handleSubmit = () => {
    if (!name.trim()) {
      toast.error('Please enter staff name')
      return
    }

    onSubmit({
      name: name.trim(),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      floor: floor ? parseInt(floor) : undefined,
      shiftStart,
      shiftEnd,
      color,
      isActive
    })

    setName('')
    setPhone('')
    setEmail('')
    setFloor('')
    setShiftStart('08:00')
    setShiftEnd('17:00')
    setColor('#3b82f6')
    setIsActive(true)
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editingStaff ? 'Edit Staff Member' : 'Add Staff Member'}
          </DialogTitle>
          <DialogDescription>
            {editingStaff ? 'Update staff member details' : 'Add a new housekeeping staff member'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="staff-name">Name *</Label>
            <Input
              id="staff-name"
              placeholder="e.g., Somchai"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-2"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="staff-phone">Phone</Label>
              <Input
                id="staff-phone"
                placeholder="081-234-5678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="staff-floor">Assigned Floor</Label>
              <Select value={floor} onValueChange={setFloor}>
                <SelectTrigger id="staff-floor" className="mt-2">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Any Floor</SelectItem>
                  <SelectItem value="2">Floor 2</SelectItem>
                  <SelectItem value="3">Floor 3</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="staff-email">Email (Optional)</Label>
            <Input
              id="staff-email"
              type="email"
              placeholder="staff@property.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="shift-start">Shift Start</Label>
              <Input
                id="shift-start"
                type="time"
                value={shiftStart}
                onChange={(e) => setShiftStart(e.target.value)}
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="shift-end">Shift End</Label>
              <Input
                id="shift-end"
                type="time"
                value={shiftEnd}
                onChange={(e) => setShiftEnd(e.target.value)}
                className="mt-2"
              />
            </div>
          </div>

          <div>
            <Label>Color Badge</Label>
            <div className="grid grid-cols-8 gap-2 mt-2">
              {colors.map(c => (
                <button
                  key={c.value}
                  type="button"
                  className={`w-10 h-10 rounded-full transition-all ${
                    color === c.value ? 'ring-2 ring-offset-2 ring-primary scale-110' : 'hover:scale-105'
                  }`}
                  style={{ backgroundColor: c.value }}
                  onClick={() => setColor(c.value)}
                  title={c.name}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="is-active"
              checked={isActive}
              onCheckedChange={(checked) => setIsActive(checked as boolean)}
            />
            <Label htmlFor="is-active" className="cursor-pointer">
              Active (available for assignments)
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>
            {editingStaff ? 'Update' : 'Add'} Staff
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface AssignRoomsDialogProps {
  open: boolean
  onClose: () => void
  staff: HousekeepingStaff
  rooms: HousekeepingRoom[]
  assignments: Record<string, string>
  onAssign: (roomId: string, staffId: string | null) => void
  allStaff: HousekeepingStaff[]
}

function AssignRoomsDialog({ 
  open, 
  onClose, 
  staff, 
  rooms, 
  assignments, 
  onAssign,
  allStaff 
}: AssignRoomsDialogProps) {
  const [filter, setFilter] = useState<'all' | 'assigned' | 'unassigned'>('all')
  const [floorFilter, setFloorFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const filteredRooms = useMemo(() => {
    return rooms.filter(room => {
      if (filter === 'assigned' && assignments[room.roomId] !== staff.id) return false
      if (filter === 'unassigned' && assignments[room.roomId] === staff.id) return false
      if (floorFilter !== 'all' && room.floor !== parseInt(floorFilter)) return false
      if (statusFilter !== 'all' && room.cleanStatus !== statusFilter) return false
      return true
    }).sort((a, b) => a.number.localeCompare(b.number))
  }, [rooms, filter, floorFilter, statusFilter, assignments, staff.id])

  const handleToggleRoom = (roomId: string) => {
    const currentAssignment = assignments[roomId]
    if (currentAssignment === staff.id) {
      onAssign(roomId, null)
    } else {
      onAssign(roomId, staff.id)
    }
  }

  const assignedCount = Object.values(assignments).filter(id => id === staff.id).length

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-3">
            <div 
              className="w-10 h-10 rounded-full flex items-center justify-center font-semibold text-white"
              style={{ backgroundColor: staff.color }}
            >
              {staff.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div>{staff.name} - Room Assignment</div>
              <div className="text-sm font-normal text-muted-foreground">
                {assignedCount} rooms assigned
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-4 space-y-3">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={filter === 'all' ? 'default' : 'outline'}
              onClick={() => setFilter('all')}
            >
              All
            </Button>
            <Button
              size="sm"
              variant={filter === 'assigned' ? 'default' : 'outline'}
              onClick={() => setFilter('assigned')}
            >
              Assigned
            </Button>
            <Button
              size="sm"
              variant={filter === 'unassigned' ? 'default' : 'outline'}
              onClick={() => setFilter('unassigned')}
            >
              Unassigned
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Select value={floorFilter} onValueChange={setFloorFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Floors</SelectItem>
                <SelectItem value="2">Floor 2</SelectItem>
                <SelectItem value="3">Floor 3</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="DIRTY">Dirty</SelectItem>
                <SelectItem value="CLEANING">Cleaning</SelectItem>
                <SelectItem value="CLEAN">Clean</SelectItem>
                <SelectItem value="INSPECTED">Inspected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <ScrollArea className="flex-1 px-6">
          <div className="space-y-2 pb-4">
            {filteredRooms.map(room => {
              const isAssignedToThis = assignments[room.roomId] === staff.id
              const assignedTo = assignments[room.roomId] 
                ? allStaff.find(s => s.id === assignments[room.roomId])
                : null

              return (
                <div
                  key={room.roomId}
                  className={`p-3 rounded-lg border transition-all ${
                    isAssignedToThis 
                      ? 'border-primary bg-primary/5' 
                      : 'border-border hover:bg-muted/30'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1">
                      <Checkbox
                        checked={isAssignedToThis}
                        onCheckedChange={() => handleToggleRoom(room.roomId)}
                        id={`room-${room.roomId}`}
                      />
                      <Label 
                        htmlFor={`room-${room.roomId}`}
                        className="cursor-pointer flex items-center gap-3 flex-1"
                      >
                        <span className="font-semibold w-12">{room.number}</span>
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusIndicator status={room.cleanStatus} withLabel />
                          {room.isArrivalToday && (
                            <Badge variant="default" className="text-[10px] px-1.5 py-0 h-5 bg-green-600">
                              Arrival {room.arrivalTime}
                            </Badge>
                          )}
                          {room.isDepartureToday && (
                            <Badge variant="default" className="text-[10px] px-1.5 py-0 h-5 bg-orange-600">
                              Departure
                            </Badge>
                          )}
                        </div>
                      </Label>
                    </div>
                    {assignedTo && !isAssignedToThis && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <div 
                          className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-semibold"
                          style={{ backgroundColor: assignedTo.color }}
                        >
                          {assignedTo.name.charAt(0).toUpperCase()}
                        </div>
                        <span>{assignedTo.name}</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            {filteredRooms.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Broom size={48} className="mx-auto mb-3 opacity-50" />
                <p>No rooms match the current filters</p>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 pb-6 pt-4 border-t">
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface StatusIndicatorProps {
  status: CleanStatus
  withLabel?: boolean
}

function StatusIndicator({ status, withLabel }: StatusIndicatorProps) {
  const config = {
    CLEAN: { color: 'bg-green-500', label: 'Clean' },
    DIRTY: { color: 'bg-orange-500', label: 'Dirty' },
    INSPECTED: { color: 'bg-blue-500', label: 'Inspected' },
    CLEANING: { color: 'bg-purple-500', label: 'Cleaning' },
  }

  const { color, label } = config[status]

  if (withLabel) {
    return (
      <div className="flex items-center gap-1.5">
        <div className={`w-2 h-2 rounded-full ${color}`} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    )
  }

  return <div className={`w-2 h-2 rounded-full ${color}`} title={label} />
}
