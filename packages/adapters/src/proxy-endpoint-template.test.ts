import type { AdapterContext, SecretRef } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import {
  EndpointTemplateProxyProvider,
  IPROYAL_PRESET,
  OXYLABS_PRESET,
  type ProxyProbeResult,
  readLeaseId,
  renderProxyTemplate,
  stickySessionId,
} from "./proxy-endpoint-template.js";

const PASSWORD = "s3cret-proxy-password";
const context: AdapterContext = {
  operationId: "lease",
  traceId: "lease",
  workspaceId: "ws",
  userId: "user",
  signal: new AbortController().signal,
};

function sealer() {
  const values = new Map<string, string>();
  return {
    values,
    async seal(plaintext: string): Promise<SecretRef> {
      const secretId = `sec-${values.size + 1}`;
      values.set(secretId, plaintext);
      return { secretId };
    },
  };
}

describe("endpoint template proxy", () => {
  it("renders both vendor presets with placeholder host and port", () => {
    expect(IPROYAL_PRESET.gatewayHost).toBe("proxy.example");
    expect(OXYLABS_PRESET.gatewayHost).toBe("proxy.example");
    expect(IPROYAL_PRESET.gatewayPort).toBe(8080);
    expect(OXYLABS_PRESET.gatewayPort).toBe(8080);
    const session = stickySessionId("persona:DE");
    expect(session).toMatch(/^[a-z0-9]{8}$/);
    expect(
      renderProxyTemplate(IPROYAL_PRESET.passwordSuffixTemplate ?? "", {
        country: "DE",
        session,
        ttlMinutes: 10080,
      }),
    ).toBe(`_country-de_session-${session}_lifetime-10080m`);
    expect(
      renderProxyTemplate(OXYLABS_PRESET.usernameTemplate, {
        country: "DE",
        session,
        ttlMinutes: 1440,
      }),
    ).toBe(`customer-USERNAME-cc-de-sessid-${session}-sesstime-1440`);
  });

  it("leases ISP before residential, keeps the session, and returns SecretRefs only", async () => {
    const seal = sealer();
    const now = new Date("2026-10-05T12:00:00.000Z");
    const provider = new EndpointTemplateProxyProvider(OXYLABS_PRESET, {
      now: () => now,
      seal: seal.seal,
    });
    const de = await provider.lease(
      { country: "DE", stickyKey: "project:DE", kinds: ["static_isp", "residential"] },
      context,
    );
    expect(de.kind).toBe("static_isp");
    expect(de.password).toEqual({ secretId: "lb-proxy-password" });
    expect(de.username?.secretId).toMatch(/^sec-/);
    expect(JSON.stringify(de)).not.toContain(PASSWORD);
    expect(JSON.stringify(de)).not.toContain("USERNAME");
    const again = await provider.lease(
      { country: "DE", stickyKey: "project:DE", kinds: ["static_isp", "residential"] },
      context,
    );
    expect(again.id).toBe(de.id);
    expect(again.username).toEqual(de.username);
    expect(readLeaseId(de.id).session).toBe(stickySessionId("project:DE"));

    const za = await provider.lease(
      { country: "ZA", stickyKey: "project:ZA", kinds: ["static_isp", "residential"] },
      context,
    );
    expect(za.kind).toBe("residential");
    const sealed = seal.values.get(za.username?.secretId ?? "") ?? "";
    expect(sealed).toContain("cc-za");
    expect(sealed).not.toContain(PASSWORD);
  });

  it("renews the same session and refuses a blacklisted id", async () => {
    const seal = sealer();
    let now = new Date("2026-10-05T12:00:00.000Z");
    const provider = new EndpointTemplateProxyProvider(IPROYAL_PRESET, {
      now: () => now,
      seal: seal.seal,
    });
    const leased = await provider.lease(
      { country: "DE", stickyKey: "project:DE", kinds: ["static_isp", "residential"] },
      context,
    );
    now = new Date("2026-10-06T12:00:00.000Z");
    const renewed = await provider.renew(leased.id, context);
    expect(renewed.id).toBe(leased.id);
    expect(renewed.renewsAt).toBe(
      new Date(now.getTime() + IPROYAL_PRESET.stickyTtlMs).toISOString(),
    );
    expect(readLeaseId(renewed.id).session).toBe(readLeaseId(leased.id).session);
    await provider.markBlacklisted(leased.id, context);
    await expect(provider.renew(leased.id, context)).rejects.toThrow(/blacklisted/);
    await provider.release(leased.id, context);
    await provider.release(leased.id, context);
    const replaced = await provider.lease(
      { country: "DE", stickyKey: "project:DE:2", kinds: ["static_isp", "residential"] },
      context,
    );
    expect(readLeaseId(replaced.id).session).not.toBe(readLeaseId(leased.id).session);
  });

  it("honours a country allowlist", async () => {
    const seal = sealer();
    const provider = new EndpointTemplateProxyProvider(
      { ...OXYLABS_PRESET, id: "custom", countries: ["DE"] },
      { seal: seal.seal },
    );
    await expect(
      provider.lease(
        { country: "FR", stickyKey: "project:FR", kinds: ["static_isp", "residential"] },
        context,
      ),
    ).rejects.toThrow(/allowlist/);
  });

  it("appends the IPRoyal suffix only when materializing, and probes through an injected fetch", async () => {
    const seal = sealer();
    const provider = new EndpointTemplateProxyProvider(IPROYAL_PRESET, { seal: seal.seal });
    const leased = await provider.lease(
      { country: "DE", stickyKey: "project:DE", kinds: ["static_isp", "residential"] },
      context,
    );
    const seen: string[] = [];
    const creds = await provider.materialize(leased, async (ref) => {
      if (ref.secretId === "lb-proxy-password") return PASSWORD;
      return seal.values.get(ref.secretId) ?? "";
    });
    expect(creds.username).toBe("USERNAME");
    expect(creds.password?.startsWith(`${PASSWORD}_country-de_session-`)).toBe(true);
    expect(creds.password).not.toBe(PASSWORD);
    expect(JSON.stringify(leased)).not.toContain(PASSWORD);
    const result = await provider.probe(
      leased,
      async (ref) => (ref.secretId === "lb-proxy-password" ? PASSWORD : "USERNAME"),
      {
        echoUrl: "https://ip.example/json",
        createAgent: (proxyUrl) => {
          seen.push(proxyUrl);
          return { close: async () => undefined };
        },
        fetchImpl: async () => ({
          ok: true,
          json: async () =>
            ({ ip: "203.0.113.10", country: "DE" }) satisfies ProxyProbeResult & {
              country: string;
            },
        }),
      },
    );
    expect(result).toEqual({ ip: "203.0.113.10", country: "DE" });
    expect(seen[0]).toContain(encodeURIComponent(creds.username ?? ""));
    expect(seen[0]).toContain("proxy.example");
    expect(seen[0]?.startsWith("https://ip.example")).toBe(false);
  });
});
