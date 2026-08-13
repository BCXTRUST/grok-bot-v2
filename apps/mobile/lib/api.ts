import { clearSessionToken, loadSessionToken, saveSessionToken, tokenFromAuthResponse } from "./session";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:3100";

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

export type MobileBot = { id: string; name: string; preview: string; title: string; color?: string };

export type MobileMessage = {
  id: string;
  role: "user" | "bot" | "system";
  blocks: Array<{ kind: string; text?: string; state?: string }>;
};

export type MobileSnapshot = {
  botId: string;
  threadId: string;
  messages: MobileMessage[];
  run: { status: string } | null;
  computer: { state: string; controlHolder: string; screenAvailable: boolean };
};

export function blockText(message: MobileMessage) {
  return message.blocks.map((block) => block.text ?? block.state ?? "").filter(Boolean).join("\n");
}

export { loadSessionToken };
