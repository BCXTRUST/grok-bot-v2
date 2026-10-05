import {
  LB_DEFAULT_SPAM_SENTENCES,
  type LbCaptchaOutcome,
  type LbHumanCheckboxState,
} from "@rakazo/contracts";
import type { HostEvent } from "./host-state.js";

/*
 * Pure reducer for the in-page captcha helper button. The button label is the state; the
 * worker observes the page, calls `decideHelperAction`, performs exactly the returned action and
 * feeds the returned `memory` into the next call. Labels and limits follow the helper's
 * documented behaviour (plan section 7.3).
 */

export const HELPER_LABELS = {
  place: "Place the check",
  placing: "Placing…",
  placed: "Placed. Submit the form.",
  noToken: "No token",
  missingSiteKey: "Missing site key",
  unsupportedType: "Unsupported type",
} as const;

/** Counted solve attempts per captcha; failed attempts are not charged by the solver. */
export const HELPER_MAX_TRIES = 4;
/** A placed token is only valid for about two minutes. */
export const HELPER_PLACED_TTL_MS = 120_000;
/** The helper resets `Placing…` after three minutes. */
export const HELPER_PLACING_TIMEOUT_MS = 180_000;
/** How long an open image grid may settle before the check is placed again. */
export const HELPER_GRID_SETTLE_MS = 10_000;
/** Clicks that leave the label unchanged are free but bounded so a dead button parks the host. */
export const HELPER_MAX_UNCHANGED_CLICKS = 3;

export const SECURITY_CHECK_FAILED_MESSAGES = [
  "You did not pass the security check.",
  "Captcha Prüfung fehlgeschlagen!",
] as const;

export type FormErrorKind = "username_taken" | "email_banned" | "password_required";

export const FORM_ERROR_PATTERNS: ReadonlyArray<{ kind: FormErrorKind; pattern: RegExp }> = [
  { kind: "username_taken", pattern: /username (is )?(already )?(taken|in use)/i },
  { kind: "username_taken", pattern: /benutzername (ist )?(bereits|schon) (vergeben|belegt)/i },
  { kind: "email_banned", pattern: /e-?mail(-adresse| address)? (is |ist )?(banned|gesperrt)/i },
  { kind: "email_banned", pattern: /(banned|gesperrte) e-?mail/i },
  { kind: "password_required", pattern: /entering a password is required/i },
  { kind: "password_required", pattern: /die eingabe eines passworts ist erforderlich/i },
];

const CREDITS_PATTERN = /not enough credits|insufficient credits|nicht genügend credits/i;

export type HelperAction =
  | "click_place"
  | "wait"
  | "submit"
  | "stop_host"
  | "park_operator"
  | "reload_once"
  | "retry_after_spam_message"
  | "form_error"
  | "pause_project";

export type HelperReason =
  | "place"
  | "placing"
  | "placing_timeout"
  | "placed_ready"
  | "placed_stale"
  | "placed_waiting_checkbox"
  | "awaiting_submit_result"
  | "image_grid_wait"
  | "image_grid_retry"
  | "unchanged_after_click"
  | "unchanged_click_limit"
  | "solver_error_retry"
  | "max_tries"
  | "missing_site_key"
  | "unsupported_type"
  | "button_missing"
  | "security_check_failed"
  | "spam_retry"
  | "spam_blocked"
  | "form_error"
  | "form_error_repeated"
  | "credits";

export interface HelperMemory {
  tries: number;
  placedAtMs?: number;
  placingSinceMs?: number;
  /** Label observed when the last click was issued; cleared once the label changes. */
  clickedLabel?: string;
  unchangedClicks: number;
  gridSinceMs?: number;
  submittedAtMs?: number;
  spamRetries: number;
  spamSeenAtMs?: number;
  formErrors: number;
  formErrorSeenAtMs?: number;
  reloaded: boolean;
}

export interface HelperInput {
  /** Trimmed button label, or null when the helper button is not on the page. */
  buttonText: string | null;
  humanCheckbox: LbHumanCheckboxState;
  imageGridOpen: boolean;
  pageMessages: readonly string[];
  /** When `Placed. Submit the form.` was first observed, if the caller tracks it. */
  placedAtMs?: number;
  nowMs: number;
  tries: number;
  memory?: Partial<Omit<HelperMemory, "tries">>;
  /** Spam-filter sentences; defaults to the shared list. */
  spamSentences?: readonly string[];
}

export interface HelperDecision {
  action: HelperAction;
  reason: HelperReason;
  tries: number;
  memory: HelperMemory;
  outcome?: LbCaptchaOutcome;
  hostEvent?: Extract<HostEvent, "parked" | "spam_blocked" | "unsupported_captcha" | "failed">;
  formError?: FormErrorKind;
}

function normalize(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

function containsAny(messages: readonly string[], needles: readonly string[]): boolean {
  const haystack = messages.map((message) => normalize(message).toLowerCase());
  return needles.some((needle) => {
    const target = normalize(needle).toLowerCase();
    return target.length > 0 && haystack.some((message) => message.includes(target));
  });
}

function findFormError(messages: readonly string[]): FormErrorKind | undefined {
  for (const message of messages) {
    const text = normalize(message);
    const match = FORM_ERROR_PATTERNS.find(({ pattern }) => pattern.test(text));
    if (match) return match.kind;
  }
  return undefined;
}

/** A page message is new if no earlier one was handled, or a submit happened since. */
function isNewPostSubmitMessage(seenAtMs: number | undefined, memory: HelperMemory): boolean {
  if (seenAtMs === undefined) return true;
  return memory.submittedAtMs !== undefined && memory.submittedAtMs > seenAtMs;
}

function clearPlacement(memory: HelperMemory): HelperMemory {
  return {
    ...memory,
    placedAtMs: undefined,
    placingSinceMs: undefined,
    clickedLabel: undefined,
    unchangedClicks: 0,
    gridSinceMs: undefined,
  };
}

export function decideHelperAction(input: HelperInput): HelperDecision {
  let memory: HelperMemory = {
    unchangedClicks: 0,
    spamRetries: 0,
    formErrors: 0,
    reloaded: false,
    ...input.memory,
    tries: input.tries,
  };
  if (input.placedAtMs !== undefined) memory.placedAtMs = input.placedAtMs;
  const now = input.nowMs;
  const label = input.buttonText === null ? null : normalize(input.buttonText) || null;
  const messages = input.pageMessages;

  const decide = (
    action: HelperAction,
    reason: HelperReason,
    extra: Partial<Omit<HelperDecision, "action" | "reason" | "tries" | "memory">> = {},
  ): HelperDecision => ({ action, reason, tries: memory.tries, memory, ...extra });

  const park = (reason: HelperReason, outcome: LbCaptchaOutcome = "operator_parked") =>
    decide("park_operator", reason, { outcome, hostEvent: "parked" });

  const placeCounted = (reason: HelperReason, parkOutcome: LbCaptchaOutcome) => {
    if (memory.tries >= HELPER_MAX_TRIES) return park("max_tries", parkOutcome);
    memory = {
      ...clearPlacement(memory),
      tries: memory.tries + 1,
      clickedLabel: label ?? undefined,
    };
    return decide("click_place", reason);
  };

  const spamSentences = input.spamSentences ?? LB_DEFAULT_SPAM_SENTENCES;
  if (containsAny(messages, spamSentences) && isNewPostSubmitMessage(memory.spamSeenAtMs, memory)) {
    if (memory.spamRetries >= 1) {
      return decide("stop_host", "spam_blocked", { hostEvent: "spam_blocked" });
    }
    memory = { ...clearPlacement(memory), spamRetries: memory.spamRetries + 1, spamSeenAtMs: now };
    return decide("retry_after_spam_message", "spam_retry");
  }

  const formError = findFormError(messages);
  if (formError && isNewPostSubmitMessage(memory.formErrorSeenAtMs, memory)) {
    if (memory.formErrors >= 1) {
      return decide("stop_host", "form_error_repeated", { hostEvent: "failed", formError });
    }
    memory = {
      ...clearPlacement(memory),
      formErrors: memory.formErrors + 1,
      formErrorSeenAtMs: now,
      submittedAtMs: undefined,
    };
    return decide("form_error", "form_error", { formError });
  }

  if ((label && CREDITS_PATTERN.test(label)) || messages.some((m) => CREDITS_PATTERN.test(m))) {
    return decide("pause_project", "credits", { outcome: "credits" });
  }

  if (label === HELPER_LABELS.missingSiteKey) {
    return decide("stop_host", "missing_site_key", {
      outcome: "missing_site_key",
      hostEvent: "unsupported_captcha",
    });
  }
  if (label === HELPER_LABELS.unsupportedType) {
    return decide("stop_host", "unsupported_type", {
      outcome: "unsupported",
      hostEvent: "unsupported_captcha",
    });
  }

  const securityFailed = containsAny(messages, SECURITY_CHECK_FAILED_MESSAGES);

  if (label === null) {
    if (memory.reloaded) return park(securityFailed ? "security_check_failed" : "button_missing");
    memory = { ...clearPlacement(memory), reloaded: true };
    return decide("reload_once", securityFailed ? "security_check_failed" : "button_missing");
  }

  if (memory.clickedLabel !== undefined && label !== memory.clickedLabel) {
    memory = { ...memory, clickedLabel: undefined, unchangedClicks: 0 };
  }
  if (!input.imageGridOpen) memory = { ...memory, gridSinceMs: undefined };

  if (label === HELPER_LABELS.placing) {
    memory = { ...memory, placedAtMs: undefined, placingSinceMs: memory.placingSinceMs ?? now };
    if (now - memory.placingSinceMs! >= HELPER_PLACING_TIMEOUT_MS) {
      return placeCounted("placing_timeout", "expired");
    }
    return decide("wait", input.imageGridOpen ? "image_grid_wait" : "placing");
  }
  memory = { ...memory, placingSinceMs: undefined };

  if (label === HELPER_LABELS.placed) {
    const placedAt = memory.placedAtMs ?? now;
    memory = { ...memory, placedAtMs: placedAt, clickedLabel: undefined, unchangedClicks: 0 };
    const alreadySubmitted = memory.submittedAtMs !== undefined && placedAt <= memory.submittedAtMs;
    if (securityFailed && (memory.submittedAtMs === undefined || alreadySubmitted)) {
      return placeCounted("security_check_failed", "no_token");
    }
    if (alreadySubmitted) return decide("wait", "awaiting_submit_result");
    if (now - placedAt > HELPER_PLACED_TTL_MS) return placeCounted("placed_stale", "expired");
    const checked = input.humanCheckbox === "checked";
    const clear = input.humanCheckbox === "none" && !input.imageGridOpen;
    if (checked || clear) {
      memory = { ...memory, submittedAtMs: now };
      return decide("submit", "placed_ready", { outcome: "placed_submitted" });
    }
    if (!input.imageGridOpen) return decide("wait", "placed_waiting_checkbox");
  }

  if (input.imageGridOpen) {
    const since = memory.gridSinceMs ?? now;
    memory = { ...memory, gridSinceMs: since };
    if (now - since < HELPER_GRID_SETTLE_MS) return decide("wait", "image_grid_wait");
    return placeCounted("image_grid_retry", "operator_parked");
  }

  if (memory.clickedLabel !== undefined && label === memory.clickedLabel) {
    if (memory.unchangedClicks >= HELPER_MAX_UNCHANGED_CLICKS) return park("unchanged_click_limit");
    memory = { ...memory, unchangedClicks: memory.unchangedClicks + 1 };
    return decide("click_place", "unchanged_after_click");
  }

  if (label === HELPER_LABELS.place) {
    return placeCounted(securityFailed ? "security_check_failed" : "place", "no_token");
  }

  return placeCounted("solver_error_retry", "no_token");
}
