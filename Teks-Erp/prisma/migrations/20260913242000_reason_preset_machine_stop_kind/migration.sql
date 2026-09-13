-- =============================================================================
-- `ReasonPresetKind` + MACHINE_STOP (2026-09-13, dokuma P2b-2 · adım 1/2)
-- =============================================================================
-- ⚠️ BU DOSYA BİLEREK TEK İFADEDİR. Yeni bir enum DEĞERİ onu yaratan tx'te
--   KULLANILAMAZ (PostgreSQL 55P04 "unsafe use of new value of enum type");
--   Prisma her migration dosyasını tek tx'te koşar ⇒ değeri kullanan hiçbir
--   ifade (INSERT · UPDATE · DEFAULT · CHECK · CAST) buraya GİRMEZ. Kolon ve
--   CHECK bir SONRAKİ dosyada (…243000). Emsal: 20260826130000 (ORDER_CANCEL).
--   Bu, `CREATE TYPE` + `CREATE TABLE` tek-dosya emsalinin İSTİSNASIDIR —
--   ayrım `docs/RECETELER.md` § enum'da yazılı: tehlike ADD VALUE'a özgüdür.
--
-- ⛔ GERİ ALINAMAZ: PostgreSQL enum değeri düşürmeyi desteklemez. Bu dilim
--   sürümden UZAK olduğu anda iniyor (fabrikaya çıkış ertelendi) — yanlışı
--   görme penceresi en geniş orada.
--
-- `IF NOT EXISTS` ŞART: defter-dışı açılmış bir değer sonraki `migrate deploy`i
--   durdurmasın (`test_migration_enum_add_value` bunu zorlar).
-- =============================================================================

ALTER TYPE "ReasonPresetKind" ADD VALUE IF NOT EXISTS 'MACHINE_STOP';
