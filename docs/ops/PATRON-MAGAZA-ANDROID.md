# Patron uygulaması — Google Play (Android) ilk sürüm runbook'u

> Durum (2026-10-15): ilk AAB hazır (1.0.0 · versionCode 1), Play'e YÜKLENMEDİ. iOS sonra (Xcode kurulumu).
> Kararlar (kullanıcı 2026-10-15): önce yalnız Android · ilk sürümde telefonda ANLIK BİLDİRİM YOK (Firebase yok;
> uygulama native push kaydı denemez, uyarı göstermez; bildirim ekranında "yakında" notu) · web push aynen.
> Tablet (ortak paket) Play yolu ayrıdır: `PLAY-STORE-YAYIN.md` · `PLAY-KONSOL-FORMLARI.md`.
> Play geliştirici hesabı **KURUMSAL** (kuruluş hesabı, Etkili Yazılım — doğrulandı 2026-10-15): kişisel hesabın
> "12 test kullanıcısı × 14 gün kapalı test" şartı bu uygulamaya **uygulanmaz** (§3 madde 7).

| | |
|---|---|
| Paket adı | `com.etkiliyazilim.tekserp.patron` (değişmez — Play'de kalıcı kimlik) |
| Görünen ad | TeksERP Patron |
| Sürüm | `patron/uygulama/app.json` → `expo.version` (versionName) + `expo.android.versionCode` — tek kaynak; her yüklemede versionCode +1 |
| Bulut adresi | `https://patron.etkiliyazilim.com` (`scripts/lib/android-derleme.cjs` `PATRON_API`; derlemeye gömülür, `.env*` okunmaz) |
| Yükleme anahtarı | `~/.tekserp/patron-android/yukleme/tekserp-patron-yukleme.keystore` (repo DIŞI, 700/600) · alias `tekserp-patron-yukleme` |
| Parola | macOS Anahtar Zinciri `tekserp/patron-play-yukleme` (hesap `tekserp`) — hiçbir çıktıya/dosyaya basılmaz |
| Şifreli yedek | `patron/uygulama/keystore-yedek.tar.gz.enc` + `keystore-yedek.README.md` |
| Çıktı | `~/.tekserp/patron-android/cikti/tekserp-patron-<sürüm>-vc<kod>.aab` + `.sha256` |
| Görseller | `patron/uygulama/assets/` — **YER TUTUCU** (tablet logosu + altın halka; `scripts/yer-tutucu-gorsel.cjs`). Kullanıcı onaylı nihai görsel gerekir. |

## 1. Derleme (Claude/geliştirici)

```bash
cd patron/uygulama
npm ci
npm test && npm run typecheck
npm run build:aab           # imzalı AAB → ~/.tekserp/patron-android/cikti/
npm run build:apk:duman     # aynı imzalı release APK (yalnız emülatör dumanı; dağıtılmaz)
```

`build-aab.mjs` sırası: JDK (`JAVA_HOME` → Homebrew `openjdk@17` → … → Android Studio JBR) + SDK
(`~/Library/Android/sdk`) bulunur → anahtar dosyası ve izinleri (700/600) denetlenir → parola Anahtar Zinciri'nden
okunur ve keytool ile anahtarı açtığı doğrulanır → `expo prebuild --platform android --clean` (android/ git dışı;
her derleme temiz) → `./gradlew --no-daemon bundleRelease` (parola yalnız bu alt süreç ortamında) → DOĞRULAMA:
birleşik manifestte paket/versionCode/versionName, izin kümesi yalnız `INTERNET` (+ AndroidX'in uygulamaya özel
`DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`'ı), Firebase/bildirim bileşeni yok, `allowBackup` kapalı; JS paketinde
bulut adresi var, geliştirme adresi yok; AAB imzası yükleme sertifikası → kopya + sha256. Doğrulama kırmızıysa
paket çıktı dizinine kopyalanmaz.

Native push kapısı: `src/push/support.ts` `NATIVE_PUSH = false`; `expo-notifications` Android'de bağlanmaz
(`package.json` `expo.autolinking.android.exclude`) ve eklentisi `app.json`'da yok. Açmak (sonraki sürüm):
Firebase projesi + `google-services.json` + eklenti + autolinking dışlamasını kaldır + kapıyı aç + izinleri
(`POST_NOTIFICATIONS`) `blockedPermissions`'tan çıkar + veri güvenliği formunu güncelle. Bekçi: `__tests__/native-push.test.tsx`.

İzinler: `app.json` `android.permissions: []` + `blockedPermissions` (kütüphanelerin getirebileceği
`POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `VIBRATE`, `WAKE_LOCK`, `AD_ID`, `c2dm.RECEIVE`, depolama,
`SYSTEM_ALERT_WINDOW`). Yeni izin isteyen bağımlılık eklenirse `build-aab.mjs` `IZINLI_IZINLER` kırmızı verir —
izin bilerek eklenir, formu da güncellenir.

## 2. İmza ve anahtar

- İlk tören (YAPILDI 2026-10-15): `node scripts/anahtar-uret.mjs` — rastgele parola → Anahtar Zinciri → keytool
  (PKCS12, RSA 4096, 10000 gün). Var olan anahtarın ya da kasa kaydının üstüne YAZMAZ.
- Yedek: `node scripts/anahtar-uret.mjs --yedek` (açıp bayt-eşitliği doğrular). Geri yükleme: `keystore-yedek.README.md`.
- Play App Signing: ilk AAB yüklenince Google uygulama imza anahtarını üretir ve tutar; bizim anahtarımız yalnız
  YÜKLEME anahtarıdır. Kaybında Play Console'dan "yükleme anahtarı sıfırlama" istenir; kullanıcılar etkilenmez.
- Yükleme sertifikası SHA-256: `3D:D9:6B:00:46:8F:3F:8C:CB:E3:44:16:BE:D8:05:78:1A:B8:67:53:72:ED:D6:99:4C:BC:CC:97:A6:30:27:EA`

## 3. Kullanıcının yapacakları (Play Console — Claude yükleme YAPMAZ)

1. **Parolayı yedekle (bir kez):** Anahtar Zinciri `tekserp/patron-play-yukleme` değerini parola yöneticine kopyala
   (`keystore-yedek.README.md` § Parolayı parola yöneticisine kopyalamak). Mac kaybında tek kurtarıcı odur.
2. **Uygulama oluştur:** Play Console → Tüm uygulamalar → **Uygulama oluştur** → ad "TeksERP Patron" · varsayılan
   dil Türkçe · Uygulama · Ücretsiz · beyanlar ✓. (Paket adı ilk AAB yüklenince `com.etkiliyazilim.tekserp.patron` olarak kilitlenir.)
3. **Play App Signing:** ilk sürüm oluştururken "Google tarafından oluşturulan anahtar" (varsayılan) seçili kalsın.
4. **Dahili test:** Test → Dahili test → Yeni sürüm → `~/.tekserp/patron-android/cikti/tekserp-patron-1.0.0-vc1.aab`
   yükle → sürüm notu (aşağıda §5.4) → test kullanıcıları listesi → kaydet → yayınla. Yüklemeden önce sha256'yı
   `.sha256` dosyasıyla karşılaştır (`shasum -a 256 <aab>`).
5. **Mağaza girişi:** §5'teki metinler + görseller: ikon `patron/uygulama/assets/magaza/ikon-512.png`, öne çıkan görsel
   `assets/magaza/one-cikan-1024x500.png` (ikisi de YER TUTUCU), telefon ekran görüntüleri (en az 2; demo hesapla
   alınmalı — gerçek fabrika verisi görünmesin).
6. **Uygulama içeriği formları:** gizlilik politikası URL'si `https://tekserp.etkiliyazilim.com/patron-gizlilik`
   (§4.1 — önce sayfa VDS'e yayımlanmalı), uygulama erişimi (inceleme hesabı — §6 madde 2), reklam yok, hedef
   kitle 18+, veri güvenliği (§4.2), içerik derecelendirmesi (iş uygulaması, kullanıcı etkileşimi: kullanıcılar
   arası iletişim yok), hesap silme URL'si `https://tekserp.etkiliyazilim.com/patron-gizlilik#hesap-silme` (§4.3).
7. **Üretim yayını:** hesap KURUMSAL olduğu için kapalı test şartı (12 test kullanıcısı × 14 gün) YOKTUR — bu şart
   13 Kasım 2023 sonrası açılmış KİŞİSEL hesaplara özgüdür (kuruluş hesabına uygulanmadığı doğrulandı 2026-10-15).
   Dahili testte duman (§4) geçince aynı sürüm Test → Dahili test → **Sürümü tanıt → Üretim** ile ya da Üretim →
   Yeni sürüm ile doğrudan üretime gönderilir; ilk üretim sürümü Play incelemesine girer (§6 madde 2 inceleme hesabı
   hazır olmadan gönderilmez). Kapalı test istenirse isteğe bağlıdır, kapı değildir.

## 4. Gizlilik ve veri güvenliği

### 4.1 Gizlilik politikası adresi — `/patron-gizlilik`

- **Adres: `https://tekserp.etkiliyazilim.com/patron-gizlilik`** (yayın kullanıcı onayıyla VDS'e — repo hazır,
  2026-10-15; dağıtım `GIZLILIK-SAYFASI.md` § Patron sayfası). Metin kimliği `PATRON-GP-2026.1`, yürürlük 15 Ekim 2026.
- Tek kaynak `docs/legal/PATRON-GIZLILIK-POLITIKASI.md` → `node deploy/gizlilik-sayfasi/uret.mjs` →
  `deploy/gizlilik-sayfasi/html/patron-gizlilik.html` (tabletinkiyle aynı köken ve düzenek, ayrı sayfa; patron
  sunucusuna dokunmaz). Bekçi `scripts/test_gizlilik_sayfasi.mjs` bayt-eşitliği, `#hesap-silme` çapasını, saklama
  sürelerini (`patron/sunucu` koduna karşı) ve native push cümlesini (`NATIVE_PUSH`) ölçer.
- Kaynağı PBAM'dır (`docs/hukuk/PATRON-BULUTU-AYDINLATMA-METNI.md`, taslak, uygulamada gösterilecek aydınlatma
  metni) ama SADE bir uygulama politikasıdır: veri sorumlusu fabrika · veri işleyen Etkili Yazılım, toplanan veriler
  (aşağıdaki §4.2 tablosuyla BİREBİR), amaç, aktarım (Cloudflare; native push kapalı), saklama, güvenlik, KVKK md. 11,
  18+, değişiklikler, iletişim, hesap silme. §4.2 değişirse politika §2 aynı commit'te değişir (ve tersi).
- `https://tekserp.etkiliyazilim.com/gizlilik` TABLET uygulamasının politikasıdır ("Etkili Yazılım bu verileri
  toplamaz") — patron için YANLIŞTIR, kullanılmaz. `https://patron.etkiliyazilim.com/gizlilik` SPA giriş HTML'idir, metin değil.

### 4.2 Veri güvenliği formu — toplanan veri (koddan ölçüldü, 2026-10-15)

Uygulamada analitik, reklam, çökme raporu SDK'sı YOK; Firebase YOK; reklam kimliği (`AD_ID`) engelli. Bütün
trafik HTTPS (`usesCleartextTraffic` varsayılan kapalı, adres `https://`). Veri yalnız `patron.etkiliyazilim.com`'a gider.

| Play veri türü | Ne | Toplanır/Paylaşılır | Amaç | Zorunlu mu |
|---|---|---|---|---|
| Kişisel bilgiler → Ad | hesap adı (davetle tesis yöneticisi girer) | Toplanır, paylaşılmaz | Uygulama işlevi, hesap yönetimi | Zorunlu |
| Kişisel bilgiler → E-posta adresi | giriş kimliği | Toplanır, paylaşılmaz | Hesap yönetimi, güvenlik | Zorunlu |
| Kişisel bilgiler → Kullanıcı kimlikleri | hesap/tesis kimliği (UUID) | Toplanır | Uygulama işlevi | Zorunlu |
| Uygulama etkinliği → Diğer kullanıcı içerikleri | girilen sipariş/cari talepleri (gelen kutusu), rapor istekleri | Toplanır; fabrikaya iletilir (veri sorumlusu fabrikadır — Play "paylaşım" sayılmaz: hizmet sağlayıcı/kullanıcının isteği) | Uygulama işlevi | Kullanıcı isterse |
| Uygulama etkinliği → Diğer işlemler | bildirim tercihleri, tesis seçimi | Toplanır | Uygulama işlevi | İsteğe bağlı |
| Cihaz veya diğer kimlikler | — (native push yok; cihaz satırı yalnız web aboneliği) | Toplanmaz | — | — |
| Konum | — (IP yalnız sunucuda giriş güvenlik kaydında, 30 gün; konum türetilmez) | Toplanmaz* | Güvenlik | — |
| Finansal bilgiler | fabrikanın cari/çek/stok verisi GÖSTERİLİR; kullanıcıdan toplanmaz | ⚠ değerlendir | — | — |

\* IP adresinin Play formundaki karşılığı (⚠ Play yardımından doğrulanmalı): IP'den konum türetilmiyorsa "konum"
işaretlenmez; güvenlik kaydı "Güvenlik, sahtekârlık önleme" amacıyla beyan edilebilir.

Formdaki genel cevaplar: aktarımda şifreli **Evet** · kullanıcı silme isteyebilir **Evet** (§4.3) · bağımsız
güvenlik incelemesi **Hayır**. Kimlik doğrulama: parola + TOTP (zorunlu). Oturum belirteci cihazın güvenli
deposunda; çevrimdışı önbellek uygulamanın korumalı alanında, yedeğe girmez (`allowBackup: false`).

### 4.3 Hesap silme

Play politikası (https://support.google.com/googleplay/android-developer/answer/13327111) hesap açılabilen
uygulamadan iki şey ister: **uygulama içinde** hesap silme yolu ve uygulamayı kurmadan erişilebilen **web'de silme
isteği adresi**; hesabı yalnız dondurmak/devre dışı bırakmak silme SAYILMAZ (davetle açılan hesap da kapsamdadır).
Bugünkü tesis yöneticisi "arşiv" işlemi (PASIF → 30. günde kimlik silinir, `test_kimlik_silme`) tek başına yetmez.

Çözüm (kullanıcı kararı 2026-10-15):
- **Uygulama içi:** Profil → **Hesabımı sil** → TOTP onayı → hesap hemen kapanır (kimlik PASİF, e-postaya bağlı
  bütün tesis üyelikleri) → 30. günde ad, e-posta, parola özeti, TOTP sırrı, oturum ve cihaz kayıtları silinir.
  İstisna: güvenlik kayıtları kendi süresiyle (başarısız giriş 90 gün, diğerleri 2 yıl; IP 30 gün) — politikada
  açıkça yazılı. Kod ayrı ajanın işi; politika metni bu davranışı anlatır, davranış değişirse metin de değişir.
- **Web:** `https://tekserp.etkiliyazilim.com/patron-gizlilik#hesap-silme` — uygulamaya erişimi olmayan kullanıcı
  tesis yöneticisine ya da kayıtlı e-posta adresinden `info@etkiliyazilim.com`a yazar; 30 gün içinde sonuçlanır.
  Play formundaki "hesap silme URL'si" alanına bu adres girilir.
- Form cevabı: kullanıcı silme isteyebilir **Evet** · veri silindiğinde saklanan: güvenlik kayıtları (süreli).

## 5. Mağaza metni taslağı (Türkçe)

### 5.1 Uygulama adı (≤ 30)
`TeksERP Patron`

### 5.2 Kısa açıklama (≤ 80)
`Fabrikanızın üretim, sevkiyat, stok ve sipariş özetini cebinizden izleyin.`

### 5.3 Uzun açıklama (≤ 4000)

```text
TeksERP Patron, TeksERP kullanan tekstil fabrikalarının yöneticileri ve patronları için hazırlanmış güvenli
bir takip uygulamasıdır. Fabrikanızın TeksERP sistemi, seçtiğiniz özet verileri şifreli bağlantıyla TeksERP
Patron bulutuna gönderir; siz de bu verileri telefonunuzdan, tabletinizden ya da tarayıcınızdan görürsünüz.

Neler yapabilirsiniz?
• Pano: fabrikanızın özet kartlarını tek ekranda görün.
• Üretim, sevkiyat, stok ve finans: fabrikanın paylaştığı güncel durumu bölüm bölüm izleyin.
• Siparişler ve cariler: kayıtları görün, yeni sipariş ve cari talebi oluşturun.
• Gelen kutusu: taleplerinizin fabrikaya ulaşıp işlendiğini takip edin; fabrika kendi sisteminde onaylar.
• Hesaplar: tesis yöneticisi ekip arkadaşlarını davet eder ve yetkilerini belirler.
• Raporlar: fabrikanızın rapor kataloğundan rapor isteyin, sonucunu uygulamada açın.
• Çoklu tesis: birden fazla tesisiniz varsa aralarında tek dokunuşla geçin.
• Çevrimdışı: bağlantı koptuğunda son görülen veri "çevrimdışı" işaretiyle salt okunur gösterilir.

Güvenlik
• Giriş parola ve iki adımlı doğrulama (TOTP) ile yapılır.
• Her hesap yalnız yetkili olduğu bölümleri görür; izinleri tesis yöneticisi verir.
• Bulut hesap yapmaz, fabrika verisini değiştiremez: yazdığınız talep fabrikaya mesaj olarak gider.
• Uygulamada reklam, analitik ya da izleme yoktur.

Kimler kullanabilir?
TeksERP Patron yalnız TeksERP kullanan ve Patron Bulutu hizmeti açık olan fabrikaların davet ettiği hesaplarla
çalışır. Hesabınızı tesis yöneticinizden davet bağlantısıyla alırsınız.

Anlık bildirimler bu sürümde telefonda yoktur; bildirimleri web sürümünden alabilirsiniz. Telefon bildirimleri
sonraki sürümde gelecek.

Destek: info@etkiliyazilim.com
```

### 5.4 Sürüm notu (1.0.0 · vc1)
`İlk sürüm: pano, üretim, sevkiyat, stok, finans, siparişler, cariler, gelen kutusu, raporlar, çoklu tesis.`

### 5.5 Kategori ve iletişim
Kategori **İş** · e-posta `info@etkiliyazilim.com` · web sitesi (varsa) · gizlilik politikası
`https://tekserp.etkiliyazilim.com/patron-gizlilik` (§4.1).

## 6. Açık konular

1. Gizlilik politikası + hesap silme sayfası repoda hazır (§4.1, §4.3), **VDS'e yayın kullanıcı onayıyla**
   (`GIZLILIK-SAYFASI.md` § Patron sayfası). Uygulama içi "Hesabımı sil" kodu ayrı işte; ikisi yayımlanmadan Play
   formu tamamlanmaz.
2. **İnceleme hesabı — KARAR (kullanıcı 2026-10-15):** DEMO sınıfı tesis + uydurma veri + o tesiste inceleme hesabı.
   Play Console → Uygulama içeriği → **Uygulama erişimi** talimatına e-posta, parola ve TOTP sırrı (base32;
   incelemeci kodu kendi doğrulayıcısında üretir) yazılır. Sır (parola, TOTP sırrı) repoya, sürüm notuna, günlüğe
   GİRMEZ — yalnız Play Console'a. Gerçek fabrika verisi inceleme tesisinde bulunmaz.
3. Görseller yer tutucu (ikon, uyarlanır ikon, açılış, mağaza ikonu, öne çıkan görsel) — nihai görsel kullanıcı onayıyla.
4. Native push (sonraki sürüm): Firebase/APNs + EAS proje kimliği + veri güvenliği formu güncellemesi (§1).
5. iOS: Xcode kurulumu sonrası ayrı runbook (bundle `com.etkiliyazilim.tekserp.patron` app.json'da hazır).

## 7. Ölçüm — ilk paket (2026-10-15)

| | |
|---|---|
| AAB | `tekserp-patron-1.0.0-vc1.aab` · 46.5 MB · SHA-256 `4cccebb929972fe949f0aebc02afa38bb0a4f257155af7e0263a4701d159e968` |
| Duman APK | `tekserp-patron-1.0.0-vc1.duman.apk` · 69.1 MB (4 ABI) · SHA-256 `a4d2e556528eac36f0d196aa33466960b4804597042dc89fa12040508d008601` — dağıtılmaz |
| `aapt2 dump badging` | `com.etkiliyazilim.tekserp.patron` · versionCode 1 · versionName 1.0.0 · targetSdk 36 · etiket "TeksERP Patron" |
| İzinler | `INTERNET` + `com.etkiliyazilim.tekserp.patron.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (AndroidX, imza düzeyi, uygulamaya özel) |
| Bileşenler | Firebase/bildirim servisi yok (yalnız FileSystemFileProvider · androidx.startup · profileinstaller) |
| İmza | yükleme sertifikası (`keytool -printcert -jarfile` = anahtar; APK'da `apksigner verify`) |
| Duman (Pixel_10_Pro emülatör, API 37) | kurulum ✓ · açılış 373 ms, çökme yok · giriş ekranı çizildi · var olmayan hesapla (`duman@ornek.invalid`) giriş → üretim sunucusu TOTP adımını döndürdü (gidiş-dönüş ✓; hesap sayımı koruması aynı yanıtı verir) · kod girilmedi |
| Parola sızıntısı | derleme günlüğünde kasa parolası aranıp bulunmadı |
