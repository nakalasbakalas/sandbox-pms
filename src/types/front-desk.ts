export interface ArrivalItem {
  id: string
  reservationId: string
  confirmationCode?: string
  guestName: string
  roomNumber?: string
  assignedRoomId?: string
  roomType: 'TWIN' | 'DOUBLE'
  checkInTime: string
  checkInDate?: Date | string
  checkOutDate?: Date | string
  arrivalTime?: string
  nights: number
  adults: number
  children: number
  status: 'DUE_IN' | 'READY' | 'CHECKED_IN' | 'NO_SHOW'
  reservationStatus?: 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW' | 'HOLD'
  roomReady: boolean
  depositPaid: boolean
  documentVerified: boolean
  guestNationality?: string
  guestIdNumber?: string
  identityRecordLaterAllowed?: boolean
  phone?: string
  email?: string
  specialRequests?: string
  notes?: string
  source: string
  estimatedArrival?: string
  bookedRate: number
  totalAmount: number
  paidAmount?: number
  balanceDue?: number
  depositAmount?: number
  paymentStatus?: 'PAID' | 'PARTIAL' | 'UNPAID'
  roomStatus?: string
  operationalStatus?: string
}

export interface DepartureItem {
  id: string
  reservationId: string
  confirmationCode?: string
  guestName: string
  roomNumber: string
  assignedRoomId?: string
  roomType: 'TWIN' | 'DOUBLE'
  checkOutTime: string
  checkInDate?: Date | string
  checkOutDate?: Date | string
  actualCheckIn?: Date | string
  nights: number
  nightsRemaining?: number
  status: 'IN_HOUSE' | 'CHECKED_OUT' | 'LATE_CHECKOUT'
  reservationStatus?: 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW' | 'HOLD'
  balanceDue: number
  paidAmount?: number
  folioTotal: number
  folioStatus?: 'OPEN' | 'CLOSED' | 'REFUNDED' | 'VOIDED'
  paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID'
  roomStatus: 'CLEAN' | 'DIRTY' | 'INSPECTED'
  lateCheckoutUntil?: string
  specialRequests?: string
  notes?: string
}

export interface InHouseItem {
  id: string
  reservationId: string
  confirmationCode?: string
  guestName: string
  roomNumber: string
  assignedRoomId?: string
  roomType: 'TWIN' | 'DOUBLE'
  checkInDate?: Date | string
  checkOutDate?: Date | string
  nights: number
  nightsRemaining: number
  balanceDue: number
  folioTotal?: number
  folioStatus?: 'OPEN' | 'CLOSED' | 'REFUNDED' | 'VOIDED'
  paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID'
  roomStatus: 'CLEAN' | 'DIRTY' | 'INSPECTED'
  serviceFlags: string[]
  mainAction: 'CHECK_OUT' | 'SETTLE_BALANCE' | 'MOVE_ROOM' | 'EXTEND_STAY'
}

export type WorkflowGuardSeverity = 'blocker' | 'warning' | 'info'

export interface WorkflowGuardItem {
  id: string
  label: string
  severity: WorkflowGuardSeverity
  status: string
  requiredAction: string
  quickActionLabel: string
  permissionRequired?: string
}

export interface WorkflowGuardSummary {
  blockers: WorkflowGuardItem[]
  warnings: WorkflowGuardItem[]
  info: WorkflowGuardItem[]
  canProceed: boolean
  isExpressReady: boolean
}

export interface RoomReadinessSummary {
  cleanInspected: number
  dirty: number
  occupied: number
  outOfOrder: number
  availableByType: Record<'TWIN' | 'DOUBLE', number>
}

export interface FrontDeskActionState {
  label: string
  intent:
    | 'express-check-in'
    | 'check-in'
    | 'fix-issues'
    | 'assign-room'
    | 'collect-payment'
    | 'room-not-ready'
    | 'express-check-out'
    | 'check-out'
    | 'settle-balance'
    | 'review-charges'
    | 'done'
  disabled?: boolean
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
  nationality?: string
  idNumber?: string
  recordIdentityLater?: boolean
  payment?: PaymentCollection
  payLaterReason?: string
  overrideReason?: string
  allowRoomReadinessOverride?: boolean
  allowDateOverride?: boolean
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
  paymentMethod?: 'CASH' | 'CARD' | 'TRANSFER' | 'PROMPTPAY' | 'OTHER'
  paymentReference?: string
  paymentAmount?: number
  balanceSettled: boolean
  keyReturned: boolean
  roomConditionCheck: 'GOOD' | 'MINOR_DAMAGE' | 'MAJOR_DAMAGE'
  feedbackRequested: boolean
  overrideReason?: string
  forceCheckout?: boolean
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
