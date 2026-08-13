import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

describe("loadEnv", () => {
  it("defaults wakeup to Graphile Worker", () => {
    const env = loadEnv({ DATABASE_URL: "postgres://rakazo:rakazo@127.0.0.1:5433/rakazo" });
    expect(env.wakeupDriver).toBe("graphile");
  });

  it("keeps an explicit memory driver for emulator verification", () => {
    const env = loadEnv({
      DATABASE_URL: "postgres://rakazo:rakazo@127.0.0.1:5433/rakazo",
      WAKEUP_DRIVER: "memory",
    });
    expect(env.wakeupDriver).toBe("memory");
  });
});
