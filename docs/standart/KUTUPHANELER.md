# Kütüphaneler — katman × ihtiyaç, karar kaydı, ölü paket teşhisi

Bu dosya bir **yasak listesi değil, kayıtlı karar defteridir**. Yeni kütüphane yasak değildir; kaydı zorunludur. Bir paket "yok" diye değil, "bu ihtiyacı zaten Y karşılıyor" diye reddedilir — Y yoksa ekleme normal iştir.

Kural biçimi: [`README.md`](README.md). Katman-üstü ilkeler [`ILKELER.md`](ILKELER.md)'de (`[IL-xx]` ile atıf), kadans [`TEST-VE-DERLEME.md`](TEST-VE-DERLEME.md)'de — tekrar edilmez.

Ham ölçüm: [`standart-2026-09-05/`](../history/standart-2026-09-05/) — `kesif/kutuphane-politikasi.json`, `kesif/bagimlilik-envanteri.json`, `olcum/k01-olu-paket-uc-kanal.json` (üç kanal doğrulaması, hükümler, kaldırma sırası, lisans taraması).

---

## 1 · İlke — her ihtiyaç için tek kütüphane

Ölçülen fiilî durum bu disiplini zaten uyguluyor: Electron ikon `lucide-react` **490 dosya** · toast `sonner` **219** · xlsx `exceljs` (dinamik import) · HTTP `axios` **14**, ham `fetch` **0**; mobil toast `react-native-toast-message` **64** · UI `react-native-paper` **132** · liste `@shopify/flash-list` · ikon `@expo/vector-icons`. Disiplin vardı, **kaydı yoktu**.

- **[KU-01]** Bir ihtiyacın karşılığı TEK pakettir: §2 tablosunda o satır doluysa ikinci paket EKLENMEZ, var olan DEĞİŞTİRİLİR (ikisi birden asla) · zorlama: insan:"aynı ihtiyaç" anlamsal bir ölçüdür, AST'den çıkarılamaz (barkod sembolü ↔ font rasteri çift değil, ikon ↔ QR çift) · kanıt: `kesif/kutuphane-politikasi.json` § `ciftPaketler` · devralınan: 4 çift (BLE · vector-icons · qrcode-svg · roboto), hepsi §7'de hükümlü
- **[KU-02]** Yeni paket "yok" gerekçesiyle reddedilmez; ret gerekçesi tabloda hangi paketin o ihtiyacı karşıladığıdır ve reddedilen alternatif de yazılır ("Z KULLANILMAZ çünkü …") · zorlama: insan:kullanıcı kararı — "yeniliklere açığız" · kanıt: `PROMPT.md` §3 K7 · devralınan: yok
- **[KU-03]** Aynı ihtiyacı üç projede üç ayrı paket karşılayabilir; paylaşılan kod doğduğu anda bu bir çarpışmadır ve §9'a kayıt açılır · zorlama: insan:üç ayrı `package.json`, mekanik ortak nokta yok · kanıt: tarih — Electron `date-fns` (17 dosya) ↔ mobil `dayjs` (27); bugün paylaşılan kod yok · devralınan: 1 (tarih)

## 2 · Katman × ihtiyaç tablosu → ayrı dosya

Tablo [`KUTUPHANELER-TABLO.md`](KUTUPHANELER-TABLO.md)'ye taşındı (`docs/standart/KUTUPHANELER-TABLO.md`), **§2 numarasıyla**. Sebep ölçüldü: bu dosya 2026-09-07'de tavana **1 bayt** kalmıştı ve tablo, her yeni bağımlılıkta bir satır alan ENVANTERDİR — kurallar büyümez, envanter büyür.

## 3 · Yeni bağımlılık karar kaydı (6 satır)

Onay şartı kök `CLAUDE.md` § Süreç'te (yeni paket eklemeden önce kullanıcı onayı) — burada tekrarlanmaz. Onay alındıktan sonra §9'a şu altı satır yazılır ve §2'ye satır eklenir:

```
### <paket>@<sürüm> · <proje> · <tarih>
1. Problem      : ne yapıyor, hangi §2 satırını dolduruyor
2. Alternatifler: ≥2 — "elle yazmak" DAHİL; hangisi neden reddedildi
3. Boyut/biçim  : kuruluma katkısı · native mi · ESM-only mi
4. Bakım        : son yayın + sürüm politikası (pin mi caret mi, neden)
5. Lisans       : permissive (MIT/ISC/BSD/Apache-2.0/OFL); çift lisansta seçilen seçenek
6. Dağıtım      : mobilde OTA mı APK mı · Electron'da rebuild gerekiyor mu
```

- **[KU-07]** "Elle yazmak" her kayıtta gerçek bir alternatiftir ve seçilebilir · zorlama: insan:alternatif değerlendirmesi mekanik değil · kanıt: `docs/kurallar/filtre-liste.md:84` — mobil takvim ızgarası elle yazıldı, sıfır bağımlılık · devralınan: yok
- **[KU-08]** Kaydı olmayan bağımlılık üründe kalamaz · zorlama: bekçi:`test_dependency_contract.ts` (negatif sonda: bir paketi tabloya yazmadan ekle → kırmızı → geri al) · kanıt: `k01-olu-paket-uc-kanal.json` § `kaldirmaSirasi[8]` · devralınan: yok
- **[KU-09]** Lisans permissive olacak (MIT/ISC/BSD/Apache-2.0/OFL); copyleft (GPL/LGPL/AGPL/SSPL) GİRMEZ ve istisnası yalnız kullanıcı kararıdır · zorlama: insan:lisans metni `package.json` alanından okunur ama "kabul edilebilir mi" hukuki karardır · kanıt: k01 § `lisans` — üç projede 2.858 paket tarandı, doğrudan bağımlılıklarda copyleft **0** · devralınan: yok
- **[KU-10]** Geçişli tarama da yapılır ve çift lisanslı pakette seçilen permissive seçenek kayda YAZILIR · zorlama: insan:seçim beyandır, dosyadan okunmaz · kanıt: k01 § `lisans` — `jszip` "(MIT OR GPL-3.0-or-later)" → MIT seçilir; `node-forge` "(BSD-3 OR GPL-2.0)" → BSD-3; MPL-2.0/EPL-2.0 5 paket dosya düzeyinde zayıf copyleft, kütüphane olarak kullanım kapalı dağıtımı engellemez · devralınan: yok
- **[KU-11]** Mobilde native modül ya da `app.json` config plugin ekleyen paket **APK ister, OTA yetmez**; kayıt satırı bu cümleyi ve izin etkisini taşır · zorlama: insan:OTA/APK sınırı `mobil/CLAUDE.md`'de, paket bazında mekanik ölçülmez · kanıt: k01 § `react-native-svg`/`expo-sharing` — `android/` dizini ve `expo-module.config.json` autolink kapsamı · devralınan: yok

## 4 · Sürüm politikası

- **[KU-12]** `^` varsayılandır; ESM-only ya da native ABI riski taşıyan paket **TAM SABİT** yazılır (`^`/`~` YOK), gerekçesi koda yorum olarak konur ve bir bekçi pini korur · zorlama: bekçi:`Electron/src/test/discovery-ipc-contract.test.ts:131` + `Teks-Erp/scripts/test_dependency_contract.ts §(a)` (`PIN_KAYDI` × `TAM_SABIT`: iki projede TAM SABİT ve AYNI sürüm) · kanıt: `bonjour-service` 1.4.4 iki projede; gerekçe `Teks-Erp/src/jobs/mdns-advertiser.job.ts:12-17` ve `Electron/electron/discovery/mdns-browser.ts:8` · devralınan: 10 pinli giriş, **8'i gerekçesiz** (k01 § `sabitSurumler`) — baseline
- **[KU-13]** Expo SDK'nın pinlediği sürüm elle değiştirilmez; `expo install` yazımıyla gelir ve gerekçesi "SDK 54 hizası" olarak kayda geçer · zorlama: insan:`expo-doctor` uyarır ama kapı değildir · kanıt: mobil 7 pinli dependency + `overrides.expo-font ~14.0.11` (gerekçesi hiçbir yerde yazılı değil — borç) · devralınan: 8
- **[KU-14]** Ana (major) sürüm yükseltmesi bir **sözleşme değişikliğidir**: ayrı iş olarak açılır, o projenin tam bekçi paketi + tip kontrolü koşar · zorlama: insan:yükseltmenin kendisi kararlıdır, kapı sonuçta koşan pakettir (`TEST-VE-DERLEME.md` §1) · kanıt: k01 § `cjsInvarianti` — bir bağımlılığın ESM-only ana sürüme geçmesi backend'i doğrudan kırar · devralınan: yok

## 5 · Yükleme kalıpları

- **[KU-15]** Çalışma zamanında yüklenen her paket `dependencies`tedir; `devDependencies`e düşen paket kurulu üründe `MODULE_NOT_FOUND` verir · zorlama: bekçi:`discovery-ipc-contract.test.ts:116-127` (`externalizeDepsPlugin` yalnız `dependencies` okur) · kanıt: `prisma` CLI backend'de `dependencies`te çünkü `deploy/kur.ps1` `migrate deploy` koşar ve `npm ci --omit=dev` devDep'i elerdi · devralınan: yok
- **[KU-16]** Electron main'de native modül `createRequire` ile TEMBEL ve try/catch içinde yüklenir; yüklenemezse yol `available:false` ile kapanır, uygulama ÇÖKMEZ · zorlama: insan:"native mi" bilgisi AST'de yok, kalıp gözle korunur · kanıt: `Electron/electron/ipc/printer.ipc.ts:17,40-45` (aynı kalıp `scale.ipc.ts`, `scanner.ipc.ts`, `discovery/mdns-browser.ts:57` — 4 dosya) · devralınan: yok
- **[KU-17]** 200 KB'ı aşan paket statik import edilmez, `await import()` ile ayrı chunk'a alınır · zorlama: insan:boyut eşiği build çıktısından ölçülür, kaynak AST'sinden değil · kanıt: `Electron/src/lib/xlsx-export.ts:39` (`const { default: ExcelJS } = await import("exceljs")`) + `src/lib/import/parse.ts:129` · devralınan: yok
- **[KU-18]** Backend CommonJS'tir: her `dependency` gerçek `require()` ile çözülebilmeli; ESM-only paket backend'e GİRMEZ · zorlama: bekçi:`test_dependency_contract.ts` — `require.resolve` DEĞİL gerçek `require()` denenir, `prisma` beyanlı muaf · kanıt: k01 § `cjsInvarianti` — 19 dependency'nin 18'i çözüldü; `prisma` giriş noktası yayınlamıyor (naif bekçi bugün main'de kırmızı açardı) · devralınan: 1 muaf
- **[KU-19]** `uuid@13` ESM-only'dir ve bugün yalnız Node ≥ 22.12'nin `require(esm)` desteğiyle koşuyor; `engines.node` tabanı bu gerçeği söyleyene kadar yükseltme yapılmaz · zorlama: bekçi:`test_dependency_contract.ts §(b)` YALNIZ `require()` çözümünü ve ESM-only BEYAN kümesini (`ESM_ONLY_BEYAN`) ölçer + insan:`engines.node` tabanı hiçbir kapıda OKUNMUYOR — `">=22"` ile gerçek taban `≥22.12` arasındaki fark bir beyan borcudur (`test_dependency_contract.ts:95` yalnız yorumda anıyor) · kanıt: `Teks-Erp/package.json:5` `"node": ">=22"` ↔ derlenmiş `dist/services/order.service.js:51` `require("uuid")`; Node 22.0–22.11'de üretim kırılır · devralınan: yok — açık iş: `engines` tabanını bekçiye bağlamak

## 6 · Ölü paket teşhisi — üç kanal

⚠️ **`importFiles: 0` TEK BAŞINA KANIT DEĞİLDİR.** Ölçümde 13 CANLI paket sıfır göründü: `exceljs`, `serialport`, `node-hid`, `bonjour-service`, `@fontsource/plus-jakarta-sans`, `prisma`, `expo-build-properties`, `expo-asset`, `jest-expo`, `react-native-screens`, `react-native-worklets`, `@playwright/test`, `@stryker-mutator/*`.

Reçete iki parçadır: önce **üç KANAL** taranır, sonra **iki ADIM** koşar. Kanallar paralel kanıt yüzeyleridir (biri bile doluysa paket CANLI); adımlar sıralıdır ve ancak üç kanal da boş çıkarsa başlar.

**Üç kanal — üçü de taranır:**

- **(a) Dinamik import:** `await import("<paket>")` ara (emsal `xlsx-export.ts:39`).
- **(b) `createRequire` / tembel `require`:** `req("<paket>")`, `require('<paket>')` ara (emsal `printer.ipc.ts:42`, `hal/btClassic.transport.ts:54`).
- **(c) Config referansı:** `app.json > plugins` · `babel/jest/metro/vite/vitest/playwright/stryker` config · CSS `@import` ya da alt yol CSS import'u · `package.json > scripts` içinde CLI · **peerDependency** (`node_modules/<tüketici>/package.json`ından OKUNARAK).

**İki adım — üç kanal da boşsa:**

1. Hüküm ÖLÜ; kaldırmadan önce §7'deki kaldırma etkisi (native mi, OTA mı APK mı) yazılır.
2. Doğrulama o projenin kapısıdır: backend `run-all-tests.ts` + `typecheck` · Electron `typecheck` + `vitest run` + `build` · mobil `npm test` + `npx expo-doctor` (native değiştiyse `expo prebuild --clean` sonrası manifest diff'i).

- **[KU-20]** `importFiles: 0` gördüğünde paketi ölü ilan etme; üç kanal doğrulanmadan silme yapılmaz · zorlama: insan:üç kanal taraması MEKANİK DEĞİL — `test_dependency_contract.ts` üç bölümden oluşur (a pin · b CommonJS `require` · c §2 tablosu ↔ `dependencies` farkı) ve ölü-paket bölümü TAŞIMAZ; hüküm yukarıdaki üç kanal + iki adımlı reçeteyle elle verilir · kanıt: keşif 13 paketten 1'ini yanlış işaretledi — `react-native-ble-plx` CANLI çıktı (`mobil/src/services/bluetooth.service.ts:1` + `app.json` `plugins[1]`) · devralınan: yok
- **[KU-21]** "Peer artığı" iddiası node_modules'ten ÖLÇÜLEREK doğrulanır, varsayılmaz · zorlama: insan:peer grafiği kaynak ağacında değil, kurulu ağaçta yaşar · kanıt: `react-native-paper@5.15.1` `peerDependencies` = {react, react-native, react-native-safe-area-context} — `react-native-vector-icons` İÇİNDE YOK; `mobil/CLAUDE.md:51`'deki "yalnız peer artığı" cümlesi ölçümle yanlış · devralınan: yok
- **[KU-22]** Bir paketle "birlikte ölür" sanılan yardımcı AYRI ölçülür · zorlama: insan:bağımlılık gerekçesi yorumda yaşar, grafikte değil · kanıt: `buffer` — `Electron/src/main.tsx:13-15` polyfill'i `@react-pdf/renderer`e bağlıyor ama `exceljs`in tarayıcı bundle'ı da `Buffer`a referans veriyor (4 eşleşme) → hüküm BELİRSİZ, paket KALIR · devralınan: yok
- **[KU-23]** Paket kaldırılırken onu adıyla anan HER bayat referans aynı commit'te temizlenir: `CLAUDE.md` paket listesi · `knip.json > ignoreDependencies` · `jest.config.js > transformIgnorePatterns` · `package.json > scripts` · gerekçe yorumu · zorlama: insan:bayat referansın kendisi derlemeyi kırmaz, sessiz kalır · kanıt: k01 § `kaldirmaEtkisi` — `react-native-svg` (jest config), `react-native-web` (`"web"` script'i), `@faker-js/faker` (knip susturması) · devralınan: yok

## 7 · Kaldırma turu — hüküm tablosu arşivde

Hüküm tablosunun kendisi (16 satır, `Durum` sütunu **2026-09-05 ölçüm anındadır**) arşive taşındı: `docs/history/standart-2026-09-05/olu-paket-hukum-tablosu.md`. Gerekçe: donmuş bir turun durum tablosu kural değil HİKÂYEDİR (`README.md` § üç belge katmanı) ve bu dosya boyut tavanına 1 bayt kalmıştı — tavan YÜKSELTİLMEDİ. Kaldırma sırası ve doğrulama komutları: `k01-olu-paket-uc-kanal.json` § `kaldirmaSirasi`.

Turdan kalan İKİ KURAL burada durur:

- **[KU-24]** Native paket kaldırmak mobilde bir APK turudur; OTA ile gitmez ve `expo prebuild --clean` sonrası `AndroidManifest.xml` diff'i, kalan canlı paketlerin izinlerini düşürmediği doğrulanarak kapanır · zorlama: insan:izin diff'i yapı çıktısında ölçülür, kaynakta değil · kanıt: k01 `kaldirmaSirasi[6]` — `react-native-bluetooth-classic` (CANLI) hâlâ BLUETOOTH_CONNECT/SCAN istiyor · devralınan: yok
- **[KU-25]** Kaldırma öncesi üç projede YEŞİL taban ölçülür; kırmızı zeminde kaldırma yapılmaz (kaldırmanın kırdığı ile devralınan kırmızı karışır) · zorlama: insan:sıralama disiplini · kanıt: k01 `kaldirmaSirasi[0]` · devralınan: yok

## 8 · Açık kararlar — bu turda kapatılmadı, kayda geçiyor

| Konu | Ölçüm | Neden ertelendi |
|---|---|---|
| **Araç zinciri drift** | TypeScript üç ana sürüm: backend 6.0.2 · Electron 5.6.3 (`~`, bilinçli tilde) · mobil 5.9.3 (SDK); ESLint iki ana sürüm: 10.2.1 / 9.39.4 / 9.39.4 | Hizalama üç projede eşzamanlı lint+tip kırılması demek; Electron'un tilde gerekçesi bugün YAZILI DEĞİL, önce o yazılmalı |
| **mobilde şema doğrulama katmanı yok** | `zod` bağımlılığı YOK; 386 dosyada 0 `z.object` | Tasarım kaydı (`ESZAMANLILIK-ENVANTER.md` §6 bilinen boşluklar); yeni bağımlılık + istemci sözleşmesi turu |
| **`uuid` ↔ `crypto.randomUUID` ikiliği** | backend `uuid` 2 dosya (v4 + `validate`), `randomUUID` 20 dosya | `validate`in yerleşik karşılığı yok → paket meşru; v4 kullanımı taşınabilir, ESM-only riski ([KU-19]) bunu ödüllendirir |

> **KAPANDI (2026-09-07):** backend logger → §9 (`src/lib/logger.ts`, paket eklenmedi).

Ayrıca kayıtta duran iki küçük borç: OFL-1.1 font lisans metninin dağıtım paketine girip girmediği KONTROL EDİLMEDİ (k01 § `lisans`); mobil `overrides.expo-font` pininin gerekçesi hiçbir yerde yazılı değil ([KU-13] kanıtı).

## 9 · Kayıt defteri

Yeni **paket** eklenmedi. Bir karar var ve sonucu da "paket YOK"tur:
**backend log kanalı** (2026-09-07) — `pino`/`winston` yerine **elle yazmak**
seçildi ([KU-07]), çünkü taşımayı pm2 ve rotasyonu `pm2-logrotate` zaten
yapıyordu; kalan tek eksik seviye + alan etiketiydi. Altı satırlık kayıt, ölçüm
ve sonuç arşivde: `docs/history/CLAUDE-NOT-ARSIVI.md` (2026-09-07) ve
`Teks-Erp/src/lib/logger.ts` başlığı. Yeni paket eklenince §3'teki blok buraya,
§2'ye bir satır yazılır.
