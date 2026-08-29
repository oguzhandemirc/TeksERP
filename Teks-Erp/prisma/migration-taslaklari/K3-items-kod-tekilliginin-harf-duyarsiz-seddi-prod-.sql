-- =============================================================================
-- TASLAK K3 — `items`: kod tekilliğinin harf-duyarsız seddi `[PROD'DA ÇALIŞTIRMA]`
-- =============================================================================
-- ⚠️ BU DOSYA BİR MIGRATION DEĞİLDİR ve `prisma migrate deploy` onu ÇALIŞTIRMAZ.
-- Denetim (2026-08-29) tarafından ÖNERİ olarak yazıldı; sahaya uygulanmadan önce
-- (1) dev kopyada denenir, (2) kullanıcı onayı alınır, (3) VARDİYA DIŞINDA
-- gerçek migration dizinine taşınır. Geri alma yolu aşağıda yazılıdır.
-- Gerekçe ve ölçümler: audit/RAPOR-2026-08-29.md §12.1 (K3).
-- =============================================================================

-- ⚠️ **`EXPRESSION_UNIQUES` envanterine girdi ZORUNLU** (+predicate) — yoksa şema drift bekçisi bu index'i "fazlalık" sayar (CLAUDE.md 2026-08-25 renk seddi dersi). **Geri alma:** `DROP INDEX CONCURRENTLY items_code_fold_key;`

-- ── uygulama ──
-- Kapattığı bulgu: BULGU-T2-028 (saha 8 çakışma grubu, biri iki tarafı da AKTİF)
-- ÖN KOŞUL: 8 grubun 7 tarihseli birleştirilmiş/pasifleştirilmiş olmalı.
CREATE UNIQUE INDEX CONCURRENTLY items_code_fold_key
  ON items (upper(code)) WHERE "mergedIntoId" IS NULL;
