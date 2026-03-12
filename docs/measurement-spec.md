# Measurement Spec

Current status: the public site now initializes a consent-aware `dataLayer` in `sandbox_pms_mvp/static/public-site.js`. Vendor-specific destinations can be added later without changing the event names below.

## dataLayer Contract

Expose a `dataLayer` array on the public site before any analytics vendor script runs.

## Required Events

- `cta_click`
- `booking_request_submit`
- `contact_click`
- `gallery_interaction`

## Event Expectations

1. Include route, language, device class, and CTA source where available.
2. Reuse booking attribution values already captured by the PMS where possible.
3. Keep naming stable so launch-gate audits can compare implementation against this spec.

## Consent

1. Do not fire non-essential analytics before consent is granted.
2. Persist consent state explicitly and make the granted or denied state visible to the analytics layer.
3. Document any future vendor-specific consent mapping next to this spec.
