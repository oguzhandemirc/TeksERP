-- =============================================================================
-- TASLAK K1 — `rolls`: metraj üst sınırı `[PROD'DA ÇALIŞTIRMA]`
-- =============================================================================
-- ⚠️ BU DOSYA BİR MIGRATION DEĞİLDİR ve `prisma migrate deploy` onu ÇALIŞTIRMAZ.
-- Denetim (2026-08-29) tarafından ÖNERİ olarak yazıldı; sahaya uygulanmadan önce
-- (1) dev kopyada denenir, (2) kullanıcı onayı alınır, (3) VARDİYA DIŞINDA
-- gerçek migration dizinine taşınır. Geri alma yolu aşağıda yazılıdır.
-- Gerekçe ve ölçümler: audit/RAPOR-2026-08-29.md §12.1 (K1).
-- =============================================================================

-- **Kilit/etki:** `NOT VALID` sayesinde tam tablo taraması YOK; kısa `ACCESS EXCLUSIVE`. Mevcut **2 ihlal satırı deploy'u düşürmez** — `nameFold` "yumuşak kapı" emsalinin birebir uygulaması. `VALIDATE` adımı `SHARE UPDATE EXCLUSIVE` alır, yazmaları engellemez. **Geri alma:** `ALTER TABLE rolls DROP CONSTRAINT rolls_qty_le_initial;`
-- ⚠️ Geri alma bump'ı (`tambur-undo`) `initialQty`'yi aynı ifadede yükselttiği için yeni yazımlar bu CHECK'ten geçer (T1-044 analizi).

-- ── uygulama ──
-- Kapattığı bulgular: BULGU-T1-044 (saha 2 satır) · T1-001 · T1-002 · T3-011 · T2-016
-- ÖN KOŞUL: K-3 (cutWarehouseRoll yalnız currentQty düşürsün) SAHAYA ÇIKMIŞ OLMALI.
SET lock_timeout = '3s';
ALTER TABLE rolls
  ADD CONSTRAINT rolls_qty_le_initial
  CHECK ("currentQty" <= "initialQty") NOT VALID;
-- Temizlik (Bölüm 11 O-3) bittikten SONRA:
-- ALTER TABLE rolls VALIDATE CONSTRAINT rolls_qty_le_initial;
