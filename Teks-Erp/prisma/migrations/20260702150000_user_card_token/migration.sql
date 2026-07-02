-- QR personel kartıyla giriş (opsiyonel — auth.loginMode="card" iken).
-- (Manuel migration — repo konvansiyonu: psql apply + prisma migrate resolve --applied.)
-- cardToken: 32-hex kart sırrı; kart içeriği "TEKSU:<userId>:<cardToken>".
-- Nullable UNIQUE — PostgreSQL'de NULL'lar çakışmaz (kartsız kullanıcılar serbest).
ALTER TABLE "users" ADD COLUMN "cardToken" VARCHAR(64);
CREATE UNIQUE INDEX "users_cardToken_key" ON "users"("cardToken");
