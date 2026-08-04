import { differenceInCalendarDays, parseISO, startOfDay } from 'date-fns'
import type { Density } from '@/hooks/use-density'
import type { BookingBoardRangeDays } from '@/types/server-booking-board'

export interface BookingBoardLayout {
  roomColumnWidth: number
  dayWidth: number
  rowMinHeight: number
  rowBaseHeight: number
  reservationHeight: number
  reservationInset: number
  laneStep: number
}

export interface BookingBoardStayGeometry {
  leftUnits: number
  rightUnits: number
}

export function getBookingBoardLayout(
  days: BookingBoardRangeDays,
  density: Density,
): BookingBoardLayout {
  if (density === 'compact') {
    return {
      roomColumnWidth: 136,
      dayWidth: days === 30 ? 58 : days === 14 ? 68 : 88,
      rowMinHeight: days === 30 ? 24 : days === 14 ? 26 : 28,
      rowBaseHeight: 2,
      reservationHeight: 20,
      reservationInset: 3,
      laneStep: 24,
    }
  }

  return {
    roomColumnWidth: 176,
    dayWidth: days === 30 ? 56 : days === 14 ? 76 : 96,
    rowMinHeight: 54,
    rowBaseHeight: 12,
    reservationHeight: 28,
    reservationInset: 6,
    laneStep: 34,
  }
}

export function getBookingBoardStayGeometry(
  checkInValue: string,
  checkOutValue: string,
  rangeStart: Date,
  days: number,
): BookingBoardStayGeometry | null {
  const checkIn = startOfDay(parseISO(checkInValue))
  const checkOut = startOfDay(parseISO(checkOutValue))
  const normalizedRangeStart = startOfDay(rangeStart)
  const rawStart = differenceInCalendarDays(checkIn, normalizedRangeStart)
  const rawEnd = differenceInCalendarDays(checkOut, normalizedRangeStart)

  // A departure on the first visible day still owns the first half of that day.
  if (rawStart >= days || rawEnd < 0) return null

  const leftUnits = Math.max(0, rawStart + 0.5)
  const rightUnits = Math.min(days, rawEnd + 0.5)

  if (rightUnits <= leftUnits) return null
  return { leftUnits, rightUnits }
}
