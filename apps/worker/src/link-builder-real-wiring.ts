import { join } from "node:path";
import type {
  AdapterContext,
  BrowserSessionFactory,
  CaptchaSolver,
  SandboxProvider,
  SearchProvider,
} from "@rakazo/adapter-kit";
import {
  CaptellHttpSolver,
  DataForSeoSearchProvider,
  type EncryptedSecretStore,
  RecordedSearchProvider,
  recordedSerpDir,
  toComputerRef,
} from "@rakazo/adapters";
import type { PrismaClient } from "@rakazo/db";
import {
  LocalBrowserSessionFactory,
  SandboxBrowserSessionFactory,
} from "@rakazo/linkbuilder-browser";

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
}): BrowserSessionFactory {
  const { env, prisma } = input;
  if (env.LINK_BUILDER_BROWSER === "local") {
    return new LocalBrowserSessionFactory({
      profileRoot: join(input.dataDir, ".browser-profiles"),
      helperDirs: dirs(env.LINK_BUILDER_HELPER_DIR),
      env,
    });
  }
  return new SandboxBrowserSessionFactory({
    sandbox: input.sandbox,
    helperDirs: dirs(env.LINK_BUILDER_SANDBOX_HELPER_DIR),
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
}): Promise<CaptchaSolver | null> {
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
