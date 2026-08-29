import { describe, expect, it, vi } from "vitest";
import { modelLabel } from "./model-label.js";

describe("modelLabel", () => {
  it("shows Grok 4.6 under the bot name for the product default", () => {
    vi.stubEnv("PI_DEFAULT_MODEL", "");
    vi.stubEnv("PI_COMPUTER_MODEL", "");
    expect(modelLabel(undefined)).toBe("Grok 4.6");
    expect(modelLabel(null)).toBe("Grok 4.6");
    expect(modelLabel("x-ai/grok-4.6")).toBe("Grok 4.6");
    expect(modelLabel("deepseek/deepseek-v4-flash-0731")).toBe("Grok 4.6");
    expect(modelLabel("openai/gpt-4o-mini")).toBe("Grok 4.6");
    vi.unstubAllEnvs();
  });

  it("asks to choose a model only when the account still needs one", () => {
    expect(modelLabel(undefined, true)).toBe("Choose model");
    expect(modelLabel("x-ai/grok-4.6", true)).toBe("Grok 4.6");
  });
});
