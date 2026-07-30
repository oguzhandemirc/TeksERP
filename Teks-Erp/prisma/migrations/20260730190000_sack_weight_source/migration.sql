-- Sack.weightSource — çuval brüt tartısının KAYNAĞI (SCALE | MANUAL | SIMULATED).
--
-- NEDEN: bu alandan önce simüle 47.3 kg ile gerçek 47.3 kg DB'de BİT-BİT AYNIYDI
-- (`Sack`'te yalnız weightKg/weighedById/weighedAt vardı). Çuval kg'si sevk
-- irsaliyesine VE çeki listesine basılır (müşteri/gümrük belgesi) → "bu sayı nereden
-- geldi?" sorusunun cevabı kalıcı olmalı. Backend `weighSack` zaten `source` alıyor ve
-- audit'e yazıyordu; audit yeterli bir denetim yüzeyi değil (arşivleniyor, sorgulanamaz).
--
-- ⚠️ NULLABLE ve DEFAULT'SUZ, bilinçli: mevcut CANLI satırların kaynağı gerçekten
-- BİLİNMİYOR. `DEFAULT 'MANUAL'` yazmak geçmişi UYDURUR. NULL = "bilinmiyor (legacy)".
--
-- CREATE TYPE + ALTER TABLE aynı dosyada GÜVENLİ: PostgreSQL'in 55P04 kısıtı yalnız
-- MEVCUT bir enum'a `ADD VALUE` eklerken geçerlidir (yeni değer aynı tx'te kullanılamaz);
-- YENİ tip yaratıp aynı tx'te kolonda kullanmak sorunsuzdur. (Karşılaştır:
-- 20260730120500_add_label_kind_sack — o AYRI dosya çünkü var olan LabelKind'a ekliyordu.)
--
-- Eklemeli + nullable + DEFAULT yok → tablo REWRITE YOK, ACCESS EXCLUSIVE kilidi
-- milisaniye mertebesinde. Canlı veriye dokunmaz, geri alınabilir (kolon DROP).
--
-- ⚠️ ELLE YAZILDI, `prisma migrate dev` ÜRETMEDİ. Sebep: `sacks` tablosunda
-- @@unique([id, shipmentId]) üstüne kurulu 2 adet DEFERRABLE raw-SQL composite FK var
-- (rolls/swatches ↔ sacks tutarlılık invariant'ı). Prisma'nın diff motoru bunları
-- datamodel'de göremediği için her migration'da DROP etmek ister.
-- Uygulama: `git add` → `prisma db execute` → `migrate resolve --applied` → DOĞRULA.
-- (Bkz. MIGRATION-DEPLOY.md "Elle yazılan migration'ı DEV'e uygulama".)

-- CreateEnum
CREATE TYPE "SackWeightSource" AS ENUM ('SCALE', 'MANUAL', 'SIMULATED');

-- AlterTable
ALTER TABLE "sacks" ADD COLUMN "weightSource" "SackWeightSource";
