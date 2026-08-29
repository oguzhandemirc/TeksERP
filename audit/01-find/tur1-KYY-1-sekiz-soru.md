# TUR 1 — KYY-1: Kritik yazma yolu 8-soru analizi (grup 1)

**Denetçi:** KYY-1 · **Aşama:** ② BULMA, TUR 1 · **Mercek:** kod merkezli (kritik yazma yolu 8-soru)
**Tarih:** 2026-08-28 · dal `adnansahin` · HEAD `ce8681d1` · **SALT-OKUNUR** (kaynak ağaca dokunulmadı; tek yazma izni `Teks-Erp/scripts/audit_repro_*.ts`)
**Kapsam:** `KRITIK-YAZMA-YOLLARI.md`'deki 51 yoldan `NN mod 3 == 1` olanlar → **KYY-01, 04, 07, 10, 13, 16, 19, 22, 25, 28, 31, 34, 37, 40, 43, 46, 49** (17 yol)
**Ortam:** Node 22.19 · Express 5.2 · Prisma 7.7 + `@prisma/adapter-pg` · PG dev 18.6 / prod 16.9 · **PM2 fork `instances:1` (tek process invariantı)** · varsayılan izolasyon READ COMMITTED (ölçülerek doğrulandı, KUNYE) · havuz `max 30` · global tx bütçesi `maxWait 5s / timeout 20s`

---

## 0. Yönetici özeti

17 yolun **8'inde 7. soruya EVET** çıktı (iki eşzamanlı aktörle kurulan çizelge bir değişmezi bozuyor); **9'unda HAYIR** ve her HAYIR'ın *neden* olduğu tabloda yazılı. Üçü **K3** (dev DB'de eşzamanlı repro scripti ile TETİKLENDİ), biri **K2** (dev DB audit defterinde fiili ihlal bulundu), dördü **K1**.

| # | Bulgu | Şiddet | Kanıt | Yol |
|---|---|---|---|---|
| KYY-1-01 | Tambur geri alma iş emri satırını HİÇ kilitlemiyor → iptal edilen iş emrinin SKIPPED adımına IN_PRODUCTION top diriltiliyor (iki taraf da "başarılı") | **S1** | **K3** 8/16 tur | KYY-16 (∥ KYY-22) |
| KYY-1-02 | Fason kısmi kabulde aynı `clientToken` eşzamanlı gelince idempotent replay yerine "Barkod üretimi 5 denemede başarısız oldu" 409'u dönüyor → operatör elle yeniden giriyor → **aynı teslimat İKİ kez düşülüyor** | **S1** | **K3** 6/6 tur | KYY-10 (∥ KYY-28) |
| KYY-1-03 | Katlanmış (harf-duyarsız) kod tekilliği kilidi 4 çağırandan yalnız 1'inde → eşzamanlı `sefa`/`SEFA` ikisi de geçiyor, kimlik ikizi doğuyor | **S2** | **K3** 12/12 tur (kontrol grubu 0/6) | KYY-37 |
| KYY-1-04 | `updateTargetProperties` (W8) kilitsiz + claim'siz + statü guard'sız; kilit kararı tamamen tx DIŞINDA → kapanmakta olan iş emrinin fiilen uygulanmış özelliği hem plandan hem TOPLARDAN siliniyor | **S2** | K1 | KYY-25 |
| KYY-1-05 | Yedek `running` bayrağı process-local + dosya adı saniye çözünürlüklü → aynı `.part`a iki yazıcı; dev defterinde **ölçüldü** (aynı ms'de 2 COMPLETED; aynı dosyada FAILED+COMPLETED 8 ms arayla) | **S2** | **K2** | KYY-46 |
| KYY-1-06 | `freezeForSource` `version = max+1` kilitsiz ve P2002 yakalaması YALNIZ lazy-init dalında → sevk/iade tx'i belge çakışmasında 409'a düşüp tamamen geri sarılıyor | **S3** | K1 | KYY-34 |
| KYY-1-07 | `setFeatureFlags` ~50 bağımsız upsert, tx YOK + istemci TAM nesne gönderiyor → bayat sayfadan kaydeden ikinci admin `kk1.duplicateGuardEnabled` gibi koruma bayraklarını sessizce geri kapatıyor | **S3** | K1 | KYY-43 |
| KYY-1-08 | `reasonPreset.duplicate` `nextFreeCode` tx DIŞINDA + `sortOrder` kaydırması idempotent değil → eşzamanlı çoğaltmada aynı `sortOrder`'da iki satır / kaçınılabilir P2002 | **S3** | K1 | KYY-49 |

**Çürütülen ② hipotezleri (bulgu DEĞİL, gerekçesi tabloda):** KYY-04'ün "`cancelReturn` 8023 almadan topu SHIPPED'e yazar → storno ile çakışır" hipotezi **kapalıdır** (aktif iade sayacı stornoyu zaten 409'lar, ters sıra fiilen kurulamıyor); KYY-07'nin "doğrudan `cancelShipment` 8023 almıyor" endişesi **zararsızdır** (PLANNED sevkiyata dokunan tüm akışlar `updateMany` claim'i ile AYNI sevkiyat SATIRINDA serileşiyor); KYY-19 `assign` ve KYY-22 `completeWorkOrder` **model desendir** (kilit ilk ifade, tüm guard'lar kilit altında taze, DB partial unique son savunma); KYY-40 `openLoginSession` 8024 sırası doğrudur; KYY-31 kartela dispatch/receive'in atomik çoklu claim'i eşzamanlı mükerreri kapatıyor.

**Ölçülerek düzeltilen harita satırı:** `KRITIK-YAZMA-YOLLARI.md` KYY-28 "`withBarcodeRetry` … **predicate'li yalnız 4**" diyor. Ölçüm: `grep -rn "isRetryable" src` → **yalnız tanım satırı** (`utils/barcode-retry.ts:23,33`); **28 çağrı yerinin HİÇBİRİ** 3. argümanı geçmiyor. Yani her P2002 (iş anahtarı `clientToken` dahil) 5 kez boşuna tekrarlanıyor — KYY-1-02'nin motoru budur.

---

## 1. Bölüm 6 matrisi — 17 yol × 8 soru

Soru anahtarı: **(1)** korunan değişmez · **(2)** tx sınırı · **(3)** check-then-act var mı · **(4)** kilit/claim/advisory (ve SIRA) · **(5)** küme/aralık kararı (write skew) nasıl korunuyor · **(6)** DB kısıtı son savunma · **(7)** iki aktörle çizelge kurulunca bozuluyor mu · **(8)** fabrikadaki etki.

### KYY-01 — KK1 ham giriş (mükerrer tuzağı 8021 + clientToken replay)

| # | Cevap |
|---|---|
| 1 | STK-01 "bir fiziksel top = bir kayıt" (uyarı düzeyinde, engelleme değil) · barkod tekilliği · `clientToken` idempotency · `currentQty/initialQty ≥ 0` |
| 2 | `prisma.$transaction` `inventory.service.ts:816-950`. **tx ÖNCESİ:** ürün/renk/kalite doğrulamaları `:694-774`, bayrak okuması `readKk1DuplicateGuardEnabled()` `:806-809` (yorumu `:802-805` neden tx dışında olduğunu anlatıyor: tx içinden çağrılırsa havuzdan İKİNCİ bağlantı ister → 30 eşzamanlı tx havuzu kilitler). **tx SONRASI:** P2002 yakalama `:951-1007`, audit `:1009`. |
| 3 | EVET ×2. (a) ikiz sorgusu `:848-877` → karar `throw 409 POSSIBLE_DUPLICATE` `:879` — kilit ALTINDA, güvenli. (b) **replay dalı `:963-985`: `existing.status` OKUNMUYOR** — iptal/fire edilmiş top için `success:true` + eski barkod dönüyor. |
| 4 | Bayrak açıkken `tx.$executeRaw pg_advisory_xact_lock(8021, hashtext(lockKey))` **`:844` tx'in İLK ifadesi**; korunan okuma `:848`, barkod sayacı `:905` → **sıra doğru** (kilit → okuma → sayaç). Kilit anahtarı `duplicateGuardLockKey({entrySource,itemId,colorId,initialQty,width,userId,machineId})` = ikiz sorgusunun WHERE'iyle BİREBİR aynı kolonlar → kapsam doğru. Barkod: `roll_barcode_counters` `INSERT … ON CONFLICT DO UPDATE SET n = n + count RETURNING` (tek ifade, atomik). Claim yok (create yolu). **Bayrak KAPALIYKEN yol tamamen kilitsizdir** — sahada `kk1.duplicateGuardEnabled=true` (saha DB'sinde satır var). |
| 5 | Karar bir ARALIK üzerinde (`clientEnteredAt ± 90 sn` iki yönlü + `createdAt` index çıpası) ve satır HENÜZ YOK (phantom) → satır kilidi kapatmaz. Advisory lock doğru araç ve doğru yerde. |
| 6 | `rolls.clientToken` **partial unique** (`IS NOT NULL`) · `rolls.barcode` unique · `roll_barcode_counters` PK `(day,type)` · CHECK `qty ≥ 0` · trigger `rolls_stamp_production_timestamps`. "Mükerrer top" için DB kısıtı **bilinçli YOK** (aynı partiden eşit metrajlı toplar meşru). |
| 7 | **HAYIR (yarış)** — 8021 kilidi + partial unique + P2002 yakalama üçlüsü eşzamanlı yolu kapatıyor. **AMA sıralı-aktör çizelgesi bozuyor:** T1 (tablet, 03:12) token X ile top girer, ağ düşer; T2 (Electron, 03:20) topu İPTAL eder (`CANCELLED`); T3 (kuyruk boşalması) token X'i replay eder → `:963` `findUnique` iptal edilmiş topu bulur, `sameItem/sameColor/sameQty` üçü de tutar → **`success:true` "Top zaten kayıtlı"**. Operatör topu girilmiş sanır, envanterde yoktur. Bu 4. durum `tambur-manual.service:1049/:1405` ve `subcontractor.service:2348` (`RECEIPT_CANCELLED`) yollarında VAR, KK1'de YOK. Beceri §8 "en pahalı hata" sınıfı. → D-B alanının birincil kalemi; burada **sınır ötesi not** olarak bırakıldı (yarış değil, çizelge sıralıdır). |
| 8 | Saha ölçümü: `clientToken` taşıyan **227** `CANCELLED`/`SCRAP` top var (`sql-saha.sh`, aşağıda) → replay yüzeyi gerçek. Etki: eksik ham stok + operatörün "girdim" beyanı. |

```
$ audit/tools/sql-saha.sh -Atc "SELECT count(*) FROM rolls WHERE \"clientToken\" IS NOT NULL AND status IN ('CANCELLED','SCRAP');"
227
```

### KYY-04 — Storno (undo-dispatch) + opsiyonel sevkiyat kapanışı

| # | Cevap |
|---|---|
| 1 | SEV-xx "SHIPPED top ⇒ ait olduğu sevkiyat DISPATCHED" · "aktif iade varken storno olmaz" · `OrderLine.shippedQty` yalnız DISPATCHED tahsislerden türer · donmuş belge (v1 VOIDED) |
| 2 | `shipping.service.ts:2151-2231` tek tx. tx ÖNCESİ: `readShipmentUndoSameDayOnly()` `:2148`. tx SONRASI: audit `:2233`. |
| 3 | EVET ama **kapalı**: `sh` `:2161`, `activeReturnCount` `:2167`, `resolveUndoBlockReason` `:2169` — hepsi **kilit altında ve tx içinde taze**; asıl yazım `updateMany` claim'i `:2179` `{id, status: DISPATCHED}` + `count===0 → 409`. |
| 4 | `lockShipmentScopeTx(tx, shipmentId)` = `pg_advisory_xact_lock(8023, hashtext(id))` **`:2159` tx'in İLK ifadesi**, `rollReturn.count` `:2167`'den ÖNCE. Sıra doğru ve helper'ın docstring'i (`shipment-locks.helper.ts:33-52`) bunun neden load-bearing olduğunu üretilmiş vakayla anlatıyor. Sonra `shipmentOrder` `:2186` → roll `groupBy` + `updateMany` `:2191-2202` → `touchOrderLinesTx` `:2210` → `recomputeOrderStatusForOrders` `:2211`. |
| 5 | Karar "bu sevkiyata ait AKTİF iade var mı" — **phantom** (henüz olmayan satır). 8023 kapatıyor; `createReturn` `return.service.ts:490` **AYNI** kilidi alıyor (`grep lockShipmentScopeTx` → yalnız 2 çağıran: `shipping:2159`, `return:490`). |
| 6 | `Shipment.cancelledAt` kolonu YOK (iz yalnız audit — K2a H13) · `printed_documents` status enum · sevkiyat statü geçişi için DB seddi YOK. |
| 7 | **HAYIR — ② hipotezi ÇÜRÜTÜLDÜ.** Hipotez: "`cancelReturn` (KYY-06) 8023 almadan ve sevkiyat statüsüne bakmadan topu SHIPPED'e geri yazar". Kod doğrulandı: `return.service.ts:878-900` gerçekten kilitsiz ve sevkiyat statüsünü HİÇ okumuyor (`rr.fromShipmentId`'yi körlemesine yazıyor). **Ama zararlı çizelge kurulamıyor:** iade iptal edilebilmesi için AKTİF bir `RollReturn` gerekir; aktif iade varken `resolveUndoBlockReason` `:2192-2196` stornoyu **koşulsuz 409'lar**. Yani "sevkiyat DISPATCHED değilken cancelReturn topu SHIPPED yazar" durumuna giden tek yol (önce storno, sonra iade iptali) kapıdan geçemiyor. `cancelShipment` de DISPATCHED sevkiyatı reddediyor (`:1993`). Kalan tek teorik yol iki `cancelReturn`'ün aynı topta yarışması — orada roll claim'i `{id, status: expectedStatus, shipmentId: null, sackId: null}` `:880` kaybedeni 409'lıyor. **Ancak koruma TESADÜFİDİR** ve `resolveUndoBlockReason`'daki iade kapısı bir gün gevşetilirse (ör. "iade edilenler hariç geri al") sessizce açılır → sınır ötesi not. |
| 8 | — (bulgu yok). Bekçi boşluğu duruyor: `test_shipment_scope_lock` sırayı ölçüyor ama **storno × storno paralel** ve **cancelReturn × storno** sondaları yok. |

### KYY-07 — PLANNED sevkiyat iptali (`cancelShipment` → `cancelPlannedShipmentTx`)

| # | Cevap |
|---|---|
| 1 | "PLANNED tahsis rezerv değildir; iptalde tahsis SİLİNİR" · `shipmentOrder.isActive ⇔ sevkiyat PLANNED` (test_consistency §5) · çuval havuza döner (`sack.shipmentId = null`) |
| 2 | `shipping.service.ts:1995-1997` tx; gövde `cancelPlannedShipmentTx` `:1961-1983`. tx ÖNCESİ: statü okuması `:1990`. tx SONRASI: audit `:1998`. |
| 3 | EVET ama **pin'li**: pre-tx okunan `shipment.status` claim'in WHERE'ine `expectedStatus` olarak GEÇİRİLİYOR (`:1966`) → count 0 → 409. Doğru desen. |
| 4 | Advisory YOK. **Ama `tx.shipment.updateMany({where:{id,status:expected}})` sevkiyat SATIRININ yazma kilidini alıyor ve commit'e kadar tutuyor** — ve PLANNED sevkiyata dokunan diğer tüm akışlar aynı satıra yazıyor: `touchShipmentPlannedTx` (`shipment-locks.helper.ts:88-99`, çuval ekle/çıkar), `performDispatchTx` claim'i, `undoDispatch` claim'i. Sıra: H(claim) → L(`touchOrderLinesTx` `:1975`) → alloc `deleteMany` `:1976` → `shipmentOrder` `:1977` → R/Swatch/S `:1979-1981` → recompute `:1982`. |
| 5 | "Bu sevkiyatın TÜM çuval/top/tahsis kümesi" — kümeye eşzamanlı EKLEME yalnız `addSacksToShipment` üzerinden olur ve o `touchShipmentPlannedTx` ile aynı satırda serileşir → phantom kapalı. Sipariş defteri tarafında `touchOrderLinesTx` ETKİLENEN SİPARİŞLERİN TAM satır kümesini kilitliyor (`:1974-1975`). |
| 6 | `sack_allocations.sackId` FK **Restrict** · statü geçişi için DB seddi YOK · `Shipment.cancelledAt` kolonu YOK. |
| 7 | **HAYIR — ② endişesi (K12 H14: "doğrudan `cancelShipment` yolu 8023 almıyor") doğrulandı ama ZARARSIZ.** 8023 yalnız iade↔storno phantom'unu kapatmak için var; PLANNED sevkiyatın iadesi olamaz (iade `SHIPPED` top ister). Denenen çizelgeler: `cancelShipment ∥ addSacksToShipment` → sevkiyat satırında serileşir; `∥ dispatchShipment` → iki claim, biri 409; `∥ scanIntoSack` → `touchWarehouseSackTx` `shipmentId: null` ister, iptal commit etmeden 409, ettikten sonra meşru. |
| 8 | — (bulgu yok). **F/G tarafı duruyor ve benim alanım değil:** uç gövdesiz (sebep alınmıyor), `:id` uuid doğrulaması yok, WRITE izin kümesi mobil izinleri içeriyor, iptal izi yalnız 6 ayda arşivlenen audit'te. |

### KYY-10 — Fason kabul (tam + KISMİ)

| # | Cevap |
|---|---|
| 1 | FAS-03 `Σ receivedQty ≤ dispatchedQty` · "kısmi kabulde top TÜKETİLMEZ, `currentQty` kalana iner" · `clientToken` = kısmi teslimatın TEK replay kimliği · çekme sapması defteri tek kez yazılır |
| 2 | `withBarcodeRetry(() => prisma.$transaction(...))` `subcontractor.service.ts:2677-3224`. **tx ÖNCESİ (havuz):** token kontrolü `:2349-2370`, küme-eşitliği guard'ı `:2390-2430`, `step.status===ACTIVE` `:2492`, `nextStep` `:2664`, `resolveRollLabels(prisma)` `:2608`. **tx SONRASI:** audit `:3235`, **best-effort `changeWidth` `:3270` ve `changeTargetColor` `:3297` (hata `console.warn`)**. |
| 3 | EVET, iki katmanda. Kritik olan: **token kontrolü `:2350` tx DIŞINDA** ve karar ("cached makbuz dön") ile yazım (`subcontractorReceipt.create` `:2787`, `clientToken` @unique) arasında `await`ler var. Kısmi/tam sınıflandırma ise kilit ALTINDA taze (`freshReturns` `:2723`, yorum `:2718-2722`). |
| 4 | `touchWorkOrderTx(tx, workOrderId)` **`:2681` tx'in İLK ifadesi** (`workorder-locks.helper.ts:50-58` → `updateMany` = gerçek satır yazma kilidi). Sonra taze hedef renk `:2693` → `freshReturns` `:2723` → `Q` FK no `:2784` → **receipt.create `:2787`** → tam kabul claim `:2857` `{id in, AT_SUBCONTRACTOR}` count!==len→409 → kısmi decrement claim döngüsü `:2879` `{id, AT_SUB, currentQty gt receivedQty}` count!==1→409 → `createBatchTx` (8022) `:3014` → `reserveRollBarcodes` `:3046`. **Sıra W → (create) → R → A22 → K.** |
| 5 | "Bu sevk kaleminin kalanı" bir KÜME kararıdır; WO satır kilidi aynı iş emrine yazan tüm kabul/sevk akışlarını serileştirdiği için phantom kapalı. `Σ receivedQty ≤ dispatchedQty` **yalnız kodda**, DB'de CHECK yok. |
| 6 | `subcontractor_receipts.receiptNo` unique · **`clientToken` DÜZ unique** · `(receiptId, newRollId)` unique · `roll_variances` CHECK `qty > 0` + `rollId` FK **Restrict**. Saha: 143 makbuzun **yalnız 2'si** token taşıyor (`sql-saha.sh`), kısmi kalem 1. |
| 7 | **EVET → bulgu KYY-1-02 (K3, 6/6).** `receipt.create` roll claim'lerinden ÖNCE olduğu için, aynı token'lı ikinci istek KISMİ modda `freshReturns` kapısını geçer (top fasonda KALIR!) ve `clientToken` P2002'sine düşer; `withBarcodeRetry` predicate'siz olduğu için kalıcı çakışmayı 5 kez tekrarlar ve "Barkod üretimi 5 denemede başarısız oldu" 409'una çevirir. |
| 8 | Ölçülen zincir: 300 m top, 120 m kısmi kabul → yanıltıcı 409 → operatörün elle yeniden girişi → **kalan 180 yerine 60 m**, 2 aktif makbuz, 2 doğan top, 2 çekme sapması satırı. |

### KYY-13 — Fasondan doğrudan sevk (`executeDirectShip`)

| # | Cevap |
|---|---|
| 1 | FAS-05 terminal ("doğrudan sevkte toplar `SUBCONTRACTOR_CONSUMED`, DSA `shippedQty`'ye sayılır") · `Σ DSA.qty ≤ orderLine.quantity − mevcut` (over-cover) · sevk kalemi bir kez doğrudan sevk edilir |
| 2 | `withBarcodeRetry(() => prisma.$transaction(...))` `subcontractor.service.ts:6018-6325`; audit `:6325`. Pre-tx: `acceptedReceiptItem` `:5906`, `movedRolls` `:5931`. |
| 3 | EVET ama kapalı: over-cover kontrolü `:6280` **tx içinde ve `touchOrderLinesTx` `:6233` ile TAM satır kümesi kilitliyken** koşuyor; roll claim'i `{id in, AT_SUBCONTRACTOR}` `:6114` pre-tx okumanın ikizini WHERE'e koyuyor. |
| 4 | `touchWorkOrderTx` **`:6022` tx'in İLK ifadesi** (yorum: "Fason completion yarışı (subcon #4)"). Sonra `otherInFlight` `:6030` → `applyDirectShipSplits` (`K` barkod `:516`, parent decrement claim `:588`) → dispatch claim `:6078` `{directShippedAt: null, cancelledAt: null}` → consumed claim `:6114` → `Q` DSK no `:6136` → `L` `touchOrderLinesTx` `:6233` → cap `:6280` → DSA create → recompute `:6298` → `freezeForSource` `:6305`. **Sıra W → R → K → D → Q → L → O** — WO-first, sipariş satırları sıralı. |
| 5 | "Bu sipariş satırının kalanı" küme kararı → `touchOrderLinesTx` TAM küme kilidi + cap kontrolü kilit altında. `test_race_conditions` B/D bunu **gerçekten paralel ölçüyor** (over-cover 2→1, çifte ateş 2→1). |
| 6 | `direct_shipments.shipmentNo` unique · CHECK `totalQty > 0`, `rollCount > 0` · DSA `(directShipmentId, orderLineId)` unique + CHECK `qty > 0`. |
| 7 | **HAYIR.** Üç ayrı claim + WO satır kilidi + sipariş satırı kilit protokolü + gerçek paralel bekçi. Denenen çizelgeler (iki doğrudan sevk aynı sevkten / doğrudan sevk ∥ fason kabul / doğrudan sevk ∥ WO iptali) hepsi WO satırında serileşiyor. |
| 8 | — (bulgu yok). Not: `createFasonShipChild` `initialQty`'yi de düşürüyor (K7a #18) — bu bir E-alanı semantik sorusu, yarış değil. |

### KYY-16 — Tambur geri alma (SINGLE / SINGLE_RESTORE / FULL / MANUAL)

| # | Cevap |
|---|---|
| 1 | **WO-durum-makinesi:** "iptal/devredilmiş iş emrine top diriltilemez" (`tambur-undo.service.ts:1250-1256`, `:1455-1461`; gerekçe `manualMove` disiplini — CLAUDE.md "canlı ama kimsenin okutamadığı top") · `currentQty ≤ initialQty` · kesim aritmetiği · adım/WO sayaçları |
| 2 | Her mod kendi tx'i: `applySingle` `:1058-1171`, `applySingleRestore` `:1221-1395`, `applyFull` `:1434-1692`. **tx ÖNCESİ:** `resolveContext` (`:384-513`) TAMAMEN havuzda — önizleme guard'ları burada. audit tx sonrası. |
| 3 | **EVET, korumasız.** `applySingleRestore:1245-1257` / `applyFull:1450-1461`: `tx.workOrderStep.findUnique` → `step.workOrder.status` → `if CANCELLED/SUPERSEDED throw`. Okunan alan `work_orders.status`, karar "geri almaya izin ver", yazılan alan `rolls.status/currentStepId` (+ `roll_movements`). Okuma ile yazma arasında ≥4 `await` var. |
| 4 | **WO satır kilidi ÜÇ MODDA DA HİÇ YOK.** Alınanlar: çocuk claim'i `:1260` `{id, CHILD_CANCELABLE, sack/ship/currentStep null}` count≠1→409 · parent claim `:1330` `{id, TAMBUR_CONSUMED}` count≠1→409. `workOrder.updateMany` `:1378` guard'ı YALNIZ `{status: COMPLETED}` — CANCELLED'ı 0 satırla **sessizce** geçiyor. **Edinim sırası Roll → (Step) → WO**, kardeş akışların TERSİ (`touchWorkOrderTx` hep İLK) → ayrıca ABBA. |
| 5 | Karar tek satırlık değil ("bu iş emri hâlâ canlı mı") ama iş emri satırı VAR — yani doğru araç satır kilidi (`touchWorkOrderTx`), advisory değil. Yok. |
| 6 | `WorkOrderStatus` geçişi için DB seddi YOK · `roll_variances.reversedAt/sourceRefId` · `roll_operations` `@@unique(rollId, workOrderStepId, operationType)` · `currentQty ≤ initialQty` CHECK'i YOK (undo `initialQty`'yi yukarı çekiyor + OVERAGE yazıyor). |
| 7 | **EVET → bulgu KYY-1-01 (K3, 8/16 tur).** |
| 8 | Geri alınan top `IN_PRODUCTION` + iptal edilmiş iş emrinin `SKIPPED` adımına bağlı kalıyor: Tambur finalize guard'ı CANCELLED WO'yu reddediyor, refakat kartı `VOIDED` → okutulamıyor; `roll_movements` satırı süresiz AÇIK kalıyor (WO iptalinin M-12 süpürmesi çoktan koştu) → WIP sayacı kalıcı şişiyor. Tek çıkış `rescueStuckRoll` (ayrı yetki). Saha bugün temiz (0 satır) — yani düzeltme **veri temizliği değil, kod işi**. |

### KYY-19 — Kurşun bypass (atama · dağıtım kapanışı · Tambur'dan kapanış · iptal · repoint)

| # | Cevap |
|---|---|
| 1 | "Bir kurşun adımında EN FAZLA BİR açık atama" · "milestone confirmation: dağıtım ön koşul DEĞİL" · movement kapanışı bir kez · `machineId` UYDURULMAZ |
| 2 | Her uç kendi tx'i; `assign` `kursun-bypass.service.ts:768-1000`, P2002 yakalama tx dışı `:993-999`; `completeFromDistribution` `:1368-…`; `completeUnassignedFromTambur` `:1966-2035`; `cancelAssignment` `:1173-1213`. |
| 3 | `assign`: EVET ama **tamamen kilit altında** — `findPendingBypassAssignmentTx(tx)` `:819`, bayrak `:826`, uygunluk `:836-887`, makine `:902`, `stationProperty` `:934`; yazım atomik claim `:955` ya da `create` `:966`. `completeUnassignedFromTambur`: pre-kontrolün **TOCTOU ikizi tx içinde tekrar** koşuyor (`resolveUnassignedTamburClosure(tx)` `:1983`) ve yorumu bekçinin bu dala erişemediğini açıkça yazıyor (`:1975-1982`). |
| 4 | `touchWorkOrderTx` **`:771` / `:1369` / `:1968` tx'in İLK ifadesi**. `cancelAssignment` WO kilidi ALMIYOR ama tek yazımı KBA satırının kendi claim'i (`:1176` `{id, completedAt: null, cancelledAt: null}`) → başka satıra dokunmuyor. `closeBypassMovementsTx` ham `UPDATE … WHERE exitedAt IS NULL RETURNING` = claim. |
| 5 | "Bu adımda açık atama var mı" phantom sorusu → **DB partial unique** `kursun_bypass_one_pending_per_step_uq (workOrderStepId) WHERE completedAt IS NULL AND cancelledAt IS NULL` son savunma; kaybeden P2002 → `p2002Mentions` `:994` ile anlamlı 409. |
| 6 | Yukarıdaki partial unique (şemada YOK, ham migration) · movement partial unique `one_open_per_roll_step` (`:1874`, `:2033` yakalanıyor) · `completedVia` enum. |
| 7 | **HAYIR.** Denenen çizelgeler: `assign ∥ assign` (partial unique + bekçi `test_kursun_bypass` EŞZ 2→1 satır) · `assign ∥ cancelAssignment` (KBA claim id-kapsamlı; kaybeden net 409) · `completeUnassigned ∥ completeUnassigned` (`test_kursun_unassigned_close` EŞZ 3→1) · `cancelAssignment ∥ voidStalePendingBypassAssignmentsTx` (iki updateMany, ikincisi 0 satır → "zaten iptal" 409). **Bu yol denetimdeki MODEL DESENDİR** (bkz. §4). |
| 8 | — (bulgu yok). |

### KYY-22 — İş emri kapanışı (kapanış dispozisyonu, 6 aksiyon) + otomatik kapanış

| # | Cevap |
|---|---|
| 1 | "WO terminal duruma bir kez geçer" · "kapanış kapsamı BİREBİR doğrulanır" · hard-block yalnız FASON · `roll_movements` `qtyOut = qtyIn` (dispozisyon) ≠ `qtyOut=0` (storno) |
| 2 | `withBarcodeRetry(() => prisma.$transaction(...))` `workorder.service.ts:3861-4103`; audit `:4086` + top başına `:4103`. Pre-tx: `stepIds/stepSeqById` `:3854-3855`, `resolveReasonCode`. |
| 3 | EVET ama **claim'den SONRA ve kilit altında**: in-flight küme `:3888`, fason guard `:3906`, kapsam birebir `:3935` (`count → 400`). Yorum `:3866-3868` bu sırayı ("claim ÖNCE, guard SONRA") gerekçesiyle yazıyor. |
| 4 | **`tx.workOrder.updateMany({where:{id, status: IN_PROGRESS}, data:{status: COMPLETED}})` `:3866` tx'in İLK ifadesi**, `count===0 → 409`. Sonra `applyRollDispositionsTx` çoklu claim `roll-disposition.helper.ts:239` count!==len→409 → `reserveRollBarcodes` `:296` → TRANSFER dalında `cloneWorkOrderTx` (`Q` IE no) + `createBatchTx` (8022). |
| 5 | "Bu adımlarda hâlâ canlı top var mı" küme kararı → WO satırı claim ile kilitli, ve toplar `currentStepId ∈ stepIds` üzerinden geliyor; kümeye EKLEME (`attachRolls`) da `touchWorkOrderTx`'i İLK alıyor → serileşiyor. Ayrıca kapsam **birebir** (`in-flight küme ≠ gönderilen liste → 400`). |
| 6 | WO enum geçişi için DB seddi YOK · `roll_barcode_counters` · `finalizedAt` trigger'ı · `kursun_bypass` partial unique. |
| 7 | **HAYIR (kendi başına)** — claim ilk ifade, guard'lar kilit altında. **AMA karşı taraf açık:** `tambur-undo` (KYY-16) bu satırı kilitlemeden `COMPLETED → IN_PROGRESS` diriltiyor ve `softDelete` ile birlikte KYY-1-01'i üretiyor. Çizelge KYY-1-01'de; kök neden `tambur-undo`da olduğu için bulgu orada. |
| 8 | — (bulgu yok, `related: KYY-1-01`). |

### KYY-25 — İş emri plan düzenleme (`update` · `replace` · **hedef özellik (W8)** · renk · en · toplu top düzeltme)

| # | Cevap |
|---|---|
| 1 | WO-08 "fiziksel taahhüt kilidi": COMPLETED adımda **uygulanmış** özellik plandan da toplardan da SİLİNEMEZ (`updateTargetProperties` yorumu `:5626-5628`: "bu endpoint eskiden kilitsizdi ve COMPLETED adımda uygulanmış özelliği hem WO'dan hem toplardan silebiliyordu") · `PLAN_CHANGE_FROZEN_STATUSES` (COMPLETED plan değişikliğine kapalı) |
| 2 | W6 `update` tx `workorder.service.ts:4773-4850`; W7 `replace` tx `:5246-5567`; **W8 `updateTargetProperties` tx `:5672-5721`** — ama tüm guard'lar `:5607-5670` arasında ve **hepsi `prisma` (havuz) ile**. Renk/en yolları havuz claim'i + ayrı `markTravelerCardDirtyTx` ifadesi. |
| 3 | **W6/W7: HAYIR** (F58 deseni — pre-tx havuz okuması + tx içi TAZE ikiz: `computeWorkOrderLocks(tx, id)` `:4779`, `assertTargetColorChange(tx)` `:4794`; W7 claim-kilit `:5252` `{id, status notIn terminal}`). **W8: EVET, korumasız.** Okunan: `computeWorkOrderLocks(prisma, id)` `:5627` (→ `lockedPropertyIds`, `applicablePropertyIds`) + `wo.targetProperties` `:5607`. Karar: `:5629-5645` "kaldırılabilir mi / eklenebilir mi". Yazılan: `workOrderTargetProperty` delete+create `:5674-5678` ve **`rollProperty` delete(FLAG)+create `:5700-5711`** (kapsam `TARGET_PROP_MUTABLE_STATUSES` → WAREHOUSE/A1_STOCK dahil, yani BİTMİŞ toplar). |
| 4 | **W8'de kilit YOK, claim YOK, WO statü guard'ı YOK.** `update`/`replace`/`changeTargetColor`/`changeWidth` hepsi `status notIn terminal` claim'i taşıyor; W8 taşımıyor. |
| 5 | Karar bir KÜME üzerinde ("bu adımlardan hangileri COMPLETED, hangi özellik uygulanmış") ve küme tx dışında okunuyor; kümeye eşzamanlı geçiş (adım COMPLETED olması / WO kapanması) hiçbir şekilde bloklanmıyor. |
| 6 | `work_order_target_properties (workOrderId, propertyId)` unique (yalnız mükerrer satırı engeller) · `roll_properties (rollId, propertyId)` unique · **kural için DB kısıtı YOK**. |
| 7 | **EVET → bulgu KYY-1-04 (K1).** |
| 8 | Fiziksel olarak zımparalanmış/işlenmiş topun kaydından özellik siliniyor → etiket, refakat kartı "İSTENEN ÖZELLİKLER" bloğu ve müşteri belgesi eksik basılıyor; kilidin var oluş sebebi tam bu vakaydı. |

### KYY-28 — Belge numarası üretimi (`nextDailySeq` + `withBarcodeRetry`) + top barkod sayacı

| # | Cevap |
|---|---|
| 1 | Q-DOC "belge numarası tekil" (boşluk BİLİNÇLİ serbest) · barkod tekil · **B.3 "aynı `clientToken` = aynı sonuç"** |
| 2 | Sayaç okuması çağıranın tx'i içinde ama kilitsiz; `withBarcodeRetry` **tx'i BAŞTAN** tekrar koşuyor (`utils/barcode-retry.ts:26-52`); bazı closure'larda tx-DIŞI iş var (`customer.service.ts:290-302`, `item.service.ts:225-232`, `order.service.ts:1942-1950`) → her retry'da tekrarlanıyor. |
| 3 | EVET (`nextDailySeq` = `max+1`, `utils/code-format.ts:95-107`) — ama karar yalnız "sıradaki numara", yazım DB unique'ine çarpıyor ve retry taze max okuyor. Meşru desen. |
| 4 | Belge no: kilit YOK (`Q` sınıfı), koruma DB unique + retry. Barkod: `roll-barcode.helper.ts:82-95` **tek ifadede** `INSERT … ON CONFLICT (day,type) DO UPDATE SET n = n + count RETURNING` → atomik; satır kilidi commit'e kadar tutuluyor (bilinçli, yorum `:60-72` iki koşullu kabul kriterini yazıyor: `T1<100ms VE T2=30/30`). Parti no `pg_advisory_xact_lock(8022,1)` `batch.service.ts:126` **ilk ifade**. |
| 5 | "Bugünün en büyük numarası" bir ARALIK sorgusu (phantom) → yalnız DB unique kapatıyor; retry olmadan bu bir bulgu olurdu, retry ile kapalı. |
| 6 | Her belge no `@unique`; `roll_barcode_counters` PK `(day,type)`. Biçim/sıra sürekliliği DB'de YOK (bilinçli). |
| 7 | **EVET — ama kök neden retry'ın SEÇİCİ OLMAMASI.** Ölçüldü: `grep -rn "isRetryable" src --include='*.ts'` → **yalnız `utils/barcode-retry.ts:23` (tanım) ve `:33` (kullanım)**; `withBarcodeRetry(`'in **28 çağrı yerinin hiçbiri** predicate geçmiyor. Sonuç: kalıcı bir iş-anahtarı çakışması (`clientToken`, `nameFold`, `traveler_cards_workOrderId_key`, `(receiptId,newRollId)`) 5 kez boşuna tekrarlanıyor ve `AppError.conflict("Barkod üretimi 5 denemede başarısız oldu")` ile bitiyor — teşhisi tamamen yanlış bir mesaj. Somut tezahürü ve K3 kanıtı **KYY-1-02**'de. |
| 8 | Bkz. KYY-1-02 (§2). Ayrıca H tarafı: KK1 seri girişte barkod sayacı satırı tx boyunca tutuluyor. |

### KYY-31 — Kartela sevk / kabul / stok düşümü / iptaller

| # | Cevap |
|---|---|
| 1 | "Bitmiş top aynı anda tek akışta" (`WAREHOUSE ∧ shipmentId null ∧ sackId null` → `AT_KARTELA`) · Swatch kart no tekil · `SwatchStockReduction` idempotent |
| 2 | `dispatch` `kartela.service.ts:281-339` (wBR+tx), `receive` `:609-690`, `reduceStock` `:1358-1405` + P2002 yakalama `:1408`; audit tx sonrası. Idempotency heuristiği `:223-246` **tx DIŞINDA**. |
| 3 | EVET ama **ikizli**: pre-check `:249-274` (WAREHOUSE/shipment/sack) ile tx-içi claim WHERE'i `:323-330` BİREBİR aynı; yorum `:315-322` "pre-check yarışı kapatmaz, bu WHERE kapatır" diyor. |
| 4 | Advisory YOK. `dispatch`: `nextKartelaDocSequence(tx)` `:284` (kilitsiz `Q`, `dispatchNo @unique` + wBR) → create → `freezeForSource` `:310` → **çoklu claim `:323` count!==len→409**. `receive`: sayaç → receipt → Swatch createMany → **çoklu claim `:678`** (AT_KARTELA→KARTELA_CONSUMED). `reduceStock`: **`SwatchStockReduction.create` (`clientToken` partial unique) tx'in İLK ifadesi = idempotency çapası** → FIFO `take N` → claim `:1395` count!==N→409 (kısmi → rollback, token boşa gitmez). |
| 5 | "Bu topların hiçbiri başka akışta değil" küme kararı → çoklu claim + count doğrulaması hepsi-ya-hiç. |
| 6 | `dispatchNo`/`receiptNo` unique · `Swatch.cardNumber`/`barcode` unique · `(dispatchId, rollId)`, `(receiptId, consumedRollId)` unique · `SwatchStockReduction.clientToken` partial unique · CHECK `qty > 0`. |
| 7 | **HAYIR.** Eşzamanlı iki özdeş `dispatch`: ikisi de heuristiği geçer (henüz açık sevk yok), tx'te kaybeden `claimed.count !== len` → 409 + TAM rollback (KartelaDispatch da doğmaz). Eşzamanlı iki `receive`: aynı, `AT_KARTELA` claim'i kapatıyor. `reduceStock`: token çapası + kısmi FIFO claim'i. **Zaman aşımı sonrası SIRALI retry'da** `dispatch` heuristikle cached döner; `receive`'de replay kimliği YOK ama toplar `KARTELA_CONSUMED` olduğu için claim 409 verir → mükerrer doğmaz (yalnız mesaj kötü) → B alanına not. |
| 8 | — (bulgu yok). Saha'da kartela akışı 0 kayıt (yalnız kod okuması + bekçi). |

### KYY-34 — Donmuş belge (`PrintedDocument`): dondur · geçersiz kıl · yeniden bas · GET lazy-init

| # | Cevap |
|---|---|
| 1 | DOC-03 "belge kaynağın mutasyonuyla AYNI tx'te donar" · `(docType, sourceId, version)` tekil · "yeniden sevkte `max+1`, sabit 1 DEĞİL" · ACTIVE tek sürüm |
| 2 | `freezeForSource` **çağıranın tx'i içinde** (`printed-document.service.ts:313-348`; çağıranlar `shipping:1881/:2214`, `subcontractor:1283/:2037/:5357/:6305`, `return:564/:920/:927`, `kartela:310/:428`). `reissue` tx `:670-693` ama `latest` `:652` + builder `:664` + `buildSnapshotEnvelope(prisma)` `:668` **havuzda**. **`getCurrent` lazy-init `:382-413` havuzda YAZIYOR** (GET yan etkili) ve audit `userId: undefined`. |
| 3 | EVET: `prev` `:332-336` (`findFirst version desc`) → karar `version = (prev?.version ?? 0) + 1` → `create` `:337`. Okuma ile yazma arasında `await` var. |
| 4 | **Kilit YOK, claim YOK** (`freezeForSource`). `reissueForSourceTx` `:747-767` ve public `reissue` `:674` **atomik claim** taşıyor (`{id, status: ACTIVE}` → SUPERSEDED, count 0 → 409) → o iki yol ACTIVE satırın yazma kilidinde serileşiyor ✓. `voidForSource` `:722-733` idempotent toplu güncelleme. |
| 5 | "Bu kaynağın en büyük versiyonu" phantom sorgusu → yalnız `(docType,sourceId,version)` unique kapatıyor. |
| 6 | `printed_documents (docType, sourceId, version)` **unique** ✓ · `sourceId` polimorfik (FK YOK) · `status` enum · `snapshot` Json immutable. |
| 7 | **EVET (dar) → bulgu KYY-1-06 (K1).** P2002 yakalaması YALNIZ lazy-init dalında (`:410-433`); `freezeForSource`'un kendisinde ve `reissueForSourceTx`'in içindeki `freezeForSource` çağrısında yok. Çizelge: T1 eski (belgesiz) bir sevkiyatın `GET …/current`'ını açar → lazy-init v1 yazmaya başlar; T2 aynı sevkiyatı storno sonrası yeniden sevk eder → `performDispatchTx` içinden `freezeForSource` `max+1 = 1` hesaplar → T1 önce commit ederse T2 P2002 alır → **tüm sevk tx'i geri sarılır**, kamyon kapıdayken operatör "Bu 'version' değeri zaten mevcut (unique constraint)" 409'u görür (`middlewares/error.middleware.ts:388-407`). |
| 8 | Veri bozulmuyor (atomik rollback) ama sevk anında anlaşılmaz bir hata; teşhis edilemez, tekrar denemeyle geçer. |

### KYY-37 — Ana veri oluşturma / düzenleme / kalıcı silme (kod tekilliği 8026 · ad seddi · GHR)

| # | Cevap |
|---|---|
| 1 | **"Kod bu sistemde KİMLİKTİR ve büyük/küçük harf bir kimlik farkı değildir"** (`helpers/code-unique.helper.ts:1-38`, saha vakası `SANTUK`/`santuk`, `sefa`/`SEFA`) · ad tekilliği (katlanmış) · GHR bağımlılık guard'ı |
| 2 | `item.service.ts:225-304` (wBR + tx); `subcontractor-management.service.ts:528-568` (M1), `:665-688` (M2), kategori `create` **tx bile YOK** (`:214-222` düz `prisma.*`); `base.service.ts:1017-1067` **tx AÇMIYOR** (yorumu `:1050-1057` bunu açıkça söylüyor). |
| 3 | **EVET, dördünde de.** `decideCodeUniqueness(code, candidates, texts)` — `candidates` bir `findMany`, karar "FREE / REACTIVATE / 409", yazım `create`/`update`. |
| 4 | `lockCodeScopeTx(tx, scope, code)` = `pg_advisory_xact_lock(8026, hashtext(scope|foldCodeForCompare(code)))`. **grep: tek çağrı yeri `item.service.ts:237`** ve orada tx'in İLK ifadesi, `tx.item.findMany` `:240`'tan ÖNCE ✓. Diğer üç çağıran (`subcontractor-management:202` kategori, `:512` firma, `base.service:1052` generic) **kilitsiz**. Ad tarafı: `assertNameNotDuplicate` (`base.service.ts:729`) da havuz check-then-act. |
| 5 | Karar "bu katlanmış koda/ada sahip başka satır var mı" = phantom → satır kilidi kapatmaz, advisory doğru araç; yalnız Item'da var. |
| 6 | `code` **@unique ama TAM EŞLEŞME** — katlanmış kod için DB'de karşılık **bilinçli YOK** (helper `:28-33`: 9 tarihsel satır sedi patlatırdı). Ad tarafında `<tablo>_nameFold_key` partial unique **YUMUŞAK KAPI** ve ortamlar AYRIŞMIŞ: |
| | `saha`: `customers_nameFold_key`, `subcontractors_nameFold_key`, `colors_nameFoldColor_key` **VAR**, `items_nameFold_key` **YOK** · `dev`: `items_nameFold_key` **VAR**, `colors_nameFoldColor_key` **YOK** (ölçüm aşağıda). Yani **prod'da Item ad tekilliğinin DB seddi hiç yok** ve `items` en çok yaratılan ana veri (mobil `mobile:kk1-desen` → `quickCreateFabric` dahil). |
| 7 | **EVET → bulgu KYY-1-03 (K3, 12/12; kilitli kontrol grubu 0/6).** |
| 8 | Aynı kimliği taşıyan iki kayıt: etikete basılan kod artık tekil değil, dış eşleşme (müşteri kodu/ihracat kodu) belirsizleşiyor, mükerrer paneli işi büyüyor. Saha'da bugün `items` içinde **8 katlanmış-kod grubu** ve **1 katlanmış-ad grubu** var. |

```
$ audit/tools/sql-saha.sh -Atc "SELECT tablename||' | '||indexname FROM pg_indexes WHERE indexname IN
   ('items_nameFold_key','customers_nameFold_key','subcontractors_nameFold_key','colors_nameFoldColor_key');"
customers | customers_nameFold_key
colors    | colors_nameFoldColor_key
subcontractors | subcontractors_nameFold_key      ← items_nameFold_key YOK

$ audit/tools/sql-dev.sh  (aynı sorgu)
customers | customers_nameFold_key
items     | items_nameFold_key
subcontractors | subcontractors_nameFold_key      ← colors_nameFoldColor_key YOK

$ audit/tools/sql-saha.sh -Atc "SELECT count(*) FROM (SELECT upper(code) FROM items WHERE code IS NOT NULL
   GROUP BY 1 HAVING count(*)>1) t;"                       → 8
$ ... "SELECT count(*) FROM (SELECT \"nameFold\" FROM items WHERE \"mergedIntoId\" IS NULL
   GROUP BY 1 HAVING count(*)>1) t;"                       → 1
$ ... subcontractor_categories aynı sorgu                   → 0
```

### KYY-40 — Kimlik: giriş · lockout · oturum defteri (8024) · çıkış/revoke

| # | Cevap |
|---|---|
| 1 | "aynı (kullanıcı, cihaz tipi) için politika `kick` iken tek aktif oturum" · lockout sayacı · `jti` tekil · token iptali fail-closed |
| 2 | `openLoginSession` tx `session-registry.service.ts:72-119`. Lockout tamamen bellekte (`login-lockout.ts:24`), rezervasyon `auth.controller.ts:118-128/202-213/281-292` **bcrypt'ten ÖNCE** (doğru sıra — `bcryptjs` saf JS, event loop'ta). |
| 3 | EVET ama kapalı: `notify` ön-kontrolü (`session.findFirst` `:84`) ve `kick` (`updateMany` `:110`) **kilit altında**; yorumu `:66-71` eskiden tx dışında olduğunu ve neyi delmediğini yazıyor. |
| 4 | `pg_advisory_xact_lock(8024, hashtext(userId|deviceType))` **`:79` tx'in İLK ifadesi**, `findFirst` `:84`'ten ÖNCE ✓. Namespace 2-argümanlı ve ayrık (`:73-78` gerekçeli). |
| 5 | "Bu kullanıcı+cihaz tipinde aktif oturum var mı" phantom → advisory doğru araç, doğru sırada. |
| 6 | `sessions.jti` unique · `users.quickPin` unique · lockout için DB karşılığı YOK (bellek). |
| 7 | **HAYIR.** Lockout `reserveLoginAttempt` senkron (await yok) → Node'da atomik; tek process invariantı altında doğru. Oturum defteri kilitli. **Bekçi boşluğu duruyor** (8024 için paralel/advisory sondası 0 — K11 H-2). |
| 8 | — (bulgu yok). G alanına ait duran konular: 30 günlük bearer, prod `sameTypeSessionPolicy=off`, kimliksiz `mobile-users`, IP-anahtarlı bellek lockout, `verifyToken`'ın `expiresAt`'i okumaması (saha'da 10 satır `expiresAt < now() ∧ revokedAt NULL`). |

### KYY-43 — Feature-flag / SystemSetting yazımı

| # | Cevap |
|---|---|
| 1 | SYS-01 "bayrak değeri tek gerçek" · dört kapı (SystemSetting tipi + sanitize + controller Zod + Electron aynası) · anahtar-kapsamlı yetki guard'ı fail-closed |
| 2 | **`setFeatureFlags` `system-setting.service.ts:1245-…` TRANSACTION AÇMIYOR** — ~50 bağımsız `this.set()` çağrısı, her biri kendi upsert'i + kendi audit'i. `set()` `:1032-1070` (findUnique yalnız audit `oldData` için; asıl yazım `upsert` = atomik) ve **tek invalidate noktası `:1067`**. |
| 3 | `set()` içinde HAYIR (upsert atomik). Ama **istemci TAM nesne gönderiyor** (`documentsConfig`/`travelerCardConfig`/`companyLetterhead` ve tüm skaler bayraklar) → oku-değiştir-yaz döngüsü İSTEMCİDE. |
| 4 | Kilit YOK, claim YOK. `documentsLogo` için süreç-içi kuyruk var (`:1105-1112`) — doğru refleks ama **yalnız orada**. |
| 5 | Karar tek anahtar değil, "bayrak nesnesinin tamamı" → küme kararı; hiçbir serileştirme yok. |
| 6 | `system_settings` PK `key` (doğal) · `value` Json · değer aralığı/biçimi için DB kısıtı YOK. |
| 7 | **EVET → bulgu KYY-1-07 (K1).** İki admin: A `Ayarlar → Sevkiyat` sekmesini 10:00'da açar; B 10:02'de `Ayarlar → KK1`'den `kk1DuplicateGuardEnabled`'ı AÇAR; A 10:05'te kendi sekmesini kaydeder → A'nın gövdesi 10:00'daki TAM nesnedir → `kk1.duplicateGuardEnabled = false` geri yazılır, kimse görmez. Ek olarak `setFeatureFlags` ortasında bir hata (havuz/DB) kısmi yazılmış bir bayrak kümesi bırakır ve yanıt 500'dür — panel "kaydedilmedi" der. |
| 8 | KK1 mükerrer tuzağı, kurşun bypass rejimi, `fason.shrinkWarnEnabled`, oturum ömrü gibi **koruma** bayrakları sessizce geri dönebilir; sahada bunun tek izi anahtar başına audit satırıdır (6 ayda arşivleniyor). |

### KYY-46 — Yedek alma / doğrulama / retention / offsite

| # | Cevap |
|---|---|
| 1 | OPS "aynı anda tek yedek koşar" (tek-process invariantına yaslanıyor) · "yarım dosya nihai adı ALMAZ" (`.part` → doğrula → `rename`) · retention `MIN_KEEP=3` |
| 2 | Tx yok — FS + child process. DB'ye yalnız `SystemSetting` damgası (`jobs/backup-scheduler.ts:53`, **`set()` DIŞINDAN** doğrudan `prisma.systemSetting.upsert`) + audit. `void runBackupJob()` → 202. |
| 3 | EVET: `if (running) return "Zaten bir yedek işlemi sürüyor."` `backup.service.ts:199-209` → `running = true` `:221`. Okuma ile yazma arasında `await` YOK (senkron) → **tek process içinde doğru**. |
| 4 | Kilit YOK. Koruma tamamen **process-local `let running`** `:162` ve yorumu `:147` bunu açıkça tek-process invariantına bağlıyor. Dosya adı `stamp(new Date())` `:222` — **saniye çözünürlüklü**; `.part` dosyası `O_EXCL` ile açılmıyor. |
| 5 | Karar "şu an başka bir yedek koşuyor mu" — süreç dışı aktörler (ikinci Node süreci, Windows Görev Zamanlayıcı `yedekle.ps1`) bu kümede görünmüyor. |
| 6 | DB kısıtı yok/uygulanamaz (dosya sistemi). |
| 7 | **EVET → bulgu KYY-1-05 (K2, dev defterinde FİİLİ İHLAL).** |
| 8 | 2026-08-23'te aynı milisaniyede İKİ `BACKUP_COMPLETED` (iki ayrı dosya); 2026-08-24 03:27:18'de **aynı dosya adı için** 8 ms arayla `BACKUP_FAILED (rename ENOENT)` + `BACKUP_COMPLETED`. Yani (a) gece iki kez `pg_dump` koştu, (b) biri diğerinin `.part`ını devraldı ve **arıza defteri yalan söyledi** — "yedek başarısız" satırı var ama yedek alındı, ve tersi de mümkün (bir sürecin hâlâ yazdığı `.part` diğerinin `pg_restore --list` doğrulamasından geçebilir). |

```
$ audit/tools/sql-dev.sh -Atc "SELECT to_char(\"createdAt\",'YYYY-MM-DD HH24:MI:SS.MS')||' | '||action||' | '||
    left(\"newData\"::text,120) FROM system_logs WHERE action IN ('BACKUP_COMPLETED','BACKUP_FAILED')
    ORDER BY \"createdAt\" DESC LIMIT 6;"

2026-08-24 03:27:18.042 | BACKUP_COMPLETED | {"file": "tekserp_20260824_032716.dump", ...}
2026-08-24 03:27:18.034 | BACKUP_FAILED    | {"file": null, "message": "Yedek hatası: ENOENT: no such file or
                                              directory, rename '/Users/oad/tekserp-backups/tekserp_20260824_032716.dump.part' -> ..."}
2026-08-23 03:14:24.752 | BACKUP_COMPLETED | {"file": "tekserp_20260823_031422.dump", ...}
2026-08-23 03:14:24.752 | BACKUP_COMPLETED | {"file": "tekserp_20260823_031423.dump", ...}   ← AYNI ms, İKİ yedek
```

### KYY-49 — Hazır sebep kataloğu (`ReasonPreset`) + senkron önbellek + `resolveReasonCode`

| # | Cevap |
|---|---|
| 1 | "`code` RAPOR ANAHTARIDIR ve ASLA değişmez" · `(kind, code)` tekil · "son aktif satır gizlenemez" · sıralama kalıcı ve tam (`reorder` TÜM id'leri ister) |
| 2 | `create`/`update` havuz; `duplicate` tx `reason-preset.service.ts:464-484` ama **`nextFreeCode(...)` `:463` tx DIŞINDA**; `reorder` batch tx `:505-513`; `refreshReasonPresetCache()` bellek; audit tx sonrası. |
| 3 | EVET ×2: (a) `nextFreeCode` = "boş kod bul" okuması, karar, sonra `create` — arada `await` var. (b) `reorder` `:497-503` küme eşitliği kontrolü (`ids.length !== known.size`) tx DIŞINDA. |
| 4 | Kilit YOK, claim YOK. `duplicate`'in `sortOrder` kaydırması `updateMany {kind, sortOrder gt src.sortOrder} increment 1` `:466` — **idempotent DEĞİL**. |
| 5 | Karar "bu kind'da hangi kodlar boş / kaç satır var" küme kararı; hiç serileştirilmiyor. |
| 6 | `reason_presets (kind, code)` unique ✓ (kod çakışmasını son savunma olarak kapatıyor) · `(kind, sortOrder)` unique **YOK**. |
| 7 | **EVET → bulgu KYY-1-08 (K1).** İki süpervizör aynı sebebi eşzamanlı çoğaltırsa: farklı etiket → farklı kod → ikisi de geçer, **ikisi de `src.sortOrder + 1` yazar** ve kaydırma İKİ kez uygulanır → aynı `sortOrder`'da iki satır + listede 2 boşluk; aynı etiket → aynı `nextFreeCode` → P2002 → `withBarcodeRetry` YOK, error middleware 409 "Bu 'code' değeri zaten mevcut". `reorder ∥ duplicate`: reorder'ın id kümesi bayatlar, yeni satır sıraya girmez. |
| 8 | Tambur "Bitir → sebep" adımında liste sırası belirsizleşir (aynı `sortOrder`'da iki satır → PG sıra garantisi yok); 2026-08-26'da tam bu ekran için yazılan sürükle-bırak sıralama sessizce bozulur. Metraj/stok etkisi YOK. |

---

## 2. Bulgular

### [KYY-1-01] `tambur-undo` iş emri satırını hiç kilitlemiyor: iş emri iptaliyle yarışta top, İPTAL EDİLMİŞ iş emrinin SKIPPED adımına IN_PRODUCTION olarak diriltiliyor

| Şiddet | **S1** | Kategori | **A.1** (check-then-act) | Öncelik | **P0** | Modül | Üretim / Tambur | Kanıt seviyesi | **K3** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Tambur geri alma (üç modu da) iş emrinin canlı olup olmadığını düz bir `findUnique` ile okuyup karar veriyor, ama o satırı **kilitlemiyor**. Aynı saniyede planlamacı iş emrini iptal ederse: geri alma kapıyı geçer (iptal henüz commit etmemiştir), iptal commit eder, geri alma da commit eder. Sonuç, kodun kendi yorumunun "asla olmamalı" dediği durumdur (`tambur-undo.service.ts:1417-1419`, `manualMove` disiplini): top `IN_PRODUCTION`, `currentStepId` = **iptal edilmiş** iş emrinin **SKIPPED** adımı. Tambur finalize guard'ı bu iş emrini reddeder, refakat kartı `VOIDED` olduğu için okutulamaz → top ne üretimde ilerler ne depoya iner. **İki kullanıcı da "başarılı" yanıtı alır.**

**Kanıt.**

`Teks-Erp/src/services/tambur-undo.service.ts:1245-1257` — guard (SINGLE_RESTORE; `applyFull:1450-1461` birebir aynı):
```ts
      if (stepId) {
        step = await tx.workOrderStep.findUnique({
          where: { id: stepId },
          select: { id: true, workOrder: { select: { id: true, workOrderNumber: true, status: true } } },
        });
        if (!step) throw AppError.notFound("Tambur adımı bulunamadı");
        if (
          step.workOrder.status === WorkOrderStatus.CANCELLED ||
          step.workOrder.status === WorkOrderStatus.SUPERSEDED
        ) {
          throw AppError.conflict("İş emri iptal/devredilmiş — iş emrine geri alınamaz");
        }
      }
```
`…:1329-1348` — yazım (guard'la aynı tx, arada 4+ `await`):
```ts
      const revived = await tx.roll.updateMany({
        where: { id: parentId, status: RollStatus.TAMBUR_CONSUMED },
        data: { status: revivedStatus, currentStepId: stepId, currentQty: { increment: restored }, … },
      });
```
`…:1375-1382` — WO'ya tek dokunuş, guard'ı YALNIZ `COMPLETED` için: CANCELLED'da `count = 0` ve **hata YOK**:
```ts
        const woRevived = await tx.workOrder.updateMany({
          where: { id: step.workOrder.id, status: WorkOrderStatus.COMPLETED },
          data: { status: WorkOrderStatus.IN_PROGRESS },
        });
```
**Koruma kontrolü (nereye bakıldı):** `grep -rn "touchWorkOrderTx" src/services/tambur-undo.service.ts` → **0 sonuç**. `grep -rn "pg_advisory" src/services/tambur-undo.service.ts` → **0 sonuç**. Şemada `WorkOrderStatus` geçişi için trigger/CHECK yok (`K2a`); `rolls.currentStepId` FK'sı adımın canlılığına bakmaz. Karşı taraf (`workorder.service.ts:3387` `softDelete` claim'i) WO satırını **İLK** alıyor — yani kilit sırası da terstir (aşağıya bak).

**Çakışma senaryosu.**
```
T1  tambur-undo.applySingleRestore (operatör: "kumaş elimde, iş emrine geri al")
T2  workorder.softDelete           (planlamacı: "bu iş emri iptal")

t0  T1  resolveContext (HAVUZ)                       → wo.status = IN_PROGRESS  ✓
t1  T1  BEGIN; tx.roll.findUnique(child)             [await]
t2  T2  BEGIN; workOrder.updateMany {id, status notIn terminal} → CANCELLED   (WO satır kilidi T2'de)
t3  T1  tx.rollOperation.findFirst → stepId          [await]
t4  T1  tx.workOrderStep.findUnique → wo.status      → READ COMMITTED: T2 commit ETMEDİ → IN_PROGRESS ✓ KAPI GEÇİLDİ
t5  T2  in-flight dispozisyonu (parent TAMBUR_CONSUMED → dokunulmaz),
        UPDATE roll_movements SET exitedAt = now()   (M-12 süpürmesi),
        workOrderStep → SKIPPED, kartlar VOIDED;  COMMIT
t6  T1  roll.updateMany(child → CANCELLED)                                  ✓
t7  T1  rollMovement.create {rollId: parent, workOrderStepId: step,
                             notes: "TAMBUR_UNDO_REOPEN"}   ← M-12 çoktan koştu, bu satır SÜRESİZ AÇIK
t8  T1  roll.updateMany {id: parent, status: TAMBUR_CONSUMED}
        → status = IN_PRODUCTION, currentStepId = step                      ✓
t9  T1  workOrder.updateMany {id, status: COMPLETED} → count = 0 (WO CANCELLED) → SESSİZ
t10 T1  COMMIT   →  iki istek de 200
SONUÇ: rolls.status='IN_PRODUCTION' ∧ currentStep.workOrder.status='CANCELLED' ∧ step.status='SKIPPED'
       + kapanmayan roll_movement.
```
⚠️ `softDelete`'in toplu süpürmesi bu topu **kurtaramaz**: `workorder.service.ts:3513-3523` `entrySource: { not: SUBCONTRACTOR_RETURN }` süzgeci taşıyor ve Tambur'un kaynağı tipik olarak fason dönüşü açık kumaştır.

**failure_mode.** IE2608260007'nin Tambur adımında 100 m'lik fason dönüşü açık kumaş kesilmiş, kapanmış. Operatör 14:32:10.0'da "İş emrine geri al" der; planlamacı 14:32:10.006'da aynı iş emrini iptal eder. Her ikisi de yeşil toast alır. Ertesi gün: top Envanter'de "Üretimde" görünür, Tambur'da okutulunca "iş emri iptal edilmiş" der, iş emri kartı VOIDED olduğu için hiçbir istasyondan okutulamaz; Üretim Akışı panosunda 100 m kalıcı WIP olarak sayılır. Tek çıkış `roll:manual-adjust` yetkisiyle "Kurtar".

**Veride fiili ihlal (K2).** Arandı, **0**. Saha kopyasında (2026-08-25) bu parmak izi yok:
```
$ audit/tools/sql-saha.sh -Atc "SELECT count(*) FROM rolls r JOIN work_order_steps s ON s.id=r.\"currentStepId\"
   JOIN work_orders w ON w.id=s.\"workOrderId\"
   WHERE r.status='IN_PRODUCTION' AND w.status IN ('CANCELLED','SUPERSEDED','COMPLETED');"      → 0
$ ... "SELECT count(*) FROM roll_movements m JOIN work_order_steps s ON s.id=m.\"workOrderStepId\"
   JOIN work_orders w ON w.id=s.\"workOrderId\"
   WHERE m.\"exitedAt\" IS NULL AND w.status IN ('CANCELLED','SUPERSEDED');"                     → 0
```
Yani düzeltme **veri temizliği değil, kod işidir**; bugün şanslıyız.

**Repro (K3).** `Teks-Erp/scripts/audit_repro_KYY-1-01.ts` → `audit/repro/KYY-1-01.log`
16 turun **8'inde** değişmez bozuldu (offset 0-9 ms bandında; 12-18 ms'de geri alma kazanıyor ve o zaman iptal doğru biçimde "topu fasonda" diye 409 alıyor — yani doğru davranış VAR, yarış onu deviriyor):
```
❌ tur 4 (offset 4ms) DEĞİŞMEZ BOZULDU — wo=CANCELLED step=SKIPPED top=IN_PRODUCTION currentStep=ADIM açıkHareket=1 | iptal=ok geriAl=ok
──────── ÖZET ────────  tur: 16 · ihlal: 8 · geri alma 409: 4 · iptal reddi: 4
```

**İş etkisi.** Fiziksel olarak elde olan kumaş sistemde çıkmaza düşer; hiçbir istasyon okutamaz, envanter ve Üretim Akışı panosu onu üretimde sayar. Süpervizör müdahalesi (ayrı yetki) gerektirir ve olay hiçbir yerde alarm üretmez.

**Öneri (2. tur için).** `applySingle` / `applySingleRestore` / `applyFull` tx'lerinin **İLK ifadesi** `touchWorkOrderTx(tx, workOrderId)` olsun (KYY-19 `assign` ve KYY-22 `completeWorkOrder`'ın deseni). Bu **iki** sorunu birden kapatır: (a) WO durumu tüm tx boyunca pin'lenir, guard gerçek olur; (b) **kilit sırası kardeşlerle hizalanır** — bugün `tambur-undo` roll satırlarını önce, WO satırını (COMPLETED dalında) EN SONDA kilitliyor; `attachRolls` (`workorder.service.ts:4444`) ve `completeWorkOrder` WO'yu İLK alıyor → aynı topa dokunan iki akış PostgreSQL deadlock detector'ına düşebilir (kullanıcı 500 alır). `workOrderId` `stepId`'den önce çözülmeli; adım yoksa (depo kesimi) kilit gerekmez. Ayrıca `workOrder.updateMany {status: COMPLETED}` dalında `count===0` iken **statüyü tekrar okuyup CANCELLED ise throw** etmek ucuz bir ikinci hat. Migration YOK, izin YOK, APK YOK.

**Kabul kriteri.** `audit_repro_KYY-1-01.ts` 16/16 turda `ihlal: 0` ve tüm turlarda ya "geri alma 409" ya "iptal reddi" görülür; `test_tambur_undo`'ya §12 olarak eklenir (negatif sonda: `touchWorkOrderTx` satırı silinince kırmızı).
**Efor.** 0,5 gün (kod) + 0,5 gün (bekçi).
**Önceki defter.** `audit/FINDINGS.jsonl`'de birebir karşılık yok; K3b H-1 (ABBA sıra haritası) ve K10 H-10 aynı kök nedene işaret ediyor — bu bulgu onların ölçülmüş hâli.

---

### [KYY-1-02] Fason kısmi kabulde aynı `clientToken` eşzamanlı gelince idempotent replay yerine "Barkod üretimi 5 denemede başarısız oldu" 409'u dönüyor — sonuçta aynı teslimat iki kez düşülüyor

| Şiddet | **S1** | Kategori | **B.3** (API idempotency) + **A.4** | Öncelik | **P0** | Modül | Fason | Kanıt seviyesi | **K3** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `clientToken` kısmi fason kabulünün **TEK** replay kimliğidir (küme-eşitliği guard'ı kısmi teslimatta çalışamaz — aynı top ikinci teslimatta meşru olarak tekrar gelir). Token kontrolü tx DIŞINDA yapıldığı için, tablet zaman aşımından sonra aynı token'la yeniden gönderdiğinde ve ilk istek hâlâ sunucudayken ikinci istek kontrolü geçer, `subcontractorReceipt.create`'e kadar gelir ve `clientToken` unique'ine çarpar. `withBarcodeRetry`'a hiçbir çağrı yerinde `isRetryable` predicate'i verilmediği için bu **kalıcı** çakışma 5 kez tekrarlanır ve `AppError.conflict("Barkod üretimi 5 denemede başarısız oldu, lütfen tekrar deneyin.")` ile biter. Operatör barkodla ilgisi olmayan bir hata görür, kabulü **elle yeniden girer** (yeni token) ve aynı fiziksel teslimat ikinci kez düşülür.

**Kanıt.**

`Teks-Erp/src/services/subcontractor.service.ts:2348-2370` — token kontrolü **havuzda, tx'ten önce**:
```ts
    if (data.clientToken) {
      const tokenHit = await prisma.subcontractorReceipt.findUnique({
        where: { clientToken: data.clientToken }, include: { … } });
      if (tokenHit) {
        if (tokenHit.cancelledAt) throw AppError.conflict("… İPTAL edilmiş …", { code: "RECEIPT_CANCELLED" });
        return { success: true, data: tokenHit, message: `Mal kabul zaten yapılmış (idempotent retry). Makbuz: ${tokenHit.receiptNo}` };
      }
    }
```
`…:2677-2681` — sarmalayıcı ve kilit:
```ts
    const result = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
      await touchWorkOrderTx(tx, data.workOrderId);
```
`…:2723-2734` — KISMİ modda toplar fasonda KALDIĞI için bu kapı ikinci isteği **durdurmaz** (`freshReturns.length === data.returns.length`).
`…:2787-2800` — çakışma noktası, roll claim'lerinden (`:2857`, `:2879`) ÖNCE:
```ts
      const receipt = await tx.subcontractorReceipt.create({
        data: { receiptNo, clientToken: data.clientToken ?? null, … } });
```
`Teks-Erp/src/utils/barcode-retry.ts:26-52` — predicate yoksa **TÜM** P2002 retry ediliyor; ölçüm: `grep -rn "isRetryable" src --include='*.ts'` → **yalnız `barcode-retry.ts:23` ve `:33`**; `withBarcodeRetry(` 28 çağrı yerinin hiçbiri 3. argümanı geçmiyor.
`Teks-Erp/src/middlewares/error.middleware.ts:388-407` — predicate eklenseydi bile mesaj "Bu 'clientToken' değeri zaten mevcut" olurdu; doğru cevap **cached makbuz**tur.

**Koruma kontrolü (nereye bakıldı):** `subcontractor_receipts.clientToken` DÜZ unique (şema) ✓ ama kod bu P2002'yi KK1'deki gibi (`inventory.service.ts:951-1007`) yakalayıp mevcut kaydı DÖNDÜRMÜYOR; tx içinde token'a bakan ikinci bir okuma yok; advisory lock yok; küme-eşitliği guard'ı `:2402-2410` kısmi makbuzu bilerek atlıyor (`if (prior.items.some((i) => i.isPartial)) continue;`).

**Çakışma senaryosu.**
```
T1  tablet → POST /api/subcontractor/receive  {clientToken: X, remainderStays: true, returns:[{roll R, receivedQty 120}]}
T2  aynı tabletin çevrimdışı kuyruğu, ağ zaman aşımından sonra AYNI token X ile yeniden gönderiyor
    (mobil sözleşme: sonucu BELİRSİZ bırakan hatada token YAPIŞIR — entryAttempt.ts)

t0  T1  tokenHit = null (havuz)               t0' T2  tokenHit = null (havuz)   ← ikisi de geçti
t1  T1  BEGIN; touchWorkOrderTx(WO)           t1' T2  BEGIN; touchWorkOrderTx(WO) → BLOKE (WO satırı T1'de)
t2  T1  freshReturns ✓ → receipt.create(X) → roll decrement 300→180 → COMMIT
t3  T2  kilit serbest → freshReturns: R HÂLÂ AT_SUBCONTRACTOR (kısmi!) → geçer
t4  T2  receipt.create(clientToken = X)  → P2002 (subcontractor_receipts_clientToken_key)
t5      withBarcodeRetry: predicate YOK → 5 deneme, her biri tam tx (WO kilidi + ~30 sorgu)
t6      → 409 "Barkod üretimi 5 denemede başarısız oldu, lütfen tekrar deneyin."
t7  operatör 4xx gördü → token YAPIŞMAZ (kesin 4xx kuralı) → kuyruk denemeyi düşürür
t8  operatör kabulü ELLE yeniden girer (YENİ token) → hiçbir guard'a takılmaz
SONUÇ: 120 m'lik TEK teslimat İKİ kez düşüldü → R.currentQty 300 → 60 (180 olmalıydı),
       2 aktif makbuz, 2 doğan top, 2 çekme sapması satırı.
```

**failure_mode.** Boyahaneden 300 m'lik topun 120 m'si döndü, kalanı fasonda. Tablet kabul gönderdi, ağ düştü, kuyruk aynı token'la tekrar gönderdi. Operatör "Barkod üretimi 5 denemede başarısız oldu" görür (barkodla ilgisi yoktur), kabulü elle yeniden girer. Sistem artık 300 m'lik topun 240 m'sinin döndüğünü, 60 m'sinin fasonda kaldığını sanır; boyahaneye 120 m fazla borç yazılır, fason karnesindeki çekme oranı bozulur, iki adet 120 m'lik hayalet top üretime girer.

**Veride fiili ihlal (K2).** Arandı; saha'da bu yolun kullanım hacmi çok düşük: 143 makbuzun **yalnız 2'si** `clientToken` taşıyor, kısmi kalem **1** (`subcontractor_receipt_items.isPartial = true`). Yani ihlal henüz doğmamış — ama kısmi kabul 2026-08-19'da açıldı ve tablet APK'sı token göndermeye yeni başlıyor; **hacim arttıkça kesinleşir**.
```
$ audit/tools/sql-saha.sh -Atc "SELECT count(*), count(\"clientToken\") FROM subcontractor_receipts;"   → 143|2
$ ... "SELECT count(*) FROM subcontractor_receipt_items WHERE \"isPartial\"=true;"                      → 1
```

**Repro (K3).** `Teks-Erp/scripts/audit_repro_KYY-1-02.ts` → `audit/repro/KYY-1-02.log` — **6/6 tur**, tekrar edilebilirlik %100:
```
❌ tur 1 YANILTICI 409 — makbuz=1 | ERR(409):Barkod üretimi 5 denemede başarısız oldu … || OK:Fason kabul tamamlandı: FK2808260001
   ↳ ELLE yeniden giriş (yeni token): kalan=60 m (beklenen 180), aktif makbuz=2, doğan top=2
──────── ÖZET ──────── tur: 6 · YANILTICI barkod-409'u: 6 · doğru idempotent replay: 0 · ÇİFT DÜŞÜLEN teslimat: 6
```

**İş etkisi.** Fason cari mutabakatı (giden/dönen metraj), çekme oranı karnesi ve ham stok aynı anda bozulur; hata sessiz değil ama **teşhisi imkânsız** olduğu için düzeltici davranış (elle yeniden giriş) hasarı büyütür.

**Öneri (2. tur için).** İki bağımsız düzeltme, ikisi de küçük:
1. **Token P2002'sini KK1 gibi yakala.** `receive`'in dış catch'ine `err.code === "P2002" && meta.target ⊇ clientToken` dalı ekle → `subcontractorReceipt.findUnique({clientToken})` → `cancelledAt` ise 409 `RECEIPT_CANCELLED`, değilse **cached makbuzu `success:true` ile dön** (KK1 `inventory.service.ts:951-1007` deseninin birebir ikizi; `existing.cancelledAt` kontrolü ZORUNLU, yoksa beceri §8'in "en pahalı hata"sına düşülür).
2. **`withBarcodeRetry`'a predicate geçir.** En az `receive`, `dispatch`, `executeDirectShip`, `completeWorkOrder`, `attachRolls`, `createShipment` çağrı yerlerinde `isRetryable: (e) => !p2002Mentions(e, /clientToken|nameFold|one_pending_per_step|one_open_per_roll_step/i)`. Tercihen tersi: **allowlist** (yalnız `*No`/`barcode`/`cardNumber` sıra çakışmaları retry edilir) — bugün 28/28 çağrı yeri fail-open. Ayrıca tükenme mesajı çağrı bağlamını taşımalı (bugün "Barkod üretimi" diyor, oysa fason kabulünde barkod hiç üretilmemiş olabilir).
Migration YOK, izin YOK, APK YOK — düzeltme tamamen sunucuda; eski APK'lar düzeltmeden **yararlanır**.

**Kabul kriteri.** `audit_repro_KYY-1-02.ts` 6/6 turda `doğru idempotent replay: 6`, `ÇİFT DÜŞÜLEN teslimat: 0`; `test_fason_receive_idempotency_concurrency`'ye "aynı token paralel → tam 1 makbuz, İKİSİ de success, biri 'idempotent retry' mesajı" sondası eklenir; ayrı bir bekçi `withBarcodeRetry` çağrı yerlerinin predicate taşıdığını AST/metin ile doğrular (`test_fason_open_dispatch_single_source` kalıbı).
**Efor.** 1 gün (kod + iki bekçi).
**Önceki defter.** `audit/FINDINGS.jsonl`'de karşılığı yok; K3a #9 ve K6 §2.4 hipotezinin ölçülmüş hâli (ve K6'nın "predicate'li yalnız 4" sayısını **düzeltiyor**: 0).

---

### [KYY-1-03] Katlanmış kod tekilliği kilidi dört çağırandan yalnız birinde: eşzamanlı `sefa`/`SEFA` ikisi de geçiyor, kimlik ikizi sessizce doğuyor

| Şiddet | **S2** | Kategori | **A.1** (+ B.1 son savunma yokluğu) | Öncelik | **P3** | Modül | Ana veri | Kanıt seviyesi | **K3** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `code-unique.helper.ts`'in kendi docstring'i bu yarışı adıyla tarif ediyor ve çözümünü de yazıyor: `lockCodeScopeTx` (8026). Ama **grep ile ölçüldü: kilit yalnız `item.service.ts:237`'de alınıyor**. `decideCodeUniqueness`'in diğer üç çağıranı (`subcontractor-management.service.ts:202` fason kategorisi, `:512` fason firma, `base.service.ts:1052` — QualityGrade/PeripheralDevice/CustomerBranch dahil tüm generic yol) kilitsiz; katlanmış kod için DB'de karşılık gelen bir UNIQUE de **bilinçli olarak yok**. Sonuç: iki eşzamanlı istek `sefa` ve `SEFA`yı yan yana yazabiliyor — ki bu tam olarak helper'ın var olma sebebi olan saha vakasıdır.

**Kanıt.**

`Teks-Erp/src/services/helpers/code-unique.helper.ts:63-69` — sorunun ve çözümün kendi tarifi:
```
 * NEDEN GEREKLİ: tam-eşleşme yarışını bugün DB'deki `@unique` kapatıyor
 * (P2002 → 409). KATLANMIŞ tekillikte DB'de karşılık YOK (bilinçli, yukarı bak)
 * → eşzamanlı `sefa2` + `SEFA2` istekleri guard'ı ikisi de geçer, P2002 doğmaz
 * ve yeni bir ikiz sessizce doğar. KK1 tuzağında birebir bu yaşandı ve ölçüldü.
```
`Teks-Erp/src/services/base.service.ts:1050-1057` — kilidin bilerek olmadığının beyanı (ama sonucu ölçülmemiş):
```ts
        // ⚠️ Burada advisory kilit YOK (item.service'te var): BaseService.create
        // transaction AÇMAZ ve audit bilinçli olarak tx dışında yazılır. Guard
        // `assertNameNotDuplicate` ile aynı sınıftadır — panelden yapılan
        // master-data yaratımını korur, yarış korumasını değil …
        const candidates = await this.loadCodeCandidates(key);
        const decision = decideCodeUniqueness(incomingValue, candidates, this.codeTexts(key));
```
`Teks-Erp/src/services/subcontractor-management.service.ts:202-206` ve `:512-516` — aynı desen, kilitsiz; kategori yolunda tx bile yok (`:214-222` düz `prisma.subcontractorCategory.create`).

**Koruma kontrolü (nereye bakıldı):** `grep -rn "lockCodeScopeTx" src` → tanım + **tek çağrı** (`item.service.ts:237`). DB: `code` üzerinde yalnız TAM eşleşmeli `@unique`; `upper(code)`/`tr_fold` ifadeli unique **hiçbir tabloda yok** (`test_db_invariants` `EXPRESSION_UNIQUES` envanteri de yalnız `colors_nameFoldColor_key`'i biliyor). Ad tarafındaki `<tablo>_nameFold_key` partial unique'leri **yumuşak kapı** olduğu için ortamlar ayrışmış (aşağıdaki K2).

**Çakışma senaryosu.**
```
T1  POST /api/subcontractors/categories {code: "sefa", name: "MİKRO CANVAS"}
T2  POST /api/subcontractors/categories {code: "SEFA", name: "MIKROCANVAS"}

t0  T1  loadSubCodeCandidates() → foldCodeForCompare eşleşmesi YOK → FREE
t0' T2  loadSubCodeCandidates() → (T1 daha yazmadı) → FREE
t1  T1  prisma.subcontractorCategory.create({code:"sefa"})   → OK (code @unique TAM eşleşme, çakışmaz)
t1' T2  prisma.subcontractorCategory.create({code:"SEFA"})   → OK
SONUÇ: aynı katlanmış kodu taşıyan İKİ aktif satır; ikisi de 200 aldı, hiçbir alarm yok.
```

**failure_mode.** İki büro personeli aynı dakikada yeni fason kategorisi/kalite sınıfı tanımlar (`sefa` ve `SEFA`). Her ikisi de "Kategori oluşturuldu" görür. Sonrasında kod bir kimlik olarak kullanıldığı her yerde (etiket, belge, dış eşleşme, içe aktarım anahtarı) hangi kaydın kastedildiği belirsizleşir; mükerrer paneli bunu ancak sonradan aday olarak kuyruğa düşürür ve birleştirme elle yapılır.

**Veride fiili ihlal (K2).** Saha kopyasında bugün: `items` içinde **8 katlanmış-kod grubu** ve **1 katlanmış-ad grubu**; `subcontractor_categories` içinde 0. **Ve yumuşak kapı yüzünden ortamlar ayrışmış** — prod'da `items_nameFold_key` **YOK** (mükerrer olduğu için migration index'i atladı), yani prod'da Item **ad** tekilliğinin DB seddi de hiç yok:
```
saha : customers_nameFold_key · subcontractors_nameFold_key · colors_nameFoldColor_key   (items_nameFold_key YOK)
dev  : customers_nameFold_key · subcontractors_nameFold_key · items_nameFold_key         (colors_nameFoldColor_key YOK)
items: upper(code) mükerrer grubu = 8 · nameFold mükerrer grubu = 1 (toplam 228 ürün)
```

**Repro (K3).** `Teks-Erp/scripts/audit_repro_KYY-1-03.ts` → `audit/repro/KYY-1-03.log`. **Pozitif kontrol grubuyla birlikte** koşuyor:
```
── A) SubcontractorCategory.create — 8026 kilidi YOK ──   6/6 tur: DB'de 2 satır (OK+OK)
── B) ItemService.create — 8026 kilidi VAR (kontrol) ──   0/6 tur: DB'de 1 satır (OK+ERR(409))
── C) BaseService.create (QualityGrade) — kilit YOK ──    6/6 tur: DB'de 2 satır (OK+OK)
ÖZET: A=6 · B=0 · C=6
```
B grubunun temiz çıkması, düzeltmenin **zaten repoda mevcut ve çalışır** olduğunu ispatlıyor.

**İş etkisi.** Kod bu sistemde kimliktir (etikete basılır, belgede görünür, içe aktarımda anahtar olur). İkiz kod, ürün/kategori/kalite bazlı her raporu ikiye böler ve `find_fold_duplicates`/mükerrer paneli üzerinden elle birleştirme işi doğurur. Prod'da Item ad seddi olmadığı için **aynı yarış ad üzerinde de açıktır** ve Item, mobilden (`mobile:kk1-desen` → `quickCreateFabric`) de yaratılabilen en yüksek hacimli ana veridir.

**Öneri (2. tur için).** `lockCodeScopeTx`'i üç çağırana da taşı — desen `item.service.ts:236-242`'de hazır:
* `base.service.ts:1047-1063`: `uniqueField` dolu ve istemci kod göndermişse yolu `prisma.$transaction`a al ve **ilk ifade** `lockCodeScopeTx(tx, this.config.modelName, incomingValue)` olsun; `loadCodeCandidates` ve `performInsert` aynı tx'e girsin. (Bugün tx açmamasının gerekçesi "audit tx dışında" idi — audit zaten tx SONRASI kalabilir.)
* `subcontractor-management.service.ts:202` ve `:512`: aynı; M1'de tx zaten var (`:528`), yalnız kod taraması tx'in içine ve kilidin arkasına alınmalı.
* Ad tarafı için `assertNameNotDuplicate` da aynı kilit kapsamına girsin (`scope = "<model>:name"`), **çünkü prod'da `items_nameFold_key` yok**.
* **`[PROD'DA ÇALIŞTIRMA]`** Sed'i (ifadeli unique) eklemek ayrı ve daha riskli bir iştir: `items` bugün 8 kod + 1 ad grubuyla ihlalde. Sıra: (1) uygulama kilidi (migration YOK, geri alınabilir), (2) mükerrer paneliyle temizlik, (3) sonra `CREATE UNIQUE INDEX CONCURRENTLY … ON items (upper(code)) WHERE "mergedIntoId" IS NULL` + `EXPRESSION_UNIQUES` envanterine kayıt. Geri alma: index `DROP INDEX CONCURRENTLY`.

**Kabul kriteri.** `audit_repro_KYY-1-03.ts` A ve C gruplarında 0 ikiz; `test_item_code_case_uniqueness`'in EŞZ sondası (bugün yalnız Item) `subcontractorCategory` ve `qualityGrade` için de çoğaltılır ve kilit satırı silinince kırmızı verdiği gösterilir.
**Efor.** 1 gün (kilit + bekçi); sed ayrı iş.
**Önceki defter.** K3b H-6 / K3a #10/#16 hipotezinin ölçülmüş hâli. Reddedilmiş bir bulgunun yeniden açılması değildir.

---

### [KYY-1-04] `updateTargetProperties` (W8) kilitsiz, claim'siz ve iş emri statüsüne hiç bakmıyor: kapanmakta olan iş emrinin fiilen uygulanmış özelliği hem plandan hem TOPLARDAN siliniyor

| Şiddet | **S2** | Kategori | **A.1** | Öncelik | **P1** | Modül | İş emri / plan | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Bu ucun tüm kilit kararı (`computeWorkOrderLocks`) **havuz client'ıyla, transaction'ın dışında** veriliyor; tx'in kendisinde ne iş emri satır kilidi, ne `status notIn terminal` claim'i, ne de herhangi bir tazeleme var. Kardeş uçların (`update`, `replace`, `changeTargetColor`, `changeWidth`) hepsinde bu koruma VAR. Sonuç: karar anıyla yazım anı arasında adım tamamlanır ya da iş emri kapanırsa, **uygulanmış** bir özellik hem iş emri hedefinden hem de o iş emrinin BİTMİŞ toplarından silinir — kilidin var oluş sebebi tam olarak buydu (`:5626-5628` yorumu).

**Kanıt.**

`Teks-Erp/src/services/workorder.service.ts:5626-5645` — karar, **havuzda**:
```ts
    const locks = await computeWorkOrderLocks(prisma, id);
    const existingPropIds = new Set(wo.targetProperties.map((p) => p.propertyId));
    const incomingSet = new Set(dedupedIds);
    for (const lockedId of locks.lockedPropertyIds) {
      if (existingPropIds.has(lockedId) && !incomingSet.has(lockedId)) {
        throw AppError.conflict(locks.reasons.properties?.[lockedId] ?? "Bu özellik artık kaldırılamaz.");
      }
    }
```
`…:5671-5712` — yazım, hiçbir guard tekrarlanmadan:
```ts
    const result = await prisma.$transaction(async (tx) => {
      await tx.workOrderTargetProperty.deleteMany({ where: { workOrderId: id } });
      …
      const affectedRolls = await tx.roll.findMany({
        where: { producedInStep: { workOrderId: id }, status: { in: TARGET_PROP_MUTABLE_STATUSES } }, … });
      …
        await tx.rollProperty.deleteMany({
          where: { rollId: { in: rollIds }, property: { valueType: "FLAG" } } });
```
Karşılaştırma — `update` (W6) `:4778-4810` `touchWorkOrderTx` İLK + `computeWorkOrderLocks(tx, …)` + `assertTargetColorChange(tx, …)` + `status notIn terminal` claim'i; `replace` (W7) `:5252-5258` claim-kilit. **W8'de bunların hiçbiri yok.**

**Koruma kontrolü (nereye bakıldı):** `sed -n '5602,5725p'` ile tüm gövde okundu — `touchWorkOrderTx`, `pg_advisory`, `updateMany … status` yok. Şemada `work_order_target_properties (workOrderId, propertyId)` unique yalnız mükerrer satırı engelliyor; `roll_properties (rollId, propertyId)` unique aynı; "COMPLETED WO'nun hedefine dokunulmaz" kuralı için **DB karşılığı yok**. `TARGET_PROP_MUTABLE_STATUSES` WAREHOUSE/A1_STOCK'u içeriyor → bitmiş toplar kapsamda.

**Çakışma senaryosu.**
```
T1  PATCH /api/work-orders/:id/target-properties   (planlamacı: "ZIMPARALI'yı hedeften çıkar")
T2  Kurşun+KK2 tableti FINISH  → copyStationCapabilitiesToRoll(ZIMPARALI) + adım COMPLETED
    (ya da: T2 = POST /work-orders/:id/complete)

t0  T1  computeWorkOrderLocks(prisma, id)   → adım henüz ACTIVE → ZIMPARALI lockedPropertyIds'te DEĞİL ✓
t1  T1  fabricProperty.findMany / assertTargetablePropertyIds        [await ×3]
t2  T2  BEGIN; step COMPLETED; rollProperty.create(ZIMPARALI) N topa; COMMIT
t3  T1  BEGIN; workOrderTargetProperty.deleteMany(workOrderId)        → ZIMPARALI plandan gitti
t4  T1  roll.findMany {producedInStep.workOrderId, status ∈ MUTABLE}  → T2'nin bitirdiği topları GÖRÜR
t5  T1  rollProperty.deleteMany {rollId in …, property.valueType FLAG} → ZIMPARALI TOPLARDAN da gitti
t6  T1  COMMIT → 200
SONUÇ: fiziksel olarak zımparalanmış toplarda özellik kaydı YOK; kilit mekanizması atlandı.
```
İkinci çizelge (aynı kök): `T2 = completeWorkOrder` → T1'in yazımı **COMPLETED** iş emrinin planını ve bitmiş toplarını değiştirir; W8'de `PLAN_CHANGE_FROZEN_STATUSES` kontrolü hiç yok.

**failure_mode.** IE2708260012 hedefi `ZIMPARALI`. 15:40:00'da Kurşun+KK2 operatörü adımı bitirir (özellik 6 topa yazılır ve adım COMPLETED olur); 15:39:59.8'de planlamacı "müşteri zımpara istemiyormuş" diyip hedef özelliği kaldırır. Kaldırma 200 döner. Sonuç: 6 top fiziksel olarak zımparalı ama kayıtta özellik yok → etiket, refakat kartı "İSTENEN ÖZELLİKLER" bloğu ve müşteri irsaliyesi eksik basılır; sevkiyat sonrası itiraz geldiğinde sistemde iz yoktur (audit'te yalnız "hedef özellik güncellendi" satırı vardır).

**Veride fiili ihlal (K2).** Aranmadı — bu ihlalin veride bıraktığı parmak izi yok (silinen satır iz bırakmıyor; `RollProperty` append-only değil). Ölçülebilir dolaylı gösterge: bir adımı COMPLETED olan iş emrinde hedef özellik listesi boş ve toplarında FLAG özelliği olmayan kayıtlar — ayırt edici değil, yanlış pozitif üretir; bilinçli olarak koşulmadı.

**Repro (K3).** Yazılmadı — fixture maliyeti yüksek (istasyon yetenekleri + rota + `computeWorkOrderLocks`'un tüm girdileri). Yarış penceresi kod okumasıyla **kesin**: karar `prisma` (havuz), yazım `tx`, arada en az 3 `await`. 2. tur için önerilen sonda §5'te.

**İş etkisi.** Üretim karakteristiğinin (kat, zımpara vb.) kaydı ile fiziksel gerçek ayrışır; bu, projenin 2026-08-10/11'de bilerek kurduğu "özellik istasyon kısıtı ve otomatik uygulama" modelinin tersine çalışır. Ayrıca terminal iş emirlerinde plan değişikliği kapısı (`PLAN_CHANGE_FROZEN_STATUSES`) bu uçtan **tamamen atlanabiliyor** — eşzamanlılık olmadan bile.

**Öneri (2. tur için).** W8'i kardeşleriyle hizala: tx'in İLK ifadesi `touchWorkOrderTx(tx, id)`, ardından `computeWorkOrderLocks(tx, id)` ile **tx içi taze** kilit hesabı ve `tx.workOrder.updateMany({where:{id, status:{notIn: PLAN_CHANGE_FROZEN_STATUSES}}, data:{updatedAt}})` + `count===0 → 409`. Havuzdaki `computeWorkOrderLocks(prisma, …)` çağrısı UX ön-kontrolü olarak KALSIN (F58 deseni: pre-tx havuz + tx içi taze). Migration YOK, izin YOK, APK YOK.
**Kabul kriteri.** Yeni bekçi: (a) COMPLETED iş emrinde W8 → 409 (bugün 200 dönüyor); (b) eşzamanlı sonda — `updateTargetProperties` ∥ `completeWorkOrder`, N tekrarda özellik silinmiş top sayısı 0; `touchWorkOrderTx` satırı silinince kırmızı (negatif sonda).
**Efor.** 0,5 gün (kod) + 1 gün (bekçi fixture'ı).
**Önceki defter.** K10 H-6 ve K3a #2/#6 ile aynı kök; defterde açık bir kayıt yok.

---

### [KYY-1-05] Yedek yarış koruması yalnız süreç belleğinde ve dosya adı saniye çözünürlüklü: dev defterinde çift yedek ve aynı `.part` üzerinde çakışma ÖLÇÜLDÜ

| Şiddet | **S2** | Kategori | **A.5** (zamanlanmış işler / çoklu instance) | Öncelik | **P3** | Modül | Ops / yedek | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|

**Özet.** "Aynı anda tek yedek koşar" değişmezi tek bir `let running` değişkeniyle korunuyor ve kodun kendi yorumu bunu tek-process invariantına bağlıyor. Süreç dışı ikinci bir yazıcı (ikinci Node süreci, ya da sahadaki kurulumda Windows Görev Zamanlayıcı'nın `yedekle.ps1`'i + panelin "Yedek Al" düğmesi) bu bayrağı görmez ve **dosya adı yalnız saniye çözünürlüklü** olduğu için ikisi aynı `.part` dosyasına yazabilir. Dev DB'nin audit defterinde bunun her iki tezahürü de var.

**Kanıt.**

`Teks-Erp/src/services/backup.service.ts:147` — invariantın beyanı:
```
// yarışır. `running` bayrağı tek-process invariant'ı (server.ts) altında yeterli.
```
`…:162, :199-209, :221-222` — koruma ve dosya adı:
```ts
let running = false;
…
  if (running) { return { ok: false, file: null, message: "Zaten bir yedek işlemi sürüyor.", … }; }
…
  running = true;
  const out = path.join(BACKUP_DIR, `${NIGHTLY_PREFIX}${stamp(new Date())}.dump`);
…
  const partPath = `${out}.part`;              // :236 — O_EXCL yok, ad çakışabilir
```
**Koruma kontrolü (nereye bakıldı):** `grep -rn "pg_advisory\|lockfile\|proper-lockfile\|O_EXCL" src/services/backup.service.ts src/jobs/backup-scheduler.ts` → **0**. DB tarafında yalnız `SystemSetting` "son koşum" damgası var ve o da **işin BAŞINDA** yazılıyor (`jobs/backup-scheduler.ts:102`, bilinçli takas — K8 H-1); damga bir kilit değil. `ecosystem.config.js` `instances: 1` (invariant doğru) ama **mekanik bekçisi yok** (`scripts/test_single_process.ts` mevcut değil — K8 §0).

**Çakışma senaryosu (dev defterinden birebir).**
```
T1  Node süreci #1 · backup-scheduler turu        T2  Node süreci #2 (paylaşımlı dev ağacı) · aynı tur
    (sahadaki karşılığı: T2 = Windows Görev Zamanlayıcı'nın yedekle.ps1'i
     ya da panelden POST /api/admin/backup)

03:27:16.x  T1  running=false → true; out = …_032716.dump; partPath = …_032716.dump.part
03:27:16.x  T2  (ayrı süreç, kendi `running`'i false) → AYNI saniye → AYNI partPath
            ikisi de pg_dump -f …_032716.dump.part  → aynı dosyaya iki yazıcı
03:27:18.034 T?  rename(part → dump) → ENOENT → BACKUP_FAILED (dosya diğerinin rename'iyle gitmişti)
03:27:18.042 T?  rename başarılı + pg_restore --list geçti → BACKUP_COMPLETED
SONUÇ: defterde "yedek başarısız" satırı var ama yedek alındı; ters interleaving'de
       hâlâ yazılmakta olan bir .part doğrulanıp nihai ada alınabilir.
```

**failure_mode.** Gece 03:27'de iki süreç aynı saniyede yedek başlatır. Sabah `/health` ve Yedekler ekranı yeşildir (bir `BACKUP_COMPLETED` var), ama audit defterinde açıklanamayan bir `BACKUP_FAILED` durur ve dosya iki `pg_dump` akışının karışımı olabilir — `pg_restore --list` başlığı okuyabildiği sürece "doğrulandı" der. Yedek ancak geri yükleme günü sınanır.

**Veride fiili ihlal (K2).** Dev DB audit defteri:
```
2026-08-23 03:14:24.752 | BACKUP_COMPLETED | tekserp_20260823_031422.dump
2026-08-23 03:14:24.752 | BACKUP_COMPLETED | tekserp_20260823_031423.dump      ← AYNI ms, İKİ yedek
2026-08-24 03:27:18.034 | BACKUP_FAILED    | rename '…/tekserp_20260824_032716.dump.part' → ENOENT
2026-08-24 03:27:18.042 | BACKUP_COMPLETED | tekserp_20260824_032716.dump      ← AYNI dosya, 8 ms sonra
```
Saha kopyasında karşılığı yok (`BACKUP_SCHEDULE_ENABLED=false`, gece işi Windows'ta) — **ama sahadaki kurulumda tam da iki ayrı süreç aynı dizine yazıyor**, yani orada `running` bayrağı hiçbir şey korumuyor.

**Repro (K3).** Yazılmadı — bilinçli. Repro, ikinci bir Node süreci başlatıp `pg_dump` koşturmayı gerektirir (sözleşmenin "yazıcıya/dış dünyaya giden yolları çağırma" yasağı ve 2 dk süre sınırı). **K2 zaten fiili ihlaldir**, repro ondan zayıf olurdu.

**İş etkisi.** Yedek bütünlüğü ve yedek defterinin güvenilirliği. `docs/ops`'ta restore tatbikatı izi yok (O-17), offsite kopya sahada rclone kurulu olmadığı için kapalı → tek savunma bu dosyalar.

**Öneri (2. tur için).**
1. **Süreç dışı kilit:** `.part` dosyasını `fs.open(path, "wx")` (O_EXCL) ile aç, ya da `BACKUP_DIR/.backup.lock` üzerinde `wx` + PID/ISO damgası (bayat kilit 3 sa'ten eskiyse devral — `stale .part` budaması `:363-380` ile aynı politika). Bu, Windows Görev Zamanlayıcı ↔ panel çakışmasını da kapatır.
2. **Dosya adına milisaniye + PID ekle** (`stamp()` → `YYYYMMDD_HHMMSS_mmm_<pid>`); ad çakışması tek başına en ucuz düzeltmedir ama (1) olmadan çift dump'ı engellemez.
3. **Tek-process invariantına mekanik bekçi:** `scripts/test_single_process.ts` — `ecosystem.config.js`'te `instances===1 && exec_mode==="fork"` ve `src` içinde `cluster`/`worker_threads` importu olmadığını doğrular; bugün invariant üç yerde belgeli, sıfır yerde ölçülü.
Migration YOK, izin YOK. `[PROD'DA ÇALIŞTIRMA]` gerektiren bir adım yok; kilit dosyası yeni bir dosya sistemi nesnesidir, geri alma = özelliği kapatmak.
**Kabul kriteri.** İki süreçten aynı saniyede tetiklenen iki `runBackupJob` → tam 1 `BACKUP_COMPLETED`, diğeri "Zaten bir yedek işlemi sürüyor"; `test_backup`'a bu sonda eklenir (bugünkü 605 kontrol yalnız süreç İÇİ çakışmayı ölçüyor).
**Efor.** 0,5 gün.
**Önceki defter.** K8 H-2 / H-6 hipotezinin ölçülmüş hâli.

---

### [KYY-1-06] `freezeForSource` versiyonu kilitsiz `max+1` ile hesaplıyor ve P2002'yi yalnız lazy-init dalı yakalıyor: belge çakışması sevk transaction'ının tamamını geri sarıyor

| Şiddet | **S3** | Kategori | **A.6** (belge no üretimi) + **B.2** | Öncelik | **P1** | Modül | Donmuş belge | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `PrintedDocument` versiyonu `findFirst(order by version desc)` + 1 ile hesaplanıyor; bu okuma hiçbir kilit altında değil ve `create` çağrısının P2002'si **yalnız** `getCurrent`'ın lazy-init dalında yakalanıyor. `freezeForSource` sevk/iade/fason sevk/kartela transaction'larının İÇİNDEN çağrıldığı için, aynı `(docType, sourceId)` için ikinci bir yazıcı (GET lazy-init) araya girerse **iş transaction'ı komple geri sarılır** ve kullanıcı "Bu 'version' değeri zaten mevcut (unique constraint)" görür.

**Kanıt.**

`Teks-Erp/src/services/printed-document.service.ts:331-347` — kilitsiz `max+1`, catch yok:
```ts
    const prev = await tx.printedDocument.findFirst({
      where: { docType, sourceId }, orderBy: { version: "desc" }, select: { version: true } });
    await tx.printedDocument.create({
      data: { docType, sourceId, version: (prev?.version ?? 0) + 1, status: PrintedDocStatus.ACTIVE, … } });
```
`…:382-433` — lazy-init: **GET yolu havuzdan YAZIYOR** ve P2002'yi yakalıyor (doğru refleks, ama yalnız burada):
```ts
      const created = await prisma.printedDocument.create({ data: { …, version: 1, … } });
      …
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const winner = await prisma.printedDocument.findFirst({ where: { docType, sourceId }, orderBy: { version: "desc" } });
        return { success: true, data: winner … };
```
`…:747-767` — `reissueForSourceTx` **atomik claim taşıyor** (`{id, status: ACTIVE}` → SUPERSEDED, count 0 → 409) → o yol ACTIVE satırın yazma kilidinde serileşiyor ✓; ama içindeki `freezeForSource` çağrısı yine kilitsiz `max+1` yapıyor.

**Koruma kontrolü (nereye bakıldı):** `grep -rn "freezeForSource" src` → 11 çağrı yeri, hepsi bir `tx` geçiriyor ama hiçbiri P2002 sarmalayıcısı taşımıyor. Şemada `printed_documents (docType, sourceId, version)` unique VAR (son savunma ✓) ve **doğru şekilde çalışıyor** — sorun hatanın ele alınmaması. `sourceId` polimorfik olduğu için FK ile ek koruma yok.

**Çakışma senaryosu.**
```
T1  GET /api/printed-documents/SHIPMENT_DISPATCH/<eski sevkiyat>/current   (belgesi olmayan eski kayıt)
T2  POST /api/shipping/shipments/<aynı sevkiyat>/dispatch   (storno sonrası yeniden sevk)

t0  T1  findFirst → yok → lazyInit builder (HAVUZ, birkaç sorgu)
t1  T2  BEGIN; performDispatchTx … freezeForSource: prev = null → version 1
t2  T1  printedDocument.create({version: 1}) → COMMIT (havuz)
t3  T2  printedDocument.create({version: 1}) → P2002 (docType_sourceId_version)
t4  T2  YAKALAYAN YOK → tüm dispatch tx'i ROLLBACK → 409 "Bu 'version' değeri zaten mevcut"
SONUÇ: sevk gerçekleşmez; kamyon kapıda, mesaj teşhis edilemez. Veri bozulmaz (atomik).
```

**failure_mode.** Depo sorumlusu Sevkiyatlar ekranından eski bir sevkiyatın irsaliyesini görüntülemek için tıklar (belge geriye dönük kurulur); aynı saniyede başka bir kullanıcı o sevkiyatı sevk eder. Sevk 409 ile düşer, mesaj "Bu 'version' değeri zaten mevcut (unique constraint)" der. Kullanıcı tekrar dener ve geçer — ama olayın kaydı yalnız 409'dur, hiçbir yerde açıklanmaz.

**Veride fiili ihlal (K2).** Aranmadı — bu hata **başarısız** bir tx bırakır, yani veride iz kalmaz (tanım gereği). Dolaylı gösterge yok.

**Repro (K3).** Yazılmadı — pencere çok dar (lazy-init yalnız belgesiz kaynakta koşar) ve şiddeti S3; sözleşmenin "en güçlü 2-4 aday" bütçesi KYY-1-01/02/03'e ayrıldı.

**İş etkisi.** Sevk anında anlaşılmaz bir hata; veri kaybı yok, tekrar denemeyle geçer. Asıl bedel teşhis maliyeti.

**Öneri (2. tur için).** `freezeForSource`'un `create` çağrısını dar bir P2002 dalıyla sar ve **aynı tx içinde** taze `max+1` ile bir kez daha dene (`traveler-card.service.ts:219-227`'nin "tx BİR KEZ yeniden" deseni emsal); ya da versiyonu tek ifadede üret: `INSERT … SELECT COALESCE(MAX(version),0)+1 …` + `ON CONFLICT DO NOTHING` + count kontrolü. `getCurrent` lazy-init'in **GET içinde yazması** ayrı bir F/I konusudur (audit `userId: undefined`) — bu düzeltmeyle birlikte gözden geçirilmeli. Migration YOK.
**Kabul kriteri.** `test_printed_documents`'a "aynı `(docType,sourceId)` için lazy-init ∥ freeze — tam 1 satır, İKİ istek de başarılı" sondası; `freezeForSource`'un catch'i silinince kırmızı.
**Efor.** 0,5 gün.
**Önceki defter.** K2a H6 hipotezinin doğrulanmış hâli (soru "reissue dalında catch var mı" idi → **reissue'da CLAIM var (güvenli), freeze'de catch YOK**).

---

### [KYY-1-07] `setFeatureFlags` transaction'sız ~50 bağımsız yazım + istemci TAM nesne gönderiyor: bayat sayfadan kaydeden ikinci admin koruma bayraklarını sessizce geri kapatıyor

| Şiddet | **S3** | Kategori | **A.2** (lost update) | Öncelik | **P3** | Modül | Sistem ayarı | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `PATCH /api/feature-flags` gövdesi bayrak nesnesinin TAMAMIDIR ve servis onu anahtar başına bağımsız `upsert`'lerle yazar (transaction yok). İki admin farklı sekmelerden çalışırken, sayfayı önce açan kişinin kaydı, arada yapılmış her değişikliği geri alır — üstelik anahtar başına ayrı audit satırı yazıldığı için olay "admin bilerek kapattı" gibi görünür.

**Kanıt.**

`Teks-Erp/src/services/system-setting.service.ts:1245-…` — tx yok, anahtar başına `set()`:
```ts
  async setFeatureFlags(input: …, userId: string | undefined): Promise<ApiResponse<FeatureFlags>> {
    …
    if (Object.prototype.hasOwnProperty.call(input, "kk1DuplicateGuardEnabled")) {
      …
      await this.set(SETTING_KEYS.KK1_DUPLICATE_GUARD_ENABLED, input.kk1DuplicateGuardEnabled,
                     "Ham girişte mükerrer top uyarısı", userId);
    }
```
`…:1032-1070` — `set()` upsert'i atomik (tek anahtar için lost update YOK) ve invalidate tek noktada `:1067` ✓:
```ts
    const updated = await prisma.systemSetting.upsert({ where: { key }, create: {…}, update: { value, updatedById: userId } });
    …
    invalidateFeatureFlagsCache();
```
**Koruma kontrolü (nereye bakıldı):** `grep -rn "systemSetting.upsert" src` → 6 yer; 3'ü job (`jobs/archive-scheduler.ts:42`, `jobs/backup-scheduler.ts:53`, `jobs/installation-identity.job.ts:141`) ve 1'i `db-copy.service.ts:288` **`set()`'i atlıyor** → o yazımlar `invalidateFeatureFlagsCache()` ÇAĞIRMIYOR (bugün zararsız: yazdıkları anahtarlar bayrak agregatında değil — ama yeni bir anahtar oraya girerse 30 sn bayat okuma doğar). `system_settings`'te değer aralığı/biçimi için CHECK yok. `documentsLogo` için süreç-içi kuyruk var (`:1105-1112`) — doğru refleks ama yalnız orada.

**Çakışma senaryosu.**
```
T1  Admin A · 10:00 · Ayarlar açılır → GET /api/feature-flags → tüm nesne (kk1DuplicateGuardEnabled: false)
T2  Admin B · 10:02 · KK1 sekmesinden kk1DuplicateGuardEnabled = TRUE → PATCH (tüm nesne, güncel)
T1  Admin A · 10:05 · Sevkiyat sekmesinde undoSameDayOnly'yi değiştirir → PATCH (10:00'daki TAM nesne)
    → set(KK1_DUPLICATE_GUARD_ENABLED, false)   ← B'nin değişikliği geri alındı
SONUÇ: KK1 mükerrer tuzağı sessizce kapandı; audit'te "A, kk1DuplicateGuardEnabled=false yaptı" yazar.
```
İkinci çizelge: `setFeatureFlags` ortasında havuz hatası → ilk 20 anahtar yazıldı, kalan 30'u yazılmadı, yanıt 500; panel "kaydedilmedi" der ama ayarların yarısı değişmiştir (tx olmadığı için rollback yok).

**failure_mode.** Fabrikada KK1 mükerrer tuzağı (`kk1.duplicateGuardEnabled`, sahada AÇIK) bir başka adminin bayat Ayarlar sayfasını kaydetmesiyle kapanır; tuzak sessizce devre dışı kalır ve ham girişte mükerrer top uyarısı çıkmamaya başlar. Kimse bir hata görmez.

**Veride fiili ihlal (K2).** Aranmadı — saha'da 34 anahtar var ve audit satırlarından "geri alma" örüntüsünü ayırt etmek için anahtar başına zaman serisi analizi gerekir; bu I/K alanının işi (öneri §5'te).

**Repro (K3).** Yazılmadı — feature-flag yazımı **paylaşımlı dev DB'deki global ayarı değiştirir**; repro sözleşmesi "global ayarlara dokunma" diyor. Kod okumasıyla kesin (tx yok, tam nesne yazımı).

**İş etkisi.** Koruma bayrakları (KK1 tuzağı, kurşun bypass rejimi, `fason.shrinkWarnEnabled`, oturum ömrü, `device.pairingRequired`) sessizce geri dönebilir. Doğrudan stok/para etkisi yok ama korumaların güvenilirliğini düşürür.

**Öneri (2. tur için).** (a) `setFeatureFlags`'i **tek `$transaction`a** al (anahtar başına audit tx SONRASI toplanabilir) — kısmi yazımı bitirir. (b) İstemci **yalnız değişen anahtarları** göndersin (Electron paneli dirty-tracking); sunucu `hasOwnProperty` kontrolünü zaten yapıyor, yani sözleşme uyumlu. (c) Kalıcı çözüm: `GET`'te bir `etag`/`updatedAt` yüksek-su-işareti dön, `PATCH`'te geri iste ve eşleşmezse 409 "ayarlar bu sırada değişti, yenileyin". (d) Job'ların doğrudan `upsert`'leri bayrak anahtarına dokunmuyor — bunu bir bekçiyle sabitle (`test_feature_flag_contract`'a "doğrudan upsert edilen anahtarlar ∩ FeatureFlags anahtarları = ∅").
**Kabul kriteri.** İki eşzamanlı `setFeatureFlags` (biri bayat nesneyle) → ikincisi 409; kısmi yazım imkânsız (tx).
**Efor.** 0,5 gün (a+d) · 1 gün (b+c, Electron dahil).
**Önceki defter.** K2a H11 ("istemci tarafı son-yazan-kazanır, düşük") — burada somut failure_mode ile yükseltilmiş hâli; şiddet yine S3.

---

### [KYY-1-08] `reasonPreset.duplicate` sıra kaydırması idempotent değil ve `nextFreeCode` transaction dışında: eşzamanlı çoğaltmada aynı `sortOrder`'da iki satır doğuyor

| Şiddet | **S3** | Kategori | **A.1** + **B.2** | Öncelik | **P3** | Modül | Sebep kataloğu | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Çoğaltma iki adımdan oluşuyor: "kaynaktan sonrakileri bir kaydır" ve "kaynağın hemen altına yaz". İkisi tx içinde ama **kilitsiz**, ve boş kod arayan `nextFreeCode` tx'in DIŞINDA. İki eşzamanlı çoğaltma kaydırmayı iki kez uygular ve ikisi de `src.sortOrder + 1` yazar → aynı sıra numarasında iki satır (üzerinde unique yok) ve listede iki boşluk. Aynı etiketle çoğaltılırsa `nextFreeCode` ikisine de aynı kodu verir → `(kind, code)` P2002 → burada `withBarcodeRetry` yok, kullanıcı ham 409 alır.

**Kanıt.**

`Teks-Erp/src/services/reason-preset.service.ts:463-481`:
```ts
    const code = await nextFreeCode(src.kind, slugifyReasonCode(newLabel));   // ← tx DIŞINDA
    const row = await prisma.$transaction(async (tx) => {
      await tx.reasonPreset.updateMany({
        where: { kind: src.kind, sortOrder: { gt: src.sortOrder } },
        data: { sortOrder: { increment: 1 } },                                // ← idempotent DEĞİL
      });
      return tx.reasonPreset.create({ data: { kind: src.kind, code, …, sortOrder: src.sortOrder + 1, … } });
    });
```
`…:496-513` — `reorder`ın küme eşitliği kontrolü de tx dışında:
```ts
    const rows = await prisma.reasonPreset.findMany({ where: { kind }, select: { id: true } });
    const known = new Set(rows.map((r) => r.id));
    if (ids.length !== known.size || ids.some((id) => !known.has(id))) throw new AppError("… eksik veya yabancı …", 400);
    await prisma.$transaction(ids.map((id, i) => prisma.reasonPreset.update({ where: { id }, data: { sortOrder: i, … } })));
```
**Koruma kontrolü (nereye bakıldı):** `grep -n "pg_advisory\|updateMany.*count\|withBarcodeRetry" src/services/reason-preset.service.ts` → 0. Şemada `reason_presets (kind, code)` unique VAR ✓ (kod çakışmasını yakalıyor), **`(kind, sortOrder)` unique YOK**.

**Çakışma senaryosu.**
```
T1  POST /api/reason-presets/<X>/duplicate {label: "Kayıt hatası - vardiya A"}
T2  POST /api/reason-presets/<X>/duplicate {label: "Kayıt hatası - vardiya B"}    (src.sortOrder = 3)

t0  T1 nextFreeCode → KAYIT_HATASI_VARDIYA_A     t0' T2 nextFreeCode → …_B   (farklı kod, ikisi de geçer)
t1  T1 BEGIN; updateMany {sortOrder > 3} +1;     t1' T2 BEGIN; updateMany {sortOrder > 3} +1   (satır kilidinde serileşir ama İKİ kez uygulanır)
t2  T1 create {sortOrder: 4}                      t2' T2 create {sortOrder: 4}
SONUÇ: sortOrder = 4'te İKİ satır; 4 ve 5 numaralı yuvalar boş; liste sırası PG'nin
       satır sırasına kalır (garantisiz) ve sürükle-bırak sıralaması bozulur.
Aynı etiketle: t0 ve t0' aynı kodu üretir → t2' P2002 → ham 409 "Bu 'code' değeri zaten mevcut".
```

**failure_mode.** İki süpervizör Tambur sebep listesine aynı anda birer satır ekler. Ekranda sıra beklenenden farklı çıkar ve mobil `mergeVisibleOrder` köprüsü (gizli satırı kendi yuvasında tutan) yanlış yuva hesaplar; bir sonraki sürükle-bırak kaydında sıra yine kayar. Metraj/stok etkisi yoktur.

**Veride fiili ihlal (K2).** Arandı, dev'de aynı `(kind, sortOrder)` çiftini paylaşan satır bulunmadı (`reason_presets` dev'de küçük). Saha'da bu tabloya panelden yazım henüz düşük hacimli.

**Repro (K3).** Yazılmadı — S3 ve bütçe daha yüksek şiddetli üç bulguya ayrıldı; kod okumasıyla kesin.

**İş etkisi.** Yalnızca sunum sırası; 2026-08-26'da tam bu ekran için yapılan "sıra sürüklenerek KALICI" işini sessizce bozar.

**Öneri (2. tur için).** `nextFreeCode`'u tx'in İÇİNE al ve tx'in ilk ifadesi olarak `pg_advisory_xact_lock(<yeni NS>, hashtext("reason_preset|" || kind))` ile kind kapsamını serileştir (8021-8026 dolu; **boş bir numara seç** — `code-unique.helper.ts:44-52` envanteri). Alternatif/ek: `(kind, sortOrder)` üzerinde unique + `sortOrder`'ı seyrek aralıklı (10, 20, 30…) tut. `reorder`'ın küme eşitliği kontrolü de tx'e alınmalı. Migration: `(kind, sortOrder)` unique eklenirse **`[PROD'DA ÇALIŞTIRMA]`** — önce mevcut çakışmalar taranmalı (`SELECT kind, "sortOrder", count(*) … HAVING count(*)>1`), yoksa migration düşer; geri alma `DROP INDEX`.
**Kabul kriteri.** `test_reason_presets`'e "N paralel duplicate → sortOrder'lar 1..N+1 aralığında BENZERSİZ" sondası; kilit satırı silinince kırmızı.
**Efor.** 0,5 gün.
**Önceki defter.** K3b T6 ("`nextFreeCode` check-then-act → DB unique P2002 → 409/500 haritası ② baksın") — cevap: **409** (`error.middleware.ts:388-407`), mesaj teşhis edici değil.

---

## 3. Uygulanan kontrol listesi

Prompt Bölüm 3, benim mercek alanıma (kritik yazma yolu 8-soru) düşen maddeler:

| Madde | Durum |
|---|---|
| **A.1 Check-then-act** | **uygulandı** — 17 yolun her birinde okunan alan / karar / yazılan alan üçlüsü tablolandı; 6 yolda korumasız CTA bulundu (KYY-16, 25-W8, 34, 37, 43, 49), 11'inde kapalı olduğu gösterildi. |
| **A.2 Kaybolan güncelleme** | **uygulandı** — KYY-43 (tam-nesne bayrak yazımı) bulgu; KYY-10/13/22'de `touchOrderLinesTx`/`touchWorkOrderTx` protokolü doğrulandı. |
| **A.3 İzolasyon seviyesi** | **uygulandı** — beceri §3.1'in üçlü koşulu her yol için sınandı. Üç koşulu birlikte sağlayan (phantom + izolasyon yükseltmesi yok + advisory yok) tek yer **KYY-25 W8** ve **KYY-37**; ikisinde de doğru araç advisory/satır kilidi olduğu için `Serializable` ÖNERİLMEDİ. `isolationLevel` yokluğu tek başına bulgu yazılmadı. |
| **A.4 Prisma transaction tuzakları** | **uygulandı** — tx sınırları (başlangıç/bitiş satırı), tx-dışı kararlar, `withBarcodeRetry` sarmalları ve retry'ın closure'da tekrarladığı tx-dışı iş tablolandı; `tx` üzerinde `Promise.all` kullanımı arandı (`grep -rn "Promise.all" src/services` içinde tx client'lı örnek bulunmadı — `undoDispatch:2190` yorumu "tx içinde Promise.all YASAK" diyerek seri döngü kullanıyor). |
| **A.5 Zamanlanmış işler / çoklu instance** | **uygulandı** — KYY-46 bulgu (K2). Tek-process invariantı "cluster'da bozulur" diye DEĞİL, **bekçisiz** ve **süreç dışı ikinci yazıcıya açık** olduğu için yazıldı (beceri §5). |
| **A.6 Belge numarası üretimi** | **uygulandı** — KYY-28 tümüyle; `nextDailySeq` (Q, kilitsiz + DB unique + retry) meşru bulundu, barkod sayacı atomik doğrulandı, parti no 8022 sırası doğrulandı. Asıl bulgu retry'ın seçici olmaması (KYY-1-02). |
| **A.7 Node/Express içi eşzamanlılık** | **uygulandı** — her çizelgede `await` yield noktaları açıkça gösterildi; senkron bölümlerin atomikliği (lockout `reserveLoginAttempt`, backup `running`) ayrıca değerlendirildi. |
| **A.8 Cache ve eşzamanlılık** | **uygulandı** — KYY-43'te `cacheGeneration` lost-invalidation guard'ı ve tek invalidate noktası doğrulandı; `set()` dışından yazan 4 nokta listelendi (bugün bayrak anahtarına dokunmuyor → bulgu değil, bekçi önerisi). KYY-49'da `cachedRows` bayat-serve tasarımı incelendi (2026-08-26 kararı doğru uygulanmış). |
| **B.1 DB seviyesinde tekillik** | **uygulandı** — her yolun 6. sorusu; K2a/K2b'ye ek olarak `pg_indexes` üzerinden **ortam ayrışması ölçüldü** (yumuşak kapı: prod'da `items_nameFold_key` yok, dev'de `colors_nameFoldColor_key` yok). |
| **B.2 Upsert yarışı** | **uygulandı** — `SystemSetting.set` (atomik ✓), `PrintedDocument` `max+1` (KYY-1-06), `nextFreeCode` (KYY-1-08), `RollBarcodeCounter` `ON CONFLICT` (✓). |
| **B.3 API idempotency** | **uygulandı** — `clientToken` taşıyan/taşımayan uçlar 17 yol içinde işaretlendi; KYY-1-02 bulgu; KK1'in iptal-sonrası replay boşluğu (4. durum) sınır ötesi nota yazıldı. |
| **B.5 Mantıksal mükerrer ana veri** | **kısmen** — KYY-37 üzerinden yarış boyutu ölçüldü (KYY-1-03); mükerrer paneli algoritmasının kendisi D-B/E alanının işi, buradan yalnız yarışa bakıldı. |
| **E İş kuralı değişmezleri** | **kısmen (kapsam gereği)** — her yolun 1. sorusunda korunan değişmez K10 diliyle adlandırıldı ve 7. soruda eşzamanlılıkta korunup korunmadığı sınandı. Değişmezin **semantik** doğruluğu (ör. `createFasonShipChild`'ın `initialQty` düşürmesi, KARTELA_CONSUMED metraj sözleşmesi) **kapsam dışı — D-E alanının işi**, sınır ötesi nota bırakıldı. |
| **C / D / F / G / H / I / J / K / L** | **kapsam dışı — sebep:** bu denetçinin merceği "kritik yazma yolu 8-soru"dur; ilgili gözlemler alan denetçilerine sınır ötesi not olarak bırakıldı (§5). |
| **Repro yükümlülüğü** | **uygulandı** — 3 script yazıldı ve koşturuldu (sözleşme "2-4"); üçü de fixture damgalı, `finally` temizlikli, dev-DB guard'lı; temizlik `sql-dev.sh` ile doğrulandı (0 artık). Global ayara dokunulmadı. |

---

## 4. Doğru yapılanlar (korunması gereken kalıplar)

1. **`kursun-bypass.assign` — bu denetimin MODEL DESENİ.** `touchWorkOrderTx` tx'in ilk ifadesi (`kursun-bypass.service.ts:771`), sonra **her guard kilit altında ve taze** okunuyor (WO `:774`, mevcut atama `:819`, bayrak `:826`, uygunluk `:836-887`, makine `:902`, istasyon yeteneği `:934`), yazım atomik claim ya da create, ve son savunma bir **DB partial unique** (`kursun_bypass_one_pending_per_step_uq`) — kaybeden `p2002Mentions` ile anlamlı Türkçe 409'a çevriliyor (`:993-999`). Dört katman: kilit → taze okuma → claim → DB seddi. Yeni bir yazma yolu yazılırken kopyalanacak dosya budur.

2. **Kilit SIRASININ gerekçesiyle birlikte yazılması.** `inventory.service.ts:844` (8021), `shipment-locks.helper.ts:44-52` (8023), `session-registry.service.ts:66-78` (8024), `code-unique.helper.ts:63-71` (8026) — dördü de kilidin *neden* korunan okumadan önce olmak zorunda olduğunu **üretilmiş vakayla** anlatıyor. Bu, bir sonraki geliştiricinin kilidi "temizlik" diye aşağı kaydırmasını engelleyen tek şey. `code-unique.helper.ts` bir adım daha ileri gidip **korumanın eksik olduğu yolu da** adıyla yazmış — KYY-1-03'ü bulmak kolaylaştı.

3. **Pre-tx guard'ın tx içi ikizi (F58 deseni).** `update` (W6) `workorder.service.ts:4675/:4697` havuzda + `:4779/:4794` tx içinde taze; `kartela.dispatch` `:249-274` pre-check + `:323-330` aynı WHERE ile claim ve yorumu ("pre-check yarışı kapatmaz, bu WHERE kapatır"); `subcontractor.receive` `:2718-2734` kısmi/tam sınıflandırmayı kilit altında yeniden çözüyor. UX için erken hata + doğruluk için tx içi ikiz — ikisi bir arada.

4. **Atomik claim'in "kaç isteğin başarılı SAYILMASI gerekiyor" sorusuna açık cevap vermesi.** `subcontractor.receive:2857` (`count !== fullIds.length → 409`, yorumu retry'ın neden kötüleştirdiğini yazıyor), `roll-disposition.helper.ts:239`, `kartela.dispatch:331`, `tambur-undo:1488` — hepsi hepsi-ya-hiç ve **açıkça** öyle. `assign-bulk` ise bilinçli olarak parçalı ve `failed[]` döndürüyor. Beceri §3.2'nin istediği "seçim yazılı olmalı" kuralı bu kod tabanında tutuyor.

5. **Tx-dışı okumanın *neden* tx dışında olduğunun yazılması.** `inventory.service.ts:802-809`: bayrak okuması tx içinden yapılırsa havuzdan ikinci bağlantı ister ve 30 eşzamanlı tx havuzu kilitler. Bu, "her şeyi tx'e al" refleksinin neden yanlış olduğunu gösteren ölçülmüş bir karşı-örnek; `roll-barcode.helper.ts:60-72`'deki iki koşullu kabul kriteri (`T1<100ms VE T2=30/30`) de aynı disiplinde.

---

## 5. Sınır ötesi notlar

**→ B (mükerrer / idempotency)**
- **KK1 replay'de iptal edilmiş top kontrolü YOK.** `inventory.service.ts:963-985` `existing.status`'u okumuyor; `CANCELLED`/`SCRAP` top için `success: true` + eski barkod dönüyor. Emsal doğru uygulamalar: `subcontractor.service.ts:2358-2363` (`RECEIPT_CANCELLED`) ve `tambur-manual.service.ts:1049/:1405` (`ENTRY_CANCELLED`). Saha yüzeyi **227 top** (ölçüldü). Beceri §8 "en pahalı hata".
- **Kartela `receive`'de replay kimliği hiç yok** (`dispatch`'te heuristik var, `stock/reduce`'ta `clientToken` var). Zaman aşımı sonrası retry mükerrer üretmiyor (claim 409'luyor) ama mesaj "Toplardan biri başka akışa girdi" — teşhis edici değil.
- `createReturn`'de `clientToken` yok (≤200 toplu iade). Claim ikinci yazımı keser mi — ayrı inceleme.

**→ E (iş kuralı) / C (veri modeli)**
- `Σ receivedQty ≤ dispatchedQty` (FAS-03) **yalnız kodda**; `subcontractor_receipt_items`'ta CHECK yok ve `receivedQty` saha'da 635/638 NULL. KYY-1-02'nin ikinci hasar kolu tam burada birikiyor.
- `createFasonShipChild` `initialQty`'yi de düşürüyor (`subcontractor.service.ts:588` civarı) — "top yalnız kesimle azalır" (STK-02) kuralının istisnası mı, yoksa hata mı?
- Aynı top üç ayrı "önceki statü" kolonu taşıyabiliyor (`preShipStatus` / `preCancelStatus` / `preTamburCloseStatus`); geri alma sıralaması çakışırsa hangisi kazanır — K4 H10.
- KYY-04 için: **stornoyu iade sayacının koruması TESADÜFİDİR.** `resolveUndoBlockReason`'daki `activeReturnCount > 0` kapısı bir gün gevşetilirse (ör. "iade edilenler hariç geri al"), `cancelReturn`'ün 8023'süz ve sevkiyat statüsüne bakmayan yazımı (`return.service.ts:878-900`) anında SHIPPED-top ↔ PLANNED-sevkiyat üretir. O kapıya dokunan her değişiklik `cancelReturn`'e de `lockShipmentScopeTx` + sevkiyat statü kontrolü eklemek zorundadır.

**→ F (API) / G (güvenlik)**
- `POST /shipping/shipments/:id/cancel` **gövdesiz** (sebep alınmıyor), `:id` uuid doğrulaması yok, WRITE izin kümesi mobil izinlerini içeriyor — yıkıcı bir uç için üçü birden.
- `GET /printed-documents/:docType/:sourceId/current` **yazıyor** (lazy-init) ve audit `userId: undefined`.
- KYY-49 ve KYY-31'de `:id` uuid doğrulaması yok (`reason-presets/:id`, `kartela/dispatches/:id/cancel`).

**→ H (performans)**
- Barkod sayacı satır kilidi tx boyunca tutuluyor ve KK1'in en yüksek hacimli yolu (`inventory.service.ts:905`); kabul kriteri ölçülmüş ama vardiya başı yığılmada tekrar ölçülmeli.
- `item.service.ts:240` kod taraması **tüm ürün tablosunu** 8026 kilidi altında `findMany` ile çekiyor (228 satırda sorun değil, 5.000'de olur).
- KYY-1-02'nin retry'ı her başarısız denemede WO satır kilidini yeniden alıp ~30 sorgu koşuyor → 5 kat boşa iş, kilit tutma süresi 5 kat.

**→ I (hata / gözlemlenebilirlik)**
- `withBarcodeRetry` tükenme 409'u **audit yazmıyor** (K6 H-2) ve mesajı bağlam taşımıyor ("Barkod üretimi…" — fason kabulünde barkod hiç üretilmemiş olabilir).
- `subcontractor.receive` sonrası tx-DIŞI `changeWidth` `:3270` hatası yalnız `console.warn`; `postWarnings` doldurulmuyor.
- KYY-46: `BACKUP_FAILED` satırı yanlış bilgi verebiliyor (K2, §2).

**→ J (migration / kurtarma)**
- **Yumuşak kapı migration'ları ortam ayrışması üretti ve bunun bir sahibi yok:** prod'da `items_nameFold_key` YOK, dev'de `colors_nameFoldColor_key` YOK. "Temizlik sonrası aynı dosya yeniden koşulur" planının kim/ne zaman sahibi olduğu belirsiz (K2b H-1); bu arada prod'da Item ad tekilliğinin **tek savunması** kilitsiz bir uygulama guard'ı.

**→ K (test / bekçiler)**
- Eşzamanlılık sondası olmayan kritik yollar: `tambur-undo` (paralel YOK — KYY-1-01 tam oradan çıktı), `completeWorkOrder` (paralel YOK), `updateTargetProperties` (paralel + statü bekçisi YOK), fason **kısmi** kabul (paralel YOK), storno×storno, `cancelReturn`×storno, `openLoginSession` 8024 (bekçisiz advisory), `inventory.service.ts:844` 8021'in **SIRASI** (bekçisiz).
- `test_item_code_case_uniqueness`'in EŞZ sondası **yalnız Item'ı** ölçüyor; kilitsiz üç çağıran ölçülmüyor (KYY-1-03 tam oradan çıktı) — "bekçi hatayla aynı yerde kör" sınıfının yeni bir örneği.
- `test_single_process` YOK; tek-process invariantı üç yerde belgeli, sıfır yerde ölçülü (KYY-1-05).
- `test_fason_receive_idempotency_concurrency` "born=1" ölçüyor ama **kaç isteğin başarılı sayıldığını** ölçmüyor; KYY-1-02 bu kör noktada yaşıyordu.

**→ L (kod kalitesi)**
- `KRITIK-YAZMA-YOLLARI.md` KYY-28 satırındaki "`withBarcodeRetry` … predicate'li yalnız 4" ifadesi **yanlış**; ölçüm 0/28. Harita düzeltilmeli (bu rapordaki grep ile).
- `roll_barcode_counters` şema yorumu `day=YYMMDD` diyor, veri `GGAAYY` (K10 H-13) — bayat yorum.

---

## 6. Kapsanmayan / erişilemeyen

| Konu | Sebep |
|---|---|
| KYY-02, 03, 05, 06, 08, 09, 11, 12, 14, 15, 17, 18, 20, 21, 23, 24, 26, 27, 29, 30, 32, 33, 35, 36, 38, 39, 41, 42, 44, 45, 47, 48, 50, 51 | **Görev tanımı gereği** — `NN mod 3 == 1` dışındaki yollar KYY-2 ve KYY-3 denetçilerine ait. KYY-04/07 analizinde komşu yollara (KYY-06 `cancelReturn`, KYY-02 `createShipment`) yalnız **çizelgeyi kurabilmek için** bakıldı. |
| Canlı prod DB | Erişim yok (kural 2). Tüm K2 ölçümleri dev (`adnansahin_db`, 195 migration) ve prod'un **2026-08-25 kopyası** (`tekserp_saha_0825`, 190 migration) üzerinde. Son 5 migration'ın kolonları saha kopyasında yok → o alanlara dair K2 iddiası yapılmadı. |
| KYY-1-04 / -06 / -07 / -08 için repro | Sözleşme "en güçlü 2-4 aday" diyor; bütçe K3 değeri en yüksek üç bulguya ayrıldı. -04 ve -06'nın fixture maliyeti yüksek, -07 **global feature-flag'e yazmayı** gerektirir (sözleşme yasaklıyor), -08 S3. Dördü de K1: kod okumasıyla pencere kesin, koruma mekanizmalarının yokluğu grep ile teyit edildi. |
| `Electron/` ve `mobil/` istemci davranışı | Salt-okunur denetim backend'e odaklı. KYY-1-02'nin "token yapışma" adımı `mobil/src/offline/entryAttempt.ts` sözleşmesinden okundu, kod çalıştırılmadı. |
| Yük altında ölçüm (havuz doygunluğu, kilit bekleme süreleri) | Bu turun merceği doğruluk; performans H alanına ait. KYY-1-02'nin 5× retry maliyeti yalnız niteliksel olarak not edildi. |
| `pg_stat_statements` tabanlı sıcak satır analizi | Extension yüklü değil (KUNYE). |
| `assign-bulk` / `cancel-bulk` parçalı sonucun İSTEMCİDE gösterilip gösterilmediği | Electron kodu kapsam dışı; K alanına not bırakıldı. |
