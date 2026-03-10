# Production Code Review — Sandbox Hotel PMS
**Reviewer role:** Senior Full-Stack Engineer + QA  
**Scope:** Entire repository (Flask app, templates, CSS, config, deployment, tests)  
**Review date:** 2025-07  
**Verdict:** ⛔ NOT READY FOR PRODUCTION until Critical and blocking-High items are resolved

---

## Executive Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 5 |
| 🟠 High | 12 |
| 🟡 Medium | 10 |
| 🔵 Low | 9 |
| **Total** | **36** |

---

## 🔴 CRITICAL

---

### C-1 · Production credentials committed to working directory

| Field | Detail |
|-------|--------|
| **File** | `sandboxhotel-render.env` |
| **Category** | Security – Secrets Management |
| **Why it matters** | Full database access, session forgery, admin account takeover if this file ever reaches a public repo or gets leaked. The `.gitignore` pattern `*.env` currently prevents accidental commit, but a single misconfig (rename, `git add -f`, or CI copying of artifacts) exposes everything. The file should not exist in the repo directory at all. |
| **Evidence** | `DATABASE_URL=postgresql+psycopg://sandbox_hotel_pms_db_user:gUXEep0MOAyJp2CXlhHH5WwumRr8EJfB@…`, `SECRET_KEY=dcLLcC_1…`, `AUTH_ENCRYPTION_KEY=uVzY4P6v…`, `ADMIN_PASSWORD=Ms4-jLy…` |
| **Fix** | 1. Delete `sandboxhotel-render.env` from the working directory right now. 2. Rotate all four secrets in Render dashboard immediately. 3. Use `sandboxhotel-render.template.env` (no real values) as the only committed reference. 4. Run `git log --all --full-history -- '*.env'` to confirm no prior accidental commit. |

---

### C-2 · TRUSTED_HOSTS mismatch blocks all legitimate production requests

| Field | Detail |
|-------|--------|
| **File** | `sandboxhotel-render.env`, `pms/security.py` |
| **Category** | Security – Configuration |
| **Why it matters** | The `TRUSTED_HOSTS` env var is set to `sandboxhotel.com,sandbox-pms-prod.onrender.com`. The actual live Render service URL is `sandbox-hotel-pms-db.onrender.com`. If `TRUSTED_HOSTS` is enforced (Flask-Talisman or a custom before-request check in `security.py`), every request to the real service returns 400/403. If it is NOT currently enforced, the setting is providing false security with a wrong value — either way it is broken. |
| **Evidence** | `TRUSTED_HOSTS=sandboxhotel.com,sandbox-pms-prod.onrender.com` vs live URL `sandbox-hotel-pms-db.onrender.com` |
| **Fix** | Set `TRUSTED_HOSTS=sandboxhotel.com,sandbox-hotel-pms-db.onrender.com` in Render env vars. Verify the host validation code in `security.py` and add a startup check that logs the configured trusted hosts list. |

---

### C-3 · Idempotency key is not user-scoped — booking data leakage and collision

| Field | Detail |
|-------|--------|
| **File** | `templates/availability.html` |
| **Category** | Security – Business Logic |
| **Why it matters** | Two simultaneous visitors searching for the same room type on the same dates with the same occupancy generate the **identical** idempotency key. The `create_reservation_hold` service de-duplicates by this key, so User B's POST to `/booking/hold` returns User A's existing hold. User B proceeds to the booking form pre-populated with User A's hold reference and potentially User A's email. User B can then confirm a reservation against User A's hold, causing a double-booking or stealing the hold. |
| **Evidence** | `{{ [item.room_type.id, form_data.check_in, form_data.check_out, form_data.adults, form_data.children]\|join('-') }}` — no session, user, or random component |
| **Fix** | Add a per-session nonce: generate `session['booking_nonce'] = secrets.token_hex(8)` on first visit and include it in the key: `{{ [session_nonce, item.room_type.id, …]\|join('-') }}`. Pass `session_nonce` from the route context. |

---

### C-4 · Open redirect via unvalidated `back_url` POST parameter

| Field | Detail |
|-------|--------|
| **File** | `pms/app.py` — `staff_notification_read` route |
| **Category** | Security – Open Redirect |
| **Why it matters** | A logged-in staff member clicking "Mark read" on a notification with a forged `back_url` value (e.g., `https://evil-phishing.com`) is silently redirected off-site. While CSRF protection prevents fully forged cross-site submissions, an attacker with any write access (notification injection, XSS in an adjacent field, or social engineering) can trigger this. It also violates the OWASP Unvalidated Redirects and Forwards guideline. |
| **Evidence** | `return redirect(request.form.get("back_url") or url_for("staff_dashboard"))` — `back_url` is taken verbatim from POST body without validation |
| **Fix** | Validate the redirect target is a local path: `back = request.form.get("back_url", ""); safe_back = back if back.startswith("/") and not back.startswith("//") else url_for("staff_dashboard"); return redirect(safe_back)`. Apply the same guard to every route that accepts a `back` or `back_url` parameter and uses it as a redirect destination. |

---

### C-5 · `request.remote_addr` used for client IP instead of proxy-aware helper

| Field | Detail |
|-------|--------|
| **File** | `pms/app.py` — `booking_hold`, `booking_confirm`, `booking_cancel_request`, `booking_modify_request`, `staff_login`, `staff_mfa_verify`; also `pms/security.py` defines `request_client_ip()` |
| **Category** | Security – Audit Logging / Rate Limiting |
| **Why it matters** | Behind Gunicorn and Render's proxy, `request.remote_addr` is always the proxy's internal IP. Every reservation, login attempt, and audit log entry records the proxy IP rather than the real guest or attacker IP. Rate limiting, fraud detection, and forensics all become useless — a brute-force on `/staff/login` from any client logs the same IP. The project already has `request_client_ip()` in `security.py` for exactly this purpose. |
| **Evidence** | `request_ip=request.remote_addr` in `HoldRequestPayload(…)`, `login_with_password(…, ip_address=request.remote_addr, …)`, etc. |
| **Fix** | Replace every `request.remote_addr` used for `request_ip` / `ip_address` with `request_client_ip()` from `pms.security`. Ensure `TRUST_PROXY_COUNT` is set correctly in production config. |

---

## 🟠 HIGH

---

### H-1 · Language switcher generates duplicate `lang=` query parameters

| Field | Detail |
|-------|--------|
| **File** | `templates/base.html` |
| **Category** | Functionality – i18n |
| **Why it matters** | Clicking a language button on any page that already has `lang=` in the URL appends a second `lang=` parameter (e.g., `?lang=en&lang=th`). `request.args.get("lang")` returns only the first value, so language switching silently fails after the first switch. Guests are stuck on the first language they chose. |
| **Evidence** | `{{ request.path }}?{{ request.query_string.decode('utf-8') ~ ('&' if request.query_string else '') }}lang={{ code }}` |
| **Fix** | Build the URL by removing any existing `lang` param first: pass `args_no_lang = {k:v for k,v in request.args.items() if k != 'lang'}` from the route context and use `url_for(request.endpoint, **args_no_lang, lang=code)` in the template. |

---

### H-2 · `flash("error")` flash category has no CSS styling

| Field | Detail |
|-------|--------|
| **File** | `static/styles.css`, `pms/app.py` (all error flash calls) |
| **Category** | Frontend – CSS / UX |
| **Why it matters** | `static/styles.css` defines `.flash.success`, `.flash.warning`, `.flash.danger`, `.flash.info` — but **not** `.flash.error`. Every booking error, login error, and staff action error renders as an unstyled plain message box with no distinguishing colour. Guests see no visual indication that something went wrong. |
| **Evidence** | `flash(public_error_message(exc), "error")` — used in ~20 routes; CSS file has no `.flash.error` rule |
| **Fix** | Add `.flash.error { border-left: 4px solid var(--color-red); background: …; }` to `styles.css`, OR globally replace `"error"` with `"danger"` in all `flash()` calls to match the existing CSS class. |

---

### H-3 · Inter font referenced in CSS but never loaded

| Field | Detail |
|-------|--------|
| **File** | `static/styles.css`, `templates/base.html` |
| **Category** | Frontend – Typography |
| **Why it matters** | `font-family: Inter, ui-sans-serif, system-ui, …` is used throughout the stylesheet, but no `<link rel="preconnect">` or `<link rel="stylesheet">` for Inter exists in `base.html`. Browsers fall back to the system sans-serif font. The UI looks inconsistent across operating systems: macOS shows San Francisco, Windows shows Segoe UI, Android shows Roboto — none of them are Inter. |
| **Evidence** | `body { font-family: Inter, ui-sans-serif, system-ui, -apple-system, … }` in CSS; no font `<link>` in `base.html` |
| **Fix** | Either: (a) Add `<link rel="preconnect" href="https://fonts.googleapis.com">` and the Inter Google Fonts stylesheet to `base.html`; or (b) Self-host Inter in `static/fonts/` and add a `@font-face` rule; or (c) Remove Inter from the font stack and commit to the system font stack. Option (c) is simplest for a PMS. |

---

### H-4 · `pytest` is a production dependency

| Field | Detail |
|-------|--------|
| **File** | `requirements.txt` |
| **Category** | Deployment – Dependencies |
| **Why it matters** | `pytest>=8.3,<9.0` is in the main `requirements.txt`, so it is installed on every production Render build. This unnecessarily inflates the production image/environment, increases build time, and adds attack surface for test-runner vulnerabilities. It also signals that the dev/prod separation is not being maintained. |
| **Evidence** | Line `pytest>=8.3,<9.0` in `requirements.txt` |
| **Fix** | Move `pytest` (and any other test-only packages) to a separate `requirements-dev.txt`. Update local setup docs accordingly. The CI/CD step that runs tests should use `pip install -r requirements-dev.txt`. |

---

### H-5 · `FLASK_ENV` is deprecated in Flask 3.x

| Field | Detail |
|-------|--------|
| **File** | `sandboxhotel-render.env` (and presumably Render dashboard) |
| **Category** | Deployment – Configuration |
| **Why it matters** | Flask 3.0+ removed `FLASK_ENV`. Setting it has no effect and may generate warnings. More importantly, the app logic that checks production mode operates on `APP_ENV`, not `FLASK_ENV`. Setting `FLASK_ENV=production` creates a false sense of security: developers assume Flask is in production mode when it may not be. |
| **Evidence** | `FLASK_ENV=production` in `sandboxhotel-render.env`; Flask 3.x changelogs confirm `FLASK_ENV` was removed |
| **Fix** | Remove `FLASK_ENV` from all env files. Ensure `APP_ENV=production` is set. Verify `FLASK_DEBUG=0` is also set explicitly. |

---

### H-6 · Timezone-naive `datetime.utcnow()` / `datetime.now()` in two routes

| Field | Detail |
|-------|--------|
| **File** | `pms/app.py` — `staff_notification_read` (line ~3780), `staff_review_queue` POST handler |
| **Category** | Backend – Date/Time |
| **Why it matters** | Python 3.12 deprecates `datetime.utcnow()`. More critically, `staff_review_queue` uses `datetime.now()` (local timezone, which on Render/UTC is UTC — but not guaranteed). Storing naive datetimes inconsistently with timezone-aware datetimes in other columns can corrupt audit ordering and display logic. The codebase already has a `utc_now()` utility that should be used instead. |
| **Evidence** | `notification.read_at = datetime.utcnow()` in `staff_notification_read`; `entry.reviewed_at = datetime.now()` in `staff_review_queue` |
| **Fix** | Replace both with `datetime.now(timezone.utc)` (or the project's `utc_now()` helper). Add `from datetime import timezone` where needed. |

---

### H-7 · `error.html` exposes internal label "Security-safe error response" to users

| Field | Detail |
|-------|--------|
| **File** | `templates/error.html` |
| **Category** | Frontend – UX / Information Disclosure |
| **Why it matters** | The error page shown to guests and staff includes `<p class="eyebrow">Security-safe error response</p>`. This is a developer-facing annotation that was never removed. It makes the error page look broken and unprofessional, and hints to users that something deliberate was hidden from them — reducing trust. |
| **Evidence** | `<p class="eyebrow">Security-safe error response</p>` in error template |
| **Fix** | Remove or replace the eyebrow text with something meaningful to users, e.g., `<p class="eyebrow">{{ hotel_name }}</p>`. |

---

### H-8 · `back_url` / `back` URL params rendered as raw `href` — JavaScript URI injection

| Field | Detail |
|-------|--------|
| **File** | Multiple staff templates that render `{{ back_url }}` in `<a href="…">` |
| **Category** | Security – XSS |
| **Why it matters** | Jinja2 HTML-escapes `&`, `<`, `>`, `"`, but it does **not** strip `javascript:` URIs. If an attacker can control the `back` query parameter (passed through URL chains into templates), inserting `javascript:fetch(…)` as the back_url renders a clickable link that executes JavaScript when a staff member clicks "Back". Session cookies are HttpOnly so cannot be stolen this way, but it could exfiltrate other page content or trigger state-changing actions. |
| **Evidence** | Routes like `staff_front_desk_detail` pass `back_url=request.args.get("back")` directly to templates which render `<a href="{{ back_url }}">` |
| **Fix** | Validate all `back` / `back_url` values server-side: accept only paths starting with `/` and not `//`. Reject or strip any value containing colons before the first `/`. |

---

### H-9 · No favicon, robots.txt, or sitemap.xml

| Field | Detail |
|-------|--------|
| **File** | `static/` directory |
| **Category** | Frontend – SEO / UX |
| **Why it matters** | Every browser requests `/favicon.ico` on page load. Without one, each page load generates a 404 log entry on the server. More importantly, every guest sees a blank/broken favicon tab — instant trust signal failure. Without `robots.txt`, search engine crawlers index staff-only and booking-hold pages. |
| **Evidence** | `static/` contains only `styles.css`; no `<link rel="icon">` in `base.html` |
| **Fix** | Add `static/favicon.ico` (or a `<link rel="icon" href="…">` pointing to the hotel logo). Add `static/robots.txt` with `Disallow: /staff/` and `Disallow: /booking/hold`. |

---

### H-10 · No Open Graph, canonical URL, or page title template

| Field | Detail |
|-------|--------|
| **File** | `templates/base.html`, `templates/index.html` |
| **Category** | SEO / Frontend |
| **Why it matters** | When a guest shares the booking link on LINE, WhatsApp, or Facebook (common in Thailand), the link unfurls with no image, wrong title, and no description — reducing click-through. The index title is hardcoded as `"Sandbox Hotel"` rather than `{{ hotel_name }}`, so a property that customises its name still shows the default. |
| **Evidence** | `base.html` has no `<meta property="og:*">` tags; `index.html` has `<title>Sandbox Hotel</title>` not `<title>{{ hotel_name }}</title>` |
| **Fix** | Add `<meta property="og:title">`, `<meta property="og:description">`, `<meta property="og:image">`, `<link rel="canonical">` to `base.html` with sensible defaults. Change the `index.html` title to `<title>{{ hotel_name }}</title>`. |

---

### H-11 · Auth cookie has no `max_age` — does not expire in 8 hours as configured

| Field | Detail |
|-------|--------|
| **File** | `pms/app.py` — `persist_auth_cookie` after_request hook |
| **Category** | Security – Session Management |
| **Why it matters** | `SESSION_ABSOLUTE_HOURS=8` controls server-side session expiry in the `UserSession` table, but the browser cookie is set with **no** `max_age` or `expires`, making it a session cookie. If a staff member's browser crashes or is left open, the cookie persists indefinitely in the browser (until the browser is closed). On shared or public computers, this means sessions outlive the intended 8-hour window at the browser level. |
| **Evidence** | `response.set_cookie(…, httponly=…, secure=…, samesite=…, path="/")` — no `max_age` parameter |
| **Fix** | Add `max_age=app.config["SESSION_ABSOLUTE_HOURS"] * 3600` to the `set_cookie` call so the browser also expires the cookie after 8 hours. |

---

### H-12 · `staff_review_queue` review timestamps use `datetime.now()` (local time, not UTC)

| Field | Detail |
|-------|--------|
| **File** | `pms/app.py` — `staff_review_queue` POST handler |
| **Category** | Backend – Data Integrity |
| **Why it matters** | `entry.reviewed_at = datetime.now()` records local server time. On Render (UTC), this is the same as UTC by accident, but the intent is inconsistent with the rest of the system and breaks if the server's TZ ever changes. `entry.contacted_at = datetime.now()` has the same issue. This is distinct from H-6 because the method is `datetime.now()` not `datetime.utcnow()`, making the timezone dependency implicit. |
| **Evidence** | `entry.reviewed_at = datetime.now()` and `entry.contacted_at = datetime.now()` in the review queue handler |
| **Fix** | Use `datetime.now(timezone.utc)` for both. |

---

## 🟡 MEDIUM

---

### M-1 · `current_settings()` performs a full DB query on every booking request

| Field | Detail |
|-------|--------|
| **File** | `pms/app.py` — `current_settings()` / `get_setting_value()`, called from `booking_hold`, `booking_confirm`, `inject_globals` |
| **Category** | Performance |
| **Why it matters** | `AppSetting.query.filter_by(deleted_at=None).all()` loads every application setting row on every request that touches any setting. The `inject_globals` context processor calls `get_setting_value()` nine times per request (hotel name, currency, logo, phone, email, address, check-in time, check-out time, brand mark). Under moderate load this creates measurable DB latency and is the single biggest avoidable DB hot-path. |
| **Fix** | Cache the settings dict in Flask's application-level cache (`flask_caching` or a simple in-process dict) with a 30–60 second TTL. Invalidate on any `upsert_setting()` call. |

---

### M-2 · Hold expiry displayed without timezone indicator

| Field | Detail |
|-------|--------|
| **File** | `templates/public_booking_form.html` |
| **Category** | UX – i18n |
| **Why it matters** | `{{ hold.expires_at.strftime('%Y-%m-%d %H:%M') }}` shows the UTC expiry time with no timezone label. The hotel is in Thailand (UTC+7). A hold expiring at `14:00` UTC displays as `14:00` to Thai guests who believe it means 2 PM local time — but it actually expires at `21:00` local time. While this is a 7-hour permissive error (good for guests), it erodes trust when the guest notices the discrepancy, and it breaks for any property in a UTC-negative timezone. |
| **Fix** | Either convert to local time before rendering (`hold.expires_at + timedelta(hours=7)`) or append the timezone: `{{ hold.expires_at.strftime('%Y-%m-%d %H:%M UTC') }}`. Better: store a `timezone` setting and format accordingly. |

---

### M-3 · CSRF failure returns a cryptic HTTP 400 with no user guidance

| Field | Detail |
|-------|--------|
| **File** | `pms/app.py` — `validate_csrf_request()` |
| **Category** | UX / Security |
| **Why it matters** | When a guest's session expires between visiting the availability page and submitting the hold form, the CSRF token is gone. `validate_csrf_request()` calls `abort(400, description="CSRF validation failed.")`. The user sees a raw 400 error page with no option to start over. This is a conversion-killing dead end for guests who step away mid-booking. |
| **Evidence** | `abort(400, description="CSRF validation failed.")` with no redirect logic |
| **Fix** | Instead of `abort(400)`, redirect to the referring page or the availability page with a flash message: `"Your session expired. Please try again."` For API/AJAX paths, return a 400 JSON response. |

---

### M-4 · `get_live_available_rooms()` has an N+1 query pattern

| Field | Detail |
|-------|--------|
| **File** | `pms/services/public_booking_service.py` |
| **Category** | Performance |
| **Why it matters** | The availability search loops over each room and queries inventory/reservation data per room per night, resulting in O(rooms × nights) queries per availability search. For a hotel with 20 rooms and a 7-night search, this is potentially 140+ queries per availability page load, plus the `cleanup_expired_holds()` lock-acquisition on every search. Under even moderate concurrent traffic this will saturate the DB connection pool. |
| **Fix** | Eager-load room inventory in a single join query across all rooms and the date range before entering the loop. Use SQLAlchemy's `joinedload` or a raw `IN (date_range)` query. |

---

### M-5 · `cleanup_expired_holds()` acquires `FOR UPDATE` lock on every availability search

| Field | Detail |
|-------|--------|
| **File** | `pms/services/public_booking_service.py` |
| **Category** | Performance / Concurrency |
| **Why it matters** | PostgreSQL `FOR UPDATE` serialises concurrent availability searches. During a busy period, 10 concurrent availability searches will queue behind each other's hold-cleanup lock rather than running in parallel. This is especially damaging because availability search is expected to be a high-frequency, largely read-only operation. |
| **Fix** | Decouple expired-hold cleanup from the search path. Run cleanup via a scheduled job (`process-notifications` CLI pattern already exists in the codebase) every 1–5 minutes instead of per-request. |

---

### M-6 · Missing translation keys in Thai and Chinese language packs

| Field | Detail |
|-------|--------|
| **File** | `pms/i18n.py` |
| **Category** | i18n |
| **Why it matters** | Several payment-related keys (`payment_email_subject`, `payment_email_intro`, `payment_link_intro`, `payment_link_expired`) exist in the `en` dict but are absent from `th` and `zh-Hans`. The `t()` function falls back silently to the English string. Thai and Chinese-preferring guests receive English payment emails with no indication of the fallback. |
| **Fix** | Add the missing keys to all three language packs. Consider adding an automated test that asserts all language dicts have identical key sets. |

---

### M-7 · `.button:hover` has `transform` with no `transition` — jarring snap

| Field | Detail |
|-------|--------|
| **File** | `static/styles.css` |
| **Category** | Frontend – CSS |
| **Why it matters** | `.button:hover { transform: translateY(-1px); }` with no `transition` property causes all CTA buttons to snap instantly rather than animate smoothly. On low-DPI screens this is especially jarring and cheapens the feel of the booking flow. |
| **Fix** | Add `transition: transform 0.15s ease, box-shadow 0.15s ease;` to the `.button` base rule. |

---

### M-8 · `booking.terms_version` settings lookup uses chained dict access without safe fallback

| Field | Detail |
|-------|--------|
| **File** | `pms/app.py` — `booking_confirm` route; `templates/public_booking_form.html` |
| **Category** | Reliability |
| **Why it matters** | `current_settings().get("booking.terms_version", {}).get("value", "2026-03")` is safe, but `settings['booking.terms_version']['value']` in the template raises `KeyError` if the setting row is missing from the DB (e.g., after a fresh DB with seeds not fully run). This silently breaks the booking form in certain deployment states. |
| **Fix** | Always use `.get()` chaining both in routes and templates. In the template: `{{ settings.get('booking.terms_version', {}).get('value', '2026-03') }}`. |

---

### M-9 · Sensitive admin operations allow any `settings.edit` user to change payment provider

| Field | Detail |
|-------|--------|
| **File** | `pms/app.py` — `staff_admin_payments` route |
| **Category** | Security – Access Control |
| **Why it matters** | Changing the payment provider (e.g., switching from Stripe to a malicious endpoint) is a high-privilege action. The guard `require_admin_role(actor)` is only called **if** the submitted `active_provider` differs from the stored value. A user with only `settings.edit` can change all other payment settings (deposit enabled, link expiry, resend cooldown) without admin role. The distinction between payment-sensitive settings and general settings needs to be explicit. |
| **Fix** | Move payment provider changes to a dedicated permission (e.g., `payment.configure`) and enforce it unconditionally for the entire `staff_admin_payments` POST handler. |

---

### M-10 · `staff_admin_operations`: `else: abort(400)` is dead code for `housekeeping_defaults`

| Field | Detail |
|-------|--------|
| **File** | `pms/app.py` — `staff_admin_operations` route, POST handler |
| **Category** | Backend – Logic |
| **Why it matters** | The `if action == "preview_template": … elif action == "housekeeping_defaults": … else: abort(400)` chain is reachable via: `action = "policy"` → first `if` block returns early; `action = "notification_template"` → second `if` returns early. But `action = "housekeeping_defaults"` falls into `elif` and redirects. Any unrecognised action hits `abort(400)` — **but** the `else` is never reachable if `action == "policy"` returns early via `return redirect(…)` before reaching the `if action == "preview_template"` block at the end. This means an unknown action submitted after the policy or template blocks is silently accepted without validation for the final block in the chain. The logic requires careful reading and is fragile. |
| **Fix** | Refactor the POST handler into a dispatch dict or explicit `if/elif/else` chain at one level rather than multiple independent `if` checks with returns in some and fall-through in others. |

---

## 🔵 LOW

---

### L-1 · No skip-to-main-content link for keyboard/screen-reader users

| **File** | `templates/base.html` |
| **Fix** | Add `<a href="#main-content" class="skip-link">Skip to main content</a>` as first child of `<body>`, with `.skip-link { position: absolute; transform: translateY(-100%); }` and `:focus { transform: translateY(0); }`. |

---

### L-2 · No `prefers-reduced-motion` media query

| **File** | `static/styles.css` |
| **Fix** | Wrap any CSS transitions and transforms (button hover, sticky header backdrop-filter) in `@media (prefers-reduced-motion: no-preference) { … }`. |

---

### L-3 · No `autocomplete` attributes on login form

| **File** | `templates/staff_login.html` |
| **Fix** | Add `autocomplete="username"` to the identifier input and `autocomplete="current-password"` to the password input. Browsers will offer to save credentials, reducing login friction for staff. |

---

### L-4 · `backdrop-filter` on sticky header has no fallback

| **File** | `static/styles.css` |
| **Fix** | Add `background: rgba(var(--color-bg-rgb), 0.95)` before the `backdrop-filter` line so browsers that don't support `backdrop-filter` (Firefox without `layout.css.backdrop-filter.enabled`) still show an opaque header. |

---

### L-5 · Confirmation status shown as raw enum string, not humanised

| **File** | `templates/public_confirmation.html` |
| **Fix** | Map reservation status to a human label: `{{ {'confirmed': 'Confirmed', 'checked_in': 'Checked In', 'cancelled': 'Cancelled'}.get(reservation.current_status, reservation.current_status) }}`. Localise per language. |

---

### L-6 · No `<footer>` element — accessibility landmark gap

| **File** | `templates/base.html` |
| **Fix** | Wrap closing contact/copyright content in a `<footer>` landmark element so screen reader users can navigate directly to it. |

---

### L-7 · `health` endpoint does not check DB connectivity

| **File** | `pms/app.py` — `health` route |
| **Fix** | Add a lightweight DB probe: `db.session.execute(text("SELECT 1"))`. Return 200 if it succeeds, 503 with `{"status": "db_error"}` if it fails. Render's health-check will then correctly detect DB-down scenarios. |

---

### L-8 · Mobile breakpoint collapses all multi-column grids at 820px

| **File** | `static/styles.css` |
| **Fix** | Consider a two-step breakpoint: at 1024px collapse 3-col to 2-col; at 600px collapse to 1-col. The single 820px breakpoint causes tablet users to see the same single-column layout as mobile users, wasting screen real estate. |

---

### L-9 · `python-dotenv` missing from requirements — local dev env silent

| **File** | `requirements.txt` |
| **Fix** | Add `python-dotenv>=1.0,<2.0` if the app is expected to auto-load `.env` files locally. If `.env` loading is intentionally manual, add a note to the README explaining how to configure the local environment. |

---

## Special Audit Sections

### 1. HTML Structure & Semantics
- **Pass:** `<html lang>`, `<meta charset>`, `<meta viewport>`, semantic `<main>`, `<nav>`, `<form>` with labels.
- **Fail:** No `<footer>`, no skip-link, no `<h1>` hierarchy audit across all templates verified.
- **Fail:** `<label><span>&nbsp;</span>…` non-semantic spacer hack in `index.html` search form.

### 2. CSS Quality
- **Pass:** Consistent CSS custom properties for colours, single stylesheet, dark theme.
- **Fail:** No `prefers-color-scheme: light` support. No `prefers-reduced-motion`. Missing `.flash.error`. `.button:hover` missing transition. Hardcoded `px` font sizes (no fluid/relative sizing). `backdrop-filter` without fallback.

### 3. JavaScript
- **N/A:** No JavaScript files in the project. All interactions are form-based server-side round trips.
- **Note:** A small amount of inline JS could greatly improve UX (hold countdown timer, form validation feedback) without requiring a framework.

### 4. Assets & Performance
- **Fail:** Inter font not loaded. No `<link rel="preload">` for the main CSS. No image optimisation considerations (logo_url is user-input, no size constraints). No CDN for static assets.

### 5. Accessibility (WCAG 2.1 AA)
- **Pass:** `lang` attribute on `<html>`. Labels on form inputs. Contrast ratios appear adequate for dark theme.
- **Fail:** No skip link. No `aria-live` region for flash messages (screen readers won't announce flash feedback). No `aria-label` on icon-only buttons. No focus-visible styles beyond basic `input:focus`. No `role="alert"` on error messages.

### 6. SEO
- **Fail:** No `<meta name="description">`. No Open Graph. No canonical URL. No structured data (`application/ld+json` for hotel/lodging). No sitemap.xml. No robots.txt with `Disallow: /staff/`. `index.html` title hardcoded.

### 7. Security
- **Critical:** Credentials in working-directory env file (C-1).
- **Critical:** TRUSTED_HOSTS mismatch (C-2).
- **Critical:** Idempotency key collision (C-3).
- **Critical:** Open redirect (C-4).
- **Pass:** Argon2 password hashing. CSRF protection on all state-changing endpoints. Auth cookie is HttpOnly, Secure, SameSite. Fernet-encrypted session cookies. TOTP MFA available. HSTS configured. CSP header set. `hmac.compare_digest` used for constant-time comparison. SQL injection risk: none (ORM throughout). XSS in templates: mitigated by Jinja2 auto-escape (except `javascript:` URIs in `href`).

### 8. i18n / Localisation
- **Pass:** 3-language support (th, en, zh-Hans). `<html lang>` set correctly. `normalize_language()` defaults to Thai.
- **Fail:** Missing translation keys for payment emails in th/zh-Hans. Language switcher broken after first switch (H-1). No RTL support (not needed for th/zh-Hans, but note for future Arabic etc.). Language preference not persisted in session/cookie — resets on each navigation unless `lang=` in URL.

### 9. Conversion Flow (Public Booking)
- **Pass:** Multi-step flow is clear: Search → Availability → Hold → Guest Details → Confirm → Confirmation page.
- **Fail:** No progress indicator (step 1 of 4). Hold countdown timer missing (guest doesn't see time ticking). No "Add to Calendar" link on confirmation. No print receipt button. Confirmation page status shown as raw enum. Error messages and re-rendering on form failure could be smoother (scroll to error, highlight field).

### 10. Staff / Admin Workflows
- **Pass:** Permission-gated routes, `require_permission()` on all sensitive endpoints, MFA, force-password-reset gate.
- **Fail:** Review queue link in nav shown to all logged-in staff regardless of permission. `back_url` XSS risk. `datetime.now()` in review queue.

### 11. Database & ORM
- **Pass:** Alembic migrations, proper use of SQLAlchemy ORM, UUID primary keys, soft-deletes (`deleted_at`), `FOR UPDATE` locking on hold creation.
- **Fail:** N+1 query in availability search. Settings loaded per-request. `cleanup_expired_holds()` on hot path.

### 12. Deployment & DevOps
- **Fail:** FLASK_ENV deprecated. TRUSTED_HOSTS wrong hostname. Credentials in working directory. `pytest` in production deps. No health check DB probe. `python-dotenv` missing.
- **Pass:** Gunicorn with 4 workers. `flask db upgrade` in build command. SQLite auto-bootstrap guard (SQLite only). `python-dotenv` pattern works via Render env vars (no file load needed in production).

### 13. Test Coverage
- **Observed:** `tests/conftest.py` exists with fixture setup. Test files present.
- **Not verified:** Coverage percentage, whether booking flow, CSRF, auth flows, and pricing logic are covered.
- **Recommendation:** Add tests for: idempotency key collision, CSRF bypass attempts, hold expiry cleanup, language fallback, pricing VAT calculation, permission gate enforcement.

### 14. Code Quality & Maintainability
- **Pass:** Consistent service layer pattern. Dataclass payloads for service calls. Audit logging. Activity logging.
- **Fail:** `register_routes()` is a single ~2000-line nested function — difficult to navigate and test individual routes. All routes in one function means no route blueprint modularity. Consider splitting into Flask Blueprints (public, staff, admin, cashier, housekeeping, api).

---

## Quick Wins (Top 10 — Fix in Under 30 Minutes Each)

| # | Fix | File | Impact |
|---|-----|------|--------|
| 1 | Delete `sandboxhotel-render.env`, rotate secrets | `sandboxhotel-render.env` | 🔴 Critical security |
| 2 | Fix `TRUSTED_HOSTS` to correct Render hostname | Render env vars | 🔴 Production broken |
| 3 | Add `.flash.error { … }` CSS rule matching `.flash.danger` | `static/styles.css` | All error messages invisible |
| 4 | Replace `request.remote_addr` → `request_client_ip()` in routes | `pms/app.py` | Accurate audit trail |
| 5 | Fix language switcher to strip existing `lang=` param | `templates/base.html` | Language switching broken |
| 6 | Remove `pytest` from `requirements.txt` | `requirements.txt` | Cleaner production builds |
| 7 | Replace `FLASK_ENV` with `APP_ENV=production` | Render env vars | Correct Flask 3.x config |
| 8 | Fix `datetime.utcnow()` → `datetime.now(timezone.utc)` in two routes | `pms/app.py` | Python 3.12 deprecation |
| 9 | Remove "Security-safe error response" eyebrow from error template | `templates/error.html` | Professional error pages |
| 10 | Add `max_age` to auth cookie `set_cookie()` call | `pms/app.py` | Session expires as designed |

---

## Release Readiness Verdict

### ⛔ BLOCKERS (must fix before launch)

1. **C-1** — Rotate all production secrets NOW. Delete env file from working directory.
2. **C-2** — Fix `TRUSTED_HOSTS` or production requests will be rejected/unprotected.
3. **C-3** — Idempotency key collision can cause one guest to receive another's booking hold.
4. **C-4** — Open redirect in staff area (lower urgency but a known-bad pattern).
5. **C-5** — All IPs logged are proxy IPs; rate limiting and fraud detection are currently blind.
6. **H-1** — Language switcher is broken for all repeat users.
7. **H-2** — All booking error messages are unstyled and visually indistinguishable from info.

### Top 3 Conversion Improvements

1. **Add a hold countdown timer** — guests need to know their 15-minute hold is expiring. A visible timer (even pure CSS using animation) reduces abandonment.
2. **Fix the language switcher** (H-1) — for a Thai-primary hotel targeting international guests, broken language switching directly reduces international conversions.
3. **Add a progress indicator** to the multi-step booking flow (Search → Hold → Guest Details → Confirm) — removes uncertainty about how many steps remain.

### Top 3 Codebase Hygiene Improvements

1. **Split `register_routes()` into Flask Blueprints** — the current 2000-line nested function makes routing untestable in isolation and prevents incremental testing of individual route groups.
2. **Add a settings cache** — the per-request `AppSetting` full-table scan is the most avoidable performance issue in a frequently hit code path.
3. **Add a required-keys assertion in tests for i18n dicts** — ensures Thai and Chinese translation packs stay in sync with the English master as new copy is added.
