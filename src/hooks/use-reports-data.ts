import { useMemo } from 'react'
import { eachDayOfInterval, differenceInDays, format, subDays } from 'date-fns'
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
  RepeatGuestStat
} from '@/types/reports'

interface DateRange {
  from: Date
  to: Date
}

function generateMockOperationsData(dateRange: DateRange): OperationsReport {
  const days = eachDayOfInterval({ start: dateRange.from, end: dateRange.to })
  
  const dailyStats: DailyOperationsStat[] = days.map(date => {
    const dayOfWeek = date.getDay()
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
    const baseOccupancy = isWeekend ? 0.75 : 0.65
    const randomFactor = Math.random() * 0.2 - 0.1
    const occupancyRate = Math.max(0.3, Math.min(0.95, baseOccupancy + randomFactor))
    
    const totalRooms = 30
    const roomsOccupied = Math.round(totalRooms * occupancyRate)
    const availableRooms = totalRooms - roomsOccupied
    
    const arrivals = Math.floor(Math.random() * 8) + 2
    const departures = Math.floor(Math.random() * 8) + 2
    const inHouse = roomsOccupied
    const turnoverCount = Math.min(arrivals, departures, Math.floor(Math.random() * 5))
    
    return {
      date,
      arrivals,
      departures,
      inHouse,
      occupancyRate,
      availableRooms,
      roomsOccupied,
      roomsDirty: Math.floor(Math.random() * 5) + 1,
      roomsClean: Math.floor(Math.random() * 8) + 15,
      roomsInspected: Math.floor(Math.random() * 6) + 18,
      roomsMaintenance: Math.floor(Math.random() * 2),
      roomsBlocked: 2,
      turnoverCount,
    }
  })

  const totalArrivals = dailyStats.reduce((sum, s) => sum + s.arrivals, 0)
  const totalDepartures = dailyStats.reduce((sum, s) => sum + s.departures, 0)
  const avgOccupancyRate = dailyStats.reduce((sum, s) => sum + s.occupancyRate, 0) / dailyStats.length
  
  const peakDay = dailyStats.reduce((max, s) => s.occupancyRate > max.occupancyRate ? s : max)
  const lowestDay = dailyStats.reduce((min, s) => s.occupancyRate < min.occupancyRate ? s : min)

  return {
    period: { start: dateRange.from, end: dateRange.to },
    dailyStats,
    summary: {
      totalArrivals,
      totalDepartures,
      avgOccupancyRate,
      peakOccupancyDate: peakDay.date,
      peakOccupancyRate: peakDay.occupancyRate,
      lowestOccupancyDate: lowestDay.date,
      lowestOccupancyRate: lowestDay.occupancyRate,
      totalNoShows: Math.floor(totalArrivals * 0.02),
      totalCancellations: Math.floor(totalArrivals * 0.08),
      cancellationRate: 0.08,
    },
  }
}

function generateMockRevenueData(dateRange: DateRange): RevenueReport {
  const days = eachDayOfInterval({ start: dateRange.from, end: dateRange.to })
  
  const dailyStats: DailyRevenueStat[] = days.map(date => {
    const dayOfWeek = date.getDay()
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
    const baseOccupancy = isWeekend ? 0.75 : 0.65
    const occupancyRate = Math.max(0.3, Math.min(0.95, baseOccupancy + (Math.random() * 0.2 - 0.1)))
    
    const totalRooms = 30
    const roomsSold = Math.round(totalRooms * occupancyRate)
    const adr = Math.round(1800 + (Math.random() * 400))
    const roomRevenue = roomsSold * adr
    const extrasRevenue = Math.round(roomRevenue * (0.1 + Math.random() * 0.15))
    const revpar = Math.round((roomRevenue / totalRooms))
    
    return {
      date,
      roomRevenue,
      extrasRevenue,
      totalRevenue: roomRevenue + extrasRevenue,
      roomsSold,
      roomsAvailable: totalRooms,
      adr,
      revpar,
      occupancyRate,
    }
  })

  const totalRevenue = dailyStats.reduce((sum, s) => sum + s.totalRevenue, 0)
  const roomRevenue = dailyStats.reduce((sum, s) => sum + s.roomRevenue, 0)
  const extrasRevenue = dailyStats.reduce((sum, s) => sum + s.extrasRevenue, 0)
  const totalRoomNights = dailyStats.reduce((sum, s) => sum + s.roomsSold, 0)
  const avgADR = roomRevenue / totalRoomNights
  const avgRevPAR = totalRevenue / (dailyStats.length * 30)
  const avgOccupancy = dailyStats.reduce((sum, s) => sum + s.occupancyRate, 0) / dailyStats.length

  return {
    period: { start: dateRange.from, end: dateRange.to },
    dailyStats,
    summary: {
      totalRevenue,
      roomRevenue,
      extrasRevenue,
      avgADR,
      avgRevPAR,
      avgOccupancy,
      totalRoomNights,
      outstandingBalance: Math.round(totalRevenue * 0.05),
      depositsCollected: Math.round(totalRevenue * 0.25),
      depositsPending: Math.round(totalRevenue * 0.08),
      refundsIssued: Math.round(totalRevenue * 0.02),
    },
    byRoomType: [
      {
        roomTypeId: '1',
        roomTypeName: 'Twin Room',
        roomsSold: Math.floor(totalRoomNights * 0.5),
        revenue: Math.round(roomRevenue * 0.45),
        adr: 1750,
        occupancyRate: avgOccupancy * 0.95,
      },
      {
        roomTypeId: '2',
        roomTypeName: 'Double Room',
        roomsSold: Math.floor(totalRoomNights * 0.5),
        revenue: Math.round(roomRevenue * 0.55),
        adr: 2050,
        occupancyRate: avgOccupancy * 1.05,
      },
    ],
    byChannel: [
      {
        channel: 'Direct',
        reservations: Math.floor(totalRoomNights * 0.25 / 3),
        revenue: Math.round(totalRevenue * 0.25),
        adr: avgADR * 1.15,
        percentage: 25,
      },
      {
        channel: 'Booking.com',
        reservations: Math.floor(totalRoomNights * 0.35 / 3),
        revenue: Math.round(totalRevenue * 0.35),
        adr: avgADR * 0.95,
        percentage: 35,
      },
      {
        channel: 'Agoda',
        reservations: Math.floor(totalRoomNights * 0.25 / 3),
        revenue: Math.round(totalRevenue * 0.25),
        adr: avgADR * 0.92,
        percentage: 25,
      },
      {
        channel: 'Airbnb',
        reservations: Math.floor(totalRoomNights * 0.15 / 3),
        revenue: Math.round(totalRevenue * 0.15),
        adr: avgADR * 1.05,
        percentage: 15,
      },
    ],
  }
}

function generateMockReservationData(dateRange: DateRange): ReservationReport {
  const days = eachDayOfInterval({ start: dateRange.from, end: dateRange.to })
  
  const bookingPace: BookingPaceStat[] = days.map(date => ({
    bookingDate: date,
    reservationsBooked: Math.floor(Math.random() * 8) + 3,
    roomNightsBooked: Math.floor(Math.random() * 25) + 10,
    totalValue: Math.round((Math.random() * 40000) + 20000),
  }))

  const totalReservations = bookingPace.reduce((sum, bp) => sum + bp.reservationsBooked, 0)
  const totalRoomNights = bookingPace.reduce((sum, bp) => sum + bp.roomNightsBooked, 0)

  return {
    period: { start: dateRange.from, end: dateRange.to },
    bookingPace,
    leadTime: {
      sameDay: Math.floor(totalReservations * 0.05),
      days1to3: Math.floor(totalReservations * 0.12),
      days4to7: Math.floor(totalReservations * 0.18),
      days8to14: Math.floor(totalReservations * 0.22),
      days15to30: Math.floor(totalReservations * 0.25),
      days31to60: Math.floor(totalReservations * 0.12),
      days61to90: Math.floor(totalReservations * 0.04),
      over90Days: Math.floor(totalReservations * 0.02),
    },
    stayLength: {
      oneNight: Math.floor(totalReservations * 0.15),
      twoNights: Math.floor(totalReservations * 0.25),
      threeFourNights: Math.floor(totalReservations * 0.35),
      fiveSixNights: Math.floor(totalReservations * 0.15),
      oneWeek: Math.floor(totalReservations * 0.07),
      twoWeeks: Math.floor(totalReservations * 0.02),
      overTwoWeeks: Math.floor(totalReservations * 0.01),
    },
    sourceBreakdown: [
      {
        source: 'Direct',
        reservations: Math.floor(totalReservations * 0.25),
        roomNights: Math.floor(totalRoomNights * 0.25),
        revenue: 450000,
        adr: 1950,
        cancellations: Math.floor(totalReservations * 0.25 * 0.05),
        cancellationRate: 0.05,
      },
      {
        source: 'Booking.com',
        reservations: Math.floor(totalReservations * 0.35),
        roomNights: Math.floor(totalRoomNights * 0.35),
        revenue: 620000,
        adr: 1850,
        cancellations: Math.floor(totalReservations * 0.35 * 0.12),
        cancellationRate: 0.12,
      },
      {
        source: 'Agoda',
        reservations: Math.floor(totalReservations * 0.25),
        roomNights: Math.floor(totalRoomNights * 0.25),
        revenue: 440000,
        adr: 1800,
        cancellations: Math.floor(totalReservations * 0.25 * 0.10),
        cancellationRate: 0.10,
      },
      {
        source: 'Airbnb',
        reservations: Math.floor(totalReservations * 0.15),
        roomNights: Math.floor(totalRoomNights * 0.15),
        revenue: 280000,
        adr: 1900,
        cancellations: Math.floor(totalReservations * 0.15 * 0.08),
        cancellationRate: 0.08,
      },
    ],
    summary: {
      totalReservations,
      totalRoomNights,
      avgStayLength: totalRoomNights / totalReservations,
      avgLeadTime: 18.5,
      totalCancellations: Math.floor(totalReservations * 0.09),
      cancellationRate: 0.09,
      totalModifications: Math.floor(totalReservations * 0.15),
      modificationRate: 0.15,
      directBookingRate: 0.25,
    },
  }
}

function generateMockHousekeepingData(dateRange: DateRange): HousekeepingReport {
  const days = eachDayOfInterval({ start: dateRange.from, end: dateRange.to })
  
  const dailyStats: DailyHousekeepingStat[] = days.map(date => {
    const checkouts = Math.floor(Math.random() * 8) + 2
    const turnovers = Math.min(checkouts, Math.floor(Math.random() * 7) + 2)
    const sameDayTurnovers = Math.floor(turnovers * 0.7)
    
    return {
      date,
      checkouts,
      turnovers,
      cleanedRooms: Math.floor(Math.random() * 12) + 8,
      inspectedRooms: Math.floor(Math.random() * 10) + 6,
      avgCleanTime: Math.floor(Math.random() * 15) + 25,
      sameDayTurnovers,
      delayedReadiness: Math.floor(Math.random() * 3),
    }
  })

  const rooms = Array.from({ length: 30 }, (_, i) => {
    const floor = i < 15 ? 2 : 3
    const roomNum = i < 15 ? 201 + i : 301 + (i - 15)
    return {
      roomNumber: roomNum.toString(),
      cleanings: Math.floor(Math.random() * 15) + 10,
      avgCleanTime: Math.floor(Math.random() * 10) + 28,
      maintenanceDays: Math.floor(Math.random() * 3),
      blockedDays: roomNum === 216 || roomNum === 316 ? days.length : 0,
    }
  })

  return {
    period: { start: dateRange.from, end: dateRange.to },
    dailyStats,
    summary: {
      totalCleanings: dailyStats.reduce((sum, s) => sum + s.cleanedRooms, 0),
      totalInspections: dailyStats.reduce((sum, s) => sum + s.inspectedRooms, 0),
      avgCleaningTime: Math.round(dailyStats.reduce((sum, s) => sum + s.avgCleanTime, 0) / dailyStats.length),
      onTimeReadinessRate: 0.92,
      maintenanceRoomDays: rooms.reduce((sum, r) => sum + r.maintenanceDays, 0),
      blockedRoomDays: rooms.reduce((sum, r) => sum + r.blockedDays, 0),
    },
    byRoom: rooms,
  }
}

function generateMockChannelData(dateRange: DateRange): ChannelReport {
  const channels = ['Direct', 'Booking.com', 'Agoda', 'Airbnb']
  
  const byChannel: ChannelPerformance[] = channels.map(channel => ({
    channel,
    reservations: Math.floor(Math.random() * 80) + 40,
    roomNights: Math.floor(Math.random() * 250) + 150,
    revenue: Math.round((Math.random() * 400000) + 300000),
    adr: Math.round(1700 + Math.random() * 500),
    cancellations: Math.floor(Math.random() * 15) + 2,
    modifications: Math.floor(Math.random() * 20) + 5,
    avgLeadTime: Math.round(10 + Math.random() * 20),
  }))

  const syncHealth: ChannelSyncHealth[] = channels.map(channel => {
    const totalSyncs = Math.floor(Math.random() * 100) + 200
    const successRate = 0.88 + Math.random() * 0.11
    
    return {
      channel,
      lastSyncTime: subDays(new Date(), Math.floor(Math.random() * 2)),
      totalSyncs,
      successfulSyncs: Math.floor(totalSyncs * successRate),
      failedSyncs: Math.floor(totalSyncs * (1 - successRate)),
      successRate,
      conflicts: Math.floor(Math.random() * 3),
      unmappedRooms: Math.floor(Math.random() * 2),
    }
  })

  const totalChannelReservations = byChannel.reduce((sum, ch) => sum + ch.reservations, 0)
  const totalChannelRevenue = byChannel.reduce((sum, ch) => sum + ch.revenue, 0)
  const directChannel = byChannel.find(ch => ch.channel === 'Direct')
  const otaChannels = byChannel.filter(ch => ch.channel !== 'Direct')
  const otaRevenue = otaChannels.reduce((sum, ch) => sum + ch.revenue, 0)
  const mostPerforming = byChannel.reduce((max, ch) => ch.revenue > max.revenue ? ch : max)

  return {
    period: { start: dateRange.from, end: dateRange.to },
    byChannel,
    syncHealth,
    summary: {
      totalChannelReservations,
      totalChannelRevenue,
      directBookingPercentage: directChannel ? (directChannel.revenue / totalChannelRevenue) * 100 : 0,
      otaBookingPercentage: (otaRevenue / totalChannelRevenue) * 100,
      avgChannelADR: totalChannelRevenue / byChannel.reduce((sum, ch) => sum + ch.roomNights, 0),
      avgDirectADR: directChannel?.adr || 0,
      mostPerformingChannel: mostPerforming.channel,
    },
  }
}

function generateMockGuestData(dateRange: DateRange): GuestReport {
  const nationalities = [
    'Thailand', 'United States', 'United Kingdom', 'Australia', 'Germany',
    'France', 'Japan', 'China', 'Singapore', 'South Korea', 'Canada', 'Italy'
  ]

  const totalGuests = Math.floor(Math.random() * 200) + 300
  
  const nationalityBreakdown: NationalityBreakdown[] = nationalities.map(nat => {
    const guestCount = Math.floor(Math.random() * totalGuests * 0.2) + 10
    return {
      nationality: nat,
      guestCount,
      reservations: Math.floor(guestCount * 0.8),
      percentage: (guestCount / totalGuests) * 100,
    }
  }).sort((a, b) => b.guestCount - a.guestCount)

  const repeatGuests: RepeatGuestStat[] = Array.from({ length: 25 }, (_, i) => ({
    guestId: `guest-${i}`,
    guestName: `Guest ${i + 1}`,
    totalStays: Math.floor(Math.random() * 8) + 2,
    totalNights: Math.floor(Math.random() * 30) + 10,
    totalRevenue: Math.round((Math.random() * 80000) + 20000),
    lastStayDate: subDays(new Date(), Math.floor(Math.random() * 90)),
  })).sort((a, b) => b.totalStays - a.totalStays)

  const newGuests = Math.floor(totalGuests * 0.65)
  const returningGuests = totalGuests - newGuests

  return {
    period: { start: dateRange.from, end: dateRange.to },
    summary: {
      totalUniqueGuests: totalGuests,
      newGuests,
      returningGuests,
      repeatGuestRate: returningGuests / totalGuests,
      vipGuests: Math.floor(totalGuests * 0.08),
      cautionFlagGuests: Math.floor(totalGuests * 0.02),
      avgGuestsPerReservation: 2.1,
    },
    nationalityBreakdown,
    repeatGuests,
  }
}

export function useReportsData(dateRange: DateRange) {
  const operationsData = useMemo(() => generateMockOperationsData(dateRange), [dateRange.from, dateRange.to])
  const revenueData = useMemo(() => generateMockRevenueData(dateRange), [dateRange.from, dateRange.to])
  const reservationData = useMemo(() => generateMockReservationData(dateRange), [dateRange.from, dateRange.to])
  const housekeepingData = useMemo(() => generateMockHousekeepingData(dateRange), [dateRange.from, dateRange.to])
  const channelData = useMemo(() => generateMockChannelData(dateRange), [dateRange.from, dateRange.to])
  const guestData = useMemo(() => generateMockGuestData(dateRange), [dateRange.from, dateRange.to])

  return {
    operationsData,
    revenueData,
    reservationData,
    housekeepingData,
    channelData,
    guestData,
  }
}
