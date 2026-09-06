# Veri Bütünlüğü Denetimi — AI Audit Talimatı (TeksERP)

> Bu dosya bir yapay zeka ajanına (Claude Code, Cursor, vb.) verilmek üzere hazırlanmıştır.
> Kullanım: `Bu projeyi VERI-BUTUNLUGU-DENETIMI.md dosyasındaki talimata göre denetle.`

---

## 1. Görev

Bu kod tabanını **veri bütünlüğü (data integrity)** açısından denetle. Amaç; duplicate (çift) kayıt, orphaned/ghost (hayalet) kayıt, race condition ve kısmi başarısızlık (partial failure) kaynaklı veri bozulmalarını tespit etmek ve somut düzeltme önermek.

Yeni özellik yazma. Sadece analiz et, bul, kanıtla, düzeltme öner.

---

## 2. Proje Bağlamı (denetime başlamadan ÖNCE oku)

**Stack:** Express 5 + Prisma 7 + PostgreSQL backend (`Teks-Erp/`), Electron admin paneli, React Native mobil (saha tabletleri). Backend **tek instance** çalışır (fabrika sunucusu) — çoklu-instance senaryoları düşük öncelik; asıl eşzamanlılık kaynağı **aynı anda okutma yapan birden fazla tablet + Electron**.

**Önce oku (sırayla):**
1. Kök `CLAUDE.md` — üretim akışı, domain kuralları, konvansiyonlar
2. `Teks-Erp/CLAUDE.md` ve `Teks-Erp/ARCHITECTURE.md` (özellikle §10.2 mutabakat/reconciliation takvimi)
3. `Teks-Erp/prisma/schema.prisma` — ~90 unique constraint, ~50 `onDelete` tanımı mevcut; "hiç FK yok" varsayımıyla başlama, **eksik olanları** ara
4. `docs/design/` altındaki tasarım dokümanları (ÇUVAL-HAVUZU, PARTI-MODELI, KARTELA)

**⚠️ PRODUCTION CANLI — gerçek fabrika, gerçek veri:**
- Doğrulama sorguları **SALT-OKUNUR** olmalı; canlı DB'ye değil **yedek/kopya üzerine** veya read-only bağlantıyla çalıştırılacak şekilde öner.
- Temizlik önerilerinde toplu `DELETE` **yasak** — soft-delete (`isActive:false` / `RollStatus.CANCELLED`) öner. Fiziksel silme öneriliyorsa gerekçesiyle işaretle, karar insana kalır.
- Veri düzelten her script **dry-run varsayılan** olmalı, `--apply` öncesi etkilenecek **her kaydı somut listelemeli** (mevcut örneklerdeki desen).
- Migration geri alınamaz kabul edilir (rollback = yedekten restore) — constraint önerilerinde bunu hesaba kat.

**Mevcut denetim araçları — mükerrer iş üretme, bunların ÜZERİNE ekle:**
- `Teks-Erp/scripts/consistency-check.sql` — salt-okunur tutarlılık taraması (shippedQty defter mutabakatı, negatif miktar, Roll↔Sack↔Shipment, vb.). Önce oku; Bölüm E'de **burada zaten kapsanan sorguları tekrar önerme**, eksik kalan boşlukları bu dosyaya eklenecek şekilde öner.
- `Teks-Erp/scripts/test_data_integrity_gaps.ts`, `test_audit_p0.ts`, `test_audit_followups.ts` — geçmiş denetimlerin regresyon testleri. Bölüm F testlerini aynı desende öner (`npx tsx scripts/test_*.ts`).
- Backend test paketi 210/210 geçiyor; CI fixture seed'i var. Önerilen testler ortamdaki veriye bağımlı olmamalı (geçmişte üç test bu yüzden düştü).

---

## 3. Bilinçli Kararlar — Bunları BULGU Olarak Raporlama

Aşağıdakiler bilinçli tasarım kararlarıdır; "eksik" diye işaretlenirse yanlış pozitiftir. Yalnızca **kararın uygulamasında tutarsızlık** görürsen raporla (örn. atomik claim kuralına uymayan yeni kod):

1. **Audit log best-effort ve tx DIŞINDA** — yazım hatası isteği düşürmez, `/health` sayacına düşer. (İstisna: `UserPreference` hiç loglanmaz.)
2. **Tanım (master-data) adlarında DB unique bilinçli YOK** — ad-mükerrer koruması uygulama katmanında (PG case-insensitive collation bilinçli kullanılmıyor). Vergi no, kullanıcı adı vb. mükerrer guard'ları ayrıca test edilmiş durumda.
3. **`KartelaDispatch`'te `clientToken` bilinçli yok** — idempotency'yi `SwatchStockReduction` olay modeli taşır.
4. **`Sack.notes` bir annotation'dır** — her durumda (sevk edilmiş çuvalda bile) yazılabilir, `touchWarehouseSackTx` guard'ı bilinçli uygulanmaz.
5. **Soft-delete istisnaları bilinçli:** bağımlılık-guard'lı master-data `DELETE /:id/permanent`, boş çuval silme, cihaz unpair, pivot replace, manuel geri taşımada hayalet movement silme.
6. **WO kapanış dispozisyonu `RollOperationType`'a yeni değer eklemez** — iz `movement.notes='WO_CLOSE_<ACTION>'` + audit `event='WO_CLOSE_DISPOSITION'` ile tutulur.
7. **Kuyruk / webhook / ödeme / mail altyapısı YOK** — outbox, DLQ, saga, at-least-once maddeleri büyük ölçüde uygulanamaz; "uygulanamaz" diye geç. Gerçek dış sınırlar: etiket/belge yazıcısı, kantar (Phase 1'de COM port simüle), `src/jobs/backup-scheduler.ts` + `archive-scheduler.ts`.

---

## 4. Aranacak Sorun Kategorileri

Aşağıdaki terimlerin her biri bir arama ekseni olarak kullanılmalıdır:

### 4.1 Çift / kopya veri
- `duplicate records` — aynı mantıksal varlığın birden fazla satırı
- `non-idempotent writes` — aynı isteğin tekrarı yeni kayıt üretiyor
- `double submit` — kullanıcı iki kez tıklıyor / client retry atıyor
- `retry storm` — timeout sonrası otomatik tekrar denemeler
- `duplicate side effects` — etiket basımı, stok düşümü, movement açılışı iki kez tetikleniyor
- `missing deduplication window` — tekrar tespiti için mekanizma yok

### 4.2 Hayalet / öksüz veri
- `orphaned records` — parent silinmiş/emekli olmuş, child kalmış
- `dangling references` — var olmayan ID'ye işaret eden FK/alan
- `ghost records` — mantıksal olarak kapanmış ama sorgularda hâlâ görünen (örn. kapanmamış movement)
- `soft-delete leakage` — `isActive:false` / `CANCELLED` kayıtların rapor/sayaç/unique kontrolüne sızması
- `missing referential integrity` — DB seviyesinde FK yok, sadece uygulama katmanı doğruluyor
- `cascade misconfiguration` — `onDelete` davranışı yanlış veya tanımsız

### 4.3 Eşzamanlılık (concurrency)
- `race condition` / `lost update` / `TOCTOU`
- `missing atomic claim` — proje standardı: durum geçişi `updateMany WHERE {id, beklenen-durum}` + `count===0 → 409`. **`findUnique→if→update` deseni YASAKTIR** — her sapma bulgudur.
- `missing optimistic locking` — version / updatedAt kontrolü gereken ama olmayan yerler
- `double-spend` — stok/metraj/kartela sayacı aynı anda iki kez tüketiliyor
- kod üretim yarışı — `BaseService.autoCode` (PREFIX+GGAAYY+NNNN) ve diğer sayaç tabanlı numaralar eşzamanlı istekte çakışıyor mu, unique ihlalinde retry var mı?

### 4.4 İşlem (transaction) sınırları
- `non-atomic transaction` — atomik olması gereken blok transaction dışında
- `missing rollback` — hata yolunda geri alma yok, `catch` bloğunda yarım iş
- `long-running transaction` — kilit süresi ve deadlock riski; havuz bütçesi (connectionTimeoutMillis) içinde mi?
- tx içinde dış çağrı — HTTP/yazıcı/dosya işlemi transaction içinde yapılıyor mu? (Audit bilinçli tx dışında — Bölüm 3.)
- tx-içi taze guard — kilit altına girince koşul yeniden doğrulanıyor mu? (Emsal: WO kapanışında taze in-flight küme kontrolü, Tambur finalize pre-tx + kilit-altı guard.)

### 4.5 Şema seviyesi eksikler
- `missing unique constraint` / `missing composite unique index`
- `missing foreign key` / yanlış `onDelete`
- `nullable field that should be NOT NULL`
- `missing CHECK` — negatif metraj/miktar/kg backstop'u
- `counter drift` — denormalize alan (`shippedQty`, `currentQty`, WO adım durumları) defterle kopabiliyor mu; `SET x = <okunan>` yerine atomik artırım/recompute mu?

---

## 5. TeksERP Sıcak Noktaları (önce buralara bak)

Denetim eforunun ağırlığı şu akışlarda olsun — her biri için en az bir somut eşzamanlılık senaryosu değerlendir:

| # | Akış | Somut senaryo |
|---|---|---|
| 1 | Tambur kesim / finalize | Kesim isteği ile WO kapatma (dispozisyon) aynı anda gelirse? Çocuk roll + movement + barkod ataması atomik mi? |
| 2 | Refakat kartı okutma | Aynı kart iki tablette aynı anda okutulursa adım/istasyon durumu çiftlenir mi? |
| 3 | Çuvala top okutma (`scanIntoSack`) | Aynı top iki çuvala aynı anda okutulursa? Çuval dispatch olurken içine top eklenirse? |
| 4 | Sevkiyat (`createShipment` / `dispatchShipment`) | Dispatch ile çuval düzenleme/çuvaldan çıkarma yarışırsa? `shippedQty` terfisi ile PLANNED iptali yarışırsa? `SackAllocation` FIFO dağıtımı iki kez koşarsa? |
| 5 | Fason sevk / kabul | Kabul ile manuel taşıma veya WO kapatma yarışırsa? Kabul yarıda kesilirse orijinal toplar `SUBCONTRACTOR_CONSUMED` ama çocuk roll doğmamış kalır mı? |
| 6 | WO kapanış dispozisyonu | Gönderilen liste ile tx-içi taze in-flight küme birebir doğrulanıyor mu (mevcut kural) — bypass eden yol var mı? |
| 7 | Mobil timeout-retry | `clientToken` mantıksal deneme başına BİR kez üretilip retry'da AYNEN mi gönderiliyor? (Emsal hata: mutate başına yeni token — 2026-07-27 Tambur düzeltmesi.) Token'sız kayıt-yaratan uç kaldı mı? |
| 8 | Tartı (kantar) tek dokunuş | Çift dokunuş / kantar tekrar okuma çifte tartı kaydı üretir mi? |
| 9 | Manuel düzeltme / taşıma | Geri taşımada VOID edilen kalite kararları ve silinen hayalet movement'lar eksiksiz mi — yarım kalırsa ne olur? |

**İdempotency envanteri (Bölüm B için başlangıç):** `clientToken @unique` şu modellerde var: `Roll`, `Order`, `WorkOrder`, `SwatchStockReduction`. Kayıt-yaratan diğer tüm uçları bu listeye karşı değerlendir — token taşımayan her create ucu ya gerekçeli istisna ya bulgudur.

**Tek-kaynak kural setleri — elle kopyalanmış hali bulgudur:**
- Ölü top kümesi: `K18_DEAD_STATUSES` (elle statü listesi kopyalayan filtre = bulgu)
- WO üretim çıktısı: `workorder.service.producedOutputWhere`
- Manuel taşıma engeli: `workorder-manual-move.service.manualMoveWoBlockReason`
- WO kapama: yalnız `completeWorkOrderIfStepsDone` (CANCELLED/SUPERSEDED asla COMPLETED'a dirilmez)

---

## 6. Çıktı Formatı

Raporu `docs/audit/VERI-BUTUNLUGU-RAPORU-<YYYY-AA-GG>.md` dosyasına yaz.

### Bölüm A — Bulgular
Her bulgu için tek satır tablo/kart:

```
[Kategori] | Dosya:satır | Tetikleyen senaryo | Etki | Önem (Kritik/Yüksek/Orta/Düşük) | Düzeltme
```

- **Tetikleyen senaryo:** "İki tablet aynı kartı 1 sn arayla okutursa", "Mobil istemci timeout sonrası retry atarsa" gibi somut olmalı.
- **Etki:** veri kaybı / çift kayıt / hayalet kayıt / yanlış stok-metraj / tutarsız sevk-sipariş rakamı.
- **Düzeltme:** kod diff'i veya migration SQL'i.

Önem sıralaması: **stok/metraj, sevkiyat-sipariş rakamları, kalite kararları ve yetki** etkileyenler Kritik. (Para/ödeme akışı bu sistemde yok.)

### Bölüm B — Idempotency Haritası
Yazma yapan tüm endpoint / handler / job'ları listele (Bölüm 5'teki envanterden başla):

| Yol | Idempotent mi? | Neden değil | Önerilen anahtar | Saklama süresi |
|---|---|---|---|---|

### Bölüm C — Şema Eksikleri ve Migration
Eksik unique/FK/NOT NULL/CHECK constraint'leri listele ve **çalıştırılabilir migration SQL** ver.
Sıra: **tespit → temizlik → constraint.** Tespit sorgusu salt-okunur SELECT; temizlik adımı **dry-run'lı script** olarak öner (toplu DELETE değil — Bölüm 2'deki üretim kuralları). Migration'ın canlı tabloda kilit süresi/etkisini not et (büyük tabloda `CREATE INDEX CONCURRENTLY` vb.).

### Bölüm D — Transaction Sınırları
Atomik olması gereken ama olmayan işlem blokları. Her biri için doğru sınırın nerede başlayıp bitmesi gerektiğini göster. Kilit-altı taze guard eksikse ayrıca belirt.

### Bölüm E — Doğrulama Sorguları
`scripts/consistency-check.sql`'de **zaten olanları tekrarlama**; eksik kalanları o dosyaya eklenecek biçimde, kopyala-çalıştır SQL olarak ver:
1. Duplicate tespiti (`GROUP BY ... HAVING COUNT(*) > 1`)
2. Orphan tespiti (`LEFT JOIN ... WHERE parent.id IS NULL`)
3. Soft-delete sızıntısı
4. Sayaç/toplam uyuşmazlığı (denormalize alan vs. gerçek `COUNT/SUM`)
5. Durum makinesi ihlalleri — TeksERP'ye özgü imkânsız durum örnekleri (en azından bunları kontrol et, benzerlerini türet):
   - `WAREHOUSE`/`A1_STOCK` statüsünde `barcode IS NULL` top (finalize/dispozisyon barkod atamalı)
   - `SHIPPED` top ama çuvalı yok veya çuvalın shipment'ı `DISPATCHED` değil
   - `IN_PRODUCTION` top ama `currentStepId IS NULL`, ya da bağlı WO `CANCELLED`/`SUPERSEDED` ("canlı ama okutulamayan" çıkmaz)
   - Kapanmamış (açık) movement + top artık o istasyonda değil / ölü statüde (hayalet movement)
   - Kapanmış movement'ta `qtyOut ≠ qtyIn` (2026-07-30 kuralı — eski kayıtlarda tarih eşiğiyle değerlendir)
   - `currentQty > initialQty` olan top (kesimle yalnız azalır)
   - `SUBCONTRACTOR_CONSUMED` orijinal top ama makbuzdan doğan `parentReceiptId`'li çocuk roll yok (yarım fason kabul)
   - `AT_SUBCONTRACTOR` top ama açık fason sevk kaydı yok
   - `TravelerCard`'sız aktif WO (kart iş emriyle doğar; 1 WO = 1 kart)
   - `RollError` açık (`isProcessed=false`) ama top ölü/emekli statüde
   - `SackAllocation` var ama shipment `DISPATCHED` değil (PLANNED tahsis `shippedQty`'ye sayılmaz kuralının ihlali)

### Bölüm F — Regresyon Testleri
Her Kritik/Yüksek bulgu için, mevcut `scripts/test_*.ts` desenine uygun (`npx tsx` ile koşan, ortam verisine bağımlı olmayan, kendi fixture'ını kuran) test senaryosu:
- Aynı isteği eşzamanlı 2+ kez gönder (`Promise.all` ile aynı claim'e yarıştır)
- Aynı `clientToken` ile isteği tekrarla → tek kayıt bekle
- İstek ortasında bağlantı kes / timeout simüle et
- Migration'ı yarıda kes, tekrar çalıştır (dev kopyada)

### Bölüm G — Öncelikli Aksiyon Planı
En fazla 10 madde, etki/efor sırasına göre. `consistency-check.sql`'e eklenecek yeni bölümler ve ARCHITECTURE.md §10.2 mutabakat takvimine girecek yeni kontroller ayrıca işaretlensin.

---

## 7. Denetim Checklist'i

Aşağıdaki her soruyu kod üzerinde tek tek yanıtla. Yanıt: **Güvenli / Riskli / Doğrulanmalı** + gerekçe + dosya referansı.

### Yazma yolları
- [ ] Her `create` endpoint'i aynı isteği iki kez alırsa ne olur? `clientToken` var mı, retry'da aynı token mı gidiyor?
- [ ] Kritik akışlarda (kart okutma, kesim, sevk, tartı) client retry + timeout çift kayıt üretir mi?
- [ ] `INSERT` yerine `upsert` / `ON CONFLICT` gereken yerler var mı?

### Şema
- [ ] Benzersizlik kuralı DB constraint'i ile mi korunuyor, yoksa sadece uygulama kodunda mı? (Tanım adları bilinçli istisna — Bölüm 3.)
- [ ] Bileşik benzersizlik gereken yerlerde index var mı?
- [ ] Tüm ilişkilerde FK tanımlı mı? `onDelete` davranışı bilinçli mi seçilmiş?
- [ ] Soft-delete kullanılan tablolarda unique kontrolü `isActive`'i doğru hesaba katıyor mu? (Pasif kayıt yeni kaydı blokluyor mu / bloklamalı mı — iki yönde de bilinçli mi?)

### Eşzamanlılık
- [ ] Her durum geçişi atomik claim deseninde mi? `findUnique→if→update` kalıntısı var mı?
- [ ] Stok/metraj/kartela düşümü atomik mi? (`SET x = x - n WHERE x >= n` mi, oku-hesapla-yaz mı?)
- [ ] "Önce kontrol et, sonra yaz" deseninde kilit altına girince koşul yeniden doğrulanıyor mu?
- [ ] `backup-scheduler` / `archive-scheduler` üst üste tetiklenirse (önceki koşum bitmeden) çakışır mı?
- [ ] Kod üretimi (`autoCode`, sackNo, workOrderNumber, batch no) yarış altında çakışırsa ne olur?

### İşlem bütünlüğü
- [ ] Birden fazla tabloya yazan akışlar (finalize, kesim, fason kabul, dispatch, dispozisyon) tek transaction içinde mi?
- [ ] Hata yolunda rollback garantili mi? `catch` bloğunda yarım iş kalıyor mu?
- [ ] Transaction içinde dış çağrı (HTTP, yazıcı, dosya) yapılıyor mu? (Yapılmamalı; audit bilinçli tx dışında.)
- [ ] Uzun tx'ler havuz bütçesini (connectionTimeoutMillis) zorluyor mu?

### Silme ve yaşam döngüsü
- [ ] Soft-delete / iptal edilen kayıtlar sorgu, rapor, sayaç ve dışa aktarımlarda doğru filtreleniyor mu? (`K18_DEAD_STATUSES` dışında elle statü listesi var mı?)
- [ ] Guard'lı `permanent` silme uçlarının bağımlılık kontrolü eksiksiz mi — yeni eklenen ilişkiler guard'a eklenmiş mi?
- [ ] WO iptal/supersede edildiğinde bağlı top, kart, movement, adım tutarlı kapanıyor mu?

### Veri taşıma ve toplu işlem
- [ ] Veri düzelten scriptler dry-run varsayılanlı ve idempotent mi?
- [ ] Toplu işlemler batch'lere bölünüyor mu, kısmi başarı yönetiliyor mu?
- [ ] Denormalize sayaçlar (`shippedQty`, WO adım durumları, `currentQty`) recompute helper'larıyla mı yazılıyor, elle mi?

### Gözlemlenebilirlik
- [ ] Duplicate/orphan oluştuğunda fark edilir mi? `/health` sayaçları neyi kapsıyor?
- [ ] `consistency-check.sql` kapsama eklenen yeni tablolar/akışlar için güncel mi? Koşum takvimi (§10.2) işliyor mu?

---

## 8. Kurallar

1. **Varsayım yapma.** Emin olmadığın yeri `DOĞRULANMALI` etiketiyle işaretle ve hangi bilgiye ihtiyacın olduğunu yaz.
2. **Kanıt göster.** Her bulguda dosya yolu ve satır numarası ver.
3. **Teorik risk ile gerçek risk'i ayır.** Bu kod tabanında fiilen tetiklenebilecek senaryoları öne al; tek-instance backend'de instance-yarışı senaryolarını öne alma.
4. **Bilinçli kararları (Bölüm 3) bulgu yapma** — yalnız uygulamadaki tutarsızlığı raporla.
5. **Kod yazmadan önce raporu bitir.** Düzeltmeleri ancak onay verildikten sonra uygula.
6. **Yıkıcı işlem önerirken** (silme, constraint, migration) önce yedek + dry-run adımını belirt; üretim canlı — Bölüm 2'deki kurallar geçerli.
7. Çıktı dili: Türkçe. Teknik terimler İngilizce kalabilir.
