-- TAŞIMA SELİ (Bölge 7 B1/B1k): talebin İSTEDİĞİ lisans kimliği (`hedefKimlik`) — kurulum var mı, etkin mi
-- bakılmadan yazılır; hedef başına TEK bekleyen talep DB seddiyle. ADDITIVE: mevcut bağlı satırlar kurulumun
-- lisans kimliğiyle doldurulur (eski kod kurulum başına tek BEKLIYOR'u zaten zorluyordu ⇒ sed ihlalsiz kurulur).
ALTER TABLE "tasima_talebi" ADD COLUMN "hedefKimlik" UUID;

UPDATE "tasima_talebi" t SET "hedefKimlik" = k."kurulumId"
  FROM "kurulum" k WHERE t."kurulumId" = k."id" AND t."hedefKimlik" IS NULL;

CREATE UNIQUE INDEX "tasima_talebi_hedef_bekleyen_tekil" ON "tasima_talebi" ("hedefKimlik") WHERE "hedefKimlik" IS NOT NULL AND "durum" = 'BEKLIYOR';
