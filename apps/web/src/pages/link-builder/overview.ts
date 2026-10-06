import type { LbOperatorTicketView, LbRunStepView, LbWhyNot } from "@rakazo/contracts";
import {
  foundForumLine,
  foundThreadLine,
  isCannedResearchLine,
  isStaleResearchLine,
  mentionsExampleDomain,
  mentionsFixtureHost,
  RESEARCH_OPENING,
  researchResultName,
  searchedGoogleLine,
  showHostToCustomer,
  stageFromActivity,
  type WorkStage,
} from "@rakazo/linkbuilder-core";

export const OVERVIEW_COUNTS = {
  newToday: "New accounts per day",
  liveToday: "Live links today",
} as const;

export type OverviewIntent = "working" | "paused" | "stopped" | null;

export type OverviewFeedStatus = "working" | "done" | "blocked";

export interface OverviewFeedItem {
  id: string;
  label: string;
  status: OverviewFeedStatus;
  at: string | null;
}

export type OverviewFrame = { kind: "url"; url: string } | { kind: "artifact"; artifactId: string };

const BLOCKED_KINDS = new Set(["coherence_refused", "edge_block"]);

/** Stage kinds the offline runner used to print without a host or a placed link. */
const OFFLINE_STAGE_KINDS = new Set([
  "lb_register",
  "lb_warmup",
  "lb_place",
  "lb_verify",
  "verify",
]);

/** Exact labels from that script. Real work uses longer lines ("Registered", "Account warmed up"). */
const OFFLINE_STAGE_LABEL = /^(register|warmup|place|verify)$/i;

/** A placed link the customer can see. Fixture boards do not count. */
export function overviewHasPlacement(domains: readonly string[], slug?: string | null): boolean {
  return domains.some((domain) => showHostToCustomer(domain, slug));
}

function offlineStage(kind: string, label: string): boolean {
  return OFFLINE_STAGE_KINDS.has(kind) || OFFLINE_STAGE_LABEL.test(label.trim());
}

/** Old offline runs wrote a captcha park and a met quota. Customer projects no longer show that. */
function leftoverHandoff(label: string): boolean {
  return (
    /live quota met/i.test(label) ||
    /captcha/i.test(label) ||
    (/parked/i.test(label) && /operator/i.test(label))
  );
}

/** Start paints a working screen before the server answers. Pause and Stop paint calm. */
export function overviewWorking(input: {
  activity: string | null;
  intent: OverviewIntent;
}): boolean {
  if (input.intent === "working") return true;
  if (input.intent === "paused" || input.intent === "stopped") return false;
  return input.activity === "running" || input.activity === "overtime";
}

export function overviewPill(input: {
  activityLabel: string | null;
  intent: OverviewIntent;
}): string | null {
  if (input.intent === "working") return "running";
  if (input.intent === "paused") return "paused";
  if (input.intent === "stopped") return "stopped";
  return input.activityLabel;
}

/** Non-zero blockers only. An all-zero report, including "proxy ok", stays off the screen. */
export function whyNotFeedLines(whyNot: LbWhyNot | null | undefined): string[] {
  if (!whyNot) return [];
  const lines: string[] = [];
  if (whyNot.parked > 0) lines.push(`Parked ${whyNot.parked}`);
  if (whyNot.spamBlocked > 0) lines.push(`Spam blocked ${whyNot.spamBlocked}`);
  if (whyNot.unsupportedCaptcha > 0) lines.push(`Unsupported captcha ${whyNot.unsupportedCaptcha}`);
  if (whyNot.pendingEmail > 0) lines.push(`Pending email ${whyNot.pendingEmail}`);
  if (whyNot.pendingAdmin > 0) lines.push(`Pending admin ${whyNot.pendingAdmin}`);
  if (whyNot.modelErrors > 0) lines.push(`Model errors ${whyNot.modelErrors}`);
  if (whyNot.modelRefusals > 0) lines.push(`Model refusals ${whyNot.modelRefusals}`);
  if (whyNot.proxy === "degraded") lines.push("Proxy degraded");
  if (whyNot.reasons.includes("captcha_balance_low")) lines.push("Captcha balance is low");
  if (whyNot.reasons.includes("warmup_pending")) lines.push("Warm-up still running");
  if (whyNot.reasons.includes("week_cap_reached")) lines.push("Live links this week are full");
  if (whyNot.reasons.includes("new_quota_reached")) lines.push("New links today are full");
  return lines;
}

export function overviewFeed(input: {
  steps: LbRunStepView[];
  lastEvent: string | null;
  working: boolean;
  blockers: string[];
  /** Customer projects drop leftover `*.example` lines. The Nordlicht demo keeps its own. */
  hideExampleCopy?: boolean;
  /** Verify runs only after a link is placed. Without one, those lines stay off the feed. */
  hasPlacement?: boolean;
  /** Real forum. A found line is omitted when this is blank or an example host. */
  forumName?: string | null;
  /** Real thread title. A found line is omitted when this is blank or an example host. */
  threadName?: string | null;
  /** Recorded search queries. Zero means a Google line has not happened. */
  searches?: number;
  /** Problem query that was actually opened. Omitted when no search was counted. */
  searchQuery?: string | null;
}): OverviewFeedItem[] {
  const hasPlacement = input.hasPlacement === true;
  let keptOpening = false;
  const steps = [...input.steps]
    .sort((a, b) => a.stepIndex - b.stepIndex)
    .filter((step) => {
      const label = step.lastAction?.trim() || step.kind;
      if (isStaleResearchLine(label)) return false;
      if (isCannedResearchLine(label)) return false;
      if (input.searches === 0 && claimsGoogleSearch(label)) return false;
      if (input.searchQuery && /^opened google search$/i.test(label)) return false;
      if (label === RESEARCH_OPENING) {
        if (keptOpening) return false;
        keptOpening = true;
      }
      if (!visibleFoundLine(label, input.forumName, input.threadName)) return false;
      if (!hasPlacement && offlineStage(step.kind, label)) return false;
      if (mentionsFixtureHost(label)) return false;
      if (input.hideExampleCopy && (mentionsExampleDomain(label) || leftoverHandoff(label))) {
        return false;
      }
      return true;
    });
  const items: OverviewFeedItem[] = [];
  for (const step of steps) {
    const label = step.lastAction?.trim() || step.kind;
    const at = step.createdAt;
    const previous = items.at(-1);
    const duplicate =
      previous !== undefined && previous.label === label && sameMoment(previous.at, at);
    if (duplicate) continue;
    items.push({
      id: step.id,
      label,
      status: step.error || BLOCKED_KINDS.has(step.kind) ? "blocked" : "done",
      at,
    });
  }
  const seen = new Set(items.map((item) => item.label));
  const event = input.lastEvent?.trim() ?? "";
  const researchAlready = items.some((item) => /research/i.test(item.label));
  const hiddenEvent =
    isStaleResearchLine(event) ||
    isCannedResearchLine(event) ||
    (input.searches === 0 && claimsGoogleSearch(event)) ||
    Boolean(input.searchQuery && /^opened google search$/i.test(event)) ||
    !visibleFoundLine(event, input.forumName, input.threadName) ||
    mentionsFixtureHost(event) ||
    (!hasPlacement && offlineStage("", event)) ||
    (event.toLowerCase() === "researching" && researchAlready) ||
    (input.hideExampleCopy && (mentionsExampleDomain(event) || leftoverHandoff(event)));
  if (event && !seen.has(event) && !hiddenEvent) {
    items.push({ id: `event:${event}`, label: event, status: "done", at: null });
  }
  placeFoundLines(items, input.forumName, input.threadName);
  const query = input.searchQuery?.trim() ?? "";
  if ((input.searches ?? 0) > 0 && query) {
    const line = searchedGoogleLine(query);
    if (!items.some((item) => item.label === line)) {
      items.unshift({ id: `search:${query}`, label: line, status: "done", at: null });
    }
  }
  if (input.working) {
    let open = -1;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (!item || item.status === "blocked" || item.id.startsWith("found:")) continue;
      open = index;
      break;
    }
    if (open < 0) {
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (items[index]?.status !== "blocked") {
          open = index;
          break;
        }
      }
    }
    const current = open >= 0 ? items[open] : undefined;
    if (current) {
      current.status = "working";
      if (open < items.length - 1) {
        items.splice(open, 1);
        items.push(current);
      }
    }
  }
  for (const line of input.blockers) {
    items.push({ id: `blocker:${line}`, label: line, status: "blocked", at: null });
  }
  return items;
}

export function overviewAction(items: OverviewFeedItem[], working: boolean): string {
  if (working) {
    const current = [...items].reverse().find((item) => item.status === "working");
    return current?.label || "Working";
  }
  const last = [...items].reverse().find((item) => item.status !== "blocked");
  return last?.label ?? "";
}

/** A sentence that says Google was searched. Hidden while the search count is still zero. */
function claimsGoogleSearch(label: string): boolean {
  return /google/i.test(label) && /(check|search|opened|opening)/i.test(label);
}

/** A stored "Found …" line stays only when that forum or thread is on the project. */
function visibleFoundLine(
  label: string,
  forumName: string | null | undefined,
  threadName: string | null | undefined,
): boolean {
  if (!label.startsWith("Found ")) return true;
  if (label.startsWith("Found forum ")) {
    return researchResultName(label.slice("Found forum ".length)) === researchResultName(forumName);
  }
  return researchResultName(label.slice("Found ".length)) === researchResultName(threadName);
}

function researchRank(label: string): number | null {
  if (label === RESEARCH_OPENING) return 0;
  if (label.startsWith("Found forum ")) return 1;
  if (label === "Looking for threads" || label.startsWith("Looking for threads on ")) return 2;
  if (label.startsWith("Found ")) return 3;
  if (label === "Continuing") return 4;
  return null;
}

/** Puts a real find in script order. Example hosts never become a line. */
function placeFoundLines(
  items: OverviewFeedItem[],
  forumName: string | null | undefined,
  threadName: string | null | undefined,
) {
  const forum = researchResultName(forumName);
  if (forum) {
    for (const item of items) {
      if (item.label === "Looking for threads") item.label = `Looking for threads on ${forum}`;
    }
  }
  insertRanked(items, foundForumLine(forum));
  insertRanked(items, foundThreadLine(threadName));
}

function insertRanked(items: OverviewFeedItem[], line: string | null) {
  if (!line || items.some((item) => item.label === line)) return;
  const rank = researchRank(line);
  if (rank === null) return;
  let index = items.length;
  for (let cursor = 0; cursor < items.length; cursor += 1) {
    const existing = researchRank(items[cursor]?.label ?? "");
    if (existing !== null && existing > rank) {
      index = cursor;
      break;
    }
  }
  items.splice(index, 0, { id: `found:${line}`, label: line, status: "done", at: null });
}

/** A stuck repeat in the same minute is one moment. A new sentence still lands. */
function sameMoment(left: string | null, right: string | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const a = new Date(left);
  const b = new Date(right);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate() &&
    a.getHours() === b.getHours() &&
    a.getMinutes() === b.getMinutes()
  );
}

function liveScreen(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/novnc/") || url.startsWith("https://")) return url;
  return null;
}

/**
 * Stage shown on the rail. Verify is only current when a placement exists to check.
 * Offline register, warmup, and place labels are the same: they are not work.
 */
export function overviewStage(input: {
  runStatus: string | null;
  lastAction: string | null;
  stepKinds?: readonly string[];
  hasPlacement: boolean;
}): WorkStage {
  const kinds = (input.stepKinds ?? []).filter(
    (kind) => input.hasPlacement || !OFFLINE_STAGE_KINDS.has(kind),
  );
  const action = input.lastAction?.trim() ?? "";
  const lastAction =
    !input.hasPlacement && OFFLINE_STAGE_LABEL.test(action) ? null : input.lastAction;
  const stage = stageFromActivity({
    runStatus: input.runStatus,
    lastAction,
    stepKinds: kinds,
  });
  if (!input.hasPlacement && stage === "verify") return "research";
  return stage;
}

/** Prefer an open ticket screen, then the team computer stream, then the newest screenshot. */
export function overviewFrame(input: {
  steps: LbRunStepView[];
  tickets: LbOperatorTicketView[];
  /** Live team-computer stream (`/novnc/` or `https://`). */
  screenUrl?: string | null;
}): OverviewFrame | null {
  const open = input.tickets.find(
    (ticket) => ticket.status === "open" && liveScreen(ticket.screenUrl),
  );
  const screen = open ? liveScreen(open.screenUrl) : null;
  if (screen) return { kind: "url", url: screen };
  const computer = liveScreen(input.screenUrl);
  if (computer) return { kind: "url", url: computer };
  const steps = [...input.steps].sort((a, b) => a.stepIndex - b.stepIndex);
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const artifactId = steps[index]?.artifactIds[0];
    if (artifactId) return { kind: "artifact", artifactId };
  }
  const shot = [...input.tickets].reverse().find((ticket) => ticket.screenshotArtifactId);
  if (shot?.screenshotArtifactId)
    return { kind: "artifact", artifactId: shot.screenshotArtifactId };
  return null;
}
