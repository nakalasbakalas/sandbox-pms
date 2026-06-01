import { addDays, format, parseISO } from 'date-fns'
import { getBangkokDateKey } from '@/lib/hotel/business-rules'

export interface IcalEvent {
  uid: string
  summary: string
  checkIn: string
  checkOut: string
  description?: string
}

export interface IcalImportResult {
  events: IcalEvent[]
  skipped: number
}

function dateKeyFromIcalValue(value: string) {
  const normalized = value.trim()
  const dateMatch = normalized.match(/^(\d{4})(\d{2})(\d{2})/)
  if (!dateMatch) return null

  const [, year, month, day] = dateMatch

  if (/^\d{8}T/.test(normalized)) {
    const iso = normalized.endsWith('Z')
      ? `${year}-${month}-${day}T${normalized.slice(9, 15).replace(/(\d{2})(\d{2})(\d{2})/, '$1:$2:$3')}Z`
      : `${year}-${month}-${day}T${normalized.slice(9, 15).replace(/(\d{2})(\d{2})(\d{2})/, '$1:$2:$3')}`
    const parsed = new Date(iso)
    if (!Number.isNaN(parsed.getTime())) return getBangkokDateKey(parsed)
  }

  return `${year}-${month}-${day}`
}

function nextDateKey(value: string) {
  return format(addDays(parseISO(value), 1), 'yyyy-MM-dd')
}

function unescapeIcalText(value = '') {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim()
}

function escapeIcalText(value = '') {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function foldIcalLine(line: string) {
  if (line.length <= 74) return line
  const chunks: string[] = []
  let remaining = line
  while (remaining.length > 74) {
    chunks.push(remaining.slice(0, 74))
    remaining = ` ${remaining.slice(74)}`
  }
  chunks.push(remaining)
  return chunks.join('\r\n')
}

function dateKeyToIcalDate(value: string | Date) {
  return getBangkokDateKey(value).replaceAll('-', '')
}

export function parseIcalEvents(source: string): IcalImportResult {
  const unfolded = source.replace(/\r?\n[ \t]/g, '')
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || []
  const events: IcalEvent[] = []
  let skipped = 0

  for (const block of blocks) {
    const fields = new Map<string, string>()

    for (const rawLine of block.split(/\r?\n/)) {
      const separator = rawLine.indexOf(':')
      if (separator < 0) continue
      const rawName = rawLine.slice(0, separator)
      const name = rawName.split(';')[0]?.toUpperCase()
      const value = rawLine.slice(separator + 1)
      if (name && !fields.has(name)) fields.set(name, value)
    }

    const checkIn = dateKeyFromIcalValue(fields.get('DTSTART') || '')
    const rawCheckOut = dateKeyFromIcalValue(fields.get('DTEND') || '')
    const checkOut = rawCheckOut && rawCheckOut > String(checkIn) ? rawCheckOut : checkIn ? nextDateKey(checkIn) : null

    if (!checkIn || !checkOut) {
      skipped += 1
      continue
    }

    events.push({
      uid: unescapeIcalText(fields.get('UID')) || `ical-${checkIn}-${checkOut}-${events.length + 1}`,
      summary: unescapeIcalText(fields.get('SUMMARY')) || 'iCal reservation',
      description: unescapeIcalText(fields.get('DESCRIPTION')),
      checkIn,
      checkOut,
    })
  }

  return { events, skipped }
}

export function generateIcalFeed(calendarName: string, events: IcalEvent[]) {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'PRODID:-//Sandbox Hotel PMS//iCal Bridge//EN',
    `X-WR-CALNAME:${escapeIcalText(calendarName)}`,
  ]

  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcalText(event.uid)}`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${dateKeyToIcalDate(event.checkIn)}`,
      `DTEND;VALUE=DATE:${dateKeyToIcalDate(event.checkOut)}`,
      `SUMMARY:${escapeIcalText(event.summary)}`,
    )

    if (event.description) {
      lines.push(`DESCRIPTION:${escapeIcalText(event.description)}`)
    }

    lines.push('TRANSP:OPAQUE', 'END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return `${lines.map(foldIcalLine).join('\r\n')}\r\n`
}

export function downloadIcalFeed(fileName: string, contents: string) {
  const blob = new Blob([contents], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName.endsWith('.ics') ? fileName : `${fileName}.ics`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
