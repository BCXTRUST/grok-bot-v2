import type {
  LbHostPlatform,
  LbHostStatus,
  LbMarket,
  LbParkableHostStatus,
  LbPlacementStatus,
  LbRunStatus,
  LbWhyNot,
} from "@rakazo/contracts";
import { type RunCounters, startRunCounters } from "./run-state.js";
import { initialWorkState, transitionWork } from "./work-stage.js";

/** Distinct research lines. The runner does not repeat them. */
const RESEARCH_LINES = [
  "Researching topics",
  "Reading on-topic pages",
  "Reading threads",
  "Still researching",
] as const;

/**
 * Kinds an older offline script wrote without a host or a placement.
 * The runner no longer emits them. Verify needs a placed link.
 */
const CUSTOMER_STAGE_KINDS = new Set(["lb_register", "lb_warmup", "lb_place", "lb_verify"]);

/** Research beats the offline runner may write. It does not invent hosts. */
export const CUSTOMER_RESEARCH_BEATS = RESEARCH_LINES.length;

/** Offline customer runs research, then hold. They do not invent hosts, accounts, placements, or a verify check. */

export function isCustomerStageKind(kind: string): boolean {
  return CUSTOMER_STAGE_KINDS.has(kind);
}

export type FakeHostKey = "a" | "b" | "c";

export interface FakeScenarioInput {
  seed: string;
  /** Zero-based index of the step to plan. Earlier steps are replayed so transitions stay legal. */
  stepIndex: number;
  /** Research beats already stored. Old fixture steps do not count. */
  researchBeats?: number;
  /** Stage changes already stored (`lb_register` and the steps after it). */
  stageBeats?: number;
  /** Counters to keep. Research does not invent registrations or LIVE links. */
  counters?: RunCounters;
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

export type FakePlan = FakeStepPlan | { done: true } | { hold: true };

export function fakeScriptLength(): number {
  return CUSTOMER_RESEARCH_BEATS;
}

const FIXTURE_HOST_DOMAIN = /^(?:forum|fragen|brett)-[a-z0-9]+\.example$/;

/** Boards the offline runner invents. A customer project does not own these hosts. */
export function isFixtureHostDomain(domain: string): boolean {
  return FIXTURE_HOST_DOMAIN.test(domain.trim().toLowerCase());
}

export function fakeDomains(seed: string): Record<FakeHostKey, string> {
  const tag = hashTag(seed);
  return {
    a: `forum-${tag}.example`,
    b: `fragen-${tag}.example`,
    c: `brett-${tag}.example`,
  };
}

/** Plans one research beat. After that the run holds in research. No host, account, placement, or verify step is invented. */
export function planFakeStep(input: FakeScenarioInput): FakePlan {
  if (!Number.isInteger(input.stepIndex) || input.stepIndex < 0) {
    throw new RangeError("stepIndex must be a non-negative integer");
  }
  const beat = input.researchBeats ?? input.stepIndex;
  const stageBeat = input.stageBeats ?? 0;
  if (!Number.isInteger(beat) || beat < 0) {
    throw new RangeError("researchBeats must be a non-negative integer");
  }
  if (!Number.isInteger(stageBeat) || stageBeat < 0) {
    throw new RangeError("stageBeats must be a non-negative integer");
  }
  const counters = input.counters ?? startRunCounters(0);
  if (beat < CUSTOMER_RESEARCH_BEATS) {
    transitionWork(initialWorkState(), "research");
    return {
      done: false,
      stepIndex: input.stepIndex,
      kind: "research",
      lastAction: RESEARCH_LINES[beat]!,
      runStatus: "running",
      counters,
      costs: { credits: 1, tokens: 0, bytes: 0, ms: 400 },
    };
  }
  return { hold: true };
}

/** Replays research. The run then holds. No host is written. */
export function replayFakeScript(input: Omit<FakeScenarioInput, "stepIndex">): FakeStepPlan[] {
  const steps: FakeStepPlan[] = [];
  let researchBeats = 0;
  for (let index = 0; index < fakeScriptLength(); index += 1) {
    const plan = planFakeStep({ ...input, stepIndex: index, researchBeats, stageBeats: 0 });
    if (!("kind" in plan)) break;
    steps.push(plan);
    researchBeats += 1;
  }
  return steps;
}

function hashTag(seed: string): string {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(6, "0").slice(0, 6);
}
