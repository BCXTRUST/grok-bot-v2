import { describe, expect, it } from "vitest";
import {
  canTransitionPlacement,
  countedAfterReverify,
  evaluateVerification,
  IllegalTransition,
  normalizeRel,
  PLACEMENT_STATUSES,
  type PlacementStatus,
  shouldCount,
  transitionPlacement,
  type VerificationFacts,
} from "./index.js";

const LEGAL: Array<[PlacementStatus, PlacementStatus]> = [
  ["pending", "live"],
  ["pending", "nofollow_live"],
  ["pending", "removed"],
  ["pending", "dead"],
  ["live", "nofollow_live"],
  ["live", "removed"],
  ["live", "dead"],
  ["nofollow_live", "live"],
  ["nofollow_live", "removed"],
  ["nofollow_live", "dead"],
  ["removed", "live"],
  ["removed", "nofollow_live"],
  ["removed", "dead"],
];

describe("placement state machine", () => {
  it("allows the legal table plus idempotent re-verification", () => {
    const legal = new Set(LEGAL.map(([from, to]) => `${from}:${to}`));
    for (const from of PLACEMENT_STATUSES) {
      for (const to of PLACEMENT_STATUSES) {
        const allowed = from === to || legal.has(`${from}:${to}`);
        expect(canTransitionPlacement(from, to), `${from}->${to}`).toBe(allowed);
        if (allowed) expect(transitionPlacement(from, to)).toBe(to);
        else expect(() => transitionPlacement(from, to)).toThrow(IllegalTransition);
      }
    }
  });

  it("never returns to pending and never leaves dead", () => {
    for (const from of PLACEMENT_STATUSES.filter((status) => status !== "pending")) {
      expect(canTransitionPlacement(from, "pending")).toBe(false);
    }
    for (const to of PLACEMENT_STATUSES.filter((status) => status !== "dead")) {
      expect(canTransitionPlacement("dead", to)).toBe(false);
    }
  });
});

describe("verification", () => {
  const live: VerificationFacts = {
    hrefFound: true,
    rel: null,
    postPresent: true,
    threadPresent: true,
    noindex: false,
  };

  it.each<[string, Partial<VerificationFacts>, PlacementStatus, boolean]>([
    ["followable link", {}, "live", true],
    ["rel=nofollow", { rel: "nofollow" }, "nofollow_live", false],
    ["rel=ugc", { rel: "UGC noopener" }, "nofollow_live", false],
    ["rel=sponsored tokens", { rel: ["noopener", "sponsored"] }, "nofollow_live", false],
    ["harmless rel", { rel: "noopener noreferrer" }, "live", true],
    ["noindex page", { noindex: true }, "nofollow_live", false],
    ["link removed", { hrefFound: false }, "removed", false],
    ["post deleted", { postPresent: false }, "dead", false],
    ["thread deleted", { threadPresent: false, postPresent: false }, "dead", false],
    ["thread deleted, post cached", { threadPresent: false }, "dead", false],
  ])("%s", (_label, facts, status, followable) => {
    const outcome = evaluateVerification({ ...live, ...facts });
    expect(outcome.status).toBe(status);
    expect(outcome.followable).toBe(followable);
    expect(outcome.indexable).toBe(!facts.noindex);
  });

  it("normalises rel tokens", () => {
    expect(normalizeRel(" NoFollow  ugc nofollow")).toEqual(["nofollow", "ugc"]);
    expect(normalizeRel(["ugc noopener", "UGC"])).toEqual(["noopener", "ugc"]);
    expect(normalizeRel(undefined)).toEqual([]);
    expect(normalizeRel("")).toEqual([]);
  });

  it("counts followable links always and nofollow links by project policy", () => {
    expect(shouldCount("live", false)).toBe(true);
    expect(shouldCount("nofollow_live", true)).toBe(true);
    expect(shouldCount("nofollow_live", false)).toBe(false);
    for (const status of ["pending", "removed", "dead"] as const) {
      expect(shouldCount(status, true)).toBe(false);
    }
    expect(shouldCount(evaluateVerification({ ...live, rel: "ugc" }), true)).toBe(true);
    expect(shouldCount(evaluateVerification({ ...live, rel: "ugc" }), false)).toBe(false);
  });

  it("uncounts a removed or dead link and keeps the first live on a host", () => {
    expect(
      countedAfterReverify({
        wasCounted: true,
        status: "removed",
        countNofollow: true,
        anotherCountedOnHost: false,
      }),
    ).toBe(false);
    expect(
      countedAfterReverify({
        wasCounted: false,
        status: "live",
        countNofollow: true,
        anotherCountedOnHost: true,
      }),
    ).toBe(false);
    expect(
      countedAfterReverify({
        wasCounted: false,
        status: "live",
        countNofollow: true,
        anotherCountedOnHost: false,
      }),
    ).toBe(true);
  });
});
