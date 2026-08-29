-- =============================================================================
-- TASLAK K5 — İş emri ↔ sipariş bağı silinmesin `[PROD'DA ÇALIŞTIRMA]`
-- =============================================================================
-- ⚠️ BU DOSYA BİR MIGRATION DEĞİLDİR ve `prisma migrate deploy` onu ÇALIŞTIRMAZ.
-- Denetim (2026-08-29) tarafından ÖNERİ olarak yazıldı; sahaya uygulanmadan önce
-- (1) dev kopyada denenir, (2) kullanıcı onayı alınır, (3) VARDİYA DIŞINDA
-- gerçek migration dizinine taşınır. Geri alma yolu aşağıda yazılıdır.
-- Gerekçe ve ölçümler: audit/RAPOR-2026-08-29.md §12.1 (K5).
-- =============================================================================

-- ⚠️ Bu kısıt **kod düzeltmesinin yerine geçmez** — `replace` yolu artık 409 döneceği için kullanıcıya okunaklı mesaj (O-1'deki "kalemi İPTAL edin") **önce** yazılmalıdır; yoksa panelde ham FK hatası görünür. **Geri alma:** `ON DELETE CASCADE`.

-- ── uygulama ──
-- Kapattığı bulgu: BULGU-T1-100 (saha 3 satır bugün silinmeye açık)
ALTER TABLE work_order_to_order_lines
  DROP CONSTRAINT "work_order_to_order_lines_orderLineId_fkey";
ALTER TABLE work_order_to_order_lines
  ADD CONSTRAINT "work_order_to_order_lines_orderLineId_fkey"
  FOREIGN KEY ("orderLineId") REFERENCES order_lines(id) ON DELETE RESTRICT;
