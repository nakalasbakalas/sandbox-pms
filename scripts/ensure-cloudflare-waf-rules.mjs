/* global console, process, fetch, AbortController, setTimeout, clearTimeout */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseCloudflareEnvFileContent, zoneNameCandidates } from './prove-cloudflare-waf-rules.mjs'

const API_BASE = 'https://api.cloudflare.com/client/v4'
const DEFAULT_HOSTNAMES = ['book.sandboxhotel.com', 'staff.sandboxhotel.com']
const DEFAULT_ENV_PATH = '.codex/cloudflare-waf.local.env'

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

function normalizeHostname(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!/^[a-z0-9.-]+$/.test(normalized) || !normalized.includes('.')) fail(`Invalid hostname: ${value}`)
  return normalized
}

function protectedHostnames() {
  const raw = argValue('--protected-hostnames')
  const values = raw
    ? raw.split(',').map((value) => value.trim()).filter(Boolean)
    : DEFAULT_HOSTNAMES
  const normalized = [...new Set(values.map(normalizeHostname))]
  if (normalized.length === 0) fail('At least one protected hostname is required.')
  return normalized
}

function redactProviderMessage(value) {
  return String(value || '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi, 'Bearer [redacted]')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[redacted-id-or-token]')
    .replace(/\b(token|secret|password|api[_-]?key)\b\s*[:=]\s*[^&\s,;}"']+/gi, '$1=[redacted]')
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

async function requestJson(path, token, { method = 'GET', body = null, allow404 = false } = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    const text = await response.text()
    const payload = text ? JSON.parse(text) : {}
    if (response.status === 404 && allow404) return null
    if (!response.ok || payload?.success === false) {
      const errors = Array.isArray(payload?.errors)
        ? payload.errors.map((error) => error.message || error.code).filter(Boolean).join('; ')
        : ''
      fail(`Cloudflare API request failed for ${path}: ${response.status} ${redactProviderMessage(errors || response.statusText)}`)
    }
    return payload?.result
  } finally {
    clearTimeout(timeout)
  }
}

async function discoverZone({ token, hostnames }) {
  const candidates = [...new Set(hostnames.flatMap((hostname) => zoneNameCandidates(hostname)))]
  const errors = []
  for (const candidate of candidates) {
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

function hostSetExpression(hostnames) {
  return `http.host in {${hostnames.map((hostname) => `"${hostname}"`).join(' ')}}`
}

export function sandboxCloudflareWafDesiredRules(hostnames = DEFAULT_HOSTNAMES, {
  includeApiBurstRateLimit = false,
} = {}) {
  const normalizedHostnames = [...new Set(hostnames.map(normalizeHostname))]
  const hostExpression = hostSetExpression(normalizedHostnames)
  const rules = [
    {
      phase: 'http_request_firewall_custom',
      rulesetName: 'Sandbox PMS custom WAF entrypoint',
      rulesetDescription: 'Zone-level custom WAF rules for Sandbox PMS public hostnames.',
      rule: {
        ref: 'sandbox_pms_common_probe_block',
        description: 'Sandbox PMS common probe block',
        expression: `(${hostExpression} and (http.request.uri.path eq "/.env" or starts_with(http.request.uri.path, "/wp-") or starts_with(http.request.uri.path, "/phpmyadmin") or starts_with(http.request.uri.path, "/vendor/")))`,
        action: 'block',
      },
    },
    {
      phase: 'http_ratelimit',
      rulesetName: 'Sandbox PMS rate limits entrypoint',
      rulesetDescription: 'Zone-level rate limits for Sandbox PMS public hostnames.',
      rule: {
        ref: 'sandbox_pms_login_rate_limit',
        description: 'Sandbox PMS login rate limit',
        expression: `(${hostExpression} and http.request.method eq "POST" and http.request.uri.path eq "/api/auth/login")`,
        action: 'block',
        ratelimit: {
          characteristics: ['cf.colo.id', 'ip.src'],
          period: 10,
          requests_per_period: 10,
          mitigation_timeout: 10,
        },
      },
    },
  ]

  if (includeApiBurstRateLimit) {
    rules.push({
      phase: 'http_ratelimit',
      rulesetName: 'Sandbox PMS rate limits entrypoint',
      rulesetDescription: 'Zone-level rate limits for Sandbox PMS public hostnames.',
      rule: {
        ref: 'sandbox_pms_api_burst_rate_limit',
        description: 'Sandbox PMS API burst limit',
        expression: `(${hostExpression} and starts_with(http.request.uri.path, "/api/") and http.request.uri.path ne "/api/auth/me")`,
        action: 'block',
        ratelimit: {
          characteristics: ['cf.colo.id', 'ip.src'],
          period: 60,
          requests_per_period: 300,
          mitigation_timeout: 60,
        },
      },
    })
  }

  return rules
}

function normalizeRateLimitCharacteristics(characteristics = []) {
  return [...new Set((Array.isArray(characteristics) ? characteristics : []).map((item) => String(item)).filter(Boolean))].sort()
}

function normalizeRateLimitForComparison(ratelimit = {}) {
  if (!ratelimit || typeof ratelimit !== 'object') return null
  const normalized = {}
  if ('characteristics' in ratelimit) normalized.characteristics = normalizeRateLimitCharacteristics(ratelimit.characteristics)
  if ('period' in ratelimit) normalized.period = Number.isFinite(Number(ratelimit.period)) ? Number(ratelimit.period) : null
  if ('requests_per_period' in ratelimit) normalized.requestsPerPeriod = Number.isFinite(Number(ratelimit.requests_per_period)) ? Number(ratelimit.requests_per_period) : null
  if ('mitigation_timeout' in ratelimit) normalized.mitigationTimeout = Number.isFinite(Number(ratelimit.mitigation_timeout)) ? Number(ratelimit.mitigation_timeout) : null
  return normalized
}

function normalizeRuleForComparison(rule = {}) {
  const ratelimit = normalizeRateLimitForComparison(rule.ratelimit)
  return {
    enabled: rule.enabled === undefined ? true : Boolean(rule.enabled),
    action: rule.action || null,
    expression: rule.expression || null,
    ratelimit,
  }
}

function rulesMatch(existingRule = {}, desiredRule = {}) {
  return JSON.stringify(normalizeRuleForComparison(existingRule))
    === JSON.stringify(normalizeRuleForComparison({ ...desiredRule, enabled: true }))
}

function findMatchingExistingRule(existingRules = [], desiredRule = {}) {
  const exactRefMatch = existingRules.find((rule) => rule.ref === desiredRule.ref)
  if (exactRefMatch) return { existingRule: exactRefMatch, blocked: false }
  if (!desiredRule.description) return { existingRule: null, blocked: false }
  const descriptionMatches = existingRules.filter((rule) => rule.description === desiredRule.description)
  if (descriptionMatches.length === 1) return { existingRule: descriptionMatches[0], blocked: false }
  if (descriptionMatches.length > 1) return {
    existingRule: null,
    blocked: true,
    blockReason: `multiple rules matched description "${desiredRule.description}"`,
  }
  return { existingRule: null, blocked: false }
}

function summarizeEnsuredRule({ phase, operation, ruleset, rule, desired, blockReason = null }) {
  const ratelimit = rule?.ratelimit || desired.rule.ratelimit || null
  return {
    operation,
    phase,
    rulesetId: ruleset?.id || null,
    rulesetName: ruleset?.name || desired.rulesetName,
    rulesetVersion: ruleset?.version || null,
    ruleId: rule?.id || null,
    ruleRef: rule?.ref || desired.rule.ref,
    description: rule?.description || desired.rule.description,
    enabled: rule?.enabled === undefined ? true : Boolean(rule.enabled),
    action: rule?.action || desired.rule.action,
    expression: 'omitted',
    blockReason,
    ratelimit: ratelimit ? {
      characteristics: Array.isArray(ratelimit.characteristics) ? ratelimit.characteristics.map(String) : [],
      period: ratelimit.period ?? null,
      requestsPerPeriod: ratelimit.requests_per_period ?? null,
      mitigationTimeout: ratelimit.mitigation_timeout ?? null,
    } : null,
  }
}

async function getEntrypoint({ targetZoneId, phase, token }) {
  return requestJson(
    `/zones/${encodeURIComponent(targetZoneId)}/rulesets/phases/${encodeURIComponent(phase)}/entrypoint`,
    token,
    { allow404: true },
  )
}

async function ensureDesiredRule({ targetZoneId, token, desired, dryRun = false }) {
  const entrypoint = await getEntrypoint({ targetZoneId, phase: desired.phase, token })
  if (!entrypoint) {
    if (dryRun) {
      return summarizeEnsuredRule({
        phase: desired.phase,
        operation: 'would-create-ruleset-and-rule',
        ruleset: null,
        rule: null,
        desired,
      })
    }
    const ruleset = await requestJson(`/zones/${encodeURIComponent(targetZoneId)}/rulesets`, token, {
      method: 'POST',
      body: {
        name: desired.rulesetName,
        description: desired.rulesetDescription,
        kind: 'zone',
        phase: desired.phase,
        rules: [{ ...desired.rule, enabled: true }],
      },
    })
    const rule = (ruleset.rules || []).find((candidate) => candidate.ref === desired.rule.ref)
    return summarizeEnsuredRule({ phase: desired.phase, operation: 'created-ruleset-and-rule', ruleset, rule, desired })
  }

  const { existingRule, blocked, blockReason } = findMatchingExistingRule(entrypoint.rules || [], desired.rule)
  if (blocked) {
    return summarizeEnsuredRule({
      phase: desired.phase,
      operation: 'blocked-ambiguous-description-match',
      ruleset: entrypoint,
      rule: null,
      desired,
      blockReason,
    })
  }
  if (!existingRule) {
    if (dryRun) {
      return summarizeEnsuredRule({
        phase: desired.phase,
        operation: 'would-create-rule',
        ruleset: entrypoint,
        rule: null,
        desired,
      })
    }
    const ruleset = await requestJson(`/zones/${encodeURIComponent(targetZoneId)}/rulesets/${encodeURIComponent(entrypoint.id)}/rules`, token, {
      method: 'POST',
      body: { ...desired.rule, enabled: true },
    })
    const rule = (ruleset.rules || []).find((candidate) => candidate.ref === desired.rule.ref)
    return summarizeEnsuredRule({ phase: desired.phase, operation: 'created-rule', ruleset, rule, desired })
  }

  if (!rulesMatch(existingRule, desired.rule)) {
    if (dryRun) {
      return summarizeEnsuredRule({
        phase: desired.phase,
        operation: 'would-update-rule',
        ruleset: entrypoint,
        rule: existingRule,
        desired,
      })
    }
    const ruleset = await requestJson(`/zones/${encodeURIComponent(targetZoneId)}/rulesets/${encodeURIComponent(entrypoint.id)}/rules/${encodeURIComponent(existingRule.id)}`, token, {
      method: 'PATCH',
      body: { ...desired.rule, enabled: true },
    })
    const rule = (ruleset.rules || []).find((candidate) => candidate.ref === desired.rule.ref)
    return summarizeEnsuredRule({ phase: desired.phase, operation: 'updated-rule', ruleset, rule, desired })
  }

  return summarizeEnsuredRule({ phase: desired.phase, operation: 'unchanged', ruleset: entrypoint, rule: existingRule, desired })
}

export async function ensureSandboxCloudflareWafRules({
  token,
  targetZoneId,
  hostnames = DEFAULT_HOSTNAMES,
  dryRun = false,
  includeApiBurstRateLimit = false,
} = {}) {
  if (!token) fail('Cloudflare API token is required. Set CLOUDFLARE_API_TOKEN or CF_API_TOKEN.')
  const normalizedHostnames = [...new Set(hostnames.map(normalizeHostname))]
  const discoveredZone = targetZoneId
    ? { id: targetZoneId, name: null, status: null, source: 'provided' }
    : await discoverZone({ token, hostnames: normalizedHostnames })
  if (!discoveredZone.id) fail(`Cloudflare zone id is required. Set CLOUDFLARE_ZONE_ID or CF_ZONE_ID, pass --zone-id, or grant the token Zone Read for hostname discovery. Discovery source: ${discoveredZone.source}.`)
  const zone = await requestJson(`/zones/${encodeURIComponent(discoveredZone.id)}`, token)
  const desiredRules = sandboxCloudflareWafDesiredRules(normalizedHostnames, { includeApiBurstRateLimit })
  const results = []
  for (const desired of desiredRules) {
    results.push(await ensureDesiredRule({ targetZoneId: discoveredZone.id, token, desired, dryRun }))
  }
  return {
    generatedAt: new Date().toISOString(),
    purpose: 'ensure Sandbox PMS Cloudflare WAF and rate-limit rules',
    mode: dryRun ? 'dry-run' : 'ensure',
    ready: results.every((result) => Boolean(result.ruleId) || result.operation.startsWith('would-')),
    target: {
      protectedHostnames: normalizedHostnames,
      freePlanCompatibleDefault: !includeApiBurstRateLimit,
      zone: {
        idPresent: Boolean(discoveredZone.id),
        idSource: discoveredZone.source,
        name: zone?.name || null,
        status: zone?.status || null,
      },
    },
    results,
    redaction: {
      apiToken: 'omitted',
      zoneId: 'omitted',
      actionParameters: 'omitted',
      expressions: 'omitted; rule refs, actions, thresholds, and hostnames retained',
      responseBodies: 'omitted',
    },
    proofBoundary: dryRun
      ? 'Dry-run Cloudflare API inspection only. This does not create, update, delete, or load-test WAF/rate-limit rules.'
      : 'Mutates only the named Sandbox PMS zone-level Cloudflare custom WAF and rate-limit rules. This does not delete rules or load-test the public service.',
  }
}

function usage() {
  return `Usage:
  npm.cmd run cloudflare:waf:ensure -- --env-file .\\.codex\\cloudflare-waf.local.env
  npm.cmd run cloudflare:waf:ensure -- --env-file .\\.codex\\cloudflare-waf.local.env --dry-run
  npm.cmd run cloudflare:waf:ensure -- --zone-id <zone_id> --protected-hostnames book.sandboxhotel.com,staff.sandboxhotel.com

Required:
  CLOUDFLARE_API_TOKEN or CF_API_TOKEN.
  CLOUDFLARE_ZONE_ID or CF_ZONE_ID, unless --zone-id is provided or the token can discover the zone.

Optional:
  --env-file <path>                Load allowed Cloudflare keys from a local ignored env file. Existing shell env wins.
  --protected-hostnames <csv>      Hostnames to protect. Default: ${DEFAULT_HOSTNAMES.join(',')}
  --dry-run                        Inspect existing entrypoints and report intended changes without mutating Cloudflare.
  --include-api-burst-rate-limit   Also manage the optional API burst rate-limit rule. Do not use this on Free-plan zones unless quota allows more than one rate-limit rule.
`
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(usage())
    return
  }
  const envFilePath = argValue('--env-file') || null
  const envFile = envFilePath ? await loadCloudflareEnvFile(envFilePath) : null
  const outputBase = {
    generatedAt: new Date().toISOString(),
    purpose: 'ensure Sandbox PMS Cloudflare WAF and rate-limit rules',
    mode: hasFlag('--dry-run') ? 'dry-run' : 'ensure',
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
      zoneId: 'omitted',
      responseBodies: 'omitted',
    },
  }
  const token = bearerToken()
  if (!token) {
    console.log(JSON.stringify({
      ...outputBase,
      ready: false,
      missingRequiredKeys: [
        'CLOUDFLARE_API_TOKEN or CF_API_TOKEN',
      ],
      nextStep: `Add a Cloudflare API token locally, then rerun with --env-file ${DEFAULT_ENV_PATH}.`,
    }, null, 2))
    fail('Missing Cloudflare WAF ensure inputs.')
  }
  const result = await ensureSandboxCloudflareWafRules({
    token,
    targetZoneId: zoneId(),
    hostnames: protectedHostnames(),
    dryRun: hasFlag('--dry-run'),
    includeApiBurstRateLimit: hasFlag('--include-api-burst-rate-limit'),
  })
  result.envFile = outputBase.envFile
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? redactProviderMessage(error.message) : redactProviderMessage(String(error)))
    process.exit(1)
  })
}
