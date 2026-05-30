import { useState, useEffect, useMemo } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { 
  CheckCircle, 
  Circle, 
  Clock, 
  Wrench,
  MagnifyingGlass,
  Broom,
  ListChecks,
  Note,
  User,
  Printer,
  Users,
  ArrowCounterClockwise,
  FunnelSimple,
  SortAscending,
  DeviceMobile
} from '@phosphor-icons/react'
import type { HousekeepingRoom, CleanStatus, MaintenanceIssue } from '@/types/housekeeping'
import { toast } from 'sonner'
import { useRoomSync, convertBoardRoomToHousekeepingRoom } from '@/hooks/use-room-sync'
import { createInitialBoardRooms } from '@/lib/board-data'
import { SERVER_API_ENABLED } from '@/lib/pms-api-client'
import { format } from 'date-fns'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { printHousekeepingReport } from '@/lib/print-utils'
import { RoomDetailSheet } from './RoomDetailSheet'

type FilterOption = 'ALL' | 'DIRTY' | 'CLEANING' | 'CLEAN' | 'INSPECTED' | 'PRIORITY'
type SortOption = 'ROOM_NUMBER' | 'STATUS' | 'PRIORITY'

interface UndoAction {
  roomId: string
  roomNumber: string
  previousStatus: CleanStatus
  newStatus: CleanStatus
}

export function TabletHousekeepingApp() {
  const { rooms: boardRooms, updateRoomStatus, initializeRooms } = useRoomSync()
  const [maintenanceIssues] = useKV<MaintenanceIssue[]>('maintenance-issues', [])
  const [selectedRoom, setSelectedRoom] = useState<HousekeepingRoom | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<FilterOption>('ALL')
  const [sort, setSort] = useState<SortOption>('ROOM_NUMBER')
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null)
  const [staffAssignments] = useKV<Record<string, string>>('room-staff-assignments', {})
  const [staff] = useKV<Array<{ id: string; name: string; color: string }>>('housekeeping-staff', [])
  const [, setPreferredMode] = useKV<'tablet' | 'mobile' | null>('housekeeping-view-mode', 'tablet')

  useEffect(() => {
    if (!SERVER_API_ENABLED && boardRooms.length === 0) {
      initializeRooms(createInitialBoardRooms())
    }
  }, [boardRooms.length, initializeRooms])

  const rooms = useMemo(() => 
    boardRooms.map(convertBoardRoomToHousekeepingRoom),
    [boardRooms]
  )

  const handleQuickUpdate = (roomId: string, newStatus: CleanStatus) => {
    const room = rooms?.find(r => r.roomId === roomId)
    if (!room) return
    
    setUndoAction({
      roomId,
      roomNumber: room.number,
      previousStatus: room.cleanStatus,
      newStatus
    })
    
    updateRoomStatus({
      roomId,
      cleanStatus: newStatus,
      lastCleaned: newStatus === 'CLEAN' || newStatus === 'INSPECTED' ? new Date() : undefined,
      cleanedBy: newStatus === 'CLEAN' || newStatus === 'INSPECTED' ? 'Current User' : undefined
    })

    toast.success(`Room ${room.number} → ${newStatus.toLowerCase()}`, {
      action: {
        label: 'Undo',
        onClick: handleUndo
      }
    })
  }

  const handleUndo = () => {
    if (!undoAction) return
    
    updateRoomStatus({
      roomId: undoAction.roomId,
      cleanStatus: undoAction.previousStatus
    })
    
    toast.success(`Room ${undoAction.roomNumber} restored`)
    setUndoAction(null)
  }

  const filteredAndSortedRooms = useMemo(() => {
    let filtered = rooms || []

    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(r => 
        r.number.toLowerCase().includes(query) ||
        r.guestName?.toLowerCase().includes(query)
      )
    }

    if (filter !== 'ALL') {
      if (filter === 'PRIORITY') {
        filtered = filtered.filter(r => r.isDepartureToday || r.isArrivalToday)
      } else {
        filtered = filtered.filter(r => r.cleanStatus === filter)
      }
    }

    const sorted = [...filtered].sort((a, b) => {
      if (sort === 'PRIORITY') {
        return b.priority - a.priority
      }
      if (sort === 'STATUS') {
        const statusOrder = { DIRTY: 0, CLEANING: 1, CLEAN: 2, INSPECTED: 3 }
        return statusOrder[a.cleanStatus] - statusOrder[b.cleanStatus]
      }
      return a.number.localeCompare(b.number)
    })

    return sorted
  }, [rooms, searchQuery, filter, sort])

  const stats = useMemo(() => {
    const allRooms = rooms || []
    return {
      dirty: allRooms.filter(r => r.cleanStatus === 'DIRTY').length,
      cleaning: allRooms.filter(r => r.cleanStatus === 'CLEANING').length,
      clean: allRooms.filter(r => r.cleanStatus === 'CLEAN').length,
      inspected: allRooms.filter(r => r.cleanStatus === 'INSPECTED').length,
      priority: allRooms.filter(r => r.isDepartureToday || r.isArrivalToday).length,
      total: allRooms.length
    }
  }, [rooms])

  const handlePrint = () => {
    printHousekeepingReport(rooms || [], `Housekeeping Report - ${format(new Date(), 'MMMM d, yyyy')}`, {
      groupByFloor: true,
      includeStatus: true,
      includeAssignments: true,
      staffAssignments: staffAssignments || {},
      staff: staff || []
    })
    toast.success('Opening print preview...')
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <div className="flex-none bg-primary text-primary-foreground">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold">Housekeeping</h1>
              <div className="text-sm opacity-90 mt-0.5">
                {format(new Date(), 'EEEE, MMMM d, yyyy')}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPreferredMode(null)}
                className="gap-2"
              >
                <DeviceMobile size={18} weight="bold" />
                Switch View
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={handlePrint}
                className="gap-2"
              >
                <Printer size={18} weight="bold" />
                Print
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-3 text-center">
            <StatsCard
              label="To Clean"
              value={stats.dirty}
              color="orange"
              active={filter === 'DIRTY'}
              onClick={() => setFilter(filter === 'DIRTY' ? 'ALL' : 'DIRTY')}
            />
            <StatsCard
              label="Cleaning"
              value={stats.cleaning}
              color="purple"
              active={filter === 'CLEANING'}
              onClick={() => setFilter(filter === 'CLEANING' ? 'ALL' : 'CLEANING')}
            />
            <StatsCard
              label="Clean"
              value={stats.clean}
              color="green"
              active={filter === 'CLEAN'}
              onClick={() => setFilter(filter === 'CLEAN' ? 'ALL' : 'CLEAN')}
            />
            <StatsCard
              label="Inspected"
              value={stats.inspected}
              color="blue"
              active={filter === 'INSPECTED'}
              onClick={() => setFilter(filter === 'INSPECTED' ? 'ALL' : 'INSPECTED')}
            />
            <StatsCard
              label="Priority"
              value={stats.priority}
              color="red"
              active={filter === 'PRIORITY'}
              onClick={() => setFilter(filter === 'PRIORITY' ? 'ALL' : 'PRIORITY')}
            />
          </div>
        </div>
      </div>

      <div className="flex-none px-6 py-4 border-b bg-card">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
            <Input
              placeholder="Search by room number or guest name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-11 text-base"
            />
          </div>
          <Button
            variant="outline"
            size="default"
            className="gap-2 min-w-[140px]"
            onClick={() => {
              const options: SortOption[] = ['ROOM_NUMBER', 'STATUS', 'PRIORITY']
              const currentIndex = options.indexOf(sort)
              setSort(options[(currentIndex + 1) % options.length])
            }}
          >
            <SortAscending size={18} weight="bold" />
            {sort === 'ROOM_NUMBER' && 'Room #'}
            {sort === 'STATUS' && 'Status'}
            {sort === 'PRIORITY' && 'Priority'}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {filteredAndSortedRooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Broom size={64} className="mb-4 opacity-30" />
            <p className="text-lg">No rooms found</p>
            {searchQuery && (
              <Button
                variant="link"
                onClick={() => setSearchQuery('')}
                className="mt-2"
              >
                Clear search
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pb-4">
            {filteredAndSortedRooms.map((room) => (
              <RoomCard
                key={room.roomId}
                room={room}
                maintenanceIssues={maintenanceIssues?.filter(i => i.roomId === room.roomId) || []}
                onSelect={setSelectedRoom}
                onQuickUpdate={handleQuickUpdate}
                staffAssignments={staffAssignments || {}}
                staff={staff || []}
              />
            ))}
          </div>
        )}
      </div>

      <RoomDetailSheet
        room={selectedRoom}
        onClose={() => setSelectedRoom(null)}
        onUpdateStatus={(roomId, status) => {
          handleQuickUpdate(roomId, status)
          setSelectedRoom(null)
        }}
        maintenanceIssues={maintenanceIssues?.filter(i => i.roomId === selectedRoom?.roomId) || []}
      />
    </div>
  )
}

interface StatsCardProps {
  label: string
  value: number
  color: 'orange' | 'purple' | 'green' | 'blue' | 'red'
  active: boolean
  onClick: () => void
}

function StatsCard({ label, value, color, active, onClick }: StatsCardProps) {
  const colorClasses = {
    orange: 'bg-orange-500/20 text-orange-100 border-orange-400',
    purple: 'bg-purple-500/20 text-purple-100 border-purple-400',
    green: 'bg-green-500/20 text-green-100 border-green-400',
    blue: 'bg-blue-500/20 text-blue-100 border-blue-400',
    red: 'bg-red-500/20 text-red-100 border-red-400'
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-lg p-3 transition-all border-2',
        active ? colorClasses[color] : 'bg-primary-foreground/10 text-primary-foreground border-transparent hover:bg-primary-foreground/15'
      )}
    >
      <div className="text-3xl font-bold mb-1">{value}</div>
      <div className="text-xs opacity-90 font-medium">{label}</div>
    </button>
  )
}

interface RoomCardProps {
  room: HousekeepingRoom
  maintenanceIssues: MaintenanceIssue[]
  onSelect: (room: HousekeepingRoom) => void
  onQuickUpdate: (roomId: string, status: CleanStatus) => void
  staffAssignments: Record<string, string>
  staff: Array<{ id: string; name: string; color: string }>
}

function RoomCard({ room, maintenanceIssues, onSelect, onQuickUpdate, staffAssignments, staff }: RoomCardProps) {
  const assignedStaff = staff?.find(s => staffAssignments?.[room.roomId] === s.id)

  const statusConfig = {
    CLEAN: { 
      color: 'bg-green-50 border-green-200', 
      dotColor: 'bg-green-500',
      textColor: 'text-green-700',
      action: { status: 'INSPECTED' as CleanStatus, label: 'Inspect', icon: CheckCircle, bg: 'bg-blue-500' }
    },
    DIRTY: { 
      color: 'bg-orange-50 border-orange-200', 
      dotColor: 'bg-orange-500',
      textColor: 'text-orange-700',
      action: { status: 'CLEAN' as CleanStatus, label: 'Clean', icon: CheckCircle, bg: 'bg-green-500' }
    },
    INSPECTED: { 
      color: 'bg-blue-50 border-blue-200', 
      dotColor: 'bg-blue-500',
      textColor: 'text-blue-700',
      action: { status: 'DIRTY' as CleanStatus, label: 'Dirty', icon: Circle, bg: 'bg-orange-500' }
    },
    CLEANING: { 
      color: 'bg-purple-50 border-purple-200', 
      dotColor: 'bg-purple-500',
      textColor: 'text-purple-700',
      action: { status: 'CLEAN' as CleanStatus, label: 'Done', icon: CheckCircle, bg: 'bg-green-500' }
    },
  }

  const config = statusConfig[room.cleanStatus]
  const ActionIcon = config.action.icon

  return (
    <Card className={cn('overflow-hidden hover:shadow-md transition-shadow border-2', config.color)}>
      <button
        onClick={() => onSelect(room)}
        className="w-full text-left"
      >
        <div className="p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <div className={cn('w-3 h-3 rounded-full', config.dotColor)} />
              <span className="text-2xl font-bold">{room.number}</span>
            </div>
            {assignedStaff && (
              <div 
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm"
                style={{ backgroundColor: assignedStaff.color }}
                title={assignedStaff.name}
              >
                {assignedStaff.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 min-h-[24px]">
            {room.isArrivalToday && (
              <Badge className="bg-green-600 text-white text-[10px] px-2 py-0.5 h-5">
                ↓ {room.arrivalTime}
              </Badge>
            )}
            {room.isDepartureToday && (
              <Badge className="bg-orange-600 text-white text-[10px] px-2 py-0.5 h-5">
                ↑ {room.checkOutTime}
              </Badge>
            )}
            {room.isOccupied && room.guestCount && room.guestCount > 0 && (
              <Badge variant="outline" className="text-[10px] px-2 py-0.5 h-5 border-current">
                <Users size={10} className="mr-1" weight="bold" />
                {room.guestCount}
              </Badge>
            )}
            {maintenanceIssues.length > 0 && (
              <Badge variant="destructive" className="text-[10px] px-2 py-0.5 h-5">
                <Wrench size={10} className="mr-1" weight="bold" />
                {maintenanceIssues.length}
              </Badge>
            )}
          </div>

          {room.guestName && (
            <div className="text-sm text-muted-foreground truncate">
              <User size={14} className="inline mr-1" weight="bold" />
              {room.guestName}
            </div>
          )}

          {room.specialInstructions && (
            <div className="text-xs text-muted-foreground line-clamp-2">
              <Note size={12} className="inline mr-1" weight="bold" />
              {room.specialInstructions}
            </div>
          )}
        </div>
      </button>

      <div className="border-t px-4 py-2 bg-background/50">
        <Button
          size="sm"
          className={cn('w-full gap-2 h-9 font-semibold', config.action.bg, 'text-white hover:opacity-90')}
          onClick={(e) => {
            e.stopPropagation()
            onQuickUpdate(room.roomId, config.action.status)
          }}
        >
          <ActionIcon size={16} weight="bold" />
          {config.action.label}
        </Button>
      </div>
    </Card>
  )
}
