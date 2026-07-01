-- Durable Hotel Ops booking-intelligence scan snapshots.
CREATE TABLE "HotelOpsScanSnapshot" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "sourceChannel" "HotelOpsSourceChannel" NOT NULL DEFAULT 'system',
    "triggeredBy" TEXT,
    "force" TEXT,
    "windowStart" DATE NOT NULL,
    "windowEnd" DATE NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeReservations" INTEGER NOT NULL DEFAULT 0,
    "sellableRooms" INTEGER NOT NULL DEFAULT 0,
    "cancellationLogs" INTEGER NOT NULL DEFAULT 0,
    "alertsCreated" INTEGER NOT NULL DEFAULT 0,
    "alertsUpdated" INTEGER NOT NULL DEFAULT 0,
    "metrics" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HotelOpsScanSnapshot_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "HotelOpsTrendAlert" ADD COLUMN "scanSnapshotId" TEXT;

CREATE INDEX "HotelOpsScanSnapshot_propertyId_scannedAt_idx" ON "HotelOpsScanSnapshot"("propertyId", "scannedAt");
CREATE INDEX "HotelOpsScanSnapshot_sourceChannel_scannedAt_idx" ON "HotelOpsScanSnapshot"("sourceChannel", "scannedAt");
CREATE INDEX "HotelOpsTrendAlert_scanSnapshotId_idx" ON "HotelOpsTrendAlert"("scanSnapshotId");

ALTER TABLE "HotelOpsScanSnapshot" ADD CONSTRAINT "HotelOpsScanSnapshot_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HotelOpsTrendAlert" ADD CONSTRAINT "HotelOpsTrendAlert_scanSnapshotId_fkey" FOREIGN KEY ("scanSnapshotId") REFERENCES "HotelOpsScanSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
