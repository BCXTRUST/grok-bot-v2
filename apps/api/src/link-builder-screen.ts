import { ORPCError } from "@orpc/server";
import type {
  AdapterContext,
  AgentHomeStore,
  JobPublisher,
  SandboxProvider,
} from "@rakazo/adapter-kit";
import {
  ComputerBusyError,
  provisionComputer,
  toComputerRef,
  touchRunningComputer,
} from "@rakazo/adapters";
import { type Actor, SandboxKind } from "@rakazo/contracts";
import { ensureComputerRecord, type PrismaClient, type ThreadEvents } from "@rakazo/db";
import { addScreenProxyCapability, shouldProxyComputerScreen } from "./screen-proxy.js";

const SCREEN_REFRESH_SLACK_MS = 5 * 60_000;
const SCREEN_CONNECT_MS = 45_000;
const SCREEN_BOOT_MS = 120_000;

export interface ProjectScreenDeps {
  prisma: PrismaClient;
  events: ThreadEvents;
  jobs: JobPublisher;
  sandbox: SandboxProvider;
  home: AgentHomeStore;
  dataDir: string;
  env: {
    webOrigin: string;
    screenProxySecret: string;
    sandboxProvider: string;
  };
}

type TeamComputer = {
  id: string;
  homeKey: string;
  kind: string;
  providerRef: string | null;
  state: string;
  screenUrl: string | null;
  scope: string;
};

/**
 * A proxied noVNC URL that still has time left. Raw provider URLs stay server-side.
 * The stream itself keeps painting; this only decides when to mint a new capability.
 */
export function reusableScreenUrl(url: string | null | undefined, now = Date.now()): string | null {
  if (!url) return null;
  let path = url;
  try {
    if (url.startsWith("https://") || url.startsWith("http://")) path = new URL(url).pathname;
  } catch {
    return null;
  }
  if (!path.startsWith("/novnc/")) return null;
  const match = path.match(/\/(?:view|control)\/(\d+)\./);
  if (!match) return null;
  const expires = Number(match[1]);
  if (!Number.isFinite(expires) || expires - now < SCREEN_REFRESH_SLACK_MS) return null;
  return url;
}

/** A sentence the dashboard can show. Strips credentials and provider secrets. */
export function publicScreenError(error: unknown): string {
  const raw =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "Could not open the computer";
  const cleaned = raw
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://redacted")
    .replace(/e2b_[A-Za-z0-9_-]+/gi, "e2b_redacted")
    .replace(/https?:\/\/\S+/gi, (value) => {
      try {
        const parsed = new URL(value);
        return `${parsed.origin}${parsed.pathname}`;
      } catch {
        return "https://redacted";
      }
    })
    .replace(/\b(api[_-]?key|secret|token|password|authorization)\b[^.,]*/gi, "$1 redacted")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return cleaned || "Could not open the computer";
}

/**
 * The dashboard computer. Reuses the workspace team machine and the existing
 * screen proxy. Does not change the link-builder driver and does not open a site.
 */
export async function openProjectComputerScreen(
  deps: ProjectScreenDeps,
  actor: Actor,
  projectId: string,
  boot: typeof provisionComputer = provisionComputer,
): Promise<{ url: string | null; error: string | null }> {
  const project = await deps.prisma.lbProject.findFirst({
    where: { id: projectId, workspaceId: actor.workspaceId, archivedAt: null },
    select: { id: true },
  });
  if (!project) throw new ORPCError("NOT_FOUND");
  try {
    let computer = await teamComputer(deps, actor);
    const cached = computer ? liveCachedUrl(computer) : null;
    if (computer && cached) {
      try {
        if (await keepComputerAwake(deps, computer)) return { url: cached, error: null };
      } catch {
        // The stored stream is stale. Reconnect the same machine below.
      }
    }
    computer = await bootTeamComputer(deps, actor, computer, boot);
    const url = await connectTeamScreen(deps, actor, computer);
    if (!url) return { url: null, error: "Could not open the computer" };
    return { url, error: null };
  } catch (error) {
    if (error instanceof ORPCError) throw error;
    if (error instanceof ComputerBusyError) return { url: null, error: null };
    const message = publicScreenError(error);
    console.error("link builder screen", message);
    return { url: null, error: message };
  }
}

function liveCachedUrl(computer: TeamComputer): string | null {
  if (computer.state !== "running" || !computer.providerRef) return null;
  return reusableScreenUrl(computer.screenUrl);
}

async function teamComputer(deps: ProjectScreenDeps, actor: Actor): Promise<TeamComputer | null> {
  return deps.prisma.computer.findFirst({
    where: { workspaceId: actor.workspaceId, scope: "team" },
    orderBy: { updatedAt: "desc" },
  });
}

async function bootTeamComputer(
  deps: ProjectScreenDeps,
  actor: Actor,
  existing: TeamComputer | null,
  boot: typeof provisionComputer,
): Promise<TeamComputer> {
  const computer =
    existing ??
    (await ensureComputerRecord(deps.prisma, {
      mode: "team",
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      kind: sandboxKind(deps.env.sandboxProvider),
    }));
  const bot = await deps.prisma.bot.findFirst({
    where: { workspaceId: actor.workspaceId, computerId: computer.id, archivedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const timeout = abortAfter(SCREEN_BOOT_MS);
  try {
    await boot(
      {
        prisma: deps.prisma,
        sandbox: deps.sandbox,
        home: deps.home,
        jobs: deps.jobs,
        events: deps.events,
        dataDir: deps.dataDir,
      },
      computer.id,
      screenContext(actor, bot?.id, timeout.signal),
    );
  } finally {
    timeout.cancel();
  }
  const ready = await deps.prisma.computer.findUnique({ where: { id: computer.id } });
  if (!ready?.providerRef || (ready.state !== "running" && ready.state !== "booting")) {
    const state = ready?.state ?? "stopped";
    throw new Error(state === "error" ? "Could not open the computer" : `computer is ${state}`);
  }
  if (ready.state === "booting") throw new ComputerBusyError();
  return ready;
}

async function connectTeamScreen(
  deps: ProjectScreenDeps,
  actor: Actor,
  computer: TeamComputer,
): Promise<string | null> {
  if (!computer.providerRef) return null;
  const bot = await deps.prisma.bot.findFirst({
    where: { workspaceId: actor.workspaceId, computerId: computer.id, archivedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const timeout = abortAfter(SCREEN_CONNECT_MS);
  let session: { url: string | null };
  try {
    session = await deps.sandbox.connectScreen(
      toComputerRef(computer),
      { view: "stream", interactive: false },
      screenContext(actor, bot?.id, timeout.signal),
    );
  } finally {
    timeout.cancel();
  }
  if (!session.url) return null;
  const viewUrl = withViewOnly(session.url, true);
  const proxied = addScreenProxyCapability(
    viewUrl,
    deps.env.screenProxySecret,
    deps.env.webOrigin,
    undefined,
    { proxyExternal: shouldProxyComputerScreen(viewUrl, computer.kind) },
  );
  const published = publishableScreenUrl(proxied);
  if (!published) return null;
  await deps.prisma.computer.update({
    where: { id: computer.id },
    data: { screenUrl: published },
  });
  await keepComputerAwake(deps, { ...computer, screenUrl: published, state: "running" }).catch(
    () => undefined,
  );
  return published;
}

function publishableScreenUrl(url: string): string | null {
  if (!url.startsWith("/novnc/") && !url.includes("/novnc/")) return null;
  if (/password=|api[_-]?key=|token=/i.test(url)) return null;
  if (url.startsWith("/novnc/") || url.startsWith("https://")) return url;
  return null;
}

async function keepComputerAwake(
  deps: ProjectScreenDeps,
  computer: TeamComputer,
): Promise<boolean> {
  if (!computer.providerRef || computer.state !== "running") return false;
  await deps.prisma.computer.updateMany({
    where: { id: computer.id, state: "running" },
    data: { updatedAt: new Date() },
  });
  await touchRunningComputer(
    { sandbox: deps.sandbox, jobs: deps.jobs },
    {
      id: computer.id,
      homeKey: computer.homeKey,
      providerRef: computer.providerRef,
      kind: computer.kind,
    },
  );
  return true;
}

function screenContext(
  actor: Actor,
  botId: string | undefined,
  signal: AbortSignal,
): AdapterContext {
  return {
    operationId: "link-builder.screen",
    traceId: "link-builder.screen",
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    ...(botId ? { botId } : {}),
    signal,
  };
}

function sandboxKind(provider: string): string {
  const parsed = SandboxKind.safeParse(provider);
  return parsed.success ? parsed.data : "e2b";
}

function withViewOnly(url: string, viewOnly: boolean) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("view_only", viewOnly ? "true" : "false");
    return parsed.toString();
  } catch {
    const join = url.includes("?") ? "&" : "?";
    return `${url}${join}view_only=${viewOnly ? "true" : "false"}`;
  }
}

function abortAfter(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}
