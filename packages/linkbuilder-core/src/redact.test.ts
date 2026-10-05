import { describe, expect, it } from "vitest";
import { REDACTED, redactSecrets } from "./redact.js";

describe("redactSecrets", () => {
  it("removes known secret values, longest first", () => {
    const text = "login failed for pw=Abc!def12345 and short pw Abc!de";
    expect(redactSecrets(text, ["Abc!de", "Abc!def12345"])).toBe(
      `login failed for pw=${REDACTED} and short pw ${REDACTED}`,
    );
  });

  it("leaves short values alone so common words survive", () => {
    expect(redactSecrets("the cat sat", ["cat"])).toBe("the cat sat");
  });

  it("removes solver tokens even when not listed", () => {
    expect(redactSecrets("token ct_live_abcdefgh123 used")).toBe(`token ${REDACTED} used`);
  });

  it("removes proxy userinfo even when the password was not listed", () => {
    expect(redactSecrets("via http://session-user:s3cret-pass@proxy.example:8080/path")).toBe(
      `via http://${REDACTED}/path`,
    );
  });
});
