-- Etiket Stüdyosu v2: "Boyutlar" (LabelFormatProfile) kataloğu KESİN KALDIRILDI.
-- Medya boyutu artık doğrudan PeripheralDevice'ta (labelWidthMm/labelHeightMm/labelDpi/
-- labelGapMm) + sistem varsayılan medyası (system_settings 'label.defaultMedia').
-- Kullanıcı tasarımdan dönmeyeceğini teyit etti → deprecated rollback yüzeyi düşürülüyor.
--
-- Sıra: önce tabloya işaret eden FK kolonları (peripheral + varyant), sonra tablo.
-- Kolon DROP'u ilgili FK constraint + index'i otomatik düşürür.

ALTER TABLE "peripheral_devices" DROP COLUMN IF EXISTS "formatProfileId";

ALTER TABLE "label_template_variants" DROP COLUMN IF EXISTS "sourceProfileId";

DROP TABLE IF EXISTS "label_format_profiles";
