import type {
  AdapterContext,
  AgentInboxProvider,
  AgentInboxRef,
  AgentMailMessage,
} from "@rakazo/adapter-kit";
import { botInboxClientId, botInboxUsernames, inboxAddressFitsName } from "./bot-inbox.js";

interface AgentMailInboxRecord {
  inboxId?: string;
  inbox_id?: string;
  email?: string;
}

interface AgentMailListedMessage {
  messageId?: string;
  message_id?: string;
  from?: string;
  subject?: string;
  timestamp?: string;
  createdAt?: string;
}

interface AgentMailFullMessage extends AgentMailListedMessage {
  extractedText?: string;
  extracted_text?: string;
  extractedHtml?: string;
  extracted_html?: string;
  text?: string;
  html?: string;
  to?: string[] | string;
}

interface AgentMailMessagesApi {
  list(
    inboxId: string,
    request?: { limit?: number },
  ): Promise<{ messages?: AgentMailListedMessage[] } | AgentMailListedMessage[]>;
  get(inboxId: string, messageId: string): Promise<AgentMailFullMessage>;
  send(
    inboxId: string,
    request: { to: string[]; subject: string; text: string },
  ): Promise<{ messageId?: string; message_id?: string }>;
  reply(
    inboxId: string,
    messageId: string,
    request: { text: string },
  ): Promise<{ messageId?: string; message_id?: string }>;
}

export interface AgentMailSdk {
  inboxes: {
    create(request: {
      username?: string;
      domain?: string;
      displayName?: string;
      clientId?: string;
      metadata?: Record<string, string>;
    }): Promise<AgentMailInboxRecord>;
    get(inboxId: string): Promise<AgentMailInboxRecord>;
    delete?(inboxId: string): Promise<void>;
    messages: AgentMailMessagesApi;
  };
}

export class AgentMailInboxProvider implements AgentInboxProvider {
  constructor(
    private readonly client: AgentMailSdk,
    private readonly domain?: string,
  ) {}

  describe() {
    return {
      id: "agentmail",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { provision: true, send: true, list: true },
    };
  }

  async provision(
    request: { botId: string; name: string; workspaceId: string },
    _context: AdapterContext,
  ): Promise<AgentInboxRef> {
    const payload = {
      ...(this.domain ? { domain: this.domain } : {}),
      displayName: request.name,
      clientId: botInboxClientId(request.botId),
      metadata: { rakazoBotId: request.botId, workspaceId: request.workspaceId },
    };
    let lastError: unknown;
    for (const username of botInboxUsernames(request.name)) {
      try {
        const created = toInboxRef(
          await this.client.inboxes.create({
            ...payload,
            username,
          }),
        );
        if (inboxAddressFitsName(created.address, request.name)) return created;
        await this.client.inboxes.delete?.(created.inboxId);
        const replaced = toInboxRef(
          await this.client.inboxes.create({
            ...payload,
            username,
          }),
        );
        if (inboxAddressFitsName(replaced.address, request.name)) return replaced;
      } catch (error) {
        lastError = error;
        if (isLimitExceeded(error)) {
          throw new Error(
            "AgentMail inbox limit reached. Delete unused inboxes or upgrade the plan, then retry.",
          );
        }
        const existingId = this.domain ? `${username}@${this.domain}` : username;
        const existing = await this.client.inboxes.get(existingId).catch(() => undefined);
        if (existing) {
          const reused = toInboxRef(existing);
          if (inboxAddressFitsName(reused.address, request.name)) return reused;
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Could not create a natural AgentMail address for this bot.");
  }

  async listMessages(
    inbox: AgentInboxRef,
    request: { limit?: number },
    _context: AdapterContext,
  ) {
    const listed = await this.client.inboxes.messages.list(inbox.inboxId, {
      limit: request.limit ?? 20,
    });
    const messages = Array.isArray(listed) ? listed : (listed.messages ?? []);
    return messages.map((message) => ({
      id: messageId(message),
      from: message.from ?? "",
      subject: message.subject ?? "",
      createdAt: message.createdAt ?? message.timestamp,
    }));
  }

  async readMessage(inbox: AgentInboxRef, messageIdValue: string, _context: AdapterContext) {
    const message = await this.client.inboxes.messages.get(inbox.inboxId, messageIdValue);
    return toMailMessage(message);
  }

  async sendMessage(
    inbox: AgentInboxRef,
    request: { to: string[]; subject: string; text: string },
    _context: AdapterContext,
  ) {
    const sent = await this.client.inboxes.messages.send(inbox.inboxId, request);
    return { id: sent.messageId ?? sent.message_id ?? "" };
  }

  async replyMessage(
    inbox: AgentInboxRef,
    request: { messageId: string; text: string },
    _context: AdapterContext,
  ) {
    const sent = await this.client.inboxes.messages.reply(inbox.inboxId, request.messageId, {
      text: request.text,
    });
    return { id: sent.messageId ?? sent.message_id ?? "" };
  }
}

export async function createAgentMailInboxProvider(options: {
  apiKey?: string;
  domain?: string;
}): Promise<AgentInboxProvider | undefined> {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) return undefined;
  try {
    const { AgentMailClient } = await import("agentmail");
    return new AgentMailInboxProvider(
      new AgentMailClient({ apiKey }) as unknown as AgentMailSdk,
      options.domain?.trim() || undefined,
    );
  } catch (error) {
    console.error("AgentMail SDK failed to load", error);
    return undefined;
  }
}

function isLimitExceeded(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const body = "body" in error ? (error as { body?: { code?: string } }).body : undefined;
  return body?.code === "limit_exceeded";
}

function toInboxRef(inbox: AgentMailInboxRecord): AgentInboxRef {
  const inboxId = inbox.inboxId ?? inbox.inbox_id;
  const address = inbox.email ?? inboxId;
  if (!inboxId || !address) throw new Error("AgentMail inbox create did not return an address");
  return { provider: "agentmail", inboxId, address };
}

function messageId(message: AgentMailListedMessage) {
  return message.messageId ?? message.message_id ?? "";
}

function toMailMessage(message: AgentMailFullMessage): AgentMailMessage {
  const to = Array.isArray(message.to) ? message.to : message.to ? [message.to] : [];
  const text =
    message.extractedText ??
    message.extracted_text ??
    message.text ??
    message.extractedHtml ??
    message.extracted_html ??
    message.html ??
    "";
  return {
    id: messageId(message),
    from: message.from ?? "",
    to,
    subject: message.subject ?? "",
    text,
    links: extractHttpUrls(text),
    createdAt: message.createdAt ?? message.timestamp,
  };
}

function extractHttpUrls(text: string) {
  return [...new Set(text.match(/https?:\/\/[^\s"'<>]+/gi) ?? [])];
}
