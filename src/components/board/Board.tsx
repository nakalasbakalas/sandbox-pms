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
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { MagnifyingGlass, Funnel, Command, CaretDown, CaretRight, Info, X, Check, Broom, SignOut, Users, Warning } from '@phosphor-icons/react'
import { Card } from '@/components/ui/card'
import { toast } from 'sonner'
import { CommandPalette } from '@/components/CommandPalette'
import { useCommandPalette } from '@/hooks/use-command-palette'
import { useNavigation } from '@/hooks/use-navigation'
import { createPMSCommands } from '@/lib/pms-commands'
import { useRoomSync } from '@/hooks/use-room-sync'
import { cn } from '@/lib/utils'
import { addDays, format, isSameDay, isWeekend } from 'date-fns'

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

      <div className="flex-1 overflow-auto rounded-lg border border-border bg-card">
        <div className="calendar-board">
          <div className="sticky top-0 z-20 bg-card border-b-2 border-border">
            <div className="flex">
              <div className="w-36 flex-shrink-0 border-r border-border py-3 px-4 bg-muted/30">
                <div className="text-xs font-semibold text-foreground">Room</div>
              </div>
              
              <div className="flex-1 flex overflow-x-auto">
                {dateColumns.map((date, i) => {
                  const isToday = isSameDay(date, new Date())
                  const isWeekendDay = isWeekend(date)
                  return (
                    <div 
                      key={i} 
                      className={cn(
                        "flex-1 min-w-[110px] border-r border-border py-3 px-3 text-center transition-colors",
                        isToday && "bg-primary/10 border-primary/30",
                        isWeekendDay && !isToday && "bg-accent/5"
                      )}
                    >
                      <div className={cn(
                        "text-[10px] font-semibold uppercase tracking-wider mb-0.5",
                        isToday ? "text-primary" : isWeekendDay ? "text-accent-foreground/70" : "text-muted-foreground"
                      )}>
                        {format(date, 'EEE')}
                      </div>
                      <div className={cn(
                        "text-lg font-bold mb-0.5",
                        isToday ? "text-primary" : "text-foreground"
                      )}>
                        {format(date, 'd')}
                      </div>
                      <div className={cn(
                        "text-[10px]",
                        isToday ? "text-primary/70" : "text-muted-foreground"
                      )}>
                        {format(date, 'MMM')}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div>
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
                <SheetTitle className="flex items-center gap-3">
                  <span>Room {selectedRoom.number}</span>
                  <Badge variant="outline" className="text-xs">
                    {selectedRoom.type}
                  </Badge>
                  {selectedRoom.isVIP && (
                    <Badge className="text-xs bg-amber-500 hover:bg-amber-600">
                      VIP
                    </Badge>
                  )}
                </SheetTitle>
              </SheetHeader>
              
              <div className="mt-6 space-y-4">
                <Card className={cn(
                  "p-4 border-2 transition-colors",
                  selectedRoom.status.includes('OCCUPIED') && "bg-primary/5 border-primary/20",
                  selectedRoom.status.includes('VACANT_CLEAN') && "bg-green-500/5 border-green-500/20",
                  selectedRoom.status.includes('VACANT_DIRTY') && "bg-orange-500/5 border-orange-500/20"
                )}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">Current Status</div>
                      <div className="text-lg font-bold">
                        {selectedRoom.status.replace('_', ' ')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={selectedRoom.cleanStatus === 'CLEAN' ? 'default' : 'secondary'}>
                        {selectedRoom.cleanStatus}
                      </Badge>
                      {selectedRoom.operationalStatus !== 'AVAILABLE' && (
                        <Badge variant="destructive">
                          {selectedRoom.operationalStatus.replace('_', ' ')}
                        </Badge>
                      )}
                    </div>
                  </div>
                </Card>

                {selectedRoom.guestName && (
                  <Card className="p-4 space-y-4">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-2">Guest Information</div>
                      <div className="text-xl font-bold">{selectedRoom.guestName}</div>
                      {selectedRoom.guestCount && (
                        <div className="flex items-center gap-1 mt-2 text-sm text-muted-foreground">
                          <Users className="w-4 h-4" />
                          <span>{selectedRoom.guestCount} {selectedRoom.guestCount === 1 ? 'guest' : 'guests'}</span>
                        </div>
                      )}
                    </div>
                    
                    <Separator />
                    
                    {selectedRoom.checkIn && selectedRoom.checkOut && (
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-1">Check-in</div>
                          <div className="text-sm font-semibold">
                            {format(selectedRoom.checkIn, 'MMM d, yyyy')}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {format(selectedRoom.checkIn, 'EEE')}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-1">Check-out</div>
                          <div className="text-sm font-semibold">
                            {format(selectedRoom.checkOut, 'MMM d, yyyy')}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {format(selectedRoom.checkOut, 'EEE')}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-1">Remaining</div>
                          <div className="text-2xl font-bold text-primary">
                            {selectedRoom.nightsRemaining}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {selectedRoom.nightsRemaining === 1 ? 'night' : 'nights'}
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {selectedRoom.reservationId && (
                      <div className="pt-2">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                          Reservation ID
                        </div>
                        <div className="text-xs font-mono mt-1 text-foreground/70">
                          {selectedRoom.reservationId}
                        </div>
                      </div>
                    )}
                  </Card>
                )}

                {selectedRoom.balanceDue && selectedRoom.balanceDue > 0 && (
                  <Card className="p-4 bg-gradient-to-br from-orange-50 to-orange-100 border-2 border-orange-300">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-orange-900 mb-1 uppercase tracking-wide">Outstanding Balance</div>
                        <div className="text-3xl font-bold text-orange-600">
                          ฿{selectedRoom.balanceDue.toLocaleString()}
                        </div>
                      </div>
                      <Badge variant="outline" className="bg-white border-orange-300 text-orange-700">
                        {selectedRoom.depositStatus}
                      </Badge>
                    </div>
                  </Card>
                )}

                {selectedRoom.hasIssue && (
                  <Card className="p-3 bg-destructive/5 border-destructive/20">
                    <div className="flex items-start gap-2">
                      <Warning weight="fill" className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs font-semibold text-destructive">Room Issue Reported</div>
                        <div className="text-xs text-muted-foreground mt-1">Maintenance required</div>
                      </div>
                    </div>
                  </Card>
                )}

                <Separator />

                <div className="space-y-2">
                  {selectedRoom.guestName && (
                    <>
                      <Button className="w-full gap-2" size="lg">
                        <SignOut className="w-4 h-4" />
                        Check Out Guest
                      </Button>
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant="outline" size="sm">
                          Move Guest
                        </Button>
                        <Button variant="outline" size="sm">
                          Add Charge
                        </Button>
                      </div>
                      <Button variant="outline" className="w-full" size="sm">
                        View Folio
                      </Button>
                    </>
                  )}
                  
                  {!selectedRoom.guestName && selectedRoom.operationalStatus === 'AVAILABLE' && (
                    <>
                      {selectedRoom.cleanStatus === 'DIRTY' && (
                        <Button className="w-full gap-2" variant="secondary" size="lg">
                          <Broom className="w-4 h-4" />
                          Mark as Clean
                        </Button>
                      )}
                      {selectedRoom.cleanStatus === 'CLEAN' && (
                        <Button className="w-full gap-2" size="lg">
                          <Check className="w-4 h-4" />
                          Quick Check-In
                        </Button>
                      )}
                      <Button variant="outline" className="w-full" size="sm">
                        Block Room
                      </Button>
                    </>
                  )}
                  
                  {selectedRoom.operationalStatus === 'OUT_OF_SERVICE' && (
                    <Button className="w-full" variant="outline">
                      Mark Available
                    </Button>
                  )}
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
  const occupiedCount = rooms.filter(r => r.status.includes('OCCUPIED')).length
  const cleanCount = rooms.filter(r => r.cleanStatus === 'CLEAN').length
  const dirtyCount = rooms.filter(r => r.cleanStatus === 'DIRTY').length
  
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={onToggleCollapse}
        className="w-full flex items-center gap-3 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        {isCollapsed ? (
          <CaretRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <CaretDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
        <div className="flex items-center gap-3 text-sm font-semibold flex-1 min-w-0">
          <span className="text-muted-foreground">{subtitle}</span>
          <span>•</span>
          <span>{title}</span>
          <div className="flex items-center gap-2 ml-auto">
            <Badge variant="secondary" className="text-xs">
              {rooms.length} rooms
            </Badge>
            <Badge variant="outline" className="text-xs">
              {occupiedCount} occupied
            </Badge>
            {dirtyCount > 0 && (
              <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200">
                {dirtyCount} dirty
              </Badge>
            )}
          </div>
        </div>
      </button>

      {!isCollapsed && (
        <div className="divide-y divide-border/30">
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
        return 'bg-gradient-to-br from-primary/25 to-primary/15 border-primary/40 border-l-4 border-l-primary'
      case 'OCCUPIED_DIRTY':
        return 'bg-gradient-to-br from-destructive/25 to-destructive/15 border-destructive/40 border-l-4 border-l-destructive'
      case 'VACANT_CLEAN':
        return 'bg-gradient-to-br from-green-500/15 to-green-500/8 border-green-500/40 border-l-4 border-l-green-500'
      case 'VACANT_DIRTY':
        return 'bg-gradient-to-br from-orange-500/15 to-orange-500/8 border-orange-500/40 border-l-4 border-l-orange-500'
      default:
        return 'bg-muted/30 border-border'
    }
  }

  const getCleanStatusIndicator = (cleanStatus: 'CLEAN' | 'DIRTY' | 'INSPECTED') => {
    switch (cleanStatus) {
      case 'CLEAN':
        return 'bg-green-500 ring-2 ring-green-500/30'
      case 'DIRTY':
        return 'bg-orange-500 ring-2 ring-orange-500/30'
      case 'INSPECTED':
        return 'bg-blue-500 ring-2 ring-blue-500/30'
    }
  }

  const isRoomOccupied = room.guestName && room.reservationId

  return (
    <div className="flex hover:bg-accent/10 transition-colors group">
      <div 
        className="w-36 flex-shrink-0 border-r border-border py-3 px-4 flex items-center gap-2.5 cursor-pointer bg-muted/20 group-hover:bg-muted/40 transition-colors"
        onClick={onClick}
      >
        <div className={cn("w-2 h-2 rounded-full transition-all", getCleanStatusIndicator(room.cleanStatus))} />
        <div className="text-sm font-bold">{room.number}</div>
        <div className="ml-auto flex items-center gap-1.5">
          {room.operationalStatus === 'OUT_OF_SERVICE' && (
            <Badge variant="destructive" className="text-[9px] px-1.5 py-0 h-4">
              OOS
            </Badge>
          )}
          {room.operationalStatus === 'BLOCKED' && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-orange-50 text-orange-700 border-orange-300">
              BLK
            </Badge>
          )}
          {room.isVIP && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-amber-50 text-amber-700 border-amber-300">
              VIP
            </Badge>
          )}
        </div>
      </div>
      
      <div className="flex-1 flex overflow-x-auto">
        {dateColumns.map((date, i) => {
          const isInStay = room.checkIn && room.checkOut &&
            date >= room.checkIn && date < room.checkOut

          const isCheckIn = room.checkIn && isSameDay(date, room.checkIn)
          const isCheckOut = room.checkOut && isSameDay(date, room.checkOut)
          const isToday = isSameDay(date, new Date())
          const isWeekendDay = isWeekend(date)

          const isFirstDay = isInStay && isCheckIn
          const isLastDay = isInStay && isCheckOut

          return (
            <div 
              key={i}
              className={cn(
                "flex-1 min-w-[110px] border-r border-border py-2 px-2 relative transition-colors",
                isToday && "bg-primary/10",
                isWeekendDay && !isToday && "bg-accent/5"
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
                    "h-full rounded-md border-2 cursor-move transition-all hover:shadow-sm relative overflow-hidden",
                    getStatusColor(room.status),
                    isDragging && "opacity-40 scale-95",
                    isDropTarget && !isDragging && "ring-2 ring-primary ring-offset-2",
                    isFirstDay && "rounded-l-lg",
                    isLastDay && "rounded-r-lg"
                  )}
                  onClick={onClick}
                >
                  <div className="px-2.5 py-2 h-full flex flex-col justify-between">
                    {isCheckIn && (
                      <div className="space-y-0.5">
                        <div className="text-xs font-bold truncate text-foreground">
                          {room.guestName}
                        </div>
                        {room.guestCount && (
                          <div className="text-[10px] text-foreground/70 flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            <span>{room.guestCount}</span>
                          </div>
                        )}
                      </div>
                    )}
                    
                    <div className="flex items-center justify-between mt-auto">
                      {room.isArrivalToday && isCheckIn && (
                        <Badge className="text-[9px] px-1.5 py-0 h-4 bg-green-600 hover:bg-green-700">
                          IN
                        </Badge>
                      )}
                      {room.isDepartureToday && isCheckOut && (
                        <Badge className="text-[9px] px-1.5 py-0 h-4 bg-destructive hover:bg-destructive/90 ml-auto">
                          OUT
                        </Badge>
                      )}
                      {room.depositStatus === 'PENDING' && isCheckIn && (
                        <div className="w-1.5 h-1.5 rounded-full bg-orange-500 ring-2 ring-orange-500/30 ml-auto" />
                      )}
                    </div>
                  </div>
                  
                  {isDropTarget && !isDragging && (
                    <div className="absolute inset-0 bg-primary/30 backdrop-blur-[2px] flex items-center justify-center border-2 border-primary rounded-md">
                      <Badge className="text-xs font-bold">
                        Drop here to move
                      </Badge>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
