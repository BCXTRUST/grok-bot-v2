export const OPENROUTER_PROVIDER_ID = "openrouter";

export const OPENROUTER_FEATURED_MODELS = [
  {
    id: "google/gemini-3.7-flash",
    label: "Gemini Flash",
    contextWindow: 1_048_576,
    maxTokens: 65_536,
  },
  {
    id: "x-ai/grok-4.6",
    label: "Grok 4.6",
    contextWindow: 256_000,
    maxTokens: 32_768,
  },
] as const;

export type OpenRouterFeaturedModel = (typeof OPENROUTER_FEATURED_MODELS)[number];

export function isOpenRouterFeaturedModelId(id: string): boolean {
  return OPENROUTER_FEATURED_MODELS.some((entry) => entry.id === id);
}

export function openRouterFeaturedLimits(id: string): {
  contextWindow: number;
  maxTokens: number;
} | null {
  const featured = OPENROUTER_FEATURED_MODELS.find((entry) => entry.id === id);
  if (!featured) return null;
  return { contextWindow: featured.contextWindow, maxTokens: featured.maxTokens };
}
