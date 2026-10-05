import {
  type AdapterContext,
  type AdapterDescriptor,
  type CaptchaBalance,
  CaptchaBalanceSchema,
  type CaptchaQuestionRequest,
  CaptchaQuestionRequestSchema,
  type CaptchaQuestionResult,
  type CaptchaSolveRequest,
  type CaptchaSolveResult,
  CaptchaSolveResultSchema,
  type CaptchaSolver,
  type CaptchaSolverCapabilities,
  CaptchaSolverError,
  type CaptchaType,
  parseCaptchaSolveRequest,
  type TokenCaptchaType,
} from "@rakazo/adapter-kit";
import { z } from "zod";

/*
 * Captell HTTPS adapter. The bearer token is read per call and is never written into
 * errors, URLs or logs. The worker does not use the Captell MCP endpoint.
 */

export const CAPTELL_DEFAULT_BASE_URL = "https://captell.run";

const SUPPORTS: CaptchaType[] = [
  "recaptcha_v2",
  "recaptcha_v3",
  "recaptcha_enterprise",
  "turnstile",
  "hcaptcha",
  "image_letters",
  "knowledge_question",
];

const SOLVE_TYPE: Record<TokenCaptchaType, string> = {
  recaptcha_v2: "RecaptchaV2",
  recaptcha_v3: "RecaptchaV3",
  recaptcha_enterprise: "RecaptchaEnterprise",
  turnstile: "Turnstile",
  hcaptcha: "HCaptcha",
};

const SolveBodySchema = z.object({
  taskId: z.string().min(1),
  answer: z.string().min(1),
  credits: z.number().int().min(0),
  balance: z.number().int(),
  sandbox: z.union([z.boolean(), z.string()]).optional(),
  label: z.string().optional(),
});

const AnswerBodySchema = z.object({
  answer: z.string().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
  sandbox: z.union([z.boolean(), z.string()]).optional(),
  label: z.string().optional(),
});

export interface CaptellHttpSolverOptions {
  /** Plaintext token, loaded from the encrypted store on every call. */
  token: (context: AdapterContext) => Promise<string>;
  /** Receives the plaintext so the caller can redact it. The solver does not store it. */
  onToken?: (token: string) => void;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  /** Extra attempts after the first for network failures and HTTP 5xx. */
  maxRetries?: number;
  retryDelayMs?: number;
}

export class CaptellHttpSolver implements CaptchaSolver {
  private readonly token: CaptellHttpSolverOptions["token"];
  private readonly onToken: ((token: string) => void) | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(options: CaptellHttpSolverOptions) {
    this.token = options.token;
    this.onToken = options.onToken;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseUrl = (options.baseUrl ?? CAPTELL_DEFAULT_BASE_URL).replace(/\/$/, "");
    if (!this.baseUrl.startsWith("https://")) {
      throw new CaptchaSolverError("invalid_request", "Captell base URL must be https");
    }
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 0;
  }

  describe(): AdapterDescriptor<CaptchaSolverCapabilities> {
    return {
      id: "captell-http",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { supports: [...SUPPORTS] },
    };
  }

  async balance(context: AdapterContext): Promise<CaptchaBalance> {
    const { status, json } = await this.call(context, "/api/v1/balance", { method: "GET" });
    assertNoSandbox(json);
    if (status >= 400) throw failure(status, json);
    const parsed = CaptchaBalanceSchema.safeParse(json);
    if (!parsed.success) throw new CaptchaSolverError("error", "error", { retryable: false });
    return parsed.data;
  }

  async solve(request: CaptchaSolveRequest, context: AdapterContext): Promise<CaptchaSolveResult> {
    const parsed = parseCaptchaSolveRequest(request);
    const payload =
      parsed.type === "ImageToText"
        ? { type: "ImageToText", body: Buffer.from(parsed.imagePng).toString("base64") }
        : {
            type: SOLVE_TYPE[parsed.type],
            websiteURL: parsed.websiteURL,
            websiteKey: parsed.websiteKey,
          };
    const { status, json } = await this.call(context, "/api/v1/solve", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    assertNoSandbox(json);
    if (status >= 400 || hasError(json)) throw failure(status, json);
    const body = SolveBodySchema.safeParse(json);
    if (!body.success) throw new CaptchaSolverError("error", "error", { retryable: false });
    return CaptchaSolveResultSchema.parse({
      answer: body.data.answer,
      credits: body.data.credits,
      balance: body.data.balance,
      taskId: body.data.taskId,
    });
  }

  async answerQuestion(
    request: CaptchaQuestionRequest,
    context: AdapterContext,
  ): Promise<CaptchaQuestionResult> {
    const parsed = CaptchaQuestionRequestSchema.parse(request);
    const { status, json } = await this.call(context, "/api/v1/answer", {
      method: "POST",
      body: JSON.stringify(parsed),
    });
    assertNoSandbox(json);
    const text = errorText(json);
    if (/could not answer/i.test(text)) return { couldNotAnswer: true };
    if (status >= 400 || hasError(json)) throw failure(status, json);
    const body = AnswerBodySchema.safeParse(json);
    if (!body.success || !body.data.answer) return { couldNotAnswer: true };
    return { answer: body.data.answer };
  }

  private async call(
    context: AdapterContext,
    path: string,
    init: { method: string; body?: string },
  ): Promise<{ status: number; json: unknown }> {
    const token = await this.token(context);
    this.onToken?.(token);
    if (!/^ct_live_[A-Za-z0-9_-]{8,120}$/.test(token)) {
      throw new CaptchaSolverError("invalid_request", "invalid_request");
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    if (init.body) headers["Content-Type"] = "application/json";
    let lastTransient = false;
    const attempts = this.maxRetries + 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (context.signal.aborted) {
        throw new CaptchaSolverError("error", "error", { retryable: false });
      }
      try {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method: init.method,
          headers,
          body: init.body,
          redirect: "error",
          signal: AbortSignal.any([context.signal, AbortSignal.timeout(this.timeoutMs)]),
        });
        const json = await readJson(response);
        if (response.status >= 500) {
          lastTransient = true;
          if (attempt < attempts - 1) {
            await delay(this.retryDelayMs);
            continue;
          }
          throw new CaptchaSolverError("error", "error", { retryable: this.maxRetries === 0 });
        }
        return { status: response.status, json };
      } catch (error) {
        if (error instanceof CaptchaSolverError) throw error;
        lastTransient = true;
        if (attempt < attempts - 1) {
          await delay(this.retryDelayMs);
        }
      }
    }
    throw new CaptchaSolverError("error", "error", {
      retryable: lastTransient && this.maxRetries === 0,
    });
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: "error" };
  }
}

function hasError(json: unknown): boolean {
  return errorText(json).length > 0;
}

function errorText(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const record = json as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  if (record.error && typeof record.error === "object") {
    const inner = record.error as Record<string, unknown>;
    if (typeof inner.message === "string") return inner.message;
    if (typeof inner.code === "string") return inner.code;
  }
  if (typeof record.message === "string") return record.message;
  return "";
}

function isSandbox(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const record = json as Record<string, unknown>;
  return record.sandbox === true || record.sandbox === "sandbox" || record.label === "sandbox";
}

function assertNoSandbox(json: unknown): void {
  if (isSandbox(json)) {
    throw new CaptchaSolverError("sandbox", "sandbox", { retryable: false });
  }
}

function failure(status: number, json: unknown): CaptchaSolverError {
  const text = errorText(json).toLowerCase();
  if (/not read/.test(text))
    return new CaptchaSolverError("not_read", "not_read", { retryable: false });
  if (/no token/.test(text))
    return new CaptchaSolverError("no_token", "no_token", { retryable: true });
  if (/missing site key/.test(text)) {
    return new CaptchaSolverError("missing_site_key", "missing_site_key", { retryable: false });
  }
  if (/unsupported/.test(text)) {
    return new CaptchaSolverError("unsupported", "unsupported", { retryable: false });
  }
  if (/not enough credits|insufficient credits/.test(text) || status === 402) {
    return new CaptchaSolverError("credits", "credits", { retryable: false });
  }
  if (/refus/.test(text) || status === 401 || status === 403) {
    return new CaptchaSolverError("refused", "refused", { retryable: false });
  }
  if (status === 400 || status === 422) {
    return new CaptchaSolverError("invalid_request", "invalid_request", { retryable: false });
  }
  return new CaptchaSolverError("error", "error", { retryable: false });
}

function delay(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}
