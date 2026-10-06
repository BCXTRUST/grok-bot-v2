import type { LbRunStepView, LbWhyNot } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  overviewAction,
  overviewFeed,
  overviewFrame,
  overviewHasPlacement,
  overviewStage,
  overviewWorking,
  whyNotFeedLines,
} from "./overview.js";

const zeroWhy: LbWhyNot = {
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
};

function step(index: number, lastAction: string, artifactIds: string[] = []): LbRunStepView {
  return {
    id: `step-${index}`,
    stepIndex: index,
    kind: "probe",
    hostId: null,
    lastAction,
    error: null,
    costs: { credits: 0, tokens: 0, bytes: 0, ms: 0 },
    artifactIds,
    createdAt: "2026-10-06T12:00:00.000Z",
  };
}

describe("overview feed", () => {
  it("hides an all-zero why-not report and keeps real blockers", () => {
    expect(whyNotFeedLines(zeroWhy)).toEqual([]);
    expect(whyNotFeedLines(null)).toEqual([]);
    expect(
      whyNotFeedLines({
        ...zeroWhy,
        parked: 1,
        pendingEmail: 2,
        spamBlocked: 1,
        proxy: "degraded",
        reasons: ["operator_parked", "pending_email", "spam_filtered", "proxy_degraded"],
      }),
    ).toEqual(["Parked 1", "Spam blocked 1", "Pending email 2", "Proxy degraded"]);
  });

  it("appends steps in order and marks the latest one working", () => {
    const items = overviewFeed({
      steps: [step(1, "Reading threads"), step(0, "Researching topics")],
      lastEvent: "Reading threads",
      working: true,
      blockers: [],
    });
    expect(items.map((item) => item.label)).toEqual(["Researching topics", "Reading threads"]);
    expect(items.map((item) => item.status)).toEqual(["done", "working"]);
    expect(overviewAction(items, true)).toBe("Reading threads");
  });

  it("drops fixture hosts and starts on research before any step arrives", () => {
    const starting = overviewFeed({
      steps: [],
      lastEvent: null,
      working: true,
      blockers: [],
    });
    expect(starting).toEqual([
      { id: "researching", label: "Researching", status: "working", at: null },
    ]);
    const blocked = overviewFeed({
      steps: [step(0, "Reading threads"), step(1, "Discovered forum-a.example")],
      lastEvent: "Discovered forum-a.example",
      working: false,
      blockers: ["Parked 1"],
    });
    expect(blocked.map((item) => item.label)).toEqual(["Reading threads", "Parked 1"]);
    const customer = overviewFeed({
      steps: [step(0, "Reading threads"), step(1, "LIVE quota met")],
      lastEvent: "Parked the host for an operator",
      working: true,
      blockers: [],
      hideExampleCopy: true,
    });
    expect(customer.map((item) => item.label)).toEqual(["Reading threads"]);
    expect(blocked[1]?.status).toBe("blocked");
    expect(overviewAction(blocked, false)).toBe("Reading threads");
  });

  it("collapses identical lines from the same minute and keeps later stage changes", () => {
    const register = step(5, "Register");
    register.createdAt = "2026-10-06T12:02:08.000Z";
    const laterResearch = step(6, "Researching topics");
    laterResearch.createdAt = "2026-10-06T12:05:00.000Z";
    const items = overviewFeed({
      steps: [
        step(0, "Researching topics"),
        step(1, "Reading on-topic pages"),
        step(2, "Reading threads"),
        step(3, "Still researching"),
        step(4, "Researching topics"),
        register,
        laterResearch,
      ],
      lastEvent: "Researching topics",
      working: true,
      blockers: [],
      hideExampleCopy: true,
      hasPlacement: true,
    });
    expect(items.map((item) => item.label)).toEqual([
      "Researching topics",
      "Reading on-topic pages",
      "Reading threads",
      "Still researching",
      "Register",
      "Researching topics",
    ]);
    expect(items.at(-1)?.status).toBe("working");
    expect(items.filter((item) => item.label === "Researching topics")).toHaveLength(2);
  });

  it("follows an explicit start or pause before the server status changes", () => {
    expect(overviewWorking({ activity: "paused", intent: "working" })).toBe(true);
    expect(overviewWorking({ activity: "running", intent: "paused" })).toBe(false);
    expect(overviewWorking({ activity: "running", intent: null })).toBe(true);
    expect(overviewWorking({ activity: "paused", intent: null })).toBe(false);
  });

  it("prefers a live screen, then the newest screenshot", () => {
    const steps = [step(0, "Open", ["older"]), step(1, "Post", ["newer"])];
    expect(
      overviewFrame({
        steps,
        tickets: [
          {
            id: "ticket-1",
            projectId: "demo",
            hostId: "host-1",
            domain: "brett.example",
            runId: "run-1",
            reason: "captcha_unsolved",
            screenUrl: "https://screens.example/live",
            screenshotArtifactId: "shot",
            note: null,
            status: "open",
            expiresAt: null,
            createdAt: "2026-10-06T12:00:00.000Z",
          },
        ],
      }),
    ).toEqual({ kind: "url", url: "https://screens.example/live" });
    expect(overviewFrame({ steps, tickets: [] })).toEqual({
      kind: "artifact",
      artifactId: "newer",
    });
    expect(overviewFrame({ steps: [], tickets: [] })).toBeNull();
  });

  it("does not verify, or spin on Verify, when nothing was placed", () => {
    const verify = step(5, "Verify");
    verify.kind = "lb_verify";
    const registered = step(6, "Registered");
    registered.kind = "register";
    const items = overviewFeed({
      steps: [
        step(0, "Researching topics"),
        step(1, "Still researching"),
        Object.assign(step(2, "Register"), { kind: "lb_register" }),
        Object.assign(step(3, "Warmup"), { kind: "lb_warmup" }),
        Object.assign(step(4, "Place"), { kind: "lb_place" }),
        verify,
        registered,
      ],
      lastEvent: "Verify",
      working: true,
      blockers: [],
      hideExampleCopy: true,
      hasPlacement: false,
    });
    expect(items.map((item) => item.label)).toEqual([
      "Researching topics",
      "Still researching",
      "Registered",
    ]);
    expect(items.some((item) => item.label === "Verify")).toBe(false);
    expect(items.find((item) => item.status === "working")?.label).toBe("Registered");
    expect(overviewHasPlacement([], "vitaminexpress")).toBe(false);
    expect(overviewHasPlacement(["fragen-1ej2xe.example"], "vitaminexpress")).toBe(false);
    expect(
      overviewStage({
        runStatus: "running",
        lastAction: "Verify",
        stepKinds: ["research", "lb_register", "lb_warmup", "lb_place", "lb_verify"],
        hasPlacement: false,
      }),
    ).toBe("research");
  });

  it("keeps a verify line and a frame when a placement or a screenshot exists", () => {
    const verify = step(1, "Verify", ["shot"]);
    verify.kind = "verify";
    const items = overviewFeed({
      steps: [step(0, "Reading threads"), verify],
      lastEvent: "Verify",
      working: true,
      blockers: [],
      hasPlacement: true,
    });
    expect(items.at(-1)).toMatchObject({ label: "Verify", status: "working" });
    expect(overviewFrame({ steps: [verify], tickets: [] })).toEqual({
      kind: "artifact",
      artifactId: "shot",
    });
    expect(overviewHasPlacement(["www.vitaminexpress.org"], "vitaminexpress")).toBe(true);
    expect(
      overviewStage({
        runStatus: "running",
        lastAction: "Verify",
        stepKinds: ["verify"],
        hasPlacement: true,
      }),
    ).toBe("verify");
  });
});
