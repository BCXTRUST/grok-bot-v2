import { describe, expect, it } from "vitest";
import { listPiCatalog, scriptedCatalogEntry } from "./pi-models.js";

describe("Pi model catalog", () => {
  it("lists real Pi providers instead of a two-option dropdown", () => {
    const catalog = listPiCatalog();
    const providers = new Set(catalog.map((entry) => entry.provider));
    expect(catalog.length).toBeGreaterThan(20);
    expect(providers.has("openrouter")).toBe(true);
    expect(providers.size).toBeGreaterThan(5);
    expect(
      catalog.some(
        (entry) => entry.auth === "oauth" || entry.auth === "both" || entry.subscription,
      ),
    ).toBe(true);
    const chatgpt = catalog.find((entry) => entry.provider === "openai-codex");
    expect(chatgpt?.signIn).toBe("chatgpt-device");
    expect(chatgpt?.billing).toMatch(/ChatGPT Plus or Pro/);
    expect(scriptedCatalogEntry.provider).toBe("scripted");
  });
});
