import type { AdapterContext } from "@rakazo/adapter-kit";
import { CaptchaSolverError, MIN_CAPTCHA_IMAGE_BYTES } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { CaptellEmulator, captellCues } from "./captell-emulator.js";
import { CaptellHttpSolver } from "./captell-solver.js";

const TOKEN = "ct_live_placeholder";
const context: AdapterContext = {
  operationId: "op",
  traceId: "trace",
  workspaceId: "ws",
  userId: "user",
  signal: new AbortController().signal,
};

function solver(emulator: CaptellEmulator, options: { maxRetries?: number } = {}) {
  return new CaptellHttpSolver({
    token: async () => TOKEN,
    fetch: emulator.fetch,
    baseUrl: "https://captell.example",
    maxRetries: options.maxRetries ?? 0,
    retryDelayMs: 0,
  });
}

const png = new Uint8Array(MIN_CAPTCHA_IMAGE_BYTES + 20).fill(7);
png.set([0x89, 0x50, 0x4e, 0x47], 0);

describe("CaptellHttpSolver", () => {
  it("describes the captcha types the HTTPS door solves", () => {
    const described = solver(new CaptellEmulator()).describe();
    expect(described.id).toBe("captell-http");
    expect(described.capabilities.supports).toEqual([
      "recaptcha_v2",
      "recaptcha_v3",
      "recaptcha_enterprise",
      "turnstile",
      "hcaptcha",
      "geetest",
      "funcaptcha",
      "image_letters",
      "knowledge_question",
    ]);
  });

  it("posts enterprise, GeeTest and FunCaptcha on the HTTPS door and accepts a deployment key", async () => {
    const emulator = new CaptellEmulator([
      captellCues.tokenSolved(),
      captellCues.tokenSolved(),
      captellCues.tokenSolved(),
    ]);
    const client = new CaptellHttpSolver({
      token: async () => "deployment-key-unlimited-1",
      fetch: emulator.fetch,
      baseUrl: "https://captell.example",
      maxRetries: 0,
    });
    await client.solve(
      {
        type: "recaptcha_enterprise",
        websiteURL: "https://board.example/register",
        websiteKey: "ent-1",
      },
      context,
    );
    await client.solve(
      { type: "geetest", websiteURL: "https://board.example/register", websiteKey: "gt-1" },
      context,
    );
    await client.solve(
      { type: "funcaptcha", websiteURL: "https://board.example/register", websiteKey: "pk-1" },
      context,
    );
    expect(emulator.requests.map((request) => request.body)).toEqual([
      {
        type: "RecaptchaV2Enterprise",
        websiteURL: "https://board.example/register",
        websiteKey: "ent-1",
      },
      { type: "GeeTest", websiteURL: "https://board.example/register", gt: "gt-1" },
      {
        type: "FunCaptcha",
        websiteURL: "https://board.example/register",
        websitePublicKey: "pk-1",
      },
    ]);
    expect(emulator.requests[0]?.authorization).toBe("Bearer deployment-key-unlimited-1");
    const refused = new CaptellEmulator();
    await expect(
      new CaptellHttpSolver({
        token: async () => "short",
        fetch: refused.fetch,
        baseUrl: "https://captell.example",
        maxRetries: 0,
      }).solve(
        { type: "geetest", websiteURL: "https://board.example/register", websiteKey: "gt-1" },
        context,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(refused.requests).toHaveLength(0);
  });

  it("posts ImageToText and widget solves with the bearer token and never the image when it is tiny", async () => {
    const emulator = new CaptellEmulator([captellCues.imageSolved(), captellCues.tokenSolved()]);
    const client = solver(emulator);
    const image = await client.solve({ type: "ImageToText", imagePng: png }, context);
    expect(image).toEqual({ answer: "K7XQ2", credits: 4, balance: 996, taskId: "task_image" });
    const token = await client.solve(
      {
        type: "recaptcha_v2",
        websiteURL: "https://board.example/register",
        websiteKey: "site-key-1",
      },
      context,
    );
    expect(token.taskId).toBe("task_token");
    expect(emulator.requests).toHaveLength(2);
    expect(emulator.requests[0]).toMatchObject({
      method: "POST",
      url: "https://captell.example/api/v1/solve",
      authorization: `Bearer ${TOKEN}`,
      body: { type: "ImageToText", body: Buffer.from(png).toString("base64") },
    });
    expect(emulator.requests[1]?.body).toEqual({
      type: "RecaptchaV2",
      websiteURL: "https://board.example/register",
      websiteKey: "site-key-1",
    });
    expect(JSON.stringify(emulator.requests[1]?.body)).not.toContain(TOKEN);

    const blocked = new CaptellEmulator();
    const tiny = new Uint8Array(MIN_CAPTCHA_IMAGE_BYTES - 1);
    await expect(
      solver(blocked).solve({ type: "ImageToText", imagePng: tiny }, context),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(blocked.requests).toHaveLength(0);
    await blocked.fetch("https://captell.example/api/v1/solve", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ImageToText", body: Buffer.from(tiny).toString("base64") }),
    });
    expect(blocked.requests).toHaveLength(0);
  });

  it("maps every documented failure and treats a sandbox label as a hard failure", async () => {
    const cases: Array<{
      cue: ReturnType<typeof captellCues.notRead>;
      code: string;
      retryable: boolean;
    }> = [
      { cue: captellCues.notRead(), code: "not_read", retryable: false },
      { cue: captellCues.noToken(), code: "no_token", retryable: true },
      { cue: captellCues.missingSiteKey(), code: "missing_site_key", retryable: false },
      { cue: captellCues.unsupported(), code: "unsupported", retryable: false },
      { cue: captellCues.refused(), code: "refused", retryable: false },
      { cue: captellCues.credits(), code: "credits", retryable: false },
      { cue: captellCues.sandbox("sandbox-token-value"), code: "sandbox", retryable: false },
      { cue: captellCues.serverError(), code: "error", retryable: true },
    ];
    for (const entry of cases) {
      const emulator = new CaptellEmulator([entry.cue]);
      const error = await solver(emulator)
        .solve({ type: "ImageToText", imagePng: png }, context)
        .then(
          () => null,
          (caught: unknown) => caught,
        );
      expect(error).toBeInstanceOf(CaptchaSolverError);
      expect(error).toMatchObject({ code: entry.code, retryable: entry.retryable });
      expect(error instanceof Error ? error.message : "").not.toContain("sandbox-token-value");
      expect(error instanceof Error ? error.message : "").not.toContain(TOKEN);
    }

    const answered = solver(new CaptellEmulator([captellCues.couldNotAnswer()]));
    await expect(
      answered.answerQuestion({ question: "Wie heißt die Hauptstadt?" }, context),
    ).resolves.toEqual({
      couldNotAnswer: true,
    });
    const known = solver(new CaptellEmulator([{ op: "answer", body: { answer: "Berlin" } }]));
    await expect(known.answerQuestion({ question: "2+2" }, context)).resolves.toEqual({
      answer: "Berlin",
    });
  });

  it("retries a transient 5xx inside the budget and then stops", async () => {
    const emulator = new CaptellEmulator([
      { ...captellCues.serverError(), times: 2 },
      captellCues.imageSolved(),
    ]);
    const client = solver(emulator, { maxRetries: 2 });
    await expect(
      client.solve({ type: "ImageToText", imagePng: png }, context),
    ).resolves.toMatchObject({
      answer: "K7XQ2",
    });
    expect(emulator.requests).toHaveLength(3);

    const down = new CaptellEmulator([{ ...captellCues.network("balance"), times: 3 }]);
    await expect(solver(down, { maxRetries: 2 }).balance(context)).rejects.toMatchObject({
      code: "error",
      retryable: false,
    });
    expect(down.requests).toHaveLength(3);
  });

  it("reads the balance and refuses a sandbox-labelled balance", async () => {
    const emulator = new CaptellEmulator([captellCues.balance(42)]);
    await expect(solver(emulator).balance(context)).resolves.toEqual({ credits: 42 });
    expect(emulator.requests[0]).toMatchObject({
      method: "GET",
      url: "https://captell.example/api/v1/balance",
      authorization: `Bearer ${TOKEN}`,
    });
    const sand = new CaptellEmulator([{ op: "balance", body: { credits: 1, sandbox: true } }]);
    await expect(solver(sand).balance(context)).rejects.toMatchObject({
      code: "sandbox",
      retryable: false,
    });
  });

  it("does not put the token in an error when the call cannot leave the machine", async () => {
    const client = new CaptellHttpSolver({
      token: async () => TOKEN,
      fetch: async () => {
        throw new Error(`connect ${TOKEN} failed`);
      },
      baseUrl: "https://captell.example",
      maxRetries: 0,
    });
    await expect(client.balance(context)).rejects.toMatchObject({ code: "error", retryable: true });
    try {
      await client.balance(context);
    } catch (error) {
      expect(error instanceof Error ? error.message : "").not.toContain(TOKEN);
    }
  });
});
