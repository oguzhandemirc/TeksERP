-- =============================================================================
-- MALİYET & TEKLİF MODÜL ANAHTARI — grandfathering damgası (2026-10-24, MAL-0)
-- =============================================================================
-- ŞEMA DEĞİŞİKLİĞİ YOK: tek bir `system_settings` satırı yazar (emanet damgası emsali:
-- 20260915051000 — gerekçeler 20260913260000'da, burada tekrar edilmez).
-- SABİT `false`: modül sıfırdan doğdu, dünkü davranışı YOKTUR (maliyet/teklif yüzeyi hiç yoktu) ⇒ kapalı.
-- KOŞULLU INSERT (`WHERE EXISTS … rolls`): yalnız geçmişi olan kurulum damgalanır; taze DB profilden.
-- İDEMPOTENT: `ON CONFLICT DO NOTHING` — panelden açılmış karar EZİLMEZ.
-- ⚠️ `updatedAt` elle, DÜZ `now()` (timestamptz; `AT TIME ZONE` yazılmaz).
-- ⚠️ `description` metni `setFeatureFlags`in maliyet dalıyla BİREBİR (bekçi karşılaştırır).
INSERT INTO "system_settings" ("key", "value", "description", "createdAt", "updatedAt")
SELECT v.key, v.value, v.description, now(), now()
  FROM (VALUES
         ('maliyet.enabled', 'false'::jsonb,
          'Maliyet & Teklif: ürün maliyeti, standart maliyet, satış teklifi, fiyat listesi, iplik ihtiyaç planı')
       ) AS v(key, value, description)
 WHERE EXISTS (SELECT 1 FROM "rolls" LIMIT 1)
ON CONFLICT ("key") DO NOTHING;
