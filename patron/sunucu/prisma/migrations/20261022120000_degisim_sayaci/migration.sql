-- =============================================================================
-- DEĞİŞİM SAYACI (patron v2 P3): tesis başına monoton sayaç + son artışın projeksiyon adları. Yeni tablo YOK
-- (RLS/`CLOUD_TABLES`/yetki aynı satırda); DEFAULT'lu ⇒ mevcut satırlar 0 ve [] ile doğar, eski sunucu kolonları
-- okumaz. Sayaç iş hesabı değildir: yalnız uzun yoklamaya (`GET /api/degisim`) "değişti" der.
-- =============================================================================

-- AlterTable
ALTER TABLE "sync_state" ADD COLUMN     "change_counter" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "changed_projections" JSONB NOT NULL DEFAULT '[]';
