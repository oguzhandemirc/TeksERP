-- =============================================================================
-- TASLAK K2 — `items`: ad seddinin enforce'u `[PROD'DA ÇALIŞTIRMA]`
-- =============================================================================
-- ⚠️ BU DOSYA BİR MIGRATION DEĞİLDİR ve `prisma migrate deploy` onu ÇALIŞTIRMAZ.
-- Denetim (2026-08-29) tarafından ÖNERİ olarak yazıldı; sahaya uygulanmadan önce
-- (1) dev kopyada denenir, (2) kullanıcı onayı alınır, (3) VARDİYA DIŞINDA
-- gerçek migration dizinine taşınır. Geri alma yolu aşağıda yazılıdır.
-- Gerekçe ve ölçümler: audit/RAPOR-2026-08-29.md §12.1 (K2).
-- =============================================================================

-- **Kilit/etki:** `CONCURRENTLY` yazmaları engellemez; küçük tabloda metadata-only. Mükerrer varken **düşer** — bu yüzden O-10 ön koşuldur. **Geri alma:** `DROP INDEX CONCURRENTLY items_nameFold_key;`
-- Aynı şey `colors_nameFoldColor_key` için **dev'de** eksiktir (T2-009).

-- ── uygulama ──
-- Kapattığı bulgular: BULGU-T1-066 (saha 1 grup) · T2-009 · T1-007
-- ÖN KOŞUL: Bölüm 11 O-10 — v-1430 grubu panelden birleştirilmiş olmalı.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS items_nameFold_key
  ON items ("nameFold") WHERE "mergedIntoId" IS NULL;
