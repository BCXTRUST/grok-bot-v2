import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";

function loadRootEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, ".env");
    if (existsSync(candidate)) {
      config({ path: candidate, override: false });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  config();
}
loadRootEnv();

import {
  createRunExecutor,
  createSandboxProvider,
  DestinationEmulator,
  EncryptedSecretStore,
  GraphileWakeupDriver,
  InMemoryWakeupDriver,
  LocalAgentHomeStore,
  PiAgentRuntime,
  ScriptedAgentRuntime,
} from "@rakazo/adapters";
import { createDb } from "@rakazo/db";
import { MarkdownMemoryStore } from "@rakazo/memory";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const { prisma } = createDb(databaseUrl);
  const runtime =
    process.env.AGENT_RUNTIME === "pi" ? new PiAgentRuntime() : new ScriptedAgentRuntime();
  const sandbox = createSandboxProvider(process.env.SANDBOX_PROVIDER ?? "fake", {
    supervisorUrl: process.env.SANDBOX_SUPERVISOR_URL ?? "http://127.0.0.1:7091",
    e2bApiKey: process.env.E2B_API_KEY,
    dataDir: process.env.DATA_DIR ?? "./data",
  });
  const connector = new DestinationEmulator();
  await connector.start();
  const secrets = new EncryptedSecretStore(process.env.ENCRYPTION_KEY ?? "dev-encryption-key");
  const executor = createRunExecutor({
    prisma,
    runtime,
    sandbox,
    memory: new MarkdownMemoryStore(prisma),
    home: new LocalAgentHomeStore(process.env.DATA_DIR ?? "./data"),
    connector,
    secrets: [process.env.OPENROUTER_API_KEY ?? ""].filter(Boolean),
    secretStore: secrets,
    deploymentModelKey: process.env.OPENROUTER_API_KEY,
  });

  const wakeup =
    process.env.WAKEUP_DRIVER === "memory"
      ? new InMemoryWakeupDriver()
      : new GraphileWakeupDriver(databaseUrl);

  await wakeup.start({
    "run.continue": async (payload) => {
      await executor.continueRun(String(payload.runId), process.pid.toString());
    },
    "routine.wakeup": async (payload) => {
      await executor.wakeRoutine(String(payload.routineId), process.pid.toString());
    },
  });

  console.log("rakazo worker ready");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
