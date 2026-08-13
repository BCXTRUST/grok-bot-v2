import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

describe("loadEnv", () => {
  it("defaults the product path to Pi, Docker, and Graphile Worker", () => {
    const env = loadEnv({ DATABASE_URL: "postgres://rakazo:rakazo@127.0.0.1:5433/rakazo" });
    expect(env.agentRuntime).toBe("pi");
    expect(env.sandboxProvider).toBe("docker");
    expect(env.wakeupDriver).toBe("graphile");
  });

  it("keeps explicit emulator settings for pnpm verify:fast", () => {
    const env = loadEnv({
      DATABASE_URL: "postgres://rakazo:rakazo@127.0.0.1:5433/rakazo",
      AGENT_RUNTIME: "scripted",
      SANDBOX_PROVIDER: "fake",
      WAKEUP_DRIVER: "memory",
    });
    expect(env.agentRuntime).toBe("scripted");
    expect(env.sandboxProvider).toBe("fake");
    expect(env.wakeupDriver).toBe("memory");
  });
});
