const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";
const OPENROUTER_KEY_PREFIX = "sk-or-";

export type OpenRouterKeyKind = "inference" | "management" | "invalid" | "unknown";

const inspected = new Map<string, OpenRouterKeyKind>();

export function resetOpenRouterKeyInspectionCache() {
  inspected.clear();
}

export function forgetOpenRouterKeyInspection(apiKey: string) {
  inspected.delete(apiKey.trim());
}

export function looksLikeOpenRouterKey(value: string) {
  return value.trim().startsWith(OPENROUTER_KEY_PREFIX);
}

export function describeOpenRouterKeyProblem(kind: Exclude<OpenRouterKeyKind, "inference" | "unknown">) {
  if (kind === "management") {
    return "This OpenRouter key is a management/provisioning key and cannot run chat. Create a regular API key in OpenRouter and paste that instead.";
  }
  return "OpenRouter rejected this API key. Create a regular inference key and paste that instead.";
}

export async function inspectOpenRouterKeyKind(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OpenRouterKeyKind> {
  const key = apiKey.trim();
  const cached = inspected.get(key);
  if (cached) return cached;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetchImpl(OPENROUTER_KEY_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      inspected.set(key, "invalid");
      return "invalid";
    }
    if (!response.ok) return "unknown";
    const body = (await response.json()) as {
      data?: { is_management_key?: boolean; is_provisioning_key?: boolean };
      is_management_key?: boolean;
      is_provisioning_key?: boolean;
    };
    const data = body.data ?? body;
    const kind: OpenRouterKeyKind =
      data.is_management_key || data.is_provisioning_key ? "management" : "inference";
    inspected.set(key, kind);
    return kind;
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}

export async function assertOpenRouterInferenceKey(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!looksLikeOpenRouterKey(apiKey)) return;
  const kind = await inspectOpenRouterKeyKind(apiKey, fetchImpl);
  if (kind === "inference" || kind === "unknown") return;
  throw new Error(describeOpenRouterKeyProblem(kind));
}

export async function warnIfOpenRouterKeyCannotChat(apiKey: string | undefined): Promise<void> {
  const key = apiKey?.trim();
  if (!key || !looksLikeOpenRouterKey(key)) return;
  const kind = await inspectOpenRouterKeyKind(key);
  if (kind === "management" || kind === "invalid") {
    console.error(
      `OPENROUTER_API_KEY cannot run chat (${kind}). Set a regular inference key and restart the worker.`,
    );
  }
}

export async function preferRunnableOpenRouterKey(options: {
  storedKey?: string;
  deploymentKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<string | undefined> {
  const stored = options.storedKey?.trim() || undefined;
  const deployment = options.deploymentKey?.trim() || undefined;
  const fetchImpl = options.fetchImpl ?? fetch;
  const candidates = [...new Set([stored, deployment].filter((key): key is string => Boolean(key)))];
  if (candidates.length === 0) return undefined;

  let unknown: string | undefined;
  for (const key of candidates) {
    if (!looksLikeOpenRouterKey(key)) return key;
    const kind = await inspectOpenRouterKeyKind(key, fetchImpl);
    if (kind === "inference") return key;
    if (kind === "unknown" && !unknown) unknown = key;
  }
  return unknown ?? deployment ?? candidates[0];
}
