-- FİRE etiketinde MÜKERRER "FIRE" + QR ÇAKIŞMASI (2026-08-20, önceki migration'ın devamı)
--
-- `20260820040000_fire_label_marking` fire etiketine kutulu "FIRE / SATILAMAZ"
-- bloğu ekledi. Render'da görüldü ki şablonda ZATEN koşullu bir kalite elemanı var
-- (`showIf: notIn ["1.KALITE"]`, yani 1. kalite dışında kaliteyi basar) → fire
-- etiketinde "FIRE" İKİ KEZ çıkıyor.
--
-- Üstelik o eleman (3,30)mm'de ve QR ayak izi (3,3)-(35.7,35.7) içinde: QR sembolü
-- 7.5-30.7mm arasında, metin 30-34.5mm → sembolün alt kenarıyla ~1mm ÇAKIŞIYOR.
-- Fire etiketi tam da okunabilirliğin önemli olduğu yer (topun neden fire olduğuna
-- bakmak için okutulur).
--
-- Çözüm: kalite elemanı FİRE'de BASILMASIN — yerini kutulu blok aldı, o hem daha
-- büyük hem çakışmıyor. Diğer kaliteler (A1 vb.) AYNEN devam eder.
--
-- ⚠️ A1 ETİKETİNDE ÇAKIŞMA DURUYOR — bilinçli olarak dokunulmadı: bu şablonun
-- kendi tasarım kararı (fabrika Etiket Stüdyosu'ndan düzenler) ve bugüne kadar
-- şikâyet üretmedi. Ölçüldü ve kullanıcıya bildirildi; düzeltmek ayrı bir karar.
--
-- İDEMPOTENT: "FIRE" listede zaten varsa hiçbir şey yapmaz.
UPDATE "label_template_variants" v
SET "elements" = jsonb_set(
      v."elements",
      '{elements}',
      (
        SELECT jsonb_agg(
                 CASE
                   WHEN e->>'bind' = 'qualityGrade'
                    AND e->'showIf'->>'op' = 'notIn'
                    AND e->'showIf'->>'field' = 'qualityGrade'
                   THEN jsonb_set(e, '{showIf,values}', (e->'showIf'->'values') || '["FIRE"]'::jsonb)
                   ELSE e
                 END
                 ORDER BY ord
               )
        FROM jsonb_array_elements(v."elements"->'elements') WITH ORDINALITY AS a(e, ord)
      )
    ),
    "updatedAt" = now()
FROM "label_templates" t
WHERE t."id" = v."templateId"
  AND t."kind" = 'ROLL_FINISHED'
  AND t."isActive" = true
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v."elements"->'elements') e
    WHERE e->>'bind' = 'qualityGrade'
      AND e->'showIf'->>'op' = 'notIn'
      AND NOT (e->'showIf'->'values' @> '["FIRE"]'::jsonb)
  );
