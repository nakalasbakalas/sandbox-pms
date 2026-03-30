import { useState, useMemo } from 'react'
import type { ArrivalItem, DepartureItem, CheckInData, CheckOutData } from '@/types/front-desk'
import type { ReceiptData } from '@/types/receipt'
import { FrontDeskStatsBar } from './FrontDeskStatsBar'
import { ArrivalList } from './ArrivalList'
import { DepartureList } from './DepartureList'
import { CheckInDialog } from './CheckInDialog'
import { CheckOutDialog } from './CheckOutDialog'
import { ReceiptDialog } from './ReceiptDialog'
import { generateMockArrivals, generateMockDepartures, calculateFrontDeskStats } from '@/lib/mock-front-desk-data'
import { generateReceiptFromCheckOut } from '@/lib/receipt-generator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SignIn, SignOut, MagnifyingGlass, Calendar, Command as CommandIcon } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { useCommandPalette } from '@/hooks/use-command-palette'
import { createPMSCommands } from '@/lib/pms-commands'
import { useNavigation } from '@/hooks/use-navigation'
import { CommandPalette } from '@/components/CommandPalette'
import { useRoomSync } from '@/hooks/use-room-sync'

export function FrontDeskView() {
  const [arrivals, setArrivals] = useState<ArrivalItem[]>(() => generateMockArrivals())
  const [departures, setDepartures] = useState<DepartureItem[]>(() => generateMockDepartures())
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedArrival, setSelectedArrival] = useState<ArrivalItem | null>(null)
  const [selectedDeparture, setDepartureItem] = useState<DepartureItem | null>(null)
  const [checkInDialogOpen, setCheckInDialogOpen] = useState(false)
  const [checkOutDialogOpen, setCheckOutDialogOpen] = useState(false)
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false)
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false)
  const [currentReceipt, setCurrentReceipt] = useState<ReceiptData | null>(null)
  
  const { navigate } = useNavigation()
  const commands = useMemo(() => createPMSCommands(navigate), [navigate])
  const commandPalette = useCommandPalette(commands)
  const { updateRoomStatus, getRoomByNumber } = useRoomSync()

  const stats = useMemo(() => calculateFrontDeskStats(arrivals, departures), [arrivals, departures])

  const filteredArrivals = useMemo(() => {
    if (!searchQuery) return arrivals
    
    const query = searchQuery.toLowerCase()
    return arrivals.filter(arrival => 
      arrival.guestName.toLowerCase().includes(query) ||
      arrival.roomNumber?.includes(query) ||
      arrival.reservationId.toLowerCase().includes(query)
    )
  }, [arrivals, searchQuery])

  const filteredDepartures = useMemo(() => {
    if (!searchQuery) return departures
    
    const query = searchQuery.toLowerCase()
    return departures.filter(departure => 
      departure.guestName.toLowerCase().includes(query) ||
      departure.roomNumber.includes(query) ||
      departure.reservationId.toLowerCase().includes(query)
    )
  }, [departures, searchQuery])

  const handleCheckIn = (arrival: ArrivalItem) => {
    setSelectedArrival(arrival)
    setCheckInDialogOpen(true)
  }

  const handleCheckOut = (departure: DepartureItem) => {
    setDepartureItem(departure)
    setCheckOutDialogOpen(true)
  }

  const handleViewArrivalDetails = (arrival: ArrivalItem) => {
    setSelectedArrival(arrival)
    setDetailsDialogOpen(true)
  }

  const handleViewDepartureDetails = (departure: DepartureItem) => {
    setDepartureItem(departure)
    setDetailsDialogOpen(true)
  }

  const confirmCheckIn = (data: CheckInData) => {
    if (!selectedArrival) return

    setArrivals(prev => 
      prev.map(a => 
        a.id === selectedArrival.id 
          ? { ...a, status: 'CHECKED_IN' as const }
          : a
      )
    )

    if (selectedArrival.roomNumber) {
      const room = getRoomByNumber(selectedArrival.roomNumber)
      if (room) {
        updateRoomStatus({
          roomId: room.roomId,
          cleanStatus: 'CLEAN',
          lastCleaned: new Date()
        })
      }
    }

    toast.success(`${selectedArrival.guestName} checked in successfully`, {
      description: `Room ${selectedArrival.roomNumber || 'assigned'} at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
    })

    setCheckInDialogOpen(false)
    setSelectedArrival(null)
  }

  const confirmCheckOut = (data: CheckOutData) => {
    if (!selectedDeparture) return

    setDepartures(prev => 
      prev.map(d => 
        d.id === selectedDeparture.id 
          ? { ...d, status: 'CHECKED_OUT' as const, roomStatus: 'DIRTY' as const }
          : d
      )
    )

    const room = getRoomByNumber(selectedDeparture.roomNumber)
    if (room) {
      updateRoomStatus({
        roomId: room.roomId,
        cleanStatus: 'DIRTY'
      })
    }

    const receipt = generateReceiptFromCheckOut(selectedDeparture, data)
    setCurrentReceipt(receipt)

    toast.success(`${selectedDeparture.guestName} checked out successfully`, {
      description: `Room ${selectedDeparture.roomNumber} marked as dirty and ready for housekeeping`,
    })

    setCheckOutDialogOpen(false)
    setReceiptDialogOpen(true)
  }

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="flex-none border-b bg-white shadow-sm">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-2xl font-bold">Front Desk</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="relative w-80">
              <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} weight="bold" />
              <Input
                placeholder="Search guests, rooms, reservations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigate('board')}
              title="View Board"
            >
              <Calendar size={20} weight="bold" />
            </Button>
            
            <Button
              variant="outline"
              size="icon"
              onClick={commandPalette.open}
              title="Open Command Palette (Ctrl+K)"
            >
              <CommandIcon size={20} weight="bold" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-none px-6 py-4 bg-white border-b">
        <FrontDeskStatsBar stats={stats} />
      </div>

      <div className="flex-1 overflow-hidden px-6 py-6">
        <Tabs defaultValue="arrivals" className="h-full flex flex-col">
          <TabsList className="w-full justify-start mb-4">
            <TabsTrigger value="arrivals" className="gap-2 px-6">
              <SignIn size={18} weight="bold" />
              Arrivals ({stats.arrivalsRemaining})
            </TabsTrigger>
            <TabsTrigger value="departures" className="gap-2 px-6">
              <SignOut size={18} weight="bold" />
              Departures ({stats.departuresRemaining})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="arrivals" className="flex-1 overflow-auto mt-0">
            <ArrivalList
              arrivals={filteredArrivals}
              onCheckIn={handleCheckIn}
              onViewDetails={handleViewArrivalDetails}
            />
          </TabsContent>

          <TabsContent value="departures" className="flex-1 overflow-auto mt-0">
            <DepartureList
              departures={filteredDepartures}
              onCheckOut={handleCheckOut}
              onViewDetails={handleViewDepartureDetails}
            />
          </TabsContent>
        </Tabs>
      </div>

      <CheckInDialog
        arrival={selectedArrival}
        open={checkInDialogOpen}
        onOpenChange={setCheckInDialogOpen}
        onConfirm={confirmCheckIn}
      />

      <CheckOutDialog
        departure={selectedDeparture}
        open={checkOutDialogOpen}
        onOpenChange={setCheckOutDialogOpen}
        onConfirm={confirmCheckOut}
      />

      <ReceiptDialog
        receipt={currentReceipt}
        open={receiptDialogOpen}
        onOpenChange={(open) => {
          setReceiptDialogOpen(open)
          if (!open) {
            setCurrentReceipt(null)
            setDepartureItem(null)
          }
        }}
        type="RECEIPT"
      />

      <CommandPalette 
        open={commandPalette.isOpen}
        onOpenChange={(open) => open ? commandPalette.open() : commandPalette.close()}
        commands={commands}
      />
    </div>
  )
}
