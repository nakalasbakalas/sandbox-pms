/* global console, process */
import { createPrismaClient } from '../server/prisma-client.mjs'
import {
  applyLiteInventoryBaseline,
  assertLiteStagingInventoryBoundary,
} from '../server/lite-inventory-baseline.mjs'

async function main() {
  assertLiteStagingInventoryBoundary()
  const prisma = createPrismaClient()
  try {
    const result = await applyLiteInventoryBaseline(prisma)
    console.log(JSON.stringify({
      applied: true,
      propertyCode: result.propertyCode,
      rooms: result.rooms,
      roomTypes: result.roomTypes,
      byRoomType: result.byRoomType,
      createdRooms: result.createdRooms,
      existingRooms: result.existingRooms,
    }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
