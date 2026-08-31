-- =============================================================================
-- AD SEDDİ — kalan ana-veri tabloları (BULGU-T1-007)
-- =============================================================================
-- NEDEN: `BaseService.assertNameNotDuplicate` KİLİTSİZ bir check-then-act'tir
-- (tek `findFirst` + throw; `create()` transaction bile AÇMAZ). İki eşzamanlı
-- istek aynı adı yazabilir; kodun kendi yorumu bunu zaten itiraf ediyor
-- ("panelden yapılan yaratımı korur, YARIŞ KORUMASINI DEĞİL").
--
-- ⚠️ NEDEN UYGULAMA KİLİDİ DEĞİL: denetimin kısa-vade tavsiyesi "guard'ı tx'e al
-- + advisory kilit" idi. Ölçüldü ve UYGULANMADI: `create()` hiç tx açmıyor,
-- `assertNameNotDuplicate` ve `performInsert` ikisi de havuz istemcisini
-- (`this.delegate`) kullanıyor → kilidin işe yaraması için ~40 servisin geçtiği
-- TABAN SINIFTA tx'i uçtan uca geçirmek gerekirdi. Bedeli: audit'in bilinçli
-- olarak tx DIŞINDA yazılması kuralı bozulur, `withBarcodeRetry` tx içinde
-- kırılır (P2002 tx'i abort eder), her ana-veri yazımı uzar. Kazancı: sahada
-- HİÇ gerçekleşmemiş bir yarış (denetimin kendi ölçümü: prod'daki tek ad
-- mükerreri 34,2 sn arayla ve guard'dan 13 gün ÖNCE doğmuş; guard yürürlükteyken
-- 112 yaratımda 0 mükerrer). DB seddi aynı yarışı KAPATIR, üstelik ham SQL ve
-- içe-aktarım yollarını da kapsar. Doğru katman burasıdır.
--
-- ⚠️ DENETİMİN TAVSİYESİ İKİ NOKTADA DÜZELTİLDİ (ölçümle):
--   ① `machines` KAPSAMLIDIR (`duplicateNameScopeField: "stationId"`) → sed
--      (stationId, nameFold) BİLEŞİĞİDİR. Düz nameFold seddi "Makine 1" adını
--      fabrikada tek bir istasyona hapsederdi.
--   ② `customer_branches` · `label_templates` · `permission_templates` ·
--      `subcontractor_categories` BİLEREK DIŞARIDA: bu dört tabloda uygulama
--      guard'ı YOK (`duplicateNameField` tanımlı değil), yani bugün mükerrer ad
--      MEŞRUDUR. Sed eklemek uygulamanın aynası değil YENİ BİR KISIT olurdu —
--      iş kararı, teknik boşluk değil ("iki müşterinin de 'Merkez' şubesi
--      olabilir mi?" sorusunun cevabı bu turda verilmedi).
--   ③ `stations` DIŞARIDA: saha kopyasında TEMİZ (0 mükerrer) ama dev'de 3 grup
--      var ve üçü de TEST FIXTURE artığı ("TEST Rota Zımpara" ×3). Sed eklemek
--      sabit adla istasyon yaratan testleri ikinci koşumda P2002'ye düşürürdü
--      (CLAUDE.md'nin kayıtlı tuzağı). Önce o fixture'lar damgalanmalı.
--
-- ÖLÇÜM (2026-08-31): aşağıdaki 8 tablonun sekizi de HEM dev'de HEM saha
-- kopyasında 0 mükerrer → sed bugün enforce edilebilir.
--
-- ⚠️ YUMUŞAK KAPI (28. migration emsali): bir tabloda mükerrer varsa o tablonun
-- index'i ATLANIR ve NOTICE basılır — deploy DURMAZ. Temizlik sonrası bu dosya
-- yeniden koşulabilir (idempotent: IF NOT EXISTS). Atlanan tablo şemada
-- `@@unique` taşıdığı için `test_schema_drift` o tabloda kırmızı verir; bu
-- BİLİNÇLİ bir "enforce bekliyor" sinyalidir.
--
-- ⚠️ Bu tabloların HİÇBİRİNDE `mergedIntoId` YOK (ölçüldü) → partial predicate
-- gerekmez; `customers/items/subcontractors` seddindeki `WHERE "mergedIntoId"
-- IS NULL` buraya KOPYALANMAZ. Soft-delete (`isActive`) de predicate'e GİRMEZ:
-- uygulama guard'ı pasif kaydı da aday sayar ("PASİF, aktifleştirin" der), sed
-- onun aynası olmalıdır.
--
-- Tablolar küçük (en büyüğü birkaç yüz satır) → kilit süresi ihmal edilebilir;
-- yine de vardiya dışında deploy edin (proje kuralı).
-- =============================================================================
DO $$
DECLARE
  h RECORD;
  mukerrer BIGINT;
BEGIN
  FOR h IN
    SELECT * FROM (VALUES
      ('defect_types',       'defect_types_nameFold_key',       '("nameFold")'),
      ('fabric_properties',  'fabric_properties_nameFold_key',  '("nameFold")'),
      ('peripheral_devices', 'peripheral_devices_nameFold_key', '("nameFold")'),
      ('product_recipes',    'product_recipes_nameFold_key',    '("nameFold")'),
      ('quality_grades',     'quality_grades_nameFold_key',     '("nameFold")'),
      ('return_reasons',     'return_reasons_nameFold_key',     '("nameFold")'),
      ('routes',             'routes_nameFold_key',             '("nameFold")'),
      -- KAPSAMLI: makine adı istasyon İÇİNDE tekil.
      ('machines',           'machines_stationId_nameFold_key', '("stationId", "nameFold")')
    ) AS t(tablo, index_adi, kolonlar)
  LOOP
    -- Zaten varsa dokunma (yeniden koşum güvenli).
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=h.index_adi) THEN
      RAISE NOTICE 'ATLANDI (zaten var): %', h.index_adi;
      CONTINUE;
    END IF;

    EXECUTE format(
      'SELECT count(*) FROM (SELECT 1 FROM %I GROUP BY %s HAVING count(*) > 1) x',
      h.tablo, h.kolonlar
    ) INTO mukerrer;

    IF mukerrer > 0 THEN
      RAISE NOTICE 'ATLANDI — %s tablosunda % mükerrer grup var. Temizlik sonrası bu migration yeniden koşulabilir (enforce bekliyor).', h.tablo, mukerrer;
      CONTINUE;
    END IF;

    EXECUTE format('CREATE UNIQUE INDEX %I ON %I %s', h.index_adi, h.tablo, h.kolonlar);
    RAISE NOTICE 'KURULDU: %', h.index_adi;
  END LOOP;
END $$;
