import { useState } from 'react'
import type { BoardRoomCard } from '@/types/board'
import { cn } from '@/lib/utils'
import { Users, Warning, Star, CurrencyDollar } from '@phosphor-icons/react'

interface RoomCardProps {
  room: BoardRoomCard
  onClick: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDragEnd: () => void
  isDragging: boolean
  isDropTarget: boolean
}

export function RoomCard({
  room,
  onClick,
  onDragStart,
  onDragOver,
  onDrop,
  onDragLeave,
  onDragEnd,
  isDragging,
  isDropTarget,
}: RoomCardProps) {
  const [isHovered, setIsHovered] = useState(false)

  const getStatusClasses = () => {
    if (room.operationalStatus === 'OUT_OF_SERVICE') return 'bg-gray-100 border-gray-300 text-gray-700'
    if (room.operationalStatus === 'BLOCKED') return 'bg-gray-50 border-gray-300 text-gray-600'
    
    switch (room.status) {
      case 'OCCUPIED_CLEAN':
      case 'OCCUPIED_DIRTY':
        return 'bg-blue-50 border-blue-200 text-blue-900'
      case 'VACANT_CLEAN':
        return 'bg-emerald-50 border-emerald-200 text-emerald-900'
      case 'VACANT_DIRTY':
        return 'bg-orange-50 border-orange-200 text-orange-900'
      default:
        return 'bg-muted border-border text-muted-foreground'
    }
  }

  const getAccentColor = () => {
    if (room.operationalStatus !== 'AVAILABLE') return 'bg-gray-400'
    switch (room.status) {
      case 'OCCUPIED_CLEAN': return 'bg-blue-500'
      case 'OCCUPIED_DIRTY': return 'bg-orange-500'
      case 'VACANT_CLEAN': return 'bg-emerald-500'
      case 'VACANT_DIRTY': return 'bg-orange-500'
      default: return 'bg-gray-300'
    }
  }

  const draggable = room.status === 'OCCUPIED_CLEAN' || room.status === 'OCCUPIED_DIRTY'

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        'relative h-20 rounded-lg border overflow-hidden cursor-pointer transition-all',
        getStatusClasses(),
        isDropTarget && 'ring-2 ring-blue-500 ring-offset-1',
        draggable && 'active:cursor-grabbing',
        isDragging && 'opacity-40 scale-95',
        room.hasIssue && 'ring-1 ring-rose-400',
        'hover:shadow-sm'
      )}
    >
      {/* Accent strip */}
      <div className={cn('absolute left-0 top-0 bottom-0 w-[3px]', getAccentColor())} />

      <div className="relative h-full pl-2.5 pr-2 py-1.5 flex flex-col justify-between">
        <div className="flex items-start justify-between gap-1">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold leading-none">{room.number}</div>
            <div className="text-[9px] font-normal opacity-60 mt-0.5 uppercase tracking-wide">{room.type}</div>
          </div>
          
          <div className="flex gap-0.5 items-start flex-shrink-0">
            {room.isVIP && <Star weight="fill" className="w-3 h-3 text-amber-500" />}
            {room.hasIssue && <Warning weight="fill" className="w-3 h-3 text-rose-500" />}
          </div>
        </div>

        <div className="space-y-0.5 min-h-0">
          {room.guestName && (
            <>
              <div className="text-[11px] font-medium truncate leading-tight">{room.guestName}</div>
              <div className="flex items-center gap-1.5 text-[9px] opacity-60">
                {room.guestCount && (
                  <div className="flex items-center gap-0.5">
                    <Users weight="regular" className="w-2.5 h-2.5" />
                    <span>{room.guestCount}</span>
                  </div>
                )}
                {room.nightsRemaining !== undefined && (
                  <span>{room.nightsRemaining}n</span>
                )}
                {room.cleanStatus === 'DIRTY' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500 ml-auto" />
                )}
              </div>
            </>
          )}

          {!room.guestName && room.operationalStatus === 'AVAILABLE' && (
            <div className="text-[9px] opacity-50 uppercase tracking-wide">
              {room.status === 'VACANT_CLEAN' ? 'Ready' : 'Needs cleaning'}
            </div>
          )}

          {room.operationalStatus !== 'AVAILABLE' && (
            <div className="text-[9px] font-medium uppercase tracking-wide opacity-70">
              {room.operationalStatus === 'OUT_OF_SERVICE' ? 'Out of Service' : 'Blocked'}
            </div>
          )}
        </div>
      </div>

      {isHovered && room.balanceDue && room.balanceDue > 0 && (
        <div className="absolute bottom-0 right-0 bg-orange-100 text-orange-700 text-[9px] font-medium px-1.5 py-0.5 rounded-tl border-t border-l border-orange-200">
          ฿{room.balanceDue.toLocaleString()}
        </div>
      )}

      {isDropTarget && (
        <div className="absolute inset-0 bg-blue-500/10 backdrop-blur-[1px] flex items-center justify-center">
          <span className="text-[10px] text-blue-600 font-medium bg-white/80 px-2 py-0.5 rounded shadow-sm">
            Drop here
          </span>
        </div>
      )}
    </div>
  )
}
