import { PrismaClient } from '@prisma/client'

export function createPrismaClient(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured.')
  }

  if (databaseUrl !== process.env.DATABASE_URL) {
    return new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    })
  }

  return new PrismaClient()
}
