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
import {
  exposeBrowserDesktopCommand,
  listVisibleWindowsCommand,
  parseVisibleWindows,
} from "@rakazo/core";
import { ensureComputerRecord, type PrismaClient, type ThreadEvents } from "@rakazo/db";
import {
  desktopShowsForumSearch,
  forumSearchUrlFromProject,
} from "@rakazo/linkbuilder-core";
import { addScreenProxyCapability, shouldProxyComputerScreen } from "./screen-proxy.js";

const SCREEN_REFRESH_SLACK_MS = 5 * 60_000;
/** How long this request waits. The sandbox call keeps running so an abort cannot kill it. */
const SCREEN_REQUEST_MS = 90_000;

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
  if (/signal:\s*terminated|operation was aborted/i.test(raw)) return "Could not open the computer";
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

type ScreenProject = {
  name: string | null;
  brandName: string | null;
  topicLanes: unknown;
  targets: unknown;
};

/**
 * The dashboard computer. Reuses the workspace team machine and the existing
 * screen proxy. Opens Google search for the stored topic. Does not change the
 * link-builder driver, register an account, post, or place a link.
 */
export async function openProjectComputerScreen(
  deps: ProjectScreenDeps,
  actor: Actor,
  projectId: string,
  boot: typeof provisionComputer = provisionComputer,
): Promise<{ url: string | null; error: string | null }> {
  const project = await deps.prisma.lbProject.findFirst({
    where: { id: projectId, workspaceId: actor.workspaceId, archivedAt: null },
    select: { id: true, name: true, brandName: true, topicLanes: true, targets: true },
  });
  if (!project) throw new ORPCError("NOT_FOUND");
  const flightKey = `${actor.workspaceId}:${projectId}`;
  const existing = screenFlights.get(flightKey);
  const flight =
    existing ??
    openScreen(deps, actor, project, boot).finally(() => {
      screenFlights.delete(flightKey);
    });
  if (!existing) screenFlights.set(flightKey, flight);
  const deadline = startDeadline(SCREEN_REQUEST_MS, "The computer took too long to start");
  try {
    return await Promise.race([flight, deadline.promise]);
  } catch (error) {
    if (error instanceof ORPCError) throw error;
    if (isStillStarting(error)) return { url: null, error: null };
    const message = publicScreenError(error);
    console.error("link builder screen", error instanceof Error ? error.name : "Error", message);
    return { url: null, error: message };
  } finally {
    deadline.cancel();
  }
}

const screenFlights = new Map<string, Promise<{ url: string | null; error: string | null }>>();

async function openScreen(
  deps: ProjectScreenDeps,
  actor: Actor,
  project: ScreenProject,
  boot: typeof provisionComputer,
): Promise<{ url: string | null; error: string | null }> {
  try {
    let computer = await teamComputer(deps, actor);
    const cached = computer ? liveCachedUrl(computer) : null;
    if (computer && cached) {
      try {
        if (await keepComputerAwake(deps, computer)) {
          await showForumSearch(deps, actor, project, computer);
          return { url: cached, error: null };
        }
      } catch {
        // The stored stream is stale. Reconnect the same machine below.
      }
    }
    computer = await bootTeamComputer(deps, actor, computer, boot);
    const url = await connectTeamScreen(deps, actor, computer);
    if (!url) return { url: null, error: "Could not open the computer" };
    await showForumSearch(deps, actor, project, computer);
    return { url, error: null };
  } catch (error) {
    if (error instanceof ORPCError) throw error;
    if (error instanceof ComputerBusyError) return { url: null, error: null };
    const message = publicScreenError(error);
    console.error("link builder screen", error instanceof Error ? error.name : "Error", message);
    return { url: null, error: message };
  }
}

function isStillStarting(error: unknown): boolean {
  return error instanceof Error && error.message === "The computer took too long to start";
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
  const runBoot = () =>
    boot(
      {
        prisma: deps.prisma,
        sandbox: deps.sandbox,
        home: deps.home,
        jobs: deps.jobs,
        events: deps.events,
        dataDir: deps.dataDir,
      },
      computer.id,
      screenContext(actor, bot?.id, new AbortController().signal),
    );
  try {
    await runBoot();
  } catch (error) {
    if (!existing?.providerRef || !deadSandbox(error)) throw error;
    await deps.prisma.computer.updateMany({
      where: { id: computer.id, providerRef: existing.providerRef },
      data: { state: "stopped", providerRef: null },
    });
    await runBoot();
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
  const session = await deps.sandbox.connectScreen(
    toComputerRef(computer),
    { view: "stream", interactive: false },
    screenContext(actor, bot?.id, new AbortController().signal),
  );
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

const DESKTOP_DISPLAY = ":0";

/** Open Chrome on Google search unless that page is already in front. */
async function showForumSearch(
  deps: ProjectScreenDeps,
  actor: Actor,
  project: ScreenProject,
  computer: TeamComputer,
): Promise<void> {
  if (!computer.providerRef || (computer.state !== "running" && computer.state !== "booting")) {
    return;
  }
  const url = forumSearchUrlFromProject(project);
  if (!url.startsWith("https://www.google.com/search?")) return;
  try {
    let titles: string[] = [];
    try {
      const listed = await runDesktop(
        deps,
        actor,
        computer,
        listVisibleWindowsCommand(DESKTOP_DISPLAY),
      );
      titles = parseVisibleWindows(listed).flatMap((window) => (window.title ? [window.title] : []));
    } catch {
      titles = [];
    }
    if (desktopShowsForumSearch(titles)) return;
    await runDesktop(deps, actor, computer, openForumSearchScript(url));
  } catch (error) {
    console.error("link builder screen", "forum search", publicScreenError(error));
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * Launch Chrome straight onto the search. Skip the first-run dialog, and press
 * Enter if a previous launch left "Welcome to Google Chrome" in front.
 */
function openForumSearchScript(url: string): string {
  const quoted = shellQuote(url);
  const apps = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map(shellQuote)
    .join(" ");
  return [
    "opened=0",
    `for app in ${apps}; do`,
    '  if command -v "$app" >/dev/null 2>&1; then',
    `    nohup env DISPLAY=${DESKTOP_DISPLAY} "$app" --no-first-run --disable-fre --no-default-browser-check --start-maximized --new-window ${quoted} >/tmp/rakazo-browser.log 2>&1 &`,
    "    opened=1",
    "    break",
    "  fi",
    "done",
    "sleep 2",
    dismissChromeWelcome(DESKTOP_DISPLAY),
    openAddress(DESKTOP_DISPLAY, quoted),
    "sleep 2",
    exposeBrowserDesktopCommand(DESKTOP_DISPLAY),
    fillBrowserWindow(DESKTOP_DISPLAY),
  ].join("\n");
}

function dismissChromeWelcome(display: string): string {
  return [
    "for _ in 1 2 3 4; do",
    `  id=$(DISPLAY=${display} xdotool search --onlyvisible --name "Welcome to Google Chrome" 2>/dev/null | awk 'NR==1{print; exit}')`,
    '  if [ -z "$id" ]; then break; fi',
    `  DISPLAY=${display} xdotool windowactivate --sync "$id" key Return 2>/dev/null || true`,
    "  sleep 0.5",
    "done",
  ].join("\n");
}

function openAddress(display: string, quotedUrl: string): string {
  const browsers = ["google-chrome", "Google-chrome", "Chromium", "chromium"]
    .map(shellQuote)
    .join(" ");
  return [
    "id=",
    `for class in ${browsers}; do`,
    `  id=$(DISPLAY=${display} xdotool search --onlyvisible --class "$class" 2>/dev/null | awk 'NR==1{print; exit}')`,
    '  if [ -n "$id" ]; then break; fi',
    "done",
    'if [ -n "$id" ]; then',
    `  DISPLAY=${display} xdotool windowactivate --sync "$id"`,
    "  sleep 0.2",
    `  DISPLAY=${display} xdotool key ctrl+l`,
    "  sleep 0.15",
    `  DISPLAY=${display} xdotool type --delay 1 -- ${quotedUrl}`,
    `  DISPLAY=${display} xdotool key Return`,
    "fi",
  ].join("\n");
}

/** Cover the desktop so the search page is what the pane shows. */
function fillBrowserWindow(display: string): string {
  const classes = ["google-chrome", "Google-chrome", "Chromium", "chromium", "firefox", "Firefox"]
    .map((name) => `'${name}'`)
    .join(" ");
  return [
    "id=",
    `for class in ${classes}; do`,
    `  id=$(DISPLAY=${display} xdotool search --onlyvisible --class "$class" 2>/dev/null | awk 'NR==1{print; exit}')`,
    `  if [ -n "$id" ]; then break; fi`,
    "done",
    `if [ -n "$id" ]; then`,
    `  DISPLAY=${display} xdotool windowmove "$id" 0 0 windowsize --sync "$id" 1280 800 windowactivate "$id" 2>/dev/null || true`,
    "fi",
  ].join("\n");
}

async function runDesktop(
  deps: ProjectScreenDeps,
  actor: Actor,
  computer: TeamComputer,
  script: string,
): Promise<string> {
  let stdout = "";
  const events = deps.sandbox.execute(
    toComputerRef(computer),
    { argv: ["bash", "-lc", script], timeoutMs: 45_000 },
    screenContext(actor, undefined, new AbortController().signal),
  );
  for await (const event of events) {
    if (event.type === "stdout") stdout += event.data;
    if (event.type === "exit" && event.code !== 0) throw new Error("desktop command failed");
  }
  return stdout;
}

function deadSandbox(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /terminated|not found|sandbox not found|killed/i.test(message);
}

function startDeadline(ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return {
    promise,
    cancel() {
      if (timer) clearTimeout(timer);
    },
  };
}
