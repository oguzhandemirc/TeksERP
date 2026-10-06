# İstemci imza anahtarları kökün altında — panel ve tablet güncellemeleri için süreli sertifika

> **Durum:** TASARIM (2026-10-06). Kod yok; kodlama §7'deki dilimlerle, dilim başına bir ajan. Kararlar §8'de, kullanıcıya sorulacak.
> **Bağlayıcı kararlar:** kullanıcı 2026-10-06 — panel/tablet imza anahtarları 3.9'daki düzene AYRI işte alınır ([PAKET-ANAHTARI-KOK-ALTINDA.md](PAKET-ANAHTARI-KOK-ALTINDA.md) §8 soru 7); bütün anahtar yenilemeleri YILDA BİR dönem töreninde toplanır (ara imzacı/ALT/İND 395 gün, paket 1 yıl + 1 ay, §8 soru 8); adnansahin dondurulmuştur (panel 1.3.7 · tablet OTA 1.0.12) ve onun bugünkü anahtarlarıyla doğrulanan eski güncelleme yolu bozulmaz — yeni düzen YALNIZ yeni ortak uygulamada.
> **Birleştiği iş:** tek ortak paket (iş listesi 3.1, `TEK-ORTAK-PAKET.md` — bugün dal `gece/ortak-paket-o13b`'de, `main`de değil) §10 **K-2** ("ortak tablet yeni `runtimeVersion` 55.0 ve yeni bir güncelleme imza anahtarıyla başlar") ve dilimleri O5–O8 · O10a–b. Bu belge K-2'nin "yeni güncelleme imza anahtarı"nın NE olduğunu tanımlar.
> **Komşu belgeler:** kurallar [lisans.md](../kurallar/lisans.md) · [surum-yayin.md](../kurallar/surum-yayin.md) · runbook [ELECTRON-OTOMATIK-GUNCELLEME.md](../ops/ELECTRON-OTOMATIK-GUNCELLEME.md) · [MOBIL-UZAKTAN-GUNCELLEME.md](../ops/MOBIL-UZAKTAN-GUNCELLEME.md) · tören [URETIM-SATICI-TOREN.md](../ops/URETIM-SATICI-TOREN.md).

## 0. Özet

| Konu | Bugün (ölçüldü, §1) | Hedef (§3) |
|---|---|---|
| Panel künyesi (`tekserp-panel`) | `panel-2026` (+ yedek `panel-2026-2`) panele GÖMÜLÜ, süresiz | gömülü olan yalnız KÖK; imzalayan `ist-<yıl>-<n>` kök imzalı ISTEMCI sertifikasıyla (395 gün) künyenin YÜKÜNDE gelir |
| Tablet APK künyesi (`tekserp-apk`) | aynı iki anahtar, JS paketine gömülü | panelle aynı zincir, aynı sertifika |
| Tablet OTA kod imzası (expo-updates) | kanal başına öz-imzalı RSA sertifika, 30 yıl, APK'ya gömülü; özel anahtar Mac'te PAROLASIZ | APK'ya gömülü olan **OTA kökü** (X.509 RSA CA, çevrimdışı); manifesti yıllık **OTA yaprak sertifikası** (395 gün) imzalar, zincir manifest yanıtında gelir — expo-updates bunu destekliyor (§1.4, ölçüldü) |
| APK mührü (Android) | `tekserp-release.keystore` | kökün altına GİREMEZ (§4); korunur, süreye bağlanmaz |
| Kayıp / çalınma | yedeğe geç + yeni yedek çapaya; çalınan anahtar onu tanıyan son istemci güncellenene dek geçerli | kökle yeni sertifika + iptal satırı; panel/APK künyesinde iptal SERT, OTA'da iptal YOK — çalınan yaprak en çok süresi kadar (§2, §3.5) |
| Geçiş | — | çift imza YOK: ortak uygulama ilk sürümünden zincirle doğar; adnansahin eski anahtarlarla eski yolda kalır (§5) |

## 1. Bugünkü düzen (koddan, 2026-10-06)

### 1.1 Panel (Electron) güncellemesi nasıl doğrulanıyor

- **Authenticode YOK, electron-updater'ın imza denetimi KULLANILMIYOR.** `Electron/package.json` `build.win`de `certificateFile`/`publisherName`/`verifyUpdateCodeSignature` yok (ölçüldü); electron-updater Authenticode'u yalnız `publisherName` varken denetler, o da fail-open'dır (arşiv `docs/history/arsiv/2026-10.md`, "panel imzalı künye" kararı (2) ve açık (d): sertifika şirket kuruluşundan sonra).
- **Tek kapı kendi Ed25519 imzamız:** `latest.yml` içinde `tekserp: {v:1, bildirim}` bloğu, `typ: tekserp-panel`, ana süreçte üç anda doğrulanır (indirmeden önce · indikten sonra · kurmadan hemen önce). Tek kaynak bağımlılıksız JS: `Electron/electron/guncelleme/{kunye-jws,panel-kunye,latest-yml}.mjs`; panel, yayın kapısı (`scripts/lib/panel-imza-kapisi.mjs`) ve imza aracı (`Teks-Erp/scripts/panel-imza.ts`) aynı dosyayı kullanır.
- JWS başlığı dar allowlist `alg · typ · kid` (`kunye-jws.mjs:11`) ⇒ sertifika başlığa giremez, YÜKE girer (PAKET'teki gibi). İmzacı ailesi `^(?:paket|panel)-…` (`kunye-jws.mjs:15`), üretim biçimi `^(?:paket|panel)-\d{4}(-\d{1,3})?$` (`:19`), anahtar yalnız çapadan kid ile.
- Künye yükü v:1: `urun · platform · kanal · surum · commit · yayinZamani · paket{ad, boyut, sha512} · capa` (`panel-kunye.mjs:64-97`); `capa` = pakete gömülü çapanın kid'leri, yayın kapısının **rotasyon kilidi** buna bakar (yeni imzacı yayındaki künyenin `capa`sında olmalı, `panel-imza-kapisi.mjs:90`). Yük v:1 içinde yeni alan eski panelde YOK SAYILIR (`panel-kunye.mjs:58-60`).
- Zaman ölçütü YOK: anahtarın ömrü = çapanın ömrü. İptal YOK.

### 1.2 Tablet APK künyesi

- `apk/surum.json` içinde `tekserp: {v, bildirim}`, `typ: tekserp-apk`; doğrulayıcı bağımlılıksız TS `mobil/src/services/apkKunye.ts` (Ed25519 `src/lib/kripto`), yayın aracı aynası `mobil/scripts/lib/apk-kunye.mjs` (panelin `kunye-jws.mjs`ini içe alır).
- Çapa `mobil/src/lib/apk-imza-capasi.json` = panelinkiyle AYNI iki satır (`panel-2026` · `panel-2026-2`). Çapa **JS paketinin içindedir** ⇒ onu OTA kod imzası korur: OTA anahtarını ele geçiren APK künyesi kapısını da değiştirebilir. Tabletin asıl güven kapısı OTA'dır.

### 1.3 Tablet OTA kod imzası

- `mobil/app.json` `updates.codeSigningCertificate: ./keystore/ota-certs/certificate.pem`, `codeSigningMetadata {keyid: main, alg: rsa-v1_5-sha256}`; kanal derlemesi kanalın sertifikasını enjekte eder (`scripts/lib/kanal.cjs:52`), her kanalın anahtarı AYRIDIR (`surum-yayin.md` tablet kanal kimliği satırı).
- Mac'te (`mobil/keystore/`, git dışı) ölçülen sertifikalar — hepsi **öz-imzalı yaprak**, CA değil, `keyUsage: digitalSignature` + `EKU: codeSigning`, **30 yıl**: `ota-certs` (CN "Adnan Sahin ERP", 2026-09-01 → 2056) · `ota-certs-demofabrika` (2026-09-30 → 2056) · `ota-certs-testfabrika` (2026-09-27 → 2056).
- Özel anahtarlar `keystore/ota-keys*/private-key.pem` **PKCS#1, ŞİFRESİZ** (`BEGIN RSA PRIVATE KEY`, `Proc-Type` yok — yalnız başlık satırı okundu).
- Yayın aracı donmuş `multipart/mixed` gövdesini kendisi kurar ve `expo-signature` başlığını RSA-SHA256 ile basar (`mobil/scripts/lib/manifest.mjs:120-161`, `yayinla-ota.mjs:772`) — sunucu dinamik değil, dosya statik.
- Bugünkü kural: "anahtar kaybı = her tablette sil+kur" (`surum-yayin.md:36`).

### 1.4 expo-updates sertifika zinciri — ÖLÇÜLDÜ (expo-updates 29.0.20, Android kaynağı)

- **Destekliyor.** `codesigning/CodeSigningConfiguration.kt:63-66`: `includeManifestResponseCertificateChain` açıksa zincir = manifest yanıtının `certificate_chain` parçası + gömülü sertifika; `loader/FileDownloader.kt:188` parçayı okur. iOS aynası `ios/EXUpdates/CodeSigning/CodeSigningConfiguration.swift:34`.
- Zincir kuralı (`codesigning/CertificateChain.kt`): `[yaprak, ara…, kök]`; her halka bir sonrakince imzalı ve özne/veren eşleşir; son halka (gömülü) öz-imzalı ve **CA** olmalı (`basicConstraints` + `keyCertSign`); ara halkalar CA + `pathLen` uyulur; yaprak `digitalSignature` + `EKU codeSigning` taşımalı.
- **Her sertifikada `checkValidity()`** — CİHAZ SAATİYLE, toleranssız: süresi geçmiş yaprakla imzalı manifest indirilmez. İmza yalnız indirme anında denetlenir (`FileDownloader.kt:273,466`); kurulmuş OTA paketi sertifika bitince ÖLMEZ.
- **İptal (CRL/OCSP) YOK.** Algoritma yalnız `SHA256withRSA` (Ed25519 kökümüz OTA'yı doğrudan imzalayamaz). Expo proje uzantısı (OID `…7894389.20439.2.1`) yoksa denetim atlanır — biz kullanmayız.
- Ayar adı `codeSigningIncludeManifestResponseCertificateChain` (Android meta-data `expo.modules.updates.CODE_SIGNING_INCLUDE_MANIFEST_RESPONSE_CERTIFICATE_CHAIN`, `UpdatesConfiguration.kt:119,160`). **Expo yapılandırma eklentisi (`@expo/config-plugins` 54.0.5) bu meta-data'yı YAZMAZ** (yalnız sertifika + metadata, `build/android/Updates.js:75,146`) ⇒ repoda zaten olan eklenti deseniyle (`mobil/plugins/withReleaseKeystore`) kendi küçük eklentimiz gerekir; yeni npm paketi gerekmez.
- Zincirli kipte `codeSigningMetadata` (keyid/alg) imza denetiminde yok sayılır; yalnız `expo-signature` kabul başlığına girer.

### 1.5 Anahtarlar nerede

| Anahtar | Yer | Koruma |
|---|---|---|
| `panel-2026` (birincil) | `~/.tekserp/panel-uretim/panel-2026.panel.json` (Mac, 0600) | parolalı (`protocol/anahtar-sarma.ts`) |
| `panel-2026-2` (yedek) | USB (runbook: Mac'ten kaldırılır) | ayrı parola, kâğıtta |
| OTA (adnansahin · demofabrika · testfabrika) | `mobil/keystore/ota-keys*/` (Mac) | **parolasız** |
| APK mührü | `mobil/keystore/tekserp-release.keystore` + `keystore.properties` | keystore parolası |
| KÖK `kok-2026-1` (Ed25519) | iş listesi 1.2 ile Mac'e iner | kök parolası |

## 2. Tehdit

| # | Olay | Bugün | Hedef |
|---|---|---|---|
| T1 | `panel-2026` çalınır + güncelleme sunucusu/Cloudflare/yayın hesabı ele geçer | bütün panellere yönetici yetkisiyle kod (kurulum `perMachine` + elevate); kapanış = yeni sürüm + çapadan çıkarma, geride kalan panel sonsuza dek açık | kök iptal satırı basar; panel künyeyi indirmeden önce iptale ve süreye bakar ⇒ iptali gören panel RED; görmeyen panelde de en çok `bitis + 180 gün` |
| T2 | Tablet OTA anahtarı çalınır + sunucu ele geçer | o kanalın bütün tabletlerinde JS (APK künye çapası dahil); 30 yıl geçerli; kapanış = sil+kur | yaprak en çok 395 gün geçerli; kök çevrimdışı ⇒ yeni yaprak basılır, eskisi süresiyle söner (iptal yok — expo sınırı, §3.5) |
| T3 | OTA özel anahtarının Mac'ten kopyalanması | parolasız dosya | yaprak anahtarı parolalı; OTA kökü kök parolasıyla sarılı, kökle birlikte çevrimdışı |
| T4 | Birincil anahtarın kaybı | yedeğe geçiş (yedek USB'de kayıpsa çıkışsız) | kökle yeni sertifika; yedek gereksiz |
| T5 | APK mührü çalınır | sunucu da ele geçerse… künye yine panel anahtarını ister; elle yükleme (sideload) bizim kontrolümüzde değil | aynı (APK mührü bu düzene giremez, §4); künye kapısı zincirle süreli olur |
| T6 | Saat oyunu | — | panel ve APK künyesinde `şimdi` = cihaz saati; yerel yönetici makinenin sahibidir (PAKET §4.3 ile aynı kabul). OTA'da expo cihaz saatini kullanır |

Kapsam dışı: şirket kod imza sertifikası (Authenticode) — gelince `publisherName` ikinci bağımsız kat olur, künye kalır; patron uygulaması (mağaza imzalı, OTA yok).

## 3. Hedef düzen

### 3.1 İki zincir — çünkü OTA Ed25519 kökümüzü anlamaz

```
KÖK (kok-<yıl>-<n>, Ed25519, Mac, çevrimdışı)
  └─ ISTEMCI sertifikası  tekserp-sertifika { kullanim: "ISTEMCI", kid: "ist-<yıl>-<n>", x, siniflar, baslangic, bitis }  (395 gün)
       ├─ panel künyesi  tekserp-panel  (latest.yml bloğu v:2; yükte imzaciSertifikasi + imzaZamani)
       └─ APK künyesi    tekserp-apk    (apk/surum.json bloğu v:2; aynı alanlar)
KÖK ── iptal: tekserp-paketiptal satırı { kid: "ist-…", sertifikaId, tarih, neden }   (§3.4)

OTA KÖKÜ (X.509 RSA-3072, öz-imzalı CA, pathLen 0, keyCertSign, EKU YOK; 30 yıl; APK'ya gömülü; kök parolasıyla sarılı, kökle aynı yerde)
  └─ OTA YAPRAK  (X.509 RSA, digitalSignature + EKU codeSigning, 395 gün; Mac'te parolalı)
       └─ OTA manifesti  (expo-signature; yanıtta certificate_chain = yaprak PEM)
```

- ISTEMCI sertifikası mevcut `tekserp-sertifika` biçimidir; `CERT_USAGES`a `ISTEMCI`, `SUB_KID_PREFIX`e `ISTEMCI: "ist-"` (TS + satıcı/patron aynası + Rust `schema.rs` aynası — Rust doğrulayıcıları bu sertifikayı hiç görmez ama kâhin şema eşitliğini ölçer). `bayi: null`; `siniflar` kökün bütün sınıfları — istemci sınıf süzgeci UYGULAMAZ (kurulumun sınıfını güvenilir bilmez; PAKET'in setup CLI'si V5 gibi süzgeçsiz).
- `REVOCATION_USAGES` (`tekserp-iptal` satırı) DEĞİŞMEZ: `ISTEMCI` oraya giremez (PAKET §1.5'teki kapalı enum gerekçesi aynen).
- Panel ve tablet AYNI ISTEMCI sertifikasını kullanır (bugün de aynı anahtar; `typ` ayrımı çapraz protokol karışmasını zaten keser) — §8 soru 2.
- OTA kökü neden ayrı anahtar: expo yalnız X.509 + `SHA256withRSA` doğrular (§1.4); Ed25519 kökün X.509 karşılığı yok. "Kökün altında" OTA için **kökle aynı yerde, aynı parolayla, aynı törende** demektir; OTA kökü yalnız yaprak basar (EKU'suz CA ⇒ manifesti doğrudan imzalarsa expo RED verir: kök kendisi imzacı olamaz).
- Yeni ortak uygulamanın panel ve tablet çapası **yalnız kök listesidir** (`kok-anahtarlar.ts`ten `guven-capasi-ekle.ts` ile üretilir; tek kip, hazırlık kökü `TEK-ORTAK-PAKET.md` O14 ile kalkar). `panel-*`/`paket-*` doğrudan çapa satırı yeni uygulamada YOKTUR.

### 3.2 Künye v:2 ve doğrulama

- Blok `{v: 2, bildirim, iptal?}` (KATI; `iptal` isteğe bağlı kök imzalı iptal belgesi, §3.4). Yük v:2 = v:1 alanları + `imzaciSertifikasi` (JWS) + `imzaZamani` (ISO); `capa` artık gömülü KÖK kid'leridir. v:1 blok ve `panel-*` kid'li künye yeni uygulamada RED (`BELGE_SURUM` / `JWS_KID`).
- Sıra (panel üç anın ilkinde, tablet künyeyi okuyunca): blok → kök çapası → sertifika (kök tanınıyor · kullanım `ISTEMCI` · kid `ist-` · `x` = JWS anahtarı) → JWS (typ · kid · imza) → **zaman (KABUL kipi)**: `imzaZamani ∈ [baslangic, bitis]` VE `şimdi ≤ bitis + 180 gün` → **iptal**: sertifika elde/blokta gelen en yüksek `sira`lı iptalde ise RED → şema → kanal (= grup) → sürüm/dosya bağı (bugünkü kurallar aynen).
- Yalnız KABUL kipi vardır: kurulmuş panel/APK yeniden doğrulanmaz (bugün de öyle); "YERLEŞİK" kip gerekmez.
- `imzaZamani` imzalandığı andır ve yeniden imzada (terfi, yıllık tören) değişir; `yayinZamani` ilk yayının anıdır, değişmez.
- Tolerans 180 gün, PAKET'le aynı sayı (§8 soru 2 PAKET kararı) — tek kural, tek doğrulayıcı; asıl güvence yıllık törenin yayındaki künyeleri yeniden imzalamasıdır (§6), tolerans unutulan yeniden imzaya karşı emniyettir.
- Red davranışı bugünkü gibi: indirilmez/kurulmaz, TR uyarı (panel `UpdateSecurityStrip`, tablet uyarısı), eski sürümde çalışmaya devam. Yeni kodlar: `SERTIFIKA_GECERSIZ` · `SERTIFIKA_SURESI` · `SERTIFIKA_IPTAL`.
- Doğrulayıcı tek kaynak: bağımlılıksız JS `istemci-zinciri.mjs` (yeni, `Electron/electron/guncelleme/` altında; protokol `anahtar-zinciri.ts verifyCertificate` + `paket-zinciri.ts` iptal mantığının aynası); tablet TS aynası `istemciZinciri.ts` (yeni, `mobil/src/lib/` altında; `lib/kripto` Ed25519). İkisi de `test_panel_imza` kâhinine bağlanır (protokolle aynı vektör → aynı kod).

### 3.3 Rotasyon kilidi sadeleşir

- Yıllık ISTEMCI yenilemesi çapaya DOKUNMAZ ⇒ "yeni kid önce çapaya, eski anahtarla bir sürüm" dansı kalkar. Kilit yeni biçimde: imzalayan sertifikanın kökü, yayındaki künyenin `capa`sında (kök kid'leri) olmalı. Yalnız KÖK değişiminde (nadir, 1.2 türü tören) bugünkü dans geçerli kalır.
- Yayın aracı, sertifikasının bitişine 30 günden az kalmış ISTEMCI anahtarıyla imzalamaz (DUR + "yıllık tören" iletisi).

### 3.4 İptal belgesi ve taşınması

- **Tercih: 3.9'un `tekserp-paketiptal` belgesi genişler** — satır kid deseni `^pkt-…` → `^(?:pkt|ist)-…`; belge "dağıtım iptali" olur, tek `sira`, tek satıcı defteri (3.9 D4), tek tören adımı. Koşul: 3.9 D1–D3 henüz sahaya ÇIKMADI (ölçüldü: `gece/paket-anahtar-d13` `main`de değil). Güncelleyici `ist-*` satırını hiçbir sertifikayla eşleştiremez, zararsızdır.
- **Geri dönüş:** dilim başladığında D1 sahadaysa (yayınlanmış bir sürümde `pkt-` deseni kapalı) genişletme o doğrulayıcıyı bütün belgeden koparır (§1.5 dersi) ⇒ ayrı tür `tekserp-istemciiptal` (aynı şema, satır `ist-*`), ayrı `sira`.
- Taşıma (hepsi kök imzalı, "en yüksek `sira` kazanır", yerelde saklanır — panel `userData/lisans-iptal.jws`, tablet secure-store):
  1. **Backend'in indirme belirteci yanıtı** — panel ve tablet belirteci zaten backend'den alır (`TEK-ORTAK-PAKET.md` S2); backend 3.9 D3'ün iptal deposundaki belgeyi yanıta ekler (`iptal` alanı, isteğe bağlı; backend onu kiradan alır). Sunucudan BAĞIMSIZ kanal: güncelleme sunucusunu ele geçiren iptali saklayamaz.
  2. **Künye bloğu** — yayın aracı o anki en yeni iptali `iptal` alanına koyar. Sunucu düşürebilir ama sahteleyemez; yerel en yüksek `sira` geri alınamaz.
- İptal belgesi hiç yoksa kabul (süre korur) — PAKET'te güncelleyicinin "doğrulanamazsa yok say" kuralıyla aynı.

### 3.5 OTA'nın sınırları (açıkça)

- **İptal yok.** Çalınan OTA yaprağı, saldırgan sunucumuza da girerse, en çok bitişine kadar (≤ 395 gün) iş görür. Kapatma yolları: (a) yeni yaprak + yayındaki manifestlerin yeniden imzası (saldırganın eskisini kullanmasını engellemez) · (b) **APK güncellemesi** — APK künyesi zincirli ve iptalli olduğu için yeni OTA köküyle derlenmiş APK sahaya sil+kur OLMADAN gider (APK mührü sağlam kaldıkça). Bugünkü "anahtar kaybı = sil+kur" kuralı OTA için kalkar, yalnız APK mührüne kalır.
- Reddedilen seçenekler: expo-updates'e CRL yaması (yeni paket yaması, her Expo yükseltmesinde bakım; onay ister — §8 soru 4) · JS'ten manifesti önceden çekip zinciri denetlemek (sunucu ikinci istekte başka yanıt verebilir — TOCTOU, güvenlik değil).
- **Toleranssız süre:** yaprak bittiği gün eski imzalı manifest hiçbir tablete inmez ⇒ yıllık tören yayındaki her grup × `runtimeVersion` manifestini YENİ yaprakla yeniden imzalar (§6); yayın aracı bitişine 30 günden az kalan yaprakla imzalamaz. Cihaz saati yeni yaprağın başlangıcından gerideyse OTA inmez (bugün de 2026-09 öncesi saatte aynı).
- OTA kökü bitişi (30 yıl) ya da kaybı ⇒ yeni kökle APK; bu yüzden OTA kökü KÖK ile aynı yedek düzenine girer (1.2).

## 4. APK mührünün bu düzene GİREMEYECEĞİ sınırlar

- Android güncellemeyi yalnız "kurulu uygulamayla aynı imzalayan" kuralıyla kabul eder; sertifika zinciri, CA, iptal ya da geçerlilik süresi BAKILMAZ. Mührü yıllık değiştirmek = her yıl yeni uygulama kimliği (veri kaybı, sil+kur).
- Anahtar döndürme yalnız APK İmza Şeması v3 soy zinciriyle (Android 9 / API 28+); tabletlerin taban sürümü `minSdkVersion 26` (`mobil/app.json:65`) ⇒ Android 8 tabletlerde döndürme işlemez. Kullanılmaz.
- Google Play'e geçilirse uygulama imzasını Google tutar (Play App Signing); bizim elimizde yalnız yükleme anahtarı kalır ve kendi sitemizden dağıtılan APK ile Play'den kurulan aynı paket adında birbirini güncelleyemez — dağıtım kanalı kararı mühürden ÖNCE gelir (§8 soru 5).
- Bu düzende APK mührünün karşılığı **künyedir**: tablet, ISTEMCI zinciriyle imzalı, süreli ve iptalli künyesi olmayan APK'yı indirmez ve kurulum ekranını açmaz. Mühür yalnız "aynı uygulama" kimliğidir, güven kapısı değildir. Mühür Mac'te + şifreli yedekte kalır; ortak uygulama YENİ mühürle doğar (yeni paket adı `com.etkiliyazilim.tekserp`, `TEK-ORTAK-PAKET.md` K-1) — adnansahin mührüne dokunulmaz.

## 5. Geçiş — çift imza YOK, adnansahin eski yolda

| İstemci | Ne olur |
|---|---|
| adnansahin paneli 1.3.7 / tableti 1.0.12 (eski kimlik `com.teks.erp.mobil`, eski adres `guncelleme.etkiliyazilim.com/adnansahin/`) | Hiçbir şey değişmez: gömülü `panel-2026`/`panel-2026-2` çapası ve adnansahin OTA sertifikası aynen; eski adrese yeni yayın yapılmaz. Eski anahtarlar silinmez (§8 soru 3). |
| Ortak panel/tablet ilk sürümü (1.5.0 / 1.1.0, `TEK-ORTAK-PAKET.md` §8.3) | Baştan zincirle: çapa = kökler, künye v:2, APK'da OTA kökü + zincir meta-data'sı. Eski künye biçimini HİÇ tanımaz. |
| Ortak uygulama bu işten ÖNCE çıkarsa (geri dönüş) | O sürüm `panel-2026` + kök çapasıyla çıkar ve v:1/v:2 ikisini de okur; bir sonraki sürüm yalnız v:2. Tablet OTA'sı için geri dönüş YOK: OTA kökü APK'ya gömülüdür, sonradan değişmesi yeni APK ister ⇒ **O7 bu işin OTA dilimini (I5) içermeden paketlenmez**. |
| Eski backend | Belirteç yanıtında `iptal` yok → istemci yalnız künye bloğundaki iptali kullanır. Backend istemciden ÖNCE dağıtılır (çekirdek kural). |
| Eski satıcı | İptal satırı basılmaz → yalnız süre korur. Satıcı fabrikadan ÖNCE. |

**K-2 ile birleşim:** K-2'nin "yeni güncelleme imza anahtarı" = OTA kökü (Mac'te bir kez, kullanıcıyla, kök parolası) + ilk OTA yaprağı. `TEK-ORTAK-PAKET.md` §2.1'deki `otaSertifika: keystore/ota-certs-ortak/certificate.pem` yolu OTA KÖKÜNÜN sertifikasıdır; dilim O7'nin "ortak OTA anahtar çifti" maddesi bu belgenin I5'iyle değişir. O10b'deki "manifest grup başına yeniden imzalanır" yaprakla yapılır.

## 6. Tören adımları (yıllık dönem töreni `--istemci`, kök parolası bir kez)

1. İstemci aracı yeni Ed25519 anahtarı üretir: `panel-imza.ts anahtar-uret --kid=ist-<yıl>-<n>`, **istemci parolasını kendisi sorar** (kökten FARKLI).
2. `satici/sunucu/scripts/anahtar.ts istemci-sertifika-uret --x=<x> --kid=ist-<yıl>-<n> --kok=<kök> --gun=395` → açık `<kid>.sertifika.json`; istemci aracı `sertifika-ekle` (`x` uyuşmazsa RED).
3. OTA yaprağı: yaprak anahtarı + CSR üretilir (`openssl`, Mac'te var — yeni npm paketi yok; yaprak anahtarı istemci parolasıyla şifreli PKCS#8), OTA kökü (kök parolasıyla açılır) 395 günlük yaprağı basar; araç yaprağın CA olmadığını, EKU'yu ve kökle zincirlendiğini `node:crypto X509Certificate` ile ölçer.
4. **Yayındaki her grubun son panel künyesi, APK künyesi ve her etkin `runtimeVersion` OTA manifesti yeni imzacıyla yeniden imzalanır** (istemci parolası); paket baytları değişmez, istemci yeniden kurmaz (sürüm aynı).
5. Künye: kid · açık anahtar · pencereler · yaprak parmak izi (`DONEM-KUNYE.json`); VDS'e yalnız açık sertifikalar (süre uyarısı).
- **Kayıp / çalınma (ISTEMCI):** aynı adımlar + kök `tekserp-paketiptal`e `ist-*` satırı (§3.4); kira ile backend'e, oradan istemciye. **OTA yaprağı:** iptal yok — yeni yaprak + yeniden imza; kök şüpheliyse APK yolu (§3.5).
- Prova hazırlık kökü yerine `test-anchor` derlemesiyle (`TEK-ORTAK-PAKET.md` K-10 ile aynı).

## 7. Dilimler (sıralı; her biri tek ajan)

| # | İş | Bağımlılık | Bekçi (genişleyen / yeni) |
|---|---|---|---|
| I1 | Protokol: `ISTEMCI` kullanımı + `ist-` öneki (TS + satıcı/patron aynası + Rust şema aynası); `tekserp-paketiptal` satırına `ist-*` (ya da geri dönüş türü, §3.4); kâhin vektörleri | 3.9 D1 dalı | `test_lisans_protokol` · `test_lisans_native_kahin` · `test_paket_zinciri` (ist satırı güncelleyicide zararsız) · `test_iptal_belgesi` (`tekserp-iptal`e ISTEMCI GİREMEZ) |
| I2 | Bağımlılıksız JS zincir doğrulayıcı `istemci-zinciri.mjs` + tablet TS aynası; KABUL zamanı, iptal birleştirme, yeni hata kodları | I1 | `test_panel_imza` §0 kâhin (protokolle bayt-eşit karar; tolerans +1 gün kırmızı; `panel-*` kid'li v:2 RED) |
| I3 | Panel: künye v:2, çapa = kök listesi (`guven-capasi-ekle.ts istemci-kok`), iptal deposu (`userData`), belirteç yanıtından iptal, yeni kodların arayüz metni | I2 + `TEK-ORTAK-PAKET.md` O5/O6 | `panel-kunye.test.ts` · `updater-imza-akisi.test.ts` · `update-imza-arayuz.test.tsx` · `test_guven_capasi_ekle` |
| I4 | Tablet APK künyesi v:2 (aynı kurallar, secure-store iptal) | I2 + O8 | `apkKunye.test.ts` · `appUpdate.apk.test.ts` |
| I5 | Tablet OTA zinciri (**K-2**, O7 içinde): OTA kökü sertifikası `app.json`da; eklenti `withOtaZinciri` (zincir meta-data'sı); `manifest.mjs` `certificate_chain` parçası; `yayinla-ota.mjs` yaprakla imzalar; `build-apk.mjs` APK'dan geri okur (meta-data = true · gömülü sertifika CA · EKU'suz) | O7 | `update-feed-url.test.ts` · `test_mobile_update` · `test_kanal_yayin_kapisi` (OTA bölümü) · yeni `manifest` sondası: kökle doğrudan imza, süresi geçmiş yaprak, yabancı kök — hepsi `multipartDogrula` RED |
| I6 | Backend: belirteç yanıtına `iptal` (3.9 D3 deposundan); satıcı: ISTEMCI iptal satırı defteri ve içe aktarma (3.9 D4 genişler) | I1, 3.9 D3/D4 | `test_lisans_*` ilgili · satıcı vitest |
| I7 | Araçlar + tören: `panel-imza.ts` `sertifika-ekle` · `anahtar.ts istemci-sertifika-uret` · OTA kökü/yaprak araçları (openssl sarmalayıcı) · `uretim-toren.mjs donem --istemci` · yayındaki künye/manifest yeniden imzası · 30 gün kapısı · rotasyon kilidinin kök düzeyine inmesi | I3–I5 | `test_uretim_toren` (hepsi-ya-da-hiçbiri; VDS paketinde istemci/OTA özel yarısı YOK) · `test_kanal_yayin_kapisi` §8 · `test_panel_imza` §2–§3 |
| I8 | Prova (thinkpad + gerçek tablet, `test` grubu): zincirli panel güncellemesi · iptal → RED + TR uyarı · zincirli OTA iner · süresi geçmiş yaprak inmez · OTA kökü değişimi APK yoluyla sil+kur'suz | I1–I7 | uçtan uca, kullanıcıyla |
| I9 | Kurallar (`surum-yayin.md` panel/tablet/OTA satırları, `lisans.md` çapa satırı) + arşiv notu; ilk gerçek ISTEMCI sertifikası + OTA kökü töreni (kullanıcıyla, Mac, 1.2 sonrası) | I8 + 1.2 | `check-docs` · `npm test` tam |

Sıra şartı: I1–I2 `TEK-ORTAK-PAKET.md` O10a/O10b'den (ilk yayın) ÖNCE; I5 olmadan O7 paketlenmez (§5). Her dilimde yalnız o dilimin bekçileri; I9 sonunda tam koşum.

## 8. Açık kararlar — kullanıcıya sorulacak (sade dille)

1. **Sıra:** Yeni ortak panel ve tablet ilk sürümünden itibaren yeni imza düzeniyle mi çıksın? Öneri **evet** — biraz bekletir ama "önce eski anahtarla çıkıp sonra geçiş" turu hiç olmaz; tablette güncelleme anahtarı uygulamanın içine gömüldüğü için sonradan değiştirmek yeni kurulum dosyası ister.
2. **Tek anahtar mı:** Panel ve tablet güncellemelerini yine aynı (yılda bir yenilenen) anahtar mı imzalasın? Öneri **evet** — ayrı olursa yıllık tören bir adım uzar, kazanç küçüktür (bugün de aynı anahtar).
3. **Eski anahtarlar:** adnansahin donduruldu; onun panel/tablet imza anahtarları (`panel-2026`, yedeği ve tablet güncelleme anahtarı) silinmesin, kapalı bir yerde parolalı saklansın mı? Öneri **saklansın** — adnansahin'e acil bir düzeltme gerekirse tek yol bunlar; bugün parolasız duran tablet güncelleme anahtarları da parolalı hâle getirilsin.
4. **Tablet güncellemesinde iptal yok:** Tablet uygulama güncellemesinin imza belgesi çalınırsa, yerine yenisi çıkarılır ama çalınan belge süresi bitene kadar (en çok 1 yıl + 1 ay) geçerli kalır — saldırganın ayrıca sunucumuza da girmesi gerekir. Bunu kabul edelim mi, yoksa Expo'nun koduna kendi iptal denetimimizi yamalayalım mı (her Expo yükseltmesinde ek bakım)? Öneri **kabul**; acil durumda yeni kurulum dosyası (veri silinmeden) çıkış yoludur.
5. **Tablet nereden dağıtılacak:** Fabrika tableti kendi sitemizden mi kurulacak, ileride Google Play'den mi? Play'e geçilirse kurulum dosyasının imzasını Google tutar ve sitemizden kurulan tabletlerle karışmaz; bu yüzden yeni ortak tabletin mührü bu karara göre üretilir. Öneri **şimdilik kendi sitemiz**, Play ayrı karar.
6. **Yedek anahtar:** Yeni düzende ayrı bir "yedek imza anahtarı" (bugünkü `panel-2026-2` gibi) tutulmasın mı? Öneri **tutulmasın** — anahtar kaybolursa kök yenisini o gün basar; yedek yalnız çalınabilecek bir dosya daha olur. Kökün kendi yedeği 1.2'de çözülür.
