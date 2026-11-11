# Dokuma · Dokuma işi · Doff

> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/dokuma.md`.

> [ÇEKİRDEK] her kurulumda aynı · [PROFİL] fabrika seçimi. `tezgah.enabled` MODÜL anahtarıdır; telemetri kovası ve `tezgah.*` davranış bayrakları Faz 2.

---

## Ortak (backend + panel + tablet)

### Değişmezler

- [ÇEKİRDEK] Dokuma rota adımı değil ayrı VARLIK: `MachineRun` `WeavingOrder`a bağlanır, `WorkOrderStep`e değil.
- [ÇEKİRDEK] `StationKind.WEAVING` yalnız makineyle açılan oturum istasyonu (400 `STATION_MACHINE_ONLY`); rotaya giremez — `assertStationsRoutable` (400 `STATION_NOT_ROUTABLE`).
- [ÇEKİRDEK] `StationKind.WARPING` kart türüdür; devere `Station.producesWarpBeam`den tanınır; rotaya girmez (`NON_ROUTABLE_STATION_KINDS`), oturum istasyonu değil; panel türleri yalnız modül açıkken çizer.
- [ÇEKİRDEK] Tablet ön-dolgu yalnız ÖNERİ: kilitlemez, stok/defter yazmaz, zorunlu alan doğurmaz; veri yoksa null, uydurma. `Item.warpSpecId` yalnız FABRIC + aktif kart.
- [ÇEKİRDEK] Tezgah listeleri backend'de (`/api/machine-runs?open=true`, `/api/machine-doffs`), `requireDokumaEnabled` + `loom:run`·`loom:doff`·`mobile:dokuma`; `loom:read` yok; 200'de kırp, `meta.total` kırpma.
- [ÇEKİRDEK] Dokuma üçüncü top sınıfı: iplikten metre yaratır, ana top tüketmez.
- [ÇEKİRDEK] Doff TOP DOĞURMAZ: top KK1'de `entrySource = WEAVING` ile `createInitialEntry`den doğar.
- [ÇEKİRDEK] Türetilen metre (`unitDelta ÷ unitsPerCm`) stok yazmaz; miktar gerçeği `Roll` ölçümü.
- [ÇEKİRDEK] ÜRETİLEN ve TEZGAHTA toplanmaz; kalan = `plannedM − ÜRETİLEN`.
- [ÇEKİRDEK] Levent bitince koşum bitmez; koşumu desen/renk, hedef devir değişimi ya da iş bitişi bitirir.
- [ÇEKİRDEK] Metre, levent, top ayrı eksen; "kaç levent eder" hesaplanmaz.
- [ÇEKİRDEK] `WeftSpec` → sıralı `WeftSpecYarn`; kumaş eni yalnız `Item.widthCm`, `finishedWidthCm` açma.
- [ÇEKİRDEK] `MachineDataSource` alanına `@default` koyma; kaynak (`SIMULATED` dahil) açık beyan.
- [ÇEKİRDEK] Açık koşum tekilliği ÜRETİM HATTI başına (`machine_runs_one_open_per_prod_line_uq`).
- [ÇEKİRDEK] İzleme hâli tek kolon `MachineSpec.monitoringState` (`OFF`); `isMonitored` açma.
- [ÇEKİRDEK] `MachineSpec` satırı "izleniyor" demektir; tür `shedType`ten; `Machine.kind` açma.
- [ÇEKİRDEK] Duruş kimliği TOKEN (`stopKey`), saat değil.
- [ÇEKİRDEK] `machine_stop_events` sedleri (`one_open_per_machine` · `key_uq`) `revokedAt IS NULL` taşır.
- [ÇEKİRDEK] Duruşun beş yazma yolu yalnız `machine-stop.service`, atomik claim; ilk sınıflama `reasonCode IS NULL` claim'i, kayıp sınıfı donar; yeniden sınıflama aynı tx'te `MachineStopReclass`; olgular değişmez.
- [ÇEKİRDEK] Duruş aç/kapa tek boğaz `openStopCore`/`closeStopCore` (insan + `MACHINE|SIMULATED` sinyal); sinyal insan kapanışını ezmez 409 `STOP_CLOSED_BY_OPERATOR`, başka bitiş 409 `STOP_END_CONFLICT`.
- [ÇEKİRDEK] Dokuma kapalıyken duruş yalnız `uretim.makineDurusTakibi` ∧ PROCESS_QC/TAMBUR (`assertMachineStopKindAllowed`; 400 `STOP_STATION_KIND_UNSUPPORTED`); liste `machineStopScopeWhere`.
- [ÇEKİRDEK] `Station.machineStopEnabled=false` → insan duruş AÇAMAZ, 400 `STOP_STATION_DISABLED` (`assertStationStopEnabled`, `openStopCore`); makine sinyali, kapatma ve sınıflama serbest; tablet çipi yalnız açık duruş varken çizilir.
- [PROFİL] Ham kod eşlemesi `MachineStopCodeMap`, tek çözücü `resolveMachineStopCode`; uç `/api/machine-stop-code-maps` (`requireTezgahEnabled` + `loom:spec-manage`), silme = pasif.
- [ÇEKİRDEK] Kart insan duruşunu yalnız `claimOpenStopForSignal` ile sahiplenir (yalnız null kart alanları); kartın kendi açık duruşu 409 `STOP_ALREADY_OPEN`.
- [ÇEKİRDEK] Watchdog (`machine-watchdog.service`) DB claim'iyle: sessizlik `silentSince` yazar, duruş AÇMAZ; kart duruşu `tezgah.maxOpenStopHours` aşınca `endSource = WATCHDOG` geçici kapanır, insan duruşuna dokunmaz.
- [ÇEKİRDEK] Geçici kapanışı gerçek bitiş BİR KEZ düzeltir (`endCorrectedAt`, taşma 409 `STOP_OVERLAP`); mühürlüde 409 `SHIFT_SEALED` + `lateEndedAt`.
- [ÇEKİRDEK] Bekleyen kapanış tek sabit `WATCHDOG_PENDING_END_WHERE`/`LATE_STOP_END_WHERE`; rozet `stopSourceBadge`.
- [ÇEKİRDEK] Kart sırrı yalnız yerel state'te bir kez gösterilir; React Query önbelleğine girmez.
- [ÇEKİRDEK] Kart iptali önizlemeli (`/revoke/preview`, yazmaz); replay `COLLECTOR_REVOKED`, sır yeniden dönmez (`secretWithheld`).
- [ÇEKİRDEK] Mühür kapısı `assertStopShiftWritableTx`: 409 `SHIFT_CANCELLED` · `SHIFT_SEALED`.
- [ÇEKİRDEK] İnsan kararlı duruş satırı silinemez (`machine_stop_events_block_classified_delete`); geri alma `revokedAt`.
- [ÇEKİRDEK] `warpBeamSlots` GİRDİ, `productionLineCount` ÇIKTI; `beamSlot` yalnız `> 1` makinede aralıkta (`assertBeamSlotValid`); NULL serbest; CHECK `>= 0`.
- [ÇEKİRDEK] `resolveStopStamp`: operatör aralık dışı → sunucu saati + `warnings`; amir beyanı dışı → 400 `STOP_STAMP_OUT_OF_RANGE`.
- [ÇEKİRDEK] `MINOR` süre sınıfıdır; `ReasonPreset.stopLossClass`a asla yazılmaz.
- [ÇEKİRDEK] Sır kolonu kurallarıyla aynı dilimde iner (`MachineCollector`).
- [ÇEKİRDEK] `machine_runs` sedleri `revokedAt IS NULL` ister; `machineRunCount` guard'ı `revokedAt` süzmez.
- [ÇEKİRDEK] Koşum açılışı: precheck 409 `PRODUCTION_LINE_OCCUPIED`, sed 409 `MACHINE_RUN_RACE`; advisory kilit ekleme.
- [ÇEKİRDEK] Kapanış tek yazar `closeMachineRunTx` (`RUN_ALREADY_CLOSED` · `RUN_REVOKED` · `RUN_END_BEFORE_START`); NULL terim = ölçülmedi.
- [ÇEKİRDEK] Koşum geri alma damgadır; ikinci 409 `RUN_ALREADY_REVOKED`; izin `loom:run-revoke`.
- [ÇEKİRDEK] Koşum replay `assertMachineRunReplayAlive` (`CLIENT_TOKEN_COLLISION`, `RUN_REVOKED`).
- [ÇEKİRDEK] İşe bağlı koşum iş satırını ilk ifadede claim'ler (409 `WEAVING_ORDER_NOT_OPEN`); iş kapat/iptal claim'i koşum saymadan önce; fason 400 `WEAVING_ORDER_SUBCONTRACTED`.
- [ÇEKİRDEK] `startedAt`/`endedAt` beyanı `resolveEntryStamp`; dışı → sunucu saati + `warnings`; örtüşme 409 `PRODUCTION_LINE_OVERLAP`.
- [ÇEKİRDEK] Levent durum `WarpBeam` + append-only `WarpBeamEvent` (`warp_beam_events_kind_ck`); `WOUND_CANCEL` `reversesEventId @unique`; CANCELLED terminal (`one_wound_uq`).
- [ÇEKİRDEK] Levent tek yazar `applyWarpBeamEventTx`; kalan metre kolon değil; `beamNo` 8029 kilidi, yeni advisory uzay açma.
- [ÇEKİRDEK] Köken `IN_HOUSE`·`SUBCONTRACT`·`PURCHASED`; XOR `resolveOriginParty` (400 `WARP_BEAM_ORIGIN_PARTY`) + `warp_beams_origin_party_ck`; fason/hazırda iplik satırı 400.
- [ÇEKİRDEK] Devere iplike bağlı değil; içeride sarımda iplik kapalıysa 403 `MODULE_DISABLED`.
- [ÇEKİRDEK] Belge zinciri bağları opsiyonel: `WeavingOrderToOrderLine` · `WarpBeam.weavingOrderId` (400 `WEAVING_ORDER_NOT_LINKABLE`, `[WARP_SPEC_MISMATCH]` uyarı) · `weavingOrderOfRoll`.
- [ÇEKİRDEK] `Roll.weavingOrderId` yalnız doff'suz (`rolls_weaving_order_xor_ck`); zorunluluk yalnız `devere.beamWeavingLinkRequired`·`dokuma.runWeavingOrderRequired`·`dokuma.orderLineLinkRequired` (`production-chain-gates.helper`).
- [ÇEKİRDEK] `YarnLot` bakiyesi türetilir (`yarnLotBalanceTx`); lotlu çıkış 409 `YARN_LOT_BALANCE_EXCEEDED`; ters yol lotu kopyalar; doğuş `ensureYarnLotTx`.
- [PROFİL] `devere.lotRequired` false; açıkken lotsuz sarım/mal kabul 400.
- [ÇEKİRDEK] `YarnLot.qualityStatus`; [PROFİL] `goodsReceipt.yarnQualityHoldEnabled` açıkken mal kabul lotu ON_HOLD; `assertLotQualityReleasedTx` → 400 `YARN_LOT_ON_HOLD`.
- [ÇEKİRDEK] Lot kalite kararı `PATCH /api/yarn/lots/:id/quality` (`quality:write`), claim `{id, isActive}`.
- [ÇEKİRDEK] `MOUNTED` ⇔ makine ∧ yuva (`warp_beams_mounted_ck`, `warp_beams_machine_position_uq` → 409 `WARP_SLOT_BUSY`); bağlanabilir `Station.consumesWarpBeam`.
- [ÇEKİRDEK] `*_CANCEL` LIFO (`activeForwardStatusEventTx` ↔ `ACTIVE_FORWARD_EVENT_SQL`); kalan eksiye düşmez 409 `WARP_BEAM_REMAINING_EXCEEDED`; `WARP_BEAM_ADJUST`/`WARP_BEAM_SCRAP` sebep zorunlu.
- [ÇEKİRDEK] Ölçülen fark `closeToMeasuredTx`; açık koşumda son levent 409 `WARP_DISMOUNT_OPEN_RUN`; pencere tek SQL `beamsMountedDuring`.
- [PROFİL] `devere.mountTracking` false → 409 `WARP_MOUNT_TRACKING_OFF`; `devere.mountTrackingRequired` → 400 `WARP_MOUNT_METHOD_REQUIRED`; yüzeyler yalnız açıkken.
- [ÇEKİRDEK] Levent yeni izin kodu açmaz; alan doğrulaması `devere-station-fields.middleware`; bilinmeyen durum çökmez.
- [ÇEKİRDEK] Beyansız doff damgası DB saatinden (`readDbNow`).
- [ÇEKİRDEK] Otomatik tüketim tek yazar `autoConsumeForRollTx` (doff anı `beamsMountedDuring`); kalan yetmezse KK1 engellenmez, uyarır.
- [ÇEKİRDEK] Top iptali `cancelConsumedForRollTx`, SCRAP'ta yazmaz; `Roll`a levent kolonu açma; [PROFİL] `devere.autoConsume` false; uyarı metni aynen basılır.
- [ÇEKİRDEK] [PROFİL] `dokuma.rollBirth` KK1_*: `machineCode` XOR `weavingOrderId`; `createDoffTx` aynı tx, 409 `DOFF_CODE_COLLISION`, `MACHINE_NO_OPEN_RUN`.
- [ÇEKİRDEK] Çok tezgahlı işte doff uydurma; kapı 403 `MODULE_DISABLED` → 400 `ROLL_BIRTH_MODE`.
- [ÇEKİRDEK] Defter yazımında kalan yalnız `remainingMTx` (`FOR UPDATE`); `readRemainingM` yalnız yanıtta.
- BORÇ: top metre düzeltmesi levent tüketimini yeniden hesaplamaz.
- [ÇEKİRDEK] Raşel `count` 1..24: kardeşler atomik doğar (`setKey`), iplik `splitShares` ÷N.
- [ÇEKİRDEK] `physicalBeamNo` canlıda tekil (409 `WARP_BEAM_PHYSICAL_BUSY`); plan uyarır (`findLivePhysicalBeamTx`).
- BORÇ: `stock-count`, `invoice.service` iplik yolları lot-agnostik.
- [ÇEKİRDEK] Sarım `WARP_ISSUE` brüt + `WARP_RETURN` (sebep zorunlu); iptal iki `*_REVERSAL` ayrı sıfırlanır.
- [ÇEKİRDEK] İşaret tek kaynak `yarnMovementSign`; `POST /yarn/movements` WARP_* almaz; denye `resolveDenier`.
- [ÇEKİRDEK] PLANNED levent hard delete (409 `WARP_BEAM_NOT_PLANNED`); sarılmış iptal edilir; tablet Devere oturumsuz, kuyruksuz.
- [ÇEKİRDEK] Karne `collectShiftStatRows` tam küme, `pageShiftRows`, `loadShiftTermsInputs`.

### Yasaklar

- [ÇEKİRDEK] `Roll.doffEventId` ve `MachineRun.weavingOrderId` null'lanmaz.
- [ÇEKİRDEK] `plannedM` işi kapatmaz.
- [ÇEKİRDEK] Dokuma işine sipariş bağı açma.
- [ÇEKİRDEK] Duruş sayaçlarını çoğullaştırma; kırılım `beamSlot`.

### Kararlar

- [ÇEKİRDEK] İş kapanışı açık karardır, türetilmez; açık koşumda 409 `{code, machines[], runIds[]}`.
- [ÇEKİRDEK] İş iptali yalnız kendi durum geçişi; koşum/duruş/doff/top dokunulmaz.
- [ÇEKİRDEK] `/api/weaving-orders` (`weavingorder:read/write`): `DK` no, 8032 ilk ifade; replay `WEAVING_ORDER_CANCELLED`; claim `WEAVING_ORDER_NOT_OPEN`/`WEAVING_ORDER_NOT_EDITABLE`.
- [ÇEKİRDEK] `PLANNED → IN_PROGRESS` tek yazar `markWeavingOrderInProgressTx`, koşum açışıyla aynı tx; manuel `start` ucu yok.
- [ÇEKİRDEK] Taraf XOR (SUBCONTRACTED ⇔ `subcontractorId`): 400 + `weaving_orders_party_ck`.
- [ÇEKİRDEK] Dokuma işi deftere yazmaz; reopen/undo-cancel yok.
- [ÇEKİRDEK] `weaving-order`·`machine-run`·`machine-doff` router'ları `requireDokumaEnabled` (`verifyToken` sonrası, `production` önce); istemci dosyası allowlist'te, karo `dokumaEnabled`.
- [ÇEKİRDEK] `MachineShiftStat` MAKİNE × VARDİYA (`productionLineNo` unique'e girmez); defter `MachineShiftStatSeal` + `MachineShiftStopBreakdown` (kuşak); `source` `@default`suz; `sealedAt` null'lanmaz.
- [ÇEKİRDEK] Vardiya penceresi tek job `jobs/shift-calendar.job.ts`; yalnız başlamamış ∧ mühürsüz pencere yeniden yazılır; zaman `constants/time.ts`.
- [ÇEKİRDEK] `/api/shift-definitions` (`loom:spec-manage`): `ShiftInstance` tek yazar job (`planShiftCalendar`); silme yok, `isCancelled`; insan iptali korunur.
- [ÇEKİRDEK] Terimler tek helper `computeShiftTermsPure` (`clipToWindow`, kova `lossClass`, `MINOR_STOP_THRESHOLD_SEC`); target yoksa ÖLÇÜLEMEDİ; `resolveShiftSource`.
- [ÇEKİRDEK] Oranlar yalnız `loom-efficiency.helper` (payda 0 → `null`, Σ/Σ); başka dosyada bölme, `…Pct ?? 0`, `avg(…Pct)` yasak.
- [ÇEKİRDEK] Mühür `machine-shift-seal.service`: job SUPERVISOR/SEALED'a dokunmaz, mühürlemez; 409 `SHIFT_SEALED`·`SHIFT_SEAL_RACE`·`SHIFT_NOT_SEALED`; açma `loom:shift-unseal` (gerekçe ≥3).
- [ÇEKİRDEK] Hat kırılımı çocuk `MachineShiftLineStat`, yalnız `productionLineCount > 1`; kendi mührü yok; okuma opt-in `?byLine=1`.
- [ÇEKİRDEK] `/api/machine-specs` allowlist; `monitoringState` gövdeden yazılmaz; LIVE için 409 `SHADOW_TOO_SHORT`/`SIGNAL_NOT_ACCEPTED`; `acceptedAt` null'lanmaz.
- [PROFİL] `cancelReason` serbest metin (zorunlu, ≤300), `ReasonPreset`e bağlanmaz.
- [ÇEKİRDEK] `DOFF_CANCEL` yalnız bağlı top yokken (statü bakılmaz); 409 çare önermez; P2028 → 409 `DOFF_LINK_IN_PROGRESS`.
- [ÇEKİRDEK] Koşumsuz doff meşru: 400 değil `warnings`.
- [ÇEKİRDEK] Koşumsuz doff ana sayıya karışmaz; uyarı replay'de de (`deriveRunWarnings`).
- [ÇEKİRDEK] Doff kodu `reserveDoffCode` (tx/advisory yok); KK1 şeması `doffEventId` taşır; `semiFinished` ile 400.
- [ÇEKİRDEK] Doff↔top açık liste; eşleşme yalnız `WEAVING` damgasında (409 `DOFF_NOT_LINKABLE`).
- [ÇEKİRDEK] `DoffEvent`e `weavingOrderId` koyma; koşumdan türer.
- [ÇEKİRDEK] Hat kolonu `productionLineNo`, `lineNo` değil.
- [PROFİL] `dokuma.enabled` `tezgah.enabled` kardeşi (ön koşul `production.enabled`), varsayılan `false`.
- [ÇEKİRDEK] Etkin yapı yalnız `resolveEffectiveConstruction`; `productRecipeWeftYarn`/`itemWarpLayer` başka yerde okunmaz.
- [ÇEKİRDEK] `ItemWarpLayer.beamMode` yalnız SHARED_BEAM'de tüketime girer; CREEL'de levent düşümü yok.
- [ÇEKİRDEK] Katman yeri yalnız `beamLayerTag`; SHARED_BEAM/CREEL'e levent önerme.
- [ÇEKİRDEK] `sequenceCode` doluysa adet ondan; sıra yok olursa 409 `WEFT_OVERRIDE_ORPHAN`.
- [ÇEKİRDEK] İş emri atkı/desen kartını doğuşta taşır; kart değişse iş emri değişmez.
- [ÇEKİRDEK] Üretim önerisi `production-proposal.helper`; 8036 → `FOR NO KEY UPDATE` → 8032; `siparis.uretimOnerisi` kapalı.
- [ÇEKİRDEK] Tezgâh önerisi `suggestLoomsForWeaving`, ihtiyaç `beam-need.helper`; öneri engellemez; takip kapalı → `MOUNT_TRACKING_OFF`.
- [ÇEKİRDEK] Boy çekmesini YALNIZ `resolveLengthShrinkPct` (ürün yapısı → terbiye tarifesi → null), mamul→ham metreyi YALNIZ `rawMetersFromFinished` (`helpers/raw-need.helper.ts`) çöz; öneri ve iplik ihtiyacı dokuma firesini (`dokuma.weavingWastePct`, varsayılan 0) aynı formüle katar.
- [PROFİL] Tezgâh planlama alanları (`planRpm` · `planEfficiencyPct` · `maxWorkingWidthCm`) null serbesttir; aralığı `machine-plan-fields.middleware` + DB CHECK `machines_plan_*` korur.
- [ÇEKİRDEK] Atkı kartı ayırma yalnız `forkWeftSpecForItem` (`warpspec:write`); yalnız o kumaş çevrilir.

## Panel (Electron)

### Değişmezler

- [ÇEKİRDEK] Tezgah Duruşları dört kapı (`SCREEN_CATALOG`·karo·route·`ROUTE_MODULE`); sınıflama kuyruğu gün süzgecinin dışında; yeniden sınıflama web-only.
- [ÇEKİRDEK] Dokuma Raporları karo `featureFlag: "dokumaEnabled"` + `report:production`; `null` → `formatPct`; `SIMULATED` ayrı.
- [ÇEKİRDEK] `MachineStopDto` makine/vardiya/sınıflandıranı adıyla taşır.
- [ÇEKİRDEK] Tezgah Salonu `tezgahEnabled` + `loom:live-view`; değer uydurma; TV aynı kapılar (`tvGateOf`); iletim payı `freezeStopEscalation` ile donar.
- [PROFİL] İletim payı tek değer `tezgah.escalationGraceMinutes`.
- [PROFİL] İpucu yalnız `FloorHint`; TV penceresi yalnız `tv-window:open`.
- [ÇEKİRDEK] Sensörsüz tezgah elle kayıtlardan boyanır (`floorStateSourceOf`); kayıt yok → `UNMONITORED`.
- [PROFİL] "Dokuma İş Emri"/"Terbiye İş Emri"; çok tezgaha metre bölünmez.
- [ÇEKİRDEK] Seçim kimlikle; menüler tek liste `floorActionsOf`.
- [ÇEKİRDEK] Salon koşum eylemleri önizler, satır başına tx; dolu hat yalnız `replaceRunId`.
- [ÇEKİRDEK] Toplu duruş tekli yolları çağırır; `STOP_OVERLAP` opt-in `rejectOverlap`.
- [ÇEKİRDEK] "Sebep ata" yalnız ilk `classifyStop` (`loom:classify`).
- [ÇEKİRDEK] Operatör = canlı oturum (`liveSessionWhere`); salon oturum kapatmaz.
- [ÇEKİRDEK] Satır işi tek çözümleyici `rowJobIdOf`.
- [ÇEKİRDEK] İş paneli yalnız `/weaving-orders/:id/overview`; hata ≠ kayıt yok.
- [ÇEKİRDEK] Ön dolgu öneridir; hedef metre otomatik dolmaz.

## Tablet (mobil)

### Değişmezler

- [ÇEKİRDEK] Dokuma ekranı kuyruk değil tezgah gösterir.
- [ÇEKİRDEK] Doff ve koşum online-only (`networkMode:'always'`), kuyruğa girmez.
- [ÇEKİRDEK] TEZGAH ekranı WEAVING oturumundan; hat yalnız `productionLineCount > 1`.
- [ÇEKİRDEK] Doff formu `openSchema` birebir; `counterSource` her yükte.
- [ÇEKİRDEK] Doff token deneme başına (`doffAttempt.ts`); collision MODAL.
- [ÇEKİRDEK] Doff geri alma `mobile:dokuma-geri-al`; "önce topu iptal edin" yazma.
- [ÇEKİRDEK] Koşum formu `openSchema` birebir (`runPayload.ts`); boş = null.
- [ÇEKİRDEK] Koşum uçları tablet izni açmaz (`loom:run`|`mobile:dokuma`).
- [ÇEKİRDEK] Duruş paneli makine bazlı; `clientToken` = `stopKey`; `beamSlot` gönderilmez; yeniden sınıflama yalnız web.
- [ÇEKİRDEK] Duruş uçları tablet izni açmaz; `/:id/reclassify` web-only.
- [ÇEKİRDEK] `SCREEN_MODULE.Dokuma = 'dokumaEnabled'`; satır yok = kapalı.
- [ÇEKİRDEK] `MACHINE_STOP` zemini APK'da zorunlu (`constants/loomStopReasons.ts`).
- [ÇEKİRDEK] Yuva bilinmezse NULL; tahmin yazma.
- [ÇEKİRDEK] KK1 ham/dokuma SORULUR (`DoffLinkPicker`); bayrak kapalı → alan yok.
- [ÇEKİRDEK] `doffEventId` + dokuma kapalı → 403 `MODULE_DISABLED`, servisten önce.
- [ÇEKİRDEK] Alarm `LoomAlarm` + `LoomAlarmEvent`, yalnız `loom-alarm.service`; [PROFİL] `tezgah.alarmEnabled` kapalı.
- [ÇEKİRDEK] Hedef saat `stopClockOf`; alarm vardiya bitince kapanmaz.
- [ÇEKİRDEK] Alarm eylemleri claim + `actionReplay`, karşı olayla geri alınır; başkasının üstlenmesini yalnız `loom:alarm-escalation` bırakır; 403 `LOOM_ALARM_DISABLED`.
- [ÇEKİRDEK] Bekçi turu `runLoomAlarmOnce({ now, onlyMachineIds, enabled: true })`.
- [ÇEKİRDEK] Alarm bildirimi yazıcı tx'inde outbox'a.
- [ÇEKİRDEK] Panel alarm yüzeyi fail-closed (`loom:alarm-view`).
- [ÇEKİRDEK] Sinyal alarm/kademe başına bir kez; IPC `{alarmId, title, body}`.
- [ÇEKİRDEK] Mobil arka plan yalnız yerel hatırlatma; `mobile:tezgah-uyari`.
- [ÇEKİRDEK] Alıcı RAISED'da donar (`LoomAlarmRecipient`); uygunluk `ALARM_VIEW_PERMISSIONS`; `mine=1` dışı değer 400.
- [PROFİL] `tezgah.alarm.noShiftMode` `WARN`·`ALWAYS`·`REQUIRE_SHIFT` (geçişte 400 `TEZGAH_ALARM_SHIFT_REQUIRED`).
- [ÇEKİRDEK] Sebepsiz alarm `resolveTezgahAlarmUnclassifiedTarget`; açıkken süre zorunlu 400 `TEZGAH_ALARM_UNCLASSIFIED_MINUTES_REQUIRED`.
- [ÇEKİRDEK] `openedById/closedById` yalnız insan yolunda; geriye doldurma.
- [ÇEKİRDEK] Müdahale raporu yalnız alarm defterinden.
- [ÇEKİRDEK] Tablet Devere: ikinci plan açma; `beamLabelQueue`.
- [PROFİL] KK1_* modunda İNDİR yok; `beamScan`.

### Tuzaklar

- [ÇEKİRDEK] `SIMULATED` yalnız SCALE yolunda; doff sayacı beyanı taşımalı.
- [ÇEKİRDEK] `counterAtDoff` kaydedilmezse sıfırlama/sarma ayırt edilemez.
- [ÇEKİRDEK] Beş dev ekran `max-lines` muafı emsal alınmaz; emsal `screens/Modules/HizliIsEmri/`.

## Bekçiler — bu alana dokununca koş

Backend: `test_tezgah_plan_alanlari`, `test_cekme_tek_kaynak`, `test_desen_karti_servis`, `test_atki_karti_ozel_kopya`, `test_dokuma_is_emri_yapi`, `test_uretim_onerisi`, `test_tezgah_onerisi`, `test_etkin_yapi_tek_kaynak`, `test_tablet_etkin_yapi`, `test_cozgu_katman_levent`, `test_levent_katman_rapor`, `test_weaving_order_overview`, `test_makine_kart_onizleme`, `test_levent_kalan_tek_okuyucu`, `test_rapor_levent_sonucu`, `test_dokuma_karne_tam_kume`, `test_uretim_belge_zinciri`, `test_tablet_context_prefill`, `test_station_kind_warping`, `test_machine_stop_manual`, `test_durus_istasyon_kapsami`, `test_machine_stop_bulk_classify`, `test_loom_floor_operator`, `test_loom_floor`, `test_loom_alarm`, `test_loom_alarm_eylem`, `test_loom_alarm_sorumlu`, `test_durus_acan_kapatan`, `test_rapor_mudahale`, `test_makine_durus_bogazi`, `test_makine_durus_eslesme`, `test_makine_durus_kart`, `test_makine_watchdog`, `test_loom_alarm_durtme`, `test_loom_stop_zemin`, `test_warp_beam_lifecycle`, `test_warp_beam_tablet`, `test_mobile_screen_permissions`, `test_mobil_enum_aynasi`, `test_devere_regime_gate`, `test_dokuma_regime_gate`, `test_audit_labels`, `test_reason_preset_kind_parity`, `test_db_invariants`, `test_timestamptz_contract`, `test_machine_run`, `test_machine_run_bulk`, `test_machine_run_bulk_rowjobs`, `test_machine_stop_bulk`, `test_hard_delete_guard_coverage`, `test_master_data_merge_fk_coverage`, `test_production_line`, `test_machine_stop`, `test_weaving_order`, `test_loom_stop_ground`, `test_dokuma_rapor_onkosullari`, `test_production_regime_gate`, `test_permission_catalog`, `test_role_template_catalog`, `test_swagger_spec`, `test_loom_lists`, `test_machine_doff_source`, `test_perf_doff_sayac`, `test_station_kind_weaving`, `test_screen_catalog`, `test_defter_ters_yol`, `test_shift_calendar_job`, `test_shift_definition_surface`, `test_schema_drift`, `test_snapshot_kolonlari`, `test_machine_shift_terms`, `test_machine_efficiency_formula`, `test_machine_shift_seal`, `test_dokuma_rapor_cikti`, `test_machine_shadow_mode`, `test_yarn_lot`, `test_yarn_stock`, `test_feature_flag_contract`, `test_subcontractor_dispatch_beam`, `test_subcontractor_weaving`, `test_iplik_regime_gate`, `test_warp_beam_mount`, `test_machine_run_beam_overlap`, `test_consistency`, `test_machine_shift_line_stat`, `test_station_devere_fields`, `test_subcontractor_dispatch_yarn`, `test_warp_beam_auto_consume`, `test_warp_beam_set`, `test_yarn_lot_quality`, `test_dokuma_urun_adi_ayikla`, `test_kk1_roll_birth`

İstemci: `doffLink.test.ts`, `doffAttempt.test.ts`, `doffPayload.test.ts`, `runPayload.test.ts`, `stopPayload.test.ts`, `stop-regime.test.ts`, `warp-beam-regime.test.ts`, `entry-warnings.test.ts`, `beam-undo.test.ts`, `entryWarnings.test.ts`, `beamLayers.test.ts`, `BeamLayerSuggestions.test.tsx`, `beamPayload.test.ts`, `tezgahPayload.test.ts`, `tile-visibility.test.ts`, `stationScreens.test.ts`, `useVisibleScreens.test.ts`, `screenModules.test.ts`, `weaving-regime.test.ts`, `WeavingOrderDetailSheet.test.tsx`, `dokuma-regime.test.ts`, `command-entries.test.ts`, `WeavingFloor/fromApi.test.ts`, `WeavingFloor/LoomCard.test.tsx`, `WeavingFloor/floorActions.test.ts`, `WeavingFloor/selection.test.ts`, `WeavingFloor/FloorSelection.test.tsx`, `WeavingFloor/jobs/plan.test.ts`, `WeavingFloor/jobs/AssignJobDialog.test.tsx`, `WeavingFloor/jobs/FinishJobDialog.test.tsx`, `WeavingFloor/jobs/RevokeRunDialog.test.tsx`, `WeavingFloor/FloorJobs.test.tsx`, `WeavingFloor/stops/StopBulkDialog.test.tsx`, `GeneralSettings/tezgah-watchdog-settings.test.ts`, `MachineStops/watchdog-note.test.ts`

> `Backend:` satırı kapının (`test_identity_ledger.ts`) ayrıştırdığı BİÇİMDİR; yeni bekçiyi oraya ekle (tarif ayrıntı dosyasında).

## Raporların sözleşmesi — üç soru cümlesi

- [ÇEKİRDEK] ① RANDIMAN `GET /api/reports/dokuma/randiman` (`report:production`, `requireDokumaEnabled`): A ve P AYRI sunulur, ÇARPILMAZ; `NON_SCHEDULED` hiçbir paydada yok, `PLANNED` planlı süreden düşer, `UNPLANNED`/`SETUP` kullanılabilirlik, `MINOR` performans kaybı.
- [ÇEKİRDEK] Hedef yoksa (`targetUnitsPerMin` → `nominalUnitsPerMin` NULL) P "ölçülemedi" beyan edilir; `picksPerRev` paydaya ASLA girmez.
- [ÇEKİRDEK] ② DURUŞ PARETO `/durus-pareto`: SEBEP (`ReasonPreset.code`) ve SÜRE SINIFI (`MachineStopLossClass`) iki eksen, karıştırma; `MINOR` sebep gibi listelenmez; sebep serbest metin değil, etiket kopyalanıp DONAR.
- [ÇEKİRDEK] ③ VARDİYA KARNESİ `/vardiya-karnesi?factoryDay`: gün sınırı yalnız `src/constants/time.ts`; `source` kırılımı toplamda erimez; mühürlü karne değişmez.
- [ÇEKİRDEK] ④–⑥ `/levent-sonucu` · `/kapasite-kullanimi` · `/levent-bitis-tahmini` (+ `requireDevereEnabled`): kalan yalnız `remainingByBeam`ten, aritmetik `dokuma-levent-rapor.helper`; take-up/nominal yoksa "ölçülemedi"; `meta.duzeltilmisTop`.

## Raporların İKİ DEĞİŞMEZİ

- [ÇEKİRDEK] ① Elle giriş birinci sınıftır: her toplam `MachineShiftStat.source` kırılımını taşır, tek yüzdeye çökertme YASAK; `SIMULATED` `OPERATOR`dan AYRI.
- [ÇEKİRDEK] Yeni kaynak kolonu şemadan okunarak sınıflanır: rapor satırı taşıyıcısı ↔ olay kökeni.
- [ÇEKİRDEK] ② Her ufkun tek kaynağı ve ayrı adı var: dokuma raporu `DEFTER_UFKU`/`ledger-horizon` OKUMAZ; kendi `constants/dokuma-ufku.ts` `LOOM_HORIZON_DAY`; her rapor `meta.ufuk` + `meta.ufukOncesiSatir` basar.

## Geçersiz kılınan kurallar — bunlara UYMA

- KISMI `DOKUMA-IS-EMRI §3.6` ("dört tablet eylemi kuyruğa girer") GEÇERSİZ → 2026-09-14: doff ve koşum ONLINE-ONLY.

## Açık sorular

- Koşumsuz doff oranı ölçülmedi; karne basmalı, sayı görülmeden karar verilmez.
- `unitsPerCm`in kalıcı evi belirsiz; sert bağımlılık eklenmez, elle girilir ve donar.
- Advisory uzay numarası `period-guard.helper.ts` başlığından okunur; `MachineRun` advisory uzay ALMAZ (tekillik DB seddiyle).
