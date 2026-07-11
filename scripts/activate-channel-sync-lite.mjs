#!/usr/bin/env node
/* global console, fetch, process, setTimeout */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const API_BASE = 'https://api.render.com/v1'
const EVIDENCE_DIR = 'activation-evidence'
const serviceId = requiredEnv('RENDER_SERVICE_ID')
const renderApiKey = requiredEnv('RENDER_API_KEY')
const targetCommit = requiredEnv('TARGET_COMMIT')
const expectedMailbox = requiredEnv('EXPECTED_MAILBOX').toLowerCase()
const publicHealthUrl = requiredEnv('PUBLIC_HEALTH_URL')

mkdirSync(EVIDENCE_DIR, { recursive: true })

function requiredEnv(key) {
  const value = String(process.env[key] || '').trim()
  if (!value) throw new Error(`${key} is required.`)
  return value
}

function mask(value) {
  if (value) console.log(`::add-mask::${value}`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function safeWrite(name, value) {
  writeFileSync(join(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ...(options.env || {}) },
  })
  if (options.stdoutFile) writeFileSync(options.stdoutFile, result.stdout || '')
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').replaceAll(renderApiKey, '[redacted]').slice(-2000)
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}. ${stderr}`)
  }
  return String(result.stdout || '').trim()
}

async function renderRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${renderApiKey}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = body?.message || body?.error || response.statusText || 'Render API request failed.'
    throw new Error(`Render API ${options.method || 'GET'} ${path} failed: HTTP ${response.status} ${String(message).slice(0, 180)}`)
  }
  return body
}

async function getRenderEnvValue(key, required = true) {
  const response = await fetch(`${API_BASE}/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`, {
    headers: { accept: 'application/json', authorization: `Bearer ${renderApiKey}` },
  })
  if (response.status === 404 && !required) return null
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Render env lookup failed for ${key}: HTTP ${response.status}`)
  const value = body?.value ?? body?.envVar?.value ?? body?.env_var?.value ?? body?.env?.value
  if (required && (value === undefined || value === null || String(value).length === 0)) {
    throw new Error(`Render env value is missing for ${key}.`)
  }
  return value === undefined || value === null ? null : String(value)
}

async function setRenderEnvValue(key, value) {
  await renderRequest(`/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value: String(value) }),
  })
}

async function verifyOAuthAndLoadRuntime() {
  const mailbox = (await getRenderEnvValue('BOOKING_EMAIL_PRIMARY_MAILBOX')).toLowerCase()
  const clientId = await getRenderEnvValue('BOOKING_EMAIL_GMAIL_CLIENT_ID')
  const clientSecret = await getRenderEnvValue('BOOKING_EMAIL_GMAIL_CLIENT_SECRET')
  const refreshToken = await getRenderEnvValue('BOOKING_EMAIL_GMAIL_REFRESH_TOKEN')
  const gmailUserId = await getRenderEnvValue('BOOKING_EMAIL_GMAIL_USER_ID', false) || 'me'
  const databaseUrl = await getRenderEnvValue('DATABASE_URL')

  for (const value of [renderApiKey, clientId, clientSecret, refreshToken, databaseUrl]) mask(value)

  if (mailbox !== expectedMailbox) {
    throw new Error(`Configured mailbox ${mailbox} does not match ${expectedMailbox}.`)
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const token = await tokenResponse.json().catch(() => ({}))
  if (!tokenResponse.ok || !token.access_token) {
    throw new Error(`Gmail OAuth refresh failed with HTTP ${tokenResponse.status}.`)
  }
  mask(token.access_token)

  const profileResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(gmailUserId)}/profile`, {
    headers: { authorization: `Bearer ${token.access_token}` },
  })
  const profile = await profileResponse.json().catch(() => ({}))
  if (!profileResponse.ok) throw new Error(`Gmail profile verification failed with HTTP ${profileResponse.status}.`)
  const verifiedMailbox = String(profile.emailAddress || '').toLowerCase()
  if (verifiedMailbox !== expectedMailbox) {
    throw new Error(`OAuth profile belongs to ${verifiedMailbox || 'an unknown mailbox'}, not ${expectedMailbox}.`)
  }

  const proof = {
    generatedAt: new Date().toISOString(),
    serviceId,
    expectedMailbox,
    configuredMailbox: mailbox,
    oauthProfileMailbox: verifiedMailbox,
    oauthMode: 'refresh_token',
    oauthReady: true,
    mailboxOwnershipVerified: true,
    secretValues: 'omitted',
  }
  safeWrite('oauth-mailbox-proof.json', proof)
  console.log(`Verified Gmail OAuth ownership for ${verifiedMailbox}; secret values omitted.`)

  return {
    DATABASE_URL: databaseUrl,
    BOOKING_EMAIL_PRIMARY_MAILBOX: mailbox,
    BOOKING_EMAIL_GMAIL_USER_ID: gmailUserId,
    BOOKING_EMAIL_GMAIL_CLIENT_ID: clientId,
    BOOKING_EMAIL_GMAIL_CLIENT_SECRET: clientSecret,
    BOOKING_EMAIL_GMAIL_REFRESH_TOKEN: refreshToken,
  }
}

function installRenderCli() {
  run('bash', ['-lc', 'curl -fsSL https://raw.githubusercontent.com/render-oss/cli/main/bin/install.sh | sh'])
  const candidates = [
    '/usr/local/bin/render',
    join(homedir(), '.local', 'bin', 'render'),
    join(homedir(), 'bin', 'render'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  const discovered = run('bash', ['-lc', 'command -v render || find "$HOME" -type f -name render -perm -111 2>/dev/null | head -n 1'])
  if (!discovered) throw new Error('Render CLI installation did not produce an executable.')
  return discovered.split(/\r?\n/).at(-1).trim()
}

function deploy(renderBin, label) {
  const output = run(renderBin, [
    'deploys', 'create', serviceId,
    '--commit', targetCommit,
    '--wait', '--confirm', '--output', 'json',
  ], { env: { RENDER_API_KEY: renderApiKey } })
  writeFileSync(join(EVIDENCE_DIR, `deploy-${label}.txt`), `${output}\n`)
  console.log(`Render deploy completed: ${label}.`)
}

async function verifyHealth(label) {
  let lastStatus = null
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(publicHealthUrl, { headers: { accept: 'application/json' } })
      lastStatus = response.status
      const body = await response.json().catch(() => null)
      if (response.ok && body?.ok === true) {
        safeWrite(`health-${label}.json`, {
          checkedAt: new Date().toISOString(),
          url: publicHealthUrl,
          httpStatus: response.status,
          ok: true,
          environment: body.environment || null,
          databaseConfigured: body.database?.configured ?? null,
          databaseOk: body.database?.ok ?? null,
        })
        console.log(`Public health is green after ${label}.`)
        return
      }
    } catch {
      // Retry boundedly while Render and DNS settle.
    }
    await sleep(10_000)
  }
  throw new Error(`Public health did not become green after ${label}; last HTTP status ${lastStatus || 'unavailable'}.`)
}

function bookingProof(runtime, name) {
  const output = run('node', ['scripts/prove-booking-email-capture.mjs'], { env: runtime })
  const proof = JSON.parse(output)
  safeWrite(name, proof)
  return proof
}

function latestEnabledSync(proof) {
  return (proof.sources || [])
    .filter((source) => source.enabled && source.lastSyncAt)
    .map((source) => new Date(source.lastSyncAt).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0] || 0
}

function validateReviewOnly(before, after) {
  const beforeSync = latestEnabledSync(before)
  const afterSync = latestEnabledSync(after)
  if (!after.credential?.configured) throw new Error('Gmail credentials are not configured after activation.')
  if (afterSync <= beforeSync) throw new Error('Enabled source lastSyncAt did not advance.')
  if (after.capture.processed !== before.capture.processed) {
    throw new Error('Processed event count changed during review-only polling.')
  }
  if (after.capture.linkedEvents !== before.capture.linkedEvents) {
    throw new Error('Linked operational event count changed during review-only polling.')
  }

  return {
    generatedAt: new Date().toISOString(),
    serviceId,
    targetCommit,
    mailbox: expectedMailbox,
    pollingEnabled: true,
    pollingIntervalSeconds: 120,
    lastSyncAdvanced: true,
    beforeLastSyncAt: beforeSync ? new Date(beforeSync).toISOString() : null,
    afterLastSyncAt: new Date(afterSync).toISOString(),
    totalEventsBefore: before.capture.totalEvents,
    totalEventsAfter: after.capture.totalEvents,
    needsReviewBefore: before.capture.needsReview,
    needsReviewAfter: after.capture.needsReview,
    processedCountUnchanged: true,
    linkedEventCountUnchanged: true,
    operationalMutationsObserved: false,
    secretValues: 'omitted',
  }
}

async function main() {
  let pollingEnabled = false
  let renderBin = null
  try {
    const runtime = await verifyOAuthAndLoadRuntime()
    await setRenderEnvValue('BOOKING_EMAIL_NEAR_LIVE_ENABLED', 'false')
    await setRenderEnvValue('BOOKING_EMAIL_SYNC_INTERVAL_SECONDS', '120')
    await setRenderEnvValue('BOOKING_EMAIL_SYNC_BATCH_LIMIT', '25')

    renderBin = installRenderCli()
    run(renderBin, ['--version'])

    deploy(renderBin, 'polling-disabled')
    await verifyHealth('polling-disabled')
    const before = bookingProof(runtime, 'booking-proof-before.json')

    await setRenderEnvValue('BOOKING_EMAIL_NEAR_LIVE_ENABLED', 'true')
    pollingEnabled = true
    deploy(renderBin, 'polling-enabled')
    await verifyHealth('polling-enabled')

    let after = null
    for (const delaySeconds of [155, 90, 90]) {
      await sleep(delaySeconds * 1000)
      after = bookingProof(runtime, 'booking-proof-after.json')
      if (latestEnabledSync(after) > latestEnabledSync(before)) break
    }

    const summary = validateReviewOnly(before, after)
    safeWrite('channel-sync-activation-summary.json', summary)
    console.log(JSON.stringify(summary))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    safeWrite('activation-failure.json', {
      generatedAt: new Date().toISOString(),
      serviceId,
      targetCommit,
      pollingHadBeenEnabled: pollingEnabled,
      error: message.replaceAll(renderApiKey, '[redacted]'),
      secretValues: 'omitted',
    })

    if (pollingEnabled) {
      try {
        console.error('Activation proof failed after enablement; rolling polling back to false.')
        await setRenderEnvValue('BOOKING_EMAIL_NEAR_LIVE_ENABLED', 'false')
        if (renderBin) deploy(renderBin, 'rollback-polling-disabled')
      } catch (rollbackError) {
        console.error(`Rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
      }
    }
    throw error
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
