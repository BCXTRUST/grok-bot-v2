import { describe, expect, it } from "vitest";
import {
  mergeModelOptions,
  preferredModelId,
  providerAllowsCustomModelId,
  sortModelProviderGroups,
} from "./model-ui.js";

describe("model picker helpers", () => {
  it("pins OpenAI, ChatGPT, then OpenRouter ahead of other providers", () => {
    expect(
      sortModelProviderGroups([
        { id: "anthropic" },
        { id: "openrouter" },
        { id: "scripted" },
        { id: "openai-codex" },
        { id: "openai" },
      ]).map((group) => group.id),
    ).toEqual(["openai", "openai-codex", "openrouter", "anthropic", "scripted"]);
  });

  it("keeps a typed OpenRouter id even when it is not in the static catalog", () => {
    expect(providerAllowsCustomModelId("openrouter")).toBe(true);
    expect(
      preferredModelId({
        provider: "openrouter",
        catalogIds: ["deepseek/deepseek-v4-flash-0731"],
        requested: "openai/gpt-5",
      }),
    ).toBe("openai/gpt-5");
  });

  it("does not invent ids for providers that cannot run unlisted models", () => {
    expect(
      preferredModelId({
        provider: "anthropic",
        catalogIds: ["claude-sonnet-4"],
        requested: "mystery-model",
      }),
    ).toBe("claude-sonnet-4");
  });

  it("prefers the stored default, then the workspace default, then the first catalog id", () => {
    expect(
      preferredModelId({
        provider: "openai",
        catalogIds: ["gpt-4o", "gpt-5"],
        stored: "gpt-5",
        workspaceDefaultProvider: "openai",
        workspaceDefaultModel: "gpt-4o",
      }),
    ).toBe("gpt-5");
    expect(
      preferredModelId({
        provider: "openai",
        catalogIds: ["gpt-4o"],
        workspaceDefaultProvider: "openai",
        workspaceDefaultModel: "gpt-4o-mini",
      }),
    ).toBe("gpt-4o-mini");
  });

  it("dedupes catalog rows ahead of live OpenRouter rows", () => {
    expect(
      mergeModelOptions(
        [{ id: "openai/gpt-5", label: "GPT-5" }],
        [
          { id: "openai/gpt-5", label: "openai/gpt-5" },
          { id: "anthropic/claude-sonnet-4", label: "Claude" },
        ],
      ).map((entry) => entry.id),
    ).toEqual(["openai/gpt-5", "anthropic/claude-sonnet-4"]);
  });
});
