-- =============================================================================
-- SEVK PARTİSİ — paketleme grubuna açık/kapalı durum + ambalaj no sayacı, çuvala
-- parti-içi ambalaj no (2026-09-21 saha isteği; docs/design/SEVK-PARTISI-TASARIM.md)
-- =============================================================================
-- NE YAPIYOR: `PackingGroupStatus` enum'unu kurar; `packing_groups`a `status`
-- (DEFAULT 'OPEN'), `closedAt`, `closedById`, `nextPackageNo` (DEFAULT 1) ekler;
-- `sacks`a NULLABLE `packageNo` ekler ve parti içinde tekilliğini kurar.
--
-- ADDITIVE Mİ: EVET — yalnız CREATE TYPE / ADD COLUMN / CREATE INDEX. Hiçbir mevcut
-- satır okunmaz, silinmez. Yeni davranış `packing.groupMode` ayarının (varsayılan
-- `grup` = bugünkü) arkasındadır: grup modunda `status` OPEN durur ve okunmaz,
-- `packageNo` NULL kalır — bugünkü ekranlar tek bayt değişmez.
--
-- ⚠️ Yeni TİP burada DOĞUYOR (`CREATE TYPE`) ⇒ aynı dosyada kullanılabilir (55P04
--   yalnız `ADD VALUE`a özgüdür — RECETELER § enum).
--
-- ÜRETİLMİŞ ÇIKTIDAN SİLİNEN SATIR: yok (dosya elle yazıldı — `migrate dev` bu
-- şemada DEFERRABLE composite FK'ları düşürmek istiyor).
--
-- İDEMPOTENT: her ifade IF NOT EXISTS / DO-EXCEPTION taşır (yarım kalan uygulama,
-- kopya DB ve prova restore'u ikinci koşumu NORMAL yol yapar).
--
-- statement_timeout: DOKUNULMADI. `packing_groups` küçük tablo; `sacks` üstündeki
-- DDL NULLABLE kolon eklemesidir (PG 11+ tabloyu yeniden yazmaz) ve unique index
-- bugün her satırda NULL olan kolon üzerindedir — ağaç boş kurulur.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE "PackingGroupStatus" AS ENUM ('OPEN', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "packing_groups"
  ADD COLUMN IF NOT EXISTS "status" "PackingGroupStatus" NOT NULL DEFAULT 'OPEN';
ALTER TABLE "packing_groups"
  ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMPTZ;
ALTER TABLE "packing_groups"
  ADD COLUMN IF NOT EXISTS "closedById" UUID;
ALTER TABLE "packing_groups"
  ADD COLUMN IF NOT EXISTS "nextPackageNo" INTEGER NOT NULL DEFAULT 1;

-- Parti listesi: "bu carinin AÇIK partileri".
CREATE INDEX IF NOT EXISTS "packing_groups_customerId_status_idx"
  ON "packing_groups"("customerId", "status");

ALTER TABLE "sacks"
  ADD COLUMN IF NOT EXISTS "packageNo" INTEGER;

-- Parti içinde ambalaj no benzersiz; NULL'lar çakışmaz (partisiz / numarasız çuval).
CREATE UNIQUE INDEX IF NOT EXISTS "sacks_packingGroupId_packageNo_key"
  ON "sacks"("packingGroupId", "packageNo");
