-- Salt-PIN girişi (auth.loginMethods "pin" içerirken): kullanıcıya özel BENZERSİZ
-- hızlı PIN — kullanıcı seçme/ID girme yok, yalnız PIN'le kimlik çözülür.
-- (Manuel migration — repo konvansiyonu: psql apply + prisma migrate resolve --applied.)
-- Nullable UNIQUE — PostgreSQL'de NULL'lar çakışmaz (PIN'siz kullanıcılar serbest).
ALTER TABLE "users" ADD COLUMN "quickPin" VARCHAR(12);
CREATE UNIQUE INDEX "users_quickPin_key" ON "users"("quickPin");
