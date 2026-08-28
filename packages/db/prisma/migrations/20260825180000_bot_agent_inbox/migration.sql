ALTER TABLE "bots" ADD COLUMN "inboxProvider" TEXT;
ALTER TABLE "bots" ADD COLUMN "inboxId" TEXT;
ALTER TABLE "bots" ADD COLUMN "inboxAddress" TEXT;

CREATE UNIQUE INDEX "bots_inboxId_key" ON "bots"("inboxId");
