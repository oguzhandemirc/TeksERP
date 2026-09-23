-- ÇEKİ LİSTESİ NO BASILAN KÂĞIDA BAĞLANIR (2026-09-23, kullanıcı kararı: "küçük yaz, bir köşeye koy")
--
-- ADDITIVE: yalnız ekler. Eski WORK_ORDER satırları varsayılanla (`sourceKind = WORK_ORDER`) aynı kalır;
-- `workOrderId` NOT NULL → NULL gevşer (WORK_ORDER satırı için CHECK aynı sözü tutar).
--
-- Paketleme / Çuvallar → "Çeki Listesi" kâğıdı bugüne dek bir kayda bağlı DEĞİLDİ ve numarasızdı; CL serisi
-- yalnız hiçbir istemcinin çağırmadığı iş emri ucunda doğuyordu. Artık kâğıt İLK basıldığında bir
-- SACK_SELECTION satırı doğar (numara doğuşta, render'da değil); aynı içerik yeniden basılınca aynı satır.
DO $$ BEGIN
  CREATE TYPE "ManifestSourceKind" AS ENUM ('WORK_ORDER', 'SACK_SELECTION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "manifests" ADD COLUMN IF NOT EXISTS "sourceKind" "ManifestSourceKind" NOT NULL DEFAULT 'WORK_ORDER';
ALTER TABLE "manifests" ADD COLUMN IF NOT EXISTS "contentKey" VARCHAR(64);
ALTER TABLE "manifests" ADD COLUMN IF NOT EXISTS "clientToken" UUID;
ALTER TABLE "manifests" ALTER COLUMN "workOrderId" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "manifests_contentKey_key" ON "manifests"("contentKey");
CREATE UNIQUE INDEX IF NOT EXISTS "manifests_clientToken_key" ON "manifests"("clientToken");

-- Kaynak biçimi: WORK_ORDER ⇔ iş emri dolu; SACK_SELECTION ⇔ içerik anahtarı dolu. Mevcut satırların hepsi
-- WORK_ORDER + workOrderId dolu (eski NOT NULL) → CHECK temiz veriye iner.
DO $$ BEGIN
  ALTER TABLE "manifests" ADD CONSTRAINT "manifests_source_shape" CHECK (
    ("sourceKind" = 'WORK_ORDER') = ("workOrderId" IS NOT NULL)
    AND ("sourceKind" = 'SACK_SELECTION') = ("contentKey" IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
