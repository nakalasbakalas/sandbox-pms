# Booking Inbox Parser Review V2

Status: open.

## Scope

Staff review of parser behavior without exposing raw mailbox content.

## Environment

- Commit SHA:
- Gmail OAuth status: ready / missing / not tested
- Test date/time:
- Reviewer:

## Provider sample review

| Provider/source | Event type | Parsed guest? | Parsed dates? | Parsed room type? | Parsed amount? | Correct proposed action? | Staff decision | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Booking.com | new booking |  |  |  |  |  | approve/reject |  |
| Booking.com | modification |  |  |  |  |  | approve/reject |  |
| Booking.com | cancellation |  |  |  |  |  | approve/reject |  |
| Agoda | new booking |  |  |  |  |  | approve/reject |  |
| Expedia | new booking |  |  |  |  |  | approve/reject |  |
| Airbnb | new booking |  |  |  |  |  | approve/reject |  |
| Direct email | guest message |  |  |  |  |  | approve/reject |  |
| Payment notice | payment |  |  |  |  |  | approve/reject |  |

## Safety checks

- [ ] Raw email body omitted from evidence.
- [ ] Guest names redacted or replaced with sample labels in evidence.
- [ ] Payment references redacted.
- [ ] Parser errors are recorded as summaries only.
- [ ] Auto-processing remains disabled unless owner/staff explicitly approve.

## Result

- [ ] Passed
- [ ] Failed
- [ ] Accepted risk with owner/date/expiry:
