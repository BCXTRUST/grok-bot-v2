import { LB_DEFAULT_SPAM_SENTENCES } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { spamRetryDecision } from "./spam.js";

describe("spam retry", () => {
  it("retries a spam-protection rejection once, then blocks the host", () => {
    const sentences = [...LB_DEFAULT_SPAM_SENTENCES];
    expect(
      spamRetryDecision({
        messages: ["Die Registrierung ist wegen Spamschutzmaßnahmen fehlgeschlagen."],
        sentences,
        retriesUsed: 0,
      }),
    ).toBe("retry");
    expect(
      spamRetryDecision({
        messages: ["No soup for you!"],
        sentences,
        retriesUsed: 1,
      }),
    ).toBe("block");
    expect(
      spamRetryDecision({
        messages: ["The username you entered is already in use."],
        sentences,
        retriesUsed: 0,
      }),
    ).toBe("ignore");
  });
});
