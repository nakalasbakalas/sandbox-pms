import type { RoomStatus, RoomOpStatus, ReservationStatus } from './index'

export interface BoardReservationSummary {
  id?: string
  guestName?: string
  guestEmail?: string
  guestPhone?: string
  checkIn?: Date | string
  checkOut?: Date | string
  status?: ReservationStatus
  isVIP?: boolean
  totalAmount?: number
  totalAmountSatang?: string
  balanceDue?: number
  balanceDueSatang?: string
  paidAmountSatang?: string
  depositStatus?: 'PAID' | 'PENDING' | 'PARTIAL' | 'NONE'
}

export interface BoardRoomCard {
  roomId: string
  number: string
  roomNumber?: string
  floor: number

  /**
   * Legacy display bucket retained for older board/front-desk components.
   * Use roomTypeId/roomTypeCode/roomTypeName for source-of-truth room type handling.
   */
  type: 'TWIN' | 'DOUBLE'
  roomType?: 'TWIN' | 'DOUBLE'

  /** Source-of-truth room-type metadata from server or onboarding configuration. */
  roomTypeId?: string
  roomTypeCode?: string
  roomTypeName?: string

  status: RoomStatus
  operationalStatus: RoomOpStatus
  
  guestName?: string
  guestEmail?: string
  guestPhone?: string
  reservationId?: string
  currentReservationId?: string
  reservation?: BoardReservationSummary
  nextReservation?: BoardReservationSummary
  checkIn?: Date
  checkOut?: Date
  nightsRemaining?: number
  guestCount?: number
  
  isArrivalToday: boolean
  isDepartureToday: boolean
  isVIP: boolean
  hasIssue: boolean
  hasIssues?: boolean
  needsAttention: boolean
  
  cleanStatus: 'CLEAN' | 'DIRTY' | 'CLEANING' | 'INSPECTED'
  housekeepingStatus?: 'CLEAN' | 'DIRTY' | 'CLEANING' | 'INSPECTED' | 'MAINTENANCE'
  lastCleaned?: Date
  lastUpdatedAt?: string
  lastUpdatedBy?: string
  notes?: string
  extendedStay?: boolean
  maintenanceIssue?: string
  
  depositStatus: 'PAID' | 'PENDING' | 'PARTIAL' | 'NONE'
  balanceDue?: number
  balanceDueSatang?: string
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
