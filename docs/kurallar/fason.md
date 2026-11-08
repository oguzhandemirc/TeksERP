# Fason · Kartela
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/fason.md`.

## Ortak (backend + panel + tablet)

### Değişmezler

- **[ÇEKİRDEK]** `CariAccount.subcontractorId` ve `Customer.type` KALDIRMA fazını `scripts/test_rol_modeli_kalinti.ts`in dört kolu yeşil olmadan açma; kol ÖLÇÜLEMEDİ ise açma; ölçüt kaldırılınca KAYIP YOK.
- **[ÇEKİRDEK]** `Subcontractor` profili bir `Customer` kartına bağlanır, cari hesap YALNIZ kartta; bağsız profiller `scripts/migrate_partner_roles.ts` ile (dry-run varsayılan, kullanıcı koşar); TAHMİNLE bağlama (bağ yalnız `--baglan`).
- **[ÇEKİRDEK]** TAM kabul topu `SUBCONTRACTOR_CONSUMED` yapar, `parentReceiptId`li açık-kumaş toplar doğar (`entrySource=SUBCONTRACTOR_RETURN`); KISMİ kabulde top `AT_SUBCONTRACTOR` kalır, `currentQty` atomik decrement; her teslimat AYRI makbuz.
- **[ÇEKİRDEK]** Fason rotanın SON adımıysa doğan toplar FİNAL: `WAREHOUSE` + tx içinde sıralı barkod (Promise.all YASAK) + `form=ACIK`; ara adımsa `IN_PRODUCTION` + barkodsuz.
- **[PROFİL]** Fasondan içeri geçişte varyant rotasını `scripts/seyitoglu-rota-gecis.ts` ile değiştir (kuru koşu varsayılan; varyant başına atomik claim + audit); son adımı fason rotada kalite NULL kalır.
- **[PROFİL]** Son adımı fason rotaya kalite gerekiyorsa iç Tambur türü "Son kontrol" adımını `scripts/seyitoglu-son-kontrol.ts` ile ekle (kuru koşu varsayılan); KK2 kaliteyi NULL bırakır; iç-kalitesiz rotada betik çıkış 1 verir.
- **[PROFİL]** Fason sevk kg kontrolü kg'ı `Roll.weightKg` → `dispatchedWeight`ten okur; kg ile faturalanan boyahaneye ham top giden fabrikada `kk1.weightEntryEnabled` açık, kapalıyken satır `NO_WEIGHT`.
- **[ÇEKİRDEK]** Defter `SubcontractorReceiptItem.receivedQty`+`isPartial` (NULL = tamamı); sevk kalemi yalnız TAM (`isPartial=false`, iptalsiz) makbuz satırıyla dönmüş sayılır; tüm outstanding filtreleri bu yüklemi okur.
- **[ÇEKİRDEK]** Replay kimliği `SubcontractorReceipt.clientToken @unique`; iptal makbuz token'ı 409 `RECEIPT_CANCELLED`; küme-eşitliği cached dönüşü yalnız tam-tüketimli makbuzda, `isPartial` kalemli makbuz cached DÖNEMEZ.
- **[ÇEKİRDEK]** Parti: ilk teslimat giden partiyi sürdürür; ikinci+ teslimatta doğan toplar YENİ parti (`createBatchTx`, `splitFromId` = kaynak parti); tespit sevk-kapsamlı ve kendi makbuz satırı yazılmadan ÖNCE sayılır.
- **[ÇEKİRDEK]** Makbuz iptali LIFO: daha yeni aktif makbuz varken 409 `RECEIPT_NOT_LATEST` (önizleme `laterReceipts`); TAM kalem statüyü geri çeker, KISMİ kalem metrajı atomik increment ile geri koyar (araya kalan-kapama girdiyse 409).
- **[ÇEKİRDEK]** Çekme ölçümdür: `bornTotal − consumedTotal` (eşik 0.01 m) RollVariance'a, source `SUBCONTRACTOR_RETURN`; eksi SCRAP sebebi `FASON_CEKME`, artı OVERAGE sebepsiz; çok topta `allocateShrink` orantılı; kısmi kabulde de yazılır.
- **[ÇEKİRDEK]** `Roll.entrySource = SUBCONTRACTOR_RETURN` yazmak kabul SAYILMAZ: sapma satırı yalnız kabul yolundan doğar (tek yazar `helpers/roll-variance.helper.ts`); test temizliğinde `rollVariance.deleteMany` yalnız `receive`/`closeRemainder`/`cut*`/`finalize*` çağrısında.
- **[ÇEKİRDEK]** `completeWorkOrder` hard-block yalnız FASON: `AT_SUBCONTRACTOR`/`RETURNED_FROM_SUBCONTRACTOR` ya da açık fason sevkine bağlı IN_PRODUCTION top → 409; fason dönüşü top STOCK'a çekilemez (GUARD 3); İPTAL yolunda karar SORULUR.
- **[ÇEKİRDEK]** GİRİŞ NOKTASI: iş emrine aşağıdan katılan top yukarı adımları BEKLETEMEZ; giriş noktası = WO'daki en erken hareketin `stepSequence`'i, küçükse bekleyen sayılmaz, çözülemezse bekleyen.
- **[ÇEKİRDEK]** Kartela fasonu AYRI ve WO'suz: `KartelaDispatch` (`AT_KARTELA`) → `KartelaReceipt` ile N `Swatch`, parent `KARTELA_CONSUMED`; `KartelaDispatch`'te `clientToken` YOK, idempotency `SwatchStockReduction.clientToken`; önce `docs/design/KARTELA-TASARIM.md`.
- **[ÇEKİRDEK]** Rol bayrakları (`isCustomerRole` · `isSupplierRole` · `isSubcontractorRole`) TEK KAYNAK; `Customer.type` onlardan türer (tek yazar `resolveCompanyType`; gövdedeki `type` rollere çevrilir); liste süzgeci `filter[role]` CSV = OR.
- **[ÇEKİRDEK]** Fason rolü gövdeden yazılamaz, aktif profil bağından türer (`syncSubcontractorRoleTx`, aynı tx); profil yalnız Tedarikçi rollü karta bağlanır (yoksa 400); kart + profil TEK tx; en az bir rol yoksa 400.
- **[ÇEKİRDEK]** FASON = CARİNİN ROLÜ: `Subcontractor.customerId` (cari başına ≤1 profil), tablolar birleşmez; bağsız fason çalışır; bağ yalnız SUPPLIER/BOTH aktif cariye (CUSTOMER → 400); seçicide TEK kez listelenir; cari hesap birleştirme dry-run → onay → --apply.
- **[ÇEKİRDEK]** Yeni kod rol BAYRAĞINI okur, `type`a YAZMAZ; `Subcontractor` tablosu kalır, profil kimliği DEĞİŞMEZ; şema yalnız EKLER, varsayılan bugünkü davranış; göçü kullanıcı dry-run + onayla koşar.
- **[ÇEKİRDEK]** Fason DOĞRUDAN SEVK `shipping.orderRequirement` kapsamındadır (`assertOrderLinkAllowed(resolveOrderRequirement())`), `block` kaçışı `orderless`; kapı takarken kardeş bayrak `invoiceMode` kapsamına bak.
- **[ÇEKİRDEK]** Manuel taşıma fason adımına AT_SUBCONTRACTOR YAPMAZ, çıkış FASON SEVK ile; `FasonQuickReceivePanel` HEP TAM kabul (`receivedQty` yok); kısmi kabul yalnız `FasonReceiveDialog`/tablet.
- **[ÇEKİRDEK]** Kabulde hedef renk `wo.targetColorId`'den; renk uygulamayan fason adımı rengi SİLMEZ; "renk veren adım" tek kaynağı kategorinin `appliesColor`ı.

### Yasaklar

- **[ÇEKİRDEK]** Fasondan kısmi doğrudan sevkte ebeveynin `initialQty`sini DÜŞÜRME, yalnız `currentQty` iner; `computeWoInput` çocuğa ayrı dal açmaz.
- **[ÇEKİRDEK]** "Açık + outstanding sevk" TEK KAYNAĞI `helpers/fason-open-dispatch.helper.ts` (`OPEN_OUTSTANDING`·`OUTSTANDING_ITEM`·`outstandingItemOfOpenDispatch`), kopya YASAK; koşul BEŞLİ (alt küme DSK'lı kalem hariç); SQL ikizleri (`consistency-check-derived.sql` §24b/§24c) aynı süzgeç.
- **[ÇEKİRDEK]** `ALWAYS_BLOCKED` top (AT_SUBCONTRACTOR, AT_KARTELA, *_CONSUMED, SHIPPED…) hiçbir düzeltme yoluyla değiştirilemez; kapsam DURUMDAN çözülür, `Boolean(reason)` ile genişlemez.

### Tuzaklar

- **[ÇEKİRDEK]** Fason kabulü eski topu BUGÜN depoya alır; Ham Stok dışı sekmeler `updatedAt desc` (`rollTabDefaultSortBy`, index `[status, updatedAt]`).

### Kararlar

- **[ÇEKİRDEK]** Kartela yerini (`Swatch.status` · `sackId` · `shipmentId` · `cancelledAt`) ve doğuşunu yalnız `helpers/swatch-event.helper.ts` yazar (`transitionSwatchesTx` · `createSwatchesTx`); her geçiş aynı tx'te `swatch_events`e ADET satırı; ters yol eşli tip.
- **[ÇEKİRDEK]** Kartela Hareketleri tek süzgeçten (`kartelaEventsWhere`); "stokta kartela" yalnız `SWATCH_IN_STOCK_WHERE`; stokta/çuvalda/sevkiyatta kartela ürün ve renk için canlı referans (MV-06).
- **[ÇEKİRDEK]** Kartela durumu ↔ yer kolonları DB seddi `swatches_status_shape`; sevkiyattan çıkaran yol kartela geçişini çuvalın `shipmentId`sinden ÖNCE yazar; kilit sırası çuval → kartela.
- **[ÇEKİRDEK]** Kartela stok düşümü geri alınır, silinmez: iptal kabul ya da sevkiyatta/çuvalda kartela varsa TÜM belge 409; kalemsiz düşüm geri alınamaz; storno kabulü `FOR SHARE` kilitler, kabul iptali kümeyi tx içinde çözer; geri alma `kartela:write`, düşüm `mobile:depo` de.
- **[PROFİL]** Çekme UYARISI sunumdadır: `fason.shrinkWarnEnabled` (varsayılan AÇIK) + `fason.shrinkTolerancePct` (%10); backend ENFORCE ETMEZ, fark deftere aynen yazılır; "ÇEKME" adı, NÖTR renk.
- **[ÇEKİRDEK]** Rota kapsaması REDDETMEZ, UYARIR (create · replace · "Rengi Değiştir", `ApiResponse.warnings`); boyahanesiz rota meşru; `goods` muafiyeti nitelik topların HEPSİNDE varsa (`some` YASAK).
- **[ÇEKİRDEK]** Sipariş hedef değerini EXTERNAL adım notuna yalnız `appendTargetNotesToExternalSteps` (`helpers/fason-step-target-note.helper.ts`) ve yalnız iş emri DOĞUŞUNDA yazar; notta varsa eklemez, gövde hedefi girmez; PUT/rota değişimi notu yeniden yazmaz (`TARGET_NOTE_STALE` uyarısı).

## Backend

### Değişmezler

- **[ÇEKİRDEK]** Kısmi kabulde movement AÇIK, son teslimatta kapanır, `qtyOut = COALESCE(qtyIn, currentQty)`; `SUBCONTRACTOR_RETURNED` op unique (rollId, stepId, opType); teslimat izi makbuz kalemlerinde.
- **[ÇEKİRDEK]** Fazla dönen (`receivedQty` > kalan ya da yok) → TAM kabul: deftere kalan (clamp), `isPartial=false`; fazla fiziksel metraj ayrı eksende OVERAGE.
- **[ÇEKİRDEK]** Karne: fire YALNIZ KAPANMIŞ kalemlerden; dönen = `SUM(COALESCE(receivedQty, currentQty))` (DISTINCT ON DEĞİL) + sapma neti (SCRAP −, OVERAGE +, `reversedAt IS NULL`); açık bakiye = giden − defter − müşteriye; çekme `openQty`'ye GİRMEZ.
- **[ÇEKİRDEK]** Fasondan müşteriye giden metre karnede BAŞARILI TESLİM: fire = giden − dönen − müşteriye giden; metre atfı DSK'nın `dispatchId`sine.
- **[ÇEKİRDEK]** Kalan kapaması geri alma kapısı GEÇMİŞTEN: adımda `remainderClosedAt`li kalem yoksa 409 `REMAINDER_NOT_CLOSED_AT_STEP`, doğrudan sevkliyse 409 `ROLL_DIRECT_SHIPPED`; `remainderClosedAt` DURUM kolonu, geri almada `null`, ATOMİK CLAIM (`count===1`), WO kilidi ilk ifade.
- **[ÇEKİRDEK]** DSK yapılmış fason sevki İPTAL EDİLMEZ, kalemleri TAŞINMAZ: `cancel()` 409 (önizleme aynı yüklemden), K15 atlar (audit `skippedDirectShip`), K16 409; fasonda kalan mal kabul ya da "kalan gelmeyecek" ile kapanır.
- **[ÇEKİRDEK]** DSK koşulu iptalin atomik claim'inde (`updateMany where { cancelledAt: null, directShipments: { none: {} } }`), `count===0` tanısı tx içinde; terminal iş emrinde (CANCELLED/SUPERSEDED) kalan kapama geri alma 409 `WORK_ORDER_TERMINAL`.
- **[ÇEKİRDEK]** `SubcontractorDispatch.directShippedAt` yalnız TÜM kalemlerin topu müşteriye çıkınca (`roll.directShipmentId`) basılır; kalan-kapamalı ya da kabullü kalem varsa basılmaz.
- **[ÇEKİRDEK]** Kabul iptali stok defterine TERS satır: son adımda doğan topun `FASON_RECEIPT` girişi `FASON_RECEIPT_CANCEL` ile bağlı terslenir (`reverseLatestScopedStockMove`); ara adımda doğan top satırsızdır, ters aranmaz.
- **[ÇEKİRDEK]** Doğan topun cascade iptalinde güvenli küme `BORN_ROLL_SAFE_STATUSES` (STOCK · IN_PRODUCTION · WAREHOUSE); `computeBornRollBlockingReasons` ↔ `blockingCondition` boğaz-ikiz; çuvala girmiş ya da başka canlı defter satırlı doğan top iptali BLOKLAR.
- **[ÇEKİRDEK]** Fason firma test fixture'ı seed'den çözülmez, `fixture-subcontractor.ts` üretir (`ensureTestDyeHouse`/`ensureTestSander`/`ensureTestKartela`; `TEST-FASON-*`, idempotent upsert, SİLİNMEZ).

### Tuzaklar

- **[ÇEKİRDEK]** `scripts/`+`prisma/` tip kontrolü `npm test` ön koşulu (`tsconfig.scripts.json`; kaçış `SKIP_TYPECHECK=1`); olmayan enum üyesiyle süzme (`StationKind.EXTERNAL`) Prisma'da koşulu ATAR.

### Reçeteler

- **[ÇEKİRDEK]** "Kalan gelmeyecek" = `POST /api/subcontractor/close-remainder` (elle, sebep zorunlu, zaman aşımı yok): top `SUBCONTRACTOR_CONSUMED`, kalan RollVariance SCRAP source `SUBCONTRACTOR_REMAINDER` (ROLL_SCRAP, fail-closed), kaleme `remainderClosedAt`.

### Kararlar

- **[ÇEKİRDEK]** K1: Fason Sevk WO picker'ı `excludeWithOpenDispatch=true` ile açık+outstanding sevkli WO'yu gizler (`OPEN_OUTSTANDING`).

## Tablet (mobil)

### Değişmezler

- **[ÇEKİRDEK]** Mobil kısmi kabul TEK soru "Fasonda kalan var mı?" + tek metraj; `resolveReturns` kalanı büyük toptan en az topa yığar, deterministik; satır başına "Gelen (m)" kaçış kapısı; Tek Parça'da satır HEP 1 (`switchReceiveMode`).
- **[ÇEKİRDEK]** Okutma geri bildirimi ekran ekran KOPYALANMAZ: `scanFeedback.signalScan` (ekran Haptics'i doğrudan çağırmaz), `useScanFeedback` (signalScan'i kendisi çağırır), `ScannerRollStrip`.

### Yasaklar

- **[ÇEKİRDEK]** RN Paper `SegmentedButtons` `flexDirection:'row'` kabının doğrudan çocuğu OLAMAZ; yanına bir şey konacaksa AÇIK `width` (minWidth YETMEZ).

### Reçeteler

- **[ÇEKİRDEK]** Yeniden üretim sebebi: metin → 1. adım notu; kod → `WorkOrder.parameters.rework` (migration YOK); ölü etiket uyarısı onay adımında, yalnız etiketli VE ilk adım fason ise, bilgi olarak.

## Geçersiz kılınan kurallar — bunlara UYMA

- **KISMI** Kök «Fason dönüş»: "SUBCONTRACTOR_CONSUMED" yalnız TAM kabulde, "barcode null" yalnız ARA adımda doğru.
- **KISMI** Mobil kısmi kabul tek soru + tek metraj; Electron `FasonReceiveDialog` satır bazlı kalır.
- **KISMI** Karne "dönen" = kabul defteri + sapma defteri.
- **KISMI** "admin/123123 hâlâ AÇIK" paragrafı ölü.
- **KISMI** "Doğrudan sevk fire hesabına girmez" geçersiz; karnede BAŞARILI TESLİM.

## Çözülmüş çelişkiler

- Kök «Fason dönüş» ↔ kısmi kabul: kod B'yi uygular (yukarıdaki iki KISMI).
- Kapanış GUARD 1b helper kopyası değil, daha DAR yüklemdir (ikinci çağrı `rescueStuckRoll`).

## Açık sorular

- GUARD 1b / `rescueStuckRoll` helper'sız dar yüklemi (`dispatch:{cancelledAt:null}`) tek kaynağa çekilmeli mi?
- Fason istasyonu iki alandan tanınıyor (`Station.type=EXTERNAL` ↔ `Station.kind=SUBCONTRACTOR`), bağlayan CHECK yok.
- Kısmi kabulde barkod son teslimatta ölür; uyarı "sonunda" mı demeli?
- "Fason firma seçicisi LOAD-BEARING (yoksa Fasona gönder sessiz no-op)" kuralının sahibi küme belirsiz.

## Doğrulama turu ekleri (eski CLAUDE.md ↔ yeni yapı karşılaştırması, 2026-09-05)

- **[ÇEKİRDEK]** Fason sevk kalemi POLİMORFİK (`kind` ROLL | WARP_BEAM | YARN; XOR CHECK `subcontractor_dispatch_items_kind_ref_ck`); levent kalemi makbuza girmez, OUTSTANDING dışı; defteri `WarpBeamEvent` (SHIP_OUT · SHIP_OUT_CANCEL · RETURNED_IN · RETURNED_IN_CANCEL, `dispatchItemId`).
- **[ÇEKİRDEK]** Levent LIFO: dönmüş kalemin sevki iptal edilmez, yeniden sevkli leventin dönüşü storno edilmez; dönüş ≤ giden; detay DTO'da levent OPT-IN (`?includeBeams=1`); `kind≠ROLL` yazma devere kapısında (403 `MODULE_DISABLED`, ikinci hat `applyWarpBeamEventTx`).
- **[ÇEKİRDEK]** Sevk/makbuz BAŞLIĞI ya iş emri adımına (`workOrderId`+`stepId`[+`batchId`]) ya dokuma işine (`weavingOrderId`) bağlı, tam biri (`subcontractor_dispatches_header_ck` · `subcontractor_receipts_header_ck`).
- **[ÇEKİRDEK]** İş emri yolunun HER yükleyicisi `assertWorkOrderBound`/`workOrderBoundOnly` (`helpers/dispatch-header.helper.ts`) ile daraltır, dokuma belgesine 409 `DISPATCH_NOT_WORK_ORDER_BOUND`; `!` yok.
- **[ÇEKİRDEK]** Dokuma fason belgelerini yalnız `subcontractor-weaving.service.ts` yazar; makbuz kalemsiz, top `createInitialEntry(forcedEntrySource: WEAVING, parentReceiptId)` ile partisiz doğar; makbuz iptali yalnız doğan topların hepsi CANCELLED ise.
- **[ÇEKİRDEK]** Dokuma işinde `SUBCONTRACTED ∧ açık` claim tx'in ilk ifadesi; `PLANNED→IN_PROGRESS` tek yazar `markWeavingOrderInProgressTx`; top↔dokuma bağı tek okuyucu `weavingOrderOfRoll`, `Roll.weavingOrderId` KOLONU AÇILMAZ.
- **[ÇEKİRDEK]** Panel (G2p) yalnız Dokuma İşleri detayının "Fason" bölümü (`WeavingOrders/fason/`, yeni izin yok); fason LİSTE sayfaları dokuma belgesini çizmez (`workOrderBoundOnly`).
- **[ÇEKİRDEK]** Tablet (G2t) yalnız kabul + levent dönüşü: `FasonDokuma` (`mobile:fason-kabul`, `dokumaEnabled`, oturumsuz); `GET /tablet-context` opt-in allowlist (cari/depo/fiyat inmez, kapalı modülde 403); `failed[]` satırları FORMDA KALIR; sevk açma/iptal tablette YOK.
- **[ÇEKİRDEK]** İplik kalemi (`kind=YARN`, `yarnItemId`+`warehouseId`+`lotId?`) defteri iplik defteri: `SUBCONTRACT_OUT`/`_CANCEL`/`SUBCONTRACT_RETURN`/`_CANCEL` karşı olay çiftleri, `YarnMovement.dispatchItemId` (CHECK iki yönlü), kalem başına TEK çıkış (partial unique).
- **[ÇEKİRDEK]** İplik dönüşü kısmi olabilir, sebep ZORUNLU (`ReasonPresetKind.YARN_SUBCONTRACT_RETURN`: KALAN_IPLIK · KALITE · IPTAL); depo/lot varsayılan çıkışınki; dönmüş kalemli sevk iptal edilmez, storno grup net'iyle (aynı depo/lot/sebep).
- **[ÇEKİRDEK]** Tek yazar `applyYarnMovementTx`; modül ve eksi bakiye kapısı (`SUBCONTRACT_OUT` + `_RETURN_CANCEL` GATED) aksiyon anında; `yarnLines` gövde kapısı 403; ROLL/WARP_BEAM yolları ipliğe dokunmaz; dönüş/storno/bakiye uçları `requireIplikEnabled`.
- **[ÇEKİRDEK]** YARN'da `dispatchedQty` KG (`unit:"KG"`); `totalQty` = Σ(ROLL+WARP_BEAM) metre (`kind<>'YARN'`), `yarnTotalKg` ayrı; iplik `items`e girmez, `yarnItems` ayrı alan.
- **[ÇEKİRDEK]** Fasondaki iplik SANAL DEPO DEĞİL: bakiye kalem × lot TÜRETİLİR (`yarnAtSubcontractor`, `GET /api/subcontractor/:id/yarn-balance`).
- **[ÇEKİRDEK]** Fasona sardırılan (`originKind=SUBCONTRACT`) leventin `WOUND` olayı iplik kalemine opsiyonel bağlanır (`WarpBeamEvent.dispatchItemId`, CHECK `warp_beam_events_fason_item_ck`; kalem YARN · aynı fasoncu · çözgü ipliği; IN_HOUSE/PURCHASED 400).
- **[ÇEKİRDEK]** Bakiye `sarilanKg`yi ayrı düşer (`theoreticalKg`, `sarilanKaynak` THEORETICAL/WEIGHED/KARMA; storno sarım sayılmaz; `remainingKg` = çıkış − dönüş − sarılan), DTO `sarilan[]`.
- **[ÇEKİRDEK]** Fasoncudaki iplik/levent mülkiyeti `ownerCustomerId` (`sevkiyat.md` EMANET); fason dokuma makbuzunda doğan top sevkteki leventlerden sahibi kalıtır.
- **[ÇEKİRDEK]** Panel iplik satırı yalnız dokuma işi "Fason" bölümünde (`FasonYarnLines`, `FasonYarnRows`, `FasonYarnStrip`, `FasonYarnReturnDialog` önizlemeli); iş emri `dispatch/bulk` iplik/levent almaz; özet `yarnItems` + `totals.yarn` ayrı; kapalı iplikte alan gövdeye girmez.
- **[ÇEKİRDEK]** Mobil `dispatchWithoutColor` HER fason adımı için AÇIKÇA gider (true da false da).
- **[ÇEKİRDEK]** Çok partili seçimde `multiBatchStrategy` (`/dispatch`, `/dispatch/bulk`) yoksa 409 `MULTI_BATCH`; `SEPARATE` parti başına TEK tx'te (eski önce, serbestler ayrı, hep ya hiç; levent/iplik 400); `MERGE` en eskide; varsayılan AYRI istemcide (`MultiBatchSheet` · `MultiBatchDialog`).
- **[ÇEKİRDEK]** Kabulde doğan toplar kabul edilen sevkin partisini alır: `batchId` açık sevklerden biri olmalı (yoksa 400 `RECEIPT_BATCH_NOT_OPEN`), yoksa en eski açık sevk (`dispatchedAt`, eşitlikte id).
- **[ÇEKİRDEK]** Fasonun TİCARİ kimliği bağlı karttır: alış siparişi, mal kabul, hazır levent fason bacağı `resolvePartyToCardTx` ile karta (`supplierId` = kart); fason İŞİNİN tarafı (`SUBCONTRACT` levent, sevk/kabul) profil kalır.
- **[ÇEKİRDEK]** Kısmi sevk çocuğu `ownerCustomerId` kalıtır; makbuzdan doğan top kaynakların TEK sahibini alır (`resolveOwnerFromReceiptTx`, KATI, karışım 409 `OWNER_MISMATCH`); eski doğumlar `scripts/fix_emanet_owner_backfill.ts`, sevkli top varsayılan yazılmaz.
- **[ÇEKİRDEK]** Dış işin faturalanan metresi DOĞAN topun kabul metresi (RECEIVED, bağ doğan topta); kendisi dönen topta RECEIVED = adımın açık `receivedQty` toplamı + (NULL kalem varsa) mevcut metre BİR kez, aynı çözücüden.
- **[ÇEKİRDEK]** Sarım (`resolveOwnerFromLotsTx`) ve fason dokuma (`resolveOwnerFromBeamsTx`) kalıtımında sahipli + sahipsiz karışım SAHİBİ kalıtır (iki müşteri 409); fason makbuzundan doğan top KATI — karışım 409 `OWNER_MISMATCH`, emanet kapalıyken kalıntı sahipli kaynak dahil.
- **[ÇEKİRDEK]** Sahipli doğumun deposunu YALNIZ `resolveBirthWarehouseIdTx`ten al (açık seçim > `emanet.defaultWarehouseId` [emanet açıkken] > varsayılan); kullanılamayan emanet deposunda 400 `EMANET_DEFAULT_WAREHOUSE_UNUSABLE`, varsayılana düşme; tek yazar `PUT /api/feature-flags/emanet-default-warehouse`. · bekçi: `test_emanet_depo` <sub>(arşiv:2026-11-08 F1b)</sub>
- **[ÇEKİRDEK]** Emanet ekstresini (`GET /api/consigned-work/:customerId/statement`) YALNIZ defterlerden as-of türet (stok defteri sınır olayları + sapma + DSK · iplik lotu · levent; durum tablosu yalnız bugünü kapsayan dönemin mutabakat uyarısında); her fiziksel olay TAM BİR satırdır (metraj farkının tek kaynağı sapma defteri — sapmaya bağlı ve sayım stok satırı okunmaz), storno kendi anında AYRI satırdır, sevk BRÜT; açılışı DB'de topla, satırları dönemle sınırla; dönem fabrika günüdür, tanınmayan parametre 400. · bekçi: `test_emanet_ekstre` <sub>(arşiv:2026-11-08 F2)</sub>
- **[PROFİL]** İşlem bayrağı (BRODE) uygulayan fason adımını `appliesProperty` kategorisiyle kur (`requiredCategoryId` / `defaultCategoryId`); kategorisizde iş faturasız kalır.
- **[PROFİL]** `fason.receiptApplyTargetVariant` AÇIKKEN bayrağın çeşidine ait `WorkOrderTargetValue`yu doğan topa `RollProperty.valueId` olarak kabul tx'inde yaz (`readReceiptTargetVariantsTx`); kapalıyken bayt-aynı; ters yol `revokeRollProperties`.
- **[PROFİL]** Hedef TEK desen değeriyse orijinal topun `SUBCONTRACTOR_RETURNED` işlemine `propertyValueId` yaz (`receiptOperationValueId`; CHECK `KURSUN_APPLIED` + `SUBCONTRACTOR_RETURNED`); ters yol `revokeRollOperations`; geçmiş satır güncellenmez.
- **[ÇEKİRDEK]** Boyahane faturasını SEVK TARİHİNDEKİ tarifeyle, KDV HARİÇ net karşılaştır; farklı dövizde kur çevirme/fark hesaplama, "farklı döviz" uyar; tarih yalnız `pickFinishingRateAtDispatch` (fabrika günü, `constants/time.ts`).

## Bekçiler — bu alana dokununca koş

Koşum ve ayrıntı: `Teks-Erp/docs/BEKCI-HARITASI.md`.

Backend: `test_fason_kg_kontrol`, `test_seyitoglu_rota_gecis`, `test_seyitoglu_son_kontrol`, `test_fason_adim_hedef_notu`, `test_hizmet_brode_tambur`, `test_emanet_depo`, `test_emanet_ekstre`, `test_desen_fatura_kalemi`, `test_brode_senaryo`, `test_partner_roles`, `test_subcontractor_customer_profile`, `test_supplier_party_tek_adres`, `test_accounting_direct_ship`, `test_batch_k15_merge`, `test_batch_k16_split_move`, `test_batch_k8_tools`, `test_batch_multibatch_dispatch`, `test_batch_partial_dispatch_autosplit`, `test_branch_code_docs`, `test_branch_no_empty`, `test_bulk_dispatch_rollids`, `test_client_token_idempotency`, `test_consecutive_fason`, `test_consistency`, `test_consistency_derived`, `test_data_integrity_gaps`, `test_direct_ship_api`, `test_direct_ship_fason`, `test_direct_ship_scenarios`, `test_dispatch_claim_step_match`, `test_dispatch_cross_wo_batch_guard`, `test_dispatch_without_color`, `test_doc_pagesize_override`, `test_doc_render_html`, `test_doc_sample_html`, `test_fason_ceki_draft`, `test_fason_ceki_html`, `test_fason_desk_dispatch`, `test_fason_direct_ship_dispatch_lock`, `test_fason_dispatch_picker`, `test_fason_kabul_partial_overlap`, `test_fason_open_dispatch_semantics`, `test_fason_open_dispatch_single_source`, `test_fason_parti_grouping`, `test_fason_partial_receive`, `test_fason_partial_receive_overcount`, `test_fason_receipt_batch`, `test_fason_receipt_color_width`, `test_fason_receive_cancel_rereceive`, `test_fason_receive_crossstep_firm`, `test_fason_receive_idempotency_concurrency`, `test_fason_reopen_remainder_guard`, `test_fason_step_note_flow`, `test_fason_transfer_rollids`, `test_fason_undo_transfer`, `test_fason_visibility`, `test_fason_wrong_station_guidance`, `test_filter_multi_select`, `test_input_rolls_directship`, `test_k14_lock_edges`, `test_kartela_stock_and_ship`, `test_label_dirty_sources`, `test_manual_move`, `test_manual_move_fason_receive`, `test_manual_move_field_continuity`, `test_new_documents`, `test_order_shipments`, `test_printed_documents`, `test_quality_scorecard`, `test_quickstart_dispatch`, `test_quickstart_dispatch_api`, `test_race_conditions`, `test_roll_movement_revoke`, `test_roll_operation_revoke`, `test_roll_variance`, `test_route_firm_roundtrip`, `test_route_skip_warning`, `test_route_template_fason`, `test_sack_content_dump`, `test_sack_status_invariant`, `test_scan_code_case`, `test_shipment_doc_batch_column`, `test_shipment_event_ledger`, `test_shipment_order_ledger`, `test_shipping_flags`, `test_split_card_lineage`, `test_split_per_roll`, `test_subcontract_scorecard`, `test_subcontractor_management`, `test_swatch_stock_reduction_reversal`, `test_tambur_branch_info`, `test_tambur_send_to_dye`, `test_wo_branch_redye`, `test_wo_branch_split`, `test_wo_cancel_fason`, `test_wo_color_change_lock`, `test_wo_fason_quick_receive`, `test_wo_input_attach_window`, `test_wo_manual_complete`, `test_wo_target_color_guard`, `test_workorder_documents`, `test_stock_ledger_fason`, `test_subcontractor_dispatch_beam`, `test_subcontractor_dispatch_yarn`, `test_subcontractor_weaving`, `test_iplik_regime_gate`, `test_swatch_event_ledger`, `test_swatch_event_yazar`, `test_swatch_event_paths`, `test_kartela_durum_anomali`, `test_swatch_event_timeline`, `test_kartela_arsiv_kapisi`, `test_hizmet_adim_isi`, `test_hizmet_yeniden_islem`

Madde içi: `test_rol_modeli_kalinti`, `test_migrate_partner_roles`, `test_seyitoglu_ayar_paketi`, `test_station_capability`, `test_helpers`, `test_wo_route_coverage_goods`, `test_emanet`, `test_emanet_sahiplik_geri_doldur`, `test_reason_preset_kind_parity`, `test_defter_ters_yol`, `test_db_invariants`, `run-all-tests.ts typecheckGate`

İstemci: `shipmentDetailError.test.tsx`, `DirectShipModal.test.tsx`, `batch-merge-confirm.test.ts`, `fasonReceive.helper.test.ts`, `subcontractorDefault.test.ts`, `useTebdilWizard.test.tsx`, `workOrderPrefill.test.ts`, `fason-receive-attempt.test.ts`, `ScannerRollStrip.test.tsx`, `newRolls.helper.test.ts`, `receiveAttempt.test.ts`, `receivePayload.helper.test.ts`, `segmented-buttons-row.guard.test.ts`, `fason-summary.test.ts`, `receiptPayload.test.ts`, `reworkPayload.test.ts`, `MultiBatchSheet.test`, `FasonStepActions.multibatch.test`, `Rolls/service.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-08-04 — topun kalıcı alanları; GİRİŞ NOKTASI — `arsiv/2026-09.md`
