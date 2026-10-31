-- D4-E2a: en ölçen istasyon yeteneği. Varsayılan false = bugünkü davranış (hiçbir istasyon en yazmaz).
ALTER TABLE "stations" ADD COLUMN "capturesWidth" BOOLEAN NOT NULL DEFAULT false;
