-- StationKind'a SHIPPING değeri (sevkiyat/tartı — üretim dışı, makinesiz istasyon).
-- (Manuel migration — repo konvansiyonu: psql apply + prisma migrate resolve --applied.)
--
-- ⚠️ AYRI MİGRATION OLMA SEBEBİ: PostgreSQL'de ALTER TYPE ... ADD VALUE, yeni değeri
-- KULLANAN bir statement ile aynı transaction'da çalışamaz (55P04 "unsafe use of new
-- value"). prisma migrate deploy her migration'ı tek tx'te koştuğundan enum ekleme ve
-- kullanan UPDATE (20260702121000_work_sessions) iki ayrı migration'a bölündü.
ALTER TYPE "StationKind" ADD VALUE IF NOT EXISTS 'SHIPPING';
