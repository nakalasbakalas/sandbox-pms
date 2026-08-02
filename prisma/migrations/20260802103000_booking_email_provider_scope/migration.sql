-- Include legitimate OTA messages delivered by BCC or forwarding while retaining
-- the bounded, approved-provider Gmail scope. Preserve explicitly customized queries.
UPDATE "BookingEmailSource"
SET
  "query" = '(from:booking.com OR from:guest.booking.com OR from:agoda.com OR from:trip.com OR from:expedia.com OR from:priceline.com OR from:airbnb.com) -in:spam -in:trash -from:ebk.promo.hotelpartner@trip.com -from:growth-product@agoda.com -subject:"new sign-in to your account" -subject:"account security update" -subject:"weekly performance report" -subject:"performance report" -subject:"partner hub" -subject:"boost campaigns" -"two-factor authentication" -"phishing" -"market manager" newer_than:30d',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "provider" = 'GMAIL'
  AND (
    "query" IS NULL
    OR "query" = ('to:' || lower("mailbox") || ' -in:spam -in:trash newer_than:30d')
  );
