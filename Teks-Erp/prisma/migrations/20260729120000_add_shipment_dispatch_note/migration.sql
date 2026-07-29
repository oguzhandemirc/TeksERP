-- İrsaliye açıklaması: sevkiyata özel, kayıtlı serbest not (annotation katmanı).
-- Eklemeli + nullable → mevcut veriye dokunmaz, geri alınabilir.
ALTER TABLE "shipments" ADD COLUMN "dispatchNote" VARCHAR(500);
