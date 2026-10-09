import type { AdapterContext, ProxyEndpoint } from "@rakazo/adapter-kit";
import { FakeSandboxProvider } from "@rakazo/adapters";
import type { PrismaClient } from "@rakazo/db";
import { LocalBrowserRefused } from "@rakazo/linkbuilder-browser";
import { describe, expect, it } from "vitest";
import { isLinkBuilderFakeEnabled } from "./link-builder-fake.js";
import { isLinkBuilderRealEnabled } from "./link-builder-real.js";
import {
  helperConnectionPlan,
  observedPageHelper,
  templateReply,
} from "./link-builder-real-steps.js";
import { browserFactoryFromEnv, proxyResolverFor } from "./link-builder-real-wiring.js";

const prisma = {} as PrismaClient;
const sandbox = new FakeSandboxProvider();

describe("link builder real driver wiring", () => {
  it("uses the Captell API door when the Page Helper is missing", () => {
    expect(helperConnectionPlan(null)).toBe("api");
    expect(helperConnectionPlan("")).toBe("api");
    expect(helperConnectionPlan("2026.10.4.16")).toBe("connected");
    expect(helperConnectionPlan("1999.1.1")).toBe("park");
  });

  it("ignores desktop extensions that are not the Page Helper", () => {
    const unrelated = { id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", version: "1.0" };
    expect(observedPageHelper([unrelated])).toBeNull();
    expect(
      observedPageHelper([
        unrelated,
        { id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", version: "2026.10.4.16" },
      ]),
    ).toEqual({
      version: "2026.10.4.16",
      extensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    expect(
      observedPageHelper([{ id: "kaddlbmbmgfolcpajhnfpcbekblekifn", version: "1999.1.1" }]),
    ).toEqual({
      version: "1999.1.1",
      extensionId: "kaddlbmbmgfolcpajhnfpcbekblekifn",
    });
  });

  it("runs only behind LINK_BUILDER_DRIVER=real and leaves the fake runner off", () => {
    expect(isLinkBuilderRealEnabled({})).toBe(false);
    expect(isLinkBuilderRealEnabled({ LINK_BUILDER_DRIVER: "real" })).toBe(true);
    expect(isLinkBuilderFakeEnabled({ LINK_BUILDER_DRIVER: "real" })).toBe(false);
  });

  it("uses the sandbox browser unless the local browser is opted in", () => {
    const factory = browserFactoryFromEnv({ env: {}, dataDir: "/tmp/data", sandbox, prisma });
    expect(factory.mode).toBe("sandbox");
    const local = browserFactoryFromEnv({
      env: { LINK_BUILDER_BROWSER: "local" },
      dataDir: "/tmp/data",
      sandbox,
      prisma,
    });
    expect(local.mode).toBe("local");
  });

  it("refuses the local browser in production without the allow flag", () => {
    const build = (env: NodeJS.ProcessEnv) =>
      browserFactoryFromEnv({ env, dataDir: "/tmp/data", sandbox, prisma });
    expect(() => build({ LINK_BUILDER_BROWSER: "local", NODE_ENV: "production" })).toThrow(
      LocalBrowserRefused,
    );
    expect(
      build({
        LINK_BUILDER_BROWSER: "local",
        NODE_ENV: "production",
        LINK_BUILDER_ALLOW_LOCAL_BROWSER: "true",
      }).mode,
    ).toBe("local");
  });

  it("builds a Kernel factory only when the secret ref is set", () => {
    expect(() =>
      browserFactoryFromEnv({
        env: { LINK_BUILDER_BROWSER: "kernel" },
        dataDir: "/tmp/data",
        sandbox,
        prisma,
      }),
    ).toThrow(/LINK_BUILDER_KERNEL_SECRET_ID/);
    const kernel = browserFactoryFromEnv({
      env: { LINK_BUILDER_BROWSER: "kernel", LINK_BUILDER_KERNEL_SECRET_ID: "secret-kernel" },
      dataDir: "/tmp/data",
      sandbox,
      prisma,
      secrets: { load: () => "", redact: () => undefined } as never,
    });
    expect(kernel.mode).toBe("kernel");
    expect(kernel.describe().id).toBe("kernel-browser");
    const unused = browserFactoryFromEnv({
      env: { LINK_BUILDER_KERNEL_SECRET_ID: "secret-kernel" },
      dataDir: "/tmp/data",
      sandbox,
      prisma,
      secrets: { load: () => "", redact: () => undefined } as never,
    });
    expect(unused.mode).toBe("sandbox");
  });
});

describe("proxy resolver", () => {
  it("records each revealed proxy secret once", async () => {
    const revealed: string[] = [];
    const prisma = {
      secret: {
        findFirst: async ({ where }: { where: { id: string } }) => ({ ciphertext: where.id }),
      },
    } as unknown as PrismaClient;
    const resolve = proxyResolverFor({
      prisma,
      secrets: {
        load: (ciphertext: string) => (ciphertext === "user" ? "persona-user" : "persona-secret"),
      } as never,
      revealed,
    });
    const endpoint = {
      id: "lease-1",
      country: "DE",
      stickyKey: "persona:DE",
      server: "proxy.example:8080",
      protocol: "http",
      username: { secretId: "user" },
      password: { secretId: "pass" },
      kind: "static_isp",
    } as ProxyEndpoint;
    const context = {
      operationId: "op",
      traceId: "tr",
      workspaceId: "ws",
      userId: "user",
      signal: new AbortController().signal,
    } satisfies AdapterContext;
    await resolve(endpoint, context);
    await resolve(endpoint, context);
    expect(revealed).toEqual(["persona-secret", "persona-user:persona-secret@proxy.example:8080"]);
  });
});

describe("template reply", () => {
  it("inserts exactly one link in the board's markup", () => {
    const body = templateReply({
      brandName: "Vereinsplaner",
      language: "de",
      targetUrl: "https://vereinsplaner.example/mitglieder",
      register: "du",
      format: "bbcode",
    });
    expect(body).toContain("[url=https://vereinsplaner.example/mitglieder]Vereinsplaner[/url]");
    expect(body.match(/\[url=/g)).toHaveLength(1);
    expect(body).not.toContain("[REF]");
  });

  it("falls back to English for languages without a template", () => {
    const body = templateReply({
      brandName: "Planner",
      language: "fr",
      targetUrl: "https://planner.example/",
      register: "du",
      format: "markdown",
    });
    expect(body).toContain("[Planner](https://planner.example/)");
  });
});
