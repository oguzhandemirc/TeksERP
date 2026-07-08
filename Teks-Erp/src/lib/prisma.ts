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
//   statement_timeout: zaten DB-level (50s) ayarlı, app-level pool'u beklemez
const pool = new Pool({
  connectionString,
  max: 30,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// O3-2: pg Pool idle-client hata olayı. DB bağlantı düşürürse (network drop,
// server-side timeout, DB restart) dinleyici YOKSA Node yakalanmamış istisnaya
// çevirir → süreç çöker. Logla ama DÜŞÜRME — Pool hatalı client'ı havuzdan çıkarır,
// bir sonraki sorgu yeni bağlantı açar (LAN-only tek-process'te gereksiz restart yok).
pool.on("error", (err) => {
  console.error("[prisma pool]: idle client hatası (bağlantı düştü, havuz kendini onaracak):", err);
});

const adapter = new PrismaPg(pool);

// O3-1: global transactionOptions — interaktif tx için varsayılan tavanları yükselt
// (per-call override YOK, davranış daralmaz). timeout DB statement_timeout=50s altında.
const prisma = new PrismaClient({
  adapter,
  transactionOptions: {
    maxWait: 5_000,
    timeout: 20_000,
  },
});

// O3-3: Graceful shutdown TEK noktada (server.ts) toplanmıştır. Buradaki
// SIGTERM/SIGINT handler'ı KALDIRILDI — çift handler F10 graceful shutdown'ı boşa
// çıkarıyordu (server.close callback'i prisma.$disconnect + pool.end yapar).

export default prisma;
export { pool };
