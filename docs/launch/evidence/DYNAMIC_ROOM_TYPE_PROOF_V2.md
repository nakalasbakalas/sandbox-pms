# Dynamic Room Type Proof V2

Status: open.

## Environment

- Commit SHA:
- Test date/time:
- Tester:
- Data source: local/staging/production-safe

## Fixture

| Room type id | Code | Name | Rooms | Expected UI section |
| --- | --- | --- | --- | --- |
| twin | TWIN | Standard Twin |  | Standard Twin |
| double | DOUBLE | Superior Double |  | Superior Double |
| family_suite | FAMILY_SUITE | Family Suite |  | Family Suite |

## Checks

- [ ] `/rooms` renders one section per configured room type.
- [ ] A non-Twin/non-Double room type does not appear under Twin.
- [ ] A non-Twin/non-Double room type does not appear under Double.
- [ ] Room tile displays source room type name.
- [ ] API mapped room card includes `roomTypeId`.
- [ ] API mapped room card includes `roomTypeCode`.
- [ ] API mapped room card includes `roomTypeName`.
- [ ] New Reservation can select the third room type after applying the companion reservation dialog patch.

## Commands

```bash
npm run remediation:check
npm run typecheck
npm run lint
npm test
```

## Result

- [ ] Passed
- [ ] Failed
- [ ] Accepted risk with owner/date/expiry:
