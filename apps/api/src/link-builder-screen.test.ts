import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import {
  openProjectComputerScreen,
  type ProjectScreenDeps,
  publicScreenError,
  reusableScreenUrl,
} from "./link-builder-screen.js";

const actor = {
  workspaceId: "workspace-1",
  userId: "user-1",
  email: "user@rakazo.test",
  isDeploymentOwner: true,
} satisfies Actor;

function computer(overrides: Record<string, unknown> = {}) {
  return {
    id: "computer-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    scope: "team",
    scopeKey: "team:workspace-1",
    homeKey: "team-workspace-1",
    homeRevision: "empty",
    kind: "e2b",
    providerRef: "sandbox-1",
    state: "running",
    screenUrl: null,
    createdAt: new Date("2026-10-06T12:00:00.000Z"),
    updatedAt: new Date("2026-10-06T12:00:00.000Z"),
    ...overrides,
  };
}

function deps(prisma: PrismaClient, sandbox: Record<string, unknown> = {}): ProjectScreenDeps {
  return {
    prisma,
    events: {} as ProjectScreenDeps["events"],
    jobs: { enqueue: vi.fn() } as unknown as ProjectScreenDeps["jobs"],
    sandbox: sandbox as ProjectScreenDeps["sandbox"],
    home: {} as ProjectScreenDeps["home"],
    dataDir: "/tmp/rakazo-link-builder-screen",
    env: {
      webOrigin: "https://app.autoseo.run",
      screenProxySecret: "test-screen-secret",
      sandboxProvider: "e2b",
    },
  };
}

describe("project computer screen", () => {
  it("reuses a fresh proxied stream and ignores raw provider urls", () => {
    const expires = Date.now() + 30 * 60_000;
    const url = `https://app.autoseo.run/novnc/remote/view/${expires}.capability/vnc.html`;
    expect(reusableScreenUrl(url)).toBe(url);
    expect(reusableScreenUrl(url, expires - 60_000)).toBeNull();
    expect(reusableScreenUrl("https://desktop.test/vnc.html?password=secret")).toBeNull();
    expect(publicScreenError(new Error("bad e2b_livekey postgres://user:pass@db/railway"))).toBe(
      "bad e2b_redacted postgres://redacted",
    );
    expect(publicScreenError(new Error("signal: terminated"))).toBe("Could not open the computer");
  });

  it("returns the stored team screen without opening another machine", async () => {
    const expires = Date.now() + 30 * 60_000;
    const url = `https://app.autoseo.run/novnc/remote/view/${expires}.capability/vnc.html`;
    const connectScreen = vi.fn();
    const prisma = {
      lbProject: { findFirst: vi.fn(async () => ({ id: "project-1" })) },
      computer: {
        findFirst: vi.fn(async () => computer({ screenUrl: url })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      bot: { findFirst: vi.fn() },
    } as unknown as PrismaClient;
    const result = await openProjectComputerScreen(
      deps(prisma, { connectScreen, keepAlive: vi.fn() }),
      actor,
      "project-1",
    );
    expect(result).toEqual({ url, error: null });
    expect(connectScreen).not.toHaveBeenCalled();
  });

  it("boots a stopped team computer and publishes a proxied stream", async () => {
    const connectScreen = vi.fn(async () => ({
      url: "https://desktop.test/vnc.html?password=secret",
      mimeType: "text/html",
      close: async () => undefined,
    }));
    const stored: { screenUrl?: string } = {};
    const prisma = {
      lbProject: { findFirst: vi.fn(async () => ({ id: "project-1" })) },
      computer: {
        findFirst: vi.fn(async () =>
          computer({ state: "stopped", providerRef: null, screenUrl: null }),
        ),
        findUnique: vi.fn(async () => computer({ state: "running", providerRef: "sandbox-1" })),
        update: vi.fn(async ({ data }: { data: { screenUrl?: string } }) => {
          stored.screenUrl = data.screenUrl;
          return computer({ screenUrl: data.screenUrl });
        }),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      bot: { findFirst: vi.fn(async () => null) },
    } as unknown as PrismaClient;
    const boot = vi.fn(async () => ({
      id: "sandbox-1",
      botId: "team-workspace-1",
      kind: "e2b" as const,
      providerRef: "sandbox-1",
    }));
    const result = await openProjectComputerScreen(
      deps(prisma, { connectScreen, keepAlive: vi.fn() }),
      actor,
      "project-1",
      boot,
    );
    expect(boot).toHaveBeenCalledOnce();
    expect(connectScreen).toHaveBeenCalledWith(
      expect.objectContaining({ providerRef: "sandbox-1", kind: "e2b" }),
      { view: "stream", interactive: false },
      expect.objectContaining({ workspaceId: "workspace-1" }),
    );
    expect(result.error).toBeNull();
    expect(result.url).toContain("/novnc/remote/view/");
    expect(result.url).not.toContain("password=");
    expect(stored.screenUrl).toBe(result.url);
  });

  it("opens Google search for the stored topic and skips example hosts", async () => {
    const expires = Date.now() + 30 * 60_000;
    const url = `https://app.autoseo.run/novnc/remote/view/${expires}.capability/vnc.html`;
    const scripts: string[] = [];
    const prisma = {
      lbProject: {
        findFirst: vi.fn(async () => ({
          id: "project-google",
          name: "Vitaminexpress",
          brandName: "Vitaminexpress",
          topicLanes: [{ tag: "forum-abc.example" }],
          targets: [{ keywordClusters: ["brett-abc.example"] }],
        })),
      },
      computer: {
        findFirst: vi.fn(async () => computer({ screenUrl: url })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      bot: { findFirst: vi.fn() },
    } as unknown as PrismaClient;
    const result = await openProjectComputerScreen(
      deps(prisma, {
        connectScreen: vi.fn(),
        keepAlive: vi.fn(),
        execute: async function* (_ref: unknown, request: { argv: string[] }) {
          const script = request.argv.at(-1) ?? "";
          scripts.push(script);
          yield {
            type: "stdout" as const,
            data: script.includes("xdotool search") ? "1\t1\tHome\n" : "",
          };
          yield { type: "exit" as const, code: 0 };
        },
      }),
      actor,
      "project-google",
    );
    expect(result).toEqual({ url, error: null });
    const opened = scripts.find((script) => script.includes("google.com/search"));
    expect(opened).toContain("Vitaminexpress");
    expect(opened).toContain("forum");
    expect(opened).toContain("RAKAZO_DETACH_BROWSER");
    expect(opened).toContain("exec /usr/bin/google-chrome");
    expect(opened).not.toContain("nohup");
    expect(opened).not.toContain(".example");
    expect(scripts.join("\n")).not.toMatch(/register|signup|post/i);
  });

  it("leaves a Google search that is already on the computer", async () => {
    const expires = Date.now() + 30 * 60_000;
    const url = `https://app.autoseo.run/novnc/remote/view/${expires}.capability/vnc.html`;
    const scripts: string[] = [];
    const prisma = {
      lbProject: {
        findFirst: vi.fn(async () => ({
          id: "project-searching",
          name: "Vitaminexpress",
          brandName: "Vitaminexpress",
          topicLanes: [],
          targets: [],
        })),
      },
      computer: {
        findFirst: vi.fn(async () => computer({ screenUrl: url })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      bot: { findFirst: vi.fn() },
    } as unknown as PrismaClient;
    await openProjectComputerScreen(
      deps(prisma, {
        keepAlive: vi.fn(),
        execute: async function* (_ref: unknown, request: { argv: string[] }) {
          scripts.push(request.argv.at(-1) ?? "");
          yield {
            type: "stdout" as const,
            data: "9\t1\tVitaminexpress forum - Google Search\n",
          };
          yield { type: "exit" as const, code: 0 };
        },
      }),
      actor,
      "project-searching",
    );
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).not.toContain("google.com/search");
  });
});
