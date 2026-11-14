-- =============================================================================
-- PUSH KÖPRÜSÜ SESİ (S0, 2026-11-14): bağa telefonun seçtiği bildirim/alarm sesi. Yalnız EKLER (varsayılanlı iki kolon);
-- mevcut bağlar varsayılan seslere (zil/alarm) düşer. Küme tel `PUSH_SOUNDS` ile aynı.
-- =============================================================================

-- AlterTable
ALTER TABLE "push_bridge_links" ADD COLUMN "ses_bildirim" VARCHAR(24) NOT NULL DEFAULT 'tekserp_zil',
ADD COLUMN "ses_alarm" VARCHAR(24) NOT NULL DEFAULT 'tekserp_alarm';

ALTER TABLE "push_bridge_links" ADD CONSTRAINT "push_bridge_links_ses_bildirim_ck"
  CHECK ("ses_bildirim" IN ('tekserp_zil', 'tekserp_alarm', 'tekserp_mekik', 'tekserp_dokuma', 'tekserp_kisa', 'varsayilan', 'sessiz'));
ALTER TABLE "push_bridge_links" ADD CONSTRAINT "push_bridge_links_ses_alarm_ck"
  CHECK ("ses_alarm" IN ('tekserp_zil', 'tekserp_alarm', 'tekserp_mekik', 'tekserp_dokuma', 'tekserp_kisa', 'varsayilan', 'sessiz'));
