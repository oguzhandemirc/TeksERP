# TeksERP Backend — Derin İnceleme #2 (Kod İnceleme & Düzeltme Takip Dosyası)

> **Bu dosya hem inceleme raporu hem de canlı düzeltme takip listesidir** (BACKEND-CODE-REVIEW.md'nin devamı).
> Her bulgunun başında **Durum** satırı var. Düzeltilen bulgu `✅ Düzeltildi` olarak işaretlenir.

**Tarih:** 2026-06-12 · **Kapsam:** `Teks-Erp/` tamamı (Express 5 + Prisma 7 + PostgreSQL, ~45k satır TS)
**Yöntem:** 14 kapsam alanında paralel uzman incelemesi → her critical/high bulguya 2 mercek (kod doğruluğu + bağlam etkisi), medium bulguya 1 mercek adversarial çürütme denemesi → kapsam kritiği. Toplam ~180 ajan koşusu, ~9.5M token. **Her doğrulanmış bulgu, iddia edilen satırdaki gerçek kod okunarak (bazıları canlı dev DB'de empirik testle) teyit edildi.** İlk incelemenin (BACKEND-CODE-REVIEW.md) 20 bulgusu ve bilinçli kabuller hariç tutuldu.

**Sayılar:** 95 ham bulgu → 61 doğrulamaya girdi → **2 çürütüldü, 59 onaylandı**; 34 düşük-öncelik (doğrulamasız, bilgi amaçlı). Çapraz-kapsam tekrarları birleştirilince ~50 benzersiz onaylı sorun.

**Severity dili:** İlk satırdaki derece = kod-doğruluğu merceği; parantez içi = bağlam merceğinin (LAN, 10 kullanıcı, veri büyümesi) ayarladığı operasyonel öncelik.

## Durum Lejantı
- ⬜ **Bekliyor** · 🔧 **Devam ediyor** · ✅ **Düzeltildi** · ⏭️ **Bilinçli kabul / Atlandı**

---

## İLERLEME PANOSU — YÜKSEK öncelik

| # | Başlık | Kategori | Severity | Durum |
|---|---|---|---|---|
| H-1 | Tambur `finalize()` top durumu/adımı hiç doğrulamıyor | Validation | 🔴 Yüksek (Yüksek) | ✅ |
| H-2 | Fason kabulde atomik claim yok — çift kabul + çift born roll | Race | 🔴 Yüksek (Yüksek) | ✅ |
| H-3 | UUID migration'ı 9 partial index'i sessizce FULL'e çevirdi | Perf/Şema | 🔴 Yüksek (Yüksek) | ✅ |
| H-4 | `detachRolls` üyelik/statü guard'sız — her top STOCK'a sıfırlanabilir | Veri bütünlüğü | 🔴 Yüksek (Orta†) | ✅ |
| H-5 | PATCH `update()` + `updateTargetProperties` fiziksel kilitleri atlıyor | Validation | 🔴 Yüksek (Orta) | ✅ |
| H-6 | `replace()` başlamış adımın istasyonunu/sırasını değiştirebiliyor | Veri bütünlüğü | 🔴 Yüksek (Orta) | ✅ |
| H-7 | `finalizeWarehouseCut`/`finalizeOpenFabric` claim'siz + bayat metraj | Race | 🔴 Yüksek (Orta) | ✅ |
| H-8 | Sevk finalize iptal/kapalı siparişe tahsis + shippedQty yazıyor | Logic | 🔴 Yüksek (Orta) | ✅ |
| H-9 | Kartela receive/cancel koşulsuz statü flip — çift makbuz/kartela | Race | 🔴 Yüksek (Orta) | ✅ |
| H-10 | Refakat kartı reprint snapshot'sız — donmuş belge garantisi bozuk | Veri bütünlüğü | 🔴 Yüksek (Orta) | ✅ |
| H-11 | Sipariş `DELETE /:id/permanent` tüm guard'ları atlayıp fiziksel siliyor | Veri bütünlüğü | 🔴 Yüksek (Orta) | ✅ |
| H-12 | Genel `step-action` FINISH'i PROCESS_QC/TAMBUR özel akışlarını baypas ediyor | Validation | 🔴 Yüksek (Orta) | ✅ |
| H-13 | SystemLog arşivi `category`/`ipAddress` kopyalamıyor — kalıcı kayıp | Veri bütünlüğü | 🔴 Yüksek (Orta) | ✅ |
| H-14 | Dashboard/rapor tarih sorgularının kolonları indekssiz (4 örnek) | Performans | 🔴 Yüksek (Orta) | ✅ |

† H-4: endpoint'in bugün hiçbir UI çağıranı yok (monorepo tarandı) — tetiklenme olasılığı düşük, hasar yüksek.

## İLERLEME PANOSU — ORTA öncelik (hepsi doğrulandı)

| # | Başlık | Durum |
|---|---|---|
| M-1 | splitBranch çift-istek yarışı: sevk bir WO'ya, toplar başka WO'ya | ✅ |
| M-2 | Sevkiyat içerik snapshot'ı tx dışı — hayalet SHIPPED top / kurtarılamaz rezerv | ✅ |
| M-3 | Order create/update mass-assignment (status/shippedQty/orderId istemciden) | ✅ |
| M-4 | BaseService generic CRUD nested-write bypass (`{"rolls":{"deleteMany"}}`) | ✅ |
| M-5 | Cursor sayfalama: nullable sort kolonu listeyi sessizce kırpıyor (Rolls "En" sıralaması) | ✅ |
| M-6 | Cursor değer tip tahmini: rakamsal kod/boolean sort 2. sayfada 400 | ✅ |
| M-7 | KK2 finishStep raw UPDATE kapsamı doğrulanan setten geniş (BL-3 yan etkisi) | ✅ |
| M-8 | handleStepSkip / kursunFinish / handleStepStart claim'siz (BL-3 kardeşleri) | ✅ |
| M-9 | reopenStep guard'ları tx dışında — Tambur finalize ile yarışta tutarsız geri çekme | ✅ |
| M-10 | batchNumber retry kapsamı dışında + manifestNo hiç retry'sız | ✅ |
| M-11 | cancel-impact önizlemesi 200'de kesiliyor + gerçek iptal kümesiyle uyumsuz | ✅ |
| M-12 | WO iptal/arşiv açık movement'ları kapatmıyor; adımlar ölü ACTIVE kalıyor | ✅ |
| M-13 | Redye rewind açık RollError'ları ele almıyor — kalıcı "açık hata" şişmesi | ✅ |
| M-14 | Tambur finalize totalQty'yi tx dışında okuyor | ✅ |
| M-15 | Tambur kesim uzunluklarında üst sınır yok (SEC-5 tambur'a uygulanmamış) | ✅ |
| M-16 | qualityGrade katalog+isActive doğrulamasız (tambur 3 yol + KK1 girişi) | ✅ |
| M-17 | Sack.seq `_count` tabanlı — silme sonrası çift "Çuval N" (donmuş irsaliyeye yansır) | ✅ |
| M-18 | Fason ek parti iptali adımı süresiz ACTIVE bırakıyor — WO tamamlanamıyor | ✅ |
| M-19 | Fason receive: appliedColor/Property guard'sız + dupe property retry'ı kandırıyor | ✅ |
| M-20 | Fason receive: stepId↔workOrderId çapraz kontrolü yok | ✅ |
| M-21 | İade iptali "en son iade mi" bakmıyor — top bayat sevkiyata geri yazılır | ✅ |
| M-22 | Order update: müşteri değişiminde pasif müşteri + renk exclusivity bypass | ✅ |
| M-23 | Soft-delete giriş guard'ı boşlukları: satır rengi isActive, item.update allowed listeleri, renk-atama müşteri isActive | ✅ |
| M-24 | Item.allowedColors kuralı sipariş satırında enforce edilmiyor | ✅ |
| M-25 | orderNumber üretimi: her create'te seq scan + retry'sız P2002 | ✅ |
| M-26 | Müşteri/şube pasifleştirme açık sipariş kontrolü yapmıyor | ✅ |
| M-27 | PROCESS_QC son adımsa finishStep topları IN_PRODUCTION limbosunda bırakıyor | ✅ |
| M-28 | Legacy `production.reportError` sertleştirilmemiş + kursunFinish DefectType isActive eksik | ✅ |
| M-29 | processingStatus=processed filtresi CANCELLED/SHIPPED sızdırıyor + filtre ezme | ✅ |
| M-30 | Roll softDelete guard'ları tx dışı, final update koşulsuz (sevk/çuval yarışı) | ✅ |
| M-31 | Traveler reprint: activeCard/lastVersion retry dışında — çift ACTIVE kart | ✅ |
| M-32 | PATCH /admin/users/:id kendi hesabını pasife alma guard'ını atlıyor | ✅ |
| M-33 | Stok dağılımı raporu toplamları LIMIT 100'lük listeden | ✅ |

---

# YÜKSEK ÖNCELİKLİ BULGULAR (detay)

### H-1 🔴 — Tambur `finalize()` top durumu/adımı hiç doğrulamıyor
**Durum:** ✅ Düzeltildi (2026-06-12) · **Konum:** `src/services/tambur.service.ts:446-509, 626` · **Doğrulama:** 2/2 REAL (high/high)

Ana finalize akışında topun IN_PRODUCTION olduğu, Tambur adımında beklediği ya da sevkiyata rezerve olmadığı hiçbir yerde kontrol edilmiyor; atomik claim yalnız "TAMBUR_CONSUMED değil" diyor. Kardeş yollar (cutOpenFabric :1892, cutWarehouseRoll :1503+1510) bu guard'ları taşıyor. KK2 reopen ile geri çekilmiş top bayat tabletten finalize edilirse KK2'deyken tüketilir; çuvala rezerve (shipmentId dolu) WAREHOUSE, SHIPPED, hatta CANCELLED/SCRAP top finalize edilip child'lara bölünebilir — step yazımları `if (oldStepId)` sarılı olduğundan hata da fırlamaz. Ek: `finalizeWarehouseCut` shipmentId kontrolü yapmıyor (cutWarehouseRoll'da var).
**Çözüm:** finalize başına cutOpenFabric'teki guard'ları uygula (status=IN_PRODUCTION, station.kind=TAMBUR, shipmentId null); claim'i `status='IN_PRODUCTION'` olarak daralt. finalizeWarehouseCut'a shipmentId reddi ekle.

### H-2 🔴 — Fason kabulde atomik claim yok: çift kabul makbuzu + born roll'lar ikiye katlanır
**Durum:** ✅ Düzeltildi (2026-06-12) · **Konum:** `src/services/subcontractor.service.ts:927, 1039-1067, 1134` · **Doğrulama:** 2/2 REAL (high/high)

receive()'in tüm guard'ları (idempotency :927, outstanding :1039) tx DIŞINDA; tx içindeki `roll.updateMany` status şartsız ve count'suz — dispatch'e BL-1 ile eklenen claim'in ikizi eksik. Kritik etkileşim: **withBarcodeRetry yarışı tamamlıyor** — receiptNo P2002 çakışmasında SADECE tx tekrar denenir, tx-dışı idempotency tekrar koşmaz; kaybeden ikinci denemede sorunsuz commit eder → iki SubcontractorReceipt + İKİ SET born roll (hayalet stok Kurşun/KK2'ye akar), iki çağrı da "başarılı" döner. Aynı tx-dışı check-then-act deseni `cancel()` (:788) ve `cancelReceipt()`'te (:2341-2348) de var.
**Çözüm:** tx içinde movement-kapatma UPDATE'inden önce claim: `updateMany WHERE {id in returnRollIds, status: AT_SUBCONTRACTOR, currentStepId: data.stepId}`, count uyuşmazsa `AppError.conflict`. cancel/cancelReceipt'e de beklenen-statü + count.

### H-3 🔴 — UUID migration'ı 9 partial index'i sessizce FULL'e çevirdi
**Durum:** ✅ Düzeltildi (2026-06-12) · **Konum:** `prisma/migrations/20260611084953_native_uuid_pk_fk/migration.sql:1609-1813` · **Doğrulama:** 4/4 REAL (iki bağımsız kapsam; canlı DB pg_indexes ile teyit)

DB-1 migration'ı FK kolonlarını DROP+ADD COLUMN ile yeniden yarattığı için elle yazılmış partial index'ler kolonla birlikte düştü ve Prisma WHERE'siz FULL yeniden yarattı: `rolls_parentReceiptId/sackId/shipmentId`, `sacks_shipmentId`, `swatches_parentReceiptId/shipmentId/sackId`, `work_orders_splitFromId` ve **en kritiği work_order_steps açık-kart kuyruğu** (`WHERE status <> 'COMPLETED'`). 20260606001717/20260607010000/20260609120000/20260609221328 kazanımları (ölçülmüş %20 insert + 15sn'de bir poll edilen açık-kart sorgusunun O(açık) garantisi) sessizce geri alındı; şemadaki "DB'de partial'dır" yorumları artık yanlış. (batchSplitId / markedForKartela / swatches_createdAt sağ kaldı.)
**Çözüm:** `repartialize` migration'ı: başına `SET statement_timeout = 0`, 9 index için DROP + WHERE'li CREATE (önceki migration DDL'leri birebir). **KURAL:** Bu kolonlara dokunan her gelecekteki Prisma migration partial'ları sıfırlar — migration üretildikten sonra repartialize bloğu elle eklenmeli.

### H-4 🔴 — `detachRolls` üyelik/statü guard'sız: herhangi bir top STOCK'a sıfırlanabilir
**Durum:** ✅ Düzeltildi (2026-06-12) · **Konum:** `src/services/workorder.service.ts:3446-3461` · **Doğrulama:** 4/4 REAL (iki kapsam; bağlam: bugün UI çağıranı YOK → pratik öncelik orta)

findMany sadece id ile çekiyor, updateMany koşulsuz `status=STOCK + producedInStepId/currentStepId=null` yazıyor. Başka WO'nun topu, WAREHOUSE/SHIPPED/CANCELLED top STOCK'a "dirilebilir"; yabancı topun kendi WO'sundaki açık movement açık kalır (kapatma :3476 bu WO'nun stepIds'ine sınırlı) → o adım sonsuza dek ACTIVE. Audit `oldData` hardcode "IN_PRODUCTION" (:3490) yanlış iz bırakır. attachRolls'taki atomik claim deseni (:2399-2409) ile bariz asimetri. Meşru kullanımda da `batchSplitId` temizlenmiyor ve detach sonrası recomputeStepStatus çağrılmıyor.
**Çözüm:** updateMany WHERE'ine üyelik+statü guard'ı (attachRolls simetriği), geçemeyenleri errors[] ile raporla; `batchSplitId: null` ekle; tx sonunda recomputeStepStatus. (AT_SUBCONTRACTOR detach'i :3425 yorumuna göre bilinçli — onu koru.)

### H-5 🔴 — PATCH `update()` + `updateTargetProperties` fiziksel taahhüt kilitlerini atlıyor
**Durum:** ✅ Düzeltildi (2026-06-12) · **Konum:** `src/services/workorder.service.ts:2512-2606, 3172-3239` · **Doğrulama:** 4/4 REAL

`computeWorkOrderLocks` yalnız findById + replace()'te. PATCH /:id yalnız COMPLETED/CANCELLED kontrolüyle width/targetItemId/targetColorId/foldType yazıyor — **yol canlı:** mobil `WorkOrderDetailSheet.tsx:74` IN_PROGRESS WO'da tam bu PATCH'i kullanıyor (quick WO'lar doğuşta materialCommitted). Git geçmişi drift'i kanıtlıyor: update gevşemesi (998e953, 05-15) locks helper'dan (b62da02, 05-27) önce — retrofit unutulmuş. Daha net çelişki: `updateTargetProperties` lockedPropertyIds'e bakmadan COMPLETED adımda uygulanmış özelliği hem WO'dan hem topların RollProperty'sinden siliyor; replace() aynı işlemi 409 ile reddediyor.
**Çözüm:** update() ve updateTargetProperties() başına computeWorkOrderLocks + replace()'teki diff-bazlı guard'lar (ortak helper). Blanket kilit DEĞİL diff-bazlı olmalı — yoksa mobil düzenleme tümden ölür.

### H-6 🔴 — `replace()` smart-merge başlamış adımın stationId/sırasını guard'sız değiştiriyor
**Durum:** ✅ Düzeltildi (2026-06-12) · **Konum:** `src/services/workorder.service.ts:3051-3061` · **Doğrulama:** 2/2 REAL

Adım SİLME doğru guard'lı (yalnız PENDING + bağsız), ama id eşleşen adımın GÜNCELLENMESİ statüden bağımsız: ACTIVE/COMPLETED adımın stationId ve stepSequence'i koşulsuz yazılıyor. Bayat PUT açık movement'lı adımın istasyonunu değiştirirse kart okutma (assertWoAtStepKind station.kind ile bulur) yanlış kuyruğa düşer, geçmiş movement'lar başka istasyona atfedilir. Controller'daki "Sadece PLANNED" yorumu hiçbir yerde enforce edilmiyor; şemada (workOrderId, stepSequence) unique de yok.
**Çözüm:** status !== PENDING ise stationId değişimini reddet (notes/requiredCategory/plannedSubcontractor serbest); başlamış adımların sırası değişiyorsa conflict.

### H-7 🔴 — `finalizeWarehouseCut` / `finalizeOpenFabric` atomik claim'siz + bayat metraj
**Durum:** ✅ Düzeltildi (2026-06-12) · **Konum:** `src/services/tambur.service.ts:1714, 1804, 2148, 2213` · **Doğrulama:** 4/4 REAL (iki kapsam)

finalize()'ın kendi yorumu (:470-479, :621-625) ön-kontrolün yetmediğini söyleyip claim uygularken, iki kardeş tüketim yolu koşulsuz `roll.update` kullanıyor ve kalan metrajı tx DIŞINDA okuyor. (a) Eşzamanlı çift çağrı → iki kalan-child, depoya mükerrer metraj (uuid barkodlar çakışmaz, P2002 dedup yok); (b) okuma-tx arasına giren cut commit'i → child kesim-öncesi metrajla doğar (kesilen metre iki kez sayılır). Ardışık çift-tık zaten yakalanıyor; risk ms'lik gerçek eşzamanlı pencere.
**Çözüm:** finalize()'daki claim desenini kopyala (`updateMany WHERE {id, status: beklenen}` → count===0 → idempotent/409); remainingQty'yi claim SONRASI tx içinde taze oku.

### H-8 🔴 — Sevk finalize sipariş durumunu yeniden doğrulamıyor: iptal siparişe tahsis + shippedQty
**Durum:** ✅ Düzeltildi (2026-06-12) · **Konum:** `src/services/shipping.service.ts:1452-1486, 1539-1551, 1582-1586` + `order.service.ts:1364-1385` · **Doğrulama:** 2/2 REAL

Sipariş eklerken CANCELLED/COMPLETED reddediliyor ama markReady/dispatch anında YENİDEN doğrulanmıyor (loadShipmentForFinalize order.status'u seçmiyor bile). Karşı yönde sipariş iptali/manuel kapatma aktif sevkiyat bağını (ShipmentOrder + PREPARING/READY/AT_DOOR) hiç kontrol etmiyor. Yarış gerektirmeyen senaryo: paketleme PREPARING'deyken sipariş iptal edilir; ertesi gün dispatch FIFO iptal siparişin satırlarını ÖNCE doldurur → shippedQty iptal siparişe yazılır, recomputeOrderStatus CANCELLED'ı terminal sayıp denormu güncellemez, MRP'de mal kaybolur, canlı siparişler açık kalır.
**Çözüm:** İki taraflı: (1) computeShipmentAllocation/commitGoodsTx'te CANCELLED+manuel-COMPLETED satırları tahsis dışı bırak veya finalize'da 409; (2) sipariş cancel/manuel kapatma preview+uygulamasına aktif sevkiyat guard'ı.

### H-9 🔴 — Kartela receive/cancelDispatch/cancelReceipt koşulsuz statü flip
**Durum:** ✅ Düzeltildi (2026-06-12) · **Konum:** `src/services/kartela.service.ts:521-538, 603-606, 402-405, 730-733` · **Doğrulama:** 2/2 REAL

dispatch()'teki atomik claim (referans kalitesinde, :297-309) üç kardeş geçişe uygulanmamış: receive ön-kontrolü tx dışında, tüketim flip'i koşulsuz/count'suz. İki eşzamanlı kabul → iki KartelaReceipt + aynı toplardan iki kat Swatch (@@unique yalnız makbuz-içi). withBarcodeRetry burada da yarışı BAŞARILI çift kayda çevirir (ön-kontroller retry kapsamında değil).
**Çözüm:** Claim desenini üç geçişe kopyala (receive: WHERE status=AT_KARTELA; cancelDispatch: AT_KARTELA; cancelReceipt: KARTELA_CONSUMED) + count → 409.

### H-10 🔴 — Refakat kartı reprint'i snapshot'sız kart üretiyor
**Durum:** ✅ Düzeltildi (2026-06-12) · **Konum:** `src/services/traveler-card.service.ts:226-235` · **Doğrulama:** 2/2 REAL

reprint() yeni ACTIVE kartı inline create ederken `snapshot` alanını HİÇ yazmıyor (createForWorkOrder :117 ve createCardInternal :705 yazıyor; :218-220 yorumu tx workaround'unda unutulduğunu gösteriyor). Schema doc'u (:1226) "reprint orijinali birebir üretir" diyor. Electron `activeCard.snapshot ?? wo` fallback'iyle CANLI WO verisi + istemci default config basar — kayıp kart kurtarmasının tek resmi yolu donmuş-belge garantisini sessizce bozar. (Bugün UI'dan çağrılmıyor; print() hata mesajı bu endpoint'e yönlendiriyor.)
**Çözüm:** reprint tx'inde `activeCard.snapshot`'ı kopyala (birebir reprint) — tasarım dokümanına uygun olan bu.

### H-11 🔴 — Sipariş `DELETE /:id/permanent` tüm iptal guard'larını atlayıp fiziksel siliyor
**Durum:** ✅ Düzeltildi (2026-06-12) · **Konum:** `src/routes/order.routes.ts:529` → `base.service.ts:520` · **Doğrulama:** 2/2 REAL

BaseService.hardDelete = guard'sız `prisma.delete`. Order→OrderLine→WorkOrderToOrderLine Cascade zinciriyle IN_PROGRESS WO'ya bağlı sipariş bile tek istekle kalıcı silinir: softDelete'in 409 blokajı, cancel-preview, CONVERT_TO_STOCK akışı atlanır; WO yetim kalır, MRP talebi kaybolur. "Asla fiziksel DELETE" kuralının doğrudan ihlali — WorkOrder'da hardDelete arşive çevrilmişken Order atlanmış. (UI çağıranı yok; order:write ile API'den erişilir. **Kapsam kritiği aynı sınıfın station/route/item/customer/defect-type'ta da olduğunu buldu — bkz. Kapsam Boşlukları.**)
**Çözüm:** OrderService.hardDelete override → soft iptale yönlendir veya aktif WO/sevk bağında 409 + detaylı onay.

### H-12 🔴 — Genel `step-action` FINISH'i PROCESS_QC/TAMBUR özel akışlarını baypas ediyor
**Durum:** ✅ Düzeltildi (2026-06-12) · **Konum:** `src/services/production.service.ts:97` · **Doğrulama:** 2/2 REAL

executeStepAction yalnız `station.type === EXTERNAL`'ı engelliyor; kind kontrolü yok. PROCESS_QC adımındaki topa FINISH → QC2_COMPLETED yazılmadan, KURSUN aktarımı yapılmadan Tambur'a; TAMBUR adımındaki topa FINISH/SKIP → final karar/depo yönlendirmesi atlanıp doğrudan PRODUCED (WO COMPLETED'a düşebilir) ve undoStepFinish TAMBUR'u reddettiği için geri alınamaz. (UI çağıranı yok — ham API.)
**Çözüm:** kind tabanlı guard: PROCESS_QC'de FINISH'i, TAMBUR'da FINISH/SKIP'i Türkçe mesajla reddet (EXTERNAL deseniyle aynı).

### H-13 🔴 — SystemLog arşivlemesi `category` ve `ipAddress` kopyalamıyor
**Durum:** ✅ Düzeltildi (2026-06-12) · **Konum:** `src/services/audit.service.ts:146-159` · **Doğrulama:** 2/2 REAL (dev DB'de empirik test edildi)

archiveOlderThan'ın createMany map'inde category/ipAddress yok; arşiv default'u DOMAIN, kaynak satır aynı tx'te fiziksel siliniyor. Test: category=AUTH, ip=10.0.0.5 kayıt arşive category=DOMAIN, ip=null düştü. 6+ ay önceki AUTH/SYSTEM olayları (login + kaynak IP) bozulur, listArchive category filtresi yanlış sonuç verir. (Kısmi telafi: tableName=category olarak saklanıyor → category backfill'le kurtarılabilir; ipAddress kurtarılamaz.)
**Çözüm:** map'e `category: log.category, ipAddress: log.ipAddress` ekle (2 satır) — **üretime geçmeden kritik**.

### H-14 🔴 — Dashboard/rapor tarih-aralığı sorgularının kolonları indekssiz
**Durum:** ✅ Düzeltildi (2026-06-12) · **Konum:** `src/services/dashboard.service.ts:84,91` + `reports/*` + `schema.prisma:1139-1184, 1298-1303` · **Doğrulama:** 2/2 REAL

Aynı desenin 4 örneği: (1) getStationsLiveState `rm."exitedAt"` üzerinden roll_movements'ı iki kez full tarayıp GROUP BY'lıyor (yalnız enteredAt indeksli); (2) getDefectsSummary `detectedAt >= today` — roll_errors'da detectedAt indeksi yok; (3) quality raporları detectedAt/processedAt aralığı; (4) production raporu roll_operations'ı createdAt aralığıyla tarıyor (createdAt-başta indeks yok). statement_timeout=30s aktif olduğundan veri büyüyünce sorgular yavaşlamakla kalmaz, İPTAL edilip dashboard/rapor kırılır.
**Çözüm:** Vardiya dışı migration (SET statement_timeout=0): roll_movements'a `(workOrderStepId) WHERE exitedAt IS NULL` partial + `(exitedAt)`; roll_errors'a `(detectedAt)`, `(processedAt)`; roll_operations'a `(createdAt)`.

---

# ORTA ÖNCELİKLİ BULGULAR (detay — hepsi adversarial doğrulamadan geçti)

### M-1 — splitBranch çift-istek yarışı (`workorder.service.ts:1936`)
Tx içi yeniden doğrulama yalnız top STATÜLERİNE bakıyor; dispatch.update guard'sız (where sadece id). continue modunda toplar statü değiştirmediği için ikinci istek ilk commit'ten sonra bile geçer → sevk ikinci WO'ya, toplar ilkine. Hafifletici: batchNumber @unique çoğu çift-tıklamayı tesadüfen bloklar. **Çözüm:** tx başında atomik claim: `subcontractorDispatch.updateMany({where:{id, workOrderId, cancelledAt:null}, data:{workOrderId:newWo.id,...}})`, count===0→409; redye'de final roll.updateMany'ye batchSplitId+statü filtresi.

### M-2 — Sevkiyat içerik snapshot'ı tx dışı (`shipping.service.ts:1784, 1805, 1830`)
alloc/rollIds claim'den ÖNCE hesaplanıyor; içerik endpoint'leri (scan/removeRoll/...) shipment satırına dokunmadığından claim'le serileşmiyor. (a) dispatch ile eşzamanlı removeRoll → top shippedQty'ye sayılır ama shipmentId null'ken SHIPPED'a çevrilir (hayalet top); (b) dispatch/cancel ile eşzamanlı scan → DISPATCHED sevkiyata bağlı kurtarılamaz WAREHOUSE rezervi. Bilinen "5 kardeş geçiş" kabulü geçiş-vs-geçiş'i kapsıyor; bu içerik-vs-geçiş farklı sınıf. **Çözüm:** içerik-mutasyon tx'lerine koşullu shipment touch (`updateMany WHERE status=PREPARING`, count===0→409); finalize'da içeriği claim SONRASI tx içinde yükle; cancel roll temizliğini `where:{shipmentId}` yap.

### M-3 — Order create/update mass-assignment (`order.service.ts:891, 988-999, 1042`)
Route'ta Zod yok (BaseController ham body); cleanData yalnız `lines`'ı siliyor. PATCH `{"status":"COMPLETED"/"CANCELLED"}` kaskadsız kalıcı; satır diff'inde `shippedQty`/`orderId` geçiyor (forged shippedQty'yi recompute düzeltmez, header'a TERFİ ettirir). PARTIAL_SHIPPED whitelist'i (:902) desenin bilindiğini kanıtlıyor. **Çözüm:** header whitelist + satır objelerinden shippedQty/orderId/createdAt silme; en temizi route seviyesinde Zod.

### M-4 — BaseService generic CRUD nested-write bypass (`base.service.ts:464`)
req.body kolon süzgeçsiz Prisma'ya gidiyor; canlı testte `PATCH /api/items/:id {"rolls":{"deleteMany":{...}}}` KABUL edildi. 13 route bare BaseController; override'lar da (`{...data}`) bilinmeyen anahtarları geçiriyor. Hafifletici: movement/operation'lı toplar FK Restrict ile silinemez; yalnız çocuksuz kayıtlar + alan ezme. **Çözüm:** create/update'e dmmf tabanlı scalar/enum whitelist (safeFilters altyapısı hazır) — tek noktadan tüm master-data korunur.

### M-5 — Cursor sayfalama nullable sort kırpması (`utils/cursor.ts:150` + `inventory.service.ts:656`)
Empirik doğrulandı: Prisma 7 + pg düz `desc` NULLS FIRST üretir; sayfa sınırı NULL grubuna düşünce cursor null dalına kilitlenir, hasMore=false ile dolu kayıtlar HİÇ gelmez (testte 45 kayıttan 3'ü servis edildi). Electron Rolls "En"/"Barkod" SortableHeader'ları tek tıkla tetikler (rawWidthEnabled kapalıyken stokun çoğu width=null). **Çözüm:** kısa vade width/barcode'u sortable'dan çıkar veya nullable sort'ta offset-cursor'a düş; kalıcı: `{sort, nulls:'last'}` + üç-dallı null-aware keyset.

### M-6 — coerceCursorValue tip kırılması (`utils/cursor.ts:126, 179`)
Rakamsal string kod ('10245') cursor'da number'a çevrilir → Prisma string kolona number reddeder → 2. sayfa 400 (empirik teyit); boolean sort ('true' string kalır) aynı. **Çözüm:** cursor token'ına tip yaz veya dmmf'ten kolon tipine göre dönüştür.

### M-7 — KK2 finishStep raw UPDATE kapsamı geniş (`kursun-qc.service.ts:635`) — *BL-3 yan etkisi*
QC2 doğrulaması tx dışı eski sete yapılırken UPDATE adımdaki TÜM açık movement'ları kapatıyor; doğrulama-tx arasında giren top (fason kabul/KK1 finish) QC2'siz Tambur'a süpürülür. Eski kod `id = ANY(movementIds)` ile dardı. **Çözüm:** UPDATE'e `AND "rollId" = ANY(${rollIds}::uuid[])` ekle (atomik guard korunur).

### M-8 — BL-3 kardeşleri claim'siz (`production.service.ts:605, 303` + `inventory.service.ts:1908-1978`)
handleStepSkip kapatma count'una bakmadan openMovementForNextStep çağırıyor (çift SKIP → sonraki adımda mükerrer açık movement); kursunFinish aynı (çift çağrı → Tambur'da çift movement + mükerrer RollError); handleStepStart check-then-create. **Çözüm:** count===0 → ilerletmeyi atla (handleStepFinish deseni); handleStepStart'a claim veya partial unique `(rollId, workOrderStepId) WHERE exitedAt IS NULL`.

### M-9 — reopenStep guard'ları tx dışında (`kursun-qc.service.ts:745-780`)
Tambur finalize ile yarışta TAMBUR_CONSUMED top PROCESS_QC'ye geri çekilir (çelişik durum). **Çözüm:** tx içi koşullu updateMany (`currentStepId=nextStep.id AND status=IN_PRODUCTION`) + count kontrolü.

### M-10 — batchNumber/manifestNo sequence yarışı (`workorder.service.ts:578, 1767, 3765`)
batchNumber withBarcodeRetry closure'unun DIŞINDA üretiliyor → P2002'de 5 retry hep aynı numarayla çakışır, yanıltıcı 409; splitBranch'te aynı; createManifest hiç retry'sız (manifestNo @unique, günlük sequence WO'lar arası paylaşımlı). **Çözüm:** üretimi closure içine taşı; createManifest'i withBarcodeRetry ile sar.

### M-11 — cancel-impact preview/gerçek uyumsuzluğu (`workorder.service.ts:2011-2103`)
take:200 ile kesilen listeden sayılar (hasMore yok) + preview TÜM topları dökerken softDelete yalnız currentStepId+IN_PRODUCTION kümesini STOCK'a çekiyor — "etkilenen her kaydı somut listele" kuralına aykırı. Blok kararı limitsiz hesaplandığından yanlış mutasyon yok. **Çözüm:** limitsiz count'lar + truncated bayrağı + per-roll `willRevertToStock`.

### M-12 — WO iptal/arşiv açık movement bırakıyor (`workorder.service.ts:2198, 2282`)
softDelete/hardDelete topları STOCK'a çekerken movement'ları kapatmıyor, adımlar ölü ACTIVE kalıyor → dashboard WIP sayacı kalıcı şişer, açık-kart partial index'i dolar, serbest top "istasyonda aktif" görünür. detachRolls da recomputeStepStatus çağırmıyor. **Çözüm:** iptal/arşiv tx'ine movement kapatma (WO_CANCELLED notu) + adımları terminal duruma çek.

### M-13 — Redye rewind açık RollError'ları yetim bırakıyor (`workorder.service.ts:1902-1932`)
Geri sarılan topların KK2'de açılmış hataları (isProcessed=false) hiç ele alınmıyor; toplar kabulde SUBCONTRACTOR_CONSUMED olunca bu hatalar bir daha hiçbir Tambur akışına giremez → açık-hata sayacı/kalite raporları her redye'de kalıcı şişer. **Çözüm:** rewind'de laneRollIds'in açık hatalarını REDYE_VOID benzeri actionTaken ile kapat.

### M-14 — finalize totalQty tx dışı (`tambur.service.ts:515`)
Bayat metrajla segment hesabı: eşzamanlı cutOpenFabric commit'i 500m'den 600m üretebilir. **Çözüm:** claim SONRASI tx içinde taze currentQty oku.

### M-15 — Tambur sayısal üst sınır yok (`tambur.controller.ts:29, 59, 81`)
SEC-5 `.max()` tambur'a uygulanmamış; overQuantity default AÇIK olduğundan doğal tavan da yok — barkod yanlış alana okunursa ~869 milyon metrelik WAREHOUSE topu yazılabilir. (reportError.startMeter zaten korumalı.) **Çözüm:** üç kesim alanına `.max(100_000)`.

### M-16 — qualityGrade katalog+isActive doğrulamasız (`tambur.service.ts:107` + `quality-grade.helper.ts:19` + `inventory.service.ts:296`)
Bilinmeyen/typo'lu kod sessizce WAREHOUSE'a iner (yorum "SCRAP fallback" diyor, kod tersini yapıyor), qualityGradeId null kalır; pasif kalite kabul edilir; FIRE-dışlama string eşleşmesine dayandığından typo'lu fire satılabilir stok olur. KK1 createInitialEntry'de de aynı. **Çözüm:** bilinmeyen kod → 400; sorgulara isActive:true.

### M-17 — Sack.seq `_count` tabanlı (`shipping.service.ts:1084`)
3 çuval aç → #2'yi sil → yeni ekle → _count=2 → yeni seq=3 mevcut #3 ile çakışır (yarış bile gerekmez); şemada [shipmentId,seq] unique yok; donmuş irsaliyede iki "Çuval 3" kalıcılaşır. **Çözüm:** tx içinde max(seq)+1 + `@@unique([shipmentId, seq])`.

### M-18 — Fason ek parti iptali adımı ACTIVE bırakıyor (`subcontractor.service.ts:820-832`)
otherActive sayacı kabul edilmiş sevkleri de sayıyor, COMPLETED'a dönüş yolu yok: D1 kabul edildi + D2 iptal → adım boş ama ACTIVE, WO sonsuza dek IN_PROGRESS (recovery yalnız yeni fiziksel sevk veya DB müdahalesi). **Çözüm:** açık sevk + kalan AT_SUBCONTRACTOR top ikisi de 0 ve geçmişte kabul varsa adımı COMPLETED'a geri çek.

### M-19 — receive appliedColor/Property guard'sız + dupe retry tuzağı (`subcontractor.service.ts:1025-1036, 1305`)
Override değerleri varlık/isActive kontrolsüz born roll'lara yazılıyor (SEC-2/3'ün fason kardeşi); appliedPropertyIds dedupe'suz + createMany skipDuplicates'siz → payload'daki tekrar P2002 üretir, withBarcodeRetry koca kabul tx'ini 5 kez boşuna dener, yanıltıcı "Barkod üretimi başarısız" 409'u. **Çözüm:** tx öncesi isActive doğrulama + Set dedupe + skipDuplicates:true.

### M-20 — receive stepId↔workOrderId çapraz kontrolü yok (`subcontractor.service.ts:1000`)
dispatch :322'de var, receive'da yok: uyuşmaz çiftte makbuz yanlış WO'ya, born roll'lar yanlış targetItem/width'e, WO-tamamlama bloğu BAŞKA iş emrini COMPLETED'a çekebilir. **Çözüm:** dispatch'teki guard'ın aynısı (veya workOrderId paramını bırakıp step.workOrderId'yi otorite say).

### M-21 — İade iptali recency kontrolsüz (`return.service.ts:558-592`)
Top sevk→iade R1→tekrar sevk→iade R2 geçmişinde R1 yanlışlıkla iptal edilirse top ESKİ sevkiyata SHIPPED yazılır, eski prevQualityGrade'i giyer. **Çözüm:** daha yeni aktif iade varsa 409.

### M-22 — Order update müşteri değişimi bypass'ı (`order.service.ts:931-957`)
customerChanging'de validateCustomer yok (pasif müşteriye taşınabilir); lines'sız değişimde mevcut satır renkleri yeni müşteriye karşı doğrulanmıyor — renk exclusivity ENFORCE garantisi deliniyor. **Çözüm:** validateCustomer + mevcut satır renklerine assertColorsAssignableToCustomer.

### M-23 — Soft-delete giriş guard'ı boşlukları (`order.service.ts:295` + `item.service.ts:203` + `color.service.ts:147`)
(1) Sipariş satırında colorId isActive kontrolsüz; (2) item.update allowedColorIds/PropertyIds replace'i doğrulamasız (create doğruluyor); (3) renk-atamada müşteri isActive kontrolsüz → pasif müşteriye exclusive atanan renk "kaybolur". **Çözüm:** üç noktaya isActive batch doğrulaması.

### M-24 — Item.allowedColors siparişte enforce edilmiyor (`order.service.ts:687`)
Şema yorumu kuralı ilan ediyor, KK1 enforce ediyor; sipariş satırı etmiyor → üretilemez renkte satır MRP talebi yaratır, hata KK1'de patlar. requiredPropertyIds/allowedProperties de aynı. **Çözüm:** validateLineItems'a (itemId,colorId) allowed-list kontrolü.

### M-25 — orderNumber: seq scan + retry'sız yarış (`order.service.ts:767-811`)
Canlı DB'de EXPLAIN teyidi: `startsWith` LIKE'ı en_US.UTF-8'de Seq Scan — her sipariş create'i tüm orders'ı tarar; eşzamanlı create P2002→kullanıcı hatası (yorum yarışı kabul ediyor, withBarcodeRetry kullanılmamış). **Çözüm:** withBarcodeRetry + `text_pattern_ops` index veya sayaç tablosu.

### M-26 — Müşteri/şube pasifleştirme açık sipariş kontrolsüz (`customer.service.ts:21` + `customer-branch.service.ts:125`)
Pasif müşterinin açık siparişleri MRP'de talep olarak yaşamaya devam eder, sevkiyat FIFO tahsis etmeyi sürdürür. **Çözüm:** softDelete override: açık sipariş varsa 409 + liste (preview politikasıyla uyumlu).

### M-27 — Son adım PROCESS_QC ise finishStep limbo (`kursun-qc.service.ts:665-671`)
nextStep'siz dal yalnız currentStepId=null yapıyor; top IN_PRODUCTION kalır, WO/kart tamamlama yok (kardeş yollar PRODUCED+COMPLETED yapıyor). Rota doğrulaması "TAMBUR son adım" şartı koymuyor. **Çözüm:** dala status:PRODUCED + WO/kart tamamlama; ve/veya rota doğrulamasına son-adım kuralı.

### M-28 — RollError giriş yolları eşit sertlikte değil (`production.service.ts:710-740` + `inventory.service.ts:1876`)
Legacy POST /production/report-error hâlâ route'lu: serbest metin errorType, defectTypeId'siz, adım/dupe kontrolsüz; kursunFinish DefectType isActive bakmıyor (+aynı findMany 2 kez). **Çözüm:** legacy'yi kaldır/delege et; isActive ekle.

### M-29 — processingStatus=processed sızıntısı + filtre ezme (`inventory.service.ts:435-468, 529`)
notIn listesi CANCELLED/SHIPPED/A1_STOCK/AT_KARTELA/KARTELA_CONSUMED'ı dışlamıyor → "işlenmekte" listesi ve stats'a sızar; processingStatus/rollScope önceki status filtresini sessizce ezer. **Çözüm:** izinli statüleri `in` ile yaz; çakışan komboda 400.

### M-30 — Roll softDelete final update koşulsuz (`inventory.service.ts:1311-1418`)
Guard'lar tx dışında; fason dispatch/çuval claim'i pencerede commit ederse top fasondayken/çuvaldayken CANCELLED'a çekilir (shipmentId temizlenmiyor bile). **Çözüm:** `updateMany WHERE {id, status: existing.status, shipmentId: existing.shipmentId}` count===0→409.

### M-31 — Traveler reprint çift ACTIVE kart (`traveler-card.service.ts:201-232`)
activeCard/lastVersion retry kapsamı DIŞINDA okunuyor; P2002 retry'ı bayat değerlerle İKİNCİ ACTIVE kartı basar (dosya başlığının vaat ettiği partial unique migration'ı yok). **Çözüm:** okumaları closure içine al + eski kartı koşullu çek + `UNIQUE INDEX ON traveler_cards("workOrderId") WHERE status='ACTIVE'`.

### M-32 — PATCH /admin/users/:id self-deactivation bypass (`admin.routes.ts:121` + `permission-management.service.ts:270`)
Guard yalnız DELETE'te; Electron edit formu tam bu PATCH'i kullanıyor → tek admin kendini kilitleyebilir (kurtarma DB müdahalesi). **Çözüm:** guard'ı service'e indir (updateUser+deactivateUser); opsiyonel "son aktif admin" kontrolü.

### M-33 — Stok dağılımı toplamları LIMIT 100'den (`reports/inventory.report.service.ts:113-158`)
totalRolls/totalQty kırpılmış listeden; aynı rapordaki byWidth LIMIT'siz → çelişen iki toplam. **Çözüm:** başlık toplamını ayrı LIMIT'siz aggregate'ten al.

---

# ÇÜRÜTÜLEN BULGULAR (yanlış pozitif — kayıt için)

1. **attachRolls "tek WO = tek kumaş" drift'i** — itemId kontrolü attach'te gerçekten yok, AMA zarar senaryosu fason sevk yolunda `ITEM_MISMATCH` + bilinçli `allowItemOverride` onayıyla backend'de engelleniyor; yerleşim bilinçli tasarım (kod yorumuyla belgeli).
2. **UUID migration "boş-DB-only" riski** — SQL okuması doğru ama bu, BACKEND-CODE-REVIEW.md DB-1'de açıkça belgelenmiş bilinçli karar (truncate→migrate→re-seed). Kalan iş sadece dokümantasyon: installer/güncelleme notuna "bu sürüm DB reset + seed gerektirir" uyarısı (düşük öncelik).

---

# DÜŞÜK ÖNCELİK (34 — doğrulamasız, bilgi amaçlı; uygularken kodu teyit et)

**İş emri:** iptal edilmiş siparişin satırına WO bağlanabiliyor (create/replace, `:587`); split adım klonu isUrgent/priority taşımıyor + SKIPPED'ı PENDING diriltiyor (`:1831`); splitBranch targetQuantity float reduce + bayat toplam (`:1783`); hardDelete ACTIVE refakat kartını VOID etmiyor (`:2276`, doğrulayıcı low'a indirdi — tek etki mobil picker kirliliği).
**Tambur:** finalizeWarehouseCut closeOrphanRollErrors çağırmıyor (`:1739`).
**Sevkiyat:** nextShipmentNo/nextSackNo startsWith → seq scan + 999 aşımında kalıcı 409 (`:78`); addSack weightKg .max'sız (`controller:31`).
**Fason:** receive idempotency kısmi çakışmada sessiz (C topu işlenmeden başarı toast'u, `:927`); dispatch idempotency'de iptal makbuz tanımı receive'la çelişik (`:353`).
**Kartela/etiket:** liste filtreleri whitelist'siz → bilinmeyen anahtar 500 (`return.service:390` + traveler-card); LabelTemplate tek-default yarışı (partial unique önerisi); etiket alan başlıkları (admin girdisi) escapesiz (`label-html.helper:298`).
**Sipariş/MRP:** picker take:200/500 kapsama filtresinden ÖNCE (yıllarla açık kalemler gizlenebilir, `:481`); sipariş iptali check-then-act (`:1133` — shipping kabulüyle aynı sınıf, bilinçli kabul edilecekse not düşülmeli).
**KK/üretim:** kart okutma hep İLK PROCESS_QC adımını çözüyor (çift-QC rotada yanlış reopen, `kursun-qc:130`); QC2_STEP_FINISHED marker'ı movement notes'u eziyor/reopen null'luyor (`:634`); setCapabilities diff'i tx dışı bayat snapshot'tan (`station-capability:211`).
**Stok:** getWarehouseScope PREPARING'deki topları hiçbir kovaya saymıyor (`:775`); createInitialEntry qualityGrade doğrulamasız (`:296`); kursunFinish DefectType çift sorgu (`:1876`); applyManualProperties ItemAllowedProperty atlanıyor (`:1563`).
**Şema:** append-ağır tablolarda uuid v4 (uuid(7) önerisi); 8 indekssiz FK kolonu (RollError.detectedByUserId vb.); ShipmentAllocation'da (shipmentId,orderLineId) unique yok (çift-commit DB seddi); RollMovement/PairingCode/RollReturn'de updatedAt yok (mutasyon görüyorlar) + SystemLog'da gereksiz var; OrderLine fiziksel silme Cascade'i iptal WO soy bağını siliyor; rolls'ta düz (createdAt,id) index yok (statüsüz cursor listesi); batchSplitId/PrintedDocument.sourceId hâlâ TEXT (gelecek raw JOIN cast tuzağı + index maliyeti).
**Platform:** P2007 (geçersiz uuid) error middleware'de eşlenmemiş → belirsiz 400 + console gürültüsü; filter[] virgül/boolean dönüşümü tipsiz (virgüllü değer sessiz IN'e bölünür); graceful shutdown server.close() yok (restart'ta uçuştaki istekler kopar — verdict low).
**Ops:** dashboard EXTERNAL todayCompleted COALESCE fallback'i yanlış metriğe düşüyor; cihaz eşleştirme/şablon merge check-then-act'leri; seed-test-full G bölümü shippedQty tutarsız (kapsama ekranıyla test edilirse yanıltır); fason cancel batchSplitId temizlemiyor (verdict low — dal görselleştirme kirliliği).

---

# KAPSAM KRİTİĞİ BULGULARI (incelenmemiş alanlar — ayrıca ele alınmalı)

1. **🔴 Master-data fiziksel silme endpoint'leri hiçbir kapsamda taranmadı:** `stationHardRemove` yorumu "sadece tamamlanmamış" derken kod statü filtresiz `workOrderStep.deleteMany({stationId})` çalıştırıyor (aktif WO'ların PENDING adımlarını siler / geçmişli istasyonda P2003 ile patlar). Generic `BaseController.hardRemove` (guard'sız, preview'sız, onay'sız) items/customers/defect-types/machines/routes'a mount edilmiş — "asla fiziksel DELETE" + "yıkıcı işlemde detaylı onay" kurallarının ikisini birden ihlal; H-11'in genelleştirilmiş hali. **Öneri: tüm `/permanent` route'larını kaldır veya servis-bazlı guard'lı override'a çevir.**
2. **Taranmamış controller Zod katmanı:** production/kartela/return/traveler-card/printed-document controller'ları hiçbir kapsamda yoktu; spot-check'te `production.controller updateQty` newQty/newWeight üst sınırsız (SEC-5 sınıfı) — coverage muhasebesine akıyor.
3. **Karşılanma muhasebesi helper'ları** (`coverage.helper.ts`, `order-status.helper.ts`) hiçbir kapsamın dosya listesinde yoktu; kritik sırasında okundu, bug görülmedi — ama en kritik muhasebe kodu olarak gelecek değişikliklerde öncelikli inceleme hedefi.

---

# DOĞRULANAN İYİ PRATİKLER (özet)

- **Shipping:** resetSackWeightsTx kuralı eksiksiz (kaçak endpoint yok); "5 guard'sız kardeş geçiş" notu artık GEÇERSİZ — beşi de atomik claim'li bulundu; assertReadyInvariants eksiksiz; Decimal disiplini temiz.
- **Tambur:** finalize çift-katmanlı idempotency + raceLost; Decimal/atomik decrement örnek seviyede; over-quantity lazy-read tutarlı.
- **Fason:** dünkü düzeltmeler (atomik claim, createMany batch — kolon-eksiksiz ve retry-güvenli, cancelDispatch raw UPDATE, ::uuid cast'leri) doğru uygulanmış; "kabulde ölçüm yok" kuralı kodda tutarlı.
- **Diff/UUID:** `tsc --noEmit` + `prisma validate` + `migrate status` temiz; **ham SQL uuid-cast taraması temiz (DB-1 ripple kaçağı yok)**; getFeatureFlags cacheClient sözleşmesi uyumlu.
- **Platform:** unhandled-rejection yolu bulunamadı; auth/RBAC per-istek sıfır DB sorgusu; safeSortBy dmmf guard'ı Prisma 7'de fiilen çalışıyor (doğrulandı); pool/timeout profili uygun.
- **Şema:** partial index disiplini (migration öncesi), snapshot+canonical ikili alan deseni, Decimal ölçekleri, belge no @unique'leri tutarlı.
- **MRP/sipariş:** computeWoMaterial tek-kaynak, çift sayım engelli; recomputeOrderStatus tek-yazma-noktası tutarlı; Decimal disiplini örnek seviyede.

---

# ÖNERİLEN AKSİYON SIRASI

**Hemen (veri bütünlüğü + dünkü migration'ın yan etkisi):**
H-3 (repartialize) → H-13 (arşiv 2 satır) → H-2 → H-9 → H-1 → H-7 → M-7/M-8 (BL-3 tamamlama)
**Yakında (canlı yollar):** H-5 (mobil PATCH) → H-6 → H-8 → M-5/M-6 (cursor) → M-17 → M-18 → M-32
**API-yüzeyi sertleştirme (UI çağıranı olmayanlar):** H-4 → H-11 + Kapsam-1 (hardRemove'lar) → H-12 → M-3/M-4
**Planlı:** H-14 (index migration) → M-10..M-31 kalanlar → düşük öncelik listesi

---

# DÜZELTME GÜNLÜĞÜ (Fix Log)

### 2026-06-12 — H-3 ✅ Repartialize migration
- **Dosya:** `prisma/migrations/20260612100000_repartialize_after_native_uuid/migration.sql`
- 9 index DROP + WHERE'li CREATE ile orijinal partial tanımlarına döndürüldü (kaynak DDL: 20260606001717 / 20260607010000 / 20260609120000 / 20260609221328 birebir). Başında `SET statement_timeout = 0`. Migration dosyasına KURAL notu eklendi: bu kolonlara dokunan gelecekteki Prisma migration'larından sonra repartialize bloğu elle kopyalanmalı.
- **Doğrulama:** `migrate deploy` sonrası pg_indexes → 9/9 PARTIAL (öncesinde 9/9 FULL teyit edilmişti).

### 2026-06-12 — H-13 ✅ Arşiv category/ipAddress
- **Dosya:** `src/services/audit.service.ts` (archiveOlderThan createMany map'i)
- `category: log.category` + `ipAddress: log.ipAddress` eklendi (2 satır).

### 2026-06-12 — H-2 ✅ Fason kabul/iptal atomik claim'leri
- **Dosya:** `src/services/subcontractor.service.ts`
- `receive()`: terminal flip artık `WHERE status=AT_SUBCONTRACTOR` + count → uyuşmazsa 409 (`AppError.conflict` P2002 olmadığından withBarcodeRetry'a girmez — yarışı retry'ın tamamlaması engellendi).
- `cancel()`: dispatch soft-cancel `cancelledAt:null` claim'i + toplar `status+currentStepId` claim'i + **`batchSplitId: null` temizliği** (iptal edilen parti hiç yaşanmamış sayılır — düşük-öncelik bulgusu da kapandı).
- `cancelReceipt()`: receipt `cancelledAt:null` claim'i + born-roll güvenlik kontrolü tx İÇİNDE taze veriyle tekrarlanıyor + orijinal toplar `status=SUBCONTRACTOR_CONSUMED` claim'i.

### 2026-06-12 — H-9 ✅ Kartela üç geçişe claim
- **Dosya:** `src/services/kartela.service.ts`
- `receive()`: tüketim flip'i `WHERE status=AT_KARTELA` + count → 409. `cancelDispatch()`: `cancelledAt:null` claim + toplar `AT_KARTELA` claim. `cancelReceipt()`: receipt claim + swatch soft-delete'e `shipmentId/sackId null + cancelledAt null` koşulu (downstream yarışı) + toplar `KARTELA_CONSUMED` claim.

### 2026-06-12 — H-1 + M-14 ✅ Tambur finalize guard'ları
- **Dosya:** `src/services/tambur.service.ts`
- `finalize()`: roll fetch'ine `currentStep.station.kind` eklendi; idempotent ön-kontrol sonrası `status=IN_PRODUCTION` + `station.kind=TAMBUR` guard'ları; atomik claim `not TAMBUR_CONSUMED` → `status=IN_PRODUCTION AND currentStepId=<tambur step>` olarak daraltıldı (KK2 reopen statü değil adım değiştirdiği için currentStepId şart); claim kaybında taze status okunup paralel-finalize (idempotent) vs başka-işlem (409) ayrımı yapılıyor; **claim sonrası taze currentQty kontrolü** (M-14 — bayat metrajla kesim 409'a düşer).

### 2026-06-12 — H-7 ✅ finalizeWarehouseCut / finalizeOpenFabric
- **Dosya:** `src/services/tambur.service.ts`
- İkisine de tx başında atomik claim (`WHERE status=<beklenen> [+ shipmentId null / + currentStepId]` → TAMBUR_CONSUMED; count 0 → 409); kalan metraj claim SONRASI tx içinde taze okunuyor (kalan child bayat metrajla doğamaz); `finalizeWarehouseCut`'a shipmentId reddi eklendi (H-1 ek bulgusu); parent retire artık yalnız qty/step temizliği (statüyü claim çeviriyor).

### 2026-06-12 — M-7 ✅ KK2 finishStep kapsam daraltması
- **Dosya:** `src/services/kursun-qc.service.ts` (~:635)
- Raw UPDATE'e `AND "rollId" = ANY(${rollIds}::uuid[])` eklendi — doğrulama ile tx arasında adıma giren top süpürülmez, açık kalır.

### 2026-06-12 — M-8 ✅ BL-3 kardeşleri + DB seddi
- `production.service.ts handleStepSkip`: ilerletme öncesi roll-pointer claim'i (`WHERE currentStepId=step.id`) — çift SKIP'in kaybedeni ikinci açık movement açamaz; son-adım dalı da koşullu updateMany.
- `inventory.service.ts kursunFinish`: movement kapatma count'u 0 ise tüm tx (mükerrer RollError dahil) geri sarılır, idempotent başarı döner (raceLost deseni).
- **DB seddi:** `prisma/migrations/20260612101000_unique_open_movement_per_roll_step/` — önce mevcut mükerrer açık movement'lar dedup'lanır (en yenisi kalır), sonra `roll_movements_one_open_per_roll_step_uq` PARTIAL UNIQUE (rollId, workOrderStepId) WHERE exitedAt IS NULL. handleStepStart check-then-create dahil sınıfın TAMAMI için kaybeden P2002 alır. Partial UNIQUE Prisma @@index ile eşleşmediğinden şemada karşılığı bilinçli yok (yorumla belgelendi); `migrate diff` → drift YOK (doğrulandı).

### 2026-06-12 — Test onarımları (düzeltmelerle ilişkili)
- `scripts/test_split_card_lineage.ts`: hardcoded fixture UUID'leri (UUID migration re-seed'inde geçersizleşmişti — önceden kırık) kardeş testlerdeki business-key `resolveFixtures()` desenine çevrildi.
- `scripts/test_tambur_over_quantity.ts`: `makeFinalizeRoll` artık adımsız sentetik top yerine gerçek akışla aynı Tambur-adımlı fixture kullanıyor (H-1 guard'ı bilinçli olarak adımsız topu reddediyor).

### 2026-06-12 — Regresyon sonuçları
`npx tsc --noEmit` TEMİZ · ESLint TEMİZ · `prisma migrate diff` drift YOK ·
test_wo_branch_split **26/26** · test_wo_branch_redye **20/20** · test_fason_parti_grouping **26/26** · test_consecutive_fason **18/18** · test_raw_tambur_cut **15/15** · test_tambur_over_quantity **10/10** · test_qc2_idempotency ✅ · test_split_card_lineage **18/18** · test_shipment_lifecycle **28/28** · test_sack_move_pullback **39/39** · test_quick_start_wo **17/17** · test_printed_documents **24/24**

### 2026-06-12 (2. parti) — H-5 ✅ PATCH kilitleri
- **Dosya:** `src/services/workorder.service.ts`
- `update()` (PATCH): COMPLETED/CANCELLED kontrolünden sonra `computeWorkOrderLocks` + replace()'teki aynı diff-bazlı guard'lar (width/targetItemId/targetColorId/foldType — yalnız gönderilen ve fiilen DEĞİŞEN alan kilide çarpar; mobil formun değişmemiş re-submit'i zararsız). Ek: hedef ürün/renk değişiminde `Item.allowedColors` (dolu=sınırlı) doğrulaması.
- `updateTargetProperties()`: `lockedPropertyIds` kaldırma yasağı + eklenen özellik için `applicablePropertyIds` kontrolü (replace ile aynı); "Status farketmez" doc'u kilit kuralıyla güncellendi.

### 2026-06-12 (2. parti) — H-6 ✅ Smart-merge başlamış adım guard'ları
- **Dosya:** `src/services/workorder.service.ts` (replace smart-merge)
- Başlamış (PENDING olmayan) adımın stationId değişimi 409 (not/kategori/planlanan firma serbest); başlamış adımların GÖRELİ SIRASI korunur (araya yeni PENDING adım eklemek serbest — sıra bozulmadıkça).

### 2026-06-12 (2. parti) — H-8 ✅ İptal sipariş ↔ aktif sevkiyat çift yönlü guard
- **Dosyalar:** `src/services/shipping.service.ts`, `src/services/order.service.ts`
- Shipping: `loadShipmentForFinalize` order.status'u da seçer; `computeShipmentAllocation` CANCELLED/COMPLETED siparişlerin satırlarını tahsis DIŞI bırakır (sevkiyat bloklanmaz; mal çıkar ama iptal siparişe alacaklanmaz). Önizleme (:605) bilinçli dokunulmadı — UI status'u zaten görüyor.
- Order: `getActiveShipmentLinks` + `assertNoActiveShipments` helper'ları; `softDelete`, `cancelWithActions`, `manualComplete` aktif (PREPARING/READY/AT_DOOR) sevkiyat bağı varken 409; `getCancelPreview` yanıtına `activeShipments` + `canCancel` eklendi (somut onay kuralı).

### 2026-06-12 (2. parti) — M-5 + M-6 ✅ Cursor sayfalama
- **Dosyalar:** `src/utils/cursor.ts`, `src/services/base.service.ts`, `src/services/inventory.service.ts`
- Cursor token v2 (JSON + tip etiketi s/n/d/b; Decimal duck-type → n; eski format decode'da geri-uyumlu) — rakamsal string kod/boolean sort'un 2. sayfa 400'ü kapandı.
- `dynamicCursorWhere(…, sortNullable)`: nullable kolonda non-null faza `OR {field: null}` geçiş dalı; orderBy `nulls:'last'` (base.service dmmf isRequired'dan otomatik; inventory Rolls'ta barcode/width/qualityGrade explicit set).
- **Empirik doğrulama:** 45 kayıtlık dev DB'de width/barcode/createdAt × asc/desc 6 kombinasyonda sayfalama TAM (önceden barcode desc 3/45 verip kesiliyordu).

### 2026-06-12 (2. parti) — Regresyon
`tsc` TEMİZ · quick_start 17/17 · branch_split 26/26 · shipment_lifecycle 28/28 · order_filter_batch 12/12 · unmark_ready_race 23/23

### 2026-06-12 (3. parti) — H-4 ✅ detachRolls guard'ları
- **Dosya:** `src/services/workorder.service.ts`
- Üyelik (currentStepId ∈ bu WO'nun adımları) + çıkarılabilir-statü guard'ı (IN_PRODUCTION / AT_SUBCONTRACTOR / RETURNED_FROM_SUBCONTRACTOR — fason kurtarma akışı bilinçli korundu); geçemeyenler sebep belirten errors[] ile raporlanır. Atomik claim (aynı koşullar WHERE'de + count → 409). `batchSplitId: null`; `producedInStepId` yalnız BU WO'nun adımını gösteriyorsa temizlenir (başka WO'da üretilmiş topun soy izi korunur). Boşalan adımlara recomputeStepStatus. Audit oldData artık GERÇEK önceki statü (hardcode "IN_PRODUCTION" değil).

### 2026-06-12 (3. parti) — H-10 + M-31 ✅ Traveler reprint
- **Dosya:** `src/services/traveler-card.service.ts`
- Yeni kart artık SNAPSHOT'lı: eski kartın snapshot'ı kopyalanır ("reprint orijinali birebir üretir" sözleşmesi); legacy snapshot'sız kartta buildSnapshot ile güncelden dondurulur. activeCard/lastVersion okumaları withBarcodeRetry/tx İÇİNE taşındı + eski karta koşullu flip (status=ACTIVE, count 0 → 409) — P2002 retry'ının bayat değerlerle çift ACTIVE kart basması kapandı.

### 2026-06-12 (3. parti) — H-11 ✅ Order hardDelete → guard'lı iptal
- **Dosya:** `src/services/order.service.ts`
- `hardDelete` override → `softDelete`'e delege (WO 409 blokajı + aktif sevkiyat guard'ı dahil). WorkOrderService.hardDelete'in arşive çevrilmesiyle aynı desen; Cascade zinciriyle fiziksel silme yolu kapandı.

### 2026-06-12 (3. parti) — H-12 ✅ step-action kind guard'ları
- **Dosya:** `src/services/production.service.ts`
- EXTERNAL guard'ının simetriği: PROCESS_QC'de FINISH reddedilir (kursun-qc akışına yönlendirir), TAMBUR'da FINISH/SKIP reddedilir (finalize akışına yönlendirir) — QC2'siz Tambur'a kaçış ve final-karar baypası kapandı. START serbest (kart okutma akışı).

### 2026-06-12 (3. parti) — H-14 ✅ Tarih index'leri
- **Migration:** `20260612102000_dashboard_report_date_indexes` + şema @@index'leri
- roll_errors(detectedAt), roll_errors(processedAt), roll_operations(createdAt), roll_movements(exitedAt) PARTIAL (WHERE NOT NULL — açık hareketler 20260612101000 partial unique'inde). Drift YOK (doğrulandı).

### 2026-06-12 (3. parti) — Regresyon
`tsc` TEMİZ · ESLint TEMİZ · `migrate diff` temiz · 13 paket yeşil: branch_split 26, redye 20, parti 26, ardışık fason 18, ham tambur 15, over-quantity 10, lineage 18, quick-start 17, sevkiyat 28, çuval 39, basılı belge 24, iade 18, sipariş filtre 12

### 2026-06-12 (4. parti) — Kapsam-1 ✅ Master-data /permanent guard'ları
- **Dosyalar:** `src/routes/station.routes.ts`, `src/routes/route.routes.ts`
- `stationHardRemove`: statü filtresiz `workOrderStep.deleteMany` KALDIRILDI; bağımlılık guard'ları eklendi (WO adımı / rota şablonu adımı / kart okutması / makine üretim hareketi / eşlenmiş cihaz → somut sayı ile 409). Kalıcı silme yalnız hiç kullanılmamış istasyon için; normal yol pasifleştirme.
- `routeHardRemove`: şablondan üretilmiş WO varsa 409 (soy izi korunur); rotanın kendi adımları silinebilir.
- Diğer generic hardRemove mount'ları (item/customer/machine/defect-type): FK Restrict + error-middleware temiz 400 backstop'u yeterli; Order zaten override'lı (H-11).

### 2026-06-12 (4. parti) — M-9 ✅ reopenStep tx-içi claim
- Geri çekme `updateMany WHERE {currentStepId: nextStep.id, status: IN_PRODUCTION}` + count → 409; onay penceresinde Tambur'da işlenen top artık KK2'ye çelişik geri çekilemez.

### 2026-06-12 (4. parti) — M-10 ✅ batchNumber/manifestNo retry kapsamı
- create() ve splitBranch(): otomatik parti kodu üretimi withBarcodeRetry closure'ının İÇİNE taşındı (P2002 retry'ı yeni sequence okur). createManifest withBarcodeRetry ile sarıldı.
- Bonus (düşük listeden): splitBranch targetQuantity artık tx İÇİNDE taze partiden Prisma.Decimal ile (float+bayat ihlali kapandı).

### 2026-06-12 (4. parti) — M-15 + M-16 ✅ Tambur girdi doğrulamaları
- M-15: finalize cuts[].length, cutOpenFabric.lengthMeters, cutWarehouseRoll.cutLength, reportError.startMeter → `.max(100_000)`.
- M-16: yeni `resolveQualityGradeIdStrict` (katalogda yok/pasif → Türkçe 400); finalize'da operatör girdisi cut kodları aktif-katalog kontrolünden geçer (parent'ın legacy snapshot kodu lenient); cutWarehouseRoll/cutOpenFabric explicit kod verildiğinde strict; KK1 createInitialEntry explicit kalite strict (bonus: düşük listedeki initial-entry-qualitygrade da kapandı).

### 2026-06-12 (4. parti) — M-17 ✅ Sack.seq
- addSack seq artık closure içinde max(seq)+1; migration `20260612103000_sack_seq_unique`: mevcut çiftler renumber + `@@unique([shipmentId, seq])` (drift YOK).

### 2026-06-12 (4. parti) — M-18 ✅ Fason ek parti iptali adım durumu
- cancel(): "aktif sevk" sayacı artık yalnız AÇIK (kabul görmemiş kalemi olan) sevkleri sayıyor + adımda bekleyen top kontrolü; ikisi de 0 ise geçmişte kabul varsa adım COMPLETED'a döner (+WO tamamlama kontrolü — receive'ın aynası), hiç kabul yoksa PENDING.

### 2026-06-12 (4. parti) — M-19 + M-20 ✅ Fason receive doğrulamaları
- M-19: appliedColorId/appliedPropertyIds varlık+isActive doğrulaması; propertyIds Set ile dedupe; rollProperty.createMany'ye skipDuplicates (dupe property artık koca kabul tx'ini retry'a sokup yanıltıcı "Barkod üretimi başarısız" üretemez).
- M-20: `step.workOrderId !== data.workOrderId` → 400 (dispatch ile simetrik) — makbuzun yanlış WO'ya yazılması/yanlış WO'nun COMPLETED'a çekilmesi kapandı.

### 2026-06-12 (4. parti) — M-21 ✅ İade iptali recency guard'ı
- cancelReturn: aynı topun daha YENİ aktif iadesi varsa 409 — eski iadenin iptali topu yıllar önceki sevkiyata SHIPPED yazamaz.

### 2026-06-12 (4. parti) — Regresyon
`tsc` TEMİZ · ESLint TEMİZ · drift YOK · 12 paket yeşil: iade 18, sevkiyat 28, çuval 39, ardışık fason 18, parti 26, ham tambur 15, over-quantity 10, branch split 26, redye 20, lineage 18, quick-start 17, basılı belge 24

### 2026-06-12 (5. parti) — M-4 ✅ BaseService yazım süzgeci
- **Dosya:** `src/services/base.service.ts` — `sanitizeWriteData`: create/update gövdesi dmmf scalar/enum whitelist'inden geçer; ilişki anahtarlı nested write operatörleri ve id/createdAt/updatedAt atılır; `nestedCreateFields` korunur. 13 bare-BaseController route'u tek noktadan korundu. **Empirik teyit:** önceden kabul edilen `{"rolls":{"deleteMany":{}}}` payload'u artık süzülüyor (45→45 top, id/createdAt korunuyor).

### 2026-06-12 (5. parti) — M-3 + M-25 ✅ Order mass-assignment + orderNumber
- **Dosya:** `src/services/order.service.ts` — `ORDER_HEADER_WRITABLE` / `ORDER_LINE_WRITABLE` whitelist'leri create+update'te (status/shippedQty/completedAt/manualClosedById/orderNumber/orderId istemciden yazılamaz; satır diff'i artık whitelist tabanlı). orderNumber üretimi withBarcodeRetry İÇİNDE + startsWith→gte/lt range (unique btree seek — seq scan bitti).

### 2026-06-12 (5. parti) — M-1 ✅ splitBranch claim'leri
- continue: dispatch repoint artık `WHERE {id, workOrderId: kaynak, cancelledAt: null}` claim'i (count 0 → 409 + tüm tx geri sarılır — sevk bir WO'ya toplar başkasına gidemez; dispatch-iptal yarışı da kapandı). redye: final roll.updateMany `batchSplitId + beklenen statü` koşullu + count → 409.

### 2026-06-12 (5. parti) — M-2 ✅ Sevkiyat içerik-vs-geçiş serileştirmesi
- **Dosya:** `src/services/shipping.service.ts`
- Yeni `touchShipmentPreparingTx`: TÜM içerik-mutasyon tx'leri (scan top/kartela ekle+taşı, removeRoll/removeSwatch, moveRollToSack, addSack, updateSack, removeSack boş+dolu, addOrders/removeOrder — 12 nokta) sevkiyat satırına koşullu dokunuş atar → PREPARING dışında 409 + finalize claim'leriyle SATIR KİLİDİ üzerinden tam serileşme.
- markReady/moveToDoor/dispatchShipment: içerik claim SONRASI TX İÇİNDE yeniden yüklenir (loadShipmentForFinalize artık tx alır); invariant + tahsis + SHIPPED flip + donan irsaliye her zaman TAZE kümeyle. cancelShipment roll temizliği snapshot id yerine canlı `where:{shipmentId}`.
- Sonuç: "dispatch ile yarışan removeRoll → hayalet SHIPPED top" ve "dispatch/cancel ile yarışan scan → kurtarılamaz rezerv" sınıfı kapandı.

### 2026-06-12 (5. parti) — Regresyon
`tsc` TEMİZ · ESLint TEMİZ · 13 paket yeşil (sevkiyat 28, çuval 39, unmark-race 23, transition-races 18, basılı belge 24, iade 18, sipariş filtre 12, branch split 26, redye 20, lineage 18, parti 26, ardışık fason 18, quick-start 17) · M-4 saldırı-payload probe OK

### 2026-06-12 (6. parti) — M-11 + M-12 + M-13 ✅ WO iptal/arşiv/redye bütünlüğü
- **Dosya:** `src/services/workorder.service.ts`
- M-11 getCancelImpact: önizleme artık LİMİTSİZ sayımlarla (`totalRollCount`, `willRevertToStock`) + liste 200'de kesilirse `rollsTruncated` bayrağı — "X kayıt etkilenecek" soyutluğu yerine gerçek iptal kümesiyle birebir.
- M-12 softDelete/hardDelete: açık RollMovement'lar raw UPDATE ile kapanır (`WO_CANCELLED`/`WO_ARCHIVED` notu), açık adımlar SKIPPED'a çekilir, hardDelete refakat kartını VOID eder — iptal edilmiş WO artık istasyon kuyruklarında hayalet WIP bırakmıyor.
- M-13 splitBranch redye: rewind sırasında taşınan topların açık RollError'ları kapanır (`actionTaken: NO_CUT`, `processedAtStepId: null`) — kalıcı "açık hata" şişmesi bitti.

### 2026-06-12 (6. parti) — M-22 + M-23 + M-24 ✅ Sipariş/master-data giriş guard'ları
- **Dosyalar:** `src/services/order.service.ts`, `item.service.ts`, `color.service.ts`, `customer.service.ts`, `customer-branch.service.ts`
- M-22: update'te müşteri değişimi `validateCustomer` (var+isActive) + satır gelmese bile MEVCUT satır renkleri yeni müşteriye `assertColorsAssignableToCustomer` ile yeniden doğrulanır — exclusivity bypass kapandı.
- M-23: satır rengi isActive, `item.update` allowed listeleri (renk/özellik var+aktif), renk-atama müşteri isActive — üç boşluk da kapandı.
- M-24: sipariş satırı `Item.allowedColors`/`allowedProperties` kısıtına karşı doğrulanır (boş liste = sınırsız kuralı korunarak).
- M-26: müşteri softDelete + şube deactivate açık siparişlerde (PENDING/APPROVED/PARTIAL_SHIPPED) bloklanır, ilk 20 sipariş no listelenir.

### 2026-06-12 (6. parti) — M-27 ✅ Son adım PROCESS_QC limbosu
- **Dosya:** `src/services/kursun-qc.service.ts` — finishStep 2b dalı: sonraki adım yoksa toplar `PRODUCED`'a flip + kalan adım yoksa WO `COMPLETED` + refakat kartı `COMPLETED` — toplar IN_PRODUCTION limbosunda kalmıyor.

### 2026-06-12 (6. parti) — M-28 + M-29 + M-30 ✅ RollError sertliği + filtre sızıntısı + softDelete claim
- **Dosyalar:** `src/services/production.service.ts` + `production.controller.ts`, `inventory.service.ts`
- M-28: legacy `production.reportError` artık kursun-qc ile aynı sözleşmede — `defectTypeId` katalogdan ZORUNLU (+isActive), serbest metin `errorType` kaldırıldı, PROCESS_QC adım şartı + duplicate kontrolü; `startMeter .max(100_000)`.
- M-29: `processingStatus=processed` artık açık in-list (STOCK/IN_PRODUCTION/PRODUCED/AT_SUBCONTRACTOR/RETURNED_FROM_SUBCONTRACTOR) — CANCELLED/SHIPPED sızmıyor; kullanıcı status filtresi varsa scope ezmez (`hasExplicitStatus` + `applyStatusScope`).
- M-30: roll softDelete final update'i koşullu claim — `WHERE {id, status: görülen, shipmentId: görülen}` → CANCELLED; sevk/çuval ile yarışta 409, sevkiyattaki top artık sessizce iptal edilemiyor.

### 2026-06-12 (6. parti) — M-32 ✅ PATCH /admin/users/:id guard'ları
- **Dosya:** `src/services/permission-management.service.ts` — `updateUser(isActive:false)` artık `assertNotSelfDeactivation` (route'taki guard servise indi — PATCH bypass kapandı) + `assertNotLastActiveAdmin` (admin:users/admin:* taşıyan SON aktif kullanıcı pasife alınamaz → 409); deactivateUser da aynı çift guard'ı kullanır.

### 2026-06-12 (6. parti) — M-33 ✅ Stok dağılımı başlık toplamları
- **Dosya:** `src/services/reports/inventory.report.service.ts` — `totalRolls`/`totalQty` artık LIMIT 100'lük byItemColor reduce'ünden değil, LİMİTSİZ tek satırlık `COUNT(*)+SUM(currentQty)` aggregate'inden — ürün×renk 100'ü aşınca toplamlar artık eksik kalmıyor, byWidth ile çelişki bitti.

### 2026-06-12 (6. parti) — Regresyon
`tsc` TEMİZ · ESLint TEMİZ · 12 paket yeşil, 247 test: sipariş filtre 12, branch split 26, redye 20, lineage 18, ardışık fason 18, parti 26, quick-start 17, sevkiyat 28, çuval 39, iade 18, ham tambur 15, over-quantity 10

---

# KAPANIŞ KAMPANYASI (2026-06-12, kullanıcı talimatı: insiyatif al, oto-devam)

Talimat: yanlış kuralları düzelt + eksik kuralları dokümanlara ekle + mimari iyileştirmeler + ölü endpoint temizliği + 34 düşük bulgudan elzem olanlar + her şeyin dokümantasyonu. Ticari fabrika ERP'si — yıkıcı değişikliklerde muhafazakâr ol, her partiden sonra tsc+regresyon.

| # | İş | Durum |
|---|---|---|
| K1 | 13 yanlış/bayat kural düzeltmesi (kök+backend+Electron+mobil CLAUDE.md, ARCHITECTURE.md §4/7.1/7.2/10.1, seed/base.controller/audit.service yorumları, statement_timeout=50s gerçeği) | ✅ |
| K2a | Eksik kurallar → Teks-Erp/CLAUDE.md (kontrol listesi +6 madde, Test Scriptleri bölümü, katman istisnası, bwip-js) | ✅ |
| K2b | Eksik kurallar → ARCHITECTURE.md detay bölümleri (§8.8 atomik claim, §8.9 withBarcodeRetry, §8.1 BaseService hook'ları, §9.5 cursor gerçek sözleşmesi, sevkiyat içerik-tx kuralları) | ✅ |
| K3 | guarded hardRemove triplikasyonu → tek paylaşılan helper (station/route/product-recipe route'ları) | ✅ |
| K4 | ESLint no-restricted-imports: routes/controllers'da prisma yasağı + mevcut ihlaller (admin.routes istatistik sorguları → disable/taşı) | ✅ |
| K5 | auth.controller user CRUD (3 nokta) → servise taşı | ✅ |
| K6 | Ölü endpoint temizliği — SADECE yüksek-güven: /api/production modülü (5), kursun-qc undo-qc2, rolls/:id/identity, WO attach-rolls/detach-rolls/available-for-attach; auth/register script kullanımı DOĞRULA; manifest ailesi (4) + dashboard/defects/summary (geliştirme altında) DOKUNMA | ✅ |
| K7 | Eksik FK index: RouteStep.stationId + RollReturn.colorId migration; audit-FK istisnası CLAUDE.md kural 1'e not | ✅ |
| K8 | 34 düşük bulgu triyajı → elzem olanları düzelt, gerisini gerekçeyle ⏭️ işaretle | ✅ |
| K9 | Tüm değişikliklerin doküman yansıması (ARCHITECTURE.md §5 haritası ölü temizlik sonrası, rapor günlüğü, hafıza) | ✅ |
| K10 | Final: tsc + eslint + TAM regresyon (19 paket), cron sil, kullanıcıya özet | ✅ |

Mobil not: production.service'in mobil ÖLÜ wrapper'ları (mobil/src/services/production.service.ts, kursunQc.service.ts undoQc2) backend temizliğiyle birlikte silinebilir — mobil build gerekmez (kullanılmıyorlar).

### 2026-06-12 (KAPANIŞ) — Düzeltme Günlüğü

**K1 — 13 yanlış/bayat kural düzeltildi:** En kritikleri: kök CLAUDE.md "fason dönüşte yeni Roll yok / ölçüm alınmaz" kuralı kodun TAM TERSİYDİ (gerçek: SUBCONTRACTOR_CONSUMED + born-roll, qty zorunlu) — ARCH §7.2 ile birlikte yeniden yazıldı; "soft delete = SCRAP" → CANCELLED (SCRAP=gerçek fire kararı); §7.1 kalite→statü eşlemesi (gerçek fallback WAREHOUSE, SCRAP değil); statement_timeout dokümanlarda 30s, gerçek 50s (+DB adı ortam ayrımı dev=adnansahin_db / prod=TeksErpDb); ARCH §4 "READY_FOR_SHIP saklı" notu (enum yok); bwip-js izinli paket listesine; PK/enum/RollError yaşam döngüsü nüansları; Electron "42 permission"→54; mobil "sevkiyat backend'i yok"→canlı; seed başlık yorumu 45→54; base.controller+audit.service'teki var olmayan core-architecture.md atıfları gerçek dokümanlara çevrildi.

**K2 — Yazılmamış kurallar dokümante edildi:** Teks-Erp/CLAUDE.md kontrol listesi +6 madde (isActive guard, withBarcodeRetry, atomik claim, requireAnyPermission, Decimal, sevkiyat tx şablonu) + "Test Scriptleri" bölümü (jest/vitest kurma!) + katman istisnası + audit best-effort + Tambur/depo statü nüansları. ARCHITECTURE.md: §8.1 BaseService hook tablosu (sanitizeWriteData'nın SESSİZ süzmesi, uniqueField reactivate), §8.8 Atomik Claim (2 incelik), §8.9 withBarcodeRetry (3 kural), §8.10 Sevkiyat içerik-mutasyon şablonu (touchShipmentPreparingTx + resetSackWeightsTx), §9.5 gerçek cursor sözleşmesi, §8.7 Decimal→number serializer.

**K3 — guardedHardRemove:** station/route/product-recipe route'larındaki ~250 satırlık üç kopya → `services/helpers/guarded-hard-remove.ts` factory + 3 konfigüre handler; route dosyalarından prisma/AuditService import'ları kalktı. Test: `test_guarded_hard_remove.ts` 8/8 (404/409+somut sayı/200+audit).

**K4 — ESLint katman kuralı:** `no-restricted-imports` ile src/routes+src/controllers'da `**/lib/prisma` yasak; admin.routes log-istatistikleri `AuditService.getLogStats()`'a taşındı → ihlal sayısı 0.

**K5 — auth.controller:** mobileUsers→`AuthService.listMobileUsers`, me→`getActiveUserSummary`; controller'da prisma kalmadı.

**K6 — Ölü endpoint temizliği (9 uç + 1 modül):** /api/production modülü KOMPLE silindi (5 uç + controller + servis — frontend çağıranı yok, istasyon-özel modüller yerini almış); kursun-qc `undo-qc2` (route+controller+servis, yarım-geri-alma bug'lıydı); `rolls/:id/identity`; WO `attach-rolls`/`detach-rolls`/`available-for-attach` (servis metodları YAŞIYOR — quick-start + seed scriptleri içeriden kullanır); `auth/register` (tek kullanıcı yaratma yolu artık /api/admin/users). Mobil ölü wrapper'lar silindi (production.service.ts dosyası + kursunQc.undoQc2). DOKUNULMADI: WO manifest ailesi (4 — PrintedDocument bağlamında bekletiliyor olabilir), dashboard/defects/summary (modül geliştirme altında).

**K7 — FK index:** RouteStep.stationId + RollReturn.colorId (migration `20260612120000`, manuel uygulandı — migrate dev reset istedi, reddedildi); CLAUDE.md kural 1'e audit-FK istisna notu.

**K8 — 34 düşük bulgu triyajı:**
- ZATEN DÜZELTİLMİŞTİ (kampanya): WO hardDelete traveler VOID (M-12), kursunFinish DefectType tek sorgu+isActive (M-28), fason cancel batchSplitId:null, createInitialEntry strict quality, splitBranch Decimal reduce.
- ✅ DÜZELTİLDİ (11): iptal siparişe WO bağlama guard'ı (create+replace, assertOrderLinesLinkable); split klonu isUrgent/priority taşır + SKIPPED'ı diriltmez; finalizeWarehouseCut closeOrphanRollErrors; nextShipmentNo/nextSackNo gte/lt range + createdAt-son (999→1000 kalıcı 409 tuzağı bitti); addSack weightKg .max; iade liste filtre whitelist'i (bilinmeyen anahtar 500'ü); etiket başlıkları escapeHtml; getWarehouseScope `preparing` kovası (PREPARING topları artık sayılıyor); P2007→net 400; graceful shutdown (SIGTERM/SIGINT + server.close + 5s force); ShipmentAllocation @@unique([shipmentId,orderLineId]) (migration `20260612121000`, dedup güvenlik ağıyla).
- ⏭️ BİLİNÇLİ AÇIK (gerekçeli): OrderPicker take-500-önce-kapsama (gerçek çözüm SQL-side kapsama; bu ölçekte risk düşük); fason receive kısmi-çakışma sessizliği + dispatch iptal-makbuz tanımı (davranış kararı gerek); LabelTemplate tek-default yarışı (nadir admin op); çift-QC rota kart çözümü + QC2_STEP_FINISHED marker (tek-QC pratikte); setCapabilities/cihaz-eşleştirme/şablon-merge check-then-act (nadir admin op); sipariş iptali check-then-act (shipping kabulü sınıfı — preview+onay akışı pratikte koruyor); uuid v7 / TEXT kolon dönüşümleri / updatedAt ekle-çıkar / OrderLine Cascade / (createdAt,id) düz index (tasarım kararları, ihtiyaç doğunca); kalan 8 audit-FK index'i (kural notuna bağlandı); traveler-card filtre iddiası GEÇERSİZ (tipli where kuruyor); dashboard EXTERNAL metriği (modül yeniden yazılıyor); seed-test-full G tutarlılığı (test verisi).

**KAPANIŞ regresyonu:** `tsc` backend+mobil TEMİZ · ESLint TEMİZ (yeni katman kuralı dahil) · drift YOK · **20 paket / ~367 test yeşil** (sevkiyat 28, çuval 39, unmark-race 23, transition-races 18, basılı belge 24, iade 18, sipariş filtre 12, renk 25, fason picker 11, observability 11, branch split 26, redye 20, lineage 18, ardışık fason 18, parti 26, quick-start 17, ham tambur 15, over-quantity 10, qc2-idempotency, guarded-hard-remove 8).
