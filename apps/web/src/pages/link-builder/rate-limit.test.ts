import { describe, expect, it } from "vitest";
import { isLinkBuilderRateLimit } from "./rate-limit.js";

describe("link builder rate-limit errors", () => {
  it("recognizes the full-screen status text without treating other failures as limited", () => {
    expect(isLinkBuilderRateLimit(new Error("Too Many Requests"))).toBe(true);
    expect(isLinkBuilderRateLimit({ code: "TOO_MANY_REQUESTS", status: 429 })).toBe(true);
    expect(isLinkBuilderRateLimit(new Error("Could not load"))).toBe(false);
    expect(isLinkBuilderRateLimit(null)).toBe(false);
  });
});
