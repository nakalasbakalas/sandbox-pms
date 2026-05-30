import { dataSyncService } from './data-sync'
import type { Reservation } from '@/types'
import type { BoardRoomCard } from '@/types/board'

export interface CheckInOperation {
  reservationId: string
  roomId: string
  guestVerified: boolean
  paymentCollected: boolean
  keyIssued: boolean
}

export interface CheckOutOperation {
  reservationId: string
  roomId: string
  folioSettled: boolean
  keyReturned: boolean
  roomInspected: boolean
}

export interface ReservationOperation {
  type: 'CREATE' | 'MODIFY' | 'CANCEL' | 'NO_SHOW'
  reservationId: string
  affectedDates: string[]
  roomTypeId?: string
}

export class OperationsManager {
  private static instance: OperationsManager

  private constructor() {}

  static getInstance(): OperationsManager {
    if (!OperationsManager.instance) {
      OperationsManager.instance = new OperationsManager()
    }
    return OperationsManager.instance
  }

  async executeCheckIn(
    operation: CheckInOperation,
    reservation: Reservation,
    updateRoom: (roomId: string, updates: Partial<BoardRoomCard>) => void,
    updateReservation: (id: string, updates: Partial<Reservation>) => void,
    createFolio: (reservationId: string) => void
  ): Promise<void> {
    try {
      updateRoom(operation.roomId, {
        status: 'OCCUPIED_CLEAN',
        currentReservationId: operation.reservationId,
        guestName: reservation.guestName,
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        guestCount: reservation.adults + reservation.children,
        isVIP: reservation.isVIP,
      })

      updateReservation(operation.reservationId, {
        status: 'CHECKED_IN',
        roomId: operation.roomId,
        roomNumber: operation.roomId,
      })

      createFolio(operation.reservationId)

      dataSyncService.syncCheckIn(reservation, operation.roomId)

      return Promise.resolve()
    } catch (error) {
      console.error('Check-in operation failed:', error)
      throw error
    }
  }

  async executeCheckOut(
    operation: CheckOutOperation,
    updateRoom: (roomId: string, updates: Partial<BoardRoomCard>) => void,
    updateReservation: (id: string, updates: Partial<Reservation>) => void,
    closeFolio: (reservationId: string) => void
  ): Promise<void> {
    try {
      updateRoom(operation.roomId, {
        status: 'VACANT_DIRTY',
        currentReservationId: undefined,
        guestName: undefined,
        checkIn: undefined,
        checkOut: undefined,
        guestCount: 0,
        isVIP: false,
        cleanStatus: 'DIRTY',
      })

      updateReservation(operation.reservationId, {
        status: 'CHECKED_OUT',
      })

      if (operation.folioSettled) {
        closeFolio(operation.reservationId)
      }

      dataSyncService.syncCheckOut(operation.reservationId, operation.roomId)

      return Promise.resolve()
    } catch (error) {
      console.error('Check-out operation failed:', error)
      throw error
    }
  }

  async executeReservationOperation(
    operation: ReservationOperation,
    syncInventory: (dates: string[], roomTypeId: string, delta: number) => void
  ): Promise<void> {
    try {
      switch (operation.type) {
        case 'CREATE':
          if (operation.roomTypeId) {
            syncInventory(operation.affectedDates, operation.roomTypeId, -1)
          }
          break

        case 'CANCEL':
          if (operation.roomTypeId) {
            syncInventory(operation.affectedDates, operation.roomTypeId, 1)
          }
          dataSyncService.syncReservationCancelled(operation.reservationId)
          break

        case 'MODIFY':
          break

        case 'NO_SHOW':
          if (operation.roomTypeId) {
            syncInventory(operation.affectedDates, operation.roomTypeId, 1)
          }
          break
      }

      return Promise.resolve()
    } catch (error) {
      console.error('Reservation operation failed:', error)
      throw error
    }
  }

  async syncRoomStatusToHousekeeping(
    roomId: string,
    status: BoardRoomCard['status'],
    cleanStatus: string
  ): Promise<void> {
    dataSyncService.syncRoomStatusChange(roomId, status, cleanStatus)
    return Promise.resolve()
  }

  async syncPaymentToFinancials(
    folioId: string,
    amount: number,
    method: string
  ): Promise<void> {
    dataSyncService.syncPaymentReceived(folioId, amount, method)
    return Promise.resolve()
  }
}

export const operationsManager = OperationsManager.getInstance()
