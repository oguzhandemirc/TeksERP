-- VARSAYILAN SÜPERADMİN (kullanıcı kararı 2026-10-11): kurulumda hiç satıcı hesabı yoksa boot,
-- ortak kullanıcı adı + ortak parolayla varsayılan hesap doğurur; ilk girişte parola değişimi zorunlu.
-- İki DURUM kolonu (defter değil — "ne oldu" audit + USER_PASSWORD olayında):
--   "defaultPasswordIssuedAt"  — hesap ortak varsayılan parolayla doğdu (yalnız sistem hesabında dolu).
--   "defaultPasswordChangedAt" — varsayılan parola ilk kez değiştirildi; panel/portal uyarısı bununla kapanır.
-- ADDITIVE: iki nullable kolon + iki CHECK; mevcut satırlar NULL (hiçbiri varsayılanla doğmadı), veri
-- dönüşümü yok, kilit süresi ihmal edilebilir. İdempotent.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "defaultPasswordIssuedAt" TIMESTAMPTZ;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "defaultPasswordChangedAt" TIMESTAMPTZ;

DO $varsayilan_sa$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_default_password_system_only') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_default_password_system_only"
      CHECK ("defaultPasswordIssuedAt" IS NULL OR "isSystemAccount");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_default_password_change_order') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_default_password_change_order"
      CHECK ("defaultPasswordChangedAt" IS NULL OR "defaultPasswordIssuedAt" IS NOT NULL);
  END IF;
END
$varsayilan_sa$;
