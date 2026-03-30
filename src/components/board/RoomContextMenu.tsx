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
} from '@/components/ui/context-menu'
import { SignOut, Broom, ArrowsClockwise, Prohibit, CheckCircle, Plus, Minus, CurrencyDollar } from '@phosphor-icons/react'
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
}: RoomContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onClick={onViewDetails}>
          View Room Details
        </ContextMenuItem>
        
        {room.guestName && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onCheckOut} className="text-destructive">
              <SignOut className="w-4 h-4 mr-2" />
              Check Out Guest
            </ContextMenuItem>
            
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
          </>
        )}
        
        {!room.guestName && room.operationalStatus === 'AVAILABLE' && (
          <>
            <ContextMenuSeparator />
            {room.cleanStatus === 'CLEAN' && (
              <ContextMenuItem onClick={onQuickCheckIn}>
                <CheckCircle className="w-4 h-4 mr-2" />
                Quick Check-In
              </ContextMenuItem>
            )}
          </>
        )}
        
        <ContextMenuSeparator />
        
        {room.cleanStatus === 'DIRTY' && (
          <ContextMenuItem onClick={onMarkClean}>
            <Broom className="w-4 h-4 mr-2" />
            Mark as Clean
          </ContextMenuItem>
        )}
        
        {room.cleanStatus === 'CLEAN' && !room.guestName && (
          <ContextMenuItem onClick={onMarkDirty}>
            <ArrowsClockwise className="w-4 h-4 mr-2" />
            Mark as Dirty
          </ContextMenuItem>
        )}
        
        {room.operationalStatus === 'AVAILABLE' && !room.guestName && (
          <ContextMenuItem onClick={onBlock}>
            <Prohibit className="w-4 h-4 mr-2" />
            Block Room
          </ContextMenuItem>
        )}
        
        {(room.operationalStatus === 'BLOCKED' || room.operationalStatus === 'OUT_OF_SERVICE') && (
          <ContextMenuItem onClick={onUnblock}>
            <CheckCircle className="w-4 h-4 mr-2" />
            Make Available
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
