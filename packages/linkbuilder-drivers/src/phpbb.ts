import type { BrowserSession } from "@rakazo/adapter-kit";
import type {
  ActivationResult,
  BoardAccount,
  BoardDriver,
  BoardThread,
  CaptchaChallenge,
  LinkRuleProbe,
  ProfileInput,
  RegistrationPage,
  RegistrationResult,
  ReplyResult,
} from "./driver.js";
import { detectWidget } from "./widgets.js";

/*
 * phpBB 3.x (prosilver and derived styles). Selectors follow the stock templates: ucp.php for
 * registration and login, viewforum/viewtopic for listing, posting.php for replies. Messages are
 * matched in English and German because those are the shipped language packs we target first.
 */

export const PHPBB_SELECTORS = {
  agreeButton: "#agreed, input[name='agreed']",
  registerForm: "form#register",
  username: "#username",
  email: "#email",
  password: "#new_password",
  passwordConfirm: "#password_confirm",
  captchaImage: "img[src*='mode=confirm']",
  captchaAnswer: "#confirm_code",
  questionText: "#qa_answer",
  registerSubmit: "form#register #submit, form#register input[name='submit']",
  loginForm: "form#login",
  loginUsername: "form#login #username",
  loginPassword: "form#login #password",
  loginSubmit: "form#login input[name='login']",
  logoutLink: "a[href*='mode=logout']",
  forumLink: "a.forumtitle",
  topicLink: "a.topictitle",
  replyLink: "a[href*='posting.php?mode=reply']",
  replyMessage: "form#postform textarea#message",
  replySubmit: "form#postform input[name='post']",
  postedLink: "div#message a[href*='viewtopic.php?p=']",
  messagePanel: "div#message",
  errors: ".error",
} as const;

const PENDING_EMAIL =
  /activation key has been sent|check your e-?mail|aktivierungsschlüssel .* gesendet|e-?mail.*(aktivier|bestätig)/i;
const PENDING_ADMIN =
  /administrator (must|will) (activate|approve)|activation by an administrator|vom administrator (freigeschaltet|aktiviert)/i;
const ACTIVE =
  /account has (now )?been (created|activated|registered)|you (may|can) now (log ?in|login)|registrierung (war|ist) erfolgreich|konto wurde (aktiviert|erstellt)/i;
const CAPTCHA_REJECTED =
  /confirmation code you entered was incorrect|solution you provided was incorrect|bestätigungscode .* (falsch|nicht korrekt)/i;
const REGISTRATION_CLOSED =
  /registration (is )?(disabled|closed)|registrierung (ist )?deaktiviert/i;
const POSTED = /posted successfully|erfolgreich (erstellt|gespeichert|eingetragen)/i;

function boardRoot(homepageUrl: string): string {
  const url = new URL(homepageUrl);
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/[^/]*$/, "");
  return url.href;
}

function absolute(href: string, base: string): string {
  return new URL(href, base).href;
}

/** Canonical post permalink `viewtopic.php?p=<id>#p<id>`, or null when the URL has no post id. */
export function phpbbPermalink(url: string): string | null {
  const parsed = new URL(url);
  const id = parsed.searchParams.get("p") ?? /^#p(\d+)$/.exec(parsed.hash)?.[1];
  if (!id || !/^\d+$/.test(id)) return null;
  const root = boardRoot(parsed.href);
  return `${root}viewtopic.php?p=${id}#p${id}`;
}

async function collect(
  selector: (index: number) => string,
  limit: number,
  read: (selector: string) => Promise<string | null>,
): Promise<string[]> {
  const values: string[] = [];
  for (let index = 1; index <= limit; index += 1) {
    const value = await read(selector(index));
    if (value === null) break;
    values.push(value);
  }
  return values;
}

export class PhpbbDriver implements BoardDriver {
  readonly platform = "phpbb" as const;
  readonly bodyFormat = "bbcode" as const;
  readonly allowEmoji = false;
  readonly nofollowDefault = true;

  detect(html: string, url = ""): boolean {
    const blob = `${html}\n${url}`;
    return /viewtopic\.php|ucp\.php\?mode=register/i.test(blob) && /phpbb|confirm_code/i.test(blob);
  }

  registerUrl(homepageUrl: string): string {
    return `${boardRoot(homepageUrl)}ucp.php?mode=register`;
  }

  async openRegistration(session: BrowserSession, homepageUrl: string): Promise<RegistrationPage> {
    await session.goto(this.registerUrl(homepageUrl));
    if (await session.exists(PHPBB_SELECTORS.agreeButton)) {
      await session.click(PHPBB_SELECTORS.agreeButton);
    }
    if (await session.waitFor(PHPBB_SELECTORS.username, { timeoutMs: 10_000 })) return "form";
    return REGISTRATION_CLOSED.test(await session.pageText()) ? "closed" : "unknown";
  }

  async fillRegistration(session: BrowserSession, account: BoardAccount): Promise<void> {
    await session.fill(PHPBB_SELECTORS.username, account.username);
    await session.fill(PHPBB_SELECTORS.email, account.email);
    await session.fill(PHPBB_SELECTORS.password, account.password, { secret: true });
    await session.fill(PHPBB_SELECTORS.passwordConfirm, account.password, { secret: true });
  }

  async detectCaptcha(session: BrowserSession): Promise<CaptchaChallenge> {
    if (await session.exists(PHPBB_SELECTORS.captchaImage)) {
      return {
        kind: "image",
        imageSelector: PHPBB_SELECTORS.captchaImage,
        answerSelector: PHPBB_SELECTORS.captchaAnswer,
      };
    }
    if (await session.exists(PHPBB_SELECTORS.questionText)) {
      const question = (await session.text("label[for='qa_answer']")) ?? "";
      return { kind: "question", question, answerSelector: PHPBB_SELECTORS.questionText };
    }
    return detectWidget(session);
  }

  readonly registerSubmitSelector = PHPBB_SELECTORS.registerSubmit;

  async submitRegistration(session: BrowserSession): Promise<RegistrationResult> {
    await session.click(PHPBB_SELECTORS.registerSubmit);
    return this.readRegistrationResult(session, { waitMs: 15_000 });
  }

  async readRegistrationResult(
    session: BrowserSession,
    options: { waitMs?: number } = {},
  ): Promise<RegistrationResult> {
    if (options.waitMs) {
      await session.waitFor(`${PHPBB_SELECTORS.messagePanel}, ${PHPBB_SELECTORS.errors}`, {
        timeoutMs: options.waitMs,
      });
    }
    const messages = await this.pageMessages(session);
    const text = messages.join("\n");
    if (CAPTCHA_REJECTED.test(text)) return { kind: "captcha_rejected" };
    if (PENDING_ADMIN.test(text)) return { kind: "pending_admin" };
    if (PENDING_EMAIL.test(text)) return { kind: "pending_email" };
    if (ACTIVE.test(text)) return { kind: "active" };
    if (await session.exists(PHPBB_SELECTORS.registerForm)) return { kind: "form_error", messages };
    return { kind: "unknown", messages };
  }

  async activationResult(session: BrowserSession): Promise<ActivationResult> {
    const text = (await this.pageMessages(session)).join("\n");
    if (PENDING_ADMIN.test(text)) return "pending_admin";
    if (ACTIVE.test(text)) return "active";
    return "unknown";
  }

  async isLoggedIn(session: BrowserSession): Promise<boolean> {
    return session.exists(PHPBB_SELECTORS.logoutLink);
  }

  async login(
    session: BrowserSession,
    homepageUrl: string,
    account: Pick<BoardAccount, "username" | "password">,
  ): Promise<boolean> {
    await session.goto(`${boardRoot(homepageUrl)}ucp.php?mode=login`);
    if (await this.isLoggedIn(session)) return true;
    if (!(await session.waitFor(PHPBB_SELECTORS.loginForm, { timeoutMs: 10_000 }))) return false;
    await session.fill(PHPBB_SELECTORS.loginUsername, account.username);
    await session.fill(PHPBB_SELECTORS.loginPassword, account.password, { secret: true });
    await session.click(PHPBB_SELECTORS.loginSubmit);
    return session.waitFor(PHPBB_SELECTORS.logoutLink, { timeoutMs: 10_000 });
  }

  async listThreads(session: BrowserSession, homepageUrl: string): Promise<BoardThread[]> {
    const root = boardRoot(homepageUrl);
    await session.goto(root);
    const forumHrefs = await collect(
      (index) => `li.row:nth-of-type(${index}) ${PHPBB_SELECTORS.forumLink}`,
      10,
      (selector) => session.attribute(selector, "href"),
    );
    const threads: BoardThread[] = [];
    for (const href of forumHrefs.slice(0, 3)) {
      await session.goto(absolute(href, root));
      for (let index = 1; index <= 25; index += 1) {
        const selector = `ul.topics li.row:nth-of-type(${index}) ${PHPBB_SELECTORS.topicLink}`;
        const topicHref = await session.attribute(selector, "href");
        if (topicHref === null) break;
        const title = (await session.text(selector)) ?? "";
        const replies = await session.text(`ul.topics li.row:nth-of-type(${index}) dd.posts`);
        threads.push({
          url: absolute(topicHref, await session.url()),
          title,
          replyCount: replies ? Number.parseInt(replies, 10) || 0 : undefined,
        });
      }
    }
    return threads;
  }

  async openReply(session: BrowserSession, thread: BoardThread): Promise<boolean> {
    await session.goto(thread.url);
    const href = await session.attribute(PHPBB_SELECTORS.replyLink, "href");
    if (!href) return false;
    await session.goto(absolute(href, await session.url()));
    return session.waitFor(PHPBB_SELECTORS.replyMessage, { timeoutMs: 10_000 });
  }

  async fillReply(session: BrowserSession, body: string): Promise<void> {
    await session.fill(PHPBB_SELECTORS.replyMessage, body);
  }

  async submitReply(session: BrowserSession): Promise<ReplyResult> {
    await session.click(PHPBB_SELECTORS.replySubmit);
    await session.waitFor(`${PHPBB_SELECTORS.messagePanel}, ${PHPBB_SELECTORS.errors}, div.post`, {
      timeoutMs: 15_000,
    });
    const direct = phpbbPermalink(await session.url());
    if (direct) return { kind: "posted", permalink: direct };
    const messages = await this.pageMessages(session);
    const href = await session.attribute(PHPBB_SELECTORS.postedLink, "href");
    const permalink = href ? phpbbPermalink(absolute(href, await session.url())) : null;
    if (permalink && POSTED.test(messages.join("\n"))) return { kind: "posted", permalink };
    if (await session.exists(PHPBB_SELECTORS.replyMessage)) return { kind: "rejected", messages };
    return { kind: "unknown", messages };
  }

  probeLinkRule(pageText: string): LinkRuleProbe {
    const text = pageText.replace(/\s+/g, " ");
    const afterPosts =
      /(?:links?|urls?)[^.]{0,80}?(?:until|before|after)[^.]{0,40}?(\d{1,4})\s*(?:posts?|beiträge)/i.exec(
        text,
      ) ??
      /links?[^.]{0,60}?(?:ab|nach)\s*(\d{1,4})\s*beiträgen?/i.exec(text) ??
      /(?:ab|nach)\s*(\d{1,4})\s*beiträgen?[^.]{0,60}?links?/i.exec(text) ??
      /(\d{1,4})\s*(?:posts?|beiträge)[^.]{0,60}?(?:before|bevor)[^.]{0,40}?links?/i.exec(text);
    if (afterPosts) {
      return {
        hrefForNewMembers: "after_n_posts",
        minPosts: Number(afterPosts[1]),
        relDefault: "unknown",
      };
    }
    if (
      /(?:new|neue) (?:members|users|mitglieder|benutzer)[^.]{0,60}?(?:cannot|may not|can't|dürfen keine|können keine)[^.]{0,30}?links?/i.test(
        text,
      )
    ) {
      return { hrefForNewMembers: "no", minPosts: null, relDefault: "unknown" };
    }
    return { hrefForNewMembers: "unknown", minPosts: null, relDefault: "unknown" };
  }

  async setProfile(
    session: BrowserSession,
    homepageUrl: string,
    profile: ProfileInput,
  ): Promise<boolean> {
    await session.goto(`${boardRoot(homepageUrl)}ucp.php?i=ucp_profile&mode=profile_info`);
    if (!(await session.exists("#profile-bio"))) return false;
    await session.fill("#profile-bio", profile.bio);
    if (await session.exists("#profile-signature")) {
      await session.fill(
        "#profile-signature",
        profile.includeSignature ? (profile.signature ?? "") : "",
      );
    }
    if (await session.exists("#profile-submit")) await session.click("#profile-submit");
    return true;
  }

  async pageMessages(session: BrowserSession): Promise<string[]> {
    const error = await session.text(PHPBB_SELECTORS.errors);
    const panel = await session.text(PHPBB_SELECTORS.messagePanel);
    return [error, panel].map((text) => text?.trim() ?? "").filter(Boolean);
  }
}
