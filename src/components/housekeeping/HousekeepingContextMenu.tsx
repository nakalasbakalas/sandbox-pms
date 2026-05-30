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
  Broom, 
  CheckCircle, 
  ArrowsClockwise,
  Clock,
  Warning,
  Prohibit,
  User,
  Note,
  Camera,
  ListChecks,
  Info,
  SignOut,
  Wrench
} from '@phosphor-icons/react'
import { ReactNode } from 'react'

interface HousekeepingRoom {
  roomId: string
  number: string
  type: string
  status: 'CLEAN' | 'DIRTY' | 'INSPECTED' | 'OUT_OF_SERVICE'
  priority?: 'HIGH' | 'MEDIUM' | 'LOW'
  assignedTo?: string
  hasGuest?: boolean
  isDepartureToday?: boolean
  notes?: string
}

interface HousekeepingContextMenuProps {
  room: HousekeepingRoom
  children: ReactNode
  onMarkClean: () => void
  onMarkDirty: () => void
  onMarkInspected: () => void
  onSetPriority: (priority: 'HIGH' | 'MEDIUM' | 'LOW') => void
  onAssignStaff?: () => void
  onAddNote?: () => void
  onReportIssue?: () => void
  onViewDetails: () => void
  onMarkOutOfService?: () => void
  onMarkAvailable?: () => void
  onRequestInspection?: () => void
}

export function HousekeepingContextMenu({
  room,
  children,
  onMarkClean,
  onMarkDirty,
  onMarkInspected,
  onSetPriority,
  onAssignStaff,
  onAddNote,
  onReportIssue,
  onViewDetails,
  onMarkOutOfService,
  onMarkAvailable,
  onRequestInspection,
}: HousekeepingContextMenuProps) {
  const isClean = room.status === 'CLEAN'
  const isDirty = room.status === 'DIRTY'
  const isInspected = room.status === 'INSPECTED'
  const isOutOfService = room.status === 'OUT_OF_SERVICE'

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuLabel className="text-xs font-bold flex items-center gap-2">
          <Info className="w-3.5 h-3.5" />
          Room {room.number} ({room.type})
        </ContextMenuLabel>
        
        <ContextMenuItem onClick={onViewDetails}>
          <ListChecks className="w-4 h-4 mr-2" />
          View Details
        </ContextMenuItem>

        <ContextMenuSeparator />
        <ContextMenuLabel className="text-xs font-semibold text-muted-foreground">
          Room Status
        </ContextMenuLabel>

        {!isClean && !isOutOfService && (
          <ContextMenuItem onClick={onMarkClean}>
            <CheckCircle className="w-4 h-4 mr-2" />
            Mark as Clean
          </ContextMenuItem>
        )}

        {!isDirty && !isOutOfService && (
          <ContextMenuItem onClick={onMarkDirty}>
            <ArrowsClockwise className="w-4 h-4 mr-2" />
            Mark as Dirty
          </ContextMenuItem>
        )}

        {!isInspected && !isOutOfService && onRequestInspection && (
          <ContextMenuItem onClick={onRequestInspection}>
            <Broom className="w-4 h-4 mr-2" />
            Request Inspection
          </ContextMenuItem>
        )}

        {!isInspected && !isOutOfService && (
          <ContextMenuItem onClick={onMarkInspected}>
            <CheckCircle className="w-4 h-4 mr-2" weight="fill" />
            Mark as Inspected
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />
        <ContextMenuLabel className="text-xs font-semibold text-muted-foreground">
          Priority
        </ContextMenuLabel>

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Clock className="w-4 h-4 mr-2" />
            Set Priority
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onClick={() => onSetPriority('HIGH')}>
              <Warning className="w-4 h-4 mr-2 text-red-500" weight="fill" />
              High Priority
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onSetPriority('MEDIUM')}>
              <Clock className="w-4 h-4 mr-2 text-orange-500" />
              Medium Priority
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onSetPriority('LOW')}>
              <Clock className="w-4 h-4 mr-2 text-blue-500" />
              Low Priority
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        {onAssignStaff && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onAssignStaff}>
              <User className="w-4 h-4 mr-2" />
              {room.assignedTo ? 'Reassign Staff' : 'Assign Staff'}
            </ContextMenuItem>
          </>
        )}

        <ContextMenuSeparator />
        <ContextMenuLabel className="text-xs font-semibold text-muted-foreground">
          Notes & Issues
        </ContextMenuLabel>

        {onAddNote && (
          <ContextMenuItem onClick={onAddNote}>
            <Note className="w-4 h-4 mr-2" />
            Add Note
          </ContextMenuItem>
        )}

        {onReportIssue && (
          <ContextMenuItem onClick={onReportIssue}>
            <Warning className="w-4 h-4 mr-2" />
            Report Issue
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        {!isOutOfService && onMarkOutOfService && (
          <ContextMenuItem onClick={onMarkOutOfService}>
            <Wrench className="w-4 h-4 mr-2" />
            Mark Out of Service
          </ContextMenuItem>
        )}

        {isOutOfService && onMarkAvailable && (
          <ContextMenuItem onClick={onMarkAvailable}>
            <CheckCircle className="w-4 h-4 mr-2" />
            Mark Available
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
