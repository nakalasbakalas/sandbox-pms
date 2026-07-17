import { useEffect, useState } from 'react'
import { getSystemCapabilityRegistry } from '@/lib/system-capabilities-client'
import { SERVER_API_ENABLED } from '@/lib/pms-api-client'
import type { SystemCapability, SystemCapabilityRegistry } from '@/types/system-capabilities'

type CapabilityState = {
  registry: SystemCapabilityRegistry | null
  loading: boolean
  error: string | null
}

export function capabilityEnabled(capability: SystemCapability | undefined) {
  return Boolean(capability && capability.status !== 'disabled' && capability.writeMode !== 'disabled')
}

export function useSystemCapabilities(): CapabilityState {
  const [state, setState] = useState<CapabilityState>({
    registry: null,
    loading: SERVER_API_ENABLED,
    error: null,
  })

  useEffect(() => {
    if (!SERVER_API_ENABLED) {
      setState({ registry: null, loading: false, error: null })
      return
    }

    let cancelled = false
    void getSystemCapabilityRegistry()
      .then((registry) => {
        if (!cancelled) setState({ registry, loading: false, error: null })
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            registry: null,
            loading: false,
            error: error instanceof Error ? error.message : 'Capability status is unavailable.',
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  return state
}
