-- =============================================================================
-- `LabelKind` + MACHINE (tezgah etiketi — dokuma manuel veri S1b, D3)
-- =============================================================================
-- ADDITIVE. ⚠️ YALNIZ ADD VALUE (PG 55P04: yeni değer onu yaratan tx'te kullanılamaz);
--   değeri kullanan ifade bu dosyada YOK. Şablon/atama yalnız panelden doğar, migration
--   veri yazmaz. İdempotent (`IF NOT EXISTS`). Geri alınamaz (PG enum değeri düşürmez).
ALTER TYPE "LabelKind" ADD VALUE IF NOT EXISTS 'MACHINE';
