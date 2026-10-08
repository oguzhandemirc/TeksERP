# Google Play — Yayın Kontrol Listesi (ortak tablet)

> **Durum (ölçüldü 2026-10-08):** uygulama **TeksERP** · `com.etkiliyazilim.tekserp` Play Console'da açık.
> 1.1.0 / vc 58 (API 35) **reddedildi**; 1.1.0 / vc 59 (targetSdk 36, commit `58e61f608`) **Dahili teste
> yayınlandı**. Geliştirici hesabı **KİŞİSEL** (kurumsal değil) — sonuçları §4.
>
> **Dağıtım kararı (K-14, 2026-10-07):** ortak fabrika tableti yalnız Google Play'den kurulur; native
> güncelleme Play'den, JS güncellemesi OTA ile gelir (`docs/kurallar/surum-yayin.md` Tablet → Kararlar).
> Kararın "Managed Google Play **gizli yayın**" kısmı kurumsal hesap varsayımıyla verildi; hesap kişisel
> çıktığı için **yeniden açık — kullanıcıya sorulacak** (§4, `PLAY-KONSOL-FORMLARI.md` K5). 2026-07-30'daki
> "herkese açık yayın" kararı K-14 ile geçersizdir. iOS kapsam dışı (BT-Classic SPP iOS'ta MFi ister).
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
(`mobil/src/navigation/RootNavigator.tsx`). Derlemeye demo adresi de gömülmez: incelemeci "Adresi elle gir"
ile demo sunucunun adresini yazar (talimat metni `PLAY-KONSOL-FORMLARI.md` §2). Dahili test incelemeye
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

- Uygulama ikonu 512×512 — repoda `assets/icon.png` 1024×1024; 512'ye dışa aktarılacak.
- Öne çıkan grafik 1024×500 — **yok, üretilecek**.
- Ekran görüntüleri: telefon + 7"/10" tablet — **yok**; demo verisiyle çekilir, gerçek müşteri verisi görünmez.
- Kısa ve tam açıklama taslağı: `PLAY-KONSOL-FORMLARI.md` §5.

## 4. Hesap türü — KİŞİSEL (ölçüm 2026-10-08)

Play Console geliştirici hesabı **kişisel** çıktı; hafızadaki ve plan §E'deki "kurumsal hesap" varsayımı
konsolda yanlışlandı. Sonuçları (Play kuralları **⚠ web'den doğrulanmalı** — eşikler değişebilir):

- **Üretime çıkış için 12×14 kapalı test:** 13 Kasım 2023 sonrası açılan kişisel hesapta üretim erişimi için
  en az **12 test kullanıcısının kesintisiz 14 gün** kapalı teste katılmış olması, ardından üretim erişimi
  başvurusu gerekir. Sayaç 12. kullanıcı katıldığı anda başlar; kullanıcı düşerse bozulur.
- **"Gizli yayın" kararı yeniden açık:** Managed Google Play gizli uygulamasının kişisel hesaptan yayınlanıp
  yayınlanamayacağı ve 12×14 şartına tabi olup olmadığı bilinmiyor; gizli yayın ayrıca tabletlerin bir
  kuruluşa (Managed Google Play) bağlanmasını gerektirir. **Kullanıcıya sorulacak** (K5).
- **Kuruluş hesabına geçiş:** 12×14 şartını kaldırır ama D-U-N-S doğrulaması ister; kişisel hesabın
  çevrilip çevrilemeyeceği doğrulanmalı.

## 5. Dahili test akışı (bugün yayında olan yol)

Dahili test incelemeye girmeden yayınlanır (vc 59'da gözlendi); 12×14 sayacına sayılmaz — sayaç kapalı testte işler (⚠ web'den doğrulanmalı).

1. Play Console → Test → **Dahili test** → **Test kullanıcıları**: e-posta listesi oluştur, tabletlerde
   oturum açılacak Google hesaplarını ekle.
2. Aynı sayfadaki **katılma bağlantısını** (opt-in URL) tabletin Google hesabıyla aç → "Test kullanıcısı ol"
   → Play'de uygulama sayfası açılır, oradan kurulur.
3. Yeni AAB: `npm run build:aab` → Dahili test → Yeni sürüm → AAB'yi yükle → sürüm notu → yayınla.
4. **Öneri — fabrika başına ayrı Gmail:** her fabrikanın tabletleri o fabrikaya açılmış tek bir Google
   hesabıyla oturum açar (kişisel hesap tablete girmez); hesabın **senkronizasyonu kapalı** tutulur (kişi,
   takvim, fotoğraf eşitlenmez). Test listesi böylece fabrika başına bir satır olur. Gizli yayın seçilirse bu
   öneri yeniden değerlendirilir (§4).

## 6. Sıra

1. ~~Play Console hesabı + uygulama~~ — yapıldı (kişisel hesap).
2. ~~İlk AAB → Dahili test~~ — vc 58 reddedildi (API 35), vc 59 yayında.
3. K1 → kullanılmayan izinler → vc 60 AAB → manifest ölçümü.
4. K2 → gizlilik politikası yayını → URL konsola.
5. K4 → demo sunucu + deneme hesabı → "Uygulama erişimi" formu.
6. Formlar: Veri güvenliği, içerik derecelendirme, hedef kitle (`PLAY-KONSOL-FORMLARI.md` §3).
7. Listeleme varlıkları (§3).
8. K5 → dağıtım yolu: kapalı test (12×14) → üretim erişimi başvurusu, ya da gizli yayın.

> Play Console menü adları ve politika eşikleri değişebiliyor; her adımda konsoldaki güncel yazımı teyit et.
