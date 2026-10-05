import { describe, expect, it } from "vitest";
import {
  addMarket,
  canStart,
  emptyDraft,
  RESPONSIBILITY_SENTENCE,
  wizardStepIssues,
} from "./model.js";

describe("link builder wizard", () => {
  it("starts on DE and derives US locale and time zone", () => {
    const draft = emptyDraft();
    expect(draft.markets[0]).toMatchObject({
      country: "DE",
      locale: "de-DE",
      timezoneId: "Europe/Berlin",
    });
    expect(draft.disclosureMode).toBe("undisclosed_persona");
    const withUs = addMarket(draft, "us");
    expect(withUs.markets[1]).toMatchObject({
      country: "US",
      locale: "en-US",
      timezoneId: "America/New_York",
    });
  });

  it("requires brand fields, a topic, and a saved inbox before start", () => {
    const draft = emptyDraft();
    expect(wizardStepIssues(0, draft).length).toBeGreaterThan(0);
    draft.name = "Nordlicht";
    draft.brandName = "Nordlicht";
    draft.allowedDomains = "nordlicht.example";
    expect(wizardStepIssues(0, draft)).toEqual([]);
    draft.displayName = "Mira";
    expect(wizardStepIssues(1, draft)).toEqual([]);
    draft.captchaToken = "ct_live_placeholder";
    expect(wizardStepIssues(2, draft)).toContain("Check the balance before continuing");
    draft.balance = 1200;
    expect(wizardStepIssues(2, draft)).toEqual([]);
    draft.lanes = [{ id: "lane-schlaf", tag: "Schlaf", description: "Abend" }];
    expect(wizardStepIssues(4, draft)).toEqual([]);
    expect(canStart(draft)).toBe(false);
    draft.mailboxId = "mbx-1";
    draft.captchaConfigured = true;
    expect(canStart(draft)).toBe(true);
  });

  it("keeps acceptance as a sentence with no checkbox field", () => {
    expect(RESPONSIBILITY_SENTENCE).toMatch(/responsible/i);
    expect(RESPONSIBILITY_SENTENCE.toLowerCase()).not.toContain("checkbox");
  });
});
