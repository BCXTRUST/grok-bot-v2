import {
  clearSessionToken,
  loadSessionToken,
  saveSessionToken,
  tokenFromAuthResponse,
} from "./session";

export const API = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:3100";

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await loadSessionToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function signIn(email: string, password: string) {
  const res = await fetch(`${API}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "rakazo://" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof body === "object" && body && "message" in body
        ? String((body as { message?: string }).message ?? "Could not sign in")
        : "Could not sign in";
    throw new Error(message);
  }
  const token = tokenFromAuthResponse(res, body);
  if (!token) throw new Error("Sign-in did not return a session");
  await saveSessionToken(token);
}

export async function signOut() {
  const headers = await authHeaders();
  await fetch(`${API}/api/auth/sign-out`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "rakazo://", ...headers },
  }).catch(() => undefined);
  await clearSessionToken();
}

export async function rpc<T>(proc: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${API}/rpc/${proc}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "rakazo://",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ json: body }),
  });
  const parsed = (await res.json()) as { json?: T; error?: { message?: string } };
  if (!res.ok || parsed.error) throw new Error(parsed.error?.message ?? `rpc ${proc} failed`);
  return parsed.json as T;
}

export type MobileBot = {
  id: string;
  name: string;
  preview: string;
  title: string;
  color?: string;
};

export type MobileMessage = {
  id: string;
  role: "user" | "bot" | "system";
  blocks: Array<{ kind: string; text?: string; state?: string }>;
};

export type MobileSnapshot = {
  botId: string;
  threadId: string;
  cursor?: number;
  messages: MobileMessage[];
  run: { status: string } | null;
  computer: { state: string; controlHolder: string; screenAvailable: boolean };
};

export function blockText(message: MobileMessage) {
  return message.blocks
    .map((block) => block.text ?? block.state ?? "")
    .filter(Boolean)
    .join("\n");
}

type ThreadEvent = {
  id?: string;
  type: string;
  seq?: number;
  runId?: string;
  payload?: Record<string, unknown>;
};

export async function subscribeThread(
  botId: string,
  cursor: number,
  onEvent: (event: ThreadEvent) => void,
  signal: AbortSignal,
) {
  const res = await fetch(`${API}/rpc/threads/subscribe`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      origin: "rakazo://",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ json: { botId, cursor } }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`rpc threads/subscribe failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const data = chunk
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as { json?: ThreadEvent; error?: { message?: string } };
        if (parsed.json?.type) onEvent(parsed.json);
      } catch {
        // ignore keepalives and partial frames
      }
    }
  }
}

export function applyMobileThreadEvent(
  prev: MobileSnapshot | null,
  event: ThreadEvent,
): MobileSnapshot | null {
  if (!prev) return prev;
  if (event.type === "thread.progress") {
    const text = String(event.payload?.text ?? "");
    const streaming: MobileMessage = {
      id: `progress:${event.runId ?? event.id ?? "live"}`,
      role: "bot",
      blocks: [{ kind: "progress", text }],
    };
    return {
      ...prev,
      messages: [
        ...prev.messages.filter((message) => !message.id.startsWith("progress:")),
        streaming,
      ],
    };
  }
  if (event.type === "thread.message.created") {
    const next: MobileMessage = {
      id: String(event.payload?.messageId ?? event.id ?? `msg:${event.seq ?? 0}`),
      role: (event.payload?.role as MobileMessage["role"]) ?? "bot",
      blocks: (event.payload?.blocks as MobileMessage["blocks"]) ?? [],
    };
    return {
      ...prev,
      messages: [
        ...prev.messages.filter(
          (message) => message.id !== next.id && !message.id.startsWith("progress:"),
        ),
        next,
      ],
    };
  }
  return prev;
}

export { loadSessionToken };
