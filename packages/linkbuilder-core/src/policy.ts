import {
  type LbLanguage,
  type LbLinkRatio,
  type LbLinkSlot,
  type LbRegister,
  lbPrimaryLanguage,
} from "@rakazo/contracts";
import { parse } from "tldts";

/**
 * eTLD+1 of a hostname or URL using the public suffix list, including private suffixes so
 * `a.github.io` and `b.github.io` stay distinct; null for IPs and bare suffixes.
 */
export function registrableDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase().replace(/\.$/, "");
  if (!trimmed) return null;
  const parsed = parse(trimmed, { allowPrivateDomains: true });
  if (parsed.isIp || !parsed.domain) return null;
  return parsed.domain;
}

export type TargetUrlCheck =
  | { ok: true; url: string; registrableDomain: string }
  | {
      ok: false;
      reason:
        | "invalid_url"
        | "unsupported_scheme"
        | "credentials"
        | "ip_address"
        | "domain_not_allowed";
    };

export function validateTargetUrl(url: string, allowedDomains: readonly string[]): TargetUrlCheck {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "unsupported_scheme" };
  }
  if (parsed.username || parsed.password) return { ok: false, reason: "credentials" };
  if (parse(parsed.hostname).isIp || parsed.hostname.startsWith("[")) {
    return { ok: false, reason: "ip_address" };
  }
  const domain = registrableDomain(parsed.hostname);
  if (!domain) return { ok: false, reason: "invalid_url" };
  const allowed = new Set(
    allowedDomains.map(registrableDomain).filter((entry): entry is string => entry !== null),
  );
  if (!allowed.has(domain)) return { ok: false, reason: "domain_not_allowed" };
  return { ok: true, url: parsed.href, registrableDomain: domain };
}

export const MAX_ANCHOR_CHARS = 60;

const URL_SCHEME = /\b[a-z][a-z0-9+.-]*:\/\//i;
const WWW = /(^|[^\p{L}\p{N}])www\./iu;
const DOMAIN_LIKE = /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)*\.\p{L}{2,}(\/\S*)?$/u;

export function containsUrl(text: string): boolean {
  if (URL_SCHEME.test(text) || WWW.test(text)) return true;
  return text
    .split(/[\s,;()"'<>[\]]+/)
    .map((token) => token.replace(/[.,!?:]+$/, ""))
    .some((token) => {
      if (!DOMAIN_LIKE.test(token)) return false;
      const parsed = parse(token.split("/")[0] ?? "");
      return parsed.isIcann === true && parsed.domain !== null;
    });
}

export type AnchorCheck =
  | { ok: true; text: string }
  | { ok: false; reason: "empty" | "too_long" | "contains_url" | "markup" };

export function validateAnchor(text: string): AnchorCheck {
  const trimmed = text.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if ([...trimmed].length > MAX_ANCHOR_CHARS) return { ok: false, reason: "too_long" };
  if (/[[\]<>]/.test(trimmed)) return { ok: false, reason: "markup" };
  if (containsUrl(trimmed)) return { ok: false, reason: "contains_url" };
  return { ok: true, text: trimmed };
}

export type ClaimKind = "health" | "finance" | "testimonial";

export interface ClaimPattern {
  id: string;
  kind: ClaimKind;
  language: LbLanguage;
  pattern: RegExp;
}

/** Whole-word, case-insensitive, Unicode-aware pattern (JS `\b` ignores umlauts). */
function words(source: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, "iu");
}

export const BUILT_IN_CLAIM_PATTERNS: readonly ClaimPattern[] = [
  {
    id: "de-cures",
    kind: "health",
    language: "de",
    pattern: words("(heilt|kuriert|beseitigt) (garantiert|sicher|dauerhaft|vollständig|endgültig)"),
  },
  {
    id: "de-guaranteed-health",
    kind: "health",
    language: "de",
    pattern: words("garantiert (schmerzfrei|geheilt|gesund|wirksam)"),
  },
  {
    id: "de-percent-effective",
    kind: "health",
    language: "de",
    pattern: words("(100|hundert) ?(%|prozent) (wirksam|natürlich|sicher|heilung)"),
  },
  {
    id: "de-no-side-effects",
    kind: "health",
    language: "de",
    pattern: words("ohne (jegliche |jede )?nebenwirkungen"),
  },
  {
    id: "de-replaces-doctor",
    kind: "health",
    language: "de",
    pattern: words(
      "ersetzt (den |jeden |deinen |ihren )?(arzt|ärztin|arztbesuch|therapie|medikamente?)",
    ),
  },
  {
    id: "de-clinically-proven",
    kind: "health",
    language: "de",
    pattern: words("klinisch (bewiesen|erwiesen|belegt)"),
  },
  {
    id: "de-miracle",
    kind: "health",
    language: "de",
    pattern: words("wunder(mittel|heilung|kur|pille)"),
  },
  {
    id: "en-cures",
    kind: "health",
    language: "en",
    pattern: words("(guaranteed|proven) to (cure|heal|work)"),
  },
  {
    id: "en-miracle",
    kind: "health",
    language: "en",
    pattern: words("miracle (cure|pill|remedy|treatment)"),
  },
  {
    id: "en-no-side-effects",
    kind: "health",
    language: "en",
    pattern: words("no side[- ]effects"),
  },
  {
    id: "en-clinically-proven",
    kind: "health",
    language: "en",
    pattern: words("clinically proven"),
  },
  {
    id: "en-replaces-doctor",
    kind: "health",
    language: "en",
    pattern: words("replaces? (your |a )?(doctor|physician|medication|therapy)"),
  },
  {
    id: "en-percent-effective",
    kind: "health",
    language: "en",
    pattern: words("100 ?% (effective|natural|safe)"),
  },
  {
    id: "de-guaranteed-returns",
    kind: "finance",
    language: "de",
    pattern: words("garantierte?[nrs]? (rendite|gewinne?|einnahmen|zinsen)"),
  },
  {
    id: "de-risk-free",
    kind: "finance",
    language: "de",
    pattern: words("risikolose?[nrs]? (geldanlage|anlage|rendite|gewinne?|investition)"),
  },
  { id: "de-get-rich", kind: "finance", language: "de", pattern: words("schnell reich") },
  {
    id: "de-double-money",
    kind: "finance",
    language: "de",
    pattern: words("(geld|vermögen|einsatz) (verdoppeln|verdreifachen)|verdopple dein geld"),
  },
  {
    id: "en-guaranteed-returns",
    kind: "finance",
    language: "en",
    pattern: words("guaranteed (returns?|profits?|income|gains)"),
  },
  {
    id: "en-risk-free",
    kind: "finance",
    language: "en",
    pattern: words("risk[- ]free (returns?|profits?|investment|income)"),
  },
  { id: "en-get-rich", kind: "finance", language: "en", pattern: words("get rich quick") },
  {
    id: "en-double-money",
    kind: "finance",
    language: "en",
    pattern: words("double your (money|investment)"),
  },
  {
    id: "de-i-use-it",
    kind: "testimonial",
    language: "de",
    pattern: words(
      "ich (nutze|benutze|verwende|nehme) (es|das|ihn|sie|den|die|diese[ns]?) (selbst|seit|schon|täglich|regelmäßig)",
    ),
  },
  {
    id: "de-since-i-use",
    kind: "testimonial",
    language: "de",
    pattern: words("seit ich (es|das|ihn|sie) (nutze|benutze|verwende|nehme)"),
  },
  {
    id: "de-my-experience",
    kind: "testimonial",
    language: "de",
    pattern: words("meine (persönliche )?erfahrung(en)? (mit|damit)"),
  },
  {
    id: "de-helped-me",
    kind: "testimonial",
    language: "de",
    pattern: words("(hat|haben) mir (sehr |total |echt |wirklich |super )?(gut )?geholfen"),
  },
  {
    id: "de-worked-for-me",
    kind: "testimonial",
    language: "de",
    pattern: words(
      "bei mir (hat|haben) (es|das|die|der|sie) (super |sehr gut |gut |echt |wirklich )?(funktioniert|geholfen|gewirkt)",
    ),
  },
  {
    id: "de-convinced",
    kind: "testimonial",
    language: "de",
    pattern: words("ich (bin|war) (total |echt |völlig )?(begeistert|überzeugt) von"),
  },
  {
    id: "en-been-using",
    kind: "testimonial",
    language: "en",
    pattern: words("I('ve| have) (been )?using"),
  },
  {
    id: "en-since-i-started",
    kind: "testimonial",
    language: "en",
    pattern: words("since I (started|began) using"),
  },
  {
    id: "en-worked-for-me",
    kind: "testimonial",
    language: "en",
    pattern: words("worked (wonders|great|perfectly) for me"),
  },
  {
    id: "en-helped-me",
    kind: "testimonial",
    language: "en",
    pattern: words("(it|this|that) (really )?helped me"),
  },
  {
    id: "en-my-experience",
    kind: "testimonial",
    language: "en",
    pattern: words("my (personal )?experience with"),
  },
  {
    id: "en-use-it-myself",
    kind: "testimonial",
    language: "en",
    pattern: words("I (personally )?use it (myself|daily|every day)"),
  },
];

export interface ClaimMatch {
  source: "customer" | "builtin";
  id: string;
  kind?: ClaimKind;
  match: string;
}

function normalizeForMatch(text: string): string {
  return text.normalize("NFC").replace(/[’`´]/g, "'").replace(/\s+/g, " ");
}

export function containsBannedClaim(
  text: string,
  bannedClaims: readonly string[],
  builtInPatterns: readonly ClaimPattern[] = BUILT_IN_CLAIM_PATTERNS,
): { banned: boolean; matches: ClaimMatch[] } {
  const normalized = normalizeForMatch(text);
  const lower = normalized.toLowerCase();
  const matches: ClaimMatch[] = [];
  for (const claim of bannedClaims) {
    const needle = normalizeForMatch(claim).trim().toLowerCase();
    if (needle && lower.includes(needle)) {
      matches.push({ source: "customer", id: claim, match: claim });
    }
  }
  for (const { id, kind, pattern } of builtInPatterns) {
    const found = normalized.match(pattern);
    if (found) matches.push({ source: "builtin", id, kind, match: found[0] });
  }
  return { banned: matches.length > 0, matches };
}

/** First-person usage or experience claims are fabricated testimonials in every mode. */
export function looksLikeTestimonial(text: string): boolean {
  return containsBannedClaim(
    text,
    [],
    BUILT_IN_CLAIM_PATTERNS.filter((pattern) => pattern.kind === "testimonial"),
  ).banned;
}

/** Whether posting one more link post on this host would push the persona above the ratio. */
export function exceedsLinkRatio(input: {
  postsOnHost: number;
  linkPostsOnHost: number;
  ratio: LbLinkRatio | number;
}): boolean {
  const { postsOnHost, linkPostsOnHost, ratio } = input;
  if (!Number.isInteger(postsOnHost) || !Number.isInteger(linkPostsOnHost)) {
    throw new RangeError("Post counts must be integers");
  }
  if (postsOnHost < 0 || linkPostsOnHost < 0 || linkPostsOnHost > postsOnHost) {
    throw new RangeError("Post counts must be non-negative and links cannot exceed posts");
  }
  const links = linkPostsOnHost + 1;
  const posts = postsOnHost + 1;
  if (typeof ratio === "number") {
    if (!(ratio >= 0 && ratio <= 1)) throw new RangeError("Ratio must be between 0 and 1");
    return links / posts > ratio + 1e-9;
  }
  return links * ratio.posts > posts * ratio.links;
}

const LINK_PATTERN =
  /\[url=([^\]]+)\]([\s\S]*?)\[\/url\]|\[url\]([\s\S]*?)\[\/url\]|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|<a\s[^>]*?href\s*=\s*["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>|(?:https?:\/\/|(?<![\p{L}\p{N}])www\.)[^\s<>()[\]]+/giu;

interface FoundLink {
  url: string;
  text: string;
}

function describeLink(match: RegExpExecArray): FoundLink {
  const [whole, bbUrl, bbText, bbBare, mdText, mdUrl, htmlUrl, htmlText] = match;
  if (bbUrl !== undefined) return { url: bbUrl, text: bbText ?? "" };
  if (bbBare !== undefined) return { url: bbBare, text: "" };
  if (mdUrl !== undefined) return { url: mdUrl, text: mdText ?? "" };
  if (htmlUrl !== undefined) return { url: htmlUrl, text: htmlText ?? "" };
  return { url: whole.replace(/[.,!?:;]+$/, ""), text: "" };
}

function sameUrl(left: string, right: string): boolean {
  const canonical = (value: string) => {
    try {
      const url = new URL(value.startsWith("www.") ? `https://${value}` : value);
      return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "")}${url.search}`;
    } catch {
      return value.trim().toLowerCase();
    }
  };
  return canonical(left) === canonical(right);
}

/**
 * Keeps exactly one link (the first, or the first pointing at `keepUrl`) and reduces every other
 * BBCode, Markdown, HTML or bare link to its visible text.
 */
export function enforceSingleLink(
  body: string,
  options: { keepUrl?: string; stripAll?: boolean } = {},
): { body: string; linkCount: number; removed: number } {
  const found = [...body.matchAll(LINK_PATTERN)];
  const keepIndex = options.stripAll
    ? -1
    : options.keepUrl
      ? found.findIndex((match) => sameUrl(describeLink(match).url, options.keepUrl!))
      : found.length > 0
        ? 0
        : -1;
  let result = "";
  let cursor = 0;
  found.forEach((match, index) => {
    result += body.slice(cursor, match.index);
    const whole = match[0];
    if (index === keepIndex) {
      result += whole;
    } else {
      const bare = /^(?:https?:\/\/|www\.)/i.test(whole);
      result += describeLink(match).text + (bare ? (whole.match(/[.,!?:;]+$/)?.[0] ?? "") : "");
    }
    cursor = match.index + whole.length;
  });
  result += body.slice(cursor);
  const removed = found.length - (keepIndex >= 0 ? 1 : 0);
  return { body: tidy(result), linkCount: found.length - removed, removed };
}

export type ReferenceFormat = "bbcode" | "markdown" | "html" | "plain";

export interface ReferenceInsert {
  targetUrl: string;
  anchorText: string;
  slot: LbLinkSlot;
  format?: ReferenceFormat;
  language?: LbLanguage;
  register?: LbRegister;
  /** Sentence used when the body has no `[REF]` marker; required beyond the built-in languages. */
  appendTemplate?: (link: string) => string;
}

const REF_MARKER = /[ \t]*\[REF\]/g;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatLink(url: string, anchor: string, format: ReferenceFormat): string {
  if (format === "markdown") return `[${anchor}](${url})`;
  if (format === "html") return `<a href="${escapeHtml(url)}">${escapeHtml(anchor)}</a>`;
  if (format === "plain") return `${anchor}: ${url}`;
  return `[url=${url}]${anchor}[/url]`;
}

/** Recommendation-style lead-ins; never first-person usage claims. */
const APPENDED_REFERENCE: Record<string, (link: string, register: LbRegister) => string> = {
  de: (link, register) =>
    register === "sie"
      ? `Schauen Sie gern hier, dort ist das ganz gut erklärt: ${link}`
      : `Schau mal hier, da ist das ganz gut erklärt: ${link}`,
  en: (link) => `This explains it quite well: ${link}`,
};

export function hasBuiltInReferenceSentence(language: LbLanguage): boolean {
  return lbPrimaryLanguage(language) in APPENDED_REFERENCE;
}

function tidy(text: string): string {
  return text
    .replace(/[ \t]+([.,!?;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * Replaces the drafter's `[REF]` marker with the link, or appends one reference sentence in the
 * persona's register. Slots other than `inline` only strip markers.
 */
export function insertReference(body: string, reference: ReferenceInsert): string {
  if (reference.slot !== "inline") return tidy(body.replace(REF_MARKER, ""));
  const url = new URL(reference.targetUrl).href;
  const anchor = reference.anchorText
    .replace(/[[\]<>()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!anchor) throw new RangeError("Anchor text is empty after sanitising");
  const link = formatLink(url, anchor, reference.format ?? "bbcode");
  let inserted = false;
  const replaced = body.replace(REF_MARKER, (marker) => {
    if (inserted) return "";
    inserted = true;
    return `${marker.startsWith(" ") || marker.startsWith("\t") ? " " : ""}${link}`;
  });
  if (inserted) return tidy(replaced);
  const language = lbPrimaryLanguage(reference.language ?? "de");
  const builtIn = Object.hasOwn(APPENDED_REFERENCE, language) ? APPENDED_REFERENCE[language] : null;
  let sentence: string;
  if (reference.appendTemplate) sentence = reference.appendTemplate(link);
  else if (builtIn) sentence = builtIn(link, reference.register ?? "du");
  else throw new RangeError(`No reference sentence for "${language}"; add a [REF] marker`);
  if (!sentence.includes(link)) throw new RangeError("appendTemplate must include the link");
  return `${tidy(body)}\n\n${sentence}`;
}

export const REFUSAL_PATTERNS: readonly RegExp[] = [
  /\bI can(?:not|'t|’t) (?:help|assist|comply|do that|write|create|provide)/i,
  /\bI(?:'m| am) (?:sorry|afraid),? (?:but )?I (?:can(?:not|'t|’t)|won't|am unable)/i,
  /\bI(?:'m| am) (?:not able|unable) to (?:help|assist|write|create|comply)/i,
  /\bI (?:won't|will not) (?:help|write|create|produce)/i,
  /\bas an AI(?: language model)?\b/i,
  /\bagainst (?:my|the|our) (?:guidelines|policy|policies|usage policies)\b/i,
  /ich kann (?:dir |ihnen |euch )?(?:dabei |hierbei |damit |hier )?(?:leider )?nicht (?:helfen|behilflich sein|unterstützen)/i,
  /ich kann (?:diese|deine|ihre|eure) (?:anfrage|bitte) (?:leider )?nicht/i,
  /es tut mir leid,? (?:aber )?(?:ich kann|das kann ich)/i,
  /(?<![\p{L}])als (?:eine )?KI(?![\p{L}])/iu,
  /(?:das|dies) verstößt gegen (?:meine|die) (?:richtlinien|regeln)/i,
  /ich werde (?:keine|keinen|nicht) .{0,40}(?:schreiben|erstellen|verfassen)/i,
];

export function refusalDetector(text: string): { refused: boolean; pattern?: string } {
  const normalized = normalizeForMatch(text);
  const hit = REFUSAL_PATTERNS.find((pattern) => pattern.test(normalized));
  return hit ? { refused: true, pattern: hit.source } : { refused: false };
}
