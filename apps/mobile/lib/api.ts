const API = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:3100";
const COOKIE = process.env.EXPO_PUBLIC_SESSION_COOKIE ?? "";

export async function rpc<T>(proc: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${API}/rpc/${proc}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(COOKIE ? { cookie: COOKIE } : {}),
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
