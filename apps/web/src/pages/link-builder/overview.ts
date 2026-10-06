import type { LbOperatorTicketView, LbRunStepView, LbWhyNot } from "@rakazo/contracts";
import { mentionsExampleDomain, mentionsFixtureHost } from "@rakazo/linkbuilder-core";

export const OVERVIEW_COUNTS = {
  newToday: "New links today",
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
}): OverviewFeedItem[] {
  const steps = [...input.steps]
    .sort((a, b) => a.stepIndex - b.stepIndex)
    .filter((step) => {
      const label = step.lastAction?.trim() || step.kind;
      if (mentionsFixtureHost(label)) return false;
      if (input.hideExampleCopy && (mentionsExampleDomain(label) || leftoverHandoff(label))) {
        return false;
      }
      return true;
    });
  const items: OverviewFeedItem[] = steps.map((step) => ({
    id: step.id,
    label: step.lastAction?.trim() || step.kind,
    status: step.error || BLOCKED_KINDS.has(step.kind) ? "blocked" : "done",
    at: step.createdAt,
  }));
  const seen = new Set(items.map((item) => item.label));
  const event = input.lastEvent?.trim() ?? "";
  const hiddenEvent =
    mentionsFixtureHost(event) ||
    (input.hideExampleCopy && (mentionsExampleDomain(event) || leftoverHandoff(event)));
  if (event && !seen.has(event) && !hiddenEvent) {
    items.push({ id: `event:${event}`, label: event, status: "done", at: null });
  }
  if (input.working) {
    let open = -1;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (items[index]?.status !== "blocked") {
        open = index;
        break;
      }
    }
    const current = open >= 0 ? items[open] : undefined;
    if (current) current.status = "working";
    else items.push({ id: "researching", label: "Researching", status: "working", at: null });
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

function liveScreen(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/novnc/") || url.startsWith("https://")) return url;
  return null;
}

/** Prefer the open computer, then the newest screenshot on the run. */
export function overviewFrame(input: {
  steps: LbRunStepView[];
  tickets: LbOperatorTicketView[];
}): OverviewFrame | null {
  const open = input.tickets.find(
    (ticket) => ticket.status === "open" && liveScreen(ticket.screenUrl),
  );
  const screen = open ? liveScreen(open.screenUrl) : null;
  if (screen) return { kind: "url", url: screen };
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
