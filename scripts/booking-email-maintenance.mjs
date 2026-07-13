/* global console, process */
import { loadEnvDefaults } from './env-utils.mjs'
import { createPrismaClient } from '../server/prisma-client.mjs'
import {
  bookingEmailGmailCredentialStatus,
  resolveBookingEmailGmailAccessToken,
  syncBookingEmail,
} from '../server/pms-service.mjs'
import {
  bookingEmailPubSubConfig,
  redactBookingEmailSyncError,
  runBookingEmailMaintenance,
} from '../server/booking-email-gmail-sync.mjs'

loadEnvDefaults()

function fail(message) {
  throw new Error(message)
}

async function main() {
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is required for booking email maintenance.')

  const credential = bookingEmailGmailCredentialStatus(process.env)
  if (!credential.configured) {
    fail('Backend Gmail API OAuth credentials are not configured for booking email maintenance.')
  }

  const pubsub = bookingEmailPubSubConfig(process.env)
  if (pubsub.enabled && !pubsub.configured) {
    fail(`Booking email Pub/Sub is enabled but incomplete: ${pubsub.missing.join(', ')}.`)
  }

  const prisma = createPrismaClient()
  try {
    const summary = await runBookingEmailMaintenance(prisma, {
      env: process.env,
      getAccessToken: ({ env }) => resolveBookingEmailGmailAccessToken({ env }),
      ingestEvents: (db, input, actor) => syncBookingEmail(db, {
        ...input,
        reviewOnly: true,
      }, actor),
    })

    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      purpose: 'review-only booking email maintenance',
      pubsub: {
        enabled: pubsub.enabled,
        configured: pubsub.configured,
        ready: pubsub.ready,
        missing: pubsub.missing,
      },
      summary,
      safety: {
        bookingMutationsApplied: false,
        credentialsPrinted: false,
        rawEmailContentPrinted: false,
      },
    }, null, 2))

    if (
      summary.sourcesChecked === 0
      || summary.errors.length > 0
      || summary.deliveryFailures > 0
      || summary.reconciliationFailures > 0
    ) {
      process.exitCode = 1
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(redactBookingEmailSyncError(error))
  process.exit(1)
})
