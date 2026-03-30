import { useState, useEffect } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  Broom, 
  CheckCircle, 
  Circle, 
  Clock, 
  Wrench,
  Warning,
  CaretRight
} from '@phosphor-icons/react'
import type { HousekeepingRoom, CleanStatus, MaintenanceIssue } from '@/types/housekeeping'
import { toast } from 'sonner'

export function MobileHousekeepingView() {
  const [rooms, setRooms] = useKV<HousekeepingRoom[]>('housekeeping-rooms', [])
  const [selectedRoom, setSelectedRoom] = useState<HousekeepingRoom | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)

  useEffect(() => {
    if (!rooms || rooms.length === 0) {
      initializeMockRooms()
    }
  }, [])

  const initializeMockRooms = () => {
    const mockRooms: HousekeepingRoom[] = [
      {
        roomId: '1',
        number: '201',
        floor: 2,
        type: 'TWIN',
        cleanStatus: 'DIRTY',
        isOccupied: false,
        isDepartureToday: true,
        isArrivalToday: true,
        guestName: 'John Smith',
        checkOutTime: '11:00',
        priority: 10,
        hasMaintenanceIssue: false,
        needsDeepClean: false,
        arrivalTime: '14:00'
      },
      {
        roomId: '2',
        number: '202',
        floor: 2,
        type: 'TWIN',
        cleanStatus: 'DIRTY',
        isOccupied: false,
        isDepartureToday: true,
        isArrivalToday: false,
        priority: 8,
        hasMaintenanceIssue: false,
        needsDeepClean: false
      },
      {
        roomId: '3',
        number: '301',
        floor: 3,
        type: 'DOUBLE',
        cleanStatus: 'CLEAN',
        isOccupied: true,
        isDepartureToday: false,
        isArrivalToday: false,
        guestName: 'Sarah Johnson',
        priority: 3,
        hasMaintenanceIssue: false,
        needsDeepClean: false
      },
      {
        roomId: '4',
        number: '302',
        floor: 3,
        type: 'DOUBLE',
        cleanStatus: 'DIRTY',
        isOccupied: true,
        isDepartureToday: false,
        isArrivalToday: false,
        guestName: 'Mike Chen',
        priority: 5,
        hasMaintenanceIssue: true,
        maintenanceNotes: 'AC not cooling properly',
        needsDeepClean: false
      }
    ]
    setRooms(mockRooms)
  }

  const updateRoomStatus = (roomId: string, newStatus: CleanStatus) => {
    setIsUpdating(true)
    setRooms((current) => {
      if (!current) return []
      return current.map(room => 
        room.roomId === roomId 
          ? { 
              ...room, 
              cleanStatus: newStatus,
              lastCleaned: newStatus === 'CLEAN' ? new Date() : room.lastCleaned,
              cleanedBy: newStatus === 'CLEAN' ? 'Current User' : room.cleanedBy
            }
          : room
      )
    })
    
    setTimeout(() => {
      setIsUpdating(false)
      setSelectedRoom(null)
      const roomNumber = rooms?.find(r => r.roomId === roomId)?.number
      toast.success(`Room ${roomNumber} updated to ${newStatus}`)
    }, 300)
  }

  const dirtyRooms = (rooms || []).filter(r => r.cleanStatus === 'DIRTY').sort((a, b) => b.priority - a.priority)
  const cleanRooms = (rooms || []).filter(r => r.cleanStatus === 'CLEAN')
  const inProgressRooms = (rooms || []).filter(r => r.cleanStatus === 'CLEANING')
  const maintenanceRooms = (rooms || []).filter(r => r.hasMaintenanceIssue)

  const checkoutRooms = dirtyRooms.filter(r => r.isDepartureToday)
  const stayoverRooms = dirtyRooms.filter(r => !r.isDepartureToday)

  if (selectedRoom) {
    return <RoomDetailView 
      room={selectedRoom} 
      onBack={() => setSelectedRoom(null)}
      onUpdateStatus={updateRoomStatus}
      isUpdating={isUpdating}
    />
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="sticky top-0 z-10 bg-primary text-primary-foreground px-4 py-6 shadow-lg">
        <h1 className="text-2xl font-semibold">Housekeeping</h1>
        <div className="flex gap-4 mt-4 text-sm">
          <div>
            <div className="text-3xl font-bold">{checkoutRooms.length}</div>
            <div className="opacity-90">Checkouts</div>
          </div>
          <div>
            <div className="text-3xl font-bold">{dirtyRooms.length}</div>
            <div className="opacity-90">To Clean</div>
          </div>
          <div>
            <div className="text-3xl font-bold">{cleanRooms.length}</div>
            <div className="opacity-90">Ready</div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="checkouts" className="w-full">
        <TabsList className="w-full rounded-none border-b sticky top-[116px] bg-background z-10">
          <TabsTrigger value="checkouts" className="flex-1">
            Checkouts ({checkoutRooms.length})
          </TabsTrigger>
          <TabsTrigger value="stayovers" className="flex-1">
            Stayovers ({stayoverRooms.length})
          </TabsTrigger>
          <TabsTrigger value="maintenance" className="flex-1">
            Issues ({maintenanceRooms.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="checkouts" className="m-0 px-4 pt-4">
          <div className="space-y-3">
            {checkoutRooms.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <CheckCircle size={48} className="mx-auto mb-3 opacity-50" />
                <p>All checkout rooms cleaned!</p>
              </div>
            ) : (
              checkoutRooms.map(room => (
                <RoomCard key={room.roomId} room={room} onSelect={setSelectedRoom} />
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="stayovers" className="m-0 px-4 pt-4">
          <div className="space-y-3">
            {stayoverRooms.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <CheckCircle size={48} className="mx-auto mb-3 opacity-50" />
                <p>All stayover rooms cleaned!</p>
              </div>
            ) : (
              stayoverRooms.map(room => (
                <RoomCard key={room.roomId} room={room} onSelect={setSelectedRoom} />
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="maintenance" className="m-0 px-4 pt-4">
          <div className="space-y-3">
            {maintenanceRooms.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <CheckCircle size={48} className="mx-auto mb-3 opacity-50" />
                <p>No maintenance issues!</p>
              </div>
            ) : (
              maintenanceRooms.map(room => (
                <RoomCard key={room.roomId} room={room} onSelect={setSelectedRoom} showMaintenance />
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

interface RoomCardProps {
  room: HousekeepingRoom
  onSelect: (room: HousekeepingRoom) => void
  showMaintenance?: boolean
}

function RoomCard({ room, onSelect, showMaintenance }: RoomCardProps) {
  return (
    <Card 
      className="p-4 active:scale-[0.98] transition-transform cursor-pointer"
      onClick={() => onSelect(room)}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <div className="text-2xl font-bold">{room.number}</div>
            <Badge variant="secondary" className="text-xs">
              {room.type}
            </Badge>
            {room.isArrivalToday && (
              <Badge variant="default" className="text-xs bg-green-600">
                Arrival {room.arrivalTime}
              </Badge>
            )}
          </div>
          
          {room.guestName && (
            <div className="text-sm text-muted-foreground mb-1">
              {room.guestName}
            </div>
          )}
          
          {room.isDepartureToday && room.checkOutTime && (
            <div className="flex items-center gap-1 text-sm text-orange-600 dark:text-orange-400">
              <Clock size={14} weight="bold" />
              <span>Checkout {room.checkOutTime}</span>
            </div>
          )}

          {showMaintenance && room.maintenanceNotes && (
            <div className="flex items-start gap-2 mt-2 text-sm">
              <Wrench size={16} className="text-red-600 mt-0.5 flex-shrink-0" weight="bold" />
              <span className="text-red-600 dark:text-red-400">{room.maintenanceNotes}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={room.cleanStatus} />
          <CaretRight size={20} className="text-muted-foreground" />
        </div>
      </div>
    </Card>
  )
}

interface RoomDetailViewProps {
  room: HousekeepingRoom
  onBack: () => void
  onUpdateStatus: (roomId: string, status: CleanStatus) => void
  isUpdating: boolean
}

function RoomDetailView({ room, onBack, onUpdateStatus, isUpdating }: RoomDetailViewProps) {
  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-primary text-primary-foreground px-4 py-6 shadow-lg">
        <button 
          onClick={onBack}
          className="mb-4 text-primary-foreground hover:opacity-80 transition-opacity"
        >
          ← Back
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-1">Room {room.number}</h1>
            <div className="text-sm opacity-90">
              {room.type} • Floor {room.floor}
            </div>
          </div>
          <StatusBadge status={room.cleanStatus} large />
        </div>
      </div>

      <div className="p-4 space-y-4">
        {room.isArrivalToday && (
          <Card className="p-4 bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-300 font-medium">
              <Warning size={20} weight="bold" />
              <span>Arrival Today at {room.arrivalTime}</span>
            </div>
            <div className="text-sm text-green-600 dark:text-green-400 mt-1">
              Priority cleaning required
            </div>
          </Card>
        )}

        {room.isDepartureToday && (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock size={20} weight="bold" />
              <span className="font-medium">Departure Details</span>
            </div>
            <div className="text-sm text-muted-foreground">
              Checkout time: {room.checkOutTime}
            </div>
            {room.guestName && (
              <div className="text-sm text-muted-foreground">
                Guest: {room.guestName}
              </div>
            )}
          </Card>
        )}

        {room.hasMaintenanceIssue && (
          <Card className="p-4 bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-300 font-medium mb-2">
              <Wrench size={20} weight="bold" />
              <span>Maintenance Issue</span>
            </div>
            <div className="text-sm text-red-600 dark:text-red-400">
              {room.maintenanceNotes}
            </div>
          </Card>
        )}

        <div className="space-y-2 pt-4">
          <h3 className="font-medium mb-3">Update Room Status</h3>
          
          {room.cleanStatus === 'DIRTY' && (
            <>
              <Button
                size="lg"
                className="w-full h-16 text-lg"
                variant="default"
                onClick={() => onUpdateStatus(room.roomId, 'CLEANING')}
                disabled={isUpdating}
              >
                <Broom size={24} className="mr-2" weight="bold" />
                Start Cleaning
              </Button>
              
              <Button
                size="lg"
                className="w-full h-16 text-lg"
                variant="outline"
                onClick={() => onUpdateStatus(room.roomId, 'CLEAN')}
                disabled={isUpdating}
              >
                <CheckCircle size={24} className="mr-2" weight="bold" />
                Mark as Clean
              </Button>
            </>
          )}

          {room.cleanStatus === 'CLEANING' && (
            <Button
              size="lg"
              className="w-full h-16 text-lg"
              variant="default"
              onClick={() => onUpdateStatus(room.roomId, 'CLEAN')}
              disabled={isUpdating}
            >
              <CheckCircle size={24} className="mr-2" weight="bold" />
              Finish Cleaning
            </Button>
          )}

          {room.cleanStatus === 'CLEAN' && (
            <Button
              size="lg"
              className="w-full h-16 text-lg"
              variant="outline"
              onClick={() => onUpdateStatus(room.roomId, 'INSPECTED')}
              disabled={isUpdating}
            >
              <CheckCircle size={24} className="mr-2" weight="bold" />
              Mark as Inspected
            </Button>
          )}

          {room.cleanStatus !== 'DIRTY' && (
            <Button
              size="lg"
              className="w-full h-16 text-lg"
              variant="outline"
              onClick={() => onUpdateStatus(room.roomId, 'DIRTY')}
              disabled={isUpdating}
            >
              <Circle size={24} className="mr-2" />
              Mark as Dirty
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

interface StatusBadgeProps {
  status: CleanStatus
  large?: boolean
}

function StatusBadge({ status, large }: StatusBadgeProps) {
  const config = {
    CLEAN: { label: 'Clean', className: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300' },
    DIRTY: { label: 'Dirty', className: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
    INSPECTED: { label: 'Inspected', className: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
    CLEANING: { label: 'Cleaning', className: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300' },
  }

  const { label, className } = config[status]

  return (
    <Badge 
      className={`${className} ${large ? 'text-base px-4 py-1' : 'text-xs'}`}
      variant="secondary"
    >
      {label}
    </Badge>
  )
}
