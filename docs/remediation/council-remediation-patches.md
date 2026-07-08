# Council remediation queue

This document translates the due-diligence findings into reviewable patch work. It is written as a council of experts: product/operations, front-end, backend, data, security, privacy, QA, and launch governance.

## Applied in this branch

### 1. Dynamic room-type metadata hardening

Expert view: the prior Rooms section work made the UI appear dynamic, but the API mapper still collapsed every non-`DOUBLE` room into `TWIN`. That is unsafe for future room types and can mislead staff.

Applied patches:

- `src/types/board.ts` now carries source room-type metadata: `roomTypeId`, `roomTypeCode`, and `roomTypeName`.
- `src/lib/pms-api-client.ts` now preserves room type id/code/name from API room records and keeps the legacy `type` bucket only as a compatibility fallback.
- `src/components/rooms/RoomsView.tsx` now groups and labels sections from source room-type metadata instead of visual Twin/Double buckets.
- `npm run remediation:check` validates that the hardcoded non-Double-to-Twin mapper has not returned.

Remaining follow-up:

- Update `NewReservationDialog` and local front-desk reservation types to accept arbitrary configured room type codes, not only `TWIN | DOUBLE`.
- Add a server-mode Playwright test with a third room type such as `FAMILY_SUITE`.

### 2. Launch proof pack v2

Expert view: accepted-risk launch closure is not the same as final production proof. V2 separates owner acceptance from verifiable evidence.

Applied patches:

- `docs/launch/LAUNCH_PROOF_PACK_V2.md` defines the proof matrix for auth/RBAC, staff workflow acceptance, backups, WAF, dynamic room types, money precision, Booking Inbox parser review, localization, and PII governance.

## Ready-to-apply implementation patches

### A. New Reservation dynamic room type patch

Patch intent:

- Change `ReservationRoomTypeCode` from `'TWIN' | 'DOUBLE'` to `string`.
- Change `prefilledData.roomType`, `ReservationFormState.roomType`, `ReservationRoomTypeOption.code`, and configured room type `code` to `string`.
- Replace the fallback code heuristic with:

```ts
function normalizeRoomTypeCode(value: string | undefined, fallback: string) {
  return String(value || fallback)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}
```

- Map configured types with:

```ts
const code = normalizeRoomTypeCode(roomType.code, roomType.id || roomType.name || `TYPE_${index + 1}`)
```

- Use `roomType.id` as the persistent room type ID; use `roomType.code` only as the display/selection code.

Acceptance proof:

- Configure `Standard Twin`, `Superior Double`, and `Family Suite`.
- Open New Reservation.
- Verify all three types are selectable.
- Select Family Suite and submit a local draft.
- Verify `roomTypeId` equals the configured Family Suite id and `roomTypeName` equals `Family Suite`.

### B. Server-mode E2E patch

Patch intent:

- Add a dedicated `test:e2e:server-mode` script that starts the built Node server with `VITE_PMS_API_MODE=server` behavior.
- Seed disposable users for admin, manager, front desk, housekeeping, and cashier.
- Log in with each user and validate permitted/denied routes.
- Run non-mutating or deliberately invalid API probes for 401/403 behavior.
- Include a third room type fixture.

Acceptance proof:

```bash
npm run db:e2e:ready
npm run build
npm run test:e2e:server-mode
```

Safety rule: this must require `ALLOW_DB_E2E=true` and a non-production `E2E_DATABASE_URL`.

### C. Money precision patch

Expert view: Float money is acceptable for a prototype, not ideal for a PMS accumulating operational payment records.

Preferred implementation:

1. Introduce a `money` helper that converts external decimal inputs to integer satang.
2. Migrate Prisma monetary fields from Float to either `Decimal @db.Decimal(12,2)` or integer satang.
3. Add reconciliation tests for rates, charges, payments, folios, partial payments, refunds, and reports.
4. Export/display money through a single formatter.

Minimum safe interim:

- Keep Float only with explicit owner timebox.
- Require daily folio reconciliation until Decimal/satang migration is complete.
- Block high-volume or gateway-connected payment use until migration.

### D. PII governance patch

Expert view: guests, documents, and booking email events carry sensitive operational data. Current models are functional, but governance needs to be explicit.

Patch intent:

- Add a privacy/security doc covering retention, masking, access control, export/delete, and incident response.
- Hide raw email text/headers by default in the Booking Inbox.
- Restrict raw email details to admin/manager.
- Add tests for role-gated raw-email access.

### E. CSP report-only patch

Expert view: current CSP is useful but minimal. A fuller policy should start in report-only mode to avoid breaking Vite assets and integrations.

Patch intent:

- Add `CONTENT_SECURITY_POLICY_REPORT_ONLY` env support.
- Emit `content-security-policy-report-only` when configured.
- Keep enforced minimal CSP until the violation report is reviewed.
- Move to full `script-src`, `connect-src`, `img-src`, `style-src`, and `font-src` enforcement after allowlist validation.

### F. Provider proof closure patch

Expert view: Cloudflare WAF/rate-limit, Render backup/recovery, production auth, and staff acceptance were accepted risks. They should be reopened as proof tasks, not treated as complete.

Patch intent:

- Create current proof files under `docs/launch/evidence/` using the V2 template.
- Record owner/deputy, last verified timestamp, provider dashboard proof, and accepted residual risk.
- Mark old accepted-risk closure as historical, not current launch proof.

## Recommended PR review order

1. Review dynamic room-type code diff.
2. Run `npm run remediation:check`.
3. Run `npm run typecheck` and `npm run lint`.
4. Add/execute New Reservation arbitrary room-type patch.
5. Add server-mode E2E with third room type.
6. Fill `LAUNCH_PROOF_PACK_V2.md` evidence files.
7. Decide Decimal vs integer satang before gateway/payment automation.

## Council sign-off stance

- Product/Operations: acceptable for controlled beta after staff proof, not unsupervised launch.
- Front-end: room-type metadata patch is required before adding more room types.
- Backend: provider and backup proof remain external blockers.
- Data/Finance: money precision needs a migration decision before payment volume grows.
- Security/Privacy: CSP, PII retention, and raw-email access policy need explicit implementation.
- QA: server-mode E2E and role matrix proof are the next high-value tests.
