import { describe, expect, it } from "vitest";
import {
  decideHelperAction,
  FORM_ERROR_PATTERNS,
  HELPER_GRID_SETTLE_MS,
  HELPER_LABELS,
  HELPER_MAX_TRIES,
  HELPER_MAX_UNCHANGED_CLICKS,
  HELPER_PLACED_TTL_MS,
  HELPER_PLACING_TIMEOUT_MS,
  type HelperDecision,
  type HelperInput,
  SECURITY_CHECK_FAILED_MESSAGES,
} from "./captcha-helper-machine.js";

const T0 = 1_000_000;

function observe(overrides: Partial<HelperInput> = {}): HelperInput {
  return {
    buttonText: HELPER_LABELS.place,
    humanCheckbox: "none",
    imageGridOpen: false,
    pageMessages: [],
    nowMs: T0,
    tries: 0,
    ...overrides,
  };
}

/** Feeds the previous decision's memory and tries into the next observation. */
function next(previous: HelperDecision, overrides: Partial<HelperInput>): HelperDecision {
  return decideHelperAction(
    observe({ tries: previous.tries, memory: previous.memory, ...overrides }),
  );
}

describe("captcha helper machine: labels", () => {
  it("uses the exact helper labels", () => {
    expect(HELPER_LABELS).toEqual({
      place: "Place the check",
      placing: "Placing…",
      placed: "Placed. Submit the form.",
      noToken: "No token",
      missingSiteKey: "Missing site key",
      unsupportedType: "Unsupported type",
    });
  });

  it("clicks Place the check and counts the try", () => {
    const decision = decideHelperAction(observe());
    expect(decision).toMatchObject({ action: "click_place", reason: "place", tries: 1 });
    expect(decision.memory.clickedLabel).toBe(HELPER_LABELS.place);
  });

  it("normalises whitespace in the observed label", () => {
    const decision = decideHelperAction(observe({ buttonText: "  Placed.\n Submit   the form. " }));
    expect(decision.action).toBe("submit");
  });

  it("waits while Placing… and re-places after the three-minute reset", () => {
    const placing = decideHelperAction(observe({ buttonText: HELPER_LABELS.placing, tries: 1 }));
    expect(placing).toMatchObject({ action: "wait", reason: "placing", tries: 1 });
    expect(placing.memory.placingSinceMs).toBe(T0);
    const still = next(placing, {
      buttonText: HELPER_LABELS.placing,
      nowMs: T0 + HELPER_PLACING_TIMEOUT_MS - 1,
    });
    expect(still).toMatchObject({ action: "wait", reason: "placing" });
    const reset = next(still, {
      buttonText: HELPER_LABELS.placing,
      nowMs: T0 + HELPER_PLACING_TIMEOUT_MS,
    });
    expect(reset).toMatchObject({ action: "click_place", reason: "placing_timeout", tries: 2 });
    expect(reset.memory.placingSinceMs).toBeUndefined();
  });

  it("reports an open grid while Placing… as a grid wait without clicking tiles", () => {
    const decision = decideHelperAction(
      observe({ buttonText: HELPER_LABELS.placing, imageGridOpen: true, tries: 1 }),
    );
    expect(decision).toMatchObject({ action: "wait", reason: "image_grid_wait", tries: 1 });
  });
});

describe("captcha helper machine: Placed. Submit the form.", () => {
  const placed = (overrides: Partial<HelperInput> = {}) =>
    decideHelperAction(observe({ buttonText: HELPER_LABELS.placed, tries: 1, ...overrides }));

  it.each([
    ["checked", false, "submit"],
    ["checked", true, "submit"],
    ["none", false, "submit"],
    ["empty", false, "wait"],
    ["none", true, "wait"],
    ["empty", true, "wait"],
  ] as const)("checkbox %s, grid open %s → %s", (humanCheckbox, imageGridOpen, action) => {
    const decision = placed({ humanCheckbox, imageGridOpen });
    expect(decision.action).toBe(action);
    expect(decision.tries).toBe(1);
    if (action === "submit") {
      expect(decision).toMatchObject({ reason: "placed_ready", outcome: "placed_submitted" });
      expect(decision.memory.submittedAtMs).toBe(T0);
    } else {
      expect(decision.reason).toBe(imageGridOpen ? "image_grid_wait" : "placed_waiting_checkbox");
    }
  });

  it("submits up to the token TTL and re-places an old token instead", () => {
    const first = placed({ humanCheckbox: "empty" });
    expect(first.memory.placedAtMs).toBe(T0);
    const atTtl = next(first, {
      buttonText: HELPER_LABELS.placed,
      humanCheckbox: "checked",
      nowMs: T0 + HELPER_PLACED_TTL_MS,
    });
    expect(atTtl.action).toBe("submit");
    const stale = next(first, {
      buttonText: HELPER_LABELS.placed,
      humanCheckbox: "checked",
      nowMs: T0 + HELPER_PLACED_TTL_MS + 1,
    });
    expect(stale).toMatchObject({ action: "click_place", reason: "placed_stale", tries: 2 });
    expect(stale.memory.placedAtMs).toBeUndefined();
  });

  it("honours a caller-tracked placedAtMs", () => {
    const decision = placed({ placedAtMs: T0 - HELPER_PLACED_TTL_MS - 1 });
    expect(decision.reason).toBe("placed_stale");
  });

  it("never submits the same token twice", () => {
    const submitted = placed();
    expect(submitted.action).toBe("submit");
    const again = next(submitted, { buttonText: HELPER_LABELS.placed, nowMs: T0 + 1_000 });
    expect(again).toMatchObject({ action: "wait", reason: "awaiting_submit_result", tries: 1 });
  });

  it("parks a stale token at the try limit with outcome expired", () => {
    const decision = placed({ tries: HELPER_MAX_TRIES, placedAtMs: T0 - HELPER_PLACED_TTL_MS - 1 });
    expect(decision).toMatchObject({
      action: "park_operator",
      reason: "max_tries",
      outcome: "expired",
      hostEvent: "parked",
    });
  });
});

describe("captcha helper machine: retries and limits", () => {
  it("clicks again on No token up to four counted tries, then parks", () => {
    let decision = decideHelperAction(observe({ buttonText: HELPER_LABELS.noToken }));
    const tries = [decision.tries];
    while (decision.action === "click_place") {
      decision = next(decision, { buttonText: HELPER_LABELS.placing, nowMs: T0 + 1 });
      expect(decision.action).toBe("wait");
      decision = next(decision, { buttonText: HELPER_LABELS.noToken, nowMs: T0 + 2 });
      tries.push(decision.tries);
    }
    expect(tries).toEqual([1, 2, 3, 4, 4]);
    expect(decision).toMatchObject({
      action: "park_operator",
      reason: "max_tries",
      outcome: "no_token",
      hostEvent: "parked",
    });
  });

  it("treats any unknown label as a solver error and retries as a counted try", () => {
    const decision = decideHelperAction(observe({ buttonText: "Solver timeout (502)", tries: 2 }));
    expect(decision).toMatchObject({
      action: "click_place",
      reason: "solver_error_retry",
      tries: 3,
    });
  });

  it("does not count clicks that leave the label unchanged, but caps them", () => {
    let decision = decideHelperAction(observe());
    expect(decision.tries).toBe(1);
    for (let click = 1; click <= HELPER_MAX_UNCHANGED_CLICKS; click += 1) {
      decision = next(decision, {});
      expect(decision).toMatchObject({
        action: "click_place",
        reason: "unchanged_after_click",
        tries: 1,
      });
      expect(decision.memory.unchangedClicks).toBe(click);
    }
    decision = next(decision, {});
    expect(decision).toMatchObject({
      action: "park_operator",
      reason: "unchanged_click_limit",
      outcome: "operator_parked",
      hostEvent: "parked",
      tries: 1,
    });
  });

  it("resets the unchanged-click counter once the label moves", () => {
    const clicked = decideHelperAction(observe());
    const unchanged = next(clicked, {});
    expect(unchanged.memory.unchangedClicks).toBe(1);
    const moved = next(unchanged, { buttonText: HELPER_LABELS.placing });
    expect(moved.memory).toMatchObject({ clickedLabel: undefined, unchangedClicks: 0 });
  });

  it("waits for an open image grid to settle, then re-places as a counted try", () => {
    const opened = decideHelperAction(
      observe({ buttonText: HELPER_LABELS.noToken, imageGridOpen: true, tries: 1 }),
    );
    expect(opened).toMatchObject({ action: "wait", reason: "image_grid_wait", tries: 1 });
    const settling = next(opened, {
      buttonText: HELPER_LABELS.noToken,
      imageGridOpen: true,
      nowMs: T0 + HELPER_GRID_SETTLE_MS - 1,
    });
    expect(settling.reason).toBe("image_grid_wait");
    const retry = next(settling, {
      buttonText: HELPER_LABELS.noToken,
      imageGridOpen: true,
      nowMs: T0 + HELPER_GRID_SETTLE_MS,
    });
    expect(retry).toMatchObject({ action: "click_place", reason: "image_grid_retry", tries: 2 });
    expect(retry.memory.gridSinceMs).toBeUndefined();
  });

  it("forgets the grid timer when the grid closes", () => {
    const opened = decideHelperAction(
      observe({ buttonText: HELPER_LABELS.noToken, imageGridOpen: true }),
    );
    const closed = next(opened, { buttonText: HELPER_LABELS.placing, nowMs: T0 + 5 });
    expect(closed.memory.gridSinceMs).toBeUndefined();
  });

  it("parks when the grid persists after four tries", () => {
    const decision = decideHelperAction(
      observe({
        buttonText: HELPER_LABELS.place,
        imageGridOpen: true,
        tries: HELPER_MAX_TRIES,
        memory: { gridSinceMs: T0 - HELPER_GRID_SETTLE_MS },
      }),
    );
    expect(decision).toMatchObject({
      action: "park_operator",
      reason: "max_tries",
      outcome: "operator_parked",
    });
  });
});

describe("captcha helper machine: terminal labels", () => {
  it.each([
    [HELPER_LABELS.missingSiteKey, "missing_site_key", "missing_site_key"],
    [HELPER_LABELS.unsupportedType, "unsupported_type", "unsupported"],
  ] as const)("%s stops the host without retry or reload", (buttonText, reason, outcome) => {
    const decision = decideHelperAction(
      observe({ buttonText, pageMessages: [SECURITY_CHECK_FAILED_MESSAGES[0]], tries: 2 }),
    );
    expect(decision).toMatchObject({
      action: "stop_host",
      reason,
      outcome,
      hostEvent: "unsupported_captcha",
      tries: 2,
    });
    expect(decision.memory.reloaded).toBe(false);
  });

  it.each([
    ["label", "Not enough credits", []],
    ["message", HELPER_LABELS.place, ["Insufficient credits on this key"]],
    ["German message", HELPER_LABELS.placing, ["Nicht genügend Credits"]],
  ] as const)("pauses the project when credits run out (%s)", (_where, buttonText, messages) => {
    const decision = decideHelperAction(observe({ buttonText, pageMessages: [...messages] }));
    expect(decision).toMatchObject({
      action: "pause_project",
      reason: "credits",
      outcome: "credits",
    });
    expect(decision.tries).toBe(0);
  });
});

describe("captcha helper machine: page messages", () => {
  it.each(SECURITY_CHECK_FAILED_MESSAGES)("re-places after %s", (message) => {
    const decision = decideHelperAction(
      observe({ buttonText: HELPER_LABELS.place, pageMessages: [message], tries: 1 }),
    );
    expect(decision).toMatchObject({
      action: "click_place",
      reason: "security_check_failed",
      tries: 2,
    });
  });

  it("re-places a submitted token the board rejected", () => {
    const submitted = decideHelperAction(observe({ buttonText: HELPER_LABELS.placed, tries: 1 }));
    const rejected = next(submitted, {
      buttonText: HELPER_LABELS.placed,
      pageMessages: ["Captcha Prüfung fehlgeschlagen!"],
      nowMs: T0 + 2_000,
    });
    expect(rejected).toMatchObject({
      action: "click_place",
      reason: "security_check_failed",
      tries: 2,
    });
  });

  it("submits a fresh placement even while the old rejection is still on the page", () => {
    const submitted = decideHelperAction(observe({ buttonText: HELPER_LABELS.placed, tries: 1 }));
    const replaced = next(submitted, {
      buttonText: HELPER_LABELS.placed,
      placedAtMs: T0 + 5_000,
      pageMessages: ["You did not pass the security check."],
      nowMs: T0 + 6_000,
    });
    expect(replaced).toMatchObject({ action: "submit", reason: "placed_ready" });
  });

  it("reloads once when the helper button is missing, then parks", () => {
    const reload = decideHelperAction(observe({ buttonText: null }));
    expect(reload).toMatchObject({ action: "reload_once", reason: "button_missing", tries: 0 });
    expect(reload.memory.reloaded).toBe(true);
    const parked = next(reload, { buttonText: null });
    expect(parked).toMatchObject({
      action: "park_operator",
      reason: "button_missing",
      hostEvent: "parked",
    });
    const blank = decideHelperAction(observe({ buttonText: "   " }));
    expect(blank.action).toBe("reload_once");
  });

  it("reloads once after a failed security check with no button", () => {
    const reload = decideHelperAction(
      observe({ buttonText: null, pageMessages: ["You did not pass the security check."] }),
    );
    expect(reload).toMatchObject({ action: "reload_once", reason: "security_check_failed" });
    const parked = next(reload, {
      buttonText: null,
      pageMessages: ["You did not pass the security check."],
    });
    expect(parked).toMatchObject({ action: "park_operator", reason: "security_check_failed" });
  });

  it("retries exactly once after a spam-filter sentence, then marks the host spam blocked", () => {
    const sentence = "Die Registrierung ist wegen Spamschutzmaßnahmen fehlgeschlagen.";
    const first = decideHelperAction(
      observe({ buttonText: HELPER_LABELS.placed, pageMessages: [sentence], tries: 1 }),
    );
    expect(first).toMatchObject({ action: "retry_after_spam_message", reason: "spam_retry" });
    expect(first.memory).toMatchObject({ spamRetries: 1, spamSeenAtMs: T0, placedAtMs: undefined });

    const sameMessage = next(first, {
      buttonText: HELPER_LABELS.place,
      pageMessages: [sentence],
      nowMs: T0 + 1,
    });
    expect(sameMessage.action).toBe("click_place");

    const resubmitted = next(sameMessage, { buttonText: HELPER_LABELS.placed, nowMs: T0 + 2 });
    expect(resubmitted.action).toBe("submit");
    const blocked = next(resubmitted, {
      buttonText: HELPER_LABELS.placed,
      pageMessages: ["No soup for you!"],
      nowMs: T0 + 3,
    });
    expect(blocked).toMatchObject({
      action: "stop_host",
      reason: "spam_blocked",
      hostEvent: "spam_blocked",
    });
  });

  it("matches project-specific spam sentences instead of the defaults", () => {
    const custom = decideHelperAction(
      observe({
        pageMessages: ["Account rejected by filter"],
        spamSentences: ["rejected by filter"],
      }),
    );
    expect(custom.action).toBe("retry_after_spam_message");
    const ignored = decideHelperAction(
      observe({ pageMessages: ["No soup for you!"], spamSentences: ["rejected by filter"] }),
    );
    expect(ignored.action).toBe("click_place");
    const empty = decideHelperAction(observe({ pageMessages: ["anything"], spamSentences: [""] }));
    expect(empty.action).toBe("click_place");
  });

  it.each([
    ["The username is already taken.", "username_taken"],
    ["Der Benutzername ist bereits vergeben.", "username_taken"],
    ["This email address is banned.", "email_banned"],
    ["Diese E-Mail-Adresse ist gesperrt.", "email_banned"],
    ["Entering a password is required.", "password_required"],
    ["Die Eingabe eines Passworts ist erforderlich.", "password_required"],
  ] as const)("reports the form error %s once, then fails the host", (message, kind) => {
    const first = decideHelperAction(
      observe({ buttonText: HELPER_LABELS.placed, pageMessages: [message], tries: 1 }),
    );
    expect(first).toMatchObject({ action: "form_error", reason: "form_error", formError: kind });
    expect(first.memory).toMatchObject({ formErrors: 1, submittedAtMs: undefined });

    const sameMessage = next(first, {
      buttonText: HELPER_LABELS.placed,
      pageMessages: [message],
      nowMs: T0 + 1,
    });
    expect(sameMessage.action).toBe("submit");

    const repeated = next(sameMessage, {
      buttonText: HELPER_LABELS.placed,
      pageMessages: [message],
      nowMs: T0 + 2,
    });
    expect(repeated).toMatchObject({
      action: "stop_host",
      reason: "form_error_repeated",
      hostEvent: "failed",
      formError: kind,
    });
  });

  it("has a DE and an EN pattern for every form error kind", () => {
    const kinds = new Set(FORM_ERROR_PATTERNS.map((entry) => entry.kind));
    expect([...kinds].sort()).toEqual(["email_banned", "password_required", "username_taken"]);
    for (const kind of kinds) {
      expect(FORM_ERROR_PATTERNS.filter((entry) => entry.kind === kind).length).toBe(2);
    }
  });

  it("checks spam before form errors and credits", () => {
    const decision = decideHelperAction(
      observe({
        pageMessages: ["No soup for you!", "The username is already taken.", "Not enough credits"],
      }),
    );
    expect(decision.action).toBe("retry_after_spam_message");
  });
});

describe("captcha helper machine: invariants", () => {
  const labels = [...Object.values(HELPER_LABELS), "Solver busy", null] as const;
  const checkboxes = ["checked", "empty", "none"] as const;

  it("never exceeds the try limit and only parks or stops via a host event", () => {
    for (const buttonText of labels) {
      for (const humanCheckbox of checkboxes) {
        for (const imageGridOpen of [false, true]) {
          for (let tries = 0; tries <= HELPER_MAX_TRIES; tries += 1) {
            const decision = decideHelperAction(
              observe({
                buttonText,
                humanCheckbox,
                imageGridOpen,
                tries,
                nowMs: T0 + HELPER_PLACING_TIMEOUT_MS,
                memory: { placingSinceMs: T0, gridSinceMs: T0 },
              }),
            );
            expect(decision.tries).toBeLessThanOrEqual(HELPER_MAX_TRIES);
            expect(decision.tries - tries).toBeGreaterThanOrEqual(0);
            expect(decision.tries - tries).toBeLessThanOrEqual(1);
            if (decision.action === "park_operator") expect(decision.hostEvent).toBe("parked");
            if (decision.action === "submit") expect(buttonText).toBe(HELPER_LABELS.placed);
          }
        }
      }
    }
  });
});
