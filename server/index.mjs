import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(__dirname, '..', 'dist')
const port = Number(process.env.PORT || 10000)
const host = process.env.HOST || '0.0.0.0'

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(payload))
}

async function databaseStatus(deep) {
  if (!process.env.DATABASE_URL) {
    return { configured: false, ok: null }
  }

  if (!deep) {
    return { configured: true, ok: null }
  }

  let prisma
  try {
    const { PrismaClient } = await import('@prisma/client')
    prisma = new PrismaClient()
    await prisma.$queryRaw`SELECT 1`
    return { configured: true, ok: true }
  } catch (error) {
    return {
      configured: true,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await prisma?.$disconnect?.()
  }
}

async function healthPayload(deep = false) {
  return {
    ok: true,
    service: 'sandbox-hotel-pms',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    database: await databaseStatus(deep),
    integrations: {
      lineWebhookConfigured: Boolean(process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN),
    },
  }
}

async function sendHealth(request, response) {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  sendJson(response, 200, await healthPayload(url.searchParams.get('deep') === '1'))
}

function forbiddenPath(pathname) {
  return pathname.includes('\0') || pathname.split(/[\\/]/).includes('..')
}

async function serveStatic(request, response) {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  const pathname = decodeURIComponent(url.pathname)

  if (forbiddenPath(pathname)) {
    sendJson(response, 403, { ok: false, error: 'Forbidden path' })
    return
  }

  const cleanedPath = normalize(pathname).replace(/^[/\\]+/, '')
  let filePath = resolve(join(distDir, cleanedPath || 'index.html'))

  if (!filePath.startsWith(distDir)) {
    sendJson(response, 403, { ok: false, error: 'Forbidden path' })
    return
  }

  try {
    const fileStat = await stat(filePath)
    if (fileStat.isDirectory()) {
      filePath = join(filePath, 'index.html')
    }
  } catch {
    if (request.method === 'GET' && request.headers.accept?.includes('text/html')) {
      filePath = join(distDir, 'index.html')
    } else {
      sendJson(response, 404, { ok: false, error: 'Not found' })
      return
    }
  }

  try {
    const contentType = mimeTypes[extname(filePath)] || 'application/octet-stream'
    response.writeHead(200, {
      'content-type': contentType,
      'cache-control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    })

    if (request.method === 'HEAD') {
      response.end()
      return
    }

    createReadStream(filePath).pipe(response)
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function handleLineWebhook(request, response) {
  if (request.method === 'GET') {
    sendJson(response, 200, {
      ok: true,
      configured: Boolean(process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN),
    })
    return
  }

  sendJson(response, 501, {
    ok: false,
    error: 'LINE webhook processing is not implemented in this backend shell yet.',
  })
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)

    if (request.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/api/health')) {
      await sendHealth(request, response)
      return
    }

    if (url.pathname === '/api/line/webhook') {
      await handleLineWebhook(request, response)
      return
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      await serveStatic(request, response)
      return
    }

    sendJson(response, 405, { ok: false, error: 'Method not allowed' })
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

server.listen(port, host, () => {
  console.log(`sandbox-hotel-pms listening on http://${host}:${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
