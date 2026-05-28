import type { BoardRoomCard } from '@/types/board'

export const SERVER_API_ENABLED = import.meta.env.VITE_PMS_API_MODE === 'server'

export async function pmsApi<T>(path: string, token: string | null | undefined, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || 'PMS request failed.')
  }
  return payload as T
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

    return {
      roomId: room.id,
      number: room.number,
      floor: room.floor,
      type: room.roomType?.code === 'DOUBLE' ? 'DOUBLE' : 'TWIN',
      status: boardStatusFromServer(room.currentStatus),
      operationalStatus: room.operationalStatus,
      guestName,
      reservationId: reservation?.id,
      currentReservationId: room.currentReservation || reservation?.id,
      checkIn: reservation?.checkIn ? new Date(reservation.checkIn) : undefined,
      checkOut: reservation?.checkOut ? new Date(reservation.checkOut) : undefined,
      guestCount: reservation ? reservation.adults + reservation.children : undefined,
      isArrivalToday: false,
      isDepartureToday: false,
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
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        status: reservation.status,
        totalAmount: reservation.totalAmount,
        balanceDue: reservation.folio?.balance,
        depositStatus: reservation.depositPaid ? 'PAID' : 'PENDING',
      } : undefined,
    }
  })
}
