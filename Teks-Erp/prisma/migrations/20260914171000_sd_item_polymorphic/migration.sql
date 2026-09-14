-- =============================================================================
-- POLİMORFİK FASON SEVK KALEMİ — F1 LEVENT (2026-09-14 · 2/2): kalem `kind` (ROLL | WARP_BEAM),
-- levent bağı, levent defterine dört tür (SHIP_OUT · SHIP_OUT_CANCEL · RETURNED_IN · RETURNED_IN_CANCEL)
-- =============================================================================
-- Tasarım: docs/design/DEVERE-LEVENT-TARAMASI.md §3.9 (akıbet ekseni) + AYRI DİLİM satırı; hüküm 1e 2026-09-14.
-- Tamamen EKLEMELİ; `rollId` NOT NULL → NULL anlık, veri değişmez; `kind` DEFAULT 'ROLL' backfill'siz
-- (= bugünkü davranış). `SHIPPED_OUT` değeri 170000'de doğdu (55P04) — burada yalnız yüklemde ANILIR.
-- ⚠️ İDEMPOTENT ([DB-23], RECETELER migration 11): her ifade ikinci koşumda sessiz geçer; kind_ck ve
--   physical_live_uq DROP+ADD ile "son hâl" yazılır (iki koşumda aynı sonuç).

-- ── 1) Kalem türü ─────────────────────────────────────────────────────────────
-- Yeni TİP burada doğuyor ⇒ aynı dosyada kullanılabilir (RECETELER § enum: 55P04 yalnız ADD VALUE'a özgü).
-- YARN değeri F3'te kendi ADD VALUE dosyasıyla — yazıcısı olmayan değer enum'a girmez (geri alınamaz).
DO $$ BEGIN
  CREATE TYPE "SubcontractorDispatchItemKind" AS ENUM ('ROLL', 'WARP_BEAM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "subcontractor_dispatch_items"
  ADD COLUMN IF NOT EXISTS "kind" "SubcontractorDispatchItemKind" NOT NULL DEFAULT 'ROLL';
ALTER TABLE "subcontractor_dispatch_items" ALTER COLUMN "rollId" DROP NOT NULL;
ALTER TABLE "subcontractor_dispatch_items" ADD COLUMN IF NOT EXISTS "warpBeamId" uuid;

CREATE INDEX IF NOT EXISTS "subcontractor_dispatch_items_warpBeamId_idx" ON "subcontractor_dispatch_items" ("warpBeamId");
-- Aynı levent aynı sevke iki kez yazılamaz (düz unique: PG NULL'ları ayrı sayar, top kalemleri çakışmaz —
-- `@@unique([dispatchId, rollId])` ile simetri; partial yazmak Prisma'da drift doğururdu).
CREATE UNIQUE INDEX IF NOT EXISTS "subcontractor_dispatch_items_dispatchId_warpBeamId_key"
  ON "subcontractor_dispatch_items" ("dispatchId", "warpBeamId");

DO $$ BEGIN
  ALTER TABLE "subcontractor_dispatch_items"
    ADD CONSTRAINT "subcontractor_dispatch_items_warpBeamId_fkey" FOREIGN KEY ("warpBeamId") REFERENCES "warp_beams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tür ↔ bağ XOR'u: ROLL ⇒ yalnız top · WARP_BEAM ⇒ yalnız levent (ikisi de dolu / ikisi de boş imkânsız).
DO $$ BEGIN
  ALTER TABLE "subcontractor_dispatch_items" ADD CONSTRAINT "subcontractor_dispatch_items_kind_ref_ck" CHECK (
    ("kind" = 'ROLL'      AND "rollId" IS NOT NULL AND "warpBeamId" IS NULL) OR
    ("kind" = 'WARP_BEAM' AND "warpBeamId" IS NOT NULL AND "rollId" IS NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2) Levent defteri: fason türleri + kalem bağı ─────────────────────────────
-- Olay hangi sevk kalemine hizmet ediyor — aynı levent zamanla birden çok sevke girer (git → dön → git);
-- "bu sevkin SHIP_OUT'u" bağsız bulunamaz, iptal komşu sevkin satırını hedeflerdi.
ALTER TABLE "warp_beam_events" ADD COLUMN IF NOT EXISTS "dispatchItemId" uuid;
CREATE INDEX IF NOT EXISTS "warp_beam_events_dispatchItemId_idx" ON "warp_beam_events" ("dispatchItemId");
DO $$ BEGIN
  ALTER TABLE "warp_beam_events"
    ADD CONSTRAINT "warp_beam_events_dispatchItemId_fkey" FOREIGN KEY ("dispatchItemId") REFERENCES "subcontractor_dispatch_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tür listesi `constants/warp-beam.ts` WARP_BEAM_EVENT_KINDS ile BİREBİR (bekçi SON tanımı okur, iki yönlü).
ALTER TABLE "warp_beam_events" DROP CONSTRAINT IF EXISTS "warp_beam_events_kind_ck";
ALTER TABLE "warp_beam_events" ADD CONSTRAINT "warp_beam_events_kind_ck" CHECK ("kind" IN ('WOUND', 'WOUND_CANCEL', 'SHIP_OUT', 'SHIP_OUT_CANCEL', 'RETURNED_IN', 'RETURNED_IN_CANCEL'));

-- İKİ YÖNLÜ: fason türü ⇔ kalem bağı dolu (WOUND satırı kalem taşıyamaz, fason satırı bağsız yazılamaz).
DO $$ BEGIN
  ALTER TABLE "warp_beam_events" ADD CONSTRAINT "warp_beam_events_fason_item_ck" CHECK (
    ("kind" IN ('SHIP_OUT', 'SHIP_OUT_CANCEL', 'RETURNED_IN', 'RETURNED_IN_CANCEL')) = ("dispatchItemId" IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Bir kalem bir kez çıkar (iptali sevk iptalidir, kalem yeniden çıkmaz); dönüş tekrarlanabilir (dön → iptal → dön).
CREATE UNIQUE INDEX IF NOT EXISTS "warp_beam_events_ship_out_item_uq" ON "warp_beam_events" ("dispatchItemId") WHERE "kind" = 'SHIP_OUT';

-- ── 3) Gövde seddi: dışarıdaki levent de gövdeyi işgal eder ────────────────────
-- Fasondaki çözgü hâlâ o metal gövdededir; READY'ye daraltılmış sed SHIPPED_OUT'ta ikinci sarıma izin verirdi.
DROP INDEX IF EXISTS "warp_beams_physical_live_uq";
CREATE UNIQUE INDEX IF NOT EXISTS "warp_beams_physical_live_uq"
  ON "warp_beams" (public.tr_fold("physicalBeamNo"))
  WHERE "status" IN ('READY', 'SHIPPED_OUT') AND "physicalBeamNo" IS NOT NULL;
