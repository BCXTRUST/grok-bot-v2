import { describe, expect, it, vi } from "vitest";
import { parseOpenRouterModels, probeOpenRouterModels } from "./openrouter-catalog.js";

describe("OpenRouter catalog probe", () => {
  it("keeps unique model ids and names", () => {
    expect(
      parseOpenRouterModels({
        data: [
          { id: "openai/gpt-5", name: "GPT-5" },
          { id: "openai/gpt-5", name: "duplicate" },
          { id: "  anthropic/claude-sonnet-4  ", name: "  Claude  " },
          { id: 12 },
        ],
      }),
    ).toEqual([
      { id: "openai/gpt-5", name: "GPT-5" },
      { id: "anthropic/claude-sonnet-4", name: "Claude" },
    ]);
  });

  it("only fetches the public OpenRouter models URL", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://openrouter.ai/api/v1/models");
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBe("Bearer sk-or-test-key");
      return new Response(
        JSON.stringify({ data: [{ id: "google/gemini-2.5-pro", name: "Gemini" }] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    await expect(
      probeOpenRouterModels({ apiKey: "sk-or-test-key" }, fetchImpl as typeof fetch),
    ).resolves.toEqual([{ id: "google/gemini-2.5-pro", name: "Gemini" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
