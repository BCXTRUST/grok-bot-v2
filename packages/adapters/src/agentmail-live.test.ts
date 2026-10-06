import type { AdapterContext } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { type AgentMailLiveClient, AgentMailMailbox } from "./agentmail-live.js";

const context: AdapterContext = {
  operationId: "mail",
  traceId: "mail",
  workspaceId: "ws",
  userId: "user",
  signal: new AbortController().signal,
};

describe("AgentMail mailbox", () => {
  it("provisions one inbox per project through the client", async () => {
    const created: string[] = [];
    const client: AgentMailLiveClient = {
      async listInboxes() {
        return created.map((projectId) => ({
          inboxId: `inb_${projectId}`,
          email: `${projectId}@inbox.example`,
          projectId,
          workspaceId: "ws",
        }));
      },
      async createInbox(input) {
        created.push(input.projectId);
        return { inboxId: `inb_${input.projectId}`, email: `${input.username}@inbox.example` };
      },
    };
    const mailbox = new AgentMailMailbox(client);
    const first = await mailbox.ensureInbox("project-a", context);
    const again = await mailbox.ensureInbox("project-a", context);
    const other = await mailbox.ensureInbox("project-b", context);
    expect(first.inboxId).toBe(again.inboxId);
    expect(other.inboxId).not.toBe(first.inboxId);
    expect(created).toEqual(["project-a", "project-b"]);
  });
});
