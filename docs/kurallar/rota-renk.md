# Rota · Renk · Özellik · Kapsama
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/rota-renk.md`.

Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

## Ortak (backend + panel + tablet)

### Değişmezler

- **[ÇEKİRDEK]** 'Adım renk/özellik verebilir mi' TEK yüklem `stepCanApplyColor`/`stepCanApplyProperty` (istasyon bayrağı VEYA adımın fason hizmeti); rota hedefi, WO kapsama, renk kilidi, taşıma, split, kursunFinish, send-to-dye onu kullanır; tekil `requiredCategory.appliesColor` / `kind===` YASAK.
- **[ÇEKİRDEK]** `StationProperty` gerçek proses kısıtıdır, boş doğmaz: `FabricProperty` create'te `stationIds` zorunlu, bağ aynı insert'te (`nestedCreateFields: stationCapabilities`); update'te verilirse replace, verilmezse dokunma; boş dizi iki yolda da 400.
- **[ÇEKİRDEK]** `StationProperty` satırının varlığı 'verebilir' der (planlama filtresi + `copyStationCapabilitiesToRoll`); `mode` AUTO|OPTIONAL|REQUIRED (varsayılan OPTIONAL) yalnız teyit biçimi; OPTIONAL kapsam dışı değil; kurşun bypass AUTO arar; SEÇİM özelliği AUTO olamaz.
- **[ÇEKİRDEK]** Hedef/Düzelt replace'leri yalnız FLAG satırlarına dokunur (`property: { valueType: "FLAG" }`); CHOICE satırını `propertyIds=[]` bile silmez. Seçim `RollProperty.valueId`de; kesim/finalize/undo/fason çocukları valueId'yi taşır.
- **[ÇEKİRDEK]** Kat değeri kolonda (`Roll/WorkOrder/ProductRecipe.foldType`); biçim `normalizeFoldType` ↔ geçerlilik `resolveFoldTypeForWrite` ayrı; katalog boşsa FAIL-OPEN, pasif değer yazmada kabul; metre cihazı kat rolüyle birebir eşleşir, yoksa `null` (başka cihaza sapmaz).
- **[ÇEKİRDEK]** Rota şablonu adım başına hedef saklar (`RouteStep.plannedColorId` + `RouteStepProperty`); hedef öneridir, kilit değil (`WorkOrder.targetColorId` ile karıştırma); tek kopyalayan istemcinin 'rotayı uygula'sı (`seedFromRoute`/`applyRouteTarget`/`chooseRoute`).
- **[ÇEKİRDEK]** Sipariş bağlı iş emrinde hedef renk/özellik sipariş satırından türer (`resolvedTargetColorId = onlyColorId`, `orderLineRequiredProperty`); rota şablonu hedefi renge dokunmaz.
- **[ÇEKİRDEK]** Rota→WO: son renk veren adım kazanır, özellikler birleşir; WO→rota (`deriveStepTargets`) istasyon yeteneğiyle süzer; adımın istasyonu değişince hedef sıfırlanır; adım güncellemesi deleteMany+create → pivot CASCADE şart.
- **[ÇEKİRDEK]** Hedef renk değişikliğinin iki kapısı tek bekçi `assertTargetColorChange`: terminal statü (`PLAN_CHANGE_FROZEN_STATUSES` → 409 `WO_PLAN_FROZEN`) → renk aktif → `Item.allowedColors` (boş = sınırsız) → mal–plan uyumu → kapsama uyarısı.
- **[ÇEKİRDEK]** Renk kilidi MALA bakar: mismatch=0 serbest · mismatch>0 & pending>0 → 409 `COLOR_PARTIAL_CONFIRM` (`confirmPartial`) · pending=0 → 409 `COLOR_DYED_BLOCKED`. `computeWorkOrderLocks.targetColor` yalnız Düzenle formunu pasifleştirir; COLOR_LOCKED yok.
- **[ÇEKİRDEK]** Fason kabulde hedef renk kilit altında taze; `expectedTargetColorId` farklıysa 409 `TARGET_COLOR_CHANGED` (alan yoksa kontrol yok); plandan farklı renkte tek soru `planColorAction`: APPLY_TO_PLAN · ROLLS_ONLY (`RollPlanDeviation`).
- **[ÇEKİRDEK]** Tambur plan-sapma: renk/en sapan top (`tambur.planGate.widthToleranceCm` varsayılan 10; `widthCheck` OFF en kolunu atlar; eşit fark sapma değil) 409 `PLAN_MISMATCH` → `confirmMismatch`; top başına bir soru; helper `tambur-plan-gate.helper`; scrap/discard + renk-hedefsiz WO dışı.
- **[ÇEKİRDEK]** Plan sapması kalıcı deftere (`RollPlanDeviation`) yazılır, audit'e değil; granülerlik onaylı geçiş × sapan alan; `confirmationId` çift-sayım kilidi; `field` string, pg enum değil.
- **[ÇEKİRDEK]** Kalite = istasyon yeteneği, boğaz ikiz: `stepCanApplyQuality(station)` + `QUALITY_STATION_WHERE` (`satisfies`; spread'e ikinci `OR` yok); saf yüklem WHERE'e girmez; ikisi birlikte değişir; yeni `kind===PROCESS_QC` yazma.

### Yasaklar

- **[ÇEKİRDEK]** SEÇİM (CHOICE) özelliği hedef olamaz: aktif uçlar `assertTargetablePropertyIds` (400), echo uçları `partitionTargetableIds` (sessiz ayırma); istemci `isTargetableProperty` yalnız konfor.

### Tuzaklar

- **[ÇEKİRDEK]** Özellik-BAŞINA kapsama hâlâ sert: create 400, replace/updateTargetProperties 409 (`locks.applicablePropertyIds`); `goods` muafiyeti uygulanmaz; 'uyarı' kararı yalnız kategori düzeyidir.

### Reçeteler

- **[ÇEKİRDEK]** Yeni tarihli not arşive (`docs/history/arsiv/<YYYY-MM>.md`); köke yalnız `[ÇEKİRDEK]`/`[PROFİL]` etiketli özet satırı; alana dokunmadan önce arşivdeki tam not okunur.

### Kararlar

- **[ÇEKİRDEK]** Kategori düzeyi rota kapsaması reddetmez, UYARIR: create · replace · 'Rengi Değiştir' tek kural (`collectRouteCoverageWarnings`), `ApiResponse.warnings`; `quickStart` uyarıları taşır; metin NE eksik + SONUÇ.
- **[ÇEKİRDEK]** Karar adımı olmayan kalite rotasını uyar, engelleme; rota create/update ve İE create/replace aynı helper (`defect-decision.helper`).
- **[ÇEKİRDEK]** `OrderLineTargetValue` yalnız çeşit özelliğine verilir, bayrak ikizini `requiredProperties`e kendiliğinden ekler; satır varyantı (`recipeId`) satırın ürününe ait değilse 400 `RECIPE_ITEM_MISMATCH` (`helpers/order-line-target-value.helper.ts`, `helpers/line-recipe.helper.ts`).
- **[ÇEKİRDEK]** Sipariş içe aktarımında varyant `(itemId, variantCode)` ile çözülür; bulunamayan/belirsiz/pasif varyant satır hatasıdır; `ÖZELLİK=DEĞER` sütunu `assertTargetValueItems`ten geçer (`import/adapters/order-line-extras.ts`).
- **[ÇEKİRDEK]** İE doğarken hedef değerleri yalnız `deriveOrderLineTargetValues` kopyalar; bağlı satırlar özellikte ayrışırsa kopyalama, `[TARGET_VALUE_CONFLICT]` uyar, İE'yi yine doğur; gövde açık hedefi üstündür (`helpers/order-line-target-copy.helper.ts`).
- **[ÇEKİRDEK]** İE rota adımı ön seçimi yalnız `helpers/station-default-targets.helper` (`GET /api/station-capabilities/default-targets`): AUTO/REQUIRED bayrak hep, OPTIONAL "varsayılan açık"sa; değer müşteri > yetenek varsayılanı > `isDefault`; panel/tablet kural yazmaz, kullanıcı seçimini ezmez.
- **[ÇEKİRDEK]** Belgeden İE'de değer yalnız gövdeden gelir (anahtarsız gövde = değer yok; istemci `targetValues`ı hep açık gönderir); bayrak + kat tek/çok partide çözücüden.

## Backend

### Değişmezler

- **[ÇEKİRDEK]** Fason kabul 'fiilen uygulandı'yı `requiredCategory` bayrağından okur; istasyon bayrağı 'yapabilir', kategori 'yaptı' der — birleştirme.
- **[ÇEKİRDEK]** Rota adımı renk yeteneğinde adımın kategorisi de okunur; seçilmemişse istasyonun varsayılan kategorisi.
- **[ÇEKİRDEK]** 'Boyahaneye Geri Gönder' hedefini sunucu çözer (`/tambur/manual/send-to-dye-preview` → `send-to-dye`): `stepCanApplyColor`, mevcut adımdan önceki en yakın boya adımı; yoksa 400 `NO_DYE_STEP_IN_ROUTE`; `AT_SUBCONTRACTOR` yazılmaz.
- **[ÇEKİRDEK]** KÜME DIŞI (backend): Routes → Controllers → Services → Prisma; route/controller'da `lib/prisma` import YASAK; ince read/ayar uçları bilinçli controller'sız; `admin.routes.ts:53` yasağı deliyor.
- **[ÇEKİRDEK]** KÜME DIŞI (backend): yedek ön ekleri `backup-naming.helper.ts` tek kaynak: `tekserp_` rotasyona girer, `premigrate_`/`pre-restore_` girmez; cutoff = min(ad damgası, mtime); `BACKUP_DIR` yoksa yedek yok; saat `backup.hour`; rotasyon gün bazlı (30 / min 3).

### Yasaklar

- **[ÇEKİRDEK]** Kapsama uyarısı 'mal zaten öyle' ise susar: nitelik topların HEPSİNDE (`every`, `some` değil); create'te `goods` yalnız `quickStart` verir; replace bağlı toplardan canlı okur; muafiyet hedef rengi silmez.

### Tuzaklar

- **[ÇEKİRDEK]** `setCapabilities` renk tarafına yalnız `colorIds` açıkça gelirse dokunur (`[]` hepsini siler); `properties[].mode` yoksa mevcut mod korunur (replace = `deleteMany notIn` + `createMany skipDuplicates`; mevcut satır güncellenmez).

### Reçeteler

- **[ÇEKİRDEK]** Planlamacı `POST …/apply-attribute-to-rolls` ile tüm açık kumaşları düzeltir (`roll:manual-adjust` ∨ `workorder:write`); `workorder:write` çağrısında tekil motora izin listesi verilmez; kumaş (cins) farkı her zaman 400.

### Kararlar

- **[ÇEKİRDEK]** Hedefsiz rota yolu bayt-bayt korunur (ek sorgu/pivot/payload yok); reçetenin kendi rotası hedefsiz kalır (hedef `ProductRecipe`te).
- **[ÇEKİRDEK]** COMPLETED İE'de plan donar ama uyumlu 'Sipariş Bağla' açık: `PLAN_CHANGE_FROZEN_STATUSES` ↔ link servisinin `FROZEN_STATUSES` (CANCELLED+SUPERSEDED) iki ayrı liste — birleştirme.
- **[ÇEKİRDEK]** Tambur 'Sipariş Bağla' `workorder:write` (gri buton çizilmez); uyumsuz satır yetkiyle (`roll:manual-adjust`) `POST /:id/order-links/override`; route'ta çift `requirePermission` AND; tek TX değil — bilinçli.

## Panel (Electron)

### Yasaklar

- **[ÇEKİRDEK]** KÜME DIŞI (Electron): picker'lar `loadAllForPicker(service)`; inline `pageSize: N` yazılmaz; `PICKER_MAX_PAGE_SIZE` aşımında açık hata; >500 için arama tabanlı (`listCursor`).

### Tuzaklar

- **[ÇEKİRDEK]** KÜME DIŞI (Electron): `useNavigate()` sekme defterini güncellemez; `TabRouter` `syncTabLocation` ile yalnız yol değiştiyse eşitler.

### Reçeteler

- **[ÇEKİRDEK]** 'Bu istasyon renk/özellik uygulamaz' ile 'yetenek listesi boş' ayrı mesajdır; rota adımında 'Yeni özellik tanımla' istasyonu bağlamdan alır, özellik bağlı ve seçili doğar; `hasDefaultCategory` karar vermez.
- **[ÇEKİRDEK]** KÜME DIŞI (Electron): içerik route'ları `src/routes/content-routes.tsx`te `<ProtectedRoute requirePermission>`; `router.tsx` yalnız oturum-dışı (`createHashRouter`).

## Tablet (mobil)

### Tuzaklar

- **[ÇEKİRDEK]** KÜME DIŞI (mobil): `AppModal` içinde ön-dolu metin kutusu `ModalTextInput`; `SimplePortal` mikrotask ertelemesi kaldırılamaz; eşitleme `value` prop'unun değişmesidir.

### Reçeteler

- **[ÇEKİRDEK]** Geri Gönder tuşu yalnız saha düzeltme yetkisinde ve çevrimiçiyken çizilir; önizlemesiz uygulama yok, sebep ≥3; başarı toast'ı hedef istasyon adını taşır.

## Geçersiz kılınan kurallar — bunlara UYMA

- Renk yeteneğinde `hasDefaultCategory && canApplyColor` bileşiği ve `requiredCategory.appliesColor` tek kaynağı kalktı → `stepCanApplyColor`.
- Kategori düzeyi kapsama 400/409 değil uyarıdır; `assertRouteCoversTargets` yalnız yorumda.
- 'Dar colorStep' ve `COLOR_LOCKED` tarihsel.
- Tabletten son bağ sökülünce reddedilmez, İE STOK'a döner (`canUnlinkOrderLine` → `becomesStock`).
- '14'lük yedek rotasyonu' bayat (`DEFAULT_RETENTION_DAYS=30`, `RETENTION_MIN_KEEP=3`).

## Çözülmüş çelişkiler

- Kategori düzeyi kapsama üç yolda uyarır; özellik-başına create 400 / replace 409 sert kalır.
- Tambur'a renk yazılması `appliesColor=false` ile engellidir.

## Açık sorular

- Özellik-başına kapsama 'uyarır' kararına dahil mi — kullanıcı kararı bekliyor.
- Mobil `routeApplyCaps` istasyonun `defaultCategory`sine bakar, sunucu adım kategorisini önceler — ayrışma ölçülmedi.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`. Ayrıntı: `Teks-Erp/docs/BEKCI-HARITASI.md`.

Backend: `test_station_default_targets`, `test_batch_redye_three_paths`, `test_siparis_varyant`, `test_import_siparis_varyant`, `test_siparis_hedef_deger_kopya`, `test_batch_split_new_wo_modes`, `test_color_assignment`, `test_color_name_dup`, `test_consecutive_fason`, `test_consistency_derived`, `test_data_integrity_gaps`, `test_dispatch_without_color`, `test_fason_receipt_color_width`, `test_fold_catalog`, `test_fold_edit_and_label`, `test_fold_type`, `test_guarded_hard_remove`, `test_helpers`, `test_import_fix_hints`, `test_manual_attributes_reason`, `test_manual_move`, `test_manual_move_backflush`, `test_master_data_merge_conflicts`, `test_master_data_name_dup`, `test_masterdata_guards`, `test_name_normalization`, `test_phase2_broad_hardening`, `test_phase7_route_validation`, `test_property_station_binding`, `test_property_targetable`, `test_property_value_selection`, `test_recipe`, `test_recipe_property_validation`, `test_roll_fold_and_reason`, `test_route_firm_roundtrip`, `test_route_skip_warning`, `test_route_step_targets`, `test_route_template_fason`, `test_split_card_lineage`, `test_split_per_roll`, `test_station_capability`, `test_station_capability_flags`, `test_station_property_mode`, `test_tambur_plan_gate`, `test_tambur_send_to_dye`, `test_wo_branch_redye`, `test_wo_branch_split`, `test_wo_color_change_lock`, `test_wo_route_coverage_goods`, `test_wo_target_color_guard`, `test_workorder_order_link`, `test_station_quality_capability`, `test_rota_hata_karari_uyarisi`, `test_gelen_belge_cok_parti`

İstemci: `subcontractorDefault.test.ts`, `useTebdilWizard.test.tsx`, `workOrderPrefill.test.ts`, `useMachinePeripherals.test.ts`, `mutations.test.ts`, `tabs.back.test.ts`, `ModalTextInput.test.tsx`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

`CLAUDE-NOT-ARSIVI.md` 2026-08-06 rota şablonu hedef (:92-102) · 08-10 üretim karakteristiği (:307-332) · 08-19 Tambur plan-sapma (:365-374) · 08-21 üretim rengi tek bekçi (:423-436) · `arsiv/2026-08.md` 08-27 hedef siparişten.
