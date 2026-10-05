import {
  LbCaptchaTypeSchema,
  LbLanguageSchema,
  LbModelLaneSchema,
  LbProxyKindSchema,
  LbTokenCaptchaTypeSchema,
} from "@rakazo/contracts";
import { z } from "zod";
import type { AdapterContext, AdapterDescriptor } from "./types.js";

/** Reference to a value in the encrypted secret store. Contracts never carry plaintext. */
export const SecretRefSchema = z.object({ secretId: z.string().min(1) }).strict();
export type SecretRef = z.infer<typeof SecretRefSchema>;

export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/, "Expected ISO 3166-1 alpha-2");
export type CountryCode = "DE" | "AT" | "CH" | (string & {});

export const ProxyKindSchema = LbProxyKindSchema;
export type ProxyKind = z.infer<typeof ProxyKindSchema>;

export const ProxyEndpointSchema = z
  .object({
    id: z.string().min(1),
    country: CountryCodeSchema,
    /** `host:port`; the address is not a credential, the username and password are. */
    server: z.string().regex(/^[^\s:/@]+:\d{1,5}$/, "Expected host:port"),
    username: SecretRefSchema.optional(),
    password: SecretRefSchema.optional(),
    kind: ProxyKindSchema,
    renewsAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export type ProxyEndpoint = z.infer<typeof ProxyEndpointSchema>;

export const ProxyPersonaSchema = z.object({
  projectId: z.string().min(1),
  country: CountryCodeSchema,
  kind: ProxyKindSchema.default("static_isp"),
});
export type ProxyPersona = z.input<typeof ProxyPersonaSchema>;

export interface ProxyProviderCapabilities {
  countries: CountryCode[];
  kinds: ProxyKind[];
  /** The same endpoint is returned for a persona for the life of its lease. */
  sticky: boolean;
}

export interface ProxyProvider {
  describe(): AdapterDescriptor<ProxyProviderCapabilities>;
  lease(persona: ProxyPersona, context: AdapterContext): Promise<ProxyEndpoint>;
  renew(id: string, context: AdapterContext): Promise<ProxyEndpoint>;
  release(id: string, context: AdapterContext): Promise<void>;
}

export const BrowserPersonaSchema = z.object({
  projectId: z.string().min(1),
  /** Stable key of the persistent profile directory for this persona. */
  profileKey: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
  proxy: ProxyEndpointSchema.optional(),
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  timezoneId: z.string().min(1),
  extensionPaths: z.array(z.string().min(1)).optional(),
});
export type BrowserPersona = z.infer<typeof BrowserPersonaSchema>;

export interface BrowserSessionCapabilities {
  extensions: boolean;
  persistentProfile: boolean;
  liveScreen: boolean;
}

/**
 * The page operations board drivers need. Selectors are CSS selectors resolved against the
 * current page; implementations must not log, trace or return text filled with `secret: true`.
 */
export interface BrowserSession {
  readonly id: string;
  goto(url: string): Promise<void>;
  url(): Promise<string>;
  fill(selector: string, text: string, options?: { secret?: boolean }): Promise<void>;
  click(selector: string): Promise<void>;
  /** Visible text of the first match, or null when nothing matches. */
  text(selector: string): Promise<string | null>;
  exists(selector: string): Promise<boolean>;
  attribute(selector: string, name: string): Promise<string | null>;
  /** Tight PNG of the first match, used for image captchas instead of a full screenshot. */
  elementScreenshotPng(selector: string): Promise<Uint8Array>;
  pageText(): Promise<string>;
  /** Resolves true once the selector matches, false when the timeout elapses first. */
  waitFor(selector: string, options: { timeoutMs: number }): Promise<boolean>;
  screenshotPng(): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface BrowserSessionProvider {
  describe(): AdapterDescriptor<BrowserSessionCapabilities>;
  open(persona: BrowserPersona, context: AdapterContext): Promise<BrowserSession>;
}

export const CaptchaTypeSchema = LbCaptchaTypeSchema;
export type CaptchaType = z.infer<typeof CaptchaTypeSchema>;
export const TokenCaptchaTypeSchema = LbTokenCaptchaTypeSchema;
export type TokenCaptchaType = z.infer<typeof TokenCaptchaTypeSchema>;

/** The primary solver refuses images below this size, so the contract rejects them up front. */
export const MIN_CAPTCHA_IMAGE_BYTES = 100;

export const ImageToTextRequestSchema = z.object({
  type: z.literal("ImageToText"),
  imagePng: z
    .custom<Uint8Array>((value) => value instanceof Uint8Array, "Expected PNG bytes")
    .refine((bytes) => bytes.byteLength >= MIN_CAPTCHA_IMAGE_BYTES, {
      message: `Captcha image must be at least ${MIN_CAPTCHA_IMAGE_BYTES} bytes; re-crop with padding`,
    }),
});
export type ImageToTextRequest = z.infer<typeof ImageToTextRequestSchema>;

export const TokenRequestSchema = z.object({
  type: TokenCaptchaTypeSchema,
  websiteURL: z.url({ protocol: /^https?$/ }),
  websiteKey: z.string().min(1),
});
export type TokenRequest = z.infer<typeof TokenRequestSchema>;

export const CaptchaSolveRequestSchema = z.union([ImageToTextRequestSchema, TokenRequestSchema]);
export type CaptchaSolveRequest = ImageToTextRequest | TokenRequest;

export const CaptchaSolveResultSchema = z.object({
  answer: z.string().min(1),
  credits: z.number().int().min(0),
  balance: z.number().int(),
  taskId: z.string().min(1),
});
export type CaptchaSolveResult = z.infer<typeof CaptchaSolveResultSchema>;

export const CaptchaQuestionRequestSchema = z
  .object({ question: z.string().min(1).optional(), pageText: z.string().min(1).optional() })
  .refine((request) => request.question !== undefined || request.pageText !== undefined, {
    message: "Provide question or pageText",
  });
export type CaptchaQuestionRequest = z.infer<typeof CaptchaQuestionRequestSchema>;

export const CaptchaQuestionResultSchema = z.union([
  z.object({ answer: z.string().min(1) }).strict(),
  z.object({ couldNotAnswer: z.literal(true) }).strict(),
]);
export type CaptchaQuestionResult = { answer: string } | { couldNotAnswer: true };

export const CaptchaBalanceSchema = z.object({ credits: z.number().int() });
export type CaptchaBalance = z.infer<typeof CaptchaBalanceSchema>;

export type CaptchaSolverErrorCode =
  | "invalid_request"
  | "not_read"
  | "no_token"
  | "missing_site_key"
  | "unsupported"
  | "credits"
  | "refused"
  | "sandbox"
  | "error";

/** Typed solver failure; `retryable` means another attempt on the same captcha may succeed. */
export class CaptchaSolverError extends Error {
  readonly code: CaptchaSolverErrorCode;
  readonly retryable: boolean;

  constructor(code: CaptchaSolverErrorCode, message?: string) {
    super(message ?? code);
    this.name = "CaptchaSolverError";
    this.code = code;
    this.retryable = code === "not_read" || code === "no_token" || code === "error";
  }
}

export interface CaptchaSolverCapabilities {
  supports: CaptchaType[];
}

export interface CaptchaSolver {
  describe(): AdapterDescriptor<CaptchaSolverCapabilities>;
  balance(context: AdapterContext): Promise<CaptchaBalance>;
  solve(request: CaptchaSolveRequest, context: AdapterContext): Promise<CaptchaSolveResult>;
  answerQuestion(
    request: CaptchaQuestionRequest,
    context: AdapterContext,
  ): Promise<CaptchaQuestionResult>;
}

/** Validates a solve request before any adapter spends credits on it. */
export function parseCaptchaSolveRequest(request: unknown): CaptchaSolveRequest {
  const parsed = CaptchaSolveRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new CaptchaSolverError("invalid_request", parsed.error.issues[0]?.message);
  }
  return parsed.data;
}

export const WebSearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  country: CountryCodeSchema,
  language: LbLanguageSchema,
  /** Number of results requested; adapters may return fewer. */
  depth: z.number().int().min(1).max(100).default(10),
});
export type WebSearchRequest = z.input<typeof WebSearchRequestSchema>;

export const WebSearchResultSchema = z.object({
  url: z.url({ protocol: /^https?$/ }),
  title: z.string(),
  snippet: z.string(),
  domain: z.string().min(1),
  publishedAt: z.string().datetime({ offset: true }).optional(),
});
export type WebSearchResult = z.infer<typeof WebSearchResultSchema>;

export interface SearchProviderCapabilities {
  maxDepth: number;
  /** Supports `inurl:` style footprint operators. */
  operators: boolean;
}

export interface SearchProvider {
  describe(): AdapterDescriptor<SearchProviderCapabilities>;
  search(request: WebSearchRequest, context: AdapterContext): Promise<WebSearchResult[]>;
}

export const MailboxInboxSchema = z.object({
  inboxId: z.string().min(1),
  address: z.email(),
});
export type MailboxInbox = z.infer<typeof MailboxInboxSchema>;

export const InboundMailSchema = z.object({
  inboxId: z.string().min(1),
  from: z.string().min(1),
  subject: z.string(),
  textBody: z.string(),
  htmlBody: z.string().optional(),
  receivedAt: z.string().datetime({ offset: true }),
});
export type InboundMail = z.infer<typeof InboundMailSchema>;

export interface MailboxProviderCapabilities {
  inbound: "webhook" | "poll";
}

export interface MailboxProvider {
  describe(): AdapterDescriptor<MailboxProviderCapabilities>;
  /** Idempotent: returns the existing inbox for a project when one exists. */
  ensureInbox(projectId: string, context: AdapterContext): Promise<MailboxInbox>;
}

export const ModelLaneSchema = LbModelLaneSchema;
export type ModelLane = z.infer<typeof ModelLaneSchema>;

export interface TextModelRequest<T> {
  lane: ModelLane;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens: number;
}

export interface TextModelTokens {
  input: number;
  output: number;
}

export type TextModelFailureReason = "refusal" | "schema" | "error";

export type TextModelResult<T> =
  | { ok: true; value: T; modelId: string; tokens: TextModelTokens }
  | { ok: false; reason: TextModelFailureReason; raw?: string; modelId: string };

export interface TextModelCapabilities {
  lanes: ModelLane[];
  structuredOutput: boolean;
}

export interface TextModel {
  describe(): AdapterDescriptor<TextModelCapabilities>;
  complete<T>(request: TextModelRequest<T>, context: AdapterContext): Promise<TextModelResult<T>>;
}

export const LINK_BUILDER_CONTRACT_VERSION = "1";
