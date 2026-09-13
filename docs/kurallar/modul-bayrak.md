# Modül anahtarları · Bayraklar · Profiller

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: anlama turu 2026-09-05 (kök `CLAUDE.md` + `docs/history/CLAUDE-NOT-ARSIVI.md` notlarından ayrıştırıldı). Hikâye, ölçüm ve gerekçe arşivde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> Hakem notu: 20 üye (9 birincil): 4 tarihsiz çerçeve notu + 2026-08-19 sayısal/kısa-kesim üçlüsü + 2026-09-02..04 modül/süperadmin/panel paketi. Ezilenler: P5 'kilit ≠ gizleme' 2026-09-04'te bilinçli tersine döndü (kod uyumlu); P2 'Modüller sekmesi salt-okunur' + gizlilik yarısı, P3 '404', P1 'AÇIK: P2', mobil notun 'ikisi de cihazda' paragrafı. Alt CLAUDE 'tünelde 404' ve kök parti notu 'profil yazar' kodla çelişiyor (kod P1/P6'yı uyguluyor). En riskli: (1) 2026-09-04 dar 403 kapısı route içinde `prisma` kullanıp katman kuralını deliyor, eslint sessiz; (2) 403 mesajları hâlâ 'Genel Ayarlar → Modüller' diyor — operatör olmayan sekmeye yönlendirilir; (3) tablette MODULE_DISABLED yüzü yok. Tek yüklem `isSuperadminGateOpen` geri çevrilmeden önce ikinci yazma yüzeyi şart.


## Ortak (backend + panel + tablet)


### Değişmezler

- **[ÇEKİRDEK]** Her kural yazılırken önce sor: ÇEKİRDEK mi PROFİL mi? Ölçüt ve red gerekçesi MODUL-BAYRAK-TASARIM §0/§11, uygulama kuralları §12 bağlayıcı; Ortak Konvansiyonlar bölümünün tamamı ÇEKİRDEK'tir. <sub>(CLAUDE.md:1, CLAUDE.md:279)</sub>
- **[ÇEKİRDEK]** Bir varyasyonu nereye koyacağını DÖRT MEKANİZMAYI SIRAYLA deneyerek bul — **[ÇEKİRDEK]** (seçenek yok) → **VERİ** (aynı kod yolu, farklı gerçek) → **AKSİYON ANINDA SEÇİM** (aynı fabrikada iki kez farklı olabiliyorsa; alan formda SEÇİM olarak görünür, varsayılanı olabilir kilitli olamaz) → **[PROFİL] BAYRAK** (EN SON ÇARE, yalnız gerçekten bir kod yolu açılıp kapanıyorsa): bayrak KOD YOLUNU açıp kapatır, veri AYNI kod yolunda farklı gerçekleri taşır, aksiyon anındaki seçim aynı kod yolunda AYNI ANDA iki farklı gerçeği mümkün kılar — "bu kod çalışsın mı" değil de kaydın İÇERİĞİ olan bir soruyu bayrağa çevirmek, aynı fabrikada iki makine tipi ya da iki tedarik yolu olduğu anda çöker. <sub>(arşiv:2026-09-12 devere)</sub>
- **[ÇEKİRDEK]** Bir varyasyonu veriye çevirdikten sonra İKİ SORU DAHA sor: (a) bu alanın TİPİ de senaryoya göre değişir mi (aynı kolon iki anlam taşımaz — "kimden aldık" ile "kimin malı" ayrı kolonlardır), (b) bu kararı bir GÖRÜNÜRLÜK ya da ALT SINIR cümlesi sessizce iptal ediyor mu (alan bayrağa bağlı gizlenirse ya da masum bir `>= 1` CHECK'i yazılırsa, karar kendini iptal eder ve bir gerçek firma kayıttan düşer). <sub>(arşiv:2026-09-12 devere)</sub>
- **[PROFİL]** PROFİL bu fabrikanın seçimidir (rota, istasyon topolojisi, açık modüller, sayısal ayarlar). Kök CLAUDE.md'deki üretim akışı adnansahin'in ROTASIDIR, sistemin kısıtı değil; devere/çözgü/haşıl **TOPUN ROTASI için** yeni mimari istemez — istasyon kataloğuna istasyon, rotaya adım eklenir. Kendi kimliği ve defteri olan varlıklar (levent, tezgah telemetrisi) **kendi tablolarını ve tx sınırlarını taşıyabilir**; ölçüt *"rotada bir ADIM mı, ayrı bir VARLIK mı"* (kullanıcı kararı 2026-09-13). <sub>(CLAUDE.md:1, CLAUDE.md:17)</sub>
- **[ÇEKİRDEK]** Bir fazın İLAN ETTİĞİ çıktı statik bekçiyle değil AKIŞLA ölçülür: kapı · route · izin · ekran ayrı ayrı yeşilken faz TEK KAYIT üretemeyebilir. Ölçüldü 2026-09-12 — devere Faz 1a'da iplik denyesinin hiçbir YAZMA yüzeyi yoktu, her kart açma denemesi 400'e düşüyordu ve beş statik bekçi yeşildi. · bekçi: `test_devere_regime_gate §7` <sub>(2026-09-12 devere denetimi)</sub>
- **[ÇEKİRDEK]** Modül anahtarını yalnız süperadmin yazar: `flagWriteGuard` modül dalı EN ÖNDE ve `.some` (belge dalı `.every`), SENKRON, `MODULE_FLAG_SUPERADMIN_ONLY`. Supap: hesap YOKSA `admin:settings` yeter + audit; bilinmiyor = VAR (fail-closed); supap dalı tembel DB tazeleme (`resolveSystemAccountLock`). · bekçi: `test_superadmin §A-§M (7 anahtar × 4 senaryo, supap 4 durum)` <sub>(CLAUDE.md:97, CLAUDE.md:96)</sub>
- **[ÇEKİRDEK]** Süperadmin tam yetkisi `getEffectivePermissions` ilk ifadesi `["*"]` (rol değil); `*` körlüğü yasağı (mobil `has('*')`, Electron `hasAdminAccess`, backend `admin:*`); `isSystemAccount` panelden ATANAMAZ (tek yazar `superadmin-olustur.ts`); doğuş yalnız `npm run superadmin:kur`; kurtarma kodu yok. · bekçi: `test_superadmin + test_superadmin_provision (§7 non-TTY zaman aşımlı)` <sub>(CLAUDE.md:97, arşiv:2204, CLAUDE.md:104)</sub>
- **[ÇEKİRDEK]** Yeni davranış bayrağının varsayılanı = BUGÜNKÜ davranış ve hiçbir profilde açık doğmaz; 'varsayılan = bugün' cümlesi ÖLÇÜLMEDEN yazılmaz (warn rejimi bayrak konmadan önce onarıldı: uyarı yok, `warnings` gösterilmiyor, `orderless` ölüydü). · bekçi: `test_shipping_flags + test_quality_batch_flags` <sub>(CLAUDE.md:106)</sub>

### Yasaklar

- **[ÇEKİRDEK]** ÇEKİRDEK her kurulumda aynıdır, bayrakla açılıp kapanmaz: defter semantiği, brüt sevk, idempotency, kilit sırası, atomik claim, fail-closed kapı, sır hijyeni, veri bütünlüğü, UUID/soft delete/audit/beş sağlamlık sınıfı/yıkıcı onay. 'Bizde olmasın' talebinin cevabı bayrak değil süreç/eğitimdir. <sub>(CLAUDE.md:1, CLAUDE.md:279)</sub>
- **[ÇEKİRDEK]** PRODUCTION CANLI = HER canlı kurulum: `migrate reset`/reseed/toplu DELETE yasak; migration geri alınamaz (rollback = yedekten restore); toplu düzeltme script'i dry-run varsayılan, `--apply` öncesi kayıtları listeler; şema provası en eski canlı dump'ta (restore → deploy → bekçiler → profil boot). <sub>(CLAUDE.md:119)</sub>
- **[ÇEKİRDEK]** Kapı takarken 'malın çıktığı BAŞKA yol var mı' KARDEŞ bayrağın kapsamına bakarak sor: fason DOĞRUDAN SEVK `orderRequirement` kapsamında (`orderless` kaçışı). `gradeRequiredEnabled` DAR kapsam — fason kabulü, son-adım finalize, cutOpenFabric, attachRolls DIŞARIDA; genişletme = sıfır-fark ihlali. · bekçi: `test_shipping_flags §2.12 + test_quality_batch_flags (negatif sondalar)` <sub>(CLAUDE.md:106)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Çıkışsız kapı üreten bayrak (`block`, `manualWeightRestricted`) yazılır ama AÇILMAZ; önkoşul PANEL METNİNDE ve bekçi cümleyi metinden ölçer (ölü şerh koruması). Bayrak adı yaptığı işi söyler: `batch.requiredEnabled` reddedildi → `batch.autoCreateEnabled` (parti yaratan uç yok). · bekçi: `test_shipping_flags (metin ölçümü)` <sub>(CLAUDE.md:106)</sub>

### Kararlar

- **[ÇEKİRDEK]** En yetkili hesap GÖRÜNÜR (gizleme süzgeçleri geri getirilmez); görünürlük ≠ kimlik teslimi: `/users/:id/credentials` düz PIN döner → sistem hesabını hedefleyen dar 403 kapısı DURUR; `/users/:id` önek kapısı (alt rotaların BİRLEŞİMİ) KALIR; ayar şifresi yönetim uçları 403, 404 değil. · bekçi: `test_superadmin_visible (30) + test_superadmin §M` <sub>(CLAUDE.md:104, CLAUDE.md:98)</sub>
- **[ÇEKİRDEK]** Özellik Anahtarları'nda KAPALI modülün bayrak satırı fabrika yöneticisine HİÇ çizilmez (satış sınırı görünür — kullanıcı kararı); satır kalmazsa sekme düşer; satıcıda (supap dahil) hiçbir satır gizlenmez, kilit bandı satıcıya kalır. P5'in 'kilit ≠ gizleme'sinin BİLİNÇLİ tersi. · bekçi: `flag-modules.test.ts (12) + SettingsSurfacePage.modules.test.tsx (3)` <sub>(CLAUDE.md:103, CLAUDE.md:102)</sub>

## Backend


### Değişmezler

- **[ÇEKİRDEK]** Modül DB anahtarı `<alan>.enabled` kalıbında (7 anahtar); `modul.*` koda girmez; API alanı camelCase. TEK KAYNAK `src/constants/module-flags.ts` (düz string kümeler — dairesel import yasak); Electron `lib/module-flags.ts` metin-birebir AYNA, akıllı şey eklenmez. · bekçi: `test_module_flags + Electron module-flags.test.ts` <sub>(CLAUDE.md:96)</sub>
- **[ÇEKİRDEK]** Bağımlılık (iplik→ticaret, tezgah→production) İKİ yerde: middleware ÖNCE ön koşulu ölçer (403 `modul:"ticaret", dependent:"iplik"`) + `setFeatureFlags` yazma doğrulaması (400 `MODULE_DEPENDENCY`). Okuyucular HAM değer döner; etkin değer Electron ctx'te tek yerde (`ticaret && iplik`). · bekçi: `test_module_flags` <sub>(CLAUDE.md:96)</sub>
- **[ÇEKİRDEK]** Ham ayar ucu `PUT /admin/settings/:key` modül anahtarına 400 `MODULE_KEY_RESERVED` döner (düz `"true"` string'i `flagWriteGuard`ı atlardı); modül anahtarının tek yazma kapısı `PATCH /api/feature-flags`. · bekçi: `test_module_flags (K7)` <sub>(CLAUDE.md:96, CLAUDE.md:101)</sub>
- **[ÇEKİRDEK]** `PATCH /feature-flags` zinciri: `verifyToken` → `flagWriteGuard` → `requireSettingsPassword` (ASYNC, kapıdan SONRA; süperadmin/belge-only gövde/hash-yok muaf; şifre yalnız `X-Settings-Password` başlığında). Ayar yazan uç kapsamı elle sayılmaz — `src/routes/**` AST tripwire. · bekçi: `test_settings_password (AST tripwire)` <sub>(CLAUDE.md:98, CLAUDE.md:101)</sub>
- **[ÇEKİRDEK]** `ScreenEntry.modul` ZORUNLU aidiyet beyanı (`ModulKey` · `cekirdek:*` · `planlanan:fason|kartela`); GÖRÜNÜRLÜK kuralı DEĞİL — gizleme `visibleWhen`in işi. Tüketicisi 'kapatırsan gizlenir' önizlemesi + tamlık bekçisi; `MODULESIZ_EKRANLAR` muafı bilerek yazılmadı. · bekçi: `test_screen_catalog + derleme (zorunlu alan)` <sub>(CLAUDE.md:101)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Katman sırası Routes → Controllers → Services → Prisma; route/controller'da `lib/prisma` import'u YASAK (ESLint `no-restricted-imports`); ince ayar uçları controller'sız bilinçli istisna, iş mantığı serviste. ⚠️ admin.routes.ts:53/783 bugün ihlal ediyor (bkz. unresolved). · bekçi: `eslint no-restricted-imports (delinmiş)` <sub>(CLAUDE.md:140)</sub>
- **[ÇEKİRDEK]** Kurulum profilleri TS sabiti `constants/module-profiles.ts` (`deploy/` pakete girmez); profil YALNIZ modül anahtarlarını taşır: davranış bayrakları profile GİRMEZ (seed `upsert.update` ile ezer, iki yazar olmaz); fason/kartela anahtarsız → yazılmaz; yedi anahtar her profilde açıkça yazılır. · bekçi: `test_module_profile (§2 tamlık)` <sub>(CLAUDE.md:101)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Grandfathering migration KOŞULLU (`EXISTS rolls` / aktif depo>1) ve değer = DÜNKÜ DAVRANIŞ (ticaret/iplik := finance.enabled, depo := aktif depo>1); dünkü davranışı OLAN modülde sabit `false` yasak. Dünkü davranışı OLMAYAN (sıfırdan doğan, yüzeysiz) modülde dünkü davranış tanım gereği kapalıdır: değer sabit `false` yazılır, koşul aranmaz; anahtar kendi migration'ında damgalanır ve tek dosyaya sabitlenmiş bekçiler dosya LİSTESİNE genişletilir. `readProductionEnabled` satır-yok sigortası (satır yok → true) KORUNUR, `asBoolean`a sadeleştirme yasak. · bekçi: `test_module_grandfathering (SQL VALUES ayrıştırma)` <sub>(CLAUDE.md:96, arşiv:2026-09-12)</sub>
- **[ÇEKİRDEK]** DB'ye YAZAN bekçiler hedef-DB env-override kapısından geçer (`scripts/lib/hedef-db-kapisi`); `Teks-Erp/.env` `tekserp_demo`yu gösterir; hedef `tekserp` (fabrika prod) ise `BEKCI_PROD_ONAY=1` olmadan durur; global durum yazan bekçiler eşzamanlı koşmaz, ajan başına port. · bekçi: `hedef-db-kapisi (koşum kapısı)` <sub>(CLAUDE.md:96)</sub>
- **[ÇEKİRDEK]** Profil job'ı `TEKSERP_PROFIL` yoksa HİÇ yazmaz; satır varsa dokunmaz (tek `createMany skipDuplicates`); bağımlılık/audit/K7 job'da saf ikizle yeniden kurulur; açıklama metinleri üç yazarda birebir; profil uygulama yazma ucu YOK — `GET /admin/module-profile` salt okuma. · bekçi: `test_module_profile (§6 açıklama üçlüsü)` <sub>(CLAUDE.md:101)</sub>
- **[ÇEKİRDEK]** Modül kapısı ADLANDIRILMIŞ olur ve 403 gövdesi `details.code:"MODULE_DISABLED"` taşır · zorlama: bekçi:`scripts/test_module_flag_off.ts` (⚠️ finans kapısını KAPSAMIYOR) · kanıt: `middlewares/module.middleware.ts:76-83` (`modulKapali`) **ve** `middlewares/finance.middleware.ts:21-36` — ikisi de `{ code: "MODULE_DISABLED", modul }` taşır (finans kapısı aynı turda hizalandı); jenerik `requireModule("x")` yasağı `eslint.config.mjs` `GENERIC_REQUIRE_MODULE` · devralınan: yok — açık iş yalnız BEKÇİ KAPSAMIDIR: `test_module_flag_off.ts` dört modülü gezer, `requireFinanceEnabled`in 30 mount'unu ölçmez (İ-04) <sub>(2026-09-13'te `docs/standart/BACKEND.md` [BE-33]'ten taşındı — alan kuralıydı, kod standardı değil; arşiv:2026-09-13)</sub>

## Panel (Electron)


### Değişmezler

- **[ÇEKİRDEK]** Görünürlük SATIRDAN türer, `moduleKey`den DEĞİL (karma kategori gerçek). Tek kaynak `flag-modules.ts` `FLAG_MODULE: Record<FlagRowKey|SystemSettingKey, FlagOwner>` — tamlık derlemede (TS2741), küme bilerek geniş; söz dağarcığı screen-catalog aynası (modül · `cekirdek` · `planlanan:fason|kartela`). · bekçi: `flag-modules.test.ts (tamlık·hiza·karma·planlanan) + tsc TS2741` <sub>(CLAUDE.md:103)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Ayar yüzeyi kategoriye AYRI ALAN olarak yazılmaz, bölümden türer (`SECTION_SURFACE`); adres tek kaynak `settingsCategoryPath` (elle `?tab=` yasak — olmayan sekmeye düşer); karo başlığı ↔ `SURFACE_LABEL` ↔ route birebir; üç yüzey tek kabuk `SettingsSurfacePage`. · bekçi: `settings-surface.test.ts (negatif sonda ①③ kırmızı)` <sub>(CLAUDE.md:99)</sub>
- **[ÇEKİRDEK]** Demo (kurulum beyanı) kartına `superadminOnly` VERİLMEZ — backend `flagWriteGuard` yalnız `MODULE_FLAG_KEYS`i kapsar, `demoModeEnabled` onda değil; olmayan kapıyı çizmek yalandır. Demo'yu fabrikadan uzak tutan şey sayfanın kimlik kapısıdır. · bekçi: `settings-surface.test.ts (negatif sonda ①)` <sub>(CLAUDE.md:99)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** Satıcı yüzeyi görünürlüğü VE yazılabilirliği TEK supaplı yüklem `isSuperadminGateOpen` (`superadmin-gate.ts`, kopya yasak): karo · route · palet · FeatureFlagSection · SettingsSurfacePage · ModuleProfilePage. Supapsız yükleme dönmeden ÖNCE ikinci yazma yüzeyi kur — yoksa modüller açılamaz. · bekçi: `superadmin-gate.test.ts + settings-surface.test.ts + SystemHubPage.superadmin.te` <sub>(CLAUDE.md:99, CLAUDE.md:102, CLAUDE.md:103)</sub>
- **[ÇEKİRDEK]** Ayar kategorisinde modül = KİLİT (`moduleKey`, `superadminOnly` ikizi); `regime` (kategoriyi gizleme) yalnız `productionEnabled|financeEnabled` içindir, modül anahtarlarına genişletilmez (§14 kırmızı). Kilit İSTEMCİ-TARAFLI: bant 'dondu' der, 'etkisiz' DEMEZ — API alt bayrağı yazmaya devam eder. · bekçi: `test_feature_flag_contract §14` <sub>(CLAUDE.md:102, CLAUDE.md:106)</sub>
- **[ÇEKİRDEK]** Yedi modül şalteri DAİMA `cekirdek` (kendini gizleyemez); aidiyet = satırın YÖNETTİĞİ yüzey, enforcement yeri değil (`kk1DuplicateGuardEnabled` → üretim, `pricingEnabled` → çekirdek, fason/kartela → `planlanan:*`); süzgeç ÇAĞIRANDA — görsel saklama kapalı bayrağı PATCH'e yazmaya devam ederdi. · bekçi: `flag-modules.test.ts (şalter·çekirdek) + SettingsSurfacePage.modules.test.tsx` <sub>(CLAUDE.md:103)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Karo döngüsü DIŞINDAKİ palet girdileri (`ops:work-order-new`, `def:station-capabilities`) modül kapısını ELLE taşır (karo bekçisi görmez); 'kapatırsan gizlenir' önizlemesi MASAÜSTÜ ile TABLETİ AYRI sayar; manifesto okunamazsa liste HİÇ çizilmez (boş liste yalanı). · bekçi: `kısmen: command-entries.test; palet elle kapı için yok` <sub>(CLAUDE.md:102)</sub>

### Kararlar

- **[PROFİL]** Modül anahtarlarının TEK EVİ Sistem → Modüller (`/system/module-profile`, path DEĞİŞMEZ; demo + ayar şifresi kartı orada; karo `superadminOnly`); Genel Ayarlar'da sekmesi YOK. Davranış bayrakları Sistem → Özellik Anahtarları; Güncelleme çoklu kapı (`admin:settings` ∨ `settings:workstation`). · bekçi: `settings-surface.test.ts (19) + tile-route-permission.test` <sub>(CLAUDE.md:99)</sub>

## Tablet (mobil)


### Değişmezler

- **[PROFİL]** Kısa-kesim → A1: bayrak + eşik FABRİKA ayarı (panel → Üretim → Tambur); cihazda yalnız üç durumlu override (`tamburShortCutA1Override` server|on|off; varsayılan/bilinmeyen → server); birleştirme TEK yerde `resolveShortCutConfig`; 'on'da eşik cihazınki, fabrikaya SIZMAZ; override yalnız süpervizöre. · bekçi: `resolveShortCutConfig.test.ts + deviceSettingsStore.test.ts (5)` <sub>(CLAUDE.md:335, CLAUDE.md:70)</sub>
- **[ÇEKİRDEK]** Kısa-kesim kuralı `shortCutQuality.ts` tek fonksiyon — ekrandaki üç yol (elle yazım · makine ölçümü · kalanı kes) aynı fonksiyonu çağırır, kopyalanmaz; yalnız VARSAYILAN kaliteyle ateşler, otomatik A1 eşik üstünde geri döner (`shortCutRevert`); A1 katalogda yoksa ateşlemez (fail-closed). · bekçi: `shortCutQuality.test.ts (12)` <sub>(CLAUDE.md:335)</sub>

### Kararlar

- **[?]** Mobilde `MODULE_DISABLED`'ın kullanıcı yüzü HÂLÂ YOK (`useVisibleScreens.conditional` boş, `announceFailure` dalı yazılmadı) — P1'in açık maddesi; tablet kapalı modülün ekranını çizer, istek 403 alır. <sub>(CLAUDE.md:96)</sub>

## Geçersiz kılınan kurallar — bunlara UYMA

- **KISMI** `R:2026-09-02__2026-09-02-03-modul-anahtarlari` (grandfathering "sabit `false` YASAK") → `2026-09-12 — Devere · levent`: yasak yalnız dünkü davranışı OLAN modüller içindir. Sıfırdan doğan, yüzeyi olmayan modülde değer sabit `false` yazılır — kod ve bekçi `kumasTeknik`/`tezgah` için zaten böyle yapıyordu (`20260902230000` migration'ı, `test_module_grandfathering` false'u şart koşuyor). GEÇERSİZ → 2026-09-12.

- **KISMI** `R:2026-09-03__2026-09-03-panel-modul-kapilari` → `R:2026-09-04__2026-09-04-cekirdek-kapali-modulun`: P5'in 'ayar kategorisinde modül = KİLİT, gizleme DEĞİL' kararı tersine döndü: kapalı modülün bayrak satırı fabrika yöneticisine HİÇ çizilmez (satır bazlı `filterCategoryByModules`), kategoriden satır kalmazsa sekme düşer; kilit bandı yalnız satıcı görünümünde kalır. Gerekçe: modül anahtarları aynı gün kendi ekranına taşındı, geri dönüş yolu orada. ✅ çürütmeden geçti
- **KISMI** `R:2026-09-03__2026-09-03-superadmin-p2-satici` → `R:2026-09-04__2026-09-04-profil-sistem-hub`: P2 Q5 'Modüller sekmesi fabrika adminine GÖRÜNÜR ama SALT-OKUNUR + bant' geçersiz: Genel Ayarlar → Modüller sekmesi KALDIRILDI; modül anahtarlarının tek evi Sistem → Modüller (`/system/module-profile`). Süperadmin hesabı doğmuşsa fabrika yöneticisi sayfayı hiç AÇAMAZ; hesap yoksa (supap) görür VE yazar. ✅ çürütmeden geçti
- **KISMI** `R:2026-09-03__2026-09-03-panel-modul-kapilari` → `R:2026-09-04__2026-09-04-profil-sistem-hub`: 2026-09-03'ün iki yüklemli satıcı kapısı (yazma supaplı `isSuperadminGateOpen`, görünürlük supapsız `isSystemAccountIdentity`) TEK supaplı yükleme indi; `isSystemAccountIdentity` silindi. 'Sistem Profili' adı 'Modüller' oldu, route path değişmedi. ✅ çürütmeden geçti
- **KISMI** `R:2026-09-03__2026-09-03-superadmin-p2-satici` → `R:2026-09-04__2026-09-04-en-yetkili-hesap`: P2'nin GİZLİLİK yarısı geri alındı: `visibleUserWhere`/`maskSystemActor`/`VISIBLE_*`/`SQL_ACTOR_*`/`blockSystemAccountTarget` ve 'Sistem Bakımı' takma adı silindi; hesap her yüzeyde gerçek adıyla görünür. YETKİ yarısı (`["*"]`, modül kilidi, supap, sır hijyeni) yürürlükte. ✅ çürütmeden geçti
- **KISMI** `R:2026-09-03__2026-09-03-ayar-sifresi-p3` → `R:2026-09-04__2026-09-04-en-yetkili-hesap`: Ayar şifresi yönetim uçları süperadmin dışı kimlikte 404 yerine 403 döner ('403 varlığı doğrular' gerekçesi, varlık açılınca düştü); fonksiyon adı `requireSystemAccountOr404` bayat kaldı. ✅ çürütmeden geçti
- **KISMI** `R:2026-09-02__2026-09-02-03-modul-anahtarlari` → `R:2026-09-03__2026-09-03-superadmin-p2-satici`: P1'in AÇIK maddesi 'P2 süperadmin (flagWriteGuard üçüncü dal MODULE_FLAG_KEYS.some)' kapandı: dal EN ÖNDE, `.some`, senkron, `MODULE_FLAG_SUPERADMIN_ONLY` + emniyet supabı. P1'in diğer açıkları (mobil MODULE_DISABLED yüzü, /api/rolls uç-bazlı kapı, finance regime) hâlâ açık. ✅ çürütmeden geçti
- **KISMI** `R:2026-09-03__2026-09-03-superadmin-p2-satici` → `A:2026-09-03__2026-09-03-superadmin-dogusu-p8`: Süperadmin doğuşunda `.env` tohumlama yolu kaldırıldı; tek yol `npm run superadmin:kur` (gerçek TTY zorunlu, fail-loud; idempotent; mevcut kullanıcı yükseltilmez). Boot job'ı hesap yaratmaz, yalnız kilit defterini tazeler + eski `SUPERADMIN_*` satırları için uyarı (yalnız anahtar adı). ✅ çürütmeden geçti
- **KISMI** `M:2026-08-19__tambur-kisa-kesim-otomatik-a1-2026` → `R:2026-08-19__2026-08-19-2-paket-sektor`: Kısa-kesim → A1 kuralının bayrak+eşiği CİHAZDAN FABRİKA ayarına (feature-flags) taşındı; cihazda yalnız üç durumlu override (`tamburShortCutA1Override` server|on|off, varsayılan server), birleştirme `resolveShortCutConfig`. Ateşleme/geri dönüş kuralı DEĞİŞMEDİ; mobil notun eski paragrafı ('ikisi de cihazda') tarihseldir. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-19__2026-08-19-2-paket-sektor` → `R:2026-08-21 — İş emri TİPİ bağın aynası (küme dışı, CLAUDE.md:79)`: 2. paketin ④ maddesi 'son-bağ kuralı istemci aynası (son bağ reddedilir)' değişti: son bağ artık reddedilmez, iş emri ORDER_PRODUCTION'dan STOK'a döner; mobil ayna `canUnlinkOrderLine` → `becomesStock`. ✅ çürütmeden geçti

## Çözülmüş çelişkiler

- `B:undated__uc-bir-module-aitse-router-adlandirilmis` ↔ `R:2026-09-02__2026-09-02-03-modul-anahtarlari`: Kod P1'i uyguluyor: modül kapısı tünelde de 403 + MODULE_DISABLED döner; uzaktaki 404 yalnız sabit REMOTE_DENIED listesi içindir, modül kapısı o listede yok. Alt CLAUDE (Teks-Erp/CLAUDE.md:315) 'tünelde 404' cümlesi yanlış — silinmeli.
- `B:2026-08-19__sayisal-feature-flag-eklerken-2026-08` ↔ `kök CLAUDE.md:84 — 2026-08-21 Fason kabulü ÇEKME notu (küme dışı)`: Kod ikisini ALAN BAZLI uzlaştırıyor: `<=0→null` kalıbı yalnız kısa-kesim eşiğinde; fason toleransı 0'ı geçerli değer sayar ve kalıbı kullanmaz. Alt CLAUDE cümlesi genel reçete gibi okunuyor — 'her sayısal anahtarda 0'ın anlamı ayrıca kararlaştırılır' diye daraltılmalı.
- `R:2026-09-03__2026-09-03-tamlik-bekcisi-profiller` ↔ `kök CLAUDE.md:163 — Parti no P01…P99 'Profil gerçeği' şerhi (küme dışı)`: Kod P6'yı uyguluyor: `batch.shortNumberEnabled`'ı ne seed ne profil yazar; değer kod varsayılanı (true) ve panel. CLAUDE.md:163'teki 'kurulum profili yazar' cümlesi bugün yanlış — 'profil YAZMAZ; kapalı rejim panelden/ayar dosyasından' diye düzeltilmeli (parti kümesi hakemine).

## Açık sorular

- admin.routes.ts:53 `import prisma` + :783 `prisma.user.findUnique` (2026-09-04 dar 403 kapısı) route katmanında — Teks-Erp/CLAUDE.md:142 kuralı ve eslint.config.mjs:59-73 `no-restricted-imports` ihlali, satır bazlı disable/TODO yok. Servise taşınacak mı, bilinçli istisna mı? Kullanıcı kararı.
- Kullanıcıya dönen metinler bayat: module.middleware.ts:80,121 ve admin.routes.ts:1491 hâlâ 'Genel Ayarlar → Modüller' der (2026-09-04'ten beri Sistem → Modüller); ModuleProfilePage.tsx:391 yorumu 'başka kimlikte 404 döner' (artık 403); superadmin-gate.ts:34 aynı eski adres. Düzeltme turu ister.
- P1'in AÇIK maddeleri hâlâ açık: mobilde MODULE_DISABLED kullanıcı yüzü yok (useVisibleScreens.ts:38 boş); `/api/rolls` uç-bazlı kapı yok; `finance` kategorisi hâlâ `regime` (gizleme) — P5 'sabah kararına bırakıldı' (arşiv 2151) ama karar kaydı bulunamadı.
- FeatureFlagSection.tsx:120-124 yorumu '§3.6 tek-resolver backend'de HENÜZ YOK' der; Dilim 2 yedi ebeveynli bayrağa resolver ekledi (system-setting.service.ts:3892-3939). Verdiği kk1 örneği çekirdek olduğu için hâlâ doğru, genel cümle kısmen bayat.
- Kök CLAUDE.md:163 'Ayar değerini kurulum profili yazar' (batch.shortNumberEnabled) — kod P6'yı uyguluyor (profil `bayraklar` boş, yazan yok, kod varsayılanı true). Parti kümesi hakemine: cümle düzeltilmeli.
- Teks-Erp/CLAUDE.md:315 'tünelde 404' — kodda karşılığı yok (module.middleware.ts:76-83 koşulsuz 403; remote-access 404 listesi sabit). Sil.
- P5 (2026-09-03) satıcı kapısı 'iki yüklem' ayrımı yalnız 2026-09-04 arşivinde (2233) anlatılıyor; P5'in kendi kök/arşiv metni `isSystemAccountIdentity` adını hiç anmıyor — silinen yüklemin doğuş notu eksik, tarihsel iz yalnız superadmin-gate.ts:43 yorumunda.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (tek testte tip kapısı atlanır) · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`.

**Ne ölçtükleri, DB gerektirip gerektirmedikleri ve bayatlık işaretleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → bu alanın bölümü.** ⚠️ = orada gerekçesi yazılı bayatlık şüphesi.

Backend: `test_auto_draft_shipment`, `test_backup`, `test_blank_grid`, `test_body_limits`, `test_card_login`, `test_cash_negative_guard`, `test_config_bundle`, `test_db_copy_single_start`, `test_demo_mode`, `test_depo_multi_regime_gate`, `test_devere_regime_gate`, `test_device_assignment`, `test_device_pairing_flag`, `test_document_customization`, `test_document_style`, `test_duplicate_detection`, `test_exchange_rate_fetch`, `test_feature_flag_contract`, `test_finance_flag_off`, `test_finance_invoice`, `test_finance_regime_gate`, `test_goods_receipt`, `test_iplik_regime_gate`, `test_item_price`, `test_kk1_duplicate_guard`, `test_kk1_weight_flag`, `test_kursun_regime_lock`, `test_label_copies`, `test_login_methods`, `test_module_flag_off`, `test_module_flags`, `test_module_grandfathering`, `test_module_profile`, `test_observability_cache`, `test_p2_infra`, `test_production_regime_gate`, `test_quality_batch_flags`, `test_sack_tags`, `test_sack_weigh_source`, `test_scrap_grade_label`, `test_screen_catalog`, `test_session_duration_minutes`, `test_settings_password`, `test_setup_ticaret`, `test_shipment_doc_customer_name`, `test_shipping_flags`, `test_single_warehouse_parity`, `test_stock_count`, `test_superadmin`, `test_superadmin_provision`, `test_tambur_over_quantity`, `test_ticaret_regime_gate`, `test_traveler_card_fields`, `test_warehouse_movements`, `test_web_hardening`, `test_workstation_permission`, `test_yarn_stock`

İstemci: `CommandPalette.test.tsx`⚠️, `command-entries.test.ts`⚠️, `SettingsPasswordDialog.test.tsx`⚠️, `api-config.test.ts`⚠️, `boss-menu.test.ts`⚠️, `duration.test.ts`⚠️, `machine-config.test.ts`⚠️, `module-flags.test.ts`⚠️, `session-auth.test.ts`⚠️, `shipping-flags.test.ts`⚠️, `superadmin-gate.test.ts`⚠️, `regime.test.ts`⚠️, `production-regime.test.ts`⚠️, `DocumentConfigSection.regime.test.tsx`⚠️, `FeatureFlagSection.module.test.tsx`, `FeatureFlagSection.superadmin.test.tsx`, `SettingsPasswordCard.test.tsx`⚠️, `SettingsSurfacePage.modules.test.tsx`, `SettingsSurfacePage.search.test.tsx`, `docRows.test.ts`, `flag-modules.test.ts`, `settings-groups.test.ts`, `settings-surface.test.ts`, `travelerCardFields.test.ts`, `workstation-rail.test.ts`, `invoiceDraftVisibility.test.ts`, `GoodsReceiptFormDialog.test.tsx`, `goodsReceipt-regime.test.ts`, `orders-regime.test.ts`, `po-regime.test.ts`, `qtyAdjust.test.ts`, `quickShip.test.ts`⚠️, `tabs-regime.test.ts`, `SackStorePage.test.tsx`, `stockCount-regime.test.ts`⚠️, `yarn-regime.test.ts`, `production-regime.test.ts`, `tile-visibility.test.ts`, `RestoreDialog.test.tsx`, `restoreCommand.test.ts`, `DbRestorePage.test.tsx`, `ModuleProfilePage.test.tsx`⚠️, `moduleProfile.helpers.test.ts`, `serverHealth.test.ts`, `SystemHubPage.superadmin.test.tsx`, `tile-route-permission.test.ts`, `multiWarehouseWarning.test.ts`, `pairingGate.test.ts`, `resolveShortCutConfig.test.ts`, `deviceSettingsStore.test.ts`, `docPageSize.test.ts`⚠️

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-09-02 · 2026-09-02/03 — Modül anahtarları P1: `finance.enabled` kalıbı beş modüle çoğaldı, üretim kapıya TERFİ etti, g — `CLAUDE-NOT-ARSIVI.md:2033-2056`
- 2026-09-03 · 2026-09-03 — Tamlık bekçisi + kurulum profilleri (P6): profil dosyası pakete HİÇ GİRMİYORDU — `CLAUDE-NOT-ARSIVI.md:2134-2144`
- 2026-09-03 · 2026-09-03 — Dilim 2 davranış bayrakları: varsayılan = BUGÜN, ve "çıkışsız kapı" bir tasarım hatasıdır — `CLAUDE-NOT-ARSIVI.md:2185-2203`
- 2026-09-04 · 2026-09-04 — [PROFİL] Sistem hub'ı üçe bölündü: satıcı anahtarı ≠ fabrika tercihi ≠ makine bakımı — `CLAUDE-NOT-ARSIVI.md:2217-2276`
- 2026-09-04 · 2026-09-04 — [ÇEKİRDEK] Kapalı modülün bayrağı ÇİZİLMEZ: satış sınırı ekranda görünür olmalı — `CLAUDE-NOT-ARSIVI.md:2277-2344`