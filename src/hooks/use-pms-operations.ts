import { useCallback } from 'react'
import { useKV } from '@github/spark/hooks'
import { useRoomSync } from './use-room-sync'
import { useInventorySync } from './use-inventory-sync'
import { toast } from 'sonner'
import { format, eachDayOfInterval } from 'date-fns'
import type { BoardRoomCard } from '@/types/board'

interface Reservation {
  id: string
  confirmationNumber: string
  status: 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW' | 'PENDING'
  guestId: string
  guestName: string
  guestEmail?: string
  guestPhone?: string
  roomId?: string
  roomNumber?: string
  roomType: 'TWIN' | 'DOUBLE'
  checkIn: Date
  checkOut: Date
  nights: number
  adults: number
  children: number
  ratePerNight: number
  totalAmount: number
  depositAmount: number
  depositPaid: number
  depositStatus: 'PAID' | 'PENDING' | 'NONE'
  balanceDue: number
  source: 'DIRECT' | 'BOOKING_COM' | 'AGODA' | 'EXPEDIA' | 'AIRBNB' | 'WALK_IN'
  channelConfirmation?: string
  isVIP: boolean
  specialRequests?: string
  notes?: string
  createdAt: Date
  updatedAt: Date
  createdBy: string
}

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
  charges: FolioCharge[]
  payments: FolioPayment[]
  balance: number
  createdAt: string
  closedAt?: string
}

interface FolioCharge {
  id: string
  folioId: string
  category: string
  description: string
  amount: number
  quantity: number
  total: number
  date: string
  createdAt: string
  createdBy: string
  voided: boolean
}

interface FolioPayment {
  id: string
  folioId: string
  method: string
  amount: number
  reference?: string
  receivedAt: string
  receivedBy: string
  voided: boolean
  isDeposit: boolean
}

interface AccountingEntry {
  id: string
  date: string
  type: 'REVENUE' | 'EXPENSE' | 'REFUND'
  category: string
  description: string
  amount: number
  reference?: string
  relatedFolio?: string
  relatedReservation?: string
  createdBy: string
  createdAt: string
}

export function usePMSOperations() {
  const { rooms, setRooms, updateRoomStatus } = useRoomSync()
  const { recordInventoryEvent } = useInventorySync()
  
  const [reservations, setReservations] = useKV<Reservation[]>('reservations', [])
  const [folios, setFolios] = useKV<Folio[]>('folios', [])
  const [accountingEntries, setAccountingEntries] = useKV<AccountingEntry[]>('accounting-entries', [])
  const [unassignedReservations, setUnassignedReservations] = useKV<any[]>('unassigned-reservations', [])

  const checkInGuest = useCallback(async (
    reservationId: string,
    roomId: string,
    roomNumber: string
  ) => {
    try {
      const reservation = reservations.find(r => r.id === reservationId)
      if (!reservation) {
        throw new Error('Reservation not found')
      }

      const room = rooms.find(r => r.roomId === roomId)
      if (!room) {
        throw new Error('Room not found')
      }

      if (room.status === 'OCCUPIED_CLEAN' || room.status === 'OCCUPIED_DIRTY') {
        throw new Error('Room is already occupied')
      }

      setReservations(current =>
        current.map(res =>
          res.id === reservationId
            ? { 
                ...res, 
                status: 'CHECKED_IN' as const,
                roomId,
                roomNumber,
                updatedAt: new Date()
              }
            : res
        )
      )

      setRooms(current =>
        current.map(r =>
          r.roomId === roomId
            ? {
                ...r,
                status: 'OCCUPIED_CLEAN' as BoardRoomCard['status'],
                currentReservationId: reservationId,
                guestName: reservation.guestName,
                checkIn: reservation.checkIn,
                checkOut: reservation.checkOut,
                guestCount: reservation.adults + reservation.children,
                isVIP: reservation.isVIP,
              }
            : r
        )
      )

      const existingFolio = folios.find(f => f.reservationId === reservationId)
      if (!existingFolio) {
        const newFolio: Folio = {
          id: `FOL${Date.now()}`,
          reservationId,
          guestId: reservation.guestId,
          guestName: reservation.guestName,
          roomNumber,
          checkIn: reservation.checkIn.toISOString(),
          checkOut: reservation.checkOut.toISOString(),
          status: 'OPEN',
          depositRequired: reservation.depositAmount,
          depositPaid: reservation.depositPaid,
          charges: [],
          payments: reservation.depositPaid > 0 ? [{
            id: `PAY${Date.now()}`,
            folioId: `FOL${Date.now()}`,
            method: 'Deposit',
            amount: reservation.depositPaid,
            receivedAt: new Date().toISOString(),
            receivedBy: 'System',
            voided: false,
            isDeposit: true,
          }] : [],
          balance: reservation.totalAmount - reservation.depositPaid,
          createdAt: new Date().toISOString(),
        }

        setFolios(current => [...current, newFolio])
      }

      setUnassignedReservations(current =>
        current.filter(r => r.id !== reservationId)
      )

      toast.success(`Checked in ${reservation.guestName} to ${roomNumber}`)
      
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Check-in failed'
      toast.error(message)
      throw error
    }
  }, [reservations, rooms, folios, setReservations, setRooms, setFolios, setUnassignedReservations])

  const checkOutGuest = useCallback(async (
    reservationId: string,
    roomId: string,
    settleBalance: boolean = true
  ) => {
    try {
      const reservation = reservations.find(r => r.id === reservationId)
      if (!reservation) {
        throw new Error('Reservation not found')
      }

      const folio = folios.find(f => f.reservationId === reservationId)
      if (folio && folio.balance > 0 && settleBalance) {
        throw new Error('Outstanding balance must be settled before checkout')
      }

      setReservations(current =>
        current.map(res =>
          res.id === reservationId
            ? { 
                ...res, 
                status: 'CHECKED_OUT' as const,
                updatedAt: new Date()
              }
            : res
        )
      )

      setRooms(current =>
        current.map(r =>
          r.roomId === roomId
            ? {
                ...r,
                status: 'VACANT_DIRTY' as BoardRoomCard['status'],
                cleanStatus: 'DIRTY' as const,
                currentReservationId: undefined,
                guestName: undefined,
                checkIn: undefined,
                checkOut: undefined,
                guestCount: 0,
                isVIP: false,
              }
            : r
        )
      )

      if (folio) {
        setFolios(current =>
          current.map(f =>
            f.reservationId === reservationId
              ? { 
                  ...f, 
                  status: 'CLOSED' as const, 
                  closedAt: new Date().toISOString() 
                }
              : f
          )
        )

        if (folio.balance === 0) {
          const entry: AccountingEntry = {
            id: `ACC${Date.now()}`,
            date: format(new Date(), 'yyyy-MM-dd'),
            type: 'REVENUE',
            category: 'ROOM',
            description: `Room revenue - ${reservation.guestName} - ${reservation.roomNumber}`,
            amount: reservation.totalAmount,
            reference: folio.id,
            relatedFolio: folio.id,
            relatedReservation: reservationId,
            createdBy: 'System',
            createdAt: new Date().toISOString(),
          }

          setAccountingEntries(current => [entry, ...current])
        }
      }

      toast.success(`Checked out ${reservation.guestName} from ${reservation.roomNumber}`)
      
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Check-out failed'
      toast.error(message)
      throw error
    }
  }, [reservations, folios, setReservations, setRooms, setFolios, setAccountingEntries])

  const createReservation = useCallback(async (reservation: Reservation) => {
    try {
      setReservations(current => [...current, reservation])

      if (!reservation.roomId) {
        setUnassignedReservations(current => [...current, {
          id: reservation.id,
          guestName: reservation.guestName,
          checkIn: reservation.checkIn,
          checkOut: reservation.checkOut,
          roomType: reservation.roomType,
          guestCount: reservation.adults + reservation.children,
          nights: reservation.nights,
          source: reservation.source,
          isVIP: reservation.isVIP,
        }])
      }

      const roomTypeId = reservation.roomType === 'TWIN' ? 'twin' : 'double'
      const dates = eachDayOfInterval({
        start: reservation.checkIn,
        end: reservation.checkOut
      }).map(d => format(d, 'yyyy-MM-dd'))

      await recordInventoryEvent(
        'RESERVATION_CREATED',
        roomTypeId,
        dates,
        -1,
        'reservation-system'
      )

      toast.success(`Reservation created for ${reservation.guestName}`)
      
      return { success: true, reservationId: reservation.id }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create reservation'
      toast.error(message)
      throw error
    }
  }, [setReservations, setUnassignedReservations, recordInventoryEvent])

  const cancelReservation = useCallback(async (reservationId: string) => {
    try {
      const reservation = reservations.find(r => r.id === reservationId)
      if (!reservation) {
        throw new Error('Reservation not found')
      }

      if (reservation.status === 'CHECKED_IN') {
        throw new Error('Cannot cancel a checked-in reservation. Check out the guest first.')
      }

      setReservations(current =>
        current.map(res =>
          res.id === reservationId
            ? { ...res, status: 'CANCELLED' as const, updatedAt: new Date() }
            : res
        )
      )

      setUnassignedReservations(current =>
        current.filter(r => r.id !== reservationId)
      )

      if (reservation.roomId) {
        setRooms(current =>
          current.map(r =>
            r.currentReservationId === reservationId
              ? {
                  ...r,
                  currentReservationId: undefined,
                  guestName: undefined,
                  checkIn: undefined,
                  checkOut: undefined,
                  guestCount: 0,
                  isVIP: false,
                }
              : r
          )
        )
      }

      const roomTypeId = reservation.roomType === 'TWIN' ? 'twin' : 'double'
      const dates = eachDayOfInterval({
        start: reservation.checkIn,
        end: reservation.checkOut
      }).map(d => format(d, 'yyyy-MM-dd'))

      await recordInventoryEvent(
        'RESERVATION_CANCELLED',
        roomTypeId,
        dates,
        1,
        'reservation-system'
      )

      const folio = folios.find(f => f.reservationId === reservationId)
      if (folio && folio.status === 'OPEN') {
        setFolios(current =>
          current.map(f =>
            f.reservationId === reservationId
              ? { ...f, status: 'VOIDED' as const }
              : f
          )
        )
      }

      toast.success(`Reservation cancelled for ${reservation.guestName}`)
      
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cancel reservation'
      toast.error(message)
      throw error
    }
  }, [reservations, folios, setReservations, setUnassignedReservations, setRooms, setFolios, recordInventoryEvent])

  const addPayment = useCallback(async (
    folioId: string,
    amount: number,
    method: string,
    reference?: string
  ) => {
    try {
      const folio = folios.find(f => f.id === folioId)
      if (!folio) {
        throw new Error('Folio not found')
      }

      if (folio.status !== 'OPEN') {
        throw new Error('Cannot add payment to a closed or voided folio')
      }

      const payment: FolioPayment = {
        id: `PAY${Date.now()}`,
        folioId,
        method,
        amount,
        reference,
        receivedAt: new Date().toISOString(),
        receivedBy: 'Current User',
        voided: false,
        isDeposit: false,
      }

      setFolios(current =>
        current.map(f =>
          f.id === folioId
            ? {
                ...f,
                payments: [...f.payments, payment],
                balance: f.balance - amount,
              }
            : f
        )
      )

      const reservation = reservations.find(r => r.id === folio.reservationId)
      if (reservation) {
        setReservations(current =>
          current.map(res =>
            res.id === folio.reservationId
              ? {
                  ...res,
                  depositPaid: res.depositPaid + amount,
                  balanceDue: res.balanceDue - amount,
                  depositStatus: (res.depositPaid + amount >= res.depositAmount) ? 'PAID' as const : 'PENDING' as const,
                  updatedAt: new Date(),
                }
              : res
          )
        )
      }

      toast.success(`Payment of ฿${amount.toLocaleString()} recorded`)
      
      return { success: true, paymentId: payment.id }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add payment'
      toast.error(message)
      throw error
    }
  }, [folios, reservations, setFolios, setReservations])

  const addCharge = useCallback(async (
    folioId: string,
    category: string,
    description: string,
    amount: number,
    quantity: number = 1
  ) => {
    try {
      const folio = folios.find(f => f.id === folioId)
      if (!folio) {
        throw new Error('Folio not found')
      }

      if (folio.status !== 'OPEN') {
        throw new Error('Cannot add charges to a closed or voided folio')
      }

      const charge: FolioCharge = {
        id: `CHG${Date.now()}`,
        folioId,
        category,
        description,
        amount,
        quantity,
        total: amount * quantity,
        date: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        createdBy: 'Current User',
        voided: false,
      }

      setFolios(current =>
        current.map(f =>
          f.id === folioId
            ? {
                ...f,
                charges: [...f.charges, charge],
                balance: f.balance + charge.total,
              }
            : f
        )
      )

      toast.success(`Charge added: ${description} - ฿${charge.total.toLocaleString()}`)
      
      return { success: true, chargeId: charge.id }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add charge'
      toast.error(message)
      throw error
    }
  }, [folios, setFolios])

  const assignRoomToReservation = useCallback(async (
    reservationId: string,
    roomId: string,
    roomNumber: string
  ) => {
    try {
      const reservation = reservations.find(r => r.id === reservationId)
      if (!reservation) {
        throw new Error('Reservation not found')
      }

      const room = rooms.find(r => r.roomId === roomId)
      if (!room) {
        throw new Error('Room not found')
      }

      if (room.status === 'OCCUPIED_CLEAN' || room.status === 'OCCUPIED_DIRTY') {
        throw new Error('Room is already occupied')
      }

      setReservations(current =>
        current.map(res =>
          res.id === reservationId
            ? { ...res, roomId, roomNumber, updatedAt: new Date() }
            : res
        )
      )

      setRooms(current =>
        current.map(r =>
          r.roomId === roomId
            ? {
                ...r,
                futureReservationId: reservationId,
                checkIn: reservation.checkIn,
                checkOut: reservation.checkOut,
              }
            : r
        )
      )

      setUnassignedReservations(current =>
        current.filter(r => r.id !== reservationId)
      )

      toast.success(`Assigned ${roomNumber} to ${reservation.guestName}`)
      
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to assign room'
      toast.error(message)
      throw error
    }
  }, [reservations, rooms, setReservations, setRooms, setUnassignedReservations])

  const updateRoomCleanStatus = useCallback(async (
    roomId: string,
    cleanStatus: 'DIRTY' | 'CLEANING' | 'CLEAN' | 'INSPECTED'
  ) => {
    try {
      updateRoomStatus({
        roomId,
        cleanStatus,
        lastCleaned: cleanStatus === 'CLEAN' || cleanStatus === 'INSPECTED' ? new Date() : undefined,
        cleanedBy: cleanStatus === 'CLEAN' || cleanStatus === 'INSPECTED' ? 'Current User' : undefined,
      })

      const room = rooms.find(r => r.roomId === roomId)
      if (room) {
        toast.success(`${room.number} marked as ${cleanStatus.toLowerCase()}`)
      }
      
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update room status'
      toast.error(message)
      throw error
    }
  }, [rooms, updateRoomStatus])

  return {
    checkInGuest,
    checkOutGuest,
    createReservation,
    cancelReservation,
    addPayment,
    addCharge,
    assignRoomToReservation,
    updateRoomCleanStatus,
  }
}
