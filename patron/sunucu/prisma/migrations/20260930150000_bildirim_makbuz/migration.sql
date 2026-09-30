-- B5 MAKBUZ — Expo push'un ikinci aşaması (bilet → makbuz; DeviceNotRegistered çoğu kez makbuzda gelir).
-- Yalnız EKLER: null = yoklanacak makbuz yok (mevcut satırların hepsi; bugünkü davranış). RLS tablo düzeyinde, değişmez.

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "receipt_due_at" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "notifications_tesis_id_receipt_due_at_idx" ON "notifications"("tesis_id", "receipt_due_at");
