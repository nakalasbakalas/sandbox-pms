import type { BoardRoomCard } from '@/types/board'
import type {
  BookingEmailApprovePayload,
  BookingEmailEvent,
  BookingEmailEventFilters,
  BookingEmailRejectPayload,
  BookingEmailSource,
  BookingEmailStatus,
} from '@/types/booking-email'
import { SERVER_AUTH_ENABLED } from '@/lib/auth-mode'
import { isSameDay } from 'date-fns'

export const SERVER_API_ENABLED = SERVER_AUTH_ENABLED

export async function pmsApi<T>(path: string, _legacyToken: string | null | undefined, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || 'PMS request failed.')
  }
  return payload as T
}

function bookingEmailQuery(filters: BookingEmailEventFilters = {}) {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.sourceId) params.set('sourceId', filters.sourceId)
  if (filters.limit) params.set('limit', String(filters.limit))
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function isBookingEmailApiNotConfigured(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '')
  return /not found|not configured|not implemented/i.test(message)
}

export const bookingEmailApi = {
  status(authToken?: string | null) {
    return pmsApi<{ ok: true; data: BookingEmailStatus }>('/api/booking-email/status', authToken)
  },

  sync(authToken?: string | null) {
    return pmsApi<{ ok: true; data: BookingEmailStatus; events?: BookingEmailEvent[]; message?: string }>('/api/booking-email/sync', authToken, {
      method: 'POST',
      body: JSON.stringify({}),
    })
  },

  listEvents(authToken?: string | null, filters: BookingEmailEventFilters = {}) {
    return pmsApi<{ ok: true; data: BookingEmailEvent[] }>(`/api/booking-email/events${bookingEmailQuery(filters)}`, authToken)
  },

  getEvent(authToken: string | null | undefined, eventId: string) {
    return pmsApi<{ ok: true; data: BookingEmailEvent }>(`/api/booking-email/events/${encodeURIComponent(eventId)}`, authToken)
  },

  approveEvent(authToken: string | null | undefined, eventId: string, payload: BookingEmailApprovePayload) {
    return pmsApi<{ ok: true; data: BookingEmailEvent; message?: string }>(`/api/booking-email/events/${encodeURIComponent(eventId)}/approve`, authToken, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  rejectEvent(authToken: string | null | undefined, eventId: string, payload: BookingEmailRejectPayload) {
    return pmsApi<{ ok: true; data: BookingEmailEvent; message?: string }>(`/api/booking-email/events/${encodeURIComponent(eventId)}/reject`, authToken, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  reprocessEvent(authToken: string | null | undefined, eventId: string) {
    return pmsApi<{ ok: true; data: BookingEmailEvent; message?: string }>(`/api/booking-email/events/${encodeURIComponent(eventId)}/reprocess`, authToken, {
      method: 'POST',
      body: JSON.stringify({}),
    })
  },

  listSources(authToken?: string | null) {
    return pmsApi<{ ok: true; data: BookingEmailSource[] }>('/api/booking-email/sources', authToken)
  },

  createSource(authToken: string | null | undefined, payload: Partial<BookingEmailSource>) {
    return pmsApi<{ ok: true; data: BookingEmailSource; message?: string }>('/api/booking-email/sources', authToken, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  updateSource(authToken: string | null | undefined, sourceId: string, payload: Partial<BookingEmailSource>) {
    return pmsApi<{ ok: true; data: BookingEmailSource; message?: string }>(`/api/booking-email/sources/${encodeURIComponent(sourceId)}`, authToken, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  },
}

function cleanStatusFromServer(status: string): BoardRoomCard['cleanStatus'] {
  if (status === 'VACANT_DIRTY' || status === 'OCCUPIED_DIRTY') return 'DIRTY'
  if (status === 'CLEANING') return 'CLEANING'
  if (status === 'INSPECTED') return 'INSPECTED'
  return 'CLEAN'
}

function boardStatusFromServer(status: string): BoardRoomCard['status'] {
  if (status === 'OCCUPIED' || status === 'OCCUPIED_CLEAN') return 'OCCUPIED_CLEAN'
  if (status === 'OCCUPIED_DIRTY') return 'OCCUPIED_DIRTY'
  if (status === 'VACANT_DIRTY' || status === 'CLEANING') return 'VACANT_DIRTY'
  return 'VACANT_CLEAN'
}

export function mapServerBoardRooms(data: any): BoardRoomCard[] {
  const reservationsByRoom = new Map<string, any>()
  for (const reservation of data?.reservations || []) {
    if (reservation.assignedRoomId) reservationsByRoom.set(reservation.assignedRoomId, reservation)
  }

  return (data?.rooms || []).map((room: any) => {
    const reservation = reservationsByRoom.get(room.id)
    const guestName = reservation?.guest
      ? `${reservation.guest.firstName} ${reservation.guest.lastName}`.trim()
      : undefined
    const checkInDate = reservation?.checkIn ? new Date(reservation.checkIn) : undefined
    const checkOutDate = reservation?.checkOut ? new Date(reservation.checkOut) : undefined

    return {
      roomId: room.id,
      number: room.number,
      floor: room.floor,
      type: room.roomType?.code === 'DOUBLE' ? 'DOUBLE' : 'TWIN',
      status: boardStatusFromServer(room.currentStatus),
      operationalStatus: room.operationalStatus,
      guestName,
      guestEmail: reservation?.guest?.email || undefined,
      guestPhone: reservation?.guest?.phone || undefined,
      reservationId: reservation?.id,
      currentReservationId: room.currentReservation || reservation?.id,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      guestCount: reservation ? reservation.adults + reservation.children : undefined,
      isArrivalToday: checkInDate ? isSameDay(checkInDate, new Date()) : false,
      isDepartureToday: checkOutDate ? isSameDay(checkOutDate, new Date()) : false,
      isVIP: Boolean(reservation?.guest?.vipStatus),
      hasIssue: false,
      needsAttention: false,
      cleanStatus: cleanStatusFromServer(room.currentStatus),
      housekeepingStatus: cleanStatusFromServer(room.currentStatus),
      depositStatus: reservation?.depositPaid ? 'PAID' : reservation ? 'PENDING' : 'NONE',
      balanceDue: reservation?.folio?.balance,
      lastUpdatedAt: room.updatedAt,
      notes: room.notes,
      reservation: reservation ? {
        id: reservation.id,
        guestName,
        guestEmail: reservation.guest?.email || undefined,
        guestPhone: reservation.guest?.phone || undefined,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        status: reservation.status,
        totalAmount: reservation.totalAmount,
        balanceDue: reservation.folio?.balance,
        depositStatus: reservation.depositPaid ? 'PAID' : 'PENDING',
      } : undefined,
    }
  })
}
