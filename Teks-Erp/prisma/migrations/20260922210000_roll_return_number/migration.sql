-- İADE BELGE NO — TÜRETİLEN numara KOLONA alınır (Faz C2, 2026-09-22)
--
-- NEDEN: iade belge no bugüne kadar HER OKUMADA türetiliyordu
-- (`returnDocumentNo(createdAt, id)`), kolonu yoktu. Biçim bir gün değişirse
-- TÜM GEÇMİŞ iade numaraları geriye dönük değişirdi — bu, bütün numaralandırma
-- işinin sebebi olan kullanıcı değişmezinin canlı ihlalidir:
-- "belge-çıktı-programdaki veriler birbiriyle aynı olmalı."
--
-- ⚠️ NUMARA SATIRA DEĞİL BELGEYE AİTTİR (ölçüldü 2026-09-22):
-- `return.service.ts:88-91` belgeyi `returnGroupId ?? id` ile çözüyor, yani çok
-- kalemli iadede belge YALNIZ grup liderine bağlı. Her satıra kendi id'sinden
-- numara yazmak, üye satırlara HİÇBİR BELGEDE OLMAYAN bir numara verirdi ve
-- panel onu gösterdiğinde "programdaki numara belgedeki numara değil" hâli
-- doğardı — kapatmaya çalıştığımız deliğin ta kendisi.
-- ⇒ Üye satırlar LİDERİN numarasının kopyasını taşır.
--
-- GERİ DOLDURMA BUGÜNKÜ BELGE DEĞERİNİN BİREBİR AYNISIDIR ve bilerek SQL'de
-- yazılmıştır: beklenen değeri üreten yol (TS `returnDocumentNo`) ile doğrulayan
-- yol AYNI olsaydı bekçi kendi kendini doğrulardı (araç gözlenenin içinde).
-- `test_return_no_backfill` iki yolu KARŞILAŞTIRIR.
--
-- ⚠️ `AT TIME ZONE 'Europe/Istanbul'`: `ddmmyy` fabrika TAKVİM GÜNÜNÜ kullanır
-- (`constants/time.ts`), süreç saat dilimini değil. Çıplak `to_char` UTC'ye
-- düşer ve gece 00:00–03:00 arası üretilen kayıtlarda BİR ÖNCEKİ günü yazardı
-- (ölçüldü: sonda kolunda `IADE-210926` ↔ `IADE-220926`).
ALTER TABLE "roll_returns" ADD COLUMN "returnNo" VARCHAR(64);

-- Numara BELGE ÇAPASINDAN (tekil iade: kendisi · çok kalemli: lider) üretilir.
UPDATE "roll_returns" r
   SET "returnNo" = 'IADE-'
       || to_char(l."createdAt" AT TIME ZONE 'Europe/Istanbul', 'DDMMYY')
       || '-'
       || upper(substr(l."id"::text, 1, 6))
  FROM "roll_returns" l
 WHERE l."id" = COALESCE(r."returnGroupId", r."id");

-- ⚠️ TEKİLLİK BELGE BAŞINADIR, SATIR BAŞINA DEĞİL — üye satırlar liderin
-- numarasının KOPYASINI taşır ve kısıt dışında kalır. Yüklem tam olarak
-- `documentSourceId = returnGroupId ?? id` ifadesinin sed karşılığıdır:
-- tekil iade (`NULL`) ya da LİDER (kendine referans).
-- ⚠️ `"returnGroupId" IS NULL` tek başına YETMEZ ve bu ÖLÇÜLDÜ: grup yazımı
-- (`return.service.ts:609-612`) `where: { id: { in: createdIds } }` ile LİDERİ
-- DE kapsıyor, yani liderin `returnGroupId`i KENDİ id'sidir, NULL değil. O
-- yüklemle grupların tamamı kısıt dışında kalır ve iki ayrı iade GRUBU aynı
-- numarayı alabilirdi.
CREATE UNIQUE INDEX "roll_returns_returnNo_doc_key"
    ON "roll_returns" ("returnNo")
 WHERE "returnNo" IS NOT NULL
   AND ("returnGroupId" IS NULL OR "returnGroupId" = "id");

-- ⚠️ SAYACIN KAPSAMI: bundan sonraki numaralar SAYAÇTAN gelecek
-- (`IADE-GGAAYY-000001`), geçmiş ise `id`den türemiş HEX kuyruklar taşıyor
-- (`IADE-220926-A1B2C3`). Hex kuyrukların bir kısmı TAMAMEN RAKAM olabilir
-- (uuid'in ilk 6 karakteri; olasılık ~%6) ve o kodlar sayaca SAYISAL olarak
-- girip sırayı 123.457'ye fırlatırdı — C0'da ölçülen arızanın aynısı.
-- Yapısal ayıklama (kuyrukta harf ara) bu yüzden SAHTE çözümdür.
-- ⇒ Kapsam damgası kurulur: sayaç yalnız BU ANDAN SONRA doğan kodlara bakar.
-- Satır yoksa (taze kurulum) no-op'tur ve gerekmez de: orada geçmiş iade yoktur.
UPDATE "number_series"
   SET "formatChangedAt" = NOW()
 WHERE "key" = 'returnDoc' AND "formatChangedAt" IS NULL;
