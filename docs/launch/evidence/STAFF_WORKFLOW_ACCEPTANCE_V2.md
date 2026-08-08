# Staff Workflow Acceptance V2

Status: owner action required; no staging/live workflow mutation performed.

## Scope

Manual acceptance for the hotel workflows that automated checks cannot fully prove.

## Environment

- Commit SHA: local candidate `12d9572`
- Deploy ID: not supplied
- Host: not approved
- Test date/time: not run
- Tester(s): not assigned
- Data source: isolated staging property or owner-approved test dataset required

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
- [x] Owner action required; local automated tests do not replace staff acceptance.

```text
OWNER ACTION REQUIRED
Gate: STAFF WORKFLOW ACCEPTANCE
Required inputs:
- isolated staging property or explicitly approved test dataset
- exact deployed candidate SHA/deploy ID and target host
- approved ADMIN, MANAGER, FRONT_DESK, HOUSEKEEPING, and CASHIER test accounts
- named tester(s), cleanup owner, and acceptance date
- approval to create and clean up the redacted test reservation only through supported PMS workflows
Execution:
- complete the single coherent 16-step scenario in docs/finish/CODEX_FINISH_PACKET.md F11
- record only redacted identifiers, statuses, timestamps, audit/timeline results, and cleanup outcome in this file
Expected artifact:
- completed workflow table with tester, host, commit, deploy ID, data source, pass/fail, and no sensitive screenshots
```
