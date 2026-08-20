-- FİRE ETİKETİ — istisna baskıda kâğıt "satılabilir mal" gibi görünmesin (2026-08-20)
--
-- Kullanıcı: "gerçek hayatta fire etiketi basılmayacak ama istisna durumlar için
-- lazım olabilir." Yani bu etiket NADİREN basılır (otomatik baskı `skipLabel` +
-- `label.scrapGradeLabelEnabled` ile kapalı; operatör onay vererek elle basar) —
-- ama basıldığında ne olduğu BİR BAKIŞTA anlaşılmalı.
--
-- SEKTÖR KARŞILIĞI: uygunsuz malzeme "rejection tag" ile işaretlenir; bitmiş-ürün
-- etiketiyle aynı görünen bir kâğıt, malın akışa geri girmesini kolaylaştırır.
--
-- NEDEN AYRI ŞABLON DEĞİL: şablon yönlendirmesi KALİTEYE bakmaz (kind > müşteri >
-- cihaz). Ayrı bir `LabelKind` açmak enum migration + 4 elle güncellenen nokta +
-- yeni APK demekti; istisna yolu için ağır. Bunun yerine ŞABLON İÇİ KOŞULLU ELEMAN
-- (`showIf`) kullanıldı — 2026-08-02'de tam bu iş için eklenmiş, kod değişikliği
-- İSTEMEZ ve fabrika Etiket Stüdyosu'ndan serbestçe düzenleyebilir.
--
-- ⚠️ `showIf.values` = `QualityGrade.code`. Bu bir ŞABLON VERİSİDİR (fabrika
-- düzenler), kodda gömülü sabit DEĞİL — `skipLabel` ile iki ayrı soruyu yanıtlarlar:
-- skipLabel = "otomatik basma", buradaki koşul = "bastığında NE çiz".
--
-- YERLEŞİM ölçülerek seçildi (100×60mm, 203dpi): QR ayak izi (3,3)-(35.7,35.7),
-- code128 (23.3,39.13) h=12mm, barkod metni (27.2,51.13). Sol-alt blok
-- x=3..22 / y=36..58 BOŞ. "FIRE" hMm=6 → 4mm/karakter × 4 = 16mm (sığar),
-- "SATILAMAZ" hMm=3 → ~1.9mm/karakter × 9 ≈ 17mm (sığar).
--
-- İDEMPOTENT: eleman id'si zaten varsa hiçbir şey yapmaz (yeniden koşulabilir).
-- Fabrikanın diğer eleman düzenlemeleri KORUNUR — dizi sonuna eklenir, ezilmez.
UPDATE "label_template_variants" v
SET "elements" = jsonb_set(
      v."elements",
      '{elements}',
      (v."elements"->'elements') || '[
        {"id":"box-fire-mark","type":"box","x":2,"y":36,"wMm":20,"hMm":12,"thickMm":0.6,
         "showIf":{"field":"qualityGrade","op":"in","values":["FIRE"]}},
        {"id":"text-fire-mark","type":"text","x":4,"y":37.5,"text":"FIRE","hMm":6,
         "showIf":{"field":"qualityGrade","op":"in","values":["FIRE"]}},
        {"id":"text-fire-nosale","type":"text","x":4,"y":44,"text":"SATILAMAZ","hMm":3,
         "showIf":{"field":"qualityGrade","op":"in","values":["FIRE"]}}
      ]'::jsonb
    ),
    "updatedAt" = now()
FROM "label_templates" t
WHERE t."id" = v."templateId"
  AND t."kind" = 'ROLL_FINISHED'
  AND t."isActive" = true
  -- İdempotanlık: bu şablonda fire işareti henüz yoksa ekle.
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v."elements"->'elements') e
    WHERE e->>'id' = 'text-fire-mark'
  );
