import { describe, expect, it } from "vitest";
import {
  desktopShowsForumSearch,
  forumSearchQuery,
  forumSearchUrl,
  forumSearchUrlFromProject,
} from "./forum-search.js";

describe("forum search", () => {
  it("searches Google for the stored brand and topic", () => {
    const url = forumSearchUrlFromProject({
      name: "Vitaminexpress",
      brandName: "Vitaminexpress",
      topicLanes: [{ tag: "Magnesium", description: "Questions about magnesium" }],
      targets: [{ keywordClusters: ["magnesium kaufen"] }],
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://www.google.com/search");
    expect(parsed.searchParams.get("q")).toBe("Vitaminexpress Magnesium forum");
    expect(url).not.toContain(".example");
  });

  it("drops example hosts and still searches the real topic", () => {
    expect(
      forumSearchQuery({
        brandName: "Vitaminexpress",
        topic: "forum-abc123.example",
        name: "fragen-abc123.example",
        keywords: ["brett-abc123.example", "https://boards.example/topic"],
      }),
    ).toBe("Vitaminexpress forum");
  });

  it("does not invent a host when the project has no real topic", () => {
    const url = forumSearchUrl({
      brandName: "forum-1.example",
      name: "brett-1.example",
    });
    expect(new URL(url).searchParams.get("q")).toBe("on-topic forums");
    expect(url).not.toContain(".example");
  });

  it("treats a Google search window as the working page", () => {
    expect(desktopShowsForumSearch(["Vitaminexpress forum - Google Search"])).toBe(true);
    expect(desktopShowsForumSearch(["Vitaminexpress Forum - Google Suche"])).toBe(true);
    expect(desktopShowsForumSearch(["Google"])).toBe(true);
    expect(desktopShowsForumSearch(["New Tab - Google Chrome"])).toBe(false);
    expect(desktopShowsForumSearch(["Unusual traffic from your computer"])).toBe(false);
    expect(desktopShowsForumSearch(["Home", "Trash"])).toBe(false);
    expect(desktopShowsForumSearch([])).toBe(false);
  });
});
