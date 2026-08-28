/** Product default on OpenRouter. Flash and similar are too weak to drive the computer. */
export const DEFAULT_OPENROUTER_MODEL_ID = "x-ai/grok-4.6";

export const LEGACY_FLASH_MODEL_ID = "deepseek/deepseek-v4-flash-0731";

const WEAK_COMPUTER_MODEL = /(?:^|\/)(?:aion(?:[-.\s]*2(?:\.0)?)?|gpt-4\.1-mini|gpt-4o-mini|deepseek-v4-flash)/i;

export function resolveOpenRouterModelId(id: string | undefined): string {
  const trimmed = id?.trim();
  if (
    !trimmed ||
    trimmed === LEGACY_FLASH_MODEL_ID ||
    WEAK_COMPUTER_MODEL.test(trimmed)
  ) {
    const env = process.env.PI_DEFAULT_MODEL?.trim();
    if (env && env !== LEGACY_FLASH_MODEL_ID && !WEAK_COMPUTER_MODEL.test(env)) return env;
    return DEFAULT_OPENROUTER_MODEL_ID;
  }
  return trimmed;
}
