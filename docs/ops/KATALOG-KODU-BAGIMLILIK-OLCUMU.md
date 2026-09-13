# Ölçüm reçetesi — "bu paket ikinci bir fabrikada koşar mı?"

> **Elle koşulan bir ÖLÇÜM, bir bekçi DEĞİL.** Kalıcı bir teste çevirmeyin:
> katalog rejimini değiştiren bir test, ortak çalışma ağacında **başka
> oturumların ölçümünü sessizce bozar** (2026-09-13 kararı).

## Soru

Proje *"tek gövde, çok fabrika"* diyor. Bu ölçüm onu **yanlışlanabilir** hâle
getirir: *kataloğu bu fabrikanınkinden farklı olan bir kurulumda paketin kaç
bekçisi düşer?*

Cevap bir sayıdır ve **tek yönde** gitmelidir. Borç ödendikçe düşer; artarsa
yeni bir çakılı varsayım girmiştir.

## Ölçüm (2026-09-13, ilk koşum)

```
taban (1.KALITE / A1 / FIRE) :  6 kırmızı / 509 dosya
1K / 2K / HURDA              : 65 kırmızı / 510 dosya
────────────────────────────────────────────────────
KATALOG KAYNAKLI             : 61   (53'ü ÇÖKME, 8'i yüklem kırmızısı)
```

## ⚠️ EN KRİTİK ADIM — snapshot'lar da çevrilir

`Roll.qualityGrade` katalog kodunun **snapshot'ıdır**. Yalnız katalogu yeniden
adlandırırsanız mevcut toplar **yetim koda** düşer ve ölçüm, ölçmek istediğiniz
şeyi değil **kendi kurduğunuz tutarsızlığı** ölçer — çıkan kırmızılar *"başka
katalog"*u değil *"bozuk veri"*yi gösterir.

**İkisi aynı transaction'da çevrilir.** Rol damgaları (`role`) DEĞİŞMEZ: rol
kurulumdan bağımsızdır (`FIRST` her fabrikada "1. kalite"dir), değişen yalnız
fabrikanın kodudur. Böylece kurulum bir simülasyon değil **meşru bir ikinci
müşteri profili** olur.

## Adımlar

⚠️ Hedef **kendi `_test` veritabanınız** olmalı — `.env`in gösterdiği canlı
kopya değil. `DATABASE_URL`i açıkça geçirin.

**1) Çevir**

```sql
BEGIN;
UPDATE rolls          SET "qualityGrade" = '1K'    WHERE "qualityGrade" = '1.KALITE';
UPDATE rolls          SET "qualityGrade" = '2K'    WHERE "qualityGrade" = 'A1';
UPDATE rolls          SET "qualityGrade" = 'HURDA' WHERE "qualityGrade" = 'FIRE';
UPDATE quality_grades SET code = '1K',    name = '1. Kalite' WHERE code = '1.KALITE';
UPDATE quality_grades SET code = '2K',    name = '2. Kalite' WHERE code = 'A1';
UPDATE quality_grades SET code = 'HURDA', name = 'Hurda'     WHERE code = 'FIRE';
COMMIT;
```

**2) Koş**

```bash
cd Teks-Erp && DATABASE_URL="postgresql://…/<sizin>_test?schema=public" npm test
```

**3) Say** — kırmızıları tabandan çıkarın:

```bash
grep '^❌' <çıktı> | sed 's/^❌ *//;s/ .*//' | sort > /tmp/yeni.txt
comm -23 /tmp/yeni.txt /tmp/taban.txt | wc -l
```

**4) GERİ AL — ve İKİ YÖNLÜ DOĞRULA**

```sql
BEGIN;
UPDATE quality_grades SET code = '1.KALITE', name = '1. Kalite'       WHERE code = '1K';
UPDATE quality_grades SET code = 'A1',       name = 'A1 (Alt Kalite)' WHERE code = '2K';
UPDATE quality_grades SET code = 'FIRE',     name = 'Fire'            WHERE code = 'HURDA';
UPDATE rolls SET "qualityGrade" = '1.KALITE' WHERE "qualityGrade" = '1K';
UPDATE rolls SET "qualityGrade" = 'A1'       WHERE "qualityGrade" = '2K';
UPDATE rolls SET "qualityGrade" = 'FIRE'     WHERE "qualityGrade" = 'HURDA';
COMMIT;
```

```sql
-- Katalog geri geldi mi + YETİM KOD kalmadı mı (ikisi de sorulur)
SELECT code, role, "isActive" FROM quality_grades ORDER BY "sortOrder";
SELECT count(*) AS yetim FROM rolls r
 WHERE r."qualityGrade" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM quality_grades q WHERE q.code = r."qualityGrade");
```

`yetim = 0` görmeden ölçümü bitmiş saymayın. Yarım kalmış bir katalog rejimi
ortak ağaçta **komşu oturumun** koşumunu bozar.

## Düzeltme kalıbı

Bekçi kalite satırını **ROLDEN** çözer, koddan değil:

```ts
import { roleGrade } from "./fixture-quality-grade";

const g = await roleGrade("FIRST");        // "SECOND" · "SCRAP"
// … qualityGrade: g.code, qualityGradeId: g.id
```

## ⚠️ Hangi literale DOKUNULMAZ

Bazı bekçiler **kasıtlı olarak** katalogda olmayan bir kod kullanır
(`'ZZZ-YOK'`, `' a1 '`, `'2.KALITE'`) ve *"bilinmeyen kod ne olur"* davranışını
ölçer. **Oradaki literal bir varsayım değil, ÖLÇÜMÜN KENDİSİDİR.** Düzeltmek
ölçtüğü şeyi silmek olur.

Aynı şekilde belge/etiket örnek verisi (`'A'`, `'B'`) ve ad biçimleri
(`'1. Kalite'`) ayrı sınıftır — tek sayı üçünü birden yanlış temsil eder.

## Bu ölçümün GÖREMEDİĞİ

⚠️ **Düşen bekçi kendini söyler; sessizce yanlış ölçen söylemez.** Yalnız-okuma
iddiaları (2026-09-13'te 68 isabet) bu deneyde düşmedi ama yüklemleri artık
başka bir şeyi ölçüyor olabilir. O küme **ayrı bir yöntem** ister: düşmeyi
değil, *yüklemin hâlâ ölçmek istediğini ölçüp ölçmediğini* sormak.

⚠️ Ve bu deney **tek bir karşı-fabrika** ölçer. Kodları koruyup **rolleri**
kaldıran bir kurulum başka bir küme düşürür — ayrı senaryo.
