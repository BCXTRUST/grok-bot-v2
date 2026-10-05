import { describe, expect, it } from "vitest";
import { hostState } from "./host-state.js";
import { isWarmupMet, planRealStep, type RealPlanInput } from "./real-pipeline.js";

const noSession = { hostId: null, cookieChecked: false, registerFormReady: false };
const onHost = { hostId: "h1", cookieChecked: false, registerFormReady: false };

function input(overrides: Partial<RealPlanInput>): RealPlanInput {
  return {
    runStatus: "running",
    liveMet: false,
    host: { id: "h1", ...hostState("qualified") },
    session: noSession,
    warmupMet: true,
    placement: null,
    ...overrides,
  };
}

describe("planRealStep", () => {
  it("stops on terminal runs and waits on paused runs", () => {
    expect(planRealStep(input({ runStatus: "succeeded" }))).toEqual({ kind: "done" });
    expect(planRealStep(input({ runStatus: "failed" }))).toEqual({ kind: "done" });
    expect(planRealStep(input({ runStatus: "paused" }))).toEqual({
      kind: "wait",
      reason: "paused",
    });
  });

  it("closes once the daily goal is met", () => {
    expect(planRealStep(input({ liveMet: true }))).toEqual({ kind: "close" });
  });

  it("selects a host when none is workable", () => {
    expect(planRealStep(input({ host: null }))).toEqual({ kind: "select_host" });
    for (const status of ["used", "dead", "discovered", "pending_admin"] as const) {
      expect(planRealStep(input({ host: { id: "h1", ...hostState(status) } }))).toEqual({
        kind: "select_host",
      });
    }
    expect(
      planRealStep(input({ host: { id: "h1", ...hostState("parked_operator", "registering") } })),
    ).toEqual({ kind: "select_host" });
  });

  it("opens a session before any browser step on a new host", () => {
    expect(planRealStep(input({}))).toEqual({ kind: "open_session" });
    expect(
      planRealStep(
        input({ session: { hostId: "other", cookieChecked: true, registerFormReady: true } }),
      ),
    ).toEqual({ kind: "open_session" });
  });

  it("walks the registration funnel in order", () => {
    expect(planRealStep(input({ session: onHost }))).toEqual({ kind: "cookie_wall" });
    expect(planRealStep(input({ session: { ...onHost, cookieChecked: true } }))).toEqual({
      kind: "register",
    });
    const registering = { id: "h1", ...hostState("registering") };
    expect(planRealStep(input({ host: registering, session: onHost }))).toEqual({
      kind: "register",
    });
    expect(
      planRealStep(input({ host: registering, session: { ...onHost, registerFormReady: true } })),
    ).toEqual({ kind: "captcha" });
    expect(
      planRealStep(input({ host: { id: "h1", ...hostState("pending_email") }, session: onHost })),
    ).toEqual({
      kind: "email_verify",
    });
  });

  it("warms up, posts and verifies", () => {
    const warming = { id: "h1", ...hostState("warming") };
    expect(planRealStep(input({ host: warming, warmupMet: true }))).toEqual({ kind: "warmup" });
    expect(planRealStep(input({ host: warming, warmupMet: false }))).toEqual({
      kind: "select_host",
    });
    const ready = { id: "h1", ...hostState("ready") };
    expect(planRealStep(input({ host: ready }))).toEqual({ kind: "open_session" });
    expect(planRealStep(input({ host: ready, session: onHost }))).toEqual({ kind: "post" });
    expect(
      planRealStep(input({ host: ready, placement: { status: "pending", counted: false } })),
    ).toEqual({ kind: "verify" });
    expect(
      planRealStep(input({ host: ready, placement: { status: "removed", counted: false } })),
    ).toEqual({ kind: "select_host" });
  });
});

describe("isWarmupMet", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  it("needs both the post count and the account age", () => {
    const base = { now, minPostsBeforeLink: 2, minAccountAgeHours: 24 };
    const old = new Date("2026-10-03T12:00:00Z");
    expect(isWarmupMet({ ...base, postCount: 2, accountCreatedAt: old })).toBe(true);
    expect(isWarmupMet({ ...base, postCount: 1, accountCreatedAt: old })).toBe(false);
    expect(isWarmupMet({ ...base, postCount: 5, accountCreatedAt: now })).toBe(false);
    expect(
      isWarmupMet({
        now,
        minPostsBeforeLink: 0,
        minAccountAgeHours: 0,
        postCount: 0,
        accountCreatedAt: now,
      }),
    ).toBe(true);
  });
});
