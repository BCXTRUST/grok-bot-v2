import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  evaluateVerification,
  type VerificationFacts,
  type VerificationOutcome,
} from "@rakazo/linkbuilder-core";
import { load } from "cheerio";

/*
 * Logged-out verification (plan section 6.5). A plain HTTP fetch from the worker's own egress,
 * never through the persona browser or its proxy, with no cookies, so the result is what an
 * anonymous visitor and a crawler see.
 */

const TRACKING_PARAMS = /^(utm_[a-z]+|gclid|fbclid|mc_[a-z]+|ref|ref_src)$/i;
const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 5_000_000;
const MISSING_TOPIC =
  /topic you selected does not exist|requested topic does not exist|thema existiert nicht/i;

export const VERIFY_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

/** Comparable form of a link target: lower-case host, no hash, no tracking params, no trailing slash. */
export function normalizeTargetUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.hostname.toLowerCase().replace(/^www\./, "")}${path}${url.search}`;
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
  return lower === "::1" || lower === "::" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
}

export class VerifyRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerifyRefused";
  }
}

async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new VerifyRefused(`Refusing to verify a private address (${url.hostname})`);
  }
}

export interface VerifyPlacementInput {
  postUrl: string;
  targetUrl: string;
  /** Tests point this at the offline fixture; production uses the global fetch. */
  fetchImpl?: typeof fetch;
  /** Only for offline fixtures on loopback. */
  allowPrivateNetwork?: boolean;
  acceptLanguage?: string;
  timeoutMs?: number;
}

export interface VerifyPlacementResult {
  outcome: VerificationOutcome;
  facts: VerificationFacts;
  httpStatus: number;
  finalUrl: string;
  anchorText: string | null;
  canonical: string | null;
  html: string;
}

async function fetchPage(
  input: VerifyPlacementInput,
): Promise<{ status: number; url: string; html: string }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let url = new URL(input.postUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new VerifyRefused("Only http(s) placements can be verified");
    }
    if (!input.allowPrivateNetwork) await assertPublicHost(url);
    const response = await fetchImpl(url, {
      redirect: "manual",
      headers: {
        "user-agent": VERIFY_USER_AGENT,
        accept: "text/html,application/xhtml+xml",
        "accept-language": input.acceptLanguage ?? "en;q=0.8",
      },
      signal: AbortSignal.timeout(input.timeoutMs ?? 20_000),
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    const html = new TextDecoder().decode(buffer.slice(0, MAX_HTML_BYTES));
    return { status: response.status, url: url.href, html };
  }
  throw new VerifyRefused("Too many redirects");
}

export async function verifyPlacement(input: VerifyPlacementInput): Promise<VerifyPlacementResult> {
  const target = normalizeTargetUrl(input.targetUrl);
  if (!target) throw new VerifyRefused("Target URL is not http(s)");
  const page = await fetchPage(input);
  const $ = load(page.html);
  const fragment = new URL(input.postUrl).hash.slice(1);
  const threadPresent = page.status < 400 && !MISSING_TOPIC.test($("body").text());
  const scope = fragment ? $(`[id="${fragment.replace(/"/g, "")}"]`).first() : $("body");
  const postPresent = threadPresent && scope.length > 0;
  const anchor = postPresent
    ? scope
        .find("a[href]")
        .filter((_, element) => {
          const href = $(element).attr("href") ?? "";
          let resolved: string;
          try {
            resolved = new URL(href, page.url).href;
          } catch {
            return false;
          }
          return normalizeTargetUrl(resolved) === target;
        })
        .first()
    : null;
  const robots = $('meta[name="robots" i], meta[name="googlebot" i]')
    .map((_, element) => $(element).attr("content") ?? "")
    .get()
    .join(",");
  const facts: VerificationFacts = {
    hrefFound: Boolean(anchor && anchor.length > 0),
    rel: anchor?.attr("rel") ?? null,
    postPresent,
    threadPresent,
    noindex: /noindex/i.test(robots),
  };
  return {
    outcome: evaluateVerification(facts),
    facts,
    httpStatus: page.status,
    finalUrl: page.url,
    anchorText: anchor && anchor.length > 0 ? anchor.text().trim() : null,
    canonical: $('link[rel="canonical"]').attr("href") ?? null,
    html: page.html,
  };
}
