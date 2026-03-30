import { useState, useMemo, useEffect } from 'react'
import type { BoardRoomCard, DragOperation } from '@/types/board'
import { RoomCard } from './RoomCard'
import { BoardStatsBar } from './BoardStatsBar'
import { QuickActionsBar } from './QuickActionsBar'
import { StatusLegend } from './StatusLegend'
import { generateMockBoardData, calculateBoardStats } from '@/lib/mock-board-data'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { MagnifyingGlass, Funnel, Command, CaretDown, CaretRight, Info } from '@phosphor-icons/react'
import { Card } from '@/components/ui/card'
import { toast } from 'sonner'
import { CommandPalette } from '@/components/CommandPalette'
import { useCommandPalette } from '@/hooks/use-command-palette'
import { useNavigation } from '@/hooks/use-navigation'
import { createPMSCommands } from '@/lib/pms-commands'
import { useRoomSync } from '@/hooks/use-room-sync'
import { cn } from '@/lib/utils'
import { addDays, format, isSameDay } from 'date-fns'

export function Board() {
  const { rooms, lastUpdate, initializeRooms } = useRoomSync()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRoom, setSelectedRoom] = useState<BoardRoomCard | null>(null)
  const [draggingRoom, setDraggingRoom] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'7day' | '14day' | '30day'>('7day')
  const [collapsedRoomTypes, setCollapsedRoomTypes] = useState<Set<string>>(new Set())
  const [startDate] = useState(new Date())
  
  const { navigate } = useNavigation()
  const commands = useMemo(() => createPMSCommands(navigate), [navigate])
  const commandPalette = useCommandPalette(commands)

  const stats = useMemo(() => calculateBoardStats(rooms), [rooms])

  useEffect(() => {
    if (rooms.length === 0) {
      initializeRooms(generateMockBoardData())
    }
  }, [rooms.length, initializeRooms])

  useEffect(() => {
    if (lastUpdate) {
      const room = rooms.find(r => r.roomId === lastUpdate.roomId)
      if (room) {
        toast.success(
          `Room ${room.number} updated to ${lastUpdate.cleanStatus}`,
          { duration: 2000 }
        )
      }
    }
  }, [lastUpdate, rooms])

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedRoom) {
        setSelectedRoom(null)
      }
      
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('input[type="text"]')?.focus()
      }

      if ((e.metaKey || e.ctrlKey) && e.key === '1') {
        e.preventDefault()
        setViewMode('7day')
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '2') {
        e.preventDefault()
        setViewMode('14day')
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '3') {
        e.preventDefault()
        setViewMode('30day')
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [selectedRoom])

  const dayCount = viewMode === '7day' ? 7 : viewMode === '14day' ? 14 : 30
  
  const dateColumns = useMemo(() => {
    return Array.from({ length: dayCount }, (_, i) => addDays(startDate, i))
  }, [startDate, dayCount])

  const filteredRooms = useMemo(() => {
    if (!searchQuery) return rooms
    
    const query = searchQuery.toLowerCase()
    return rooms.filter(room => 
      room.number.includes(query) ||
      room.guestName?.toLowerCase().includes(query) ||
      room.type.toLowerCase().includes(query)
    )
  }, [rooms, searchQuery])

  const twinRooms = useMemo(() => 
    filteredRooms.filter(r => r.type === 'TWIN').sort((a, b) => Number(a.number) - Number(b.number)),
    [filteredRooms]
  )

  const doubleRooms = useMemo(() => 
    filteredRooms.filter(r => r.type === 'DOUBLE').sort((a, b) => Number(a.number) - Number(b.number)),
    [filteredRooms]
  )

  const toggleRoomType = (roomType: string) => {
    setCollapsedRoomTypes(prev => {
      const next = new Set(prev)
      if (next.has(roomType)) {
        next.delete(roomType)
      } else {
        next.add(roomType)
      }
      return next
    })
  }

  const handleRoomClick = (room: BoardRoomCard) => {
    setSelectedRoom(room)
  }

  const handleDragStart = (room: BoardRoomCard) => (e: React.DragEvent) => {
    if (!room.guestName || !room.reservationId) return
    
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'MOVE_GUEST',
      sourceRoomId: room.roomId,
      reservationId: room.reservationId,
      guestName: room.guestName,
    } as DragOperation))
    
    setDraggingRoom(room.roomId)
  }

  const handleDragOver = (room: BoardRoomCard) => (e: React.DragEvent) => {
    if (!draggingRoom) return
    if (room.roomId === draggingRoom) return
    
    if (room.operationalStatus === 'AVAILABLE' && 
        (room.status === 'VACANT_CLEAN' || room.status === 'VACANT_DIRTY')) {
      e.preventDefault()
      setDropTarget(room.roomId)
    }
  }

  const handleDragLeave = () => {
    setDropTarget(null)
  }

  const handleDrop = (targetRoom: BoardRoomCard) => (e: React.DragEvent) => {
    e.preventDefault()
    
    if (!draggingRoom) return
    
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json')) as DragOperation
      
      if (targetRoom.operationalStatus === 'AVAILABLE' && 
          (targetRoom.status === 'VACANT_CLEAN' || targetRoom.status === 'VACANT_DIRTY')) {
        
        const sourceRoom = rooms.find(r => r.roomId === data.sourceRoomId)
        
        toast.success(`Guest ${data.guestName} moved from Room ${sourceRoom?.number} to Room ${targetRoom.number}`)
      }
    } catch (error) {
      toast.error('Failed to move guest')
    } finally {
      setDraggingRoom(null)
      setDropTarget(null)
    }
  }

  const handleDragEnd = () => {
    setDraggingRoom(null)
    setDropTarget(null)
  }

  return (
    <div className="h-full flex flex-col bg-background p-4 gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Room Board</h1>
          <p className="text-xs text-muted-foreground">Sandbox Hotel — 30 Rooms</p>
        </div>
        
        <div className="flex items-center gap-2">
          {lastUpdate && (
            <div className="text-xs text-muted-foreground flex items-center gap-1 mr-2">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span>Live sync active</span>
            </div>
          )}
          <Button 
            variant="outline" 
            size="sm"
            onClick={commandPalette.open}
            className="gap-2"
          >
            <Command className="w-4 h-4" />
            <span className="hidden md:inline">Commands</span>
            <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground md:inline-flex">
              <span className="text-xs">⌘</span>K
            </kbd>
          </Button>
          <div className="relative w-64">
            <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search rooms, guests..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
          <Button variant="outline" size="sm" className="h-9 w-9 p-0">
            <Funnel className="w-4 h-4" />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 w-9 p-0">
                <Info className="w-4 h-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[480px]">
              <StatusLegend />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <BoardStatsBar stats={stats} />

      <QuickActionsBar 
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        filterCount={0}
      />

      <div className="flex-1 overflow-auto">
        <div className="calendar-board">
          <div className="sticky top-0 z-20 bg-background pb-2">
            <div className="flex border-b border-border">
              <div className="w-32 flex-shrink-0 border-r border-border py-2 px-3">
                <div className="text-xs font-medium text-muted-foreground">Room Type</div>
              </div>
              
              <div className="flex-1 flex overflow-x-auto">
                {dateColumns.map((date, i) => {
                  const isToday = isSameDay(date, new Date())
                  return (
                    <div 
                      key={i} 
                      className={cn(
                        "flex-1 min-w-[100px] border-r border-border py-2 px-2 text-center",
                        isToday && "bg-primary/5"
                      )}
                    >
                      <div className={cn(
                        "text-[10px] font-medium uppercase tracking-wide",
                        isToday ? "text-primary" : "text-muted-foreground"
                      )}>
                        {format(date, 'EEE')}
                      </div>
                      <div className={cn(
                        "text-sm font-semibold",
                        isToday ? "text-primary" : "text-foreground"
                      )}>
                        {format(date, 'd')}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {format(date, 'MMM')}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <RoomTypeRow
              title="Twin Rooms"
              subtitle="Floor 2"
              rooms={twinRooms}
              dateColumns={dateColumns}
              isCollapsed={collapsedRoomTypes.has('TWIN')}
              onToggleCollapse={() => toggleRoomType('TWIN')}
              onRoomClick={handleRoomClick}
              draggingRoom={draggingRoom}
              dropTarget={dropTarget}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragLeave={handleDragLeave}
              onDragEnd={handleDragEnd}
            />

            <RoomTypeRow
              title="Double Rooms"
              subtitle="Floor 3"
              rooms={doubleRooms}
              dateColumns={dateColumns}
              isCollapsed={collapsedRoomTypes.has('DOUBLE')}
              onToggleCollapse={() => toggleRoomType('DOUBLE')}
              onRoomClick={handleRoomClick}
              draggingRoom={draggingRoom}
              dropTarget={dropTarget}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragLeave={handleDragLeave}
              onDragEnd={handleDragEnd}
            />
          </div>
        </div>
      </div>

      <Sheet open={!!selectedRoom} onOpenChange={(open) => !open && setSelectedRoom(null)}>
        <SheetContent className="w-[500px] sm:w-[600px]">
          {selectedRoom && (
            <>
              <SheetHeader>
                <SheetTitle>Room {selectedRoom.number} — {selectedRoom.type}</SheetTitle>
              </SheetHeader>
              
              <div className="mt-6 space-y-6">
                <Card className="p-4">
                  <div className="text-sm font-medium text-muted-foreground mb-2">Status</div>
                  <div className="text-lg font-semibold">{selectedRoom.status.replace('_', ' ')}</div>
                </Card>

                {selectedRoom.guestName && (
                  <Card className="p-4 space-y-3">
                    <div>
                      <div className="text-sm font-medium text-muted-foreground mb-1">Guest</div>
                      <div className="text-lg font-semibold">{selectedRoom.guestName}</div>
                    </div>
                    
                    {selectedRoom.checkIn && selectedRoom.checkOut && (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-sm font-medium text-muted-foreground mb-1">Check-in</div>
                          <div>{new Date(selectedRoom.checkIn).toLocaleDateString()}</div>
                        </div>
                        <div>
                          <div className="text-sm font-medium text-muted-foreground mb-1">Check-out</div>
                          <div>{new Date(selectedRoom.checkOut).toLocaleDateString()}</div>
                        </div>
                      </div>
                    )}
                    
                    {selectedRoom.nightsRemaining !== undefined && (
                      <div>
                        <div className="text-sm font-medium text-muted-foreground mb-1">Nights Remaining</div>
                        <div>{selectedRoom.nightsRemaining} night{selectedRoom.nightsRemaining !== 1 ? 's' : ''}</div>
                      </div>
                    )}
                  </Card>
                )}

                <Card className="p-4">
                  <div className="text-sm font-medium text-muted-foreground mb-2">Housekeeping</div>
                  <div className="text-lg font-semibold">{selectedRoom.cleanStatus}</div>
                </Card>

                {selectedRoom.balanceDue && selectedRoom.balanceDue > 0 && (
                  <Card className="p-4 bg-orange-50 border-orange-200">
                    <div className="text-sm font-medium text-orange-900 mb-1">Balance Due</div>
                    <div className="text-2xl font-bold text-orange-600">฿{selectedRoom.balanceDue.toLocaleString()}</div>
                  </Card>
                )}

                <div className="pt-4 space-y-2">
                  <Button className="w-full" variant="default">Check Out</Button>
                  <Button className="w-full" variant="outline">Move Guest</Button>
                  <Button className="w-full" variant="outline">Add Charge</Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <CommandPalette
        open={commandPalette.isOpen}
        onOpenChange={commandPalette.close}
        commands={commands}
      />
    </div>
  )
}

interface RoomTypeRowProps {
  title: string
  subtitle: string
  rooms: BoardRoomCard[]
  dateColumns: Date[]
  isCollapsed: boolean
  onToggleCollapse: () => void
  onRoomClick: (room: BoardRoomCard) => void
  draggingRoom: string | null
  dropTarget: string | null
  onDragStart: (room: BoardRoomCard) => (e: React.DragEvent) => void
  onDragOver: (room: BoardRoomCard) => (e: React.DragEvent) => void
  onDrop: (room: BoardRoomCard) => (e: React.DragEvent) => void
  onDragLeave: () => void
  onDragEnd: () => void
}

function RoomTypeRow({
  title,
  subtitle,
  rooms,
  dateColumns,
  isCollapsed,
  onToggleCollapse,
  onRoomClick,
  draggingRoom,
  dropTarget,
  onDragStart,
  onDragOver,
  onDrop,
  onDragLeave,
  onDragEnd,
}: RoomTypeRowProps) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={onToggleCollapse}
        className="w-full flex items-center gap-2 px-3 py-2 bg-card hover:bg-accent/50 transition-colors border-b border-border"
      >
        {isCollapsed ? (
          <CaretRight className="w-4 h-4 text-muted-foreground" />
        ) : (
          <CaretDown className="w-4 h-4 text-muted-foreground" />
        )}
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-muted-foreground">{subtitle} •</span>
          <span>{title}</span>
          <span className="text-xs text-muted-foreground">({rooms.length})</span>
        </div>
      </button>

      {!isCollapsed && (
        <div className="divide-y divide-border/50">
          {rooms.map((room) => (
            <CalendarRoomRow
              key={room.roomId}
              room={room}
              dateColumns={dateColumns}
              onClick={() => onRoomClick(room)}
              isDragging={draggingRoom === room.roomId}
              isDropTarget={dropTarget === room.roomId}
              onDragStart={onDragStart(room)}
              onDragOver={onDragOver(room)}
              onDrop={onDrop(room)}
              onDragLeave={onDragLeave}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface CalendarRoomRowProps {
  room: BoardRoomCard
  dateColumns: Date[]
  onClick: () => void
  isDragging: boolean
  isDropTarget: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDragEnd: () => void
}

function CalendarRoomRow({
  room,
  dateColumns,
  onClick,
  isDragging,
  isDropTarget,
  onDragStart,
  onDragOver,
  onDrop,
  onDragLeave,
  onDragEnd,
}: CalendarRoomRowProps) {
  const getStatusColor = (status: BoardRoomCard['status']) => {
    switch (status) {
      case 'OCCUPIED_CLEAN':
        return 'bg-primary/20 border-primary/40'
      case 'OCCUPIED_DIRTY':
        return 'bg-destructive/20 border-destructive/40'
      case 'VACANT_CLEAN':
        return 'bg-green-500/10 border-green-500/30'
      case 'VACANT_DIRTY':
        return 'bg-orange-500/10 border-orange-500/30'
      default:
        return 'bg-muted border-border'
    }
  }

  const getCleanStatusIndicator = (cleanStatus: 'CLEAN' | 'DIRTY' | 'INSPECTED') => {
    switch (cleanStatus) {
      case 'CLEAN':
        return 'bg-green-500'
      case 'DIRTY':
        return 'bg-orange-500'
      case 'INSPECTED':
        return 'bg-blue-500'
    }
  }

  const isRoomOccupied = room.guestName && room.reservationId

  return (
    <div className="flex hover:bg-accent/20 transition-colors">
      <div 
        className="w-32 flex-shrink-0 border-r border-border py-2 px-3 flex items-center gap-2 cursor-pointer"
        onClick={onClick}
      >
        <div className={cn("w-1.5 h-1.5 rounded-full", getCleanStatusIndicator(room.cleanStatus))} />
        <div className="text-sm font-medium">{room.number}</div>
        {room.operationalStatus === 'OUT_OF_SERVICE' && (
          <div className="ml-auto w-2 h-2 rounded-full bg-destructive" />
        )}
        {room.operationalStatus === 'BLOCKED' && (
          <div className="ml-auto w-2 h-2 rounded-full bg-orange-500" />
        )}
      </div>
      
      <div className="flex-1 flex overflow-x-auto">
        {dateColumns.map((date, i) => {
          const isInStay = room.checkIn && room.checkOut &&
            date >= room.checkIn && date < room.checkOut

          const isCheckIn = room.checkIn && isSameDay(date, room.checkIn)
          const isCheckOut = room.checkOut && isSameDay(date, room.checkOut)
          const isToday = isSameDay(date, new Date())

          return (
            <div 
              key={i}
              className={cn(
                "flex-1 min-w-[100px] border-r border-border py-2 px-1 relative",
                isToday && "bg-primary/5"
              )}
              draggable={!!(isRoomOccupied && isInStay)}
              onDragStart={isInStay ? onDragStart : undefined}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onDragLeave={onDragLeave}
              onDragEnd={onDragEnd}
            >
              {isInStay && (
                <div 
                  className={cn(
                    "h-full rounded border cursor-move transition-all",
                    getStatusColor(room.status),
                    isDragging && "opacity-40",
                    isDropTarget && !isDragging && "ring-2 ring-primary"
                  )}
                  onClick={onClick}
                >
                  <div className="px-2 py-1">
                    {isCheckIn && (
                      <div className="text-[10px] font-medium truncate">
                        {room.guestName}
                      </div>
                    )}
                    {room.isArrivalToday && isCheckIn && (
                      <div className="text-[9px] text-primary font-medium">→ IN</div>
                    )}
                    {room.isDepartureToday && isCheckOut && (
                      <div className="text-[9px] text-destructive font-medium">← OUT</div>
                    )}
                    {room.depositStatus === 'PENDING' && isCheckIn && (
                      <div className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-0.5" />
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
