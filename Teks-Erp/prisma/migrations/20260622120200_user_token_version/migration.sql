-- users.tokenVersion: JWT iptal sayacı. Yetki grant/revoke/set + şifre sıfırlamada
-- artar; verifyToken her istekte token'daki sürümle karşılaştırır → eski oturum
-- anında 401 alır (iptal/yetki değişimi token expiry'sine kadar beklemez).
-- Mevcut satırlar 1'den başlar; bu deploy'dan ÖNCE üretilmiş (sürümsüz) tokenlar
-- bir kez re-login gerektirir (kabul edilebilir, temiz başlangıç).
ALTER TABLE "users" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 1;
