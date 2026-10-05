import { FakeSandboxProvider } from "@rakazo/adapters";
import type { PrismaClient } from "@rakazo/db";
import { LocalBrowserRefused } from "@rakazo/linkbuilder-browser";
import { describe, expect, it } from "vitest";
import { isLinkBuilderFakeEnabled } from "./link-builder-fake.js";
import { isLinkBuilderRealEnabled } from "./link-builder-real.js";
import { templateReply } from "./link-builder-real-steps.js";
import { browserFactoryFromEnv } from "./link-builder-real-wiring.js";

const prisma = {} as PrismaClient;
const sandbox = new FakeSandboxProvider();

describe("link builder real driver wiring", () => {
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
