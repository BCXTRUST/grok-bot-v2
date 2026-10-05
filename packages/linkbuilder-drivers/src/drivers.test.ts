import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AdapterContext, type BrowserSession, FakeCaptchaSolver } from "@rakazo/adapter-kit";
import { LocalBrowserSessionFactory } from "@rakazo/linkbuilder-browser";
import { browserTestGate, FIXTURE_PAGE_HELPER_DIR } from "@rakazo/linkbuilder-browser/testing";
import { HELPER_LABELS, TEST_PACING } from "@rakazo/linkbuilder-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runPageHelper, solveImageCaptcha } from "./captcha.js";
import { acceptCookieWall } from "./cookie-wall.js";
import { boardDriverFor, supportedPlatforms } from "./index.js";
import { PhpbbDriver, phpbbPermalink } from "./phpbb.js";
import { type FixtureMail, renderBbcode, startPhpbbFixture } from "./testing/phpbb-fixture.js";
import { normalizeTargetUrl, VerifyRefused, verifyPlacement } from "./verify.js";

const context: AdapterContext = {
  operationId: "op",
  traceId: "trace",
  workspaceId: "ws",
  userId: "user",
  signal: new AbortController().signal,
};

const driver = new PhpbbDriver();
const target = "https://www.vereinsplaner.example/mitglieder?utm_source=forum";

describe("phpBB driver helpers", () => {
  it("is registered for phpBB only so far", () => {
    expect(supportedPlatforms()).toEqual(["phpbb"]);
    expect(boardDriverFor("phpbb")).toBeInstanceOf(PhpbbDriver);
    expect(boardDriverFor("xenforo")).toBeNull();
  });

  it("builds canonical permalinks", () => {
    expect(phpbbPermalink("http://board.test/forum/viewtopic.php?p=17#p17")).toBe(
      "http://board.test/forum/viewtopic.php?p=17#p17",
    );
    expect(phpbbPermalink("http://board.test/viewtopic.php?t=3&start=10#p42")).toBe(
      "http://board.test/viewtopic.php?p=42#p42",
    );
    expect(phpbbPermalink("http://board.test/viewtopic.php?t=3")).toBeNull();
    expect(driver.registerUrl("http://board.test/forum/index.php?sid=1")).toBe(
      "http://board.test/forum/ucp.php?mode=register",
    );
  });

  it("probes the new-member link rule", () => {
    expect(
      driver.probeLinkRule("New members cannot post links until they have made 5 posts."),
    ).toEqual({ hrefForNewMembers: "after_n_posts", minPosts: 5 });
    expect(driver.probeLinkRule("Links sind erst nach 10 Beiträgen erlaubt.")).toEqual({
      hrefForNewMembers: "after_n_posts",
      minPosts: 10,
    });
    expect(driver.probeLinkRule("Neue Mitglieder dürfen keine Links posten.")).toEqual({
      hrefForNewMembers: "no",
      minPosts: null,
    });
    expect(driver.probeLinkRule("Be polite.")).toEqual({
      hrefForNewMembers: "unknown",
      minPosts: null,
    });
  });

  it("renders BBCode links safely", () => {
    expect(renderBbcode('[url=https://a.example/x]A & "B"[/url]', "nofollow")).toBe(
      '<a href="https://a.example/x" class="postlink" rel="nofollow">A &amp; &quot;B&quot;</a>',
    );
    expect(renderBbcode("[url=javascript:alert(1)]x[/url]", "ugc")).toBe("x");
    expect(renderBbcode("<b>hi</b>", "follow")).toBe("&lt;b&gt;hi&lt;/b&gt;");
  });

  it("normalises link targets", () => {
    expect(normalizeTargetUrl("https://WWW.Example.com/a/?utm_source=x&b=1#top")).toBe(
      "example.com/a?b=1",
    );
    expect(normalizeTargetUrl("ftp://example.com")).toBeNull();
  });
});

describe("logged-out verification", () => {
  const mail: FixtureMail[] = [];
  const fixtures: Array<Awaited<ReturnType<typeof startPhpbbFixture>>> = [];
  const board = async (rel: "follow" | "nofollow" | "ugc") => {
    const fixture = await startPhpbbFixture({ rel, deliverMail: (m) => void mail.push(m) });
    fixtures.push(fixture);
    const id = fixture.seedPost(
      "mira",
      "See [url=https://vereinsplaner.example/mitglieder/]the member guide[/url].",
    );
    return { fixture, id };
  };
  afterAll(async () => {
    await Promise.all(fixtures.map((fixture) => fixture.close()));
  });

  it.each([
    ["follow", "live", []],
    ["nofollow", "nofollow_live", ["nofollow"]],
    ["ugc", "nofollow_live", ["ugc"]],
  ] as const)("reports %s links", async (rel, status, relTokens) => {
    const { fixture, id } = await board(rel);
    const result = await verifyPlacement({
      postUrl: `${fixture.origin}/viewtopic.php?p=${id}#p${id}`,
      targetUrl: target,
      allowPrivateNetwork: true,
    });
    expect(result.outcome.status).toBe(status);
    expect(result.outcome.rel).toEqual(relTokens);
    expect(result.anchorText).toBe("the member guide");
    expect(result.html).toContain(`id="p${id}"`);
  });

  it("reports removed links and dead posts", async () => {
    const { fixture } = await board("ugc");
    const removed = await verifyPlacement({
      postUrl: `${fixture.origin}/viewtopic.php?p=1#p1`,
      targetUrl: target,
      allowPrivateNetwork: true,
    });
    expect(removed.outcome.status).toBe("removed");
    const dead = await verifyPlacement({
      postUrl: `${fixture.origin}/viewtopic.php?p=404#p404`,
      targetUrl: target,
      allowPrivateNetwork: true,
    });
    expect(dead.outcome.status).toBe("dead");
  });

  it("refuses private addresses unless allowed", async () => {
    const { fixture, id } = await board("ugc");
    await expect(
      verifyPlacement({
        postUrl: `${fixture.origin}/viewtopic.php?p=${id}#p${id}`,
        targetUrl: target,
      }),
    ).rejects.toBeInstanceOf(VerifyRefused);
    expect(fixture.requests).toHaveLength(0);
  });
});

const gate = browserTestGate();

describe.skipIf(!gate.available)(
  `phpBB driver in Chromium${gate.reason ? ` (${gate.reason})` : ""}`,
  () => {
    const mail: FixtureMail[] = [];
    let fixture: Awaited<ReturnType<typeof startPhpbbFixture>>;
    let root = "";
    let session: BrowserSession;

    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), "rakazo-lb-drivers-"));
      fixture = await startPhpbbFixture({
        rel: "ugc",
        cookieWall: true,
        linkRuleMinPosts: 0,
        deliverMail: (m) => void mail.push(m),
      });
      const factory = new LocalBrowserSessionFactory({
        profileRoot: root,
        helperDirs: [FIXTURE_PAGE_HELPER_DIR],
        headless: true,
        pacing: TEST_PACING,
        env: { LINK_BUILDER_BROWSER: "local" },
      });
      session = await factory.open(
        { projectId: "p", profileKey: "drivers", locale: "en-US", timezoneId: "UTC" },
        context,
      );
    });

    afterAll(async () => {
      await session?.close();
      await fixture?.close();
      await rm(root, { recursive: true, force: true });
    });

    it("registers, activates, logs in and replies with a link", async () => {
      await session.goto(fixture.origin);
      expect(await acceptCookieWall(session)).toBe("accepted");
      expect(await acceptCookieWall(session)).toBe("none");

      expect(await driver.openRegistration(session, fixture.origin)).toBe("form");
      const account = {
        username: "mira_sol42",
        password: "Fx-Pass-Word-77",
        email: "mira@inbox.example",
      };
      await driver.fillRegistration(session, account);
      const challenge = await driver.detectCaptcha(session);
      expect(challenge.kind).toBe("image");
      if (challenge.kind !== "image") return;

      const wrong = new FakeCaptchaSolver({ outcomes: ["WRONG"] });
      await solveImageCaptcha(session, challenge, wrong, context);
      expect(await driver.submitRegistration(session)).toEqual({ kind: "captcha_rejected" });

      await driver.fillRegistration(session, account);
      const solver = new FakeCaptchaSolver({ outcomes: ["K7XQ2"] });
      const solution = await solveImageCaptcha(session, challenge, solver, context);
      expect(solution.credits).toBeGreaterThan(0);
      const request = solver.requests[0];
      expect(request?.type === "ImageToText" && request.imagePng.byteLength).toBeGreaterThanOrEqual(
        100,
      );
      expect(await driver.submitRegistration(session)).toEqual({ kind: "pending_email" });

      expect(mail).toHaveLength(1);
      const link = /https?:\/\/\S+mode=activate\S+/.exec(mail[0]!.textBody)?.[0];
      await session.goto(link!);
      expect(await driver.activationResult(session)).toBe("active");

      expect(await driver.login(session, fixture.origin, account)).toBe(true);
      const threads = await driver.listThreads(session, fixture.origin);
      expect(threads).toHaveLength(1);
      expect(threads[0]).toMatchObject({ replyCount: 0 });
      expect(await driver.openReply(session, threads[0]!)).toBe(true);
      expect(driver.probeLinkRule(await session.pageText()).hrefForNewMembers).toBe(
        "after_n_posts",
      );
      await driver.fillReply(
        session,
        "We use a hosted planner. [url=https://vereinsplaner.example/mitglieder]member guide[/url]",
      );
      const reply = await driver.submitReply(session);
      expect(reply).toEqual({
        kind: "posted",
        permalink: `${fixture.origin}/viewtopic.php?p=2#p2`,
      });
      expect(fixture.users.get("mira_sol42")?.postCount).toBe(1);
    });

    it.each([
      ["ok", "submit", HELPER_LABELS.placed],
      ["no_token", "submit", HELPER_LABELS.placed],
      ["missing_key", "stop_host", HELPER_LABELS.missingSiteKey],
      ["unsupported", "stop_host", HELPER_LABELS.unsupportedType],
    ] as const)(
      "runs the Page Helper state machine on the %s widget",
      async (fixtureCase, action, label) => {
        await session.goto(`${fixture.origin}/widget.php?case=${fixtureCase}`);
        expect(await session.waitFor("[data-page-helper]", { timeoutMs: 10_000 })).toBe(true);
        const challenge = await driver.detectCaptcha(session);
        expect(challenge).toMatchObject({ kind: "widget", type: "recaptcha_v2" });
        const run = await runPageHelper(session, {
          buttonSelector: "[data-page-helper]",
          submitSelector: "#widget-submit",
          pageMessages: (s) => driver.pageMessages(s),
          pollMs: 50,
        });
        expect(run.decision.action).toBe(action);
        expect(run.buttonText).toBe(label);
        if (action === "submit") {
          expect(run.decision.outcome).toBe("placed_submitted");
          expect(await session.text("div#message")).toContain("the form was accepted");
          expect(run.decision.tries).toBe(fixtureCase === "no_token" ? 2 : 1);
        } else {
          expect(run.decision.hostEvent).toBe("unsupported_captcha");
        }
      },
    );
  },
);
