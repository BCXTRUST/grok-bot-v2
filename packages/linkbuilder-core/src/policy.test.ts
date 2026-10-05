import { describe, expect, it } from "vitest";
import {
  BUILT_IN_CLAIM_PATTERNS,
  containsBannedClaim,
  containsUrl,
  enforceSingleLink,
  exceedsLinkRatio,
  hasBuiltInReferenceSentence,
  insertReference,
  looksLikeTestimonial,
  MAX_ANCHOR_CHARS,
  REFUSAL_PATTERNS,
  refusalDetector,
  registrableDomain,
  validateAnchor,
  validateTargetUrl,
} from "./policy.js";

describe("registrableDomain", () => {
  it.each([
    ["https://www.Brand.example.co.uk/path", "example.co.uk"],
    ["forum.example.de", "example.de"],
    ["shop.example.com.br.", "example.com.br"],
    ["sub.example.github.io", "example.github.io"],
    ["github.io", null],
    ["192.168.0.1", null],
    ["co.uk", null],
    ["   ", null],
  ])("%s → %s", (input, expected) => {
    expect(registrableDomain(input)).toBe(expected);
  });
});

describe("validateTargetUrl", () => {
  const allowed = ["demo-wellness.example", "https://www.shop.example.co.uk"];

  it("accepts http(s) URLs on an allowed registrable domain", () => {
    expect(validateTargetUrl(" https://blog.demo-wellness.example/ruecken?x=1 ", allowed)).toEqual({
      ok: true,
      url: "https://blog.demo-wellness.example/ruecken?x=1",
      registrableDomain: "demo-wellness.example",
    });
    expect(validateTargetUrl("http://example.co.uk/", allowed).ok).toBe(true);
    expect(validateTargetUrl("http://other.co.uk/", allowed).ok).toBe(false);
  });

  it("does not let one tenant of a shared hosting suffix allow another", () => {
    expect(validateTargetUrl("https://brand.github.io/a", ["brand.github.io"]).ok).toBe(true);
    expect(validateTargetUrl("https://evil.github.io/a", ["brand.github.io"])).toEqual({
      ok: false,
      reason: "domain_not_allowed",
    });
  });

  it.each([
    ["not a url", "invalid_url"],
    ["javascript:alert(1)", "unsupported_scheme"],
    ["ftp://demo-wellness.example/file", "unsupported_scheme"],
    ["https://user:pass@demo-wellness.example/", "credentials"],
    ["https://127.0.0.1/", "ip_address"],
    ["https://[::1]/", "ip_address"],
    ["https://localhost/", "invalid_url"],
    ["https://demo-wellness.example.evil.test/", "domain_not_allowed"],
    ["https://evil-demo-wellness.example/", "domain_not_allowed"],
  ])("rejects %s (%s)", (url, reason) => {
    expect(validateTargetUrl(url, allowed)).toEqual({ ok: false, reason });
  });
});

describe("validateAnchor", () => {
  it("normalises whitespace and accepts plain anchors", () => {
    expect(validateAnchor("  Übungen   für den Rücken ")).toEqual({
      ok: true,
      text: "Übungen für den Rücken",
    });
    expect(validateAnchor("ä".repeat(MAX_ANCHOR_CHARS)).ok).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["a".repeat(MAX_ANCHOR_CHARS + 1), "too_long"],
    ["[b]Rücken[/b]", "markup"],
    ["<b>Rücken</b>", "markup"],
    ["siehe demo-wellness.de", "contains_url"],
    ["siehe demo-wellness.com.br", "contains_url"],
    ["https://demo-wellness.example", "contains_url"],
    ["www.demo-wellness", "contains_url"],
  ])("rejects %j (%s)", (text, reason) => {
    expect(validateAnchor(text)).toEqual({ ok: false, reason });
  });
});

describe("containsUrl", () => {
  it.each([
    ["Schau auf example.de vorbei.", true],
    ["mailto-free text ftp://x", true],
    ["Dr. Müller sagt z.B. nein", false],
    ["Version 1.2.3 ist da", false],
    ["file.unknowntld", false],
  ])("%s → %s", (text, expected) => {
    expect(containsUrl(text)).toBe(expected);
  });
});

describe("containsBannedClaim", () => {
  it("matches customer claims case-insensitively and built-in claims in DE and EN", () => {
    const result = containsBannedClaim(
      "Das Öl HEILT GARANTIERT alles und ist ohne Nebenwirkungen. Guaranteed returns!",
      ["heilt garantiert"],
    );
    expect(result.banned).toBe(true);
    expect(result.matches.map((match) => match.id)).toEqual([
      "heilt garantiert",
      "de-cures",
      "de-no-side-effects",
      "en-guaranteed-returns",
    ]);
    expect(result.matches[1]).toMatchObject({ source: "builtin", kind: "health" });
  });

  it("respects word boundaries with umlauts and ignores empty customer claims", () => {
    expect(containsBannedClaim("Wundermittelchen", []).banned).toBe(false);
    expect(containsBannedClaim("ein Wundermittel", []).banned).toBe(true);
    expect(containsBannedClaim("Alles gut", ["  "]).banned).toBe(false);
  });

  it("keeps built-in pattern ids unique", () => {
    const ids = BUILT_IN_CLAIM_PATTERNS.map((pattern) => pattern.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("looksLikeTestimonial", () => {
  it.each([
    ["Ich nutze es selbst seit Jahren.", true],
    ["Bei mir hat das super funktioniert.", true],
    ["I’ve been using it for a month.", true],
    ["It really helped me.", true],
    ["Viele berichten, dass Dehnen hilft.", false],
    ["Studies suggest stretching helps.", false],
  ])("%s → %s", (text, expected) => {
    expect(looksLikeTestimonial(text)).toBe(expected);
  });
});

describe("exceedsLinkRatio", () => {
  it.each([
    [0, 0, { links: 1, posts: 3 }, true],
    [2, 0, { links: 1, posts: 3 }, false],
    [3, 1, { links: 1, posts: 3 }, true],
    [5, 1, { links: 1, posts: 3 }, false],
    [2, 0, 1 / 3, false],
    [3, 1, 1 / 3, true],
    [0, 0, 1, false],
    [9, 0, 0, true],
  ] as const)(
    "posts %i, links %i, ratio %j → %s",
    (postsOnHost, linkPostsOnHost, ratio, exceeds) => {
      expect(exceedsLinkRatio({ postsOnHost, linkPostsOnHost, ratio })).toBe(exceeds);
    },
  );

  it.each([
    [{ postsOnHost: 1.5, linkPostsOnHost: 0, ratio: 0.5 }],
    [{ postsOnHost: -1, linkPostsOnHost: 0, ratio: 0.5 }],
    [{ postsOnHost: 1, linkPostsOnHost: 2, ratio: 0.5 }],
    [{ postsOnHost: 1, linkPostsOnHost: 0, ratio: 1.5 }],
    [{ postsOnHost: 1, linkPostsOnHost: 0, ratio: Number.NaN }],
  ])("rejects %j", (input) => {
    expect(() => exceedsLinkRatio(input)).toThrow(RangeError);
  });
});

describe("enforceSingleLink", () => {
  it("keeps the first link and reduces the rest to their text", () => {
    const body =
      "Lies [url=https://a.example/x]das hier[/url], [b]oder[/b] [Doku](https://b.example/y), " +
      'auch <a href="https://c.example/z">diese Seite</a> und https://d.example/w.';
    expect(enforceSingleLink(body)).toEqual({
      body: "Lies [url=https://a.example/x]das hier[/url], [b]oder[/b] Doku, auch diese Seite und.",
      linkCount: 1,
      removed: 3,
    });
  });

  it("keeps the link that points at the target", () => {
    const body = "Erst www.other.example, dann [url]https://brand.example/ruecken/[/url].";
    const result = enforceSingleLink(body, { keepUrl: "https://brand.example/ruecken" });
    expect(result).toEqual({
      body: "Erst, dann [url]https://brand.example/ruecken/[/url].",
      linkCount: 1,
      removed: 1,
    });
  });

  it("removes every link when the target is not present and leaves plain text alone", () => {
    expect(enforceSingleLink("Siehe https://x.example", { keepUrl: "https://y.example" })).toEqual({
      body: "Siehe",
      linkCount: 0,
      removed: 1,
    });
    expect(enforceSingleLink("Kein Link hier.")).toEqual({
      body: "Kein Link hier.",
      linkCount: 0,
      removed: 0,
    });
  });
});

describe("insertReference", () => {
  const reference = {
    targetUrl: "https://demo-wellness.example/ruecken",
    anchorText: "Übungen für den Rücken",
    slot: "inline" as const,
  };

  it("replaces the first [REF] marker and strips the rest", () => {
    expect(insertReference("Hier [REF] und nochmal [REF].", reference)).toBe(
      "Hier [url=https://demo-wellness.example/ruecken]Übungen für den Rücken[/url] und nochmal.",
    );
  });

  it.each([
    ["markdown", "Siehe [Übungen für den Rücken](https://demo-wellness.example/ruecken)."],
    ["html", 'Siehe <a href="https://demo-wellness.example/ruecken">Übungen für den Rücken</a>.'],
    ["plain", "Siehe Übungen für den Rücken: https://demo-wellness.example/ruecken."],
  ] as const)("formats the link as %s", (format, expected) => {
    expect(insertReference("Siehe [REF].", { ...reference, format })).toBe(expected);
  });

  it("escapes HTML and sanitises markup in anchors", () => {
    const html = insertReference("[REF]", {
      ...reference,
      targetUrl: 'https://demo-wellness.example/a?b="c"&d',
      anchorText: "Tipps <b>& Tricks</b>",
      format: "html",
    });
    expect(html).toBe(
      '<a href="https://demo-wellness.example/a?b=%22c%22&amp;d">Tipps b&amp; Tricks/b</a>',
    );
    expect(() => insertReference("[REF]", { ...reference, anchorText: "[]()" })).toThrow(
      RangeError,
    );
  });

  it("appends a recommendation sentence in the persona's register", () => {
    expect(insertReference("Dehnen hilft oft.", reference)).toBe(
      "Dehnen hilft oft.\n\nSchau mal hier, da ist das ganz gut erklärt: [url=https://demo-wellness.example/ruecken]Übungen für den Rücken[/url]",
    );
    expect(insertReference("Dehnen hilft oft.", { ...reference, register: "sie" })).toContain(
      "Schauen Sie gern hier",
    );
    expect(
      insertReference("Stretching helps.", { ...reference, language: "en-GB", register: "sie" }),
    ).toContain("This explains it quite well: ");
  });

  it("needs a [REF] marker or a template for languages without a built-in sentence", () => {
    expect(hasBuiltInReferenceSentence("pt-BR")).toBe(false);
    expect(hasBuiltInReferenceSentence("de-CH")).toBe(true);
    expect(() => insertReference("Alongar ajuda.", { ...reference, language: "pt-BR" })).toThrow(
      /No reference sentence for "pt"/,
    );
    expect(() =>
      insertReference("Alongar ajuda.", { ...reference, language: "constructor" }),
    ).toThrow(RangeError);
    expect(insertReference("Alongar ajuda [REF].", { ...reference, language: "pt-BR" })).toContain(
      "[url=",
    );
    expect(
      insertReference("Alongar ajuda.", {
        ...reference,
        language: "pt-BR",
        appendTemplate: (link) => `Veja aqui: ${link}`,
      }),
    ).toBe(
      "Alongar ajuda.\n\nVeja aqui: [url=https://demo-wellness.example/ruecken]Übungen für den Rücken[/url]",
    );
    expect(() =>
      insertReference("Alongar ajuda.", { ...reference, appendTemplate: () => "Veja aqui." }),
    ).toThrow(/must include the link/);
  });

  it("only strips markers for non-inline slots", () => {
    expect(insertReference("Text [REF] hier.", { ...reference, slot: "signature" })).toBe(
      "Text hier.",
    );
    expect(insertReference("Text [REF].", { ...reference, slot: "none" })).toBe("Text.");
  });
});

describe("refusalDetector", () => {
  it.each([
    "I can't help with that request.",
    "I’m sorry, but I cannot write this.",
    "As an AI language model, I won't do that.",
    "This goes against my guidelines.",
    "Ich kann dir dabei leider nicht helfen.",
    "Es tut mir leid, aber das kann ich nicht.",
    "Als KI darf ich das nicht.",
    "Das verstößt gegen meine Richtlinien.",
    "Ich werde keinen solchen Beitrag schreiben.",
  ])("detects %j", (text) => {
    expect(refusalDetector(text).refused).toBe(true);
  });

  it.each([
    "Dehnen hilft vielen bei Rückenschmerzen.",
    "I can help you find a physio nearby.",
    "Die KIrche ist sonntags offen.",
  ])("ignores %j", (text) => {
    expect(refusalDetector(text)).toEqual({ refused: false });
  });

  it("reports the matching pattern", () => {
    const result = refusalDetector("I cannot assist with this.");
    expect(REFUSAL_PATTERNS.map((pattern) => pattern.source)).toContain(result.pattern);
  });
});
