# Fabrika ağında TLS (plan 6.1 · §C-2)

> Durum: D1–D2 uygulandı (backend); dilimler §8. Karar notu: `docs/history/arsiv/2026-10.md` §2026-10-06 LAN TLS. Kural satırı: `docs/kurallar/kesif-cihaz.md`.

## 1. Tehdit

Panel/tablet ↔ fabrika backend trafiği bugün yerel ağda düz HTTP. Aynı ağdaki biri (misafir Wi-Fi, ele geçmiş bir PC, kabloya takılan cihaz):

- **dinler:** JWT, parola, hızlı PIN, kart kodu, iş verisi açık metin geçer;
- **araya girer:** ARP/DHCP sahtekârlığı ya da sahte mDNS ilanıyla istemciyi kendine çeker, istekleri gerçek sunucuya aktarır (relay). Bugünkü `installationId` sabitlemesi bunu YAKALAMAZ: aktarıcı gerçek sunucunun kimlik yanıtını aynen geçirir.

Kapsam dışı: sunucu makinesinin ya da istemci cihazın kendisinin ele geçmesi, fiziksel erişim.

## 2. Ölçüm — keşif yanıtı imzalı mı?

**Hayır.** `GET /api/discovery/identity` imzasız JSON, mDNS TXT imzasız; `installationId` bilerek sır değildir (`jobs/installation-identity.job.ts`). Kurulumun Ed25519 anahtarı (`LICENSE_DIR`) ve satıcı imzalı kira var, ama panelde ve tablette bunları doğrulayacak bir çapa yok. ⇒ Keşiften ya da ilk girişten öğrenilen parmak izi TOFU olur (araya giren saldırgan ilk bağlantıda kendi sertifikasını sabitletir). Güven, keşfe değil **eşleştirmeye** konur (§4).

## 3. Sertifika yaşam döngüsü

- **Biçim:** ECDSA P-256, SHA-256 imzalı, kendinden imzalı X.509 v3. Node `crypto` sertifika ÜRETEMEZ (yalnız okur); paket eklemeden küçük bir DER kurucu yazılır (`src/lib/lan-tls/x509.ts`), çıktısı `X509Certificate` ile okunup imzası doğrulanarak ölçülür.
- **Kimlik adreste değil parmak izinde:** SAN yalnız makine adı + `localhost` + `127.0.0.1`. LAN IP'leri DHCP ile değişir; istemci ana makine adını değil sertifikanın SHA-256'sını denetler.
- **Geçerlilik 10 yıl.** Sabitleme tarihe bakmaz; süre, sertifikayı tarihle düşürmeyen bir sınır olarak durur.
- **Saklama:** `LAN_TLS_DIR` (yoksa `<LICENSE_DIR>/lan-tls`); `anahtar.pem` 0600, `sertifika.pem`. Lisans deposu program dizininde/yedek dizininde ise (güncelleyici siler) TLS deposu da kurulmaz.
- **Yükleme kuralı** (lisans deposuyla aynı desen): dosya yok → üret · bozuk/çift uyuşmuyor → kenara al (`.bozuk-<zaman>`) + üret, yüksek sesle uyar (parmak izi değişti, istemciler yeniden eşleşir) · okunamıyor → ÜRETME, TLS dinleyicisi açılmaz (sessiz anahtar değişimi yok).
- **Yenileme (D7):** sunucu "sonraki" sertifikayı üretir; sabitli istemci, ZATEN DOĞRULANMIŞ kanaldan sonraki parmak izini öğrenip pin kümesine ekler (TOFU değil); geçiş süresi sonunda sunucu takas eder. Elle zorunlu yenileme = yeniden eşleştirme.
- **Yedek:** ilk sürümde anahtar yedeğe girmez — yeni makineye dönüşte yeni sertifika = istemciler yeniden eşleşir. İleride kısa kimlik emaneti gibi yedeğe mühürlenebilir.

## 4. Parmak izi dağıtımı — güven kökleri

| Kök | Kim kullanır | Neden taklit edilemez |
|---|---|---|
| a) **Loopback** (`127.0.0.1`) | Sunucu makinesindeki panel; durum sayfası `http://localhost:<PORT>/` | Paket makineden çıkmaz; LAN saldırganı göremez/değiştiremez |
| b) **Göz ile karşılaştırma** | Başka makinedeki panel, ilk geçişte | Panel parmak izini gruplar hâlinde gösterir; kullanıcı sunucu ekranındaki (durum sayfası, kurulum sonu) kodla aynı olduğunu ONAYLAR. Onaysız sabitleme yok |
| c) **QR** | Tablet | Sabitli panelin Cihazlar ekranında (ya da durum sayfasında) gösterilen `teks-erp-tls` QR'ı okutulur — kanal görsel |
| d) Lisans zinciri (ileride, isteğe bağlı) | Hepsi | Kurulum anahtarıyla imzalı TLS beyanı + satıcı imzalı kira; istemciye satıcı çapası gömülürse firma adı imzalı görünür. Bu turda YOK |

QR yükü: `teks-erp-tls:1:<installationId>:<parmak-izi-hex>:<tlsPort>`. Parmak izi = sertifika DER'inin SHA-256'sı (Electron `certificate.fingerprint` ve Android `MessageDigest(cert.encoded)` ile aynı değer).

Reddedilenler: keşiften/ilk girişten otomatik sabitleme (TOFU) · IP'ye bağlı sertifika (DHCP) · genel CA (yerel IP için yok) · istemciye ortak CA gömmek (tek ortak paket ⇒ her fabrikada aynı CA özel anahtarı = herkesin anahtarı).

## 5. Geçiş kipleri — `LAN_TLS_MODE` (`.env`, açılışta okunur)

| Kip | HTTP (`PORT`) | HTTPS (`LAN_TLS_PORT`, vars. 4443) | Kimlik ucu `tls` |
|---|---|---|---|
| `off` — **varsayılan = bugünkü davranış** | `HOST`ta | yok | `null` |
| `dual` | `HOST`ta | `HOST`ta, aynı uygulama | `{ port, fingerprint }` |
| `required` | yalnız `127.0.0.1` (yerel araçlar: `kur.ps1` sağlık, durum sayfası, güncelleyici) | `HOST`ta | `{ port, fingerprint }` |

- Tanınmayan değer → uyarı + `off` (web sertleştirmesiyle aynı asimetri: yazım hatası fabrikayı kilitlemesin; banner kipi basar).
- Sertifika yüklenemezse `dual` HTTP ile sürer; `required` LAN'a hiç açılmaz (fail-closed, banner + log hatası). Kaçış: kipi `dual`/`off` yapıp yeniden başlatmak.
- **HSTS AÇILMAZ.** LAN TLS `HTTPS_ENABLED`den bağımsızdır; HSTS sabitli istemcinin `dual`daki HTTP'ye dönüşünü kalıcı kilitlerdi.
- **Eski istemci ne yapar:** `off`/`dual`da hiçbir şey değişmez: HTTP aynı portta, yanıtlar aynı, kimlik yükünde yalnız ek `tls` alanı var ve eski ayrıştırıcı tanımadığı alanı atar (`parseIdentityPayload` — ölçüldü). `required`da eski panel/tablet (adnansahin'in dondurulmuş panel 1.3.7 / tablet 1.0.12 dahil) **bağlanamaz** ("sunucu bulunamadı"). Bu yüzden `required` yalnız bütün istemciler sabitli sürüme geçip `dual`da HTTPS'ten bağlandığı ölçüldükten sonra açılır. adnansahin dondurulmuştur, bu sunucu sürümünü almaz. `minVersion` değişmez.
- **Geri dönüş:** `.env`de `LAN_TLS_MODE=off` (ya da `dual`) + yeniden başlat; sertifika dosyaları silinmez, pinler geçerli kalır. `dual`a dönüş sorunsuzdur (HTTPS sürer, sabitli istemci bağlı kalır). **Bilinen boşluk:** `off`a dönüşte HTTPS kapanır ve sabitli istemci tasarım gereği HTTP'ye düşmediği için bağlanamaz — sabit o istemcide elle kaldırılır (panel: Sunucu Adresi → "Şifreli bağlantıyı kaldır"; tablet: aynı eylem ayarlarda).

## 6. İstemcide sabitleme

**Ortak kural:** sabitlenmiş sunucuda HTTPS başarısızsa istemci HTTP'ye DÜŞMEZ — sessiz düşüş, saldırgana "HTTPS'i boz" demektir. Sabit yoksa bugünkü gibi HTTP.

**Panel (Electron 42) — native paket gerekmez:**
- `session.defaultSession.setCertificateVerifyProc`: sertifikanın SHA-256'sı pin kümesindeyse `0` (kabul), değilse `-3` (Chromium'un kendi kararı — dış https adresleri normal CA ile doğrulanmaya devam eder, kendinden imzalı yabancı sertifika reddedilir).
- Ana süreç probu (`node:https`) sertifikayı kabul edip parmak izini yalnız GÖZLEM olarak döner; güven kararı vermez.
- Pin `config.serverTlsPin` → `MAIN_ONLY_KEYS` (renderer yazamaz; sabitleme yalnız `handleTrusted` IPC'siyle, §4a/§4b koşuluyla).

**Tablet (React Native 0.81 / Expo 54) — NATIVE kod gerekir:**
- axios/fetch Android'de OkHttp'tan geçer; kendinden imzalı sertifika ancak OkHttp'a parmak izi denetleyen bir `X509TrustManager` + `HostnameVerifier` takılarak kabul edilir (`OkHttpClientProvider.setOkHttpClientFactory`). JS'ten yapılamaz, OTA ile gitmez, yeni APK ister.
- Yol (i): depo içinde Expo config eklentisi + küçük Kotlin modülü (yeni npm paketi yok, native kod var). **Karar (kullanıcı 2026-10-07): ONAYLANDI** — native modül (D5) ortak tabletin İLK Play sürümüne girer (tablet dağıtımı Play gizli yayını, `ISTEMCI-ANAHTARI-KOK-ALTINDA.md` §8 karar 5). Yol (ii): hazır pinleme paketleri (`react-native-ssl-public-key-pinning` vb.) OkHttp `CertificatePinner` kullanır; o zincir doğrulamasından SONRA çalıştığı için kendinden imzalıda işe yaramaz.
- Ayrı OkHttp istemcisi kuran yollar da kapsamda: `expo-file-system` indirmesi (APK güncelleme — ortak tablette Play kararıyla kalkar), görsel yükleyici.
- `usesCleartextTraffic` `dual` boyunca açık kalır; `required`a geçen kurulumda kapatılması ayrı karar.
- JS katmanı (D4) native katmandan önce iner ve ona bağlıdır: native modül (`TeksErpLanTls`) yoksa QR'dan sabit YAZILMAZ ve kart görünmez — yazılsaydı ya bağlantı kesilirdi ya da sahte güvenlik hissi doğardı. QR, bağlı sunucunun kimliği ve ilanıyla çapraz denetlenir (kurulum kimliği ya da kod/port farklıysa red).

## 7. Kurulum adımı

**Karar (kullanıcı 2026-10-07):** YENİ kurulumun kipi `dual`dır. Kod varsayılanı `off` KALIR ("bayrak varsayılanı = bugünkü davranış"); `dual`ı kurulum aracı yeni kurulumun `.env`ine yazar. Var olan kurulumun kipine kurulum dokunmaz.

**Uygulama (D6):** yeni kurulum (`deploy/kurulum/kurulum.ps1`, `.env` yokken) `.env`e `LAN_TLS_MODE=dual` yazar (port satırı yazılmaz, 4443; API portu 4443 ise kurulum durur). Onarım/devam ve güncelleme var olan `.env`e LAN_TLS satırı eklemez, olanı değiştirmez. HTTPS güvenlik duvarı kuralı ölçümden (kimlik ucu `tls` doluysa), API ile aynı profil/adreslerle. Dogrulama kodu (SHA-256, 4'lü gruplar) döngü adresindeki kimlik ucundan okur; kod ve durum sayfası adresi (`http://localhost:<PORT>/`) ekrana, sonuç INI'sine ve sihirbazın son sayfasına gider. pm2 yolu (`kur.ps1`, `ilk-kurulum.ps1`) donmuştur, bu özelliği almaz.

## 8. Dilimler

| Dilim | İçerik | Durum |
|---|---|---|
| D1 | Bu not | ✅ |
| D2 | Backend: sertifika üretimi/saklama, `LAN_TLS_MODE` dinleyicileri, kimlik ucunda `tls`, bekçi `test_lan_tls` + `test_lan_tls_http` | ✅ |
| D3 | Panel: doğrulama kancası + pin deposu + https probu + onay diyaloğu + tablet QR'ı | ✅ |
| D4 | Tablet: QR okuma + pin deposu + keşifte engel (JS, OTA ile gider; native yokken etkisiz) | ✅ |
| D5 | Tablet: native zorlama (OkHttp) | **ONAY bekler** |
| D6 | Durum sayfası (yalnız döngü adresinde) + yeni kurulum `dual` + kurulum sonu (sihirbaz son sayfası, `kurulum.ps1`) parmak izi ve durum sayfası; bekçi `test_kurulum_betikleri` §18 + harness `lantls.*` (Windows denemesi bekler) | ✅ |
| D7 | Sertifika yenileme (sonraki parmak izi) | sırada |
