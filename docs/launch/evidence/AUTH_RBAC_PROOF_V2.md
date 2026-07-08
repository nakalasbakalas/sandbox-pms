# Auth/RBAC Proof V2

Status: open.

## Scope

Credentialed proof for production/staging staff access. Do not record passwords, session cookies, tokens, or screenshots containing secrets.

## Environment

- Commit SHA:
- Deploy ID:
- Host:
- Test date/time:
- Tester:

## Approved user matrix

| User label | Role | Email/username present? | Active? | Login result | Logout result | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Owner/admin | ADMIN |  |  |  |  |  |
| Manager | MANAGER |  |  |  |  |  |
| Front desk | FRONT_DESK |  |  |  |  |  |
| Housekeeping | HOUSEKEEPING |  |  |  |  |  |
| Cashier | CASHIER |  |  |  |  |  |

## Route access matrix

| Route | Admin | Manager | Front desk | Housekeeping | Cashier | Expected result notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/` / Today |  |  |  |  |  |  |
| `/board` |  |  |  |  |  |  |
| `/rooms` |  |  |  |  |  |  |
| `/front-desk` |  |  |  |  |  |  |
| `/reservations` |  |  |  |  |  |  |
| `/housekeeping` |  |  |  |  |  |  |
| `/tablet-housekeeping` |  |  |  |  |  |  |
| `/cashier` |  |  |  |  |  |  |
| `/rates` |  |  |  |  |  |  |
| `/settings` |  |  |  |  |  |  |
| `/user-management` |  |  |  |  |  |  |

## API denial probes

| Probe | User/session | Expected | Actual | Pass? |
| --- | --- | --- | --- | --- |
| Unauthenticated `GET /api/reservations` | none | 401 |  |  |
| Unauthorized settings mutation | non-admin | 403 |  |  |
| Unauthorized user management route/action | non-admin | 403 |  |  |

## Result

- [ ] Passed
- [ ] Failed
- [ ] Accepted risk with owner/date/expiry:
