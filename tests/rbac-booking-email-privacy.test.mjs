import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BOOKING_EMAIL_EVIDENCE_PERMISSION,
  BOOKING_EMAIL_REVIEW_PERMISSION,
  LITE_PAYMENT_RECONCILIATION_PERMISSION,
  canPerformAction,
} from '../server/rbac.mjs'

const role = (value) => ({ role: value })

test('booking-email review permission is limited to operational booking roles', () => {
  assert.equal(canPerformAction(role('ADMIN'), BOOKING_EMAIL_REVIEW_PERMISSION), true)
  assert.equal(canPerformAction(role('MANAGER'), BOOKING_EMAIL_REVIEW_PERMISSION), true)
  assert.equal(canPerformAction(role('FRONT_DESK'), BOOKING_EMAIL_REVIEW_PERMISSION), true)
  assert.equal(canPerformAction(role('HOUSEKEEPING'), BOOKING_EMAIL_REVIEW_PERMISSION), false)
  assert.equal(canPerformAction(role('CASHIER'), BOOKING_EMAIL_REVIEW_PERMISSION), false)
})

test('raw booking-email evidence permission is elevated above review access', () => {
  assert.equal(canPerformAction(role('ADMIN'), BOOKING_EMAIL_EVIDENCE_PERMISSION), true)
  assert.equal(canPerformAction(role('MANAGER'), BOOKING_EMAIL_EVIDENCE_PERMISSION), true)
  assert.equal(canPerformAction(role('FRONT_DESK'), BOOKING_EMAIL_EVIDENCE_PERMISSION), false)
  assert.equal(canPerformAction(role('HOUSEKEEPING'), BOOKING_EMAIL_EVIDENCE_PERMISSION), false)
  assert.equal(canPerformAction(role('CASHIER'), BOOKING_EMAIL_EVIDENCE_PERMISSION), false)
})

test('cashier access is limited to Lite payment reconciliation without legacy guest or booking visibility', () => {
  const cashier = role('CASHIER')

  assert.equal(canPerformAction(cashier, LITE_PAYMENT_RECONCILIATION_PERMISSION), true)
  assert.equal(canPerformAction(cashier, 'view:reservations'), false)
  assert.equal(canPerformAction(cashier, 'view:guests'), false)
  assert.equal(canPerformAction(cashier, 'view:board'), false)
  assert.equal(canPerformAction(cashier, BOOKING_EMAIL_REVIEW_PERMISSION), false)
})
