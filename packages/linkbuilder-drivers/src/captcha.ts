import {
  type AdapterContext,
  type BrowserSession,
  type CaptchaSolver,
  CaptchaSolverError,
  MIN_CAPTCHA_IMAGE_BYTES,
} from "@rakazo/adapter-kit";
import type { LbHumanCheckboxState } from "@rakazo/contracts";
import {
  decideHelperAction,
  type HelperDecision,
  type HelperMemory,
} from "@rakazo/linkbuilder-core";

export interface ImageCaptchaSolution {
  answer: string;
  credits: number;
  balance: number;
  taskId: string;
}

/**
 * Crops the captcha element (never a full screenshot), asks the solver and types the answer.
 * Images under the solver's minimum are refused before any credit is spent.
 */
export async function solveImageCaptcha(
  session: BrowserSession,
  challenge: { imageSelector: string; answerSelector: string },
  solver: CaptchaSolver,
  context: AdapterContext,
): Promise<ImageCaptchaSolution> {
  const imagePng = await session.elementScreenshotPng(challenge.imageSelector);
  if (imagePng.byteLength < MIN_CAPTCHA_IMAGE_BYTES) {
    throw new CaptchaSolverError("invalid_request", "Captcha crop is below the minimum size");
  }
  const result = await solver.solve({ type: "ImageToText", imagePng }, context);
  await session.fill(challenge.answerSelector, result.answer);
  return result;
}

export interface PageHelperOptions {
  /** The helper's injected button; a helper-specific detail kept out of board drivers. */
  buttonSelector: string;
  submitSelector: string;
  humanCheckboxSelector?: string;
  imageGridSelector?: string;
  pageMessages(session: BrowserSession): Promise<string[]>;
  sleep?: (ms: number) => Promise<void>;
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
 * single returned action, repeat. Returns on submit or on any action the caller must handle.
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
