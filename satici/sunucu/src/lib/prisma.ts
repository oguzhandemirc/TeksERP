// Prisma istemcisi (Prisma 7 + pg sürücü bağdaştırıcısı) — süreçte TEK örnek.
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { loadEnvFile } from "./env";
import { PG_SESSION_OPTIONS } from "./pg-session";

loadEnvFile();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL tanımlı değil");

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 600_000,
  connectionTimeoutMillis: 5_000,
  options: PG_SESSION_OPTIONS,
});
pool.on("error", (err) => {
  console.error(`[satici] pg havuzu: boşta bağlantı düştü (${err.message})`);
});

export const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
  transactionOptions: { maxWait: 5_000, timeout: 20_000 },
});

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;
