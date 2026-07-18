export type BookingBoardRangeDays = 7 | 14 | 30

export interface ServerBookingBoardRoomType {
  id: string
  code: string
  name: string
  baseRate?: number
  standardOcc?: number
  maxOccupancy?: number
}

export interface ServerBookingBoardRoom {
  id: string
  number: string
  floor: number
  currentStatus: string
  operationalStatus: string
  roomType: ServerBookingBoardRoomType
}

export interface ServerBookingBoardReservation {
  id: string
  confirmationCode: string
  status: string
  checkIn: string
  checkOut: string
  assignedRoomId: string | null
  guestName: string
  isVip: boolean
  adults: number
  children: number
  balance: number | null
}

export interface ServerBookingBoardData {
  property: {
    id: string
    name: string
  }
  propertyDisplay: {
    id: string
    code: string
    name: string
    timezone: string
    currency: string
    defaultCheckIn: string
    defaultCheckOut: string
    extraGuestFee: number
    childFee: number
    taxRate: number
    taxRateBasisPoints: number
  }
  range: {
    from: string
    to: string
    durationDays: number
    semantics: 'FROM_INCLUSIVE_TO_EXCLUSIVE'
  }
  inventoryBlocks: Array<{
    id: string
    roomId: string
    date: string
    status: string
    notes: string | null
    updatedAt: string
  }>
  roomTypes: ServerBookingBoardRoomType[]
  rooms: ServerBookingBoardRoom[]
  reservations: ServerBookingBoardReservation[]
}
