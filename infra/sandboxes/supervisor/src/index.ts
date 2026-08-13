import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import Docker from "dockerode";
import { Hono } from "hono";
import { z } from "zod";
import {
  COMPUTER_IMAGE,
  containerCreateOptions,
  containerNameFor,
  type SandboxInput,
  screenUrlFor,
  xdotoolCommand,
} from "./computer-spec.js";

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock" });
const computerContext =
  process.env.RAKAZO_COMPUTER_CONTEXT ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../computer");
const boxes = new Map<string, { containerId: string; botId: string; screenUrl: string }>();
let imageReady: Promise<void> | undefined;

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, image: COMPUTER_IMAGE }));

app.post("/computers", async (c) => {
  const body = z
    .object({ botId: z.string(), homePath: z.string(), workspaceId: z.string() })
    .parse(await c.req.json());
  try {
    await ensureComputerImage();
    const homePath = path.resolve(body.homePath);
    await mkdir(homePath, { recursive: true });
    const existing = await findBotContainer(body.botId);
    if (existing) {
      const info = await existing.inspect();
      if (!info.State.Running) await existing.start();
      const screenUrl = await publishedScreenUrl(existing);
      boxes.set(existing.id, { containerId: existing.id, botId: body.botId, screenUrl });
      return c.json({ id: existing.id, image: COMPUTER_IMAGE, screenUrl, resumed: true });
    }
    const name = containerNameFor(body.botId);
    const container = await docker.createContainer(
      containerCreateOptions({
        name,
        image: COMPUTER_IMAGE,
        botId: body.botId,
        workspaceId: body.workspaceId,
        homePath,
      }),
    );
    await container.start();
    const screenUrl = await publishedScreenUrl(container);
    boxes.set(container.id, { containerId: container.id, botId: body.botId, screenUrl });
    return c.json({ id: container.id, image: COMPUTER_IMAGE, screenUrl, resumed: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 500);
  }
});

app.get("/computers/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const container = docker.getContainer(id);
    const info = await container.inspect();
    const screenUrl = await publishedScreenUrl(container);
    return c.json({
      id,
      running: Boolean(info.State.Running),
      image: info.Config.Image,
      screenUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 404);
  }
});

app.post("/computers/:id/exec", async (c) => {
  const id = c.req.param("id");
  const body = z
    .object({
      argv: z.array(z.string()),
      cwd: z.string().optional(),
      env: z.record(z.string(), z.string()).optional(),
    })
    .parse(await c.req.json());
  try {
    const container = docker.getContainer(id);
    const exec = await container.exec({
      Cmd: body.argv.length ? body.argv : ["/bin/echo", "ready"],
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: body.cwd ?? "/home/rakazo",
      Env: [
        "DISPLAY=:1",
        "HOME=/home/rakazo",
        "PATH=/home/rakazo/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "NPM_CONFIG_PREFIX=/home/rakazo/.local",
        "PIP_USER=1",
        ...Object.entries(body.env ?? {}).map(([k, v]) => `${k}=${v}`),
      ],
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (d: Buffer) => chunks.push(d));
      stream.on("end", () => resolve());
      stream.on("error", reject);
    });
    const inspect = await exec.inspect();
    return c.json({
      stdout: stripDockerStream(Buffer.concat(chunks)),
      stderr: "",
      code: inspect.ExitCode ?? 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ stdout: "", stderr: message, code: 1 }, 200);
  }
});

app.get("/computers/:id/screen", async (c) => {
  const id = c.req.param("id");
  try {
    const screenUrl = await publishedScreenUrl(docker.getContainer(id));
    return c.redirect(screenUrl);
  } catch {
    return c.json({ error: "computer not found" }, 404);
  }
});

app.post("/computers/:id/input", async (c) => {
  const id = c.req.param("id");
  const body = z
    .object({
      input: z.object({
        kind: z.enum(["key", "pointer", "clipboard"]),
        key: z.string().optional(),
        modifiers: z.array(z.string()).optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        button: z.enum(["left", "right"]).optional(),
        type: z.enum(["move", "down", "up", "click"]).optional(),
        text: z.string().optional(),
      }),
      leaseId: z.string().optional(),
    })
    .parse(await c.req.json());
  const input = toSandboxInput(body.input);
  try {
    const container = docker.getContainer(id);
    const exec = await container.exec({
      Cmd: ["env", "DISPLAY=:1", ...xdotoolCommand(input)],
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: "/home/rakazo",
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    await new Promise<void>((resolve, reject) => {
      stream.on("end", () => resolve());
      stream.on("error", reject);
      stream.resume();
    });
    const inspect = await exec.inspect();
    if ((inspect.ExitCode ?? 0) !== 0) {
      return c.json({ ok: false, error: "input failed" }, 500);
    }
    return c.json({ ok: true, leaseId: body.leaseId ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ ok: false, error: message }, 500);
  }
});

app.post("/computers/:id/stop", async (c) => {
  await docker
    .getContainer(c.req.param("id"))
    .stop()
    .catch(() => undefined);
  return c.json({ ok: true });
});

app.delete("/computers/:id", async (c) => {
  const id = c.req.param("id");
  await docker
    .getContainer(id)
    .remove({ force: true })
    .catch(() => undefined);
  boxes.delete(id);
  return c.json({ ok: true });
});

const port = Number(process.env.SUPERVISOR_PORT ?? 7091);
serve({ fetch: app.fetch, port }, () => {
  console.log(`sandbox supervisor on http://127.0.0.1:${port}`);
});

async function ensureComputerImage() {
  if (!imageReady) {
    imageReady = (async () => {
      try {
        await docker.getImage(COMPUTER_IMAGE).inspect();
        return;
      } catch {
        // build below
      }
      const dockerfile = path.join(computerContext, "Dockerfile");
      if (!existsSync(dockerfile)) {
        throw new Error(
          `Missing ${COMPUTER_IMAGE}. Build it with: docker build -t ${COMPUTER_IMAGE} infra/sandboxes/computer`,
        );
      }
      const stream = await docker.buildImage(
        { context: computerContext, src: ["Dockerfile", "start.sh", "embed.html", "fluxbox.init"] },
        { t: COMPUTER_IMAGE },
      );
      await new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve()));
      });
      await docker.getImage(COMPUTER_IMAGE).inspect();
    })();
  }
  await imageReady;
}

async function findBotContainer(botId: string) {
  const listed = await docker.listContainers({
    all: true,
    filters: { label: [`rakazo.botId=${botId}`] },
  });
  if (!listed[0]) return undefined;
  return docker.getContainer(listed[0].Id);
}

async function publishedScreenUrl(container: Docker.Container) {
  for (let i = 0; i < 30; i += 1) {
    const info = await container.inspect();
    const hostPort = info.NetworkSettings?.Ports?.["6080/tcp"]?.[0]?.HostPort;
    if (hostPort) return screenUrlFor(hostPort);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("computer screen port was not published");
}

function toSandboxInput(input: {
  kind: "key" | "pointer" | "clipboard";
  key?: string;
  modifiers?: string[];
  x?: number;
  y?: number;
  button?: "left" | "right";
  type?: "move" | "down" | "up" | "click";
  text?: string;
}): SandboxInput {
  if (input.kind === "key")
    return { kind: "key", key: input.key ?? "", modifiers: input.modifiers };
  if (input.kind === "clipboard") return { kind: "clipboard", text: input.text ?? "" };
  return {
    kind: "pointer",
    x: input.x ?? 0,
    y: input.y ?? 0,
    button: input.button,
    type: input.type ?? "click",
  };
}

function stripDockerStream(buffer: Buffer) {
  // docker multiplexed stream: 8-byte header per frame
  if (buffer.length >= 8 && (buffer[0] ?? 99) <= 2) {
    const parts: string[] = [];
    let offset = 0;
    while (offset + 8 <= buffer.length) {
      const size = buffer.readUInt32BE(offset + 4);
      parts.push(buffer.subarray(offset + 8, offset + 8 + size).toString("utf8"));
      offset += 8 + size;
    }
    return parts.join("");
  }
  return buffer.toString("utf8");
}
