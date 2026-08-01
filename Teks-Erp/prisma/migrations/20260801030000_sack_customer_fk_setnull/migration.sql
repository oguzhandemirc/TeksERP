-- =============================================================================
-- sacks_customerId_fkey → ON DELETE SET NULL  (KAYIP MIGRATION'IN TELAFİSİ)
-- =============================================================================
-- NEDEN: `Sack.customerId` 2026-07-12'de opsiyonel yapıldı
-- (20260712000000_cuval_depo_no_seal → `ALTER COLUMN "customerId" DROP NOT NULL`),
-- ama FK'nın kendisi hiç yeniden yazılmadı. Prisma datamodel'de opsiyonel bir
-- relation'ın varsayılanı `ON DELETE SET NULL`'dur → o günden beri şema ile DB
-- ayrı şey söylüyor:
--
--   schema.prisma (Sack.customer = Customer?, onDelete YOK)  → SET NULL
--   migration'lardan kurulan DB (üretim!)                     → RESTRICT
--
-- Fark SESSİZ kaldı çünkü dev DB'sinde bir `migrate dev` koşumu FK'yı SET NULL'a
-- çevirmişti; dev'de her şey doğru görünüyordu. `migrate deploy` yalnız dizindeki
-- migration'ları uygular → **canlıda düzeltme hiç uygulanmadı**. Üstelik
-- 20260715154754 başlığı bu farkı "spurious drift" sanıp drop/recreate satırlarını
-- KASTEN çıkarmıştı — oysa composite/DEFERRABLE FK'ların aksine `onDelete`
-- datamodel'de TEMSİL EDİLEBİLİR, yani gerçek bir şema farkıydı.
--
-- Yön neden SET NULL (RESTRICT'e geri değil): `CustomerService.hardDelete` artık
-- çuval sayımını EXPLICIT yapıyor (`sackCount > 0` → 409, bkz. customer.service.ts
-- + scripts/test_customer_sack_delete_guard.ts). Yani müşteri silme guard'ı artık
-- DB'nin P2003'üne dayanmıyor; uygulama katmanı zaten bloklar. Beyan edilen şema
-- (SET NULL) tek doğruluk kaynağı olsun.
--
-- GÜVENLİ: yalnız constraint tanımı değişir — satır okunmaz/yazılmaz, rewrite yok.
-- Dev gibi zaten SET NULL olan DB'lerde no-op (drop + aynı tanımla add).
-- Kilit: `sacks` + `customers` üzerinde kısa ACCESS EXCLUSIVE; iki tablo da küçük.
--
-- Bekçi: scripts/test_schema_drift.ts — bu migration'dan sonra repo şeması ile
-- canlı DB arasında yalnız 2 bilinen composite FK farkı kalmalı.
-- =============================================================================

ALTER TABLE "sacks" DROP CONSTRAINT IF EXISTS "sacks_customerId_fkey";

ALTER TABLE "sacks" ADD CONSTRAINT "sacks_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
