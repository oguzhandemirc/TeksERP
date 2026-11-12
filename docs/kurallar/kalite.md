# Kalite · İstasyon yeteneği

> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/kalite.md`.

> Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi. Bekçi eşlemesi maddelerde değil, en alttaki Bekçiler bölümünde.


## Ortak (backend + panel + tablet)


### Değişmezler

- **[ÇEKİRDEK]** `ProductionStationsPage` formdaki HER `StationKind`ı listeler/dışa aktarır; küme `visibleStationKinds.ts`te `stationFormSchema.shape.kind.options`tan türetilir, sabit allowlist YOK; tek gizleme `FLAG_GATED_STATION_KINDS` (WEAVING dokuma kapalıyken çizilmez, kayıt korunur).
- **[ÇEKİRDEK]** Liste görünümü (tercih `localStorage` `stations.viewMode`) ve dışa aktarım `stationMachineRows.ts` satırlarından çizilir; satır aksiyonu tek bileşen `MachineRowActions`; "Diğer" (OTHER) en sonda; `stationKindDefaults.ts` yalnız YENİ kayıtta öneridir, düzenlemede yetenekleri ezme.
- **[ÇEKİRDEK]** Tipsiz hata girişi `DefectType.isDefault` tipine düşer (en fazla bir, partial unique `defect_types_one_default`); yoksa 400, istemci ilkini uydurmaz. Değişim tek tx `setDefaultDefectTypeTx` (`POST /api/defect-types/:id/set-default` ya da form `isDefault:true`).
- **[ÇEKİRDEK]** `RollError` satırını YALNIZ `services/helpers/roll-defect.helper.ts` yazar (`recordRollDefectTx` · `recordRollDefectsTx` · `insertInspectionDefectsTx` yalnız `createInspectionTx`ten); kapı/konum/tip/mükerrer 409 orada; audit tx dışında.
- **[ÇEKİRDEK]** 'Bu adım KK yürütür mü' TEK kaynağı `services/helpers/quality-station.helper.ts`; ikiz `stepCanApplyQuality(station)` ↔ `QUALITY_STATION_WHERE` aynı kuralı söyler, birlikte değişir. Yeni `kind === PROCESS_QC` karşılaştırması YAZMA.
- **[ÇEKİRDEK]** Yetenek istasyonun KENDİ alanıdır: `Station.appliesColor` (false) / `appliesProperty` (true) / `appliesQuality` (false); yüklemler `stepCanApplyColor/Property(station, requiredCategory)` ve tek argümanlı `stepCanApplyQuality` — kategoride kalite karşılığı YOK.
- **[ÇEKİRDEK]** Yetenek bayrağı planlamayı ('yapabilir') yanıtlar; fason KABULDE fiilen uygulanan renk/özellik sevkin `requiredCategory` bayrağından ('yaptı') okunur (`subcontractor.service`). İkisini BİRLEŞTİRME.
- **[PROFİL]** 'Kurşun ile KK2 aynı istasyonda' (`StationKind.PROCESS_QC`, tek `WorkOrderStep`) adnansahin topolojisidir; yeni yüzey bu birlikteliğe yaslanmaz.
- **[ÇEKİRDEK]** Per-roll iz `RollOperation` `KURSUN_APPLIED` / `QC2_COMPLETED`; kurşun bypass'ta bu satırlar YAZILMAZ ve RollError açılmaz.
- **[ÇEKİRDEK]** `RollError` Tambur kararıyla kapanır: `isProcessed = true` + `actionTaken = CUT|NO_CUT`; redye/parti ayırmada Tambur DIŞINDA `NO_CUT` idari kapanış olabilir.
- **[ÇEKİRDEK]** Her rotanın SON adımı finalize eder (`finalizeRollsAtLastStep`), Tambur özel değil: `currentStepId=null`, `form=ACIK`, açık kumaşa barkod ('F'/'H'); `qualityGrade` NULLABLE, kalite istasyonu belirler; `PRODUCED` limbosu YOK; WO depo topunu (WAREHOUSE/A1_STOCK) da tüketir.
- **[ÇEKİRDEK]** Tambur = kesim/bölme + kalite kararı, 'final ürün kapısı' değil; depo istasyon değil, `RollStatus.WAREHOUSE` bekleme statüsü; ham top kesiminde parça `STOCK` seçilebilir.
- **[PROFİL]** Kök 'Üretim Akışı' (KK1→[fason]→Kurşun+KK2→Tambur→Depo→Çuval→Sevk) adnansahin rotasıdır, zorunlu akış değil; adımlar istasyon kataloğu + rota şablonundan kurulur. Devere/çözgü/haşıl yeni mimari istemez; dokumanın tek tasarım işi 'top TEZGAHTAN doğar' damgası.
- **[ÇEKİRDEK]** Renk istasyon kısıtı DEĞİL: rota adımı renk seçicisi tüm aktif renk kataloğunu gösterir; `StationColor` deprecated, FİLTRE olarak okunmaz (yalnız DTO geriye-uyumu); 'renk veren adım' tek yüklem `stepCanApplyColor` — ikinci renk filtresi EKLEME.
- **[ÇEKİRDEK]** `StationProperty` proses kısıtıdır (planlama filtresi + `copyStationCapabilitiesToRoll`); yeni `FabricProperty` `stationIds` ZORUNLU, bağ aynı insert'te (`nestedCreateFields`); update'te verilmezse bağa dokunma, boş dizi 400; create/replace simetrik; 'özellik veren' ≠ 'ŞU özelliği veren'.
- **[ÇEKİRDEK]** Rota şablonu HEDEF saklar (`RouteStep.plannedColorId` + `RouteStepProperty`), hedef öneridir; WO'ya SON renk veren adım kazanır, özellikler birleşir; renk sorgusu adım kategorisini (yoksa istasyon varsayılanını) okur; düz ID dizisi; istasyon değişince hedef SIFIRLANIR.
- **[ÇEKİRDEK]** Koşullu etiket (`showIf`): koşul ELEMANDA, değer `QualityGrade.code` (ad değil); kalitesiz topta basılmaz (fail-closed); tek uygulama `prepareElements` — yeni emitter `expandMultilineText`i doğrudan çağırmaz; koşullu alan bağlam kimliği sayılmaz.
- **[ÇEKİRDEK]** Fason dönüş: kabulde orijinal toplar `SUBCONTRACTOR_CONSUMED`; `parentReceiptId`'li YENİ açık-kumaş Roll doğar (`entrySource=SUBCONTRACTOR_RETURN`, barcode null); metraj ZORUNLU, ağırlık opsiyonel; kesin ölçüm sonraki istasyonun FINISH'inde.

### Yasaklar

- **[ÇEKİRDEK]** Kurşun→KK→Tambur rotası kurulabilir; kurşun bypass'ı yalnız sonraki adım Tambur iken uygun say (R3) — araya KK girerse dağıtım kart akışından yürür.
- **[ÇEKİRDEK]** Akış sorusunu `stepRunsStepFlow`, muayene sorusunu `stepCanApplyQuality` (`inspectionEnabled`) ile sor; karıştırma.
- **[ÇEKİRDEK]** Tablet ekranını istasyon TÜRÜNDEN seç, ekran içi panelleri yetenekten kur (`mobil/.../KursunQc/stationPanels.ts`).
- **[ÇEKİRDEK]** KK1'de `inspectionEnabled` yalnız oturum ekranında muayeneyi açar; iş emri adımına etkisi yok.
- **[ÇEKİRDEK]** Açık hataya kararı kalite adımından sonraki ilk `stepDecidesDefects` adımı (bugün Tambur) verir; yoksa rota/İE kaydı UYARIR, hatalar `openDefects` etiket alanı + irsaliye "Hata notu" sütunuyla (OPT-IN) bilgi olarak taşınır; finalize hatalara dokunmaz, sevk rakamı değişmez.

### Tuzaklar

- **[PROFİL]** Hatanın açıldığı istasyon profildir (bugün PROCESS_QC/TAMBUR bağlamı); `roll_errors_roll_meter_defect_uq` çok-istasyonda 409 riski taşır (Faz B R5) — açıldığı istasyona yaslanan yüzeyden önce Faz B listesine bak.

### Kararlar

- **[ÇEKİRDEK]** Faz B AÇIK — türe bağlı kalanlar: bypass 'sonraki TAMBUR' (R3), mobil ekran kind→ekran (R4, K4: ekran türden, paneller yetenekten), RollError açılışı (R5, KQ-D7), dashboard ham SQL (R6), `QC2_COMPLETED` (R9), son-adım dalı (R10). Talepsiz değiştirme; "kapandı" yedi sayım 0 iken.
- **[PROFİL]** Seed kalite hedefleri: 1.KALİTE ve A1 → WAREHOUSE, FİRE → SCRAP. Kalite kodunu koda gömme (`code === 'FIRE'` yasak); kova `targetStatus`/katalogdan çözülür.

### K4P — Kalite Güvence

- **[ÇEKİRDEK]** Muayene derecesini `QualityGrade` kataloğundan seç; paralel derece tablosu açma (A/B/C bant etiketidir).
- **[ÇEKİRDEK]** Muayene hatasını `RollError origin=INSPECTION` olarak yaz; paralel hata tablosu kurma.
- **[ÇEKİRDEK]** Müşteri spesifikasyonunu yalnız görünüm/rapor hesabında kullan; muayene kaydına ve dereceye yazma.
- **[ÇEKİRDEK]** Modül kapalıyken (`kaliteGuvence.enabled`, varsayılan KAPALI) INSPECTION satırı doğurma; kapı `requireKaliteGuvenceEnabled` / `readKaliteGuvenceEnabled`.
- **[ÇEKİRDEK]** KK1 operatör şablonuna yalnız `mobile:muayene` ver; `inspection:*` · `labtest:*` · `certificate:*` panel girişi açar, yalnız sorumlu/şef (`WEB_*`) şablonlarına girer.
- **[ÇEKİRDEK]** `RollInspection`ı silme/içeriğini güncelleme; düzeltme revizyon (`supersededAt` + yeni satır), iptal `voidedAt`; (top, faz) başına tek aktif belge `roll_inspections_one_active_uq`.
- **[ÇEKİRDEK]** `RollError.startMeter`ı PROCESS yolunda `requireProcessMeter`/`processMeterNumber` (`helpers/roll-error-meter.helper.ts`) ile daralt; `Number(e.startMeter)` yazma (NULL sessizce 0 olur).
- **[ÇEKİRDEK]** Lab testi onayda donar; sonuç yazımı `status='DRAFT'` atomik WHERE'i (`claimDraftTx`); iptal gerekçeli `voidedAt`, fiziksel silme yalnız DRAFT'ta. Lab gramajını topa/istasyona yazma.
- **[ÇEKİRDEK]** Sertifika süresi tek helper `certificateExpiryWhere` (`expiresOn` karşılaştırması yalnız `helpers/certificate-active.helper.ts`); panel ve bildirim onu çağırır. Belge türünü sihirli bayttan belirle, mime'a güvenme; baytları audit/log'a koyma.
- **[ÇEKİRDEK]** Lab sınırını `resolveCustomerLabSpec` sırasıyla çöz (elle → müşteri+ürün → müşteri → tür varsayılanı) ve satıra snapshot'la; spesifikasyon değişimi geçmiş testi değiştirmez.
- **[PROFİL]** Kalite Güvence karolarını `/quality` kataloğuna (`pages/Quality/tile-config.ts`) koy; bayrak kapalıyken `offHint: KALITE_GUVENCE_OFF_HINT` ile yalnız süperadmine soluk çiz, diğerlerine gizle.
- **[ÇEKİRDEK]** Kararda RollError'ı `roll-error-scope.helper`den oku (`ACTIONABLE_ROLL_ERROR_WHERE` · `isActionableRollError` · `ACTIONABLE_ROLL_ERROR_SQL`); muayene hatası Tambur'a girmez, KK2/Tambur ucundan silinmez (400 `INSPECTION_ERROR_IMMUTABLE`); iki kökeni gören yol `scripts/lib/roll-error-kapsam-beyan.ts`te.
- **[ÇEKİRDEK]** Muayeneyi YALNIZ `createInspectionTx` (`services/quality-inspection.service.ts`) yazar; panel, tablet, KK1 onu çağırır; `RollInspection`/INSPECTION hata satırını başka yerde yaratma.
- **[ÇEKİRDEK]** 4 puanı yalnız `helpers/four-point.helper.ts`ten hesapla (tavan · skor · birim · `round2` HALF_UP · bant); önizleme aynı `evaluateInspection`ı çağırır, ikinci formül yazma; derece eşiğini koda koyma, kural setinden oku, muayeneye snapshot'la.
- **[ÇEKİRDEK]** Muayene revizyonu/iptali eskiyi `updateMany WHERE {id, ...ACTIVE_INSPECTION_WHERE}` ile claim eder, `count===0 → 409 INSPECTION_NOT_ACTIVE`; aktiflik yüklemi `helpers/inspection-active.helper.ts` (`isActiveInspection` ikizi).
- **[ÇEKİRDEK]** Aktif 4 puan kural setinin bandındaki dereceyi pasife alma (409 `QUALITY_GRADE_IN_RULE_SET`); kural setini silme, pasife al — geçmiş muayene snapshot'tan okunur.
- **[ÇEKİRDEK]** Tablet muayenesi tek bileşen `InspectionPanel`; kaydetmeyi konak yapar, istemci `kind` okumaz; kapı tek yüklem `kk1InspectionVisible` (modül ∧ `inspection:write` ∧ `station.canInspect`); /100 m² ve öneri yalnız önizleme ucundan (KK1: `draft {itemId, widthCm?}`), formül aynası yazma.
- **[ÇEKİRDEK]** Bağımsız muayene ekranı türe bağlanmaz, `SCREEN_BY_STATION_KIND`e girmez; kapı modül ∧ `mobile:muayene`; aktif muayeneli topta yeni kayıt açma (`activeInspection` UX, sed 409); çevrimdışı kuyruğa yazma.
- **[ÇEKİRDEK]** Sevk muayene özetinde topun KENDİ aktif muayenesini (FINAL > RAW) oku, ebeveyne bakma; müşteri kuralı yalnız okumada ezer, `RollInspection`/`Roll.qualityGrade` yazılmaz; koşu tavanı farklıysa puanı yeniden hesaplama, dipnot düş.
- **[ÇEKİRDEK]** Rapor v2'de muayene sayısını yalnız `muayene` küpünden yayımla; küp `ACTIVE_INSPECTION_SQL` ile süzer ve `listInspections` summary ile aynı sayıyı verir.

## Backend


### Değişmezler

- **[ÇEKİRDEK]** Final statü `resolveFinalStatus(code, statusByCode)` → `QualityGrade.targetStatus`; kod yok/katalogda yoksa WAREHOUSE. Kolon default'u `targetStatus @default(SCRAP)` bilinçlidir, create'te zorunlu olduğu için uygulanmaz.
- **[ÇEKİRDEK]** `StationProperty.mode` AUTO|OPTIONAL|REQUIRED çalışma-zamanı davranışı (varsayılan OPTIONAL); kurşun bypass ataması AUTO arar, satırın varlığı yetmez; TAMBUR kat modu OPTIONAL.
- **[ÇEKİRDEK]** İstasyon yeteneği kesimle doğan topa da uygulanır (Tambur): AUTO yazılır, seçimsiz yolda OPTIONAL/REQUIRED yazılmaz, kalıtılan değer korunur.

### Yasaklar

- **[ÇEKİRDEK]** Kart okutmada (`getByCardBarcode`, `listOpenCards`) adımı oturum istasyonundan `helpers/station-step-resolve.helper.resolveWoStepForStation` ile çöz; oturumsuzda ilk akış adımı. `roll-step.helper.assertWoAtStepKind` gövdesine dokunma (Tambur kullanır; KIND_MUAF'ta kursun-qc YOK).

### Tuzaklar

- **[ÇEKİRDEK]** Faz A köprüsü: yüklem `kind === PROCESS_QC || appliesQuality` okur, backfill'e güvenmez; seed'e açıkça `appliesQuality: true` yaz. Faz B'de dal düşmeden seed + prod ölçümü ŞART.
- **[ÇEKİRDEK]** Seed ham prisma kullanır, `StationService` kategoriden tohumlamaz → yetenek bayraklarını (appliesColor/appliesProperty/appliesQuality) seed'de AÇIKÇA yaz; kolon varsayılanına güvenme.

## Panel (Electron)


### Kararlar

- **[ÇEKİRDEK]** 'Kalite kontrol uygular' kutusu HER istasyon türünde görünür, gizli kural icat etme. 'KK1 WO adımı olamaz' istemci sözleşmesidir (`allowAsWorkOrderStep` Electron seçicilerinde); backend guard ekleme.

## Tablet (mobil)


### Değişmezler

- **[ÇEKİRDEK]** Mobil oturumlu ekran türden seçilir: `SCREEN_BY_STATION_KIND` (RAW_QC→KK1, PROCESS_QC→KursunQc, TAMBUR→Tambur, SHIPPING→TartiPaket) backend `SESSIONABLE_STATION_KINDS` aynası, bijektif; bu tabloya yetenek sokma (Faz B R4).
- **[PROFİL]** Kurşunsuz kalite istasyonunu (Detaylı KK) ayrı tür açmadan kur: INTERNAL/PROCESS_QC + `appliesQuality` + `inspectionEnabled`, özellik yeteneği/makine yok; panel yetenekten, metin `flowScreenLabels`; kurulum `scripts/detayli-kk-kurulum.ts` (kuru koşu varsayılan).
- **[PROFİL]** Kurşun vermeyen muayeneli PROCESS_QC istasyonunu tablette "Kalite Kontrol" ekranında (KursunQc, kurşun kipi kapalı; izin `mobile:kk2-kursun`) aç: sunucu yer nesnesine `isKursunStation` (`KURSUN_DISPATCH_STATION_WHERE`, `kursunStationIdSet`) yazar, tablet TEK yüklem `isQualityOnlyStation` (`stationScreens.ts`) ile ayırır; alanı göndermeyen eski sunucuda Kurşun ekranı kalır. · bekçi: `test_work_session` §14 · `stationScreens.test.ts` · `kaliteKontrolKipi.test.ts` <sub>(arşiv:2026-11-10)</sub>
- **[ÇEKİRDEK]** Tambur 'Boyahaneye Geri Gönder': hedef adımı SUNUCU çözer (`/tambur/manual/send-to-dye-preview`, `stepCanApplyColor`); tablette yüklem yazma; önizlemesiz uygulama YOK, sebep ≥3; fason adımına taşıma AT_SUBCONTRACTOR yapmaz, çıkış Fason Sevk'ten.

### Yasaklar

- **[ÇEKİRDEK]** Mobil okuma yolu TEK: HAL (`src/services/hal/`); eski `hardware.service.ts` mock'unu geri getirme.

## Geçersiz kılınan kurallar — bunlara UYMA

- Rota adımı renk yeteneği bileşik `hasDefaultCategory && canApplyColor` DEĞİL, `stepCanApplyColor(station, stepCat)`; 'yoksa Tambur adımına renk yazılır' fallback'i KALKTI.
- Renk kilidinin kaynağı yalnız `requiredCategory.appliesColor` DEĞİL: istasyon bayrağı VEYA adımdaki fason hizmeti (`stepCanApplyColor`).
- 'KK yürütür mü' `kind === PROCESS_QC` ile sorulmaz; ikiz boğaz (`stepCanApplyQuality` ⟷ `QUALITY_STATION_WHERE`).

## Çözülmüş çelişkiler

- Kod 2026-08-10'u uygular: renk kararı `stepCanApplyColor(station, stepCat)`; `hasDefaultCategory` yalnız panel ipucu.
- `StationColor` filtre olarak okunmaz, DTO geriye-uyumu için okunur/yazılır.
- İkinci KK istasyonu tanımlanabilir, ama Kurşun→KK→Tambur rotasında bypass kapanır (Yasaklar R3).

## Açık sorular

- Arşiv şerhi yerleşimi, sayım drift'i ve bayat yorum atıfları: ayrıntı dosyasında.
- Faz A 'ikinci KK noktası' vaadi ↔ R3 kısıtının hangi belgeye yazılacağı kullanıcı kararı ister.

- **[ÇEKİRDEK]** Muayene ekranında puan/derece hesaplama; önizleme `POST /api/quality-inspections/preview`, özet şeridi liste yanıtının `summary`si; iptal düğmesi `void-preview` yanıtı gelmeden açılmaz.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`. Ayrıntı: `Teks-Erp/docs/BEKCI-HARITASI.md`.

Backend: `test_roll_defect_single_gateway`, `test_dort_puan_hesap`, `test_kk1_muayene_dogum`, `test_kalite_muayene`, `test_muayene_sevk_ozeti`, `test_muayene_raporu_sozlesme`, `test_kalite_kural_seti`, `test_role_template_catalog`, `test_k4p_sema_sedleri`, `test_roll_error_kapsam`, `test_roll_error_kapsam_db`, `test_lab_test`, `test_sertifika`, `test_sertifika_suresi_tek_kaynak`, `test_module_flag_off`, `test_default_defect_type`, `test_station_step_resolution`, `test_detayli_kk_istasyonu`, `test_panel_station_kind_aynasi`, `test_finalize_last_step`⚠️, `test_helpers`, `test_iade_enhancements`, `test_label_element_condition`, `test_manual_move_backflush`, `test_manual_move_qc_reversal`, `test_null_quality_visibility`, `test_p2_kk2reopen`, `test_phase1_uretim_hardening`, `test_phase3_stok_hardening`, `test_phase6_reporterror_concurrency`, `test_produced_buckets`, `test_qc2_idempotency`⚠️, `test_quality_batch_flags`, `test_quality_code_literal`, `test_quality_role_catalog`, `test_quality_scorecard`, `test_scrap_grade_label`, `test_scrap_scorecard`, `test_station_quality_capability`, `test_wo_manual_complete`, `test_screen_catalog`, `test_mobile_screen_permissions`

Kurallarda anılan ek: `test_station_capability`, `test_route_step_targets`, `test_property_station_binding`, `test_fason_receipt_color_width`, `test_kursun_bypass`, `test_kursun_regime_lock`, `test_e2e_full_flow`, `test_fason_partial_receive`, `test_rota_hata_karari_uyarisi`, `test_label_open_defects`, `test_sevk_belge_altin`, `test_defter_ters_yol`, `test_semantik_sayi_esitligi`, `test_tambur_istasyon_yetenegi`, `test_property_targetable`, `test_property_value_selection`

İstemci: `WorkOrderCompleteDialog.test.tsx`, `shortCutQuality.test.ts`, `visibleStationKinds.test`, `stationKindDefaults.test`, `stationKindVisibility.test`, `LabTestsHubTile.test.tsx`, `hub-off-hint.test.ts`, `Quality/Inspections/InspectionDialogs.test.tsx`, `Quality/Inspections/*.test.ts(x)`, mobil `components/inspection/*.test.ts(x)`, `InspectionPanel.source.test.ts`, `KK1/kk1InspectionHost.test.ts`, `Muayene/*.test.ts(x)`, `Muayene/InspectionScreen.test.tsx`, `stationScreens.test.ts`, `useVisibleScreens.test.ts`, `KursunQc/stationPanels.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-08-02 koşullu etiket `showIf` — `CLAUDE-NOT-ARSIVI.md:36-44`
- 2026-08-06 filtrelerde çoklu seçim — `CLAUDE-NOT-ARSIVI.md:296-306`
- 2026-09-03 Kalite = istasyon yeteneği (P4 Faz A) — `arsiv/2026-09.md`
