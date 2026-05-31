import { differenceInCalendarDays, format } from 'date-fns'

import type { BoardRoomCard } from '@/types/board'

export type ReservationDocumentAction = 'invoice' | 'summary' | 'confirmation' | 'registration-card'

interface PropertyDocumentData {
  name: string
  address: string
  city: string
  country: string
  phone: string
  email: string
  taxId?: string
  currency: string
  defaultCheckIn: string
  defaultCheckOut: string
  brandColor: string
  receiptFooter: string
}

interface ReservationDocumentData {
  action: ReservationDocumentAction
  title: string
  property: PropertyDocumentData
  guestName: string
  guestEmail?: string
  guestPhone?: string
  reservationId: string
  documentNumber: string
  roomNumber: string
  roomType: string
  status: string
  checkIn: Date | null
  checkOut: Date | null
  nights: number | null
  guests: number
  totalAmount?: number
  balanceDue?: number
  paidAmount?: number
  ratePerNight?: number
  notes?: string
}

const DOCUMENT_TITLES: Record<ReservationDocumentAction, string> = {
  invoice: 'Tax Invoice',
  summary: 'Booking Summary',
  confirmation: 'Reservation Confirmation',
  'registration-card': 'Guest Registration Form',
}

const DOCUMENT_PREFIXES: Record<ReservationDocumentAction, string> = {
  invoice: 'INV',
  summary: 'SUM',
  confirmation: 'CNF',
  'registration-card': 'REG',
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

function escapeHtml(value: string | number) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatDate(value: Date | null) {
  return value ? format(value, 'EEEE, MMMM d, yyyy') : 'Not set'
}

function formatShortDate(value: Date | null) {
  return value ? format(value, 'MMM d, yyyy') : 'Not set'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function formatAmount(value: number | undefined, currency: string) {
  if (!isFiniteNumber(value)) return 'Not set'
  return `${currency} ${value.toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
  })}`
}

function readString(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function readPropertyInfo(): PropertyDocumentData {
  const fallback: PropertyDocumentData = {
    name: 'Hotel',
    address: '',
    city: '',
    country: '',
    phone: '',
    email: '',
    currency: 'THB',
    defaultCheckIn: '14:00',
    defaultCheckOut: '12:00',
    brandColor: '#2563eb',
    receiptFooter: '',
  }

  try {
    const raw = window.localStorage.getItem('onboarding-property')
    if (!raw) return fallback

    const parsed = JSON.parse(raw)
    return {
      name: readString(parsed?.name, fallback.name),
      address: readString(parsed?.address),
      city: readString(parsed?.city),
      country: readString(parsed?.country),
      phone: readString(parsed?.phone),
      email: readString(parsed?.email),
      taxId: readString(parsed?.taxId) || undefined,
      currency: readString(parsed?.currency, fallback.currency),
      defaultCheckIn: readString(parsed?.defaultCheckIn, fallback.defaultCheckIn),
      defaultCheckOut: readString(parsed?.defaultCheckOut, fallback.defaultCheckOut),
      brandColor: readString(parsed?.brandColor, fallback.brandColor),
      receiptFooter: readString(parsed?.receiptFooter),
    }
  } catch {
    return fallback
  }
}

function getReservationId(room: BoardRoomCard) {
  return room.reservation?.id || room.reservationId || room.currentReservationId || `ROOM-${room.number}`
}

function getNights(checkIn: Date | null, checkOut: Date | null) {
  if (!checkIn || !checkOut) return null
  return Math.max(1, differenceInCalendarDays(checkOut, checkIn))
}

function compactDocumentId(value: string) {
  const compact = value.replace(/[^a-zA-Z0-9]/g, '').slice(-10)
  return compact || 'ROOM'
}

function getDocumentNumber(action: ReservationDocumentAction, reservationId: string) {
  return `${DOCUMENT_PREFIXES[action]}-${format(new Date(), 'yyyyMMdd')}-${compactDocumentId(reservationId)}`
}

export function getReservationDocumentLabel(action: ReservationDocumentAction) {
  return DOCUMENT_TITLES[action]
}

export function getReservationGuestEmail(room: BoardRoomCard) {
  return room.guestEmail || room.reservation?.guestEmail
}

export function getReservationGuestPhone(room: BoardRoomCard) {
  return room.guestPhone || room.reservation?.guestPhone
}

function getDocumentData(room: BoardRoomCard, action: ReservationDocumentAction): ReservationDocumentData {
  const property = readPropertyInfo()
  const checkIn = parseDate(room.checkIn || room.reservation?.checkIn)
  const checkOut = parseDate(room.checkOut || room.reservation?.checkOut)
  const nights = getNights(checkIn, checkOut)
  const reservationId = getReservationId(room)
  const totalAmount = room.reservation?.totalAmount ?? room.balanceDue
  const balanceDue = room.balanceDue ?? room.reservation?.balanceDue
  const paidAmount = isFiniteNumber(totalAmount) && isFiniteNumber(balanceDue)
    ? Math.max(0, totalAmount - balanceDue)
    : undefined
  const ratePerNight = isFiniteNumber(totalAmount) && nights
    ? totalAmount / nights
    : undefined

  return {
    action,
    title: DOCUMENT_TITLES[action],
    property,
    guestName: room.guestName || room.reservation?.guestName || 'Guest name required',
    guestEmail: getReservationGuestEmail(room),
    guestPhone: getReservationGuestPhone(room),
    reservationId,
    documentNumber: getDocumentNumber(action, reservationId),
    roomNumber: room.number,
    roomType: humanize(room.type),
    status: humanize(room.reservation?.status || (room.status.includes('OCCUPIED') ? 'CHECKED_IN' : 'CONFIRMED')),
    checkIn,
    checkOut,
    nights,
    guests: Math.max(1, room.guestCount || 1),
    totalAmount,
    balanceDue,
    paidAmount,
    ratePerNight,
    notes: room.notes,
  }
}

function propertyAddress(data: PropertyDocumentData) {
  return [data.address, data.city, data.country].filter(Boolean).join(', ')
}

function detailCell(label: string, value: string | number) {
  return `<div class="field"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`
}

function moneyCell(label: string, value: number | undefined, currency: string) {
  return detailCell(label, formatAmount(value, currency))
}

function buildStayGrid(data: ReservationDocumentData) {
  return `
  <div class="grid">
    ${detailCell('Guest', data.guestName)}
    ${detailCell('Reservation', data.reservationId)}
    ${detailCell('Email', data.guestEmail || 'Not recorded')}
    ${detailCell('Phone', data.guestPhone || 'Not recorded')}
    ${detailCell('Check in', formatDate(data.checkIn))}
    ${detailCell('Check out', formatDate(data.checkOut))}
    ${detailCell('Room', `${data.roomType} room ${data.roomNumber}`)}
    ${detailCell('Guests', data.guests)}
    ${detailCell('Nights', data.nights ?? 'Not set')}
    ${detailCell('Status', data.status)}
  </div>`
}

function buildFinancialRows(data: ReservationDocumentData) {
  const currency = data.property.currency
  return `
    <tr>
      <td>${escapeHtml(`${data.roomType} room ${data.roomNumber}`)}</td>
      <td class="text-center">${escapeHtml(data.nights ?? 'Not set')}</td>
      <td class="text-right">${escapeHtml(formatAmount(data.ratePerNight, currency))}</td>
      <td class="text-right">${escapeHtml(formatAmount(data.totalAmount, currency))}</td>
    </tr>`
}

function buildFinancialTable(data: ReservationDocumentData) {
  const currency = data.property.currency
  return `
  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="text-center">Qty</th>
        <th class="text-right">Unit price</th>
        <th class="text-right">Total</th>
      </tr>
    </thead>
    <tbody>
      ${buildFinancialRows(data)}
    </tbody>
  </table>

  <table class="totals-table">
    <tbody>
      <tr>
        <td>Total</td>
        <td class="text-right">${escapeHtml(formatAmount(data.totalAmount, currency))}</td>
      </tr>
      <tr>
        <td>Paid</td>
        <td class="text-right">${escapeHtml(formatAmount(data.paidAmount, currency))}</td>
      </tr>
      <tr class="grand-total">
        <td>Balance due</td>
        <td class="text-right">${escapeHtml(formatAmount(data.balanceDue, currency))}</td>
      </tr>
    </tbody>
  </table>`
}

function buildInvoiceBody(data: ReservationDocumentData) {
  return `
  ${buildStayGrid(data)}
  <h2>Invoice Lines</h2>
  ${buildFinancialTable(data)}
  <div class="signature signature-single">
    <div class="signature-line">Authorized signature</div>
  </div>`
}

function buildSummaryBody(data: ReservationDocumentData) {
  const currency = data.property.currency
  return `
  ${buildStayGrid(data)}
  <h2>Financial Summary</h2>
  <div class="summary-grid">
    ${moneyCell('Reservation total', data.totalAmount, currency)}
    ${moneyCell('Total received', data.paidAmount, currency)}
    ${moneyCell('Total outstanding', data.balanceDue, currency)}
    ${moneyCell('Average nightly rate', data.ratePerNight, currency)}
  </div>
  <h2>Notes</h2>
  <div class="field notes">${escapeHtml(data.notes || 'No notes recorded')}</div>`
}

function buildConfirmationBody(data: ReservationDocumentData) {
  const currency = data.property.currency
  return `
  ${buildStayGrid(data)}
  <h2>Confirmed Stay</h2>
  <div class="summary-grid">
    ${detailCell('Expected check-in time', data.property.defaultCheckIn)}
    ${detailCell('Expected check-out time', data.property.defaultCheckOut)}
    ${moneyCell('Reservation total', data.totalAmount, currency)}
    ${moneyCell('Balance due', data.balanceDue, currency)}
  </div>
  <h2>Guest Notes</h2>
  <div class="field notes">${escapeHtml(data.notes || 'No notes recorded')}</div>`
}

function buildRegistrationBody(data: ReservationDocumentData) {
  return `
  ${buildStayGrid(data)}
  <h2>Registration Details</h2>
  <div class="form-grid">
    <div class="blank-field"><div class="label">Nationality</div></div>
    <div class="blank-field"><div class="label">ID / Passport number</div></div>
    <div class="blank-field"><div class="label">Address</div></div>
    <div class="blank-field"><div class="label">Vehicle / Other reference</div></div>
  </div>
  <h2>Guest Notes</h2>
  <div class="field notes">${escapeHtml(data.notes || 'No notes recorded')}</div>
  <div class="signature">
    <div class="signature-line">Guest signature</div>
    <div class="signature-line">Staff signature</div>
  </div>`
}

function buildDocumentBody(data: ReservationDocumentData) {
  switch (data.action) {
    case 'invoice':
      return buildInvoiceBody(data)
    case 'summary':
      return buildSummaryBody(data)
    case 'confirmation':
      return buildConfirmationBody(data)
    case 'registration-card':
      return buildRegistrationBody(data)
  }
}

function buildPrintableHtml(data: ReservationDocumentData) {
  const printedAt = format(new Date(), 'MMMM d, yyyy h:mm a')
  const address = propertyAddress(data.property)

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
      background: ${escapeHtml(data.property.brandColor)};
      color: #ffffff;
      cursor: pointer;
      font-weight: 700;
      padding: 10px 14px;
    }
    .header {
      align-items: flex-start;
      border-bottom: 2px solid ${escapeHtml(data.property.brandColor)};
      display: flex;
      gap: 24px;
      justify-content: space-between;
      margin-bottom: 24px;
      padding-bottom: 16px;
    }
    h1 {
      font-size: 24px;
      line-height: 1.2;
      margin: 0 0 6px;
      text-transform: uppercase;
    }
    h2 {
      font-size: 15px;
      margin: 24px 0 10px;
      text-transform: uppercase;
    }
    .property {
      color: #374151;
      font-size: 14px;
      font-weight: 700;
    }
    .muted {
      color: #6b7280;
      font-size: 12px;
    }
    .document-meta {
      min-width: 210px;
      text-align: right;
    }
    .document-number {
      font-family: "Courier New", monospace;
      font-size: 15px;
      font-weight: 700;
    }
    .grid,
    .summary-grid,
    .form-grid {
      display: grid;
      gap: 14px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      margin-bottom: 20px;
    }
    .summary-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .field,
    .blank-field {
      border: 1px solid #d1d5db;
      border-radius: 6px;
      min-height: 58px;
      padding: 10px 12px;
    }
    .blank-field {
      min-height: 92px;
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
      overflow-wrap: anywhere;
    }
    table {
      border-collapse: collapse;
      margin: 12px 0 18px;
      width: 100%;
    }
    th {
      background: #f3f4f6;
      border-bottom: 2px solid #d1d5db;
      font-size: 11px;
      padding: 8px;
      text-align: left;
      text-transform: uppercase;
    }
    td {
      border-bottom: 1px solid #e5e7eb;
      padding: 9px 8px;
      vertical-align: top;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .totals-table {
      margin-left: auto;
      max-width: 340px;
    }
    .totals-table td {
      border-bottom: 0;
      padding: 5px 8px;
    }
    .grand-total td {
      border-top: 2px solid #111827;
      font-size: 15px;
      font-weight: 700;
      padding-top: 9px;
    }
    .notes {
      min-height: 72px;
      white-space: pre-wrap;
    }
    .signature {
      display: grid;
      gap: 24px;
      grid-template-columns: 1fr 1fr;
      margin-top: 48px;
    }
    .signature-single {
      grid-template-columns: minmax(220px, 320px);
      justify-content: end;
    }
    .signature-line {
      border-top: 1px solid #111827;
      padding-top: 8px;
      text-align: center;
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
    <div>
      <h1>${escapeHtml(data.title)}</h1>
      <div class="property">${escapeHtml(data.property.name)}</div>
      ${address ? `<div class="muted">${escapeHtml(address)}</div>` : ''}
      ${data.property.phone || data.property.email ? `<div class="muted">${escapeHtml([data.property.phone, data.property.email].filter(Boolean).join(' | '))}</div>` : ''}
      ${data.property.taxId ? `<div class="muted">Tax ID: ${escapeHtml(data.property.taxId)}</div>` : ''}
    </div>
    <div class="document-meta">
      <div class="label">Document number</div>
      <div class="document-number">${escapeHtml(data.documentNumber)}</div>
      <div class="muted">Reservation ${escapeHtml(data.reservationId)}</div>
      <div class="muted">${escapeHtml(formatShortDate(new Date()))}</div>
    </div>
  </div>

  ${buildDocumentBody(data)}

  <div class="footer">
    <div>Printed ${escapeHtml(printedAt)}</div>
    ${data.property.receiptFooter ? `<div>${escapeHtml(data.property.receiptFooter)}</div>` : ''}
  </div>
</body>
</html>`
}

function buildEmailBody(data: ReservationDocumentData) {
  return [
    `Dear ${data.guestName},`,
    '',
    `${data.property.name} - ${data.title}`,
    '',
    `Reservation: ${data.reservationId}`,
    `Document number: ${data.documentNumber}`,
    `Status: ${data.status}`,
    `Room: ${data.roomType} room ${data.roomNumber}`,
    `Check in: ${formatDate(data.checkIn)}`,
    `Check out: ${formatDate(data.checkOut)}`,
    `Guests: ${data.guests}`,
    `Nights: ${data.nights ?? 'Not set'}`,
    `Reservation total: ${formatAmount(data.totalAmount, data.property.currency)}`,
    `Balance due: ${formatAmount(data.balanceDue, data.property.currency)}`,
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
