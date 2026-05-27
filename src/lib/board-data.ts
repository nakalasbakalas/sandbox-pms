import type { BoardRoomCard, BoardStats } from '@/types/board'
import { createSandboxRooms } from '@/lib/hotel/rooms'

export function createInitialBoardRooms(): BoardRoomCard[] {
  return createSandboxRooms()
}

export function calculateBoardStats(rooms: BoardRoomCard[]): BoardStats {
  const activeRooms = rooms.filter(r => r.operationalStatus === 'AVAILABLE')
  const occupied = rooms.filter(r => r.status === 'OCCUPIED_CLEAN' || r.status === 'OCCUPIED_DIRTY').length
  const vacant = rooms.filter(r => (r.status === 'VACANT_CLEAN' || r.status === 'VACANT_DIRTY') && r.operationalStatus === 'AVAILABLE').length
  const arrivalsToday = rooms.filter(r => r.isArrivalToday).length
  const departuresToday = rooms.filter(r => r.isDepartureToday).length
  const dirty = rooms.filter(r => r.cleanStatus === 'DIRTY').length
  const outOfService = rooms.filter(r => r.operationalStatus === 'OUT_OF_SERVICE' || r.operationalStatus === 'BLOCKED').length
  
  return {
    totalRooms: activeRooms.length,
    occupied,
    vacant,
    arrivalsToday,
    departuresToday,
    dirty,
    outOfService,
    occupancyRate: activeRooms.length > 0 ? (occupied / activeRooms.length) * 100 : 0,
  }
}
