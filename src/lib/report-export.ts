import { format } from 'date-fns'
import type {
  OperationsReport,
  RevenueReport,
  ReservationReport,
  HousekeepingReport,
  ChannelReport,
  GuestReport
} from '@/types/reports'

function downloadCSV(filename: string, csvContent: string) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  
  link.setAttribute('href', url)
  link.setAttribute('download', filename)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function escapeCSV(value: string | number | Date | undefined | null): string {
  if (value === undefined || value === null) return ''
  
  let stringValue: string
  if (value instanceof Date) {
    stringValue = format(value, 'yyyy-MM-dd')
  } else {
    stringValue = String(value)
  }
  
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  return stringValue
}

export function exportOperationsReportCSV(report: OperationsReport) {
  const headers = [
    'Date',
    'Day',
    'Arrivals',
    'Departures',
    'In-House',
    'Occupancy Rate',
    'Available Rooms',
    'Rooms Occupied',
    'Rooms Dirty',
    'Rooms Clean',
    'Rooms Inspected',
    'Rooms Maintenance',
    'Rooms Blocked',
    'Turnover Count'
  ]
  
  const rows = report.dailyStats.map(stat => [
    format(stat.date, 'yyyy-MM-dd'),
    format(stat.date, 'EEEE'),
    stat.arrivals,
    stat.departures,
    stat.inHouse,
    (stat.occupancyRate * 100).toFixed(1) + '%',
    stat.availableRooms,
    stat.roomsOccupied,
    stat.roomsDirty,
    stat.roomsClean,
    stat.roomsInspected,
    stat.roomsMaintenance,
    stat.roomsBlocked,
    stat.turnoverCount
  ])
  
  const summaryRows = [
    [],
    ['Summary'],
    ['Total Arrivals', report.summary.totalArrivals],
    ['Total Departures', report.summary.totalDepartures],
    ['Average Occupancy Rate', (report.summary.avgOccupancyRate * 100).toFixed(1) + '%'],
    ['Peak Occupancy Date', format(report.summary.peakOccupancyDate, 'yyyy-MM-dd')],
    ['Peak Occupancy Rate', (report.summary.peakOccupancyRate * 100).toFixed(1) + '%'],
    ['Lowest Occupancy Date', format(report.summary.lowestOccupancyDate, 'yyyy-MM-dd')],
    ['Lowest Occupancy Rate', (report.summary.lowestOccupancyRate * 100).toFixed(1) + '%'],
    ['Total No-Shows', report.summary.totalNoShows],
    ['Total Cancellations', report.summary.totalCancellations],
    ['Cancellation Rate', (report.summary.cancellationRate * 100).toFixed(1) + '%']
  ]
  
  const csv = [
    headers.map(escapeCSV).join(','),
    ...rows.map(row => row.map(escapeCSV).join(',')),
    ...summaryRows.map(row => row.map(escapeCSV).join(','))
  ].join('\n')
  
  const filename = `operations-report-${format(report.period.start, 'yyyy-MM-dd')}-to-${format(report.period.end, 'yyyy-MM-dd')}.csv`
  downloadCSV(filename, csv)
}

export function exportRevenueReportCSV(report: RevenueReport) {
  const headers = [
    'Date',
    'Day',
    'Room Revenue',
    'Extras Revenue',
    'Total Revenue',
    'Rooms Sold',
    'Rooms Available',
    'ADR',
    'RevPAR',
    'Occupancy Rate'
  ]
  
  const rows = report.dailyStats.map(stat => [
    format(stat.date, 'yyyy-MM-dd'),
    format(stat.date, 'EEEE'),
    stat.roomRevenue.toFixed(2),
    stat.extrasRevenue.toFixed(2),
    stat.totalRevenue.toFixed(2),
    stat.roomsSold,
    stat.roomsAvailable,
    stat.adr.toFixed(2),
    stat.revpar.toFixed(2),
    (stat.occupancyRate * 100).toFixed(1) + '%'
  ])
  
  const summaryRows = [
    [],
    ['Summary'],
    ['Total Revenue', report.summary.totalRevenue.toFixed(2)],
    ['Room Revenue', report.summary.roomRevenue.toFixed(2)],
    ['Extras Revenue', report.summary.extrasRevenue.toFixed(2)],
    ['Average ADR', report.summary.avgADR.toFixed(2)],
    ['Average RevPAR', report.summary.avgRevPAR.toFixed(2)],
    ['Average Occupancy', (report.summary.avgOccupancy * 100).toFixed(1) + '%'],
    ['Total Room Nights', report.summary.totalRoomNights],
    ['Outstanding Balance', report.summary.outstandingBalance.toFixed(2)],
    ['Deposits Collected', report.summary.depositsCollected.toFixed(2)],
    ['Deposits Pending', report.summary.depositsPending.toFixed(2)],
    ['Refunds Issued', report.summary.refundsIssued.toFixed(2)]
  ]
  
  const csv = [
    headers.map(escapeCSV).join(','),
    ...rows.map(row => row.map(escapeCSV).join(',')),
    ...summaryRows.map(row => row.map(escapeCSV).join(','))
  ].join('\n')
  
  const filename = `revenue-report-${format(report.period.start, 'yyyy-MM-dd')}-to-${format(report.period.end, 'yyyy-MM-dd')}.csv`
  downloadCSV(filename, csv)
}

export function exportReservationReportCSV(report: ReservationReport) {
  const headers = [
    'Booking Date',
    'Reservations Booked',
    'Room Nights Booked',
    'Total Value'
  ]
  
  const rows = report.bookingPace.map(bp => [
    format(bp.bookingDate, 'yyyy-MM-dd'),
    bp.reservationsBooked,
    bp.roomNightsBooked,
    bp.totalValue.toFixed(2)
  ])
  
  const summaryRows = [
    [],
    ['Summary'],
    ['Total Reservations', report.summary.totalReservations],
    ['Total Room Nights', report.summary.totalRoomNights],
    ['Average Stay Length', report.summary.avgStayLength.toFixed(1)],
    ['Average Lead Time', report.summary.avgLeadTime.toFixed(1)],
    ['Total Cancellations', report.summary.totalCancellations],
    ['Cancellation Rate', (report.summary.cancellationRate * 100).toFixed(1) + '%'],
    ['Total Modifications', report.summary.totalModifications],
    ['Modification Rate', (report.summary.modificationRate * 100).toFixed(1) + '%'],
    ['Direct Booking Rate', (report.summary.directBookingRate * 100).toFixed(1) + '%']
  ]
  
  const csv = [
    headers.map(escapeCSV).join(','),
    ...rows.map(row => row.map(escapeCSV).join(',')),
    ...summaryRows.map(row => row.map(escapeCSV).join(','))
  ].join('\n')
  
  const filename = `reservation-report-${format(report.period.start, 'yyyy-MM-dd')}-to-${format(report.period.end, 'yyyy-MM-dd')}.csv`
  downloadCSV(filename, csv)
}

export function exportHousekeepingReportCSV(report: HousekeepingReport) {
  const headers = [
    'Date',
    'Day',
    'Checkouts',
    'Turnovers',
    'Cleaned Rooms',
    'Inspected Rooms',
    'Avg Clean Time (min)',
    'Same Day Turnovers',
    'Delayed Readiness'
  ]
  
  const rows = report.dailyStats.map(stat => [
    format(stat.date, 'yyyy-MM-dd'),
    format(stat.date, 'EEEE'),
    stat.checkouts,
    stat.turnovers,
    stat.cleanedRooms,
    stat.inspectedRooms,
    stat.avgCleanTime,
    stat.sameDayTurnovers,
    stat.delayedReadiness
  ])
  
  const summaryRows = [
    [],
    ['Summary'],
    ['Total Cleanings', report.summary.totalCleanings],
    ['Total Inspections', report.summary.totalInspections],
    ['Average Cleaning Time', report.summary.avgCleaningTime + ' min'],
    ['On-Time Readiness Rate', (report.summary.onTimeReadinessRate * 100).toFixed(1) + '%'],
    ['Maintenance Room Days', report.summary.maintenanceRoomDays],
    ['Blocked Room Days', report.summary.blockedRoomDays]
  ]
  
  const csv = [
    headers.map(escapeCSV).join(','),
    ...rows.map(row => row.map(escapeCSV).join(',')),
    ...summaryRows.map(row => row.map(escapeCSV).join(','))
  ].join('\n')
  
  const filename = `housekeeping-report-${format(report.period.start, 'yyyy-MM-dd')}-to-${format(report.period.end, 'yyyy-MM-dd')}.csv`
  downloadCSV(filename, csv)
}

export function exportChannelReportCSV(report: ChannelReport) {
  const headers = [
    'Channel',
    'Reservations',
    'Room Nights',
    'Revenue',
    'ADR',
    'Cancellations',
    'Modifications',
    'Avg Lead Time (days)'
  ]
  
  const rows = report.byChannel.map(ch => [
    ch.channel,
    ch.reservations,
    ch.roomNights,
    ch.revenue.toFixed(2),
    ch.adr.toFixed(2),
    ch.cancellations,
    ch.modifications,
    ch.avgLeadTime.toFixed(1)
  ])
  
  const summaryRows = [
    [],
    ['Summary'],
    ['Total Channel Reservations', report.summary.totalChannelReservations],
    ['Total Channel Revenue', report.summary.totalChannelRevenue.toFixed(2)],
    ['Direct Booking %', report.summary.directBookingPercentage.toFixed(1) + '%'],
    ['OTA Booking %', report.summary.otaBookingPercentage.toFixed(1) + '%'],
    ['Average Channel ADR', report.summary.avgChannelADR.toFixed(2)],
    ['Average Direct ADR', report.summary.avgDirectADR.toFixed(2)],
    ['Most Performing Channel', report.summary.mostPerformingChannel]
  ]
  
  const csv = [
    headers.map(escapeCSV).join(','),
    ...rows.map(row => row.map(escapeCSV).join(',')),
    ...summaryRows.map(row => row.map(escapeCSV).join(','))
  ].join('\n')
  
  const filename = `channel-report-${format(report.period.start, 'yyyy-MM-dd')}-to-${format(report.period.end, 'yyyy-MM-dd')}.csv`
  downloadCSV(filename, csv)
}

export function exportGuestReportCSV(report: GuestReport) {
  const headers = [
    'Nationality',
    'Guest Count',
    'Reservations',
    'Percentage'
  ]
  
  const rows = report.nationalityBreakdown.map(nat => [
    nat.nationality,
    nat.guestCount,
    nat.reservations,
    nat.percentage.toFixed(1) + '%'
  ])
  
  const summaryRows = [
    [],
    ['Summary'],
    ['Total Unique Guests', report.summary.totalUniqueGuests],
    ['New Guests', report.summary.newGuests],
    ['Returning Guests', report.summary.returningGuests],
    ['Repeat Guest Rate', (report.summary.repeatGuestRate * 100).toFixed(1) + '%'],
    ['VIP Guests', report.summary.vipGuests],
    ['Caution Flag Guests', report.summary.cautionFlagGuests],
    ['Avg Guests Per Reservation', report.summary.avgGuestsPerReservation.toFixed(1)]
  ]
  
  const csv = [
    headers.map(escapeCSV).join(','),
    ...rows.map(row => row.map(escapeCSV).join(',')),
    ...summaryRows.map(row => row.map(escapeCSV).join(','))
  ].join('\n')
  
  const filename = `guest-report-${format(report.period.start, 'yyyy-MM-dd')}-to-${format(report.period.end, 'yyyy-MM-dd')}.csv`
  downloadCSV(filename, csv)
}
