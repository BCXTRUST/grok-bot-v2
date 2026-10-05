import {
  type LbHostStatus,
  type LbWhyNot,
  type LbWhyNotReason,
  LbWhyNotReasonSchema,
  LbWhyNotSchema,
} from "@rakazo/contracts";
import { assertCount } from "./errors.js";

export interface FunnelQuotas {
  newPerDay: number;
  livePerDay: number;
  liveWeekCap?: number;
}

export interface FunnelCounts {
  liveToday: number;
  newToday: number;
  liveWeek: number;
  ready: number;
  warming: number;
  pendingEmail: number;
  qualified: number;
}

export interface FunnelWarmup {
  minPostsBeforeLink: number;
  minAccountAgeHours: number;
}

export interface DailyNeed {
  /** LIVE links still wanted today after the daily quota and the weekly cap. */
  liveRemainingToday: number;
  /** Link replies to attempt now on `ready` accounts. */
  linkRepliesToAttempt: number;
  /** New registrations to start now. */
  registrationsToStart: number;
  /** Accounts the warm-up pipeline should hold so future days can meet `livePerDay`. */
  pipelineTarget: number;
  /** Whole days a new registration needs before it can carry a link. */
  leadDays: number;
  blockers: LbWhyNotReason[];
}

const REASON_ORDER = LbWhyNotReasonSchema.options;

function ordered(reasons: Iterable<LbWhyNotReason>): LbWhyNotReason[] {
  const set = new Set(reasons);
  return REASON_ORDER.filter((reason) => set.has(reason));
}

export function computeDailyNeed(input: {
  quotas: FunnelQuotas;
  counts: FunnelCounts;
  warmup: FunnelWarmup;
}): DailyNeed {
  const { quotas, counts, warmup } = input;
  for (const [name, value] of Object.entries({ ...counts, ...warmup })) assertCount(name, value);
  assertCount("newPerDay", quotas.newPerDay);
  assertCount("livePerDay", quotas.livePerDay);
  if (quotas.liveWeekCap !== undefined) assertCount("liveWeekCap", quotas.liveWeekCap);

  const dayRemaining = Math.max(0, quotas.livePerDay - counts.liveToday);
  const weekRemaining =
    quotas.liveWeekCap === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, quotas.liveWeekCap - counts.liveWeek);
  const liveRemainingToday = Math.min(dayRemaining, weekRemaining);
  const linkRepliesToAttempt = Math.min(liveRemainingToday, counts.ready);
  const shortfallToday = liveRemainingToday - linkRepliesToAttempt;

  const leadDays = Math.ceil(warmup.minAccountAgeHours / 24);
  // With no age gate a registration can still serve today, so today's shortfall joins the target.
  const pipelineTarget =
    quotas.livePerDay * Math.max(1, leadDays) + (leadDays === 0 ? shortfallToday : 0);
  const inPipeline = counts.warming + counts.pendingEmail + (counts.ready - linkRepliesToAttempt);
  const wanted = Math.max(0, pipelineTarget - inPipeline);
  const newRemaining = Math.max(0, quotas.newPerDay - counts.newToday);
  const registrationsToStart = Math.min(wanted, newRemaining, counts.qualified);

  const blockers: LbWhyNotReason[] = [];
  if (shortfallToday > 0) {
    if (counts.warming > 0) blockers.push("warmup_pending");
    if (counts.pendingEmail > 0) blockers.push("pending_email");
  }
  if (wanted > 0 && counts.qualified < Math.min(wanted, newRemaining)) {
    blockers.push("host_supply_exhausted");
  }
  if (wanted > 0 && newRemaining === 0) blockers.push("new_quota_reached");
  if (dayRemaining > 0 && weekRemaining === 0) blockers.push("week_cap_reached");

  return {
    liveRemainingToday,
    linkRepliesToAttempt,
    registrationsToStart,
    pipelineTarget,
    leadDays,
    blockers: ordered(blockers),
  };
}

export interface WhyNotInput {
  hostCounts: Partial<Record<LbHostStatus, number>>;
  modelErrors: number;
  modelRefusals: number;
  /** Last known captcha balance, or null when it could not be read. */
  captchaBalance: number | null;
  lowBalanceCredits: number;
  proxy: "ok" | "degraded";
  need?: Pick<DailyNeed, "blockers">;
}

/** The section 6.6 report written at window end when the LIVE quota was not met. */
export function buildWhyNot(input: WhyNotInput): LbWhyNot {
  const count = (status: LbHostStatus) => {
    const value = input.hostCounts[status] ?? 0;
    assertCount(status, value);
    return value;
  };
  const qualified = count("qualified");
  const ready = count("ready");
  const warming = count("warming");
  const pendingEmail = count("pending_email");
  const pendingAdmin = count("pending_admin");
  const parked = count("parked_operator");
  const spamBlocked = count("spam_blocked");
  const unsupportedCaptcha = count("unsupported_captcha");
  const inFlight = count("registering") + warming + pendingEmail + pendingAdmin + parked;

  const reasons = new Set<LbWhyNotReason>(input.need?.blockers ?? []);
  if (qualified === 0 && ready === 0 && inFlight === 0) reasons.add("host_supply_exhausted");
  if (ready === 0 && warming > 0) reasons.add("warmup_pending");
  if (pendingEmail > 0) reasons.add("pending_email");
  if (pendingAdmin > 0) reasons.add("pending_admin");
  if (parked > 0) reasons.add("operator_parked");
  if (spamBlocked > 0) reasons.add("spam_filtered");
  if (unsupportedCaptcha > 0) reasons.add("unsupported_captcha");
  if (input.captchaBalance !== null && input.captchaBalance < input.lowBalanceCredits) {
    reasons.add("captcha_balance_low");
  }
  if (input.modelErrors + input.modelRefusals > 0) reasons.add("model_errors");
  if (input.proxy === "degraded") reasons.add("proxy_degraded");

  return LbWhyNotSchema.parse({
    supply: { qualified, ready },
    parked,
    spamBlocked,
    unsupportedCaptcha,
    pendingEmail,
    pendingAdmin,
    modelErrors: input.modelErrors,
    modelRefusals: input.modelRefusals,
    captchaBalance: input.captchaBalance,
    proxy: input.proxy,
    reasons: ordered(reasons),
  });
}
