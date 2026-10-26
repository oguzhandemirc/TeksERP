# TeksERP Yönetim (patron uygulaması) — Google Play (Android) ilk sürüm runbook'u

> Durum (2026-10-16): uygulama kullanıcıya **"TeksERP Yönetim"** adıyla görünür, paket `com.etkiliyazilim.tekserp.yonetim`,
> bulut adresi `https://yonetim.etkiliyazilim.com` (kullanıcı kararı 2026-10-16: "patron" kaba bulundu; iç kod/dizin/izin
> adları `patron` kalır). Play'de YENİ uygulama: ilk AAB 1.0.2 · vc1 (§9). Eski paket `…tekserp.patron` (1.0.0 · vc1,
> 1.0.1 · vc2; §7–§8) Play'e HİÇ YÜKLENMEDİ — emekli, kullanılmaz. iOS sonra (Xcode kurulumu).
> Kararlar (kullanıcı 2026-10-15): önce yalnız Android · ilk sürümde telefonda ANLIK BİLDİRİM YOK (Firebase yok;
> uygulama native push kaydı denemez, uyarı göstermez; bildirim ekranında "yakında" notu) · web push aynen.
> Tablet (ortak paket) Play yolu ayrıdır: `PLAY-STORE-YAYIN.md` · `PLAY-KONSOL-FORMLARI.md`.
> Play geliştirici hesabı **KİŞİSEL** (Console ana sayfası "Etkili Yazılım LTD · Kişisel hesap", ölçüm 2026-10-20):
> "12 test kullanıcısı × 14 gün kapalı test" şartı bu uygulamaya **uygulanır** (§3 madde 7). Düzeltme notu:
> 2026-10-15'teki "hesap KURUMSAL, şart yok" hükmü GEÇERSİZ → 2026-10-20 (arşiv 2026-10-20).

| | |
|---|---|
| Paket adı | `com.etkiliyazilim.tekserp.yonetim` (ilk AAB yüklenince Play'de kalıcı kimlik; 2026-10-16 öncesi `…tekserp.patron` hiç yüklenmedi) |
| Görünen ad | TeksERP Yönetim (`app.json` `expo.name` = `android-derleme.cjs` `GORUNEN_AD`; `build-aab` manifest etiketini ölçer) |
| Sürüm | `patron/uygulama/app.json` → `expo.version` (versionName) + `expo.android.versionCode` — tek kaynak; her yüklemede versionCode +1 (yeni uygulama vc1'den başladı) |
| Bulut adresi | `https://yonetim.etkiliyazilim.com` (`scripts/lib/android-derleme.cjs` `PATRON_API`; derlemeye gömülür, `.env*` okunmaz). `patron.etkiliyazilim.com` aynı sunucunun KALICI takma adıdır (kurulu fabrikalar), uygulamada geçmez |
| Yükleme anahtarı | `~/.tekserp/patron-android/yukleme/tekserp-patron-yukleme.keystore` (repo DIŞI, 700/600) · alias `tekserp-patron-yukleme` |
| Parola | macOS Anahtar Zinciri `tekserp/patron-play-yukleme` (hesap `tekserp`) — hiçbir çıktıya/dosyaya basılmaz |
| Şifreli yedek | `patron/uygulama/keystore-yedek.tar.gz.enc` + `keystore-yedek.README.md` |
| Çıktı | `~/.tekserp/patron-android/cikti/tekserp-yonetim-<sürüm>-vc<kod>.aab` + `.sha256` (eski `tekserp-patron-*` dosyaları emekli paketindir, yüklenmez) |
| Görseller | Uygulama: `patron/uygulama/assets/` (tablet logosu + altın halka; `scripts/yer-tutucu-gorsel.cjs`). Mağaza: `patron/uygulama/magaza/` (metin + simge + öne çıkan görsel + MASKELİ ekran görüntüleri; §10) — Play'e yüklendi 2026-10-16. |

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
birleşik manifestte paket/versionCode/versionName, uygulama etiketi (`@string/app_name` = `GORUNEN_AD`), izin kümesi yalnız
`INTERNET` (+ AndroidX'in uygulamaya özel `<paket>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`'ı; paketten türetilir), Firebase/bildirim bileşeni yok, `allowBackup` kapalı; JS paketinde
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
2. **Uygulama oluştur:** Play Console → Tüm uygulamalar → **Uygulama oluştur** → ad "TeksERP Yönetim" · varsayılan
   dil Türkçe · Uygulama · Ücretsiz · beyanlar ✓. (Paket adı ilk AAB yüklenince `com.etkiliyazilim.tekserp.yonetim` olarak kilitlenir.)
3. **Play App Signing:** ilk sürüm oluştururken "Google tarafından oluşturulan anahtar" (varsayılan) seçili kalsın.
4. **Dahili test:** Test → Dahili test → Yeni sürüm → `~/.tekserp/patron-android/cikti/tekserp-yonetim-<sürüm>-vc<kod>.aab` (en yenisi §9)
   yükle → sürüm notu (aşağıda §5.4) → test kullanıcıları listesi → kaydet → yayınla. Yüklemeden önce sha256'yı
   `.sha256` dosyasıyla karşılaştır (`shasum -a 256 <aab>`).
5. **Mağaza girişi:** YAPILDI 2026-10-16 (API, §10): tr-TR + en-US metin, simge, öne çıkan görsel, 7 maskeli telefon
   ekran görüntüsü, iletişim. Console'da yalnız gözden geçirilir; kalan formlar `PLAY-SABAH-YAPILACAKLAR.md` § A.
6. **Uygulama içeriği formları:** gizlilik politikası URL'si `https://tekserp.etkiliyazilim.com/yonetim-gizlilik`
   (§4.1 — önce sayfa VDS'e yayımlanmalı), uygulama erişimi (inceleme hesabı — §6 madde 2), reklam yok, hedef
   kitle 18+, veri güvenliği (§4.2), içerik derecelendirmesi (iş uygulaması, kullanıcı etkileşimi: kullanıcılar
   arası iletişim yok), hesap silme URL'si `https://tekserp.etkiliyazilim.com/yonetim-gizlilik#hesap-silme` (§4.3).
7. **Üretim yayını:** hesap KİŞİSEL (ölçüm 2026-10-20) olduğu için kapalı test şartı KAPIDIR: en az 12 test
   kullanıcısı 14 gün kesintisiz kapalı teste katılmış olmalı, ardından Console → **Üretim erişimi başvurusu**
   yapılır; onaydan sonra Üretim → Yeni sürüm (ya da Kapalı test → Sürümü tanıt → Üretim). İlk üretim sürümü Play
   incelemesine girer (§6 madde 2 inceleme hesabı hazır olmadan gönderilmez). Adımlar ve takvim:
   [`PLAN-play-kapali-test-12x14.md`](PLAN-play-kapali-test-12x14.md). (Düzeltme 2026-10-20: önceki "kurumsal hesap,
   şart yok" cümlesi yanlıştı.)

## 4. Gizlilik ve veri güvenliği

### 4.1 Gizlilik politikası adresi — `/yonetim-gizlilik`

- **Adres: `https://tekserp.etkiliyazilim.com/yonetim-gizlilik`** (yayın kullanıcı onayıyla VDS'e — repo hazır,
  2026-10-16; dağıtım `GIZLILIK-SAYFASI.md` § Patron sayfası). Metin kimliği `YONETIM-GP-2026.3`, yürürlük 16 Ekim 2026.
  Eski `/patron-gizlilik` (ve `/patron-gizlilik/`) kalıcı 301 ile buraya döner; `#çapa` tarayıcıda korunur.
- Tek kaynak `docs/legal/PATRON-GIZLILIK-POLITIKASI.md` → `node deploy/gizlilik-sayfasi/uret.mjs` →
  `deploy/gizlilik-sayfasi/html/yonetim-gizlilik.html` (tabletinkiyle aynı köken ve düzenek, ayrı sayfa; patron
  sunucusuna dokunmaz). Bekçi `scripts/test_gizlilik_sayfasi.mjs` bayt-eşitliği, `#hesap-silme` çapasını, saklama
  sürelerini (`patron/sunucu` koduna karşı) ve native push cümlesini (`NATIVE_PUSH`) ölçer.
- Kaynağı PBAM'dır (`docs/hukuk/PATRON-BULUTU-AYDINLATMA-METNI.md`, taslak, uygulamada gösterilecek aydınlatma
  metni) ama SADE bir uygulama politikasıdır: veri sorumlusu fabrika · veri işleyen Etkili Yazılım, toplanan veriler
  (aşağıdaki §4.2 tablosuyla BİREBİR), amaç, aktarım (Cloudflare; native push kapalı), saklama, güvenlik, KVKK md. 11,
  18+, değişiklikler, iletişim, hesap silme. §4.2 değişirse politika §2 aynı commit'te değişir (ve tersi).
- `https://tekserp.etkiliyazilim.com/gizlilik` TABLET uygulamasının politikasıdır ("Etkili Yazılım bu verileri
  toplamaz") — TeksERP Yönetim için YANLIŞTIR, kullanılmaz. `https://yonetim.etkiliyazilim.com/gizlilik` SPA giriş HTML'idir, metin değil.

### 4.2 Veri güvenliği formu — toplanan veri (koddan ölçüldü, 2026-10-15)

Uygulamada analitik, reklam, çökme raporu SDK'sı YOK; Firebase YOK; reklam kimliği (`AD_ID`) engelli. Bütün
trafik HTTPS (`usesCleartextTraffic` varsayılan kapalı, adres `https://`). Veri yalnız `yonetim.etkiliyazilim.com`'a gider.

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
Hesaplar yalnız davetle açılır. Üç yol var (kullanıcı kararı 2026-10-15):

- **Uygulama içi (kişinin kendisi):** Profil → "Hesabımı sil" → açıklama ekranı → parola + güncel
  doğrulama kodu → iki adımlı onay (`POST /api/oturum/hesap-sil`). Hesap HEMEN kapanır: kimliğin bütün tesis
  üyelikleri PASİF, kabul edilmiş ama onaylanmamış davetleri de PASİF (eski belirteç 404), bütün oturumlar düşer,
  bildirim cihazları pasif; 30. günde ad, e-posta, parola özeti, TOTP sırrı
  silinir (bakımın mevcut silmesi). İstisna: güvenlik kayıtları kendi süresiyle (başarısız giriş 90 gün, diğerleri
  2 yıl; IP 30 gün) — politikada açıkça yazılı. Bir tesisin son aktif hesap yöneticisi önce başka yönetici
  atamalıdır (409 `SON_YONETICI`). Geri alma: 30 gün içinde tesis yöneticisi yeniden davet eder.
  Bekçi `test_hesap_kendini_silme`, uygulama `__tests__/account-deletion.test.tsx`.
- **Tesis yöneticisi:** "arşiv" işlemi (PASİF → 30. günde kimlik silinir, `test_kimlik_silme`).
- **Web:** `https://tekserp.etkiliyazilim.com/yonetim-gizlilik#hesap-silme` — uygulamaya erişimi olmayan kullanıcı
  tesis yöneticisine ya da kayıtlı e-posta adresinden `info@etkiliyazilim.com`a yazar; 30 gün içinde sonuçlanır.
  Play formundaki "hesap silme URL'si" alanına bu adres girilir.
- Form cevabı: kullanıcı silme isteyebilir **Evet** · veri silindiğinde saklanan: güvenlik kayıtları (süreli).

## 5. Mağaza metni taslağı (Türkçe)

### 5.1 Uygulama adı (≤ 30)
`TeksERP Yönetim`

### 5.2 Kısa açıklama (≤ 80)
`Fabrikanızın üretim, sevkiyat, stok ve sipariş özetini cebinizden izleyin.`

### 5.3 Uzun açıklama (≤ 4000)

```text
TeksERP Yönetim, TeksERP kullanan tekstil fabrikalarının sahipleri ve yöneticileri için hazırlanmış güvenli
bir takip uygulamasıdır. Fabrikanızın TeksERP sistemi, seçtiğiniz özet verileri şifreli bağlantıyla TeksERP
Yönetim bulutuna gönderir; siz de bu verileri telefonunuzdan, tabletinizden ya da tarayıcınızdan görürsünüz.

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
TeksERP Yönetim yalnız TeksERP kullanan ve TeksERP Yönetim hizmeti açık olan fabrikaların davet ettiği hesaplarla
çalışır. Hesabınızı tesis yöneticinizden davet bağlantısıyla alırsınız.

Anlık bildirimler bu sürümde telefonda yoktur; bildirimleri web sürümünden alabilirsiniz. Telefon bildirimleri
sonraki sürümde gelecek.

Destek: info@etkiliyazilim.com
```

### 5.4 Sürüm notu (≤ 500)

| Sürüm | Not |
|---|---|
| 1.0.0 · vc1 | `İlk sürüm: pano, üretim, sevkiyat, stok, finans, siparişler, cariler, gelen kutusu, raporlar, çoklu tesis.` |
| 1.0.1 · vc2 | `Hesabınızı artık uygulamadan silebilirsiniz: Profil → "Hesabımı sil". Silme parola ve doğrulama kodunuzla onaylanır; hesabınız hemen kapanır, kişisel bilgileriniz 30 gün içinde silinir.` |

Yukarıdaki iki satır emekli `…tekserp.patron` paketinindir (Play'e yüklenmedi). YENİ uygulamanın ilk sürüm notu (taslak —
kullanıcı terfide onaylar):

| Sürüm | Not |
|---|---|
| 1.0.2 · vc1 (`…tekserp.yonetim`) | `İlk sürüm: pano, üretim, sevkiyat, stok, finans, siparişler, cariler, gelen kutusu, raporlar, çoklu tesis. Hesabınızı uygulamadan silebilirsiniz: Profil → "Hesabımı sil".` |
| 1.1.0 · vc2 (`…tekserp.yonetim`, v2 görünümü; kaynak `magaza/surum-notu-vc2.tr-TR.txt`, 393 karakter) | `Yeni görünüm: uygulama baştan tasarlandı. Alt sekmelerle Pano, Üretim, Siparişler ve Finans tek dokunuşta. Pano günün özetini ve dikkat isteyen konuları öne çıkarır. Karanlık mod eklendi; Profil'den Sistem, Açık ya da Koyu seçebilirsiniz. Ekranlar yeni veriyi kendiliğinden tazeler. Siparişlerde arama ve durum süzgeci, cari ayrıntısında son hareketler var. Raporlarda tarih seçimi kolaylaştı.` |

### 5.5 Kategori ve iletişim
Kategori **İş** · e-posta `info@etkiliyazilim.com` · web sitesi (varsa) · gizlilik politikası
`https://tekserp.etkiliyazilim.com/yonetim-gizlilik` (§4.1).

## 6. Açık konular

1. Gizlilik politikası + hesap silme sayfası repoda hazır (§4.1, §4.3), **VDS'e yayın kullanıcı onayıyla**
   (`GIZLILIK-SAYFASI.md` § Patron sayfası). Uygulama içi "Hesabımı sil" 1.0.1 · vc2'de (`15a4fed81`); web sayfası yayımlanmadan Play
   formu tamamlanmaz.
2. **İnceleme hesabı — KARAR (kullanıcı 2026-10-15):** DEMO sınıfı tesis + uydurma veri + o tesiste inceleme hesabı.
   Play Console → Uygulama içeriği → **Uygulama erişimi** talimatına e-posta, parola ve TOTP sırrı (base32;
   incelemeci kodu kendi doğrulayıcısında üretir) yazılır. Sır (parola, TOTP sırrı) repoya, sürüm notuna, günlüğe
   GİRMEZ — yalnız Play Console'a. Gerçek fabrika verisi inceleme tesisinde bulunmaz.
3. Uygulama içi görseller (ikon, uyarlanır ikon, açılış) yer tutucu; mağaza görselleri bunlardan üretildi (§10) — nihai marka görseli gelirse ikisi birlikte değişir.
4. Native push (sonraki sürüm): Firebase/APNs + EAS proje kimliği + veri güvenliği formu güncellemesi (§1).
5. iOS: Xcode kurulumu sonrası ayrı runbook (bundle `com.etkiliyazilim.tekserp.yonetim` app.json'da hazır).
6. Görseller/ekran görüntüleri "Patron" yazısı taşımamalı (yer tutucu ikonda yazı yok; ekran görüntüleri yeni adla alınır).

## 7. Ölçüm — ilk paket (2026-10-15; EMEKLİ paket `…tekserp.patron`, yüklenmedi)

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

## 8. Ölçüm — 1.0.1 · vc2 (2026-10-15; EMEKLİ paket `…tekserp.patron`, yüklenmedi)

| | |
|---|---|
| Yenilik | Profil → "Hesabımı sil" (`app/(app)/hesap-sil.tsx`, `15a4fed81`) |
| AAB | `tekserp-patron-1.0.1-vc2.aab` · 46.5 MB · SHA-256 `99844b1f1d2d11004331f19e59c6570051983e37424b6bd19cd665e2465668da` |
| Duman APK | `tekserp-patron-1.0.1-vc2.duman.apk` · 69.1 MB · SHA-256 `794de80cce2df5e3113d29bfd16f7c194d8ce63ee1e593429bd56369a3105d15` — dağıtılmaz |
| `aapt2 dump badging` | `com.etkiliyazilim.tekserp.patron` · versionCode 2 · versionName 1.0.1 · targetSdk 36 · etiket "TeksERP Patron" |
| İzinler | `INTERNET` + `…DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (vc1 ile aynı) · imza yükleme sertifikası `3DD96B00…` |
| JS paketi | bulut adresi var, geliştirme adresi yok · "Hesabımı sil" dizgesi (Hermes UTF-16) ve `hesap-sil` rotası var · `NATIVE_PUSH = false` |
| Duman (Pixel_10_Pro, API 37) | kurulum ✓ (vc2) · çökme yok · giriş ekranı çizildi · oturumsuz `tekserp-patron://hesap-sil` → giriş ekranı (koruma ✓) · Profil ekranı giriş gerektirdiğinden görülmedi |
| Parola sızıntısı | AAB + APK derleme günlüklerinde kasa parolası aranıp bulunmadı |

## 9. Ölçüm — TeksERP Yönetim 1.0.2 · vc1 (2026-10-16, YENİ paket `…tekserp.yonetim`)

| | |
|---|---|
| AAB | `tekserp-yonetim-1.0.2-vc1.aab` · 46.5 MB · SHA-256 `07c5e415d248f20751690224082adb96254d049e277090ac18d1bedde0964609` |
| Duman APK | `tekserp-yonetim-1.0.2-vc1.duman.apk` · 69.1 MB · SHA-256 `05cd2aac3c39a4fb432f0f66a987e107ad758a6ba1ef81c7b2289377105a0676` — dağıtılmaz |
| `aapt2 dump badging` | `com.etkiliyazilim.tekserp.yonetim` · versionCode 1 · versionName 1.0.2 · targetSdk 36 · etiket "TeksERP Yönetim" (bütün yerellerde) |
| İzinler | `INTERNET` + `com.etkiliyazilim.tekserp.yonetim.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` · imza yükleme sertifikası `3DD96B00…` (vc1/vc2 ile AYNI anahtar) |
| JS paketi | `https://yonetim.etkiliyazilim.com` var · `patron.etkiliyazilim.com` YOK · geliştirme adresi yok · "TeksERP Yönetim" var, "TeksERP Patron" yok |
| Önbellek dersi | ilk deneme doğrulamada KIRMIZI: ortak `$TMPDIR/metro-cache` eski `EXPO_PUBLIC_PATRON_API` (patron) değerini gömmüştü (Metro dönüşüm anahtarı env değerini katmaz); `build-aab` artık her derlemeye kendi boş TMPDIR'ini verir |
| Duman (Pixel_10_Pro, API 37) | kurulum ✓ (vc1) · çökme yok · giriş ekranı "TeksERP Yönetim" · E-posta/Parola/Devam/Davet kodum var · giriş DENENMEDİ (derleme anında `yonetim` DNS kaydı yoktu; artık canlı — `PATRON-BULUTU-KURULUM.md` §15a) |
| Parola sızıntısı | AAB + APK derleme günlüklerinde kasa parolası aranıp bulunmadı |
| Play (2026-10-16 01:50 TSİ) | **dahili test** `internal [completed: 1]` "1.0.2 (1)" — hizmet hesabıyla yüklendi, geri okundu; sürüm notu §5.4; diğer kanallar boş; yayın defteri `yonetim-1.0.2-play-internal`. Bulut `yonetim.etkiliyazilim.com` canlı (`PATRON-BULUTU-KURULUM.md` §15a) |
| Mağaza girişi (2026-10-16 ~02:40 TSİ) | `node deploy/play-magaza.mjs --app=yonetim --uygula` → tek edit COMMIT, geri okundu: tr-TR + en-US başlık/kısa/tam · simge 1 · öne çıkan 1 · telefon ekran görüntüsü 7 (her dilde) · `contactEmail` `info@etkiliyazilim.com` · `contactWebsite` `https://tekserp.etkiliyazilim.com` · varsayılan `tr-TR` |
| Üretim denemesi (2026-10-16) | `--uretim=1 --yuzde=20` → `400 FAILED_PRECONDITION "Precondition check failed."`; commit edilmeyen sondada `draft`/`completed`/`inProgress` üçü de aynı, `alpha` taslağı 200. Olası neden (kesin değil): kişisel hesabın 12×14 kapalı test + üretim erişimi şartı henüz karşılanmadı (2026-10-20). Play eksiği adlandırmıyor → Console görevleri `PLAY-SABAH-YAPILACAKLAR.md` § A. Veri güvenliği API'ye GÖNDERİLMEDİ (CSV şablonu elde yok) |

## 10. Mağaza girişi kaynakları ve araç (2026-10-16)

| | |
|---|---|
| Metin | `patron/uygulama/magaza/metinler.json` — `listings` (tr-TR, en-US: `title` ≤30, `shortDescription` ≤80, `fullDescription` ≤4000) + `details` (iletişim, varsayılan dil). Yetenek listesi koddan (`app/(app)/*`, `src/lib/access.ts`); kodda olmayan özellik yazılmaz |
| Görsel | `magaza/gorseller/icon.png` (512, 32 bit, `assets/icon.png`'den) · `featureGraphic.png` (1024×500, 24 bit; logo + altın halka + ad) · `phoneScreenshots/*.png` (1080×1920, 24 bit) |
| Üretim | `swift deploy/play-magaza-gorsel.swift ikon / one / maske …` — yalnız macOS AppKit; dış font/asset indirilmez |
| Ekran görüntüsü | **1.1.0'dan itibaren (2026-10-24):** web çıktısı (`npx expo export --platform web`) + Playwright Chromium + SAHTE API (istekler sayfa içinde yakalanır, tel şekli `src/api/wire.ts`; oturum yanıtı P6 `liste` yeteneğini taşır, yoksa yeni liste görünümleri açılmaz), görüntü alanı 432×768 @2.5 = 1080×1920, 24 bit; üstte düğmesi olan ekranda (03) telefon durum çubuğu payı için kök 24 px aşağı kaydırılır. Gerçek veri HİÇ yoktur → maske gerekmez; her görüntü yine gözle denetlenir. Sıra: 01-pano · 02-uretim · 03-siparisler · 04-finans · 05-cariler · 06-gelen-kutusu · 07-profil (koyu). **1.0.2'de (emekli yöntem):** Pixel_10_Pro emülatörü `wm size 1080x1920` + `wm density 420`, duman APK, inceleme hesabıyla giriş; inceleme tesisi GERÇEK veri taşıdığı için her sayı/no/tarih/ad `uiautomator` sınırlarından opak düz kutuyla kapatıldı (`maske`). Maskesiz gerçek veri görüntüsü repoya GİRMEZ |
| Yükleme | `node deploy/play-magaza.mjs --app=yonetim` (kuru okuma; edit silinir) · `--uygula` (details + listings + her dilde görselleri sil-yükle → commit → geri oku) · `--uretim=<vc> --yuzde=<N> --uygula` (yalnız yonetim; not `magaza/surum-notu-vc<vc>.tr-TR.txt`) |

## 11. Ölçüm — 1.1.0 · vc2 (2026-10-24; paket `…tekserp.yonetim`, v2 görünümü)

Kaynak: W2 dalı (uygulama kodu 1.1.0 sürüm commit'iyle aynı; squash sonrası main'deki W2 inişi), `npm run build:apk:duman` — parola Anahtar Zinciri
`tekserp/patron-play-yukleme`'den okundu. AAB DERLENMEDİ ve Play'e yüklenmedi (kullanıcı: `npm run build:aab` →
`node deploy/play-magaza.mjs --app=yonetim --uygula` görseller/metin; sürüm notu §5.4, terfide kullanıcı onayı).

| | |
|---|---|
| Duman APK | `tekserp-yonetim-1.1.0-vc2.duman.apk` · 78.2 MB · SHA-256 `0eb68e7a8b634a204c89d8fe78eeaf5ef26cedd53a1dc12c3fd43bd9628ab98b` — dağıtılmaz |
| `aapt2 dump badging` | `com.etkiliyazilim.tekserp.yonetim` · versionCode 2 · versionName 1.1.0 · targetSdk 36 · etiket "TeksERP Yönetim" |
| İzinler | yalnız `INTERNET` + `com.etkiliyazilim.tekserp.yonetim.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` |
| Firebase / bildirim | manifestte `firebase` / `c2dm` / `gms.messaging` eşleşmesi 0 · `NATIVE_PUSH = false` aynen · `allowBackup=false` |
| İmza | yükleme sertifikası `3dd96b00468f3f8c…` (1.0.2 vc1 ile AYNI anahtar) |
| JS paketi | `yonetim.etkiliyazilim.com` var · `patron.etkiliyazilim.com` yok · tek `localhost:8081` eşleşmesi React Native kütüphanesinin Metro varsayılanı (bağlam ölçüldü), uygulama geliştirme adresi yok (`build-aab` doğrulaması yeşil) |
| Parola sızıntısı | derleme günlüğünde kasa parolası aranıp bulunmadı |
| Mağaza görselleri | 7 telefon görüntüsü (§10 yöntemi) · `node scripts/test_play_magaza.mjs` 29/0 |
| Emülatör dumanı | koşulmadı (görsel doğrulama web çıktısında yapıldı); kullanıcı yüklemeden önce isterse: `adb install -r ~/.tekserp/patron-android/cikti/tekserp-yonetim-1.1.0-vc2.duman.apk` |

## 12. Ölçüm — 1.2.0 · vc3 (2026-10-26; paket `…tekserp.yonetim`, v2 + UX-4; Play yükleme: KULLANICI)

Kaynak: `chore/patron-yayin-1026` (origin/main `5156f26d2` + yalnız `app.json`/`package.json` sürüm artışı: 1.1.0 → **1.2.0**,
versionCode 2 → **3**; vc2 Play'e yüklenip yüklenmediği belirsiz olduğundan kod bir daha kullanılmadı). `npm test` 36 paket /
324 test ✅ · `npm run typecheck` ✅ · `npm run build:aab` (parola Anahtar Zinciri `tekserp/patron-play-yukleme`'den; argv'ye
girmez; derleme günlüğünde parola kalıbı 0). `google-services.json` YOK ve `PATRON_NATIVE_PUSH` verilmedi → `app.config.js`
app.json'u aynen kullandı (N5 kapısı KAPALI = bugünkü davranış). **Claude yükleme YAPMAZ** — Play Console'a yükleme kullanıcıda.

| | |
|---|---|
| AAB | `~/.tekserp/patron-play/1.2.0-vc3/tekserp-yonetim-1.2.0-vc3.aab` · 55 451 819 bayt · SHA-256 `0704d6b101995a07bde5f206783e12687a075fb201e08e828839df247d2f9800` (`.sha256` ile eşit; kopya `~/.tekserp/patron-android/cikti/`) |
| build-aab doğrulaması | `com.etkiliyazilim.tekserp.yonetim` · versionCode 3 · versionName 1.2.0 · etiket "TeksERP Yönetim" · `allowBackup=false` · JS paketinde bulut adresi var, geliştirme adresi yok |
| İzinler (`uses-permission`) | yalnız `INTERNET` + `com.etkiliyazilim.tekserp.yonetim.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` — `POST_NOTIFICATIONS` YOK (engelde), ön plan hizmeti YOK (`FOREGROUND_SERVICE` 0 eşleşme); `android.permission.DUMP` yalnız AndroidX profil yükleyici alıcısının `android:permission` niteliğidir, istenen izin değil |
| Firebase / bildirim | AAB manifestinde `firebase` / `c2dm` / `gms.messaging` meta-data 0 · `NATIVE_PUSH = false` aynen |
| İmza | yükleme sertifikası `3dd96b00468f3f8c…` (1.0.2 vc1 ve 1.1.0 vc2 ile AYNI anahtar) |
| Duman APK | `tekserp-yonetim-1.2.0-vc3.duman.apk` · 82 013 059 bayt · SHA-256 `97e7b79ffbc90e8a3a8cc0184de56f7a2d7f36b2f01c44bb1c62e9367e5739e4` — dağıtılmaz. `aapt2 dump badging`: `com.etkiliyazilim.tekserp.yonetim` · versionCode 3 · versionName 1.2.0 · **targetSdk 36** · minSdk 24 · etiket "TeksERP Yönetim" · `uses-permission` yalnız `INTERNET` + `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` · manifestte `firebase`/`c2dm`/`gms.messaging` 0 · `FOREGROUND_SERVICE`/`POST_NOTIFICATIONS` 0 |
| Emülatör dumanı | zaten açık `emulator-5558`e `adb install -r` → `Success`; `dumpsys package` versionCode 3 · targetSdk 36; `MainActivity` ön planda, 12 sn sonra giriş ekranı (logo · "TeksERP Yönetim" · E-posta · Parola · Devam · Davet kodum var; ikonlar çizili), logcat'te FATAL 0. Not: `dumpsys` "requested permissions" listesinde `android.permission.ACCESS_LOCAL_NETWORK` görünür — Android 16'nın targetSdk 36 uygulamalara eklediği örtük izindir, manifestte YOK (aapt2 2 izin); veri güvenliği formunu etkilemez |
| Play yükleme | **kullanıcı** — dahili test kanalı; sürüm notu §5.4 kalıbı (v2 görünümü, arama/çipler, anlık tazeleme); vc3 |
