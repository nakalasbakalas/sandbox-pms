import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MONEY_SATANG_MAX,
  MONEY_SATANG_MIN,
  MoneySatangError,
  assertMoneySatang,
  assertTaxRateBps,
  basisPointsToTaxPercent,
  dualWriteMoneyFromSatang,
  dualWriteMoneyFromThb,
  dualWriteTaxRateFromBasisPoints,
  dualWriteTaxRateFromPercent,
  satangToThb,
  sumMoneySatang,
  taxPercentToBasisPoints,
  thbToSatang,
} from '../server/money-satang.mjs'

test('MoneySatang rejects fractional, unsafe, non-finite, and int4-out-of-range values', () => {
  assert.equal(assertMoneySatang(0), 0)
  assert.equal(assertMoneySatang(-0), 0)
  assert.equal(assertMoneySatang(MONEY_SATANG_MIN), MONEY_SATANG_MIN)
  assert.equal(assertMoneySatang(MONEY_SATANG_MAX), MONEY_SATANG_MAX)

  assert.throws(() => assertMoneySatang(1.5), (error) => (
    error instanceof MoneySatangError && error.code === 'MONEY_SATANG_FRACTIONAL'
  ))
  assert.throws(() => assertMoneySatang(Number.MAX_SAFE_INTEGER + 1), (error) => (
    error instanceof MoneySatangError && error.code === 'MONEY_SATANG_UNSAFE'
  ))
  assert.throws(() => assertMoneySatang(Infinity), (error) => (
    error instanceof MoneySatangError && error.code === 'MONEY_SATANG_NOT_FINITE'
  ))
  assert.throws(() => assertMoneySatang(MONEY_SATANG_MAX + 1), (error) => (
    error instanceof MoneySatangError && error.code === 'MONEY_SATANG_OUT_OF_RANGE'
  ))
  assert.throws(() => assertMoneySatang('100'), (error) => (
    error instanceof MoneySatangError && error.code === 'MONEY_SATANG_NOT_FINITE'
  ))
})

test('THB conversion follows exact decimal half-away-from-zero rounding', () => {
  assert.equal(thbToSatang('750'), 75_000)
  assert.equal(thbToSatang('1,234.56'), 123_456)
  assert.equal(thbToSatang(0.1 + 0.2), 30)
  assert.equal(thbToSatang('999.995'), 100_000)
  assert.equal(thbToSatang('-999.995'), -100_000)
  assert.equal(thbToSatang('1e-2'), 1)
  assert.equal(thbToSatang('-0.004'), 0)
  assert.equal(satangToThb(123_456), 1234.56)

  assert.throws(() => thbToSatang('12,34.56'), (error) => (
    error instanceof MoneySatangError && error.code === 'THB_INVALID_GROUPING'
  ))
  assert.throws(() => thbToSatang('21474836.475'), (error) => (
    error instanceof MoneySatangError && error.code === 'MONEY_SATANG_OUT_OF_RANGE'
  ))
})

test('dual-write helpers derive both representations from one validated integer', () => {
  assert.deepEqual(dualWriteMoneyFromThb('0.10'), { thb: 0.1, satang: 10 })
  assert.deepEqual(dualWriteMoneyFromThb(0.1 + 0.2), { thb: 0.3, satang: 30 })
  assert.deepEqual(dualWriteMoneyFromSatang(99_995), { thb: 999.95, satang: 99_995 })
  assert.deepEqual(
    dualWriteMoneyFromSatang(null, { nullable: true }),
    { thb: null, satang: null },
  )
  assert.deepEqual(
    dualWriteMoneyFromThb(null, { nullable: true }),
    { thb: null, satang: null },
  )
})

test('MoneySatang sums are exact and reject database-range overflow', () => {
  assert.equal(sumMoneySatang(10, 20, -5), 25)
  assert.throws(() => sumMoneySatang(MONEY_SATANG_MAX, 1), (error) => (
    error instanceof MoneySatangError && error.code === 'MONEY_SATANG_OUT_OF_RANGE'
  ))
})

test('tax basis-point helpers enforce 0 through 100 percent', () => {
  assert.equal(taxPercentToBasisPoints('7'), 700)
  assert.equal(taxPercentToBasisPoints('7.125'), 713)
  assert.equal(assertTaxRateBps(10_000), 10_000)
  assert.equal(basisPointsToTaxPercent(700), 7)
  assert.deepEqual(dualWriteTaxRateFromPercent('7.125'), { percent: 7.13, basisPoints: 713 })
  assert.deepEqual(dualWriteTaxRateFromBasisPoints(713), { percent: 7.13, basisPoints: 713 })
  assert.throws(() => taxPercentToBasisPoints('100.005'), (error) => (
    error instanceof MoneySatangError && error.code === 'MONEY_SATANG_OUT_OF_RANGE'
  ))
  assert.throws(() => assertTaxRateBps(-1), (error) => (
    error instanceof MoneySatangError && error.code === 'MONEY_SATANG_OUT_OF_RANGE'
  ))
})
