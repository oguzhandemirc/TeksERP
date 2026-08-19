-- Arşive `changes` (Faz B2 — alan-bazlı diff) ve `deviceId` (Faz B3 — olayın
-- cihazı) taşınır. Bu kolonlar canlı tabloda vardı ama arşivleyici onları
-- kopyalayamıyordu (arşiv şemasında yoktular) → 6 ay sonra iki bilgi de
-- sessizce kayboluyordu. İki nullable kolon: tablo yeniden yazılmaz, index yok.
ALTER TABLE "system_log_archives" ADD COLUMN IF NOT EXISTS "deviceId" UUID;
ALTER TABLE "system_log_archives" ADD COLUMN IF NOT EXISTS "changes" JSONB;
