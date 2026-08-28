import { describe, expect, it } from "vitest";
import {
  boundedSandboxCommandTimeoutMs,
  DEFAULT_SANDBOX_COMMAND_TIMEOUT_MS,
  MAX_SANDBOX_COMMAND_TIMEOUT_MS,
  prepareSandboxShellCommand,
  sandboxCommandTimeoutMs,
} from "./sandbox-command.js";

describe("sandbox command timeout", () => {
  it("uses a safe default and accepts a bounded deployment override", () => {
    expect(sandboxCommandTimeoutMs({})).toBe(DEFAULT_SANDBOX_COMMAND_TIMEOUT_MS);
    expect(sandboxCommandTimeoutMs({ SANDBOX_COMMAND_TIMEOUT_MS: "120000" })).toBe(120_000);
    expect(sandboxCommandTimeoutMs({ SANDBOX_COMMAND_TIMEOUT_MS: "invalid" })).toBe(
      DEFAULT_SANDBOX_COMMAND_TIMEOUT_MS,
    );
    expect(
      sandboxCommandTimeoutMs({
        SANDBOX_COMMAND_TIMEOUT_MS: String(MAX_SANDBOX_COMMAND_TIMEOUT_MS + 1),
      }),
    ).toBe(DEFAULT_SANDBOX_COMMAND_TIMEOUT_MS);
  });

  it("honors bounded per-command timeouts and rejects invalid values", () => {
    expect(boundedSandboxCommandTimeoutMs(25, 100)).toBe(25);
    expect(boundedSandboxCommandTimeoutMs(0, 100)).toBe(100);
    expect(boundedSandboxCommandTimeoutMs(Number.NaN, 100)).toBe(100);
    expect(boundedSandboxCommandTimeoutMs(undefined, Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_SANDBOX_COMMAND_TIMEOUT_MS,
    );
  });
});

describe("prepareSandboxShellCommand", () => {
  it("backgrounds flask and python forum servers so the tool can return", () => {
    expect(prepareSandboxShellCommand("python3 forum_server.py")).toContain("nohup");
    expect(prepareSandboxShellCommand("python3 -m flask run --port=8765")).toContain("nohup");
    expect(prepareSandboxShellCommand("python3 -m http.server 8765")).toContain("nohup");
  });

  it("leaves ordinary commands and already-backgrounded servers alone", () => {
    expect(prepareSandboxShellCommand("ls -l")).toBe("ls -l");
    expect(prepareSandboxShellCommand("nohup python3 forum_server.py >/tmp/x.log 2>&1 &")).toBe(
      "nohup python3 forum_server.py >/tmp/x.log 2>&1 &",
    );
    expect(prepareSandboxShellCommand("python3 notes/summarize.py")).toBe(
      "python3 notes/summarize.py",
    );
  });
});
