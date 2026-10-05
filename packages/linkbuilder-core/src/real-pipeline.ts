import type { LbPlacementStatus, LbRunStatus } from "@rakazo/contracts";
import { type HostState, isHostTerminal } from "./host-state.js";
import { isRunTerminal } from "./run-state.js";

/**
 * Step kinds of the browser-driven worker (plan section 6.3 to 6.5). Each executed step performs
 * at most one typed transition and is persisted as one `RunStep`.
 */
export const REAL_STEP_KINDS = [
  "select_host",
  "open_session",
  "helper_connected",
  "cookie_wall",
  "register",
  "captcha",
  "email_verify",
  "warmup",
  "post",
  "verify",
  "close",
] as const;
export type RealStepKind = (typeof REAL_STEP_KINDS)[number];

/** Steps that drive the persona browser and therefore need an open session on the host. */
export const BROWSER_STEPS: ReadonlySet<RealStepKind> = new Set([
  "cookie_wall",
  "register",
  "captcha",
  "email_verify",
  "post",
]);

export interface RealSessionFacts {
  /** Host the open persona session is pointed at; null when no session is open. */
  hostId: string | null;
  /** The Page Helper version was read and matches the pinned build. */
  helperConnected: boolean;
  cookieChecked: boolean;
  /** The register form is filled and waits for its captcha and submit. */
  registerFormReady: boolean;
}

export interface RealPlanInput {
  runStatus: LbRunStatus;
  liveMet: boolean;
  host: (HostState & { id: string }) | null;
  session: RealSessionFacts;
  warmupMet: boolean;
  placement: { status: LbPlacementStatus; counted: boolean } | null;
}

export type RealPlan = { kind: RealStepKind } | { kind: "done" } | { kind: "wait"; reason: string };

function needsHost(host: RealPlanInput["host"]): boolean {
  if (!host) return true;
  if (host.status === "parked_operator" || host.status === "pending_admin") return true;
  return isHostTerminal(host.status) || host.status === "discovered" || host.status === "probed";
}

/** The next step for a run. Pure; the worker re-reads page and database state before acting. */
export function planRealStep(input: RealPlanInput): RealPlan {
  if (isRunTerminal(input.runStatus)) return { kind: "done" };
  if (input.runStatus === "paused" || input.runStatus === "queued") {
    return { kind: "wait", reason: input.runStatus };
  }
  if (input.liveMet) return { kind: "close" };
  const host = input.host;
  if (!host || needsHost(host)) return { kind: "select_host" };

  if (host.status === "ready" && input.placement) {
    if (input.placement.status === "pending") return { kind: "verify" };
    return { kind: "select_host" };
  }
  if (host.status === "warming") {
    return input.warmupMet ? { kind: "warmup" } : { kind: "select_host" };
  }

  const next: RealStepKind =
    host.status === "qualified"
      ? input.session.cookieChecked && input.session.hostId === host.id
        ? "register"
        : "cookie_wall"
      : host.status === "registering"
        ? input.session.registerFormReady
          ? "captcha"
          : "register"
        : host.status === "pending_email"
          ? "email_verify"
          : "post";
  if (BROWSER_STEPS.has(next) && input.session.hostId !== host.id) return { kind: "open_session" };
  if (BROWSER_STEPS.has(next) && !input.session.helperConnected)
    return { kind: "helper_connected" };
  return { kind: next };
}

/** Warm-up gate (plan section 6.3 step 8): enough link-free posts and an old enough account. */
export function isWarmupMet(input: {
  postCount: number;
  accountCreatedAt: Date;
  now: Date;
  minPostsBeforeLink: number;
  minAccountAgeHours: number;
}): boolean {
  const ageHours = (input.now.getTime() - input.accountCreatedAt.getTime()) / 3_600_000;
  return input.postCount >= input.minPostsBeforeLink && ageHours >= input.minAccountAgeHours;
}

/** Host statuses the worker may pick up, best first: finish what is closest to a LIVE link. */
export const WORKABLE_HOST_ORDER = [
  "ready",
  "warming",
  "pending_email",
  "registering",
  "qualified",
] as const;
