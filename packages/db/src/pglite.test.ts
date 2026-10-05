import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDb, type TestDatabase } from "./pglite.js";

describe("PGlite test database", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createPgliteDb();
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it("applies every migration and enforces one counted placement per host", async () => {
    const { prisma } = db;
    await prisma.organization.create({
      data: { id: "org", name: "Org", slug: "org", createdAt: new Date() },
    });
    await prisma.user.create({ data: { id: "user", name: "U", email: "u@example.test" } });
    const project = await prisma.lbProject.create({
      data: {
        workspaceId: "org",
        createdByUserId: "user",
        name: "P",
        slug: "p",
        brandName: "Brand",
      },
    });
    const host = await prisma.lbHost.create({
      data: {
        workspaceId: "org",
        projectId: project.id,
        registrableDomain: "board.example",
        homepageUrl: "https://board.example/",
        language: "de",
        country: "DE",
      },
    });
    const account = await prisma.lbHostAccount.create({
      data: { workspaceId: "org", projectId: project.id, hostId: host.id, username: "mira" },
    });
    const placement = (postUrl: string, counted: boolean) =>
      prisma.lbPlacement.create({
        data: {
          workspaceId: "org",
          projectId: project.id,
          hostId: host.id,
          hostAccountId: account.id,
          threadUrl: "https://board.example/viewtopic.php?t=1",
          postUrl,
          targetUrl: "https://brand.example/",
          anchorText: "Brand",
          status: "live",
          counted,
        },
      });
    await placement("https://board.example/viewtopic.php?p=1#p1", true);
    await placement("https://board.example/viewtopic.php?p=2#p2", false);
    await expect(placement("https://board.example/viewtopic.php?p=3#p3", true)).rejects.toThrow();
    expect(await prisma.lbPlacement.count({ where: { counted: true } })).toBe(1);
  });
});
