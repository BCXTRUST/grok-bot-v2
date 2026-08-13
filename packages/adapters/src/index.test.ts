import { describe, expect, it } from "vitest";
import { EncryptedSecretStore } from "./secrets.js";
import { inferScript } from "./scripted-runtime.js";
import { FakeSandboxProvider } from "./fake-sandbox.js";

describe("secret store", () => {
  it("round-trips and never stores plaintext in ciphertext", async () => {
    const store = new EncryptedSecretStore("test-key");
    const record = await store.put("sk-or-v1-secretvalue", {
      operationId: "1",
      traceId: "1",
      workspaceId: "w",
      userId: "u",
      signal: new AbortController().signal,
    });
    expect(record.ciphertext).not.toContain("sk-or-v1-secretvalue");
    expect(store.load(record.ciphertext)).toBe("sk-or-v1-secretvalue");
  });
});

describe("scripted runtime", () => {
  it("requests takeover for login work", () => {
    const script = inferScript("install the cli and sign in");
    expect(script?.some((t) => t.takeover)).toBe(true);
  });

  it("resumes after takeover without asking again", () => {
    const script = inferScript("install the cli and sign in", "takeover");
    expect(script?.some((t) => t.takeover)).toBe(false);
    expect(script?.some((t) => t.complete)).toBe(true);
  });

  it("routes destination/crm work through the connector", () => {
    const script = inferScript("write this to the destination crm as a note");
    expect(script?.some((t) => t.toolCalls?.some((c) => c.name === "destination.write"))).toBe(true);
  });
});

describe("fake sandbox", () => {
  it("provisions isolated computers", async () => {
    const sandbox = new FakeSandboxProvider();
    const ctx = {
      operationId: "1",
      traceId: "1",
      workspaceId: "w",
      userId: "u",
      signal: new AbortController().signal,
    };
    const a = await sandbox.provision({ botId: "a", homePath: "/tmp/a" }, ctx);
    const b = await sandbox.provision({ botId: "b", homePath: "/tmp/b" }, ctx);
    expect(a.id).not.toBe(b.id);
  });
});
