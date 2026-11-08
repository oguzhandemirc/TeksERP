# Tambur · Finalize · Kesim · Geri alma
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/tambur.md`.

Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

## Ortak (backend + panel + tablet)

### Değişmezler

- **[ÇEKİRDEK]** `RollOperation` geri alınırken SİLİNMEZ, `revokedAt`/`revokedById`/`revokeReason` ile damgalanır; okuyan her yol (ilişki okumaları ve üçlü anahtarlı `upsert` dahil) `ACTIVE_OPERATION`dan süzer; istisnalar gerekçesiyle kodda.
- **[ÇEKİRDEK]** `RollMovement` geri alınırken SİLİNMEZ, damgalanır; adım durumu yalnız AKTİF hareketlerden sayılır, geri alınmış satır ne kapatılır ne yeniden açılır.
- **[ÇEKİRDEK]** Tambur geri alımı (SINGLE · SINGLE_RESTORE · FULL) iptal edilen çocuğun AKTİF müşteri kodunu iptal claim'iyle AYNI tx'te `revokeCustomerCodesOfRollsTx` ile damgalar; satır silinmez, kod yeniden verilmez.
- **[ÇEKİRDEK]** Her rotanın SON adımı topu finalize eder (`finalizeRollsAtLastStep`); `Roll.form` otomatik; `qualityGrade` NULLABLE (yalnız kalite istasyonları belirler; `finalizedAt` kaliteyle aynı olaydan).
- **[ÇEKİRDEK]** Finalize iş emrini topun `currentStep`'inden çözer, `producedInStep`'ten DEĞİL.
- **[ÇEKİRDEK]** İş emrini YALNIZ terminal-guard'lı `completeWorkOrderIfStepsDone` kapatır; CANCELLED/SUPERSEDED asla COMPLETED'a dirilmez; iptal/devredilmiş WO adımındaki topun finalize/kesimi reddedilir (pre-tx + kilit altı guard).
- **[ÇEKİRDEK]** Movement kapanışında `qtyOut = qtyIn`; finalize öncesi kesimler hacimden düşmez; WIP raporu qtyIn/qtyOut farkını "kayıp" diye BASMAZ.
- **[ÇEKİRDEK]** İş emri depo topunu da tüketebilir: `attachRolls`/`quickStart` STOCK/WAREHOUSE/A1_STOCK kabul eder (`acceptedRollStatuses`), atomik `updateManyAndReturn` claim.
- **[ÇEKİRDEK]** Split çocuğu `parentRollId` + YENİ barkod + `entrySource=TAMBUR_SPLIT`; parti/depo MİRAS, giriş istasyonu/kat/`producedInStepId` MİRAS DEĞİL. Yollar: Tambur finalize · cutOpenFabric · finalizeOpenFabric · Top Kesme (cutWarehouseRoll/finalizeWarehouseCut) · fason kısmi sevk.
- **[ÇEKİRDEK]** `producedInStepId`: adıma bağlı kesimlerde (finalize · cutOpenFabric · finalizeOpenFabric) işlemin yapıldığı Tambur adımı; Top Kesme ve fason kısmi sevk çocuğunda NULL.
- **[ÇEKİRDEK]** `RollError` PROCESS_QC'de (kursun-qc + `kursunFinish`) ve Tambur'da açılır; Tambur kararıyla kapanır (`isProcessed=true`, `actionTaken=CUT|NO_CUT`); Tambur dışı `NO_CUT` idari kapanış olabilir. Kapanış ÇEKİRDEK, açılış istasyonu PROFİL.
- **[ÇEKİRDEK]** Fason adımına manuel taşıma `AT_SUBCONTRACTOR` YAPMAZ (çıkış Fason Sevk ile); fason dönüşü top (`entrySource=SUBCONTRACTOR_RETURN`) yeniden sevk+kabul edilebilir, ek engel konmaz.
- **[ÇEKİRDEK]** `Roll.foldType` KALICI kolon; MİRAS ALINMAZ (kesimde seçilen yazılır; gönderilmezse parent→plan fallback'i miras değildir); kanoniklik ZORUNLU (`resolveFoldTypeForWrite`/`normalizeFoldType`).
- **[ÇEKİRDEK]** Giriş sebebi `Roll.entryReason` KOLONUNDAN okunur (audit tek kaynak değil); kolon boşsa eski kayıtta audit'e düşülür; geri doldurma script'i dry-run varsayılan.
- **[ÇEKİRDEK]** Elle eklenen top PARTİSİZ doğmaz: tek açık parti → bağla · birden çok → 400 `BATCH_REQUIRED` + liste · hiç yok → NULL, `batch.autoCreateEnabled` açıksa sunucu partiyi FAZ 2 tx'inde açar; "açık" veriye dayanır (K18); karar yanıtta + audit `batchSource`.
- **[ÇEKİRDEK]** Kesim (cutOpenFabric, cutWarehouseRoll) yalnız `currentQty` düşürür, `initialQty` dokunulmaz snapshot'tır; geri alma `currentQty`yi geri koyar, `initialQty`yi yalnız aşımda `initialBump = max(0, yeniCurrent − initial)` ile çeker (düz `+len` YASAK).
- **[ÇEKİRDEK]** Bump'ın sapma satırı (`TAMBUR_UNDO_RESTORE`/`_FULL`) yalnız keşifle karşılanmayan kısım için doğar; kesim anı aşımı ebeveyne `TAMBUR_OVERCUT` (`sourceRollId` adlı) yazılır, geri alma onu ne tersler ne yeniden yazar; klasik `finalize` keşfi atıfsız ve karşılamaz.
- **[ÇEKİRDEK]** Restore-toplamına giren HER kaynak `applyFull` 5b terslemesine de eklenir; `computeRestoredQty` çocuk-kapsamlı `TAMBUR_UNDO_SINGLE` düzeltmelerini de sayar.
- **[ÇEKİRDEK]** Renk/en hedeften sapan top depoya ONAYLA iner: 409 `PLAN_MISMATCH` → `confirmMismatch`; top başına BİR soru; audit + `RollPlanDeviation` çağıran tx'inde.
- **[ÇEKİRDEK]** TEK helper `tambur-plan-gate.helper`; ayarlar `tambur.planGate.widthToleranceCm` (10) ve `tambur.planGate.widthCheck` (ENFORCE | OFF), eşik yalnız `effectiveTamburPlanWidthGate`ten.
- **[ÇEKİRDEK]** Plan kapısı dışı: scrap/discard ve renk-hedefsiz WO; fason kabulünde onaylanmış sapma (`planColorAction=ROLLS_ONLY`) tekrar SORULMAZ.
- **[ÇEKİRDEK]** Ölçülen en yalnız `Station.capturesWidth` istasyonunun adım bitişinde (`completeQc2` · `kursunFinish`, `measuredWidthCm`) `Roll.width`e yazılır: yeteneksize 400 `WIDTH_CAPTURE_DISABLED`.
- **[ÇEKİRDEK]** > 0 ve ≤ mevcut + Tambur en eşiği; ileri/ters yazım atomik claim (`updateMany WHERE {id, width}`, 0 → 409 `ROLL_CHANGED`).
- **[ÇEKİRDEK]** En izi QC2 satırı `metadata.widthBefore/widthAfter`; `revokeRollOperations` ve adım yeniden açma eni aynı tx'te geri koyar; izsiz QC2 satırı `prepareWidthTracedStepOpTx` ile damgalanıp yeniden doğar; replay idempotent; tek boğaz `measured-width.helper` + `roll-operation.helper`.
- **[PROFİL]** Finalize çocuk eni yalnız `pickFinalizeChildWidthTx`ten (ayar `tambur.childWidthSource`, okuyucu `readTamburChildWidthSource`): `WO_TARGET_FIRST` (varsayılan) WO eni yoksa ana top eni.
- **[PROFİL]** `MEASURED_FIRST` aktif en izi varsa güncel `Roll.width`, yoksa varsayılan; kesim yolları `parent.width`.
- **[ÇEKİRDEK]** Hedef renk değişikliği TEK bekçi `assertTargetColorChange`; kilit MALA bakar (COLOR_PARTIAL_CONFIRM / COLOR_DYED_BLOCKED); rota kapsaması UYARIR (`ApiResponse.warnings`); renk veren adım yüklemi `stepCanApplyColor`.
- **[ÇEKİRDEK]** Kesim gövdeleri (finalize `cuts[]` · `cutOpenFabric` · `cutWarehouseRoll` · manuel top/üretim) ölçüm kaynağını opsiyonel `measure` (`meterSourceSchema`) ile beyan eder.
- **[ÇEKİRDEK]** `RollVariance.measureSource` YALNIZ `weakestMeasureSource`ten (SIMULATED > OPERATOR/SUPERVISOR > MACHINE; kaynaksız → NULL), backfill yok.
- **[ÇEKİRDEK]** Ölçüm kapıları tx açılmadan: SIMULATED + `tambur.simulatedMeterEnabled` kapalı → 400 `SIMULATED_METER_DISABLED`; `tambur.olcumKaynagiZorunlu` açık + measure yok → 400 `MEASURE_SOURCE_REQUIRED`; `cardSampleId` → 400 `CARD_SAMPLE_UNSUPPORTED`.
- `tambur.simulatedMeterEnabled` açıkken panelde (ayar kabuğu + Kumaş Stoğu) KALICI kırmızı şerit göster; kapatma düğmesi ekleme; koşul tek yer `shouldShowSimulatedMeterBanner`.
- **[ÇEKİRDEK]** Adımlı kesim `measure` taşıyorsa çocuk doğduktan sonra AYNI tx'te `writeCutReadingsTx` ile CUT okuması yaz; `measure` yoksa ve depo kesiminde YAZMA; kapanış kalan sapma kaynağını `cutChildrenMeasureSourceTx` ile türet.
- **[ÇEKİRDEK]** Kurşun dağıtımı ön koşul değil: Tambur okutması dağıtılmamış kurşunu da kapatır (bayrak açık **ve** adım bypass'a uygun — `assertKursunTabletMayWrite` kaynağı); makine atfı uydurulmaz (`machineId=null`); marker `KURSUN_BYPASS_FINISHED:UNASSIGNED:`.
- **[ÇEKİRDEK]** `pending-rolls` · `open-cards` `stationId` ile sıradaki adımın istasyonuna göre süzülür; parametresiz = TAMBUR-türü listesi; kurşun adımındaki ve rotasız top listelenmez.
- **[ÇEKİRDEK]** Bilinmeyen istasyon 404, pasif/TAMBUR olmayan 400; tablet `stationId`yi yalnız [PROFİL] `tambur.listByStationEnabled` açıkken gönderir.
- **[ÇEKİRDEK]** Rapor çıpası `Roll.finalizedAt` ve `statusChangedAt` — TRIGGER yazar; kaynak statü listesinde SHIPPED/CANCELLED bilerek YOK; damga üzerine yazılır.
- **[PROFİL]** `quality.gradeRequiredEnabled` DAR kapsam (KK1 · Tambur kalan-kuyruk · depo kesimi · WO kapanışının satılabilir dalları); fason kabulü · son-adım finalize · `cutOpenFabric` · `attachRolls` DIŞARIDA; kapsamı genişletme.
- **[PROFİL]** Müşteri tambur ayarlarını (en kaynağı, tartım, bölme ölçüsü) hedef müşteri ?? top sahibinden YALNIZ `tambur-customer-settings.helper` çözer.
- **[ÇEKİRDEK]** Tablette Kime? varsayılanı fason (EMANET) topta malın sahibidir (`label-settings.ownerCustomer`), sahipsiz topta Stok; top başına bir kez uygulanır, operatörün Stok/başka hedef seçimi ezilmez (`mobil/.../Tambur/ownerTarget.ts`).
- **[PROFİL]** Top doğuran her yolda tartım kapısı 400 `TAMBUR_WEIGHT_REQUIRED` (discard/kalan 0 hariç); `tambur.labelPrintTiming` (EACH | END) istemci kararıdır.

### Yasaklar

- **[ÇEKİRDEK]** Ölü top kümesi TEK kaynak `K18_DEAD_STATUSES` (SUBCONTRACTOR_CONSUMED, TAMBUR_CONSUMED, KARTELA_CONSUMED, CANCELLED); `SCRAP` bilerek YOK (partiyi kapatmaz, karneden düşmez); filtrede elle statü listesi KOPYALAMA.
- **[ÇEKİRDEK]** CANCELLED/SUPERSEDED iş emrinde manuel taşıma REDDEDİLİR (409 + önizlemede `woBlocked`); tek kaynak `workorder-manual-move.service.manualMoveWoBlockReason`.
- **[ÇEKİRDEK]** Aşım dallarının claim WHERE'ine `currentQty > 0` KOYMA; normal dal `gte` durur; her sıfır-üstü kesim çocuk + sapma satırı üretir.
- **[ÇEKİRDEK]** `cutWarehouseRoll` · `cutOpenFabric`ta ebeveyni çocuk `create`inden ÖNCE `FOR UPDATE` al (depo: tx'in ilk ifadesi; açık kumaş: WO kilidinden sonra); karar ön okumadaki NİYETLE: kalan yetmiyor/değişmişse 409 `ROLL_CHANGED_DURING_CUT`; aynı `clientToken` kilitten önce yanıtlanır.

### Reçeteler

- **[ÇEKİRDEK]** Etikete katalog KODU basılır; kat girilmemiş topta `present:false` (atlanır); ÇUVAL etiketinde kat YOK; PPLB beklentisi `cleanCtlCp1254` ile kurulur; "katalogda yok" sondası gerçek kod kullanmaz.
- **[PROFİL]** Elle top ekleme sebebi DB `ReasonPreset` kataloğundan (`manualReasons.ts` yalnız APK zemini); serbest metin "Diğer"; sürekli "Diğer" seçiliyorsa katalog düzeltilir.

### Kararlar

- **[ÇEKİRDEK]** "Durum Düzelt" / `recover-to-production` KALDIRILDI; takılı IN_PRODUCTION top için tek yol "Kurtar" (`rescueStuckRoll`, `roll:manual-adjust`) → WAREHOUSE.
- **[ÇEKİRDEK]** `cutOpenFabric` çocuğu, `finalizeOpenFabric` kalanı ve `rescueStuckRoll` stok defterine GİRİŞ yazar (`TAMBUR_CUT` · `RESCUE`, `postStockMove`, 0 hariç koşulsuz); çocuğun geri alınması bunu `TAMBUR_UNDO` ile bağlı tersler; ebeveyn satır almaz.
- **[ÇEKİRDEK]** Mutabakat kırmızısı üçe ayrılır (kod hatası · iş kararı bekleyen veri · sorgu kör noktası); `test_consistency` salt-okunur, canlı DB'ye; eski sapma satırlarını toplu UPDATE ile düzeltme, §13'ü DARALTMA; adım durumu verisine dokunma.
- **[ÇEKİRDEK]** "Sipariş Bağla" `workorder:write`; uyumsuz satır yalnız süpervizörde `order-links/override` (workorder:write AND roll:manual-adjust); kumaş farkı HER ZAMAN red; zincir tek tx değil (bilinçli).
- **[PROFİL]** Müşteri parti no (`Roll.labelBatchNo`) yalnız cari ayarı `tamburLabelBatchEnabled` açıkken kesimde yazılır (çözücü `tambur-customer-settings.helper`; kapalıyken değer → 400 `LABEL_BATCH_NOT_ENABLED`); çocuğa MİRAS geçmez; tablette değer iş emri boyunca yapışkan, gövdeye ayar kapalıyken hiç girmez; düzeltme `PATCH /rolls/:id/label` (labelDirty + audit).

## Backend

### Değişmezler

- **[ÇEKİRDEK]** Her kesim/bölme yolu istasyonun AUTO yeteneğini çocuğa kalıtımdan SONRA `copyStationCapabilitiesToRoll` ile yazar, ataya yazmaz; Top Kesme'de oturum istasyonu yalnız `kind = TAMBUR` ise sayılır.
- **[ÇEKİRDEK]** Elle doğan top (`createManualRoll`, `produceFinishedRoll`) oturum istasyonu `kind = TAMBUR` ise AUTO yeteneği `applyTamburCapabilitiesTx` ile alır.
- **[ÇEKİRDEK]** `SINGLE_RESTORE`: çocuk iptal, kaynak adıma dirilir, kapalı WO+kart yeniden açılır; kardeşlere dokunulmaz; kapanış sapmaları TERSLENMEZ; `RollError` yeniden açılmaz; ek izin/sebep istemez; arşivli kaynakta ön seçim yok.

### Yasaklar

- **[ÇEKİRDEK]** İş emri üretim çıktısı kümesi tek kaynak `helpers/produced-output.helper.ts`; liste ÇIKAN, detay `producedRolls` ve künye kümeyi `resolveProducedOutputWhere` ile sorar, `producedOutputWhere`ı (tanım/bekçi ikizi) doğrudan sorguya koymaz.

### Reçeteler

- **[ÇEKİRDEK]** "Konumu Düzelt": top IN_PRODUCTION + `currentStepId=hedef`, hedef adım ACTIVE, COMPLETED WO IN_PROGRESS'e dirilir, kart aktifleşir; geri taşımada hedef-sonrası kalite/kurşun kararları VOID, hareketler `revokedAt` ile geri alınır, SKIPPED→PENDING.
- **[ÇEKİRDEK]** Kesim çocukları `createdMachineId` damgası alır (controller `stamp?.machineId ?? req.device?.machineId`); eski kesimler geriye doldurulmaz.

## Tablet (mobil)

### Değişmezler

- **[ÇEKİRDEK]** Mobil filtre şeridi: `last7` bugünü içerir; özel aralık kısa yolu ezer; query anahtarı `itemLabel`/`now`dan bağımsız; gün sınırı cihaz yerel günü; filtre yoksa parametre üretilmez; Tambur'da modal kapanınca filtre sıfırlanır; tarih seçici paketi EKLENMEZ.
- **[ÇEKİRDEK]** Tablet yatay iki sütun, telefon dikey tek sütun; yön kilidi YOK (`orientation: default`).
- **[ÇEKİRDEK]** Ana kesim ve "Top Kesme" modalı TEK tercihi paylaşır (`recutMode = cutMode`); varsayılanlar KK1 manuel KAPALI, Tambur MANUEL [PROFİL]; bozuk disk değeri güvenli varsayılana; setter önce state sonra disk.
- **[ÇEKİRDEK]** Çok top okutan her ekran `trigger="tap"` (Hızlı İş Emri, Fason Sevk, KK1 etiket-doğrulama); tek okuyup kapananlar (Tambur, Kartela, refakat kartı) `auto`.
- **[PROFİL]** Kısa kesim → A1: bayrak+eşik FABRİKA ayarı; cihazda `tamburShortCutA1Override` (server|on|off, bilinmeyen→server); birleştirme tek yer `resolveShortCutConfig`; "on"da eşik cihazınki; override yalnız süpervizöre (`roll:manual-adjust || mobile:tambur-duzelt`).
- **[ÇEKİRDEK]** Kısa kesim kuralı TAMAMI `Tambur/shortCutQuality.ts`te (üç yol aynı fonksiyon); yalnız varsayılan kaliteyle ateşler; eşik üstünde yalnız otomatik A1 geri döner (`shortCutRevert`); A1 katalogda yoksa fail-closed.
- **[ÇEKİRDEK]** Tambur'da hata girişini `inspectionEnabled` çekmecesinden aç (kapalıysa düğme yok); karar rehberini her zaman göster.

### Yasaklar

- **[ÇEKİRDEK]** `NumpadHost` `autoActivate`'i aynı ekranda yalnız TEK alana ver; hedef boşalınca manuel modda metraja dönen effect korunur.
- **[ÇEKİRDEK]** Tüm istasyonlar okuma için HAL'i kullanır; `hardware.service.ts` mock'u geri getirilmez; simülasyon per-cihaz `simulate` bayrağı, donanım yoksa NET HATA.

### Tuzaklar

- **[ÇEKİRDEK]** Modal içinde sayı girişi `NumpadInput` + `useNativeKeyboard` (modalda `NumpadHost` yok).

### Reçeteler

- **[ÇEKİRDEK]** `AppModal` içinde ön-dolu metin kutusu `components/ModalTextInput.tsx`; `SimplePortal` mikrotask ertelemesi KALDIRILAMAZ; eşitleme koşulu `value` prop'unun değişmesi.

## Geçersiz kılınan kurallar — bunlara UYMA

- "Roll split SADECE Tambur'da" → split beş yoldan (fason kısmi sevk dahil).
- "Her çocuk Tambur adımını damgalar" → yalnız adıma bağlı üç yol; Top Kesme/fason çocuğu NULL.
- "Sebep `manualReasons.ts`ten" → DB `ReasonPreset`.
- "Kısa kesim bayrak+eşik cihazda" → fabrika ayarı + cihaz override.
- "Hiç açık parti yok → NULL" → `batch.autoCreateEnabled` açıksa sunucu açar.
- "KK1 auto kalır" → KK1 etiket-doğrulama `tap`.

## Çözülmüş çelişkiler

- Split beş yoldan doğar, `entrySource=TAMBUR_SPLIT` hepsinde ortak; kat için "fallback" denir, "miras" denmez.

## Açık sorular

- `RollError` açılışının Faz B sonrası hâli; kök split notunun yeniden yazımı — ayrıntı dosyasında.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`. Ayrıntı: `Teks-Erp/docs/BEKCI-HARITASI.md`.

Backend: `test_produced_output_resolve`, `test_tambur_fatura_cut`, `test_en_olcen_istasyon`, `test_tambur_cocuk_en_kaynagi`, `test_musteri_barkod_serisi`, `test_tambur_istasyon_yetenegi`, `test_client_token_collision`, `test_denetim_s2_paketi`, `test_e2e_full_flow`, `test_fold_catalog`, `test_fold_edit_and_label`, `test_kursun_bypass`, `test_kursun_unassigned_close`, `test_tambur_istasyon_suzgeci`, `test_manual_attributes_reason`, `test_manual_move_field_continuity`, `test_manual_move_qc_reversal`, `test_manual_props_claim_pin`, `test_manual_roll_undo`, `test_masterdata_guards`, `test_p2_inventory`, `test_p2_kk2reopen`, `test_phase1_uretim_hardening`, `test_phase3_stok_hardening`, `test_phase6_reporterror_concurrency`, `test_plan_deviation_scorecard`, `test_plan_deviation_undo`, `test_property_value_selection`, `test_raw_tambur_cut`, `test_reason_presets`, `test_recent_output_filters`, `test_rescue_stuck`, `test_roll_edit_unified`, `test_roll_label_cut_seed_snapshot`, `test_roll_movement_revoke`, `test_revoke_ast_aile`, `test_roll_qty_adjust`, `test_roll_relabel`, `test_roll_relabel_context`, `test_roll_variance`, `test_roll_warehouse_stamp`, `test_sack_status_invariant`, `test_stock_ledger_production_entry`, `test_scan_code_case`, `test_tambur_branch_info`, `test_tambur_cut_barcoded`, `test_tambur_cut_concurrency`, `test_tambur_cut_idempotency`, `test_tambur_finalize_wo_guard`, `test_tambur_manual_batch`, `test_tambur_manual_field`, `test_tambur_manual_produce`, `test_tambur_manual_roll`, `test_tambur_olcum_kaynagi`, `test_tambur_over_quantity`, `test_tambur_plan_gate`, `test_tambur_recent_output_filter`, `test_tambur_send_to_dye`, `test_tambur_undo`, `test_warehouse_fail_open`, `test_warehouse_ledger`, `test_wo_terminal_race`, `test_work_session_stamping`, `test_tambur_musteri_ayarlari`, `test_tambur_etiket_parti_no`

İstemci: `RelabelStation.test.tsx`, `tamburStationFilter.test.ts`, `BulkCancelRollsDialog.test.tsx`, `ReworkRollsDialog.test.tsx`, `qtyAdjust.test.ts`, `service.test.ts`, `tabs-regime.test.ts`, `WorkOrderCompleteDialog.test.tsx`, `cancelDecisions.test.ts`, `activity-utils.test.ts`, `ModalTextInput.test.tsx`, `RollCancelModal.test.tsx`, `rollHistoryFilter.test.ts`, `varianceReasons.test.ts`, `useFoldValues.test.tsx`, `LabelNamePreview.logic.test.ts`, `LabelNamePreview.test.tsx`, `labelNameSave.test.ts`, `resolveShortCutConfig.test.ts`, `shortCutQuality.test.ts`, `tambur.service.test.ts`

Kural maddelerinin bekçileri (ek): `test_manual_move`, `test_roll_operation_revoke`, `test_finalize_last_step`, `test_wo_terminal_guard`, `test_wip_scorecard`, `test_roll_fold_and_reason`, `test_quality_batch_flags`, `test_stock_ledger_tambur_undo`, `test_wo_target_color_guard`, `measurements.test.tsx`, `test_quality_scorecard`, `test_db_invariants`, `test_produced_buckets`, `test_consistency_derived`, `deviceSettingsStore.test.ts`, `BarcodeScannerView.test.tsx`, `test_roll_defect_single_gateway`, `TamburDefectDrawer.test.tsx`, `TamburFinalLabelStrip.test.tsx`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- `docs/kurallar/ayrinti/tambur.md` § Arşiv notları.
