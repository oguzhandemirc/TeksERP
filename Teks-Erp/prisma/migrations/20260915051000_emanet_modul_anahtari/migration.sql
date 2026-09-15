-- =============================================================================
-- EMANET (KONSİNYE MÜLKİYET) MODÜL ANAHTARI — grandfathering damgası (2026-09-15, G3)
-- =============================================================================
-- ŞEMA DEĞİŞİKLİĞİ YOK: tek bir `system_settings` satırı yazar (devere/dokuma damgası emsali:
-- 20260912120000 · 20260913260000 — gerekçeler orada, burada tekrar edilmez).
-- SABİT `false`: emanetin dünkü davranışı YOKTUR (sahiplik alanı hiç yoktu) ⇒ kapalı.
-- KOŞULLU INSERT (`WHERE EXISTS … rolls`): yalnız geçmişi olan kurulum damgalanır; taze DB profilden.
-- İDEMPOTENT: `ON CONFLICT DO NOTHING` — panelden açılmış karar EZİLMEZ.
-- ⚠️ `updatedAt` elle, DÜZ `now()` (timestamptz; `AT TIME ZONE` yazılmaz).
-- ⚠️ `description` metni `setFeatureFlags`in emanet dalıyla BİREBİR (bekçi karşılaştırır).
INSERT INTO "system_settings" ("key", "value", "description", "createdAt", "updatedAt")
SELECT v.key, v.value, v.description, now(), now()
  FROM (VALUES
         ('emanet.enabled', 'false'::jsonb,
          'Emanet / konsinye mülkiyet modülü (müşterinin malı: top · levent · iplik lotu; sevk sahiplik kapısı)')
       ) AS v(key, value, description)
 WHERE EXISTS (SELECT 1 FROM "rolls" LIMIT 1)
ON CONFLICT ("key") DO NOTHING;
