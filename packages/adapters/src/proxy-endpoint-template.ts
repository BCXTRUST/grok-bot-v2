import { createHash } from "node:crypto";
import {
  type AdapterContext,
  type AdapterDescriptor,
  type CountryCode,
  type ProxyEndpoint,
  ProxyEndpointSchema,
  type ProxyKind,
  type ProxyLeaseRequest,
  ProxyLeaseRequestSchema,
  type ProxyProvider,
  type ProxyProviderCapabilities,
  type SecretRef,
  SecretRefSchema,
} from "@rakazo/adapter-kit";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { z } from "zod";

/**
 * Vendor-neutral endpoint template. Country and sticky-session targeting are fields in
 * the username (and, for vendors that publish them on the password, an optional suffix).
 * The password itself is only a SecretRef. This module never opens a socket except
 * `probe`, and unit tests do not call `probe` unless they inject a fetch.
 */

const CoverageSchema = z.union([z.literal("*"), z.array(z.string().regex(/^[A-Z]{2}$/)).min(1)]);

export const EndpointTemplateConfigSchema = z
  .object({
    id: z.string().min(1).max(64),
    gatewayHost: z.string().regex(/^[a-z0-9.-]+$/),
    gatewayPort: z.number().int().min(1).max(65_535),
    protocol: z.enum(["http", "socks5"]),
    /** `{country}`, `{session}`, `{ttlMinutes}`, plus literal text the deployment edits. */
    usernameTemplate: z.string().min(1).max(200),
    /**
     * Appended to the secret password inside `materialize` only. IPRoyal's published
     * grammar puts `_country-` `_session-` `_lifetime-` on the password; the secret
     * value itself stays opaque.
     */
    passwordSuffixTemplate: z.string().max(200).optional(),
    passwordRef: SecretRefSchema,
    kinds: z
      .object({
        static_isp: CoverageSchema.optional(),
        residential: CoverageSchema.optional(),
      })
      .strict(),
    stickyTtlMs: z.number().int().positive(),
    /** When set, other countries are refused. */
    countries: z.array(z.string().regex(/^[A-Z]{2}$/)).optional(),
  })
  .strict();
export type EndpointTemplateConfig = z.infer<typeof EndpointTemplateConfigSchema>;

export type ProxyProtocol = "http" | "socks5";

/** Eight lowercase hex characters. IPRoyal requires exactly eight alphanumeric characters. */
export const STICKY_SESSION_LENGTH = 8;

export function stickySessionId(stickyKey: string): string {
  return createHash("sha256").update(stickyKey).digest("hex").slice(0, STICKY_SESSION_LENGTH);
}

export function renderProxyTemplate(
  template: string,
  vars: { country: string; session: string; ttlMinutes: number },
): string {
  return template
    .replaceAll("{country}", vars.country.toLowerCase())
    .replaceAll("{session}", vars.session)
    .replaceAll("{ttlMinutes}", String(vars.ttlMinutes));
}

interface LeaseIdPayload {
  country: CountryCode;
  stickyKey: string;
  kind: ProxyKind;
  session: string;
}

export function encodeLeaseId(payload: LeaseIdPayload): string {
  return `ept1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

export function readLeaseId(id: string): LeaseIdPayload {
  if (!id.startsWith("ept1.")) throw new ProxyProviderError("Unknown proxy lease");
  try {
    const parsed = JSON.parse(
      Buffer.from(id.slice(5), "base64url").toString("utf8"),
    ) as LeaseIdPayload;
    if (!parsed.session || !parsed.stickyKey || !parsed.country || !parsed.kind) {
      throw new Error("incomplete");
    }
    return parsed;
  } catch (error) {
    if (error instanceof ProxyProviderError) throw error;
    throw new ProxyProviderError("Unknown proxy lease");
  }
}

export class ProxyProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProxyProviderError";
  }
}

export interface StoredProxyLease {
  id: string;
  country: string;
  stickyKey: string;
  kind: string;
  usernameSecretId: string | null;
  renewsAt: Date | null;
}

const ISP_SHARED = [
  "US",
  "GB",
  "DE",
  "FR",
  "CA",
  "AU",
  "NL",
  "IT",
  "ES",
  "BR",
  "JP",
  "IN",
  "MX",
  "PL",
  "SE",
  "AT",
  "CH",
  "BE",
  "PT",
  "IE",
  "DK",
  "NO",
  "FI",
  "NZ",
  "SG",
] as const;

/** Oxylabs documents ISP inventory in 25 countries. The host and port are placeholders. */
export const OXYLABS_ISP_COUNTRIES: readonly string[] = ISP_SHARED;

/**
 * IPRoyal documents ISP inventory in about 40 countries, including DE/AT/CH/US/GB.
 * The extra rows are the remainder of that published set. Host and port are placeholders.
 */
export const IPROYAL_ISP_COUNTRIES: readonly string[] = [
  ...ISP_SHARED,
  "HK",
  "KR",
  "TW",
  "AR",
  "CL",
  "CO",
  "ZA",
  "AE",
  "IL",
  "TR",
  "CZ",
  "RO",
  "HU",
  "GR",
  "TH",
];

const PLACEHOLDER_HOST = "proxy.example";
const PLACEHOLDER_PORT = 8080;

/**
 * IPRoyal residential grammar is `_country-{cc}_session-{8}_lifetime-{n}m` on the password.
 * The password secret stays opaque; the suffix is rendered in `materialize`.
 * `USERNAME` is a literal the deployment replaces with the account username.
 */
export function iproyalPreset(
  overrides: Partial<EndpointTemplateConfig> = {},
): EndpointTemplateConfig {
  return EndpointTemplateConfigSchema.parse({
    id: "iproyal",
    gatewayHost: PLACEHOLDER_HOST,
    gatewayPort: PLACEHOLDER_PORT,
    protocol: "http",
    usernameTemplate: "USERNAME",
    passwordSuffixTemplate: "_country-{country}_session-{session}_lifetime-{ttlMinutes}m",
    passwordRef: { secretId: "lb-proxy-password" },
    kinds: { static_isp: [...IPROYAL_ISP_COUNTRIES], residential: "*" },
    stickyTtlMs: 7 * 24 * 60 * 60 * 1000,
    ...overrides,
  });
}

/**
 * Oxylabs residential username: `customer-USERNAME-cc-{cc}-sessid-{id}-sesstime-{minutes}`.
 * `USERNAME` is a literal the deployment replaces.
 */
export function oxylabsPreset(
  overrides: Partial<EndpointTemplateConfig> = {},
): EndpointTemplateConfig {
  return EndpointTemplateConfigSchema.parse({
    id: "oxylabs",
    gatewayHost: PLACEHOLDER_HOST,
    gatewayPort: PLACEHOLDER_PORT,
    protocol: "http",
    usernameTemplate: "customer-USERNAME-cc-{country}-sessid-{session}-sesstime-{ttlMinutes}",
    passwordRef: { secretId: "lb-proxy-password" },
    kinds: { static_isp: [...OXYLABS_ISP_COUNTRIES], residential: "*" },
    stickyTtlMs: 24 * 60 * 60 * 1000,
    ...overrides,
  });
}

export const IPROYAL_PRESET = iproyalPreset();
export const OXYLABS_PRESET = oxylabsPreset();

export interface ProxyMaterialized {
  server: string;
  protocol: ProxyProtocol;
  username?: string;
  password?: string;
}

export interface ProxyProbeResult {
  ip: string | null;
  country: string | null;
}

type ProbeFetch = (
  url: string,
  init: { dispatcher?: unknown },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

function throwIfAborted(context: AdapterContext): void {
  if (context.signal.aborted) throw new ProxyProviderError("aborted");
}

function covers(coverage: "*" | readonly string[] | undefined, country: string): boolean {
  if (!coverage) return false;
  if (coverage === "*") return true;
  return coverage.includes(country);
}

function ttlMinutes(stickyTtlMs: number): number {
  return Math.max(1, Math.round(stickyTtlMs / 60_000));
}

export class EndpointTemplateProxyProvider implements ProxyProvider {
  private readonly config: EndpointTemplateConfig;
  private readonly now: () => Date;
  private readonly seal: (plaintext: string, context: AdapterContext) => Promise<SecretRef>;
  /** stickyKey → username secret, so a repeat lease does not mint a new secret. */
  private readonly usernames = new Map<string, SecretRef>();
  private readonly blacklisted = new Set<string>();

  constructor(
    config: EndpointTemplateConfig,
    options: {
      now?: () => Date;
      seal: (plaintext: string, context: AdapterContext) => Promise<SecretRef>;
    },
  ) {
    this.config = EndpointTemplateConfigSchema.parse(config);
    this.now = options.now ?? (() => new Date());
    this.seal = options.seal;
  }

  describe(): AdapterDescriptor<ProxyProviderCapabilities> {
    const coverage: ProxyProviderCapabilities["coverage"] = {};
    if (this.config.kinds.static_isp) {
      coverage.static_isp =
        this.config.kinds.static_isp === "*"
          ? "*"
          : ([...this.config.kinds.static_isp] as CountryCode[]);
    }
    if (this.config.kinds.residential) {
      coverage.residential =
        this.config.kinds.residential === "*"
          ? "*"
          : ([...this.config.kinds.residential] as CountryCode[]);
    }
    return {
      id: this.config.id,
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { coverage, sticky: true },
    };
  }

  async lease(request: ProxyLeaseRequest, context: AdapterContext): Promise<ProxyEndpoint> {
    throwIfAborted(context);
    const parsed = ProxyLeaseRequestSchema.parse(request);
    if (this.config.countries && !this.config.countries.includes(parsed.country)) {
      throw new ProxyProviderError(`Country ${parsed.country} is not in the allowlist`);
    }
    const kind = this.pickKind(parsed.country, parsed.kinds);
    const session = stickySessionId(parsed.stickyKey);
    const id = encodeLeaseId({
      country: parsed.country,
      stickyKey: parsed.stickyKey,
      kind,
      session,
    });
    if (this.blacklisted.has(id)) throw new ProxyProviderError("Proxy lease is blacklisted");
    const username = await this.usernameRef(parsed.stickyKey, parsed.country, session, context);
    return this.endpoint({
      id,
      country: parsed.country,
      stickyKey: parsed.stickyKey,
      kind,
      username,
      renewsAt: this.expiry(),
    });
  }

  async renew(id: string, context: AdapterContext): Promise<ProxyEndpoint> {
    throwIfAborted(context);
    if (this.blacklisted.has(id)) throw new ProxyProviderError("Proxy lease is blacklisted");
    const payload = readLeaseId(id);
    const username = this.usernames.get(payload.stickyKey);
    return this.endpoint({
      id,
      country: payload.country,
      stickyKey: payload.stickyKey,
      kind: payload.kind,
      username,
      renewsAt: this.expiry(),
    });
  }

  async release(id: string, context: AdapterContext): Promise<void> {
    throwIfAborted(context);
    this.blacklisted.delete(id);
  }

  /** Drops the session. The next lease must use a new sticky key; renew of this id fails. */
  async markBlacklisted(id: string, context: AdapterContext): Promise<void> {
    throwIfAborted(context);
    readLeaseId(id);
    this.blacklisted.add(id);
  }

  /** Rebuilds an endpoint from a stored row. Does not seal and does not change the session. */
  catalogEndpoint(stored: StoredProxyLease): ProxyEndpoint {
    const payload = readLeaseId(stored.id);
    return this.endpoint({
      id: stored.id,
      country: payload.country,
      stickyKey: payload.stickyKey,
      kind: payload.kind,
      username: stored.usernameSecretId ? { secretId: stored.usernameSecretId } : undefined,
      renewsAt: stored.renewsAt ?? undefined,
    });
  }

  /**
   * Loads the password from the secret store and applies a vendor suffix when the preset
   * has one. Callers must redact the returned password and the `user:pass@host` form.
   */
  async materialize(
    endpoint: ProxyEndpoint,
    load: (ref: SecretRef) => Promise<string>,
  ): Promise<ProxyMaterialized> {
    const payload = readLeaseId(endpoint.id);
    const username = endpoint.username ? await this.loadQuiet(load, endpoint.username) : undefined;
    let password = endpoint.password ? await this.loadQuiet(load, endpoint.password) : undefined;
    if (password && this.config.passwordSuffixTemplate) {
      password += renderProxyTemplate(this.config.passwordSuffixTemplate, {
        country: endpoint.country,
        session: payload.session,
        ttlMinutes: ttlMinutes(this.config.stickyTtlMs),
      });
    }
    return {
      server: endpoint.server,
      protocol: endpoint.protocol ?? this.config.protocol,
      username,
      password,
    };
  }

  /**
   * One HTTPS fetch through the proxy to an IP-echo URL. Tests inject `fetchImpl` and
   * `createAgent`; the default path is not used by unit tests.
   */
  async probe(
    endpoint: ProxyEndpoint,
    load: (ref: SecretRef) => Promise<string>,
    options: {
      echoUrl?: string;
      fetchImpl?: ProbeFetch;
      createAgent?: (proxyUrl: string) => unknown;
    } = {},
  ): Promise<ProxyProbeResult> {
    const creds = await this.materialize(endpoint, load);
    if (!creds.username || !creds.password)
      throw new ProxyProviderError("missing proxy credential");
    const proxyUrl = `${creds.protocol}://${encodeURIComponent(creds.username)}:${encodeURIComponent(creds.password)}@${creds.server}`;
    const agent = options.createAgent ? options.createAgent(proxyUrl) : new ProxyAgent(proxyUrl);
    const fetchImpl = options.fetchImpl ?? (undiciFetch as unknown as ProbeFetch);
    const echoUrl = options.echoUrl ?? "https://ip.example/json";
    let body: unknown;
    try {
      const response = await fetchImpl(echoUrl, { dispatcher: agent });
      if (!response.ok) throw new ProxyProviderError("proxy probe failed");
      body = await response.json();
    } catch (error) {
      if (error instanceof ProxyProviderError) throw error;
      throw new ProxyProviderError("proxy probe failed");
    } finally {
      if (agent && typeof (agent as { close?: () => Promise<void> }).close === "function") {
        await (agent as { close: () => Promise<void> }).close().catch(() => undefined);
      }
    }
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const country = record.country ?? record.country_code ?? record.countryCode;
    const ip = record.ip ?? record.query;
    return {
      country: typeof country === "string" ? country.toUpperCase() : null,
      ip: typeof ip === "string" ? ip : null,
    };
  }

  private pickKind(country: string, kinds: readonly ProxyKind[]): ProxyKind {
    for (const kind of kinds) {
      if (kind !== "static_isp" && kind !== "residential") continue;
      if (covers(this.config.kinds[kind], country)) return kind;
    }
    throw new ProxyProviderError(`No ${kinds.join(" or ")} proxy for ${country}`);
  }

  private async usernameRef(
    stickyKey: string,
    country: string,
    session: string,
    context: AdapterContext,
  ): Promise<SecretRef> {
    const cached = this.usernames.get(stickyKey);
    if (cached) return cached;
    const rendered = renderProxyTemplate(this.config.usernameTemplate, {
      country,
      session,
      ttlMinutes: ttlMinutes(this.config.stickyTtlMs),
    });
    const sealed = await this.seal(rendered, context);
    this.usernames.set(stickyKey, sealed);
    return sealed;
  }

  private endpoint(input: {
    id: string;
    country: string;
    stickyKey: string;
    kind: ProxyKind;
    username?: SecretRef;
    renewsAt: Date | undefined;
  }): ProxyEndpoint {
    return ProxyEndpointSchema.parse({
      id: input.id,
      country: input.country,
      stickyKey: input.stickyKey,
      server: `${this.config.gatewayHost}:${this.config.gatewayPort}`,
      protocol: this.config.protocol,
      ...(input.username ? { username: input.username } : {}),
      password: this.config.passwordRef,
      kind: input.kind,
      ...(input.renewsAt ? { renewsAt: input.renewsAt.toISOString() } : {}),
    });
  }

  private expiry(): Date {
    return new Date(this.now().getTime() + this.config.stickyTtlMs);
  }

  private async loadQuiet(
    load: (ref: SecretRef) => Promise<string>,
    ref: SecretRef,
  ): Promise<string> {
    try {
      return await load(ref);
    } catch {
      throw new ProxyProviderError("missing proxy credential");
    }
  }
}
