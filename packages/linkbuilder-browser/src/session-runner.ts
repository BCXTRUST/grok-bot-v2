import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname } from "node:path";
import { z } from "zod";
import type { BrowserRpcResponse } from "./rpc.js";

const MAX_BODY_BYTES = 1_000_000;

export const RunnerStateSchema = z
  .object({
    port: z.number().int().min(1).max(65_535),
    token: z.string().min(32),
    pid: z.number().int(),
    sessionId: z.string().min(1),
  })
  .strict();
export type RunnerState = z.infer<typeof RunnerStateSchema>;

export interface RpcHttpServer {
  port: number;
  token: string;
  close(): Promise<void>;
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readBody(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Loopback-only RPC endpoint inside the sandbox. A random bearer token, kept in a 0600 state file,
 * stops other processes on the computer from driving the persona browser.
 */
export async function startRpcHttpServer(
  handle: (request: unknown) => Promise<BrowserRpcResponse>,
  /** Runs once the reply to `request` has been flushed. */
  afterReply?: (request: unknown) => void,
): Promise<RpcHttpServer> {
  const token = randomBytes(32).toString("base64url");
  const server = createServer(async (request, response) => {
    const reply = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.method !== "POST" || request.url !== "/rpc")
      return reply(404, { ok: false, error: "not found" });
    if (!tokenMatches(request.headers.authorization, token)) {
      return reply(401, { ok: false, error: "unauthorized" });
    }
    const body = await readBody(request);
    if (body === null) return reply(413, { ok: false, error: "request too large" });
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return reply(400, { ok: false, error: "invalid json" });
    }
    if (afterReply) response.once("finish", () => afterReply(parsed));
    reply(200, await handle(parsed));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    port,
    token,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

export async function writeRunnerState(path: string, state: RunnerState): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
  await rename(temporary, path);
}

/** Posts one request to a running session runner; transport failures become error responses. */
export async function postRpc(
  state: RunnerState,
  request: unknown,
  timeoutMs = 120_000,
): Promise<BrowserRpcResponse> {
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/rpc`, {
      method: "POST",
      headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return (await response.json()) as BrowserRpcResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `runner unreachable: ${message}` };
  }
}
