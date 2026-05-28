import { useKV } from '@github/spark/hooks'
import { useCallback, useEffect, useMemo } from 'react'
import type { BoardRoomCard } from '@/types/board'
import type { HousekeepingRoom, CleanStatus } from '@/types/housekeeping'
import { mapServerBoardRooms, pmsApi, SERVER_API_ENABLED } from '@/lib/pms-api-client'

export interface RoomStatusUpdate {
  roomId: string
  cleanStatus: CleanStatus
  lastCleaned?: Date
  cleanedBy?: string
  timestamp: Date
}

function deserializeRoom(room: BoardRoomCard): BoardRoomCard {
  return {
    ...room,
    checkIn: room.checkIn ? new Date(room.checkIn) : undefined,
    checkOut: room.checkOut ? new Date(room.checkOut) : undefined,
    lastCleaned: room.lastCleaned ? new Date(room.lastCleaned) : undefined,
  }
}

export function useRoomSync() {
  const [roomsRaw, setRoomsRaw] = useKV<BoardRoomCard[]>('pms-rooms', [])
  const [lastUpdate, setLastUpdate] = useKV<RoomStatusUpdate | null>('last-room-update', null)
  const [authToken] = useKV<string | null>('auth:pms-token', null)

  const rooms = useMemo(() => (roomsRaw || []).map(deserializeRoom), [roomsRaw])

  const setRooms = useCallback((updater: BoardRoomCard[] | ((current: BoardRoomCard[]) => BoardRoomCard[])) => {
    setRoomsRaw((current) => {
      const deserialized = (current || []).map(deserializeRoom)
      const updated = typeof updater === 'function' ? updater(deserialized) : updater
      return updated
    })
  }, [setRoomsRaw])

  const updateRoomStatus = useCallback((update: Omit<RoomStatusUpdate, 'timestamp'>) => {
    const timestampedUpdate: RoomStatusUpdate = {
      ...update,
      timestamp: new Date()
    }

    setRooms((currentRooms) => {
      if (!currentRooms) return []
      return currentRooms.map(room => {
        if (room.roomId === update.roomId) {
          const newStatus = calculateBoardStatus(room.status, update.cleanStatus)
          return {
            ...room,
            housekeepingStatus: update.cleanStatus,
            cleanStatus: update.cleanStatus === 'CLEANING' ? 'DIRTY' : update.cleanStatus,
            status: newStatus,
            lastCleaned: update.lastCleaned || room.lastCleaned,
            lastUpdatedAt: timestampedUpdate.timestamp.toISOString(),
            lastUpdatedBy: update.cleanedBy || room.lastUpdatedBy || 'Staff',
          }
        }
        return room
      })
    })

    setLastUpdate(timestampedUpdate)

    if (SERVER_API_ENABLED && authToken) {
      void pmsApi(`/api/housekeeping/rooms/${update.roomId}/status`, authToken, {
        method: 'POST',
        body: JSON.stringify({
          status: update.cleanStatus,
          notes: update.cleanedBy ? `Updated by ${update.cleanedBy}` : undefined,
        }),
      }).then(async () => {
        const board = await pmsApi<{ ok: true; data: unknown }>('/api/front-desk/board', authToken)
        setRoomsRaw(mapServerBoardRooms(board.data))
      }).catch(() => undefined)
    }
  }, [authToken, setRooms, setLastUpdate, setRoomsRaw])

  const getRoomById = useCallback((roomId: string): BoardRoomCard | undefined => {
    return rooms?.find(r => r.roomId === roomId)
  }, [rooms])

  const getRoomByNumber = useCallback((roomNumber: string): BoardRoomCard | undefined => {
    return rooms?.find(r => r.number === roomNumber)
  }, [rooms])

  const initializeRooms = useCallback((initialRooms: BoardRoomCard[]) => {
    setRooms((current) => {
      if (!current || current.length === 0) {
        return initialRooms
      }
      return current
    })
  }, [setRooms])

  useEffect(() => {
    if (!SERVER_API_ENABLED || !authToken) return

    let cancelled = false
    pmsApi<{ ok: true; data: unknown }>('/api/front-desk/board', authToken)
      .then((payload) => {
        if (!cancelled) setRoomsRaw(mapServerBoardRooms(payload.data))
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [authToken, setRoomsRaw])

  return {
    rooms: rooms || [],
    lastUpdate,
    updateRoomStatus,
    getRoomById,
    getRoomByNumber,
    initializeRooms,
    setRooms
  }
}

function calculateBoardStatus(
  currentStatus: BoardRoomCard['status'],
  cleanStatus: CleanStatus
): BoardRoomCard['status'] {
  const isOccupied = currentStatus === 'OCCUPIED_CLEAN' || currentStatus === 'OCCUPIED_DIRTY'
  
  if (isOccupied) {
    return cleanStatus === 'CLEAN' || cleanStatus === 'INSPECTED' 
      ? 'OCCUPIED_CLEAN' 
      : 'OCCUPIED_DIRTY'
  } else {
    return cleanStatus === 'CLEAN' || cleanStatus === 'INSPECTED'
      ? 'VACANT_CLEAN'
      : 'VACANT_DIRTY'
  }
}

export function convertBoardRoomToHousekeepingRoom(boardRoom: BoardRoomCard): HousekeepingRoom {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  const checkInDate = boardRoom.checkIn ? new Date(boardRoom.checkIn) : undefined
  const checkOutDate = boardRoom.checkOut ? new Date(boardRoom.checkOut) : undefined
  
  const isArrivalToday = checkInDate ? 
    checkInDate.getTime() >= today.getTime() && 
    checkInDate.getTime() < today.getTime() + 24 * 60 * 60 * 1000 : 
    false
  
  const isDepartureToday = checkOutDate ? 
    checkOutDate.getTime() >= today.getTime() && 
    checkOutDate.getTime() < today.getTime() + 24 * 60 * 60 * 1000 : 
    false

  let priority = 5
  if (isDepartureToday && isArrivalToday) priority = 10
  else if (isDepartureToday) priority = 8
  else if (isArrivalToday) priority = 7
  else if (boardRoom.cleanStatus === 'DIRTY') priority = 6

  const housekeepingCleanStatus: CleanStatus = 
    boardRoom.cleanStatus === 'INSPECTED' ? 'INSPECTED' : 
    boardRoom.cleanStatus === 'CLEAN' ? 'CLEAN' : 
    'DIRTY'

  return {
    roomId: boardRoom.roomId,
    number: boardRoom.number,
    floor: boardRoom.floor,
    type: boardRoom.type,
    cleanStatus: housekeepingCleanStatus,
    isOccupied: boardRoom.status === 'OCCUPIED_CLEAN' || boardRoom.status === 'OCCUPIED_DIRTY',
    guestCount: boardRoom.guestCount,
    isDepartureToday,
    isArrivalToday,
    arrivalTime: isArrivalToday ? '14:00' : undefined,
    departureTime: isDepartureToday ? '11:00' : undefined,
    guestName: boardRoom.guestName,
    checkOutTime: isDepartureToday ? '11:00' : undefined,
    priority,
    hasMaintenanceIssue: boardRoom.hasIssue,
    maintenanceNotes: boardRoom.hasIssue ? 'Issue reported' : undefined,
    needsDeepClean: false,
    lastCleaned: boardRoom.lastCleaned
  }
}
