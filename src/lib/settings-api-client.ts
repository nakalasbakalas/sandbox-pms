import { pmsApi } from '@/lib/pms-api-client'
import type { MoneySatang } from '@/types/money'

export type ServerPropertyProfile = {
  name: string
  address?: string | null
  phone?: string | null
  email?: string | null
  publicWebsite?: string | null
  lineId?: string | null
  lineUrl?: string | null
  supportHours?: string | null
  reservationAlertEmail?: string | null
  timezone: string
  defaultCheckIn: string
  defaultCheckOut: string
  currency: string
}

export type ServerTaxItem = {
  id: string
  name: string
  rateBasisPoints: number
  appliesTo: 'ALL' | 'ROOM' | 'FOOD' | 'BEVERAGE' | 'EXTRAS'
  included: boolean
}

export type ServerPropertySettings = {
  propertyId: string
  code: string
  profile: ServerPropertyProfile
  fees: {
    extraGuestFeeSatang: MoneySatang
    childFeeSatang: MoneySatang
    inventoryMinimumRateSatang: MoneySatang | null
  }
  taxConfiguration: {
    enabled: boolean
    pricesIncludeTax: boolean
    rateBasisPoints: number
    taxes: ServerTaxItem[]
  }
  policies: Record<string, unknown>
  operationalSettings: Record<string, unknown>
  updatedAt: string
}

export type ServerSettingsStatus = {
  sourceOfTruth: 'server'
  generatedAt: string
  property: {
    id: string
    code: string
    name: string
    currency: string
    timezone: string
  }
  configuration: Record<string, 'configured' | 'incomplete' | 'disabled' | string>
  capabilities: Record<string, unknown>
}

export type PropertySettingsPatch = {
  reason: string
  profile?: Partial<ServerPropertyProfile>
  fees?: Partial<ServerPropertySettings['fees']>
}

export type TaxSettingsWrite = {
  reason: string
  enabled: boolean
  pricesIncludeTax: boolean
  taxes: ServerTaxItem[]
}

export const settingsApi = {
  async getProperty(): Promise<ServerPropertySettings> {
    const payload = await pmsApi<{ ok: true; data: ServerPropertySettings }>('/api/settings/property', null)
    return payload.data
  },

  async updateProperty(input: PropertySettingsPatch): Promise<ServerPropertySettings> {
    const payload = await pmsApi<{ ok: true; data: ServerPropertySettings }>('/api/settings/property', null, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
    return payload.data
  },

  async updateTax(input: TaxSettingsWrite): Promise<ServerPropertySettings> {
    const payload = await pmsApi<{ ok: true; data: ServerPropertySettings }>('/api/settings/tax', null, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
    return payload.data
  },

  async getStatus(): Promise<ServerSettingsStatus> {
    const payload = await pmsApi<{ ok: true; data: ServerSettingsStatus }>('/api/settings/status', null)
    return payload.data
  },
}
