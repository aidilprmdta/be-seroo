CREATE TYPE "UserPasswordActivity" AS ENUM ('ADMIN_RESET', 'SELF_CHANGE');

ALTER TABLE "User"
ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "UserPasswordAudit" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "activity" "UserPasswordActivity" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPasswordAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserPasswordAudit_actorUserId_createdAt_idx"
ON "UserPasswordAudit"("actorUserId", "createdAt");
CREATE INDEX "UserPasswordAudit_targetUserId_createdAt_idx"
ON "UserPasswordAudit"("targetUserId", "createdAt");

ALTER TABLE "UserPasswordAudit"
ADD CONSTRAINT "UserPasswordAudit_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserPasswordAudit"
ADD CONSTRAINT "UserPasswordAudit_targetUserId_fkey"
FOREIGN KEY ("targetUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
