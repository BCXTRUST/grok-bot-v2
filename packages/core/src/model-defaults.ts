/** Product default on OpenRouter. Flash is too weak to drive the computer. */
export const DEFAULT_OPENROUTER_MODEL_ID = "x-ai/grok-4.6";

export const LEGACY_FLASH_MODEL_ID = "deepseek/deepseek-v4-flash-0731";

export function resolveOpenRouterModelId(id: string | undefined): string {
  const trimmed = id?.trim();
  if (!trimmed || trimmed === LEGACY_FLASH_MODEL_ID) {
    const env = process.env.PI_DEFAULT_MODEL?.trim();
    if (env && env !== LEGACY_FLASH_MODEL_ID) return env;
    return DEFAULT_OPENROUTER_MODEL_ID;
  }
  return trimmed;
}
