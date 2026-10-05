import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LbCaptchaDoorSchema,
  LbCaptchaOutcomeSchema,
  LbCaptchaTypeSchema,
  LbContentSchema,
  LbDisclosureModeSchema,
  LbDraftStatusSchema,
  LbGeoPolicySchema,
  LbHostPlatformSchema,
  LbHostStatusSchema,
  LbHrefForNewMembersSchema,
  LbHumanCheckboxStateSchema,
  LbLinkRatioSchema,
  LbLinkSlotSchema,
  LbModelLaneSchema,
  LbOperatorSettingsSchema,
  LbOperatorTicketReasonSchema,
  LbOperatorTicketStatusSchema,
  LbParkableHostStatusSchema,
  LbPlacementStatusSchema,
  LbProjectStatusSchema,
  LbProxyKindSchema,
  LbProxyLeaseStatusSchema,
  LbProxyPolicySchema,
  LbRelDefaultSchema,
  LbRunStatusSchema,
  LbRunStepCostsSchema,
  LbScheduleSchema,
  LbSpamRetrySchema,
  LbThreadStatusSchema,
  LbVerifyMethodSchema,
  LbWarmupSchema,
} from "@rakazo/contracts";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  path.resolve(here, "../prisma/migrations/20261005120000_link_builder/migration.sql"),
  "utf8",
);
const schema = readFileSync(path.resolve(here, "../prisma/schema.prisma"), "utf8");

function checkValues(table: string, column: string): string[] {
  const pattern = new RegExp(
    `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_${column}_check" CHECK \\("${column}" IN \\(([^)]*)\\)\\);`,
  );
  const match = migration.match(pattern);
  if (!match?.[1]) throw new Error(`No CHECK for ${table}.${column}`);
  return match[1].split(",").map((value) => value.trim().replace(/^'|'$/g, ""));
}

function columnDefault(table: string, column: string): unknown {
  const tableSql = migration.match(
    new RegExp(`CREATE TABLE "${table}" \\(([\\s\\S]*?)\\n\\);`),
  )?.[1];
  const line = tableSql?.split("\n").find((entry) => entry.trim().startsWith(`"${column}" `));
  const literal = line?.match(/DEFAULT '(.*)',?$/)?.[1];
  if (literal === undefined) throw new Error(`No default for ${table}.${column}`);
  return JSON.parse(literal.replace(/''/g, "'"));
}

const enumChecks: Array<[string, string, { options: readonly string[] }]> = [
  ["lb_projects", "status", LbProjectStatusSchema],
  ["lb_projects", "geoPolicy", LbGeoPolicySchema],
  ["lb_projects", "disclosureMode", LbDisclosureModeSchema],
  ["lb_projects", "proxyPolicy", LbProxyPolicySchema],
  ["lb_proxy_leases", "kind", LbProxyKindSchema],
  ["lb_proxy_leases", "status", LbProxyLeaseStatusSchema],
  ["lb_hosts", "platform", LbHostPlatformSchema],
  ["lb_hosts", "hrefForNewMembers", LbHrefForNewMembersSchema],
  ["lb_hosts", "relDefault", LbRelDefaultSchema],
  ["lb_hosts", "status", LbHostStatusSchema],
  ["lb_hosts", "captchaType", LbCaptchaTypeSchema],
  ["lb_thread_candidates", "status", LbThreadStatusSchema],
  ["lb_drafts", "modelLane", LbModelLaneSchema],
  ["lb_drafts", "linkSlot", LbLinkSlotSchema],
  ["lb_drafts", "status", LbDraftStatusSchema],
  ["lb_placements", "status", LbPlacementStatusSchema],
  ["lb_placements", "verifyMethod", LbVerifyMethodSchema],
  ["lb_runs", "status", LbRunStatusSchema],
  ["lb_captcha_events", "type", LbCaptchaTypeSchema],
  ["lb_captcha_events", "door", LbCaptchaDoorSchema],
  ["lb_captcha_events", "humanCheckboxState", LbHumanCheckboxStateSchema],
  ["lb_captcha_events", "outcome", LbCaptchaOutcomeSchema],
  ["lb_operator_tickets", "reason", LbOperatorTicketReasonSchema],
  ["lb_operator_tickets", "status", LbOperatorTicketStatusSchema],
];

describe("link builder migration", () => {
  it.each(enumChecks)("CHECK on %s.%s matches the shared contract", (table, column, values) => {
    expect(checkValues(table, column)).toEqual(values.options);
  });

  it("allows parkedFrom only for parkable statuses while parked", () => {
    const parked = migration.match(/"parkedFrom" IN \(([^)]*)\)/)?.[1];
    expect(parked?.split(",").map((value) => value.trim().replace(/'/g, ""))).toEqual(
      LbParkableHostStatusSchema.options,
    );
  });

  it("keeps JSON column defaults valid for their contract schemas", () => {
    expect(LbScheduleSchema.parse(columnDefault("lb_projects", "schedule"))).toBeTruthy();
    expect(LbLinkRatioSchema.parse(columnDefault("lb_projects", "linkRatio"))).toEqual({
      links: 1,
      posts: 3,
    });
    expect(LbWarmupSchema.parse(columnDefault("lb_projects", "warmup"))).toEqual(
      LbWarmupSchema.parse({}),
    );
    expect(LbSpamRetrySchema.parse(columnDefault("lb_projects", "spamRetry"))).toEqual(
      LbSpamRetrySchema.parse({}),
    );
    expect(LbContentSchema.parse(columnDefault("lb_projects", "content"))).toEqual(
      LbContentSchema.parse({}),
    );
    expect(LbOperatorSettingsSchema.parse(columnDefault("lb_projects", "operator"))).toEqual(
      LbOperatorSettingsSchema.parse({}),
    );
    expect(LbRunStepCostsSchema.parse(columnDefault("lb_run_steps", "costs"))).toEqual(
      LbRunStepCostsSchema.parse({}),
    );
  });

  it("enforces one counted placement per host with a partial unique index", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "lb_placements_one_counted_per_host" ON "lb_placements"("workspaceId", "projectId", "hostId") WHERE "counted" = true;',
    );
    expect(schema).toContain("lb_placements_one_counted_per_host");
  });

  it("maps every link builder model to an lb_ table owned by an organization", () => {
    const models = [...schema.matchAll(/^model (Lb\w+) \{([\s\S]*?)^\}/gm)];
    expect(models.map((model) => model[1])).toEqual([
      "LbProject",
      "LbProxyLease",
      "LbHost",
      "LbHostAccount",
      "LbThreadCandidate",
      "LbDraft",
      "LbPlacement",
      "LbRun",
      "LbRunStep",
      "LbCaptchaEvent",
      "LbOperatorTicket",
    ]);
    for (const [, name, body = ""] of models) {
      const table = body.match(/@@map\("(lb_\w+)"\)/)?.[1];
      expect(table, name).toBeDefined();
      expect(body, name).toMatch(
        /workspace\s+Organization\s+@relation\(fields: \[workspaceId\], references: \[id\], onDelete: Cascade\)/,
      );
      expect(migration, name).toContain(`CREATE TABLE "${table}"`);
      expect(migration, name).toContain(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,
      );
    }
  });
});
