import type { BoardRoomCard } from '@/types/board'
import type { Permission, UserRole } from '@/types/auth'

export type AssistantIntent =
  | 'CHECK_AVAILABILITY'
  | 'LIST_ARRIVALS'
  | 'LIST_DEPARTURES'
  | 'LIST_IN_HOUSE'
  | 'FIND_RESERVATION'
  | 'ROOM_STATUS'
  | 'PAYMENT_BALANCE'
  | 'CHECK_IN_ELIGIBILITY'
  | 'CHECK_OUT_ELIGIBILITY'
  | 'HOUSEKEEPING_STATUS'
  | 'DAILY_RISKS'
  | 'CREATE_WALK_IN'
  | 'HELP'

export type AssistantActionType =
  | 'OPEN_RESERVATION'
  | 'OPEN_ROOM'
  | 'OPEN_CHECK_IN'
  | 'OPEN_CHECK_OUT'
  | 'OPEN_PAYMENT'
  | 'ASSIGN_BEST_ROOM'
  | 'ASSIGN_SPECIFIC_ROOM'
  | 'CREATE_WALK_IN_DRAFT'
  | 'COMPLETE_EXPRESS_CHECK_IN'
  | 'COMPLETE_EXPRESS_CHECK_OUT'
  | 'ADD_PAYMENT'
  | 'ADD_CHARGE'
  | 'ADD_NOTE'
  | 'MARK_ROOM_DIRTY'
  | 'MARK_ROOM_CLEANING'
  | 'MARK_ROOM_CLEAN'
  | 'MARK_ROOM_READY'
  | 'MARK_NO_SHOW'
  | 'FLAG_PRIORITY_TURNOVER'

export interface AssistantEntities {
  roomType?: 'TWIN' | 'DOUBLE'
  roomNumber?: string
  reservationCode?: string
  guestName?: string
  dateRange?: {
    checkIn: string
    checkOut: string
    label: string
  }
}

export interface AssistantParsedIntent {
  intent: AssistantIntent
  entities: AssistantEntities
  confidence: number
}

export interface AssistantReservation {
  id: string
  confirmationCode?: string
  guestName: string
  roomType: 'TWIN' | 'DOUBLE'
  status: 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW' | 'HOLD'
  checkIn: Date | string
  checkOut: Date | string
  adults: number
  children: number
  assignedRoomId?: string
  roomNumber?: string
  balanceDue: number
  paidAmount?: number
  totalAmount?: number
  folioId?: string
  folioStatus?: 'OPEN' | 'CLOSED' | 'REFUNDED' | 'VOIDED'
  depositPaid?: boolean
  documentVerified?: boolean
  guestNationality?: string
  guestIdNumber?: string
  specialRequests?: string
  notes?: string
  source?: string
}

export interface AssistantSnapshot {
  hotelDateKey: string
  rooms: BoardRoomCard[]
  reservations: AssistantReservation[]
  currentRoute?: string
  currentRoomNumber?: string
  currentReservationId?: string
  user?: {
    id: string
    role: UserRole
    displayName: string
  } | null
}

export interface AssistantRecordRef {
  type: 'reservation' | 'room' | 'folio' | 'housekeeping' | 'policy'
  id: string
  label: string
  detail?: string
}

export interface AssistantAction {
  id: string
  type: AssistantActionType
  label: string
  description?: string
  permission?: Permission
  requiresConfirmation?: boolean
  disabled?: boolean
  disabledReason?: string
  payload?: Record<string, unknown>
  risk?: 'low' | 'medium' | 'high'
}

export interface AssistantAnswer {
  id: string
  intent: AssistantIntent
  title: string
  directAnswer: string
  records: AssistantRecordRef[]
  warnings: string[]
  nextAction?: string
  actions: AssistantAction[]
}

export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  answer?: AssistantAnswer
  createdAt: string
}
