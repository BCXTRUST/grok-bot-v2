import { describe, expect, it } from "vitest";
import { signWebhookBody, verifyWebhookSignature, webhookUrlAllowed } from "./webhooks.js";

describe("outbound webhooks", () => {
  it("signs the raw body and rejects a tampered body", async () => {
    const secret = "whsec_test_secret_value";
    const body = JSON.stringify({ kind: "project.paused", projectId: "p1" });
    const header = `sha256=${await signWebhookBody(secret, body)}`;
    expect(await verifyWebhookSignature(secret, body, header)).toBe(true);
    expect(await verifyWebhookSignature(secret, `${body} `, header)).toBe(false);
    expect(await verifyWebhookSignature("whsec_other_secret_value", body, header)).toBe(false);
    expect(await verifyWebhookSignature(secret, body, null)).toBe(false);
  });

  it("allows https and refuses private hosts in production", () => {
    expect(webhookUrlAllowed("https://hooks.example/link-builder", { production: true }).ok).toBe(
      true,
    );
    expect(webhookUrlAllowed("http://hooks.example/link-builder", { production: true }).ok).toBe(
      false,
    );
    expect(webhookUrlAllowed("https://127.0.0.1/hook", { production: true }).ok).toBe(false);
    expect(webhookUrlAllowed("https://10.1.2.3/hook", { production: true }).ok).toBe(false);
    expect(webhookUrlAllowed("https://192.168.1.9/hook", { production: true }).ok).toBe(false);
    expect(webhookUrlAllowed("https://localhost/hook", { production: true }).ok).toBe(false);
    expect(webhookUrlAllowed("https://127.0.0.1/hook", { production: false }).ok).toBe(true);
    expect(
      webhookUrlAllowed("https://user:pass@hooks.example/hook", { production: false }).ok,
    ).toBe(false);
  });
});
