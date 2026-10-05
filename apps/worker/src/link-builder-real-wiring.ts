import { join } from "node:path";
import type {
  AdapterContext,
  BrowserSessionFactory,
  CaptchaSolver,
  SandboxProvider,
} from "@rakazo/adapter-kit";
import { CaptellHttpSolver, type EncryptedSecretStore, toComputerRef } from "@rakazo/adapters";
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
