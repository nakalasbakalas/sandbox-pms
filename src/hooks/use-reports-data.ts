import { useCallback, useEffect, useMemo, useState } from 'react'
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
  totalAmountSatang?: string | null
  depositAmountSatang?: string | null
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
  totalSatang?: string | null
  paidSatang?: string | null
  balanceSatang?: string | null
  charges?: Array<{ category?: string; date?: string; createdAt?: string; amount?: number; total?: number; amountSatang?: string | null; totalSatang?: string | null }>
  payments?: Array<{ amount?: number; amountSatang?: string | null; createdAt?: string; receivedAt?: string }>
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

function bahtFallbackSatang(value: unknown, label: string): bigint {
  const amount = Number(value)
  if (!Number.isFinite(amount)) throw new TypeError(`${label} is not valid money.`)
  return BigInt(Math.round((amount + Number.EPSILON) * 100))
}

function exactSatang(value: unknown, legacyValue: unknown, label: string): bigint {
  if (value !== null && value !== undefined && value !== '') {
    const text = String(value)
    if (!/^-?\d+$/.test(text)) throw new TypeError(`${label} exact satang is invalid.`)
    return BigInt(text)
  }
  if (SERVER_API_ENABLED) throw new TypeError(`${label} exact satang is required in server mode.`)
  return bahtFallbackSatang(legacyValue ?? 0, label)
}

function satangNumber(value: bigint): number {
  return Number(value) / 100
}

function exactRatio(numerator: bigint, denominator: bigint): number {
  return denominator > 0n ? Number(numerator) / Number(denominator) : 0
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

function reservationTotalSatang(reservation: ReportReservation): bigint {
  return exactSatang(
    reservation.totalAmountSatang ?? reservation.folio?.totalSatang,
    reservation.totalAmount ?? reservation.folio?.total ?? 0,
    `reservation ${reservation.id} total`,
  )
}

function reservationPaidSatang(reservation: ReportReservation): bigint {
  const payments = reservation.folio?.payments || []
  if (reservation.folio?.paidSatang !== null && reservation.folio?.paidSatang !== undefined) {
    return exactSatang(reservation.folio.paidSatang, reservation.folio.paid, `reservation ${reservation.id} paid`)
  }
  if (payments.length > 0) {
    return payments.reduce((sum, payment) => sum + exactSatang(payment.amountSatang, payment.amount, `reservation ${reservation.id} payment`), 0n)
  }
  return exactSatang(undefined, reservation.folio?.paid ?? 0, `reservation ${reservation.id} paid`)
}

function reservationBalanceSatang(reservation: ReportReservation): bigint {
  if (reservation.folio?.balanceSatang !== null && reservation.folio?.balanceSatang !== undefined) {
    return exactSatang(reservation.folio.balanceSatang, reservation.folio.balance, `reservation ${reservation.id} balance`)
  }
  const balance = reservationTotalSatang(reservation) - reservationPaidSatang(reservation)
  return balance > 0n ? balance : 0n
}

function reservationNightSatang(reservation: ReportReservation, day: Date): bigint {
  const nights = reservationNights(reservation)
  if (nights <= 0) return 0n
  const checkIn = toDate(reservation.checkIn)
  if (!checkIn) return 0n
  const index = Math.round((startOfLocalDay(day).getTime() - startOfLocalDay(checkIn).getTime()) / 86_400_000)
  const total = reservationTotalSatang(reservation)
  const divisor = BigInt(nights)
  const base = total / divisor
  const remainder = total % divisor
  return base + (remainder > 0n && BigInt(index) < remainder ? 1n : 0n)
}

function reservationDepositSatang(reservation: ReportReservation): bigint {
  return exactSatang(reservation.depositAmountSatang, reservation.depositAmount ?? 0, `reservation ${reservation.id} deposit`)
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

export function generateRevenueData(dateRange: DateRange, rooms: ReportRoom[], reservations: ReportReservation[]): RevenueReport {
  const days = daysForRange(dateRange)
  const roomCount = realRoomCount(rooms)
  const revenueReservations = reservations.filter((reservation) => SOLD_RESERVATION_STATUSES.has(reservationStatus(reservation)))

  const dailyStats: DailyRevenueStat[] = days.map((date) => {
    const reservationsForNight = revenueReservations.filter((reservation) => reservationCoversNight(reservation, date))
    const roomRevenueSatang = reservationsForNight.reduce((sum, reservation) => sum + reservationNightSatang(reservation, date), 0n)
    const extrasRevenueSatang = revenueReservations.reduce((sum, reservation) => {
      const charges = reservation.folio?.charges || []
      return sum + charges
        .filter((charge) => normalizeStatus(charge.category) !== 'ROOM' && dateKey(charge.date || charge.createdAt) === dateKey(date))
        .reduce((chargeSum, charge) => chargeSum + exactSatang(charge.totalSatang ?? charge.amountSatang, charge.total ?? charge.amount ?? 0, `reservation ${reservation.id} extra charge`), 0n)
    }, 0n)
    const roomsSold = reservationsForNight.length
    const totalRevenueSatang = roomRevenueSatang + extrasRevenueSatang
    const roomRevenue = satangNumber(roomRevenueSatang)

    return {
      date,
      roomRevenueSatang: roomRevenueSatang.toString(),
      extrasRevenueSatang: extrasRevenueSatang.toString(),
      totalRevenueSatang: totalRevenueSatang.toString(),
      roomRevenue,
      extrasRevenue: satangNumber(extrasRevenueSatang),
      totalRevenue: satangNumber(totalRevenueSatang),
      roomsSold,
      roomsAvailable: roomCount,
      adr: roundMoney(safeDivide(roomRevenue, roomsSold)),
      revpar: roundMoney(safeDivide(roomRevenue, roomCount)),
      occupancyRate: safeDivide(roomsSold, roomCount),
    }
  })

  const totalRevenueSatang = dailyStats.reduce((sum, stat) => sum + BigInt(stat.totalRevenueSatang), 0n)
  const roomRevenueSatang = dailyStats.reduce((sum, stat) => sum + BigInt(stat.roomRevenueSatang), 0n)
  const extrasRevenueSatang = dailyStats.reduce((sum, stat) => sum + BigInt(stat.extrasRevenueSatang), 0n)
  const totalRevenue = satangNumber(totalRevenueSatang)
  const roomRevenue = satangNumber(roomRevenueSatang)
  const extrasRevenue = satangNumber(extrasRevenueSatang)
  const totalRoomNights = dailyStats.reduce((sum, stat) => sum + stat.roomsSold, 0)
  const avgOccupancy = safeDivide(dailyStats.reduce((sum, stat) => sum + stat.occupancyRate, 0), dailyStats.length)

  const roomTypeBuckets = new Map<string, { roomTypeName: string; roomsSold: number; revenueSatang: bigint }>()
  const channelBuckets = new Map<string, { reservations: number; revenueSatang: bigint }>()

  for (const reservation of revenueReservations.filter((item) => reservationsInRange([item], dateRange).length > 0)) {
    const nights = reservationNights(reservation)
    const totalSatang = reservationTotalSatang(reservation)
    const roomTypeKey = roomTypeId(reservation)
    const roomTypeBucket = roomTypeBuckets.get(roomTypeKey) || { roomTypeName: roomTypeName(reservation), roomsSold: 0, revenueSatang: 0n }
    roomTypeBucket.roomsSold += nights
    roomTypeBucket.revenueSatang += totalSatang
    roomTypeBuckets.set(roomTypeKey, roomTypeBucket)

    const channel = sourceLabel(reservation.source)
    const channelBucket = channelBuckets.get(channel) || { reservations: 0, revenueSatang: 0n }
    channelBucket.reservations += 1
    channelBucket.revenueSatang += totalSatang
    channelBuckets.set(channel, channelBucket)
  }

  return {
    period: periodForRange(dateRange),
    dailyStats,
    summary: {
      totalRevenueSatang: totalRevenueSatang.toString(),
      roomRevenueSatang: roomRevenueSatang.toString(),
      extrasRevenueSatang: extrasRevenueSatang.toString(),
      totalRevenue,
      roomRevenue,
      extrasRevenue,
      avgADR: roundMoney(safeDivide(roomRevenue, totalRoomNights)),
      avgRevPAR: roundMoney(safeDivide(totalRevenue, days.length * roomCount)),
      avgOccupancy,
      totalRoomNights,
      outstandingBalanceSatang: revenueReservations.reduce((sum, reservation) => sum + reservationBalanceSatang(reservation), 0n).toString(),
      depositsCollectedSatang: revenueReservations.reduce((sum, reservation) => sum + (reservation.depositPaid ? reservationDepositSatang(reservation) : 0n), 0n).toString(),
      depositsPendingSatang: revenueReservations.reduce((sum, reservation) => sum + (!reservation.depositPaid ? reservationDepositSatang(reservation) : 0n), 0n).toString(),
      refundsIssuedSatang: (-revenueReservations.reduce((sum, reservation) => {
        const payments = reservation.folio?.payments || []
        return sum + payments.map((payment) => exactSatang(payment.amountSatang, payment.amount, `reservation ${reservation.id} payment`)).filter((amount) => amount < 0n).reduce((paymentSum, amount) => paymentSum + amount, 0n)
      }, 0n)).toString(),
      outstandingBalance: satangNumber(revenueReservations.reduce((sum, reservation) => sum + reservationBalanceSatang(reservation), 0n)),
      depositsCollected: satangNumber(revenueReservations.reduce((sum, reservation) => sum + (reservation.depositPaid ? reservationDepositSatang(reservation) : 0n), 0n)),
      depositsPending: satangNumber(revenueReservations.reduce((sum, reservation) => sum + (!reservation.depositPaid ? reservationDepositSatang(reservation) : 0n), 0n)),
      refundsIssued: satangNumber(-revenueReservations.reduce((sum, reservation) => {
        const payments = reservation.folio?.payments || []
        return sum + payments.map((payment) => exactSatang(payment.amountSatang, payment.amount, `reservation ${reservation.id} payment`)).filter((amount) => amount < 0n).reduce((paymentSum, amount) => paymentSum + amount, 0n)
      }, 0n)),
    },
    byRoomType: Array.from(roomTypeBuckets.entries()).map(([id, bucket]) => ({
      roomTypeId: id,
      roomTypeName: bucket.roomTypeName,
      roomsSold: bucket.roomsSold,
      revenueSatang: bucket.revenueSatang.toString(),
      revenue: satangNumber(bucket.revenueSatang),
      adr: roundMoney(safeDivide(satangNumber(bucket.revenueSatang), bucket.roomsSold)),
      occupancyRate: safeDivide(bucket.roomsSold, days.length * Math.max(1, rooms.filter((room) => room.roomType?.id === id || room.roomType?.code === id).length || 1)),
    })),
    byChannel: Array.from(channelBuckets.entries()).map(([channel, bucket]) => ({
      channel,
      reservations: bucket.reservations,
      revenueSatang: bucket.revenueSatang.toString(),
      revenue: satangNumber(bucket.revenueSatang),
      adr: roundMoney(safeDivide(satangNumber(bucket.revenueSatang), bucket.reservations)),
      percentage: exactRatio(bucket.revenueSatang, totalRevenueSatang) * 100,
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
    const totalValueSatang = reservationsBooked.reduce((sum, reservation) => sum + reservationTotalSatang(reservation), 0n)
    return {
      bookingDate: date,
      reservationsBooked: reservationsBooked.length,
      roomNightsBooked: reservationsBooked.reduce((sum, reservation) => sum + reservationNights(reservation), 0),
      totalValue: satangNumber(totalValueSatang),
      totalValueSatang: totalValueSatang.toString(),
    }
  })

  const sourceBuckets = new Map<string, { reservations: number; roomNights: number; revenueSatang: bigint; cancellations: number }>()
  for (const reservation of reservationsInRange(reservations, dateRange)) {
    const source = sourceLabel(reservation.source)
    const bucket = sourceBuckets.get(source) || { reservations: 0, roomNights: 0, revenueSatang: 0n, cancellations: 0 }
    bucket.reservations += 1
    bucket.roomNights += reservationNights(reservation)
    bucket.revenueSatang += reservationTotalSatang(reservation)
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
      revenue: satangNumber(bucket.revenueSatang),
      revenueSatang: bucket.revenueSatang.toString(),
      adr: roundMoney(safeDivide(satangNumber(bucket.revenueSatang), bucket.roomNights)),
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
  const channelBuckets = new Map<string, Omit<ChannelPerformance, 'revenue' | 'revenueSatang' | 'adr'> & { revenueSatangValue: bigint }>()

  for (const reservation of scopedReservations) {
    const channel = sourceLabel(reservation.source)
    const current = channelBuckets.get(channel) || {
      channel,
      reservations: 0,
      roomNights: 0,
      revenueSatangValue: 0n,
      cancellations: 0,
      modifications: 0,
      avgLeadTime: 0,
    }
    current.reservations += 1
    current.roomNights += reservationNights(reservation)
    current.revenueSatangValue += reservationTotalSatang(reservation)
    channelBuckets.set(channel, current)
  }

  const byChannel = Array.from(channelBuckets.values()).map((channel) => ({
    ...channel,
    revenueSatang: channel.revenueSatangValue.toString(),
    revenue: satangNumber(channel.revenueSatangValue),
    adr: roundMoney(safeDivide(satangNumber(channel.revenueSatangValue), channel.roomNights)),
  }))
  const totalChannelRevenueSatang = byChannel.reduce((sum, channel) => sum + BigInt(channel.revenueSatang), 0n)
  const directRevenueSatang = BigInt(byChannel.find((channel) => channel.channel === 'Direct')?.revenueSatang || '0')
  const totalChannelRevenue = satangNumber(totalChannelRevenueSatang)
  const directRevenue = satangNumber(directRevenueSatang)
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
  const mostPerforming = byChannel.reduce<(typeof byChannel)[number] | null>((best, channel) => {
    if (!best || channel.revenue > best.revenue) return channel
    return best
  }, null)

  return {
    period: periodForRange(dateRange),
    byChannel,
    syncHealth,
    summary: {
      totalChannelReservations: byChannel.reduce((sum, channel) => sum + channel.reservations, 0),
      totalChannelRevenue,
      totalChannelRevenueSatang: totalChannelRevenueSatang.toString(),
      directBookingPercentage: exactRatio(directRevenueSatang, totalChannelRevenueSatang) * 100,
      otaBookingPercentage: exactRatio(totalChannelRevenueSatang - directRevenueSatang, totalChannelRevenueSatang) * 100,
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
      const totalRevenueSatang = guestReservations.reduce((sum, reservation) => sum + reservationTotalSatang(reservation), 0n)
      return {
        guestId,
        guestName: guest ? guestName(guest) : guestNameFromReservation(guestReservations[0]),
        totalStays: guestReservations.length,
        totalNights: guestReservations.reduce((sum, reservation) => sum + reservationNights(reservation), 0),
        totalRevenue: satangNumber(totalRevenueSatang),
        totalRevenueSatang: totalRevenueSatang.toString(),
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
  const authToken = null
  const [localRooms] = useKV<ReportRoom[]>('pms-rooms', [])
  const [localReservations] = useKV<ReportReservation[]>('reservations', [])
  const [localGuests] = useKV<ReportGuest[]>('guests', [])
  const [localFolios] = useKV<ReportFolio[]>('folios', [])
  const [serverSnapshot, setServerSnapshot] = useState<ServerSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  const refresh = useCallback(() => {
    if (!SERVER_API_ENABLED) return
    setServerSnapshot(null)
    setError(null)
    setRefreshToken((current) => current + 1)
  }, [])

  useEffect(() => {
    if (!SERVER_API_ENABLED) {
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
  }, [refreshToken])

  // In server mode, browser KV is demo-only data and must never become a
  // fallback for operational reports when the authoritative request fails.
  const rooms = SERVER_API_ENABLED ? serverSnapshot?.rooms ?? [] : localRooms || []
  const reservations = SERVER_API_ENABLED
    ? serverSnapshot?.reservations ?? []
    : attachLocalFolios(localReservations || [], localFolios || [])
  const guests = SERVER_API_ENABLED ? serverSnapshot?.guests ?? [] : localGuests || []
  const isLoading = SERVER_API_ENABLED && !serverSnapshot && !error
  const isUnavailable = SERVER_API_ENABLED && !serverSnapshot && Boolean(error)

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
    isLoading,
    isUnavailable,
    isDemoMode: !SERVER_API_ENABLED,
    error,
    refresh,
  }
}
