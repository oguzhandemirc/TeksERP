-- D4-B1a (2026-10-30) — MeterPhase'e CUT (Tambur kesim metresi; DALGA4 §3.4, ister 2.9).
-- Ayrı dosya: ADD VALUE yalnız kendi migration'ında (test_migration_enum_add_value §2/§3);
-- değer bu dosyada KULLANILMAZ. Kolon/CHECK değişimi 20261030020000_tambur_olcum_kaynagi'de.

-- AlterEnum
ALTER TYPE "MeterPhase" ADD VALUE IF NOT EXISTS 'CUT';
