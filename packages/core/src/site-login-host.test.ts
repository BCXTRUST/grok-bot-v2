import { describe, expect, it } from "vitest";
import { normalizeSiteLoginHost, siteLoginUrl } from "./site-login-host.js";

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
