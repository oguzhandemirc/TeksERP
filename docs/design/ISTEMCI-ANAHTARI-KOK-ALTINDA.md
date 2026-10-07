# İstemci imza anahtarları kökün altında — panel ve tablet güncellemeleri için süreli sertifika

> **Durum:** TASARIM (2026-10-06; kararlar 2026-10-07). Kod yok; kodlama §7'deki dilimlerle, dilim başına bir ajan. §8'deki altı soruyu kullanıcı 2026-10-07'de cevapladı; gövde bu kararlara göre düzeltildi (arşiv `docs/history/arsiv/2026-10.md` → "2026-10-07 — İstemci imza anahtarı, tablet dağıtımı…").
> **Bağlayıcı kararlar:** kullanıcı 2026-10-06 — panel/tablet imza anahtarları 3.9'daki düzene AYRI işte alınır ([PAKET-ANAHTARI-KOK-ALTINDA.md](PAKET-ANAHTARI-KOK-ALTINDA.md) §8 soru 7); bütün anahtar yenilemeleri YILDA BİR dönem töreninde toplanır (ara imzacı/ALT/İND 395 gün, paket 1 yıl + 1 ay, §8 soru 8); adnansahin dondurulmuştur (panel 1.3.7 · tablet OTA 1.0.12) ve onun bugünkü anahtarlarıyla doğrulanan eski güncelleme yolu bozulmaz — yeni düzen YALNIZ yeni ortak uygulamada.
> **Birleştiği iş:** tek ortak paket (iş listesi 3.1, `TEK-ORTAK-PAKET.md` — bugün dal `gece/ortak-paket-o13b`'de, `main`de değil) §10 **K-2** ("ortak tablet yeni `runtimeVersion` 55.0 ve yeni bir güncelleme imza anahtarıyla başlar") ve dilimleri O5–O8 · O10a–b. Bu belge K-2'nin "yeni güncelleme imza anahtarı"nın NE olduğunu tanımlar.
> **Komşu belgeler:** kurallar [lisans.md](../kurallar/lisans.md) · [surum-yayin.md](../kurallar/surum-yayin.md) · runbook [ELECTRON-OTOMATIK-GUNCELLEME.md](../ops/ELECTRON-OTOMATIK-GUNCELLEME.md) · [MOBIL-UZAKTAN-GUNCELLEME.md](../ops/MOBIL-UZAKTAN-GUNCELLEME.md) · tören [URETIM-SATICI-TOREN.md](../ops/URETIM-SATICI-TOREN.md).

## 0. Özet

| Konu | Bugün (ölçüldü, §1) | Hedef (§3) |
|---|---|---|
| Panel künyesi (`tekserp-panel`) | `panel-2026` (+ yedek `panel-2026-2`) panele GÖMÜLÜ, süresiz | gömülü olan yalnız KÖK; imzalayan `ist-<yıl>-<n>` kök imzalı ISTEMCI sertifikasıyla (395 gün) künyenin YÜKÜNDE gelir; YEDEK ISTEMCI anahtarı çevrimdışı USB'de, sertifikası yine kök imzalı (§3.6) |
| Tablet APK künyesi (`tekserp-apk`) | aynı iki anahtar, JS paketine gömülü | ortak tablette YOK: dağıtım Google Play gizli yayını, native güncelleme Play'den (§1.2, §4); künye yalnız adnansahin'in eski yolunda yaşar |
| Tablet OTA kod imzası (expo-updates) | kanal başına öz-imzalı RSA sertifika, 30 yıl, APK'ya gömülü; özel anahtar Mac'te PAROLASIZ | APK'ya gömülü olan **OTA kökü** (X.509 RSA CA, çevrimdışı); manifesti yıllık **OTA yaprak sertifikası** (395 gün) imzalar, zincir manifest yanıtında gelir — expo-updates bunu destekliyor (§1.4, ölçüldü) |
| APK mührü (Android) | `tekserp-release.keystore` | kökün altına GİREMEZ (§4); ortak tablette mührü Google tutar (Play App Signing), bizde yükleme anahtarı kalır |
| Kayıp / çalınma | yedeğe geç + yeni yedek çapaya; çalınan anahtar onu tanıyan son istemci güncellenene dek geçerli | kayıpta yedek ISTEMCI anahtarına geç (çapa değişmez, §3.6); çalınmada ayrıca kökle iptal satırı — panel künyesinde iptal SERT, OTA'da iptal YOK, çalınan yaprak en çok süresi kadar (§2, §3.5) |
| Geçiş | — | çift imza YOK: ortak uygulama ilk sürümünden zincirle doğar (karar 1); adnansahin eski anahtarlarla eski yolda kalır (§5) |

## 1. Bugünkü düzen (koddan, 2026-10-06)

### 1.1 Panel (Electron) güncellemesi nasıl doğrulanıyor

- **Authenticode YOK, electron-updater'ın imza denetimi KULLANILMIYOR.** `Electron/package.json` `build.win`de `certificateFile`/`publisherName`/`verifyUpdateCodeSignature` yok (ölçüldü); electron-updater Authenticode'u yalnız `publisherName` varken denetler, o da fail-open'dır (arşiv `docs/history/arsiv/2026-10.md`, "panel imzalı künye" kararı (2) ve açık (d): sertifika şirket kuruluşundan sonra).
- **Tek kapı kendi Ed25519 imzamız:** `latest.yml` içinde `tekserp: {v:1, bildirim}` bloğu, `typ: tekserp-panel`, ana süreçte üç anda doğrulanır (indirmeden önce · indikten sonra · kurmadan hemen önce). Tek kaynak bağımlılıksız JS: `Electron/electron/guncelleme/{kunye-jws,panel-kunye,latest-yml}.mjs`; panel, yayın kapısı (`scripts/lib/panel-imza-kapisi.mjs`) ve imza aracı (`Teks-Erp/scripts/panel-imza.ts`) aynı dosyayı kullanır.
- JWS başlığı dar allowlist `alg · typ · kid` (`kunye-jws.mjs:11`) ⇒ sertifika başlığa giremez, YÜKE girer (PAKET'teki gibi). İmzacı ailesi `^(?:paket|panel)-…` (`kunye-jws.mjs:15`), üretim biçimi `^(?:paket|panel)-\d{4}(-\d{1,3})?$` (`:19`), anahtar yalnız çapadan kid ile.
- Künye yükü v:1: `urun · platform · kanal · surum · commit · yayinZamani · paket{ad, boyut, sha512} · capa` (`panel-kunye.mjs:64-97`); `capa` = pakete gömülü çapanın kid'leri, yayın kapısının **rotasyon kilidi** buna bakar (yeni imzacı yayındaki künyenin `capa`sında olmalı, `panel-imza-kapisi.mjs:90`). Yük v:1 içinde yeni alan eski panelde YOK SAYILIR (`panel-kunye.mjs:58-60`).
- Zaman ölçütü YOK: anahtarın ömrü = çapanın ömrü. İptal YOK.

### 1.2 Tablet APK künyesi

- `apk/surum.json` içinde `tekserp: {v, bildirim}`, `typ: tekserp-apk`; tablet doğrulayıcısı K-14'te (2026-10-07) ortak tabletten kalktı (eski kanalda `eski-kanal-son` etiketinde), yayın aracı aynası `mobil/scripts/lib/apk-kunye.mjs` (panelin `kunye-jws.mjs`ini içe alır).
- Çapa `mobil/src/lib/apk-imza-capasi.json` = panelinkiyle AYNI iki satır (`panel-2026` · `panel-2026-2`). Çapa **JS paketinin içindedir** ⇒ onu OTA kod imzası korur: OTA anahtarını ele geçiren APK künyesi kapısını da değiştirebilir. Tabletin asıl güven kapısı OTA'dır.
- **Ortak tablette bu yol YOK (karar 5, 2026-10-07).** Ortak tablet Google Play gizli yayınıyla dağıtılır; Play'den kurulan uygulama kendi APK'sını indirip kuramaz ⇒ native/büyük güncelleme Play'den, JS güncellemesi OTA ile uygulama içinden gelir. APK künyesi (`tekserp-apk`) ve kurulum ekranını açan güncelleme yolu yalnız adnansahin'in dondurulmuş tabletinde kalır; ortak tabletteki kodunun kaldırılması `TEK-ORTAK-PAKET.md` K-14 işidir.

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
| `panel-2026` (birincil) | `~/.tekserp/panel-uretim/panel-2026.panel.json` (Mac, 0600) | parolalı (`protocol/anahtar-sarma.ts`); adnansahin için SAKLANIR, silinmez (karar 3) |
| `panel-2026-2` (yedek) | USB (runbook: Mac'ten kaldırılır) | ayrı parola, kâğıtta |
| OTA (adnansahin · demofabrika · testfabrika) | `mobil/keystore/ota-keys*/` (Mac) | **parolasız** — silinmez, parola konur (karar 3; kullanıcı klavye başındayken yapılır, 2026-10-07 itibarıyla YAPILMADI) |
| APK mührü | `mobil/keystore/tekserp-release.keystore` + `keystore.properties` | keystore parolası |
| KÖK `kok-2026-1` (Ed25519) | iş listesi 1.2 ile Mac'e iner | kök parolası |

## 2. Tehdit

| # | Olay | Bugün | Hedef |
|---|---|---|---|
| T1 | `panel-2026` çalınır + güncelleme sunucusu/Cloudflare/yayın hesabı ele geçer | bütün panellere yönetici yetkisiyle kod (kurulum `perMachine` + elevate); kapanış = yeni sürüm + çapadan çıkarma, geride kalan panel sonsuza dek açık | kök iptal satırı basar; panel künyeyi indirmeden önce iptale ve süreye bakar ⇒ iptali gören panel RED; görmeyen panelde de en çok `bitis + 180 gün` |
| T2 | Tablet OTA anahtarı çalınır + sunucu ele geçer | o kanalın bütün tabletlerinde JS (APK künye çapası dahil); 30 yıl geçerli; kapanış = sil+kur | yaprak en çok 395 gün geçerli; kök çevrimdışı ⇒ yeni yaprak basılır, eskisi süresiyle söner (iptal yok — expo sınırı, §3.5) |
| T3 | OTA özel anahtarının Mac'ten kopyalanması | parolasız dosya | yaprak anahtarı parolalı; OTA kökü kök parolasıyla sarılı, kökle birlikte çevrimdışı |
| T4 | Birincil anahtarın kaybı | yedeğe geçiş (yedek USB'de kayıpsa çıkışsız) | yedek ISTEMCI anahtarına geçiş — sertifikası zaten kök imzalı, çapa değişmez, kök açılmaz (§3.6); yedek de kayıpsa kökle yeni sertifika |
| T5 | APK mührü çalınır | sunucu da ele geçerse… künye yine panel anahtarını ister; elle yükleme (sideload) bizim kontrolümüzde değil | ortak tablette uygulama mührü Google'dadır (Play App Signing); bizdeki yükleme anahtarı çalınırsa Google'a başvuruyla sıfırlanır, Play'e yükleme yine hesabımızı ister (§4) |
| T6 | Saat oyunu | — | panel künyesinde `şimdi` = cihaz saati; yerel yönetici makinenin sahibidir (PAKET §4.3 ile aynı kabul). OTA'da expo cihaz saatini kullanır |

Kapsam dışı: şirket kod imza sertifikası (Authenticode) — gelince `publisherName` ikinci bağımsız kat olur, künye kalır; patron uygulaması (mağaza imzalı, OTA yok).

## 3. Hedef düzen

### 3.1 İki zincir — çünkü OTA Ed25519 kökümüzü anlamaz

```
KÖK (kok-<yıl>-<n>, Ed25519, Mac, çevrimdışı)
  ├─ ISTEMCI sertifikası (birincil)  tekserp-sertifika { kullanim: "ISTEMCI", kid: "ist-<yıl>-<n>", x, siniflar, baslangic, bitis }  (395 gün; Mac, istemci parolası)
  │    └─ panel künyesi  tekserp-panel  (latest.yml bloğu v:2; yükte imzaciSertifikasi + imzaZamani)
  └─ ISTEMCI sertifikası (yedek)     aynı biçim, kid "ist-<yıl>-<n+1>"  (395 gün; çevrimdışı USB, kendi parolası kâğıtta — §3.6)
KÖK ── iptal: tekserp-paketiptal satırı { kid: "ist-…", sertifikaId, tarih, neden }   (§3.4)

OTA KÖKÜ (X.509 RSA-3072, öz-imzalı CA, pathLen 0, keyCertSign, EKU YOK; 30 yıl; APK'ya gömülü; kök parolasıyla sarılı, kökle aynı yerde)
  ├─ OTA YAPRAK  (X.509 RSA, digitalSignature + EKU codeSigning, 395 gün; Mac'te parolalı)
  │    └─ OTA manifesti  (expo-signature; yanıtta certificate_chain = yaprak PEM)
  └─ YEDEK OTA YAPRAK  (aynı biçim, 395 gün; yedek ISTEMCI anahtarıyla aynı USB'de, aynı yedek parolayla — §3.6)
```

- ISTEMCI sertifikası mevcut `tekserp-sertifika` biçimidir; `CERT_USAGES`a `ISTEMCI`, `SUB_KID_PREFIX`e `ISTEMCI: "ist-"` (TS + satıcı/patron aynası + Rust `schema.rs` aynası — Rust doğrulayıcıları bu sertifikayı hiç görmez ama kâhin şema eşitliğini ölçer). `bayi: null`; `siniflar` kökün bütün sınıfları — istemci sınıf süzgeci UYGULAMAZ (kurulumun sınıfını güvenilir bilmez; PAKET'in setup CLI'si V5 gibi süzgeçsiz).
- `REVOCATION_USAGES` (`tekserp-iptal` satırı) DEĞİŞMEZ: `ISTEMCI` oraya giremez (PAKET §1.5'teki kapalı enum gerekçesi aynen).
- Panel ve tablet için TEK ISTEMCI anahtarı vardır (karar 2; bugün de aynı anahtar, `typ` ayrımı çapraz protokol karışmasını zaten keser). Ortak tablet Play'den dağıtıldığı için (karar 5) bugün tablette bu anahtarın imzaladığı bir künye yoktur; tabletin güncelleme güveni Play (native) + OTA zinciridir (JS). Tablete ileride Play dışı bir imzalı işaretçi gerekirse aynı ISTEMCI anahtarı kullanılır, ayrı anahtar açılmaz.
- OTA kökü neden ayrı anahtar: expo yalnız X.509 + `SHA256withRSA` doğrular (§1.4); Ed25519 kökün X.509 karşılığı yok. "Kökün altında" OTA için **kökle aynı yerde, aynı parolayla, aynı törende** demektir; OTA kökü yalnız yaprak basar (EKU'suz CA ⇒ manifesti doğrudan imzalarsa expo RED verir: kök kendisi imzacı olamaz).
- Yeni ortak panelin çapası **yalnız kök listesidir** (`kok-anahtarlar.ts`ten `guven-capasi-ekle.ts` ile üretilir; tek kip, hazırlık kökü `TEK-ORTAK-PAKET.md` O14 ile kalkar). `panel-*`/`paket-*` doğrudan çapa satırı yeni uygulamada YOKTUR.

### 3.2 Künye v:2 ve doğrulama

- Blok `{v: 2, bildirim, iptal?}` (KATI; `iptal` isteğe bağlı kök imzalı iptal belgesi, §3.4). Yük v:2 = v:1 alanları + `imzaciSertifikasi` (JWS) + `imzaZamani` (ISO); `capa` artık gömülü KÖK kid'leridir. v:1 blok ve `panel-*` kid'li künye yeni uygulamada RED (`BELGE_SURUM` / `JWS_KID`).
- Sıra (panel üç anın ilkinde): blok → kök çapası → sertifika (kök tanınıyor · kullanım `ISTEMCI` · kid `ist-` · `x` = JWS anahtarı) → JWS (typ · kid · imza) → **zaman (KABUL kipi)**: `imzaZamani ∈ [baslangic, bitis]` VE `şimdi ≤ bitis + 180 gün` → **iptal**: sertifika elde/blokta gelen en yüksek `sira`lı iptalde ise RED → şema → kanal (= grup) → sürüm/dosya bağı (bugünkü kurallar aynen).
- Yalnız KABUL kipi vardır: kurulmuş panel yeniden doğrulanmaz (bugün de öyle); "YERLEŞİK" kip gerekmez.
- `imzaZamani` imzalandığı andır ve yeniden imzada (terfi, yıllık tören) değişir; `yayinZamani` ilk yayının anıdır, değişmez.
- Tolerans 180 gün, PAKET'le aynı sayı (§8 soru 2 PAKET kararı) — tek kural, tek doğrulayıcı; asıl güvence yıllık törenin yayındaki künyeleri yeniden imzalamasıdır (§6), tolerans unutulan yeniden imzaya karşı emniyettir.
- Red davranışı bugünkü gibi: indirilmez/kurulmaz, TR uyarı (panel `UpdateSecurityStrip`), eski sürümde çalışmaya devam. Yeni kodlar: `SERTIFIKA_GECERSIZ` · `SERTIFIKA_SURESI` · `SERTIFIKA_IPTAL`.
- Doğrulayıcı tek kaynak: bağımlılıksız JS `istemci-zinciri.mjs` (yeni, `Electron/electron/guncelleme/` altında; protokol `anahtar-zinciri.ts verifyCertificate` + `paket-zinciri.ts` iptal mantığının aynası); tablet TS aynası YAZILMAZ (ortak tablette APK künyesi yok, karar 5). Doğrulayıcı `test_panel_imza` kâhinine bağlanır (protokolle aynı vektör → aynı kod).

### 3.3 Rotasyon kilidi sadeleşir

- Yıllık ISTEMCI yenilemesi çapaya DOKUNMAZ ⇒ "yeni kid önce çapaya, eski anahtarla bir sürüm" dansı kalkar. Kilit yeni biçimde: imzalayan sertifikanın kökü, yayındaki künyenin `capa`sında (kök kid'leri) olmalı. Yalnız KÖK değişiminde (nadir, 1.2 türü tören) bugünkü dans geçerli kalır.
- Yayın aracı, sertifikasının bitişine 30 günden az kalmış ISTEMCI anahtarıyla imzalamaz (DUR + "yıllık tören" iletisi).

### 3.4 İptal belgesi ve taşınması

- **Tercih: 3.9'un `tekserp-paketiptal` belgesi genişler** — satır kid deseni `^pkt-…` → `^(?:pkt|ist)-…`; belge "dağıtım iptali" olur, tek `sira`, tek satıcı defteri (3.9 D4), tek tören adımı. Koşul: 3.9 D1–D3 henüz sahaya ÇIKMADI (ölçüldü: `gece/paket-anahtar-d13` `main`de değil). Güncelleyici `ist-*` satırını hiçbir sertifikayla eşleştiremez, zararsızdır.
- **Geri dönüş:** dilim başladığında D1 sahadaysa (yayınlanmış bir sürümde `pkt-` deseni kapalı) genişletme o doğrulayıcıyı bütün belgeden koparır (§1.5 dersi) ⇒ ayrı tür `tekserp-istemciiptal` (aynı şema, satır `ist-*`), ayrı `sira`.
- Taşıma (hepsi kök imzalı, "en yüksek `sira` kazanır", yerelde saklanır — panel `userData/lisans-iptal.jws`):
  1. **Backend'in indirme belirteci yanıtı** — panel belirteci zaten backend'den alır (`TEK-ORTAK-PAKET.md` S2); backend 3.9 D3'ün iptal deposundaki belgeyi yanıta ekler (`iptal` alanı, isteğe bağlı; backend onu kiradan alır). Sunucudan BAĞIMSIZ kanal: güncelleme sunucusunu ele geçiren iptali saklayamaz.
  2. **Künye bloğu** — yayın aracı o anki en yeni iptali `iptal` alanına koyar. Sunucu düşürebilir ama sahteleyemez; yerel en yüksek `sira` geri alınamaz.
- İptal belgesi hiç yoksa kabul (süre korur) — PAKET'te güncelleyicinin "doğrulanamazsa yok say" kuralıyla aynı.

### 3.5 OTA'nın sınırları (açıkça)

- **İptal yok.** Çalınan OTA yaprağı, saldırgan sunucumuza da girerse, en çok bitişine kadar (≤ 395 gün) iş görür. Kapatma yolları: (a) yeni yaprak + yayındaki manifestlerin yeniden imzası (saldırganın eskisini kullanmasını engellemez) · (b) **Play güncellemesi** — yeni OTA köküyle derlenmiş APK Play gizli yayınından normal güncelleme olarak iner, sil+kur gerekmez (uygulama mührü Google'da, karar 5). Bugünkü "anahtar kaybı = sil+kur" kuralı ortak tablette kalkar; adnansahin'in eski tabletinde aynen geçerlidir. Acil çıkış yeni kurulumdur (karar 4).
- Reddedilen seçenekler: expo-updates'e CRL yaması (yeni paket yaması, her Expo yükseltmesinde bakım; karar 4 — iptalsizlik riski KABUL edildi) · JS'ten manifesti önceden çekip zinciri denetlemek (sunucu ikinci istekte başka yanıt verebilir — TOCTOU, güvenlik değil).
- **Toleranssız süre:** yaprak bittiği gün eski imzalı manifest hiçbir tablete inmez ⇒ yıllık tören yayındaki her grup × `runtimeVersion` manifestini YENİ yaprakla yeniden imzalar (§6); yayın aracı bitişine 30 günden az kalan yaprakla imzalamaz. Cihaz saati yeni yaprağın başlangıcından gerideyse OTA inmez (bugün de 2026-09 öncesi saatte aynı).
- OTA kökü bitişi (30 yıl) ya da kaybı ⇒ yeni kökle Play sürümü; bu yüzden OTA kökü KÖK ile aynı yedek düzenine girer (1.2).
- Yaprak kaybında yayın YEDEK OTA yaprağıyla sürer (§3.6); OTA kökünü açmak gerekmez.

### 3.6 Yedek ISTEMCI anahtarı (karar 6)

- Her yıllık tören İKİ ISTEMCI anahtarı basar: birincil `ist-<yıl>-<n>` (Mac, istemci parolası) ve yedek `ist-<yıl>-<n+1>` (çevrimdışı USB, KENDİ parolası yalnız kâğıtta, Mac'te kalmaz) — bugünkü `panel-2026-2` düzeni. İkisinin sertifikası kök imzalı ve 395 günlüktür; aynı törende yedek OTA yaprağı da basılır ve aynı USB'ye, aynı yedek parolayla yazılır.
- Birincil kaybolur ya da bozulursa yayın yedekle sürer: yedeğin sertifikası zaten kök imzalıdır ⇒ çapa değişmez, kök açılmaz, tören beklenmez. Yeni çift bir sonraki törende (gerekirse kökle o gün) basılır.
- Birincil ÇALINIRSA yayın yedekle sürer ve kök birincil için iptal satırı basar (§3.4). Yedek çalınırsa aynı iptal yolu.
- Yedek de 30 gün kapısına tabidir (§3.3); bitişi birincille aynı gündür, ikisi aynı törende yenilenir ve önceki yılın yedeği USB'den silinir.
- Tören, USB'deki yedeğin açıldığını ve açık anahtarının künyedekiyle eşleştiğini ölçer; açılamayan yedek tören hatasıdır.

## 4. APK mührünün bu düzene GİREMEYECEĞİ sınırlar

- Android güncellemeyi yalnız "kurulu uygulamayla aynı imzalayan" kuralıyla kabul eder; sertifika zinciri, CA, iptal ya da geçerlilik süresi BAKILMAZ. Mührü yıllık değiştirmek = her yıl yeni uygulama kimliği (veri kaybı, sil+kur).
- Anahtar döndürme yalnız APK İmza Şeması v3 soy zinciriyle (Android 9 / API 28+); tabletlerin taban sürümü `minSdkVersion 26` (`mobil/app.json:65`) ⇒ Android 8 tabletlerde döndürme işlemez. Kullanılmaz.
- **Dağıtım Google Play gizli yayınıdır (karar 5, 2026-10-07):** Managed Google Play, uygulama yalnız bizim fabrikalarımıza görünür. Play App Signing ⇒ uygulama mührünü Google tutar; bizde yalnız **yükleme anahtarı** kalır (Mac + şifreli yedek; kaybında Google'a başvuruyla sıfırlanır, uygulama kimliği değişmez).
- Play'de uygulamanın kendi APK'sını indirip kurma yolu kullanılamaz ⇒ native/büyük güncelleme Play'den, JS güncellemesi OTA ile uygulama içinden gelir; ortak tablette APK künyesi ve kurulum ekranı açan güncelleme yolu yoktur (§1.2).
- Sitemizden kurulan APK ile Play'den kurulan aynı paket adında birbirini güncelleyemez ⇒ ortak tablet için TEK kurulum yolu Play'dir: sitede ortak tablet APK'sı yayınlanmaz, sahada siteden kurulmuş ortak tablet bulunmaz.
- Play incelemesi internetten erişilebilen bir demo sunucu + deneme hesabı ister.
- Ortak tablette güven kapıları Play (kurulum + native güncelleme) ve OTA zinciridir (JS); mühür yalnız "aynı uygulama" kimliğidir. Ortak uygulama yeni paket adıyla Play'de doğar (`com.etkiliyazilim.tekserp`, `TEK-ORTAK-PAKET.md` K-1); adnansahin'in eski mührü (`tekserp-release.keystore`) Mac + şifreli yedekte kalır, dokunulmaz.

## 5. Geçiş — çift imza YOK, adnansahin eski yolda

| İstemci | Ne olur |
|---|---|
| adnansahin paneli 1.3.7 / tableti 1.0.12 (eski kimlik `com.teks.erp.mobil`, eski adres `guncelleme.etkiliyazilim.com/adnansahin/`) | Hiçbir şey değişmez: gömülü `panel-2026`/`panel-2026-2` çapası ve adnansahin OTA sertifikası aynen; eski adrese yeni yayın yapılmaz. Eski panel/tablet/OTA anahtarları silinmez, şifreli saklanır; parolasız OTA anahtarlarına parola konur (karar 3, kullanıcıyla; yapılmadı). |
| Ortak panel/tablet ilk sürümü (1.5.0 / 1.1.0, `TEK-ORTAK-PAKET.md` §8.3) | Baştan zincirle (karar 1): panel çapası = kökler, künye v:2, eski künye biçimini HİÇ tanımaz; tablet Play gizli yayınının ilk sürümüdür, APK'da OTA kökü + zincir meta-data'sı, APK künyesi yok. |
| Ortak uygulama bu işten ÖNCE çıkmaz (karar 1) | I1–I3 ve I5 ilk yayından önce biter; `panel-2026` ortak uygulamaya hiç girmez. OTA kökü APK'ya gömülü olduğundan sonradan değişmesi yeni Play sürümü ister ⇒ **O7 bu işin OTA dilimini (I5) içermeden paketlenmez**. |
| Eski backend | Belirteç yanıtında `iptal` yok → panel yalnız künye bloğundaki iptali kullanır. Backend istemciden ÖNCE dağıtılır (çekirdek kural). |
| Eski satıcı | İptal satırı basılmaz → yalnız süre korur. Satıcı fabrikadan ÖNCE. |

**K-2 ile birleşim:** K-2'nin "yeni güncelleme imza anahtarı" = OTA kökü (Mac'te bir kez, kullanıcıyla, kök parolası) + ilk OTA yaprağı. `TEK-ORTAK-PAKET.md` §2.1'deki `otaSertifika: keystore/ota-certs-ortak/certificate.pem` yolu OTA KÖKÜNÜN sertifikasıdır; dilim O7'nin "ortak OTA anahtar çifti" maddesi bu belgenin I5'iyle değişir. O10b'deki "manifest grup başına yeniden imzalanır" yaprakla yapılır.

## 6. Tören adımları (yıllık dönem töreni `--istemci`, kök parolası bir kez)

1. İstemci aracı iki Ed25519 anahtarı üretir: birincil `panel-imza.ts anahtar-uret --kid=ist-<yıl>-<n>` (**istemci parolasını kendisi sorar**, kökten FARKLI; Mac) ve yedek `--kid=ist-<yıl>-<n+1>` (AYRI yedek parolası, yalnız kâğıda yazılır; dosya doğrudan USB'ye yazılır, Mac'te kalmaz — §3.6).
2. `satici/sunucu/scripts/anahtar.ts istemci-sertifika-uret --x=<x> --kid=<kid> --kok=<kök> --gun=395` her iki anahtar için → açık `<kid>.sertifika.json`; istemci aracı `sertifika-ekle` (`x` uyuşmazsa RED).
3. OTA yaprakları: birincil ve yedek yaprak anahtarı + CSR üretilir (`openssl`, Mac'te var — yeni npm paketi yok; birincil istemci parolasıyla, yedek yedek parolasıyla şifreli PKCS#8, yedek USB'ye), OTA kökü (kök parolasıyla açılır) 395 günlük iki yaprağı basar; araç yaprakların CA olmadığını, EKU'yu ve kökle zincirlendiğini `node:crypto X509Certificate` ile ölçer.
4. **Yayındaki her grubun son panel künyesi ve her etkin `runtimeVersion` OTA manifesti birincil imzacıyla yeniden imzalanır** (istemci parolası); paket baytları değişmez, istemci yeniden kurmaz (sürüm aynı).
5. Yedek ölçümü: USB'deki yedek anahtar ve yedek yaprak yedek parolasıyla açılır, açık anahtarları künyedekiyle eşleşir; önceki yılın yedeği USB'den silinir.
6. Künye: iki kid · açık anahtarlar · pencereler · iki yaprağın parmak izi (`DONEM-KUNYE.json`); VDS'e yalnız açık sertifikalar (süre uyarısı).
- **Kayıp (ISTEMCI birincil):** yayın yedekle sürer (çapa değişmez, §3.6); yeni çift bir sonraki törende ya da kökle o gün. **Çalınma:** ayrıca kök `tekserp-paketiptal`e `ist-*` satırı (§3.4); kira ile backend'e, oradan panele. **OTA yaprağı:** iptal yok — yedek yaprağa geçiş + yeniden imza; kök şüpheliyse Play yolu (§3.5).
- Prova hazırlık kökü yerine `test-anchor` derlemesiyle (`TEK-ORTAK-PAKET.md` K-10 ile aynı).

## 7. Dilimler (sıralı; her biri tek ajan)

| # | İş | Bağımlılık | Bekçi (genişleyen / yeni) |
|---|---|---|---|
| I1 | Protokol: `ISTEMCI` kullanımı + `ist-` öneki (TS + satıcı/patron aynası + Rust şema aynası); `tekserp-paketiptal` satırına `ist-*` (ya da geri dönüş türü, §3.4); kâhin vektörleri | 3.9 D1 dalı | `test_lisans_protokol` · `test_lisans_native_kahin` · `test_paket_zinciri` (ist satırı güncelleyicide zararsız) · `test_iptal_belgesi` (`tekserp-iptal`e ISTEMCI GİREMEZ) |
| I2 | Bağımlılıksız JS zincir doğrulayıcı `istemci-zinciri.mjs` (tablet aynası YOK, karar 5); KABUL zamanı, iptal birleştirme, yeni hata kodları | I1 | `test_panel_imza` §0 kâhin (protokolle bayt-eşit karar; tolerans +1 gün kırmızı; `panel-*` kid'li v:2 RED; yedek kid'li sertifika çapa değişmeden kabul) |
| I3 | Panel: künye v:2, çapa = kök listesi (`guven-capasi-ekle.ts istemci-kok`), iptal deposu (`userData`), belirteç yanıtından iptal, yeni kodların arayüz metni | I2 + `TEK-ORTAK-PAKET.md` O5/O6 | `panel-kunye.test.ts` · `updater-imza-akisi.test.ts` · `update-imza-arayuz.test.tsx` · `test_guven_capasi_ekle` |
| I4 | ~~Tablet APK künyesi v:2~~ — KALKTI (karar 5: ortak tablette APK künyesi yok; Play dışı APK yolunun ortak tabletten kaldırılması `TEK-ORTAK-PAKET.md` K-14 işi) | — | — |
| I5 | Tablet OTA zinciri (**K-2**, O7 içinde): OTA kökü sertifikası `app.json`da; eklenti `withOtaZinciri` (zincir meta-data'sı); `manifest.mjs` `certificate_chain` parçası; `yayinla-ota.mjs` yaprakla imzalar; `build-apk.mjs` APK'dan geri okur (meta-data = true · gömülü sertifika CA · EKU'suz) | O7 | `update-feed-url.test.ts` · `test_mobile_update` · `test_kanal_yayin_kapisi` (OTA bölümü) · yeni `manifest` sondası: kökle doğrudan imza, süresi geçmiş yaprak, yabancı kök — hepsi `multipartDogrula` RED |
| I6 | Backend: belirteç yanıtına `iptal` (3.9 D3 deposundan); satıcı: ISTEMCI iptal satırı defteri ve içe aktarma (3.9 D4 genişler) | I1, 3.9 D3/D4 | `test_lisans_*` ilgili · satıcı vitest |
| I7 | Araçlar + tören: `panel-imza.ts` `sertifika-ekle` · `anahtar.ts istemci-sertifika-uret` · OTA kökü/yaprak araçları (openssl sarmalayıcı) · `uretim-toren.mjs donem --istemci` (birincil + yedek çift, yedek USB'ye ve ayrı parolayla, yedeğin açılabilirlik ölçümü) · yayındaki künye/manifest yeniden imzası · 30 gün kapısı · rotasyon kilidinin kök düzeyine inmesi | I3, I5 | `test_uretim_toren` (hepsi-ya-da-hiçbiri; VDS paketinde istemci/OTA özel yarısı YOK) · `test_kanal_yayin_kapisi` §8 · `test_panel_imza` §2–§3 |
| I8 | Prova (thinkpad + Play'den kurulmuş gerçek tablet, `test` grubu): zincirli panel güncellemesi · yedek anahtarla imzalı künye kabul · iptal → RED + TR uyarı · zincirli OTA iner · yedek yaprakla imzalı OTA iner · süresi geçmiş yaprak inmez · OTA kökü değişimi Play güncellemesiyle sil+kur'suz | I1–I3, I5–I7 | uçtan uca, kullanıcıyla |
| I9 | Kurallar (`surum-yayin.md` panel/tablet/OTA satırları, `lisans.md` çapa satırı) + arşiv notu; ilk gerçek ISTEMCI sertifikası (birincil + yedek) + OTA kökü töreni ve adnansahin'in parolasız OTA anahtarlarına parola (karar 3) — kullanıcıyla, Mac, 1.2 sonrası | I8 + 1.2 | `check-docs` · `npm test` tam |

Sıra şartı (karar 1): I1–I3 ve I5 `TEK-ORTAK-PAKET.md` O10a/O10b'den (ilk yayın) ÖNCE; I5 olmadan O7 paketlenmez (§5). Her dilimde yalnız o dilimin bekçileri; I9 sonunda tam koşum.

## 8. Kararlar — kullanıcı 2026-10-07

1. **Sıra:** yeni ortak panel ve tablet İLK sürümünden yeni imza düzeniyle çıkar; "önce eski anahtarla çık, sonra geç" turu yoktur (§5, §7 sıra şartı).
2. **Tek anahtar:** panel ve tablet güncellemelerini aynı, yılda bir yenilenen ISTEMCI anahtarı imzalar (§3.1). Tablet Play'den dağıtıldığı için bugün tablette bu anahtarın imzaladığı künye yoktur; ileride gerekirse ayrı anahtar açılmaz.
3. **Eski anahtarlar:** adnansahin'in panel/tablet/OTA anahtarları (`panel-2026`, `panel-2026-2`, adnansahin OTA anahtarı) silinmez, şifreli saklanır. Mac'te parolasız duran OTA anahtarlarına (`mobil/keystore/ota-keys*/`) parola konur; bu iş kullanıcı klavye başındayken yapılır ve 2026-10-07 itibarıyla YAPILMADI (§1.5, I9).
4. **Tablet OTA belgesinde iptal yok:** risk KABUL edildi; Expo'ya iptal yaması yapılmaz. Acil çıkış yeni kurulumdur (§3.5).
5. **Tablet dağıtımı:** Google Play gizli yayını (Managed Google Play, yalnız bizim fabrikalarımıza görünür). Sonuçları: uygulama mührünü Google tutar (Play App Signing) · uygulamanın kendi APK indirme/kurma yolu Play'de kullanılamaz, native/büyük güncelleme Play'den, JS OTA ile uygulama içinden · Play incelemesi demo sunucu + deneme hesabı ister · siteden kurulan tablet Play'den güncellenemez ⇒ tek kurulum yolu Play (§1.2, §4, §5; `TEK-ORTAK-PAKET.md` K-14).
6. **Yedek anahtar:** öneriye TERS karar — yedek ISTEMCI anahtarı TUTULUR (bugünkü `panel-2026-2` gibi: çevrimdışı USB, kendi parolası kâğıtta). Aynı düzen OTA yaprağına da uygulanır: yedek yaprak aynı USB'de, aynı yedek parolayla (tasarım uzantısı; kullanıcı aksini derse yalnız ISTEMCI yedeği kalır) (§3.6, §6, §7).
