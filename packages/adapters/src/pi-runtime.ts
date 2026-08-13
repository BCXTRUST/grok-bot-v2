import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { AdapterContext, AgentRunRequest, AgentRuntime, AgentRuntimeEvent, ConnectorTool } from "@rakazo/adapter-kit";
import { builtinAgentTools } from "./builtin-tools.js";

const running = new Map<string, AbortController>();
const models = builtinModels();

export class PiAgentRuntime implements AgentRuntime {
  describe() {
    return {
      id: "pi",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { streaming: true, compaction: true, tools: true, scripted: false },
    };
  }

  async abort(runId: string): Promise<void> {
    running.get(runId)?.abort();
  }

  async *run(request: AgentRunRequest, context: AdapterContext): AsyncIterable<AgentRuntimeEvent> {
    const controller = new AbortController();
    running.set(request.runId, controller);
    const signal = context.signal ?? controller.signal;
    const queue = createQueue();

    const work = (async () => {
      try {
        const provider = request.model.provider === "scripted" ? "openrouter" : request.model.provider;
        const modelId =
          request.model.id === "scripted"
            ? (process.env.PI_DEFAULT_MODEL ?? "deepseek/deepseek-v4-flash-0731")
            : request.model.id;
        const model = models.getModel(provider, modelId) ?? models.getModel("openrouter", modelId);
        if (!model) {
          queue.push({ type: "text", text: `Unknown model ${provider}/${modelId}` });
          queue.push({ type: "done" });
          return;
        }

        const apiKey = request.model.apiKey ?? process.env.OPENROUTER_API_KEY;
        const toolDefs = request.tools.length ? request.tools : builtinAgentTools;
        const tools = toolDefs.map((tool) => toAgentTool(tool, queue, request.runId));
        const history = toHistory(request.history, request.prompt);

        const agent = new Agent({
          streamFn: (m, ctx, options) => models.streamSimple(m, ctx, options),
          getApiKey: async () => apiKey,
          initialState: {
            systemPrompt:
              request.instructions ||
              "You are a Rakazo bot. Prefer tools for files, memory, and destination writes. Be concise.",
            model,
            thinkingLevel: "off",
            tools,
            messages: history,
          },
        });

        if (signal.aborted) {
          queue.push({ type: "done", text: "stopped" });
          return;
        }
        const onAbort = () => agent.abort();
        signal.addEventListener("abort", onAbort);

        let streamed = "";
        agent.subscribe((event) => {
          if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
            const delta = event.assistantMessageEvent.delta;
            if (delta) {
              streamed += delta;
              queue.push({ type: "text", text: delta });
            }
          }
          if (event.type === "message_end" && event.message.role === "assistant") {
            const text = assistantText(event.message);
            if (text && !streamed) {
              streamed = text;
              queue.push({ type: "text", text });
            }
            if ("usage" in event.message && event.message.usage) {
              queue.push({
                type: "usage",
                inputTokens: event.message.usage.input ?? 0,
                outputTokens: event.message.usage.output ?? 0,
                provider: model.provider,
                model: model.id,
              });
            }
          }
        });

        queue.push({ type: "progress", text: "working…" });
        await agent.prompt(request.prompt);
        await agent.waitForIdle();
        signal.removeEventListener("abort", onAbort);

        const error = agent.state.errorMessage;
        if (error) {
          queue.push({ type: "text", text: `I hit a problem: ${sanitizeError(error)}` });
          queue.push({ type: "done", text: sanitizeError(error) });
          return;
        }
        if (!streamed) {
          const fallback = assistantText(agent.state.messages.at(-1)) || "I finished the work.";
          queue.push({ type: "text", text: fallback });
          streamed = fallback;
        }
        queue.push({ type: "done", text: streamed });
      } catch (error) {
        const message = sanitizeError(error instanceof Error ? error.message : String(error));
        queue.push({ type: "text", text: `I hit a problem: ${message}` });
        queue.push({ type: "done", text: message });
      } finally {
        queue.close();
      }
    })();

    try {
      yield* queue.iterate();
      await work;
    } finally {
      running.delete(request.runId);
    }
  }
}

function toHistory(history: AgentRunRequest["history"], prompt: string) {
  const users = history.filter((m) => m.role === "user");
  const last = users.at(-1);
  const prior = last?.content === prompt ? users.slice(0, -1) : users;
  return prior.map((m) => ({
    role: "user" as const,
    content: m.content,
    timestamp: Date.now(),
  }));
}

function toAgentTool(tool: ConnectorTool, queue: EventQueue, runId: string): AgentTool {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: parametersFor(tool),
    prepareArguments: (args: unknown) => {
      const raw = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
      if (tool.name === "destination.write") {
        return {
          collection: String(raw.collection ?? "notes"),
          title: String(raw.title ?? "Rakazo result"),
          body: String(raw.body ?? ""),
        };
      }
      if (tool.name === "remember") {
        return { content: String(raw.content ?? ""), path: String(raw.path ?? "MEMORY.md") };
      }
      if (tool.name === "request_takeover") {
        return { reason: String(raw.reason ?? "I need you on the screen.") };
      }
      if (tool.name === "write_file") {
        return { path: String(raw.path ?? "notes/result.txt"), content: String(raw.content ?? "") };
      }
      return raw as never;
    },
    execute: async (toolCallId, params) => {
      const args = (params ?? {}) as Record<string, unknown>;
      queue.push({ type: "tool", name: tool.name, args, executionId: toolCallId || `${runId}:${tool.name}` });
      if (tool.name === "request_takeover") {
        queue.push({ type: "takeover", reason: String(args.reason ?? "I need you on the screen.") });
        return {
          content: [{ type: "text", text: "Takeover requested." }],
          details: args,
          terminate: true,
        };
      }
      return {
        content: [{ type: "text", text: `${tool.name} completed.` }],
        details: args,
      };
    },
  };
}

function parametersFor(tool: ConnectorTool) {
  if (tool.name === "write_file") {
    return Type.Object({ path: Type.String(), content: Type.String() });
  }
  if (tool.name === "destination.write") {
    return Type.Object({
      collection: Type.String(),
      title: Type.String(),
      body: Type.String(),
    });
  }
  if (tool.name === "request_takeover") {
    return Type.Object({ reason: Type.String() });
  }
  if (tool.name === "remember") {
    return Type.Object({ content: Type.String(), path: Type.String() });
  }
  return Type.Object({});
}

function assistantText(message: unknown): string {
  if (!message || typeof message !== "object" || !("content" in message)) return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part ? String(part.text) : ""))
    .join("");
}

function sanitizeError(message: string) {
  return message.replace(/sk-[a-zA-Z0-9-]+/g, "[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

interface EventQueue {
  push(event: AgentRuntimeEvent): void;
  close(): void;
  iterate(): AsyncIterable<AgentRuntimeEvent>;
}

function createQueue(): EventQueue {
  const items: AgentRuntimeEvent[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  return {
    push(event) {
      items.push(event);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *iterate() {
      while (!closed || items.length) {
        if (items.length) {
          yield items.shift()!;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}
