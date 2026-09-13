# Sürüm · Yayın (panel/tablet)

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: anlama turu 2026-09-05 (kök `CLAUDE.md` + `docs/history/CLAUDE-NOT-ARSIVI.md` notlarından ayrıştırıldı). Hikâye, ölçüm ve gerekçe arşivde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> Hakem notu: 12 üye; 8'i gerçekten sürüm/yayın konusu (N0 kök bölüm, N1 backend, N2/N3/N4 mobil, N7/N8 kök tarihli, N9 Electron). N5/N6/N10/N11 kümeye yalnız 'Backend ÖNCE / APK YOK' ibaresiyle düşmüş — dizin kararı kendi kümelerinde. Bayat olanlar: N9 (elle version artırma → 2026-09-02 script), N7 (4 saat → 15 dk, 2026-09-04 kodda), N4:136 + N0 bash bloğu (`build:apk` --musteri'siz; kod zorunlu kılıyor), N8 arşivinin LAN-kanal yarısı (aynı gün VPS'e taşındı). En riskli uyuşmazlık: kök bölümün kendi komut satırı kodun reddedeceği bir çağrı öğretiyor (`npm run build:apk` argümansız); ikincisi 'elle tur' ifadesinin APK'nın tabletçe indirildiği gerçeğini gizlemesi. Sürüm numaralandırması 2026-08-28'de 1.0.0'dan yeniden başladı; eski 2.9.x/vc5x örnekleri tarihsel.


## Ortak (backend + panel + tablet)


### Değişmezler

- **[ÇEKİRDEK]** Sürüm notu yazılmadan sürüm ÇIKMAZ: taslağı Claude yazar, kullanıcı ONAYLAR, onaysız paketlemeye geçilmez. Tek kaynak `surum-notlari.json` (operatör dili; kapsam panel|tablet|her-ikisi, 'sunucu' bilerek yok); panele+tablete gömülür. Kapı beklenen sürümü ARGÜMANDAN alır, not dosyası onu üretmez. · bekçi: `scripts/check-surum-notlari.mjs (paketleme kapısı)` <sub>(CLAUDE.md:182)</sub>
- **[ÇEKİRDEK]** Sürüm numarası artmazsa hiçbir istemci güncellenmez (panel `package.json>version`↔`latest.yml`; tablet paket sürümü + APK `versionCode`). Yama hanesi OTOMATİK: taban git etiketi `panel-v*`/`tablet-v*`, yayın sunucusu DOĞRULAR (eşit/geride → DUR; okunamazsa sessiz geç). Küçük/büyük hane ELLE = karar. · bekçi: `scripts/test_surum.mjs` <sub>(CLAUDE.md:182, CLAUDE.md:78)</sub>
- **[ÇEKİRDEK]** Yükleme SIRASI pazarlık dışı: paket dosyaları ÖNCE, manifest/`latest.yml`/APK künyesi EN SON (yayını AÇAN adım); elle `scp` YOK. Sonra dışarıdan HTTPS doğrulama: temiz URL ↔ `?cb=` kıyası 'yüklenmemiş' ile 'CF'de kalmış 404'ü ayırır (ikincisi yalnız Purge by URL); boyut/sha512 yarım yüklemeyi bulur. · bekçi: `deploy/electron-yayinla.sh dogrula(); deploy/mobil-yayinla.mjs dosyaDogrula` <sub>(CLAUDE.md:182, CLAUDE.md:19, CLAUDE.md:88)</sub>
- **[ÇEKİRDEK]** Cloudflare proxy (turuncu bulut) AÇIK kalmalı: yayın sunucusunun sertifikası Origin CA, ona yalnız CF Edge güvenir; DNS-only'ye çevrilirse panel/tablet güncellemesi SESSİZCE durur. <sub>(CLAUDE.md:182, CLAUDE.md:88)</sub>
- **[ÇEKİRDEK]** Yayın adresi pakete DERLEME ANINDA gömülür (panel `app-update.yml`, tablet AndroidManifest `EXPO_UPDATE_URL`); yanlış müşteri kodu BAŞKA fabrikanın güncellemesini kurar, hata SESSİZDİR. Müşteri kodu tek kaynak `Electron/shared/musteri.json` · `mobil/musteri.json`; adres ondan türer. · bekçi: `Electron/src/test/update-feed-url.test.ts (5 it) + mobil/src/test/update-feed-ur` <sub>(CLAUDE.md:182, CLAUDE.md:88, CLAUDE.md:93)</sub>
- **[ÇEKİRDEK]** ERP adresi (`EXPO_PUBLIC_API_URL`) her tablet yayınında AÇIKÇA verilir — koda gömülü sabit varsayılan YOK (çözülemezse dur). Çözüm TEK KAYNAK `scripts/lib/adres.mjs`: `--api-url` → ortam → `.env*`; localhost ve `/api`siz adres RED. ERP kanalı ↔ güncelleme kanalı AYRI, biri diğerinden TÜRETİLMEZ. · bekçi: `yayinla-ota/build-apk adres kapıları; sonrasında bundle'dan geri okuma` <sub>(CLAUDE.md:182, CLAUDE.md:66, CLAUDE.md:93)</sub>
- **[ÇEKİRDEK]** Manifest yayın anında DONAR ve imzalanır — üreten tek yer `mobil/scripts/lib/manifest.mjs` (imza HAM baytlar üzerinden). Sunucu (VPS nginx ve LAN ikizi `/api/mobile/updates/*`) yalnız bayt servis eder; render eden kod YAZMA. Uçlar PUBLIC (koruma kod imzalama). LAN deposu `app\` DIŞINDA. · bekçi: `Teks-Erp/scripts/test_mobile_update.ts (37 check; tek baytlık bozulma sondası)` <sub>(CLAUDE.md:328, CLAUDE.md:93)</sub>
- **[ÇEKİRDEK]** Kod imzalama AÇIK: OTA anahtarı ve APK mührü `mobil/keystore/` altında, git DIŞI, VPS'e GİTMEZ; imza geçersizse tablet paketi reddeder; sertifika APK'ya gömülü değilse istemci imzayı HİÇ kontrol etmez (build-apk durdurur). Anahtar kaybı = her tablette sil+kur. `codesigning:configure` tuzağı bekçili. · bekçi: `mobil/src/test/update-feed-url.test.ts:71 (updates.enabled===true); build-apk.mj` <sub>(CLAUDE.md:19, CLAUDE.md:128, CLAUDE.md:93)</sub>
- **[ÇEKİRDEK]** İstemci sürüm politikası KODDA sabit (`client-version-policy.ts` kayıt defteri; yeni istemci = satır), uç `GET /api/client-policy/:istemci` PUBLIC, istemci FAIL-OPEN, tanımsız istemci 404. `minVersion` YALNIZ gerçek sözleşme kırılmasında yükselir, sahadakinden BÜYÜK olamaz; önce istemci yayınlanır. · bekçi: `Teks-Erp/scripts/test_client_policy.ts (§3 minVersion <= Electron package.json)` <sub>(CLAUDE.md:182, CLAUDE.md:328)</sub>

### Yasaklar

- **[ÇEKİRDEK]** OTA turunda `android.versionCode`a DOKUNULMAZ (tablet onu kurulu APK sürümü sanar, gerçek APK'yı bir daha teklif etmez). `versionCode` YALNIZ yayınlanacak APK için artar; `app.json` ↔ yayındaki `apk/surum.json` ayrışırsa OTA durur → 'native değişti mi?': hayırsa GERİ AL, evetse ÖNCE APK. · bekçi: `yayinla-ota.mjs versionCode kapısı` <sub>(CLAUDE.md:182)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Deploy sırası: backend ÖNCE, panel + tablet (OTA/APK) SONRA — yeni uç/anahtar/tablo eski istemciyi bozmaz; sözleşme kıran değişiklikte (uç kaldırma, alan adı/tipi, zorunlu parametre, enum, izin) 'eski istemci ne yapar' sorusu AÇIKÇA cevaplanır, gerekirse minVersion yükselir. <sub>(CLAUDE.md:328, CLAUDE.md:70, CLAUDE.md:94)</sub>

## Backend


### Değişmezler

- **[ÇEKİRDEK]** Backend paketi SÜRÜM BELGESİZ üretilmez: `docs/surumler/backend-<sürüm>.md` yoksa `paketle.ps1` DURUR (kapı sürüm çözüldükten hemen sonra, ağır işten ÖNCE). Yedi başlık zorunlu (özet · ne değişti · sözleşme · migration · kurulum notu · geri alma · doğrulama); paket adı/SHA256/commit'i MAKİNE yazar, elle kopyalanmaz. Belge KURANA yazılır (teknik dil serbest) — operatör notu `surum-notlari.json`dur ve backend oraya GİRMEZ. · bekçi: `scripts/test_surum_belgesi.ts` <sub>(arşiv:2026-09-10 sürüm belgesi)</sub>
- **[ÇEKİRDEK]** Mobilde sürüm İKİ EKSENLİ: `minVersion` (APK) + `minPaketTarihi` (OTA paketi, `Updates.createdAt`; JS düzeltmesi versionName'i değiştirmez); `paketTarihi=null` ESKİ SAYILMAZ; tanımsızsa yalnız minVersion. Tablet kilidi KOŞULLU (kurulabilir düzeltme + gönderilmemiş kayıt yok). Önce paket çıkar. · bekçi: `Teks-Erp/scripts/test_client_policy.ts; mobil clientPolicy.service.test.ts` <sub>(CLAUDE.md:328, CLAUDE.md:128)</sub>

## Panel (Electron)


### Değişmezler

- **[ÇEKİRDEK]** Panel yayın adresi TEK KAYNAK: `shared/update-feed.ts` ↔ `package.json > build.publish` (ayrışma SESSİZ arıza; `publish` bloğu kalkarsa electron-builder `latest.yml` HİÇ üretmez). `artifactName` ASCII kalır, `${productName}` YASAK (ad `latest.yml`de URL'dir; `Ş`+boşluk 404 üretir). · bekçi: `Electron/src/test/update-feed-url.test.ts:39-73 + electron-paketle.sh:131-133 (d` <sub>(CLAUDE.md:88, CLAUDE.md:78)</sub>

### Tuzaklar

- **[PROFİL]** `nsis.perMachine:true` KALIR (kullanıcı kararı): her güncellemede bir Windows izin penceresi; o makinedeki hesap yönetici DEĞİLSE güncelleme o makinede kurulmaz ve panel sessizce eski sürümde kalır. Değiştirmek `perMachine:false` + bir elle tur. <sub>(CLAUDE.md:88, CLAUDE.md:78)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Makineye özel adres ezmesi (`config.updateFeedUrl`, secure-store) bulunur: adres pakete derleme anında gömüldüğü için yanlış gömülen adresin tek çıkışıdır; bozuk ezme sessizce yok sayılıp varsayılana dönülür. <sub>(CLAUDE.md:88)</sub>

### Kararlar

- **[ÇEKİRDEK]** Electron güncelleyici: `autoUpdater`a modül gövdesinde DOKUNMA (`updater()` getter); `autoInstallOnAppQuit=false`; şerit YALNIZ `ready` (error körleştirir); güncelleme ZORUNLU (`UpdateGate` + 2 dk geri sayım, 20 sn kurulum bekçisi, 5 dk tekrar); zamanlayıcı YALNIZ main'de: 30 sn + 15 dk. · bekçi: `yok — zamanlayıcı yarısı HARİÇ: update-check-interval.test.ts (15 dk kaynaktan · tek setInterval yalnız main · renderer'da setTimeout yok; ölçüldü 2026-09-13, eski beyan "yok (kod yorumları)" bu yarıyı görmüyordu); getter · autoInstallOnAppQuit · şerit-yalnız-ready · UpdateGate süreleri için bekçi yok (update-gate-escape.test.ts yalnız kaçış yolunu ölçer)` · Kapanır: `Electron'da bir bekçi updater.ipc.ts üstünde şunları ölçtüğünde — (i) "autoInstallOnAppQuit = false" satırı var (bugün 1), (ii) electronUpdater.autoUpdater'a getter gövdesi dışından erişim 0 (bugün: 1 tip + 1 getter, 0 dışarıdan), (iii) şerit yalnız "ready" olayına bağlı, error körleştirmiyor — ve bekçi haritasına yazıldığında` · Öncül: ölçüldü <sub>(CLAUDE.md:88, CLAUDE.md:78)</sub>

## Tablet (mobil)


### Değişmezler

- **[ÇEKİRDEK]** `runtimeVersion` (app.json) JS↔native uyum kimliğidir, backend sözleşmesini KAPSAMAZ; süzmesi SUNUCUNUN işidir (istemci indirmede bakmaz, yanlış sürümü indirip sessizce eler) → adres sürümü İÇERİR (`/<müşteri>/mobil/ota/<rv>/manifest`), her APK yalnız kendi paketini görür. · bekçi: `Teks-Erp/scripts/test_mobile_update.ts (37; backend↔mobil↔nginx tutarlılığı)` <sub>(CLAUDE.md:128, CLAUDE.md:93)</sub>
- **[ÇEKİRDEK]** OTA turu da yama numarası alır; tablette görünen sürüm APK'dan DEĞİL PAKETTEN okunur (`Constants.expoConfig.version` → manifestin `extra.expoClient`i), native'e dokunmadan değişir. Yayındaki sürüm `multipart/mixed` gövdenin `manifest` parçasından çözülür ('ilk { son }' kestirmesi ÇALIŞMAZ). · bekçi: `scripts/test_surum.mjs (manifestGovdesindenSurum)` <sub>(CLAUDE.md:182)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** `usesCleartextTraffic` app.json → `android` altında GEÇERSİZ (SDK 54 sessizce atar); yalnız `expo-build-properties` android bloğu geçerli. `android/` git dışı prebuild ÇIKTISI: eski klasör doğru görünür, prebuild'de bayrak düşer → APK hiç istek yollayamaz. BEKÇİ YOK: prebuild sonrası grep'le bak. · bekçi: `yok (bilinçli; mobil/scripts/build-apk.mjs yalnız grep komutunu BASAR, koşmaz)` · Kapanır: `build-apk.mjs (ya da yayinla) android/app/src/main/AndroidManifest.xml içinde android:usesCleartextTraffic="true" yokken çıkış kodu sıfır-dışı ile DURDUĞUNDA — bugün o script'te bayrağı okuyan satır 0, hatırlatan satır 1; kapı, hatırlatmayı komuta çevirdiğinde ve negatif sondası (bayrak silinmiş manifest → kırmızı) kaydedildiğinde` · Öncül: ölçüldü <sub>(CLAUDE.md:66)</sub>
- **[ÇEKİRDEK]** Bundle doğrulama: release bundle Hermes bytecode — ASCII dizeler düz metin, Türkçe karakterli dizeler UTF-16 tablosuna gider ve grep BULMAZ; dizeler uç uca ('sonrasında harf gelmesin' sondajı eşleşmeyi eler). Hep ASCII dize ara. Sıcak Metro/Gradle önbelleği env'i görmez: HIZLI build bayat adrestir. · bekçi: `build-apk.mjs önbellek silme + bundle geri okuma` <sub>(CLAUDE.md:66)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Tablet kanalı TAHMİN EDİLMEZ: `npm run yayinla:check -- --musteri=<kod>` → 'parmak izi tutarlı' = OTA, 'NATIVE DEĞİŞTİ' = `runtimeVersion` artır + APK. Parmak izi değişip runtimeVersion aynıysa yayın DURUR (`--parmak-izini-kabul-et` bilinçli); şüphede runtimeVersion ARTIR. Kayıt `alg` taşır. · bekçi: `yayinla-ota.mjs parmakIziKapisi (--check yan etkisiz)` <sub>(CLAUDE.md:19, CLAUDE.md:128, CLAUDE.md:93)</sub>

### Kararlar

- **[ÇEKİRDEK]** APK arm64, güncelleme kanalından yayınlanır (`mobil-yayinla.mjs --apk --surum --vc`; önce apk sonra künye). Tablet künyeyi (`apk/surum.json`) kanaldan okur (`apiClient` DEĞİL), `versionCode` ile kıyaslar, indirir, Android kurulum ekranını AÇAR — sessiz kurulum yok, operatör 'Yükle'ye dokunur. · bekçi: `mobil-yayinla.mjs künye doğrulaması (versionCode yayında mı)` <sub>(CLAUDE.md:93, CLAUDE.md:182, CLAUDE.md:19)</sub>
- **[PROFİL]** 'İki adres farklı' (ERP ↔ güncelleme kanalı) uyarısı EKLENMEZ — kanallar ayrılınca her cihazda kalıcı yanlış alarma dönüşürdü; iki bağlantı etiketli bilgi olarak basılır. Hep bağıran uyarı gerçek sapmada da susar. <sub>(CLAUDE.md:93)</sub>

## Geçersiz kılınan kurallar — bunlara UYMA

- **KISMI** `E:2026-08-26__otomatik-guncelleme-2026-08-26` → `R:undated__surum-yayinlama-sahaya-guncelleme-cikarma`: Panel sürüm numarasını artırma işi ELLE adım olmaktan çıktı: yama hanesini `deploy/electron-paketle.sh` git etiketinden (`panel-v*`) türetip package.json'a kendisi yazar; elle verilen argüman yalnız küçük/büyük hane kararı. 'Numara artmazsa güncelleme yok' kuralı aynen geçerli, aktörü değişti. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-26__2026-08-26-electron-dagitimi-guncelleyici` → `kod: Electron/shared/update-schedule.ts (commit 2f158434, 2026-09-04) — bu bundle'da notu yok`: Panelin periyodik güncelleme kontrolü 4 saatten 15 dakikaya indi (kullanıcı kararı); açılıştan 30 sn sonra ilk kontrol aynen. Kök notun '4 saatte bir' cümlesi bayat. ✅ çürütmeden geçti
- **KISMI** `M:undated__uzaktan-guncelleme-ota-apk-sahaya-nasil` → `M:undated__guncelleme-dagitma-once-bu-bolum`: Aynı dosyada iki komut satırı: N4 `npm run build:apk` argümansız; N2 tablosu `npm run build:apk -- --musteri=<kod>` ve '`--musteri` HER KOMUTTA ZORUNLU'. Kod N2'yi uyguluyor; N4'ün komutu ve '(elle kurulur)' ibaresi bayat. Kök bölümdeki (N0) aynı satır da bayat. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-26__2026-08-26-mobil-uzaktan-guncelleme` → `R:2026-08-26__2026-08-26-mobil-uzaktan-guncelleme`: Aynı notun içinde kanal değişti: LAN kanalı (`/api/mobile/updates/manifest` render eden backend, `updates/<rv>/YAYINDA` işaretçisi, `/api/mobile/app-version`+`app-download`, 'kod imzalama kapsam dışı') aynı gün VPS statik kanalına çevrildi — manifest donuk, künye `apk/surum.json`, kod imzalama AÇIK. Backend'de LAN ikizi yalnız statik servis kaldı. ✅ çürütmeden geçti
- **TAM** `R:2026-08-26__2026-08-26-mobil-uzaktan-guncelleme` → `R:undated__surum-yayinlama-sahaya-guncelleme-cikarma`: Sürüm numaralandırması 2026-08-28'de 1.0.0'dan yeniden başladı; arşivdeki 'APK 2.9.8/vc55', '2.9.9/vc56' ve N7'nin '2.7.0 → 2.8.2' rakamları tarihsel. Bugün panel 1.2.7 (`panel-v1.2.7`), tablet 1.0.6 / versionCode 57 (`tablet-v1.0.6`). ✅ çürütmeden geçti
- **TAM** `R:2026-08-26__2026-08-26-electron-dagitimi-guncelleyici` → `R:undated__surum-yayinlama-sahaya-guncelleme-cikarma`: 'Son bir elle tur kaçınılmaz (güncelleyici sahadaki sürümlerde yok)' bir kerelik geçiş göreviydi ve bitti: o günden beri 7 panel + 6 tablet sürümü otomatik kanaldan çıktı. Kural değil tarihçe. ⚠️ çürütücü itiraz etti — ihtiyatla

## Çözülmüş çelişkiler

- `R:undated__surum-yayinlama-sahaya-guncelleme-cikarma` ↔ `M:undated__guncelleme-dagitma-once-bu-bolum`: Kod N2'yi uygular: `build-apk.mjs` `--musteri` yoksa `dur()` ile çıkar; kök bölümdeki komut bugün hata verir. Kök bash bloğu `npm run build:apk -- --musteri=<müşteri>` olarak düzeltilmeli (mobil/CLAUDE.md:69 zaten doğru yazımı taşıyor).
- `M:undated__guncelleme-dagitma-once-bu-bolum` ↔ `R:undated__surum-yayinlama-sahaya-guncelleme-cikarma`: İkisi de kısmen doğru, ifade yanıltıcı: APK güncelleme kanalına yüklenir (`mobil-yayinla.mjs --apk`), tablet künyeyi `apk/surum.json`dan okuyup `versionCode` ile kıyaslar, indirir ve Android kurulum ekranını AÇAR; sessiz kurulum yok → operatör her tablette bir kez 'Yükle'ye dokunur. 'Elle tur' = cihaz başında dokunuş, USB/elden APK taşıma değil.
- `R:undated__surum-yayinlama-sahaya-guncelleme-cikarma` ↔ `M:undated__apk-derleme-sahaya-kurulacak-paket-tek`: Koda gömülü sabit varsayılan YOK (adres çözülemezse `dur()`), ama `.env.production.local/.env.local/.env.production/.env` dosyaları üçüncü kaynak olarak okunur ve script kaynağı basar; localhost ve `/api`siz adres reddedilir. Bugün mobil/ altında yalnız `.env.example` var → pratikte açık verme zorunlu. Kök cümle 'sabit varsayılan yok' diye okunmalı.

## Açık sorular

- N5 (mobil okutma bekçileri), N6 (2026-08-19 Tambur paketi), N10 (sipariş görünürlüğü), N11 (süperadmin P8) bu kümeye ait değil — yalnız 'Backend ÖNCE / APK YOK' ibaresiyle düşmüş; dizin/arşiv kararı kendi kümelerinde verilmeli (burada archiveOnly'ye BİLEREK yazılmadı).
- client-version-policy.ts yorumları eski numaralandırmayı anlatıyor (:84-86 'minVersion 2.8.1', :139-141 '2.9.8 = ilk sürüm') ama değerler 1.0.0; ELECTRON currentVersion 1.2.6 ↔ Electron/package.json 1.2.7 (test_client_policy yalnız ℹ️ basar). Kod yorumu/değer bayat — kural değil, temizlik.
- Bekçi sayıları notlarda oynak: update-feed-url.test Electron'da 5 `it`, mobil'de 10 `it` (notlar 3 / 7 / 10 diyor); test_mobile_update 37 check tutuyor. Kural etkilenmez.
- mobil/app.json:25 `usesCleartextTraffic` `android` altında da duruyor (N3'e göre sessizce yok sayılır) — zararsız kopya ama 'bayrak burada yeter' yanılgısı üretebilir; bekçi hâlâ YOK.
- docs/ops/MOBIL-UZAKTAN-GUNCELLEME.md:146 ve kök CLAUDE.md:210 `npm run build:apk` argümansız — kod `--musteri` ister; iki reçete satırı düzeltilmeli.

## Doğrulama turu ekleri (eski CLAUDE.md ↔ yeni yapı karşılaştırması, 2026-09-05)

- **[ÇEKİRDEK]** APK derlemesinden ÖNCE backend `<kök>/health` yoklanır; sonuç UYARIDIR, derlemeyi DURDURMAZ (derleyen Mac fabrika ağında olmayabilir) — 'ölü IP de geçerli IP'dir' tuzağının karşılığı. <sub>(eski mobil/CLAUDE.md APK tuzak tablosu)</sub>
- **[ÇEKİRDEK]** `versionCode` ayrışmasında ölçüm: `git log tablet-v<son>..HEAD -- mobil/android mobil/app.json mobil/package.json` — native gerçekten değişti mi? Değişmediyse `app.json` değeri yayındakine GERİ ALINIR. <sub>(kök sürüm yayınlama §5)</sub>

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (tek testte tip kapısı atlanır) · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`.

**Ne ölçtükleri, DB gerektirip gerektirmedikleri ve bayatlık işaretleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → bu alanın bölümü.** ⚠️ = orada gerekçesi yazılı bayatlık şüphesi.

Backend: `test_backend_surum`, `test_client_policy`, `test_client_registry`, `test_db_copy`, `test_migration_hygiene`, `test_mobile_update`, `test_offsite_sweep`

İstemci: `GuncellemeDugmesi.test.tsx`⚠️, `surum-notlari.test.ts`⚠️, `version-compare.test.ts`⚠️, `clients-utils.test.ts`, `update-check-interval.test.ts`, `update-feed-url.test.ts`, `update-gate-escape.test.ts`, `UpdateActions.test.tsx`, `appUpdate.service.test.ts`, `clientPolicy.service.test.ts`, `surumNotlari.test.ts`, `update-feed-url.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-08-19 · 2026-08-19 — TAMBUR PAKETİ 2: sektör boşluklarının kapatılması; dördü de MEVCUT yetkiye bağlı, yetkisizde UI H — `CLAUDE-NOT-ARSIVI.md:404-413`
- 2026-08-26 · 2026-08-26 — Electron dağıtımı: setup elden ele taşınıyordu, güncelleyici KURULUYDU ama hiçbir yere bağlanmamı — `CLAUDE-NOT-ARSIVI.md:958-1010`
- 2026-08-26 · 2026-08-26 — Mobil uzaktan güncelleme: APK elden ele taşınıyordu, JS paketi hiç ayrılmamıştı — `CLAUDE-NOT-ARSIVI.md:1117-1376`
- 2026-08-27 · 2026-08-27 — Sipariş görünürlüğü: şerit + altı rapor + iptal sebebi + kalem iptali — `CLAUDE-NOT-ARSIVI.md:1521-1655`
- 2026-09-03 · 2026-09-03 — Süperadmin doğuşu P8: iki yol iki sır yüzeyi; sessiz kilitlenme kabul edilemez — `CLAUDE-NOT-ARSIVI.md:2204-2216`