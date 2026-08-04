import assert from 'node:assert/strict'
import { parseISO } from 'date-fns'
import {
  getBookingBoardLayout,
  getBookingBoardStayGeometry,
} from '../src/lib/booking-board-layout'

const rangeStart = parseISO('2026-08-03')

assert.deepEqual(
  getBookingBoardStayGeometry('2026-08-03', '2026-08-05', rangeStart, 14),
  { leftUnits: 0.5, rightUnits: 2.5 },
  'a visible stay runs from the middle of check-in to the middle of check-out',
)

assert.deepEqual(
  getBookingBoardStayGeometry('2026-08-01', '2026-08-03', rangeStart, 14),
  { leftUnits: 0, rightUnits: 0.5 },
  'a stay checking out on the first visible date retains its final half-day',
)

assert.deepEqual(
  getBookingBoardStayGeometry('2026-08-15', '2026-08-20', rangeStart, 14),
  { leftUnits: 12.5, rightUnits: 14 },
  'a stay extending beyond the visible range is clipped at the board edge',
)

assert.equal(
  getBookingBoardStayGeometry('2026-08-01', '2026-08-02', rangeStart, 14),
  null,
  'a stay ending before the visible range is omitted',
)

const departingStay = getBookingBoardStayGeometry('2026-08-03', '2026-08-05', rangeStart, 14)
const arrivingStay = getBookingBoardStayGeometry('2026-08-05', '2026-08-07', rangeStart, 14)
assert.equal(
  departingStay?.rightUnits,
  arrivingStay?.leftUnits,
  'same-day departure and arrival meet at the shared date midpoint',
)

assert.deepEqual(
  getBookingBoardLayout(14, 'compact'),
  {
    roomColumnWidth: 136,
    dayWidth: 68,
    rowMinHeight: 26,
    rowBaseHeight: 2,
    reservationHeight: 20,
    reservationInset: 3,
    laneStep: 24,
  },
  'compact mode restores the proven 14-day board density',
)

assert.deepEqual(
  getBookingBoardLayout(14, 'comfortable'),
  {
    roomColumnWidth: 176,
    dayWidth: 76,
    rowMinHeight: 54,
    rowBaseHeight: 12,
    reservationHeight: 28,
    reservationInset: 6,
    laneStep: 34,
  },
  'comfortable mode retains the existing spacious board geometry',
)

console.log('Booking board layout tests passed.')
