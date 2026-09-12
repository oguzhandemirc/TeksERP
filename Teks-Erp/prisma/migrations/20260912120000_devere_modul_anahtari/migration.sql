-- =============================================================================
-- DEVERE / LEVENT MODÜL ANAHTARI — grandfathering damgası (2026-09-12)
-- =============================================================================
-- ŞEMA DEĞİŞİKLİĞİ YOK: tek bir `system_settings` satırı yazar.
--
-- NEDEN AYRI DOSYA: `20260902230000_modul_anahtarlari_grandfathering`
-- UYGULANMIŞTIR ve değiştirilemez (checksum). Devere, o damgadan SONRA doğan
-- İLK modüldür; anahtarı kendi migration'ında damgalanır ve modül bekçileri
-- (`test_module_flags` §6 · `test_module_grandfathering`) artık tek dosya değil
-- DOSYA LİSTESİ okur.
--
-- NEDEN SABİT `false` (koşullu bir değer ifadesi DEĞİL): kural "değer = DÜNKÜ
-- DAVRANIŞ"tır. Devere modülünün dünkü davranışı YOKTUR — ne yüzeyi, ne tablosu,
-- ne verisi vardı; yani dünkü davranış tanım gereği KAPALI'dır ve türetilecek bir
-- veri de yoktur. Aynı gerekçeyle `kumasTeknik.enabled` ve `tezgah.enabled` da
-- sabit `false` damgalandı. Kural satırı 2026-09-12'de bu ayrımla daraltıldı
-- (`docs/kurallar/modul-bayrak.md`; gerekçe arşivde).
--
-- NEDEN KOŞULLU INSERT (`WHERE EXISTS … rolls`): 2026-09-02 damgasının birebir
-- gerekçesi — `kur.ps1` yeni kurulumda da tüm migration'ları koşar; koşulsuz bir
-- INSERT taze DB'yi damgalar ve kurulum profilini ("satır VARSA dokunma") kalıcı
-- no-op'a çevirirdi. Grandfathering yalnız GEÇMİŞİ OLAN kuruluma aittir.
--
-- İDEMPOTENT: `system_settings.key` PRIMARY KEY → `ON CONFLICT DO NOTHING`;
-- panelden açılmış bir kurulumun kararı EZİLMEZ.
--
-- ⚠️ `updatedAt` elle verilir (Prisma `@updatedAt` uygulama katmanındadır).
-- ⚠️ DÜZ `now()`: kolonlar timestamptz; `AT TIME ZONE` kalıbı damgayı geriye yazardı.
-- ⚠️ `description` metni `setFeatureFlags`in devere dalındakiyle BİREBİR aynıdır
--    (bekçi karşılaştırır).
-- =============================================================================

INSERT INTO "system_settings" ("key", "value", "description", "createdAt", "updatedAt")
SELECT v.key, v.value, v.description, now(), now()
  FROM (VALUES
         ('devere.enabled', 'false'::jsonb,
          'Devere / levent modülü (çözgü kartı · levent stoğu · levent defteri)')
       ) AS v(key, value, description)
 WHERE EXISTS (SELECT 1 FROM "rolls" LIMIT 1)
ON CONFLICT ("key") DO NOTHING;
