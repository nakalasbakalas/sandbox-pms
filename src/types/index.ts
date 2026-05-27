export type RoomOpStatus = 'AVAILABLE' | 'BLOCKED' | 'OUT_OF_SERVICE' | 'OUT_OF_ORDER'
export type RoomStatus =
  | 'VACANT_CLEAN'
  | 'VACANT_DIRTY'
  | 'OCCUPIED_CLEAN'
  | 'OCCUPIED_DIRTY'
  | 'OCCUPIED'
  | 'ARRIVING'
  | 'DEPARTING'
  | 'OUT_OF_SERVICE'
export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW'
export type BookingSource = 'DIRECT' | 'BOOKING_COM' | 'AGODA' | 'EXPEDIA' | 'AIRBNB' | 'WALK_IN' | 'PHONE' | 'OTHER'
export type InventoryStatus = 'AVAILABLE' | 'RESERVED' | 'BLOCKED'
export type HoldStatus = 'ACTIVE' | 'RELEASED' | 'CONVERTED'
export type FolioStatus = 'OPEN' | 'CLOSED' | 'VOIDED'
export type ChargeCategory = 'ROOM' | 'FOOD' | 'BEVERAGE' | 'EXTRA_GUEST' | 'CHILD_FEE' | 'DAMAGE' | 'OTHER'
export type PaymentMethod = 'CASH' | 'CREDIT_CARD' | 'BANK_TRANSFER' | 'PROMPTPAY' | 'OTHER'
export type ReservationAction = 'CREATED' | 'MODIFIED' | 'CANCELLED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'NO_SHOW'
export type RateAdjustmentType = 'PERCENTAGE' | 'FIXED_DELTA' | 'LONG_STAY_DISCOUNT'
export type ChannelProvider = 'BOOKING_COM' | 'AGODA' | 'EXPEDIA' | 'AIRBNB'
export type ChannelSyncType = 'RESERVATION_PULL' | 'INVENTORY_PUSH' | 'RATE_PUSH' | 'RESTRICTION_PUSH'
export type MessageChannel = 'EMAIL' | 'LINE' | 'SMS'
export type MessageStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED'

export interface Property {
  id: string
  name: string
  address: string
  city: string
  country: string
  phone?: string | null
  email?: string | null
  website?: string | null
  taxId?: string | null
  timeZone: string
  currency: string
  defaultCheckIn: string
  defaultCheckOut: string
  createdAt: Date
  updatedAt: Date
}

export interface RoomType {
  id: string
  propertyId: string
  name: string
  baseOccupancy: number
  maxOccupancy: number
  extraGuestFee: number
  childFreeAge: number
  childFeeAge: number
  childFee: number
  createdAt: Date
  updatedAt: Date
}

export interface Room {
  id: string
  propertyId: string
  roomTypeId: string
  number: string
  floor?: number | null
  operationalStatus: RoomOpStatus
  cleanStatus: RoomStatus
  notes?: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Guest {
  id: string
  propertyId: string
  firstName: string
  lastName: string
  email?: string | null
  phone?: string | null
  nationality?: string | null
  idType?: string | null
  idNumber?: string | null
  dateOfBirth?: Date | null
  vipStatus: boolean
  blacklisted: boolean
  cautionFlag: boolean
  preferences?: Record<string, unknown> | null
  notes?: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Reservation {
  id: string
  propertyId: string
  guestId: string
  roomTypeId: string
  assignedRoomId?: string | null
  roomId?: string | null
  roomNumber?: string | null
  guestName?: string
  isVIP?: boolean
  status: ReservationStatus
  source: BookingSource
  channelRef?: string | null
  checkIn: Date
  checkOut: Date
  actualCheckIn?: Date | null
  actualCheckOut?: Date | null
  adults: number
  children: number
  childAges?: number[] | null
  ratePerNight: number
  totalAmount: number
  depositAmount: number
  depositPaid: boolean
  specialRequests?: string | null
  notes?: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Folio {
  id: string
  reservationId: string
  status: FolioStatus
  balance: number
  createdAt: Date
  updatedAt: Date
}

export interface Charge {
  id: string
  folioId: string
  category: ChargeCategory
  description: string
  amount: number
  quantity: number
  total: number
  createdBy: string
  createdAt: Date
  voidedAt?: Date | null
  voidedBy?: string | null
}

export interface Payment {
  id: string
  folioId: string
  method: PaymentMethod
  amount: number
  reference?: string | null
  receivedBy: string
  receivedAt: Date
  voidedAt?: Date | null
  voidedBy?: string | null
}

export interface ReservationWithDetails extends Reservation {
  guest: Guest
  roomType: RoomType
  assignedRoom?: Room | null
  folio?: Folio | null
}

export interface RoomWithDetails extends Room {
  roomType: RoomType
}

export interface FolioWithDetails extends Folio {
  reservation: ReservationWithDetails
  charges: Charge[]
  payments: Payment[]
}

export interface CreateReservationInput {
  propertyId: string
  guestId: string
  roomTypeId: string
  checkIn: Date
  checkOut: Date
  adults: number
  children?: number
  childAges?: number[]
  ratePerNight: number
  totalAmount: number
  depositAmount?: number
  source?: BookingSource
  channelRef?: string
  notes?: string
  specialRequests?: string
}

export interface CreateGuestInput {
  firstName: string
  lastName: string
  email?: string
  phone?: string
  nationality?: string
  idType?: string
  idNumber?: string
  dateOfBirth?: Date
  vipStatus?: boolean
  preferences?: Record<string, unknown>
  notes?: string
}

export interface CheckInInput {
  reservationId: string
  roomId: string
  actualCheckIn?: Date
  performedBy: string
  notes?: string
}

export interface CheckOutInput {
  reservationId: string
  actualCheckOut?: Date
  performedBy: string
  notes?: string
}

export interface RoomStatusUpdate {
  roomId: string
  toStatus: RoomStatus
  changedBy: string
  notes?: string
}

export interface BoardFilters {
  startDate: Date
  endDate: Date
  status?: ReservationStatus[]
  roomNumbers?: string[]
  roomTypes?: string[]
}

export interface AvailabilityQuery {
  propertyId: string
  roomTypeId: string
  checkIn: Date
  checkOut: Date
  excludeReservationId?: string
}

export interface PricingCalculation {
  baseRate: number
  nights: number
  subtotal: number
  extraGuestFee: number
  childFee: number
  adjustments: PricingAdjustment[]
  total: number
}

export interface PricingAdjustment {
  type: string
  description: string
  amount: number
}

export interface OccupancyStats {
  date: Date
  totalRooms: number
  availableRooms: number
  reservedRooms: number
  occupancyRate: number
}

export interface RevenueStats {
  date: Date
  roomRevenue: number
  extrasRevenue: number
  totalRevenue: number
  adr: number
  revpar: number
}

export interface DashboardStats {
  arrivals: number
  departures: number
  inHouse: number
  occupancyRate: number
  availableRooms: number
  dirtyRooms: number
  pendingPayments: number
  pendingDeposits: number
}

export * from './auth'
export * from './board'
export * from './command-palette'
export * from './daily-summary'
export * from './front-desk'
export * from './navigation'
export * from './onboarding'
export * from './receipt'
export * from './reports'
export * from './staff-templates'
