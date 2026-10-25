import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";

/**
 * Prisma over node-postgres (`pg`) via the driver adapter, connected to the
 * pooled DATABASE_URL (Neon's PgBouncer endpoint in production).
 *
 * On Vercel, `attachDatabasePool` lets Fluid compute close idle connections
 * before a function instance is suspended, so they don't leak; elsewhere it
 * is a no-op. The pool is small because each serverless instance handles
 * few concurrent requests and PgBouncer does the real pooling.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: process.env.VERCEL ? 5 : 10,
  idleTimeoutMillis: 30_000,
});
attachDatabasePool(pool);

export const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
