import type { RoomStatus, RoomOpStatus, ReservationStatus } from './index'

export interface BoardRoomCard {
  roomId: string
  number: string
  floor: number
  type: 'TWIN' | 'DOUBLE'
  status: RoomStatus
  operationalStatus: RoomOpStatus
  
  guestName?: string
  reservationId?: string
  checkIn?: Date
  checkOut?: Date
  nightsRemaining?: number
  guestCount?: number
  
  isArrivalToday: boolean
  isDepartureToday: boolean
  isVIP: boolean
  hasIssue: boolean
  needsAttention: boolean
  
  cleanStatus: 'CLEAN' | 'DIRTY' | 'INSPECTED'
  lastCleaned?: Date
  
  depositStatus: 'PAID' | 'PENDING' | 'NONE'
  balanceDue?: number
}

export interface BoardFiltersState {
  view: '7day' | '14day' | '30day'
  show: {
    arrivals: boolean
    departures: boolean
    inHouse: boolean
    vacant: boolean
    dirty: boolean
    maintenance: boolean
    vip: boolean
    issues: boolean
    depositPending: boolean
  }
  roomNumbers: string[]
  guestName?: string
}

export interface BoardStats {
  totalRooms: number
  occupied: number
  vacant: number
  arrivalsToday: number
  departuresToday: number
  dirty: number
  outOfService: number
  occupancyRate: number
}

export interface DragOperation {
  type: 'MOVE_GUEST' | 'EXTEND_STAY' | 'SHORTEN_STAY'
  sourceRoomId: string
  targetRoomId?: string
  reservationId: string
  guestName: string
}
