export type AgentMailInbox = {
  inboxId: string;
  email: string;
  displayName: string | null;
  assignedBotId: string | null;
};

type AgentMailListResponse = {
  inboxes?: Array<{
    inbox_id?: string;
    inboxId?: string;
    email?: string;
    display_name?: string;
    displayName?: string;
    metadata?: Record<string, string | number | boolean | null>;
  }>;
};

export async function listAgentMailInboxes(apiKey: string): Promise<AgentMailInbox[]> {
  const response = await fetch("https://api.agentmail.to/v0/inboxes?limit=50", {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(await agentMailError(response));
  }
  const body = (await response.json()) as AgentMailListResponse;
  return (body.inboxes ?? []).map((inbox) => {
    const inboxId = String(inbox.inbox_id ?? inbox.inboxId ?? "");
    const metadata = inbox.metadata ?? {};
    const assigned = metadata.rakazoBotId;
    return {
      inboxId,
      email: String(inbox.email ?? inboxId),
      displayName: inbox.display_name ?? inbox.displayName ?? null,
      assignedBotId: typeof assigned === "string" && assigned ? assigned : null,
    };
  });
}

export async function assignAgentMailInbox(
  apiKey: string,
  input: { inboxId: string; botId: string; workspaceId: string; displayName?: string },
): Promise<AgentMailInbox> {
  const inboxes = await listAgentMailInboxes(apiKey);
  const target = inboxes.find((inbox) => inbox.inboxId === input.inboxId);
  if (!target) throw new Error("Inbox not found");
  for (const inbox of inboxes) {
    if (inbox.assignedBotId === input.botId && inbox.inboxId !== input.inboxId) {
      await patchInbox(apiKey, inbox.inboxId, { rakazoBotId: null });
    }
  }
  await patchInbox(apiKey, input.inboxId, {
    rakazoBotId: input.botId,
    workspaceId: input.workspaceId,
  });
  return { ...target, assignedBotId: input.botId };
}

async function patchInbox(
  apiKey: string,
  inboxId: string,
  metadata: Record<string, string | null>,
) {
  const response = await fetch(
    `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ metadata }),
    },
  );
  if (!response.ok) throw new Error(await agentMailError(response));
}

async function agentMailError(response: Response) {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { message?: string; error?: { message?: string } };
    return parsed.message || parsed.error?.message || text || `AgentMail HTTP ${response.status}`;
  } catch {
    return text || `AgentMail HTTP ${response.status}`;
  }
}
