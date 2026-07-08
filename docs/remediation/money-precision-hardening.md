# Money precision hardening

Status: ready-to-implement remediation spec.

## Expert verdict

The current Prisma schema stores room rates, reservation totals, folio totals, charge amounts, payment amounts, and balances as `Float`. Float storage is workable for early beta records but is a known accounting risk once the PMS becomes the source of truth for payments, gateway reconciliation, refunds, deposits, and reports.

## Decision required

Choose one before high-volume financial use:

| Option | Recommendation | Notes |
| --- | --- | --- |
| Integer satang | Strongest operational control | Store every THB amount as integer satang. Format as THB at the boundary. Best for exact reconciliation. |
| Prisma Decimal / Postgres numeric | Also acceptable | Easier migration from Float semantics, but requires consistent Decimal handling in API responses. |
| Continue Float temporarily | Accepted-risk only | Must be timeboxed, reconciled daily, and blocked from live gateway automation. |

## Preferred patch architecture: integer satang

1. Add money helper module:

```js
export function toSatang(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error('Money amount must be numeric.')
  return Math.round((number + Number.EPSILON) * 100)
}

export function fromSatang(value) {
  const number = Number(value)
  if (!Number.isInteger(number)) throw new Error('Satang amount must be an integer.')
  return number / 100
}

export function addSatang(...values) {
  return values.reduce((sum, value) => sum + Number(value || 0), 0)
}
```

2. Add new nullable columns first, do not destructive-migrate existing Float columns immediately:

```prisma
model Reservation {
  ratePerNightSatang Int?
  totalAmountSatang  Int?
  depositAmountSatang Int?
}

model Folio {
  subtotalSatang Int?
  taxSatang      Int?
  totalSatang    Int?
  paidSatang     Int?
  balanceSatang  Int?
}

model Charge {
  amountSatang Int?
  totalSatang  Int?
}

model Payment {
  amountSatang Int?
}
```

3. Backfill from Float with a reviewed script:

```bash
node scripts/backfill-money-satang.mjs --dry-run
node scripts/backfill-money-satang.mjs --confirm
```

4. Dual-write Float and satang for one release.
5. Switch reads/reports to satang.
6. Remove Float reads only after reconciliation proof.

## Required tests

- One-night reservation at THB 750.
- Multi-night reservation with extra guest fee.
- Children fee calculation.
- Partial payment.
- Multiple payments to one folio.
- Charge posting and void handling.
- Checkout with exact zero balance.
- Rounding edge cases: `0.1 + 0.2`, `999.995`, and formatted comma input.
- Report totals equal sum of folio/payment rows.

## Operational guard until migration

- Do not enable live gateway settlement or PromptPay collection automation while Float remains authoritative.
- Daily cashier close must reconcile folio total, payment total, and cash/bank/card references.
- Any mismatch must be recorded as an audit finding, not silently rounded away.
