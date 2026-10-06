import { describe, expect, it } from "vitest";
import {
  linkBuilderRpcBucket,
  takeLinkBuilderRequest,
  WorkspaceRateLimiter,
} from "./link-builder-rate-limit.js";

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

  it("does not count the project-list page, and keeps list out of the poll window", () => {
    expect(linkBuilderRpcBucket("/link-builder")).toBeNull();
    expect(linkBuilderRpcBucket("/rpc/linkBuilder/projects/list")).toBe("interactive");
    expect(linkBuilderRpcBucket("/rpc/linkBuilder/projects/status")).toBe("poll");
    expect(linkBuilderRpcBucket("/rpc/linkBuilder/projects/screen")).toBe("poll");
    expect(linkBuilderRpcBucket("/rpc/linkBuilder/subscribe")).toBe("poll");
    expect(linkBuilderRpcBucket("/rpc/linkBuilder/hosts/list")).toBe("poll");
    expect(linkBuilderRpcBucket("/rpc/linkBuilder/projects/create")).toBe("interactive");

    const limiters = {
      poll: new WorkspaceRateLimiter(1, 60_000, () => 1_000),
      interactive: new WorkspaceRateLimiter(2, 60_000, () => 1_000),
    };
    expect(
      takeLinkBuilderRequest(limiters, {
        pathname: "/rpc/linkBuilder/projects/status",
        workspaceId: "workspace-1",
      }).ok,
    ).toBe(true);
    const blocked = takeLinkBuilderRequest(limiters, {
      pathname: "/rpc/linkBuilder/projects/status",
      workspaceId: "workspace-1",
    });
    expect(blocked.ok).toBe(false);
    expect(
      takeLinkBuilderRequest(limiters, {
        pathname: "/rpc/linkBuilder/projects/list",
        workspaceId: "workspace-1",
      }),
    ).toEqual({ ok: true, bucket: "interactive" });
    expect(
      takeLinkBuilderRequest(limiters, {
        pathname: "/link-builder",
        workspaceId: "workspace-1",
      }),
    ).toEqual({ ok: true, bucket: null });
  });
});
