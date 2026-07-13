import type {
  BoardPayload,
  BookingPage,
  ChannelDeskPayload,
  FrontDeskPayload,
  HousekeepingPayload,
  LiteUser,
  ManualChannelConnection,
  ManualChannelMapping,
  ManualChannelProviderCode,
  ManualChannelReconcileResult,
  ManualChannelTask,
  MoneySatang,
  ReservationSummary,
  SaveManualChannelConnectionInput,
  SaveManualChannelMappingInput,
  VersionPayload,
} from './types'

export type LiteReservationWrite = {
  checkIn: string
  checkOut: string
  roomTypeCode: string
  adults: number
  children: number
  childAges: number[]
  ratePerNightSatang: MoneySatang
  guest?: Record<string, unknown>
  source?: string
  assignedRoomId?: string
  expectedUpdatedAt?: string | null
}

type ApiEnvelope<T> = { ok: true; data: T; message?: string }

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(payload?.error || `Request failed (${response.status}).`, response.status)
  return payload as T
}

function query(path: string, values: Record<string, string | number | undefined | null>) {
  const url = new URL(path, window.location.origin)
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }
  return `${url.pathname}${url.search}`
}

function assertMoneySatang(value: unknown, label: string): asserts value is MoneySatang {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new ApiError(`${label} must be a whole number of satang.`, 400)
  }
}

function assertNoLegacyMoney(input: Record<string, unknown>, legacyField: string, satangField: string, required = false) {
  if (Object.hasOwn(input, legacyField)) {
    throw new ApiError(`PMS Lite writes ${satangField}; ${legacyField} is not accepted.`, 400)
  }
  if (required || Object.hasOwn(input, satangField)) assertMoneySatang(input[satangField], satangField)
}

function utcDateKey(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError(`${label} must use YYYY-MM-DD.`, 400)
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ApiError(`${label} must be a real calendar date.`, 400)
  }
  return parsed
}

function nextUtcDateKey(value: string) {
  const date = utcDateKey(value, 'End date')
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

export function thbInputToSatang(value: string, label = 'Amount'): MoneySatang {
  const normalized = String(value || '').trim()
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized)
  if (!match) throw new ApiError(`${label} must use no more than two decimal places.`, 400)
  const satang = (BigInt(match[1]) * 100n) + BigInt((match[2] || '').padEnd(2, '0') || '0')
  if (satang > 2_147_483_647n) throw new ApiError(`${label} is outside the supported range.`, 400)
  return Number(satang)
}

export const liteApi = {
  async me() {
    const result = await request<{ ok: true; user: LiteUser }>('/api/auth/me')
    return result.user
  },

  async login(identity: string, password: string) {
    const result = await request<{ ok: true; user: LiteUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identity, password }),
    })
    return result.user
  },

  async logout() {
    await request('/api/auth/logout', { method: 'POST' })
  },

  async version() {
    return (await request<ApiEnvelope<VersionPayload>>('/api/version')).data
  },

  async frontDesk(date: string) {
    return (await request<ApiEnvelope<FrontDeskPayload>>(query('/api/lite/v1/front-desk', { date }))).data
  },

  async bookings(filters: Record<string, string | number | undefined | null>) {
    return (await request<ApiEnvelope<BookingPage>>(query('/api/lite/v1/bookings', filters))).data
  },

  async board(from: string, to: string) {
    return (await request<ApiEnvelope<BoardPayload>>(query('/api/lite/v1/board', { from, to }))).data
  },

  async housekeeping(date: string) {
    return (await request<ApiEnvelope<HousekeepingPayload>>(query('/api/lite/v1/housekeeping', { date }))).data
  },

  async channelDesk() {
    return (await request<ApiEnvelope<ChannelDeskPayload>>('/api/lite/v1/channel-desk')).data
  },

  async users() {
    return (await request<ApiEnvelope<Array<LiteUser>>>('/api/users')).data
  },

  async createReservation(input: LiteReservationWrite) {
    assertNoLegacyMoney(input, 'ratePerNight', 'ratePerNightSatang', true)
    return (await request<ApiEnvelope<ReservationSummary>>('/api/reservations', {
      method: 'POST',
      body: JSON.stringify(input),
    })).data
  },

  async updateReservation(id: string, input: Partial<LiteReservationWrite>) {
    assertNoLegacyMoney(input, 'ratePerNight', 'ratePerNightSatang')
    return (await request<ApiEnvelope<ReservationSummary>>(`/api/reservations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })).data
  },

  async reservationAction(id: string, action: 'check-in' | 'check-out' | 'cancel' | 'no-show' | 'assign-room', input: Record<string, unknown> = {}) {
    const payment = input.payment
    if (payment && typeof payment === 'object' && !Array.isArray(payment)) {
      assertNoLegacyMoney(payment as Record<string, unknown>, 'amount', 'amountSatang', true)
    }
    return (await request<ApiEnvelope<ReservationSummary>>(`/api/reservations/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      body: JSON.stringify(input),
    })).data
  },

  async createCharge(input: { folioId: string; description: string; category: string; amountSatang: MoneySatang; quantity: number; date?: string }) {
    assertNoLegacyMoney(input, 'amount', 'amountSatang', true)
    return (await request<ApiEnvelope<unknown>>('/api/charges', {
      method: 'POST',
      body: JSON.stringify(input),
    })).data
  },

  async createPayment(input: { folioId: string; amountSatang: MoneySatang; method: string; reference?: string; notes?: string }) {
    assertNoLegacyMoney(input, 'amount', 'amountSatang', true)
    return (await request<ApiEnvelope<unknown>>('/api/payments', {
      method: 'POST',
      body: JSON.stringify(input),
    })).data
  },

  async updateHousekeeping(roomId: string, status: string, notes?: string) {
    return (await request<ApiEnvelope<unknown>>(`/api/housekeeping/rooms/${encodeURIComponent(roomId)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, notes }),
    })).data
  },

  async approveEmailEvent(id: string, input: Record<string, unknown>) {
    return (await request<ApiEnvelope<unknown>>(`/api/booking-email/events/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: JSON.stringify(input),
    })).data
  },

  async rejectEmailEvent(id: string, reason: string) {
    return (await request<ApiEnvelope<unknown>>(`/api/booking-email/events/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })).data
  },

  async reprocessEmailEvent(id: string) {
    return (await request<ApiEnvelope<unknown>>(`/api/booking-email/events/${encodeURIComponent(id)}/reprocess`, {
      method: 'POST',
      body: JSON.stringify({}),
    })).data
  },

  async completeChannelTask(id: string, revision: number, confirmedAvailability: number, completionNotes?: string) {
    return (await request<ApiEnvelope<unknown>>(`/api/lite/v1/channel-tasks/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      body: JSON.stringify({ revision, confirmedAvailability, completionNotes }),
    })).data
  },

  async saveConnection(providerCode: ManualChannelProviderCode, input: SaveManualChannelConnectionInput) {
    return (await request<ApiEnvelope<ManualChannelConnection>>(`/api/lite/v1/channels/connections/${encodeURIComponent(providerCode)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })).data
  },

  async saveChannelMapping(input: SaveManualChannelMappingInput) {
    return (await request<ApiEnvelope<ManualChannelMapping>>('/api/lite/v1/channels/mappings', {
      method: 'POST',
      body: JSON.stringify(input),
    })).data
  },

  async reconcileChannelTasks(input: { from: string; through: string; roomTypeIds: string[]; reason: string }) {
    const start = utcDateKey(input.from, 'Start date')
    const end = utcDateKey(input.through, 'End date')
    const dayCount = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
    if (dayCount < 1 || dayCount > 90) throw new ApiError('Reconciliation must cover between 1 and 90 stay dates.', 400)
    if (input.roomTypeIds.length === 0) throw new ApiError('At least one physical room type is required.', 400)
    return (await request<ApiEnvelope<ManualChannelReconcileResult>>('/api/lite/v1/channel-tasks/reconcile', {
      method: 'POST',
      body: JSON.stringify({
        reason: input.reason,
        triggerType: 'MANUAL_RECONCILIATION',
        affected: [...new Set(input.roomTypeIds)].map((roomTypeId) => ({
          roomTypeId,
          dateStart: input.from,
          dateEnd: nextUtcDateKey(input.through),
        })),
      }),
    })).data
  },

  async reopenChannelTask(id: string, reason: string) {
    return (await request<ApiEnvelope<ManualChannelTask>>(`/api/lite/v1/channel-tasks/${encodeURIComponent(id)}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })).data
  },
}
