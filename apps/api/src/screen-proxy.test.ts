import { describe, expect, it } from "vitest";
import { addScreenProxyCapability, shouldProxyComputerScreen } from "./screen-proxy.js";

describe("screen proxy capability", () => {
  it("signs loopback Docker screen URLs without changing their destination", () => {
    const result = new URL(
      addScreenProxyCapability(
        "http://127.0.0.1:49152/embed.html?view_only=true",
        "secret",
        "https://app.example",
        100,
      ),
    );
    expect(result.origin).toBe("https://app.example");
    expect(result.pathname).toMatch(
      /^\/novnc\/[\w-]+\/49152\/view\/3600100\.[\w-]{43}\/embed\.html$/,
    );
    expect(result.searchParams.get("view_only")).toBe("true");
  });

  it("does not modify managed-provider URLs", () => {
    const url = "https://sandbox.example/embed.html?token=provider-token";
    expect(addScreenProxyCapability(url, "secret", "https://app.example", 100)).toBe(url);
  });

  it("keeps external desktop secrets behind an encrypted, policy-bound capability", () => {
    const result = new URL(
      addScreenProxyCapability(
        "https://box.example/vnc.html?token=provider-token&view_only=true",
        "secret",
        "https://app.example",
        100,
        { proxyExternal: true },
      ),
    );
    expect(result.origin).toBe("https://app.example");
    expect(result.pathname).toMatch(/^\/novnc\/remote\/view\/3600100\.[\w-]+\/vnc\.html$/);
    expect(result.toString()).not.toContain("provider-token");
  });

  it("proxies remote E2B and Box screens, not loopback Docker", () => {
    const e2b =
      "https://49982-user.e2b.app/vnc.html?autoconnect=true&view_only=true&password=secret";
    expect(shouldProxyComputerScreen(e2b, "e2b")).toBe(true);
    expect(shouldProxyComputerScreen("https://box.example/vnc.html?token=x", "box")).toBe(true);
    expect(
      shouldProxyComputerScreen("http://127.0.0.1:49152/embed.html?view_only=true", "docker"),
    ).toBe(false);
    const proxied = new URL(
      addScreenProxyCapability(e2b, "secret", "https://app.example", 100, {
        proxyExternal: shouldProxyComputerScreen(e2b, "e2b"),
      }),
    );
    expect(proxied.origin).toBe("https://app.example");
    expect(proxied.pathname).toMatch(/^\/novnc\/remote\/view\/3600100\.[\w-]+\/vnc\.html$/);
    expect(proxied.toString()).not.toContain("password=secret");
  });
});
