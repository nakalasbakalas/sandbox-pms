import type { ArrivalItem, DepartureItem, FrontDeskStats } from '@/types/front-desk'
import { SANDBOX_HOTEL_RULES } from '@/lib/hotel/business-rules'

export function calculateFrontDeskStats(arrivals: ArrivalItem[], departures: DepartureItem[]): FrontDeskStats {
  const arrivalsToday = arrivals.length
  const arrivalsCheckedIn = arrivals.filter(a => a.status === 'CHECKED_IN').length
  const arrivalsRemaining = arrivals.filter(a => a.status === 'DUE_IN' || a.status === 'READY').length
  
  const departuresToday = departures.length
  const departuresCheckedOut = departures.filter(d => d.status === 'CHECKED_OUT').length
  const departuresRemaining = departures.filter(d => d.status === 'IN_HOUSE' || d.status === 'LATE_CHECKOUT').length
  
  const inHouse = departures.filter(d => d.status === 'IN_HOUSE').length + arrivalsCheckedIn
  const lateCheckouts = departures.filter(d => d.status === 'LATE_CHECKOUT').length
  const noShows = arrivals.filter(a => a.status === 'NO_SHOW').length
  
  const pendingDeposits = arrivals.filter(a => !a.depositPaid && a.status !== 'CHECKED_IN' && a.status !== 'NO_SHOW').length
  const outstandingBalance = departures
    .filter(d => d.status !== 'CHECKED_OUT')
    .reduce((sum, d) => sum + d.balanceDue, 0)
  
  return {
    arrivalsToday,
    arrivalsCheckedIn,
    arrivalsRemaining,
    departuresToday,
    departuresCheckedOut,
    departuresRemaining,
    inHouse,
    walkIns: 0,
    noShows,
    lateCheckouts,
    earlyCheckIns: 0,
    pendingDeposits,
    outstandingBalance,
  }
}

export function getAvailableRoomsForWalkIn(roomType: 'TWIN' | 'DOUBLE'): Array<{ id: string; number: string }> {
  const roomNumbers = roomType === 'TWIN'
    ? SANDBOX_HOTEL_RULES.twinRooms
    : SANDBOX_HOTEL_RULES.doubleRooms

  return roomNumbers.map((number) => ({ id: `room-${number}`, number }))
}
