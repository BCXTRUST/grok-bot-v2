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
      steps: [step(1, "Looking for threads"), step(0, "Checking Google for on-topic forums")],
      lastEvent: "Looking for threads",
      working: true,
      blockers: [],
    });
    expect(items.map((item) => item.label)).toEqual([
      "Checking Google for on-topic forums",
      "Looking for threads",
    ]);
    expect(items.map((item) => item.status)).toEqual(["done", "working"]);
    expect(overviewAction(items, true)).toBe("Looking for threads");
  });

  it("drops fixture hosts and starts on research before any step arrives", () => {
    const starting = overviewFeed({
      steps: [],
      lastEvent: null,
      working: true,
      blockers: [],
    });
    expect(starting).toEqual([
      {
        id: "researching",
        label: "Checking Google for on-topic forums",
        status: "working",
        at: null,
      },
    ]);
    const blocked = overviewFeed({
      steps: [step(0, "Looking for threads"), step(1, "Discovered forum-a.example")],
      lastEvent: "Discovered forum-a.example",
      working: false,
      blockers: ["Parked 1"],
    });
    expect(blocked.map((item) => item.label)).toEqual(["Looking for threads", "Parked 1"]);
    const customer = overviewFeed({
      steps: [step(0, "Looking for threads"), step(1, "LIVE quota met")],
      lastEvent: "Parked the host for an operator",
      working: true,
      blockers: [],
      hideExampleCopy: true,
    });
    expect(customer.map((item) => item.label)).toEqual(["Looking for threads"]);
    expect(blocked[1]?.status).toBe("blocked");
    expect(overviewAction(blocked, false)).toBe("Looking for threads");
  });

  it("collapses a stuck repeat and keeps the next sentence", () => {
    const repeat = step(1, "Checking Google for on-topic forums");
    repeat.createdAt = "2026-10-06T12:00:20.000Z";
    const later = step(2, "Looking for threads");
    later.createdAt = "2026-10-06T12:00:40.000Z";
    const again = step(3, "Checking Google for on-topic forums");
    again.createdAt = "2026-10-06T12:01:10.000Z";
    const items = overviewFeed({
      steps: [step(0, "Checking Google for on-topic forums"), repeat, later, again],
      lastEvent: "Checking Google for on-topic forums",
      working: true,
      blockers: [],
    });
    expect(items.map((item) => item.label)).toEqual([
      "Checking Google for on-topic forums",
      "Looking for threads",
      "Checking Google for on-topic forums",
    ]);
    expect(items.at(-1)?.status).toBe("working");
    expect(overviewAction(items, true)).toBe("Checking Google for on-topic forums");
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

  it("prefers the newest sentence and keeps the older lines", () => {
    const items = overviewFeed({
      steps: [
        step(0, "Checking Google for on-topic forums"),
        step(1, "Looking for threads"),
        step(2, "Continuing"),
        step(3, "Still researching"),
      ],
      lastEvent: "Still researching",
      working: true,
      blockers: [],
      hasPlacement: false,
    });
    expect(items.map((item) => item.label)).toEqual([
      "Checking Google for on-topic forums",
      "Looking for threads",
      "Continuing",
    ]);
    expect(items.find((item) => item.status === "working")?.label).toBe("Continuing");
    expect(overviewAction(items, true)).toBe("Continuing");
  });

  it("adds a found line only for a real name", () => {
    const named = overviewFeed({
      steps: [
        step(0, "Checking Google for on-topic forums"),
        step(1, "Looking for threads"),
        step(2, "Continuing"),
      ],
      lastEvent: null,
      working: true,
      blockers: [],
      forumName: "gutefrage.net",
      threadName: "Vitamin D im Winter?",
    });
    expect(named.map((item) => item.label)).toEqual([
      "Checking Google for on-topic forums",
      "Found forum gutefrage.net",
      "Looking for threads on gutefrage.net",
      "Found Vitamin D im Winter?",
      "Continuing",
    ]);
    expect(overviewAction(named, true)).toBe("Continuing");
    const invented = overviewFeed({
      steps: [step(0, "Checking Google for on-topic forums"), step(1, "Continuing")],
      lastEvent: "Found forum forum-a.example",
      working: true,
      blockers: [],
      forumName: "forum-a.example",
      threadName: "brett-a.example",
    });
    expect(invented.map((item) => item.label).join("\n")).not.toContain(".example");
    expect(invented.some((item) => item.label.startsWith("Found"))).toBe(false);
    expect(overviewAction(invented, true)).toBe("Continuing");
    const brand = overviewFeed({
      steps: [
        step(0, "Checking Google for on-topic forums"),
        step(1, "Looking for threads"),
        step(2, "Found Vitaminexpress"),
        step(3, "Continuing"),
      ],
      lastEvent: "Found Vitaminexpress",
      working: true,
      blockers: [],
    });
    expect(brand.map((item) => item.label)).toEqual([
      "Checking Google for on-topic forums",
      "Looking for threads",
      "Continuing",
    ]);
    expect(overviewAction(brand, true)).toBe("Continuing");
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
    expect(items.map((item) => item.label)).toEqual(["Registered"]);
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
