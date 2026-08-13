import { Hono } from "hono";
import { cors } from "hono/cors";
import { RPCHandler } from "@orpc/server/fetch";
import { blockedAuthPaths, createAuth } from "@rakazo/auth";
import { createDb, requireMembership, type PrismaClient } from "@rakazo/db";
import {
  EncryptedSecretStore,
  GraphileWakeupDriver,
  InMemoryWakeupDriver,
  LocalAgentHomeStore,
  createRunExecutor,
  createSandboxProvider,
  DestinationEmulator,
  PiAgentRuntime,
  ScriptedAgentRuntime,
} from "@rakazo/adapters";
import { MarkdownMemoryStore } from "@rakazo/memory";
import type { WakeupDriver, SandboxProvider } from "@rakazo/adapter-kit";
import { loadEnv, type AppEnv } from "./env.js";
import { createRouter } from "./router.js";

export interface AppHandles {
  app: Hono;
  prisma: PrismaClient;
  wakeup: WakeupDriver;
  sandbox: SandboxProvider;
  connector: DestinationEmulator;
  executor: ReturnType<typeof createRunExecutor>;
  stop: () => Promise<void>;
}

export async function createApp(overrides: Partial<AppEnv> & { prisma?: PrismaClient } = {}): Promise<AppHandles> {
  const env = { ...loadEnv(process.env), ...overrides };
  const created = overrides.prisma ? { prisma: overrides.prisma, pool: undefined } : createDb(env.databaseUrl);
  const { prisma } = created;
  created.pool?.on("error", () => undefined);
  await prisma.deploymentSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });

  const auth = createAuth(prisma, {
    secret: env.authSecret,
    baseURL: env.authUrl,
    webOrigin: env.webOrigin,
    signupsEnabled: env.signupsEnabled,
    signupAllowlist: env.signupAllowlist,
  });
  const wakeupKind = process.env.WAKEUP_DRIVER ?? "memory";
  const wakeup =
    wakeupKind === "graphile" ? new GraphileWakeupDriver(env.databaseUrl) : new InMemoryWakeupDriver();
  const sandbox: SandboxProvider = createSandboxProvider(env.sandboxProvider, {
    supervisorUrl: env.sandboxSupervisorUrl,
    e2bApiKey: env.e2bApiKey,
    dataDir: env.dataDir,
  });
  const secrets = new EncryptedSecretStore(env.encryptionKey);
  const home = new LocalAgentHomeStore(env.dataDir);
  const memory = new MarkdownMemoryStore(prisma);
  const connector = new DestinationEmulator();
  await connector.start();
  const runtime =
    env.agentRuntime === "pi" ? new PiAgentRuntime() : new ScriptedAgentRuntime();
  const executor = createRunExecutor({
    prisma,
    runtime,
    sandbox,
    memory,
    home,
    connector,
    secrets: [env.openRouterKey ?? ""].filter(Boolean),
    secretStore: secrets,
    deploymentModelKey: env.openRouterKey,
  });

  if (wakeupKind !== "graphile") {
    await wakeup.start({
      "run.continue": async (payload) => {
        await executor.continueRun(String(payload.runId), "api");
      },
      "routine.wakeup": async (payload) => {
        await executor.wakeRoutine(String(payload.routineId), "api");
      },
    });
  }

  const router = createRouter({
    prisma,
    auth,
    wakeup,
    sandbox,
    memory,
    home,
    secrets,
    env: {
      defaultProvider: env.defaultProvider,
      defaultModel: env.defaultModel,
      openRouterKey: env.openRouterKey,
    },
  });
  const rpc = new RPCHandler(router);
  const app = new Hono();
  app.use("*", cors({ origin: env.webOrigin, credentials: true }));
  app.on(["GET", "POST"], "/api/auth/*", async (c) => {
    const path = new URL(c.req.url).pathname.replace("/api/auth", "");
    if (blockedAuthPaths.some((blocked) => path.startsWith(blocked))) {
      return c.json({ error: "Not available in version 1" }, 404);
    }
    return auth.handler(c.req.raw);
  });
  app.use("/rpc/*", async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const actor = session?.user
      ? await requireMembership(prisma, session.user.id).catch(() => null)
      : null;
    const { matched, response } = await rpc.handle(c.req.raw, {
      prefix: "/rpc",
      context: { actor },
    });
    if (matched) return c.newResponse(response.body, response);
    await next();
  });
  app.get("/health", (c) => c.json({ ok: true }));

  return {
    app,
    prisma,
    wakeup,
    sandbox,
    connector,
    executor,
    stop: async () => {
      await wakeup.stop();
      await connector.stop();
      await prisma.$disconnect().catch(() => undefined);
      await created.pool?.end().catch(() => undefined);
    },
  };
}
