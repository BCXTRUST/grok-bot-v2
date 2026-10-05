import { join } from "node:path";
import type { BrowserSessionFactory, SandboxProvider } from "@rakazo/adapter-kit";
import { toComputerRef } from "@rakazo/adapters";
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
