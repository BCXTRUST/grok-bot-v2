import { describe, expect, it, vi } from "vitest";
import { AgentMailInboxProvider, type AgentMailSdk } from "./agentmail-inbox.js";
import {
  botInboxClientId,
  botInboxUsername,
  ensureBotInbox,
  inboxRefFromBot,
  mailInstruction,
} from "./bot-inbox.js";
import { FakeAgentInboxProvider } from "./fake-inbox.js";

const context = {
  operationId: "inbox-test",
  traceId: "inbox-test",
  workspaceId: "workspace-1",
  userId: "user-1",
  signal: new AbortController().signal,
};

describe("bot inbox usernames", () => {
  it("builds a short lastname.initial username from the bot name", () => {
    expect(botInboxUsername("cmt8shbab0002wbjscmcade55", "Helen Marsh")).toBe("marsh.h");
    expect(botInboxUsername("cmt8shbab0002wbjscmcade55", "Link Builder")).toBe("builder.l");
    expect(botInboxUsername("bot-1", "Chief")).toBe("chief");
    expect(botInboxUsername("cmt8shbab0002wbjscmcade55", "Link Builder", true)).toBe(
      "builder.l.de55",
    );
    expect(botInboxClientId("bot-1")).toBe("rakazo-bot-bot-1");
  });
});

describe("ensureBotInbox", () => {
  it("provisions once and reuses the stored address", async () => {
    const inbox = new FakeAgentInboxProvider();
    const bots = new Map<string, { inboxProvider: string | null; inboxId: string | null; inboxAddress: string | null }>();
    const prisma = {
      bot: {
        findFirst: async ({ where }: { where: { id: string } }) => ({
          ...(bots.get(where.id) ?? { inboxProvider: null, inboxId: null, inboxAddress: null }),
        }),
        updateMany: async ({
          where,
          data,
        }: {
          where: { id: string; inboxId: null };
          data: { inboxProvider: string; inboxId: string; inboxAddress: string };
        }) => {
          const current = bots.get(where.id);
          if (current?.inboxId) return { count: 0 };
          bots.set(where.id, data);
          return { count: 1 };
        },
      },
    } as never;

    const first = await ensureBotInbox(
      { prisma, inbox },
      { id: "bot-1", name: "Link Builder", workspaceId: "workspace-1", userId: "user-1" },
      context,
    );
    const second = await ensureBotInbox(
      { prisma, inbox },
      { id: "bot-1", name: "Link Builder", workspaceId: "workspace-1", userId: "user-1" },
      context,
    );

    expect(first?.address).toMatch(/builder\.l@/);
    expect(second).toEqual(first);
    expect(inbox.boxes.size).toBe(1);
    expect(mailInstruction(first?.address)).toContain(first!.address);
    expect(inboxRefFromBot({ inboxProvider: null, inboxId: null, inboxAddress: null })).toBeNull();
  });
});

describe("AgentMail inbox adapter", () => {
  it("creates an inbox with a stable client id and maps message bodies", async () => {
    const created = vi.fn(async () => ({
      inboxId: "inb_1",
      email: "link.builder.bot-1@faircroft.us",
    }));
    const sdk: AgentMailSdk = {
      inboxes: {
        create: created,
        get: async () => ({ inboxId: "a@x.test", email: "a@x.test" }),
        messages: {
          list: async () => [{ messageId: "msg-1", from: "human@x.test", subject: "Hi" }],
          get: async () => ({
            messageId: "msg-1",
            from: "human@x.test",
            extractedText: "please reply",
            to: ["a@x.test"],
            subject: "Hi",
          }),
          send: async () => ({ messageId: "msg-2" }),
          reply: async () => ({ messageId: "msg-3" }),
        },
      },
    };
    const provider = new AgentMailInboxProvider(sdk, "faircroft.us");
    const inbox = await provider.provision(
      { botId: "bot-1", name: "Link Builder", workspaceId: "ws" },
      context,
    );
    expect(created).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "rakazo-bot-bot-1",
        domain: "faircroft.us",
        displayName: "Link Builder",
      }),
    );
    expect(inbox.address).toBe("link.builder.bot-1@faircroft.us");
    expect(await provider.listMessages(inbox, {}, context)).toEqual([
      { id: "msg-1", from: "human@x.test", subject: "Hi", createdAt: undefined },
    ]);
    expect(await provider.readMessage(inbox, "msg-1", context)).toMatchObject({
      text: "please reply",
    });
  });

  it("does not retry username changes when the AgentMail inbox limit is reached", async () => {
    const created = vi.fn(async () => {
      throw { body: { code: "limit_exceeded" } };
    });
    const provider = new AgentMailInboxProvider(
      { inboxes: { create: created, get: async () => ({}), messages: {} as never } },
      "faircroft.us",
    );
    await expect(
      provider.provision({ botId: "bot-2", name: "Overflow", workspaceId: "ws" }, context),
    ).rejects.toThrow(/inbox limit reached/i);
    expect(created).toHaveBeenCalledTimes(1);
  });
});

