# Mobil Uzaktan Güncelleme — Kurulum ve Kullanım Reçetesi

**Durum:** 2026-08-27 — **yayın sunucusu KURULDU ve doğrulandı**; sahadaki tabletlere
2026-09-04'te elden kuruldu (APK 1.0.0-vc57); sonraki JS turları OTA ile gider.

Yayında olan (2026-09-05 ölçümü — sayıyı sabitleme, kanonik `mobil/app.json` + yayındaki `apk/surum.json`): kurulum dosyası **1.0.6 / vc57** (arm64,
49,6 MB). İstemcinin yaptığı iş birebir taklit edilerek ölçüldü: manifest 200 + doğru
başlıklar, imza APK'ya gömülü sertifikayla **geçerli**, 43 varlığın 43'ü hash uyumlu indi.

Tabletler güncellemeyi **internetten**, masaüstü panelinin kullandığı sunucudan alır
(`guncelleme.etkiliyazilim.com`). ERP bağlantısı değişmedi: üretim kayıtları fabrika
ağındaki sunucuya gider. **İki ayrı kanal, ikisi de kendi tek kaynağından.**

| Katman | Ne gönderilir | Operatör ne yapar | Sıklık |
|---|---|---|---|
| **Uzaktan güncelleme (OTA)** | JS paketi + görseller | Hiçbir şey | Değişikliklerin ~%90'ı |
| **Kurulum dosyası (APK)** | Tam uygulama (~49 MB, arm64) | "İndir ve kur" → "Yükle" | Yılda birkaç kez |

Ayıran çizgi **`runtimeVersion`**: yeni native modül / izin / Expo yükseltmesi uzaktan
gönderilemez.

---

## 1. Kanalın üç kuralı

**① Manifest yayın anında DONDURULUR ve İMZALANIR.** `expo-updates` imzayı gövdenin ham
baytları üzerinden doğrular; sunucu manifest'i yeniden üretseydi baytlar değişir ve tablet
paketi reddederdi. Üreten tek yer `mobil/scripts/lib/manifest.mjs`; sunucu (nginx ya da
LAN ikizi backend) yalnız bayt servis eder.

**② Adres `runtimeVersion` içerir** (`/adnansahin/mobil/ota/54.2/manifest`). Sebep ölçüldü: istemci
indirme aşamasında runtimeVersion'ı **doğrulamıyor** — yanlış sürüm gelirse indirir, eler
ve **sessizce** eski sürümle açılır. Sürüm adreste olunca her APK yalnız kendi paketini
görebilir.

**③ Özel anahtar VPS'te DEĞİL.** `mobil/keystore/ota-keys/` (git dışı). Sunucuya sızan biri
paket değiştiremez, çünkü imzayı üretemez. **Her kanalın anahtarı AYRIDIR**
(`ota-keys[-<kanal>]/` ↔ `ota-certs[-<kanal>]/`): yanlış klasöre yüklenen bir paketi o kanalın
tabletleri kriptografik olarak REDDEDER; yayın betiği imzanın diğer kanalların sertifikalarıyla
reddedildiğini de ölçer.

---

## 2. Sunucu tarafı (bir kez)

Bkz. **`deploy/guncelleme-sunucusu/README.md`** — klasör açma + nginx kuralları (`deploy/guncelleme-sunucusu/nginx/default.conf`).
Electron ile **aynı konteyner**, aynı standart: yol düzeni `/<musteri>/<urun>/`.

⚠️ **Cloudflare proxy'si (turuncu bulut) AÇIK kalmalı** — Origin CA sertifikasına yalnız CF
Edge güvenir; DNS-only'ye çevrilirse Android sertifikayı reddeder ve güncelleme **sessizce**
durur.

---

## 3. Uzaktan güncelleme yayınlamak

> **Yayın belirteci (3c'):** `deploy/mobil-yayinla.mjs` kenar doğrulamasını yalnız satıcı yayın
> belirteciyle yapar (`~/.tekserp/yayin-belirteci`, tek satır, `chmod 600`; başlık `X-TKL-Indirme`);
> dosya yoksa yüklemeden ÖNCE durur, anonim okumaya düşmez (`--kuru` istemez). "Ne yayında"
> (terfi şartı, etiket defteri) VDS diskinden SSH ile okunur. Envanter ve kurulum:
> `docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md` § 3b.

```bash
cd mobil
npm run yayinla -- --musteri=<kanal>            # ERP adresi kanal kaydından (deploy/kanallar.json)
node ../deploy/mobil-yayinla.mjs --musteri=<kanal> --paket=ota-cikti/<kanal>/<rv>/<damga>
```

`npm run yayinla` sırasıyla: kanalı kayıt defterinde çözer, ERP adresini kanaldan alır
(açık verilen adres kanalınkiyle EŞİT olmalı) → **sürüm numarasını belirler** →
**native parmak izini** önceki yayınla karşılaştırır → Metro önbelleğini siler →
`expo export` → **üretilen bundle'ın içindeki ERP adresini geri okur** → manifest'i
dondurur, **imzalar** ve imzayı **sertifikayla doğrular**. Herhangi biri düşerse paket
üretilmez.

### 3.1 Sürüm numarası — uzaktan güncelleme de artık numara alır

Uzaktan güncelleme uzun süre sürüm numarasına **hiç dokunmuyordu**: tablette haftalarca
"1.0.0" yazarken içindeki JS bambaşka olabiliyordu. Ayrım görünmezdi — sahada "hangi
sürümdesin" sorusunun cevabı yoktu ve sürüm notları tek numaraya yığılıyordu.

Artık `app.json > expo.version` her yayın turunda **yama hanesinden** artar
(`1.0.0 → 1.0.1 → 1.0.2`). Numara **APK'dan değil PAKETTEN** okunuyor
(`kuruluVersionName()` → `Constants.expoConfig.version` → manifestin `extra.expoClient`i),
yani native tarafa dokunmadan tablette görünen sürüm değişir.

```bash
# ⚠️ ADRES HER SATIRDA: script'in varsayılanı YOKTUR (yukarıdaki gerekçe).
EXPO_PUBLIC_API_URL=<erp> npm run yayinla -- --musteri=adnansahin                 # otomatik: 1.0.1
EXPO_PUBLIC_API_URL=<erp> npm run yayinla -- --musteri=adnansahin --surum=1.2.0   # haneyi elle ver
EXPO_PUBLIC_API_URL=<erp> npm run yayinla -- --musteri=adnansahin --surum-artirma # hiç dokunma
```

**Taban git etiketidir** (`tablet-v*`), yerel `app.json` ya da yayın sunucusu değil —
gerekçe Electron reçetesindekiyle aynı ve tek kaynakta: `scripts/lib/surum.mjs` başlığı.
Etiketi `deploy/mobil-yayinla.mjs` yayın bittikten sonra atar. **OTA ve APK aynı
çizgidedir**: `expo.version` hem paketin sürümü hem APK'nın `versionName`idir.

⚠️ **`--check` yan etkisizdir** — hedef sürümü gösterir ama `app.json`a yazmaz. Yalnız
bakmak için koşan biri sürümü sessizce ilerletmemeli.

⚠️ **OTA turunda `android.versionCode`a DOKUNULMAZ.** Paket bu değeri de taşır ve tablet
onu **kurulu APK'nın** sürümü sanar (`kuruluVersionCode()` → `Constants.expoConfig
.android.versionCode`). Uzaktan yükseltilirse tablet kendini olmadığı bir APK sürümünde
sanar ve gerçek kurulum dosyası güncellemesini **bir daha teklif etmez** — sessiz ve
kalıcı bir arıza. Yayın script'i yayındaki `apk/surum.json` künyesiyle kıyaslar ve
farklıysa durur. Gerçekten yeni bir APK çıkıyorsa **önce APK yayınlanır**, sonra OTA.

Bekçi: `scripts/test_surum.mjs` (18 kontrol; §3 gerçek git etiketleri üzerinde, geçici
bir depoda — bu deponun etiketlerine dokunmadan).

`mobil-yayinla.mjs` yükler: **önce paket dosyaları, sonra manifest** (ters sırada, henüz
yüklenmemiş varlıkları gösteren bir yayın ortaya çıkar). Son adım **dışarıdan HTTPS
doğrulaması** ve bu doğrulama üç arızayı BİRBİRİNDEN AYIRIR — tespit etmek yetmez, çünkü
ikisi dışarıdan aynı görünür ama çözümleri farklıdır:

| Belirti | Gerçek sebep | Çözüm |
|---|---|---|
| temiz URL hata, `?onbellek-atla=` ile 200 | Cloudflare eski yanıtı tutuyor | **Purge by URL** (yeniden yükleme ÇÖZMEZ) |
| ikisi de hata | Dosya gerçekten yüklenmemiş | Yükleme adımını tekrarla |
| 200 ama boyut yerel dosyayla uyuşmuyor | **Yarım yüklenmiş** dosya | Yükleme adımını tekrarla |

Ayrıca protokol başlıkları (`expo-protocol-version`, `Content-Type` sınırlayıcısı)
kıyaslanır; kod ve boyut doğruyken yalnız BAŞLIK bayat kalmışsa uyarı basılır (ölçüldü:
APK'nın içerik tipi bir kez böyle takıldı).

Yükleme yapmadan mevcut yayını denetlemek için:

```bash
node deploy/mobil-yayinla.mjs --dogrula=<url> [--boyut=<bayt>]
```

Tabletler paketi bir sonraki açılışta — ya da uygulama ön plana dönünce (en çok 10 dakikada
bir sorar) — alır ve **kendini yeniler**. Tek istisna: **gönderilmemiş kayıt varken
yenilemez** (en çok 20 sn bekler; tavan dolarsa bir sonraki açılışa kalır).

### Geri alma

```bash
ssh tekserp-yayin \
  "cd /opt/stack/apps/tekserp-guncelleme/html/adnansahin/mobil/ota/<rv> && cp manifest-<eski damga> manifest"
```

Dosya silinmez. Ayrıca uygulama açılışta çökerse `expo-updates` kendiliğinden bir önceki
çalışan pakete döner — bu ikinci hat, birincisi değil.

---

## 4. Kurulum dosyası (APK) yayınlamak

Yalnız native değişiklikte. `runtimeVersion` **artırılmış** olmalı (yayın script'i unutulursa durur).

```bash
cd mobil
TEKSERP_KANAL=<kanal> npx expo prebuild --platform android --clean --no-install
npm run build:apk -- --musteri=<kanal>
node ../deploy/mobil-yayinla.mjs --musteri=<kanal> --apk=android/app/build/outputs/apk/release/app-release.apk \
     --surum=<sürüm> --vc=<versionCode> --anahtar=<istemci yayın anahtarı dosyası>   # parola TTY'den
```

> **İmzalı künye (2026-10-01, G6):** `apk/surum.json` imzalı künye taşımadan YÜKLENMEZ; tablet indirdiği APK'yı
> bu künyeyle doğrulamadan kurmaz. Ayrıntı: §4d.

`build:apk` APK'nın KENDİ kimliğini derlemeden sonra okur (ikili AndroidManifest: paket adı ·
güncelleme adresi · OTA sertifikası; `assets/app.config`: çalışma anı yapılandırması) ve hedef
kanalınki değilse paketi `…DOGRULANMADI.apk` adıyla kenara koyup durur; `mobil-yayinla --apk`
paket adı hedef kanalınki değilse yüklemeden önce durur (kanalların APK mührü ortaktır — aynı
paket adlı başka kanal APK'sı üstüne SESSİZCE kurulurdu).

Tablette: Ayarlar → Güncelleme → **İndir ve kur** → **Yükle**. Her tablette **bir kez**
"bu kaynaktan kuruluma izin ver" onayı gerekir.

⚠️ **APK yalnız arm64 taşır** (113 MB → 49 MB). Sahadaki cihazların mimarisi kurulumdan
önce doğrulanmalı: `adb shell getprop ro.product.cpu.abi`.

---

## 4d. İmzalı APK künyesi — tablet güncellemesinin bütünlüğü (2026-10-01, G6)

**Neden:** `apk/surum.json` imzasızdı; tablet `indirmeUrl`i koşulsuz izliyor (indirme belirtecini de oraya
gönderiyor), `sha256`yı hiç ölçmüyordu. Güncelleme sunucusuna yazabilen biri (yayın hesabı, VDS, yanlış `--feed`)
sahadaki tabletlere güvenilir güncelleme ekranından keyfi APK kurdurabilirdi; farklı paket adlı APK Android'in
mühür denetimine de takılmaz. OTA paketleri zaten kanalın RSA anahtarıyla imzalı; APK zinciri artık aynı tehdide
kapalı.

**Biçim:** `surum.json`a panelin `latest.yml` bloğuyla aynı kalıpta blok — eski tablet bilmediği alanı yok sayar:

```json
"tekserp": { "v": 1, "bildirim": "<JWS — alg EdDSA, typ tekserp-apk, kid çapadan>" }
```

Yük (v:1): `urun: tablet` · `platform: android-arm64` · `kanal` · `versionCode` · `versionName` · `commit` ·
`yayinZamani` · `paket {ad, boyut, sha256}` (`ad` = `TeksERP-<versionName>-vc<versionCode>.apk`, yol taşımaz) ·
`capa`. `typ` protokolün `TYP.APK` kaydıdır; JWS kuralları panel/lisans aynası. Kod: yayın tarafı
`mobil/scripts/lib/apk-kunye.mjs` (node:crypto), tablet `mobil/src/services/apkKunye.ts` + `mobil/src/lib/kripto/`
(Hermes'te node:crypto yok → denetlenmiş saf JS `@noble/curves` + `@noble/hashes` sarmalayıcısı — aşağıda "kripto").

**Tablet ne yapar (fail-closed):** ① künyeyi okurken yeni sürüm sunuluyorsa (versionCode > kurulu) künye
doğrulanır: çapa · imza · typ · kid · kanal (tabletin GÖMÜLÜ güncelleme adresinden; değiştirilemez) ·
`surum.json`un eski tabletin okuduğu alanları (versionCode · versionName · dosya · sha256 · boyut) künyeyle birebir.
Geçmezse "yeni sürüm" SAYILMAZ, Ayarlar → Güncelleme'de ve sürüm kilidi şeridinde TR uyarı, log'a
`[apk] güncelleme künyesi REDDEDİLDİ kod=…`. ② indirme adresi künyedeki `indirmeUrl`den DEĞİL gömülü kanal kökü +
imzalı dosya adından türer (belirteç yalnız kanal sunucusuna gider). ③ inen dosya 256 KB parçalarla okunup boy +
sha256 ölçülür ("Doğrulanıyor… %"); tutmazsa dosya silinir, Android kurulum ekranı AÇILMAZ. Kurulum hâlâ
operatörün "Yükle" dokunuşudur.

**Çapa:** `mobil/src/lib/apk-imza-capasi.json` — JS paketine girer (OTA kod imzasıyla korunur, OTA ile değişebilir).
Satır yalnız `cd Teks-Erp && npx tsx scripts/guven-capasi-ekle.ts tablet …` ile girer (KURU; sonra `--yaz`).
Anahtar kararı panelle ORTAKTIR (aynı kid ailesi `paket-<yıl>` / `panel-<yıl>`):
- (a) `guven-capasi-ekle.ts tablet --paket-kid=paket-2026 --yaz`
- (b) `guven-capasi-ekle.ts tablet --dosya=~/.tekserp/panel-uretim/panel-2026.panel.json --yaz` (anahtar panel
  töreninde üretilen dosya; `panel-imza.ts anahtar-uret`).

Boş çapa: tablet hiçbir APK künyesini doğrulayamaz → APK güncellemesi DURUR (OTA kanalı ayrıdır, etkilenmez).
Bu yüzden yayın kapısı boş çapada **APK yayınını durdurur, OTA yayınını UYARIR** (panelden farkı: panelin
çapasını getirecek ikinci bir kanal yok, tabletinkini OTA getirir).

**Yayın (`deploy/mobil-yayinla.mjs`):**
- APK: paket adı · güncelleme adresi · ERP adresi · **gömülü OTA sertifikası kanalınki mi** (DAGY-6, `build-apk`
  ile aynı yüklem; kanal sertifikası okunamazsa ÖLÇÜLEMEDİ = DUR) · **tablet çapası** (boş/bozuk → DUR; APK'nın JS
  paketi çapayı taşımıyorsa bayat → DUR) → sürüm notu → terfi → künye: yanındaki `surum.json` BU APK'nın geçerli
  imzalı bloğunu taşıyorsa korunur, yoksa imza aracı çağrılır (`Teks-Erp/scripts/panel-imza.ts apk-imzala`; anahtar
  `--anahtar=` ya da `TEKSERP_TABLET_IMZA_ANAHTARI`, parola TTY'den) ve sonuç yeniden doğrulanır; imzasız/geçersiz
  künye YÜKLENMEZ → **rotasyon kilidi** (ssh ile yayındaki `surum.json`: künyeliyse yeni imzalayan onun `capa`sında
  olmalı; künyesizse ilk imzalı APK normal gelir) → yükleme (APK önce, künye EN SON) → kenardaki `surum.json`
  yerel imzalı dosyayla bayt-eşit.
- OTA: `yayin.json` `imzali: false` → DUR (eskiden uyarı; her kanalın APK'sı sertifika taşır, imzasız paketi
  tabletler zaten reddeder) · tablet çapası biçimsiz → DUR · boş → UYARI · paket ağacın çapasını taşımıyor → DUR.
- `--kuru` imzalamaz ve ağa çıkmaz: imzasız künyeyi not eder, rotasyonu ölçmez.
- Elle kontrol: `cd Teks-Erp && npx tsx scripts/panel-imza.ts apk-dogrula --musteri=<kanal> --apk=<apk> --kunye=<surum.json>`.

**Rotasyon:** yeni kid ÖNCE çapaya eklenir → OTA ile sahaya çıkar ve ESKİ anahtarla imzalı bir APK yayınlanır
(künyenin `capa`sı yeni kid'i taşır); ancak sonra yeni anahtarla imzalanır (kapı aksi hâlde durur).

**Geçiş sırası — "eski tablet ne yapar":**
1. Anahtar kararı + tablet çapası satırı (panelle aynı karar; çapa boşken APK yayını durur).
2. **OTA ile yeter, yeni APK GEREKMEZ:** doğrulayıcı saf JS'tir; parça parça okuma `expo-file-system` 19'un
   yeni API'si (`File.open().readBytes`) — native yarısı aynı paketin ikinci modülü, OTA destekli her APK'da
   (2026-08-27'den beri) var; kripto saf JS `@noble/*`. Çapalı OTA önce testfabrika, sonra terfi — bu İLK OTA
   `--parmak-izini-kabul-et` ister (yukarıda "Kripto": depo parmak izi bağımlılık listesini sayar, native değişmedi).
3. **Eski tablet (G6 öncesi JS)** blok'u yok sayar, `indirmeUrl` ile BUGÜNKÜ GİBİ indirir — bu yüzden yayın aracı
   `indirmeUrl`i ve diğer imzasız alanları yazmaya devam eder (imzalı künyeyle birebir olmaları kapıda ölçülür).
4. **Yeni tablet** künyesiz/geçersiz `surum.json`daki yeni sürümü REDDEDER (TR uyarı); sahada imzasız bir yayın
   duruyorsa ve sürümü kuruludan yeni değilse hiçbir şey görünmez.
5. Backend sözleşmesi değişmedi (`minVersion` yükselmez).

**Sorun giderme (kod → anlam):** `KUNYE_YOK` imzasız yayın · `JWS_KID` çapada olmayan anahtar (rotasyon hatası
ya da sahte) · `JWS_IMZA`/`JWS_*` bozuk/sahte imza · `KUNYE_KANAL` başka kanalın künyesi · `KUNYE_DOSYA`
`surum.json` alanları künyeyle uyuşmuyor · `BELGE_*` biçim · `DOSYA_OZETI` inen dosya künyede yazan değil (silindi) ·
`DOSYA_OKUNAMADI` · `CAPA_BOS`/`CAPA_GECERSIZ` çapasız JS. Hepsinde tablet eski sürümde çalışır.

**Kripto (kullanıcı onayı 2026-10-01):** `@noble/curves` 2.4.0 (Ed25519) + `@noble/hashes` 2.4.0 (SHA-256/512) —
denetlenmiş saf JS, TAM SABİT (ESM-only; `test_dependency_contract §(a)`), yalnız `src/lib/kripto/` sarmalar.
Kip bizim seçimimiz: RFC 8032 katı kip (`zip215: false` — kanonik A/R, S < L, küçük mertebeli A RED) + küçük
mertebeli R reddi; kâhinler RFC 8032 + Wycheproof EdDSA 151 vektör + node:crypto rastgele/bozulma (gevşek ZIP-215
kipi kırmızı verir). Gerçek Hermes VM'inde (RN 0.81 `sdks/hermesc/osx-bin/hermes`, Metro'nun babel ön ayarıyla
dönüştürülmüş paket) ölçüldü: Wycheproof 151 / node bozulma 40 fark 0, yayın aracının imzaladığı künye KABUL,
kurcalanmış RED; Ed25519 doğrulaması ≈ 13 ms; SHA-256 ≈ 2,1 MB/s (Mac) ⇒ 49 MB APK Mac'te ≈ 23 sn, tablette daha
uzun ("Doğrulanıyor… %" görünür; sahada testfabrika'da ölçülecek). Native modül YOK (autolinking listesinde yok,
`android/`/`expo-module.config.json`/kurulum betiği yok; `expo export` Hermes bayt koduna derlendi) ⇒ OTA ile
gider. ⚠️ Depo parmak izi (`yayinla-ota.mjs` alg 2) `dependencies` listesini saydığı için bu paketleri taşıyan İLK
OTA "NATIVE DEĞİŞTİ" der: runtimeVersion ARTIRILMAZ, `npm run yayinla -- --musteri=<kod> --parmak-izini-kabul-et`
ile bilinçli geçilir (gerekçe: yalnız saf JS paket eklendi; kanıt yukarıda). İniş sonrası ana ağaçta
`cd mobil && npm ci` (iki yeni paket).

---

## 4b. Birden fazla kanal (fabrika · hazırlık)

Yol düzeni `/<kanal>/<urun>/`. Yeni kanal = sunucuda klasör açmak (`html/<kod>/mobil/{ota,apk}`)
+ `deploy/kanallar.json`a kayıt (bekçi `scripts/check-kanallar.mjs`); DNS/sertifika/servis işi YOK.

Kanalın BÜTÜN kimliği tek kaynakta: `deploy/kanallar.json` (paket adı · görünen ad · ERP adresi ·
OTA sertifikası · görünür etiket; güncelleme adresleri koddan türer). Derleme ve yayın komutları
`--musteri` **zorunlu** alır ve kimliği argümandan çözer; `mobil/musteri.json` yalnız DİNLENME
işaretçisidir (varsayılan kanal). Derleme betikleri çocuk süreçlere `TEKSERP_KANAL=<kod>` geçirir,
`app.config.js` kimliği kayıttan uygular — `app.json` bir kanal için **yazılmaz** (native parmak
izinin girdisidir; elle çevirmek sahte "NATIVE DEĞİŞTİ" üretir ve OTA betiği durur).

> ⚠️ **Beklenen değer neden komuttan alınıyor:** beklenen değeri gerçek değerle AYNI kaynaktan
> alan bir kapı, o kaynağın yanlış olmasını yakalayamaz. Ağaçtaki işaretçi yanlışsa hem
> `app.config.js` hem kapı aynı yanlışı söylerdi.

Dört yerde kapı var: derleme öncesi (argüman kayıtlı mı, ERP adresi kanalın mı, `android/` bu
kanalla mı üretilmiş), derleme sonrası (APK'nın kendi kimliği), paket üretimi (yapılandırma +
imza kanalın, çıktı kanala ayrı klasörde), yayın (APK paket adı · manifestteki varlık adresleri ·
bundle'daki ERP adresi ↔ `--musteri`). Sonuncusu künyeye DEĞİL artefakta bakar.

Hazırlık kanalı (`testfabrika`) tabletin durum çubuğu şeridinde **"TEST FABRİKA"** gösterir
(kayıttaki `gorunurEtiket`; üretim kanalında alan hiç doğmaz). Test sürücüsü:
`node scripts/surucu/guzergah.mjs --kanal=testfabrika …` (paket adı kayıttan).

---

## 4c. Sürüm kapısı (backend "hangi tableti bekliyor")

Backend deploy'u ÖNCE gittiği için sahada bir süre eski tabletler çalışır; bazı
sözleşme değişiklikleri onlarda **görünür hata üretmez, alan sessizce düşer**.
Politika bunu kapatır: `GET /api/client-policy/mobil` → `{minVersion, minPaketTarihi}`.

**⚠️ Mobilde İKİ sürüm ekseni var** (masaüstünde yok): APK sürümü yalnız kurulum
dosyası değişince artar, ama JS düzeltmesi uzaktan gider ve `versionName`i
**değiştirmez**. "2.9.9 görünen" bir tabletin JS'i haftalarca eski olabilir. Bu yüzden
politika iki eksenlidir; `minPaketTarihi` uzak paketin yayın damgasıyla kıyaslanır.

**Kilit KOŞULLUDUR** (Electron'dan bilinçli fark): tablet yalnız düzeltme **gerçekten
kurulabilir** durumdaysa ve **gönderilmemiş kayıt yokken** kilitlenir. Aksi halde
kalıcı şerit gösterilir. Gerekçe: interneti kopuk bir tableti kilitlemek,
güncellemeyi indiremediği için **çıkışı olmayan** bir üretim durmasıdır — üstelik
cihaz çevrimdışı yazabiliyor.

⚠️ **Politika kendiliğinden müşteriye özeldir**: her fabrikanın kendi backend'i onu
servis eder. Yayın kanalı (VPS) ile politika ayrı eksenlerdir.

⚠️ **Sıra:** `minVersion`/`minPaketTarihi` yükseltmeden ÖNCE onu karşılayan paketi
yayınla. Tersi, tabletleri indirecek bir şey olmadan kilitler.

---

## 5. İki anahtar, ikisi de KAYBEDİLEMEZ

| Anahtar | Yer | Kaybının bedeli |
|---|---|---|
| **Mühür** (APK imzası) | `mobil/keystore/tekserp-release.keystore` + `.properties` | Her tablette uygulama **silinip yeniden kurulur** |
| **Kod imzalama** (paket imzası) — kanal başına | `mobil/keystore/ota-keys/private-key.pem` (adnansahin) · `mobil/keystore/ota-keys-testfabrika/private-key.pem` (testfabrika) | O kanalın uzaktan güncellemesi durur; yeni sertifikayla **yeni APK** gerekir |

İkisi de `keystore/` altında ve git dışında. **Yedekleri şifreleriyle birlikte repo dışında
saklanmalı.** İmza `plugins/withReleaseKeystore.js` ile her prebuild'de yeniden yazılır
(elle düzenleme bir sonraki prebuild'de sessizce kaybolurdu) ve `build:apk` üretilen APK'nın
parmak izini mühürle karşılaştırır.

---

## 6. Sahada "hangi sürüm var"

Tablette **Ayarlar → Güncelleme**: uygulama sürümü, uzak paket etiketi
(`#a1b2c3d4 · 26.08 14:10`), native sürüm ve **iki bağlantı ayrı ayrı** (ERP: fabrika ağı ·
Güncelleme: internet). İkisinin farklı olması normaldir; ekran bunu uyarı olarak basmaz.

---

## 7. Bekçiler

| Bekçi | Ne ölçer |
|---|---|
| `Teks-Erp/scripts/test_mobile_update.ts` | Donmuş manifest baytları BOZULMADAN servis ediliyor mu · imza sertifikayla doğrulanıyor mu · protokol başlıkları · yol kaçışı · geri alma · **backend ↔ mobil ↔ nginx sınırlayıcı tutarlılığı** (37 kontrol) |
| `mobil/src/test/update-feed-url.test.ts` | Feed adresi tek kaynak · `enabled` açık · sertifika dosyası gerçekten var · ERP adresinden bağımsızlık (7 kontrol) |
| `mobil/src/services/appUpdate.service.test.ts` | Yenileme kapısı (bekleyen kayıt) + sürüm karşılaştırması (8 kontrol) |
| `mobil/src/lib/kripto/kripto.test.ts` | `@noble/*` sarmalayıcısının kâhini: SHA-256/512 + Ed25519 (RFC 8032 · Wycheproof 151 vektör · node:crypto) + katı kip |
| `mobil/src/services/apkKunye.test.ts` | APK künyesi doğrulayıcısı + yayın aracıyla çapraz kâhin |
| `mobil/src/services/appUpdate.apk.test.ts` | Akış: imzasız/başka kanal künyesi "yeni sürüm" sayılmaz · indirme gömülü kökten · özeti tutmayan dosya silinir, kurulum ekranı açılmaz |
| `Teks-Erp/scripts/test_panel_imza.ts` §3h–k · §4 | `guven-capasi-ekle.ts tablet` · `panel-imza.ts apk-imzala/apk-dogrula` uçtan uca |
| `scripts/test_kanal_yayin_kapisi.mjs` §3G6 | Yayın kapıları: imzasız OTA · OTA sertifikası · tablet çapası · imzasız künye · rotasyon · yükleme sırası |
| `mobil/scripts/build-apk.mjs` | Manifest'te feed adresi + runtimeVersion + **kod imzalama sertifikası** · APK'nın mührü |
| `mobil/scripts/yayinla-ota.mjs` | Bundle'daki ERP adresi · native parmak izi ↔ runtimeVersion · imzanın sertifikayla doğrulanması |

Hepsi negatif sondayla kırmızı verdiği ölçülerek yazıldı.

---

## 8. Bilinen kabuller

- **Paket herkese açıktır** — adresi bilen JS bundle'ı indirebilir (Electron'daki
  `Setup.exe` ile aynı durum). Bundle fabrika LAN adresini taşır, sır değil. Kod imzalama
  paketin *değiştirilmesine* karşı korur, *okunmasına* karşı değil.
- **Sessiz kurulum yok** — uygulama paket kuramaz, yalnız kurulum ekranını açar. Tamamen
  dokunmasız kurulum ancak cihaz yönetimi (MDM) ile mümkün; 6-15 cihaz için ölçülüp elendi.
- **Google'ın sideload doğrulaması** (2027'de küresel) yalnız **kurulum dosyasını** etkiler;
  uzaktan güncelleme kapsam dışıdır. Türkiye ilk dalgada değil.
- **Fabrika sunucusundaki LAN ikizi** (`/api/mobile/updates/…`) kod olarak durur ve
  bekçilidir; internetsiz bir kurulum için yayın `--update-url=http://<sunucu>:4000/api/mobile/updates/`
  ile yapılır. Bu fabrikada kullanılmaz.
