# Tek ortak paket — sürüm başına tek paket, kimlik lisanstan, yayın güncelleme gruplarıyla

> **Durum:** TASARIM (2026-10-06 gece). Kod yok; kodlama §9'daki dilimlerle, dilim başına bir ajan. İş listesi 3.1 ([DEMOFABRIKA-KURULUM-BULGULARI.md](../plan/DEMOFABRIKA-KURULUM-BULGULARI.md) Faz 3); K2 (firma adı) ve K3 (Tailscale kutusu / gömülü adres) burada kapanır.
> **Bağlayıcı kararlar:** arşiv `docs/history/arsiv/2026-10.md` → "2026-10-03 — Tek ana dal + sürüm başına TEK ortak paket" · "2026-10-03 — adnansahin dondurulur" · "2026-10-02 — Müşteri sunucusu Tailscale ağımıza alınmaz" · "2026-10-05 — Hazırlık satıcısı emekli"; 2026-10-06 gece kullanıcı kararları (§0.2).
> **Komşu belgeler:** [PAKET-ANAHTARI-KOK-ALTINDA.md](PAKET-ANAHTARI-KOK-ALTINDA.md) (3.9, dal `gece/paket-anahtar-d13`; doğrulayıcıları D1–D3 bu işten ÖNCE iner) · [GUNCELLEYICI.md](GUNCELLEYICI.md) · runbook `docs/ops/INDIRME-KAPISI-WORKER.md` · 3.2 hazırlık notu `Teks-Erp-wt/INDIRME-KAPISI-YAYIN-TALIMATI.md` (repo dışı) · kurallar [surum-yayin.md](../kurallar/surum-yayin.md) · [deploy-kurulum.md](../kurallar/deploy-kurulum.md) · [lisans.md](../kurallar/lisans.md).
> **Onay:** kullanıcı 3.1'in tamamının bu gece yapılmasını istedi ve tasarım onayını 1e'ye bıraktı. Gerçek kullanıcı kararı gerektiren yerlerde makul varsayılan yazıldı ve **KARAR** diye işaretlendi (§10).

## 0. Özet

### 0.1 Bir cümlede

Aynı commit'ten her ürün için TEK paket çıkar (backend · panel · fabrika tableti · patron); paket hiçbir müşteri kimliği taşımaz. Kurulum kimliğini etkinleştirme kodundan, firma adını lisanstan (HAK `musteri.ad`), güncelleme grubunu kiradan (`kanal.kod` = grup) öğrenir. Yayın `indir.etkiliyazilim.com/<grup>/…` adresine yapılır; sıra `test → oncu → genel`. adnansahin'in eski kanalı (`guncelleme.etkiliyazilim.com/adnansahin/*`) ve `deploy/kanallar.json` bu işin hiçbir adımında değişmez.

| Konu | Bugün (ölçüldü, §1) | Hedef (§2) |
|---|---|---|
| Panel kimliği | `TEKSERP_KANAL` ile derleme anında; appId/ürün adı/adres kanaldan | tek kimlik (`deploy/dagitim.json`), derleme argümansız |
| Tablet kimliği | paket adı, ERP adresi, OTA sertifikası, güncelleme adresi kanaldan | tek paket adı, tek OTA sertifikası, ERP adresi YOK (keşif / elle IP) |
| Backend paketi | `paketle.ps1 -Musteri`; filigrana müşteri kodu | argümansız tek paket; filigranda müşteri yok |
| Patron | zaten tek paket (`com.etkiliyazilim.tekserp.patron`) | değişmez |
| Güncelleme yolu | `/<kanal>/<ürün>/` · `guncelleme.etkiliyazilim.com` · kapısız | `/<grup>/<ürün>/` · `indir.etkiliyazilim.com` · Worker kapısı |
| Grup nereden | — (kanal pakete gömülü) | satıcıda kurulumun grubu → kira `kanal.kod` → belirteç `yolOneki` |
| Terfi | hazırlık → üretim kanalı (`terfi/<kanal>/…`) | `test → oncu → genel` (`terfi/<grup>/…`) |
| Firma adı | panelde elle `company.name`; keşifte "TeksERP" | HAK `musteri.ad` → keşif + ekran; `company.name` ilk değeri |
| Tailscale | sihirbazda kutu | sihirbazdan ve cevap şemasından kalkar |
| Test yükü | tek (varsayılan) profil | gerçek fabrika profilleri + hepsi kapalı + hepsi açık |
| Hazırlık kipi | kanal türü, çapa kipi, satıcı `ORTAM=hazirlik`, native `hazirlik-capasi` | koddan kalkar; DB enum değerleri kalır (yazan yol yok) |

### 0.2 Bu tasarımı bağlayan kullanıcı kararları

1. Her ürün için sürüm başına TEK paket. Müşteri kimliği etkinleştirme kodu ve lisanstan gelir. Filigran kurulumda basılır. (2026-10-03)
2. Yayın güncelleme GRUPLARIYLA yapılır: test → öncü → genel. Müşteri başına kanal ve derleme düzeni bu modele taşınır. (2026-10-03)
3. Yeni indirme adresi `indir.etkiliyazilim.com`. Kapı yalnız orada çalışır, klasörler `/test`, `/oncu`, `/genel`. Eski adres adnansahin için olduğu gibi kalır. (2026-10-03, 2026-10-06)
4. Firma adı lisanstan gelir: portalda müşteriye girilen ad etkinleştirmede sunucuya gelir; keşif kimliği ve ekrandaki ad bundan türer. (2026-10-06)
5. Tailscale kutusu müşteri kurulumundan TAMAMEN kalkar; tablete `ts.net` adı gömülmez (yerel ağ keşfi / elle IP / QR). (2026-10-02, 2026-10-06)
6. Test yükü = gerçek fabrika profilleri (her müşterinin ayar düzeni, adıyla bir profil; her sürüm hepsiyle) + hepsi kapalı + hepsi açık. (2026-10-06)
7. Hazırlık satıcısı ve hazırlık kökü KODDAN kaldırılır. (2026-10-05, 2026-10-06)
8. "Önce test, sonra fabrika" kuralının hedefi yeni test kurulumudur (üretim satıcısında `test` grubu). (2026-10-05)
9. adnansahin dondurulmuştur (sunucu 2.11.2 · panel 1.3.7 · tablet OTA 1.0.12). Ortak paket ona geriye uyum yükü taşımaz, ona hiçbir yayın yapılmaz, eski kanalı çalışır kalır. (2026-10-03, 2026-10-06)
10. PAKET anahtarı kökün altında (3.9): doğrulayıcılar 3.1'den ÖNCE iner. Yeni adres baştan yalnız yeni imza düzeniyle açılır. (2026-10-06)

### 0.3 Ana tasarım seçimleri (1e onayı)

- **S1 — Satıcının `Kanal` varlığı "güncelleme grubu" olur.** Yeni varlık yok. Satıcıda kurulum zaten bir kanala bağlı. Kira `kanal.kod`u taşıyor, belirteç `yolOneki=/<kanal.kod>/<ürün>/` ile basılıyor, güncelleyici kanalı kiradan okuyor. Grup kodları `test`, `oncu` ve `genel` birer kanal satırı olunca tel sözleşmesi DEĞİŞMEZ. Tel adı `kanal` kalır, anlamı gruptur. Böylece eski fabrika ve eski Worker kırılmaz.
- **S2 — Paket grubu bilmez, grubu fabrikanın backend'inden öğrenir.** Backend grubu imzalı kiradan okur. Panel ve tablet grubu backend'in belirteç yanıtındaki yeni `grup` alanından alır. Tek istisna OTA manifest adresidir: expo-updates o adresi native'e gömer. Bu yüzden Worker grup-nötr bir takma ad tanır (`/ota/<rv>/manifest` → `/<belirteç.kanal>/mobil/ota/<rv>/manifest`). Grubu istemcinin beyanı değil, imzalı belirteç belirler.
- **S3 — Terfi, aynı baytları kopyalar ve işaretçiyi hedef grup için yeniden imzalar.** Artefakt (exe · OTA paketi · APK · backend zip) bayt-eşit kopyalanır, terfi aracı özetini kaynak gruptakiyle kıyaslar. İşaretçi (`latest.yml` künyesi · OTA manifesti · `apk/surum.json` künyesi · backend `son.json`) hedef grubun adıyla yeniden imzalanır. Gerekçe: künye "yalnız kendi grubunda geçerli" kalır. Böylece test grubuna çıkmış ama terfi edilmemiş bir sürüm başka grupta kurulamaz.
- **S4 — Yeni kayıt `deploy/dagitim.json`; `deploy/kanallar.json` BAYT-DONUK.** Eski dosya silinmez, düzeltilmez. Bir bekçi sha256'sını sabitler (`9fbdd748…6b9027`, 2026-10-06). Eski kanal betikleri ağaçtan, eski yolun son çalıştığı commit'e konan `eski-kanal-son` etiketiyle emekli olur (§8).
- **S5 — Filigran kurulumdadır.** Bayt kodu filigranında `musteri` ve `kurulumId` artık `null`; `paketId` ve `derlemeTarihi` kalır. Kurulum kimliği `LICENSE_DIR`de durur (bugün de öyle). Lisans sahibi ve lisans no PDF meta verisine çalışma anında girer (bugün de öyle).

## 1. Bugünkü düzen (ölçüldü 2026-10-06, `origin/main` = `2d5aeccd6`)

### 1.1 Kayıt: `deploy/kanallar.json`

Üç kanal kayıtlı. Hepsinin yayın kökü `https://guncelleme.etkiliyazilim.com/<kod>/`.

| Kanal | Tür | Durum (gerçek) | Not |
|---|---|---|---|
| `adnansahin` | uretim, `terfiKaynagi: testfabrika` | CANLI, dondurulmuş; `varsayilan` kanal | panel `com.etkiliyazilim.adnan-sahin-erp` "Adnan Şahin ERP" · tablet `com.teks.erp.mobil` · ERP `192.168.1.250:4000` · backend pm2 `tekserp-backend-yeni` |
| `testfabrika` | hazirlik, ayna adnansahin | EMEKLİ (2026-10-05); yayın ağacı VDS'te `~/emekli/`e taşındı | `guvenCapasi: hazirlik`, satıcı `lisans-test` (DNS silindi) |
| `demofabrika` | hazirlik, `ayna: null` | KALDIRILDI | tablet ERP adresi `thinkpad-1.tail702784.ts.net` (K3'ün kaynağı) |

`varsayilan: adnansahin`, yani commit'li işaretçilerin hepsi adnansahin kimliğini gösteriyor: `Electron/shared/musteri.json`, `mobil/musteri.json`, `Electron/package.json` (`name adnan-sahin-erp-admin`, `productName "Adnan Şahin ERP"`, `build.publish …/adnansahin/electron/`) ve `mobil/app.json` (`com.teks.erp.mobil`, `keystore/ota-certs/certificate.pem`). Kaydı okuyan 44 dosya var (kayıt dışı kopyalar: `Dockerfile`, `korumali-paket.yml`). Ana okuyucular `scripts/lib/kanallar.mjs` (702 satır), `scripts/kanal-kapisi.mjs`, `scripts/check-kanallar.mjs`, `scripts/test_kanal_yayin_kapisi.mjs` (2061 satır).

### 1.2 Kanal kimliği koda nerede giriyor

**Panel (Electron).**
- `deploy/electron-paketle.sh <kod>`, `TEKSERP_KANAL`ı ortama koyar. Ardından `Electron/build-identity.ts` kaydı çözer ve `virtual:tekserp-channel` sanal modülünü üretir. Kod bunu `shared/channel.ts` üzerinden okur.
- Kodda kullanılan değerler:
  - `APP_ID`: `main.ts:119` (`setAppUserModelId`)
  - `WINDOW_TITLE`: `main.ts:61`
  - `DEFAULT_ERP_URL`: `discovery.ipc.ts:191`
  - `UPDATE_FEED_URL`: `shared/update-feed.ts:57`
  - `CHANNEL_CODE`: `updater.ipc.ts:273`
  - `CHANNEL_LABEL` ve `CHANNEL_NAME`: `ChannelBadge.tsx`
- electron-builder'a `-c.appId`, `-c.productName` ve `-c.publish.url` verilir; çıktı `release/<kod>/${version}` dizinine gider.
- Web paneli de aynı kimliği kullanır: `vite.config.web.ts`.
- `update-feed.ts`: `UPDATE_BASE_URL = "https://guncelleme.etkiliyazilim.com/"` sabittir. `ALLOWED_UPDATE_HOST` gömülü adresten türer. `FEED_PATH_PATTERN = /^\/[a-z0-9][a-z0-9-]{0,39}\/electron\/$/`. `isAllowedUpdateUrl`, indirme belirtecinin hangi adrese gidebileceğine karar verir. Ana makine aynı kalırsa yeni adreste başlık eklenmez ve istek 403 alır (3.2 notu §5).
- İndirme belirteci: `shared/download-token.ts` her denetimden önce `GET <backend>/api/license/indirme-belirteci?urun=electron` çağırır. Yanıtta `data.belirtec` var, grup YOK.
- İmzalı künye: `electron/guncelleme/panel-kunye.mjs:113`, `künye.kanal !== channel` → `KUNYE_KANAL`.

**Tablet (mobil).**
- `mobil/app.config.js`, `TEKSERP_KANAL` varsa `scripts/lib/kanal.cjs` ile kanalın paket adını, görünen adını, güncelleme adresini, OTA sertifikasını ve etiketini uygular. Yoksa `scripts/lib/feed.cjs` kullanılır (`YAYIN_KOKU = 'https://guncelleme.etkiliyazilim.com/'`).
- `updates.url = <kök><kanal>/mobil/ota/<runtimeVersion>/manifest` derleme anında AndroidManifest'e gömülür. `app.json`: `runtimeVersion 54.2`, `version 1.0.15`, `versionCode 57`.
- ERP adresi: `EXPO_PUBLIC_API_URL` kanal kaydından gömülür (`scripts/lib/adres.mjs`). Bundle'da yoksa `computeAutoUrl()` `http://localhost:4000/api`a düşer (`store/baseUrlStore.ts:55`, `constants/api.ts:15`).
- İndirme belirteci: `services/downloadToken.service.ts` belirteci `urun=mobil` ile alır. OTA için `Expo-Extra-Params tkl` (`Updates.setExtraParamAsync`), APK için `X-TKL-Indirme` başlığı kullanılır.
- APK künyesi: `services/apkKunye.ts:186`, `künye.kanal !== gömülü kanal` → `KUNYE_KANAL`. İndirme adresi gömülü kanal kökünden türer.
- Her kanalın OTA imza anahtarı AYRIDIR (`surum-yayin.md`).
- Çalışma anında adres değiştirme API'si var (`expo-updates 29.0.20`): `setUpdateURLAndRequestHeadersOverride`. Ama `disableAntiBrickingMeasures: true` istiyor, deneysel. Yalnız başlık değiştiren `setUpdateRequestHeadersOverride` ise adresi değiştiremez. ⇒ Grup-nötr bir gömülü adres gerekir (S2).

**Backend.**
- `deploy/paketle.ps1 -Musteri <kod>`:
  - `kanal-kapisi.mjs backend-paketle` ile `pm2Ad`, `urunAdi`, `hizmetAdi`, `guvenCapasi` ve `lisansSunucusu` değerlerini alır.
  - Filigrana `--musteri` geçer (`build-korumali.mjs:106`: `{musteri, kurulumId, paketId, derlemeTarihi}` → `__TEKSERP_FILIGRAN__`).
  - `PAKET.json`a `backendKanal`, `backendHizmetAdi` ve `backendLisansSunucusu` yazar.
  - `-Musteri` YOKSA bugün "kanal-dışı" tek zip çıkar ve uyarı basılır. Bu, ortak paketin kendisine en yakın yoldur.
- `deploy/hizmet/kanal-adlari.ps1`: hizmet ve güncelleyici adlarına `-<kanal>` soneki ekler, ProgramData kökü `TeksERP-<kanal>` olur. Amaç aynı makinede iki kanalı yan yana kurabilmekti.
- Kurulum:
  - `tekserp-kurulum.iss:201`: `VARSAYILAN_GUNCELLEME = 'https://guncelleme.etkiliyazilim.com'`.
  - `deploy/kurulum/kurulum-arsivi.mjs --musteri <kanal>`, kanalın çapa kipini ve hizmet adını paketle kıyaslar.
- Güncelleyici (Rust):
  - Kanalı İMZALI KİRADAN okur (`policy.rs:66`, `kanal.kod`).
  - Yolları kanaldan kurar: `/<kanal>/backend/son.json` (`release.rs:67`).
  - Bildirim kanalı ile kurulum kanalı eşit olmalı (`release.rs:352`, `SURUM_KANAL`).
  - Paketin müşterisi `null` ise kabul edilir (`release.rs:390`).
  - ⇒ Güncelleyici grup modeline bugünden hazır. Sunucu adresi `ayar.json guncellemeSunucusu`dan gelir.
- CI: `korumali-paket.yml` `musteri` girdisini alır ve çapa kipini kanaldan seçer.

**Patron.** `patron/uygulama/app.json` tek kimlik taşır (`com.etkiliyazilim.tekserp.patron`, OTA yok). Bulut adresi `EXPO_PUBLIC_PATRON_API` derleme anında verilir (`src/lib/config.ts`, "tek mağaza uygulaması"). ⇒ Zaten tek paket; bu iş patron uygulamasının koduna dokunmaz. Yalnız mağaza test kanalları ileride gruplara eşlenir (3.7).

### 1.3 Satıcı — grup modelinin yarısı zaten var

- `model Kanal {kod @unique, ad, tur KanalTuru(uretim|hazirlik), guncelSurumler Json}` (`schema.prisma:192`). Kod biçim seddi `^[a-z0-9][a-z0-9-]{0,39}$`. Kurulum `kanalKodu` FK ile kanala bağlı (`onDelete: Restrict`).
- Portal: `GET /kanallar`, `POST|PATCH /kanallar` (`kanal:yonet`), sayfa `portal/pages/Channels.tsx`. Kurulum düzenleme kanalı değiştirebiliyor; değişince zil çalıyor (`master-data.service.ts:251`). Bayi tavanında `kanallar` listesi var.
- Kira `kanal: {kod, guncelSurumler}` taşıyor (`lease.service.ts:259`). İndirme belirteçleri `yolOneki = /${kanalKodu}/${urun}/` ile basılıyor (`lease.service.ts:305`).
- HAK `musteri: {id, ad}` ve `tesis: {id, ad}` taşıyor (`belgeler.ts:130`), yani firma adı lisansta ZATEN var (K2).
- Yayın görünümü (`distribution/releases.view.ts`) yayın kökünden kanal başına okuyor. Yayın bildirimi (`publications.service.ts`) kanal başına; yayıncı anahtarı üretim portalına henüz kayıtlı değil (bildirim kapalı, 2026-10-05).
- Worker (`deploy/guncelleme-sunucusu/worker/indirme-kapisi.js`, 533 satır): `yolOneki === /<kanal>/<ürün>/` doğruluyor; `indirmeListesi.{uretim,hazirlik}` ayrı. 3.2 taslak ayarı `kanallar: ["test","oncu","genel"]` ile `ok: true` verdi.

### 1.4 Hazırlık kipinin izi

124 dosya, 834 satırda `hazirlik` geçiyor (`docs` ve migration'lar hariç). ⚠️ Sözcüğün üç anlamı var:
- **(a)** çapa/satıcı kipi: kök `hazirlik-2026-1`, `paket-hazirlik`, native `hazirlik-capasi`, satıcı `ORTAM=hazirlik`, `GUVEN_CAPASI`;
- **(b)** kanal türü: `KanalTuru.hazirlik`, `kanallar.json tur`;
- **(c)** ilgisiz anlamlar: güncelleyicinin "hazırlık" aşaması, e2e güzergâhlarındaki "HAZIRLIK (API)" adımı.

Yalnız (a) ve (b) kalkar. Ölçülen kümeler:

| Küme | Dosya |
|---|---|
| `STAGING_ROOT*` | 17 |
| `hazirlik-capasi` | 18 |
| `paket-hazirlik` | 31 |
| `hazirlik-2026` | 17 |
| `STAGING_PACKAGE*` | 11 |
| `satici-hazirlik` | 15 |
| `lisans-test` | 12 |
| `KanalTuru` / `CHANNEL_KINDS` | 5 |
| `guvenCapasi` | 20 |

Yerleri:
- DB enum'ları: `AnahtarTuru.HAZIRLIK_KOK` (`schema.prisma:143`, `key-store.ts:171,232`) ve `KanalTuru.hazirlik`.
- `teslim-paketle.sh:25`: varsayılan PAKET anahtarı silinmiş `~/.tekserp/satici-hazirlik/paket-hazirlik.paket.json`.
- `Electron/shared/license-relay.ts:47`: `LICENSE_VENDOR_HOSTS`ta `lisans-test`.
- Bütün bir araç: `deploy/lisans-devreye/` (testfabrika devreye alma, `saticiKok: lisans-test`).
- `deploy/satici/ornek.env` (`SATICI_HOST=lisans-test`).

### 1.5 Tailscale izi (K3)

- `tekserp-kurulum.iss:874`: kutu "Tailscale ağından da erişilsin (100.64.0.0/10)". Kodda varsayılanı `False` (`:878`). AMA `:976` önceki kurulumun cevabı varsa kutuyu ondan kuruyor: `Pos('100.64.0.0/10', Olc('oncekiAgIzinli')) > 0`. demofabrika'da kutunun açık görünmesinin en olası açıklaması bu: aynı thinkpad'de önceki kurulum Tailscale'liydi. Ölçülmedi, D0 kapatır.
- `cevap-semasi.json:20` `api.izinliAdresler` seçeneklerinde `100.64.0.0/10` var.
- `kurulum.ps1:350` "kayıttaki erişimi DARALTMAZ".
- Tablete `ts.net` adı yalnız demofabrika kaydında gömülü (emekli).

### 1.6 Test düzeni

- `npm test`: 758 `test_*.ts`, varsayılan profilde tek koşum. Kurulum profilleri `constants/module-profiles.ts`ta (`basit`, `standart`, `perde`, `perde-dokuma`, `dokuma`, `tam`) yalnız modül anahtarlarını taşır, davranış bayraklarını taşımaz.
- Profil matrisi koşucusu YOK.
- Var olan testlerin çoğu tabanın "varsayılan = kapalı" olduğunu varsayıp kendi bayrağını kendisi kurar. Bu yüzden bütün takım "hepsi açık" tabanında koşturulursa fikstür kaynaklı kırmızılar üretir (§6.3).

## 2. Hedef düzen

### 2.1 Tek kayıt: `deploy/dagitim.json` (YENİ; davranış taşımaz, kapalı şema)

```json
{
  "urun": {
    "panel":   { "appId": "com.etkiliyazilim.tekserp", "urunAdi": "TeksERP", "paketAdi": "tekserp-panel" },
    "tablet":  { "androidPaket": "com.etkiliyazilim.tekserp", "gorunenAd": "TeksERP", "runtimeVersion": "55.0", "otaSertifika": "keystore/ota-certs-ortak/certificate.pem" },
    "backend": { "urunAdi": "TeksERP Sunucu", "hizmetAdi": "TeksERP-Backend" }
  },
  "indirmeKoku": "https://indir.etkiliyazilim.com/",
  "vdsKoku": "/opt/stack/apps/tekserp-indir/html",
  "defterKoku": "/opt/stack/apps/tekserp-indir/defter",
  "lisansSunucusu": "https://lisans.etkiliyazilim.com",
  "gruplar": [
    { "kod": "test",  "ad": "Test",  "terfiKaynagi": null },
    { "kod": "oncu",  "ad": "Öncü",  "terfiKaynagi": "test" },
    { "kod": "genel", "ad": "Genel", "terfiKaynagi": "oncu" }
  ]
}
```

- Yayın adresleri ve VDS yolları kayda YAZILMAZ, `scripts/lib/dagitim.mjs` onları kök + grup + üründen TÜRETİR:
  - panel: `<kök><grup>/electron/`
  - OTA: `<kök><grup>/mobil/ota/<rv>/manifest`
  - APK künyesi: `<kök><grup>/mobil/apk/surum.json`
  - backend: `<kök><grup>/backend/son.json`
  - defter: `<defterKoku>/<grup>-<ürün>-YAYIN-DEFTERI.tsv`

  Bugünkü `yayin` bloğu türetimden ayrışabildiği için bekçi istiyordu; türetince ayrışacak bir şey kalmaz.
- Paket adı/appId seçimi ve `runtimeVersion` sıçraması → K-1 / K-2 (onaylandı 2026-10-07).
- Grup listesi ile satıcının grup satırları aynı küme olmalı; bekçi bunu migration metni ile kayıt üzerinden ölçer (§3.1).

### 2.2 Ürün başına hedef

| Ürün | Derleme | Kimlik çalışma anında nereden | Güncelleme |
|---|---|---|---|
| Panel | `deploy/electron-paketle.sh` argümansız; çıktı `release/ortak/<v>/` | firma adı: backend (lisans adı); grup: belirteç yanıtı `grup`; TEST/DEMO rozeti: lisans sınıfı | `https://indir…/<grup>/electron/` + `X-TKL-Indirme`; grup yoksa denetim yapılmaz ("grup bilinmiyor") |
| Tablet | `build-apk.mjs` / `yayinla-ota.mjs` paketlemede argümansız | ERP adresi: keşif / elle IP / (bulutta) QR; grup: belirteç yanıtı | OTA: gömülü `https://indir…/ota/<rv>/manifest` (Worker takma adı) + `tkl`; APK: Google Play gizli yayını (K-14 — tek kurulum ve native güncelleme yolu; `/<grup>/mobil/apk/` ortak tablette kullanılmaz) |
| Backend | `paketle.ps1` argümansız; `PAKET.json backendKanal: null`, hizmet `TeksERP-Backend` | kurulum kimliği `LICENSE_DIR`; firma adı ve grup kiradan/HAK'tan | güncelleyici `guncellemeSunucusu=https://indir.etkiliyazilim.com` + kira `kanal.kod` (değişiklik YOK) |
| Kurulum arşivi | `kurulum-arsivi.mjs` argümansız, sürüm başına TEK arşiv | — | portal ilk kurulum bağlantısı aynı arşivi verir |
| Patron | değişmez | — | mağaza |

### 2.3 Değişmeyenler

- Tel sözleşmesi: kira, belirteç, güncelleyici bildirimi. Tek ek alan, backend'in kendi istemcilerine verdiği `grup`.
- İmzalı künye düzeni (panel/tablet `panel-2026` + yedek; backend PAKET → 3.9 zinciri).
- Yükleme sırası (paket önce, işaretçi EN SON).
- Temiz ağaç ve derleme künyesi bağı.
- Sürüm notu kapısı (`surum-notlari.json`).
- `minVersion` politikası.
- Cloudflare proxy açık.

## 3. Güncelleme grupları

### 3.1 Satıcıda kurulum → grup ataması

- Grup = `Kanal` satırı. Kod DEĞİŞMEZ, çünkü belirtecin yol önekidir.
- Migration yalnız ekler:
  - `kanal.sira INT NULL`, `kanal.aktif BOOLEAN NOT NULL DEFAULT true` sütunları;
  - `test`/`oncu`/`genel` satırları (`INSERT … ON CONFLICT (kod) DO NOTHING`).
- `tur` kolonu DB'de kalır; yeni satır `uretim` yazar, kod okumaz. `KanalTuru.hazirlik` değeri kalır, yazan yol kalkar (§7).
- Eski kanal satırları (`demofabrika`…) silinmez (FK `Restrict`, defter-öncelikli): `aktif=false` olur. Pasif kanala yeni kurulum açılmaz ve kurulum taşınmaz; okuma ve filo görünümü sürer.
- Yazma yolu: `requireChannel` yalnız `aktif` ve `dagitim.json` grubu olan kodu kabul eder. Bayi tavanının `kanallar` listesi de aynı kümeye süzülür.
- Varsayılan grup → K-3 (varsayılan uygulandı: sınıf `TEST` → `test`, diğerleri → `genel`).
- Kim değiştirir → K-4 (onaylandı 2026-10-07: yalnız satıcı tarafı kurulum düzenleme yetkisi; bayi grup değiştiremez, kendi tavanındaki gruplara kurulum açabilir).
- Grup değişimi bugünkü gibi `kurulum_kaydi`na yazılır, sonra zil çalar. Fabrika yeni kirayı alır; sonraki denetimde panel, tablet ve güncelleyici yeni grubu görür.
- **Grup değişince geri sürüm yoktur.** Yeni gruptaki sürüm kuruludan eskiyse panel künyenin "kurulu sürümden yeni" kuralı, tablet `versionCode` kıyası, güncelleyici sürüm kıyası nedeniyle hiçbir şey kurmaz. Kurulum hedef grup yetişene dek bekler. Bu davranış belgelenir ve portal grup değişiminde bunu uyarı olarak yazar.
- `guncelSurumler` grup başınadır. İstemci politikasının `currentVersion`ı kiradan gruba göre gelir; kural değişmez.

### 3.2 Portal ekranı

- `Channels.tsx` → "Güncelleme grupları": kod (salt okunur) · ad · sıra · güncel sürümler (backend · panel · tablet) · kurulum sayısı · aktif.
- Kurulum detayı ve listesi: sütun ve seçici "Güncelleme grubu"; değiştirirken §3.1'deki uyarı gösterilir.
- Filo: grup süzgeci.
- Yayınlar: grup başına "yayında" görünümü (`releases.view.ts` kökü `dagitim.json vdsKoku`).
- Terfi geçmişi: yayın bildirimi defterinden.
- İzin kodları değişmez (`kanal:yonet`, `portal:oku`); yeni izin YOK.

### 3.3 Worker / klasör eşlemesi

| İstek yolu (`indir.etkiliyazilim.com`) | Kaynak (VDS) | Kapı |
|---|---|---|
| `/<grup>/electron/*` | `html/<grup>/electron/` | belirteç; `yolOneki` öneki tutmalı |
| `/<grup>/mobil/apk/*`, `/<grup>/mobil/ota/<rv>/<damga>/*` | `html/<grup>/mobil/…` | belirteç (varlık: `varlikBelirteci` ayarına göre, bugünkü kural) |
| **`/ota/<rv>/manifest`** (takma ad) | `html/<belirteç.kanal>/mobil/ota/<rv>/manifest` | belirteç ZORUNLU, geçiş listesi uygulanmaz; grup YALNIZ doğrulanmış belirteçten |
| `/<grup>/backend/*` | `html/<grup>/backend/…` | belirteç |

- Takma ad Worker'ın içinde çözülür. Kaynağa giden istek yeniden yazılmış yoldur; önbellek anahtarı gerçek yoldur. `DEGISKEN_DOSYA` deseni takma adı da kapsar (`/manifest$`).
- Ayar: `indirmeListesi.uretim` → kid × `kanallar: ["test","oncu","genel"]`. `hazirlik: []` (§7'de alan kalkar). `gecisListesi: []`.
- `ind-2026` yeni adreste kabul EDİLMEZ → K-5 (onaylandı 2026-10-07).
- Rota `indir.etkiliyazilim.com/*`, fail-closed (3.2 notu §3).
- `guncelleme.etkiliyazilim.com`a rota BAĞLANMAZ.

### 3.4 Belirteçte grup

- Satıcıda değişiklik yok: `payload.kanal = Kurulum.kanalKodu` (= grup), `yolOneki = /<grup>/<urun>/`.
- Fabrikada yeni olan tek şey `GET /api/license/indirme-belirteci` yanıtına eklenen `grup` alanıdır (kaynak doğrulanmış kira `kanal.kod`; yalnız `^[a-z0-9][a-z0-9-]{0,39}$`).
- Eski panel ve tablet bu alanı yok sayar; yeni istemci yoksa güncellemeyi denetlemez.

### 3.5 Terfi

- Test grubuna çıkış:
  - terfi etiketi İSTEMEZ;
  - sürüm notu kapısı, temiz ağaç, derleme künyesi ve profil matrisi raporu (§6.4) ister.
- `oncu` ve `genel` grubuna çıkış (`terfiHukmu` aynen, kaynak = grubun `terfiKaynagi`):
  - `HEAD == <ürün>-vX`;
  - `terfi/<grup>/<ürün>-vX` açıklamalı etiketi, mesajı kullanıcının onay cümlesi + saat;
  - kaynak grupta yayındaki sürüm ≥ X;
  - kaynak artefaktın özeti = yüklenecek artefaktın özeti.
- `genel` ayrı onay ister → K-6 (onaylandı 2026-10-07: ayrı etiket).
- Kaçış yalnız `--terfi-atla="<cümle>"`.
- K-6 uygulaması (O10a): `genel` için `oncu` etiketi de HEAD'de olmalı ve iki etiketin cümleleri farklı olmalı; test grubu etiketsizdir. Künye hedef grup adıyla yeniden imzalanır, paket baytı aynı kalır.
- Sürüm notunun onayı ilk terfi etiketidir (`oncu`). Kök CLAUDE.md'deki "hazırlık kanalı" sözcükleri §9 O16'da güncellenir; değişiklik kullanıcı onayıyla yapılır.

## 4. Firma adı lisanstan (K2)

- **Kaynak:** HAK `musteri.ad` (kök/ara imzalı, `belgeler.ts:130`). Portalda müşteri kartına girilen addır. `tesis.ad` ikinci satır olarak taşınır; fabrika bunu yalnız tesis adı müşteri adından farklıysa gösterir.
- **Lisans adı:** backend kabul edilen HAK'tan `lisansAdi`nı türetir. Saf türetimdir, tek helper'da yaşar (`lib/license/licensee-name.ts` önerisi). Okuyucuları:
  1. keşif kimliği (`discovery.service.ts buildDiscoveryIdentity().companyName`; önbellek tazeleyicisi önce lisans adına bakar);
  2. giriş ekranı ve panel başlığındaki firma adı;
  3. PDF meta lisans sahibi (bugünkü kaynakla aynı).
- Etkinleşmemiş kurulumda keşif `companyName = "TeksERP"` + `etkin: false` gösterir. `serverName` (makine adı) zaten ayırt edicidir.
- **`company.name` (belge ve etiket unvanı):** etkinleştirmede ayar satırı YOKSA ya da değeri nötr yedekse (`DEFAULT_COMPANY_NAME`) lisans adıyla bir kez yazılır (audit'li, `SISTEM_ISI`). Sonra panelden düzenlenebilir. Gerekçe: belge unvanı ("… San. ve Tic. Ltd. Şti.") müşterinin kendi kararıdır.
- Portalda ad değişirse yeni HAK sürümü gider: keşif ve ekran adı değişir, `company.name` değişmez. Ekran adı ile belge unvanı ayrı mı tutulsun → KARAR K-7.
- Kural uyumu: "müşteri adı koda gömülmez" güçlenir (ad veriden). `test_firma_adi_dondur` (mevcut kurulumun adı migration ile dondu) bozulmaz: satır varsa dokunulmaz.
- Eski istemci: keşif yükünün alan adları değişmez; yalnız değer değişir.
- Sihirbaz firma adını SORMAZ. Ad portaldan ve lisanstan gelir; tek kaynak.

## 5. Tailscale kutusu kalkar (K3)

- `tekserp-kurulum.iss`: "Tailscale ağından da erişilsin" seçeneği kalkar. `AgSayfasi` indeksleri kayar, `:976` önceki-cevap okuması ve `:1157`, `:1188`, `:1228` dalları da gider. Özet metninden "Tailscale" düşer.
- `cevap-semasi.json`: `api.izinliAdresler.secenek` = `["LocalSubnet"]`. Sessiz kurulumda `100.64.0.0/10` verilirse RED: bilinmeyen seçenek, fail-closed.
- Onarım ve devam: kayıtta `100.64.0.0/10` varsa korunur ama özet, günlük ve sonuç UYARIR ("bu kurulumda eski Tailscale izni var; müşteri kurulumunda olmamalı"). Gerekçe: ÇEKİRDEK "onarım erişimi DARALTMAZ" kuralı değişmez; böyle bir kayıt yalnız bizim emekli makinelerimizde olabilir.
- `ilk-kurulum.ps1`deki `Tailscale-In` üçüncü taraf kural ölçümü kalır (bu kural değiştirilmez, ölçülür; `deploy-kurulum.md`).
- Tablet ve panelde gömülü ERP adresi YOK (§2.2). İlk açılışta tablet "Sunucuyu bul" ekranına düşer (keşif + elle IP). O8 ölçtü: adres yoksa `localhost`a düşülüyordu; artık adres boş kalır ve ilk ekran "Sunucuyu bul"dur (keşif kendiliğinden + elle adres). QR ve firma kodu yalnız bulut modelinde (7.1), bu işin kapsamı dışında.
- `lan-addresses.ts`in Tailscale ve CGNAT elemesi kalır (K1 ile ilgili, ayrı iş 2.5).

## 6. Test profilleri

### 6.1 Profil nedir

- **Profil:** bir fabrikanın AYAR DÜZENİ. İçeriği:
  - ayar anahtarları: on modül anahtarı + davranış bayrakları + sayısal ayarlar. Anahtar uzayı `PATCH /api/feature-flags` şemasının alan adlarıdır (camelCase), DB anahtarı değil; uygulama `setFeatureFlags` servisinden geçer, dışa aktarma (O13b) `getFeatureFlags()` çıktısını okur. Nesne/liste değerliler (`loginMethods`, belge tasarımı, `reportsClosedKeys`) bu dilimde profil dışıdır (`scripts/lib/hepsi-acik.ts` `PROFIL_DISI_ANAHTARLAR`);
  - saat dilimi dönemi.
- **Kapsam dışı:**
  - iş verisi;
  - ana veri (rota, istasyon kataloğu — seed fikstürü onları üretir);
  - sırlar: ayar şifresi özeti, belirteçler, `quickPin`. Allowlist OPT-IN'dir; yeni anahtar dışarıda doğar.
- Biçim: `Teks-Erp/scripts/test-profilleri/<ad>.json` → `{ ad, kaynak, alinma, ayarlar: {anahtar: değer} }`. Bu dizin pakete girmez (`scripts/`).
- Profil adı NÖTR kısa koddur (`f1`, `f2` …); müşteri kodu ↔ profil eşlemesi repo DIŞINDA durur (`~/.tekserp/profil-eslemesi.json`). `test_musteri_adi_kodda_yok` §4 profil dosya adlarında ve metinlerinde üretim kanalının adını ve kodunu arar (1e kararı 2026-10-06, O13b).
- Profilleri kim/nerede tutar → KARAR K-8.

### 6.2 Üç profil sınıfı

1. **`kapali`**: bütün anahtarlar varsayılan değerinde. Bugünkü davranıştır; yeni bayrak kuralının (varsayılan = bugün) tabanıdır.
2. **`acik`**: her modül açık, her boolean bayrak `true`. Enum/sayı bayraklarında değer "en geniş değer" tablosundan gelir (`scripts/lib/hepsi-acik.ts`).
   - Tamlık bekçisi: tabloda karşılığı olmayan her bayrak anahtarı KIRMIZI. Yeni bayrak reçetesine (`RECETELER.md`) "hepsi-açık değerini yaz" adımı eklenir.
   - `MODULE_DEPENDENCIES` ve birbirini dışlayan bayraklar tablo beyanıyla çözülür.
3. **Gerçek fabrika profilleri**: her canlı müşterinin profili. İlk profil `f1`dir (fabrikanın 2026-09-26 dökümünden).
   - Kaynak, fabrika dökümünün KOPYASIdır: `tekserp_<oturum>_test`e geri yükle → `migrate deploy` → `profil-disa-aktar.ts` (bağlantı salt okuma, ölçülür; `--sonda`).
   - Canlı `.env` ya da canlı DB'ye karşı KOŞULMAZ (`GELISTIRME-DONGUSU.md`). Araç hedef DB adının `_test` ile bittiğini ölçer, `tekserp_fabrika_*` sınıfını ve matris DB'lerini reddeder; kaçışı yoktur.
   - Yeni müşteri kurulduğunda profili aynı araçla, ilk yedeğinin kopyasından eklenir.

### 6.3 Matris koşucusu: ne koşar

Bütün `npm test` YALNIZ `kapali` profilde koşar; bugünkü gibi tam kapsamdır. Var olan testler tabanın varsayılan olduğunu varsayar, başka tabanda fikstürden kırmızı verir. Matris, her profilde profile duyarsız bir **P-takımı** koşar (`Teks-Erp/scripts/profil-matrisi.ts`, `agir-is` ile; HTTP ayağı `Teks-Erp/scripts/profil-ptakimi.ts`). Her profil için sırasıyla:

1. taze `tekserp_<oturum>_p_<profil>_test` DB → `migrate deploy` → seed → profilin ayarları (servis katmanından, uçtan değil);
2. açılış sağlığı (`bekci-http` düzeninde 127.0.0.1 test sunucusu);
3. uç kapı matrisi: her kayıtlı uç için beklenen 200/403 `MODULE_DISABLED`; beklenen değer profilin modül kümesinden TEK kaynakla türer (modül kapısı haritası);
4. belge/etiket önizleme dumanı (her şablon türü bir kez render);
5. `test_db_invariants`;
6. üretim akışı dumanı: stok → iş emri → rota adımları → depo → çuval → sevk (profilin açık modüllerine göre dallanır; bugünkü `senaryo-*` iskeleti üstüne).

Kapsam yetmezse genişletmek ayrı karardır → KARAR K-9.

### 6.4 Sürüme bağ

- Kök grubun (zincirde `terfiKaynagi: null`, bugün `test`) DIŞINDAKİ bir gruba her yayın, aynı commit'te TEMİZ ağaçta üretilmiş yeşil bir profil matrisi raporu ister: `~/.tekserp/derleme-kayitlari/profil-matrisi-<commit>.json`. İçeriği: commit, `agacTemiz`, profil listesi, her profilin sonucu ve dosya özeti, `scripts/test-profilleri/` özeti. Kök grup muaftır (1e kararı 2026-10-06: test grubu matrisin kendisinin ilk sahasıdır).
- Rapor yok, bozuk ya da başka commit'in → ÖLÇÜLEMEDİ = DUR; kirli ağaç, kırmızı profil, eksik/fazla ya da rapordan sonra değişmiş profil → İHLAL. Kaçış yalnız kullanıcının cümlesiyle `--profil-matrisi-atla="<cümle>"`; çağıran cümleyi yayın defterine yazar.
- Yüklem `scripts/lib/profil-raporu.mjs`, CLI `scripts/profil-matrisi-kapisi.mjs` (0 geçti/muaf/atlandı · 1 ihlal · 2 ölçülemedi). Grup yayını yapan betik (O10a/O10b/O11b) dağıtım kaydının tüketicisi olur ve kapıyı çağırmak zorundadır: `scripts/test_profil_raporu_kapisi.mjs` §3.

## 7. Hazırlık kökünün ve satıcısının koddan kaldırılması

**Ölçüm sonucu (kaldırılabilir mi):**
- Koddaki (a) ve (b) anlamları kaldırılabilir. Gerekçeler:
  - hazırlık satıcısı ve verisi silindi (2026-10-05);
  - test kurulumu üretim satıcısında TEST sınıfıyla doğacak;
  - hazırlık kipli kurulum sahada yok (D0 ölçer).
- DB enum DEĞERLERİ kaldırılmaz:
  - PostgreSQL `ALTER TYPE … DROP VALUE` desteklemez; tek yol tipi yeniden kurmaktır;
  - migration geri alınamaz, getirisi yok;
  - emsal: `TAILNET` değeri de kaldı.
  - ⇒ `AnahtarTuru.HAZIRLIK_KOK` ve `KanalTuru.hazirlik` DB'de kalır, yazan yol kalkar; bekçi yeni yazımı reddeder.

| Parça | Yapılacak |
|---|---|
| TS protokol (`kok-anahtarlar.ts` `STAGING_ROOT_PUBLIC_KEYS`, `TRUST_ANCHOR_MODES`; `anahtar-zinciri.ts` `hazirlik-` dalı; `saat.ts ROOT_KINDS`; `integrity.ts STAGING_PACKAGE_PUBLIC_KEYS`; `integrity-scope.ts`; `trust-anchor.ts __TEKSERP_GUVEN_CAPASI__`) + satıcı ve patron aynaları | tek kip; derleme sabiti kalkar; `BUTUNLUK_HAZIRLIK_ANAHTARI` kodu ve panel etiketi kalkar |
| Native (`anchor.rs STAGING_*`, `cfg(feature="hazirlik-capasi")`, `trust.rs`/`policy.rs` hazırlık süzgeci, `derle:*:hazirlik` betikleri, `dist-hazirlik/`, test vektörleri, CI iki kipli derleme `ci.yml:553`) | tek kip; `test-anchor` özelliği KALIR (bekçiler dışarıdan çapa ile koşar) |
| Araçlar (`guven-capasi-ekle.ts` kip listesi, `build-korumali-imza.ts` aile kuralı, `paketle.ps1 -NativeYol/-HizmetIkiliDizini` hazırlık yolu, `korumali-paket.yml` kip seçimi, `teslim-paketle.sh` varsayılan anahtarı) | tek aile (`paket-<yıl>`; 3.9 sonrası `pkt-`); `teslim-paketle.sh` varsayılansız: `TEKSERP_PAKET_ANAHTARI` zorunlu, yoksa DUR |
| Satıcı (`compose ORTAM=hazirlik`, `GUVEN_CAPASI` kipi, `ornek.env`, `key-store.ts` `HAZIRLIK_KOK` sınıflaması, `vendor-url` hazırlık dalı, web `labels.ts`) | `ORTAM` yalnız `uretim` (compose denetimi ⑪ uyumlanır); örnek env üretim |
| Fabrika/panel (`vendor-url.ts`, `LICENSE_VENDOR_HOSTS`) | yalnız `lisans.etkiliyazilim.com` |
| Worker (`indirmeListesi.hazirlik`) | alan kalkar; eski biçimli ayar 503 (fail-closed) — ayar O9'da birlikte değişir |
| `deploy/lisans-devreye/` (testfabrika devreye alma) | ağaçtan kalkar (`eski-kanal-son` etiketinde durur) |

⚠️ **Sıra şartı:** 3.9'un D1–D3'ü (`gece/paket-anahtar-d13`) aynı dosyalara dokunuyor: `integrity.ts`, `anchor.rs`, `trust.rs`, `policy.rs`, `guven-capasi-ekle.ts`. ⇒ O14 dilimleri yalnız o dal `main`e indikten SONRA başlar. 3.9 D7 provası "hazırlık kökü"yle tasarlanmıştı; o prova `test-anchor` derlemesine taşınır → KARAR K-10.

## 8. Geçiş planı

### 8.1 adnansahin — DOKUNULMAZ (her adımın birinci şartı)

- `guncelleme.etkiliyazilim.com` (nginx `tekserp-guncelleme`, `html/adnansahin`) değişmez. Worker rotası oraya bağlanmaz. Yeni Traefik yönlendiricisinin Cloudflare IP kısıtı eskisine eklenmez.
- `deploy/kanallar.json` bayt-donuktur. Bekçi `test_eski_kanal_donuk.mjs` sha256'yı sabitler; dosya "değişirse" KIRMIZI verir, ölçemezse ÖLÇÜLEMEDİ.
- adnansahin kanalına hiçbir yayın yapılmaz. Yeni betikler eski kanal yolunu hiç tanımaz: hedefleri yalnız `dagitim.json` gruplarıdır. Eski betikler O15'te ağaçtan kalkar.
- adnansahin'in kurulu istemcileri yeni paketi görmez. Gerekçeler: kimlik farklı (yeni appId ve paket adı yan yana kurulur, üzerine yazmaz); adres farklı (eski feed'e hiçbir şey yüklenmez).
- Altyapıya dokunan her dilimden (O9, 3.2) ÖNCE ve SONRA `node Teks-Erp-wt/indirme-kapisi-olc.mjs --adnansahin` koşulur. Panel `latest.yml`, exe, blockmap, OTA manifesti ve varlığı, APK künyesi ve APK dosyası istenir. Hepsi belirteçsiz 200 dönmeli ve `X-TKL-Kod` taşımamalı; taban 9/9 (2026-10-06).
- Eski yayın yolunun yeniden üretilebilirliği: O15'in ilk adımı, eski kanal betiklerinin son çalıştığı commit'e `eski-kanal-son` açıklamalı etiketini koymaktır. Kullanıcı cümlesiyle acil bir adnansahin işi gerekirse, o etiketten ayrı worktree'de yapılır. Kullanıcı kararı gereği bugün böyle bir iş yok.

### 8.2 Emekliler

- **testfabrika:** kanal kaydı donuk dosyada kalır. Yayın ağacı VDS `~/emekli/testfabrika-html-20261005`. Silinmesi ayrı iş (kullanıcı cümlesiyle, yeni test kurulumu çalışınca).
- **demofabrika:** kaldırıldı. Satıcıdaki kanal satırı `aktif=false` olur (O2 migration'ı). Kurulum kaydına migration dokunmaz (1e-KARAR 2026-10-06, §8.6): etkin kaldıkça kira alır, indirme belirteci almaz; iptal/pasif kullanıcının portal eylemidir. D0 (§8.5): ikisi de bugün etkin; kurulum `ETKIN`, son yoklama 2026-10-05 21:59 UTC.
- **Hazırlık satıcısı:** emekli (2026-10-05). Kod izleri O14'te kalkar.

### 8.3 Sıra

1. **Önkoşullar:**
   - 3.9 D1–D3 `main`e iner;
   - 3.2 altyapısı: DNS `indir` A kaydı (proxy açık), Traefik yönlendiricisi + `tekserp-indir` dizin kökü, Worker rota `indir.etkiliyazilim.com/*` fail-closed. Kullanıcıyla, adnansahin ölçümü önce ve sonra.
2. **Satıcı ÖNCE (O2):** grup satırları, yazma yolu, portal. Fabrika henüz değişmediği için zarar yok: belirteç yolları `/test/…` olur, eski düzende o yol yok.
3. **Backend O3–O4:** yalnız ekler (`grup` alanı, lisans adı). Eski istemci bu alanları yok sayar.
4. **Worker O9:** takma ad + yeni ayar. Yalnız yeni adreste çalışır.
5. **Panel O5–O6 ve tablet O7–O8:** yeni kimlikle paketler. İlk sürümler yeni sürüm numarasıyla çıkar: panel 1.5.0, tablet 1.1.0 (sürüm notu yazılmış).
6. **Yayın O10a/O10b ve backend O11a/O11b:** önce `test` grubu. Backend yayını 3.9 zinciri (D5 araçları + D8 ilk PAKET sertifikası töreni) olmadan yeni adrese ÇIKMAZ ("yeni adres yalnız yeni düzenle", karar 2026-10-06). Panel ve tablet bu bağımlılığı taşımaz.
7. **Test profilleri O13a/O13b:** yayın kapısına bağlanmadan önce rapor üretebilir olmalı. O10'un "matris raporu" kapısı O13b'yle açılır, o güne dek ÖLÇÜLEMEDİ = DUR. ⇒ Sıra O13 önce, sonra O10.
8. **Tailscale O12:** bağımsız, istenen anda.
9. **Eski düzen emekli (O15) → hazırlık koddan (O14a–c) → kurallar/belgeler (O16) → uçtan uca prova (O17).**

### 8.4 Yeni test kurulumu = ilk müşteri

- Yeni test kurulumu üretim satıcısında, `test` grubunda, TEST sınıfı lisansla, thinkpad-1'de sıfırdan yapılır (3.8).
- Adımlar:
  1. portal: müşteri "Etkili Yazılım Test" + tesis + kurulum (grup `test`) + etkinleştirme kodu;
  2. setup.exe (ortak kurulum arşivi);
  3. panelden etkinleştirme;
  4. keşifte firma adı görünür;
  5. ortak tablet Play gizli yayınından (test kanalı) kurulur → sunucuyu keşifle bulur (K-14);
  6. `test` grubuna yeni panel/tablet sürümü → kendiliğinden güncellenir.
- "Önce test, sonra fabrika" kuralının hedefi budur. Bu kurulum çalışmadan hiçbir müşteri grubuna (`oncu`/`genel`) yayın yapılmaz.
- adnansahin'in yeni sisteme alınması Faz 4'tür (yedekten kur; bu belgenin kapsamı dışı). O gün adnansahin satıcıda bir kurulum + grup alır. Aynı makineye kurulursa pm2 düzeni (port 4000) ile çakışma Faz 4 provasının konusudur.

### 8.5 D0 ölçümü (2026-10-06, salt okuma)

Üretim satıcısı: `tekserp-satici-uretim-db`, `BEGIN READ ONLY … ROLLBACK`, son migration `20261005120000_bildirim_bakim_bitisi_olayi`.

| Ölçülen | Sonuç | Tasarıma etkisi |
|---|---|---|
| `kanal` satırları | TEK satır: `demofabrika` ("demofabrika-thinkpad"), **`tur=uretim`**, `guncelSurumler={}` | `test`/`oncu`/`genel` satırlarının hiçbiri yok; O2 üçünü de ekler. Satıcıda `adnansahin` ve `testfabrika` satırı hiç yok. adnansahin satıcıya bağlı değil (Faz 4), bu yüzden O2 onu etkileyemez. |
| Kanal başına kurulum | `demofabrika`: 1 kurulum; `DEMO`, `ETKIN`, `aktif=true`; tesis "test-fabrika"; son yoklama 2026-10-05 21:59 UTC; 105 kira, sonuncusu aynı dakika | §8.2'nin `aktif=false` adımı bugün uygulanmış DEĞİL. O2 migration'ı kanalı (yeni `aktif` sütunu) pasife alır; kurulumu almaz (1e-KARAR, §8.6). Kurulum `ETKIN` kaldığı sürece kira yolu ona kira basmaya devam eder; O2 pasif kurulumun kira/belirteç davranışını ölçmeli. |
| `kanal` sütunları | `id, kod, ad, tur, guncelSurumler, createdAt, updatedAt` (`sira` ve `aktif` yok) | §3.1'deki sütun ekleme gerekli, tasarım değişmez. |
| `AnahtarTuru='HAZIRLIK_KOK'` | 0 satır (anahtar kaydı: KOK 1 · ALT 1+1 emekli · INDIRME 1+1 emekli · ARA 1) | O14 veri taşımaz; enum değeri DB'de kalır, yazan yol kalkar (§7 aynen). |
| `KanalTuru='hazirlik'` | 0 satır | O14c'nin "yeni yazım yok" bekçisi bugünkü veriyle çelişmez. |
| 3.9 D1–D3 `main`de mi | **HAYIR**: üçü de yalnız `gece/paket-anahtar-d13` dalında (commit konuları "PAKET anahtarı kökün altında — D1" · "PAKET zinciri D2" · "PAKET zinciri D3"); `origin/main` = `2d5aeccd6` | O11a ve O14a bu yüzden bekler (bağımlılık sütunu aynen geçerli). O1–O10 ve O12–O13 bu bağımlılığı taşımaz. |
| adnansahin eski kanalı | `indirme-kapisi-olc.mjs --adnansahin`: 9/9 belirteçsiz 200 (O1 öncesi ve sonrası) | Taban korunuyor. |
| demofabrika K3 (önceki cevap) | **ÖLÇÜLEMEDİ**: thinkpad-1 tailnet'te çevrimiçi, ama bu Mac'ten SSH yolu kurulu değil (host anahtarı ve hesap yok). Kod yolu ölçüldü: sihirbaz `:976` kutuyu `oncekiAgIzinli`den kurar. Bu değer `KayitliAgAyari` sırasıyla `kurulum\kurulum.json` (`ag`) → `durum.json` (`ag`) → `cevap-onceki.json` (`api`) → `cevap.json` (`api`) kaynaklarından okunur (`kurulum-ortak.ps1:489`). | Tasarım değişmez: O12 kutuyu tümden kaldırır, kaynak hangisi olursa olsun. Kesin kaynak O17'de thinkpad-1 üzerinde ölçülür (kullanıcıyla). |

### 8.6 O2 canlı veri provası (2026-10-06, Mac'te kopya DB, VDS'e yazım yok)

Kaynak: üretim satıcısı yedeği `satici_20261005_215311.dump.tkenc`, Mac'teki özel yarıyla açıldı, `_test` kopya DB'ye geri yüklendi (bekleyen migration'lar: `20261005120000_bildirim_bakim_bitisi_olayi` + O2).

| Adım | Sonuç |
|---|---|
| Kuru koşum `BEGIN; <O2 migration>; ölçüm; ROLLBACK` | kanal = test 1 · oncu 2 · genel 3 (aktif, `tur=uretim`, `guncelSurumler={}`) + demofabrika (sira NULL, `aktif=false`); ROLLBACK sonrası tek satır, sütun yok |
| `prisma migrate deploy` | iki migration uygulandı; `migrate diff` boş |
| Kurulum / HAK / kira | kurulum 1 (`demofabrika`, `ETKIN`, aktif) · hak 1 · hak sürümü 7 · kira 104 · kurulum kaydı 2; satır özetleri (md5) önce = sonra |
| İkinci koşum | kanal satır özeti değişmez (idempotent) |
| `test_guncelleme_grubu` kopya DB'de | 17/17 |

**1e-KARAR (2026-10-06).** `POST /kanallar` kalktı (grup portaldan açılmaz); migration kurulumu pasife almaz. Ayrıntı arşivde (`docs/history/arsiv/2026-10.md`, "Tek ortak paket O2").

**Üretimde uygulama (kullanıcıyla, ayrı adım).** Yeni satıcı imajı → `satici-yedek … tek` (önce yedek) → `--profile goc run --rm satici-goc` → yukarıdaki üç sorgu (kanal · kurulum grubu · sayımlar) salt okuma → `up -d`. Beklenen: §8.6 tablosu; demofabrika kirası sürer, belirteci kesilir.

## 9. Dilimler

Her dilim tek ajana sığar (≤ ~1 bağlam), kendi bekçilerini koşar, sonunda commit atar; push yok. "Eski istemci" sütunu, sahada o anda var olan istemciyi sorar. Bu işin hiçbir aşamasında yeni sistemde sahada eski istemci yoktur: demofabrika kaldırıldı, testfabrika emekli. adnansahin ayrı kimlik ve ayrı adrestedir. Kalan tek eski istemci sınıfı yeni sistemin kendi önceki sürümleridir; ilk sürümden itibaren her dilim onları da sayar.

| # | Ad | Hedef dosyalar | Bekçiler | Kabul ölçütü | Bağımlılık | Eski istemci ne yapar |
|---|---|---|---|---|---|---|
| **D0** | Ölçüm (kod yok) — YAPILDI 2026-10-06, sonuç §8.5 | — (rapor DEVIR/arşiv notuna) | — | prod satıcıda: `kanal` satırları, kanal başına kurulum sayısı ve durumu, `AnahtarTuru='HAZIRLIK_KOK'` ve `KanalTuru='hazirlik'` satır sayısı (salt okuma, 1e + kullanıcı); 3.9 D1–D3 `main`de mi; adnansahin 9/9; demofabrika kutusunun K3 ölçümü (önceki cevap dosyası) | — | — |
| **O1** | Dağıtım kaydı — YAPILDI 2026-10-06 (dal `gece/ortak-paket-o1`; donma adımı commit kancasında koşulsuz, CI `docs` işinde; defter adı `<grup>-<panel\|tablet\|backend>-YAYIN-DEFTERI.tsv`) | `deploy/dagitim.json` · `scripts/lib/dagitim.mjs` (türetim + grup zinciri) · `scripts/check-dagitim.mjs` (+`--sonda`) · `scripts/test_eski_kanal_donuk.mjs` · kapı kaydı (`scripts/hooks/hizli-mandallar.mjs`) | yeni iki bekçi (negatif sondalı: kapalı şema dışı anahtar · türetim farkı · grup zinciri döngüsü · kanallar.json bir bayt değişimi) | kayıt türetimi 3 grup × 3 ürünün adreslerini üretir; donma bekçisi sha256'yı sabitler; hiçbir tüketici henüz değişmez | — | etkilenmez (yalnız yeni dosya) |
| **O2** | Satıcı: kanal = grup — YAPILDI 2026-10-06 (dal `gece/ortak-paket-o2`, sunucu + web + belge dilimleri; prova §8.6; `POST /kanallar` kalktı, migration kurulumu pasife almaz) | `satici/sunucu/prisma` (migration: `sira`, `aktif`, üç satır) · `channel.service.ts` · `master-data.service.ts` · `dealer.service.ts` · `portal-routes.ts` · `releases.view.ts` (kök) · web `Channels.tsx`, `Installations.tsx`, `InstallationDetailPage.tsx`, `Fleet.tsx`, `Releases.tsx`, `labels.ts` · seed/test ortamı | satıcı `test_portal_uclar` · `test_etkinlestirme` · `test_kira_zinciri` · yeni `test_guncelleme_grubu` (pasif gruba kurulum RED · grup değişimi zil + kayıt · belirteç yolu `/test/…`) · web vitest · migration bekçileri | yeni kurulum yalnız üç gruptan birine açılır; grup değişimi zil çalar; kira ve belirteç yeni grubu taşır; `dagitim.json` grupları = migration satırları (bekçi) | O1 | fabrika: kira biçimi aynı, kanal kodu yalnız değer değiştirir; eski panel portal ekranı yok |
| **O3** | Backend: `grup` alanı — YAPILDI 2026-10-06 (dal `gece/ortak-paket-o3-o9`; küme `lib/license/update-group.ts`, aynası check-dagitim §7; `/api/guncelleme/durum` da `grup` taşır) | `Teks-Erp/src/routes/license.routes.ts` (indirme-belirteci yanıtı) · `services/update-status.service.ts` · `constants/license-routes.ts` · openapi notu | `test_lisans_kapisi` · yeni `test_indirme_grup` (kira yok → `grup: null`; biçimsiz kod → null; yanıt şeması) | yanıt `{belirtec, grup}`; grup yalnız doğrulanmış kiradan | O2 (değer anlamı) | eski panel/tablet `grup`u yok sayar — davranış aynı |
| **O4** | Firma adı lisanstan — YAPILDI 2026-10-06 (dal `gece/ortak-paket-o4-o12`; tohumlama her lisans kabulünde koşullu, boot'ta değil; panel içi başlık `company.name`de kaldı — K-7 yalnız ağ + giriş ekranı) | `lib/license/licensee-name.ts` (yeni, tek helper) · `discovery.service.ts` · HAK kabul yolu (`company.name` ilk değer, audit) · panel giriş ekranı adı okuyucusu · mobil giriş başlığı | `test_discovery_identity` · `test_firma_adi_dondur` · `test_musteri_adi_kodda_yok` · yeni `test_lisans_adi` (etkinleşmemiş → nötr; HAK → keşif adı; satır varsa `company.name` değişmez; yoksa bir kez yazılır) | keşif ve giriş ekranı portal adını gösterir; K2 kapanır | O3 ile bağımsız | keşif yükü alan adları aynı → eski panel adı gösterir |
| **O5** | Panel: ortak kimlik + paketleme — YAPILDI 2026-10-06 (dal `gece/ortak-paket-o5`, üç commit; kimlik `deploy/dagitim.json` `panelKimligi`; harness ortak senaryoları 2o–2o5; bekçi `scripts/test_panel_kimlik.mjs` commit kapısında + CI'da; eski müşteri kodlu yol çıktısı bayt-eşit) | `Electron/build-identity.ts` (eski adı `build-channel.ts`) (dagitim.json'dan, argümansız) · `shared/channel.ts` · `package.json` (`name`, `productName`, `build.appId`, `build.publish` = `<kök>test/electron/` dinlenme tabanı) · `vite.config.web.ts` · `electron.vite.config.ts` · `vitest.config.ts` · `deploy/electron-paketle.sh` (argümansız, `release/ortak/<v>`) · `Dockerfile` (kayıt kopyası) · `shared/musteri.json` kalkar | `update-feed-url.test.ts` (yeniden yazılır: tek kimlik) · paketten geri okuma (asar: appId · ürün adı · `app-update.yml`) · `test_surum.mjs` | aynı commit'ten tek exe; içinden okunan appId `com.etkiliyazilim.tekserp`; kaynakta kanal kimliği literali yok | O1 | adnansahin paneli ayrı appId → yan yana; yeni sistemde önceki sürüm yok |
| **O6** | Panel: grup akışı — YAPILDI 2026-10-06 (dal `gece/ortak-paket-o6`; grup→feed haritası kimlikte `groupFeeds` (`panelKimligi.grupFeedleri`), eski kanalda `null`; `DEFAULT_ERP_URL` eski kanal yolu için kaldı, ortakta zaten `null` — tam kaldırma O15; rozet yalnız oturumda) | `shared/update-feed.ts` (kök `indir`, `<grup>` deseni dagitim gruplarından, ezme kuralı `/<grup>/electron/`) · `shared/download-token.ts` (`grup`) · `electron/ipc/updater.ipc.ts` (feed = kök + grup; grup yoksa denetim yok + durum metni) · `panel-kunye.mjs` (`kanal` = indirilen grup) · `ChannelBadge.tsx` (lisans sınıfından TEST/DEMO) · `discovery.ipc.ts` (`DEFAULT_ERP_URL` kalkar) | `updater-imza-akisi.test.ts` · `download-token.test.ts` · `panel-kunye.test.ts` · `update-imza-arayuz.test.tsx` · `discovery-logic.test.ts` · `test_panel_imza` | belirteç başlığı yalnız `indir` ana makinesine; başka grubun künyesi `KUNYE_KANAL`; grup değişince sonraki denetim yeni gruptan | O3, O5 | yeni sistemin eski sürümü yok (ilk sürüm budur) |
| **O7** | Tablet: ortak kimlik + derleme | `mobil/app.json` (paket adı · ad · `runtimeVersion` · `updates.url` takma ad · ortak OTA sertifikası) · `app.config.js` (kanal dalı kalkar) · `scripts/lib/feed.cjs` (kök `indir`, takma ad) · `scripts/lib/adres.mjs` (ERP adresi gömülmez) · `scripts/build-apk.mjs` (argümansız) · `scripts/lib/kanal.cjs` + `musteri.json` kalkar · ortak OTA anahtar çifti ve APK mührü (Mac'te, `keystore/`, git dışı; kullanıcıyla) | `mobil/src/test/update-feed-url.test.ts` (tek kimlik) · `build-apk.mjs` APK içinden geri okuma (paket adı · `updates.url` · sertifika) · `Teks-Erp/scripts/test_mobile_update.ts` (yol tutarlılığı) | tek APK; gömülü adres `https://indir.etkiliyazilim.com/ota/<rv>/manifest`; bundle'da ERP adresi literali yok | O1 | adnansahin tableti `com.teks.erp.mobil` — ayrı uygulama, yan yana kurulur |
| **O8** | Tablet: grup akışı + ilk açılış | `services/downloadToken.service.ts` (`grup`) · `services/apkKunye.ts` (adres = kök + grup; künye `kanal` = grup) · `services/appUpdate*` · `screens/Common/settings/UpdateSettingsScreen.tsx` (adres denetimi) · `store/baseUrlStore.ts` + ilk açılış "Sunucuyu bul" (ölç; yoksa ekle) · `lib/channelLabel.ts` (lisans sınıfından) | `apkKunye.test.ts` · `appUpdate.apk.test.ts` · `discovery.service.test.ts` · `clientPolicy.service.test.ts` | adres yokken uygulama `localhost`a değil sunucu bulma ekranına gider; APK künyesi gruptan; OTA belirteci `tkl` | O3, O7 | — |
| **O5** | Panel: ortak kimlik + paketleme | `Electron/build-identity.ts` (eski adı build-channel) (dagitim.json'dan, argümansız) · `shared/channel.ts` · `package.json` (`name`, `productName`, `build.appId`, `build.publish` = `<kök>test/electron/` dinlenme tabanı) · `vite.config.web.ts` · `electron.vite.config.ts` · `vitest.config.ts` · `deploy/electron-paketle.sh` (argümansız, `release/ortak/<v>`) · `Dockerfile` (kayıt kopyası) · `shared/musteri.json` kalkar | `update-feed-url.test.ts` (yeniden yazılır: tek kimlik) · paketten geri okuma (asar: appId · ürün adı · `app-update.yml`) · `test_surum.mjs` | aynı commit'ten tek exe; içinden okunan appId `com.etkiliyazilim.tekserp`; kaynakta kanal kimliği literali yok | O1 | adnansahin paneli ayrı appId → yan yana; yeni sistemde önceki sürüm yok |
| **O6** | Panel: grup akışı | `shared/update-feed.ts` (kök `indir`, `<grup>` deseni dagitim gruplarından, ezme kuralı `/<grup>/electron/`) · `shared/download-token.ts` (`grup`) · `electron/ipc/updater.ipc.ts` (feed = kök + grup; grup yoksa denetim yok + durum metni) · `panel-kunye.mjs` (`kanal` = indirilen grup) · `ChannelBadge.tsx` (lisans sınıfından TEST/DEMO) · `discovery.ipc.ts` (`DEFAULT_ERP_URL` kalkar) | `updater-imza-akisi.test.ts` · `download-token.test.ts` · `panel-kunye.test.ts` · `update-imza-arayuz.test.tsx` · `discovery-logic.test.ts` · `test_panel_imza` | belirteç başlığı yalnız `indir` ana makinesine; başka grubun künyesi `KUNYE_KANAL`; grup değişince sonraki denetim yeni gruptan | O3, O5 | yeni sistemin eski sürümü yok (ilk sürüm budur) |
| **O7** | Tablet: ortak kimlik + derleme — YAPILDI 2026-10-06 (dal `gece/ortak-paket-o7`; kimlik YALNIZ `deploy/dagitim.json` `urun.tablet`ten, `mobil/scripts/lib/ortak-kimlik.cjs` ile `app.config.js` argümansız yolunda uygulanır; ⚠️ BİLİNÇLİ SAPMA: `mobil/app.json` ortak kimliğe ÇEVRİLMEDİ, eski kanalın (adnansahin) dinlenme kimliğini taşımaya devam eder — eski bekçiler, `yayinla-ota` native parmak izi ve eski kanal derlemesinin bayt-donukluğu için (jest `ESKI_KANAL_OZETI` + `cmp` ölçümü); app.json O15'te geçer. Yeni bekçi `scripts/test_tablet_ortak_paket.mjs` (+ `--sonda`). Gerçek OTA anahtar çifti ÜRETİLMEDİ: `build-apk` sertifikasız DURUR ve töreni komutunu basar — `cd mobil && npx expo-updates codesigning:generate --key-output-directory keystore/ota-keys-ortak --certificate-output-directory keystore/ota-certs-ortak --certificate-validity-duration-years 30 --certificate-common-name "TeksERP"`, kullanıcıyla) | `mobil/app.json` (paket adı · ad · `runtimeVersion` · `updates.url` takma ad · ortak OTA sertifikası) · `app.config.js` (kanal dalı kalkar) · `scripts/lib/feed.cjs` (kök `indir`, takma ad) · `scripts/lib/adres.mjs` (ERP adresi gömülmez) · `scripts/build-apk.mjs` (argümansız) · `scripts/lib/kanal.cjs` + `musteri.json` kalkar · ortak OTA anahtar çifti ve APK mührü (Mac'te, `keystore/`, git dışı; kullanıcıyla) | `mobil/src/test/update-feed-url.test.ts` (tek kimlik) · `build-apk.mjs` APK içinden geri okuma (paket adı · `updates.url` · sertifika) · `Teks-Erp/scripts/test_mobile_update.ts` (yol tutarlılığı) | tek APK; gömülü adres `https://indir.etkiliyazilim.com/ota/<rv>/manifest`; bundle'da ERP adresi literali yok | O1 | adnansahin tableti `com.teks.erp.mobil` — ayrı uygulama, yan yana kurulur |
| **O8** | Tablet: grup akışı + ilk açılış — YAPILDI 2026-10-06 (dal `gece/ortak-paket-o8`; `apkKunye.ts` değişmedi: gruplu kökte `feedChannel` = grup; ortak paket `appUpdate.service` `ortakPaketKoku`/`apkFeedTabani` ile tanınır; grup/belirteç yoksa OTA ve APK denetimi yapılmaz, ekranda "grup bilinmiyor"; adres türetimi tek yerde `baseUrlStore.autoUrlFrom`, ilk ekran `screens/Auth/ServerSetupScreen.tsx`; etiket `lib/channelLabel.resolveVisibleLabel` + `hooks/useChannelLabel`) | `services/downloadToken.service.ts` (`grup`) · `services/apkKunye.ts` (adres = kök + grup; künye `kanal` = grup) · `services/appUpdate*` · `screens/Common/settings/UpdateSettingsScreen.tsx` (adres denetimi) · `store/baseUrlStore.ts` + ilk açılış "Sunucuyu bul" (ölç; yoksa ekle) · `lib/channelLabel.ts` (lisans sınıfından) | `apkKunye.test.ts` · `appUpdate.apk.test.ts` · `discovery.service.test.ts` · `clientPolicy.service.test.ts` | adres yokken uygulama `localhost`a değil sunucu bulma ekranına gider; APK künyesi gruptan; OTA belirteci `tkl` | O3, O7 | — |
| **O9** | Worker: takma ad + yeni ayar — YAPILDI 2026-10-06 (dal `gece/ortak-paket-o3-o9`; ayar `worker/indir-ayar.json`, K-5 ayarda; zincirli işaretçiler değişken; yayın 3.2) | `deploy/guncelleme-sunucusu/worker/indirme-kapisi.js` · `Teks-Erp/scripts/test_indirme_kapisi.ts` · `docs/ops/INDIRME-KAPISI-WORKER.md` | `test_indirme_kapisi` + yeni sondalar (takma ad belirteçsiz 403 · başka grubun belirteci gerçek yola yönlenir ama yol önekini tutar · `//`, `%..` biçimleri · geçiş listesi takma adda uygulanmaz) | `/ota/<rv>/manifest` yalnız belirteçle ve yalnız belirtecin grubuna; yayın KULLANICIYLA (3.2), önce/sonra adnansahin 9/9 | O1 | eski adreste Worker yok → adnansahin etkilenmez |
| **O10a** | Panel yayını + terfi — YAPILDI 2026-10-06 (dal `gece/ortak-paket-o10a`; yeni `deploy/electron-grup-yayinla.sh`, eski yayıncı ve `deploy/kanallar.json` bayt-donuk; gerçek yayın bu dilimde yapılmadı) | `deploy/electron-yayinla.sh` · `scripts/lib/yayin-hedefi.mjs` (grup) · `scripts/lib/terfi.mjs` (grup zinciri, özet eşitliği) · `scripts/lib/yayin-okuma.mjs` (`indir` kapsamı) · `scripts/lib/panel-imza-kapisi.mjs` · `Teks-Erp/scripts/panel-imza.ts` (künye `kanal`=grup) · yayın bildirimi | `test_surum.mjs §5` · yeni `test_grup_yayin_kapisi.mjs` (sahte ssh/scp/curl: test grubu etiketsiz · oncu etiketsiz RED · kaynak gruptan farklı özet RED · ezme ortamı RED · eski kanal kodu hedef RED) · `check-yayin-okuma.mjs` | `latest.yml` künyesi hedef grupla imzalı, EN SON yüklenir; terfi bayt-eşit kopya | O5, O6, O13b | — |
| **O10b** | Tablet yayını + terfi — YAPILDI 2026-10-06 (dal `gece/ortak-paket-o10b`, birleşim `gece/ortak-paket-birlesik`; SAPMA: `--grup` bayrağı yerine ayrı betikler — `mobil/scripts/yayinla-ota-ortak.mjs` (manifestsiz ortak OTA paketi) · `deploy/mobil-grup-yayinla.mjs` (`--paket` / `--apk`) · `mobil/scripts/lib/ortak-ota.mjs`; `yayinla-ota.mjs` · `manifest.mjs` · `mobil-yayinla.mjs` bayt-donuk; ortak OTA anahtarı yoksa fail-closed, tören kullanıcıyla; grup kitaplığı panel + tablet + backend için tek modül, ürün farkı ARTEFAKT tablosunda; gerçek yayın yapılmadı) | `deploy/mobil-yayinla.mjs` · `yayinla-ota.mjs [eski-kanal-son etiketinde, mobil/scripts/ altında]` (`--grup`, manifest grup başına yeniden üretilir ve imzalanır) · `mobil/scripts/lib/manifest.mjs` (varlık tabanı `/<grup>/…`) · APK künyesi | `test_grup_yayin_tablet.mjs` (yapılan) · `test_grup_yayin_kapisi.mjs` (tablet bölümü) · `test_mobile_update.ts` · `yayinla-ota --check` | OTA ve APK terfisinde paket baytları aynı, manifest/künye hedef grubun | O7, O8, O10a (ortak kitaplık) | — |
| **O11a** | Backend paket + kurulum arşivi — YAPILDI 2026-10-06 (dal `gece/ortak-paket-o11a`; varsayılan güncelleme adresi `indirmeKoku`, onarımda eski adres yenisine döner; `teslim-paketle.sh` anahtarı açıkça; SAPMA: `paketle.ps1 -Musteri` ve `gecis.ps1` eski adresi bayt-donuk kaldı, O15'te kalkar) | `deploy/paketle.ps1` (`-Musteri` kalkar; `backendKanal: null`; hizmet sabit) · `scripts/kanal-kapisi.mjs backend-paketle` → `dagitim` kapısı · `Teks-Erp/scripts/build-korumali.mjs` (filigranda `musteri`, `kurulumId` null) · `deploy/kurulum/kurulum-arsivi.mjs` (argümansız) · `tekserp-kurulum.iss` `VARSAYILAN_GUNCELLEME` · `cevap-semasi.json`, `ornek-cevap.json` · `deploy/hizmet/guncelleyici-hizmeti.ps1` varsayılanı · `.github/workflows/korumali-paket.yml` (`musteri` girdisi kalkar) | `test_sunucu_betikleri` · `test_kurulum_betikleri` · `test_kurulum_arsivi.mjs` · `test_lisans_butunluk` (filigran) · `test_node_surumu.mjs` | aynı commit'ten tek zip + tek kurulum arşivi; `PAKET.json` müşteri taşımaz; güncelleyici ayarı `indir` | O1; 3.9 D1–D3 | yeni sistemde önceki backend yok; güncelleyici `musteri:null` paketi zaten kabul ediyor (`release.rs:390`) |
| **O11b** | Backend yayını + terfi — YAPILDI 2026-10-06 (dal `gece/ortak-paket-o11b`; `--grup`, `scripts/lib/grup-yayin.mjs`, `dogrula|imzala --ortak`; gerçek yükleme `YENI_ADRES_KAPISI` ile KAPALI — D5 + D8 sonrası açılır; K-6 varsayılan uygulandı — birleşimde panel/tablet hükmüne çekildi: genel oncu onayını da ister; bekçi `test_backend_yayin` §3G, ayrı `test_grup_yayin_kapisi` açılmadı) | `deploy/backend-yayinla.mjs` · `scripts/lib/backend-yayin.mjs` · `Teks-Erp/scripts/backend-bildirim.ts` (`--kanal`=grup; zincir imzası) | `test_backend_yayin.mjs` · `test_yayin_bildirim.mjs` · `test_grup_yayin_kapisi.mjs` (backend) | `son.json` hedef grup için imzalı; zincirsiz bildirim `indir`e YÜKLENMEZ | O11a, O10a; 3.9 D5 (araçlar) + D8 (ilk PAKET sertifikası, kullanıcıyla) | eski güncelleyici sürümü yeni sistemde yok |
| **O12** | Tailscale kutusu kalkar — YAPILDI 2026-10-06 (dal `gece/ortak-paket-o4-o12`; şema `kayitEski` eski izni yalnız kayıttan tanır; K3 kod yolu — onarım ön doldurması — kapandı, kesin kaynak ölçümü O17'de) | `tekserp-kurulum.iss` · `cevap-semasi.json` · `kurulum.ps1` / `kurulum-ortak.ps1` (`AgKarari` uyarısı) | `test_kurulum_betikleri` (`ag.*` bölümü) · `test_sunucu_betikleri` | sihirbazda kutu yok; sessiz kipte `100.64.0.0/10` RED; onarımda kayıttaki değer korunur + uyarı; K3 kapanır | — | eski setup yeni arşivde yok |
| **O13a** | Profil biçimi + kapalı/açık + koşucu | `Teks-Erp/scripts/test-profilleri/{kapali,acik}.json` · `scripts/lib/hepsi-acik.ts` · `scripts/lib/profil.ts` (biçim, allowlist) · `scripts/profil-matrisi.ts` (P-takımı) · `docs/RECETELER.md` bayrak reçetesine adım | yeni `test_profil_tamligi` (her bayrağın açık-değeri var; allowlist dışı anahtar RED; sır anahtarı RED) · matris kendi koşumu | iki profilde P-takımı yeşil; rapor dosyası üretir | — | — |
| **O13b** | Gerçek profiller + yayın kapısı — YAPILDI 2026-10-06 (dal `gece/ortak-paket-o13b`; profil adı nötr `f1`, eşleme repo dışı; kapı kök grubu muaf tutar; yayın betiklerine bağlantı O10a/O10b/O11b'de, tüketici bekçisiyle zorunlu) | `scripts/profil-disa-aktar.ts` (yalnız `_test` DB) · `scripts/test-profilleri/f1.json` (döküm kopyasından) · rapor biçimi + yayın betiklerinde okuyucu (`scripts/lib/profil-raporu.mjs`) | `test_profil_tamligi` · dışa aktarma aracının `_test` kapısı negatif sondası | adnansahin profili P-takımından geçer; rapor yoksa yayın ÖLÇÜLEMEDİ = DUR | O13a | — |
| **O14a** | Hazırlık: TS protokol + aynalar | §7 tablosunun TS satırları + satıcı/patron protokol aynaları · `guven-capasi-ekle.ts` · `build-korumali-imza.ts` · kâhin vektörleri | `test_lisans_protokol` · `test_guven_capasi_ekle` · `test_lisans_native_kahin` · ayna eşitlik bekçileri · `test_lisans_satici_adresi` | tek çapa kipi; `hazirlik-` kid'i biçim düzeyinde RED | 3.9 D1–D3 main'de; O15 | yeni sistemde hazırlık kipli kurulum yok (D0) |
| **O14b** | Hazırlık: native + CI | `Teks-Erp/native/*` (`anchor.rs`, `trust.rs`, `policy.rs`, `Cargo.toml` özellikleri, `derle.mjs`, `package.json` betikleri, vektörler) · `.github/workflows/ci.yml` · `deploy/paketle.ps1` hazırlık yolları | `cd Teks-Erp/native && npm run denetle && npm test` (tek kip + `test-anchor`) · `native-capa-kipi.mjs` | cargo tek kipte yeşil; künye `capaKipi` yalnız `uretim` | O14a | — |
| **O14c** | Hazırlık: satıcı + araçlar + Worker alanı | `deploy/satici/*` (compose `ORTAM`, `ornek.env`, `compose-denetle.mjs`) · `satici/sunucu/src/keys/key-store.ts` · satıcı web etiketleri · `Electron/shared/license-relay.ts` · `Teks-Erp/docker/korumali/teslim-paketle.sh` · `deploy/lisans-devreye/` kalkar · Worker `indirmeListesi.hazirlik` kalkar | satıcı `test_guven_capasi_kipi` · `compose-denetle` · `license-relay.test.ts` · Worker bekçisi · yeni yazım bekçisi (`HAZIRLIK_KOK`/`hazirlik` enum yazımı yok) | kodda (a)/(b) anlamlı `hazirlik` izi yalnız migration'larda ve donuk `kanallar.json`da | O14a; O9 | satıcı önce dağıtılır (kendi ortamı tek kip) |
| **O15** | Eski kanal düzeni emekli — YAPILDI 2026-10-06 (dal `gece/ortak-paket-o15`; acil yol `docs/ops/ESKI-KANAL-ACIL.md`; KARAR (2026-10-06, 1e): adnansahin çakışma denetimleri `kanallar.json`'u okumaya devam eder (izin listesi: `test_eski_kanal_donuk` §4; ayrılık denetimleri check-dagitim §4, panel-kimlik karışık kimlik, grup-yayin eski kod reddi, `test_musteri_adi_kodda_yok` bilinçli kalır — kabuldeki "yalnız donma + ad bekçisi" ifadesinden SAPMA)) | etiket `eski-kanal-son` · kalkanlar: `scripts/check-kanallar.mjs`, `scripts/test_kanal_yayin_kapisi.mjs`, `scripts/kanal-kapisi.mjs`, `scripts/lib/kanallar.mjs`, mobil kanal kitaplıkları, `deploy/electron-yayinla.ps1` saplaması · `test_musteri_adi_kodda_yok` donuk dosyayı okumaya devam eder | `test_eski_kanal_donuk.mjs` · kapı kayıtları · `npm test` | `deploy/kanallar.json` bayt-eşit kalır; ağaçta onu okuyan yalnız donma bekçisi ve ad bekçisi | O5–O11b | adnansahin: VDS değişmez (önce/sonra 9/9) |
| **O16** | Kurallar + belgeler | `docs/kurallar/{surum-yayin,deploy-kurulum,lisans,kesif-cihaz,modul-bayrak}.md` (kanal satırları → grup; borç satırı "Kapanır" ölçütüyle kapanır) · `docs/RECETELER.md` ("Yeni müşteri kanalı" → "Yeni müşteri = portalda kurulum + grup") · arşiv notu · `docs/ops/*` runbook'ları · kök `CLAUDE.md` "Sürüm ve yayın" paragrafı ("hazırlık kanalı" → "test grubu", `terfi/<grup>/…`) | `check-surum-notlari.mjs` · belge bağlantı bekçileri | iki cümle yan yana kalmaz; eski kurala "GEÇERSİZ → tarih" | O15, O14c | — |
| **O17** | Uçtan uca prova | §8.4 adımları (thinkpad-1, kullanıcıyla) + ikinci kurulum (KARAR K-11) | bütün `npm test` + profil matrisi + üç projenin vitest/jest + native | **Kabul (borç satırının "Kapanır"ı):** aynı commit'ten çıkan tek panel, tek tablet ve tek backend paketi iki ayrı kurulumda yalnız etkinleştirme koduyla doğru firma adını, filigranı (lisans sahibi PDF meta) ve güncelleme grubunu gösterir; kanal kaydı derlemeye kimlik gömmez | hepsi | — |

**Sıra özeti:**
- Önce: D0 → O1 → O2 → (O3 ∥ O4 ∥ O9 ∥ O12 ∥ O13a).
- Ardından: O5 → O6 · O7 → O8 · O13b → O10a → O10b.
- Ardından: O11a → O11b (3.9 D5+D8 ile).
- En son: O15 → O14a → O14b → O14c → O16 → O17.

## 10. KARAR'lar (sade dil)

Kullanıcı 2026-10-07: K-1, K-2, K-6 ve K-14 kendisi onayladı; K-4 ve K-5 3.2 (indirme kapısı) kararlarıyla onaylandı; geri kalanında **varsayılan uygulandı** (kullanıcı ileride değiştirebilir). Arşiv: `docs/history/arsiv/2026-10.md` → "2026-10-07 — İstemci imza anahtarı, tablet dağıtımı…".

- **K-1 — Yeni uygulama adları:** panel ve tablet yeni ortak adla gelsin: `com.etkiliyazilim.tekserp`, ekranda "TeksERP".
  - **ONAYLANDI** (kullanıcı 2026-10-07).
  - Neden: adnansahin'deki uygulamalar eski adlarıyla aynı makinede yan yana çalışmaya devam eder, ona dokunulmaz.
  - Dikkat: tablet paket adı Google Play'e bir kez yüklenince bir daha değiştirilemez (K-14).
- **K-2 — Tablet sürüm kimliği:** ortak tablet yeni bir "uygulama çekirdeği numarası" (`runtimeVersion` 55.0) ve yeni bir güncelleme imza anahtarı ile başlasın.
  - **ONAYLANDI** (kullanıcı 2026-10-07).
  - Anahtar Mac'te kullanıcıyla birlikte üretilir, parolası kullanıcıdadır; "yeni güncelleme imza anahtarı" = OTA kökü + yıllık OTA yaprağı (+ yedek yaprak), `ISTEMCI-ANAHTARI-KOK-ALTINDA.md` §3.1, §3.6. 2026-10-07 itibarıyla ÜRETİLMEDİ.
- **K-3 — Yeni fabrikanın varsayılan grubu:**
  - Deneme (TEST) lisansı "test" grubuna, diğerleri "genel" grubuna düşsün; portaldan değiştirilebilsin.
  - Varsayılan uygulandı.
- **K-4 — Grubu kim değiştirir:**
  - Yalnız bizim taraftaki yöneticiler (portalda kurulum düzenleme yetkisi olanlar).
  - Bayi grup değiştiremez; yalnız kendisine izin verilen gruplarda kurulum açabilir.
  - **ONAYLANDI** (kullanıcı 2026-10-07, 3.2 kararı: bir tesisin grubunu yalnız bizim portal yöneticilerimiz değiştirir).
- **K-5 — Eski indirme imza anahtarı (`ind-2026`):** yeni adreste kabul edilmesin; yalnız `ind-2026-2`.
  - **ONAYLANDI** (kullanıcı 2026-10-07, 3.2 kararı): `ind-2026` yeni adreste kabul edilmez.
  - Neden: satıcı artık onunla imzalamıyor; kabul etmemek açık kapıyı küçültür.
- **K-6 — "Genel" gruba çıkış ayrı onay mı:**
  - Evet: "öncü"ye çıkış bir onay, "genel"e çıkış ikinci bir onay ister (ayrı onay etiketi).
  - **ONAYLANDI** (kullanıcı 2026-10-07).
- **K-7 — Ekrandaki ad ve belgedeki unvan:**
  - Ağda görünen ve giriş ekranındaki ad hep lisanstaki addır.
  - Belge ve etiketteki firma unvanı ilk kurulumda lisanstan gelir, sonra fabrika panelden düzenleyebilir.
  - Varsayılan uygulandı: bu ayrım.
  - Alternatif: ikisi de hep lisanstan olur, fabrika düzenleyemez.
- **K-8 — Fabrika ayar profillerinin yeri:**
  - Her müşterinin ayar düzeni test dosyası olarak kodun yanında (`scripts/test-profilleri/`) tutulur.
  - Yalnız ayarlar girer; iş verisi ve parola girmez.
  - Fabrika yedeğinin kopyasından çıkarılır.
  - Varsayılan uygulandı.
- **K-9 — Her profilde ne koşsun:**
  - Bütün testler her profilde koşmaz (eski testler "her şey kapalı" varsayar, yalancı kırmızı verir).
  - Her profilde açılış, ekran/uç kapıları, belge önizlemesi, veri tutarlılığı ve bir üretim akışı denemesi koşar.
  - Tam takım bugünkü gibi "her şey kapalı"da koşar.
  - Varsayılan uygulandı.
- **K-10 — Paket anahtarı provası:**
  - 3.9 provası "hazırlık kökü"yle tasarlanmıştı; o kök koddan kalkıyor.
  - Prova, yalnız test için derlenmiş bir paketle (dışarıdan güven listesi alan sürüm) yapılsın.
  - Varsayılan uygulandı.
- **K-11 — İkinci prova kurulumu nerede:**
  - "Aynı paket iki fabrikada iki ayrı ad/grup gösteriyor" ölçümü için ikinci bir kurulum gerekir.
  - Varsayılan uygulandı: thinkpad-1'de sanal makine; yoksa Mac'te Windows sanal makinesi. Yer prova günü kullanıcıyla seçilir.
- **K-12 — Eski yayın betikleri:**
  - adnansahin'e güncelleme gönderilmeyeceği için eski kanal betikleri koddan kaldırılır.
  - Son çalıştıkları hâl `eski-kanal-son` etiketinde saklanır; acil bir durumda oradan kullanılır.
  - Kanal kayıt dosyası ve sunucudaki eski klasör olduğu gibi kalır; adnansahin taşındığı gün eski klasör silinmez, ARŞİVE alınır (3.2 kararı, kullanıcı 2026-10-07).
  - Varsayılan uygulandı.
- **K-13 — pm2'den hizmete geçiş aracı (`gecis.ps1`):**
  - Artık hedefi yok: adnansahin yedekten sıfırdan kurulacak, testfabrika emekli.
  - Bu işte dokunulmaz, ayrı bir temizlik işinde kaldırılır.
  - Varsayılan uygulandı: dokunulmaz.
- **K-14 — Fabrika tableti nereden kurulur:** Google Play gizli yayını (Managed Google Play; uygulama yalnız bizim fabrikalarımıza görünür).
  - **ONAYLANDI** (kullanıcı 2026-10-07; `ISTEMCI-ANAHTARI-KOK-ALTINDA.md` §8 karar 5). 2026-10-03'teki "Play, APK yolu yedek" kararının yerini alır.
  - Uygulama mührünü Google tutar (Play App Signing); bizde yalnız yükleme anahtarı kalır.
  - Uygulamanın kendi APK'sını indirip kurma yolu Play'de kullanılamaz: büyük/native güncelleme Play'den, JS güncellemesi OTA ile uygulama içinden gelir.
  - Siteden kurulan tablet Play'den güncellenemez ⇒ ortak tablet için TEK kurulum yolu Play'dir; ortak tablet APK'sı siteye (`/<grup>/mobil/apk/`) yayınlanmaz.
  - Play incelemesi internetten erişilebilen bir demo sunucu + deneme hesabı ister.
  - Sonraki iş (kod, bu kararla yapılmadı): O8'in ortak tabletteki APK künyesi/kurulum yolu ve O10b'nin `--apk` dalı ortak tablette kapatılır; Play test kanallarının gruplara (test · oncu · genel) eşlenmesi Play yayın akışına yazılır.
