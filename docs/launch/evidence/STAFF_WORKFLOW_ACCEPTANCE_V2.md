# Staff Workflow Acceptance V2

Status: open.

## Scope

Manual acceptance for the hotel workflows that automated checks cannot fully prove.

## Environment

- Commit SHA:
- Deploy ID:
- Host:
- Test date/time:
- Tester(s):
- Data source: staging / live accepted-risk / disposable

## Workflow checklist

| Workflow | Role tested | Expected result | Actual result | Pass? | Notes |
| --- | --- | --- | --- | --- | --- |
| Create reservation with valid dates | Front desk | Reservation created |  |  |  |
| Reject invalid date range | Front desk | 400/user error, no reservation |  |  |  |
| Reject room overbooking by room type | Front desk/manager | No double-sale |  |  |  |
| Reject occupied room assignment | Front desk | Assignment blocked |  |  |  |
| Reject blocked/out-of-service room assignment | Front desk | Assignment blocked |  |  |  |
| Check-in requires assigned room | Front desk | Blocked until room assigned |  |  |  |
| Check-in marks room occupied | Front desk | Room occupied |  |  |  |
| Checkout requires settlement or override | Cashier/front desk | Blocked or override recorded |  |  |  |
| Checkout marks room dirty | Front desk/housekeeping | Dirty handoff visible |  |  |  |
| Payment updates folio paid/balance | Cashier | Balance recalculated |  |  |  |
| Charge posting updates folio | Cashier | Charge visible and total updated |  |  |  |
| Housekeeping dirty → cleaning → clean → inspected | Housekeeping | Status sequence works |  |  |  |
| Reports/export smoke | Manager/cashier | Report opens/exports |  |  |  |
| Audit/timeline entries | Manager/admin | Critical mutation visible |  |  |  |

## Result

- [ ] Passed
- [ ] Failed
- [ ] Accepted risk with owner/date/expiry:
