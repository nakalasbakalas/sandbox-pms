CREATE TABLE "ReservationMutationAttempt" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "intentFingerprint" TEXT NOT NULL,
    "resultFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationMutationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReservationMutationAttempt_propertyId_idempotencyKey_key"
ON "ReservationMutationAttempt"("propertyId", "idempotencyKey");

CREATE INDEX "ReservationMutationAttempt_reservationId_createdAt_idx"
ON "ReservationMutationAttempt"("reservationId", "createdAt");

ALTER TABLE "ReservationMutationAttempt"
ADD CONSTRAINT "ReservationMutationAttempt_propertyId_fkey"
FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReservationMutationAttempt"
ADD CONSTRAINT "ReservationMutationAttempt_reservationId_fkey"
FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
