CREATE TABLE "site_logins" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "url" TEXT,
    "username" TEXT NOT NULL,
    "secretId" TEXT NOT NULL,
    "createdByBotId" TEXT,
    "share" TEXT NOT NULL DEFAULT 'workspace',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_logins_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "site_logins" ADD CONSTRAINT "site_logins_share_check" CHECK ("share" IN ('workspace', 'creator'));

CREATE UNIQUE INDEX "site_logins_workspaceId_userId_host_username_key" ON "site_logins"("workspaceId", "userId", "host", "username");

CREATE INDEX "site_logins_workspaceId_userId_host_idx" ON "site_logins"("workspaceId", "userId", "host");

ALTER TABLE "site_logins" ADD CONSTRAINT "site_logins_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "site_logins" ADD CONSTRAINT "site_logins_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "site_logins" ADD CONSTRAINT "site_logins_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "secrets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "site_logins" ADD CONSTRAINT "site_logins_createdByBotId_fkey" FOREIGN KEY ("createdByBotId") REFERENCES "bots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
