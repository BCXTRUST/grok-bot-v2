import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type AdapterContext,
  BrowserPersonaSchema,
  CaptchaQuestionRequestSchema,
  CaptchaSolverError,
  FAKE_SECRET_MASK,
  FakeBrowserSessionProvider,
  FakeCaptchaSolver,
  FakeMailboxProvider,
  type FakeProxyInventory,
  FakeProxyProvider,
  FakeSearchProvider,
  FakeTextModel,
  fakePngBytes,
  ImageToTextRequestSchema,
  InboundMailSchema,
  MIN_CAPTCHA_IMAGE_BYTES,
  type ProxyEndpoint,
  ProxyEndpointSchema,
  parseCaptchaSolveRequest,
  SecretRefSchema,
  TokenRequestSchema,
  WebSearchResultSchema,
} from "./index.js";

function context(signal = new AbortController().signal): AdapterContext {
  return { operationId: "op-1", traceId: "trace-1", workspaceId: "ws-1", userId: "user-1", signal };
}

const persona = {
  projectId: "proj-1",
  profileKey: "proj-1",
  locale: "de-DE",
  timezoneId: "Europe/Berlin",
};

const endpoint = (id: string, country = "DE"): ProxyEndpoint => ({
  id,
  country,
  stickyKey: `persona-1:${country}`,
  server: `${id}.proxy.example.test:8080`,
  username: { secretId: `${id}-user` },
  password: { secretId: `${id}-pass` },
  kind: "static_isp",
});

const inventory = (
  id: string,
  country = "DE",
  kind: ProxyEndpoint["kind"] = "static_isp",
): FakeProxyInventory => {
  const { stickyKey: _stickyKey, ...rest } = endpoint(id, country);
  return { ...rest, kind };
};

describe("link builder contract schemas", () => {
  it("rejects captcha images below the minimum size before any solve", () => {
    const small = fakePngBytes(MIN_CAPTCHA_IMAGE_BYTES - 1);
    expect(
      ImageToTextRequestSchema.safeParse({ type: "ImageToText", imagePng: small }).success,
    ).toBe(false);
    expect(
      ImageToTextRequestSchema.safeParse({
        type: "ImageToText",
        imagePng: fakePngBytes(MIN_CAPTCHA_IMAGE_BYTES),
      }).success,
    ).toBe(true);
    expect(() => parseCaptchaSolveRequest({ type: "ImageToText", imagePng: small })).toThrow(
      /at least 100 bytes/,
    );
  });

  it("only accepts widget types with a site key and http(s) page for token requests", () => {
    const valid = {
      type: "turnstile",
      websiteURL: "https://forum.example.test/register",
      websiteKey: "k",
    };
    expect(TokenRequestSchema.safeParse(valid).success).toBe(true);
    expect(TokenRequestSchema.safeParse({ ...valid, websiteKey: "" }).success).toBe(false);
    expect(TokenRequestSchema.safeParse({ ...valid, type: "image_letters" }).success).toBe(false);
    expect(
      TokenRequestSchema.safeParse({ ...valid, websiteURL: "ftp://example.test" }).success,
    ).toBe(false);
  });

  it("keeps proxy credentials as secret references only", () => {
    expect(ProxyEndpointSchema.safeParse(endpoint("p1")).success).toBe(true);
    expect(
      ProxyEndpointSchema.safeParse({ ...endpoint("p1"), password: "plaintext" }).success,
    ).toBe(false);
    expect(
      ProxyEndpointSchema.safeParse({ ...endpoint("p1"), passwordPlaintext: "plaintext" }).success,
    ).toBe(false);
    expect(SecretRefSchema.safeParse({ secretId: "s1", value: "plaintext" }).success).toBe(false);
    expect(ProxyEndpointSchema.safeParse({ ...endpoint("p1"), server: "http://h:1" }).success).toBe(
      false,
    );
    expect(ProxyEndpointSchema.safeParse({ ...endpoint("p1"), country: "Germany" }).success).toBe(
      false,
    );
  });

  it("validates personas, questions, inbound mail and search results", () => {
    expect(BrowserPersonaSchema.safeParse({ ...persona, profileKey: "../escape" }).success).toBe(
      false,
    );
    expect(BrowserPersonaSchema.safeParse({ ...persona, locale: "German" }).success).toBe(false);
    expect(BrowserPersonaSchema.safeParse({ ...persona, locale: "de-de" }).success).toBe(false);
    for (const locale of ["pt-BR", "en-US", "zh-Hant-TW", "ja"]) {
      expect(BrowserPersonaSchema.safeParse({ ...persona, locale }).success, locale).toBe(true);
    }
    expect(CaptchaQuestionRequestSchema.safeParse({}).success).toBe(false);
    expect(
      InboundMailSchema.safeParse({
        inboxId: "i",
        from: "noreply@forum.example.test",
        subject: "Bitte bestätigen",
        textBody: "Link",
        receivedAt: "2026-10-05T10:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      WebSearchResultSchema.safeParse({
        url: "javascript:alert(1)",
        title: "",
        snippet: "",
        domain: "x",
      }).success,
    ).toBe(false);
  });
});

describe("fake adapters describe themselves", () => {
  it("returns provider-neutral descriptors", () => {
    const adapters = [
      new FakeBrowserSessionProvider(),
      new FakeCaptchaSolver(),
      new FakeProxyProvider([inventory("p1")]),
      new FakeSearchProvider(),
      new FakeMailboxProvider(),
      new FakeTextModel(),
    ];
    for (const adapter of adapters) {
      const described = adapter.describe();
      expect(described.id).toMatch(/^fake-/);
      expect(described.contractVersion).toBe("1");
      expect(described.capabilities).toBeTypeOf("object");
    }
  });
});

describe("FakeBrowserSessionProvider", () => {
  const registerUrl = "https://forum.example.test/register";

  function provider() {
    return new FakeBrowserSessionProvider({
      [registerUrl]: {
        elements: {
          "#username": {},
          "#password": {},
          "#captcha-img": { png: fakePngBytes(400, "captcha") },
          ".helper-button": {
            text: "Place the check",
            onClick: (page) => page.setText(".helper-button", "Placing…"),
          },
          ".g-recaptcha": { attributes: { "data-sitekey": "site-key-1" } },
          "#submit": {
            text: "Registrieren",
            onClick: (page) => page.goto("https://forum.example.test/welcome"),
          },
        },
        onTick: (page) => {
          if (page.get(".helper-button")?.text === "Placing…") {
            page.setText(".helper-button", "Placed. Submit the form.");
          }
        },
      },
      "https://forum.example.test/welcome": { text: "Willkommen", elements: {} },
    });
  }

  it("drives a scripted page and masks secret fills in the action log", async () => {
    const browser = provider();
    const session = await browser.open(persona, context());
    await session.goto(registerUrl);
    await session.fill("#username", "persona_1");
    await session.fill("#password", "generated-password", { secret: true });
    expect(session.actions).toContainEqual({
      kind: "fill",
      selector: "#password",
      value: FAKE_SECRET_MASK,
    });
    expect(JSON.stringify(session.actions)).not.toContain("generated-password");
    expect(session.valueOf("#password")).toBe("generated-password");

    expect(await session.attribute(".g-recaptcha", "data-sitekey")).toBe("site-key-1");
    expect(await session.attribute(".g-recaptcha", "missing")).toBeNull();
    expect(await session.text("#nope")).toBeNull();
    expect(await session.exists("#nope")).toBe(false);
    expect((await session.elementScreenshotPng("#captcha-img")).byteLength).toBe(400);
    expect((await session.elementScreenshotPng("#username")).byteLength).toBeGreaterThanOrEqual(
      MIN_CAPTCHA_IMAGE_BYTES,
    );

    await session.click(".helper-button");
    expect(await session.text(".helper-button")).toBe("Placing…");
    expect(await session.waitFor(".helper-button", { timeoutMs: 1000 })).toBe(true);
    expect(await session.text(".helper-button")).toBe("Placed. Submit the form.");
    expect(await session.pageText()).toContain("Registrieren");

    await session.click("#submit");
    expect(await session.url()).toBe("https://forum.example.test/welcome");
    expect(await session.pageText()).toBe("Willkommen");
    expect((await session.screenshotPng()).byteLength).toBeGreaterThan(0);

    await session.goto("https://unknown.example.test/");
    expect(await session.pageText()).toBe("");
    await expect(session.click("#missing")).rejects.toThrow(/No element/);

    await session.close();
    await session.close();
    expect(session.isClosed).toBe(true);
    await expect(session.url()).rejects.toThrow(/closed/);
  });

  it("isolates page state per session", async () => {
    const browser = provider();
    const first = await browser.open(persona, context());
    const second = await browser.open(persona, context());
    await first.goto(registerUrl);
    await second.goto(registerUrl);
    await first.click(".helper-button");
    expect(await second.text(".helper-button")).toBe("Place the check");
    expect(browser.sessions.map((session) => session.id)).toEqual([
      "fake-session-1",
      "fake-session-2",
    ]);
  });

  it("refuses extensions when the provider cannot load them and honours abort", async () => {
    const noExtensions = new FakeBrowserSessionProvider(
      {},
      {
        extensions: false,
        persistentProfile: true,
        liveScreen: false,
      },
    );
    await expect(
      noExtensions.open({ ...persona, extensionPaths: ["/ext/helper"] }, context()),
    ).rejects.toThrow(/extensions/);
    const controller = new AbortController();
    controller.abort();
    await expect(noExtensions.open(persona, context(controller.signal))).rejects.toThrow(/abort/i);
  });
});

describe("FakeCaptchaSolver", () => {
  const token = {
    type: "recaptcha_v2" as const,
    websiteURL: "https://forum.example.test/register",
    websiteKey: "site-key",
  };

  it("charges credits on success and refunds scripted failures", async () => {
    const solver = new FakeCaptchaSolver({
      balance: 30,
      outcomes: [new CaptchaSolverError("no_token"), "token-1"],
    });
    await expect(solver.solve(token, context())).rejects.toMatchObject({
      code: "no_token",
      retryable: true,
    });
    expect((await solver.balance(context())).credits).toBe(30);
    const result = await solver.solve(token, context());
    expect(result).toEqual({ answer: "token-1", credits: 10, balance: 20, taskId: "fake-task-1" });
    const image = await solver.solve(
      { type: "ImageToText", imagePng: fakePngBytes(200) },
      context(),
    );
    expect(image.credits).toBe(4);
    expect(image.balance).toBe(16);
  });

  it("rejects invalid, unsupported and unaffordable requests without charging", async () => {
    const solver = new FakeCaptchaSolver({ balance: 5, supports: ["image_letters"] });
    await expect(
      solver.solve({ type: "ImageToText", imagePng: fakePngBytes(10) }, context()),
    ).rejects.toMatchObject({ code: "invalid_request", retryable: false });
    await expect(solver.solve(token, context())).rejects.toMatchObject({ code: "unsupported" });
    const poor = new FakeCaptchaSolver({ balance: 5 });
    await expect(poor.solve(token, context())).rejects.toMatchObject({ code: "credits" });
    expect(solver.requests).toHaveLength(0);
    expect((await poor.balance(context())).credits).toBe(5);
  });

  it("answers known knowledge questions and reports unknown ones", async () => {
    const solver = new FakeCaptchaSolver({
      answers: { "Wie heißt die Hauptstadt von Deutschland?": "Berlin" },
    });
    expect(
      await solver.answerQuestion(
        { question: "  wie heißt die   Hauptstadt von Deutschland? " },
        context(),
      ),
    ).toEqual({ answer: "Berlin" });
    expect(await solver.answerQuestion({ pageText: "Was ist 3 + 4?" }, context())).toEqual({
      couldNotAnswer: true,
    });
  });
});

describe("FakeProxyProvider", () => {
  it("leases one sticky endpoint per sticky key and frees it on release", async () => {
    const proxies = new FakeProxyProvider(
      [inventory("p1"), inventory("p2"), inventory("p3", "AT")],
      { now: () => new Date("2026-10-05T00:00:00.000Z"), leaseHours: 24 },
    );
    const first = await proxies.lease({ country: "DE", stickyKey: "a:DE" }, context());
    const again = await proxies.lease({ country: "DE", stickyKey: "a:DE" }, context());
    const second = await proxies.lease({ country: "DE", stickyKey: "b:DE" }, context());
    expect(first).toMatchObject({ id: "p1", stickyKey: "a:DE", country: "DE" });
    expect(again.id).toBe("p1");
    expect(second.id).toBe("p2");
    expect(first.renewsAt).toBe("2026-10-06T00:00:00.000Z");
    expect(first.password).toEqual({ secretId: "p1-pass" });
    await expect(proxies.lease({ country: "DE", stickyKey: "c:DE" }, context())).rejects.toThrow(
      /No static_isp or residential proxy available in DE/,
    );
    expect((await proxies.lease({ country: "AT", stickyKey: "a:AT" }, context())).id).toBe("p3");
    await expect(proxies.lease({ country: "AT", stickyKey: "a:DE" }, context())).rejects.toThrow(
      /leased in DE/,
    );
    expect((await proxies.renew("p1", context())).stickyKey).toBe("a:DE");
    await proxies.release("p1", context());
    await expect(proxies.renew("p1", context())).rejects.toThrow(/not leased/);
    expect((await proxies.lease({ country: "DE", stickyKey: "d:DE" }, context())).id).toBe("p1");
  });

  it("falls back through the requested tiers in order, per country", async () => {
    const proxies = new FakeProxyProvider([
      inventory("isp-de", "DE"),
      inventory("res-br", "BR", "residential"),
      inventory("dc-br", "BR", "datacenter"),
    ]);
    const br = await proxies.lease({ country: "BR", stickyKey: "a:BR" }, context());
    expect(br).toMatchObject({ id: "res-br", kind: "residential" });
    await expect(
      proxies.lease({ country: "US", stickyKey: "a:US", kinds: ["static_isp"] }, context()),
    ).rejects.toThrow(/No static_isp proxy available in US/);
    expect(
      (await proxies.lease({ country: "BR", stickyKey: "b:BR", kinds: ["datacenter"] }, context()))
        .id,
    ).toBe("dc-br");
    expect(proxies.describe().capabilities).toEqual({
      coverage: { static_isp: ["DE"], residential: ["BR"], datacenter: ["BR"] },
      sticky: true,
    });
    await expect(proxies.lease({ country: "BR", stickyKey: "a b" }, context())).rejects.toThrow();
  });
});

describe("FakeSearchProvider", () => {
  it("returns scripted results bounded by depth", async () => {
    const results = Array.from({ length: 12 }, (_, index) => ({
      url: `https://forum${index}.example.test/viewtopic.php?t=${index}`,
      title: `Thread ${index}`,
      snippet: "",
      domain: `forum${index}.example.test`,
    }));
    const search = new FakeSearchProvider({ footprint: results });
    expect(
      await search.search({ query: "footprint", country: "DE", language: "de" }, context()),
    ).toHaveLength(10);
    expect(
      await search.search(
        { query: "footprint", country: "DE", language: "de", depth: 3 },
        context(),
      ),
    ).toHaveLength(3);
    expect(
      await search.search({ query: "other", country: "AT", language: "de" }, context()),
    ).toEqual([]);
    await expect(
      search.search({ query: " ", country: "DE", language: "de" }, context()),
    ).rejects.toThrow();
    const dynamic = new FakeSearchProvider((request) =>
      results.slice(0, request.depth === 5 ? 1 : 2),
    );
    expect(
      await dynamic.search({ query: "x", country: "CH", language: "de", depth: 5 }, context()),
    ).toHaveLength(1);
  });
});

describe("FakeMailboxProvider", () => {
  it("creates one inbox per project and delivers inbound mail to listeners", async () => {
    const mailbox = new FakeMailboxProvider();
    const inbox = await mailbox.ensureInbox("Proj 1", context());
    expect(await mailbox.ensureInbox("Proj 1", context())).toEqual(inbox);
    expect(inbox.address).toBe("proj-1-1@inbox.example.test");
    const received: string[] = [];
    const stop = mailbox.onInbound((mail) => received.push(mail.subject));
    const mail = {
      inboxId: inbox.inboxId,
      from: "noreply@forum.example.test",
      subject: "Aktiviere dein Konto",
      textBody: "https://forum.example.test/activate?k=1",
      receivedAt: "2026-10-05T10:00:00.000Z",
    };
    mailbox.deliver(mail);
    stop();
    mailbox.deliver({ ...mail, subject: "second" });
    expect(received).toEqual(["Aktiviere dein Konto"]);
    expect(mailbox.messages(inbox.inboxId)).toHaveLength(2);
    expect(() => mailbox.deliver({ ...mail, inboxId: "unknown" })).toThrow(/Unknown inbox/);
  });
});

describe("FakeTextModel", () => {
  const schema = z.object({ relevance: z.number().min(0).max(1), openQuestion: z.boolean() });
  const request = { lane: "classify" as const, system: "s", user: "u", schema, maxTokens: 100 };

  it("validates structured output against the caller's schema", async () => {
    const model = new FakeTextModel(
      {
        classify: [
          { json: { relevance: 0.8, openQuestion: true } },
          { json: { relevance: 2, openQuestion: true } },
          { text: "not json" },
          { text: '{"relevance":0.1,"openQuestion":false}' },
          { refuse: "I can't help with that." },
          { error: "upstream 500" },
        ],
      },
      { classify: "fake/classifier" },
    );
    const ok = await model.complete(request, context());
    expect(ok).toMatchObject({ ok: true, value: { relevance: 0.8 }, modelId: "fake/classifier" });
    if (ok.ok) expect(ok.tokens.input).toBeGreaterThan(0);
    expect(await model.complete(request, context())).toMatchObject({ ok: false, reason: "schema" });
    expect(await model.complete(request, context())).toMatchObject({
      ok: false,
      reason: "schema",
      raw: "not json",
    });
    expect(await model.complete(request, context())).toMatchObject({
      ok: true,
      value: { relevance: 0.1, openQuestion: false },
    });
    expect(await model.complete(request, context())).toMatchObject({
      ok: false,
      reason: "refusal",
    });
    expect(await model.complete(request, context())).toMatchObject({ ok: false, reason: "error" });
    expect(await model.complete(request, context())).toMatchObject({ ok: false, reason: "error" });
    expect(model.requests).toHaveLength(7);
    expect(model.requests[0]).not.toHaveProperty("schema");
  });

  it("supports a function script per request", async () => {
    const model = new FakeTextModel((incoming) =>
      incoming.lane === "draft"
        ? { refuse: "Ich kann dabei nicht helfen." }
        : { json: { relevance: 0.5, openQuestion: false } },
    );
    expect(await model.complete({ ...request, lane: "draft" }, context())).toMatchObject({
      ok: false,
      reason: "refusal",
      modelId: "fake/draft",
    });
    expect(await model.complete({ ...request, lane: "fallback" }, context())).toMatchObject({
      ok: true,
    });
  });
});
