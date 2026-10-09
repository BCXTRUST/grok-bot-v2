import type {
  AdapterContext,
  BrowserSession,
  CaptchaSolver,
  InboundMail,
} from "@rakazo/adapter-kit";
import { isSecretRegistrationPrompt } from "@rakazo/adapter-kit";
import { extractVerificationLink } from "@rakazo/linkbuilder-core";
import { captchaResponseField, solveImageCaptcha } from "./captcha.js";
import type { BoardAccount, CaptchaChallenge, RegistrationResult } from "./driver.js";
import type { RegistrationProfile } from "./generic.js";
import { GenericFormDriver } from "./generic.js";
import { formErrorFixable } from "./messages.js";

const SUBMIT_BUDGET = 3;

export interface GenericJourneyMailbox {
  listMessages(
    inboxId: string,
    options: { since?: Date },
    context: AdapterContext,
  ): Promise<InboundMail[]>;
}

export interface GenericJourneyResult {
  outcome: "posted" | "pending_admin" | "parked";
  fromForm: boolean;
  parkReason: string | null;
  parkLabel: string | null;
  registration: RegistrationResult["kind"][];
  /** Captcha read from the form. An admin-activation form is read and not sent. */
  detected: CaptchaChallenge | null;
  solved: number;
  activation: "logged_in" | "login_form" | null;
  permalink: string | null;
}

/**
 * Register, confirm, and post with the generic driver (`platform = unknown`).
 * Stock selector tables are not used. An admin-activation notice stops before any solve.
 */
export async function runGenericRegistrationJourney(
  session: BrowserSession,
  origin: string,
  profile: BoardAccount & Partial<Omit<RegistrationProfile, keyof BoardAccount>>,
  solver: CaptchaSolver,
  context: AdapterContext,
  mailbox: GenericJourneyMailbox,
  inboxId: string,
  reply: string,
): Promise<GenericJourneyResult> {
  const driver = new GenericFormDriver();
  if (driver.platform !== "unknown") return parked("unmapped", null, [], null, 0);
  const page = await driver.openRegistration(session, origin);
  if (page !== "form") {
    return parked(driver.lastPark?.reason ?? page, driver.lastPark?.label ?? null, [], null, 0);
  }
  const detected = await driver.detectCaptcha(session);
  if (await driver.formRequiresAdmin(session)) {
    return {
      outcome: "pending_admin",
      fromForm: true,
      parkReason: null,
      parkLabel: null,
      registration: [],
      detected,
      solved: 0,
      activation: null,
      permalink: null,
    };
  }

  const registration: RegistrationResult["kind"][] = [];
  let solved = 0;
  let latest: RegistrationResult = { kind: "unknown", messages: [] };
  for (let attempt = 0; attempt < SUBMIT_BUDGET; attempt += 1) {
    if ((await driver.mapOpenRegistration(session)) !== "form") {
      return parked(
        driver.lastPark?.reason ?? "unmapped",
        driver.lastPark?.label ?? null,
        registration,
        detected,
        solved,
      );
    }
    await driver.fillRegistration(session, profile);
    const challenge = await driver.detectCaptcha(session);
    const placed = await placeChallenge(session, challenge, solver, context);
    if (!placed.ok) {
      return parked(placed.reason, null, registration, challenge, solved);
    }
    solved += placed.solved;
    latest = await driver.submitRegistration(session);
    registration.push(latest.kind);
    if (latest.kind === "captcha_rejected") continue;
    if (latest.kind === "form_error" && formErrorFixable(latest.messages)) continue;
    break;
  }

  if (latest.kind !== "pending_email" && latest.kind !== "active") {
    return parked(latest.kind, null, registration, detected, solved);
  }

  let activation: GenericJourneyResult["activation"] = null;
  if (latest.kind === "pending_email") {
    const mail = (await mailbox.listMessages(inboxId, {}, context)).at(-1);
    const link = mail ? extractVerificationLink(mail, origin) : null;
    if (!link) return parked("verification_mail_missing", null, registration, detected, solved);
    await session.goto(link);
    if ((await driver.activationResult(session)) !== "active") {
      return parked("activation_unknown", null, registration, detected, solved);
    }
    activation = (await driver.isLoggedIn(session)) ? "logged_in" : "login_form";
  }

  if (!(await driver.isLoggedIn(session))) {
    const loggedIn = await driver.login(session, origin, profile);
    if (!loggedIn) return parked("login_failed", null, registration, detected, solved);
  }
  const threads = await driver.listThreads(session, origin);
  const thread = threads[0];
  if (!thread) return parked("no_thread", null, registration, detected, solved);
  if (!(await driver.openReply(session, thread))) {
    return parked("reply_unmapped", null, registration, detected, solved);
  }
  await driver.fillReply(session, reply);
  const posted = await driver.submitReply(session);
  if (posted.kind !== "posted") return parked(posted.kind, null, registration, detected, solved);
  return {
    outcome: "posted",
    fromForm: false,
    parkReason: null,
    parkLabel: null,
    registration,
    detected,
    solved,
    activation,
    permalink: posted.permalink,
  };
}

function parked(
  reason: string,
  label: string | null,
  registration: RegistrationResult["kind"][],
  detected: CaptchaChallenge | null,
  solved: number,
): GenericJourneyResult {
  return {
    outcome: "parked",
    fromForm: false,
    parkReason: reason,
    parkLabel: label,
    registration,
    detected,
    solved,
    activation: null,
    permalink: null,
  };
}

async function placeChallenge(
  session: BrowserSession,
  challenge: CaptchaChallenge,
  solver: CaptchaSolver,
  context: AdapterContext,
): Promise<{ ok: true; solved: number } | { ok: false; reason: string }> {
  if (challenge.kind === "none") return { ok: true, solved: 0 };
  if (challenge.kind === "image") {
    const solved = await solveImageCaptcha(session, challenge, solver, context);
    if (!solved.ok) return { ok: false, reason: solved.reason };
    return { ok: true, solved: 1 };
  }
  if (challenge.kind === "question") {
    if (isSecretRegistrationPrompt(challenge.question))
      return { ok: false, reason: "secret_prompt" };
    const answer = await solver.answerQuestion({ question: challenge.question }, context);
    if (!("answer" in answer)) return { ok: false, reason: "question_unanswered" };
    await session.fill(challenge.answerSelector, answer.answer);
    return { ok: true, solved: 1 };
  }
  if (!challenge.siteKey) return { ok: false, reason: "missing_site_key" };
  const result = await solver.solve(
    {
      type: challenge.type,
      websiteURL: await session.url(),
      websiteKey: challenge.siteKey,
    },
    context,
  );
  await session.fill(`[name='${captchaResponseField(challenge.type)}']`, result.answer);
  return { ok: true, solved: 1 };
}
