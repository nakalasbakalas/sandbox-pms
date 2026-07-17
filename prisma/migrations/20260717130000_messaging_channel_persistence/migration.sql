ALTER TABLE "ChannelMapping"
  ADD COLUMN "externalRoomTypeName" TEXT,
  ADD COLUMN "roomIds" TEXT[];

UPDATE "ChannelMapping" mapping
SET
  "externalRoomTypeName" = mapping."externalRoomTypeId",
  "roomIds" = COALESCE((
    SELECT ARRAY_AGG(room."id" ORDER BY room."number")
    FROM "Room" room
    JOIN "Channel" channel ON channel."id" = mapping."channelId"
    WHERE room."propertyId" = channel."propertyId"
      AND room."roomTypeId" = mapping."roomTypeId"
  ), ARRAY[]::TEXT[]);

ALTER TABLE "ChannelMapping"
  ALTER COLUMN "externalRoomTypeName" SET NOT NULL,
  ALTER COLUMN "roomIds" SET NOT NULL;

ALTER TABLE "Message"
  ADD COLUMN "type" TEXT NOT NULL DEFAULT 'CUSTOM',
  ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Message_propertyId_idempotencyKey_key"
  ON "Message"("propertyId", "idempotencyKey");

ALTER TABLE "MessageTemplate"
  ADD COLUMN "type" TEXT NOT NULL DEFAULT 'CUSTOM';
