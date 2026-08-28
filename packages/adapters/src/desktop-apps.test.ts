import { describe, expect, it } from "vitest";
import {
  browserLaunchFromShellCommand,
  desktopApplicationCandidates,
  launchDesktopAppCommand,
} from "./desktop-apps.js";

describe("desktopApplicationCandidates", () => {
  it("maps browser aliases onto installed Chrome and Firefox binaries", () => {
    expect(desktopApplicationCandidates("browser")).toEqual([
      "google-chrome",
      "google-chrome-stable",
      "chromium",
      "chromium-browser",
      "firefox",
      "firefox-esr",
    ]);
    expect(desktopApplicationCandidates("Firefox")).toEqual(desktopApplicationCandidates("browser"));
    expect(desktopApplicationCandidates("Thunar")).toEqual(["Thunar", "thunar"]);
  });
});

describe("browserLaunchFromShellCommand", () => {
  it("rewrites a PATH-less firefox or chrome command into launch_app", () => {
    expect(browserLaunchFromShellCommand("firefox")).toEqual({ application: "browser" });
    expect(browserLaunchFromShellCommand("google-chrome https://example.com")).toEqual({
      application: "browser",
      uri: "https://example.com",
    });
    expect(browserLaunchFromShellCommand("ls")).toBeNull();
    expect(browserLaunchFromShellCommand("firefox --version")).toBeNull();
  });
});

describe("launchDesktopAppCommand", () => {
  it("tries Chrome and Firefox before gtk-launch desktop entries", () => {
    const command = launchDesktopAppCommand(":0", "firefox", "https://example.com");
    expect(command).toContain("google-chrome");
    expect(command).toContain("firefox-esr");
    expect(command).toContain("gtk-launch");
    expect(command).toContain("https://example.com");
  });
});
