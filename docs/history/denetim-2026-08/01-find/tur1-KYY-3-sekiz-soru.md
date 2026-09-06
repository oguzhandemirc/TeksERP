# TUR 1 — KYY-3: Kritik yazma yolu SEKİZ SORU analizi (KYY-03, 06, 09, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 51)

**Denetçi:** KYY-3 (grup: numara mod 3 == 0, 17 yol) · **Tarih:** 2026-08-28 · **Dal:** `adnansahin` · **HEAD:** `ce8681d1`
**Mercek:** kod merkezli — kritik yazma yolu 8-soru (`teks-erp-denetim-promptu-v2.md` Bölüm 4 ZORUNLU) + Bölüm 3 A/B/D/E kesişimi.
**Yöntem:** her yol için (1) K10 değişmezleri → (2) tx sınırı `dosya:satır` → (3) check-then-act → (4) kilit/claim/advisory (İLK ifade mi) → (5) küme/aralık kararı (write skew/phantom) → (6) DB kısıtı son savunma → (7) İKİ AKTÖRLÜ ÇİZELGE (T1..Tn, gerçek fonksiyon + satır + Node yield noktaları) → (8) fabrikadaki gerçek etki. **Yalnız (7)'ye EVET olanlar bulgu oldu**; "HAYIR — neden" satırları tabloda bırakıldı.
**Ölçüm kaynakları:** dev `adnansahin_db` (repro), prod kopyası `tekserp_saha_0825` (salt-okunur K2), 5 repro scripti (`Teks-Erp/scripts/audit_repro_KYY-3-0*.ts`, logları `audit/repro/KYY-3-0*.log`).
**Yazma izni:** yalnız bu dosya + 5 repro scripti. Kaynak ağaca (src/prisma/Electron/mobil) dokunulmadı; feature-flag/SystemSetting DEĞİŞTİRİLMEDİ (KYY-3-05 reprosu `tambur.overQuantityEnabled`in **varsayılan AÇIK** olmasına dayanır, ayar satırı yaratılmadı — log ilk satırında kanıtı var).

**Repro özeti (K3):**

| Script | Ne sınandı | Sonuç |
|---|---|---|
| `audit_repro_KYY-3-01.ts` | KYY-03: iki eşzamanlı sevk onayı ∥ aynı kalem · sevk ∥ son çuvalı çıkarma | **4 ihlal** — `shippedQty=200/100`, sipariş COMPLETED, hata YOK; 1/25 turda çuvalsız DISPATCHED |
| `audit_repro_KYY-3-02.ts` | KYY-06: `cancelReturn` ∥ `undoDispatch` (20 tur) + koruma sondası | Yarış **0/20 (ÇÜRÜTÜLDÜ)**; koruma sondası **2 ihlal** — guard gerçekten yok, tek savunma karşı taraf |
| `audit_repro_KYY-3-03.ts` | KYY-30/51: `dispatch` ∥ `cancelOrderLine` (30) · `dispatch` ∥ `reopen` (20) | **PG `40P01 deadlock detected`** üretildi (1-2/30 · 1-2/20), Prisma **P2039** → sınıflandırılmamış **500** |
| `audit_repro_KYY-3-04.ts` | KYY-21: `attachRolls` ∥ `softDelete` (25 tur) | **24/25 tur** — iptal edilmiş WO'nun adımında 3 `IN_PRODUCTION` top, **iki çağrı da başarılı** |
| `audit_repro_KYY-3-05.ts` | KYY-15: aynı depo topuna iki eşzamanlı aşımlı kesim (12 tur) | **12/12 tur** — 100 m parent'tan 2×120 m çocuk, OVERAGE defteri 40 m (olması gereken 140 m) |

---

## 1. SEKİZ SORU — yol yol

Sütunlar: **S1** korunan değişmez (K10 ID) · **S2** tx sınırı · **S3** check-then-act · **S4** kilit/claim (sıra) · **S5** küme kararı / write skew · **S6** DB kısıtı (son savunma) · **S7** iki aktörlü çizelge → bozuluyor mu · **S8** fabrikadaki etki.

---

### KYY-03 — Sevk onayı `PLANNED→DISPATCHED` (`performDispatchTx`) + kalan düşümü + belge dondurma

| # | Cevap |
|---|---|
| **S1** | INV-SEV-01 (defter-otoritatif `shippedQty`) · INV-SEV-04 (`preShipStatus`) · **INV-SEV-08 (Σ sevk ≤ istenen — hiçbir yerde zorlanmıyor)** · INV-SEV-11 (`ShipmentOrder.isActive`) · **INV-SEV-12/13** (EXPORT tartı / boş sevkiyat) · INV-SEV-16 + INV-DOC-03 (irsaliye v1 aynı tx) · INV-SM-04 |
| **S2** | Tek tx: `shipping.service.ts:1905` (`prisma.$transaction((tx) => this.performDispatchTx(...))`) → gövde `:1806-1883`. **Tx DIŞI ÖNCESİ:** `:1890-1903` (findUnique + `status` üçlü kontrol + `sacks.length===0` + `assertExportWeighed`). **Tx SONRASI:** `AuditService.log :1906` (best-effort). `withBarcodeRetry` YOK. |
| **S3** | **EVET, iki tanesi tx içinde TEKRARLANMIYOR:** boş sevkiyat (`:1894`) ve EXPORT tartı (`:1895`). Sevkiyat statüsü tekrarlanıyor (claim). |
| **S4** | `tx.shipment.updateMany({id, PLANNED})` **:1812** → `count===0 → 409` ✓ (satır kilidi + claim, tx'in İLK ifadesi). Sonra hayalet guard `:1834` (fail-closed), `shipmentOrder.updateMany :1849`, `roll.groupBy :1856` + statü grubu başına `updateMany :1862`, **`touchOrderLinesTx :1878`** (tam küme, id-SIRALI — protokol ✓), `recomputeOrderStatusForOrders :1879`, `freezeForSource :1881`. Edinim sırası **H(shipment) → R(rolls) → L(orderLines, sıralı) → O(order) → PD**. |
| **S5** | İki küme kararı var. (a) **"çuval kümesi boş mu"** — tx dışında okunuyor, `removeSackFromShipment` (`:1573`, `touchShipmentPlannedTx` ile aynı shipment satırını kilitler ama **PLANNED şartıyla**) araya girip commit ederse claim yine PLANNED görür → **phantom kapatılmamış**. (b) **"bu kalemin kalanı"** — `computeSackAllocations :1318` `need = quantity − shippedQty` ve `shippedQty` yalnız DISPATCHED sayar (INV-SEV-01) → **iki PLANNED sevkiyat aynı ihtiyacı iki kez tahsis eder** ve dispatch anında yeniden tahsis/kontrol YOKTUR. |
| **S6** | `order_lines.shippedQty ≥ 0` CHECK, `quantity > 0` CHECK, `printed_documents (docType, sourceId, version)` unique, `shipments.status` enum. **`Σ sevk ≤ quantity` için DB kısıtı YOK** (K10 §4). `DISPATCHED ⇒ ∃ çuval` için kısıt YOK. |
| **S7** | **EVET — iki ayrı çizelge, ikisi de repro edildi.** ① **Fazla sevk:** T1 `dispatchShipment(S1)` :1890 pre-read → *await/yield* → :1812 claim → :1878 `touchOrderLinesTx(L)` → :1879 recompute (`computeLineLedger` yalnız DISPATCHED sayar → S1'in 100 m'si) → commit. T2 `dispatchShipment(S2)` aynı L için :1878'de **bloklanır**, T1 commit'ten sonra devam eder ve ledger 100+100=200 okur → `orderLine.shippedQty=200`, `Order.status=COMPLETED`. **Kilit doğru çalışıyor (lost-update yok) ama kural yok** → 100 m istenen kaleme 200 m sevk, hata yok. ② **Boş sevkiyat:** T1 `dispatchShipment(S3)` :1897 `sacks.length===0` kontrolünü GEÇER (1 çuval var) → *await/yield* → T2 `removeSackFromShipment(S3, CV)` :1573 `touchShipmentPlannedTx` (PLANNED ✓) → çuvalı söker → commit → T1 :1812 claim (hâlâ PLANNED ✓) → **DISPATCHED, 0 çuval, 0 top**; `freezeForSource :1881` boş irsaliyeyi DONDURUR. |
| **S8** | ① Müşteriye siparişin iki katı mal çıkar; sipariş ekranı "tamamlandı" der, "Açık" negatife düşüp arayüzde kelepçelenir; iade/iskonto muhasebe dışı çözülür. ② Kapıdan araç çıkmadan "sevk edildi" damgası + içeriği boş resmi irsaliye; storno bile `restored=0` döner. |
| **Bulgu** | **KYY-3-03** (fazla sevk) · **KYY-3-04** (boş sevkiyat / EXPORT tartı) |

---

### KYY-06 — İade iptali (`cancelReturn`, top `SHIPPED`'e döner)

| # | Cevap |
|---|---|
| **S1** | INV-SEV-03 (`R.status=SHIPPED ⇔ çuvalın sevkiyatı DISPATCHED`) · INV-SEV-06 (storno kuralları) · INV-SEV-05 (brüt) · INV-DOC-03 (`RETURN_DISPATCH` void/revize) |
| **S2** | Tek tx: `return.service.ts:879-937`. **Tx ÖNCESİ:** `:808` rr okuma, `:834-846` şekil guard'ları, `:855` recency guard (`newerReturn`), `:870-877` `restoreSackId` varlık kontrolü (**havuz**). **Tx SONRASI:** audit `:940`. |
| **S3** | **EVET:** `restoreSackId` tx dışında çözülüyor (`:870`) ve tx içinde tazelenmiyor; `newerReturn` (`:855`) tx içinde tekrarlanmıyor (top claim'i ikinci iptali kesiyor). |
| **S4** | `tx.roll.updateMany({id, status: expectedStatus, shipmentId: null, sackId: null})` **:882** + `count===0 → 409` ✓ — pre-check'in atomik ikizi. `tx.rollReturn.update :901` **koşulsuz** (roll claim'i kapıyor). `voidForSource :920` (idempotent updateMany) ∕ `reissueForSourceTx :927` (**claim `{id, ACTIVE}` → count 0 → 409**, `printed-document.service.ts:761`). **`lockShipmentScopeTx` (8023) ALINMIYOR** — grep: yalnız `shipping.service.ts:2159` (`undoDispatch`) ve `return.service.ts:490` (`createReturn`). |
| **S5** | Karar tek satırlık (bu iade kaydı + bu top) — küme kararı yok. Ama **sevkiyatın statüsü hiç okunmuyor**: `:846` yalnız `fromShipmentId` varlığına bakar. |
| **S6** | `roll_returns.cancelledAt` (soft), `rolls.shipmentId` DEFERRABLE FK, `printed_documents` unique. **`SHIPPED ⇒ sevkiyat DISPATCHED` için DB kısıtı YOK.** |
| **S7** | **HAYIR (yarış) / EVET (koruma yok).** Çizelge denendi (repro `KYY-3-02` [A], 20 tur): T1 `cancelReturn(RR)` :882 claim → :901 `cancelledAt` → commit. T2 `undoDispatch(S)` :2159 `lockShipmentScopeTx` → :2172 `rollReturn.count({fromShipmentId, cancelledAt:null})`. **İki yazım da AYNI tx'te atomik olduğu için** T2 ya RR'yi aktif görür (→ 409 `aktif iade var`) ya da RR iptal + top zaten `SHIPPED+shipmentId=S` olarak görür (→ `groupBy/updateMany :2196` topu birlikte geri çeker). **0/20 ihlal.** ⚠️ Ama `[B]` koruma sondası gösterdi ki `cancelReturn` sevkiyat PLANNED iken de **hatasız** çalışıp topu `SHIPPED + shipmentId=<PLANNED sevkiyat>` yazıyor: korumanın TAMAMI karşı taraftaki sayaç guard'ında. Tek noktalı savunma. |
| **S8** | Bugün üretilemiyor. Yarın "storno'yu zorla", "iade defteri düzeltmesi", elle SQL ya da `releaseSacks` benzeri yeni bir yol eklendiğinde depo ekranı topu göstermez, sevkiyat ekranı PLANNED der, `shippedQty` topu saymaz — top hiçbir yüzeyde bulunamaz. |
| **Bulgu** | **KYY-3-13** (S3, gizil/tek-noktalı savunma) |

---

### KYY-09 — Fason sevk (`dispatch`), toplu sevk (`bulkDispatchStep`), sevk iptali, aktarım

| # | Cevap |
|---|---|
| **S1** | INV-FAS-01 (`AT_SUBCONTRACTOR ⇒ açık SDI`) · INV-FAS-08 (bir sevk = bir parti) · INV-PAR-03/05 · INV-STK-11 (adım başına tek açık movement) · INV-DOC-01/03 (FS no + fason çeki v1) · INV-SM-03 |
| **S2** | `dispatch`: `subcontractor.service.ts:1036-1392`, **`withBarcodeRetry` sarmalı** (predicate YOK), parti audit'i `:1414` tx sonrası. `cancel`: `:2013-2148`. `bulkDispatchStep`: **tx YOK** — parti başına ayrı `this.dispatch()` çağrısı (`:1539-1554`). `transferToNextFason`: `receive()` + `bulkDispatchStep()` iki AYRI tx (belgeli kısmi, `:1589-1590`). |
| **S3** | Pre-tx: idempotency küme-eşitliği guard'ı `:742` (`OPEN_OUTSTANDING`), kalem/rota/committed guard'ları `:809-947`. Tx içinde **WO statüsü TAZE doğrulanıyor** (`:1046` `woFresh`, yorum `:1042-1045`) ✓ ve cross-WO parti guard'ı tekrar koşuyor ✓. |
| **S4** | Sıra: **`touchWorkOrderTx` :1041 İLK** ✓ → taze WO/step → autoAttach claim `:1084` (`{id in, STOCK, currentStepId:null, sackId:null, shipmentId:null}`, count!==size→409) → step ACTIVE `:1108` → `ensureWorkOrderInProgress :1118` → parti dalı [`createBatchTx` → **8022 advisory `:126` İLK ifade**] → FS no `nextPrefixedSequence :1241` (kilitsiz max+1, `dispatchNo` unique + wBR) → `dispatch.create :1244` → `freezeForSource :1283` → `markTravelerCardDirtyTx :1294` → **roll çoklu claim `:1319`** count!==len→409 → movement/op/scan `:1337-1376`. |
| **S5** | "Bu adımda bekleyen toplar" kümesi tx içinde claim'le pinleniyor ✓. "Bu parti başka WO'ya mı ait" tx içinde tekrar ✓. Kısmi kabul penceresi: `acceptedReceiptItem :1963` / `dispatch.step.status :2099` pre-tx (iptal yolunda). |
| **S6** | `subcontractor_dispatches.dispatchNo` unique · `(dispatchId, rollId)` unique · CHECK `dispatchedQty > 0` · `roll_movements` partial unique `(rollId, workOrderStepId) WHERE exitedAt IS NULL` · `batchId` RESTRICT. **`clientToken` YOK** (idempotency yalnız küme-eşitliği guard'ı). |
| **S7** | **Yarış: HAYIR.** WO-first sıra + iki çoklu claim + tx-içi taze WO okuması bu yolu kapatıyor; `test_dispatch_claim_step_match` gerçek paralel sonda taşıyor (2→1 steal). **Ama `bulkDispatchStep` SEPARATE dalında SESSİZ KISMİ BAŞARI var:** `:1539` `for (const [, rollIds] of byBatch) { await this.dispatch(...) }` — try/catch YOK, `failed[]` YOK. T1 5 partili adımı toplu sevk eder; 3. partide bir top araya giren bir Tambur kesimi yüzünden `:1319` claim'ini kaybeder → 409 fırlar. **1. ve 2. parti AYRI tx'lerde COMMIT'lidir** (FS numaraları basılmış, toplar `AT_SUBCONTRACTOR`, fason çekileri donmuş) ama yanıt tek bir hatadır ve hangi partilerin gittiği yanıtta YOKTUR. Kardeş uç `cancelBulk :2183` aynı sınıfta `failed[]` döndürüyor → asimetri bilinçli bir seçim değil. |
| **S8** | Planlamacı "sevk olmadı" sanır; iki parti fasondadır, çekileri basılmamıştır, mal firmaya belgesiz gider. İkinci deneme `OPEN_OUTSTANDING` guard'ına ya da roll claim'ine takılıp farklı bir hata verir → "sistem karıştı" algısı. |
| **Bulgu** | **KYY-3-10** |

---

### KYY-12 — Fason makbuz iptali (LIFO) + aktarım geri alma

| # | Cevap |
|---|---|
| **S1** | INV-FAS-07 (LIFO) · INV-FAS-03 (kısmi kabul metrajı) · INV-FAS-04 · **INV-AUD-04 (CANCELLED ⇒ iptal izi kolonları)** · INV-SYS-06 (fiziksel DELETE yok) · INV-AUD-05 (`reversedAt`) |
| **S2** | `cancelReceipt`: `subcontractor.service.ts:4804-5010` (audit `:5010` tx sonrası). `undoTransfer`: `:5273-5491`. **Tx ÖNCESİ:** WO COMPLETED `:4744`, **LIFO guard `:4757-4775`**, cascade kapsam kontrolü `:4779-4800`. |
| **S3** | **EVET:** LIFO guard pre-tx ve tx içinde TEKRARLANMIYOR; `directShippedAt` (`:5254`, F6) pre-tx. |
| **S4** | Sıra: **`touchWorkOrderTx` :4807 İLK** ✓ → bornRolls taze `:4813` + downstream guard `:4827` → `rollMovement.deleteMany :4835` (**fiziksel**) → `rollProperty.deleteMany :4842` → `roll.updateMany → CANCELLED :4846` (**statü koşulsuz**, W kilidi altında) → **receipt claim `:4868`** `{id, cancelledAt:null}` count===0→409 (mutasyonlardan SONRA ama AYNI tx → rollback tutarlı) → movement yeniden aç → tam kalem claim `:4930` (`SUBCONTRACTOR_CONSUMED`→`AT_SUB`, count!==len→409) → **kısmi kalem increment claim `:4948`** (`{id, AT_SUB, currentStepId}`, `currentQty: {increment}`, count!==1→409) → op/property deleteMany → `rollVariance.updateMany reversedAt :4986`. |
| **S5** | "Bu topa dokunan daha yeni aktif makbuz" phantom sorusudur ve pre-tx sorulur. Ama W kilidi altında yeni makbuz doğamaz (receive de `touchWorkOrderTx` alır) → pencere yalnız "kilit alınmadan ÖNCE doğmuş makbuz"dur ve o da guard'ı geçemez (`createdAt > receipt.createdAt` şartı taze sorguda görünür). |
| **S6** | `subcontractor_receipts.cancelledAt` soft · `roll_variances.reversedAt` · `(receiptId, newRollId)` unique. **`rolls.cancelledAt/cancelledById/cancelReasonCode` NULLABLE** — CHECK yok. `roll_movements`/`roll_operations` append-only olduğu belgeli ama DB'de engel yok. |
| **S7** | **Yarış: HAYIR (çift geri koyma üretilemedi).** Çizelge: T1 `cancelReceipt(R1)` W kilidini `:4807`'de alır; T2 aynı makbuz için `:4807`'de bloklanır, T1 commit sonrası `:4868` claim'i `cancelledAt` dolu görür → 409 ✓. Farklı makbuzlar (R1 eski, R2 yeni) için LIFO guard'ı pre-tx okur ama T2'nin (R2) commit'i görünene kadar R1 reddedilir; R2 commit'ten sonra R1'in guard'ı temiz okur ve doğru sırada koşar ✓. Kısmi increment claim'i `AT_SUB + currentStepId` şartıyla ikinci geri koymayı keser ✓. **AMA:** `:4846` doğan topları `CANCELLED` yaparken `cancelledAt/cancelledById/cancelReason/cancelReasonCode` YAZMIYOR → INV-AUD-04 sistematik ihlali (sahada `parentReceiptId` dolu izsiz iptal: **1**; toplam izsiz iptal **134/230**). Ayrıca `rollMovement.deleteMany :4835` + `rollOperation.deleteMany :4964` append-only defterden **fiziksel siler** (INV-SYS-06 istisna listesinde yok; `reports/production.report.service.ts:109` operasyon sayıyor). |
| **S8** | "Bu top neden iptal edilmiş?" sorusunun cevabı 6 ay sonra (audit arşivlenince) tamamen kaybolur — kolona yazma kuralının (2026-08-22) var olma sebebi tam olarak budur. Silinen movement/operation satırları üretim raporunun adım sayımını geriye dönük düşürür. |
| **Bulgu** | **KYY-3-14** |

---

### KYY-15 — Tambur kesim (`cutOpenFabric` · `cutWarehouseRoll`)

| # | Cevap |
|---|---|
| **S1** | **INV-STK-02** (`currentQty ≤ initialQty`) · **INV-STK-03** (Σ çocuk ≤ parent; aşımda `RollVariance(OVERAGE)`) · INV-STK-01 (qty ≥ 0) · **INV-AUD-05** (sapma defteri tam) · INV-SYS-03 (clientToken replay) |
| **S2** | `cutWarehouseRoll`: tx `tambur.service.ts:2131-2275`; **tx ÖNCESİ**: parent okuma **`:2045` (havuz)**, statü/çuval/sevk guard'ları `:2063-2085`, **`exceedsRemaining = data.cutLength > Number(parent.currentQty)` `:2093`**, `readTamburOverQuantityEnabled() :2094`, barkod sayacı `generateRollBarcode(prisma) :2116` (**tx ÖNCE**), `resolveLabelIntent :2124`. Tx sonrası: P2002 replay `:2280`, audit `:2302`. `cutOpenFabric`: tx `:2789-2969`, `touchWorkOrderTx :2793` İLK. |
| **S3** | **EVET — kritik olan bu:** kesimin AŞIM mı NORMAL mi olduğu kararı (`:2093`) tx dışında okunan `parent.currentQty`'den veriliyor ve tx içinde tazelenmiyor. |
| **S4** | NORMAL dal: `tx.roll.update({ where: { id, status, shipmentId:null, sackId:null, **currentQty: { gte: cutLength }** }, data: { currentQty: {decrement}, initialQty: {decrement} } })` `:2242` → P2025 → 409 ✓ (guarded decrement = atomik claim, doğru desen). **AŞIM dalı:** `tx.roll.update({ where: { id, status, shipmentId:null, sackId:null }, data: { currentQty: 0, initialQty: 0 } })` `:2236` — **`currentQty` guard'ı YOK** (yorum `:2237-2239` bunu bilerek kaldırıldığını söylüyor: "0'a inmiş topta ek kesim"). Advisory lock yok, parent satır kilidi yalnız update anında. |
| **S5** | "Bu parent'tan çıkan çocukların toplamı" küme kararıdır ve tx dışındaki tek okumaya dayanır. Aşım payı `overageOf(cutLength, parent.currentQty) :2270` — yine **bayat** `parent.currentQty`. |
| **S6** | `rolls.currentQty ≥ 0`, `initialQty ≥ 0` CHECK'leri **aşımı görmez** (0/0 yazılıyor); **`currentQty ≤ initialQty` kısıtı YOK** (K10 §2.1); `clientToken` partial unique (yalnız aynı token'ı korur); `barcode` unique. |
| **S7** | **EVET — 12/12 turda üretildi** (`audit/repro/KYY-3-05.log`). Çizelge (parent 100 m, iki tablet aynı topu 120 m okuttu, `clientToken` yok — kesimde idempotency **opt-in**): T1 `cutWarehouseRoll` `:2045` parent okur (100) → *await/yield* → T2 `:2045` parent okur (**100**, T1 henüz yazmadı) → ikisi de `:2093` `exceedsRemaining=true` → T1 tx `:2132` child(120) create, `:2236` parent 0/0, `:2270` `OVERAGE = 120−100 = 20` → commit → T2 tx: `:2236`'nın WHERE'inde `currentQty` şartı **YOK**, `status`/`sackId`/`shipmentId` hâlâ eşleşiyor → **geçer**, ikinci child(120) doğar, `OVERAGE = 120−100 = 20` yazar. **Sonuç: 100 m parent → 240 m çocuk, defterde 40 m aşım (gerçek 140 m), iki çağrı da `success:true`.** |
| **S8** | Bitmiş depoya **yoktan 140 m kumaş** girer; iki barkodlu top da satılabilir statüdedir ve sevk edilebilir. Fabrika farkı ancak fiziksel sayımda görür, kaynağı bulamaz çünkü sapma defteri "20 m aşım" der. Ürün Dengesi, Stok Karnesi ve sipariş karşılama üçü birden şişer. |
| **Bulgu** | **KYY-3-01** (S1) |

---

### KYY-18 — KK2/Kurşun adım kapatma, yeniden açma, QC2 tamamlama, kurşun bitir

| # | Cevap |
|---|---|
| **S1** | INV-STK-05 (`qtyOut = qtyIn` backflush) · INV-STK-11 (adım başına tek açık movement) · INV-SM-03 (`recomputeStepStatus`) · INV-WO-04 (`completeWorkOrderIfStepsDone`) · INV-SM-01 (statü geçiş matrisi) |
| **S2** | `finishStep`: `kursun-qc.service.ts:843-947`; `reopenStep`: `:1090-1164`; `completeQc2`: `:441-497`; `kursunFinish`: `inventory.service.ts:4667-4821`. `reorderQueue`: **tx YOK** ama tek `$executeRaw ... FROM unnest(...)` (`:1665-1670`) → tek ifade = atomik ✓. `deleteError`: havuz, iki adımlı ama claim'li (`:720`). Audit hepsinde tx sonrası. |
| **S3** | Pre-tx okumalar var (`openMovements :789`, `rollIds :816`, `loadStationPropertyCaps(prisma) :415`, `closedMovements/loadLatestFinishTurn :1062`) ama hepsinin tx-içi atomik ikizi var. **İstisna:** `loadStationPropertyCaps` bayat kalabilir (istasyon özellik modu tam o an değişirse). |
| **S4** | `finishStep`: `touchWorkOrderTx :850` İLK ✓ → `assertKursunTabletMayWrite(tx) :869` → **raw `UPDATE roll_movements … WHERE "exitedAt" IS NULL AND "rollId" = ANY($1) RETURNING` `:888`** (kapsam daraltmalı koşullu kapanış = claim; `closed.length===0` → idempotent 200 `:907`) → son adımsa `finalizeRollsAtLastStep :936` (**barkod sayacı satır kilidi tx İÇİNDE**) → `completeWorkOrderIfStepsDone :943`. `reopenStep`: `touchWorkOrderTx :1093` İLK ✓ → çoklu claim `:1110` ∕ `:1128` count!==len→409 ✓. `kursunFinish`: `touchWorkOrderTx :4670` → movement claim `:4760` count===0→`raceLost`→idempotent 200 `:4807` ✓. |
| **S5** | "Bu adımda başka açık movement kaldı mı" küme kararı `rollId = ANY(...)` ile daraltılmış → araya giren yeni top süpürülmez (yorum `:878-882`) ✓. `completeWorkOrderIfStepsDone` sayımı WO satır kilidi altında ✓. |
| **S6** | `roll_movements` partial unique `(rollId, workOrderStepId) WHERE exitedAt IS NULL` (INV-STK-11'in DB seddi) · `roll_operations (rollId, stepId, type)` unique (QC2 çift kaydını keser) · `work_order_steps (workOrderId, stepSequence)` unique + `time_order` CHECK · `finalizedAt` trigger. |
| **S7** | **HAYIR.** Denenen çizelgeler: ① iki paralel `finishStep` → raw UPDATE `exitedAt IS NULL` koşullu kapanıştır, ikincisi 0 satır kapatır ve **idempotent 200** döner (`:907`) — istenen davranış. ② `finishStep ∥ kursunFinish` → ikisi de WO kilidini İLK alır, serileşir. ③ `completeQc2` WO kilidi almıyor ama `roll_operations` unique'i çift QC2 satırını DB'de keser (fail-closed). ④ `reorderQueue` tek ifade. **Not (bulgu değil, S3 gözlem):** `reopenStep` son-adım dalı `:1128` `SCRAP` topu `IN_PRODUCTION`'a geri çekiyor; `finalizeRollsAtLastStep` fire için `RollVariance` YAZMADIĞI için defter tutarsızlığı doğmuyor, ama `finalizedAt` damgası silinmiyor (yeniden finalize'de üzerine yazılıyor). Kalan risk düşük. |
| **S8** | — (bu yolda bulgu yok) |
| **Bulgu** | YOK. Kilit sırası ve claim disiplini bu yolda örnek niteliğinde (bkz. "Doğru yapılanlar"). |

---

### KYY-21 — İş emrine top bağlama / sökme (`attachRolls` · `detachRolls`; `quickStart`, "Yeniden Üretime Al")

| # | Cevap |
|---|---|
| **S1** | **INV-STK-12** (`IN_PRODUCTION ⇒ currentStepId ≠ NULL ∧ WO.status ∉ {CANCELLED, SUPERSEDED}`) · INV-STK-14 · INV-STK-11 · INV-PAR-04 · INV-WO-11 (manuel taşımanın simetrik kuralı) |
| **S2** | `workorder.service.ts:4444-4593` (`withBarcodeRetry` sarmalı), audit `logMany :4574` + `:4593` tx sonrası. **Tx ÖNCESİ:** `prisma.workOrder.findUnique(... steps)` **`:4398`** → **`:4411-4419` COMPLETED/CANCELLED/SUPERSEDED reddi** → `:4422` rota adımı kontrolü. `detachRolls`: `:5948-6063`. |
| **S3** | **EVET — bu yolun tek kusuru bu:** WO statüsü tx DIŞINDA okunuyor ve **tx içinde HİÇ tekrarlanmıyor**. |
| **S4** | Tx'te kilit sırası: **kilit YOK başta** → `roll.findMany :4451` → **`roll.updateManyAndReturn` claim `:4494`** `{ id: { in }, status: { in [STOCK, WAREHOUSE, A1_STOCK] }, sackId: null, shipmentId: null }` (kısmi → per-top `errorMessages`, politika YAZILI ✓) → `rollMovement.createMany :4530` → **`createBatchTx :4553` → 8022 advisory** → `recomputeStepStatus :4565` → **`ensureWorkOrderInProgress :4566`** (`updateMany {id, PLANNED}` — WO satırı **EN SONDA**). Sıra **R → 8022 → W** ("roll-first"). |
| **S5** | Claim `where`'i **iş emrine hiç bakmıyor** — top kümesi kararı WO'dan bağımsız. `ensureWorkOrderInProgress` yalnız `PLANNED` eşleşmesinde yazar; WO iptal edildiyse **sessiz no-op** (count kontrol edilmiyor, edilmesi de gerekmiyor — ama bu, iptali fark etmemenin ikinci yolu). |
| **S6** | `roll_movements` partial unique (aynı topun aynı adımda ikinci açık hareketini keser) · `batches` unique YOK (8022) · `rolls.batchId` SET NULL. **`IN_PRODUCTION ⇒ WO canlı` için DB kısıtı YOK** (K10 §4). |
| **S7** | **EVET — 24/25 turda üretildi** (`audit/repro/KYY-3-04.log`). Çizelge: T1 `attachRolls(WO, [3 barkod])` `:4398` WO okur (PLANNED ✓), `:4411` guard geçer → *await/yield* → T2 `softDelete(WO)` `:3295` iptal eder (CANCELLED, kartlar VOIDED) → commit → T1 tx `:4494` claim: WHERE'de WO yok → **3 top `IN_PRODUCTION` + `currentStepId = <iptal WO'nun 1. adımı>`**, `:4530` movement açılır, `:4553` parti doğar, `:4566` `ensureWorkOrderInProgress` PLANNED bulamaz → sessiz no-op. **İki çağrı da `success:true` döner.** Aynı desen `manualMove`'da da var: `manualMoveWoBlockReason(ctx.woStatus)` `workorder-manual-move.service.ts:543` **pre-tx**, tx `:596`'da başlıyor, roll claim `:599` WO'ya bakmıyor. |
| **S8** | Depo topu ekrandan kaybolur (artık `WAREHOUSE` değil), tablet okutamaz (kart VOIDED → `TravelerCard` guard'ı reddeder, Tambur finalize guard'ı reddeder), iş emri listesinde iptal göründüğü için kimse aramaz. CLAUDE.md'nin `manualMove` için yazdığı **"canlı ama kimsenin okutamadığı top"** çıkmazının aynısı — orada bilerek engellenmiş, burada açık. Çıkış yolu yalnız `roll:manual-adjust` ile "Kurtar" ya da elle SQL. Sahada bugün 0 örnek (36 `IN_PRODUCTION` topun hepsi `IN_PROGRESS` WO'da, 1'i PLANNED). |
| **Bulgu** | **KYY-3-02** (S1) |

---

### KYY-24 — Manuel taşıma · boyahaneye geri gönder · tebdil/split

| # | Cevap |
|---|---|
| **S1** | INV-WO-11 (CANCELLED/SUPERSEDED WO'da taşıma REDDEDİLİR) · **INV-STK-12** · INV-STK-05 (movement kapanış semantiği) · INV-STK-13 (hayalet movement yok) · INV-PAR-03 · INV-SM-03 |
| **S2** | `workorder-manual-move.service.ts:596-853` (`withBarcodeRetry`), audit `:853` tx sonrası. **Tx ÖNCESİ:** `loadContext(prisma)` `:538` (adımlar, `colorStep`, `woStatus`, `isWholeParty`) → **`manualMoveWoBlockReason(ctx.woStatus)` `:543-544`**. Split: `workorder-split.service.ts` P1 `:336` / P2 `:454` / P3 `:615`, `loadSplitContext(prisma) :231` pre-tx. |
| **S3** | **EVET:** WO terminal statüsü pre-tx (KYY-21 ile aynı sınıf). `cutBlockedRollIds` ise **tx İÇİNDE tekrarlanıyor** (`:632`) ✓ — ekip bu TOCTOU'yu bir yerde kapatmış, diğerinde değil. |
| **S4** | **Roll çoklu claim `:599` İLK** (`{id in, status in MOVABLE, sackId:null, shipmentId:null}`, count!==len→409) → renk sentezi `:619` → `cutBlockedNow :632` → movement `deleteMany :643` ∕ `updateMany :647` ∕ `createMany :651` → op deleteMany + `qualityGrade: null` `:667/:675` → parti [`createBatchTx :699` → **8022**] ∕ `isBatchLockedTx :733` → `deleteIfEmptyAndTraceless :748` → recompute `:813` → **`ensureWorkOrderInProgress :814`** → COMPLETED→IN_PROGRESS `:816` → kart `:821` → bypass void `:834`. Sıra **R → 8022 → W**. P3 `undyedMove` tersine **W İLK** (`:621`) — aile içinde iki farklı sıra. |
| **S5** | "Hedef sonrası adımlarda kesim var mı" phantom sorusu tx içinde tekrar soruluyor ✓. "Partide top kaldı mı" (`deleteIfEmptyAndTraceless :748`) — parti satırı kilit altında (8022 hâlâ tutuluyor). |
| **S6** | `roll_movements` partial unique · `work_orders.status` SUPERSEDED terminalliği yalnız KODDA · `batches.splitFromId/mergedIntoId` SET NULL. |
| **S7** | **EVET — KYY-21 ile AYNI kök neden** (ayrı bulgu değil, `related`). Ek gözlem (bulgu değil): `rollMovement.updateMany :647` kapanışı `qtyOut` YAZMADAN yapıyor → `exitedAt` dolu / `qtyOut NULL` hareket (INV-STK-05'in "uydurma" dalı; sahada **14 satır**). Okuyucular null'ı tolere ediyor (`getTravelerTrace:177`, `work-session-activity:403`) → bilinçli kabul edilmiş. |
| **S8** | KYY-21 ile aynı. Ayrıca P3 ile V1/P1/P2 arasındaki farklı kilit sırası (W-first ↔ roll-first) ABBA ailesini besliyor (bkz. KYY-3-09). |
| **Bulgu** | KYY-3-02 (ortak kök neden; ikinci çağrı yeri) |

---

### KYY-27 — Parti numarası (8022) + parti cerrahisi + parti düşürme

| # | Cevap |
|---|---|
| **S1** | INV-PAR-01 (parti no benzersiz DEĞİL — bilinçli) · INV-PAR-02 (sayaç veriden türer) · INV-PAR-03 · INV-PAR-06 · INV-SYS-04 (sayaç kilitleri) |
| **S2** | `createBatchTx` **çağıranın tx'ine katılır** (`batch.service.ts:229`); kendi tx'i YOK. Cerrahi: `moveRolls :374`, `mergeBatches :580`, `splitBatch :870` (wBR), `dropBatch` `workorder-batch-drop.service.ts:275-540` (wBR). |
| **S3** | Cerrahi yollarında tüm okumalar kilit sonrası taze ✓ (`moveRolls :386/:401`, `mergeBatches :597`, `dropBatch :292-316` — **model desen**). Dış çağıranlar WO statüsünü pre-tx okur (KYY-21/24). |
| **S4** | **`pg_advisory_xact_lock(8022, 1)` `batch.service.ts:126` — `generateBatchNumberTx`'in İLK ifadesi** ✓ (koruduğu üç okumadan önce: `readBatchShortNumberEnabled :128`, `readLastShortBatchSeqTx :162`, günlük `findMany :133`). **Anahtar SABİT (`8022,1`) → sistem geneli TEK seri kapı.** Kilit `pg_advisory_xact_lock` olduğu için **çağıranın tx'i bitene kadar** tutulur. |
| **S5** | Sayaç kararı ("en son kısa parti") tam olarak advisory lock'ın kapattığı phantom sınıfı ✓. `readLastShortBatchSeqTx` regex'i (`^P(0[1-9]\|[1-9][0-9])$`) load-bearing ve bekçili. |
| **S6** | **`batches.batchNumber` unique YOK** (bilinçli, `20260805120000`). Kimlik yalnız `id`. `subcontractor_dispatches.batchId` RESTRICT. |
| **S7** | **EVET (iki ayrı sonuç, ikisi de "yanlış veri" değil "hizmet kaybı"):** ① **Kilit süresi:** `subcontractor.dispatch` 8022'yi `:1140`/`:1231`'de alır ve tx **`:1392`'ye kadar** tutar; arada FS sayacı `:1241`, `dispatch.create` (nested items), **`freezeForSource :1283`** (belge snapshot'ı — ilişkileri okur), `markTravelerCardDirtyTx :1294`, ≤500 top claim'i `:1319`, movement/op/scan createMany `:1337-1376` var. O süre boyunca **hiçbir yerde yeni parti doğamaz** (mobil Hızlı İş Emri, `attachRolls`, `manualMove`, split, Tambur). Global tx bütçesi 20 s. ② **ABBA:** T1 `subcontractor.dispatch(WO-A)` → `touchWorkOrderTx(A) :1041` (WO satır kilidi) → … → 8022 ister. T2 `attachRolls(WO-A)` → … → `createBatchTx :4553` **8022 alır** → `ensureWorkOrderInProgress :4566` **WO-A satırını ister**. T2 8022'yi tutup WO-A'yı bekler, T1 WO-A'yı tutup 8022'yi bekler → **PostgreSQL deadlock detector** birini iptal eder. (Advisory lock'lar deadlock detector'a katılır.) Aynı ters sıra `manualMove :699→:814` ve split P1/P2'de de var. |
| **S8** | ① Vardiya başında 5 tablet aynı anda Hızlı İş Emri açarken bir toplu fason sevki koşuyorsa parti doğumları kuyruğa girer; kuyruk 20 s'yi aşarsa P2028 → 503, operatör "sistem dondu" der ve tekrar basar. ② Deadlock kurbanı istek **sınıflandırılmamış 500** alır (bkz. KYY-3-06) — retry sinyali yok, kullanıcı ne olduğunu bilmez. |
| **Bulgu** | **KYY-3-09** |

---

### KYY-30 — Sipariş iptali · kalem iptali · manuel kapatma · yeniden açma · düzenleme

| # | Cevap |
|---|---|
| **S1** | INV-SEV-01 · INV-SIP-02 (kalem iptali SOFT) · INV-SIP-06/07 · INV-SM-08 · INV-WO-01/02 (tip = bağın aynası) |
| **S2** | `cancelWithActions`: `order.service.ts:3138-3257` (**`CANCEL_WO` aksiyonları tx-ÖNCESİ** `:3133`, her biri ayrı tx, telafi YOK). `softDelete :2757-2849`. `cancelOrderLine :475-516` (audit `.catch` `:516`). `update :2386-2548`. `reopen :3392-3413`. `manualComplete :3318`. |
| **S3** | `getActiveShipmentLinks :2726/:3081/:3300` **pre-tx yalnız**; preview `blockers`/`affectedWoIds` pre-tx (`cancelOrderLine :459-473`); O3 WO-bağ guard'ı `:2361` pre-tx **ama tx-içi taze ikizi var** ✓. |
| **S4** | `cancelWithActions`: **O claim `:3144` İLK** → sıralı `touchWorkOrderTx :3172` → … → WO tip flip `:3242`. `softDelete`: O claim `:2760` → sıralı W `:2786` → … `cancelOrderLine`: **tek `orderLine` claim `:478`** (`{id, cancelledAt:null}`) → WO link deleteMany + tip flip `:493-500` → `markTravelerCardDirtyTx :505` → **`orderLine.findMany(orderId) :510` + `touchOrderLinesTx(hepsi) :512`** → `recomputeOrderStatus :513`. `update`: **O claim `:2521`** → `recomputeOrderStatus :2537` (**`touchOrderLinesTx` YOK**). `reopen`: **O claim `:3397`** → `recomputeOrderStatus :3411` (**`touchOrderLinesTx` YOK**). |
| **S5** | `recomputeOrderStatus` bir siparişin TÜM kalemlerinden türetilen bir invariant yazar (`shippedQty` + `status`) ve okuduğu küme (`sack_allocations` ⋈ DISPATCHED sevkiyat) phantom'a açıktır. `order-status.helper.ts:203-211` bunun için **yazılı bir kilit protokolü** tanımlar: *"çağıran, TAM satır kümesini `touchOrderLinesTx` ile TEK sıralı partide kilitlemeli"*. **Üç çağıran ihlal ediyor:** `cancelOrderLine` (iki parti: önce tek satır, sonra tam küme), `update :2537` ve `reopen :3411` (hiç kilitlemiyor, Order satırını önce alıyor). |
| **S6** | `orders.status` enum (geçiş seddi YOK) · `order_lines.shippedQty ≥ 0` CHECK · `work_order_to_order_lines.orderLineId` CASCADE · `stockprod_targetItem` CHECK. Denorm `shippedQty` için trigger YOK. |
| **S7** | **EVET — deadlock üretildi** (`audit/repro/KYY-3-03.log`). Çizelge (sipariş 6 kalemli, iptal edilen kalem id-sıralamasında SON): T1 `performDispatchTx` `:1878` `touchOrderLinesTx` → `order-status.helper.ts:38` id-sıralı döngü, L1..L5'i kilitler, **L6'yı ister**. T2 `cancelOrderLine(L6)` `:478` claim ile **L6'yı kilitler**, sonra `:512` tam-küme sıralı kilit için **L1'i ister**. → `40P01 deadlock detected` (1-2/30 tur). İkinci çizelge: T2 `reopen` `:3397` **Order satırını** kilitler, `:3411` recompute `order-status.helper.ts:130` L1..Ln'i ister; T1 dispatch L'leri tutup `:196` `tx.order.update`'te **Order satırını** ister → deadlock (1-2/20 tur). **Lost-update yok** (kilitler onu engelliyor) — protokol ihlalinin bedeli sessiz yanlış veri değil, **kaçınılabilir deadlock**. |
| **S8** | Sevk onayı ya da kalem iptali **sınıflandırılmamış 500** ile düşer (bkz. KYY-3-06); operatör "tekrar dene" sinyali almaz, sevkiyatın gerçekleşip gerçekleşmediğini bilmez ve tekrar basar. Bir üstteki mükerrer-sevk riskiyle birleşir. |
| **Bulgu** | **KYY-3-05** (+ **KYY-3-06** hata haritası) |

---

### KYY-33 — Refakat kartı: doğuş · baskı · print-event (otomatik revizyon) · void · okutma

| # | Cevap |
|---|---|
| **S1** | **INV-DOC-04** ("kâğıda basılan v = DB'deki v"; her sürüm `printed_documents`ta arşivli) · INV-WO-05/06 · INV-SM-09 |
| **S2** | `print`: tx `traveler-card.service.ts:213` (+ tx dışı BİR retry `:217-227`). **`recordPrintEvent`: `card` okuma `:350` ve `resolvePrintPlan(card)` `:364` HAVUZDA** (bilinçli/dokümante sınır `:340-347`); tx yalnız `:368-386` (`travelerCard.update` **koşulsuz** `version: plan.version` + `archivePrintedVersionTx :379`). `reprint`: read+1, claim'siz. `voidCard`/`scan`: havuz. |
| **S3** | **EVET:** `resolvePrintPlan` (sürüm kararı) tx dışında; tx içinde `card.version` tazelenmiyor ve `update`'in WHERE'inde beklenen sürüm YOK. |
| **S4** | `print`: claim yok — **DB unique** (`traveler_cards.workOrderId`) + P2002 retry. `voidCard`: havuz claim `{id, ACTIVE}` ✓. `recordPrintEvent`: **claim YOK** (koşulsuz update). `archivePrintedVersionTx`: `printedDocument.upsert` (`docType_sourceId_version`) + eski sürümleri SUPERSEDED yapan `updateMany` ✓. |
| **S5** | `planKey` sıra-bağımsız ve deterministik sıralı ✓ (`buildPlan` `orderBy` kullanıyor). Ama "bu kartın mevcut sürümü" tekil bir satır değeridir ve kilitlenmiyor. |
| **S6** | `traveler_cards.workOrderId/cardNumber/barcode` unique · **`traveler_cards.version` üzerinde tekillik YOK** · `printed_documents (docType, sourceId, version)` unique (upsert'ün `update` dalı bunu **sessizce** yutar). |
| **S7** | **EVET (dar).** Çizelge: kart v1, iş emri düzenlenmiş (içerik değişti). T1 `recordPrintEvent` `:350` card(v1) okur, `:364` `plan.version=2`, plan **A** → *await/yield* → planlamacı iş emrini tekrar düzenler → T2 `recordPrintEvent` `:350` card(**hâlâ v1**) okur, `:364` `plan.version=2`, plan **B** → T1 tx: card.version=2, PD v2 **create** (snapshot A) → T2 tx: card.version=2 (aynı), PD v2 upsert **update dalı** → snapshot **B** ile ÜZERİNE YAZAR. **Sonuç:** elde iki kâğıt var, ikisi de "v2" yazıyor, içerikleri farklı; arşivde v2 olarak yalnız B duruyor, A hiç arşivlenmedi. Kaynak kodun kendisi (`:340-347`) bu sınıfın tek-istemci varyantını "bilinen sınır" olarak kabul ediyor; **iki-istemci varyantı ek olarak bir SÜRÜM KAYBI üretiyor.** |
| **S8** | Kontrollü belge (ISO 9001 §7.5.3) izinde delik: "bu kâğıt hangi plana göre basıldı" sorusunun cevabı yanlış olur. Olasılık düşük (bir WO'nun kartını genelde tek kişi basar). |
| **Bulgu** | **KYY-3-15** (S3) |

---

### KYY-36 — Master-data birleştirme (8027) + mükerrer kuyruğu

| # | Cevap |
|---|---|
| **S1** | INV-MD-01 (`nameFold` partial unique `WHERE mergedIntoId IS NULL`) · **INV-MD-02 (tombstone yeni referans almaz, listelenmez)** · INV-MD-03 · INV-SYS-06 |
| **S2** | Tek tx `master-data-merge.service.ts:543-711`, **özel bütçe `{timeout: 120_000, maxWait: 10_000}`** (DB `statement_timeout=50s` ile ayrışıyor). Audit `:716` + `:737` tx sonrası; `markMerged` hook `:756` **tx DIŞI, best-effort**. |
| **S3** | `preview`/`acknowledgedConflicts` pre-tx ama `describeConflictTx` tx içinde TEKRAR koşuyor ✓. |
| **S4** | **`pg_advisory_xact_lock(8027, key)` `:546` — tx'in İLK ifadesi** ✓, koruduğu taze okumadan (`:553`) önce. Sonra guard'lar `:558-577` → `markSideEffectsTx :606` → kural başına `$executeRawUnsafe UPDATE` `:629` (44 kural / 29 tablo; tablo+kolon `MERGE_MAP` sabit, değerler `$n` bind) → **entity çoklu claim `:639`** `mergedIntoId` + `count !== sourceIds.length → 409` ✓ → fieldPicks ad çakışması `:686` (8027 altında) → `updateMany :698`. |
| **S5** | "Bu kayda başka referans kaldı mı" küme kararı 8027 + RESTRICT FK'larla kapatılıyor ✓. |
| **S6** | `nameFold` partial unique (**yumuşak kapı** — mükerrer varken migration index'i atlıyor; sahada `items_nameFold_key` YOK) · `duplicate_reviews (entity, pairKey)` unique · **`mergedIntoId` self-FK: `confdeltype = 'n'` (SET NULL) — dev DB'de 5 tabloda ÖLÇÜLDÜ.** |
| **S7** | **EVET — ama yarış değil, kısıt zinciri.** Çizelge (tek aktör bile yeter): T1 `merge(A → B)` → A tombstone, tüm referanslar B'ye taşındı. Günler sonra T2 `DELETE /api/customers/B/permanent` (`customer.routes.ts:220`, izin **`customer:write`** — `master-data:merge` DEĞİL) → `BaseService.hardDelete :1259` yalnız **P2003'e** güvenir; `customers_mergedIntoId_fkey` **SET NULL** olduğu için P2003 ÇIKMAZ → delete başarılı → **A'nın `mergedIntoId`'si NULL olur.** Sonuç: A canlı kayıt olarak dirilir, listelerde görünür, seçilebilir, `customers_nameFold_key` partial unique'ine geri girer (B'nin adıyla katlanmışsa DELETE `23505` ile düşer — o da açıklanamayan bir hata olur). `duplicate_reviews`ta `decision=MERGED` satırı asılı kalır. Sahada **9 tombstone** (items 6, subcontractors 3) → yol erişilebilir. |
| **S8** | "Birleştirdik, kapandı" denen mükerrer kart aylar sonra kendiliğinden geri gelir; fabrika aynı firmaya/kumaşa ikinci kez kart açar ve mükerrer paneli aynı çifti yeniden aday gösteremez (karar satırı MERGED). Geri alınamaz birleştirmenin izi bozulur (INV-MD-02). |
| **Bulgu** | **KYY-3-11** |

---

### KYY-39 — Kullanıcı-rol-yetki: yarat · ver/al/hedef-durum · şablon · pasifleştir/sil · son-admin (8025)

| # | Cevap |
|---|---|
| **S1** | **INV-YT-03 (son admin koruması: en az bir EFEKTİF `admin:users`/`admin:*` kalır)** · INV-YT-04 · INV-YT-02 (SoD) |
| **S2** | `grantPermission` tx `permission-management.service.ts:190-221`; `setUserPermissions` tx `:304-336` (**diff `:272-302` tx DIŞI**); `revokePermission` tx `:377-395`; `applyTemplate` **merge = batch `$transaction([...])` `:1011`**, **replace → `setUserPermissions`** (interactive) — aynı iş iki tx modeli; `deactivateUser` tx `:686-695` + post-tx `revokeAllForUser :696`; `deleteUser` tx `:747-762`; `createUser` **havuz, çok adımlı**. |
| **S3** | `existing/toAdd/toRemove/removesAdmin` diff'i tx DIŞI (`:272-302`) — güvenli yönde (pencerede eklenen admin `toRemove`'a girmez). |
| **S4** | **`acquireAdminGuardLock` = `pg_advisory_xact_lock(8025, key)` `:604-610`**, `assertAdminCoverageAfterChange :623` ondan SONRA ✓ (sıra doğru). Uygulandığı yerler: `setUserPermissions :306` (**yalnız `removesAdmin` ise**), `revokePermission :379` (`revokesAdminCode` ise), `deactivateUser :687` ✓, `deleteUser :748` ✓. **`grantPermission` yolunda kilit de guard da HİÇ YOK.** |
| **S5** | "Sistemde başka efektif admin var mı" **küme + zaman penceresi** kararıdır (`effectiveAdminWindow :586-595`: `validFrom ≤ now ∧ (validUntil ≥ now ∨ null)`). 8025 bu phantom'u doğru kapatıyor — **kilidin altına girmeyen mutasyonlar hariç.** |
| **S6** | `user_permissions (userId, permissionId)` unique · `permissions.code` unique · `users.username` unique + `users_username_lower_uq`. **"En az bir efektif admin" için DB kısıtı YOK** (yazılamaz). |
| **S7** | **EVET — tek aktörle bile.** İki delik: ① **`grantPermission` bir UPSERT'tür** (`:194`): var olan `admin:users` satırının `validFrom`/`validUntil`'ini **günceller**. Zod (`admin.routes.ts:339-342`) yalnız `validUntil`in GEÇMİŞTE olmasını reddeder; **`validFrom`in GELECEKTE olmasını hiçbir yer reddetmez** ve `validUntil = now + 1 sn` de geçerlidir. Çizelge: yönetici, sistemdeki son `admin:users` sahibine "yetkiyi 2027'den itibaren geçerli kıl" der → satır güncellenir → `effectiveAdminWindow` artık kimseyi döndürmez → **sistem yöneticisiz**. Guard koşmadı, uyarı yok, audit "CREATE USER_PERMISSION" der. ② **`setUserPermissions`in `removesAdmin` hesabı VARLIK bazlı** (`:299`: `currentHasAdmin && !targetHasAdmin`) — hedef listede `admin:users` **var ama gelecek tarihli** ise `removesAdmin=false` → guard atlanır → aynı sonuç. Bu, F253/F254 guard'ının "efektif pencere" hassasiyetiyle **çelişir** (guard pencereyi biliyor, tetikleyicisi bilmiyor). |
| **S8** | Kullanıcı yönetimi uçlarının tamamı (`admin:users`) kapanır; yeni kullanıcı açılamaz, izin verilemez, cihaz onaylanamaz. Çıkış yolu yalnız DB'de elle `UPDATE user_permissions`. Sahada bugün **0** süreli izin satırı ve **4** efektif admin var → olasılık düşük, ama guard'ın var olma sebebi tam bu senaryo. |
| **Bulgu** | **KYY-3-12** |

---

### KYY-42 — Cihaz eşleştirme / donanım atama / iptal / fiziksel silme

| # | Cevap |
|---|---|
| **S1** | INV-YT-05 (oturum/cihaz) · INV-SYS-06 (fiziksel silme istisnası: cihaz unpair — **belgeli**) |
| **S2** | Hepsi havuz yazımı. `assignHardware` **batch tx** `device.service.ts:263-268` (`deletePeripherals` + `createMany skipDuplicates`); `found :258` pre-tx. Audit `:269` tx sonrası. |
| **S3** | **EVET (dar):** `announce :174` `existing` okuması → `:180` `pendingCount` → `:187` `upsert`. Üç ifade arasında yield var. `assignHardware`'de `found` pre-tx (aktif donanım doğrulaması). |
| **S4** | Claim yok — `announce` idempotent `upsert` (`deviceId` unique) ✓; PENDING→kind düzeltmesi atomik `updateMany WHERE status=PENDING` ✓; `hardDelete` pivot guard'lı. |
| **S5** | **EVET:** `MAX_PENDING_DEVICES = 200` tavanı bir KÜME kararıdır (`count`) ve kilitsizdir. |
| **S6** | `devices.deviceId` unique · `peripheral_devices.code`, `(deviceId, peripheralId)`, `(peripheralId, kind)` unique. **Tavan için DB kısıtı YOK** (olamaz). |
| **S7** | **EVET (düşük etkili).** Çizelge: N paralel `POST /api/devices/announce` (uç **kimliksiz**, `device.middleware.ts:27-31` muaf, **rate limit YOK**) her biri farklı `deviceId` ile. Hepsi `:180`'de `pendingCount = 199` okur → hiçbiri 429 almaz → hepsi `:187`'de yeni PENDING satırı açar → tavan eşzamanlılık derecesi kadar aşılır. Tavanın gerekçesi (`:176-184`) "admin ekranı okunabilir kalsın"dır; aşım o oranda amacı zayıflatır. Yanlış veri üretmez. |
| **S8** | Cihazlar ekranında sahte kayıt sayısı tavanın üstüne çıkar; gerçek tablet aranırken bulunamaz (temizlik satır satır hard delete). LAN-only olduğu için erişim zaten fabrika ağıyla sınırlı. |
| **Bulgu** | **KYY-3-16** (S3) |

---

### KYY-45 — Audit yazımı + arşiv/purge (değiştirilemezlik trigger'ı, `SET LOCAL` kapısı)

| # | Cevap |
|---|---|
| **S1** | **INV-AUD-02 (audit değiştirilemez — UPDATE/DELETE/TRUNCATE trigger'la reddedilir)** · INV-AUD-03 (6 ay arşiv) · INV-AUD-01/INV-SYS-05 (best-effort) |
| **S2** | `AuditService.log/logMany/logEvent` **havuz, tx DIŞI, commit SONRASI, içte try/catch** (`audit.service.ts:18-20, :110, :153, :193`) — bilinçli. `archiveOlderThan` batch başına ayrı tx `:220-262`; `logsToArchive :208` tx dışı (id listesi sabit → idempotent ✓). |
| **S3** | `logsToArchive` pre-tx ama `deleteMany({ id: { in: ids } })` sabit id kümesiyle çalışıyor → check-then-act yok ✓. |
| **S4** | Kilit yok (tek process scheduler). **`SET LOCAL teks.audit_purge = 'on'` `:233` tx'in İLK ifadesi** ✓ (`deleteMany :261`'den önce; `test_audit_depth §10` **kaynak sırasını** da doğruluyor — bekçi doğru şeyi ölçüyor). |
| **S5** | Arşiv kümesi id ile pinlenmiş; `createMany skipDuplicates` + `deleteMany` iki paralel koşumda da idempotent ✓. |
| **S6** | `system_logs_block_tamper` / `system_log_archives_block_tamper` trigger'ları **VAR** (saha kopyasında `pg_trigger` ile doğrulandı) **ama gövdeleri `coalesce(current_setting('teks.audit_guard', true),'') = 'on'` koşuluna bağlı** (`20260819161000_audit_tamper_guard/migration.sql:48`) ve **varsayılan KAPALI**. Açma adımı ops reçetesinde: `docs/ops/SURUM-2.9.0-VERI-AKTARIMI-DEPLOY.md:635` (`ALTER DATABASE tekserp SET teks.audit_guard='on'`), kontrol listesi satırı **`:1080` hâlâ ☐**. |
| **S7** | **EVET — ama yarış değil, koruma zinciri.** ① Trigger'ın etkinliği bir **DB düzeyi GUC'a** bağlı; repoda hiçbir mekanik kontrol bunu ölçmüyor: `test_db_invariants.ts:293-306` yalnız **trigger'ın VARLIĞINI** kontrol ediyor ve `why` metni koruma yolunun elle açıldığını yazıyor. Bekçi *varlığı* ölçüyor, *etkiyi* değil (beceri §4.2'nin tam sınıfı). ② Kapı kapalıyken (ya da bir bakım oturumunda) **`scripts/reset-operational.ts:20` 30+ tabloyu `TRUNCATE` ediyor** — `system_logs` ve `system_log_archives` dahil — ve **hiçbir ortam kapısı yok**: `DATABASE_URL` neyi gösteriyorsa ona bağlanır. Repoda kapı deseni MEVCUT (`run-all-tests.ts:102 productionDbGate()`, hatta bu denetimin repro sözleşmesi bile `devDbGuard()` şart koşuyor) ama bu dosyada uygulanmamış. Dosya başlığındaki "sadece test ortamında çalıştır" bir **yorumdur**, guard değil. |
| **S8** | ① Kimin neyi değiştirdiği sorgulanabilir olmaktan çıkar (ISO 27001 A.8.15); bir kaydı düzeltip audit satırını da düzelten bir yol hiçbir iz bırakmaz. ② `npx tsx scripts/reset-operational.ts` fabrikanın sunucusunda tek komutla **tüm topları, iş emirlerini, siparişleri, sevkiyatları, fason kayıtlarını ve audit defterini** geri alınamaz biçimde siler. Geri dönüş yalnız yedekten restore. |
| **Bulgu** | **KYY-3-07** (S1, kapısız TRUNCATE) · **KYY-3-08** (S2, audit_guard) |

---

### KYY-48 — Mobil OTA deposu (LAN ikizi) + Electron güncelleme adresi

| # | Cevap |
|---|---|
| **S1** | Yok — **bu yolda sunucu tarafı YAZMA YOKTUR.** İlgili değişmezler istemci/yayın tarafında (manifest yayın anında donar + imzalanır). |
| **S2** | Tx yok. `mobile-update.service.ts` yalnız `fsp.stat` (`:88`) + `res.sendFile`; `depoDurumu()` salt-okuma. |
| **S3** | Yok (karar yok, yazma yok). |
| **S4** | Yok — gerekmiyor. |
| **S5** | Yok. |
| **S6** | Yok (dosya sistemi). |
| **S7** | **HAYIR.** Yol kaçışı doğru kapatılmış: `dosyaYolu :64-76` `path.resolve` **SONRASINDA** kök-altı prefix kontrolü yapıyor (kodlanmış/karışık ayırıcı yolları da yakalar), dizin isteği 404 (listeleme yok), `manifestGorelYolu :102-108` regex + `.`/`..` reddi. Uçlar **bilinçli PUBLIC** (`app.ts:578-582`, bekçi EXEMPT'inde) çünkü tablet eşleşmeden token alamaz. |
| **S8** | — |
| **Bulgu** | YOK. (Sınır ötesi not: `{*yol}` ile APK dahil her depo dosyası kimliksiz servis ediliyor + rate limit yok — LAN-only kabulüne dayanıyor; G alanına ait.) |

---

### KYY-51 — Sipariş kalan düşümü hub'ı (`recomputeOrderStatus` + `touchOrderLinesTx`)

| # | Cevap |
|---|---|
| **S1** | **INV-SEV-01** (defter-otoritatif `shippedQty`) · **INV-SEV-08** (Σ sevk ≤ istenen — zorlanmıyor) · INV-SIP-02 (iptal kalem `shipped` ile sayılır, `cancelledAt == null` **gevşek** karşılaştırma load-bearing) · INV-SM-08 |
| **S2** | HTTP ucu yok; **çağıranın tx'i içinde** koşar. Tek yazıcı `order-status.helper.ts:130` (`OrderLine.shippedQty`) + `:196` (`Order.status/shippedQty`). |
| **S3** | Kendi içinde yok (her şey defterden yeniden hesaplanır — increment/decrement YOK, drift-free tasarım ✓). |
| **S4** | `touchOrderLinesTx :31-39` — **id-SIRALI `updateMany` döngüsü** (set-bazlı tek UPDATE'in kilit sırasını garanti etmemesi gerekçesiyle bilinçli; yorum `:28-30`). Çağıran protokolü `:203-211`'de YAZILI. Uyanlar: `performDispatchTx :1878` ✓, `cancelShipment :1975` ✓, `undoDispatch :2210` ✓, `subcontractor directShip :6233` ✓. **Uymayanlar:** `order.service.ts:2537` (`update`), `:3411` (`reopen`) — hiç kilitlemiyor; `:478→:512` (`cancelOrderLine`) — **iki parti** hâlinde kilitliyor. |
| **S5** | `computeLineLedger :46-79` `sackAllocation.groupBy` ⋈ `shipment.status = DISPATCHED` — **küme kararı**. Kümeye satır ekleyebilecek tek yol bir sevkiyatı DISPATCHED yapmaktır ve o yol tam-küme kilidini önce alır → uyan çağıranlar arasında phantom kapalı ✓. |
| **S6** | `order_lines.shippedQty ≥ 0` CHECK. **Denormun DB seddi YOK (trigger yok)** — K2a'nın "tek DB seddi olmayan denormalize alan" satırı. Saha drift: **0/281** (Q-SEV-01), **0/278** (Q-SM-08). |
| **S7** | **EVET (deadlock)** — bkz. KYY-30 S7; repro `KYY-3-03`. **Lost-update HAYIR:** protokol ihlali eden çağıranlar Order satırını önce kilitlediği için PostgreSQL bayat yazımı deadlock'a çeviriyor; yani ihlalin bedeli sessiz yanlış rakam değil, kaçınılabilir 500. **Ayrıca EVET (kural yok):** `Σ sevk ≤ quantity` hiçbir katmanda kontrol edilmiyor (KYY-03 S7 ①). |
| **S8** | bkz. KYY-3-03 ve KYY-3-05. |
| **Bulgu** | **KYY-3-03** · **KYY-3-05** (ortak) |

---
## 2. BULGULAR

### [KYY-3-01] Tambur aşım kesiminde parent guard'sız yazılıyor: iki eşzamanlı kesim 100 m'lik toptan 240 m çocuk üretir ve aşım defteri 100 m eksik yazar

| Şiddet | **S0→S1** | Kategori | A.1 (yarış/TOCTOU) + E (stok değişmezi) | Öncelik | **P0** | Modül | Tambur / envanter | Kanıt seviyesi | **K3** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Tambur "Top Kesme"de kesimin *aşım* (kayıtlıdan fazla ölçüm) olup olmadığı **transaction'a girmeden** okunan `parent.currentQty`'den karara bağlanıyor. Aşım dalında parent güncellemesinin `WHERE`'inde metraj şartı **bilerek yok** — bu, art arda yapılan aşım kesimleri için doğru bir karar, ama **eşzamanlı** iki kesim için koruma bırakmıyor. Sonuç: aynı 100 m'lik toptan iki adet 120 m'lik çocuk doğuyor, ikisi de satılabilir statüde, ve sapma defterine gerçek 140 m yerine 40 m yazılıyor. İki çağrı da `success: true` dönüyor.

**Kanıt.**
- `Teks-Erp/src/services/tambur.service.ts:2045` — parent **havuz client'ıyla, tx'ten ÖNCE** okunuyor:
  ```ts
  const parent = await prisma.roll.findUnique({ where: { id: rollId }, include: { properties: …, sack: … } });
  ```
- `:2093` — aşım kararı o bayat değerden:
  ```ts
  const exceedsRemaining = data.cutLength > Number(parent.currentQty);
  ```
- `:2236-2241` — aşım dalı, **metraj şartı olmayan** güncelleme (normal dalın `:2242` satırında `currentQty: { gte: data.cutLength }` var):
  ```ts
  ? await tx.roll.update({
      where: { id: parent.id, status: parent.status, shipmentId: null, sackId: null },
      data: { currentQty: 0, initialQty: 0 },
    })
  ```
- `:2270` — defter yine bayat değerle: `qty: overageOf(data.cutLength, parent.currentQty)`.
- **İkiz yol** `cutOpenFabric`: parent `:2692` (havuz), karar `:2747`, aşım dalı `:2922-2934`. Oradaki yorum gerekçeyi açıkça yazıyor ve **ardışık** kesim için haklı, **eşzamanlı** kesim için kör:
  ```ts
  // ⚠️ AŞIM DALINDA `currentQty > 0` ŞARTI YOK … Çifte-harcama koruması burada
  // ANLAMSIZ: 0'ın altına inilecek gerçek stok kalmadı; her aşım kesimi çocuk +
  // sapma satırı üretir (aşağıdaki defter), yani iz kaybolmaz.
  ```
  `cutOpenFabric`'te `touchWorkOrderTx :2793` var ama **yalnız serileştirir**; karar (`exceedsRemaining`) ve defter payı kilitten ÖNCE dondurulduğu için ikinci tx yine aynı bayat değerle yazar.
- **Koruma kontrolü (nereye bakıldı):** advisory lock → yok (`grep pg_advisory src/services/tambur.service.ts` = 0); satır kilidi → yalnız update anında; claim → aşım dalında **yok**; DB CHECK → `currentQty ≥ 0` / `initialQty ≥ 0` var ama 0/0 yazıldığı için tetiklenmez, **`currentQty ≤ initialQty` kısıtı DB'de YOK** (K10 §2.1); `clientToken` → **opsiyonel** (`cutOpenFabricSchema :80-110`), token'sız çağrıda idempotency yok (`test_tambur_cut_idempotency` bunu "opt-in kanıtı" diye yazıyor); feature-flag → `tambur.overQuantityEnabled` **varsayılan AÇIK** (`system-setting.service.ts:2613`, dev/saha'da ayar satırı YOK).

**Çakışma senaryosu.**
```
T1 (Tambur tablet A, 120 m okuttu)        T2 (aynı topu okutan 2. tablet / çift dokunuş)
:2045 parent.findUnique → currentQty=100
                                          :2045 parent.findUnique → currentQty=100  (T1 henüz yazmadı)
:2093 exceedsRemaining = 120>100 = true
                                          :2093 exceedsRemaining = true
:2131 tx BAŞLAR
:2132 child(120 m) create
:2236 parent.update WHERE {id,status,sackId:null,shipmentId:null}  → currentQty=0, initialQty=0
:2264 RollVariance OVERAGE qty = 120-100 = 20
      COMMIT
                                          :2131 tx BAŞLAR
                                          :2132 child(120 m) create
                                          :2236 aynı WHERE hâlâ EŞLEŞİR (metraj şartı yok) → 0/0
                                          :2264 RollVariance OVERAGE qty = 120-100 = 20
                                                COMMIT
SONUÇ: 100 m parent → 2 × 120 m çocuk (240 m), defterde 40 m aşım (gerçek 140 m),
       iki çağrı da success:true, hiçbir 409 yok.
```

**failure_mode.** Bitmiş depoda 100 m kayıtlı bir top (`T190826F0119` sınıfı) iki tablette 120 m olarak okutulup kesilirse envantere **yoktan 140 m kumaş** girer; iki barkodlu top da `WAREHOUSE` statüsündedir, çuvala okutulabilir ve sevk edilebilir. Sapma raporu "20 m aşım" der, yani farkın kaynağı defterden bulunamaz.

**Veride fiili ihlal (K2).** `tekserp_saha_0825`: `SELECT source, COUNT(*), SUM(qty) FROM roll_variances WHERE kind='OVERAGE' GROUP BY 1;` → `TAMBUR_OVERCUT | 37 | 382.100`. Aynı parent'tan 60 sn içinde ≥2 çocuk: 514 satır — ama bu Tambur'un normal çoklu kesimidir, ayırt edici değil. **Fiili ihlal ARANDI, kesin kanıt bulunamadı** (parent `initialQty` de düşürüldüğü için orijinal metraj rekonstrüksiyonu mümkün değil — bu, hatanın kendi izini silmesidir ve ayrıca bir sorundur).

**Repro (K3).** `Teks-Erp/scripts/audit_repro_KYY-3-05.ts` → `audit/repro/KYY-3-05.log`. **12/12 turda** üretildi: "2 kesim başarılı, 2 çocuk toplam 240 m (parent 100 m) · OVERAGE defteri 40 m (olması gereken 140 m)". Bayrağa dokunulmadı (log ilk satırı: "aşım bayrağı ayar satırı: YOK → varsayılan AÇIK").

**İş etkisi.** Envanter, Ürün Dengesi, Stok Karnesi ve sipariş karşılama aynı anda şişer; fazla top müşteriye sevk edilirse sipariş "fazla sevk" olur (bkz. KYY-3-03) ve fark ancak fiziksel sayımda görülür.

**Öneri (2. tur için).** Kararı ve defter payını **tx içinde, kilit altında taze** ver: aşım dalını da guard'lı yaz —
```ts
const fresh = await tx.roll.findUnique({ where: { id: parent.id }, select: { currentQty: true } });   // tx içi
const exceeds = data.cutLength > Number(fresh.currentQty);
… where: { id, status, sackId: null, shipmentId: null, currentQty: fresh.currentQty }   // optimistic guard
```
ya da `pg_advisory_xact_lock(<yeni NS>, hashtext(parentRollId))` ile parent başına serileştir (**yeni namespace**; 8021/8022'ye bindirme — beceri §4.1). Ardışık aşım kesimi senaryosu korunur (taze okuma 0 ise `exceeds` yine true, defter payı bu sefer **gerçek** kalanı yansıtır). Şema/migration **GEREKMEZ**. `[PROD'DA ÇALIŞTIRMA]` gerekmiyor; geri alma = commit revert.

**Kabul kriteri.** `audit_repro_KYY-3-05.ts` 12/12 turda `INV-STK-03` ve `INV-AUD-05` kontrollerini YEŞİL vermeli (ikinci kesim ya 409 almalı ya da defterine gerçek aşımı yazmalı); `test_tambur_cut_idempotency`e "farklı token, aynı parent, paralel" sondası eklenmeli (K11 H-5 boşluğu).
**Efor.** 1 gün (kod 0,5 + bekçi 0,5).
**Önceki defter.** `audit/FINDINGS.jsonl`'de doğrudan eşleşme yok; K10 H-3 ("prod 2 defter-siz aşım") ile ilgili, K12'de reddedilmiş bir kalem değil.

---

### [KYY-3-02] `attachRolls`/`quickStart` ve `manualMove` iş emri statüsünü transaction dışında okur: iptal edilen iş emrine canlı top bağlanır ("kimsenin okutamadığı top")

| Şiddet | **S1** | Kategori | A.1 (TOCTOU) + E (statü değişmezi) | Öncelik | **P0** | Modül | İş emri / envanter | Kanıt seviyesi | **K3** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** "Bitmiş Depo → Yeniden Üretime Al" (`quickStart` → `attachRolls`) ve "Konumu Düzelt" (`manualMove`) iş emrinin COMPLETED/CANCELLED/SUPERSEDED olup olmadığını **tx'e girmeden** kontrol ediyor; tx içindeki top claim'i iş emrine **hiç bakmıyor**. Planlamacı iş emrini iptal ederken operatör top okutursa toplar `IN_PRODUCTION` + iptal edilmiş WO'nun adımına yazılıyor ve **her iki istek de başarılı dönüyor**. Bu, `manualMove`'un kendi belgesinde "yapılmamalı" diye tarif ettiği durumun (CLAUDE.md 2026-07-30: *"taşınan top 'canlı ama kimsenin okutamadığı' çıkmaza düşerdi"*) tam kendisidir.

**Kanıt.**
- `Teks-Erp/src/services/workorder.service.ts:4398` — WO **havuz client'ıyla** okunuyor; `:4411-4419` guard:
  ```ts
  if (wo.status === COMPLETED || wo.status === CANCELLED || wo.status === SUPERSEDED)
    throw AppError.conflict("Tamamlanmış veya iptal edilmiş iş emrine top bağlanamaz.");
  ```
- `:4444` tx başlıyor; `:4494` claim **WO'ya hiç bakmıyor**:
  ```ts
  const claimed = await tx.roll.updateManyAndReturn({
    where: { id: { in: candidateIds }, status: { in: [STOCK, WAREHOUSE, A1_STOCK] }, sackId: null, shipmentId: null },
    data: { status: IN_PRODUCTION, producedInStepId: firstStepId, currentStepId: firstStepId },
  });
  ```
- `:4566` `ensureWorkOrderInProgress` = `updateMany({ where: { id, status: PLANNED } })` (`helpers/roll-step.helper.ts:180-183`) → WO iptal edilmişse **sessiz no-op**, `count` bakılmıyor.
- İkiz yol: `src/services/workorder-manual-move.service.ts:538` `loadContext(prisma)` (havuz) → `:543-544` `manualMoveWoBlockReason(ctx.woStatus)` → tx `:596`, roll claim `:599` yine WO'suz. Aynı dosya `cutBlockedRollIds`'i **tx içinde tekrar** okuyor (`:632`) — yani ekip bu TOCTOU sınıfını biliyor, bir kontrolü kapatmış, WO statüsünü kapatmamış.
- **Koruma kontrolü:** WO satır kilidi → `attachRolls`ta **hiç yok** (`touchWorkOrderTx` çağrılmıyor; `manualMove`'da da yok, yalnız P3 `undyedMove` alıyor); advisory → yok; DB kısıtı → `IN_PRODUCTION ⇒ WO canlı` için **yok** (K10 §4'te "yalnız yazma yollarının disiplini" yazıyor); trigger → yok.

**Çakışma senaryosu.**
```
T1 (operatör: Bitmiş Depo → Yeniden Üretime Al)   T2 (planlamacı: iş emrini iptal et)
:4398 workOrder.findUnique → status=PLANNED  ✓
:4411 guard geçer
                                                  softDelete(:3295) → status=CANCELLED, kart VOIDED, COMMIT
:4444 tx BAŞLAR
:4494 roll claim (WO'ya bakmaz) → 3 top IN_PRODUCTION + currentStepId=<iptal WO 1. adım>
:4530 rollMovement.createMany (açık hareket)
:4553 createBatchTx → yeni parti doğar
:4566 ensureWorkOrderInProgress → PLANNED yok → SESSİZ no-op
      COMMIT + audit "status: IN_PRODUCTION" yazılır
SONUÇ: iki istek de success; 3 top canlı, iş emri iptal.
```

**failure_mode.** Depoda duran 3 bitmiş top ekrandan kaybolur (`WAREHOUSE` değil artık), tablette okutulamaz (kart VOIDED → refakat kartı guard'ı ve Tambur finalize guard'ı reddeder), iş emri iptal göründüğü için kimse aramaz. Toplar ne stok raporunda ne üretim panosunda görünür; çıkış yolu yalnız `roll:manual-adjust` yetkili "Kurtar" ya da elle SQL.

**Veride fiili ihlal (K2).** `tekserp_saha_0825`: `IN_PRODUCTION` topların WO statüsü kırılımı → `IN_PROGRESS 36`, `PLANNED 1`, **CANCELLED/SUPERSEDED 0**. Yani sahada bugün **0 ihlal** (arandı).

**Repro (K3).** `Teks-Erp/scripts/audit_repro_KYY-3-04.ts` → `audit/repro/KYY-3-04.log`. **24/25 turda** "WO=CANCELLED, adımda 3 IN_PRODUCTION top — ok | ok". Kontrol sondası: WO **zaten** CANCELLED iken çağrı doğru şekilde reddediliyor (`"Tamamlanmış veya iptal edilmiş iş emrine top bağlanamaz."`) — yani pre-tx guard'ın kendisi doğru, eksik olan tx-içi ikizi.

**İş etkisi.** Fabrikada iptal genelde "yanlış açtım, kapat" anıdır ve tam o sırada sahadaki operatör okutmaya devam eder. Kaybolan mal bitmiş depo malıdır (satılabilir), yani doğrudan sevk edilebilir stok kaybı.

**Öneri (2. tur için).** İki katmanlı, ikisi de gerekli: (a) `attachRolls` ve `manualMove` tx'lerinin **İLK ifadesi** `touchWorkOrderTx(tx, workOrderId)` olsun ve statü tx içinde TAZE doğrulansın (`subcontractor.dispatch :1041-1055` deseninin birebir kopyası — `woFresh` guard'ı orada zaten var); (b) roll claim'inin `where`'ine WO bağı eklenemez (top henüz WO'ya bağlı değil), o yüzden (a) zorunlu. ⚠️ `attachRolls` bugün **roll-first** kilit alıyor; WO kilidini başa almak onu fason sevk ailesiyle **aynı sıraya** getirir ve KYY-3-09'daki ABBA'yı da kapatır — iki bulgu tek düzeltmeyle çözülür. Şema/migration/izin **GEREKMEZ**.

**Kabul kriteri.** `audit_repro_KYY-3-04.ts` 25/25 turda YEŞİL (T1 ya 409 alır ya hiç yazmaz); `test_wo_warehouse_attach`e paralel iptal sondası eklenir; `test_consistency` §20 ailesine "IN_PRODUCTION top ⇒ WO ∉ {CANCELLED, SUPERSEDED}" sorgusu eklenir (INV-STK-12 bugün hiçbir bekçide ölçülmüyor).
**Efor.** 1 gün.
**Önceki defter.** — (K12'de reddedilmiş eşleşme yok; K3a §6 #3 ve #21/#22 bu pencereyi işaret ediyordu, burada ölçüldü.)

---

### [KYY-3-03] Sipariş kaleminin istenen metrajını aşan sevk hiçbir katmanda engellenmiyor: iki planlı sevkiyat aynı 100 m'yi iki kez tahsis eder, ikisi de sessizce sevk olur

| Şiddet | **S2** | Kategori | E (iş kuralı değişmezi) + A.1 | Öncelik | **P1** | Modül | Sevkiyat / sipariş | Kanıt seviyesi | **K3** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `computeSackAllocations` bir kaleme yazılacak tahsisi `need = quantity − shippedQty` ile sınırlıyor, ama `shippedQty` tanım gereği **yalnız DISPATCHED** sevkiyatları sayıyor (INV-SEV-01, bilinçli). Dolayısıyla iki ayrı PLANNED sevkiyat aynı kalemin tamamını tahsis edebiliyor ve sevk onayı anında **yeniden tahsis ya da kapasite kontrolü yapılmıyor**. İkisi de sevk edilince satırın `shippedQty`si istenenin iki katına çıkıyor, sipariş `COMPLETED` oluyor ve hiçbir hata/uyarı üretilmiyor. `touchOrderLinesTx` kilidi burada **doğru çalışıyor** (lost-update yok) — eksik olan kilit değil, **kuralın kendisi**.

**Kanıt.**
- `Teks-Erp/src/services/shipping.service.ts:1318-1321` — kapasite yalnız DISPATCHED'ten:
  ```ts
  const need = new Prisma.Decimal(l.quantity).minus(l.shippedQty);
  lineNeeds.set(l.id, need);
  if (need.greaterThan(0)) { allocLines.push({ … need … }); }
  ```
- `src/services/helpers/order-status.helper.ts:57-63` — `shipped` yalnız `shipment.status = DISPATCHED` + `DirectShipAllocation`; PLANNED sayılmıyor.
- `shipping.service.ts:1806-1883` (`performDispatchTx`) — sevk tx'inde **hiçbir kapasite kontrolü yok**; `:1878-1879` kilit + recompute var, `Σ ≤ quantity` yok.
- **Koruma kontrolü:** DB CHECK → `order_lines.shippedQty ≥ 0` var, üst sınır **yok**; trigger → yok; unique → `sack_allocations (sackId, orderLineId)` var (aynı çuvalın aynı satıra iki tahsisini keser, farklı sevkiyatı kesmez); uygulama guard'ı → yok. K10 §4 bu değişmezi zaten "HİÇBİR YERDE ZORLANMAZ" diye listeliyor.
- **Mevcut tek hafifletici:** sevkiyat önizlemesi `:1509-1519` "bu satırda başka açık sevkiyatta ~N m bekliyor (mükerrer sevk olabilir)" uyarısını basıyor. Bu bir **ekran uyarısıdır**, sevk yolunda karşılığı yok ve ikinci sevkiyatı kuran kişi ilkini görmeyebilir.

**Çakışma senaryosu.**
```
Kalem L: quantity=100, shippedQty=0
Planlamacı-1: Sevkiyat S1 kurar → SackAllocation(L, 100)   (need=100 okundu)
Planlamacı-2: Sevkiyat S2 kurar → SackAllocation(L, 100)   (need hâlâ 100 — S1 PLANNED)
T1 dispatchShipment(S1)                    T2 dispatchShipment(S2)
:1812 claim S1 → DISPATCHED
:1878 touchOrderLinesTx(L)  [L kilitli]
                                           :1878 touchOrderLinesTx(L) → BLOKLANIR
:1879 recompute → shipped=100 → L.shippedQty=100
      COMMIT
                                           (devam) :1879 recompute → shipped=100+100=200
                                                   L.shippedQty=200, Order.status=COMPLETED
                                                   COMMIT
SONUÇ: 100 m istenen kaleme 200 m sevk, 0 hata, sipariş "tamamlandı".
```
(Eşzamanlılık ŞART DEĞİL — ardışık iki sevk de aynı sonucu verir; eşzamanlılık yalnız kilidin bu kuralı korumadığını gösterir.)

**failure_mode.** 100 m istenen bir sipariş satırına iki ayrı irsaliyeyle 200 m mal çıkar; sipariş ekranı `COMPLETED` der, "Açık" hesabı `-100` çıkıp arayüzde 0'a kelepçelenir (13 kopya hesap, K7a §4.1), muhasebe export'u brüt 200 m yazar. Fabrika farkı müşteri iadesiyle öğrenir.

**Veride fiili ihlal (K2).** `tekserp_saha_0825`: `shippedQty > quantity` → **0**; defterden hesapla (`Σ DISPATCHED tahsis + directShip > quantity + 5`) → **0**; aynı kalemi taşıyan >1 PLANNED sevkiyat → **0**. Yani bugün ihlal yok (saha kopyasında 39 DISPATCHED + 1 PLANNED sevkiyat var, yani havuzda aynı anda iki planlı sevkiyat pratiği henüz oluşmamış).

**Repro (K3).** `Teks-Erp/scripts/audit_repro_KYY-3-01.ts` [A] → `audit/repro/KYY-3-01.log`: `OrderLine: istenen=100 shippedQty=200 · Order: COMPLETED shippedQty=200`, `sonuç: 2 başarılı, 0 hata`.

**İş etkisi.** Fazla sevk edilen mal ya iade edilir (iade defteri + irsaliye maliyeti) ya da müşteride bedelsiz kalır. Sipariş kapandığı için üretim planı da o kalemi kapatır.

**Öneri (2. tur için).** Karar iş sahibinindir; iki şık: **(a) UYARI ekseni (küçük):** `performDispatchTx`e sevk sonrası `Σ ≤ quantity + tolerans` kontrolü ekle ve aşımı `ApiResponse.warnings` ile döndür (rota kapsaması kararının emsali, CLAUDE.md 2026-08-27: "reddetmez, uyarır"). **(b) REZERV ekseni (büyük):** `need` hesabına PLANNED tahsisleri de kat (`shippedQty + Σ PLANNED tahsis`) → ikinci sevkiyat kalemi zaten dolu görür. (b) çuval havuzu modelinin "mühür/rezerv YOK" kararını değiştirir, o yüzden **iş kararı gerektirir**. Migration gerekmiyor; (b) seçilirse `distributeSacksToLines` ve önizleme uyarısı birlikte güncellenir.
**Kabul kriteri.** `audit_repro_KYY-3-01.ts` [A] ya `shippedQty ≤ 100+tolerans` ölçmeli ya da yanıtta aşımı adıyla söyleyen bir uyarı bulunmalı; `test_consistency`'ye Q-SEV-08 sorgusu **kırmızı verecek** şekilde bağlanmalı.
**Efor.** (a) 0,5 gün · (b) 2-3 gün.
**Önceki defter.** K10 §4 INV-SEV-08 (açık, ölçüm 0). K12'de reddedilmiş kalem değil.

---

### [KYY-3-04] "Boş sevkiyat sevk edilemez" ve "EXPORT çuvalı tartılı olmalı" kontrolleri yalnız transaction ÖNCESİ: çuvalsız bir sevkiyat DISPATCHED olup boş irsaliye donduruyor

| Şiddet | **S2** | Kategori | A.1 (TOCTOU) + D (tx sınırı) | Öncelik | **P1** | Modül | Sevkiyat | Kanıt seviyesi | **K3** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `dispatchShipment` sevkiyatın dolu olduğunu ve (yurtdışıysa) çuvalların tartıldığını tx'e girmeden doğruluyor; tx içindeki claim yalnız `status = PLANNED` şartını taşıyor. `removeSackFromShipment` de sevkiyat satırını **PLANNED şartıyla** kilitlediği için ikisi serileşiyor — ama sıra "önce çuval çıkar, sonra sevk et" olduğunda claim yine `PLANNED` bulup geçiyor. Sonuç: 0 çuvallı `DISPATCHED` sevkiyat ve içeriği boş, **donmuş** resmi irsaliye.

**Kanıt.**
- `Teks-Erp/src/services/shipping.service.ts:1890-1903` (tx DIŞI):
  ```ts
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { …, sacks: { select: { weightKg: true } } } });
  …
  if (shipment.sacks.length === 0) throw AppError.badRequest("Boş sevkiyat sevk edilemez");
  this.assertExportWeighed(shipment.sacks, shipment.destination);
  const shippedRolls = await prisma.$transaction((tx) => this.performDispatchTx(tx, shipmentId, data, userId));   // :1905
  ```
- `:1812` claim yalnız `{ id, status: PLANNED }` — çuval sayısı ve tartı tx içinde **tekrar sorulmuyor**.
- `:1573-1580` `removeSackFromShipment`: `touchShipmentPlannedTx` (`helpers/shipment-locks.helper.ts:88`, `updateMany {id, PLANNED}`) → `sack.updateMany {id, shipmentId} → shipmentId: null`.
- `setDestination :1590-1595` de yalnız `touchShipmentPlannedTx` alıyor → DOMESTIC→EXPORT geçişi dispatch'in pre-tx tartı kontrolünden sonra araya girebilir (INV-SEV-12'nin aynı sınıfı).
- **Koruma kontrolü:** DB kısıtı → `DISPATCHED ⇒ ∃ çuval` ve `EXPORT ⇒ weightKg > 0` için **yok** (K10 §4); trigger → yok; `freezeForSource :1881` boş içeriği reddetmiyor (builder boş listeyle belge üretiyor).

**Çakışma senaryosu.**
```
T1 dispatchShipment(S)                       T2 removeSackFromShipment(S, CV1)   (S'nin TEK çuvalı)
:1890 findUnique → status=PLANNED, sacks=[CV1]
:1897 "boş sevkiyat" kontrolü GEÇER
                                             :1548 touchShipmentPlannedTx(S)  → PLANNED ✓ (kilit)
                                             :1576 sack.updateMany → CV1.shipmentId = null
                                             :1578 roll.updateMany → shipmentId = null
                                                   COMMIT (S hâlâ PLANNED)
:1905 tx BAŞLAR
:1812 claim {id, PLANNED} → EŞLEŞİR → DISPATCHED
:1834 hayalet guard → 0 top, geçer
:1856 groupBy → 0 grup, flipped=0
:1881 freezeForSource → İÇERİĞİ BOŞ irsaliye v1 DONAR
      COMMIT — yanıt: { rollCount: 0 }, "Sevk edildi"
```

**failure_mode.** Sevk Kapısı'nda "Sevk Et" basılır, ekran "Sevk edildi — stok bina dışı" der, sevkiyat listesinde DISPATCHED görünür; içinde hiç çuval/top yoktur ve müşteriye verilecek irsaliye boştur. Storno denenirse `restoredRolls: 0` döner ve neyin geri geldiği anlaşılmaz. EXPORT varyantında tartısız çuval gümrük belgesine tartısız girer (INV-SEV-12'nin var olma sebebi).

**Veride fiili ihlal (K2).** `tekserp_saha_0825`: çuvalsız DISPATCHED sevkiyat → **0** (arandı).

**Repro (K3).** `audit_repro_KYY-3-01.ts` [B] → `audit/repro/KYY-3-01.log`: **1/25 turda** "sevkiyat DISPATCHED ama 0 çuval — fulfilled/fulfilled" (iki çağrı da başarılı). Pencere dar (pre-read ile claim arası ~1-3 ms) ama havuz doluyken / yavaş diskte genişler.

**İş etkisi.** Resmi belge (irsaliye) yanlış donar ve donmuş-belge kuralı gereği düzeltilemez, yalnız VOID edilip yenisi kesilir.

**Öneri (2. tur için).** İki pre-tx kontrolünü **claim'den sonra, tx içinde tekrarla** (hayalet guard `:1834`'ün hemen yanında; o guard zaten "kilit altındaki taze son savunma" diye yazılmış — aynı yere iki satır):
```ts
const sacks = await tx.sack.findMany({ where: { shipmentId }, select: { weightKg: true } });
if (sacks.length === 0) throw AppError.badRequest("Boş sevkiyat sevk edilemez");
this.assertExportWeighed(sacks, freshDestination);   // destination da tx içinde okunmalı
```
Migration/izin **GEREKMEZ**.
**Kabul kriteri.** `audit_repro_KYY-3-01.ts` [B] 25/25 YEŞİL (kaybeden taraf 409/400 alır); `test_shipment_undo_dispatch` ya da yeni bir bekçi paralel "son çuvalı çıkar ∥ sevk et" sondası taşır.
**Efor.** 0,5 gün.
**Önceki defter.** K3a §6 #17 bu pencereyi işaret ediyordu; burada ölçüldü.

---

### [KYY-3-05] `OrderLine`/`Order` kilit sırası iki yönlü: yazılı kilit protokolüne uymayan üç çağıran sevk onayı ile deadlock üretiyor

| Şiddet | **S2** | Kategori | A.1 (kilit sırası / ABBA) | Öncelik | **P2** | Modül | Sipariş / sevkiyat | Kanıt seviyesi | **K3** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `order-status.helper.ts` `recomputeOrderStatus` için açık bir kilit protokolü yazıyor: *"çağıran, etkilenen siparişlerin TAM satır kümesini `touchOrderLinesTx` ile TEK sıralı partide kilitlemeli"*. Sevkiyat tarafındaki dört çağıran uyuyor; **sipariş tarafındaki üç çağıran uymuyor** — `cancelOrderLine` iki parti hâlinde kilitliyor, `update` ve `reopen` hiç kilitlemeyip önce `Order` satırını alıyor. Bu, aynı satır kümesi üzerinde iki farklı edinim sırası demektir ve PostgreSQL deadlock detector'ı devreye giriyor.

**Kanıt.**
- Protokol: `Teks-Erp/src/services/helpers/order-status.helper.ts:203-211`
  ```
  KİLİT PROTOKOLÜ: recompute defteri KİLİTSİZ okur ve shippedQty'yi yazar —
  ÇAĞIRAN, bu çağrıdan önce etkilenen siparişlerin TAM satır kümesini
  touchOrderLinesTx ile TEK sıralı partide kilitlemeli (alt-küme kilidi +
  buradaki tam-küme yazımı = iki-parti edinim → deadlock riski; …)
  ```
- Uyanlar: `shipping.service.ts:1878` (dispatch), `:1975` (cancel), `:2210` (undo), `subcontractor.service.ts:6233` (directShip).
- **İhlal 1 — iki parti:** `order.service.ts:478` tek satır claim (`{id: lineId, cancelledAt: null}`) → … → `:510-512` tam küme `touchOrderLinesTx` → `:513` recompute.
- **İhlal 2/3 — kilitsiz + Order-first:** `order.service.ts:2521` Order claim → `:2537` `recomputeOrderStatus` (kilit yok); `:3397` Order claim → `:3411` `recomputeOrderStatus` (kilit yok).
- **Koruma kontrolü:** advisory lock → bu ailede yok; `isolationLevel` → verilmemiş (doğru seçim, sorun izolasyon değil sıra); retry → `withBarcodeRetry` bu yollarda ya yok ya da P2002'ye özel; DB kısıtı → konu dışı.

**Çakışma senaryosu.**
```
Sipariş O, kalemler L1<L2<…<L6 (id sırası). İptal edilen kalem: L6.
T1 performDispatchTx(S)                        T2 cancelOrderLine(O, L6)
:1878 touchOrderLinesTx([L1..L6]) sıralı:
      L1 kilitlendi … L5 kilitlendi
                                               :478 orderLine.updateMany {id:L6} → L6 KİLİTLENDİ
      → L6 istiyor … BEKLİYOR
                                               :512 touchOrderLinesTx([L1..L6]) sıralı → L1 istiyor … BEKLİYOR
      >>> 40P01 deadlock detected — biri iptal edilir <<<
```
İkinci çizelge (`reopen`): T2 `:3397` **Order** satırını kilitler → `:3411` recompute L1..Ln ister; T1 L'leri tutup `order-status.helper.ts:196` `tx.order.update`'te **Order**'ı ister → deadlock.

**failure_mode.** Sevk onayı (ya da kalem iptali) `Database error. Code: 40P01. Message: deadlock detected` ile düşer ve kullanıcıya **"Sunucu hatası oluştu."** (500) döner — bkz. KYY-3-06. Operatör sevkin gerçekleşip gerçekleşmediğini bilmez, tekrar basar; ikinci basış S1 zaten DISPATCHED ise 409 alır, değilse ikinci bir sevk kurar.

**Veride fiili ihlal (K2).** Aranmadı — deadlock kalıcı iz bırakmaz (tx geri sarılır); yalnız `system_logs` içindeki `SYSTEM/ERROR` + `code: P2039` satırlarından izlenebilir ve saha kopyasında audit hacmi (10k) bu sorguyu anlamlı kılmıyor. **Canlıda kontrol:** `SELECT COUNT(*) FROM system_logs WHERE "recordId"='P2039';`

**Repro (K3).** `Teks-Erp/scripts/audit_repro_KYY-3-03.ts` → `audit/repro/KYY-3-03.log`: [A] 1-2/30 tur, [B] 1-2/20 tur, hepsinde `Database error. Code: 40P01. Message: deadlock detected` — biri `order-status.helper.ts:38` (`touchOrderLinesTx`), biri `:130` (`recomputeOrderStatus`in satır yazımı).

**İş etkisi.** Vardiya sonu sevk yığılmasında (sevk onayı + sipariş düzenlemesi aynı dakikada) operasyon rastgele 500'lerle kesilir. Veri bozulmaz (rollback), ama kullanıcı bunu bilemez.

**Öneri (2. tur için).** Üç çağırana da protokolü uygula: `cancelOrderLine`de tek-satır claim'i **tam-küme kilidinden SONRA** yap (önce `touchOrderLinesTx(hepsi)`, sonra `updateMany {id: lineId, cancelledAt: null}` — claim'in atomikliği bozulmaz); `update :2537` ve `reopen :3411` çağrılarının hemen öncesine `touchOrderLinesTx(o siparişin tüm satırları)` ekle ve **Order claim'ini ondan sonraya al** (ya da `recomputeOrderStatus`u kilitli çağırana özel bir sarmalayıcıya taşı). Ek olarak protokolün mekanik bekçisi yazılsın (bugün `test_order_line_scope_single_source` yalnız AST metin muafiyeti ölçüyor, davranış sondası yok). Migration/izin **GEREKMEZ**.
**Kabul kriteri.** `audit_repro_KYY-3-03.ts` [A]+[B] 0 deadlock ile geçmeli.
**Efor.** 1 gün.
**Önceki defter.** K3a §6 #23 ve K10 H-9 "lost-update" olarak işaretlemişti; ölçüm **lost-update'i ÇÜRÜTTÜ** (kilitler onu engelliyor) ve gerçek bedelin **deadlock** olduğunu gösterdi — bu satır o kaydın düzeltilmesidir.

---

### [KYY-3-06] PostgreSQL deadlock'ı (`40P01`) Prisma `P2039` olarak geliyor; `P2034 → 409 + tekrar dene` haritası bu kurulumda ÖLÜ, her deadlock sınıflandırılmamış 500 üretiyor

| Şiddet | **S2** | Kategori | I (hata yolu / gözlemlenebilirlik) | Öncelik | **P2** | Modül | Çekirdek / hata middleware | Kanıt seviyesi | **K3** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Hata middleware'i "write conflict / deadlock" için özel bir dal taşıyor: `P2034 → 409 + "tekrar deneyin"`. Ama bu kurulumda Prisma **driver adapter** (`@prisma/adapter-pg`) kullanılıyor; PostgreSQL'in `40P01`'i Rust engine'in serialization yolundan geçmiyor, **`P2039`** (ham DB hatası) olarak geliyor. `P2039` ne `SERVER_FAULT_PRISMA_CODES` ne `CLIENT_DATA_PRISMA_CODES` kümesinde → "SINIFLANDIRILMAMIŞ" dalına düşüyor: **500 + "Sunucu hatası oluştu."** ve istemciye hiçbir tekrar-dene sinyali gitmiyor.

**Kanıt.**
- `Teks-Erp/src/middlewares/error.middleware.ts:514-524` — P2034 dalı (yorumu "ORM/engine seviyesinde kaçan serialization/deadlock içindir" diyor).
- `:150-170` — iki küme; **`P2039` ikisinde de yok**.
- `:556-585` — sınıflandırılmamış dal: `console.error` + `AuditService.logEvent({category:"SYSTEM", action:"ERROR", recordId: prismaErr.code, unclassified:true})` + `res.status(500)`.
- Ölçüm (`audit/repro/KYY-3-03.log`): `PrismaClientKnownRequestError/**P2039**: … Database error. Code: **40P01**. Message: **deadlock detected**`.
- KUNYE: "Prisma ^7.7.0 + `@prisma/adapter-pg` (driver adapter; Rust havuzu yok)".
- **Koruma kontrolü:** retry sarmalayıcı → `withBarcodeRetry` yalnız P2002'ye bakıyor (`p2002Mentions`); global retry yok; istemci tarafı → 500'ü "belirsiz" sayıp token yapıştırıyor (mobil `entryAttempt.ts` kuralı) ama masaüstünde otomatik tekrar yok.

**failure_mode.** İki eşzamanlı sipariş/sevkiyat işlemi deadlock'a girdiğinde kaybeden istek 500 alır ve mesaj "Sunucu hatası oluştu." olur. Kullanıcı geçici bir çakışmayı kalıcı bir arıza sanır; destek `/health`te `unclassified` sayacını görür ama hangi uçtan geldiğini yalnız `system_logs`tan çıkarabilir. Aynı sınıf **KYY-3-09**'daki 8022 ABBA'sı için de geçerlidir.

**Veride fiili ihlal (K2).** Saha kopyasında `system_logs` içinde `recordId='P2039'` **aranmadı** (kopya 2026-08-25, audit hacmi 10k ve bu satırlar `SYSTEM/ERROR` kategorisinde seyrek). Canlıda tek sorgu: `SELECT COUNT(*), max("createdAt") FROM system_logs WHERE "recordId" IN ('P2039','P2034');`

**Repro (K3).** `audit/repro/KYY-3-03.log` (yukarıdaki alıntı).

**İş etkisi.** Gerçek çakışmalar "sunucu hatası" olarak görünür; hem kullanıcı davranışı (tekrar basma → mükerrer denemeler) hem de arıza teşhisi bozulur.

**Öneri (2. tur için).** `error.middleware.ts`e `P2039` için, **DB hata kodunu okuyan** bir dal ekle: mesaj/`meta` içinde `40P01` (deadlock) ya da `40001` (serialization) varsa **P2034 ile aynı 409 + tekrar-dene** yanıtını ver; diğer `P2039`'lar sunucu arızası olarak kalsın. Ayrıca `SERVER_FAULT_PRISMA_CODES`e `P2039` eklenerek "sınıflandırılmamış" uyarısı susturulmasın — **sınıflandırma açık olmalı**. `test_observability_contract`e bu eşleme için bir sonda eklenir. Migration/izin **GEREKMEZ**.
**Kabul kriteri.** Deadlock üreten bir sonda (örn. `audit_repro_KYY-3-03.ts`'in ürettiği hata) middleware'den geçirildiğinde **409** dönmeli ve audit satırı `unclassified: true` içermemeli.
**Efor.** 0,5 gün.
**Önceki defter.** — (K6 §7 "statü taşıyan hatalar bekçisiz" notunun somut bir örneği.)

---

### [KYY-3-07] `scripts/reset-operational.ts` ortam kapısı olmadan 30+ tabloyu `TRUNCATE` ediyor — `system_logs` ve `system_log_archives` dahil

| Şiddet | **S1** | Kategori | J (ops/kurtarma) + G (yıkıcı işlem) | Öncelik | **P0** | Modül | Scriptler / audit | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Script `DATABASE_URL` neyi gösteriyorsa ona bağlanıp tek `TRUNCATE … CASCADE` ifadesiyle fabrikanın tüm operasyonel verisini (toplar, iş emirleri, adımlar, siparişler, sevkiyatlar, çuvallar, fason sevk/kabul, kartela, refakat kartları, iade defteri) ve **audit defterinin tamamını** siliyor. Ortam kontrolü **yok**; dosya başlığındaki *"sadece test ortamında çalıştır"* bir yorumdur. Repoda kapı deseni mevcut (`run-all-tests.ts:102 productionDbGate()`) ve bu denetimin repro sözleşmesi bile her script'ten `devDbGuard()` istiyor — burada uygulanmamış.

**Kanıt.**
- `Teks-Erp/scripts/reset-operational.ts:10` — `// !! GERİ ALINAMAZ — önce yedek al veya sadece test ortamında çalıştır.` (yorum)
- `:12-14` — `import prisma from "../src/lib/prisma"; async function main() { …` — **hiçbir guard yok**
- `:20-44+` — `await prisma.$executeRaw\`TRUNCATE system_logs, system_log_archives, roll_properties, roll_errors, traveler_card_scans, roll_movements, roll_operations, …\`` (30+ tablo, `CASCADE`)
- `grep -rn "productionDbGate" scripts/*.ts` → yalnız `run-all-tests.ts:102, :174`.
- **Koruma kontrolü:** `NODE_ENV` kontrolü → yok; host allowlist → yok; onay istemi (`readline`) → yok; `--apply` bayrağı → yok (CLAUDE.md "toplu veri düzeltmesi yapan script dry-run varsayılan olur" kuralının ihlali); DB tarafı → `system_logs` tamper trigger'ı `TRUNCATE`i kapsıyor **ama yalnız `teks.audit_guard='on'` iken** (bkz. KYY-3-08), yani bugün muhtemelen kapalı.

**failure_mode.** Fabrikanın sunucusunda (ya da prod `DATABASE_URL` taşıyan bir `.env` ile herhangi bir makinede) `npx tsx scripts/reset-operational.ts` çalıştırılırsa 2.431 top, 213 iş emri, 278 sipariş, 40 sevkiyat ve tüm denetim izi **geri alınamaz** biçimde silinir; master data korunduğu için sistem "çalışıyor" görünür ve kayıp ancak ekranlar boş açıldığında fark edilir. Tek geri dönüş yedekten restore'dur ve son yedekten bu yana yapılan iş kaybolur.

**Veride fiili ihlal (K2).** Yok (henüz çalıştırılmamış — saha kopyasında veri duruyor). `system_log_archives` **0 satır** (arşiv yolu canlıda hiç koşmamış), yani arşiv de bir yedek değil.

**Repro (K3).** **Yapılmadı — bilinçli.** Yıkıcı script, salt-okunur denetim kuralı ve PRODUCTION CANLI ilkesi gereği çalıştırılmadı. Kanıt kod okumasıdır ve tartışmasızdır (guard'ın yokluğu dosyada görünür).

**İş etkisi.** Tek komutluk toplam veri kaybı riski. Fabrikanın sunucusunda `Teks-Erp/scripts/` dizini bulunuyor (kurulum paketle yapılıyor, ama geliştirme/onarım oturumlarında repo klonlanıyor) — yani yol erişilebilir.

**Öneri (2. tur için).** Script'in **İLK ifadesi** `productionDbGate()` (ya da repro sözleşmesindeki `devDbGuard()`) olsun: `NODE_ENV/APP_ENV` production reddi + host allowlist (`localhost`/`127.0.0.1`) + DB adı allowlist + **etkilenecek satır sayılarını yazdırıp `--apply` istemek**. Aynı taramayı `bench_audit_summary.ts` (sentetik `system_logs` INSERT'i) ve `scripts/` altındaki diğer `deleteMany` sahiplerine de uygula. `[PROD'DA ÇALIŞTIRMA]` — bu düzeltme yalnız script dosyasına dokunur, veriye dokunmaz; geri alma = commit revert.
**Kabul kriteri.** `DATABASE_URL` prod/uzak gösterirken script **çalışmadan** hata vermeli; bir bekçi (`test_script_guards.ts`) `scripts/` altında `$executeRaw.*TRUNCATE|deleteMany` içeren her dosyanın bir kapı fonksiyonu çağırdığını AST/metin ile doğrulamalı.
**Efor.** 0,5 gün.
**Önceki defter.** K4 H8 aynı sınıfı işaret ediyor; K12'de reddedilmiş değil.

---

### [KYY-3-08] Audit değiştirilemezliği elle açılan bir DB ayarına bağlı; bekçi trigger'ın VARLIĞINI ölçüyor, ETKİSİNİ değil

| Şiddet | **S2** | Kategori | I (gözlemlenebilirlik) + K (bekçi körlüğü) | Öncelik | **P2** | Modül | Audit / ops | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `system_logs` ve `system_log_archives` üzerindeki UPDATE/DELETE/TRUNCATE koruması trigger olarak **kurulu**, ama gövdesi `current_setting('teks.audit_guard') = 'on'` koşuluna bağlı ve varsayılan **KAPALI**. Açma adımı yalnız ops reçetesinde bir onay kutusu (`☐`) ve repoda hiçbir mekanik kontrol bunu ölçmüyor: `test_db_invariants` yalnız trigger'ın var olup olmadığına bakıyor. Yani "audit değiştirilemez" (INV-AUD-02, ISO 27001 A.8.15) bugün **doğrulanamayan** bir iddia.

**Kanıt.**
- `Teks-Erp/prisma/migrations/20260819161000_audit_tamper_guard/migration.sql:16-22, :48` —
  ```sql
  IF coalesce(current_setting('teks.audit_guard', true), '') = 'on'
  ```
  ve yorumda: *"Varsayılan KAPALI ve bu bilinçli … `ALTER DATABASE tekserp SET teks.audit_guard = 'on'` ile açılır"*.
- `docs/ops/SURUM-2.9.0-VERI-AKTARIMI-DEPLOY.md:635, :644, :1080` — açma komutu + `audit_guard AÇILDI : ☐` (kontrol listesi satırı **işaretsiz**).
- `Teks-Erp/scripts/test_db_invariants.ts:293-306` — envanterde yalnız `trigger: "system_logs_block_tamper"` ve `why` metni; **GUC değeri hiçbir yerde ölçülmüyor**.
- Ölçüm (saha kopyası, 2026-08-25): trigger'lar **VAR** (`pg_trigger`: `system_logs_block_tamper`, `system_log_archives_block_tamper`), `current_setting('teks.audit_guard', true)` → **boş**. ⚠️ **[VARSAYIM]** Bu ölçüm prod'un durumunu KANITLAMAZ: `pg_dump` veritabanı düzeyi `ALTER DATABASE … SET` ayarlarını taşımaz, dolayısıyla kopyada boş olması beklenendir. Tek kesin kontrol canlıda `GET /api/admin/health` (`auditGuard` alanı) ya da `SHOW teks.audit_guard`.
- **Koruma kontrolü:** uygulama katmanı → `AuditService` yalnız INSERT yapıyor (trigger INSERT'i engellemiyor, doğru); DB rolü → `SELECT rolsuper …` prod için bilinmiyor **[VARSAYIM]**; ikinci savunma → yok.

**failure_mode.** Bir kaydı düzeltip ilgili `SystemLog` satırını da `UPDATE`/`DELETE` eden herhangi bir yol (elle SQL, bir bakım script'i, `reset-operational.ts`) hiçbir engelle karşılaşmaz ve hiçbir iz bırakmaz; "kim ne zaman ne yaptı" sorusunun cevabı sessizce değiştirilebilir. Bekçi paketi yeşil kalır çünkü trigger yerinde durur.

**Veride fiili ihlal (K2).** `system_log_archives` **0 satır** (purge yolu canlıda hiç koşmadı, K8 H-3 ile tutarlı). Değiştirilmiş audit satırı aranamaz (tanım gereği iz yok).

**Repro (K3).** İstenmiyor (yarış bulgusu değil).

**İş etkisi.** Denetim izinin hukuki/sertifikasyon değeri bugün garanti altında değil; ISO 27001 A.8.15 iddiası doğrulanamaz.

**Öneri (2. tur için).** İki adım: (a) **ops:** canlıda `ALTER DATABASE tekserp SET teks.audit_guard='on';` + restart, sonra kontrol listesindeki `☐` işaretlensin (reçete `:635-675`te hazır, geri alma da yazılı: `RESET`). `[PROD'DA ÇALIŞTIRMA]` — bu bir DB ayarıdır, veriye dokunmaz; geri alma `ALTER DATABASE tekserp RESET teks.audit_guard;`. (b) **kod:** `test_db_invariants` §6 trigger varlığına ek olarak **etkiyi** ölçsün — `SHOW teks.audit_guard` okusun ve `on` değilse (prod bağlamında) KIRMIZI versin; `/api/admin/health`in `auditGuard` alanı zaten var, izleme oradan bağlansın.
**Kabul kriteri.** Canlıda `SHOW teks.audit_guard` → `on`; `test_db_invariants` GUC kapalıyken kırmızı verdiği **negatif sonda ile** doğrulansın.
**Efor.** 0,5 gün (kod) + 15 dk (ops penceresi, restart gerektirir).
**Önceki defter.** K8 H-4 ile aynı; SURUM-2.9.0 §7b açık kalemi.

---

### [KYY-3-09] Parti numarası kilidi (8022) sabit anahtarlı bir sistem kapısı ve çağıranın transaction'ı boyunca tutuluyor; edinim sırası iki yönlü (ABBA)

| Şiddet | **S2** | Kategori | A.1 (kilit sırası) + H (serileşme) | Öncelik | **P3** | Modül | Parti / fason / iş emri | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `generateBatchNumberTx` ilk ifadesinde `pg_advisory_xact_lock(8022, 1)` alıyor — **sabit anahtar**, yani sistemdeki *tüm* parti doğumları tek kapıdan geçiyor. Kilit `xact` ömürlü olduğu için **çağıranın transaction'ı bitene kadar** tutuluyor ve çağıranların bir kısmı kilidi tx'in **başında** alıp gövdenin tamamını (belge dondurma, 500 topluk claim, hareket yazımı) kilit altında koşuyor. Ayrıca aynı ailede iki farklı edinim sırası var: fason/kapanış yolları **WO satırı → 8022**, `attachRolls`/`manualMove`/split ise **8022 → WO satırı**.

**Kanıt.**
- `Teks-Erp/src/services/batch.service.ts:126` — kilit, fonksiyonun İLK ifadesi (sıra ✓); anahtar `(BATCH_NUMBER_LOCK_NS, BATCH_NUMBER_LOCK_KEY)` = `(8022, 1)` sabit.
- Uzun tutma: `src/services/subcontractor.service.ts:1140`/`:1231` `createBatchTx` → tx `:1392`'ye kadar sürüyor; arada `nextPrefixedSequence :1241`, `subcontractorDispatch.create :1244` (nested items), **`freezeForSource :1283`** (belge snapshot'ı ilişkileri okur), `markTravelerCardDirtyTx :1294`, roll claim `:1319` (≤500), `movement/operation/scan` createMany `:1337-1376`.
- Ters sıra: `src/services/workorder.service.ts:4553` (`createBatchTx` → 8022) → `:4566` `ensureWorkOrderInProgress` (**WO satırı**); `src/services/workorder-manual-move.service.ts:699` → `:814`. Karşı yön: `subcontractor.service.ts:1041` (`touchWorkOrderTx`) → `:1140` (8022).
- **Koruma kontrolü:** `batches.batchNumber` unique **kaldırıldı** (`20260805120000`) → kilit tek koruma; retry → `withBarcodeRetry` bu yolda P2002 üretecek unique olmadığı için etkisiz (K11 H-1); deadlock retry → yok (P2034/P2039 ele alınmıyor, bkz. KYY-3-06).
- Bekçi: `test_batch_number_format.ts` kilidin **sırasını** sahte-tx ile ölçüyor (`calls[0] === lock(8022,1)`) — doğru bekçi; ama **kilit süresi** ve **edinim sırası haritası** ölçülmüyor, gerçek DB'de paralel parti doğumu sondası yok (K11 H-1).

**Çakışma senaryosu (ABBA).**
```
T1 subcontractor.dispatch(WO-A, 300 top)      T2 attachRolls(WO-A, "Yeniden Üretime Al")
:1041 touchWorkOrderTx(A)  → WO-A satırı KİLİTLİ
                                              :4494 roll claim (WO kilidi YOK)
                                              :4553 createBatchTx → 8022 ALINDI
:1140 createBatchTx → 8022 istiyor … BEKLİYOR
                                              :4566 ensureWorkOrderInProgress → WO-A istiyor … BEKLİYOR
      >>> deadlock detector birini iptal eder → 40P01 → P2039 → 500 <<<
```
Serileşme çizelgesi (deadlock olmasa bile): T1 8022'yi `:1140`'ta alır ve `:1392`'ye kadar tutar; bu sürede T2 (mobil Hızlı İş Emri), T3 (tebdil), T4 (Tambur kesimi sonrası parti) hepsi `batch.service.ts:126`'da bekler.

**failure_mode.** Vardiya başında bir toplu fason sevki (300-500 top) koşarken tabletlerden açılan Hızlı İş Emri'leri parti numarası alamaz ve tx bütçesi (20 s) dolarsa `P2028 → 503` alır; operatör "sistem dondu" der ve tekrar basar. ABBA tetiklenirse kaybeden istek KYY-3-06 gereği **sınıflandırılmamış 500** alır.

**Veride fiili ihlal (K2).** Ölçülemez (kilit beklemesi kalıcı iz bırakmaz; `pg_stat_statements` kurulu değil — KUNYE). Saha'da 195 fason sevki var, yani yol sıcak.

**Repro (K3).** Yapılmadı — dört repro bütçesi daha yüksek etkili yollara ayrıldı; ABBA sınıfının gerçekliği **KYY-3-05'te aynı motorla (PostgreSQL deadlock detector) ölçülerek** kanıtlandı, buradaki tek fark kilidin advisory olmasıdır (advisory kilitler de deadlock detector'a katılır).

**İş etkisi.** Parti doğuran her yüzey (mobil + masaüstü) tek bir global kuyruğa bağlı; yük arttıkça gecikme lineer değil kuyruklu büyür.

**Öneri (2. tur için).** Üç adım, ilki tek başına da faydalı: (1) **Kilidi geç al** — `createBatchTx`i çağıranın tx'inde mümkün olan **en son** noktaya taşı (fason sevkinde belge dondurma ve roll claim'inden SONRA); (2) **Sırayı sabitle** — tüm çağıranlar `WO satırı → 8022` sırasını uygulasın (KYY-3-02'nin önerdiği "attachRolls/manualMove tx'in başında `touchWorkOrderTx` alsın" düzeltmesi bunu **kendiliğinden** sağlar → iki bulgu tek dokunuşla kapanır); (3) bekçiye edinim sırası haritası sondası ekle (her `createBatchTx` çağıranı için "8022'den önce WO kilidi alınmış mı" AST/metin kontrolü). Migration/izin **GEREKMEZ**.
**Kabul kriteri.** Yeni bir bekçi 2 paralel `attachRolls` + 1 `subcontractor.dispatch` koşumunda 0 deadlock ölçmeli; `createBatchTx` çağrılarının hepsi WO kilidinden sonra gelmeli.
**Efor.** 1,5 gün.
**Önceki defter.** K3b H-4 / K10 H-11 (ABBA-1 ailesi) ile aynı.

---

### [KYY-3-10] `bulkDispatchStep` çok partili adımda sessiz kısmi başarı üretiyor: 3. parti düşerse ilk ikisinin fason sevki commit'li kalır ve yanıtta görünmez

| Şiddet | **S2** | Kategori | D (tx sınırı / parçalı sonuç) + F (API sözleşmesi) | Öncelik | **P2** | Modül | Fason | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** "Toplu Sevk Et" birden çok parti içeren bir adımda partileri **ayrı ayrı** `dispatch()` çağrısıyla (yani ayrı transaction'larla) sevk ediyor. Döngüde `try/catch` yok ve `failed[]` döndürülmüyor: ortadaki bir parti hata alırsa istisna yukarı fırlar, ama **önceki partilerin sevki zaten commit edilmiştir** (FS numaraları üretilmiş, fason çekileri donmuş, toplar `AT_SUBCONTRACTOR` olmuştur) ve yanıtta bunların izi yoktur. Aynı servisin `cancelBulk` ucu tam bu sınıfta `failed[]` döndürüyor — yani asimetri bilinçli bir tasarım tercihi değil.

**Kanıt.**
- `Teks-Erp/src/services/subcontractor.service.ts:1538-1554`:
  ```ts
  if (byBatch.size > 1) {
    const dispatches: unknown[] = [];
    for (const [, rollIds] of byBatch) {
      const res = await this.dispatch({ workOrderId: …, stepId: …, subcontractorId, rollIds, … }, userId);
      dispatches.push(res.data);
    }
    return { success: true, data: { separate: true, dispatchCount: dispatches.length, dispatches }, … };
  }
  ```
  (döngüde hata yakalama yok; `dispatch()` kendi `$transaction`ını `:1036-1392` açar)
- Karşı örnek: `:2183` `cancelBulk` → `failed[]` döndürüyor (K3a §7'de "parçalı, `failed[]` ✓" olarak kayıtlı).
- Belgeli kısmi ikizi: `transferToNextFason :1589-1590` — orada kısmilik **yorumda açıkça kabul edilmiş** ("2. patlarsa toplar boyahane adımında bekler, planlamacı 'Sevk Et' ile tamamlar"); `bulkDispatchStep`te böyle bir kabul yok.
- **Koruma kontrolü:** tek tx'e alma → yok (bilinçli: WO satırını 500 top boyunca kilitli tutmamak için, `:2177` benzeri gerekçe); idempotency → `dispatch`ta `clientToken` **YOK**, replay guard'ı `:742` yalnız "aynı küme, aynı açık sevk" örtüşmesini yakalar; telafi (compensation) → yok.

**failure_mode.** Planlamacı 5 partili bir adımı "Toplu Sevk Et" ile boyahaneye gönderir. 3. partide bir top araya giren bir Tambur kesimi/manuel taşıma yüzünden `:1319` çoklu claim'ini kaybeder → `409 "Toplar bu sırada değişti"`. Ekran tek bir hata gösterir; oysa 1. ve 2. parti **fasondadır**, `FS2508260012`/`FS2508260013` numaraları üretilmiş ve fason çekileri donmuştur — ama basılmamış, firmaya verilmemiştir. Planlamacı "sevk olmadı" sanıp tekrar dener; ikinci denemede kalan partiler gider, ilk ikisi için ya `OPEN_OUTSTANDING` guard'ına ya roll claim'ine takılır ve farklı bir hata alır.

**Veride fiili ihlal (K2).** `tekserp_saha_0825`: 195 fason sevki, 5'i iptal edilmiş. Kısmi başarı izi ayırt edilemez (iz bırakmıyor — bulgunun kendisi bu). **Arandı, ayırt edilebilir kanıt yok.**

**Repro (K3).** Yapılmadı — hata yolu deterministik olarak tetiklenebilir ama fason fikstürü (istasyon+kategori+firma+rota+parti) tek script bütçesini aşıyordu; kod okuması tartışmasız (döngüde `try` yok).

**İş etkisi.** Mal belgesiz olarak fason firmaya çıkabilir; fason karnesi ve "açık sevk" hesapları planlamacının bilmediği satırlar taşır.

**Öneri (2. tur için).** Döngüyü `cancelBulk` kalıbına çevir: her parti `try/catch` içinde, sonuç `{ dispatchCount, dispatches, failed: [{ batchId, reason }] }` olarak dönsün ve HTTP **200 + kısmi rapor** verilsin (hepsi düştüyse hata). İstemci tarafında (Electron fason sevk ekranı) `failed[]` görünür kılınsın — CLAUDE.md kurşun dağıtımındaki "toplu sonuç PARÇALI (bilinçli, `failed[]` gösterilir)" kararının aynısı. Migration/izin **GEREKMEZ**; Electron ile birlikte gitmeli.
**Kabul kriteri.** Ortadaki partiyi bilerek düşüren bir bekçi, yanıtta önceki sevklerin `dispatchNo`larını ve düşen partinin sebebini görmeli.
**Efor.** 1 gün (backend 0,5 + Electron 0,5).
**Önceki defter.** K3a §13 (SEPARATE sessiz kısmi) ile aynı.

---

### [KYY-3-11] Birleştirme mezar taşı diriltilebiliyor: `mergedIntoId` FK'sı SET NULL ve `hardDelete` yalnız P2003'e güveniyor

| Şiddet | **S2** | Kategori | C (veri modeli) + E (iş kuralı) | Öncelik | **P3** | Modül | Ana veri / mükerrer paneli | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Mükerrer birleştirmede kaynak kayıt silinmiyor, `mergedIntoId` ile survivor'a bağlanıp **tombstone** oluyor (INV-MD-02: yeni referans almaz, listelenmez) ve `nameFold` partial unique'inden `WHERE mergedIntoId IS NULL` predicate'i sayesinde çıkıyor. Ama bu self-FK **`ON DELETE SET NULL`** ve `BaseService.hardDelete` bağımlılık kontrolünü tamamen **P2003'e** (RESTRICT ihlali) bırakıyor. Survivor `DELETE /:id/permanent` ile silinirse P2003 çıkmaz, silme başarılı olur ve tombstone'un `mergedIntoId`'si NULL'a döner: **kapatılmış mükerrer kayıt canlıya geri döner.**

**Kanıt.**
- Ölçüm (dev DB, `pg_constraint`): `items_mergedIntoId_fkey`, `customers_mergedIntoId_fkey`, `subcontractors_mergedIntoId_fkey`, `colors_mergedIntoId_fkey`, `batches_mergedIntoId_fkey` → **`confdeltype = 'n'` (SET NULL)**, beşi de.
- `Teks-Erp/prisma/schema.prisma:1300` — `mergedInto Item? @relation("ItemMergeLineage", fields: [mergedIntoId], references: [id])` — **`onDelete` verilmemiş** (Prisma varsayılanı opsiyonel ilişkide `SetNull`).
- `:1308-1310` yorumu partial unique'in predicate'inin bu kolon olduğunu yazıyor; index ölçüldü: `CREATE UNIQUE INDEX "customers_nameFold_key" … WHERE ("mergedIntoId" IS NULL)`.
- `Teks-Erp/src/services/base.service.ts:1259-1281` — `hardDelete` bağımlılık guard'ı **yalnız** `catch (P2003) → 409`; `mergedChildren` sayılmıyor.
- Uçlar: `src/routes/customer.routes.ts:220` ve `src/routes/item.routes.ts:266` — `DELETE /:id/permanent`, izin **`customer:write` / `item:write`** (yani `master-data:merge` yetkisi olmayan sıradan bir ana-veri kullanıcısı da yapabilir).
- **Koruma kontrolü:** DB → SET NULL (koruma değil, tam tersi); uygulama → `hardDelete`te ek guard yok; `MasterDataMergeService` → silme yolunu bilmiyor; `duplicate_reviews` → `decision=MERGED` satırı kalır, çift yeniden aday gösterilemez.
- Ölçüm (saha kopyası): tombstone sayısı → `items 6`, `subcontractors 3`, `customers 0` → **yol erişilebilir**.

**failure_mode.** "BOYER TEKSTİL" kartı "BOYER TEKSTİL A.Ş."ye birleştirilir (A → B); A tombstone olur, tüm sipariş/sevkiyat referansları B'ye taşınır. Aylar sonra B kartı yanlışlıkla/temizlik amacıyla "Kalıcı Sil" ile silinirse (B'ye bağlı canlı kayıt kalmamışsa P2003 çıkmaz) A'nın `mergedIntoId`'si NULL olur: A müşteri listesinde yeniden görünür, sipariş açılırken seçilebilir hale gelir ve `customers_nameFold_key`e geri girer. Katlanmış adı başka bir canlı kayıtla çakışırsa **silme işlemi `23505` ile düşer** ve kullanıcı "bu kaydı neden silemiyorum" sorusunun cevabını hiçbir yerde bulamaz.

**Veride fiili ihlal (K2).** Saha kopyasında canlıya dönmüş tombstone **0** (yani henüz kimse survivor'ı kalıcı silmemiş); 9 tombstone mevcut → tetik hazır. FK davranışı dev DB'de doğrudan ölçüldü (yukarıda).

**Repro (K3).** Yapılmadı — FK davranışı `pg_constraint`ten kesin okunuyor (K2), yarış içermiyor.

**İş etkisi.** Mükerrer paneli kararı sessizce geri alınır; fabrika aynı firmaya ikinci kez kart açar ve tespit kuyruğu o çifti bir daha göstermez (karar `MERGED` olarak kalır).

**Öneri (2. tur için).** İki katman: (a) **Uygulama:** `hardDelete`e (ya da master-data controller'ının `hardRemove`una) "bu kayda birleşmiş tombstone var mı" kontrolü — `mergedChildren` sayısı > 0 ise 409 ("Bu karta N mükerrer kayıt birleştirilmiş; kalıcı silme mükerrerleri geri diriltir"). (b) **Şema:** `mergedInto` ilişkisine `onDelete: Restrict` ver → DB seddi P2003 üretir ve (a) mesajı verir. **(b) migration gerektirir → `[PROD'DA ÇALIŞTIRMA]`**: `ALTER TABLE … DROP CONSTRAINT … ; ADD CONSTRAINT … ON DELETE RESTRICT;` — geri alma aynı ifadenin `SET NULL` hâli; 5 tablo (items, customers, subcontractors, colors, batches). Uygulamadan önce mevcut tombstone'ların survivor'larının silinmemiş olduğu doğrulanmalı.
**Kabul kriteri.** Birleştirilmiş bir kaydın survivor'ı `/permanent` ile silinmeye çalışıldığında 409 dönmeli; `test_master_data_merge`e "survivor kalıcı silinemez" sondası eklenmeli.
**Efor.** 1 gün (kod 0,5 + migration 0,5).
**Önceki defter.** K2a H1 ile aynı sınıf.

---

### [KYY-3-12] Son-admin koruması `grantPermission` yolunda hiç koşmuyor; `setUserPermissions`in tetikleyicisi zaman penceresini bilmiyor → gelecek tarihli yetkiyle sistem yöneticisiz kalabilir

| Şiddet | **S2** | Kategori | G (yetki) + E (iş kuralı) | Öncelik | **P2** | Modül | Kimlik / yetki | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** F253/F254 guard'ı "sistemde en az bir **efektif** `admin:users` sahibi kalsın" kuralını 8025 advisory kilidi altında doğru uyguluyor — ama yalnız **çağrıldığı yerlerde**. `grantPermission` bir **upsert**'tür (var olan satırın `validFrom`/`validUntil`'ini günceller) ve o yolda ne kilit ne guard var. `setUserPermissions`in guard tetikleyicisi ise **varlık** bazlı (`currentHasAdmin && !targetHasAdmin`), oysa guard'ın kendisi **zaman penceresi** bazlı. Sonuç: son admin'e `admin:users` yetkisi "gelecek tarihten itibaren geçerli" olarak verilirse efektif admin sayısı 0'a düşer ve hiçbir kontrol tetiklenmez.

**Kanıt.**
- `Teks-Erp/src/services/permission-management.service.ts:190-221` — `grantPermission` tx'i: `:194` `userPermission.upsert` (`update: { validFrom, validUntil, grantedById }`) + `:214` `tokenVersion` bump. **`acquireAdminGuardLock` / `assertAdminCoverageAfterChange` YOK.**
- `:299` — tetikleyici: `const removesAdmin = currentHasAdmin && !targetHasAdmin;` (`targetHasAdmin` yalnız `permissionIds.some(...)`, tarihlere bakmaz)
- `:306-309` — `if (removesAdmin) { acquireAdminGuardLock; assertAdminCoverageAfterChange; }`
- `:586-595` — guard'ın penceresi: `effectiveAdminWindow` = `(validFrom IS NULL OR validFrom ≤ now) AND (validUntil IS NULL OR validUntil ≥ now)`
- `src/routes/admin.routes.ts:329-342` (`grantSchema`) ve `:373-386` (`permissionSetItemSchema`) — **iki refine var:** `validUntil > validFrom` ve `validUntil > now`. **`validFrom`in gelecekte olmasını hiçbir kural reddetmiyor**; `validUntil = now + 1 sn` de geçerli.
- **Koruma kontrolü:** advisory → `grantPermission`da yok; DB kısıtı → "en az bir efektif admin" yazılamaz (yok); rol şablonu uzlaştırıcısı → izni **getirir, ATAMAZ** (CLAUDE.md), yani kurtarmaz; bekçi → `test_admin_guard_race` yalnız `deactivateUser` çiftini ölçüyor (2→1), grant/set paralel sondası yok (K11 §4b).

**failure_mode.** Yönetici, sistemdeki son `admin:users` sahibine (kendisi olabilir) panelden yetkiyi "1 Ocak 2027'den itibaren geçerli" diye verir. `grantPermission` mevcut satırı günceller, `tokenVersion` artar, yanıt **201** döner. O andan itibaren `effectiveAdminWindow` hiç kimseyi döndürmez: `/api/admin/users*` uçlarının tamamı kapanır — yeni kullanıcı açılamaz, izin verilemez, cihaz onaylanamaz, rol şablonu uygulanamaz. Hiçbir uyarı yok; audit yalnız "CREATE USER_PERMISSION" der. Çıkış yolu **yalnız DB'de elle `UPDATE user_permissions SET "validFrom" = NULL`**.

**Veride fiili ihlal (K2).** `tekserp_saha_0825`: `user_permissions` toplam **353** satır, `validFrom` dolu **0**, `validUntil` dolu **0**; efektif admin sayısı **4**. Yani bugün ne tetik ne de tek-admin durumu var → olasılık düşük. (Süreli yetki özelliği sahada henüz kullanılmıyor.)

**Repro (K3).** **Bilinçli yapılmadı:** senaryoyu gerçek olarak tetiklemek dev DB'deki diğer adminleri pasifleştirmeyi gerektiriyor — paylaşımlı bir geliştirme veritabanında kabul edilemez bir yan etki. Kod okuması ve Zod şeması kesin (guard'ın olmadığı ve `validFrom` kısıtının bulunmadığı doğrudan görünüyor).

**İş etkisi.** Sistem yöneticiliği kilitlenir; fabrika vardiyası sürerken yeni operatör tanımlanamaz, tablet onaylanamaz. Kurtarma DB erişimi gerektirir.

**Öneri (2. tur için).** Üç küçük dokunuş: (1) `grantPermission`in tx'ine, verilen izin `ADMIN_CODES` içindeyse `acquireAdminGuardLock` + `assertAdminCoverageAfterChange(tx, userId, /*willTargetRetainAdmin*/ hedefte BAŞKA efektif admin grant'ı var mı)` ekle; (2) `setUserPermissions`in `targetHasAdmin` hesabını **efektif** yap (hedef listedeki admin kalemi `validFrom ≤ now` ve `validUntil` gelecekte olmalı; aksi halde `removesAdmin = true` say); (3) Zod'a `validFrom` için "geçmiş ya da boş" ya da en azından "admin kodlarında gelecek tarih yasak" kuralı ekle. Migration/izin **GEREKMEZ**.
**Kabul kriteri.** `test_admin_guard_race`e iki sonda: son admin'e gelecek tarihli `validFrom` ile grant → **409**; `setUserPermissions` gelecek tarihli admin kalemiyle → **409**. İkisi de negatif sonda ile (guard kaldırılınca kırmızı) doğrulanmalı.
**Efor.** 0,5 gün.
**Önceki defter.** K3b H-3 aynı mantık boşluğunu işaret ediyor; burada Zod tarafı da ölçülerek `validUntil` kapısının var, `validFrom` kapısının yok olduğu netleştirildi.

---

### [KYY-3-13] `cancelReturn` sevkiyat kapsam kilidini (8023) almıyor ve sevkiyatın durumunu hiç okumuyor — koruma tamamen karşı taraftaki sayaç guard'ına bağlı

| Şiddet | **S3** | Kategori | A.1 (kilit kapsamı) + E | Öncelik | **P4** | Modül | İade / sevkiyat | Kanıt seviyesi | **K3** (negatif yarış + pozitif koruma sondası) |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** İade iptali topu `SHIPPED` + `shipmentId = <geldiği sevkiyat>` durumuna geri yazıyor, ama o sevkiyatın hâlâ `DISPATCHED` olup olmadığını **hiç sormuyor** ve 8023 kapsam kilidini **almıyor** — oysa kardeş yollar (`createReturn`, `undoDispatch`) alıyor. Bugün bu bir ihlal üretmiyor, çünkü `undoDispatch` aktif iade varken bloklanıyor; yani **INV-SEV-03'ün korunması tek noktalı**: karşı taraftaki sayaç guard'ı. O guard gevşerse ya da sevkiyatı DISPATCHED'ten çıkaran yeni bir yol eklenirse ihlal sessizce doğar.

**Kanıt.**
- `Teks-Erp/src/services/return.service.ts:879-937` — tx gövdesi; **`lockShipmentScopeTx` çağrısı yok**. `grep -rn "lockShipmentScopeTx" src` → yalnız `helpers/shipment-locks.helper.ts:52` (tanım), `shipping.service.ts:2159` (`undoDispatch`), `return.service.ts:490` (`createReturn`).
- `:882-895` — top claim'i: `where: { id: rr.rollId, status: expectedStatus, shipmentId: null, sackId: null }` → `data: { status: SHIPPED, shipmentId: rr.fromShipmentId, sackId: restoreSackId }`. **Sevkiyat statüsü `where`de de `data`da da yok.**
- `:846` — tx öncesi tek sevkiyat kontrolü: `if (!rr.fromShipmentId) throw …` (yalnız varlık).
- `helpers/shipment-locks.helper.ts:29-51` — kilidin var olma gerekçesi yazılı ve tam bu sınıfı anlatıyor: *"`createReturn` AYNI kilidi alır, böylece iki akış aynı sevkiyat için serileşir"*.
- **Koruma kontrolü:** DB kısıtı → `SHIPPED ⇒ sevkiyat DISPATCHED` için yok; trigger → yok; `undoDispatch :2172` `rollReturn.count({fromShipmentId, cancelledAt: null})` → **tek gerçek koruma**; `cancelShipment` → DISPATCHED sevkiyatı zaten reddediyor.

**Çakışma senaryosu (denendi, ÇÜRÜTÜLDÜ).**
```
T1 cancelReturn(RR)                      T2 undoDispatch(S)
:882 roll claim → SHIPPED + shipmentId=S
:901 rollReturn.cancelledAt = now
     COMMIT  (ikisi AYNI tx'te atomik)
                                         :2159 lockShipmentScopeTx(S)
                                         :2172 rollReturn.count(cancelledAt:null)
                                               → ya 1 görür (409 "aktif iade var")
                                               → ya 0 görür AMA topu da SHIPPED+S görür → :2196 birlikte geri çeker
SONUÇ: 20 turda 0 ihlal — atomiklik + sayaç guard'ı pencereyi kapatıyor.
```
**Koruma sondası (EVET):** aynı repro [B] adımında sevkiyat `PLANNED` iken `cancelReturn` çağrıldı → **hata YOK**, top `SHIPPED` + `shipmentId` dolu, sevkiyat `PLANNED`. Yani kural gerçekten yazılı değil.

**failure_mode.** Sevkiyatı DISPATCHED'ten çıkaran yeni bir yol eklendiğinde (ör. "storno'yu zorla", toplu iade defteri düzeltmesi, bir veri onarım script'i) ya da `undoDispatch`in sayaç guard'ı gevşetildiğinde: top depo ekranında **yok** (SHIPPED), sevkiyat ekranında sevkiyat **PLANNED/CANCELLED**, `shippedQty` topu **saymıyor** (tahsis DISPATCHED değil) → top hiçbir yüzeyde bulunamaz ve fabrika "topu kaybettik" der.

**Veride fiili ihlal (K2).** `tekserp_saha_0825`: `SHIPPED` top + sevkiyat ≠ DISPATCHED → **0 satır**; `roll_returns` 5 satır, iptal edilmiş **0** (yol sahada hiç koşmamış).

**Repro (K3).** `Teks-Erp/scripts/audit_repro_KYY-3-02.ts` → `audit/repro/KYY-3-02.log`: [A] 0/20 ihlal (**hipotez çürütüldü**), [B] koruma sondası 2 ihlal (guard yok, kilit yok).

**İş etkisi.** Bugün yok; gizil. Değeri, "bu kural nerede yazılı" sorusunun cevabının yanlış yerde olmasıdır.

**Öneri (2. tur için).** İki satır: tx'in **İLK ifadesi** `await lockShipmentScopeTx(tx, rr.fromShipmentId)` olsun (undoDispatch ile serileşsin) ve roll claim'inden önce sevkiyat taze okunup `status === DISPATCHED` doğrulansın (değilse 409 + açık mesaj: *"Bu iadenin geldiği sevkiyat artık sevk edilmiş durumda değil — iade iptal edilemez"*). Migration/izin **GEREKMEZ**.
**Kabul kriteri.** `audit_repro_KYY-3-02.ts` [B] YEŞİL (409 alınmalı); [A] 20/20 yeşil kalmalı.
**Efor.** 0,5 gün.
**Önceki defter.** K10 §5 `INV-SEV-06` satırı ("8023 alınmıyor, sevkiyat statüsü okunmuyor") — bu bulgu onu **ölçerek daraltıyor**: yarış bugün tetiklenemiyor, eksik olan yazılı kural.

---

### [KYY-3-14] `cancelReceipt` doğan topları `CANCELLED` yaparken iptal izi kolonlarını yazmıyor; append-only hareket/işlem defterinden fiziksel siliyor

| Şiddet | **S3** | Kategori | E (iz değişmezi) + C | Öncelik | **P4** | Modül | Fason / izlenebilirlik | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Fason mal kabulü iptal edildiğinde makbuzdan doğmuş açık kumaş topları `CANCELLED` yapılıyor, ama `cancelledAt`, `cancelledById`, `cancelReason`, `cancelReasonCode` alanlarının **hiçbiri yazılmıyor** — oysa INV-AUD-04 bu kolonların var olma sebebi olarak "audit 6 ayda arşivleniyor, gerekçe kolonda yaşamalı" der. Aynı akış `roll_movements` ve `roll_operations` satırlarını **fiziksel olarak siliyor**; bu iki tablo append-only defter kabul ediliyor ve INV-SYS-06'nın bilinçli istisna listesinde yok.

**Kanıt.**
- `Teks-Erp/src/services/subcontractor.service.ts:4845-4852`:
  ```ts
  await tx.roll.updateMany({
    where: { id: { in: bornRollIds } },
    data: { status: RollStatus.CANCELLED, currentStepId: null },      // ← iptal izi YOK
  });
  ```
- `:4834-4839` — `tx.rollMovement.deleteMany({ where: { rollId: { in: bornRollIds }, notes: \`RECEIPT_OPEN_FABRIC:${receipt.receiptNo}\` } })`
- `:4963-4970` — `tx.rollOperation.deleteMany({ where: { rollId: { in: rollIds }, workOrderStepId: receipt.stepId, operationType: SUBCONTRACTOR_RETURNED } })`
- Karşı örnek (doğru desen): `resolveReasonCode` + `applyRollDispositionsTx` yolları iptal izini yazıyor (CLAUDE.md 2026-08-22).
- Okuyucu: `src/services/reports/production.report.service.ts:109` `roll_operations` sayıyor → silinen satırlar raporu geriye dönük değiştirir.
- **Koruma kontrolü:** DB → kolonlar NULLABLE, CHECK yok; trigger → yok; bekçi → `test_fason_receive_cancel_rereceive` iptal izini ölçmüyor; `test_consistency` §14 fason iptalini ölçüyor ama iz kolonlarını değil.

**failure_mode.** Bir fason kabulü iptal edilir; 6 ay sonra audit satırı arşive taşınır. "Bu top neden iptal edilmiş?" sorusunun cevabı ne topun satırında (kolonlar boş) ne de canlı `system_logs`ta bulunur — yalnız `system_log_archives`ta (ki o tablo sahada 0 satır, yani arşiv yolu hiç koşmamış) aranabilir. Ayrıca üretim raporunda o adımın işlem sayısı geriye dönük düşer.

**Veride fiili ihlal (K2).** `tekserp_saha_0825`:
```sql
SELECT COUNT(*) FILTER (WHERE "cancelledAt" IS NULL) AS iz_yok, COUNT(*) FROM rolls WHERE status='CANCELLED';
-- 134 iz_yok / 230 toplam
SELECT "entrySource", COUNT(*) FROM rolls WHERE status='CANCELLED' AND "cancelledAt" IS NULL GROUP BY 1;
-- TAMBUR_SPLIT 92 · SUPPLIER_RECEIPT 39 · MANUAL_ENTRY 2 · SUBCONTRACTOR_RETURN 1
SELECT COUNT(*) FROM rolls WHERE status='CANCELLED' AND "cancelledAt" IS NULL AND "parentReceiptId" IS NOT NULL;  -- 1
```
Yani **bu yoldan gelen 1 satır** kesin; toplam 134 izsiz iptalin geri kalanı **başka yazma yollarından** geliyor (bkz. Sınır ötesi notlar). `roll_movements` içinde `exitedAt` dolu + `qtyOut NULL` **14 satır** (INV-STK-05 varyantı, ayrı konu).

**Repro (K3).** İstenmiyor (yarış değil).

**İş etkisi.** İzlenebilirlik kaybı; bir müşteri şikâyetinde "bu top neden kayıtlardan düştü" sorusu cevapsız kalır.

**Öneri (2. tur için).** (a) `:4845` `updateMany`ye `cancelledAt: new Date()`, `cancelledById: userId ?? null`, `cancelReason: \`Fason kabul iptali: ${trimmedReason}\``, `cancelReasonCode`u `resolveReasonCode` üzerinden (tx DIŞINDA çözülüp içeri geçirilerek — 2026-08-22 kuralı) ekle. (b) Movement/operation silmeyi **kapanış/geçersizleştirme**ye çevir (ör. `voidedAt` damgası ya da `notes` işareti) ya da INV-SYS-06'nın istisna listesine **gerekçesiyle** ekleyip raporların bu satırları dışlamasını sağla — ikisinden biri, ama karar yazılı olsun. (c) Geçmiş 134 satır için **veri düzeltmesi ÖNERİLMEZ** (kök nedeni gizler; CLAUDE.md 2026-08-22 §13 emsali) — kapı görünür kalsın. Migration **GEREKMEZ** (kolonlar var).
**Kabul kriteri.** `test_fason_receive_cancel_rereceive`e "iptal edilen doğan topların `cancelledAt`/`cancelReason` dolu" kontrolü; `test_consistency`ye INV-AUD-04 sorgusu (yeni iptaller için kırmızı vermeli).
**Efor.** 0,5 gün.
**Önceki defter.** K10 H-5 (47/52 eksik sınıfı) ile aynı aile; bu bulgu o sınıfın **bir çağrı yerini adıyla** gösteriyor.

---

### [KYY-3-15] İki eşzamanlı refakat kartı baskı olayı aynı sürüm numarasını yazıyor: iki farklı içerik "v2" olarak basılır, arşivde yalnız sonuncusu kalır

| Şiddet | **S3** | Kategori | A.1 (kilitsiz oku-yaz) + E (belge değişmezi) | Öncelik | **P5** | Modül | Refakat kartı | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `recordPrintEvent` kartı ve baskı planını (dolayısıyla **sürüm numarasını**) havuz client'ıyla, transaction'a girmeden çözüyor; tx içindeki `travelerCard.update` sürümü **koşulsuz** yazıyor (beklenen sürüm `where`de yok). İki baskı olayı çakışırsa ikisi de aynı `version`ı hesaplar; arşiv tablosundaki `upsert` ikinciyi `update` dalına düşürüp **ilk sürümün snapshot'ını ezer**. INV-DOC-04'ün üzerine kurulduğu "kâğıttaki v = DB'deki v" eşitliği bozulur.

**Kanıt.**
- `Teks-Erp/src/services/traveler-card.service.ts:350-364` — `card` ve `resolvePrintPlan(card)` **havuzda** (`prisma`), tx `:368`'de başlıyor. Dosyanın kendi yorumu (`:340-347`) bu sınıfın tek-istemci varyantını "BİLİNEN SINIR (bilinçli, makinesi kurulmadı)" olarak kabul ediyor; **çok-istemci varyantı ek olarak bir sürüm KAYBI üretiyor** ve bu yorumda yok.
- `:369-378` — `tx.travelerCard.update({ where: { id: cardId }, data: { …, version: plan.version } })` — **claim yok** (beklenen sürüm `where`de değil).
- `:443-462` — `archivePrintedVersionTx`: `printedDocument.upsert({ where: { docType_sourceId_version }, create: …, update: { snapshot, printedById } })` → aynı `version` ikinci kez gelirse **snapshot üzerine yazılır**.
- Şema: `printed_documents (docType, sourceId, version)` unique **var**; `traveler_cards.version` üzerinde tekillik **yok**.
- **Koruma kontrolü:** claim → yok; advisory → yok; DB → unique var ama `upsert` onu bilerek yutuyor; bekçi → `test_traveler_print_active_card` paralel **`print`**i ölçüyor (doğru), paralel **`print-event`**i ölçmüyor.

**Çakışma senaryosu.**
```
Kart v1; iş emri düzenlendi (içerik A)
T1 recordPrintEvent                      T2 recordPrintEvent (ikinci kullanıcı / ikinci sekme)
:350 card → version=1
:364 resolvePrintPlan → v=2, plan A
                                         (planlamacı iş emrini tekrar düzenler → içerik B)
                                         :350 card → version=1 (T1 henüz yazmadı)
                                         :364 resolvePrintPlan → v=2, plan B
:368 tx: card.version=2 ; PD(v2) CREATE snapshot=A
     COMMIT
                                         :368 tx: card.version=2 ; PD(v2) UPSERT→UPDATE snapshot=B
                                               COMMIT
SONUÇ: elde iki kâğıt, ikisi de "v2", içerikleri farklı; arşivde v2 = B, A hiç arşivlenmedi.
```

**failure_mode.** Sahadaki iki operatörden biri A planını, diğeri B planını gösteren "v2" damgalı kâğıt taşır. Bir uyuşmazlıkta "v2'de ne yazıyordu" sorusunun cevabı arşivden B olarak verilir; A'nın basıldığına dair hiçbir kayıt kalmaz.

**Veride fiili ihlal (K2).** `tekserp_saha_0825`: kart sürüm dağılımı `v1: 196`, `v2: 17`. `version > 1` olup `printed_documents`ta v1 kaydı olmayan **15 kart** — ⚠️ bu **beklenen** davranıştır (kart doğuşta v1'dir ama ilk baskı içerik değiştiği için doğrudan v2 üretir), ihlal değil. **İhlalin kendisi veriden ayırt edilemez** (aynı sürüm iki kez yazıldığında iz kalmaz) → arandı, ayırt edilebilir kanıt yok.

**Repro (K3).** Yapılmadı (bütçe daha yüksek etkili yollara ayrıldı; olasılık düşük — bir iş emrinin kartını genelde tek kişi basar).

**İş etkisi.** Kontrollü belge izinde (ISO 9001 §7.5.3) dar bir delik; operasyonel etki düşük.

**Öneri (2. tur için).** `recordPrintEvent`in tx'inde kart güncellemesini **claim**e çevir: `updateMany({ where: { id: cardId, version: card.version }, data: { …, version: plan.version } })` + `count === 0 → 409 "Kart bu sırada yeniden basıldı — önizlemeyi yenileyin"`. Arşiv `upsert`inin `update` dalı, snapshot farklıysa (planKey değişmişse) **yazmak yerine** hata versin. Migration/izin **GEREKMEZ**.
**Kabul kriteri.** İki paralel `recordPrintEvent` sondasında tam olarak 1 başarı + 1 × 409; `printed_documents`ta v2 snapshot'ı basılan planla birebir.
**Efor.** 0,5 gün.
**Önceki defter.** K2a H7 aynı satırı işaret ediyor.

---

### [KYY-3-16] `POST /api/devices/announce` tavanı check-then-act: eşzamanlı isteklerde 200'lük bekleyen-cihaz sınırı aşılabiliyor

| Şiddet | **S3** | Kategori | A.1 (TOCTOU) + G | Öncelik | **P6** | Modül | Cihaz | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Kimlik doğrulaması olmayan `announce` ucu yeni cihaz kaydını `MAX_PENDING_DEVICES = 200` ile sınırlıyor, ama "var mı → say → yaz" üçlüsü kilitsiz. N paralel istek aynı sayacı okuyup hepsi geçer; tavan eşzamanlılık derecesi kadar aşılır. Veri bozulmaz — tavanın **amacı** (admin ekranı okunabilir kalsın, gerçek tablet bulunabilsin) o oranda zayıflar.

**Kanıt.**
- `Teks-Erp/src/services/device.service.ts:174-186`:
  ```ts
  const existing = await prisma.device.findUnique({ where: { deviceId }, select: { id: true } });
  if (!existing) {
    const pendingCount = await prisma.device.count({ where: { status: "PENDING" } });
    if (pendingCount >= MAX_PENDING_DEVICES) throw AppError.tooManyRequests(…, { code: "PENDING_DEVICE_LIMIT" });
  }
  const device = await prisma.device.upsert({ where: { deviceId }, create: { …, status: "PENDING" }, update: { lastSeenAt: new Date() }, … });
  ```
- `src/middlewares/device.middleware.ts:27-31` — uç `EXEMPT_PATHS`te (kimliksiz, bilinçli).
- Yorum `:176-184` tavanın gerekçesini yazıyor: *"Zarar satır sayısı değil GÖRÜNÜRLÜK"*.
- **Koruma kontrolü:** rate limit → **yok** (K1a H10); advisory → yok; DB kısıtı → satır sayısı için yazılamaz; `devices.deviceId` unique → aynı cihazın çift kaydını keser (farklı `deviceId`leri kesmez).

**failure_mode.** Fabrika ağındaki bir betik (ya da bozuk bir istemci döngüsü) 50 paralel bağlantıyla rastgele `deviceId` gönderirse tavan 200 yerine ~249'da durur; her tur bir miktar aşar. Admin "Cihazlar" ekranında gerçek tablet sahte kayıtlar arasında kaybolur ve temizlik satır satır hard delete ile yapılır.

**Veride fiili ihlal (K2).** `tekserp_saha_0825`: `devices` → 28 APPROVED, **0 PENDING**. Aşım yok.

**Repro (K3).** Yapılmadı (etki düşük; `test_audit_followups` zaten 2× paralel `announce` sondası taşıyor ve tek satır ürettiğini doğruluyor — eksik olan **tavan** sondası).

**İş etkisi.** Düşük; LAN-only kabulüne dayanıyor.

**Öneri (2. tur için).** Ya sayım+insert'i tek ifadeye indir (`INSERT … SELECT … WHERE (SELECT count(*) FROM devices WHERE status='PENDING') < 200`), ya `pg_advisory_xact_lock(<cihaz NS>, 1)` ile serileştir (nadir yol, maliyet yok), ya da kabul edip **yorumda tavanın yumuşak olduğunu yaz**. Ek olarak bu uca IP başına basit bir rate limit koymak asıl çözümdür. Migration/izin **GEREKMEZ**.
**Kabul kriteri.** 20 paralel yeni-`deviceId` announce'unda PENDING sayısı tavanı aşmamalı (ya da tavanın yumuşak olduğu yazılı olmalı).
**Efor.** 0,25 gün.
**Önceki defter.** K1a H10 (rate limit yok) ile ilgili.

---
## 3. Bulgu özeti (öncelik sırası)

| ID | Şiddet | Öncelik | Yol | Başlık (kısa) | Kanıt |
|---|---|---|---|---|---|
| KYY-3-01 | S1 | P0 | KYY-15 | Aşım kesiminde parent guard'sız → 100 m'den 240 m çocuk, defter 100 m eksik | K3 12/12 |
| KYY-3-02 | S1 | P0 | KYY-21/24 | WO statüsü tx dışında → iptal edilmiş iş emrinde canlı top | K3 24/25 |
| KYY-3-07 | S1 | P0 | KYY-45 | `reset-operational.ts` kapısız TRUNCATE (audit dahil) | K1 |
| KYY-3-03 | S2 | P1 | KYY-03/51 | `Σ sevk ≤ istenen` hiçbir yerde yok → 100 m kaleme 200 m sevk | K3 |
| KYY-3-04 | S2 | P1 | KYY-03 | Boş sevkiyat / EXPORT tartı yalnız pre-tx → çuvalsız DISPATCHED + boş irsaliye | K3 1/25 |
| KYY-3-05 | S2 | P2 | KYY-30/51 | OrderLine↔Order ABBA (3 protokol ihlali) → PG deadlock | K3 |
| KYY-3-06 | S2 | P2 | (I) | `40P01 → P2039` sınıflandırılmamış 500; `P2034→409` dalı ölü | K3 |
| KYY-3-08 | S2 | P2 | KYY-45 | Audit tamper koruması elle açılan GUC'a bağlı; bekçi varlığı ölçüyor | K1 |
| KYY-3-10 | S2 | P2 | KYY-09 | `bulkDispatchStep` sessiz kısmi başarı (`failed[]` yok) | K1 |
| KYY-3-12 | S2 | P2 | KYY-39 | Son-admin guard'ı `grantPermission`da yok; tetikleyici pencereyi bilmiyor | K1 |
| KYY-3-09 | S2 | P3 | KYY-27 | 8022 sabit anahtar + tx boyu tutma + iki yönlü edinim sırası | K1 |
| KYY-3-11 | S2 | P3 | KYY-36 | Tombstone dirilmesi (`mergedIntoId` SET NULL + P2003'e güvenen hardDelete) | K2 |
| KYY-3-13 | S3 | P4 | KYY-06 | `cancelReturn` 8023'süz + sevkiyat statüsü okunmuyor (tek noktalı savunma) | K3 |
| KYY-3-14 | S3 | P4 | KYY-12 | `cancelReceipt` iptal izi yazmıyor + append-only defterden fiziksel siliyor | K2 |
| KYY-3-15 | S3 | P5 | KYY-33 | İki eşzamanlı print-event aynı sürümü yazar, arşivde bir içerik kaybolur | K1 |
| KYY-3-16 | S3 | P6 | KYY-42 | `announce` tavanı check-then-act | K1 |

**Bir düzeltme iki bulguyu kapatır:** `attachRolls`/`manualMove` tx'lerinin başına `touchWorkOrderTx` koymak hem **KYY-3-02**'yi (WO statüsü tazeliği) hem **KYY-3-09**'un ABBA kolunu (8022↔WO sırası) çözer.

---

## 4. Uygulanan kontrol listesi

### Bölüm 4.1 — sekiz soru (ZORUNLU), 17 yolun her birinde

| Soru | Durum |
|---|---|
| 1 — Hangi değişmez? (K10 ID'leriyle) | **uygulandı** — 17/17 yolda INV-* ID'leriyle yazıldı |
| 2 — Tek `$transaction` mı, sınır nerede? | **uygulandı** — 17/17, `dosya:satır` ile (tx dışı ÖNCE/SONRA adımları ayrı) |
| 3 — Check-then-act var mı? | **uygulandı** — 17/17; EVET olanlar: KYY-03, 06, 12, 15, 21, 24, 42 |
| 4 — Kilit / guard'lı `updateMany` + `count` / advisory (İLK ifade mi) | **uygulandı** — 17/17; advisory kullanan üç yolda (8022 `batch.service.ts:126`, 8025 `permission-management.service.ts:604`, 8027 `master-data-merge.service.ts:546`) **iki satır numarasıyla** sıra doğrulandı (beceri §4.2) |
| 5 — Küme/aralık kararı (write skew / phantom) | **uygulandı** — 17/17; phantom'a açık bulunanlar: KYY-03 (çuval kümesi, kalem kapasitesi), KYY-39 (efektif admin kümesi), KYY-42 (tavan), KYY-51 (defter kümesi — ama kilit protokolü kapatıyor) |
| 6 — DB kısıtı son savunma olarak var mı? | **uygulandı** — 17/17; `pg_constraint`/`pg_indexes`/`pg_trigger` ile **fiilen ölçülen**: `mergedIntoId` FK aksiyonları, `nameFold` partial unique predicate'leri, tamper trigger varlığı |
| 7 — İki aktörlü çizelge → bozuluyor mu | **uygulandı** — 17/17 çizelge gerçek fonksiyon adları + satır numaraları + `await` yield noktalarıyla yazıldı; **EVET** olan 12 yol için bulgu açıldı, **HAYIR** olan 5 yol (KYY-09 dispatch çekirdeği, KYY-12, KYY-18, KYY-48, KYY-06 yarış kolu) gerekçesiyle tabloda bırakıldı |
| 8 — Fabrikadaki gerçek etki | **uygulandı** — 17/17 |
| 7'ye EVET → repro scripti (K3) | **uygulandı** — 5 script (sözleşmenin istediği 2-4'ün üstünde); zorunlu ikisi (KYY-03 çift tahsis/aşım, KYY-06 8023'süz iade iptali) **denendi ve raporlandı** — KYY-06 yarışı **çürütüldü**, negatif sonuç kanıt olarak yazıldı |

### Bölüm 4.2 — kapsanması zorunlu yazma yolları (bu denetçinin payına düşenler)

| # | Yol | Durum |
|---|---|---|
| 2 | Sevkiyat (stok çıkış) | **uygulandı** — KYY-03 (+ iade iptali KYY-06) |
| 3 | Depo transferi | **uygulandı** — KYY-24 (WO içi manuel taşıma; ayrı depo YOK, K10 N/A) |
| 5 | Üretim bildirimi + backflush | **uygulandı** — KYY-18 (`finishStep` `qtyOut=qtyIn`), KYY-15 (kesim) |
| 6 | İş emri durum değişimi | **uygulandı** — KYY-21, KYY-24 |
| 7 | Sipariş → irsaliye kalan düşümü | **uygulandı** — KYY-51 (hub), KYY-30, KYY-03 |
| 9 | Belge/numara üretimi | **uygulandı** — KYY-27 (parti no 8022), KYY-33 (kart sürümü); FS/SVK sayaçları KYY-09/03 içinde |
| 16 | İçe aktarma yolu | **kapsam dışı** — KYY-38 bu denetçinin grubunda değil (mod 3 ≠ 0) |
| 18 | Kullanıcı-rol-yetki değişikliği | **uygulandı** — KYY-39 |
| 1, 4, 8, 10-15, 17 | Mal kabul / rezervasyon / fatura / yevmiye / ödeme / dönem / sayım / MRP / e-Fatura / fiyat | **kapsam dışı** — ya başka gruba düşüyor (KYY-01, 02, 13…) ya K10 §5'te N/A ilan edilmiş (rezervasyon: mühür/rezerv yok · fatura-yevmiye-ödeme-dönem-MRP-e-Fatura-fiyat: modül yok) |

### Bölüm 3 kesişimi (bu mercekten uygulanabilen maddeler)

| Madde | Durum |
|---|---|
| A.1 TOCTOU / atomik claim sınıflandırması | **uygulandı** — her `updateMany` beş sınıftan birine kondu (beceri §3.2); `count` kontrolü olmayanlar (`voidForSource`, `ensureWorkOrderInProgress`, `shipmentOrder.updateMany`) **idempotent temizlik / toplu güncelleme** sayılıp bulgu YAZILMADI |
| A.4 advisory lock sırası + namespace | **uygulandı** — 8022/8025/8027 sırası doğrulandı, 8023'ün **eksik çağrı yeri** bulundu (KYY-3-13); namespace çakışması **yok** (hepsi 2 argümanlı ve ayrı) |
| A.5 çok instance / in-memory durum | **kapsam dışı — sebep:** tek process invariant'ı belgeli (`ecosystem.config.js`), bu yolların hiçbiri modül seviyesi durum taşımıyor |
| A.6 belge/sayaç üretimi | **uygulandı** — parti no (8022, KYY-27), FS/SVK `nextPrefixedSequence`, kart `version`, barkod sayacı; **mükerrer numara bulunamadı** |
| A.8 cache ↔ commit sırası | **kısmen** — `readTamburOverQuantityEnabled`/`readShippingToleranceMeters` cache'siz okunuyor (doğru); feature-flag cache invalidation sırası bu yolların dışında |
| B.3 `clientToken` kapsaması | **uygulandı** — KYY-09 fason sevkinde `clientToken` **YOK** (küme-eşitliği guard'ı yerine geçiyor, KYY-3-10'un ikinci ayağı); KYY-15 kesimde **opsiyonel** (KYY-3-01'in tetikleyicisi) |
| D tx sınırı / yan etki | **uygulandı** — audit tx dışı (bilinçli), `freezeForSource` tx içi ✓, `markMerged` tx dışı best-effort, `CANCEL_WO` aksiyonları tx dışı **telafisiz** (KYY-30 S2'de kayıtlı, bulgu D-D alanına ait) |
| E iş kuralı değişmezleri | **uygulandı** — INV-STK-03, INV-STK-12, INV-SEV-08, INV-SEV-12/13, INV-SEV-03, INV-AUD-02, INV-AUD-04, INV-MD-02, INV-YT-03, INV-DOC-04 tek tek dörtlü kontrolden geçirildi (kod → eşzamanlılık → DB kısıtı → saha verisi) |
| G yetki | **kısmen** — yalnız KYY-39/42'nin yazma yoluyla kesiştiği yer; IDOR/rate-limit/raw-unsafe D-G alanına bırakıldı |
| H performans | **kısmen** — yalnız kilit süresi (KYY-3-09); sorgu maliyeti D-H'ye devredildi (beceri §0: `veri-performans` burada DAR) |
| K bekçi körlüğü | **uygulandı** — `test_batch_number_format` (sıra ölçüyor ✓), `test_db_invariants` §6 (varlık ölçüyor, **etki ölçmüyor** → KYY-3-08), `test_order_line_scope_single_source` (metin ölçüyor, davranış ölçmüyor → KYY-3-05), `test_traveler_print_active_card` (print ölçüyor, print-event ölçmüyor → KYY-3-15) |

---

## 5. Doğru yapılanlar (korunması gereken kalıplar)

1. **Guard'lı decrement = atomik claim (Tambur normal kesim).** `tambur.service.ts:2242` / `:2935`:
   `where: { id, status, shipmentId: null, sackId: null, currentQty: { gte: cutLength } }` + `data: { currentQty: { decrement } }` + `P2025 → 409`. Hesap DB tarafında, koşul `where`de; iki eşzamanlı kesimden ikincisi ya meşru bir ikinci kesim olur ya temiz 409 alır. **Bu, repoda gördüğüm en iyi eşzamanlılık deseni** — KYY-3-01'in düzeltmesi de bu desenin aşım dalına taşınmasıdır.
2. **Kapsam daraltmalı koşullu kapanış (KK2 `finishStep`).** `kursun-qc.service.ts:888` raw `UPDATE roll_movements … WHERE "exitedAt" IS NULL AND "rollId" = ANY($1) RETURNING` — hem claim işini görüyor hem **araya giren yeni topu süpürmüyor**; `closed.length === 0` dalı isteği **idempotent 200** yapıyor (`:907`). Yorumu (`:878-882`) neden `ANY(rollIds)` olduğunu açıklıyor.
3. **Yazılı kilit protokolü + uygulayıcı listesi.** `helpers/order-status.helper.ts:203-211` yalnız "kilitle" demiyor; **neden tam küme**, **neden id-sıralı**, **neden alt-küme yasak** ve **kimlerin uyduğu** yazılı. Bu sayede ihlali mekanik olarak bulmak mümkün oldu (KYY-3-05). Aynı disiplin `shipment-locks.helper.ts:29-51`te de var: kilidin var olma gerekçesi **üretilmiş bir vaka** ile birlikte yazılmış.
4. **Kilit sırasının bekçisi.** `test_batch_number_format.ts` `pg_advisory`nin **varlığını** değil **sırasını** ölçüyor (`calls[0] === lock(8022,1)`) ve dört negatif sonda ile kırmızı verdiği doğrulanmış. Beceri §4.2'nin istediği tam bu.
5. **Hayalet guard'ın "filtre değil assertion" kararı.** `shipping.service.ts:1834-1848` — flip'in `WHERE`ine `notIn` koymanın neden **onarılamaz çıkmaz** üreteceği yazılı; fail-closed seçilmiş ve gerekçesi kayıtlı.
6. **Kısmi başarının açıkça yazılması.** `attachRolls :4508-4520` (per-top `errorMessages`), `cancelBulk :2183` (`failed[]`), `transferToNextFason :1589-1590` (belgeli kısmi) — üçü de politikayı **yazıyor**. KYY-3-10 bu kültürün tek istisnası olduğu için bulgu.
7. **`SET LOCAL` kapısının sırası ve bekçisi.** `archiveOlderThan :233` `SET LOCAL teks.audit_purge='on'` ifadenin İLK'i, ve `test_audit_depth §10` **kaynak sırasını** doğruluyor — sonradan aşağı kaydırılmasına karşı korumalı.
8. **Defter-otoritatif denorm.** `recomputeOrderStatus` increment/decrement kullanmıyor, her seferinde defterden yeniden hesaplıyor (`order-status.helper.ts:7-13`) → drift yapısal olarak imkânsız; saha ölçümü bunu doğruluyor (0/281 drift).

---

## 6. SINIR ÖTESİ NOTLAR

- **(I / D-I)** `40P01` deadlock'ı `P2039` olarak geliyor ve `SERVER_FAULT_PRISMA_CODES`/`CLIENT_DATA_PRISMA_CODES` kümelerinin ikisinde de yok (`error.middleware.ts:150-170`). Bu, KYY-3-06 olarak yazıldı ama **hata haritasının sahibi D-I**; oradaki "sınıflandırılmamış Prisma kodu" sayacına canlıda bakılmalı: `SELECT COUNT(*) FROM system_logs WHERE "recordId" IN ('P2039','P2034');`
- **(E / D-E)** `rolls` içinde `status='CANCELLED' AND "cancelledAt" IS NULL` **134/230** (saha). Kırılım: `TAMBUR_SPLIT 92`, `SUPPLIER_RECEIPT 39`, `MANUAL_ENTRY 2`, `SUBCONTRACTOR_RETURN 1`. Bu denetçinin yollarından yalnız **1 satır** (`cancelReceipt`, KYY-3-14) açıklanıyor; kalan 133 satır **başka yazma yollarından** geliyor (Tambur geri alma / hayalet top `MUKERRER` iptali / dropBatch dispozisyonu adayları). INV-AUD-04'ün sahibi D-E, çağrı yeri taraması oraya.
- **(C / D-C)** `roll_movements` içinde `exitedAt IS NOT NULL AND qtyOut IS NULL` **14 satır** (saha). Üreticiler: fason sevk iptali (`subcontractor.service.ts:2071` raw), manuel taşıma kapanışı (`workorder-manual-move.service.ts:647`). INV-STK-05 bunu "uydurma" dalı olarak tanımlıyor; okuyucular null'ı tolere ediyor. **Bilinçli mi, karar yazılı mı** — D-C/D-E netleştirmeli.
- **(G / D-G)** `POST /api/devices/announce` **kimlik doğrulamasız** (`device.middleware.ts:27-31`) ve **rate limit yok**; `resolveDevice` `pairingRequired=false` (prod varsayılanı) iken `x-device-id` **sırsız, istemci beyanı** bir kimliktir ve `label.routes.ts` çevre birimi yönlendirmesinde kullanılıyor → sahte başlıkla başka istasyonun yazıcısına baskı yönlendirilebilir. Yazma yolu analizim bunu kapsamıyor (yetki alanı), D-G'ye.
- **(G / D-G)** `DELETE /api/customers/:id/permanent` ve `/api/items/:id/permanent` uçları `customer:write` / `item:write` ile korunuyor; `master-data:merge` gerektirmiyor. KYY-3-11'in tetikleyicisi bu izin genişliği — SoD açısından D-G bakmalı.
- **(K / D-K)** Bu denetimde kullanılan 5 repro scripti (`Teks-Erp/scripts/audit_repro_KYY-3-0*.ts`) **regresyon bekçisi olmaya hazır**: hepsi `devDbGuard()` taşıyor, fixture damgalı, `finally` temizlikli ve `process.exitCode` üretiyor. `run-all-tests.ts`e alınmadan önce isimleri `test_*` kalıbına çevrilmeli (koşucu `test_` önekiyle tarıyor).
- **(H / D-H)** `master-data-merge.service.ts:711` tx opsiyonu `{ timeout: 120_000 }` ile DB `statement_timeout = 50s` **ayrışıyor**: 50 s'yi aşan bir merge tx'i DB tarafında kesilir, uygulama 120 s beklediğini sanır. Ölçüm bende değil, D-H/D-D'ye.
- **(J / D-J)** `system_log_archives` sahada **0 satır** — arşiv/purge yolu canlıda hiç koşmamış; 1M+ satır senaryosu yalnız fixture'da ölçülmüş (K8 H-3 ile tutarlı).

---

## 7. KAPSANMAYAN / ERİŞİLEMEYEN

- **Canlı prod'a erişim yok.** Tüm K2 ölçümleri 2026-08-25 tarihli `tekserp_saha_0825` kopyası üzerinde. Bu kopya son 5 migration'ı taşımıyor (sipariş/kalem iptal kolonları orada YOK), bu yüzden **INV-SIP-02 ile ilgili saha ölçümü yapılamadı** (yalnız dev'de).
- **`teks.audit_guard`'ın prod'daki gerçek değeri ölçülemedi.** `pg_dump` veritabanı düzeyi `ALTER DATABASE … SET` ayarlarını taşımaz; saha kopyasındaki `pg_db_role_setting` satırları **yerel kümenin** ayarlarıdır. KYY-3-08 bu yüzden K1 ve `[VARSAYIM]` etiketli; kesin kontrol canlıda `GET /api/admin/health` (`auditGuard`) ya da `SHOW teks.audit_guard`.
- **Prod DB kullanıcısının superuser olup olmadığı bilinmiyor** `[VARSAYIM]` — tamper trigger'ının etkinliği buna da bağlı (superuser `session_replication_role` ile trigger'ları atlayabilir).
- **KYY-09 (fason sevk) ve KYY-12 (makbuz iptali) için repro yazılmadı.** Sebep: fason fikstürü (istasyon + kategori + firma + rota + parti + sevk) tek script bütçesini aşıyor ve iki yolun da yarış kolu kod okumasıyla **HAYIR** çıktı; bulgu (KYY-3-10) yarış değil, sessiz kısmi başarı.
- **KYY-39 (son-admin) için repro yazılmadı — bilinçli.** Senaryoyu tetiklemek paylaşımlı dev DB'de diğer adminleri pasifleştirmeyi gerektiriyordu; kabul edilemez yan etki. Kanıt kod + Zod şeması okuması (K1).
- **KYY-33 (print-event) ve KYY-27 (8022 ABBA) için repro yazılmadı.** Bütçe daha yüksek etkili yollara ayrıldı; ABBA sınıfının gerçekliği KYY-3-05'te **aynı motorla** (PostgreSQL deadlock detector) kanıtlandı.
- **`completeQc2`'nin tam satır aralığı doğrulanamadı** (`kursun-qc.service.ts` ~`:380-537`); KYY-18'de `[VARSAYIM]` olarak işaretlenen tek nokta budur — davranışı `roll_operations` unique'i kapattığı için bulgu üretmedi.
- **Kilit bekleme süreleri ölçülmedi.** `pg_stat_statements` kurulu değil (KUNYE) ve saha kopyası canlı yük taşımıyor; KYY-3-09'un "20 s'ye kadar tutuluyor" ifadesi **tx bütçesi üst sınırıdır**, ölçülmüş ortalama değildir.
- **Electron/mobil istemci tarafı denetlenmedi** (denetim kapsamı backend). KYY-3-10'un kullanıcıya görünen yüzü Electron fason sevk ekranındadır ve orada `failed[]` gösterimi olmadığı **varsayılmıştır** `[VARSAYIM]`.
- **`bench_audit_summary.ts`in sentetik `system_logs` INSERT'i** (K4 H8'de kayıtlı) okundu ama ayrı bulgu yazılmadı — KYY-3-07 ile aynı sınıf (kapısız script), düzeltme önerisi orada kapsıyor.
