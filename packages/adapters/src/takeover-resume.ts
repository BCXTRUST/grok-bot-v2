export type TakeoverResumeCheckpoint = "takeover" | "takeover-skipped";

export function takeoverResumeFromRelease(reason: unknown): {
  checkpoint: TakeoverResumeCheckpoint;
  promptNote: string;
} {
  if (reason === "skipped" || reason === "expired") {
    return {
      checkpoint: "takeover-skipped",
      promptNote:
        "The user skipped this screen. Do not treat the site as complete. Skip it, log that it was blocked, and continue the overall task on a different site. Do not request takeover again for the same page.",
    };
  }
  return {
    checkpoint: "takeover",
    promptNote:
      "The user finished the login. Continue from where you left off. Do not request takeover again.",
  };
}
