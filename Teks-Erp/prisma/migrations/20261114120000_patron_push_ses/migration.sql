-- Bildirim sesi S0 (2026-11-14): patron telefonunun seçtiği bildirim/alarm sesi (buluta `kaydet` ile gider).
-- ADDITIVE: varsayılanlı iki kolon; mevcut satırlar varsayılan seslere (zil/alarm) düşer, backfill YOK.

-- AlterTable
ALTER TABLE "patron_push_tokens" ADD COLUMN "soundNotification" VARCHAR(24) NOT NULL DEFAULT 'tekserp_zil',
ADD COLUMN "soundAlarm" VARCHAR(24) NOT NULL DEFAULT 'tekserp_alarm';

ALTER TABLE "patron_push_tokens" ADD CONSTRAINT "patron_push_tokens_sound_notification_ck"
  CHECK ("soundNotification" IN ('tekserp_zil', 'tekserp_alarm', 'tekserp_mekik', 'tekserp_dokuma', 'tekserp_kisa', 'varsayilan', 'sessiz'));
ALTER TABLE "patron_push_tokens" ADD CONSTRAINT "patron_push_tokens_sound_alarm_ck"
  CHECK ("soundAlarm" IN ('tekserp_zil', 'tekserp_alarm', 'tekserp_mekik', 'tekserp_dokuma', 'tekserp_kisa', 'varsayilan', 'sessiz'));
