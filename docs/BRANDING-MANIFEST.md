# Sandbox Hotel – Branding Asset Manifest

This document maps every branding asset in the repository to its purpose,
explains which file is live in each slot, and provides rollback notes.

---

## Asset directory

All branding images live under:

```
sandbox_pms_mvp/static/branding/
```

### Standard PNG files (full-bleed logo, minimal padding)

| File | Size | Use |
|------|------|-----|
| `sandbox-hotel-logo-1024.png` | 1024×1024 | High-res master for brochures, design work, or systems accepting large uploads |
| `sandbox-hotel-logo-512.png` | 512×512 | General-purpose website or PMS upload where cropping is not tight |
| `sandbox-hotel-logo-256.png` | 256×256 | Website header, login screen, dashboard, moderate UI logo |
| `sandbox-hotel-logo-192.png` | 192×192 | Web manifest icon, app-style branding |
| `sandbox-hotel-logo-180.png` | 180×180 | Apple touch icon, mobile bookmark |
| `sandbox-hotel-logo-152.png` | 152×152 | Smaller tablet/mobile app icon |
| `sandbox-hotel-logo-120.png` | 120×120 | Compact mobile icon, small admin panels |
| `sandbox-hotel-logo-96.png` | 96×96 | Small PMS tile or dashboard card |
| `sandbox-hotel-logo-64.png` | 64×64 | Compact UI icon, slightly larger favicon-style mark |
| `sandbox-hotel-logo-48.png` | 48×48 | Small icon slot, compact toolbar |
| `sandbox-hotel-logo-32.png` | 32×32 | Tiny icon, browser-style small icon |

### Safe-padded PNG files (extra breathing room – best when cropping risk exists)

| File | Size | Use |
|------|------|-----|
| `sandbox-hotel-logo-safe-1024.png` | 1024×1024 | Premium uploads where cropping risk exists |
| `sandbox-hotel-logo-safe-512.png` | 512×512 | **Best overall PMS default** – balanced size with safe framing |
| `sandbox-hotel-logo-safe-256.png` | 256×256 | **Live PMS header logo** – safe for dashboards and smaller system logos |
| `sandbox-hotel-logo-safe-192.png` | 192×192 | **Web manifest icon (192px)** – safer app/web icon |
| `sandbox-hotel-logo-safe-180.png` | 180×180 | **Live apple-touch-icon** – mobile shortcut/bookmark icon |
| `sandbox-hotel-logo-safe-152.png` | 152×152 | Safe small-tablet or mobile icon |
| `sandbox-hotel-logo-safe-120.png` | 120×120 | Safe compact icon for smaller UI |
| `sandbox-hotel-logo-safe-96.png` | 96×96 | Safe small PMS tile |
| `sandbox-hotel-logo-safe-64.png` | 64×64 | Safe tiny system logo for compact interfaces |
| `sandbox-hotel-logo-safe-48.png` | 48×48 | Safe small icon for tighter UI |
| `sandbox-hotel-logo-safe-32.png` | 32×32 | Safest very-small icon where edge clipping is likely |

### WebP files (lighter weight for modern websites)

Equivalent files with `.webp` extension are provided for every PNG above.
Use WebP only where the serving context supports it and file size matters.

### Other files

| File | Use |
|------|-----|
| `sandbox-hotel-favicon.ico` | **Live browser favicon** – multi-size ICO (16, 32, 48px) |

### Legacy assets (retained for rollback)

| File | Location | Notes |
|------|----------|-------|
| `favicon.svg` | `static/favicon.svg` | Previous SVG favicon – still served as primary `<link rel="icon" type="image/svg+xml">` |
| `hotel-share.svg` | `static/hotel-share.svg` | OG/social share image – still live as fallback share image |

---

## Live slot mapping

| Slot | File | Reason |
|------|------|--------|
| Browser favicon (SVG-capable) | `static/favicon.svg` | SVG preferred by modern browsers for crisp rendering |
| Browser favicon (legacy `/favicon.ico`) | `static/branding/sandbox-hotel-favicon.ico` | Multi-size ICO for older browsers |
| Apple touch icon | `static/branding/sandbox-hotel-logo-safe-180.png` | 180×180 safe-padded – prevents clipping on iOS home screen |
| Web manifest icon (192px) | `static/branding/sandbox-hotel-logo-safe-192.png` | PWA / Android home screen icon |
| Web manifest icon (512px) | `static/branding/sandbox-hotel-logo-safe-512.png` | PWA splash screen |
| PMS header logo (default) | `static/branding/sandbox-hotel-logo-safe-256.png` | Compact, safe for the 3rem max-height brand-logo slot |
| PMS single-upload fallback | `static/branding/sandbox-hotel-logo-safe-512.png` | Best balanced default if only one upload is allowed |
| High-res master | `static/branding/sandbox-hotel-logo-safe-1024.png` | For any context needing the highest quality version |
| Social share / OG image | `static/hotel-share.svg` | Existing OG share image (overridden when `hotel.logo_url` is set) |

---

## Admin configuration

The PMS header logo is controlled by the **`hotel.logo_url`** setting in
**Admin → Property Setup → Branding and hotel info**.

Default value: `/static/branding/sandbox-hotel-logo-safe-256.png`

To change the logo, update this setting to point to any URL or relative path.
The field accepts:
- Absolute URLs: `https://cdn.example.com/logo.png`
- Relative paths: `/static/branding/sandbox-hotel-logo-safe-512.png`

---

## Selection rules

1. **Use SAFE versions** for any slot that crops tightly, uses circles/squares,
   or risks edge clipping.
2. **Use STANDARD versions** only when the container clearly shows the full
   logo and larger size is beneficial.
3. **Prefer PNG** for PMS uploads.
4. **Use WebP** only if the website/theme supports it and file size matters.
5. **Never distort** aspect ratio.
6. **Never flatten** transparency onto a background.
7. **Never crop** the outer gold border.

---

## Rollback instructions

To revert to the previous branding state:

1. **Favicon**: Change `base.html` line referencing `favicon_ico_url` back to
   `<link rel="alternate icon" href="{{ favicon_url }}">` and revert the
   `/favicon.ico` route in `pms/app.py` to redirect to `favicon.svg`.
2. **Apple touch icon**: Remove the `<link rel="apple-touch-icon">` line from
   `base.html`.
3. **Web manifest**: Remove the `<link rel="manifest">` line from `base.html`
   and delete the `/manifest.json` route from `pms/app.py`.
4. **PMS header logo**: Set `hotel.logo_url` back to empty string `""` in
   Admin → Property Setup. The header will fall back to the text brand mark.
5. **Setting default**: Revert `settings.py` `hotel.logo_url` default from
   `/static/branding/sandbox-hotel-logo-safe-256.png` back to `""`.

The `static/branding/` directory can be safely removed without breaking
existing functionality – the system falls back to SVG favicon and text brand
mark when no logo assets are present.

---

## Change log

| Date | Change |
|------|--------|
| 2026-03-14 | Initial branding packet integrated: 45 PNG/WebP/ICO files added to `static/branding/`, favicon.ico route updated, apple-touch-icon added, web manifest added, default `hotel.logo_url` set to safe-256 PNG |
