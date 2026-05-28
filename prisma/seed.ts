import { PrismaClient, type UserRole } from '@prisma/client'
import { pbkdf2Sync, randomBytes } from 'node:crypto'

const prisma = new PrismaClient()

type SeedUser = {
  email: string
  firstName: string
  lastName: string
  role: UserRole
}

const seedUsers: SeedUser[] = [
  { email: 'admin@sandboxhotel.co.th', firstName: 'Admin', lastName: 'Sandbox', role: 'ADMIN' },
  { email: 'manager@sandboxhotel.co.th', firstName: 'Manager', lastName: 'Sandbox', role: 'MANAGER' },
  { email: 'frontdesk@sandboxhotel.co.th', firstName: 'Front Desk', lastName: 'Sandbox', role: 'FRONT_DESK' },
  { email: 'housekeeping@sandboxhotel.co.th', firstName: 'Housekeeping', lastName: 'Sandbox', role: 'HOUSEKEEPING' },
  { email: 'cashier@sandboxhotel.co.th', firstName: 'Cashier', lastName: 'Sandbox', role: 'CASHIER' },
]

const passwordEnvByRole: Record<UserRole, string | undefined> = {
  ADMIN: process.env.SEED_ADMIN_PASSWORD,
  MANAGER: process.env.SEED_MANAGER_PASSWORD,
  FRONT_DESK: process.env.SEED_FRONT_DESK_PASSWORD,
  HOUSEKEEPING: process.env.SEED_HOUSEKEEPING_PASSWORD,
  CASHIER: process.env.SEED_CASHIER_PASSWORD,
  CAFE_STAFF: process.env.SEED_CAFE_STAFF_PASSWORD,
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

function passwordHashFor(user: SeedUser) {
  if (process.env.SEED_USER_PASSWORD_HASH) return process.env.SEED_USER_PASSWORD_HASH
  const password = passwordEnvByRole[user.role]
  return password ? createPasswordHash(password) : undefined
}

async function seedUser(user: SeedUser, passwordHash: string) {
  return prisma.user.upsert({
    where: { email: user.email },
    update: {
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      active: true,
    },
    create: {
      ...user,
      passwordHash,
      active: true,
    },
  })
}

async function main() {
  console.log('Starting Sandbox Hotel seed...')

  const property = await prisma.property.upsert({
    where: { code: 'SANDBOX' },
    update: {
      name: 'Sandbox Hotel',
      address: 'Phuket, Thailand',
      phone: '+66 76 390 000',
      email: 'info@sandboxhotel.co.th',
      timezone: 'Asia/Bangkok',
      defaultCheckIn: '14:00',
      defaultCheckOut: '11:00',
      currency: 'THB',
      taxRate: 0,
      extraGuestFee: 200,
      childFee: 100,
    },
    create: {
      code: 'SANDBOX',
      name: 'Sandbox Hotel',
      address: 'Phuket, Thailand',
      phone: '+66 76 390 000',
      email: 'info@sandboxhotel.co.th',
      timezone: 'Asia/Bangkok',
      defaultCheckIn: '14:00',
      defaultCheckOut: '11:00',
      currency: 'THB',
      taxRate: 0,
      extraGuestFee: 200,
      childFee: 100,
    },
  })

  console.log('Seeded property:', property.name)

  const twinRoomType = await prisma.roomType.upsert({
    where: {
      propertyId_code: {
        propertyId: property.id,
        code: 'TWIN',
      },
    },
    update: {
      name: 'Twin Room',
      description: 'Comfortable room with two single beds',
      baseRate: 1500,
      maxOccupancy: 3,
      standardOcc: 2,
    },
    create: {
      propertyId: property.id,
      code: 'TWIN',
      name: 'Twin Room',
      description: 'Comfortable room with two single beds',
      baseRate: 1500,
      maxOccupancy: 3,
      standardOcc: 2,
    },
  })

  console.log('Seeded room type:', twinRoomType.name)

  const doubleRoomType = await prisma.roomType.upsert({
    where: {
      propertyId_code: {
        propertyId: property.id,
        code: 'DOUBLE',
      },
    },
    update: {
      name: 'Double Room',
      description: 'Comfortable room with one double bed',
      baseRate: 1800,
      maxOccupancy: 3,
      standardOcc: 2,
    },
    create: {
      propertyId: property.id,
      code: 'DOUBLE',
      name: 'Double Room',
      description: 'Comfortable room with one double bed',
      baseRate: 1800,
      maxOccupancy: 3,
      standardOcc: 2,
    },
  })

  console.log('Seeded room type:', doubleRoomType.name)

  const twinRooms = []
  for (let i = 201; i <= 216; i++) {
    const isNonSellable = i === 216
    const room = await prisma.room.upsert({
      where: {
        propertyId_number: {
          propertyId: property.id,
          number: i.toString(),
        },
      },
      update: {
        roomTypeId: twinRoomType.id,
        floor: 2,
        operationalStatus: isNonSellable ? 'OUT_OF_SERVICE' : 'AVAILABLE',
        currentStatus: 'VACANT_CLEAN',
      },
      create: {
        propertyId: property.id,
        roomTypeId: twinRoomType.id,
        number: i.toString(),
        floor: 2,
        operationalStatus: isNonSellable ? 'OUT_OF_SERVICE' : 'AVAILABLE',
        currentStatus: 'VACANT_CLEAN',
      },
    })
    twinRooms.push(room)
  }

  console.log('Seeded twin rooms: 201-215 sellable, 216 out of service')

  const doubleRooms = []
  for (let i = 301; i <= 316; i++) {
    const isNonSellable = i === 316
    const room = await prisma.room.upsert({
      where: {
        propertyId_number: {
          propertyId: property.id,
          number: i.toString(),
        },
      },
      update: {
        roomTypeId: doubleRoomType.id,
        floor: 3,
        operationalStatus: isNonSellable ? 'OUT_OF_SERVICE' : 'AVAILABLE',
        currentStatus: 'VACANT_CLEAN',
      },
      create: {
        propertyId: property.id,
        roomTypeId: doubleRoomType.id,
        number: i.toString(),
        floor: 3,
        operationalStatus: isNonSellable ? 'OUT_OF_SERVICE' : 'AVAILABLE',
        currentStatus: 'VACANT_CLEAN',
      },
    })
    doubleRooms.push(room)
  }

  console.log('Seeded double rooms: 301-315 sellable, 316 out of service')

  let seededUserCount = 0
  for (const user of seedUsers) {
    const passwordHash = passwordHashFor(user)
    if (passwordHash) {
      const seededUser = await seedUser(user, passwordHash)
      console.log('Seeded user:', seededUser.email)
      seededUserCount += 1
    }
  }

  if (seededUserCount === 0) {
    console.log('Skipped seed users. Set SEED_ADMIN_PASSWORD or SEED_USER_PASSWORD_HASH to create initial database users.')
  }

  console.log('Seed completed successfully.')
  console.log('Summary:')
  console.log(`   - Property: ${property.name}`)
  console.log('   - Room Types: 2 (Twin, Double)')
  console.log('   - Rooms: 30 sellable, 2 non-sellable out-of-service rooms')
  console.log(`   - Users: ${seededUserCount} database users seeded`)
}

main()
  .catch((error) => {
    console.error('Seed failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
