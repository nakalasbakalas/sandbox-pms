import { useMemo } from 'react'
import type { BoardRoomCard } from '@/types/board'
import { isSameDay, isWithinInterval } from 'date-fns'

export interface ConflictCheck {
  hasConflict: boolean
  conflictType?: 'room_occupied' | 'date_overlap' | 'maintenance' | 'blocked' | 'invalid_dates'
  message?: string
  affectedRoomId?: string
  affectedReservationId?: string
}

export function useConflictDetection(rooms: BoardRoomCard[]) {
  
  const checkRoomAssignment = useMemo(() => (
    roomId: string,
    checkIn: Date,
    checkOut: Date,
    excludeReservationId?: string
  ): ConflictCheck => {
    if (checkIn >= checkOut) {
      return {
        hasConflict: true,
        conflictType: 'invalid_dates',
        message: 'Check-out must be after check-in'
      }
    }

    const room = rooms.find(r => r.roomId === roomId)
    if (!room) {
      return {
        hasConflict: true,
        conflictType: 'room_occupied',
        message: 'Room not found'
      }
    }

    if (room.operationalStatus === 'BLOCKED') {
      return {
        hasConflict: true,
        conflictType: 'blocked',
        message: `Room ${room.number} is blocked`,
        affectedRoomId: roomId
      }
    }

    if (room.operationalStatus === 'OUT_OF_SERVICE') {
      return {
        hasConflict: true,
        conflictType: 'maintenance',
        message: `Room ${room.number} is out of service`,
        affectedRoomId: roomId
      }
    }

    if (room.guestName && room.checkIn && room.checkOut && room.reservationId !== excludeReservationId) {
      const hasOverlap = checkIn < room.checkOut && checkOut > room.checkIn
      
      if (hasOverlap) {
        return {
          hasConflict: true,
          conflictType: 'date_overlap',
          message: `Room ${room.number} is occupied ${room.checkIn.toLocaleDateString()} - ${room.checkOut.toLocaleDateString()}`,
          affectedRoomId: roomId,
          affectedReservationId: room.reservationId
        }
      }
    }

    return { hasConflict: false }
  }, [rooms])

  const checkExtendStay = useMemo(() => (
    roomId: string,
    currentCheckOut: Date,
    newCheckOut: Date
  ): ConflictCheck => {
    if (newCheckOut <= currentCheckOut) {
      return {
        hasConflict: true,
        conflictType: 'invalid_dates',
        message: 'New check-out must be after current check-out'
      }
    }

    const room = rooms.find(r => r.roomId === roomId)
    if (!room) {
      return {
        hasConflict: true,
        conflictType: 'room_occupied',
        message: 'Room not found'
      }
    }

    return { hasConflict: false }
  }, [rooms])

  const checkDateAvailability = useMemo(() => (
    roomId: string,
    date: Date
  ): ConflictCheck => {
    const room = rooms.find(r => r.roomId === roomId)
    if (!room) {
      return {
        hasConflict: true,
        conflictType: 'room_occupied',
        message: 'Room not found'
      }
    }

    if (room.operationalStatus !== 'AVAILABLE') {
      return {
        hasConflict: true,
        conflictType: room.operationalStatus === 'BLOCKED' ? 'blocked' : 'maintenance',
        message: `Room ${room.number} is ${room.operationalStatus.toLowerCase()}`,
        affectedRoomId: roomId
      }
    }

    if (room.guestName && room.checkIn && room.checkOut) {
      const isOccupied = isWithinInterval(date, {
        start: room.checkIn,
        end: room.checkOut
      })

      if (isOccupied) {
        return {
          hasConflict: true,
          conflictType: 'room_occupied',
          message: `Room ${room.number} is occupied on this date`,
          affectedRoomId: roomId,
          affectedReservationId: room.reservationId
        }
      }
    }

    return { hasConflict: false }
  }, [rooms])

  const getBulkConflicts = useMemo(() => (
    operations: Array<{
      roomId: string
      checkIn: Date
      checkOut: Date
      excludeReservationId?: string
    }>
  ): ConflictCheck[] => {
    return operations.map(op => 
      checkRoomAssignment(op.roomId, op.checkIn, op.checkOut, op.excludeReservationId)
    )
  }, [checkRoomAssignment])

  return {
    checkRoomAssignment,
    checkExtendStay,
    checkDateAvailability,
    getBulkConflicts
  }
}
