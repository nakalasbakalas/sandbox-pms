/* global console, process, fetch, AbortController, URL, setTimeout, clearTimeout */
import { pathToFileURL } from 'node:url'

const API_BASE = 'https://api.cloudflare.com/client/v4'
const DEFAULT_HOSTNAME = 'book.sandboxhotel.com'
const SECURITY_PHASES = new Set([
  'http_request_firewall_custom',
  'http_ratelimit',
  'http_request_firewall_managed',
])

function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  return process.argv[index + 1]
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function nullableEnv(name) {
  const value = process.env[name]
  if (value === undefined || value === null) return null
  const normalized = String(value).trim()
  return normalized ? normalized : null
}

function fail(message) {
  throw new Error(message)
}

function bearerToken() {
  return nullableEnv('CLOUDFLARE_API_TOKEN')
    || nullableEnv('CF_API_TOKEN')
}

function zoneId() {
  return argValue('--zone-id')
    || nullableEnv('CLOUDFLARE_ZONE_ID')
    || nullableEnv('CF_ZONE_ID')
}

function accountId() {
  return argValue('--account-id')
    || nullableEnv('CLOUDFLARE_ACCOUNT_ID')
    || nullableEnv('CF_ACCOUNT_ID')
}

function normalizeHostname(value = DEFAULT_HOSTNAME) {
  const normalized = String(value || DEFAULT_HOSTNAME).trim().toLowerCase()
  if (!/^[a-z0-9.-]+$/.test(normalized) || !normalized.includes('.')) fail(`Invalid hostname: ${value}`)
  return normalized
}

function redactProviderMessage(value) {
  return String(value || '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi, 'Bearer [redacted]')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[redacted-id-or-token]')
    .replace(/\b(token|secret|password|api[_-]?key)\b\s*[:=]\s*[^&\s,;}"']+/gi, '$1=[redacted]')
}

function positiveInt(value, fallback, max = 5) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) fail(`${value} is not an integer between 0 and ${max}.`)
  return parsed
}

function usage() {
  return `Usage:
  npm.cmd run cloudflare:waf:proof -- --zone-id <zone_id> --hostname book.sandboxhotel.com
  npm.cmd run cloudflare:waf:proof -- --zone-id <zone_id> --account-id <account_id> --hostname book.sandboxhotel.com

Required:
  CLOUDFLARE_API_TOKEN or CF_API_TOKEN.
  CLOUDFLARE_ZONE_ID or CF_ZONE_ID, unless --zone-id is provided.

Optional:
  --account-id <account_id>        Also inspect account-level WAF/rate-limit rulesets.
  --hostname <hostname>           Target hostname for coverage checks. Default: ${DEFAULT_HOSTNAME}
  --include-expressions           Include rule expressions in output after owner approval.
  --probe-url <https_url>         Run a bounded unauthenticated GET probe and omit response body.
  --probe-count <0-5>             Number of times to request --probe-url. Default: 1 when probe-url is set.
  --require-rules                 Exit non-zero if no WAF/rate-limit rules are found.
`
}

async function requestJson(path, token) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    })
    const text = await response.text()
    const body = text ? JSON.parse(text) : {}
    if (!response.ok || body?.success === false) {
      const errors = Array.isArray(body?.errors) ? body.errors.map((error) => error.message || error.code).filter(Boolean).join('; ') : ''
      fail(`Cloudflare API request failed for ${path}: ${response.status} ${redactProviderMessage(errors || response.statusText)}`)
    }
    return body?.result
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchRulesetDetails({ level, id, rulesetId, token }) {
  return requestJson(`/${level}s/${encodeURIComponent(id)}/rulesets/${encodeURIComponent(rulesetId)}`, token)
}

async function fetchRulesets({ level, id, token }) {
  const list = await requestJson(`/${level}s/${encodeURIComponent(id)}/rulesets`, token)
  const securityRulesets = (Array.isArray(list) ? list : []).filter((ruleset) => SECURITY_PHASES.has(ruleset?.phase))
  const details = []
  for (const ruleset of securityRulesets) {
    details.push(await fetchRulesetDetails({ level, id, rulesetId: ruleset.id, token }))
  }
  return details
}

function hostnameCoverage(expression, targetHostname) {
  const text = String(expression || '').toLowerCase()
  const hasHostCondition = /\bhttp\.(?:host|request\.full_uri)\b/.test(text)
  if (!text) return { scope: 'unspecified', targetHostnameCovered: false }
  if (text.includes(targetHostname.toLowerCase())) return { scope: 'target-hostname-mentioned', targetHostnameCovered: true }
  if (!hasHostCondition) return { scope: 'zone-or-ruleset-wide', targetHostnameCovered: true }
  return { scope: 'other-hostname-or-expression', targetHostnameCovered: false }
}

function summarizeRatelimit(value) {
  if (!value || typeof value !== 'object') return null
  return {
    period: Number.isFinite(value.period) ? value.period : null,
    requestsPerPeriod: Number.isFinite(value.requests_per_period) ? value.requests_per_period : null,
    mitigationTimeout: Number.isFinite(value.mitigation_timeout) ? value.mitigation_timeout : null,
    characteristics: Array.isArray(value.characteristics) ? value.characteristics.map(String) : [],
    countingExpressionPresent: Boolean(value.counting_expression),
    requestsToOrigin: value.requests_to_origin === undefined ? null : Boolean(value.requests_to_origin),
  }
}

function summarizeRule(rule = {}, { targetHostname, includeExpressions = false } = {}) {
  const coverage = hostnameCoverage(rule.expression, targetHostname)
  return {
    id: rule.id || null,
    ref: rule.ref || null,
    description: rule.description || null,
    enabled: rule.enabled === undefined ? true : Boolean(rule.enabled),
    action: rule.action || null,
    targetHostnameCovered: coverage.targetHostnameCovered,
    coverageScope: coverage.scope,
    ratelimit: summarizeRatelimit(rule.ratelimit),
    expression: includeExpressions ? (rule.expression || null) : 'omitted',
    actionParameters: 'omitted',
  }
}

export function summarizeRuleset(ruleset = {}, options = {}) {
  const rules = Array.isArray(ruleset.rules) ? ruleset.rules.map((rule) => summarizeRule(rule, options)) : []
  return {
    id: ruleset.id || null,
    name: ruleset.name || null,
    kind: ruleset.kind || null,
    phase: ruleset.phase || null,
    version: ruleset.version || null,
    rulesCount: rules.length,
    enabledRulesCount: rules.filter((rule) => rule.enabled).length,
    targetHostnameCoveredRules: rules.filter((rule) => rule.targetHostnameCovered).length,
    actions: [...new Set(rules.map((rule) => rule.action).filter(Boolean))].sort(),
    rules,
  }
}

async function boundedProbe(urlValue, count) {
  if (!urlValue) return null
  const parsed = new URL(urlValue)
  if (parsed.protocol !== 'https:') fail('Probe URL must use https.')
  const probes = []
  for (let index = 0; index < count; index += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20_000)
    try {
      const response = await fetch(parsed, {
        headers: {
          accept: 'text/plain,application/json,*/*',
          'cache-control': 'no-cache',
        },
        redirect: 'manual',
        signal: controller.signal,
      })
      await response.arrayBuffer()
      probes.push({
        index: index + 1,
        status: response.status,
        cfRayPresent: Boolean(response.headers.get('cf-ray')),
        cfCacheStatus: response.headers.get('cf-cache-status') || null,
        server: response.headers.get('server') || null,
        body: 'omitted',
      })
    } finally {
      clearTimeout(timeout)
    }
  }
  return {
    url: parsed.origin + parsed.pathname,
    query: parsed.search ? 'omitted' : null,
    method: 'GET',
    count,
    probes,
  }
}

export async function buildCloudflareWafProof({
  token,
  targetZoneId,
  targetAccountId = null,
  targetHostname = DEFAULT_HOSTNAME,
  includeExpressions = false,
  probeUrl = null,
  probeCount = 0,
} = {}) {
  if (!token) fail('Cloudflare API token is required. Set CLOUDFLARE_API_TOKEN or CF_API_TOKEN.')
  if (!targetZoneId) fail('Cloudflare zone id is required. Set CLOUDFLARE_ZONE_ID or CF_ZONE_ID.')
  const hostname = normalizeHostname(targetHostname)
  const zone = await requestJson(`/zones/${encodeURIComponent(targetZoneId)}`, token)
  const zoneRulesets = await fetchRulesets({ level: 'zone', id: targetZoneId, token })
  const accountRulesets = targetAccountId
    ? await fetchRulesets({ level: 'account', id: targetAccountId, token })
    : []
  const summarizedZoneRulesets = zoneRulesets.map((ruleset) => summarizeRuleset(ruleset, { targetHostname: hostname, includeExpressions }))
  const summarizedAccountRulesets = accountRulesets.map((ruleset) => summarizeRuleset(ruleset, { targetHostname: hostname, includeExpressions }))
  const allRulesets = [...summarizedZoneRulesets, ...summarizedAccountRulesets]
  const rulesCount = allRulesets.reduce((sum, ruleset) => sum + ruleset.rulesCount, 0)
  const coveredRulesCount = allRulesets.reduce((sum, ruleset) => sum + ruleset.targetHostnameCoveredRules, 0)

  return {
    generatedAt: new Date().toISOString(),
    purpose: 'read-only Cloudflare WAF and rate-limit ruleset proof',
    target: {
      hostname,
      zone: {
        idPresent: Boolean(targetZoneId),
        name: zone?.name || null,
        status: zone?.status || null,
      },
      account: {
        idPresent: Boolean(targetAccountId),
      },
    },
    cloudflareApi: {
      baseUrl: API_BASE,
      rulesetLevels: targetAccountId ? ['zone', 'account'] : ['zone'],
      phases: [...SECURITY_PHASES],
    },
    summary: {
      rulesetsCount: allRulesets.length,
      rulesCount,
      enabledRulesCount: allRulesets.reduce((sum, ruleset) => sum + ruleset.enabledRulesCount, 0),
      targetHostnameCoveredRules: coveredRulesCount,
      rateLimitRulesCount: allRulesets.reduce((sum, ruleset) => sum + ruleset.rules.filter((rule) => rule.ratelimit).length, 0),
      actions: [...new Set(allRulesets.flatMap((ruleset) => ruleset.actions))].sort(),
      requireOwnerReview: rulesCount === 0 || coveredRulesCount === 0,
    },
    rulesets: {
      zone: summarizedZoneRulesets,
      account: summarizedAccountRulesets,
    },
    probe: await boundedProbe(probeUrl, probeUrl ? positiveInt(probeCount, 1, 5) : 0),
    redaction: {
      apiToken: 'omitted',
      actionParameters: 'omitted',
      expressions: includeExpressions ? 'included by explicit owner-approved flag' : 'omitted; coverage summary only',
      responseBodies: 'omitted',
    },
    proofBoundary: 'Read-only Cloudflare API metadata plus optional unauthenticated GET probe. This does not create, update, delete, or load-test WAF/rate-limit rules.',
  }
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(usage())
    return
  }

  const token = bearerToken()
  const targetZoneId = zoneId()
  const outputBase = {
    generatedAt: new Date().toISOString(),
    purpose: 'read-only Cloudflare WAF and rate-limit ruleset proof',
    mode: 'status',
    target: {
      hostname: normalizeHostname(argValue('--hostname') || DEFAULT_HOSTNAME),
      zoneIdPresent: Boolean(targetZoneId),
      accountIdPresent: Boolean(accountId()),
    },
    redaction: {
      apiToken: 'omitted',
      ruleExpressions: hasFlag('--include-expressions') ? 'included by explicit flag if API succeeds' : 'omitted by default',
      responseBodies: 'omitted',
    },
  }

  if (!token || !targetZoneId) {
    console.log(JSON.stringify({
      ...outputBase,
      ready: false,
      missingRequiredKeys: [
        ...(!token ? ['CLOUDFLARE_API_TOKEN or CF_API_TOKEN'] : []),
        ...(!targetZoneId ? ['CLOUDFLARE_ZONE_ID or CF_ZONE_ID'] : []),
      ],
      nextStep: 'Run from an owner shell with a Cloudflare API token that has Zone WAF Read permission and the target zone id.',
    }, null, 2))
    fail('Missing Cloudflare WAF proof inputs.')
  }

  const proof = await buildCloudflareWafProof({
    token,
    targetZoneId,
    targetAccountId: accountId(),
    targetHostname: argValue('--hostname') || DEFAULT_HOSTNAME,
    includeExpressions: hasFlag('--include-expressions'),
    probeUrl: argValue('--probe-url') || null,
    probeCount: argValue('--probe-count'),
  })
  proof.ready = proof.summary.rulesCount > 0
  console.log(JSON.stringify(proof, null, 2))

  if (hasFlag('--require-rules') && proof.summary.rulesCount === 0) fail('No Cloudflare WAF/rate-limit rules were found.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? redactProviderMessage(error.message) : redactProviderMessage(String(error)))
    process.exit(1)
  })
}
