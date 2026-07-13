/* global AbortController, fetch, TextDecoder */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'

import { createRealtimeEventHub } from '../server/realtime-events.mjs'

class MockSseResponse extends EventEmitter {
  constructor() {
    super()
    this.destroyed = false
    this.writableEnded = false
    this.chunks = []
    this.statusCode = null
    this.headers = null
  }

  writeHead(statusCode, headers) {
    this.statusCode = statusCode
    this.headers = headers
  }

  flushHeaders() {}

  write(chunk) {
    this.chunks.push(String(chunk))
    return true
  }

  end() {
    this.writableEnded = true
  }
}

test('completed request side does not disconnect a still-open SSE response', async () => {
  const request = new EventEmitter()
  const response = new MockSseResponse()
  const hub = createRealtimeEventHub({ heartbeatMs: 60_000 })

  try {
    const connected = await hub.handle(request, response, {
      requireUser: async () => ({ id: 'front-desk-user' }),
      requirePermission: () => undefined,
    })
    assert.equal(connected.connected, true)
    assert.equal(hub.getStatus().clients, 1)

    request.emit('close')
    assert.equal(hub.getStatus().clients, 1, 'request completion must not remove an SSE client')

    const published = hub.publish('reservation.changed', {
      entityId: 'reservation-1',
      reason: 'reservation_created',
    })
    assert.equal(published.delivered, 1)
    assert.match(response.chunks.join(''), /event: reservation\.changed/)

    response.emit('close')
    assert.equal(hub.getStatus().clients, 0, 'response close must remove the SSE client')
  } finally {
    hub.close()
  }
})

test('real HTTP SSE response remains connected and receives a later publication', async () => {
  const hub = createRealtimeEventHub({ heartbeatMs: 60_000 })
  const server = createServer(async (request, response) => {
    if (request.url === '/events') {
      await hub.handle(request, response, {
        requireUser: async () => ({ id: 'front-desk-user' }),
        requirePermission: () => undefined,
      })
      return
    }
    if (request.url === '/publish') {
      const result = hub.publish('reservation.changed', {
        entityId: 'reservation-2',
        reason: 'reservation_created',
      })
      response.end(JSON.stringify(result))
      return
    }
    response.statusCode = 404
    response.end()
  })
  const controller = new AbortController()

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    const baseUrl = `http://127.0.0.1:${address.port}`
    const stream = await fetch(`${baseUrl}/events`, { signal: controller.signal })
    assert.equal(stream.status, 200)
    const reader = stream.body.getReader()
    const decoder = new TextDecoder()
    const initial = decoder.decode((await reader.read()).value)
    assert.match(initial, /event: sync-required/)
    assert.equal(hub.getStatus().clients, 1)

    const publishResponse = await fetch(`${baseUrl}/publish`)
    const published = await publishResponse.json()
    assert.equal(published.delivered, 1)
    const update = decoder.decode((await reader.read()).value)
    assert.match(update, /event: reservation\.changed/)
  } finally {
    controller.abort()
    hub.close()
    await new Promise((resolve) => server.close(resolve))
  }
})
