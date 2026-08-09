# Oturum B4 — `URE.eszamanlilik`

> Bu dosyanın TAMAMI yeni bir oturuma yapıştırılmak içindir.
> Kaynak: audit/PLAN.md §7. Değişiklik gerekirse PLAN.md'yi düzenle ve bu dosyaları yeniden üret.

## Kapsam ve girdiler

**Kapsam:** `src/services/workorder.service.ts` (6.073) · `workorder-split.service.ts` ·
`workorder-manual-move.service.ts` · `workorder-batch-drop.service.ts` · `batch.service.ts` (975) ·
`helpers/workorder-locks.ts` · `helpers/roll-step.helper.ts` · `helpers/workorder-clone.helper.ts`

**Kapsam DIŞI:** iş emri iş kuralları (rota, hedef, kapsama) → P1 (URE.DOG).

**Okunacaklar:** `audit/surface/12-tx-global-gercekler.md` · `06-veri-katmani.md` §3.3 satır 5/7/8/11/12/16/22/25 · §4

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
  jq -r 'select(.cell=="URE.eszamanlilik") | "\(.id) [\(.severity)] \(.title)"' audit/FINDINGS.jsonl
  (mükerrer üretmemek için; boşsa ilk oturumdur)

VERİMLİLİK: ham araç çıktılarını (audit/raw/*.out) ve route envanterlerini BÜTÜN OLARAK OKUMA.
Hedefli grep/jq yap. Yüzey belgelerinden yalnız aşağıda listelenenleri oku.

BU OTURUMUN HÜCRESİ:  cell = URE.eszamanlilik

GÖREV: İş emri + parti durum makinesinin eşzamanlılık doğruluğu.

Doğrulanmış taban: workorder.service 9 $transaction / 25 updateMany; replace 305 satır,
completeWorkOrder 213, softDelete 175, attachRolls 127, detachRolls 112 - beşi de döngüde yazma
ve/veya ham SQL içeriyor. batch.service 6 tx / 12 updateMany; mergeBatches 253 satır,
moveRolls 143. Parti no üretimi pg_advisory_xact_lock(8022, 1) ile korunuyor ve kilit
generateBatchNumberTx'in İLK ifadesi (TOCTOU'ya karşı load-bearing).

1. PARTİ NO SARMASI. batchNumber @unique KALDIRILDI (migration 20260805120000). Numara
   P01..P99 arasında dönüyor ve sarma KÖRLEMESİNE (numaranın canlı bir partide olup olmadığına
   bakılmıyor - bu bilinçli bir ürün kararı). Sayaç "en son doğan kısa parti"den türetiliyor
   (createdAt DESC LIMIT 1) ve SQL regex'i ^P(0[1-9]|[1-9][0-9])$ LOAD-BEARING.
   SINA: regex gevşerse ne olur (eski günlük kod dönerse sayaç P01'e düşer ve canlı P01 dururken
   ikinci P01 doğar)? Advisory lock gerçekten ilk ifade mi? Bayrak kapalıyken (günlük kalıp)
   aynı koruma geçerli mi?

2. withBarcodeRetry (73 referans) P2002'de TÜM $transaction'ı yeniden koşuyor. Yeniden koşan
   tx'in yan etkileri idempotent mi? Özellikle: audit çift yazımı, parti no sayacı boşluğu,
   belge dondurma (freeze) çift versiyon, traveler card dirty işaretleme.
   Retry sayısı ve backoff ne? Sonsuz döngü koruması var mı?

3. WORKORDER DURUM MAKİNESİ. recomputeStepStatus + ensureWorkOrderInProgress +
   completeWorkOrderIfStepsDone. CLAUDE.md 2026-08-04 notu "giriş noktası" kuralını anlatıyor
   (aşağıdan katılan top yukarıdaki adımı bekletmemeli) ve bunun bir kez iş emirlerini
   "bir daha asla kapatılamaz" hale getirdiğini söylüyor. SINA: bu kural eşzamanlı yazımda
   da tutuyor mu? İki paralel adım kapanışı completeWorkOrderIfStepsDone'u aynı anda çağırırsa?
   Terminal guard (CANCELLED/SUPERSEDED asla COMPLETED'a dirilmez) her yolda mı?

4. helpers/workorder-locks.ts (229 satır) - kilit sırası burada tanımlı mı? Hangi yollar
   bu kilidi alıyor, hangileri almıyor? subcontractor.service da bu kilidi alıyor (modul
   haritasi §4.3: FASON -> ÜRETİM 4 value import). Kilit sırası iki context arasında tutarlı mı?

5. mergeBatches (253 satır) ve moveRolls (143) ile splitBatch/splitRemainder eşzamanlı koşarsa?
   Parti bir kez merge edilince mergedIntoId set ediliyor - bu atomik claim mi?

6. workorder-manual-move.manualMove (255 satır, 14 tx çağrısı, döngüde yazma). COMPLETED bir
   WO'yu IN_PROGRESS'e diriltiyor. Eşzamanlı bir completeWorkOrderIfStepsDone ile yarışırsa?

7. type Db = PrismaClient | Prisma.TransactionClient çift-mod helper'ları (workorder-locks,
   kursun-bypass-guard, kursun-bypass-eligibility). Çağrı yerlerinin HANGİSİ tx içinde,
   hangisi havuzdan ayrı bağlantıyla koşuyor - TEK TEK doğrula. "Tx içinde sanıyorduk ama
   değildi" sınıfı sessiz hata zemini.

BİTİŞ KRİTERİ: 7 madde karara bağlanacak. Madde 2 ve 7 mutlaka somut liste üretecek.
