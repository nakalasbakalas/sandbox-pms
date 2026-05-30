import { useEffect, useMemo, useState } from 'react'
import { useKV } from '@github/spark/hooks'
import { eachDayOfInterval, format } from 'date-fns'
import type { BoardRoomCard } from '@/types/board'
import type { Guest, Reservation } from '@/types'
import type {
  OperationsReport,
  RevenueReport,
  ReservationReport,
  HousekeepingReport,
  ChannelReport,
  GuestReport,
  DailyOperationsStat,
  DailyRevenueStat,
  BookingPaceStat,
  DailyHousekeepingStat,
  ChannelPerformance,
  ChannelSyncHealth,
  NationalityBreakdown,
  RepeatGuestStat,
} from '@/types/reports'
import { pmsApi, SERVER_API_ENABLED } from '@/lib/pms-api-client'

interface DateRange {
  from: Date
  to: Date
}

type ReportReservation = Partial<Reservation> & {
  id: string
  guestId?: string | null
  guest?: { firstName?: string; lastName?: string; nationality?: string | null; vipStatus?: boolean; blacklisted?: boolean }
  roomType?: { id?: string; code?: string; name?: string }
  assignedRoom?: { id?: string; number?: string }
  folio?: ReportFolio | null
}

type ReportGuest = Partial<Guest> & {
  id: string
  firstName?: string
  lastName?: string
  reservations?: ReportReservation[]
}

type ReportRoom = Partial<BoardRoomCard> & {
  id?: string
  roomId?: string
  number?: string
  operationalStatus?: string
  currentStatus?: string
  roomType?: { id?: string; code?: string; name?: string }
}

type ReportFolio = {
  reservationId?: string
  total?: number
  paid?: number
  balance?: number
  charges?: Array<{ category?: string; date?: string; createdAt?: string; amount?: number; total?: number }>
  payments?: Array<{ amount?: number; createdAt?: string; receivedAt?: string }>
}

type ServerSnapshot = {
  rooms: ReportRoom[]
  reservations: ReportReservation[]
  guests: ReportGuest[]
}

const ACTIVE_RESERVATION_STATUSES = new Set(['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'HOLD'])
const SOLD_RESERVATION_STATUSES = new Set(['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'])
const ARRIVAL_DEPARTURE_STATUSES = new Set(['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'])

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function dateKey(value: Date | string | null | undefined): string {
  const date = toDate(value)
  return date ? format(date, 'yyyy-MM-dd') : ''
}

function normalizeRange(dateRange: DateRange): DateRange {
  const from = startOfLocalDay(toDate(dateRange.from) ?? new Date())
  const to = startOfLocalDay(toDate(dateRange.to) ?? from)
  return from <= to ? { from, to } : { from: to, to: from }
}

function periodForRange(dateRange: DateRange) {
  const range = normalizeRange(dateRange)
  return { start: range.from, end: range.to }
}

function daysForRange(dateRange: DateRange): Date[] {
  const range = normalizeRange(dateRange)
  return eachDayOfInterval({ start: range.from, end: range.to })
}

function safeDivide(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0
}

function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100
}

function normalizeStatus(status: unknown): string {
  return String(status || '').toUpperCase()
}

function isRoomSellable(room: ReportRoom): boolean {
  const operationalStatus = normalizeStatus(room.operationalStatus)
  return Boolean(String(room.number || '').trim()) && !['BLOCKED', 'OUT_OF_SERVICE', 'OUT_OF_ORDER'].includes(operationalStatus)
}

function roomStatus(room: ReportRoom): string {
  return normalizeStatus(room.currentStatus || room.cleanStatus || room.status)
}

function reservationStatus(reservation: ReportReservation): string {
  return normalizeStatus(reservation.status)
}

function reservationNights(reservation: ReportReservation): number {
  const checkIn = toDate(reservation.checkIn)
  const checkOut = toDate(reservation.checkOut)
  if (!checkIn || !checkOut) return 0
  const milliseconds = startOfLocalDay(checkOut).getTime() - startOfLocalDay(checkIn).getTime()
  return Math.max(0, Math.round(milliseconds / 86_400_000))
}

function reservationCoversNight(reservation: ReportReservation, day: Date): boolean {
  const checkInKey = dateKey(reservation.checkIn)
  const checkOutKey = dateKey(reservation.checkOut)
  const dayKey = dateKey(day)
  return Boolean(checkInKey && checkOutKey && dayKey >= checkInKey && dayKey < checkOutKey)
}

function reservationStartsOn(reservation: ReportReservation, day: Date): boolean {
  return dateKey(reservation.checkIn) === dateKey(day)
}

function reservationEndsOn(reservation: ReportReservation, day: Date): boolean {
  return dateKey(reservation.checkOut) === dateKey(day)
}

function reservationsInRange(reservations: ReportReservation[], dateRange: DateRange): ReportReservation[] {
  const range = normalizeRange(dateRange)
  const startKey = dateKey(range.from)
  const endKey = dateKey(range.to)
  return reservations.filter((reservation) => {
    const checkInKey = dateKey(reservation.checkIn)
    const checkOutKey = dateKey(reservation.checkOut)
    return checkInKey <= endKey && checkOutKey >= startKey
  })
}

function sourceLabel(source: unknown): string {
  const value = String(source || 'DIRECT').toUpperCase()
  const labels: Record<string, string> = {
    DIRECT: 'Direct',
    WALK_IN: 'Walk-in',
    PHONE: 'Phone',
    EMAIL: 'Email',
    WEBSITE: 'Website',
    BOOKING_COM: 'Booking.com',
    AGODA: 'Agoda',
    EXPEDIA: 'Expedia',
    AIRBNB: 'Airbnb',
    OTHER: 'Other',
  }
  return labels[value] || value.replaceAll('_', ' ')
}

function roomTypeId(reservation: ReportReservation): string {
  return reservation.roomType?.id || reservation.roomTypeId || 'unassigned'
}

function roomTypeName(reservation: ReportReservation): string {
  return reservation.roomType?.name || reservation.roomType?.code || String(reservation.roomTypeId || 'Unassigned room type')
}

function guestNameFromReservation(reservation: ReportReservation): string {
  if (reservation.guestName) return String(reservation.guestName)
  const firstName = reservation.guest?.firstName || ''
  const lastName = reservation.guest?.lastName || ''
  return `${firstName} ${lastName}`.trim() || 'Guest record'
}

function reservationTotal(reservation: ReportReservation): number {
  return Number(reservation.totalAmount || reservation.folio?.total || 0)
}

function reservationPaid(reservation: ReportReservation): number {
  const payments = reservation.folio?.payments || []
  if (typeof reservation.folio?.paid === 'number') return reservation.folio.paid
  return payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
}

function reservationBalance(reservation: ReportReservation): number {
  if (typeof reservation.folio?.balance === 'number') return reservation.folio.balance
  return Math.max(0, reservationTotal(reservation) - reservationPaid(reservation))
}

function realRoomCount(rooms: ReportRoom[]): number {
  return rooms.filter(isRoomSellable).length
}

function realRoomStatusCounts(rooms: ReportRoom[]) {
  const configuredRooms = rooms.length ? rooms : []
  return {
    dirty: configuredRooms.filter((room) => ['VACANT_DIRTY', 'OCCUPIED_DIRTY', 'DIRTY'].includes(roomStatus(room))).length,
    clean: configuredRooms.filter((room) => ['VACANT_CLEAN', 'OCCUPIED_CLEAN', 'CLEAN'].includes(roomStatus(room))).length,
    inspected: configuredRooms.filter((room) => roomStatus(room) === 'INSPECTED').length,
    maintenance: configuredRooms.filter((room) => ['OUT_OF_SERVICE', 'OUT_OF_ORDER'].includes(normalizeStatus(room.operationalStatus))).length,
    blocked: configuredRooms.filter((room) => normalizeStatus(room.operationalStatus) === 'BLOCKED').length,
  }
}

function generateOperationsData(dateRange: DateRange, rooms: ReportRoom[], reservations: ReportReservation[]): OperationsReport {
  const days = daysForRange(dateRange)
  const roomCount = realRoomCount(rooms)
  const statusCounts = realRoomStatusCounts(rooms)
  const todayKey = dateKey(new Date())

  const dailyStats: DailyOperationsStat[] = days.map((date) => {
    const key = dateKey(date)
    const arrivals = reservations.filter((reservation) =>
      ARRIVAL_DEPARTURE_STATUSES.has(reservationStatus(reservation)) && reservationStartsOn(reservation, date)
    ).length
    const departures = reservations.filter((reservation) =>
      ARRIVAL_DEPARTURE_STATUSES.has(reservationStatus(reservation)) && reservationEndsOn(reservation, date)
    ).length
    const occupiedReservations = reservations.filter((reservation) =>
      SOLD_RESERVATION_STATUSES.has(reservationStatus(reservation)) && reservationCoversNight(reservation, date)
    )
    const roomsOccupied = Math.min(roomCount, occupiedReservations.length)
    const currentRoomStatusAvailable = key === todayKey

    return {
      date,
      arrivals,
      departures,
      inHouse: roomsOccupied,
      occupancyRate: safeDivide(roomsOccupied, roomCount),
      availableRooms: Math.max(0, roomCount - roomsOccupied),
      roomsOccupied,
      roomsDirty: currentRoomStatusAvailable ? statusCounts.dirty : 0,
      roomsClean: currentRoomStatusAvailable ? statusCounts.clean : 0,
      roomsInspected: currentRoomStatusAvailable ? statusCounts.inspected : 0,
      roomsMaintenance: currentRoomStatusAvailable ? statusCounts.maintenance : 0,
      roomsBlocked: currentRoomStatusAvailable ? statusCounts.blocked : 0,
      turnoverCount: Math.min(arrivals, departures),
    }
  })

  const totalArrivals = dailyStats.reduce((sum, stat) => sum + stat.arrivals, 0)
  const totalDepartures = dailyStats.reduce((sum, stat) => sum + stat.departures, 0)
  const avgOccupancyRate = safeDivide(dailyStats.reduce((sum, stat) => sum + stat.occupancyRate, 0), dailyStats.length)
  const peakDay = dailyStats.reduce((max, stat) => (stat.occupancyRate > max.occupancyRate ? stat : max), dailyStats[0])
  const lowestDay = dailyStats.reduce((min, stat) => (stat.occupancyRate < min.occupancyRate ? stat : min), dailyStats[0])
  const scopedReservations = reservationsInRange(reservations, dateRange)
  const totalNoShows = scopedReservations.filter((reservation) => reservationStatus(reservation) === 'NO_SHOW').length
  const totalCancellations = scopedReservations.filter((reservation) => reservationStatus(reservation) === 'CANCELLED').length

  return {
    period: periodForRange(dateRange),
    dailyStats,
    summary: {
      totalArrivals,
      totalDepartures,
      avgOccupancyRate,
      peakOccupancyDate: peakDay?.date ?? normalizeRange(dateRange).from,
      peakOccupancyRate: peakDay?.occupancyRate ?? 0,
      lowestOccupancyDate: lowestDay?.date ?? normalizeRange(dateRange).from,
      lowestOccupancyRate: lowestDay?.occupancyRate ?? 0,
      totalNoShows,
      totalCancellations,
      cancellationRate: safeDivide(totalCancellations, scopedReservations.length),
    },
  }
}

function generateRevenueData(dateRange: DateRange, rooms: ReportRoom[], reservations: ReportReservation[]): RevenueReport {
  const days = daysForRange(dateRange)
  const roomCount = realRoomCount(rooms)
  const revenueReservations = reservations.filter((reservation) => SOLD_RESERVATION_STATUSES.has(reservationStatus(reservation)))

  const dailyStats: DailyRevenueStat[] = days.map((date) => {
    const reservationsForNight = revenueReservations.filter((reservation) => reservationCoversNight(reservation, date))
    const roomRevenue = reservationsForNight.reduce((sum, reservation) => {
      const nights = reservationNights(reservation)
      return sum + safeDivide(reservationTotal(reservation), nights)
    }, 0)
    const extrasRevenue = revenueReservations.reduce((sum, reservation) => {
      const charges = reservation.folio?.charges || []
      return sum + charges
        .filter((charge) => normalizeStatus(charge.category) !== 'ROOM' && dateKey(charge.date || charge.createdAt) === dateKey(date))
        .reduce((chargeSum, charge) => chargeSum + Number(charge.total ?? charge.amount ?? 0), 0)
    }, 0)
    const roomsSold = reservationsForNight.length
    const totalRevenue = roomRevenue + extrasRevenue

    return {
      date,
      roomRevenue: roundMoney(roomRevenue),
      extrasRevenue: roundMoney(extrasRevenue),
      totalRevenue: roundMoney(totalRevenue),
      roomsSold,
      roomsAvailable: roomCount,
      adr: roundMoney(safeDivide(roomRevenue, roomsSold)),
      revpar: roundMoney(safeDivide(roomRevenue, roomCount)),
      occupancyRate: safeDivide(roomsSold, roomCount),
    }
  })

  const totalRevenue = roundMoney(dailyStats.reduce((sum, stat) => sum + stat.totalRevenue, 0))
  const roomRevenue = roundMoney(dailyStats.reduce((sum, stat) => sum + stat.roomRevenue, 0))
  const extrasRevenue = roundMoney(dailyStats.reduce((sum, stat) => sum + stat.extrasRevenue, 0))
  const totalRoomNights = dailyStats.reduce((sum, stat) => sum + stat.roomsSold, 0)
  const avgOccupancy = safeDivide(dailyStats.reduce((sum, stat) => sum + stat.occupancyRate, 0), dailyStats.length)

  const roomTypeBuckets = new Map<string, { roomTypeName: string; roomsSold: number; revenue: number }>()
  const channelBuckets = new Map<string, { reservations: number; revenue: number }>()

  for (const reservation of revenueReservations.filter((item) => reservationsInRange([item], dateRange).length > 0)) {
    const nights = reservationNights(reservation)
    const total = reservationTotal(reservation)
    const roomTypeKey = roomTypeId(reservation)
    const roomTypeBucket = roomTypeBuckets.get(roomTypeKey) || { roomTypeName: roomTypeName(reservation), roomsSold: 0, revenue: 0 }
    roomTypeBucket.roomsSold += nights
    roomTypeBucket.revenue += total
    roomTypeBuckets.set(roomTypeKey, roomTypeBucket)

    const channel = sourceLabel(reservation.source)
    const channelBucket = channelBuckets.get(channel) || { reservations: 0, revenue: 0 }
    channelBucket.reservations += 1
    channelBucket.revenue += total
    channelBuckets.set(channel, channelBucket)
  }

  return {
    period: periodForRange(dateRange),
    dailyStats,
    summary: {
      totalRevenue,
      roomRevenue,
      extrasRevenue,
      avgADR: roundMoney(safeDivide(roomRevenue, totalRoomNights)),
      avgRevPAR: roundMoney(safeDivide(totalRevenue, days.length * roomCount)),
      avgOccupancy,
      totalRoomNights,
      outstandingBalance: roundMoney(revenueReservations.reduce((sum, reservation) => sum + reservationBalance(reservation), 0)),
      depositsCollected: roundMoney(revenueReservations.reduce((sum, reservation) => sum + (reservation.depositPaid ? Number(reservation.depositAmount || 0) : 0), 0)),
      depositsPending: roundMoney(revenueReservations.reduce((sum, reservation) => sum + (!reservation.depositPaid ? Number(reservation.depositAmount || 0) : 0), 0)),
      refundsIssued: roundMoney(Math.abs(revenueReservations.reduce((sum, reservation) => {
        const payments = reservation.folio?.payments || []
        return sum + payments.filter((payment) => Number(payment.amount || 0) < 0).reduce((paymentSum, payment) => paymentSum + Number(payment.amount || 0), 0)
      }, 0))),
    },
    byRoomType: Array.from(roomTypeBuckets.entries()).map(([id, bucket]) => ({
      roomTypeId: id,
      roomTypeName: bucket.roomTypeName,
      roomsSold: bucket.roomsSold,
      revenue: roundMoney(bucket.revenue),
      adr: roundMoney(safeDivide(bucket.revenue, bucket.roomsSold)),
      occupancyRate: safeDivide(bucket.roomsSold, days.length * Math.max(1, rooms.filter((room) => room.roomType?.id === id || room.roomType?.code === id).length || 1)),
    })),
    byChannel: Array.from(channelBuckets.entries()).map(([channel, bucket]) => ({
      channel,
      reservations: bucket.reservations,
      revenue: roundMoney(bucket.revenue),
      adr: roundMoney(safeDivide(bucket.revenue, bucket.reservations)),
      percentage: safeDivide(bucket.revenue, totalRevenue) * 100,
    })),
  }
}

function generateReservationData(dateRange: DateRange, reservations: ReportReservation[]): ReservationReport {
  const days = daysForRange(dateRange)
  const scopedReservations = reservations.filter((reservation) =>
    ACTIVE_RESERVATION_STATUSES.has(reservationStatus(reservation)) && reservationsInRange([reservation], dateRange).length > 0
  )
  const bookingPace: BookingPaceStat[] = days.map((date) => {
    const reservationsBooked = reservations.filter((reservation) => dateKey(reservation.createdAt) === dateKey(date))
    return {
      bookingDate: date,
      reservationsBooked: reservationsBooked.length,
      roomNightsBooked: reservationsBooked.reduce((sum, reservation) => sum + reservationNights(reservation), 0),
      totalValue: roundMoney(reservationsBooked.reduce((sum, reservation) => sum + reservationTotal(reservation), 0)),
    }
  })

  const sourceBuckets = new Map<string, { reservations: number; roomNights: number; revenue: number; cancellations: number }>()
  for (const reservation of reservationsInRange(reservations, dateRange)) {
    const source = sourceLabel(reservation.source)
    const bucket = sourceBuckets.get(source) || { reservations: 0, roomNights: 0, revenue: 0, cancellations: 0 }
    bucket.reservations += 1
    bucket.roomNights += reservationNights(reservation)
    bucket.revenue += reservationTotal(reservation)
    bucket.cancellations += reservationStatus(reservation) === 'CANCELLED' ? 1 : 0
    sourceBuckets.set(source, bucket)
  }

  const totalReservations = scopedReservations.length
  const totalRoomNights = scopedReservations.reduce((sum, reservation) => sum + reservationNights(reservation), 0)
  const totalCancellations = reservationsInRange(reservations, dateRange).filter((reservation) => reservationStatus(reservation) === 'CANCELLED').length
  const leadTimes = scopedReservations.map((reservation) => {
    const createdAt = toDate(reservation.createdAt)
    const checkIn = toDate(reservation.checkIn)
    if (!createdAt || !checkIn) return 0
    return Math.max(0, Math.round((startOfLocalDay(checkIn).getTime() - startOfLocalDay(createdAt).getTime()) / 86_400_000))
  })

  const stayLengths = scopedReservations.map(reservationNights)

  return {
    period: periodForRange(dateRange),
    bookingPace,
    leadTime: {
      sameDay: leadTimes.filter((daysBeforeArrival) => daysBeforeArrival === 0).length,
      days1to3: leadTimes.filter((daysBeforeArrival) => daysBeforeArrival >= 1 && daysBeforeArrival <= 3).length,
      days4to7: leadTimes.filter((daysBeforeArrival) => daysBeforeArrival >= 4 && daysBeforeArrival <= 7).length,
      days8to14: leadTimes.filter((daysBeforeArrival) => daysBeforeArrival >= 8 && daysBeforeArrival <= 14).length,
      days15to30: leadTimes.filter((daysBeforeArrival) => daysBeforeArrival >= 15 && daysBeforeArrival <= 30).length,
      days31to60: leadTimes.filter((daysBeforeArrival) => daysBeforeArrival >= 31 && daysBeforeArrival <= 60).length,
      days61to90: leadTimes.filter((daysBeforeArrival) => daysBeforeArrival >= 61 && daysBeforeArrival <= 90).length,
      over90Days: leadTimes.filter((daysBeforeArrival) => daysBeforeArrival > 90).length,
    },
    stayLength: {
      oneNight: stayLengths.filter((nights) => nights === 1).length,
      twoNights: stayLengths.filter((nights) => nights === 2).length,
      threeFourNights: stayLengths.filter((nights) => nights >= 3 && nights <= 4).length,
      fiveSixNights: stayLengths.filter((nights) => nights >= 5 && nights <= 6).length,
      oneWeek: stayLengths.filter((nights) => nights === 7).length,
      twoWeeks: stayLengths.filter((nights) => nights > 7 && nights <= 14).length,
      overTwoWeeks: stayLengths.filter((nights) => nights > 14).length,
    },
    sourceBreakdown: Array.from(sourceBuckets.entries()).map(([source, bucket]) => ({
      source,
      reservations: bucket.reservations,
      roomNights: bucket.roomNights,
      revenue: roundMoney(bucket.revenue),
      adr: roundMoney(safeDivide(bucket.revenue, bucket.roomNights)),
      cancellations: bucket.cancellations,
      cancellationRate: safeDivide(bucket.cancellations, bucket.reservations),
    })),
    summary: {
      totalReservations,
      totalRoomNights,
      avgStayLength: safeDivide(totalRoomNights, totalReservations),
      avgLeadTime: safeDivide(leadTimes.reduce((sum, value) => sum + value, 0), leadTimes.length),
      totalCancellations,
      cancellationRate: safeDivide(totalCancellations, totalReservations + totalCancellations),
      totalModifications: 0,
      modificationRate: 0,
      directBookingRate: safeDivide(scopedReservations.filter((reservation) => sourceLabel(reservation.source) === 'Direct').length, totalReservations),
    },
  }
}

function generateHousekeepingData(dateRange: DateRange, rooms: ReportRoom[], reservations: ReportReservation[]): HousekeepingReport {
  const days = daysForRange(dateRange)
  const statusCounts = realRoomStatusCounts(rooms)
  const todayKey = dateKey(new Date())

  const dailyStats: DailyHousekeepingStat[] = days.map((date) => {
    const key = dateKey(date)
    const checkouts = reservations.filter((reservation) =>
      ARRIVAL_DEPARTURE_STATUSES.has(reservationStatus(reservation)) && reservationEndsOn(reservation, date)
    ).length
    const hasCurrentRoomStatus = key === todayKey

    return {
      date,
      checkouts,
      turnovers: checkouts,
      cleanedRooms: hasCurrentRoomStatus ? statusCounts.clean : 0,
      inspectedRooms: hasCurrentRoomStatus ? statusCounts.inspected : 0,
      avgCleanTime: 0,
      sameDayTurnovers: 0,
      delayedReadiness: hasCurrentRoomStatus ? statusCounts.dirty : 0,
    }
  })

  return {
    period: periodForRange(dateRange),
    dailyStats,
    summary: {
      totalCleanings: dailyStats.reduce((sum, stat) => sum + stat.cleanedRooms, 0),
      totalInspections: dailyStats.reduce((sum, stat) => sum + stat.inspectedRooms, 0),
      avgCleaningTime: 0,
      onTimeReadinessRate: 0,
      maintenanceRoomDays: rooms.filter((room) => ['OUT_OF_SERVICE', 'OUT_OF_ORDER'].includes(normalizeStatus(room.operationalStatus))).length * days.length,
      blockedRoomDays: rooms.filter((room) => normalizeStatus(room.operationalStatus) === 'BLOCKED').length * days.length,
    },
    byRoom: rooms.map((room) => ({
      roomNumber: room.number || 'Unnumbered',
      cleanings: 0,
      avgCleanTime: 0,
      maintenanceDays: ['OUT_OF_SERVICE', 'OUT_OF_ORDER'].includes(normalizeStatus(room.operationalStatus)) ? days.length : 0,
      blockedDays: normalizeStatus(room.operationalStatus) === 'BLOCKED' ? days.length : 0,
    })),
  }
}

function generateChannelData(dateRange: DateRange, reservations: ReportReservation[]): ChannelReport {
  const scopedReservations = reservationsInRange(reservations, dateRange).filter((reservation) =>
    ACTIVE_RESERVATION_STATUSES.has(reservationStatus(reservation))
  )
  const channelBuckets = new Map<string, ChannelPerformance>()

  for (const reservation of scopedReservations) {
    const channel = sourceLabel(reservation.source)
    const current = channelBuckets.get(channel) || {
      channel,
      reservations: 0,
      roomNights: 0,
      revenue: 0,
      adr: 0,
      cancellations: 0,
      modifications: 0,
      avgLeadTime: 0,
    }
    current.reservations += 1
    current.roomNights += reservationNights(reservation)
    current.revenue += reservationTotal(reservation)
    channelBuckets.set(channel, current)
  }

  const byChannel = Array.from(channelBuckets.values()).map((channel) => ({
    ...channel,
    revenue: roundMoney(channel.revenue),
    adr: roundMoney(safeDivide(channel.revenue, channel.roomNights)),
  }))
  const totalChannelRevenue = byChannel.reduce((sum, channel) => sum + channel.revenue, 0)
  const directRevenue = byChannel.find((channel) => channel.channel === 'Direct')?.revenue || 0
  const syncHealth: ChannelSyncHealth[] = byChannel.map((channel) => ({
    channel: channel.channel,
    lastSyncTime: normalizeRange(dateRange).to,
    totalSyncs: 0,
    successfulSyncs: 0,
    failedSyncs: 0,
    successRate: 0,
    conflicts: 0,
    unmappedRooms: 0,
  }))
  const mostPerforming = byChannel.reduce<ChannelPerformance | null>((best, channel) => {
    if (!best || channel.revenue > best.revenue) return channel
    return best
  }, null)

  return {
    period: periodForRange(dateRange),
    byChannel,
    syncHealth,
    summary: {
      totalChannelReservations: byChannel.reduce((sum, channel) => sum + channel.reservations, 0),
      totalChannelRevenue: roundMoney(totalChannelRevenue),
      directBookingPercentage: safeDivide(directRevenue, totalChannelRevenue) * 100,
      otaBookingPercentage: safeDivide(totalChannelRevenue - directRevenue, totalChannelRevenue) * 100,
      avgChannelADR: roundMoney(safeDivide(totalChannelRevenue, byChannel.reduce((sum, channel) => sum + channel.roomNights, 0))),
      avgDirectADR: roundMoney(safeDivide(directRevenue, byChannel.find((channel) => channel.channel === 'Direct')?.roomNights || 0)),
      mostPerformingChannel: mostPerforming?.channel || 'No channel data',
    },
  }
}

function guestName(guest: ReportGuest): string {
  return `${guest.firstName || ''} ${guest.lastName || ''}`.trim() || 'Guest record'
}

function guestsFromReservations(reservations: ReportReservation[]): ReportGuest[] {
  const guests = new Map<string, ReportGuest>()
  for (const reservation of reservations) {
    const id = reservation.guestId || reservation.guest?.firstName || reservation.id
    const current = guests.get(id) || {
      id,
      firstName: reservation.guest?.firstName || guestNameFromReservation(reservation),
      lastName: reservation.guest?.lastName || '',
      nationality: reservation.guest?.nationality || null,
      vipStatus: Boolean(reservation.guest?.vipStatus),
      blacklisted: Boolean(reservation.guest?.blacklisted),
      reservations: [],
    }
    current.reservations = [...(current.reservations || []), reservation]
    guests.set(id, current)
  }
  return Array.from(guests.values())
}

function generateGuestData(dateRange: DateRange, guests: ReportGuest[], reservations: ReportReservation[]): GuestReport {
  const reportGuests = guests.length ? guests : guestsFromReservations(reservations)
  const scopedReservations = reservationsInRange(reservations, dateRange)
  const scopedGuestIds = new Set(scopedReservations.map((reservation) => reservation.guestId).filter(Boolean))
  const guestsInScope = reportGuests.filter((guest) => scopedGuestIds.size === 0 || scopedGuestIds.has(guest.id))
  const nationalityBuckets = new Map<string, { guestCount: number; reservations: number }>()

  for (const guest of guestsInScope) {
    const nationality = guest.nationality || 'Not recorded'
    const current = nationalityBuckets.get(nationality) || { guestCount: 0, reservations: 0 }
    current.guestCount += 1
    current.reservations += scopedReservations.filter((reservation) => reservation.guestId === guest.id).length
    nationalityBuckets.set(nationality, current)
  }

  const nationalityBreakdown: NationalityBreakdown[] = Array.from(nationalityBuckets.entries())
    .map(([nationality, bucket]) => ({
      nationality,
      guestCount: bucket.guestCount,
      reservations: bucket.reservations,
      percentage: safeDivide(bucket.guestCount, guestsInScope.length) * 100,
    }))
    .sort((a, b) => b.guestCount - a.guestCount)

  const reservationsByGuest = new Map<string, ReportReservation[]>()
  for (const reservation of reservations) {
    const guestId = reservation.guestId || reservation.guest?.firstName || reservation.id
    reservationsByGuest.set(guestId, [...(reservationsByGuest.get(guestId) || []), reservation])
  }

  const repeatGuests: RepeatGuestStat[] = Array.from(reservationsByGuest.entries())
    .filter(([, guestReservations]) => guestReservations.length > 1)
    .map(([guestId, guestReservations]) => {
      const guest = reportGuests.find((item) => item.id === guestId)
      const sortedReservations = [...guestReservations].sort((a, b) => dateKey(b.checkOut).localeCompare(dateKey(a.checkOut)))
      return {
        guestId,
        guestName: guest ? guestName(guest) : guestNameFromReservation(guestReservations[0]),
        totalStays: guestReservations.length,
        totalNights: guestReservations.reduce((sum, reservation) => sum + reservationNights(reservation), 0),
        totalRevenue: roundMoney(guestReservations.reduce((sum, reservation) => sum + reservationTotal(reservation), 0)),
        lastStayDate: toDate(sortedReservations[0]?.checkOut) || normalizeRange(dateRange).to,
      }
    })
    .sort((a, b) => b.totalStays - a.totalStays)

  return {
    period: periodForRange(dateRange),
    summary: {
      totalUniqueGuests: guestsInScope.length,
      newGuests: guestsInScope.filter((guest) => (reservationsByGuest.get(guest.id) || []).length <= 1).length,
      returningGuests: guestsInScope.filter((guest) => (reservationsByGuest.get(guest.id) || []).length > 1).length,
      repeatGuestRate: safeDivide(guestsInScope.filter((guest) => (reservationsByGuest.get(guest.id) || []).length > 1).length, guestsInScope.length),
      vipGuests: guestsInScope.filter((guest) => guest.vipStatus).length,
      cautionFlagGuests: guestsInScope.filter((guest) => guest.blacklisted || guest.cautionFlag).length,
      avgGuestsPerReservation: safeDivide(
        scopedReservations.reduce((sum, reservation) => sum + Number(reservation.adults || 0) + Number(reservation.children || 0), 0),
        scopedReservations.length,
      ),
    },
    nationalityBreakdown,
    repeatGuests,
  }
}

function attachLocalFolios(reservations: ReportReservation[], folios: ReportFolio[]): ReportReservation[] {
  const foliosByReservation = new Map(folios.map((folio) => [folio.reservationId, folio]))
  return reservations.map((reservation) => ({
    ...reservation,
    folio: reservation.folio || foliosByReservation.get(reservation.id) || null,
  }))
}

export function useReportsData(dateRange: DateRange) {
  const [authToken] = useKV<string | null>('auth:pms-token', null)
  const [localRooms] = useKV<ReportRoom[]>('pms-rooms', [])
  const [localReservations] = useKV<ReportReservation[]>('reservations', [])
  const [localGuests] = useKV<ReportGuest[]>('guests', [])
  const [localFolios] = useKV<ReportFolio[]>('folios', [])
  const [serverSnapshot, setServerSnapshot] = useState<ServerSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!SERVER_API_ENABLED || !authToken) {
      setServerSnapshot(null)
      setError(null)
      return
    }

    let cancelled = false
    Promise.all([
      pmsApi<{ ok: true; data: { rooms?: ReportRoom[]; reservations?: ReportReservation[] } }>('/api/front-desk/board', authToken),
      pmsApi<{ ok: true; data: ReportReservation[] }>('/api/reservations', authToken),
      pmsApi<{ ok: true; data: ReportGuest[] }>('/api/guests', authToken),
    ])
      .then(([boardPayload, reservationsPayload, guestsPayload]) => {
        if (cancelled) return
        setServerSnapshot({
          rooms: boardPayload.data.rooms || [],
          reservations: reservationsPayload.data || boardPayload.data.reservations || [],
          guests: guestsPayload.data || [],
        })
        setError(null)
      })
      .catch((requestError) => {
        if (cancelled) return
        setError(requestError instanceof Error ? requestError.message : 'Reports data could not be loaded.')
      })

    return () => {
      cancelled = true
    }
  }, [authToken])

  const rooms = serverSnapshot?.rooms || localRooms || []
  const reservations = serverSnapshot?.reservations || attachLocalFolios(localReservations || [], localFolios || [])
  const guests = serverSnapshot?.guests || localGuests || []

  const operationsData = useMemo(() => generateOperationsData(dateRange, rooms, reservations), [dateRange.from, dateRange.to, rooms, reservations])
  const revenueData = useMemo(() => generateRevenueData(dateRange, rooms, reservations), [dateRange.from, dateRange.to, rooms, reservations])
  const reservationData = useMemo(() => generateReservationData(dateRange, reservations), [dateRange.from, dateRange.to, reservations])
  const housekeepingData = useMemo(() => generateHousekeepingData(dateRange, rooms, reservations), [dateRange.from, dateRange.to, rooms, reservations])
  const channelData = useMemo(() => generateChannelData(dateRange, reservations), [dateRange.from, dateRange.to, reservations])
  const guestData = useMemo(() => generateGuestData(dateRange, guests, reservations), [dateRange.from, dateRange.to, guests, reservations])

  return {
    operationsData,
    revenueData,
    reservationData,
    housekeepingData,
    channelData,
    guestData,
    isLoading: SERVER_API_ENABLED && Boolean(authToken) && !serverSnapshot && !error,
    error,
  }
}
