import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  AdapterContext,
  AdapterDescriptor,
  InboundMail,
  MailboxInbox,
  MailboxProvider,
  MailboxProviderCapabilities,
} from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";

/**
 * Resend inbound. Any address at `domain` is received. The webhook carries an id;
 * the body is loaded from the receiving API and stored on `lb_inbound_mail`.
 */
export class ResendMailbox implements MailboxProvider {
  constructor(
    private readonly options: {
      domain: string;
      prisma: PrismaClient;
    },
  ) {}

  describe(): AdapterDescriptor<MailboxProviderCapabilities> {
    return {
      id: "resend",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { inbound: "webhook" },
    };
  }

  ensureInbox(projectId: string, _context: AdapterContext): Promise<MailboxInbox> {
    const local = `lb-${projectId.replace(/[^a-z0-9]/gi, "").slice(0, 24).toLowerCase()}`;
    const address = `${local}@${this.options.domain}`;
    return Promise.resolve({ inboxId: address, address });
  }

  async listMessages(inboxId: string, options: { since?: Date }): Promise<InboundMail[]> {
    const rows = await this.options.prisma.lbInboundMail.findMany({
      where: {
        inboxId,
        ...(options.since ? { receivedAt: { gte: options.since } } : {}),
      },
      orderBy: { receivedAt: "asc" },
    });
    return rows.map((row) => ({
      inboxId: row.inboxId,
      from: row.fromAddress,
      subject: row.subject,
      textBody: row.textBody,
      ...(row.htmlBody ? { htmlBody: row.htmlBody } : {}),
      receivedAt: row.receivedAt.toISOString(),
    }));
  }
}

/** Svix signature used by Resend webhooks. `secret` is the `whsec_…` value. */
export function verifyResendSignature(
  secret: string,
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signed = createHmac("sha256", key)
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`)
    .digest("base64");
  const offered = headers.signature.split(" ").map((part) => part.split(",")[1] ?? "");
  return offered.some((value) => {
    const left = Buffer.from(value);
    const right = Buffer.from(signed);
    return left.length === right.length && timingSafeEqual(left, right);
  });
}

export interface ResendReceivedMail {
  emailId: string;
  to: string[];
  from: string;
  subject: string;
  text: string;
  html?: string;
  createdAt: string;
}

export function parseResendReceivedEvent(body: unknown): { emailId: string; to: string[] } | null {
  if (!body || typeof body !== "object") return null;
  const event = body as { type?: string; data?: { email_id?: string; to?: string[] } };
  if (event.type !== "email.received" || !event.data?.email_id) return null;
  return { emailId: event.data.email_id, to: event.data.to ?? [] };
}
