import * as z from "zod";
import { Id, IsoDate } from "./ids.js";

/*
 * Link Builder shared vocabulary. Prisma stores these as String / Json columns; the SQL
 * migration mirrors every enum below as a CHECK constraint, so changing a list here needs a
 * migration too (packages/db/prisma/migrations/*_link_builder).
 */

export const LbProjectStatusSchema = z.enum(["draft", "active", "paused", "stopped", "archived"]);
export type LbProjectStatus = z.infer<typeof LbProjectStatusSchema>;

export const LbHostStatusSchema = z.enum([
  "discovered",
  "probed",
  "qualified",
  "registering",
  "pending_email",
  "pending_admin",
  "warming",
  "ready",
  "used",
  "denied",
  "spam_blocked",
  "unsupported_captcha",
  "parked_operator",
  "dead",
]);
export type LbHostStatus = z.infer<typeof LbHostStatusSchema>;

/** Statuses a host can be parked from for an operator and resumed back into. */
export const LbParkableHostStatusSchema = LbHostStatusSchema.extract([
  "qualified",
  "registering",
  "pending_email",
  "pending_admin",
  "warming",
  "ready",
]);
export type LbParkableHostStatus = z.infer<typeof LbParkableHostStatusSchema>;

export const LbHostPlatformSchema = z.enum([
  "phpbb",
  "woltlab",
  "xenforo",
  "ips",
  "vbulletin",
  "mybb",
  "discourse",
  "flarum",
  "nodebb",
  "vanilla",
  "qa_other",
  "unknown",
]);
export type LbHostPlatform = z.infer<typeof LbHostPlatformSchema>;

export const LbHrefForNewMembersSchema = z.enum(["yes", "after_n_posts", "no", "unknown"]);
export type LbHrefForNewMembers = z.infer<typeof LbHrefForNewMembersSchema>;

export const LbRelDefaultSchema = z.enum(["follow", "nofollow", "ugc", "unknown"]);
export type LbRelDefault = z.infer<typeof LbRelDefaultSchema>;

export const LbRunStatusSchema = z.enum([
  "queued",
  "running",
  "paused",
  "overtime",
  "succeeded",
  "partial",
  "failed",
  "cancelled",
]);
export type LbRunStatus = z.infer<typeof LbRunStatusSchema>;

export const LbPlacementStatusSchema = z.enum([
  "pending",
  "live",
  "nofollow_live",
  "dead",
  "removed",
]);
export type LbPlacementStatus = z.infer<typeof LbPlacementStatusSchema>;

export const LbVerifyMethodSchema = z.enum(["logged_out_fetch", "logged_out_browser"]);
export type LbVerifyMethod = z.infer<typeof LbVerifyMethodSchema>;

export const LbThreadStatusSchema = z.enum(["candidate", "selected", "posted", "rejected"]);
export type LbThreadStatus = z.infer<typeof LbThreadStatusSchema>;

export const LbDraftStatusSchema = z.enum(["drafted", "approved", "posted", "discarded"]);
export type LbDraftStatus = z.infer<typeof LbDraftStatusSchema>;

export const LbLinkSlotSchema = z.enum(["none", "inline", "signature"]);
export type LbLinkSlot = z.infer<typeof LbLinkSlotSchema>;

export const LbModelLaneSchema = z.enum(["draft", "classify", "fallback"]);
export type LbModelLane = z.infer<typeof LbModelLaneSchema>;

export const LbCaptchaTypeSchema = z.enum([
  "recaptcha_v2",
  "recaptcha_v3",
  "recaptcha_enterprise",
  "turnstile",
  "hcaptcha",
  "image_letters",
  "knowledge_question",
  "security_check_label",
  "unsupported",
]);
export type LbCaptchaType = z.infer<typeof LbCaptchaTypeSchema>;

/** Widget captchas answered with a token for a site key. */
export const LbTokenCaptchaTypeSchema = LbCaptchaTypeSchema.extract([
  "recaptcha_v2",
  "recaptcha_v3",
  "recaptcha_enterprise",
  "turnstile",
  "hcaptcha",
]);
export type LbTokenCaptchaType = z.infer<typeof LbTokenCaptchaTypeSchema>;

export const LbCaptchaDoorSchema = z.enum(["https_api", "page_helper", "userscript", "operator"]);
export type LbCaptchaDoor = z.infer<typeof LbCaptchaDoorSchema>;

export const LbHumanCheckboxStateSchema = z.enum(["checked", "empty", "none"]);
export type LbHumanCheckboxState = z.infer<typeof LbHumanCheckboxStateSchema>;

export const LbCaptchaOutcomeSchema = z.enum([
  "placed_submitted",
  "no_token",
  "missing_site_key",
  "unsupported",
  "credits",
  "operator_parked",
  "operator_solved",
  "expired",
  "sandbox",
]);
export type LbCaptchaOutcome = z.infer<typeof LbCaptchaOutcomeSchema>;

export const LbOperatorTicketReasonSchema = z.enum([
  "captcha_unsolved",
  "two_factor",
  "missing_password",
  "admin_approval",
  "unknown_page_state",
]);
export type LbOperatorTicketReason = z.infer<typeof LbOperatorTicketReasonSchema>;

export const LbOperatorTicketStatusSchema = z.enum(["open", "resolved", "expired", "skipped"]);
export type LbOperatorTicketStatus = z.infer<typeof LbOperatorTicketStatusSchema>;

export const LbDisclosureModeSchema = z.enum([
  "undisclosed_persona",
  "disclosed_persona",
  "disclosed_brand",
  "drafts_only",
]);
export type LbDisclosureMode = z.infer<typeof LbDisclosureModeSchema>;

export const LbGeoPolicySchema = z.enum(["dach_first", "en_fallback", "en_only"]);
export type LbGeoPolicy = z.infer<typeof LbGeoPolicySchema>;

export const LbProxyPolicySchema = z.enum(["static_isp_per_persona", "none"]);
export type LbProxyPolicy = z.infer<typeof LbProxyPolicySchema>;

export const LbProxyKindSchema = z.enum(["static_isp", "residential", "datacenter"]);
export type LbProxyKind = z.infer<typeof LbProxyKindSchema>;

export const LbProxyLeaseStatusSchema = z.enum(["active", "released", "expired"]);
export type LbProxyLeaseStatus = z.infer<typeof LbProxyLeaseStatusSchema>;

export const LbRegionSchema = z.enum(["DE", "AT", "CH"]);
export type LbRegion = z.infer<typeof LbRegionSchema>;

export const LbLanguageSchema = z.enum(["de", "en"]);
export type LbLanguage = z.infer<typeof LbLanguageSchema>;

export const LbRegisterSchema = z.enum(["du", "sie"]);
export type LbRegister = z.infer<typeof LbRegisterSchema>;

/** Spam-filter rejections seen after a real submit; exactly one retry, then `spam_blocked`. */
export const LB_DEFAULT_SPAM_SENTENCES = [
  "Die Registrierung ist wegen Spamschutzmaßnahmen fehlgeschlagen.",
  "No soup for you!",
] as const;

export const LB_RESPONSIBILITY_ACK_TEXT_VERSION = "2026-10-05";

const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

function clockMinutes(value: string): number {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const RegistrableDomain = z
  .string()
  .min(3)
  .max(253)
  .regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Expected a lowercase registrable domain");

export const LbPersonaSchema = z.object({
  displayName: z.string().trim().min(1).max(60),
  bio: z.string().max(500).default(""),
  language: LbLanguageSchema.default("de"),
  register: LbRegisterSchema.default("du"),
  region: LbRegionSchema.default("DE"),
  /** Only used by the disclosed modes; empty in the default undisclosed mode. */
  disclosureText: z.string().max(200).optional(),
});
export type LbPersona = z.infer<typeof LbPersonaSchema>;

export const LbQuotasSchema = z
  .object({
    newPerDay: z.number().int().min(0).max(50),
    livePerDay: z.number().int().min(0).max(50),
    liveWeekCap: z.number().int().min(0).max(250).optional(),
    /** Fixed at one counted LIVE link per host in v1; the partial unique index enforces it. */
    maxLivePerHost: z.literal(1).default(1),
  })
  .refine((quotas) => quotas.liveWeekCap === undefined || quotas.liveWeekCap >= quotas.livePerDay, {
    message: "liveWeekCap must be at least livePerDay",
    path: ["liveWeekCap"],
  });
export type LbQuotas = z.infer<typeof LbQuotasSchema>;

export const LbScheduleSchema = z
  .object({
    timezone: z.string().refine(isValidTimeZone, "Unknown IANA time zone"),
    weekdaysOnly: z.boolean().default(true),
    window: z
      .object({ start: ClockTime, end: ClockTime })
      .default({ start: "09:00", end: "22:00" })
      .refine((window) => clockMinutes(window.start) < clockMinutes(window.end), {
        message: "Window must start before it ends on the same day",
      }),
    overtimeUntilLiveMet: z.boolean().default(false),
    /** Local hour (exclusive) at which overtime stops; 24 means midnight. */
    hardStopHour: z.number().int().min(1).max(24).default(24),
  })
  .refine((schedule) => schedule.hardStopHour * 60 >= clockMinutes(schedule.window.end), {
    message: "hardStopHour must not be before the window end",
    path: ["hardStopHour"],
  });
export type LbSchedule = z.infer<typeof LbScheduleSchema>;

export const LbTopicLaneSchema = z.object({
  id: Id,
  tag: z.string().trim().min(1).max(40),
  description: z.string().max(500),
  exampleQuestions: z.array(z.string().max(300)).max(20).default([]),
});
export type LbTopicLane = z.infer<typeof LbTopicLaneSchema>;

export const LbTargetSchema = z.object({
  url: z.url({ protocol: /^https?$/ }),
  priority: z.number().int().min(1).max(100).default(50),
  description: z.string().max(300).default(""),
  keywordClusters: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
});
export type LbTarget = z.infer<typeof LbTargetSchema>;

export const LbLinkRatioSchema = z
  .object({ links: z.number().int().min(0), posts: z.number().int().min(1) })
  .refine((ratio) => ratio.links <= ratio.posts, { message: "links must not exceed posts" });
export type LbLinkRatio = z.infer<typeof LbLinkRatioSchema>;
export const LB_DEFAULT_LINK_RATIO: LbLinkRatio = { links: 1, posts: 3 };

export const LbWarmupSchema = z.object({
  minPostsBeforeLink: z.number().int().min(0).max(20).default(2),
  minAccountAgeHours: z
    .number()
    .int()
    .min(0)
    .max(24 * 30)
    .default(24),
});
export type LbWarmup = z.infer<typeof LbWarmupSchema>;

export const LbSpamRetrySchema = z.object({
  maxRetries: z.literal(1).default(1),
  sentences: z.array(z.string().trim().min(1).max(300)).default([...LB_DEFAULT_SPAM_SENTENCES]),
});
export type LbSpamRetry = z.infer<typeof LbSpamRetrySchema>;

export const LbContentSchema = z.object({
  toneNotes: z.string().max(1000).default(""),
  bannedClaims: z.array(z.string().trim().min(1).max(200)).max(200).default([]),
  maxReplyChars: z.number().int().min(200).max(10_000).default(1200),
});
export type LbContent = z.infer<typeof LbContentSchema>;

export const LbNotificationChannelSchema = z.enum(["push", "email"]);
export type LbNotificationChannel = z.infer<typeof LbNotificationChannelSchema>;

export const LbOperatorSettingsSchema = z.object({
  parkedHostTtlHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 14)
    .default(48),
  channels: z.array(LbNotificationChannelSchema).default(["push", "email"]),
});
export type LbOperatorSettings = z.infer<typeof LbOperatorSettingsSchema>;

/** Recorded when the customer clicks Start building; never shown in posts or profiles. */
export const LbResponsibilityAckSchema = z.object({
  acceptedAt: IsoDate,
  acceptedByUserId: Id,
  textVersion: z.string().min(1),
});
export type LbResponsibilityAck = z.infer<typeof LbResponsibilityAckSchema>;

/** Every config field a project carries, validated before it is persisted or started. */
export const LbProjectConfigSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  brandName: z.string().trim().min(1).max(80),
  allowedDomains: z.array(RegistrableDomain).min(1).max(20),
  persona: LbPersonaSchema,
  mailboxId: Id.optional(),
  captchaSecretId: Id.optional(),
  captchaLowBalanceCredits: z.number().int().min(0).default(500),
  quotas: LbQuotasSchema,
  schedule: LbScheduleSchema,
  topicLanes: z.array(LbTopicLaneSchema).max(20).default([]),
  geoPolicy: LbGeoPolicySchema.default("dach_first"),
  disclosureMode: LbDisclosureModeSchema.default("undisclosed_persona"),
  linkRatio: LbLinkRatioSchema.default(LB_DEFAULT_LINK_RATIO),
  proxyPolicy: LbProxyPolicySchema.default("static_isp_per_persona"),
  countNofollow: z.boolean().default(true),
  targets: z.array(LbTargetSchema).max(100).default([]),
  facts: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  denyHosts: z.array(RegistrableDomain).max(500).default([]),
  preferHosts: z.array(RegistrableDomain).max(500).default([]),
  warmup: LbWarmupSchema.default({ minPostsBeforeLink: 2, minAccountAgeHours: 24 }),
  spamRetry: LbSpamRetrySchema.default({
    maxRetries: 1,
    sentences: [...LB_DEFAULT_SPAM_SENTENCES],
  }),
  content: LbContentSchema.default({ toneNotes: "", bannedClaims: [], maxReplyChars: 1200 }),
  operator: LbOperatorSettingsSchema.default({
    parkedHostTtlHours: 48,
    channels: ["push", "email"],
  }),
});
export type LbProjectConfig = z.infer<typeof LbProjectConfigSchema>;
export type LbProjectConfigInput = z.input<typeof LbProjectConfigSchema>;

/** Fields the wizard must have before Start building is allowed. */
export const LbProjectStartableSchema = LbProjectConfigSchema.extend({
  mailboxId: Id,
  captchaSecretId: Id,
  topicLanes: z.array(LbTopicLaneSchema).min(1).max(20),
});

export const LbDraftQualityChecksSchema = z.object({
  factsOnly: z.boolean(),
  noBannedClaims: z.boolean(),
  registerMatches: z.boolean(),
  lengthOk: z.boolean(),
  singleLink: z.boolean(),
  notTestimonial: z.boolean(),
  issues: z.array(z.string()).default([]),
});
export type LbDraftQualityChecks = z.infer<typeof LbDraftQualityChecksSchema>;

export const LbRunStepCostsSchema = z.object({
  credits: z.number().int().min(0).default(0),
  tokens: z.number().int().min(0).default(0),
  bytes: z.number().int().min(0).default(0),
  ms: z.number().int().min(0).default(0),
});
export type LbRunStepCosts = z.infer<typeof LbRunStepCostsSchema>;

export const LbWhyNotReasonSchema = z.enum([
  "host_supply_exhausted",
  "warmup_pending",
  "pending_email",
  "pending_admin",
  "operator_parked",
  "spam_filtered",
  "unsupported_captcha",
  "captcha_balance_low",
  "model_errors",
  "proxy_degraded",
  "new_quota_reached",
  "week_cap_reached",
]);
export type LbWhyNotReason = z.infer<typeof LbWhyNotReasonSchema>;

/** End-of-window explanation shown whenever the LIVE quota was not met. */
export const LbWhyNotSchema = z.object({
  supply: z.object({ qualified: z.number().int().min(0), ready: z.number().int().min(0) }),
  parked: z.number().int().min(0),
  spamBlocked: z.number().int().min(0),
  unsupportedCaptcha: z.number().int().min(0),
  pendingEmail: z.number().int().min(0),
  pendingAdmin: z.number().int().min(0),
  modelErrors: z.number().int().min(0),
  modelRefusals: z.number().int().min(0),
  captchaBalance: z.number().int().nullable(),
  proxy: z.enum(["ok", "degraded"]),
  reasons: z.array(LbWhyNotReasonSchema),
});
export type LbWhyNot = z.infer<typeof LbWhyNotSchema>;
