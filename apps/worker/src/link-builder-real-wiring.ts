import { join } from "node:path";
import type {
  AdapterContext,
  BrowserSessionFactory,
  CaptchaSolver,
  ProxyEndpoint,
  ProxyProvider,
  SandboxProvider,
  SearchProvider,
  SecretRef,
} from "@rakazo/adapter-kit";
import {
  CaptellHttpSolver,
  DataForSeoSearchProvider,
  type EncryptedSecretStore,
  EndpointTemplateProxyProvider,
  iproyalPreset,
  KernelBrowserSessionFactory,
  oxylabsPreset,
  RecordedSearchProvider,
  recordedSerpDir,
  toComputerRef,
} from "@rakazo/adapters";
import type { PrismaClient } from "@rakazo/db";
import {
  camoufoxExecutable,
  LocalBrowserSessionFactory,
  type ProxyResolver,
  SandboxBrowserSessionFactory,
} from "@rakazo/linkbuilder-browser";
import { sealProxyUsername } from "./link-builder-proxy.js";

function dirs(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * The persona browser runs inside the workspace's team computer sandbox. `LINK_BUILDER_BROWSER=local`
 * runs it on this host instead; the local factory refuses that in production without
 * `LINK_BUILDER_ALLOW_LOCAL_BROWSER=true`.
 */
/** Recorded fixtures, or DataForSEO when `LINK_BUILDER_SEARCH=dataforseo` and a `lb_search` secret exists. */
export function searchProviderFromEnv(input: {
  env: NodeJS.ProcessEnv;
  prisma: PrismaClient;
  secrets: EncryptedSecretStore;
}): SearchProvider | undefined {
  if (input.env.LINK_BUILDER_SEARCH === "off") return undefined;
  const recorded = new RecordedSearchProvider(recordedSerpDir());
  if (input.env.LINK_BUILDER_SEARCH !== "dataforseo") return recorded;
  return new DataForSeoSearchProvider({
    onSecret: (secret) => input.secrets.redact(secret),
    credentials: async (context: AdapterContext) => {
      const row = await input.prisma.secret.findFirst({
        where: { workspaceId: context.workspaceId, kind: "lb_search" },
        orderBy: { createdAt: "desc" },
      });
      if (!row) throw new Error("missing search credentials");
      const plain = input.secrets.load(row.ciphertext);
      input.secrets.redact(plain);
      const split = plain.indexOf(":");
      if (split <= 0) throw new Error("missing search credentials");
      return { login: plain.slice(0, split), password: plain.slice(split + 1) };
    },
  });
}

export function browserFactoryFromEnv(input: {
  env: NodeJS.ProcessEnv;
  dataDir: string;
  sandbox: SandboxProvider;
  prisma: PrismaClient;
  secrets?: EncryptedSecretStore;
  proxyResolver?: ProxyResolver;
}): BrowserSessionFactory {
  const { env, prisma } = input;
  if (env.LINK_BUILDER_BROWSER === "kernel") {
    const secretId = env.LINK_BUILDER_KERNEL_SECRET_ID?.trim();
    if (!secretId || !input.secrets) {
      throw new Error("Kernel browser needs LINK_BUILDER_KERNEL_SECRET_ID");
    }
    const secrets = input.secrets;
    return new KernelBrowserSessionFactory(
      {
        apiKey: { secretId },
        ...(env.LINK_BUILDER_KERNEL_BASE_URL ? { baseUrl: env.LINK_BUILDER_KERNEL_BASE_URL } : {}),
        extensionNames: dirs(env.LINK_BUILDER_KERNEL_EXTENSION),
      },
      {
        onSecret: (secret) => secrets.redact(secret),
        loadSecret: async (ref, context) => {
          const row = await prisma.secret.findFirst({
            where: { id: ref.secretId, workspaceId: context.workspaceId },
            select: { ciphertext: true },
          });
          if (!row) throw new Error("missing kernel credential");
          const plain = secrets.load(row.ciphertext);
          secrets.redact(plain);
          return plain;
        },
      },
    );
  }
  if (env.LINK_BUILDER_BROWSER === "local") {
    return new LocalBrowserSessionFactory({
      profileRoot: join(input.dataDir, ".browser-profiles"),
      helperDirs: dirs(env.LINK_BUILDER_HELPER_DIR),
      proxyResolver: input.proxyResolver,
      env,
    });
  }
  return new SandboxBrowserSessionFactory({
    sandbox: input.sandbox,
    helperDirs: dirs(env.LINK_BUILDER_SANDBOX_HELPER_DIR),
    proxyResolver: input.proxyResolver,
    async resolveComputer(persona) {
      const project = await prisma.lbProject.findUnique({
        where: { id: persona.projectId },
        select: { workspaceId: true },
      });
      if (!project) throw new Error("Link builder project not found");
      const computer = await prisma.computer.findFirst({
        where: { workspaceId: project.workspaceId, scope: "team", providerRef: { not: null } },
        orderBy: { updatedAt: "desc" },
      });
      if (!computer) throw new Error("The workspace has no team computer for the persona browser");
      return toComputerRef(computer);
    },
  });
}

/**
 * Real mode uses Captell when the project has a stored token. Without one, the runner
 * records a refusal and does not open the persona browser.
 */
export async function captchaSolverForProject(input: {
  prisma: PrismaClient;
  secrets: EncryptedSecretStore;
  projectId: string;
  workspaceId: string;
  redact?: (secret: string) => void;
  fetch?: typeof fetch;
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<CaptchaSolver | null> {
  const deployment = input.env?.CAPTELL_API_KEY?.trim();
  if (deployment) {
    return new CaptellHttpSolver({
      fetch: input.fetch,
      baseUrl: input.baseUrl ?? input.env?.CAPTELL_BASE_URL,
      onToken: input.redact,
      maxRetries: 4,
      token: async () => deployment,
    });
  }
  const project = await input.prisma.lbProject.findFirst({
    where: { id: input.projectId, workspaceId: input.workspaceId },
    select: { captchaSecretId: true },
  });
  if (!project?.captchaSecretId) return null;
  const secret = await input.prisma.secret.findFirst({
    where: { id: project.captchaSecretId, workspaceId: input.workspaceId },
    select: { ciphertext: true },
  });
  if (!secret) return null;
  const ciphertext = secret.ciphertext;
  return new CaptellHttpSolver({
    fetch: input.fetch,
    baseUrl: input.baseUrl,
    onToken: input.redact,
    token: async (_context: AdapterContext) => {
      const token = input.secrets.load(ciphertext);
      input.redact?.(token);
      return token;
    },
  });
}

/**
 * One deployment-wide vendor row. The password is the secret id of kind `lb_proxy`
 * (or `LINK_BUILDER_PROXY_SECRET_ID`). The plaintext is never read here.
 */
export async function proxyProviderFromEnv(input: {
  env: NodeJS.ProcessEnv;
  prisma: PrismaClient;
  secrets: EncryptedSecretStore;
}): Promise<ProxyProvider | undefined> {
  if (input.env.LINK_BUILDER_PROXY !== "template") return undefined;
  const secretId =
    input.env.LINK_BUILDER_PROXY_SECRET_ID ||
    (
      await input.prisma.secret.findFirst({
        where: { kind: "lb_proxy" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })
    )?.id;
  if (!secretId) return undefined;
  const base =
    input.env.LINK_BUILDER_PROXY_PRESET === "oxylabs" ? oxylabsPreset() : iproyalPreset();
  const port = Number(input.env.LINK_BUILDER_PROXY_PORT ?? base.gatewayPort);
  const provider = new EndpointTemplateProxyProvider(
    {
      ...base,
      gatewayHost: input.env.LINK_BUILDER_PROXY_HOST || base.gatewayHost,
      gatewayPort: Number.isInteger(port) && port > 0 ? port : base.gatewayPort,
      protocol: input.env.LINK_BUILDER_PROXY_PROTOCOL === "socks5" ? "socks5" : base.protocol,
      usernameTemplate: input.env.LINK_BUILDER_PROXY_USERNAME_TEMPLATE || base.usernameTemplate,
      ...(input.env.LINK_BUILDER_PROXY_PASSWORD_SUFFIX_TEMPLATE
        ? { passwordSuffixTemplate: input.env.LINK_BUILDER_PROXY_PASSWORD_SUFFIX_TEMPLATE }
        : {}),
      passwordRef: { secretId },
    },
    {
      seal: (plaintext, context) =>
        sealProxyUsername({ prisma: input.prisma, secrets: input.secrets }, plaintext, context),
    },
  );
  return provider;
}

/** Reads proxy credentials inside the browser factory and records them for redaction. */
export function proxyResolverFor(input: {
  prisma: PrismaClient;
  secrets: EncryptedSecretStore;
  provider?: ProxyProvider;
  revealed: string[];
}): ProxyResolver {
  const load = async (ref: SecretRef, workspaceId: string) => {
    const row = await input.prisma.secret.findFirst({
      where: { id: ref.secretId, workspaceId },
      select: { ciphertext: true },
    });
    if (!row) throw new Error("missing proxy credential");
    return input.secrets.load(row.ciphertext);
  };
  return async (endpoint: ProxyEndpoint, context: AdapterContext) => {
    const read = (ref: SecretRef) => load(ref, context.workspaceId);
    let username: string | undefined;
    let password: string | undefined;
    let protocol: "http" | "socks5" = endpoint.protocol ?? "http";
    if (input.provider instanceof EndpointTemplateProxyProvider) {
      const creds = await input.provider.materialize(endpoint, read);
      username = creds.username;
      password = creds.password;
      protocol = creds.protocol;
    } else {
      username = endpoint.username ? await read(endpoint.username) : undefined;
      password = endpoint.password ? await read(endpoint.password) : undefined;
    }
    const userinfo = username && password ? `${username}:${password}@${endpoint.server}` : "";
    for (const value of [password, userinfo]) {
      if (value && !input.revealed.includes(value)) input.revealed.push(value);
    }
    return {
      server: `${protocol}://${endpoint.server}`,
      username,
      password,
    };
  };
}

export function camoufoxAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return camoufoxExecutable(env) !== null;
}
