-- =============================================================================
-- GELEN BELGE TASLAĞI (Gülkesim OCR, D1) MODÜL ANAHTARI — grandfathering damgası (2026-10-29)
-- =============================================================================
-- ŞEMA DEĞİŞİKLİĞİ YOK: tek bir `system_settings` satırı yazar (emanet damgası emsali: 20260915051000).
-- SABİT `false`: modül sıfırdan doğdu, dünkü davranışı YOKTUR (gelen belge/OCR yüzeyi hiç yoktu) ⇒ kapalı.
-- KOŞULLU INSERT (`WHERE EXISTS … rolls`): yalnız geçmişi olan kurulum damgalanır; taze DB profilden doğar.
-- İDEMPOTENT: `ON CONFLICT DO NOTHING` — panelden açılmış karar EZİLMEZ.
-- ⚠️ `updatedAt` elle, DÜZ `now()` (timestamptz; `AT TIME ZONE` yazılmaz).
-- ⚠️ `description` metni `setFeatureFlags`in gelen belge dalıyla BİREBİR (bekçi karşılaştırır).
INSERT INTO "system_settings" ("key", "value", "description", "createdAt", "updatedAt")
SELECT v.key, v.value, v.description, now(), now()
  FROM (VALUES
         ('gelenBelge.enabled', 'false'::jsonb,
          'Gelen belge taslağı modülü (müşteri irsaliyesi fotoğrafından OCR taslak · gözden geçirme · onayla emanet top girişi)')
       ) AS v(key, value, description)
 WHERE EXISTS (SELECT 1 FROM "rolls" LIMIT 1)
ON CONFLICT ("key") DO NOTHING;
