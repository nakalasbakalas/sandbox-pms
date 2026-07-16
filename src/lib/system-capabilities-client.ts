import { pmsApi } from '@/lib/pms-api-client'
import type { SystemCapabilityRegistry } from '@/types/system-capabilities'

export async function getSystemCapabilityRegistry(): Promise<SystemCapabilityRegistry> {
  const payload = await pmsApi<{ ok: true; data: SystemCapabilityRegistry }>('/api/system/capabilities', null)
  return payload.data
}
