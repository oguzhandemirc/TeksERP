# Keşif · Cihaz · Ağ · Donanım

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: anlama turu 2026-09-05 (kök `CLAUDE.md` + `docs/history/CLAUDE-NOT-ARSIVI.md` notlarından ayrıştırıldı). Hikâye, ölçüm ve gerekçe arşivde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> Hakem notu: 40 üye: kök Phase-1 donanım kuralı, backend/Electron/mobil alt-CLAUDE mimari+paket envanterleri, keşif (installationId + kademeli port), cihaz onay kapısı, uzak erişim, güncelleme kanalı. Beş ezilme + iki çelişki bulundu. EN RİSKLİ: kök CLAUDE.md:117 hâlâ mutlak 'gerçek donanım kodu yazma' diyor, oysa Electron main (scale.ipc.ts serialport) ve mobil HAL (btClassic.transport.ts) gerçek sürücü taşıyor — kural bugün YALNIZ backend için canlı; kökten okuyan ajan meşru işi reddeder. İkinci risk: 'renderer localStorage'a TOKEN YAZMAZ' web derlemesinde (dist-web/BossShell) bilinçli olarak delinmiş. Üç envanter (Electron komutlar, iki Allowed Packages, middlewares) ölçülebilir biçimde bayat.


## Ortak (backend + panel + tablet)


### Değişmezler

- **[ÇEKİRDEK]** Donanım fail-closed: cihaz yok / bond edilemedi / okunamadı / değer ≤ 0 → NET Türkçe toast ve mutasyon HİÇ ÇAĞRILMAZ. Sessiz sahte değer yok; donanım/cihaz yoksa hata verilir, varsayılana sapılmaz. · bekçi: `mobil/src/hooks/useSackWeigh.test.tsx` <sub>(CLAUDE.md:328, CLAUDE.md:221)</sub>
- **[ÇEKİRDEK]** Uydurulmuş değer canlı veriye GİRMEZ: istemci sahte değeri üretir ama `source:'SIMULATED'` olarak BEYAN eder, kararı backend verir. Toast'ta açık 'SİMÜLASYON' ibaresi şart. Elle giriş (`source:'MANUAL'`) korumadan muaftır — kantarsız/arızalı durumun kaçış yolu. · bekçi: `Teks-Erp/scripts/test_sack_weigh_source.ts + mobil/src/hooks/useSackWeigh.test.t` <sub>(CLAUDE.md:329)</sub>
- **[ÇEKİRDEK]** Keşifte BİR SATIR = BİR SUNUCU: tekilleştirme ölçütü adres değil `installationId` (`groupByInstallation`); diğer adresler grubun içinde durur, atılmaz. Sıra ÖNCE tekilleştir SONRA sırala (yoksa 'tek aday' kapısı çok adresli sunucuda hiç ateşlemez). · bekçi: `Electron/src/test/discovery-logic.test.ts + mobil/src/lib/discovery.test.ts · di` <sub>(CLAUDE.md:109)</sub>
- **[ÇEKİRDEK]** Keşif kuralı TEK METİN olarak `>>> KEŞİF-İKİZ BAŞLANGIÇ` / `<<< KEŞİF-İKİZ SON` bloğunda yaşar; mobil Electron'u import EDEMEZ, bu yüzden iki bekçi bloğu BİREBİR kıyaslar (her koşucu kendi tarafından bakar, tek CI adımına bağlı kalınmaz). · bekçi: `Electron/src/test/discovery-logic.test.ts + mobil/src/lib/discovery.contract.tes` <sub>(CLAUDE.md:109, CLAUDE.md:110)</sub>
- **[ÇEKİRDEK]** YEDEK PORTTA KİMLİK ZORUNLU (`identityRequiredForPort`): `/health` `{"status":"UP"}` orada aday saymaya YETMEZ (Actuator aynısını basar; 8080'deki rastgele web sunucusu 'bulundu' görünürdü). Varsayılan portta kimliksiz adaya izin BİLİNÇLİDİR — yedek porta genişletme. · bekçi: `discovery-logic.test.ts (yedek portta /health açılınca 9+1 ❌)` <sub>(CLAUDE.md:110)</sub>
- **[ÇEKİRDEK]** Yeni cihazın doğuş durumu `devicePairingRequired` bayrağından TÜRER: bayrak KAPALIYSA cihaz APPROVED doğar. `announce` koşulsuz PENDING yaratmaz; enum'a üçüncü (otomatik-onaylı) değer EKLENMEZ — ayrım audit olayında (`DEVICE_AUTO_APPROVED`) yaşar. · bekçi: `Teks-Erp/scripts/test_device_pairing_flag.ts (18)` <sub>(CLAUDE.md:108)</sub>
- **[ÇEKİRDEK]** Uzak/LAN ayrımı SOKETTEN çözülür (`req.socket.localPort`); `clientType` gövdeden gelir ve GÜVENLİK SINIRI DEĞİLDİR. Tünel dinleyicisi YALNIZ `127.0.0.1`e bağlanır — uzak portu (4001) `0.0.0.0`a açma, ayrım komple çöker. İki dinleyici İKİ PROCESS DEĞİLDİR. · bekçi: `Teks-Erp/scripts/test_remote_access_guard.ts:147-152` <sub>(CLAUDE.md:95)</sub>
- **[ÇEKİRDEK]** Uzak `/api` isteklerinde Cloudflare Access JWT ikinci katmandır ve FAIL-CLOSED'dır (politika panelden kalkarsa sessiz açık değil gürültülü arıza). JWKS önbelleğinde TTL TAZELİKTİR, geçerlilik değil: süre dolunca bayat anahtar döner + arka planda tazelenir; önbellek HİÇ dolmadıysa fail-closed KALIR. · bekçi: `Teks-Erp/scripts/test_remote_access_guard.ts` <sub>(CLAUDE.md:95)</sub>
- **[ÇEKİRDEK]** Uzakta PIN/kart/cihaz/keşif/swagger uçları 404 döner — 403 VERME, varlığı doğrulayıp keşfe davet eder. `quickPin` 6 hanedir, DÜZ METİN saklanır, sistem genelinde `@unique`tir ve tek başına kimlik sayılır — hiçbir yüzeyden sızdırılmaz. · bekçi: `test_remote_access_guard.ts` <sub>(CLAUDE.md:95)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Backend'e seri port / donanım polling GİRMEZ. Gerçek makine verisi geldiğinde de fabrika LAN'ında AYRI bir toplayıcı ajan okur ve API'den basar (tablet gibi bir istemci); backend tek-process kalır. <sub>(CLAUDE.md:117)</sub>
- **[ÇEKİRDEK]** Bayrak sonradan AÇILIRSA otomatik onaylanmış cihazlar APPROVED KALIR (ileriye dönük kapı; retroaktif düşürme vardiyayı kilitler — gözden geçirme yolu `revoke`). Mevcut PENDING ya da revoke edilmiş cihaz ise TERFİ ETMEZ: public bir uç yönetici kararını geri alamaz. · bekçi: `test_device_pairing_flag.ts (mevcut PENDING terfi edince 1 ❌)` <sub>(CLAUDE.md:108)</sub>
- **[ÇEKİRDEK]** Yeni paket eklemeden ÖNCE onay alınır (hem Electron hem mobil Allowed Packages tabloları). ⚠️ İki tablo da ölçülebilir biçimde BAYAT — envanteri kanıt saymadan önce `package.json` ile karşılaştır. <sub>(CLAUDE.md:335, CLAUDE.md:226)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** `DISCOVERY_PORTS = [4000, 5000, 3000, 8080]` TEK KAYNAKTIR ve `DISCOVERY_DEFAULT_PORT` ondan TÜRER. İkinci bir gerçek yazma: ayrışırsa mDNS çalışmaya devam eder, yalnız tarama yanlış porta bakar — saha tarifi 'bazen buluyor'. Liste KISA tutulur (maliyet host × port ile doğrusal). · bekçi: `discovery-logic.test.ts negatif sondası ('varsayılan port listenin ilki olmaktan` <sub>(CLAUDE.md:110)</sub>
- **[ÇEKİRDEK]** Onay kapısı kararını SUNUCU verir: `/devices/status` ve `/devices/announce` cevapları `pairingRequired` taşır, koşul `pairingRequired && status !== "APPROVED"`. Mobilde tek yüklem `navigation/pairingGate.ts`; `??` LOAD-BEARING (sunucu kararı bayat uç bayrağını EZER) — `||`/`&&` yazma. · bekçi: `mobil/src/navigation/pairingGate.test.ts (9; ?? → || sondasında 1 ❌)` <sub>(CLAUDE.md:108)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Keşif portu KADEMELİ: ① mDNS (portu ilandan) → ② tarama yalnız varsayılan portta → ③ YALNIZ ①+② sıfır aday döndürdüyse yedek portlar sırayla, aday bulan İLK portta DURARAK. Sunucu bulunduysa genişleme HİÇ koşmaz (maliyet-sıfır kuralı). · bekçi: `Electron/src/test/discovery-logic.test.ts (44) + mobil/src/services/discovery.se` <sub>(CLAUDE.md:110)</sub>

### Kararlar

- **[ÇEKİRDEK]** Donanım sürücüsü İSTEMCİ katmanında yaşar (Electron main IPC · mobil HAL) ve simülasyon per-cihaz VERİ bayrağıdır (`PeripheralDevice.simulate`) — kodda gömülü 'gerçek donanım ASLA' kuralı DEĞİL. <sub>(CLAUDE.md:224, CLAUDE.md:218, CLAUDE.md:117)</sub>

## Backend


### Değişmezler

- **[ÇEKİRDEK]** helmet İKİ AYRI ÖRNEK kurulur (HSTS/CSP-upgrade LAN'a sızarsa panel kullanıcının HSTS önbelleğinde kilitlenir) ve dispatcher'ın adı `helmetMiddleware` olmak ZORUNDADIR (bekçi ada bakar). · bekçi: `Teks-Erp/scripts/test_middleware_order.ts:37` <sub>(CLAUDE.md:95)</sub>
- **[ÇEKİRDEK]** Katalog ATAMA İÇERMEZ — 'katalog koda, atama script'e/panele'. Unutulan atamayı görünür kılan tek yüzey 'N yetki hiçbir kullanıcıda yok' bandıdır. Yeni ekran görünmüyorsa sırayla bak: (1) satır DB'de mi, (2) kullanıcıya atanmış mı, (3) kullanıcı yeniden giriş yaptı mı (JWT bayat). <sub>(CLAUDE.md:240)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Katman sırası Routes → Controllers → Services → Prisma; alt katman atlamak ve route/controller'da `lib/prisma` import'u YASAK. Bilinçli istisna: ince read/ayar uçları (admin/dashboard/feature-flag/customer-branch/production-balance/station-capability) controller'sızdır — Zod parse + servise delege. · bekçi: `Teks-Erp/eslint.config.mjs:59-73 (bugün geçmiyor)` <sub>(CLAUDE.md:140, CLAUDE.md:145, CLAUDE.md:146)</sub>
- **[PROFİL]** DB adını dokümana SABİTLEME, `.env`den doğrula (`\l` / `SELECT current_database()`) — bayat komut örneği var olmayan DB'ye `ALTER` çalıştırtır. Bugün dev `tekserp_demo` (port 55433), saha `tekserp`. Slow query log (>500ms) yalnız üretimde açık, dev'de -1. <sub>(CLAUDE.md:275)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Testler SERVER'SIZ entegrasyondur: service sınıfı + prisma doğrudan import edilir, HTTP yok; `npx tsx scripts/test_X.ts` tek tek koşar, toplu koşucu `npm test` = `tsx scripts/run-all-tests.ts` (tüm `test_*.ts`'i toplar). <sub>(CLAUDE.md:356)</sub>

### Kararlar

- **[ÇEKİRDEK]** TOTP kendi kodumuzdur ve RFC 4226/6238 vektörleriyle DIŞARIDAN doğrulanır; kurulumun TEK yolu yöneticinin açtığı 15 dakikalık penceredir (TOFU'nun 2FA'da koruduğu tek senaryoyu kapatır). <sub>(CLAUDE.md:95)</sub>

## Panel (Electron)


### Değişmezler

- **[ÇEKİRDEK]** Keşif adayı kendi PORTUNU taşır (`baseUrl` = `http://host:5000`); hangi portların gerçekten tarandığı `DiscoveryState.scan.ports` ile tanı ekranlarında görünür. · bekçi: `discovery-logic.test.ts (aday portu taşımayınca 18 ❌)` <sub>(CLAUDE.md:110)</sub>
- **[ÇEKİRDEK]** `webPreferences`ta `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` ZORUNLU — üçünden biri gevşetilmez. <sub>(CLAUDE.md:60)</sub>
- **[ÇEKİRDEK]** mDNS yüklemesi TEMBEL + try/catch'tir (`electron/discovery/mdns-browser.ts`): paket kaybolsa bile uygulama açılır, keşif alt ağ taramasına düşer. `bonjour-service` saf JS'tir — `electron:rebuild` ve `asarUnpack` GEREKMEZ (asarUnpack yalnız serialport/node-hid/bindings için). <sub>(CLAUDE.md:335)</sub>
- **[PROFİL]** Panel sürüm çıkarırken `package.json > version` ARTIRILMALI — artırılmazsa kurulu paneller 'en güncelim' der ve yeni setup'ı HİÇ indirmez. Yayın adresi TEK KAYNAK: `shared/update-feed.ts` ↔ `package.json > build.publish`; ayrışma SESSİZ arıza üretir. · bekçi: `Electron/src/test/update-feed-url.test.ts` <sub>(CLAUDE.md:78)</sub>
- **[ÇEKİRDEK]** Ekran manifestosu okunamazsa 'gizlenecekler' listesini HİÇ ÇİZME — boş liste 'hiçbir şey gizlenmeyecek' YALANI basar. 'Kapatırsan gizlenir' önizlemesinde masaüstü ve tablet ekranları AYRI sayılır (tableti yutmak satıcıya kapatmanın bedelini gizler). <sub>(CLAUDE.md:102)</sub>
- **[ÇEKİRDEK]** Tek seferlik baskı bayrağı (`?rowNotes=1`) kalıcı ayarı pure OR ile EZER; ne ayara ne donmuş snapshot'a yazılır, yeni belge versiyonu doğurmaz. OR yalnız renderer'da TEK yerde (efektif kolon ayarı kurulurken) uygulanır; checkbox `DocDef.supportsRowNotes` ile çizilir. · bekçi: `Teks-Erp/scripts/test_sack_note_document.ts` <sub>(CLAUDE.md:261)</sub>
- **[ÇEKİRDEK]** Electron yığını: Tailwind 4 (`@import "tailwindcss"` + `@theme`, `tailwind.config.js` YOK) · main ESM (`import.meta.url` + `path.dirname(fileURLToPath(...))`, `__dirname` yok) · electron-store 11 ESM-only (`Store` import). · bekçi: `npm run typecheck` <sub>(CLAUDE.md:391, CLAUDE.md:394, CLAUDE.md:396)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Renderer (src/) `electron`, `fs`, `path`, `child_process`, `os`, `net` import ETMEZ; native API'ye yalnız `window.api` üzerinden ulaşır ve `window.api` yalnız `electron/preload.ts`te `contextBridge.exposeInMainWorld` ile kurulur. Main process HTTP BAŞLATMAZ — tek geçit `src/services/apiClient.ts`. <sub>(CLAUDE.md:60)</sub>
- **[ÇEKİRDEK]** Electron renderer'ında token localStorage'a YAZILMAZ — main tarafında `safeStorage` + `electron-store` ile şifreli saklanır. İSTİSNA: `window.api` olmayan WEB derlemesinde (dist-web/patron) `webStore` bilinçli olarak localStorage kullanır; `window.api` varsa oraya asla düşülmez. <sub>(CLAUDE.md:60)</sub>
- **[ÇEKİRDEK]** Ayar kategorisinin modül bağını `moduleKey` (KİLİT, `superadminOnly` ikizi) ile kur; `regime` (rejim gizlemesi) alanını modül anahtarlarına AÇMA — §14 bekçisi kırmızı verir. Kilit İSTEMCİ-TARAFLIDIR: bant 'dondu' der, API hâlâ yazar; bant 'etkisiz' DEMEZ. · bekçi: `settings-groups.test.ts + flag-modules.test.ts` <sub>(CLAUDE.md:102)</sub>
- **[ÇEKİRDEK]** Süperadmin kapısını `Electron/src/lib/superadmin-gate.ts`ten import et; İKİNCİ BİR KOPYA YAZMA — kopyaların birinde supap unutulursa süperadminsiz kurulumda ekran hiç açılmaz. Karo döngüsünün DIŞINDA kalan palet girdilerine kapıyı ELLE taşı (karosuz ekranda palet tek keşif yoludur). <sub>(CLAUDE.md:102)</sub>

### Tuzaklar

- **[PROFİL]** `dist-web` backend paketine GİRER (drift imkânsız); eksikse kök sessizce durum sayfasına düşer — bu yüzden derleme kapıları vardır. `BossShell` sekme sistemini bypass eder ama router altyapısını KULLANIR (kendi memory router'ı geri okunu sessizce öldürür); hash `useHashPath` ile REAKTİF okunur. · bekçi: `Electron/src/test/boss-shell.test.ts` <sub>(CLAUDE.md:95)</sub>
- **[ÇEKİRDEK]** `bonjour-service` sürümü SABİT ('^' yok — sonraki ana sürüm ESM-only olup `createRequire` yolunu kırar) ve `dependencies`te DURMAK ZORUNDA: `externalizeDepsPlugin()` yalnız orayı okur, devDependencies'te kurulu uygulamada MODULE_NOT_FOUND ('dev'de çalışır, kurulumda ölü'). · bekçi: `Electron/src/test/discovery-ipc-contract.test.ts` <sub>(CLAUDE.md:335)</sub>
- **[ÇEKİRDEK]** `build.<mac|win>.artifactName` ASCII kalmalı, `${productName}` KULLANILMAZ — ad `latest.yml` içinde URL'dir; 'Ş' + boşluk aktarımda bozulup 404 üretir. · bekçi: `Electron/src/test/update-feed-url.test.ts:67-73` <sub>(CLAUDE.md:78)</sub>
- **[ÇEKİRDEK]** `autoUpdater`a MODÜL GÖVDESİNDE dokunulmaz — o bir getter, ilk erişimde Electron `app`ine dokunur; erişim `updater()` ile ertelenir. `autoInstallOnAppQuit` KAPALI kalır (kapanışta cevapsız UAC); şerit YALNIZ `ready`de çizilir (error şeridi internetsizde körleştirir). <sub>(CLAUDE.md:78)</sub>
- **[PROFİL]** `nsis.perMachine: true` (uygulama Program Files'ta) → her güncellemede bir kez Windows izin penceresi; o makinedeki hesap YÖNETİCİ DEĞİLSE güncelleme o makinede kurulmaz ve panel sessizce eski sürümde kalır. <sub>(CLAUDE.md:78)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Donanım paketleri (serialport, node-hid) `npm run electron:rebuild` ile yeniden derlenir; native seri okuma TEMBEL + try/catch `createRequire` ile yüklenir (rebuild yapılmamışsa `available:false`, çökme yok). ⚠️ Paket bugün `@electron/rebuild`, komut adı hâlâ `electron-rebuild`. <sub>(CLAUDE.md:9, CLAUDE.md:335)</sub>

## Tablet (mobil)


### Değişmezler

- **[ÇEKİRDEK]** `initialFacing` 'başlangıç değeri' değil ZORLAMADIR: verildiğinde cihaz tercihi ne OKUNUR ne YAZILIR (tek kullanıcısı kilit ekranı). Yazsaydı duvardaki tablette yapılan tek bir flip fabrikanın TÜM okutma ekranlarını sessizce çevirirdi. · bekçi: `mobil/src/components/BarcodeScannerView.test.tsx §10-§15` <sub>(CLAUDE.md:196)</sub>
- **[ÇEKİRDEK]** Kısa kesim → otomatik A1: bayrak + eşik FABRİKA ayarıdır, cihazda yalnız ÜÇ DURUMLU override yaşar (`tamburShortCutA1Override`: server|on|off; bilinmeyen değer `server`a düşer). 'Hangi değer geçerli'nin TEK cevabı `resolveShortCutConfig`; `'on'`da eşik cihazınkidir, fabrikaya SIZMAZ. · bekçi: `mobil/src/screens/Modules/Tambur/resolveShortCutConfig.test.ts` <sub>(CLAUDE.md:335)</sub>
- **[ÇEKİRDEK]** ERP adresi zinciri: `EXPO_PUBLIC_API_URL` → `src/constants/api.ts` → axios baseURL; değer DERLEME ANINDA gömülür (uygulama içi 'API Adresi' yalnız o cihazı düzeltir). Çözüm sırası `--api-url` → ortam → `.env*`; script değeri Gradle'a AÇIKÇA geçirir (.env.local sahaya sızmasın). · bekçi: `npm run build:apk:verify (APK içindeki gömülü adresi okur)` <sub>(CLAUDE.md:66, CLAUDE.md:251)</sub>
- **[ÇEKİRDEK]** Mobil temel: RN + Expo 54, Android tablet (yatay) + telefon (dikey), YÖN KİLİDİ YOK — her ekran iki form factor'da da çalışmalı. Backend `Teks-Erp/` port 4000; kök CLAUDE.md domain kuralları mobilde de geçerlidir. <sub>(CLAUDE.md:1)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Mobilde yedek portlar OPT-IN'dir (`extraPorts`, varsayılan KAPALI) ve yalnız kullanıcının 'Ağda Ara' dediği yolda açılır; arka plan self-heal turu (`serverReachability.trySelfHeal`) bunu AÇMAZ — port avı bir KURULUM sorunudur, kesinti sorunu değil. · bekçi: `mobil/src/services/discovery.service.test.ts §6 'extraPorts KAPALIYKEN yedek por` <sub>(CLAUDE.md:110)</sub>
- **[ÇEKİRDEK]** Modal primitifi `src/components/AppModal.tsx`tir (Portal + Reanimated); `react-native-modal` KALDIRILDI ve geri getirilmez. `SimplePortal`ın host'a bildirimi BİLEREK bir mikrotask'a ertelenmiştir (SM-X230 çökme dersi) — bu erteleme KALDIRILAMAZ. <sub>(CLAUDE.md:226, CLAUDE.md:292)</sub>
- **[ÇEKİRDEK]** Kısa-kesim kuralının TAMAMI `screens/Modules/Tambur/shortCutQuality.ts`tedir; üç yol (elle yazım · makine ölçümü · 'kalanı kes') aynı fonksiyonu çağırır — KOPYALAMA. Yalnız VARSAYILAN kaliteyle ateşler; A1 katalogdan çözülür, yoksa hiç ateşlemez (fail-closed). · bekçi: `shortCutQuality.test.ts (12) + deviceSettingsStore.test.ts (5)` <sub>(CLAUDE.md:335)</sub>
- **[ÇEKİRDEK]** APK yalnız `scripts/build-apk.mjs` ile derlenir — `cd android && ./gradlew assembleRelease` ELLE ÇAĞRILMAZ. Script adresi çözer → doğrular → önbellekleri siler → derler → APK içindeki gömülü adresi TEKRAR okur; düşerse paket `app-release.DOGRULANMADI.apk` olur, exit 1. · bekçi: `npm run build:apk:check / build:apk:verify` <sub>(CLAUDE.md:66)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** Metro/Gradle önbelleği env değerini anahtarına ALMAZ — hızlı biten build iyi haber değil, BAYAT ADRESTİR (ölçüm: sıcak önbellek 17,9 sn ESKİ adres ↔ temiz 69,9 sn YENİ adres). Release bundle Hermes bytecode'dur: Türkçe dizeler UTF-16'ya gider ve grep BULMAZ — bundle'da hep ASCII dize ara. <sub>(CLAUDE.md:66)</sub>
- **[ÇEKİRDEK]** `usesCleartextTraffic` app.json'da `android` ALTINDA GEÇERSİZDİR (Expo SDK 54 sessizce atar) — `expo-build-properties` eklentisinin `android` bloğuna yazılmak ZORUNDA. Doğrulama tek satır: `grep -o 'usesCleartextTraffic="[^"]*"' android/app/src/main/AndroidManifest.xml`. BU TUZAĞIN BEKÇİSİ YOK. <sub>(CLAUDE.md:66)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Tablet keşif bütçesi masaüstünden DARDIR: yedek portlarda TAM SÜPÜRME yalnız İLK yedekte (5000) koşar; 3000/8080 yalnız öncelik listesini görür (`SCAN_MAX_HOSTS` 512 ↔ 1022 ile aynı gerekçe). · bekçi: `mobil/src/services/discovery.service.test.ts (15)` <sub>(CLAUDE.md:110)</sub>
- **[ÇEKİRDEK]** `AppModal` içindeki metin kutusu ÖN-DOLDURULMUŞ açılıyorsa `components/ModalTextInput.tsx` kullan (taslak portalın İÇİNDE, dış state yalnız yankı). Eşitleme koşulu `value` PROP'UNUN DEĞİŞMESİDİR, 'taslaktan farklı olması' DEĞİL — ikincisi hatanın ikizini üretir. · bekçi: `mobil/src/components/ModalTextInput.test.tsx (§2b/§2c)` <sub>(CLAUDE.md:292)</sub>
- **[ÇEKİRDEK]** Cihaz katalogu VERİDİR: `PeripheralDevice` (admin → Cihaz Kaydı) kind/connectionType/address + protokol (pollCommand/terminator/decimals/scale/role) + per-cihaz `simulate` taşır. Tablette device-local seçim YOK; HAL `src/services/hal/`, `buildIoFromPeripheral(row)` transport+codec kurar. <sub>(CLAUDE.md:218, CLAUDE.md:219)</sub>

### Kararlar

- **[PROFİL]** SCALE cihazları simüle DOĞMAZ, METER cihazları doğar. Gerekçe sınıf farkı: çuval kg'si sevk irsaliyesine ve çeki listesine BASILIR (müşteri/gümrük belgesi); metraj iç ölçümdür. `shipping.simulatedWeightEnabled` kapalıyken (varsayılan) backend 400 döner, demo/eğitim kurulumu açar. · bekçi: `Teks-Erp/scripts/test_sack_weigh_source.ts` <sub>(CLAUDE.md:329, CLAUDE.md:221)</sub>
- **[PROFİL]** Cihaz ömürlü tercihler (ekran state'i DEĞİL): `deviceSettingsStore.kk1ManualEntry` / `tamburCutMode` / `cameraFacing` (varsayılan back). Ölçüt: tercih tabletin fiziksel DURUŞUNU ya da istasyonun makine durumunu yansıtıyorsa cihaza; okutulan YERE bağlıysa oturuma (fener). · bekçi: `mobil/src/store/deviceSettingsStore.test.ts` <sub>(CLAUDE.md:365, CLAUDE.md:196)</sub>

## Geçersiz kılınan kurallar — bunlara UYMA

- **TAM** `M:undated__api-baglantisi` → `M:undated__apk-derleme-sahaya-kurulacak-paket-tek`: API adresi artık kaynak dosyada sabit literal DEĞİL: derleme anında EXPO_PUBLIC_API_URL'den gömülür, dev'de Expo hostUri'den türer. Notun 'export const API_URL = http://192.168.X.X:4000/api' kod bloğu ölü; kalan canlı çekirdek yalnız 'tablet ve sunucu aynı ağda, kök <host>:4000/api'. ✅ çürütmeden geçti
- **KISMI** `E:undated__process-boundary-pazarlik-disi` → `R:2026-09-01__2026-09-01-patron-modulu-fabrikaya`: 'Renderer localStorage'a TOKEN YAZMAZ' mutlak değil: patron modülüyle gelen web derlemesi (dist-web) `window.api` olmadığı için `webStore`a düşer ve token'ı localStorage'a yazar. Electron yolunda yasak birebir KALIR (api varsa webStore'a hiç düşülmez). ✅ çürütmeden geçti
- **KISMI** `R:2026-09-03__2026-09-03-panel-modul-kapilari` → `kök CLAUDE.md:103 — 2026-09-04 'Kapalı modülün bayrağı ÇİZİLMEZ' (küme dışı not)`: P5'in 'modül = KİLİT, gizleme DEĞİL' kuralının GİZLEME yarısı geri alındı: Özellik Anahtarları ekranında kapalı modülün SATIRI çizilmez, kategoriden satır kalmazsa sekme de düşer. Kilit bandı (`moduleKey`/`superadminOnly` ikizi, istemci-taraflı) DURUYOR — ezilen yalnız 'gizlemez' cümlesi. ✅ çürütmeden geçti
- **KISMI** `A:2026-08-26__2026-08-26-electron-dagitimi-setup` → `E:2026-08-26__otomatik-guncelleme-2026-08-26`: Yayın adresi değişti: arşivin ilk yazdığı `https://demo.etkiliyazilim.com/guncelleme/electron/` yerine müşteri segmentli `guncelleme.etkiliyazilim.com/<müşteri>/electron/`. Adres tek kaynağı `shared/update-feed.ts` ↔ `package.json > build.publish`; arşiv metni bunu kendi içinde de işaretliyor. ✅ çürütmeden geçti
- **KISMI** `M:2026-08-19__tambur-kisa-kesim-otomatik-a1-2026 (not gövdesindeki eski paragraf)` → `M:2026-08-19__tambur-kisa-kesim-otomatik-a1-2026 (notun başındaki 'ikinci pakette MERKEZE taşındı' güncellemesi)`: Kısa-kesim bayrağı + eşiği artık CİHAZDA değil FABRİKA ayarında (panel → Üretim → Tambur, feature-flags); cihazda yalnız üç durumlu override (`tamburShortCutA1Override`: server|on|off) yaşar ve birleştirme `resolveShortCutConfig`tedir. Notun 'ikisi de cihazda, varsayılan KAPALI' cümlesi bayat kaldı. ✅ çürütmeden geçti

## Çözülmüş çelişkiler

- `R:undated__phase-1` ↔ `M:undated__kural`: Kod B'yi uyguluyor: gerçek sürücü İSTEMCİ katmanında var — Electron/electron/ipc/scale.ipc.ts (serialport, createRequire ile tembel), scanner.ipc.ts, printer.ipc.ts ve mobil/src/services/hal/btClassic.transport.ts (BT-Classic/SPP). Backend'de sıfır seri port. Yasağın bugünkü kapsamı: BACKEND'e seri port/polling girmez; simülasyon kararı `PeripheralDevice.simulate` VERİSİDİR.
- `B:undated__architecture-ozet` ↔ `Teks-Erp/src/routes/admin.routes.ts:188 (dosyanın kendi yorumu)`: İkisi de bugün YANLIŞ: aynı dosya :53'te `import prisma from "../lib/prisma"` yapıyor ve :783'te `prisma.user.findUnique` çağırıyor (2026-09-04 süperadmin PIN kapısı). Dosyada eslint-disable yok, eslint.config.mjs:59-73 kuralı bu yolu kapatıyor. Kural mı gevşetilecek, kod mu servise taşınacak — karar verilmemiş.

## Açık sorular

- B:undated__architecture-ozet — 'route/controller'da prisma import YASAK' kuralı bugün İHLAL edilmiş durumda: Teks-Erp/src/routes/admin.routes.ts:53 `import prisma from "../lib/prisma"` + :783 `prisma.user.findUnique` (2026-09-04 süperadmin PIN kapısı), eslint-disable YOK, eslint.config.mjs:59-73 bu yolu kapatıyor. Üstelik aynı dosyanın :188 yorumu 'src/routes altında tek bir dosya bile lib/prisma import etmiyor' diyor. Kural mı gevşetilecek, kod mu servise taşınacak — karar yok.
- Üç envanter ölçülebilir biçimde BAYAT ve kanıt olarak kullanılamaz: (a) Electron/CLAUDE.md Komutlar — package.json'daki preview, dev:web, build:web, preview:web, release:win, build:win:cross, build:all, typecheck:plain, format, test:watch, e2e:run listede yok; (b) Electron Allowed Packages — react-day-picker, buffer, @fontsource/* yok, `electron-rebuild` bugün `@electron/rebuild` (package.json:92, komut adı :25'te aynı kaldı); (c) mobil Allowed Packages — expo-audio, expo-asset, expo-file-system, expo-intent-launcher, expo-updates yok.
- B:undated__verifytoken-requirepermission-apperror-prisma-zod — middlewares/ envanteri 7 dosya sayıyor, dizinde 15 var: client-info, demo, finance, module, remote-access, settings-password, system-account, web-hardening listede YOK. Envanter mi tamamlanacak, yoksa 'liste örnektir' mi denecek — karar yok.
- R:2026-09-03__2026-09-03-panel-modul-kapilari — bu notun dizin satırı asıl olarak 'modül/bayrak' kümesine ait; buradaki öneri yalnız 2026-09-04 ezilmesini işaretlemek için. İki kümenin dizin satırı çakışmasın diye tek yerde tutulmalı.
- M:undated__apk-derleme (usesCleartextTraffic tuzağı) ve M:undated__apk-derleme (Metro önbellek bayatlığı) için MEKANİK BEKÇİ YOK — notun kendisi bunu söylüyor; bekçi yazılacak mı, karar yok.

## Doğrulama turu ekleri (eski CLAUDE.md ↔ yeni yapı karşılaştırması, 2026-09-05)

- **[ÇEKİRDEK]** Tek cihazlı istasyonlarda çevre birimi seçimi `primaryMeterFor`/`primaryScaleFor` ile: role PRIMARY ?? rolesiz ?? ilk satır ?? null — kat rolüyle eşleşen `meterPeripheralFor(rows, foldType)`ten AYRI seçici. <sub>(eski mobil/CLAUDE.md HAL)</sub>

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (tek testte tip kapısı atlanır) · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`.

**Ne ölçtükleri, DB gerektirip gerektirmedikleri ve bayatlık işaretleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → bu alanın bölümü.** ⚠️ = orada gerekçesi yazılı bayatlık şüphesi.

Backend: `test_audit_followups`, `test_boss_overview`, `test_canvas_preview_peripheral_lang`, `test_client_registry`, `test_device_activity`, `test_device_assignment`, `test_device_pairing_flag`, `test_device_transport`, `test_discovery_advertiser`, `test_discovery_identity`, `test_field_address`, `test_label_format_resolver`, `test_label_routing_resolver`, `test_p2_api`, `test_peripheral_for_device`, `test_peripheral_registry_crud`, `test_peripheral_station_owner`, `test_remote_access_guard`, `test_sack_weigh_source`, `test_session_registry`, `test_totp`, `test_web_hardening`, `test_work_session`, `test_work_session_close_all`, `test_work_session_history_guard`, `test_work_session_stamping`, `test_workstation_permission`

İstemci: `useServerReachability.test.ts`⚠️, `api-config.test.ts`⚠️, `machine-config.test.ts`⚠️, `scan-framer.test.ts`⚠️, `wedge-detector.test.ts`⚠️, `server-identity.test.ts`⚠️, `weight-codec.test.ts`⚠️, `schema.test.ts`, `clients-utils.test.ts`, `discovery-ipc-contract.test.ts`, `discovery-logic.test.ts`, `ServerDiscoveryList.contract.test.ts`, `ServerDiscoveryList.render.test.tsx`, `useMachinePeripherals.test.ts`, `useSackWeigh.test.tsx`⚠️, `discovery.contract.test.ts`, `discovery.test.ts`, `pairingGate.test.ts`, `serverReachability.test.ts`, `btPrinter.service.test.ts`, `discovery.service.test.ts`, `btClassic.transport.test.ts`, `deviceNameMatch.test.ts`, `meter.codec.test.ts`, `deviceSettingsStore.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-09-04 · 2026-09-04 — Cihaz onay kapısı: bayrak kapalıyken de her cihaz PENDING doğuyordu [ÇEKİRDEK] — `CLAUDE-NOT-ARSIVI.md:2345-2422`
- 2026-09-04 · 2026-09-04 — Keşif: bir satır = bir SUNUCU (BULGU C); sıralama var, ELEME yok — `CLAUDE-NOT-ARSIVI.md:2423-2483`
- 2026-09-04 · 2026-09-04 — Keşif kademeli PORT taraması: mDNS portu ilandan alıyordu, TARAMA tek porta kilitliydi [ÇEKİRDEK] — `CLAUDE-NOT-ARSIVI.md:2575-2638`