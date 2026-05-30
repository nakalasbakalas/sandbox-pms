export type ReportCategory = 
  | 'OPERATIONS' 
  | 'REVENUE' 
  | 'RESERVATIONS' 
  | 'HOUSEKEEPING' 
  | 'CHANNELS' 
  | 'GUESTS'

export type ReportPeriod = 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'CUSTOM'

export type ExportFormat = 'CSV' | 'PDF' | 'EXCEL'

export interface ReportFilters {
  startDate: Date
  endDate: Date
  roomTypeIds?: string[]
  roomNumbers?: string[]
  sources?: string[]
  statuses?: string[]
  channels?: string[]
}

export interface OperationsReport {
  period: {
    start: Date
    end: Date
  }
  dailyStats: DailyOperationsStat[]
  summary: OperationsSummary
}

export interface DailyOperationsStat {
  date: Date
  arrivals: number
  departures: number
  inHouse: number
  occupancyRate: number
  availableRooms: number
  roomsOccupied: number
  roomsDirty: number
  roomsClean: number
  roomsInspected: number
  roomsMaintenance: number
  roomsBlocked: number
  turnoverCount: number
}

export interface OperationsSummary {
  totalArrivals: number
  totalDepartures: number
  avgOccupancyRate: number
  peakOccupancyDate: Date
  peakOccupancyRate: number
  lowestOccupancyDate: Date
  lowestOccupancyRate: number
  totalNoShows: number
  totalCancellations: number
  cancellationRate: number
}

export interface RevenueReport {
  period: {
    start: Date
    end: Date
  }
  dailyStats: DailyRevenueStat[]
  summary: RevenueSummary
  byRoomType: RoomTypeRevenue[]
  byChannel: ChannelRevenue[]
}

export interface DailyRevenueStat {
  date: Date
  roomRevenue: number
  extrasRevenue: number
  totalRevenue: number
  roomsSold: number
  roomsAvailable: number
  adr: number
  revpar: number
  occupancyRate: number
}

export interface RevenueSummary {
  totalRevenue: number
  roomRevenue: number
  extrasRevenue: number
  avgADR: number
  avgRevPAR: number
  avgOccupancy: number
  totalRoomNights: number
  outstandingBalance: number
  depositsCollected: number
  depositsPending: number
  refundsIssued: number
}

export interface RoomTypeRevenue {
  roomTypeId: string
  roomTypeName: string
  roomsSold: number
  revenue: number
  adr: number
  occupancyRate: number
}

export interface ChannelRevenue {
  channel: string
  reservations: number
  revenue: number
  adr: number
  percentage: number
}

export interface ReservationReport {
  period: {
    start: Date
    end: Date
  }
  bookingPace: BookingPaceStat[]
  leadTime: LeadTimeDistribution
  stayLength: StayLengthDistribution
  sourceBreakdown: SourceBreakdown[]
  summary: ReservationSummary
}

export interface BookingPaceStat {
  bookingDate: Date
  reservationsBooked: number
  roomNightsBooked: number
  totalValue: number
}

export interface LeadTimeDistribution {
  sameDay: number
  days1to3: number
  days4to7: number
  days8to14: number
  days15to30: number
  days31to60: number
  days61to90: number
  over90Days: number
}

export interface StayLengthDistribution {
  oneNight: number
  twoNights: number
  threeFourNights: number
  fiveSixNights: number
  oneWeek: number
  twoWeeks: number
  overTwoWeeks: number
}

export interface SourceBreakdown {
  source: string
  reservations: number
  roomNights: number
  revenue: number
  adr: number
  cancellations: number
  cancellationRate: number
}

export interface ReservationSummary {
  totalReservations: number
  totalRoomNights: number
  avgStayLength: number
  avgLeadTime: number
  totalCancellations: number
  cancellationRate: number
  totalModifications: number
  modificationRate: number
  directBookingRate: number
}

export interface HousekeepingReport {
  period: {
    start: Date
    end: Date
  }
  dailyStats: DailyHousekeepingStat[]
  summary: HousekeepingSummary
  byRoom: RoomHousekeepingStat[]
}

export interface DailyHousekeepingStat {
  date: Date
  checkouts: number
  turnovers: number
  cleanedRooms: number
  inspectedRooms: number
  avgCleanTime: number
  sameDayTurnovers: number
  delayedReadiness: number
}

export interface HousekeepingSummary {
  totalCleanings: number
  totalInspections: number
  avgCleaningTime: number
  onTimeReadinessRate: number
  maintenanceRoomDays: number
  blockedRoomDays: number
}

export interface RoomHousekeepingStat {
  roomNumber: string
  cleanings: number
  avgCleanTime: number
  maintenanceDays: number
  blockedDays: number
}

export interface ChannelReport {
  period: {
    start: Date
    end: Date
  }
  byChannel: ChannelPerformance[]
  syncHealth: ChannelSyncHealth[]
  summary: ChannelSummary
}

export interface ChannelPerformance {
  channel: string
  reservations: number
  roomNights: number
  revenue: number
  adr: number
  cancellations: number
  modifications: number
  avgLeadTime: number
}

export interface ChannelSyncHealth {
  channel: string
  lastSyncTime: Date
  totalSyncs: number
  successfulSyncs: number
  failedSyncs: number
  successRate: number
  conflicts: number
  unmappedRooms: number
}

export interface ChannelSummary {
  totalChannelReservations: number
  totalChannelRevenue: number
  directBookingPercentage: number
  otaBookingPercentage: number
  avgChannelADR: number
  avgDirectADR: number
  mostPerformingChannel: string
}

export interface GuestReport {
  period: {
    start: Date
    end: Date
  }
  summary: GuestSummary
  nationalityBreakdown: NationalityBreakdown[]
  repeatGuests: RepeatGuestStat[]
}

export interface GuestSummary {
  totalUniqueGuests: number
  newGuests: number
  returningGuests: number
  repeatGuestRate: number
  vipGuests: number
  cautionFlagGuests: number
  avgGuestsPerReservation: number
}

export interface NationalityBreakdown {
  nationality: string
  guestCount: number
  reservations: number
  percentage: number
}

export interface RepeatGuestStat {
  guestId: string
  guestName: string
  totalStays: number
  totalNights: number
  totalRevenue: number
  lastStayDate: Date
}

export interface KPISnapshot {
  date: Date
  occupancyRate: number
  adr: number
  revpar: number
  totalRevenue: number
  roomsOccupied: number
  arrivals: number
  departures: number
  inHouse: number
}

export interface ReportPreset {
  id: string
  name: string
  category: ReportCategory
  filters: ReportFilters
  createdBy: string
  createdAt: Date
}
