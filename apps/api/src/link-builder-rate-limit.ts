/** Fixed window of request timestamps for one workspace. In-process only; no Redis. */
export class WorkspaceRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(workspaceId: string): { ok: true } | { ok: false; retryAfterMs: number } {
    const at = this.now();
    const recent = (this.hits.get(workspaceId) ?? []).filter((ts) => at - ts < this.windowMs);
    if (recent.length >= this.limit) {
      const oldest = recent[0] ?? at;
      this.hits.set(workspaceId, recent);
      return { ok: false, retryAfterMs: Math.max(1, this.windowMs - (at - oldest)) };
    }
    recent.push(at);
    this.hits.set(workspaceId, recent);
    return { ok: true };
  }
}

/** Link-builder RPC budget for one API process. */
export const LINK_BUILDER_RATE_LIMIT = 120;
export const LINK_BUILDER_RATE_WINDOW_MS = 60_000;

/**
 * Dashboard reads use their own window. The same 120/60s cap still applies,
 * but status traffic cannot spend the budget that opens the project list.
 */
export const LINK_BUILDER_POLL_RATE_LIMIT = LINK_BUILDER_RATE_LIMIT;

const LINK_BUILDER_RPC_MARKER = "/linkBuilder/";

/** Reads the live dashboard repeats. Opening the project list is not one of these. */
const POLL_PROCEDURES = new Set([
  "projects/get",
  "projects/status",
  "projects/screen",
  "hosts/list",
  "placements/list",
  "runs/list",
  "runs/steps",
  "threads/list",
  "drafts/list",
  "operator/tickets",
  "proxyLeases/list",
  "subscribe",
]);

export type LinkBuilderRateBucket = "poll" | "interactive";

/**
 * Document navigations such as `/link-builder` are not RPC and are not counted.
 * `projects/list` stays on the interactive window.
 */
export function linkBuilderRpcBucket(pathname: string): LinkBuilderRateBucket | null {
  const index = pathname.indexOf(LINK_BUILDER_RPC_MARKER);
  if (index < 0) return null;
  const procedure = pathname.slice(index + LINK_BUILDER_RPC_MARKER.length).replace(/\/+$/, "");
  if (!procedure) return "interactive";
  return POLL_PROCEDURES.has(procedure) ? "poll" : "interactive";
}

export function takeLinkBuilderRequest(
  limiters: { poll: WorkspaceRateLimiter; interactive: WorkspaceRateLimiter },
  input: { pathname: string; workspaceId: string },
):
  | { ok: true; bucket: LinkBuilderRateBucket | null }
  | { ok: false; bucket: LinkBuilderRateBucket; retryAfterMs: number } {
  const bucket = linkBuilderRpcBucket(input.pathname);
  if (!bucket) return { ok: true, bucket };
  const decision = limiters[bucket].take(input.workspaceId);
  if (!decision.ok) return { ok: false, bucket, retryAfterMs: decision.retryAfterMs };
  return { ok: true, bucket };
}
