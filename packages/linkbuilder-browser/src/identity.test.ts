import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BrowserEngineUnavailable,
  camoufoxExecutable,
  identityLaunchFields,
  launchPlaywrightSession,
} from "./playwright-session.js";

describe("session identity", () => {
  it("carries locale, time zone and Accept-Language and leaves geolocation off", () => {
    const fields = identityLaunchFields({
      profileDir: "/tmp/profile",
      locale: "de-DE",
      timezoneId: "Europe/Berlin",
      acceptLanguage: "de-DE,de;q=0.9,en;q=0.5",
    });
    expect(fields.locale).toBe("de-DE");
    expect(fields.timezoneId).toBe("Europe/Berlin");
    expect(fields.extraHTTPHeaders).toEqual({ "Accept-Language": "de-DE,de;q=0.9,en;q=0.5" });
    expect(fields).not.toHaveProperty("geolocation");
  });

  it("reports camoufox unavailable when the executable is not installed", async () => {
    // CI does not install Camoufox. A missing binary is a skip-with-reason, not a Chromium failure.
    const root = await mkdtemp(join(tmpdir(), "lb-camoufox-"));
    const missing = camoufoxExecutable({}, join(root, "camoufox-missing"));
    expect(missing).toBeNull();
    await expect(
      launchPlaywrightSession({
        profileDir: join(root, "profile"),
        locale: "de-DE",
        timezoneId: "Europe/Berlin",
        engine: "camoufox",
        executablePath: join(root, "camoufox-missing"),
      }),
    ).rejects.toMatchObject({
      name: "BrowserEngineUnavailable",
      code: "unavailable",
      engine: "camoufox",
    });
    await expect(
      launchPlaywrightSession({
        profileDir: join(root, "profile"),
        locale: "de-DE",
        timezoneId: "Europe/Berlin",
        engine: "camoufox",
        executablePath: join(root, "camoufox-missing"),
      }),
    ).rejects.toBeInstanceOf(BrowserEngineUnavailable);
  });
});
