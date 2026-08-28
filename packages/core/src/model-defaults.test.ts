import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OPENROUTER_MODEL_ID,
  LEGACY_FLASH_MODEL_ID,
  resolveOpenRouterModelId,
} from "./model-defaults.js";

describe("openrouter model defaults", () => {
  it("uses Grok 4.6 instead of DeepSeek flash", () => {
    vi.stubEnv("PI_DEFAULT_MODEL", "");
    expect(DEFAULT_OPENROUTER_MODEL_ID).toBe("x-ai/grok-4.6");
    expect(resolveOpenRouterModelId(undefined)).toBe("x-ai/grok-4.6");
    expect(resolveOpenRouterModelId(LEGACY_FLASH_MODEL_ID)).toBe("x-ai/grok-4.6");
    expect(resolveOpenRouterModelId("scripted")).toBe("scripted");
    expect(resolveOpenRouterModelId("openai/gpt-4o-mini")).toBe("x-ai/grok-4.6");
    expect(resolveOpenRouterModelId("aion-2.0")).toBe("x-ai/grok-4.6");
    expect(resolveOpenRouterModelId("stealth/aion-2.0")).toBe("x-ai/grok-4.6");
    expect(resolveOpenRouterModelId("openai/gpt-4o")).toBe("openai/gpt-4o");
    vi.unstubAllEnvs();
  });

  it("honors PI_DEFAULT_MODEL when replacing flash", () => {
    vi.stubEnv("PI_DEFAULT_MODEL", "x-ai/grok-4.6");
    expect(resolveOpenRouterModelId(LEGACY_FLASH_MODEL_ID)).toBe("x-ai/grok-4.6");
    vi.unstubAllEnvs();
  });
});
