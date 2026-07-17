/** Base-10 integer satang serialized by the PMS API. */
export type MoneySatang = `${bigint}`

export interface ExactMoneyAmount {
  amountSatang: MoneySatang
  /** Temporary legacy compatibility projection in baht. */
  amount?: number
}

export function parseMoneySatang(value: string | bigint): bigint {
  const text = typeof value === 'bigint' ? value.toString() : String(value).trim()
  if (!/^[+-]?\d+$/.test(text)) throw new TypeError('Money satang must be a base-10 integer string.')
  return BigInt(text)
}

export function formatMoneySatang(value: string | bigint, currency = 'THB', locale = 'en-TH'): string {
  const satang = parseMoneySatang(value)
  const sign = satang < 0n ? -1 : 1
  const absolute = satang < 0n ? -satang : satang
  const baht = Number(absolute / 100n)
  const fraction = Number(absolute % 100n) / 100
  const amount = sign * (baht + fraction)
  if (!Number.isSafeInteger(baht)) return `${satang.toString()} satang ${currency}`
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
}
