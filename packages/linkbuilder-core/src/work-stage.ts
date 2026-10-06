import { IllegalTransition } from "./errors.js";
import { type HostEvent, type HostState, type HostStatus, transitionHost } from "./host-state.js";

/** The order a run follows after Start. Register cannot precede research. */
export const WORK_STAGES = ["research", "register", "warmup", "place", "verify"] as const;
export type WorkStage = (typeof WORK_STAGES)[number];

/** Helpful posts with no link before the first placement. He can set this to 0. */
export const DEFAULT_MIN_POSTS_BEFORE_LINK = 3;

export const WORK_STAGE_LABELS: Record<WorkStage, string> = {
  research: "Research",
  register: "Register",
  warmup: "Warmup",
  place: "Place",
  verify: "Verify",
};

export interface WorkState {
  stage: WorkStage;
  researchComplete: boolean;
  registered: boolean;
  warmupPosts: number;
  placed: boolean;
}

export type WorkEvent = "research" | "research_complete" | "register" | "warmup_post" | "place" | "verify";

export function initialWorkState(): WorkState {
  return {
    stage: "research",
    researchComplete: false,
    registered: false,
    warmupPosts: 0,
    placed: false,
  };
}

function minPosts(value: number | undefined): number {
  return value ?? DEFAULT_MIN_POSTS_BEFORE_LINK;
}

/**
 * Moves the run one step. Register before research is illegal.
 * A link on the first post is illegal while warmup is on (`minPostsBeforeLink` > 0).
 */
export function transitionWork(
  current: WorkState,
  event: WorkEvent,
  options?: { minPostsBeforeLink?: number },
): WorkState {
  const min = minPosts(options?.minPostsBeforeLink);
  if (event === "research") {
    if (current.stage !== "research") throw new IllegalTransition("work", current.stage, event);
    return current;
  }
  if (event === "research_complete") {
    if (current.stage !== "research") throw new IllegalTransition("work", current.stage, event);
    return { ...current, researchComplete: true };
  }
  if (event === "register") {
    if (!current.researchComplete) throw new IllegalTransition("work", "research", event);
    if (current.stage !== "research") throw new IllegalTransition("work", current.stage, event);
    return { ...current, stage: min === 0 ? "place" : "warmup", registered: true };
  }
  if (event === "warmup_post") {
    if (!current.registered || current.placed) throw new IllegalTransition("work", current.stage, event);
    const warmupPosts = current.warmupPosts + 1;
    const ready = min === 0 || warmupPosts >= min;
    return { ...current, warmupPosts, stage: ready ? "place" : "warmup" };
  }
  if (event === "place") {
    if (min > 0 && current.warmupPosts < min) {
      throw new IllegalTransition("work", current.stage, event);
    }
    if (!current.registered || current.stage !== "place") {
      throw new IllegalTransition("work", current.stage, event);
    }
    return { ...current, stage: "verify", placed: true };
  }
  if (!current.placed || current.stage !== "verify") {
    throw new IllegalTransition("work", current.stage, event);
  }
  return { ...current, stage: "verify" };
}

/** Host registration is illegal until research has chosen the host. */
export function transitionHostAfterResearch(
  current: HostState | HostStatus,
  event: HostEvent,
  researchComplete: boolean,
): HostState {
  if (event === "registration_started" && !researchComplete) {
    const from = typeof current === "string" ? current : current.status;
    throw new IllegalTransition("host", from, "register");
  }
  return transitionHost(current, event);
}

/** A counted link is illegal on the first posts while warmup is on. */
export function transitionHostForLink(
  current: HostState | HostStatus,
  event: HostEvent,
  facts: { warmupPosts: number; minPostsBeforeLink?: number },
): HostState {
  const min = minPosts(facts.minPostsBeforeLink);
  if (event === "link_counted" && min > 0 && facts.warmupPosts < min) {
    const from = typeof current === "string" ? current : current.status;
    throw new IllegalTransition("host", from, "place");
  }
  return transitionHost(current, event);
}

const KIND_STAGE: Record<string, WorkStage> = {
  research: "research",
  discover: "research",
  probe: "research",
  qualify: "research",
  select_host: "research",
  register: "register",
  captcha: "register",
  cookie_wall: "register",
  activate: "warmup",
  ready: "warmup",
  warmup: "warmup",
  warmup_post: "warmup",
  post: "place",
  verify: "verify",
};

/** Visible stage for the dashboard. An open run with no later step is research. */
export function stageFromActivity(input: {
  runStatus: string | null;
  lastAction: string | null;
  stepKinds?: readonly string[];
}): WorkStage {
  const action = (input.lastAction ?? "").toLowerCase();
  const latest = [...(input.stepKinds ?? [])]
    .reverse()
    .map((kind) => KIND_STAGE[kind])
    .find((stage): stage is WorkStage => stage !== undefined);
  const open =
    input.runStatus === "running" ||
    input.runStatus === "queued" ||
    input.runStatus === "overtime" ||
    input.runStatus === "paused";
  if (open && (action.includes("research") || !latest || latest === "research")) return "research";
  if (open && latest && !action.includes("research")) return latest;
  if (action.includes("research")) return "research";
  return latest ?? "research";
}
