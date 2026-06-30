import { PrismaClient, type RoomType, type UserRole } from '@prisma/client'
import { pbkdf2Sync, randomBytes } from 'node:crypto'

const prisma = new PrismaClient()

type SeedMode = 'dev' | 'e2e' | 'prod-safe'

type SeedUser = {
  email: string
  username?: string
  firstName: string
  lastName: string
  role: UserRole
  password?: string
  passwordHash?: string
}

const propertySeed = {
  code: 'SANDBOX',
  name: 'SANDBOX HOTEL',
  address: '626/1 Karom Rd., Pho Sadet, Mueang, Nakhon Si Thammarat 80000, Thailand',
  phone: '+66 88-578-3478',
  email: 'booking@sandboxhotel.com',
  publicWebsite: 'https://www.sandboxhotel.com',
  lineId: null,
  lineUrl: null,
  supportHours: null,
  reservationAlertEmail: 'booking@sandboxhotel.com',
  timezone: 'Asia/Bangkok',
  defaultCheckIn: '14:00',
  defaultCheckOut: '12:00',
  currency: 'THB',
  taxRate: 0,
  extraGuestFee: 300,
  childFee: 300,
  inventoryMinimumRate: 550,
  taxConfiguration: {
    enabled: false,
    pricesIncludeTax: false,
    taxes: [],
    notes: [
      'No taxes are configured for the property.',
      'Show rates including tax and service charge was available but unchecked in the source system.',
    ],
  },
  policies: {
    checkInWindow: '14:00-22:00',
    checkOutWindow: '06:00-12:00',
    defaultCheckIn: '14:00',
    defaultCheckOut: '12:00',
    smoking: 'Non-smoking rooms.',
    cancellation: 'Unavailable in supplied source data.',
    deposit: 'Unavailable in supplied source data.',
    noShow: 'Unavailable in supplied source data.',
    childPolicy: 'Unavailable beyond the extra adult/child charge in room/rate configuration.',
  },
  operationalSettings: {
    rates: {
      currency: 'THB',
      plans: [{ code: 'ROOM_ONLY', name: 'Room Only' }],
      notes: [
        'Standard Twin / Room Only full rate is THB 2,000 and minimum rate is THB 550.',
        'Superior Double / Room Only is derived from Standard Twin / Room Only in the source system.',
      ],
    },
    paymentMethods: {
      enabledCards: [
        { name: 'Visa', surchargePercent: 0 },
        { name: 'Mastercard', surchargePercent: 0 },
      ],
      disabledCards: ['AmEx', 'DinersClub', 'Discover', 'JCB', 'UnionPay'],
      paymentGatewayConfigured: false,
    },
    accounting: {
      exportDateFormat: 'DD/MM/YYYY',
      taxIdentifiersConfigured: false,
      accountingMappingsConfigured: false,
    },
    staff: [
      { displayName: 'Tanyatorn', shortName: 'Owner', title: 'Owner', role: 'ADMIN', active: true, email: 'tanyatorn.sup@gmail.com', notes: 'Seeded as an active owner/admin login user when SEED_USERS_JSON is configured.' },
      { displayName: 'Neeq', shortName: 'Superior Admin', title: 'Superior Admin', role: 'ADMIN', active: true, email: 'nakalastravels@gmail.com', notes: 'Seeded as an active superior admin login user when SEED_USERS_JSON is configured.' },
      { displayName: 'HM', shortName: 'HM', title: 'Hotel Manager', role: 'MANAGER', active: true, email: null, notes: 'No password or email supplied; not created as a login user by seed.' },
      { displayName: 'HK1', shortName: 'HK1', title: 'Housekeeper 1', role: 'HOUSEKEEPING', active: true, email: null, notes: 'No password or email supplied; not created as a login user by seed.' },
      { displayName: 'HK2', shortName: 'HK2', title: 'Housekeeper 2', role: 'HOUSEKEEPING', active: true, email: null, notes: 'No password or email supplied; not created as a login user by seed.' },
      { displayName: 'HK3', shortName: 'HK3', title: 'Housekeeper 3', role: 'HOUSEKEEPING', active: true, email: null, notes: 'No password or email supplied; not created as a login user by seed.' },
      { displayName: 'HK4', shortName: 'HK4', title: 'Housekeeper 4', role: 'HOUSEKEEPING', active: true, email: null, notes: 'No password or email supplied; not created as a login user by seed.' },
      { displayName: 'FD', shortName: 'FD', title: 'Frontdesk', role: 'FRONT_DESK', active: true, email: null, notes: 'No password or email supplied; not created as a login user by seed.' },
    ],
    operations: {
      baseLanguage: 'English',
      alertRecipients: ['booking@sandboxhotel.com'],
      noOverbooking: true,
      superiorDoubleUnnumberedInventoryCount: 0,
    },
    unavailableItems: [
      'Live reservations and guest identities',
      'Payment records and folios',
      'Room closure room numbers and full out-of-service periods',
      'Login emails and credentials for HM, HK1, HK2, HK3, HK4, and FD',
    ],
  },
  sourceNotes: {
    authority: 'Pasted updated PMS migration data summary supplied on 2026-05-30 plus owner clarification for Double rooms and staff labels.',
    importStance: 'Staging/local import first. Do not production-import until missing live operational data is supplied and reconciled.',
    doubleRoomInference: 'Superior Double rooms are assigned to the first 17 non-twin room numbers in the current physical numbering sequence: 201-211 and 301-306.',
  },
}

const roomTypeSeeds = [
  {
    code: 'TWIN',
    name: 'Standard Twin',
    description: '2 single beds, 28 m2, mountain view, non-smoking. Amenities include TV, Wi-Fi, air-conditioning, and bathroom.',
    baseRate: 2000,
    maxOccupancy: 2,
    standardOcc: 2,
  },
  {
    code: 'DOUBLE',
    name: 'Superior Double',
    description: '1 double bed, 28 m2, non-smoking. Amenities include TV, Wi-Fi, air-conditioning, and bathroom.',
    baseRate: 2000,
    maxOccupancy: 4,
    standardOcc: 2,
  },
]

const passwordEnvByRole: Record<UserRole, string | undefined> = {
  ADMIN: process.env.SEED_ADMIN_PASSWORD,
  MANAGER: process.env.SEED_MANAGER_PASSWORD,
  FRONT_DESK: process.env.SEED_FRONT_DESK_PASSWORD,
  HOUSEKEEPING: process.env.SEED_HOUSEKEEPING_PASSWORD,
  CASHIER: process.env.SEED_CASHIER_PASSWORD,
  CAFE_STAFF: process.env.SEED_CAFE_STAFF_PASSWORD,
}

const validUserRoles: readonly UserRole[] = [
  'ADMIN',
  'MANAGER',
  'FRONT_DESK',
  'HOUSEKEEPING',
  'CASHIER',
  'CAFE_STAFF',
]

const legacyBootstrapEmails = [
  'admin@sandboxhotel.co.th',
  'admin@sandboxhotel.local',
  'manager@sandboxhotel.local',
  'frontdesk@sandboxhotel.local',
  'housekeeping@sandboxhotel.local',
  'cashier@sandboxhotel.local',
]

const productionLikeMarkers = [
  'prod',
  'production',
  'live',
  'sandbox-hotel-pms-db-v43m',
  'sandbox_hotel_pms',
]

function resolveSeedMode(): SeedMode {
  const mode = process.env.SEED_MODE?.trim()
  if (!mode) return process.env.NODE_ENV === 'production' ? 'prod-safe' : 'dev'
  if (mode === 'dev' || mode === 'e2e' || mode === 'prod-safe') return mode
  throw new Error('SEED_MODE must be one of: dev, e2e, prod-safe.')
}

function databaseUrlLooksProductionLike(value: string | undefined) {
  const normalized = String(value || '').toLowerCase()
  return productionLikeMarkers.some((marker) => normalized.includes(marker))
}

function assertSafeSeedMode(mode: SeedMode) {
  if (process.env.NODE_ENV === 'production' && mode !== 'prod-safe') {
    throw new Error('Production environments must run seed with SEED_MODE=prod-safe.')
  }

  if (mode !== 'prod-safe' && databaseUrlLooksProductionLike(process.env.DATABASE_URL)) {
    throw new Error('Refusing to run dev/e2e seed against a production-like DATABASE_URL.')
  }
}

function createPasswordHash(password: string) {
  if (password.length < 12) {
    throw new Error('Seed user passwords must be at least 12 characters.')
  }

  const iterations = 310_000
  const salt = randomBytes(16).toString('hex')
  const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex')
  return `pbkdf2_sha256$${iterations}$${salt}$${hash}`
}

function normalizeSeedEmail(value: unknown) {
  const email = String(value || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Seed user email must be a valid email address.')
  }
  return email
}

function normalizeSeedUsername(value: unknown, fallbackEmail: string) {
  const username = String(value || fallbackEmail || '').trim().toLowerCase()
  if (!username) throw new Error('Seed user username is required.')
  if (username.includes('@')) return normalizeSeedEmail(username)
  if (!/^[a-z0-9][a-z0-9._-]{1,62}$/.test(username)) {
    throw new Error('Seed user username must be 2-63 characters using letters, numbers, dot, dash, or underscore.')
  }
  return username
}

function normalizeSeedText(value: unknown, label: string) {
  const text = String(value || '').trim()
  if (!text) throw new Error(`${label} is required for each seed user.`)
  return text
}

function normalizeSeedRole(value: unknown) {
  const role = String(value || '').trim().toUpperCase().replaceAll('-', '_')
  if (!validUserRoles.includes(role as UserRole)) {
    throw new Error(`Seed user role must be one of: ${validUserRoles.join(', ')}.`)
  }
  return role as UserRole
}

function looksLikePasswordHash(value: string) {
  const [algorithm, iterationsText, salt, hash] = value.split('$')
  const iterations = Number(iterationsText)
  return algorithm === 'pbkdf2_sha256' &&
    Number.isInteger(iterations) &&
    iterations >= 100_000 &&
    Boolean(salt) &&
    /^[0-9a-f]+$/i.test(hash || '')
}

function parseSeedUsersJson() {
  const raw = process.env.SEED_USERS_JSON?.trim()
  if (!raw) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('SEED_USERS_JSON must be valid JSON.')
  }

  if (!Array.isArray(parsed)) {
    throw new Error('SEED_USERS_JSON must be a JSON array.')
  }

  return parsed.map((entry, index): SeedUser => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`SEED_USERS_JSON[${index}] must be an object.`)
    }

    const seed = entry as Record<string, unknown>
    const password = String(seed.password || '').trim() || undefined
    const passwordHash = String(seed.passwordHash || '').trim() || undefined

    if (!password && !passwordHash) {
      throw new Error(`SEED_USERS_JSON[${index}] requires passwordHash or password.`)
    }

    if (passwordHash && !looksLikePasswordHash(passwordHash)) {
      throw new Error(`SEED_USERS_JSON[${index}].passwordHash is not a supported PBKDF2 hash.`)
    }

    const email = normalizeSeedEmail(seed.email)

    return {
      email,
      username: normalizeSeedUsername(seed.username, email),
      firstName: normalizeSeedText(seed.firstName, `SEED_USERS_JSON[${index}].firstName`),
      lastName: normalizeSeedText(seed.lastName, `SEED_USERS_JSON[${index}].lastName`),
      role: normalizeSeedRole(seed.role),
      password,
      passwordHash,
    }
  })
}

function configuredPasswordHashFor(user: SeedUser) {
  if (user.passwordHash) return user.passwordHash
  if (user.password) return createPasswordHash(user.password)

  if (user.role === 'ADMIN') {
    if (process.env.SEED_ADMIN_PASSWORD_HASH) return process.env.SEED_ADMIN_PASSWORD_HASH
    if (process.env.SEED_USER_PASSWORD_HASH) return process.env.SEED_USER_PASSWORD_HASH
  }

  const password = passwordEnvByRole[user.role]
  return password ? createPasswordHash(password) : undefined
}

function legacyUsersForMode(mode: SeedMode) {
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim()
  const hasAdminCredential = Boolean(
    process.env.SEED_ADMIN_PASSWORD_HASH ||
    process.env.SEED_USER_PASSWORD_HASH ||
    process.env.SEED_ADMIN_PASSWORD,
  )

  if (mode !== 'prod-safe') {
    if (!adminEmail || !hasAdminCredential) return []
    return [{ email: adminEmail, firstName: 'Admin', lastName: 'User', role: 'ADMIN' }]
  }

  if (!hasAdminCredential) return []
  if (!adminEmail) {
    throw new Error('SEED_ADMIN_EMAIL is required when prod-safe seed creates a bootstrap admin.')
  }

  const adminUser: SeedUser = { email: adminEmail, firstName: 'Admin', lastName: 'User', role: 'ADMIN' }
  return [adminUser]
}

function usersForMode(mode: SeedMode) {
  const usersByEmail = new Map<string, SeedUser>()

  for (const user of [...legacyUsersForMode(mode), ...parseSeedUsersJson()]) {
    usersByEmail.set(user.email, user)
  }

  return [...usersByEmail.values()]
}

async function seedUser(user: SeedUser, passwordHash: string) {
  return prisma.user.upsert({
    where: { email: user.email },
    update: {
      username: user.username || user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      passwordHash,
      active: true,
    },
    create: {
      email: user.email,
      username: user.username || user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      passwordHash,
      active: true,
    },
  })
}

async function disableLegacyBootstrapUsers(currentSeedEmails: Set<string>) {
  const emailsToDisable = legacyBootstrapEmails.filter((email) => !currentSeedEmails.has(email))
  if (emailsToDisable.length === 0) return 0

  const result = await prisma.user.updateMany({
    where: {
      email: { in: emailsToDisable },
      active: true,
    },
    data: {
      active: false,
    },
  })

  return result.count
}

async function seedProperty() {
  return prisma.property.upsert({
    where: { code: propertySeed.code },
    update: propertySeed,
    create: propertySeed,
  })
}

async function seedBookingEmailSource(propertyId: string) {
  const mailbox = 'booking@sandboxhotel.com'
  return prisma.bookingEmailSource.upsert({
    where: {
      propertyId_mailbox: {
        propertyId,
        mailbox,
      },
    },
    update: {
      name: 'Primary booking Gmail',
      provider: 'GMAIL',
      enabled: true,
      autoProcessSafeEvents: false,
      reviewThreshold: 0.85,
      query: `to:${mailbox} -in:spam -in:trash newer_than:30d`,
    },
    create: {
      propertyId,
      name: 'Primary booking Gmail',
      provider: 'GMAIL',
      mailbox,
      enabled: true,
      autoProcessSafeEvents: false,
      reviewThreshold: 0.85,
      query: `to:${mailbox} -in:spam -in:trash newer_than:30d`,
      lastError: 'Gmail API credentials are not configured for this server.',
    },
  })
}

async function seedRoomTypes(propertyId: string) {
  const roomTypes: RoomType[] = []

  for (const roomTypeSeed of roomTypeSeeds) {
    const roomType = await prisma.roomType.upsert({
      where: {
        propertyId_code: {
          propertyId,
          code: roomTypeSeed.code,
        },
      },
      update: roomTypeSeed,
      create: {
        propertyId,
        ...roomTypeSeed,
      },
    })
    roomTypes.push(roomType)
    console.log('Seeded room type:', roomType.name)
  }

  return roomTypes
}

async function seedRooms(propertyId: string, twinRoomTypeId: string, doubleRoomTypeId: string) {
  const superiorDoubleRooms = [
    ...Array.from({ length: 11 }, (_, index) => 201 + index),
    ...Array.from({ length: 6 }, (_, index) => 301 + index),
  ]
  const standardTwinRooms = [
    ...Array.from({ length: 8 }, (_, index) => 212 + index),
    ...Array.from({ length: 8 }, (_, index) => 312 + index),
  ]

  for (const roomNumber of superiorDoubleRooms) {
    const floor = Number(String(roomNumber).charAt(0))
    await prisma.room.upsert({
      where: {
        propertyId_number: {
          propertyId,
          number: roomNumber.toString(),
        },
      },
      update: {
        roomTypeId: doubleRoomTypeId,
        floor,
        operationalStatus: 'AVAILABLE',
        currentStatus: 'VACANT_CLEAN',
        notes: 'Owner clarified Superior Double rooms are the remaining non-twin room numbers.',
      },
      create: {
        propertyId,
        roomTypeId: doubleRoomTypeId,
        number: roomNumber.toString(),
        floor,
        operationalStatus: 'AVAILABLE',
        currentStatus: 'VACANT_CLEAN',
        notes: 'Owner clarified Superior Double rooms are the remaining non-twin room numbers.',
      },
    })
  }

  for (const roomNumber of standardTwinRooms) {
    const floor = Number(String(roomNumber).charAt(0))
    await prisma.room.upsert({
      where: {
        propertyId_number: {
          propertyId,
          number: roomNumber.toString(),
        },
      },
      update: {
        roomTypeId: twinRoomTypeId,
        floor,
        operationalStatus: 'AVAILABLE',
        currentStatus: 'VACANT_CLEAN',
        notes: 'Confirmed Standard Twin inventory. Live occupancy state not supplied.',
      },
      create: {
        propertyId,
        roomTypeId: twinRoomTypeId,
        number: roomNumber.toString(),
        floor,
        operationalStatus: 'AVAILABLE',
        currentStatus: 'VACANT_CLEAN',
        notes: 'Confirmed Standard Twin inventory. Live occupancy state not supplied.',
      },
    })
  }

  console.log('Seeded local/e2e rooms: Superior Double rooms 201-211 and 301-306; Standard Twin rooms 212-219 and 312-319.')
}

async function main() {
  const seedMode = resolveSeedMode()
  assertSafeSeedMode(seedMode)

  console.log(`Starting PMS seed in ${seedMode} mode...`)

  const property = await seedProperty()
  console.log('Seeded property configuration:', property.name)
  const bookingEmailSource = await seedBookingEmailSource(property.id)
  console.log('Seeded booking email source:', bookingEmailSource.mailbox)

  const [twinRoomType, doubleRoomType] = await seedRoomTypes(property.id)

  if (seedMode === 'dev' || seedMode === 'e2e') {
    await seedRooms(property.id, twinRoomType.id, doubleRoomType.id)
  } else {
    console.log('Skipped room inventory in prod-safe mode.')
  }

  const currentSeedEmails = new Set<string>()
  let seededUserCount = 0
  for (const user of usersForMode(seedMode)) {
    currentSeedEmails.add(user.email)
    const passwordHash = configuredPasswordHashFor(user)
    if (passwordHash) {
      const seededUser = await seedUser(user, passwordHash)
      console.log('Seeded user:', seededUser.email)
      seededUserCount += 1
    }
  }

  if (seededUserCount === 0) {
    console.log('Skipped seed users. Set explicit seed credentials to create bootstrap users.')
  }

  const disabledLegacyUserCount = await disableLegacyBootstrapUsers(currentSeedEmails)
  if (disabledLegacyUserCount > 0) {
    console.log(`Disabled ${disabledLegacyUserCount} legacy bootstrap user${disabledLegacyUserCount === 1 ? '' : 's'}.`)
  }

  console.log('Seed completed successfully.')
  console.log('Summary:')
  console.log(`   - Mode: ${seedMode}`)
  console.log(`   - Property: ${property.name}`)
  console.log(`   - Room Types: ${roomTypeSeeds.length}`)
  console.log(`   - Room Inventory: ${seedMode === 'prod-safe' ? 'skipped' : 'local/e2e defaults'}`)
  console.log(`   - Users: ${seededUserCount} database users seeded`)
  console.log(`   - Legacy Bootstrap Users Disabled: ${disabledLegacyUserCount}`)
}

main()
  .catch((error) => {
    console.error('Seed failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
