# Modül anahtarları · Bayraklar · Profiller
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/modul-bayrak.md`.

> Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

## Ortak (backend + panel + tablet)

### Değişmezler

- **[ÇEKİRDEK]** `MODULE_FLAG_KEYS` YALNIZ modül anahtarlarını taşır (`reportsClosedKeys` girmez; yeni modül emanet emsaliyle); süperadmin yazma kümesi ayrı: `SUPERADMIN_ONLY_FLAG_KEYS` = modüller ∪ `reportsClosedKeys`, ham ayar ikizi `SUPERADMIN_ONLY_SETTING_KEYS`; ikisini tek küme yapma.
- **[ÇEKİRDEK]** Her kuralda önce sor: ÇEKİRDEK mi PROFİL mi? Ölçüt `MODUL-BAYRAK-TASARIM` §0/§11, uygulama §12 bağlayıcı; Ortak Konvansiyonların tamamı ÇEKİRDEK.
- **[ÇEKİRDEK]** Varyasyonu dört mekanizmayı SIRAYLA deneyerek yerleştir: **[ÇEKİRDEK]** (seçenek yok) → VERİ (aynı kod yolu) → AKSİYON ANINDA SEÇİM (varsayılanlı, kilitsiz) → **[PROFİL] BAYRAK** (son çare, yalnız kod yolu açılıp kapanıyorsa); kaydın içeriği olan soruyu bayrağa çevirme.
- **[ÇEKİRDEK]** Varyasyonu veriye çevirince sor: (a) alanın TİPİ senaryoya göre değişir mi (aynı kolon iki anlam taşımaz), (b) bir görünürlük kuralı ya da alt sınır (`>= 1` CHECK) kararı sessizce iptal ediyor mu.
- **[PROFİL]** PROFİL = rota, istasyon topolojisi, açık modüller, sayısal ayarlar; kökteki üretim akışı bir ROTADIR. Rotada ADIM ise istasyon/adım ekle; kendi kimliği/defteri olan VARLIK (levent, tezgah telemetrisi) ayrı model olabilir, çekirdek kurallar orada da geçerli.
- **[ÇEKİRDEK]** Fazın ilan ettiği çıktıyı statik bekçiyle değil AKIŞLA ölç (kapı·route·izin·ekran yeşilken faz tek kayıt üretemeyebilir).
- **[ÇEKİRDEK]** Modül anahtarını yalnız süperadmin yazar: `flagWriteGuard` modül dalı EN ÖNDE, `.some` (belge dalı `.every`), SENKRON, `MODULE_FLAG_SUPERADMIN_ONLY`; supap: hesap YOKSA `admin:settings` + audit; bilinmiyor = VAR (fail-closed); tembel tazeleme `resolveSystemAccountLock`.
- **[ÇEKİRDEK]** Süperadmin yetkisi `getEffectivePermissions` ilk ifadesi `["*"]` (rol değil); `*` körlüğü yasak (`has('*')`, `hasAdminAccess`, `admin:*`); `isSystemAccount` panelden atanamaz (yazar `superadmin-olustur.ts`); doğuş yalnız `npm run superadmin:kur`; kurtarma kodu yok.
- **[ÇEKİRDEK]** Yeni davranış bayrağının varsayılanı = BUGÜNKÜ davranış, hiçbir profilde açık doğmaz; 'varsayılan = bugün' ÖLÇÜLMEDEN yazılmaz.
- **[ÇEKİRDEK]** Müşteri isteğini merdivenin en alt yeten basamağında karşıla: (1) ayar/veri · (2) genel yetenek · (3) ekran varyantı · (4) müşteri eklentisi (ayrı klasör, lisansla açılır, çekirdek ona bağımlı değil); yeni özellik kapalı doğar, kapalıyken bugünkü davranış.

### Yasaklar

- **[ÇEKİRDEK]** ÇEKİRDEK bayrakla açılıp kapanmaz: defter semantiği, brüt sevk, idempotency, kilit sırası, atomik claim, fail-closed kapı, sır hijyeni, veri bütünlüğü, UUID/soft delete/audit/beş sağlamlık sınıfı/yıkıcı onay; 'bizde olmasın'ın cevabı süreç/eğitim.
- **[ÇEKİRDEK]** PRODUCTION CANLI = her canlı kurulum: `migrate reset`/reseed/toplu DELETE yasak; migration geri alınamaz (rollback = restore); düzeltme script'i dry-run varsayılan, `--apply` öncesi listeler; şema provası en eski canlı dump'ta.
- **[ÇEKİRDEK]** Kapı takarken malın çıktığı BAŞKA yolu kardeş bayrağın kapsamına bakarak sor: fason DOĞRUDAN SEVK `orderRequirement` kapsamında (`orderless`); `gradeRequiredEnabled` DAR (fason kabulü, son-adım finalize, cutOpenFabric, attachRolls DIŞARIDA) — genişletme yasak.

### Reçeteler

- **[ÇEKİRDEK]** Çıkışsız kapı üreten bayrak (`block`, `manualWeightRestricted`) yazılır ama AÇILMAZ; önkoşul panel metninde, bekçi metinden ölçer; bayrak adı işini söyler (`batch.autoCreateEnabled`).

### Kararlar

- **[PROFİL]** Menü gizleme güvenlik sınırı değildir: tek kaynak `ui.menuHiddenScreens` + `ui.menuAdvancedGroup`, tek yazar `PUT /api/menu-layout` (ham ayar ucu reddeder); bilinmeyen anahtar ve gizlenemez küme (`constants/menu-layout.ts`) 400; hazır set firma TİPİ adıyla; varsayılanda gizli yok.
- **[PROFİL]** Rapor kategorisi (`reports/<kat>`) gizlenince alt raporlar her yüzeyden düşer; kademe `isMenuHidden`te tek yerde; adres kapısı (`isCenterEntryVisible`) menü süzgecini okumaz.
- **[ÇEKİRDEK]** En yetkili hesap GÖRÜNÜR (gizleme süzgeci geri gelmez); `/users/:id/credentials` sistem hesabına dar 403 kapısı DURUR; `/users/:id` önek kapısı KALIR; ayar şifresi yönetim uçları 403 (404 değil).
- **[ÇEKİRDEK]** Özellik Anahtarları'nda KAPALI modülün bayrak satırı fabrika yöneticisine HİÇ çizilmez, satır kalmazsa sekme düşer; satıcıda (supap dahil) hiçbir satır gizlenmez, kilit bandı satıcıda.

## Backend

### Değişmezler

- **[ÇEKİRDEK]** Modül DB anahtarı `<alan>.enabled`; `modul.*` koda girmez; API alanı camelCase; TEK KAYNAK `src/constants/module-flags.ts` (düz string kümeler, dairesel import yasak); Electron `lib/module-flags.ts` metin-birebir AYNA.
- **[ÇEKİRDEK]** Bağımlılık (iplik→ticaret, tezgah→production) iki yerde: middleware önce ön koşulu ölçer (403 `modul:"ticaret", dependent:"iplik"`) + `setFeatureFlags` doğrulaması (400 `MODULE_DEPENDENCY`); okuyucular bağımlılığı birleştirmez; etkin değer Electron ctx'te tek yerde.
- **[ÇEKİRDEK]** Ham ayar ucu `PUT /admin/settings/:key` modül anahtarına 400 `MODULE_KEY_RESERVED`; tek yazma kapısı `PATCH /api/feature-flags`.
- **[ÇEKİRDEK]** `PATCH /feature-flags` zinciri: `verifyToken` → `flagWriteGuard` → `requireSettingsPassword` (async; şifre yalnız `X-Settings-Password` başlığında); ayar yazan uç kapsamı elle sayılmaz — `src/routes/**` AST tripwire.
- **[ÇEKİRDEK]** Kapalı modülün ekransız uçları da kapı taşır (`requireXEnabled`, `verifyToken`dan SONRA, router'ın TÜM uçlarından ÖNCE); taşıyan her `src/routes/*.routes.ts` rejim bekçisinin `KAPILI` listesinde anılır.
- **[ÇEKİRDEK]** Route'u olmayan modül kapısını `test_module_flag_off` `MODULLER` satırında `rotasiz` gerekçesiyle tut; ilk router taktığı gün route + sonda yaz, gerekçeyi sil.
- **[ÇEKİRDEK]** `ScreenEntry.modul` ZORUNLU aidiyet beyanı (`ModulKey` · `cekirdek:*` · `planlanan:fason|kartela`), görünürlük kuralı değil (o `visibleWhen`); `MODULESIZ_EKRANLAR` muafı yok.
- **[ÇEKİRDEK]** Modül okuyucusunun varyantını çağıran seçer: `readXRaw` saf DB (yalnız `getFeatureFlags` ve `effectiveModuleValue`), `readX = readXRaw ∧ lisans tavanı` (tüm enforcement). Tavan kuralı `docs/kurallar/lisans.md` § Değişmezler'de.
- **[ÇEKİRDEK]** Lisansın kapattığı modülde adlı kapı 403 `LICENSE_MODULE`; lisans açık modülü AÇTIRMAZ (`setFeatureFlags` yazma tavanı; `flagWriteGuard`a dokunma); dondurulan modül kapalı; panel ham şalter + salt-okunur `license` bloğunu okur.
- **[ÇEKİRDEK]** Kullanıcıya "şuradan açılır" diyen backend cümlesi yolu `constants/panel-ayar-yolu.ts`ten alır (`settingScreenPath` · `settingRowPath`); elle "Genel Ayarlar"/"Ayarlar →" yasak; tablo panel `settings-config.ts` ile bayt eşit.
- **[ÇEKİRDEK]** Ayar dışı ekrana yönlendiren backend cümlesi `constants/panel-ekran-yolu.ts` `ekranYolu`ndan (ayraç ` → `); elle "Tanımlar → …"/"X > Y" yazma; yeni ekran için tabloya satır ekle.

### Yasaklar

- **[ÇEKİRDEK]** Katman sırası Routes → Controllers → Services → Prisma; route/controller'da `lib/prisma` import YASAK (ESLint `no-restricted-imports`); ince ayar uçları controller'sız istisna, iş mantığı serviste. ⚠️ `admin.routes.ts` bugün ihlal ediyor.
- **[ÇEKİRDEK]** Kurulum profilleri `constants/module-profiles.ts` (`deploy/` pakete girmez); profil YALNIZ modül anahtarı taşır, davranış bayrağı girmez; fason/kartela anahtarsız; yedi anahtar her profilde açıkça yazılır.
- **[PROFİL]** Hizmet veren `hizmet` profili satılır, boyahane aynası satılmaz; profil yalnız modül anahtarı; ölçüm/faturalama ayarları `scripts/hizmet-ayar-paketi.ts` (kuru koşu varsayılan).
- **[PROFİL]** Seyitoğlu `tam` profille kurulur, yeni profil açılmaz; §15.1 ayarları ve duruş verisi `scripts/seyitoglu-ayar-paketi.ts` (kuru koşu varsayılan, yalnız eksik yaratılır).

### Reçeteler

- **[ÇEKİRDEK]** Grandfathering migration KOŞULLU (`EXISTS rolls` / aktif depo>1), değer = DÜNKÜ DAVRANIŞ; dünkü davranışı olan modülde sabit `false` yasak, olmayan (sıfırdan doğan) modülde sabit `false`; `readProductionEnabled` satır-yok → true sigortası korunur, `asBoolean`a sadeleştirme yasak.
- **[ÇEKİRDEK]** DB'ye yazan bekçiler `scripts/lib/hedef-db-kapisi`nden geçer; hedef `tekserp` ise `BEKCI_PROD_ONAY=1` olmadan durur; global durum yazan bekçiler eşzamanlı koşmaz, ajan başına port.
- **[ÇEKİRDEK]** Profil job'ı `TEKSERP_PROFIL` yoksa yazmaz, satır varsa dokunmaz (`createMany skipDuplicates`); açıklama metinleri üç yazarda birebir; profil yazma ucu YOK — `GET /admin/module-profile` salt okuma.
- **[ÇEKİRDEK]** TEST profilleri `Teks-Erp/scripts/test-profilleri/<ad>.json` (yalnız ayar anahtarı, allowlist OPT-İN, sır/iş verisi girmez); `acik` `scripts/lib/hepsi-acik.ts`ten, yeni bayrak oraya satır ister; tam `npm test` yalnız `kapali`de, diğerlerinde `scripts/profil-matrisi.ts`.
- **[ÇEKİRDEK]** Gerçek fabrika profili yalnız yedeğin kendi `_test` kopyasından salt okuma `scripts/profil-disa-aktar.ts` ile; ad nötr kod (`f1`); kök grup dışı sürüm temiz ağaçta yeşil profil matrisi ister, yoksa DUR; kaçış yalnız `--profil-matrisi-atla="<kullanıcının cümlesi>"`.
- **[ÇEKİRDEK]** Modül kapısı ADLANDIRILMIŞ olur, 403 gövdesi `details.code:"MODULE_DISABLED"` (`modulKapali`, finans kapısı dahil); jenerik `requireModule("x")` yasak (`GENERIC_REQUIRE_MODULE`); ⚠️ bekçi `requireFinanceEnabled` mount'larını ölçmüyor.
- **[ÇEKİRDEK]** Route'tan önce doğan adlı kapıyı `ROTASIZ_KAPILAR`a gerekçeyle yaz; ilk route günü muafı sil, `MODULLER` satırı + `lib/profil-kapi-haritasi` sondası + ekran beyanı ekle.
- **[ÇEKİRDEK]** Ön koşulu `MODULLER`de olmayan modül tabloya girince ön koşul `YONETILEN`e yüzeysiz yer tutucu olarak türer, `ALAN_KODU` `onKosul`dan, ön koşulun `KAPSAM_DISI` satırı silinir; bağımlı kapı ön koşulu lisansta da önce ölçer (403 `LICENSE_MODULE` `emanet.enabled`).
- **[ÇEKİRDEK]** "Gelen belge etkin mi" kapı dışı her tüketicide `effectiveIncomingDocsEnabled()`; tavanlı `readGelenBelgeEnabled` yalnız resolver, `requireGelenBelgeEnabled` ve bildirim modül haritasında.

## Panel (Electron)

### Değişmezler

- **[ÇEKİRDEK]** Panelde kapalı modül ÜÇ yolda kapalı: karo + palet (`visibleWhen`) VE route (`ProtectedRoute` izin kapılarından SONRA `lib/route-modules.ts` `ROUTE_MODULE` → `/forbidden`, `state.reason:"module"`); alt yol ebeveyne katlanır, modülsüz yol dokunulmaz.
- **[ÇEKİRDEK]** Modül/rapor kapısı koruduğu rotanın yoluna (`useResolvedPath(".")`) bakar, `useLocation`a değil; 403 `MODULE_DISABLED` toast'ı backend cümlesini basar ("yetkiniz yok" demez), aynı mesaj tek toast (sonner `id`).
- **[ÇEKİRDEK]** Görünürlük SATIRDAN türer, `moduleKey`den değil; tek kaynak `flag-modules.ts` `FLAG_MODULE: Record<FlagRowKey|SystemSettingKey, FlagOwner>` (tamlık TS2741).
- **[ÇEKİRDEK]** Ayar Kaydet çizilen HER satırı tek gövdeye koyar, taslağı SUNUCU CEVABINDAN kurar (cevapta olmayan anahtar hata); yol metni `settingsCategoryTrail`/`settingsCategoryPath`ten.
- **[ÇEKİRDEK]** Kataloğa giren her ekran menüde ya da palette bulunur; yalnız-palet ekran `YALNIZ_PALET`te gerekçeli (taban yalnız aşağı); hub karoları `pages/<Hub>/tiles/*.ts`, liste `scripts/lib/panel-karo-dosyalari.ts`.
- **[ÇEKİRDEK]** Kapalı modül karosu/menü satırı yalnız açabilene (süperadmin; supapta fabrika yöneticisi) soluk + `flagOffHint(<bayrak>)` ile çizilir, gezindirmez; diğerlerine hiç; karar `lib/off-module-visibility.ts` `offEntryMode`; rejim istisnası `REJIM_ISTISNA`da.
- **[ÇEKİRDEK]** Çok yüzeyli ekran adını `TERIM_AD`dan oku (kaynak `Teks-Erp/src/constants/terim.ts`, üç ayna `cp -p`); katalog başlığı = karo başlığı.

### Yasaklar

- **[ÇEKİRDEK]** Ayar yüzeyi bölümden türer (`SECTION_SURFACE`), ayrı alan yazılmaz; adres `settingsCategoryPath` (elle `?tab=` yasak); karo başlığı ↔ `SURFACE_LABEL` ↔ route birebir; tek kabuk `SettingsSurfacePage`.
- **[ÇEKİRDEK]** Demo kartına `superadminOnly` VERME (`demoModeEnabled` `MODULE_FLAG_KEYS`te değil).

### Tuzaklar

- **[ÇEKİRDEK]** Satıcı yüzeyi görünürlüğü ve yazılabilirliği TEK supaplı yüklem `isSuperadminGateOpen` (`superadmin-gate.ts`, kopya yasak); supapsız yükleme dönmeden önce ikinci yazma yüzeyi kur.
- **[ÇEKİRDEK]** Ayar kategorisinde modül = KİLİT (`moduleKey`, `superadminOnly` ikizi); `regime` yalnız `productionEnabled|financeEnabled` için; kilit istemci-taraflı (bant 'dondu' der, 'etkisiz' demez).
- **[ÇEKİRDEK]** Yedi modül şalteri DAİMA `cekirdek`; aidiyet = satırın yönettiği yüzey (`kk1DuplicateGuardEnabled` → üretim, `pricingEnabled` → çekirdek, fason/kartela → `planlanan:*`); süzgeç çağıranda.

### Reçeteler

- **[ÇEKİRDEK]** Karo dışı palet girdileri (`ops:work-order-new`, `def:station-capabilities`) modül kapısını ELLE taşır; 'kapatırsan gizlenir' önizlemesi masaüstü/tableti ayrı sayar; manifesto okunamazsa liste çizilmez.

### Kararlar

- **[PROFİL]** Modül anahtarlarının tek evi Sistem → Modüller (`/system/module-profile`, path değişmez; demo + ayar şifresi kartı orada; karo `superadminOnly`); davranış bayrakları Sistem → Özellik Anahtarları; Güncelleme `admin:settings` ∨ `settings:workstation`.
- **[ÇEKİRDEK]** Yalnız `admin:settings`in yazacağı anahtarı dar izinli kategoriye koyma; ayrı kategoride `permissionAny: [SETTINGS_ADMIN_PERMISSION]`, kimliği `ADMIN_ONLY_CATEGORY_IDS`te.

## Tablet (mobil)

### Değişmezler

- **[PROFİL]** Kısa-kesim → A1 bayrak + eşik FABRİKA ayarı; cihazda yalnız `tamburShortCutA1Override` (server|on|off, bilinmeyen → server); birleştirme tek yer `resolveShortCutConfig`; 'on' eşiği fabrikaya sızmaz; override yalnız süpervizöre.
- **[ÇEKİRDEK]** Kısa-kesim kuralı tek fonksiyon `shortCutQuality.ts` (üç yol aynı fonksiyonu çağırır); yalnız varsayılan kaliteyle ateşler, eşik üstünde geri döner (`shortCutRevert`); A1 katalogda yoksa ateşlemez.

### Kararlar

- **[ÇEKİRDEK]** EKRANSIZ MODÜL (`emanet.enabled`): kapı owner yazan uçların gövdesinde (`assertEmanetWritableTx` 403), adlı `require*Enabled` yok ⇒ `MODULLER`e girmez, `KAPSAM_DISI` gerekçeli; `HideableModule`den dışlanır; anahtar sayısını `test_module_profile §1b` kilitler.
- **[ÇEKİRDEK]** Tablette modül kapısı `useVisibleScreens`: `constants/screenModules.ts` `SCREEN_MODULE` (katalog aynası) kapalı modül ekranlarını kart ve navigator'dan birlikte düşürür; varsayılan yön satır-yok değeri (`productionEnabled = true`, yeni modül `false`).
- **[ÇEKİRDEK]** Makine duruşu rejimi `dokuma ∨ (üretim ∧ uretim.makineDurusTakibi)` TEK yüklem `machineStopRegime` (rota `requireMachineStopRegime`); okuyucuyu başka yerde çağırma, ayrı modül anahtarı açma; yazma yolu `assertStopWritableTx`; `mobile:makine-durus` kurşun/brode/tambur ile sınırlı.
- **[ÇEKİRDEK]** Vardiya tanımı uçları + panel Duruşlar/Vardiya Tanımları makine duruşu rejimiyle açılır: backend `requireMachineStopRegime`, panel tek `machineStopEnabled` (`resolveMachineStopEnabled`; `ROUTE_REGIME`); eşleşme `test_screen_catalog` `KARO_REJIM`te.
- **[PROFİL]** `uretim.makineDurusAcikUyarisi` (varsayılan kapalı) yalnız tablet ipucu: açık duruşta uyarır, gönderim sürer; sunucuda okunmaz, kapı yapılmaz.

## Geçersiz kılınan kurallar — bunlara UYMA

- "`MODULE_FLAG_KEYS` dokuz anahtar, genişletilmez" → GEÇERSİZ 2026-10-24 (yasak yalnız modül olmayan anahtar için).
- Grandfathering "sabit `false` her zaman YASAK" → GEÇERSİZ 2026-09-12 (sıfırdan doğan modülde sabit `false`).
- "Ayar kategorisinde kapalı modül kilitli görünür, gizlenmez" (P5) → GEÇERSİZ; fabrika yöneticisine çizilmez.
- "Genel Ayarlar → Modüller salt-okunur sekme" → GEÇERSİZ; sekme kaldırıldı, tek ev Sistem → Modüller.
- İki yüklemli satıcı kapısı / `isSystemAccountIdentity` → GEÇERSİZ; tek `isSuperadminGateOpen`.
- Süperadmin gizliliği (`visibleUserWhere`/`maskSystemActor`/'Sistem Bakımı') → GEÇERSİZ; hesap gerçek adıyla görünür.
- Ayar şifresi yönetim uçlarında 404 → GEÇERSİZ; 403.
- Süperadmin `.env` tohumlama → GEÇERSİZ; tek yol `npm run superadmin:kur` (gerçek TTY).
- Kısa-kesim ayarı cihazda → GEÇERSİZ; fabrika ayarı + cihaz override.
- Son sipariş bağı reddedilir → GEÇERSİZ; iş emri STOK'a döner (`becomesStock`).

## Çözülmüş çelişkiler

- Sayısal bayrakta `<=0→null` yalnız kısa-kesim eşiğinde; her sayısal anahtarda 0'ın anlamı ayrıca kararlaştırılır.
- `batch.shortNumberEnabled`'ı profil YAZMAZ; değer kod varsayılanı (true) ve panel.

## Açık sorular

- `admin.routes.ts` route katmanında `prisma` kullanımı: servise taşıma mı istisna mı (kullanıcı kararı).
- Panel yorumları bayat (`ModuleProfilePage.tsx` 404, `superadmin-gate.ts` 'Genel Ayarlar → Modüller').
- Mobilde `MODULE_DISABLED` yüzü yok; `finance` kategorisi hâlâ `regime`.
- `FeatureFlagSection.tsx` resolver yorumu kısmen bayat.
- Kök CLAUDE.md parti notu "profil yazar" düzeltilmeli.
- `isSystemAccountIdentity` doğuş notu eksik.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`. Ayrıntı: `Teks-Erp/docs/BEKCI-HARITASI.md`.

Backend: `test_profil_tamligi`, `test_hizmet_ayar_paketi`, `test_seyitoglu_ayar_paketi`, `test_seyitoglu_rota_gecis`, `test_seyitoglu_son_kontrol`, `test_lisans_modul_tavani`, `test_auto_draft_shipment`, `test_emanet`, `test_backup`, `test_blank_grid`, `test_body_limits`, `test_card_login`, `test_cash_negative_guard`, `test_config_bundle`, `test_db_copy_single_start`, `test_demo_mode`, `test_depo_multi_regime_gate`, `test_devere_regime_gate`, `test_dokuma_regime_gate`, `test_makine_durus_rejimi`, `test_makine_durus_acik_uyarisi`, `test_sayac_kalibrasyon`, `test_maliyet_regime_gate`, `test_maliyet_girdileri`, `test_device_assignment`, `test_device_pairing_flag`, `test_document_customization`, `test_document_style`, `test_duplicate_detection`, `test_exchange_rate_fetch`, `test_feature_flag_contract`, `test_finance_flag_off`, `test_finance_invoice`, `test_finance_regime_gate`, `test_goods_receipt`, `test_iplik_regime_gate`, `test_item_price`, `test_kk1_duplicate_guard`, `test_kk1_weight_flag`, `test_kursun_regime_lock`, `test_label_copies`, `test_label_copies_source`, `test_login_methods`, `test_module_flag_off`, `test_module_flags`, `test_ayar_yol_tarifi`, `test_ekran_yolu`, `test_module_grandfathering`, `test_module_profile`, `test_observability_cache`, `test_p2_infra`, `test_production_regime_gate`, `test_regime_gate_scan_aile`, `test_quality_batch_flags`, `test_sack_tags`, `test_sack_weigh_source`, `test_scrap_grade_label`, `test_screen_catalog`, `test_menu_layout`, `test_session_duration_minutes`, `test_settings_password`, `test_setup_ticaret`, `test_shipment_doc_customer_name`, `test_shipping_flags`, `test_single_warehouse_parity`, `test_stock_count`, `test_superadmin`, `test_superadmin_provision`, `test_tambur_over_quantity`, `test_ticaret_regime_gate`, `test_traveler_card_fields`, `test_warehouse_movements`, `test_web_hardening`, `test_workstation_permission`, `test_yarn_stock`, `test_yarn_lot`, `test_rapor_kapisi`, `test_superadmin_visible`, `test_terim_eski_ad`, `test_senaryo_hizmet_veren`, `test_musteri_adi_kodda_yok`

Kök betik: `scripts/test_profil_raporu_kapisi.mjs`.

İstemci: `CommandPalette.test.tsx`⚠️, `command-entries.test.ts`⚠️, `SettingsPasswordDialog.test.tsx`⚠️, `api-config.test.ts`⚠️, `duration.test.ts`⚠️, `machine-config.test.ts`⚠️, `module-flags.test.ts`⚠️, `session-auth.test.ts`⚠️, `shipping-flags.test.ts`⚠️, `superadmin-gate.test.ts`⚠️, `regime.test.ts`⚠️, `production-regime.test.ts`⚠️, `DocumentConfigSection.regime.test.tsx`⚠️, `FeatureFlagSection.module.test.tsx`, `FeatureFlagSection.superadmin.test.tsx`, `SettingsPasswordCard.test.tsx`⚠️, `SettingsSurfacePage.modules.test.tsx`, `SettingsSurfacePage.search.test.tsx`, `docRows.test.ts`, `flag-modules.test.ts`, `settings-groups.test.ts`, `settings-surface.test.ts`, `travelerCardFields.test.ts`, `workstation-rail.test.ts`, `invoiceDraftVisibility.test.ts`, `GoodsReceiptFormDialog.test.tsx`, `goodsReceipt-regime.test.ts`, `orders-regime.test.ts`, `po-regime.test.ts`, `qtyAdjust.test.ts`, `quickShip.test.ts`⚠️, `tabs-regime.test.ts`, `SackStorePage.test.tsx`, `stockCount-regime.test.ts`⚠️, `yarn-regime.test.ts`, `production-regime.test.ts`, `tile-visibility.test.ts`, `RestoreDialog.test.tsx`, `restoreCommand.test.ts`, `DbRestorePage.test.tsx`, `ModuleProfilePage.test.tsx`⚠️, `moduleProfile.helpers.test.ts`, `serverHealth.test.ts`, `SystemHubPage.superadmin.test.tsx`, `tile-route-permission.test.ts`, `multiWarehouseWarning.test.ts`, `pairingGate.test.ts`, `resolveShortCutConfig.test.ts`, `deviceSettingsStore.test.ts`, `docPageSize.test.ts`⚠️, `useVisibleScreens.test.ts`, `screenModules.test.ts`, `weaving-regime.test.ts`, `ProtectedRoute.module.test.tsx`, `ProtectedRoute.transition.test.tsx`, `route-modules.test.ts`, `menu-layout.test.ts`, `Sidebar.menu-layout.test.tsx`, `SystemHubPage.menu-layout.test.tsx`, `MenuLayoutPage.test.tsx`, `useModuleOrder.menu.test.tsx`, `hub-off-hint.test.ts`, `off-module-visibility.test.tsx`, `settings-save-body.test.tsx`, `AlarmClosedNotice.test.tsx`, `settings-scope-mirror.test.ts`, `apiClient.test.ts`, `reportV2.test`, `shortCutQuality.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-09-02 — Modül anahtarları P1 — `arsiv/2026-09.md`
- 2026-09-03 — Tamlık bekçisi + kurulum profilleri (P6) — `arsiv/2026-09.md`
- 2026-09-03 — Dilim 2 davranış bayrakları — `arsiv/2026-09.md`
- 2026-09-04 — [PROFİL] Sistem hub'ı üçe bölündü — `arsiv/2026-09.md`
- 2026-09-04 — [ÇEKİRDEK] Kapalı modülün bayrağı ÇİZİLMEZ — `arsiv/2026-09.md`
- 2026-10-11 — [ÇEKİRDEK] Tezgah alarmı "açtım ama kapalı" — `arsiv/2026-10.md`
- 2026-10-11 — Ayar yolu tek kaynağı — `arsiv/2026-10.md`
- 2026-10-24 — [ÇEKİRDEK] Kapsamsız ayar kategorisi beyanı (`bildirim.gelenKutusuEnabled`) — `arsiv/2026-10.md`
- 2026-10-29 — [ÇEKİRDEK] Makine duruşu dokumasız rejim kapısı (D4-A1) — `arsiv/2026-10.md`
- 2026-10-30 — [ÇEKİRDEK] Panel Makine Duruşları + vardiya tanımı duruş rejiminde (D4-A3) — `arsiv/2026-10.md`
