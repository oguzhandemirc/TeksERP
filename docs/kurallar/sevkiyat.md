# Sevkiyat · Çuval · Brüt · Storno/İade
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/sevkiyat.md`.

Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

## Ortak (backend + panel + tablet)

### Değişmezler

- **[PROFİL]** Sevkin bir kısmının sipariş defterine yazılmaması bilinçli tercihtir: onarım modülünü KOŞMA; `test_consistency` §1c/§1d kırmızısı beklenir; `scripts/tahsis_teshis.ts` yalnız ölçer.
- **[ÇEKİRDEK]** Sevk geri alınırken `dispatchedAt`/`dispatchedById` NULL'LANMAZ; güncel gerçek `status`, geçmiş `ShipmentEvent` defteri; iptal künyesi yalnız `cancelPlannedShipmentTx`te.
- **[ÇEKİRDEK]** Çuval tartısı `SackWeighing` defterine (WEIGHED · REWEIGHED · CLEARED); içerik değişiminin kg sıfırlaması `CLEARED` olayıdır; `Sack.weightKg` denormalize.
- **[ÇEKİRDEK]** Çuval DEPO nesnesi: `Sack.customerId` opsiyonel, `shipmentId` NULL = havuz; sevkiyat çuval seçerek kurulur (`createShipment({sackIds, customerId, orderIds?})`); top↔sipariş bağı YOK.
- **[ÇEKİRDEK]** `PackingGroup` yaftadır, rezervasyon değil (stok/kilit/defter yok); üyelik `Sack.packingGroupId`, ayrı pivot YAZMA; grup silinmez görünmez olur (`LIVE_GROUP_WHERE`); sevkte `packingGroupId` TEMİZLENMEZ.
- **[ÇEKİRDEK]** Grup numarası park yeridir: belgeye/etikete BASILMAZ, yeniden kullanılır (kimlik `PackingGroup.id`).
- **[ÇEKİRDEK]** `packing.groupMode = sevk-partisi`: durum sevkten türer, elle kapatma YOK (OPEN doğar, `liveGroupWhere("sevk-partisi")`; son çuvalın sevkinde CLOSED, storno OPEN); ad tekilliği yalnız açık partilerde; `Sack.packageNo` unique `[packingGroupId, packageNo]`, kilit 8033.
- **[ÇEKİRDEK]** Sevk edilmiş çuval partide kalır, numarası donar; transfer yeni numara verir; `lotPartialDispatch=false` tamamını ister.
- **[ÇEKİRDEK]** Çuvalsız parti silinir. Ayarlar (`packing.groupMode` · `packageNoStartsAtZero` · `packageNoMode` · `packageNumbering` · `lotRequired` · `lotPartialDispatch` · `shipping.docPackingLot`) varsayılanı bugün.
- **[ÇEKİRDEK]** İade tek pencere, dört kapsam (top · çuval · sevkiyat · parti; `classifyBarcode`); iade daima TOP satırıyla, sevkiyat başına bir belge.
- **[ÇEKİRDEK]** Çok sevkiyat `POST /api/returns/batch` (grup başına tx; ilk grup düşerse yazma yok, sonra düşerse `failed`/`skipped` açık döner); partinin sevk edilmemiş çuvalları listelenmez.
- **[ÇEKİRDEK]** Parti ⋮ eylemleri partinin TAMAMINI kapsar (`fetchLotWarehouseSacks`; `POST /packing-groups/:id/release` çuval başına claim, planlıdaki atlanır+sayılır).
- **[ÇEKİRDEK]** Havuza çıkarma partiyi SİLMEZ; havuz hedefi cari ya da genel (cari+şube düşer); "Topları depoya çek" `BulkDistributeSacksDialog mod="sil"`, önizleme zorunlu.
- **[ÇEKİRDEK]** `GET /sack-search/customers` TEK toplulaştırma sorgusu, sıralama SUNUCUDA (`sortBy`, tanınmayan 400), keyset `(kolon, ad, id)`; istemci sıralamaz/bellekte toplamaz; `scopeWhere` ↔ `scopeSql` birlikte değişir.
- **[ÇEKİRDEK]** Parti kimliği `PackingGroup.code` (`PRT-YYMM-NNNN`, `@unique`; 8034 tx'in İLK ifadesi, sonra 8031), değişmez; toplamlar DB'de (`loadPackingGroupDtos`, `liveGroupSql` ↔ `liveGroupWhere`).
- **[ÇEKİRDEK]** `SVK`/`CV`/`PRT` biçimi `number_series`ten; ön eki literal YAZMA; tanıma `matchesSeries(resolveSeriesFormat("sack"), kod)`, `isDailyCode` DEĞİL (`numaralandirma.md`).
- **[ÇEKİRDEK]** `Sack.seq` sevkte doğar (`shipping.sackSeqStart`); `shipping.sackSeqPrefix` (≤8, `sanitizeSackSeqPrefix`) `Shipment.sackSeqPrefix`e DONAR, `shipping.sackSeqPrefixLive` açıkken canlı; tek biçimleyici `formatSackSeqLabel`; `sackSeqOnDoc`/`sackSeqShowTotal` bayrakları.
- **[ÇEKİRDEK]** Partisiz çuval ambalaj no'su `packing.poolPackageNo`: `sevkte` (varsayılan) · `acilista` (advisory 8035 `hashtext(customerId)`, geri verilmez, müşterisiz numarasız).
- **[ÇEKİRDEK]** Çuval listesi yalnız `Sack` skaler kolonlarında sıralanır (`createdAt|sackNo|notes|weightKg`); grubun tamamına işlem yapan uç id'leri SUNUCUDA çözer (`packingGroupId`).
- **[ÇEKİRDEK]** `shipping.sackDumpNameMode` (`ikisi` | `bizdeki` | `musterideki`) varsayılandır, pencere ayarı değiştirmez; `musterideki` FAIL-OPEN DEĞİL (hücre boş).
- **[ÇEKİRDEK]** `nextPackingGroupSeqTx` İLK ifade `pg_advisory_xact_lock(8031, hashtext(customerId))`; çuval bağlama atomik claim (`updateMany WHERE {shipmentId: null, customerId}`).
- **[ÇEKİRDEK]** Tablet grubu SEÇER, kurmaz; liste, okutma hedefi ve "Hemen Sevk Et" TEK yüklem `sacksInSelection`; `packingGroupsEnabled` kapalıyken davranış aynen; ölü grupta seçim "Tümü".
- **[ÇEKİRDEK]** `SackAllocation` sevk ANINDA yazılır (`distributeSacksToLines`); stok yalnız DISPATCH'te `SHIPPED`; PLANNED tahsis sayılmaz; `shippedQty` defterden türer, elle yazılmaz.
- **[ÇEKİRDEK]** `WorkOrder` yalnız üretimi yönetir; tartı/paket/sevk ayrı domain (`shipping.service.ts`), yük birimine bağlanır.
- **[ÇEKİRDEK]** Yük birimi `Sack.unitKind` (SACK · CART · BULK); dökme/araba yalnız sevkiyat içinde doğar (`openLoadUnitTx`), havuza DÖNMEZ — iptal ve storno kapanışı `dissolveLoadUnitsTx` ile çözer (toplar rafa, birim `dissolvedAt` damgalı kalır); birimi bütün çıkarma 409 `LOAD_UNIT_NOT_REMOVABLE`, PLANLI'da tek top çıkarma `removeRollFromLoadUnit` (son top birimi çözer); her sevkiyat okuyucusu `LIVE_LOAD_UNIT_WHERE` süzer.
- **[ÇEKİRDEK]** Sevkiyatta TEK yük türü (`assertLoadKindCompatible` → 409 `LOAD_UNIT_KIND_MIXED`); "sevke hazır" sayımı yük birimine/sevkiyata bağlı topu hazır SAYMAZ (`loadedRollSql` ↔ `isRollLoaded`).
- **[ÇEKİRDEK]** Dökme sevkiyat başına TEK canlı birim; araba no etikettir, kimlik değil (sevkiyat içinde tekil, elle girilir); dökme/araba tartı/parti/ambalaj no TAŞIMAZ (DB CHECK + trigger).
- **[ÇEKİRDEK]** İrsaliyede dökme "Dökme – N top", araba "Araba <no> – N top"; snapshot'a `unitKind/unitLabel` yalnız dökme/arabada girer (çuvallı belge bayt-eşit); e-İrsaliye kap adedi DEĞİŞMEZ (muhasebeci teyidi bekleniyor).
- **[ÇEKİRDEK]** SACK etiketi barkodu `Sack.sackNo` (ayrı kolon EKLEME); şablon çözülemez/uymazsa Türkçe 400, başka etikete sapmaz.
- **[ÇEKİRDEK]** Sevk rakamı BRÜT: canlı çuval sorgusundan üretilmez; iade ayrı belgeyle (`RETURN_DISPATCH` donar, iptalde VOIDED); `returns {count, meters}` dipnottur.
- **[ÇEKİRDEK]** Sipariş sevk durumunu kullanıcıya günlük dille göster (Henüz onaylanmadı · Henüz gönderilmedi · Bir kısmı gönderildi (x / y m) · Hepsi gönderildi · Sipariş elle kapatıldı (x / y m gönderildi) · Sipariş iptal edildi); `OrderStatus` etiketi ham ya da "Onaylandı"/"Kısmi Sevk" jargonuyla gösterilmez — panel metni tek kaynaktan (`order-where-text.ts` `orderShipView`), tablet/patron etiketleri aynı sözcüklerle.
- **[ÇEKİRDEK]** Fatura taslağı BRÜT: `collectShipmentInvoiceDraftLines` iptalsiz `RollReturn` (`fromShipmentId`) toplarını sevk anı `qty`/`width` ile geri ekler.
- **[ÇEKİRDEK]** Brütün TEK KAYNAĞI iptalsiz `RollReturn` (`prevSackId`): `attachTotals` · `accounting-export` · `getShipmentById` · `collectShipmentDocContent` · `_shipped.ts`; donmuş snapshot yalnız `resolveShipmentDispatchContent`, yeni yüzey içeriği oradan alır.
- **[ÇEKİRDEK]** Donmuş sevk belgesinde yalnız ACTIVE nihai; VOIDED İPTAL işaretiyle basılır (`doc.status`).
- **[ÇEKİRDEK]** Fatura izi (`invoiceNo`+`invoicedAt`+`invoicedById`) yalnız DISPATCHED'e claim ile, `shipping:invoice`; finance.enabled açıkken taslak fatura, çakışma `shipping.invoiceMode`.
- **[ÇEKİRDEK]** Dönem sevk metrajı TEK tanım `reports/_shipped.ts`; `finalizedAt` trigger kaynağında SHIPPED/CANCELLED bilerek YOK.
- **[ÇEKİRDEK]** Storno ≠ iade: iade = mal ulaştı (iade irsaliyesi + `RollReturn`, sebep zorunlu); storno = çıkmadı (belge VOIDED, stok rafa, iade defterine GİRMEZ).
- **[PROFİL]** `shipping.returnFootnote` (≤300) ilk basımda `doc.footnote`a donar (`belge.iade_dipnotu`).
- **[ÇEKİRDEK]** Düz storno tahsisi SİLMEZ (`ShipmentOrder.isActive=true` + recompute); `releaseSacks` → `cancelPlannedShipmentTx` CANCELLED: tahsis silinir, çuval havuza, toplar çuvalda, irsaliye VOIDED.
- **[ÇEKİRDEK]** SoD: `shipping:undo-dispatch` ve `shipping:invoice`ı `shipping:write` KAPSAMAZ; yalnız Muhasebe/Süpervizör şablonlarında, atama ELLE.
- **[ÇEKİRDEK]** `source:'SIMULATED'` kg `shipping.simulatedWeightEnabled` kapalıyken 400; SCALE simüle doğmaz; `MANUAL` bu kapıdan muaf.
- **[ÇEKİRDEK]** `shipping.orderRequirement` (niyet; off|warn|block, `warn`; `block` bugün AÇILAMAZ, `orderless` dahil) ile `shipping.orderCoverage` (sonuç; `off`, yalnız kurulumda, `dispatchShipment`te DEĞİL) ayrı bayraktır.
- **[ÇEKİRDEK]** Müşterideki ad: ekran = belge yüklemi `override > CustomerItemAlias/CustomerColorAlias > yok` (yoksa `null`); belgede ad DONAR, `shipping.docItemNameMode` canlı; `(itemId,colorId)` deterministik; gruplama BİZİM ad.
- **[ÇEKİRDEK]** `shipping.docCekiNameMode` (`devral` | `bizdeki` | `musterideki` | `ikisi`) yalnız çeki bölümünü çevirir; `shipping.docProductColorSplit` ayrık kipte renk sütunu fallback'siz.
- **[ÇEKİRDEK]** Toplu dağıtma: önce `POST /sacks/distribute/preview`, `/bulk` atanmış çuvalı sebebiyle ATLAR; çuval silinmez.
- **[ÇEKİRDEK]** Tahsiste kumaş+renk KESİN; yalnız EN gevşer (`shipping.allocWidthToleranceEnabled`); aşım `shipping.allowOverAllocation` kapalı.
- **[ÇEKİRDEK]** Tahsis onarımı `/api/shipping/repair/allocations` (`setShipmentOrders`, irsaliye v+1), izin `shipping:repair-allocation`; detay `defterBoslugu` rozetle gösterilir.
- **[ÇEKİRDEK]** Bitmiş top yeniden üretime alınır (`attachRolls`/`quickStart`, `ReworkRollsDialog`, `scanClassify`); statü kontrolü çuvaldan ÖNCE.
- **[ÇEKİRDEK]** Sevk defteri METRE; türeyen miktar "m" basılır, sipariş birimi YAZILMAZ; MT dışı tahsis `warnings`; irsaliyeye iç uyarı GÖMME.
- **[ÇEKİRDEK]** Sevk yönü SEÇİLMEZ: şube→cari kilidi (`resolveShipmentDestination`, `destination-lock`); boş zincirde ilk açık seçim `claimFirstDestinationTx`; `setDestination` farklıysa 409; `Shipment.destination` donar.
- **[ÇEKİRDEK]** İhracat kodu (`pickExportCode`) ve `Shipment.procedureCode` yalnız YURTDIŞI; `header.exportCode` doğuşta donar; `procedureCode` yedeksiz; ihracat kilitli caride `QUICK_SHIP_EXPORT_UNSUPPORTED`.
- **[ÇEKİRDEK]** Teslim yeri sahipliği değiştirmez (`deliveryCustomerId` + `deliveryAddress` yalnız belge); `assertOwnerMatchesTx`e sokma; doğrulama `resolveDeliveryToTx` (400 `DELIVERY_*`); yazım yalnız PLANNED (409 `SHIPMENT_NOT_PLANNED`); `header.deliveryTo` donar; `deliveryToWarnings`.
- **[ÇEKİRDEK]** "Sevke hazır"ı SAKLAMA, türet: yalnız `ship-readiness.helper` (`classifyShipReadiness`, `readinessClassOf` ↔ `readinessClassSql`), ayar `effectiveShipReadyPolicy`.
- **[ÇEKİRDEK]** Panel yeni yaratıcı yazmaz (`QuickShipDialog` → `from-rolls`), süzgeç sunucuda (`state`); gelen belge modülü kapalıyken `deliveryNote`/`customerBatch` sekmesi yok.

### Yasaklar

- **[ÇEKİRDEK]** Rezervasyon (`shipping.reservationEnabled`) kendi append-only defteriyle; `SackAllocation`a DOKUNMA.
- **[ÇEKİRDEK]** Brüt/donmuş-belge kuralı refakat kartına UZANMAZ (`resolveLiveBatches`, iptalsiz sevk + `(+N)`).
- **[ÇEKİRDEK]** İade belge no `IADE-GGAAYY-<id6>`, GGAAYY FABRİKA gününden (`factoryYmd`).
- **[ÇEKİRDEK]** İade belgesi üye id'siyle ÇÖZÜLMEZ → `documentSourceId` (`returnGroupId ?? id`); grup iptali `reissueForSourceTx` v+1, son kalem VOIDED.

### Reçeteler

- **[ÇEKİRDEK]** Yeni sevk-içeriği yüzeyinde "sevkten SONRA da koşar mı?" sor (`reissue`, lazy-init); freeze tek koruma değil.

### Kararlar

- **[PROFİL]** `packing.groupsEnabled` KAPALI; `packing.groupNumbering` `artan`; ad `"P1"` yalnız ekranda; çuval TEK grupta; grup zorunlu değil; grup notu sevkte sorulur.
- **[PROFİL]** Mühür ve rezerv YOK; `shipping.confirmationEnabled` KAPALI → doğrudan DISPATCHED, AÇIK → PLANNED + `dispatchShipment`.
- **[ÇEKİRDEK]** Toplu iade: defter SATIR (N `RollReturn`), belge GRUP (`returnGroupId`); `POST /api/returns` `rollIds[]`, `GET /api/returns/lookup-sack`.
- **[PROFİL]** `docItemNameMode` `bizdeki` | `musterideki` (FAIL-OPEN) | `ikisi`; etiketler `applyColumnCfg`te kaçırılır.
- **[ÇEKİRDEK]** EMANET: `ownerCustomerId` DOĞUM niteliği (KK1 `initialEntry`, levent, lot, kalıtım `resolveOwnerFrom*Tx`); jenerik PATCH'ten yazılamaz; değişim = yeni doğum; karışık sahip 409 `OWNER_MISMATCH`.
- **[ÇEKİRDEK]** Her çıkış `assertOwnerMatchesTx`ten (`performDispatchTx`, `executeDirectShip`), bayraktan bağımsız; önizleme aynı `findOwnerMismatches` ile uyarır (dispatch 409 aynen, fatura taslağı `warnings`).
- **[ÇEKİRDEK]** `emanet.enabled` kapalıyken `assertEmanetWritableTx` 403 `MODULE_DISABLED`; tablet `mobile:kk1`, `customer:read` DAĞITMA.
- **[ÇEKİRDEK]** e-İrsaliye XML'i ACTIVE irsaliye snapshot'ından; fatura kesme, modül anahtarı açma; yapılandırma eksikse XML üretme.

## Backend

### Değişmezler

- **[ÇEKİRDEK]** Depo çuvalına dokunan yol: `touchWarehouseSackTx` (atanmış 409) → `touchShipmentPlannedTx` → `markSackContentChangedTx` (`labelDirty` ayrı).
- **[ÇEKİRDEK]** Muhasebe export'u sevk BRÜT + ayrı "İade" sayfası.
- **[ÇEKİRDEK]** İptal gövdesi TEK KAYNAK `cancelPlannedShipmentTx` (`cancelShipment`, `undoDispatch({releaseSacks})`); DISPATCHED iptal edilmez, storno gerekir.
- **[ÇEKİRDEK]** `weighRequiredEnabled`/`manualWeightRestrictedEnabled` AÇILMADI; açılınca MANUAL yalnız `shipping:write` (`assertManualWeightAllowed`).
- **[ÇEKİRDEK]** e-İrsaliye XML'i YALNIZ `despatch-advice.builder`; `validateDespatchInput` → `validateDespatchXml`; canlı öncesi GİB doğrulaması.
- **[ÇEKİRDEK]** `e_irsaliyeler` XML/olay değişmez (`e_irsaliye_xml_degismez` · `defter_block_tamper`), kaynak başına tek canlı kayıt; gönderilmişe yeni XML YAZMA.
- **[ÇEKİRDEK]** Hazırlık YALNIZ `resolveEIrsaliyeReadiness`; eksikse 409 `EIRSALIYE_NOT_CONFIGURED`; geçiş YALNIZ `transitionEIrsaliyeTx` (409 `EIRSALIYE_STATE_CONFLICT`, `writeEIrsaliyeEventTx`).
- **[ÇEKİRDEK]** Numara `nextSeriesNo`, kilit 8023 → 8041 (`E_IRSALIYE_SERIES_LOCK_NS`); HATA'dan yeniden üretim aynı no + yeni ETTN; XML yalnız `POST /api/e-irsaliye/:id/download`; simülasyon `simulasyon:true`.
- **[ÇEKİRDEK]** GİB'e gidenin stornosu/kâğıt revizyonu YASAK (`eIrsaliyeUndoBlock`, 409 `EIRSALIYE_PAPER_LOCKED`); liste where `buildEIrsaliyeListWhere`/`eIrsaliyeListWhere`.
- **[ÇEKİRDEK]** `cancelPlannedShipmentTx` yerel kaydı aynı tx'te IPTAL eder; YAPILANDIRILMAMIS'ta liste 400, panel kartı eksik listesi gösterir, readiness 404/403'te çizilmez; eski istemciye yalnız opsiyonel alan.
- **[ÇEKİRDEK]** Cari kilidi `assertShipmentNotHeldTx` (kurulum başı + claim öncesi); emanet istisnası `emanetShipmentReleaseTx` (`finance.cariHold.emanetShipment`), önizleme `warnings[]` + `cariHold{}`; listede `activeHoldFlagsLateralSql` + `listHoldView`.

### Yasaklar

- **[ÇEKİRDEK]** `Sack.notes` annotation: `setSackNotes` `touchWarehouseSackTx` KULLANMAZ, `markSackContentChangedTx` nota dokunmaz; guard EKLEME; `labelDirty` yalnız `sackNoteAppearsOnLabel`.

### Reçeteler

- **[ÇEKİRDEK]** Storno engeli TEK `resolveUndoBlockReason` (faturalı · iadeli · `shipping.undoDispatchSameDayOnly`, `factoryDayStart()`); önizleme = mutasyon yüklemi; önizleme her topu listeler (`sacks[].rolls[]`, `looseRolls[]`, `UndoAffectedList`).

## Panel (Electron)

### Değişmezler

- **[ÇEKİRDEK]** Sevk Kapısı karosu `visibleWhen` SAF bayrak (`ctx.shipmentConfirmationEnabled`), PLANNED sayacı EKLENMEZ; route `/operations/sack-store` bayrağa bakmaz.
- **[ÇEKİRDEK]** Çuval içi üç ad (bizdeki · müşterideki · `lastLabelSnapshot`, canlıdan türetilmez); karşılıksız boş; ekran ve PDF/Excel uçları birlikte değişir.
- **[ÇEKİRDEK]** "Siparişe yazılamayanlar" `orders: [{id, orderNumber}]` taşır, numaradan id ARAMA; sipariş soldan, sevkiyat sağdan birlikte açılır (`hideOverlay`).

### Tuzaklar

- **[ÇEKİRDEK]** Fason firma `stepPlanning` overlay'iyle gider; yoksa "Fasona gönder" sessiz no-op; buton ve davranış `willDispatch`; ölü etiket uyarısı yalnız etiketli VE ilk adım fason.

### Reçeteler

- **[ÇEKİRDEK]** PLANNED sevkiyat detayda `DispatchConfirmDialog` ile sevk edilir (`shipping:write`); bayrak sonradan kapanmış PLANNED'lar da buradan çözülür.

### Kararlar

- **[PROFİL]** İade satırı çuvalda, amber "İade" rozeti, salt-okunur, metraj çizilmez; "Bu sevkiyattan iade edilenler" kartı kalır.
- **[PROFİL]** "Sevkiyatı da kapat" yalnız `confirmationEnabled` açıkken; kapalıda geri alma daima serbest bırakır; kapatılan sevkiyat aynı numarayla çıkmaz.
- **[PROFİL]** "Sevkiyatlar" ↔ "Sevk Edilenler" ayrı ekran, izinle ayrılmaz; muhasebe ekranı finance.enabled açıkken terfi eder.

## Tablet (mobil)

### Değişmezler

- **[ÇEKİRDEK]** Cihaz çözümü oturum-kapsamlı `useMachinePeripherals` → `GET /peripherals/for-session` (oturumsuz boş); tartı SCALE; `btPrinterStore` geri gelmez; 409 `WORK_SESSION_REQUIRED`.
- **[ÇEKİRDEK]** Tartı FAIL-CLOSED: cihaz yok / bond yok / okunamadı / ≤ 0 → Türkçe toast, mutasyon ÇAĞRILMAZ.
- **[ÇEKİRDEK]** BT tek soket: ikinci dokunuş `busyRef` ile yok sayılır, kuyruk yok; spinner `weighingSackId`; okuma tek dokunuş, diğerleri ⋮ `SackActionsSheet` (≥56dp), yıkıcıda onay.
- **[ÇEKİRDEK]** Okutma geri bildirimini ekran ekran KOPYALAMA; tek kaynak (`signalScan` · `useScanFeedback` · `ScannerRollStrip`).

### Yasaklar

- **[ÇEKİRDEK]** Mobil brütü elle KURMAZ (`rollCount + returnedCount` YASAK); `sack.returnedCount`, `summary.returnedCount/returnedMeters`.

### Kararlar

- **[PROFİL]** Tablete gelen ofis işleri yalnız sipariş seçerek sevk (önizlemeli) ve bekleyen sevkiyat iptali (önizlemeli); çuval adedi/teslim yeri panelde; storno ve fatura tablete GELMEZ (SoD).
- **[PROFİL]** `TartiPaket/` = "Sevkiyat", `Sevkiyat/` = "Sevk Çıkışı"; `mobile:tarti-paket` / `mobile:sevkiyat`; backend `/api/shipping`; "Sevk Çıkışı" `confirmationEnabled`a bakmaz.

## Geçersiz kılınan kurallar — bunlara UYMA

- `Customer.defaultDestination` varsayılan değil KİLİT; formdaki yön seçicisi kalktı.
- "Belge canlı okur, freeze korur" → belge üreticisi BRÜT (reissue + lazy-init dahil).
- "Sevk Kapısı karosu bayrak VEYA PLANNED" → SAF bayrak.
- `resetSackWeightsTx` → `markSackContentChangedTx`.
- "ERP fatura KESMEZ" yalnız finance.enabled kapalıyken; açıkken `shipping.invoiceMode`.
- "Tablet bitmiş topu okutamaz" → `scanClassify` kabul eder.

## Çözülmüş çelişkiler

- Düz storno tahsisi korur; `releaseSacks` kapanışı (CANCELLED) tahsisi siler — iki ayrı yol.
- MANUAL tartı SIMULATED kapısından muaf; `manualWeightRestrictedEnabled` ayrı kapı (açılırsa tablet 403 `MANUAL_WEIGHT_RESTRICTED`).

## Doğrulama turu ekleri (eski CLAUDE.md ↔ yeni yapı karşılaştırması, 2026-09-05)

- **[PROFİL]** Sipariş görünümü üç kolon: İstenen | Sevk | Açık (PLANNED tahsis sayılmaz). Tasarım `docs/design/CUVAL-HAVUZU-TASARIM.md`.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`. Ayrıntı: `Teks-Erp/docs/BEKCI-HARITASI.md`.

Backend: `test_sevk_partisi`, `test_shipment_delivery_to`, `test_sevke_hazir`, `test_sevk_top_listesi`, `test_emanet_sahiplik_geri_doldur`, `test_shipment_destination_chain`, `test_shipment_destination_lock`, `test_customer_branch_destination`, `test_export_code_snapshot_gate`, `test_return_scope`, `test_emanet`, `test_emanet_sahip_suzgeci`, `test_sack_allocation_cleared`, `test_accounting_direct_ship`, `test_accounting_export`, `test_allocation_repair`, `test_audit_followups`, `test_auto_draft_shipment`, `test_barcode_free_flow`, `test_batch_multibatch_dispatch`, `test_batch_partial_dispatch_autosplit`, `test_batch_split_new_wo_modes`, `test_batch_trace`, `test_branch_code_docs`, `test_bulk_dispatch_rollids`, `test_client_token_collision`, `test_consistency`, `test_customer_sack_delete_guard`, `test_denetim_s2_paketi`, `test_depo_multi_regime_gate`, `test_depo_roll_cancel_permission`, `test_direct_ship_api`, `test_direct_ship_fason`, `test_direct_ship_scenarios`, `test_dispatch_allocation_fresh`, `test_dispatch_claim_step_match`, `test_dispatch_cross_wo_batch_guard`, `test_dispatch_print_options`, `test_dispatch_report`, `test_dispatch_report_gross`, `test_doc_sample_html`, `test_document_customization`, `test_e2e_full_flow`, `test_fason_dispatch_picker`, `test_fason_visibility`, `test_filter_multi_select`, `test_finance_invoice`, `test_goods_receipt`, `test_goods_receipt_invoice`, `test_gr_order_price_currency`, `test_hide_cancelled_lists`, `test_iade_enhancements`, `test_inventory_shipment_scope`, `test_kartela_stock_and_ship`, `test_label_context_fit`, `test_label_dirty_sources`, `test_manual_move`, `test_manual_roll_undo`, `test_manual_sack_count`, `test_new_documents`, `test_null_quality_visibility`, `test_o19_operator_trace`, `test_open_orders_search`, `test_order_leadtime`, `test_order_shipments`, `test_p2_inventory`, `test_performance`, `test_printed_documents`, `test_production_flow_api`, `test_production_flow_columns`, `test_purchase_order`, `test_quick_shipment`, `test_loose_load_unit`, `test_loose_load_planned_edit`, `test_shipment_load_preview`, `test_race_conditions`, `test_raw_sale_quick_order`, `test_raw_tambur_cut`, `test_return_bulk_group`, `test_return_document_no`, `test_return_scorecard`, `test_roll_operation_revoke`, `test_roll_po_line_trace`, `test_roll_qty_adjust`, `test_roll_relabel`, `test_roll_relabel_context`, `test_roll_search_barcode`, `test_roll_warehouse_stamp`, `test_sack_content_dump`, `test_sack_customer_gate`, `test_sack_label`, `test_sack_mismatch`, `test_sack_note_document`, `test_sack_notes`, `test_sack_pool_lifecycle`, `test_sack_reassign_customer`, `test_sack_search`, `test_sack_search_filters`, `test_sack_split_and_relabel`, `test_sack_status_invariant`, `test_sack_tag_document`, `test_sack_tags`, `test_sack_weigh_source`, `test_scan_code_case`, `test_semi_finished_entry`, `test_semi_finished_surfaces`, `test_shipment_detail_gross`, `test_shipment_dispatch_document`, `test_shipment_doc_batch_column`, `test_shipment_doc_customer_name`, `test_shipment_doc_freeze_timing`, `test_shipment_event_ledger`, `test_shipment_filters`, `test_shipment_invoice`, `test_shipment_list_gross`, `test_shipment_list_sort`, `test_shipment_order_ledger`, `test_shipment_scope_lock`, `test_shipment_scorecard`, `test_shipment_undo_dispatch`, `test_shipping_client_token`, `test_shipping_flags`, `test_single_warehouse_parity`, `test_spec_availability`, `test_status_labels`, `test_stock_count`, `test_stock_scorecard`, `test_ticaret_links_and_filters`, `test_ticaret_regime_gate`, `test_token_replay_cancelled`, `test_warehouse_crud`, `test_warehouse_fail_open`, `test_warehouse_ledger`, `test_warehouse_movements`, `test_warehouse_sack_transfer`, `test_warehouse_transfer`, `test_wo_warehouse_attach`, `test_yarn_stock`, `test_e_irsaliye_xml`, `test_e_irsaliye_readiness`, `test_e_irsaliye_db_invariants`, `test_e_irsaliye_flow`, `test_e_irsaliye_storno`, `test_e_irsaliye_e2e`, `test_hizmet_fatura`, `test_cari_kilit_emanet_ayari`, `test_sevk_kapisi_cari_kilit`

İstemci: `packingLotUi.test.ts`, `ship-ready-settings.test.ts`, `packingLotList.test.ts`, `returnScope.test.ts`, `ReturnEntryDialog.lot.test.tsx`, `FilterBar.sentinel.test.tsx`, `shipping-flags.test.ts`, `ShipmentInvoiceDraft.test.tsx`, `undo-affected.test.ts`, `accounting-export.test.ts`, `accounting-export.name-mode.test.ts`, `invoiceDraftLines.test.ts`, `invoiceDraftVisibility.test.ts`, `OrderShipmentsCard.test.tsx`, `returnInvoice.test.ts`, `quickShip.test.ts`, `SackEditorView.ship.test.tsx`, `SackEntryGate.test.ts`, `ShipmentOrderSelect.test.tsx`, `dumpSheets.test.ts`, `sackTagBulk.test.ts`, `DispatchConfirmDialog.test.tsx`, `SackStorePage.test.tsx`, `shipmentDetailError.test.tsx`, `DirectShipModal.test.tsx`, `tile-visibility.test.ts`, `SackTagsPage.test.tsx`, `useSackWeigh.test.tsx`, `rollListExport.test.ts`, `packingGroupSelection.test.ts`, `CariHold.test.tsx`, `ReadyWorks.test.tsx`

Kural maddelerinin bekçileri (ek): `test_packing_group`, `test_number_series`, `test_belge_ekran_ayni`, `test_sack_seq_label`, `test_feature_flag_contract`, `packingGroupUi.test.ts`, `test_quality_scorecard`, `test_db_invariants`, `test_belge_sistem_esdegeri`, `test_sack_bulk_distribute`, `scanClassify.test.ts`, `ReworkRollsDialog.test.tsx`, `test_customer_card_fields`, `destinationDefault.test.ts`, `branch-schema.test.ts`, `procedureCode.test.tsx`, `readyWorks.test.tsx`, `test_traveler_card_a5_batches`, `test_module_flags`, `test_mobil_enum_aynasi`, `test_master_data_merge_fk_coverage`, `test_sack_touch_gate`, `test_cari_kilit_kapilar`, `test_sack_contents_uc_ad`, `RepairTable.test.tsx`, `useMachinePeripherals.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- `docs/kurallar/ayrinti/sevkiyat.md` § Arşiv notları.
