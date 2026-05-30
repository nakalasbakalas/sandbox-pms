import { useState, useMemo } from 'react'
import { useKV } from '@github/spark/hooks'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { 
  Bed, 
  User, 
  CheckCircle, 
  Warning, 
  X,
  ArrowRight,
  Key,
  Broom,
  Sparkle
} from '@phosphor-icons/react'
import { format, differenceInDays, isWithinInterval, parseISO } from 'date-fns'
import type { Room, RoomType, Reservation } from '@/types'
import { cn } from '@/lib/utils'

interface RoomWithDetails extends Room {
  roomTypeName: string
  isAvailable: boolean
  currentReservationId?: string
  currentGuestName?: string
}

interface ReservationData extends Omit<Reservation, 'guest' | 'roomType'> {
  guest: {
    firstName: string
    lastName: string
  }
  roomTypeName: string
  roomNumber?: string
}

interface BulkRoomAssignmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedReservations: ReservationData[]
  onAssign: (assignments: Map<string, string>) => void
}

interface RoomAssignment {
  reservationId: string
  roomId: string | null
}

export function BulkRoomAssignmentDialog({
  open,
  onOpenChange,
  selectedReservations,
  onAssign
}: BulkRoomAssignmentDialogProps) {
  const [rooms] = useKV<RoomWithDetails[]>('rooms', [])
  const [roomTypes] = useKV<RoomType[]>('room-types', [])
  const [reservations] = useKV<ReservationData[]>('reservations', [])
  const [assignments, setAssignments] = useState<Map<string, string>>(new Map())
  const [autoAssignMode, setAutoAssignMode] = useState<'smart' | 'sequential' | 'manual'>('smart')

  const unassignedReservations = selectedReservations.filter(r => 
    !r.assignedRoomId && (r.status === 'CONFIRMED' || r.status === 'CHECKED_IN')
  )

  const getAvailableRoomsForReservation = (reservation: ReservationData) => {
    const checkInDate = new Date(reservation.checkIn)
    const checkOutDate = new Date(reservation.checkOut)

    return (rooms || []).filter(room => {
      if (room.operationalStatus !== 'AVAILABLE') return false

      const roomType = roomTypes?.find(rt => rt.id === room.roomTypeId)
      if (!roomType) return false

      if (room.roomTypeId !== reservation.roomTypeId) return false

      const conflictingReservations = (reservations || []).filter(r => {
        if (r.id === reservation.id) return false
        if (!r.assignedRoomId || r.assignedRoomId !== room.id) return false
        if (r.status === 'CANCELLED' || r.status === 'CHECKED_OUT' || r.status === 'NO_SHOW') return false

        const rCheckIn = new Date(r.checkIn)
        const rCheckOut = new Date(r.checkOut)

        return (
          (checkInDate >= rCheckIn && checkInDate < rCheckOut) ||
          (checkOutDate > rCheckIn && checkOutDate <= rCheckOut) ||
          (checkInDate <= rCheckIn && checkOutDate >= rCheckOut)
        )
      })

      return conflictingReservations.length === 0
    }).sort((a, b) => {
      const cleanOrder = { 'VACANT_CLEAN': 0, 'OCCUPIED_CLEAN': 1, 'VACANT_DIRTY': 2, 'OCCUPIED_DIRTY': 3 }
      return (cleanOrder[a.cleanStatus] || 0) - (cleanOrder[b.cleanStatus] || 0)
    })
  }

  const handleAutoAssign = () => {
    const newAssignments = new Map<string, string>()
    const assignedRoomIds = new Set<string>()

    if (autoAssignMode === 'smart') {
      const sortedReservations = [...unassignedReservations].sort((a, b) => {
        const aDate = new Date(a.checkIn)
        const bDate = new Date(b.checkIn)
        if (aDate.getTime() !== bDate.getTime()) {
          return aDate.getTime() - bDate.getTime()
        }
        const aNights = differenceInDays(new Date(a.checkOut), new Date(a.checkIn))
        const bNights = differenceInDays(new Date(b.checkOut), new Date(b.checkIn))
        return bNights - aNights
      })

      for (const reservation of sortedReservations) {
        const availableRooms = getAvailableRoomsForReservation(reservation)
          .filter(room => !assignedRoomIds.has(room.id))
        
        if (availableRooms.length > 0) {
          const bestRoom = availableRooms[0]
          newAssignments.set(reservation.id, bestRoom.id)
          assignedRoomIds.add(bestRoom.id)
        }
      }
    } else if (autoAssignMode === 'sequential') {
      for (const reservation of unassignedReservations) {
        const availableRooms = getAvailableRoomsForReservation(reservation)
          .filter(room => !assignedRoomIds.has(room.id))
          .sort((a, b) => a.number.localeCompare(b.number))
        
        if (availableRooms.length > 0) {
          const nextRoom = availableRooms[0]
          newAssignments.set(reservation.id, nextRoom.id)
          assignedRoomIds.add(nextRoom.id)
        }
      }
    }

    setAssignments(newAssignments)
    
    const assignedCount = newAssignments.size
    if (assignedCount === unassignedReservations.length) {
      toast.success(`Auto-assigned all ${assignedCount} reservations`)
    } else {
      toast.warning(`Assigned ${assignedCount} of ${unassignedReservations.length} reservations`)
    }
  }

  const handleManualAssign = (reservationId: string, roomId: string) => {
    setAssignments(prev => {
      const newMap = new Map(prev)
      newMap.set(reservationId, roomId)
      return newMap
    })
  }

  const handleRemoveAssignment = (reservationId: string) => {
    setAssignments(prev => {
      const newMap = new Map(prev)
      newMap.delete(reservationId)
      return newMap
    })
  }

  const handleApplyAssignments = () => {
    if (assignments.size === 0) {
      toast.error('No room assignments to apply')
      return
    }

    onAssign(assignments)
    setAssignments(new Map())
    onOpenChange(false)
  }

  const assignedRoomIds = new Set(assignments.values())

  const getCleanStatusIcon = (status: string) => {
    switch (status) {
      case 'VACANT_CLEAN':
      case 'OCCUPIED_CLEAN':
        return <Sparkle className="w-3 h-3 text-emerald-600" weight="fill" />
      case 'VACANT_DIRTY':
      case 'OCCUPIED_DIRTY':
        return <Broom className="w-3 h-3 text-amber-600" weight="fill" />
      default:
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl">Bulk Room Assignment</DialogTitle>
          <DialogDescription>
            Assign {unassignedReservations.length} unassigned reservation{unassignedReservations.length !== 1 ? 's' : ''} to available rooms
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 py-3 border-y">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Auto-assign mode:</span>
            <Select 
              value={autoAssignMode} 
              onValueChange={(v) => setAutoAssignMode(v as typeof autoAssignMode)}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="smart">Smart (Optimal)</SelectItem>
                <SelectItem value="sequential">Sequential</SelectItem>
                <SelectItem value="manual">Manual Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {autoAssignMode !== 'manual' && (
            <Button 
              variant="outline" 
              onClick={handleAutoAssign}
              disabled={unassignedReservations.length === 0}
            >
              <Sparkle className="w-4 h-4 mr-2" weight="fill" />
              Auto-Assign All
            </Button>
          )}

          <div className="flex-1" />

          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-emerald-500" />
              <span className="text-muted-foreground">Assigned ({assignments.size})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-amber-500" />
              <span className="text-muted-foreground">Pending ({unassignedReservations.length - assignments.size})</span>
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-3 pr-4">
            {unassignedReservations.length === 0 ? (
              <Card className="p-8 text-center">
                <CheckCircle className="w-12 h-12 mx-auto mb-3 text-emerald-500" weight="fill" />
                <p className="font-medium">All selected reservations are already assigned</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Select unassigned reservations to use bulk room assignment
                </p>
              </Card>
            ) : (
              unassignedReservations.map(reservation => {
                const assignedRoomId = assignments.get(reservation.id)
                const assignedRoom = assignedRoomId ? rooms?.find(r => r.id === assignedRoomId) : null
                const availableRooms = getAvailableRoomsForReservation(reservation)
                  .filter(room => !assignedRoomIds.has(room.id) || room.id === assignedRoomId)
                const nights = differenceInDays(new Date(reservation.checkOut), new Date(reservation.checkIn))

                return (
                  <Card 
                    key={reservation.id}
                    className={cn(
                      "p-4 transition-colors",
                      assignedRoomId && "border-emerald-500 bg-emerald-50/50"
                    )}
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <div className={cn(
                            "w-2 h-2 rounded-full flex-shrink-0",
                            assignedRoomId ? "bg-emerald-500" : "bg-amber-500"
                          )} />
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-base truncate">
                              {reservation.guest.firstName} {reservation.guest.lastName}
                            </div>
                            <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                              <span>{format(new Date(reservation.checkIn), 'MMM d')} → {format(new Date(reservation.checkOut), 'MMM d')}</span>
                              <span>•</span>
                              <span>{nights} night{nights !== 1 ? 's' : ''}</span>
                              <span>•</span>
                              <span>{reservation.roomTypeName}</span>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <User className="w-3 h-3" weight="fill" />
                                {reservation.adults + reservation.children}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {assignedRoom ? (
                            <div className="flex items-center gap-2 px-3 py-2 bg-emerald-100 border border-emerald-200 rounded-md">
                              <Key className="w-4 h-4 text-emerald-700" weight="fill" />
                              <span className="font-semibold text-emerald-900">Room {assignedRoom.number}</span>
                              {getCleanStatusIcon(assignedRoom.cleanStatus)}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 -mr-1 ml-2"
                                onClick={() => handleRemoveAssignment(reservation.id)}
                              >
                                <X className="w-3 h-3" weight="bold" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <ArrowRight className="w-4 h-4 text-muted-foreground" weight="bold" />
                              <Select
                                value={assignedRoomId || ''}
                                onValueChange={(roomId) => handleManualAssign(reservation.id, roomId)}
                              >
                                <SelectTrigger className="w-[200px]">
                                  <SelectValue placeholder="Select room..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {availableRooms.length === 0 ? (
                                    <div className="p-2 text-sm text-muted-foreground">
                                      No available rooms
                                    </div>
                                  ) : (
                                    availableRooms.map(room => (
                                      <SelectItem key={room.id} value={room.id}>
                                        <div className="flex items-center gap-2">
                                          <span>Room {room.number}</span>
                                          {getCleanStatusIcon(room.cleanStatus)}
                                        </div>
                                      </SelectItem>
                                    ))
                                  )}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>

                        {availableRooms.length === 0 && !assignedRoomId && (
                          <div className="flex items-center gap-2 mt-2 text-sm text-amber-700 bg-amber-50 px-3 py-1.5 rounded-md">
                            <Warning className="w-4 h-4 flex-shrink-0" weight="fill" />
                            <span>No available rooms for selected dates</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                )
              })
            )}
          </div>
        </ScrollArea>

        <Separator />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleApplyAssignments}
            disabled={assignments.size === 0}
          >
            <CheckCircle className="w-4 h-4 mr-2" weight="fill" />
            Assign {assignments.size} Room{assignments.size !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
