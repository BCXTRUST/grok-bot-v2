import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AdapterContext, AgentHomeStore, PortableFile } from "@rakazo/adapter-kit";

export class LocalAgentHomeStore implements AgentHomeStore {
  constructor(private readonly root: string) {}

  describe() {
    return {
      id: "local-fs",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { revisions: true },
    };
  }

  private botDir(botId: string) {
    return path.join(this.root, "homes", botId);
  }

  async checkout(botId: string, dest: string, _context: AdapterContext): Promise<string> {
    await mkdir(dest, { recursive: true });
    const src = this.botDir(botId);
    await mkdir(src, { recursive: true });
    await copyDir(src, dest);
    return "working";
  }

  async commit(botId: string, src: string, _context: AdapterContext): Promise<string> {
    const dest = this.botDir(botId);
    await rm(dest, { recursive: true, force: true });
    await mkdir(dest, { recursive: true });
    await copyDir(src, dest);
    const revision = `rev-${Date.now()}`;
    await writeFile(path.join(dest, ".revision"), revision, "utf8");
    return revision;
  }

  async restore(botId: string, _revision: string, dest: string, context: AdapterContext): Promise<void> {
    await this.checkout(botId, dest, context);
  }

  async *exportHome(botId: string, _context: AdapterContext): AsyncIterable<PortableFile> {
    const dir = this.botDir(botId);
    await mkdir(dir, { recursive: true });
    yield* walkFiles(dir, dir);
  }

  async readFile(botId: string, filePath: string, _context: AdapterContext): Promise<string> {
    const full = safeJoin(this.botDir(botId), filePath);
    return readFile(full, "utf8");
  }

  async writeFile(botId: string, filePath: string, content: string, _context: AdapterContext): Promise<void> {
    const full = safeJoin(this.botDir(botId), filePath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }

  async list(botId: string, dirPath: string, _context: AdapterContext) {
    const full = safeJoin(this.botDir(botId), dirPath);
    await mkdir(full, { recursive: true });
    const entries = await readdir(full, { withFileTypes: true });
    return Promise.all(
      entries.map(async (entry) => {
        const child = path.join(full, entry.name);
        const info = await stat(child);
        return {
          path: path.posix.join(dirPath.replace(/\\/g, "/"), entry.name),
          kind: entry.isDirectory() ? ("dir" as const) : ("file" as const),
          size: info.size,
        };
      }),
    );
  }
}

function safeJoin(root: string, rel: string) {
  const resolved = path.resolve(root, `.${path.sep}${rel.replace(/^\/+/, "")}`);
  if (!resolved.startsWith(path.resolve(root))) {
    throw new Error("Invalid path");
  }
  return resolved;
}

async function copyDir(src: string, dest: string) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(from, to);
    else await writeFile(to, await readFile(from));
  }
}

async function* walkFiles(root: string, current: string): AsyncGenerator<PortableFile> {
  const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(root, full);
    } else {
      const content = await readFile(full);
      yield {
        path: path.relative(root, full).replaceAll("\\", "/"),
        content: new Uint8Array(content),
      };
    }
  }
}
