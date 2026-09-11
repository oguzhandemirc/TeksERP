-- =============================================================================
-- `roll_operations` TAM unique'i düşür — partial olan zaten var (B-4a onarımı)
-- =============================================================================
-- 20260911170000 partial unique'i kurdu ama eski kısıtı `DROP CONSTRAINT IF
-- EXISTS` ile düşürmeye çalıştı; Prisma onu UNIQUE CONSTRAINT değil UNIQUE INDEX
-- olarak yaratmış olduğu için ifade SESSİZCE hiçbir şey yapmadı (IF EXISTS).
-- Sonuç: tam kısıt ayakta kaldı ve geri alınmış satır dururken aynı üçlü yeniden
-- yazılamadı — yani B-4a'nın ASIL kazanımı çalışmıyordu. Bekçi §2 yakaladı.
--
-- ⚠️ DERS: Prisma'nın `@@unique`i INDEX üretir; düşürmek için `DROP INDEX`
-- gerekir, `DROP CONSTRAINT` değil.
--
-- GÜVENLİ: yalnız fazlalık kısıt düşer. Tekillik korunur — partial index aktif
-- satırlar için aynı kuralı uygular.
-- =============================================================================

DROP INDEX IF EXISTS "roll_operations_rollId_workOrderStepId_operationType_key";
