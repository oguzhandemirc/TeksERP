-- =============================================================================
-- DOKUMA İŞİ MODÜL ANAHTARI — grandfathering damgası (2026-09-13)
-- =============================================================================
-- ŞEMA DEĞİŞİKLİĞİ YOK: tek bir `system_settings` satırı yazar.
--
-- NEDEN AYRI DOSYA: `20260902230000` ve `20260912120000` UYGULANMIŞTIR ve
-- değiştirilemez (checksum). Damgadan sonra doğan her modül kendi
-- migration'ında damgalanır; modül bekçileri DOSYA LİSTESİ okur.
--
-- NEDEN SABİT `false`: kural "değer = DÜNKÜ DAVRANIŞ"tır ve dokuma işinin dünkü
-- davranışı ÖLÇÜLDÜ — hiçbir istemci `/api/weaving-orders` · `/api/machine-runs` ·
-- `/api/machine-doffs` uçlarını çağırmıyordu (Electron + mobil kaynağında 0
-- eşleşme); fabrika dokumuyor, kumaş hazır geliyor (0 iplik kalemi, 0 çözgü
-- kartı). Yani dünkü davranış tanım gereği KAPALI'dır, türetilecek veri yoktur.
--
-- NEDEN KOŞULLU INSERT (`WHERE EXISTS … rolls`): `kur.ps1` yeni kurulumda da tüm
-- migration'ları koşar; koşulsuz INSERT taze DB'yi damgalar ve kurulum profilini
-- ("satır VARSA dokunma") kalıcı no-op'a çevirirdi. Grandfathering yalnız
-- GEÇMİŞİ OLAN kuruluma aittir.
--
-- İDEMPOTENT: `system_settings.key` PRIMARY KEY → `ON CONFLICT DO NOTHING`.
-- ⚠️ `updatedAt` elle verilir (Prisma `@updatedAt` uygulama katmanındadır).
-- ⚠️ DÜZ `now()`: kolonlar timestamptz; `AT TIME ZONE` kalıbı damgayı geriye yazardı.
-- ⚠️ `description` metni `setFeatureFlags`in dokuma dalındakiyle BİREBİR aynıdır.
-- =============================================================================

INSERT INTO "system_settings" ("key", "value", "description", "createdAt", "updatedAt")
SELECT v.key, v.value, v.description, now(), now()
  FROM (VALUES
         ('dokuma.enabled', 'false'::jsonb,
          'Dokuma işi modülü (dokuma işi planlama · tezgah koşumu · top indirme)')
       ) AS v(key, value, description)
 WHERE EXISTS (SELECT 1 FROM "rolls" LIMIT 1)
ON CONFLICT ("key") DO NOTHING;
