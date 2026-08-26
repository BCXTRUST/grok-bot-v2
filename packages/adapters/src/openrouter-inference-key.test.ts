import { beforeEach, describe, expect, it } from "vitest";
import {
  assertOpenRouterInferenceKey,
  inspectOpenRouterKeyKind,
  preferRunnableOpenRouterKey,
  resetOpenRouterKeyInspectionCache,
} from "./openrouter-inference-key.js";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("openrouter inference keys", () => {
  beforeEach(() => {
    resetOpenRouterKeyInspectionCache();
  });

  it("rejects management keys when connecting", async () => {
    const fetchImpl = async () =>
      jsonResponse(200, { data: { is_management_key: true, is_provisioning_key: true } });
    await expect(
      assertOpenRouterInferenceKey("sk-or-v1-management", fetchImpl as typeof fetch),
    ).rejects.toThrow(/management\/provisioning key/);
  });

  it("accepts regular inference keys", async () => {
    const fetchImpl = async () =>
      jsonResponse(200, { data: { is_management_key: false, is_provisioning_key: false } });
    await expect(
      assertOpenRouterInferenceKey("sk-or-v1-inference", fetchImpl as typeof fetch),
    ).resolves.toBeUndefined();
  });

  it("skips live checks for non-OpenRouter secrets used in tests", async () => {
    const fetchImpl = async () => {
      throw new Error("should not fetch");
    };
    await expect(
      assertOpenRouterInferenceKey("test-openrouter-key-not-a-real-secret", fetchImpl as typeof fetch),
    ).resolves.toBeUndefined();
  });

  it("falls back to the deployment key when the saved key cannot chat", async () => {
    const fetchImpl: typeof fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("/api/v1/key");
      return jsonResponse(200, { data: { is_management_key: true } });
    }) as typeof fetch;
    await expect(
      preferRunnableOpenRouterKey({
        storedKey: "sk-or-v1-management",
        deploymentKey: "sk-or-v1-inference",
        fetchImpl,
      }),
    ).resolves.toBe("sk-or-v1-inference");
  });

  it("treats 401 User not found style key probes as invalid", async () => {
    const fetchImpl = async () => jsonResponse(401, { message: "User not found.", code: 401 });
    await expect(inspectOpenRouterKeyKind("sk-or-v1-dead", fetchImpl as typeof fetch)).resolves.toBe(
      "invalid",
    );
  });
});
