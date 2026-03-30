export type {
  Property,
  RoomType,
  Room,
  Guest,
  Reservation,
  RoomDateInventory,
  InventoryHold,
  Folio,
  Charge,
  Payment,
  GuestDocument,
  ReservationLog,
  RoomStatusLog,
  User,
  RateRule,
  RateCalendar,
  Channel,
  ChannelMapping,
  ChannelSyncLog,
  Message,
  MessageTemplate,
  AuditLog,
} from '@prisma/client'

export type {
  RoomOpStatus,
  RoomStatus,
  ReservationStatus,
  BookingSource,
  InventoryStatus,
  HoldStatus,
  FolioStatus,
  ChargeCategory,
  PaymentMethod,
  ReservationAction,
  UserRole,
  RateAdjustmentType,
  ChannelProvider,
  ChannelSyncType,
  MessageChannel,
  MessageStatus,
} from '@prisma/client'

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
