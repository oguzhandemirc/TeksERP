-- TOTP sırrı DB'de `enc1:<kid>:<b64url>` sarmalıyla saklanır (anahtar LICENSE_DIR halkasından); sarılı değer
-- 64 karakteri aşar. ADDITIVE: yalnız iki kolonu genişletir, veri DÖNÜŞTÜRMEZ (düz sırları açılış işi sarar),
-- DEFERRABLE FK'lara dokunmaz. İdempotent: aynı tipe yeniden ALTER no-op'tur.
ALTER TABLE "totp_enrollments" ALTER COLUMN "secret" SET DATA TYPE VARCHAR(200);
ALTER TABLE "users" ALTER COLUMN "totpSecret" SET DATA TYPE VARCHAR(200);
