-- =============================================================================
-- ETİKET STÜDYOSU v2 — medya PeripheralDevice'a taşındı ("Boyutlar" kataloğu emekli)
-- =============================================================================
-- MANUEL migration (psql + prisma migrate resolve --applied). ADDITIVE + geri
-- dönüşlü: label_format_profiles TABLOSU DURUR (formatProfileId kolonu da),
-- yalnız kullanımdan çıkar; medya artık cihaz kolonlarında + sistem varsayılan
-- medya ayarında.
-- =============================================================================

-- 1) Yazıcı medyası doğrudan cihazda.
ALTER TABLE peripheral_devices ADD COLUMN "labelWidthMm"  DECIMAL(6,2);
ALTER TABLE peripheral_devices ADD COLUMN "labelHeightMm" DECIMAL(6,2);
ALTER TABLE peripheral_devices ADD COLUMN "labelDpi"      INTEGER;
ALTER TABLE peripheral_devices ADD COLUMN "labelGapMm"    DECIMAL(5,2);

-- 2) Backfill: bağlı format profilinden (varsa) cihaz medyasına.
UPDATE peripheral_devices p
SET "labelWidthMm"  = fp."widthMm",
    "labelHeightMm" = fp."heightMm",
    "labelDpi"      = fp.dpi,
    "labelGapMm"    = fp."gapMm"
FROM label_format_profiles fp
WHERE p."formatProfileId" = fp.id;

-- 3) Sistem VARSAYILAN MEDYASI — cihazsız baskı/önizleme/kartela için (eski
--    isRollDefault profilinin yerine geçer). Aktif isRollDefault profilinden
--    seed; yoksa 100×148 / 203dpi / 2mm.
INSERT INTO system_settings (key, value, "createdAt", "updatedAt")
SELECT 'label.defaultMedia',
       json_build_object(
         'widthMm',  COALESCE((SELECT "widthMm"  FROM label_format_profiles WHERE "isRollDefault" AND "isActive" LIMIT 1), 100),
         'heightMm', COALESCE((SELECT "heightMm" FROM label_format_profiles WHERE "isRollDefault" AND "isActive" LIMIT 1), 148),
         'dpi',      COALESCE((SELECT dpi        FROM label_format_profiles WHERE "isRollDefault" AND "isActive" LIMIT 1), 203),
         'gapMm',    COALESCE((SELECT "gapMm"    FROM label_format_profiles WHERE "isRollDefault" AND "isActive" LIMIT 1), 2),
         'marginMm', COALESCE((SELECT "marginMm" FROM label_format_profiles WHERE "isRollDefault" AND "isActive" LIMIT 1), 3)
       )::jsonb,
       now(), now()
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE key = 'label.defaultMedia');
