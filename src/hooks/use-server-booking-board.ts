import { useCallback, useEffect, useMemo, useState } from 'react'
import { addDays, format, parseISO, startOfDay } from 'date-fns'
import { pmsApi } from '@/lib/pms-api-client'
import type {
  BookingBoardRangeDays,
  ServerBookingBoardData,
  ServerBookingBoardReservation,
  ServerBookingBoardRoom,
} from '@/types/server-booking-board'

const BOARD_DOMAIN_EVENT_TYPES = new Set([
  'RESERVATION_CREATED',
  'RESERVATION_UPDATED',
  'RESERVATION_CANCELLED',
  'RESERVATION_NO_SHOW',
  'RESERVATION_CHECKED_IN',
  'RESERVATION_CHECKED_OUT',
  'PUBLIC_BOOKING_CREATED',
  'ROOM_HOUSEKEEPING_UPDATED',
  'ROOM_OPERATIONAL_STATUS_UPDATED',
  'PAYMENT_CREATED',
  'CHARGE_CREATED',
])

type RawRoom = {
  id?: unknown
  number?: unknown
  floor?: unknown
  currentStatus?: unknown
  operationalStatus?: unknown
  roomTypeId?: unknown
  roomType?: {
    id?: unknown
    code?: unknown
    name?: unknown
  } | null
}

type RawReservation = {
  id?: unknown
  confirmationCode?: unknown
  status?: unknown
  checkIn?: unknown
  checkOut?: unknown
  updatedAt?: unknown
  version?: unknown
  assignedRoomId?: unknown
  assignedRoom?: { id?: unknown } | null
  roomType?: {
    id?: unknown
    code?: unknown
    name?: unknown
  } | null
  adults?: unknown
  children?: unknown
  guest?: {
    firstName?: unknown
    lastName?: unknown
    vipStatus?: unknown
  } | null
  folio?: {
    balance?: unknown
  } | null
}

type RawBoardResponse = {
  property?: {
    id?: unknown
    name?: unknown
  } | null
  rooms?: RawRoom[]
  reservations?: RawReservation[]
  propertyDisplay?: {
    id?: unknown
    code?: unknown
    name?: unknown
    timezone?: unknown
    currency?: unknown
    defaultCheckIn?: unknown
    defaultCheckOut?: unknown
    extraGuestFee?: unknown
    extraGuestFeeSatang?: unknown
    childFee?: unknown
    childFeeSatang?: unknown
    taxRate?: unknown
    taxRateBasisPoints?: unknown
  } | null
  range?: {
    from?: unknown
    to?: unknown
    durationDays?: unknown
    semantics?: unknown
  } | null
  inventoryBlocks?: Array<{
    id?: unknown
    roomId?: unknown
    date?: unknown
    status?: unknown
    notes?: unknown
    updatedAt?: unknown
  }>
  roomTypes?: Array<{
    id?: unknown
    code?: unknown
    name?: unknown
    baseRate?: unknown
    baseRateSatang?: unknown
    standardOcc?: unknown
    maxOccupancy?: unknown
  }>
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function number(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function bahtFromSatang(value: unknown) {
  const raw = text(value)
  if (!/^-?\d+$/.test(raw)) return undefined
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) ? parsed / 100 : undefined
}

function normalizeRoom(room: RawRoom): ServerBookingBoardRoom | null {
  const id = text(room.id)
  const roomNumber = text(room.number)
  if (!id || !roomNumber) return null

  const typeName = text(room.roomType?.name, 'Unclassified')
  const typeCode = text(room.roomType?.code, typeName.toUpperCase().replace(/[^A-Z0-9]+/g, '_'))

  return {
    id,
    number: roomNumber,
    floor: number(room.floor),
    currentStatus: text(room.currentStatus, 'UNKNOWN'),
    operationalStatus: text(room.operationalStatus, 'UNKNOWN'),
    roomType: {
      id: text(room.roomType?.id ?? room.roomTypeId, typeCode || typeName),
      code: typeCode,
      name: typeName,
    },
  }
}

function normalizeReservation(reservation: RawReservation): ServerBookingBoardReservation | null {
  const id = text(reservation.id)
  const checkIn = text(reservation.checkIn)
  const checkOut = text(reservation.checkOut)
  const updatedAt = text(reservation.updatedAt)
  if (!id || !checkIn || !checkOut || !updatedAt) return null

  const firstName = text(reservation.guest?.firstName)
  const lastName = text(reservation.guest?.lastName)
  const balanceValue = reservation.folio?.balance
  const roomTypeId = text(reservation.roomType?.id)
  const roomTypeCode = text(reservation.roomType?.code)
  const roomTypeName = text(reservation.roomType?.name)
  if (!roomTypeId || !roomTypeCode || !roomTypeName) return null

  return {
    id,
    confirmationCode: text(reservation.confirmationCode, id.slice(0, 8).toUpperCase()),
    status: text(reservation.status, 'UNKNOWN'),
    checkIn,
    checkOut,
    updatedAt,
    version: text(reservation.version, updatedAt),
    assignedRoomId: text(reservation.assignedRoomId ?? reservation.assignedRoom?.id) || null,
    roomTypeId,
    roomTypeCode,
    roomTypeName,
    guestName: `${firstName} ${lastName}`.trim() || 'Guest',
    isVip: Boolean(reservation.guest?.vipStatus),
    adults: number(reservation.adults),
    children: number(reservation.children),
    balance: balanceValue === null || balanceValue === undefined ? null : number(balanceValue),
  }
}

function normalizeBoard(data: RawBoardResponse): ServerBookingBoardData {
  const propertyId = text(data.propertyDisplay?.id ?? data.property?.id)
  const propertyName = text(data.propertyDisplay?.name ?? data.property?.name, 'Hotel PMS')
  return {
    property: {
      id: propertyId,
      name: propertyName,
    },
    propertyDisplay: {
      id: propertyId,
      code: text(data.propertyDisplay?.code),
      name: propertyName,
      timezone: text(data.propertyDisplay?.timezone, 'Asia/Bangkok'),
      currency: text(data.propertyDisplay?.currency, 'THB'),
      defaultCheckIn: text(data.propertyDisplay?.defaultCheckIn),
      defaultCheckOut: text(data.propertyDisplay?.defaultCheckOut),
      extraGuestFee: bahtFromSatang(data.propertyDisplay?.extraGuestFeeSatang)
        ?? number(data.propertyDisplay?.extraGuestFee),
      childFee: bahtFromSatang(data.propertyDisplay?.childFeeSatang)
        ?? number(data.propertyDisplay?.childFee),
      taxRate: number(data.propertyDisplay?.taxRate),
      taxRateBasisPoints: number(data.propertyDisplay?.taxRateBasisPoints),
    },
    range: {
      from: text(data.range?.from),
      to: text(data.range?.to),
      durationDays: number(data.range?.durationDays),
      semantics: 'FROM_INCLUSIVE_TO_EXCLUSIVE',
    },
    inventoryBlocks: (data.inventoryBlocks || []).flatMap((block) => {
      const id = text(block.id)
      const roomId = text(block.roomId)
      const date = text(block.date)
      if (!id || !roomId || !date) return []
      return [{
        id,
        roomId,
        date,
        status: text(block.status, 'BLOCKED'),
        notes: text(block.notes) || null,
        updatedAt: text(block.updatedAt),
      }]
    }),
    roomTypes: (data.roomTypes || []).flatMap((roomType) => {
      const id = text(roomType.id)
      const code = text(roomType.code)
      const name = text(roomType.name)
      if (!id || !code || !name) return []
      return [{
        id,
        code,
        name,
        baseRate: bahtFromSatang(roomType.baseRateSatang) ?? number(roomType.baseRate),
        standardOcc: number(roomType.standardOcc, 2),
        maxOccupancy: number(roomType.maxOccupancy, 2),
      }]
    }),
    rooms: (data.rooms || []).map(normalizeRoom).filter((room): room is ServerBookingBoardRoom => Boolean(room)),
    reservations: (data.reservations || [])
      .map(normalizeReservation)
      .filter((reservation): reservation is ServerBookingBoardReservation => Boolean(reservation)),
  }
}

export function useServerBookingBoard(startDate: Date, days: BookingBoardRangeDays) {
  const startKey = format(startOfDay(startDate), 'yyyy-MM-dd')
  const [data, setData] = useState<ServerBookingBoardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const range = useMemo(() => {
    const start = startOfDay(parseISO(startKey))
    return {
      start,
      end: addDays(start, days),
    }
  }, [days, startKey])

  const reload = useCallback(() => {
    setReloadToken((current) => current + 1)
  }, [])

  useEffect(() => {
    let timer: number | null = null
    const handleDomainEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; aggregateType?: string }>).detail
      const eventType = text(detail?.type).toUpperCase()
      const aggregateType = text(detail?.aggregateType).toLowerCase()
      const affectsBoard = BOARD_DOMAIN_EVENT_TYPES.has(eventType)
        || ['reservation', 'room', 'payment', 'charge', 'folio'].includes(aggregateType)
      if (!affectsBoard) return

      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(reload, 150)
    }

    window.addEventListener('pms:domain-event', handleDomainEvent)
    return () => {
      window.removeEventListener('pms:domain-event', handleDomainEvent)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [reload])

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({
      from: startKey,
      to: format(range.end, 'yyyy-MM-dd'),
    })

    setData(null)
    setLoading(true)
    setError(null)

    void pmsApi<{ ok: true; data: RawBoardResponse }>(
      `/api/front-desk/board?${params.toString()}`,
      null,
      { signal: controller.signal },
    )
      .then((response) => {
        setData(normalizeBoard(response.data))
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        setData(null)
        setError(caught instanceof Error ? caught.message : 'The booking board could not be loaded.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [range.end, reloadToken, startKey])

  return {
    data,
    loading,
    error,
    reload,
    range,
  }
}
