import { describe, expect, it } from "vitest";
import { fakeDomains, fakeScriptLength, planFakeStep, replayFakeScript } from "./fake-scenario.js";

const now = new Date("2026-10-05T17:00:00.000Z");
const input = {
  seed: "project-seed",
  now,
  markets: [
    {
      country: "DE" as const,
      language: "de",
      locale: "de-DE",
      timezoneId: "Europe/Berlin",
    },
  ],
  brandName: "Nordlicht",
  targetUrl: "https://nordlicht.example/schlaf",
  quotas: { livePerDay: 1, liveWeekCap: 5 },
  countNofollow: true,
};

describe("fake scenario", () => {
  it("is deterministic for a seed", () => {
    const first = replayFakeScript(input);
    const second = replayFakeScript({ ...input, now: new Date("2026-10-06T17:00:00.000Z") });
    expect(first.map((step) => step.kind)).toEqual(second.map((step) => step.kind));
    expect(fakeDomains(input.seed)).toEqual(fakeDomains(input.seed));
    expect(fakeDomains("other")).not.toEqual(fakeDomains(input.seed));
  });

  it("walks discover → LIVE and parks one host for an operator", () => {
    const steps = replayFakeScript(input);
    expect(steps).toHaveLength(fakeScriptLength());
    expect(steps.map((step) => step.kind)).toEqual([
      "discover",
      "probe",
      "qualify",
      "discover",
      "probe",
      "qualify",
      "discover",
      "probe",
      "qualify",
      "register",
      "captcha",
      "activate",
      "ready",
      "post",
      "verify",
      "register",
      "park",
      "close",
    ]);
    const verified = steps.find((step) => step.kind === "verify");
    expect(verified?.placement).toMatchObject({
      status: "nofollow_live",
      counted: true,
      rel: ["ugc"],
    });
    expect(verified?.host?.status).toBe("used");
    expect(verified?.counters.liveToday).toBe(1);
    const parked = steps.find((step) => step.kind === "park");
    expect(parked?.ticket?.reason).toBe("captcha_unsolved");
    expect(parked?.host).toMatchObject({ status: "parked_operator", parkedFrom: "registering" });
    expect(parked?.captcha?.outcome).toBe("operator_parked");
    expect(steps.at(-1)).toMatchObject({ kind: "close", runStatus: "succeeded" });
    expect(planFakeStep({ ...input, stepIndex: fakeScriptLength() })).toEqual({ done: true });
  });

  it("plans a single step that matches the replay", () => {
    const replayed = replayFakeScript(input);
    expect(planFakeStep({ ...input, stepIndex: 14 })).toEqual(replayed[14]);
  });
});
