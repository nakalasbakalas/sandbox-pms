import { getBangkokDateKey } from '@/lib/hotel/business-rules'
import type { AssistantEntities, AssistantParsedIntent } from './types'

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function dateRangeFromText(text: string): AssistantParsedIntent['entities']['dateRange'] {
  const today = new Date()
  const tomorrow = addDays(today, 1)
  const isoDate = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1]
  if (isoDate) {
    return { checkIn: isoDate, checkOut: getBangkokDateKey(addDays(new Date(`${isoDate}T00:00:00`), 1)), label: isoDate }
  }
  if (/\btomorrow\b/.test(text)) {
    return { checkIn: getBangkokDateKey(tomorrow), checkOut: getBangkokDateKey(addDays(tomorrow, 1)), label: 'tomorrow' }
  }
  if (/\bweekend\b/.test(text)) {
    const day = today.getDay()
    const daysUntilSaturday = (6 - day + 7) % 7
    const saturday = addDays(today, daysUntilSaturday)
    return { checkIn: getBangkokDateKey(saturday), checkOut: getBangkokDateKey(addDays(saturday, 2)), label: 'this weekend' }
  }
  return { checkIn: getBangkokDateKey(today), checkOut: getBangkokDateKey(addDays(today, 1)), label: /\btonight\b/.test(text) ? 'tonight' : 'today' }
}

export function parseFrontDeskIntent(input: string, context: { currentRoomNumber?: string; currentReservationId?: string } = {}): AssistantParsedIntent {
  const text = input.trim().toLowerCase()
  const roomNumber = text.match(/\b(20[1-9]|21[0-6]|30[1-9]|31[0-6])\b/)?.[1] ?? context.currentRoomNumber
  const reservationCode = input.match(/\bSBX[-\s]?\d+\b/i)?.[0]?.replace(/\s+/, '-').toUpperCase() ?? context.currentReservationId
  const roomType: AssistantEntities['roomType'] = /\bdouble\b/.test(text) ? 'DOUBLE' : /\btwin\b/.test(text) ? 'TWIN' : undefined
  const entities: AssistantEntities = { roomType, roomNumber, reservationCode, dateRange: dateRangeFromText(text) }

  if (/\brisk|risks|blocked|attention\b/.test(text)) return { intent: 'DAILY_RISKS', entities, confidence: 0.92 }
  if (/\bwalk[- ]?in|sell|available|availability|vacant|can i sell\b/.test(text)) {
    return { intent: /\bwalk[- ]?in|create\b/.test(text) ? 'CREATE_WALK_IN' : 'CHECK_AVAILABILITY', entities, confidence: 0.9 }
  }
  if (/\barriv|due in|early\b/.test(text)) return { intent: 'LIST_ARRIVALS', entities, confidence: 0.9 }
  if (/\bdepart|check[- ]?out|checkout|late checkout\b/.test(text)) {
    return { intent: /\bcan|why|block|eligible|them|guest|reservation|room\b/.test(text) ? 'CHECK_OUT_ELIGIBILITY' : 'LIST_DEPARTURES', entities, confidence: 0.86 }
  }
  if (/\bin[- ]?house|staying|occupied\b/.test(text)) return { intent: 'LIST_IN_HOUSE', entities, confidence: 0.85 }
  if (/\bready|clean|dirty|housekeeping|cleaning|inspected\b/.test(text)) {
    return { intent: roomNumber ? 'ROOM_STATUS' : 'HOUSEKEEPING_STATUS', entities, confidence: 0.87 }
  }
  if (/\bunpaid|paid|payment|balance|folio|owes|owe\b/.test(text)) return { intent: 'PAYMENT_BALANCE', entities, confidence: 0.9 }
  if (/\bcheck[- ]?in|checkin\b/.test(text) || /\bcan i check|why can.t i check|them in\b/.test(text)) {
    return { intent: 'CHECK_IN_ELIGIBILITY', entities, confidence: 0.88 }
  }
  if (/\bfind|search|booking|reservation|guest\b/.test(text) || reservationCode || roomNumber) {
    const guestName = input.replace(/\b(find|search|booking|reservation|for|guest|room)\b/gi, '').replace(/\b\d{3}\b/g, '').trim()
    return { intent: 'FIND_RESERVATION', entities: { ...entities, guestName: guestName || undefined }, confidence: 0.78 }
  }

  return { intent: 'HELP', entities, confidence: 0.5 }
}
