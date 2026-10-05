import {
  type AdapterContext,
  type BrowserSession,
  type CaptchaSolver,
  CaptchaSolverError,
  MIN_CAPTCHA_IMAGE_BYTES,
  type TokenCaptchaType,
} from "@rakazo/adapter-kit";
import type { LbHumanCheckboxState } from "@rakazo/contracts";
import {
  decideHelperAction,
  type HelperDecision,
  type HelperMemory,
  PAGE_HELPER_BUTTON_SELECTOR,
} from "@rakazo/linkbuilder-core";
import type { CaptchaChallenge } from "./driver.js";

export { PAGE_HELPER_BUTTON_SELECTOR };

/** Padding added on the one re-crop when a tight captcha image is unusable. */
export const CAPTCHA_CROP_PADDING_PX = 12;
const MIN_WIDTH = 40;
const MIN_HEIGHT = 16;
const MIN_ASPECT = 1.5;
const MAX_ASPECT = 12;

export interface ImageCaptchaSolution {
  answer: string;
  credits: number;
  balance: number;
  taskId: string;
}

export type ImageCaptchaResult =
  | ({ ok: true } & ImageCaptchaSolution)
  | { ok: false; reason: "not_read" | "crop_rejected" };

const SECURITY_LABEL = /security check|überprüfung|captcha prüfung/i;
const QUESTION_MARK = /\?/;
const ARITHMETIC = /\d+\s*[+\-x×*/]\s*\d+/i;
const QUESTION_WORDS = /hauptstadt|capital of|wie heißt|what is|wie viel|how many/i;

const QUESTION_FIELDS: ReadonlyArray<{ input: string; label: string }> = [
  { input: "#qa_answer", label: "label[for='qa_answer']" },
  { input: "input[name='qa_answer']", label: "label[for='qa_answer']" },
  { input: "#question_answer", label: "label[for='question_answer']" },
];

/** A field is a knowledge question when it asks something or poses arithmetic. */
export function looksLikeKnowledgeQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 400) return false;
  return QUESTION_MARK.test(trimmed) || ARITHMETIC.test(trimmed) || QUESTION_WORDS.test(trimmed);
}

export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.byteLength < 24) return null;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) return null;
  }
  if (String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!) !== "IHDR") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0 || width > 8_000 || height > 8_000) return null;
  return { width, height };
}

/** True when a crop is large enough and shaped like a letter captcha. */
export function captchaCropAcceptable(bytes: Uint8Array): boolean {
  if (bytes.byteLength < MIN_CAPTCHA_IMAGE_BYTES) return false;
  const size = pngDimensions(bytes);
  if (!size || size.width < MIN_WIDTH || size.height < MIN_HEIGHT) return false;
  const aspect = size.width / size.height;
  return aspect >= MIN_ASPECT && aspect <= MAX_ASPECT;
}

export function captchaResponseField(type: TokenCaptchaType): string {
  if (type === "turnstile") return "cf-turnstile-response";
  if (type === "hcaptcha") return "h-captcha-response";
  return "g-recaptcha-response";
}

/**
 * Question-style fields the phpBB Q&A plugin and similar boards use.
 * Returns null when the page has no such field.
 */
export async function detectKnowledgeQuestion(
  session: BrowserSession,
): Promise<Extract<CaptchaChallenge, { kind: "question" }> | null> {
  for (const field of QUESTION_FIELDS) {
    if (!(await session.exists(field.input))) continue;
    const label = (await session.text(field.label)) ?? "";
    const question = label.trim() || (await session.pageText());
    if (!looksLikeKnowledgeQuestion(question) && !label.trim()) continue;
    const text = looksLikeKnowledgeQuestion(label) ? label.trim() : question.trim().slice(0, 400);
    if (!text) continue;
    return { kind: "question", question: text, answerSelector: field.input };
  }
  return null;
}

/**
 * When the driver sees no captcha, a security-check label with the helper button is still
 * a captcha, and a knowledge field is answered through the solver.
 */
export async function enrichCaptchaChallenge(
  session: BrowserSession,
  challenge: CaptchaChallenge,
  buttonSelector: string,
): Promise<CaptchaChallenge> {
  if (challenge.kind !== "none") return challenge;
  const question = await detectKnowledgeQuestion(session);
  if (question) return question;
  const text = await session.pageText();
  if (SECURITY_LABEL.test(text) && (await session.exists(buttonSelector))) {
    return { kind: "widget", type: "recaptcha_v2", siteKey: null };
  }
  return challenge;
}

async function crop(
  session: BrowserSession,
  selector: string,
  paddingPx: number,
): Promise<Uint8Array> {
  return paddingPx > 0
    ? session.elementScreenshotPng(selector, { paddingPx })
    : session.elementScreenshotPng(selector);
}

/**
 * Crops the captcha image, re-crops once with padding when the crop is too small or the wrong
 * shape, and types the answer. "Not read" gets one padded re-crop and then a park reason.
 * The image is the only thing sent to the solver.
 */
export async function solveImageCaptcha(
  session: BrowserSession,
  challenge: { imageSelector: string; answerSelector: string },
  solver: CaptchaSolver,
  context: AdapterContext,
): Promise<ImageCaptchaResult> {
  let image = await crop(session, challenge.imageSelector, 0);
  let padded = captchaCropAcceptable(image);
  if (!padded) {
    image = await crop(session, challenge.imageSelector, CAPTCHA_CROP_PADDING_PX);
    padded = captchaCropAcceptable(image);
    if (!padded) return { ok: false, reason: "crop_rejected" };
  }
  try {
    const result = await solver.solve({ type: "ImageToText", imagePng: image }, context);
    await session.fill(challenge.answerSelector, result.answer);
    return { ok: true, ...result };
  } catch (error) {
    if (!(error instanceof CaptchaSolverError) || error.code !== "not_read") throw error;
    const again = await crop(session, challenge.imageSelector, CAPTCHA_CROP_PADDING_PX);
    if (!captchaCropAcceptable(again)) return { ok: false, reason: "not_read" };
    try {
      const result = await solver.solve({ type: "ImageToText", imagePng: again }, context);
      await session.fill(challenge.answerSelector, result.answer);
      return { ok: true, ...result };
    } catch (second) {
      if (second instanceof CaptchaSolverError && second.code === "not_read") {
        return { ok: false, reason: "not_read" };
      }
      throw second;
    }
  }
}

/** Places a solver token into the widget field. The token is not logged. */
export async function placeCaptchaToken(
  session: BrowserSession,
  type: TokenCaptchaType,
  token: string,
): Promise<void> {
  const field = captchaResponseField(type);
  if (session.injectToken) {
    await session.injectToken(field, token);
    return;
  }
  await session.fill(`[name='${field}']`, token, { secret: true });
}

export interface PageHelperOptions {
  /** The helper's injected button; a helper-specific detail kept out of board drivers. */
  buttonSelector: string;
  submitSelector: string;
  humanCheckboxSelector?: string;
  imageGridSelector?: string;
  pageMessages(session: BrowserSession): Promise<string[]>;
  sleep?: (ms: number) => Promise<void>;
  /** Injected clock. Production passes `Date.now`; tests pass a fake clock. */
  now?: () => number;
  pollMs?: number;
  /** Safety bound on observe-act cycles; the helper machine itself bounds tries and timeouts. */
  maxCycles?: number;
}

export interface PageHelperRun {
  decision: HelperDecision;
  buttonText: string | null;
  humanCheckbox: LbHumanCheckboxState;
  imageGridOpen: boolean;
  cycles: number;
}

async function humanCheckboxState(
  session: BrowserSession,
  selector: string | undefined,
): Promise<LbHumanCheckboxState> {
  if (!selector || !(await session.exists(selector))) return "none";
  return (await session.exists(`${selector}:checked`)) ? "checked" : "empty";
}

const FINAL_ACTIONS = new Set<HelperDecision["action"]>([
  "submit",
  "stop_host",
  "park_operator",
  "pause_project",
  "form_error",
  "retry_after_spam_message",
]);

/**
 * Drives the in-page helper button with the core state machine: observe the label, perform the
 * single returned action, repeat. Submits only when the machine says so, and only inside the
 * placed-token TTL. Returns on submit or on any action the caller must handle.
 */
export async function runPageHelper(
  session: BrowserSession,
  options: PageHelperOptions,
): Promise<PageHelperRun> {
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const maxCycles = options.maxCycles ?? 400;
  let memory: Partial<HelperMemory> | undefined;
  let tries = 0;
  for (let cycle = 1; ; cycle += 1) {
    const buttonText = await session.text(options.buttonSelector);
    const humanCheckbox = await humanCheckboxState(session, options.humanCheckboxSelector);
    const imageGridOpen = options.imageGridSelector
      ? await session.exists(options.imageGridSelector)
      : false;
    const decision = decideHelperAction({
      buttonText,
      humanCheckbox,
      imageGridOpen,
      pageMessages: await options.pageMessages(session),
      nowMs: now(),
      tries,
      memory,
    });
    memory = decision.memory;
    tries = decision.tries;
    const run = { decision, buttonText, humanCheckbox, imageGridOpen, cycles: cycle };
    if (decision.action === "submit") {
      await session.click(options.submitSelector);
      return run;
    }
    if (FINAL_ACTIONS.has(decision.action)) return run;
    if (cycle >= maxCycles) {
      return {
        ...run,
        decision: {
          ...decision,
          action: "park_operator",
          reason: "unchanged_click_limit",
          outcome: "operator_parked",
          hostEvent: "parked",
        },
      };
    }
    if (decision.action === "click_place") await session.click(options.buttonSelector);
    else if (decision.action === "reload_once") await session.goto(await session.url());
    else await sleep(options.pollMs ?? 250);
  }
}
