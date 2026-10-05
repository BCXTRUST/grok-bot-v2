/**
 * Cloudflare hard blocks (plan section 8). Two Chromium blocks switch the host to Camoufox
 * for one retry. Still blocked, or Camoufox not installed, and the host is dead.
 */

export interface EdgeBlockSignals {
  status?: number | null;
  body?: string | null;
  title?: string | null;
  headers?: Record<string, string | undefined> | null;
}

function header(headers: EdgeBlockSignals["headers"], name: string): string | undefined {
  if (!headers) return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && value) return value;
  }
  return undefined;
}

/** A Cloudflare challenge page, a 403 carrying `cf-ray`, or the interstitial title. */
export function isHardEdgeBlock(signals: EdgeBlockSignals): boolean {
  const body = `${signals.body ?? ""}\n${signals.title ?? ""}`;
  if (/cf-chl|cdn-cgi\/challenge|challenge-platform|just a moment/i.test(body)) return true;
  const ray = header(signals.headers, "cf-ray");
  if (signals.status === 403 && (ray || /cf-ray/i.test(body))) return true;
  return false;
}

export type EdgeDecision =
  | { action: "continue" }
  | { action: "record" }
  | { action: "retry_camoufox" }
  | { action: "dead"; reason: "edge_block" };

/**
 * `priorChromiumBlocks` counts earlier `edge_block` steps on this host while it was still
 * on Chromium. The current observation is not included.
 */
export function decideEdgeBlock(input: {
  engineHint: string | null;
  priorChromiumBlocks: number;
  blockedNow: boolean;
  camoufoxAvailable: boolean;
}): EdgeDecision {
  if (!input.blockedNow) return { action: "continue" };
  if (input.engineHint === "camoufox") return { action: "dead", reason: "edge_block" };
  if (input.priorChromiumBlocks + 1 < 2) return { action: "record" };
  if (!input.camoufoxAvailable) return { action: "dead", reason: "edge_block" };
  return { action: "retry_camoufox" };
}
