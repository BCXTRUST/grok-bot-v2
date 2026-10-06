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
