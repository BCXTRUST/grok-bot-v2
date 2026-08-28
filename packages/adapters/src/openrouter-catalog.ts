const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const MAX_MODELS_RESPONSE_BYTES = 2_000_000;
const MAX_MODELS = 800;

export type OpenRouterCatalogModel = { id: string; name: string };

type OpenRouterModelsResponse = {
  data?: Array<{ id?: unknown; name?: unknown }>;
};

export async function probeOpenRouterModels(
  input: { apiKey?: string } = {},
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<OpenRouterCatalogModel[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const merged = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (input.apiKey?.trim()) headers.Authorization = `Bearer ${input.apiKey.trim()}`;
    const response = await fetchImpl(OPENROUTER_MODELS_URL, {
      headers,
      redirect: "error",
      signal: merged,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`OpenRouter returned ${response.status}`);
    }
    const body = await readBoundedJson(response);
    return parseOpenRouterModels(body);
  } finally {
    clearTimeout(timeout);
  }
}

export function parseOpenRouterModels(body: OpenRouterModelsResponse): OpenRouterCatalogModel[] {
  const rows = Array.isArray(body.data) ? body.data : [];
  const models: OpenRouterCatalogModel[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (models.length >= MAX_MODELS) break;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : id;
    models.push({ id, name });
  }
  return models;
}

async function readBoundedJson(response: Response): Promise<OpenRouterModelsResponse> {
  if (!response.body) return {};
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_MODELS_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("OpenRouter model list is too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text) as OpenRouterModelsResponse;
}
