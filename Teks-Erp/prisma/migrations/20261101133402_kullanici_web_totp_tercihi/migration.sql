-- Kullanıcı tercihi: web (tarayıcı) girişinde TOTP'yi KENDİ hesabında kapatma (2026-11-01).
-- NULL'suz DEFAULT false: mevcut satırlar bugünkü davranışta kalır; toplu UPDATE yok.
ALTER TABLE "users" ADD COLUMN "webTotpOptOut" BOOLEAN NOT NULL DEFAULT false;

-- Sistem hesabı (süperadmin) web'de HER ZAMAN kod verir: tercih onda kapatılamaz.
ALTER TABLE "users" ADD CONSTRAINT "users_web_totp_opt_out_not_system_check"
  CHECK (NOT ("isSystemAccount" AND "webTotpOptOut"));
