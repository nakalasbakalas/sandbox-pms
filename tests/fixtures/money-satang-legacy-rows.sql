CREATE TABLE "Property" (
  "id" TEXT PRIMARY KEY,
  "taxRate" DOUBLE PRECISION,
  "extraGuestFee" DOUBLE PRECISION,
  "childFee" DOUBLE PRECISION,
  "inventoryMinimumRate" DOUBLE PRECISION
);

CREATE TABLE "RoomType" (
  "id" TEXT PRIMARY KEY,
  "baseRate" DOUBLE PRECISION
);

CREATE TABLE "Reservation" (
  "id" TEXT PRIMARY KEY,
  "ratePerNight" DOUBLE PRECISION,
  "totalAmount" DOUBLE PRECISION,
  "depositAmount" DOUBLE PRECISION
);

CREATE TABLE "RoomDateInventory" (
  "id" TEXT PRIMARY KEY,
  "rate" DOUBLE PRECISION
);

CREATE TABLE "RateCalendar" (
  "id" TEXT PRIMARY KEY,
  "rate" DOUBLE PRECISION
);

CREATE TABLE "Folio" (
  "id" TEXT PRIMARY KEY,
  "subtotal" DOUBLE PRECISION,
  "tax" DOUBLE PRECISION,
  "total" DOUBLE PRECISION,
  "paid" DOUBLE PRECISION,
  "balance" DOUBLE PRECISION
);

CREATE TABLE "Charge" (
  "id" TEXT PRIMARY KEY,
  "amount" DOUBLE PRECISION,
  "total" DOUBLE PRECISION
);

CREATE TABLE "Payment" (
  "id" TEXT PRIMARY KEY,
  "amount" DOUBLE PRECISION
);

CREATE TABLE "BookingEmailEvent" (
  "id" TEXT PRIMARY KEY,
  "amount" DOUBLE PRECISION
);

CREATE TABLE "ManualChannelConnection" (
  "providerCode" TEXT NOT NULL,
  CONSTRAINT "ManualChannelConnection_providerCode_check"
    CHECK ("providerCode" IN ('booking_com', 'agoda', 'trip_com'))
);

CREATE TABLE "ManualChannelTask" (
  "sourceProviderCode" TEXT,
  CONSTRAINT "ManualChannelTask_sourceProviderCode_check"
    CHECK ("sourceProviderCode" IS NULL OR "sourceProviderCode" IN ('booking_com', 'agoda', 'trip_com'))
);

INSERT INTO "Property" VALUES
  ('valid', 7.50, 123.45, 67.89, 999.99),
  ('invalid', 101.00, -1.00, -2.00, -3.00);

INSERT INTO "RoomType" VALUES
  ('valid', 1500.55),
  ('invalid', -1.00);

INSERT INTO "Reservation" VALUES
  ('valid', 1000.01, 2000.02, 600.01),
  ('invalid', -1.00, -2.00, -3.00);

INSERT INTO "RoomDateInventory" VALUES
  ('valid', 1234.56),
  ('invalid', -0.01);

INSERT INTO "RateCalendar" VALUES
  ('valid', 2345.67),
  ('invalid', -0.01);

INSERT INTO "Folio" VALUES
  ('valid', 100.01, 7.01, 107.02, 50.00, 57.02),
  ('invalid', -1.00, -1.00, -1.00, -1.00, -1.23);

INSERT INTO "Charge" VALUES
  ('valid', 12.34, 24.68),
  ('invalid', -1.00, -2.00);

INSERT INTO "Payment" VALUES
  ('valid', 50.01),
  ('invalid', -1.00);

INSERT INTO "BookingEmailEvent" VALUES
  ('valid', -12.34);
