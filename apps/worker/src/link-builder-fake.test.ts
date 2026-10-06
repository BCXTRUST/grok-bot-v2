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

  it("moves through stages without creating example hosts, then holds the run open", async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("network");
    });
    const store = memoryStore(run());
    const clocks = [now, new Date("2026-10-05T18:00:00.000Z")];
    const kinds: string[][] = [];
    for (const clock of clocks) {
      const fresh = memoryStore(run());
      for (let guard = 0; guard < 30; guard += 1) {
        const stepped = await tickLinkBuilderFake(fresh, clock);
        if (stepped === 0) break;
      }
      kinds.push(fresh.steps.map((step) => step.kind));
    }
    expect(kinds[0]).toEqual(kinds[1]);
    expect(store.steps).toHaveLength(0);
    const sample = memoryStore(run("running"));
    sample.current.researchBeats = 0;
    sample.current.stepCount = 18;
    for (let guard = 0; guard < 30; guard += 1) {
      if ((await tickLinkBuilderFake(sample, now)) === 0) break;
    }
    expect(sample.steps.map((step) => step.kind)).toEqual([
      "research",
      "research",
      "research",
      "research",
      "lb_register",
      "lb_warmup",
      "lb_place",
      "lb_verify",
    ]);
    expect(sample.steps.every((step) => step.host === undefined)).toBe(true);
    expect(
      sample.steps.every((step) => step.captcha === undefined && step.ticket === undefined),
    ).toBe(true);
    expect(JSON.stringify(sample.steps)).not.toContain(".example");
    expect(JSON.stringify(sample.steps)).not.toMatch(/captcha|solved it|LIVE quota|Parked/i);
    expect(sample.current.status).toBe("running");
    expect(sample.steps).toHaveLength(8);
    expect(sample.steps[0]?.lastAction).toBe("Researching topics");
    expect(sample.steps.at(-1)?.lastAction).toBe("Verify");
    expect(sample.current.counters).toEqual(run().counters);
    vi.unstubAllGlobals();
  });
});
