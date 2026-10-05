import type { BrowserSession, FormFieldInfo } from "@rakazo/adapter-kit";
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
import { UnmappedFormError } from "./driver.js";
import { classifyRegistration, postedSuccessfully, relFromAttribute } from "./messages.js";
import { detectWidget } from "./widgets.js";

/**
 * Fallback for an unrecognised board. Fields are chosen from labels, autocomplete, names and
 * roles. A tie or a missing submit parks the host; the mapper never screenshots the page.
 */

interface MappedRegister {
  username: FormFieldInfo;
  email: FormFieldInfo;
  password: FormFieldInfo;
  confirm: FormFieldInfo | null;
  consent: FormFieldInfo | null;
  submit: FormFieldInfo;
}

interface MappedLogin {
  identity: FormFieldInfo;
  password: FormFieldInfo;
  submit: FormFieldInfo;
}

interface MappedReply {
  body: FormFieldInfo;
  submit: FormFieldInfo;
}

function blob(field: FormFieldInfo): string {
  return `${field.name ?? ""} ${field.id ?? ""} ${field.label} ${field.autocomplete ?? ""}`.toLowerCase();
}

function best(
  fields: readonly FormFieldInfo[],
  score: (field: FormFieldInfo) => number,
  minimum: number,
): FormFieldInfo | null {
  let top: FormFieldInfo | null = null;
  let high = 0;
  let count = 0;
  for (const field of fields) {
    const value = score(field);
    if (value > high) {
      high = value;
      top = field;
      count = 1;
    } else if (value === high && value > 0) count += 1;
  }
  if (!top || high < minimum || count > 1) return null;
  return top;
}

function isSubmit(field: FormFieldInfo): boolean {
  if (field.type === "reset" || field.type === "button") return false;
  return field.type === "submit" || field.tag === "button";
}

function pickSubmit(
  fields: readonly FormFieldInfo[],
  purpose: "register" | "login" | "reply",
): FormFieldInfo | null {
  const submits = fields.filter(isSubmit);
  if (submits.length === 1) return submits[0] ?? null;
  const hint =
    purpose === "register"
      ? /register|sign ?up|join|create|submit/
      : purpose === "login"
        ? /log ?in|sign ?in|submit/
        : /reply|post|submit|comment/;
  const matched = submits.filter((field) => hint.test(blob(field)));
  return matched.length === 1 ? (matched[0] ?? null) : null;
}

function scoreUsername(field: FormFieldInfo): number {
  if (
    field.type === "password" ||
    field.type === "email" ||
    field.type === "checkbox" ||
    field.type === "hidden"
  ) {
    return 0;
  }
  if (isSubmit(field)) return 0;
  let score = 0;
  if (field.autocomplete === "username") score += 4;
  if (/^(user_?name|login|nick|handle|name|form_name)$/.test((field.name ?? "").toLowerCase()))
    score += 3;
  if (/username|user name|benutzername|\bhandle\b|display name/.test(blob(field))) score += 2;
  return score;
}

function scoreEmail(field: FormFieldInfo): number {
  let score = 0;
  if (field.type === "email") score += 4;
  if (field.autocomplete === "email") score += 4;
  if (/e-?mail/.test(blob(field))) score += 3;
  return score;
}

function scorePassword(field: FormFieldInfo, kind: "register" | "login"): number {
  if (field.type !== "password") return 0;
  if (/confirm|repeat|again|match|password2|password-confirm/.test(blob(field))) return 0;
  let score = 0;
  if (kind === "register" && field.autocomplete === "new-password") score += 4;
  if (kind === "login" && field.autocomplete === "current-password") score += 4;
  if (/password|secret|\bpass\b/.test(blob(field))) score += 3;
  return score;
}

function scoreConfirm(field: FormFieldInfo): number {
  if (field.type !== "password") return 0;
  return /confirm|repeat|again|match|password2|password-confirm/.test(blob(field)) ? 4 : 0;
}

function scoreBody(field: FormFieldInfo): number {
  if (field.tag !== "textarea" && field.role !== "textbox") return 0;
  return /message|body|content|comment|\braw\b|reply/.test(blob(field)) ? 4 : 0;
}

function scoreConsent(field: FormFieldInfo): number {
  if (field.type !== "checkbox") return 0;
  return /agree|terms|consent|rules|accept/.test(blob(field)) ? 3 : 0;
}

function scoreBio(field: FormFieldInfo): number {
  if (field.tag !== "textarea" && field.role !== "textbox") return 0;
  return /\bbio\b|about me|about/.test(blob(field)) ? 4 : 0;
}

function mapRegister(fields: readonly FormFieldInfo[]): MappedRegister | null {
  const username = best(fields, scoreUsername, 2);
  const email = best(fields, scoreEmail, 2);
  const password = best(fields, (field) => scorePassword(field, "register"), 2);
  const submit = pickSubmit(fields, "register");
  if (!username || !email || !password || !submit) return null;
  if (new Set([username.selector, email.selector, password.selector]).size < 3) return null;
  return {
    username,
    email,
    password,
    confirm: best(fields, scoreConfirm, 2),
    consent: best(fields, scoreConsent, 2),
    submit,
  };
}

function mapLogin(fields: readonly FormFieldInfo[]): MappedLogin | null {
  const username = best(fields, scoreUsername, 2);
  const email = best(fields, scoreEmail, 2);
  const identity = username ?? email;
  const password = best(fields, (field) => scorePassword(field, "login"), 2);
  const submit = pickSubmit(fields, "login");
  if (!identity || !password || !submit) return null;
  if (identity.selector === password.selector) return null;
  return { identity, password, submit };
}

function mapReply(fields: readonly FormFieldInfo[]): MappedReply | null {
  const body = best(fields, scoreBody, 2);
  const submit = pickSubmit(fields, "reply");
  if (!body || !submit) return null;
  return { body, submit };
}

async function fieldsIn(
  session: BrowserSession,
  selector: string,
): Promise<FormFieldInfo[] | null> {
  if (!session.formFields) return null;
  return session.formFields(selector);
}

export class GenericFormDriver implements BoardDriver {
  readonly platform = "unknown" as const;
  readonly bodyFormat = "plain" as const;
  readonly allowEmoji = false;
  readonly nofollowDefault = true;
  private registerMap: MappedRegister | null = null;
  private replyMap: MappedReply | null = null;

  get registerSubmitSelector(): string {
    return this.registerMap?.submit.selector ?? "form [data-unmapped-submit]";
  }

  detect(): boolean {
    return false;
  }

  registerUrl(homepageUrl: string): string {
    return new URL("/register", homepageUrl).href;
  }

  async openRegistration(session: BrowserSession, homepageUrl: string): Promise<RegistrationPage> {
    await session.goto(this.registerUrl(homepageUrl));
    return this.mapOpenRegistration(session);
  }

  /** Classifies the current page without navigating. */
  async mapOpenRegistration(session: BrowserSession): Promise<RegistrationPage> {
    const fields = await fieldsIn(session, "form");
    this.registerMap = fields ? mapRegister(fields) : null;
    if (!this.registerMap) return "unmapped";
    return (await session.exists(this.registerMap.username.selector)) ? "form" : "unmapped";
  }

  async fillRegistration(session: BrowserSession, account: BoardAccount): Promise<void> {
    const mapped = this.registerMap;
    if (!mapped) throw new UnmappedFormError("register");
    await session.fill(mapped.username.selector, account.username);
    await session.fill(mapped.email.selector, account.email);
    await session.fill(mapped.password.selector, account.password, { secret: true });
    if (mapped.confirm)
      await session.fill(mapped.confirm.selector, account.password, { secret: true });
    if (mapped.consent && (await session.attribute(mapped.consent.selector, "checked")) === null) {
      await session.click(mapped.consent.selector);
    }
  }

  async detectCaptcha(session: BrowserSession): Promise<CaptchaChallenge> {
    return detectWidget(session);
  }

  async submitRegistration(session: BrowserSession): Promise<RegistrationResult> {
    if (!this.registerMap) throw new UnmappedFormError("register");
    await session.click(this.registerMap.submit.selector);
    return this.readRegistrationResult(session, { waitMs: 15_000 });
  }

  async readRegistrationResult(
    session: BrowserSession,
    options: { waitMs?: number } = {},
  ): Promise<RegistrationResult> {
    if (options.waitMs) await session.waitFor("#message, .error", { timeoutMs: options.waitMs });
    const messages = await this.pageMessages(session);
    return classifyRegistration(messages.join("\n"), await session.exists("form"));
  }

  async activationResult(session: BrowserSession): Promise<ActivationResult> {
    const result = classifyRegistration((await this.pageMessages(session)).join("\n"), false);
    if (result.kind === "pending_admin") return "pending_admin";
    if (result.kind === "active") return "active";
    return "unknown";
  }

  async isLoggedIn(session: BrowserSession): Promise<boolean> {
    return session.exists("a.logout");
  }

  async login(
    session: BrowserSession,
    homepageUrl: string,
    account: Pick<BoardAccount, "username" | "password">,
  ): Promise<boolean> {
    await session.goto(new URL("/login", homepageUrl).href);
    if (await this.isLoggedIn(session)) return true;
    const fields = await fieldsIn(session, "form");
    const mapped = fields ? mapLogin(fields) : null;
    if (!mapped) throw new UnmappedFormError("login");
    await session.fill(mapped.identity.selector, account.username);
    await session.fill(mapped.password.selector, account.password, { secret: true });
    await session.click(mapped.submit.selector);
    return session.waitFor("a.logout", { timeoutMs: 10_000 });
  }

  async listThreads(session: BrowserSession, homepageUrl: string): Promise<BoardThread[]> {
    await session.goto(homepageUrl);
    const threads: BoardThread[] = [];
    for (let index = 1; index <= 20; index += 1) {
      const selector = `#threads a:nth-of-type(${index})`;
      const href = await session.attribute(selector, "href");
      if (href === null) break;
      const title = ((await session.text(selector)) ?? "").trim();
      if (!title) continue;
      threads.push({
        url: new URL(href, await session.url()).href,
        title,
        openQuestion: /\?/.test(title),
      });
    }
    return threads;
  }

  async openReply(session: BrowserSession, thread: BoardThread): Promise<boolean> {
    await session.goto(thread.url);
    const fields = await fieldsIn(session, "form");
    this.replyMap = fields ? mapReply(fields) : null;
    if (!this.replyMap) throw new UnmappedFormError("reply");
    return true;
  }

  async fillReply(session: BrowserSession, body: string): Promise<void> {
    if (!this.replyMap) throw new UnmappedFormError("reply");
    await session.fill(this.replyMap.body.selector, body);
  }

  async submitReply(session: BrowserSession): Promise<ReplyResult> {
    if (!this.replyMap) throw new UnmappedFormError("reply");
    await session.click(this.replyMap.submit.selector);
    await session.waitFor("#message, .error", { timeoutMs: 15_000 });
    const messages = await this.pageMessages(session);
    const href = await session.attribute("#message a.permalink", "href");
    if (href && postedSuccessfully(messages.join("\n"))) {
      return { kind: "posted", permalink: new URL(href, await session.url()).href };
    }
    if (await session.exists("form")) return { kind: "rejected", messages };
    return { kind: "unknown", messages };
  }

  probeLinkRule(pageText: string): LinkRuleProbe {
    const flat = pageText.replace(/\s+/g, " ");
    const after =
      /links?[^.]{0,80}?(?:after|until|before)\s+(\d{1,4})\s+posts?/i.exec(flat) ??
      /(?:after|until|before)\s+(\d{1,4})\s+posts?[^.]{0,40}links?/i.exec(flat);
    if (after) {
      return {
        hrefForNewMembers: "after_n_posts",
        minPosts: Number(after[1]),
        relDefault: "unknown",
      };
    }
    return { hrefForNewMembers: "unknown", minPosts: null, relDefault: "unknown" };
  }

  async probePageLinkRule(session: BrowserSession): Promise<LinkRuleProbe> {
    const base = this.probeLinkRule(await session.pageText());
    const rel = relFromAttribute(await session.attribute("a.memberLink", "rel"));
    if (rel) return { ...base, relDefault: rel };
    return { ...base, relDefault: "nofollow" };
  }

  async setProfile(
    session: BrowserSession,
    homepageUrl: string,
    profile: ProfileInput,
  ): Promise<boolean> {
    await session.goto(new URL("/account", homepageUrl).href);
    const fields = await fieldsIn(session, "form");
    const bio = fields ? best(fields, scoreBio, 2) : null;
    if (!bio) return false;
    await session.fill(bio.selector, profile.bio);
    const signature = fields?.find(
      (field) => field.tag === "textarea" && /signature/.test(blob(field)),
    );
    if (signature) {
      await session.fill(
        signature.selector,
        profile.includeSignature ? (profile.signature ?? "") : "",
      );
    }
    const submit = fields ? pickSubmit(fields, "register") : null;
    if (submit) await session.click(submit.selector);
    return true;
  }

  async pageMessages(session: BrowserSession): Promise<string[]> {
    const error = await session.text(".error");
    const panel = await session.text("#message");
    return [error, panel].map((text) => text?.trim() ?? "").filter(Boolean);
  }
}
