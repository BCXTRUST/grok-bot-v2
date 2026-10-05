import { describe, expect, it } from "vitest";
import type { CaptchaChallenge } from "./driver.js";
import type { MarkupBoardDriver } from "./markup-driver.js";
import { formErrorFixable, usernameTaken } from "./messages.js";
import {
  FIXTURE_THREAD_TITLE,
  type MarkupFixture,
  type MarkupFixtureOptions,
} from "./testing/board-fixture.js";
import { HtmlBrowserSession } from "./testing/html-session.js";

const account = {
  username: "mira_sol42",
  password: "Fx-Pass-Word-77",
  email: "mira@inbox.example",
};

function replyBody(format: MarkupBoardDriver["bodyFormat"]): string {
  if (format === "markdown") {
    return "A shared list is easier for the whole committee. [the guide](https://tips.example/guide)";
  }
  if (format === "plain") {
    return "A shared list is easier for the whole committee. https://tips.example/guide";
  }
  return "A shared list is easier for the whole committee. [url=https://tips.example/guide]the guide[/url]";
}

async function passDoor(
  session: HtmlBrowserSession,
  driver: MarkupBoardDriver,
  answer: string,
): Promise<CaptchaChallenge> {
  const door = await driver.detectCaptcha(session);
  if (door.kind === "image") await session.fill(door.answerSelector, answer);
  if (door.kind === "widget") {
    const field =
      door.type === "hcaptcha"
        ? "h-captcha-response"
        : door.type === "turnstile"
          ? "cf-turnstile-response"
          : "g-recaptcha-response";
    await session.fill(`[name='${field}']`, "fixture-token");
  }
  return door;
}

export function platformSuite(input: {
  driver: MarkupBoardDriver;
  start: (options: MarkupFixtureOptions) => Promise<MarkupFixture>;
  door: "image" | "widget" | "none";
  widgetType?: string;
  permalink: RegExp;
  jsonPath?: string;
}): void {
  const { driver } = input;
  describe(`${driver.platform} driver`, () => {
    it("matches its footprint and permalink shape", () => {
      expect(driver.detect(driver.config.footprintSample)).toBe(true);
      expect(driver.detect("<p>unrelated page</p>")).toBe(false);
      expect(driver.allowEmoji).toBe(driver.config.allowEmoji);
      expect(driver.nofollowDefault).toBe(driver.config.nofollowDefault);
      if (driver.minPostsBeforeLink !== undefined) {
        expect(driver.minPostsBeforeLink).toBeGreaterThanOrEqual(1);
      }
    });

    it("registers, verifies, replies and reads the link rule", async () => {
      const mail: { textBody: string }[] = [];
      const fixture = await input.start({
        rel: "nofollow",
        linkRuleMinPosts: 3,
        captchaAnswer: "K7XQ2",
        deliverMail: (message) => void mail.push(message),
      });
      try {
        const session = new HtmlBrowserSession();
        await session.goto(driver.registerUrl(fixture.origin));
        expect(driver.detect(session.html(), await session.url())).toBe(true);
        expect(await driver.openRegistration(session, fixture.origin)).toBe("form");
        await driver.fillRegistration(session, account);
        const door = await passDoor(session, driver, fixture.captchaAnswer);
        expect(door.kind).toBe(input.door);
        if (door.kind === "widget" && input.widgetType) {
          expect(door).toMatchObject({ type: input.widgetType });
        }
        if (door.kind === "widget") expect(door.siteKey).toBe("fixture-site-key");
        const pending = await driver.submitRegistration(session);
        expect(pending.kind).toBe("pending_email");
        const submits = fixture.registrationSubmits();
        expect(await driver.readRegistrationResult(session)).toEqual(pending);
        expect(fixture.registrationSubmits()).toBe(submits);
        const link = /https?:\/\/\S+/.exec(mail[0]?.textBody ?? "")?.[0];
        expect(link).toBeTruthy();
        await session.goto(link!);
        expect(await driver.activationResult(session)).toBe("active");
        expect(
          await driver.login(session, fixture.origin, {
            username: account.username,
            password: account.password,
          }),
        ).toBe(true);
        expect(
          await driver.setProfile(session, fixture.origin, {
            bio: "Mira Sol",
            signature: "https://tips.example/guide",
            includeSignature: false,
          }),
        ).toBe(true);
        expect(fixture.profile(account.username)?.bio).toBe("Mira Sol");
        expect(fixture.profile(account.username)?.signature).toBe("");
        await driver.setProfile(session, fixture.origin, {
          bio: "Mira Sol",
          signature: "https://tips.example/guide",
          includeSignature: true,
        });
        expect(fixture.profile(account.username)?.signature).toContain(
          "https://tips.example/guide",
        );
        const threads = await driver.listThreads(session, fixture.origin);
        expect(threads[0]).toMatchObject({
          title: FIXTURE_THREAD_TITLE,
          openQuestion: true,
        });
        expect(threads[0]?.lastActivityAt).toBeTruthy();
        expect(await driver.openReply(session, threads[0]!)).toBe(true);
        expect(driver.probeLinkRule(await session.pageText())).toMatchObject({
          hrefForNewMembers: "after_n_posts",
          minPosts: 3,
        });
        expect((await driver.probePageLinkRule(session)).relDefault).toBe("nofollow");
        await driver.fillReply(session, replyBody(driver.bodyFormat));
        const reply = await driver.submitReply(session);
        expect(reply.kind).toBe("posted");
        if (reply.kind !== "posted") return;
        expect(reply.permalink).toMatch(input.permalink);
        expect(driver.config.permalink(reply.permalink)).toBe(reply.permalink);
        await session.goto(reply.permalink);
        expect(session.html()).toContain("https://tips.example/guide");
        if (input.jsonPath) {
          const json = (await (await fetch(`${fixture.origin}${input.jsonPath}`)).json()) as {
            title: string;
          };
          expect(json.title).toBe(FIXTURE_THREAD_TITLE);
        }
      } finally {
        await fixture.close();
      }
    });

    it("treats a taken username as a form error and accepts the corrected resubmit", async () => {
      const fixture = await input.start({
        captchaAnswer: "K7XQ2",
        deliverMail: () => undefined,
      });
      try {
        const session = new HtmlBrowserSession("taken");
        expect(await driver.openRegistration(session, fixture.origin)).toBe("form");
        await driver.fillRegistration(session, { ...account, username: "taken_user" });
        await passDoor(session, driver, fixture.captchaAnswer);
        const taken = await driver.submitRegistration(session);
        expect(taken.kind).toBe("form_error");
        if (taken.kind !== "form_error") return;
        expect(usernameTaken(taken.messages)).toBe(true);
        expect(formErrorFixable(taken.messages)).toBe(true);
        expect(taken.kind).not.toBe("captcha_rejected");
        await driver.fillRegistration(session, { ...account, username: "mira_fixed" });
        await passDoor(session, driver, fixture.captchaAnswer);
        expect((await driver.submitRegistration(session)).kind).toBe("pending_email");
      } finally {
        await fixture.close();
      }
    });

    it("does not call a short username a captcha failure", async () => {
      const fixture = await input.start({
        captchaAnswer: "K7XQ2",
        deliverMail: () => undefined,
      });
      try {
        const session = new HtmlBrowserSession("short");
        await driver.openRegistration(session, fixture.origin);
        await driver.fillRegistration(session, { ...account, username: "ab" });
        await passDoor(session, driver, fixture.captchaAnswer);
        const result = await driver.submitRegistration(session);
        expect(result.kind).toBe("form_error");
        if (result.kind !== "form_error") return;
        expect(formErrorFixable(result.messages)).toBe(false);
      } finally {
        await fixture.close();
      }
    });

    it.each(["follow", "nofollow", "ugc"] as const)(
      "samples rel=%s from a new member",
      async (rel) => {
        const fixture = await input.start({ rel, deliverMail: () => undefined });
        try {
          const session = new HtmlBrowserSession(rel);
          await session.goto(new URL(driver.config.threadHref, fixture.origin).href);
          expect((await driver.probePageLinkRule(session)).relDefault).toBe(rel);
        } finally {
          await fixture.close();
        }
      },
    );
  });
}
