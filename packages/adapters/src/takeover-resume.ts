export type TakeoverResumeCheckpoint = "takeover" | "takeover-skipped" | "user-takeover";

export function takeoverResumeFromRelease(reason: unknown): {
  checkpoint: TakeoverResumeCheckpoint;
  promptNote: string;
} {
  if (reason === "skipped" || reason === "expired" || reason === "takeover-skipped") {
    return {
      checkpoint: "takeover-skipped",
      promptNote:
        "The user skipped this screen. Do not treat the site as complete. Skip it, log that it was blocked, and continue the overall task on a different site. Do not request takeover again for the same page.",
    };
  }
  if (reason === "user-takeover") {
    return {
      checkpoint: "user-takeover",
      promptNote:
        "The user watched or used the live desktop and handed it back. The browser and page are unchanged. Continue the same task from this screen. Do not restart the browser, reload the page, or assume a login was completed.",
    };
  }
  return {
    checkpoint: "takeover",
    promptNote:
      "The user finished the login. Continue from where you left off. Do not request takeover again.",
  };
}
