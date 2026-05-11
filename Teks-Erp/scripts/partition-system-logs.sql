-- =============================================================================
-- SystemLog → Aylık RANGE Partition (Operasyonel Playbook)
-- =============================================================================
-- NE ZAMAN ÇALIŞTIR
--   SystemLog 1M+ satıra ulaştığında. Bu noktaya kadar normal B-tree index'ler
--   yeterli; partition operasyonel karmaşıklığa değmez.
--
-- KESİNTİ
--   App SystemLog'a sürekli yazar (her CUD audit). Migration sırasında app'i
--   durdur. Tahmini kesinti: 1M satır için ~30-60 saniye (yerel DB).
--
-- ADIMLAR
--   1. Backend'i durdur: pm2 stop teks-erp veya systemctl stop ...
--   2. Bu script'i psql ile çalıştır.
--   3. Prisma şema değişikliği (composite PK) — bu dosyanın altındaki notları izle.
--   4. npx prisma generate
--   5. Tüm import yerlerinde (audit.service.ts) findUnique({ id_createdAt }) kullan.
--   6. Backend'i yeniden başlat.
--
-- GERİ ALMA (rollback)
--   Eski tablo "system_logs_old" olarak korunur. Sorun çıkarsa:
--     DROP TABLE system_logs;
--     ALTER TABLE system_logs_old RENAME TO system_logs;
-- =============================================================================

BEGIN;

-- 1. Eski tabloyu yedek olarak sakla
ALTER TABLE "system_logs" RENAME TO "system_logs_old";

-- Eski index/constraint'leri rename et (yeni tablo aynı adı kullanacak)
ALTER INDEX IF EXISTS "system_logs_pkey" RENAME TO "system_logs_old_pkey";
ALTER INDEX IF EXISTS "system_logs_createdAt_idx" RENAME TO "system_logs_old_createdAt_idx";
ALTER INDEX IF EXISTS "system_logs_tableName_recordId_idx" RENAME TO "system_logs_old_tableName_recordId_idx";
ALTER INDEX IF EXISTS "system_logs_userId_idx" RENAME TO "system_logs_old_userId_idx";

-- 2. Yeni partitioned ana tablo
-- NOT: PK partitioning key'i içermek ZORUNDA → (id, createdAt) composite.
-- Prisma şemasında @@id([id, createdAt], name: "uniqueLog") ile karşılığı verilmeli.
CREATE TABLE "system_logs" (
    "id"        TEXT  NOT NULL,
    "userId"    TEXT,
    "action"    TEXT  NOT NULL,
    "tableName" TEXT  NOT NULL,
    "recordId"  TEXT  NOT NULL,
    "oldData"   JSONB,
    "newData"   JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id", "createdAt")
) PARTITION BY RANGE ("createdAt");

-- 3. FK
ALTER TABLE "system_logs"
  ADD CONSTRAINT "system_logs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Bu ay + sonraki 12 ay için partition'lar (otomatik üretim için pg_partman önerilir,
-- şimdilik elle).
-- DİKKAT: Tarihleri bugünden itibaren ayarla. Aşağıdaki örnek 2026-05'ten 2027-05'e:
CREATE TABLE "system_logs_2026_05" PARTITION OF "system_logs"
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE "system_logs_2026_06" PARTITION OF "system_logs"
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE "system_logs_2026_07" PARTITION OF "system_logs"
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE "system_logs_2026_08" PARTITION OF "system_logs"
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE "system_logs_2026_09" PARTITION OF "system_logs"
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE "system_logs_2026_10" PARTITION OF "system_logs"
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE "system_logs_2026_11" PARTITION OF "system_logs"
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE "system_logs_2026_12" PARTITION OF "system_logs"
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE "system_logs_2027_01" PARTITION OF "system_logs"
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE "system_logs_2027_02" PARTITION OF "system_logs"
  FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE "system_logs_2027_03" PARTITION OF "system_logs"
  FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE "system_logs_2027_04" PARTITION OF "system_logs"
  FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE "system_logs_2027_05" PARTITION OF "system_logs"
  FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');

-- Geçmiş veri için catch-all (eski kayıtlar)
CREATE TABLE "system_logs_legacy" PARTITION OF "system_logs"
  FOR VALUES FROM (MINVALUE) TO ('2026-05-01');

-- 5. Partitioned tabloya index'ler (her partition'a otomatik kopyalanır)
CREATE INDEX "system_logs_createdAt_idx" ON "system_logs" ("createdAt");
CREATE INDEX "system_logs_tableName_recordId_idx" ON "system_logs" ("tableName", "recordId");
CREATE INDEX "system_logs_userId_idx" ON "system_logs" ("userId");

-- 6. Veriyi taşı (partitioning key'e göre PostgreSQL otomatik dağıtır)
INSERT INTO "system_logs" SELECT * FROM "system_logs_old";

COMMIT;

-- 7. Doğrulama (kesintiden ÖNCE çalıştır, eşit row count beklenir)
-- SELECT (SELECT count(*) FROM system_logs_old) AS old_count,
--        (SELECT count(*) FROM system_logs) AS new_count;

-- 8. Doğrulamadan sonra eski tabloyu sil:
-- DROP TABLE "system_logs_old";

-- =============================================================================
-- PRISMA ŞEMA DEĞİŞİKLİĞİ (manuel)
-- =============================================================================
-- prisma/schema.prisma içinde SystemLog modeli:
--
--   model SystemLog {
--     id        String   @default(uuid())
--     userId    String?
--     action    String
--     tableName String
--     recordId  String
--     oldData   Json?
--     newData   Json?
--     createdAt DateTime @default(now())
--     updatedAt DateTime @updatedAt
--
--     user User? @relation(fields: [userId], references: [id])
--
--     @@id([id, createdAt])    // ← composite PK (partition key dahil)
--     @@index([createdAt])
--     @@index([tableName, recordId])
--     @@index([userId])
--     @@map("system_logs")
--   }
--
-- Bu değişiklik audit.service.ts'in delete/update sorgularını etkilemez
-- (zaten yapmıyoruz; SystemLog append-only). findUnique kullanımı yoksa
-- hiçbir kod değişikliği gerekmez. ARCHIVE servisi gerekirse
-- where: { createdAt: { lt: cutoff } } pattern'iyle çalışır.
--
-- =============================================================================
-- AYLIK BAKIM (otomatikleştirilebilir)
-- =============================================================================
-- Her ay 1'inde sonraki ayın partition'ını oluşturmak için cron veya
-- pg_partman kullan. Manuel:
--
--   CREATE TABLE "system_logs_2027_06" PARTITION OF "system_logs"
--     FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
--
-- 12 aydan eski partition'ları DETACH ile arşive alıp DROP'la silebilirsin
-- (mevcut archiveOlderThan akışı buna uyumlu).
-- =============================================================================
