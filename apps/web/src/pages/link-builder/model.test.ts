import { describe, expect, it } from "vitest";
import {
  addMarket,
  artifactImageSrc,
  canStart,
  emptyDraft,
  parseAllowedSite,
  patchFromDraft,
  RESPONSIBILITY_SENTENCE,
  withPersonaPrefill,
  wizardStepIssues,
} from "./model.js";

describe("link builder wizard", () => {
  it("renders only raster image artifacts as data URLs", () => {
    expect(artifactImageSrc({ mimeType: "image/png", contentBase64: "iVBO" })).toBe(
      "data:image/png;base64,iVBO",
    );
    expect(artifactImageSrc({ mimeType: "text/html", contentBase64: "PGh0bWw+" })).toBeNull();
    expect(artifactImageSrc({ mimeType: "image/svg+xml", contentBase64: "PHN2Zz4=" })).toBeNull();
  });

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
    expect(wizardStepIssues(2, draft)).toEqual([]);
    draft.lanes = [{ id: "lane-schlaf", tag: "Schlaf", description: "Abend" }];
    expect(wizardStepIssues(3, draft)).toEqual([]);
    expect(canStart(draft)).toBe(false);
    draft.mailboxId = "mbx-1";
    expect(canStart(draft)).toBe(true);
  });

  it("accepts a site with www, https, and a path", () => {
    expect(parseAllowedSite("https://www.vitaminexpress.org/de")).toEqual({
      ok: true,
      domain: "vitaminexpress.org",
      targetUrl: "https://www.vitaminexpress.org/de",
    });
    expect(parseAllowedSite("www.vitaminexpress.org").ok).toBe(true);
    expect(parseAllowedSite("vitaminexpress.org")).toMatchObject({
      ok: true,
      domain: "vitaminexpress.org",
      targetUrl: null,
    });
    expect(parseAllowedSite("http://vitaminexpress.org/de/")).toMatchObject({
      ok: true,
      targetUrl: "http://vitaminexpress.org/de",
    });
    expect(parseAllowedSite("not a site").ok).toBe(false);

    const draft = emptyDraft();
    draft.name = "Vitaminexpress";
    draft.brandName = "Vitaminexpress";
    draft.allowedDomains = "https://www.vitaminexpress.org/de";
    expect(wizardStepIssues(0, draft)).toEqual([]);
    const patch = patchFromDraft(draft);
    expect(patch.allowedDomains).toEqual(["vitaminexpress.org"]);
    expect(patch.targets.map((target) => target.url)).toEqual([
      "https://www.vitaminexpress.org/de",
    ]);
  });

  it("prefills an empty bio from the brand and path", () => {
    const draft = emptyDraft();
    draft.brandName = "Vitaminexpress";
    draft.allowedDomains = "https://www.vitaminexpress.org/de";
    const filled = withPersonaPrefill(draft);
    expect(filled.displayName).toBe("Vitaminexpress");
    expect(filled.bio).toContain("Vitaminexpress");
    expect(filled.bio).toContain("/de");
    draft.bio = "Already written";
    expect(withPersonaPrefill(draft).bio).toBe("Already written");
  });

  it("keeps acceptance as a sentence with no checkbox field", () => {
    expect(RESPONSIBILITY_SENTENCE).toMatch(/responsible/i);
    expect(RESPONSIBILITY_SENTENCE.toLowerCase()).not.toContain("checkbox");
  });
});
