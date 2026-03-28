# Sandbox PMS — Executive Project Report

**Date:** 2026-03-28
**Scope:** Full repository audit — architecture, product spec, security, deployment, testing, launch readiness
**Audit Method:** Static codebase analysis (READ-ONLY, no runtime verification)

---

## 1. What Sandbox PMS Is

Sandbox PMS is a **full-stack property management system** purpose-built for Sandbox Hotel, a boutique hotel in Thailand. It is a monolithic Flask application backed by PostgreSQL, deployed on Render, and designed to serve as:

- **Public booking engine** (`book.sandboxhotel.com`) — guest-facing availability search, booking form, payment, pre-check-in, digital checkout, post-stay survey
- **Staff PMS** (`staff.sandboxhotel.com`) — reservations, front desk board, housekeeping, cashier/folio, messaging, reporting, admin configuration
- **Provider portal** — third-party booking partner access to reservation management and iCal calendar sync

The system is a single Flask app serving both audiences via host-based canonical routing, with role-gated access separating public, staff, and provider surfaces.

---

## 2. Intended Deployment Topology

| Component | Technology | Status |
|---|---|---|
| Web service | Flask + Gunicorn (sync workers) on Render | Configured via `render.yaml` |
| Database | PostgreSQL 17 (Render managed, 256 MB plan) | Configured |
| File storage | Render persistent disk (1 GB) at `/var/data/uploads/documents` | Configured |
| Migrations | Alembic (pre-deploy command) | 29 migration files |
| Cron jobs | 9 Render cron services | Configured, each with isolated env vars |
| Custom domains | `book.sandboxhotel.com`, `staff.sandboxhotel.com` | Declared in render.yaml |
| Error monitoring | Sentry (optional, via `SENTRY_DSN`) | Configured |
| Payment provider | Stripe (configurable, currently `disabled`) | Implemented but not live |
| Email | SMTP (configurable) | Implemented |
| SMS | Twilio adapter + webhook log adapter | Implemented |

**Deployment status:** The render.yaml Blueprint is well-specified. Pre-deploy schema migration, health check, and all cron services are declared. However, **no evidence of a successful production deployment** exists in the repo — the README notes 5 verification items that must be confirmed on the live service.

---

## 3. User Roles

| Role | Dashboard | Key Permissions |
|---|---|---|
| **Admin** | Full system | All 39 permission codes — users, roles, settings, audit, rates, OTA channels |
| **Manager** | Staff dashboard | Reservations, folio, payments, housekeeping, reports, messaging |
| **Front Desk** | Staff dashboard | Reservations, check-in/out, folio (view + charge), payments (view + create), messaging |
| **Housekeeping** | Housekeeping board | HK status changes, task management |
| **Provider** | Provider dashboard | Provider bookings, payment requests, calendar sync |

Permissions are seeded from `PERMISSION_SEEDS` (39 codes across 12 modules). Role-permission mappings are hard-coded in `ROLE_PERMISSION_SEEDS` and applied via CLI command `flask sync-role-permissions`.

---

## 4. Current Product Scope

### Fully Implemented (evidence of complete service + template + route + test coverage)
- Public booking engine (availability → hold → confirm flow)
- Reservation lifecycle (inquiry → confirmed → checked_in → checked_out, cancellation, no-show, waitlist)
- Staff reservation workspace (list, filter, sort, detail, drawer panel, notes, room assignment, date changes)
- Front desk workspace (workspace list, check-in form with ID verification, check-out with balance posting, walk-in)
- Front desk planning board (visual grid, polling refresh, command strip, HK overlay, quick filters, role presets)
- Cashier / folio (room charges, payments, adjustments, refunds, voids, POS charges, receipts, printed folios)
- Housekeeping board (room status grid, bulk status updates, task management, room detail, notes)
- Digital pre-check-in (guest-facing form with document upload, staff verification, readiness tracking)
- Guest messaging hub (thread inbox, compose, assignee, follow-up, automation rules, template system)
- Notification pipeline (email outbox, template rendering, delivery tracking with retry)
- Provider portal (bookings list, detail, cancel, deposit request, iCal calendar sync)
- iCal bi-directional sync (export feeds, import external sources, conflict detection)
- Reporting (daily report, manager dashboard, front desk dashboard, CSV export)
- Admin panel (property, rooms, room types, rates, extras, blackouts, overrides, policies, templates, channels, staff, audit log)
- Authentication (Argon2 passwords, session management, MFA/TOTP, password reset, account locking)
- Security hardening (CSP, HSTS, HTTPS redirect, host validation, CSRF, rate limiting, audit logging)
- Guest surveys (post-stay feedback with token-based access)
- Guest loyalty tracking (tier + points model)
- Digital checkout (public-facing balance review + payment)
- Group room blocks (create, detail, release)

### Partial or Scaffold
- **OTA channel manager** — `channel_service.py` has abstract provider pattern + mock provider + iCal adapter; `OtaChannel` model stores encrypted API keys; admin channel management UI exists; **but no real Booking.com/Expedia/Agoda API adapters are implemented**
- **SMS delivery** — `sms_provider.py` and `sms_twilio_adapter.py` exist as stubs/adapters; Twilio integration code is minimal; LINE/WhatsApp webhook delivery points exist but lack real adapter implementations
- **POS adapter** — `pos_adapter.py` (175 lines) is a scaffold with a `NullPosAdapter` and webhook-based pattern; no real POS system integration
- **ID scanner adapter** — `id_scanner_adapter.py` (145 lines) is a scaffold with manual fallback; no hardware or OCR integration
- **OCR extraction** — `suggest_ocr_extraction()` stub in `pre_checkin_service.py` returns `None`
- **Coupon studio** — `routes/coupon_studio.py` is 14 lines (scaffold only)
- **Loyalty service** — `loyalty_service.py` (192 lines) has basic tier/points functions but no integration into booking flow or reporting

---

## 5. Strongest Areas

1. **Domain model quality** — 50+ models with proper FK constraints, check constraints, UUID PKs, audit mixins, append-only protection on logs, timezone-aware timestamps, JSON columns for flexible metadata
2. **Security posture** — Production fail-fast validation (insecure defaults rejected), Argon2 hashing, TOTP MFA, encrypted secrets (Fernet), session management with idle/absolute timeouts, CSP with nonce, HSTS, host validation, CSRF enforcement, sensitive field redaction in logs
3. **Service layer architecture** — Clean separation of routes → services → models; dataclass payloads for type safety; consistent error handling patterns
4. **Front desk board** — Sophisticated planning board with polling refresh, HK overlay, quick filters, role presets, command strip metrics, double-click drill-down
5. **Test coverage** — 30 test files (~17K lines) covering auth, booking, reservations, front desk, housekeeping, cashier, payments, pre-check-in, messaging, admin, reports, security, provider/iCal, and more

---

## 6. Biggest Risks

1. **No verified production deployment** — All deployment config exists but has never been confirmed running. Persistent disk, cron jobs, Sentry, and email delivery are unverified.
2. **Payment provider is disabled** — Stripe integration code exists and is tested, but `PAYMENT_PROVIDER=disabled` in render.yaml means the hotel cannot collect deposits or payments online.
3. **app.py remains a partial monolith** — At 1,683 lines, it still contains template helpers, context processors, CLI commands, and legacy route helpers alongside the create_app factory. While routes have been extracted to 12 blueprints, this file is difficult to maintain.
4. **No real OTA channel adapters** — The channel service is an abstraction layer with only mock and iCal adapters. Real Booking.com / Expedia / Agoda integration would require significant work.
5. **Single-threaded Gunicorn sync workers** — With 2 worker processes and sync mode, long-running requests (iCal fetch, payment webhook) could block other requests.
6. **No background task queue** — All async work is handled via Render cron jobs (5-15 min intervals). There is no Celery/RQ/similar for real-time async tasks.

---

## 7. Maturity Assessment

| Dimension | Score | Assessment |
|---|---|---|
| Domain model completeness | 9/10 | Comprehensive, well-constrained schema |
| Service layer implementation | 8/10 | Thorough business logic with good patterns |
| Public booking engine | 8/10 | Full flow works; needs live payment activation |
| Staff PMS operations | 8/10 | All core workflows implemented |
| Security | 8.5/10 | Strong for an MVP; production hardening in place |
| Test coverage | 7.5/10 | Good breadth but no runtime verification |
| Deployment readiness | 6/10 | Config exists but unverified |
| OTA / channel integration | 3/10 | Architecture only; no real adapters |
| Production hardening | 5.5/10 | Missing live verification, no task queue, no CDN |

**Overall classification: Advanced MVP / Near-launch with caution**

The system has genuine production-grade architecture and deep operational workflows. It is not a toy or scaffold — it is a real PMS with working business logic. However, it has never run in production, payment is disabled, and several operational systems (email, cron, disk) are unverified.

---

## 8. Final Scored Assessment

**Overall Score: 7.2 / 10**

| Category | Weight | Score | Weighted |
|---|---|---|---|
| Architecture & Code Quality | 20% | 7.5 | 1.50 |
| Domain Coverage | 20% | 8.5 | 1.70 |
| Security | 15% | 8.5 | 1.28 |
| Test Coverage | 10% | 7.5 | 0.75 |
| Deployment & Ops | 15% | 5.5 | 0.83 |
| Product Completeness | 20% | 7.0 | 1.40 |
| **Total** | **100%** | | **7.46** |

**Reasoning:** This is a well-engineered boutique hotel PMS that covers the full reservation lifecycle, front desk operations, housekeeping, cashier, and guest communications. The architecture is sound, security is strong, and the codebase is well-tested. The primary gaps are operational (no live deployment verification, disabled payments, no real OTA integrations) rather than architectural.
