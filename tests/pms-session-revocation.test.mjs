import assert from 'node:assert/strict'
import test from 'node:test'

import {
  authenticateUser,
  deactivateUser,
  getAuthenticatedUser,
  updateUser,
} from '../server/pms-service.mjs'
import { createPasswordHash } from '../server/security.mjs'

const actor = {
  id: 'admin-session-test',
  username: 'admin.session.test',
  role: 'ADMIN',
}

function existingUser(overrides = {}) {
  return {
    id: 'user-session-test',
    email: 'manager@example.test',
    username: 'manager.session.test',
    passwordHash: createPasswordHash('Current secure password 123!'),
    firstName: 'Session',
    lastName: 'Manager',
    role: 'MANAGER',
    active: true,
    lockedAt: null,
    failedLoginAttempts: 0,
    sessionVersion: 7,
    ...overrides,
  }
}

function applyUserUpdate(user, data) {
  const next = { ...user, ...data }
  if (data.sessionVersion?.increment) {
    next.sessionVersion = user.sessionVersion + data.sessionVersion.increment
  }
  return next
}

test('authenticated user lookup requires active, unlocked, matching-version session state', async () => {
  let capturedWhere
  const user = existingUser()
  const prisma = {
    user: {
      findFirst: async ({ where }) => {
        capturedWhere = where
        return where.id === user.id
          && where.active === true
          && where.lockedAt === null
          && where.sessionVersion === user.sessionVersion
          ? user
          : null
      },
    },
  }

  assert.equal(await getAuthenticatedUser(prisma, {
    sub: user.id,
    sessionVersion: user.sessionVersion,
  }), user)
  assert.deepEqual(capturedWhere, {
    id: user.id,
    active: true,
    lockedAt: null,
    sessionVersion: user.sessionVersion,
  })

  assert.equal(await getAuthenticatedUser(prisma, {
    sub: user.id,
    sessionVersion: user.sessionVersion - 1,
  }), null)
})

test('password updates increment the session version and revoke existing sessions', async () => {
  const user = existingUser()
  let updateData
  const prisma = {
    user: {
      findUnique: async () => user,
      findFirst: async () => null,
      update: async ({ data }) => {
        updateData = data
        return applyUserUpdate(user, data)
      },
    },
    auditLog: { create: async ({ data }) => data },
  }

  const updated = await updateUser(prisma, user.id, {
    password: 'Replacement secure password 123!',
  }, actor)

  assert.deepEqual(updateData.sessionVersion, { increment: 1 })
  assert.equal(updated.sessionVersion, user.sessionVersion + 1)
  assert.notEqual(updateData.passwordHash, user.passwordHash)
})

test('deactivation increments the session version and revokes existing sessions', async () => {
  const user = existingUser()
  let updateData
  const prisma = {
    user: {
      findUnique: async () => user,
      update: async ({ data }) => {
        updateData = data
        return applyUserUpdate(user, data)
      },
    },
    auditLog: { create: async ({ data }) => data },
  }

  const updated = await deactivateUser(prisma, user.id, actor)

  assert.deepEqual(updateData, {
    active: false,
    sessionVersion: { increment: 1 },
  })
  assert.equal(updated.active, false)
  assert.equal(updated.sessionVersion, user.sessionVersion + 1)
})

test('the failed-login lockout transition increments the session version', async () => {
  const user = existingUser({ failedLoginAttempts: 2 })
  let updateData
  const prisma = {
    user: {
      findFirst: async () => user,
      update: async ({ data }) => {
        updateData = data
        return applyUserUpdate(user, data)
      },
    },
  }

  await assert.rejects(
    () => authenticateUser(prisma, user.username, 'Definitely the wrong password'),
    (error) => error?.statusCode === 423 && /account is locked/i.test(error.message),
  )

  assert.equal(updateData.failedLoginAttempts, 3)
  assert.ok(updateData.lockedAt instanceof Date)
  assert.deepEqual(updateData.sessionVersion, { increment: 1 })
})
