-- =============================================================================
-- TASLAK K7 — Rapor ve iz indeksleri `[PROD'DA ÇALIŞTIRMA]`
-- =============================================================================
-- ⚠️ BU DOSYA BİR MIGRATION DEĞİLDİR ve `prisma migrate deploy` onu ÇALIŞTIRMAZ.
-- Denetim (2026-08-29) tarafından ÖNERİ olarak yazıldı; sahaya uygulanmadan önce
-- (1) dev kopyada denenir, (2) kullanıcı onayı alınır, (3) VARDİYA DIŞINDA
-- gerçek migration dizinine taşınır. Geri alma yolu aşağıda yazılıdır.
-- Gerekçe ve ölçümler: audit/RAPOR-2026-08-29.md §12.1 (K7).
-- =============================================================================

-- **Kilit/etki:** `CONCURRENTLY` yazmayı engellemez ama **iki tam tarama** yapar; vardiya dışında koşulmalı. 85 indekssiz FK'nın (T1-159) tamamı **BİLİNÇLİ olarak eklenmiyor** — hepsi `*ById` iz kolonu, bugün zararsız; eklemek her yazmaya indeks bakım maliyeti bindirir (T1-057: güncellemelerin %99,4'ü zaten HOT değil). **Geri alma:** `DROP INDEX CONCURRENTLY …`

-- ── uygulama ──
-- Kapattığı bulgular: BULGU-T1-120 (saha 278 satırlık tarih ekseni indekssiz) · T1-058 · T1-159
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_orderDate_idx   ON orders ("orderDate");
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_completedAt_idx ON orders ("completedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS rolls_directShipmentId_idx
  ON rolls ("directShipmentId") WHERE "directShipmentId" IS NOT NULL;
