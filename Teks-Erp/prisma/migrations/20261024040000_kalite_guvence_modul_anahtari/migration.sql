-- =============================================================================
-- KALİTE GÜVENCE (K4P) MODÜL ANAHTARI — grandfathering damgası (2026-10-24)
-- =============================================================================
-- ŞEMA DEĞİŞİKLİĞİ YOK: tek bir `system_settings` satırı yazar (emanet damgası emsali: 20260915051000).
-- SABİT `false`: kalite güvencenin dünkü davranışı YOKTUR (muayene/lab/sertifika yüzeyi hiç yoktu) ⇒ kapalı.
-- KOŞULLU INSERT (`WHERE EXISTS … rolls`): yalnız geçmişi olan kurulum damgalanır; taze DB profilden doğar
-- (koşulsuz yazılsaydı profil job'u "satır var" deyip deneme profilinde de modülü kapalı bırakırdı).
-- İDEMPOTENT: `ON CONFLICT DO NOTHING` — panelden açılmış karar EZİLMEZ.
-- ⚠️ `updatedAt` elle, DÜZ `now()` (timestamptz; `AT TIME ZONE` yazılmaz).
-- ⚠️ `description` metni `setFeatureFlags`in kalite güvence dalıyla BİREBİR (bekçi karşılaştırır).
INSERT INTO "system_settings" ("key", "value", "description", "createdAt", "updatedAt")
SELECT v.key, v.value, v.description, now(), now()
  FROM (VALUES
         ('kaliteGuvence.enabled', 'false'::jsonb,
          'Kalite Güvence modülü (4 puan muayene · lab testleri · sertifika takibi)')
       ) AS v(key, value, description)
 WHERE EXISTS (SELECT 1 FROM "rolls" LIMIT 1)
ON CONFLICT ("key") DO NOTHING;
