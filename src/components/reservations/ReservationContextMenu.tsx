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
  Pencil,
  Receipt,
  CurrencyDollar,
  Star,
  Note,
  Printer,
  Phone,
  Envelope,
  Copy,
  CalendarBlank,
  Key,
  UserSwitch,
  Plus,
  Minus,
  ListChecks,
  Info
} from '@phosphor-icons/react'
import { ReactNode } from 'react'

interface Reservation {
  id: string
  guestName: string
  roomNumber?: string
  checkIn: Date
  checkOut: Date
  status?: 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED'
  isVIP?: boolean
  balanceDue?: number
}

interface ReservationContextMenuProps {
  reservation: Reservation
  children: ReactNode
  onEdit: () => void
  onCheckIn?: () => void
  onCheckOut?: () => void
  onCancel?: () => void
  onViewFolio?: () => void
  onPostCharge?: () => void
  onToggleVIP?: () => void
  onAddNote?: () => void
  onPrintConfirmation?: () => void
  onSendEmail?: () => void
  onCall?: () => void
  onCopy?: () => void
  onExtend?: (nights: number) => void
  onShorten?: (nights: number) => void
  onChangeRoom?: () => void
  onViewDetails: () => void
}

export function ReservationContextMenu({
  reservation,
  children,
  onEdit,
  onCheckIn,
  onCheckOut,
  onCancel,
  onViewFolio,
  onPostCharge,
  onToggleVIP,
  onAddNote,
  onPrintConfirmation,
  onSendEmail,
  onCall,
  onCopy,
  onExtend,
  onShorten,
  onChangeRoom,
  onViewDetails,
}: ReservationContextMenuProps) {
  const isCheckedIn = reservation.status === 'CHECKED_IN'
  const isConfirmed = reservation.status === 'CONFIRMED'
  const isCancelled = reservation.status === 'CANCELLED'

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <ContextMenuLabel className="text-xs font-bold flex items-center gap-2">
          <Info className="w-3.5 h-3.5" />
          {reservation.guestName}
        </ContextMenuLabel>
        
        <ContextMenuItem onClick={onViewDetails}>
          <ListChecks className="w-4 h-4 mr-2" />
          View Reservation Details
        </ContextMenuItem>

        <ContextMenuItem onClick={onEdit}>
          <Pencil className="w-4 h-4 mr-2" />
          Edit Reservation
        </ContextMenuItem>

        {!isCancelled && (
          <>
            <ContextMenuSeparator />
            <ContextMenuLabel className="text-xs font-semibold text-muted-foreground">
              Guest Operations
            </ContextMenuLabel>

            {isConfirmed && onCheckIn && (
              <ContextMenuItem onClick={onCheckIn}>
                <Key className="w-4 h-4 mr-2" />
                Check In Guest
              </ContextMenuItem>
            )}

            {isCheckedIn && onCheckOut && (
              <ContextMenuItem onClick={onCheckOut} className="text-destructive">
                <SignOut className="w-4 h-4 mr-2" />
                Check Out Guest
              </ContextMenuItem>
            )}

            {isCheckedIn && onChangeRoom && (
              <ContextMenuItem onClick={onChangeRoom}>
                <UserSwitch className="w-4 h-4 mr-2" />
                Change Room
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

            {onToggleVIP && (
              <ContextMenuItem onClick={onToggleVIP}>
                <Star className="w-4 h-4 mr-2" weight={reservation.isVIP ? 'fill' : 'regular'} />
                {reservation.isVIP ? 'Remove VIP Status' : 'Mark as VIP'}
              </ContextMenuItem>
            )}

            {onAddNote && (
              <ContextMenuItem onClick={onAddNote}>
                <Note className="w-4 h-4 mr-2" />
                Add Note
              </ContextMenuItem>
            )}
          </>
        )}

        {isCheckedIn && onExtend && onShorten && (
          <>
            <ContextMenuSeparator />
            <ContextMenuLabel className="text-xs font-semibold text-muted-foreground">
              Modify Stay
            </ContextMenuLabel>

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

        <ContextMenuSeparator />
        <ContextMenuLabel className="text-xs font-semibold text-muted-foreground">
          Communication
        </ContextMenuLabel>

        {onSendEmail && (
          <ContextMenuItem onClick={onSendEmail}>
            <Envelope className="w-4 h-4 mr-2" />
            Send Email
          </ContextMenuItem>
        )}

        {onCall && (
          <ContextMenuItem onClick={onCall}>
            <Phone className="w-4 h-4 mr-2" />
            Call Guest
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        {onPrintConfirmation && (
          <ContextMenuItem onClick={onPrintConfirmation}>
            <Printer className="w-4 h-4 mr-2" />
            Print Confirmation
          </ContextMenuItem>
        )}

        {onCopy && (
          <ContextMenuItem onClick={onCopy}>
            <Copy className="w-4 h-4 mr-2" />
            Copy Reservation Info
          </ContextMenuItem>
        )}

        {!isCancelled && onCancel && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onCancel} className="text-destructive">
              Cancel Reservation
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
