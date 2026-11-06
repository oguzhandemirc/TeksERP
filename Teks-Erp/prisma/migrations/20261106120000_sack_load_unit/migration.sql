-- Çuvalsız sevk (yük birimi) — kullanıcı kararı 2026-11-06 (plan: CUVALSIZ-SEVK-PLAN.md, seçenek B).
-- `sacks` satırı artık bir YÜK BİRİMİ: SACK (bugünkü çuval) · CART (araba, `unitLabel`) · BULK (dökme).
-- Eski satırlar SACK olarak kalır (veri taşıma YOK; geçmiş uydurulmaz). Hızlı tablo değişikliği:
-- NOT NULL DEFAULT sabit değerdir (PG11+ hızlı varsayılan, tablo yeniden yazılmaz).

CREATE TYPE "LoadUnitKind" AS ENUM ('SACK', 'CART', 'BULK');

ALTER TABLE "sacks"
  ADD COLUMN "unitKind" "LoadUnitKind" NOT NULL DEFAULT 'SACK',
  ADD COLUMN "unitLabel" VARCHAR(32),
  ADD COLUMN "dissolvedAt" TIMESTAMPTZ,
  ADD COLUMN "dissolvedById" UUID;

ALTER TABLE "sacks" ADD CONSTRAINT "sacks_dissolvedById_fkey"
  FOREIGN KEY ("dissolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "sacks_dissolvedById_idx" ON "sacks"("dissolvedById");

-- Şekil seddi: SACK-dışı birim tartı/parti/ambalaj no taşımaz; araba no yalnız CART'ta ve zorunlu;
-- SACK hiç çözülmez (çuval havuza döner).
ALTER TABLE "sacks" ADD CONSTRAINT "sacks_load_unit_shape" CHECK (
  ("unitKind" = 'SACK' AND "unitLabel" IS NULL AND "dissolvedAt" IS NULL)
  OR ("unitKind" = 'BULK' AND "unitLabel" IS NULL
      AND "packingGroupId" IS NULL AND "packageNo" IS NULL AND "weightKg" IS NULL)
  OR ("unitKind" = 'CART' AND "unitLabel" IS NOT NULL AND length(btrim("unitLabel")) > 0
      AND "packingGroupId" IS NULL AND "packageNo" IS NULL AND "weightKg" IS NULL)
);

-- Sevkiyat başına en fazla bir canlı dökme birim; araba no sevkiyat içinde tekil (kimlik değil, etiket).
CREATE UNIQUE INDEX "sacks_bulk_per_shipment_uq" ON "sacks"("shipmentId")
  WHERE "unitKind" = 'BULK' AND "dissolvedAt" IS NULL;
CREATE UNIQUE INDEX "sacks_cart_label_per_shipment_uq" ON "sacks"("shipmentId", "unitLabel")
  WHERE "unitKind" = 'CART' AND "dissolvedAt" IS NULL;

-- Havuz seddi (COMMIT'te): SACK-dışı birim sevkiyatsız kalamaz (havuz okuyucuları onu görmesin),
-- türü değişmez, çözülmüş birimde top kalmaz. Satırın SON hâli yeniden okunur (ertelenmiş tetik).
CREATE OR REPLACE FUNCTION sacks_load_unit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cur RECORD;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."unitKind" <> NEW."unitKind" THEN
    RAISE EXCEPTION 'Yük biriminin türü değiştirilemez (%)', NEW."sackNo" USING ERRCODE = '23514';
  END IF;
  SELECT "unitKind", "shipmentId", "dissolvedAt", "sackNo" INTO cur FROM "sacks" WHERE id = NEW.id;
  IF NOT FOUND OR cur."unitKind" = 'SACK' THEN
    RETURN NULL;
  END IF;
  IF cur."shipmentId" IS NULL THEN
    RAISE EXCEPTION 'Dökme/araba yük birimi havuza dönemez (%)', cur."sackNo" USING ERRCODE = '23514';
  END IF;
  IF cur."dissolvedAt" IS NOT NULL AND EXISTS (SELECT 1 FROM "rolls" WHERE "sackId" = NEW.id) THEN
    RAISE EXCEPTION 'Çözülmüş yük biriminde top kalamaz (%)', cur."sackNo" USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "sacks_load_unit_not_in_pool"
  AFTER INSERT OR UPDATE ON "sacks"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION sacks_load_unit_guard();

-- Top tarafı: çözülmüş birime top bağlanamaz.
CREATE OR REPLACE FUNCTION rolls_load_unit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sid UUID;
BEGIN
  SELECT "sackId" INTO sid FROM "rolls" WHERE id = NEW.id;
  IF sid IS NOT NULL AND EXISTS (SELECT 1 FROM "sacks" WHERE id = sid AND "dissolvedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'Çözülmüş yük birimine top bağlanamaz' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "rolls_load_unit_dissolved"
  AFTER INSERT OR UPDATE OF "sackId" ON "rolls"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION rolls_load_unit_guard();
