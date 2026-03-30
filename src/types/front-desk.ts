export interface ArrivalItem {
  id: string
  reservationId: string
  guestName: string
  roomNumber?: string
  roomType: 'TWIN' | 'DOUBLE'
  checkInTime: string
  nights: number
  adults: number
  children: number
  status: 'DUE_IN' | 'READY' | 'CHECKED_IN' | 'NO_SHOW'
  roomReady: boolean
  depositPaid: boolean
  documentVerified: boolean
  phone?: string
  email?: string
  specialRequests?: string
  source: string
  estimatedArrival?: string
  bookedRate: number
  totalAmount: number
}

export interface DepartureItem {
  id: string
  reservationId: string
  guestName: string
  roomNumber: string
  roomType: 'TWIN' | 'DOUBLE'
  checkOutTime: string
  nights: number
  status: 'IN_HOUSE' | 'CHECKED_OUT' | 'LATE_CHECKOUT'
  balanceDue: number
  folioTotal: number
  paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID'
  roomStatus: 'CLEAN' | 'DIRTY' | 'INSPECTED'
  lateCheckoutUntil?: string
}

export interface WalkInGuest {
  firstName: string
  lastName: string
  email?: string
  phone?: string
  nationality?: string
  idType?: string
  idNumber?: string
  adults: number
  children: number
  childAges?: number[]
  specialRequests?: string
}

export interface WalkInBooking extends WalkInGuest {
  roomTypeId: string
  roomType: 'TWIN' | 'DOUBLE'
  checkIn: Date
  checkOut: Date
  nights: number
  ratePerNight: number
  totalAmount: number
  depositAmount: number
  assignedRoomId?: string
}

export interface CheckInData {
  reservationId: string
  roomId: string
  actualCheckIn: Date
  guestVerified: boolean
  depositConfirmed: boolean
  documentsCollected: boolean
  roomConditionNoted: boolean
  welcomePackProvided: boolean
  additionalNotes?: string
}

export interface CheckOutData {
  reservationId: string
  actualCheckOut: Date
  minibarCharges?: number
  damageFees?: number
  additionalCharges?: Array<{
    description: string
    amount: number
  }>
  paymentMethod?: 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER'
  balanceSettled: boolean
  keyReturned: boolean
  roomConditionCheck: 'GOOD' | 'MINOR_DAMAGE' | 'MAJOR_DAMAGE'
  feedbackRequested: boolean
  additionalNotes?: string
}

export interface QuickAction {
  type: 'CHECK_IN' | 'CHECK_OUT' | 'ROOM_MOVE' | 'EXTEND_STAY' | 'EARLY_DEPARTURE' | 'ADD_CHARGE' | 'POST_PAYMENT'
  label: string
  icon: string
  requiresConfirmation: boolean
}

export interface FrontDeskStats {
  arrivalsToday: number
  arrivalsCheckedIn: number
  arrivalsRemaining: number
  departuresToday: number
  departuresCheckedOut: number
  departuresRemaining: number
  inHouse: number
  walkIns: number
  noShows: number
  lateCheckouts: number
  earlyCheckIns: number
  pendingDeposits: number
  outstandingBalance: number
}

export interface PaymentCollection {
  reservationId: string
  amount: number
  method: 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER'
  reference?: string
  notes?: string
}

export interface RoomAssignment {
  reservationId: string
  roomId: string
  reason?: string
  autoAssign?: boolean
}

export interface StayModification {
  reservationId: string
  type: 'EXTEND' | 'SHORTEN' | 'ROOM_CHANGE'
  newCheckOut?: Date
  newRoomId?: string
  rateDifference?: number
  additionalCharge?: number
  refundAmount?: number
  reason?: string
}
