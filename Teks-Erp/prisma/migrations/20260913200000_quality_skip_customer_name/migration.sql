-- QualityGrade.skipCustomerName — "bu kalitede müşterideki ad basılmaz" (2026-09-13)
--
-- Kullanıcı kararı: "a1 kumaşlarda kim için çıkarsa çıksın bizdeki adı yazsın."
-- Belge de etiket de BİZİM adımızı basar; sütun kapanmaz, yalnız o SATIRIN
-- hücresi bizim adımıza düşer (karar satır düzeyinde, sütun düzeyinde değil).
--
-- ⚠️ KOLON VARSAYILANI false = BUGÜNKÜ DAVRANIŞ. Politikayı taşıyan şey kolonun
-- kendisi değil, aşağıdaki damgadır.
ALTER TABLE "quality_grades"
  ADD COLUMN IF NOT EXISTS "skipCustomerName" BOOLEAN NOT NULL DEFAULT false;

-- ⚠️ DAMGA ROLDEN, KODDAN DEĞİL — kardeş kolon `skipLabel`in migration'ı
-- `WHERE "code" = 'FIRE'` yazmıştı ve katalogu farklı olan bir kurulumda HİÇBİR
-- satırı damgalamaz (karar ①'in kapattığı kırılganlık sınıfı). Rol kurulumdan
-- bağımsızdır: `SECOND` her fabrikada "2. kalite"dir, kod fabrikaya aittir.
-- Rolü atanmamış katalogda hiçbir satır damgalanmaz ve kolon varsayılanda kalır
-- (= bugünkü davranış) — sessiz yanlış damga yerine görünür bir eksik.
UPDATE "quality_grades" SET "skipCustomerName" = true WHERE "role" = 'SECOND';
