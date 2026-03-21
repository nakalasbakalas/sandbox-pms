# Phase 3 Smoke Test Plan — Staff Auth & Authorization

**Target environment:** Render-deployed Sandbox PMS (HTTPS)  
**Scope:** Staff login/logout, password reset, MFA, RBAC, cookie security, HTTPS enforcement

---

## 1. Required Setup

### Environment variables (must be set in Render)
| Variable | Required value |
|---|---|
| `SECRET_KEY` | 32+ byte random string |
| `AUTH_ENCRYPTION_KEY` | 32-byte Fernet key |
| `AUTH_COOKIE_SECURE` | `true` |
| `FORCE_HTTPS` | `true` |
| `ADMIN_EMAIL` | admin account email |
| `ADMIN_PASSWORD` | admin account password |

### Test accounts (seed with `flask seed-reference-data`)
| Role | Username | Notes |
|---|---|---|
| admin | `hui.admin` | Full access |
| manager | `manager` | Reports, settings.view, no user.edit |
| front_desk | `frontdesk` | Reservations, check-in/out; no admin |
| housekeeping | `housekeeping` | HK board only; no reservations |

---

## 2. Smoke Test Steps

### 2.1 Staff Login / Logout

**Steps:**
1. Navigate to `https://<host>/staff/login`
2. Submit correct credentials
3. Verify redirect to dashboard (200)
4. Check `Set-Cookie` response header contains `Secure; HttpOnly; SameSite=Lax`
5. Click "Logout" → POST `/staff/logout`
6. Verify session cookie is cleared (max-age=0 or deleted)
7. Navigate to `/staff` → redirected back to `/staff/login`

**Expected:** Login succeeds; cookie is Secure+HttpOnly; logout clears session.

---

### 2.2 Password Reset Request + Completion

**Steps:**
1. Navigate to `/staff/forgot-password`
2. Submit a valid staff email address
3. Check outbox (dev: check DB `outbox` or logs; prod: check email)
4. Follow reset link from email (single-use token in URL)
5. Submit new password
6. Verify redirect to login page with success flash
7. Re-attempt the same reset link → expect 400 or "invalid token"
8. Log in with new password → succeeds

**Expected:** Token is single-use; reset completes; old link is rejected.

---

### 2.3 MFA Enrollment + Verify

**Steps:**
1. Log in as a user without MFA enrolled
2. Navigate to `/staff/security`
3. Click "Enable MFA" → QR code displayed
4. Scan QR with authenticator app (e.g., Google Authenticator)
5. Submit the 6-digit TOTP code to confirm enrollment
6. Log out, then log back in
7. Verify MFA prompt appears after password step
8. Enter correct TOTP code → access granted
9. Enter wrong TOTP code → expect error, session not created

**Expected:** TOTP enrollment persists; MFA challenge fires on every login after enrollment; wrong code is rejected.

---

### 2.4 Permission Checks by Role

| Role | Should access | Should be denied (403) |
|---|---|---|
| admin | `/staff/admin`, `/staff/admin/staff-access`, `/staff/reports` | — |
| manager | `/staff/reports`, `/staff/reservations` | `/staff/admin/staff-access` |
| front_desk | `/staff/reservations`, `/staff/front-desk` | `/staff/admin`, `/staff/reports` |
| housekeeping | `/staff/housekeeping` | `/staff/reservations`, `/staff/admin` |

**Steps for each role:**
1. Log in as the role's test account
2. Visit each "Should access" URL → expect 200
3. Visit each "Should be denied" URL → expect 403

**Expected:** Each role is limited to its least-privilege boundary.

---

### 2.5 Cookie Security + HTTPS Enforcement

**Cookie flags (inspect in browser DevTools → Application → Cookies):**
- `Secure` flag must be present when `AUTH_COOKIE_SECURE=true`
- `HttpOnly` flag must be present
- `SameSite=Lax` must be present

**HTTPS redirect (when `FORCE_HTTPS=true`):**
1. Make an HTTP request to `http://<host>/staff/login`
2. Expect 301/308 redirect to `https://<host>/staff/login`

**Canonical host redirect (when `ENFORCE_CANONICAL_HOSTS=true`):**
1. Request the app via an alias hostname
2. Expect redirect to the canonical host

---

## 3. Automated Test Coverage

Automated tests in `sandbox_pms_mvp/tests/test_phase3_auth.py` cover:

- Login success/failure and CSRF enforcement
- Session fixation prevention (cookie rotates between logins)
- Idle and absolute timeout session expiry
- Password reset: single-use token, token expiry
- Account lockout after repeated failures + recovery
- Least-privilege permission boundaries for admin/manager/front_desk/housekeeping
- MFA enrollment and TOTP verification
- MFA recovery code (one-time use)
- Activity log entries for login success and logout

Additional security-configuration tests in `test_phase3_smoke_security.py` cover:

- `AUTH_COOKIE_SECURE=True` → `Set-Cookie` response contains `Secure`
- `AUTH_COOKIE_SECURE=False` → `Secure` flag is absent (test / non-TLS mode)
- `FORCE_HTTPS=True` → HTTP request redirects to HTTPS
- `ENFORCE_CANONICAL_HOSTS=True` → alias hostname redirects to canonical host
- `AUTH_COOKIE_HTTPONLY` → `HttpOnly` present in cookie header
- `AUTH_COOKIE_SAMESITE` → `SameSite=Lax` present in cookie header

---

## 4. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Login loop / no session | `SECRET_KEY` not set or changed | Set `SECRET_KEY` in Render env |
| Cookie missing `Secure` | `AUTH_COOKIE_SECURE=false` or not set | Set to `true` in Render |
| MFA QR blank | `AUTH_ENCRYPTION_KEY` missing | Generate and set Fernet key |
| Password reset email not received | `SENDGRID_API_KEY` not configured | Configure email provider |
| 403 on all staff routes | Role not seeded / permissions out of sync | Run `flask sync-role-permissions` |
| 500 on `/staff/settings` | Template or DB error | Check Render logs |
