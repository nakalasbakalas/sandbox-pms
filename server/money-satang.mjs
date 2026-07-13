export const MONEY_SATANG_MIN = -2_147_483_648
export const MONEY_SATANG_MAX = 2_147_483_647
export const TAX_RATE_BPS_MIN = 0
export const TAX_RATE_BPS_MAX = 10_000

const MAX_DECIMAL_INPUT_LENGTH = 256
const MAX_ABSOLUTE_EXPONENT = 1_000
const POWERS_OF_TEN = new Map([[0, 1n]])

export class MoneySatangError extends RangeError {
  constructor(message, code = 'INVALID_MONEY_SATANG') {
    super(message)
    this.name = 'MoneySatangError'
    this.code = code
  }
}

function labelText(label) {
  return typeof label === 'string' && label.trim() ? label.trim() : 'MoneySatang value'
}

function assertRangeOptions(minimum, maximum, label) {
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum)) {
    throw new TypeError(`${label} bounds must be safe integers.`)
  }
  if (minimum < MONEY_SATANG_MIN || maximum > MONEY_SATANG_MAX || minimum > maximum) {
    throw new RangeError(`${label} bounds must fit the PostgreSQL INTEGER MoneySatang range.`)
  }
}

export function assertMoneySatang(value, {
  label = 'MoneySatang value',
  nullable = false,
  minimum = MONEY_SATANG_MIN,
  maximum = MONEY_SATANG_MAX,
} = {}) {
  const normalizedLabel = labelText(label)
  assertRangeOptions(minimum, maximum, normalizedLabel)

  if (value == null) {
    if (nullable) return null
    throw new MoneySatangError(`${normalizedLabel} is required.`, 'MONEY_SATANG_REQUIRED')
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MoneySatangError(`${normalizedLabel} must be a finite number.`, 'MONEY_SATANG_NOT_FINITE')
  }
  if (!Number.isInteger(value)) {
    throw new MoneySatangError(`${normalizedLabel} must not contain fractional satang.`, 'MONEY_SATANG_FRACTIONAL')
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneySatangError(`${normalizedLabel} must be a JavaScript safe integer.`, 'MONEY_SATANG_UNSAFE')
  }
  if (value < minimum || value > maximum) {
    throw new MoneySatangError(
      `${normalizedLabel} is outside the supported PostgreSQL INTEGER range.`,
      'MONEY_SATANG_OUT_OF_RANGE',
    )
  }
  return Object.is(value, -0) ? 0 : value
}

function powerOfTen(exponent) {
  if (!POWERS_OF_TEN.has(exponent)) {
    POWERS_OF_TEN.set(exponent, 10n ** BigInt(exponent))
  }
  return POWERS_OF_TEN.get(exponent)
}

function normalizeDecimalInput(value, label) {
  let text
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new MoneySatangError(`${label} must be finite.`, 'THB_NOT_FINITE')
    }
    text = value.toString()
  } else if (typeof value === 'string') {
    text = value.trim()
  } else {
    throw new MoneySatangError(`${label} must be a number or decimal string.`, 'THB_NOT_DECIMAL')
  }

  if (!text || text.length > MAX_DECIMAL_INPUT_LENGTH) {
    throw new MoneySatangError(`${label} is not a supported decimal amount.`, 'THB_NOT_DECIMAL')
  }

  if (text.includes(',')) {
    const groupedDecimal = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:[eE][+-]?\d+)?$/
    if (!groupedDecimal.test(text)) {
      throw new MoneySatangError(`${label} has invalid thousands separators.`, 'THB_INVALID_GROUPING')
    }
    text = text.replaceAll(',', '')
  }

  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text)
  if (!match) {
    throw new MoneySatangError(`${label} is not a supported decimal amount.`, 'THB_NOT_DECIMAL')
  }

  const exponent = match[4] ? Number(match[4]) : 0
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_ABSOLUTE_EXPONENT) {
    throw new MoneySatangError(`${label} exponent is outside the supported range.`, 'THB_EXPONENT_OUT_OF_RANGE')
  }

  return {
    negative: match[1] === '-',
    digits: `${match[2]}${match[3] || ''}`,
    decimalPlaces: (match[3] || '').length - exponent,
  }
}

function decimalToScaledInteger(value, scale, {
  label,
  minimum,
  maximum,
  nullable = false,
} = {}) {
  if (value == null) {
    if (nullable) return null
    throw new MoneySatangError(`${label} is required.`, 'THB_REQUIRED')
  }

  const { negative, digits, decimalPlaces } = normalizeDecimalInput(value, label)
  let magnitude = BigInt(digits)
  const shift = scale - decimalPlaces

  if (shift >= 0) {
    if (magnitude !== 0n && shift > 20) {
      throw new MoneySatangError(`${label} is outside the supported range.`, 'MONEY_SATANG_OUT_OF_RANGE')
    }
    magnitude *= powerOfTen(shift)
  } else {
    const divisor = powerOfTen(-shift)
    const quotient = magnitude / divisor
    const remainder = magnitude % divisor
    magnitude = quotient + (remainder * 2n >= divisor ? 1n : 0n)
  }

  const signed = negative && magnitude !== 0n ? -magnitude : magnitude
  if (signed < BigInt(minimum) || signed > BigInt(maximum)) {
    throw new MoneySatangError(`${label} is outside the supported range.`, 'MONEY_SATANG_OUT_OF_RANGE')
  }

  return Number(signed)
}

export function thbToSatang(value, {
  label = 'THB amount',
  nullable = false,
  minimum = MONEY_SATANG_MIN,
  maximum = MONEY_SATANG_MAX,
} = {}) {
  const normalizedLabel = labelText(label)
  assertRangeOptions(minimum, maximum, normalizedLabel)
  return decimalToScaledInteger(value, 2, {
    label: normalizedLabel,
    minimum,
    maximum,
    nullable,
  })
}

export function satangToThb(value, options = {}) {
  const satang = assertMoneySatang(value, options)
  return satang == null ? null : satang / 100
}

export function sumMoneySatang(...values) {
  let total = 0n
  for (const value of values) {
    total += BigInt(assertMoneySatang(value))
  }
  if (total < BigInt(MONEY_SATANG_MIN) || total > BigInt(MONEY_SATANG_MAX)) {
    throw new MoneySatangError('MoneySatang sum is outside the supported PostgreSQL INTEGER range.', 'MONEY_SATANG_OUT_OF_RANGE')
  }
  return Number(total)
}

export function dualWriteMoneyFromThb(value, options = {}) {
  const satang = thbToSatang(value, options)
  return {
    thb: satang == null ? null : satang / 100,
    satang,
  }
}

export function dualWriteMoneyFromSatang(value, options = {}) {
  const satang = assertMoneySatang(value, options)
  return {
    thb: satang == null ? null : satang / 100,
    satang,
  }
}

export function assertTaxRateBps(value, {
  label = 'Tax rate basis points',
  nullable = false,
} = {}) {
  return assertMoneySatang(value, {
    label,
    nullable,
    minimum: TAX_RATE_BPS_MIN,
    maximum: TAX_RATE_BPS_MAX,
  })
}

export function taxPercentToBasisPoints(value, {
  label = 'Tax rate percent',
  nullable = false,
} = {}) {
  return decimalToScaledInteger(value, 2, {
    label: labelText(label),
    minimum: TAX_RATE_BPS_MIN,
    maximum: TAX_RATE_BPS_MAX,
    nullable,
  })
}

export function basisPointsToTaxPercent(value, options = {}) {
  const basisPoints = assertTaxRateBps(value, options)
  return basisPoints == null ? null : basisPoints / 100
}

export function dualWriteTaxRateFromPercent(value, options = {}) {
  const basisPoints = taxPercentToBasisPoints(value, options)
  return {
    percent: basisPoints == null ? null : basisPoints / 100,
    basisPoints,
  }
}

export function dualWriteTaxRateFromBasisPoints(value, options = {}) {
  const basisPoints = assertTaxRateBps(value, options)
  return {
    percent: basisPoints == null ? null : basisPoints / 100,
    basisPoints,
  }
}
