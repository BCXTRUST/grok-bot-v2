import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AdapterContext,
  CommandRequest,
  ComputerInput,
  ComputerRef,
  ControlLeaseRef,
  ProcessEvent,
  SandboxProvider,
  ScreenRequest,
  ScreenSession,
} from "@rakazo/adapter-kit";

interface DesktopBox {
  ref: ComputerRef;
  home: string;
  grants: string[];
  running: boolean;
  screen: string;
}

export class DesktopSandboxProvider implements SandboxProvider {
  readonly boxes = new Map<string, DesktopBox>();

  constructor(private readonly opts: { root?: string; grants?: string[] } = {}) {}

  describe() {
    return {
      id: "desktop",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: {
        graphical: true,
        pty: true,
        snapshots: true,
        takeover: true,
        persistentHome: true,
      },
    };
  }

  async provision(request: { botId: string; homePath: string }, _context: AdapterContext): Promise<ComputerRef> {
    const id = `desktop-${request.botId}-${randomUUID().slice(0, 8)}`;
    const home = path.resolve(this.opts.root ?? path.join(process.cwd(), "data"), "desktop-computers", request.botId);
    await mkdir(home, { recursive: true });
    const ref: ComputerRef = { id, botId: request.botId, kind: "desktop", providerRef: home };
    this.boxes.set(id, {
      ref,
      home,
      grants: [...(this.opts.grants ?? []), home],
      running: true,
      screen: "ready",
    });
    return ref;
  }

  addGrant(folder: string) {
    const resolved = path.resolve(folder);
    this.opts.grants = [...new Set([...(this.opts.grants ?? []), resolved])];
    for (const box of this.boxes.values()) {
      if (!box.grants.includes(resolved)) box.grants.push(resolved);
    }
  }

  async *execute(
    computer: ComputerRef,
    request: CommandRequest,
    _context: AdapterContext,
  ): AsyncIterable<ProcessEvent> {
    const box = this.boxes.get(computer.id);
    if (!box) {
      yield { type: "stderr", data: "computer not found" };
      yield { type: "exit", code: 1 };
      return;
    }
    const cwd = request.cwd ? path.resolve(box.home, request.cwd) : box.home;
    if (!allowedPath(cwd, box.grants)) {
      yield { type: "stderr", data: "path is not granted" };
      yield { type: "exit", code: 1 };
      return;
    }
    await mkdir(cwd, { recursive: true });
    const argv = request.argv.length ? request.argv : ["echo", "ready"];
    const result = await runCommand(argv, cwd);
    if (result.stdout) yield { type: "stdout", data: result.stdout };
    if (result.stderr) yield { type: "stderr", data: result.stderr };
    yield { type: "exit", code: result.code };
  }

  async connectScreen(computer: ComputerRef, _request: ScreenRequest, _context: AdapterContext): Promise<ScreenSession> {
    return {
      url: `desktop://screen/${computer.id}`,
      mimeType: "text/plain",
      close: async () => undefined,
    };
  }

  async sendInput(
    computer: ComputerRef,
    input: ComputerInput,
    _lease: ControlLeaseRef,
    _context: AdapterContext,
  ): Promise<void> {
    const box = this.boxes.get(computer.id);
    if (box && input.kind === "clipboard") box.screen = input.text;
  }

  async snapshot(computer: ComputerRef, _context: AdapterContext) {
    return { id: `desktop-snap-${computer.id}`, createdAt: new Date().toISOString() };
  }

  async stop(computer: ComputerRef): Promise<void> {
    const box = this.boxes.get(computer.id);
    if (box) box.running = false;
  }

  async destroy(computer: ComputerRef): Promise<void> {
    const box = this.boxes.get(computer.id);
    this.boxes.delete(computer.id);
    if (box && this.opts.root) {
      await writeFile(path.join(box.home, ".stopped"), new Date().toISOString(), "utf8").catch(() => undefined);
    }
    if (box && !this.opts.root) {
      await rm(box.home, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function allowedPath(target: string, grants: string[]) {
  const resolved = path.resolve(target);
  return grants.some((grant) => {
    const root = path.resolve(grant);
    return resolved === root || resolved.startsWith(root + path.sep);
  });
}

function runCommand(argv: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (argv[0] === "echo") {
        resolve({ stdout: `${argv.slice(1).join(" ")}\n`, stderr: "", code: 0 });
        return;
      }
      resolve({ stdout: "", stderr: error.message, code: 1 });
    });
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}
