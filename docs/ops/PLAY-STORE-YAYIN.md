# Google Play — Public Yayın Kontrol Listesi (mobil)

> **Karar (2026-07-30):** Mobil uygulama Google Play'de **herkese açık** (aramada
> bulunabilir) yayınlanacak. Managed Google Play private app / APK sideload yolu
> tercih edilmedi. iOS **kapsam dışı** — `ios/` projesi yok ve BT-Classic SPP
> (HC-06 metre/kantar) iOS'ta MFi gerektirdiği için saha işlevi taşınamıyor.
>
> Bu dosya yayın öncesi mekanik gereklilikleri tutar. Kurulum/saha adımları için
> `docs/ops/KURULUM.md` (bölüm E — Android Tablet), sunucu tarafı için
> `docs/ops/DEPLOY-RUNBOOK.md`.

## 0. Mimari not — native proje geçici

`mobil/android/` **git'te DEĞİL** (`mobil/.gitignore` → `/android`); Expo CNG ile
`prebuild` sırasında üretilir. Sonuç: `android/app/build.gradle` veya
`AndroidManifest.xml` **elle düzenlenmez** — her düzenleme bir sonraki prebuild'de
kaybolur. Tüm native ayar `app.json` (+ config plugin) üzerinden yapılır, imza
EAS credentials'ta durur.

## 1. Yayını fiilen bloklayan üç şey

### 1.1 Release imzası

Üretilen proje varsayılan olarak **debug keystore** ile imzalar; Play debug-imzalı
paketi kabul etmez. CNG'de doğru yol EAS'in yönettiği upload key'i:

```bash
cd mobil
npx eas-cli@latest login
npx eas-cli credentials          # Android → production → upload keystore üret
npx eas-cli build -p android --profile production   # → AAB
```

`eas.json` hazır: `production` profili **app-bundle** (Play yeni uygulamalarda AAB
ister, APK kabul etmez) + `autoIncrement: versionCode`. Yerel derleme şart olursa
`eas build --local` aynı profili kullanır.

> Keystore'u repoya **koyma**. `.gitignore` `*.jks`/`*.p12`/`*.key` zaten
> yakalıyor; EAS'te tutulan anahtar yedeği için `eas credentials` → download.

### 1.2 Politika formları (Play Console)

| Form | Durum | Not |
|---|---|---|
| **Gizlilik Politikası URL'i** | 🟡 taslak var | `docs/legal/GIZLILIK-POLITIKASI.md` — `[DOLDUR]` alanları (şirket ünvanı, e-posta, demo adresi) tamamlanıp herkese açık bir URL'de barındırılacak. |
| **Data safety** (Veri Güvenliği) | ❌ | Toplanan veri: hesap (kullanıcı adı), cihaz kimliği (UUID, `devices/announce`), kamera (barkod — cihazda işlenir, gönderilmez). Konum **toplanmıyor** (yalnız BT taraması izni). |
| **App access** | ❌ | Uygulama login-gated ve **kendi sunucunuza** bağlanıyor → "All or some functionality is restricted" seç, incelemeciye erişilebilir bir sunucu adresi + test hesabı ver. Bu adım atlanırsa ret gelir. |
| İçerik derecelendirme (IARC) | ❌ | Anket; iş/üretkenlik uygulaması. |
| Hedef kitle / reklam beyanı | ❌ | Reklam yok, çocuklara yönelik değil. |

### 1.3 İncelemecinin uygulamayı kullanabilmesi — **KARAR: demo sunucu**

Üretim derlemesinde varsayılan API adresi `http://localhost:4000/api`
(`src/store/baseUrlStore.ts` → `computeAutoUrl`, `__DEV__` dışı). İncelemeci
uygulamayı açtığında hiçbir sunucuya bağlanamaz → "broken functionality" reddi.

**Seçilen çözüm:** internete açık **demo sunucu + demo hesabı**.

Gerekenler:

1. **Demo backend HTTPS olmalı.** Public internette cleartext HTTP kabul edilemez
   (ayrıca Android'de `usesCleartextTraffic` yalnız LAN kullanımı için duruyor).
2. **Store derlemesine demo adresi gömülür:** `EXPO_PUBLIC_API_URL` build-time
   env'i. `eas.json` → `production.env.EXPO_PUBLIC_API_URL = https://<demo>/api`.
   **Bu ayarlanmazsa mağazadan indiren herkes `localhost`'a bakan ölü bir
   uygulama alır** — yayın öncesi son kontrol maddesi.
   > Saha tabletleri bundan etkilenmez: operatör Ayarlar → API Sunucusu'ndan
   > fabrika LAN adresini girer, tercih cihazda kalıcıdır ve derlemedeki
   > varsayılanı ezer.
3. **Play Console → App access:** "All or some functionality is restricted" →
   demo hesabı kullanıcı adı + şifre + adım adım giriş talimatı.

**Demo sunucusu güvenlik şartları (ihmal edilmemeli):**

- Fabrikanın **gerçek sunucusu internete AÇILMAZ**. Demo ayrı, izole bir instance.
- Seed kullanıcıları (`admin/123123` vb., bkz. `Teks-Erp/ARCHITECTURE.md §13`)
  demo instance'ında **kullanılmaz** — demo için ayrı, sınırlı yetkili hesap.
- Demo'da gerçek müşteri/sipariş/fiyat verisi olmaz; periyodik reset.
- Demo hesabına yıkıcı yetki (kullanıcı yönetimi, kalıcı silme) verilmez.

## 2. İzinler

`app.json` → `android.blockedPermissions` ile kaldırıldı (kütüphane autolink'inden
geliyorlardı, uygulama kullanmıyor):
`RECORD_AUDIO`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`.

Kalan hassas izinler ve gerekçeleri (Play listelemesinde görünür):

| İzin | Gerekçe |
|---|---|
| `CAMERA` | Barkod / refakat kartı QR okuma |
| `BLUETOOTH*` | Metre / kantar / etiket yazıcı (BT-Classic SPP + BLE) |
| `ACCESS_FINE/COARSE_LOCATION` | **Yalnızca** BT taraması için (Android ≤11 zorunluluğu) |

**Açık iş:** konum iznini `android:maxSdkVersion="30"` ile sınırla +
`BLUETOOTH_SCAN`'e `android:usesPermissionFlags="neverForLocation"` ekle (küçük bir
`withAndroidManifest` config plugin'i gerekir). Play'de konum sorgulamasını azaltır
ama **sahada Android 12+ tablette BT tarama testi yapılmadan uygulanmamalı** —
BT-Classic cihaz keşfi etkilenebilir.

`usesCleartextTraffic: true` (LAN'da HTTP) yayını bloklamaz ama güvenlik
incelemesinde bayrak; orta vadede backend'e TLS.

## 3. Mağaza listelemesi varlıkları

- Uygulama ikonu 512×512 (`assets/icon.png` var — Play'in istediği boyutta export edilecek)
- Feature graphic 1024×500 — **yok, üretilecek**
- Ekran görüntüleri: telefon (min 2) + 7"/10" tablet (tablet listelemesi için önerilir) — **yok**
- Kısa açıklama (80 karakter) + tam açıklama (4000) TR/EN — **yazılacak**

## 4. Hesap türü — **KARAR: kişisel hesap** → closed testing zorunlu

13 Kasım 2023 sonrası açılan **kişisel** geliştirici hesaplarında production
erişimi için Google şunu şart koşuyor:

> **12 test kullanıcısı, kesintisiz 14 gün** closed testing track'inde opt-in
> kalmalı; ardından production erişimi başvurusu yapılır.

Sonuçlar:

- "Direkt public" **en iyi durumda ~2–3 hafta** sürer; 14 gün sayacı 12. tester
  opt-in olduğu anda başlar, tester düşerse sayaç bozulur.
- 12 tester gerçek Google hesabı olmalı — fabrika personeli + ofis bu sayıyı
  karşılar. Tester listesi e-posta ya da Google Grubu ile yönetilir.
- Kuruluş (organization) hesabına geçmek bu şartı kaldırır ama D-U-N-S numarası
  doğrulaması gerektirir. Takvim sıkışırsa **gerçek alternatif budur**.

Play Console kayıt ücreti tek seferlik 25 USD.

## 5. Sıra

1. **Play Console hesabı** aç (kişisel, 25 USD) + uygulamayı oluştur
2. **Gizlilik politikası:** `docs/legal/GIZLILIK-POLITIKASI.md` `[DOLDUR]`'larını
   tamamla → herkese açık URL'de yayınla
3. **Demo sunucu** (§1.3): HTTPS, izole instance, demo hesabı
4. `eas credentials` → upload keystore; `production.env.EXPO_PUBLIC_API_URL` =
   demo adresi; `eas build -p android --profile production` → AAB
5. AAB'yi **internal testing**'e yükle (hızlı, kendi cihazlarında doğrula)
6. Formlar: Data safety, App access (demo hesabı), içerik derecelendirme, hedef kitle
7. Listeleme varlıkları (§3) — feature graphic + ekran görüntüleri
8. **Closed testing: 12 tester × 14 gün** (§4) → production erişim başvurusu
9. Production rollout (kademeli başlat: %20 → %100)

> Play Console menü adları ve politika eşikleri değişebiliyor; yayına çıkarken
> konsoldaki güncel yazımı teyit et.
