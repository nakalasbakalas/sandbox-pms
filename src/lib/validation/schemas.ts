import { z } from 'zod'

export const createGuestSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().optional(),
  nationality: z.string().optional(),
  idType: z.string().optional(),
  idNumber: z.string().optional(),
  dateOfBirth: z.date().optional(),
  vipStatus: z.boolean().optional().default(false),
  blacklisted: z.boolean().optional().default(false),
  preferences: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().optional(),
})

export const createReservationSchema = z.object({
  propertyId: z.string().min(1, 'Property is required'),
  guestId: z.string().min(1, 'Guest is required'),
  roomTypeId: z.string().min(1, 'Room type is required'),
  checkIn: z.date(),
  checkOut: z.date(),
  adults: z.number().int().min(1, 'At least 1 adult required'),
  children: z.number().int().min(0).optional().default(0),
  childAges: z.array(z.number().int().min(0).max(17)).optional(),
  ratePerNight: z.number().min(0, 'Rate must be positive'),
  totalAmount: z.number().min(0, 'Total must be positive'),
  depositAmount: z.number().min(0).optional().default(0),
  source: z.enum([
    'DIRECT',
    'WALK_IN',
    'PHONE',
    'EMAIL',
    'WEBSITE',
    'BOOKING_COM',
    'AGODA',
    'EXPEDIA',
    'AIRBNB',
    'OTHER',
  ]).optional().default('DIRECT'),
  channelRef: z.string().optional(),
  notes: z.string().optional(),
  specialRequests: z.string().optional(),
}).refine(
  (data) => data.checkOut > data.checkIn,
  {
    message: 'Check-out must be after check-in',
    path: ['checkOut'],
  }
)

export const checkInSchema = z.object({
  reservationId: z.string().min(1, 'Reservation ID is required'),
  roomId: z.string().min(1, 'Room is required'),
  actualCheckIn: z.date().optional(),
  performedBy: z.string().min(1, 'Staff ID is required'),
  notes: z.string().optional(),
})

export const checkOutSchema = z.object({
  reservationId: z.string().min(1, 'Reservation ID is required'),
  actualCheckOut: z.date().optional(),
  performedBy: z.string().min(1, 'Staff ID is required'),
  notes: z.string().optional(),
})

export const roomStatusUpdateSchema = z.object({
  roomId: z.string().min(1, 'Room ID is required'),
  toStatus: z.enum(['VACANT_CLEAN', 'VACANT_DIRTY', 'OCCUPIED', 'OCCUPIED_DIRTY']),
  changedBy: z.string().min(1, 'Staff ID is required'),
  notes: z.string().optional(),
})

export const createChargeSchema = z.object({
  folioId: z.string().min(1, 'Folio ID is required'),
  date: z.date(),
  description: z.string().min(1, 'Description is required'),
  category: z.enum([
    'ROOM',
    'EXTRA_GUEST',
    'CHILD',
    'CAFE',
    'MINIBAR',
    'LAUNDRY',
    'DAMAGE',
    'OTHER',
  ]),
  amount: z.number().min(0, 'Amount must be positive'),
  quantity: z.number().int().min(1).default(1),
  createdBy: z.string().min(1, 'Staff ID is required'),
})

export const createPaymentSchema = z.object({
  folioId: z.string().min(1, 'Folio ID is required'),
  amount: z.number().min(0, 'Amount must be positive'),
  method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'ONLINE', 'OTHER']),
  reference: z.string().optional(),
  notes: z.string().optional(),
  processedBy: z.string().min(1, 'Staff ID is required'),
})

export const createRoomSchema = z.object({
  propertyId: z.string().min(1, 'Property is required'),
  roomTypeId: z.string().min(1, 'Room type is required'),
  number: z.string().min(1, 'Room number is required'),
  floor: z.number().int(),
  operationalStatus: z.enum(['AVAILABLE', 'OUT_OF_SERVICE', 'OUT_OF_ORDER', 'BLOCKED']).optional().default('AVAILABLE'),
  currentStatus: z.enum(['VACANT_CLEAN', 'VACANT_DIRTY', 'OCCUPIED', 'OCCUPIED_DIRTY']).optional().default('VACANT_CLEAN'),
  blockedUntil: z.date().optional(),
  notes: z.string().optional(),
})

export const createRoomTypeSchema = z.object({
  propertyId: z.string().min(1, 'Property is required'),
  code: z.string().min(1, 'Code is required'),
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  baseRate: z.number().min(0, 'Base rate must be positive'),
  maxOccupancy: z.number().int().min(1, 'Max occupancy must be at least 1'),
  standardOcc: z.number().int().min(1, 'Standard occupancy must be at least 1'),
})

export const createUserSchema = z.object({
  username: z.string().min(2, 'Login username is required').optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')).nullable(),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  role: z.enum(['ADMIN', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPING', 'CASHIER', 'CAFE_STAFF']),
  active: z.boolean().optional().default(true),
}).refine(
  (data) => Boolean(data.username?.trim() || data.email?.trim()),
  {
    message: 'Username is required when email is blank',
    path: ['username'],
  }
)

export const updateUserSchema = z.object({
  username: z.string().min(2, 'Login username is required').optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')).nullable(),
  password: z.string().min(12, 'Password must be at least 12 characters').optional(),
  firstName: z.string().min(1, 'First name is required').optional(),
  lastName: z.string().min(1, 'Last name is required').optional(),
  role: z.enum(['ADMIN', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPING', 'CASHIER', 'CAFE_STAFF']).optional(),
  active: z.boolean().optional(),
})

export const loginSchema = z.object({
  identity: z.string().min(1, 'Username or email is required'),
  password: z.string().min(1, 'Password is required'),
})

export const boardFiltersSchema = z.object({
  startDate: z.date(),
  endDate: z.date(),
  status: z.array(z.enum(['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'])).optional(),
  roomNumbers: z.array(z.string()).optional(),
  roomTypes: z.array(z.string()).optional(),
})

export const availabilityQuerySchema = z.object({
  propertyId: z.string().min(1, 'Property is required'),
  roomTypeId: z.string().min(1, 'Room type is required'),
  checkIn: z.date(),
  checkOut: z.date(),
  excludeReservationId: z.string().optional(),
}).refine(
  (data) => data.checkOut > data.checkIn,
  {
    message: 'Check-out must be after check-in',
    path: ['checkOut'],
  }
)

export type CreateGuestInput = z.infer<typeof createGuestSchema>
export type CreateReservationInput = z.infer<typeof createReservationSchema>
export type CheckInInput = z.infer<typeof checkInSchema>
export type CheckOutInput = z.infer<typeof checkOutSchema>
export type RoomStatusUpdateInput = z.infer<typeof roomStatusUpdateSchema>
export type CreateChargeInput = z.infer<typeof createChargeSchema>
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>
export type CreateRoomInput = z.infer<typeof createRoomSchema>
export type CreateRoomTypeInput = z.infer<typeof createRoomTypeSchema>
export type CreateUserInput = z.infer<typeof createUserSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type BoardFiltersInput = z.infer<typeof boardFiltersSchema>
export type AvailabilityQueryInput = z.infer<typeof availabilityQuerySchema>
