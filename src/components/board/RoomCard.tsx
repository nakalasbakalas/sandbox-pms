import { useState } from 'react'
import type { BoardRoomCard } from '@/types/board'
import { cn } from '@/lib/utils'
import { Users, Warning, Star, CurrencyDollar } from '@phosphor-icons/react'
import { motion } from 'framer-motion'

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

  const getStatusColor = () => {
    if (room.operationalStatus === 'OUT_OF_SERVICE') return 'bg-gray-400/90'
    if (room.operationalStatus === 'BLOCKED') return 'bg-gray-500/90'
    
    switch (room.status) {
      case 'OCCUPIED_CLEAN':
      case 'OCCUPIED_DIRTY':
        return 'bg-blue-500/90'
      case 'VACANT_CLEAN':
        return 'bg-emerald-500/90'
      case 'VACANT_DIRTY':
        return 'bg-amber-500/90'
      default:
        return 'bg-gray-300/90'
    }
  }

  const getCleanIcon = () => {
    if (room.status === 'OCCUPIED_DIRTY' || room.status === 'VACANT_DIRTY') {
      return '🔴'
    }
    if (room.status === 'OCCUPIED_CLEAN' || room.status === 'VACANT_CLEAN') {
      return '✓'
    }
    return null
  }

  const getBorderClass = () => {
    const borders: string[] = []
    
    if (room.isArrivalToday) borders.push('border-l-4 border-l-green-400')
    if (room.isDepartureToday) borders.push('border-r-4 border-r-red-400')
    
    return borders.join(' ')
  }

  const getRingClass = () => {
    if (room.hasIssue) return 'ring-2 ring-red-500 ring-inset'
    if (room.isVIP) return 'ring-2 ring-yellow-400 ring-inset'
    return ''
  }

  const draggable = room.status === 'OCCUPIED_CLEAN' || room.status === 'OCCUPIED_DIRTY'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ 
        opacity: isDragging ? 0.4 : 1, 
        scale: isDragging ? 0.98 : 1 
      }}
      whileHover={{ scale: isDropTarget ? 1 : 1.03, y: isDropTarget ? 0 : -2 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className={cn(
        'relative h-24 rounded-md overflow-hidden cursor-pointer transition-all',
        getStatusColor(),
        getBorderClass(),
        getRingClass(),
        isDropTarget && 'ring-4 ring-primary ring-inset scale-105',
        draggable && 'active:cursor-grabbing',
        'shadow hover:shadow-lg'
      )}
    >
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
        className="relative h-full p-2 flex flex-col justify-between text-white"
      >
        <div className="flex items-start justify-between gap-1">
          <div className="flex-1 min-w-0">
            <div className="text-xl font-bold leading-none tracking-tight">{room.number}</div>
            <div className="text-[10px] font-medium opacity-80 mt-0.5">{room.type}</div>
          </div>
          
          <div className="flex gap-1 items-start flex-shrink-0">
            {room.isVIP && <Star weight="fill" className="w-3.5 h-3.5 text-yellow-300" />}
            {room.hasIssue && <Warning weight="fill" className="w-3.5 h-3.5 text-red-300" />}
            {room.depositStatus === 'PENDING' && <CurrencyDollar weight="bold" className="w-3.5 h-3.5 text-orange-300" />}
          </div>
        </div>

        <div className="space-y-0.5 min-h-0">
          {room.guestName && (
            <>
              <div className="text-xs font-semibold truncate leading-tight">{room.guestName}</div>
              <div className="flex items-center gap-2 text-[10px] opacity-80">
                {room.guestCount && (
                  <div className="flex items-center gap-0.5">
                    <Users weight="fill" className="w-2.5 h-2.5" />
                    <span>{room.guestCount}</span>
                  </div>
                )}
                {room.nightsRemaining !== undefined && (
                  <span className="font-medium">{room.nightsRemaining}n</span>
                )}
                {getCleanIcon() && (
                  <span className="ml-auto text-[9px]">{getCleanIcon()}</span>
                )}
              </div>
            </>
          )}

          {!room.guestName && room.operationalStatus === 'AVAILABLE' && (
            <div className="text-[10px] font-medium opacity-75 uppercase tracking-wide">
              {room.status === 'VACANT_CLEAN' ? 'Clean' : 'Dirty'}
            </div>
          )}

          {room.operationalStatus !== 'AVAILABLE' && (
            <div className="text-[10px] font-bold uppercase tracking-wide opacity-90">
              {room.operationalStatus === 'OUT_OF_SERVICE' ? 'OOS' : 'BLOCKED'}
            </div>
          )}
        </div>

        {room.depositStatus === 'PENDING' && (
          <div className="absolute top-0 left-0 w-full h-1 bg-orange-400/60" />
        )}
      </div>

      {isHovered && room.balanceDue && room.balanceDue > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute bottom-0 right-0 bg-orange-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-tl-md"
        >
          ฿{room.balanceDue.toLocaleString()}
        </motion.div>
      )}

      {isDropTarget && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 bg-primary/20 backdrop-blur-[1px] flex items-center justify-center"
        >
          <div className="text-white text-xs font-bold bg-primary/80 px-3 py-1 rounded-full">
            Drop here
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}
