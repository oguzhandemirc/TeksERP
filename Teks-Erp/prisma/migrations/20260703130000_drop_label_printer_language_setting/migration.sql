-- Global "varsayılan yazıcı dili" ayarı kaldırıldı — dil YALNIZ cihaz kaydından
-- (PeripheralDevice.languageOverride, yazıcıda zorunlu). Cihaz bağlamı olmayan
-- native istek artık RASTER_HTML'e düşer (fail-closed). Veri-temizliği: ayar satırı.
DELETE FROM "system_settings" WHERE "key" = 'label.printerLanguage';
