import type { ProductEvent } from "@rakazo/contracts";
import type { PrismaClient } from "./client.js";

export async function appendEvent(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    threadId: string;
    botId: string;
    type: ProductEvent["type"];
    payload: Record<string, unknown>;
    runId?: string;
  },
): Promise<ProductEvent> {
  const event = await prisma.$transaction(async (tx) => {
    const last = await tx.event.findFirst({
      where: { threadId: input.threadId },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    const seq = (last?.seq ?? -1) + 1;
    return tx.event.create({
      data: {
        workspaceId: input.workspaceId,
        threadId: input.threadId,
        botId: input.botId,
        seq,
        type: input.type,
        payload: input.payload,
        runId: input.runId,
      },
    });
  });
  await prisma.$executeRaw`SELECT pg_notify('rakazo_events', ${JSON.stringify({
    workspaceId: event.workspaceId,
    threadId: event.threadId,
    botId: event.botId,
    seq: event.seq,
  })})`;
  return {
    id: event.id,
    workspaceId: event.workspaceId,
    threadId: event.threadId,
    botId: event.botId,
    seq: event.seq,
    type: event.type as ProductEvent["type"],
    runId: event.runId ?? undefined,
    createdAt: event.createdAt.toISOString(),
    payload: event.payload as Record<string, unknown>,
  };
}

export async function eventsAfter(
  prisma: PrismaClient,
  threadId: string,
  cursor: number,
) {
  return prisma.event.findMany({
    where: { threadId, seq: { gt: cursor } },
    orderBy: { seq: "asc" },
  });
}
