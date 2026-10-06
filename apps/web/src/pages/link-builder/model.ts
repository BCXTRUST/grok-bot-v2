import {
  LB_RESPONSIBILITY_ACK_SENTENCE,
  type LbDisclosureMode,
  type LbHostStatus,
  LbLinkRatioSchema,
  type LbMarket,
  type LbMarketPolicy,
  LbMarketsSchema,
  LbPersonaSchema,
  type LbProjectDetail,
  LbQuotasSchema,
  LbRegistrableDomainSchema,
  LbScheduleSchema,
  LbTopicLaneSchema,
} from "@rakazo/contracts";
import {
  defaultMarketForCountry,
  LB_WIZARD_COUNTRIES,
  registrableDomain,
} from "@rakazo/linkbuilder-core";

export const RESPONSIBILITY_SENTENCE = LB_RESPONSIBILITY_ACK_SENTENCE;

export const WIZARD_STEPS = [
  "Brand & domains",
  "Persona & inbox",
  "Quotas & schedule",
  "Topics & targets",
  "Policy",
  "Review",
] as const;

export const FUNNEL_COLUMNS = [
  { id: "discovered", label: "Discovered", statuses: ["discovered", "probed"] },
  { id: "qualified", label: "Qualified", statuses: ["qualified"] },
  {
    id: "warming",
    label: "Warming",
    statuses: ["registering", "pending_email", "pending_admin", "warming"],
  },
  { id: "ready", label: "Ready", statuses: ["ready"] },
  { id: "used", label: "Used", statuses: ["used"] },
  { id: "parked", label: "Parked", statuses: ["parked_operator"] },
  {
    id: "blocked",
    label: "Blocked",
    statuses: ["denied", "spam_blocked", "unsupported_captcha", "dead"],
  },
] as const;

export function funnelColumnId(status: LbHostStatus): (typeof FUNNEL_COLUMNS)[number]["id"] {
  return (
    FUNNEL_COLUMNS.find((column) => (column.statuses as readonly string[]).includes(status))?.id ??
    "blocked"
  );
}

export interface WizardDraft {
  name: string;
  slug: string;
  brandName: string;
  allowedDomains: string;
  displayName: string;
  bio: string;
  register: "du" | "sie";
  mailboxAddress: string | null;
  mailboxId: string | null;
  captchaToken: string;
  captchaConfigured: boolean;
  balance: number | null;
  newPerDay: string;
  livePerDay: string;
  liveWeekCap: string;
  timezone: string;
  weekdaysOnly: boolean;
  windowStart: string;
  windowEnd: string;
  overtime: boolean;
  hardStopHour: string;
  lanes: Array<{ id: string; tag: string; description: string }>;
  targets: Array<{ url: string; keywords: string }>;
  facts: string;
  markets: LbMarket[];
  marketPolicy: LbMarketPolicy;
  denyHosts: string;
  links: string;
  posts: string;
  disclosureMode: LbDisclosureMode;
}

export function emptyDraft(): WizardDraft {
  const market = defaultMarketForCountry("DE");
  return {
    name: "",
    slug: "",
    brandName: "",
    allowedDomains: "",
    displayName: "",
    bio: "",
    register: "du",
    mailboxAddress: null,
    mailboxId: null,
    captchaToken: "",
    captchaConfigured: false,
    balance: null,
    newPerDay: "2",
    livePerDay: "1",
    liveWeekCap: "5",
    timezone: market.timezoneId,
    weekdaysOnly: true,
    windowStart: "09:00",
    windowEnd: "22:00",
    overtime: false,
    hardStopHour: "24",
    lanes: [{ id: newLaneId(), tag: "", description: "" }],
    targets: [{ url: "", keywords: "" }],
    facts: "",
    markets: [market],
    marketPolicy: "primary_first",
    denyHosts: "",
    links: "1",
    posts: "3",
    disclosureMode: "undisclosed_persona",
  };
}

export function draftFromProject(project: LbProjectDetail): WizardDraft {
  const base = emptyDraft();
  return {
    ...base,
    name: project.name,
    slug: project.slug,
    brandName: project.brandName,
    allowedDomains: project.allowedDomains.join(", "),
    displayName: project.persona?.displayName ?? "",
    bio: project.persona?.bio ?? "",
    register: project.persona?.register ?? "du",
    mailboxAddress: project.mailboxAddress,
    mailboxId: project.mailboxId,
    captchaConfigured: project.captchaConfigured,
    balance: project.captchaConfigured ? base.balance : null,
    newPerDay: project.quotas ? String(project.quotas.newPerDay) : base.newPerDay,
    livePerDay: project.quotas ? String(project.quotas.livePerDay) : base.livePerDay,
    liveWeekCap:
      project.quotas?.liveWeekCap !== undefined ? String(project.quotas.liveWeekCap) : "",
    timezone: project.schedule.timezone,
    weekdaysOnly: project.schedule.weekdaysOnly,
    windowStart: project.schedule.window.start,
    windowEnd: project.schedule.window.end,
    overtime: project.schedule.overtimeUntilLiveMet,
    hardStopHour: String(project.schedule.hardStopHour),
    lanes:
      project.topicLanes.length > 0
        ? project.topicLanes.map((lane) => ({
            id: lane.id,
            tag: lane.tag,
            description: lane.description,
          }))
        : base.lanes,
    targets:
      project.targets.length > 0
        ? project.targets.map((target) => ({
            url: target.url,
            keywords: target.keywordClusters.join(", "),
          }))
        : base.targets,
    facts: project.facts.join("\n"),
    markets: project.markets,
    marketPolicy: project.marketPolicy,
    denyHosts: project.denyHosts.join(", "),
    links: String(project.linkRatio.links),
    posts: String(project.linkRatio.posts),
    disclosureMode: project.disclosureMode,
  };
}

export function slugifyProjectName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "project";
}

export function splitList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

export function wizardStepIssues(step: number, draft: WizardDraft): string[] {
  const review = WIZARD_STEPS.length - 1;
  if (step === review) {
    const issues = Array.from({ length: review }, (_, index) =>
      wizardStepIssues(index, draft),
    ).flat();
    if (!draft.mailboxId) issues.push("Inbox is still provisioning");
    return issues;
  }
  if (step === 0) return brandIssues(draft);
  if (step === 1) return personaIssues(draft);
  if (step === 2) return quotaIssues(draft);
  if (step === 3) return topicIssues(draft);
  if (step === 4) return policyIssues(draft);
  return ["Unknown step"];
}

export function canStart(draft: WizardDraft): boolean {
  return wizardStepIssues(WIZARD_STEPS.length - 1, draft).length === 0;
}

export function artifactImageSrc(artifact: {
  mimeType: string;
  contentBase64: string;
}): string | null {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(artifact.mimeType)) return null;
  return `data:${artifact.mimeType};base64,${artifact.contentBase64}`;
}

export function warmupNote(hours = 24): string {
  const days = Math.max(1, Math.ceil(hours / 24));
  return `First LIVE after warm-up, about ${days} ${days === 1 ? "day" : "days"}.`;
}

export function addMarket(draft: WizardDraft, country: string): WizardDraft {
  const next = defaultMarketForCountry(country);
  if (
    draft.markets.some(
      (market) => market.country === next.country && market.language === next.language,
    )
  ) {
    return draft;
  }
  const markets = [...draft.markets, next];
  return { ...draft, markets, timezone: markets[0]?.timezoneId ?? draft.timezone };
}

export function removeMarket(draft: WizardDraft, index: number): WizardDraft {
  const markets = draft.markets.filter((_, item) => item !== index);
  const next = markets.length > 0 ? markets : [defaultMarketForCountry("DE")];
  return { ...draft, markets: next, timezone: next[0]?.timezoneId ?? draft.timezone };
}

export function makePrimary(draft: WizardDraft, index: number): WizardDraft {
  const market = draft.markets[index];
  if (!market) return draft;
  const markets = [market, ...draft.markets.filter((_, item) => item !== index)];
  return { ...draft, markets, timezone: market.timezoneId };
}

export function updateMarketLocale(
  draft: WizardDraft,
  index: number,
  locale: string,
  timezoneId: string,
): WizardDraft {
  const markets = draft.markets.map((market, item) =>
    item === index ? { ...market, locale, timezoneId } : market,
  );
  return { ...draft, markets, timezone: index === 0 ? timezoneId : draft.timezone };
}

export { LB_WIZARD_COUNTRIES };

export type ParsedSite = { ok: true; domain: string; targetUrl: string | null } | { ok: false };

/** Accept a bare host, www, http(s), or a path. Store the registrable domain. */
export function parseAllowedSite(raw: string): ParsedSite {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return { ok: false };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false };
  if (url.username || url.password) return { ok: false };
  const domain = registrableDomain(url.hostname);
  if (!domain || !LbRegistrableDomainSchema.safeParse(domain).success) return { ok: false };
  const path = url.pathname.replace(/\/+$/, "");
  if (!path) return { ok: true, domain, targetUrl: null };
  url.hash = "";
  url.pathname = path;
  return { ok: true, domain, targetUrl: url.toString() };
}

export function parsedSites(value: string): ParsedSite[] {
  return splitList(value).map(parseAllowedSite);
}

export function withPersonaPrefill(draft: WizardDraft): WizardDraft {
  const brand = draft.brandName.trim() || draft.name.trim();
  const sites = parsedSites(draft.allowedDomains).filter(
    (site): site is Extract<ParsedSite, { ok: true }> => site.ok,
  );
  const section = sites
    .map((site) => (site.targetUrl ? new URL(site.targetUrl).pathname : ""))
    .find((path) => path.length > 1);
  return {
    ...draft,
    displayName: draft.displayName.trim() || brand,
    bio: draft.bio.trim() ? draft.bio : suggestBio(brand, draft.markets[0]?.language, section),
  };
}

function suggestBio(brand: string, language: string | undefined, section?: string): string {
  const name = brand || "the brand";
  if (language === "de") {
    return section
      ? `Antwortet ruhig und konkret. Kennt ${name}, vor allem die Seiten unter ${section}.`
      : `Antwortet ruhig und konkret. Kennt ${name} und bleibt bei dem, was die Seite sagt.`;
  }
  return section
    ? `Replies in a calm, specific voice. Knows ${name}, especially the pages under ${section}.`
    : `Replies in a calm, specific voice. Knows ${name} and stays with what the page says.`;
}

function brandIssues(draft: WizardDraft): string[] {
  const issues: string[] = [];
  if (draft.name.trim().length === 0) issues.push("Name is required");
  if (draft.brandName.trim().length === 0) issues.push("Brand is required");
  const sites = splitList(draft.allowedDomains);
  if (sites.length === 0) issues.push("Add at least one site");
  for (const site of sites) {
    if (!parseAllowedSite(site).ok) issues.push(`Site ${site} is not a valid address`);
  }
  const slug = draft.slug.trim() || slugifyProjectName(draft.name);
  if (draft.name.trim() && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) issues.push("Slug looks wrong");
  return issues;
}

function personaIssues(draft: WizardDraft): string[] {
  const parsed = LbPersonaSchema.safeParse({
    displayName: draft.displayName,
    bio: draft.bio,
    register: draft.register,
    language: draft.markets[0]?.language,
  });
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

function quotaIssues(draft: WizardDraft): string[] {
  const issues: string[] = [];
  const quotas = LbQuotasSchema.safeParse({
    newPerDay: Number(draft.newPerDay),
    livePerDay: Number(draft.livePerDay),
    liveWeekCap: draft.liveWeekCap.trim() === "" ? undefined : Number(draft.liveWeekCap),
    maxLivePerHost: 1,
  });
  if (!quotas.success) issues.push(quotas.error.issues[0]?.message ?? "Quotas look wrong");
  const schedule = LbScheduleSchema.safeParse({
    timezone: draft.timezone,
    weekdaysOnly: draft.weekdaysOnly,
    window: { start: draft.windowStart, end: draft.windowEnd },
    overtimeUntilLiveMet: draft.overtime,
    hardStopHour: Number(draft.hardStopHour),
  });
  if (!schedule.success) issues.push(schedule.error.issues[0]?.message ?? "Schedule looks wrong");
  return issues;
}

function topicIssues(draft: WizardDraft): string[] {
  const issues: string[] = [];
  const lanes = draft.lanes.filter((lane) => lane.tag.trim());
  if (lanes.length === 0) issues.push("Add a topic");
  for (const lane of lanes) {
    const parsed = LbTopicLaneSchema.safeParse({
      id: lane.id,
      tag: lane.tag,
      description: lane.description,
      exampleQuestions: [],
    });
    if (!parsed.success) issues.push(parsed.error.issues[0]?.message ?? "Topic looks wrong");
  }
  const domains = parsedSites(draft.allowedDomains).flatMap((site) =>
    site.ok ? [site.domain] : [],
  );
  for (const target of draft.targets) {
    if (!target.url.trim()) continue;
    try {
      const url = new URL(target.url);
      const host = url.hostname.toLowerCase();
      const allowed = domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
      if (!allowed) issues.push("Target must use an allowed domain");
    } catch {
      issues.push("Target URL looks wrong");
    }
  }
  return issues;
}

function policyIssues(draft: WizardDraft): string[] {
  const issues: string[] = [];
  if (!LbMarketsSchema.safeParse(draft.markets).success) issues.push("Check the markets");
  const ratio = LbLinkRatioSchema.safeParse({
    links: Number(draft.links),
    posts: Number(draft.posts),
  });
  if (!ratio.success) issues.push(ratio.error.issues[0]?.message ?? "Link ratio looks wrong");
  for (const host of splitList(draft.denyHosts)) {
    if (!LbRegistrableDomainSchema.safeParse(host).success)
      issues.push(`Deny host ${host} looks wrong`);
  }
  return issues;
}

function newLaneId(): string {
  return `lane-${Math.random().toString(36).slice(2, 10)}`;
}

export function patchFromDraft(draft: WizardDraft) {
  const sites = parsedSites(draft.allowedDomains).filter(
    (site): site is Extract<ParsedSite, { ok: true }> => site.ok,
  );
  const domains = [...new Set(sites.map((site) => site.domain))];
  const siteTargets = sites.flatMap((site) => (site.targetUrl ? [site.targetUrl] : []));
  const lanes = draft.lanes
    .filter((lane) => lane.tag.trim())
    .map((lane) => ({
      id: lane.id,
      tag: lane.tag.trim(),
      description: lane.description,
      exampleQuestions: [],
    }));
  const typedTargets = draft.targets.filter((target) => target.url.trim());
  const seen = new Set(typedTargets.map((target) => target.url.trim()));
  const targets = [
    ...typedTargets.map((target) => ({
      url: target.url.trim(),
      priority: 50,
      description: "",
      keywordClusters: splitList(target.keywords),
    })),
    ...siteTargets
      .filter((url) => !seen.has(url))
      .map((url) => ({
        url,
        priority: 50,
        description: "",
        keywordClusters: [] as string[],
      })),
  ];
  return {
    name: draft.name.trim(),
    slug: draft.slug.trim() || slugifyProjectName(draft.name),
    brandName: draft.brandName.trim(),
    allowedDomains: domains,
    persona: {
      displayName: draft.displayName.trim() || draft.brandName.trim() || "Persona",
      bio: draft.bio,
      register: draft.register,
      language: draft.markets[0]?.language,
    },
    quotas: {
      newPerDay: Number(draft.newPerDay),
      livePerDay: Number(draft.livePerDay),
      ...(draft.liveWeekCap.trim() ? { liveWeekCap: Number(draft.liveWeekCap) } : {}),
      maxLivePerHost: 1 as const,
    },
    schedule: {
      timezone: draft.timezone,
      weekdaysOnly: draft.weekdaysOnly,
      window: { start: draft.windowStart, end: draft.windowEnd },
      overtimeUntilLiveMet: draft.overtime,
      hardStopHour: Number(draft.hardStopHour),
    },
    topicLanes: lanes,
    targets,
    facts: draft.facts
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    markets: draft.markets,
    marketPolicy: draft.marketPolicy,
    denyHosts: splitList(draft.denyHosts),
    linkRatio: { links: Number(draft.links), posts: Number(draft.posts) },
    disclosureMode: draft.disclosureMode,
    captchaToken: draft.captchaConfigured ? undefined : draft.captchaToken || undefined,
    provisionMailbox: true,
  };
}
