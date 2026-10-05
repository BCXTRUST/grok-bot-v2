import {
  type AdapterContext,
  type ArtifactStore,
  type BrowserPersona,
  type BrowserSession,
  type BrowserSessionFactory,
  type CaptchaSolver,
  CaptchaSolverError,
  type MailboxProvider,
} from "@rakazo/adapter-kit";
import { type EncryptedSecretStore, loadSiteLoginForFill, upsertSiteLogin } from "@rakazo/adapters";
import type {
  LbCaptchaDoor,
  LbCaptchaOutcome,
  LbCaptchaType,
  LbHostPlatform,
  LbHostStatus,
  LbHumanCheckboxState,
  LbLanguage,
  LbMarket,
  LbOperatorTicketReason,
  LbParkableHostStatus,
  LbPersona,
  LbPlacementStatus,
  LbRunStatus,
  LbSchedule,
  LbTarget,
  LbWarmup,
} from "@rakazo/contracts";
import { Prisma, type PrismaClient } from "@rakazo/db";
import {
  closingRunStatus,
  extractVerificationLink,
  generateForumPassword,
  generateForumUsername,
  type HostEvent,
  insertReference,
  isWarmupMet,
  marketForHost,
  PAGE_HELPER_EXTENSION_ID,
  PAGE_HELPER_VERSION,
  type RealStepKind,
  type RunCounters,
  recordCountedLive,
  recordHostVisited,
  recordRegistration,
  redactSecrets,
  shouldCount,
  transitionHost,
  transitionPlacement,
  transitionProject,
  transitionRun,
  validateAnchor,
  validateTargetUrl,
  WORKABLE_HOST_ORDER,
} from "@rakazo/linkbuilder-core";
import {
  acceptCookieWall,
  type BoardDriver,
  boardDriverFor,
  type CaptchaChallenge,
  enrichCaptchaChallenge,
  placeCaptchaToken,
  type RegistrationResult,
  runPageHelper,
  solveImageCaptcha,
  verifyPlacement,
} from "@rakazo/linkbuilder-drivers";

/** Bot id recorded on forum logins the link builder stores; logins are workspace-shared. */
export const LINK_BUILDER_LOGIN_BOT = "link-builder";
/** Image captcha attempts on one form before the host is parked for the operator. */
export const MAX_CAPTCHA_ATTEMPTS = 2;
const DRAFT_MODEL_ID = "template-m2";

export type Tx = Prisma.TransactionClient;

export interface RealWorkerServices {
  prisma: PrismaClient;
  secrets: EncryptedSecretStore;
  artifacts: ArtifactStore;
  browsers: BrowserSessionFactory;
  captcha: CaptchaSolver;
  mailbox: MailboxProvider;
  verifyFetch?: typeof fetch;
  allowPrivateVerify: boolean;
  verifyDelayMs: number;
  reverifyAfterMs: number;
  pageHelperButtonSelector: string;
  pageHelperPollMs: number;
  /** Clock for the Page Helper TTL. Production injects `Date.now`. */
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Facts about the open persona browser; they live with the worker, never in the database. */
export interface PoolEntry {
  session: BrowserSession;
  marketKey: string;
  hostId: string | null;
  helperConnected: boolean;
  helperVersion: string | null;
  cookieChecked: boolean;
  registerFormReady: boolean;
  captchaAttempts: number;
}

export interface ProjectConfig {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  brandName: string;
  allowedDomains: string[];
  persona: LbPersona;
  markets: LbMarket[];
  quotas: { newPerDay: number; livePerDay: number; liveWeekCap?: number };
  schedule: LbSchedule;
  warmup: LbWarmup;
  targets: LbTarget[];
  countNofollow: boolean;
  denyHosts: string[];
  preferHosts: string[];
  mailboxId: string | null;
  mailboxAddress: string | null;
  captchaLowBalanceCredits: number;
  operatorTtlHours: number;
}

export type HostRow = Prisma.LbHostGetPayload<object>;
export type AccountRow = Prisma.LbHostAccountGetPayload<object>;
export type PlacementRow = Prisma.LbPlacementGetPayload<object>;

export interface RunRow {
  id: string;
  status: LbRunStatus;
  counters: RunCounters;
}

export interface StepContext {
  services: RealWorkerServices;
  now: Date;
  run: RunRow;
  stepIndex: number;
  project: ProjectConfig;
  host: HostRow | null;
  account: AccountRow | null;
  placement: PlacementRow | null;
  adapter: AdapterContext;
  /** Values redacted from every outcome, error and log line of this step. */
  secrets: string[];
  pool(): PoolEntry | undefined;
  openSession(host: HostRow): Promise<PoolEntry>;
  closeSession(): Promise<void>;
  storeArtifact(name: string, mimeType: string, bytes: Uint8Array): Promise<string>;
}

export interface RunPatch {
  status?: LbRunStatus;
  counters?: RunCounters;
  currentHostId?: string | null;
  currentUrl?: string | null;
  finishedAt?: Date;
}

export type StepResult =
  | { kind: "wait"; reason: string }
  | {
      kind: "step";
      lastAction: string;
      hostId: string | null;
      outcome?: Record<string, unknown>;
      artifactIds?: string[];
      credits?: number;
      run?: RunPatch;
      apply?: (tx: Tx) => Promise<void>;
      afterCommit?: () => Promise<void> | void;
    };

export class StaleState extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleState";
  }
}

export class StepFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepFailure";
  }
}

type StepHandler = (ctx: StepContext) => Promise<StepResult>;

export const REAL_STEP_HANDLERS: Record<RealStepKind, StepHandler> = {
  select_host: selectHost,
  open_session: openSession,
  helper_connected: helperConnected,
  cookie_wall: cookieWall,
  register,
  captcha,
  email_verify: emailVerify,
  warmup,
  post,
  verify,
  close,
};

function requireHost(ctx: StepContext): HostRow {
  if (!ctx.host) throw new StepFailure("No host selected");
  return ctx.host;
}

function requireDriver(host: HostRow): BoardDriver {
  const driver = boardDriverFor(host.platform as LbHostPlatform);
  if (!driver) throw new StepFailure(`No driver for ${host.platform}`);
  return driver;
}

function requireSession(ctx: StepContext, host: HostRow): PoolEntry {
  const entry = ctx.pool();
  if (!entry || entry.hostId !== host.id) throw new StepFailure("No persona session on this host");
  return entry;
}

function hostStateOf(host: HostRow) {
  return {
    status: host.status as LbHostStatus,
    parkedFrom: (host.parkedFrom as LbParkableHostStatus | null) ?? null,
  };
}

/**
 * One typed host transition, guarded on the status read at the start of the step. A concurrent
 * change makes the guard miss and the whole step roll back.
 */
export async function moveHost(
  tx: Tx,
  host: HostRow,
  event: HostEvent,
  extra: Prisma.LbHostUpdateManyMutationInput = {},
): Promise<void> {
  const next = transitionHost(hostStateOf(host), event);
  const updated = await tx.lbHost.updateMany({
    where: { id: host.id, status: host.status },
    data: { ...extra, status: next.status, parkedFrom: next.parkedFrom },
  });
  if (updated.count !== 1) throw new StaleState(`Host ${host.id} moved during the step`);
}

async function screenshot(ctx: StepContext, entry: PoolEntry, label: string): Promise<string[]> {
  try {
    const bytes = await entry.session.screenshotPng();
    return [await ctx.storeArtifact(`step-${ctx.stepIndex}-${label}.png`, "image/png", bytes)];
  } catch {
    return [];
  }
}

function personaFor(ctx: StepContext, market: LbMarket): BrowserPersona {
  return {
    projectId: ctx.project.id,
    profileKey: ctx.project.id,
    locale: market.locale,
    timezoneId: market.timezoneId,
  };
}

export function marketOf(project: ProjectConfig, host: HostRow): LbMarket {
  const market =
    marketForHost(project.markets, {
      country: host.country,
      language: host.language as LbLanguage,
    }) ?? project.markets[0];
  if (!market) throw new StepFailure("Project has no market");
  return market;
}

export function browserPersona(ctx: StepContext, host: HostRow): BrowserPersona {
  return personaFor(ctx, marketOf(ctx.project, host));
}

function park(
  ctx: StepContext,
  host: HostRow,
  reason: LbOperatorTicketReason,
  options: { note?: string; screenUrl?: string | null } = {},
) {
  return async (tx: Tx) => {
    await moveHost(tx, host, "parked", { statusReason: reason });
    await tx.lbOperatorTicket.create({
      data: {
        workspaceId: ctx.project.workspaceId,
        projectId: ctx.project.id,
        hostId: host.id,
        runId: ctx.run.id,
        reason,
        screenUrl: options.screenUrl ?? null,
        note: options.note ?? null,
        status: "open",
        expiresAt: new Date(ctx.now.getTime() + ctx.project.operatorTtlHours * 3_600_000),
      },
    });
  };
}

function hostOrder(status: string): number {
  return (WORKABLE_HOST_ORDER as readonly string[]).indexOf(status);
}

async function selectHost(ctx: StepContext): Promise<StepResult> {
  const { prisma } = ctx.services;
  const rows = await prisma.lbHost.findMany({
    where: {
      workspaceId: ctx.project.workspaceId,
      projectId: ctx.project.id,
      status: { in: [...WORKABLE_HOST_ORDER] },
    },
    include: { accounts: true, placements: { select: { status: true } } },
  });
  const deny = new Set(ctx.project.denyHosts.map((host) => host.toLowerCase()));
  const prefer = new Set(ctx.project.preferHosts.map((host) => host.toLowerCase()));
  const candidates = rows.filter((row) => {
    if (deny.has(row.registrableDomain) || !boardDriverFor(row.platform as LbHostPlatform)) {
      return false;
    }
    if (row.status === "qualified") return ctx.run.counters.newToday < ctx.project.quotas.newPerDay;
    if (row.status === "warming") {
      const account = row.accounts[0];
      return (
        account !== undefined &&
        isWarmupMet({
          postCount: account.postCount,
          accountCreatedAt: account.createdAt,
          now: ctx.now,
          ...ctx.project.warmup,
        })
      );
    }
    if (row.status === "ready") return !row.placements.some((p) => p.status !== "pending");
    return true;
  });
  candidates.sort(
    (a, b) =>
      hostOrder(a.status) - hostOrder(b.status) ||
      Number(prefer.has(b.registrableDomain)) - Number(prefer.has(a.registrableDomain)) ||
      b.qualityScore - a.qualityScore,
  );
  const picked = candidates[0];
  if (!picked) return { kind: "wait", reason: "no_workable_host" };
  if (picked.id === ctx.host?.id) return { kind: "wait", reason: "same_host" };
  const visited = await prisma.lbRunStep.count({ where: { runId: ctx.run.id, hostId: picked.id } });
  const entry = ctx.pool();
  return {
    kind: "step",
    lastAction: `Working on ${picked.registrableDomain}`,
    hostId: picked.id,
    outcome: { hostStatus: picked.status },
    run: {
      currentHostId: picked.id,
      currentUrl: picked.homepageUrl,
      counters: recordHostVisited(ctx.run.counters, { firstVisitToday: visited === 0 }),
    },
    afterCommit: () => {
      if (entry && entry.hostId !== picked.id) {
        Object.assign(entry, {
          hostId: null,
          helperConnected: false,
          helperVersion: null,
          cookieChecked: false,
          registerFormReady: false,
          captchaAttempts: 0,
        });
      }
    },
  };
}

async function openSession(ctx: StepContext): Promise<StepResult> {
  const host = requireHost(ctx);
  const entry = await ctx.openSession(host);
  await entry.session.goto(host.homepageUrl);
  Object.assign(entry, {
    hostId: host.id,
    helperConnected: false,
    helperVersion: null,
    cookieChecked: false,
    registerFormReady: false,
    captchaAttempts: 0,
  });
  return {
    kind: "step",
    lastAction: `Opened ${host.registrableDomain}`,
    hostId: host.id,
    artifactIds: await screenshot(ctx, entry, "open"),
    outcome: { mode: ctx.services.browsers.mode },
    run: { currentUrl: await entry.session.url() },
  };
}

async function readHelperVersion(session: BrowserSession): Promise<{
  version: string | null;
  extensionId: string | null;
}> {
  const loaded = (await session.extensionVersions?.()) ?? [];
  const pinned = loaded.find((item) => item.id === PAGE_HELPER_EXTENSION_ID);
  if (pinned) return { version: pinned.version || null, extensionId: pinned.id };
  if (loaded.length > 0) {
    const match = loaded.find((item) => item.version === PAGE_HELPER_VERSION) ?? loaded[0]!;
    return { version: match.version || null, extensionId: match.id };
  }
  await session.waitFor("html[data-page-helper-version]", { timeoutMs: 5_000 });
  return {
    version: await session.attribute("html", "data-page-helper-version"),
    extensionId: null,
  };
}

async function helperConnected(ctx: StepContext): Promise<StepResult> {
  const host = requireHost(ctx);
  const entry = requireSession(ctx, host);
  const observed = await readHelperVersion(entry.session);
  if (observed.version !== PAGE_HELPER_VERSION) {
    const seen = observed.version ?? "missing";
    const artifactIds = await screenshot(ctx, entry, "helper");
    entry.registerFormReady = false;
    return {
      kind: "step",
      lastAction: "Page Helper version does not match",
      hostId: host.id,
      artifactIds,
      outcome: { helperVersion: seen, expected: PAGE_HELPER_VERSION },
      apply: park(ctx, host, "unknown_page_state", {
        note: `Page Helper version is ${seen}; expected ${PAGE_HELPER_VERSION}`,
      }),
    };
  }
  entry.helperConnected = true;
  entry.helperVersion = observed.version;
  return {
    kind: "step",
    lastAction: "Page Helper connected",
    hostId: host.id,
    outcome: {
      helperVersion: observed.version,
      extensionId: observed.extensionId,
    },
  };
}

async function cookieWall(ctx: StepContext): Promise<StepResult> {
  const host = requireHost(ctx);
  const entry = requireSession(ctx, host);
  const result = await acceptCookieWall(entry.session);
  entry.cookieChecked = true;
  return {
    kind: "step",
    lastAction: result === "accepted" ? "Accepted the cookie notice" : "No cookie notice",
    hostId: host.id,
    outcome: { cookieWall: result },
    artifactIds: result === "accepted" ? await screenshot(ctx, entry, "cookies") : [],
  };
}

interface Credentials {
  username: string;
  password: string;
  email: string;
  accountId: string;
}

/**
 * Reuses the host account's vault login, or generates a username and password in code, stores the
 * password in the encrypted vault at once and creates the account row before anything is typed.
 */
async function ensureCredentials(ctx: StepContext, host: HostRow): Promise<Credentials> {
  const { prisma, secrets } = ctx.services;
  const email = ctx.project.mailboxAddress;
  if (!email) throw new StepFailure("Project has no mailbox");
  const existing = await prisma.lbHostAccount.findUnique({ where: { hostId: host.id } });
  if (existing?.siteLoginId) {
    const password = await loadPassword(ctx, existing.siteLoginId);
    return { username: existing.username, password, email, accountId: existing.id };
  }
  const username = await freshUsername(ctx, host);
  const password = generateForumPassword();
  ctx.secrets.push(password);
  const stored = await upsertSiteLogin(
    { prisma, secrets },
    {
      workspaceId: ctx.project.workspaceId,
      userId: ctx.project.ownerUserId,
      botId: LINK_BUILDER_LOGIN_BOT,
      site: host.homepageUrl,
      username,
      password,
      from: "user",
    },
  );
  if ("error" in stored) throw new StepFailure(stored.error);
  try {
    const account = existing
      ? await prisma.lbHostAccount.update({
          where: { id: existing.id },
          data: { username, siteLoginId: stored.login.id },
        })
      : await prisma.lbHostAccount.create({
          data: {
            workspaceId: ctx.project.workspaceId,
            projectId: ctx.project.id,
            hostId: host.id,
            username,
            siteLoginId: stored.login.id,
          },
        });
    return { username, password, email, accountId: account.id };
  } catch (error) {
    if (!isUnique(error)) throw error;
    return ensureCredentials(ctx, host);
  }
}

/** A generated username with no vault login on this site yet, so no stored password is replaced. */
async function freshUsername(ctx: StepContext, host: HostRow): Promise<string> {
  const site = new URL(host.homepageUrl).hostname.replace(/^www\./, "").toLowerCase();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const username = generateForumUsername(ctx.project.persona.displayName);
    const taken = await ctx.services.prisma.siteLogin.count({
      where: {
        workspaceId: ctx.project.workspaceId,
        userId: ctx.project.ownerUserId,
        host: site,
        username,
      },
    });
    if (taken === 0) return username;
  }
  throw new StepFailure("Could not pick a free username");
}

async function loadPassword(ctx: StepContext, siteLoginId: string): Promise<string> {
  const loaded = await loadSiteLoginForFill(
    { prisma: ctx.services.prisma, secrets: ctx.services.secrets },
    {
      workspaceId: ctx.project.workspaceId,
      userId: ctx.project.ownerUserId,
      botId: LINK_BUILDER_LOGIN_BOT,
      loginId: siteLoginId,
    },
  );
  if ("error" in loaded) throw new StepFailure("Vault login is missing");
  ctx.secrets.push(loaded.password);
  return loaded.password;
}

/** Result of a registration submit, mapped to exactly one host transition. */
function registrationOutcome(
  ctx: StepContext,
  host: HostRow,
  entry: PoolEntry,
  result: RegistrationResult,
  artifactIds: string[],
): Extract<StepResult, { kind: "step" }> {
  const base = { kind: "step" as const, hostId: host.id, artifactIds };
  const settled = () => {
    entry.registerFormReady = false;
    entry.captchaAttempts = 0;
  };
  switch (result.kind) {
    case "pending_email":
      return {
        ...base,
        lastAction: "Registered, waiting for the verification mail",
        outcome: { registration: result.kind },
        apply: (tx) => moveHost(tx, host, "email_pending"),
        afterCommit: settled,
      };
    case "pending_admin":
      return {
        ...base,
        lastAction: "Registered, waiting for the board admin",
        outcome: { registration: result.kind },
        apply: (tx) => moveHost(tx, host, "admin_pending"),
        afterCommit: settled,
      };
    case "active":
      return {
        ...base,
        lastAction: "Registered",
        outcome: { registration: result.kind },
        apply: (tx) => moveHost(tx, host, "account_active"),
        afterCommit: settled,
      };
    case "form_error":
      return {
        ...base,
        lastAction: "The board refused the registration",
        outcome: { registration: result.kind, messages: redactAll(ctx, result.messages) },
        apply: (tx) =>
          moveHost(tx, host, "failed", {
            statusReason: redactAll(ctx, result.messages).join(" ").slice(0, 500),
          }),
        afterCommit: settled,
      };
    case "unknown":
      return {
        ...base,
        lastAction: "Parked for the operator",
        outcome: { registration: result.kind, messages: redactAll(ctx, result.messages) },
        apply: park(ctx, host, "unknown_page_state"),
        afterCommit: settled,
      };
    case "captcha_rejected":
      throw new StepFailure("captcha_rejected is handled by the captcha step");
  }
}

async function register(ctx: StepContext): Promise<StepResult> {
  const host = requireHost(ctx);
  const entry = requireSession(ctx, host);
  const driver = requireDriver(host);
  if (host.status === "registering") {
    // A resumed step: the operator may already have submitted, so read the page and never submit.
    const current = await driver.readRegistrationResult(entry.session);
    if (current.kind !== "form_error" && current.kind !== "unknown") {
      if (current.kind === "captcha_rejected") entry.registerFormReady = false;
      else {
        const artifactIds = await screenshot(ctx, entry, "resumed");
        const result = registrationOutcome(ctx, host, entry, current, artifactIds);
        return { ...result, outcome: { ...result.outcome, resumed: true } };
      }
    }
  }
  const credentials = await ensureCredentials(ctx, host);
  const page = await driver.openRegistration(entry.session, host.homepageUrl);
  if (page !== "form") {
    const artifactIds = await screenshot(ctx, entry, "register");
    if (page === "closed") {
      return {
        kind: "step",
        lastAction: "Registration is closed",
        hostId: host.id,
        artifactIds,
        apply: (tx) => moveHost(tx, host, "failed", { statusReason: "registration_closed" }),
      };
    }
    return {
      kind: "step",
      lastAction: "Parked for the operator",
      hostId: host.id,
      artifactIds,
      apply: park(ctx, host, "unknown_page_state"),
    };
  }
  await driver.fillRegistration(entry.session, credentials);
  entry.registerFormReady = true;
  entry.captchaAttempts = 0;
  const artifactIds = await screenshot(ctx, entry, "register");
  const starting = host.status === "qualified";
  return {
    kind: "step",
    lastAction: "Filled the registration form",
    hostId: host.id,
    artifactIds,
    outcome: { username: credentials.username },
    run: starting ? { counters: recordRegistration(ctx.run.counters) } : undefined,
    apply: starting
      ? (tx) =>
          moveHost(tx, host, "registration_started", {
            registerUrl: driver.registerUrl(host.homepageUrl),
          })
      : undefined,
  };
}

interface CaptchaRecord {
  type: LbCaptchaType;
  door: LbCaptchaDoor;
  outcome: LbCaptchaOutcome;
  credits: number;
  balanceAfter?: number;
  taskId?: string | null;
  buttonTextObserved?: string | null;
  humanCheckboxState?: LbHumanCheckboxState;
  imageGridOpen?: boolean;
  siteKeyFound?: boolean;
  helperVersion?: string | null;
}

/** Pauses the project once and writes a single credits alert. A second caller finds it already paused. */
export async function pauseForLowBalance(
  ctx: StepContext,
  balance: number,
  record: Pick<CaptchaRecord, "type" | "door"> = { type: "unsupported", door: "https_api" },
): Promise<boolean> {
  const paused = await ctx.services.prisma.$transaction(async (tx) => {
    const updated = await tx.lbProject.updateMany({
      where: { id: ctx.project.id, workspaceId: ctx.project.workspaceId, status: "active" },
      data: { status: transitionProject("active", "paused") },
    });
    if (updated.count !== 1) return false;
    await tx.lbCaptchaEvent.create({
      data: {
        workspaceId: ctx.project.workspaceId,
        projectId: ctx.project.id,
        runId: ctx.run.id,
        type: record.type,
        door: record.door,
        outcome: "credits",
        attempt: 1,
        creditsCharged: 0,
        balanceAfter: balance,
        createdAt: ctx.now,
      },
    });
    await tx.lbRun.update({
      where: { id: ctx.run.id },
      data: { lastAction: "Paused, Captell balance is low" },
    });
    return true;
  });
  return paused;
}

function captchaEvent(ctx: StepContext, host: HostRow, attempt: number, record: CaptchaRecord) {
  return (tx: Tx) =>
    tx.lbCaptchaEvent.create({
      data: {
        workspaceId: ctx.project.workspaceId,
        projectId: ctx.project.id,
        hostId: host.id,
        runId: ctx.run.id,
        type: record.type,
        door: record.door,
        outcome: record.outcome,
        buttonTextObserved: record.buttonTextObserved ?? null,
        humanCheckboxState: record.humanCheckboxState ?? null,
        imageGridOpen: record.imageGridOpen ?? false,
        siteKeyFound: record.siteKeyFound ?? false,
        attempt,
        creditsCharged: record.credits,
        balanceAfter: record.balanceAfter ?? null,
        taskId: record.taskId ?? null,
        helperVersion: record.helperVersion ?? null,
      },
    });
}

function withEvent(
  result: Extract<StepResult, { kind: "step" }>,
  event: (tx: Tx) => Promise<unknown>,
  credits: number,
): StepResult {
  const apply = result.apply;
  return {
    ...result,
    credits: (result.credits ?? 0) + credits,
    apply: async (tx) => {
      await event(tx);
      await apply?.(tx);
    },
  };
}

function widgetRecord(
  challenge: Extract<CaptchaChallenge, { kind: "widget" }>,
  door: LbCaptchaDoor,
  extra: Partial<CaptchaRecord>,
): CaptchaRecord {
  return {
    type: challenge.type,
    door,
    outcome: extra.outcome ?? "placed_submitted",
    credits: extra.credits ?? 0,
    balanceAfter: extra.balanceAfter,
    taskId: extra.taskId,
    buttonTextObserved: extra.buttonTextObserved,
    humanCheckboxState: extra.humanCheckboxState,
    imageGridOpen: extra.imageGridOpen ?? false,
    siteKeyFound: challenge.siteKey !== null,
    helperVersion: extra.helperVersion,
  };
}

async function captcha(ctx: StepContext): Promise<StepResult> {
  const host = requireHost(ctx);
  const entry = requireSession(ctx, host);
  const driver = requireDriver(host);
  const challenge = await enrichCaptchaChallenge(
    entry.session,
    await driver.detectCaptcha(entry.session),
    ctx.services.pageHelperButtonSelector,
  );
  const attempt = entry.captchaAttempts + 1;
  try {
    if (challenge.kind === "image")
      return await imageCaptcha(ctx, host, entry, driver, challenge, attempt);
    if (challenge.kind === "question") {
      return await questionCaptcha(ctx, host, entry, driver, challenge, attempt);
    }
    if (challenge.kind === "widget")
      return await widgetCaptcha(ctx, host, entry, driver, challenge, attempt);
    return finishRegistration(
      ctx,
      host,
      entry,
      driver,
      attempt,
      null,
      await driver.submitRegistration(entry.session),
    );
  } catch (error) {
    if (error instanceof CaptchaSolverError) return solverFailure(ctx, host, entry, attempt, error);
    throw error;
  }
}

async function imageCaptcha(
  ctx: StepContext,
  host: HostRow,
  entry: PoolEntry,
  driver: BoardDriver,
  challenge: Extract<CaptchaChallenge, { kind: "image" }>,
  attempt: number,
): Promise<StepResult> {
  const solution = await solveImageCaptcha(
    entry.session,
    challenge,
    ctx.services.captcha,
    ctx.adapter,
  );
  if (!solution.ok) {
    const artifactIds = await screenshot(ctx, entry, "captcha");
    entry.registerFormReady = false;
    const note =
      solution.reason === "not_read" ? "Captcha image was not read" : "Captcha crop was rejected";
    return withEvent(
      {
        kind: "step",
        lastAction: "Parked for the operator",
        hostId: host.id,
        artifactIds,
        outcome: { captcha: solution.reason },
        apply: park(ctx, host, "captcha_unsolved", { note }),
      },
      captchaEvent(ctx, host, attempt, {
        type: "image_letters",
        door: "https_api",
        outcome: "operator_parked",
        credits: 0,
      }),
      0,
    );
  }
  return finishRegistration(
    ctx,
    host,
    entry,
    driver,
    attempt,
    {
      type: "image_letters",
      door: "https_api",
      outcome: "placed_submitted",
      credits: solution.credits,
      balanceAfter: solution.balance,
      taskId: solution.taskId,
    },
    await driver.submitRegistration(entry.session),
  );
}

async function questionCaptcha(
  ctx: StepContext,
  host: HostRow,
  entry: PoolEntry,
  driver: BoardDriver,
  challenge: Extract<CaptchaChallenge, { kind: "question" }>,
  attempt: number,
): Promise<StepResult> {
  const answer = await ctx.services.captcha.answerQuestion(
    { question: challenge.question || undefined, pageText: await entry.session.pageText() },
    ctx.adapter,
  );
  if ("couldNotAnswer" in answer) {
    const artifactIds = await screenshot(ctx, entry, "captcha");
    entry.registerFormReady = false;
    return withEvent(
      {
        kind: "step",
        lastAction: "Parked for the operator",
        hostId: host.id,
        artifactIds,
        outcome: { captcha: "question_unanswered" },
        apply: park(ctx, host, "captcha_unsolved", { note: challenge.question.slice(0, 500) }),
      },
      captchaEvent(ctx, host, attempt, {
        type: "knowledge_question",
        door: "https_api",
        outcome: "operator_parked",
        credits: 0,
      }),
      0,
    );
  }
  await entry.session.fill(challenge.answerSelector, answer.answer);
  return finishRegistration(
    ctx,
    host,
    entry,
    driver,
    attempt,
    {
      type: "knowledge_question",
      door: "https_api",
      outcome: "placed_submitted",
      credits: 0,
    },
    await driver.submitRegistration(entry.session),
  );
}

async function widgetCaptcha(
  ctx: StepContext,
  host: HostRow,
  entry: PoolEntry,
  driver: BoardDriver,
  challenge: Extract<CaptchaChallenge, { kind: "widget" }>,
  attempt: number,
): Promise<StepResult> {
  const helperReady = await entry.session.waitFor(ctx.services.pageHelperButtonSelector, {
    timeoutMs: 2_000,
  });
  if (!helperReady) return widgetViaApi(ctx, host, entry, driver, challenge, attempt);
  const run = await runPageHelper(entry.session, {
    buttonSelector: ctx.services.pageHelperButtonSelector,
    submitSelector: driver.registerSubmitSelector,
    pageMessages: (session) => driver.pageMessages(session),
    sleep: ctx.services.sleep,
    now: ctx.services.nowMs ?? Date.now,
    pollMs: ctx.services.pageHelperPollMs,
  });
  const record = widgetRecord(challenge, "page_helper", {
    outcome: run.decision.outcome ?? "placed_submitted",
    buttonTextObserved: run.buttonText,
    humanCheckboxState: run.humanCheckbox,
    imageGridOpen: run.imageGridOpen,
    helperVersion: entry.helperVersion ?? PAGE_HELPER_VERSION,
  });
  if (run.decision.action === "pause_project") {
    await pauseForLowBalance(ctx, 0, { type: challenge.type, door: "page_helper" });
    return {
      kind: "step",
      lastAction: "Paused, Captell balance is low",
      hostId: host.id,
      outcome: { helper: run.decision.action },
    };
  }
  if (run.decision.action !== "submit") {
    const artifactIds = await screenshot(ctx, entry, "captcha");
    entry.registerFormReady = false;
    const event = run.decision.hostEvent;
    const apply =
      event && event !== "parked"
        ? (tx: Tx) => moveHost(tx, host, event, { captchaType: challenge.type })
        : park(ctx, host, "captcha_unsolved");
    return withEvent(
      {
        kind: "step",
        hostId: host.id,
        artifactIds,
        outcome: { helper: run.decision.action, reason: run.decision.reason ?? null },
        lastAction:
          event && event !== "parked" ? "Captcha not supported" : "Parked for the operator",
        apply,
      },
      captchaEvent(ctx, host, attempt, record),
      0,
    );
  }
  return finishRegistration(
    ctx,
    host,
    entry,
    driver,
    attempt,
    record,
    await driver.readRegistrationResult(entry.session, { waitMs: 15_000 }),
  );
}

async function widgetViaApi(
  ctx: StepContext,
  host: HostRow,
  entry: PoolEntry,
  driver: BoardDriver,
  challenge: Extract<CaptchaChallenge, { kind: "widget" }>,
  attempt: number,
): Promise<StepResult> {
  if (!challenge.siteKey) {
    entry.registerFormReady = false;
    const artifactIds = await screenshot(ctx, entry, "captcha");
    return withEvent(
      {
        kind: "step",
        lastAction: "Captcha not supported",
        hostId: host.id,
        artifactIds,
        outcome: { captcha: "missing_site_key" },
        apply: (tx) => moveHost(tx, host, "unsupported_captcha", { captchaType: challenge.type }),
      },
      captchaEvent(
        ctx,
        host,
        attempt,
        widgetRecord(challenge, "https_api", { outcome: "missing_site_key" }),
      ),
      0,
    );
  }
  const solved = await ctx.services.captcha.solve(
    { type: challenge.type, websiteURL: await entry.session.url(), websiteKey: challenge.siteKey },
    ctx.adapter,
  );
  await placeCaptchaToken(entry.session, challenge.type, solved.answer);
  return finishRegistration(
    ctx,
    host,
    entry,
    driver,
    attempt,
    widgetRecord(challenge, "https_api", {
      outcome: "placed_submitted",
      credits: solved.credits,
      balanceAfter: solved.balance,
      taskId: solved.taskId,
    }),
    await driver.submitRegistration(entry.session),
  );
}

async function solverFailure(
  ctx: StepContext,
  host: HostRow,
  entry: PoolEntry,
  attempt: number,
  error: CaptchaSolverError,
): Promise<StepResult> {
  const artifactIds = await screenshot(ctx, entry, "captcha");
  if (error.code === "credits") {
    await pauseForLowBalance(ctx, 0);
    return {
      kind: "step",
      lastAction: "Paused, Captell balance is low",
      hostId: host.id,
      artifactIds,
      outcome: { captcha: "credits" },
    };
  }
  const outcome: LbCaptchaOutcome =
    error.code === "sandbox"
      ? "sandbox"
      : error.code === "missing_site_key"
        ? "missing_site_key"
        : error.code === "unsupported"
          ? "unsupported"
          : error.code === "no_token"
            ? "no_token"
            : "operator_parked";
  entry.registerFormReady = false;
  const stop = error.code === "missing_site_key" || error.code === "unsupported";
  const note =
    error.code === "sandbox"
      ? "Captell returned a sandbox answer. The desk is not production-configured."
      : undefined;
  return withEvent(
    {
      kind: "step",
      lastAction: stop ? "Captcha not supported" : "Parked for the operator",
      hostId: host.id,
      artifactIds,
      outcome: { captcha: error.code },
      apply: stop
        ? (tx) => moveHost(tx, host, "unsupported_captcha")
        : park(ctx, host, "captcha_unsolved", { note }),
    },
    captchaEvent(ctx, host, attempt, {
      type: "unsupported",
      door: "https_api",
      outcome,
      credits: 0,
    }),
    0,
  );
}

async function finishRegistration(
  ctx: StepContext,
  host: HostRow,
  entry: PoolEntry,
  driver: BoardDriver,
  attempt: number,
  record: CaptchaRecord | null,
  result: RegistrationResult,
): Promise<StepResult> {
  const artifactIds = await screenshot(ctx, entry, "submitted");
  const event = record ? captchaEvent(ctx, host, attempt, record) : async () => undefined;
  const credits = record?.credits ?? 0;
  if (result.kind === "captcha_rejected") {
    entry.captchaAttempts = attempt;
    // The board re-renders the form; refill it so a retry or the operator only has the captcha left.
    const credentials = await ensureCredentials(ctx, host);
    await driver.fillRegistration(entry.session, credentials);
    if (attempt < MAX_CAPTCHA_ATTEMPTS) {
      return withEvent(
        {
          kind: "step",
          lastAction: "Captcha rejected, trying again",
          hostId: host.id,
          artifactIds,
          outcome: { registration: result.kind, attempt },
        },
        event,
        credits,
      );
    }
    const parkedShot = await screenshot(ctx, entry, "parked");
    entry.registerFormReady = false;
    entry.captchaAttempts = 0;
    return withEvent(
      {
        kind: "step",
        lastAction: "Parked for the operator",
        hostId: host.id,
        artifactIds: [...artifactIds, ...parkedShot],
        outcome: { registration: result.kind, attempt },
        apply: park(ctx, host, "captcha_unsolved", { note: "Captcha rejected twice" }),
      },
      event,
      credits,
    );
  }
  return withEvent(registrationOutcome(ctx, host, entry, result, artifactIds), event, credits);
}

async function emailVerify(ctx: StepContext): Promise<StepResult> {
  const host = requireHost(ctx);
  const entry = requireSession(ctx, host);
  const driver = requireDriver(host);
  const { mailbox } = ctx.services;
  if (!ctx.project.mailboxId || !mailbox.listMessages) {
    throw new StepFailure("Project mailbox cannot be read");
  }
  const account = ctx.account;
  if (!account) throw new StepFailure("Host has no account");
  const mails = await mailbox.listMessages(
    ctx.project.mailboxId,
    { since: new Date(account.createdAt.getTime() - 5 * 60_000) },
    ctx.adapter,
  );
  let link: string | null = null;
  for (const mail of [...mails].reverse()) {
    link = extractVerificationLink(mail, host.homepageUrl);
    if (link) break;
  }
  if (!link) return { kind: "wait", reason: "verification_mail" };
  await entry.session.goto(link);
  const activation = await driver.activationResult(entry.session);
  const artifactIds = await screenshot(ctx, entry, "activated");
  const verifiedAt = ctx.now;
  if (activation === "unknown") {
    return {
      kind: "step",
      lastAction: "Parked for the operator",
      hostId: host.id,
      artifactIds,
      outcome: { activation },
      apply: park(ctx, host, "unknown_page_state"),
    };
  }
  return {
    kind: "step",
    lastAction:
      activation === "active" ? "Email verified" : "Email verified, waiting for the admin",
    hostId: host.id,
    artifactIds,
    outcome: { activation },
    apply: async (tx) => {
      await tx.lbHostAccount.update({
        where: { id: account.id },
        data: { emailVerifiedAt: verifiedAt },
      });
      await moveHost(tx, host, activation === "active" ? "account_active" : "admin_pending");
    },
  };
}

async function warmup(ctx: StepContext): Promise<StepResult> {
  const host = requireHost(ctx);
  return {
    kind: "step",
    lastAction: "Account warmed up",
    hostId: host.id,
    outcome: { postCount: ctx.account?.postCount ?? 0 },
    apply: (tx) => moveHost(tx, host, "warmup_completed"),
  };
}

const REPLY_TEMPLATES: Record<string, (brand: string) => string> = {
  de: (brand) =>
    `Wir standen letztes Jahr vor derselben Frage. Eine gemeinsame Online-Liste, die alle im Vorstand bearbeiten können, hat uns viel Hin und Her erspart. Bei ${brand} ist das ganz gut beschrieben: [REF]`,
  en: (brand) =>
    `We had the same question last season. A shared online list that everyone on the committee can edit saved us a lot of back and forth. ${brand} describes the setup quite well: [REF]`,
};

/** M2 draft: a fixed template per language. The model-written draft arrives with the drafter lane. */
export function templateReply(input: {
  brandName: string;
  language: string;
  targetUrl: string;
  register: LbPersona["register"];
  format: BoardDriver["bodyFormat"];
}): string {
  const primary = input.language.split("-")[0] ?? "en";
  const template = REPLY_TEMPLATES[primary] ?? REPLY_TEMPLATES.en!;
  return insertReference(template(input.brandName), {
    targetUrl: input.targetUrl,
    anchorText: input.brandName,
    slot: "inline",
    format: input.format,
    language: input.language as LbLanguage,
    register: input.register,
  });
}

function pickTarget(project: ProjectConfig): string {
  const ordered = [...project.targets].sort((a, b) => b.priority - a.priority);
  for (const target of ordered) {
    const check = validateTargetUrl(target.url, project.allowedDomains);
    if (check.ok) return check.url;
  }
  throw new StepFailure("No target URL on an allowed domain");
}

async function post(ctx: StepContext): Promise<StepResult> {
  const host = requireHost(ctx);
  const entry = requireSession(ctx, host);
  const driver = requireDriver(host);
  const { prisma } = ctx.services;
  const account = ctx.account;
  if (!account) throw new StepFailure("Host has no account");
  if (!account.siteLoginId) {
    return {
      kind: "step",
      lastAction: "Parked for the operator",
      hostId: host.id,
      apply: park(ctx, host, "missing_password"),
    };
  }
  const password = await loadPassword(ctx, account.siteLoginId);
  if (
    !(await driver.login(entry.session, host.homepageUrl, { username: account.username, password }))
  ) {
    return {
      kind: "step",
      lastAction: "Parked for the operator",
      hostId: host.id,
      artifactIds: await screenshot(ctx, entry, "login"),
      outcome: { login: false },
      apply: park(ctx, host, "unknown_page_state", { note: "Login failed" }),
    };
  }
  const known = await prisma.lbThreadCandidate.findMany({
    where: { hostId: host.id, status: { in: ["posted", "rejected"] } },
    select: { url: true },
  });
  const skip = new Set(known.map((thread) => thread.url));
  const threads = (await driver.listThreads(entry.session, host.homepageUrl)).filter(
    (thread) => !skip.has(thread.url),
  );
  const thread = threads[0];
  if (!thread) {
    return {
      kind: "step",
      lastAction: "No open thread on this board",
      hostId: host.id,
      apply: (tx) => moveHost(tx, host, "failed", { statusReason: "no_open_thread" }),
    };
  }
  const base = {
    workspaceId: ctx.project.workspaceId,
    projectId: ctx.project.id,
    hostId: host.id,
    url: thread.url,
  };
  const upsertThread = (tx: Tx, status: string, rejectReason?: string) =>
    tx.lbThreadCandidate.upsert({
      where: { hostId_url: { hostId: host.id, url: thread.url } },
      create: {
        ...base,
        title: thread.title,
        replyCount: thread.replyCount ?? 0,
        openQuestion: thread.title.trim().endsWith("?"),
        relevance: 0.5,
        status,
        rejectReason,
      },
      update: { status, rejectReason },
    });
  if (!(await driver.openReply(entry.session, thread))) {
    return {
      kind: "step",
      lastAction: "Thread is closed for replies",
      hostId: host.id,
      outcome: { thread: thread.url },
      apply: async (tx) => {
        await upsertThread(tx, "rejected", "replies_closed");
      },
    };
  }
  const rule = driver.probeLinkRule(await entry.session.pageText());
  const targetUrl = pickTarget(ctx.project);
  const anchor = validateAnchor(ctx.project.brandName);
  if (!anchor.ok) throw new StepFailure(`Brand name is not a valid anchor (${anchor.reason})`);
  const language = ctx.project.persona.language ?? marketOf(ctx.project, host).language;
  const body = templateReply({
    brandName: anchor.text,
    language,
    targetUrl,
    register: ctx.project.persona.register,
    format: driver.bodyFormat,
  });
  await driver.fillReply(entry.session, body);
  const reply = await driver.submitReply(entry.session);
  const artifactIds = await screenshot(ctx, entry, reply.kind === "posted" ? "posted" : "reply");
  const ruleData = {
    hrefForNewMembers: rule.hrefForNewMembers,
    minPostsForLinks: rule.minPosts,
  };
  if (reply.kind === "rejected") {
    return {
      kind: "step",
      lastAction: "The board rejected the reply",
      hostId: host.id,
      artifactIds,
      outcome: { thread: thread.url, messages: redactAll(ctx, reply.messages) },
      apply: async (tx) => {
        await tx.lbHost.update({ where: { id: host.id }, data: ruleData });
        await upsertThread(tx, "rejected", redactAll(ctx, reply.messages).join(" ").slice(0, 300));
      },
    };
  }
  if (reply.kind === "unknown") {
    return {
      kind: "step",
      lastAction: "Parked for the operator",
      hostId: host.id,
      artifactIds,
      outcome: { thread: thread.url, messages: redactAll(ctx, reply.messages) },
      apply: park(ctx, host, "unknown_page_state", { note: "Reply result unclear" }),
    };
  }
  const postedAt = ctx.now;
  await entry.session.goto(reply.permalink);
  const threadShot = await screenshot(ctx, entry, "thread");
  return {
    kind: "step",
    lastAction: "Posted the reply",
    hostId: host.id,
    artifactIds: [...artifactIds, ...threadShot],
    outcome: { thread: thread.url, permalink: reply.permalink },
    run: { currentUrl: reply.permalink },
    apply: async (tx) => {
      await tx.lbHost.update({ where: { id: host.id }, data: ruleData });
      const candidate = await upsertThread(tx, "posted");
      const draft = await tx.lbDraft.create({
        data: {
          workspaceId: ctx.project.workspaceId,
          projectId: ctx.project.id,
          threadCandidateId: candidate.id,
          modelLane: "draft",
          modelId: DRAFT_MODEL_ID,
          body,
          linkSlot: "inline",
          targetUrl,
          anchorText: anchor.text,
          status: "posted",
          qualityChecks: {
            factsOnly: true,
            noBannedClaims: true,
            registerMatches: true,
            lengthOk: true,
            singleLink: true,
            notTestimonial: true,
            issues: [],
          },
        },
      });
      await tx.lbPlacement.create({
        data: {
          workspaceId: ctx.project.workspaceId,
          projectId: ctx.project.id,
          hostId: host.id,
          hostAccountId: account.id,
          draftId: draft.id,
          threadUrl: thread.url,
          postUrl: reply.permalink,
          targetUrl,
          anchorText: anchor.text,
          status: "pending",
          counted: false,
          nextVerifyAt: new Date(postedAt.getTime() + ctx.services.verifyDelayMs),
        },
      });
      await tx.lbHostAccount.update({
        where: { id: account.id },
        data: {
          postCount: { increment: 1 },
          linkPostCount: { increment: 1 },
          firstPostAt: account.firstPostAt ?? postedAt,
          lastPostAt: postedAt,
        },
      });
    },
  };
}

async function verify(ctx: StepContext): Promise<StepResult> {
  const host = requireHost(ctx);
  const placement = ctx.placement;
  if (placement?.status !== "pending") throw new StepFailure("Nothing to verify");
  if (placement.nextVerifyAt && placement.nextVerifyAt > ctx.now) {
    return { kind: "wait", reason: "verify_delay" };
  }
  // A plain logged-out fetch from the worker, never the persona browser or its exit IP.
  const checked = await verifyPlacement({
    postUrl: placement.postUrl,
    targetUrl: placement.targetUrl,
    fetchImpl: ctx.services.verifyFetch,
    allowPrivateNetwork: ctx.services.allowPrivateVerify,
  });
  const snapshotId = await ctx.storeArtifact(
    `verify-${placement.id}.html`,
    "text/html",
    new TextEncoder().encode(checked.html),
  );
  const status: LbPlacementStatus = transitionPlacement(
    placement.status as LbPlacementStatus,
    checked.outcome.status,
  );
  // The partial unique index still rejects a second counted link if another step races this one.
  const counted =
    shouldCount(checked.outcome, ctx.project.countNofollow) &&
    (await ctx.services.prisma.lbPlacement.count({ where: { hostId: host.id, counted: true } })) ===
      0;
  return {
    kind: "step",
    lastAction:
      status === "live"
        ? "Link is LIVE"
        : status === "nofollow_live"
          ? "Link is LIVE (nofollow)"
          : status === "removed"
            ? "Link was removed"
            : "Post is gone",
    hostId: host.id,
    artifactIds: [snapshotId],
    outcome: {
      status,
      rel: checked.outcome.rel,
      indexable: checked.outcome.indexable,
      httpStatus: checked.httpStatus,
    },
    run: counted ? { counters: recordCountedLive(ctx.run.counters) } : undefined,
    apply: async (tx) => {
      await tx.lbPlacement.update({
        where: { id: placement.id },
        data: {
          status,
          rel: checked.outcome.rel,
          indexable: checked.outcome.indexable,
          verifiedAt: ctx.now,
          verifyMethod: "logged_out_fetch",
          snapshotArtifactId: snapshotId,
          nextVerifyAt: new Date(ctx.now.getTime() + ctx.services.reverifyAfterMs),
          counted,
        },
      });
      if (counted) await moveHost(tx, host, "link_counted");
    },
  };
}

async function close(ctx: StepContext): Promise<StepResult> {
  const status = closingRunStatus(ctx.run.counters, ctx.project.quotas);
  return {
    kind: "step",
    lastAction: status === "succeeded" ? "Daily goal met" : "Day closed",
    hostId: ctx.host?.id ?? null,
    outcome: { status },
    run: { status: transitionRun(ctx.run.status, status), finishedAt: ctx.now },
    afterCommit: () => ctx.closeSession(),
  };
}

export function redactAll(ctx: StepContext, values: readonly string[]): string[] {
  return values.map((value) => redactText(ctx, value));
}

export function redactText(ctx: StepContext, value: string): string {
  return redactSecrets(value, ctx.secrets);
}

export function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
