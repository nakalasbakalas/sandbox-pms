# Server-mode E2E remediation spec

Status: ready-to-implement QA patch spec.

## Expert verdict

Existing route smoke and DB-mutating E2E are useful, but the production path requires a browser-driven server-mode proof: Node server, cookie auth, real RBAC, API-backed data, and a third room type.

## Required command

Add after implementation:

```json
{
  "scripts": {
    "test:e2e:server-mode": "node scripts/run-server-mode-e2e-tests.mjs"
  }
}
```

## Safety guard

The script must refuse to run unless all are true:

- `ALLOW_DB_E2E=true`
- `E2E_DATABASE_URL` is set
- `E2E_DATABASE_URL` does not contain Render production host/name markers
- `NODE_ENV` is not `production`
- target DB name includes `_e2e`, `test`, `staging`, or another owner-approved disposable marker

## Fixture requirements

Seed:

- Admin user
- Manager user
- Front desk user
- Housekeeping user
- Cashier user
- Room types:
  - Standard Twin (`TWIN`)
  - Superior Double (`DOUBLE`)
  - Family Suite (`FAMILY_SUITE`)
- At least one room per room type
- One arrival today
- One in-house departure today
- One blocked or out-of-service room
- One dirty room

## Browser checks

For each role:

| Role | Must access | Must not access |
| --- | --- | --- |
| Admin | all protected routes | none |
| Manager | board, rooms, front desk, reservations, guests, cashier, rates, channels, reports, messaging, ops | user-management if not explicitly allowed by policy |
| Front desk | board, rooms, front desk, reservations, guests, cashier, housekeeping, messaging | settings, user-management, rate edit if restricted |
| Housekeeping | rooms, housekeeping, tablet-housekeeping, messaging | cashier, rates, settings, user-management |
| Cashier | cashier, reservations, guests, reports, messaging | settings, user-management, housekeeping mutation if restricted |

## API checks

Use same-origin browser fetches after login:

- `/api/auth/me` returns current user.
- `/api/auth/can-view?route=...` matches UI access.
- Unauthorized protected mutations return 403.
- Unauthenticated `/api/reservations` returns 401.
- Invalid room assignment payload returns 400/403, not 500.
- Invalid date reservation payload returns 400, not 500.

## Dynamic room type checks

- Rooms view renders three sections: Standard Twin, Superior Double, Family Suite.
- Room tile for Family Suite shows the Family Suite label.
- New Reservation select includes Family Suite.
- Creating a local/staging reservation preserves Family Suite room type id/name.

## Acceptance command order

```bash
npm run db:e2e:ready
npm run build
ALLOW_DB_E2E=true E2E_DATABASE_URL="postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_e2e?schema=public" npm run test:e2e:server-mode
```

## Evidence output

The script should write a redacted JSON artifact:

```text
docs/launch/evidence/generated/server-mode-e2e-YYYY-MM-DD.json
```

Required fields:

- commit SHA
- test timestamp
- target host
- database safety classification
- role matrix result
- route matrix result
- API denial result
- dynamic room type result
- screenshots or trace path, if generated, with no sensitive guest/payment data
