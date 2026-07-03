/* global console, fetch, process */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const DEFAULT_SERVICE_ID = 'srv-d6ns31h4tr6s73c9i8g0'
const DEFAULT_MAILBOX = 'booking@sandboxhotel.com'
const RENDER_API_BASE = 'https://api.render.com/v1'

const REQUIRED_SECRET_KEYS = [
  'BOOKING_EMAIL_GMAIL_CLIENT_ID',
  'BOOKING_EMAIL_GMAIL_CLIENT_SECRET',
  'BOOKING_EMAIL_GMAIL_REFRESH_TOKEN',
]

const OPTIONAL_KEYS = [
  'BOOKING_EMAIL_GMAIL_USER_ID',
]

const STATUS_KEYS = [
  'BOOKING_EMAIL_PRIMARY_MAILBOX',
  'BOOKING_EMAIL_GMAIL_USER_ID',
  'BOOKING_EMAIL_GMAIL_ACCESS_TOKEN',
  'BOOKING_EMAIL_GMAIL_CLIENT_ID',
  'BOOKING_EMAIL_GMAIL_CLIENT_SECRET',
  'BOOKING_EMAIL_GMAIL_REFRESH_TOKEN',
  'GMAIL_ACCESS_TOKEN',
  'GMAIL_CLIENT_ID',
  'GMAIL_CLIENT_SECRET',
  'GMAIL_REFRESH_TOKEN',
]

const CREDENTIAL_OPTIONS = [
  {
    name: 'booking-specific refresh-token tuple',
    keys: [
      'BOOKING_EMAIL_GMAIL_CLIENT_ID',
      'BOOKING_EMAIL_GMAIL_CLIENT_SECRET',
      'BOOKING_EMAIL_GMAIL_REFRESH_TOKEN',
    ],
  },
  {
    name: 'booking-specific access token',
    keys: [
      'BOOKING_EMAIL_GMAIL_ACCESS_TOKEN',
    ],
  },
  {
    name: 'fallback refresh-token tuple',
    keys: [
      'GMAIL_CLIENT_ID',
      'GMAIL_CLIENT_SECRET',
      'GMAIL_REFRESH_TOKEN',
    ],
  },
  {
    name: 'fallback access token',
    keys: [
      'GMAIL_ACCESS_TOKEN',
    ],
  },
]

function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  return process.argv[index + 1]
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function fail(message) {
  throw new Error(message)
}

function nullableEnv(key) {
  const value = process.env[key]
  if (value === undefined || value === null) return null
  const normalized = String(value).trim()
  return normalized ? normalized : null
}

function renderCliToken() {
  const configPath = join(homedir(), '.render', 'cli.yaml')
  if (!existsSync(configPath)) return null

  const match = readFileSync(configPath, 'utf8').match(/^\s*key:\s*(\S+)\s*$/m)
  return match?.[1] || null
}

function renderBearerToken() {
  const apiKey = nullableEnv('RENDER_API_KEY')
  if (apiKey) return { token: apiKey, source: 'RENDER_API_KEY' }

  if (hasFlag('--use-render-cli-token')) {
    const token = renderCliToken()
    if (token) return { token, source: 'Render CLI config' }
  }

  return null
}

function serviceId() {
  const id = argValue('--service-id') || DEFAULT_SERVICE_ID
  if (!/^srv-[a-z0-9]+$/i.test(id)) fail(`Invalid Render service id: ${id}`)
  return id
}

function mailboxValue() {
  const value = argValue('--mailbox') || nullableEnv('BOOKING_EMAIL_PRIMARY_MAILBOX') || DEFAULT_MAILBOX
  const normalized = String(value).trim().toLowerCase()
  if (!normalized || !normalized.includes('@')) fail('A valid booking mailbox is required.')
  return normalized
}

function plannedVariables() {
  const variables = [
    {
      key: 'BOOKING_EMAIL_PRIMARY_MAILBOX',
      value: mailboxValue(),
      required: true,
      secret: false,
      source: argValue('--mailbox') ? '--mailbox' : nullableEnv('BOOKING_EMAIL_PRIMARY_MAILBOX') ? 'env' : 'default',
    },
  ]

  for (const key of REQUIRED_SECRET_KEYS) {
    variables.push({
      key,
      value: nullableEnv(key),
      required: true,
      secret: true,
      source: 'env',
    })
  }

  for (const key of OPTIONAL_KEYS) {
    const value = nullableEnv(key)
    if (value) {
      variables.push({
        key,
        value,
        required: false,
        secret: false,
        source: 'env',
      })
    }
  }

  return variables
}

function summarizeVariable(variable) {
  return {
    key: variable.key,
    required: variable.required,
    secret: variable.secret,
    source: variable.source,
    valuePresent: Boolean(variable.value),
    action: variable.value ? 'set' : 'missing',
  }
}

async function putRenderEnvVar({ token, serviceId: targetServiceId, key, value }) {
  const response = await fetch(`${RENDER_API_BASE}/services/${encodeURIComponent(targetServiceId)}/env-vars/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ value }),
  })

  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const providerMessage = body?.message || body?.error || response.statusText || 'Render API request failed.'
    fail(`Render env update failed for ${key}: ${response.status} ${String(providerMessage).slice(0, 160)}`)
  }

  return { key, status: response.status, updated: true }
}

async function getRenderEnvVarStatus({ token, serviceId: targetServiceId, key }) {
  const response = await fetch(`${RENDER_API_BASE}/services/${encodeURIComponent(targetServiceId)}/env-vars/${encodeURIComponent(key)}`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
  })

  if (response.status === 404) {
    return {
      key,
      exists: false,
      httpStatus: response.status,
      valuePrinted: false,
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const providerMessage = body?.message || body?.error || response.statusText || 'Render API request failed.'
    fail(`Render env lookup failed for ${key}: ${response.status} ${String(providerMessage).slice(0, 160)}`)
  }

  return {
    key,
    exists: true,
    httpStatus: response.status,
    valuePrinted: false,
  }
}

async function main() {
  const apply = hasFlag('--apply')
  const status = hasFlag('--status') || hasFlag('--check-render')
  const targetServiceId = serviceId()
  if (status) {
    const auth = renderBearerToken()
    const output = {
      generatedAt: new Date().toISOString(),
      purpose: 'safe Render Gmail OAuth env-var status',
      mode: 'status',
      serviceId: targetServiceId,
      redaction: {
        values: 'omitted',
        renderAuthToken: 'omitted',
      },
    }

    if (!auth) {
      console.log(JSON.stringify(output, null, 2))
      fail('Render API auth is required for --status. Set RENDER_API_KEY or pass --use-render-cli-token from an authenticated Render CLI session.')
    }

    output.renderAuthSource = auth.source
    output.renderEnvVars = []
    for (const key of STATUS_KEYS) {
      output.renderEnvVars.push(await getRenderEnvVarStatus({
        token: auth.token,
        serviceId: targetServiceId,
        key,
      }))
    }

    const existingKeys = new Set(output.renderEnvVars.filter((item) => item.exists).map((item) => item.key))
    output.credentialOptions = CREDENTIAL_OPTIONS.map((option) => ({
      name: option.name,
      ready: option.keys.every((key) => existingKeys.has(key)),
      keys: option.keys,
    }))
    output.ready = output.credentialOptions.some((option) => option.ready)

    console.log(JSON.stringify(output, null, 2))
    if (!output.ready && hasFlag('--require-ready')) fail('Render Gmail OAuth credentials are not ready.')
    return
  }

  const variables = plannedVariables()
  const missingRequired = variables.filter((variable) => variable.required && !variable.value)
  const output = {
    generatedAt: new Date().toISOString(),
    purpose: 'safe Render Gmail OAuth env-var sync',
    mode: apply ? 'apply' : 'dry-run',
    serviceId: targetServiceId,
    variables: variables.map(summarizeVariable),
    redaction: {
      values: 'omitted',
      renderAuthToken: 'omitted',
    },
  }

  if (missingRequired.length > 0) {
    output.ready = false
    output.missingRequiredKeys = missingRequired.map((variable) => variable.key)
    console.log(JSON.stringify(output, null, 2))
    fail('Missing required Render Gmail OAuth inputs. Set the missing keys in the local process environment and rerun.')
  }

  output.ready = true

  if (!apply) {
    console.log(JSON.stringify(output, null, 2))
    return
  }

  const auth = renderBearerToken()
  if (!auth) {
    console.log(JSON.stringify(output, null, 2))
    fail('Render API auth is required for --apply. Set RENDER_API_KEY or pass --use-render-cli-token from an authenticated Render CLI session.')
  }

  output.renderAuthSource = auth.source
  output.results = []
  for (const variable of variables.filter((item) => item.value)) {
    output.results.push(await putRenderEnvVar({
      token: auth.token,
      serviceId: targetServiceId,
      key: variable.key,
      value: variable.value,
    }))
  }

  console.log(JSON.stringify(output, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
