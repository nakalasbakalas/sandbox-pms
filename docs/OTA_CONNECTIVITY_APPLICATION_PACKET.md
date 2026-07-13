# OTA Connectivity Application Packet

Last reviewed: 2026-07-13

## Decision

PMS Lite does not depend on direct OTA API approval. Until written approval,
sandbox credentials, certification, and live account-owner proof exist, inbound
email stays review-only and outbound inventory stays in the audited manual
Extranet queue.

For an individual hotel, Booking.com does not offer a direct property API
connection. Its official Connectivity program is for connectivity providers,
and its portal currently says onboarding of new providers is paused. Monitor
[Booking.com Connectivity](https://connect.booking.com/) and keep Booking.com
manual.

Agoda and Trip.com applications can be prepared, but their official onboarding
is aimed at PMS/channel-manager/connectivity software and requires business,
technical, privacy, and certification review. Submission is exploratory and is
not a launch dependency.

## Owner-Supplied Application Facts

Do not invent or infer any blank below. The account owner must approve the final
answers before submission.

- Legal company or proprietor name:
- Registered address and country:
- Company registration/tax number, if applicable:
- Authorized signatory name and title:
- Technical and commercial contact names, emails, and phone numbers:
- Public company/product website:
- PMS product name and description:
- Current connected-property count:
- Expected properties in the next 12 months:
- Revenue model and any hotel-facing integration charge:
- Sandbox Hotel Agoda property/hotel id:
- Sandbox Hotel Trip.com property/hotel id:
- Accommodation types supported:
- PCI DSS status and payment-card-data position:
- PII/privacy policy URL and data-retention position:
- Requested APIs/endpoints:
- Contracting entity and settlement details requested by the provider:

Credentials, passwords, tokens, mailbox secrets, and 2FA material must never be
placed in this document, an application evidence file, or a repository commit.

## Agoda Packet

Official starting points:

- [How to become an Agoda technology partner](https://developer.agoda.com/supply/docs/how-to-become-a-partner)
- [Agoda technology-partner questionnaire](https://forms.gle/F9DE4KcemYbHy2zS7)
- [Agoda certification](https://developer.agoda.com/supply/docs/certification)

Requested technical scope for the first review:

1. Reservation delivery, modification, and cancellation retrieval.
2. Property, room, rate-plan, and occupancy mapping.
3. Read-only availability/rate reconciliation in sandbox.
4. ARI writes only after idempotency, mapping, emergency-stop, audit, and owner
   approval are proven.

Official certification material describes mandatory endpoint testing and a
two-to-three live-property pilot. A one-property custom PMS may apply, but
approval is uncertain; this is an inference from the portfolio-oriented form
and pilot, not a stated prohibition.

## Trip.com Packet

Official starting points:

- [Trip.com Connectivity Hub](https://connect.trip.com/opendoc/3024822.html)
- [Trip.com Connectivity registration](https://connect.trip.com/register)
- [Trip.com property eBooking route](https://us.trip.com/list-your-property/faq.html)

Requested technical scope follows the same read-only-first sequence as Agoda:
reservation confirmation/modification/cancellation intake, mapping, sandbox
reconciliation, then separately approved ARI writes.

Trip.com publishes a reviewed connectivity route for PMS/channel-manager/CRS
software. No official minimum property count was found, so a one-property
application can be attempted but must not be represented as accepted or likely
until Trip.com responds in writing.

## Submission And Evidence Gate

Before submitting either application:

1. The owner fills and approves every applicable fact above.
2. Engineering supplies a public product description, architecture/data-flow
   summary, security controls, API scope, and support contact.
3. The owner confirms the legal entity, signatory, privacy, PCI, and commercial
   answers.
4. Submission evidence records only the provider, date, redacted application
   id, and status. It never records credentials or guest/payment data.
5. Repository status remains `application prepared` or `submitted, pending`.
   Only provider correspondence can change it to approved.

## Future Certified Rail

The disabled Channex adapter remains the preferred provider-neutral boundary if
the hotel later accepts a channel-only subscription. Channex currently publishes
a USD 130 monthly platform fee plus USD 7 per active hotel, before applicable
taxes: [Channex pricing](https://channex.io/pricing). PMS Lite does not claim an
account, contract, certification, mapping, secret path, or live delivery.
