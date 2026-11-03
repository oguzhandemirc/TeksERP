# Kurşun planlama · Bypass
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/kursun.md`.

Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

## Ortak (backend + panel + tablet)

### Değişmezler

- **[ÇEKİRDEK]** Dağıtımsız kapanış yalnız bayrak AÇIK **ve** adım bypass'a UYGUN iken; tek kapı `resolveUnassignedTamburClosure`, `assertKursunTabletMayWrite` ile AYNI kaynaktan beslenir; bayrak koşulu load-bearing.
- **[ÇEKİRDEK]** Plan makinesi (`RouteStep/WorkOrderStep.plannedMachineId`) yalnız ÖNERİ: dağıtım/tablet yazma/kapanışı ENGELLEME, atıf (`RollMovement.machineId`) için KULLANMA; makine istasyona ait + aktif (`helpers/planned-machine.helper.ts`); değişim atomik claim (açık adım + canlı İE).
- **[ÇEKİRDEK]** Uyarı/süzgeç YALNIZ `kursun.machineAssignMode=ASSIGNED_ONLY_WARN` iken (varsayılan SUGGEST): tablet oturum makinesine atanmış + atanmamış işleri listeler, başka makinede okutma uyarı + "yine de al" izi `KURSUN_FOREIGN_MACHINE_TAKE` (reopen yolunda da).
- **[ÇEKİRDEK]** Makine atama liste parçası ↔ okutma yüklemi TEK dosyada: `helpers/kursun-machine-assign.helper.ts`; sunucu COMPLETED adımda uyarmaz, tablet reopen sonrası `getStep` yanıtına bakar.

### Yasaklar

- **[ÇEKİRDEK]** Atıf UYDURMA: dağıtımsız kapanışta `RollMovement.machineId` NULL kalır; boşluk `listDistribution.unassignedClosures` → amber bantla GÖRÜNÜR.
- **[ÇEKİRDEK]** Kurşun istasyonu gramaj tablosu (gr/m `amount`, TEK varsayılan, silme yok → pasif) ve gram fiyatını YALNIZ `/api/station-capabilities/:id/kursun` yazar; "Kurşun uygular" = `StationProperty(KURSUN, AUTO)`; İE hedefi yoksa varsayılan ön seçilir (sapma değil).
- **[PROFİL]** `CariAccount.kursunDefaultValueId` İE formunda (panel + tablet) yalnız ÖN SEÇİM: müşteri değişince elle seçilmemiş gramaj geçer, elle seçim ezilmez; yalnız müşteri carisi + kurşun çeşidinin aktif değeri (400), yoksa istasyon varsayılanı.
- **[ÇEKİRDEK]** İstasyon/cari gram fiyatını yazan HER yol aynı tx'te `recordKursunGramPriceVersionTx` (`helpers/kursun-gram-price-version.helper.ts`) çağırır: değişince yeni sürüm (validFrom = şimdi), aynıysa yazım yok; sürüm güncellenmez/silinmez, kaldırma fiyatsız sürümdür.
- **[ÇEKİRDEK]** Gram fiyatı sürümlü istasyonu kalıcı silme 409 (`stationHardRemove` guard `kursunGramPriceVersionCount`); sürümü silme/cascade etme, istasyon pasife alınır.
- **[ÇEKİRDEK]** "Kurşun adımı mı" sorusunu istemcide YALNIZ sunucunun `isKursunStation` alanından cevapla (`KURSUN_DISPATCH_STATION_WHERE`den `markKursunStations`); `PROCESS_QC` yalnız alan yokken yedek; kurşunsuz rotada gramaj kutusu çizme, varsayılan ön seçme.

## Backend

### Değişmezler

- **[ÇEKİRDEK]** Bayrak YALNIZ yeni atamayı kapılar; rejim ATAMA SATIRINDA kalıcıdır, dağıtılmış iş emri bayrak kapansa da bypass ile biter.
- **[ÇEKİRDEK]** Sıralama iki kümede (bekleyen havuz · makine içi), ikisi de `WorkOrderStep.priority`yi aynı uçtan yazar; yeniden numaralama yalnız kendi kümesine dokunur.
- **[ÇEKİRDEK]** Kurşun tableti bayrak açıkken YALNIZ dağıtıma UYGUN adımda salt-okunur; tek kapı `assertKursunTabletMayWrite` beş tablet yazma yolunu kapsar; guard UI'ya güvenmez (offline kuyruk sonradan flush edilir).
- **[ÇEKİRDEK]** Uygunluk kuralı TEK KAYNAK: `resolveBypassBlockReason` + `loadBypassEligibilitySignals` (`listDistribution` toplu, tablet tekil); kopyalama.
- **[ÇEKİRDEK]** Marker `KURSUN_BYPASS_FINISHED:UNASSIGNED:<uuid>` `KURSUN_BYPASS_MARKER_PREFIX` BASE ön ekinden TÜRETİLİR, elle yazılmaz; tanıyıcılar `startsWith(BASE)`.
- **[ÇEKİRDEK]** Metre sapmasını okuma satırındaki politika kopyasından türet: karar tek kaynak `lib/kursun-meter-variance.ts` (tablet aynası bayt-eşit, SQL ikizi `kursun-meter-variance-sql.helper.ts`).
- **[ÇEKİRDEK]** İmza yalnız `RollMeterAck`'e yazılır; PIN kuyruğa/log'a/audit'e girmez; imza bekleyen sapma `finishStep`i WO kilidi altında 409'la tutar.
- **[ÇEKİRDEK]** Çıkış metresini stoğa yalnız okumadaki `stockMode = APPLY` ile ve okuma ETKİNKEN uygula; fark `KURSUN_EXIT_MEASURE` sapması (`sourceRefId` = okuma, artıda `initialQtyRaise`); ters yol aynı tx'te `reverseExitMeterStockTx`; tek yazar `helpers/kursun-meter-stock.helper.ts`.
- **[ÇEKİRDEK]** APPLY'ı yalnız top okumanın adımında `IN_PRODUCTION` ve iş faturasızken yap (değilse 409 `METER_STOCK_ROLL_LEFT_STEP` / `SERVICE_ALREADY_BILLED`); imza beklentisi kalkan okumayı adım kapanışı uygular; sonraki adım `qtyIn`i taze `currentQty`.
- **[ÇEKİRDEK]** DECLARED_IN tabanını yalnız `rollDeclaredInSql`den oku; `initialQty`yi yükselten yeni yazıcı `initialQtyRaise` doldurur.
- **[ÇEKİRDEK]** "İmza bekliyor" yüklemi yalnız `METER_SIGNATURE_MODES` (SUPERVISOR_PIN · OFFICE); SQL ve bellek ikizi aynı sabitten; OPERATOR_REASON'da sebep yazımda alınır, sonradan kayan fark "imzasız sapma"dır, adımı tutmaz.
- **[ÇEKİRDEK]** Adım özetinde `meter`/`rolls[].meter`i YALNIZ `kursun.meterCapture` OUT/IN_OUT iken ekle (OFF'ta bayt-aynı); kip/politika `resolveKursunMeterCapture`/`resolveKursunMeterPolicy`, taban `loadRollMeterBases` tek sorguda; açık kart listesine koyma.
- **[ÇEKİRDEK]** Dağıtımsız kapanışta atomik claim GEREKMEZ: `closeBypassMovementsTx`'in `exitedAt IS NULL` guard'ı + kapsam paritesi; idempotent tekrar izi marker (`findCompletedUnassignedClosure`).
- **[ÇEKİRDEK]** Bypass ataması istasyon özelliğinde MOD `AUTO` arar; `StationProperty` satırının varlığı YETMEZ.
- **[ÇEKİRDEK]** Gramaj görünümü YALNIZ `process-summary.helper.ts`ten türer; hedef gramaj `WorkOrderTargetValue` (damgayla sürümlü), sapma türetilir, engellemez; kâğıt gramajı `KursunBypassAssignment.propertyValueId`ye, tamamlanınca donar, RollOperation yazmaz.
- **[ÇEKİRDEK]** `PUT /work-orders/:id/target-values` ÖZELLİK KAPSAMLI: yalnız gövdedeki özellikler değişir, `valueId: null` kaldırır; boş liste yalnız eski istemci sözleşmesi ("hepsini kaldır").
- **[ÇEKİRDEK]** Gramajı SEÇİM özelliğinin çeşidi olarak tanımla (`FabricProperty.variantOfPropertyId` → Kurşun); defter `RollOperation.propertyValueId`; düzeltmede eskiyi damgala, yeni satır yaz.
- **[ÇEKİRDEK]** Kâğıt dağıtımında gramaj İSTEĞE BAĞLI; tamamlanınca donar, girilmediyse "gramaj bilinmiyor".
- **[ÇEKİRDEK]** Dağıtım makine listesi kabulle AYNI parçadan (`KURSUN_DISPATCH_STATION_WHERE`); Tambur listeye düşmez.
- **[ÇEKİRDEK]** Boot uzlaştırması yalnız EKLER: silmez, `description`/`module` EZMEZ, kimseye izin ATAMAZ; kaldırma/yeniden adlandırma bilinçli veri migration'ı ister.
- **[ÇEKİRDEK]** RBAC: `requirePermission(code)` → `req.user.permissions[]`; izin DOĞRUDAN kullanıcıya (`UserPermission`), ROL MODELİ YOK, tekrar kullanım `PermissionTemplate`; dağıtım izni `workorder:distribute`, mobil ikizi `mobile:kursun-dagitim`.

### Yasaklar

- **[ÇEKİRDEK]** `listOpenCards` filtresini uygunlukla GENİŞLETME; uygun olmayan adımlar listede kalır, sebep kart içi bilgi panelinde.
- **[ÇEKİRDEK]** İzin sayısını dokümana SABİTLEME (kanonik `permission-catalog.ts`); `20260801020000_kursun_bypass_permission_catalog` EMSAL DEĞİL, yeni izin için migration yazma.

### Tuzaklar

- **[ÇEKİRDEK]** Makine içi sıra `listDistribution`da JS ile (`sortByPlanOrder`), Prisma `orderBy` ile DEĞİL; kaynak `assignedAt asc`; satır düşerse sürükleme "geri zıplar".
- **[PROFİL]** `GET /kursun-bypass/visibility` TARİHSEL: yeni istemci çağırmaz, eski APK için durur; Swagger'daki görünürlük kuralı BAYAT.

### Reçeteler

- **[PROFİL]** `scripts/sync-kursun-bypass-permissions.ts` TARİHSEL: işi admin'e ATAMA + ön koşul teşhisi (bayrak · istasyon yeteneği · makineler); makineleri YARATMAZ.

### Kararlar

- **[PROFİL]** `PATCH /kursun-qc/queue/reorder` üç izni kabul eder: `quality:write` ∨ `workorder:distribute` ∨ `mobile:kursun-dagitim`; daraltma.
- **[PROFİL]** Tambur okutması dağıtılmamış kurşun adımını da kapatır: atama yoksa `findPendingForTambur` SANAL bekleyen (`source:"UNASSIGNED"`), `completeUnassignedFromTambur` kapatır.
- **[ÇEKİRDEK]** Alt CLAUDE'daki RBAC modül TABLOSU bayat (FINANCE yok; `mobile:siparis`, `mobile:kumas`, `mobile:tambur-duzelt`, `mobile:kk1-yari-mamul` eksik): güncelle ya da kaldır, kanonik liste dosyada.

## Panel (Electron)

### Değişmezler

- **[PROFİL]** `production.kursunBypassEnabled` REJİM anahtarı, görünürlük değil: karo izinle (`quality:write` ∨ `workorder:distribute`; mobil `mobile:kursun-dagitim`) ve modül kapısıyla (`production.enabled` → `isKursunPlanningVisible`, ikizi `requireProductionEnabled`) süzülür.
- **[ÇEKİRDEK]** Her makine panelinin KENDİ `DndContext`'i; makineler arası sürükleme yok, makine değiştirmek yeniden ATAMA'dır.

### Reçeteler

- **[ÇEKİRDEK]** Sekme şeridi MAKİNE listesinden doğar: işsiz makinenin de sekmesi var, pasif ama açık işli makine `(pasif)` etiketiyle çizilir.

### Kararlar

- **[PROFİL]** Kurşun sırası + dağıtımı TEK ekran (`/operations/kursun-dagitim`); `operations/kursun-queue` oraya yönlenir; ikinci kurşun ekranı açma.

## Tablet (mobil)

### Değişmezler

- **[ÇEKİRDEK]** Salt-okunur kararını SUNUCU verir (`StepSummary.tabletReadOnly` + `bypassAssignment`), istemci yazma yüzeyini çizmez; backend + Electron + APK aynı pencerede gider.
- **[PROFİL]** Brode "Adet" girişini YALNIZ `pieceInput` gelince çiz (sayaç açık + `BRODE` + `finance.serviceBilling.brodeUnit` PIECE/STITCH; `brodePieceInputOf`); adet `meterOut.pieceCount`e; boş adette dur; METER/eski backend'de alan yok.
- **[ÇEKİRDEK]** Sayacı kuyruğa KALICI yazımdan sonra ve sapma modalı kapalıyken sıfırla (`resetCounterAfterDurable` + `persistStationQueueNow`); OFF'ta `completeQc2` gövdesine `meterOut` yazma; PIN yalnız çevrimiçi `pin-ack` gövdesinde.
- **[ÇEKİRDEK]** Doğrulanmamış RESETTING sayacın sonraki okumasını metre sayma; cihaz başına kalıcı "sıfırlanmadı" işaretiyle elle yola düşür; sunucu sayaç değerini reddederse aynı dokunuşu aynı değerle elle/sebep modalında sürdür.

## Geçersiz kılınan kurallar — bunlara UYMA

- **TAM** "İşi kaldıysa görünür" iki ekran kuralı öldü: tek ekran; `visibleWhen` yüklemleri, `KursunQueue/`, `KursunQueueRouteGate`, `useKursunVisibility` SİLİNDİ; karo izne bakar.
- **KISMI** "Karo bayraktan bağımsız" yalnız rejim bayrağı için doğru; karoda modül kapısı var (`isKursunPlanningVisible` → `production.enabled`; backend `requireProductionEnabled`).
- **KISMI** Rejim kilidi kaldı ama "dağıtım yapılmadan iş ilerlemez" ön koşulu kalktı (`resolveUnassignedTamburClosure`).
- **TAM** İzin başına veri migration'ı/elle INSERT pratiği öldü: yeni izin yalnız `permission-catalog.ts`; boot uzlaştırması (`permission-catalog.job.ts`) + `test_permission_catalog.ts`.

## Çözülmüş çelişkiler

- `kursun-bypass.routes.ts` Swagger görünürlük bloğu bayat; uç emekliye dek "TARİHSEL, yeni istemci kullanmaz" şerhi düşülmeli.
- İzin sayısı tabloya/metne yazılmaz; alt CLAUDE RBAC tablosu bayat.

## Açık sorular

- `GET /kursun-bypass/visibility` ne zaman silinebilir (sahadaki en eski APK ölçülmedi)?
- `sync-kursun-bypass-permissions.ts` katalog upsert'i taşıyor; kaldırma kararı yok.
- audit/00-map bayrağı `kursun.bypassEnabled` diyor; kanonik `production.kursunBypassEnabled`.

## Doğrulama turu ekleri (eski CLAUDE.md ↔ yeni yapı karşılaştırması, 2026-09-05)

- **[ÇEKİRDEK]** `repointPendingBypassAssignmentsTx`: TRANSFER'de bekleyen bypass ataması yeni WO'ya taşınır, split'te void; force-void'den ÖNCE koşar, `workOrderId`+step birlikte eşlenir.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`. Ayrıntı: `Teks-Erp/docs/BEKCI-HARITASI.md`.

Backend: `test_station_default_targets`, `test_audit_followups`, `test_consistency_derived`, `test_e2e_full_flow`, `test_kursun_bulk`, `test_kursun_bypass`, `test_kursun_bypass_repoint`, `test_kursun_gramaj`, `test_kursun_gram_fiyati`, `test_kursun_gram_gecmisi`, `test_kursun_machine_assign`, `test_kursun_metre`, `test_sarf_stok_defteri`, `test_kursun_metre_stok`, `test_en_olcen_istasyon`, `test_kursun_sapma`, `test_kursun_adim_sayac`, `test_process_summary`, `test_kursun_machine_order`, `test_kursun_planned_machine`, `test_kursun_regime_lock`, `test_kursun_unassigned_close`, `test_manual_move_field_continuity`, `test_manual_move_qc_reversal`, `test_p2_kk2reopen`, `test_property_value_selection`, `test_qc2_idempotency`⚠️, `test_station_property_mode`, `test_wo_target_color_guard`, `test_hizmet_fatura`

Madde içi: `test_guarded_hard_remove`, `test_gelen_belge_formdan_is_emri`, `test_station_quality_capability`, `test_permission_catalog`, `test_brode_fiyat_birimi`

İstemci: `machine-tabs.test.ts`, `queue-reorder.test.ts`, `selection.test.ts`, `production-regime.test.ts`, `tile-visibility.test.ts`, `command-entries.test.ts`, `GramajTapPanel.test.tsx`, `kursun-station.test.ts`, `belge-kayit.test.tsx`, `useWoRows.test.tsx`, `KursunStepFields.test`, `brodePiece.test.tsx`, `meterCapture.test.tsx`, `meterRecovery.test.tsx`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-08-05 — KURŞUN PLANLAMA: iki ekran birleşti + bayrak REJİM anahtarı — `CLAUDE-NOT-ARSIVI.md:103-120`
- 2026-08-06 — DAĞITIM İŞİN ÖN KOŞULU DEĞİL: Tambur okutması kurşunu dağıtımsız kapatır — `CLAUDE-NOT-ARSIVI.md:121-133`
