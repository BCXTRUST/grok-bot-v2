import { describe, expect, it } from "vitest";
import {
  hostsCompatible,
  hostsFromScreenText,
  normalizeSiteLoginHost,
  screenAllowsVaultFill,
  siteLoginUrl,
} from "./site-login-host.js";

describe("normalizeSiteLoginHost", () => {
  it("accepts hostnames and full URLs", () => {
    expect(normalizeSiteLoginHost("https://www.Example.com/login")).toBe("example.com");
    expect(normalizeSiteLoginHost("forum.example.test")).toBe("forum.example.test");
    expect(normalizeSiteLoginHost("https://sub.site.test:443/path")).toBe("sub.site.test");
  });

  it("rejects empty or invalid values", () => {
    expect(() => normalizeSiteLoginHost("")).toThrow(/required/i);
    expect(() => normalizeSiteLoginHost("not a host")).toThrow(/valid site/i);
  });
});

describe("siteLoginUrl", () => {
  it("prefers a valid stored URL", () => {
    expect(siteLoginUrl("example.com", "https://example.com/login")).toBe(
      "https://example.com/login",
    );
    expect(siteLoginUrl("example.com", "not-a-url")).toBe("https://example.com/");
  });
});

describe("screenAllowsVaultFill", () => {
  it("allows the login host and its subdomains from window titles", () => {
    expect(hostsCompatible("login.example.com", "example.com")).toBe(true);
    expect(hostsFromScreenText("Sign in - https://www.forum.example.test/login")).toEqual([
      "forum.example.test",
    ]);
    expect(screenAllowsVaultFill("forum.example.test", "https://forum.example.test/login")).toBe(
      true,
    );
    expect(screenAllowsVaultFill("bank.example.test", "https://forum.example.test/login")).toBe(
      false,
    );
    expect(screenAllowsVaultFill("forum.example.test", "Files")).toBe(false);
  });
});
