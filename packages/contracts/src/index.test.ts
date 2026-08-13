import { describe, expect, it } from "vitest";
import { CreateBotInput, ProductEventType, appContract } from "./index.js";

describe("contracts", () => {
  it("parses bot create input", () => {
    const parsed = CreateBotInput.parse({ name: "Chief" });
    expect(parsed.title).toBe("");
    expect(parsed.notifyOnFinish).toBe(true);
  });

  it("exposes the product rpc surface", () => {
    expect(appContract.bots.create).toBeTruthy();
    expect(appContract.threads.subscribe).toBeTruthy();
    expect(appContract.computer.grantFolder).toBeTruthy();
    expect(appContract.notifications.registerPush).toBeTruthy();
    expect(ProductEventType.options).toContain("thread.message.created");
  });
});
