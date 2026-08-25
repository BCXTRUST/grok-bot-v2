import type { ConnectorTool } from "@rakazo/adapter-kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeAgents = vi.hoisted(() => ({
  constructed: [] as Array<{ messages: unknown[] }>,
  promptCount: 0,
}));

vi.mock("@earendil-works/pi-agent-core", () => ({
  Agent: class {
    state = {
      errorMessage: undefined as string | undefined,
      messages: [] as unknown[],
    };

    constructor(options: { initialState: { messages: unknown[] } }) {
      fakeAgents.constructed.push({ messages: options.initialState.messages });
      this.state.messages = options.initialState.messages;
    }

    subscribe(_listener: unknown) {}

    async prompt() {
      fakeAgents.promptCount += 1;
      if (fakeAgents.promptCount === 1) {
        this.state.errorMessage = "Corrupted thought signature";
        this.state.messages = [
          ...this.state.messages,
          { role: "toolResult", toolName: "computer_act" },
          { role: "toolResult", toolName: "shell" },
        ];
      }
    }

    async waitForIdle() {}
    abort() {}
  },
}));

vi.mock("@earendil-works/pi-ai/providers/all", () => ({
  builtinModels: () => ({
    getModel: (_provider: string, modelId: string) =>
      modelId === "gemini-test"
        ? { provider: "openrouter", id: modelId, reasoning: true }
        : undefined,
    streamSimple: () => {
      throw new Error("the fake agent must not call a provider");
    },
  }),
}));

vi.mock("./pi-local-provider.js", () => ({
  registerLocalProvider: (models: unknown) => models,
}));

vi.mock("./pi-openai-compatible-provider.js", () => ({
  OPENAI_COMPATIBLE_PROVIDER_ID: "openai-compatible",
  registerOpenAiCompatibleCatalog: (models: unknown) => models,
  registerOpenAiCompatibleRuntime: (models: unknown) => models,
}));

import {
  explainThoughtSignatureFailure,
  isThoughtSignatureFailure,
  PiAgentRuntime,
  summarizeCompletedTools,
  thoughtSignatureContinueNote,
  toAgentHistory,
} from "./pi-runtime.js";

const observe: ConnectorTool = {
  name: "computer_observe",
  description: "Observe",
  inputSchema: { type: "object", properties: {} },
};

describe("Gemini thought-signature recovery", () => {
  beforeEach(() => {
    fakeAgents.constructed = [];
    fakeAgents.promptCount = 0;
  });

  it("detects provider thought-signature failures", () => {
    expect(isThoughtSignatureFailure("Corrupted thought signature")).toBe(true);
    expect(isThoughtSignatureFailure("Function call is missing a thought_signature")).toBe(true);
    expect(isThoughtSignatureFailure("command timed out")).toBe(false);
  });

  it("keeps prior assistant replies as assistant turns", () => {
    const history = toAgentHistory(
      [
        { role: "user", content: "register on a forum" },
        { role: "assistant", content: "I opened the signup page." },
        { role: "user", content: "one more forum" },
      ],
      "one more forum",
    );
    expect(history).toEqual([
      { role: "user", content: "register on a forum", timestamp: expect.any(Number) },
      {
        role: "assistant",
        content: [{ type: "text", text: "I opened the signup page." }],
        timestamp: expect.any(Number),
      },
    ]);
  });

  it("summarizes tools already finished before the provider error", () => {
    expect(
      summarizeCompletedTools([
        { role: "assistant", content: [{ type: "toolCall", name: "computer_observe" }] },
        { role: "toolResult", toolName: "computer_act" },
      ]),
    ).toContain("- computer_observe");
    expect(thoughtSignatureContinueNote("Tools already finished this turn:\n- shell")).toContain(
      "live desktop",
    );
  });

  it("retries once on a corrupted thought signature instead of stopping the computer turn", async () => {
    const runtime = new PiAgentRuntime();
    const events: Array<{ type: string; text?: string }> = [];
    for await (const event of runtime.run(
      {
        botId: "b",
        threadId: "t",
        runId: "r",
        prompt: "register on one more forum",
        instructions: "",
        history: [{ role: "user", content: "register on one more forum" }],
        tools: [observe],
        model: { provider: "openrouter", id: "gemini-test" },
        executeTool: vi.fn(async () => ({ ok: true })),
      },
      {
        operationId: "1",
        traceId: "1",
        workspaceId: "w",
        userId: "u",
        signal: new AbortController().signal,
      },
    )) {
      events.push(event);
    }

    expect(fakeAgents.promptCount).toBe(2);
    expect(fakeAgents.constructed).toHaveLength(2);
    const retryNote = fakeAgents.constructed[1]?.messages.find(
      (message) =>
        message &&
        typeof message === "object" &&
        (message as { role?: string }).role === "user" &&
        String((message as { content?: string }).content).includes("encrypted reasoning tokens"),
    );
    expect(retryNote).toBeTruthy();
    expect(events.some((event) => event.text?.includes("Corrupted thought signature"))).toBe(false);
    expect(events.some((event) => event.text?.includes("continuing on the live desktop"))).toBe(
      true,
    );
    expect(events.some((event) => event.text === explainThoughtSignatureFailure())).toBe(false);
  });
});
