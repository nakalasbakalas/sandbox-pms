# Phase 8 SEO / i18n Report

**Date:** 2026-03-24
**Scope:** Technical SEO, structured data, hreflang hygiene, robots/sitemap, and multilingual copy quality.

---

## 1. Metadata Fixes

### A. Per-page `meta_description` block (base.html)
**Problem:** Every public page emitted the same generic description: `{hotel_name} {meta_description}`. Pages like the home booking form and availability page shared identical title and meta copy, providing no per-URL intent signal for SERP snippets.

**Fix:**
- Added `{% block meta_description %}` to `base.html` so child templates can override it.
- `og:description` and `twitter:description` now reference the same block via `{{ self.meta_description() }}` — a single source of truth per page.

### B. Home page title (index.html)
**Problem:** The homepage title was just `{{ hotel_name }}` — no intent or descriptor.

**Fix:** Title is now `{hotel name} — {home_direct_booking_title}` (e.g., "Sandbox Hotel — จองตรงกับโรงแรม" / "Sandbox Hotel — Direct booking"). The `og:title` and `twitter:title` blocks are overridden to match.

### C. Per-page meta descriptions (index.html, availability.html)
- **Home:** Now uses `page_meta_home` — a richer, direct-booking-specific description in all three languages.
- **Availability:** Now uses `page_meta_availability` — a focused live-inventory description.

---

## 2. Schema / Structured Data Updates

**File:** `sandbox_pms_mvp/pms/app.py` (inject_globals)

| Field | Before | After |
|---|---|---|
| `@id` | missing | set to `site_base_url` (canonical Hotel entity identifier) |
| `availableLanguage` | `["th", "en", "zh-Hans"]` (BCP-47 codes) | `["Thai", "English", "Chinese"]` (Schema.org-compliant language names) |
| `telephone` / `email` | always included, even when empty | guarded with `if` — only emitted when the value is non-empty |
| `checkinTime` / `checkoutTime` | always included | guarded with `if` — only emitted when the value is non-empty |
| `address` | `PostalAddress` with `streetAddress` only | unchanged (streetAddress from hotel setting); locality and country can be added once those fields are added to branding settings |

---

## 3. hreflang / Multilingual Fixes

**Status:** The hreflang implementation was already correct before this phase:
- `th`, `en`, `zh-Hans` alternate links rendered per page.
- `x-default` pointing to the base site URL.
- Staff and private guest pages suppress all social metadata (and therefore all hreflang links).

No structural changes were needed. The `zh-Hans` BCP-47 tag is valid and supported by Google Search.

---

## 4. Sitemap Improvements

**File:** `sandbox_pms_mvp/pms/routes/public.py`

**Before:** Plain `<url><loc>…</loc></url>` entries for each page × each language variant — no alternates, no priority, no changefreq.

**After:**
- `xmlns:xhtml` namespace added to `<urlset>`.
- Every URL entry now includes `<xhtml:link rel="alternate">` tags for all language variants plus `x-default`.
- `<changefreq>` and `<priority>` added per page type:
  - `/` (home): priority 1.0, daily
  - `/book` (booking entry): priority 0.9, daily
  - `/booking/cancel`: priority 0.5, monthly
  - `/booking/modify`: priority 0.5, monthly
- Duplicate suppression via a `seen_urls` set — ensures each URL appears once.

---

## 5. robots.txt Improvements

**Files:** `sandbox_pms_mvp/pms/routes/public.py` (dynamic route) and `sandbox_pms_mvp/static/robots.txt`

**Before:**
```
Disallow: /staff/
Disallow: /booking/hold
```

**After:**
```
Disallow: /staff/
Disallow: /booking/hold
Disallow: /booking/confirmation/
Disallow: /booking/checkout/
Disallow: /payments/
Disallow: /pre-checkin/
Disallow: /survey/
```

**Rationale:** Private guest-journey pages (confirmation tokens, payment links, pre-check-in, satisfaction surveys) should not be crawled. They contain no indexable value and may waste crawl budget.

---

## 6. Local SEO / Entity Signals

No changes required. Hotel NAP (name, address, phone) are dynamically sourced from branding settings and correctly embedded in:
- Structured data (`Hotel` schema)
- Page footer (`<p class="footer-meta">`)
- Contact links in header and footer

To strengthen local SEO further, add `addressLocality`, `addressRegion`, and `addressCountry` to the branding settings form and propagate them into the `PostalAddress` structured data block.

---

## 7. Image SEO

Existing image alt text was already adequate:
- Hotel logo: `alt="{{ hotel_name }} logo"`
- Room images: `alt="{{ item.room_type.name }}"`

No changes were required. Room images served via `primary_media_url` should use descriptive filenames when uploading (e.g., `sandbox-hotel-deluxe-room.jpg` rather than generic CMS IDs).

---

## 8. i18n / Localization Improvements

### New strings added (`sandbox_pms_mvp/pms/i18n.py`)

| Key | Thai | English | Chinese |
|---|---|---|---|
| `page_meta_home` | จองห้องพักโดยตรงกับโรงแรม ดูห้องว่างแบบเรียลไทม์ ยืนยันทันที พร้อมบริการจัดการการจองด้วยตนเอง | Book direct with live room availability, instant confirmation, and self-service booking management. | 官网直订，实时查询房态，即时确认，轻松自助管理预订。 |
| `page_meta_availability` | ดูห้องว่างและราคาแบบเรียลไทม์ เลือกห้องที่ใช่และจองตรงกับโรงแรม | Check live room availability and rates. Choose your room and book direct. | 查看实时可订房型与价格，直接预订，快速确认。 |

### Chinese copy notes
- `home_direct_booking_title`: "官网直订" — concise, natural, industry-standard phrasing. ✓
- `search_title`: "查询可订房型" — clear and functional. ✓
- `page_meta_home`: "官网直订，实时查询房态，即时确认，轻松自助管理预订。" — improved from the generic `meta_description`; more specific and conversion-oriented.
- `page_meta_availability`: "查看实时可订房型与价格，直接预订，快速确认。" — concise, intent-matched.

No machine-translation artifacts were found in existing strings. Thai and English copy remain the primary truth sources.

---

## 9. Files Changed

| File | Change |
|---|---|
| `sandbox_pms_mvp/pms/i18n.py` | Added `page_meta_home`, `page_meta_availability` for th/en/zh-Hans |
| `sandbox_pms_mvp/templates/base.html` | Added `{% block meta_description %}` block; og/twitter description now reference the block |
| `sandbox_pms_mvp/templates/index.html` | Richer title, og_title, twitter_title, meta_description overrides |
| `sandbox_pms_mvp/templates/availability.html` | Added `meta_description` block override |
| `sandbox_pms_mvp/pms/app.py` | Structured data: added `@id`, fixed `availableLanguage` to language names, made telephone/email/checkinTime/checkoutTime conditional |
| `sandbox_pms_mvp/pms/routes/public.py` | robots.txt: added 5 new Disallow paths; sitemap: added xhtml alternates, changefreq, priority |
| `sandbox_pms_mvp/static/robots.txt` | Kept in sync with dynamic robots.txt route |

---

## 10. Key Ranking and CTR Improvements Expected

1. **SERP snippet quality:** Per-page meta descriptions mean each page in search results shows intent-specific copy rather than a generic brand tagline. The home page now reads "Book direct with live room availability…" vs just the hotel name.

2. **Crawl efficiency:** The expanded `robots.txt` disallows prevent search engines from wasting crawl budget on private token-based pages (payment, confirmation, survey), improving crawl efficiency.

3. **Rich result eligibility:** The corrected `Hotel` schema (with `@id`, valid `availableLanguage` values, and conditional fields) is more likely to pass Google's Rich Results Test and contribute to knowledge panel entity disambiguation.

4. **Multilingual SERP presence:** The sitemap xhtml alternates now signal per-URL language variations directly to search engines — supplementing the in-page hreflang tags and improving indexing of Thai, English, and Chinese variants independently.

5. **Local search relevance:** The structured `PostalAddress` block in the Hotel schema reinforces entity-location signals for hotel local search packs.

---

## 11. What Phase 9 Should Verify

1. **Google Search Console coverage:** Confirm all sitemap URLs are indexed without errors. Look for `hreflang` errors in the International Targeting report.
2. **Rich Results Test:** Run the homepage against https://search.google.com/test/rich-results to validate the Hotel schema.
3. **Page titles and descriptions in SERPs:** Check that search engines are rendering the new per-page titles and descriptions (can take 1–4 weeks to re-crawl).
4. **Address structured data completeness:** Once `addressLocality`, `addressRegion`, and `addressCountry` are available as branding settings fields, add them to the `PostalAddress` block.
5. **Image filenames:** Review uploaded room images for descriptive filenames — rename where needed.
6. **Core Web Vitals:** Verify LCP, CLS, and INP scores on Google Search Console for the public booking pages.
