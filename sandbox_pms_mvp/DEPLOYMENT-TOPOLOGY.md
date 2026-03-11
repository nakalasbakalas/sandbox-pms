# Deployment Topology

Sandbox Hotel should use a subdomain topology as the default deployment model:

- `https://www.<domain>`: marketing site in `sandbox-hotel-site`
- `https://book.<domain>`: public booking engine in `sandbox-pms`
- `https://staff.<domain>`: staff PMS in `sandbox-pms`

`book` and `staff` can point at the same Flask deployment. The split is logical, not a second application.

## Why This Topology

- The public booking engine already lives on root-facing routes such as `/`, `/availability`, `/booking/...`, and `/payments/...`.
- Staff workflows already live under `/staff/...`.
- The current repos do not include an established reverse-proxy layer that would safely unify `www`, `/book`, and `/staff` behind one origin.
- Host-based separation keeps staff sessions host-only and avoids cross-origin API and cookie coupling by default.

## URL Settings

Set these environment variables in each environment:

- `MARKETING_SITE_URL`: canonical marketing origin, such as `https://www.sandboxhotel.com`
- `BOOKING_ENGINE_URL`: canonical public booking origin, such as `https://book.sandboxhotel.com`
- `STAFF_APP_URL`: canonical staff origin, such as `https://staff.sandboxhotel.com`
- `APP_BASE_URL`: legacy alias; keep it equal to `BOOKING_ENGINE_URL`
- `PAYMENT_BASE_URL`: hosted payment provider base URL, not your PMS URL

Recommended local development:

- `MARKETING_SITE_URL=http://127.0.0.1:8787`
- `BOOKING_ENGINE_URL=http://127.0.0.1:5000`
- `STAFF_APP_URL=http://127.0.0.1:5000`
- `APP_BASE_URL=http://127.0.0.1:5000`

## Canonical Host Behavior

When `ENFORCE_CANONICAL_HOSTS=1`, the PMS redirects interactive GET and HEAD traffic to the correct host:

- `/staff...` routes redirect to `STAFF_APP_URL`
- public booking routes redirect to `BOOKING_ENGINE_URL`
- webhook and health endpoints are excluded

This keeps links, SEO-facing public pages, and staff entry points aligned without relying on a brochure-site proxy.

## Cross-Origin Expectations

- No shared browser session across `book` and `staff` is required.
- Staff auth cookies remain host-only by default.
- Public booking and staff operations should navigate between origins, not call each other with browser-side cross-origin XHR.
- Hosted payment return URLs should use `BOOKING_ENGINE_URL`.
- Password reset and staff security links should use `STAFF_APP_URL`.

## Deployment Notes

- Point both `book` and `staff` custom domains at the same `sandbox-pms` service unless and until the app is split intentionally.
- Configure `TRUSTED_HOSTS` to include both booking and staff hosts at the edge-facing environment.
- Keep `FORCE_HTTPS=1` and use HTTPS origins for all production URL variables.
- Use the booking host for guest-facing emails, payment links, and provider return URLs.
- Use the staff host for staff login and password-reset flows.
- Render-oriented repo scaffolding now exists at [render.yaml](/C:/Users/nakal/OneDrive/Documents/GitHub/sandbox-pms/render.yaml) with the intended `book.sandboxhotel.com` and `staff.sandboxhotel.com` domains. Keep those aligned with the live DNS cutover and inject secrets per environment.

## Payment Provider URLs

Guest-facing payment URLs should be anchored to the booking origin:

- hosted payment entry URL: `https://book.sandboxhotel.com/payments/request/...`
- hosted payment return URL: `https://book.sandboxhotel.com/payments/return/...`

Provider webhook endpoints should remain on the PMS service and should not be routed through the brochure origin:

- webhook endpoint: `https://book.sandboxhotel.com/webhooks/payments/<provider>`

Keep provider secrets server-side only and register the booking-origin return URLs with the hosted payment provider.

## DNS And Custom Domains

Recommended live mapping:

- `www.sandboxhotel.com` CNAME/custom domain -> Cloudflare brochure worker
- `book.sandboxhotel.com` CNAME/custom domain -> Render PMS web service
- `staff.sandboxhotel.com` CNAME/custom domain -> the same Render PMS web service

If your DNS is managed in Cloudflare, keep DNS proxied or DNS-only according to your TLS and origin strategy, but do not point `www` at the PMS service.

## Reverse-Proxy Path Strategy

A reverse-proxy path strategy such as `www.<domain>/book` and `www.<domain>/staff` is possible later, but it is not the recommended default for the current stack.

Reasons to defer it:

- the brochure repo is currently a static Cloudflare Worker site, not an application gateway
- the PMS assumes its own origin for public booking and staff flows
- path-based proxying would require extra care around cookies, CSRF, canonical URLs, webhook endpoints, and payment return routing

If path proxying is introduced later, it should be done at the edge with an explicit gateway design, not by drifting operational logic into `sandbox-hotel-site`.
