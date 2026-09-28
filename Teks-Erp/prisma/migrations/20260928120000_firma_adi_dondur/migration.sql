-- =============================================================================
-- FİRMA ADI DONDURMA (2026-09-28) — ADDITIVE, yalnız veri; şema değişmez.
-- =============================================================================
-- Koddaki `DEFAULT_COMPANY_NAME` bir müşterinin adıydı; artık nötr "TeksERP".
-- `company.name` satırı OLMAYAN mevcut kurulum bugüne kadar adını o sabitten
-- görüyordu — bu damga o adı ayar satırına dondurur ki ekran/belge/etiket
-- deploy sonrası BİREBİR aynı adı göstersin.
--
-- Ölçüt (yeni kurulum ≠ mevcut kurulum): DB'de gerçek veri var mı. `kur.ps1` yeni
-- kurulumda da bütün migration'ları koşar; o an `users`/`rolls` boştur → satır
-- YAZILMAZ ve yeni kurulum nötr yedekle doğar (emsal 20260902230000 grandfathering).
--
-- İdempotent: satırı olan kuruluma DOKUNULMAZ (NOT EXISTS + ON CONFLICT DO NOTHING).
-- Audit: emsaldeki gibi SystemLog yazılmaz; damga satırın kendisidir (updatedById NULL).
-- `description` `setFeatureFlags` yazma dalıyla BİREBİR aynı; düz `now()` (timestamptz).
-- =============================================================================
INSERT INTO "system_settings" ("key", "value", "description", "createdAt", "updatedAt")
SELECT 'company.name',
       to_jsonb('Adnan Şahin Tekstil'::text),
       'ERP''nin kurulduğu firmanın adı (panel başlığı + uygulama geneli)',
       now(), now()
 WHERE NOT EXISTS (SELECT 1 FROM "system_settings" WHERE "key" = 'company.name')
   AND (EXISTS (SELECT 1 FROM "users" LIMIT 1) OR EXISTS (SELECT 1 FROM "rolls" LIMIT 1))
ON CONFLICT ("key") DO NOTHING;
