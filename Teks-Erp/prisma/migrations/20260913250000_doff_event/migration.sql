-- =============================================================================
-- DOKUMA P3 — `DoffEvent` (top indirme DEFTERİ) + `rolls.doffEventId` (2026-09-13)
-- =============================================================================
-- Tasarım: docs/design/DOKUMA-IS-EMRI-VE-TABLET-TASARIMI.md §3.8. Tezgahtan kumaş
-- indiği AN'ın kaydı; top BURADA DOĞMAZ (KK1'de `entrySource=WEAVING` ile doğar ve
-- `doffEventId` ile bağlanır). Append-only: `updatedAt` YOK, geri alma `revokedAt`.
--
-- `--create-only` çıktısından İKİ şey çıkarıldı:
--   1) DEFERRABLE composite FK'ların `DropForeignKey` satırları (rolls · swatches) —
--      düz koşum onları düşürür (kök CLAUDE.md yasak listesi).
--   2) `ALTER TYPE "RollEntrySource" ADD VALUE 'WEAVING'` — KENDİ dosyasına
--      (`…251000_roll_entry_source_weaving`): var olan tipe değer eklemek PG 55P04
--      kısıtına tabidir, `test_migration_enum_add_value` zorlar. Bu tablo o değeri
--      KULLANMAZ, sıra serbest.
--
-- İNDEKSLER: iki domain FK'sı ([DB-12]: machineRunId · rolls.doffEventId) + bir
--   composite (eşitlik önce: makine, sonra zaman). `revokedById`/`createdById`
--   BİLİNÇLİ INDEXSİZ ve FK'sız (MachineRun emsali, [DB-11]).
-- CHECK: `doff_events_pieceCount_pos` — sıfır parçalı doff bir doff değildir.
--   Envanter: `test_db_invariants` CHECK listesi + `error.middleware` mesajı.
-- FK'lar RESTRICT: gerçekleşmiş bir indirmenin bağlamı (makine · koşum) sessizce
--   silinmez; topu doğurmuş indirme silinemez (rolls.doffEventId RESTRICT).
--
-- ⚠️ `statement_timeout = 0` GEREKMİYOR: doff_events boş doğuyor; `rolls` üstündeki
--   tek index (`rolls_doffEventId_idx`) NULL'lardan oluşur, tarama küçük.
-- =============================================================================

-- AlterTable
ALTER TABLE "rolls" ADD COLUMN     "doffEventId" UUID;

-- CreateTable
CREATE TABLE "doff_events" (
    "id" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "productionLineNo" INTEGER NOT NULL DEFAULT 1,
    "machineRunId" UUID,
    "doffedAt" TIMESTAMPTZ NOT NULL,
    "pieceCount" INTEGER NOT NULL,
    "counterAtDoff" DECIMAL(18,0),
    "counterSource" "MachineDataSource" NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "notes" VARCHAR(300),
    "clientToken" UUID,
    "revokedAt" TIMESTAMPTZ,
    "revokedById" UUID,
    "revokeReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "doff_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "doff_events_pieceCount_pos" CHECK ("pieceCount" >= 1),
    CONSTRAINT "doff_events_productionLineNo_pos" CHECK ("productionLineNo" >= 1)
);

-- CreateIndex
CREATE UNIQUE INDEX "doff_events_code_key" ON "doff_events"("code");

-- CreateIndex
CREATE UNIQUE INDEX "doff_events_clientToken_key" ON "doff_events"("clientToken");

-- CreateIndex
CREATE INDEX "doff_events_machineId_doffedAt_idx" ON "doff_events"("machineId", "doffedAt");

-- CreateIndex
CREATE INDEX "doff_events_machineRunId_idx" ON "doff_events"("machineRunId");

-- CreateIndex
CREATE INDEX "rolls_doffEventId_idx" ON "rolls"("doffEventId");

-- AddForeignKey
ALTER TABLE "doff_events" ADD CONSTRAINT "doff_events_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doff_events" ADD CONSTRAINT "doff_events_machineRunId_fkey" FOREIGN KEY ("machineRunId") REFERENCES "machine_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_doffEventId_fkey" FOREIGN KEY ("doffEventId") REFERENCES "doff_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
