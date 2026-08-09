# Oturum B5 — `SEV.dogruluk`

> Bu dosyanın TAMAMI yeni bir oturuma yapıştırılmak içindir.
> Kaynak: audit/PLAN.md §7. Değişiklik gerekirse PLAN.md'yi düzenle ve bu dosyaları yeniden üret.

## Kapsam ve girdiler

**Kapsam:** brüt/net kuralının **altı yüzeyi**: `getDispatchReport` · `listShipments.attachTotals` ·
`accounting-export.service.ts` · `getShipmentById` · `collectShipmentDocContent` · `sack-search.service.ts`

**Kapsam DIŞI:** sevk tx'inin eşzamanlılığı → B1. Belge yerleşimi/CSS → BLG.

**Okunacaklar:** `jq 'select(.cell=="SEV.eszamanlilik")' audit/FINDINGS.jsonl` ·
kök `CLAUDE.md`'nin 2026-08-02 / 08-03 / 08-05 brüt kuralı notları

---

## YAPIŞTIRILACAK PROMPT

Bu bir DENETİM oturumudur. Kod DEĞİŞTİRME — salt okuma çalış.
Kod tabanı: /Users/oad/Documents/projeler/AdnanSahin/Teks-Erp (Express 5 + Prisma 7 + PostgreSQL, PRODUCTION CANLI).

ÇIKTI: bulgularını audit/FINDINGS.jsonl dosyasına APPEND et (satır başına bir JSON).
Şema ve yazım kuralları: audit/SCHEMA.md — ÖNCE ONU OKU.
Zorunlu alanlar: id, cell, severity, category, file, line, title, evidence, failure_mode,
fix_sketch, verification, status, confidence, session, found_at.

KALİTE KURALLARI:
- `failure_mode` üretemiyorsan (somut girdi -> somut yanlış sonuç) bu bir bulgu DEĞİLDİR.
  severity: bilgi ver ya da hiç yazma. "Bu kod karışık" bulgu değildir.
- Emin değilsen confidence: supheli ver ve verification alanına "nasıl kesinleşir" yaz.
- Aynı kök nedenin N tezahürü TEK bulgudur.
- CANLI SİSTEM: fix_sketch migration veya toplu veri dokunuşu öneriyorsa prod_risk: yuksek
  zorunlu ve geri alma yolu yazılmalı. `migrate reset` / reseed / toplu DELETE bu repoda YASAK.

YAZIM: Türkçe, teknik terimler İngilizce orijinaliyle. Emoji ve LaTeX kullanma.

OTURUM BAŞINDA ZORUNLU:
  jq -r 'select(.cell=="SEV.dogruluk") | "\(.id) [\(.severity)] \(.title)"' audit/FINDINGS.jsonl
  (mükerrer üretmemek için; boşsa ilk oturumdur)

VERİMLİLİK: ham araç çıktılarını (audit/raw/*.out) ve route envanterlerini BÜTÜN OLARAK OKUMA.
Hedefli grep/jq yap. Yüzey belgelerinden yalnız aşağıda listelenenleri oku.

BU OTURUMUN HÜCRESİ:  cell = SEV.dogruluk

GÖREV: "Sevk rakamı brüttür, iade onu geriye dönük değiştiremez" kuralının TÜM yüzeylerde
tutarlı uygulandığını doğrula. Bu kural beş kez, beş ayrı saha vakasından SONRA eklendi -
yani bu alanda tekrar eden bir hata sınıfı var.

Kök neden tek satır: RollReturn topun sackId VE shipmentId'sini NULL'lar
(return.service.ts:322-325). Her canlı sorgu bu yüzden NET okur.

DOĞRULANMASI GEREKEN ALTI YÜZEY:
  1. getDispatchReport            -> donmuş PrintedDocument.snapshot'tan okur (frozen:false ise canlı)
  2. listShipments.attachTotals   -> canlı + RollReturn geri-ekleme
  3. accounting-export.service    -> canlı + RollReturn geri-ekleme
  4. getShipmentById              -> canlı + prevSackId ile çuval bazında geri-ekleme
  5. collectShipmentDocContent    -> canlı + prevSackId geri-ekleme (reissue/lazy-init yolları için)
  6. sack-search / çuval etiketi yeniden basımı -> CLAUDE.md'ye göre HÂLÂ CANLI OKUYOR (kapsam dışı bırakılmış)

1. ALTI YÜZEYİ TEK TEK OKU ve her biri için yaz: brüt mü net mi, kaynağı ne (snapshot mı
   RollReturn mı), dedup var mı, prevSackId taşımayan eski iadeler nasıl ele alınıyor.
   Bir tablo üret. Ayrışan varsa bulgu.

2. 6. yüzey (sack-search) bilinçli olarak kapsam dışı bırakılmış. SOR: bu gerçekten zararsız mı?
   Çuval etiketi yeniden basıldığında iade edilmiş top etikette görünmüyor - operatör için
   yanlış bilgi mi, doğru bilgi mi? (Çuval fiziksel bir nesne; iade edilen top artık içinde
   değil. Belki NET burada DOĞRUDUR.) Kararı gerekçelendir.

3. totalKg DEĞİŞMEZ kuralı: iade Sack.weightKg'a dokunmuyor, o yüzden zaten brüt, geri-ekleme
   çift sayardı. Altı yüzeyin hiçbirinde kg'ye geri-ekleme yapılmadığını DOĞRULA.

4. ÇİFT SAYIM TUZAKLARI (CLAUDE.md üçünü de sayıyor): (a) sacks[].rolls ile summary ayrı
   toplanırsa; (b) shipment.findUnique ile iade sorgusu ayrı tx'lerde -> canlı id kümesiyle dedup;
   (c) sentetik satır sackId = prevSackId taşımalı. Üçünün de her yüzeyde uygulandığını doğrula.

5. RAPOR TARAFI. reports/ servisleri domain servislerini HİÇ import etmiyor (ölçüldü) ve
   ham SQL yazıyor. Sevkle ilgili rapor var mı (reports/sales, reports/customer)? Varsa
   brüt kuralını uyguluyor mu, yoksa YEDİNCİ bir kaynak mı? Bu, RAP.dogruluk hücresinin de
   girdisi olacak - bulursan related alanıyla bağla.

6. Muhasebe Excel'inde sevk satırları BRÜT, iade satırları AYRI sayfa. CLAUDE.md diyor ki
   eskiden satırlar net idi VE ayrı iade sayfası vardı -> muhasebeci "sevk - iade" yapınca
   aynı metraj İKİ KEZ düşüyordu. Bugünkü halin doğru olduğunu gerçek veriyle doğrula
   (dev DB'de iadeli bir sevkiyat bul, üç yüzeyin rakamını karşılaştır).

BİTİŞ KRİTERİ: madde 1'in altı satırlık tablosu üretilmiş olacak ve
audit/surface/13-brut-kurali-yuzeyler.md dosyasına yazılacak.
