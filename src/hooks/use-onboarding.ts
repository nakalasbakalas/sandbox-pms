import { useKV } from '@github/spark/hooks'
import { OnboardingState, PropertySetup, RoomTypeSetup, RoomSetup, RateSetup, UserSetup } from '@/types/onboarding'

const DEFAULT_PROPERTY: PropertySetup = {
  name: 'Sandbox Hotel',
  address: '',
  city: '',
  country: 'Thailand',
  phone: '',
  email: '',
  website: '',
  taxId: '',
  timeZone: 'Asia/Bangkok',
  currency: 'THB',
  defaultCheckIn: '14:00',
  defaultCheckOut: '11:00',
}

const DEFAULT_ROOM_TYPES: RoomTypeSetup[] = [
  {
    id: 'twin',
    name: 'Twin Room',
    baseOccupancy: 2,
    maxOccupancy: 3,
    extraGuestFee: 200,
    childFreeAge: 5,
    childFeeAge: 11,
    childFee: 100,
  },
  {
    id: 'double',
    name: 'Double Room',
    baseOccupancy: 2,
    maxOccupancy: 3,
    extraGuestFee: 200,
    childFreeAge: 5,
    childFeeAge: 11,
    childFee: 100,
  },
]

const generateDefaultRooms = (): RoomSetup[] => {
  const rooms: RoomSetup[] = []
  
  for (let i = 201; i <= 216; i++) {
    rooms.push({
      id: `twin-${i}`,
      number: i.toString(),
      roomTypeId: 'twin',
      status: i === 216 ? 'out-of-service' : 'available',
      notes: i === 216 ? 'Default out of service' : '',
    })
  }
  
  for (let i = 301; i <= 316; i++) {
    rooms.push({
      id: `double-${i}`,
      number: i.toString(),
      roomTypeId: 'double',
      status: i === 316 ? 'out-of-service' : 'available',
      notes: i === 316 ? 'Default out of service' : '',
    })
  }
  
  return rooms
}

const DEFAULT_RATES: RateSetup[] = [
  {
    roomTypeId: 'twin',
    baseRate: 2500,
    weekendRate: undefined,
    taxInclusive: true,
  },
  {
    roomTypeId: 'double',
    baseRate: 3200,
    weekendRate: undefined,
    taxInclusive: true,
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
    rooms: generateDefaultRooms(),
    rates: DEFAULT_RATES,
    adminUser: DEFAULT_USER,
  },
}

export function useOnboarding() {
  const [completed, setCompleted] = useKV<boolean>('onboarding:completed', false)
  const [state, setState] = useKV<OnboardingState>('onboarding:state', INITIAL_STATE)

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
      return {
        ...current,
        data: {
          ...current.data,
          roomTypes,
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
    await setCompleted(true)
    setState((current) => {
      if (!current) return INITIAL_STATE
      return { ...current, completed: true }
    })
  }

  const resetOnboarding = async () => {
    await setCompleted(false)
    setState(INITIAL_STATE)
  }

  return {
    completed,
    state,
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
