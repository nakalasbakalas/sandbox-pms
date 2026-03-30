import { useState, useMemo, useEffect } from 'react'
import type { BoardRoomCard, DragOperation } from '@/types/board'
import { RoomCard } from './RoomCard'
import { BoardStatsBar } from './BoardStatsBar'
import { QuickActionsBar } from './QuickActionsBar'
import { generateMockBoardData, calculateBoardStats } from '@/lib/mock-board-data'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { MagnifyingGlass, Funnel, Command } from '@phosphor-icons/react'
import { Card } from '@/components/ui/card'
import { toast } from 'sonner'
import { CommandPalette } from '@/components/CommandPalette'
import { useCommandPalette } from '@/hooks/use-command-palette'
import { useNavigation } from '@/hooks/use-navigation'
import { createPMSCommands } from '@/lib/pms-commands'
import { useRoomSync } from '@/hooks/use-room-sync'

export function Board() {
  const { rooms, lastUpdate, initializeRooms } = useRoomSync()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRoom, setSelectedRoom] = useState<BoardRoomCard | null>(null)
  const [draggingRoom, setDraggingRoom] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'7day' | '14day' | '30day'>('7day')
  
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
        </div>
      </div>

      <BoardStatsBar stats={stats} />

      <QuickActionsBar 
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        filterCount={0}
      />

      <div className="flex-1 overflow-auto">
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold mb-2 flex items-center gap-2 px-1">
              <span className="text-muted-foreground">Floor 2 •</span>
              <span>Twin Rooms</span>
              <span className="text-xs text-muted-foreground">({twinRooms.length})</span>
            </h2>
            <div className="grid grid-cols-6 gap-2">
              {twinRooms.map((room) => (
                <RoomCard
                  key={room.roomId}
                  room={room}
                  onClick={() => handleRoomClick(room)}
                  onDragStart={handleDragStart(room)}
                  onDragOver={handleDragOver(room)}
                  onDrop={handleDrop(room)}
                  onDragLeave={handleDragLeave}
                  onDragEnd={handleDragEnd}
                  isDragging={draggingRoom === room.roomId}
                  isDropTarget={dropTarget === room.roomId}
                />
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold mb-2 flex items-center gap-2 px-1">
              <span className="text-muted-foreground">Floor 3 •</span>
              <span>Double Rooms</span>
              <span className="text-xs text-muted-foreground">({doubleRooms.length})</span>
            </h2>
            <div className="grid grid-cols-6 gap-2">
              {doubleRooms.map((room) => (
                <RoomCard
                  key={room.roomId}
                  room={room}
                  onClick={() => handleRoomClick(room)}
                  onDragStart={handleDragStart(room)}
                  onDragOver={handleDragOver(room)}
                  onDrop={handleDrop(room)}
                  onDragLeave={handleDragLeave}
                  onDragEnd={handleDragEnd}
                  isDragging={draggingRoom === room.roomId}
                  isDropTarget={dropTarget === room.roomId}
                />
              ))}
            </div>
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
