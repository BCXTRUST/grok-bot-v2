import { describe, expect, it } from "vitest";
import {
  fakeDomains,
  fakeScriptLength,
  foundForumLine,
  foundThreadLine,
  isFixtureHostDomain,
  nextResearchLine,
  planFakeStep,
  replayFakeScript,
  researchLogLines,
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

  it("advances past the first research line and does not hold", () => {
    const steps = replayFakeScript(input);
    expect(steps).toHaveLength(fakeScriptLength());
    expect(steps.map((step) => step.lastAction)).toEqual([
      "Checking Google for on-topic forums",
      "Looking for threads",
      "Continuing",
    ]);
    expect(steps[1]?.lastAction).not.toBe(steps[0]?.lastAction);
    expect(steps.map((step) => step.kind)).toEqual(["research", "research", "research"]);
    expect(steps.every((step) => step.host === undefined)).toBe(true);
    expect(steps.every((step) => step.placement === undefined)).toBe(true);
    expect(steps.every((step) => step.captcha === undefined)).toBe(true);
    expect(steps.every((step) => step.ticket === undefined)).toBe(true);
    expect(JSON.stringify(steps)).not.toContain(".example");
    expect(JSON.stringify(steps)).not.toMatch(/captcha|solved it|LIVE quota|Parked|Verify/i);
    expect(steps.at(-1)?.runStatus).toBe("running");
    const later = planFakeStep({
      ...input,
      stepIndex: 3,
      researchBeats: 4,
      stageBeats: 4,
      previousAction: "Still researching",
    });
    expect(later).toMatchObject({
      kind: "research",
      lastAction: "Checking Google for on-topic forums",
    });
    expect("hold" in later).toBe(false);
    const after = planFakeStep({
      ...input,
      stepIndex: 20,
      researchBeats: 6,
      stageBeats: 0,
      previousAction: steps.at(-1)?.lastAction,
    });
    expect(after).toMatchObject({
      kind: "research",
      lastAction: "Checking Google for on-topic forums",
    });
    expect(nextResearchLine("Continuing")).toBe("Checking Google for on-topic forums");
  });

  it("writes a found line only when the name is real", () => {
    expect(foundForumLine(null)).toBeNull();
    expect(foundForumLine(" ")).toBeNull();
    expect(foundForumLine("forum-abc.example")).toBeNull();
    expect(foundForumLine("fragen-1ej2xe.example")).toBeNull();
    expect(foundThreadLine("brett-1ej2xe.example")).toBeNull();
    expect(foundThreadLine("thread.example")).toBeNull();
    expect(foundForumLine("gutefrage.net")).toBe("Found forum gutefrage.net");
    expect(foundThreadLine("Vitamin D im Winter?")).toBe("Found Vitamin D im Winter?");
    expect(
      researchLogLines({ forumName: "gutefrage.net", threadName: "Vitamin D im Winter?" }),
    ).toEqual([
      "Checking Google for on-topic forums",
      "Found forum gutefrage.net",
      "Looking for threads on gutefrage.net",
      "Found Vitamin D im Winter?",
      "Continuing",
    ]);
    const invented = researchLogLines({
      forumName: "forum-a.example",
      threadName: "On https://brett-a.example/t/1",
    });
    expect(invented.join("\n")).not.toContain(".example");
    expect(invented.some((line) => line.startsWith("Found"))).toBe(false);
    const named = planFakeStep({
      ...input,
      stepIndex: 1,
      researchBeats: 1,
      previousAction: "Checking Google for on-topic forums",
      forumName: "gutefrage.net",
    });
    expect(named).toMatchObject({ lastAction: "Found forum gutefrage.net" });
    const skipped = planFakeStep({
      ...input,
      stepIndex: 1,
      researchBeats: 1,
      previousAction: "Checking Google for on-topic forums",
      forumName: "forum-a.example",
      threadName: "thread.example",
    });
    expect(JSON.stringify(skipped)).not.toContain(".example");
    expect(skipped).toMatchObject({ lastAction: "Looking for threads" });
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
    expect(
      planFakeStep({
        ...input,
        stepIndex: 2,
        researchBeats: 2,
        previousAction: replayed[1]?.lastAction,
      }),
    ).toEqual(replayed[2]);
  });
});
