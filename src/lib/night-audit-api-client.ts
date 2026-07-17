import { pmsApi } from '@/lib/pms-api-client'
import type { MoneySatang } from '@/types/money'

export type NightAuditStatus = 'RUNNING' | 'BLOCKED' | 'COMPLETED' | 'FAILED'

export interface NightAuditBlocker {
  code: string
  count: number
  overridable: boolean
}

export interface NightAuditSnapshot {
  unresolvedArrivals: number
  unresolvedDepartures: number
  inHouseReservations: number
  openFolios: number
  housekeepingBlockers: number
  unpostedRoomCharges: number
  chargesTotalSatang: MoneySatang
  paymentsTotalSatang: MoneySatang
  balanceTotalSatang: MoneySatang
}

export interface NightAuditRun {
  runId: string
  businessDate: string
  status: NightAuditStatus
  postingMode: 'VERIFY_EXISTING_CHARGES_ONLY'
  blockers: NightAuditBlocker[]
  overrideApplied: boolean
  snapshot: NightAuditSnapshot
  completedAt: string | null
  idempotentReplay?: boolean
  businessDateAlreadyClosed?: boolean
  overrideRejectedBy?: string[]
}

export interface CloseNightAuditInput {
  businessDate: string
  idempotencyKey: string
  reason: string
  overrideBlockers: boolean
  overrideReason?: string
}

export const nightAuditApi = {
  listRuns(limit = 30) {
    return pmsApi<{ ok: true; data: NightAuditRun[] }>(`/api/night-audit/runs?limit=${limit}`, null)
  },

  close(input: CloseNightAuditInput) {
    return pmsApi<{ ok: true; data: NightAuditRun; message?: string }>('/api/night-audit/close', null, {
      method: 'POST',
      headers: { 'x-idempotency-key': input.idempotencyKey },
      body: JSON.stringify(input),
    })
  },
}
