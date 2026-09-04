# Mobil Uzaktan Güncelleme — Kurulum ve Kullanım Reçetesi

**Durum:** 2026-08-27 — **yayın sunucusu KURULDU ve doğrulandı**; sahadaki tabletlere
henüz kurulmadı (son elle APK turu bekliyor).

Yayında olan: OTA paketi (runtimeVersion **54.2**) + kurulum dosyası **2.9.7/vc54** (arm64,
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
paket değiştiremez, çünkü imzayı üretemez.

---

## 2. Sunucu tarafı (bir kez)

Bkz. **`deploy/guncelleme-sunucusu/README.md`** — klasör açma + nginx kuralları (`deploy/guncelleme-sunucusu/nginx/default.conf`).
Electron ile **aynı konteyner**, aynı standart: yol düzeni `/<musteri>/<urun>/`.

⚠️ **Cloudflare proxy'si (turuncu bulut) AÇIK kalmalı** — Origin CA sertifikasına yalnız CF
Edge güvenir; DNS-only'ye çevrilirse Android sertifikayı reddeder ve güncelleme **sessizce**
durur.

---

## 3. Uzaktan güncelleme yayınlamak

```bash
cd mobil
EXPO_PUBLIC_API_URL=http://192.168.1.250:4000/api npm run yayinla
node ../deploy/mobil-yayinla.mjs --paket=ota-cikti/<rv>/<damga>
```

`npm run yayinla` sırasıyla: ERP adresini çözer → **sürüm numarasını belirler** →
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
ssh yenisunucu \
  "cd /opt/stack/apps/tekserp-guncelleme/html/adnansahin/mobil/ota/<rv> && cp manifest-<eski damga> manifest"
```

Dosya silinmez. Ayrıca uygulama açılışta çökerse `expo-updates` kendiliğinden bir önceki
çalışan pakete döner — bu ikinci hat, birincisi değil.

---

## 4. Kurulum dosyası (APK) yayınlamak

Yalnız native değişiklikte. `runtimeVersion` **artırılmış** olmalı (yayın script'i unutulursa durur).

```bash
cd mobil
EXPO_PUBLIC_API_URL=http://192.168.1.250:4000/api npx expo prebuild --platform android
EXPO_PUBLIC_API_URL=http://192.168.1.250:4000/api npm run build:apk
node ../deploy/mobil-yayinla.mjs --apk=android/app/build/outputs/apk/release/app-release.apk \
     --surum=2.9.8 --vc=55 --notlar="Yeni etiket yazıcısı desteği"
```

Tablette: Ayarlar → Güncelleme → **İndir ve kur** → **Yükle**. Her tablette **bir kez**
"bu kaynaktan kuruluma izin ver" onayı gerekir.

⚠️ **APK yalnız arm64 taşır** (113 MB → 49 MB). Sahadaki cihazların mimarisi kurulumdan
önce doğrulanmalı: `adb shell getprop ro.product.cpu.abi`.

---

## 4b. Birden fazla müşteri

Yol düzeni `/<musteri>/<urun>/`. Yeni fabrika eklemek = sunucuda klasör açmak
(`html/<kod>/mobil/{ota,apk}`); DNS/sertifika/servis işi YOK.

Müşteri kodu **tek kaynakta**: `mobil/musteri.json`. Adres ondan **türetilir** —
elle yazılan ikinci kopya yoktur. Derleme ve yayın komutları `--musteri` **zorunlu**
alır ve dosyayla uyuşmazsa durur.

> ⚠️ **Beklenen değer neden komuttan alınıyor:** eski kapı, APK'nın içindeki adresi
> `feed.cjs`teki sabitle karşılaştırıyordu — ama `app.config.js` de adresi aynı
> dosyadan türetiyor. Müşteri kodu yanlışsa **ikisi de aynı yanlışı söyler ve kapı
> geçerdi**. Tek müşteriyle görünmez; ikinci fabrikada onun tabletleri birinci
> müşterinin güncellemesini çeker. **Genel kural: beklenen değeri gerçek değerle
> AYNI kaynaktan alan bir kapı, o kaynağın yanlış olmasını yakalayamaz.**

Üç yerde kapı var: derleme (APK'nın gömülü adresi ↔ `--musteri`), paket üretimi
(çıktı müşteriye ayrı klasörde), yayın (paketin **manifestindeki** varlık adresleri
↔ `--musteri`). Sonuncusu künyeye DEĞİL artefakta bakar — künye bir beyandır ve
ölçümde beyana bakan sürüm ateşlemeyip paketi yanlış müşteriye yükledi.

Müşteri değiştirmek: `musteri.json` → `npx expo prebuild` → `build:apk --musteri=<yeni>`.

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
| **Kod imzalama** (paket imzası) | `mobil/keystore/ota-keys/private-key.pem` | Uzaktan güncelleme durur; yeni sertifikayla **yeni APK** gerekir |

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
