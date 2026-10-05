import { describe, expect, it } from "vitest";
import {
  LB_DEFAULT_SPAM_SENTENCES,
  LbLinkRatioSchema,
  LbProjectConfigSchema,
  LbProjectStartableSchema,
  LbQuotasSchema,
  LbScheduleSchema,
  LbTargetSchema,
  LbWhyNotSchema,
} from "./index.js";

const minimal = {
  name: "Demo",
  slug: "demo-wellness",
  brandName: "Demo Wellness",
  allowedDomains: ["demo-wellness.example"],
  persona: { displayName: "Lena" },
  quotas: { newPerDay: 3, livePerDay: 1 },
  schedule: { timezone: "Europe/Berlin" },
};

describe("link builder project config", () => {
  it("applies the plan defaults, including undisclosed persona mode", () => {
    const config = LbProjectConfigSchema.parse(minimal);
    expect(config.disclosureMode).toBe("undisclosed_persona");
    expect(config.persona).toMatchObject({ language: "de", register: "du", region: "DE", bio: "" });
    expect(config.schedule).toEqual({
      timezone: "Europe/Berlin",
      weekdaysOnly: true,
      window: { start: "09:00", end: "22:00" },
      overtimeUntilLiveMet: false,
      hardStopHour: 24,
    });
    expect(config.quotas.maxLivePerHost).toBe(1);
    expect(config.linkRatio).toEqual({ links: 1, posts: 3 });
    expect(config.warmup).toEqual({ minPostsBeforeLink: 2, minAccountAgeHours: 24 });
    expect(config.spamRetry).toEqual({ maxRetries: 1, sentences: [...LB_DEFAULT_SPAM_SENTENCES] });
    expect(config.operator.parkedHostTtlHours).toBe(48);
    expect(config.captchaLowBalanceCredits).toBe(500);
    expect(config.geoPolicy).toBe("dach_first");
    expect(config.countNofollow).toBe(true);
  });

  it("requires mailbox, captcha seat and topic lanes before start", () => {
    expect(LbProjectStartableSchema.safeParse(minimal).success).toBe(false);
    expect(
      LbProjectStartableSchema.safeParse({
        ...minimal,
        mailboxId: "inbox-1",
        captchaSecretId: "secret-1",
        topicLanes: [{ id: "lane-1", tag: "Rücken", description: "Rückenschmerzen" }],
      }).success,
    ).toBe(true);
  });

  it("rejects invalid domains, slugs and quota combinations", () => {
    expect(
      LbProjectConfigSchema.safeParse({ ...minimal, allowedDomains: ["https://x.example"] })
        .success,
    ).toBe(false);
    expect(LbProjectConfigSchema.safeParse({ ...minimal, allowedDomains: [] }).success).toBe(false);
    expect(LbProjectConfigSchema.safeParse({ ...minimal, slug: "Demo Slug" }).success).toBe(false);
    expect(LbQuotasSchema.safeParse({ newPerDay: 1, livePerDay: 3, liveWeekCap: 2 }).success).toBe(
      false,
    );
    expect(
      LbQuotasSchema.safeParse({ newPerDay: 1, livePerDay: 1, maxLivePerHost: 2 }).success,
    ).toBe(false);
  });

  it("validates schedule windows, time zones and hard stop", () => {
    expect(LbScheduleSchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false);
    expect(
      LbScheduleSchema.safeParse({
        timezone: "Europe/Vienna",
        window: { start: "22:00", end: "09:00" },
      }).success,
    ).toBe(false);
    expect(
      LbScheduleSchema.safeParse({
        timezone: "Europe/Zurich",
        window: { start: "09:00", end: "22:00" },
        hardStopHour: 21,
      }).success,
    ).toBe(false);
    expect(
      LbScheduleSchema.safeParse({
        timezone: "Europe/Zurich",
        window: { start: "9:00", end: "22:00" },
      }).success,
    ).toBe(false);
  });

  it("validates targets, link ratio and the why-not report", () => {
    expect(LbTargetSchema.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
    expect(LbTargetSchema.parse({ url: "https://demo-wellness.example/ruecken" }).priority).toBe(
      50,
    );
    expect(LbLinkRatioSchema.safeParse({ links: 4, posts: 3 }).success).toBe(false);
    expect(LbLinkRatioSchema.safeParse({ links: 1, posts: 0 }).success).toBe(false);
    expect(
      LbWhyNotSchema.safeParse({
        supply: { qualified: 0, ready: 0 },
        parked: 1,
        spamBlocked: 0,
        unsupportedCaptcha: 0,
        pendingEmail: 0,
        pendingAdmin: 0,
        modelErrors: 0,
        modelRefusals: 0,
        captchaBalance: null,
        proxy: "ok",
        reasons: ["host_supply_exhausted", "operator_parked"],
      }).success,
    ).toBe(true);
  });
});
