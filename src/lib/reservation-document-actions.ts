import { format } from 'date-fns'

import type { BoardRoomCard } from '@/types/board'

export type ReservationDocumentAction = 'registration-card' | 'confirmation'

interface ReservationDocumentData {
  title: string
  guestName: string
  guestEmail?: string
  guestPhone?: string
  reservationId: string
  roomNumber: string
  roomType: string
  status: string
  checkIn: Date | null
  checkOut: Date | null
  guests: number
  totalAmount?: number
  balanceDue?: number
  notes?: string
}

function parseDate(value?: Date | string) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function humanize(value?: string) {
  if (!value) return 'Not recorded'
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatDate(value: Date | null) {
  return value ? format(value, 'EEEE, MMMM d, yyyy') : 'Not set'
}

function formatAmount(value?: number) {
  return typeof value === 'number' ? `THB ${value.toLocaleString('en-US')}` : 'Not set'
}

function readPropertyName() {
  try {
    const raw = window.localStorage.getItem('onboarding-property')
    if (!raw) return 'Hotel'
    const parsed = JSON.parse(raw)
    return typeof parsed?.name === 'string' && parsed.name.trim() ? parsed.name.trim() : 'Hotel'
  } catch {
    return 'Hotel'
  }
}

function getReservationId(room: BoardRoomCard) {
  return room.reservation?.id || room.reservationId || room.currentReservationId || `ROOM-${room.number}`
}

export function getReservationGuestEmail(room: BoardRoomCard) {
  return room.guestEmail || room.reservation?.guestEmail
}

export function getReservationGuestPhone(room: BoardRoomCard) {
  return room.guestPhone || room.reservation?.guestPhone
}

function getDocumentData(room: BoardRoomCard, action: ReservationDocumentAction): ReservationDocumentData {
  const checkIn = parseDate(room.checkIn || room.reservation?.checkIn)
  const checkOut = parseDate(room.checkOut || room.reservation?.checkOut)
  const title = action === 'registration-card' ? 'Guest Registration Card' : 'Reservation Confirmation'

  return {
    title,
    guestName: room.guestName || room.reservation?.guestName || 'Guest name required',
    guestEmail: getReservationGuestEmail(room),
    guestPhone: getReservationGuestPhone(room),
    reservationId: getReservationId(room),
    roomNumber: room.number,
    roomType: humanize(room.type),
    status: humanize(room.reservation?.status || (room.status.includes('OCCUPIED') ? 'CHECKED_IN' : 'CONFIRMED')),
    checkIn,
    checkOut,
    guests: room.guestCount || 1,
    totalAmount: room.reservation?.totalAmount ?? room.balanceDue,
    balanceDue: room.balanceDue ?? room.reservation?.balanceDue,
    notes: room.notes,
  }
}

function buildPrintableHtml(data: ReservationDocumentData) {
  const propertyName = readPropertyName()
  const printedAt = format(new Date(), 'MMMM d, yyyy h:mm a')

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(data.title)} - ${escapeHtml(data.reservationId)}</title>
  <style>
    @media print {
      @page { margin: 18mm; size: A4; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px;
      color: #111827;
      font: 13px/1.5 Arial, Helvetica, sans-serif;
      background: #ffffff;
    }
    .toolbar {
      position: fixed;
      top: 16px;
      right: 16px;
    }
    .toolbar button {
      border: 0;
      border-radius: 6px;
      background: #2563eb;
      color: #ffffff;
      cursor: pointer;
      font-weight: 700;
      padding: 10px 14px;
    }
    .header {
      border-bottom: 2px solid #111827;
      margin-bottom: 24px;
      padding-bottom: 14px;
    }
    h1 {
      font-size: 24px;
      line-height: 1.2;
      margin: 0;
    }
    .property {
      color: #4b5563;
      font-size: 14px;
      margin-top: 4px;
    }
    .grid {
      display: grid;
      gap: 14px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      margin-bottom: 20px;
    }
    .field {
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 10px 12px;
    }
    .label {
      color: #6b7280;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .04em;
      margin-bottom: 4px;
      text-transform: uppercase;
    }
    .value {
      font-size: 14px;
      font-weight: 700;
      min-height: 20px;
    }
    .section-title {
      font-size: 15px;
      font-weight: 700;
      margin: 24px 0 10px;
    }
    .signature {
      display: grid;
      gap: 24px;
      grid-template-columns: 1fr 1fr;
      margin-top: 44px;
    }
    .signature-line {
      border-top: 1px solid #111827;
      padding-top: 8px;
      text-align: center;
    }
    .notes {
      min-height: 72px;
    }
    .footer {
      border-top: 1px solid #d1d5db;
      color: #6b7280;
      font-size: 11px;
      margin-top: 32px;
      padding-top: 12px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="toolbar no-print"><button onclick="window.print()">Print</button></div>
  <div class="header">
    <h1>${escapeHtml(data.title)}</h1>
    <div class="property">${escapeHtml(propertyName)} - Reservation ${escapeHtml(data.reservationId)}</div>
  </div>

  <div class="grid">
    <div class="field"><div class="label">Guest</div><div class="value">${escapeHtml(data.guestName)}</div></div>
    <div class="field"><div class="label">Status</div><div class="value">${escapeHtml(data.status)}</div></div>
    <div class="field"><div class="label">Email</div><div class="value">${escapeHtml(data.guestEmail || 'Not recorded')}</div></div>
    <div class="field"><div class="label">Phone</div><div class="value">${escapeHtml(data.guestPhone || 'Not recorded')}</div></div>
    <div class="field"><div class="label">Check in</div><div class="value">${escapeHtml(formatDate(data.checkIn))}</div></div>
    <div class="field"><div class="label">Check out</div><div class="value">${escapeHtml(formatDate(data.checkOut))}</div></div>
    <div class="field"><div class="label">Room</div><div class="value">${escapeHtml(data.roomType)} room ${escapeHtml(data.roomNumber)}</div></div>
    <div class="field"><div class="label">Guests</div><div class="value">${data.guests}</div></div>
    <div class="field"><div class="label">Reservation total</div><div class="value">${escapeHtml(formatAmount(data.totalAmount))}</div></div>
    <div class="field"><div class="label">Balance due</div><div class="value">${escapeHtml(formatAmount(data.balanceDue))}</div></div>
  </div>

  <div class="section-title">Notes</div>
  <div class="field notes">${escapeHtml(data.notes || 'No notes recorded')}</div>

  <div class="signature">
    <div class="signature-line">Guest signature</div>
    <div class="signature-line">Staff signature</div>
  </div>

  <div class="footer">Printed ${escapeHtml(printedAt)}</div>
</body>
</html>`
}

function buildEmailBody(data: ReservationDocumentData) {
  return [
    `Dear ${data.guestName},`,
    '',
    `Your ${data.title.toLowerCase()} details are below.`,
    '',
    `Reservation: ${data.reservationId}`,
    `Status: ${data.status}`,
    `Room: ${data.roomType} room ${data.roomNumber}`,
    `Check in: ${formatDate(data.checkIn)}`,
    `Check out: ${formatDate(data.checkOut)}`,
    `Guests: ${data.guests}`,
    `Reservation total: ${formatAmount(data.totalAmount)}`,
    `Balance due: ${formatAmount(data.balanceDue)}`,
    '',
    'Thank you.',
  ].join('\n')
}

export function printReservationDocument(room: BoardRoomCard, action: ReservationDocumentAction = 'registration-card') {
  const printWindow = window.open('', '_blank')
  if (!printWindow) return false

  printWindow.document.write(buildPrintableHtml(getDocumentData(room, action)))
  printWindow.document.close()
  printWindow.focus()
  window.setTimeout(() => {
    printWindow.print()
  }, 150)
  return true
}

export function emailReservationDocument(room: BoardRoomCard, action: ReservationDocumentAction = 'confirmation') {
  const data = getDocumentData(room, action)
  if (!data.guestEmail) {
    return { ok: false, message: 'No guest email address is recorded for this reservation.' }
  }

  const subject = `${data.title} ${data.reservationId}`
  const body = buildEmailBody(data)
  window.open(`mailto:${encodeURIComponent(data.guestEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_self')
  return { ok: true, message: `Email draft opened for ${data.guestEmail}.` }
}
