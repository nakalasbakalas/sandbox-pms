import type { ArrivalItem, DepartureItem, FrontDeskStats } from '@/types/front-desk'

export function generateMockArrivals(): ArrivalItem[] {
  return [
    {
      id: 'arr-1',
      reservationId: 'res-101',
      guestName: 'Sarah Johnson',
      roomNumber: '203',
      roomType: 'TWIN',
      checkInTime: '14:00',
      nights: 3,
      adults: 2,
      children: 0,
      status: 'READY',
      roomReady: true,
      depositPaid: true,
      documentVerified: true,
      phone: '+66 89 123 4567',
      email: 'sarah.j@email.com',
      source: 'Booking.com',
      estimatedArrival: '15:30',
      bookedRate: 1800,
      totalAmount: 5400,
    },
    {
      id: 'arr-2',
      reservationId: 'res-102',
      guestName: 'Michael Chen',
      roomType: 'DOUBLE',
      checkInTime: '14:00',
      nights: 2,
      adults: 2,
      children: 1,
      status: 'DUE_IN',
      roomReady: true,
      depositPaid: true,
      documentVerified: false,
      phone: '+66 92 456 7890',
      email: 'mchen@email.com',
      specialRequests: 'High floor, extra pillows',
      source: 'Direct',
      bookedRate: 2200,
      totalAmount: 4600,
    },
    {
      id: 'arr-3',
      reservationId: 'res-103',
      guestName: 'Emma Williams',
      roomNumber: '308',
      roomType: 'DOUBLE',
      checkInTime: '14:00',
      nights: 5,
      adults: 1,
      children: 0,
      status: 'READY',
      roomReady: true,
      depositPaid: false,
      documentVerified: true,
      phone: '+66 81 234 5678',
      email: 'e.williams@email.com',
      source: 'Agoda',
      estimatedArrival: '14:00',
      bookedRate: 2000,
      totalAmount: 10000,
    },
    {
      id: 'arr-4',
      reservationId: 'res-104',
      guestName: 'David Martinez',
      roomType: 'TWIN',
      checkInTime: '14:00',
      nights: 1,
      adults: 2,
      children: 0,
      status: 'DUE_IN',
      roomReady: false,
      depositPaid: true,
      documentVerified: false,
      phone: '+66 87 654 3210',
      source: 'Booking.com',
      bookedRate: 1600,
      totalAmount: 1600,
    },
    {
      id: 'arr-5',
      reservationId: 'res-105',
      guestName: 'Lisa Anderson',
      roomNumber: '212',
      roomType: 'TWIN',
      checkInTime: '14:00',
      nights: 4,
      adults: 2,
      children: 2,
      status: 'CHECKED_IN',
      roomReady: true,
      depositPaid: true,
      documentVerified: true,
      phone: '+66 93 111 2222',
      email: 'lisa.a@email.com',
      specialRequests: 'Crib needed',
      source: 'Direct',
      bookedRate: 2000,
      totalAmount: 8200,
    },
    {
      id: 'arr-6',
      reservationId: 'res-106',
      guestName: 'James Wilson',
      roomType: 'DOUBLE',
      checkInTime: '14:00',
      nights: 7,
      adults: 2,
      children: 0,
      status: 'DUE_IN',
      roomReady: true,
      depositPaid: true,
      documentVerified: true,
      phone: '+66 88 999 8888',
      email: 'jwilson@email.com',
      source: 'Expedia',
      estimatedArrival: '18:00',
      bookedRate: 2100,
      totalAmount: 14700,
    },
  ]
}

export function generateMockDepartures(): DepartureItem[] {
  return [
    {
      id: 'dep-1',
      reservationId: 'res-201',
      guestName: 'Robert Taylor',
      roomNumber: '204',
      roomType: 'TWIN',
      checkOutTime: '11:00',
      nights: 3,
      status: 'IN_HOUSE',
      balanceDue: 0,
      folioTotal: 5600,
      paymentStatus: 'PAID',
      roomStatus: 'DIRTY',
    },
    {
      id: 'dep-2',
      reservationId: 'res-202',
      guestName: 'Maria Garcia',
      roomNumber: '310',
      roomType: 'DOUBLE',
      checkOutTime: '11:00',
      nights: 2,
      status: 'IN_HOUSE',
      balanceDue: 4800,
      folioTotal: 4800,
      paymentStatus: 'UNPAID',
      roomStatus: 'CLEAN',
    },
    {
      id: 'dep-3',
      reservationId: 'res-203',
      guestName: 'Thomas Brown',
      roomNumber: '207',
      roomType: 'TWIN',
      checkOutTime: '11:00',
      nights: 1,
      status: 'CHECKED_OUT',
      balanceDue: 0,
      folioTotal: 1800,
      paymentStatus: 'PAID',
      roomStatus: 'DIRTY',
    },
    {
      id: 'dep-4',
      reservationId: 'res-204',
      guestName: 'Jennifer Lee',
      roomNumber: '305',
      roomType: 'DOUBLE',
      checkOutTime: '13:00',
      nights: 4,
      status: 'LATE_CHECKOUT',
      balanceDue: 500,
      folioTotal: 8900,
      paymentStatus: 'PARTIAL',
      roomStatus: 'CLEAN',
      lateCheckoutUntil: '13:00',
    },
    {
      id: 'dep-5',
      reservationId: 'res-205',
      guestName: 'Christopher White',
      roomNumber: '211',
      roomType: 'TWIN',
      checkOutTime: '11:00',
      nights: 2,
      status: 'IN_HOUSE',
      balanceDue: 800,
      folioTotal: 4200,
      paymentStatus: 'PARTIAL',
      roomStatus: 'DIRTY',
    },
  ]
}

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
  if (roomType === 'TWIN') {
    return [
      { id: 'room-201', number: '201' },
      { id: 'room-205', number: '205' },
      { id: 'room-209', number: '209' },
      { id: 'room-213', number: '213' },
    ]
  } else {
    return [
      { id: 'room-302', number: '302' },
      { id: 'room-304', number: '304' },
      { id: 'room-311', number: '311' },
      { id: 'room-314', number: '314' },
    ]
  }
}
