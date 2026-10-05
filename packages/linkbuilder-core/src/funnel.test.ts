import { LbWhyNotReasonSchema } from "@rakazo/contracts";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildWhyNot, computeDailyNeed, type FunnelCounts } from "./funnel.js";

const zero: FunnelCounts = {
  liveToday: 0,
  newToday: 0,
  liveWeek: 0,
  ready: 0,
  warming: 0,
  pendingEmail: 0,
  qualified: 0,
};
const warmup = { minPostsBeforeLink: 2, minAccountAgeHours: 24 };

describe("computeDailyNeed", () => {
  it("starts registrations a lead time ahead when nothing is ready", () => {
    expect(
      computeDailyNeed({
        quotas: { newPerDay: 3, livePerDay: 1 },
        counts: { ...zero, qualified: 10 },
        warmup,
      }),
    ).toEqual({
      liveRemainingToday: 1,
      linkRepliesToAttempt: 0,
      registrationsToStart: 1,
      pipelineTarget: 1,
      leadDays: 1,
      blockers: [],
    });
  });

  it("uses ready accounts for today's links and refills the pipeline for tomorrow", () => {
    const need = computeDailyNeed({
      quotas: { newPerDay: 3, livePerDay: 1 },
      counts: { ...zero, ready: 2, qualified: 10 },
      warmup,
    });
    expect(need).toMatchObject({
      liveRemainingToday: 1,
      linkRepliesToAttempt: 1,
      registrationsToStart: 0,
      blockers: [],
    });
  });

  it("explains a shortfall with warm-up, email and supply blockers in canonical order", () => {
    const need = computeDailyNeed({
      quotas: { newPerDay: 3, livePerDay: 2 },
      counts: { ...zero, newToday: 1, warming: 2, pendingEmail: 1, qualified: 1 },
      warmup: { minPostsBeforeLink: 2, minAccountAgeHours: 72 },
    });
    expect(need).toEqual({
      liveRemainingToday: 2,
      linkRepliesToAttempt: 0,
      registrationsToStart: 1,
      pipelineTarget: 6,
      leadDays: 3,
      blockers: ["host_supply_exhausted", "warmup_pending", "pending_email"],
    });
  });

  it("lets same-day registrations cover today's shortfall when there is no age gate", () => {
    const need = computeDailyNeed({
      quotas: { newPerDay: 3, livePerDay: 2 },
      counts: { ...zero, qualified: 5 },
      warmup: { minPostsBeforeLink: 0, minAccountAgeHours: 0 },
    });
    expect(need).toMatchObject({ leadDays: 0, pipelineTarget: 4, registrationsToStart: 3 });
  });

  it("rounds partial days of account age up", () => {
    const need = computeDailyNeed({
      quotas: { newPerDay: 5, livePerDay: 1 },
      counts: { ...zero, qualified: 5 },
      warmup: { minPostsBeforeLink: 0, minAccountAgeHours: 25 },
    });
    expect(need).toMatchObject({ leadDays: 2, pipelineTarget: 2, registrationsToStart: 2 });
  });

  it("stops at the daily quota", () => {
    const need = computeDailyNeed({
      quotas: { newPerDay: 3, livePerDay: 1 },
      counts: { ...zero, liveToday: 1, liveWeek: 1, ready: 3, qualified: 2 },
      warmup,
    });
    expect(need).toMatchObject({ liveRemainingToday: 0, linkRepliesToAttempt: 0, blockers: [] });
  });

  it("reports the weekly cap and the new-account quota", () => {
    const capped = computeDailyNeed({
      quotas: { newPerDay: 3, livePerDay: 1, liveWeekCap: 5 },
      counts: { ...zero, liveWeek: 5, ready: 1, qualified: 3 },
      warmup,
    });
    expect(capped).toMatchObject({ liveRemainingToday: 0, linkRepliesToAttempt: 0 });
    expect(capped.blockers).toEqual(["week_cap_reached"]);

    const exhausted = computeDailyNeed({
      quotas: { newPerDay: 3, livePerDay: 1 },
      counts: { ...zero, newToday: 3, qualified: 3 },
      warmup,
    });
    expect(exhausted).toMatchObject({ registrationsToStart: 0, blockers: ["new_quota_reached"] });
  });

  it.each([
    ["negative", { ...zero, ready: -1 }],
    ["fractional", { ...zero, qualified: 1.5 }],
    ["NaN", { ...zero, warming: Number.NaN }],
  ])("rejects %s counts", (_label, counts) => {
    expect(() =>
      computeDailyNeed({ quotas: { newPerDay: 1, livePerDay: 1 }, counts, warmup }),
    ).toThrow(RangeError);
  });

  it("rejects invalid quotas", () => {
    expect(() =>
      computeDailyNeed({ quotas: { newPerDay: -1, livePerDay: 1 }, counts: zero, warmup }),
    ).toThrow(RangeError);
    expect(() =>
      computeDailyNeed({
        quotas: { newPerDay: 1, livePerDay: 1, liveWeekCap: 0.5 },
        counts: zero,
        warmup,
      }),
    ).toThrow(RangeError);
  });

  it("never plans beyond quotas, supply or ready accounts", () => {
    const count = fc.integer({ min: 0, max: 40 });
    fc.assert(
      fc.property(
        fc.record({ newPerDay: count, livePerDay: count, liveWeekCap: fc.option(count) }),
        fc.record({
          liveToday: count,
          newToday: count,
          liveWeek: count,
          ready: count,
          warming: count,
          pendingEmail: count,
          qualified: count,
        }),
        fc.integer({ min: 0, max: 24 * 30 }),
        (quotas, counts, minAccountAgeHours) => {
          const need = computeDailyNeed({
            quotas: { ...quotas, liveWeekCap: quotas.liveWeekCap ?? undefined },
            counts,
            warmup: { minPostsBeforeLink: 2, minAccountAgeHours },
          });
          expect(need.liveRemainingToday).toBeLessThanOrEqual(quotas.livePerDay);
          expect(need.linkRepliesToAttempt).toBeLessThanOrEqual(
            Math.min(need.liveRemainingToday, counts.ready),
          );
          expect(need.registrationsToStart).toBeLessThanOrEqual(counts.qualified);
          expect(need.registrationsToStart).toBeLessThanOrEqual(
            Math.max(0, quotas.newPerDay - counts.newToday),
          );
          expect(need.registrationsToStart).toBeGreaterThanOrEqual(0);
          const order = LbWhyNotReasonSchema.options;
          const indexes = need.blockers.map((reason) => order.indexOf(reason));
          expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
        },
      ),
      { seed: 20261005, numRuns: 500 },
    );
  });
});

describe("buildWhyNot", () => {
  const base = {
    modelErrors: 0,
    modelRefusals: 0,
    captchaBalance: null,
    lowBalanceCredits: 500,
    proxy: "ok" as const,
  };

  it("reports exhausted supply when nothing is in flight", () => {
    expect(buildWhyNot({ ...base, hostCounts: {} })).toEqual({
      supply: { qualified: 0, ready: 0 },
      parked: 0,
      spamBlocked: 0,
      unsupportedCaptcha: 0,
      pendingEmail: 0,
      pendingAdmin: 0,
      modelErrors: 0,
      modelRefusals: 0,
      captchaBalance: null,
      proxy: "ok",
      reasons: ["host_supply_exhausted"],
    });
  });

  it("lists every applicable reason once, in canonical order", () => {
    const report = buildWhyNot({
      ...base,
      hostCounts: {
        warming: 2,
        pending_email: 1,
        pending_admin: 1,
        parked_operator: 2,
        spam_blocked: 1,
        unsupported_captcha: 1,
      },
      modelRefusals: 1,
      captchaBalance: 120,
      proxy: "degraded",
      need: { blockers: ["new_quota_reached", "pending_email"] },
    });
    expect(report.reasons).toEqual([
      "warmup_pending",
      "pending_email",
      "pending_admin",
      "operator_parked",
      "spam_filtered",
      "unsupported_captcha",
      "captcha_balance_low",
      "model_errors",
      "proxy_degraded",
      "new_quota_reached",
    ]);
    expect(report).toMatchObject({ parked: 2, spamBlocked: 1, unsupportedCaptcha: 1 });
  });

  it("does not flag the captcha balance at the threshold or when ready accounts exist", () => {
    const report = buildWhyNot({
      ...base,
      hostCounts: { ready: 1, warming: 1, qualified: 3 },
      captchaBalance: 500,
    });
    expect(report.reasons).toEqual([]);
    expect(report.supply).toEqual({ qualified: 3, ready: 1 });
  });

  it("rejects invalid host counts", () => {
    expect(() => buildWhyNot({ ...base, hostCounts: { ready: -1 } })).toThrow(RangeError);
  });
});
