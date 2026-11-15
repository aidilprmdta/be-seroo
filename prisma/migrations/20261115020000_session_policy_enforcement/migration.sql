ALTER TABLE "AuthSession"
ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "AuthSession_userId_revokedAt_lastSeenAt_idx"
ON "AuthSession"("userId", "revokedAt", "lastSeenAt");
