# TUR 1 — KYY-2: Kritik yazma yolu 8-soru analizi (grup 2)

**Denetçi:** KYY-2 (kod merkezli mercek) · **Tarih:** 2026-08-28 · dal `adnansahin`, HEAD `ce8681d1`
**Kapsam:** `KRITIK-YAZMA-YOLLARI.md`'deki 51 yoldan **NN mod 3 == 2** olanlar →
KYY-02, 05, 08, 11, 14, 17, 20, 23, 26, 29, 32, 35, 38, 41, 44, 47, 50 (**17 yol**).
**Yöntem:** her yol için Prompt Bölüm 4'ün SEKİZ sorusu; cevaplar güncel koddan `dosya:satır` ile
yeniden türetildi (haritalar yalnız başlangıç noktası). "② endişe hipotezi" sütunu her yolda
açıkça **DOĞRULANDI / ÇÜRÜTÜLDÜ / KISMEN** olarak karara bağlandı.
**Salt-okunur:** kaynak ağaca dokunulmadı; tek yazma `Teks-Erp/scripts/audit_repro_KYY-2-*.ts`
(sözleşme gereği) + bu dosya. DB erişimi yalnız `audit/tools/sql-dev.sh` / `sql-saha.sh`.
**Feature-flag/SystemSetting DEĞİŞTİRİLMEDİ** (repro'lar `shipping.confirmationEnabled`'ı okuyup loglar).

## Koşturulan repro'lar (K3)

| Script | Log | Sonuç |
|---|---|---|
| `Teks-Erp/scripts/audit_repro_KYY-2-02.ts` | `audit/repro/KYY-2-02.log` | **ÇÜRÜTÜLDÜ** — 2 ve 5 eşzamanlı `createShipment`, 5 tekrar: Σ tahsis hep 100 = quantity |
| `Teks-Erp/scripts/audit_repro_KYY-2-26.ts` | `audit/repro/KYY-2-26.log` | **DOĞRULANDI** — 10/10 turda "0 bağ ama `type=ORDER_PRODUCTION`" |
| `Teks-Erp/scripts/audit_repro_KYY-2-08.ts` | `audit/repro/KYY-2-08.log` | **DOĞRULANDI** — 80 çağrının 36'sı PG deadlock → Prisma **P2039** → HTTP **500** |
| `Teks-Erp/scripts/audit_repro_KYY-2-32.ts` | `audit/repro/KYY-2-32.log` | **DOĞRULANDI + genişledi** — 11/11 ihlal; **SIRALI koşumda da** (yarış gerekmiyor) |

---

# 1. SEKİZ SORU — yol yol

Sütunlar: **(1)** korunan değişmez (K10 id) · **(2)** tx sınırı · **(3)** check-then-act ·
**(4)** kilit/claim (ve advisory ise İLK ifade mi) · **(5)** küme/aralık kararı (write skew) ·
**(6)** DB seddi (K2b) · **(7)** iki aktörlü çizelge değişmezi bozuyor mu · **(8)** fabrikadaki etki.

---

## KYY-02 — Sevkiyat oluşturma (PLANNED) + çuval tahsisi

| # | Cevap |
|---|---|
| **1** | INV-SEV-01 (`OL.shippedQty = Σ SA.qty[DISPATCHED]`), INV-SEV-02 (tahsis ⊆ ihtiyaç), INV-SEV-03 (Roll↔Sack↔Shipment), INV-SEV-09 (`sackNo`/`(shipmentId,seq)`), INV-SEV-10 (çuval içerik kilidi), INV-SEV-12/13 (EXPORT tartı / boş sevkiyat), INV-SEV-16 (belge donar). **INV-SEV-08 (Σ sevk ≤ quantity) BİLİNÇLİ ZORLANMIYOR** — K10 §"HİÇBİR YERDE ZORLANMAZ". |
| **2** | `shipping.service.ts:1376` giriş → **tx `:1401-1430`** (`withBarcodeRetry` sarmalı `:1400-1444`). **tx-ÖNCESİ:** replay okuması `:1383-1386`, `loadSacksForShipment` + hayalet guard `:1244-1257`, `assertExportWeighed` `:1391`, `assertOrdersBelong` `:1393`, `readShipmentConfirmationEnabled()` `:1396`. **tx-SONRASI:** `AuditService.log` `:1447`. Onay KAPALI (dev+saha: `false`) → `performDispatchTx` `:1427` **aynı tx**. |
| **3** | **EVET, dört tane.** (a) hayalet guard tx dışı — PLANNED-only rejimde tx-içi ikizi YOK (dispatch dalında `:1834` var); (b) EXPORT tartı tx dışı; (c) sipariş/şube uyumu tx dışı; (d) `confirmationEnabled` tx dışı okunur, tx'e yansımaz. |
| **4** | Sayaç `nextShipmentNo(tx)` `:1403` **kilitsiz max+1** (kilit yok, koruma `shipmentNo` unique + wBR). Çuval **claim döngüsü** `:1412-1418` `updateMany {id, shipmentId:null}` + `count!==1 → 409` — hepsi-ya-hiç ✓. **Sıra istemcinin `sackIds` sırası** (kanonik değil). **8023 sevkiyat kapsam kilidi bu yolda YOK** (yalnız `undoDispatch`/`createReturn` alır). |
| **5** | **EVET, iki küme kararı:** ① `computeSackAllocations` `:1305-1339` `need = quantity − shippedQty` — `shippedQty` yalnız DISPATCHED'ten türer; ② `writeShipmentAllocationsTx` sil-yaz. İzolasyon yükseltilmemiş, advisory kilit yok. **Fiili koruma tesadüfi:** `nextShipmentNo(tx)` tx İÇİNDE okunduğu için iki eşzamanlı kurulum aynı numarayı üretir → `shipments_shipmentNo_key` P2002 → `withBarcodeRetry` tüm tx'i yeniden koşar → ikinci tx birincinin commit'inden SONRA başlar ve `shippedQty`yi güncel okur. |
| **6** | `shipmentNo` unique ✓ · `clientToken` **düz** unique ✓ · `sacks(shipmentId,seq)` unique ✓ · `sack_allocations(sackId,orderLineId)` unique + CHECK `qty>0` ✓ · rolls/swatches `(sackId,shipmentId)` **DEFERRABLE** composite FK ✓ · **`Σ SA.qty ≤ OL.quantity` seddi YOK** · **statü geçiş seddi YOK** · `invoiceNo`↔status CHECK'i YOK. |
| **7** | **ÇÜRÜTÜLDÜ (bayrak KAPALI rejimde) — ölçüldü.** `audit_repro_KYY-2-02.ts`: SIRALI 2 çağrı → Σ=100; PARALEL 2 çağrı → Σ=100; 5 tekrar → 0 ihlal; **5 EŞZAMANLI** çağrı → Σ=100 ve numaralar `SVK2808260015..0019` kesintisiz sıralı (= tx'ler fiilen serileşti). **AMA:** koruma `nextShipmentNo`'nun tx İÇİNDE olmasına dayanıyor ve bu hiçbir yerde yazılı değil; barkod sayacında repo tam TERS kararı vermiş (`roll-barcode.helper.ts:47-64` "tx AÇILMADAN ÖNCE çağrılmak İÇİNDİR"). Aynı "iyileştirme" sevkiyat numarasına uygulanırsa çift tahsis ANINDA açılır. **Bayrak AÇIKKEN (PLANNED rejimi) çift tahsis zaten tasarım gereği** (K10 INV-SEV-02 notu) — orada yarış değil, kabul edilmiş davranıştır. **EVET olan iki ayrı çizelge var** (aşağıda bulgu): ① iptal edilmiş sevkiyat token replay'i, ② `dispatchShipment` ön-guard'larının tx içinde tekrarlanmaması. |
| **8** | Bugün: çift tahsis üretilemiyor. Yarın (numara üretimi tx dışına alınırsa): aynı sipariş satırına iki sevkiyat 100'er m tahsis eder, `shippedQty` 200 olur, muhasebe export'unda fatura satırı `Σ alloc × unitPrice` üzerinden **sipariş miktarının iki katını** faturalar. |

**② hipotezi:** (A) çift tahsis → **ÇÜRÜTÜLDÜ (K3)** · (A) ABBA-3 → **AÇIK** (çuval claim sırası istemciden; KYY-08'de aynı sınıf ÖLÇÜLDÜ) · (B) iptal edilmiş sevkiyat/sipariş token replay → **DOĞRULANDI** (bulgu KYY-2-07) · (H) 500 çuval tek tx → tavan `sackIds` 1..500 var, ölçülmedi · (C) `ON UPDATE CASCADE` → C-alanı, sınır ötesi.

---

## KYY-05 — İade + toplu iade (`createReturn`)

| # | Cevap |
|---|---|
| **1** | INV-SEV-05 (BRÜT kuralı; `RR.qty` = iade anındaki `currentQty`, kısmi iade YOK), INV-SEV-06 (storno ≠ iade), INV-DOC (`RETURN_DISPATCH` iade ANINDA donar, grup lideri tek belge). |
| **2** | `return.service.ts:481` giriş → **tx `:490-576`**. tx-ÖNCESİ: top yüklemesi + `status===SHIPPED` + `shipmentId` guard'ları `:385-397`, tek-sevkiyat kuralı `:401`, sipariş atfı, kalite `isActive` `:470-476`. tx-SONRASI: satır başına audit `:576+`. |
| **3** | EVET ama **zararsız**: statü kontrolü tx dışı, asıl yazım koşullu `updateMany {id, status:SHIPPED}` `:501` — beceri §1 "öndeki `findFirst` savunma katmanıdır" karşı-örneği. Kalite `isActive` okuması tx dışı (master-data pasifleşme penceresi, S4). |
| **4** | **`lockShipmentScopeTx(tx, lockShipmentId)` `:490` = tx'in İLK ifadesi** ✓ (`pg_advisory_xact_lock(8023, hashtext(shipmentId))`, `shipment-locks.helper.ts:56-60`). Sonra **R tekil claim döngüsü** `:501` `{id, SHIPPED}` + `count===0 → throw` (grup tamamı rollback ✓). Kilit `undoDispatch:2160` ile AYNI → iki akış serileşir. |
| **5** | EVET — `undoDispatch` tarafındaki `rollReturn.count` phantom'u; 8023 tam bunun için var ve **sıra load-bearing, doğru yerde** (helper `:44-54` gerekçeyi ve üretilmiş vakayı yazıyor). |
| **6** | `roll_returns` CHECK `qty>0` ✓ · FK `rollId` RESTRICT ✓ · **`clientToken` YOK** · aktif-iade tekilliği için unique YOK (koruma `status=SHIPPED` claim'i — yeterli, çünkü iade edilen top SHIPPED'ten çıkar). |
| **7** | **HAYIR.** İki eşzamanlı iade aynı topa: 8023 aynı sevkiyatta serileştirir, ikincide `flip.count===0` → 409, çift `RollReturn` yazılmaz. Farklı sevkiyatlar farklı kilit anahtarı alır ama küme de ayrık. `freezeForSource(RETURN_DISPATCH, leaderId)` — `sourceId` grup liderinin id'si, çakışmaz. |
| **8** | Doğru çalışıyor. Kalan iki nokta bulgu (KYY-2-16): `clientToken` yokluğu → tablet zaman aşımında ikinci istek 409 alır, operatör "kaydolmadı" sanır; `if (lockShipmentId)` koşulu **ölü savunma** — ön guard `:394` `shipmentId`siz topu zaten reddediyor. |

**② hipotezi:** (A) "doğrudan-sevk / `shipmentId`'siz iade kilitsiz" (K12 H1) → **ÇÜRÜTÜLDÜ**: `createReturn` `shipmentId` NULL topu `:394-396`'da **400 ile reddeder**, yani o top hiç iade edilemez → kilitsiz yol yok. (Bunun kendisi ayrı bir işlevsel boşluktur: fasondan doğrudan sevk edilen mal iade alınamıyor → E-alanına sınır ötesi not.) · (B) token yok → **DOĞRULANDI** (S3) · (E) BRÜT/`RR.qty` semantiği → E-alanı.

---

## KYY-08 — Çuval içerik işlemleri (aç · okut/taşı · toplu taşı · böl · tart · sil · dağıt)

| # | Cevap |
|---|---|
| **1** | INV-SEV-10 (**depo çuvalı içeriği yalnız `touchWarehouseSackTx` altında; taşımada kaynak+hedef kilitlenir**), INV-SEV-09 (`sackNo` tekil), SM-05, `roll.sackId ⇒ status ∉ SACK_ABSENT` (yalnız KOD: `sack-invariants.helper.ts:35-44`). |
| **2** | Her uç kendi interactive tx'i: `scanIntoSack` `:513-524` / `:534-545`, `moveRollToSack` `:689-696`, `distributeSackContents` `:725-746`, `moveRollsToSack` `:768-778`, `splitSack` `:830-861` (wBR sarmalı), `removeSack` `:1001-1019`. Audit hepsinde tx SONRASI. |
| **3** | EVET — her uçta çuvalın `shipmentId`'si tx DIŞINDA okunuyor (`:481`, `:685-687`, `:762-767`, `:805`); ama otorite tx içindeki `touchWarehouseSackTx` (WHERE `shipmentId IS NULL`, 0 satır → 409) ve `removeSack`'te kilit altında **taze sayım** `:1013-1014` (yorum bunu açıkça söylüyor). `splitSack` de kilit altında taze `fresh`/`claimable` sayıyor `:834-838`. |
| **4** | `touchWarehouseSackTx` = satır kilidi + koşullu claim ✓. **SIRA:** `moveRollToSack` `:690-691` **kaynak → hedef**, `moveRollsToSack` `:769-770` **kaynak → hedef** — ikisi de **istekten gelen sıra, kanonik değil (id ASC değil)**. `scanIntoSack` taşıma dalı **yalnız HEDEFİ** kilitler `:514` (kaynak çuval kilitsiz — K3a #18). `splitSack` yalnız kaynağı `:832`. |
| **5** | EVET — `splitSack`'in "kaynakta en az bir top kalmalı" kuralı ve `removeSack`'in "boş mu" kararı küme kararıdır; ikisi de **kilit altında taze sayımla** kurulmuş ✓. Tek açık: `scanIntoSack` kaynağı kilitlemediği için bir top, `splitSack` kaynağı kilitliyken bile çuvaldan ÇIKARILABİLİR. |
| **6** | `sacks.sackNo` unique ✓ · `clientToken` düz unique ✓ · `(shipmentId,seq)` unique ✓ · `(id,shipmentId)` bileşik FK hedefi ✓ · CHECK `weightKg ≥ 0` ✓ · **`roll.sackId ⇒ status ∉ SACK_ABSENT` DB seddi YOK** (yalnız kod). |
| **7** | **EVET — ölçüldü.** Çizelge: `T1 moveRollToSack(rA, A→B)` `:690` `touchWarehouseSackTx(A)` [A satır kilidi] → **await = yield** → `T2 moveRollToSack(rB, B→A)` `:690` `touchWarehouseSackTx(B)` [B kilidi] → `T1 :691 touch(B)` **bekler** → `T2 :691 touch(A)` **bekler** → PG deadlock detector. `audit_repro_KYY-2-08.ts`: 40 turda 80 çağrının **36'sı** deadlock. Prisma sınıfı `PrismaClientKnownRequestError` **code `P2039`** — `error.middleware.ts`'in P2034 dalı (`:517` → 409 "tekrar deneyin") **HİÇ ÇALIŞMIYOR**, kod sınıflandırılmamış dala düşüyor (`:563-585`) → **HTTP 500 "Sunucu hatası oluştu."** + SYSTEM/ERROR audit. |
| **8** | Paketleme masasında iki tablet ters yönde top taşırken operatör "Sunucu hatası" görür (yeniden dene demiyor), taşıma yapılmamıştır ama neyin olduğu görünmez; 5xx sayacı da şişer. Veri bozulmuyor (repro D2: 6/6 top yerinde) — **etki kullanılabilirlik + yanlış hata sınıfı**. |

**② hipotezi:** (A) ABBA-2 → **DOĞRULANDI (K3)** · (A/D) `splitSack`/`moveRollsToSack` sessiz kısmi → **KISMEN**: `moved` sayısı yanıtta ve mesajda basılıyor ("3 top taşındı"), atlananların KİMLİĞİ yok → beceri §3.2'ye göre "tam sessiz" değil, S4 not · INV-SEV-10 ihlali (scanIntoSack kaynağı kilitlemiyor) → **KISMEN ÇÜRÜTÜLDÜ**: top claim'i `{id, sackId:from, shipmentId:null}` atomik olduğu için içerik kaybı/çift sayım üretmiyor; kalan gerçek etki `splitSack`in "en az bir top kalsın" kuralının delinebilmesi (sonuç: boş çuval, veri bozulmuyor) → S4.

---

## KYY-11 — Fason kalan kapama (`closeRemainder`)

| # | Cevap |
|---|---|
| **1** | INV-FAS (kalem kapanışı `remainderClosedAt`, `openQty`'ye girmez), FAS-02 açık-sevk tek kaynak, sapma defteri (`RollVariance` SCRAP/`SUBCONTRACTOR_REMAINDER`), adım/WO kapanışı. |
| **2** | `subcontractor.service.ts:3399` → **tx `:3399-3501`**; `validateVarianceReason` `:3393` tx ÖNCESİ (helper içinde tekrar ✓); audit `:3501+`. |
| **3** | EVET ama kapatılmış: `step.workOrder.steps` (nextStep hesabı) tx dışı `:3478` — yalnız "sonraki adım var mı"yı belirler; adım kümesi tx içinde değişirse WO kapanışı `completeWorkOrderIfStepsDone` terminal-guard'lı olduğu için yanlış COMPLETED üretmez. |
| **4** | **`touchWorkOrderTx(tx, step.workOrderId)` `:3401` = tx'in İLK ifadesi** ✓ → fason `dispatch`/`receive`/`cancelBulk`/WO iptali ile aynı satırda serileşir. Sonra **kilit altında taze okuma** `:3404-3418` (status + `currentStepId`) → **R claim** `:3420` `{id, AT_SUBCONTRACTOR}` + `count!==1 → 409`. |
| **5** | EVET — `stillAtSubcontractor` sayımı `:3470` bir KÜME kararıdır (phantom'a açık) **ama** o kümeye satır ekleyen tüm yollar (fason sevk `:1041`, kısmi kabul `:2016`, per-roll split) aynı WO satırını kilitliyor → phantom kapalı. |
| **6** | `roll_variances` CHECK `qty>0` ✓ · `rollId` RESTRICT ✓ · `subcontractor_dispatch_items.remainderClosedAt` **`updatedAt` YOK** (K2a H14) · `sourceRefId` unique DEĞİL (bilinçli). |
| **7** | **HAYIR.** `closeRemainder ∥ receive(kısmi)` aynı top: WO kilidi serileştirir; ikinci akış claim'de `AT_SUBCONTRACTOR` bulamaz → 409. Claim WHERE'inde `currentStepId` yok ama kilit altındaki taze okuma `:3410-3413` onu doğruluyor ve `currentStepId`'yi değiştiren tüm yollar aynı WO kilidini alıyor → hipotez ("taşınmış top") **ÇÜRÜTÜLDÜ**. |
| **8** | Doğru çalışıyor. Kalan iz sorunu: `remainderClosedAt` yazımı `updatedAt`'i tazelemiyor → CLAUDE.md'nin "Ham Stok DIŞINDAKİ sekmeler `updatedAt desc`" kuralı gereği kapatılan kalem listenin dibinde kalır (C-alanı, sınır ötesi). |

**② hipotezi:** (A) claim `currentStepId` pinlemiyor → **ÇÜRÜTÜLDÜ** (WO kilidi kapsıyor) · (E) karne/`openQty` uyumu → E-alanı · (C) `sourceRefId` unique değil → bilinçli.

---

## KYY-14 — Tambur finalize (üretim bildirimi / final ürün)

| # | Cevap |
|---|---|
| **1** | K10: `currentQty ≥ 0`, kesim toplamı, "her rota final üretir", `QualityGrade.targetStatus`, `roll_operations(rollId,stepId,type)` tekilliği, WO terminal guard, `finalizedAt` trigger'ı, plan-sapma defteri (`confirmationId` çift-sayım kilidi). |
| **2** | `tambur.service.ts:540` → barkod rezervasyonu **tx ÖNCESİ** `:906` (`reserveRollBarcodesInOrder(prisma)`, bilinçli — `roll-barcode.helper.ts:47-64` ölçümlü gerekçe) → **tx `:925-1291`** → audit `logMany` `:1299/:1309/:1326` (child audit'leri tx İÇİNDE toplanıp SONRA emit ediliyor `:918-921` — rollback'te hayalet audit kalmasın diye ✓). |
| **3** | EVET, ve **hepsi tx içinde ikizleniyor**: WO iptal guard'ı `:934-943` (`freshWo`), metraj `:981-988` (`freshQtyRow`, bayat toplam → 409). Bu, projenin en olgun check-then-act kapatması. |
| **4** | **`touchWorkOrderTx` `:931` İLK** ✓ → **R claim** `:953-961` `{id, IN_PRODUCTION, currentStepId}` → `TAMBUR_CONSUMED`; `count===0` iki dala ayrılıyor: `TAMBUR_CONSUMED` ise **idempotent** (`raceLost` `:967`), değilse 409 `:971`. Kilit sırası **WO → roll** (kardeşlerle tutarlı). |
| **5** | EVET — "bu adımda başka top kaldı mı" / WO kapanışı küme kararı; WO satır kilidi + `completeWorkOrderIfStepsDone` terminal guard'ı ile kapatılmış (yorum `:926-931` bunu açıkça yazıyor). |
| **6** | `rolls.barcode` unique ✓ · `clientToken` partial unique ✓ · CHECK `qty ≥ 0` ✓ (**`currentQty ≤ initialQty` CHECK'i YOK** — aşım meşru) · `roll_operations(rollId,stepId,type)` unique ✓ · movement partial unique ✓ · `finalizedAt` trigger ✓. |
| **7** | **HAYIR (ana yol).** İki eşzamanlı `finalize` aynı topa: WO kilidi + claim → biri idempotent yanıt, diğeri iş yapar; mükerrer child üretilmiyor. `finalize ∥ cutWarehouseRoll`: `freshQtyRow` eşitsizliği 409 veriyor. **Kısmi EVET (yan kol):** `finalizeWarehouseCut` `:2343` **WO'suz** çalışır; ön kapı `parent.status === TAMBUR_CONSUMED → idempotent success` `:2374-2379` tx DIŞINDA → iki gerçek paralel çağrıda ikisi de kapıyı geçer, ikisi de **tx ÖNCESİ barkod rezerve eder** `:2461-2467`, biri claim'i `:2404` kaybedip **409** alır (idempotent success DEĞİL) ve bir barkod numarası yanar. Bu, sıralı retry ile paralel retry'ın FARKLI cevap vermesidir. |
| **8** | Ana yol güvenli. Yan kolda: tablet aynı kesimi ikinci kez gönderirse (paralel) "Top bu sırada başka bir işlemle değişmiş" 409'u görür; sıralı gönderirse "idempotent retry" başarısı görür — aynı fiziksel olaya iki farklı cevap. Ayrıca replay yanıtı `remainingChild: null, remainingQty: 0` döndürdüğü için **kalan parçanın barkodu istemciye hiç ulaşmaz** (yorum `:2376-2378` bunu kabul ediyor). |

**② hipotezi:** (B) `finalizeWarehouseCut` replay + numara yakma → **DOĞRULANDI**, ama K3b H-5'in "mekanizma yerinde değil" iddiası **KISMEN ÇÜRÜTÜLDÜ**: mekanizma VAR (statü kapısı `:2374`), **yanlış olan YORUMDUR** — `:2451/:2457` var olmayan bir `clientToken` yolunu anlatıyor (`grep clientToken` fonksiyon gövdesinde yalnız yorumlarda: `:2451`, `:2457`). Bulgu KYY-2-15. · (E) açık RollError / `width` plan eni / rework `finalizedAt` → E-alanı · (A) `RollProperty` replace CHOICE'ları siliyor mu → `:1208` FLAG evreniyle sınırlı olup olmadığı bu turda okunmadı → **kapsanmadı**, D-C/D-E'ye not.

---

## KYY-17 — Manuel top ekleme (Tambur) / kartsız üretim

| # | Cevap |
|---|---|
| **1** | PAR-04 (parti bağlama), "envanter zincirindeki tek delik" izlenebilirliği, `entryReasonCode` rapor anahtarı, WO/adım statü türetimi, idempotency (`clientToken` ZORUNLU). |
| **2** | **İKİ tx, bilinçli:** FAZ 1 `createInitialEntry` `:1062` (KYY-01'in tx'i) → **FAZ 2 tx `:1113-1207`** → audit `:1210+`. Aradaki pencere tasarlanmış (idempotent tekrar FAZ 2'yi bağlar). |
| **3** | EVET — `fresh` okuması `:1114-1126` tx içinde ✓; idempotent dal `:1127-1145` ("zaten bu adımda") → hareket garanti et, çık. |
| **4** | **R claim** `:1149-1167` `{id, status ∈ {STOCK,WAREHOUSE}, sackId:null, shipmentId:null, currentStepId:null}` + `count===0 → 409 ROLL_STATE_CHANGED` ✓. **`touchWorkOrderTx` `:1191` — claim'den SONRA.** |
| **5** | EVET — `recomputeStepStatus` `:1192` + `ensureWorkOrderInProgress` `:1193` + COMPLETED→IN_PROGRESS `:1194` küme kararlarıdır; WO kilidi bunlardan ÖNCE alındığı için kendi içinde tutarlı. |
| **6** | `rolls.clientToken` partial unique ✓ · `entryReasonCode` VARCHAR(64), sunucu türetir ✓ · movement partial unique ✓. |
| **7** | **EVET (kilit sırası tersliği).** Ölçülmüş kardeşi KYY-08'dir; buradaki çizelge: `T1 workorder.softDelete` `:3387` WO claim'i [**WO satır kilidi**] → … → `:3513` topların blanket `updateMany`'si [**roll satırları**]. `T2 createManualRoll` FAZ 2 `:1149` roll claim'i [**roll satırı**] → `:1191 touchWorkOrderTx` [**WO satırı bekler**]. T1 aynı topu blanket update ile talep ederse iki yönlü bekleme → PG deadlock → (KYY-08'de ölçüldüğü gibi) **P2039 → HTTP 500**. Grep kanıtı: `touchWorkOrderTx` 30 çağrı yerinin 29'unda tx'in ilk/erken ifadesi; **tek istisna `tambur-manual.service.ts:1191`**. |
| **8** | Tambur'da "manuel top ekle" ile aynı iş emrinin iptali/finalize'ı çakışırsa operatör "Sunucu hatası" görür; top FAZ 1'de yaratılmış olduğu için **STOK'ta yetim kalır** (belgeli davranış, idempotent tekrar bağlar — ama tekrar gelmezse envanterde sahipsiz top). |

**② hipotezi:** (A) H-11 kilit sırası istisnası → **DOĞRULANDI (K1; aynı sınıf KYY-08'de K3)** · (D) FAZ 1/FAZ 2 yarımlığı → belgeli, S3 not · (B) KK1 tuzağının dahili çağrıda kapalı olması → F221 deseni, bilinçli.

---

## KYY-20 — İş emri oluşturma + Hızlı İş Emri + IE numarası + refakat kartı

| # | Cevap |
|---|---|
| **1** | `workOrderNumber` tekilliği (IE+GGAAYY+NNNN), WO-05 (bir WO = tek kart), CHECK `work_orders_stockprod_targetItem`, "tip = bağın aynası", rota kapsaması (UYARI). |
| **2** | `workorder.service.ts:988` → **wBR `:988` + tx `:988-1110`**; replay `resolveCreateTokenReplay` `:1146` **tx dışı** (`isActive:false → 409` `:1172` ✓); audit `:1110`. `quickStart` `:1209` **tx-DIŞI ZİNCİR** (belgeli `:1204-1207`): `create()` tx → `attachRolls()` tx → telafi `hardDelete()` `:1379/:1384` (hata yalnız `console.error` `:1366`) → opsiyonel `dispatch()` tx. |
| **3** | EVET — rota/ürün/renk/özellik/istasyon-yetenek doğrulamaları `:686-971` **tx ÖNCESİ**, tx'te tekrarlanmıyor (master-data pasifleşme penceresi). Manuel WO no ön-kontrolü `:984` + DB unique ✓. |
| **4** | **Kilit YOK.** Numara `generateWorkOrderNumber()` `:989` → `:582` `prisma.workOrder.findMany` + `:592` `prisma.workOrder.findUnique` — **HAVUZ client'ı, tx AÇIKKEN**. Koruma: `workOrderNumber` unique + wBR (5 deneme). |
| **5** | EVET — "bugünün en büyük IE no'su" bir küme kararıdır (phantom); izolasyon yükseltilmemiş, advisory kilit yok. Koruma tamamen unique + retry (meşru desen). |
| **6** | `workOrderNumber` unique ✓ · `clientToken` partial unique ✓ · CHECK `work_orders_stockprod_targetItem` ✓ · `traveler_cards.workOrderId/cardNumber/barcode` unique ✓ · `(workOrderId, stepSequence)` unique + CHECK time_order ✓. |
| **7** | **EVET, ama numara yarışı DEĞİL — HAVUZ.** Çizelge: N eşzamanlı `POST /api/work-orders` → her biri `$transaction` açıp bir havuz bağlantısı tutar → `:989` içinde **ikinci bir bağlantı** ister. `pg.Pool max 30`, `connectionTimeoutMillis 5000` (`lib/prisma.ts:69-71`). 30 tx aynı anda açıksa 31. bağlantı hiç gelmez → 5 sn sonra `classifyPoolTimeout` → **503**, ve tx'ler kendi kendilerini bekletir. Bu tam olarak repo'nun kendi ölçtüğü tuzaktır: `roll-barcode.helper.ts:56-64` "30 eş zamanlı işlemin **yalnız 3'ü** tamamlandı, kalanı `timeout exceeded when trying to connect` aldı (ölçüldü)". **Aynı dosyada tx ikizi `workorder-clone.helper.ts:31 generateWorkOrderNumberTx` YAZILMIŞ ama `create()` onu kullanmıyor.** İkinci havuz çağrısı: `resolvePlanDates` `:395` → `readWorkOrderDefaultPlanDurationDays()` **argümansız** (`system-setting.service.ts:2925` `tx?` parametresi kabul ediyor, verilmiyor). |
| **8** | Saha ölçeği (saha kopyası): en yoğun gün **21 iş emri** → bugün 30 eşzamanlı açılış gerçekçi değil, olasılık **düşük**. Ama tetiklendiğinde etki **sistem geneli**: havuz tükendiği için ilgisiz uçlar da 503 döner ve durum kendi kendini besler (bekleyen tx'ler bağlantıyı bırakmaz). |

**② hipotezi:** (D/H) tx içinde havuz client'ı → **DOĞRULANDI (K1)**; "tek satırlık düzeltme adayı" tespiti de doğru (`generateWorkOrderNumberTx(tx)` + `readWorkOrderDefaultPlanDurationDays(tx)`) · (D) quickStart telafi `hardDelete` düşerse yetim WO → **DOĞRULANDI**, `console.error` `:1366` tek iz (I-alanı) · (B) IE no yarışı → unique+wBR ile kapalı ✓ · (E) rota kapsaması uyarıya indi → bilinçli.

---

## KYY-23 — İş emri iptali + arşiv

| # | Cevap |
|---|---|
| **1** | WO terminal geçiş kuralı (CANCELLED/SUPERSEDED terminal — yalnız KOD), kapanış dispozisyonu altılısı, fason hard-block, `rolls.cancelledAt/cancelReasonCode` izi (AUD-04), `traveler_cards.status` VOIDED. |
| **2** | `workorder.service.ts:3295` → **tx `:3376-3585`**. ⚠️ **tx-ÖNCESİ YAZMA:** `prepareFasonCancelDecision` `:3367` → içinde ① `SubcontractorService.cancelBulk` `:3253` (**N ayrı tx**), ② `prisma.roll.updateMany` `:3281` (**havuz, koşulsuz `where id in`**, AT_SUB/RETURNED → IN_PRODUCTION). Audit `:3569` + top başına `:3585`. |
| **3** | EVET — `stepIds` `:3322`, `resolveReasonCode` `:3333` tx dışı (ikincisi salt okuma ✓). Asıl sorun (3) değil (2): **tx dışı YAZMA**. |
| **4** | **W claim İLK** `:3387` `updateMany {id, status notIn [COMPLETED,CANCELLED,SUPERSEDED]}` → CANCELLED, `count===0 → 409` ✓ (yorum `:3377-3385` sıranın neden load-bearing olduğunu doğru anlatıyor). Sonra fason in-flight sayımı **kilit altında** `:3423`, dispozisyon motoru `applyRollDispositionsTx` `:3491` (çoklu claim `{id in, IN_PRODUCTION, shipmentId:null, sackId:null}` + `count!==len → 409`). |
| **5** | EVET — "bu WO'da hâlâ fasonda top var mı" küme kararı; WO satır kilidi altında okunduğu için commit'li dispatch'leri görüyor ✓. |
| **6** | **WO enum geçiş seddi YOK** (terminal kural yalnız kodda) · movement raw UPDATE `updatedAt` tazelemiyor · `traveler_cards.status` VOIDED. |
| **7** | **EVET.** Çizelge: `T1 softDelete(WO)` → `:3367 prepareFasonCancelDecision` → `cancelBulk` COMMIT eder (fason sevkleri iptal, `SubcontractorDispatch.cancelledAt` yazıldı) → `:3281 roll.updateMany` COMMIT eder (toplar `AT_SUBCONTRACTOR` → `IN_PRODUCTION`) → **await = yield** → `T2 tambur.finalize` (son top) WO'yu `COMPLETED` yapar ve commit eder → `T1 :3387` claim `status notIn [COMPLETED,…]` → **`count===0` → 409**, tx rollback. **SONUÇ:** iş emri hâlâ canlı (COMPLETED) ama açık fason sevkleri iptal edilmiş ve fasondaki toplar `IN_PRODUCTION` yazılmış. Geri sarılmaz (K3a #1). Aynı sonuç, iki kullanıcının aynı anda iptal etmesiyle de doğar (ikincisi 409 alır, ama ilkinin tx'i düşerse aynı yarım durum). |
| **8** | Mal fiziksel olarak boyahanede dururken sistem "üretimde, içeride" der; fason karnesi ve açık-sevk listesi o sevki kapalı gösterir; kalan mal kabul edilemez hale gelir (kabul, açık sevk kalemi arar). Kullanıcı yalnız "İş emri tamamlanmış" 409'unu görür — yapılan yazımlardan haberi olmaz. Ek: `cancelBulk`'ın döndürdüğü `failed[]` **hiç okunmuyor** (`:3253` dönüş değeri atılıyor) → kısmi başarı sessiz. |

**② hipotezi:** (D) tx dışı fason kararı → **DOĞRULANDI (K1, 1. sıra hotspot teyit)** · (A) tambur-undo ile ABBA → KYY-17 ile aynı sınıf, bu turda ölçülmedi · (I) `cancelledAt` izinin `hardDelete`'te yazılmaması → I-alanı · (F) gövdesiz DELETE / `/permanent` Swagger yalanı → F-alanı.

---

## KYY-26 — Sipariş bağla / sök + tip aynası

| # | Cevap |
|---|---|
| **1** | **"Tip = bağın aynası"** (`WorkOrder.type = ORDER_PRODUCTION ⇔ ∃ bağ`; CLAUDE.md 2026-08-21, bekçi `test_consistency_derived §21`), CHECK `work_orders_stockprod_targetItem`, `PLAN_CHANGE_FROZEN_STATUSES`, `TravelerCard.contentDirty`. |
| **2** | `workorder-link.service.ts:375` → **link tx `:375-392`**; `:453` → **unlink tx `:453-473`**; override zinciri **tek tx DEĞİL** (belgeli). Audit `:392` / `:473`. |
| **3** | **EVET, üç tane ve hiçbiri tx'te tekrarlanmıyor:** ① `loadWo` + `assertPlanEditable(wo)` `:279` / `:434` (FROZEN = CANCELLED, SUPERSEDED — `:63-66`); ② kumaş/renk/iptal-kalem doğrulamaları `:281-342`; ③ **`lastLinkOfOrderWo` kararı `:445`** (`links.length === 1`) — tx DIŞINDA okunan diziden. |
| **4** | **WO satırı KİLİTLENMİYOR.** `grep touchWorkOrderTx src --include='*.ts'` → 30 vuruş, `workorder-link.service.ts` **HİÇ YOK**. Link tarafında tip flip'i `updateMany {id, type:STOCK_PRODUCTION}` `:380-384` (tip claim'i ✓ ama **statü guard'sız**); unlink tarafında `delete` (PK) `:454` + tx içinde **taze `remaining` sayımı** `:462` + `updateMany {id, type:ORDER_PRODUCTION}` `:463-467`. |
| **5** | **EVET — write skew tam burada.** Karar ("son bağ mı") tx DIŞINDA bir KÜME üzerinden veriliyor; tx içindeki taze sayım yalnız `lastLinkOfOrderWo === true` dalında koşuyor. İki eşzamanlı unlink de `links.length === 2` görür → ikisi de `lastLinkOfOrderWo = false` → **tip flip bloğuna HİÇ girilmez**, ikisi de kendi bağını siler. |
| **6** | `work_order_to_order_lines` PK `(workOrderId, orderLineId)` ✓ (link tarafını idempotent yapar) · `orderLineId` FK **Cascade** · CHECK `work_orders_stockprod_targetItem` ✓ ama **bu çizelgeyi yakalayamaz** (flip hiç denenmiyor) · **tip↔bağ için DB seddi YOK**. |
| **7** | **EVET — ÖLÇÜLDÜ (K3).** `T1 unlinkOrderLine(WO, L1)`: `:435 loadWo` → `:439 links = [L1,L2]` → `:445 lastLinkOfOrderWo = false` → **await = yield**. `T2 unlinkOrderLine(WO, L2)`: aynı okuma, aynı karar. `T1 tx :454 delete(L1)` commit · `T2 tx :454 delete(L2)` commit. **SONUÇ: 0 bağ, `type = ORDER_PRODUCTION`.** `audit_repro_KYY-2-26.ts`: 10 paralel turun **10'unda** ihlal; §21 ikizi mutabakat sorgusu 10 tutarsız WO döndü. SIRALI kol temiz (2/2 doğru) → fark **yalnız eşzamanlılıktan**. **İkinci çizelge (aynı kök):** `T1 unlink(son bağ)` `:462 remaining=0` → flip STOK · `T2 link(yeni satır)` pre-tx `wo.type=ORDER` gördüğü için `:379` flip bloğuna girmez → **1 bağ ama `type=STOCK_PRODUCTION`**. **Üçüncü:** `T1 softDelete(WO)` CANCELLED · `T2 linkOrderLines` (assertPlanEditable pre-tx geçmiş) → **iptal edilmiş WO'ya bağ eklenir + tip flip edilir**, `markTravelerCardDirtyTx` VOIDED karta yazar. |
| **8** | Liste/künye/refakat kartı "Siparişe Özel" basar, detayda bağlı sipariş yoktur; iş emri **Stok sekmesinde de görünmez** (tip filtresi ORDER der) → planlamacı iş emrini kaybeder. `test_consistency_derived §21` kırmızıya döner ve düzeltme ancak `scripts/fix_workorder_type_from_links.ts --apply` ile elle yapılır. Ters yönde: siparişe bağlı iş emri "Stok" görünür → sipariş karşılama raporunda üretim görünmez. |

**② hipotezi:** (E) CANCELLED/COMPLETED WO'ya eşzamanlı bağ → **DOĞRULANDI (K1)** · (E) STOK'a dönüşte CHECK ihlali → **ÇÜRÜTÜLDÜ**: flip hiç denenmediği için CHECK devreye girmiyor; kaçan şey hata değil **sessiz tutarsızlık** · (A) link∥unlink∥`cancelOrderLine` ABBA → **KISMEN**: WO kilitsiz olduğu için ABBA değil **lost decision** üretiyor · (D) override zinciri kısmi durum → belgeli.

---

## KYY-29 — Sipariş oluşturma + hızlı sipariş (`quickOrderFromRolls`)

| # | Cevap |
|---|---|
| **1** | `orderNumber` tekilliği (SIP+GGAAYY+NNNN), `order_lines` CHECK `quantity>0` / `shippedQty≥0`, idempotency (`clientToken`), hızlı siparişte "top gerçekten serbest" garantisi. |
| **2** | `order.service.ts:1799` `create` → wBR closure `:1942-1971` (**tx-dışı iş her retry'da tekrar koşuyor**), P2002 → `resolveCreateTokenReplay` `:2026`. `quickOrderFromRolls` `:2080` → **claim tx `:2145-2168`** → **`create()` tx DIŞINDA** `:2173` (belgeli kabul `:2134-2140`). |
| **3** | EVET — müşteri/şube/ürün/renk doğrulamaları **claim'den ÖNCE** koşuyor `:2140-2144` (F143 kararı: create'in fırlatabileceği her şeyi claim'den önce koştur ✓ — bu doğru bir tasarım). |
| **4** | `quickOrderFromRolls`: **R çoklu claim** `:2146-2168` `{id in, STOCK, shipmentId:null, currentStepId:null}` + `count!==len → 409` + kaçanların barkodları mesajda ✓. **`sackId` claim WHERE'inde YOK** (ön kontrol `:2107`'de var). `create`: kilit yok, `orderNumber` unique + wBR. |
| **5** | EVET — "bugünün en büyük SIP no'su" phantom; unique+retry ile kapalı (meşru). |
| **6** | `orders.orderNumber` unique ✓ · `clientToken` **partial** unique ✓ · `order_lines` CHECK `quantity>0`, `shippedQty≥0` ✓ · `orderId` Cascade · `orders_active_createdAt_idx` **sahada YOK**. |
| **7** | **EVET — idempotency 4. durumu.** `resolveCreateTokenReplay` `:2026-2060` yalnız `customerId + branchId + satır sayısı` karşılaştırır; **`status`'a HİÇ BAKMAZ**. Çizelge: `T1` sipariş açar (token X) → kullanıcı siparişi İPTAL eder (`status=CANCELLED`) → `T2` (mobil kuyruk / "Tekrar Dene") aynı token X ile gelir → P2002 → replay → **`success: true` + iptal edilmiş siparişin kimliği**. Kardeş yolda koruma VAR: `workorder.service.ts:1172` `isActive:false → 409`. **Asimetri kanıtı.** `sackId` pinlenmemesi ise gerçek bir açık DEĞİL: `scanIntoSack` topu çuvala alırken `status` STOCK kalır ama claim `sackId`'ye bakmadığı için çuvaldaki top WAREHOUSE'a çekilebilir → INV-SEV-10/`sack-invariants` ihlali (S3, aşağıda not). |
| **8** | Saha kopyasında **4 iptal edilmiş siparişin `clientToken`'ı duruyor** (269 tokenli / 278 sipariş) → ön koşul canlıda mevcut. Operatör "Sipariş açıldı: SIP…" mesajını görür, sipariş listesinde yoktur; mal hazırlanır, karşılığı olmayan bir sevkiyat kurulur. |

**② hipotezi:** (B) "iptal edilmiş siparişin token'ı — `resolveCreateTokenReplay` statüye bakıyor mu (② okusun)" → **OKUNDU: BAKMIYOR → DOĞRULANDI** · (D) O2 yetim WAREHOUSE topu → belgeli kabul; retry'da token replay `create`'i bulur (claim bloğu `stockRollIds` boş olduğu için atlanır) → tutarlı · (F) Zod'suz gövde → F-alanı · (E) `branchId` opsiyonel → C-alanı.

---

## KYY-32 — Manuel top düzeltme · kurtarma · iptal · fire · geri alma · arşiv · satışa hazırlama

| # | Cevap |
|---|---|
| **1** | `currentQty ≥ 0` (CHECK), **`currentQty ≤ initialQty` CHECK'i YOK**, "kısmen tüketilmiş topun metrajı düzeltilemez" (`rollWhole`), statü kapsam kuralı (ALWAYS_BLOCKED / FREE_STOCK / süpervizör), `cancelledAt/cancelReasonCode` izi, `preCancelStatus`. |
| **2** | I4 `applyManualProperties` `inventory.service.ts:3659` → **tx `:3916-3956`** (audit `:3961` tx dışı). I2 `softDelete` `:3175-3332`; I3 `hardDelete` `:3549-3625`; I6 `rescueStuckRoll` `:4372-4450`; `restoreCancelledRoll` / `prepareRawForSale` **tx'siz tekil claim** (belgeli). |
| **3** | **EVET, ve kritik olan burada:** I4'te statü kapsamı `:3733-3762`, `rollWhole` `:3783`, metraj kararı `:3866-3868` — **hepsi tx DIŞINDA okunan bayat `roll` satırından**. tx içinde yalnız `shipmentId`/`sackId` tazeleniyor `:3921-3928`. |
| **4** | I4: [çuvaldaysa **S** `touchWarehouseSackTx` `:3927`] → **R claim** `:3932-3936` `{id, shipmentId: null, sackId: cur.sackId}` + `count===0 → 409`. **`status` ve `currentQty` WHERE'de YOK.** I2: **W(sıralı, id ASC)** `:3201` → **R claim** `:3253` `{id, status: existing.status, shipmentId: existing.shipmentId}` (gözlenen statüye pin ✓, `sackId` pinlenmiyor). I6: **W** `:4396` → **R claim** `:4422` `{id, IN_PRODUCTION, shipmentId:null, sackId:null}` ✓. |
| **5** | EVET — I2/I3'te "bu topun adım kapsamı" küme kararı, WO kilitleri sıralı (id ASC — ABBA'ya karşı doğru desen ✓). |
| **6** | CHECK `qty ≥ 0` ✓ · **`currentQty ≤ initialQty` YOK** · **`parent.currentQty + Σ child.initialQty ≤ parent.initialQty` seddi YOK** · `cancelledAt/cancelReasonCode` nullable, index yok · `finalizedAt` trigger `WAREHOUSE→SCRAP`'ı damgalamıyor. |
| **7** | **EVET — ölçüldü, ve hipotezden GENİŞ.** `audit_repro_KYY-2-32.ts`: 700 m bütün depo topu; `cutWarehouseRoll(100)` ‖ `applyManualProperties({currentQty: 720})`. **PARALEL 10/10 ihlal** (`parent 620/620 + child 100 = 720 > 620`). **SIRALI koşumda da ihlal** (`parent 720/720 + child 100 = 820 > 720`) — çünkü `cutWarehouseRoll` parent'ın **`initialQty`'sini de düşürür** (`tambur.service.ts:2218-2246`: "Parent kısalıyor — `initialQty`'i de güncelle (her kesim sonrası reset)", `data: { currentQty: {decrement}, initialQty: {decrement} }`). Dolayısıyla `rollWhole = initialQty.equals(currentQty)` **kesimden sonra da TRUE** → `:3783`'teki "kısmen tüketilmiş topta reddet" guard'ı Top Kesme yolunda **hiç tetiklenmez**. Yarış bunu ayrıca kötüleştiriyor (bayat tabana yazım). **İkinci çizelge (kapsam kaçağı):** claim `status`'ü pinlemediği için, `T1` FREE_STOCK (`STOCK`) okuyup sebep/yetki aranmadan geçerken `T2` topu `IN_PRODUCTION`'a alırsa yazım **süpervizör kapsamına girmeden** üretimdeki topa uygulanır ve audit'e `RELABEL` (`MANUAL_ATTRIBUTE` değil) düşer. |
| **8** | Depo sorumlusu 700 m topun 100 m'sini kesip ayırdıktan sonra kalan topu ölçer ve "720" yazarsa sistem kabul eder: envanterde **fiziksel olmayan 120 m** doğar, `initialQty` de ezildiği için "Başlangıç: N m" ve aşım/sapma taban çizgisi yalan söyler. **En kötü yanı tespit edilemez olması:** defterde bu durum, `cutWarehouseRoll`'ün meşru `initialQty` reset'iyle **birebir aynı görünür** (saha kopyasında 56 satır bu şekle uyuyor ve incelenen örnek `29e80e11…` meşru reset çıktı) — yani olay olduktan sonra hiçbir sorgu "bu metraj uyduruldu mu" sorusunu cevaplayamaz. |

**② hipotezi:** (A) "metraj ∥ kesim — hangi yazım kazanır; süpervizör kapsamı bayat statüyle çözülür" → **DOĞRULANDI (K3) ve genişledi** (yarış olmadan da ihlal) · (I) iptal izi eksikliği → I-alanı · (E) SCRAP `finalizedAt` / iki iptal sözleşmesi / `preCancelStatus` NULL → E-alanı.

---

## KYY-35 — Etiket baskı + print-event (top / çuval) + doğal yazıcı

| # | Cevap |
|---|---|
| **1** | DOC-05: `labelDirty` = "basılı etiket veriyle uyuşuyor mu"; `labelPrintedAt` = "ortada fiziksel etiket VAR mı" (iptal guard'ı buna bakar); SACK etiketi fail-closed; `showIf` = `QualityGrade.code`. |
| **2** | **TX YOK — üç ayrı yazım:** ① `seedRollLabelSnapshot` `label.service.ts:2094` (hata → `{success:true, seeded:false}` + `console.error`), ② `prisma.roll.update({labelDirty:false, labelPrintedAt})` `:2112-2115`, ③ audit `:2145-2156`. Çuval yolu `recordSackPrintEvent` `:1737` `updateMany WHERE labelDirty:true` (idempotent claim benzeri ✓). Kart yolu (KYY-33) tx'li → **aynı sınıf, iki sözleşme**. |
| **3** | EVET — `roll` `:2088` okunuyor, sonra üç ayrı yazım; arada `getRollLabel` + `resolveLabelRouting` (best-effort blok `:2124-2142`) çalışıyor. |
| **4** | **Hiçbiri.** ② koşulsuz `update({where:{id}})` — `where: { labelDirty: true }` koşulu **bilerek kaldırılmış** (`:2106-2109`: damga her baskıda yazılmalı). Gerekçe `labelPrintedAt` için doğru; ama aynı ifade `labelDirty:false`'ı da koşulsuz yazıyor. |
| **5** | Hayır (tek satır). |
| **6** | `Roll.lastLabelSnapshot` Json, `labelCustomerId` partial index, `labelDirty`, `labelPrintedAt` · `LabelTemplate` partial unique `label_templates_one_default_per_kind` + `label_context_defaults.kind` unique (**iki bağımsız sed, çift yazımla senkron**). |
| **7** | **EVET.** Çizelge: `t0` operatör etiketi bastı (istemci `GET /labels/rolls/:id` ile render aldı) → `t0+50ms` süpervizör `applyManualProperties` ile metrajı düzeltti → `inventory.service.ts:3912` `rollData.labelDirty = true` yazıldı → `t0+200ms` istemcinin `POST /labels/rolls/:id/print` isteği ulaştı → `label.service.ts:2112` **koşulsuz `labelDirty:false`**. **SONUÇ:** kâğıttaki metraj yanlış, sistem "etiket güncel" diyor, hiçbir yüzeyde uyarı yok. |
| **8** | Yanlış metrajlı etiketle top çuvala girer, çuval etiketine ve irsaliyeye o metraj yazılır. `labelDirty` mekanizmasının varlık sebebi tam bu senaryodur (2026-08-05 ölü etiket vakası). Saha kopyasında `labelPrintedAt` dolu + `labelDirty=false` + `updatedAt > labelPrintedAt+2sn` olan **1.534 top** var — ama `updatedAt` gerçek "hareket" olmadığı için (CLAUDE.md 2026-07-30 notu) bu **kanıt değil, yalnız pencerenin genişliğidir**. |

**② hipotezi:** (D) kısmi durum (snapshot güncel / `labelPrintedAt` boş / kâğıt çıkmış) → **DOĞRULANDI** (üç yazım atomik değil) · (I) barkod/QR üretimi patlarsa 200 · dil izi → I-alanı · (H) senkron `bwipjs.toSVG` event loop → H-alanı · (G) `test-native` SSRF → G-alanı · (L) `LabelKind` 4 nokta → L-alanı.

---

## KYY-38 — İçe aktarma (17 adaptör) + yapılandırma paketi

| # | Cevap |
|---|---|
| **1** | `import_runs.clientToken` tekilliği; hedef varlıkların kendi seddleri (`nameFold` partial unique, `code` unique); "koşum satırı = ne oldu"nun tek kaydı. |
| **2** | **Tek tx YOK — bilinçli** (`import/import.service.ts:12-24`). Satır satır `adapter.createOne/updateOne` → **mevcut servis** (kendi tx'i + audit'i) **sıralı**. `importRun.create` `:552` **havuz, döngüden SONRA**. `onError=abort` → ERROR varsa hiçbir şey yazılmaz (`:483-491`, `importRun.create`'ten önce throw). |
| **3** | **EVET, ve idempotency tam burada kırılıyor:** token kontrolü `:446-471` koşumun **BAŞINDA**, `importRun` satırı **SONUNDA** yazılıyor. |
| **4** | **Kilit/bayrak YOK.** `clientToken` yalnız **tamamlanmış** koşumu korur. |
| **5** | EVET — "bu token daha önce koştu mu" bir küme (phantom) sorusudur; kilit yok, izolasyon yükseltilmemiş. |
| **6** | `import_runs.clientToken` **düz** unique ✓ · `status` enum · saha **0 satır** (özellik hiç kullanılmamış). |
| **7** | **EVET.** Çizelge: `T1 POST /api/import/orders/apply` (token X) 10.000 satır yazmaya başlar (HTTP zaman aşımı yok, `importRun` henüz YOK) → panel/proxy timeout → kullanıcı **Tekrar Dene** → `T2` aynı token X → `:447 findUnique` **null** (satır hâlâ yazılmadı) → ikinci tam koşum başlar. `order.adapter` **create-only, doğal anahtarsız** (`:7-16`) → **her satır ikinci kez sipariş yaratır**. Sonra `T2`'nin `importRun.create` `:552`'si P2002'ye çarpar → istemci 500 görür, **veri iki kez yazılmıştır**. |
| **8** | Bugün olasılık **çok düşük**: sahada `data:import` taşıyan 1 kullanıcı ve `import_runs` **0 satır** (özellik hiç kullanılmamış). Kullanıldığı ilk gün, ilk büyük dosyada tetiklenmesi muhtemeldir (10.000 satır × servis başına tx = dakikalarca) ve sonuç mükerrer ana veri/sipariş olur. |

**② hipotezi:** (B) uçuşta çift koşum → **DOĞRULANDI (K1)** · (F) 10 MB vaadinin global 1 MB parser'la tutmaması → F-alanı (K9 H-1) · (G) export `data:import`siz tam döküm → G-alanı · (I) yarıda kesilen koşumun kaydı yok → **aynı kök** (run satırı sonda) · (E) `mode:insensitive` İ/ı → E-alanı.

---

## KYY-41 — Çalışma oturumu (istasyon/makine)

| # | Cevap |
|---|---|
| **1** | "Bir makinede tek açık oturum" + "bir cihazda tek açık oturum" (DB **partial unique**), "bir operatör = tek yer", damga (`getStampContext`) doğruluğu, `STATION_KIND_PERM` yetki kapısı. |
| **2** | `work-session.service.ts:171` → **tx `:269-312`** (`updateMany` ×3 `:274/:285/:294` → `create` `:302`); **P2002 catch tx DIŞINDA** `:313-321` → 409 `SESSION_RACE`. `closeForDevice`/`forceClose`/`current` havuz `updateMany endedAt:null` (idempotent temizlik ✓). |
| **3** | EVET — occupant ön-kontrolü `:215-233` tx dışı; **ama arkası DB partial unique ile kapalı** ve yorum `:212-214` bunu doğru söylüyor. Beceri §3.2 karşı-örneği: "check-then-act ama DB seddi son savunma". |
| **4** | Kilit yerine **DB partial unique = claim**: `work_sessions_active_machine_uq (machineId) WHERE endedAt IS NULL AND machineId IS NOT NULL` ve `work_sessions_active_device_uq (deviceId) WHERE endedAt IS NULL` (migration `20260702121000`; **şemada YOK** → `test_db_invariants` envanterinde). |
| **5** | EVET — "bu makinede açık oturum var mı" phantom sorusu; partial unique tam olarak phantom'u kapatan doğru araç ✓. |
| **6** | İki partial unique ✓ · FK `machineId` RESTRICT (⚠️ GHR `/permanent` oturumu fiziksel siliyor — K2a H2 çelişkisi) · `endReason` enum ✓. |
| **7** | **HAYIR (eşzamanlılık).** İki cihaz aynı makineye aynı anda `confirmTakeover` ile gelirse ikisi de eski oturumları kapatır, ikinci `create` partial unique'e çarpar → 409 `SESSION_RACE`. Bekçi `test_work_session` bu dalı **fiilen tetikliyor** (EŞZ ✓). **EVET (OCP/fail-open, eşzamanlılık dışı):** `STATION_KIND_PERM` `:38-43` **`Record<string, string>`** olarak tiplenmiş; `SESSIONABLE_STATION_KINDS` `:33` ile tip düzeyinde bağlı DEĞİL. Listeye yeni bir kind eklenirse `needM`/`needS` `undefined` olur ve izin kontrolü `:205`/`:245` **sessizce atlanır** (fail-open) — derleyici görmez, bekçi eşitliği ölçmüyor. |
| **8** | Bugün iki liste hizalı (4'e 4) → fiili açık yok. Yarın "PACKAGING" eklenirse yalnız `mobile:kk1` taşıyan operatör o istasyonda oturum açar ve damgası o istasyona yazılır. Ayrıca sahada **`machineId` dolu oturum 0** → makine atfı hiç kurulmamış (E/I-alanı). |

**② hipotezi:** (G) cihaz kimliğinin sırsız olması → G-alanı · (F) GET yan etkili `current` → F-alanı · (C) GHR oturum geçmişini siliyor → C-alanı · (G) `STATION_KIND_PERM` fail-open → **DOĞRULANDI (K1, S3)** · (E/I) makine atfı NULL → E/I-alanı.

---

## KYY-44 — Boot uzlaştırma job'ları + kurulum kimliği + mDNS

| # | Cevap |
|---|---|
| **1** | MD-08: "katalog koda, atama panele" — boot **EKLER, silmez, ATAMAZ"; izin → rol → sebep zinciri **SIRALI** (rol satırları izne FK); her CUD → audit konvansiyonu. |
| **2** | Hepsi **havuz client'ı, tx YOK** (idempotent ekleme). `permission-catalog.job.ts:94` `createMany skipDuplicates` + audit ✓; `role-template-catalog.job.ts` havuz + audit ✓; **`reason-preset-catalog.job.ts:57` `prisma.reasonPreset.create` — audit YOK, `skipDuplicates` YOK** (`ReasonPresetService.create` atlanıyor). |
| **3** | EVET — `reconcileReasonPresets` `have` kümesini döngüden ÖNCE bir kez okur `:40-42`; `nextOrder` de o anlık görüntüden `:48`. Tek process'te sorun değil. |
| **4** | `started` bayrağı (modül seviyesi, process-local) + DB unique'leri (`permissions.code`, `reason_presets(kind,code)`, `permission_templates.code`). |
| **5** | EVET — "bu katalog satırı DB'de var mı" küme sorusu; korunması `@unique` + (izin job'unda) `skipDuplicates`. |
| **6** | `permissions.code` unique ✓ · `permission_templates.code/name` unique ✓ · `reason_presets (kind, code)` unique ✓ · `system_settings` PK ✓. |
| **7** | **HAYIR (tek process invariantı altında).** `instances: 1` + `exec_mode: fork` belgeli; `started` bayrağı doğru çalışır. İkinci process açılırsa: izin job'u `skipDuplicates` ile kurtulur, **sebep job'u kurtulmaz** — `create` P2002'ye çarpar, `runReasonPresetReconciliation` yakalar (sunucu düşmez) ama **o kind'dan sonraki tüm katalog satırları atlanır** (fabrika yeni sebepleri göremez, hiçbir yerde yazmaz). |
| **8** | Bugün etkisiz. Gerçek ve bugün de doğru olan bulgu: **`reason-preset` uzlaştırması audit yazmıyor** — "her CUD → audit" konvansiyonunun kardeş iki job'da uyulup burada uyulmaması, sebep kataloğuna sistem tarafından eklenen satırların izini yok ediyor (fabrika "bu sebebi kim ekledi" sorusunu cevaplayamıyor). |

**② hipotezi:** (I) reason-preset audit'siz → **DOĞRULANDI (S3)** · (J) izin/rol atanmaması → deploy checklist'i, J-alanı · (A) `instances>1`'de çift uzlaştırma → **KISMEN**: `skipDuplicates` yalnız izin job'unda var · (L) `installation-identity` yorum↔kod ayrışması → L-alanı.

---

## KYY-47 — DB kopyası / geri yükleme (uygulama içinden DDL)

| # | Cevap |
|---|---|
| **1** | "Aynı anda tek kopya işi", allowlist (`<canlı>_restore_<damga>`), `name === live` reddi, GUC replay, `dbRestore.copies` kaydının gerçeği yansıtması. |
| **2** | DDL **tx dışı** (`pg.Client`, bakım DB'si, `statement_timeout=0`). `writeCopyRecords` `:279-296` `SystemSetting` JSON blob'unu **tam yazar** (upsert). |
| **3** | EVET — `isBackupRunning()` `:377`, `resolveBackupPath` `:383`, disk guard hepsi claim'den önce; ama **claim'e kadar hiç `await` yok** (`:373-399` senkron kontroller) → tek thread'de iki istek claim satırını aynı anda geçemez (yorum `:399-400` bunu doğru gerekçelendiriyor ✓). |
| **4** | **Bellek claim** `currentJob` (`isCopyJobRunning` `:138`), tek process invariantına dayanıyor ✓. Meşgulse **400** döner (409 sözleşmesi dışı — F-alanı). `copyRecordsWriteQueue` `:795` **yalnız `reverifyCopy`'yi** serileştirir. |
| **5** | EVET — `pg_database` taze okuması drop öncesi ✓; `writeCopyRecords`'un `existingNames` ile budaması "silinen DB kaydı diriltilmesin"i çözüyor ✓. |
| **6** | Allowlist + `MAX_IDENTIFIER_BYTES=63` + `quoteIdent/quoteLiteral` ✓; **`reverifyCopy` `:798` allowlist'siz** (G-alanı, K9 H-3). |
| **7** | **EVET (JSON lost update, beceri §3.3).** `persistRecord` `:474-482` ve `dropCopy` `:718-721` **kuyruğa girmeden** oku-değiştir-yaz yapıyor; yalnız `reverifyCopy` kuyrukta. Çizelge: `T1 reverifyCopy(A)` `verifyCopy` 10-20 sn sürer, sonra blob'u okur/yazar. `T2 dropCopy(B)`: blob'u **T1'in yazımından ÖNCE** okur, B'yi siler, **T1'in A güncellemesini içermeyen** blobu yazar → A'nın taze doğrulama sonucu **sessizce kaybolur**. Ters sıra zararsız (`existingNames` budaması B'yi zaten eler). |
| **8** | Panelde A kopyası "doğrulanmadı/başarısız" görünmeye devam eder; yönetici canlıya alınabilecek sağlam kopyayı sağlıksız sanıp yeniden doğrulama turuna girer (her tur tüm DB boyutlarını + satır sayılarını tarar). Veri kaybı yok, **karar verisi yanlış**. İki yönetici gerektirir → olasılık düşük. |

**② hipotezi:** (G) `reverifyCopy` allowlist'siz → G-alanı (teyit edildi, kapsam dışı) · (H) `listDbCopies` yoklama maliyeti → H-alanı · (J) GUC replay hatası yalnız console → J-alanı · (F) meşgulde 400 → F-alanı · **JSON lost update ② listesinde YOKTU — yeni bulgu (KYY-2-12).**

---

## KYY-50 — Fatura izi + muhasebe export

| # | Cevap |
|---|---|
| **1** | **INV-SEV-14:** `invoiceNo ≠ NULL ⇒ status = DISPATCHED ∧ invoicedAt ≠ NULL`; `invoiceNo = NULL ⇒ invoicedAt = NULL`. ERP fatura KESMEZ (yalnız iz). |
| **2** | `shipping.service.ts:1627-1656` — **tx YOK**, tek `updateMany`. `setDirectShipmentInvoice` `:1660-1682` aynı desen (DirectShipment'ta statü yok → guard yok, doğru). |
| **3** | HAYIR — kontrol `where`'in içinde (`{id, status: DISPATCHED}` `:1635-1638`), `count===0` sonrası okuma yalnız **hata mesajını ayırmak** için `:1641-1643` (beceri §1'in "savunma katmanı" karşı-örneği ✓). |
| **4** | **Atomik claim** `{id, status: DISPATCHED}` + `count===0 → 400` ✓. **8023 sevkiyat kapsam kilidi ALINMIYOR.** |
| **5** | Hayır (tek satır) — ama invariant **iki yazıcı arasında** paylaşılıyor (aşağı). |
| **6** | `shipments.invoiceNo/invoicedAt` — **CHECK YOK**; `invoiceNo ↔ status` ilişkisi yalnız uygulama katmanında. |
| **7** | **EVET.** `undoDispatch` engel kontrolünü **tx içinde ve taze** yapıyor (`:2162-2178`, 8023 kilidi altında) — ama `setShipmentInvoice` **o kilidi almıyor ve tx'te değil**. Çizelge: `T1 undoDispatch(S)` `:2160` 8023 kilidi → `:2163 findUnique` `invoiceNo = null` okur → `:2170 resolveUndoBlockReason` → engel yok → **await = yield** → `T2 setShipmentInvoice(S,"F-123")` `:1635` `updateMany {id, DISPATCHED}` → **1 satır, commit** (8023'ü beklemez, yalnız satır kilidi alır ve hemen bırakır) → `T1 :2179 claim {id, DISPATCHED}` → hâlâ DISPATCHED → **PLANNED** yazar, commit. **SONUÇ: `status = PLANNED` ∧ `invoiceNo = 'F-123'` → INV-SEV-14 ihlali, DB seddi yok.** `releaseSacks: true` ise sonuç `CANCELLED` + faturalı. |
| **8** | Muhasebe ekranında "faturalanmış" görünen bir sevkiyatın malı depoya dönmüş olur; `resolveUndoBlockReason` `:2043-2046` bundan sonra storno'yu **fatura var diye reddeder** (kilitlenme: geri alınmış bir sevkiyat "geri alınamaz" der). Muhasebe export'u yalnız DISPATCHED satırları saydığı için fatura numarası defterde durur ama çıkış satırı yoktur → mutabakat farkı. Saha kopyasında bugün **0 satır** (`invoiceNo IS NOT NULL AND status <> 'DISPATCHED'`) → henüz olmamış. |

**② hipotezi:** (E) export/yuvarlama farkları → L/E-alanı · (G) `shipping:write`in fatura yazabilmesi (SoD tek yönlü) → G-alanı · (A) `buildShipmentListSummary` 5 ayrı `aggregate` → H/K7b · **INV-SEV-14 yarışı ② listesinde YOKTU — yeni bulgu (KYY-2-05).**


---

# 2. BULGULAR

Yalnız **(7) = EVET** olan çizelgeler bulgu oldu. "HAYIR — neden" cevapları yukarıdaki tabloda kaldı.

---

### [KYY-2-01] `applyManualProperties` metraj düzeltmesi, depo kesiminden sonra da geçer — kesilen metre yeniden yaratılır ve defterden tespit edilemez

| Şiddet | **S1** | Kategori | A.1 / E | Öncelik | **P0** | Modül | Envanter (Roll) | Kanıt seviyesi | **K3** |
|---|---|---|---|---|---|---|---|---|

**Özet.** "Bu top kısmen tüketilmiş — metrajı buradan düzeltilemez" guard'ı, korumak istediği tam yolda çalışmıyor. `cutWarehouseRoll` parent'ın `currentQty`'siyle birlikte **`initialQty`'sini de düşürdüğü** için kesilmiş top her zaman "bütün" görünür; `applyManualProperties` de metrajı `currentQty` **ve** `initialQty` olarak mutlak yazar. Sonuç: 700 m'lik topun 100 m'si kesilip ayrıldıktan sonra kalan top "720" olarak düzeltilebilir ve envanterde fiziksel karşılığı olmayan 120 m doğar. Eşzamanlılık bunu ayrıca kötüleştirir (yazım bayat tabana oturur) ama **ihlal için yarış gerekmiyor**.

**Kanıt.**
- `Teks-Erp/src/services/inventory.service.ts:3783` — guard bayat satırdan:
  ```ts
  const rollWhole = roll.initialQty.equals(roll.currentQty);
  if (data.currentQty !== undefined) {
    if (!rollWhole) throw AppError.conflict("Bu top kısmen tüketilmiş (kesim/tüketim geçmişi var) — metrajı buradan düzeltilemez.");
  }
  ```
- `Teks-Erp/src/services/inventory.service.ts:3866-3868` — mutlak yazım (hem `currentQty` hem `initialQty`):
  ```ts
  const m = new Prisma.Decimal(data.currentQty);
  rollData.currentQty = m;
  rollData.initialQty = m;
  ```
- `Teks-Erp/src/services/tambur.service.ts:2218-2246` — kesim `initialQty`'yi de düşürüyor (guard'ın ön kabulünü yıkan satır):
  ```
  // Parent kısalıyor — initialQty'i de güncelle (her kesim sonrası reset).
  data: { currentQty: { decrement: data.cutLength }, initialQty: { decrement: data.cutLength } }
  ```
- `Teks-Erp/src/services/inventory.service.ts:3932-3936` — tx içi claim **statüyü ve metrajı pinlemiyor**:
  ```ts
  const upd = await tx.roll.updateMany({ where: { id: rollId, shipmentId: null, sackId: cur.sackId }, data: rollData });
  ```
- **Koruma kontrolü:** `pg_advisory` (bu yolda yok) · satır kilidi (yalnız çuvaldaysa `touchWarehouseSackTx:3927`) · claim (var ama `status`/`currentQty` içermiyor) · **CHECK `currentQty ≤ initialQty` YOK** (K2b; şemada yalnız `qty ≥ 0`) · trigger yok · flag yok.

**Çakışma senaryosu (yarış kolu).**
`T1 cutWarehouseRoll(roll, 100)` — `tambur.service.ts:2404` claim → parent 700→600, child 100 doğar, commit.
`T2 applyManualProperties(roll, {currentQty: 720})` — `inventory.service.ts:3783` guard'ı **tx'ten önce** `initialQty(700)==currentQty(700)` okumuş, `rollWhole=true`; `:3932` claim `status`/`currentQty` pinlemediği için geçer → 720/720 yazar.
**SONUÇ:** `parent 620/620 + child 100 = 720 > initialQty 620`.
**Yarışsız kol:** kesim önce tamamlansa bile parent 600/600 olur, `rollWhole` **hâlâ true** → düzeltme kabul edilir → 720/720 + child 100 = 820 > 720.

**failure_mode.** Depo sorumlusu 700 m depo topundan 100 m keser (Top Kesme). Kalan topu metre sayacıyla ölçüp "720" girer ve "Düzelt"e basar. Sistem kabul eder; envanter o topu 720 m gösterir, kesilen 100 m'lik çocuk top da ayrıca stoktadır → **fiziksel olarak 700 m olan maldan sistemde 820 m görünür**; `initialQty` de 720'ye ezildiği için detay panelindeki "Başlangıç: N m" ve aşım/sapma taban çizgisi kalıcı olarak yanlışlanır.

**Veride fiili ihlal (K2).** **Arandı, ayırt edilemedi.** `sql-saha.sh`:
```sql
SELECT count(*) FROM (
  SELECT p.id FROM rolls p JOIN rolls c ON c."parentRollId"=p.id
  GROUP BY p.id, p."initialQty", p."currentQty"
  HAVING p."currentQty" + SUM(c."initialQty") > p."initialQty") x;
-- saha (2026-08-25 kopyası): 56
```
Kırılım: `TAMBUR_CONSUMED` 50 · `IN_PRODUCTION` 3 · `WAREHOUSE` 3. İncelenen örnek `29e80e11-de6a-42d2-8acb-444328686e1c` (init 275 / cur 275 / çocuk 50): audit'e göre top **325 m doğmuş** (`TAMBUR_CUT_FROM_OPEN_FABRIC`), 50 m kesilmiş → `275+50 = 325` — yani **meşru `initialQty` reset artefaktı**. Bu, bulgunun en ağır tarafını kanıtlıyor: **ihlal ile meşru artefakt defterde birbirinden ayırt edilemiyor**, dolayısıyla olay olduktan sonra hiçbir sorgu "bu metraj uyduruldu mu" sorusunu cevaplayamaz.

**Repro (K3).** `Teks-Erp/scripts/audit_repro_KYY-2-32.ts` → `audit/repro/KYY-2-32.log`
`10 paralel turun 10 tanesinde parent+çocuk toplamı initialQty'yi AŞTI` + **SIRALI kol da ihlal** (`TOPLAM=820 ⚠️ init'i AŞIYOR`) + mutabakat sorgusu 11 tutarsız top.

**İş etkisi.** Depoda olmayan kumaş sipariş karşılamaya, Ürün Dengesi'ne, sevk planına ve muhasebe export'una gerçek gibi girer; sevkiyat kurulurken çuval içeriği şişer ve **hukuken bağlayıcı irsaliyeye** yanlış metraj donar (`freezeForSource`). Ters yönde de kullanılabilir (metrajı düşürerek fireyi gizleme) ve sapma defterine satır düşmez.

**Öneri (2. tur için).**
1. **Kısa vade (kod, migration yok):** `applyManualProperties` claim'ini metraja da pinle — `where: { id, shipmentId: null, sackId: cur.sackId, currentQty: roll.currentQty, initialQty: roll.initialQty }`; `count===0 → 409 "Topun metrajı bu sırada değişti"` (`tambur.service.ts:981-988`'deki `freshQtyRow` kalıbının aynısı). Bu, yarış kolunu kapatır.
2. **Asıl düzeltme:** "bütün top" yüklemini `initialQty == currentQty` yerine **kesim geçmişine** bağla — `rollWhole = (await tx.roll.count({ where: { parentRollId: rollId } })) === 0 && movement/operation izi yok`. `cutWarehouseRoll` `initialQty`'yi bilerek resetlediği için mevcut yüklem yapısal olarak yanlıştır.
3. **Sed (opsiyonel, `[PROD'DA ÇALIŞTIRMA]`):** `CHECK (p.currentQty <= p.initialQty)` konulamaz (aşım meşru); yerine **`RollVariance`'a `MANUAL_QTY_CORRECTION` satırı** yazılsın — düzeltme defterde iz bıraksın ki artefakttan ayrılabilsin. Migration gerekirse geri alma = `DROP` + kolon kalır.
4. Kapsam kaçağı için: claim'e `status: roll.status` ekle (aşağıdaki KYY-2-01b notu).

**Kabul kriteri.** `audit_repro_KYY-2-32.ts` **0/11 ihlal** (SIRALI kol dahil) ve `applyManualProperties` kesilmiş topta 409 döner; `test_roll_edit_unified`'a negatif sonda eklenir (guard kaldırılınca kırmızı verdiği kanıtlanır). **Efor:** 1,5 gün.

**Önceki defter.** `audit/FINDINGS.jsonl`'de birebir eşleşen id bulunamadı (F114/F221 aynı fonksiyonun **kapsam** kararlarıyla ilgili, metraj tabanıyla değil). K12'de reddedilmiş bir ikizi yok.

---

### [KYY-2-01b] Aynı claim `status`'ü de pinlemiyor — süpervizör kapsamı bayat statüyle çözülüyor (yetki kapısı yarışla atlanabiliyor)

| Şiddet | **S2** | Kategori | A.1 / G | Öncelik | **P1** | Modül | Envanter (Roll) | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `applyManualProperties`'in kapsam kararı (`FREE_STOCK` → sebep opsiyonel + ek yetki YOK · gerisi → sebep ZORUNLU + `roll:manual-adjust`) tx DIŞINDA okunan statüden çözülüyor; tx içindeki claim statüyü pinlemediği için karar ile yazım arasında statü değişirse **yetki kapısı fiilen atlanır**.

**Kanıt.** `Teks-Erp/src/services/inventory.service.ts:3736-3762` (kapsam kararı, bayat `roll.status`) ↔ `:3932-3936` (claim, `status` WHERE'de yok). Karşılaştırma noktası: aynı dosyada `softDelete` claim'i **gözlenen statüye pinliyor** (`:3253` `{id, status: existing.status, shipmentId: existing.shipmentId}`) — yani doğru desen dosyada zaten var, I4 onu uygulamıyor.

**Çakışma senaryosu.**
`T1 applyManualProperties(roll)` — `:3736` `roll.status = STOCK` okur → `FREE_STOCK` → `needsSupervisor = false`, sebep aranmaz, `roll:manual-adjust` aranmaz. **await = yield.**
`T2 tambur-manual.createManualRoll` FAZ 2 `:1149` claim → top `IN_PRODUCTION`, `currentStepId` dolu.
`T1 :3932` claim `{id, shipmentId:null, sackId:null}` → **eşleşir** → renk/en/kalite/kat yazılır.
**SONUÇ:** üretimdeki topun nitelikleri, `roll:manual-adjust` yetkisi olmayan bir kullanıcı tarafından **sebep kaydı olmadan** değiştirilir; audit `RELABEL` olarak düşer (`MANUAL_ATTRIBUTE` değil), yani izlenebilirlik yüzeyi de yanlış sınıfa yazar.

**failure_mode.** `mobile:depo` + `roll:write` taşıyan depo personeli bir topun rengini düzeltmek için "Düzelt"e basar; aynı saniyede Tambur operatörü o topu iş emrine bağlar. Düzeltme geçer ve `roll:history` yaşam döngüsünde sebepsiz bir `RELABEL` görünür — süpervizör onayı gerektiren bir değişiklik onaysız yapılmış olur.

**Veride fiili ihlal (K2).** Aranmadı — audit'te `RELABEL`/`MANUAL_ATTRIBUTE` ayrımı ile statü geçiş anını eşleştirmek 6 aylık audit penceresi içinde mümkün ama bu turun bütçesi dışında. D-G/D-I'ye not edildi.

**İş etkisi.** Yetki ayrımı (SoD) sessizce delinir; "üretimdeki topu yalnız süpervizör düzeltir" kuralı ölçülemez hale gelir.

**Öneri.** KYY-2-01'in 1. maddesindeki claim genişletmesine `status: roll.status` ekle (tek satır, migration yok). **Kabul kriteri:** statü değişince 409; `test_roll_edit_unified`'a negatif sonda. **Efor:** 0,5 gün (KYY-2-01 ile birlikte yapılır).

---

### [KYY-2-02] Eşzamanlı `unlinkOrderLine` "tip = bağın aynası"nı bozuyor — 0 bağlı iş emri "Siparişe Özel" kalıyor

| Şiddet | **S2** | Kategori | A.1 / E | Öncelik | **P1** | Modül | İş emri ↔ sipariş bağı | Kanıt seviyesi | **K3** |
|---|---|---|---|---|---|---|---|---|

**Özet.** "Son bağ mı" kararı transaction'ın DIŞINDA okunan bir diziden veriliyor. İki planlamacı aynı iş emrinin iki farklı sipariş bağını aynı anda kaldırırsa ikisi de "2 bağ var, son değil" görür, ikisi de bağını siler ve tip flip bloğuna **hiç girilmez**. 2026-08-21'de kurulan "tip hiçbir yerde beyan değil, bağdan türer" kuralı sessizce bozulur.

**Kanıt.**
- `Teks-Erp/src/services/workorder-link.service.ts:435-451` — karar tx dışında:
  ```ts
  const links = await prisma.workOrderToOrderLine.findMany({ where: { workOrderId }, select: { orderLineId: true } });
  const lastLinkOfOrderWo = wo.type === WorkOrderType.ORDER_PRODUCTION && links.length === 1;
  ```
- `:453-473` — tx; taze `remaining` sayımı **yalnız `lastLinkOfOrderWo === true` dalında**:
  ```ts
  await tx.workOrderToOrderLine.delete({ where: { workOrderId_orderLineId: { workOrderId, orderLineId } } });
  if (lastLinkOfOrderWo) { const remaining = await tx.workOrderToOrderLine.count(...); if (remaining === 0) { ...flip... } }
  ```
- **Koruma kontrolü:** `grep -rn "touchWorkOrderTx(" src --include='*.ts'` → 30 çağrı yeri, **`workorder-link.service.ts` HİÇ YOK** → WO satırı kilitlenmiyor. Advisory lock yok. `isolationLevel` verilmemiş. **DB seddi yok** (PK yalnız bağ satırının tekilliğini korur; CHECK `work_orders_stockprod_targetItem` bu çizelgede hiç denenmiyor çünkü flip yapılmıyor).

**Çakışma senaryosu.**
`T1 unlinkOrderLine(WO, L1)`: `:435 loadWo` → `:439 links=[L1,L2]` → `:445 lastLinkOfOrderWo=false` → **await = yield**
`T2 unlinkOrderLine(WO, L2)`: `:439 links=[L1,L2]` (T1 henüz commit etmedi) → `:445 lastLinkOfOrderWo=false`
`T1 :454 delete(L1)` COMMIT · `T2 :454 delete(L2)` COMMIT
**SONUÇ:** `work_order_to_order_lines` boş, `work_orders.type = ORDER_PRODUCTION`. Hiçbir hata, hiçbir uyarı.

**failure_mode.** İki planlamacı aynı iş emrinden iki farklı sipariş satırını aynı anda kaldırır (ya da tek kullanıcı iki sekmede). İş emri 0 bağla "Siparişe Özel" kalır: liste/künye/refakat kartı "Siparişe Özel" basar, detay panelinde bağlı sipariş yoktur, **Stok üretimi sekmesinde de görünmez** → iş emri planlamacının hiçbir listesinde bulunmaz. `test_consistency_derived §21` kırmızıya döner ve düzeltme ancak `scripts/fix_workorder_type_from_links.ts --apply` ile elle yapılır.

**Veride fiili ihlal (K2).** **Arandı, 0.** `sql-saha.sh`:
```sql
SELECT count(*) FROM (
  SELECT w.id FROM work_orders w LEFT JOIN work_order_to_order_lines l ON l."workOrderId"=w.id
  GROUP BY w.id, w.type
  HAVING (w.type='ORDER_PRODUCTION' AND COUNT(l."orderLineId")=0)
      OR (w.type='STOCK_PRODUCTION' AND COUNT(l."orderLineId")>0)) y;
-- saha: 0   (kural 2026-08-21'de kondu, saha kopyası 2026-08-25 → pencere 4 gün)
```

**Repro (K3).** `Teks-Erp/scripts/audit_repro_KYY-2-26.ts` → `audit/repro/KYY-2-26.log`
```
10 paralel turun 10 tanesinde "0 bağ ama type=ORDER_PRODUCTION" oluştu.
Mutabakat (§21 ikizi): bu koşumun ürettiği tutarsız WO sayısı = 10
```
SIRALI kol temiz (`typeChanged=false | typeChanged=true` → `bağ=0 · type=STOCK_PRODUCTION`) → fark **yalnız eşzamanlılıktan**.

**Aynı kökten iki ek çizelge (aynı düzeltme kapsar).**
① `unlink(son bağ)` ‖ `linkOrderLines(yeni satır)` → T1 `remaining=0` görüp STOK'a çeker, T2 pre-tx `type=ORDER` gördüğü için flip bloğuna girmez → **1 bağ ama `STOCK_PRODUCTION`**.
② `softDelete(WO)` ‖ `linkOrderLines` → `assertPlanEditable` `:434` tx DIŞINDA; `createMany` `:376` ve tip flip'i `:380` **statü guard'sız** → **iptal edilmiş iş emrine bağ eklenir** ve `markTravelerCardDirtyTx` VOIDED karta yazar.

**İş etkisi.** Sipariş karşılama/açık talep raporları iş emrini yanlış kovada sayar; iptal edilmiş iş emrine bağlanan sipariş satırı "üretimde" görünür ve planlamacı ikinci bir iş emri açmaz.

**Öneri (2. tur için).**
1. `unlinkOrderLine` ve `linkOrderLines` tx'lerinin **İLK ifadesi** `touchWorkOrderTx(tx, workOrderId)` olsun (dosyadaki 30 kardeş çağrıyla aynı desen; kilit sırası WO → bağ, ABBA üretmez).
2. `lastLinkOfOrderWo` kararını tx'e taşı: silme sonrası `remaining = await tx.workOrderToOrderLine.count(...)` **her zaman** okunsun ve tip iki yönlü olarak **taze sayımdan** türetilsin (`remaining === 0 → STOCK`, `remaining > 0 → ORDER`), pre-tx okuma yalnız hata mesajı için kalsın.
3. Statü guard'ını tx içinde tekrarla: `createMany` öncesi `tx.workOrder.findUnique(status)` + FROZEN kontrolü, ya da tip flip'ini `updateMany {id, type, status: { notIn: FROZEN_STATUSES }}` ile claim'e çevir.
4. `test_consistency_derived §21` **canlıya karşı** koşulsun (K12 dersi: mutabakat kapısının değeri canlı DB'dedir).
Migration/izin/APK **YOK**, düzeltme tamamen sunucuda.

**Kabul kriteri.** `audit_repro_KYY-2-26.ts` 0/10 ihlal; `test_workorder_order_link`'e **paralel sonda** eklenir (N eşzamanlı unlink → tam 1 tip flip) ve guard kaldırılınca kırmızı verdiği kanıtlanır. **Efor:** 1 gün.

**Önceki defter.** K12'de bu id ile eşleşen reddedilmiş bulgu yok; `KRITIK-YAZMA-YOLLARI` K11 H-6 "Paralel YOK" tespitini bu bulgu doğruluyor.

---

### [KYY-2-03] Çuval taşımada kilit sırası istemciden geliyor — ters yönde eşzamanlı taşıma PostgreSQL deadlock'ı üretiyor ve kullanıcıya **500** dönüyor

| Şiddet | **S2** | Kategori | A.1 / I | Öncelik | **P1** | Modül | Çuval / Paketleme | Kanıt seviyesi | **K3** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `moveRollToSack` ve `moveRollsToSack` iki çuval satırını **kaynak → hedef** sırasıyla kilitliyor; sıra kanonik değil, isteğin yönünden doğuyor. A→B ve B→A aynı anda koşarsa klasik ABBA deadlock oluşur. Üstelik PostgreSQL'in deadlock'ı bu kurulumda Prisma'ya **P2039** olarak geliyor ve `error.middleware`'in P2034 dalı (409 + "tekrar deneyin") hiç çalışmıyor — istek **500 "Sunucu hatası oluştu."** ile bitiyor.

**Kanıt.**
- `Teks-Erp/src/services/shipping.service.ts:689-696`:
  ```ts
  await prisma.$transaction(async (tx) => {
    await touchWarehouseSackTx(tx, fromSackId);      // kilit 1 = KAYNAK (istemciden)
    await touchWarehouseSackTx(tx, data.sackId);     // kilit 2 = HEDEF  (istemciden)
    const moved = await tx.roll.updateMany({ where: { id: roll.id, sackId: fromSackId, shipmentId: null }, data: { sackId: data.sackId } });
  ```
  Aynı desen `moveRollsToSack` `:768-778` (`touchWarehouseSackTx(source)` → `touchWarehouseSackTx(target)`).
- `Teks-Erp/src/services/helpers/shipment-locks.helper.ts:67-76` — `touchWarehouseSackTx` bir `updateMany`, yani **satır kilidi**.
- **Koruma kontrolü:** `moveRollToSack`ta `withBarcodeRetry` YOK (`splitSack` `:830`'da var, burada yok) · advisory lock yok · kanonik sıralama yok (`[a,b].sort()` gibi bir normalizasyon dosyada hiç geçmiyor).
- Hata sınıflandırması: `Teks-Erp/src/middlewares/error.middleware.ts:517` yalnız `P2034`'ü 409'a çeviriyor; `:150-157` `SERVER_FAULT_PRISMA_CODES` ve `:160+` `CLIENT_DATA_PRISMA_CODES` kümelerinde **P2039 yok** → `:563-585` "SINIFLANDIRILMAMIŞ Prisma kodu" dalı → **500**.

**Çakışma senaryosu.**
`T1 moveRollToSack(rA, A→B)` → `:690 touchWarehouseSackTx(A)` [A satır kilidi alındı] → **await = yield**
`T2 moveRollToSack(rB, B→A)` → `:690 touchWarehouseSackTx(B)` [B satır kilidi alındı] → **await = yield**
`T1 :691 touchWarehouseSackTx(B)` → **bekler** (B, T2'de) · `T2 :691 touchWarehouseSackTx(A)` → **bekler** (A, T1'de)
**SONUÇ:** PostgreSQL deadlock detector birini iptal eder (SQLSTATE 40P01) → Prisma `P2039` → HTTP 500.

**failure_mode.** Paketleme masasında iki tablet aynı anda ters yönde top taşırsa (A çuvalından B'ye, B'den A'ya) operatörlerden biri "Sunucu hatası oluştu." görür. Mesaj **tekrar denemesi gerektiğini söylemez**, taşıma yapılmamıştır ama operatör bunu ekrandan anlayamaz; ayrıca her olay `SYSTEM/ERROR` audit'i yazar ve 5xx sayacını şişirir (gerçek bir sunucu arızası gibi görünür).

**Veride fiili ihlal (K2).** Aranmadı — deadlock veri bırakmaz (rollback); izi yalnız `system_logs` `action='ERROR'`, `recordId='P2039'` satırlarında olurdu. Saha kopyasında bu izin taranması I-alanına (D-I) sınır ötesi not olarak bırakıldı.

**Repro (K3).** `Teks-Erp/scripts/audit_repro_KYY-2-08.ts` → `audit/repro/KYY-2-08.log`
```
--- Ters yönde eşzamanlı taşıma × 40 tur (A→B ‖ B→A) ---
   tur 1: sınıf=PrismaClientKnownRequestError · code=P2039 · Invalid `tx.sack.updateMany()` invocation in .../shipment-locks.helper.ts:69:33
Sonuç dağılımı:  DEADLOCK: 36   OK: 38
✅ D2 6 topun tamamı hâlâ iki çuvaldan birinde (kayıp/çuvalsız yok) — çuvalda=6/6
```
80 çağrının **36'sı** (turların ~%85'i) deadlock. Veri bütünlüğü korunuyor (D2 ✓) — bulgu **kullanılabilirlik + hata sınıfı**.

**İş etkisi.** Vardiya başında paketleme yığılmasında taşıma işlemleri rastgele 500 verir; operatör "sistem çöktü" der ve aynı işlemi tekrar tekrar dener. İkinci ve daha geniş etki: **bu kurulumdaki HER deadlock 500 dönüyor** — `error.middleware`'in eşzamanlılık için yazılmış 409 dalı driver-adapter yolunda ölü.

**Öneri (2. tur için).**
1. **Kanonik kilit sırası (asıl düzeltme):** iki çuvalı `id` ASC sırasıyla kilitle — `moveRollToSack` ve `moveRollsToSack` içinde `for (const sid of [fromSackId, targetSackId].sort()) await touchWarehouseSackTx(tx, sid);`. Aynı normalizasyon `inventory.service.ts:3201`'de WO'lar için zaten uygulanıyor (**doğru desen dosyada var**).
2. **Hata sınıflandırması:** `error.middleware.ts`'te `P2039` (ve genel olarak deadlock/serialization) **P2034 ile aynı dala** koyulsun → 409 + "tekrar deneyin". Sınıflandırılmamış dalın `console.error` uyarısı zaten "kodu iki kümeden birine ekleyin" diyor; bu, o uyarının ilk gerçek müşterisi.
3. İsteğe bağlı: `moveRollToSack`'i `withBarcodeRetry` benzeri bir "çakışmada bir kez daha dene" sarmalına almak (kanonik sıra varken gerekmez).
Migration/izin/APK **YOK**.

**Kabul kriteri.** `audit_repro_KYY-2-08.ts` **0 deadlock** ve tüm çağrılar `OK` ya da anlaşılır 409; ayrı bir bekçi P2039→409 eşlemesini ölçer. **Efor:** 0,5 gün (kanonik sıra) + 0,5 gün (hata eşlemesi).

**Önceki defter.** `KRITIK-YAZMA-YOLLARI` §7.1 ABBA-2 ailesi bu bulguyla ölçüldü. K12'de reddedilmiş ikizi yok.

---

### [KYY-2-04] İş emri iptali ANA TX'TEN ÖNCE yazıyor — tx 409 ile düşerse fason sevkleri iptal edilmiş, mal fasondayken toplar "üretimde" kalıyor

| Şiddet | **S2** | Kategori | D / A.1 | Öncelik | **P1** | Modül | İş emri iptali ↔ fason | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `softDelete` (WO iptali) ana transaction'ı açmadan ÖNCE iki kalıcı yazım yapıyor: açık fason sevklerini `cancelBulk` ile iptal ediyor (N ayrı tx) ve fasondaki topları `AT_SUBCONTRACTOR → IN_PRODUCTION`'a çekiyor (havuz, koşulsuz). Ana tx'in ilk ifadesi olan WO claim'i 409 verirse (eşzamanlı finalize/başka bir iptal) bu yazımlar **geri sarılmaz** — mal fiziksel olarak boyahanede dururken sistem onu "içeride, üretimde" gösterir. Ayrıca `cancelBulk`'ın `failed[]` dönüşü hiç okunmuyor.

**Kanıt.**
- `Teks-Erp/src/services/workorder.service.ts:3367` — ana tx'ten önce çağrı:
  ```ts
  const fasonPlan = await this.prepareFasonCancelDecision(id, stepIds, input, userId, reason);
  ```
- `:3251-3257` — **N ayrı tx, dönüş değeri atılıyor**:
  ```ts
  await new SubcontractorService().cancelBulk(
    { dispatchIds: openDispatches.map((d) => d.id), reason: `İş emri iptali: ${reason}` }, userId);
  ```
- `:3271-3285` — **havuz client'ı, koşulsuz `where id in`**:
  ```ts
  await prisma.roll.updateMany({ where: { id: { in: residual.map((r) => r.id) } }, data: { status: RollStatus.IN_PRODUCTION } });
  ```
- `:3376-3400` — ana tx ve **iptal claim'i** (`count===0 → 409`):
  ```ts
  const cancelClaim = await tx.workOrder.updateMany({
    where: { id, status: { notIn: [COMPLETED, CANCELLED, SUPERSEDED] } }, data: { status: CANCELLED, ... } });
  ```
- **Koruma kontrolü:** tx-öncesi yazımlar için telafi (compensating action) YOK · `prepareFasonCancelDecision` bir kilit ALMIYOR (WO kilidi ana tx'te, `:3387` claim'inden sonra) · idempotency token yok · DB seddi yok.
- Yorum `:3358-3365` sırayı bilinçli anlatıyor ("mevcut ve test edilmiş `cancelBulk` servisiyle") ama **tx düşerse ne olacağını yazmıyor**.

**Çakışma senaryosu.**
`T1 softDelete(WO)` → `:3367 prepareFasonCancelDecision` → `cancelBulk` **COMMIT** (fason sevkleri `cancelledAt` aldı) → `:3281 roll.updateMany` **COMMIT** (fasondaki toplar `IN_PRODUCTION`) → **await = yield**
`T2 tambur.finalize` (son top) → `:931 touchWorkOrderTx` → … → `completeWorkOrderIfStepsDone` → WO `COMPLETED` **COMMIT**
`T1 :3387` claim `{id, status notIn [COMPLETED,…]}` → **`count===0` → 409 fırlar**, ana tx **rollback**
**SONUÇ:** WO canlı (`COMPLETED`), açık fason sevkleri **iptal edilmiş**, boyahanedeki toplar `IN_PRODUCTION`. Kullanıcı yalnız "İş emri zaten tamamlanmış/iptal edilmiş" hatasını görür.

**failure_mode.** Planlamacı boyahanede malı olan bir iş emrini iptal etmeye çalışır; tam o anda Tambur son topu bitirir. Kullanıcı 409 alır ve "iptal olmadı" sanır. Gerçekte: `SubcontractorDispatch` satırları iptal edilmiştir → fason kabul ekranı o sevki artık **açık kalem olarak görmez** (`OPEN_OUTSTANDING` süzgeci `cancelledAt IS NULL` arar) → boyahaneden dönen mal **kabul edilemez**; topların statüsü `IN_PRODUCTION` olduğu için fason karnesi ve "fasonda kaç metre var" rakamı da sıfırlanır.

**Veride fiili ihlal (K2).** Aranmadı — kalıcı imza "iptal edilmiş sevke bağlı `IN_PRODUCTION` top" olurdu ama aynı şekil meşru yollarla da doğar (sevk iptali topları zaten içeri alır). Ayırt edici sorgu `system_logs`'ta 409 ile biten `softDelete` denemesini `cancelBulk` audit'iyle eşleştirmeyi gerektirir; bu turun bütçesi dışında → D-I/D-J'ye not.

**İş etkisi.** Fasondaki mal sistemde "içeride" görünür: envanter, fason karnesi, açık sevk listesi ve kalan-kapama akışı hep yanlışlanır; düzeltmenin tek yolu elle statü müdahalesidir (`roll:manual-adjust`).

**Öneri (2. tur için).**
1. **Sıra tersine:** WO claim'i (`:3387`) **en başa** alınsın — kendi tx'inde ya da `prepareFasonCancelDecision`'dan önce bir "kilit + statü doğrulama" tx'i olarak. Claim geçmeden hiçbir kalıcı yazım yapılmasın. (Yorumun kendisi bu prensibi zaten savunuyor: "ATOMİK CLAIM ÖNCE (F57)" — ama fason kararı o claim'in dışında kalmış.)
2. `cancelBulk`'ın `failed[]` dönüşü **okunsun**; en az bir başarısız varsa iptal 409 ile dursun ve hangi sevkin iptal edilemediği kullanıcıya söylensin (parçalı sonuç sessiz olmasın — beceri §2).
3. `prisma.roll.updateMany` `:3281` **havuz yerine ana tx'in `tx`'i** ile yapılsın; `cancelBulk` zaten kendi tx'lerini kullandığı için o adım telafi edilebilir bir "geri al" ile eşleşmeli (iptal edilen sevkleri geri açan bir yol yok → 1. madde şart).
Migration/izin/APK **YOK**.

**Kabul kriteri.** WO claim'i düştüğünde `subcontractor_dispatches.cancelledAt` ve `rolls.status` **değişmemiş** olmalı; bekçi: iptal ile finalize'ı paralel koşturup 409 alan turda fason satırlarının bozulmadığını ölçen sonda (`test_wo_cancel_fason`'a eklenir). **Efor:** 1,5 gün.

**Önceki defter.** K3a #1 "1. sıra hotspot" olarak işaretlemiş; bu bulgu onun çizelgeyle doğrulanmış hali. K12'de reddedilmiş ikizi yok.

---

### [KYY-2-05] `setShipmentInvoice` sevkiyat kapsam kilidini almıyor — storno ile yarışta "PLANNED ama faturalı" sevkiyat doğuyor (INV-SEV-14)

| Şiddet | **S2** | Kategori | A.1 / E | Öncelik | **P2** | Modül | Sevkiyat / muhasebe izi | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `undoDispatch` fatura engelini doğru yapıyor: 8023 advisory kilidini tx'in ilk ifadesi olarak alıyor ve `invoiceNo`'yu **kilit altında taze** okuyor. Ama karşı taraf — `setShipmentInvoice` — o kilidi hiç almıyor ve tx'te bile değil. İki akış yalnız sevkiyat satırında karşılaşıyor ve storno'nun okuması ile claim'i arasındaki pencerede fatura işareti yazılabiliyor. Sonuç `invoiceNo ≠ NULL ∧ status ≠ DISPATCHED` — DB'de bunu engelleyen CHECK yok.

**Kanıt.**
- `Teks-Erp/src/services/shipping.service.ts:1634-1640` — kilitsiz, tx'siz:
  ```ts
  const updated = await prisma.shipment.updateMany({
    where: { id: shipmentId, status: ShipmentStatus.DISPATCHED },
    data: { invoiceNo: value, invoicedAt: stamp, invoicedById: value ? (userId ?? null) : null } });
  ```
- `:2158-2183` — storno tarafı doğru ama tek taraflı:
  ```ts
  await lockShipmentScopeTx(tx, shipmentId);                       // :2160  8023, İLK ifade
  const sh = await tx.shipment.findUnique({ ... invoiceNo: true ... });  // :2163 taze okuma
  const block = this.resolveUndoBlockReason({ ..., invoiceNo: sh.invoiceNo, ... });  // :2170
  if (block) throw AppError.conflict(block);
  const claim = await tx.shipment.updateMany({ where: { id, status: DISPATCHED }, data: { status: PLANNED, ... } }); // :2179
  ```
- **Koruma kontrolü:** `grep lockShipmentScopeTx src --include='*.ts'` → yalnız `return.service.ts:490` ve `shipping.service.ts:2160`; **`setShipmentInvoice` yok** · `setShipmentInvoice` tx'te değil (tek ifade) · claim'i yalnız `status`'ü pinliyor, storno claim'i yalnız `status`'ü pinliyor → **ikisi de birbirinin alanını pinlemiyor** · şemada `invoiceNo`↔`status` CHECK'i YOK (K2b; `shipments` üzerindeki CHECK envanterinde yok).

**Çakışma senaryosu.**
`T1 undoDispatch(S)` → `:2160` 8023 kilidi → `:2163` `invoiceNo = NULL` okur → `:2170` engel yok → **await = yield**
`T2 setShipmentInvoice(S, "F-123")` → `:1634` `updateMany {id, status: DISPATCHED}` → 1 satır → **COMMIT** (8023'ü beklemez; yalnız satır kilidini alıp bırakır)
`T1 :2179` claim `{id, status: DISPATCHED}` → hâlâ DISPATCHED → `status = PLANNED` yazar → **COMMIT**
**SONUÇ:** `status = PLANNED` ∧ `invoiceNo = 'F-123'` ∧ `invoicedAt` dolu. `releaseSacks: true` gönderilmişse sonuç `CANCELLED` + faturalı.

**failure_mode.** Muhasebeci sevk edilmiş sevkiyata fatura numarasını girerken depo sorumlusu aynı sevkiyatı geri alır (storno). Sevkiyat depoya döner ama üzerinde fatura numarası kalır. Bundan sonra: `resolveUndoBlockReason` `:2043-2046` o sevkiyat için "faturalanmış — geri alınamaz" der (zaten geri alınmıştır, kilitlenme); muhasebe export'u yalnız DISPATCHED satırları saydığı için **fatura numarası defterde durur ama çıkış satırı yoktur** → dış muhasebe programıyla mutabakat farkı doğar ve sebebi hiçbir ekranda görünmez.

**Veride fiili ihlal (K2).** **Arandı, 0.** `sql-saha.sh`: `SELECT count(*) FROM shipments WHERE "invoiceNo" IS NOT NULL AND status <> 'DISPATCHED';` → **0**. (Pencere dar: iki farklı kullanıcı rolü — `shipping:invoice` ve `shipping:undo-dispatch` — aynı sevkiyata aynı saniyede dokunmalı.)

**İş etkisi.** Mali iz ile fiziksel durumun ayrışması; storno akışının kendi kendini kilitlemesi. Düzeltme elle `invoiceNo: null` göndermeyi gerektirir ama o uç da `status = DISPATCHED` şartı koyduğu için **PLANNED sevkiyatın fatura işareti API'den kaldırılamaz** (yalnız DB müdahalesiyle).

**Öneri (2. tur için).**
1. **En ucuz ve tam düzeltme:** storno claim'ine fatura koşulunu ekle → `updateMany({ where: { id: shipmentId, status: DISPATCHED, invoiceNo: null }, ... })`; `count===0` zaten 409 veriyor. Böylece "engel kontrolü" ile "yazım" **tek atomik ifadede** birleşir (beceri §3.2 doğru deseni).
2. Ek olarak `setShipmentInvoice` de `lockShipmentScopeTx` alsın (tx'e alınarak) — iade/storno ile aynı kapsam kilidinde serileşsin.
3. Sed (`[PROD'DA ÇALIŞTIRMA]`): `ALTER TABLE shipments ADD CONSTRAINT shipments_invoice_requires_dispatched CHECK ("invoiceNo" IS NULL OR status = 'DISPATCHED') NOT VALID;` — mevcut veri temiz olduğu için `VALIDATE` de koşabilir; geri alma `DROP CONSTRAINT`. `test_db_invariants` envanterine **yazılması zorunlu**.

**Kabul kriteri.** Storno ile fatura işaretini paralel koşturan sonda: 100 turda `invoiceNo IS NOT NULL AND status <> 'DISPATCHED'` **0**; `test_shipment_invoice`'a eklenir. **Efor:** 0,5 gün (1. madde) / +0,5 gün (CHECK).

**Önceki defter.** ② endişe hipotezi listesinde yoktu — yeni. K12'de ilgili kayıt yok.

---

### [KYY-2-06] İş emri oluşturma transaction'ı AÇIKKEN havuz client'ı kullanıyor — repo'nun kendi ölçüp yasakladığı desen, tx ikizi yazılmış ama kullanılmıyor

| Şiddet | **S2** | Kategori | D / H | Öncelik | **P2** | Modül | İş emri | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `WorkOrderService.create` interactive transaction'ın İÇİNDEN iki kez **havuz** client'ına gidiyor: iş emri numarası üretimi (üç sorgu) ve varsayılan plan süresi ayarı. Her ikisi de tx'in tuttuğu bağlantıya ek olarak **ikinci bir havuz bağlantısı** ister. Bu, repo'nun barkod helper'ında ölçüp açıkça yasakladığı desendir; üstelik doğru ikizi (`generateWorkOrderNumberTx`) yazılmış ama `create()` onu çağırmıyor.

**Kanıt.**
- `Teks-Erp/src/services/workorder.service.ts:988-989` — tx içinde havuz çağrısı:
  ```ts
  const workOrder = await withBarcodeRetry(() => prisma.$transaction(async (tx) => {
    const workOrderNumber = manualWorkOrderNumber ?? (await this.generateWorkOrderNumber());
  ```
- `:582` ve `:592` — `generateWorkOrderNumber` gövdesi **`prisma.` ile** (tx değil):
  ```ts
  const todays = await prisma.workOrder.findMany({ where: { workOrderNumber: { gte: prefix, startsWith: prefix } }, ... });
  const exists  = await prisma.workOrder.findUnique({ where: { workOrderNumber: candidate } });
  ```
- `:1002` → `:395` — ikinci havuz çağrısı:
  ```ts
  const days = await readWorkOrderDefaultPlanDurationDays();   // argümansız
  ```
  Oysa `system-setting.service.ts:2925-2927` **`tx?` parametresi kabul ediyor**.
- **Doğru ikiz var, kullanılmıyor:** `Teks-Erp/src/services/helpers/workorder-clone.helper.ts:31-44` `generateWorkOrderNumberTx(tx, date)` — yalnız split servisinden çağrılıyor.
- **Repo'nun kendi ölçümü (aynı sınıf, aynı repo):** `Teks-Erp/src/services/helpers/roll-barcode.helper.ts:56-64`
  > "⚠️ **HAVUZ CLIENT'INI TX AÇIKKEN KULLANMA.** … **ikinci bir bağlantı** ister ve havuz (max 30) tükenir: 30 eş zamanlı işlemin **yalnız 3'ü** tamamlandı, kalanı `timeout exceeded when trying to connect` aldı (ölçüldü)."
- Havuz: `Teks-Erp/src/lib/prisma.ts:69-71` `max: 30`, `connectionTimeoutMillis: 5_000`.
- **Koruma kontrolü:** kilit yok (gerekmiyor — numara `workOrderNumber` unique + `withBarcodeRetry` ile korunuyor ✓); eksik olan **bağlantı disiplini**, korumanın kendisi değil.

**Çakışma senaryosu.** N eşzamanlı `POST /api/work-orders`:
`T1..T30` her biri `:988` `$transaction` açar → **30 havuz bağlantısının tamamı tx'lerde**
`T1 :989` → `generateWorkOrderNumber()` → `:582` `prisma.workOrder.findMany` → **31. bağlantı istenir** → havuzda boş slot yok
Bekleyen tx'ler bağlantılarını commit etmeden bırakmaz → 5 sn sonra `connectionTimeoutMillis` dolar → `classifyPoolTimeout` → **503**; aynı sırada ilgisiz uçlar da bağlantı bulamaz.
**SONUÇ:** kendi kendini besleyen tıkanma; hiçbir iş emri açılamaz ve sistem geneli 503 verir.

**failure_mode.** Vardiya başında Hızlı İş Emri ile toplu iş emri açılışı yapılırsa (ya da bir içe aktarım/otomasyon aynı ucu paralel çağırırsa) havuz tükenir; kullanıcı "Sunucu meşgul" (503) görür ve **aynı anda depo/sevkiyat ekranları da 503 döner** — arıza iş emri ekranıyla sınırlı kalmaz.

**Veride fiili ihlal (K2).** **Arandı — ölçek bugün riski taşımıyor.** `sql-saha.sh`: günlük iş emri açılışı zirvesi **21** (2026-08-14), sonra 19 ve 17. Yani 30 eşzamanlı tx bugünkü sahada gerçekçi değil → **olasılık düşük**, mekanizma gerçek. Şiddet bu ölçümle S1'den S2'ye indirildi (şiddet enflasyonu yok).

**İş etkisi.** Bugün: gizli borç. Yarın (ikinci müşteri / içe aktarım / toplu WO açan bir otomasyon) tetiklendiğinde tüm API 503 döner ve sebebi iş emri ekranında aranmaz.

**Öneri (2. tur için).** Tek satırlık iki değişiklik, migration yok:
1. `create()` içinde `this.generateWorkOrderNumber()` yerine **`generateWorkOrderNumberTx(tx, new Date())`** (helper zaten var, `withBarcodeRetry` sarmalı P2002'yi zaten yeniden deniyor).
2. `resolvePlanDates(...)`'a `tx` geçirilsin ve `readWorkOrderDefaultPlanDurationDays(tx)` olarak çağrılsın (imza zaten destekliyor).
3. Mekanik bekçi: `scripts/` altında AST ile "`$transaction(async (tx)` gövdesinde `prisma.` ile başlayan delegate çağrısı" arayan bir sonda — `roll-barcode.helper`'ın `KNOWN_TX_INTERNAL` listesiyle aynı ruhta.

**Kabul kriteri.** 30 eşzamanlı `create()` çağrısında **30/30** başarı ve havuz metriği sağlıklı (kabul kriteri `roll-barcode.helper.ts:63-65`'teki iki koşullu ölçütün aynısı: `T1 < 100 ms` **ve** `T2 = 30/30`). **Efor:** 0,5 gün + 0,5 gün bekçi.

**Önceki defter.** K3a #11/L1/L2 aynı noktaları işaretlemiş; bu bulgu gerekçeyi repo'nun kendi ölçümüne bağlıyor. F-CORE-VER-001 (barkod sayacı) **aynı sınıfın kapatılmış hali** — burada kapatılmamış.

---

### [KYY-2-07] `createShipment` replay'i iptal edilmiş sevkiyatı "kuruldu" diye döndürüyor; payload karşılaştırması da yok

| Şiddet | **S2** | Kategori | B.3 | Öncelik | **P2** | Modül | Sevkiyat | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Idempotency'nin en pahalı hatası (beceri §8): iptal edilmiş kaydın token'ı replay edilince `success: true` dönmek. `readCreateShipmentReplay` sevkiyatın statüsüne bakmıyor; `CANCELLED` bir sevkiyat için de "Sevkiyat kuruldu (onay bekliyor)" mesajı dönüyor. Ayrıca gelen payload ile mevcut kaydın karşılaştırması hiç yapılmıyor — farklı çuval kümesiyle gelen aynı token sessizce eski sevkiyatı döndürüyor.

**Kanıt.**
- `Teks-Erp/src/services/shipping.service.ts:1361-1374`:
  ```ts
  private async readCreateShipmentReplay(clientToken: string): Promise<ApiResponse<unknown> | null> {
    const sh = await prisma.shipment.findUnique({ where: { clientToken }, select: { id: true, shipmentNo: true, status: true } });
    if (!sh) return null;
    const dispatched = sh.status === ShipmentStatus.DISPATCHED;
    return { success: true, data: { id: sh.id, shipmentNo: sh.shipmentNo, status: sh.status, dispatched },
             message: dispatched ? `Sevk edildi: ${sh.shipmentNo}` : `Sevkiyat kuruldu (onay bekliyor): ${sh.shipmentNo}` };
  }
  ```
  `CANCELLED` → `dispatched=false` → **"Sevkiyat kuruldu (onay bekliyor)"**.
- Çağrı yerleri: `:1383-1386` (istek başında) ve `:1439-1442` (clientToken P2002 catch'i).
- `prisma/schema.prisma` — `ShipmentStatus` **CANCELLED içerir** (`:4106-4110`); `cancelShipment` `:1988` ve `releaseSacks` yolu bu statüyü yazar.
- **Kardeş yollarda koruma VAR (asimetri kanıtı):** `workorder.service.ts:1172` replay'de `isActive:false → 409`; `order.service.ts:2040-2060` payload kimliği (müşteri+şube+satır sayısı) karşılaştırıp uyuşmazsa **409 `CLIENT_TOKEN_COLLISION`**. Sevkiyatta ikisi de yok.
- **Koruma kontrolü:** `clientToken` **düz** unique ✓ (koruma var, davranış yanlış) · statü kontrolü yok · payload kontrolü yok · advisory/claim gerekmez.

**Çakışma senaryosu.** (Yarış değil, **durum makinesi + replay** çizelgesi.)
`t0` mobil `createShipment(token=X, sackIds=[A])` → sevkiyat `SVK…0007` kurulur (PLANNED rejiminde) → yanıt kaybolur.
`t1` kullanıcı sevkiyatı **iptal eder** → `cancelShipment` `:1988` → `status = CANCELLED`, çuvallar havuza döner, tahsisler silinir.
`t2` mobil kuyruk "Tekrar Dene" ile **aynı token X**'i gönderir → `:1383` replay → **`success: true` + "Sevkiyat kuruldu (onay bekliyor): SVK…0007"**.
**SONUÇ:** operatör sevkiyatın kurulduğunu görür; ortada sevkiyat yoktur, çuvallar depodadır.

**failure_mode.** Tablet sevkiyatı kurar, ağ koptuğu için yanıtı alamaz; büro o sırada yanlış kurulan sevkiyatı iptal eder; tabletin kuyruğu tekrar denediğinde ekranda "Sevkiyat kuruldu: SVK2808260007" yazar. Operatör çuvalları araca yükler; sistemde sevkiyat CANCELLED, irsaliye yok, stok düşmemiş → **mal kayıtsız çıkar**. İkinci varyant: kullanıcı farklı çuval kümesiyle aynı formu yeniden gönderirse (token yapışkan) yeni çuvallar **sessizce yutulur** ve eski sevkiyat döner.

**Veride fiili ihlal (K2).** `sql-saha.sh` ile arandı: saha kopyasında `shipments` içinde `clientToken IS NOT NULL AND status='CANCELLED'` satırı **ölçülmedi** (sevkiyat sayısı 40, `clientToken` alanı mobil akışa özgü). Kardeş yolda ön koşul **kanıtlandı**: `orders` tablosunda `status='CANCELLED' AND clientToken IS NOT NULL` → **4 satır** (bkz. KYY-2-08) → aynı desenin fiili zemini sahada mevcut.

**İş etkisi.** Kayıtsız mal çıkışı ya da yutulan çuval seçimi; ikisi de sessiz.

**Öneri (2. tur için).**
1. `readCreateShipmentReplay`'e statü kapısı: `if (sh.status === ShipmentStatus.CANCELLED) throw AppError.conflict("Bu sevkiyat iptal edilmiş — yeni sevkiyat için ekranı yenileyin.", { code: "SHIPMENT_CANCELLED" });` (WO'daki `isActive:false → 409` ile aynı desen).
2. Payload kimliği: `customerId + branchId + sackIds.length` (Order'daki hafif karşılaştırmanın ikizi) uyuşmuyorsa **409 `CLIENT_TOKEN_COLLISION`** + mevcut `shipmentNo` detayda.
3. Mobil taraf: `entryAttempt.ts` sözleşmesi zaten "kesin 4xx'te token YAPIŞMAZ" diyor → 409 alınca token tazelenir, döngü kurulmaz.
Migration/izin **YOK**; APK gerekmez (istemci 4xx'i zaten doğru işliyor), backend ÖNCE.

**Kabul kriteri.** `test_shipping_client_token`'a iki sonda: (a) iptal edilmiş sevkiyatın token'ı → 409 `SHIPMENT_CANCELLED`; (b) farklı `sackIds` ile aynı token → 409 `CLIENT_TOKEN_COLLISION`. **Efor:** 0,5 gün.

**Önceki defter.** ② hipotez listesinde "(B) iptal edilmiş sevkiyat/sipariş token replay'i (4. durum) bekçisiz" olarak vardı → **DOĞRULANDI**. K11 H-9 "iptal-sonrası token replay bekçisiz" tespitiyle örtüşüyor.

---

### [KYY-2-08] Sipariş replay'i iptal edilmiş siparişi döndürüyor — WO yolunda olan koruma Order yolunda yok

| Şiddet | **S2** | Kategori | B.3 | Öncelik | **P2** | Modül | Sipariş | Kanıt seviyesi | **K1 + K2 (ön koşul)** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `resolveCreateTokenReplay` mevcut siparişi yalnız `customerId + branchId + satır sayısı` ile doğruluyor; **`status`'a hiç bakmıyor**. İptal edilmiş bir siparişin token'ı tekrar gelirse çağıran "cached" yanıt üretir ve kullanıcı "Sipariş açıldı" görür. Aynı servis ailesinin WO ikizinde bu kapı **var** (`isActive: false → 409`).

**Kanıt.**
- `Teks-Erp/src/services/order.service.ts:2026-2050`:
  ```ts
  const existing = await prisma.order.findUnique({ where: { clientToken }, ... });
  if (!existing) throw err;
  const same = existing.customerId === data.customerId
    && (existing.branchId ?? null) === ((data.branchId as string | null | undefined) ?? null)
    && Array.isArray(existingLines) && existingLines.length === incomingLineCount;
  if (same) return existing;                       // ← status hiç okunmuyor
  ```
- `prisma/schema.prisma` — `OrderStatus` `:194-200` **CANCELLED** içerir; `Order.cancelledAt` `:27` var.
- Kardeş: `Teks-Erp/src/services/workorder.service.ts:1172` — `isActive:false → 409` (aynı sınıf, korunmuş).
- **Koruma kontrolü:** `clientToken` **partial** unique ✓ · statü/`cancelledAt` kontrolü YOK · advisory/claim gerekmiyor.

**Çakışma senaryosu.** (Durum makinesi + replay.)
`t0` mobil "Yeni Sipariş" (`mobile:siparis`) token X ile gönderir → `SIP…0042` açılır, yanıt kaybolur.
`t1` büro siparişi iptal eder (`status = CANCELLED`).
`t2` kuyruk aynı token X ile tekrar gönderir → `create` P2002 → `:2026` replay → `same === true` → **iptal edilmiş sipariş `success` ile döner**.
**SONUÇ:** kullanıcı "Sipariş açıldı: SIP…0042" görür; sipariş listesinde yoktur (iptal süzgeci), karşılama raporunda yoktur.

**failure_mode.** Saha kullanıcısı müşteriden aldığı siparişi tablete girer, ağ koptuğu için tekrar dener; büro o arada siparişi iptal etmiştir. Tablette "açıldı" yazar → sipariş kaydı yok sayılır ve mal üretilmez; ya da tersine, kullanıcı ikinci kez girmediği için sipariş tamamen kaybolur.

**Veride fiili ihlal (K2).** **Ön koşul sahada MEVCUT.** `sql-saha.sh`:
```sql
SELECT count(*) FILTER (WHERE status='CANCELLED' AND "clientToken" IS NOT NULL) AS iptal_tokenli,
       count(*) FILTER (WHERE "clientToken" IS NOT NULL) AS tokenli, count(*) FROM orders;
-- saha: 4 | 269 | 278
```
→ 4 iptal edilmiş siparişin token'ı hâlâ replay edilebilir durumda.

**İş etkisi.** Sessiz yanlış cevap (beceri §8: "409'dan daha kötü"). Sipariş defteri ile sahanın algısı ayrışır.

**Öneri (2. tur için).** `:2038` civarına statü kapısı:
```ts
if (existing.status === OrderStatus.CANCELLED)
  throw AppError.conflict(`Bu form daha önce kaydedilmiş ve sipariş iptal edilmiş: ${existing.orderNumber}. Yeni sipariş için formu kapatıp yeniden açın.`, { code: "ORDER_CANCELLED" });
```
(WO'daki `isActive:false` dalının birebir ikizi; mesaj kalıbı `CLIENT_TOKEN_COLLISION` ile aynı aile.) Migration/izin/APK **YOK** — mobil 4xx'te token'ı zaten tazeliyor (`test_mobile_order_permission` bunu ölçüyor).

**Kabul kriteri.** `test_client_token_idempotency`'ye CT1c: sipariş iptal edildikten sonra aynı token → 409 `ORDER_CANCELLED`, yeni sipariş açılmaz. **Efor:** 0,25 gün.

**Önceki defter.** ② hipotezi "(B) 4. durum: iptal edilmiş siparişin token'ı — `resolveCreateTokenReplay` statüye bakıyor mu (② okusun)" → **okundu, bakmıyor**. K11 H-9 ile örtüşüyor.

---

### [KYY-2-09] `recordPrintEvent` `labelDirty`'yi KOŞULSUZ temizliyor — baskı ile print-event arasında yapılan düzeltme sessizce "etiket güncel" işaretleniyor

| Şiddet | **S2** | Kategori | A.1 / E | Öncelik | **P2** | Modül | Etiket | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Etiket baskı olayı üç ayrı yazımdan oluşuyor ve hiçbiri transaction'da değil. Ortadaki yazım `labelDirty: false` ile `labelPrintedAt`'ı **tek ve koşulsuz** bir `update`'te birleştiriyor. `labelPrintedAt` için koşulsuzluk doğru (yorum gerekçeyi yazıyor), ama aynı ifade `labelDirty`'yi de koşulsuz temizlediği için, kâğıt basıldıktan SONRA yapılan bir veri düzeltmesinin bayat işareti geri alınıyor.

**Kanıt.**
- `Teks-Erp/src/services/label.service.ts:2094` → `:2112-2115` → `:2145-2156` — **üç ayrı yazım, tx yok**:
  ```ts
  await this.seedRollLabelSnapshot(rollId, userId, opts);                       // ①
  await prisma.roll.update({ where: { id: rollId },
    data: { labelDirty: false, labelPrintedAt: new Date() } });                 // ② koşulsuz
  await AuditService.log({ ..., event: "LABEL_PRINTED" });                      // ③
  ```
- `:2106-2109` — koşulun **bilerek kaldırıldığı** yorum: "Koşul KALDIRILDI (eskiden `where: { labelDirty: true }`): damga her baskıda yazılmalı…" — gerekçe `labelPrintedAt` için geçerli, `labelDirty` için değil.
- Karşı taraf: `Teks-Erp/src/services/inventory.service.ts:3912` — düzeltme `labelDirty = true` yazıyor:
  ```ts
  if (colorChanged || widthChanged || metrajChanged || qualityChanged || propsChanged || foldChanged) rollData.labelDirty = true;
  ```
- Kardeş yolda doğru desen VAR: çuval print-event'i `:1737` `updateMany WHERE labelDirty:true` (idempotent, koşullu) — **aynı dosyada iki farklı sözleşme**.
- **Koruma kontrolü:** tx yok · claim yok (koşulsuz `update({where:{id}})`) · versiyon/`updatedAt` karşılaştırması yok · DB seddi yok.

**Çakışma senaryosu.**
`t0` operatör `GET /api/labels/rolls/:id` ile etiketi render edip **basar** (kâğıt çıktı: 700 m).
`t0+50ms` süpervizör `applyManualProperties` ile metrajı 690'a düzeltir → `inventory.service.ts:3912` `labelDirty = true` **COMMIT**.
`t0+200ms` istemcinin `POST /api/labels/rolls/:id/print` isteği ulaşır → `label.service.ts:2112` **koşulsuz** `labelDirty = false` **COMMIT**.
**SONUÇ:** kâğıtta 700 m yazıyor, veride 690 m var, sistem "etiket güncel" diyor. Hata yok, log yok, hiçbir yüzeyde uyarı yok.

**failure_mode.** KK1'de top girilir, etiket basılır; hemen ardından metraj/kalite düzeltilir; tabletin print-event isteği (kuyruk/gecikme) düzeltmeden sonra ulaşır. Yanlış metrajlı etiketle top çuvala okutulur, çuval etiketine ve **irsaliyeye** o metraj yazılır; `labelDirty` mekanizmasının varlık sebebi olan "ölü/bayat etiket" uyarısı hiç doğmaz.

**Veride fiili ihlal (K2).** **Arandı, ayırt edilemedi.** `sql-saha.sh`:
```sql
SELECT count(*) FROM rolls
WHERE "labelPrintedAt" IS NOT NULL AND "labelDirty"=false AND "updatedAt" > "labelPrintedAt" + interval '2 second';
-- saha: 1534
```
Bu sayı **kanıt değildir**: CLAUDE.md'nin kendi notu (2026-07-30) `updatedAt`'in gerçek "hareket" olmadığını söylüyor (etiket yeniden basımı, not düzenlemesi de günceller). Sayı yalnız **pencerenin genişliğini** gösterir; ayırt edici sorgu `system_logs`'ta `LABEL_PRINT_EVENT` ile `ROLL_MANUAL_OVERRIDE` zaman damgalarının eşleştirilmesini gerektirir (D-I'ye not).

**İş etkisi.** Basılı etiket ile veri sessizce ayrışır ve sistem bunu "uyumlu" olarak işaretler; irsaliyeye yanlış metraj taşınabilir.

**Öneri (2. tur için).**
1. İki yazımı ayır (tek `update` yerine iki ifade, ikisi de aynı tx'te):
   ```ts
   await prisma.$transaction(async (tx) => {
     await tx.roll.update({ where: { id: rollId }, data: { labelPrintedAt: new Date() } });     // koşulsuz — doğru
     await tx.roll.updateMany({ where: { id: rollId, updatedAt: snapshotUpdatedAt }, data: { labelDirty: false } });
   });
   ```
   `snapshotUpdatedAt` = etiketin render edildiği anda okunan `updatedAt` (istemci `print-event` gövdesinde geri gönderir) → veri değişmişse bayat işareti **korunur**.
2. Daha ucuz ara çözüm (istemci sözleşmesi değişmeden): `labelDirty: false` yazımını **`where: { id, labelDirty: true, updatedAt: { lte: printStartedAt } }`** gibi bir koşula bağlamak; `printStartedAt` sunucuda `recordPrintEvent` girişinde alınır (pencereyi 200 ms'ye indirir, kapatmaz).
3. Üç yazımı tek tx'e almak (kart yolu KYY-33 zaten tx'li — iki sözleşmenin hizalanması).
Migration/izin **YOK**; 1. madde istemci alanı ister → **APK/Electron gerekir**, 2. madde yalnız backend.

**Kabul kriteri.** Sonda: etiket render → veri düzeltmesi → print-event sırasıyla koşturulunca `labelDirty` **true kalır**; `test_label_dirty_sources`'a eklenir (negatif sonda: koşul kaldırılınca kırmızı). **Efor:** 0,5 gün (2. madde) / 1,5 gün (1. madde, istemci dahil).

**Önceki defter.** ② hipotezi "(D) kısmi durum: snapshot güncel, `labelPrintedAt` boş, kâğıt çıkmış (K9 H-7)" ile aynı kök; bu bulgu **ters yönünü** (dirty'nin yanlış temizlenmesi) ekliyor.

---

### [KYY-2-10] `createManualRoll` FAZ 2 kilit sırasını tersine çeviriyor — 30 çağrı yerinin tek istisnası, ABBA adayı

| Şiddet | **S3** | Kategori | A.1 | Öncelik | **P3** | Modül | Tambur / manuel top | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Projede yerleşik kilit protokolü **WO satırı → top satırı**. `tambur-manual.service.ts` FAZ 2 bunu tersine çeviriyor: önce topu claim ediyor, sonra `touchWorkOrderTx` çağırıyor. Aynı iş emrine dokunan başka bir akış (iptal, finalize, kurşun) WO'yu kilitleyip topları toplu güncellemeye giderse iki yönlü bekleme doğar. Aynı sınıfın ölçülmüş örneği KYY-2-03'tür (deadlock → P2039 → 500).

**Kanıt.**
- `Teks-Erp/src/services/tambur-manual.service.ts:1149-1167` (roll claim) → **`:1191`** (`touchWorkOrderTx`):
  ```ts
  const claim = await tx.roll.updateMany({ where: { id: roll.id, status: { in: [STOCK, WAREHOUSE] }, sackId: null, shipmentId: null, currentStepId: null }, data: { currentStepId: step.id, status: IN_PRODUCTION, ... } });
  ...
  await touchWorkOrderTx(tx, step.workOrderId);          // :1191 — claim'den SONRA
  ```
- Karşı desen (29 çağrı yerinin tamamı WO'yu önce alıyor): `tambur.service.ts:931`, `subcontractor.service.ts:1041/2016/2681/3401/4807/5275/6022`, `inventory.service.ts:3201/3559/4128/4396/4670`, `kursun-qc.service.ts:850/1093`, `kursun-bypass.service.ts:771/1369/1816/1968`, `workorder.service.ts:4778`, `batch.service.ts:384/594/880`, `order.service.ts:2786/3172`, `workorder-split.service.ts:621`, `workorder-batch-drop.service.ts:281`.
- Karşı taraf örneği (WO kilidi → toplu top yazımı): `workorder.service.ts:3387` (WO claim) → `:3513` (`R blanket updateMany`).
- **Koruma kontrolü:** advisory lock yok · kanonik sıra yok · retry sarmalı yok · deadlock 409'a eşlenmiyor (KYY-2-03).

**Çakışma senaryosu.**
`T1 workorder.softDelete(WO)` → `:3387` WO claim [**WO satır kilidi**] → … → `:3513` `roll.updateMany` (bu WO'nun tüm toplarını hedefler) → **bekler** (T2'nin topu)
`T2 tambur-manual.createManualRoll` FAZ 2 → `:1149` roll claim [**roll satır kilidi**, `currentStepId = step` yazıldı] → `:1191 touchWorkOrderTx` → **bekler** (T1'in WO satırı)
**SONUÇ:** karşılıklı bekleme → PG deadlock → (KYY-2-03'te ölçüldüğü gibi) `P2039` → **HTTP 500**.

**failure_mode.** Tambur operatörü "Manuel top ekle" ile yeni top eklerken planlamacı aynı iş emrini iptal eder. Operatör "Sunucu hatası" görür; **top FAZ 1'de zaten yaratılmıştır** ve FAZ 2 düştüğü için `STOCK`'ta yetim kalır (belgeli davranış: idempotent tekrar bağlar — ama operatör 500 gördüğü için tekrar denemeyebilir; o zaman envanterde sahipsiz bir top kalır).

**Veride fiili ihlal (K2).** Aranmadı — deadlock iz bırakmaz; yetim topun imzası (`entrySource=MANUAL_ENTRY` ∧ `currentStepId IS NULL` ∧ `clientToken IS NOT NULL`) meşru durumla örtüşüyor (tekrar hiç gelmemiş olabilir). D-B'ye not.

**Repro (K3).** **Denenmedi** — WO + rota adımı + oturum/cihaz fixture'ı gerektiriyor ve aynı sınıf KYY-2-03'te ölçüldü (36/80). Negatif sonuç değil, **kapsam kararı**; 2. turda `test_tambur_manual_roll`'a paralel sonda eklenmesi önerilir.

**İş etkisi.** Nadir ama görünmez: 500 + yetim top. Yetim top envanterde "ham stok"ta durur ve hangi iş emrine ait olduğu yalnız audit'ten okunur.

**Öneri (2. tur için).** `touchWorkOrderTx(tx, step.workOrderId)` çağrısını **tx'in ilk ifadesine** al (claim'den önce) — 29 kardeşle aynı sıra. Davranış değişmez (WO kilidi zaten aynı tx içinde alınıyor), yalnız sıra kanonikleşir. Ek olarak KYY-2-03'ün 2. maddesi (P2039 → 409) bu yolu da güvenli hale getirir. Migration/izin/APK **YOK**.

**Kabul kriteri.** `touchWorkOrderTx`in FAZ 2 tx'inde ilk ifade olduğunu mekanik doğrulayan sonda (AST ya da metin taraması, `test_dispatch_without_color` §1'in metin-tarama emsali). **Efor:** 0,25 gün.

**Önceki defter.** K3b H-11 "kardeş sırasının tek istisnası" tespiti **doğrulandı**; H-1 (tambur-undo ile ABBA) bu turda ölçülmedi.

---

### [KYY-2-11] DB kopyası kayıt blob'unda oku-değiştir-yaz — kuyruk yalnız bir çağrı yerini koruyor, doğrulama sonucu sessizce kayboluyor

| Şiddet | **S3** | Kategori | A.1 (JSON lost update) | Öncelik | **P3** | Modül | Ops / DB kopyası | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Kopya kayıtları tek bir `SystemSetting` JSON blob'unda tutuluyor ve **tümüyle** geri yazılıyor. Yazarlar için bir kuyruk kurulmuş ama kuyruğa **yalnız `reverifyCopy` giriyor**; kopya işinin `persistRecord`'u ve `dropCopy` doğrudan yazıyor. Beceri §3.3'ün klasik lost-update'i: farklı anahtarlara yazan iki akış birbirini ezer, hiçbir constraint'e takılmaz.

**Kanıt.**
- `Teks-Erp/src/services/db-copy.service.ts:279-296` — blob tam yazılıyor:
  ```ts
  export async function writeCopyRecords(copies: Record<string, CopyRecord>, existingNames: Set<string>): Promise<void> {
    const blob: CopiesBlob = { version: 1, copies: pruned };
    await prisma.systemSetting.upsert({ where: { key: COPIES_SETTING_KEY }, create: {...}, update: { value: blob as never } });
  ```
- Kuyruk **yalnız burada**: `:795` `let copyRecordsWriteQueue: Promise<unknown> = Promise.resolve();` → `:800-813` `reverifyCopy` içinde `copyRecordsWriteQueue.then(...)`.
- Kuyruksuz iki yazar:
  - `:474-482` `persistRecord` → `readCopyRecords()` → `records[name] = rec` → `writeCopyRecords(...)`
  - `:718-721` `dropCopy` → `readCopyRecords()` → `delete records[actual]` → `writeCopyRecords(...)`
- **Koruma kontrolü:** `jsonb_set`/`json_build_object` kullanılmıyor (`grep` → yok) · satır kilidi/`FOR UPDATE` yok · advisory lock yok · tx yok · DB seddi yok. Kısmi hafifletici: `writeCopyRecords` `existingNames` ile budama yapıyor → **silinmiş DB'nin kaydı diriltilemiyor** (bu yön güvenli).

**Çakışma senaryosu.**
`T2 dropCopy(B)` → `:718 readCopyRecords()` → blob `{A: eski, B}` okundu → **await = yield** (DROP DATABASE sürüyor)
`T1 reverifyCopy(A)` → `verifyCopy(A)` (10-20 sn) → kuyruk → `readCopyRecords()` → `{A: eski, B}` → `records[A] = {state:"ready", verification: yeni}` → `writeCopyRecords` **COMMIT**
`T2 :720 delete records[B]` → `writeCopyRecords({A: **eski**})` **COMMIT**
**SONUÇ:** A'nın taze doğrulama sonucu kayboldu; panel A'yı hâlâ "doğrulanmadı/başarısız" gösteriyor.

**failure_mode.** Yönetici bir kopyayı yeniden doğrularken (uzun süren işlem) başka bir kopyayı siler. Silme işlemi doğrulama sonucunu eski haliyle geri yazar; panelde canlıya alınabilecek sağlam kopya "sağlıksız" görünür ve yönetici ya yeniden doğrulama turuna girer (her tur tüm DB boyutlarını + satır sayılarını tarar) ya da sağlam kopyayı kullanmaz.

**Veride fiili ihlal (K2).** Aranmadı — blob anlık durumu taşıdığı için geçmiş ihlal iz bırakmaz. Saha kopyasında `dbRestore.copies` anahtarının içeriği kişisel/ops verisi olduğu için rapora alınmadı (yeri: `system_settings.key = 'dbRestore.copies'`).

**İş etkisi.** Veri kaybı yok; **karar verisi** yanlış. İki yönetici gerektirir → olasılık düşük.

**Öneri (2. tur için).** `persistRecord` ve `dropCopy`'nin blob yazımlarını **aynı `copyRecordsWriteQueue`'dan geçir** (kuyruk zaten var, üç çağrı yerini de kapsasın) — ya da `writeCopyRecords`'u kuyruğun içine al, böylece kuyruk **fonksiyonun sözleşmesi** olsun ve yeni bir çağrı yeri eklendiğinde unutulamasın. Migration/izin **YOK**.

**Kabul kriteri.** `test_db_copy`'ye (bugün `TEST_DB_COPY=1` kapılı) sonda: sahte uzun `verifyCopy` sırasında `dropCopy` koşturulunca doğrulama sonucu **korunur**. **Efor:** 0,25 gün.

**Önceki defter.** ② hipotez listesinde YOKTU — yeni bulgu.

---

### [KYY-2-12] `STATION_KIND_PERM` tip düzeyinde bağlı değil — yeni istasyon türü eklenince oturum izni kontrolü sessizce atlanır (fail-open)

| Şiddet | **S3** | Kategori | G / L (OCP kayıt defteri) | Öncelik | **P3** | Modül | Çalışma oturumu | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** İki liste aynı dosyada yan yana duruyor: hangi istasyon türünde oturum açılabileceği (`SESSIONABLE_STATION_KINDS`) ve o türde oturum açmak için hangi mobil iznin gerektiği (`STATION_KIND_PERM`). İkincisi `Record<string, string>` olarak tiplenmiş, yani birincisiyle **tip düzeyinde bağlı değil**. Listeye yeni bir tür eklenirse izin haritasında karşılığı olmaz, `needM`/`needS` `undefined` olur ve kontrol **sessizce atlanır** — derleyici de bekçi de görmez.

**Kanıt.**
- `Teks-Erp/src/services/work-session.service.ts:33`:
  ```ts
  export const SESSIONABLE_STATION_KINDS = ["RAW_QC", "PROCESS_QC", "TAMBUR", "SHIPPING"] as const;
  ```
- `:38-43` — **bağsız tip**:
  ```ts
  const STATION_KIND_PERM: Record<string, string> = {
    RAW_QC: "mobile:kk1", PROCESS_QC: "mobile:kk2-kursun", TAMBUR: "mobile:tambur", SHIPPING: "mobile:tarti-paket" };
  ```
- Kullanım `:204-207` (makine dalı) ve `:244-247` (istasyon dalı) — **fail-open**:
  ```ts
  const needM = STATION_KIND_PERM[machine.station.kind];
  if (input.permissions !== undefined && needM && !matchesPermission(input.permissions, needM)) throw AppError.forbidden(...);
  ```
  `needM === undefined` → `&& needM` kısa devre → **kontrol hiç koşmaz**.
- **Koruma kontrolü:** `isSessionableKind` `:201`/`:241` önce koştuğu için **bugün ulaşılabilir değil** (iki liste hizalı: 4↔4) · tip zorlaması yok (`Record<(typeof SESSIONABLE_STATION_KINDS)[number], string>` değil) · iki listenin eşitliğini ölçen bekçi yok (`test_work_session` oturum davranışını ölçüyor, liste eşitliğini değil).

**Çakışma senaryosu.** Eşzamanlılık çizelgesi **yok** — bu bir OCP/fail-open bulgusudur (beceri §7.6): *"yeni tür eklenince ne sessizce eski davranışa düşer"*. Çizelge yerine değişiklik senaryosu:
`SESSIONABLE_STATION_KINDS`'e `"PACKAGING"` eklenir (mobil ekran registry'siyle hizalamak için) → `STATION_KIND_PERM`'e satır **unutulur** → `isSessionableKind` geçer, `needM` `undefined` → yalnız `mobile:kk1` taşıyan operatör PACKAGING makinesinde oturum açar ve tüm damgaları (`getStampContext`) o istasyona yazılır.

**failure_mode.** Yeni bir istasyon türü eklendiğinde F221 ile kurulmuş "yalnız ilgili izne sahip operatör o tür istasyonu açabilir" kuralı o tür için **hiç uygulanmaz**; hata mesajı, log ve derleme hatası yoktur — tek belirti sahada yanlış operatörün istasyonu devralabilmesidir.

**Veride fiili ihlal (K2).** **Arandı, bugün ulaşılamaz:** iki liste hizalı. Ek gözlem (E/I-alanı): saha kopyasında `machineId` dolu oturum **0** → makine bazlı atama hiç kurulmamış, dolayısıyla makine dalı sahada henüz kullanılmıyor.

**İş etkisi.** Bugün sıfır; yarın bir istasyon türü eklendiğinde sessiz yetki kaçağı. Düzeltmesi tek satır olduğu için borç bırakmaya değmez.

**Öneri (2. tur için).**
```ts
type SessionableKind = (typeof SESSIONABLE_STATION_KINDS)[number];
const STATION_KIND_PERM: Record<SessionableKind, string> = { ... };   // eksik üye → DERLEME HATASI
```
Böylece kayıt defteri tiple zorlanır ve beceri §7.6'nın "fail-closed" karşı-örneğine döner. Migration/izin/APK **YOK**.

**Kabul kriteri.** `SESSIONABLE_STATION_KINDS`'e sahte bir üye eklendiğinde `npm run typecheck` **kırmızı** (negatif sonda ile kanıtlanır). **Efor:** 0,25 gün.

**Önceki defter.** K5 H3 "`STATION_KIND_PERM` fail-open" tespiti **doğrulandı** ve mekanizması (tip bağsızlığı + kısa devre) gösterildi.

---

### [KYY-2-13] İçe aktarımda idempotency token'ı yalnız BİTMİŞ koşumu koruyor — uçuştaki tekrar ikinci tam koşumu başlatıyor

| Şiddet | **S3** | Kategori | B.3 / F | Öncelik | **P3** | Modül | İçe aktarım | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `import.apply` token kontrolünü koşumun **başında** yapıyor ama koşum kaydını (`importRun`) **sonunda** yazıyor. Aradaki tüm süre boyunca "bu token daha önce koştu mu" sorusunun cevabı **hayır**. Panel/proxy zaman aşımından sonra kullanıcı Tekrar Dene derse ikinci tam koşum başlar ve doğal anahtarı olmayan adaptörlerde (`order.adapter` create-only) her satır ikinci kez yazılır.

**Kanıt.**
- `Teks-Erp/src/services/import/import.service.ts:446-471` — token kapısı başta:
  ```ts
  if (options.clientToken) {
    const prior = await prisma.importRun.findUnique({ where: { clientToken: options.clientToken } });
    if (prior) { return { ...prior sonucu... }; }        // yalnız TAMAMLANMIŞ koşumu görür
  }
  ```
- `:552-575` — koşum satırı **döngüden sonra**:
  ```ts
  const run = await prisma.importRun.create({ data: { id: runId, entity, ..., clientToken: options.clientToken ?? null, status, ... } });
  ```
- `:12-24` — tek tx bilinçli olarak yok; satır satır mevcut servisler çağrılıyor (her biri kendi tx'i + audit'i).
- **Koruma kontrolü:** kilit/bayrak yok · `importRun` satırı önceden `PENDING` olarak yazılmıyor · `import_runs.clientToken` **düz** unique (yalnız ikinci kaydı reddeder, yazımları değil).
- Adaptör tarafı: `order.adapter` **create-only, doğal anahtarsız** → mükerrer koruması yok.

**Çakışma senaryosu.**
`T1 POST /api/import/orders/apply` (token X, 10.000 satır) → `:447` `prior = null` → satır satır yazmaya başlar (dakikalar)
proxy/panel zaman aşımı → kullanıcı **Tekrar Dene**
`T2` aynı token X → `:447` `prior` **hâlâ null** (satır `:552`'de yazılacak) → ikinci tam koşum başlar
`T1` biter → `importRun.create` OK · `T2` biter → `importRun.create` → **P2002** (`clientToken` unique) → istemci **500** görür
**SONUÇ:** veriler iki kez yazılmış, kullanıcı hata görmüş, `import_runs`'ta tek satır var.

**failure_mode.** 10.000 satırlık bir sipariş dosyası yüklenir; koşum uzun sürdüğü için panel zaman aşımına düşer; kullanıcı yeniden dener. Sonuçta **her sipariş iki kez** açılır; kullanıcı ekranda 500 gördüğü için "hiçbir şey yazılmadı" sanır ve üçüncü kez dener.

**Veride fiili ihlal (K2).** **Arandı, 0** — `sql-saha.sh`: `SELECT count(*) FROM import_runs;` → **0**. Özellik sahada hiç kullanılmamış; `data:import` iznini taşıyan **1 kullanıcı** var. Bu ölçüm şiddeti S2'den **S3**'e indirdi.

**İş etkisi.** Bugün sıfır (özellik kullanılmıyor). İlk gerçek kullanımda, ilk büyük dosyada tetiklenmesi muhtemel ve sonucu mükerrer ana veri/sipariş — `nameFold` seddi olan tablolarda P2002 ile durur, olmayanlarda (sipariş) sessizce çoğalır.

**Öneri (2. tur için).**
1. `importRun` satırı koşumun **BAŞINDA** `status: RUNNING` ile yazılsın (id zaten önceden üretiliyor: `:475 runId`), sonunda `update` ile sonuçlansın. Token kapısı böylece uçuştaki koşumu da görür ve ikinci istek **409 "Bu yükleme hâlâ sürüyor"** alır.
2. Yarıda kesilen koşumun kaydı da böylece kalır (bugün hiç yok) — I-alanındaki "yarıda kesilen koşumun izi yok" tespiti aynı değişiklikle kapanır.
3. `onError=abort` yolunda satır yazılmadığı için `RUNNING` kaydının temizlenmesi gerekir (`:483-491` throw'undan önce `delete` ya da `status: FAILED`).
Migration **gerekmez** (`ImportRunStatus` enum'unda uygun bir değer yoksa migration gerekir → o durumda `[PROD'DA ÇALIŞTIRMA]` + geri alma `DROP`).

**Kabul kriteri.** `test_import_framework`'e sonda: uzun koşum sürerken aynı token ile ikinci istek → **409**, ikinci yazım yok. **Efor:** 0,5 gün.

**Önceki defter.** K9 H-2 "uçuşta çift koşum" tespiti **doğrulandı**; ② hipotezindeki `order.adapter` çift sipariş sonucu da teyit edildi.

---

### [KYY-2-14] `finalizeWarehouseCut`'un idempotency yorumu var olmayan bir mekanizmayı anlatıyor; paralel tekrar 409, sıralı tekrar başarı dönüyor

| Şiddet | **S3** | Kategori | B.3 / L | Öncelik | **P4** | Modül | Tambur / depo kesimi | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Fonksiyonun içinde iki uzun yorum, replay korumasının "tx içinde `clientToken` @unique → P2002 → catch'te idempotent yanıt" olduğunu söylüyor. Gövdede `clientToken` **hiç yok**; gerçek koruma tx ÖNCESİ bir statü kapısı. Yorum yalnız yanlış değil, **yanlış yönlendiriyor**: "doğru çözüm buraya `finalize`daki gibi tx-öncesi bir `clientToken` kapısı eklemektir" diyor — oysa tx-öncesi kapı zaten 30 satır yukarıda duruyor.

**Kanıt.**
- `Teks-Erp/src/services/tambur.service.ts:2374-2379` — **gerçek mekanizma (statü kapısı, tx dışı)**:
  ```ts
  if (parent.status === RollStatus.TAMBUR_CONSUMED) {
    return { success: true, data: { rollId: parent.id, remainingChild: null, remainingQty: 0 },
             message: "Top zaten kesim ile tamamlanmış (idempotent retry)." };
  }
  ```
- `:2451` ve `:2457` — **yorumun anlattığı, var olmayan mekanizma**:
  ```
  // tx'in İÇİNDE `clientToken @unique` → P2002 → rollback → catch'te idempotent yanıt.
  // ... doğru çözüm ... buraya `finalize`daki gibi tx-öncesi bir clientToken kapısı eklemektir
  ```
  `grep -n clientToken src/services/tambur.service.ts` → fonksiyon aralığında (2343-2660) **yalnız bu iki yorum satırı**; `finalizeWarehouseCutSchema` (`controllers/tambur.controller.ts:199-207`) de `clientToken` **almıyor**.
- Yan etki: `:2461-2467` barkod rezervasyonu **tx ÖNCESİ** → claim kaybedilirse numara yanar (yorumun kabul ettiği takas, doğru).
- **Koruma kontrolü:** claim `:2404-2410` `{id, status: parent.status, shipmentId: null, sackId: null}` ✓ (gözlenen statüye pin — doğru desen) · token yok · advisory yok.

**Çakışma senaryosu.**
`T1` ve `T2` aynı `finalize-warehouse-cut` isteği (tablet çift dokunuş / kuyruk paralel boşalması):
ikisi de `:2374` kapısını geçer (`status = WAREHOUSE`) → ikisi de `:2461` barkod rezerve eder (**iki numara**) → `T1 :2404` claim başarılı → `T2 :2404` `count===0` → **409 "Top bu sırada başka bir işlemle değişmiş"**.
Aynı çift dokunuş **sıralı** gelseydi `T2` `:2374` kapısından **`success: true` (idempotent retry)** alacaktı.
**SONUÇ:** aynı fiziksel olaya zamanlamaya göre iki farklı cevap; ayrıca bir barkod numarası yanar ve replay yanıtı `remainingChild: null, remainingQty: 0` döndüğü için **kalan parçanın barkodu istemciye hiç ulaşmaz**.

**failure_mode.** Tablet zayıf ağda kesim bitirme isteğini iki kez gönderir. Paralel ulaşırsa operatör "Top bu sırada başka bir işlemle değişmiş" hatası görür ve kesimin yapılmadığını sanar (yapılmıştır); sıralı ulaşırsa başarı görür ama kalan parçanın barkodunu göremediği için etiketi basamaz.

**Veride fiili ihlal (K2).** Aranmadı — imzası "aynı parent'tan iki child" olurdu ve claim bunu zaten engelliyor; yanan barkod numarası boşluğu bilinçli kabul edilmiş.

**İş etkisi.** Operasyonel kafa karışıklığı + yanlış yorum yüzünden gelecekteki bakımın yanlış yere müdahale etme riski (yorum "clientToken ekleyin" diyor; ekleyen kişi var olan statü kapısını fark etmeyip ikinci bir mekanizma kurar).

**Öneri (2. tur için).**
1. Yorumları gerçeğe uydur (`:2445-2460`): mekanizmanın **statü kapısı** olduğunu yaz, `clientToken` cümlelerini kaldır.
2. Paralel dalı sıralı dalla hizala: claim `count===0` olduğunda tx içinde topun statüsünü taze oku; `TAMBUR_CONSUMED` ise **409 yerine idempotent success** dön (`finalize` `:962-969`'daki `raceLost` deseninin birebir ikizi — doğru desen kardeş fonksiyonda zaten var).
3. Replay yanıtına kalan child'ı ekleyebilmek için `parentRollId`'den son çocuğu çözmek mümkün (`:2376` yorumunun "türetilemez" iddiası `parentRollId` ile aşılabilir) — isteğe bağlı.
Migration/izin/APK **YOK**.

**Kabul kriteri.** `test_tambur_*`'a sonda: paralel iki `finalizeWarehouseCut` → biri iş yapar, diğeri **idempotent success** (409 değil); yorum ↔ kod tutarlılığı gözle. **Efor:** 0,5 gün.

**Önceki defter.** K3b H-5 "`clientToken` YAZILMIYOR — yorum idempotency'yi ona dayandırıyor" tespiti: **yorum kısmı doğrulandı, "mekanizma yok" kısmı çürütüldü** (statü kapısı var).

---

### [KYY-2-15] İade ucunda `clientToken` yok — zaman aşımı sonrası tekrar 409 veriyor, operatör "kaydolmadı" sanıyor

| Şiddet | **S3** | Kategori | B.3 | Öncelik | **P4** | Modül | İade | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `createReturn` tam korumalı bir yazma yolu (8023 kilidi tx'in ilk ifadesi + top başına atomik claim) ama **idempotency anahtarı taşımıyor**. Mobil "İade" ekranında zaman aşımı olursa ikinci istek claim'de `status = SHIPPED` bulamaz ve 409 döner; kayıt aslında oluşmuştur.

**Kanıt.**
- `Teks-Erp/src/routes/*` → `createReturnSchema` `return.service`/controller tarafında `clientToken` alanı **yok** (`grep -n clientToken src/services/return.service.ts` → 0 vuruş).
- `Teks-Erp/src/services/return.service.ts:498-517` — ikinci isteğin düşeceği yer:
  ```ts
  const flip = await tx.roll.updateMany({ where: { id: r.id, status: RollStatus.SHIPPED }, data: { status: appliedStatus, shipmentId: null, sackId: null, ... } });
  if (flip.count === 0) throw AppError.conflict("Bu top zaten iade alınmış veya durumu değişmiş.");
  ```
- `prisma/schema.prisma` — `roll_returns` tablosunda `clientToken` **yok** (Roll/Order/WorkOrder/SubcontractorReceipt/SwatchStockReduction'da var).
- **Koruma kontrolü:** mükerrer defter satırı **oluşamıyor** (claim doğru) — eksik olan **istemciye doğru cevap**.

**Çakışma senaryosu.** (Yarış değil, retry sözleşmesi.)
`t0` tablet `POST /api/returns` gönderir → sunucu iadeyi yazar, belgeyi dondurur → **yanıt yolda kaybolur** (timeout)
`t1` mobil kuyruk aynı yükü tekrar gönderir (sonucu belirsiz hata → token yapışması gerekirdi, token yok)
`t2` `:501` claim → top artık `SHIPPED` değil → **409 "Bu top zaten iade alınmış veya durumu değişmiş."**
**SONUÇ:** iade kaydı VAR, operatör hata görüyor.

**failure_mode.** Operatör iade ekranında 409 görür, iadenin kaydolmadığını düşünür ve topu tekrar arar / büroyu arar. Mesaj "zaten iade alınmış" dediği için tahmin edilebilir, ama akış "başarısız" olarak biter ve kuyruk kalıcı düşüş toast'ı basar.

**Veride fiili ihlal (K2).** **Arandı, temiz.** `sql-saha.sh`: `SELECT count(*) AS iade, count(DISTINCT "rollId") FROM roll_returns WHERE "cancelledAt" IS NULL;` → **5 | 5** → mükerrer iade yok (claim çalışıyor ✓).

**İş etkisi.** Operasyonel gürültü; veri doğru. Hacim bugün çok düşük (5 iade).

**Öneri (2. tur için).** `RollReturn`'e `clientToken String? @unique @db.Uuid` (migration) + `createReturn`'de replay dalı: token'lı kayıt varsa mevcut iadeyi **200 ile** dön; iptal edilmişse **409 `RETURN_CANCELLED`** (4. durum kapısı, KYY-2-07/08 ile aynı sözleşme). `[PROD'DA ÇALIŞTIRMA]` — migration; geri alma `DROP COLUMN` (nullable olduğu için güvenli). Alternatif (migrationsız): grup lideri + top kümesi + müşteri üçlüsünden türetilmiş bir doğal anahtarla son 90 sn içinde eşleşen iade varsa onu dön — daha kırılgan, tercih edilmez.

**Kabul kriteri.** `test_return_bulk_group`'a sonda: aynı token ile iki istek → tek `RollReturn` grubu, ikinci istek 200. **Efor:** 0,75 gün (migration dahil).

**Önceki defter.** K1b H18 "istemci başarısız sanır" tespiti doğrulandı. **Ek çürütme:** K12 H1'in "doğrudan-sevk / `shipmentId`'siz iade kilitsiz" hipotezi **geçersiz** — `:394-396` guard'ı `shipmentId` NULL topu 400 ile reddediyor, yani kilitsiz yol yok (bunun kendisi ayrı bir işlevsel boşluk: fasondan doğrudan sevk edilen mal hiç iade alınamıyor → E-alanına yönlendirildi).

---

### [KYY-2-16] Sebep kataloğu boot uzlaştırması audit yazmıyor ve `skipDuplicates` kullanmıyor — kardeş iki job'la ayrışıyor

| Şiddet | **S3** | Kategori | I / A.5 | Öncelik | **P4** | Modül | Boot job'ları | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Boot uzlaştırma zincirinin üç halkasından ikisi (izin, rol) audit yazıyor; üçüncüsü (sebep kataloğu) `prisma.reasonPreset.create`'i doğrudan çağırıp `ReasonPresetService`'i atlıyor → **"her CUD → audit" konvansiyonu bu yolda uygulanmıyor**. Ayrıca izin job'unun kullandığı `createMany skipDuplicates` güvenliği burada yok.

**Kanıt.**
- `Teks-Erp/src/jobs/reason-preset-catalog.job.ts:56-70` — doğrudan `create`, audit yok:
  ```ts
  await prisma.reasonPreset.create({ data: { kind: kind as ReasonPresetKind, code: seed.code, label: seed.label, ..., isSystem: true } });
  ```
- Kardeşler: `permission-catalog.job.ts:94` `createMany({ ..., skipDuplicates: true })` + audit ✓ · `role-template-catalog.job.ts` havuz + audit ✓.
- `:40-42` — `have` kümesi döngüden **önce** bir kez okunuyor; `:48` `nextOrder` de o anlık görüntüden.
- **Koruma kontrolü:** `reason_presets (kind, code)` unique ✓ (son savunma var) · `started` bayrağı process-local (tek process invariantı belgeli) · audit YOK.

**Çakışma senaryosu.** (Tek process'te ulaşılmaz; invariant kırılırsa.)
`instances: 2` yapılırsa iki process aynı anda uzlaştırır → izin job'u `skipDuplicates` ile geçer, **sebep job'u** `create`'te P2002 alır → `runReasonPresetReconciliation`'ın try/catch'i sunucuyu düşürmez ama **o kind'dan sonraki tüm katalog satırları atlanır** → fabrikanın yeni sebep seçenekleri sessizce gelmez.

**failure_mode (bugün de doğru olan).** Yeni bir sistem sebebi (`ReasonPreset`) deploy ile DB'ye gelir; `system_logs`'ta hiçbir iz yoktur. Fabrika "bu sebep listeye ne zaman ve kim tarafından eklendi" sorusunu soramaz; sebep kodları rapor anahtarı olduğu için (kod ASLA değişmez kuralı) bu izin olmaması ileride kod-etiket arkeolojisini imkânsızlaştırır.

**Veride fiili ihlal (K2).** Aranmadı — "audit satırının yokluğu" doğrudan sorgulanabilir (`system_logs` içinde `tableName='REASON_PRESET'` satırı olup olmadığı) ama bu turda ölçülmedi; D-I'ye not.

**İş etkisi.** İzlenebilirlik boşluğu; tek process'te veri riski yok.

**Öneri (2. tur için).** `reconcileReasonPresets` `createMany({ data: [...], skipDuplicates: true })` kullansın (sıra hesabı için `sortOrder` önceden hesaplanabiliyor) ve sonunda tek bir `AuditService.logEvent({ category:"SYSTEM", action:"REASON_PRESET_RECONCILED", payload:{ created } })` yazsın — izin job'unun deseniyle aynı. Migration/izin **YOK**.

**Kabul kriteri.** `test_reason_presets`'e sonda: uzlaştırma yeni satır ekleyince `system_logs`'ta bir SYSTEM olayı doğar; ikinci koşum idempotent (0 yeni satır, 0 hata). **Efor:** 0,25 gün.

**Önceki defter.** K4 H7 "havuz — audit YOK, `ReasonPresetService.create` atlanır" tespiti **doğrulandı**.

---

### [KYY-2-17] `dispatchShipment` boş-sevkiyat ve EXPORT-tartı guard'ları tx içinde tekrarlanmıyor — çuval çıkarma ile yarışta boş sevkiyat sevk edilebiliyor (bayrak gerektirir)

| Şiddet | **S3** | Kategori | A.1 / E | Öncelik | **P4** | Modül | Sevkiyat | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `performDispatchTx` içinde hayalet-top guard'ı doğru şekilde **kilit altında tazeleniyor** (yorum bunun neden gerekli olduğunu ayrıntılı anlatıyor), ama aynı ihtiyaç iki kardeş guard için karşılanmamış: "boş sevkiyat sevk edilemez" ve "EXPORT'ta tüm çuvallar tartılı" kontrolleri yalnız tx ÖNCESİ. Aradaki pencerede `removeSackFromShipment` çuvalları çıkarabilir.

**Kanıt.**
- `Teks-Erp/src/services/shipping.service.ts:1895-1903` — guard'lar tx dışı:
  ```ts
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { ..., sacks: { select: { weightKg: true } } } });
  if (shipment.sacks.length === 0) throw AppError.badRequest("Boş sevkiyat sevk edilemez");
  this.assertExportWeighed(shipment.sacks, shipment.destination);
  const shippedRolls = await prisma.$transaction((tx) => this.performDispatchTx(tx, shipmentId, data, userId));
  ```
- `:1806-1885` — `performDispatchTx` içinde **yalnız hayalet guard'ı** tazeleniyor (`:1834-1852`); çuval sayısı/tartı kontrolü **yok**.
- `:1745-1783` — `removeSackFromShipment`, `touchShipmentPlannedTx` altında çuvalı çıkarıyor (PLANNED olduğu sürece meşru).
- **Koruma kontrolü:** `performDispatchTx` claim'i `{id, status: PLANNED}` — statüyü pinliyor ama **çuval kümesini pinlemiyor** · DB'de `DISPATCHED ⇒ ∃ çuval` seddi YOK (INV-SEV-13 yalnız kod).

**Çakışma senaryosu.**
`T1 dispatchShipment(S)` → `:1896` `sacks = [A]` okur → boş değil, tartılı → **await = yield**
`T2 removeSackFromShipment(S, A)` → `:1751 touchShipmentPlannedTx` (S hâlâ PLANNED ✓) → çuval A serbest → **COMMIT**
`T1 :1904` tx → `performDispatchTx` `:1811` claim `{id, PLANNED}` → **başarılı** → `:1833` hayalet sorgusu 0 satır → `:1857` `groupBy` 0 satır → `flipped = 0` → `:1884` **`freezeForSource(SHIPMENT_DISPATCH)`** → **COMMIT**
**SONUÇ:** `status = DISPATCHED`, 0 çuval, 0 top, ve **içeriği boş bir sevk irsaliyesi v1 dondurulmuş**.

**failure_mode.** Sevk Kapısı açıkken (bayrak) iki kullanıcı: biri "Sevk Et"e basarken diğeri son çuvalı sevkiyattan çıkarır. Sonuçta sevk edilmiş görünen ama içi boş bir sevkiyat ve ona ait resmî bir irsaliye kaydı doğar; storno da bu sevkiyatı geri alamaz (geri alacak top yok, ama `undoDispatch` yine de PLANNED'a çeker ve belgeyi VOIDED yapar → kâğıt üzerinde iptal edilmiş boş irsaliye).

**Veride fiili ihlal (K2).** **Arandı, 0.** `sql-saha.sh`: `SELECT count(*) FROM shipments s WHERE s.status='DISPATCHED' AND NOT EXISTS (SELECT 1 FROM sacks k WHERE k."shipmentId"=s.id);` → **0**.
**Erişilebilirlik notu:** `shipping.confirmationEnabled` **dev ve saha kopyasında `false`** → `createShipment` aynı tx'te dispatch ediyor, yani PLANNED penceresi sahada bugün **hiç açılmıyor**. Bu çizelge **bayrağın açılmasını gerektirir**. (Bayrağı denetim sırasında DEĞİŞTİRMEDİM.)

**İş etkisi.** Bugün ulaşılamaz; Sevk Kapısı rejimi açıldığı gün ulaşılabilir hale gelir ve sonucu hukuken bağlayıcı bir boş belgedir.

**Öneri (2. tur için).** `performDispatchTx` içinde, claim'den SONRA ve flip'ten ÖNCE (hayalet guard'ının hemen yanında) iki satır:
```ts
const sacks = await tx.sack.findMany({ where: { shipmentId }, select: { weightKg: true } });
if (sacks.length === 0) throw AppError.badRequest("Boş sevkiyat sevk edilemez — çuvallar bu sırada çıkarılmış.");
this.assertExportWeighed(sacks, <destination tx'ten>);
```
Hayalet guard'ının yorumu (`:1826-1832`) bu yaklaşımın gerekçesini zaten yazıyor — aynı mantığın iki kardeş kontrole uygulanması. Sed (opsiyonel, `[PROD'DA ÇALIŞTIRMA]`): `DISPATCHED ⇒ ∃ çuval` bir CHECK ile ifade edilemez (tablolar arası) → trigger gerekir, **önerilmez**; kod yeterli. Migration/izin/APK **YOK**.

**Kabul kriteri.** Sonda: `dispatchShipment` ile `removeSackFromShipment` paralel koşturulunca `DISPATCHED ∧ 0 çuval` **hiç oluşmaz**; `test_sack_pool_lifecycle` H/I bölümlerine eklenir (bayrak açık kolunda). **Efor:** 0,5 gün.

**Önceki defter.** ② hipotez listesinde yoktu; K10 INV-SEV-12/13 satırı "pre-tx kontrol, claim sonrası tekrar yok" diye **not düşmüş** — bu bulgu onun çizelgeye dökülmüş hali.

---

# 3. "(7) HAYIR" cevaplarının özeti (bulgu olmayanlar — neden)

| Yol | Sınanan çizelge | Neden bozulmadı |
|---|---|---|
| KYY-02 | 2 ve 5 eşzamanlı `createShipment`, aynı sipariş satırı | `nextShipmentNo(tx)` tx İÇİNDE → aynı numara → `shipmentNo` unique P2002 → `withBarcodeRetry` tüm tx'i yeniden koşuyor → tx'ler **fiilen serileşiyor**. **K3 ile ölçüldü** (5 çağrı, numaralar `…0015..0019` kesintisiz). ⚠️ Koruma **belgesiz ve kırılgan**: numara üretimi tx dışına alınırsa (barkod helper'ında verilen kararın aynısı) çift tahsis anında açılır → 2. tura "regresyon bekçisi yaz" notu. |
| KYY-05 | İki eşzamanlı `createReturn`, aynı top / aynı sevkiyat | 8023 advisory kilidi tx'in **İLK** ifadesi (`:490`) + top başına `{id, SHIPPED}` claim; grup tamamı rollback. |
| KYY-08 | `splitSack` "en az bir top kalsın" ‖ `scanIntoSack` (kaynak kilitsiz) | Top claim'i `{id, sackId: from, shipmentId: null}` atomik → içerik kaybı/çift sayım yok; kaçan tek sonuç boş kaynak çuval (veri bozulmuyor) → S4 not. |
| KYY-08 | `removeSack(withContents=false)` ‖ içerik ekleme | Kilit altında **taze sayım** (`:1013-1014`) + hedef çuvalı `touchWarehouseSackTx` zorunlu kılıyor. |
| KYY-11 | `closeRemainder` ‖ kısmi kabul / sevk / WO iptali | `touchWorkOrderTx` **İLK ifade** (`:3401`) + kilit altında taze statü+adım okuması; `currentStepId`'yi değiştiren tüm yollar aynı WO kilidini alıyor. |
| KYY-14 | İki eşzamanlı `finalize`, aynı top | WO kilidi → `freshWo` iptal guard'ı → claim `{id, IN_PRODUCTION, currentStepId}` → `raceLost` idempotent dalı; ayrıca `freshQtyRow` bayat metrajı 409'luyor. **Projenin en olgun check-then-act kapatması.** |
| KYY-20 | İki eşzamanlı `create` (IE numarası) | `workOrderNumber` unique + `withBarcodeRetry` (5 deneme); numara yarışı meşru desenle kapalı (bulgu **havuz** tarafında, KYY-2-06). |
| KYY-29 | İki eşzamanlı `quickOrderFromRolls`, aynı toplar | Çoklu claim `{id in, STOCK, shipmentId:null, currentStepId:null}` + `count!==len → 409` + kaçan barkodlar mesajda (F143 claim-first kararı doğru). |
| KYY-41 | İki cihaz aynı makineye `confirmTakeover` | **DB partial unique** (`work_sessions_active_machine_uq`/`_device_uq`) claim işini görüyor; P2002 → 409 `SESSION_RACE`; bekçi bu dalı fiilen tetikliyor. Beceri §3.2'nin "DB seddi son savunma" doğru örneği. |
| KYY-44 | Boot zincirinin çift koşumu | `started` bayrağı + tek process invariantı (belgeli) + `@unique`; izin job'unda ayrıca `skipDuplicates`. |
| KYY-47 | İki eşzamanlı `startCopyJob` | Bellek claim'i (`currentJob`) **senkron blokta** alınıyor (`:373-400` arasında hiç `await` yok) → tek thread'de iki istek geçemez. Yorum gerekçeyi doğru yazmış. |
| KYY-50 | İki eşzamanlı `setShipmentInvoice` | `updateMany {id, status: DISPATCHED}` atomik claim; ikinci yazım son yazan kazanır (aynı alan → beklenen davranış). Bulgu **storno ile** çapraz yarışta (KYY-2-05). |

---

# 4. Uygulanan kontrol listesi

> Kaynak: `Teks-Erp/teks-erp-denetim-promptu-v2.md` **Bölüm 4 (ZORUNLU)** — 8 soru × 17 yol.
> Bölüm 3 harf alanları benim alanım değil; yalnız kesiştiği yerlerde uygulandı ve kesişmeyenler kapsam dışı yazıldı.

| Madde | Durum |
|---|---|
| Bölüm 4 · yol seçimi (NN mod 3 == 2, 17 yol) | **uygulandı** — 17/17 yol tablolandı |
| Bölüm 4 · Soru 1 (korunan değişmez, K10 id'leriyle) | **uygulandı** — 17/17; N/A olanlar ("bu yolda rezerv yok" gibi) açıkça yazıldı |
| Bölüm 4 · Soru 2 (tek `$transaction` mi, sınır nerede — `dosya:satır`) | **uygulandı** — 17/17; tx-öncesi/dışı/sonrası adımlar ayrı ayrı |
| Bölüm 4 · Soru 3 (okuma↔yazma arası karar / check-then-act) | **uygulandı** — 17/17 |
| Bölüm 4 · Soru 4 (satır kilidi / guard'lı `updateMany`+count / advisory — İLK ifade mi) | **uygulandı** — advisory kullanan iki yolda (KYY-05, KYY-50 karşı tarafı) **iki satır numarası** verildi (beceri §4.2 zorunluluğu) |
| Bölüm 4 · Soru 5 (küme/aralık kararı — write skew) | **uygulandı** — 17/17; phantom'a açık kümeler adlandırıldı |
| Bölüm 4 · Soru 6 (DB kısıtı son savunma olarak var mı — K2b) | **uygulandı** — 17/17; "YOK" denen her yerde şema/migration envanteri kontrol edildi |
| Bölüm 4 · Soru 7 (iki eşzamanlı aktörle çizelge; EVET → bulgu + repro) | **uygulandı** — 17/17; EVET olan 17 bulgu, HAYIR olanlar §3 tablosunda gerekçeli |
| Bölüm 4 · Soru 8 (fabrikadaki gerçek etki) | **uygulandı** — 17/17 |
| Bölüm 4 · ZORUNLU repro: **KYY-02 çift tahsis** | **uygulandı** — `audit_repro_KYY-2-02.ts`, **negatif sonuç** (çürütüldü) ve mekanizması yazıldı |
| Bölüm 4 · ZORUNLU repro: **KYY-26 sipariş bağla** | **uygulandı** — `audit_repro_KYY-2-26.ts`, **10/10 doğrulandı** |
| Bölüm 4 · ek repro (en güçlü 2-3 aday) | **uygulandı** — `audit_repro_KYY-2-08.ts` (36/80 deadlock), `audit_repro_KYY-2-32.ts` (11/11, sıralı dahil) |
| Bölüm 4 · "② endişe hipotezi doğrula/çürüt" | **uygulandı** — 17/17 yolda hipotez satırı karara bağlandı (5 çürütme, 3 kısmi, gerisi doğrulama) |
| Bölüm 4 · Node yield noktalarını göster | **uygulandı** — her çizelgede `await = yield` işaretlendi |
| Beceri §9 yanlış pozitif kataloğu | **uygulandı, satır yazmadan önce okundu** — §9.1 (guard altı kaynak) KYY-41/KYY-20'de, §9.7 (tek process) KYY-44/47'de, §9.9 (`updateMany` count) KYY-08'de sınıflandırma yapıldı, §9.11 (`isolationLevel` üçlü koşul) her yolda uygulandı |
| K12 uzlaştırması (reddedilmiş bulguyu yeniden açma yasağı) | **uygulandı** — K12 H1 (iade kilidi) **yeni kanıtla ÇÜRÜTÜLDÜ**, yeniden açılmadı; F-OPS-VER-008 / F-CORE-VER-008 gibi kapanmış kayıtlar referansla anıldı |
| Bölüm 3.A (eşzamanlılık) kesişimi | **uygulandı** (kendi merceğimin çekirdeği) |
| Bölüm 3.B (idempotency 4. durum) kesişimi | **uygulandı** — KYY-2-07, -08, -13, -15 |
| Bölüm 3.C/F/G/H/J/K/L | **kapsam dışı — sebep:** ayrı alan denetçilerine ait; kesişen gözlemler §6 Sınır Ötesi Notlar'a yazıldı (bağımsızlık kuralı gereği o denetçilerin çıktıları okunmadı) |
| Bölüm 3.E (iş kuralı değişmezleri) | **kısmen** — yalnız 17 yolun dokunduğu değişmezler; K10'un tamamı D-E'nin işi |
| Bölüm 3.I (gözlemlenebilirlik) | **kısmen** — P2039→500 eşlemesi (KYY-2-03) ve audit boşluğu (KYY-2-16) kendi yollarımda çıktığı için alındı |

---

# 5. Doğru yapılanlar (korunması gereken kalıplar)

1. **`lockShipmentScopeTx` — kilit sırasının gerekçesi kodun içinde yazılı ve DOĞRU yerde.** `shipment-locks.helper.ts:44-54` yalnız "kilit var" demiyor; kilidin **korunan okumadan önce** alınmak zorunda olduğunu, ters sıranın neden hiçbir şey kazandırmadığını ve bunun **üretilmiş bir vaka** olduğunu (2026-08-09: 1200 ms gecikmeyle tetiklendi) yazıyor. `return.service.ts:490` ve `shipping.service.ts:2160` ikisinde de kilit **tx'in ilk ifadesi**. Beceri §4.2'nin istediği tam budur. **Kırmayın:** yeni bir sevkiyat-kapsamlı akış eklenirse aynı kilidi aynı yere koyun.

2. **`tambur.finalize`'ın çok katmanlı check-then-act kapatması.** `tambur.service.ts:931-988` sırayla: WO satır kilidi (İLK) → **kilit altında taze WO statüsü** (`freshWo`, iptal guard'ının tx-içi ikizi) → claim `{id, IN_PRODUCTION, currentStepId}` → **kilit altında taze metraj** (`freshQtyRow`, bayat toplamı 409'layan guard) → `count===0`'ın iki dala ayrılması (idempotent `raceLost` ↔ gerçek çakışma 409). Bu, denetimde gördüğüm en olgun yazma yolu; **yeni akışlar bunu şablon almalı** (özellikle KYY-2-01 ve KYY-2-14'ün düzeltmeleri).

3. **`work-session`'da DB partial unique'in claim olarak kullanılması.** `work_sessions_active_machine_uq` / `_device_uq` (migration `20260702121000`) "henüz olmayan satır"ı korumanın doğru aracı; occupant ön-kontrolü bilinçli olarak yalnız UX, otorite DB'de ve yorum (`:212-214`) bunu açıkça söylüyor. Bekçi `test_work_session` P2002 dalını **fiilen tetikliyor** (varlığını değil davranışını ölçüyor).

4. **`removeSack` / `splitSack`'te "kilit altında taze sayım" refleksi.** `shipping.service.ts:1011-1017` ve `:833-841` tx dışı `_count`'u yalnız mesaj için kullanıp kararı kilit altında yeniden ölçüyor; yorumlar "bayat `_count` tuzağı (removeSack ile aynı ders)" diye **dersin taşındığını** kaydediyor. Aynı refleks KYY-2-01'de (metraj) ve KYY-2-02'de (bağ sayısı) uygulanmadığı için bulgu doğdu — yani kalıp doğru, yayılımı eksik.

5. **`db-copy.service.startCopyJob`'un senkron claim'i.** `:373-400` arasında hiç `await` yok ve yorum bunu gerekçesiyle yazıyor ("buraya kadar hiç await yok … tek thread'de iki istek bu satırı aynı anda geçemez"). Node'un eşzamanlılık modelini doğru kullanan, nadir görülen bir kalıp.

6. **`quickOrderFromRolls`'un "claim-first" kararı (F143).** `order.service.ts:2137-2168`: `create()`'in fırlatabileceği TÜM doğrulamalar claim'den ÖNCE koşuyor, sonra toplar atomik claim'leniyor ve kaçanların **barkodları kullanıcıya söyleniyor**. Parçalı sonucu sessiz bırakmayan doğru örnek.

7. **`error.middleware`'in "sınıflandırılmamış Prisma kodu" dalı.** `:560-585` bilinmeyen kodu 500'e düşürüp **`unclassified: true` ile audit yazıyor ve konsola "kodu iki kümeden birine ekleyin" diyor**. Fail-closed varsayılan + görünür uyarı; KYY-2-03 bu uyarının ilk gerçek müşterisi oldu.

---

# 6. Sınır ötesi notlar

| Hedef alan | Gözlem (`dosya:satır`) | Not |
|---|---|---|
| **D-I (hata/gözlemlenebilirlik)** | `middlewares/error.middleware.ts:150-165`, `:517`, `:560-585` | **PostgreSQL deadlock'ı bu kurulumda `P2039` geliyor** (repro ile ölçüldü, `audit/repro/KYY-2-08.log`), `P2034` değil → eşzamanlılık için yazılmış 409 dalı **driver-adapter yolunda ölü**. Sistem genelinde her deadlock 500 + SYSTEM/ERROR audit üretiyor. Saha kopyasında `system_logs` içinde `action='ERROR' AND recordId='P2039'` taraması yapılması önerilir. |
| **D-I** | `label.service.ts:2094` (`seedRollLabelSnapshot` hatası → `{success:true, seeded:false}` + `console.error`) · `workorder.service.ts:1366` (`quickStart` telafi `hardDelete` hatası yalnız `console.error`) | İki yerde kalıcı yazım hatası yalnız konsola düşüyor; `reportJobFailure`/audit yolu kullanılmıyor. |
| **D-I** | `jobs/reason-preset-catalog.job.ts:57` | Boot uzlaştırmasının üçüncü halkası audit yazmıyor (KYY-2-16). `system_logs`'ta `tableName='REASON_PRESET'` satırı var mı — ölçülmedi. |
| **D-E (iş kuralı)** | `return.service.ts:394-396` | **Fasondan doğrudan sevk edilen mal (`DirectShipment`) hiç iade alınamıyor:** `createReturn` `shipmentId` NULL topu 400 ile reddediyor. İşlevsel boşluk (yarış değil); K12 H1'in varsaydığı "kilitsiz iade yolu" bu yüzden yok. |
| **D-E** | `tambur.service.ts:2218-2246` | `cutWarehouseRoll` parent'ın `initialQty`'sini de düşürüyor ("her kesim sonrası reset"). Bu bilinçli bir karar ama **`initialQty`'nin anlamını yolun ortasında değiştiriyor**: "başlangıç metrajı" artık "son kesimden sonraki metraj". Detay panelindeki "Başlangıç: N m" ve aşım/sapma taban çizgisi bu yolda yanlış okunuyor; KYY-2-01'in kökü de bu. |
| **D-C (veri modeli)** | `subcontractor.service.ts:3444` (`remainderClosedAt`) | Kolon sonradan yazılıyor ama `updatedAt` tazelenmiyor (K2a H14) → CLAUDE.md'nin "Ham Stok dışındaki sekmeler `updatedAt desc`" kuralı gereği kapatılan kalem listenin dibinde kalır. |
| **D-C** | `shipments.invoiceNo` / `invoicedAt` | `invoiceNo ≠ NULL ⇒ status = DISPATCHED` (INV-SEV-14) için **CHECK yok**; KYY-2-05'in DB tarafı. |
| **D-C** | `roll_returns` | `clientToken` kolonu yok — idempotency katmanının kapsamadığı tek yazma-yaratan uç (Roll/Order/WorkOrder/SubcontractorReceipt/SwatchStockReduction'da var). |
| **D-G (güvenlik)** | `inventory.service.ts:3736-3762` ↔ `:3932` | Yetki kapsamı bayat statüden çözülüp claim statüyü pinlemediği için **`roll:manual-adjust` kapısı yarışla atlanabiliyor** (KYY-2-01b). SoD açısından incelenmesi önerilir. |
| **D-G** | `db-copy.service.ts:798` `reverifyCopy` | Yol parametresi allowlist'ten geçmiyor (K9 H-3 teyit edildi); benim merceğim dışı, G'ye devredildi. |
| **D-H (performans)** | `workorder.service.ts:989` + `:395` | Tx AÇIKKEN iki havuz çağrısı → havuz doygunluğunda kendi kendini bekleten tx (KYY-2-06). H tarafında "havuz metrikleri + `classifyPoolTimeout` 503 oranı" ile birlikte değerlendirilmeli. |
| **D-K (test)** | — | Bu turda kurulan 4 repro script'i (`audit_repro_KYY-2-02/08/26/32.ts`) doğrudan **eşzamanlılık bekçisine** dönüştürülebilir; üçü bugün KIRMIZI veriyor (negatif sonda ihtiyacı yok, hatanın kendisi kanıtlı). `run-all-tests.ts` kapsamına alınmadan önce dev DB temizliği prefix bazlı olduğu için güvenli. |
| **D-K** | `test_consistency_derived §21` | KYY-2-02'nin ürettiği drift'i **yakalayan** kontrol; K12'nin "mutabakat kapısı canlıya karşı koşulur" dersiyle birlikte, düzeltme sonrası canlıda koşulması önerilir. |
| **D-L (kod kalitesi)** | `tambur.service.ts:2445-2460` | Yorum var olmayan bir `clientToken` mekanizmasını anlatıyor ve yanlış düzeltme öneriyor (KYY-2-14). Bayat yorum sınıfı. |
| **D-L** | `workorder-clone.helper.ts:31` | `generateWorkOrderNumberTx` yazılmış, `workorder.service.create` kullanmıyor — ölü olmayan ama **bağlanmamış** doğru ikiz. |
| **D-A (eşzamanlılık, diğer grup)** | `tambur-manual.service.ts:1191` | `touchWorkOrderTx`in 30 çağrı yerindeki **tek sıra istisnası** (KYY-2-10); D-A'nın ABBA haritasına eklenmeli. |
| **D-B (mükerrer/idempotency)** | `shipping.service.ts:1361-1374`, `order.service.ts:2026-2050` | İki replay yolu da 4. durumu (iptal edilmiş kayıt) kapatmıyor; **WO yolu kapatıyor** → üç kardeşin sözleşmesi ayrışmış. Saha: 4 iptal sipariş token taşıyor. |

---

# 7. KAPSANMAYAN / ERİŞİLEMEYEN

| Konu | Sebep |
|---|---|
| **KYY-01, 03, 04, 06, 07, 09, 10, 12, 13, 15, 16, 18, 19, 21, 22, 24, 25, 27, 28, 30, 31, 33, 34, 36, 37, 39, 40, 42, 43, 45, 46, 48, 49, 51** | Görev tanımı gereği başka gruplara ait (NN mod 3 ≠ 2). Bu yollara yalnız kendi yollarım kesiştiğinde (ör. KYY-02 ↔ KYY-03 dispatch, KYY-23 ↔ KYY-14 finalize) ve **kesişen çizelgeyi kurmak için gereken kadar** bakıldı. |
| KYY-14 · `RollProperty` replace CHOICE değerlerini siliyor mu (`tambur.service.ts:1208`) | Okunmadı — ② hipotezindeki soru veri modeli/iş kuralı sorusudur ve `applyManualProperties`'teki FLAG-evreni kararının finalize'daki ikizinin doğrulanması D-C/D-E'nin kapsamı. **Kapsam dışı — sebep: alan sınırı.** |
| KYY-17 · `createManualRoll` ABBA'sının K3 repro'su | Denenmedi: WO + rota adımı + çalışma oturumu + cihaz fixture'ı gerekiyor (>2 dk bütçe) ve **aynı sınıf KYY-2-03'te ölçüldü**. Bulgu K1 olarak yazıldı, S3'ü aşmadı. |
| KYY-23 · tx-öncesi yazımın K3 repro'su | Denenmedi: fason sevk + kabul + WO iptali zinciri fixture'ı ve `rollVariance` temizliği gerektiriyor; çizelge kod okumasıyla kesin kurulabildiği için K1'de bırakıldı (S2'yi aşmıyor). |
| KYY-38 · gövde limiti / paralel `apply` ölçümü | HTTP katmanı gerektiriyor (izole Express sondası); K9 §0.2 zaten ölçmüş ve **F-alanına** ait. Benim tarafımdan yalnız idempotency zamanlaması incelendi. |
| KYY-47 · gerçek `pg_dump`/`pg_restore`/`DROP DATABASE` yolu | **Bilinçli çalıştırılmadı** — repro sözleşmesi "dış dünyaya giden yolları çağırma" diyor; `test_db_copy` de zaten `TEST_DB_COPY=1` kapılı. JSON lost-update kod okumasıyla kuruldu. |
| KYY-41 · `getStampContext` enforce'suz 9 uç ve cihaz kimliği | G/K5 alanına ait (yetki yüzeyi); yalnız `STATION_KIND_PERM` fail-open'ı kendi merceğimde kaldığı için alındı. |
| Canlı production DB | Erişim yok (brief kuralı 2). Tüm K2 ölçümleri **2026-08-25 saha kopyası** (`tekserp_saha_0825`, 190/195 migration) ve dev üzerinde. Son 5 migration'ın kolonları saha kopyasında YOK → o alanlara dayanan sorgular kurulmadı. |
| `system_logs` üzerinden geçmiş ihlal arkeolojisi (KYY-2-01b, -04, -09, -16) | Ölçülmedi: audit 6 ayda arşivleniyor ve eşleştirme sorguları (LABEL_PRINT_EVENT ↔ ROLL_MANUAL_OVERRIDE zaman farkı gibi) `statement_timeout=120 sn` altında ağır. D-I'ye yönlendirildi. |
| `shipping.confirmationEnabled` AÇIK rejimindeki davranışlar (KYY-2-17 ve KYY-02'nin PLANNED kolu) | **Bayrak DEĞİŞTİRİLMEDİ** (brief kuralı). Bulgular "flag gerektirir" notuyla yazıldı; ölçüm 2. turda bayrak açık bir sonda ortamında yapılmalı. |
| Electron / mobil istemci tarafı | Denetim kapsamı backend (`Teks-Erp/src`). İstemci sözleşmesine değinilen yerler (`entryAttempt.ts` token yapışması, `importService.ts` parçalama) yalnız **referans** olarak anıldı, kod okunmadı. |
