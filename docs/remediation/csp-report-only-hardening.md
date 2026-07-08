# CSP report-only hardening

Status: ready-to-implement security patch spec.

## Expert verdict

The server already emits useful baseline headers and a minimal enforced CSP. The next hardening step should be a report-only CSP so policy gaps can be discovered without breaking staff workflows, Vite-built assets, maps, provider callbacks, or future analytics.

## Current enforced baseline to keep

```http
Content-Security-Policy: base-uri 'self'; object-src 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

## Patch design

Add optional env-driven report-only CSP:

```env
CONTENT_SECURITY_POLICY_REPORT_ONLY="default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://book.sandboxhotel.com https://sandbox-hotel-pms.onrender.com; form-action 'self'; upgrade-insecure-requests"
```

Server patch location: `server/index.mjs` inside `securityHeaders(headers = {})`.

Ready-to-apply logic:

```js
function configuredReportOnlyCsp() {
  return String(process.env.CONTENT_SECURITY_POLICY_REPORT_ONLY || '').trim()
}

function securityHeaders(headers = {}) {
  const reportOnlyCsp = configuredReportOnlyCsp()
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'content-security-policy': "base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
    ...(reportOnlyCsp ? { 'content-security-policy-report-only': reportOnlyCsp } : {}),
    ...(PRODUCTION ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
    ...headers,
  }
}
```

## Validation

```bash
CONTENT_SECURITY_POLICY_REPORT_ONLY="default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; form-action 'self'" npm run test:e2e
npm run build
npm run live:check
```

Manual browser validation:

- Login screen loads.
- Authenticated staff shell loads.
- Board, Rooms, Front Desk, Housekeeping tablet, Booking Inbox, and Settings load.
- LINE/WhatsApp/Gmail/Ops screens do not emit unexpected CSP errors except known report-only candidates.
- Static assets load from the deployed domain.

## Promotion criteria

Move from report-only to enforced only after:

- Seven days of logs show no required blocked asset/script/connect source.
- External provider domains are explicitly reviewed.
- No wildcard `script-src *` or permanent broad `connect-src *` is used.
- Any `unsafe-inline` exception is documented and timeboxed.
