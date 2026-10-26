# Google Play — Yayın Kontrol Listesi (ortak tablet)

> **Durum (ölçüldü 2026-10-08):** uygulama **TeksERP** · `com.etkiliyazilim.tekserp` Play Console'da açık.
> 1.1.0 / vc 58 (API 35) **reddedildi**; 1.1.0 / vc 59 (targetSdk 36, commit `58e61f608`) **Dahili teste
> yayınlandı**. Geliştirici hesabı **KİŞİSEL** (Play Console ana sayfası "Etkili Yazılım LTD · Kişisel hesap",
> ölçüm 2026-10-20; 2026-10-15'teki "kurumsal" hükmü GEÇERSİZ → 2026-10-20) — sonuçları §4.
>
> **1.4.3 / vc 65 / rv 59.0 dahili teste yüklendi 2026-10-26 (araçla)** — `node deploy/play-yayinla.mjs --kanal=internal --uygula`,
> commit `749afb88b` (PR #239 Play notu 472 karakter; native tur: `allowBackup:false` + `expo-application`), geri okuma `internal completed:65`,
> etiket `tablet-v1.4.3`, defter `tablet-1.4.3-play-internal`. AAB + sha256 + ölçüm: `~/.tekserp/play-tablet/1.4.3-vc65/app-release.aab`
> (sha256 `b0a805eba010…`, 36,4 MB; `5156f26d2` derlemesi `eski-5156f26d2/` altında, Play'e gitmedi). Ölçüm (proto manifest): vc 65 · 1.4.3 · `expo_runtime_version` 59.0 · güncelleme adresi
> `…/ota/59.0/manifest` · targetSdk 36 · `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY=true` · OTA kökü `D7:1B:3C…` (aynı) ·
> yükleme anahtarı imzası · ön plan hizmeti YOK (expo-audio servisleri ve `FOREGROUND_SERVICE*` / `SYSTEM_ALERT_WINDOW` /
> `USE_BIOMETRIC` AAB'de yok — K1 vc 60'ta uygulanmıştı) · izin listesi vc 64 ile AYNI (`expo-application` izin getirmedi).
> OTA: `yayinla:ortak` paketi `59.0/1793034554256` + `--grup=test --kuru` plan geçti, GERÇEK yayın yapılmadı (native tur).
>
> **Dağıtım kararı (K-14, 2026-10-07; K5 2026-10-16):** ortak fabrika tableti yalnız Google Play'den kurulur; native
> güncelleme Play'den, JS güncellemesi OTA ile gelir (`docs/kurallar/surum-yayin.md` Tablet → Kararlar).
> **K5 = ÜRETİM (kullanıcı kararı 2026-10-16):** uygulama Play üretim kanalında HERKESE AÇIK yayınlanır; K-14'ün
> "Managed Google Play gizli yayın" kısmı GEÇERSİZDİR. Hesap kişisel: üretimden önce 12 test kullanıcısı × 14 gün
> kapalı test + üretim erişimi başvurusu ŞART (§4; plan [`PLAN-play-kapali-test-12x14.md`](PLAN-play-kapali-test-12x14.md)).
> Üretim hazırlık denetimi ve Console'a yapıştırılacak metinler: [`PLAY-URETIM-KONSOL-METINLERI.md`](PLAY-URETIM-KONSOL-METINLERI.md).
> iOS kapsam dışı (BT-Classic SPP iOS'ta MFi ister).
>
> Form cevapları (kopyala-yapıştır): [`PLAY-KONSOL-FORMLARI.md`](PLAY-KONSOL-FORMLARI.md). Tablet derleme ve
> OTA: [`MOBIL-UZAKTAN-GUNCELLEME.md`](MOBIL-UZAKTAN-GUNCELLEME.md), `mobil/CLAUDE.md`.

## 0. Mimari not — native proje geçici

`mobil/android/` **git'te DEĞİL** (`mobil/.gitignore` → `/android`); Expo CNG ile `prebuild` sırasında
üretilir. `android/app/build.gradle` ve `AndroidManifest.xml` **elle düzenlenmez** — her düzenleme bir
sonraki prebuild'de kaybolur. Native ayar `app.json` + repo içi config eklentileri (`mobil/plugins/`)
üzerinden yapılır: imza `withReleaseKeystore`, büyük ekran yön özelliği `withBuyukEkranYonu`, OTA zinciri
`withOtaZinciri`.

## 1. Yayının ön koşulları

### 1.1 Derleme ve imza — yerel `build:aab`, yükleme anahtarı, Play App Signing

```bash
cd mobil
npm run build:aab        # argümansız ORTAK PAKET; kimlik deploy/dagitim.json urun.tablet'ten
```

- AAB **yerelde** derlenir (`scripts/build-apk.mjs --aab`); EAS akışı kullanılmaz.
- AAB **yükleme anahtarıyla** imzalanır: `mobil/keystore/play-yukleme/` (git DIŞI, VPS'e gitmez). Anahtar
  yoksa ya da başka bir anahtarın kopyasıysa derleme DURUR — deneme mührüne sessizce düşmez.
- Uygulama mührü Google'dadır (**Play App Signing**); yükleme anahtarı kaybı Google'a başvuruyla sıfırlanır.
- `npm run build:apk` (argümansız) yalnız yerel deneme APK'sıdır, ayrı test anahtarıyla (`keystore/deneme/`)
  imzalanır ve fabrikaya DAĞITILMAZ. `--apk` yolu yoktur.
- `versionCode` yalnız Play'e yüklenecek AAB için artar; Play'e yüklenmiş bir kod (vc 58 dahil) bir daha
  kullanılamaz. OTA turunda `versionCode`a dokunulmaz.

### 1.2 Politika formları (Play Console)

Bütün form cevapları, durumları ve açık kararlar (K1–K6): [`PLAY-KONSOL-FORMLARI.md`](PLAY-KONSOL-FORMLARI.md).
Gizlilik politikası metni: [`../legal/GIZLILIK-POLITIKASI.md`](../legal/GIZLILIK-POLITIKASI.md) — yayın yeri
(K2) açık.

### 1.3 İncelemecinin uygulamayı kullanabilmesi — demo sunucu

Ortak pakette **ERP adresi GÖMÜLMEZ**; adres yokken hiçbir istek atılmaz ve ilk ekran **"Sunucuyu bul"**dur
(`mobil/src/navigation/RootNavigator.tsx`). Derlemeye demo adresi de gömülmez: incelemeci `*.etkiliyazilim.com`
altındaki bulut kurulumunun adını yazar (İNTERNET kipi: 443, sistem sertifika zinciri, doğrulama kodu YOK —
`mobil/src/lib/internet-tls.ts`, vc 62'de var). Eski `demo.etkiliyazilim.com` 2026-10-15'te kaldırıldı (DNS yok,
ölçüldü 2026-10-16). Aday kurulum, ölçümleri ve açık karar: `PLAY-URETIM-KONSOL-METINLERI.md` §0–§1. Dahili test incelemeye
girmez; kapalı test, açık test ve üretim girer ⇒ demo sunucu ve "Uygulama erişimi" formu ondan ÖNCE hazır
olmalı (K4).

**Demo sunucusu güvenlik şartları (ihmal edilmemeli):**

- Fabrikanın **gerçek sunucusu internete AÇILMAZ**. Demo ayrı, izole bir instance; HTTPS ve alan adı.
- Seed kullanıcıları (`admin/123123` vb., bkz. `Teks-Erp/ARCHITECTURE.md §13`) demo instance'ında
  **kullanılmaz** — demo için ayrı, sınırlı yetkili hesap.
- Demo'da gerçek müşteri/sipariş/fiyat verisi olmaz; periyodik reset.
- Demo hesabına yıkıcı yetki (kullanıcı yönetimi, kalıcı silme) verilmez.

## 2. İzinler ve hedef SDK

### 2.1 İzinler

`app.json` → `android.blockedPermissions`: `REQUEST_INSTALL_PACKAGES`, `RECORD_AUDIO`,
`READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE` (AAB'de yok — ölçüldü). Kalan izinlerin AAB vc 59
manifestinden ölçülmüş tam tablosu: `PLAY-KONSOL-FORMLARI.md` §4. Özet:

| İzin | Gerekçe |
|---|---|
| `CAMERA` | Barkod / refakat kartı QR okuma |
| `BLUETOOTH*` (`BLUETOOTH_SCAN` `neverForLocation` ile) | Metre / kantar / etiket yazıcı (BT-Classic SPP + BLE) |
| `ACCESS_FINE/COARSE_LOCATION` | **Yalnızca** BT taraması için (Android ≤11 zorunluluğu) |

- **Kullanılmayan izinler — karar K1 (açık):** `SYSTEM_ALERT_WINDOW`, `USE_BIOMETRIC`/`USE_FINGERPRINT` ve
  `expo-audio`nun iki ön plan hizmeti (`mediaPlayback`, `microphone`) uygulamada kullanılmıyor ama AAB'de
  var; kalırlarsa "Ön plan hizmetleri" beyanı + video istenir. Öneri: kapalı teste çıkmadan kaldır, yeni AAB
  (vc 60). Adımlar `PLAY-KONSOL-FORMLARI.md` §4.1; kod değişikliği K1 onayını bekler.
- **Açık iş:** konum iznini `android:maxSdkVersion="30"` ile sınırla — sahada Android 12+ tablette BT tarama
  testi yapılmadan uygulanmaz.
- `usesCleartextTraffic: true` (LAN'da HTTP) yayını bloklamaz; Veri güvenliği formunda "aktarımda şifreli"
  cevabını belirler (K3).

### 2.2 Hedef SDK 36 ve büyük ekran yön kilidi

- Play en düşük hedef API 36 istiyor: `expo-build-properties` compileSdk/targetSdk **36**, buildTools 36.0.0.
- API 36'da Android 16+ büyük ekranda (sw ≥ 600dp) yön kilidini yok sayar; tablet yatay kilidi uygulama
  düzeyindeki `android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY = true` özelliğiyle korunur
  (`plugins/withBuyukEkranYonu`). `build:aab` hedef SDK'yı ve özelliği AAB'nin kendisinden ölçer, eksikse DURUR.
- **Borç (API 37):** özellik API 37 hedefinde yok sayılır ⇒ hedef 37'ye çıkmadan yatay/dikey kilitli
  ekranlar kilitsiz düzene geçmeli. Kilidin gerçek tablette çalıştığı henüz ölçülmedi (arşiv 2026-10-08).

## 3. Mağaza listelemesi varlıkları

Kaynak `mobil/magaza/` (`metinler.json` + `gorseller/`); araç `deploy/play-magaza.mjs --app=tablet [--uygula]`,
görsel üretimi `deploy/play-magaza-gorsel.swift` (ayrıntı `PATRON-MAGAZA-ANDROID.md` §10). **Play'e yüklendi 2026-10-16**
(tek edit commit, geri okundu):

- tr-TR + en-US başlık "TeksERP", kısa + tam açıklama (metin `feat/play-uretim` dalındaki PLAY-URETIM-KONSOL-METINLERI belgesi §4).
- Simge 512×512 32 bit (`assets/icon.png`'den) · öne çıkan görsel 1024×500.
- İletişim `info@etkiliyazilim.com` · web `https://tekserp.etkiliyazilim.com` · varsayılan dil tr-TR.
- Ekran görüntüleri (telefon + 7"/10" tablet) **YOK**: Play'in vc62 universal APK'sı emülatörde Play lisans denetimi
  (pairip) yüzünden açılmadı; inceleme kurulumu hazır olunca örnek veriyle çekilir (`PLAY-SABAH-YAPILACAKLAR.md` B2).

## 4. Hesap türü — KİŞİSEL (ölçüldü 2026-10-20)

Tablet uygulaması (`com.etkiliyazilim.tekserp`) Etkili Yazılım LTD adlı KİŞİSEL Play hesabındadır (Hesap Kimliği
7547213456535100840); patron uygulamasıyla aynı hesap (`PATRON-MAGAZA-ANDROID.md`). Kanıt: Play Console ana sayfası
"Kişisel hesap" yazıyor (kullanıcının ekran görüntüsü, 2026-10-20).

> **Düzeltme notu (2026-10-20):** 2026-10-15'te yazılan "hesap KURUMSAL, 12×14 şartı yok" hükmü yanlıştı ve
> GEÇERSİZ → 2026-10-20; 2026-10-08'deki "kişisel" ölçümü doğruydu (gerekçe arşivde, 2026-10-20).

- **12×14 kapalı test şartı VAR:** 13 Kasım 2023 sonrası açılan kişisel hesapta üretime çıkmadan önce en az 12
  test kullanıcısı 14 gün kesintisiz kapalı teste katılmış olmalı, sonra Console'dan **üretim erişimi başvurusu**
  yapılır. Kesin koşul metni Console'daki başvuru ekranından doğrulanır. Adımlar ve takvim:
  [`PLAN-play-kapali-test-12x14.md`](PLAN-play-kapali-test-12x14.md).
- **Dağıtım yolu (K5, 2026-10-16):** ÜRETİM, herkese açık — kapalı test + başvuru onayından SONRA. Gizli yayın
  (Managed Google Play) GEÇERSİZ.

## 5. Dahili test akışı (bugün yayında olan yol)

Dahili test incelemeye girmeden yayınlanır (vc 59'da gözlendi).

1. Play Console → Test → **Dahili test** → **Test kullanıcıları**: e-posta listesi oluştur, tabletlerde
   oturum açılacak Google hesaplarını ekle.
2. Aynı sayfadaki **katılma bağlantısını** (opt-in URL) tabletin Google hesabıyla aç → "Test kullanıcısı ol"
   → Play'de uygulama sayfası açılır, oradan kurulur.
3. Yeni AAB: `npm run build:aab` → `node deploy/play-yayinla.mjs --kanal=internal` (kuru) → aynı komut `--uygula` (§7). Konsoldan elle yükleme yalnız araç kullanılamıyorsa.
4. **Öneri — fabrika başına ayrı Gmail:** her fabrikanın tabletleri o fabrikaya açılmış tek bir Google
   hesabıyla oturum açar (kişisel hesap tablete girmez); hesabın **senkronizasyonu kapalı** tutulur (kişi,
   takvim, fotoğraf eşitlenmez). Test listesi böylece fabrika başına bir satır olur. Gizli yayın seçilirse bu
   öneri yeniden değerlendirilir (§4).

## 6. Sıra

1. ~~Play Console hesabı + uygulama~~ — yapıldı (kişisel hesap; 12×14 kapalı test şartı, §4).
2. ~~İlk AAB → Dahili test~~ — vc 58 reddedildi (API 35), vc 59 yayında.
3. K1 → kullanılmayan izinler → vc 60 AAB → manifest ölçümü.
4. K2 → gizlilik politikası yayını → URL konsola.
5. K4 → demo sunucu + deneme hesabı → "Uygulama erişimi" formu.
6. Formlar: Veri güvenliği, içerik derecelendirme, hedef kitle (`PLAY-KONSOL-FORMLARI.md` §3).
7. Listeleme varlıkları (§3).
8. ~~K5~~ → ÜRETİM (2026-10-16). Sıra ve Console adımları: `PLAY-URETIM-KONSOL-METINLERI.md` §5; yayın
   `node deploy/play-yayinla.mjs --kanal=production --yuzde=<N>` (§7) — kullanıcının `terfi/genel/tablet-vX` onayıyla.

> Play Console menü adları ve politika eşikleri değişebiliyor; her adımda konsoldaki güncel yazımı teyit et.

## 7. Araçla yayın — `deploy/play-yayinla.mjs`

Servis hesabı anahtarı `~/.tekserp/sirlar/play-yayinci.json` (izin 600; hesap test kanallarına yayın + uygulama bilgisi görüntüleme; üretim izni Console'da VERİLMEDİ diye kaydedilmişti — API'den ölçülemedi, 2026-10-16: üretime taslak yazma `400 FAILED_PRECONDITION`, kullanıcı Console → Kullanıcılar ve izinler'den bakar/verir). Araç anahtarın içeriğini basmaz, yalnız `client_email`.

```
node deploy/play-yayinla.mjs --kanal=internal [--aab=<yol>]          # KURU: kapılar + Play'in kanalları + plan
node deploy/play-yayinla.mjs --kanal=internal --uygula               # yükle → dahili teste ata → onayla → geri oku
node deploy/play-yayinla.mjs --kanal=alpha --uygula                  # kapalı test: dahilideki AYNI paketi ata
node deploy/play-yayinla.mjs --kanal=production --yuzde=10           # KURU: üretim planı (%10 kademeli)
node deploy/play-yayinla.mjs --kanal=production --yuzde=10 --uygula  # üretim: dahilideki AYNI paketi %10'a ata
node deploy/play-yayinla.mjs --kanal=production --yuzde=100 --uygula # kademe artır → herkese
```

- Varsayılan AAB `mobil/android/app/build/outputs/bundle/release/app-release.aab`; komut AAB'nin derlendiği commit'te (künye commit'i = HEAD) koşar — `build:aab`'ı koşturan ağaçta.
- Kapılar: paket adı = `deploy/dagitim.json` · künye ↔ AAB sha256 ↔ HEAD · `build:aab --verify-only` (kimlik, izin, cleartext, imza; AAB'nin KOPYASI üzerinde) · versionCode > Play'deki en büyük (yüklü vc yalnız aynı baytsa kanala atanır) · tr-TR not = `surum-notlari.json` tablet maddeleri, en çok 500 karakter (aşarsa DUR — notu kısalt) · kanal yalnız `internal`/`alpha`.
- Üretim (`production`) `terfi/genel/tablet-vX` açıklamalı etiketini (kullanıcının onay cümlesi) HEAD'de ve dahili testte aynı vc + aynı sha256'yı ister; kapalı test şart değil. Üretime YÜKLEME yapılmaz, `--terfi-atla` yok, `--yuzde=1..100` zorunlu (<100 kademeli `inProgress`, 100 `completed`). Aynı vc üretimdeyse yalnız oran artırılır; düşürme, durdurma (`halted`) ve geri çekme Console'dan — araç bu durumlarda DURUR.
- Kapalı test (`alpha`) terfi ister: `tablet-vX` + `terfi/oncu/tablet-vX` açıklamalı etiketi HEAD'de (kullanıcının onay cümlesi) ve dahili testte aynı vc + aynı sha256. Acil kaçış yalnız kullanıcının cümlesiyle `--terfi-atla="<cümle>"`.
- Hedef kanalda aynı vc zaten yayındaysa araç "ZATEN YAYINDA" der ve çıkar (0).
- Her `--uygula` yayını `~/.tekserp/yayin-defteri/play-YAYIN-DEFTERI.tsv`e satır yazar (saat · `tablet-X-play-<kanal>` · kim · sha256 ilk 16 · boyut · vc · yükle/ata/kademe · doğrulandı · üretimde `yuzdeN`); dahili test yayınından sonra `tablet-vX` etiketi atılır.
- Kapalı test kullanıcıları (Google Grubu) konsoldan yönetilir; araç yalnız sürümü kanala atar.
