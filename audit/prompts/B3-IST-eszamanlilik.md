# Oturum B3 — `IST.eszamanlilik`

> Bu dosyanın TAMAMI yeni bir oturuma yapıştırılmak içindir.
> Kaynak: audit/PLAN.md §7. Değişiklik gerekirse PLAN.md'yi düzenle ve bu dosyaları yeniden üret.

## Kapsam ve girdiler

**Kapsam:** `src/services/tambur.service.ts` (3.318) · `kursun-qc.service.ts` (1.656) ·
`kursun-bypass.service.ts` (2.362) · `tambur-manual.service.ts` · `tambur-undo.service.ts` ·
`helpers/kursun-bypass-eligibility.ts` · `helpers/kursun-bypass-guard.helper.ts`

**Kapsam DIŞI:** kalite kararının iş kuralı doğruluğu → P1 (IST.DOG).

**Okunacaklar:** `audit/surface/12-tx-global-gercekler.md` · `06-veri-katmani.md` §3.3 satır 1/13/18/20/21/24 ·
`jq 'select(.cell=="CORE.veri-performans")' audit/FINDINGS.jsonl` (özellikle barkod sayacı bulgusu)

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
  jq -r 'select(.cell=="IST.eszamanlilik") | "\(.id) [\(.severity)] \(.title)"' audit/FINDINGS.jsonl
  (mükerrer üretmemek için; boşsa ilk oturumdur)

VERİMLİLİK: ham araç çıktılarını (audit/raw/*.out) ve route envanterlerini BÜTÜN OLARAK OKUMA.
Hedefli grep/jq yap. Yüzey belgelerinden yalnız aşağıda listelenenleri oku.

BU OTURUMUN HÜCRESİ:  cell = IST.eszamanlilik

GÖREV: Tambur + Kurşun/KK2 istasyonlarının eşzamanlılık doğruluğu.

Doğrulanmış taban: tambur.finalize (790-1166) TEK TX'TE 377 SATIR - kod tabanının en uzun
transaction'ı. İçinde `for (const seg of segments)` döngüsünde segment başına
generateRollBarcode + tx.roll.create + tx.rollProperty.createMany + tx.rollOperation.createMany.
Zod tavanı 200 kesim (tambur.controller.ts:41). Yani en kötü durum ~800-1200 round trip,
20 sn bütçe içinde, ÜSTELİK global barkod sayacı kilidi elde tutuluyor.

1. finalize'ın en kötü durumunu ÖLÇ (200 kesim). Bütçe yetiyor mu? Yetmezse ne olur -
   P2028 -> 503, ve kısmi yazım OLMAZ (tx rollback) ama operatör 200 kesimi yeniden mi girecek?
   Barkod sayacı kilidi bu süre boyunca tutulduğu için paralel KK1 girişleri ne kadar bekliyor?
   fix_sketch: kesimi batch'lere bölmek mümkün mü, yoksa atomiklik şart mı?

2. Aynı topu iki tablet aynı anda finalize ederse? closeOpenMovementsTx'in exitedAt IS NULL
   guard'ı yeterli mi? CLAUDE.md "3 paralel okutmadan yalnız biri kapatıyor - ölçüldü" diyor,
   DOĞRULA ve hangi mekanizmanın koruduğunu yaz.

3. KURŞUN BYPASS REJİMİ. assertKursunTabletMayWrite BEŞ tablet yazma yolunu kapsıyor
   (KK2 tamamlama, hata kaydı, tablet adım kapatma, açık kumaş açma, kurşun bitirme).
   resolveBypassBlockReason tek kaynak. SOR: bu beş yolun hepsi gerçekten guard'dan geçiyor mu
   (tek tek doğrula)? Guard tx İÇİNDE mi yoksa öncesinde mi - araya giren bir atama ne olur?

4. DAĞITIMSIZ KAPANIŞ (2026-08-06). completeFromTambur atama yoksa SANAL bekleyen üretiyor
   (source: "UNASSIGNED") ve marker KURSUN_BYPASS_FINISHED:UNASSIGNED:<uuid> yazıyor.
   CLAUDE.md diyor ki "atomik claim EKLENMEDİ ve gerekmiyor - claim'in işini
   closeBypassMovementsTx'in exitedAt IS NULL guard'ı görüyor". BU İDDİAYI SINA:
   3 paralel okutmada gerçekten 1 kapanış mı oluyor? Marker ön eki uyumu
   (startsWith(KURSUN_BYPASS_MARKER_PREFIX)) hasBypassClosureOnProcessQcTx ve
   loadBypassEligibilitySignals.closedNonBypass ile tutuyor mu?

5. tambur-undo (applyFull, 133 satır, 15 tx çağrısı, döngüde yazma). Undo ile eşzamanlı
   bir ileri işlem (yeni kesim, sevk) çakışırsa? MANUAL modu softDelete'i çağırıyor
   (qtyOut=0 semantiği) - bu rescueStuckRoll'un qtyOut=qtyIn semantiğinden farklı, karışma var mı?

6. kursun-qc.finishStep (105 satır, döngüde yazma, ham SQL) ve cutOpenFabric / cutWarehouseRoll /
   finalizeWarehouseCut / finalizeOpenFabric - beşi de Roll yaratıyor. Hepsi aynı barkod
   sayacı kilidini alıyor mu? Kilit sırası tutarlı mı (ABBA deadlock riski)?

BİTİŞ KRİTERİ: 6 madde karara bağlanacak. Madde 1 için somut sayı (kaç round trip, tahmini süre).
Madde 4'teki iddia ya doğrulanacak ya çürütülecek.
