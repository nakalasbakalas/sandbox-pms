import type {
  BoardPayload,
  BookingPage,
  ChannelDeskPayload,
  FrontDeskPayload,
  HousekeepingPayload,
  LiteUser,
  ManualChannelConnection,
  ReservationSummary,
  VersionPayload,
} from './types'

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

  async createReservation(input: Record<string, unknown>) {
    return (await request<ApiEnvelope<ReservationSummary>>('/api/reservations', {
      method: 'POST',
      body: JSON.stringify(input),
    })).data
  },

  async updateReservation(id: string, input: Record<string, unknown>) {
    return (await request<ApiEnvelope<ReservationSummary>>(`/api/reservations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })).data
  },

  async reservationAction(id: string, action: 'check-in' | 'check-out' | 'cancel' | 'no-show' | 'assign-room', input: Record<string, unknown> = {}) {
    return (await request<ApiEnvelope<ReservationSummary>>(`/api/reservations/${encodeURIComponent(id)}/${action}`, {
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

  async completeChannelTask(id: string, revision: number, confirmedAvailability: number, completionNotes?: string) {
    return (await request<ApiEnvelope<unknown>>(`/api/lite/v1/channel-tasks/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      body: JSON.stringify({ revision, confirmedAvailability, completionNotes }),
    })).data
  },

  async saveConnection(providerCode: string, input: Partial<ManualChannelConnection> & { reason: string }) {
    return (await request<ApiEnvelope<ManualChannelConnection>>(`/api/lite/v1/channels/connections/${encodeURIComponent(providerCode)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })).data
  },
}
