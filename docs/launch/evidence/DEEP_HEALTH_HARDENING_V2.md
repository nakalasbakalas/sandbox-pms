# Deep Health Hardening V2

Status: engineering proof complete; exact deployed-SHA correlation remains open.

Purpose: prove public diagnostics do not expose raw database, driver, network, host, SQL, provider, or stack exception text.

## Environment

| Item | Value |
| --- | --- |
| Commit SHA | Local candidate `14f4baca3dbee6f7ce807dbe1d1dd3207a08e9a5`; sanitizer introduced in `e4efae7207fc92b329c8a578cb69dfc022465e72` |
| Deploy ID | Not exposed by the public health response; unverified |
| Host | `https://book.sandboxhotel.com` |
| Test date/time | 2026-08-08 16:16 Asia/Bangkok (`2026-08-08T09:16:28.909Z` edge artifact time) |
| Tester | Codex coordinator, non-destructive public probes plus local controlled test |

## Current risk

Public `GET /healthz?deep=1` is useful for operational diagnostics, but public responses must not include raw exception messages from Prisma, PostgreSQL, network errors, DNS, SQL, provider SDKs, or internal hostnames.

## Acceptance standard

- [x] Healthy deep check returns bounded database fields: `configured` and `ok`; integration values are booleans or bounded status objects.
- [x] Failed deep check returns only `Database health check failed.` from `databaseHealthFailure()`.
- [x] The database exception is discarded at the public-response boundary. This surface does not log raw driver text; any future server-side logging must remain redacted.
- [x] The controlled failure test proves public JSON omits stack traces, SQL, raw database URLs, hostnames, usernames, provider exception text, and internal network details.
- [x] `npm.cmd run live:check` and `npm.cmd run public-edge:proof` passed on 2026-08-08.

## Test cases

| Probe | Expected | Actual | Pass? |
| --- | --- | --- | --- |
| `GET /healthz` | No raw DB error field | HTTP 200; production; database configured | Pass |
| `GET /healthz?deep=1` healthy | `database.ok=true`, no raw error | HTTP 200; bounded proof recorded `databaseConfigured=true`, `databaseOk=true`; body otherwise omitted | Pass |
| Controlled failed DB probe in staging/local | Generic error only | `npm.cmd test` injects a credential-bearing PostgreSQL URL and asserts only the fixed generic failure object is returned | Pass |
| Public unwanted-path probes | 404 bodies omitted by evidence helper | `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` returned 404; bodies omitted | Pass |

## Result

- [x] Local sanitizer and controlled-failure proof passed.
- [x] Current public host healthy and bounded-field proof passed.
- [ ] Issue `#165` closure deferred until the public deployment is correlated to an exact deployed commit SHA or deploy ID. Owner: release owner. Expiry: before production release sign-off.

## Proof boundary

The public probes confirm current live behavior, Cloudflare/Render routing, and safe bounded health fields. They do not prove that local candidate `14f4baca...` is the deployed revision because the host does not expose a deploy identifier. No failing database was induced on production.
