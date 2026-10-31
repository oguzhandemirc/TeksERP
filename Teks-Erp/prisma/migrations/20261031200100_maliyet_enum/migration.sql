-- =============================================================================
-- SEYİTOĞLU MİG-2a — MALİYET ENUM DEĞERLERİ (SY-D1 şema kısmı) — 2026-10-31
-- =============================================================================
-- YALNIZ `ALTER TYPE … ADD VALUE IF NOT EXISTS`: yeni değer AYNI tx'te kullanılamaz (PG
-- kısıtı) → bu dosyada hiçbir ifade onları KULLANMAZ; kullanan DDL/veri sonraki dosyalarda.
-- `CostComponent` += WEAVING_PICK (§5 atkı ücreti satırı), PROCESS (§8 proses tarifesi satırı);
-- `FinishingBasis` += KG (§6 kg bazlı boyahane tarifesi). Mevcut satırlar değişmez.
-- =============================================================================

ALTER TYPE "CostComponent" ADD VALUE IF NOT EXISTS 'WEAVING_PICK';
ALTER TYPE "CostComponent" ADD VALUE IF NOT EXISTS 'PROCESS';
ALTER TYPE "FinishingBasis" ADD VALUE IF NOT EXISTS 'KG';
