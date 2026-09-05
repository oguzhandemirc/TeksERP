# K7a — Hesap & Birim Noktaları (çekirdek: stok / sevk / sipariş / fason) — HARİTA

Aşama ① KEŞİF · 2026-08-28 · dal `adnansahin`, HEAD `ce8681d1` · SALT-OKUNUR · yargı YOK, yalnız harita + HOTSPOT işareti.
Yollar repo köküne göre; `Teks-Erp/src/...` kısaltması `src/...`. Satır numaraları HEAD'deki dosyalardan (`sed -n`/`nl` ile) alındı.

**Kapsam:** metraj (m), kg, adet, en (cm) ve türetilmiş büyüklükleri HESAPLAYAN/YAZAN her nokta — `inventory` · `tambur` · `tambur-undo` · `tambur-manual` · `shipping` · `sack-search` · `return` · `order` (+`order-status`, `coverage`, `order-line-scope`, `allocation`, `production-balance`) · `subcontractor` (+`subcontractor-shrink`) · `batch` (+`batch-dispatch-surgery`) · `kartela` · `workorder` (+`workorder-link/split/manual-move/fason-quick`) · `roll-variance` · `roll-disposition` · `roll-finalize` · `tambur-plan-gate`.
**Kapsam dışı (K7b'ye):** `src/services/reports/*`, `document-render/*` (yalnız formatlayıcı tarandı), etiket alan değerleri, Electron/mobil istemci hesapları (yalnız mobil `resolveReturns` okundu — görev metni onu adlandırdığı için).

**Yöntem:** (1) şemadan Decimal/Int alan envanteri; (2) hedef dosyalarda `Number(`/`.toNumber()`/`parseFloat`/`Math.round|floor|ceil`/`toFixed`/`Decimal` op grep'i (sayılar §1.4); (3) her vuruşun bağlamı okundu; (4) yazma noktaları (`currentQty:`/`initialQty:`/`qtyOut:`/`shippedQty:`/`recordVarianceTx`) ayrıca grep'lendi; (5) prod kopyası `tekserp_saha_0825` üzerinde salt-okunur invariant sayımları (§7); (6) dev DB'de `numeric(12,3)` yuvarlama davranışı ölçüldü.

---

## 0. Özet (10 cümle)

1. Depolama tipi **tek**: tüm miktar/en/kg alanları `Decimal @db.Decimal(12,3)` (48 Decimal alan, **Float 0**); adetler `Int`. Sunucu çıkışında **global monkey-patch** `Decimal.prototype.toJSON = Number(this)` (`src/utils/json-replacer.ts:22-25`, `src/app.ts:25`) — yani her yanıtta Decimal→number dönüşümü zaten kaçınılmaz; koddaki `Number(...)`ların büyük çoğunluğu bu serileştirmeyi **öne alan** çıktı biçimlendirmesidir.
2. Çekirdek muhasebe (`currentQty` düşüm/artım, `shippedQty` defteri, `SackAllocation`, `RollVariance`, çekme dağıtımı, kapsama/denge) **Decimal aritmetiğiyle** yazılmış; `Number()` sonrası aritmetik yapan **15 nokta** var (§3.1) — çoğu görünüm toplamı, ikisi (`inventory:2078`, `workorder:2491`) rakam üreten yüzey.
3. Yuvarlama politikası **yazılı değil, dağınık**: DB `numeric(12,3)` sessiz yarım-yukarı yuvarlar (ölçüldü: `1.2345→1.235`), Zod'da ondalık kısıtı **yok** (§1.3), Decimal.js varsayılanı (precision 20, ROUND_HALF_UP) hiçbir yerde ayarlanmamış; açık yuvarlama yalnız 6 yerde (§5).
4. Aynı büyüklük birden çok yerde hesaplanıyor: **"açık = istenen − sevk"** 13 noktada (bazısı `max(0,…)` kelepçeli, biri `floor()`, biri DB-tarafı `gt`), **spec eşleşmesi** 5 farklı semantikle, **çuval toplam metrajı** 6 yerde (ikisi hayalet-süzgeçsiz), **en eşitliği** 3 semantikle (Decimal.equals / Number `!==` / ±10 cm) — §4.
5. `qtyOut` sözleşmesi ("storno=0 / dispozisyon=qtyIn", `roll-disposition.helper.ts:334-337`) dışında **üçüncü bir hal** var: `NULL` bırakan üç kapanış (`workorder-manual-move:649`, `workorder-split:369/486`, `subcontractor:2071-2083`); prod kopyasında 14 satır.
6. Tambur geri alma tek kaynak (`computeRestoredQty`) üzerinden, ama FULL `currentQty: restored` **SET** ederken SINGLE `increment` ediyor ve `initialBump` formülü iki dalda farklı (§2.C, HOTSPOT #1).
7. Fason kabul: kısmi kabul `receivedQty`, çekme `bornDiff = Σborn − Σconsumed` (eşik 0.01 m), dağıtım `allocateShrink` (satır `toDecimalPlaces(3)` + artık son satıra → toplam korunur). Kalan dağıtımı (`resolveReturns`) **mobilde** (`round2`, büyük toptan) — sunucu yalnız satır bazlı `receivedQty` alır.
8. Sipariş defteri **defter-otoritatif**: `OrderLine.shippedQty = Σ SackAllocation.qty (DISPATCHED) + Σ DirectShipAllocation.qty` her olayda yeniden hesaplanır (`order-status.helper.ts:48-81`), `Order.shippedQty = Σ satır`; prod kopyasında **drift 0/281 satır, 0/278 başlık**, tahsis > çuval metrajı 0/34.
9. Birim varsayımları: her şey **metre**; `weightKg` top düzeyinde prod'da **hiç dolu değil** (0/2431), çuval kg'sı şemada "brüt (kumaş+dara)" ama ambalaj belgesinde `netKg` adıyla basılıyor (`shipping:3646`); en cm (prod'da tamamı tam sayı), Zod en tavanları 1 000 / 999 999 / 999 999 999 / 100 000 arasında değişiyor.
10. Prod kopyasında kod dışı görünen iki olgu: `currentQty > initialQty` 2 satır (bilinen §13 vakası, her ikisi `SUBCONTRACTOR_RETURN`), **0/0 m canlı `WAREHOUSE` top 2 adet** (`T190826F0119/F0120` — tam-metraj depo kesiminden kalan parent, `finalizeWarehouseCut` çağrılmamış; §7, HOTSPOT #2).

---

## 1. Tip temeli

### 1.1 Şema — Decimal alanlar (48; `prisma/schema.prisma`)

| Model.alan | Ölçek | Şema yorumu / birim | Kim yazar (çekirdek) |
|---|---|---|---|
| `Roll.initialQty` | (12,3) | "Initial measurement (meters)" | KK1 giriş, kurşun finish, kesim çocukları, fason doğan top, undo bump, manuel düzeltme |
| `Roll.currentQty` | (12,3) | "Remaining/net quantity" (m) | kesim decrement, finalize 0, kısmi kabul decrement, undo increment/SET |
| `Roll.weightKg` | (12,3) | kg | KK1 (opsiyonel), fason doğan top; **prod: 0/2431 dolu** |
| `Roll.width` | (12,3) | "En (cm) — KK1 girişinde ölçülen" | KK1, düzeltme, kesim çocukları (parent/WO'dan), fason doğan top |
| `Roll.preTamburCloseQty` | (12,3) | kapanış anındaki `currentQty` (adli iz) | tambur finalize ×3 |
| `Order.totalAmount` | (14,2) | para | `computeTotalAmount` |
| `Order.shippedQty` | (12,3) | m | `recomputeOrderStatus` |
| `OrderLine.quantity` | (12,3) | "Requested quantity (meters)" | sipariş create/replace (istemci sayısı) |
| `OrderLine.shippedQty` | (12,3) | m | `recomputeOrderStatus` (yalnız burası) |
| `OrderLine.unitPrice` | (12,2) | para | sipariş |
| `OrderLine.width` | (12,3) | "İstenen en (cm)" | sipariş |
| `OrderLine.pieceLengthM` | (12,3) | m/parça — **hiçbir hesapta kullanılmıyor**, yalnız gösterim (`tambur.service.ts:3665`) | sipariş |
| `WorkOrder.width` | (12,3) | "En (cm)" | WO form, `changeWidth` (fason kabul ölçümü) |
| `WorkOrder.targetQuantity` / `targetWeight` | (12,3) | "Hedef uzunluk/metraj" / "kg" — **hiçbir hesapta kullanılmıyor** (yalnız saklama: `workorder.service.ts:1017-1018/4816-4817/5516-5517`) | WO form |
| `WorkOrderToOrderLine.allocatedQty` | (12,3) | "Metraj/kg cinsinden tahsis" — **her zaman 0 yazılıyor** (`workorder-link.service.ts:377`, `workorder.service.ts:743/747`); `coverage.helper.ts:9-13` pro-rata modelin kaldırıldığını söylüyor → ölü alan | link |
| `RollError.startMeter` | (12,3) | m (0..currentQty) | KK2/tambur hata |
| `RollVariance.qty` | (12,3) | "HER ZAMAN POZİTİF" (CHECK) | `recordVarianceTx` (tek yazıcı) |
| `RollPlanDeviation.qtyM` | (12,3) | m | plan-gate |
| `RollMovement.qtyIn/qtyOut/weightIn/weightOut` | (12,3) | istasyon giriş/çıkış m, kg | hareket aç/kapa (§2.E) |
| `SubcontractorDispatch.totalQty` | (12,3) | "Toplam sevk edilen metraj (snapshot)" | sevk create Σ, merge/split yeniden Σ, iptal → 0 |
| `SubcontractorDispatchItem.dispatchedQty/dispatchedWeight` | (12,3) | m / kg | sevk |
| `SubcontractorDirectShipAllocation.qty` | (12,3) | m | doğrudan sevk |
| `DirectShipment.totalQty` | (12,3) | m (+ `rollCount Int`) | doğrudan sevk |
| `SubcontractorReceipt.appliedWidth` | (12,3) | cm | kabul |
| `SubcontractorReceiptItem.receivedQty` | (12,3) | "Bu makbuzun BU TOPTAN kabul ettiği metraj"; NULL = eski kayıt (**prod: 635/638 NULL**) | kabul |
| `Swatch.width/length/weightKg` | (12,3) | cm / cm / kg | kartela kabul |
| `KartelaDispatch.totalQty`, `KartelaDispatchItem.dispatchedQty/dispatchedWeight` | (12,3) | m / kg | kartela sevk |
| `Sack.weightKg` | (12,3) | "**Brüt** tartı (kumaş + dara)" | tartı |
| `SackAllocation.qty` | (12,3) | "çuvalın satıra düşürdüğü metraj" | `writeShipmentAllocationsTx` |
| `RollReturn.qty/width` | (12,3) | "İade anındaki currentQty" / cm | iade |
| `ProductRecipe.width`, `PeripheralDevice.scale/labelWidthMm/…`, `LabelTemplate*.…Mm` | — | çekirdek dışı (cihaz/etiket) | — |

**Int adet alanları:** `DirectShipment.rollCount`, `SwatchStockReduction.count`, `KartelaReceiptItem.kartelaCount` (+ sayaç/sürüm alanları). **Float alan: 0.**

### 1.2 Sınır davranışları (ölçülmüş / okunmuş)

| Sınır | Davranış | Kanıt |
|---|---|---|
| DB'ye yazım | `numeric(12,3)` fazla ondalığı **sessizce yarım-yukarı** (sıfırdan uzağa) yuvarlar: `1.2345→1.235`, `1.2355→1.236`, `-1.2345→-1.235`, `0.0005→0.001` | dev DB ölçümü (`sql-dev.sh`) |
| HTTP giriş | Zod: `z.number().positive()` + üst sınır; **ondalık basamak kısıtı YOK** (`multipleOf`/`step` 0 vuruş) | `src/controllers/inventory.controller.ts:23-26,151`, `tambur.controller.ts:76,81,133`, `subcontractor.controller.ts:85,119,150,159-160`, `shipping.controller.ts:15,28`, `workorder.controller.ts:24,268,272,279,298`, `tambur-manual.controller.ts:87,113`, `kartela.controller.ts:24`, `routes/order.routes.ts:21,572` |
| HTTP çıkış | `Decimal.prototype.toJSON` → `Number(this)`; yorum "tekstil metraj/ağırlık IEEE 754'e kayıpsız sığar; para kritik alan yok" | `src/utils/json-replacer.ts:15-25`; `src/app.ts:22-25` |
| Cursor | Decimal sıralama anahtarı `String(v)` + tag `n` | `src/utils/cursor.ts:248-256` |
| Decimal.js | `Decimal.set/config` **hiç yok** → varsayılan precision 20, ROUND_HALF_UP; `toDecimalPlaces(3)` yalnız `subcontractor-shrink.helper.ts:64` | grep 0 vuruş |
| DB CHECK | `rolls.currentQty/initialQty/weightKg ≥ 0`, `order_lines.quantity > 0`, `order_lines.shippedQty ≥ 0`, `sacks.weightKg ≥ 0` (migration `20260708120000`, **NOT VALID**); `roll_movements.qtyIn/qtyOut/weightIn/weightOut ≥ 0`, `roll_errors.startMeter ≥ 0`, `sack_allocations.qty > 0`, `subcontractor_direct_ship_allocations.qty > 0`, `work_order_to_order_lines.allocatedQty ≥ 0`, `subcontractor_dispatch_items.dispatchedQty > 0`, `kartela_dispatch_items.dispatchedQty > 0`, `kartela_receipt_items.kartelaCount > 0`, `swatch_stock_reductions.count > 0`, `direct_shipments.totalQty > 0 / rollCount > 0`, `roll_returns.qty > 0` (`20260731120000`, NOT VALID); `roll_variances.qty > 0` (`20260809015353:52`). **`currentQty ≤ initialQty` CHECK'i YOK** (yalnız `test_consistency §13`). Bekçi envanteri: `scripts/test_db_invariants.ts:197-211` |
| Raw SQL toplam | `SUM(numeric)` → `Prisma.Decimal` (adapter-pg; "ölçüldü" yorumu `subcontractor.service.ts:3800`); `SUM(...)::float` → number (`inventory.service.ts:2037,2057`) | okundu |

### 1.3 İstemci tarafı ondalık üretimi (bağlam; K-mobil/Electron)

- Mobil KK1: metre cihazı `parseMeterReading(..., {scale, decimals})` varsayılan `decimals=1` (`mobil/src/services/hal/meter.codec.test.ts:4,34` — `123.45→123.5`); elle giriş `Number(manualQty)` yuvarlamasız (`mobil/src/screens/Modules/KK1/KK1Screen.tsx:1345`); simülasyon `Math.round(x*10)/10` (:1235).
- Mobil fason kabul: `round2` + `QTY_EPSILON=0.01` (`mobil/src/screens/Modules/FasonKabul/receivePayload.helper.ts:86-88`).
- Electron: metraj alanlarında `step=` kısıtı bulunamadı (yalnız mm/etiket alanlarında `step={0.5}`) → serbest ondalık [VARSAYIM: `type=number` alanı 4+ basamak kabul eder].
- Prod kopyası: `rolls.currentQty` 1 ondalıklı 382, 2 ondalıklı 2, **3 ondalıklı 0**; `order_lines.quantity` tamamı tam sayı; `rolls.width` tamamı tam sayı (§7).

### 1.4 Grep sayıları (hedef dosyalar; `--include='*.ts'`)

`src` geneli: `Number(` **585** · `.toNumber()` 22 · `parseFloat` 6 · `Math.round` 114 · `Math.floor` 71 · `Math.ceil` 30 · `toFixed` 33 · `Decimal` 397 · `new Prisma.Decimal(` 184 · `Prisma.Decimal.min/max` 17.

| Dosya | `Number(` | `toNumber` | `parseFloat` | round/floor/ceil/toFixed | Decimal op |
|---|---|---|---|---|---|
| inventory.service.ts (4849 s.) | 26 | 2 | 2 | 4 | 11 |
| tambur.service.ts (3756) | 29 | 5 | 0 | 0 | 11 |
| tambur-undo.service.ts (1732) | 14 | 0 | 0 | 0 | 20 |
| tambur-manual.service.ts (1508) | 10 | 0 | 0 | 0 | 0 |
| shipping.service.ts (3698) | 48 | 0 | 0 | 3 | 43 |
| sack-search.service.ts (588) | 12 | 0 | 0 | 0 | 0 |
| return.service.ts (1142) | 4 | 0 | 0 | 0 | 2 |
| order.service.ts (3434) | 26 | 9 | 0 | 2 | 34 |
| subcontractor.service.ts (6818) | 40 | 0 | 0 | 5 | 19 |
| workorder.service.ts (6627) | 28 | 0 | 0 | 1 | 10 |
| kartela.service.ts (1546) | 4 | 0 | 0 | 3 | 1 |
| batch.service.ts (966) | 0 | 0 | 0 | 0 | 0 |
| helpers: allocation / coverage / shrink / roll-variance / order-status / production-balance | 0 | 0 | 0 | 0 | 15 / 3 / 8 / 3 / 6 / 18 |

Bu vuruşların Decimal alanlarla kesişimi §3'te ayıklandı (K7a alanında ~150 vuruşun **15'i** dönüşüm-sonrası aritmetik, **9'u** dönüşüm-sonrası karşılaştırma, gerisi çıktı/sayım/sayfalama).

---

## 2. Hesap Noktaları Envanteri

Sütunlar: **Formül** (düz yazı) · **Birim** · **Yuvarlama** (nerede) · **Tip** (şemadan) · **D→N** = Decimal→Number dönüşümü (Ç=çıktı için, K=karşılaştırma, A=dönüşümden SONRA aritmetik) · **Tek kaynak?**

### 2.A Envanter / KK1 / kurşun (`src/services/inventory.service.ts`)

| # | Konum | Formül | Birim | Yuvarlama | Tip | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|
| A1 | `:912-913` `createInitialEntry` | `initialQty = currentQty = data.initialQty` (istemci sayısı) | m | DB'de `numeric(12,3)` sessiz | number→Decimal | — | evet (tüm girişler buradan: KK1, tambur-manual `:1062/:1411`) |
| A2 | `:844-880` mükerrer tuzağı | twin `where.initialQty = new Decimal(data.initialQty)` (HAM), `width = data.width` | m, cm | yok — DB'deki değer 3 ondalıklı | Decimal eşitlik (SQL) | — | kilit anahtarı `duplicate-guard.helper.ts:68-69` **`toFixed(3)`** ile, sorgu ham → aynı girdi için iki farklı yuvarlama (HOTSPOT #3) |
| A3 | `:978` P2002 replay | `sameQty = Decimal(data.initialQty).equals(existing.initialQty)` | m | yok (ham vs DB-yuvarlanmış) | Decimal | K | HOTSPOT #3 |
| A4 | `:1663-1665`, `:1704-1706` Kanban kartları | `Σ currentQty` (Decimal reduce) → `.toNumber()` | m | — | Decimal→number | Ç | — |
| A5 | `:1733-1738` sevk kolonu | `groupBy _sum(weightKg)`, `_sum(currentQty)` → `Number` | kg, m | — | Decimal→number | Ç | — |
| A6 | `:1859-1880` `getRollStats` | `Σ _sum.currentQty`, `Σ _sum.weightKg` (Decimal) → `Number` | m, kg | — | Decimal | Ç | — |
| A7 | `:1902-1910` `getRollStatsBatch`, `:1931-1942` `getWarehouseScope` | `aggregate _sum.currentQty` → `Number(… ?? 0)` | m | — | Decimal | Ç | — |
| A8 | `:1964` `getRollSubcontractorSummary` (`:2037`, `:2057` raw SQL `SUM("currentQty")::float`) | satır: `round1 = Math.round(x*10)/10` (`:2066`); toplam: `Math.round((acc+c)*10)/10` **yuvarlanmış satırların toplamı yeniden yuvarlanır** (`:2075-2081`) | m | **SQL float + JS 1 ondalık, satır VE toplam** | float | **A** | tek yüzey (fasondaki stok özeti) |
| A9 | `:3233-3244` `softDelete` hareket kapanışı | `qtyOut = isScrap ? (m.qtyIn ?? currentQty) : 0`; `weightOut = isScrap ? (weightIn ?? weightKg) : 0` | m, kg | yok | Decimal | — | sözleşme `roll-disposition.helper.ts:334-337` ile aynı (kopya değil, paralel yazım) |
| A10 | `:3253-3260` iptal claim | `sackId = shipmentId = null`, metraj **dokunulmaz** (CANCELLED top `currentQty` taşımaya devam eder) | m | — | — | — | K18/SACK_ABSENT süzgeçleri bunu dışlar |
| A11 | `:3585-3594` arşiv kapanışı | `qtyOut = 0`, `weightOut = 0`, not `ARCHIVED` | m | — | — | — | — |
| A12 | `:3777-3791`, `:3862-3869`, `:3901-3905` `applyManualProperties` | `width > 0`; `rollWhole = initialQty.equals(currentQty)` şartıyla `initialQty = currentQty = data.currentQty`; `widthChanged = data.width !== Number(roll.width)` (number), `metrajChanged` Decimal.equals | cm, m | yok | Decimal / number | K (`:3901-3902`) | tek düzeltme yolu (2026-07-30 kararı) |
| A13 | `:4166-4180` açık kumaş açma (kurşun tablet) | top `initialQty = currentQty = 0` doğar; ölçüm kurşun finish'te | m | — | — | — | — |
| A14 | `:4402-4418` `rescueStuckRoll` kapanış | `qtyOut = qtyIn > 0 ? qtyIn : currentQty`; `weightOut = weightIn ?? weightKg` | m, kg | — | Decimal | — | tambur `:1169-1172/:3320-3323` ile aynı kural (üç kopya) |
| A15 | `:4600-4619` `finishProcessQc` | `totalMeters = data.totalMeters ?? Number(currentQty)`; `0 ≤ startMeter ≤ totalMeters` | m | yok | number | **A/K** (`:4605`, `:4615`) | — |
| A16 | `:4683-4689` | `initialQty = currentQty = totalMeters` (kurşun ölçümü **girişi de ezer**) | m | DB sessiz | number→Decimal | — | — |
| A17 | `:4760-4773` | hareket `qtyOut = totalMeters` (atomik claim) | m | — | — | — | — |
| A18 | `:88-89` filtre | `parseFloat(min/max)` (liste aralık filtresi) | m | — | — | — | — |

### 2.B Tambur kesim / finalize (`src/services/tambur.service.ts`)

| # | Konum | Formül | Birim | Yuvarlama | Tip | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|
| B1 | `:678`, `:735-753` `finalize` (klasik karar) | `totalQty = Number(currentQty)` (yalnız `qtyOutD` fallback'i için); `cumulativeLenD = Σ c.length` (Decimal); `cumulativeLenD > totalQtyD` → aşım (bayrak `tambur.overQuantityEnabled`, **varsayılan AÇIK** `system-setting.service.ts:2106-2118`; prod'da satır yok → açık) | m | yok | Decimal (girdi `c.length` number) | Ç/K | — |
| B2 | `:865-899` segment hesabı | `start/end = offsetD.toNumber()`; `qty = c.length`; kalan kuyruk `remaining = (totalQtyD − offsetD).toNumber()` yalnız `offsetD < totalQtyD` ise | m | yok | Decimal→number (**çocuk `initialQty` bu number'dan**) | Ç | — |
| B3 | `:985` | taze `currentQty.equals(totalQtyD)` (bayat metraj kilidi) | m | — | Decimal | K | — |
| B4 | `:1043-1053` finalize çocukları | `initialQty = currentQty = seg.qty`; **`width = wo?.width ?? roll.width`** (PLAN eni; diğer üç kesim yolu `parent.width` yazar — HOTSPOT #10) | m, cm | — | — | — | hayır — çocuk `width` kaynağı yollar arasında farklı |
| B5 | `:1165-1187` hareket kapanışı | `qtyOut = qtyIn > 0 ? qtyIn : totalQty`; `weightOut = roll.weightKg` | m, kg | — | Decimal | — | A14/B13 ile aynı kural |
| B6 | `:1191-1200` parent emekli | `currentQty = 0`, `preTamburCloseQty = totalQtyD` | m | — | — | — | — |
| B7 | `:1269-1276` aşım defteri | `OVERAGE qty = overageOf(cumulativeLenD, totalQtyD) = max(0, cut − recorded)` (`roll-variance.helper.ts:88-97`) | m | yok | Decimal | — | `overageOf` tek kaynak (3 çağrı: B7, B10, B12) |
| B8 | `:1687-1697` kartela uzunluk özeti | `totalLength = Number(_sum(Swatch.length))` | **cm** (Swatch.length cm) — alan adı "length", birim yorumu yok | — | Decimal | Ç | — |
| B9 | `:1756` `reportError` | `startMeter > Number(currentQty)` → 400 | m | — | number K | K | A15 ile aynı kural (iki yazım) |
| B10 | `:2096-2101`, `:2142-2143`, `:2235-2248`, `:2260-2271` `cutWarehouseRoll` | `exceedsRemaining = cutLength > Number(parent.currentQty)`; çocuk `initialQty = currentQty = cutLength`, `width = parent.width`; parent: aşımda `{currentQty:0, initialQty:0}` (statü **değişmez**), değilse `decrement` ikisi de (`gte` guard); `newParentQty = Number(...)`; OVERAGE `overageOf(cutLength, parent.currentQty)` | m, cm | yok | number K / Decimal decrement | K, Ç | — |
| B11 | `:2486-2508`, `:2581-2603` `finalizeWarehouseCut` | `remainingQty = Number(fresh.currentQty)`; kalan çocuk `initialQty = currentQty = remainingQty` (**number**), `width = parent.width`; parent `currentQty = 0`, `preTamburCloseQty = new Decimal(remainingQty)`; sapma `qty = remainingQty` (SCRAP/RECORD_CORRECTION, `TAMBUR_WAREHOUSE_FINALIZE`) | m | Decimal→number→Decimal (kayıpsız: DB 3 ondalık) | — | Ç→yazım | — |
| B12 | `:2747-2752`, `:2806-2811`, `:2925-2938`, `:2950-2965` `cutOpenFabric` | `exceedsRemaining = lengthMeters > Number(parent.currentQty)`; çocuk `width = parent.width`, qty `lengthMeters`; parent aşımda `currentQty = 0` (**`initialQty` dokunulmaz** — B10'dan fark), değilse `decrement currentQty` (**yalnız currentQty**; `gte` guard); OVERAGE `overageOf(lengthMeters, parent.currentQty)` | m | yok | number K / Decimal | K, Ç | hayır — B10 ile "iki alanı mı bir alanı mı düş" asimetrisi **bilinçli** (`tambur-undo:1278-1287` yorumu) |
| B13 | `:3129`, `:3218-3243`, `:3300-3337`, `:3372-3383` `finalizeOpenFabric` | plan kapısı `Number(parent.currentQty) > 0`; `remainingQty = Number(fresh.currentQty)`; kalan çocuk qty `remainingQty`, `width = parent.width`; parent `currentQty = 0`, `preTamburCloseQty`; hareket `qtyOut = qtyIn > 0 ? qtyIn : parent.initialQty` (**B5/A14'ten fark: fallback `initialQty`**, yorum `:3309-3311`); sapma `qty = remainingQty` (`TAMBUR_FINALIZE`); plan sapması `qtyM = remainingQty` | m | yok | number | K, Ç | hayır — `qtyOut` fallback üç yerde üç farklı (`totalQty` / `currentQty` / `initialQty`) |
| B14 | `:3662-3665` sipariş satırı görünümü | `orderedQty = Number(quantity)`, `pieceLengthM = Number(...)` — **adet türetme YOK** | m | — | — | Ç | — |

### 2.C Tambur geri alma (`src/services/tambur-undo.service.ts`)

| # | Konum | Formül | Birim | Yuvarlama | Tip | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|
| C1 | `:204` `childBlockReason` | `currentQty.equals(initialQty)` değilse "kısmen tüketilmiş" | m | — | Decimal | K | — |
| C2 | `:339-378` `computeRestoredQty` | `restored = Σ child.initialQty + Σ RollVariance.qty (RECORD_CORRECTION, source ∈ {TAMBUR_FINALIZE, TAMBUR_WAREHOUSE_FINALIZE}, reversedAt null, rollId=parent) + Σ RollVariance.qty (RECORD_CORRECTION, TAMBUR_UNDO_SINGLE, roll.parentRollId=parent)` — `preTamburCloseQty` **bilerek kullanılmaz** (`:20-42`) | m | yok | Decimal | — | **evet** — önizleme (`:788`, `:810`) ve uygulama (`:1507`) aynı fonksiyon; **senkron sözleşmesi**: buraya giren her kaynak `applyFull` 5b terslemesine (`:1610-1635`) de girmeli |
| C3 | `:553`, `:652`, `:802`, `:843-856`, `:866` önizleme | `Number(child.initialQty)`, `Number(restored)`, `Number(parent.*)` | m | — | Decimal | Ç | — |
| C4 | `:1085-1108` `applySingle` — kaynak arşivde | `RECORD_CORRECTION qty = len = child.initialQty`, `source TAMBUR_UNDO_SINGLE`, sebep `YANLIS_TOP`; metraj **kaynağa dönmez** | m | — | Decimal | — | — |
| C5 | `:1124-1152` `applySingle` — üretim dalı | `newCurrent = parent.currentQty + len`; `initialBump = max(0, newCurrent − parent.initialQty)` → OVERAGE(`TAMBUR_UNDO_RESTORE`); `currentQty += len`, `initialQty += initialBump` (claim `IN_PRODUCTION` + adım) | m | — | Decimal | — | HOTSPOT #1: bump formülü C7/C8'den **farklı biçimde** yazılmış |
| C6 | `:1157-1168` `applySingle` — depo dalı | `currentQty += len`, `initialQty += len` (aşım koruması **yok**, bilinçli: depo kesimi ikisini birden düşmüştü) | m | — | Decimal | — | — |
| C7 | `:1288-1345` `applySingleFromArchive` | `newCurrent = parent.currentQty + restored`; `initialBump = stepId && newCurrent > initial ? newCurrent − initial : 0`; hareket yeniden aç (`qtyIn = restored` yoksa); revive claim `TAMBUR_CONSUMED` → `currentQty += restored`, üretim: `initialQty += bump`, depo: `initialQty += restored` | m | — | Decimal | — | — |
| C8 | `:1503-1532`, `:1536-1551`, `:1560-1578` `applyFull` | `restored = computeRestoredQty(tx)`; `initialBump = max(0, restored − parent.initialQty)` (**`currentQty` hesaba katılmaz** — TAMBUR_CONSUMED'da 0 varsayımı) → OVERAGE(`TAMBUR_UNDO_FULL`); hareket `qtyIn = restored`; revive: **`currentQty = restored` (SET)**, `initialQty += bump`, `preTamburCloseQty = null` | m | — | Decimal | — | HOTSPOT #1: C5/C7 `increment`, C8 `SET` |
| C9 | `:1610-1635` sapma tersleme | `reversedAt` işareti: rollId=parent ∧ source ∈ {TAMBUR_FINALIZE, WAREHOUSE_FINALIZE}; + çocuk kapsamlı `TAMBUR_UNDO_SINGLE`; **OVERAGE satırları bilerek dışarıda** (`:1607-1609`) | — | — | — | — | C2 ile senkron sözleşmesi |
| C10 | `:1170`, `:1390`, `:1685` | `restoredLen/restoredQty: Number(...)` | m | — | Decimal | Ç | — |

### 2.D Tambur manuel (`src/services/tambur-manual.service.ts`)

| # | Konum | Formül | Birim | Tip | D→N | Not |
|---|---|---|---|---|---|---|
| D1 | `:928`, `:1354` | `input.initialQty > 0` | m | number | — | Zod `tambur-manual.controller.ts:113` `max(999_999)` |
| D2 | `:1062-1066`, `:1411-1415` | `createInitialEntry(initialQty: input.initialQty)` → A1 | m | — | — | tek giriş motoru |
| D3 | `:1074` | `width = input.width ?? Number(step.workOrder.width)` (plan eni) | cm | Decimal→number | Ç→yazım | B4 ile aynı "plan eni" yaklaşımı |
| D4 | `:1138`, `:1178` | hareket `qtyIn = fresh.currentQty` | m | Decimal | — | — |
| D5 | `:335`, `:1223-1225`, `:1253`, `:1472-1474`, `:1497` | `Number(currentQty/initialQty/weightKg/width)` | — | — | Ç | — |

### 2.E Hareket (RollMovement) açılış/kapanış — `qtyIn`/`qtyOut` sözleşmesi (çapraz)

| Olay | Konum | `qtyIn` | `qtyOut` | `weightOut` |
|---|---|---|---|---|
| Adıma giriş (generic) | `helpers/roll-step.helper.ts:250` | `qty` (çağıran verir) | — | — |
| İş emrine bağlama | `workorder.service.ts:4534` | `r.currentQty` | — | — |
| Manuel taşıma | `workorder-manual-move.service.ts:655-656` | `r.currentQty` / `weightIn = weightKg` | **kapanış `:649`: yalnız `exitedAt` → `qtyOut` NULL** | NULL |
| Tebdil (split) | `workorder-split.service.ts:375/492` | `r.currentQty` | **`:369/:486` yalnız `exitedAt` → NULL** | NULL |
| Fason sevk çocuğu | `subcontractor.service.ts:581`, `:1347` | `shipQty` / `r.currentQty` | — | — |
| Fason sevk iptali | `subcontractor.service.ts:2071-2083` (raw UPDATE) | — | **yalnız `exitedAt` → NULL** | NULL |
| Fason doğan top | `subcontractor.service.ts:3091-3092` | `nr.qty` / `weightIn = nr.weightKg` | — | — |
| Kurşun finish | `inventory.service.ts:4760-4767` | — | `totalMeters` | — |
| Kurşun bypass kapanışı | `kursun-bypass.service.ts:2343` (raw) | — | `"qtyOut" = "qtyIn"` | `weightIn` |
| Tambur (3 yol) | `tambur.service.ts:1169-1182`, `:3320-3331` | — | `qtyIn > 0 ? qtyIn : (totalQty \| parent.initialQty)` | `roll.weightKg` / — |
| Kurtarma | `inventory.service.ts:4411-4415` | — | `qtyIn > 0 ? qtyIn : currentQty` | `weightIn ?? weightKg` |
| İptal / fire (tekil) | `inventory.service.ts:3238-3239` | — | `isScrap ? qtyIn ?? currentQty : 0` | aynı kural |
| Arşiv | `inventory.service.ts:3590-3591` | — | `0` | `0` |
| WO kapanış dispozisyonu | `helpers/roll-disposition.helper.ts:371-384` (raw) | — | storno `0`; diğer `COALESCE(qtyOut, NULLIF(qtyIn,0), currentQty)` | `COALESCE(weightOut, weightIn, weightKg)` |
| Undo yeniden açma | `tambur-undo.service.ts:1315/1319`, `:1545/1549` | `restored` (taze) | `null` (yeniden açık) | `null` |

Sözleşme tablosu `roll-disposition.helper.ts:334-337`: **0 = storno (hiç geçmedi)**, **qtyIn = geçti**. Üçüncü hal **NULL** (üç kapanış) belgede yok. Prod kopyası: kapalı hareketlerde `qtyOut IS NULL` **14** (`DISPATCH:… | CANCEL:…` 12, `MANUAL_MOVE_OUT` 2), `qtyOut = 0` 1 (`WO_CLOSE_CANCELLED`). Okuyucular: `reports/production.report.service.ts:177` (`qty: m.qtyOut !== null ? Number : null`), `work-session-activity.service.ts:403` (`toNum`). → HOTSPOT #5, K7b.

### 2.F Sevkiyat (`src/services/shipping.service.ts` + `helpers/allocation.helper.ts`)

| # | Konum | Formül | Birim | Yuvarlama | Tip | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|
| F1 | `allocation.helper.ts:36-50` `specMatch` | item eşit ∧ (renk ikisi doluysa eşit) ∧ (en ikisi doluysa `Decimal.equals`) — null = joker | cm | — | Decimal | — | **kopya** `return.service.ts:51-64` (birebir), varyantlar §4.2 |
| F2 | `:53-72` `buildPool` | spec anahtarı `itemId|colorId|Decimal(width).toString()`; `remaining = Σ currentQty` | m | — | Decimal | — | — |
| F3 | `:93-117` `allocate` | satır FIFO (termin→sipariş tarihi→satır); `need = max(0, quantity − shippedQty)`; `take = min(need, remaining)` | m | yok | Decimal | — | fason doğrudan sevk önizlemesi (`subcontractor:5806`) aynı fonksiyon |
| F4 | `:125-171` `computeLoadedByLine` | capped + **overflow pro-rata** `remaining × need_i / totalNeed` (**yuvarlanmaz**), son satır artık | m | yok (Decimal precision 20) | Decimal | — | gösterim; [VARSAYIM] çağıranı bu turda bulunmadı |
| F5 | `:211-239` `distributeSacksToLines` | çuval FIFO × satır FIFO; `take = min(line.need, spec.remaining)`; şube eşleşmesi; `SackAllocation` satırı = (sack, line, Σ take) | m | yok | Decimal | — | evet (`computeSackAllocations` tek çağıran) |
| F6 | `shipping.service.ts:1301-1335` `computeSackAllocations` | çuval topları **statü süzgeçsiz** `select rolls {currentQty}`; `need = quantity − shippedQty` (kelepçesiz, `>0` süzülür); `ACTIVE_LINE` | m | — | Decimal | — | HOTSPOT #6 |
| F7 | `:1339-1353` `writeShipmentAllocationsTx` | sil-yaz: `deleteMany` + `createMany(qty)` — create (`:1424`), sipariş seti değişimi (`:1559/:1579`) | m | — | Decimal | — | — |
| F8 | `:1469-1478`, `:1483-1531` `previewCreateShipment` | çuval `Σ currentQty` (**süzgeçsiz**); `surplus = Number(total − allocated)`; uyarı eşiği `> 0.001`; mesajda `Math.round(surplus)`; `pendingOther` `Number(_sum.qty) > 0.001`; `totals.surplusMeters = Math.max(0, surplus)` | m | mesajda tam sayı | Decimal→number | **A** (`:1483/1490/1506/1515-1531`) | HOTSPOT #6 |
| F9 | `:1806-1879` `performDispatchTx` | claim PLANNED→DISPATCHED; `SACK_ABSENT_STATUSES` hayalet guard (`:1835`, fail-closed); statü grubu başına `SHIPPED + preShipStatus`; `touchOrderLinesTx` → `recomputeOrderStatusForOrders` | — | — | — | — | metraj **yazılmaz** (defterden türer) |
| F10 | `:1121-1140` depo panosu müşteri bazında | `Σ weightKg`, `Σ _sum.currentQty`, `Σ _count` → `Number` | kg, m, adet | — | Decimal | Ç | — |
| F11 | `:1187-1194` çuval listesi | `present = rolls ∖ SACK_ABSENT`; `totalQty = Σ present.currentQty`; `rollCount = present.length` | m, adet | — | Decimal | Ç | çuval toplamı 6 yerde (§4.3) |
| F12 | `:1283` | EXPORT'ta her çuval `weightKg > 0` | kg | — | Decimal | K | — |
| F13 | `:1928-1933` iptal önizleme | sipariş başına `Σ SackAllocation.qty` | m | — | Decimal | — | — |
| F14 | `:1976`, `:2087-2114`, `:2192-2199` storno/iptal | `sackAllocation.deleteMany`; toplar `preShipStatus ?? WAREHOUSE`'a; metraj değişmez | — | — | — | — | — |
| F15 | `:2569-2627` `attachTotals` (liste) | **BRÜT**: `gross = Σ rolls.currentQty (shipmentId) + Σ RollReturn.qty (fromShipmentId, cancelledAt null)`; `totalKg = Σ sacks.weightKg`; `_count.rolls += _count.returns`; **RepeatableRead batch tx** (tek anlık görüntü) | m, kg, adet | — | Decimal→Number | Ç | brüt ailesi: F15, F17, F19, F21, `accounting-export:347-382`, `reports/_shipped.ts:59-80` |
| F16 | `:2700-2717` özet | `meters = live + returns + Σ DirectShipment.totalQty`; `kg = Σ sacks.weightKg` | m, kg | — | Decimal | Ç | — |
| F17 | `:2861-2887` sevkiyat detayı satırları | `thisShipment = Σ alloc.qty`; `requested`, `shipped`, `openQty = requested − shipped` (kelepçesiz) — Decimal olarak döner (serializer) | m | — | Decimal | — | "açık" ailesi §4.1 |
| F18 | `:2975`, `:2977-3007` çuval brüt içeriği | `totalKg = Σ weightKg`; çuval `grossRolls = rolls ∪ returns(prevSackId)`; `productSummary` anahtar `item.code|color.code|Decimal(width).toString()`; `returnedQty = Σ returns.currentQty` | m, kg | — | Decimal | — | — |
| F19 | `:3016-3026`, `:3054` | `returnedMeters = Σ returnRows.qty`; `grossShipmentRolls` **bir kez** kurulur, `totalMeters` ondan; `totalKg` değişmez (iade kg'a dokunmaz) | m, kg | — | Decimal | — | — |
| F20 | `:3330-3353` `listOpenOrders` | `specAvail = Σ WAREHOUSE serbest (shipmentId null, sackId null) groupBy (item,color,width)` renk/en gevşek eşleşme (`Decimal.equals`); `openQty = requested − shipped`; `covered = openQty ≤ 0 ∨ avail ≥ openQty` | m | — | Decimal | K | spec eşleşmesi §4.2 |
| F21 | `:3370-3379` `summarizeShipmentReturns` | `count`, `meters = Number(Σ RollReturn.qty)` | adet, m | — | Decimal | Ç | — |
| F22 | `:3435-3520` `collectShipmentDocContent` | çuval `rolls ∖ SACK_ABSENT` + iade geri-ekleme (`prevSackId`, `currentQty: rr.qty` `:3478`); `sackMeters`, ürün toplamı; **`kg` çuvalın İLK topuna** (`idx === 0 ? weightKg : 0` `:3514`); `totalMeters/totalKg = Number(Σ Decimal)` | m, kg | belge `fmtTr(n,2)` (`shipment-dispatch.html.ts:256`) | Decimal→number | Ç | — |
| F23 | `:3625-3648` kalite belgesi / ambalaj | kalite başına `Σ currentQty`; **`widths = Math.round(Number(width))`** (tam cm) `:3643`; **`netKg: sk.weightKg`** `:3646` (şema: brüt) | m, cm, kg | `Math.round` en | Decimal→number | **A** (`:3643`) | HOTSPOT #7 |
| F24 | `:3651-3674` fatura satırları | `qty = Σ alloc.qty`; `amount = Σ Decimal(alloc.qty) × unitPrice` (**satır başı yuvarlama yok**); para birimi başına `Σ amount` → `Number` | m, para | yok (sipariş `computeTotalAmount` `toFixed(2)`) | Decimal | Ç | para kopyası §4.6 |
| F25 | `:261`, `:969` tartı | `weightKg = new Decimal(data.weightKg)` (Zod `positive`, `max 999_999_999`); kaynak `weightSource` | kg | DB sessiz | number→Decimal | — | dara/net kavramı **yok** |

### 2.G Çuval arama (`src/services/sack-search.service.ts`)

| # | Konum | Formül | Birim | Tip | D→N | Not |
|---|---|---|---|---|---|---|
| G1 | `:233-247`, `:278/:282` liste | `presentOnly = status ∉ SACK_ABSENT`; `totalQty = Number(_sum.currentQty)`; `matchQty` | m | Decimal | Ç | — |
| G2 | `:410-428` `getSackContents` | grup anahtarı `item.name|color.name|Number(width)`; **`g.qty += Number(currentQty)`, `totalQty += Number(currentQty)`** | m | **float** | **A** | HOTSPOT #14 — aynı dosyada G1/G3 Decimal aggregate kullanıyor |
| G3 | `:461-524` `getContentDump` | `rolls ∖ SACK_ABSENT`; `qty: Number(currentQty)`, `width: Number` | m, cm | Decimal | Ç | yorum `:457-459`: "Decimal alanlar BURADA Number'a çevrilir — getSackContents yapmadığı için istemci sarıyordu" |

### 2.H İade (`src/services/return.service.ts`)

| # | Konum | Formül | Birim | Tip | D→N | Not |
|---|---|---|---|---|---|---|
| R1 | `:501-511` claim | `updateMany where {id, status: SHIPPED}` → `appliedStatus`, `shipmentId = sackId = null`; count 0 → tüm grup geri sarılır | — | — | — | — |
| R2 | `:519-530` defter | `RollReturn.qty = roll.currentQty` (tam top; **kısmi iade yok**), `width = roll.width`, `totalQty = Σ` | m, cm | Decimal | — | "iade ≤ sevk" yapısal: kaynağı sevkteki topun kendi metrajı |
| R3 | `:12` (dosya başlığı) | "SEVK MUHASEBESİNE DOKUNULMAZ (shippedQty/allocation) → sipariş kapalı kalır" — `recomputeOrderStatus`/`sackAllocation` çağrısı **yok** (grep 0) | — | — | — | BRÜT kuralı: `shippedQty` iadeyle düşmez |
| R4 | `:698-705` özet | `aggregate _sum(qty), _count` → Decimal döner (serializer) | m, adet | Decimal | — | — |
| R5 | `:1102-1115` belge | `Number(width/qty)` | — | — | Ç | — |
| R6 | `:51-64` | `specMatch` **kopyası** (allocation.helper ile birebir) | — | — | — | §4.2 |

### 2.I Sipariş (`order.service.ts`, `helpers/order-status.helper.ts`, `helpers/coverage.helper.ts`, `helpers/order-line-scope.helper.ts`, `production-balance.service.ts`)

| # | Konum | Formül | Birim | Yuvarlama | Tip | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|
| I1 | `order-status.helper.ts:48-81` `computeLineLedger` | `shipped(L) = Σ SackAllocation.qty [sack.shipment.status = DISPATCHED] + Σ DirectShipAllocation.qty` | m | yok | Decimal | — | **evet** (defter tek kaynak; `Order.shippedQty` de buradan) |
| I2 | `:96-199` `recomputeOrderStatus` | satır `shippedQty = ledger`; başlık `shippedQty = Σ`; `totalRequired = Σ aktif.quantity + Σ iptal.shipped` (`:141-146`); `COMPLETED ⇔ totalRequired − shipped ≤ tolerance` (**`shipping.toleranceMeters` varsayılan 5 m**, `system-setting.service.ts:2087-2099`; prod'da satır yok → 5); `PARTIAL_SHIPPED` aksi; `shipped ≤ 0 → APPROVED`; tüm kalemler iptal → shipped>0 ? COMPLETED : CANCELLED | m | yok | Decimal | — | evet; çağıranlar `performDispatchTx:1879`, iptal `:1982`, storno `:2211`, fason directShip; kilit protokolü `:205-210` (K3) |
| I3 | `coverage.helper.ts:56-74` | `coverage = shipped = OrderLine.shippedQty` (rezerv 0) | m | — | Decimal | — | — |
| I4 | `:91-137` `computeWoMaterial` | `finished = Σ currentQty [producedInStep ∈ WO ∧ status ∈ {WAREHOUSE, A1_STOCK, SHIPPED, SCRAP}]`; `committed = computeWoInput.meters` | m | — | Decimal | — | evet (order + production-balance tüketir) — HOTSPOT #9 |
| I5 | `:168-277` `computeWoInput` | `meters = Σ kök.initialQty + Σ fason-charge-split çocuğu.initialQty`; `count = kök sayısı` (statü ∉ {CANCELLED, STOCK}) | m, adet | — | Decimal | — | evet (liste `inputMeters`, detay `inputRolls`) |
| I6 | `order-line-scope.helper.ts:35-39` `openLineWhere` | **DB-tarafı** `quantity > shippedQty` (FieldRef) + `cancelledAt null` | m | — | — | — | AST bekçili tek kaynak (gelecek soruları) |
| I7 | `order.service.ts:132-147` `computeTotalAmount` | `total = Σ Decimal(Number(quantity)) × price` → **`toFixed(2)`** → `Number`; fiyatsız satır atlanır; çağrı `:1836`, `:2379` | para | **2 ondalık, toplam** | number→Decimal→number | **A** (girdi `Number(l.quantity)`) | fatura satırı F24 yuvarlamıyor (§4.6) |
| I8 | `:370-372`, `:429-433` kalem iptal önizleme | `remaining = max(0, requested − shipped)`; `Number(...)` | m | — | Decimal | Ç | "açık" ailesi |
| I9 | `:612-631` özet şerit | `ordered = Σ quantity`, `shipped = Σ shippedQty`, `open = ordered − shipped` (negatifse 0) | m | — | Decimal | Ç | — |
| I10 | `:749-780` `validateLines` | `qty > 0 ∧ ≤ 999 999 999`; `width > 0 ∧ ≤ 100 000`; `price ≥ 0` | m, cm | — | number | K | en tavanı §6 |
| I11 | `:1058-1062`, `:1230-1235`, `:1322-1328` liste/cursor | `openQty = quantity − shipped`; `inProduction = inProdBySpec[itemId|colorId|Decimal(width).toString()]`; `netOpenQty = max(0, openQty − inProduction)`; `openQty > 0` süzgeci | m | — | Decimal | — | 3 kopya aynı dosyada |
| I12 | `:1378-1389` `computeInProdBySpec` | `inFlight = max(0, committed − finished)` spec havuzuna | m | — | Decimal | — | kopya `:1510-1522`, `production-balance:311-315` (§4.4) |
| I13 | `:1432-1439`, `:1445-1487` `getCoverageForLines.matchFree` | `widthEqual`: ikisi null ∨ `Decimal.equals`; WAREHOUSE **birebir** (renk+en), STOCK **renk-joker + en-agnostik**; `Σ _sum.currentQty` | m | — | Decimal | — | spec §4.2 |
| I14 | `:1525-1543` | `netGap = requested − shipped − packed(0) − freeWarehouse − inProduction` (**`max(0)` YOK** — diğer 5 "açık" hesabı kelepçeli) | m | — | Decimal | — | HOTSPOT #8 |
| I15 | `:1588-1642` `getSpecAvailability` | `freeWarehouse` (birebir), `freeStock` / `freeSemiFinished` (`entrySource = SEMI_FINISHED` ayrımı; renk-joker, en-agnostik); `.toNumber()` | m | — | Decimal | Ç | ayrım GÖSTERİMDE (2026-08-27 kuralı) |
| I16 | `:1695-1795` `getShipmentsForOrder` | sevkiyat başına `Σ SackAllocation.qty`; direkt `Σ DirectShipAllocation.qty`; `dispatchedTotal = Σ DISPATCHED + direkt + legacy`, `plannedTotal = Σ PLANNED`; `.toNumber()` | m | — | Decimal | Ç | yorum `:1747`: `dispatchedTotal = order.shippedQty` mutabakatı (I1 ile aynı defter) |
| I17 | `:2115-2131` `createFromRolls` (hızlı sipariş) | grup anahtarı `itemId|colorId|Number(width)`; `quantity = Σ currentQty` → `Number` | m, cm | — | Decimal | Ç (anahtarda `Number(width)`) | — |
| I18 | `:2954` | `targetQuantity` Decimal aktarımı (hesap yok) | — | — | — | — | — |
| I19 | `production-balance.service.ts:230-256` | `remaining = max(0, quantity − shippedQty)`; `talep += remaining`; satır `open = remaining.floor()` (**tabana, tam metre**; yorum "pro-rata artığı atılır") | m | **`floor` — satır** | Decimal | — | tek `floor` noktası |
| I20 | `:272-282`, `:342-358` arz | `groupBy (item,color,width,status,entrySource)` serbest (`shipmentId null`, `sackId null`) WAREHOUSE+STOCK; `qty ≤ 0` atlanır | m | — | Decimal | — | — |
| I21 | `:311-315` | `inFlight = max(0, committed − finished)` | m | — | Decimal | — | kopya I12 |
| I22 | `:363-368`, `:408-411`, `:418-433` | `uretilecek = max(0, talep − depo − uretimde)`; grup `Σ`; `ham`/`yariMamul` en-agnostik renk-joker; **`malzemeAcigi = max(0, uretilecek − (ham + yariMamul))`** (ikisi birden arz) | m | — | Decimal | — | 2026-08-27 §4 "toplam korunuyor" bekçisi |

### 2.J Fason (`subcontractor.service.ts`, `helpers/subcontractor-shrink.helper.ts`, mobil `receivePayload.helper.ts`)

| # | Konum | Formül | Birim | Yuvarlama | Tip | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|
| J1 | `:1026-1030` sevk create | `SubcontractorDispatch.totalQty = Σ rolls.currentQty` (snapshot); kalem `dispatchedQty = currentQty` [VARSAYIM: `:1347` çevresi], mesaj `toFixed(1)` (`:1441`) | m | mesajda 1 | Decimal | — | snapshot ailesi §4.5 |
| J2 | `:496-592` `createFasonShipChild` (kısmi doğrudan sevk) | çocuk `initialQty = currentQty = shipQty` (number), `qtyIn = shipQty`; parent `currentQty −= shipQty`, **`initialQty −= shipQty`** (`gte` guard); `:630` tam sevk kararı `q ≥ Number(currentQty)` | m | DB sessiz | number/Decimal | K (`:630`) | I5 "charge-split çocuğu geri ekle" kuralı buna dayanır |
| J3 | `:2529-2532` | `measuredWidth = appliedWidth > 0 ? Decimal : null` (0 = ölçülmedi) | cm | — | Decimal | — | — |
| J4 | `:2736-2751` kabul planı | `remaining = fresh.currentQty`; `req = Decimal(receivedQty)`; `partial = req < remaining`; `receivedQty = partial ? req : remaining` (tam kabulde deftere **kalan** yazılır) | m | yok | Decimal | K | — |
| J5 | `:2878-2890` kısmi düşüm | `currentQty −= receivedQty` (guard `currentQty > receivedQty`, **`gt`**: eşitlik tam kabul sayılır) | m | — | Decimal | — | — |
| J6 | `:2994`, `:3029`, `:3060-3063`, `:3078`, `:3091-3092` doğan toplar | `bornWidth = measured ?? sourceRoll.width ?? wo.width ?? null`; `nr.qty` finite>0; `initialQty = currentQty = nr.qty`, `weightKg = nr.weightKg`; plan sapması `qtyM = nr.qty`; hareket `qtyIn = nr.qty`, `weightIn` | m, cm, kg | DB sessiz | number→Decimal | — | çocuk `width` kaynağı dördüncü varyant (§6) |
| J7 | `:3172-3207` ÇEKME | `consumedTotal = Σ plans.receivedQty`; `bornTotal = Σ Decimal(nr.qty)`; `bornDiff = born − consumed`; **eşik `|diff| > 0.01`** (`:3181`; mobil `QTY_EPSILON` ile aynı); `shares = allocateShrink(plans, |diff|)`; `kind = diff<0 ? SCRAP (FASON_CEKME) : OVERAGE`; `sourceRefId = receipt.id`; `reasonText` `toFixed(1)` | m | satır 3 ondalık (helper) | Decimal | — | evet |
| J8 | `subcontractor-shrink.helper.ts:50-74` `allocateShrink` | tek satır → tamamı; `share_i = (total × received_i / Σ received).toDecimalPlaces(3)` (i < n), **son satır = total − Σ share** (toplam korunur); `≤ 0` paylar elenir; Σ received = 0 → ilk satıra | m | **satır `toDecimalPlaces(3)` + artık sona** | Decimal | — | evet |
| J9 | `:3253`, `:3268-3273` | `appliedWidth: Number(measuredWidth)`; **`Number(measuredWidth) !== Number(wo.width)`** → `changeWidth` (tx dışı, best-effort) | cm | — | number K | K | en eşitliği §4.7 |
| J10 | `:3398-3441` `closeRemainder` | `closedQty = Number(fresh.currentQty)`; sapma `qty = fresh.currentQty` (Decimal) SCRAP `SUBCONTRACTOR_REMAINDER` (0 ise satır yok); statü `SUBCONTRACTOR_CONSUMED` (**metraj sıfırlanmaz**) | m | — | Decimal | Ç | — |
| J11 | `:3796-3808`, `:3925-3932` kabul kuyruğu | raw `SUM(numeric)` → `Prisma.Decimal`; `COUNT` bigint → `Number`; `new Decimal(stat.total_qty ?? "0")` | m, adet | — | Decimal | Ç (bigint) | — |
| J12 | `:4009`, `:4035` | `totalQty = Σ currentQty`, `awaitingDispatchQty` (Decimal döner) | m | — | Decimal | — | — |
| J13 | `:4316-4323` makbuz listesi | `totalQty = Σ sourceDispatchItem.dispatchedQty` (kabul edilen kalemlerin SEVK metrajı, `receivedQty` değil) | m | — | Decimal | — | kısmi kabul modeliyle ilişkisi ② (bkz. HOTSPOT #4 ile aynı sınıf) |
| J14 | `:4946-4960` kabul iptali | kısmi kalem: `currentQty += receivedQty` (claim AT_SUBCONTRACTOR + adım); `:4986-4993` çekme sapmaları `sourceRefId` ile terslenir | m | — | Decimal | — | — |
| J15 | `:5722-5729`, `:5785-5806`, `:5819-5823` doğrudan sevk önizleme | `rollSpecs` (Decimal), `matchingLines` `specMatch ∧ quantity > shippedQty`; `suggested = allocate(...)`; `remaining = Number(quantity − shippedQty)` | m | — | Decimal | Ç | F3 ile aynı motor |
| J16 | `:5985-5995`, `:6275-6294` doğrudan sevk yazımı | pre-tx ve tx içi `Decimal(a.qty) > remaining` → 400/409; `DirectShipAllocation.qty = Decimal(a.qty)`; `:6126-6142` `DirectShipment.totalQty = Σ currentQty`, `rollCount = n` | m, adet | — | Decimal | — | recompute I2 tetiklenir (yorum `:6286-6287`: manuel increment YAPILMAZ) |
| J17 | `:2058`, `:2071-2083` sevk iptali | toplar `STOCK`; hareketler yalnız `exitedAt` (**`qtyOut` NULL**) | — | — | — | — | §2.E, HOTSPOT #5 |
| J18 | `:6419`, `:1862-1867`, `:6498-6501`, `:6648-6658`, `:6709`, `:6773` belge/çıktı | `totalWeight = Number(Σ dispatchedWeight)`; `Number(...)` | kg, m, cm | — | Decimal | Ç | — |
| J19 | mobil `receivePayload.helper.ts:97-148` `resolveReturns` | `remainderQty` yoksa satır bazlı; varsa **büyük toptan** (`remainingQty` desc, `rollId` ikincil) `take = min(left, remaining)`, `left = round2(left − take)`, `consumed = round2(remaining − take)`; `receivedQty = (take>ε ∧ consumed>ε) ? consumed : null`; `dropped = consumed ≤ ε`; `consumedTotalOf = round2(Σ)` | m | **`round2` her adımda** | float | — | **istemci tarafı** — sunucu yalnız satır `receivedQty` alır; sınır ötesi |

### 2.K Parti (`batch.service.ts`, `helpers/batch-dispatch-surgery.helper.ts`)

| # | Konum | Formül | Birim | Tip | Not |
|---|---|---|---|---|---|
| K1 | `batch.service.ts:748-755` K15 birleştirme | kaybeden sevk `totalQty = 0` (kalemler taşındı) | m | Decimal | snapshot §4.5 |
| K2 | `:783-798` | keeper `totalQty = Σ items.dispatchedQty` (aggregate) | m | Decimal | — |
| K3 | `batch-dispatch-surgery.helper.ts:95-99` `recomputeTotalAndAppendNoteTx`, `:280-285` (iptal → 0), `:340`, `:354-361` (doğan sevk `Σ dispatchedQty`) | aynı kural | m | Decimal | — |
| K4 | `batch.service.ts:55-60` `K18_DEAD_STATUSES` | ölü küme (4) — sayım/etiket süzgeci; `SACK_ABSENT_STATUSES` (8) ile **bilinçli ayrı** (`sack-invariants.helper.ts:24-26`) | — | — | adet semantiği §6 |
| K5 | parti metrajı | `workorder.service.ts:3050-3058` `meters = Number(groupBy _sum.currentQty)` canlı toplar; `workorder-batch-drop.service.ts:516` aynı | m | Decimal→number | Ç |

### 2.L Kartela (`kartela.service.ts`)

| # | Konum | Formül | Birim | Tip | D→N | Not |
|---|---|---|---|---|---|---|
| L1 | `:276-279` sevk | `totalQty = Σ currentQty` (Decimal); mesaj `toFixed(1)` (`:358`) | m | Decimal | — | snapshot §4.5 |
| L2 | `:504-512` kabul doğrulama | `count` pozitif tam sayı; `items.length === count` | adet | Int | — | — |
| L3 | `:646`, `:652-667` | `kartelaCount = count`; `count` adet `Swatch` doğar: `width = roll.width`, `length = lengthCm ?? bulkLengthCm`, `weightKg = measure ?? bulk` | adet, cm, kg | Decimal | — | **metraj düşümü YOK**: kaynak top `KARTELA_CONSUMED` olur (`:678-681`) ama `currentQty` **korunur** (K18 süzgeçleri dışlar) |
| L4 | `:1363-1404` `SwatchStockReduction` | olay `count` (idempotency `clientToken`); FIFO `take: count` seçim; `updateMany` claim `count === data.count` yoksa 409 (hepsi-ya-hiç) | adet | Int | — | — |
| L5 | `:1501-1527` | `Number(dispatchedQty/weight/width/totalQty)` | — | Decimal | Ç | — |

### 2.M İş emri (`workorder.service.ts`, `workorder-link`, `workorder-split`, `workorder-manual-move`, `workorder-fason-quick`, `helpers/roll-finalize.helper.ts`)

| # | Konum | Formül | Birim | Yuvarlama | Tip | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|
| M1 | `:1690-1718` `producedOutputWhere` | çıktı kümesi: `producedInStep ∈ WO` ∧ ((`TAMBUR_SPLIT` ∧ parent aynı adımın SPLIT'i değil — birinci nesil) ∨ (SPLIT değil ∧ status ∈ {WAREHOUSE, A1_STOCK, SCRAP, SHIPPED, AT_KARTELA, KARTELA_CONSUMED})) | — | — | — | — | evet (liste `:1848`, detay `:2194`) |
| M2 | `roll-finalize.helper.ts:75-106` `loadProducedBuckets` | kova `targetStatus`: SCRAP→fire, A1_STOCK→a1, diğer/null/bilinmeyen→warehouse; `isActive` süzgeci **yok** (bilinçli) | — | — | — | — | evet |
| M3 | `:1842-1869` liste `producedMeters` | `Σ initialQty` groupBy step, `qualityGrade null ∨ ∉ fireCodes` → `Number` per step; `:1882` **adımlar arası float `+`** | m | yok | Decimal→number | **A** | detay M5 Decimal — aynı küme, iki aritmetik |
| M4 | `:1756-1765` `orderedMeters` | **`Σ Number(orderLine.quantity)` float** | m | — | number | **A** | — |
| M5 | `:2209-2224` detay `producedRolls` | kova başına `Σ initialQty` (Decimal); `totalMeters = warehouse + a1` (fire hariç); `count = Σ kova sayıları` | m, adet | — | Decimal | — | — |
| M6 | `:2070-2110` adım özetleri | `totalMeters/raw/dyed/openFabric/waiting/atSubcontractor = Σ currentQty` (Decimal) | m, adet | — | Decimal | — | — |
| M7 | `:2438-2439`, `:2451-2456` parti lane'leri | `directShipped = Number(_sum.totalQty)`; konum `totalMeters += Number(currentQty)` **float** | m | — | number | **A** | — |
| M8 | `:2485-2495` fason kapanış bakiyesi | `returnedQty = Σ Number(dispatchedQty) [kalemin iptal edilmemiş HERHANGİ bir makbuz satırı varsa — kısmi dahil]`; "fasonda kalan = totalQty − dönen − fasondan" **frontend'de** | m | — | number | **A** | HOTSPOT #4 |
| M9 | `:3050-3058` | parti `meters = Number(_sum.currentQty)` | m | — | Decimal | Ç | — |
| M10 | `:3683-3733` kapanış önizleme | `currentQty: Number`; adım `meters += Number(currentQty)`; `inFlightMeters = Σ Number` **float** | m | — | number | **A** | — |
| M11 | `:4174` tebdil | `movedTotalQty = Σ Number(currentQty)` float (audit/mesaj) | m | — | number | A | kopya `workorder-split.service.ts:451/612` |
| M12 | `:4534`, `:4546` bağlama | hareket `qtyIn = currentQty` (Decimal); yanıt `qtyIn: Number` | m | — | — | Ç | — |
| M13 | `:6452-6459` refakat kartı | `totalMeterage = Σ currentQty`, `totalWeight = Σ weightKg ?? 0` (Decimal, serializer) | m, kg | — | Decimal | — | — |
| M14 | `:132-135` `normNum` | Decimal→number karşılaştırma yardımcısı | — | — | — | K | kopya `workorder-link.service.ts:107-109` `num()` |
| M15 | `workorder-link.service.ts:232-239` | **`Number(wo.width) !== Number(line.width)`** → "En farkı" uyarısı; `:622` `width ≤ 1000` | cm | — | number K | K | en eşitliği §4.7 |
| M16 | `workorder-link.service.ts:634` | `WorkOrder.width = new Decimal(width)` (`changeWidth`) | cm | DB sessiz | — | — | — |
| M17 | `workorder-fason-quick.service.ts:193-197` | parça listesi `Number(p)` finite>0 süzgeci → `receive(newRolls qty)` | m | — | number | — | J6 |
| M18 | `helpers/tambur-plan-gate.helper.ts:112-118` | `|Number(roll.width) − Number(plan.width)| > 10` (`TAMBUR_PLAN_WIDTH_TOLERANCE_CM`) → sapma | cm | — | number | **A** | en eşitliği üçüncü semantik §4.7 |

### 2.N Sapma defteri yazımları (`RollVariance` — tek yazıcı `helpers/roll-variance.helper.ts:50-78`)

| Çağıran | Konum | kind | source | qty formülü | sourceRefId |
|---|---|---|---|---|---|
| Tambur finalize (aşım) | `tambur.service.ts:1269-1276` | OVERAGE | TAMBUR_OVERCUT | `overageOf(Σcuts, currentQty)` | — |
| cutWarehouseRoll (aşım) | `:2264-2271` | OVERAGE | TAMBUR_OVERCUT | `overageOf(cutLength, currentQty)` | — |
| cutOpenFabric (aşım) | `:2958-2965` | OVERAGE | TAMBUR_OVERCUT | `overageOf(lengthMeters, currentQty)` | — |
| finalizeWarehouseCut kalan | `:2591-2603` | SCRAP / RECORD_CORRECTION (`varianceKindForRemainingAction`) | TAMBUR_WAREHOUSE_FINALIZE | `remainingQty` (number) | — |
| finalizeOpenFabric kalan | `:3372-3383` | SCRAP / RECORD_CORRECTION | TAMBUR_FINALIZE | `remainingQty` | — |
| Undo SINGLE arşiv | `tambur-undo.service.ts:1098-1108` | RECORD_CORRECTION | TAMBUR_UNDO_SINGLE | `child.initialQty` | — |
| Undo SINGLE üretim bump | `:1134-1141` | OVERAGE | TAMBUR_UNDO_RESTORE | `max(0, current+len − initial)` | — |
| Undo arşivden bump | `:1295-1302` | OVERAGE | TAMBUR_UNDO_RESTORE | `max(0, current+restored − initial)` (yalnız stepId) | — |
| Undo FULL bump | `:1524-1531` | OVERAGE | TAMBUR_UNDO_FULL | `max(0, restored − initial)` | — |
| Fason çekme/fazla | `subcontractor.service.ts:3191-3205` | SCRAP (`FASON_CEKME`) / OVERAGE | SUBCONTRACTOR_RETURN | `allocateShrink` payı | `receipt.id` |
| Fason kalan kapama | `:3432-3441` | SCRAP | SUBCONTRACTOR_REMAINDER | `fresh.currentQty` | — |
| Tersleme | `tambur-undo:1610-1635`, `subcontractor:4986-4993` | `reversedAt` işareti | — | — | — |

Helper kuralı: `qty ≤ 0 → null (satır yazılmaz)` (`:44-56`), sebep doğrulaması önce, **tx içinde** (`:8-11`). Prod kopyası (§7): 75 satır — OVERAGE/TAMBUR_OVERCUT 37 (382,1 m), RECORD_CORRECTION/TAMBUR_FINALIZE 36 (309,9 m), SCRAP/TAMBUR_FINALIZE 2 (8,9 m); diğer kaynaklar **0** (fason çekme/kalan, undo — kopya 0825, migration'lar 190/195).

---

## 3. DECIMAL→NUMBER DÖNÜŞÜM TABLOSU

Yalnız Decimal tipli alanlar (`currentQty/initialQty/weightKg/width/quantity/shippedQty/qty/dispatchedQty/receivedQty/totalQty/unitPrice/_sum.*`). 591 vuruş → K7a dosyalarında Decimal alanla kesişen ~150 → üç sınıf.

### 3.1 Dönüşümden SONRA aritmetik (kayıp adayı — float toplama/çarpma)

| Konum | Dönüşüm | Sonraki aritmetik | Yüzey | Etki notu |
|---|---|---|---|---|
| `inventory.service.ts:2037/2057` + `:2066-2081` | SQL `SUM::float` | `round1` satır + `Math.round((a+b)*10)/10` toplam (çift yuvarlama) | Fasondaki stok özeti (rakam) | 1-ondalıklı veride küçük; satır toplamı ≠ ham toplam olabilir |
| `sack-search.service.ts:424/427` | `Number(currentQty)` | `+=` grup ve toplam | Çuval içeriği (rakam) | aynı dosyada G1/G3 Decimal — iki yüzey ayrışabilir (0.1+0.2 sınıfı) |
| `workorder.service.ts:1763` | `Number(orderLine.quantity)` | `+` | WO listesi `orderedMeters` | — |
| `workorder.service.ts:1868` + `:1882` | `Number(_sum.initialQty)` per step | adımlar arası `+` | WO listesi `producedMeters` | detay `:2213` Decimal → liste/detay farkı adayı |
| `workorder.service.ts:2455` | `Number(currentQty)` | `+=` | parti lane konum toplamı | — |
| `workorder.service.ts:2488-2495` | `Number(dispatchedQty)` | `+` | fason kapanış bakiyesi "Dönen" | HOTSPOT #4 (semantik + float) |
| `workorder.service.ts:3729/3733` | `Number(currentQty)` | `+=` / reduce | kapanış önizleme adım/toplam | — |
| `workorder.service.ts:4174`, `workorder-split.service.ts:451/612` | `Number(currentQty)` | reduce `+` | tebdil audit/mesaj | bilgi amaçlı |
| `shipping.service.ts:1483/1490` | `Number(totalMeters)`, `Number(total − allocated)` | `> 0.001`, `Math.round`, `Math.max(0,…)` | sevk önizleme `surplusMeters` | Decimal'de hesaplanıp number'a çevrilmiş; sonraki aritmetik yalnız kelepçe/mesaj |
| `shipping.service.ts:3643` | `Number(width)` | `Math.round` | ambalaj belgesi en listesi | tam cm'e yuvarlama (prod'da en tamamı tam sayı) |
| `shipping.service.ts:3665` | `Number(unitPrice)` | `Decimal(qty).times(up)` | fatura tutarı | fiyat number'a çevrilip Decimal çarpımına giriyor (12,2 → kayıpsız) |
| `order.service.ts:140-144` | `Number(quantity)` | `Decimal(qtyRaw).times(price)` | sipariş `totalAmount` | girdi zaten number (istemci); Decimal'e geri sarılıyor |
| `inventory.service.ts:4605-4619` | `Number(currentQty)` | `startMeter ≤ totalMeters` karşılaştırma + yazım `initialQty = totalMeters` | kurşun finish | number → DB sessiz yuvarlama |
| `helpers/tambur-plan-gate.helper.ts:112-113` | `Number(width)` ×2 | `Math.abs(a − b) > 10` | plan kapısı | — |
| `subcontractor.service.ts:3268` | `Number(measuredWidth)`, `Number(wo.width)` | `!==` | en güncelleme tetiği | K sınıfı ama tetik yazım yapar |

### 3.2 Dönüşümden sonra karşılaştırma (eşitlik/sıra — kayıp adayı yalnız 4+ ondalıkta)

| Konum | İfade | Not |
|---|---|---|
| `inventory.service.ts:978` | `Decimal(data.initialQty).equals(existing.initialQty)` | ham istemci değeri vs DB-yuvarlanmış → HOTSPOT #3 |
| `inventory.service.ts:866` | `where initialQty = Decimal(data.initialQty)` | aynı aile; kilit anahtarı `toFixed(3)` (`duplicate-guard.helper.ts:69`) |
| `inventory.service.ts:3901-3902` | `data.width !== Number(roll.width)` | number eşitlik (en) |
| `tambur.service.ts:1756`, `:2096`, `:2747`, `:3129` | `x > Number(currentQty)`, `> 0` | aşım/hata kapıları — number `>` |
| `subcontractor.service.ts:630` | `q >= Number(currentQty)` | tam sevk kararı |
| `workorder-link.service.ts:238` | `Number(wo.width) !== Number(line.width)` | en uyarısı |
| `tambur.service.ts:985` | `Decimal.equals` (DB↔DB) | kayıpsız |
| `tambur-undo.service.ts:204` | `Decimal.equals` (DB↔DB) | kayıpsız |
| `order-status.helper.ts:172` | `Decimal ≤ tolerance(number→Decimal)` | kayıpsız |

### 3.3 Salt çıktı (zararsız — serializer zaten yapıyor)

inventory `:995, :1665, :1706, :1737-1738, :1879-1880, :1910, :1942, :2483-2486, :2789-2791, :2942-2943, :3968-3971, :4569, :4585`; tambur `:398-399, :409, :870-871, :885, :891-892, :2260, :2293, :2490, :2950, :2984, :3101, :3222, :3662-3665, :3726-3734`; tambur-undo `:553, :652, :802, :843-856, :866, :988-999, :1170, :1390, :1685`; tambur-manual `:335, :1074, :1223-1225, :1253, :1472-1474, :1497`; shipping `:1139-1140, :1190-1194, :1478, :1502-1503, :1531, :2426, :2620-2621, :2715-2716, :2774, :2794-2802, :3105, :3140-3151, :3242-3251, :3279, :3379, :3503-3520, :3632-3648, :3658-3674`; sack-search `:269, :278, :282, :415, :433, :516-517, :524`; return `:1102-1103, :1114-1115`; order `:429-433, :621, :629-631, :1639-1642, :1764, :1775, :1792-1793, :2120-2131`; subcontractor `:303, :1715, :1862-1867, :1886, :2944, :3253, :3417, :3764, :3920-3932, :4024, :4650, :5205-5218, :5685-5686, :5819-5823, :6419, :6498-6501, :6532, :6557, :6648-6658, :6709, :6773`; workorder `:1883, :2118-2119, :2167, :2180, :2439, :2508, :2527, :2566, :2870, :3004, :3057, :3687, :4546, :6241, :6277`; kartela `:1501-1527`; batch-drop `:182, :516`; fason-quick `:121, :158`; manual-move `:316, :497`; split `:210`; link `:108, :234-235`.

**Bulgu adayı olmayan gözlem:** `.toNumber()` 22 vuruşun tamamı çıktı içindir; `parseFloat` yalnız filtre parse'ı (`inventory:88-89`); unary `+` dönüşümü Decimal alanlarda **0** vuruş.

---

## 4. KOPYA HESAP LİSTESİ (aynı büyüklük ≥2 yerde) ve formül FARKLARI

### 4.1 "Açık (kalan) metraj = istenen − sevk" — 13 nokta

| Konum | Formül | `max(0)` | Ek düşüm | Not |
|---|---|---|---|---|
| `allocation.helper.ts:102`, `:132` | `max(0, quantity − shippedQty)` | evet | — | tahsis need |
| `shipping.service.ts:1325` | `quantity − shippedQty` | **hayır** (`>0` süzülür) | — | çuval tahsisi |
| `shipping.service.ts:2885` | `requested − shipped` | hayır | — | detay görünümü (negatif dönebilir) |
| `shipping.service.ts:3347` | `requested − shipped` | hayır | — | açık sipariş listesi (`covered` `≤0` ile) |
| `order.service.ts:372` | `max(0, …)` | evet | — | kalem iptal önizleme |
| `order.service.ts:614/631` | `ordered − shipped`, negatif→0 | evet (çıkışta) | — | özet şerit |
| `order.service.ts:1059`, `:1230`, `:1322` | `quantity − shipped`; `netOpen = max(0, open − inProduction)` | kısmen | üretimdeki | liste/cursor/picker |
| `order.service.ts:1539-1543` | `requested − shipped − 0 − freeWarehouse − inProduction` | **hayır** | depo + üretimdeki | `netGap` (HOTSPOT #8) |
| `production-balance.service.ts:230-233`, `:256` | `max(0, quantity − shippedQty)`; satır `open = floor()` | evet | — | tek `floor` |
| `subcontractor.service.ts:5792`, `:5822`, `:5992`, `:6279` | `quantity > shippedQty` / `quantity − shippedQty` | hayır | — | doğrudan sevk |
| `order-line-scope.helper.ts:35-39` | DB `quantity > shippedQty` | — | — | tek kaynak (gelecek soruları) |
| `order-status.helper.ts:172` | `totalRequired − shippedQty ≤ tolerance` | — | tolerans (5 m) | sipariş kapanışı — **toplam** bazlı, kalem bazlı değil |

### 4.2 Spec (kumaş+renk+en) eşleşmesi — 5 semantik

| Konum | Renk | En | Statü kapsamı |
|---|---|---|---|
| `allocation.helper.ts:36-50` `specMatch` | biri null → joker | biri null → joker; ikisi dolu `Decimal.equals` | havuz çağıran belirler |
| `return.service.ts:51-64` | **birebir kopya** | aynı | — |
| `shipping.service.ts:3334-3340` `specAvail` | aynı gevşek | aynı gevşek | WAREHOUSE serbest |
| `order.service.ts:1438-1487` `matchFree` | WAREHOUSE: `(g.colorId ?? null) === colorId` **birebir**; STOCK: joker | WAREHOUSE: `widthEqual` (ikisi null ∨ equals) **birebir**; STOCK: en-agnostik | WAREHOUSE / STOCK |
| `order.service.ts:1588-1628` `getSpecAvailability` | aynı (I13) + `SEMI_FINISHED` ayrımı | aynı | — |
| `production-balance.service.ts:336-358, 418-423` | WAREHOUSE: `specKey` birebir; STOCK: joker | WAREHOUSE birebir (anahtar `Decimal(width).toString()`); STOCK en-agnostik | — |
| `subcontractor.service.ts:5785-5793` | `specMatch` (gevşek) | gevşek | doğrudan sevk |

Fark: tahsis/sevk yüzeyleri **gevşek** (null joker), kapsama/denge yüzeyleri WAREHOUSE'ta **birebir** → "depoda uygun mal var" (denge) ile "bu çuval şu satıra düşer" (tahsis) farklı cevap verebilir (yalnız null en/renk durumunda; prod'da `order_lines.width` null 0, `rolls.width` null 1235/2431 — ham toplar).

### 4.3 Çuval toplam metrajı / adedi — 6 yüzey

| Konum | Küme | Aritmetik |
|---|---|---|
| `shipping.service.ts:1187-1194` liste | `rolls ∖ SACK_ABSENT` | Decimal |
| `shipping.service.ts:1305-1313` tahsis havuzu | **süzgeçsiz** | Decimal |
| `shipping.service.ts:1469-1478` sevk önizleme | **süzgeçsiz** | Decimal→number |
| `shipping.service.ts:2977-3007` detay (brüt) | `sk.rolls` (sorgu süzgeci [VARSAYIM: `:2930` civarı `SACK_ABSENT`]) + iadeler | Decimal |
| `shipping.service.ts:3435-3510` belge | `∖ SACK_ABSENT` + iadeler | Decimal |
| `sack-search.service.ts:233-247` liste | `∖ SACK_ABSENT` | aggregate |
| `sack-search.service.ts:410-428` içerik | `s.rolls` (sorgu `:393-398` `∖ SACK_ABSENT`) | **float** |
| `sack-search.service.ts:461-508` döküm | `∖ SACK_ABSENT` | Decimal |
| `label.service` çuval etiketi | "aynı küme" (`shipping:1185` yorumu) | okunmadı (K7b) |

### 4.4 Üretimdeki (in-flight) metraj — 3 kopya, aynı formül

`max(0, committed − finished)` — `order.service.ts:1382-1385`, `:1515-1518`, `production-balance.service.ts:311-314`; girdileri tek kaynak `computeWoMaterial` (`coverage.helper.ts:91-137`). Fark yok; HOTSPOT #9 girdinin kümesine dair.

### 4.5 Fason sevk `totalQty` snapshot'ı — 6 yazıcı

create `Σ currentQty` (`subcontractor:1027`), iptal `0` (`batch:754`, `surgery:284`), merge/split `Σ dispatchedQty` (`batch:795`, `surgery:98/:360`); ayrıca WO detayı kapanış bakiyesini kalemlerden **float** kurar (`workorder:2488-2495`) ve DirectShipment `totalQty` `Σ currentQty` (`subcontractor:6130-6141`). Fark: create anında `currentQty`, sonrası `dispatchedQty` (aynı değer olmalı; kısmi sevk çocuğunda `dispatchedQty = shipQty` [VARSAYIM]).

### 4.6 Para — 2 formül

Sipariş `totalAmount = Number(Σ Decimal(qty)×price).toFixed(2)` (`order.service.ts:132-147`, toplam 2 ondalık) vs fatura satırı `amount = Σ Decimal(alloc.qty)×Number(unitPrice)` **yuvarlamasız** (`shipping.service.ts:3665`), para birimi toplamı `Number` (`:3674`). Kuruş farkı adayı (belge yüzeyi).

### 4.7 En (width) eşitliği — 3 semantik

`Decimal.equals` (allocation `:45`, order `:1439/:1605`, shipping `:3338`, inventory `:3862` yazım) · `Number !==` (`workorder-link:238`, `subcontractor:3268`, `inventory:3902`) · `|Δ| > 10 cm` tolerans (`tambur-plan-gate:113`). Sonuç: plan kapısı 5 cm sapmayı geçirir, tahsis aynı sapmayı **eşleşmez** sayar (HOTSPOT #11).

### 4.8 `qtyOut` fallback — 3 varyant + NULL

`qtyIn>0 ? qtyIn : totalQty` (tambur `:1169-1172`) · `… : parent.initialQty` (`:3320-3323`) · `… : currentQty` (inventory `:4411-4414`, disposition `:373`) · NULL (§2.E). Tambur yorumu `:3309-3311` ("initialQty artık güvenilir değil") kendi fallback'iyle çelişiyor gibi görünüyor — ② okusun.

### 4.9 Çocuk top `width` kaynağı — 4 varyant

finalize: `wo.width ?? roll.width` (`tambur:1050`); cutWarehouseRoll/cutOpenFabric/finalizeOpenFabric: `parent.width` (`:2138`, `:2811`, `:3237`); tambur-manual: `input.width ?? wo.width` (`:1074`); fason doğan: `measured ?? source.width ?? wo.width` (`subcontractor:2994`). Aynı Tambur'dan çıkan iki parça (kesim çocuğu vs finalize çocuğu) farklı en taşıyabilir (HOTSPOT #10).

### 4.10 Yardımcı kopyaları

`fmtTr` ×3 (`shipment-dispatch.html.ts:246` → 2 ondalık m/kg, 0 adet; `kartela-ceki.html.ts:86` → 1; `fason-direct-ship.html.ts:121` → 1) · `round1` ×3 (`reports/_breakdown.ts:32`, `quality-scorecard:219`, `inventory:2066`) · `normNum`/`num` ×2 (`workorder:132`, `workorder-link:107`) · `specMatch` ×2 · `D0()` ×5 dosya. (Formatlayıcılar K7b.)

---

## 5. Yuvarlama politikası gözlemi

| Katman | Kural | Nerede | Satır mı toplam mı |
|---|---|---|---|
| Giriş (Zod) | **yok** — pozitif + üst sınır | §1.2 | — |
| İstemci | mobil metre cihazı 1 ondalık; mobil fason `round2`; Electron kısıtsız [VARSAYIM] | §1.3 | — |
| DB | `numeric(12,3)` **sessiz yarım-yukarı** (ölçüldü) | her yazım | satır |
| Hesap (Decimal.js) | varsayılan precision 20, ROUND_HALF_UP; bölme yalnız 2 yerde (`allocation.helper:164-165` pro-rata yuvarlamasız, `shrink.helper:64` `toDecimalPlaces(3)`) | — | shrink: satır 3 ondalık + artık son satıra (**toplam korunur**); loadedByLine: son satır artık (toplam korunur) |
| Açık yuvarlama | `production-balance:256` `floor()` (tam metre, tabana) | satır | — |
| | `order.service:147` `toFixed(2)` | toplam (sipariş) | — |
| | `inventory:2066-2081` `round1` satır + toplam yeniden `round1` | **ikisi** (çift yuvarlama) | — |
| | `shipping:1507/1518` `Math.round` (yalnız uyarı metni), `:3643` `Math.round(width)` (belge) | — | — |
| | mesaj `toFixed(1)` (`subcontractor:1441/3188-3189`, `kartela:358`) | — | — |
| Belge yüzeyi | `fmtTr` 2 / 1 / 0 ondalık (dosyaya göre) | K7b | — |
| Eşikler | `0.01 m` çekme (`subcontractor:3181`, mobil `QTY_EPSILON`), `0.001 m` sevk önizleme (`shipping:1506/1516`), `5 m` sipariş toleransı, `±10 cm` en | — | — |

Gözlem: yuvarlama **kaynağa değil yüzeye** bağlı; aynı metraj sipariş özetinde 3 ondalık (serializer), dengede tam metre (`floor`), fasondaki stokta 1 ondalık, muhasebe fişinde 2 ondalık, kartela çekisinde 1 ondalık basılıyor. Yazılı politika bulunamadı (`grep -rn 'yuvarla' docs` bu turda yapılmadı — kapsam dışı).

---

## 6. Birim varsayımları (karışıklık adayları)

| Büyüklük | Varsayım | Kanıt | Karışıklık adayı |
|---|---|---|---|
| Metraj | her Decimal miktar **metre**; `OrderLine.quantity` yorumu "meters" ama `validateLines` "metraj/adet" (`order.service.ts:738`); `WorkOrderToOrderLine.allocatedQty` "metraj/kg" (ölü) | şema | `pieceLengthM` var ama adet türetme yok (yalnız gösterim) |
| kg | `Roll.weightKg` opsiyonel — **prod'da 0/2431 dolu**; hareket `weightIn/Out` yalnız kopya; `Sack.weightKg` **BRÜT (kumaş+dara)** — dara alanı yok | şema `Sack:14`; `shipping:3646` **`netKg`** adıyla basar; `:3514` kg çuvalın ilk topuna | HOTSPOT #7 |
| En | cm; prod'da en tamamı tam sayı; `Roll.width` null 1235/2431 (ham) | şema yorumları | Zod tavanları **1 000** (`workorder.controller:268/272`, `link:622`) / **999 999** (`tambur-manual:87`) / **999 999 999** (inventory, workorder create, subcontractor) / **100 000** (`order.validateLines:766`) → mm girişi sessizce cm kabul edilir (HOTSPOT #12) |
| Adet (top) | `rollCount` = satır sayısı; BRÜT liste `_count.rolls + _count.returns` (`shipping:2625`); çuval `present.length` vs `s.rolls.length` (`sack-search:438` süzgeçli sorgu) | — | 0 m canlı `WAREHOUSE` top adedi şişirir (HOTSPOT #2) |
| Adet (kartela) | `Int` — `SwatchStockReduction.count`, `kartelaCount`; kartela **metraj düşmez** | `kartela:678-681` | — |
| Kartela ölçüsü | `Swatch.length/width` **cm**; `totalLength = Number(Σ length)` cm — alan adı birim taşımıyor | `tambur:1687-1697` | m sanılabilir |
| Hata metresi | `startMeter` 0..`currentQty` (m) | `inventory:4614-4619`, `tambur:1756` | — |
| Cihaz ölçeği | `PeripheralDevice.scale` cm→m çarpanı (`0.01`); mobil `parseMeterReading(scale, decimals=1)` | şema, mobil test | — |
| Zaman/gün | `oldestDays = floor(ms/86_400_000)` (`inventory:2094`) | — | K7b/TZ sınıfı |
| Para | `Order.currency` satır bazlı; `totalAmount` (14,2); fatura satırı `unit: "m"` sabit (`shipping:3663`) | — | kg bazlı satış yok |

---

## 7. Saha ölçümleri (prod kopyası `tekserp_saha_0825`, salt-okunur; 190/195 migration)

| Ölçüm | Sonuç |
|---|---|
| `rolls` toplam / `currentQty > initialQty` / `currentQty < 0` | 2 431 / **2** / 0 |
| `currentQty > initialQty` satırları | barkodsuz, `IN_PRODUCTION`, `SUBCONTRACTOR_RETURN`: `492.000 → 698.900` ve `500.000 → 520.500` (CLAUDE.md 2026-08-22 §13 "bilerek düzeltilmedi") |
| Canlı statüde `initialQty ≤ 0` | **2**: `T190826F0119`, `T190826F0120` — `WAREHOUSE`, `TAMBUR_SPLIT`, `0.000/0.000`, her birinin 1 çocuğu (`F0125: 36.700`, `F0126: 40.000`), sapma satırı **yok**, çuvalda değil → tam-metraj `cutWarehouseRoll` sonrası parent 0/0 kalmış, `finalizeWarehouseCut` çağrılmamış (kod: `tambur.service.ts:2242-2248` statüye dokunmaz) |
| `rolls.width` null / >400 / <50 | 1 235 / 0 / 0; dolu 1 196'nın tamamı tam sayı |
| `rolls.weightKg` dolu | **0** |
| `rolls.currentQty` ondalık dağılımı | 1 ondalık 382 · 2 ondalık 2 · 3 ondalık 0 (gerisi tam) |
| `order_lines` / `shippedQty > quantity` / `width` null / kesirli `quantity` | 281 / 0 / 0 / 0 |
| Satır `shippedQty` ↔ defter (DISPATCHED SackAllocation + direct) drift | **0 / 281** (Σ 20 459,200 = 20 459,200) |
| Başlık `Order.shippedQty` ↔ Σ satır drift | 0 / 278 |
| Sevkiyat başına Σ tahsis > (canlı + iade) metrajı | 0 / 34 |
| Hayalet top (sackId dolu ∧ `SACK_ABSENT`) / hayaletli çuvalda tahsis | 0 / 0 |
| `sacks` tartılı / toplam | 1 / 41 |
| `roll_returns` / `sack_allocations` / `direct_ship_allocs` | 5 / 46 / 0 |
| `roll_variances` kind×source | SCRAP·TAMBUR_FINALIZE 2 (8,9 m) · RECORD_CORRECTION·TAMBUR_FINALIZE 36 (309,9 m) · OVERAGE·TAMBUR_OVERCUT 37 (382,1 m); `reversedAt` 0 |
| `subcontractor_receipt_items.receivedQty` NULL | 635 / 638 (eski kayıt — rapor `COALESCE(receivedQty, roll.currentQty)` varsayımı, şema yorumu) |
| Kapalı hareket `qtyOut IS NULL` | 14 (`DISPATCH:FS… \| CANCEL:FS…` 12 · `MANUAL_MOVE_OUT` 2); `qtyOut = 0` 1 (`WO_CLOSE_CANCELLED`) |
| `system_settings` | yalnız `kk1.duplicateGuardEnabled = true`; `tambur.overQuantityEnabled` / `shipping.toleranceMeters` / `fason.shrink*` satırı **yok** → kod varsayılanları (aşım AÇIK, tolerans 5 m) |
| `numeric(12,3)` (dev) | `1.2345→1.235`, `1.2355→1.236`, `-1.2345→-1.235`, `0.0005→0.001` |

---

## HOTSPOTLAR

② denetçilerinin öncelikle bakması gereken yerler (dosya:satır — neden). Sıra: veri etkisi büyükten küçüğe. Metin içindeki `HOTSPOT #n` etiketleri bu listenin numaralarıdır (§2.H iade tablosunun satır etiketleri `R1..R6`).

1. **`src/services/tambur-undo.service.ts:1563-1577` vs `:1143-1152` / `:1330-1345`** — FULL `currentQty: restored` **SET**, SINGLE/arşiv `increment`; `initialBump` üç yerde üç yazım (`newCurrent − initial` / `restored − initial`). Kaynak `TAMBUR_CONSUMED` ama `currentQty ≠ 0` ise (aşımlı kesim sonrası? prod'daki 2 satır `SUBCONTRACTOR_RETURN` + `IN_PRODUCTION`) SET ile increment farklı sonuç verir; hangi yol o 2 satırı üretti, tekrar üretilebilir mi? (`scripts/test_tambur_undo §5/§11` kapsamı: FULL+DEPO ve üretim SINGLE — SET/increment ayrımını ölçüyor mu?)
2. **`src/services/tambur.service.ts:2235-2248` (`cutWarehouseRoll`)** — `cutLength == currentQty` kesimi parent'ı `0/0` bırakır, **statü `WAREHOUSE` kalır**; `finalizeWarehouseCut` ayrı istek. Prod: `T190826F0119/F0120` 0 m canlı depo topu (adet sayımları, "Sütunlar/Depo" listeleri, çuvala okutma guard'ı `NON_SACKABLE` 0 m'yi engellemez [VARSAYIM]). `SACK_ABSENT`/`K18` süzgeçleri 0 m topu dışlamaz.
3. **`src/services/inventory.service.ts:978` + `:866` + `helpers/duplicate-guard.helper.ts:69`** — P2002 replay eşitliği ve mükerrer-ikiz sorgusu **ham** `data.initialQty` ile, DB 3 ondalığa yuvarlar, Zod ondalık kısıtı yok (`inventory.controller.ts:23`). 4+ ondalıklı yük: replay → `CLIENT_TOKEN_COLLISION` 409 (meşru retry reddi), ikiz → kaçırma; kilit anahtarı `toFixed(3)` ile sorgudan farklı yuvarlanıyor. Prod'da 3 ondalıklı satır 0 (mobil 1 ondalık üretiyor) — Electron/manuel giriş yolu ölçülmeli.
4. **`src/services/workorder.service.ts:2485-2495`** — fason kapanış bakiyesi "Dönen" = makbuzu olan kalemin **tüm** `dispatchedQty`'si; kısmi makbuz (`isPartial=true`, 2026-08-19 modeli) da tam dönmüş sayılır → "fasonda kalan = totalQty − dönen − fasondan" eksik; ayrıca float Σ. Benzer: `subcontractor.service.ts:4316-4323` makbuz listesi `totalQty = Σ dispatchedQty` (receivedQty değil).
5. **`qtyOut` NULL kapanışları** — `workorder-manual-move.service.ts:649`, `workorder-split.service.ts:369/486`, `subcontractor.service.ts:2071-2083`; sözleşme `helpers/roll-disposition.helper.ts:334-337` yalnız 0/qtyIn tanımlıyor. Prod'da 14 satır. Okuyucular `reports/production.report.service.ts:177`, `work-session-activity.service.ts:403`; `test_consistency §12` muafiyet listesi (`roll-disposition.helper.ts:61-64` "önek" türetimi) bu üç notu kapsıyor mu?
6. **`src/services/shipping.service.ts:1305-1313` (`computeSackAllocations`) ve `:1469-1471` (`previewCreateShipment`)** — çuval topları `SACK_ABSENT_STATUSES` süzgeçsiz; liste (`:1187`) ve belge (`:3437`) süzüyor. PLANNED tahsis hayalet metrajla yazılabilir (DISPATCH `:1835` guard'ı sevki keser ama `SackAllocation` satırı kalır; önizleme rakamı listeyle ayrışır). Prod'da hayalet 0 — 2026-07-30 guard'ları sayesinde; yine de iki yüzey iki kural.
7. **`src/services/shipping.service.ts:3646` `netKg: sk.weightKg`** — şema `Sack.weightKg` "**Brüt** tartı (kumaş + dara)" (`schema.prisma` Sack:14); ambalaj/çeki belgesinde net diye basılıyor; `:3514` çuval kg'sı çuvalın **ilk** topuna yazılıyor (satır bazlı okuyan yüzey topa kg atfeder). Dara alanı/ayarı yok. Gümrük/ihracat belgesi (`EXPORT` tartı zorunlu `:1283`).
8. **`src/services/order.service.ts:1539-1543` `netGap`** — tek kelepçesiz "açık" hesabı (diğer 12 nokta `max(0)` ya da `>0` süzgeçli); negatif `netGap` istemciye gider. Tüketici (Electron kapsama paneli) negatifi nasıl basıyor? [VARSAYIM]
9. **`src/services/helpers/coverage.helper.ts:34-39` `FINISHED_OUTPUT`** — `finished` yalnız {WAREHOUSE, A1_STOCK, SHIPPED, SCRAP}; `AT_KARTELA`/`KARTELA_CONSUMED`/`CANCELLED` çıktılar "bitmiş" sayılmaz → `inFlight = committed − finished` kartelaya giden ya da iptal edilen çocuk kadar **şişer** ve sonsuza dek "üretimde" kalır (denge `uretilecek`'i düşürür). `producedOutputWhere` (`workorder:1705-1713`) ise AT_KARTELA/KARTELA_CONSUMED'ı çıktı sayıyor — iki tanım ayrışık.
10. **`src/services/tambur.service.ts:1050`** — finalize çocuğu `width = wo.width ?? roll.width` (PLAN eni), diğer üç kesim yolu `parent.width` (ölçülen). Plan kapısı ±10 cm sapmayı onayla geçirir (`tambur-plan-gate:113`), çocuk plan eniyle doğar → tahsis birebir `Decimal.equals` (`allocation:45`) satıra oturur, fiziksel en farklı. `RollPlanDeviation` kaydı var ama `Roll.width` plan değerini taşır.
11. **En eşitliği üç semantik** — `Decimal.equals` (tahsis/kapsama) · `Number !==` (`workorder-link:238`, `subcontractor:3268`) · `|Δ|>10` (plan kapısı): 145 cm top / 140 cm sipariş → kapı geçer, tahsis eşleşmez → sevkte "fazla/eşleşmeyen" uyarısı (`shipping:1507`).
12. **Zod en tavanları** — `workorder.controller.ts:268/272` + `workorder-link:622` **1 000 cm** vs `tambur-manual.controller.ts:87` 999 999 vs `inventory.controller.ts:26/71/130`, `workorder.controller.ts:24/298`, `subcontractor.controller.ts:150` **999 999 999** vs `order.service.ts:766` 100 000. mm girişi (1 400) çoğu uçta cm olarak kabul edilir; tahsis `Decimal.equals` eşleşmez (sessiz surplus).
13. **`src/services/inventory.service.ts:2037/2057, 2066-2081`** — tek SQL-float + satır `round1` + toplam yeniden `round1` yolu (fasondaki stok özeti); aynı ekranın kardeş rakamları (`subcontractor:3926` Decimal) ile ayrışabilir. Küçük etki, örüntü değeri yüksek.
14. **`src/services/sack-search.service.ts:424/427`** — Decimal→float `+=`; aynı dosyanın diğer iki ucu aggregate/Decimal. Çuval içeriği ekranı ile liste toplamı ayrışma adayı (1-ondalık veride nadir).
15. **`src/services/workorder.service.ts:1868/1882` vs `:2209-2224`** — liste `producedMeters` (adım başına `Number` sonra float Σ, fire `notIn fireCodes`) vs detay (Decimal, `bucketOf`); küme aynı (`producedOutputWhere`) ama aritmetik ve fire-dışlama mekanizması farklı (bilinmeyen kod: liste **sayar**, `bucketOf` → warehouse **sayar** — tutarlı; null kod ikisi de sayar).
16. **`src/services/order.service.ts:132-147` vs `shipping.service.ts:3651-3674`** — sipariş tutarı toplamda `toFixed(2)`, fatura satırı yuvarlamasız Decimal çarpım → kuruş farkı adayı; `unitPrice` `Number`'a çevrilip Decimal'e sokuluyor (12,2 kayıpsız).
17. **`src/services/helpers/order-status.helper.ts:164-178`** — `COMPLETED` kararı **toplam** üzerinden tolerans 5 m (prod'da ayar satırı yok → 5): 3 kalemli siparişte tek kalem 4,9 m eksik → COMPLETED; kalem bazlı "açık" (`openLineWhere`) o kalemi hâlâ açık gösterir (liste vs statü ayrışması) — bilinçli mi?
18. **`src/services/subcontractor.service.ts:496-592`** — kısmi doğrudan sevk çocuğu: parent'tan **hem `currentQty` hem `initialQty`** düşülür (Tambur `cutOpenFabric` yalnız `currentQty` düşer); `computeWoInput` (`coverage.helper:269-272`) bunu geri ekliyor; `TAMBUR_SPLIT` entrySource ile doğuyor (`:537`) → `producedOutputWhere` birinci-nesil SPLIT kuralına takılır mı? (fason sevk çocuğu `producedInStepId` null [VARSAYIM] → küme dışı; ② doğrulasın.)
19. **`src/services/tambur.service.ts:3320-3323` yorum↔kod** — "initialQty artık güvenilir değil" deyip fallback olarak `parent.initialQty` kullanıyor; `:1169-1172` `totalQty`, `inventory:4411-4414` `currentQty`. `qtyIn` 0/null olan (KK1 kenarı) hareketlerde üç yol üç farklı çıkış metrajı yazar.
20. **`src/services/kartela.service.ts:678-681`** — kartela kabulünde kaynak top `KARTELA_CONSUMED` olur ama `currentQty` korunur (Tambur/fason tüketimi `0` yazar). `computeWoMaterial.finished` KARTELA_CONSUMED'ı saymaz (HOTSPOT #9 ile aynı kök), `K18_DEAD` liste dışlar; "tüketilmiş topta metraj" iki farklı sözleşme.

---

## SINIR ÖTESİ NOTLAR

| Gözlem | Yönlendirme |
|---|---|
| `qtyOut NULL` okuyucuları: `reports/production.report.service.ts:177` (`null` → `qty: null`), `work-session-activity.service.ts:403`; `reports/subcontract-scorecard:159` işaret kuralı (SCRAP eksi / OVERAGE artı); `reports/_shipped.ts:59-80` brüt SQL union (`RollReturn.qty` geri-ekleme, DirectShipment) — `attachTotals`/`accounting-export`/`getShipmentById` ile aynı kural mı, bekçisi var mı; `round1` ×2 tanım (`_breakdown.ts:32`, `quality-scorecard:219`); `fmtTr` ×3 (2/1/1 ondalık) | **K7b (hesap: raporlar/belgeler/etiket)** [VARSAYIM: alan adı] |
| Etiket alan değerlerinde metraj biçimi (`helpers/label-field-values.ts` — `currentQty` grep 0; alan adı farklı), çuval etiketi sayacı "aynı küme" iddiası (`shipping:1185`) | K7b / BLG |
| `Roll.weightKg` prod'da 0/2431 dolu; `WorkOrderToOrderLine.allocatedQty` hep 0; `WorkOrder.targetQuantity/targetWeight` hesapta yok; `SubcontractorReceiptItem.receivedQty` 635/638 NULL; `currentQty ≤ initialQty` CHECK yok (yalnız bekçi §13); CHECK'lerin tamamı `NOT VALID` | **K2 (şema/DB kataloğu)** |
| `attachTotals` RepeatableRead **batch** tx (`shipping:2592-2610`, künyedeki tek `isolationLevel`); `touchOrderLinesTx` sıralı kilit protokolü (`order-status.helper:19-40, 205-210`) ve üç uygulayıcısı; `changeWidth` tx **dışı** best-effort (`subcontractor:3264-3275`); çekme sapması tx içi (`roll-variance.helper:8-11`); undo FULL "hepsi-ya-hiç" (`tambur-undo:1496-1498`) | **K3 (tx/eşzamanlılık)** |
| Zod: ondalık kısıtı yok; en tavanları tutarsız (HOTSPOT #12); `receivedQty` `positive().nullish()` (`subcontractor.controller:119`); `appliedWidth` `max(999_999_999)`; `weightKg` her yerde `positive` (0 kg reddedilir) | **K1 (rota/giriş doğrulama)** |
| Mobil `resolveReturns` (`round2`, büyük toptan, `QTY_EPSILON`), KK1 `Number(manualQty)` yuvarlamasız, metre cihazı `decimals=1`; Electron metraj alanlarında `step` yok — 4+ ondalık üretimi ölçülmeli (HOTSPOT #3 tetikleyicisi) | **Mobil/Electron turu** |
| `inventory.service.ts:2094` `oldestDays = floor(ms/86_400_000)` UTC gün sınırı; `subcontractor:2075` `now() AT TIME ZONE 'UTC'` | K7b / TZ (code-review-skill §3.6) |
| `computeLoadedByLine` (`allocation.helper:125-171`) çağıranı bu turda bulunamadı — ölü mü, Electron'a mı gidiyor? | K-mimari / ölü kod |
| `system-setting.service.ts:1606-1610` `fasonShrinkTolerancePct` yazımı (CLAUDE.md "`<=0→null` YASAK") okunmadı | K-ayarlar |

---

## KAPSANMAYAN / ERİŞİLEMEYEN

- **Rapor servisleri (`src/services/reports/*`, 16 dosya `round1` kullanıyor) ve belge render'ları** (`document-render/*`) — yalnız formatlayıcı tanımları ve `_shipped.ts` başlığı tarandı; hesap satırları K7b.
- **Etiket yüzeyi** (`label.service`, `label-field-values`, PPLB) — okunmadı.
- **Electron ve mobil hesap ikizleri** — yalnız mobil `receivePayload.helper.ts:80-160` (görev metni adlandırdığı için) ve KK1 ekranı grep düzeyinde; "istemci brütü elle kurmaz" (CLAUDE.md 2026-08-03) doğrulanmadı.
- **`kursun-qc.service.ts`** — yalnız `qtyIn: m.qtyIn` (`:918`) grep'i; KK2 metraj mantığı `inventory.finishProcessQc` üzerinden haritalandı, `kursun-qc` gövdesi okunmadı.
- **`kursun-bypass.service.ts`** — yalnız kapanış raw UPDATE'i (`:2343`); atama/dağıtım metrajları okunmadı.
- **Import adaptörleri** (`services/import/adapters/*.ts` — CSV metraj/en parse ve yuvarlama) — kapsam dışı; K-import.
- **`duplicate-rolls.service.ts`**, **`master-data-merge`** (birleştirmede miktar taşınıyor mu) — okunmadı.
- **`shipping.service.ts:2900-2970`** (`getShipmentById` sorgu süzgeci) — `sk.rolls` için `SACK_ABSENT` süzgeci [VARSAYIM] doğrulanmadı (§4.3).
- **`subcontractor.service.ts:1340-1360`** sevk kalemi `dispatchedQty` yazımı — `qtyIn: r.currentQty` (`:1347`) görüldü, kalem satırı [VARSAYIM] `dispatchedQty = currentQty`.
- **`computeLoadedByLine` çağıranları** bulunamadı (grep yapılmadı) — §SINIR ÖTESİ.
- **Bekçi içerikleri** — `test_consistency.ts §12/§13`, `test_tambur_undo §5/§11`, `test_semi_finished_surfaces`, `test_fason_partial_receive` gövdeleri okunmadı; yalnız başlık/satır referansı. "Bekçi neyi ölçüyor" sorusu ②'ye bırakıldı.
- **Canlı prod** — erişim yok; ölçümler 2026-08-25 kopyası (190/195 migration: `SubcontractorReceiptItem.receivedQty`/`isPartial`, `remainderClosedAt`, `RollVariance.sourceRefId` gibi son 5 migration'ın etkisi kopyada **görünmez**, bu yüzden fason çekme/kalan-kapama satırları 0).
- **Decimal→double hassasiyeti** — teorik (12,3 → 15 anlamlı basamak sınırında; en büyük prod değeri ~700 m) — ölçülmedi.
- **`fason.shrinkTolerancePct` / `fason.shrinkWarnEnabled`** uyarı yüzdesi hesabı (istemci tarafı mı sunucu mu) — bulunamadı, okunmadı.
