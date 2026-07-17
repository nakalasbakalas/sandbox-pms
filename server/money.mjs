const SATANG_PER_BAHT = 100n
const MONEY_READ_AUTHORITIES = new Set(['legacy_float', 'satang'])

function decimalText(value, label) {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite monetary value.`)
    const text = String(value)
    if (!/[eE]/.test(text)) return text
    return value.toFixed(10).replace(/\.?(?:0+)$/, '')
  }
  const text = String(value ?? '').trim()
  if (!text) throw new TypeError(`${label} is required.`)
  return text
}

export function bahtToSatang(value, label = 'Money amount') {
  const text = decimalText(value, label)
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text)
  if (!match) throw new TypeError(`${label} must be a decimal baht value.`)

  const negative = match[1] === '-'
  const whole = BigInt(match[2])
  const fraction = match[3] || ''
  const hundredths = BigInt((fraction.slice(0, 2) || '').padEnd(2, '0'))
  const shouldRound = Number(fraction[2] || '0') >= 5
  const absolute = (whole * SATANG_PER_BAHT) + hundredths + (shouldRound ? 1n : 0n)
  return negative ? -absolute : absolute
}

export function parseSatang(value, label = 'Money amount') {
  if (typeof value === 'bigint') return value
  const text = String(value ?? '').trim()
  if (!/^[+-]?\d+$/.test(text)) throw new TypeError(`${label} must be a base-10 satang integer.`)
  return BigInt(text)
}

export function satangToBahtNumber(value, label = 'Money amount') {
  const satang = parseSatang(value, label)
  if (satang > BigInt(Number.MAX_SAFE_INTEGER) || satang < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`${label} is too large for the legacy baht-number API.`)
  }
  return Number(satang) / Number(SATANG_PER_BAHT)
}

export function satangToApiString(value) {
  return parseSatang(value).toString()
}

export function resolveMoneyInput(input, legacyField = 'amount', satangField = `${legacyField}Satang`) {
  const hasSatang = input?.[satangField] !== undefined && input?.[satangField] !== null && input?.[satangField] !== ''
  const hasLegacy = input?.[legacyField] !== undefined && input?.[legacyField] !== null && input?.[legacyField] !== ''
  if (!hasSatang && !hasLegacy) throw new TypeError(`${legacyField} is required.`)

  const satang = hasSatang
    ? parseSatang(input[satangField], satangField)
    : bahtToSatang(input[legacyField], legacyField)
  if (hasLegacy && bahtToSatang(input[legacyField], legacyField) !== satang) {
    throw new TypeError(`${legacyField} and ${satangField} must represent the same value.`)
  }

  return {
    satang,
    legacyBaht: satangToBahtNumber(satang, legacyField),
  }
}

export function dualWriteMoney(legacyField, satangField, value) {
  const satang = parseSatang(value, satangField)
  return {
    [legacyField]: satangToBahtNumber(satang, legacyField),
    [satangField]: satang,
  }
}

export function moneyReadAuthority(env = process.env) {
  const authority = String(env.MONEY_READ_AUTHORITY || 'legacy_float').trim().toLowerCase()
  return MONEY_READ_AUTHORITIES.has(authority) ? authority : 'legacy_float'
}

export function readMoneySatang(record, legacyField, satangField = `${legacyField}Satang`, env = process.env) {
  const authority = moneyReadAuthority(env)
  const satangValue = record?.[satangField]
  const legacyValue = record?.[legacyField]

  if (authority === 'satang' && satangValue !== null && satangValue !== undefined) {
    return parseSatang(satangValue, satangField)
  }
  if (legacyValue !== null && legacyValue !== undefined) return bahtToSatang(legacyValue, legacyField)
  if (satangValue !== null && satangValue !== undefined) return parseSatang(satangValue, satangField)
  return 0n
}

export function sumMoneySatang(records, legacyField, satangField = `${legacyField}Satang`, env = process.env) {
  return records.reduce((sum, record) => sum + readMoneySatang(record, legacyField, satangField, env), 0n)
}

export function stringifyJsonWithBigInt(value) {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item)
}
