-- =============================================================================
-- TASLAK K4 — Birleştirme mezar taşı korunsun `[PROD'DA ÇALIŞTIRMA]`
-- =============================================================================
-- ⚠️ BU DOSYA BİR MIGRATION DEĞİLDİR ve `prisma migrate deploy` onu ÇALIŞTIRMAZ.
-- Denetim (2026-08-29) tarafından ÖNERİ olarak yazıldı; sahaya uygulanmadan önce
-- (1) dev kopyada denenir, (2) kullanıcı onayı alınır, (3) VARDİYA DIŞINDA
-- gerçek migration dizinine taşınır. Geri alma yolu aşağıda yazılıdır.
-- Gerekçe ve ölçümler: audit/RAPOR-2026-08-29.md §12.1 (K4).
-- =============================================================================

-- **Kilit/etki:** FK yeniden kurulumu referans tarama yapar (küçük tablolar, ms mertebesi). **ÖN KOŞUL:** mevcut tombstone'ların survivor'larının silinmemiş olduğu doğrulanmalı. **Geri alma:** aynı ifadenin `ON DELETE SET NULL` hâli.

-- ── uygulama ──
-- Kapattığı bulgu: BULGU-T1-035 (saha 9 tombstone; FK bugün SET NULL — confdeltype='n' ölçüldü)
-- 5 tablo: customers, items, subcontractors, colors, (+ mergedInto taşıyan diğerleri)
SET lock_timeout = '3s';
ALTER TABLE items DROP CONSTRAINT "items_mergedIntoId_fkey";
ALTER TABLE items ADD CONSTRAINT "items_mergedIntoId_fkey"
  FOREIGN KEY ("mergedIntoId") REFERENCES items(id) ON DELETE RESTRICT;
