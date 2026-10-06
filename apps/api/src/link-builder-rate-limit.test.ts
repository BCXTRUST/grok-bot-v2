import { describe, expect, it } from "vitest";
import { WorkspaceRateLimiter } from "./link-builder-rate-limit.js";

describe("link builder rate limit", () => {
  it("limits each workspace inside the window", () => {
    let now = 1_000;
    const limiter = new WorkspaceRateLimiter(2, 1_000, () => now);
    expect(limiter.take("workspace-1").ok).toBe(true);
    expect(limiter.take("workspace-1").ok).toBe(true);
    const blocked = limiter.take("workspace-1");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(limiter.take("workspace-2").ok).toBe(true);
    now += 1_000;
    expect(limiter.take("workspace-1").ok).toBe(true);
  });
});
