import { LB_DEFAULT_MARKET, type LbRunStatus } from "@rakazo/contracts";
import type { FakeStepPlan } from "@rakazo/linkbuilder-core";
import { describe, expect, it, vi } from "vitest";
import {
  type FakeRunRecord,
  isLinkBuilderFakeEnabled,
  type LinkBuilderFakeStore,
  tickLinkBuilderFake,
} from "./link-builder-fake.js";

const now = new Date("2026-10-05T17:00:00.000Z");

function run(status: LbRunStatus = "running"): FakeRunRecord {
  return {
    id: "run-1",
    projectId: "project-1",
    workspaceId: "workspace-1",
    status,
    stepCount: 0,
    researchBeats: 0,
    stageBeats: 0,
    previousAction: null,
    forumName: null,
    threadName: null,
    counters: { newToday: 0, liveToday: 0, liveWeek: 0, uniqueHosts: 0 },
    seed: "project-1",
    brandName: "Nordlicht",
    targetUrl: "https://nordlicht.example/schlaf",
    markets: [{ ...LB_DEFAULT_MARKET }],
    quotas: { livePerDay: 1, liveWeekCap: 5 },
    countNofollow: true,
    lowBalanceCredits: 500,
  };
}

function memoryStore(initial: FakeRunRecord): LinkBuilderFakeStore & {
  steps: FakeStepPlan[];
  current: FakeRunRecord;
} {
  const current = { ...initial };
  const steps: FakeStepPlan[] = [];
  return {
    steps,
    current,
    async runnable() {
      return current.status === "queued" ||
        current.status === "running" ||
        current.status === "overtime"
        ? [{ ...current }]
        : [];
    },
    async apply(record, step) {
      steps.push(step);
      current.stepCount = record.stepCount + 1;
      current.previousAction = step.lastAction;
      if (step.kind === "research") current.researchBeats += 1;
      if (step.kind.startsWith("lb_")) current.stageBeats += 1;
      current.status = step.runStatus;
      current.counters = step.counters;
    },
    async finishIfOpen(record) {
      current.status = record.status === "queued" ? "cancelled" : "partial";
    },
    async publish() {},
  };
}

describe("link builder fake runner", () => {
  it("is on unless the driver flag says otherwise", () => {
    expect(isLinkBuilderFakeEnabled({})).toBe(true);
    expect(isLinkBuilderFakeEnabled({ LINK_BUILDER_DRIVER: "fake" })).toBe(true);
    expect(isLinkBuilderFakeEnabled({ LINK_BUILDER_DRIVER: "off" })).toBe(false);
    expect(isLinkBuilderFakeEnabled({ LINK_BUILDER_DRIVER: "playwright" })).toBe(false);
  });

  it("keeps writing the next research sentence instead of holding one line", async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("network");
    });
    const store = memoryStore(run());
    const clocks = [now, new Date("2026-10-05T18:00:00.000Z")];
    const lines: string[][] = [];
    for (const clock of clocks) {
      const fresh = memoryStore(run());
      for (let guard = 0; guard < 5; guard += 1) {
        expect(await tickLinkBuilderFake(fresh, clock)).toBe(1);
      }
      lines.push(fresh.steps.map((step) => step.lastAction));
    }
    expect(lines[0]).toEqual(lines[1]);
    expect(store.steps).toHaveLength(0);
    const sample = memoryStore(run("running"));
    sample.current.previousAction = "Still researching";
    sample.current.researchBeats = 4;
    sample.current.stepCount = 18;
    for (let guard = 0; guard < 5; guard += 1) {
      expect(await tickLinkBuilderFake(sample, now)).toBe(1);
    }
    expect(sample.steps.map((step) => step.lastAction)).toEqual([
      "Checking Google for on-topic forums",
      "Looking for threads",
      "Continuing",
      "Checking Google for on-topic forums",
      "Looking for threads",
    ]);
    expect(sample.steps[1]?.lastAction).not.toBe(sample.steps[0]?.lastAction);
    expect(sample.steps.every((step) => step.kind === "research")).toBe(true);
    expect(sample.steps.every((step) => step.host === undefined)).toBe(true);
    expect(sample.steps.every((step) => step.placement === undefined)).toBe(true);
    expect(
      sample.steps.every((step) => step.captcha === undefined && step.ticket === undefined),
    ).toBe(true);
    expect(JSON.stringify(sample.steps)).not.toContain(".example");
    expect(JSON.stringify(sample.steps)).not.toMatch(/captcha|solved it|LIVE quota|Parked|Verify/i);
    expect(sample.current.status).toBe("running");
    expect(sample.current.counters).toEqual(run().counters);
    vi.unstubAllGlobals();
  });
});
