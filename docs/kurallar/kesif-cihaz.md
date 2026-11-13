# Keşif · Cihaz · Ağ · Donanım
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/kesif-cihaz.md`.

Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi. Donanım yasağı bugün YALNIZ backend için canlıdır; istemci gerçek sürücü taşır.

## Ortak (backend + panel + tablet)

### Değişmezler

- **[ÇEKİRDEK]** Donanım fail-closed: cihaz yok / bağlanamadı / okunamadı / değer ≤ 0 → net Türkçe toast, mutasyon HİÇ çağrılmaz; sessiz sahte değer ve varsayılana sapma yok.
- **[ÇEKİRDEK]** Uydurulmuş değeri `source:'SIMULATED'` diye beyan et, kararı backend versin; toastta 'SİMÜLASYON' ibaresi şart. Elle giriş (`source:'MANUAL'`) muaftır.
- **[ÇEKİRDEK]** Ölçüm kaynağı sıralaması TEK helper `meter-reading.helper.weakestMeasureSource`; ikinci sıralama (kademe haritası, `indexOf`) yazma; metre gövdesi kaynak alanları `meterSourceSchema`ten.
- **[ÇEKİRDEK]** SIMULATED Tambur CUT metresini hizmet faturasına alma: taslaktan düşür, "simüle ölçüm — süpervizör düzeltmesi gerekli" uyar; okumalı işi `readingId`ye bağla; düzeltme yalnız `POST /api/tambur/meter-readings/:id/correct` (`initialQty` değişmez). Ayar değil.
- **[ÇEKİRDEK]** Keşifte bir satır = bir sunucu: tekilleştirme `installationId` ile (`groupByInstallation`), diğer adresler grupta kalır; ÖNCE tekilleştir SONRA sırala.
- **[ÇEKİRDEK]** Keşif kuralı `>>> KEŞİF-İKİZ BAŞLANGIÇ` / `<<< KEŞİF-İKİZ SON` bloğunda tek metindir; Electron ve mobil bekçileri bloğu BİREBİR kıyaslar.
- **[ÇEKİRDEK]** Sunucu yalnız kullanılabilir adresini duyurur: 169.254/16, fe80::/10 ve sanal kartlar (Hyper-V/WSL, VirtualBox, VMware, Docker, Tailscale, ZeroTier — adaptör ADINDAN) mDNS'e girmez; hiç adres kalmazsa elemesiz ilan. Karar tek yerde `src/lib/lan-addresses.ts` `lanExclusionOf`.
- **[ÇEKİRDEK]** Yedek portta kimlik zorunlu (`identityRequiredForPort`): `/health` `{"status":"UP"}` yetmez. Varsayılan portta kimliksiz aday bilinçlidir; yedek porta genişletme.
- **[ÇEKİRDEK]** Yeni cihazın doğuş durumu `devicePairingRequired`dan türer (kapalıysa APPROVED); `announce` koşulsuz PENDING yaratmaz; enum'a üçüncü değer ekleme — ayrım audit `DEVICE_AUTO_APPROVED`.
- **[ÇEKİRDEK]** `auth.shortCredentialApprovedDeviceOnly` (barındırılanda DAİMA) açıkken PIN/QR kart yalnız onaylı cihazdan: cihazsız 403 `DEVICE_NOT_APPROVED`, kilide sayılmaz; eşleştirmeyi zorunlu kılar (`readDevicePairingRequired`), kapatma 409 `PAIRING_FORCED`. Varsayılan KAPALI.
- **[ÇEKİRDEK]** `device.unpairedPasswordLogin` (varsayılan KAPALI, barındırılanda zorlanmaz) açıkken PENDING aktif cihaz `req.device`siz yalnız parolayla girer: PIN/kart 403 `DEVICE_NOT_APPROVED`, personel listesi 401 `DEVICE_REQUIRED`, indirme belirteci 403, atıf NULL; pasif/kayıtsız 401.
- **[ÇEKİRDEK]** Tableti yasaklamak pasifleştirmedir (onayı geri almak PENDING'e döndürür); kanıtsız onaylı kimlik 401 kalır.
- **[ÇEKİRDEK]** Onaylı cihaz kimliğini `x-device-proof` (HMAC, ±5 dk) ile kanıtla; DB'de yalnız tuz, sır halkadan türer; kanıt barındırılanda DAİMA, fabrikada `device.proofRequired` açıkken (varsayılan KAPALI); `shortCredentialApprovedDeviceOnly` kanıtı zorlamaz, panel uyarır.
- **[ÇEKİRDEK]** Cihazı donanım özetiyle tanı; bilinen donanım yeni yerel kimlikle gelirse yeni satır açma, yeniden bağla: hedef aktif + onaylıysa onaysız (eşleştirme kapalıyken ya da `device.autoReattachKnownHardware` açıkken — varsayılan AÇIK, barındırılanda zorlanmaz; barındırılanda 10 dk soğuma), aksi hâlde yönetici onayıyla; karar tek yüklem `autoRebindRule`; revoke/pasif hedef asla otomatik.
- **[ÇEKİRDEK]** Cihaz kopyasını otomatik birleştirme: önizleme + kayıt kayıt seçim + geri alınabilir `MERGED` olayı; ayak izi tablolarını (iş oturumu, oturum, audit, print/trace) taşıma; `mergedIntoId`i yalnız `helpers/device-identity.helper.ts` yazar/okur.
- **[ÇEKİRDEK]** Halka kaybında sessiz üretme: sağlıkta (`shortCredentials.halkaKaybi`), audit'te (`SHORT_CREDENTIAL_RING_LOST`), bildirimde (`cihaz.halka-kaybi`), panelde göster; kanıtı yönetici seçerek sıfırlar (`PROOF_RESET`); yeni sır yalnız aynı localId + donanım özetine.
- **[ÇEKİRDEK]** Tablet yerel kimliğini okuma arızasında üstüne yazma; `android.allowBackup:false` tut; `versionCode`u düşürme (`build-apk.mjs` durur); donanım özetini kurulum kimliğiyle tuzlanmış HMAC gönder.
- **[ÇEKİRDEK]** Müşteri sunucusunu Tailscale ağımıza alma (Tailscale yalnız test makinelerimizde ve **[PROFİL]** adnansahin'de); sihirbaz Tailscale kutusu varsayılan KAPALI; müşteri kanalının tablet ERP adresi tailnet adı olamaz; uzaktan destek müşterinin başlattığı yollarla.

### Yasaklar

- **[ÇEKİRDEK]** Backend'e seri port / donanım polling girmez; makine verisini LAN'da AYRI toplayıcı ajan okuyup API'ye basar; backend tek process.
- **[ÇEKİRDEK]** Bayrak sonradan açılırsa otomatik onaylı cihazlar APPROVED kalır (gözden geçirme `revoke`); mevcut PENDING/revoke edilmiş cihaz terfi ETMEZ.
- **[ÇEKİRDEK]** Yeni paket (Electron/mobil) eklemeden önce onay al; Allowed Packages tabloları bayattır, `package.json` ile karşılaştır.

### Tuzaklar

- **[ÇEKİRDEK]** `DISCOVERY_PORTS = [4000, 5000, 3000, 8080]` tek kaynaktır, `DISCOVERY_DEFAULT_PORT` ondan türer; ikinci gerçek yazma; listeyi kısa tut.
- **[ÇEKİRDEK]** Onay kapısı kararını sunucu verir (`/devices/status`, `/devices/announce` → `pairingRequired`; koşul `pairingRequired && status !== "APPROVED"`); mobilde tek yüklem `navigation/pairingGate.ts`, `??` yerine `||`/`&&` yazma.

### Reçeteler

- **[ÇEKİRDEK]** Açık "Ağda Ara" bilinen adres cevap verse de alt ağı süpürür, HER sunucuyu listeler; otomatik keşif erken çıkar; gömülü varsayılan adres hep öncelik listesinde. Karar KEŞİF-İKİZ'de: `DiscoveryMode` · `sweepSkipReason` · `stopsOnPinnedMatch` · `discoveryPriorityUrls`.
- **[ÇEKİRDEK]** Keşif portu kademeli: ① mDNS → ② varsayılan port taraması → ③ yalnız ①+② sıfırsa yedek portlar sırayla, aday bulan ilk portta DUR; sunucu bulunduysa genişleme koşmaz.

### Kararlar

- **[ÇEKİRDEK]** Donanım sürücüsü istemcide yaşar (Electron main IPC · mobil HAL); simülasyon per-cihaz veri bayrağıdır (`PeripheralDevice.simulate`).

## Backend

### Değişmezler

- **[ÇEKİRDEK]** helmet İKİ ayrı örnek kurulur (HSTS/CSP-upgrade LAN'a sızmasın); dispatcher adı `helmetMiddleware` olmak zorunda.
- **[ÇEKİRDEK]** LAN TLS `LAN_TLS_MODE`: `off` (varsayılan) · `dual` · `required` (HTTP yalnız 127.0.0.1). Sertifika kendinden imzalı ECDSA P-256; istemci SHA-256 parmak iziyle tanır; TOFU yok (loopback, göz kıyası, panel QR'ı); sabitli istemci HTTP'ye dönmez; HSTS yok. `docs/design/LAN-TLS.md`.
- **[ÇEKİRDEK]** `required`ı bütün istemciler sabitli sürüme geçmeden açma.
- **[ÇEKİRDEK]** LAN TLS sertifikası 30 yıl; değişimi bilinçli eylem; `required`da yanlış ayar `off`a düşmez, HTTPS'i kapatır; sunucu makinesindeki panel döngü kimlik ucundan sabitler, `https://127.0.0.1:<tls.port>`e bağlanır (§9).
- **[ÇEKİRDEK]** Tablet sürüm paketi yalnız şifreli bağlanır (`secureTransportOnly() = !__DEV__`; düz HTTP kapalı, güven çapası yalnız sistem deposu). Kip adresten türer, kayda yazılır, düşmez.
- **[ÇEKİRDEK]** Tablet kipi: `INTERNET_PARENT_DOMAINS` (`mobil/src/lib/internet-tls.ts`) altı İNTERNET (sistem zinciri, 443); diğer her adres SABİTLİ (QR ya da kod kıyası, 4443; native yoklama yalnız gözlem). Kip değişimi kaldır+ekle ister; internet kipinde kurulum kimliği değişirse bağlanma.
- **[ÇEKİRDEK]** Dışarı giden düz HTTP istisnası yalnız: döngü (`127.0.0.1`/`localhost`) ve noktasız compose adı `http://okuma:8765` (yalnız `lib/gelen-belge/url.ts`; IP/noktalı ad red; aynı compose ağı şart). `lisans.md` imzası loopback/compose-içine uygulanmaz.
- **[ÇEKİRDEK]** Okuma sidecar'ı gelen port yayımlamaz, bulut anahtarı tutmaz; fotoğraf baytı ve ham OCR metni log/audit'e girmez.
- **[ÇEKİRDEK]** Panel yalnız şifreli bağlanır: ağda `http://` yok (`plainRequestAllowed`); https sabitli (kod kıyası) ya da izinli üst alanda genel CA (`panelTransportFor`); döngüde ilan = el sıkışma ise sorusuz sabitle, döngü dışı kodsuz sabitlenmez; sabit kalkınca şifresize dönüş yok.
- **[ÇEKİRDEK]** Panel sabitli yerel adreste (IP · tek etiket · `.local`/`.lan`) sabit dışı sertifikayı sistem CA'sı geçerli saysa da reddeder (−2); Chromium'a bırakma.
- **[ÇEKİRDEK]** Panel connect-src'i yalnız sunucu kökeni + döngü: masaüstünde `shared/connect-gate.ts` (`connectGate:allow` istekten ÖNCE), web'de meta CSP derlemede daraltılır (`'self'` + `VITE_WEB_API_BASE_URL`); üçüncü taraf `https:` kesilir.
- **[ÇEKİRDEK]** `Peripheral.identifyPattern` felaket geri izleme sınıfıyla reddedilir (`src/utils/regex-safety.ts`, 255 karakter üstü dahil); tablet deseni ≤256 karakter çerçeveye uygular, derlenemeyeni yok sayar (`mobil/src/services/hal/devicePattern.ts`).
- **[ÇEKİRDEK]** Kimlik ucu `protocol`/`apiPort`u yalnız TRUST_PROXY kaynağından `X-Forwarded-Proto`lu istekte türetir (o istekte `tls` null); sahte başlık yok sayılır; `serverName` yalnız görüntü (`TEKSERP_SUNUCU_ADI`), kimlik `installationId`.
- **[ÇEKİRDEK]** "Fabrika içi / Bulut" seçimi `panelTransportFor`un sonucudur (`src/lib/server-mode.ts`); çelişen adres kaydedilmez; yoklama yazılan şema/porttan (`serverUrlParts`, portsuz=443); internet kipinde sabit yok; ilansız sertifika/internet adı kodla sabitlenmez; yalnız son yoklama yazılır.
- **[ÇEKİRDEK]** Makine kartı oturum açmaz, her isteği imzalar (`verifyCollectorSignature`: `x-collector-id` + damga ±5 dk + nonce + HMAC-SHA256); fail-closed 401, hız 429, `req.user` yok; yalnız bağlı tezgaha basar (403 `MACHINE_NOT_IN_SCOPE`); sır DB'de yok, log/audit'e girmez; HTTPS 4443.
- **[ÇEKİRDEK]** Tablet QR'ı sürümlü (`teks-erp-tls:1` adressiz · `:2` + https adresleri); biçim yalnız `buildTlsQr`/`parseTlsQr`; adres ipucudur, iz tutmazsa bağlanma; panel v1 kodunu da açar.
- **[ÇEKİRDEK]** İzin kataloğu atama içermez (katalog koda, atama script'e/panele); görünmeyen ekranda sırayla bak: satır DB'de mi, atanmış mı, yeniden giriş yapıldı mı (JWT bayat).
- **[ÇEKİRDEK]** Fabrikaya kurulan yan servis (emsal `okuma/`) gelen port açmaz: yalnız 127.0.0.1 ya da izinli compose iç adı, 0.0.0.0 YASAK; çalışma anında dışarı istek (model indirme dahil) atmaz.
- **[ÇEKİRDEK]** + **[PROFİL]** METER kalibrasyon kaydı (`calibratedAt`/`calibrationDueAt`/`calibrationNote`) ölçümü ASLA engellemez: `tambur.kalibrasyonKontrolu` KAPALI bayt-aynı, UYAR vadesi geçmişte `ApiResponse.warnings` (kaynak MACHINE kalır); vade yalnız `isCalibrationExpired`.
- **[ÇEKİRDEK]** Barındırılanda kimliksiz duyuru IP (IPv6 /64) başına ≤5 PENDING, 24 saatte PASİF; PIN'e `pin-dev:<cihaz>` kovası; discovery firma/makine/sürüm vermez; login-methods lisans bayrağı vermez; etiket yerel gönderimi kapalı. Etiket test ucu her sınıfta yalnız özel IPv4 + 9100–9103.

### Yasaklar

- **[ÇEKİRDEK]** Katman sırası Routes → Controllers → Services → Prisma; route/controller'da `lib/prisma` import YASAK. İstisna: ince read/ayar uçları (admin/dashboard/feature-flag/customer-branch/production-balance/station-capability) controller'sız, Zod + servis.
- **[PROFİL]** DB adını dokümana sabitleme, `.env`den doğrula (`SELECT current_database()`). Slow query log (>500ms) yalnız üretimde.

### Reçeteler

- **[ÇEKİRDEK]** Testler server'sız entegrasyondur (servis + prisma doğrudan); tek: `npx tsx scripts/test_X.ts`, toplu: `npm test` = `tsx scripts/run-all-tests.ts`.

### Kararlar

- **[ÇEKİRDEK]** TOTP kendi kodumuzdur, RFC 4226/6238 vektörleriyle doğrulanır; kurulumun tek yolu yöneticinin açtığı 15 dakikalık pencere.

## Panel (Electron)

### Değişmezler

- **[ÇEKİRDEK]** Keşif adayı kendi portunu taşır (`baseUrl`); taranan portlar `DiscoveryState.scan.ports`ta görünür.
- **[ÇEKİRDEK]** `webPreferences`: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` — hiçbiri gevşetilmez.
- **[ÇEKİRDEK]** Ana çerçeve yalnız uygulama belgesinde: tek yüklem `@shared/app-origin` `isAppDocumentUrl`; diğer gezinme (UNC dahil) engellenir, OS'e devredilmez; alt çerçeve yalnız about:srcdoc/about:blank; yeni pencere ve webview RED (`electron/security/web-contents-guard.ts`).
- **[ÇEKİRDEK]** `window.api` yalnız uygulama belgesine açılır; her `ipcMain.handle/on` `electron/security/trusted-ipc.ts` `handleTrusted`/`onTrusted` üzerinden, yalnız ana çerçeveden; çıplak `ipcMain` yalnız bekçide beyanlı istisnayla (bugün BOŞ).
- **[ÇEKİRDEK]** Tarayıcı izinleri varsayılan RED (`installPermissionPolicy`; yalnız `clipboard-read` + `clipboard-sanitized-write`); `shell.openExternal` tek nokta `electron/security/external-open.ts`, yalnız `EXTERNAL_LINK_HOSTS` https; "klasörde göster" yalnız yerel mutlak yol.
- **[ÇEKİRDEK]** secure-store: şifreleme yokken `auth.token` diske düz yazılmaz, düz değer döndürülmez; `MAIN_ONLY_KEYS` (`electron/ipc/secure-store.core.ts`) renderer'ın `secure-store:set/delete`iyle yazılamaz.
- **[ÇEKİRDEK]** mDNS yüklemesi tembel + try/catch (`electron/discovery/mdns-browser.ts`); `bonjour-service` saf JS, `electron:rebuild`/`asarUnpack` gerekmez.
- **[PROFİL]** Panel sürümünde `package.json > version` artırılır; yayın adresi tek kaynak `shared/update-feed.ts` ↔ `package.json > build.publish`.
- **[ÇEKİRDEK]** Ekran manifestosu okunamazsa 'gizlenecekler' listesini çizme; 'kapatırsan gizlenir' önizlemesinde masaüstü ve tablet ayrı sayılır.
- **[ÇEKİRDEK]** Tek seferlik `?rowNotes=1` kalıcı ayarı pure OR ile ezer; ayara/snapshot'a yazılmaz, yeni belge versiyonu doğurmaz; OR yalnız renderer'da tek yerde; checkbox `DocDef.supportsRowNotes`.
- **[ÇEKİRDEK]** Electron yığını: Tailwind 4 (`@import "tailwindcss"` + `@theme`, `tailwind.config.js` yok) · main ESM (`__dirname` yok) · electron-store 11 ESM-only.

### Yasaklar

- **[ÇEKİRDEK]** Renderer `electron`, `fs`, `path`, `child_process`, `os`, `net` import etmez; native yalnız `window.api` (`electron/preload.ts` `contextBridge.exposeInMainWorld`). Main HTTP başlatmaz — tek geçit `src/services/apiClient.ts`.
- **[ÇEKİRDEK]** Electron renderer token'ı localStorage'a yazmaz (`safeStorage` + `electron-store`); web derlemesinde token istemcide tutulmaz: httpOnly `tekserp_oturum` + CSRF başlığı; `window.api` varsa çerez yoluna düşülmez.
- **[ÇEKİRDEK]** Ayar kategorisinin modül bağını `moduleKey` (KİLİT, `superadminOnly` ikizi) ile kur; `regime`ı modül anahtarlarına açma. Kilit istemci-taraflıdır, bant 'etkisiz' demez.
- **[ÇEKİRDEK]** Süperadmin kapısını `Electron/src/lib/superadmin-gate.ts`ten import et, kopya yazma; karo dışı palet girdilerine kapıyı elle taşı.

### Tuzaklar

- **[PROFİL]** `dist-web` yalnız Docker imajlarında (opt-in `WEB_DIST_DIR`) derlenir; Windows paketi taşımaz, eski `.env` `WEB_DIST_DIR`ini `kur.ps1` uyarır.
- **[ÇEKİRDEK]** `bonjour-service` sürümü sabit ('^' yok) ve `dependencies`te durmak zorunda.
- **[ÇEKİRDEK]** `build.<mac|win>.artifactName` ASCII kalır, `${productName}` kullanılmaz.
- **[ÇEKİRDEK]** `autoUpdater`a modül gövdesinde dokunma (`updater()` ile ertele); `autoInstallOnAppQuit` KAPALI; şerit yalnız `ready`de çizilir.
- **[PROFİL]** `nsis.perMachine: true`: yönetici olmayan hesapta güncelleme kurulmaz, panel sessizce eski sürümde kalır.

### Reçeteler

- **[ÇEKİRDEK]** serialport/node-hid `npm run electron:rebuild` ile derlenir; native seri okuma tembel + try/catch `createRequire` (yoksa `available:false`). Paket `@electron/rebuild`.

## Tablet (mobil)

### Değişmezler

- **[ÇEKİRDEK]** `initialFacing` zorlamadır: verildiğinde cihaz tercihi ne okunur ne yazılır.
- **[ÇEKİRDEK]** Kısa kesim → otomatik A1: bayrak + eşik fabrika ayarı; cihazda yalnız `tamburShortCutA1Override` (server|on|off, bilinmeyen → `server`); tek cevap `resolveShortCutConfig`; `'on'` eşiği fabrikaya sızmaz.
- **[ÇEKİRDEK]** ERP adresi `EXPO_PUBLIC_API_URL` → `src/constants/api.ts` → axios; derlemede gömülür; çözüm sırası `--api-url` → ortam → `.env*`; script Gradle'a açıkça geçirir.
- **[ÇEKİRDEK]** Mobil: RN + Expo 54, tablet (yatay) + telefon (dikey), yön kilidi yok — her ekran iki form factor'da çalışır.

### Yasaklar

- **[ÇEKİRDEK]** Mobilde yedek portlar OPT-IN (`extraPorts`, varsayılan KAPALI), yalnız 'Ağda Ara'da; `serverReachability.trySelfHeal` açmaz.
- **[ÇEKİRDEK]** Modal primitifi `src/components/AppModal.tsx`; `react-native-modal` geri getirilmez; `SimplePortal` mikrotask ertelemesi kaldırılamaz.
- **[ÇEKİRDEK]** Kısa-kesim kuralının tamamı `screens/Modules/Tambur/shortCutQuality.ts`; üç yol aynı fonksiyonu çağırır, kopyalama; yalnız varsayılan kaliteyle, A1 katalogda yoksa ateşlemez.
- **[ÇEKİRDEK]** APK/AAB yalnız `scripts/build-apk.mjs` ile (`build:aab` Play, `build:apk` yerel); `./gradlew assembleRelease`/`bundleRelease` elle çağrılmaz; doğrulanamayan paket `.DOGRULANMADI.<uzantı>`, exit 1.

### Tuzaklar

- **[ÇEKİRDEK]** Metro/Gradle önbelleği env'i anahtarına almaz — hızlı build bayat adres demektir; Hermes bundle'da Türkçe dize grep'le bulunmaz, ASCII ara.
- **[ÇEKİRDEK]** `usesCleartextTraffic` `expo-build-properties` `android` bloğuna yazılır (app.json `android` altında geçersiz); sürüm paketinde `false`.

### Reçeteler

- **[ÇEKİRDEK]** Tablette yedek portta tam süpürme yalnız ilk yedekte (5000); 3000/8080 yalnız öncelik listesi (`SCAN_MAX_HOSTS` 512).
- **[ÇEKİRDEK]** `AppModal` içinde ön-doldurulmuş metin kutusu → `components/ModalTextInput.tsx`; eşitleme koşulu `value` prop'unun değişmesidir.
- **[ÇEKİRDEK]** Cihaz katalogu veridir: `PeripheralDevice` kind/connectionType/address + protokol + `simulate`; tablette cihaz-yerel seçim yok; `buildIoFromPeripheral(row)` (`src/services/hal/`).

### Kararlar

- **[PROFİL]** SCALE simüle doğmaz, METER doğar; `shipping.simulatedWeightEnabled` kapalıyken (varsayılan) simüle kg 400.
- **[PROFİL]** Cihaz ömürlü tercihler `deviceSettingsStore.kk1ManualEntry` / `tamburCutMode` / `cameraFacing` (varsayılan back); tabletin duruşu/makine durumu → cihaz, okutulan yer → oturum.

## Geçersiz kılınan kurallar — bunlara UYMA

- `quickPin 6 hane, düz metin` → `genel.md` (özet + halka).
- Soket tabanlı uzak/LAN ayrımı, 4001 tünel, Cloudflare Access JWT, BossShell → kaldırıldı (B6).
- API adresi kaynakta sabit literal değil; derlemede `EXPO_PUBLIC_API_URL`.
- 'Renderer token yazmaz' web derlemesinde çerezle çözülür; Electron yolunda birebir.
- Kapalı modülün bayrak satırı çizilmez; kilit bandı durur.
- Yayın adresi `guncelleme.etkiliyazilim.com/<müşteri>/electron/`.
- Kısa-kesim bayrağı cihazda değil fabrika ayarında.

## Çözülmüş çelişkiler

- Donanım yasağı yalnız backend'dedir; simülasyon `PeripheralDevice.simulate` verisidir.
- `admin.routes.ts` prisma importu kuralla çelişir — karar bekliyor (Açık sorular).

## Açık sorular

- `admin.routes.ts` prisma importu: kural mı gevşer, kod mu taşınır.
- Electron Komutlar, Electron/mobil Allowed Packages, middlewares envanterleri bayat — kanıt sayma.
- Metro önbellek bayatlığına mekanik bekçi yok.

## Doğrulama turu ekleri (eski CLAUDE.md ↔ yeni yapı karşılaştırması, 2026-09-05)

- **[ÇEKİRDEK]** Tek cihazlı istasyonda `primaryMeterFor`/`primaryScaleFor` (PRIMARY ?? rolesiz ?? ilk ?? null); kat rolü seçicisi `meterPeripheralFor(rows, foldType)` ayrıdır.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`. Ayrıntı: `Teks-Erp/docs/BEKCI-HARITASI.md`.

Backend: `test_vds_cihaz_oturum`, `test_ag_sertlestirme`, `test_cihaz_kaniti`, `test_cihaz_yeniden_baglama`, `test_cihaz_kalici_tanima`, `test_cihaz_birlestirme`, `test_cihaz_anahtar_kaybi`, `test_kisa_kimlik_ozet`, `test_audit_followups`, `test_canvas_preview_peripheral_lang`, `test_client_registry`, `test_device_activity`, `test_device_assignment`, `test_device_pairing_flag`, `test_onaysiz_parola_girisi`, `test_device_transport`, `test_lan_tls`, `test_lan_tls_http`, `test_discovery_advertiser`, `test_discovery_identity`, `test_discovery_identity_vekil`, `test_field_address`, `test_label_format_resolver`, `test_label_routing_resolver`, `test_p2_api`, `test_peripheral_for_device`, `test_peripheral_pattern_safety`, `test_peripheral_registry_crud`, `test_peripheral_station_owner`, `test_sack_weigh_source`, `test_session_registry`, `test_totp`, `test_web_hardening`, `test_work_session`, `test_work_session_close_all`, `test_work_session_history_guard`, `test_work_session_stamping`, `test_workstation_permission`, `test_tambur_olcum_kaynagi`, `test_tambur_fatura_cut`, `test_gelen_belge_okuma`, `test_makine_durus_kart`, `test_sayac_kalibrasyon`, `test_middleware_order`, `test_sack_note_document`

İstemci: `PendingBulkReject.test.tsx`, `DevicePairingSection.auto-reattach.test.tsx`, `deviceColumns.rebound.test.ts`, `DurationField.hostedLock.test.tsx`, `panel-yalniz-sifreli.test.ts`, `panel-bulut-yoklama.test.ts`, `sunucu-adresi-modu.test.tsx`, `app-origin.test.ts`, `shell-policy.test.ts`, `trusted-ipc.test.ts`, `web-contents-guard.test.ts`, `preload-gate.test.ts`, `secure-store-core.test.ts`, `useServerReachability.test.ts`, `api-config.test.ts`, `machine-config.test.ts`, `scan-framer.test.ts`, `wedge-detector.test.ts`, `server-identity.test.ts`, `weight-codec.test.ts`, `schema.test.ts`, `clients-utils.test.ts`, `discovery-ipc-contract.test.ts`, `discovery-logic.test.ts`, `ServerDiscoveryList.contract.test.ts`, `ServerDiscoveryList.render.test.tsx`, `useMachinePeripherals.test.ts`, `useSackWeigh.test.tsx`, `discovery.contract.test.ts`, `discovery.test.ts`, `pairingGate.test.ts`, `serverReachability.test.ts`, `btPrinter.service.test.ts`, `discovery.service.test.ts`, `btClassic.transport.test.ts`, `deviceNameMatch.test.ts`, `meter.codec.test.ts`, `deviceSettingsStore.test.ts`, `lan-tls.test.ts`, `connect-src-gate.test.ts`, `update-feed-url.test.ts`, `devicePattern.test.ts`, `deviceId.test.ts`, `hardwareId.test.ts`, `kalicilik.guard.test.ts`, `internet-tls.test.ts`, `play-dagitim.guard.test.ts`, `deviceProof.test.ts`, `BarcodeScannerView.test.tsx`, `resolveShortCutConfig.test.ts`, `shortCutQuality.test.ts`, `ModalTextInput.test.tsx`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

`arsiv/2026-10.md` / `arsiv/2026-09.md`, tarihli başlıklar: 2026-10-19 Onaysız tablet [ÇEKİRDEK] · 10-08 Kimlik ucu vekil · Yalnız şifreli yeni kurulum · Panel sunucu modu · Panel yalnız şifreli · Tablet internet kipi · QR adres · Ortak tablet vc 60 · 10-06 LAN TLS · 10-05 K1 · 10-01 G21-K · G2 · 10-12 Bölge 4+5 · Cihaz kanıtı · 09-30 B6 · 09-04 cihaz onay kapısı, keşif tek sunucu, kademeli port.
