import { describe, expect, it } from "vitest";
import { UnmappedFormError } from "./driver.js";
import { GenericFormDriver } from "./generic.js";
import { startCustomForumFixture } from "./testing/custom-forum-fixture.js";
import { HtmlBrowserSession } from "./testing/html-session.js";

describe("generic form driver", () => {
  it("maps a labelled form and refuses an ambiguous one", async () => {
    const fixture = await startCustomForumFixture();
    const driver = new GenericFormDriver();
    const session = new HtmlBrowserSession();
    try {
      expect(driver.detect()).toBe(false);
      expect(await driver.openRegistration(session, fixture.origin)).toBe("form");
      await driver.fillRegistration(session, {
        username: "mira_sol42",
        email: "mira@inbox.example",
        password: "Fx-Pass-Word-77",
      });
      expect((await driver.submitRegistration(session)).kind).toBe("pending_email");
      expect(
        await driver.login(session, fixture.origin, {
          username: "mira_sol42",
          password: "Fx-Pass-Word-77",
        }),
      ).toBe(true);
      expect(
        await driver.setProfile(session, fixture.origin, {
          bio: "Mira Sol",
          signature: "https://tips.example/guide",
          includeSignature: false,
        }),
      ).toBe(true);
      expect(fixture.profile()).toEqual({ bio: "Mira Sol", signature: "" });
      const threads = await driver.listThreads(session, fixture.origin);
      expect(threads[0]?.openQuestion).toBe(true);
      expect((await driver.probePageLinkRule(session)).relDefault).toBe("ugc");
      expect(driver.probeLinkRule(await session.pageText())).toMatchObject({
        hrefForNewMembers: "after_n_posts",
        minPosts: 2,
      });
      expect(await driver.openReply(session, threads[0]!)).toBe(true);
      await driver.fillReply(
        session,
        "A shared list is easier for the committee than a spreadsheet.",
      );
      const reply = await driver.submitReply(session);
      expect(reply.kind).toBe("posted");
      if (reply.kind === "posted") expect(reply.permalink).toContain("/thread/1#post1");

      await session.goto(`${fixture.origin}/register?case=odd`);
      expect(await driver.mapOpenRegistration(session)).toBe("unmapped");
      await expect(
        driver.openReply(session, { url: `${fixture.origin}/thread/2`, title: "Odd" }),
      ).rejects.toBeInstanceOf(UnmappedFormError);
    } finally {
      await fixture.close();
    }
  });
});
