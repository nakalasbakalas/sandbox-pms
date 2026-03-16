# Navbar changes

## Files changed

- `sandbox_pms_mvp/templates/base.html`
- `sandbox_pms_mvp/static/styles.css`
- `sandbox_pms_mvp/static/public-site.js`
- `sandbox_pms_mvp/static/header-nav.js`
- `sandbox_pms_mvp/tests/test_base_header_nav.py`

## What changed

- Rebuilt the shared header markup into a compact app-shell layout with brand, primary nav, and utility groups.
- Moved contact details into a utility menu and drawer instead of leaving them expanded under the brand.
- Added a compact right-side search form for staff/provider workspaces using existing reservations/bookings routes.
- Replaced oversized pill groupings with normalized nav item sizing, tighter spacing, and subtler active states.
- Added a shared mobile drawer flow for public and staff pages with preserved links, language switching, and logout controls.
- Moved drawer interaction handling into a new shared `header-nav.js` file and removed duplicate public-only drawer handlers from `public-site.js`.
- Added focused regression tests to verify the new header structure still renders required controls and preserved routes.

## Why

- The previous header consumed too much vertical space and made dense operational screens harder to scan.
- A GitHub-inspired information architecture needed clearer prioritization between primary navigation and secondary utilities.
- The refactor keeps the existing PMS routes and behaviors intact while making the header feel more compact, calmer, and more professional across desktop and mobile.
