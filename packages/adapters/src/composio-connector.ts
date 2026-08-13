import { Composio } from "@composio/core";
import type {
  AdapterContext,
  ConnectionAuthProvider,
  ConnectorCall,
  ConnectorEvent,
  ConnectorProvider,
  ConnectorTool,
} from "@rakazo/adapter-kit";
import { DestinationEmulator } from "./destination-emulator.js";

type ComposioSession = Awaited<ReturnType<Composio["create"]>>;

export function isComposioEnabled(apiKey: string | undefined): boolean {
  return Boolean(apiKey) && !process.env.VITEST;
}

export function asConnectorTools(input: unknown): ConnectorTool[] {
  const items = Array.isArray(input)
    ? input
    : input && typeof input === "object" && Array.isArray((input as { items?: unknown }).items)
      ? ((input as { items: unknown[] }).items ?? [])
      : [];
  const tools: ConnectorTool[] = [];
  for (const item of items) {
    const mapped = mapOneTool(item);
    if (mapped) tools.push(mapped);
  }
  return tools;
}

function mapOneTool(item: unknown): ConnectorTool | undefined {
  if (!item || typeof item !== "object") return undefined;
  const raw = item as Record<string, unknown>;
  if (raw.type === "function" && raw.function && typeof raw.function === "object") {
    const fn = raw.function as Record<string, unknown>;
    const name = String(fn.name ?? "");
    if (!name) return undefined;
    return {
      name,
      description: String(fn.description ?? name),
      inputSchema: asObject(fn.parameters) ?? { type: "object", properties: {} },
    };
  }
  const name = String(raw.slug ?? raw.name ?? "");
  if (!name) return undefined;
  return {
    name,
    description: String(raw.description ?? name),
    inputSchema: asObject(raw.inputParameters) ?? asObject(raw.inputSchema) ?? asObject(raw.parameters) ?? { type: "object", properties: {} },
  };
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export interface ComposioCatalogItem {
  slug: string;
  name: string;
  logo: string | null;
  connected: boolean;
  noAuth: boolean;
}

export function filterCatalog(items: ComposioCatalogItem[], query: string): ComposioCatalogItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => item.name.toLowerCase().includes(needle) || item.slug.toLowerCase().includes(needle));
}

export async function collectPages<T>(
  fetchPage: (cursor?: string) => Promise<{ items: T[]; cursor?: string }>,
  maxPages = 200,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(cursor);
    items.push(...result.items);
    if (!result.cursor) break;
    cursor = result.cursor;
  }
  return items;
}

export class ComposioConnector implements ConnectorProvider, ConnectionAuthProvider {
  private client: Composio | undefined;
  private readonly sessions = new Map<string, string>();

  describe() {
    return {
      id: "composio",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { discover: true, oauth: true, secretsBrokered: true },
    };
  }

  async sessionFor(userId: string): Promise<ComposioSession> {
    const composio = this.sdk();
    const existing = this.sessions.get(userId);
    if (existing) {
      try {
        return await composio.sessions.use(existing);
      } catch {
        this.sessions.delete(userId);
      }
    }
    const session = await composio.create(userId, { manageConnections: false, sandbox: { enable: false } });
    this.sessions.set(userId, session.sessionId);
    return session;
  }

  async catalog(userId: string, query?: string): Promise<ComposioCatalogItem[]> {
    const session = await this.sessionFor(userId);
    const toolkits = await collectPages((cursor) =>
      session.toolkits({
        limit: 50,
        cursor,
        ...(query?.trim() ? { search: query.trim() } : {}),
      }),
    );
    return toolkits.map((toolkit) => ({
      slug: toolkit.slug,
      name: toolkit.name,
      logo: toolkit.logo ?? null,
      connected: Boolean(toolkit.connection?.isActive),
      noAuth: Boolean(toolkit.isNoAuth),
    }));
  }

  async discoverTools(context: AdapterContext): Promise<ConnectorTool[]> {
    const session = await this.sessionFor(context.userId);
    const raw = await session.tools();
    return asConnectorTools(raw);
  }

  async *execute(call: ConnectorCall, context: AdapterContext): AsyncIterable<ConnectorEvent> {
    try {
      const session = await this.sessionFor(context.userId);
      const result = await session.execute(call.tool, call.args ?? {});
      if (result.error) {
        yield { type: "error", message: sanitizeComposioError(result.error) };
        return;
      }
      const logId = collectLogIds(result)[0] ?? "";
      yield {
        type: "result",
        data: {
          data: sanitizePayload(result.data),
          logId,
        },
      };
    } catch (error) {
      yield { type: "error", message: sanitizeComposioError(error) };
    }
  }

  async begin(
    request: { provider: string; redirectUrl: string },
    context: AdapterContext,
  ): Promise<{ authorizationUrl: string | null; state: string }> {
    const session = await this.sessionFor(context.userId);
    try {
      const connectionRequest = await session.authorize(request.provider, { callbackUrl: request.redirectUrl });
      if (!connectionRequest.redirectUrl) {
        await connectionRequest.waitForConnection(20_000).catch(() => undefined);
      }
      return {
        authorizationUrl: connectionRequest.redirectUrl ?? null,
        state: connectionRequest.id || request.provider,
      };
    } catch (error) {
      if (isNoAuthToolkitError(error)) {
        return { authorizationUrl: null, state: request.provider };
      }
      throw new Error(sanitizeComposioError(error));
    }
  }

  async connectionReady(userId: string, slug: string): Promise<boolean> {
    const session = await this.sessionFor(userId);
    const page = await session.toolkits({ search: slug, limit: 50 });
    const match = page.items.find((item) => item.slug === slug);
    if (!match) return false;
    return Boolean(match.connection?.isActive) || Boolean(match.isNoAuth);
  }

  async complete(
    request: { state: string; code?: string },
    context: AdapterContext,
  ): Promise<{ connectionRef: string }> {
    const catalog = await this.catalog(context.userId);
    const connected = catalog.find((item) => item.connected);
    return { connectionRef: connected?.slug ?? request.state };
  }

  async revoke(connectionRef: string, context: AdapterContext): Promise<void> {
    const accountId = await this.connectedAccountId(context.userId, connectionRef);
    if (accountId) await this.sdk().connectedAccounts.delete(accountId);
  }

  async connectedAccountId(userId: string, slug: string): Promise<string | undefined> {
    const session = await this.sessionFor(userId);
    const toolkits = await session.toolkits({ isConnected: true });
    return toolkits.items.find((item) => item.slug === slug)?.connection?.connectedAccount?.id;
  }

  private sdk(): Composio {
    this.client ??= new Composio();
    return this.client;
  }
}

export class CompositeConnector implements ConnectorProvider {
  constructor(
    readonly destination: DestinationEmulator,
    readonly composio?: ComposioConnector,
  ) {}

  describe() {
    return this.composio?.describe() ?? this.destination.describe();
  }

  async discoverTools(context: AdapterContext): Promise<ConnectorTool[]> {
    const dest = await this.destination.discoverTools(context);
    if (!this.composio) return dest;
    try {
      const extra = await this.composio.discoverTools(context);
      const destNames = new Set(dest.map((tool) => tool.name));
      return [...dest, ...extra.filter((tool) => !destNames.has(tool.name))];
    } catch {
      return dest;
    }
  }

  async *execute(call: ConnectorCall, context: AdapterContext): AsyncIterable<ConnectorEvent> {
    if (call.tool === "destination.write" || !this.composio) {
      yield* this.destination.execute(call, context);
      return;
    }
    yield* this.composio.execute(call, context);
  }
}

export function createConnectorStack(composioEnabled: boolean) {
  const destination = new DestinationEmulator();
  const composio = composioEnabled ? new ComposioConnector() : undefined;
  return {
    destination,
    composio,
    connector: new CompositeConnector(destination, composio),
  };
}

export function collectLogIds(value: unknown): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const record = node as Record<string, unknown>;
    for (const [key, nested] of Object.entries(record)) {
      if ((key === "logId" || key === "log_id") && typeof nested === "string" && nested && !seen.has(nested)) {
        seen.add(nested);
        ids.push(nested);
      } else {
        walk(nested);
      }
    }
  };
  walk(value);
  return ids;
}

export function isNoAuthToolkitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("ToolkitsIsNoAuth") || message.includes("does not require authentication");
}

export function sanitizeComposioError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactConnectorText(message);
}

function sanitizePayload(data: unknown): unknown {
  try {
    return JSON.parse(redactConnectorText(JSON.stringify(data)));
  } catch {
    return { ok: true };
  }
}

function redactConnectorText(value: string): string {
  return value
    .replace(/COMPOSIO_API_KEY[=:]?\s*\S+/gi, "COMPOSIO_API_KEY=[redacted]")
    .replace(/ak_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/ck_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/sk-or-v1-[A-Za-z0-9]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}
