import { createHash, randomUUID } from "node:crypto";
import type {
  AdapterContext,
  ArtifactStore,
  BrowserSession,
  BrowserSessionFactory,
  CaptchaSolver,
  MailboxProvider,
  RealtimeFanout,
} from "@rakazo/adapter-kit";
import type { EncryptedSecretStore } from "@rakazo/adapters";
import {
  type LbHostStatus,
  LbMarketsSchema,
  LbOperatorSettingsSchema,
  LbPersonaSchema,
  LbQuotasSchema,
  type LbRunStatus,
  LbRunStatusSchema,
  LbScheduleSchema,
  LbTargetSchema,
  LbWarmupSchema,
} from "@rakazo/contracts";
import type { Prisma, PrismaClient } from "@rakazo/db";
import {
  isHostTerminal,
  isLiveMet,
  isRunActive,
  isWarmupMet,
  isWithinWindow,
  linkBuilderTopic,
  marketKey,
  planRealStep,
  type RealPlan,
  redactSecrets,
  transitionRun,
} from "@rakazo/linkbuilder-core";
import {
  browserPersona,
  isUnique,
  marketOf,
  moveHost,
  type PoolEntry,
  type ProjectConfig,
  REAL_STEP_HANDLERS,
  type RealWorkerServices,
  type RunRow,
  StaleState,
  type StepContext,
  type StepResult,
} from "./link-builder-real-steps.js";

/**
 * M2 browser-driven runner behind `LINK_BUILDER_DRIVER=real`. Each tick takes at most one step
 * per run: one typed transition, persisted as one `LbRunStep` keyed by `runId + stepIndex`, while
 * the run's lease is held under a per-project advisory lock.
 */
export function isLinkBuilderRealEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LINK_BUILDER_DRIVER === "real";
}

export interface LinkBuilderRealDeps {
  prisma: PrismaClient;
  secrets: EncryptedSecretStore;
  artifacts: ArtifactStore;
  browsers: BrowserSessionFactory;
  captcha: CaptchaSolver;
  mailbox: MailboxProvider;
  realtime?: RealtimeFanout;
  /** Tests point this at the offline fixture; production uses the global fetch. */
  verifyFetch?: typeof fetch;
  /** Only for offline fixtures on loopback. */
  allowPrivateVerify?: boolean;
  now?: () => Date;
  workerId?: string;
  leaseMs?: number;
  verifyDelayMs?: number;
  reverifyAfterMs?: number;
  pageHelperButtonSelector?: string;
  pageHelperPollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_LEASE_MS = 5 * 60_000;
const DEFAULT_VERIFY_DELAY_MS = 60_000;
const DEFAULT_REVERIFY_MS = 24 * 3_600_000;
const MAX_CONSECUTIVE_ERRORS = 3;

export type TickOutcome = "stepped" | "waited" | "skipped" | "failed";

export class LinkBuilderRealRunner {
  private readonly pool = new Map<string, PoolEntry>();
  private readonly services: RealWorkerServices;
  private readonly workerId: string;
  private readonly leaseMs: number;
  private readonly now: () => Date;

  constructor(private readonly deps: LinkBuilderRealDeps) {
    this.workerId = deps.workerId ?? `lb-real-${randomUUID()}`;
    this.leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS;
    this.now = deps.now ?? (() => new Date());
    this.services = {
      prisma: deps.prisma,
      secrets: deps.secrets,
      artifacts: deps.artifacts,
      browsers: deps.browsers,
      captcha: deps.captcha,
      mailbox: deps.mailbox,
      verifyFetch: deps.verifyFetch,
      allowPrivateVerify: deps.allowPrivateVerify ?? false,
      verifyDelayMs: deps.verifyDelayMs ?? DEFAULT_VERIFY_DELAY_MS,
      reverifyAfterMs: deps.reverifyAfterMs ?? DEFAULT_REVERIFY_MS,
      pageHelperButtonSelector: deps.pageHelperButtonSelector ?? "[data-page-helper]",
      pageHelperPollMs: deps.pageHelperPollMs ?? 250,
      sleep: deps.sleep,
    };
  }

  /** The open persona browser of a project, for tests and operator tooling. */
  sessionFor(projectId: string): BrowserSession | null {
    return this.pool.get(projectId)?.session ?? null;
  }

  async tick(): Promise<number> {
    const runs = await this.deps.prisma.lbRun.findMany({
      where: { status: { in: ["running", "overtime"] }, project: { status: "active" } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    let stepped = 0;
    for (const run of runs) {
      try {
        if ((await this.step(run.id)) === "stepped") stepped += 1;
      } catch (error) {
        console.error(
          "linkbuilder.real",
          run.id,
          error instanceof Error ? error.message : "step failed",
        );
      }
    }
    return stepped;
  }

  /** Takes the next step of one run; never throws for a step failure. */
  async step(runId: string): Promise<TickOutcome> {
    const now = this.now();
    const fence = await this.claim(runId, now);
    if (fence === null) return "skipped";
    const ctx = await this.load(runId, now);
    if (!ctx) return "skipped";
    const plan = this.plan(ctx);
    if (plan.kind === "done" || plan.kind === "wait") return "waited";
    const startedAt = new Date();
    let result: StepResult;
    let error: string | null = null;
    try {
      result = await REAL_STEP_HANDLERS[plan.kind](ctx);
    } catch (caught) {
      error = redactSecrets(caught instanceof Error ? caught.message : "Step failed", ctx.secrets);
      result = await this.failure(ctx, error);
    }
    if (result.kind === "wait") return "waited";
    const committed = await this.commit(ctx, fence, plan.kind, result, error, startedAt);
    if (!committed) return "skipped";
    await result.afterCommit?.();
    await this.deps.realtime
      ?.publish(
        linkBuilderTopic(ctx.project.id),
        JSON.stringify({ cursor: `${runId}:${ctx.stepIndex}` }),
      )
      .catch(() => undefined);
    return error ? "failed" : "stepped";
  }

  async close(): Promise<void> {
    const entries = [...this.pool.values()];
    this.pool.clear();
    await Promise.all(entries.map((entry) => entry.session.close().catch(() => undefined)));
  }

  private async claim(runId: string, now: Date): Promise<number | null> {
    return this.deps.prisma.$transaction(async (tx) => {
      const run = await tx.lbRun.findUnique({
        where: { id: runId },
        select: {
          projectId: true,
          status: true,
          leaseOwner: true,
          leaseFence: true,
          leaseExpiresAt: true,
        },
      });
      if (!run) return null;
      const status = LbRunStatusSchema.safeParse(run.status);
      if (!status.success || !isRunActive(status.data)) return null;
      const lockKey = `lb-project:${run.projectId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}::text, 0))`;
      const busy = await tx.lbRun.count({
        where: {
          projectId: run.projectId,
          leaseOwner: { not: this.workerId },
          leaseExpiresAt: { gt: now },
        },
      });
      if (busy > 0) return null;
      const held =
        run.leaseOwner === this.workerId && (run.leaseExpiresAt?.getTime() ?? 0) > now.getTime();
      const fence = held ? run.leaseFence : run.leaseFence + 1;
      await tx.lbRun.update({
        where: { id: runId },
        data: {
          leaseOwner: this.workerId,
          leaseFence: fence,
          leaseExpiresAt: new Date(now.getTime() + this.leaseMs),
        },
      });
      return fence;
    });
  }

  private async load(runId: string, now: Date): Promise<StepContext | null> {
    const { prisma } = this.deps;
    const run = await prisma.lbRun.findUnique({
      where: { id: runId },
      include: { project: true, _count: { select: { steps: true } } },
    });
    if (!run) return null;
    const status = LbRunStatusSchema.safeParse(run.status);
    const project = projectConfig(run.project);
    if (!status.success || !project) return null;
    const host = run.currentHostId
      ? await prisma.lbHost.findUnique({ where: { id: run.currentHostId } })
      : null;
    const account = host
      ? await prisma.lbHostAccount.findUnique({ where: { hostId: host.id } })
      : null;
    const placement = host
      ? await prisma.lbPlacement.findFirst({
          where: { hostId: host.id, projectId: project.id },
          orderBy: { createdAt: "desc" },
        })
      : null;
    const runRow: RunRow = {
      id: run.id,
      status: status.data,
      counters: {
        newToday: run.newToday,
        liveToday: run.liveToday,
        liveWeek: run.liveWeek,
        uniqueHosts: run.uniqueHosts,
      },
    };
    const adapter: AdapterContext = {
      operationId: `lb-run:${run.id}:${run._count.steps}`,
      traceId: `lb-run:${run.id}`,
      workspaceId: project.workspaceId,
      userId: project.ownerUserId,
      signal: new AbortController().signal,
    };
    const ctx: StepContext = {
      services: this.services,
      now,
      run: runRow,
      stepIndex: run._count.steps,
      project,
      host,
      account,
      placement,
      adapter,
      secrets: [],
      pool: () => this.pool.get(project.id),
      openSession: (target) => this.openSession(ctx, target),
      closeSession: () => this.closeSession(project.id),
      storeArtifact: (name, mimeType, bytes) => this.storeArtifact(ctx, name, mimeType, bytes),
    };
    return ctx;
  }

  private plan(ctx: StepContext): RealPlan {
    const quotas = ctx.project.quotas;
    const liveMet = isLiveMet(ctx.run.counters, quotas);
    const schedule = isWithinWindow(ctx.now, ctx.project.schedule, { liveMet });
    if (!schedule.active && !liveMet) return { kind: "close" };
    const entry = this.pool.get(ctx.project.id);
    const host = ctx.host;
    return planRealStep({
      runStatus: ctx.run.status,
      liveMet,
      host: host
        ? {
            id: host.id,
            status: host.status as never,
            parkedFrom: (host.parkedFrom as never) ?? null,
          }
        : null,
      session: {
        hostId: entry?.hostId ?? null,
        cookieChecked: entry?.cookieChecked ?? false,
        registerFormReady: entry?.registerFormReady ?? false,
      },
      warmupMet: ctx.account
        ? isWarmupMet({
            postCount: ctx.account.postCount,
            accountCreatedAt: ctx.account.createdAt,
            now: ctx.now,
            ...ctx.project.warmup,
          })
        : false,
      placement: ctx.placement
        ? { status: ctx.placement.status as never, counted: ctx.placement.counted }
        : null,
    });
  }

  /**
   * A failed step drops the persona session so the next tick re-reads the page from scratch.
   * After repeated failures on one host the host is given up.
   */
  private async failure(ctx: StepContext, message: string): Promise<StepResult> {
    await this.closeSession(ctx.project.id);
    const host = ctx.host;
    const recent = await this.deps.prisma.lbRunStep.findMany({
      where: { runId: ctx.run.id },
      orderBy: { stepIndex: "desc" },
      take: MAX_CONSECUTIVE_ERRORS - 1,
      select: { error: true, hostId: true },
    });
    const giveUp =
      host !== null &&
      !isHostTerminal(host.status as LbHostStatus) &&
      recent.length === MAX_CONSECUTIVE_ERRORS - 1 &&
      recent.every((step) => step.error && step.hostId === host.id);
    return {
      kind: "step",
      lastAction: giveUp ? "Gave up on this board" : "Step failed, retrying",
      hostId: host?.id ?? null,
      outcome: { error: message },
      apply: giveUp
        ? (tx) => moveHost(tx, host, "failed", { statusReason: message.slice(0, 500) })
        : undefined,
    };
  }

  private async commit(
    ctx: StepContext,
    fence: number,
    kind: string,
    result: Extract<StepResult, { kind: "step" }>,
    error: string | null,
    startedAt: Date,
  ): Promise<boolean> {
    const patch = result.run ?? {};
    const counters = patch.counters;
    const status = this.nextRunStatus(ctx, patch.status);
    try {
      await this.deps.prisma.$transaction(async (tx) => {
        const fenced = await tx.lbRun.updateMany({
          where: { id: ctx.run.id, leaseOwner: this.workerId, leaseFence: fence },
          data: {
            lastAction: result.lastAction,
            lastError: error,
            ...(status !== ctx.run.status ? { status } : {}),
            ...(counters ?? {}),
            ...(patch.currentHostId !== undefined ? { currentHostId: patch.currentHostId } : {}),
            ...(patch.currentUrl !== undefined ? { currentUrl: patch.currentUrl } : {}),
            ...(patch.finishedAt ? { finishedAt: patch.finishedAt, leaseExpiresAt: null } : {}),
          },
        });
        if (fenced.count !== 1) throw new StaleState("Run lease was lost");
        await result.apply?.(tx);
        await tx.lbRunStep.create({
          data: {
            workspaceId: ctx.project.workspaceId,
            runId: ctx.run.id,
            stepIndex: ctx.stepIndex,
            kind,
            hostId: result.hostId,
            input: json({ hostStatus: ctx.host?.status ?? null }),
            outcome: json({
              lastAction: result.lastAction,
              ...redactOutcome(result.outcome ?? {}, ctx.secrets),
            }),
            error,
            artifactIds: result.artifactIds ?? [],
            costs: json({
              credits: result.credits ?? 0,
              tokens: 0,
              bytes: 0,
              ms: Date.now() - startedAt.getTime(),
            }),
            startedAt,
            finishedAt: new Date(),
          },
        });
      });
      return true;
    } catch (caught) {
      if (caught instanceof StaleState || isUnique(caught)) return false;
      throw caught;
    }
  }

  private nextRunStatus(ctx: StepContext, requested: LbRunStatus | undefined): LbRunStatus {
    if (requested) return requested;
    const liveMet = isLiveMet(ctx.run.counters, ctx.project.quotas);
    const schedule = isWithinWindow(ctx.now, ctx.project.schedule, { liveMet });
    if (schedule.mode === "overtime" && ctx.run.status === "running") {
      return transitionRun(ctx.run.status, "overtime");
    }
    return ctx.run.status;
  }

  private async openSession(
    ctx: StepContext,
    host: { id: string } & Parameters<typeof marketOf>[1],
  ) {
    const key = marketKey(marketOf(ctx.project, host));
    const existing = this.pool.get(ctx.project.id);
    if (existing && existing.marketKey === key) return existing;
    if (existing) await this.closeSession(ctx.project.id);
    const session = await this.deps.browsers.open(browserPersona(ctx, host), ctx.adapter);
    const entry: PoolEntry = {
      session,
      marketKey: key,
      hostId: null,
      cookieChecked: false,
      registerFormReady: false,
      captchaAttempts: 0,
    };
    this.pool.set(ctx.project.id, entry);
    return entry;
  }

  private async closeSession(projectId: string): Promise<void> {
    const entry = this.pool.get(projectId);
    this.pool.delete(projectId);
    await entry?.session.close().catch(() => undefined);
  }

  private async storeArtifact(
    ctx: StepContext,
    name: string,
    mimeType: string,
    bytes: Uint8Array,
  ): Promise<string> {
    const stored = await this.deps.artifacts.put({ name, mimeType, bytes }, ctx.adapter);
    const row = await this.deps.prisma.artifact
      .create({
        data: {
          workspaceId: ctx.project.workspaceId,
          userId: ctx.project.ownerUserId,
          runId: null,
          name,
          mimeType,
          size: bytes.byteLength,
          hash: createHash("sha256").update(bytes).digest("hex"),
          storageKey: stored.id,
        },
        select: { id: true },
      })
      .catch(async (error: unknown) => {
        await this.deps.artifacts.remove(stored.id, ctx.adapter).catch(() => undefined);
        throw error;
      });
    return row.id;
  }
}

export function startLinkBuilderRealRunner(
  deps: LinkBuilderRealDeps & { intervalMs?: number; env?: NodeJS.ProcessEnv },
): { runner: LinkBuilderRealRunner | null; stop: () => Promise<void> } {
  if (!isLinkBuilderRealEnabled(deps.env)) return { runner: null, stop: async () => {} };
  const runner = new LinkBuilderRealRunner(deps);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const interval = deps.intervalMs ?? 2_000;
  const loop = () => {
    if (stopped) return;
    void runner
      .tick()
      .catch((error: unknown) => {
        console.error("linkbuilder.real", error instanceof Error ? error.message : "tick failed");
      })
      .finally(() => {
        if (!stopped) timer = setTimeout(loop, interval);
      });
  };
  loop();
  return {
    runner,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await runner.close();
    },
  };
}

function projectConfig(row: {
  id: string;
  workspaceId: string;
  createdByUserId: string;
  status: string;
  brandName: string;
  allowedDomains: string[];
  persona: unknown;
  markets: unknown;
  quotas: unknown;
  schedule: unknown;
  warmup: unknown;
  targets: unknown;
  countNofollow: boolean;
  denyHosts: string[];
  preferHosts: string[];
  mailboxId: string | null;
  mailboxAddress: string | null;
  operator: unknown;
}): ProjectConfig | null {
  if (row.status !== "active") return null;
  const persona = LbPersonaSchema.safeParse(row.persona);
  const markets = LbMarketsSchema.safeParse(row.markets);
  const quotas = LbQuotasSchema.safeParse(row.quotas);
  const schedule = LbScheduleSchema.safeParse(row.schedule);
  const warmup = LbWarmupSchema.safeParse(row.warmup);
  const targets = LbTargetSchema.array().safeParse(row.targets);
  const operator = LbOperatorSettingsSchema.safeParse(row.operator);
  if (!persona.success || !markets.success || !quotas.success || !schedule.success) return null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    ownerUserId: row.createdByUserId,
    brandName: row.brandName,
    allowedDomains: row.allowedDomains,
    persona: persona.data,
    markets: markets.data,
    quotas: quotas.data,
    schedule: schedule.data,
    warmup: warmup.success ? warmup.data : LbWarmupSchema.parse({}),
    targets: targets.success ? targets.data : [],
    countNofollow: row.countNofollow,
    denyHosts: row.denyHosts,
    preferHosts: row.preferHosts,
    mailboxId: row.mailboxId,
    mailboxAddress: row.mailboxAddress,
    operatorTtlHours: operator.success ? operator.data.parkedHostTtlHours : 48,
  };
}

function redactOutcome(
  outcome: Record<string, unknown>,
  secrets: string[],
): Record<string, unknown> {
  return JSON.parse(redactSecrets(JSON.stringify(outcome), secrets)) as Record<string, unknown>;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
