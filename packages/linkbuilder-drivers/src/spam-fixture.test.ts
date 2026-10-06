import { LB_DEFAULT_SPAM_SENTENCES } from "@rakazo/contracts";
import { spamRetryDecision } from "@rakazo/linkbuilder-core";
import { describe, expect, it } from "vitest";
import { startPhpbbFixture } from "./testing/phpbb-fixture.js";

describe("phpBB spam rejection", () => {
  it("shows the spam sentence once, then the board accepts the retry", async () => {
    const board = await startPhpbbFixture({
      challenge: "widget",
      activation: "none",
      spamRejects: 1,
      deliverMail: () => undefined,
    });
    try {
      const agree = await fetch(`${board.origin}/ucp.php?mode=register`, { method: "POST" });
      expect(agree.status).toBe(200);
      const first = await fetch(`${board.origin}/ucp.php?mode=register`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          username: "mira",
          email: "mira@inbox.example",
          new_password: "correct horse battery",
          password_confirm: "correct horse battery",
          confirm_id: "skip",
          confirm_code: "ABCD",
          submit: "1",
        }),
      });
      const firstHtml = await first.text();
      expect(firstHtml).toContain(LB_DEFAULT_SPAM_SENTENCES[0]);
      expect(
        spamRetryDecision({
          messages: [LB_DEFAULT_SPAM_SENTENCES[0]],
          sentences: LB_DEFAULT_SPAM_SENTENCES,
          retriesUsed: 0,
        }),
      ).toBe("retry");
      const second = await fetch(`${board.origin}/ucp.php?mode=register`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          username: "mira",
          email: "mira@inbox.example",
          new_password: "correct horse battery",
          password_confirm: "correct horse battery",
          "g-recaptcha-response": "token",
          submit: "1",
        }),
      });
      const secondHtml = await second.text();
      expect(secondHtml).not.toContain(LB_DEFAULT_SPAM_SENTENCES[0]);
      expect(
        spamRetryDecision({
          messages: [LB_DEFAULT_SPAM_SENTENCES[0]],
          sentences: LB_DEFAULT_SPAM_SENTENCES,
          retriesUsed: 1,
        }),
      ).toBe("block");
    } finally {
      await board.close();
    }
  });
});
