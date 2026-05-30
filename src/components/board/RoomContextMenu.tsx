import { BoardRoomCard } from '@/types/board'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuLabel,
} from '@/components/ui/context-menu'
import { 
  SignOut, 
  Broom, 
  ArrowsClockwise, 
  Prohibit, 
  CheckCircle, 
  Plus, 
  Minus, 
  CurrencyDollar,
  Receipt,
  Users,
  Pencil,
  Warning,
  Star,
  Copy,
  Wrench,
  BellRinging,
  Note,
  Printer,
  Key,
  CalendarBlank,
  UserSwitch,
  ListChecks,
  Info
} from '@phosphor-icons/react'
import { ReactNode } from 'react'

interface RoomContextMenuProps {
  room: BoardRoomCard
  children: ReactNode
  onCheckOut: () => void
  onMarkClean: () => void
  onMarkDirty: () => void
  onBlock: () => void
  onUnblock: () => void
  onExtend: (nights: number) => void
  onShorten: (nights: number) => void
  onQuickCheckIn: () => void
  onViewDetails: () => void
  onEditReservation?: () => void
  onPostCharge?: () => void
  onViewFolio?: () => void
  onToggleVIP?: () => void
  onAddNote?: () => void
  onPrintRegistration?: () => void
  onTransferRoom?: () => void
  onMarkOutOfService?: () => void
  onRequestHousekeeping?: () => void
  onCopyReservation?: () => void
  onViewCalendar?: () => void
}

export function RoomContextMenu({
  room,
  children,
  onCheckOut,
  onMarkClean,
  onMarkDirty,
  onBlock,
  onUnblock,
  onExtend,
  onShorten,
  onQuickCheckIn,
  onViewDetails,
  onEditReservation,
  onPostCharge,
  onViewFolio,
  onToggleVIP,
  onAddNote,
  onPrintRegistration,
  onTransferRoom,
  onMarkOutOfService,
  onRequestHousekeeping,
  onCopyReservation,
  onViewCalendar,
}: RoomContextMenuProps) {
  const isCheckedIn = room.reservation?.status === 'CHECKED_IN' ||
    room.status === 'OCCUPIED' ||
    room.status === 'OCCUPIED_CLEAN' ||
    room.status === 'OCCUPIED_DIRTY'
  const hasReservation = Boolean(room.guestName || room.reservationId || room.currentReservationId || room.reservation?.id)
  const hasGuest = hasReservation
  const isVacant = !hasReservation
  const isDueIn = hasReservation && !isCheckedIn
  const isAvailable = room.operationalStatus === 'AVAILABLE'
  const isBlocked = room.operationalStatus === 'BLOCKED' || room.operationalStatus === 'OUT_OF_SERVICE'
  const isDirty = room.cleanStatus === 'DIRTY'
  const isClean = room.cleanStatus === 'CLEAN'

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <ContextMenuLabel className="text-xs font-bold flex items-center gap-2">
          <Info className="w-3.5 h-3.5" />
          Room {room.number} ({room.type})
        </ContextMenuLabel>
        
        <ContextMenuItem onClick={onViewDetails}>
          <ListChecks className="w-4 h-4 mr-2" />
          View Room Details
        </ContextMenuItem>

        {hasGuest && (
          <>
            <ContextMenuSeparator />
            <ContextMenuLabel className="text-xs font-semibold text-muted-foreground">
              Guest Operations
            </ContextMenuLabel>

            {isDueIn && (
              <ContextMenuItem onClick={onQuickCheckIn}>
                <Key className="w-4 h-4 mr-2" />
                Check In Guest
              </ContextMenuItem>
            )}
            
            {onEditReservation && (
              <ContextMenuItem onClick={onEditReservation}>
                <Pencil className="w-4 h-4 mr-2" />
                Edit Reservation
              </ContextMenuItem>
            )}

            {onViewFolio && (
              <ContextMenuItem onClick={onViewFolio}>
                <Receipt className="w-4 h-4 mr-2" />
                View Folio
              </ContextMenuItem>
            )}

            {onPostCharge && (
              <ContextMenuItem onClick={onPostCharge}>
                <CurrencyDollar className="w-4 h-4 mr-2" />
                Post Charge
              </ContextMenuItem>
            )}

            {onTransferRoom && (
              <ContextMenuItem onClick={onTransferRoom}>
                <UserSwitch className="w-4 h-4 mr-2" />
                Transfer to Another Room
              </ContextMenuItem>
            )}

            {onToggleVIP && (
              <ContextMenuItem onClick={onToggleVIP}>
                <Star className="w-4 h-4 mr-2" weight={room.isVIP ? 'fill' : 'regular'} />
                {room.isVIP ? 'Remove VIP Status' : 'Mark as VIP'}
              </ContextMenuItem>
            )}

            {onAddNote && (
              <ContextMenuItem onClick={onAddNote}>
                <Note className="w-4 h-4 mr-2" />
                Add Note
              </ContextMenuItem>
            )}

            <ContextMenuSeparator />

            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Plus className="w-4 h-4 mr-2" />
                Extend Stay
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onClick={() => onExtend(1)}>
                  +1 Night
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onExtend(2)}>
                  +2 Nights
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onExtend(3)}>
                  +3 Nights
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onExtend(7)}>
                  +1 Week
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Minus className="w-4 h-4 mr-2" />
                Shorten Stay
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onClick={() => onShorten(1)}>
                  -1 Night
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onShorten(2)}>
                  -2 Nights
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onShorten(3)}>
                  -3 Nights
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSeparator />

            {onPrintRegistration && (
              <ContextMenuItem onClick={onPrintRegistration}>
                <Printer className="w-4 h-4 mr-2" />
                Print Registration
              </ContextMenuItem>
            )}

            {onCopyReservation && (
              <ContextMenuItem onClick={onCopyReservation}>
                <Copy className="w-4 h-4 mr-2" />
                Copy Reservation Info
              </ContextMenuItem>
            )}

            <ContextMenuSeparator />
            
            {isCheckedIn && (
              <ContextMenuItem onClick={onCheckOut} className="text-destructive">
                <SignOut className="w-4 h-4 mr-2" />
                Check Out Guest
              </ContextMenuItem>
            )}
          </>
        )}
        
        {isVacant && isAvailable && (
          <>
            <ContextMenuSeparator />
            <ContextMenuLabel className="text-xs font-semibold text-muted-foreground">
              Vacant Room Actions
            </ContextMenuLabel>
            
            {isClean && (
              <ContextMenuItem onClick={onQuickCheckIn}>
                <CheckCircle className="w-4 h-4 mr-2" />
                Quick Check-In
              </ContextMenuItem>
            )}

            {onViewCalendar && (
              <ContextMenuItem onClick={onViewCalendar}>
                <CalendarBlank className="w-4 h-4 mr-2" />
                View Availability Calendar
              </ContextMenuItem>
            )}
          </>
        )}
        
        <ContextMenuSeparator />
        <ContextMenuLabel className="text-xs font-semibold text-muted-foreground">
          Housekeeping
        </ContextMenuLabel>
        
        {isDirty && (
          <ContextMenuItem onClick={onMarkClean}>
            <Broom className="w-4 h-4 mr-2" />
            Mark as Clean
          </ContextMenuItem>
        )}
        
        {isClean && isVacant && (
          <ContextMenuItem onClick={onMarkDirty}>
            <ArrowsClockwise className="w-4 h-4 mr-2" />
            Mark as Dirty
          </ContextMenuItem>
        )}

        {onRequestHousekeeping && (
          <ContextMenuItem onClick={onRequestHousekeeping}>
            <BellRinging className="w-4 h-4 mr-2" />
            Request Housekeeping
          </ContextMenuItem>
        )}
        
        <ContextMenuSeparator />
        <ContextMenuLabel className="text-xs font-semibold text-muted-foreground">
          Room Status
        </ContextMenuLabel>
        
        {isAvailable && isVacant && (
          <ContextMenuItem onClick={onBlock}>
            <Prohibit className="w-4 h-4 mr-2" />
            Block Room
          </ContextMenuItem>
        )}

        {isAvailable && isVacant && onMarkOutOfService && (
          <ContextMenuItem onClick={onMarkOutOfService}>
            <Wrench className="w-4 h-4 mr-2" />
            Mark Out of Service
          </ContextMenuItem>
        )}
        
        {isBlocked && (
          <ContextMenuItem onClick={onUnblock}>
            <CheckCircle className="w-4 h-4 mr-2" />
            Make Available
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
