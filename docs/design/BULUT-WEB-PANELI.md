# Bulutta Web Paneli — Sözleşme

> Kullanıcı kararları 2026-10-15 (K1–K4). Tam plan ve gerekçe: arşiv `docs/history/arsiv/2026-10.md` "Bulutta web paneli".

## Kararlar
- **K1 açma:** bulut imajı (`Teks-Erp/docker/korumali/Dockerfile`) `/app/dist-web`'i HEP taşır; panel yalnız `WEB_DIST_DIR` doluyken sunulur (varsayılan boş = kapalı = bugünkü davranış). Windows fabrika paketi panel TAŞIMAZ (B6, değişmez).
- **K2 oturum:** web istemcisinde kimlik httpOnly çerezde; Electron/tablet `Authorization: Bearer` akışı bayt-bayt aynı.
- **K3 yüzey:** webde ekranlar + Excel + A4 yazdırma + PDF (= tarayıcının "Yazdır → PDF olarak kaydet"i, yeni paket yok) açık. Etiket (HTML dahil) · tartı · Bluetooth · tarayıcı/okuyucu · cihaz testi düğmeleri görünür-soluk, "Bu işlem masaüstü uygulamasından yapılır". Sunucu keşfi · güncelleme · sunucu adresi · LAN TLS · lisans aktarımı webde gizli.
- **K4 erişim:** web girişinde TOTP zorunlu + `web:access` izni; SoD üçlüsü değişmez.

## Tel sözleşmesi
| Konu | Kural |
|---|---|
| Çerez | `tekserp_oturum` · `HttpOnly; Secure; SameSite=Strict; Path=/` · Max-Age = oturum süresi (JWT `exp`) |
| Ne zaman basılır | YALNIZ panel kipi (`WEB_DIST_DIR` dolu) **VE** giriş gövdesinde `clientType:"web"`. Bu durumda giriş cevabında `token` alanı YOK, yerine `cookieSession: true`. Panel kipi kapalıyken web girişi bugünkü gibi JSON token alır (demo imajı geriye uyum). |
| Okuma önceliği | `Authorization` başlığı varsa çerez HİÇ okunmaz. |
| CSRF | Çerezle kimliklenen ve yöntemi `GET/HEAD/OPTIONS` olmayan her istekte `X-TeksERP-CSRF: 1` zorunlu; yoksa 403 `details.code = "CSRF_REQUIRED"`. Aynı origin ⇒ CORS ayarı değişmez, `withCredentials` gerekmez. |
| Kanal damgası | Mevcut `Session.deviceType = WEB`. Çerezle gelen istek yalnız `deviceType=WEB` oturumla kabul edilir (değilse 401). Migration YOK. |
| TOTP | Çerez kipinde web girişi TOTP'siz tamamlanmaz: TOTP kurulmamışsa 403 `TOTP_ENROLLMENT_REQUIRED`, kod yoksa 409 `TOTP_REQUIRED`, yanlışsa 401 `TOTP_INVALID` (mevcut kodlar). Dal tek boğazda: `assertSecondFactor`. İstisna (2026-11-01): süperadmin politikayı `auth.webTotpPolicy=USER_CHOICE` yaparsa kendi hesabında `webTotpOptOut` açan kullanıcıya ne kurulum ne kod sorulur; sistem hesabı hep kod verir (arşiv `2026-11.md`). |
| İzin | Çerez kipinde web girişi `web:access` izni olmadan 403 `details.code = "WEB_ACCESS_DENIED"`. İzin `mobile:` önekli DEĞİL; rol şablonlarına varsayılan atanmaz. İstisna: katalogla otomatik eşitlenen "Admin (Tam Yetki)" (`ADMIN_FULL`, `mode:"all"`) izni taşır — tam yetki kabul edildi, TOTP yine zorunlu. |
| Çıkış | `POST /api/auth/logout` (CSRF başlıklı) oturumu iptal eder + `Set-Cookie: tekserp_oturum=; Max-Age=0`. |
| Oturum yoklama | Web istemcisi açılışta `GET /api/auth/me` ile oturumu yoklar (JWT çözmez). |
| Claim | Çerezdeki JWT `permissions: []` taşır (tam liste çerezi 4096 bayt tarayıcı sınırına iterdi: 138 kod ≈ 3,8 KB); yetki DB'den okunur, izin listesi giriş gövdesinin `user.permissions`i ve `/auth/me`dedir. Bearer token'ın claim'i değişmez. Bekçi `test_web_cerez_oturumu` §12. |
| Zorunlu parola değişimi | Kısıtlı oturum da çerezde; `POST /api/auth/change-password` çerez + CSRF ile çalışır. |

## Statik sunum (panel kipi)
`index.html` ve SPA geri düşüşü `Cache-Control: no-store`; özetli `assets/*` `public, max-age=31536000, immutable`; panel kipinde CSP `frame-ancestors 'none'`. `/api/*` asla HTML'e düşmez. Panel kipinde ayrıca `X-Frame-Options: DENY`; özetsiz diğer dosyalar da `no-store`. Bekçi: `Teks-Erp/scripts/test_web_panel_sunumu.ts`, imaj tarafı `test_docker_hijyeni` §7o.

**İmza kapsamı:** `/app/dist-web` imzalı bütünlük listesinin DIŞINDADIR (`public/` gibi) — `/app` root'a ait ve salt-okunur, süreç 10001 kullanıcısıyla koşar, imajın özeti teslimde imzalıdır.
