import type {
  AdapterContext,
  AgentRunRequest,
  AgentRuntime,
  AgentRuntimeEvent,
} from "@rakazo/adapter-kit";

const running = new Map<string, AbortController>();

export class ScriptedAgentRuntime implements AgentRuntime {
  describe() {
    return {
      id: "scripted",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { streaming: true, compaction: false, tools: true, scripted: true },
    };
  }

  async abort(runId: string): Promise<void> {
    running.get(runId)?.abort();
  }

  async *run(request: AgentRunRequest, context: AdapterContext): AsyncIterable<AgentRuntimeEvent> {
    const controller = new AbortController();
    running.set(request.runId, controller);
    const signal = context.signal ?? controller.signal;
    try {
      const script = request.script ?? inferScript(request.prompt, request.resumeFromCheckpoint);
      for (const turn of script) {
        if (signal.aborted) {
          yield { type: "done", text: "stopped" };
          return;
        }
        if (turn.assistant) {
          yield { type: "progress", text: "working…" };
          yield { type: "text", text: turn.assistant };
        }
        for (const call of turn.toolCalls ?? []) {
          yield {
            type: "tool",
            name: call.name,
            args: call.args,
            executionId: `${request.runId}:${call.name}`,
          };
        }
        if (turn.ask) {
          yield { type: "ask", text: turn.ask.text, detail: turn.ask.detail };
          return;
        }
        if (turn.takeover) {
          yield { type: "takeover", reason: turn.takeover.reason };
          return;
        }
        if (turn.complete) {
          yield {
            type: "usage",
            inputTokens: 12,
            outputTokens: 40,
            provider: "scripted",
            model: "scripted",
          };
          yield { type: "done", text: turn.assistant };
          return;
        }
      }
      yield { type: "text", text: "done." };
      yield { type: "done", text: "done." };
    } finally {
      running.delete(request.runId);
    }
  }
}

export function inferScript(
  prompt: string,
  resumeFromCheckpoint?: string,
): NonNullable<AgentRunRequest["script"]> {
  const lower = prompt.toLowerCase();
  if (
    resumeFromCheckpoint === "takeover" ||
    lower.includes("completed sign-in") ||
    lower.includes("continue without requesting takeover")
  ) {
    return [
      {
        assistant:
          "signed in. the session stays in this computer — protected input never hit the thread.",
        complete: true,
      },
    ];
  }
  if (lower.includes("take over") || lower.includes("sign in") || lower.includes("login")) {
    return [
      { assistant: "i need you on the screen for a one-time sign-in. handing you the computer." },
      { takeover: { reason: "Sign in to continue. Protected input stays off the thread." } },
    ];
  }
  if (lower.includes("connector") || lower.includes("crm") || lower.includes("destination")) {
    return [
      {
        assistant: "writing the record through the connected destination.",
        toolCalls: [
          {
            name: "destination.write",
            args: { collection: "notes", title: "Rakazo result", body: prompt },
          },
        ],
        complete: true,
      },
    ];
  }
  if (
    lower.includes("write") &&
    (lower.includes("file") || lower.includes("home") || lower.includes("note"))
  ) {
    const said = /says?\s+(.+)$/i.exec(prompt)?.[1]?.replace(/[.]+$/, "") ?? prompt;
    const content = `${said.trim()}\n`;
    return [
      { assistant: "writing that into my home now." },
      {
        toolCalls: [{ name: "write_file", args: { path: "notes/result.txt", content } }],
        files: [{ path: "notes/result.txt", content }],
        complete: true,
      },
    ];
  }
  if (lower.includes("remember")) {
    return [
      {
        assistant: "noted — i will keep that in memory.",
        memory: [{ scope: "bot", path: "MEMORY.md", content: `# Memory\n\n- ${prompt}\n` }],
        complete: true,
      },
    ];
  }
  return [
    {
      assistant: `on it. i will work this in the background and come back with a result.\n\n${summarize(prompt)}`,
    },
    {
      files: [{ path: "notes/last-task.md", content: `# Task\n\n${prompt}\n` }],
      complete: true,
    },
  ];
}

function summarize(prompt: string): string {
  return `done. i handled: ${prompt.slice(0, 180)}`;
}
