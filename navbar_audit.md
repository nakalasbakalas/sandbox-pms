# Navbar audit

## Current issues found

- The shared header in `sandbox_pms_mvp/templates/base.html` mixed brand, contact data, public CTAs, staff navigation, language buttons, user identity, and sign-out controls in one wrapping row.
- Phone, email, LINE, and WhatsApp were rendered as always-visible inline text under the brand, which increased header height and competed with primary navigation.
- Staff navigation links, identity pills, language pills, and auth actions all used similar visual weight, so the most important operational destinations did not stand out.
- Desktop layouts wrapped quickly because the old `.topnav` allowed many independent pills with inconsistent widths.
- Mobile behavior was optimized for the public site only; staff pages had no dedicated compact drawer flow and instead relied on general wrapping/stacking.

## Why these issues hurt usability

- A tall header reduces visible workspace area for dense PMS screens such as front desk, reservations, and housekeeping.
- When every element looks like a pill CTA, scan speed drops and users need more effort to find operational sections quickly.
- Contact metadata is useful, but placing it in the main row gives secondary information the same prominence as core navigation.
- Wrapping and stacked pills make the header feel fragmented instead of like a compact application shell.
- Inconsistent mobile collapse behavior makes the public and staff experiences feel like separate systems.

## Recommended fixes

- Split the header into clear left / center / right zones with one compact app-shell row.
- Keep brand and identity on the left, move staff/public primary navigation into the center, and group search, language, contact, account, and sign-out utilities on the right.
- Move contact details into a compact utility menu and drawer instead of keeping them permanently expanded beside the logo.
- Replace loose pill groupings with normalized nav-item heights, restrained active states, and tighter spacing.
- Use a shared mobile drawer pattern for both public and staff views so the header stays compact on narrow screens.
