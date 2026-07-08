-- Worklist Faz 11 — F6+D-15: Device.kind -> DeviceKind enum + department/module VarChar sınırı.
-- Değerler zaten TABLET/PHONE/DESKTOP (SELECT DISTINCT doğrulandı) → cast güvenli.
-- department/module mevcut max = 8/13 → VarChar(32) güvenli. Tablolar küçük → kilit kısa.
SET statement_timeout = 0;

CREATE TYPE "DeviceKind" AS ENUM ('TABLET', 'PHONE', 'DESKTOP');
UPDATE "devices" SET "kind" = upper("kind");                 -- güvenlik ağı (zaten upper)
ALTER TABLE "devices" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "devices" ALTER COLUMN "kind" TYPE "DeviceKind" USING "kind"::"DeviceKind";
ALTER TABLE "devices" ALTER COLUMN "kind" SET DEFAULT 'TABLET';

ALTER TABLE "stations"    ALTER COLUMN "department" TYPE VARCHAR(32);
ALTER TABLE "permissions" ALTER COLUMN "module"     TYPE VARCHAR(32);
