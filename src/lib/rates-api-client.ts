import { pmsApi } from '@/lib/pms-api-client'
import type { MoneySatang } from '@/types/money'

export type ServerRateRoomType = {
  id: string
  code: string
  name: string
  baseRateSatang: MoneySatang
}

export type ServerRateRule = {
  id: string
  propertyId: string
  roomTypeId: string | null
  name: string
  description: string | null
  priority: number
  startDate: string | null
  endDate: string | null
  daysOfWeek: number[]
  adjustmentType: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'OVERRIDE'
  adjustmentSatang: MoneySatang | null
  adjustmentBasisPoints: number | null
  active: boolean
  createdAt: string
  updatedAt: string
}

export type ServerRateCalendarEntry = {
  id: string
  propertyId: string
  roomTypeId: string
  date: string
  rateSatang: MoneySatang
  minStay: number | null
  maxStay: number | null
  stopSell: boolean
  closeToArrival: boolean
  closeToDeparture: boolean
  notes: string | null
  createdAt: string
  updatedAt: string
}

export type ServerEffectiveRate = {
  propertyId: string
  roomTypeId: string
  roomTypeCode: string
  date: string
  currency: string
  baseRateSatang: MoneySatang
  effectiveRateSatang: MoneySatang
  source: 'BASE' | 'RULES' | 'CALENDAR'
  appliedRules: Array<{
    id: string
    name: string
    priority: number
    adjustmentType: ServerRateRule['adjustmentType']
    beforeSatang: MoneySatang
    afterSatang: MoneySatang
  }>
  restrictions: {
    minStay: number | null
    maxStay: number | null
    stopSell: boolean
    closeToArrival: boolean
    closeToDeparture: boolean
  }
  sellable: boolean
  unsellableReasons: string[]
}

export type ServerRateRecommendation = {
  kind: 'RATE_RECOMMENDATION'
  propertyId: string
  roomTypeId: string
  date: string
  currentRateSatang: MoneySatang
  proposedRateSatang: MoneySatang
  differenceSatang: MoneySatang
  rationale: string
  suggestionOnly: true
  writePerformed: false
  requiresApproval: true
  providerPush: false
}

type CreateRuleInput = {
  name: string
  description?: string | null
  roomTypeId?: string | null
  priority: number
  startDate?: string | null
  endDate?: string | null
  daysOfWeek: number[]
  adjustmentType: ServerRateRule['adjustmentType']
  adjustmentSatang?: MoneySatang
  adjustmentBasisPoints?: number
  active: boolean
  reason: string
}

type CalendarWriteInput = {
  roomTypeId: string
  date: string
  rateSatang: MoneySatang
  minStay?: number | null
  maxStay?: number | null
  stopSell: boolean
  closeToArrival: boolean
  closeToDeparture: boolean
  notes?: string | null
  reason: string
}

function queryString(values: Record<string, string | number | boolean | null | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

function exactRate(value: unknown, label: string): MoneySatang {
  const text = String(value ?? '')
  if (!/^-?\d+$/.test(text)) throw new TypeError(`${label} exact satang is required.`)
  return text as MoneySatang
}

export const ratesApi = {
  async listRoomTypes(): Promise<ServerRateRoomType[]> {
    const payload = await pmsApi<{ ok: true; data: Array<{ roomType?: any }> }>('/api/rooms', null)
    const byId = new Map<string, ServerRateRoomType>()
    for (const room of payload.data) {
      const roomType = room.roomType
      if (!roomType?.id || byId.has(roomType.id)) continue
      byId.set(roomType.id, {
        id: String(roomType.id),
        code: String(roomType.code || roomType.id),
        name: String(roomType.name || roomType.code || roomType.id),
        baseRateSatang: exactRate(roomType.baseRateSatang, `room type ${roomType.id} base rate`),
      })
    }
    return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name))
  },

  async listRules(roomTypeId: string): Promise<ServerRateRule[]> {
    const payload = await pmsApi<{ ok: true; data: ServerRateRule[] }>(
      `/api/rates/rules${queryString({ roomTypeId })}`,
      null,
    )
    return payload.data
  },

  async createRule(input: CreateRuleInput): Promise<ServerRateRule> {
    const payload = await pmsApi<{ ok: true; data: ServerRateRule }>('/api/rates/rules', null, {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return payload.data
  },

  async updateRule(ruleId: string, input: { active: boolean; reason: string }): Promise<ServerRateRule> {
    const payload = await pmsApi<{ ok: true; data: ServerRateRule }>(
      `/api/rates/rules/${encodeURIComponent(ruleId)}`,
      null,
      { method: 'PATCH', body: JSON.stringify(input) },
    )
    return payload.data
  },

  async listCalendar(roomTypeId: string, startDate: string, endDate: string): Promise<ServerRateCalendarEntry[]> {
    const payload = await pmsApi<{ ok: true; data: ServerRateCalendarEntry[] }>(
      `/api/rates/calendar${queryString({ roomTypeId, startDate, endDate })}`,
      null,
    )
    return payload.data
  },

  async saveCalendar(input: CalendarWriteInput): Promise<ServerRateCalendarEntry> {
    const payload = await pmsApi<{ ok: true; data: ServerRateCalendarEntry }>('/api/rates/calendar', null, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
    return payload.data
  },

  async effective(roomTypeId: string, date: string): Promise<ServerEffectiveRate> {
    const payload = await pmsApi<{ ok: true; data: ServerEffectiveRate }>(
      `/api/rates/effective${queryString({ roomTypeId, date })}`,
      null,
    )
    return payload.data
  },

  async recommend(input: {
    roomTypeId: string
    date: string
    proposedRateSatang: MoneySatang
    rationale: string
  }): Promise<ServerRateRecommendation> {
    const payload = await pmsApi<{ ok: true; data: ServerRateRecommendation }>('/api/rates/recommendations', null, {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return payload.data
  },
}
