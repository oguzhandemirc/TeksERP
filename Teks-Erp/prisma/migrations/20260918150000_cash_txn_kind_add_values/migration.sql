-- KASA BAKİYESİ TEK YAZAR (2026-09-18) — 1/3: `CashTxnKind` += COLLECTION (tahsilat, IN) · PAYMENT (ödeme, OUT).
-- YALNIZ ADD VALUE (test_migration_enum_add_value §3): yeni etiketi kullanan ifade aynı tx'te 55P04 verir → kolon/FK 150050'de, CHECK 150100'de.
-- İDEMPOTENT: IF NOT EXISTS.
ALTER TYPE "CashTxnKind" ADD VALUE IF NOT EXISTS 'COLLECTION';
ALTER TYPE "CashTxnKind" ADD VALUE IF NOT EXISTS 'PAYMENT';
