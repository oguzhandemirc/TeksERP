# Lisans protokolü — kanonik sözleşme (v:1)

> **Lisans v2 (L2-1, 2026-10-01) — v:1 İÇİNDE, yalnız isteğe bağlı alan:** ara imzacı zinciri (G4) · iptal belgesi · çevrimdışı ufuk ve ödenmiş tarih (P) · kip alt sınırı · kapanış kirası (K6) · parmak izi v2 (K8: kayıp etken, güçlü etken şartı, zayıf kural) · `donanim` amacı + `POST /v1/donanim` · İSTEK `yol` bağı · yetenek bildirimi · K2 önlemleri (`hak.ozet`, `hakOzeti`, `iptalSira`). Tasarım: [LISANS-V2-CEVRIMDISI-KIRA.md](LISANS-V2-CEVRIMDISI-KIRA.md) (K1–K8). Tam alan listesi, uyumluluk tablosu ve uygulayan dilimlere bağlayıcı notlar §12 madde 15 ve §13b; test vektörleri `native/lisans-cekirdek/test-vektorleri/protokol-v2.json`.
> **Durum:** Faz 1a (2026-09-29), DONMUŞ kontrat — satıcı sunucusu (1b) ve fabrika lisans motoru (1c) buna karşı yazılır. **P0 (2026-09-29, W3a kapısı):** lisans kimliği portalda (D14) · taşıma kodu (D8) · satıcı saati (D4) · 16 karakterlik kod — v:1 İÇİNDE geriye uyumlu; tam alan listesi §12 madde 14, uygulayan dilimlere bağlayıcı notlar §13a.
> **Tek kaynak KOD'dur:** `Teks-Erp/src/lib/license/protocol/` (+ yerel durum için `state.ts`, `state-rules.ts`, `saat.ts`). Bu belge onun anlatımıdır; ayrışırsa kod ve bekçisi kazanır, belge düzeltilir.
> **Bekçiler:** `Teks-Erp/scripts/test_lisans_protokol.ts` (sözleşme) · `Teks-Erp/scripts/test_lisans_durumu.ts` (durum) · ayna bekçisi (`test_lisans_protokol_aynasi`) satıcı klasörü doğunca 1b'de.
> **Üst belge:** onaylı plan (Kod Koruma + Lisanslama, §3 protokol, §4 durum). Plan ile çelişki çıkarsa plan kazanır; bu dilimde bilinçli yapılan sapmalar ve genişlemeler en sondaki "Plandan sapmalar" bölümündedir.

## 0. Kapsam ve dosya haritası

`protocol/` klasörü **kendi içine kapalıdır**: yalnız `node:crypto`, `zod` ve kardeş dosyaları import eder; backend'in başka hiçbir modülüne dokunmaz, modül düzeyinde değiştirilebilir durum (`let`/`var`) taşımaz. `satici/` ve `patron/sunucu` bu klasörü **bayt-eşit ayna** olarak taşır (değişiklik önce burada, sonra aynaya kopya).

| Dosya | Ne |
|---|---|
| `protocol/ortak.ts` | `Result<T>` (doğrulama istisna değil değer döner), sabit hata kodları, katı base64url, ISO↔ms, `CLOCK_SKEW_MS` (±10 dk) |
| `protocol/jws.ts` | JWS compact + EdDSA: `signJws` · `parseJws` (imzasız, yalnız anahtar bulmak için) · `verifyJws` · `publicKeyFromX(x)` · `publicKeyX` · `installationKeyId` |
| `protocol/belgeler.ts` | `TYP` kayıt defteri, sınıf/kademe/amaç kümeleri, belge şemaları (Zod), `decodeDocument` · `signDocument` |
| `protocol/kok-anahtarlar.ts` | İki kipin kök listesi (G3, 2026-10-01): `PRODUCTION_ROOT_PUBLIC_KEYS` (üretim kökü `kok-2026-1` bütün sınıflar — 2026-09-30 töreni) · `STAGING_ROOT_PUBLIC_KEYS` (hazırlık kökü `hazirlik-2026-1` TEST/DEMO) · `TrustAnchorMode` · `rootPublicKeysFor(kip)` (tanınmayan kip boş çapa); derin donuk; satır yalnız `scripts/guven-capasi-ekle.ts` ile · `STAGING_ROOT_CLASSES`. Fabrikada derlemenin çapası `lib/license/trust-anchor.ts` `ROOT_PUBLIC_KEYS` (derleme sabitinden) |
| `protocol/anahtar-zinciri.ts` | `prepareTrustAnchor` · `verifyCertificate` · `verifyEntitlement` · `verifyLease` · `checkLeaseBinding` · v2: `verifyRevocation` · `isCertificateRevoked` · `pickNewerRevocation` · `isRevocationCurrent` · `offlineHorizonCeilingDays` |
| `protocol/indirme.ts` | İNDİRME belirteci imzala/doğrula + `isDownloadPathAllowed` (CF Worker'ın kâhini) |
| `protocol/istek.ts` | İSTEK imzala/doğrula (v2: `yol` bağı) · `readRequestIdentity` · `bodyDigest` · `generateNonce` · `NonceLedger` · çevrimdışı `zarf` |
| `protocol/parmak-izi.ts` | etken normalleştirme · tuzlu özet · eşleşme kararı (üç sonuç; v2: kural, kayıp etken, güçlü etken şartı) · `assessIdentification` (zayıf tanıma) · `canAutoLearnFingerprint` |
| `protocol/donanim.ts` | v2: donanım değişikliği bildirimi gövdesi (`HardwareReportRequestSchema`, KATI) ve yanıtı (`HardwareReportResponseSchema`) |
| `protocol/anahtar-sarma.ts` | anahtar dosyası SARMASI — tek uygulama: `sealPrivateKey` · `openSealedKey` (scrypt → AES-256-GCM, AAD tür + kid + açık yarı + sınıflar) · `KeyFileError` · `passwordBuffer` · `assertPasswordStrength` (≥ 12) · ham ↔ Ed25519 özel yarı; satıcının kök/bayi dosyaları (`keys/key-files.ts`) ve imza aracının üretim PAKET anahtarı (`scripts/lib/butunluk-imza.ts`) kullanır, fabrika çalışma zamanı kullanmaz (`index.ts`e girmez) |
| `protocol/kabul.ts` + `kabul-katalogu.ts` | ilk kurulum sözleşme kabulü (Ek-7): kabul belgesi şeması (`AcceptanceDocSchema`) · `signAcceptance` · `verifyAcceptance` (YOK · IMZA · SEMA · METIN · KUTU) · `acceptanceTextDigest`; katalog (kimlik · sha256 · kutular) hukuk belgesinden ÜRETİLİR (`Teks-Erp/scripts/kabul-metni-uret.ts`), elle düzenlenmez |
| `protocol/uclar.ts` | satıcı uç yolları, istek/yanıt gövde şemaları, sağlık özeti allowlist'i, zil konuları, satıcı hata kodları, durum/kademe/kip kelime dağarcığı, etkinleştirme kodu biçimi + TEK üreticisi |
| `state.ts` + `state-rules.ts` + `state-rules-trust.ts` | SAF lisans durumu (fabrika tarafı; aynaya girmez) — güven kuralları (geri alma pini, okunamayan dosya, satıcı saati) ayrı dosyada |
| `saat.ts` | güvenilir saat hesabı + imzalı `durum.json` belgesi (fabrika tarafı) |
| `store.ts` (+ `store-files.ts`) · `runtime.ts` (+ `license-signals.ts` · `accumulation.ts`) · `fingerprint.ts` | fabrika motoru (Faz 1c/F1a): `LICENSE_DIR` deposu (atomik yazım, yalnız ENOENT "yok", lisans kimliği dosyası, senkron yükleme) · bellek çekirdeği + senkron `getLicenseSnapshot()` · bellek sinyalleri (yoklama/zil/motor durumu, satıcı saati sapması, gözlem sayaçları) · durum kaydı katmanı (birikim, son kira/HAK izi, kapalı süre kredisi) · parmak izi toplayıcı — aynaya GİRMEZ |

**Güven çapası PARAMETREDİR.** Doğrulama fonksiyonları kök listesini argüman alır; modül düzeyinde değiştirilebilir bir çapa yoktur. Çapa İKİ KİPTİR ve hiçbir derlemede birleşmez (G3, 2026-10-01): üretim derlemesi yalnız üretim köklerine (`kok-2026-1`, bütün sınıflar; 2026-09-30 töreni — `docs/ops/URETIM-SATICI-TOREN.md` §7), hazırlık derlemesi yalnız hazırlık köküne (`hazirlik-2026-1`, yalnız TEST/DEMO) güvenir; fabrika çağıranı derlemenin kipinin listesini (`trust-anchor.ts` `ROOT_PUBLIC_KEYS`, kip derleme sabitinden — kanal kaydı `backend.guvenCapasi`) verir, satıcı ortamının kipini (`GUVEN_CAPASI`) ⇒ üretim derlemesinde hazırlık kökünün imzası `KOK_BILINMIYOR`dır; hazırlık derlemesinde ÜRETİM · DR · BAYI · BARINDIRILAN HAK'ı hiç geçmez (hazırlık kökü o sınıflarda `KOK_SINIF_YETKISIZ`, üretim kökü tanınmaz). Yeni kök yalnız törenle ve yeni kid'le eklenir (rotasyonda eskisi örtüşme penceresinde kalır); boş çapa `GUVEN_CAPASI_BOS` verir (bekçi §2l). Köklerin özel yarıları repo DIŞINDADIR (parolalı; hazırlık: satıcı anahtar dizini, `docs/ops/SATICI-KURULUM.md` · üretim: tören dizini + VDS anahtar birimi). Test anahtarları src'ye girmez; bekçiler çalışma anında üretir (`Teks-Erp/scripts/lib/lisans-fikstur.ts`).

## 1. Biçim — JWS compact (RFC 7515) + EdDSA/Ed25519 (RFC 8037)

- `BASE64URL(başlık) . BASE64URL(yük) . BASE64URL(imza)`; imza girdisi ilk iki parçanın ASCII birleşimi; `node:crypto` `sign/verify(null, …)`. Dış kütüphane YOK.
- **Başlık dar bir allowlist'tir:** tam olarak `{alg, typ, kid}`. Sıra: `alg !== "EdDSA"` ⇒ `JWS_ALG` (`none`, `HS256` dahil — başka hiçbir alana bakılmadan) · başka her başlık alanı (`jwk`, `x5c`, `jku`, `crit`…) ⇒ `JWS_BASLIK` · `typ` yok/biçimsiz ⇒ `JWS_TYP` · `kid` yok/biçimsiz ⇒ `JWS_KID`. Anahtar **daima** güven çapasından `kid` ile seçilir, belgeden asla.
- `typ` beklenenle birebir eşit olmalı (`JWS_TYP`) — aynı anahtarın imzaladığı iki tür birbirinin yerine geçemez (kurulum anahtarı hem İSTEK hem `durum.json` imzalar; bekçi §3i).
- Base64url **katı**: dolgu, yabancı karakter, kanonik olmayan kuyruk biti ⇒ `JWS_BICIM`. İmza tam 64 bayt. Belge ≤ 32 KB. Başlık ve yük JSON **nesnesi** olmalı.
- Anahtar yalnız Ed25519 (Ed448 dahil başka tür imzalamaz/doğrulamaz).
- Açık anahtar biçimi: ham 32 bayt, base64url (`x`; JWK `{kty:"OKP", crv:"Ed25519", x}` ile aynı değer — CF Worker WebCrypto `importKey("jwk", …)` bunu doğrudan alır).
- Zamanlar ISO-8601 UTC, `Z` son ekli (ofsetli yazım RED). Saat farkı toleransı **±10 dk** (`CLOCK_SKEW_MS`).

| `typ` | İmzalayan | Doğrulayan |
|---|---|---|
| `tekserp-hak` | KÖK · BAYİ · HAK ara imzacısı (v2) | fabrika (satıcı da imzalamadan önce şemadan geçirir) |
| `tekserp-kira` | ALT | fabrika |
| `tekserp-sertifika` | KÖK | fabrika, satıcı |
| `tekserp-istek` | KURULUM | satıcı |
| `tekserp-indirme` | İNDİRME | CF Worker (kâhin: `indirme.ts`) |
| `tekserp-durum` | KURULUM | fabrika (yerel, ağa çıkmaz) |
| `tekserp-iptal` | yalnız KÖK (v2, G4 §2.3) | fabrika (`verifyRevocation`; satıcı her yanıtın `iptal` alanında dağıtır) |
| `tekserp-kabul` | KURULUM | satıcı (ilk kurulum sözleşme kabulü, Ek-7 — `protocol/kabul.ts`; etkinleştirme gövdesinde taşınır, satıcı kurulum kaydında saklar) |
| `tekserp-panel` | ayrı istemci yayın anahtarı `panel-<yıl>` (kullanıcı kararı 2026-10-01: `panel-2026` + çevrimdışı yedek `panel-2026-2`; PAKET künye imzalamaz) | panel ana süreci (latest.yml `tekserp` bloğu; `Electron/electron/guncelleme/panel-kunye.mjs` — bağımlılıksız ayna, kâhin `test_panel_imza`); yayın kapısı (`kanal-kapisi.mjs panel-imza`) |
| `tekserp-apk` | panelle AYNI anahtar (`panel-2026` + yedek `panel-2026-2`) | tablet (apk/surum.json `tekserp` bloğu; `mobil/src/services/apkKunye.ts` — `@noble/curves` katı kip, kâhin `kripto.test.ts` · `apkKunye.test.ts`); yayın kapısı (`deploy/mobil-yayinla.mjs`, `mobil/scripts/lib/apk-kunye.mjs`) |

## 2. Anahtar hiyerarşisi ve güven zinciri

| Anahtar | `kid` biçimi | İmzaladığı | Nasıl güvenilir |
|---|---|---|---|
| KÖK (üretim) | `kok-<yıl>-<n>` | HAK, sertifikalar | çapada, sınıf listesiyle |
| KÖK (hazırlık) | `hazirlik-<yıl>-<n>` | yalnız TEST/DEMO HAK'ı ve sertifikası | çapada; TEST/DEMO dışı sınıf verilirse çapa RED (`GUVEN_CAPASI_BICIM`) |
| ALT | `alt-…` | KİRA | kök imzalı `ALT` sertifikası, kiraya gömülü (`altSertifika`) |
| İNDİRME | `ind-…` | İNDİRME belirteci | kök imzalı `INDIRME` sertifikası; Worker yalnız açık yarıyı tutar |
| BAYİ | `bayi-…` | bayinin tavanı içinde HAK | kök imzalı `BAYI` sertifikası, HAK'a gömülü (`bayiSertifikasi`) |
| HAK ara imzacısı (v2) | `ara-…` | HAK (sertifikanın sınıfları içinde) | kök imzalı `HAK` sertifikası, HAK'a gömülü (`imzaciSertifikasi`); iptal belgesiyle iptal edilir |
| KURULUM | `kur-` + base64url(sha256(ham açık anahtar)) | İSTEK, `durum.json` | etkinleştirmede satıcıya kaydedilir |

- **Seviye:** kök → sertifika → belge; HAK ayrıca doğrudan kök imzalı olabilir (bütün eski HAK'lar bu yoldan). v2 ara yolu kök → `HAK` sertifikası → HAK'tır; kira yolu (kök → ALT → kira) ve bayi yolu değişmez. Sertifika kökün, kök çapanın sınıf yetkisini aşamaz (`KOK_SINIF_YETKISIZ`); ara imzalı HAK'ın sınıfı ara sertifikanın sınıflarında olmalı (`KOK_SINIF_YETKISIZ`); HAK'ı imzalayan kid gömülü ara sertifikanınki olmalı, kök imzalı HAK ara sertifikası taşıyamaz (`IMZACI_KIMLIK`, bayideki `BAYI_KIMLIK`in ikizi); HAK bayi ve ara sertifikasını birlikte taşıyamaz (`BELGE_SEMA`).
- **İptal (v2):** doğrulanmış iptal belgesi `verifyCertificate`/`verifyEntitlement`/`verifyLease`e `revocation` seçeneğiyle verilir; listelenen sertifika — sertifika kimliğiyle YA DA (kid, kullanım) çiftiyle, yani anahtarın kendisi — imza anından BAĞIMSIZ geçersizdir (`SERTIFIKA_IPTAL`; geri tarihli belge atlatamaz). Denetim sırası: kullanım → iptal → sınıf → zaman. Kök iptal edilemez (yalnız yeni derleme).
- **Ufuk tavanı (v2, K2):** HAK `cevrimdisiUfukGun` taşıyorsa: DEMO/TEST ≤ 45 · bayi imzalı ≤ 400 · BAYI/BARINDIRILAN ≤ 400 · süresiz (`null`) ya da 400 üstü yalnız ÜRETİM ve DR (kök ya da ara imzalı) — aşan `UFUK_TAVANI_ASIMI` (`offlineHorizonCeilingDays`; satıcı imzalamadan önce aynı tavana bakar).
- **Veriliş sınırı (v2, G4 §2.5):** `verifyEntitlement(token, roots, {nowMs})` — `nowMs` verilirse `hak.verilis > nowMs + tol` ⇒ `BELGE_ILERI_TARIHLI`; sonlu olmayan `nowMs` (NaN, ±∞) da RED. `nowMs` = max(duvar, yüksek su); güvenilir saat belgelerden türediği için onu vermek döngüdür. Verilmezse (eski çağrı) denetim yok.
- **Sertifika imza anında geçerli olmalı:** zaman denetimi `baslangic − tol ≤ çocuk.verilis ≤ bitis + tol`. Süresi SONRADAN dolan alt anahtarın kiraları ek süre zarfında çalışmaya devam eder; süresi geçmiş anahtarla basılmış kira RED (`SERTIFIKA_ZAMAN`). Geriye tarihli kira basma riskine karşı kira ömrü ≤ 45 gün.
- **Sınıf zinciri:** kök `siniflar` ⊇ sertifika `siniflar`. HAK kökle imzalıysa `hak.sinif ∈ kök.siniflar`; bayiyle imzalıysa `hak.sinif ∈ bayiSertifikası.siniflar` VE `hak.moduller ⊆ bayi.moduller` VE `hak.bayiId = sertifika.bayi.bayiId` (kriptografik; satıcı ayrıca bayinin GÜNCEL tavanına bakar). Kira bağında `hak.sinif ∈ altSertifika.siniflar` (`KIRA_SINIF_YETKISIZ`) — hazırlık sunucusunun alt anahtarı üretim kurulumuna kira veremez.
- Kök imzalı HAK bayi sertifikası taşıyamaz (`BAYI_KIMLIK`); bayi yolu yalnız gömülü BAYI sertifikasıyla açılır (yanlış kullanımlı sertifika da `BAYI_KIMLIK`).

## 3. Belgeler — alan alan (hepsi `v: 1`)

### HAK (`tekserp-hak`) — yapısal şartlar, nadiren değişir

| Alan | Tip | Not |
|---|---|---|
| `hakId` | uuid | |
| `surum` | int ≥ 1 | her yeniden basımda artar; kira bu sürüme bağlanır |
| `lisansNo` | `TKS-YYYY-NNNN[NN]` | doğuşta materyalize |
| `musteri` / `tesis` | `{id: uuid, ad: 1–200}` | |
| `kurulumId` | uuid | **lisans kimliği** — portalda kurulum açılırken doğar, fabrikada `LICENSE_DIR`de durur (D14); fabrika DB'sinin `system.installationId`si DEĞİL (o yalnız `ortam.installationId` bilgisi) |
| `sinif` | `URETIM` · `TEST` · `DR` · `DEMO` · `BAYI` · `BARINDIRILAN` | |
| `moduller` | modül anahtarı[] (≤ 64, tekrarsız) | TAVAN; biçim `MODULE_SETTING_KEYS` (`finance.enabled`, `depo.multiEnabled`) ya da `patron-bulut`; protokol listeyi BİLMEZ, eşleme 1c'nin |
| `kalici` | bool | |
| `bakimBitis` | ISO | |
| `verilis` | ISO | sertifika zaman denetiminin anı; kira yoksa ek süre çapası |
| `bayiId?` | uuid | bayi sertifikası varsa ZORUNLU |
| `bayiSertifikasi?` | JWS | yalnız bayi imzalı HAK'ta |
| `imzaciSertifikasi?` (v2) | JWS | yalnız ara imzalı HAK'ta: imzalayan `ara-` anahtarın kök imzalı `HAK` sertifikası; `bayiSertifikasi` ile birlikte RED. Eski doğrulayıcı bu HAK'ı `KOK_BILINMIYOR` ile reddeder ⇒ yalnız `hak-ara` yeteneğini bildiren kuruluma gider |
| `cevrimdisiUfukGun?` (v2) | int 1–3650 \| `null` (süresiz) | çevrimdışı ufuk; `P = min(kira.odenmisTarih ?? ∞, kira.verilis + ufuk)` (formül fabrikanın `state-rules.ts`inde). Alan yoksa P modeli işlemez, eski çapa sürer. Sınıf/imzacı tavanı §2 |
| `kipAltSiniri?` (v2) | `"zorla"` | kip alt sınırı: kira, durum kaydı ve derleme varsayılanı bunun altına inemez |

### KİRA (`tekserp-kira`) — ticari/operasyonel şartlar, ALT imzalı

| Alan | Tip | Not |
|---|---|---|
| `kiraId` | uuid | kira zinciri ucu |
| `hakId`, `hakSurum` | uuid, int | HAK'a bağ (`KIRA_HAK_UYUSMAZ`) |
| `kurulumId`, `kurulumAnahtarKimligi` | uuid, `kur-…` | yerel kimlik ve anahtarla eşleşmeli |
| `parmakIzi` | `{f1..f5: özet \| null}` | sunucunun KABUL ettiği küme |
| `verilis`, `bitis`, `sunucuSaati` | ISO | `bitis > verilis`, ömür ≤ 45 gün |
| `ekSureGun` | int 0–60 | varsayılan 30 |
| `zorlama` | bool | etkin kip |
| `gecerlilikBitis` | ISO \| null | vadeli/demo/taksit; kira bitişinden önceyse ek süre ondan başlar |
| `yaptirim` | `{kademe: K0..K5 \| null, mesaj ≤500 \| null, kisitlamaTarihi \| null, donmusModuller[], guncellemeDonuk}` | K3 ⇒ `kisitlamaTarihi` ZORUNLU |
| `yoklamaAraligiDk` | int 5–1440 | varsayılan 60 |
| `esitlemeAraligiDk`, `patronBulutBitis` | int \| null, ISO \| null | Plan B için şimdiden (v artmasın) |
| `devredildi` | bool | DR devralımı sonrası eski ana |
| `kanal` | `{kod, guncelSurumler: {backend?, panel?, tablet?}}` | |
| `altSertifika` | JWS | kirayı imzalayan ALT anahtarın sertifikası |
| `odenmisTarih?` (v2) | ISO \| `null` (süresiz) | ödenmiş tarih P (satıcıda tek kaynak `odenmisTarihi`; taksitte sıradaki taksitin vadesi — K5). HAK `cevrimdisiUfukGun` ile birlikte varsa P modeli işler |
| `parmakIziKurali?` (v2) | `standart` · `zayif` | parmak izi kararının kuralı (§6); yoksa eski kural |
| `kapanis?` (v2) | `KOPYA` · `TASIMA` · `IPTAL` | kapanış kirası (K6) — BİLGİ alanı; kısıtlamayı kiranın K3'ü (`kisitlamaTarihi = şimdi + ekSureGun`) getirir, K3'süz kapanış RED (`BELGE_SEMA`). Eski fabrika alanı atar, K3'ü uygular |
| `hakOzeti?` (v2, K2 önlemi) | sha256 base64url 43 | bağlı HAK'ın compact metninin özeti (`jwsDigest`): `checkLeaseBinding` aynı kimlik + sürümle basılmış BAŞKA HAK'ı reddeder (`KIRA_HAK_UYUSMAZ`) |
| `iptalSira?` (v2, K2 önlemi) | int ≥ 1 | satıcının yanıtla dağıttığı iptal belgesinin sırası: elde daha düşük sıralı belge varsa (`isRevocationCurrent` false) fabrika `IPTAL_BELGESI_KAYIP` merdivenine girer — yanıttan `iptal` ayıklamak görünür olur |
| `modulAnahtarlari?` | `[{modul, surum, kid: mk-…22, sarma: {v:1, modul, epk, sarili}}]` ≤ 32, kid tekrarsız | Faz 2d: HAK'taki, dondurulmamış modüllerin şifreli paket anahtarları, kurulumun X25519'una sarılı (geçici X25519 → HKDF-SHA256, bilgi = önek ␟ modül → AES-256-GCM); X25519 bilinmiyorsa ya da hak yoksa alan YOK. Açma yalnız çekirdekte, doğrulanmış kira + HAK'la (`unwrapLeaseModuleKey`) |

### SERTİFİKA (`tekserp-sertifika`) — KÖK imzalı

`sertifikaId` (uuid) · `kullanim` (`ALT` · `INDIRME` · `BAYI` · v2 `HAK`) · `kid` (öneki kullanıma bağlı: `alt-` · `ind-` · `bayi-` · `ara-`) · `x` (açık anahtar) · `siniflar` (≥ 1, tekrarsız) · `baslangic`, `bitis` (ISO, `bitis > baslangic`) · `bayi` (`{bayiId, moduller[]}` yalnız `BAYI`'da, diğerlerinde `null`).

### İPTAL (`tekserp-iptal`, v2) — yalnız KÖK imzalı

`iptalId` (uuid) · `sira` (int ≥ 1, tekdüze artar) · `verilis` (ISO) · `iptaller[≤256]: {kid, sertifikaId, kullanim, tarih, neden ≤200}` (kid öneki kullanıma bağlı; sertifika kimliği tekrarsız). Bağlayıcı boyut sınırı 32 KB JWS'tir: 256 satır şemanın tavanıdır, sığan satır sayısı `neden` uzunluğuna göre ≈ 50–150 (48 satır + kısa neden ölçüldü, `test_lisans_protokol` §11e2) — tören imzalarken ölçer. Seçim: yüksek `sira` kazanır, eşit ya da düşük sıralı gelen yok sayılır (`pickNewerRevocation` — mevcut kalır, çırpınmaz). Fabrika belgeyi `LICENSE_DIR/iptal.jws` + DB izinde, sırayı durum kaydında pinler (L2-7).

### İSTEK (`tekserp-istek`) — KURULUM imzalı

`kurulumId` · `zaman` (ISO) · `nonce` (base64url 22–64) · `amac` (`etkinlestir` · `yokla` · `zil` · `cevrimdisi` · `destek` · `esitle` · `tasima` · `dr-devral` · v2 `donanim`) · `govdeOzeti` (sha256, base64url 43) · v2 `yol?` (`/v1/<parça>[/<parça>…]`, en çok dört parça).

- **Yol bağı (v2, G4 §2.5):** `signRequest({path})` isteğin gittiği ucu imzaya koyar; `verifyRequest({path})` imzalı `yol` taşıyan isteği yalnız o uçta kabul eder (`ISTEK_YOL`). Doğrulayan yolu `ENDPOINTS`/`SYNC_PATHS` SABİTİNDEN verir (vekil, bağlama öneki ve sorgu dizgesinden bağımsız). Zarfla taşınan istekte (QR, panel aktarması) yol TAŞIYAN uçtur: `/v1/cevrimdisi`. `yol` taşımayan (eski) istek denetlenmez; alanın zorunlu olması ayrı karardır.

- **`kurulumId` yalnız `etkinlestir` ve `tasima`da YOK olabilir** (`INSTALLATION_ID_OPTIONAL_PURPOSES`; D14): kimliği henüz bilmeyen makine imzalar. Alan yok · `""` · `null` üçü de "yok"tur (`OptionalInstallationIdSchema` → `undefined`; imzalayan alanı imzaya hiç sokmaz). Başka amaçta kimliksiz istek `BELGE_SEMA` (imzalayan fırlatır). `readRequestIdentity` kimliksiz istekte `installationId: null` döner.
- **Taşınan kimlik HER ZAMAN bağlar:** istek `kurulumId` taşıyorsa `verifyRequest`e verilen kurulumla aynı olmalı — satıcı kurulumu koddan bulmuş ya da hiç bulamamış (`installationId: null`) olsa da (`ISTEK_KURULUM`). Kimliksiz istekte bağ denetimi yoktur; bağ koddadır (etkinleştirme) ya da onaylayan operatördedir (taşıma).

### İNDİRME (`tekserp-indirme`) — İNDİRME imzalı

`kanal` · `yolOneki` (tam olarak `/<kanal>/electron/` ya da `/<kanal>/mobil/`) · `kurulumId` · `exp` (ISO). Doğrulama: `simdi > exp + tol` ⇒ `BELGE_SURESI_DOLDU`; `exp − simdi > 70 dk + tol` ⇒ `INDIRME_OMUR`. Yol: önekin ALTINDA (önekin kendisi değil), `..` · `\` · `//` · `%2e` · `%2f` · `%5c` · `%00` RED.

**Anahtar listesi (L2-8):** doğrulayıcı açık anahtarları `DownloadPublicKey {kid, x, kanallar?, baslangic?, bitis?}` satırlarından alır (CF Worker'da `indirmeListesi.{uretim, hazirlik}`); aynı kid'de İLK satır kazanır. Süre ve ömür denetiminden SONRA: satırın penceresi varsa `baslangic − tol ≤ simdi ≤ bitis + tol` olmalı, yarım ya da biçimsiz pencere kapalıdır ⇒ `INDIRME_PENCERE`; satırın kanal kümesi varsa belgenin `kanal`ı kümede olmalı, küme dizi değilse izin yok ⇒ `INDIRME_KANAL`. Kanal ve pencere taşımayan satır kısıtsızdır (L2-8 öncesi `{kid, x}` biçimi; Worker'da bir sürüm daha tanınır).

### DURUM (`tekserp-durum`) — yerel, KURULUM imzalı, ağa çıkmaz

`kurulumId` · `kiraId` (birikimin ait olduğu kira) · `birikenMs` · `yazildi` · `yuksekSu` · `sonKiraZorlamasi` (bool \| null) · `sonYaptirim` (`{kademe, mesaj, kisitlamaTarihi, donmusModuller[], guncellemeDonuk, devredildi}` \| null — son kullanılabilir kiranın SUNUCU KARARLARI; Faz 1c) · `sira` (her yazımda artar). F1a ekleri (isteğe bağlı: eski kayıt okunur, ilk yazımda dolar): `sonKira {kiraId, verilis}` (kabul edilen son kira — geri alma tespiti) · `sonHak {hakId, surum, sinif, kokTuru: kok·hazirlik}` (HAK pini) · `kapaliMs` (bu kira boyunca kredilenmiş kapalı kalma süresi) · `duvarTutarli` (yazım anında saat tahminle tutarlı mıydı; değilse kapalı süreye kredi vermez) · `saticiSapmaSn` (son `ISTEK_ZAMAN`dan duvar − satıcı, sn \| null). Okuma/yazma 1c'nin (`lib/license/accumulation.ts`, `runtime.ts`); şema ve imza `saat.ts`te.

## 4. İstek taşıma ve doğrulama sırası

- İmzalı istek HTTP başlığında: `X-TKL-Istek: <jws>`. `govdeOzeti` = gövdenin **HAM baytlarının** sha256'sı (`bodyDigest`) (sunucu JSON ayrıştırmadan ÖNCEKİ baytları özetler — `express.json` `verify` kancası ya da `express.raw`). Gövdesiz istek (SSE `GET /v1/zil`) boş dizgenin özetini taşır.
- **Satıcı sırası:** ① `readRequestIdentity` (imzasız) → kimlik varsa kurulum kaydı; **kimliksiz etkinleştirmede kurulum KODDAN** (kod özeti → kurulum), kimliksiz taşıma talebi hiçbir kuruluma OTOMATİK bağlanmaz (`ortam.installationId` bilgidir, kimlik değil — DB kopyası onu taşır; eşleme onaylayan operatörün kararı); etkinleştirme ve taşımada açık anahtar GÖVDEDEN alınır ve `kid = installationKeyId(x)` olmalı ② `verifyRequest` (typ · imza · şema · taşınan `kurulumId`in bağı · izinli amaç · v2 imzalı `yol`un alan uçla eşitliği · ±10 dk · gövde özeti, sabit zamanlı karşılaştırma) ③ **nonce kaydı ATOMİK**: `(kurulum, nonce)` UNIQUE — kimliksiz istekte kurulum koddan bulunan kayıttır, kurulumsuz taşıma talebinde anahtar kimliği (`kid`); saklama = istek `zaman`ı + 10 dk. `NonceLedger` bellek içi karşılığıdır (`installationId` parametresi bu kapsam anahtarıdır).
- **Saat kayması (D4):** `ISTEK_ZAMAN` (±10 dk dışı) yanıtı `details.sunucuSaati` (ISO, satıcının o anki saati) taşır. Bu saat **İMZASIZDIR**: fabrika onunla yalnız sapmayı (duvar − satıcı) ölçer ve isteği **BİR KEZ** düzeltilmiş zamanla (yeni nonce) yeniden imzalar; ikinci `ISTEK_ZAMAN`da durur. Sapma güvenilir saate, yüksek suya, ek süreye ve kademeye GİRMEZ — `SAAT_KAYIK` nedeni (bilgi, geçerliliği değiştirmez) ve yoklamada `saat.saticiSapmaSn` ile raporlanır. Biçimsiz `sunucuSaati` yok sayılır, hata kodu yine okunur.
- **Çevrimdışı / panel aktarma:** `wrapEnvelope(request, body)` → tek base64url metin (`{v, istek, govde}`); `POST /v1/cevrimdisi` gövdesi `{v, zarf}`. Yanıt imzalı belgeler taşıdığından panel/telefon yanıtı taklit edemez.

## 5. Satıcı uçları (`uclar.ts`)

İstek gövdeleri **KATI** (`strictObject`: tanınmayan anahtar ⇒ `GOVDE_GECERSIZ`), yanıt gövdeleri **GEVŞEK** (v:1 içinde yeni bilgi alanı eklenebilir, eski kurulum yok sayar).

| Uç | Amaç | İstek gövdesi | Yanıt |
|---|---|---|---|
| `POST /v1/etkinlestir` | `etkinlestir` | `ActivateRequestSchema` `{v, kod: TKS-XXXX-XXXX-XXXX-XXXX, kurulumId?, acikAnahtar, sifrelemeAnahtari?, parmakIzi, ortam, kabul?}` (`sifrelemeAnahtari` = kurulumun X25519 açık yarısı, Faz 2d; `kabul` = KURULUM imzalı sözleşme kabul belgesi `tekserp-kabul`, Ek-7 — şemada opsiyonel, satıcı kodu TÜKETECEK istekte ZORUNLU tutar → 409 `KABUL_GEREKLI`; KATI gövde → satıcı fabrikadan ÖNCE yayınlanır) — `kurulumId` yok/`""`/`null` = yok (kurulumu kod belirler) | `LicenseResponseSchema` (+ `kurulumId`, `kodTuru`) |
| `POST /v1/yokla` | `yokla` | `PollRequestSchema` (aşağıda) | `LicenseResponseSchema` |
| `GET /v1/zil` (SSE) | `zil` | — | `event: zil` / `data: {konu}`; 25 sn'de bir yorum satırı |
| `POST /v1/cevrimdisi` | zarfın içindeki | `OfflineRequestSchema` `{v, zarf}` | `LicenseResponseSchema` |
| `POST /v1/tasima` | `tasima` | `TransferRequestSchema` `{v, kurulumId?, acikAnahtar, parmakIzi, ortam, gerekce}` — yalnız TALEP, `kod` anahtarı RED (D8) | `TransferResponseSchema` `{v, talepId, durum: BEKLIYOR·ONAYLANDI·REDDEDILDI, lisans: null}` |
| `POST /v1/dr-devral` | `dr-devral` | `DrTakeoverRequestSchema` `{v, anaKurulumId?, gerekce}` — `anaKurulumId` ananın LİSANS kimliğidir (portal/ana `LICENSE_DIR`); DR'nin DB replikası onu taşımaz. Verilmezse (2d kararı) satıcı tesisin TEK etkin ÜRETİM kurulumunu çıkarır; 0 ya da >1 → 409 `DR_ANA_BELIRSIZ` | `LicenseResponseSchema` |
| `POST /v1/donanim` (v2, K8) | `donanim` | `HardwareReportRequestSchema` `{v, parmakIzi, kayip[f1..f5, tekrarsız], gerekce ≤500 \| null}` (KATI) — panelin "Donanım değişikliğini bildir"i; çevrimdışıyken aynı imzalı istek zarfla `/v1/cevrimdisi`ye (yol `/v1/cevrimdisi`) | `HardwareReportResponseSchema` `{v, talepId, durum: BEKLIYOR·ONAYLANDI·REDDEDILDI, lisans: LicenseResponse \| null}` — güçlü etkenler tutuyorsa satıcı yeni kümeyi kendiliğinden öğrenir ve `ONAYLANDI` + yeni kira (yeni küme) döner; tutmuyorsa `BEKLIYOR` (portal onay kuyruğu, onayda zil `lisans`); `lisans` yalnız `ONAYLANDI`da dolu (aksi RED). Taşıma talebi kalıbı: belgedeki "LicenseResponse ya da {talepId, durum}" bu tek zarfın iki hâlidir |
| `POST /v1/destek` | `destek` | `SupportRequestSchema` `{v, talepId, konu ≤200, aciklama ≤5000, acan \| null, panelSurum \| null, ek: {tur: image/png·image/jpeg, veri: base64 ≤1 MB} \| null, saglik, ortam}` — `talepId` fabrikanın YEREL talep kimliğidir: aynı `talepId` ile tekrar gönderim aynı talebi döner (idempotent); büyük ek bu gövdede DEĞİL, `/y/<belirteç>` yükleme bağlantısıyla (3d-1) gider | `SupportResponseSchema` `{v, talepId, talepNo, durum: ACIK·YANITLANDI·KAPANDI}` |

- **`PollRequestSchema`:** `sonKiraId` (kira zinciri) · `hak {hakId, surum} \| null` · `sifrelemeAnahtari?` (kurulumun X25519 açık yarısı — eski kurulum ilk yoklamada üretip bildirir; satıcı yalnız temiz zincirde kaydeder, Faz 2d) · `parmakIzi` · `durum {gecerlilik, nedenler[], kip, hesaplananKademe, uygulananKademe}` · `saat {duvar, guvenilir, bulgu, saticiSapmaSn?}` · `ortam` · `saglik` · `gozlem {reddedilecekIstek, reddedilecekModul}`. `saticiSapmaSn` (tam sayı, ±1e9) = son `ISTEK_ZAMAN`dan ölçülen duvar − satıcı saati (sn); yok = ölçülmedi; bilgidir, kademeye girmez (D4).
- **v2 ekleri (L2-1, OPSİYONEL — `PollRequestSchema` + `ActivateRequestSchema`):** `yetenekler?` (≤ 32, tekrarsız, `[a-z][a-z0-9-]{1,39}` — AÇIK liste: satıcı tanımadığını yok sayar, kapalı enum yeni fabrikayı eski satıcıda 400'e düşürürdü; bilinenler `LICENSE_CAPABILITIES`: `hak-ara` · `odenmis-tarih` · `iptal` · `parmak-izi-v2`, okuyucu `hasCapability`) · `belirsizlik?` `{birikenMs, ilk: ISO \| null}` (süren ÖLÇÜLEMEDİ birikimi, G12) · `durumKaydi?` `{sira \| null, gecerli}` (imzalı durum kaydının sırası — gerileme/sıfırlanma satıcıda görünür) · `parmakIziKayip?` (kayıp etkenler, ≤ 5). Yalnız yoklamada: `hak.ozet?` (HAK compact metninin sha256'sı, `jwsDigest` — satıcı (hakId, sürüm, özet) ile `YABANCI_HAK`ı kesin tespit eder; K2 önlemi). Hepsi KATI nesne; eski satıcı bu anahtarları `GOVDE_GECERSIZ` ile reddeder ⇒ **satıcı fabrikadan ÖNCE** yayınlanır. Allowlist beyanı `test_lisans_yoklama_allowlist` §1e.
- **`kurulumKayitlari` (3d-2, OPSİYONEL):** `kur.ps1`in kurulum kökündeki ekleme-yalnız `kurulum-gecmisi.jsonl` dosyasının son 10 geçerli satırı (`InstallRecordSchema`: `kayitId` · `tur: KURULUM·GERI_ALMA` · `tarih` · `commit` · `paketOzeti` (zip sha256) · `oncekiSurum` · `yeniSurum` · `migrationSayisi` (paketteki migration klasörü sayısı) · `yeniMigrationSayisi` (bu kurulumda DB'ye GERÇEKTEN uygulanan migration sayısı: `[7/9]`de `migrate deploy`ın önünde ve arkasında `_prisma_migrations`tan ölçülen fark, ölçülemezse `null` — paket farkı DEĞİL) · `geriDonus {damga, kod, veri, veriSifreli}` — geri dönüş noktası dosya adı/yol DEĞİL damga olarak gider). Kayıt yoksa alan HİÇ gönderilmez. Satıcı `(kurulum, kayitId)` ile idempotent yazar (`KurulumKaydi.kaynakKayitId`). ⚠️ Eski satıcı KATI şemayla bu anahtarı reddeder ⇒ **satıcı fabrikadan ÖNCE** dağıtılır.
- **`acikModuller` (K10, OPSİYONEL):** yoklama gövdesinde fabrikada AÇIK (bayrak ∧ lisans tavanı) modüllerin DB anahtarları (`finance.enabled` …; `ModuleKeySchema`, ≤ 64, tekil, sıralı). Ad YAPILANDIRMADIR, iş verisi değil (kapalı küme `MODULE_SETTING_KEYS`; kullanıcı/cari/kayıt gitmez). Alan yoksa fabrika bildirmiyor: satıcı satırı DEĞİŞTİRMEZ (önceki bildirim kalır, hiç yoksa portal "bilinmiyor" der); boş liste "hiçbiri açık değil"dir. Satıcı `Kurulum.acikModuller` + `acikModullerZamani` durum kolonlarına yazar (kira verildikten sonra, hata yutulur). ⚠️ Eski satıcı KATI şemayla bu anahtarı reddeder ⇒ **satıcı fabrikadan ÖNCE** dağıtılır.
- **Büyük destek eki (3d-1 arayüzü, bu dilimde BAĞLANMADI):** `POST /v1/destek` gövdesi yalnız küçük eki taşır (≤1 MB görüntü; fabrika paneli ≤700 KB'a sıkıştırır). Büyük ek (log paketi, video, döküm parçası) gövdeye GİRMEZ: yanıt gevşek olduğundan 3d-1 inince satıcı `SupportResponse`a `ekYukleme: {yol: "/y/<belirteç>", bitis, azamiBayt}` ekler; fabrika eki talep kimliğiyle (`talepId`) o bağlantıya `PUT` eder (≤50 MB parçalı, sürdürülebilir; 3d-1 sözleşmesi) ve satıcı yüklemeyi talebin defterine bağlar. Eski fabrika alanı yok sayar — küçük ek yolu değişmez.
- **Yoklama yanıtındaki `destek` (3d-2, OPSİYONEL, gevşek):** kurulumun son 30 günde hareketli ≤20 talebi `{talepId, talepNo, durum, guncellendi, yanitlar[≤50]: {yanitId, metin, zaman}}`; biçimsiz alan kirayı DÜŞÜRMEZ (`readSupportUpdates` yok sayar). Satıcı yanıt yazınca/kapatınca kuruluma zil `destek` çalar → fabrika yoklar.
- **`ortam`:** `platform` (win32·linux·darwin) · `mimari` (x64·arm64) · `isletimSistemi` ≤120 · `nodeSurum` (`vX.Y.Z`) · `uygulamaSurum` · `derlemeTarihi \| null` · `konteyner` · `installationId?` (uuid; fabrika DB'sinin `system.installationId`si — YALNIZ BİLGİ, dökümle/DR replikasıyla kopyalanır, lisans kimliği DEĞİL; D14).
- **Sağlık özeti ALLOWLIST'i (`saglik`):** `surum` · `calismaSn` · `dbBoyutBayt` · `yedek {hukum: ok·uyari·kritik·yapilandirilmamis, yasSaat}` · `offsite {yapilandirildi, ok, eksikSayisi}` · `diskDolulukYuzde` · `auditYazmaHatasi` · `havuzZamanAsimi` · `istemciler [{tur: panel·tablet·web·diger, surum, adet}]` (≤50, kullanıcı adı YOK) · `isHatalari [{is, adet}]` (≤50). Serbest metin alanı bilerek yok: ham hata metni, dosya adı, iş verisi yapısal olarak giremez.
- **`LicenseResponseSchema`:** `{v, hak: JWS \| null (yalnız değiştiyse ya da kurulumda yoksa), kira: JWS, indirmeBelirtecleri: [{yolOneki, belirtec}] (≤4), sunucuSaati, kurulumId?, kodTuru?}`. **`kurulumId`** (uuid) etkinleştirme yanıtında DAİMA dolu: lisans kimliği fabrikaya buradan gelir ve `LICENSE_DIR`e yazılır (D14); OTORİTE imzalı kiradır — yanıttaki değer kiranın `kurulumId`siyle aynı olmalı, ayrışırsa yanıt reddedilir. **`kodTuru`** (`ilk` · `tasima`, `ACTIVATION_CODE_KINDS`) tüketilen kodun türüdür, bilgidir; tanınmayan değer yanıtı düşürmez, yok sayılır. **`iptal?`** (v2) güncel iptal belgesi (`tekserp-iptal`, JWS): fabrika ayrıca `verifyRevocation` ile doğrular; biçimsiz değer yanıtı DÜŞÜRMEZ, yok sayılır (`.catch`) — yanıt kiranın imzası dışındadır, ayıklanması kiranın `iptalSira`sıyla görünür olur.
- **Zil konuları:** `lisans` · `gelen-kutusu` · `ozet` · `rapor` · `guncelleme` · `destek`. İçerik taşımaz; sahte zil yalnız fazladan yoklama yaptırır.
- **Etkinleştirme kodu:** `TKS-XXXX-XXXX-XXXX-XXXX` — 16 karakter Crockford base32 (`I/L/O/U` yok, ≈80 bit), 4'lü tireli gruplar; üretim TEK yerde `generateActivationCode` (yalnız 16 karakter). Eski 12 karakterlik biçim (`TKS-XXXX-XXXX-XXXX`) BİR SÜRÜM daha TANINIR (`ActivationCodeSchema` iki biçimi de kabul eder), üretilmez. `normalizeActivationCode` iki uzunlukta da büyük harf + `O→0`, `I/L→1` + önek/tire yerleşimi yapar (kullanıcının elle yazdığı kod); `TKS` ile başlayan öneksiz 16'lık gövde önek sanılmaz.
- **Kod türü ve taşıma (D8):** `ilk` kod yalnız hiç etkinleşmemiş kurulumu açar; başka bir anahtarla ETKİN kuruluma `ilk` kod ⇒ 409 `TASIMA_KODU_GEREKLI`. Yeni makine `POST /v1/tasima` ile yalnız TALEP açar (kod ya da lisans dönmez); satıcı onayında tek kullanımlık `tasima` türü kod doğar, müşteriye portal üzerinden iletilir ve yeni makine onu normal `POST /v1/etkinlestir` yolundan kullanır (`kodTuru: "tasima"`); eski anahtar emekli olur (sonraki istekleri 403 `KURULUM_IPTAL`). Kod türü kodun metninde değil satıcının kaydındadır.

**Hata gövdesi** (backend ile aynı): `{success: false, message: <TR>, details: {code, sunucuSaati?}}`. `details.code` ∈ satıcı kodları ya da protokol doğrulama kodları (aşağıda); `details.sunucuSaati` (ISO) `ISTEK_ZAMAN`da satıcının saatidir (§4 saat kayması), imzasızdır.

| `details.code` | HTTP | Ne zaman |
|---|---|---|
| `GOVDE_GECERSIZ` | 400 | gövde şemaya uymuyor / allowlist dışı anahtar |
| `PROTOKOL_SURUMU` | 400 | desteklenmeyen `v` |
| `ISTEK_GECERSIZ` ya da protokol kodu (`ISTEK_ZAMAN`, `ISTEK_GOVDE_OZETI`, `ISTEK_KID`, `ISTEK_AMAC`, `ISTEK_KURULUM`, `JWS_*`) | 401 | imzalı istek doğrulanamadı; `ISTEK_ZAMAN` + `details.sunucuSaati` |
| `ISTEK_TEKRAR` | 409 | nonce daha önce görüldü |
| `KURULUM_BILINMIYOR` | 401 | kurulum kaydı yok |
| `KURULUM_IPTAL` | 403 | taşındı/iptal; kira verilmez |
| `ETKINLESTIRME_KODU_GECERSIZ` / `_KULLANILMIS` | 404 / 409 | kod yok / atomik claim kaybedildi |
| `TASIMA_ONAYI_BEKLIYOR` | 409 | ikinci anahtar onay bekliyor (kurulum ek sürede çalışır) |
| `TASIMA_KODU_GEREKLI` | 409 | kurulum başka anahtarla ETKİN — yeni makine yalnız onaylı taşıma koduyla etkinleşir, `ilk` kod yetmez (D8) |
| `KABUL_GEREKLI` | 409 | kodu tüketecek etkinleştirme geçerli bir sözleşme kabul belgesi taşımıyor (Ek-7 §5) — `details.neden`: `YOK` · `IMZA` (gövdenin anahtarıyla doğrulanmadı/başka typ) · `SEMA` · `METIN` (kimlik + özet katalogda yok) · `KUTU` (metnin kutuları eksik/fazla); ucuz ön denetim: kod ve nonce tüketilmez; tüketilmiş kodun ağ tekrarı kabul istemez; çevrimdışı zarf da aynı kapıdan |
| `KIRA_VERILMEDI` | 403 | kopya şüphesinin ikinci penceresi (v2'de yerini imzalı kapanış kirası alır — K6; kod kalır, kaldırmak kırıcıdır) |
| `ZAYIF_TANIMA_ONAY_BEKLIYOR` (v2) | 409 | etkinleştirmede okunabilen etken < 3 ya da okunabilen güçlü etken < 2 (`assessIdentification`, K8) — portal onayı bekler; ucuz ön denetim: kod ve nonce TÜKETİLMEZ, onaydan sonra aynı kodla yeniden denenir |
| `DR_ANA_BELIRSIZ` | 409 | kimliksiz DR devralımında tesiste tek etkin ÜRETİM kurulumu yok (0 ya da birden çok) — ana kimliği portaldan/ana Lisans ekranından verilir |
| `HIZ_SINIRI` | 429 | istemci IP'si başına ya da (imza doğrulandıktan sonra) kurulum başına dakikalık sınır aşıldı (`Retry-After`); vekil başlığı yalnız güvenilen kenardan okunur |
| `TEKRAR_DENEYIN` | 409 | eşzamanlı işlem çakıştı (PG 40001/40P01, atomik claim kaybı) — AYNI istek yeniden denenebilir |
| `BULUNAMADI` | 404 | satıcıda böyle bir yol yok (adres yanlış ya da satıcı sürümü eski); portal uçlarının "kayıt yok" 404'ü de bu kodu taşır |
| `SUNUCU_HATASI` | 500 | 503 kullanılmaz |

**Yoklama başarısı tanımı (1c için bağlayıcı):** *başarılı yoklama = geçerli YENİ bir kira alındı.* Ağ hatası, 4xx/5xx, yanıt belgesinin yerelde doğrulanamaması ve `KIRA_VERILMEDI` başarısızdır. Zamanın getirdiği kısıtlamanın ikinci anahtarı yoklama sinyali DEĞİL, imzalı kiradan türeyen "son 24 saatte başarılı kira alışverişi yok"tur (§7 kural 4, lisans v2 K3); kira dosyasının yokluğu tek başına yoklama başarısızlığı DEĞİLDİR (D3, F1a); etkinleşmiş sayılan (lisans kimliği ∧ (HAK ∨ kira ∨ geçerli durum kaydı) ∨ bekleyen taşıma) kurulum kira dosyası yokken de yoklar.

## 6. Parmak izi (`parmak-izi.ts`)

- **Etkenler (yönetici kararı 3, Faz 1c):** f1 OS makine kimliği (Win `MachineGuid` · Linux `/etc/machine-id` · mac `IOPlatformUUID`) · f2 SMBIOS UUID · f3 sistem diski kimliği (Win `Get-Disk` `UniqueId` → yoksa `SerialNumber`; NVMe/SATA normalize seri; RAID/sanal birimin genel `VolumeN` serisi = ölçülemedi) · f4 sistem/anakart seri numarası (Win `Win32_BIOS.SerialNumber` → yer tutucuysa `Win32_BaseBoard.SerialNumber`; Linux `product_serial` → `board_serial`, root-only) · f5 PostgreSQL `system_identifier`. **MAC YOK** (kullanıcı kararı), CPU kimliği YOK (makineye özgü değil). `Get-PhysicalDisk` ve `Get-NetAdapter -IncludeHidden` kullanılmaz (asılma ölçüldü). Toplayıcı `lib/license/fingerprint.ts` (tek PowerShell süreci, 20 sn zaman aşımı).
- **Normalleştirme:** NFKC → yalnız harf/rakam → küçük harf. Boş, tek düze (`0000…`, `ffff…`) ve bilinen yer tutucular (`To Be Filled By O.E.M.`, `Default string`, `None`…) ⇒ **ölçülemedi** (`null`). f1/f2 16–64 hex · f3 ≥ 4 karakter ve `volume\d*` DEĞİL · f4 ≥ 4 karakter (yer tutucu `System Serial Number`, `Default string`, `To Be Filled By O.E.M.`… ölçülemedi) · f5 1–20 rakam.
- **Özet:** `HMAC-SHA256(kurulum tuzu ≥ 16 bayt, "<etken>\x1f<değer>")`, base64url. Ham kimlik dışarı çıkmaz; alan öneki aynı değerin iki etkende çakışmasını önler; tuz kurulum başınadır (`LICENSE_DIR`'de, 1c).
- **Karar — üç sonuç, kurala göre (`compareFingerprints(kabul, ölçülen, {excludeF5, rule})`):** kural kiranın `parmakIziKurali`ndan gelir; DR sınıfında f5 dışarıda (`f5Haric`). Dönen karar `{result, rule, measurable, matched, mismatched, unmeasured, lost, strongMatched}`.
  - **v1 (kural yok — eski kira, bugünkü davranış AYNEN):** iki tarafta da ölçülebilen etken sayısı `n` (bir tarafta `null` olan paydadan çıkar, uyuşmazlık SAYILMAZ). `n < 2` ⇒ `OLCULEMEDI`; aksi hâlde eşleşen ≥ `min(3, n)` ⇒ `ESLESTI`, değilse `ESLESMEDI`.
  - **`standart` (v2, K8):** kabul kümesinde değeri olan etken ölçülemiyorsa **KAYIP**tır (toplayıcı son başarılı okumanın özetini 24 saate dek kullanır — `FINGERPRINT_LOSS_AFTER_MS`; L2-10): `lost` listesine ve `mismatched`a girer — uyuşmazlıktır ama tek başına iptal değildir. Kabul kümesinde `null` olan etken karşılaştırılmaz. `ESLESTI` ⇔ eşleşen ≥ 3 ∧ güçlü etkenlerden (f2 · f3 · f4 — `STRONG_FINGERPRINT_FACTORS`; f1 ve f5'i VM/disk kopyası taşır) eşleşen ≥ 2; değilse `ESLESMEDI` (v2'de bu kuralda `OLCULEMEDI` yok — hiçbir etken okunamazsa da RED).
  - **`zayif` (satıcı onaylı zayıf tanıma):** güçlü şartı yok; `n` = kabul kümesinde değeri olan etken sayısı, eşleşen ≥ `min(3, n)` ⇒ `ESLESTI`; kayıp yine uyuşmazlık. `n = 0` (bağsız küme) ⇒ `OLCULEMEDI` (fail-closed; eşleşti sayılmaz).
- **Zayıf tanıma (v2, K8):** `assessIdentification(küme, {excludeF5})` → `{readable, strongReadable, weak}`; okunabilen < 3 ya da okunabilen güçlü < 2 ⇒ zayıf (standart kural bu kümeyle hiç sağlanamaz). Satıcı etkinleştirmede `ZAYIF_TANIMA_ONAY_BEKLIYOR` (409) döner; onaydan sonra kira `parmakIziKurali: "zayif"` taşır.
- **Öğrenme (v2, K8):** `canAutoLearnFingerprint(kabul, ölçülen)` ⇔ güçlülerden eşleşen ≥ 2 — satıcı yeni kümeyi onaysız öğrenir (yeni kira yeni kümeyi taşır); değilse portal onayı.

## 7. Lisans durumu (`state.ts` — fabrika tarafı, SAF)

**Girdi** (`LicenseStateInput`, 1c doldurur): `kurulumId` (lisans kimliği, `LICENSE_DIR`'den; etkinleşmemişte `null` — DB `installationId`si DEĞİL, D14) · `kurulumAnahtarKimligi` · `hak`, `kira` (`DocResult`: `YOK` · `OKUNAMADI` (dosya var ama okunamadı — F1a) · `GECERSIZ(kod)` · `GECERLI(değer)` — `verifyLicenseDocuments` ile üretilir) · `saat {duvarMs, yuksekSuMs, monotonik: {kiraId, gecenMs} \| null, durumDosyasiGecerli, kapaliKrediMs?}` · `parmakIziEslesme` · `butunluk` (`GECERLI` · `GECERSIZ` · `OLCULEMEDI` · `KAPSAM_DISI` — Faz 1'de `KAPSAM_DISI`) · `derlemeTarihiMs` · `ilkAcilisMs` (**DB'den** türer — dosya silmekle yenilenmez) · `varsayilanKip` (derleme) · `sonKiraZorlamasi` · `sonYaptirim` (`durum.json`'dan). F1a (isteğe bağlı): `sonKira {kiraId, verilisMs}` (geri alma + kira yokken son alışveriş zamanı) · `sonHak` (pin) · `saticiSapmaMs` (D4, bilgi) · `depoOkunamadi` (okunamayan dosya adları).

**Çıktı** (`LicenseState`): `gecerlilik` (GECERLI · GECERSIZ · OLCULEMEDI) · `nedenler[{kod, ayrinti}]` · `kip` · **`hesaplananKademe` ↔ `uygulananKademe`** · **`hesaplanan` ↔ `uygulanan`** etki (`bant {metin, ton}`, `guncellemeIzni`, `modulTavani`) · `ekSureKalanGun` · `kisitlamaKalanGun` · `devredildi` · `yaptirimKademesi` · `saat` · `odenmisTarih` (v2 P: `{tarihMs \| null, kaynak ODEME·UFUK·SURESIZ, sozlesmeSonu}`; `null` = eski çapa) · `baglanti` (`{sonAlisverisMs, internetVar, uzunSureCevrimdisi}`). Modül okuyucusu: `readX = readXRaw ∧ isModuleLicensed(durum, anahtar)`.

**Kurallar** (her biri bekçide pozitif + karşı kontrolle):

1. **Kullanılabilir belge.** HAK: `GECERLI` ve `kurulumId` yerelle eşit. Kira: `GECERLI`, `kurulumId` ve `kurulumAnahtarKimligi` yerelle eşit, HAK kullanılabilirse ona bağlı (`checkLeaseBinding`). HAK bozuk olsa da kuruluma bağlı kira kullanılır (imzalı zaman çapası + sunucu kararı taşır). **Geri alma (D2, F1a):** durum kaydının son kabulünden (`sonKira`) ESKİ kira ya da HAK pini (`sonHak`: başka HAK · eski sürüm · başka sınıf · başka kök türü) ters düşüyorsa kira kullanılmaz — `KIRA_GERI_ALINDI` (ÖLÇÜLEMEDİ); kayıt yoksa denetim yoktur (kira + kayıt birlikte geri alma §11). **Okunamayan dosya (D1, F1a):** `DEPO_OKUNAMADI` (ÖLÇÜLEMEDİ); `YOK` sayılmaz (`HAK_YOK`/`KIRA_YOK` yazılmaz).
2. **Geçerlilik:** GEÇERSİZ nedeni (HAK/kira yok·bozuk·bağ uyuşmaz, parmak izi uyuşmaz, bütünlük uyuşmaz) ÖLÇÜLEMEDİ nedenini (saat ileri/geri, durum kaydı, parmak izi/bütünlük ölçülemedi, ilk açılış bilinmiyor) ezer. GEÇERLİ olmayan her durum en az `UYARI`.
3. **Ek süre İMZALI tarihten türer** — çapa sırası: kullanılabilir kira VE ona bağlı HAK v2 alanlarını (`odenmisTarih` · `cevrimdisiUfukGun`) taşıyorsa ödenmiş tarih P = min(`odenmisTarih`, kira verilişi + ufuk; ufuk sınıf/imzacı tavanıyla kırpılır) + `ekSureGun` (`ODENMIS_TARIH_DOLDU`; kira bitişi yalnız tazelik; P − 30 gün ≤ T < P ⇒ `ODEME_YAKLASIYOR` BİLGİ bandı, yalnız son başarılı alışveriş 7 günden eskiyken ya da P sözleşme sonuyken — `odenmisTarih` ≥ `gecerlilikBitis`; ek v2 belgesi §1) · kullanılabilir kira ⇒ `min(bitis, gecerlilikBitis)` + `ekSureGun` · kira yok/bozuk ama HAK var ⇒ `hak.verilis` + 30 · ikisi de yok ⇒ `ilkAcilis` + 30 · o da yok ⇒ ÖLÇÜLEMEDİ (kısıtlama yok). Dosya silmek ek süreyi yenilemez, K4'ü kaldırmaz.
4. **Zamanın getirdiği KISITLI iki anahtarlıdır:** çapa + ek süre geçmiş VE son 24 saatte başarılı kira alışverişi YOK (K3: son kabul edilen imzalı kiranın `sunucuSaati` — kira yoksa durum kaydının `sonKira`sı — güvenilir saate göre 24 saatten eski; QR ya da dosyayla gelen kira da sayılır, bellekteki yoklama sinyali sayılmaz; adresi kapalı, internetsiz ve etkinleşmemiş kurulum da merdivene girer). İnternet varsa `EK_SURE` (0 gün) + `EK_SURE_BITTI` nedeni — kademeyi yalnız sunucu düşürür. Aynı kural bakım ihlaline ve bütünlük uyuşmazlığına da uygulanır.
5. **Sunucunun imzalı kararı tek anahtarlıdır ve KALICIDIR (yönetici kararı 2):** K3 tarihi geçti · K4 ⇒ `KISITLI`; K5 ⇒ `DURDURULMUS`; `devredildi` ⇒ `KISITLI` + tehlike bandı. K0 ⇒ `NORMAL` + bilgi bandı (mesaj). K1 ya da `guncellemeDonuk` ⇒ güncelleme kesilir. `donmusModuller` (K2) ⇒ tavandan düşer. K3 tarihinden önce ⇒ `UYARI` + geri sayım. Kararların kaynağı kullanılabilir kira; kira silinmiş/bozuk/okunamıyor/bağı kopuk ya da geri alınmışsa son kullanılabilir kiranın `durum.json`daki anlık görüntüsü (`sonYaptirim`) — silmek, eskisiyle değiştirmek ya da okunamaz kılmak yaptırımı kaldırmaz. Ek süre ve belirsizlik bu kararları GEVŞETMEZ.
6. **Bakım:** bakım içinde derlenmiş sürüm durmaz (bakım bitince yalnız güncelleme kesilir, `BAKIM_BITTI`); bakım SONRASI derlenmiş sürüm ⇒ derleme tarihinden 30 gün `EK_SURE`, sonra (iki anahtarla) `KISITLI`. Bakıma ≤ 30 gün ⇒ `BAKIM_BITIYOR` bilgisi. Derleme tarihi yoksa değerlendirilmez (`DERLEME_TARIHI_YOK` bilgisi).
7. **Modül tavanı iki bileşenlidir (yönetici kararı 2):** HAK tavanı (`allowed = hak.moduller`) yalnız kullanılabilir HAK varken VE geçerlilik ÖLÇÜLEMEDİ değilken uygulanır — fail-open YALNIZ BELİRSİZLİKTE (ölçülemedi · etkinleşmemiş · HAK yok/bozuk); ek süre belirsizlik DEĞİLDİR, HAK tavanı sürer. Dondurulan modüller (`denied = donmusModuller`, sunucu kararı) her hâlde kapalıdır — ek sürede, ölçülemedide, HAK bozukken de. `ModuleCeiling = {applies:false} | {applies:true, allowed: string[] | null, denied: string[]}`; `ceilingAllows = (allowed yok ∨ key ∈ allowed) ∧ key ∉ denied`. `production` satır yokken TRUE okunduğu için belirsizlik üretimi kapatmaz.
8. **Kip:** kullanılabilir (geri alınmamış) kira ⇒ `kira.zorlama`; değilse `sonKiraZorlamasi` (silinen ya da eskisiyle değiştirilen kira kipi gevşetmesin); o da yoksa derleme varsayılanı.
9. **Gözlem kipinde** her şey hesaplanır (`hesaplanan*`) ama **uygulanan** etki bugünkü davranıştır: kademe `NORMAL`, bant yok, güncelleme serbest, tavan yok (`OBSERVE_EFFECT`, sıfır fark).
10. **Bant** en şiddetli bulgunun bandıdır (eşitlikte ilk yazılan).

## 8. Saat modeli (`saat.ts`)

- **Tahmin** = kira `sunucuSaati` + son kiradan beri BİRİKEN monotonik süre (`process.hrtime`; makine kapalıyken birikmez ⇒ gerçek zamanın ALT sınırı). Birikim imzalı `durum.json`'da, kiraya bağlı (`kiraId`); başka kiranınki okunmaz.
- **Üst eşik** = tahmin + kapalı süre kredisi + yoklama aralığı + tolerans. **Kapalı süre kredisi (F1a):** makine kapalıyken monotonik birikmez; tutarlı saatle (`duvarTutarli`) yazılmış son durum kaydından yüklemeye dek duvarla gözlenen süre (+ kaydın biriktirdiği `kapaliMs`) üst eşiği genişletir — hafta sonu kapanan makine sahte `SAAT_ILERI` görmez. Kredi alt sınıra GİRMEZ (tahmin alt sınır kalır); tutarsız saatle yazılmış kayıt kredi vermez (açıkken ileri kaçmış saat kapanışa taşınamaz). **Yüksek su** = hiç geri gitmeyen iz (son kira sunucu saati ∨ defterlerdeki en büyük `createdAt`).
- Monotonik ölçülebiliyorken: yüksek su üst eşiği aşıyorsa alt sınır olarak **hiç kullanılmaz** (geçmişte ileri giden bir saatin zehirlediği iz; `SAAT_ILERI`/`YUKSEK_SU` raporlanır); duvar < alt sınır − tol ⇒ `SAAT_GERI`, güvenilir = alt sınır; duvar > üst eşik ⇒ `SAAT_ILERI`, güvenilir = alt sınır (**erken bitiş YOK**); aksi hâlde güvenilir = max(duvar, alt sınır).
- Monotonik yokken (dosya yok/bozuk/başka kira): `DURUM_DOSYASI` (ÖLÇÜLEMEDİ) + güvenilir = max(duvar, yüksek su); duvar < yüksek su − tol ⇒ `SAAT_GERI`.
- `accumulatedRuntime({storedMs, loadHrNs, nowHrNs})`: hrtime geri gitmiş görünürse birikim küçülmez.
- **`SAAT_KAYIK` (D4, neden listesinde, `REASON_VALIDITY` = `null`):** satıcı `ISTEK_ZAMAN` ile duvar saatinin ±10 dk'dan fazla kaydığını söyledi. BİLGİdir: imzasız satıcı saati ne güvenilir saate ne yüksek suya girer; geçerlilik ve kademe saat kaymasından DÜŞMEZ (güvenilir saatin kaynakları yukarıdakilerdir). Saat bulgusu (`SAAT_ILERI`/`SAAT_GERI`, ÖLÇÜLEMEDİ) ayrı kalır.

## 9. Sürümleme kuralı (`v`)

- Her belge ve her istek gövdesi `v` taşır; bugün yalnız `1`.
- **v:1 içinde** yalnız YOK SAYILABİLİR (bilgi) alan eklenir ve `.optional()` doğar; doğrulayıcı tanımadığı alanı ATAR (imzalanan da şemanın çıktısıdır — imzalayan tanınmayan alanı imzaya sokmaz).
- Anlamı daraltan/kısıtlayan her değişiklik (yeni zorunlu alan, yeni kısıt, alanın anlam değişimi) **`v`yi artırır**. Doğrulayıcı bilmediği `v`yi `BELGE_SURUM` ile reddeder — şema hatasından ayrı kodlanır ki portal onu saldırı değil yükseltme sinyali olarak görsün.
- **Sunucu, yanıt belgelerini isteğin `v`siyle üretir** ve N-1'i destekler; kurulum yeni `v`ye sürümüyle geçer.
- Satıcı hata kodu ya da zil konusu EKLEMEK kırıcı değildir (eski kurulum bilinmeyeni genel hata sayar); KALDIRMAK kırıcıdır.

## 10. Protokol hata kodları (`PROTOCOL_ERROR_CODES`)

| Kod | Anlam |
|---|---|
| `JWS_BICIM` | parça sayısı, base64url, JSON, imza uzunluğu, belge boyu |
| `JWS_BASLIK` | allowlist dışı başlık alanı |
| `JWS_ALG` | `EdDSA` dışı alg (`none`, `HS256`…) |
| `JWS_TYP` | typ yok/biçimsiz/beklenenden farklı |
| `JWS_KID` | kid yok/biçimsiz/bilinmez (genel doğrulayıcı) |
| `JWS_IMZA` | imza doğrulanmadı |
| `BELGE_SEMA` · `BELGE_SURUM` | şema uymuyor · bilinmeyen `v` |
| `BELGE_SURESI_DOLDU` | İNDİRME belirtecinin süresi doldu (tolerans dahil) |
| `GUVEN_CAPASI_BOS` · `GUVEN_CAPASI_BICIM` | çapa boş · çapa biçimsiz/hazırlık kökü TEST/DEMO dışında |
| `KOK_BILINMIYOR` · `KOK_SINIF_YETKISIZ` | imzalayan kök çapada yok · kök/sertifika o sınıfa yetkisiz |
| `SERTIFIKA_KULLANIM` · `SERTIFIKA_ZAMAN` | yanlış kullanım · imza anında geçersiz |
| `BAYI_KIMLIK` · `BAYI_TAVAN_MODUL` · `BAYI_TAVAN_SINIF` | bayi kimliği/anahtarı uyuşmaz · tavan dışı modül · tavan dışı sınıf |
| `KIRA_HAK_UYUSMAZ` · `KIRA_SINIF_YETKISIZ` | kira başka HAK/sürüm/kuruluma ait · alt anahtar HAK sınıfına yetkisiz |
| `INDIRME_OMUR` · `INDIRME_YOL` | belirteç ömrü uzun · yol dışı (yol kararı `isDownloadPathAllowed` boolean'ı) |
| `INDIRME_PENCERE` · `INDIRME_KANAL` (v2, L2-8) | imzalayan kid'in liste satırı şu an pencere dışı · belgenin kanalı satırın kanal kümesinde değil |
| `ISTEK_KID` · `ISTEK_AMAC` · `ISTEK_ZAMAN` · `ISTEK_KURULUM` · `ISTEK_GOVDE_OZETI` · `ISTEK_TEKRAR` | istek doğrulama adımları |
| `ISTEK_YOL` (v2) | imzalı `yol` isteği alan uçla eşit değil |
| `SERTIFIKA_IPTAL` (v2) | sertifika (ya da anahtarı) iptal belgesinde |
| `BELGE_ILERI_TARIHLI` (v2) | HAK'ın verilişi doğrulayanın "şimdi"sinden toleranstan fazla ileride (ya da şimdi sonlu değil) |
| `UFUK_TAVANI_ASIMI` (v2) | HAK'ın çevrimdışı ufku sınıf/imzacı tavanını aşıyor |
| `IMZACI_KIMLIK` (v2) | kök imzalı HAK ara sertifikası taşıyor ya da HAK'ı imzalayan kid gömülü ara sertifikanınki değil |
| `ZARF_BICIM` | çevrimdışı zarf çözülemedi |

## 11. Bilinen sınırlar (kabul edilen risk, plan §12 ile uyumlu)

- **Çevrimdışı saat hilesi:** `durum.json`'u geri yüklemek ya da silip saati geri almak, monotonik tahmini geriye çeker; "erken bitiş yok" ilkesi gereği güvenilir saat tahmine yaslanır ⇒ çevrimdışı zarf uzayabilir. Çevrimiçiyken kira zinciri ve sunucu kararı kapatır; kalıcı savunma Faz 2 (native çekirdek, DPAPI/sayaç). `sira` alanı geri yüklemeyi portal raporunda görünür kılar.
- **Kira silme + `durum.json` silme** birlikte yapılırsa kip derleme varsayılanına düşer (Faz 4'e dek `gozlem`). Faz 1–3'te sahadaki kod zaten okunur JS'tir (plan §12).
- **K2 ve ek süre — KARAR VERİLDİ (yönetici kararı 2, Faz 1c):** dondurulan modül ek sürede de, belirsizlikte de kapalı kalır; HAK tavanı ek sürede sürer (kural 7). Kalan kaçış: kira + `durum.json` BİRLİKTE silinirse son kira kararı da kaybolur — kira silme + durum silme ile aynı sınıf (Faz 2 native çekirdek).
- İmza doğrulaması TS'tedir; Faz 2'de native çekirdeğe geçer, bu dosyalar test kâhini kalır.
- **v2 — çalınan ara imzacı (K2, bilinçli kabul):** ara imzacı süresiz ufuklu ÜRETİM/DR HAK'ı basabilir; iptal internetsiz kuruluma ulaşmaz. Önlemler: sınıf tavanı (kriptografik) · `YABANCI_HAK` (yoklamadaki `hak.ozet` ile kesin) · kiranın `hakOzeti` bağı (çevrimiçi kurulumda aynı kimlikli sahte HAK yeni kiraya bağlanmaz) · kiranın `iptalSira`sı (yanıttan iptal ayıklamak merdivene girer) · 120 g sertifika ömrü + portalda ikinci onay. Kalan risk: internetsiz kuruluma basılmış süresiz sahte HAK.
- **v2 — iptal belgesinin boyutu:** şema 256 satır kabul eder, bağlayıcı sınır 32 KB JWS'tir (§3 İPTAL); dolarsa tören imzada durur (programcı hatası, fırlatır) — sessiz kayıp yok.

## 12. Plandan sapmalar ve genişlemeler (bu dilimde yapıldı — gözden geçirilecek)

1. **Nonce saklama süresi:** plan "15 dk" diyor; ±10 dk zaman toleransı geçerli pencereyi **20 dk** yapar (+10 dk ileri damgalı istek 19. dakikada hâlâ zaman denetiminden geçer). Uygulanan: istek `zaman`ı + 10 dk (kesin). Bekçi §3n.
2. **Uç ve amaç genişlemesi:** `tasima` ve `dr-devral` amaçları + `POST /v1/tasima`, `POST /v1/dr-devral` eklendi — fabrikanın `tasima-talebi`/`dr-devral` uçlarının satıcıda karşılığı yoktu; taşımada yeni anahtar kayıtlı olmadığı için imzalı istek gövdedeki anahtarla doğrulanmak zorunda.
3. **Belge ek alanları:** HAK `verilis` (sertifika zaman denetimi + kirasız ek süre çapası); KİRA `devredildi` (plan "DEVREDİLDİ alır" diyor ama taşıyıcı alanı tanımlamıyordu — imzalı olmalı); sertifikalara `siniflar` (hazırlık kökünün alt anahtarı üretim kurulumuna kira veremesin); yerel `durum.json` için `tekserp-durum` türü.
4. **Kira ömür tavanı 45 gün, ek süre 0–60 gün** (plan 30 gün kira / 30 gün ek süre diyor; tavan sızmış alt anahtarla geriye tarihli uzun kira basmayı sınırlar).
5. **Durum girdisi biçimi:** görev tanımındaki `hak?, kira?, dogrulamaSonuclari` üçlüsü tek ayrık birleşimde (`DocResult`) toplandı — belge ile doğrulama sonucunun tutarsız verilmesi tip düzeyinde imkânsız. görevdeki `monotonikGecen?` girdisi `monotonik: {kiraId, gecenMs}` oldu (başka kiranın birikimi okunmasın). Ek girdiler: `installationKeyId`, `ilkAcilisMs`, `sonKiraZorlamasi`.
6. **Kira YOK/bozuk ama HAK varken çapa `hak.verilis`** (plan yalnız kira ve ilk açılışı sayıyor): silme kaçışını kapatır, imzalı tarihten türer.
7. **Yüksek su zehirlenmesi:** plan yüksek suyu doğrudan alt sınır sayıyor; tahminin üst eşiğini aşan yüksek su yok sayılır ve raporlanır (aksi hâlde geçmişte bir kez ileri giden saat fabrikayı kalıcı ek süreye iterdi — bekçi §5e bu kusuru yazım sırasında yakaladı).
8. **Adlandırma:** plan ve görev metni kod adlarını Türkçe veriyor (`KOK_ACIK_ANAHTARLAR`, `lisansModuluAcik`…); `src/` bildirim adları `[IL-16]`/`[IL-32]` gereği İngilizce yazıldı (bekçi `test_identifier_language` ilk Türkçe yazımda 115 yeni ad saydı). Karşılıklar 12a tablosunda; tel alanları ve değerler Türkçe.
9. **Karar verildi (yönetici kararı 2, Faz 1c):** sunucu kararları (K1–K5, dondurulan modül, DEVREDİLDİ) son geçerli imzalı kiradan KALICIDIR; ek süre gevşetmez; tavanın fail-open'ı yalnız belirsizlik içindir. Uygulama: `state.ts` `computeEffect` + `sanctionSource`, `saat.ts` `sonYaptirim`; bekçi `test_lisans_durumu` §3b/§7d/§14.
10. **Parmak izi f3/f4 (yönetici kararı 3, Faz 1c):** f4 MAC değil sistem/anakart seri numarası; f3 genel RAID serisi ölçülemedi. `parmak-izi.ts` normalleştirmesi değişti — satıcı aynası (1b) bu dosyayı yeniden kopyalar (özet biçimi aynı; yalnız f3/f4 normalleştirmesi).
11. **Kapı listeleri (Faz 1c-kapı):** plan listesine iki ek — `GET /api/client-policy/*` her kademede (panelin sürüm kurtarması, tablet OTA ile aynı sınıf) ve `GET /api/auth/me` DURDURULMUŞ'ta ("verilerimi al" ekranı oturum izinlerini çözer); etiket içeriği dondurma (`seed-snapshot`) baskı sayılmadı, kapalı. `LICENSE_MODULE.modul` DB anahtarıdır (HAK sözlüğü), `MODULE_DISABLED.modul` kısa koddur.
12. **Satıcı hata kodları `TEKRAR_DENEYIN` · `BULUNAMADI` (satıcı tamamlama):** eşzamanlılık çakışması önce `SUNUCU_HATASI` (409) ile, bilinmeyen yol protokol DIŞI bir portal koduyla dönüyordu — biri "sunucu arızası"yla karışıyor, öteki tek kaynak dışındaydı. İkisi `VENDOR_ERROR_CODES`e eklendi (kod EKLEMEK kırıcı değil, §9); portal kod listesi protokolle kesişmez (bekçi `test_satici_kapilari` §8).
13. **Hazırlık dilimi:** güven çapasına hazırlık kökü `hazirlik-2026-1` (TEST/DEMO) girdi — plan hazırlık kökünü öngörüyordu, çapanın dolu doğması bu dilimde; bekçi §0' çapanın KENDİ satırıyla ÜRETİM'i reddettiğini ölçer. Satıcı adresi varsayılanı (`LICENSE_SERVER_URL` verilmezse üretim satıcısı) plana EK: önceki davranış "adres yoksa dışarı çıkış yok" idi; etkinleşmemiş kurulum yine hiç istek atmaz, fark yalnız etkinleştirme düğmesinin ek yapılandırma istememesidir.
14. **P0 — W2 sonrası yönetici kararları (D4 · D8 · D14 + kod biçimi), v:1 İÇİNDE:** şema düzeyinde hepsi ya YENİ isteğe bağlı alan ya da gevşetmedir (hiçbir alan zorunlu olmadı, hiçbir şema daralmadı) ⇒ `v` artmaz. İki DAVRANIŞ daralması var — taşıma yanıtı artık lisans taşımaz, başka anahtarla ETKİN kurulum `ilk` kodla yeniden etkinleşmez (`TASIMA_KODU_GEREKLI`); sahada lisanslı kurulum olmadığından (D14 gerekçesi) `v` artırılmadan yapılır, satıcı dilimi uygular. Tam liste (uygulayan dilimler buna göre yazar):
    - **İSTEK (`RequestSchema`):** `kurulumId` zorunlu → `OptionalInstallationIdSchema` (uuid · yok · `""` · `null`; son üçü `undefined`), `refine`: yalnız `etkinlestir`/`tasima` kimliksiz olabilir (`INSTALLATION_ID_OPTIONAL_PURPOSES`, `isInstallationIdOptional`). `signRequest.installationId: string \| null` (null = alan imzaya girmez) · `readRequestIdentity` → `installationId: string \| null` · `RequestVerifyInput.installationId: string \| null` (taşınan kimlik hep bağlar).
    - **`ActivateRequestSchema.kurulumId`** ve **`TransferRequestSchema.kurulumId`:** zorunlu uuid → `OptionalInstallationIdSchema`.
    - **`EnvironmentSchema.installationId?`** (uuid, bilgi).
    - **`PollRequestSchema.saat.saticiSapmaSn?`** (tam sayı sn, ±1e9).
    - **`LicenseResponseSchema.kurulumId?`** (uuid; etkinleştirmede daima) · **`kodTuru?`** (`ilk`·`tasima`, tanınmayan → yok).
    - **`TransferResponseSchema.lisans`:** şema aynı (nullable), anlam: satıcı daima `null` döner.
    - **`VendorErrorResponseSchema.details.sunucuSaati?`** (ISO; biçimsiz → yok).
    - **`VENDOR_ERROR_CODES` + `TASIMA_KODU_GEREKLI`** (409).
    - **Etkinleştirme kodu:** `ActivationCodeSchema` 3 ya da 4 blok (`TKS(-XXXX){3,4}`); yeni `ACTIVATION_CODE_LENGTH` (16) · `LEGACY_ACTIVATION_CODE_LENGTH` (12) · `ACTIVATION_CODE_KINDS` (`ilk`·`tasima`) · `generateActivationCode()` (satıcının kendi üreticisi kalktı); `normalizeActivationCode` 12 ve 16.
    - **Fabrika tarafı (aynaya girmez):** `REASON_CODES` + `SAAT_KAYIK` (`REASON_VALIDITY` `null`).
    - Eski satıcı ↔ yeni fabrika: istek gövdeleri KATI olduğundan yeni isteğe bağlı alan taşıyan istek eski satıcıda `GOVDE_GECERSIZ` alır ⇒ satıcı ÖNCE güncellenir (sahada lisanslı kurulum yok, D14 gerekçesi). Yeni satıcı ↔ eski fabrika: yanıt gövdeleri GEVŞEK, yeni alanlar yok sayılır; eski fabrika kimlik taşımaya devam eder ve bağ denetimi aynen işler.
15. **Lisans v2 (L2-1, 2026-10-01) — tasarım K1–K8 + yönetici onayları, v:1 İÇİNDE:** her alan isteğe bağlıdır; ANLAMI DARALTAN parçalar (ara imzacı zinciri, ufuk/P, kip alt sınırı, parmak izi kuralı, iptal) yalnız `yetenekler` bildiren kuruluma gider ya da kuralı kiradaki alan seçer ⇒ `v` artmaz. Eski doğrulayıcının yok saydığı alanlar ya bilgidir ya da yalnız genişletir; yok sayıldıklarında eski, daha sıkı davranış sürer. Kod: L2-1 dilimi (protokol + aynalar · satıcı/patron yol bağı · vektörler).
    - **Belgeler:** TYP `tekserp-iptal` · sertifika `kullanim: HAK` (kid `ara-`) · HAK `imzaciSertifikasi?` `cevrimdisiUfukGun?` `kipAltSiniri?` · KİRA `odenmisTarih?` `parmakIziKurali?` `kapanis?` `hakOzeti?` `iptalSira?` · İSTEK `yol?` + amaç `donanim` · İPTAL belgesi (§3).
    - **Doğrulama:** ara yolu (§2) · `verifyEntitlement(token, roots, {nowMs, revocation})` · `verifyCertificate({…, revocation})` · `verifyLease(token, roots, {revocation})` · `verifyRevocation` · `pickNewerRevocation` · `isRevocationCurrent` · `offlineHorizonCeilingDays` · `checkLeaseBinding` + `hakOzeti` (`VerifiedEntitlement.digest`) · `compareFingerprints({rule})` · `assessIdentification` · `canAutoLearnFingerprint` · `verifyRequest({path})` · `jwsDigest`. Seçeneksiz çağrı bugünkü sonucu AYNEN verir (v1 vektörleri değişmedi: 329/329).
    - **Uçlar:** `POST /v1/donanim` (§5) · Poll/Activate v2 ekleri · Poll `hak.ozet?` · LicenseResponse `iptal?`.
    - **Kodlar:** protokol `SERTIFIKA_IPTAL` · `BELGE_ILERI_TARIHLI` · `UFUK_TAVANI_ASIMI` · `IMZACI_KIMLIK` · `ISTEK_YOL`; satıcı `ZAYIF_TANIMA_ONAY_BEKLIYOR` (409). Kod eklemek kırıcı değildir (§9).
    - **Tasarımdan uygulamada netleşen (yönetici onaylı):** `IMZACI_KIMLIK` belgedeki dört koda EK (bayideki `BAYI_KIMLIK`in ikizi) · zayıf kuralda boş kabul kümesi `OLCULEMEDI` (belgedeki `min(3, n)` n=0'da her şeyi eşleşmiş sayardı) · `/v1/donanim` yanıtı tek zarf · `yetenekler` AÇIK biçimli dizge listesi · kirada `kapanis` bilgi alanı (K3 şart) · K2 önlemleri (`hak.ozet` · `hakOzeti` · `iptalSira`) · iptal kimlik VE (kid, kullanım) ile eşleşir (anahtarın iptali) · `nowMs` sonlu değilse RED.
    - **Test vektörleri:** `native/lisans-cekirdek/test-vektorleri/protokol-v2.json` (biçim 1; 137 kayıt; 11 tür — hak2 · kira2 · bag2 · iptal · iptalSec · iptalGuncel · parmakIziKarar · tanima · ogrenme · ufukTavani · istek). Üretici `Teks-Erp/scripts/lib/lisans-cekirdek-vektor-v2.ts` (`test_lisans_native_kahin.ts --vektor-yaz [--yalniz-v2]`), değerlendirme doğrudan protokol işlevlerinden; bayatlığı kâhin §2'' ölçer. `cargo test` bu dosyayı L2-2'de tüketmeye başlar. ⚠️ **Açık borç:** iki vektör dosyası L2-2'den sonra tek dosyada birleşir, `VEKTOR_BICIMI` artar.
    - **Uyumluluk (her yön):**

      | Yön | Ne olur | Ölçüm |
      |---|---|---|
      | Yeni satıcı ↔ eski fabrika | Yanıt gövdeleri GEVŞEK: `iptal` ve bilinmeyen alanlar atılır. Belgeler (HAK/KİRA) gevşek şemalı: eski TS ve native doğrulayıcı yeni alanları ATAR (imza tam metin üzerinde olduğundan imza yine geçer) ⇒ eski çapa, eski parmak izi kuralı, iptal görünmez. Ara imzalı HAK eski fabrikada `KOK_BILINMIYOR` alır ⇒ satıcı yalnız `hak-ara` bildirene basar, ötekine kök imzalı HAK (kuyruk/tören). Kapanış kirası eski fabrikada da K3 olarak işler. `ZAYIF_TANIMA_ONAY_BEKLIYOR` eski fabrikada genel "reddetti" mesajıyla görünür | v1 vektörleri (eski davranış) 329/329 değişmedi; TS'te "yeni alanlar korunur" vektörleri (kâhin §2''); eski native'in alan atması v1 vektörlerindeki "tanınmayan alan atılır" ailesiyle aynı yol |
      | Eski satıcı ↔ yeni fabrika | İZİN VERİLMEYEN sıra (satıcı önce yayınlanır). Olursa: v2 ekli yoklama/etkinleştirme KATI şemada 400 `GOVDE_GECERSIZ` (eski çapa işler, davranış bugünkü gibi); `yol` taşıyan istek eski satıcıda alan atılarak GEÇER (İSTEK şeması gevşek); `donanim` amacı ve `/v1/donanim` eski satıcıda reddedilir (`BELGE_SEMA`/`BULUNAMADI`) | `test_lisans_protokol` §14c (eski doğrulayıcı yolu denetlemez) · §15a/§15c (KATI ekler) |
      | Yeni fabrika + v1 belge | seçeneksiz/alan yok ⇒ v1 davranışı: eski çapa, `compareFingerprints` v1, iptal yok, ufuk tavanı yok (alan yok), kira bayt bağı yok | `test_lisans_protokol` §9 "ufuk alanı yok", §10e, §11f, §11q, §12k, §13m · v1 vektörleri |
      | Yeni fabrika + v2 belge | P · iptal · ufuk tavanı · kip alt sınırı · parmak izi v2 · `hakOzeti` · `iptalSira` (tüketimi L2-5/6/7/10) | `test_lisans_protokol` §8–§15 · protokol-v2.json |
      | Panel / tablet (eski) | Protokol istemciye çıkmaz; `/api/license/*` yanıtları bu dilimde DEĞİŞMEDİ. Yeni satıcı kodu (`ZAYIF_TANIMA_ONAY_BEKLIYOR`) backend'in `LICENSE_VENDOR_REJECTED.vendorCode`u olarak gelir; TR mesajı backend'de (`license-wire.helper.ts`), panel ham kodu gösterir (Electron `labels.ts` L2-5) | tsc + `test_lisans_motoru` 106/0 |
      | Patron sunucusu | Ayna bayt-eşit (`test_patron_kapilari` §7a); `yol` taşıyan istek kendi ucuna bağlı (`authenticateFactory({path})`), yolsuz istek değişmez. Patron yeni belge türlerini tüketmez | patron 24/24 · `test_esitleme_idempotency` §7 |
      | CF Worker (İNDİRME) | Değişmedi (`indirme.ts` dokunulmadı); kid × kanal × pencere listesi L2-8 | `test_indirme_kapisi` 180/0 |
      | Native çekirdek (bugünkü ikili) | v1 vektör dosyası değişmedi, `cargo test` yeşil; native yeni alanları atar (`strict=false`), ara/iptal/kural parametresi yok ⇒ v1 davranışı. Ayna L2-2 (ABI G3 ile aynı numara altında birleşir) | commit kapısı `native/lisans-cekirdek · test` yeşil |

16. **İNDİRME anahtar listesi (L2-8, 2026-10-01):** `DownloadPublicKey`e isteğe bağlı `kanallar` · `baslangic` · `bitis` (Worker liste satırı); `verifyDownloadToken` bunları süre/ömürden sonra uygular (`INDIRME_PENCERE` · `INDIRME_KANAL`, yeni kod — kırıcı değil, §9). Belge (`tekserp-indirme`) DEĞİŞMEDİ; satırı alanlarsız çağıran (satıcı, patron, senaryolar) bugünkü sonucu aynen alır. Aynı kid iki satırdaysa ilk satır kazanır (önceden son satır — Worker `find` ile hizalandı; Worker ayarı çift kid'i zaten reddeder). Kod: `protocol/indirme.ts` + satıcı/patron bayt-eşit aynası · Worker `deploy/guncelleme-sunucusu/worker/indirme-kapisi.js`. Ölçüm: `test_indirme_kapisi` §0 parite + §8.

## 12a. Adlandırma — plan adı → kod adı

`src/` bildirim adları İngilizcedir (`[IL-16]`/`[IL-32]`, bekçi `test_identifier_language`); **tel biçimi alanları (şema anahtarları), durum girdi/çıktı alanları ve kod DEĞERLERİ Türkçe kalır** (TR veri anahtarı istisnası) — plan ve bu belge o sözlüğü kullanır. Plan/görev metnindeki adların koddaki karşılıkları:

| Plan / görev metni | Kod |
|---|---|
| `KOK_ACIK_ANAHTARLAR` | `ROOT_PUBLIC_KEYS` (`RootKey {kid, x, classes}`) |
| `lisansModuluAcik(k)` (`readX = readXRaw ∧ …`) | `isModuleLicensed(state, key)` · saf karşılaştırma `ceilingAllows(ceiling, key)` |
| durum fonksiyonu (`state.ts`) | `computeLicenseState(input: LicenseStateInput): LicenseState` |
| belge + doğrulama sonucu | `DocResult<T>` = `{status: "YOK"}` · `{status: "GECERSIZ", code}` · `{status: "GECERLI", value}`; diskten `verifyLicenseDocuments({entitlementJws, leaseJws, roots})` |
| HAK / KİRA / SERTİFİKA doğrula | `verifyEntitlement(token, roots)` · `verifyLease(token, roots)` · `verifyCertificate(token, {roots, usage, atMs})` · `checkLeaseBinding(lease, entitlement)` |
| JWS kodla/doğrula | `signJws` · `verifyJws(token, {typ, findKey})` · `parseJws` |
| İSTEK | `signRequest({installationId, purpose, body, key: {privateKey, nowMs, nonce?}})` · `verifyRequest(token, {publicKeyX, body, nowMs, purposes, installationId})` · `readRequestIdentity` · `NonceLedger.record({installationId, nonce, requestTimeMs, nowMs})` |
| İNDİRME | `signDownloadToken({payload, key, nowMs})` · `verifyDownloadToken(token, {keys, nowMs})` · `isDownloadPathAllowed(doc, path)` |
| parmak izi | `digestFingerprint(raw, salt)` · `compareFingerprints(accepted, measured, {excludeF5})` → `{result, measurable, matched, mismatched, unmeasured}` |
| saat | `evaluateClock(ClockInput)` → `ClockResult {trustedMs, source, finding, findingSource}` · `accumulatedRuntime` · `signStateRecord` / `verifyStateRecord` / `monotonicElapsed` |
| sonuç tipi | `Result<T>` = `{ok: true, value}` · `{ok: false, code, message}` (`code` ∈ `PROTOCOL_ERROR_CODES`) |
| gövde şemaları | `ActivateRequestSchema` · `PollRequestSchema` · `TransferRequestSchema` · `DrTakeoverRequestSchema` · `OfflineRequestSchema` · `LicenseResponseSchema` · `TransferResponseSchema` · `HealthSummarySchema` · `StateSummarySchema` · `VendorErrorResponseSchema` |
| kimliksiz istek (P0, D14) | `OptionalInstallationIdSchema` · `INSTALLATION_ID_OPTIONAL_PURPOSES` · `isInstallationIdOptional(purpose)` |
| lisans v2 (L2-1) | `verifyRevocation(token, roots)` → `VerifiedRevocation {document, rootKid}` · `pickNewerRevocation(mevcut, gelen)` · `isRevocationCurrent(kira, iptal)` · `isCertificateRevoked(sertifika, iptal)` · `offlineHorizonCeilingDays(sinif, imzaci)` · `EntitlementSignerKind` (`KOK` · `BAYI` · `ARA`) · `jwsDigest(token)` · `compareFingerprints(a, b, {excludeF5, rule})` → `+ {rule, lost, strongMatched}` · `assessIdentification` · `canAutoLearnFingerprint` · `LICENSE_CAPABILITIES` / `hasCapability` · `HardwareReportRequestSchema` · `HardwareReportResponseSchema` · `RequestPathSchema` |
| etkinleştirme kodu (P0) | `generateActivationCode()` · `normalizeActivationCode(text)` · `ActivationCodeSchema` · `ACTIVATION_CODE_LENGTH` (16) · `LEGACY_ACTIVATION_CODE_LENGTH` (12) · `ACTIVATION_CODE_KINDS` / `ActivationCodeKind` (`ilk` · `tasima`) |

## 13. 1b / 1c için bağlayıcı notlar

- **1b (satıcı):** imzalamadan önce `signDocument` şemadan geçirir (geçmeyen belge imzalanmaz). HAK imzasında bayinin GÜNCEL tavanı ayrıca denetlenir (sertifika kısıtı yetmez). Nonce `(kurulumId, nonce)` UNIQUE, saklama `zaman` + 10 dk. Yanıtı isteğin `v`siyle üret. Kira zinciri: yoklamadaki `sonKiraId` ucu tutar (plan §4 çatal üç hâli). Kök çapasını kendi kök listesiyle aynı dosyadan (ayna) okur.
- **1c (fabrika):** `ilkAcilisMs` DB'den (silinmeyen veri: kurulum kimliği satırının `createdAt`i ya da en eski defter kaydı); `yuksekSuMs` yalnız sunucu saati + defter `createdAt`inden (güvenilir saatin kendisini yüksek suya yazma — döngüsel zehirlenme); ikinci anahtar girdi değildir, durum işlevi kiradan/durum kaydından türetir (§7 kural 4); `durum.json` her yazımda `sira++`, yeni kira kabulünde `birikenMs = 0` + `kiraId` güncellenir, `sonKiraZorlamasi` son kullanılabilir kiradan. Parmak izi eşleşmesi kiranın `parmakIzi` kümesine karşı (`compareFingerprints`, DR'de `f5Haric`). `butunluk` Faz 2'ye dek `KAPSAM_DISI`. Yoklama gövdesini `PollRequestSchema.parse` ile kur (allowlist dışı alan kod yolunda patlar).

## 13a. P0 sonrası uygulayan dilimler için bağlayıcı notlar (W3a)

Protokol P0'da değişti; aşağıdakiler UYGULAMA işidir ve protokol dosyalarına dokunmadan yapılır (protokol değişikliği gerekirse dilim yapmaz, raporlar).

- **Satıcı — UYGULANDI (F2, 2026-09-29; arşiv "Satıcı düzeltmeleri F2"):** kurulum açılırken `kurulumId`yi PORTAL üretir (bugün portal/bayi formu fabrikanın DB kimliğini `kurulumId: z.uuid()` diye istiyor; `Kurulum.kurulumId` şema yorumu "fabrikanın installationId'si"); kimliksiz etkinleştirmede kurulumu kod özetinden bulur (bugün `installation-auth.ts` kimliksiz isteği `ISTEK_GECERSIZ` ile reddediyor — P0 yalnız derlenir bıraktı); etkinleştirme yanıtına `kurulumId` + `kodTuru` koyar; `ilk` kod başka anahtarla ETKİN kuruluma `TASIMA_KODU_GEREKLI` (bugün `YENIDEN_ETKINLESTI` kabul ediliyor); taşıma talebi kod/lisans döndürmez, onayda `tasima` türü tek kullanımlık kod üretir (bugün onay yeni anahtarı etkinleştirip talep yanıtında lisans veriyor); kimliksiz taşıma talebini kuruluma OTOMATİK bağlamaz (`ortam.installationId` ipucudur, otorite operatör); `ISTEK_ZAMAN` gövdesine `details.sunucuSaati`; kod DB'de sunucu sırrıyla (pepper) HMAC; bayi ETKİN kuruluma kod üretemez.
- **Fabrika (F1a'da uygulandı — `test_lisans_motoru` §10/§11/§20; kalan: panel yer tutucusu 16 karakter):** lisans kimliğini etkinleştirme yanıtından (otorite kira `kurulumId`) öğrenip `LICENSE_DIR`e (`kurulum-kimligi.json`) yazar; sonraki BÜTÜN istekler (yokla · zil · çevrimdışı · dr-devral · destek · eşitle · taşıma) ve `durum.json` (`kurulumId`), durum girdisi (`LicenseStateInput.kurulumId`), yanıt bağ denetimi, `detay.kurulum.kurulumId` o kimliği kullanır (DB kimliği `detay.kurulum.veritabaniKimligi`de, bilgi); etkinleştirme isteği ve kimliği bilinmeyen taşıma talebi `kurulumId` taşımaz; `ortam.installationId` DB kimliğini bilgi olarak taşır (`test_lisans_yoklama_allowlist` beyan kümesine `installationId` + `saticiSapmaSn` eklenir — karar P0'da verildi). `ISTEK_ZAMAN` + `sunucuSaati`de isteği BİR KEZ yeniden imzalar, `SAAT_KAYIK` nedenini ve `saticiSapmaSn`i raporlar; hata mesajı ve panel yer tutucusu 16 karakterlik biçimi (`TKS-XXXX-XXXX-XXXX-XXXX`) gösterir.
- **DR:** `anaKurulumId` ananın LİSANS kimliğidir; DR sunucusu onu DB replikasından türetemez (replika DB kimliğini taşır) — yönetici ana Lisans ekranından ya da portaldan alır.

## 13b. Lisans v2 sonrası uygulayan dilimler için bağlayıcı notlar (L2-1 → L2-2…L2-11)

Protokol L2-1 inişiyle dondu; aşağıdakiler protokole dokunmadan yapılır (protokol değişikliği gerekirse dilim yapmaz, yöneticiye raporlar).

- **L2-2 (native):** `protokol-v2.json` her tür için TS kâhinindeki işlevin aynası (eşleme üretici dosyanın başlığında); denetim SIRASI aynadır: sertifikada kullanım → iptal → sınıf → zaman; HAK'ta imza yolu (kök · ara · bayi) → ufuk tavanı → veriliş sınırı. `istek` türü yalnız satıcı/patron kâhinidir (native istek doğrulamaz) — native süzebilir. `VerifiedEntitlement.digest` native görünümünde yok: köprü (`core-bridge.ts`) özeti doğrulanan metinden kurar; native `hakOzeti` bağını kendi `checkLeaseBinding`inde uygulamalı.
- **L2-3 (satıcı, ara imzacı + iptal):** HAK'ı ara imzacıyla YALNIZ `hasCapability(yetenekler, "hak-ara")` kuruluma bas; imzalamadan önce `offlineHorizonCeilingDays` (aynı tavan); iptal belgesi her `LicenseResponse.iptal`ine, sırası kiranın `iptalSira`sına.
- **L2-4 (satıcı, P + kapanış):** kiraya `odenmisTarih` (tek kaynak `odenmisTarihi`) ve `hakOzeti = jwsDigest(güncel HAK)`; kapanış kirası = K3 + `kisitlamaTarihi = şimdi + ekSureGun` + `kapanis`; `YABANCI_HAK` (hakId, sürüm, `hak.ozet`) üçlüsüyle.
- **L2-5/L2-6/L2-7/L2-10 (fabrika):** yoklama ve etkinleştirme v2 eklerini YALNIZ doluysa gönderir (eski satıcı KATI şemada reddeder; satıcı önce yayınlanır). `nowMs` = max(duvar, yüksek su). İptal deposu en yüksek `sira`yı tutar (`pickNewerRevocation`); kiranın `iptalSira`sı karşılanmıyorsa (`isRevocationCurrent` false) `IPTAL_BELGESI_KAYIP`. Yoklamada `hak.ozet = jwsDigest(HAK metni)`. `signRequest({path})`: çevrimiçi istekte `ENDPOINTS` sabiti, zarfla giden istekte `/v1/cevrimdisi` (satıcı zarfı o yolla doğrular; yokla yoluyla imzalanmış zarf 401 `ISTEK_YOL`). Parmak izi kararı kiradaki `parmakIziKurali` ile (`rule`); kayıp listesi toplayıcının 24 sa önbelleğinden.
- **L2-11 (satıcı, donanım):** etkinleştirmede `assessIdentification(...).weak` ⇒ 409 `ZAYIF_TANIMA_ONAY_BEKLIYOR` (kod/nonce tüketilmez); öğrenme `canAutoLearnFingerprint`; `/v1/donanim` yanıtı `HardwareReportResponseSchema` (`lisans` yalnız `ONAYLANDI`da); zarfla gelen `donanim` amaçlı istek `/v1/cevrimdisi` ucunda işlenir.

## 14. Fabrika API'si (`/api/license/*`, Faz 1c) — panel (1d) ve tablet (1e) buna karşı yazılır

Yanıt zarfı backend'in genel biçimidir: başarı `{ success: true, data: T }`, hata `{ success: false, message: <TR>, details: { code, … } }` (`details.code` okunur; `body.code` YOK). Tipler kodda `Teks-Erp/src/services/license-view.service.ts` + `license.service.ts`; aşağıdaki blok onların aynasıdır (ayrışırsa kod kazanır).

| Uç | Kimlik / izin | Gövde / sorgu | `data` |
|---|---|---|---|
| `GET /durum` | **herkes** — başlık varsa TAM doğrulama (geçersiz token 401), yoksa kimliksiz | — | `LicenseStatusResponse` (kimliksize `{ ayrinti: false }`) |
| `GET /indirme-belirteci` | onaylı cihaz (`x-device-id`, onaylı+aktif) YA DA oturum; ikisi yoksa 401 `DEVICE_OR_SESSION_REQUIRED` | `?urun=electron\|mobil&kanal=<kod?>` (kanal yoksa kiranın kanalı) | `LicenseDownloadToken` |
| `GET /detay` | `license:view` ∨ `license:manage` | — | `LicenseDetail` |
| `GET /proxy` | `license:view` ∨ `license:manage` | — | `LicenseProxySettings` |
| `PUT /proxy` | `license:manage` | `{ adres: string \| null, atla?: string \| null }` (null = kaldır; yeniden başlatma YOK) | `LicenseProxySettings` |
| `GET /kabul` | `license:view` ∨ `license:manage` | — | `LicenseAcceptanceView` (sözleşme kabul metni + durum + defter, Ek-7) |
| `POST /kabul` | `license:manage` | `{ clientToken, metinKimligi, metinOzeti, kutular[], adSoyad, unvan }` — metin güncel olmalı (409 `LICENSE_ACCEPTANCE_TEXT_CHANGED`), bütün kutular (400 `LICENSE_ACCEPTANCE_BOXES`); clientToken ile idempotent | `LicenseAcceptanceView` (201) |
| `POST /etkinlestir` | `license:manage` | `{ kod }` (elle yazım normalleşir: büyük harf, O→0, I/L→1, tire) — geçerli sözleşme kabulü yoksa satıcıya GİTMEDEN 409 `LICENSE_ACCEPTANCE_REQUIRED` (`kabulDurumu`); `cevrimdisi-istek` / `aktarma-istegi` `amac: etkinlestir` aynı kapıdan | `LicenseDetail` |
| `POST /yokla` | `license:manage` | — | `{ outcome: PollOutcome, code?: string }` |
| `POST /cevrimdisi-istek` | `license:manage` | `{ amac?: "yokla" \| "etkinlestir", kod?: string }` — kod GÖVDEDE (URL'de değil) | `LicenseOfflineRequest` (QR: `qrAdresi`) |
| `GET /cevrimdisi-istek` (ESKİ) | `license:manage` | `?amac=…&kod=` — bir sürüm geçiş; `Deprecation: true`, günlükte kod maskeli | aynı |
| `POST /cevrimdisi-yanit` | `license:manage` | `{ yanit: string \| object }` — QR'dan base64url(JSON) ya da JSON | `LicenseDetail` |
| `POST /aktarma-istegi` | `license:manage` | `{ amac?, kod? }` — kod GÖVDEDE | `LicenseOfflineRequest` (panel `istekGovdesi`ni `hedefUrl`e AYNEN POST eder) |
| `GET /aktarma-istegi` (ESKİ) | `license:manage` | `?amac=…&kod=` — bir sürüm geçiş; `Deprecation: true`, günlükte kod maskeli | aynı |
| `POST /aktarma-yaniti` | `license:manage` | `{ yanit: object }` — satıcının yanıt gövdesi AYNEN | `LicenseDetail` |
| `POST /tasima-talebi` | `license:manage` | `{ gerekce?: string \| null }` | `LicenseTransferResult` |
| `POST /dr-devral` | `license:manage` | `{ anaKurulumId?: uuid, gerekce: string }` (kimlik yoksa satıcı çıkarır — 2d) | `LicenseDetail` |
| `GET /veri-disari` | `admin:settings` ∨ `system:backups`, VE `admin:users` (yedek zinciriyle aynı) | — | `LicenseDataExportManifest` |

```ts
type StateTier = "NORMAL" | "UYARI" | "EK_SURE" | "KISITLI" | "DURDURULMUS";
type LicenseMode = "gozlem" | "zorla";
type Validity = "GECERLI" | "GECERSIZ" | "OLCULEMEDI";
type LicenseClass = "URETIM" | "TEST" | "DR" | "DEMO" | "BAYI" | "BARINDIRILAN";
interface Banner { metin: string; ton: "bilgi" | "uyari" | "tehlike" }

// GET /durum — küresel bant ve Hakkında ekranı bunu okur.
interface LicenseStatusSummary {
  ayrinti: true;
  kip: LicenseMode;
  kademe: StateTier;              // UYGULANAN kademe — gözlemde DAİMA "NORMAL"
  bant: Banner | null;            // uygulanan bant — gözlemde DAİMA null
  ekSureKalanGun: number | null;  // yalnız kademe EK_SURE iken
  kisitlamaKalanGun: number | null; // yalnız zorlamada (K3 geri sayımı)
  guncellemeIzni: boolean;
  sinif: LicenseClass | null;
  lisansNo: string | null;        // TKS-YYYY-NNNN (görünür filigran)
  lisansSahibi: { musteri: string; tesis: string } | null;
  surum: string;                  // backend sürümü
}
type LicenseStatusResponse = LicenseStatusSummary | { ayrinti: false };

// GET /detay — Lisans ekranı (yönetici).
interface LicenseDetail {
  hazir: boolean;                 // kurulum kimliği + depo hazır mı
  kurulum: { kurulumId: string | null /* LİSANS kimliği (LICENSE_DIR); etkinleşmemişte null */; veritabaniKimligi: string | null /* DB system.installationId — bilgi (F1a) */;
             anahtarKimligi: string | null; etkin: boolean /* kimlik ∧ (HAK ∨ kira ∨ durum kaydı) ∨ bekleyen taşıma */; ilkAcilis: string | null };
  depo: { dizin: string | null; sorun: "APP_ICINDE" | "YEDEK_ICINDE" | "OKUNAMADI" | "YAZILAMADI" | null;
          bozukAnahtarKenaraAlindi: boolean; durumKaydi: { gecerli: boolean; sira: number | null } };
  durum: {
    gecerlilik: Validity; nedenler: Array<{ kod: string; ayrinti: string | null }>; kip: LicenseMode;
    hesaplananKademe: StateTier; uygulananKademe: StateTier;
    hesaplanan: LicenseEffect; uygulanan: LicenseEffect;   // gözlem: uygulanan = bugünkü davranış
    ekSureKalanGun: number | null; kisitlamaKalanGun: number | null; devredildi: boolean;
    yaptirimKademesi: "K0" | "K1" | "K2" | "K3" | "K4" | "K5" | null;
    saat: { guvenilir: string; kaynak: "DUVAR" | "MONOTONIK" | "YUKSEK_SU"; bulgu: "SAAT_ILERI" | "SAAT_GERI" | null; bulguKaynagi: string | null };
  };
  hak: { hakId: string; surum: number; lisansNo: string; musteri: { id: string; ad: string }; tesis: { id: string; ad: string };
         sinif: LicenseClass; moduller: string[]; kalici: boolean; bakimBitis: string; verilis: string; bayiId: string | null } | null;
  kira: { kiraId: string; verilis: string; bitis: string; sunucuSaati: string; ekSureGun: number; zorlama: boolean;
          gecerlilikBitis: string | null; yaptirim: { kademe: string | null; mesaj: string | null; kisitlamaTarihi: string | null;
          donmusModuller: string[]; guncellemeDonuk: boolean }; yoklamaAraligiDk: number; devredildi: boolean;
          kanal: { kod: string; guncelSurumler: { backend?: string; panel?: string; tablet?: string } } } | null;
  parmakIzi: { olculdu: string | null; olculen: Record<"f1" | "f2" | "f3" | "f4" | "f5", boolean> | null;  // DEĞER değil, ölçülebildi mi
               karar: "ESLESTI" | "ESLESMEDI" | "OLCULEMEDI" | null; eslesen: number | null; olculebilen: number | null; uyusmayan: string[] };
  yoklama: { saticiYapilandirildi: boolean; saticiAdresi: string | null; sonDeneme: string | null; sonBasari: string | null;
             sonBasarisizlik: string | null; sonHataKodu: string | null; sonrakiDeneme: string | null;
             zil: { bagli: boolean; sonBaglanti: string | null; sonZil: string | null; sonKalpAtisi: string | null; sonHataKodu: string | null } };
  tasima: { talepId: string; istendi: string; gerekce: string | null; durum?: "BEKLIYOR" | "ONAYLANDI" /* ONAYLANDI: taşıma kodu bekleniyor (F1a) */ } | null;
  gozlem: { reddedilecekIstek: number; reddedilecekModul: number };
  proxy: LicenseProxySettings;
  // 2e-S (EK alan): lisans çekirdeği + imzalı paket bütünlüğü — dosya adı YOK, yalnız sayılar.
  butunluk: { cekirdek: "native" | "ts" | "yok"; cekirdekNeden: string | null; zorunlu: boolean;
              durum: "GECERLI" | "GECERSIZ" | "OLCULEMEDI" | "KAPSAM_DISI"; kod: string | null; denetlendi: string | null;
              paketId: string | null; paketSurumu: string | null; derlemeTarihi: string | null; anahtar: string | null /* PAKET kid */;
              sayilar: { dosya: number; eksik: number; degisik: number; fazla: number; okunamayan: number } | null;
              ilkUyusmazlik: string | null /* ek süre çapası; yalnız yeni paketId sıfırlar */ };
}
interface LicenseEffect {
  bant: Banner | null; guncellemeIzni: boolean;
  modulTavani: { applies: false } | { applies: true; allowed: string[] | null; denied: string[] };
}
interface LicenseProxySettings { kaynak: "panel" | "ortam" | "yok"; adres: string | null /* kimlik maskeli: http://***@host:port */; atla: string | null; destekleniyor: boolean }
interface LicenseDownloadToken { yolOneki: string; belirtec: string; gecerlilikSonu: string | null }
// GET|POST /kabul — sözleşme kabulü (Ek-7). Metin backend'in pakette taşıdığı güncel metindir (hukuk belgesinden üretilir).
type AcceptanceBlock = { tur: "paragraf"; satirlar: string[] } | { tur: "liste"; maddeler: string[] } | { tur: "kutu"; no: string; metin: string } | { tur: "alanlar" } | { tur: "dugmeler" };
interface LicenseAcceptanceRecord { kabulId: string; metinKimligi: string; metinOzeti: string; kutular: string[]; adSoyad: string; unvan: string;
  kabulEden: { id: string; ad: string }; anahtarKimligi: string; lisansKimligi: string | null; istemciSurum: string | null; sunucuSurum: string; zaman: string }
interface LicenseAcceptanceView {
  metin: { kimlik: string; ozet: string /* sha256 hex */; taslak: boolean; bloklar: AcceptanceBlock[]; kutular: string[] };
  durum: "GECERLI" | "YOK" | "METIN_DEGISTI" | "ANAHTAR_DEGISTI";  // geçerli = bu kurulum ANAHTARININ en son kabulü ∧ güncel metin
  gecerli: LicenseAcceptanceRecord | null; kayitlar: LicenseAcceptanceRecord[] /* son 20 */; anahtarKimligi: string | null; oneri: { adSoyad: string | null };
}
interface LicenseOfflineRequest {
  amac: "yokla" | "etkinlestir"; zarf: string; gecerlilikSonu: string /* +10 dk */; hedefYol: "/v1/cevrimdisi";
  hedefUrl: string | null; istekGovdesi: { v: 1; zarf: string }; qrAdresi: string | null /* <satıcı>/q#<zarf> */;
}
interface LicenseTransferResult { talepId: string; durum: "BEKLIYOR" | "ONAYLANDI" | "REDDEDILDI"; lisans: LicenseDetail }
interface LicenseDataExportManifest {
  kademe: StateTier;
  yedekler: Array<{ ad: string; boyutBayt: number; zaman: string; sifreli: boolean; indirmeYolu: string }>; // en yeni 10
  yollar: { yedekAl: "POST /api/admin/backup"; yedekListesi: "GET /api/admin/backups"; yedekIndir: "GET /api/admin/backups/{ad}/download";
            varliklar: "GET /api/import/entities"; disariAktar: "GET /api/import/{entity}/export" };
}
type PollOutcome = "YAPILANDIRILMAMIS" | "HAZIR_DEGIL" | "ETKIN_DEGIL" | "BASARILI" | "BASARISIZ";
```

**Hata kodları (`details.code`):** `LICENSE_ACCEPTANCE_REQUIRED` 409 (+ `kabulDurumu`; etkinleştirme sözleşme kabulü ister) · `LICENSE_ACCEPTANCE_TEXT_CHANGED` 409 · `LICENSE_ACCEPTANCE_BOXES` 400 · `LICENSE_ACCEPTANCE_TEXT_UNPUBLISHED` 409 (paketin metni katalogda yok) · `LICENSE_STORE_UNAVAILABLE` 409 (depo `app\`/`BACKUP_DIR` içinde ya da yazılamıyor) · `LICENSE_IDENTITY_NOT_READY` 409 · `LICENSE_NOT_CONFIGURED` 409 (satıcı adresi yok: `LICENSE_SERVER_URL=kapali` ya da biçimsiz) · `LICENSE_NOT_ACTIVE` 409 · `LICENSE_ALREADY_ACTIVE` 409 · `LICENSE_CODE_INVALID` 400 · `LICENSE_VENDOR_UNREACHABLE` 502 (+ `egressCode`) · `LICENSE_VENDOR_REJECTED` 409 (+ `vendorCode` ∈ §5 satıcı kodları, HER kodun kendi TR mesajı — tablo `license-wire.helper.ts` `VENDOR_MESSAGES`, `VendorErrorCode` üstünde tam; + `tekrarDenenebilir`: `TEKRAR_DENEYIN` · `HIZ_SINIRI` · `ISTEK_TEKRAR` · `SUNUCU_HATASI` için `true`) · `LICENSE_RESPONSE_INVALID` 400 (+ `protocolCode`; imzasız/kurcalı/başka kuruluma ait yanıt) · `LICENSE_LEASE_STALE` 409 · `LICENSE_UPDATES_FROZEN` 403 · `LICENSE_DOWNLOAD_TOKEN_UNAVAILABLE` 404 · `LICENSE_PROXY_INVALID` 400 · `LICENSE_PROXY_UNSUPPORTED` 409 (Node < 22.21 / 24.5) · `DEVICE_OR_SESSION_REQUIRED` 401. Kapı kodları (`LICENSE_RESTRICTED` · `LICENSE_SUSPENDED` · `LICENSE_MODULE` · `LICENSE_GATE`) §14a'da.

**Davranış sözleşmesi:**
- **Gözlem = sıfır fark:** `durum.kademe` NORMAL, `bant` null, `guncellemeIzni` true — istemci bant/kilit ÇİZMEZ; yalnız Lisans ekranı `detay.durum.hesaplanan*` alanlarını gösterir.
- **Satıcı adresi:** tek çözüm `lib/license/vendor-url.ts` (`resolveVendorUrl`, `STARTUP_VENDOR`) — `LICENSE_SERVER_URL` verilmezse `https://lisans.etkiliyazilim.com` (üretim), hazırlık kurulumunda `https://lisans-test.etkiliyazilim.com`, `kapali` dışarı çıkışı kapatır; yalnız köken (`https://host[:port]`; düz HTTP yalnız döngü adresi) kabul, biçimsiz değer = adres yok + açılış uyarısı (bekçi `test_lisans_satici_adresi`).
- **Dışarı çıkış:** kurulum etkinleşmemişse ya da satıcı adresi yoksa (`kapali`/biçimsiz) backend satıcıya HİÇ istek atmaz (yoklama, zil). Yoklama saatlik (kiradaki `yoklamaAraligiDk`) + ±%10 jitter; başarısız yoklamadan sonra 2 · 4 · 8… dk (olağan aralıkla tavanlı, F1a); zil (`/v1/zil`, SSE, 60 sn sessizlik = kopuk, üstel geri çekilme ≤ 5 dk — yalnız ≥ 1 dk yaşamış bağlantı sırayı sıfırlar) `lisans` konusunda hemen yoklatır. `ISTEK_ZAMAN` + `sunucuSaati`de yoklama/etkinleştirme/taşıma/DR ve zil BİR KEZ düzeltilmiş damgayla yeniden imzalanır (§4). Taşıma onayı lisans taşımıyorsa `/yokla` `{ outcome: "BASARISIZ", code: "TASIMA_KODU_BEKLENIYOR" }` döner, talep `tasima.durum = "ONAYLANDI"` kalır ve yoklanmaz (kod portaldan gelir). Motor başlatması pes etmez (DB kimliği/olguları gelmezse aralıkla yeniden).
- **Ayak izi:** `LICENSE_STATE_CHANGED` (geçerlilik/kademe/kip değişimi; açılıştaki ilk ölçüm taban, satır yazmaz) · `LICENSE_LEASE_ACCEPTED` · `LICENSE_SANCTION_CHANGED` · `LICENSE_OBSERVATION_SUMMARY` (gözlemde günde bir, etkin kurulumda) · `LICENSE_ADMIN_ACTION` (`eylem` ∈ etkinlestir · cevrimdisi-yanit · aktarma-yaniti · tasima-talebi · dr-devral · proxy · veri-disari). Başarısız yoklama DEFTERE YAZILMAZ (bellek + `detay.yoklama`). Proxy kimlik bilgisi yüke girmez.
- **Sözleşme kabulü (Ek-7, 2026-09-30):** eski panel (1.4.1) kabul adımını göstermez → `POST /etkinlestir` 409 `LICENSE_ACCEPTANCE_REQUIRED` (TR cümle "panel güncellenmeli" der); eski backend + yeni satıcı → 409 `KABUL_GEREKLI`, eski backend genel "reddetti" der; etkin kurulumun yoklaması etkilenmez.
- **Eski istemci ne yapar:** bütün uçlar YENİ; mevcut uç/alan değişmedi → eski panel/tablet etkilenmez. `/api/admin/health` yüküne yalnız EK `license` bloğu geldi (public `/health` DONMUŞ); blok F1a'da `motor` (`BASLAMADI` · `BASLIYOR` · `CALISIYOR` · `DURDU`) + `motorNeden` (`KIMLIK_YOK` · `DB_OLGULARI`) taşır. `detay.kurulum.veritabaniKimligi` ve `detay.tasima.durum` EK alanlardır; `detay.kurulum.kurulumId` artık lisans kimliğidir (etkinleşmemişte null — önceden DB kimliğiydi, sahada lisanslı kurulum yok). `detay.depo.sorun = "OKUNAMADI"` tek bir belge okunamadığında da görünür. `PUT /api/admin/settings/system.installationId` artık 400 `SETTING_KEY_RESERVED` (panelde bu anahtarın yüzeyi yoktu).
- **Parmak izi yükü:** `detay.parmakIzi.olculen` yalnız etken başına boolean; ham değer ve tuzlu özet uca GİRMEZ.
- **Bütünlük yükü (2e-S):** `detay.butunluk` EK alandır (eski panel görmezden gelir, yeni panel alan yoksa "eski sürüm" yazar); dosya adı taşımaz.

### 14a. Kapı ve modül tavanı (Faz 1c-kapı) — istemcilerin 403 dalı buna karşı yazılır

**Kapı (`licenseGate`, `Teks-Erp/src/middlewares/license.middleware.ts`):** app düzeyinde `/api` altında, rotalardan önce; YÖNTEM + YOL ile sınıflar (liste tek kaynak `Teks-Erp/src/constants/license-routes.ts`). Kapalı yolda KİMLİK ÖNCE gelir (F1b, D6): geçerli oturumu olmayan istek (başlık yok, imza/süre geçersiz, oturum kaydı yok ya da sonlanmış) kapıdan rotaya geçer ve rotanın 401'ini alır; kademe kodu yalnız geçerli oturuma. Karar UYGULANAN kademeden verilir — gözlemde daima NORMAL, yani hiçbir istek engellenmez (yalnız `gozlem.reddedilecekIstek` artar). Motor hazır değilse (`detay.hazir=false`) kapı geçirir.

| Kademe | Açık |
|---|---|
| NORMAL · UYARI · EK_SURE | her şey |
| KISITLI | GET/HEAD/OPTIONS + her-kademe listesi + KISITLI ek listesi (tercih/TOTP + iki adımlı doğrulama kurulum penceresi, cihaz duyurusu, yazmayan önizleme ve gövdeli okumalar, baskı/yeniden basım ayak izleri + refakat kartı reprint, yedek al · makine dışı · DB kopyası, kullanıcı pasifleştirme · parola/TOTP sıfırlama · cihaz iptali, bakım, çalışma oturumu aç/kapa). Yeniden düzenleme (`reissue`) KAPALI. |
| DURDURULMUS | her-kademe listesi + "verilerimi al" (`DATA_EXPORT_PATHS` = `/veri-disari` `yollar`) + `GET /api/auth/me` — bu küme panelin K5 kilit ekranının gerçek çağrılarını kapsar (bekçi Electron kaynağından çıkarır) |

Her-kademe listesi: `/api/license/*` · `GET /api/admin/health` · `GET /api/mobile/updates/*` · `GET /api/client-policy/*` · `GET /api/discovery/identity` · `GET /api/auth/login-methods` · `POST /api/auth/login|login-card|login-quick-pin|logout` · `GET|POST /api/auth/totp/enroll` (giriş akışı; I3-2 yönetici kararı).

**Red gövdeleri (403, `details.code`):**
- Geçerli oturumu olmayan istek: kapıdan geçer, rotanın `verifyToken`ı **401** döner (istemci bugünkü gibi girişe yönlenir). Yalnız KİMLİK İSTEMEYEN kapalı uçta (`PUBLIC_ROUTES`: cihaz duyurusu/durumu/eşleşmesi, tablet kullanıcı listesi, TOTP kurulumu…) kapı `{ code: "LICENSE_GATE" }` döner — başka alan YOK (kademe/gün anonim çağırana sızmaz); istemci bunu "lisans nedeniyle kullanılamıyor" diye gösterir, ayrıntı giriş sonrası `GET /durum`.
- Geçerli oturum, KISITLI: `{ code: "LICENSE_RESTRICTED", kademe: "KISITLI", kisitlamaKalanGun: number | null, devredildi: boolean }`.
- Geçerli oturum, DURDURULMUS: `{ code: "LICENSE_SUSPENDED", kademe: "DURDURULMUS" }` — panel K5 ekranına geçer; `/api/license/*`, `/api/auth/me` ve "verilerimi al" yolları açıktır.
- Modül (adlı yedi kapı VE satır içi modül kapıları): `{ code: "LICENSE_MODULE", modul: "<DB anahtarı, ör. finance.enabled>", neden: "LISANSTA_YOK" | "DONDURULDU" }` — bayrak DB'de açık olsa da; `modul` HER yanıtta DB anahtarıdır (tek üretici `licenseModuleError`). Lisans açık modül kapalıysa eskisi gibi `MODULE_DISABLED` (`modul` kısa kod).

**Modül tavanı:** `readX = readXRaw ∧ tavan` (`Teks-Erp/src/lib/license/module-ceiling.ts`); tavan uygulanan etkiden — HAK tavanı yalnız belirsizlik yokken, dondurulan modül her hâlde (kural 7). `PATCH /api/feature-flags` lisansın kapattığı modülü AÇMAYA çalışırsa 403 `LICENSE_MODULE`; kapatmak serbest.

**Panel bloğu:** `GET /api/feature-flags` → `data.license = { kip: "gozlem" | "zorla", kapaliModuller: Array<{ anahtar: string /* DB anahtarı */, neden: "LISANSTA_YOK" | "DONDURULDU" }> }` — SALT OKUNUR (PATCH şeması kabul etmez), önbelleğe girmez, gözlemde daima boş. Modül şalterleri (`financeEnabled`…) HAM değerdir; "lisansınızda yok" rozeti bu listeden çizilir.

**Eski istemci ne yapar:** kapı kodları yalnız zorlamada doğar (Faz 4'e dek derleme varsayılanı gözlem); eski panel/tablet 403'ü genel yetki hatası gibi gösterir. `license` alanı EK'tir, eski istemci yok sayar. Kimlik önce (F1b): süresi dolmuş token'lı eski panel K4/K5'te artık 401 alır ve girişe yönlenir (önceden 403 `LICENSE_GATE`); `?kod=`lu GET istek uçları bir sürüm daha çalışır.

### 14b. İstemci sözleşmeleri (F3) — panel, tablet ve satıcının /q sayfası

- **Giriş öncesi K5:** `GET /api/auth/login-methods` yanıtına `lisansDurduruldu: boolean` eklendi (zorla ∧ UYGULANAN DURDURULMUŞ; gözlemde ve motor hazır değilken `false`). Kimliksize verilen TEK lisans bilgisidir; başka anahtar (kademe, gün, modül, lisans no) eklenmez (bekçi `test_lisans_k5_giris`). Eski istemci alanı yok sayar.
- **Çok parçalı QR (`TKLQ1`):** `TKLQ1|<i>/<n>|<kimlik>|<özet>|<veri>` — n 1…4; kimlik = tam metnin sha256'sının ilk 8 onaltılığı, özet = parça verisinin; veri ardışık dilim (`|` içerebilir). Tek kaynak `Teks-Erp/src/lib/license/qr-parca.ts` (panel · tablet · satıcı bayt-eşit ayna). Panel isteği sığmıyorsa her parçayı `…/q#<encodeURIComponent(parça)>` adresi olarak sırayla gösterir; /q sayfası parçaları yerel depoda (≤ 15 dk) biriktirip birleştirir, tek zarfı eskisi gibi kabul eder. /q sayfası yanıtı çok parçalı QR olarak gösterir; tablet parçaları toplayıp `POST /cevrimdisi-yanit`e TEK metin gönderir (uç değişmedi).
- **Kod taşıyan zarf istekleri (D12):** panel `cevrimdisi-istek` ve `aktarma-istegi`yi `POST` gövdesiyle (`{ amac, kod? }`) ister; POST ucu olmayan eski backend 404 dönerse bir kez `GET ?amac=&kod=` yoluna düşer. Panel aktarması yalnız `lisans.etkiliyazilim.com` · `lisans-test.etkiliyazilim.com` (https) hedefine gider; döngü adresi yalnız paketlenmemiş derlemede.
- **Kimlikler (D14):** Lisans ekranı iki kimliği TEK kaynaktan, `GET /api/license/detay` yanıtından ayrı gösterir: `kurulum.kurulumId` lisans kimliği, `kurulum.veritabaniKimligi` veritabanı kimliği (yalnız bilgi; eski backend alanı göndermez → "—"). Keşif ucu bu ekran için okunmaz (I3-2).
