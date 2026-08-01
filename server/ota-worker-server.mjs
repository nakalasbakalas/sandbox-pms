import { createServer } from 'node:http'
import { executeSignedOtaWorkerTask } from './ota-adapters/index.mjs'
import { verifyOpsWorkerRequest } from './ops-worker-auth.mjs'

const MAX_BODY_BYTES = 256 * 1024
const port = Number(process.env.PORT || 10000)

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'",
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(payload))
}

async function readRawBody(request) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.')
      error.statusCode = 413
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)

    if (request.method === 'GET' && url.pathname === '/healthz') {
      sendJson(response, 200, {
        ok: true,
        service: 'sandbox-pms-ota-worker',
        mode: 'dry-run',
        revision: process.env.RENDER_GIT_COMMIT?.slice(0, 12) || 'local',
      })
      return
    }

    if (request.method !== 'POST' || url.pathname !== '/api/internal/ops/worker/tasks') {
      sendJson(response, 404, { ok: false, error: 'Not found' })
      return
    }

    const rawBody = await readRawBody(request)
    const workerAuth = verifyOpsWorkerRequest({ body: rawBody, headers: request.headers })
    if (!workerAuth.ok) {
      sendJson(response, workerAuth.statusCode || 401, {
        ok: false,
        error: workerAuth.error || 'Signed OTA worker request is required.',
      })
      return
    }

    let payload
    try {
      payload = JSON.parse(rawBody.toString('utf8'))
    } catch {
      sendJson(response, 400, { ok: false, error: 'Worker request body must be valid JSON.' })
      return
    }

    if (payload.dryRun !== true) {
      sendJson(response, 409, { ok: false, error: 'Staging OTA worker accepts dry-run tasks only.' })
      return
    }

    sendJson(response, 200, {
      ok: true,
      data: await executeSignedOtaWorkerTask(payload),
      message: 'Signed OTA worker request accepted in dry-run mode.',
    })
  } catch (error) {
    sendJson(response, Number(error?.statusCode || 500), {
      ok: false,
      error: Number(error?.statusCode || 500) >= 500
        ? 'OTA worker request failed.'
        : String(error?.message || 'OTA worker request failed.'),
    })
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`Sandbox PMS OTA worker listening on port ${port} in dry-run mode.`)
})
