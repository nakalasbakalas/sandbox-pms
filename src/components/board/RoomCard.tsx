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
  isDragging: boolean
  isDropTarget: boolean
}

export function RoomCard({
  room,
  onClick,
  onDragStart,
  onDragOver,
  onDrop,
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

  const getStatusText = () => {
    if (room.operationalStatus === 'OUT_OF_SERVICE') return 'OOS'
    if (room.operationalStatus === 'BLOCKED') return 'BLOCKED'
    
    switch (room.status) {
      case 'OCCUPIED_CLEAN':
        return 'OCCUPIED'
      case 'OCCUPIED_DIRTY':
        return 'OCCUPIED • DIRTY'
      case 'VACANT_CLEAN':
        return 'VACANT • CLEAN'
      case 'VACANT_DIRTY':
        return 'VACANT • DIRTY'
      default:
        return room.status
    }
  }

  const getBorderClass = () => {
    const borders: string[] = []
    
    if (room.isArrivalToday) borders.push('border-l-4 border-l-green-600')
    if (room.isDepartureToday) borders.push('border-r-4 border-r-red-600')
    if (room.depositStatus === 'PENDING') borders.push('border-t-4 border-t-orange-500')
    
    return borders.join(' ')
  }

  const getRingClass = () => {
    if (room.hasIssue) return 'ring-2 ring-red-500'
    if (room.isVIP) return 'ring-2 ring-yellow-400'
    return ''
  }

  const draggable = room.status === 'OCCUPIED_CLEAN' || room.status === 'OCCUPIED_DIRTY'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: isDragging ? 0.5 : 1, scale: isDragging ? 0.95 : 1 }}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'relative h-32 rounded-lg overflow-hidden cursor-pointer transition-all',
        getStatusColor(),
        getBorderClass(),
        getRingClass(),
        isDropTarget && 'ring-4 ring-primary',
        'shadow-sm hover:shadow-md'
      )}
    >
      <div 
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={onClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="relative h-full p-3 flex flex-col justify-between text-white"
      >
        <div className="flex items-start justify-between">
          <div className="space-y-0.5">
            <div className="text-2xl font-bold tracking-tight">{room.number}</div>
            <div className="text-xs font-medium opacity-90">{room.type}</div>
          </div>
          
          <div className="flex flex-col gap-1 items-end">
            {room.isVIP && <Star weight="fill" className="w-4 h-4 text-yellow-300" />}
            {room.hasIssue && <Warning weight="fill" className="w-4 h-4 text-red-300" />}
            {room.depositStatus === 'PENDING' && <CurrencyDollar weight="bold" className="w-4 h-4 text-orange-300" />}
          </div>
        </div>

        {room.guestName && (
          <div className="space-y-1">
            <div className="text-sm font-semibold truncate">{room.guestName}</div>
            <div className="flex items-center gap-2 text-xs opacity-90">
              {room.guestCount && (
                <div className="flex items-center gap-1">
                  <Users weight="fill" className="w-3 h-3" />
                  <span>{room.guestCount}</span>
                </div>
              )}
              {room.nightsRemaining !== undefined && (
                <span>{room.nightsRemaining}n</span>
              )}
            </div>
          </div>
        )}

        {!room.guestName && room.operationalStatus === 'AVAILABLE' && (
          <div className="text-xs font-medium opacity-90">
            {getStatusText()}
          </div>
        )}

        {room.operationalStatus !== 'AVAILABLE' && (
          <div className="text-xs font-bold uppercase">
            {getStatusText()}
          </div>
        )}
      </div>

      {isHovered && room.balanceDue && room.balanceDue > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute top-0 right-0 bg-orange-600 text-white text-xs font-bold px-2 py-1 rounded-bl-lg"
        >
          ฿{room.balanceDue.toLocaleString()}
        </motion.div>
      )}
    </motion.div>
  )
}
