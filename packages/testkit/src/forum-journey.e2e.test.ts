import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ComputerRef, SandboxProvider } from "@rakazo/adapter-kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionCookieHeader } from "./index.js";

const live = process.env.RUN_FORUM_E2E === "1";
const describeLive = live ? describe : describe.skip;
const MODEL = process.env.COMPUTER_E2E_MODEL ?? "openai/gpt-4o-mini";

describeLive("internal forum register and comment journey", () => {
  let dataDir: string | undefined;
  let handles: Awaited<ReturnType<typeof import("../../../apps/api/src/app.ts")["createApp"]>>;
  let computer: ComputerRef | undefined;

  beforeAll(async () => {
    for (const key of ["DATABASE_URL", "E2B_API_KEY", "OPENROUTER_API_KEY"]) {
      if (!process.env[key]) throw new Error(`${key} is required`);
    }
    dataDir = mkdtempSync(path.join(tmpdir(), "rakazo-forum-e2e-"));
    const { createApp } = await import("../../../apps/api/src/app.ts");
    handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      dataDir,
      sandboxProvider: "e2b",
      agentRuntime: "pi",
      e2bApiKey: process.env.E2B_API_KEY,
      openRouterKey: process.env.OPENROUTER_API_KEY,
      defaultProvider: "openrouter",
      defaultModel: MODEL,
      wakeupDriver: "memory",
    });
    await handles.prisma.deploymentSettings.update({
      where: { id: "default" },
      data: { defaultModelProvider: "openrouter", defaultModelId: MODEL },
    });
  }, 120_000);

  afterAll(async () => {
    if (computer) {
      await handles.sandbox.destroy(computer, testContext(computer.botId)).catch(() => undefined);
    }
    await handles?.stop().catch(() => undefined);
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it("registers on an internal forum and posts a comment through the computer", async () => {
    const stamp = Date.now();
    const signup = await handles.app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({
        email: `forum-${stamp}@rakazo.test`,
        password: "password12",
        name: "Forum E2E",
      }),
    });
    expect(signup.status).toBeLessThan(400);
    const cookie = sessionCookieHeader(signup);
    const bot = await rpc<{ id: string }>(handles.app, cookie, "bots/create", {
      name: "ForumRunner",
      title: "Internal forum operator",
      description: "Registers and comments on the internal test forum.",
      instructions:
        "Operate the visible browser with computer_observe and computer_act. Close any file manager that covers the page. Do not visit public internet forums.",
      notifyOnFinish: false,
    });
    await rpc(handles.app, cookie, "computer/boot", { botId: bot.id });
    const storedBot = await handles.prisma.bot.findUniqueOrThrow({
      where: { id: bot.id },
      include: { computer: true },
    });
    const stored = storedBot.computer!;
    computer = {
      id: stored.providerRef!,
      providerRef: stored.providerRef!,
      botId: stored.homeKey,
      kind: "e2b",
    };
    await installForum(handles.sandbox, computer);

    const sent = await rpc<{ runId: string }>(handles.app, cookie, "threads/send", {
      botId: bot.id,
      text: [
        "Open http://127.0.0.1:8765 with open_path.",
        "Click the large REGISTER ON FORUM button.",
        "Re-observe, then click the large POST COMMENT button.",
        "Do not claim success until the page shows the comment hello from rakazo e2e.",
        "Then write_file notes/forum-result.txt containing exactly forum-e2e-ok.",
      ].join(" "),
    });
    const completedRun = await waitForRun(
      () =>
        handles.prisma.run.findUnique({
          where: { id: sent.runId },
          select: { status: true, error: true },
        }),
      240_000,
    );
    const thread = await rpc<{ messages: Array<{ role: string; blocks: unknown[] }> }>(
      handles.app,
      cookie,
      "threads/get",
      { botId: bot.id },
    );
    const botText = JSON.stringify(thread.messages);
    expect(completedRun.status, `${completedRun.error ?? ""} ${botText.slice(0, 1200)}`).toBe(
      "completed",
    );

    const stateRaw = await runCommand(
      handles.sandbox,
      computer,
      "curl -fsS http://127.0.0.1:8765/state",
    );
    const state = JSON.parse(stateRaw.stdout || "{}") as {
      users: Array<{ username: string }>;
      comments: Array<{ text: string }>;
    };
    expect(
      state.users.some((user) => user.username === "rakazo_e2e"),
      `forum=${stateRaw.stdout} ${botText.slice(0, 1200)}`,
    ).toBe(true);
    expect(
      state.comments.some((comment) => comment.text.includes("hello from rakazo e2e")),
      `forum=${stateRaw.stdout} ${botText.slice(0, 1200)}`,
    ).toBe(true);
    const confirmed = await rpc<{ content: string }>(handles.app, cookie, "computer/readFile", {
      botId: bot.id,
      path: "notes/forum-result.txt",
    });
    expect(confirmed.content).toBe("forum-e2e-ok");
  }, 300_000);
});

async function installForum(sandbox: SandboxProvider, computer: ComputerRef) {
  const source = `
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs
import json

STATE = {"users": [], "comments": []}

def page():
    registered = bool(STATE["users"])
    comments = "".join(f"<p style='font-size:36px'>{c['author']}: {c['text']}</p>" for c in STATE["comments"])
    form = '''
      <h1>TEST FORUM REGISTER</h1>
      <form method="post" action="/register">
        <input type="hidden" name="username" value="rakazo_e2e">
        <input type="hidden" name="email" value="rakazo-e2e@example.test">
        <input type="hidden" name="password" value="ForumPass12">
        <button type="submit" style="width:900px;height:220px;font-size:56px;background:#16a34a;color:white;border:0">REGISTER ON FORUM</button>
      </form>
    ''' if not registered else f'''
      <h1>WELCOME {STATE["users"][-1]["username"]}</h1>
      <div>{comments or "<p>No comments yet.</p>"}</div>
      <form method="post" action="/comment">
        <input type="hidden" name="text" value="hello from rakazo e2e">
        <button type="submit" style="width:900px;height:220px;font-size:56px;background:#2563eb;color:white;border:0">POST COMMENT</button>
      </form>
    '''
    return f"""<!doctype html><meta charset="utf-8"><title>Internal Test Forum</title>
<style>body{{font-family:sans-serif;padding:40px}}</style>{form}""".encode()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def _form(self):
        n = int(self.headers.get("Content-Length") or 0)
        return parse_qs(self.rfile.read(n).decode())
    def do_GET(self):
        if self.path.startswith("/state"):
            body = json.dumps(STATE).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(page())
    def do_POST(self):
        form = self._form()
        if self.path.startswith("/register"):
            STATE["users"].append({
                "username": (form.get("username") or [""])[0],
                "email": (form.get("email") or [""])[0],
            })
        elif self.path.startswith("/comment"):
            text = (form.get("text") or [""])[0].strip()
            if text:
                author = STATE["users"][-1]["username"] if STATE["users"] else "anon"
                STATE["comments"].append({"author": author, "text": text})
        self.send_response(303)
        self.send_header("Location", "/")
        self.end_headers()

HTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
`;
  await sandbox.writeFile(
    computer,
    { path: "forum_server.py", content: new TextEncoder().encode(source) },
    testContext(computer.botId),
  );
  const started = await runCommand(
    sandbox,
    computer,
    "nohup python3 forum_server.py > forum-server.log 2>&1 & sleep 0.2",
  );
  if (started.code !== 0) throw new Error(`forum server failed: ${started.stderr}`);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const probe = await runCommand(sandbox, computer, "curl -fsS http://127.0.0.1:8765 >/dev/null");
    if (probe.code === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("forum fixture did not become ready");
}

async function runCommand(
  sandbox: SandboxProvider,
  computer: ComputerRef,
  script: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  let code = 1;
  for await (const event of sandbox.execute(
    computer,
    { argv: ["bash", "-lc", script] },
    testContext(computer.botId),
  )) {
    if (event.type === "stdout") stdout += event.data;
    if (event.type === "stderr") stderr += event.data;
    if (event.type === "exit") code = event.code ?? 1;
  }
  return { code, stdout, stderr };
}

function testContext(botId: string) {
  return {
    operationId: "forum-e2e",
    traceId: "forum-e2e",
    workspaceId: "forum-e2e",
    userId: "forum-e2e",
    botId,
    signal: new AbortController().signal,
  };
}

type App = { request: (input: string, init?: RequestInit) => Promise<Response> };
type RunState = { status: string; error: string | null };

async function rpc<T>(app: App, cookie: string, procedure: string, body: unknown): Promise<T> {
  const response = await app.request(`/rpc/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({ json: body }),
  });
  const parsed = (await response.json()) as { json?: T; error?: { message?: string } };
  if (!response.ok || parsed.error) {
    throw new Error(`${procedure} ${response.status}: ${parsed.error?.message ?? "failed"}`);
  }
  return parsed.json as T;
}

async function waitForRun(load: () => Promise<RunState | null>, timeoutMs: number) {
  const started = Date.now();
  let run: RunState | null = null;
  while (Date.now() - started < timeoutMs) {
    run = await load();
    if (run && ["completed", "failed", "cancelled"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`forum E2E timed out with status ${run?.status ?? "unknown"}`);
}
