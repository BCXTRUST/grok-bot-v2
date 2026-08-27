import { describe, expect, it } from "vitest";
import { COMPUTER_USE_GUIDE, COMPUTER_USE_SUMMARY } from "./computer-use-guide.js";

describe("computer use guide", () => {
  it("summary teaches the key operating rules", () => {
    const lower = COMPUTER_USE_SUMMARY.toLowerCase();
    expect(COMPUTER_USE_SUMMARY).toContain("computer_observe");
    expect(COMPUTER_USE_SUMMARY).toContain("computer_act");
    // The core fix for redundant screenshots.
    expect(lower).toContain("do not call computer_observe right after acting");
    expect(lower).toContain("window");
    expect(lower).toContain("browser");
    expect(lower).toContain("request_takeover");
  });

  it("full guide covers perception, drag, browser navigation, windows, and takeover", () => {
    const lower = COMPUTER_USE_GUIDE.toLowerCase();
    expect(lower).toContain("drag");
    expect(COMPUTER_USE_GUIDE).toContain("Alt+Tab");
    expect(lower).toContain("address bar");
    expect(lower).toContain("coordinates are");
    expect(COMPUTER_USE_GUIDE).toContain("request_takeover");
  });
});
