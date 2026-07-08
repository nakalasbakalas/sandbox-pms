# Money Precision Decision V2

Status: open.

## Decision

- [ ] Migrate to integer satang.
- [ ] Migrate to Prisma Decimal / Postgres numeric.
- [ ] Temporarily accept Float risk with expiry date.

## Required sign-off

| Role | Name | Decision / notes | Date |
| --- | --- | --- | --- |
| Owner |  |  |  |
| Finance/cashier reviewer |  |  |  |
| Engineer |  |  |  |

## Risk statement if Float remains authoritative

- Expiry date:
- Maximum accepted transaction volume before migration:
- Daily reconciliation owner:
- Gateway/PromptPay automation allowed? no / yes with reason:

## Migration proof if migrated

| Check | Result | Evidence |
| --- | --- | --- |
| Migration applied to staging/disposable DB |  |  |
| Backfill dry run reviewed |  |  |
| Backfill confirmed |  |  |
| Folio totals reconcile |  |  |
| Payment totals reconcile |  |  |
| Report totals reconcile |  |  |
| Rollback plan reviewed |  |  |

## Test cases

- [ ] THB 750 one-night stay.
- [ ] Multi-night stay.
- [ ] Extra guest fee.
- [ ] Child fee.
- [ ] Partial payment.
- [ ] Multiple payments.
- [ ] Charge posting.
- [ ] Zero-balance checkout.
- [ ] Rounding edge cases.

## Result

- [ ] Passed
- [ ] Failed
- [ ] Accepted risk with owner/date/expiry:
