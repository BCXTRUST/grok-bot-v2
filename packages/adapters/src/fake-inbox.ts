import type {
  AdapterContext,
  AgentInboxProvider,
  AgentInboxRef,
  AgentMailMessage,
} from "@rakazo/adapter-kit";
import { botInboxClientId, botInboxUsername, inboxAddressFitsName } from "./bot-inbox.js";

export class FakeAgentInboxProvider implements AgentInboxProvider {
  readonly boxes = new Map<string, AgentInboxRef>();
  readonly messages = new Map<string, AgentMailMessage[]>();
  private seq = 0;

  describe() {
    return {
      id: "fake-inbox",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { provision: true, send: true, list: true },
    };
  }

  async provision(
    request: { botId: string; name: string; workspaceId: string },
    _context: AdapterContext,
  ): Promise<AgentInboxRef> {
    const existing = [...this.boxes.values()].find((inbox) =>
      inbox.inboxId.includes(botInboxClientId(request.botId)),
    );
    if (existing && inboxAddressFitsName(existing.address, request.name)) return existing;
    if (existing) {
      this.boxes.delete(existing.inboxId);
      this.messages.delete(existing.inboxId);
    }
    const username = botInboxUsername(request.botId, request.name);
    const ref: AgentInboxRef = {
      provider: "fake-inbox",
      inboxId: `${botInboxClientId(request.botId)}@mail.test`,
      address: `${username}@mail.test`,
    };
    this.boxes.set(ref.inboxId, ref);
    this.messages.set(ref.inboxId, []);
    return ref;
  }

  async listMessages(inbox: AgentInboxRef) {
    return (this.messages.get(inbox.inboxId) ?? []).map((message) => ({
      id: message.id,
      from: message.from,
      subject: message.subject,
      createdAt: message.createdAt,
    }));
  }

  async readMessage(inbox: AgentInboxRef, messageId: string) {
    const found = (this.messages.get(inbox.inboxId) ?? []).find((message) => message.id === messageId);
    if (!found) throw new Error("mail message not found");
    return found;
  }

  async sendMessage(
    inbox: AgentInboxRef,
    request: { to: string[]; subject: string; text: string },
  ) {
    return this.push(inbox, {
      from: inbox.address,
      to: request.to,
      subject: request.subject,
      text: request.text,
    });
  }

  async replyMessage(inbox: AgentInboxRef, request: { messageId: string; text: string }) {
    const parent = await this.readMessage(inbox, request.messageId);
    return this.push(inbox, {
      from: inbox.address,
      to: [parent.from],
      subject: parent.subject.startsWith("Re:") ? parent.subject : `Re: ${parent.subject}`,
      text: request.text,
    });
  }

  receive(inbox: AgentInboxRef, message: Omit<AgentMailMessage, "id">) {
    return this.push(inbox, message);
  }

  private push(inbox: AgentInboxRef, message: Omit<AgentMailMessage, "id">) {
    this.seq += 1;
    const stored: AgentMailMessage = { ...message, id: `msg-${this.seq}` };
    const current = this.messages.get(inbox.inboxId) ?? [];
    current.unshift(stored);
    this.messages.set(inbox.inboxId, current);
    return { id: stored.id };
  }
}
