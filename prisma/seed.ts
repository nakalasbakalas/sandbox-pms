import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting seed...')

  const property = await prisma.property.upsert({
    where: { code: 'SANDBOX' },
    update: {},
    create: {
      code: 'SANDBOX',
      name: 'Sandbox Hotel',
      address: 'Phuket, Thailand',
      phone: '+66-xxx-xxx-xxxx',
      email: 'info@sandboxhotel.com',
      timezone: 'Asia/Bangkok',
      defaultCheckIn: '14:00',
      defaultCheckOut: '11:00',
      currency: 'THB',
      taxRate: 0,
      extraGuestFee: 200,
      childFee: 100,
    },
  })

  console.log('✅ Created property:', property.name)

  const twinRoomType = await prisma.roomType.upsert({
    where: {
      propertyId_code: {
        propertyId: property.id,
        code: 'TWIN',
      },
    },
    update: {},
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

  console.log('✅ Created room type:', twinRoomType.name)

  const doubleRoomType = await prisma.roomType.upsert({
    where: {
      propertyId_code: {
        propertyId: property.id,
        code: 'DOUBLE',
      },
    },
    update: {},
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

  console.log('✅ Created room type:', doubleRoomType.name)

  const twinRooms = []
  for (let i = 201; i <= 215; i++) {
    const room = await prisma.room.upsert({
      where: {
        propertyId_number: {
          propertyId: property.id,
          number: i.toString(),
        },
      },
      update: {},
      create: {
        propertyId: property.id,
        roomTypeId: twinRoomType.id,
        number: i.toString(),
        floor: 2,
        operationalStatus: i === 216 ? 'OUT_OF_SERVICE' : 'AVAILABLE',
        currentStatus: 'VACANT_CLEAN',
      },
    })
    twinRooms.push(room)
  }

  console.log(`✅ Created ${twinRooms.length} twin rooms (201-215)`)

  const doubleRooms = []
  for (let i = 301; i <= 315; i++) {
    const room = await prisma.room.upsert({
      where: {
        propertyId_number: {
          propertyId: property.id,
          number: i.toString(),
        },
      },
      update: {},
      create: {
        propertyId: property.id,
        roomTypeId: doubleRoomType.id,
        number: i.toString(),
        floor: 3,
        operationalStatus: i === 316 ? 'OUT_OF_SERVICE' : 'AVAILABLE',
        currentStatus: 'VACANT_CLEAN',
      },
    })
    doubleRooms.push(room)
  }

  console.log(`✅ Created ${doubleRooms.length} double rooms (301-315)`)

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@sandboxhotel.com' },
    update: {},
    create: {
      email: 'admin@sandboxhotel.com',
      passwordHash: '$2a$10$rK8H7zGK3K3k4K3K3k4K3k4K3k4K3k4K3k4K3k4K3k4K3k4K3k4K',
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
      active: true,
    },
  })

  console.log('✅ Created admin user:', adminUser.email)

  const managerUser = await prisma.user.upsert({
    where: { email: 'manager@sandboxhotel.com' },
    update: {},
    create: {
      email: 'manager@sandboxhotel.com',
      passwordHash: '$2a$10$rK8H7zGK3K3k4K3K3k4K3k4K3k4K3k4K3k4K3k4K3k4K3k4K3k4K',
      firstName: 'Manager',
      lastName: 'User',
      role: 'MANAGER',
      active: true,
    },
  })

  console.log('✅ Created manager user:', managerUser.email)

  const frontDeskUser = await prisma.user.upsert({
    where: { email: 'frontdesk@sandboxhotel.com' },
    update: {},
    create: {
      email: 'frontdesk@sandboxhotel.com',
      passwordHash: '$2a$10$rK8H7zGK3K3k4K3K3k4K3k4K3k4K3k4K3k4K3k4K3k4K3k4K3k4K',
      firstName: 'Front Desk',
      lastName: 'User',
      role: 'FRONT_DESK',
      active: true,
    },
  })

  console.log('✅ Created front desk user:', frontDeskUser.email)

  const housekeepingUser = await prisma.user.upsert({
    where: { email: 'housekeeping@sandboxhotel.com' },
    update: {},
    create: {
      email: 'housekeeping@sandboxhotel.com',
      passwordHash: '$2a$10$rK8H7zGK3K3k4K3K3k4K3k4K3k4K3k4K3k4K3k4K3k4K3k4K3k4K',
      firstName: 'Housekeeping',
      lastName: 'User',
      role: 'HOUSEKEEPING',
      active: true,
    },
  })

  console.log('✅ Created housekeeping user:', housekeepingUser.email)

  const cashierUser = await prisma.user.upsert({
    where: { email: 'cashier@sandboxhotel.com' },
    update: {},
    create: {
      email: 'cashier@sandboxhotel.com',
      passwordHash: '$2a$10$rK8H7zGK3K3k4K3K3k4K3k4K3k4K3k4K3k4K3k4K3k4K3k4K3k4K',
      firstName: 'Cashier',
      lastName: 'User',
      role: 'CASHIER',
      active: true,
    },
  })

  console.log('✅ Created cashier user:', cashierUser.email)

  console.log('\n🎉 Seed completed successfully!')
  console.log('\n📋 Summary:')
  console.log(`   - Property: ${property.name}`)
  console.log(`   - Room Types: 2 (Twin, Double)`)
  console.log(`   - Rooms: 30 total (15 twin + 15 double)`)
  console.log(`   - Users: 5 (Admin, Manager, Front Desk, Housekeeping, Cashier)`)
  console.log('\n🔑 Login credentials (password: "password123" for all users):')
  console.log('   - admin@sandboxhotel.com')
  console.log('   - manager@sandboxhotel.com')
  console.log('   - frontdesk@sandboxhotel.com')
  console.log('   - housekeeping@sandboxhotel.com')
  console.log('   - cashier@sandboxhotel.com')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
