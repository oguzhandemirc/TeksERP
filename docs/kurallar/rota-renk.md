# Rota · Renk · Özellik · Kapsama

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: anlama turu 2026-09-05 (kök `CLAUDE.md` + `docs/history/CLAUDE-NOT-ARSIVI.md` notlarından ayrıştırıldı). Hikâye, ölçüm ve gerekçe arşivde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> Hakem notu: 27 üye; 16'sı konu dışı (Electron router/picker/sekme, mobil klasör/ModalTextInput, yedekleme, mimari, süperadmin P8 mükerreri, fason çekme, yarı mamul, kayıt kuyruğu, giriş izlenebilirliği, kurşun planlama) — küme 'route' kelimesiyle şişmiş; bunlara yalnız alt-proje kuralı verildi. Çekirdek 11 notta dört bayat cümle: 08-06 `hasDefaultCategory`, 08-02 `requiredCategory.appliesColor`, 08-19 'dar colorStep', 08-21 1. tur `COLOR_LOCKED` (hepsi kodla çözüldü). EN RİSKLİ ÇELİŞKİ: 08-27 'kapsama reddetmez, uyarır' ile kodun ÖZELLİK-BAŞINA kapsaması (create 400 / replace 409, `goods` muafiyetsiz, bekçisiz); 08-27 kök özeti 'asimetri açık', arşivi 'kapandı' diyor — ikisi de yarı doğru. Bundle'daki 08-06 archiveText'e arşiv satır 101 (kurşun notunun PROFİL bloğu) sızmış — dilimleme artefaktı.


## Ortak (backend + panel + tablet)


### Değişmezler

- **[ÇEKİRDEK]** 'Adım renk/özellik verebilir mi' TEK YÜKLEM `stepCanApplyColor`/`stepCanApplyProperty` (istasyon bayrağı VEYA adımın fason hizmeti). Rota hedefi, WO kapsama, renk kilidi, taşıma, split, kursunFinish, send-to-dye ONU kullanır; tekil `requiredCategory.appliesColor` / `kind===` yazımı YASAK. · bekçi: `test_station_capability_flags.ts (kaynak taraması) + test_wo_target_color_guard.` <sub>(CLAUDE.md:68)</sub>
- **[ÇEKİRDEK]** Özellik (`StationProperty`) GERÇEK proses kısıtıdır ve BOŞ DOĞAMAZ: `FabricProperty` create'te `stationIds` ZORUNLU, bağ aynı insert'te (`nestedCreateFields: stationCapabilities`); update'te `stationIds` verilirse replace, verilmezse DOKUNMA (ad düzenlemesi bağı silmesin); boş dizi iki yolda da 400. · bekçi: `test_property_station_binding.ts (§1-§9)` <sub>(CLAUDE.md:129)</sub>
- **[ÇEKİRDEK]** `StationProperty` İKİ İŞ yapar (planlama filtresi + `copyStationCapabilitiesToRoll` otomatik uygulama). Satırın VARLIĞI 'verebilir' der; `mode` AUTO|OPTIONAL|REQUIRED (varsayılan OPTIONAL) yalnız teyit biçimi — OPTIONAL kapsam dışı sayılmaz; kurşun bypass AUTO arar; SEÇİM özelliği AUTO olamaz. · bekçi: `test_station_property_mode.ts (19)` <sub>(CLAUDE.md:68)</sub>
- **[ÇEKİRDEK]** Hedef/Düzelt replace'leri yalnız FLAG satırlarına dokunur (`property: { valueType: "FLAG" }`); CHOICE satırı operatör verisidir, `propertyIds=[]` bile silmez. Değerli seçim `RollProperty.valueId` ile saklanır; kesim/finalize/undo/fason çocukları valueId'yi TAŞIR. · bekçi: `test_property_value_selection.ts (27)` <sub>(CLAUDE.md:68)</sub>
- **[ÇEKİRDEK]** Kat değeri KOLONDA (`Roll/WorkOrder/ProductRecipe.foldType`), pivotta değil; biçim (`normalizeFoldType`) ↔ geçerlilik (`resolveFoldTypeForWrite`) ayrı fonksiyon; katalog boşsa FAIL-OPEN, pasif değer yazmada kabul; metre cihazı kat rolüyle BİREBİR eşleşir, yoksa `null` (başka cihaza SAPMAZ). · bekçi: `test_fold_catalog.ts + mobil useMachinePeripherals.test.ts` <sub>(CLAUDE.md:68)</sub>
- **[ÇEKİRDEK]** Rota şablonu adım başına HEDEF saklar (`RouteStep.plannedColorId` + `RouteStepProperty`); hedef ÖNERİDİR, kilit değil (`WorkOrder.targetColorId` ile karıştırma); adım tüketilirken kopyalanmaz — tek kopyalayan istemcinin 'rotayı uygula' adımı (`seedFromRoute`/`applyRouteTarget`/`chooseRoute`). · bekçi: `test_route_step_targets.ts (20)` <sub>(CLAUDE.md:50)</sub>
- **[ÇEKİRDEK]** Sipariş bağlı iş emrinde renk SİPARİŞİN şartıdır: hedef renk/özellik sipariş satırından TÜRER (`resolvedTargetColorId = onlyColorId`, `orderLineRequiredProperty` birleşimi); rota şablonu hedefi orada renge DOKUNMAZ. Sipariş rengi plan beyanı değil müşterinin isteğidir. · bekçi: `test_wo_route_coverage_goods.ts` <sub>(CLAUDE.md:89)</sub>
- **[ÇEKİRDEK]** Rota↔WO çeviri: rotadan WO'ya SON renk veren adım kazanır, özellikler BİRLEŞİR; WO'dan rotaya (`deriveStepTargets`) istasyon yeteneğiyle süzerek dağıtır; adımın istasyonu değişince hedefi SIFIRLANIR; adım güncellemesi deleteMany+create → pivot CASCADE şart. · bekçi: `test_route_step_targets.ts` <sub>(CLAUDE.md:50)</sub>
- **[ÇEKİRDEK]** Hedef renk değişikliğinin iki kapısı (Düzenle · Rengi Değiştir) TEK bekçi `assertTargetColorChange`: terminal statü (`PLAN_CHANGE_FROZEN_STATUSES` COMPLETED/CANCELLED/SUPERSEDED → 409 `WO_PLAN_FROZEN`) → renk aktif → `Item.allowedColors` (boş = sınırsız) → mal–plan uyumu → kapsama UYARISI. · bekçi: `test_wo_target_color_guard.ts (59)` <sub>(CLAUDE.md:74)</sub>
- **[ÇEKİRDEK]** Renk kilidi MALA bakar, adım statüsüne değil: mismatch=0 SERBEST · mismatch>0 & pending>0 → 409 `COLOR_PARTIAL_CONFIRM` (`confirmPartial`) · pending=0 → 409 `COLOR_DYED_BLOCKED` (Tebdil/yeni WO/tümünü düzelt). `computeWorkOrderLocks.targetColor` yalnız Düzenle formunu pasifleştirir; COLOR_LOCKED YOK · bekçi: `test_wo_target_color_guard.ts §2/§5` <sub>(CLAUDE.md:74)</sub>
- **[ÇEKİRDEK]** Fason kabulde hedef renk KİLİT ALTINDA taze; `expectedTargetColorId` farklıysa 409 `TARGET_COLOR_CHANGED` (alan yoksa kontrol yok, eski APK fail-open). Plandan farklı renkte TEK soru `planColorAction`: APPLY_TO_PLAN (plan da döner) · ROLLS_ONLY (`RollPlanDeviation`; Tambur kapısı tekrar sormaz). · bekçi: `test_wo_target_color_guard.ts §6/§9` <sub>(CLAUDE.md:74)</sub>
- **[ÇEKİRDEK]** Tambur plan-sapma kapısı: renk/en (eşik sabiti 10 cm, eşit fark sapma DEĞİL) sapan top depoya ONAYLA iner — 409 `PLAN_MISMATCH` → aynı istek `confirmMismatch`, top başına BİR soru, audit imzalı; üç depo-indiriş yolu TEK helper `tambur-plan-gate.helper`; scrap/discard + renk-hedefsiz WO kapı DIŞI. · bekçi: `test_tambur_plan_gate.ts (28→48) + mobil mutations.test.ts` <sub>(CLAUDE.md:71)</sub>
- **[ÇEKİRDEK]** Plan sapması KALICI deftere (`RollPlanDeviation`) yazılır, audit'e değil (audit 6 ayda arşivlenir, rapor arşivi okumaz); granülerlik onaylı geçiş × sapan alan, `confirmationId` çift-sayım kilidi (onay = COUNT DISTINCT, metraj imza başına TEK); `field` string, pg enum değil. <sub>(CLAUDE.md:70)</sub>
- **[ÇEKİRDEK]** Kalite = istasyon YETENEĞİ, boğaz İKİZ: `stepCanApplyQuality(station)` (bellek içi) + `QUALITY_STATION_WHERE` (Prisma, `satisfies`; spread'e ikinci `OR` eklenmez); saf yüklem WHERE'e GİREMEZ (atomik claim bozulur); ikisi birlikte değişir; yeni `kind===PROCESS_QC` YAZMA. · bekçi: `test_station_quality_capability.ts (ikizin canlı eşdeğerliği + sayım bazlı muaf/` <sub>(arşiv:2116)</sub>

### Yasaklar

- **[ÇEKİRDEK]** SEÇİM (CHOICE) tipli özellik HEDEF OLAMAZ — iki katman: aktif seçim yapan uçlar `assertTargetablePropertyIds` (400, adıyla); mevcut listeyi geri yollayan echo uçları `partitionTargetableIds` (sessiz ayırma). İstemci `isTargetableProperty` yalnız konfordur; sözleşmeyi SUNUCU korur. · bekçi: `test_property_targetable.ts (22)` <sub>(CLAUDE.md:68)</sub>

### Tuzaklar

- **[?]** Özellik-BAŞINA kapsama ('ŞU özelliği veren istasyon var mı') HÂLÂ SERT: create 400, replace/updateTargetProperties 409 (`locks.applicablePropertyIds`); `goods` muafiyeti bu yola UYGULANMAZ. 2026-08-27 'uyarı' kararı yalnız kategori düzeyi — 'hepsi uyarır' diye OKUMA. · bekçi: `yok — test_wo_route_coverage_goods.ts bu yolu ölçmüyor ('Şu özelliği'/'propertyI` <sub>(CLAUDE.md:129, CLAUDE.md:89)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Yeni tarihli not CLAUDE.md'ye değil ARŞİVE (`docs/history/CLAUDE-NOT-ARSIVI.md`) yazılır; köke yalnız `[ÇEKİRDEK]`/`[PROFİL]` etiketli özet satırı eklenir; alana dokunmadan önce arşivdeki TAM not okunur. Ölçüt: MODUL-BAYRAK-TASARIM §11 'bayraklanmayacaklar' = ÇEKİRDEK. <sub>(CLAUDE.md:35)</sub>

### Kararlar

- **[ÇEKİRDEK]** Rota kapsaması (kategori düzeyi: 'renk/özellik VEREBİLEN adım var mı') REDDETMEZ, UYARIR — create · replace · 'Rengi Değiştir' tek kural (`collectRouteCoverageWarnings` / helper §5), yanıt `ApiResponse.warnings`; `quickStart` create uyarılarını yanıta taşır; uyarı metni NE eksik + SONUÇ. · bekçi: `test_wo_route_coverage_goods.ts (7) + test_wo_target_color_guard.ts §4` <sub>(CLAUDE.md:89)</sub>

## Backend


### Değişmezler

- **[ÇEKİRDEK]** Fason KABUL rengin/özelliğin FİİLEN uygulandığını `requiredCategory` bayrağından okumaya DEVAM EDER — istasyon bayrağı 'yapabilir' (planlama), kategori bayrağı 'yaptı' (çalışma zamanı) der; ikisini birleştirme. · bekçi: `test_station_capability_flags.ts:218-221 (kaynak taraması: `step.requiredCategor` <sub>(CLAUDE.md:68)</sub>
- **[ÇEKİRDEK]** Rota adımı renk yeteneğinde ADIMIN kategorisi de okunur; adımda kategori seçilmemişse istasyonun VARSAYILAN kategorisi kullanılır (planlamacının niyeti 'her zamanki hizmet'). Yalnız istasona bakmak, bayrağı açılmamış fason boyahane adımını reddeder. · bekçi: `test_route_step_targets.ts` <sub>(CLAUDE.md:50)</sub>
- **[ÇEKİRDEK]** 'Boyahaneye Geri Gönder' hedefini SUNUCU çözer (`/tambur/manual/send-to-dye-preview` → `send-to-dye`): kanonik `stepCanApplyColor`, mevcut adımdan ÖNCEKİ en yakın boya adımı (max stepSequence); yoksa 400 `NO_DYE_STEP_IN_ROUTE`; `AT_SUBCONTRACTOR` YAZILMAZ — fiziksel çıkış Fason Sevk'ten. · bekçi: `yok (bu turda ölçülmedi)` <sub>(CLAUDE.md:70)</sub>
- **[ÇEKİRDEK]** KÜME DIŞI (backend): Katman Routes → Controllers → Services → Prisma; route/controller'da `lib/prisma` import YASAK (ESLint no-restricted-imports); ince read/ayar uçları bilinçli controller'sız. ⚠️ `admin.routes.ts:53` yasağı deliyor (fazA). · bekçi: `eslint.config.mjs:59-73 (no-restricted-imports '**/lib/prisma')` <sub>(CLAUDE.md:140)</sub>
- **[ÇEKİRDEK]** KÜME DIŞI (backend): Yedek ön ekleri yaşam döngüsü (`backup-naming.helper.ts` TEK KAYNAK): `tekserp_` rotasyona girer, `premigrate_`/`pre-restore_` girmez; cutoff = min(ad damgası, mtime). `BACKUP_DIR` yoksa yedek YOK; saat `backup.hour`; rotasyon GÜN bazlı (30 / min 3) — '14'lük' BAYAT. · bekçi: `yok (bu turda ölçülmedi)` <sub>(CLAUDE.md:279, CLAUDE.md:277)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Kapsama uyarısı 'mal zaten öyle geliyorsa' susar: nitelik topların HEPSİNDE (`every`) varsa — `some` kapıyı sessizce açar; create'te `goods` yalnız `quickStart` verir (mal bilgisi yoksa muafiyet YOK — F221), replace bağlı toplardan CANLI okur; muafiyet hedef rengi SİLMEZ. · bekçi: `test_wo_route_coverage_goods.ts (iki negatif sonda: every→some, rollCount>0)` <sub>(CLAUDE.md:89)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** `setCapabilities` renk tarafına yalnız `colorIds` AÇIKÇA gönderilirse dokunur (`[]` hepsini siler, alan yoksa dokunmaz); `properties[].mode` verilmezse mevcut satırın modu korunur (replace = `deleteMany notIn` + `createMany skipDuplicates`, mevcut satır GÜNCELLENMEZ). · bekçi: `test_station_capability.ts 8b` <sub>(CLAUDE.md:128, CLAUDE.md:68)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Planlamacı (`workorder:write`) iş emrinin TÜM açık kumaşlarını tek hamlede düzeltir: `POST …/apply-attribute-to-rolls` any-perm (`roll:manual-adjust` ∨ `workorder:write`); `workorder:write` ile gelen çağrıda tekil motora izin listesi VERİLMEZ (dahili çağrı, F221); kumaş (cins) farkı HER ZAMAN 400. · bekçi: `test_wo_target_color_guard.ts §10` <sub>(CLAUDE.md:74, CLAUDE.md:71)</sub>

### Kararlar

- **[ÇEKİRDEK]** Hedefsiz rota yolu bayt-bayt korunur (hedef yoksa ek sorgu/pivot satırı/payload alanı yok); reçetenin KENDİ rotası hedefsiz kalır — hedef zaten `ProductRecipe`'te, ikinci kopya iki kaynak demektir. <sub>(CLAUDE.md:50)</sub>
- **[ÇEKİRDEK]** COMPLETED iş emrinde plan (renk/en/uyumsuz-bağ override) DONAR ama uyumlu 'Sipariş Bağla' AÇIK: `PLAN_CHANGE_FROZEN_STATUSES` ↔ link servisinin `FROZEN_STATUSES` (yalnız CANCELLED+SUPERSEDED) İKİ AYRI LİSTE — birleştirme. · bekçi: `test_wo_target_color_guard.ts §1` <sub>(CLAUDE.md:74)</sub>
- **[ÇEKİRDEK]** Tambur 'Sipariş Bağla' (`workorder:write`; gri buton çizilmez); uyumsuz satır YETKİYLE açılır (`roll:manual-adjust`), soruyla değil → `POST /:id/order-links/override` (plan düzelt → toplar → bağ; route'ta ÇİFT `requirePermission` AND); TEK TX DEĞİL — bilinçli. · bekçi: `test_tambur_plan_gate.ts + test_wo_target_color_guard.ts` <sub>(CLAUDE.md:71)</sub>

## Panel (Electron)


### Yasaklar

- **[ÇEKİRDEK]** KÜME DIŞI (Electron): Master data picker'ları `loadAllForPicker(service)` kullanır; inline `pageSize: N` YAZILMAZ (backend `MAX_PAGE_SIZE` değişince 400); helper `PICKER_MAX_PAGE_SIZE` ile senkron, aşımda AÇIK hata fırlatır → UI yakalar; >500 için arama tabanlı combobox (`listCursor`). <sub>(CLAUDE.md:307)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** KÜME DIŞI (Electron): `useNavigate()` ile gezinme sekme defterini GÜNCELLEMEZ; `TabRouter` router'a abone olup `syncTabLocation` ile eşitler — yalnız yol DEĞİŞTİYSE (sayfaların `updateTabTitle` başlığı korunsun). · bekçi: `store/tabs.back.test.ts` <sub>(CLAUDE.md:225)</sub>

### Reçeteler

- **[ÇEKİRDEK]** 'Bu istasyon renk/özellik uygulamaz' ile 'yetenek listesi boş' AYRI cümlelerdir, tek mesajda birleştirme. Rota adımındaki 'Yeni özellik tanımla' istasyonu bağlamdan alır → özellik BAĞLI doğar ve anında seçili gelir. `hasDefaultCategory` DTO'da kalır (ipucu metni) ama karar vermez. <sub>(CLAUDE.md:129, CLAUDE.md:68)</sub>
- **[ÇEKİRDEK]** KÜME DIŞI (Electron): İçerik route'ları `src/routes/content-routes.tsx`'te `<ProtectedRoute requirePermission>`; `router.tsx` yalnız oturum-dışı router (`createHashRouter`, file:// zorunlu). Electron/CLAUDE.md 'router.tsx route map' ağacı + checklist satırı BAYAT. <sub>(CLAUDE.md:31, CLAUDE.md:384, CLAUDE.md:392)</sub>

## Tablet (mobil)


### Tuzaklar

- **[ÇEKİRDEK]** KÜME DIŞI (mobil): `AppModal` içinde ÖN-DOLU açılan metin kutusu `ModalTextInput` kullanır; `SimplePortal` mikrotask ertelemesi KALDIRILAMAZ; eşitleme koşulu `value` PROP'unun değişmesi, 'taslaktan farklı' değil. mobil/CLAUDE.md klasör haritası bayat (data/lib/offline/test/theme eksik). · bekçi: `components/ModalTextInput.test.tsx` <sub>(CLAUDE.md:292, CLAUDE.md:164)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Geri Gönder tuşu yalnız saha düzeltme yetkisi olanda ve ÇEVRİMİÇİYKEN çizilir (uç online-only); önizlemesiz uygulama YOK, sebep ≥3 (TamburBringRollModal sözleşmesi); başarı toast'ı hedef istasyon adını MUTLAKA taşır (top Tambur listesinden düşer, operatör 'kayboldu' demesin). <sub>(CLAUDE.md:181)</sub>

## Geçersiz kılınan kurallar — bunlara UYMA

- **KISMI** `R:2026-08-06__2026-08-06-rota-sablonu-hedef` → `R:2026-08-10__2026-08-10-11-uretim-karakteristigi`: Renk yeteneği bileşik koşulu (`hasDefaultCategory && canApplyColor`) kalktı; yetenek `Station.appliesColor` alanına taşındı, tek yüklem `stepCanApplyColor(station, stepCat)`. 08-06 kök satırındaki 'renkte hasDefaultCategory DE aranır (yoksa Tambur adımına renk yazılır)' cümlesi bayat. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-02__renk-istasyon-bazli-kisit-degil-2026` → `R:2026-08-10__2026-08-10-11-uretim-karakteristigi`: 'Renk veren adım var mı' tek kaynağı `requiredCategory.appliesColor` idi; 08-10'dan beri kaynak `stepCanApplyColor` (İSTASYON bayrağı VEYA adımın fason hizmeti). 'StationColor değil' kısmı ve 'ikinci renk filtresi ekleme' yasağı yürürlükte. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-02__ozellik-istasyon-kisiti-kalir-ama-bos` → `R:2026-08-27__2026-08-27-rota-kapsamasi-hedef`: Kategori düzeyi kapsama ('renk/özellik veren adım var mı') create+replace'te 400/409 idi; 08-27'den beri UYARI (`collectRouteCoverageWarnings`). Özellik-BAŞINA kapsama ('ŞU özelliği veren istasyon') EZİLMEDİ: create 400, replace/updateTargetProperties 409 sürüyor. ✅ çürütmeden geçti
- **TAM** `R:2026-08-21__2026-08-21-uretim-rengi-tek` → `R:2026-08-27__2026-08-27-rota-kapsamasi-hedef`: 08-21 arşivi 'açılışta `assertRouteCoversTargets` 400 vermeye devam eder' diyordu; 08-27'de oluşturma (create) ve replace yolu da uyarıya çevrildi; `assertRouteCoversTargets` adı yalnız yorumlarda kaldı. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-19__2026-08-19-2-paket-sektor` → `R:2026-08-21__2026-08-21-uretim-rengi-tek`: 'moveService'in dar colorStep'i yalnız requiredCategory okur, iç boyahaneyi görmez' tespiti 08-21'de kapandı: manuel taşıma ve parti ayırma da `stepCanApplyColor` kullanır. 'send-to-dye hedefi kanonik yüklemle çözülür' kuralı geçerli; 'dar colorStep' karşıtlığı tarihsel. ✅ çürütmeden geçti
- **TAM** `R:2026-08-21__2026-08-21-uretim-rengi-tek (arşiv 1. tur, madde ④)` → `R:2026-08-21__2026-08-21-uretim-rengi-tek (arşiv 2. tur)`: 1. turun 'boya-bitti kilidi → 409 COLOR_LOCKED' adımı aynı gün kalktı: kilit ADIMA değil MALA bakar (mismatch/pending); `computeWorkOrderLocks.targetColor` yalnız Düzenle formunun alanını pasifleştirir. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-19__2026-08-19-2-paket-sektor` → `2026-08-21 — İş emri TİPİ bağın aynası (kök CLAUDE.md:76; bu kümede üye değil)`: ④ 'tabletten bağ sökmede son bağ reddedilir' kuralı: son bağ artık reddedilmez, iş emri STOK'a döner (`canUnlinkOrderLine` → `becomesStock`). Notun kendi metninde işaretli. ✅ çürütmeden geçti
- **KISMI** `B:2026-07-30__yedekleme-backend-e-ait` → `B:2026-07-31__gece-yedeginin-sahibi-ortama-gore-degisir (fazA supersededBy; küme dışı)`: '14'lük rotasyon' bayat: rotasyon artık gün bazlı (`DEFAULT_RETENTION_DAYS=30`, `RETENTION_MIN_KEEP=3`). Notun geri kalanı (pg_dump ayrı process, verifyBackupFile, BACKUP_DIR yoksa yedek yok, backup.hour) canlı. ✅ çürütmeden geçti

## Çözülmüş çelişkiler

- `R:2026-08-27__2026-08-27-rota-kapsamasi-hedef (kök özet, CLAUDE.md:89)` ↔ `R:2026-08-27__2026-08-27-rota-kapsamasi-hedef (arşiv gövdesi, satır 1445-1520)`: Kategori düzeyinde (renk/özellik veren adım) üç yol da UYARIR — kapandı. Özellik-BAŞINA ('ŞU özelliği veren istasyon') create 400 `badRequest` (goods muafiyeti YOK) ↔ replace/updateTargetProperties 409 `conflict` — kod, mesaj ve muafiyet farklı; 'tam kapanmadı' yalnız bu yol için doğru. Arşivdeki 'Uygulama' bölümü 1. tur metni, yeniden yazılmamış.
- `R:2026-08-02__ozellik-istasyon-kisiti-kalir-ama-bos` ↔ `R:2026-08-27__2026-08-27-rota-kapsamasi-hedef`: İkisi de kısmen canlı: 08-27 kuralı KATEGORİ düzeyini uyarıya çevirdi; 08-02'nin ÖZELLİK-BAŞINA sert kapısı (create 400 / replace 409) olduğu gibi duruyor ve 08-27'nin `goods` muafiyetini bilmiyor. 'Kapsama uyarır' cümlesi bu yolu kapsamaz; bekçi de ölçmez.
- `R:2026-08-06__2026-08-06-rota-sablonu-hedef (kök CLAUDE.md:50)` ↔ `R:2026-08-10__2026-08-10-11-uretim-karakteristigi (kök CLAUDE.md:68)`: Kod 08-10'u uygular; iç istasyonlara göçte `appliesColor=false` yazıldığı için Tambur'a renk yazılması yine engellidir (bayrak dürüst). Kök satır 50'deki `hasDefaultCategory` cümlesi düşürülmeli; bekçi yorumu (test_route_step_targets.ts:18/101) bayat ama ölçüm doğru sonuç veriyor.
- `R:2026-08-02__renk-istasyon-bazli-kisit-degil-2026 (kök CLAUDE.md:128)` ↔ `R:2026-08-21__2026-08-21-uretim-rengi-tek (kök CLAUDE.md:74)`: Kod b'yi uygular: kaynak `stepCanApplyColor` (istasyon bayrağı VEYA fason hizmeti). 08-02'nin 'StationColor değil' ve 'ikinci renk filtresi ekleme' kısmı yürürlükte; 'requiredCategory.appliesColor' ifadesi daraltılmış bir ara hâl. workorder-locks.helper.ts:17 başlık yorumu güncellenmeli.

## Açık sorular

- Özellik-BAŞINA kapsama ('ŞU özelliği veren istasyon') 2026-08-27 'reddetmez, uyarır' kararına DAHİL Mİ? Notlar sessiz; kod sert kalıyor (create 400 badRequest / replace-updateTargetProperties 409 conflict), create yolu `goods` muafiyetini uygulamıyor (workorder.service.ts:975-993 `targetPropertyIds` üzerinden), bekçi `test_wo_route_coverage_goods` bu yolu ölçmüyor. Kullanıcı kararı gerekir; 08-27 kök özetindeki 'asimetri açık' cümlesi bu yolu kastediyorsa metni netleştirilmeli.
- Mobil `routeApplyCaps` (useQuickWorkOrder.ts:117-131) rota adımının `requiredCategory`sine değil istasyonun `defaultCategory`sine bakar; sunucu `route.service.ts:349-351` adım kategorisini önceler. Rota şablonunda adım kategorisi varsayılandan farklıysa tablet ön-doldurma ile sunucu kararı ayrışabilir — ölçülmedi, BELİRSİZ.
- Bayat yorumlar (kod doğru, metin eski): workorder-locks.helper.ts:17 ('requiredCategory.appliesColor=true'), test_route_step_targets.ts:18 ve :101 (bileşik `hasDefaultCategory && appliesColor`). Düzeltme kararı ayrı iş.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (tek testte tip kapısı atlanır) · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`.

**Ne ölçtükleri, DB gerektirip gerektirmedikleri ve bayatlık işaretleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → bu alanın bölümü.** ⚠️ = orada gerekçesi yazılı bayatlık şüphesi.

Backend: `test_batch_redye_three_paths`, `test_batch_split_new_wo_modes`, `test_color_assignment`, `test_color_name_dup`, `test_consecutive_fason`⚠️, `test_consistency_derived`, `test_data_integrity_gaps`, `test_dispatch_without_color`, `test_fason_receipt_color_width`, `test_fold_catalog`, `test_fold_edit_and_label`, `test_fold_type`, `test_guarded_hard_remove`, `test_helpers`, `test_import_fix_hints`, `test_manual_attributes_reason`⚠️, `test_manual_move`, `test_manual_move_backflush`, `test_master_data_merge_conflicts`, `test_master_data_name_dup`, `test_masterdata_guards`, `test_name_normalization`, `test_phase2_broad_hardening`, `test_phase7_route_validation`, `test_property_station_binding`, `test_property_targetable`, `test_property_value_selection`, `test_recipe`, `test_recipe_property_validation`, `test_roll_fold_and_reason`, `test_route_firm_roundtrip`, `test_route_skip_warning`, `test_route_step_targets`, `test_route_template_fason`, `test_split_card_lineage`, `test_split_per_roll`, `test_station_capability`, `test_station_capability_flags`, `test_station_property_mode`, `test_tambur_plan_gate`, `test_tambur_send_to_dye`, `test_wo_branch_redye`⚠️, `test_wo_branch_split`⚠️, `test_wo_color_change_lock`, `test_wo_route_coverage_goods`, `test_wo_target_color_guard`, `test_workorder_order_link`

İstemci: `subcontractorDefault.test.ts`, `useTebdilWizard.test.tsx`, `workOrderPrefill.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-08-06 · 2026-08-06 — ROTA ŞABLONU artık HEDEF de saklar: adım başına renk + özellik — `CLAUDE-NOT-ARSIVI.md:92-102`
- 2026-08-10 · 2026-08-10 — ÜRETİM KARAKTERİSTİĞİ: kat KATALOĞA taşındı + istasyon-özellik DAVRANIŞ MODU + istasyon yeteneği  — `CLAUDE-NOT-ARSIVI.md:307-332`
- 2026-08-19 · 2026-08-19 — Tambur plan-gerçek sapma kapısı + "Sipariş Bağla" [v1+v2] + planlamacı dağılım bandı — `CLAUDE-NOT-ARSIVI.md:365-374`
- 2026-08-21 · 2026-08-21 — Üretim rengi değişikliği TEK BEKÇİ + kısmi-boya onayı + fason kabul taze renk + sipariş kalemi re — `CLAUDE-NOT-ARSIVI.md:423-436`
- 2026-08-27 · 2026-08-27 — "Sipariş bağlarsam hata veriyor, siparişsiz açınca geçiyor" — hedef, plandan değil SİPARİŞTEN tür — `CLAUDE-NOT-ARSIVI.md:1445-1520`