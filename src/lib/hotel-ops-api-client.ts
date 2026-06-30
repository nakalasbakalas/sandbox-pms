import type {
  HotelOpsApproval,
  HotelOpsCommandResult,
  HotelOpsEmergencyStop,
  HotelOpsNotification,
  HotelOpsOtaStatus,
  HotelOpsTask,
  HotelOpsTrendAlert,
} from '@/types/hotel-ops'

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || 'Request failed.')
  }
  return payload as T
}

function query(filters: Record<string, string | number | null | undefined> = {}) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  })
  const text = params.toString()
  return text ? `?${text}` : ''
}

export const hotelOpsApi = {
  submitCommand(message: string, sourceChannel = 'web') {
    return apiRequest<{ ok: true; data: HotelOpsCommandResult; message?: string }>('/api/ops/commands', {
      method: 'POST',
      body: JSON.stringify({ message, sourceChannel }),
    })
  },

  listTasks(filters: { status?: string; limit?: number } = {}) {
    return apiRequest<{ ok: true; data: HotelOpsTask[] }>(`/api/ops/tasks${query(filters)}`)
  },

  getTask(taskId: string) {
    return apiRequest<{ ok: true; data: HotelOpsTask }>(`/api/ops/tasks/${encodeURIComponent(taskId)}`)
  },

  approveTask(taskId: string, notes?: string) {
    return apiRequest<{ ok: true; data: HotelOpsTask; message?: string }>(`/api/ops/tasks/${encodeURIComponent(taskId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    })
  },

  denyTask(taskId: string, reason?: string) {
    return apiRequest<{ ok: true; data: HotelOpsTask; message?: string }>(`/api/ops/tasks/${encodeURIComponent(taskId)}/deny`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })
  },

  cancelTask(taskId: string, reason?: string) {
    return apiRequest<{ ok: true; data: HotelOpsTask; message?: string }>(`/api/ops/tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })
  },

  runTask(taskId: string) {
    return apiRequest<{ ok: true; data: HotelOpsTask; message?: string }>(`/api/ops/tasks/${encodeURIComponent(taskId)}/run`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
  },

  listApprovals() {
    return apiRequest<{ ok: true; data: HotelOpsApproval[] }>('/api/ops/approvals')
  },

  listNotifications(filters: { status?: string; channel?: string; limit?: number } = {}) {
    return apiRequest<{ ok: true; data: HotelOpsNotification[] }>(`/api/ops/notifications${query(filters)}`)
  },

  listAlerts(filters: { status?: string; limit?: number } = {}) {
    return apiRequest<{ ok: true; data: HotelOpsTrendAlert[] }>(`/api/ops/intelligence/alerts${query(filters)}`)
  },

  approveRecommendation(alertId: string) {
    return apiRequest<{ ok: true; data: HotelOpsCommandResult; message?: string }>(`/api/ops/intelligence/alerts/${encodeURIComponent(alertId)}/approve-recommendation`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
  },

  getEmergencyStop() {
    return apiRequest<{ ok: true; data: HotelOpsEmergencyStop }>('/api/ops/emergency-stop')
  },

  setEmergencyStop(enabled: boolean, reason?: string) {
    return apiRequest<{ ok: true; data: HotelOpsEmergencyStop; message?: string }>('/api/ops/emergency-stop', {
      method: 'POST',
      body: JSON.stringify({ enabled, reason }),
    })
  },

  getOtaStatus() {
    return apiRequest<{ ok: true; data: HotelOpsOtaStatus }>('/api/ops/ota/status')
  },

  runScan(force?: 'high-demand' | 'low-demand') {
    return apiRequest<{ ok: true; data: HotelOpsTrendAlert[]; message?: string }>('/api/ops/scan/run', {
      method: 'POST',
      body: JSON.stringify({ force }),
    })
  },
}
