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
//             sunucuda (core×2)+disk ≈ 20-40 bandı, 30 güvenli tampon, 40+ idle/CPU israfı).
//             Canlıda bu tavana HİÇ yaklaşılmadı (dinlenmede 1 bağlantı; 624k
//             transaction'da 0 deadlock / 0 conflict) → ne büyütmenin ne küçültmenin
//             dayanağı var. DOKUNMA; doygunluk artık /health `poolTotalCount` +
//             `poolWaitingMax` ile ÖLÇÜLÜYOR (lib/pool-health.ts).
//   idleTimeoutMillis: 10 dk — havuz normal sessizliklerde SIFIRA drenaj olmasın.
//             ESKİDEN 30sn'ydi: ~0,7 istek/dk'lık bir ERP'de her sessizlikten
//             sonraki İLK istek SOĞUK connect (TCP + auth) ödüyordu. Aşağıdaki
//             connectionTimeoutMillis o soğuk connect'i DE kapsayan bir son tarih
//             olduğu için, makine yüklüyken bütçe aşıldı ve istek ÇIPLAK Error ile
//             düştü — canlıda iki kez:
//               2026-07-23 14:05:34  GET /api/station-capabilities/:stationId (5071ms)
//               2026-07-28 23:59:19  GET /api/shipping/shipments            (5403ms)
//             İkisi de havuz DOLULUĞU DEĞİL (o an ~1 bağlantı vardı) — mekanizma
//             yalnızca soğuk connect. 10 dk normal vardiya boşluklarını kapsar;
//             gece tamamen boşta kalan havuz yine boşalır (günlerce bayat socket
//             biriktirmez). Etkisi ölçülebilir: /health `poolConnectsTotal` sıcak
//             havuzda ARTMAZ (doğrulandı: 2 dk boyunca 24'te sabit). Ön koşul:
//             DB'de `idle_session_timeout = 0` olmalı (doğrulandı) — yoksa sunucu
//             10 dk idle bağlantıları öldürür ve bayat-socket hatası doğar.
//             ÖLÇÜLEN AYAK İZİ: açılış patlaması havuzu 24 bağlantıya kadar açıyor
//             (schedulerlar + presence + feature-flag cache eşzamanlı sorgu atıyor;
//             poolWaitingMax=7) ve bunlar 10 dk sıcak bekliyor → 24-30 idle backend
//             / 97 kullanılabilir. Bu yüzden UYARI EŞİĞİ toplama DEĞİL MEŞGUL
//             bağlantıya (total − idle) konur; aksi halde boot sonrası kalıcı
//             yanlış alarm çıkar (bkz. ARCHITECTURE.md §10.1).
//   min: KULLANILMIYOR ve kullanılmamalı — pg-pool 3.x `min`'i YALNIZ idle-reap
//             tabanı olarak okur (index.js:90 → _isAboveMin():123 → :409,:411);
//             havuzu min'e kadar ÖNDEN DOLDURMAZ ve ölen bağlantıyı YERİNE KOYMAZ.
//             Yani "sıcak taban" garantisi vermez, sadece havuzun bir daha ASLA
//             küçülmemesini sağlar (gece de 24 saat idle backend tutar).
//             idleTimeoutMillis tek başına yeterli VE sınırlı.
//   connectionTimeoutMillis: 5s — bağlantı alınamazsa hızlı fail. Aşılırsa pg-pool
//             ÇIPLAK Error fırlatır (Prisma kodu YOK; driver adapter'da Rust havuzu
//             olmadığı için P2024 ÜRETİLMEZ) → error.middleware'deki
//             classifyPoolTimeout dalı bunu 503 + tekrar-dene mesajına çevirir ve
//             /health `poolAcquireTimeouts` sayacını artırır.
//   statement_timeout: zaten DB-level (50s) ayarlı, app-level pool'u beklemez
const pool = new Pool({
  connectionString,
  max: 30,
  idleTimeoutMillis: 600_000,
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
