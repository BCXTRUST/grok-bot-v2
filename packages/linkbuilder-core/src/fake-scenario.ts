import type {
  LbHostPlatform,
  LbHostStatus,
  LbMarket,
  LbParkableHostStatus,
  LbPlacementStatus,
  LbRunStatus,
  LbWhyNot,
} from "@rakazo/contracts";
import { decideHelperAction, HELPER_LABELS } from "./captcha-helper-machine.js";
import { buildWhyNot } from "./funnel.js";
import { type HostState, hostState, transitionHost } from "./host-state.js";
import { evaluateVerification, shouldCount, transitionPlacement } from "./placement-state.js";
import {
  closingRunStatus,
  isRunTerminal,
  type RunCounters,
  recordCountedLive,
  recordHostVisited,
  recordRegistration,
  startRunCounters,
  transitionRun,
} from "./run-state.js";

/** One seeded pass: discover → qualify → register → captcha → post → verify → LIVE, plus one park. */
export const FAKE_SCRIPT = [
  "discover:a",
  "probe:a",
  "qualify:a",
  "discover:b",
  "probe:b",
  "qualify:b",
  "discover:c",
  "probe:c",
  "qualify:c",
  "register:a",
  "captcha:a",
  "activate:a",
  "ready:a",
  "post:a",
  "verify:a",
  "register:b",
  "park:b",
  "close",
] as const;

export type FakeHostKey = "a" | "b" | "c";

export interface FakeScenarioInput {
  seed: string;
  /** Zero-based index of the step to plan. Earlier steps are replayed so transitions stay legal. */
  stepIndex: number;
  now: Date;
  markets: readonly LbMarket[];
  brandName: string;
  targetUrl: string;
  quotas: { livePerDay: number; liveWeekCap?: number };
  countNofollow: boolean;
  lowBalanceCredits?: number;
}

export interface FakeHostWrite {
  key: FakeHostKey;
  domain: string;
  platform: LbHostPlatform;
  country: string;
  language: string;
  status: LbHostStatus;
  parkedFrom: LbParkableHostStatus | null;
  homepageUrl: string;
}

export interface FakeCaptchaWrite {
  type: "recaptcha_v2";
  door: "page_helper" | "operator";
  outcome: "placed_submitted" | "operator_parked";
  buttonTextObserved: string | null;
  humanCheckboxState: "checked" | "none";
  creditsCharged: number;
  attempt: number;
  helperVersion: string;
}

export interface FakePlacementWrite {
  status: LbPlacementStatus;
  counted: boolean;
  rel: string[];
  threadUrl: string;
  postUrl: string;
  targetUrl: string;
  anchorText: string;
  indexable: boolean;
}

export interface FakeStepPlan {
  done: false;
  stepIndex: number;
  kind: string;
  lastAction: string;
  runStatus: LbRunStatus;
  counters: RunCounters;
  host?: FakeHostWrite;
  captcha?: FakeCaptchaWrite;
  placement?: FakePlacementWrite;
  ticket?: { reason: "captcha_unsolved" };
  accountUsername?: string;
  draftBody?: string;
  whyNot?: LbWhyNot;
  costs: { credits: number; tokens: number; bytes: number; ms: number };
}

export type FakePlan = FakeStepPlan | { done: true };

const PLATFORMS: Record<FakeHostKey, LbHostPlatform> = {
  a: "phpbb",
  b: "woltlab",
  c: "discourse",
};

const HELPER_VERSION = "2026.10.4.16";

export function fakeScriptLength(): number {
  return FAKE_SCRIPT.length;
}

export function fakeDomains(seed: string): Record<FakeHostKey, string> {
  const tag = hashTag(seed);
  return {
    a: `forum-${tag}.example`,
    b: `fragen-${tag}.example`,
    c: `brett-${tag}.example`,
  };
}

/** Plans one step. The same seed and index always return the same plan. */
export function planFakeStep(input: FakeScenarioInput): FakePlan {
  if (!Number.isInteger(input.stepIndex) || input.stepIndex < 0) {
    throw new RangeError("stepIndex must be a non-negative integer");
  }
  if (input.stepIndex >= FAKE_SCRIPT.length) return { done: true };
  const replayed = replay(input, input.stepIndex);
  const step = replayed.steps[input.stepIndex];
  if (!step) return { done: true };
  return step;
}

/** Replays every step through `untilIndex` inclusive. Used by tests and the runner. */
export function replayFakeScript(input: Omit<FakeScenarioInput, "stepIndex">): FakeStepPlan[] {
  return replay(input, FAKE_SCRIPT.length - 1).steps;
}

interface Working {
  runStatus: LbRunStatus;
  counters: RunCounters;
  hosts: Map<FakeHostKey, HostState>;
  placement: LbPlacementStatus | null;
}

function replay(
  input: Omit<FakeScenarioInput, "stepIndex">,
  untilIndex: number,
): { steps: FakeStepPlan[] } {
  const domains = fakeDomains(input.seed);
  const market = input.markets[0];
  if (!market) throw new RangeError("A project needs at least one market");
  const working: Working = {
    runStatus: "running",
    counters: startRunCounters(0),
    hosts: new Map(),
    placement: null,
  };
  const steps: FakeStepPlan[] = [];
  const last = Math.min(untilIndex, FAKE_SCRIPT.length - 1);
  for (let index = 0; index <= last; index += 1) {
    const token = FAKE_SCRIPT[index]!;
    steps.push(applyToken(token, index, input, domains, market, working));
  }
  return { steps };
}

function applyToken(
  token: (typeof FAKE_SCRIPT)[number],
  stepIndex: number,
  input: Omit<FakeScenarioInput, "stepIndex">,
  domains: Record<FakeHostKey, string>,
  market: LbMarket,
  working: Working,
): FakeStepPlan {
  if (token === "close") return closeStep(stepIndex, input, working);
  const [action, key] = token.split(":") as [string, FakeHostKey];
  const domain = domains[key];
  const base = {
    done: false as const,
    stepIndex,
    runStatus: working.runStatus,
    costs: { credits: 0, tokens: 0, bytes: 0, ms: 400 },
  };
  if (action === "discover") {
    working.hosts.set(key, hostState("discovered"));
    working.counters = recordHostVisited(working.counters, { firstVisitToday: true });
    return {
      ...base,
      kind: "discover",
      lastAction: `Discovered ${domain}`,
      counters: working.counters,
      host: hostWrite(key, domain, market, hostState("discovered")),
    };
  }
  const current = working.hosts.get(key);
  if (!current) throw new RangeError(`Host ${key} is missing before ${token}`);
  if (action === "probe") {
    const next = transitionHost(current, "probe_succeeded");
    working.hosts.set(key, next);
    return {
      ...base,
      kind: "probe",
      lastAction: `Probed ${domain}`,
      counters: working.counters,
      host: hostWrite(key, domain, market, next),
    };
  }
  if (action === "qualify") {
    const next = transitionHost(current, "qualified");
    working.hosts.set(key, next);
    return {
      ...base,
      kind: "qualify",
      lastAction: `Qualified ${domain}`,
      counters: working.counters,
      host: hostWrite(key, domain, market, next),
    };
  }
  if (action === "register") {
    const next = transitionHost(current, "registration_started");
    working.hosts.set(key, next);
    return {
      ...base,
      kind: "register",
      lastAction: `Registering on ${domain}`,
      counters: working.counters,
      host: hostWrite(key, domain, market, next),
      accountUsername: `member-${key}`,
    };
  }
  if (action === "captcha") {
    const decision = decideHelperAction({
      buttonText: HELPER_LABELS.placed,
      humanCheckbox: "checked",
      imageGridOpen: false,
      pageMessages: [],
      nowMs: input.now.getTime(),
      tries: 0,
    });
    if (decision.outcome !== "placed_submitted") {
      throw new Error(`Expected a placed captcha, got ${decision.outcome ?? decision.action}`);
    }
    return {
      ...base,
      kind: "captcha",
      lastAction: `Captcha placed on ${domain}`,
      counters: working.counters,
      host: hostWrite(key, domain, market, current),
      captcha: {
        type: "recaptcha_v2",
        door: "page_helper",
        outcome: "placed_submitted",
        buttonTextObserved: HELPER_LABELS.placed,
        humanCheckboxState: "checked",
        creditsCharged: 10,
        attempt: 1,
        helperVersion: HELPER_VERSION,
      },
      costs: { credits: 10, tokens: 0, bytes: 0, ms: 900 },
    };
  }
  if (action === "activate") {
    const next = transitionHost(current, "account_active");
    working.hosts.set(key, next);
    working.counters = recordRegistration(working.counters);
    return {
      ...base,
      kind: "activate",
      lastAction: `Account warming on ${domain}`,
      counters: working.counters,
      host: hostWrite(key, domain, market, next),
    };
  }
  if (action === "ready") {
    const next = transitionHost(current, "warmup_completed");
    working.hosts.set(key, next);
    return {
      ...base,
      kind: "ready",
      lastAction: `Warm-up done on ${domain}`,
      counters: working.counters,
      host: hostWrite(key, domain, market, next),
    };
  }
  if (action === "post") {
    working.placement = transitionPlacement("pending", "pending");
    return {
      ...base,
      kind: "post",
      lastAction: `Posted on ${domain}`,
      counters: working.counters,
      host: hostWrite(key, domain, market, current),
      placement: {
        status: "pending",
        counted: false,
        rel: [],
        threadUrl: `https://${domain}/viewtopic.php?t=1`,
        postUrl: `https://${domain}/viewtopic.php?p=2#p2`,
        targetUrl: input.targetUrl,
        anchorText: input.brandName,
        indexable: true,
      },
      draftBody: "Eine feste Uhrzeit hilft oft. Das hier erklärt es ganz gut.",
    };
  }
  if (action === "verify") {
    const outcome = evaluateVerification({
      hrefFound: true,
      rel: ["ugc"],
      postPresent: true,
      threadPresent: true,
      noindex: false,
    });
    working.placement = transitionPlacement(working.placement ?? "pending", outcome.status);
    const counted = shouldCount(outcome, input.countNofollow);
    if (counted) {
      const next = transitionHost(current, "link_counted");
      working.hosts.set(key, next);
      working.counters = recordCountedLive(working.counters);
      return {
        ...base,
        kind: "verify",
        lastAction: `Verified link on ${domain}`,
        counters: working.counters,
        host: hostWrite(key, domain, market, next),
        placement: {
          status: outcome.status,
          counted,
          rel: outcome.rel,
          threadUrl: `https://${domain}/viewtopic.php?t=1`,
          postUrl: `https://${domain}/viewtopic.php?p=2#p2`,
          targetUrl: input.targetUrl,
          anchorText: input.brandName,
          indexable: outcome.indexable,
        },
      };
    }
    return {
      ...base,
      kind: "verify",
      lastAction: `Verified link on ${domain}`,
      counters: working.counters,
      host: hostWrite(key, domain, market, current),
      placement: {
        status: outcome.status,
        counted: false,
        rel: outcome.rel,
        threadUrl: `https://${domain}/viewtopic.php?t=1`,
        postUrl: `https://${domain}/viewtopic.php?p=2#p2`,
        targetUrl: input.targetUrl,
        anchorText: input.brandName,
        indexable: outcome.indexable,
      },
    };
  }
  if (action === "park") {
    const decision = decideHelperAction({
      buttonText: null,
      humanCheckbox: "none",
      imageGridOpen: false,
      pageMessages: [],
      nowMs: input.now.getTime(),
      tries: 1,
      memory: { reloaded: true },
    });
    if (decision.hostEvent !== "parked" || decision.outcome !== "operator_parked") {
      throw new Error(`Expected an operator park, got ${decision.action}`);
    }
    const next = transitionHost(current, "parked");
    working.hosts.set(key, next);
    return {
      ...base,
      kind: "park",
      lastAction: `Parked ${domain} for an operator`,
      counters: working.counters,
      host: hostWrite(key, domain, market, next),
      captcha: {
        type: "recaptcha_v2",
        door: "operator",
        outcome: "operator_parked",
        buttonTextObserved: null,
        humanCheckboxState: "none",
        creditsCharged: 0,
        attempt: 2,
        helperVersion: HELPER_VERSION,
      },
      ticket: { reason: "captcha_unsolved" },
      costs: { credits: 0, tokens: 0, bytes: 0, ms: 700 },
    };
  }
  throw new Error(`Unknown fake step ${token}`);
}

function closeStep(
  stepIndex: number,
  input: Omit<FakeScenarioInput, "stepIndex">,
  working: Working,
): FakeStepPlan {
  if (isRunTerminal(working.runStatus)) throw new Error("Run is already terminal");
  const whyNot = buildWhyNot({
    hostCounts: hostCounts(working),
    modelErrors: 0,
    modelRefusals: 0,
    captchaBalance: 2400,
    lowBalanceCredits: input.lowBalanceCredits ?? 500,
    proxy: "ok",
  });
  const next = transitionRun(
    working.runStatus,
    closingRunStatus(working.counters, {
      livePerDay: input.quotas.livePerDay,
      liveWeekCap: input.quotas.liveWeekCap,
    }),
  );
  working.runStatus = next;
  return {
    done: false as const,
    stepIndex,
    kind: "close",
    lastAction: next === "succeeded" ? "LIVE quota met" : "Day closed",
    runStatus: next,
    counters: working.counters,
    whyNot,
    costs: { credits: 0, tokens: 0, bytes: 0, ms: 50 },
  };
}

function hostCounts(working: Working): Partial<Record<LbHostStatus, number>> {
  const counts: Partial<Record<LbHostStatus, number>> = {};
  for (const state of working.hosts.values()) {
    counts[state.status] = (counts[state.status] ?? 0) + 1;
  }
  return counts;
}

function hostWrite(
  key: FakeHostKey,
  domain: string,
  market: LbMarket,
  state: HostState,
): FakeHostWrite {
  return {
    key,
    domain,
    platform: PLATFORMS[key],
    country: market.country,
    language: market.language,
    status: state.status,
    parkedFrom: state.parkedFrom,
    homepageUrl: `https://${domain}/`,
  };
}

function hashTag(seed: string): string {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(6, "0").slice(0, 6);
}
