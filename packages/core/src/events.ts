import type { MessageBlock, ThreadMessage } from "@rakazo/contracts";

export function projectMessages(
  events: Array<{
    seq: number;
    type: string;
    payload: Record<string, unknown>;
    runId?: string | null;
    createdAt: Date | string;
    id: string;
    threadId: string;
  }>,
): ThreadMessage[] {
  const messages: ThreadMessage[] = [];
  for (const event of events) {
    if (event.type !== "thread.message.created") continue;
    const role = (event.payload.role as ThreadMessage["role"]) ?? "bot";
    const blocks = (event.payload.blocks as MessageBlock[]) ?? [];
    messages.push({
      id: (event.payload.messageId as string) ?? event.id,
      threadId: event.threadId,
      seq: event.seq,
      role,
      blocks,
      runId: event.runId ?? undefined,
      createdAt: typeof event.createdAt === "string" ? event.createdAt : event.createdAt.toISOString(),
    });
  }
  return messages;
}

export function redactSecrets(value: string, secrets: string[]): string {
  return secrets.reduce((acc, secret) => {
    if (!secret) return acc;
    return acc.split(secret).join("[redacted]");
  }, value);
}

export function containsSecret(value: unknown, secrets: string[]): boolean {
  const text = JSON.stringify(value);
  return secrets.some((secret) => secret.length > 0 && text.includes(secret));
}
