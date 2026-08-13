import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadEnvFile } from "node:process";
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

loadRootEnv();

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock" });
const computerContext =
  process.env.RAKAZO_COMPUTER_CONTEXT ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../computer");
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const dataDir = path.resolve(repositoryRoot, process.env.DATA_DIR ?? "./data");
const boxes = new Map<string, { containerId: string; botId: string; screenUrl: string }>();
let imageReady: Promise<void> | undefined;
let supervisorInfo: Docker.ContainerInspectInfo | undefined;
const supervisorToken =
  process.env.SANDBOX_SUPERVISOR_TOKEN ||
  process.env.BETTER_AUTH_SECRET ||
  "dev-secret-change-me-please-32chars";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, image: COMPUTER_IMAGE }));

app.use("/computers", async (c, next) => {
  if (!hasValidSupervisorToken(c.req.header("authorization"))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});
app.use("/computers/*", async (c, next) => {
  if (!hasValidSupervisorToken(c.req.header("authorization"))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

app.post("/computers", async (c) => {
  const body = z
    .object({
      botId: z.string().min(1),
      homePath: z.string().min(1),
      workspaceId: z.string().min(1),
    })
    .parse(await c.req.json());
  try {
    assertRequestIdentity(c.req.header("x-rakazo-bot-id"), c.req.header("x-rakazo-workspace-id"), {
      botId: body.botId,
      workspaceId: body.workspaceId,
    });
    await ensureComputerImage();
    const runtimeInfo = await inspectSupervisorContainer();
    const networkMode = computerNetworkMode(runtimeInfo);
    const serviceHomePath = path.resolve(body.homePath);
    assertBotHomePath(serviceHomePath, body.botId);
    await mkdir(serviceHomePath, { recursive: true });
    const homePath = hostHomePath(serviceHomePath, runtimeInfo);
    const existing = await findBotContainer(body.botId, body.workspaceId);
    if (existing) {
      const info = await existing.inspect();
      const desired = await docker.getImage(COMPUTER_IMAGE).inspect();
      if (
        info.Image !== desired.Id ||
        (networkMode && info.HostConfig.NetworkMode !== networkMode)
      ) {
        await existing.remove({ force: true }).catch(() => undefined);
        boxes.delete(existing.id);
      } else {
        if (!info.State.Running) await existing.start();
        const screenUrl = await publishedScreenUrl(existing, info.State.Running ? info : undefined);
        boxes.set(existing.id, { containerId: existing.id, botId: body.botId, screenUrl });
        return c.json({ id: existing.id, image: COMPUTER_IMAGE, screenUrl, resumed: true });
      }
    }
    const name = containerNameFor(body.botId);
    const container = await docker.createContainer(
      containerCreateOptions({
        name,
        image: COMPUTER_IMAGE,
        botId: body.botId,
        workspaceId: body.workspaceId,
        homePath,
        networkMode,
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
    const { container, info } = await managedContainer(
      id,
      c.req.header("x-rakazo-bot-id"),
      c.req.header("x-rakazo-workspace-id"),
    );
    const screenUrl = await publishedScreenUrl(container, info);
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
    const { container } = await managedContainer(
      id,
      c.req.header("x-rakazo-bot-id"),
      c.req.header("x-rakazo-workspace-id"),
    );
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
    const { container, info } = await managedContainer(
      id,
      c.req.header("x-rakazo-bot-id"),
      c.req.header("x-rakazo-workspace-id"),
    );
    const screenUrl = await publishedScreenUrl(container, info);
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
    const { container } = await managedContainer(
      id,
      c.req.header("x-rakazo-bot-id"),
      c.req.header("x-rakazo-workspace-id"),
    );
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
  try {
    const { container } = await managedContainer(
      c.req.param("id"),
      c.req.header("x-rakazo-bot-id"),
      c.req.header("x-rakazo-workspace-id"),
    );
    await container.stop().catch(() => undefined);
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "computer not found" }, 404);
  }
});

app.delete("/computers/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const { container } = await managedContainer(
      id,
      c.req.header("x-rakazo-bot-id"),
      c.req.header("x-rakazo-workspace-id"),
    );
    await container.remove({ force: true }).catch(() => undefined);
    boxes.delete(id);
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "computer not found" }, 404);
  }
});

const port = Number(process.env.SUPERVISOR_PORT ?? 7091);
const hostname = process.env.SUPERVISOR_HOST ?? "127.0.0.1";
serve({ fetch: app.fetch, hostname, port }, () => {
  console.log(`sandbox supervisor on http://${hostname}:${port}`);
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
        {
          context: computerContext,
          src: [
            "Dockerfile",
            "start.sh",
            "rakazo-browser",
            "embed.html",
            "fluxbox.init",
            "fluxbox.apps",
            "fluxbox.menu",
          ],
        },
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

async function findBotContainer(botId: string, workspaceId: string) {
  const listed = await docker.listContainers({
    all: true,
    filters: { label: [`rakazo.botId=${botId}`, `rakazo.workspaceId=${workspaceId}`] },
  });
  for (const item of listed) {
    const container = docker.getContainer(item.Id);
    const info = await container.inspect();
    if (isRakazoContainer(info, botId, workspaceId)) return container;
  }
  return undefined;
}

async function managedContainer(id: string, botId?: string, workspaceId?: string) {
  if (!botId || !workspaceId) throw new Error("missing computer identity");
  const container = docker.getContainer(id);
  const info = await container.inspect();
  if (!isRakazoContainer(info, botId, workspaceId)) throw new Error("computer identity mismatch");
  return { container, info };
}

function isRakazoContainer(info: Docker.ContainerInspectInfo, botId: string, workspaceId: string) {
  const labels = info.Config.Labels ?? {};
  const managed = labels["rakazo.managed"] === "true" || info.Config.Image === COMPUTER_IMAGE;
  return (
    managed && labels["rakazo.botId"] === botId && labels["rakazo.workspaceId"] === workspaceId
  );
}

function assertRequestIdentity(
  botId: string | undefined,
  workspaceId: string | undefined,
  expected: { botId: string; workspaceId: string },
) {
  if (botId !== expected.botId || workspaceId !== expected.workspaceId) {
    throw new Error("computer identity mismatch");
  }
}

function assertBotHomePath(homePath: string, botId: string) {
  const expected = path.join(dataDir, "homes", botId);
  if (homePath !== expected) {
    throw new Error("computer home must be the bot's home directory");
  }
}

function hostHomePath(serviceHomePath: string, info: Docker.ContainerInspectInfo | undefined) {
  const dataMount = info?.Mounts.find((mount) => mount.Destination === dataDir);
  if (!dataMount?.Source) return serviceHomePath;
  return path.join(dataMount.Source, path.relative(dataDir, serviceHomePath));
}

function hasValidSupervisorToken(authorization: string | undefined) {
  const supplied = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  const actual = Buffer.from(supervisorToken);
  const candidate = Buffer.from(supplied);
  return actual.length === candidate.length && timingSafeEqual(actual, candidate);
}

function loadRootEnv() {
  const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../.env");
  if (!existsSync(envFile)) return;
  try {
    loadEnvFile(envFile);
  } catch {
    // The API reports malformed or missing deployment configuration in more detail.
  }
}

async function publishedScreenUrl(
  container: Docker.Container,
  initialInfo?: Docker.ContainerInspectInfo,
) {
  for (let i = 0; i < 30; i += 1) {
    const info = i === 0 && initialInfo ? initialInfo : await container.inspect();
    if (process.env.SANDBOX_SCREEN_NETWORK === "internal") {
      const networkMode = info.HostConfig.NetworkMode;
      const address = networkMode
        ? info.NetworkSettings?.Networks?.[networkMode]?.IPAddress
        : undefined;
      if (address) return screenUrlFor("6080", address);
    }
    const hostPort = info.NetworkSettings?.Ports?.["6080/tcp"]?.[0]?.HostPort;
    if (hostPort) return screenUrlFor(hostPort);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("computer screen port was not published");
}

function computerNetworkMode(info: Docker.ContainerInspectInfo | undefined) {
  if (process.env.SANDBOX_SCREEN_NETWORK !== "internal") return undefined;
  return info ? Object.keys(info.NetworkSettings.Networks)[0] : undefined;
}

async function inspectSupervisorContainer() {
  if (supervisorInfo || !process.env.HOSTNAME) return supervisorInfo;
  try {
    supervisorInfo = await docker.getContainer(process.env.HOSTNAME).inspect();
    return supervisorInfo;
  } catch {
    return undefined;
  }
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
