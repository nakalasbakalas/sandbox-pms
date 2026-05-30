import { useEffect, useMemo, useState } from 'react'
import { useKV } from '@github/spark/hooks'
import type { User } from '@/types/auth'
import type { BoardRoomCard } from '@/types/board'
import type { OnboardingState, PropertySetup, RateSetup, RoomSetup, RoomTypeSetup, UserSetup } from '@/types/onboarding'
import { createPasswordSalt, hashPassword, type PasswordCredential } from '@/lib/auth-passwords'
import { SERVER_AUTH_ENABLED, normalizeAuthEmail } from '@/lib/auth-mode'
import { completeServerSetup, getServerSetupStatus, type ServerSetupStatus } from '@/lib/server-auth-client'

type StoredUser = User & PasswordCredential

const DEFAULT_PROPERTY: PropertySetup = {
  name: 'SANDBOX HOTEL',
  address: '626/1 Karom Rd., Pho Sadet',
  city: 'Mueang, Nakhon Si Thammarat 80000',
  country: 'Thailand',
  phone: '+66 88-578-3478',
  email: 'booking@sandboxhotel.com',
  website: 'https://www.sandboxhotel.com',
  taxId: '',
  timeZone: 'Asia/Bangkok',
  currency: 'THB',
  defaultCheckIn: '14:00',
  defaultCheckOut: '12:00',
  brandColor: '#2563eb',
  receiptFooter: '',
  taxConfiguration: {
    enabled: false,
    pricesIncludeTax: false,
    taxes: [],
  },
}

const DEFAULT_ROOM_TYPES: RoomTypeSetup[] = [
  {
    id: 'twin',
    code: 'TWIN',
    name: 'Standard Twin',
    baseRate: 2000,
    baseOccupancy: 2,
    maxOccupancy: 2,
    extraGuestFee: 300,
    childFreeAge: 5,
    childFeeAge: 11,
    childFee: 300,
  },
  {
    id: 'double',
    code: 'DOUBLE',
    name: 'Superior Double',
    baseRate: 2000,
    baseOccupancy: 2,
    maxOccupancy: 4,
    extraGuestFee: 300,
    childFreeAge: 5,
    childFeeAge: 11,
    childFee: 300,
  },
]

const DEFAULT_ROOMS: RoomSetup[] = [
  ...Array.from({ length: 11 }, (_, index) => ({
    id: `room-${201 + index}`,
    number: String(201 + index),
    roomTypeId: 'double',
    floor: 2,
    status: 'available' as const,
    notes: 'Owner clarified Superior Double rooms are the remaining non-twin room numbers.',
  })),
  ...Array.from({ length: 8 }, (_, index) => ({
    id: `room-${212 + index}`,
    number: String(212 + index),
    roomTypeId: 'twin',
    floor: 2,
    status: 'available' as const,
    notes: 'Confirmed Standard Twin inventory.',
  })),
  ...Array.from({ length: 6 }, (_, index) => ({
    id: `room-${301 + index}`,
    number: String(301 + index),
    roomTypeId: 'double',
    floor: 3,
    status: 'available' as const,
    notes: 'Owner clarified Superior Double rooms are the remaining non-twin room numbers.',
  })),
  ...Array.from({ length: 8 }, (_, index) => ({
    id: `room-${312 + index}`,
    number: String(312 + index),
    roomTypeId: 'twin',
    floor: 3,
    status: 'available' as const,
    notes: 'Confirmed Standard Twin inventory.',
  })),
]

const DEFAULT_RATES: RateSetup[] = [
  {
    roomTypeId: 'twin',
    baseRate: 2000,
    weekendRate: undefined,
    taxInclusive: false,
  },
  {
    roomTypeId: 'double',
    baseRate: 2000,
    weekendRate: undefined,
    taxInclusive: false,
  },
]

const DEFAULT_USER: UserSetup = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
  role: 'admin',
  phone: '',
}

const INITIAL_STATE: OnboardingState = {
  completed: false,
  currentStep: 1,
  data: {
    property: DEFAULT_PROPERTY,
    roomTypes: DEFAULT_ROOM_TYPES,
    rooms: DEFAULT_ROOMS,
    rates: DEFAULT_RATES,
    adminUser: DEFAULT_USER,
  },
}

function sanitizeCompletedState(state: OnboardingState): OnboardingState {
  return {
    ...state,
    completed: true,
    data: {
      ...state.data,
      adminUser: {
        ...state.data.adminUser,
        password: '',
        confirmPassword: '',
      },
    },
  }
}

function roomDisplayType(roomType: RoomTypeSetup | undefined, index: number): BoardRoomCard['type'] {
  const normalizedName = roomType?.name.toLowerCase() || ''
  if (roomType?.id === 'double' || normalizedName.includes('double') || index === 1) return 'DOUBLE'
  return 'TWIN'
}

function mapRoomsForBoard(roomTypes: RoomTypeSetup[], rooms: RoomSetup[]): BoardRoomCard[] {
  const roomTypeIndex = new Map(roomTypes.map((roomType, index) => [roomType.id, index]))
  const roomTypeById = new Map(roomTypes.map((roomType) => [roomType.id, roomType]))

  return rooms.map((room) => {
    const roomType = roomTypeById.get(room.roomTypeId)
    const index = roomTypeIndex.get(room.roomTypeId) ?? 0
    const floor = Number.parseInt(room.number.replace(/\D/g, '').charAt(0) || '1', 10)

    return {
      roomId: room.id,
      number: room.number,
      floor: Number.isFinite(floor) ? floor : 1,
      type: roomDisplayType(roomType, index),
      roomTypeId: room.roomTypeId,
      status: 'VACANT_CLEAN',
      operationalStatus: room.status === 'out-of-service' ? 'OUT_OF_SERVICE' : 'AVAILABLE',
      isArrivalToday: false,
      isDepartureToday: false,
      isVIP: false,
      hasIssue: false,
      needsAttention: false,
      cleanStatus: 'CLEAN',
      housekeepingStatus: 'CLEAN',
      depositStatus: 'NONE',
      notes: room.notes,
    }
  })
}

function rateConfigFromSetup(roomTypes: RoomTypeSetup[], rates: RateSetup[]) {
  return roomTypes.map((roomType) => ({
    id: roomType.id,
    code: roomType.code,
    name: roomType.name,
    baseRate: rates.find((rate) => rate.roomTypeId === roomType.id)?.baseRate || 0,
    baseOccupancy: roomType.baseOccupancy,
    maxOccupancy: roomType.maxOccupancy,
    extraGuestFee: roomType.extraGuestFee,
    childFee: roomType.childFee,
  }))
}

function validateSetupData(data: OnboardingState['data']) {
  const property = data.property
  const adminUser = data.adminUser

  if (!property.name.trim()) throw new Error('Property name is required.')
  if (!property.email.trim()) throw new Error('Property email is required.')
  if (!property.phone.trim()) throw new Error('Property phone is required.')
  if (!property.country.trim()) throw new Error('Country is required.')
  if (data.roomTypes.length === 0) throw new Error('Add at least one room type.')
  if (data.rooms.length === 0) throw new Error('Add at least one room.')
  if (data.rates.some((rate) => !Number.isFinite(Number(rate.baseRate)) || Number(rate.baseRate) <= 0)) {
    throw new Error('Each room type needs a base rate greater than zero.')
  }
  if (!adminUser.name.trim()) throw new Error('Admin name is required.')
  if (!normalizeAuthEmail(adminUser.email)) throw new Error('Admin email is required.')
  if (adminUser.password.length < 12) throw new Error('Admin password must be at least 12 characters.')
  if (adminUser.password !== adminUser.confirmPassword) throw new Error('Admin passwords do not match.')
}

export function useOnboarding() {
  const [completed, setCompleted] = useKV<boolean>('onboarding:completed', false)
  const [state, setState] = useKV<OnboardingState>('onboarding:state', INITIAL_STATE)
  const [propertyData, setPropertyData] = useKV<PropertySetup>('onboarding-property', DEFAULT_PROPERTY)
  const [roomTypesData, setRoomTypesData] = useKV<RoomTypeSetup[]>('onboarding-room-types', [])
  const [roomsData, setRoomsData] = useKV<RoomSetup[]>('onboarding-rooms', [])
  const [ratesData, setRatesData] = useKV<RateSetup[]>('onboarding-rates', [])
  const [, setBoardRooms] = useKV<BoardRoomCard[]>('pms-rooms', [])
  const [, setRateRoomTypes] = useKV<Array<{ id: string; name: string; baseRate: number }>>('room-types-config', [])
  const [customUsers, setCustomUsers] = useKV<StoredUser[]>('system:users', [])
  const [serverSetupStatus, setServerSetupStatus] = useState<ServerSetupStatus | null>(SERVER_AUTH_ENABLED ? null : {
    needsSetup: false,
    hasProperty: true,
    hasUsers: true,
  })
  const [setupError, setSetupError] = useState<string | null>(null)

  useEffect(() => {
    if (!SERVER_AUTH_ENABLED) return

    let cancelled = false
    getServerSetupStatus()
      .then((status) => {
        if (!cancelled) setServerSetupStatus(status)
      })
      .catch((error) => {
        if (!cancelled) setSetupError(error instanceof Error ? error.message : String(error))
      })

    return () => {
      cancelled = true
    }
  }, [])

  const localSetupComplete = useMemo(() => {
    if (completed || state?.completed) return true
    if (SERVER_AUTH_ENABLED) return false

    const hasProperty = Boolean(propertyData?.name?.trim() && propertyData?.email?.trim())
    const hasInventory = (roomTypesData || []).length > 0 && (roomsData || []).length > 0 && (ratesData || []).length > 0
    const hasLoginUser = (customUsers || []).some((user) =>
      Boolean(normalizeAuthEmail(user.email || user.username) && user.passwordHash && user.passwordSalt)
    )

    return hasProperty && hasInventory && hasLoginUser
  }, [completed, customUsers, propertyData, ratesData, roomTypesData, roomsData, state?.completed])

  useEffect(() => {
    if (SERVER_AUTH_ENABLED || !localSetupComplete || completed) return
    setCompleted(true)
  }, [completed, localSetupComplete, setCompleted])

  const setupRequired = useMemo(() => {
    if (SERVER_AUTH_ENABLED) return Boolean(serverSetupStatus?.needsSetup)
    return !localSetupComplete
  }, [localSetupComplete, serverSetupStatus?.needsSetup])

  const setupStatusReady = !SERVER_AUTH_ENABLED || Boolean(serverSetupStatus) || Boolean(setupError)

  const goToStep = (step: number) => {
    setState((current) => {
      if (!current) return INITIAL_STATE
      return { ...current, currentStep: step }
    })
  }

  const nextStep = () => {
    setState((current) => {
      if (!current) return INITIAL_STATE
      return { ...current, currentStep: current.currentStep + 1 }
    })
  }

  const prevStep = () => {
    setState((current) => {
      if (!current) return INITIAL_STATE
      return { ...current, currentStep: Math.max(1, current.currentStep - 1) }
    })
  }

  const updateProperty = (property: Partial<PropertySetup>) => {
    setState((current) => {
      if (!current) return INITIAL_STATE
      return {
        ...current,
        data: {
          ...current.data,
          property: { ...current.data.property, ...property },
        },
      }
    })
  }

  const updateRoomTypes = (roomTypes: RoomTypeSetup[]) => {
    setState((current) => {
      if (!current) return INITIAL_STATE
      const roomTypeIds = new Set(roomTypes.map((roomType) => roomType.id))
      const nextRates = roomTypes.map((roomType) =>
        current.data.rates.find((rate) => rate.roomTypeId === roomType.id) || {
          roomTypeId: roomType.id,
          baseRate: 0,
          taxInclusive: true,
        },
      )

      return {
        ...current,
        data: {
          ...current.data,
          roomTypes,
          rooms: current.data.rooms.filter((room) => roomTypeIds.has(room.roomTypeId)),
          rates: nextRates,
        },
      }
    })
  }

  const updateRooms = (rooms: RoomSetup[]) => {
    setState((current) => {
      if (!current) return INITIAL_STATE
      return {
        ...current,
        data: {
          ...current.data,
          rooms,
        },
      }
    })
  }

  const updateRates = (rates: RateSetup[]) => {
    setState((current) => {
      if (!current) return INITIAL_STATE
      return {
        ...current,
        data: {
          ...current.data,
          rates,
        },
      }
    })
  }

  const updateAdminUser = (user: Partial<UserSetup>) => {
    setState((current) => {
      if (!current) return INITIAL_STATE
      return {
        ...current,
        data: {
          ...current.data,
          adminUser: { ...current.data.adminUser, ...user },
        },
      }
    })
  }

  const completeOnboarding = async () => {
    const currentState = state || INITIAL_STATE
    validateSetupData(currentState.data)

    if (SERVER_AUTH_ENABLED) {
      await completeServerSetup(currentState.data)
      setServerSetupStatus({
        needsSetup: false,
        hasProperty: true,
        hasUsers: true,
        propertyName: currentState.data.property.name,
      })
    } else {
      const email = normalizeAuthEmail(currentState.data.adminUser.email)
      const passwordSalt = createPasswordSalt()
      const passwordHash = await hashPassword(currentState.data.adminUser.password, passwordSalt)
      const adminUser: StoredUser = {
        id: `user-${Date.now()}`,
        email,
        username: email,
        role: 'admin',
        displayName: currentState.data.adminUser.name.trim(),
        createdAt: new Date().toISOString(),
        passwordSalt,
        passwordHash,
      }

      setCustomUsers((current) => [
        ...(current || []).filter((user) => normalizeAuthEmail(user.email || user.username) !== email),
        adminUser,
      ])
    }

    setPropertyData(currentState.data.property)
    setRoomTypesData(currentState.data.roomTypes)
    setRoomsData(currentState.data.rooms)
    setRatesData(currentState.data.rates)
    setBoardRooms(mapRoomsForBoard(currentState.data.roomTypes, currentState.data.rooms))
    setRateRoomTypes(rateConfigFromSetup(currentState.data.roomTypes, currentState.data.rates))
    setCompleted(true)
    setState(sanitizeCompletedState(currentState))
  }

  const resetOnboarding = async () => {
    setCompleted(false)
    setState(INITIAL_STATE)
  }

  return {
    completed,
    state,
    setupRequired,
    setupStatusReady,
    setupError,
    serverSetupStatus,
    customUsers,
    goToStep,
    nextStep,
    prevStep,
    updateProperty,
    updateRoomTypes,
    updateRooms,
    updateRates,
    updateAdminUser,
    completeOnboarding,
    resetOnboarding,
  }
}
