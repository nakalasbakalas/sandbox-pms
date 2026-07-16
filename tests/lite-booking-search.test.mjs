import assert from 'node:assert/strict'
import test from 'node:test'

import { bookingSearchWhere } from '../server/lite-service.mjs'

test('Lite booking search matches every full-name token across first and last name', () => {
  const filters = bookingSearchWhere('Live Sync 123')
  const combinedNameFilter = filters.at(-1)

  assert.deepEqual(combinedNameFilter, {
    guest: {
      is: {
        AND: [
          { OR: [{ firstName: { contains: 'Live', mode: 'insensitive' } }, { lastName: { contains: 'Live', mode: 'insensitive' } }] },
          { OR: [{ firstName: { contains: 'Sync', mode: 'insensitive' } }, { lastName: { contains: 'Sync', mode: 'insensitive' } }] },
          { OR: [{ firstName: { contains: '123', mode: 'insensitive' } }, { lastName: { contains: '123', mode: 'insensitive' } }] },
        ],
      },
    },
  })
})

test('single-token booking search keeps the compact guest filter only', () => {
  const filters = bookingSearchWhere('Live')
  assert.equal(filters.length, 6)
  assert.equal(filters.at(-1).guest.is.OR[0].firstName.contains, 'Live')
})
