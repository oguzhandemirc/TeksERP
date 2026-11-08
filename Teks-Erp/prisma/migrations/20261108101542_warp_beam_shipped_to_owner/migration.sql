-- Genel fason dalga-2 ŞEMA ÖNCÜSÜ (2026-11-08) — F5: emanet levent sahibine verildi durumu.
-- Yazıcısı ilgili dilimde (F4/F5); bu dosya YALNIZ enum değerini açar.
-- ⚠️ ALTER TYPE ... ADD VALUE, değeri KULLANAN ifadeyle aynı tx'te olamaz (PG 55P04) → TEK ifade;
-- değeri kullanan CHECK/kolonlar 20261108101550_fason_wave2_schema'da.
ALTER TYPE "WarpBeamStatus" ADD VALUE IF NOT EXISTS 'SHIPPED_TO_OWNER';
