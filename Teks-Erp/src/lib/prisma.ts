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

// Pool tuning:
//   max: 30 — orta yüklü API + toplu işlem dalgaları (default 10 yetersiz; 8-çekirdek
//             sunucuda (core×2)+disk ≈ 20-40 bandı, 30 güvenli tampon, 40+ idle/CPU israfı)
//   idleTimeoutMillis: 30s — idle connection'ları geri ver
//   connectionTimeoutMillis: 5s — connection alınamazsa hızlı fail
//   statement_timeout: zaten DB-level (30s) ayarlı, app-level pool'u beklemez
const pool = new Pool({
  connectionString,
  max: 30,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});
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
