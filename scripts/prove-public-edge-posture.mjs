/* global console, process, fetch, AbortController, URL, setTimeout, clearTimeout */
import dns from 'node:dns/promises'

const DEFAULT_BASE_URL = 'https://book.sandboxhotel.com'
const DEFAULT_PATHS = [
  '/healthz?deep=1',
  '/.env',
  '/wp-login.php',
  '/phpmyadmin/',
  '/vendor/',
]

function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  return process.argv[index + 1]
}

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return null

  const url = new URL(raw)
  if (url.protocol !== 'https:') throw new Error('Public edge proof requires an HTTPS base URL.')
  url.pathname = ''
  url.search = ''
  url.hash = ''
  return url
}

function configuredPaths() {
  const value = argValue('--paths') || process.env.PUBLIC_EDGE_PROOF_PATHS || ''
  const paths = value
    ? value.split(',').map((item) => item.trim()).filter(Boolean)
    : DEFAULT_PATHS

  return paths.map((path) => {
    if (!path.startsWith('/')) throw new Error(`Probe path must start with "/": ${path}`)
    return path
  })
}

async function request(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    return await fetch(url, {
      headers: {
        accept: 'application/json,text/plain,*/*',
        'cache-control': 'no-cache',
      },
      redirect: 'manual',
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

function headerSummary(headers) {
  return {
    server: headers.get('server') || null,
    cfRayPresent: Boolean(headers.get('cf-ray')),
    cfCacheStatus: headers.get('cf-cache-status') || null,
    renderOriginServer: headers.get('x-render-origin-server') || null,
    contentType: headers.get('content-type') || null,
    strictTransportSecurityPresent: Boolean(headers.get('strict-transport-security')),
    contentSecurityPolicyPresent: Boolean(headers.get('content-security-policy')),
    xFrameOptionsPresent: Boolean(headers.get('x-frame-options')),
  }
}

async function dnsSummary(hostname) {
  const summary = {
    hostname,
    cnameTargets: [],
    addressCount: 0,
    lookupFallbackAddressPresent: false,
  }

  try {
    summary.cnameTargets = await dns.resolveCname(hostname)
  } catch {
    summary.cnameTargets = []
  }

  try {
    const addresses = await dns.resolve(hostname)
    summary.addressCount = addresses.length
  } catch {
    try {
      const lookup = await dns.lookup(hostname)
      summary.lookupFallbackAddressPresent = Boolean(lookup.address)
    } catch {
      summary.lookupFallbackAddressPresent = false
    }
  }

  return summary
}

async function probePath(baseUrl, path) {
  const url = new URL(path, baseUrl)
  const response = await request(url)
  const headers = headerSummary(response.headers)
  const result = {
    path,
    method: 'GET',
    status: response.status,
    redirected: response.status >= 300 && response.status < 400,
    headers,
    body: 'omitted',
  }

  if (path.startsWith('/healthz')) {
    const text = await response.text()
    try {
      const json = JSON.parse(text)
      result.health = {
        ok: json?.ok === true,
        environment: json?.environment || null,
        databaseConfigured: json?.database?.configured === true,
        databaseOk: json?.database?.ok === true,
      }
    } catch {
      result.health = {
        parseError: 'non-json-health-response',
      }
    }
  } else {
    await response.arrayBuffer()
  }

  return result
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue('--base-url') || process.env.LIVE_APP_URL || process.env.APP_URL || DEFAULT_BASE_URL)
  const paths = configuredPaths()
  const probes = []

  for (const path of paths) {
    probes.push(await probePath(baseUrl, path))
  }

  const output = {
    generatedAt: new Date().toISOString(),
    purpose: 'non-destructive public edge posture proof',
    target: {
      origin: baseUrl.origin,
      hostname: baseUrl.hostname,
    },
    dns: await dnsSummary(baseUrl.hostname),
    probes,
    redaction: {
      responseBodies: 'omitted except bounded health fields',
      cookies: 'not sent',
      authorization: 'not sent',
      secrets: 'not requested',
    },
    proofBoundary: 'Cloudflare/Render edge routing evidence only; not proof of customer-owned WAF or rate-limit rule configuration.',
  }

  console.log(JSON.stringify(output, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
