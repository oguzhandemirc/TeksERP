-- Raşel takımı (#23): aynı sarımda birlikte doğan leventlerin kardeş bağı (idempotent)
ALTER TABLE "warp_beams" ADD COLUMN IF NOT EXISTS "setKey" UUID;
CREATE INDEX IF NOT EXISTS "warp_beams_setKey_idx" ON "warp_beams"("setKey");
