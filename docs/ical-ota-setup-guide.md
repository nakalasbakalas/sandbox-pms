# iCal And OTA Channel Manager Setup Guide

This guide is for connecting Sandbox Hotel PMS to OTAs or a channel manager when direct OTA APIs are not available.

## What iCal Does

iCal calendar feeds sync date blocks only:

- OTA to PMS: imports booking date blocks so staff can review and create PMS reservations.
- PMS to OTA or channel manager: exports PMS blocked dates so OTAs do not sell already-booked inventory.

iCal does not sync rates, restrictions, payments, deposits, full guest details, messages, or cancellation rules. Keep those in the OTA or channel manager unless a separate API integration exists.

## Recommended Setup

Use a channel manager as the central hub when possible:

1. OTA exports booking calendar to the channel manager.
2. Channel manager exports one iCal feed to Sandbox PMS.
3. Sandbox PMS publishes one hosted iCal export feed back to the channel manager.
4. Channel manager pushes blocked dates to Booking.com, Agoda, Expedia, Airbnb, or other connected OTAs.

If you do not use a channel manager, connect each OTA directly with its own iCal import/export pair.

Do not connect the same OTA both directly and through the channel manager at the same time. That can create duplicate pending imports.

## Requirements

For local preview:

- Pasted `.ics` imports work.
- Downloaded `.ics` exports work.
- Hosted subscription URLs are disabled because the local browser store is not a public server.

For production/server mode:

- `VITE_PMS_API_MODE=server`
- `DATABASE_URL`
- Deployed HTTPS PMS URL
- Logged-in admin or manager account with channel permissions

The hosted PMS feed URL has this shape:

```text
https://your-pms-domain.example/ical/<private-token>.ics
```

Treat this URL as a secret. Anyone with the URL can read blocked dates.

## PMS Setup

1. Open `Channel Manager`.
2. Open `Room Mapping`.
3. Choose the OTA or channel manager channel.
4. Add each OTA room/listing:
   - `OTA Room Name`
   - `OTA Room ID`
   - optional `OTA Rate Plan ID`
   - matching PMS room type
   - exact PMS rooms that listing is allowed to sell
5. Save mappings until the channel shows ready.
6. Open `Channels`.
7. Click `Set Up iCal` or `Setup` on the channel card.
8. Paste the OTA or channel manager export calendar URL into `OTA Import iCal URL`.
9. If the feed cannot be fetched by the browser, paste the `.ics` file contents into `One-Time iCal Import`.
10. Click `Save iCal Setup`.

In server mode, saving setup also publishes the hosted PMS export feed. If not, click `Publish URL` on the channel card.

## OTA Or Channel Manager Setup

In the OTA or channel manager admin panel:

1. Find the calendar sync, iCal, availability calendar, or external calendar section.
2. Copy the OTA/channel-manager export calendar URL.
3. Paste that URL into Sandbox PMS as `OTA Import iCal URL`.
4. In Sandbox PMS, click `Publish URL`.
5. Copy the hosted PMS iCal URL from `Hosted export feed`.
6. Paste the PMS URL into the OTA/channel manager as an import calendar or external availability calendar.
7. Save and run the OTA/channel-manager sync if the platform has a manual sync action.

Different OTAs use different labels for the same concept. Look for wording like `Export calendar`, `Import calendar`, `Sync calendars`, `iCal URL`, or `External calendar`.

## Daily Operation

1. In `Channel Manager`, click `Import iCal` on each channel or `Import All iCal`.
2. Open `Pending Reservations`.
3. Review each imported event.
4. Click `Import to PMS`.
5. Assign the reservation to a room.
6. Confirm guest name, contact details, payment, deposit, and special requests manually.

Imported iCal reservations are intentionally marked for manual confirmation because OTA feeds may not include guest or payment details.

## Export Options

Use `Publish URL` for production/server mode. This is the best option for OTAs and channel managers that subscribe to a URL.

Use `Export .ics` for local preview or for systems that require a file upload instead of a URL.

Use `Rotate` if a hosted feed URL was exposed or needs to be replaced. Rotating creates a new private token and the old URL should be removed from OTAs/channel managers.

Use `Disconnect` to disable a channel's hosted feed and local iCal setup.

## Troubleshooting

If `Publish URL` is disabled:

- You are running local/browser-only mode.
- Deploy the PMS in server mode, then publish the feed.

If `Import iCal` fails:

- The OTA may block browser fetches.
- Download the `.ics` file from the OTA and paste its contents into `One-Time iCal Import`.
- Confirm the URL is a private iCal feed URL, not the public booking page.

If bookings are duplicated:

- Check whether the OTA is connected directly and through a channel manager.
- Keep only one import path per OTA listing.
- Use the pending import review before importing to PMS.

If availability does not update in the OTA:

- Confirm the hosted PMS URL is pasted into the OTA import calendar field.
- Confirm the channel is still connected in Sandbox PMS.
- Confirm room mappings match the OTA listing.
- Wait for the OTA/channel manager sync interval; iCal is not real-time.

If rates do not update:

- This is expected. iCal does not sync rates.
- Maintain rates and restrictions in the OTA or channel manager.
