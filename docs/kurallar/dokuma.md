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
- [ÇEKİRDEK] Tedarikçi kalem kodu ↔ iplik kartı (`SupplierItemCode`) yalnız mal kabulden, tx DIŞI tek ifade `ON CONFLICT` ile öğrenilir (son kabul kazanır); anahtar yalnız `supplierItemCodeKey`; kumaş satırında kod 400.
- [ÇEKİRDEK] `MOUNTED` ⇔ makine ∧ yuva (`warp_beams_mounted_ck`, `warp_beams_machine_position_uq` → 409 `WARP_SLOT_BUSY`); bağlanabilir `Station.consumesWarpBeam`.
- [ÇEKİRDEK] `*_CANCEL` LIFO (`activeForwardStatusEventTx` ↔ `ACTIVE_FORWARD_EVENT_SQL`); kalan eksiye düşmez 409 `WARP_BEAM_REMAINING_EXCEEDED`; `WARP_BEAM_ADJUST`/`WARP_BEAM_SCRAP` sebep zorunlu.
- [ÇEKİRDEK] Ölçülen fark `closeToMeasuredTx`; açık koşumda son levent 409 `WARP_DISMOUNT_OPEN_RUN`; pencere tek SQL `beamsMountedDuring`.
- [PROFİL] `devere.mountTracking` false → 409 `WARP_MOUNT_TRACKING_OFF`; `devere.mountTrackingRequired` → 400 `WARP_MOUNT_METHOD_REQUIRED`; yüzeyler yalnız açıkken.
- [ÇEKİRDEK] Levent yeni izin kodu açmaz; alan doğrulaması `devere-station-fields.middleware`; bilinmeyen durum çökmez.
- [ÇEKİRDEK] Levent ve devere insan metnindeki kg/metre/yüzdeyi yalnız `helpers/qty-text.helper` (`qtyText`/`pctText`) ile bas; `details`/DTO makine biçiminde kalır.
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

- [ÇEKİRDEK] Fason devere siparişinin kg planını yalnız `warping-order/plan.ts` `computeWarpingPlan` üretir (önizleme/oluşturma/düzenleme aynı fonksiyon; hedef = Σ levent satırı, aynı iplik ana+ek kartta tel toplar, ek tel grubu yalnız AYNI LEVENT katmanı; öneri kapıyla aynı yüklemden geçer `firstNonSharedLayer`); plan alanları yalnız OPEN'da düzenlenir, iptal yalnız OPEN claim'iyle.
- [ÇEKİRDEK] Çözgü kartının ipliğini/denyesini yalnız `warpSpecDenierLines` ailesinden (`WARP_SPEC_YARN_DENIER_SELECT`) oku; levent doğuşunun iplik kırılımı `WarpBeamEventYarn`dir, WOUND `denier` çok iplikte eşdeğer denyedir; çok iplikli kart içeride sarılmaz (400) — `test_cozgu_iplik_tek_kaynak`, `test_cozgu_dogus_kirilimi`.
- [ÇEKİRDEK] Çözgü kartı ipliklerini yeni kodda yalnız `warpSpecYarnLines`ten oku (satırsız kart = kolonlardan tek satır); kolonlar satırların özetidir (sıra 0 ipliği, Σ tel); kg↔metre formülü yalnız `constants/warp-beam.ts`, çözgü planı (ileri/ters, fire, kısıt iplik) yalnız `warp-plan.helper`.
- [ÇEKİRDEK] Çözgü kartı iplik satırlarını yalnız `yarns: [{yarnItemId, endsCount}]` gövdesiyle REPLACE et (`warp-spec-yarn-write.helper`, aynı tx); `yarnItemId`/`endsCount` kolonları satırlardan türer, gövdedeki değerleri yok sayılır; satırsız eski gövde yalnız tek iplikli kartı düzenler (çok iplikte özeti bozan yazım 400) — `test_cozgu_karti_iplik_satiri` §7.
- [ÇEKİRDEK] Devere doğumlu levent (`warpingOrderId` + `warpingReceiptKey`, köken SUBCONTRACT; `warp_beams_warping_order_ck`) yalnız kabulde READY doğar; kabul birimi `warpingReceiptKey`, irsaliye no WOUND'da; tekil `cancelWound` tx'in ilk ifadesinde `assertWarpingWoundCancellableTx` çağırır.
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
- [ÇEKİRDEK] İş emrinin yapısını okuyan yüzey (tablet iş kartı) iş emrinin `weftSpecId`/`weaveDesignId`ini `resolveEffectiveConstruction(…, pin)` ile sabitler (boşsa ürünün kartı); kart İÇERİĞİ canlıdır, geçmiş rakam koşum snapshot'ından (`MachineRun.unitsPerCm`) ve maliyet sürümünden okunur. <sub>(arşiv:2026-11-21 Desen kartı basımı)</sub>
- [ÇEKİRDEK] Atkı seçici sütununu yalnız etkin yapının `weft.pickSequence`i (sunucu `expandWeftSequence`) verir; döner çerçeve `WeaveDesign.lenoFrames` (1-tabanlı); desen kartı A4 basımı `weave-card.service` → `weave-design-card.html` ANLIK iç belgedir (donmaz). <sub>(arşiv:2026-11-21 Desen kartı basımı)</sub>
- [ÇEKİRDEK] Üretim önerisi `production-proposal.helper`; 8036 → `FOR NO KEY UPDATE` → 8032; `siparis.uretimOnerisi` kapalı.
- [ÇEKİRDEK] Önizleme karar özetleri yalnız `production-proposal-insight.helper`den: tezgâh `suggestLoomsForDrafts` (zemin grup sayısından bağımsız tek okuma), iplik `yarnKgByYarn` + `yarnShortKg` (rapor çekirdeği), süre `theoreticalMPerHourDecimal`; eksik veri null, varsayılan uydurma, uygula yolu okumaz.
- [ÇEKİRDEK] Tezgâh önerisi `suggestLoomsForWeaving`, ihtiyaç `beam-need.helper`; öneri engellemez; takip kapalı → `MOUNT_TRACKING_OFF`.
- [ÇEKİRDEK] Fason devere önerisini (`GET /api/warp-plan/need`) YALNIZ `warp-need.service` doğursun: çözgü metresi `warpRequirements`ten, arz `warp-supply.helper`dan (stok + PLANNED + açık devere kalanı), açık dokuma işleri arzı `beamNeeds` ile öncelik sırasıyla tüketir, yeni talep serbest arzı görür; yazmaz, devere kapalı 403. · bekçi: `test_devere_planlama_bagi` <sub>(arşiv:2026-11-18 D8)</sub>
- [ÇEKİRDEK] İplik ihtiyacındaki deverecide duran ipliği YALNIZ `maliyet-bridge.readYarnAtWarpers` (→ `loadWarpingYarnHoldings`, "Fasondaki İplik" ile aynı sayı) oku; eksikten yalnız `deverecideDus=1` ile ve yalnız fabrika malı payını düş (varsayılan bugünkü eksik), devere/iplik kapalıyken yanıt bayt-eşit. · bekçi: `test_devere_d8b` <sub>(arşiv:2026-11-18 D8b)</sub>
- [ÇEKİRDEK] Devere gecikmesini YALNIZ `warping-order/delays.ts` türetsin: açık sipariş, etkin termin = sipariş termini > en erken canlı sevk termini, durum `expectedReturnStateOf` (fabrika günü); sayaçlar durum süzgecinden bağımsız; uç `GET /api/warping-orders/delays`, devere kapalı 403. · bekçi: `test_devere_d8b` <sub>(arşiv:2026-11-18 D8b)</sub>
- [ÇEKİRDEK] Levent gövdesi durumunu YALNIZ `helpers/beam-body.helper` yazsın (claim `{id, status=from, isActive}` + aynı tx olay; ters `<TÜR>_CANCEL` `reversesId` ile tek ters); gövde no QR değeridir, değişmez; gövde uçları `devere.beamBodyMode=OFF`ta okuma dahil 403 `BEAM_BODY_MODE_OFF`; gövde–tezgâh uyumsuzluğu `devere.beamBodyMachineFit` (WARN uyarı · BLOCK 409). · bekçi: `test_levent_govde` <sub>(arşiv:2026-11-20 devere ek B1)</sub>
- [ÇEKİRDEK] Gövde hareketini yalnız son ETKİN hareketten geri al (önceki satırın yerine dön); belgeye bağlı olayı (iplik sevkiyle SHIP_EMPTY · iade belgesiyle RETURN_TO_OWNER) yalnız belgenin iptali geri alsın; gövdesiz sevkte gövde ayarını okuma. · bekçi: `test_levent_govde_hareket` <sub>(arşiv:2026-11-20 devere ek B2)</sub>
- [ÇEKİRDEK] Gövdeli sarımın gövde durumunu yalnız `applyWarpBeamEventTx` kancası (`helpers/beam-body-warp.helper` `WARP_EVENT_BODY_RULES`) yürütsün — kilit sırası sarım → gövde, sarım tersi gövdenin aynı sarıma ait son olayını tipli tersle geri alır; dolu gövdeye ikinci sarım 409 BEAM_BODY_BUSY, müşteri gövdesi sarıma emanet sahipliği kalıtır.
- Gövde eni ↔ çözgü kartı tarak eni karşılaştırmasını YALNIZ `helpers/beam-body-fit.helper` (`beamBodyWidthWarningsTx`) yapsın: tarak eni > gövde eni → kabul (önizleme + kabul + belge), içeride sarım ve takmada yalnız `warnings` bilgisi, engel yok; iki enden biri eksikse sessiz.
- [ÇEKİRDEK] A6 levent kartını (`PrintedDocType.WARP_BEAM_CARD`) YALNIZ `warp-beam-card.service` doğursun: içerik iptalsiz WOUND satırının kopyası (`WarpBeamEventYarn`, lotlar WARP_ISSUE + fason tahsis), ücret/fiyat girmez; sarılmamış/iptal levent 409; levent CANCELLED'a geçerken basılmış kartı `applyWarpBeamEventTx` aynı tx'te VOIDED'e çeksin; levent etiket bağlam varsayılanı HİÇ yoksa standart şablonu baskı anında kur (`label-default-warp-beam.helper`), varsa dokunma.
- Devereci gövde mutabakatını (`PrintedDocType.BEAM_BODY_STATEMENT`, kaynak Subcontractor) YALNIZ `beam-body/statement.ts` kursun: liste AT_SUBCONTRACTOR + FULL_OUT, hareket yalnız etkin olaydan (ileri + `_CANCEL` çifti sayılmaz) ve satırların sonuç-yer zincirinden; "Mutabakat bas" içerik değiştiyse yeni sürüm dondursun; gövde notu iç kolondur (`sections.internalNotes` opt-in). · bekçi: `test_govde_mutabakat` <sub>(arşiv:2026-11-22 devere-levent S6)</sub>
- [ÇEKİRDEK] A6 levent kartını (`PrintedDocType.WARP_BEAM_CARD`) YALNIZ `warp-beam-card.service` doğursun: içerik iptalsiz WOUND satırının kopyası (`WarpBeamEventYarn`, lotlar WARP_ISSUE + fason tahsis), ücret/fiyat girmez; "Tahar" satırı iş emrinin pinlediği desenin (pin yoksa ürünün deseninin) `drawingInNote`undan, boşsa satır yok (kart bayt-aynı); sarılmamış/iptal levent 409; levent CANCELLED'a geçerken basılmış kartı `applyWarpBeamEventTx` aynı tx'te VOIDED'e çeksin; levent etiket bağlam varsayılanı HİÇ yoksa standart şablonu baskı anında kur (`label-default-warp-beam.helper`), varsa dokunma.
- [ÇEKİRDEK] Gövde düzeltmesini (son hareketi geri al · kayıt iptali · iade belgesi iptali) `beam-body:cancel` ile kapıla (yalnız Üretim Süpervizörü şablonu); günlük hareket ve iade belgesi `beam-body:write` (Depo & Sevkiyat, Planlama); eski sarımı gövdeye yalnız `scripts/fix_beam_body_from_physical_no.ts` bağlasın (dry-run varsayılan; belirsiz/meşgul/dışarıdaki atlanır, canlı sarımda kancanın FILLED/MOUNTED'ı bugüne yazılır). · bekçi: `test_levent_govde_bag_onarimi`, `test_role_template_catalog` <sub>(arşiv:2026-11-22 gövde izni + bağ onarımı)</sub>
- Dolu (FULL_OUT) gövdenin elle "Boş döndü"sünü (RETURN_EMPTY) yalnız sebeple kabul et (400 `BEAM_BODY_RETURN_REASON_REQUIRED`); olay sarımı taşır, geri alma gövdeyi FULL_OUT + sarımıyla geri getirir; sarım taşıyabilen türler `BEAM_BODY_WARP_OPTIONAL_KINDS` ↔ DB `beam_body_events_warp_allowed_ck`. · bekçi: `test_fason_devere_belge_storno`, `test_levent_govde_sarim` <sub>(arşiv:2026-11-22 devere ek P)</sub>
- [PROFİL] Gövde no'yu YALNIZ `helpers/beam-body-no.helper` `matchBeamBodyNo` ile eşleştir (önce birebir; `devere.bodyNoLooseMatch` açıksa saf kural `utils/beam-body-no.ts` ↔ mobil bayt-aynı kopya; çok aday 409 `BEAM_BODY_NO_AMBIGUOUS`); tekillik birebir kalır. Tartılı bitişte darayı `resolveWeighTareTx`ten al (beyan > `devere.residualTareFromBody` ∧ gövde darası). · bekçi: `test_govde_no_esnek` <sub>(arşiv:2026-11-22 devere S3)</sub>
- Gövde sayımını DURUMSUZ tut: `POST /beam-bodies/count-preview` (`services/beam-body/count.ts`) yazmaz, sayım tablosu/belgesi açma; beklenen küme `isExpectedInScope` ↔ `expectedWhere` (depo = EMPTY/FULL_STOCK, devereci = AT_SUBCONTRACTOR/FULL_OUT), kod çözümü yalnız `matchBeamBodyNos`; farkı yalnız mevcut elle geçiş (`beam-body:write`) kapatsın. · bekçi: `test_govde_sayim_onizleme` <sub>(arşiv:2026-11-22 devere S7)</sub>
- [ÇEKİRDEK] Levent/gövde bekleme yaşını ("kaç gündür bu durumda") YALNIZ `helpers/status-age.helper` türetsin: son ETKİN olayın `createdAt`i (levent `ACTIVE_FORWARD_STATUS_EVENT_WHERE`, gövde `BEAM_BODY_EFFECTIVE_EVENT_WHERE`), olay yoksa doğuş; yaş kolonu açma, `minAgeDays` süzgecini Prisma parçası olarak liste + cursor + özete aynı where'den ver; yalnız gösterir, engellemez; uyarı eşiklerini `devere.staleFullBeamDays`/`devere.staleOutBodyDays` ayarından oku, istemcide sabit yazma. · bekçi: `test_levent_bekleme_yasi` <sub>(arşiv:2026-11-22 devere S4)</sub>
- [ÇEKİRDEK] Boy çekmesini YALNIZ `resolveLengthShrinkPct` (ürün yapısı → terbiye tarifesi → null), mamul→ham metreyi YALNIZ `rawMetersFromFinished` (`helpers/raw-need.helper.ts`) çöz; öneri ve iplik ihtiyacı dokuma firesini (`dokuma.weavingWastePct`, varsayılan 0) aynı formüle katar.
- [PROFİL] İplik ayırmayı (`dokuma.yarnReservationEnabled`, varsayılan kapalı) YALNIZ `helpers/yarn-reservation.helper.ts`ten türet ve `maliyet-bridge.readYarnReservation` ile oku: açık kendi tezgâh işinin kalanı × `yarnUsagePerM`, hazır levent önce işlere; engelleme, tablo ya da defter kurma; kapalıyken yanıt bayt-eşit.
- [PROFİL] Tezgâh planlama alanları (`planRpm` · `planEfficiencyPct` · `maxWorkingWidthCm`) null serbesttir; aralığı `machine-plan-fields.middleware` + DB CHECK `machines_plan_*` korur.
- [ÇEKİRDEK] Atkı kartı ayırma yalnız `forkWeftSpecForItem` (`warpspec:write`); yalnız o kumaş çevrilir.
- [ÇEKİRDEK] Ürün penceresinde girilen atkıyı yalnız `weft-spec-draft.service` karta çevirsin: yeni üründe kart ürünle aynı tx'te (`weftSpecDraft`, deneme kimliği ürünün `clientToken`ı), var olan üründe `attach-to-item` (ürün satırı FOR UPDATE → kart → beklenen-kart claim'i, doğal anahtar replay); kod = ürün kodu, ad = ürün adı; paylaşılan (ya da kullanım sayısı bilinmeyen) atkı kartını kullanım yerinden (ürün penceresi) değiştirme — yalnız "kopya/örnek al" (`fork`) ya da Atkı Kartları ekranına yönlendir; yerinde düzenleme yalnız o kumaşa ait kartta. · bekçi: `test_urun_atki_taslagi` <sub>(arşiv:2026-11-24 Ürün tek pencere; 2026-11-25 override yalnız asıl yerden)</sub>
- [ÇEKİRDEK] Atkı iplik payını yalnız `weft-share.helper` (`withWeftShares`) hesaplasın: kütlece maliyet motorunun `yarnUsagePerM` atkı kg/m oranı, denye eksikse atım payı (`shareBasis: "PICKS"`), satırsız kart null; kart dönen her yanıt süslenir.
- [ÇEKİRDEK] Tezgâh yük çizelgesini (`GET /api/weaving-orders/loom-load`) yalnız `loom-load.service` doğursun: iş tezgâhta = açık koşum ya da işe bağlı takılı levent, saat öneri önizlemesinin `weavingHoursDecimal`ı, tek bilinmeyen terim (devir/randıman/atkı/kalan, çok tezgâhlı iş) toplamı ve boşalmayı null yapar, boşalma "şimdi başlar, kesintisiz 24 saat" varsayımıdır; sorgu sayısı sabit kalır.
- [ÇEKİRDEK] Devere teslim süresini yalnız `warping-order/lead-time` hesaplasın (deverecinin son 5 kapanmış siparişinde iptalsiz ilk sevk → ilk canlı kabul, fabrika günü, MEDYAN; örnek yoksa `devere.defaultLeadDays` > 0, o da yoksa null + gerekçe); "devereye ver" günü = bitiş − ⌈süre⌉, yedek = aynı kartın READY leventi + açık devere kalanı (`readBeamStockBySpec`/`readWarpSupplyBySpec`), devere gecikme bildirimi kokpitin `listWarpingDelays` OVERDUE kümesinden.
- [ÇEKİRDEK] Devereci karnesi her ölçüyü kendi tek kaynağından alsın, kopya yüklem yazmasın: teslim/süre `lead-time` (`LEAD_ORDER_SELECT` + `orderLeadSample`, termin `effectiveDue` + `overdueDaysOf`), fire canlı SETTLE kapanışı, ret iptalsiz ret belgesi, denye `getDenierDeviationReport`, çözgü hatası yalnız `CONSUMED.rollId` (iptalsiz) bağıyla `ACTIONABLE_ROLL_ERROR_WHERE` + `WARP_DEFECT_GROUP`; bağ yoksa "ölçülemedi" + gerekçe, sıfır değil.
- Taharı tür (`WeaveDesign.drawingInType`: Düz/Sivri/Atlamalı/Özel, NULL = bilinmiyor) + not (`drawingInNote` ≤300) olarak tut; türü yalnız Eksantrik/Armür'de yaz (Jakar 400, saklı değer silinmez, etkin görünüm null); kumaş görünümü dizilimi `drawingInUnit` tek kuralıyla çizsin (Özel/boş düz); basımda "TAHAR : <tür> · <not>" yalnız biri doluysa çıksın (boş → bayt-aynı). <sub>(arşiv:2026-11-22 Devere/levent S8 · 2026-11-25 Seyitoğlu K1)</sub>
- Firma mekanizma ayarında (`dokuma.mechanism{Cam,Dobby,Jacquard}Enabled`, varsayılan açık) kapalı mekanizmayı yalnız YENİ seçimde reddet (`assertMechanismEnabled`); kayıtlı değeri taşıyan güncelleme serbest, en az biri açık kalsın. <sub>(arşiv:2026-11-25 Seyitoğlu K10)</sub>
- Tarak numarasını hep diş/10 cm sakla; diş/cm ayarında (`devere.reedNumberUnit`) panel gösterir ÷10, alır ×10 — çeviri yalnız `Electron/src/lib/reed-unit.ts`ten. <sub>(arşiv:2026-11-25 Seyitoğlu K9)</sub>
- Kart görsellerini veriden türet: çözgü dizilim açılımını yalnız `warp-sequence.helper` (`endsSequence`; okunamayan not null), kumaş görünümünü yalnız `weave-drawdown.helper` (düz tahar, LENO çizilmez) üretsin; istemci `pickSequence`/`endsSequence` hesaplamaz, drawdown aynası aynı örnek tabloyla parite testine bağlıdır. · bekçi: `test_warp_sequence`, `test_weave_drawdown` <sub>(arşiv:2026-11-22 Kart görseli A)</sub>
- Kart editörlerinin kutu şeridi/ızgara taslağını (`lift-plan-edit`, `sequence-edit`) yalnız düzenleme önizlemesi say: kaydedilen değer `liftPlan`/`lenoFrames`, `sequenceCode`, `sequenceNote` metnidir; kayıtlı görünüm ve tel tutma uyarısı sunucunun `pickSequence`/`endsSequence`inden çizilsin. <sub>(arşiv:2026-11-23 Kart görseli I)</sub>
- Dizi kodundaki tekrar kısaltmasını (`10x(A2 B2 C1) D4`, `(…)x10`, `10*(…)`; iç içe yok) yalnız `sequence-repeat.helper` bölsün; atkı kaydı kısaltmayı korusun, adet ve açılım parantez açılarak türesin, 512 açılım tavanı yalnız kısaltmalı koda uygulansın; panel şeridi düzenlenince kod açık biçime döner. · bekçi: `test_dizi_tekrar` <sub>(arşiv:2026-11-25 Dizi kodu tekrar kısaltması)</sub>
- [ÇEKİRDEK] Desen sınıfını yalnız `weave-classification.ts` `resolveWeaveClass` ile oku (mekanizma Eksantrik/Armür/Jakar + ayrı örgü; `kind` çift yazılan geçiş alanı); Armür dışı ızgara ve Jakar dışı kanca yazımı 400, saklı eski değeri silme, okuyucular `effectiveWeaveDesign` üzerinden görmesin; Örme tekniği açılana dek 400. <sub>(arşiv:2026-11-25 Desen sınıflaması üç eksen)</sub>
- [ÇEKİRDEK] Kenar çerçevesini yalnız `WeaveDesign.selvedgeFrames`te tut (`lenoFrames` ikizi, döner ile kesişmez: servis 400 + DB CHECK; Armür dışı yazım 400, `effectiveWeaveDesign` gizler); kumaş görünümünün zemin raporuna döner ve kenar çerçevelerini katma; mevcut döner işaretini fabrika teyidi olmadan kenara çevirme. <sub>(arşiv:2026-11-25 Desen kartında kenar çerçevesi işareti)</sub>
- Desen kartı teknik özetini (tel/cm, rapor/m, gramaj) yalnız `computed-gsm` ucundan bas; kartı kopyalarken tek `POST /api/weave-designs` gönder, etkin görünümü izle (gizli ızgara/kanca taşınmaz), tezgâh dosya adını boş bırak. · bekçi: `test_kumas_hesaplanan_gramaj` §7 <sub>(arşiv:2026-11-25 Desen kartı teknik özet şeridi)</sub>
- Kumaşa ait olanı (atkı, varyant, ek çözgü katmanı) yalnız kumaşın ürün penceresinde düzenlet; desen kartında salt okunur özet + "Üründe aç" göster (devere kapalıyken sarım biçimi desen kartında kalır). <sub>(arşiv:2026-11-25 Kumaşa ait olan ürün penceresinde)</sub>
- Renk seçici kanalını atkı kartının SATIRINDA tut (`weft_spec_yarns.colorChannel` 1..16, kartta tekil; varyant iplik değişimi kanalı değiştirmez); atkı ihtiyacını (kg/1000 m) yalnız `POST /api/weft-specs/calc` hesaplasın (maliyet motoru, yazmaz) — panel çizer. · bekçi: `test_atki_kanal_hesap` <sub>(arşiv:2026-11-25 Atkı renk seçici kanalı + atkı hesap paneli)</sub>

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
- [ÇEKİRDEK] Yeni dokuma iş emrini Dokuma › "Dokuma İş Emri oluştur"dan (`/operations/weaving-orders/new`, `weavingorder:write`, dokuma kapısı) aç: Standart + özel dokuma şablonları (`WeavingOrderTemplate`); şablon yalnız formu ön-doldurur, iş emri şablona bağlanmaz; gövde allowlist (`.strict()`), sil = pasife al. · bekçi: `test_dokuma_sablon` <sub>(arşiv:2026-11-23 İE ayrımı)</sub>

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
- [ÇEKİRDEK] Kartı kullanan açık iş emri sayısını yalnız `helpers/spec-open-orders.helper.ts`ten oku (`OPEN_WEAVING_ORDER`/`OPEN_WARPING_STATUSES`; etkin kart = iş emrinin kartı, boşsa ürünün kartı/ek katmanı); kart düzenleme uyarısı engellemez.

### Tuzaklar

- [ÇEKİRDEK] `SIMULATED` yalnız SCALE yolunda; doff sayacı beyanı taşımalı.
- [ÇEKİRDEK] `counterAtDoff` kaydedilmezse sıfırlama/sarma ayırt edilemez.
- [ÇEKİRDEK] Beş dev ekran `max-lines` muafı emsal alınmaz; emsal `screens/Modules/HizliIsEmri/`.

## Bekçiler — bu alana dokununca koş

Backend: `test_iplik_ayirma`, `test_tezgah_plan_alanlari`, `test_cekme_tek_kaynak`, `test_desen_karti_servis`, `test_desen_tahar_mekanizma`, `test_dizi_tekrar`, `test_desen_siniflama`, `test_urun_atki_taslagi`, `test_atki_karti_ozel_kopya`, `test_dokuma_is_emri_yapi`, `test_uretim_onerisi`, `test_uretim_onerisi_ozet`, `test_tezgah_onerisi`, `test_etkin_yapi_tek_kaynak`, `test_tablet_etkin_yapi`, `test_cozgu_katman_levent`, `test_cozgu_plan_motoru`, `test_cozgu_karti_iplik_satiri`, `test_cozgu_dogus_kirilimi`, `test_cozgu_iplik_tek_kaynak`, `test_fason_devere_siparis`, `test_fason_devere_sevk`, `test_fason_devere_devir`, `test_fason_devere_donus`, `test_fason_devere_kapanis`, `test_fason_devere_iade_fire`, `test_fason_devere_ayar`, `test_fason_devere_dogrudan`, `test_fason_devere_levent_adet_acik`, `test_devere_planlama_bagi`, `test_devere_d8b`, `test_levent_katman_rapor`, `test_weaving_order_overview`, `test_makine_kart_onizleme`, `test_levent_kalan_tek_okuyucu`, `test_rapor_levent_sonucu`, `test_dokuma_karne_tam_kume`, `test_uretim_belge_zinciri`, `test_tablet_context_prefill`, `test_station_kind_warping`, `test_machine_stop_manual`, `test_durus_istasyon_kapsami`, `test_machine_stop_bulk_classify`, `test_loom_floor_operator`, `test_loom_floor`, `test_loom_alarm`, `test_loom_alarm_eylem`, `test_loom_alarm_sorumlu`, `test_durus_acan_kapatan`, `test_rapor_mudahale`, `test_makine_durus_bogazi`, `test_makine_durus_eslesme`, `test_makine_durus_kart`, `test_makine_watchdog`, `test_loom_alarm_durtme`, `test_loom_stop_zemin`, `test_warp_beam_lifecycle`, `test_warp_beam_tablet`, `test_mobile_screen_permissions`, `test_mobil_enum_aynasi`, `test_devere_regime_gate`, `test_dokuma_regime_gate`, `test_audit_labels`, `test_reason_preset_kind_parity`, `test_db_invariants`, `test_timestamptz_contract`, `test_machine_run`, `test_machine_run_bulk`, `test_machine_run_bulk_rowjobs`, `test_machine_stop_bulk`, `test_hard_delete_guard_coverage`, `test_master_data_merge_fk_coverage`, `test_production_line`, `test_machine_stop`, `test_weaving_order`, `test_loom_stop_ground`, `test_dokuma_rapor_onkosullari`, `test_production_regime_gate`, `test_permission_catalog`, `test_role_template_catalog`, `test_swagger_spec`, `test_loom_lists`, `test_machine_doff_source`, `test_perf_doff_sayac`, `test_station_kind_weaving`, `test_screen_catalog`, `test_defter_ters_yol`, `test_shift_calendar_job`, `test_shift_definition_surface`, `test_schema_drift`, `test_snapshot_kolonlari`, `test_machine_shift_terms`, `test_machine_efficiency_formula`, `test_machine_shift_seal`, `test_dokuma_rapor_cikti`, `test_machine_shadow_mode`, `test_yarn_lot`, `test_yarn_stock`, `test_feature_flag_contract`, `test_subcontractor_dispatch_beam`, `test_subcontractor_weaving`, `test_iplik_regime_gate`, `test_warp_beam_mount`, `test_machine_run_beam_overlap`, `test_consistency`, `test_machine_shift_line_stat`, `test_station_devere_fields`, `test_subcontractor_dispatch_yarn`, `test_warp_beam_auto_consume`, `test_warp_beam_set`, `test_yarn_lot_quality`, `test_dokuma_urun_adi_ayikla`, `test_kk1_roll_birth`, `test_atki_iplik_payi`, `test_tezgah_yuk`, `test_fason_devere_okuma`, `test_levent_govde`, `test_levent_govde_hareket`, `test_levent_govde_sarim`, `test_kart_acik_is_emri`, `test_tedarikci_kalem_kodu`, `test_devere_zamanlama`, `test_levent_govde_bag_onarimi`, `test_levent_karti`, `test_govde_mutabakat`, `test_govde_no_esnek`, `test_devereci_karnesi`, `test_levent_bekleme_yasi`, `test_govde_sayim_onizleme`, `test_warp_sequence`, `test_weave_drawdown`, `test_dokuma_sablon`, `test_atki_kanal_hesap`

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
