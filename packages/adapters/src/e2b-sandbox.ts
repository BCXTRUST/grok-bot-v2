import { Sandbox } from "@e2b/desktop";
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

export class E2BSandboxProvider implements SandboxProvider {
  private readonly boxes = new Map<string, Sandbox>();

  constructor(private readonly apiKey: string) {}

  describe() {
    return {
      id: "e2b",
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

  private async box(computer: ComputerRef): Promise<Sandbox> {
    const existing = this.boxes.get(computer.id);
    if (existing) return existing;
    const connected = await Sandbox.connect(computer.id, { apiKey: this.apiKey });
    this.boxes.set(computer.id, connected);
    return connected;
  }

  async provision(
    request: { botId: string; homePath: string },
    _context: AdapterContext,
  ): Promise<ComputerRef> {
    const desktop = await Sandbox.create({
      apiKey: this.apiKey,
      timeoutMs: 15 * 60_000,
      metadata: { botId: request.botId },
    });
    await desktop.files.makeDir("/home/user/rakazo-home").catch(() => undefined);
    await desktop.stream.start({ requireAuth: true }).catch(() => desktop.stream.start());
    this.boxes.set(desktop.sandboxId, desktop);
    return {
      id: desktop.sandboxId,
      botId: request.botId,
      kind: "e2b",
      providerRef: desktop.sandboxId,
    };
  }

  async *execute(
    computer: ComputerRef,
    request: CommandRequest,
    _context: AdapterContext,
  ): AsyncIterable<ProcessEvent> {
    const desktop = await this.box(computer);
    const cmd = request.argv.join(" ");
    const result = await desktop.commands.run(cmd, { cwd: request.cwd ?? "/home/user" });
    if (result.stdout) yield { type: "stdout", data: result.stdout };
    if (result.stderr) yield { type: "stderr", data: result.stderr };
    yield { type: "exit", code: result.exitCode ?? 0 };
  }

  async connectScreen(
    computer: ComputerRef,
    _request: ScreenRequest,
    _context: AdapterContext,
  ): Promise<ScreenSession> {
    const desktop = await this.box(computer);
    const authKey = await Promise.resolve(
      desktop.stream.getAuthKey?.() as string | Promise<string> | undefined,
    ).catch(() => undefined);
    const url =
      typeof desktop.stream.getUrl === "function"
        ? desktop.stream.getUrl(authKey ? { authKey } : undefined)
        : null;
    return {
      url,
      mimeType: "text/html",
      close: async () => {
        await desktop.stream.stop().catch(() => undefined);
      },
    };
  }

  async sendInput(
    computer: ComputerRef,
    input: ComputerInput,
    _lease: ControlLeaseRef,
    _context: AdapterContext,
  ): Promise<void> {
    const desktop = await this.box(computer);
    if (input.kind === "key") {
      await desktop.press(input.key);
    } else if (input.kind === "pointer") {
      if (input.type === "move") await desktop.moveMouse(input.x, input.y);
      else if (input.type === "click" || input.type === "down") {
        if (input.button === "right") await desktop.rightClick(input.x, input.y);
        else await desktop.leftClick(input.x, input.y);
      }
    } else if (input.kind === "clipboard") {
      await desktop.write(input.text);
    }
  }

  async snapshot(computer: ComputerRef, _context: AdapterContext) {
    const desktop = await this.box(computer);
    await desktop.screenshot().catch(() => undefined);
    return { id: `e2b-${computer.id}-${Date.now()}`, createdAt: new Date().toISOString() };
  }

  async stop(computer: ComputerRef, _context: AdapterContext): Promise<void> {
    const desktop = this.boxes.get(computer.id);
    if (desktop) await desktop.betaPause?.().catch(() => desktop.kill());
  }

  async destroy(computer: ComputerRef, _context: AdapterContext): Promise<void> {
    const desktop = await this.box(computer).catch(() => undefined);
    await desktop?.kill();
    this.boxes.delete(computer.id);
  }
}
