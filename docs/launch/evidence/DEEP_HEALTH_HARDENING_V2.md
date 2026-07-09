# Deep Health Hardening V2

Status: open.

Purpose: prove public diagnostics do not expose raw database, driver, network, host, SQL, provider, or stack exception text.

## Environment

| Item | Value |
| --- | --- |
| Commit SHA |  |
| Deploy ID |  |
| Host |  |
| Test date/time |  |
| Tester |  |

## Current risk

Public `GET /healthz?deep=1` is useful for operational diagnostics, but public responses must not include raw exception messages from Prisma, PostgreSQL, network errors, DNS, SQL, provider SDKs, or internal hostnames.

## Acceptance standard

- [ ] Healthy deep check returns bounded fields: `configured`, `ok`, and safe status labels only.
- [ ] Failed deep check returns a generic safe diagnostic such as `Database connectivity check failed.`
- [ ] Full raw error detail is logged server-side only, if logging is needed.
- [ ] Public response omits stack traces, SQL, raw database URLs, hostnames, usernames, provider exception text, and internal network details.
- [ ] `npm run live:check` and `npm run public-edge:proof` pass after the change.

## Test cases

| Probe | Expected | Actual | Pass? |
| --- | --- | --- | --- |
| `GET /healthz` | No raw DB error field |  |  |
| `GET /healthz?deep=1` healthy | `database.ok=true`, no raw error |  |  |
| Controlled failed DB probe in staging/local | Generic error only |  |  |
| Public unwanted-path probes | 404 bodies omitted by evidence helper |  |  |

## Result

- [ ] Passed.
- [ ] Failed.
- [ ] Deferred with owner/date/expiry:
