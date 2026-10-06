-- M7 operations: re-verification count, webhook endpoint, cost ledger, alerts, inbound mail.

ALTER TABLE "lb_projects" ADD COLUMN "webhookUrl" TEXT;
ALTER TABLE "lb_projects" ADD COLUMN "webhookSecretId" TEXT;
ALTER TABLE "lb_projects" ADD COLUMN "lastCaptchaBalance" INTEGER;
ALTER TABLE "lb_projects" ALTER COLUMN "operator" SET DEFAULT '{"parkedHostTtlHours":48,"ticketTtlHours":24,"onExpire":"skip","channels":["push","email"]}';

ALTER TABLE "lb_placements" ADD COLUMN "verifyCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "lb_alerts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lb_alerts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lb_webhook_deliveries" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "statusCode" INTEGER,
    "nextAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lb_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lb_cost_entries" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT,
    "kind" TEXT NOT NULL,
    "lane" TEXT,
    "quantity" INTEGER NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lb_cost_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lb_inbound_mail" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "inboxId" TEXT NOT NULL,
    "eventId" TEXT,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "textBody" TEXT NOT NULL,
    "htmlBody" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lb_inbound_mail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lb_alerts_projectId_dedupeKey_key" ON "lb_alerts"("projectId", "dedupeKey");
CREATE INDEX "lb_alerts_workspaceId_projectId_createdAt_idx" ON "lb_alerts"("workspaceId", "projectId", "createdAt");
CREATE INDEX "lb_webhook_deliveries_projectId_createdAt_idx" ON "lb_webhook_deliveries"("projectId", "createdAt");
CREATE INDEX "lb_webhook_deliveries_status_nextAttemptAt_idx" ON "lb_webhook_deliveries"("status", "nextAttemptAt");
CREATE UNIQUE INDEX "lb_cost_entries_sourceKey_key" ON "lb_cost_entries"("sourceKey");
CREATE INDEX "lb_cost_entries_workspaceId_projectId_occurredAt_idx" ON "lb_cost_entries"("workspaceId", "projectId", "occurredAt");
CREATE UNIQUE INDEX "lb_inbound_mail_projectId_eventId_key" ON "lb_inbound_mail"("projectId", "eventId");
CREATE INDEX "lb_inbound_mail_inboxId_receivedAt_idx" ON "lb_inbound_mail"("inboxId", "receivedAt");
CREATE INDEX "lb_projects_webhookSecretId_idx" ON "lb_projects"("webhookSecretId");

ALTER TABLE "lb_projects" ADD CONSTRAINT "lb_projects_webhookSecretId_fkey" FOREIGN KEY ("webhookSecretId") REFERENCES "secrets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lb_alerts" ADD CONSTRAINT "lb_alerts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lb_alerts" ADD CONSTRAINT "lb_alerts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "lb_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lb_webhook_deliveries" ADD CONSTRAINT "lb_webhook_deliveries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lb_webhook_deliveries" ADD CONSTRAINT "lb_webhook_deliveries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "lb_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lb_webhook_deliveries" ADD CONSTRAINT "lb_webhook_deliveries_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "lb_alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lb_cost_entries" ADD CONSTRAINT "lb_cost_entries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lb_cost_entries" ADD CONSTRAINT "lb_cost_entries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "lb_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lb_inbound_mail" ADD CONSTRAINT "lb_inbound_mail_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lb_inbound_mail" ADD CONSTRAINT "lb_inbound_mail_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "lb_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_alerts" ADD CONSTRAINT "lb_alerts_kind_check" CHECK ("kind" IN ('project.paused', 'captcha.needs_operator', 'placement.live', 'run.finished'));
ALTER TABLE "lb_webhook_deliveries" ADD CONSTRAINT "lb_webhook_deliveries_status_check" CHECK ("status" IN ('pending', 'delivered', 'failed'));
ALTER TABLE "lb_cost_entries" ADD CONSTRAINT "lb_cost_entries_kind_check" CHECK ("kind" IN ('captell_credits', 'model_tokens', 'search_query', 'proxy_lease_day'));
