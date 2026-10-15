# TeksERP tablet — Play ÜRETİM hazırlığı ve Console'a yapıştırılacak metinler

> **Uygulama:** TeksERP · `com.etkiliyazilim.tekserp` · Play'de dahili test 1.4.0 (vc 62). **K5 = ÜRETİM, herkese açık**
> (kullanıcı kararı 2026-10-16). Bu belge salt hazırlıktır: Console'a hiçbir şey girilmedi, hiçbir edit commit edilmedi.
> **Ölçüm (2026-10-16 ~00:45 İstanbul):** Play API salt okuma (edit açıldı → okundu → SİLİNDİ), Play'in vc 62'den ürettiği
> universal APK'nın manifesti (`generatedApks` indirmesi + `aapt2`), `curl` ile canlı adresler, kod `tablet-v1.4.0` etiketinden.
> **İşaretler:** ✅ ölçüldü/hazır · ❌ eksik · ⚠ KULLANICI TEYİT ETMELİ (koddan doğrulanamaz) · 🔶 açık karar.
> Bu belge `PLAY-KONSOL-FORMLARI.md` §2–§5'in GÜNCEL hâlidir; çelişkide bu geçerli (o belge vc 59 dönemine göre yazıldı).

---

## 0. Hazırlık denetimi (üretimin istediği her madde)

| Madde | Durum | Ölçüm / not |
|---|---|---|
| Uygulama adı | ✅ | Play'de `tr-TR` başlık "TeksERP" (varsayılan dil `tr-TR`). |
| Kısa açıklama | ❌ | Play'de BOŞ. Metin §4.1. |
| Tam açıklama | ❌ | Play'de BOŞ. Metin §4.2. |
| Uygulama simgesi 512×512 | ❌ | Play'de 0 görsel. Repoda `mobil/assets/icon.png` 1024×1024 **alfasız**; Play 32 bit PNG ister → §4.4 komutu. |
| Öne çıkan görsel 1024×500 | ❌ | Play'de yok, repoda yok — üretilecek (tasarım kullanıcıda). |
| Telefon ekran görüntüleri (en az 2) | ❌ | Play'de 0, repoda yok. |
| 7" / 10" tablet ekran görüntüleri | ❌ | Play'de 0, repoda yok. Tablet asıl kullanım yüzeyi → en az 2 tane 10" önerilir. Gerçek müşteri verisi görünmemeli (§1 🔶). |
| İletişim e-postası | ❌ | `details` yanıtında yalnız `defaultLanguage` var, `contactEmail` BOŞ. Değer K6: `info@etkiliyazilim.com`. |
| Kategori / etiketler | ⚠ | API okumuyor; Console'da bakılır. Öneri: Uygulama → **İş**. |
| Ülkeler (üretim) | ❌ | `countryAvailability/production` boş (204). Console → Üretim → Ülkeler/bölgeler seçilmeli (öneri §5 m.9). |
| Gizlilik politikası URL'si | ✅ / ⚠ | `https://tekserp.etkiliyazilim.com/gizlilik` **200, girişsiz** (ölçüldü). Ama §7 "şifresiz olabilir" diyor; vc 62 yalnız şifreli → metin güncellenmeli (§6). Console'a girildi mi API'den okunamıyor. |
| Uygulama erişimi (giriş gerekli) | ❌ 🔶 | Demo `demo.etkiliyazilim.com` DNS'te yok (kaldırıldı). Aday: `deneme.etkiliyazilim.com` — §1. |
| Reklamlar | ✅ | "Hayır": manifestte `AD_ID` izni ve reklam SDK'sı yok (ölçüldü). |
| İçerik derecelendirmesi (IARC) | ❌ | Console'da doldurulur, cevaplar §3.1. |
| Hedef kitle ve içerik | ❌ | 18+ — §3.2. |
| Veri güvenliği | ❌ | Cevaplar §2. |
| Devlet / finans / sağlık / haber beyanları | ❌ | Hepsi "hayır" — §3.3. |
| Hesap silme | ✅ | Uygulamada hesap OLUŞTURULAMAZ (yalnız `/auth/login`, `-card`, `-quick-pin`, `change-password`, `logout`, `login-methods`, `mobile-users`; kayıt ucu yok — `tablet-v1.4.0:mobil/src/services/auth.service.ts`) → Veri güvenliğinde "hesap oluşturma: Hayır"; silme URL'si zorunlu değil (⚠ Console yine isterse §2 S3). |
| Hedef API | ✅ | targetSdk **36**, minSdk 26 (vc 62 manifesti). |
| Düz HTTP | ✅ | `usesCleartextTraffic=false`, `network_security_config`: `cleartextTrafficPermitted=false`, güven çapası yalnız `system`. |
| İzinler | ✅ | CAMERA · BLUETOOTH/ADMIN (maxSdk 30) · BLUETOOTH_CONNECT · BLUETOOTH_SCAN (`neverForLocation`) · FINE/COARSE_LOCATION (sınırsız + `-sdk-23`) · INTERNET · NETWORK/WIFI_STATE · VIBRATE · MODIFY_AUDIO_SETTINGS · POST_NOTIFICATIONS · RECEIVE_BOOT_COMPLETED · WAKE_LOCK · c2dm RECEIVE · rozet izinleri · install referrer · CHECK_LICENSE. Ön plan hizmeti, `SYSTEM_ALERT_WINDOW`, biyometri, mikrofon YOK. Özel beyan gerektiren izin yok. |
| Kütüphane notu | ⚠ | `expo-notifications` Firebase Messaging bileşenlerini getiriyor ama APK'da `google_app_id` YOK → FCM başlatılmaz, push belirteci üretilmez (yerel bildirim `scheduleNotificationAsync`). Play "pairip" lisans denetimi (`CHECK_LICENSE`, `LicenseActivity`) Play'in otomatik koruması. |
| Konum izni | ⚠ | Android 12+'da da isteniyor (maxSdk yok); yalnız BT taraması için. Arka plan konumu yok → beyan gerekmez; açık iş `maxSdkVersion=30` (saha BT denemesi sonrası, mobil/ işi). |
| Hizmet hesabı üretim izni | ⚠ ÖLÇÜLEMEDİ | Commit edilmeyen edit'te üretime TASLAK yazma → `400 FAILED_PRECONDITION`; aynı edit'te alpha'ya taslak → 200; edit silindi (204). Önkoşul hatası izin denetiminden önce dönüyor (büyük olasılıkla üretim kurulumu/formlar eksik). İzin listesi (`developers/{id}/users`) geliştirici kimliği ister, elde yok → Console → **Kullanıcılar ve izinler** → `play-yayinci@tekserp-yayin.iam.gserviceaccount.com` → uygulama izinleri: "Üretim kanalına yayınla" var mı bakılmalı. |
| Yayın aracı | ✅ (dalda) | `deploy/play-yayinla.mjs --kanal=production --yuzde=N` — dal `feat/play-uretim`, main'e inmedi. |

---

## 1. Uygulama erişimi — incelemecinin bağlanacağı sunucu

### 1.1 Ölçülenler

- vc 62 **internet kipini** taşıyor: `*.etkiliyazilim.com` altındaki ad 443'te sistem sertifika zinciriyle doğrulanır,
  doğrulama kodu/QR YOK (`mobil/src/lib/internet-tls.ts`, `INTERNET_PARENT_DOMAINS = ['etkiliyazilim.com']`, `tablet-v1.4.0`'da var).
- `demo.etkiliyazilim.com` → DNS çözülmüyor (eski satış demosu 2026-10-15'te kaldırıldı).
- `https://deneme.etkiliyazilim.com` (test-musteri, BARINDIRILAN bulut kurulumu, Cloudflare arkasında):
  - `/health` → 200, `version 2.15.8`, db UP · `/api/discovery/identity` → 200, `installationId d8b44eb7-…`, `companyName "test-musteri"`, `etkin: true`, `protocol https`, `apiPort 443`.
  - `/api/client-policy/mobil` → 200, `minVersion 1.0.0` (vc 62 = 1.4.0 geçer; 1.4.0 notu "Sunucu 2.15.7 gerekir" → sağlanıyor).
  - `/api/auth/login-methods` → yalnız `list` (kullanıcı seç + parola). Lisans durdurulmamış.
  - `/api/auth/mobile-users` → **401 `DEVICE_REQUIRED`** ⇒ bu kurulumda `device.pairingRequired = TRUE`. İncelemecinin tableti
    "atama bekleniyor"da takılır ve giriş ekranında kullanıcı listesi boş gelir.

### 1.2 🔶 Açık kararlar (kullanıcı)

1. **Gerçek veri çatışması:** kullanıcı kararıyla (2026-10-16) adnansahin dump'ı GERÇEK veriyle `test-musteri` DB'sine
   yüklenecek. Play incelemecisi aynı kurulumda giriş yaparsa gerçek müşteri/sipariş/kişi verisini görür —
   `PLAY-STORE-YAYIN.md` §1.3 "demo'da gerçek müşteri verisi olmaz" şartıyla çelişir; adnansahin'in rızası Google'ın
   görmesini kapsıyor mu bilinmiyor. Seçenekler:
   - **(A, öneri)** Ayrı küçük bulut kurulumu (ör. `inceleme.etkiliyazilim.com`, BARINDIRILAN, kurgusal veri) — test-musteri ile
     aynı reçete (`tekserp-guncelleyici kur`), satıcıda ayrı kayıt/hak; incelemeden sonra da açık kalmalı (Play güncellemeleri
     de incelenir).
   - (B) İncelemeyi dump yüklenmeden ÖNCE bitirmek — üretim sonrası her güncelleme yine incelenir, sürdürülemez.
   - (C) test-musteri'de kalmak ve gerçek veriyi kabul etmek — önerilmez.
2. **Cihaz onayı:** incelemecinin kurulumunda `device.pairingRequired` KAPALI olmalı (panel → genel ayarlar). (A)'da yeni kurulum
   varsayılanı zaten kapalı (`Teks-Erp/src/middlewares/device.middleware.ts` "PASİF, DEFAULT"); test-musteri'de AÇIK ölçüldü.
3. **İnceleme kullanıcısı (ERP, tablet):** panelden açılır; TOTP'siz (1.4.0 TOTP'li hesapta 6 haneli kod sorar — incelemeci
   üretemez), `mustChangePassword` kapalı, yıkıcı yetkisiz (kullanıcı yönetimi, kalıcı silme, SoD üçlüsü yok), birkaç istasyon
   modülü (Depo, Giriş Kalite) için izin. Patron uygulaması için açılan `play-inceleme@etkiliyazilim.com` hesabı YÖNETİM
   bulutunda bir kimliktir, ERP kullanıcısı DEĞİLDİR — tablete yaramaz.
4. **Lisans:** kurulum etkin olmalı (kısıtlı kip yazmayı durdurur); BT cihazları için istasyona `simulate` açık bir çevre birimi
   tanımlanırsa metre/kantar adımları donanımsız ilerler (⚠ ölçülmedi).

### 1.3 Talimat metni (Console → Uygulama içeriği → Uygulama erişimi → "Tüm işlevler veya bazı işlevler kısıtlanmış")

Konsol alanları: Ad: `Demo hesabı` · Kullanıcı adı: `[İNCELEME KULLANICI ADI]` · Parola: `[İNCELEME PAROLASI]` ·
"Diğer bilgiler": aşağıdaki İngilizce metin (incelemeciler İngilizce okur; Türkçesi aynı içerik, isteğe bağlı).

```text
TeksERP is a shop-floor app for textile factories. It does not work on its own:
it connects to the factory's own TeksERP server. For review we run a cloud
server reachable from the internet.

1) Open the app. The first screen is "Sunucuyu ekle" (Add server).
2) Tap "Adresi yaz" (type address). In the field "IP adresi ya da sunucu adı"
   enter the host name  [INCELEME_HOST].etkiliyazilim.com  and tap "Devam".
   (No port is needed; the app connects with HTTPS on 443 and checks the
   server's public certificate. No pairing code or QR is required.)
3) The server name is shown for confirmation; tap "Ekle" (Add).
4) On the login screen tap "Kullanıcı Seç" (Select user), choose
   [INCELEME_USERNAME] and enter the password: [INCELEME_PASSWORD].
5) Open a module from the main screen (e.g. "Depo" / Warehouse). The camera
   permission is requested only to scan barcodes and QR codes.
Bluetooth tape measures, scales and label printers are factory hardware and
are not needed for review. The demo data is sample business data.
```

```text
TeksERP, tekstil fabrikaları için saha uygulamasıdır; tek başına çalışmaz, fabrikanın
kendi TeksERP sunucusuna bağlanır. İnceleme için internetten erişilebilen bir bulut
sunucusu çalıştırıyoruz.
1) Uygulamayı açın; ilk ekran "Sunucuyu ekle"dir.
2) "Adresi yaz"a dokunun, "IP adresi ya da sunucu adı" alanına
   [INCELEME_HOST].etkiliyazilim.com yazıp "Devam"a dokunun (port gerekmez; HTTPS 443,
   sunucunun genel sertifikası doğrulanır; kod/QR gerekmez).
3) Gösterilen sunucu adını onaylayıp "Ekle"ye dokunun.
4) Giriş ekranında "Kullanıcı Seç" → [INCELEME_USERNAME], parola: [INCELEME_PASSWORD].
5) Ana ekrandan bir modül açın (ör. Depo). Kamera izni yalnız barkod/QR okumak için istenir.
Bluetooth metre, kantar ve etiket yazıcısı fabrika donanımıdır; inceleme için gerekmez.
```

⚠ Ekran/düğme adları `tablet-v1.4.0`'dan alındı ("Sunucuyu ekle" `ServerSetupScreen.tsx`; "Adresi yaz", "Devam", "Ekle"
`serverPair/steps.tsx`; "Kullanıcı Seç" `LoginScreen.tsx`); yapıştırmadan önce vc 62 kurulu bir
tablette bir kez uçtan uca denenmeli (ad yazılıp eklenebildiği, kullanıcı listesinin geldiği).
"Sample business data" ibaresi yalnız kurgusal veriyle (seçenek A) doğrudur; gerçek veriyle yazılmaz.

---

## 2. Veri güvenliği (Console → Uygulama içeriği → Veri güvenliği)

Yaklaşım (2026-10-08'den): fabrika sunucusuna giden kişisel veri MUHAFAZAKÂR biçimde "toplanıyor" beyan edilir; bulut
kurulumunda sunucuyu Etkili Yazılım işlettiği için bu artık yorum değil, olgudur.

- **S1** Gerekli veri türlerinden herhangi birini topluyor veya paylaşıyor mu? → **Evet**
- **S2** Toplanan tüm veriler aktarım sırasında şifreleniyor mu? → **Evet** ✅ (vc 62: cleartext kapalı, yalnız sistem CA;
  OTA sunucusu HTTPS; ML Kit HTTPS — Google sayfası). ⚠ Kurulu tabletlerde vc 59/60 kalmadığı kullanıcıca teyit edilmeli.
- **S3** Kullanıcılar uygulamada hesap oluşturabiliyor mu? → **Hayır** ("Uygulama dışında oluşturulan hesaplarla giriş").
  Console silme bağlantısı isterse: `https://tekserp.etkiliyazilim.com/gizlilik#hesaplar-ve-silme` (bağlantı canlı, ölçüldü).
- **S4** Veri silme talebi yolu (isteğe bağlı) → **Evet** — fabrika yöneticisi + `info@etkiliyazilim.com`.
- **S5** Bağımsız güvenlik incelemesi → **Hayır**.

| Kategori → tür | Toplanıyor | Paylaşılıyor | Geçici | Zorunlu | Amaç | Kaynak |
|---|---|---|---|---|---|---|
| Kişisel bilgiler → **Ad** | Evet | Hayır | Hayır | Zorunlu | Uygulama işlevselliği | kullanıcı adı soyadı (giriş listesi), sevkiyatta şoför adı |
| Kişisel bilgiler → **Kullanıcı kimlikleri** | Evet | Hayır | Hayır | Zorunlu | Uygulama işlevselliği, Hesap yönetimi | kullanıcı adı / PIN / kart ile giriş |
| Uygulama etkinliği → **Kullanıcı tarafından oluşturulan diğer içerik** | Evet | Hayır | Hayır | Zorunlu | Uygulama işlevselliği | notlar, sebep açıklamaları, plaka |
| Uygulama etkinliği → **Diğer işlemler** | Evet | Hayır | Hayır | Zorunlu | Uygulama işlevselliği; Sahtekârlığı önleme, güvenlik ve uygunluk | kim, hangi işlemi, ne zaman |
| Uygulama bilgileri ve performans → **Kilitlenme günlükleri** | Evet | Hayır | Hayır | Zorunlu | Analiz | `errorReport.ts`: hata sınıfı + yığın + ekran + sürüm (mesaj yok) |
| Uygulama bilgileri ve performans → **Teşhis** | Evet | Hayır | Hayır | Zorunlu | Analiz | Google ML Kit (barkod modeli APK'da gömülü): cihaz/uygulama bilgisi, performans ölçümü, API yapılandırması — Google'ın açıklaması: HTTPS, üçüncü tarafa aktarılmaz |
| Cihaz veya diğer kimlikler → **Cihaz veya diğer kimlikler** | Evet | Hayır | Hayır | Zorunlu | Uygulama işlevselliği; Sahtekârlığı önleme, güvenlik ve uygunluk; Analiz | rastgele cihaz UUID'si (`deviceId.ts`) + ML Kit kurulum başına kimliği |

Toplanmıyor (işaretleme): Konum (izin yalnız BT taraması için, değer okunmaz), Finans, Sağlık, Mesajlar, Fotoğraf/video
(kamera görüntüsü cihazda çözülür, `takePicture` yok), Ses, Dosyalar, Takvim, Kişiler, Web geçmişi, E-posta adresi,
Telefon numarası, Adres, Uygulama etkileşimleri, Uygulama içi arama, Yüklü uygulamalar.

⚠ Teyit noktaları: (a) ML Kit satırları Google'ın sayfasından (son değişiklik 14 May 2025) türetildi, "toplama"nın Google
adına sayılması Play'in yorumu; (b) FCM bileşeni var ama başlatılmıyor (`google_app_id` yok) → beyan edilmedi; ileride
`google-services.json` eklenirse form değişir.

---

## 3. Diğer Uygulama içeriği formları

### 3.1 İçerik derecelendirmesi (IARC)
- E-posta: `info@etkiliyazilim.com` · Kategori: **Tüm diğer uygulama türleri** (oyun değil).
- Şiddet, korku, cinsellik, müstehcen dil, uyuşturucu/alkol/tütün, kumar, ayrımcılık: **hepsi Hayır**.
- Kullanıcılar ses/metin/görüntü paylaşarak etkileşiyor mu? → **Hayır** (mesajlaşma yok; not yalnız kuruluşun iş kaydında).
  ⚠ "Evet" de savunulabilir; derecelendirmeyi değiştirmez.
- Konum paylaşımı: Hayır · Dijital satın alma: Hayır · Sınırsız internet/tarayıcı: Hayır.
- Beklenen sonuç: 3+ / PEGI 3.

### 3.2 Hedef kitle ve içerik
- Hedef yaş: yalnız **18 ve üzeri** · Çocukların ilgisini çekebilir mi: **Hayır** · Aileler programı: yok.

### 3.3 Beyanlar
- Reklamlar: **Hayır** · Reklam kimliği: **Hayır** (manifestte `AD_ID` yok).
- Devlet uygulaması: **Hayır** · Finans özellikleri: **Uygulamam finansal özellik sunmuyor** · Sağlık: **Hayır** · Haber: **Hayır**.

---

## 4. Mağaza girişi (Büyüme → Mağaza varlığı → Ana mağaza girişi, `tr-TR`)

### 4.1 Kısa açıklama (75/80)
```text
Tekstil fabrikası üretim takibi: barkodla kalite, tambur, depo ve sevkiyat.
```

### 4.2 Tam açıklama (`PLAY-KONSOL-FORMLARI.md` §5 metni; "SUNUCUYA ŞİFRELİ BAĞLANIR" bölümü bulut kurulumunu kapsayacak biçimde güncellendi)
```text
TeksERP, tekstil fabrikalarında sahada çalışan ekipler için geliştirilmiş üretim
takip uygulamasıdır. Fabrikanızın TeksERP sunucusuna bağlanır; kumaş topunun
stoktan sevkiyata kadar her adımını tablet veya telefondan barkod okutarak
kaydetmenizi sağlar.

ÖNEMLİ: Uygulama tek başına kullanılmaz. TeksERP sunucusu kurulu bir işletmede,
fabrika yöneticisinin açtığı kullanıcı hesabıyla çalışır. Hesap uygulama içinden
açılamaz.

NELER YAPABİLİRSİNİZ
• Giriş kalite kontrolü: topları okutun, metraj ve kalite kararını girin.
• Tambur ve kesim: topu kesin, parçaları kaydedin, etiketini basın.
• Kurşun dağıtımı ve proses kalite kontrolü.
• Depo: topları okutarak yerleştirin, sayın ve bulun.
• Tartı ve paketleme: çuval oluşturun, tartın, etiketleyin.
• Sevkiyat: çuvalları okutarak sevkiyata ekleyin, belgeleri yazdırın.
• Fason ve kartela: fasona gönderin, geri kabul edin.
• İade girişi, hızlı iş emri, dokuma ve sipariş ekranları.
• Uyarılar: tezgah alarmlarını üstlenin, susturun, not ekleyin.

SAHAYA UYGUN
• Kamera ile barkod ve QR okuma; el tipi barkod okuyucu desteği.
• Bluetooth metre, kantar ve etiket yazıcısı bağlantısı.
• Ağ kesildiğinde istasyon kayıtları cihazda sıraya alınır, bağlantı gelince gönderilir.
• Okutmada sesli ve titreşimli geri bildirim: kabul, tekrar ve ret ayrı sinyal verir.
• Kullanıcı adı ve parola, hızlı PIN veya personel kartıyla giriş.
• Tablette yatay, telefonda dikey kullanım.

SUNUCUYA ŞİFRELİ BAĞLANIR
Fabrika içindeki sunucu, yönetim panelindeki QR okutularak ya da adres yazılıp
ekranda çıkan doğrulama kodu karşılaştırılarak eklenir; bulut sunucusu adıyla
eklenir ve genel sertifikasıyla doğrulanır. Tablet sunucuya yalnız şifreli
bağlantıyla bağlanır.

VERİLERİNİZ SİZDE
Üretim verileriniz fabrikanızın TeksERP sunucusunda tutulur. Uygulamada reklam
yoktur, konumunuz okunmaz, kamera görüntüsü kaydedilmez veya gönderilmez.

TeksERP, Etkili Yazılım tarafından geliştirilmektedir.
```
⚠ "Uyarılar" maddesi 1.4.0 sürüm notundan (tezgah alarmı) eklendi; modül adlarının profilde açık olduğunu kullanıcı teyit eder.

### 4.3 İngilizce giriş (isteğe bağlı, `en-US` dili eklenirse)
```text
Short: Textile mill shop-floor tracking: barcode QC, cutting, warehouse, shipping.
```
```text
TeksERP is a shop-floor app for textile mills. It connects to your company's
TeksERP server and lets teams record every step of a fabric roll - from quality
control to shipping - by scanning barcodes on a tablet or phone.

IMPORTANT: The app does not work on its own. It requires a TeksERP server and a
user account created by the factory administrator. Accounts cannot be created
in the app.

• Incoming quality control, cutting, warehouse, weighing and packing, shipping.
• Camera barcode/QR scanning and handheld scanner support.
• Bluetooth tape measures, scales and label printers.
• Offline queue: station records are sent when the connection returns.
• Encrypted connection to the server only. No ads; location is not read.

TeksERP is developed by Etkili Yazilim.
```

### 4.4 Görseller
- Simge: `sips -z 512 512 mobil/assets/icon.png --out /tmp/ikon-512.png` sonra alfa kanalı ekle (ör. bir görsel düzenleyicide
  PNG-32 dışa aktar) — Play 32 bit PNG ister; `icon.png` alfasız (ölçüldü).
- Öne çıkan görsel 1024×500 ve ekran görüntüleri: üretilecek. Tablet ekran görüntüsü: `adb exec-out screencap -p > x.png`
  (kurgusal veriyle; gerçek müşteri/kişi adı görünmez).

---

## 5. Kullanıcının Console'da yapacakları (sırayla)

1. 🔶 §1.2 kararı: inceleme sunucusu (öneri A, ayrı kurgusal kurulum). Karar sonrası: kurulum + cihaz onayı KAPALI + TOTP'siz
   inceleme kullanıcısı; vc 62 tablette §1.3 adımları bir kez uçtan uca denenir.
2. 🔶 Gizlilik politikası §6 değişikliklerini onayla → kaynak güncellenir, `uret.mjs` + `vds-kur.sh --uygula` (VDS yazımı ayrı onay).
3. Console → **Kullanıcılar ve izinler** → hizmet hesabı `play-yayinci@tekserp-yayin.iam.gserviceaccount.com` →
   TeksERP uygulaması için "Üretim kanalına yayınla" iznini ver (araçla yayın isteniyorsa; yoksa üretim sürümü Console'dan
   oluşturulur).
4. Uygulama içeriği → **Gizlilik politikası**: `https://tekserp.etkiliyazilim.com/gizlilik` (girilmediyse).
5. Uygulama içeriği → **Uygulama erişimi**: §1.3 (gerçek kullanıcı adı/parola ile).
6. Uygulama içeriği → **Reklamlar** (Hayır) · **Reklam kimliği** (Hayır) · **İçerik derecelendirmesi** (§3.1) ·
   **Hedef kitle** (§3.2) · **Veri güvenliği** (§2) · Devlet/Finans/Sağlık/Haber (§3.3).
7. Mağaza ayarları → kategori **İş**, iletişim e-postası `info@etkiliyazilim.com`, web sitesi `https://etkiliyazilim.com` (isteğe bağlı).
8. Ana mağaza girişi → §4.1, §4.2 (+ isteğe bağlı §4.3), simge, öne çıkan görsel, telefon + tablet ekran görüntüleri.
9. Üretim → **Ülkeler/bölgeler**: ⚠ karar — yalnız Türkiye mi, tüm ülkeler mi (uygulama Türkçe; öneri: Türkiye ile başla).
10. Fiyat: Ücretsiz (Play'de ücretsizden ücretliye geçilemez).
11. Yayın özeti sayfasında eksik madde kalmadığını gör; sonra yayın: bkz. `PLAY-STORE-YAYIN.md` §7 —
    `terfi/genel/tablet-v1.4.0` açıklamalı etiketi (onay cümlen) → `node deploy/play-yayinla.mjs --kanal=production --yuzde=<N>`
    (kuru) → `--uygula`. İlk üretim sürümü Google incelemesine girer (süre değişken). "Yönetilen yayın" açıksa onaydan sonra
    yayın düğmesi Console'dadır.

---

## 6. Gizlilik politikası — önerilen değişiklikler (⚠ KULLANICI ONAYI; kaynak `docs/legal/GIZLILIK-POLITIKASI.md`)

Canlı sayfa (ölçüldü): "Son güncelleme: 8 Ekim 2026", §7 "Fabrika sunucusuyla bağlantı, fabrikanın ayarına göre şifreli
(HTTPS) ya da fabrikanın kendi iç ağında şifresiz olabilir." Bu, Veri güvenliği S2 "Evet" cevabıyla çelişir.

1. **§7 (ölçülmüş olgu, vc 62):** "Fabrika sunucusuyla bağlantı her zaman şifrelidir (HTTPS): fabrika içindeki sunucunun
   sertifikası kurulumda tablete QR ya da doğrulama koduyla tanıtılır, bulut sunucusu genel sertifikasıyla doğrulanır.
   Güncelleme sunucusuyla bağlantı da her zaman şifrelidir." — dosya başındaki K3 notu silinir.
2. **§1 (⚠ iş modeli teyidi):** bulut (barındırılan) kurulumda veriler fabrika adına Etkili Yazılım'ın işlettiği sunucuda tutulur;
   bugünkü "Etkili Yazılım bu verileri toplamaz, kendi sunucularında saklamaz" cümlesi bulut müşterisi için doğru değil.
   Öneri metni: "Fabrika TeksERP'yi kendi sunucusuna ya da Etkili Yazılım'ın işlettiği bulut sunucusuna kurdurabilir. Bulut
   kurulumunda veriler fabrika adına ve fabrikanın talimatıyla (veri işleyen sıfatıyla) bu sunucuda saklanır; veri sorumlusu
   yine fabrikadır." — hukuki ifade kullanıcı/hukukçu kararı.
3. **§1:** "Sunucu adresi ağ taraması veya elle giriş ile belirlenir" → "…ağ taraması, QR kod veya elle giriş ile…" (isteğe bağlı).
4. "Son güncelleme" tarihi yayın günüyle değişir.
