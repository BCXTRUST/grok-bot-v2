export const OPENAI_API_PROVIDER_ID = "openai";
export const OPENROUTER_PROVIDER_ID = "openrouter";
export const CHATGPT_OAUTH_PROVIDER_ID = "openai-codex";

/** Show these first so API keys and OpenRouter are one tap from the top. */
export const FEATURED_MODEL_PROVIDERS = [
  OPENAI_API_PROVIDER_ID,
  CHATGPT_OAUTH_PROVIDER_ID,
  OPENROUTER_PROVIDER_ID,
] as const;

export function providerAllowsCustomModelId(provider: string): boolean {
  return provider === OPENROUTER_PROVIDER_ID || provider === OPENAI_API_PROVIDER_ID;
}

export function sortModelProviderGroups<T extends { id: string }>(groups: T[]): T[] {
  const rank = new Map<string, number>(FEATURED_MODEL_PROVIDERS.map((id, index) => [id, index]));
  return [...groups].sort((a, b) => {
    const aRank = rank.get(a.id);
    const bRank = rank.get(b.id);
    if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
    if (aRank !== undefined) return -1;
    if (bRank !== undefined) return 1;
    return 0;
  });
}

export function preferredModelId(input: {
  provider: string;
  catalogIds: string[];
  requested?: string | null;
  stored?: string | null;
  workspaceDefaultProvider?: string | null;
  workspaceDefaultModel?: string | null;
  allowCustom?: boolean;
}): string {
  const allowCustom = input.allowCustom ?? providerAllowsCustomModelId(input.provider);
  const candidates = [
    input.requested?.trim(),
    input.stored?.trim(),
    input.workspaceDefaultProvider === input.provider
      ? input.workspaceDefaultModel?.trim()
      : undefined,
  ].filter((value): value is string => Boolean(value));
  for (const id of candidates) {
    if (allowCustom || input.catalogIds.includes(id)) return id;
  }
  return input.catalogIds[0] ?? "";
}

export function mergeModelOptions<T extends { id: string }>(primary: T[], extra: T[]): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const entry of [...primary, ...extra]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
  }
  return merged;
}
