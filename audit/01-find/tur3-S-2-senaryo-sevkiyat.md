# TUR 3 · S-2 — SENARYO: SEVKİYAT (paralel sevk · storno + iade · çuval okutma çakışması)

> Denetçi: **S-2** · Mercek: **senaryo merkezli** (uçtan uca akış + 8 soru + çizelge + repro)
> Kapsam: `shipping.service.ts` (3.698 satır) · `return.service.ts` · `helpers/allocation.helper.ts` ·
> `helpers/shipment-locks.helper.ts` · `helpers/order-status.helper.ts` · `helpers/order-line-scope.helper.ts` ·
> `order.service.ts` (iptal yolları) · `Electron/src/pages/Operations/{SackContentEdit,Shipments,SackStore}` ·
> `mobil/src/screens/Modules/TartiPaket` + `mobil/src/services/packing.service.ts`
> HEAD: `adnansahin` · Bu turda **hiçbir üretim dosyası değiştirilmedi**; yalnız iki yeni repro script'i yazıldı.

---

## 0. SENARYONUN ÖN KOŞULLARI — sahadaki gerçek rejim

Tur 2'nin PROD AYARLARI TABLOSU (`audit/01-find/tur2-V-4-veri-anaveri-audit.md §0`) bu turun **tamamını**
belirliyor. Aşağıdaki üç satır olmadan senaryoların yarısı yanlış kurulur:

| Ayar | Sahadaki değer | Senaryoya etkisi |
|---|---|---|
| `shipping.confirmationEnabled` | **false** (DB, 07-16) | **PLANNED ara adımı YOK.** `createShipment` tek transaction'da `performDispatchTx`i çağırır (`shipping.service.ts:1426-1428`) → çuval seçimi ile mal çıkışı aynı anda olur. "Sevk Kapısı" karosu hiç çizilmez (`Electron/src/pages/Operations/tile-config.ts:139`). |
| `shipping.undoDispatchSameDayOnly` | **false** (satır yok) | Storno'da tarih sınırı YOK — aylar öncesinin sevki geri alınabilir. |
| `return.gradingEnabled` | **false** | İade her zaman `WAREHOUSE`'a iner; `returnTargetStatus` yolu sahada ölü. |

**Bunun tek cümlelik sonucu:** sahada bir sevkiyat *planlanmaz*, **doğar ve aynı anda çıkar**. Bu yüzden
"iki kullanıcı planlı sevkiyat kurarken çakışır" senaryosunun penceresi **dakikalar değil, tek bir
transaction'ın milisaniyeleridir** — ve buna karşılık, PLANNED durumuna girmenin sahadaki **tek yolu
storno'dur** (`undoDispatch`, `releaseSacks` gönderilmezse). Aşağıdaki S2a/S2e sonuçları bu gerçeğe göre
yeniden değerlendirildi ve Tur 1'in bazı olasılık tahminlerini **daraltıyor** (bkz. §2 çizelgeleri).

---

## 1. UÇTAN UCA AKIŞ HARİTASI (dosya:satır)

```
[DEPO]  openSack :206  →  scanIntoSack :478 (touchWarehouseSackTx :516/:535)  →  weighSack :886 (:965)
                                                   │
                                                   ▼
[KURULUM] previewCreateShipment :1459  (SALT-OKUNUR; tek uyarı yüzeyi :1506-1520)
          createShipment :1376
            ├─ readCreateShipmentReplay :1362          (idempotency)
            ├─ loadSacksForShipment :1218              (pre-tx: çuval boş/başkasında/hayalet)
            ├─ assertExportWeighed :1278               (pre-tx)
            ├─ assertOrdersBelong :1263                (pre-tx: müşteri/şube — STATÜ YOK ⚠️)
            ├─ readShipmentConfirmationEnabled :1397   (TX DIŞI bayrak okuması)
            └─ $transaction (withBarcodeRetry :1401)
                 ├─ nextShipmentNo :1403
                 ├─ shipment.create :1404
                 ├─ çuval CLAIM döngüsü :1412-1418     {id, shipmentId:null} + seq
                 ├─ roll/swatch.updateMany :1420-1421
                 ├─ setShipmentOrdersTx :1288          (ShipmentOrder — SADECE BURADA yazılır ⚠️)
                 ├─ writeShipmentAllocationsTx :1339   → computeSackAllocations :1301
                 │     └─ orderLine.findMany {…ACTIVE_LINE} :1316-1321   ◄── KİLİTSİZ OKUMA
                 │     └─ distributeSacksToLines (allocation.helper :211)
                 └─ performDispatchTx :1806            (bayrak KAPALI → aynı tx)
                       ├─ shipment CLAIM :1812         {id, PLANNED}
                       ├─ hayalet assertion :1834-1847 (kilit altında taze)
                       ├─ shipmentOrder.isActive=false :1849
                       ├─ roll gruplu flip → SHIPPED + preShipStatus :1856-1867
                       ├─ touchOrderLinesTx :1878      ◄── SATIR KİLİDİ (tahsis YAZILDIKTAN SONRA)
                       ├─ recomputeOrderStatusForOrders :1879
                       └─ freezeForSource(SHIPMENT_DISPATCH) :1881
[STORNO]  undoDispatch :2141  → lockShipmentScopeTx(8023) :2159 (TX'İN İLK İFADESİ)
                              → resolveUndoBlockReason :2021 (taze, tx içi)
                              → shipment CLAIM :2179 {id, DISPATCHED} → PLANNED
                              → roll gruplu geri-flip :2191-2202 (preShipStatus)
                              → touchOrderLinesTx + recompute :2210-2211
                              → voidForSource :2214
                              → [ops] cancelPlannedShipmentTx :1961 (releaseSacks)
[İADE]    createReturn :~380 → lockShipmentScopeTx(8023) :490
                              → roll CLAIM {id, SHIPPED} :506-521
                              → rollReturn.create + freezeForSource(RETURN_DISPATCH)
          cancelReturn :~800 → (8023 YOK) → roll CLAIM {id, expectedStatus, shipmentId:null, sackId:null}
```

### Yield noktaları (her `await` bir yield) — kritik olanlar

| # | Yer | Okunan | Kullanıldığı yer | Arada kilit var mı |
|---|---|---|---|---|
| Y1 | `createShipment:1392` `loadSacksForShipment` | çuval boş/atanmış/hayalet | tx içi claim | **HAYIR** (claim telafi ediyor ✔) |
| Y2 | `createShipment:1395` `assertOrdersBelong` | sipariş müşteri/şube | tx içi tahsis | **HAYIR** — ve tx içinde **hiç tekrarlanmıyor** ⚠️ |
| Y3 | `createShipment:1397` bayrak | `confirmationEnabled` | tx içi dallanma | HAYIR (etkisi düşük) |
| Y4 | `computeSackAllocations:1316` | açık kalemler + `shippedQty` | `sackAllocation.createMany:1352` | **HAYIR** — kilit `:1878`'de, yani **yazımdan SONRA** ⚠️ |
| Y5 | `dispatchShipment:1895` | boş sevkiyat / EXPORT tartı | `performDispatchTx` claim | HAYIR (T1-084) |
| Y6 | `undoDispatch:2149` `sameDayOnly` | bayrak | tx içi karar | HAYIR (etkisi düşük) |
| Y7 | `cancelReturn` pre-check (`rr`, `newerReturn`, `sack`) | iade + top durumu | tx içi claim | **HAYIR** ve 8023 alınmıyor (KYY-3-02) |
| Y8 | `previewCreateShipment` **ayrı istek** | başka PLANNED sevkiyattaki bekleyen tahsis | *hiçbir yerde zorlanmıyor* | **HAYIR** — uyarı yalnız ekranda |

---

## 2. SENARYOLAR — çizelge + sonuç

### S2a — Aynı siparişin 100 m açığına iki kullanıcı 80 m ve 60 m sevk kuruyor

**Akış:** iki masaüstü, `Paketleme/Çuvallar → Sevkiyat Kur` (`CreateShipmentDialog.tsx:103`), farklı çuvallar,
aynı sipariş seçili.

| T | Kullanıcı A | Kullanıcı B | Durum |
|---|---|---|---|
| t0 | `POST /shipments/preview` → `pendingOther` = 0, uyarı yok | | ekranda "temiz" |
| t1 | | `POST /shipments/preview` → `pendingOther` = 0 (A henüz yazmadı) | ekranda "temiz" |
| t2 | tx başlar, `computeSackAllocations` → `need = 100 − 0 = 100`, 80 m tahsis | | |
| t3 | | tx başlar, `computeSackAllocations` → `need` hâlâ **100** (A commit etmedi), 60 m tahsis | |
| t4 | `touchOrderLinesTx` → kilit A'da, `recompute` → `shippedQty = 80`, commit | `touchOrderLinesTx` **bekler** | |
| t5 | | uyanır, `recompute` → defter = 80 + 60 = **140** | **SONUÇ: 100 m'lik kaleme 140 m sevk** |

**Sonuç — Tur 1'in tahminini DARALTIYOR.** Mevcut repro `audit/repro/KYY-2-02.log` bu kolu **5 + 5 + 1 = 11
paralel turda tetikleyemedi** (Σ alloc her turda 100 ≤ 100). Sebep §0'daki rejimdir: bayrak kapalı olduğu
için `computeSackAllocations` ile `touchOrderLinesTx` **aynı transaction'ın** iki komşu adımıdır ve
t2→t4 penceresi ölçülen koşumlarda ~10-40 ms'ye iniyor. Aynı ihlal `audit/repro/KYY-3-01.log`'da
**tetikleniyor** (`shippedQty=200 > quantity=100`) ama orada iki **PLANNED** sevkiyat önceden kurulmuştur —
sahada bu ön koşula ulaşmanın tek yolu storno'dur (S2e). Yani:

- Değişmez (`INV-SEV-08`, "Σ sevk ≤ istenen") **hiçbir katmanda zorlanmıyor** — bu doğrulandı ve durum
  Tur 1'de zaten `BULGU-T1-010` olarak defterde.
- **YENİ:** bu değişmezin sahadaki **tek azaltıcısı** `previewCreateShipment:1509-1520`'deki "bu satırda
  başka açık sevkiyatta ~N m bekliyor" uyarısıdır ve o uyarı **yalnız PLANNED sevkiyatları sayar** →
  bayrak kapalı fabrikada **hiçbir zaman çıkmaz** (bkz. bulgu **S-2-03**).

### S2b — Aynı çuvalı iki sevkiyata koyma

**Akış:** `createShipment:1412-1418` çuval başına `updateMany {id, shipmentId: null}` + `count !== 1 → 409`.
`addSacksToShipment:1552` aynı claim'i kullanır; `touchWarehouseSackTx` (`shipment-locks.helper.ts:65`)
depo tarafındaki her içerik mutasyonunu aynı satıra serileştirir.

**Sonuç: KORUMA TAM.** Kaybeden taraf `"Çuvallardan biri az önce başka bir sevkiyata girdi — yenileyin."`
alır, tx geri sarılır. `removeSack:1006`, `weighSack:965`, `splitSack:832`, `moveRollsToSack:770-771`,
`reassignSackCustomer:378` de aynı deseni uygular. **Bulgu yok** → §"Doğru yapılanlar".
(Bilinen istisna `moveRollToSack` kilit **sırası** — `BULGU-T1-028` / `audit/repro/KYY-2-08.log`, açık.)

### S2c — Sevk anında aynı çuvala top okutma / not düzenleme

| T | Tablet (`scanIntoSack`) | Masaüstü (`createShipment`/`dispatch`) | Sonuç |
|---|---|---|---|
| t0 | `sack.shipmentId == null` okur (`:487`) | | |
| t1 | | çuvalı claim eder → `shipmentId = X` | |
| t2 | tx: `touchWarehouseSackTx` → `WHERE shipmentId IS NULL` → count 0 | | **409, temiz red** ✔ |

Aynı zincir `weighSack`, `removeRollFromSack`, `distributeSackContents`, `splitSack`, ve
`inventory.applyManualProperties` (`inventory.service.ts:3921-3934` — tx içi taze `shipmentId` okuması +
`touchWarehouseSackTx` + pinli claim) için de geçerli. `performDispatchTx:1834-1847` ayrıca kilit altında
**hayalet top assertion'ı** koşar (filtre değil, hata — gerekçesi kodda yazılı).

**Tek bilinçli delik `Sack.notes`** (`setSackNotes:1704`, guard **kasıtlı yok**, `CLAUDE.md`'de yazılı).
Ölçüldü: not **sevk irsaliyesine girmiyor** (`collectShipmentDocContent:3420-3437` `notes` alanını hiç
`select` etmiyor), yalnız `sackNote` şablona sürüklenmişse ÇUVAL ETİKETİNİ bayatlatıyor. Sevk edilmiş bir
çuvalın etiketi zaten müşterideyken `labelDirty=true` yazılıyor ve bu bayrak bir daha temizlenmiyor —
**S4 gürültü**, veri/para etkisi yok. **Bulgu yazılmadı.**

### S2d — Storno ∥ iade / iade iptali

**(d1) `undoDispatch` ∥ `createReturn`:** ikisi de `lockShipmentScopeTx(8023)`'ü **tx'in ilk ifadesi**
olarak alıyor (`:2159` ve `return.service.ts:490`); sıra load-bearing ve doğru. **Koruma tam** ✔

**(d2) `undoDispatch` ∥ `cancelReturn`:** `cancelReturn` 8023 **almıyor** ve sevkiyat statüsünü hiç
okumuyor (`return.service.ts:876-900`). Çizelge:

| T | `cancelReturn(R1)` | `undoDispatch(X)` | Sonuç |
|---|---|---|---|
| a | tx: roll → `SHIPPED/X` + `R1.cancelledAt` (tek tx) | | |
| b | | 8023 → `rollReturn.count` = 1 (a commit etmediyse) → **blok** | güvenli |
| c | commit | `count` = 0 → devam; groupBy topu **görür** ve geri çeker | güvenli |

**Sonuç: bu yarış bugün KAPALI** — çünkü `cancelReturn`'ün iki yazımı (top claim'i + `cancelledAt`) **aynı
transaction'dadır**, yani "iade iptal edilmiş görünüyor ama top hâlâ depoda" ara durumu hiç doğmuyor.
`audit/repro/KYY-3-02.log` [A] kolu da 20 turda tetikleyemedi. Bu, `BULGU-T1-040`'ın **elenmesiyle
tutarlıdır** ve yeni kanıt bulunamadığı için **yeniden AÇILMIYOR**. (KYY-3-02 [B] "koruma sondası" hâlâ
kırmızı — ama sonda o durumu **elle** kuruyor; bu turda ona ulaşan meşru bir akış bulunamadı; §"Kapsanmayan".)

**(d3) Toplu iade (`returnGroupId`) yarıda düşerse:** `createReturn` döngüsü tek tx içinde; bir top başka
bir iadeye kapılmışsa `flip.count === 0` → **tüm grup geri sarılır** ("hiçbir top iade alınmadı" mesajı).
Belge (`freezeForSource`) da aynı tx'te. **Koruma tam** ✔

**(d4) Storno sonrası kalan hesabı:** tahsisler **bilinçli olarak silinmez** (`:2204-2206`) — `shippedQty`
defterden türetildiği ve yalnız DISPATCHED'i saydığı için sevkiyat PLANNED olunca karşılanma kendiliğinden
düşer. Aritmetik doğru. **Ama** tahsis satırları o eski `need`'e göre hesaplanmış hâlde donar ve yeniden
sevkte **yeniden hesaplanmaz** → bulgu **S-2-03**.

### S2e — Sevk Kapısı bayrağı ile PLANNED sevkiyatın karşılaşması

Karo `visibleWhen: (ctx) => ctx.shipmentConfirmationEnabled` (`tile-config.ts:139`) — 2026-08-22'de
"VEYA PLANNED varsa" kuralı bilerek kaldırıldı, gerekçesi kodda yazılı ve **doğru**: PLANNED sevkiyata
"Sevk Et" artık Sevkiyatlar detayından veriliyor, `SackStorePage.tsx:149-157` bayrak kapalıyken açıklayıcı
bant basıyor, route bayrağa bakmıyor.

**Kalan boşluk:** kapalı rejimde PLANNED'a girmenin tek yolu storno'dur ve "sevkiyatı da kapat"
(`releaseSacks`) kararı **istemcide** veriliyor (`UndoDispatchDialog.tsx:64`
`releaseChoice ?? !p.confirmationEnabled`). Sunucu rejimi **biliyor** ama alanı göndermeyen bir istemcide
(eski Electron — geriye uyumluluk bilinçli, `CLAUDE.md` 2026-08-22; mobilde `undo-dispatch` istemcisi
**hiç yok**, `mobil/src/services/packing.service.ts` içinde uç yok) `releaseSacks=false` varsayılır →
rejime aykırı PLANNED sevkiyat + kilitli çuval kalır. Bulgu **S-2-06** (S3).

### S2f — "Sevk Et"e çift tıklama / kuyruğun tekrar denemesi

- `dispatchShipment:1900-1901` pre-check + `performDispatchTx:1812` atomik claim → ikinci istek
  `"Sevkiyat zaten sevk edilmiş"` / `"Sevkiyat durumu değişti"` 409'u alır. **Koruma tam** ✔
- `createShipment` `clientToken` replay'i var (`:1383-1386`, `:1440-1443`) ve `withBarcodeRetry` predicate'i
  `clientToken` P2002'sini **retry etmiyor** (`:1435`) — `BULGU-T1-005`/`D-B-03` sınıfının doğru çözümü ✔
- **AMA** replay kaydın **statüsüne bakmıyor** → iptal edilmiş sevkiyat için `success:true` dönüyor.
  Bulgu **S-2-04**.

### S2g — Dispatch commit'inden sonra irsaliye PDF/print-event düşerse

`freezeForSource(SHIPMENT_DISPATCH)` dispatch tx'inin **İÇİNDE** (`:1881`) — belge yazılamazsa sevk de
geri sarılır. Baskı/`print-event` ayrı bir HTTP çağrısıdır ve donmuş belgeyi **değiştirmez**. Ayrıca
`collectShipmentDocContent:3446-3465` iade geri-eklemesinde canlı id kümesiyle dedup yapıyor (yarış notu
kodda yazılı). **Bulgu yok** → §"Doğru yapılanlar".

### S2h — `BULGU-T2-001`in senaryo düzeyinde izi (görev gereği)

*"specMatch tutmayan içerik SackAllocation üretmeden sevk ediliyor — 5 sevkiyat, 7.200,6 m defter dışı."*
Bu turda sorulan üç soru:

1. **Hangi operatör hareketi üretiyor?** — Ölçüldü, **dört yol** var ve biri baskın:
   - **(a) Tablet `Paketleme → "Hemen Sevk Et"`:** `mobil/src/screens/Modules/TartiPaket/PaketlemeScreen.tsx:292`
     `orderIds: undefined` — **sabit kodlu**. Mobil uygulamanın tamamında sipariş seçimi **yoktur**
     (`grep -rn "orderIds" mobil/src` → yalnız bu satır + servis imzası). Yani **tabletten kurulan HER
     sevkiyat defter dışıdır** ve bayrak kapalı olduğu için **aynı anda DISPATCHED** olur.
   - (b) Masaüstünde "siparişsiz" anahtarı (`CreateShipmentDialog.tsx:81` `orderless ? [] : …`).
   - (c) Spec uyuşmazlığı (renk/en) → `distributeSacksToLines` hiç tahsis üretmez.
   - (d) Şube uyuşmazlığı (`allocation.helper.ts:198 branchMatch`).
2. **Hangi ekranda görünmüyor?** — Kurulumdan sonra **hiçbir yerde**. `getShipmentById:2868-2889`
   sipariş bölümünü `shipment.orders`'tan (ShipmentOrder) üretir; küme boşsa **bölüm hiç çizilmez** ve
   "bu sevkiyatın N m'si hiçbir siparişe yazılmadı" diyen bir satır yoktur. Tek uyarı
   `previewCreateShipment:1507/:1522`'dedir ve o **kurulumdan önceki** ayrı bir istektir.
3. **Düzeltme yolu var mı?** — **YOK.** `setShipmentOrdersTx` (`:1288`) **yalnız `createShipment:1423`**
   tarafından çağrılıyor; sevkiyatın sipariş kümesini değiştiren **hiçbir uç yok**
   (`src/routes/shipping.routes.ts` tam listesi denetlendi). `addSacksToShipment`/`removeSackFromShipment`
   tahsisi yeniden hesaplar ama **mevcut** `ShipmentOrder` kümesini kullanır (boş küme → `:1346` erken
   dönüş) ve ikisi de PLANNED ister. Tek çıkış: storno → kapat → çuvalları havuza al → **yeni sevk no ile
   yeniden kur** (ki `shipping:undo-dispatch` izni + fatura işaretsizlik + aktif iade yokluğu ister).

Bulgu **S-2-01** (yeni koşullar: operatör hareketi, sessizlik yüzeyi, onarım yolunun yokluğu, boş fatura
belgesi) — `onceki_defter: BULGU-T2-001`.

---

## BULGULAR

### [S-2-01] Tabletten kurulan HER sevkiyat sipariş defteri yazmadan çıkıyor ve dispatch'ten sonra sipariş bağı kurmanın hiçbir yolu yok
| Şiddet | S1 | Kategori | E (Satış/Sevkiyat) + F | Öncelik | P0 | Modül | Sevkiyat ↔ Sipariş | Kanıt seviyesi | K1 |

**Özet.** Saha tabletinde "Hemen Sevk Et" sipariş seçimi sunmaz — istek gövdesinde `orderIds` **sabit
`undefined`**'dır. Sevk onayı bayrağı kapalı olduğu için sevkiyat aynı transaction'da DISPATCHED olur,
`ShipmentOrder` kümesi boş kalır, `writeShipmentAllocationsTx` erken döner ve **tek bir `SackAllocation`
satırı bile yazılmaz**. Sonuç: mal fiziksel olarak çıkar, `OrderLine.shippedQty` artmaz, sipariş
"Açık" görünmeye devam eder. Bu, Tur 2'de sahada ölçülen **7.200,6 m / 5 sevkiyat**'ın operatör
hareketidir. Kurulduktan sonra sevkiyatın sipariş kümesini değiştiren **hiçbir uç yoktur** — hata
düzeltilebilir değildir.

**Kanıt.**
- `mobil/src/screens/Modules/TartiPaket/PaketlemeScreen.tsx:286-295`
  ```ts
  // "Hemen Sevk Et" — dolu çuvallardan SİPARİŞSİZ sevkiyat kur. …
  const created = await packingService.createShipmentFromSacks({
    sackIds, customerId, branchId,
    orderIds: undefined,          // ← sabit; mobilde sipariş seçimi HİÇ YOK
    destination, clientToken: shipTokenRef.current,
  });
  ```
  `grep -rn "orderIds" mobil/src --include='*.ts*'` → **3 vuruş**, üçü de bu satır + servis imzası
  (`mobil/src/services/packing.service.ts:524,540`). Karşılaştırma: `Electron/.../CreateShipmentDialog.tsx:62,81,107,229`
  gerçek bir `ShipmentOrderSelect` taşıyor.
- `Teks-Erp/src/services/shipping.service.ts:1339-1354` — `writeShipmentAllocationsTx`:
  ```ts
  await tx.sackAllocation.deleteMany({ where: { sack: { shipmentId } } });
  if (orderIds.length === 0) return;     // ← defter hiç yazılmaz
  ```
- `Teks-Erp/src/services/shipping.service.ts:1288-1294` — `setShipmentOrdersTx`; **tek çağıran**
  `:1423` (`createShipment`). `grep -rn "setShipmentOrdersTx" src` → 2 vuruş (tanım + tek çağrı).
- `Teks-Erp/src/routes/shipping.routes.ts:295-309, 326, 362` — sevkiyat uçlarının tamamı: sipariş
  kümesini yazan/düzenleyen uç **yok**; `add-sacks`/`remove-sack` PLANNED şartı taşır (`:1542`, `:1570`).
- `Teks-Erp/src/services/shipping.service.ts:2868-2889` — `getShipmentById` sipariş bölümünü
  `shipment.orders`'tan üretir; boş küme → bölüm çizilmez, uyarı satırı yok.
- **Mali yüzey:** `shipping.service.ts:3652-3672` (`collectShipmentDerived` → fatura satırları)
  `sk.allocations` üzerinden döner → tahsis yoksa `invoiceLines = []`, `invoiceTotals = []`,
  `hasPrices = false`. Yani o sevkiyatın **ticari fatura/proforma bölümü boş basılır** (ambalaj ve
  kalite bölümleri dolu). `accounting-export.service.ts:386` `orderNos` da boş string olur.
- **Koruma kontrolü (nereye bakıldı):** DB kısıtı yok (`SackAllocation` üzerinde "her DISPATCHED sevkiyatın
  en az bir tahsisi olmalı" CHECK/trigger aranmadı ve **yok** — K10 INV-SEV-08 satırı "HİÇBİR YERDE"
  diyor); `performDispatchTx:1806-1883`'te tahsis varlığı kontrolü yok; `consistency-check.sql` §1/§2
  denormu **deftere karşı** ölçtüğü için defterin eksikliğini tanım gereği göremiyor (`BULGU-T2-004`).

**failure_mode.** Operatör tablette 3 çuval / 640 m okutup "Hemen Sevk Et" der. Sistem `SVK…0021`
üretir, toplar `SHIPPED` olur, mal kamyona çıkar. Müşterinin `SIP…0007` numaralı 640 m'lik siparişi
ekranda **"İstenen 640 · Sevk 0 · Açık 640"** kalır; planlamacı ertesi gün aynı 640 m için ikinci bir
iş emri açar. Muhasebe o sevkiyatın "Sevk Fişi / Fatura" belgesini bastığında **fatura satırı bölümü
boştur** (ambalaj listesi 3 çuval, 640 m yazar). Hatayı fark eden kişi sevkiyatı düzeltmek ister:
sipariş bağlayacak uç yoktur; tek yol `shipping:undo-dispatch` ile storno + kapatma + çuvalları yeniden
paketleyip yeni sevk no ile kurmaktır — ve sevkiyat faturalanmışsa storno da **reddedilir** (`:2034`).

**Veride fiili ihlal (K2).** Bu turda **ölçülemedi** — dev ve saha PostgreSQL'i oturum boyunca erişilemez
(bkz. §"Kapsanmayan"). Tur 2'nin aynı DB'de yaptığı ölçüm geçerli sayıldı: **5 sevkiyat / 7.200,6 m
tahsis üretmeden sevk edilmiş, 7 sipariş kalemi hâlâ "0 sevk"** (`BULGU-T2-001`).

**Repro (K3).** Yarış bulgusu değil — repro istemez. Doğrulama yolu §"Kabul kriteri"nde.

**İş etkisi.** Sipariş karşılanma tablosu, "Açık talep" süzgeci (`openLineWhere`), Ürün Dengesi /
malzeme açığı, Sipariş Karşılanma ve Sevk & Termin karneleri, muhasebe fatura satırları — hepsi bu
sevkiyatları görmez. Fabrika karşılanmış talebi **yeniden üretir**; müşteriye giden belgede satır yoktur.

**Öneri (2. tur için).**
1. **Mobil:** `PaketlemeScreen`e sipariş seçimi ekle (masaüstündeki `ShipmentOrderSelect`in ikizi) **ya da**
   "siparişsiz sevk" olduğunu onay ekranında AÇIKÇA yazdır ve `orderless: true`yu **açık bir niyet alanı**
   olarak gönder (bugün `undefined` ile "seçim yapılmadı" arasında fark yok). APK gerekir.
2. **Backend (APK'yı beklemeden):** `createShipment`e `orderless` niyet alanı ekle; `orderIds` boş **ve**
   `orderless` gelmemişse **400** (fail-closed). Eski istemciler için geçiş penceresinde 400 yerine
   `ApiResponse.warnings` + `Shipment.unallocatedMeters` denormu yazılabilir.
3. **Onarım yolu:** `POST /shipments/:id/orders` (izin `shipping:write`) — sevkiyatın sipariş kümesini
   **DISPATCHED durumda da** yeniden yazıp `writeShipmentAllocationsTx` + `touchOrderLinesTx` +
   `recomputeOrderStatusForOrders` koştursun; irsaliye `reissue` ile v+1. Migration gerekmez.
   `[PROD'DA ÇALIŞTIRMA]` gerektirmez (yeni uç, veri dokunuşu yok).
4. **Görünürlük:** sevkiyat detayına "hiçbir siparişe yazılmayan metraj" satırı
   (`totalMeters − Σ allocation`) + Sevkiyatlar listesinde rozet. Geçmiş 5 sevkiyat için düzeltme
   **iş kararıdır**, toplu UPDATE önerilmez (kök nedeni gizler).

**Kabul kriteri.** (a) Tabletten sipariş seçmeden sevkiyat kurulamıyor ya da niyet açıkça beyan ediliyor;
(b) `SELECT s.id FROM shipments s WHERE s.status='DISPATCHED' AND NOT EXISTS (SELECT 1 FROM sack_allocations a JOIN sacks k ON k.id=a."sackId" WHERE k."shipmentId"=s.id) AND EXISTS (SELECT 1 FROM sacks k2 WHERE k2."shipmentId"=s.id)`
sorgusu yeni kayıt üretmiyor; (c) yeni bekçi `test_shipment_ledger_coverage.ts` — siparişsiz sevk
denemesi 400/uyarı üretiyor ve onarım ucu tahsisi geriye dönük yazıyor (negatif sonda: uç kaldırılınca kırmızı).

**Efor.** 2,5 gün (mobil ekran 1 · backend uç + bekçi 1 · Electron rozet 0,5)

**Önceki defter.** `BULGU-T2-001` (V-1-03/V-2-01, ayakta) — bu bulgu onun **senaryo/onarım** boyutudur:
operatör hareketi, sessizlik yüzeyi ve "geri dönüşü yok" özelliği orada yoktu. `BULGU-T2-003` (tahsis
defterine audit yazılmıyor) ile birlikte okunmalı.

---

### [S-2-02] Sevkiyat kurulurken sipariş (ya da kalemi) iptal edilirse mal İPTAL EDİLMİŞ talebe yazılıyor — sipariş statüsü hiçbir katmanda okunmuyor
| Şiddet | S1 | Kategori | A.1 / E (Satış-Sevkiyat) | Öncelik | P1 | Modül | Sevkiyat ↔ Sipariş | Kanıt seviyesi | K1 |

**Özet.** `createShipment` seçilen siparişleri yalnız **müşteri/şube** açısından doğruluyor
(`assertOrdersBelong:1263-1276`); **`Order.status` hiç okunmuyor** ve tahsis hesabındaki tek süzgeç
`ACTIVE_LINE` (`cancelledAt IS NULL`). Ama sipariş **başlığını** iptal eden iki yol da
(`order.service.ts:2760-2766` ve `:3145-3155`) **kalemlere `cancelledAt` yazmıyor** — yalnız
`Order.status = CANCELLED` damgalıyor. Sonuç: iptal edilmiş bir siparişin kalemleri `ACTIVE_LINE`
süzgecinden **geçiyor**, tahsis yazılıyor, dispatch onu `shippedQty`ye terfi ettiriyor. Sipariş
`terminal` olduğu için statüsü CANCELLED kalır ama **sevk edilmiş metrajı dolar**.

**Kanıt.**
- `Teks-Erp/src/services/shipping.service.ts:1263-1276` — `assertOrdersBelong`; gövdede `status` yok:
  ```ts
  const orders = await prisma.order.findMany({ where: { id: { in: orderIds } },
    select: { id: true, customerId: true, branchId: true } });   // ← status seçilmiyor bile
  ```
- `Teks-Erp/src/services/helpers/order-line-scope.helper.ts:26` — `ACTIVE_LINE = { cancelledAt: null }`
  (satır-düzeyi; sipariş başlığını **kapsamaz**).
- `Teks-Erp/src/services/order.service.ts:2760-2766` (generic iptal) ve `:3145-3155` (`cancelWithActions`)
  — `data: { status: CANCELLED, cancelledAt, … }`; kalem döngüsü **yok**.
  `grep -n "cancelledAt" src/services/order.service.ts` → kaleme yazan tek yer `:479-482`
  (`cancelOrderLine`, yani **tek tek kalem iptali**).
- `Teks-Erp/src/services/shipping.service.ts:1316-1321` — okuma **kilitsiz**; kilit
  (`touchOrderLinesTx`) `:1878`'de, yani `sackAllocation.createMany:1352`'den **sonra**.
- `Teks-Erp/src/services/helpers/order-status.helper.ts:160-162, 196` — `terminal` sipariş için status
  değişmez ama `data.shippedQty` **her zaman** yazılır.
- **Koruma kontrolü (nereye bakıldı):** `shipping.routes.ts:295` (`WRITE` izni — iş kuralı değil);
  Zod şeması (`shipping.controller.ts` `createShipment`) yalnız biçim doğruluyor; DB'de
  `sack_allocations` → `order_lines` FK'sı var ama **statü kısıtı yok**; `performDispatchTx` claim
  sonrası sipariş/kalem statüsünü **tekrar okumuyor**; `consistency-check.sql` §1/§2 bu durumu
  "defterle uyumlu" sayar (defter zaten öyle yazmıştır).

**Çakışma senaryosu.**
*Uzun pencere (yarış hassasiyeti GEREKMEZ — baskın yol):*
- **T1 (Sevkiyatçı):** `Sevkiyat Kur` diyaloğunu açar, `listOpenOrdersWithCoverage` (`:3306-3321`,
  `status notIn CANCELLED/COMPLETED`) O siparişini listeler, işaretler. Diyalog **dakikalarca** açık kalır.
- **T2 (Satış):** aynı dakikada O siparişini iptal eder (`Order.status = CANCELLED`; kalemler dokunulmadan).
- **T1:** "Sevkiyatı Kur" → `assertOrdersBelong` statüye bakmaz → `ACTIVE_LINE` kalemleri geçirir →
  tahsis yazılır → aynı tx'te DISPATCHED.
- **SONUÇ:** `SIP…` CANCELLED, `shippedQty = 640`; `ShipmentOrder` satırı iptal edilmiş siparişe bağlı;
  aynı spec'in **gerçekten açık** siparişi mal alamaz.

*Kısa pencere (kalem düzeyi, ms):* T1 `computeSackAllocations` kalemleri okur → T2 `cancelOrderLine`
commit eder → T1 tahsisi yazar ve dispatch eder → `recomputeOrderStatus` iptal kalemin `shipped`ini
`totalRequired`a katar (`order-status.helper.ts:145`) → sipariş **COMPLETED**'a düşebilir.

**failure_mode.** Müşteri 640 m'lik `SIP2908260007`yi 14:02'de iptal ettirir. Sevkiyatçının ekranı
13:58'de açılmıştır. 14:03'te sevkiyat kurulur: 640 m mal çıkar, iptal edilmiş siparişe yazılır.
Sipariş listesi `SIP2908260007`yi **"İPTAL · Sevk 640 m"** gösterir; Sipariş Karşılanma raporu ve
`shipped` tabanlı tüm karneler iptal edilmiş talebe 640 m yazar; müşterinin gerçekten açık olan
`SIP2908260011`i (aynı kumaş) hâlâ 640 m açık görünür ve fabrika onu yeniden üretir.

**Veride fiili ihlal (K2).** **Aranamadı** — DB oturum boyunca erişilemez (§"Kapsanmayan").
Koşulması gereken iki sorgu §"Kabul kriteri"nde verildi. Not: saha 2026-08-25 kopyasında
`order_lines.cancelledAt` **kolonu yok** (K2b H-9) → kısa-pencere kolu o kopyada ölçülemez;
**uzun-pencere kolu (sipariş başlığı iptali) ölçülebilir ve o kolun kolon bağımlılığı yoktur.**

**Repro (K3).** `Teks-Erp/scripts/audit_repro_S-2-01.ts` **yazıldı** (tip kontrolü temiz: `tsc -p
tsconfig.scripts.json` bu dosya için 0 hata) — üç kol: (A) sıralı kontrol, (B) 12 tur × değişken gecikmeyle
`createShipment ∥ cancelOrderLine`, (C) `performDispatchTx`in kilit altında yeniden doğrulama yapıp
yapmadığının kaynak sondası. **Koşturuldu, TETİKLENEMEDİ — sebep ortam:** dev PostgreSQL'i
`Postgres.app failed to verify "trust" authentication` ile hiçbir bağlantıyı kabul etmiyor
(`audit/repro/S-2-01.log`). Negatif sonuç **ortam kaynaklıdır, kod kaynaklı değildir**; script DB
erişilir olur olmaz olduğu gibi koşar.

**İş etkisi.** İptal edilen talebe sevk yazılması hem karşılanma raporunu hem "açık talep"e dayanan
planlamayı bozar; malın gerçek muhatabı olan sipariş açık kalır → mükerrer üretim. Muhasebe tarafında
iptal edilmiş siparişe bağlı bir irsaliye/fatura satırı doğar.

**Öneri (2. tur için).**
1. `assertOrdersBelong`e `status` seçimi + `CANCELLED` reddi ekle (pre-tx, okunaklı 400).
2. **Asıl düzeltme kilit altında:** `performDispatchTx`te `touchOrderLinesTx`ten **sonra** tahsisleri
   taze doğrula — `sackAllocation` satırlarının `orderLine.cancelledAt IS NULL` **ve**
   `orderLine.order.status NOT IN (CANCELLED)` olduğunu kontrol et; ihlal varsa 409 (fail-closed).
   Alternatif ve daha temiz: `writeShipmentAllocationsTx`i `touchOrderLinesTx`ten **sonraya** al
   (sıra load-bearing; bugün ters).
3. **Kural boşluğunu kapat:** sipariş başlığı iptali kalemlere de `cancelledAt` damgalasın **ya da**
   `ACTIVE_LINE`ın yanına `order: { status: { not: CANCELLED } }` taşıyan ikinci bir tek-kaynak yüklem
   eklensin (`order-line-scope.helper.ts`; AST bekçisi zaten var). ⚠️ Damgalama **veri dokunuşudur** →
   `[PROD'DA ÇALIŞTIRMA]`; geri alma: damgalanan satırların id listesi script çıktısında tutulur ve
   `cancelledAt = NULL` ile geri alınır. Dry-run varsayılan.
**Kabul kriteri.**
`SELECT o."orderNumber", ol.id, ol."shippedQty" FROM order_lines ol JOIN orders o ON o.id=ol."orderId" WHERE o.status='CANCELLED' AND ol."shippedQty" > 0;`
ve `… WHERE ol."cancelledAt" IS NOT NULL AND EXISTS (SELECT 1 FROM sack_allocations a JOIN sacks k ON k.id=a."sackId" JOIN shipments s ON s.id=k."shipmentId" WHERE a."orderLineId"=ol.id AND s."dispatchedAt" > ol."cancelledAt");`
→ ikisi de **0**; `audit_repro_S-2-01.ts` B ve C kolları yeşil.

**Efor.** 1,5 gün (guard + kilit sırası 0,5 · tek-kaynak yüklem + bekçi 0,5 · veri damgalama script'i 0,5)

**Önceki defter.** Yeni. En yakın komşusu `BULGU-T1-010` (kalan kapasite kilitten önce okunuyor) —
**farklı kural**: orada aşılan `quantity`, burada **iptal edilmiş talebe yazım**. K3a §6 #10 harita notu
("iptal edilmiş siparişe PLANNED sevkiyat bağlı kalabilir") bu bulgunun zeminidir; burada bayrak kapalı
rejimde durumun **PLANNED'da değil doğrudan DISPATCHED'te** doğduğu ve kalem damgası eksikliğinin
`ACTIVE_LINE` tek-kaynağını körleştirdiği gösterildi.

---

### [S-2-03] Sevk anında tahsis yeniden hesaplanmıyor: storno'nun bıraktığı PLANNED sevkiyat eski `need` ile donuyor — ve tek uyarı yüzeyi sahada hiç çalışmıyor
| Şiddet | S2 | Kategori | E (Satış-Sevkiyat) / A.1 | Öncelik | P2 | Modül | Sevkiyat ↔ Sipariş | Kanıt seviyesi | K1 |

**Özet.** Tahsis (`SackAllocation`) **kurulum anında** hesaplanıp yazılır; `performDispatchTx` onu
**olduğu gibi** `shippedQty`ye terfi ettirir, hiçbir yerde yeniden hesaplamaz. Bayrak kapalı olduğu
için kurulum ile sevk normalde aynı tx'tedir — **tek istisna storno'dur**: `undoDispatch` sevkiyatı
PLANNED'a çeker ve tahsisleri **bilinçli olarak korur** (`:2204-2206`). O andan sonra sipariş tarafında
olan her şey (kalem iptali, miktar düşürme, fasondan doğrudan sevk, başka bir sevkiyatın çıkışı)
tahsise yansımaz; sevkiyat yeniden "Sevk Et" ile çıkarıldığında **bayat rakam** deftere yazılır.
Ayrıca bu durumu operatöre gösterecek tek yüzey — `previewCreateShipment`in "başka açık sevkiyatta
bekliyor" uyarısı — **yalnız PLANNED sevkiyatları sayar** ve bayrak kapalı fabrikada pratikte hiç
tetiklenmez; üstelik o uyarı **yeni sevkiyat kurulurken** çıkar, bekleyen sevkiyat yeniden çıkarken değil.

**Kanıt.**
- `Teks-Erp/src/services/shipping.service.ts:2204-2206` (storno):
  ```ts
  // Tahsisler SİLİNMEZ — `shippedQty` defterden türetilir ve yalnız DISPATCHED
  // sevkiyattaki tahsisleri sayar; sevkiyat PLANNED olunca karşılanma kendiliğinden düşer.
  ```
- `Teks-Erp/src/services/shipping.service.ts:1806-1883` — `performDispatchTx` gövdesinde
  `writeShipmentAllocationsTx` / `computeSackAllocations` / `ACTIVE_LINE` **geçmiyor**
  (`audit_repro_S-2-01.ts` C1 kolu bunu mekanik ölçüyor).
- `Teks-Erp/src/services/shipping.service.ts:1509-1520` — tek uyarı:
  ```ts
  where: { orderLineId: { in: [...lineNeeds.keys()] },
           sack: { shipment: { status: ShipmentStatus.PLANNED } } },   // ← yalnız PLANNED
  ```
  Prod'da `shipping.confirmationEnabled=false` (V-4 §0) → PLANNED sevkiyat yalnız storno'dan doğar.
- `Teks-Erp/src/services/helpers/allocation.helper.ts:102, 221` — `need = quantity − shippedQty`;
  başka bir PLANNED sevkiyatın tahsisi **düşülmez** (K10 INV-SEV-02 dipnotu).
- Yeniden çıkarma yolu: `Electron/src/pages/Operations/Shipments` "Sevk Et" → `POST /shipments/:id/dispatch`
  (`shipping.routes.ts:307`) → `dispatchShipment:1890` → `performDispatchTx`.
- **Koruma kontrolü:** DB kısıtı yok; `dispatchShipment`in pre-check'i yalnız statü/boşluk/tartı bakıyor
  (`:1899-1903`); `touchOrderLinesTx` **doğru** çağrılıyor ama kilit **yalnız defter yazımını**
  serileştiriyor, tahsisin **içeriğini** doğrulamıyor.
- **Tetiklenebilirlik ölçümü (bu turun katkısı):** `audit/repro/KYY-2-02.log` — kurulum kolunda
  11 paralel turda ihlal **0**; `audit/repro/KYY-3-01.log` — iki hazır PLANNED sevkiyat kolunda ihlal
  **kesin** (`shippedQty=200 > quantity=100`, sipariş COMPLETED). Yani ihlalin sahadaki kapısı
  "iki paralel kurulum" değil, **"PLANNED'da bekleyen sevkiyat"**tır.

**Çakışma senaryosu.**
- **T0:** `SVK…0031` (500 m, `SIP…0009`ın 500 m'lik kalemine tahsisli) DISPATCHED.
- **T1:** Operatör "yanlış araç" der → `undoDispatch` (eski Electron ya da API çağrısı → `releaseSacks`
  gönderilmez) → sevkiyat **PLANNED**, tahsis 500 m **duruyor**, `shippedQty` 0'a döner.
- **T2:** Satış aynı kalemi 200 m'ye düşürür (`quantity: 500 → 200`) — ya da kalemi iptal eder.
- **T3:** Ertesi gün Sevkiyatlar detayından "Sevk Et" → `performDispatchTx` **bayat 500 m'yi** terfi ettirir.
- **SONUÇ:** 200 m'lik kaleme 500 m sevk yazılır; `INV-SEV-08` ihlali, hiçbir uyarı yok.

**failure_mode.** `SIP2908260009` kalemi 200 m'ye düşürülmüşken sistem 500 m sevk edilmiş gösterir;
"Açık" −300 m çıkar ve UI onu 0'a kelepçeler (K7a §4.1'deki 13 kopya hesap), yani **fazla sevk hiçbir
ekranda görünmez**; muhasebe fişinde 500 m fiyatlanır.

**Veride fiili ihlal (K2).** Aranamadı (DB erişimi yok). Sorgu §"Kabul kriteri"nde.
K10'un Tur-2 ölçümü Q-SEV-08a/08b = **0** diyordu → bugün sahada tezahür **yok**; bulgu "olasılık" değil
"kapı açık" temellidir ve olasılığı `releaseSacks` göndermeyen istemci sayısına bağlıdır (bkz. S-2-06).

**Repro (K3).** Ayrı script yazılmadı — **mevcut** `Teks-Erp/scripts/audit_repro_KYY-3-01.ts` bu ihlali
zaten tetikliyor (`audit/repro/KYY-3-01.log`: 4 ihlal). Bu turun eklediği şey ihlalin **sahadaki kapısını**
adlandırmaktır (storno → PLANNED → bayat tahsis). Genişletme önerisi: KYY-3-01'e üçüncü bir kol —
"dispatch → undo → kalem miktarını düşür → yeniden dispatch" — eklenmesi (mevcut fixture'ı yeniden kullanır).

**İş etkisi.** Fazla sevk + fazla fatura; sipariş kapanma toleransı (`shipping.toleranceMeters`, prod'da
satır yok → 5 m) bunu yutmaz ama "Açık" kelepçesi gizler.

**Öneri (2. tur için).** (a) `performDispatchTx` başında, `touchOrderLinesTx`ten **sonra**,
`writeShipmentAllocationsTx`i **yeniden** koştur (aynı sipariş kümesiyle) — tahsis her zaman sevk anının
gerçeğini yazsın; storno'nun "tahsisi koru" kararı bozulmaz, yalnız yeniden çıkışta tazelenir.
(b) Alternatif/ek: `SackAllocation`a `computedAt` + dispatch'te `shipment.updatedAt`ten eskiyse uyar.
(c) `previewCreateShipment` uyarısının ikizini **`getUndoDispatchPreview`e ve "Sevk Et" onayına** taşı
("bu sevkiyatın tahsisi N gün önce hesaplandı; kalem o tarihten sonra değişti").
Migration gerekmez (a/c için).

**Kabul kriteri.**
`SELECT ol.id, ol.quantity, ol."shippedQty" FROM order_lines ol WHERE ol."shippedQty" > ol.quantity + 5;` → 0
ve yeni bekçi `test_dispatch_allocation_fresh.ts`: dispatch → undo → `quantity` düşür → yeniden dispatch
sonrası `Σ SackAllocation ≤ quantity` (negatif sonda: yeniden hesap kaldırılınca kırmızı).

**Efor.** 1 gün

**Önceki defter.** `BULGU-T1-010` (ayakta) ile aynı kural (`INV-SEV-08`), **farklı koşul**: T1 iki paralel
kurulumu işaret ediyordu; bu turda ölçüldü ki o kol sahadaki rejimde tetiklenmiyor, **gerçek kapı
storno'nun bıraktığı PLANNED sevkiyattır.** `BULGU-T1-084` (pre-tx kontroller) komşu.

---

### [S-2-04] İptal edilmiş sevkiyatın `clientToken` replay'i "Sevkiyat kuruldu" diyor — mal çıkmamıştır ve o mesajın işaret ettiği ekran bu fabrikada hiç yoktur
| Şiddet | S2 | Kategori | B.3 (idempotency) | Öncelik | P2 | Modül | Sevkiyat | Kanıt seviyesi | K1 |

**Özet.** `readCreateShipmentReplay` yalnız `id/shipmentNo/status` okuyup `success: true` döner; kaydın
**iptal edilmiş** olup olmadığına bakmaz. Storno + kapanış (`releaseSacks`) ya da `cancelShipment`
sonrasında aynı token ile gelen bir tekrar — mobil kuyruğun ya da zaman aşımının tekrarı — kullanıcıya
**"Sevkiyat kuruldu (onay bekliyor)"** der. İki kat yanlış: (1) sevkiyat kurulmadı, **iptal edildi**;
(2) "onay bekliyor" cümlesi `shipping.confirmationEnabled=false` rejiminde karşılığı olmayan bir
durumu tarif eder — operatörü, karosu hiç çizilmeyen "Sevk Kapısı" ekranına yönlendirir.

**Kanıt.**
- `Teks-Erp/src/services/shipping.service.ts:1362-1374`
  ```ts
  const sh = await prisma.shipment.findUnique({ where: { clientToken },
    select: { id: true, shipmentNo: true, status: true } });
  if (!sh) return null;
  const dispatched = sh.status === ShipmentStatus.DISPATCHED;
  return { success: true, data: { …, status: sh.status, dispatched },
    message: dispatched ? `Sevk edildi: …` : `Sevkiyat kuruldu (onay bekliyor): …` };
  ```
  `CANCELLED` dalı **yok** → "onay bekliyor" mesajına düşer.
- Çağrı yerleri: `:1383-1386` (istek başında) ve `:1440-1443` (P2002 yakalayıcı).
- İstemci: `mobil/src/screens/Modules/TartiPaket/PaketlemeScreen.tsx:286-311` — `onSuccess` dalında
  toast + `finishAndBack()`; `data.dispatched` false ise **"Sevkiyat kuruldu — Sevk Çıkışı'ndan onayla"**.
  `shipTokenRef.current` hata dalında **korunur** (doğru yapışma), yani tekrar aynı token'la gelir.
- Repoda **doğru emsal var**: `tambur-manual.service.ts:1039-1060` (`ENTRY_CANCELLED` 409),
  `subcontractor.service.ts:2356-2362` (`RECEIPT_CANCELLED`).
- **Koruma kontrolü:** `Shipment.clientToken` partial unique var (`schema.prisma`, K2b §1.2) — tekillik
  korunuyor, eksik olan **statü dalı**. `cancelShipment`/`undoDispatch` token'ı temizlemiyor
  (`grep -n "clientToken" src/services/shipping.service.ts` → 6 vuruş, hepsi create/replay yolunda).

**Çakışma senaryosu.** T1: tablet "Hemen Sevk Et" → sunucu sevkiyatı kurar+çıkarır ama yanıt ağda kaybolur
(5xx/timeout) → token **yapışır**. T2 (10 dk sonra): masaüstünde "yanlış sevkiyat" denip storno + kapatma
yapılır; çuvallar havuza döner. T3: tablet yeniden bağlanır ve **aynı token'la** tekrar gönderir →
`success:true`, "Sevkiyat kuruldu (onay bekliyor)". Operatör ekranı kapanır, işi bitmiş sayar.

**failure_mode.** Operatör 3 çuval / 640 m'yi kamyona yükler, tablette "Sevkiyat kuruldu" yeşilini görür
ve sevk evrakını beklemeye geçer. Sistemde o sevkiyat **CANCELLED**, çuvallar havuzda, irsaliye VOIDED.
Kimse hata görmez; mal ya evraksız çıkar ya da bir gün depoda "sevk edildi sanılan" çuval olarak durur.

**Veride fiili ihlal (K2).** Aranamadı (DB erişimi yok). Ölçüm sorgusu:
`SELECT count(*) FROM shipments WHERE "clientToken" IS NOT NULL AND status='CANCELLED';` (>0 ise
replay'in bu kaydı "kuruldu" diye döndürebileceği bir pencere fiilen vardır).

**Repro (K3).** `Teks-Erp/scripts/audit_repro_S-2-04.ts` **yazıldı** (tip kontrolü temiz) — dört kontrol:
ön koşul (sevkiyat gerçekten CANCELLED + mal çıkmadı), replay'in reddedilip reddedilmediği, mesajın
gerçeği söyleyip söylemediği, ve kardeş yol olarak **silinmiş çuvalın** `openSack` replay'i.
**Koşturuldu, ölçülemedi — ortam:** dev PostgreSQL kimlik doğrulamasını reddediyor
(`audit/repro/S-2-04.log`). Kardeş bekçi `audit_repro_D-B-01.ts` aynı sınıfı **KK1 topu ve sipariş** için
zaten kırmızı ölçmüştü (`audit/repro/D-B-01.log`: 2 kırmızı); `Shipment` o dosyada yoktu (K11 H-9).

**İş etkisi.** Sessiz "yapıldı" cevabı 409'dan kötüdür (beceri §8): kullanıcı doğrulama yapmaz.
Sevk evrakı/irsaliye beklentisi ile gerçek durum ayrışır.

**Öneri (2. tur için).** `readCreateShipmentReplay`e `CANCELLED` dalı: `AppError.conflict` +
`details.code = "SHIPMENT_CANCELLED"` (mobil kuyruk 4xx'te token'ı **bırakmalı** — `entryAttempt.ts`
sözleşmesi). `PLANNED` dalında mesajı rejime bağla (bayrak kapalıysa "planlı bekliyor" deme).
Aynı denetimi `openSack` replay'ine de uygula (silinmiş çuval). Migration/izin yok; APK gerekmez
(mobil zaten 4xx'i doğru ele alıyor), Electron metni güncellenir.

**Kabul kriteri.** `audit_repro_S-2-04.ts` 1) ve 4) kontrolleri yeşil; `test_shipment_idempotency.ts`
negatif sondayla (dal kaldırılınca kırmızı) `npm test`e girer.

**Efor.** 0,5 gün

**Önceki defter.** `BULGU-T1-006` (ayakta) — aynı sınıf, **farklı model**: orada `inventory.service.ts`
(KK1 topu) ve sipariş ölçülmüştü; `Shipment` K11 HOTSPOT-9'da "bekçisiz" olarak listelenmişti,
bu bulgu o boşluğu kapatır.

---

### [S-2-05] Muhasebe listesinin dönem BANDI satırlardan farklı anlık görüntüden okunuyor — kardeş yolda kapatılan yarış burada açık
| Şiddet | S3 | Kategori | A.1 / L (hesap tekrarı) | Öncelik | P3 | Modül | Sevkiyat raporlama | Kanıt seviyesi | K1 |

**Özet.** Sevkiyat listesinin **satır** toplamları (`attachTotals`) 2026-08-09 denetiminde
(`F-SEV-ESZ-002`) tek anlık görüntüye alınmıştı: batch `$transaction` + **RepeatableRead**, gerekçesi
kodda uzun uzun yazılı. Aynı brüt formülü kullanan **dönem bandı** (`buildShipmentListSummary`) ise
düz `Promise.all` ile **beş ayrı bağlantıdan, beş ayrı anlık görüntüden** okuyor. Bir iade ya da storno
tam o aralıkta commit ederse bandın toplamı ile satırların toplamı ayrışır.

**Kanıt.**
- `Teks-Erp/src/services/shipping.service.ts:2589-2612` — satır yolu (doğru):
  ```ts
  const [rollGroups, sackGroups, returnGroups] = await prisma.$transaction([...],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  ```
  Yorumda: *"`Promise.all` bunu SAĞLAMAZ — havuzdan AYRI bağlantılar, ayrı görüntüler."*
- `Teks-Erp/src/services/shipping.service.ts:2694-2717` — bant yolu (aynı formül, koruma yok):
  ```ts
  const [shipCount, rollAgg, sackAgg, returnAgg, directAgg] = await Promise.all([...]);
  const meters = (rollAgg._sum.currentQty ?? D0()).plus(returnAgg._sum.qty ?? D0())…
  ```
  Fonksiyon başlığı bile *"Metraj `attachTotals` ile AYNI brüt sözleşmesini taşır — yoksa banttaki toplam
  ile satırların toplamı tutmazdı"* diyor; sözleşme aynı, **izolasyon değil**.
- **Koruma kontrolü:** `withSummary=true` yalnız muhasebe ekranında (`:2697` yorumu); kilit/izolasyon yok;
  DB kısıtı ilgisiz.

**Çakışma senaryosu.** Muhasebeci `withSummary=true` ile listeyi yeniler → `rollAgg` okunur (canlı 501 m)
→ **bu arada iade commit eder** (top `shipmentId=null`, `RollReturn` satırı doğar) → `returnAgg` okunur
ve iadeyi **de** sayar → bant `501 + 49 = 550`, satırlar (RepeatableRead) `501`. Ters sıralamada iade
**kaybolur** ve bant satırlardan düşük çıkar.

**failure_mode.** Ağustos dönemi bandı "12 sevkiyat · 8.412 m" derken satırların toplamı 8.363 m çıkar;
Excel'e alınan rakam üçüncü bir değer olabilir. Muhasebeci hangisinin doğru olduğunu bilemez ve bu
**geçicidir** — ekranı yenileyince kaybolur, yani teşhis edilemez.

**Veride fiili ihlal (K2).** Yapısal olarak veride iz bırakmaz (gösterim yarışı) → aranmadı.

**Repro (K3).** Yazılmadı — kanıt kod düzeyinde kesin ve kardeş yolda **aynı ekip aynı gerekçeyi yazmış**.
İstenirse `attachTotals` ile `buildShipmentListSummary` arasına iade enjekte eden bir sonda kolaydır.

**İş etkisi.** Para yüzeyinde güven kaybı; hatalı mutabakat.

**Öneri (2. tur için).** `buildShipmentListSummary`nin beş sorgusunu tek batch `$transaction` +
`RepeatableRead` içine al (satır yoluyla birebir aynı desen; hepsi salt-okuma → P2034 riski yok).
`directAgg`ın null olabileceğine dikkat: batch dizisini koşullu kur.

**Kabul kriteri.** `grep -n "buildShipmentListSummary" -A 12` çıktısında `isolationLevel` görünüyor;
bekçi `test_shipment_list_gross.ts`e "bant = Σ satır" kontrolü eklenir.

**Efor.** 0,5 gün

**Önceki defter.** Yeni. `F-SEV-ESZ-002` (2026-08-09, düzeltilmiş) ile **aynı kök neden**; K7b haritası
bunu "muhasebe bandı ikizi" diye işaret etmişti, defterde satırı yoktu.

---

### [S-2-06] Storno'nun "sevkiyatı da kapat" kararı istemcide — alanı göndermeyen istemci rejime aykırı PLANNED sevkiyat ve kilitli çuval bırakıyor
| Şiddet | S3 | Kategori | F (API sözleşmesi) / E | Öncelik | P3 | Modül | Sevkiyat | Kanıt seviyesi | K1 |

**Özet.** `undoDispatch`in `releaseSacks` seçeneği **varsayılan `false`** ve kararı istemci veriyor;
sunucu rejimi (`shipping.confirmationEnabled`) **biliyor** ama alan gelmediğinde onu kullanmıyor.
Bayrak kapalı fabrikada bu, karosu hiç çizilmeyen bir ara duruma düşen sevkiyat ve **havuza dönmeyen,
başka sevkiyata konulamayan çuvallar** demektir — 2026-08-22'de tam bu sorun için alınan kararın
istemciye bırakılmış yarısı.

**Kanıt.**
- `Teks-Erp/src/services/shipping.service.ts:2145, 2150` —
  `opts: { releaseSacks?: boolean } = {}` → `const releaseSacks = opts.releaseSacks === true;`
- `Electron/src/pages/Operations/Shipments/UndoDispatchDialog.tsx:64` —
  `const release = releaseChoice ?? (p ? !p.confirmationEnabled : false);` (**doğru** varsayılan, ama
  yalnız güncel panelde).
- `CLAUDE.md` 2026-08-22: *"eski Electron `releaseSacks` göndermez → PLANNED, geriye uyumlu"* — geriye
  uyumluluk **bilinçli**; bu bulgu onun sonucunu adlandırıyor.
- Mobilde bu uç **hiç yok** (`mobil/src/services/packing.service.ts`de `undo-dispatch` geçmiyor) →
  tablet bu kararı veremez; ama `cancelShipment` (`:628`) ve `dispatchShipment` (`:621`) var.
- `Electron/src/pages/Operations/tile-config.ts:126-140` — karo bayrak kapalıyken çizilmiyor;
  PLANNED sevkiyatın tek erişim yolu Sevkiyatlar listesi/detayı.
- **Koruma kontrolü:** sunucuda rejime göre varsayılan **yok**; `getUndoDispatchPreview:2075` bayrağı
  yalnız **bilgi olarak** döndürüyor.

**failure_mode.** Fabrika `2.9.x` öncesi bir panelden (ya da doğrudan API'den) storno yapar. Sevkiyat
PLANNED'da kalır; 3 çuval `shipmentId` dolu olduğu için Paketleme ekranındaki havuzda **görünmez**,
`touchWarehouseSackTx` her içerik denemesini 409'lar, `removeSack` reddeder. Operatör "çuvallarım
kayboldu" der; çözüm ancak Sevkiyatlar detayından "İptal Et" ya da yeniden "Sevk Et" ile bulunur.
(Saha emsali kodda kayıtlı: `SVK2008260008`, çuval bir gün kilitli kaldı.)

**Veride fiili ihlal (K2).** Aranamadı (DB yok). Sorgu:
`SELECT s."shipmentNo", s."updatedAt", count(k.id) FROM shipments s JOIN sacks k ON k."shipmentId"=s.id WHERE s.status='PLANNED' GROUP BY 1,2;`

**Öneri (2. tur için).** Sunucuda rejim varsayılanı: `releaseSacks` **gönderilmemişse**
`!(await readShipmentConfirmationEnabled())` kullan (istemcinin açık `false`'u yine saygı görsün —
`undefined` ile `false` ayrımı sözleşmenin parçası olur). Yeni izin/migration yok; Electron zaten aynı
kararı veriyor, davranış değişmez.

**Kabul kriteri.** Bayrak kapalıyken `releaseSacks` alanı olmadan çağrılan `undo-dispatch` sevkiyatı
CANCELLED bırakıyor ve çuvallar havuza dönüyor; bekçi `test_shipment_undo_dispatch.ts`e kol eklenir
(negatif sonda: sunucu varsayılanı kaldırılınca kırmızı).

**Efor.** 0,5 gün

**Önceki defter.** Yeni.

---

## Uygulanan kontrol listesi (Bölüm 3 · senaryo merceğiyle)

| Madde | Durum |
|---|---|
| **A.1 check-then-act** | **uygulandı** → Y1-Y8 tablosu; `loadSacksForShipment`/`assertExportWeighed` (T1-084, mevcut) · `assertOrdersBelong` **(S-2-02)** · `computeSackAllocations` **(S-2-02/S-2-03)** · `weighSack`/`removeSack`/`scanIntoSack` claim'li ✔ |
| **A.2 lost update (denorm)** | **uygulandı** → `shippedQty` tek yazma noktası `recomputeOrderStatus`, kilit protokolü `touchOrderLinesTx`; sevkiyat yolları protokole **uyuyor** (`:1878`, `:1975`, `:2210`). İhlal eden çağıranlar sevkiyat dışında (D-A-02) |
| **A.3 JSON oku-değiştir-yaz** | **kapsam dışı** — sevkiyat/çuval/iade yollarında JSON kolonuna kısmi yazım yok (`PrintedDocument.snapshot` tam nesne olarak dondurulur) |
| **A.4 tx dışı yazma** | **uygulandı** → `setDispatchNote:1610`, `setShipmentInvoice:1635`, `setSackNotes:1712/:1723`, `setDirectShipmentInvoice:1669` havuz client'ıyla; hepsi tek-satır atomik claim, çok-adımlı akış ortasında değil → bulgu değil. `setShipmentInvoice`in 8023 almaması `BULGU-T1-083`te (ayakta) |
| **A.5 çok instance** | **kapsam dışı** — TEK PROCESS invariantı (künye); sevkiyatta process-local durum yok |
| **A.6 numara üretimi** | **uygulandı** → `nextShipmentNo` + `withBarcodeRetry` + `clientToken` P2002 predicate'i (`:1435`) doğru; çuval no `CV+GGAAYY+NNNN` aynı desen ✔ |
| **A.7/A.8 context & cache** | **uygulandı** → `readShipmentConfirmationEnabled`/`readShipmentUndoSameDayOnly` tx dışı okunuyor; etkisi dallanma, veri değil → bulgu yazılmadı (S2e'de tartışıldı) |
| **B.1 DB tekilliği** | **uygulandı** → `Sack.sackNo` unique, `(shipmentId, seq)` unique, `SackAllocation (sackId, orderLineId)` unique, `Shipment.clientToken` partial unique; `shipment_orders_active_order_uq` **bilinçli düşürülmüş** (INV-SEV-07) |
| **B.3 idempotency** | **uygulandı** → `createShipment` ✔ / `openSack` ✔ / `dispatchShipment` claim'li ✔ / `createReturn` token **yok** (BULGU-T1-149, elendi) / **replay statü dalı yok → S-2-04** |
| **B.4 watermark/kuyruk** | **kapsam dışı** — sevkiyatta kuyruk yok (mobil offline kuyruğu istemcide) |
| **C veri modeli** | **uygulandı** → `rolls_sackId_shipmentId_consistency_fkey` DEFERRABLE composite FK, `SackAllocation` Restrict FK, `Shipment.cancelledAt` **yok** (BULGU-T1-103); yetim taraması **yapılamadı** (DB yok) |
| **D tx sınırları** | **uygulandı** → dispatch/storno/iade birer iş birimi; belge dondurma **tx içinde** ✔; audit tx dışı (bilinçli); dış dünya çağrısı yok ✔ |
| **E sevkiyat değişmezleri** | **uygulandı** → "kalan miktar aşımı" (S-2-03, KYY-3-01) · "iade ≤ sevk" (kısmi iade yok, `RR.qty = currentQty` ✔) · "bir irsaliyeden iki kez fatura" (`setShipmentInvoice` atomik claim ✔, kapsam kilidi yok → T1-083) · "storno ≠ iade" ✔ · "iptal edilmiş talebe sevk" **(S-2-02)** |
| **E yetki/SoD** | **uygulandı** → `shipping:undo-dispatch` `shipping:write`i kapsamıyor ✔; atama tarafı `BULGU-T1-043`/`T2-012`de (bu turda yeniden açılmadı) |
| **F API** | **uygulandı** → toplu uçların kısmi başarısı: `createShipment` çuval döngüsü **hepsi-ya-hiç** ✔; `res.json` commit sonrası ✔; **sipariş kümesini düzenleyen uç YOK (S-2-01)** |
| **G güvenlik** | **kapsam dışı — S-2 senaryo alanı değil**; yalnız `dispatchShipment`/`undo-dispatch` izin ayrımı doğrulandı (`shipping.routes.ts:307/362`) |
| **H performans** | **kısmi** — `buildShipmentListSummary`nin 5 ayrı bağlantısı izolasyon açısından incelendi (S-2-05); maliyet boyutu Tur-1 H alanında |
| **I hata/gözlemlenebilirlik** | **uygulandı (sınırlı)** → tahsis defterine audit yok (`BULGU-T2-003`, yeniden açılmadı); `INV-SEV-08` için mutabakat sorgusu **yok** → S-2-03 önerisine bağlandı |
| **J migration** | **kapsam dışı** — bu turda şema değişikliği önerilmedi; `order_lines.cancelledAt`ın saha kopyasında olmaması S-2-02'de ön koşul olarak not edildi |
| **K bekçiler** | **uygulandı** → `KYY-2-02` / `KYY-3-01` / `KYY-3-02` logları okundu ve **sonuçları senaryoya bağlandı**; iki yeni repro yazıldı (S-2-01, S-2-04) |
| **L hesap tekrarı** | **uygulandı** → brüt kuralının 6 yüzeyi (`attachTotals` · `getShipmentById` · `collectShipmentDocContent` · `collectShipmentDerived` · `accounting-export` · `_shipped`) karşılaştırıldı; **formül aynı, izolasyon farklı → S-2-05** |

---

## Doğru yapılanlar (korunması gereken kalıplar)

1. **Çuval atama claim'i tek desen, istisnasız.** `createShipment:1413`, `addSacksToShipment:1552`,
   `reassignSackCustomer:378`, `weighSack:965`, `removeSack:1006`, `splitSack:832`, `moveRollsToSack:770`
   — hepsi `updateMany {id, shipmentId: null}` / `touchWarehouseSackTx` ile aynı satıra serileşiyor ve
   kaybeden tarafa **okunaklı Türkçe 409** dönüyor. Depo modelinde mühür/rezerv olmamasının bedeli tam
   olarak bu tek kilit noktasıyla ödenmiş.
2. **8023 kapsam kilidi ve SIRA disiplini.** `undoDispatch:2159` ve `createReturn:490` kilidi
   **tx'in ilk ifadesi** olarak alıyor; gerekçe (`shipment-locks.helper.ts:35-51`) üretilmiş bir vakayla
   birlikte yazılı: *"kilit, koruduğu OKUMADAN önce alınmalı"*. Bu, projedeki en iyi belgelenmiş
   eşzamanlılık kararı.
3. **Kilit altında taze hayalet assertion'ı.** `performDispatchTx:1834-1847` pre-tx kontrolü tekrar
   ediyor **ve** neden filtre değil hata olduğunu açıklıyor (filtre, hayaleti onarılamaz bir çıkmazda
   bırakırdı). "Pre-tx kontrol + kilit altında tekrar" deseninin doğru örneği burada.
4. **Storno ile iade ayrımının tek kaynağı.** `resolveUndoBlockReason:2021` önizleme ve mutasyon
   tarafından **aynı** çağrılıyor; ekranda "yapılabilir" derken uçta 409 veren ayrışma kapatılmış.
   `cancelPlannedShipmentTx:1961` de iki çağıranın tek gövdesi.
5. **Brüt kuralının tek gövdeden türetilmesi.** `collectShipmentDocContent:3488-3495` çuval satırı,
   ürün özeti ve çeki satırlarını **tek** `sacksGross` listesinden üretiyor ve iade dedup'ını canlı id
   kümesiyle yapıyor — "ikisini ayrı toplamak çift sayım üretirdi" gerekçesi kodda.
6. **Sevk öncesi raf hafızası (`preShipStatus`).** Gruplu flip (`:1856-1867`) 2. kalite topun sessizce
   1. kalite rafına yazılmasını engelliyor; storno simetrik (`:2191-2202`).

---

## Sınır ötesi notlar (ilgili denetçilere)

- **(→ V / veri alanı)** DB oturum boyunca erişilemedi; bu turda **hiçbir K2 ölçümü yapılamadı**.
  §"Kabul kriteri"lerinde verilen 5 sorgunun (`order_lines` iptal×sevk · tahsissiz DISPATCHED sevkiyat ·
  `shippedQty > quantity` · PLANNED+çuval · `clientToken` CANCELLED) saha kopyasında koşturulması
  gerekiyor.
- **(→ A / eşzamanlılık)** `writeShipmentAllocationsTx` ile `touchOrderLinesTx` arasındaki **sıra**
  (`:1352` yazım → `:1878` kilit) bu dosyadaki tek ters kilit sırasıdır; `order-status.helper.ts:26-30`
  docstring'i tam tersini talep ediyor ("kapasite TAZE okunmadan ÖNCE çağrılır"). Kural ile uygulama
  ayrışmış.
- **(→ F / API)** `mobil/src/services/packing.service.ts:548/552` — tablet PLANNED sevkiyata çuval
  ekleyip çıkarabiliyor, ama sevkiyatın **sipariş kümesini** hiçbir istemci düzenleyemiyor. Uç
  envanterinde "yazılan ama hiç düzenlenemeyen alan" sınıfı olarak işaretlenebilir.
- **(→ K / bekçiler)** `audit/repro/KYY-2-02.log` "5 geçti, 0 başarısız" veriyor ama bu **korumanın
  varlığını değil, pencerenin darlığını** ölçüyor; aynı değişmez `KYY-3-01`de kırmızı. İki logun
  birlikte okunmaması "INV-SEV-08 korunuyor" yanılgısı üretir — bekçi metnine bu not düşülmeli.
- **(→ G / güvenlik)** `readCreateShipmentReplay` `clientToken`ı **tek anahtar** olarak kullanıyor ve
  kullanıcı/cihaz kapsamı yok: başka bir kullanıcının token'ını tahmin/ele geçiren bir istemci o
  sevkiyatın `id`/`shipmentNo`/`status` bilgisini okuyabilir (UUID olduğu için pratik risk düşük, ama
  IDOR sınıfı).
- **(→ L / hesap tekrarı)** Brüt metrajın **altı** yüzeyi aynı formülü altı kez yazıyor; S-2-05'te
  ikisinin izolasyonu ayrıştı. Formülün tek yardımcıya çekilmesi (`grossShipmentMeters(db, ids)`)
  hem tekrarı hem izolasyon ayrışmasını kapatır.

---

## Kapsanmayan / erişilemeyen

1. **DB erişimi YOK (en büyük boşluk).** `audit/tools/sql-dev.sh` ve `sql-saha.sh` oturum boyunca
   `FATAL: Postgres.app failed to verify "trust" authentication — Postgres.app failed to show a dialog`
   ile düştü (Unix soketi, `localhost`, `127.0.0.1` üçü de denendi; sunucu süreci ayakta ama kimlik
   doğrulaması GUI onayı istiyor). Sunucuyu yeniden başlatmak **bilinçli olarak yapılmadı** — salt-okunur
   denetim yetkisinin dışında. Sonuç: **K2 seviyesi hiçbir bulguya verilemedi** (hepsi K1'de kaldı,
   S-2-01 Tur-2'nin ölçümüne dayanıyor) ve **K3 repro'ları koşturulamadı**.
2. **Yazılan iki repro (`audit_repro_S-2-01.ts`, `audit_repro_S-2-04.ts`) tip kontrolünden temiz geçti
   ama DB olmadığı için ölçüm üretmedi** — logları (`audit/repro/S-2-01.log`, `S-2-04.log`) bağlantı
   hatasını taşıyor. DB erişilir olur olmaz `cd Teks-Erp && npx tsx scripts/audit_repro_S-2-01.ts` ile
   koşulmalı. S-2-01'in B kolu `order_lines.cancelledAt` kolonunu gerektirir (script bunu açıkça kontrol
   edip anlamlı mesajla durur).
3. **Kartela (Swatch) tarafı** sevkiyat senaryolarında yalnız yüzeysel izlendi (`addKartelaToSack`,
   `removeSwatchFromSack` claim'leri okundu, ayrı senaryo kurulmadı) — kartela fasonu ayrı bir akış.
4. **Fasondan doğrudan sevk (`executeDirectShip`, `DirectShipment`)** yalnız tahsis çakışması açısından
   (aynı `OrderLine`a ikinci kaynak) değerlendirildi; sahada 0 kayıt olduğu için senaryo kurulmadı.
5. **`getPickList` / `checkSackMismatches` / `content-dump`** salt-okunur yüzeyler senaryoya girmedi.
6. **Electron/mobil UI'ın gerçek davranışı ölçülmedi** (uygulama çalıştırılmadı; `adb`/screenshot yok) —
   istemci iddiaları yalnız kaynak okumasına dayanıyor. `[VARSAYIM]`: masaüstü "Sevkiyat Kur" diyaloğu
   açık kaldığı sürece sipariş listesi yenilenmiyor (S-2-02'nin uzun penceresi); `useQuery`
   `refetchOnWindowFocus` ayarı denetlenmedi.
7. **`BULGU-T1-040` (cancelReturn 8023) yeniden AÇILMADI** — §S2d'de gösterildiği gibi `cancelReturn`in
   iki yazımı aynı transaction'da olduğu için ara durum doğmuyor ve bu turda ona ulaşan meşru bir akış
   bulunamadı. `KYY-3-02` [B] sondasının kurduğu durum **elle** kurulmuştur. Yeni kanıt yoktur.
8. **Şiddet notu:** hiçbir bulguya S0 verilmedi — brief'in kuralı gereği K2/K3 olmadan S0 yazılamaz ve
   bu turda ikisi de üretilemedi. S-2-01 ve S-2-02, K2 ile doğrulanırsa S0 adayıdır.
