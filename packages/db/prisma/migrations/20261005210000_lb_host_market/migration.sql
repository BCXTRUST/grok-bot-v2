-- Market tag on a discovered host, and the last discovery pass on a project.
-- Locale and time zone default to empty so rows from M0 stay valid; discovery fills them.
ALTER TABLE "lb_hosts" ADD COLUMN "locale" TEXT NOT NULL DEFAULT '';
ALTER TABLE "lb_hosts" ADD COLUMN "timezoneId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "lb_projects" ADD COLUMN "lastDiscoveredAt" TIMESTAMP(3);
