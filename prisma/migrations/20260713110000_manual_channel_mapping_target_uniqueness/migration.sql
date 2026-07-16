-- Prevent concurrent or out-of-band writes from assigning one active OTA
-- room/rate-plan target to two PMS room types on the same connection.
-- Service input normalizes blank rate-plan ids to NULL; COALESCE also protects
-- legacy/out-of-band rows by treating NULL and blank as the same target.
CREATE UNIQUE INDEX "ManualChannelRoomMapping_active_external_target_key"
ON "ManualChannelRoomMapping" (
  "connectionId",
  "externalRoomTypeId",
  (COALESCE("externalRatePlanId", ''))
)
WHERE "active" = TRUE;
