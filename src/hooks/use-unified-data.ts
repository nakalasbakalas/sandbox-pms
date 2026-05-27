import { useKV } from '@github/spark/hooks'
import { useCallback, useMemo } from 'react'
import type { Reservation, Guest } from '@/types'
import type { BoardRoomCard } from '@/types/board'
import { dataSyncService } from '@/lib/data-sync'

interface Folio {
  id: string
  reservationId: string
  guestId: string
  guestName: string
  roomNumber: string
  checkIn: string
  checkOut: string
  status: 'OPEN' | 'CLOSED' | 'VOIDED'
  depositRequired: number
  depositPaid: number
  charges: unknown[]
  payments: unknown[]
  balance: number
  createdAt: string
  closedAt?: string
}

export function useUnifiedData() {
  const [rooms, setRooms] = useKV<BoardRoomCard[]>('pms-rooms', [])
  const [reservations, setReservations] = useKV<Reservation[]>('reservations', [])
  const [guests, setGuests] = useKV<Guest[]>('guests', [])
  const [folios, setFolios] = useKV<Folio[]>('folios', [])

  const checkInGuest = useCallback((
    reservationId: string,
    roomId: string,
    roomNumber: string
  ) => {
    setReservations((current) =>
      current.map((res) =>
        res.id === reservationId
          ? { ...res, status: 'CHECKED_IN' as const, roomId, roomNumber }
          : res
      )
    )

    const reservation = reservations.find((r) => r.id === reservationId)
    if (!reservation) return
    const guestName = reservation.guestName ?? 'Unknown Guest'
    const depositPaidAmount = typeof reservation.depositPaid === 'number'
      ? reservation.depositPaid
      : reservation.depositPaid
        ? reservation.depositAmount
        : 0

    setRooms((current) =>
      current.map((room) =>
        room.roomId === roomId
          ? {
              ...room,
              status: 'OCCUPIED_CLEAN' as const,
              currentReservationId: reservationId,
              guestName,
              checkIn: reservation.checkIn,
              checkOut: reservation.checkOut,
              guestCount: reservation.adults + reservation.children,
              isVIP: reservation.isVIP ?? false,
            }
          : room
      )
    )

    const existingFolio = folios.find((f) => f.reservationId === reservationId)
    if (!existingFolio) {
      const newFolio: Folio = {
        id: `FOL${Date.now()}`,
        reservationId,
        guestId: reservation.guestId,
        guestName,
        roomNumber,
        checkIn: reservation.checkIn.toISOString(),
        checkOut: reservation.checkOut.toISOString(),
        status: 'OPEN',
        depositRequired: reservation.depositAmount,
        depositPaid: depositPaidAmount,
        charges: [],
        payments: [],
        balance: reservation.totalAmount - depositPaidAmount,
        createdAt: new Date().toISOString(),
      }

      setFolios((current) => [...current, newFolio])
    }

    dataSyncService.syncCheckIn(reservation, roomId)
  }, [reservations, setReservations, setRooms, folios, setFolios])

  const checkOutGuest = useCallback((
    reservationId: string,
    roomId: string
  ) => {
    setReservations((current) =>
      current.map((res) =>
        res.id === reservationId
          ? { ...res, status: 'CHECKED_OUT' as const }
          : res
      )
    )

    setRooms((current) =>
      current.map((room) =>
        room.roomId === roomId
          ? {
              ...room,
              status: 'VACANT_DIRTY' as const,
              cleanStatus: 'DIRTY' as const,
              currentReservationId: undefined,
              guestName: undefined,
              checkIn: undefined,
              checkOut: undefined,
              guestCount: 0,
              isVIP: false,
            }
          : room
      )
    )

    setFolios((current) =>
      current.map((folio) =>
        folio.reservationId === reservationId
          ? { ...folio, status: 'CLOSED' as const, closedAt: new Date().toISOString() }
          : folio
      )
    )

    dataSyncService.syncCheckOut(reservationId, roomId)
  }, [setReservations, setRooms, setFolios])

  const updateRoomCleanStatus = useCallback((
    roomId: string,
    cleanStatus: 'DIRTY' | 'CLEANING' | 'CLEAN' | 'INSPECTED'
  ) => {
    setRooms((current) =>
      current.map((room) => {
        if (room.roomId !== roomId) return room

        const isOccupied = room.status === 'OCCUPIED_CLEAN' || room.status === 'OCCUPIED_DIRTY'
        const newStatus = isOccupied
          ? (cleanStatus === 'CLEAN' || cleanStatus === 'INSPECTED' ? 'OCCUPIED_CLEAN' : 'OCCUPIED_DIRTY')
          : (cleanStatus === 'CLEAN' || cleanStatus === 'INSPECTED' ? 'VACANT_CLEAN' : 'VACANT_DIRTY')

        return {
          ...room,
          cleanStatus,
          status: newStatus as BoardRoomCard['status'],
          lastCleaned: cleanStatus === 'CLEAN' || cleanStatus === 'INSPECTED' ? new Date() : room.lastCleaned,
        }
      })
    )

    const room = rooms.find((r) => r.roomId === roomId)
    if (room) {
      dataSyncService.syncRoomStatusChange(roomId, room.status, cleanStatus)
    }
  }, [setRooms, rooms])

  const createReservation = useCallback((reservation: Reservation) => {
    setReservations((current) => [...current, reservation])
    dataSyncService.syncReservationCreated(reservation)
  }, [setReservations])

  const updateReservation = useCallback((reservationId: string, updates: Partial<Reservation>) => {
    setReservations((current) =>
      current.map((res) =>
        res.id === reservationId ? { ...res, ...updates } : res
      )
    )
    dataSyncService.syncReservationModified(reservationId, updates)
  }, [setReservations])

  const cancelReservation = useCallback((reservationId: string) => {
    setReservations((current) =>
      current.map((res) =>
        res.id === reservationId ? { ...res, status: 'CANCELLED' as const } : res
      )
    )
    dataSyncService.syncReservationCancelled(reservationId)
  }, [setReservations])

  const addPayment = useCallback((
    folioId: string,
    amount: number,
    method: string
  ) => {
    setFolios((current) =>
      current.map((folio) => {
        if (folio.id !== folioId) return folio

        const newBalance = folio.balance - amount

        return {
          ...folio,
          balance: newBalance,
          payments: [
            ...folio.payments,
            {
              id: `PAY${Date.now()}`,
              amount,
              method,
              timestamp: new Date().toISOString(),
            },
          ],
        }
      })
    )

    dataSyncService.syncPaymentReceived(folioId, amount, method)
  }, [setFolios])

  return {
    rooms,
    reservations,
    guests,
    folios,
    checkInGuest,
    checkOutGuest,
    updateRoomCleanStatus,
    createReservation,
    updateReservation,
    cancelReservation,
    addPayment,
  }
}
