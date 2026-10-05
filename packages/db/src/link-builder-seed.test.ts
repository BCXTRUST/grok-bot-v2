import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { LB_DEMO_SLUG, linkBuilderDemoDomains, seedLinkBuilderDemo } from "./link-builder-seed.js";

describe("link builder demo seed", () => {
  it("uses only placeholder .example domains", () => {
    expect(LB_DEMO_SLUG).toBe("nordlicht-wellness");
    for (const domain of linkBuilderDemoDomains()) {
      expect(domain.endsWith(".example")).toBe(true);
      expect(domain).not.toMatch(/https?:\/\//);
    }
    expect(linkBuilderDemoDomains()).toEqual(
      expect.arrayContaining([
        "forum.nordlicht.example",
        "fragen.nordlicht.example",
        "spam.nordlicht.example",
      ]),
    );
  });

  it("does not insert a second demo into the same workspace", async () => {
    const findFirst = vi.fn(async () => ({ id: "project-demo" }));
    const create = vi.fn();
    const prisma = { lbProject: { findFirst, create } } as unknown as PrismaClient;
    await expect(
      seedLinkBuilderDemo(prisma, { workspaceId: "workspace-1", userId: "user-1" }),
    ).resolves.toEqual({ projectId: "project-demo", created: false });
    expect(findFirst).toHaveBeenCalledWith({
      where: { workspaceId: "workspace-1", slug: LB_DEMO_SLUG },
      select: { id: true },
    });
    expect(create).not.toHaveBeenCalled();
  });
});
