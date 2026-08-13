import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { Pool } from "pg";

export type Db = PrismaClient;

export function createDb(connectionString: string): { prisma: PrismaClient; pool: Pool } {
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  return { prisma, pool };
}

export { PrismaClient } from "./generated/prisma/client.js";
export * from "./generated/prisma/client.js";
