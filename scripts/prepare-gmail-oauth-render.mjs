/* global Buffer, URL, URLSearchParams, console, fetch, process, setTimeout, clearTimeout */
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const DEFAULT_SERVICE_ID = 'srv-d6ns31h4tr6s73c9i8g0'
const DEFAULT_MAILBOX = 'booking@sandboxhotel.com'
const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:53682/oauth2callback'
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const RENDER_API_BASE = 'https://api.render.com/v1'

const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'

function hasFlag(args, name) {
  return args.includes(name)
}

function argValue(args, name) {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  return args[index + 1]
}

function nullableEnv(env, key) {
  const value = env[key]
  if (value === undefined || value === null) return null
  const normalized = String(value).trim()
  return normalized ? normalized : null
}

function positiveInt(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) fail(`${value} is not a positive integer.`)
  return parsed
}

function fail(message) {
  throw new Error(message)
}

function normalizeMailbox(value) {
  const normalized = String(value || DEFAULT_MAILBOX).trim().toLowerCase()
  if (!normalized || !normalized.includes('@')) fail('A valid booking mailbox is required.')
  return normalized
}

function serviceId(args) {
  const id = argValue(args, '--service-id') || DEFAULT_SERVICE_ID
  if (!/^srv-[a-z0-9]+$/i.test(id)) fail(`Invalid Render service id: ${id}`)
  return id
}

function oauthClientFile(args, env = process.env) {
  return argValue(args, '--credentials-file')
    || argValue(args, '--client-secret-file')
    || nullableEnv(env, 'BOOKING_EMAIL_GMAIL_OAUTH_CLIENT_FILE')
    || nullableEnv(env, 'GMAIL_OAUTH_CLIENT_FILE')
}

export function readGoogleOauthClientCredentials(filePath) {
  if (!filePath) return null
  const parsed = JSON.parse(readFileSync(resolve(filePath), 'utf8'))
  const config = parsed.installed || parsed.web || parsed
  return {
    clientId: config.client_id ? String(config.client_id) : null,
    clientSecret: config.client_secret ? String(config.client_secret) : null,
    redirectUris: Array.isArray(config.redirect_uris)
      ? config.redirect_uris.map((item) => String(item)).filter(Boolean)
      : [],
    source: 'credentials-file',
  }
}

export function resolveGmailOauthClient(args = [], env = process.env) {
  const filePath = oauthClientFile(args, env)
  const fileCredentials = filePath ? readGoogleOauthClientCredentials(filePath) : null
  return {
    clientId: argValue(args, '--client-id')
      || nullableEnv(env, 'BOOKING_EMAIL_GMAIL_CLIENT_ID')
      || nullableEnv(env, 'GMAIL_CLIENT_ID')
      || fileCredentials?.clientId
      || null,
    clientSecret: nullableEnv(env, 'BOOKING_EMAIL_GMAIL_CLIENT_SECRET')
      || nullableEnv(env, 'GMAIL_CLIENT_SECRET')
      || fileCredentials?.clientSecret
      || null,
    redirectUris: fileCredentials?.redirectUris || [],
    source: fileCredentials ? fileCredentials.source : 'args-env',
    filePath: filePath || null,
  }
}

function preferredRedirectUri(clientConfig = {}) {
  const uris = clientConfig.redirectUris || []
  if (uris.includes(DEFAULT_REDIRECT_URI)) return DEFAULT_REDIRECT_URI
  return uris.find((uri) => {
    try {
      const parsed = new URL(uri)
      return parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)
    } catch {
      return false
    }
  }) || uris[0] || DEFAULT_REDIRECT_URI
}

function redirectUri(args, env = process.env, clientConfig = {}) {
  const value = argValue(args, '--redirect-uri') || nullableEnv(env, 'BOOKING_EMAIL_GMAIL_REDIRECT_URI') || preferredRedirectUri(clientConfig)
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol)) fail('Redirect URI must use http or https.')
    return parsed.toString()
  } catch {
    fail('A valid Gmail OAuth redirect URI is required.')
  }
}

export function gmailOauthScopes(args = []) {
  const scopes = [GMAIL_READONLY_SCOPE]
  if (hasFlag(args, '--include-send-scope')) scopes.push(GMAIL_SEND_SCOPE)
  return scopes
}

export function buildGmailAuthorizationUrl({
  clientId: oauthClientId,
  redirectUri: oauthRedirectUri = DEFAULT_REDIRECT_URI,
  scopes = [GMAIL_READONLY_SCOPE],
  state = undefined,
} = {}) {
  if (!oauthClientId) fail('BOOKING_EMAIL_GMAIL_CLIENT_ID or GMAIL_CLIENT_ID is required to build the Gmail authorization URL.')
  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set('client_id', oauthClientId)
  url.searchParams.set('redirect_uri', oauthRedirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scopes.join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  if (state) url.searchParams.set('state', state)
  return url.toString()
}

function redactSensitive(value) {
  return String(value || '')
    .replace(/\b(access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization[_-]?code|code|token|secret|password)\b\s*[:=]\s*[^&\s,;}"']+/gi, '$1=[redacted]')
    .replace(/\bya29\.[A-Za-z0-9._-]+/g, 'ya29.[redacted]')
    .replace(/\b1\/\/[A-Za-z0-9._-]+/g, '1//[redacted]')
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8').trim()
}

export async function startAuthorizationCodeListener({ redirectUri: oauthRedirectUri, timeoutMs = 180000 } = {}) {
  const parsed = new URL(oauthRedirectUri || DEFAULT_REDIRECT_URI)
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    fail('The local OAuth listener requires an http://127.0.0.1 or http://localhost redirect URI.')
  }
  if (!parsed.port) fail('The local OAuth listener requires an explicit redirect URI port.')

  let settle
  let rejectCode
  let timeout
  const code = new Promise((resolve, reject) => {
    settle = resolve
    rejectCode = reject
  })

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', parsed)
    if (requestUrl.pathname !== parsed.pathname) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Not found.')
      return
    }

    const providerError = requestUrl.searchParams.get('error')
    const providerCode = requestUrl.searchParams.get('code')
    if (providerError) {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Authorization failed. You can close this tab.')
      rejectCode(new Error(redactSensitive(providerError)))
      return
    }
    if (!providerCode) {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Authorization code was missing. You can close this tab.')
      rejectCode(new Error('Authorization code was missing from the OAuth callback.'))
      return
    }

    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Authorization received. You can close this tab and return to the secure shell.')
    settle(providerCode)
  })

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(Number(parsed.port), parsed.hostname, resolveListen)
  })

  timeout = setTimeout(() => {
    rejectCode(new Error('Timed out waiting for the Gmail OAuth callback.'))
  }, timeoutMs)

  const close = () => new Promise((resolveClose) => {
    if (!server.listening) {
      resolveClose()
      return
    }
    server.close(() => resolveClose())
  })

  const address = server.address()
  const listenPort = typeof address === 'object' && address ? address.port : Number(parsed.port)
  return {
    code: code.finally(async () => {
      clearTimeout(timeout)
      await close()
    }),
    listenHost: parsed.hostname,
    listenPort,
    callbackPath: parsed.pathname,
    timeoutMs,
    close,
  }
}

async function authorizationCode(args, env = process.env) {
  const explicit = argValue(args, '--code')
  if (explicit && explicit !== '-') return explicit.trim()
  const envCode = nullableEnv(env, 'BOOKING_EMAIL_GMAIL_AUTHORIZATION_CODE') || nullableEnv(env, 'GMAIL_AUTHORIZATION_CODE')
  if (envCode) return envCode
  if (hasFlag(args, '--code-stdin') || explicit === '-') return readStdin()
  return null
}

export async function exchangeAuthorizationCode({
  code,
  clientId: oauthClientId,
  clientSecret: oauthClientSecret,
  redirectUri: oauthRedirectUri,
  fetchImpl = fetch,
} = {}) {
  if (!code) fail('Gmail OAuth authorization code is required. Pass --code-stdin or set BOOKING_EMAIL_GMAIL_AUTHORIZATION_CODE.')
  if (!oauthClientId) fail('BOOKING_EMAIL_GMAIL_CLIENT_ID or GMAIL_CLIENT_ID is required.')
  if (!oauthClientSecret) fail('BOOKING_EMAIL_GMAIL_CLIENT_SECRET or GMAIL_CLIENT_SECRET is required.')
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: oauthClientId,
      client_secret: oauthClientSecret,
      code,
      redirect_uri: oauthRedirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload?.refresh_token) {
    const providerMessage = payload?.error_description || payload?.error || 'Gmail OAuth code exchange failed or did not return a refresh token.'
    fail(redactSensitive(providerMessage))
  }
  return {
    refreshToken: String(payload.refresh_token),
    accessTokenPresent: Boolean(payload.access_token),
    expiresInPresent: payload.expires_in !== undefined,
    scope: payload.scope ? String(payload.scope) : null,
    tokenType: payload.token_type ? String(payload.token_type) : null,
  }
}

function renderCliToken() {
  const configPath = join(homedir(), '.render', 'cli.yaml')
  if (!existsSync(configPath)) return null

  const match = readFileSync(configPath, 'utf8').match(/^\s*key:\s*(\S+)\s*$/m)
  return match?.[1] || null
}

function renderBearerToken(args, env = process.env) {
  const apiKey = nullableEnv(env, 'RENDER_API_KEY')
  if (apiKey) return { token: apiKey, source: 'RENDER_API_KEY' }

  if (hasFlag(args, '--use-render-cli-token')) {
    const token = renderCliToken()
    if (token) return { token, source: 'Render CLI config' }
  }

  return null
}

async function putRenderEnvVar({ token, targetServiceId, key, value, fetchImpl = fetch }) {
  const response = await fetchImpl(`${RENDER_API_BASE}/services/${encodeURIComponent(targetServiceId)}/env-vars/${encodeURIComponent(key)}`, {
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
    fail(`Render env update failed for ${key}: ${response.status} ${redactSensitive(String(providerMessage).slice(0, 160))}`)
  }

  return { key, status: response.status, updated: true, valuePrinted: false }
}

async function applyRenderEnvVars({
  token,
  targetServiceId,
  mailbox,
  oauthClientId,
  oauthClientSecret,
  refreshToken,
  gmailUserId,
  fetchImpl = fetch,
}) {
  const variables = [
    { key: 'BOOKING_EMAIL_PRIMARY_MAILBOX', value: mailbox },
    { key: 'BOOKING_EMAIL_GMAIL_CLIENT_ID', value: oauthClientId },
    { key: 'BOOKING_EMAIL_GMAIL_CLIENT_SECRET', value: oauthClientSecret },
    { key: 'BOOKING_EMAIL_GMAIL_REFRESH_TOKEN', value: refreshToken },
  ]
  if (gmailUserId) variables.push({ key: 'BOOKING_EMAIL_GMAIL_USER_ID', value: gmailUserId })

  const results = []
  for (const variable of variables) {
    results.push(await putRenderEnvVar({
      token,
      targetServiceId,
      key: variable.key,
      value: variable.value,
      fetchImpl,
    }))
  }
  return results
}

function baseOutput(mode, args, env = process.env) {
  const oauthClient = resolveGmailOauthClient(args, env)
  return {
    generatedAt: new Date().toISOString(),
    purpose: 'safe booking Gmail OAuth refresh-token handoff for Render',
    mode,
    serviceId: serviceId(args),
    mailbox: normalizeMailbox(argValue(args, '--mailbox') || nullableEnv(env, 'BOOKING_EMAIL_PRIMARY_MAILBOX') || DEFAULT_MAILBOX),
    redirectUri: redirectUri(args, env, oauthClient),
    scopes: gmailOauthScopes(args),
    oauthClient: {
      clientIdPresent: Boolean(oauthClient.clientId),
      clientSecretPresent: Boolean(oauthClient.clientSecret),
      source: oauthClient.source,
      credentialsFileProvided: Boolean(oauthClient.filePath),
      redirectUriCount: oauthClient.redirectUris.length,
      valuesPrinted: false,
    },
    redaction: {
      clientSecret: 'omitted',
      authorizationCode: 'omitted',
      accessToken: 'omitted',
      refreshToken: 'omitted',
      renderAuthToken: 'omitted',
    },
  }
}

async function main(args = process.argv.slice(2), env = process.env) {
  const mode = (hasFlag(args, '--exchange-code') || hasFlag(args, '--listen')) ? 'exchange-code' : 'authorize-url'
  const output = baseOutput(mode, args, env)
  const oauthClient = resolveGmailOauthClient(args, env)
  const oauthClientId = oauthClient.clientId

  if (mode === 'authorize-url') {
    output.authorizationUrl = buildGmailAuthorizationUrl({
      clientId: oauthClientId,
      redirectUri: output.redirectUri,
      scopes: output.scopes,
      state: argValue(args, '--state'),
    })
    output.nextStep = 'Authorize the booking mailbox, then rerun with --exchange-code --code-stdin --apply-render from a secure shell.'
    console.log(JSON.stringify(output, null, 2))
    return output
  }

  const oauthClientSecret = oauthClient.clientSecret
  let listener = null
  let code = null
  if (hasFlag(args, '--listen')) {
    output.authorizationUrl = buildGmailAuthorizationUrl({
      clientId: oauthClientId,
      redirectUri: output.redirectUri,
      scopes: output.scopes,
      state: argValue(args, '--state'),
    })
    listener = await startAuthorizationCodeListener({
      redirectUri: output.redirectUri,
      timeoutMs: positiveInt(argValue(args, '--timeout-ms'), 180000),
    })
    output.listener = {
      enabled: true,
      host: listener.listenHost,
      port: listener.listenPort,
      callbackPath: listener.callbackPath,
      timeoutMs: listener.timeoutMs,
      authorizationCodePrinted: false,
    }
    output.nextStep = 'Open authorizationUrl with the booking mailbox signed in. The local listener will capture the callback and then continue.'
    console.log(JSON.stringify(output, null, 2))
    code = await listener.code
  } else {
    code = await authorizationCode(args, env)
  }
  const exchanged = await exchangeAuthorizationCode({
    code,
    clientId: oauthClientId,
    clientSecret: oauthClientSecret,
    redirectUri: output.redirectUri,
  })

  output.credential = {
    clientIdPresent: Boolean(oauthClientId),
    clientSecretPresent: Boolean(oauthClientSecret),
    refreshTokenReceived: Boolean(exchanged.refreshToken),
    accessTokenReceived: exchanged.accessTokenPresent,
    expiresInPresent: exchanged.expiresInPresent,
    providerScope: exchanged.scope ? exchanged.scope.split(/\s+/).sort() : null,
    tokenType: exchanged.tokenType,
    valuesPrinted: false,
  }

  if (hasFlag(args, '--apply-render')) {
    const auth = renderBearerToken(args, env)
    if (!auth) fail('Render API auth is required for --apply-render. Set RENDER_API_KEY or pass --use-render-cli-token from an authenticated Render CLI session.')
    output.renderAuthSource = auth.source
    output.render = {
      applyRequested: true,
      results: await applyRenderEnvVars({
        token: auth.token,
        targetServiceId: output.serviceId,
        mailbox: output.mailbox,
        oauthClientId,
        oauthClientSecret,
        refreshToken: exchanged.refreshToken,
        gmailUserId: argValue(args, '--gmail-user-id') || nullableEnv(env, 'BOOKING_EMAIL_GMAIL_USER_ID') || nullableEnv(env, 'GMAIL_USER_ID'),
      }),
    }
    output.nextStep = 'Redeploy the Render service, then run render:gmail-oauth:status and a dry-run booking-email backfill.'
  } else {
    output.render = {
      applyRequested: false,
    }
    output.nextStep = 'No Render mutation was requested. Rerun with --apply-render to write the refresh-token tuple directly to Render without printing it.'
  }

  console.log(JSON.stringify(output, null, 2))
  return output
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] || '')) {
  main().catch((error) => {
    console.error(redactSensitive(error instanceof Error ? error.message : String(error)))
    process.exit(1)
  })
}

export { main as runPrepareGmailOauthRender }
