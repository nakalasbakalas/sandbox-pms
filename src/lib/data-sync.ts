import type { BoardRoomCard } from '@/types/board'
import type { Reservation } from '@/types'
import type { HousekeepingRoom } from '@/types/housekeeping'

export interface DataSyncEvent {
  type: 'CHECK_IN' | 'CHECK_OUT' | 'ROOM_STATUS_CHANGE' | 'RESERVATION_CREATED' | 'RESERVATION_MODIFIED' | 'RESERVATION_CANCELLED' | 'PAYMENT_RECEIVED' | 'FOLIO_UPDATED'
  source: string
  timestamp: Date
  data: Record<string, unknown>
}

export class DataSyncService {
  private static instance: DataSyncService
  private listeners: Map<string, Set<(event: DataSyncEvent) => void>> = new Map()

  private constructor() {}

  static getInstance(): DataSyncService {
    if (!DataSyncService.instance) {
      DataSyncService.instance = new DataSyncService()
    }
    return DataSyncService.instance
  }

  subscribe(eventType: DataSyncEvent['type'], callback: (event: DataSyncEvent) => void): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set())
    }
    
    this.listeners.get(eventType)!.add(callback)

    return () => {
      const listeners = this.listeners.get(eventType)
      if (listeners) {
        listeners.delete(callback)
      }
    }
  }

  emit(event: DataSyncEvent): void {
    const listeners = this.listeners.get(event.type)
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(event)
        } catch (error) {
          console.error(`Error in data sync listener for ${event.type}:`, error)
        }
      })
    }
  }

  syncCheckIn(reservation: Reservation, roomId: string): void {
    this.emit({
      type: 'CHECK_IN',
      source: 'front-desk',
      timestamp: new Date(),
      data: {
        reservationId: reservation.id,
        roomId,
        guestName: reservation.guestName,
      },
    })
  }

  syncCheckOut(reservationId: string, roomId: string): void {
    this.emit({
      type: 'CHECK_OUT',
      source: 'front-desk',
      timestamp: new Date(),
      data: {
        reservationId,
        roomId,
      },
    })
  }

  syncRoomStatusChange(roomId: string, status: BoardRoomCard['status'], cleanStatus: string): void {
    this.emit({
      type: 'ROOM_STATUS_CHANGE',
      source: 'housekeeping',
      timestamp: new Date(),
      data: {
        roomId,
        status,
        cleanStatus,
      },
    })
  }

  syncReservationCreated(reservation: Reservation): void {
    this.emit({
      type: 'RESERVATION_CREATED',
      source: 'reservations',
      timestamp: new Date(),
      data: {
        reservationId: reservation.id,
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        roomType: reservation.roomType,
      },
    })
  }

  syncReservationModified(reservationId: string, changes: Partial<Reservation>): void {
    this.emit({
      type: 'RESERVATION_MODIFIED',
      source: 'reservations',
      timestamp: new Date(),
      data: {
        reservationId,
        changes,
      },
    })
  }

  syncReservationCancelled(reservationId: string): void {
    this.emit({
      type: 'RESERVATION_CANCELLED',
      source: 'reservations',
      timestamp: new Date(),
      data: {
        reservationId,
      },
    })
  }

  syncPaymentReceived(folioId: string, amount: number, method: string): void {
    this.emit({
      type: 'PAYMENT_RECEIVED',
      source: 'cashier',
      timestamp: new Date(),
      data: {
        folioId,
        amount,
        method,
      },
    })
  }

  syncFolioUpdated(folioId: string, balance: number): void {
    this.emit({
      type: 'FOLIO_UPDATED',
      source: 'cashier',
      timestamp: new Date(),
      data: {
        folioId,
        balance,
      },
    })
  }
}

export const dataSyncService = DataSyncService.getInstance()
