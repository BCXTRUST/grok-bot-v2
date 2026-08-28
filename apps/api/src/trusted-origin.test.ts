import { describe, expect, it } from "vitest";
import { isTrustedOrigin } from "./trusted-origin.js";

const env = {
  webOrigin: "http://127.0.0.1:5173",
  apiUrl: "http://127.0.0.1:3100",
  authUrl: "http://127.0.0.1:3100",
};

describe("trusted browser origins", () => {
  it("allows Cloudflare quick-tunnel hosts used by public HTTPS previews", () => {
    expect(isTrustedOrigin("https://assembled-fraction-kid-pressing.trycloudflare.com", env)).toBe(
      true,
    );
  });

  it("rejects unrelated public origins", () => {
    expect(isTrustedOrigin("https://evil.example", env)).toBe(false);
  });
});
