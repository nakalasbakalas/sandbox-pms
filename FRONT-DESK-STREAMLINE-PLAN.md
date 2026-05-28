# Front Desk Check-In / Check-Out Streamline Plan

## Confirmed Architecture

- Frontend: Vite, React 19, TypeScript, Tailwind, Radix UI, Phosphor icons, Sonner toasts.
- State: `@github/spark/hooks` KV for local/offline mode, React state/memo hooks, and optional server mode via `VITE_PMS_API_MODE=server`.
- Backend/data: Node HTTP server in `server/index.mjs`, Prisma/PostgreSQL models in `prisma/schema.prisma`.
- Auth/RBAC: `server/rbac.mjs` on API routes and `src/hooks/use-auth.tsx` / `src/types/auth.ts` on the client.
- Core models: `Reservation`, `Room`, `RoomDateInventory`, `Folio`, `Charge`, `Payment`, `ReservationLog`, `RoomStatusLog`, and `AuditLog`.
- Existing workflow entrypoint: `src/components/front-desk/FrontDeskView.tsx` with `CheckInDialog` and `CheckOutDialog`.
- Tests: `scripts/run-business-tests.mjs`, `scripts/run-e2e-tests.mjs`, plus `typecheck`, `lint`, and `build`.

## Implementation Notes

1. Put workflow readiness and blockers in a reusable guard module so cards, panels, and tests share the same checklist language.
2. Keep authoritative business-rule enforcement in server transactions for check-in, checkout, payment posting, room status, inventory, and audit logs.
3. Replace the tabbed front desk form surface with one compact Today board containing arrivals, in-house stays, departures, and room readiness.
4. Make express check-in/out a confirmation path only when all guard items are green.
5. Keep missing requirements actionable in the one-panel dialogs with direct actions such as assign best room, collect payment, mark room ready, or override with reason.
6. Add tests around guards, express paths, blockers, overrides, and housekeeping handoff behavior.
