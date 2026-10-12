-- Makine kaynaklı duruş D3a: kart (toplayıcı) kimliği — sır tohumu + veriliş damgası.
-- ADDITIVE: iki nullable kolon; canlı veriye dokunmaz. Sırrın kendisi DB'ye yazılmaz
-- (tohum + kısa kimlik halkası anahtarından türer). İdempotent: yeniden koşum no-op.

ALTER TABLE "machine_collectors" ADD COLUMN IF NOT EXISTS "secretSeed" VARCHAR(96);
ALTER TABLE "machine_collectors" ADD COLUMN IF NOT EXISTS "secretIssuedAt" TIMESTAMPTZ;
