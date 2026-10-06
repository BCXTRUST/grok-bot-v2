import { describe, expect, it } from "vitest";
import {
  fakeDomains,
  fakeScriptLength,
  isFixtureHostDomain,
  planFakeStep,
  replayFakeScript,
} from "./fake-scenario.js";

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

  it("researches without creating example hosts", () => {
    const steps = replayFakeScript(input);
    expect(steps).toHaveLength(fakeScriptLength());
    expect(steps.every((step) => step.kind === "research")).toBe(true);
    expect(steps.every((step) => step.host === undefined)).toBe(true);
    expect(steps.every((step) => step.placement === undefined)).toBe(true);
    expect(JSON.stringify(steps)).not.toContain(".example");
    expect(steps[0]?.lastAction).toBe("Researching topics");
    expect(steps.at(-1)?.runStatus).toBe("running");
    expect(planFakeStep({ ...input, stepIndex: 3, researchBeats: fakeScriptLength() })).toEqual({
      hold: true,
    });
  });

  it("treats the offline boards as fixtures and leaves real domains alone", () => {
    const [forum, fragen, brett] = Object.values(fakeDomains(input.seed));
    expect(isFixtureHostDomain(forum!)).toBe(true);
    expect(isFixtureHostDomain(fragen!)).toBe(true);
    expect(isFixtureHostDomain(brett!)).toBe(true);
    expect(isFixtureHostDomain("fragen.nordlicht.example")).toBe(false);
    expect(isFixtureHostDomain("www.vitaminexpress.org")).toBe(false);
  });

  it("plans a single step that matches the replay", () => {
    const replayed = replayFakeScript(input);
    expect(planFakeStep({ ...input, stepIndex: 2, researchBeats: 2 })).toEqual(replayed[2]);
  });
});
