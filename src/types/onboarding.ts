export interface OnboardingState {
  completed: boolean
  currentStep: number
  data: {
    property: PropertySetup
    roomTypes: RoomTypeSetup[]
    rooms: RoomSetup[]
    rates: RateSetup[]
    adminUser: UserSetup
  }
}

export interface PropertySetup {
  name: string
  address: string
  city: string
  country: string
  phone: string
  email: string
  website?: string
  taxId?: string
  timeZone: string
  currency: string
  defaultCheckIn: string
  defaultCheckOut: string
  logoUrl?: string
  brandColor?: string
  receiptFooter?: string
  taxConfiguration?: TaxConfiguration
}

export interface TaxConfiguration {
  enabled: boolean
  pricesIncludeTax: boolean
  taxes: TaxRate[]
}

export interface TaxRate {
  id: string
  name: string
  rate: number
  appliesTo: 'ROOM' | 'FOOD' | 'BEVERAGE' | 'ALL' | 'EXTRAS'
  included: boolean
}

export interface RoomTypeSetup {
  id: string
  code?: string
  name: string
  baseRate?: number
  baseOccupancy: number
  maxOccupancy: number
  extraGuestFee: number
  childFreeAge: number
  childFeeAge: number
  childFee: number
}

export interface RoomSetup {
  id: string
  number: string
  roomTypeId: string
  floor?: number
  status: 'available' | 'out-of-service'
  notes?: string
}

export interface RateSetup {
  roomTypeId: string
  baseRate: number
  weekendRate?: number
  taxInclusive: boolean
}

export interface UserSetup {
  name: string
  email: string
  password: string
  confirmPassword?: string
  role: 'admin'
  phone?: string
}
