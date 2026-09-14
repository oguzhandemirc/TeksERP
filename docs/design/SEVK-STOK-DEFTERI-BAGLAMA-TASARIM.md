# Sevk · storno · iade · transfer · fason dönüşü — eski kapıdan STOK DEFTERİNE taşıma tasarımı

> **Durum: ONAYLI (yönetici `teks-erp-1e`, 2026-09-12 gece) — uygulama kullanıcı kararıyla açılır, bu gece BAŞLAMAZ.** Kod ve şema DOKUNULMADI. Dokuz karar geçti; K4/K6/K7'ye şart, K9'a nüans eklendi (aşağıda kararın içinde). Ana tasarım `DEPO-STOK-DEFTERI-TASARIM.md` (D1–D9) burada TEKRAR YAZILMAZ; bu belge yalnız **statüsüz satır yazan son yazıcıların** taşınmasını, her yolun ters yolunu, geçmiş satırların kaderini ve dört mekanizma doktrinine göre sınıflandırmayı karara bağlar.
>
> **Neden şimdi:** açılış fotoğrafı (`scripts/acilis_fotografi_stok_defteri.ts`) SIKI modda `--apply`yi reddediyor, çünkü "sevk bağı" ölçümü (`scripts/lib/stok-defteri-bag-olcumu.ts`) **K = 6 çağıran** buluyor. Bu belge o altı çağıranı (ve ölçümün kapsamı dışında kalan bir yedincisini) kapatır; kapandığında K = 0 olur, sahada bir sevk yazılınca V kanıtı gelir, fotoğraf sıkı modda iner.

## 0 · Tek cümle

Stok kümesine giren ya da ondan çıkan HER top hareketi **tipli iki uçla** (`from`/`to` = depo + statü) tek kapıdan (`postStockMove*`) yazılır; **stok dışı uç** (SHIPPED · AT_KARTELA · CANCELLED) depo taşımaz ama statü taşır; deftere yazan her ileri yolun **bağlı ters yolu** vardır; sevk satırı **brüttür ve değişmez** (storno = bağlı ters satır, iade = ayrı ileri satır); geçmiş 721 satır **dokunulmaz**, epoch onları tarihsel iz yapar; **yeni bayrak açılmaz**.

## 1 · Ölçüm — bugünkü gerçek (2026-09-12, fabrikanın dev kopyası, ağaç `129cd330`)

| Yol | Çağrı yeri | Bugün yazdığı | Ters yolu bugün |
|---|---|---|---|
| Sevk (DISPATCH) | `shipping.service.ts:3310` `performDispatchTx` | `SHIPMENT` · `fromWarehouseId` · `shipmentId` · **statüsüz** (334 satır) | storno satırı var ama BAĞSIZ (`reversesMovementId` NULL) |
| Storno (undo dispatch) | `shipping.service.ts:3790` `undoDispatch` | `SHIPMENT_REVERSAL` · `toWarehouseId` · **statüsüz** (15 satır) | — (kendisi ters yol) |
| İade (RollReturn) | `return.service.ts:576` `createReturn` | `RETURN` · `toWarehouseId` · `rollReturnId` · statüsüz (0 satır — fabrika henüz iade almamış) | **YOK** — `cancelReturn` (`:838`) topu SHIPPED'e döndürür, defter satırı YAZMAZ |
| Depolar arası transfer | `warehouse-transfer.service.ts:281` `create` | `TRANSFER` (top + çuval üyesi) · statüsüz (0 satır, tek depo) | `cancel` (`:543`) `TRANSFER_REVERSAL` yazar — BAĞSIZ, defterden okur |
| Transfer iptali | `warehouse-transfer.service.ts:543` | `TRANSFER_REVERSAL` statüsüz | — (kendisi ters yol) |
| Fason dönüşü doğumu | `subcontractor.service.ts:3254` `receiveRolls` | `ENTRY` yalnız `bornStatus = WAREHOUSE` ise (`cb1d0304`) · statüsüz | **YOK** — `cancelReceipt` (`:5148`) doğan topu `CANCELLED` yapar (`:5296`), defter satırı YAZMAZ |
| **Kartela sevki (ölçüm dışı 7.)** | `kartela.service.ts:326-330` `WAREHOUSE → AT_KARTELA` · `:439` geri dönüş | **HİÇ satır yazmaz** (ne eski ne yeni kapı) | yok |

- `tx.warehouseMovement.create*` yalnız `warehouse-ledger.helper.ts`te (4 site); yeni kapı (`postStockMove*`) 8 serviste, eski kapı (`writeWarehouseMovement(s)`) yukarıdaki 6 sitede. AST ile ölçüldü (`test_stok_defteri_bag_olcumu`).
- Defter: 778 satır · 721 statüsüz (ENTRY 358 · SHIPMENT 334 · SHIPMENT_REVERSAL 15 · CANCEL 14) · 57 statülü ENTRY (yeni kapı, 2026-09-12). `preEpoch` 0, `OPENING_BALANCE` 0.
- **Doğrudan fason sevki** (`subcontractor.service.ts:6625`, `AT_SUBCONTRACTOR → SHIPPED`) stok dışından stok dışınadır; satır yazmaz, yazmamalı (sevk rakamı `reports/_shipped.ts`'ten gelir, DirectShipment dahil).
- `consistency-check.sql §1c/§1d` **SackAllocation** (sipariş tahsisi) boşluğudur, depo defteriyle ilgisi yok; kullanıcının 2026-09-11 "onarım yok" kararı o deftere aittir. Bu tasarım `SackAllocation`a dokunmaz.
- Yeni kapının sözleşmesi (`warehouse-ledger.helper.ts:189-256`): `StockMoveEnd = { warehouseId: string; status: RollStatus }` — **uç depo olmadan kurulamaz**; `stockMoveRow` en az bir uç ister, metraj > 0 ister. `reverseStockMove` (`:295`) uçları İLERİ SATIRDAN aynalar; ileri satır statüsüzse iki uç da `undefined` kalır ve kapı fırlatır → **statüsüz satır bugün terslenemez** (`reverseAllRollStockMoves` bunu `statusuzAtlanan` sayar).
- d9 bulgusu (2026-09-12): varsayılan depo yokken son adım finalize **200** döner, top `WAREHOUSE` olur, `warehouseId` NULL kalır — `roll-finalize.helper.ts:222` `if (r.warehouseId && …) postStockMove` satırı yazmayı **sessizce atlar**. Bu gece doldurulan 4.568 deposuz topun kaynağı büyük olasılıkla bu yol. Aynı sessiz atlama eski kapının `hasWarehouseEnd` süzgecinde de var (`:81-90`).

## 2 · Kararlar

### K1 — [ÇEKİRDEK] Stok dışı uç: depo taşımaz, statü taşır

`StockMoveEnd` iki biçim alır ve kapı bunu **tek kuralla** doğrular:

```
uç.warehouseId NULL  ⇔  uç.status ∉ WAREHOUSE_STOCK_STATUSES
```

- `SHIPMENT`: `from = {W, preStatus}` · `to = {∅, SHIPPED}` — satır "WAREHOUSE'tan SHIPPED'e gitti" der (D2 ①'in vaadi; bugünkü tip bunu yazamıyordu).
- `RETURN`: `from = {∅, SHIPPED}` · `to = {W, appliedStatus}`.
- Kartela: `from = {W, WAREHOUSE}` · `to = {∅, AT_KARTELA}`.
- **"Depoda ama neresi belli değil" defterde YAZILAMAZ:** stok kümesi statüsü taşıyan uç depo ister; deposuz top stok kümesine **giremez** (K6). d9'un bulduğu "iki gerçek tek çıktıya iniyor" sınıfı burada mekanik olarak kapanır.
- Σ ve as-of yalnız `status ∈ küme` uçları sayar (D4/D5 formülü değişmez); stok dışı uç kırılım ve "nereye gitti" içindir.
- **Bugünkü yeni-kapı yazarları değişmez:** `CANCEL` (`inventory.service.ts:3659`) ve `PRODUCTION` çıkışları `to`suz kalabilir; stok dışı ucu yazmak **isteğe bağlıdır**, zorunlu değil. Geriye dönük yeniden yazım yok.

### K2 — [ÇEKİRDEK] Yedi yol, yedi satır biçimi

| Yol | eventType | reasonCode (katalog satırı, enum değil) | from | to | Belge bağı |
|---|---|---|---|---|---|
| Sevk | `SHIPMENT` | `SHIPMENT_DISPATCH` (yeni) | `{roll.warehouseId, g.status}` — `preStatusGroups` zaten grup başına biliyor (`:3282-3293`) | `{∅, SHIPPED}` | `shipmentId` · `sackId` |
| Storno | `SHIPMENT_REVERSAL` (override, D2a "mevcut değer betimleyici") | `SHIPMENT_UNDO` (yeni) | ileri satırın aynası | ileri satırın aynası | `reversesMovementId` → SHIPMENT satırı (ZORUNLU) |
| İade | `RETURN` | `CUSTOMER_RETURN` (yeni) | `{∅, SHIPPED}` | `{W, appliedStatus}` | `rollReturnId` |
| İade iptali | `RETURN` (kopya) | `RETURN_CANCEL` (yeni) | RETURN satırının aynası | RETURN satırının aynası | `reversesMovementId` → RETURN satırı |
| Transfer | `TRANSFER` | `WAREHOUSE_TRANSFER` (yeni) | `{W1, status}` | `{W2, status}` (statü değişmez) | `transferId` · `sackId` |
| Transfer iptali | `TRANSFER_REVERSAL` (override) | `TRANSFER_UNDO` (yeni) | aynası | aynası | `reversesMovementId` → TRANSFER satırı |
| Fason dönüşü doğumu | **`EXTERNAL`** (D2 taksonomisi; ENTRY değil) | `FASON_RECEIPT` (var) | — | `{receipt.warehouseId, WAREHOUSE}` yalnız `bornStatus = WAREHOUSE` | `workOrderStepId` = fason adımı |
| Fason kabul iptali (doğan top) | `EXTERNAL` (kopya) | `FASON_RECEIPT_CANCEL` (yeni) | aynası | aynası | `reversesMovementId` → doğum satırı; kapsam `reverseLatestScopedStockMove({FASON_RECEIPT, stepId})` |
| Kartela sevki | `EXTERNAL` | `KARTELA_DISPATCH` (var) | `{W, WAREHOUSE}` | `{∅, AT_KARTELA}` | (KartelaDispatch bağ kolonu YOK — `notes`a `kartelaDispatchId`; bağ kolonu bu dilimde AÇILMAZ, ölçülüp ayrı karar) |
| Kartela sevk iptali (`:439`) | `EXTERNAL` (kopya) | `KARTELA_DISPATCH_CANCEL` (yeni) | aynası | aynası | `reversesMovementId` |

- **Metraj:** ileri satır = `currentQty` o an (sevkte top BÜTÜN gider); ters satır metrajı **ileri satırdan kopyalanır** (`reverseStockMove` zaten böyle). Brüt kuralının defterdeki karşılığı budur: SHIPMENT satırı **asla** güncellenmez/silinmez; iade onu düzeltmez, `RETURN` ayrı ileri satırdır; storno onu düzeltmez, bağlı ters satırdır.
- **Sevk rakamının kaynağı DEĞİŞMEZ.** "Dönemde sevk edilen metraj" tek tanım `reports/_shipped.ts` (RollReturn geri-eklemeli) — stok defteri **altıncı kaynak olmaz** (`sevkiyat.md:28` "altıncı kaynak altıncı rakam"). Defter yalnız fiziksel stok etkisini taşır; brüt kuralı burada **satırın biçimini** bağlar, rapor kaynağını değil.
- **Stok dışından stok dışına satır yok** (bugünkü kapı disipliniyle aynı): doğrudan fason sevki · `SCRAP` hedefli iade (`appliedStatus = SCRAP`, FİRE kalitesi) · kartela tüketimi (`KARTELA_CONSUMED`) · PLANNED sevkiyat iptali (toplar rafta) · çuvala okutma. `SCRAP` hedefli iadenin iptali de satırsızdır (simetri). `RollReturn` bu durumu kendi taşır.
- **Çuval:** çuvalla giden/taşınan topun satırı `sackId` taşır (bugünkü gibi); transfer iptali "hâlâ aynı çuvalda mı" guard'ını buradan okumaya devam eder.

### K3 — [ÇEKİRDEK] Ters yol envanteri — altı ileri kaynağın altısının bağlı tersi

| İleri | Ters yol | Bugün | Yapılacak |
|---|---|---|---|
| SHIPMENT | storno (`undoDispatch`) | var, bağsız, statüsüz | `reversesMovementId` bağı + statülü uçlar; çift storno **DB unique** ile imkânsız |
| RETURN | `cancelReturn` | **yok** | RETURN satırının bağlı tersi; SHIPMENT satırına DOKUNULMAZ (storno ≠ iade: iade iptali sevki geri almaz, malı tekrar "müşteride" sayar) |
| TRANSFER | `cancel` | var, bağsız | bağlı ters; okuma `reversesMovementId IS NULL AND reversedBy none` |
| EXTERNAL (fason doğum) | `cancelReceipt` | **yok** | kapsamlı bağlı ters (`FASON_RECEIPT`); `computeBornRollBlockingReasons` zaten "işlem görmüş top"u engelliyor → doğum satırı o topun tek stok satırıdır |
| EXTERNAL (kartela) | kartela sevk iptali | **yok** (ileri de yok) | ikisi birlikte doğar — ters yolsuz ileri yol sürüme çıkmaz (`defter.md:56`) |
| SHIPMENT_REVERSAL / TRANSFER_REVERSAL / *_CANCEL | — | — | ters kaydın tersi YAZILMAZ (`reverseStockMove` 409'u); yeniden sevk = yeni ileri SHIPMENT satırı |

**Storno ≠ iade defterde nasıl görünür:** stornolu sevk = `SHIPMENT` + ona bağlı `SHIPMENT_REVERSAL` (net 0, mal hiç çıkmadı); iadeli sevk = `SHIPMENT` (bağsız, kalıcı) + `RETURN` (`rollReturnId`, bağsız). "Bu satır ters kayıt mı" sorusunun tek cevabı `reversesMovementId IS NOT NULL` (D2a) — `RETURN` asla `reversesMovementId` taşımaz.

### K4 — [ÇEKİRDEK] Epoch öncesi ileri satırın epoch sonrası tersi: bağ kurulur, uçlar CANLIDAN

Fotoğraftan sonra stornolanacak 334 sevk, iptal edilebilecek transferler (0) ve fason doğumları (358 ENTRY) **statüsüz** ve `preEpoch = true`. Bunları `reverseStockMove` tersleyemez (uç yok). Üç seçenek ölçüldü:

| Seçenek | Sonuç |
|---|---|
| Statüsüz ileri satırı ATLA (bugünkü `statusuzAtlanan`) | Storno malı rafa döndürür ama defter GİRİŞ görmez → Σ eksik kalır. **Red.** |
| Bağsız yeni ileri satır yaz | Σ doğru ama çift storno seddi (unique) kaybolur, "ters kayıt mı" sorusu cevapsız. **Red.** |
| **`reverseLegacyStockMove`: bağ ileri satıra, uçlar canlı veriden, metraj ileri satırdan** | Σ doğru, unique korunur, satır `reversesMovementId` ile eski satırı gösterir. **Kabul.** |

Uç kaynakları: storno → `to = {roll.warehouseId, preShipStatus ?? WAREHOUSE}` (kod zaten böyle döndürüyor, `:3766-3772`), `from = {∅, SHIPPED}`; transfer iptali → `from = {toW, roll.status}`, `to = {fromW, roll.status}`; fason kabul iptali → `from = {roll.warehouseId, roll.status}`.
Helper yalnız **`preEpoch = true` ∧ statüsüz** satırda bu dala girer ve **kısıt KODDA zorlanır, yorumla değil** (yönetici şartı): ileri satır `preEpoch = false` ise `reverseLegacyStockMove` FIRLATIR ("epoch sonrası statüsüz satır — legacy dal değil, tutarsızlık"); bekçinin negatif sondası tam bu satırdır (`preEpoch=false` statüsüz fixture → kırmızı). Epoch sonrası statüsüz satır **hata sinyalidir** (D6 vaadi: taşıma bitince `statusuzAtlanan > 0` kırmızı olur) ve bu dal onu SUSTURMAZ — kısıt gevşerse legacy yol yeni satırları sessizce yutmaya başlar, sinyal kaybolur.
Kural: **fotoğrafın kendisi terslenmez.** Fotoğraftaki topun iptali/sevki OPENING_BALANCE satırının tersi değil, normal ileri çıkıştır (`CANCEL`/`SHIPMENT` from = `{W, status}`) — fotoğraf beyandır, işlem değil.

### K5 — [ÇEKİRDEK] Geçmiş 721 satır: DOKUNULMAZ; epoch kapatır

| Seçenek | Ne yapar | Maliyet | Doktrin | Hüküm |
|---|---|---|---|---|
| **A — Dokunma, epoch** | 721 satır `preEpoch=true` olur, Σ epoch'tan başlar, epoch öncesi as-of "defter öncesi" der (D6) | 0 veri işlemi; K4 helper'ı | D6 ile birebir | **ÖNERİLEN** |
| B — Statü backfill (UPDATE) | `SHIPMENT`e `fromStatus = preShipStatus`/`toStatus = SHIPPED`, `ENTRY`ye `toStatus` çıkarımı | Script + 721 satırlık dökümlü `--apply`; `preShipStatus` storno/iadede boşaltılmış (`:3771`), doğum statüsü tambura tüketilmiş toplarda çıkarımla — **~%20 KANIT YOK** | "defter satırına yazılan tek güncelleme `preEpoch`tir" (fotoğraf script'i başlığı, yönetici onayı) — **ikinci güncelleme sınıfı açar** | Yalnız kullanıcı isterse; kazancı epoch öncesi depo×durum as-of'u, ki kimse istemedi |
| C — Ters kayıt + statülü yeniden yazım | 721 ters + 721 yeni satır | 1.442 satır gürültü | "geçmiş yeniden yorumlanmaz" (D6 ⑤) ihlali | **Red** |

A'nın bilinçli bedeli yazılır: fotoğraftan önce sevk edilen 319 top için "hangi statüden çıktı" defterde yoktur; soru sorulursa cevap `Roll.preShipStatus`/`ShipmentEvent`tedir, defter değil. **Bilgi kaybolmuyor, yeri değişiyor.** B'nin asıl reddi maliyet değil doktrindir: defter satırı değişmez; tarihsel rahatlık için o kural esnetilirse bu gece yakalanan her şeyin zemini gider — ve ~%20 satırda kanıt yok, **kanıtsız satıra dokunulmaz** (iki onarım script'inin kuralı). Kullanıcının 2026-09-11 kararı (sevk-tahsis boşluğu onarılmaz) ile aynı çizgidir.

### K6 — [ÇEKİRDEK] Deposuz top stok kümesine GİREMEZ — kapı `warehouseId`ye bakar

- Stok kümesine giren her yazar (`roll-finalize` · `roll-disposition` · `receiveRolls` doğum · `RETURN` · `restoreCancelled` · terfi yolları) `warehouseId` NULL ise **400 "varsayılan depo tanımlı değil"** verir; sessiz atlama (`if (r.warehouseId && …)`) **kaldırılır** — "meşru atlama" yalnız 0 metraj ve stok dışı hedef için kalır.
- Stok kümesinden çıkan her yazar (sevk · transfer · kartela · iptal) `warehouseId` NULL top görürse **409 + barkod listesi** ("deposuz top, önce `backfill_roll_warehouse`"); eski kapının `hasWarehouseEnd` süzgeci yeni kapıya TAŞINMAZ.
- DB seddi: `rolls_stock_requires_warehouse_ck` — `status IN (küme) ⇒ "warehouseId" IS NOT NULL`. **Sıra `rolls_qty_le_initial` emsali (bu gece uygulandı):** veri 0 ihlale iner (backfill bitti: kalan 0) → `NOT VALID` eklenir → ayrı `VALIDATE CONSTRAINT` → `pg_constraint.convalidated` **`f → t` ÖLÇÜLÜR**; ölçülmeden "sed açıldı" DENMEZ. ⚠️ **Ölçülmeden yazılmaz:** fixture'ları deposuz `STOCK` top doğuran bekçiler varsa önce onlar; `test_db_invariants` envanterine girer.
- İade hedef deposu: varsayılan = topun son deposu (`Roll.warehouseId` sevkte temizlenmiyor — **veri**); `depo.multiEnabled` açık kurulumda iade formunda depo seçimi (**aksiyon anında**, mevcut modül kapısı, yeni bayrak yok); ikisi de yoksa fail-closed.

### K7 — [ÇEKİRDEK] Sıra: ters yolsuz ileri yol sürüme çıkmaz; tek commit değil, yol başına commit

1. Helper: K1 uç biçimi + `reverseLegacyStockMove` + `statusuzAtlanan`ın epoch sonrası kırmızıya dönmesi (`test_stock_ledger_helper §11`).
2. Yol başına **ileri + ters + bekçi** aynı commit'te: sevk/storno → iade/iade iptali → transfer/iptali → fason doğum/kabul iptali → kartela sevk/iptali. **Sayaç YEDİ yolu kapsar ve kapsadığı kümeyi basar** (yönetici şartı — "sayı, kapsadığı kümeyi de söylemeli"): K aracı iki kümeyi AYRI ölçer ve toplar — (i) eski kapı çağıranı (AST, bugün 6 site) + (ii) **bilinen kapısız yollar listesi** (`kartela.service.ts` `WAREHOUSE→AT_KARTELA` sevki ve `:439` dönüşü, 2 site; bu iki gövdede `postStockMove` çağrısı ARANIR, yoksa sayılır). Toplam **8 site / 7 yol**; commit başına 8 → 6 → 5 → 3 → 2 → 0. 0'a inince eski kapı fonksiyonları **silinir** (AST bekçisi tanım yoksa "araç bozuk" der → o gün K aracı `postStockMove` dışı `warehouseMovement.create` tripwire'ına çevrilir, bekçi güncellenir).
3. Backend sahaya (yedekli panel zaten sahada, D8) → ilk gerçek sevk V kanıtını yazar → fotoğraf SIKI modda iner (ENGEL ① bu gece kalktı, ⑥ bu tasarımla kalkar).
4. Sonra: `rolls_stock_requires_warehouse_ck` VALIDATE → D5 ertelenmiş trigger seddi (§3.1 GO/NO-GO yeşilken).

**Neden bu gece başlamıyor (yönetici kararı):** (a) davranış **kullanıcıya görünür** değişiyor — bugün sessizce geçen yollar 400/409 verecek ("varsayılan depo tanımlı değil", "deposuz top"); bu bir **sürüm notu maddesidir** ve kullanıcı sahada bir sevk durmadan önce bilmelidir; (b) zincirin sonu sahaya bağlı — fotoğrafın SIKI modda inmesi backend'in sahaya çıkmasına ve ilk gerçek sevkin V kanıtını üretmesine bağlıdır, yani dilim **paket çıkışına** bağımlıdır ve paket çıkışı kullanıcının kararıdır.

### K8 — Dört mekanizma doktrini: neresi ne

| Varyasyon | Mekanizma | Gerekçe |
|---|---|---|
| Her stok giriş/çıkışı tipli satır yazar; ters yol; brüt; deposuz top kümeye giremez; storno ≠ iade | **① çekirdek** | Defter semantiği her kurulumda aynı; seçenek yok |
| Sevkte topun hangi statüden çıktığı | **② veri** | `preStatusGroups` — topun kendi statüsü |
| İadenin girdiği depo / statü | **② veri** (topun son deposu · `QualityGrade.returnTargetStatus`) + **③ aksiyon anında** (iadede kalite override'ı zaten seçim; çoklu depoda depo seçimi) | Aynı fabrika bir iadeyi rafa, ötekini FİRE'ye alır |
| Storno mu iade mi | **③ aksiyon anında** — iki ayrı eylem, iki ayrı uç | Doktrinin kendisi bunu yapı olarak ayırıyor |
| Fason dönüşü hangi depoya | **② veri** (kabul fişinin deposu) | |
| Transfer yüzeyi | **④ MEVCUT bayrak** `depo.multiEnabled` | Yeni bayrak değil; defter satırı bayraktan bağımsız yazılır (tek depoda transfer yok, satır da yok) |
| Geçmişe statü backfill (K5-B) | **③ aksiyon anında** (script bayrağı, kullanıcı kararı) — kurulum bayrağı DEĞİL | Fotoğraf script'inin `--kirilim-beyan` emsali |
| **Yeni davranış bayrağı** | **YOK** | Bu dilimde kod yolu hiçbir yerde dallanmıyor |

### K9 — Bir senaryoyu imkânsız kılan şey var mı (doktrin testi)

- **Fasonla doğrudan sevk eden fabrika** (mal hiç depoya uğramaz): satır yok, Σ doğru, sevk rakamı `_shipped.ts`. ✓
- **İadeyi karantina deposuna alan fabrika**: K6 depo seçimi (aksiyon anında) — `depo.multiEnabled` açıksa mümkün; kapalıysa tek depo zaten tek raf. ✓
- **İadeyi tartıp KISMİ alan fabrika** (topun bir kısmı döner): bugün `RollReturn` topu BÜTÜN alır (`qty = currentQty`); kısmi iade yeni bir dilimdir (kesim + iade). Bu tasarım onu **kapatmaz** — `RETURN.qty` delta olduğu için kısmi metraj yazılabilir; yalnız `Roll` tarafı bölünme ister. ✓ (kapı açık)
- **Tek depolu fabrika** (adnansahin): transfer yok, kartela var, fotoğraf tek depo — sıfır görünür fark; yalnız defter satırları statülü doğar. ✓
- **Depo kavramı olmayan fabrika** (deposuz çalışmak isteyen): **dışlanmıyor, DEJENERE oluyor** (yönetici nüansı). `ensureDefaultWarehouse` kurulumda bir varsayılan depo yaratır; o fabrika tek depoyla çalışır ve ona hiç bakmaz — senaryo **destekleniyor, yalnız görünmez hâlde**. Stok defteri "nerede" sorusunu depo ile cevaplar; "en az bir depo" defterin tanım koşuludur, profil seçeneği değil — ama bu koşul kullanıcıdan bir şey İSTEMEZ, kurulum onu zaten sağlar. Altı ay sonra okuyan "bir senaryoyu kapatmışız" diye okumasın: kapatılan senaryo yok.

## 3 · Mutabakat (bekçiye girecek yüklemler)

1. `status = SHIPPED` ⇒ epoch sonrası net(R, ∀W) = 0 ve son stok satırı `to = {∅, SHIPPED}` ya da top epoch'ta zaten SHIPPED.
2. Aktif (`cancelledAt IS NULL`) `RollReturn` ⇔ terslenmemiş `RETURN` satırı (yalnız `appliedStatus ∈ küme` olanlarda); iptal edilmiş iade ⇔ bağlı ters satır.
3. `(shipmentId, rollId)` başına terslenmemiş `SHIPMENT` ≤ 1; DISPATCHED sevkiyatın SHIPPED topunun terslenmemiş SHIPMENT'ı **tam 1** (epoch sonrası sevklerde).
4. `TRANSFER` satırı ⇒ `fromStatus = toStatus` ∈ küme ve `fromWarehouseId ≠ toWarehouseId`.
5. `EXTERNAL`/`FASON_RECEIPT` satırı ⇒ topun `entrySource = SUBCONTRACTOR_RETURN` ve `bornStatus` kanıtı (`onarim_fason_donus_entry` sınıflandırması) — doğum `WAREHOUSE`.
6. Stok dışı uç: `warehouseId IS NULL ⇔ status ∉ küme` (K1) — CHECK adayı `warehouse_movements_end_shape_ck`, NOT VALID; 721 eski satır iki uç da NULL olduğu için ihlal etmez (`NULL ⇔ NULL`).
7. Epoch sonrası statüsüz satır sayısı = 0 (D6 vaadi; `test_stock_ledger_helper §11` bilgi → kırmızı).
8. Σ(to=W, küme) − Σ(from=W, küme) epoch sonrası = canlı stok (W) − OPENING(W) (D5 trigger gelene kadar bekçi).

## 4 · Dokunuş listesi (uygulayana)

- `warehouse-ledger.helper.ts`: `StockMoveEnd` iki biçim + `stockMoveRow` K1 doğrulaması · `reverseLegacyStockMove` · `writeWarehouseMovement(s)` son çağıran gidince SİLİNİR.
- `stock-move-reasons.ts`: `SHIPMENT_DISPATCH · SHIPMENT_UNDO · CUSTOMER_RETURN · RETURN_CANCEL · WAREHOUSE_TRANSFER · TRANSFER_UNDO · FASON_RECEIPT_CANCEL · KARTELA_DISPATCH_CANCEL` (katalog satırı, migration yok).
- `shipping.service.ts` `performDispatchTx` (grup başına `from.status`) · `undoDispatch` (bağlı ters, K4 dalı) · `return.service.ts` `createReturn`/`cancelReturn` · `warehouse-transfer.service.ts` `create`/`cancel` · `subcontractor.service.ts` `receiveRolls`/`cancelReceipt` · `kartela.service.ts` sevk/iptal.
- Panel: yeni enum değeri YOK (`EXTERNAL` A1'den beri var, sözlükte). Mobil: dokunuş yok.
- Bekçiler: `test_stock_ledger_shipment` · `_return` · `_transfer` (mevcut `test_warehouse_transfer` genişler) · `_fason_receipt` · `_kartela` — her biri negatif sondalı (ileri satırı statüsüz yazınca kırmızı; ters satırı bağsız yazınca kırmızı; epoch öncesi ileri satırın tersi Σ'yı kapatıyor mu); `test_stok_defteri_bag_olcumu §4` bilgi satırı her commit'te düşen K'yı basar.
- Kural satırları (yönetici hükmünden sonra): `docs/kurallar/defter.md` (K1, K4, K6), `sevkiyat.md` (K2/K3 storno ≠ iade defter biçimi), `top-duzeltme.md` (K6 deposuz), arşiv notu bu belgeye işaret eder.

## 5 · Açık bırakılanlar (bu belge karar VERMİYOR)

- `KartelaDispatch` için `WarehouseMovement`e bağ kolonu açılıp açılmayacağı (bugün `notes`; `shipmentId`/`transferId` emsali kolon ister — kartela dilimi karar versin).
- Kısmi iade (top bölünerek iade) — kesim + iade dilimi.
- D5 ertelenmiş trigger seddinin açılma günü — GO/NO-GO listesi (§3.1) hâlâ yöneticide.
