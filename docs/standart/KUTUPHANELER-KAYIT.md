# Kütüphaneler — §9 kayıt defteri

> `KUTUPHANELER.md` §9'dan bölündü (2026-11-02; o dosya boyut tavanına 202 bayt kalmıştı — kural kalır, ENVANTER ayrılır, §2 → `KUTUPHANELER-TABLO.md` emsali). Kayıt biçimi `KUTUPHANELER.md` §3; en yeni kayıt üstte.

### pi-heif==1.4.0 · okuma · 2026-11-02
1. Problem      : Gelen Belgeler'e iPhone fotoğrafı (HEIC/HEIF) yüklenemiyor; tarayıcı HEIC çizemez, okuma (OpenCV) çözemez. Sistem JPEG saklamalı. Kullanıcı kararı 2026-11-02 01:53 (şıklı): `pi-heif` okuma servisinde; onay YALNIZ pi-heif + zorunlu geçişlileri
2. Alternatifler: `pillow-heif` (aynı yazar; x265 kodlayıcısı içerir → GPL) · Node'da `heic-convert`/`heic-decode` (libheif-js WASM, backend'e yeni paket + bellek) · `sharp` (prebuilt libvips HEIC'i lisans gereği çözmez) · panelde dönüştürme (tarayıcı HEIC çözmez, tablet yolu da kapsanmaz) — SEÇİLDİ: pi-heif, okuma'da tek uç `POST /donustur`
3. Boyut/biçim  : tekerlek ~1–2 MB (libheif 1.23.0 + libde265 1.1.0 gömülü; AVIF ve kodlayıcı YOK, `libheif_info()` ile ölçüldü); tek geçişli `pillow` 13.0.0 zaten kurulu. `cp312` tekerlekleri: manylinux x86_64/aarch64 · musllinux · win_amd64 · macOS; `hash-uret.py` 48 dağıtım özetini yazdı, Linux + Windows tekerleği `pip download --require-hashes` ile doğrulandı
4. Bakım        : 1.4.0 (bigcat88/pillow_heif, düzenli yayın); TAM SABİT — `Image.open(formats=["HEIF"])`, irot uygulaması ve EXIF yönü sıfırlama bu sürümde ölçüldü (`tests/test_donustur.py`)
5. Lisans       : pi-heif BSD-3-Clause; gömülü libheif/libde265 LGPL-3.0 (dinamik bağlı paylaşımlı kitaplık, değiştirilmeden); copyleft kodlayıcı YOK
6. Dağıtım      : okuma'nın fabrika paketi henüz yok (ayrı dilim); kurulum `pip install --require-hashes --no-deps -r requirements.txt` — eski okuma `/donustur`suz kalırsa backend HEIC'i 503 `HEIC_CONVERT_UNAVAILABLE` ile reddeder (JPEG/PNG/PDF etkilenmez)

### Belge tarayıcı: yerel Expo modülü `mobil/modules/teks-erp-belge-tarayici/` + Gradle com.google.android.gms:play-services-mlkit-document-scanner 16.0.0 · mobil · 2026-11-02
1. Problem      : Belge Tara (gelen-belge) sayfa fotoğrafı eğik/kenarlı/gölgeli geliyor; okuma isabeti için kenar bulma · kırpma · perspektif düzeltme · netleştirme gerekiyor; §2.3 "Belge tarama" satırı. Kullanıcı onayı 2026-11-02 ("Evet, ekle")
2. Alternatifler: `react-native-document-scanner-plugin` 2.0.4 (MIT, son yayın 2026-01) — galeri içe aktarmayı KAPATAMIYOR, her çağrıda etkinlik sonucu kaydı açıp kapatmıyor, `getStartScanIntent` için zaman aşımı yok (modül inmemiş çevrimdışı tablette asılı kalır), sayfayı kalite 100 ile yeniden kodluyor (5 MB tavanı) · `@infinitered/react-native-mlkit-document-scanner` 5.0.0 (MIT, son yayın 2025-11) — ML Kit 16.0.0-beta1, `-core` peer olarak `expo-image` çeker, uygunluk yoklaması yok · elle yazmak (SEÇİLDİ, [KU-07]): ~250 satır Kotlin, `teks-erp-lan-tls` emsali; galeri kapalı, `ModuleInstall.areModulesAvailable` + `deferredInstall`, açılış zaman aşımı, uzun kenar 2600 / kalite 0,8 / 5 MB basamaklı yeniden kodlama bizde
3. Boyut/biçim  : NATIVE; npm paketi YOK. Tarayıcı arayüzü + modeli Play Hizmetleri'nden iner (APK'ya girmez); `mlkit:common`, `play-services-base`, `datatransport` zaten `expo-camera` (barkod ML Kit) ile pakette ⇒ net katkı tarayıcı istemcisi (~380 KB AAR, tahmin < 0,5 MB). Manifest izin kümesi DEĞİŞMEZ (yalnız görünmez temsilci etkinliği; prebuild ile ölçüldü)
4. Bakım        : 16.0.0 kararlı (2025-09-25, Google); TAM SABİT ([KU-12]) — seçenek kümesi bu sürümde ölçüldü; pin `mobil/src/test/belge-tarayici.guard.test.ts`
5. Lisans       : Android SDK / Google APIs Hizmet Şartları (Play Hizmetleri istemcisi; mevcut `play-services-code-scanner` · `mlkit:barcode-scanning` ile aynı sınıf); copyleft YOK
6. Dağıtım      : OTA ile GİTMEZ — yeni AAB + `runtimeVersion` artışı ([KU-11]); JS tarafı modülü `requireOptionalNativeModule` ile arar, eski APK'da klasik kamera çalışır (OTA güvenli)

### @codemirror/{state,view,language,commands,autocomplete,lint,lang-html,lang-css,lang-json} + @lezer/highlight@1.2.5 · Electron · 2026-10-25
1. Problem      : Belge Tasarımcısı kod sekmeleri (plan §4, T4: HTML+Liquid / CSS / Sayfa JSON; sözleşmeden tamamlama, sunucu hatası altı çizili); ORTAK: rapor kod kipi (R2-KOD) aynı seti kullanır
2. Alternatifler: elle `<textarea>` (renk/tamamlama/altı çizili hata yok) · Monaco (~3 MB, D1'de elendi) · `@uiw/react-codemirror` + `@codemirror/lang-liquid` (patron 2026-10-25: sarmalayıcı yerine çekirdek set; Liquid tamamlaması sözleşmeden kendi kaynağımız)
3. Boyut/biçim  : saf JS, native YOK, ESM; yalnız `DocumentDesigner/code/` ve `Reports/_v2/custom/code/` import eder → ikisi de tembel parça ([KU-17]; rapor kipi `CodeTab` `lazy()` ile yalnız Kod sekmesinde yüklenir); geçişli `@codemirror/lang-javascript`, `@lezer/*`, `style-mod`, `w3c-keyname`, `crelt` (MIT)
4. Bakım        : 6.x, TAM SABİT, TEK `@codemirror/state` sürümü (iki kopya = "Unrecognized extension value" çöküşü); pin `test_dependency_contract §(a)`
5. Lisans       : MIT (hepsi)
6. Dağıtım      : rebuild GEREKMEZ; tema kendi uzantımız (panel CSS değişkenleri, açık/koyu) — `theme-one-dark` YOK

### simple-statistics@7.12.1 · Teks-Erp · 2026-10-25
1. Problem      : rapor v2 analiz bloğu (R3-ISTAT, plan §3.8) Pearson/Spearman katsayısı; §2.1 "Rapor analizi"
2. Alternatifler: kendi uygulaması (~150 satır) · `jstat` (bakımsız) · `mathjs` (~700 KB) — olasılık kuyruğu kendi `dagilim.ts`
3. Boyut/biçim  : saf JS, native YOK, bağımlılıksız; CJS `dist/simple-statistics.cjs`; KU-18 `require()` sınandı
4. Bakım        : TAM SABİT; yalnız `sampleCorrelation` — yükseltme `test_rapor_istatistik` §2 ile ölçülür
5. Lisans       : ISC
6. Dağıtım      : yalnız backend paketi
7. Onay         : KULLANICI ONAYI BEKLİYOR; red → kendi uygulaması, `test_rapor_istatistik` §2 aynen geçmeli

### grapesjs@0.23.8 · Electron · 2026-10-24
1. Problem      : Belge Tasarımcısı (plan D1/T2) — sürükle-bırak blok, katman, CSS stil paneli; HTML/CSS Liquid şablonuna gider
2. Alternatifler: elle yazmak (aylar) · Puck / Craft.js (HTML kod kipi yok) · Studio SDK / Unlayer (ücretli) · `@grapesjs/react` (EKLENMEDİ: tek `useEffect` + `appendTo` yeter) — patron kararı D1
3. Boyut/biçim  : saf JS, native YOK, CDN YOK; yalnız `DocumentDesigner/` import eder, `React.lazy` ayrı parça ([KU-17]): 1.171 KB JS + 62 KB CSS, ana parçada YOK (ölçüldü 2026-10-25); geçişli backbone · underscore · backbone-undo · codemirror 5 · html-entities · promise-polyfill (hepsi MIT)
4. Bakım        : 0.x, TAM SABİT (yama sürümü olay adlarını değiştirebilir; 0.23.7 eksik yayın şüphesi); pin `createEditor.test.ts`
5. Lisans       : BSD-3-Clause
6. Dağıtım      : rebuild GEREKMEZ. ⚠️ Varsayılan `telemetry:true` → `app.grapesjs.com`e gider, panel CSP'si (`connect-src https:`) engellemez → `telemetry:false` zorunlu; `cssIcons` → `''`. Kanvas `sandbox="allow-same-origin"` (enjekte script çalışmaz) — bekçi `iframe-sandbox.test.ts`

### liquidjs@10.30.0 · Teks-Erp · 2026-10-24
1. Problem      : belge şablon tasarımcısı (plan `docs/design/BELGE-SABLON-TASARIMCISI-PLAN.md` §3.3, §5) kullanıcı şablonunda döngü/koşul/filtre ister; mantıksız `{{alan}}` motoru (refakat kartı RAW_HTML) bunu taşımaz; §2.1 "Belge şablon dili" satırı
2. Alternatifler: elle motor (ifade ayrıştırıcısı + kum havuzu = en riskli kod sınıfı; red) · Handlebars (yardımcı = JS; `compile` JS üretir; red) · Nunjucks (JS'e derler, kum havuzu yok; red) · Eta/EJS (şablon = JS; red) · LiquidJS: JS üretmez, `strictVariables/strictFilters/ownPropertyOnly`, süre/bellek/parse sınırı yerleşik
3. Boyut/biçim  : saf JS, native YOK; CJS girişi `dist/liquid.node.js` (`require()` sınavı geçti); geçişli tek bağımlılık `commander@10.0.1` (yalnız CLI bin'i, çalışma anında yüklenmez)
4. Bakım        : 10.30.0, TAM SABİT — `{% echo %}`/`{% cycle %}` veriyi `outputEscape`ten geçirmeden yazıyor ve `capture` dize katlaması `memoryLimit`e sayılmıyor (ÖLÇÜLDÜ; `motor/liquid.ts` sarmalayıcıları buna dayanır) ⇒ yükseltme yeniden ölçüm ister; `test_dependency_contract §(a)` + `test_belge_liquid_kati` korur
5. Lisans       : MIT (commander MIT)
6. Dağıtım      : yalnız backend paketi; Electron/mobil etkisi yok

### echarts@6.1.0 · Electron · 2026-10-24
1. Problem      : Raporlar v2 grafikleri (8 tür: çizgi/önceki dönem soluk, çubuk, yığın, pasta, ısı haritası, saçılım, kutu, küçük çoklu) ekranda + PDF'e VEKTÖR (DOM'suz SVG SSR); §2.2 "Tema · animasyon · grafik" satırı — tek grafik motoru, `recharts` emekliye ayrılıyor (yeni import cırcırla yasak)
2. Alternatifler: `recharts` (SVG-SSR yok — baskı için DOM'a çizip kopyalamak gerekir; ısı haritası/kutu/korelasyon grafikleri zayıf) · Vega-Lite (+~275 KB, ikinci motor + ayrı şema dili) · elle yazmak (8 tür × eksen/etiket yerleşimi — bakım yükü) — kullanıcı "kütüphane kullan" yönlendirmesi, plan K2
3. Boyut/biçim  : saf JS, native YOK; ESM + `echarts/core` ağaç sallama (yalnız 6 grafik + 5 bileşen + 2 çizici); YALNIZ `Reports/_v2/grafik/motor.ts` statik import eder, o da `await import` ile ayrı parça (~656 KB küçültülmüş / ~224 KB gzip, ölçüldü) ([KU-17]; bekçi `raporGrafik.test.tsx`); geçişli `zrender` 6.1.0 (BSD-3) + `tslib` 2.3.0 (0BSD)
4. Bakım        : 6.1.0 (Apache vakfı, düzenli yayın); TAM SABİT — SVG çıktısı PDF'in kendisidir, yama sürümü bile kâğıdı değiştirebilir (bilinçli yükseltme); pin `raporGrafik.test.tsx` § paket sözleşmesi
5. Lisans       : Apache-2.0
6. Dağıtım      : Electron rebuild GEREKMEZ (native yok); panel paketiyle gider; Türkçe yerel ayar kaydedilmez — eksen/ipucu metni `lib/number-format` + `lib/factory-time` ile bizde biçimlenir, araç kutusu/zaman ekseni kullanılmaz (`i18n/langTR-obj` UMD, ESM'de nesnesiz döner — ölçüldü)

### react-native-reanimated@~4.1.1 + react-native-worklets@0.5.1 + expo-haptics@~15.0.8 + @expo/vector-icons@^15.0.3 · patron/uygulama · 2026-10-22
Dördü de mobilde §2'de kayıtlı aynı satırın ([KU-01]) patron uygulamasına taşınmasıdır; yeni ihtiyaç satırı açılmaz. Lisans: dördü de MIT. Sürümler `npx expo install` ile SDK 54 uyumlu aralıkta, SDK yükseltmesiyle birlikte gider; dağıtım: patron uygulaması için native modül ⇒ yeni mağaza derlemesi, OTA yetmez ([KU-11]).
- `react-native-reanimated` : tasarım dili v2'nin geçiş/basma animasyonları UI iş parçacığında; alternatif RN `Animated` (sürücüsü JS iş parçacığında, düzen animasyonu yok) ve elle yazmak reddedildi.
- `react-native-worklets`  : reanimated 4'ün zorunlu peer'ı; tek başına gerekçesi yok, reanimated çıkarsa birlikte çıkar.
- `expo-haptics`           : `src/ui/haptics.ts` tek boğazından dokunsal geri bildirim; elle native modül reddedildi, `VIBRATE` izni `blockedPermissions`te kalır (izin etkisi yok).
- `@expo/vector-icons`     : sekme/ray/KPI ikonları (`src/ui/icons.ts`); zaten geçişli kuruluydu, yalnız beyan edildi; `react-native-vector-icons` kullanılmaz ([KU-21]).

### expo-notifications@0.32.17 · mobil · 2026-10-11
1. Problem      : tezgah alarmı (Faz A3/A6a) uygulama arka plandayken telefona/tablete ulaşmalı; ölçüm: RN 0.81 Android'de arka planda JS zamanlayıcıları DURUR (`JavaTimerManager.onHostPause`) ⇒ tek araç işletim sisteminin zamanladığı yerel bildirim; §2.3 "Yerel bildirim" satırı
2. Alternatifler: elle yazılmış native modül (AlarmManager + kanal + izin + dokunma köprüsü — bakım yükü, Expo prebuild dışı) · `notifee` (ön plan servisi verir ama ayrı native paket, Expo eklentisi yok, internet push için yine FCM ister) · `expo-background-task` + `expo-task-manager` (≥15 dk WorkManager — alarm için yavaş, iki paket)
3. Boyut/biçim  : NATIVE modül (`android/` + `expo-module.config.json`; manifest `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `firebase-messaging` bağımlılığı); JS tarafı yalnız `services/alarmNotify.ts`ten tembel+try/catch `require` (native'i olmayan eski APK'da çökmez)
4. Bakım        : Expo SDK 54 pinli (`npx expo install`, `~0.32.17`); SDK yükseltmesiyle birlikte gider ([KU-12])
5. Lisans       : MIT
6. Dağıtım      : OTA ile GİTMEZ — yeni APK/AAB + `runtimeVersion` artışı; bu iş main'e indikten sonraki İLK tablet sürümü APK turudur (borç: `docs/kurallar/surum-yayin.md`); internet push (FCM/APNs) bu paketle aynı köprüden ayrı dilimde gelir

Önceki tek karar sonucu "paket YOK"tur:
**backend log kanalı** (2026-09-07) — `pino`/`winston` yerine **elle yazmak**
seçildi ([KU-07]), çünkü taşımayı pm2 ve rotasyonu `pm2-logrotate` zaten
yapıyordu; kalan tek eksik seviye + alan etiketiydi. Altı satırlık kayıt, ölçüm
ve sonuç arşivde: `docs/history/arsiv/2026-09.md` (2026-09-07) ve
`Teks-Erp/src/lib/logger.ts` başlığı. Yeni paket eklenince §3'teki blok buraya,
§2'ye bir satır yazılır.
