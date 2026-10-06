import type { Prisma, PrismaClient } from "@rakazo/db";
import { localClock } from "@rakazo/linkbuilder-core";

function isUnique(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

export async function recordCost(
  prisma: PrismaClient,
  entry: {
    workspaceId: string;
    projectId: string;
    runId?: string | null;
    kind: "captell_credits" | "model_tokens" | "search_query" | "proxy_lease_day";
    lane?: string | null;
    quantity: number;
    sourceKey: string;
    occurredAt: Date;
  },
): Promise<void> {
  if (entry.quantity <= 0) return;
  try {
    await prisma.lbCostEntry.create({
      data: {
        workspaceId: entry.workspaceId,
        projectId: entry.projectId,
        runId: entry.runId ?? null,
        kind: entry.kind,
        lane: entry.lane ?? null,
        quantity: entry.quantity,
        sourceKey: entry.sourceKey,
        occurredAt: entry.occurredAt,
      },
    });
  } catch (error) {
    if (!isUnique(error)) throw error;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Copies Captell credits and model tokens onto the ledger. Search and proxy rows are written at the source. */
export async function syncCostLedger(prisma: PrismaClient): Promise<void> {
  const [events, steps] = await Promise.all([
    prisma.lbCaptchaEvent.findMany({
      where: { creditsCharged: { gt: 0 } },
      select: {
        id: true,
        workspaceId: true,
        projectId: true,
        runId: true,
        creditsCharged: true,
        createdAt: true,
      },
    }),
    prisma.lbRunStep.findMany({
      select: {
        id: true,
        workspaceId: true,
        runId: true,
        costs: true,
        outcome: true,
        createdAt: true,
        run: { select: { projectId: true } },
      },
    }),
  ]);
  for (const event of events) {
    await recordCost(prisma, {
      workspaceId: event.workspaceId,
      projectId: event.projectId,
      runId: event.runId,
      kind: "captell_credits",
      quantity: event.creditsCharged,
      sourceKey: `captcha:${event.id}`,
      occurredAt: event.createdAt,
    });
  }
  for (const step of steps) {
    const costs = asRecord(step.costs);
    const tokens = typeof costs.tokens === "number" ? costs.tokens : 0;
    const outcome = asRecord(step.outcome);
    const lane = typeof outcome.modelLane === "string" ? outcome.modelLane : null;
    await recordCost(prisma, {
      workspaceId: step.workspaceId,
      projectId: step.run.projectId,
      runId: step.runId,
      kind: "model_tokens",
      lane,
      quantity: tokens,
      sourceKey: `step-tokens:${step.id}`,
      occurredAt: step.createdAt,
    });
  }
}

export function costTotals(
  entries: Array<{ kind: string; quantity: number; occurredAt: Date }>,
  range: { from: string; to: string; timeZone: string },
): { captellCredits: number; modelTokens: number; searchQueries: number; proxyLeaseDays: number } {
  const totals = {
    captellCredits: 0,
    modelTokens: 0,
    searchQueries: 0,
    proxyLeaseDays: 0,
  };
  for (const entry of entries) {
    let date = "";
    try {
      date = localClock(entry.occurredAt, range.timeZone).dateKey;
    } catch {
      continue;
    }
    if (date < range.from || date > range.to) continue;
    if (entry.kind === "captell_credits") totals.captellCredits += entry.quantity;
    if (entry.kind === "model_tokens") totals.modelTokens += entry.quantity;
    if (entry.kind === "search_query") totals.searchQueries += entry.quantity;
    if (entry.kind === "proxy_lease_day") totals.proxyLeaseDays += entry.quantity;
  }
  return totals;
}

export function jsonCost(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
