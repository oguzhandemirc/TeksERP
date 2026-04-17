// =============================================================================
// TeksERP - Prisma Client Singleton (Prisma 7 + pg adapter)
// =============================================================================
// All services MUST import prisma from this module.
// Never create new PrismaClient instances elsewhere.
// =============================================================================

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set.");
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

// Graceful shutdown
const shutdown = async (): Promise<void> => {
  console.log("[prisma]: Disconnecting...");
  await prisma.$disconnect();
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export default prisma;
export { pool };
