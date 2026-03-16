# Navbar refactor plan

## New structure

1. **Left zone**
   - Sandbox Hotel brand mark / logo
   - Hotel name
   - Compact divider for desktop structure

2. **Center zone**
   - Public pages: search, cancel, modify
   - Staff/provider pages: Staff, Provider, Front Desk, Reservations, Housekeeping, Calendars, Admin, Reports
   - Subtle active state using restrained background and border treatment

3. **Right zone**
   - Compact staff/provider search form when a relevant workspace exists
   - Contact menu
   - Language menu
   - Account menu
   - Sign-out action for authenticated staff
   - Mobile top-priority action plus hamburger trigger

## Grouping logic

- Keep business-critical operational destinations in the center nav.
- Move lower-priority metadata and secondary actions into menus or the drawer.
- Keep security and review-queue access available, but reduce their visual competition with core work areas.
- Preserve all existing routes, auth/logout behavior, analytics attributes, and language switching URLs.

## Responsive behavior

- **Desktop:** one main row with full primary nav and compact utilities.
- **Tablet:** shrink search width, hide contact first, keep main nav scrollable until mobile collapse.
- **Mobile:** hide the center nav and secondary menus, keep brand + top-priority action + hamburger, and surface the rest in a right-side drawer.
