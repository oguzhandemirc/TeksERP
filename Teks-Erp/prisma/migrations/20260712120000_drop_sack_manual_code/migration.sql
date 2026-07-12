-- Kod format redesign (2026-07-12): Sack.manualCode tamamen kaldırıldı.
-- Şablonlu operatör etiket kodu (AMB{SIRA:5}) yerine çuval yalnız sackNo
-- (CV + GGAAYY + NNNN) ile yürür. sack.codeTemplate system-setting'i de silindi.

-- Partial unique index (WHERE manualCode IS NOT NULL) — bkz. 20260622120000 / 20260711120000.
DROP INDEX IF EXISTS "sacks_manualCode_idx";

-- shipmentId+manualCode partial unique (faz4 hardening 20260708120000) — kalıntı varsa düşür.
DROP INDEX IF EXISTS "sacks_shipmentId_manualCode_idx";

ALTER TABLE "sacks" DROP COLUMN IF EXISTS "manualCode";

-- Çuval kodu şablonu ayarı artık yok.
DELETE FROM "system_settings" WHERE "key" = 'sack.codeTemplate';
