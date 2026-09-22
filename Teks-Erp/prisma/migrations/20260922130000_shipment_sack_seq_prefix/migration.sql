-- Sevkiyat içi çuval sırası ön eki sevkiyat kurulurken donar (ekran + belge tek kaynak).
-- Ekleyen değişiklik: NULL = ön ek doğmadan önce kurulan sevkiyat (öneksiz).
ALTER TABLE "shipments" ADD COLUMN "sackSeqPrefix" VARCHAR(8);
