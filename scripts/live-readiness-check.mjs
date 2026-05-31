/* global console, process, fetch, AbortController, URL, setTimeout, clearTimeout */
import dns from 'node:dns/promises'

const DEFAULT_APP_URL = 'https://book.sandboxhotel.com'
const appUrl = normalizeBaseUrl(process.env.LIVE_APP_URL || process.env.APP_URL || DEFAULT_APP_URL)
const extraUrls = String(process.env.LIVE_EXTRA_URLS || '')
  .split(',')
  .map((value) => normalizeBaseUrl(value))
  .filter(Boolean)

const targets = [...new Set([appUrl, ...extraUrls])]
const failures = []
const warnings = []
const infos = []
const requireLine = String(process.env.LIVE_REQUIRE_LINE || '').toLowerCase() === 'true'

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  try {
    const url = new URL(raw)
    url.pathname = ''
    url.search = ''
    url.hash = ''
    return url.origin
  } catch {
    return ''
  }
}

async function request(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    return await fetch(url, {
      ...options,
      redirect: 'follow',
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function readJson(response, label) {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label} returned non-JSON body: ${text.slice(0, 160)}`)
  }
}

function requireCondition(condition, message) {
  if (!condition) failures.push(message)
}

async function checkHealth(baseUrl) {
  const shallow = await request(`${baseUrl}/healthz`)
  requireCondition(shallow.status === 200, `${baseUrl}/healthz returned ${shallow.status}`)
  const shallowBody = await readJson(shallow, `${baseUrl}/healthz`)
  requireCondition(shallowBody.ok === true, `${baseUrl}/healthz did not report ok=true`)
  requireCondition(shallowBody.environment === 'production', `${baseUrl}/healthz did not report production environment`)
  requireCondition(shallowBody.database?.configured === true, `${baseUrl}/healthz did not report database.configured=true`)

  const deep = await request(`${baseUrl}/healthz?deep=1`)
  requireCondition(deep.status === 200, `${baseUrl}/healthz?deep=1 returned ${deep.status}`)
  const deepBody = await readJson(deep, `${baseUrl}/healthz?deep=1`)
  requireCondition(deepBody.ok === true, `${baseUrl}/healthz?deep=1 did not report ok=true`)
  requireCondition(deepBody.database?.ok === true, `${baseUrl}/healthz?deep=1 did not report database.ok=true`)

  if (requireLine && deepBody.integrations?.lineWebhookConfigured !== true) {
    warnings.push(`${baseUrl} reports lineWebhookConfigured=false`)
  } else if (deepBody.integrations?.lineWebhookConfigured !== true) {
    infos.push(`${baseUrl} reports lineWebhookConfigured=false; LINE is optional unless LIVE_REQUIRE_LINE=true`)
  }
}

async function checkInvalidSessionProbe(baseUrl) {
  const response = await request(`${baseUrl}/api/auth/me`, {
    headers: {
      cookie: 'pms_session=a.b',
    },
  })
  requireCondition(response.status === 401, `${baseUrl}/api/auth/me invalid-cookie probe returned ${response.status}, expected 401`)
}

async function checkRootAndEdge(baseUrl) {
  const response = await request(`${baseUrl}/`, { method: 'HEAD' })
  requireCondition(response.status === 200, `${baseUrl}/ HEAD returned ${response.status}`)

  const server = response.headers.get('server') || ''
  const renderOrigin = response.headers.get('x-render-origin-server') || ''
  const cfRay = response.headers.get('cf-ray') || ''
  if (!server.toLowerCase().includes('cloudflare') || !renderOrigin || !cfRay) {
    warnings.push(`${baseUrl} did not expose the expected Cloudflare/Render edge headers`)
  }
}

async function checkDns(baseUrl) {
  const host = new URL(baseUrl).hostname
  try {
    const cnames = await dns.resolveCname(host)
    if (host === 'book.sandboxhotel.com' && !cnames.some((name) => name.includes('onrender.com'))) {
      warnings.push(`${host} CNAME does not include an onrender.com target: ${cnames.join(', ')}`)
    }
  } catch (error) {
    try {
      const addresses = await dns.lookup(host)
      infos.push(`${host} DNS lookup resolved to ${addresses.address}; CNAME detail unavailable from this resolver`)
    } catch {
      infos.push(`${host} CNAME lookup skipped or unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

for (const target of targets) {
  if (!target) continue
  console.log(`\nChecking ${target}`)
  await checkHealth(target)
  await checkInvalidSessionProbe(target)
  await checkRootAndEdge(target)
  await checkDns(target)
}

if (warnings.length) {
  console.log('\nWarnings:')
  for (const warning of warnings) console.log(`- ${warning}`)
}

if (infos.length) {
  console.log('\nInfo:')
  for (const info of infos) console.log(`- ${info}`)
}

if (failures.length) {
  console.error('\nLive readiness check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log('\nLive readiness check passed.')
}
