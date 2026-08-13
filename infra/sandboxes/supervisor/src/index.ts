import { serve } from "@hono/node-server";
import Docker from "dockerode";
import { Hono } from "hono";
import { z } from "zod";

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock" });
const preferredImage = process.env.RAKAZO_COMPUTER_IMAGE ?? "rakazo/computer:local";
const fallbackImages = [preferredImage, "alpine/git:latest", "alpine:latest", "python:3.12-slim"];
const boxes = new Map<string, { containerId: string; botId: string }>();

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.post("/computers", async (c) => {
  const body = z.object({ botId: z.string(), homePath: z.string(), workspaceId: z.string() }).parse(await c.req.json());
  const name = `rakazo-${body.botId}-${Date.now()}`.slice(0, 60);
  let lastError = "no image available";
  for (const candidate of fallbackImages) {
    try {
      const container = await docker.createContainer({
        Image: candidate,
        name,
        Entrypoint: ["sleep"],
        Cmd: ["infinity"],
        Tty: true,
        Env: ["DISPLAY=:1"],
        HostConfig: {
          AutoRemove: false,
          NetworkMode: "bridge",
        },
      });
      await container.start();
      const id = container.id;
      boxes.set(id, { containerId: id, botId: body.botId });
      return c.json({ id, image: candidate });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return c.json({ error: lastError }, 500);
});

app.post("/computers/:id/exec", async (c) => {
  const id = c.req.param("id");
  const body = z.object({ argv: z.array(z.string()), cwd: z.string().optional() }).parse(await c.req.json());
  try {
    const container = docker.getContainer(id);
    const exec = await container.exec({
      Cmd: body.argv.length ? body.argv : ["/bin/echo", "ready"],
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: body.cwd ?? "/",
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
      stdout: Buffer.concat(chunks).toString("utf8"),
      stderr: "",
      code: inspect.ExitCode ?? 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ stdout: "", stderr: message, code: 1 }, 200);
  }
});

app.get("/computers/:id/screen", (c) => {
  const id = c.req.param("id");
  return c.html(
    `<html><body style="background:#111;color:#eee;font-family:sans-serif;padding:24px">Computer ${id} screen emulator</body></html>`,
  );
});

app.post("/computers/:id/input", (c) => c.json({ ok: true }));
app.post("/computers/:id/stop", async (c) => {
  await docker.getContainer(c.req.param("id")).stop().catch(() => undefined);
  return c.json({ ok: true });
});
app.delete("/computers/:id", async (c) => {
  await docker.getContainer(c.req.param("id")).remove({ force: true }).catch(() => undefined);
  boxes.delete(c.req.param("id"));
  return c.json({ ok: true });
});

const port = Number(process.env.SUPERVISOR_PORT ?? 7091);
serve({ fetch: app.fetch, port }, () => {
  console.log(`sandbox supervisor on http://127.0.0.1:${port}`);
});
