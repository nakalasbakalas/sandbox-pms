import { format } from 'date-fns'
import type { HousekeepingRoom } from '@/types/housekeeping'
import type { Reservation } from '@/components/views/ReservationsView'

export function printHousekeepingReport(
  rooms: HousekeepingRoom[],
  title: string = 'Housekeeping Report',
  options: {
    groupByFloor?: boolean
    includeStatus?: boolean
    includeAssignments?: boolean
    staffAssignments?: Record<string, string>
    staff?: Array<{ id: string; name: string; color: string }>
  } = {}
) {
  const { groupByFloor = true, includeStatus = true, includeAssignments = true, staffAssignments = {}, staff = [] } = options

  const printWindow = window.open('', '_blank')
  if (!printWindow) return

  const groupedRooms: Record<string, HousekeepingRoom[]> = {}
  if (groupByFloor) {
    rooms.forEach(room => {
      const floor = `Floor ${room.floor}`
      if (!groupedRooms[floor]) groupedRooms[floor] = []
      groupedRooms[floor].push(room)
    })
  } else {
    groupedRooms['All Rooms'] = rooms
  }

  Object.keys(groupedRooms).forEach(key => {
    groupedRooms[key].sort((a, b) => a.number.localeCompare(b.number))
  })

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'CLEAN': return 'Clean'
      case 'DIRTY': return 'Dirty'
      case 'CLEANING': return 'Cleaning'
      case 'INSPECTED': return 'Inspected'
      default: return status
    }
  }

  const getStaffName = (roomId: string) => {
    const staffId = staffAssignments[roomId]
    if (!staffId) return 'Unassigned'
    const staffMember = staff.find(s => s.id === staffId)
    return staffMember ? staffMember.name : 'Unassigned'
  }

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${title}</title>
        <style>
          @media print {
            @page {
              margin: 1cm;
              size: A4;
            }
            
            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            
            .no-print {
              display: none !important;
            }
            
            .page-break {
              page-break-after: always;
            }
          }
          
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 11pt;
            line-height: 1.4;
            color: #1a1a1a;
            padding: 20px;
          }
          
          .header {
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 2px solid #2c2c54;
          }
          
          .header h1 {
            font-size: 24pt;
            font-weight: 700;
            color: #2c2c54;
            margin-bottom: 8px;
          }
          
          .header .meta {
            font-size: 10pt;
            color: #666;
          }
          
          .stats {
            display: flex;
            gap: 16px;
            margin-bottom: 24px;
            padding: 12px;
            background: #f5f5f5;
            border-radius: 6px;
          }
          
          .stat-item {
            flex: 1;
          }
          
          .stat-item .label {
            font-size: 9pt;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
          }
          
          .stat-item .value {
            font-size: 18pt;
            font-weight: 700;
            color: #2c2c54;
          }
          
          .section {
            margin-bottom: 32px;
          }
          
          .section-title {
            font-size: 14pt;
            font-weight: 600;
            color: #2c2c54;
            margin-bottom: 12px;
            padding-bottom: 6px;
            border-bottom: 1px solid #ddd;
          }
          
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 16px;
          }
          
          thead {
            background: #2c2c54;
            color: white;
          }
          
          th {
            text-align: left;
            padding: 8px 12px;
            font-size: 9pt;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          
          tbody tr {
            border-bottom: 1px solid #e5e5e5;
          }
          
          tbody tr:nth-child(even) {
            background: #fafafa;
          }
          
          tbody tr:hover {
            background: #f0f0f0;
          }
          
          td {
            padding: 8px 12px;
            font-size: 10pt;
          }
          
          .room-number {
            font-weight: 700;
            font-size: 11pt;
            color: #2c2c54;
          }
          
          .status-badge {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 8pt;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.3px;
          }
          
          .status-clean {
            background: #d4edda;
            color: #155724;
          }
          
          .status-dirty {
            background: #fff3cd;
            color: #856404;
          }
          
          .status-cleaning {
            background: #e7d6ff;
            color: #5b21b6;
          }
          
          .status-inspected {
            background: #cfe2ff;
            color: #084298;
          }
          
          .badge {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 8pt;
            font-weight: 500;
            margin-right: 4px;
          }
          
          .badge-arrival {
            background: #d4edda;
            color: #155724;
          }
          
          .badge-departure {
            background: #fff3cd;
            color: #856404;
          }
          
          .badge-maintenance {
            background: #f8d7da;
            color: #721c24;
          }
          
          .footer {
            margin-top: 32px;
            padding-top: 16px;
            border-top: 1px solid #ddd;
            text-align: center;
            font-size: 9pt;
            color: #666;
          }
          
          .print-button {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 24px;
            background: #2c2c54;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 11pt;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
          }
          
          .print-button:hover {
            background: #1f1f3a;
          }
        </style>
      </head>
      <body>
        <button class="print-button no-print" onclick="window.print()">🖨️ Print Report</button>
        
        <div class="header">
          <h1>${title}</h1>
          <div class="meta">
            Generated: ${format(new Date(), 'EEEE, MMMM d, yyyy • h:mm a')}
          </div>
        </div>
        
        <div class="stats">
          <div class="stat-item">
            <div class="label">Total Rooms</div>
            <div class="value">${rooms.length}</div>
          </div>
          <div class="stat-item">
            <div class="label">Clean</div>
            <div class="value">${rooms.filter(r => r.cleanStatus === 'CLEAN').length}</div>
          </div>
          <div class="stat-item">
            <div class="label">Dirty</div>
            <div class="value">${rooms.filter(r => r.cleanStatus === 'DIRTY').length}</div>
          </div>
          <div class="stat-item">
            <div class="label">Cleaning</div>
            <div class="value">${rooms.filter(r => r.cleanStatus === 'CLEANING').length}</div>
          </div>
          <div class="stat-item">
            <div class="label">Inspected</div>
            <div class="value">${rooms.filter(r => r.cleanStatus === 'INSPECTED').length}</div>
          </div>
        </div>
        
        ${Object.entries(groupedRooms).map(([groupName, groupRooms]) => `
          <div class="section">
            <h2 class="section-title">${groupName} (${groupRooms.length} rooms)</h2>
            <table>
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Type</th>
                  ${includeStatus ? '<th>Status</th>' : ''}
                  ${includeAssignments ? '<th>Assigned To</th>' : ''}
                  <th>Guest</th>
                  <th>Details</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                ${groupRooms.map(room => `
                  <tr>
                    <td class="room-number">${room.number}</td>
                    <td>${room.type}</td>
                    ${includeStatus ? `<td><span class="status-badge status-${room.cleanStatus.toLowerCase()}">${getStatusLabel(room.cleanStatus)}</span></td>` : ''}
                    ${includeAssignments ? `<td>${getStaffName(room.roomId)}</td>` : ''}
                    <td>${room.guestName || '—'}</td>
                    <td>
                      ${room.isArrivalToday ? `<span class="badge badge-arrival">Arrival ${room.arrivalTime || ''}</span>` : ''}
                      ${room.isDepartureToday ? `<span class="badge badge-departure">Departure ${room.checkOutTime || ''}</span>` : ''}
                      ${room.hasMaintenanceIssue ? '<span class="badge badge-maintenance">Maintenance</span>' : ''}
                      ${room.guestCount ? `${room.guestCount} guest${room.guestCount > 1 ? 's' : ''}` : ''}
                    </td>
                    <td>${room.specialInstructions || '—'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `).join('')}
        
        <div class="footer">
          Hotel PMS • Housekeeping Report • Page 1 of 1
        </div>
      </body>
    </html>
  `

  printWindow.document.write(html)
  printWindow.document.close()
}

export function printReservationsList(
  reservations: Reservation[],
  title: string = 'Reservations Report',
  options: {
    groupBy?: 'date' | 'status' | 'source' | 'none'
    showFinancials?: boolean
  } = {}
) {
  const { groupBy = 'none', showFinancials = true } = options

  const printWindow = window.open('', '_blank')
  if (!printWindow) return

  const getStatusLabel = (status: Reservation['status']) => {
    return status.replace('_', ' ')
  }

  const getSourceLabel = (source: Reservation['source']) => {
    return source.replace('_', ' ')
  }

  const totalRevenue = reservations.reduce((sum, r) => sum + r.totalAmount, 0)
  const totalDeposits = reservations.reduce((sum, r) => sum + r.depositPaid, 0)
  const totalBalance = reservations.reduce((sum, r) => sum + r.balanceDue, 0)

  const groupedReservations: Record<string, Reservation[]> = {}
  
  if (groupBy === 'date') {
    reservations.forEach(res => {
      const key = format(res.checkIn, 'MMMM d, yyyy')
      if (!groupedReservations[key]) groupedReservations[key] = []
      groupedReservations[key].push(res)
    })
  } else if (groupBy === 'status') {
    reservations.forEach(res => {
      const key = getStatusLabel(res.status)
      if (!groupedReservations[key]) groupedReservations[key] = []
      groupedReservations[key].push(res)
    })
  } else if (groupBy === 'source') {
    reservations.forEach(res => {
      const key = getSourceLabel(res.source)
      if (!groupedReservations[key]) groupedReservations[key] = []
      groupedReservations[key].push(res)
    })
  } else {
    groupedReservations['All Reservations'] = reservations
  }

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${title}</title>
        <style>
          @media print {
            @page {
              margin: 1cm;
              size: A4 landscape;
            }
            
            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            
            .no-print {
              display: none !important;
            }
          }
          
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 10pt;
            line-height: 1.3;
            color: #1a1a1a;
            padding: 16px;
          }
          
          .header {
            margin-bottom: 20px;
            padding-bottom: 12px;
            border-bottom: 2px solid #2c2c54;
          }
          
          .header h1 {
            font-size: 22pt;
            font-weight: 700;
            color: #2c2c54;
            margin-bottom: 6px;
          }
          
          .header .meta {
            font-size: 9pt;
            color: #666;
          }
          
          .stats {
            display: flex;
            gap: 12px;
            margin-bottom: 20px;
            padding: 10px;
            background: #f5f5f5;
            border-radius: 6px;
          }
          
          .stat-item {
            flex: 1;
          }
          
          .stat-item .label {
            font-size: 8pt;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 3px;
          }
          
          .stat-item .value {
            font-size: 16pt;
            font-weight: 700;
            color: #2c2c54;
          }
          
          .section {
            margin-bottom: 24px;
          }
          
          .section-title {
            font-size: 12pt;
            font-weight: 600;
            color: #2c2c54;
            margin-bottom: 10px;
            padding-bottom: 5px;
            border-bottom: 1px solid #ddd;
          }
          
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 12px;
            font-size: 9pt;
          }
          
          thead {
            background: #2c2c54;
            color: white;
          }
          
          th {
            text-align: left;
            padding: 6px 8px;
            font-size: 8pt;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.3px;
          }
          
          tbody tr {
            border-bottom: 1px solid #e5e5e5;
          }
          
          tbody tr:nth-child(even) {
            background: #fafafa;
          }
          
          td {
            padding: 6px 8px;
          }
          
          .guest-name {
            font-weight: 600;
            color: #2c2c54;
          }
          
          .status-badge {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 7pt;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.3px;
          }
          
          .status-confirmed {
            background: #d4edda;
            color: #155724;
          }
          
          .status-checked-in {
            background: #cfe2ff;
            color: #084298;
          }
          
          .status-checked-out {
            background: #e2e3e5;
            color: #383d41;
          }
          
          .status-cancelled {
            background: #f8d7da;
            color: #721c24;
          }
          
          .status-no-show {
            background: #fff3cd;
            color: #856404;
          }
          
          .status-pending {
            background: #fff3cd;
            color: #856404;
          }
          
          .amount {
            font-weight: 600;
            font-family: 'Courier New', monospace;
          }
          
          .footer {
            margin-top: 24px;
            padding-top: 12px;
            border-top: 1px solid #ddd;
            text-align: center;
            font-size: 8pt;
            color: #666;
          }
          
          .print-button {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 10px 20px;
            background: #2c2c54;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 10pt;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            z-index: 1000;
          }
          
          .print-button:hover {
            background: #1f1f3a;
          }
          
          .vip-badge {
            background: #ffc107;
            color: #000;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 7pt;
            font-weight: 700;
            margin-left: 4px;
          }
        </style>
      </head>
      <body>
        <button class="print-button no-print" onclick="window.print()">🖨️ Print Report</button>
        
        <div class="header">
          <h1>${title}</h1>
          <div class="meta">
            Generated: ${format(new Date(), 'EEEE, MMMM d, yyyy • h:mm a')} • Total Reservations: ${reservations.length}
          </div>
        </div>
        
        ${showFinancials ? `
          <div class="stats">
            <div class="stat-item">
              <div class="label">Total Reservations</div>
              <div class="value">${reservations.length}</div>
            </div>
            <div class="stat-item">
              <div class="label">Total Revenue</div>
              <div class="value">฿${totalRevenue.toLocaleString()}</div>
            </div>
            <div class="stat-item">
              <div class="label">Deposits Collected</div>
              <div class="value">฿${totalDeposits.toLocaleString()}</div>
            </div>
            <div class="stat-item">
              <div class="label">Balance Due</div>
              <div class="value">฿${totalBalance.toLocaleString()}</div>
            </div>
          </div>
        ` : ''}
        
        ${Object.entries(groupedReservations).map(([groupName, groupRes]) => `
          <div class="section">
            <h2 class="section-title">${groupName} (${groupRes.length})</h2>
            <table>
              <thead>
                <tr>
                  <th>Confirmation</th>
                  <th>Guest</th>
                  <th>Status</th>
                  <th>Room</th>
                  <th>Check-In</th>
                  <th>Check-Out</th>
                  <th>Nights</th>
                  <th>Guests</th>
                  <th>Source</th>
                  ${showFinancials ? '<th>Amount</th>' : ''}
                  ${showFinancials ? '<th>Deposit</th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${groupRes.map(res => `
                  <tr>
                    <td><code>${res.confirmationNumber}</code></td>
                    <td class="guest-name">
                      ${res.guestName}
                      ${res.isVIP ? '<span class="vip-badge">VIP</span>' : ''}
                    </td>
                    <td><span class="status-badge status-${res.status.toLowerCase().replace('_', '-')}">${getStatusLabel(res.status)}</span></td>
                    <td>${res.roomNumber || 'Unassigned'}</td>
                    <td>${format(res.checkIn, 'MMM d, yy')}</td>
                    <td>${format(res.checkOut, 'MMM d, yy')}</td>
                    <td>${res.nights}</td>
                    <td>${res.adults}${res.children > 0 ? `+${res.children}` : ''}</td>
                    <td style="font-size: 8pt;">${getSourceLabel(res.source)}</td>
                    ${showFinancials ? `<td class="amount">฿${res.totalAmount.toLocaleString()}</td>` : ''}
                    ${showFinancials ? `<td class="amount" style="color: ${res.depositStatus === 'PAID' ? '#155724' : '#856404'}">฿${res.depositPaid.toLocaleString()}</td>` : ''}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `).join('')}
        
        <div class="footer">
          Hotel PMS • Reservations Report • Confidential
        </div>
      </body>
    </html>
  `

  printWindow.document.write(html)
  printWindow.document.close()
}

export function printReservationDetail(reservation: Reservation) {
  const printWindow = window.open('', '_blank')
  if (!printWindow) return

  const getStatusLabel = (status: Reservation['status']) => {
    return status.replace('_', ' ')
  }

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Reservation ${reservation.confirmationNumber}</title>
        <style>
          @media print {
            @page {
              margin: 2cm;
              size: A4;
            }
            
            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            
            .no-print {
              display: none !important;
            }
          }
          
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 11pt;
            line-height: 1.6;
            color: #1a1a1a;
            padding: 40px;
          }
          
          .header {
            text-align: center;
            margin-bottom: 40px;
            padding-bottom: 20px;
            border-bottom: 3px solid #2c2c54;
          }
          
          .header h1 {
            font-size: 28pt;
            font-weight: 700;
            color: #2c2c54;
            margin-bottom: 8px;
          }
          
          .header .subtitle {
            font-size: 14pt;
            color: #666;
          }
          
          .confirmation {
            text-align: center;
            background: #2c2c54;
            color: white;
            padding: 16px;
            border-radius: 8px;
            margin-bottom: 32px;
          }
          
          .confirmation .label {
            font-size: 10pt;
            opacity: 0.9;
            margin-bottom: 4px;
          }
          
          .confirmation .number {
            font-size: 24pt;
            font-weight: 700;
            font-family: 'Courier New', monospace;
          }
          
          .section {
            margin-bottom: 32px;
          }
          
          .section-title {
            font-size: 14pt;
            font-weight: 700;
            color: #2c2c54;
            margin-bottom: 16px;
            padding-bottom: 8px;
            border-bottom: 2px solid #e5e5e5;
          }
          
          .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
          }
          
          .info-item {
            margin-bottom: 12px;
          }
          
          .info-label {
            font-size: 9pt;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
          }
          
          .info-value {
            font-size: 12pt;
            font-weight: 600;
            color: #1a1a1a;
          }
          
          .status-badge {
            display: inline-block;
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 10pt;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          
          .financial-summary {
            background: #f8f9fa;
            padding: 24px;
            border-radius: 8px;
            border: 2px solid #e5e5e5;
          }
          
          .financial-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #dee2e6;
          }
          
          .financial-row:last-child {
            border-bottom: none;
            margin-top: 8px;
            padding-top: 16px;
            border-top: 2px solid #2c2c54;
          }
          
          .financial-label {
            font-weight: 600;
          }
          
          .financial-value {
            font-weight: 700;
            font-family: 'Courier New', monospace;
            font-size: 13pt;
          }
          
          .total-row .financial-value {
            font-size: 18pt;
            color: #2c2c54;
          }
          
          .notes-box {
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 16px;
            border-radius: 4px;
            margin-top: 16px;
          }
          
          .footer {
            margin-top: 60px;
            padding-top: 20px;
            border-top: 2px solid #e5e5e5;
            text-align: center;
            font-size: 9pt;
            color: #666;
          }
          
          .print-button {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 24px;
            background: #2c2c54;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 11pt;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            z-index: 1000;
          }
          
          .print-button:hover {
            background: #1f1f3a;
          }
        </style>
      </head>
      <body>
        <button class="print-button no-print" onclick="window.print()">🖨️ Print Confirmation</button>
        
        <div class="header">
          <h1>Hotel</h1>
          <div class="subtitle">Reservation Confirmation</div>
        </div>
        
        <div class="confirmation">
          <div class="label">Confirmation Number</div>
          <div class="number">${reservation.confirmationNumber}</div>
        </div>
        
        <div class="section">
          <h2 class="section-title">Guest Information</h2>
          <div class="info-grid">
            <div class="info-item">
              <div class="info-label">Guest Name</div>
              <div class="info-value">${reservation.guestName} ${reservation.isVIP ? '⭐ VIP' : ''}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Email</div>
              <div class="info-value">${reservation.guestEmail || 'N/A'}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Phone</div>
              <div class="info-value">${reservation.guestPhone || 'N/A'}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Guest ID</div>
              <div class="info-value">${reservation.guestId}</div>
            </div>
          </div>
        </div>
        
        <div class="section">
          <h2 class="section-title">Reservation Details</h2>
          <div class="info-grid">
            <div class="info-item">
              <div class="info-label">Status</div>
              <div class="info-value">
                <span class="status-badge" style="background: #d4edda; color: #155724;">
                  ${getStatusLabel(reservation.status)}
                </span>
              </div>
            </div>
            <div class="info-item">
              <div class="info-label">Booking Source</div>
              <div class="info-value">${reservation.source.replace('_', ' ')}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Check-In</div>
              <div class="info-value">${format(reservation.checkIn, 'EEEE, MMMM d, yyyy')}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Check-Out</div>
              <div class="info-value">${format(reservation.checkOut, 'EEEE, MMMM d, yyyy')}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Room Type</div>
              <div class="info-value">${reservation.roomType}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Room Number</div>
              <div class="info-value">${reservation.roomNumber || 'To be assigned'}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Number of Nights</div>
              <div class="info-value">${reservation.nights}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Guests</div>
              <div class="info-value">${reservation.adults} Adult${reservation.adults > 1 ? 's' : ''}${reservation.children > 0 ? `, ${reservation.children} Child${reservation.children > 1 ? 'ren' : ''}` : ''}</div>
            </div>
          </div>
        </div>
        
        <div class="section">
          <h2 class="section-title">Financial Summary</h2>
          <div class="financial-summary">
            <div class="financial-row">
              <div class="financial-label">Rate per Night</div>
              <div class="financial-value">฿${reservation.ratePerNight.toLocaleString()}</div>
            </div>
            <div class="financial-row">
              <div class="financial-label">Number of Nights</div>
              <div class="financial-value">×${reservation.nights}</div>
            </div>
            <div class="financial-row">
              <div class="financial-label">Subtotal</div>
              <div class="financial-value">฿${reservation.totalAmount.toLocaleString()}</div>
            </div>
            <div class="financial-row">
              <div class="financial-label">Deposit Paid</div>
              <div class="financial-value" style="color: #155724;">-฿${reservation.depositPaid.toLocaleString()}</div>
            </div>
            <div class="financial-row total-row">
              <div class="financial-label">Balance Due</div>
              <div class="financial-value">฿${reservation.balanceDue.toLocaleString()}</div>
            </div>
          </div>
        </div>
        
        ${reservation.specialRequests || reservation.notes ? `
          <div class="section">
            <h2 class="section-title">Additional Information</h2>
            ${reservation.specialRequests ? `
              <div class="notes-box">
                <div class="info-label">Special Requests</div>
                <div style="margin-top: 8px; font-size: 11pt;">${reservation.specialRequests}</div>
              </div>
            ` : ''}
            ${reservation.notes ? `
              <div class="notes-box" style="margin-top: 12px;">
                <div class="info-label">Internal Notes</div>
                <div style="margin-top: 8px; font-size: 11pt;">${reservation.notes}</div>
              </div>
            ` : ''}
          </div>
        ` : ''}
        
        <div class="footer">
          <p><strong>Hotel</strong></p>
          <p>Contact details available from property settings.</p>
          <p style="margin-top: 16px; font-size: 8pt;">
            Printed on ${format(new Date(), 'MMMM d, yyyy • h:mm a')}
          </p>
        </div>
      </body>
    </html>
  `

  printWindow.document.write(html)
  printWindow.document.close()
}
