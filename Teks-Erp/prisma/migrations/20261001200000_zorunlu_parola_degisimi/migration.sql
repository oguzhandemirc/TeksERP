-- G20 zorunlu parola değişimi bayrağı. Yalnız EKLER: users'a varsayılanı false olan tek kolon —
-- mevcut kullanıcılar etkilenmez (kimse kilitlenmez); bayrağı yalnız ilk kurulum seed'i true yazar.
-- DEFERRABLE FK'lara dokunulmaz. İdempotent: yeniden koşum no-op.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
