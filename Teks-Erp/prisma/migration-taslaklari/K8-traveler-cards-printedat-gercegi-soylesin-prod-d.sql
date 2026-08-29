-- =============================================================================
-- TASLAK K8 — `traveler_cards.printedAt` gerçeği söylesin `[PROD'DA ÇALIŞTIRMA]`
-- =============================================================================
-- ⚠️ BU DOSYA BİR MIGRATION DEĞİLDİR ve `prisma migrate deploy` onu ÇALIŞTIRMAZ.
-- Denetim (2026-08-29) tarafından ÖNERİ olarak yazıldı; sahaya uygulanmadan önce
-- (1) dev kopyada denenir, (2) kullanıcı onayı alınır, (3) VARDİYA DIŞINDA
-- gerçek migration dizinine taşınır. Geri alma yolu aşağıda yazılıdır.
-- Gerekçe ve ölçümler: audit/RAPOR-2026-08-29.md §12.1 (K8).
-- =============================================================================

-- **Geri alma:** `SET DEFAULT now()` + O-12'nin kayıpsız geri yazımı.

-- ── uygulama ──
-- Kapattığı bulgu: BULGU-T2-024 (saha 42 kart hiç basılmadan 'basım tarihi' taşıyor)
-- ÖN KOŞUL: Bölüm 11 O-12 (mevcut 42 satır NULL'lanmış olmalı) ve K-9 kod düzeltmesi.
ALTER TABLE traveler_cards ALTER COLUMN "printedAt" DROP DEFAULT;
