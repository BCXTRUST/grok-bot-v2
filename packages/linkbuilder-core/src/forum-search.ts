import { isFixtureHostDomain } from "./fake-scenario.js";

/** What the team computer shows while it looks for forums. Search only. */
const SEARCH_ORIGIN = "https://www.google.com/search";

export interface ForumSearchInput {
  name?: string | null;
  brandName?: string | null;
  topic?: string | null;
  keywords?: readonly string[] | null;
}

/** A search term we can type. Blank text, URLs, and example hosts are not a topic. */
export function forumSearchTerm(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length < 2 || cleaned.length > 80) return null;
  if (/^https?:/i.test(cleaned)) return null;
  if (/\.example\b/i.test(cleaned) || isFixtureHostDomain(cleaned)) return null;
  if (/[<>"'\\]/.test(cleaned)) return null;
  return cleaned;
}

export function forumSearchQuery(input: ForumSearchInput): string {
  const picked: string[] = [];
  const candidates = [input.brandName, input.topic, input.name, ...(input.keywords ?? [])];
  for (const candidate of candidates) {
    const term = forumSearchTerm(candidate);
    if (!term) continue;
    const folded = term.toLowerCase();
    if (
      picked.some((item) => {
        const current = item.toLowerCase();
        return current === folded || current.includes(folded) || folded.includes(current);
      })
    ) {
      continue;
    }
    picked.push(term);
    if (picked.length === 3) break;
  }
  const base = picked.join(" ");
  if (!base) return "on-topic forums";
  return /forum/i.test(base) ? base : `${base} forum`;
}

/** Google search for the stored topic. Never a forum host and never an example domain. */
export function forumSearchUrl(input: ForumSearchInput): string {
  const url = new URL(SEARCH_ORIGIN);
  url.searchParams.set("q", forumSearchQuery(input));
  return url.toString();
}

export function topicFromLanes(lanes: unknown): string | null {
  if (!Array.isArray(lanes)) return null;
  for (const lane of lanes) {
    if (!lane || typeof lane !== "object") continue;
    const record = lane as { tag?: unknown; description?: unknown };
    const tag = forumSearchTerm(record.tag);
    if (tag) return tag;
    const description = forumSearchTerm(record.description);
    if (description) return description;
  }
  return null;
}

export function keywordsFromTargets(targets: unknown): string[] {
  if (!Array.isArray(targets)) return [];
  const keywords: string[] = [];
  for (const target of targets) {
    if (!target || typeof target !== "object") continue;
    const clusters = (target as { keywordClusters?: unknown }).keywordClusters;
    if (!Array.isArray(clusters)) continue;
    for (const cluster of clusters) {
      const term = forumSearchTerm(cluster);
      if (term) keywords.push(term);
    }
  }
  return keywords;
}

export function forumSearchUrlFromProject(project: {
  name?: string | null;
  brandName?: string | null;
  topicLanes?: unknown;
  targets?: unknown;
}): string {
  return forumSearchUrl({
    name: project.name,
    brandName: project.brandName,
    topic: topicFromLanes(project.topicLanes),
    keywords: keywordsFromTargets(project.targets),
  });
}

/** True when a visible window is already a Google search or results page. */
export function desktopShowsForumSearch(titles: readonly string[]): boolean {
  for (const title of titles) {
    const text = title.trim();
    if (!text || /sorry|unusual traffic|captcha/i.test(text)) continue;
    if (/google (?:search|suche)/i.test(text)) return true;
  }
  return false;
}
