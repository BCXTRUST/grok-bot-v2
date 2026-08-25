import { describe, expect, it } from "vitest";
import {
  isOpenRouterFeaturedModelId,
  OPENROUTER_FEATURED_MODELS,
  openRouterFeaturedLimits,
} from "./openrouter-ui.js";

describe("OpenRouter featured models", () => {
  it("pins Gemini Flash and Grok 4.6", () => {
    expect(OPENROUTER_FEATURED_MODELS.map((entry) => entry.id)).toEqual([
      "google/gemini-3.7-flash",
      "x-ai/grok-4.6",
    ]);
    expect(isOpenRouterFeaturedModelId("google/gemini-3.7-flash")).toBe(true);
    expect(isOpenRouterFeaturedModelId("x-ai/grok-4.6")).toBe(true);
    expect(openRouterFeaturedLimits("google/gemini-3.7-flash")).toMatchObject({
      contextWindow: 1_048_576,
    });
  });
});
