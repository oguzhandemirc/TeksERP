# Lisans protokolü — kanonik sözleşme (v:1)

> **Durum:** Faz 1a (2026-09-29), DONMUŞ kontrat — satıcı sunucusu (1b) ve fabrika lisans motoru (1c) buna karşı yazılır.
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
| `protocol/kok-anahtarlar.ts` | `ROOT_PUBLIC_KEYS` (BOŞ doğar, donuk) · `STAGING_ROOT_CLASSES` |
| `protocol/anahtar-zinciri.ts` | `prepareTrustAnchor` · `verifyCertificate` · `verifyEntitlement` · `verifyLease` · `checkLeaseBinding` |
| `protocol/indirme.ts` | İNDİRME belirteci imzala/doğrula + `isDownloadPathAllowed` (CF Worker'ın kâhini) |
| `protocol/istek.ts` | İSTEK imzala/doğrula · `readRequestIdentity` · `bodyDigest` · `generateNonce` · `NonceLedger` · çevrimdışı `zarf` |
| `protocol/parmak-izi.ts` | etken normalleştirme · tuzlu özet · eşleşme kararı (üç sonuç) |
| `protocol/uclar.ts` | satıcı uç yolları, istek/yanıt gövde şemaları, sağlık özeti allowlist'i, zil konuları, satıcı hata kodları, durum/kademe/kip kelime dağarcığı |
| `state.ts` + `state-rules.ts` | SAF lisans durumu (fabrika tarafı; aynaya girmez) |
| `saat.ts` | güvenilir saat hesabı + imzalı `durum.json` belgesi (fabrika tarafı) |

**Güven çapası PARAMETREDİR.** Doğrulama fonksiyonları kök listesini argüman alır; modül düzeyinde değiştirilebilir bir çapa yoktur. Üretim çağıranı `ROOT_PUBLIC_KEYS`ı verir; bu liste bugün **boştur** ⇒ `GUVEN_CAPASI_BOS` ⇒ hiçbir HAK geçerli olamaz (fail-closed). Gerçek kök üretildiğinde listeye bir sürümle eklenir. Test anahtarları src'ye girmez; bekçiler çalışma anında üretir (`Teks-Erp/scripts/lib/lisans-fikstur.ts`).

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
| `tekserp-hak` | KÖK ya da BAYİ | fabrika (satıcı da imzalamadan önce şemadan geçirir) |
| `tekserp-kira` | ALT | fabrika |
| `tekserp-sertifika` | KÖK | fabrika, satıcı |
| `tekserp-istek` | KURULUM | satıcı |
| `tekserp-indirme` | İNDİRME | CF Worker (kâhin: `indirme.ts`) |
| `tekserp-durum` | KURULUM | fabrika (yerel, ağa çıkmaz) |

## 2. Anahtar hiyerarşisi ve güven zinciri

| Anahtar | `kid` biçimi | İmzaladığı | Nasıl güvenilir |
|---|---|---|---|
| KÖK (üretim) | `kok-<yıl>-<n>` | HAK, sertifikalar | çapada, sınıf listesiyle |
| KÖK (hazırlık) | `hazirlik-<yıl>-<n>` | yalnız TEST/DEMO HAK'ı ve sertifikası | çapada; TEST/DEMO dışı sınıf verilirse çapa RED (`GUVEN_CAPASI_BICIM`) |
| ALT | `alt-…` | KİRA | kök imzalı `ALT` sertifikası, kiraya gömülü (`altSertifika`) |
| İNDİRME | `ind-…` | İNDİRME belirteci | kök imzalı `INDIRME` sertifikası; Worker yalnız açık yarıyı tutar |
| BAYİ | `bayi-…` | bayinin tavanı içinde HAK | kök imzalı `BAYI` sertifikası, HAK'a gömülü (`bayiSertifikasi`) |
| KURULUM | `kur-` + base64url(sha256(ham açık anahtar)) | İSTEK, `durum.json` | etkinleştirmede satıcıya kaydedilir |

- **Tek seviye:** kök → sertifika → belge. Sertifika kökün, kök çapanın sınıf yetkisini aşamaz (`KOK_SINIF_YETKISIZ`).
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
| `kurulumId` | uuid | fabrikanın `installationId`si |
| `sinif` | `URETIM` · `TEST` · `DR` · `DEMO` · `BAYI` · `BARINDIRILAN` | |
| `moduller` | modül anahtarı[] (≤ 64, tekrarsız) | TAVAN; biçim `MODULE_SETTING_KEYS` (`finance.enabled`, `depo.multiEnabled`) ya da `patron-bulut`; protokol listeyi BİLMEZ, eşleme 1c'nin |
| `kalici` | bool | |
| `bakimBitis` | ISO | |
| `verilis` | ISO | sertifika zaman denetiminin anı; kira yoksa ek süre çapası |
| `bayiId?` | uuid | bayi sertifikası varsa ZORUNLU |
| `bayiSertifikasi?` | JWS | yalnız bayi imzalı HAK'ta |

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

### SERTİFİKA (`tekserp-sertifika`) — KÖK imzalı

`sertifikaId` (uuid) · `kullanim` (`ALT` · `INDIRME` · `BAYI`) · `kid` (öneki kullanıma bağlı: `alt-` · `ind-` · `bayi-`) · `x` (açık anahtar) · `siniflar` (≥ 1, tekrarsız) · `baslangic`, `bitis` (ISO, `bitis > baslangic`) · `bayi` (`{bayiId, moduller[]}` yalnız `BAYI`'da, diğerlerinde `null`).

### İSTEK (`tekserp-istek`) — KURULUM imzalı

`kurulumId` · `zaman` (ISO) · `nonce` (base64url 22–64) · `amac` (`etkinlestir` · `yokla` · `zil` · `cevrimdisi` · `destek` · `esitle` · `tasima` · `dr-devral`) · `govdeOzeti` (sha256, base64url 43).

### İNDİRME (`tekserp-indirme`) — İNDİRME imzalı

`kanal` · `yolOneki` (tam olarak `/<kanal>/electron/` ya da `/<kanal>/mobil/`) · `kurulumId` · `exp` (ISO). Doğrulama: `simdi > exp + tol` ⇒ `BELGE_SURESI_DOLDU`; `exp − simdi > 70 dk + tol` ⇒ `INDIRME_OMUR`. Yol: önekin ALTINDA (önekin kendisi değil), `..` · `\` · `//` · `%2e` · `%2f` · `%5c` · `%00` RED.

### DURUM (`tekserp-durum`) — yerel, KURULUM imzalı, ağa çıkmaz

`kurulumId` · `kiraId` (birikimin ait olduğu kira) · `birikenMs` · `yazildi` · `yuksekSu` · `sonKiraZorlamasi` (bool \| null) · `sira` (her yazımda artar). Okuma/yazma 1c'nin; şema ve imza `saat.ts`te.

## 4. İstek taşıma ve doğrulama sırası

- İmzalı istek HTTP başlığında: `X-TKL-Istek: <jws>`. `govdeOzeti` = gövdenin **HAM baytlarının** sha256'sı (`bodyDigest`) (sunucu JSON ayrıştırmadan ÖNCEKİ baytları özetler — `express.json` `verify` kancası ya da `express.raw`). Gövdesiz istek (SSE `GET /v1/zil`) boş dizgenin özetini taşır.
- **Satıcı sırası:** ① `readRequestIdentity` (imzasız) → kurulum kaydı; etkinleştirme ve taşımada açık anahtar GÖVDEDEN alınır ve `kid = installationKeyId(x)` olmalı ② `verifyRequest` (typ · imza · şema · `kurulumId` · izinli amaç · ±10 dk · gövde özeti, sabit zamanlı karşılaştırma) ③ **nonce kaydı ATOMİK**: `(kurulumId, nonce)` UNIQUE; saklama = istek `zaman`ı + 10 dk. `NonceLedger` bellek içi karşılığıdır.
- **Çevrimdışı / panel aktarma:** `wrapEnvelope(request, body)` → tek base64url metin (`{v, istek, govde}`); `POST /v1/cevrimdisi` gövdesi `{v, zarf}`. Yanıt imzalı belgeler taşıdığından panel/telefon yanıtı taklit edemez.

## 5. Satıcı uçları (`uclar.ts`)

İstek gövdeleri **KATI** (`strictObject`: tanınmayan anahtar ⇒ `GOVDE_GECERSIZ`), yanıt gövdeleri **GEVŞEK** (v:1 içinde yeni bilgi alanı eklenebilir, eski kurulum yok sayar).

| Uç | Amaç | İstek gövdesi | Yanıt |
|---|---|---|---|
| `POST /v1/etkinlestir` | `etkinlestir` | `ActivateRequestSchema` `{v, kod: TKS-XXXX-XXXX-XXXX, kurulumId, acikAnahtar, parmakIzi, ortam}` | `LicenseResponseSchema` |
| `POST /v1/yokla` | `yokla` | `PollRequestSchema` (aşağıda) | `LicenseResponseSchema` |
| `GET /v1/zil` (SSE) | `zil` | — | `event: zil` / `data: {konu}`; 25 sn'de bir yorum satırı |
| `POST /v1/cevrimdisi` | zarfın içindeki | `OfflineRequestSchema` `{v, zarf}` | `LicenseResponseSchema` |
| `POST /v1/tasima` | `tasima` | `TransferRequestSchema` `{v, kurulumId, acikAnahtar, parmakIzi, ortam, gerekce}` | `TransferResponseSchema` `{v, talepId, durum: BEKLIYOR·ONAYLANDI·REDDEDILDI, lisans \| null}` |
| `POST /v1/dr-devral` | `dr-devral` | `DrTakeoverRequestSchema` `{v, anaKurulumId, gerekce}` | `LicenseResponseSchema` |
| `POST /v1/destek` | `destek` | Faz 3d'de tanımlanır (amaç şimdiden ayrıldı) | — |

- **`PollRequestSchema`:** `sonKiraId` (kira zinciri) · `hak {hakId, surum} \| null` · `parmakIzi` · `durum {gecerlilik, nedenler[], kip, hesaplananKademe, uygulananKademe}` · `saat {duvar, guvenilir, bulgu}` · `ortam` · `saglik` · `gozlem {reddedilecekIstek, reddedilecekModul}`.
- **`ortam`:** `platform` (win32·linux·darwin) · `mimari` (x64·arm64) · `isletimSistemi` ≤120 · `nodeSurum` (`vX.Y.Z`) · `uygulamaSurum` · `derlemeTarihi \| null` · `konteyner`.
- **Sağlık özeti ALLOWLIST'i (`saglik`):** `surum` · `calismaSn` · `dbBoyutBayt` · `yedek {hukum: ok·uyari·kritik·yapilandirilmamis, yasSaat}` · `offsite {yapilandirildi, ok, eksikSayisi}` · `diskDolulukYuzde` · `auditYazmaHatasi` · `havuzZamanAsimi` · `istemciler [{tur: panel·tablet·web·diger, surum, adet}]` (≤50, kullanıcı adı YOK) · `isHatalari [{is, adet}]` (≤50). Serbest metin alanı bilerek yok: ham hata metni, dosya adı, iş verisi yapısal olarak giremez.
- **`LicenseResponseSchema`:** `{v, hak: JWS \| null (yalnız değiştiyse ya da kurulumda yoksa), kira: JWS, indirmeBelirtecleri: [{yolOneki, belirtec}] (≤4), sunucuSaati}`.
- **Zil konuları:** `lisans` · `gelen-kutusu` · `ozet` · `rapor` · `guncelleme` · `destek`. İçerik taşımaz; sahte zil yalnız fazladan yoklama yaptırır.
- **Etkinleştirme kodu:** Crockford base32 (`I/L/O/U` yok); `normalizeActivationCode` büyük harf + `O→0`, `I/L→1` + tire yerleşimi yapar (kullanıcının elle yazdığı kod).

**Hata gövdesi** (backend ile aynı): `{success: false, message: <TR>, details: {code}}`. `details.code` ∈ satıcı kodları ya da protokol doğrulama kodları (aşağıda).

| `details.code` | HTTP | Ne zaman |
|---|---|---|
| `GOVDE_GECERSIZ` | 400 | gövde şemaya uymuyor / allowlist dışı anahtar |
| `PROTOKOL_SURUMU` | 400 | desteklenmeyen `v` |
| `ISTEK_GECERSIZ` ya da protokol kodu (`ISTEK_ZAMAN`, `ISTEK_GOVDE_OZETI`, `ISTEK_KID`, `ISTEK_AMAC`, `ISTEK_KURULUM`, `JWS_*`) | 401 | imzalı istek doğrulanamadı |
| `ISTEK_TEKRAR` | 409 | nonce daha önce görüldü |
| `KURULUM_BILINMIYOR` | 401 | kurulum kaydı yok |
| `KURULUM_IPTAL` | 403 | taşındı/iptal; kira verilmez |
| `ETKINLESTIRME_KODU_GECERSIZ` / `_KULLANILMIS` | 404 / 409 | kod yok / atomik claim kaybedildi |
| `TASIMA_ONAYI_BEKLIYOR` | 409 | ikinci anahtar onay bekliyor (kurulum ek sürede çalışır) |
| `KIRA_VERILMEDI` | 403 | kopya şüphesinin ikinci penceresi |
| `HIZ_SINIRI` | 429 | |
| `SUNUCU_HATASI` | 500 | 503 kullanılmaz |

**Yoklama başarısı tanımı (1c için bağlayıcı):** *başarılı yoklama = geçerli YENİ bir kira alındı.* Ağ hatası, 4xx/5xx, yanıt belgesinin yerelde doğrulanamaması ve `KIRA_VERILMEDI` başarısızdır. Etkinleşmemiş kurulumda yoklama yapılamaz ⇒ başarısız sayılır (ikinci anahtar kendiliğinden sağlanır).

## 6. Parmak izi (`parmak-izi.ts`)

- **Etkenler:** f1 OS makine kimliği (Win `MachineGuid` · Linux `/etc/machine-id` · mac `IOPlatformUUID`) · f2 SMBIOS UUID · f3 sistem diski seri no · f4 birincil FİZİKSEL ağ kartının kalıcı MAC'i · f5 PostgreSQL `system_identifier`. CPU kimliği bilerek YOK.
- **Normalleştirme:** NFKC → yalnız harf/rakam → küçük harf. Boş, tek düze (`0000…`, `ffff…`) ve bilinen yer tutucular (`To Be Filled By O.E.M.`, `Default string`, `None`…) ⇒ **ölçülemedi** (`null`). f1/f2 16–64 hex · f3 ≥ 4 karakter · f4 tam 12 hex ve evrensel yönetimli, tek noktaya (yerel yönetimli/sanal ya da çok noktaya MAC ⇒ ölçülemedi) · f5 1–20 rakam.
- **Özet:** `HMAC-SHA256(kurulum tuzu ≥ 16 bayt, "<etken>\x1f<değer>")`, base64url. Ham kimlik dışarı çıkmaz; alan öneki aynı değerin iki etkende çakışmasını önler; tuz kurulum başınadır (`LICENSE_DIR`'de, 1c).
- **Karar — üç sonuç:** iki tarafta da ölçülebilen etken sayısı `n` (bir tarafta `null` olan paydadan çıkar, uyuşmazlık SAYILMAZ). `n < 2` ⇒ `OLCULEMEDI`; aksi hâlde eşleşen ≥ `min(3, n)` ⇒ `ESLESTI`, değilse `ESLESMEDI`. DR sınıfında f5 dışarıda (`f5Haric`).

## 7. Lisans durumu (`state.ts` — fabrika tarafı, SAF)

**Girdi** (`LicenseStateInput`, 1c doldurur): `kurulumId` · `kurulumAnahtarKimligi` · `hak`, `kira` (`DocResult`: `YOK` · `GECERSIZ(kod)` · `GECERLI(değer)` — `verifyLicenseDocuments` ile üretilir) · `saat {duvarMs, yuksekSuMs, monotonik: {kiraId, gecenMs} \| null, durumDosyasiGecerli}` · `parmakIziEslesme` · `butunluk` (`GECERLI` · `GECERSIZ` · `OLCULEMEDI` · `KAPSAM_DISI` — Faz 1'de `KAPSAM_DISI`) · `derlemeTarihiMs` · `ilkAcilisMs` (**DB'den** türer — dosya silmekle yenilenmez) · `sonYoklamaBasarisizMi` (son 24 sa) · `varsayilanKip` (derleme) · `sonKiraZorlamasi` (`durum.json`'dan).

**Çıktı** (`LicenseState`): `gecerlilik` (GECERLI · GECERSIZ · OLCULEMEDI) · `nedenler[{kod, ayrinti}]` · `kip` · **`hesaplananKademe` ↔ `uygulananKademe`** · **`hesaplanan` ↔ `uygulanan`** etki (`bant {metin, ton}`, `guncellemeIzni`, `modulTavani`) · `ekSureKalanGun` · `kisitlamaKalanGun` · `devredildi` · `yaptirimKademesi` · `saat`. Modül okuyucusu: `readX = readXRaw ∧ isModuleLicensed(durum, anahtar)`.

**Kurallar** (her biri bekçide pozitif + karşı kontrolle):

1. **Kullanılabilir belge.** HAK: `GECERLI` ve `kurulumId` yerelle eşit. Kira: `GECERLI`, `kurulumId` ve `kurulumAnahtarKimligi` yerelle eşit, HAK kullanılabilirse ona bağlı (`checkLeaseBinding`). HAK bozuk olsa da kuruluma bağlı kira kullanılır (imzalı zaman çapası + sunucu kararı taşır).
2. **Geçerlilik:** GEÇERSİZ nedeni (HAK/kira yok·bozuk·bağ uyuşmaz, parmak izi uyuşmaz, bütünlük uyuşmaz) ÖLÇÜLEMEDİ nedenini (saat ileri/geri, durum kaydı, parmak izi/bütünlük ölçülemedi, ilk açılış bilinmiyor) ezer. GEÇERLİ olmayan her durum en az `UYARI`.
3. **Ek süre İMZALI tarihten türer** — çapa sırası: kullanılabilir kira ⇒ `min(bitis, gecerlilikBitis)` + `ekSureGun` · kira yok/bozuk ama HAK var ⇒ `hak.verilis` + 30 · ikisi de yok ⇒ `ilkAcilis` + 30 · o da yok ⇒ ÖLÇÜLEMEDİ (kısıtlama yok). Dosya silmek ek süreyi yenilemez, K4'ü kaldırmaz.
4. **Zamanın getirdiği KISITLI iki anahtarlıdır:** çapa + ek süre geçmiş VE `sonYoklamaBasarisizMi`. İkinci anahtar yoksa `EK_SURE` (0 gün) + `EK_SURE_BITTI` nedeni — internet varken kademeyi yalnız sunucu düşürür. Aynı kural bakım ihlaline de uygulanır.
5. **Sunucunun imzalı kararı tek anahtarlıdır:** K3 tarihi geçti · K4 ⇒ `KISITLI`; K5 ⇒ `DURDURULMUS`; `devredildi` ⇒ `KISITLI` + tehlike bandı. K0 ⇒ `NORMAL` + bilgi bandı (mesaj). K1 ya da `guncellemeDonuk` ⇒ güncelleme kesilir. `donmusModuller` (K2) ⇒ tavandan düşer. K3 tarihinden önce ⇒ `UYARI` + geri sayım.
6. **Bakım:** bakım içinde derlenmiş sürüm durmaz (bakım bitince yalnız güncelleme kesilir, `BAKIM_BITTI`); bakım SONRASI derlenmiş sürüm ⇒ derleme tarihinden 30 gün `EK_SURE`, sonra (iki anahtarla) `KISITLI`. Bakıma ≤ 30 gün ⇒ `BAKIM_BITIYOR` bilgisi. Derleme tarihi yoksa değerlendirilmez (`DERLEME_TARIHI_YOK` bilgisi).
7. **Modül tavanı** yalnız kullanılabilir HAK varken VE geçerlilik ÖLÇÜLEMEDİ değilken VE kademe `EK_SURE` değilken uygulanır: `izinli = hak.moduller − donmusModuller`. Aksi hâlde ham bayrak geçer (`production` satır yokken TRUE okunduğu için lisans belirsizliği üretimi kapatmaz).
8. **Kip:** kullanılabilir kira ⇒ `kira.zorlama`; değilse `sonKiraZorlamasi` (silinen kira kipi gevşetmesin); o da yoksa derleme varsayılanı.
9. **Gözlem kipinde** her şey hesaplanır (`hesaplanan*`) ama **uygulanan** etki bugünkü davranıştır: kademe `NORMAL`, bant yok, güncelleme serbest, tavan yok (`OBSERVE_EFFECT`, sıfır fark).
10. **Bant** en şiddetli bulgunun bandıdır (eşitlikte ilk yazılan).

## 8. Saat modeli (`saat.ts`)

- **Tahmin** = kira `sunucuSaati` + son kiradan beri BİRİKEN monotonik süre (`process.hrtime`; makine kapalıyken birikmez ⇒ gerçek zamanın ALT sınırı). Birikim imzalı `durum.json`'da, kiraya bağlı (`kiraId`); başka kiranınki okunmaz.
- **Üst eşik** = tahmin + yoklama aralığı + tolerans. **Yüksek su** = hiç geri gitmeyen iz (son kira sunucu saati ∨ defterlerdeki en büyük `createdAt`).
- Monotonik ölçülebiliyorken: yüksek su üst eşiği aşıyorsa alt sınır olarak **hiç kullanılmaz** (geçmişte ileri giden bir saatin zehirlediği iz; `SAAT_ILERI`/`YUKSEK_SU` raporlanır); duvar < alt sınır − tol ⇒ `SAAT_GERI`, güvenilir = alt sınır; duvar > üst eşik ⇒ `SAAT_ILERI`, güvenilir = alt sınır (**erken bitiş YOK**); aksi hâlde güvenilir = max(duvar, alt sınır).
- Monotonik yokken (dosya yok/bozuk/başka kira): `DURUM_DOSYASI` (ÖLÇÜLEMEDİ) + güvenilir = max(duvar, yüksek su); duvar < yüksek su − tol ⇒ `SAAT_GERI`.
- `accumulatedRuntime({storedMs, loadHrNs, nowHrNs})`: hrtime geri gitmiş görünürse birikim küçülmez.

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
| `ISTEK_KID` · `ISTEK_AMAC` · `ISTEK_ZAMAN` · `ISTEK_KURULUM` · `ISTEK_GOVDE_OZETI` · `ISTEK_TEKRAR` | istek doğrulama adımları |
| `ZARF_BICIM` | çevrimdışı zarf çözülemedi |

## 11. Bilinen sınırlar (kabul edilen risk, plan §12 ile uyumlu)

- **Çevrimdışı saat hilesi:** `durum.json`'u geri yüklemek ya da silip saati geri almak, monotonik tahmini geriye çeker; "erken bitiş yok" ilkesi gereği güvenilir saat tahmine yaslanır ⇒ çevrimdışı zarf uzayabilir. Çevrimiçiyken kira zinciri ve sunucu kararı kapatır; kalıcı savunma Faz 2 (native çekirdek, DPAPI/sayaç). `sira` alanı geri yüklemeyi portal raporunda görünür kılar.
- **Kira silme + `durum.json` silme** birlikte yapılırsa kip derleme varsayılanına düşer (Faz 4'e dek `gozlem`). Faz 1–3'te sahadaki kod zaten okunur JS'tir (plan §12).
- **K2 ve ek süre:** plan kuralı gereği ek sürede tavan ham değere düşer; dondurulan modül kira süresi dolup ek süreye girince açılır (sonra KISITLI). Aşağıda karar notu olarak işaretli.
- İmza doğrulaması TS'tedir; Faz 2'de native çekirdeğe geçer, bu dosyalar test kâhini kalır.

## 12. Plandan sapmalar ve genişlemeler (bu dilimde yapıldı — gözden geçirilecek)

1. **Nonce saklama süresi:** plan "15 dk" diyor; ±10 dk zaman toleransı geçerli pencereyi **20 dk** yapar (+10 dk ileri damgalı istek 19. dakikada hâlâ zaman denetiminden geçer). Uygulanan: istek `zaman`ı + 10 dk (kesin). Bekçi §3n.
2. **Uç ve amaç genişlemesi:** `tasima` ve `dr-devral` amaçları + `POST /v1/tasima`, `POST /v1/dr-devral` eklendi — fabrikanın `tasima-talebi`/`dr-devral` uçlarının satıcıda karşılığı yoktu; taşımada yeni anahtar kayıtlı olmadığı için imzalı istek gövdedeki anahtarla doğrulanmak zorunda.
3. **Belge ek alanları:** HAK `verilis` (sertifika zaman denetimi + kirasız ek süre çapası); KİRA `devredildi` (plan "DEVREDİLDİ alır" diyor ama taşıyıcı alanı tanımlamıyordu — imzalı olmalı); sertifikalara `siniflar` (hazırlık kökünün alt anahtarı üretim kurulumuna kira veremesin); yerel `durum.json` için `tekserp-durum` türü.
4. **Kira ömür tavanı 45 gün, ek süre 0–60 gün** (plan 30 gün kira / 30 gün ek süre diyor; tavan sızmış alt anahtarla geriye tarihli uzun kira basmayı sınırlar).
5. **Durum girdisi biçimi:** görev tanımındaki `hak?, kira?, dogrulamaSonuclari` üçlüsü tek ayrık birleşimde (`DocResult`) toplandı — belge ile doğrulama sonucunun tutarsız verilmesi tip düzeyinde imkânsız. görevdeki `monotonikGecen?` girdisi `monotonik: {kiraId, gecenMs}` oldu (başka kiranın birikimi okunmasın). Ek girdiler: `installationKeyId`, `ilkAcilisMs`, `sonKiraZorlamasi`.
6. **Kira YOK/bozuk ama HAK varken çapa `hak.verilis`** (plan yalnız kira ve ilk açılışı sayıyor): silme kaçışını kapatır, imzalı tarihten türer.
7. **Yüksek su zehirlenmesi:** plan yüksek suyu doğrudan alt sınır sayıyor; tahminin üst eşiğini aşan yüksek su yok sayılır ve raporlanır (aksi hâlde geçmişte bir kez ileri giden saat fabrikayı kalıcı ek süreye iterdi — bekçi §5e bu kusuru yazım sırasında yakaladı).
8. **Adlandırma:** plan ve görev metni kod adlarını Türkçe veriyor (`KOK_ACIK_ANAHTARLAR`, `lisansModuluAcik`…); `src/` bildirim adları `[IL-16]`/`[IL-32]` gereği İngilizce yazıldı (bekçi `test_identifier_language` ilk Türkçe yazımda 115 yeni ad saydı). Karşılıklar 12a tablosunda; tel alanları ve değerler Türkçe.
9. **Karar bekleyen (1e/kullanıcı):** K2 dondurulmuş modülün ek sürede ham değere düşmesi plana sadık uygulandı; "sunucu kararı olduğu için dondurma ek sürede de sürsün" alternatifi tek satırlık değişikliktir (`state.ts` `etkiHesapla`).

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

## 13. 1b / 1c için bağlayıcı notlar

- **1b (satıcı):** imzalamadan önce `signDocument` şemadan geçirir (geçmeyen belge imzalanmaz). HAK imzasında bayinin GÜNCEL tavanı ayrıca denetlenir (sertifika kısıtı yetmez). Nonce `(kurulumId, nonce)` UNIQUE, saklama `zaman` + 10 dk. Yanıtı isteğin `v`siyle üret. Kira zinciri: yoklamadaki `sonKiraId` ucu tutar (plan §4 çatal üç hâli). Kök çapasını kendi kök listesiyle aynı dosyadan (ayna) okur.
- **1c (fabrika):** `ilkAcilisMs` DB'den (silinmeyen veri: kurulum kimliği satırının `createdAt`i ya da en eski defter kaydı); `yuksekSuMs` yalnız sunucu saati + defter `createdAt`inden (güvenilir saatin kendisini yüksek suya yazma — döngüsel zehirlenme); `sonYoklamaBasarisizMi` §5'teki tanımla; `durum.json` her yazımda `sira++`, yeni kira kabulünde `birikenMs = 0` + `kiraId` güncellenir, `sonKiraZorlamasi` son kullanılabilir kiradan. Parmak izi eşleşmesi kiranın `parmakIzi` kümesine karşı (`compareFingerprints`, DR'de `f5Haric`). `butunluk` Faz 2'ye dek `KAPSAM_DISI`. Yoklama gövdesini `PollRequestSchema.parse` ile kur (allowlist dışı alan kod yolunda patlar).
