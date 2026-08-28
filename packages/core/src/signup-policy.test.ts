import { describe, expect, it } from "vitest";
import { emailAllowed, parseAllowlist, resolveSignupPolicy, signupsOpen } from "./signup-policy.js";

describe("signup policy", () => {
  it("allows any email when the list is empty", () => {
    expect(emailAllowed("a@x.com", [])).toBe(true);
  });

  it("matches exact addresses and domains case-insensitively", () => {
    const list = parseAllowlist("You@Example.com,@company.com");
    expect(emailAllowed("you@example.com", list)).toBe(true);
    expect(emailAllowed("dev@company.com", list)).toBe(true);
    expect(emailAllowed("other@x.com", list)).toBe(false);
  });

  it("honors SIGNUPS_ENABLED", () => {
    expect(signupsOpen(undefined)).toBe(true);
    expect(signupsOpen("false")).toBe(false);
  });

  it("prefers stored deployment settings over env allowlists", () => {
    expect(
      resolveSignupPolicy({
        envEnabled: "true",
        envAllowlist: "owner@example.com",
        stored: { signupsEnabled: true, signupAllowlist: "" },
      }),
    ).toEqual({ open: true, allowlist: [] });
    expect(
      resolveSignupPolicy({
        envEnabled: "true",
        envAllowlist: "",
        stored: { signupsEnabled: false, signupAllowlist: "a@x.com" },
      }),
    ).toEqual({ open: false, allowlist: ["a@x.com"] });
  });

  it("falls back to env when no stored settings exist", () => {
    expect(
      resolveSignupPolicy({
        envEnabled: "true",
        envAllowlist: "@company.com",
        stored: null,
      }),
    ).toEqual({ open: true, allowlist: ["@company.com"] });
  });

  it("does not keep an env allowlist once stored settings exist", () => {
    expect(
      resolveSignupPolicy({
        envEnabled: "true",
        envAllowlist: "@rakazo.test,owner@example.com",
        stored: { signupsEnabled: true, signupAllowlist: "" },
      }),
    ).toEqual({ open: true, allowlist: [] });
  });
});
