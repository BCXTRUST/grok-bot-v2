import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "./generated/prisma/client.js";

/*
 * In-process Postgres (PGlite) for offline tests: the real migrations, the real partial unique
 * indexes and the real Prisma client, without Docker or a server.
 */

const MIGRATIONS = new URL("../prisma/migrations/", import.meta.url);

function migrationSql(): string[] {
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) =>
      readFileSync(new URL(`${name}/migration.sql`, MIGRATIONS), "utf8")
        // PGlite runs a file as one implicit transaction, where CONCURRENTLY is not allowed.
        .replace(/CREATE (UNIQUE )?INDEX CONCURRENTLY/gi, "CREATE $1INDEX"),
    );
}

export interface TestDatabase {
  prisma: PrismaClient;
  pglite: PGlite;
  close(): Promise<void>;
}

export async function createPgliteDb(): Promise<TestDatabase> {
  const pglite = new PGlite();
  for (const sql of migrationSql()) await pglite.exec(sql);
  const prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) });
  return {
    prisma,
    pglite,
    async close() {
      await prisma.$disconnect();
      await pglite.close();
    },
  };
}
