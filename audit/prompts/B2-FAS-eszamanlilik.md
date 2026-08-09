# Oturum B2 — `FAS.eszamanlilik`

> Bu dosyanın TAMAMI yeni bir oturuma yapıştırılmak içindir.
> Kaynak: audit/PLAN.md §7. Değişiklik gerekirse PLAN.md'yi düzenle ve bu dosyaları yeniden üret.

## Kapsam ve girdiler

**Kapsam:** `src/services/subcontractor.service.ts` (6.055) · `kartela.service.ts` (1.522) ·
`subcontractor-management.service.ts` · `helpers/batch-dispatch-surgery.helper.ts` ·
`helpers/subcontractor-cancel.helper.ts`

**Kapsam DIŞI:** fason belgelerinin içeriği/yerleşimi → BLG. Fason kabul doğruluğu → P1 (FAS.DOG).

**Okunacaklar:** `audit/surface/12-tx-global-gercekler.md` · `06-veri-katmani.md` §3.3 satır 2/3/4/9/14/15 ·
`01-modul-haritasi.md` §5.5

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
  jq -r 'select(.cell=="FAS.eszamanlilik") | "\(.id) [\(.severity)] \(.title)"' audit/FINDINGS.jsonl
  (mükerrer üretmemek için; boşsa ilk oturumdur)

VERİMLİLİK: ham araç çıktılarını (audit/raw/*.out) ve route envanterlerini BÜTÜN OLARAK OKUMA.
Hedefli grep/jq yap. Yüzey belgelerinden yalnız aşağıda listelenenleri oku.

BU OTURUMUN HÜCRESİ:  cell = FAS.eszamanlilik

GÖREV: Fason sevk/kabul/iptal akışının eşzamanlılık doğruluğu.
Blast radius = MAL FİZİKSEL OLARAK FABRİKA DIŞINDA. Yanlış durum = kayıp mal.

Doğrulanmış taban: üç dev transaction - dispatch 354 satır, executeDirectShip 315, receive 312.
dispatch ve executeDirectShip belge dondurma içeriyor; receive ve executeDirectShip ham SQL
içeriyor; receive, undoTransfer, cancelReceipt döngüde yazma yapıyor.

1. Üç dev tx'in her biri için: kaç sorgu koşuyor, kilit sırası ne, 20 sn bütçesine göre
   en kötü durum ne? receive N makbuz satırı için döngüde top yaratıyor - tavan var mı
   (Zod şemasına bak, tambur'daki 200 kesim emsali)?

2. subcontractor.service ÜRETİM DURUM MAKİNESİNE YAZIYOR (modul haritasi §5.5, ölçüldü):
   tx.workOrderStep.update x5 + updateMany x1 (satır 1043, 2046, 2067, 2689, 5439, 5463)
   ve tx.workOrder.update x3 (2059, 2704, 5479). Yani fason, ÜRETİM context'inin dışından
   iş emri adım durumunu değiştiriyor. SOR: bu yazımlar recomputeStepStatus /
   completeWorkOrderIfStepsDone ile aynı kuralı uyguluyor mu, yoksa paralel bir durum makinesi mi?
   Eşzamanlı bir tambur finalize ile çakışırsa hangi guard koruyor?

3. Fason kabulünde orijinal rulolar SUBCONTRACTOR_CONSUMED ile emekliye ayrılıyor ve makbuzdan
   yeni Roll'lar doğuyor. İki eşzamanlı kabul aynı sevki işleyebilir mi? Atomik claim var mı?
   İptal (cancelReceipt, undoTransfer) ile kabul yarışırsa?

4. batch-dispatch-surgery.helper (393 satır, SubcontractorDispatch 9 + DispatchItem 5 yazım) -
   adı "surgery" olan bir helper. Ne yapıyor, hangi invariant'ları koruyor, tx içinde mi?

5. K10 kuralı "bir sevk = bir parti" (SubcontractorDispatch.batchId NOT NULL) ve K11 çok-partili
   sevkte merge. Kısmi sevkte kalanlar YENİ parti alıyor (splitRemainder). Bu üç yolun
   eşzamanlı koşumu parti numarası sayacıyla (advisory lock ns 8022) nasıl etkileşiyor?

6. withBarcodeRetry bu dosyada kaç yerde? P2002'de TÜM tx yeniden koşuyor - yeniden koşan tx'in
   yan etkileri idempotent mi (audit çift yazımı, belge çift dondurma, parti no boşluğu)?

BİTİŞ KRİTERİ: 6 madde karara bağlanacak. Madde 2 mutlaka net cevaplanacak
("aynı kural mı, paralel makine mi").
