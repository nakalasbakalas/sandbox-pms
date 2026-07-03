# Slice 5Z - Live Protected Page Gate

Date: 2026-07-02T18:15+07:00.

Verdict: partial P0 progress. Representative protected PMS pages on `https://book.sandboxhotel.com` rendered the unauthenticated login form and did not expose protected PMS workspace text.

This proves live unauthenticated page gating for the checked routes. It does not prove credentialed production login/logout, role-by-role production RBAC, underprivileged-role denial, or bootstrap/setup-token removal.

## Scope

- Public target: `https://book.sandboxhotel.com`
- Credential posture: no production credentials, cookies, session tokens, passwords, database URLs, or secret values were supplied.
- Browser posture: headless Playwright browser with empty storage state.
- Production posture: no deploy, restart, SSH session, database shell, production mutation, DB-mutating E2E, paid action, screenshots, or secret-value access was performed.

## Checks

Initial check:

- A first strict assertion looked for the current-checkout `Username or email` login label and timed out.
- Follow-up inspection showed the live service is still the older deployed build whose login form uses `Email address`.
- That timeout is not used as failure evidence for page gating; it is live deploy drift evidence.

Final command:

```text
node <inline Playwright probe against https://book.sandboxhotel.com>
```

Result: passed.

## Representative Protected Page Results

| Path | HTTP status | Final path | Result |
| --- | ---: | --- | --- |
| `/` | 200 | `/` | Login form visible; one password input; no protected terms observed. |
| `/rooms` | 200 | `/rooms` | Login form visible; one password input; no room/workspace terms observed. |
| `/reservations` | 200 | `/reservations` | Login form visible; one password input; no reservation/workspace terms observed. |
| `/cashier` | 200 | `/cashier` | Login form visible; one password input; no cashier/payment/folio terms observed. |
| `/housekeeping` | 200 | `/housekeeping` | Login form visible; one password input; no housekeeping-board terms observed. |
| `/settings` | 200 | `/settings` | Login form visible; one password input; no settings/workspace terms observed. |
| `/user-management` | 200 | `/user-management` | Login form visible; one password input; no user-management terms observed. |

Observed login label on the live deploy:

- `Email address`

This differs from the current checkout's username-first login label and reinforces that the custom-domain service is still on an older deploy. It does not weaken the page-gating proof for unauthenticated users.

## Route Drift

| Path | HTTP status | Result |
| --- | ---: | --- |
| `/ops/settings` | 200 | Rendered `Page not found`; this is live deploy route drift, not protected-page access proof. |

## Post-Evidence Validation

| Command | Result | Evidence Summary |
| --- | --- | --- |
| `npm.cmd run launch:evidence` | Passed | Evidence inventory includes this file; no unredacted secret-shaped values were found in launch evidence docs, and no high-confidence production secret-shaped values were found in tracked/unignored text files. |
| `git diff --check` | Passed | Exited 0 with Git line-ending warnings only for edited markdown files. |

## Remaining Boundary

This slice moves the `Unauthorized users cannot open protected pages` proof from missing to representative unauthenticated live proof. The broader production users/auth/RBAC/logout P0 remains open until the following evidence exists:

- redacted approved production user list;
- credentialed production login/logout proof;
- production role matrix for intended roles;
- underprivileged-role protected page and API mutation denial proof;
- bootstrap/setup-token/temporary access removal or rotation evidence.
