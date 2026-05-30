import type { BoardRoomCard } from '@/types/board'

export function getOperationalRoomStatus(room: BoardRoomCard): 'available' | 'occupied' | 'dirty' | 'clean' | 'inspected' | 'blocked' | 'out_of_order' {
  if (room.operationalStatus === 'BLOCKED') return 'blocked'
  if (room.operationalStatus === 'OUT_OF_ORDER' || room.operationalStatus === 'OUT_OF_SERVICE') return 'out_of_order'
  if (room.status === 'OCCUPIED_CLEAN' || room.status === 'OCCUPIED_DIRTY') return 'occupied'
  if (room.cleanStatus === 'DIRTY' || room.status === 'VACANT_DIRTY') return 'dirty'
  if (room.cleanStatus === 'INSPECTED') return 'inspected'
  if (room.cleanStatus === 'CLEAN') return 'clean'
  return 'available'
}

export function isRoomReadyForArrival(room: BoardRoomCard): boolean {
  return room.operationalStatus === 'AVAILABLE' &&
    (room.status === 'VACANT_CLEAN' || room.status === 'VACANT_DIRTY') &&
    (room.cleanStatus === 'CLEAN' || room.cleanStatus === 'INSPECTED')
}
