/* global console, process, fetch, AbortController, URL, setTimeout, clearTimeout */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const API_BASE = 'https://api.cloudflare.com/client/v4'
const DEFAULT_HOSTNAME = 'book.sandboxhotel.com'
const DEFAULT_ENV_TEMPLATE_PATH = '.codex/cloudflare-waf.local.env'
const CLOUDFLARE_ENV_KEYS = new Set([
  'CLOUDFLARE_API_TOKEN',
  'CF_API_TOKEN',
  'CLOUDFLARE_ZONE_ID',
  'CF_ZONE_ID',
  'CLOUDFLARE_ACCOUNT_ID',
  'CF_ACCOUNT_ID',
])
const SECURITY_PHASES = new Set([
  'http_request_firewall_custom',
  'http_ratelimit',
  'http_request_firewall_managed',
])
const EXPECTED_WAF_RULE_REF = 'sandbox_pms_common_probe_block'
const EXPECTED_LOGIN_RATE_LIMIT_RULE_REF = 'sandbox_pms_login_rate_limit'
const HOST_CLAUSE_PATTERN = String.raw`http\.host\s+(?:eq\s+"[^"]+"|in\s+\{(?:\s*"[^"]+"\s*)+\})`

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
  const explicitAccountId = argValue('--account-id')
  if (explicitAccountId) return explicitAccountId
  return nullableEnv('CLOUDFLARE_ACCOUNT_ID')
    || nullableEnv('CF_ACCOUNT_ID')
}

function accountInspectionRequested() {
  return hasFlag('--account-id') || hasFlag('--use-env-account-id')
}

export function isCloudflareWafProofReady({
  verifiedExpectedWafRules,
  verifiedExpectedLoginRateLimitRules,
  accountInspectionRequested = false,
  accountInspectionInspected = false,
}) {
  return verifiedExpectedWafRules > 0
    && verifiedExpectedLoginRateLimitRules > 0
    && (!accountInspectionRequested || accountInspectionInspected)
}

export function assertCloudflareWafProofRequirements({ proof }) {
  if (!proof?.summary) {
    throw new Error('Cloudflare WAF proof output is missing summary metadata.')
  }
  if (!proof.summary.requireOwnerReview) return

  const reasons = []
  if (proof.summary.verifiedExpectedWafRules < 1) {
    reasons.push(`the enabled ${EXPECTED_WAF_RULE_REF} block contract is not verified for the target hostname`)
  }
  if (proof.summary.verifiedExpectedLoginRateLimitRules < 1) {
    reasons.push(`the enabled ${EXPECTED_LOGIN_RATE_LIMIT_RULE_REF} login block contract is not verified for the target hostname`)
  }
  if (proof.summary.accountInspectionRequested && !proof.summary.accountInspectionInspected) {
    reasons.push('requested account-level inspection could not be completed')
  }
  throw new Error(`Cloudflare WAF/rate-limit proof is incomplete: ${reasons.join('; ') || 'owner review is required'}.`)
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

function stripOptionalQuotes(value) {
  const trimmed = String(value || '').trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function parseCloudflareEnvFileContent(content) {
  const parsed = {}
  const skippedKeys = []
  const lines = String(content || '').split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex <= 0) fail(`Invalid env-file line ${index + 1}. Expected KEY=value.`)
    const key = trimmed.slice(0, separatorIndex).trim()
    const value = stripOptionalQuotes(trimmed.slice(separatorIndex + 1))
    if (!CLOUDFLARE_ENV_KEYS.has(key)) {
      skippedKeys.push(key)
      continue
    }
    parsed[key] = value
  }
  return { parsed, skippedKeys }
}

async function loadCloudflareEnvFile(filePath) {
  if (!filePath) return { loadedKeys: [], skippedKeys: [], path: null }
  const resolvedPath = resolve(filePath)
  const content = await readFile(resolvedPath, 'utf8')
  const { parsed, skippedKeys } = parseCloudflareEnvFileContent(content)
  const loadedKeys = []
  for (const [key, value] of Object.entries(parsed)) {
    if (!String(value || '').trim()) continue
    if (process.env[key]) continue
    process.env[key] = value
    loadedKeys.push(key)
  }
  return { loadedKeys, skippedKeys, path: resolvedPath }
}

async function writeEnvTemplate(filePath = DEFAULT_ENV_TEMPLATE_PATH) {
  const resolvedPath = resolve(filePath)
  await mkdir(dirname(resolvedPath), { recursive: true })
  const template = `# Local only. Do not commit.
# Cloudflare API token with read access for zone rulesets/WAF metadata.
CLOUDFLARE_API_TOKEN=

# Optional if the token can read zones. The helper can discover this from --hostname.
CLOUDFLARE_ZONE_ID=

# Optional. Include only when account-level rulesets should be inspected with --use-env-account-id.
CLOUDFLARE_ACCOUNT_ID=
`
  await writeFile(resolvedPath, template, { encoding: 'utf8', flag: 'wx' })
  return resolvedPath
}

export function zoneNameCandidates(hostname) {
  const labels = normalizeHostname(hostname).split('.')
  const candidates = []
  for (let index = 0; index < labels.length - 1; index += 1) {
    candidates.push(labels.slice(index).join('.'))
  }
  return candidates
}

function usage() {
  return `Usage:
  npm.cmd run cloudflare:waf:proof -- --init-env-template
  npm.cmd run cloudflare:waf:proof -- --env-file .\\.codex\\cloudflare-waf.local.env --hostname book.sandboxhotel.com --require-rules
  npm.cmd run cloudflare:waf:proof -- --zone-id <zone_id> --hostname book.sandboxhotel.com
  npm.cmd run cloudflare:waf:proof -- --zone-id <zone_id> --account-id <account_id> --hostname book.sandboxhotel.com

Required:
  CLOUDFLARE_API_TOKEN or CF_API_TOKEN.
  CLOUDFLARE_ZONE_ID or CF_ZONE_ID, unless --zone-id is provided or the token can discover the zone from --hostname.

Optional:
  --account-id <account_id>        Also inspect account-level WAF/rate-limit rulesets.
  --env-file <path>                Load allowed Cloudflare keys from a local ignored env file. Existing shell env wins.
  --hostname <hostname>           Target hostname for coverage checks. Default: ${DEFAULT_HOSTNAME}
  --include-expressions           Include rule expressions in output after owner approval.
  --init-env-template [path]       Create a local env template. Default: ${DEFAULT_ENV_TEMPLATE_PATH}
  --probe-url <https_url>         Run a bounded unauthenticated GET probe and omit response body.
  --probe-count <0-5>             Number of times to request --probe-url. Default: 1 when probe-url is set.
  --require-rules                 Exit non-zero unless enabled WAF and rate-limit rules cover the target hostname.
  --use-env-account-id            Inspect account-level rulesets using CLOUDFLARE_ACCOUNT_ID/CF_ACCOUNT_ID.
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

async function discoverZone({ token, hostname }) {
  const errors = []
  for (const candidate of zoneNameCandidates(hostname)) {
    try {
      const result = await requestJson(`/zones?name=${encodeURIComponent(candidate)}`, token)
      const zones = Array.isArray(result) ? result : []
      const zone = zones.find((item) => item?.name === candidate) || zones[0]
      if (zone?.id) return { id: zone.id, name: zone.name || candidate, status: zone.status || null, source: 'api-discovery' }
    } catch (error) {
      errors.push(redactProviderMessage(error instanceof Error ? error.message : String(error)))
    }
  }
  return { id: null, name: null, status: null, source: 'api-discovery-failed', errors }
}

function hostnameCoverage(expression, targetHostname) {
  const text = String(expression || '').toLowerCase()
  const hasHostCondition = /\bhttp\.(?:host|request\.full_uri)\b/.test(text)
  if (!text) return { scope: 'unspecified', targetHostnameCovered: false }
  if (text.includes(targetHostname.toLowerCase())) return { scope: 'target-hostname-mentioned', targetHostnameCovered: true }
  if (!hasHostCondition) return { scope: 'zone-or-ruleset-wide', targetHostnameCovered: true }
  return { scope: 'other-hostname-or-expression', targetHostnameCovered: false }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function expressionHasQuotedEquality(expression, field, value) {
  return new RegExp(`\\b${escapeRegExp(field)}\\s+eq\\s+"${escapeRegExp(value)}"`, 'i')
    .test(String(expression || ''))
}

function expressionHasPositiveHostname(expression, targetHostname) {
  const text = String(expression || '')
  if (expressionHasQuotedEquality(text, 'http.host', targetHostname)) return true
  const inSets = [...text.matchAll(/\bhttp\.host\s+in\s+\{([^}]*)\}/gi)]
  const quotedHostname = new RegExp(`"${escapeRegExp(targetHostname)}"`, 'i')
  return inSets.some((match) => quotedHostname.test(match[1]))
}

function canonicalWafExpressionMatches(expression, targetHostname) {
  const pattern = new RegExp(
    String.raw`^\(\s*(${HOST_CLAUSE_PATTERN})\s+and\s+\(\s*http\.request\.uri\.path\s+eq\s+"/\.env"\s+or\s+starts_with\(\s*http\.request\.uri\.path\s*,\s*"/wp-"\s*\)\s+or\s+starts_with\(\s*http\.request\.uri\.path\s*,\s*"/phpmyadmin"\s*\)\s+or\s+starts_with\(\s*http\.request\.uri\.path\s*,\s*"/vendor/"\s*\)\s*\)\s*\)$`,
    'i',
  )
  const match = String(expression || '').match(pattern)
  return Boolean(match && expressionHasPositiveHostname(match[1], targetHostname))
}

function canonicalLoginRateExpressionMatches(expression, targetHostname) {
  const pattern = new RegExp(
    String.raw`^\(\s*(${HOST_CLAUSE_PATTERN})\s+and\s+http\.request\.method\s+eq\s+"POST"\s+and\s+http\.request\.uri\.path\s+eq\s+"/api/auth/login"\s*\)$`,
    'i',
  )
  const match = String(expression || '').match(pattern)
  return Boolean(match && expressionHasPositiveHostname(match[1], targetHostname))
}

function expectedSandboxRuleContract(rule, { phase, targetHostname }) {
  const enabled = rule.enabled === undefined ? true : Boolean(rule.enabled)
  const action = String(rule.action || '').toLowerCase()
  const expression = String(rule.expression || '')
  const positiveHostname = expressionHasPositiveHostname(expression, targetHostname)
  const positiveOnly = !/\b(?:not|ne)\b/i.test(expression)

  if (rule.ref === EXPECTED_WAF_RULE_REF) {
    const checks = {
      phase: phase === 'http_request_firewall_custom',
      enabled,
      action: action === 'block',
      positiveOnly,
      positiveHostname,
      canonicalExpression: canonicalWafExpressionMatches(expression, targetHostname),
    }
    return { type: 'waf', verified: Object.values(checks).every(Boolean), checks }
  }

  if (rule.ref === EXPECTED_LOGIN_RATE_LIMIT_RULE_REF) {
    const ratelimit = rule.ratelimit && typeof rule.ratelimit === 'object' ? rule.ratelimit : {}
    const characteristics = [...new Set((Array.isArray(ratelimit.characteristics) ? ratelimit.characteristics : []).map(String))].sort()
    const checks = {
      phase: phase === 'http_ratelimit',
      enabled,
      action: action === 'block',
      positiveOnly,
      positiveHostname,
      canonicalExpression: canonicalLoginRateExpressionMatches(expression, targetHostname),
      threshold: Number(ratelimit.period) === 10
        && Number(ratelimit.requests_per_period) === 10
        && Number(ratelimit.mitigation_timeout) === 10,
      characteristics: JSON.stringify(characteristics) === JSON.stringify(['cf.colo.id', 'ip.src']),
    }
    return { type: 'login_rate_limit', verified: Object.values(checks).every(Boolean), checks }
  }

  return { type: null, verified: false, checks: {} }
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

function summarizeRule(rule = {}, { phase, targetHostname, includeExpressions = false } = {}) {
  const coverage = hostnameCoverage(rule.expression, targetHostname)
  const expectedContract = expectedSandboxRuleContract(rule, { phase, targetHostname })
  return {
    id: rule.id || null,
    ref: rule.ref || null,
    description: rule.description || null,
    enabled: rule.enabled === undefined ? true : Boolean(rule.enabled),
    action: rule.action || null,
    targetHostnameCovered: coverage.targetHostnameCovered,
    coverageScope: coverage.scope,
    ratelimit: summarizeRatelimit(rule.ratelimit),
    expectedContract,
    expression: includeExpressions ? (rule.expression || null) : 'omitted',
    actionParameters: 'omitted',
  }
}

export function summarizeRuleset(ruleset = {}, options = {}) {
  const rules = Array.isArray(ruleset.rules)
    ? ruleset.rules.map((rule) => summarizeRule(rule, { ...options, phase: ruleset.phase }))
    : []
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
  targetAccountInspectionRequested = false,
  targetHostname = DEFAULT_HOSTNAME,
  includeExpressions = false,
  probeUrl = null,
  probeCount = 0,
} = {}) {
  if (!token) fail('Cloudflare API token is required. Set CLOUDFLARE_API_TOKEN or CF_API_TOKEN.')
  const hostname = normalizeHostname(targetHostname)
  const discoveredZone = targetZoneId
    ? { id: targetZoneId, name: null, status: null, source: 'provided' }
    : await discoverZone({ token, hostname })
  if (!discoveredZone.id) fail(`Cloudflare zone id is required. Set CLOUDFLARE_ZONE_ID or CF_ZONE_ID, pass --zone-id, or grant the token Zone Read for hostname discovery. Discovery source: ${discoveredZone.source}.`)
  const zone = await requestJson(`/zones/${encodeURIComponent(discoveredZone.id)}`, token)
  const zoneRulesets = await fetchRulesets({ level: 'zone', id: discoveredZone.id, token })
  let accountRulesets = []
  let accountRulesetInspectionError = null
  if (targetAccountId && targetAccountInspectionRequested) {
    try {
      accountRulesets = await fetchRulesets({ level: 'account', id: targetAccountId, token })
    } catch (error) {
      accountRulesetInspectionError = redactProviderMessage(error instanceof Error ? error.message : String(error))
    }
  }
  const summarizedZoneRulesets = zoneRulesets.map((ruleset) => summarizeRuleset(ruleset, { targetHostname: hostname, includeExpressions }))
  const summarizedAccountRulesets = accountRulesets.map((ruleset) => summarizeRuleset(ruleset, { targetHostname: hostname, includeExpressions }))
  const allRulesets = [...summarizedZoneRulesets, ...summarizedAccountRulesets]
  const rulesCount = allRulesets.reduce((sum, ruleset) => sum + ruleset.rulesCount, 0)
  const coveredRulesCount = allRulesets.reduce((sum, ruleset) => sum + ruleset.targetHostnameCoveredRules, 0)
  const enabledTargetHostnameCoveredRules = allRulesets.reduce(
    (sum, ruleset) => sum + ruleset.rules.filter((rule) => rule.enabled && rule.targetHostnameCovered).length,
    0,
  )
  const enabledTargetHostnameCoveredWafRules = allRulesets.reduce(
    (sum, ruleset) => sum + (
      ruleset.phase === 'http_request_firewall_custom' || ruleset.phase === 'http_request_firewall_managed'
        ? ruleset.rules.filter((rule) => rule.enabled && rule.targetHostnameCovered).length
        : 0
    ),
    0,
  )
  const enabledTargetHostnameCoveredRateLimitRules = allRulesets.reduce(
    (sum, ruleset) => sum + ruleset.rules.filter(
      (rule) => rule.enabled && rule.targetHostnameCovered && Boolean(rule.ratelimit),
    ).length,
    0,
  )
  const verifiedExpectedWafRules = summarizedZoneRulesets.reduce(
    (sum, ruleset) => sum + ruleset.rules.filter(
      (rule) => rule.expectedContract.type === 'waf' && rule.expectedContract.verified,
    ).length,
    0,
  )
  const verifiedExpectedLoginRateLimitRules = summarizedZoneRulesets.reduce(
    (sum, ruleset) => sum + ruleset.rules.filter(
      (rule) => rule.expectedContract.type === 'login_rate_limit' && rule.expectedContract.verified,
    ).length,
    0,
  )
  const accountInspectionInspected = Boolean(targetAccountId)
    && Boolean(targetAccountInspectionRequested)
    && !accountRulesetInspectionError
  const isReady = isCloudflareWafProofReady({
    verifiedExpectedWafRules,
    verifiedExpectedLoginRateLimitRules,
    accountInspectionRequested: Boolean(targetAccountInspectionRequested),
    accountInspectionInspected,
  })

  return {
    generatedAt: new Date().toISOString(),
    purpose: 'read-only Cloudflare WAF and rate-limit ruleset proof',
    target: {
      hostname,
      zone: {
        idPresent: Boolean(discoveredZone.id),
        idSource: discoveredZone.source,
        name: zone?.name || null,
        status: zone?.status || null,
      },
      account: {
        idPresent: Boolean(targetAccountId),
        requested: Boolean(targetAccountInspectionRequested),
        inspected: accountInspectionInspected,
        inspectionError: accountRulesetInspectionError,
      },
    },
    cloudflareApi: {
      baseUrl: API_BASE,
      rulesetLevels: targetAccountId && targetAccountInspectionRequested ? ['zone', 'account'] : ['zone'],
      phases: [...SECURITY_PHASES],
    },
    summary: {
      rulesetsCount: allRulesets.length,
      rulesCount,
      enabledRulesCount: allRulesets.reduce((sum, ruleset) => sum + ruleset.enabledRulesCount, 0),
      targetHostnameCoveredRules: coveredRulesCount,
      enabledTargetHostnameCoveredRules,
      enabledTargetHostnameCoveredWafRules,
      enabledTargetHostnameCoveredRateLimitRules,
      verifiedExpectedWafRules,
      verifiedExpectedLoginRateLimitRules,
      rateLimitRulesCount: allRulesets.reduce((sum, ruleset) => sum + ruleset.rules.filter((rule) => rule.ratelimit).length, 0),
      actions: [...new Set(allRulesets.flatMap((ruleset) => ruleset.actions))].sort(),
      accountInspectionRequested: Boolean(targetAccountInspectionRequested),
      accountInspectionInspected,
      requireOwnerReview: !isReady,
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

  if (hasFlag('--init-env-template')) {
    const templatePath = argValue('--init-env-template')
    const writtenPath = await writeEnvTemplate(templatePath && !templatePath.startsWith('--') ? templatePath : DEFAULT_ENV_TEMPLATE_PATH)
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      ready: false,
      mode: 'init-env-template',
      path: writtenPath,
      redaction: {
        apiToken: 'omitted',
        secrets: 'not generated',
      },
      nextStep: `Edit ${writtenPath} locally, then run npm.cmd run cloudflare:waf:proof -- --env-file ${writtenPath} --hostname ${DEFAULT_HOSTNAME} --require-rules`,
    }, null, 2))
    return
  }

  const envFilePath = argValue('--env-file')
  const envFile = envFilePath ? await loadCloudflareEnvFile(envFilePath) : null
  const token = bearerToken()
  const targetZoneId = zoneId()
  const hostname = normalizeHostname(argValue('--hostname') || DEFAULT_HOSTNAME)
  const targetAccountId = accountId()
  const targetAccountInspectionRequested = accountInspectionRequested()
  const outputBase = {
    generatedAt: new Date().toISOString(),
    purpose: 'read-only Cloudflare WAF and rate-limit ruleset proof',
    mode: 'status',
    target: {
      hostname,
      zoneIdPresent: Boolean(targetZoneId),
      accountIdPresent: Boolean(targetAccountId),
    },
    envFile: envFile ? {
      used: true,
      path: envFile.path,
      loadedKeys: envFile.loadedKeys,
      skippedKeys: envFile.skippedKeys,
      values: 'omitted',
    } : {
      used: false,
    },
    redaction: {
      apiToken: 'omitted',
      ruleExpressions: hasFlag('--include-expressions') ? 'included by explicit flag if API succeeds' : 'omitted by default',
      responseBodies: 'omitted',
    },
  }

  if (!token) {
    console.log(JSON.stringify({
      ...outputBase,
      ready: false,
      missingRequiredKeys: [
        'CLOUDFLARE_API_TOKEN or CF_API_TOKEN',
      ],
      nextStep: `Run npm.cmd run cloudflare:waf:proof -- --init-env-template, add a Cloudflare API token locally, then rerun with --env-file ${DEFAULT_ENV_TEMPLATE_PATH}.`,
    }, null, 2))
    fail('Missing Cloudflare WAF proof inputs.')
  }

  const proof = await buildCloudflareWafProof({
    token,
    targetZoneId,
    targetAccountId,
    targetAccountInspectionRequested,
    targetHostname: hostname,
    includeExpressions: hasFlag('--include-expressions'),
    probeUrl: argValue('--probe-url') || null,
    probeCount: argValue('--probe-count'),
  })
  proof.envFile = outputBase.envFile
  proof.ready = !proof.summary.requireOwnerReview
  console.log(JSON.stringify(proof, null, 2))

  if (hasFlag('--require-rules')) assertCloudflareWafProofRequirements({ proof })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? redactProviderMessage(error.message) : redactProviderMessage(String(error)))
    process.exit(1)
  })
}
