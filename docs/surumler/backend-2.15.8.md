# Backend `2.15.8`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk hedef yalnız `test` grubu; öncü/genel gruba çıkış ayrı karar.
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** 2.15.7 (`test` grubu, etiket `backend-v2.15.7`). Güncellenecek her kurulumda sahadaki sürüm
kurulumdan önce sunucunun sağlık bilgisinden okunur; tahmin edilmez.

Sürüm numarası: yama hanesi (otomatik, `scripts/backend-surum.mjs`).

## 1. Özet

- **Bulut kurulumunda yönetim paneli tarayıcıdan açılabilir (isteğe bağlı).** Patron ya da istasyon kullanmayan
  yöneticiler, kurulumun adresine tarayıcıdan girip ekranları, listeleri, Excel'i ve A4 yazdırmayı kullanabilir;
  PDF, tarayıcının "Yazdır → PDF olarak kaydet"iyle alınır. Etiket basma, tartı, Bluetooth ve cihaz testi düğmeleri
  görünür ama soluktur: "Bu işlem masaüstü uygulamasından yapılır". Sunucu keşfi, güncelleme ve sunucu adresi
  ayarları tarayıcıda görünmez. Saha işi bugünkü gibi masaüstü panel ve tablette kalır.
- **Varsayılan KAPALI.** Güncellemeden sonra hiçbir şey kendiliğinden değişmez; tarayıcı paneli, kurulumun ayar
  dosyasına tek satır (`WEB_DIST_DIR=/app/dist-web`) eklenip sunucu yeniden başlatılınca açılır. Windows fabrika
  kurulumunda tarayıcı paneli yoktur, değişen bir şey yok.
- **Tarayıcıdan giriş daha sıkı (güvenlik).** Tarayıcıdan yalnız "Tarayıcıdan panel erişimi" (`web:access`) izni
  verilmiş ve iki adımlı doğrulaması kurulu kullanıcı girer; her girişte telefondaki kod sorulur. İzin hiçbir role
  kendiliğinden atanmaz (yalnız "Admin (Tam Yetki)" rolü tam yetki gereği taşır; kod yine sorulur). Oturum
  tarayıcının okuyamadığı güvenli bir çerezde tutulur, tarayıcı belleğine anahtar yazılmaz.
- **Masaüstü panel ve tablet için değişen yok.** Girişleri ve oturumları bayt-bayt aynı kalır.

## 2. Ne değişti

**Bulutta web paneli** (commit `496cecfc0` + dağıtım beyanı `6b52cc6a6`; sözleşme `docs/design/BULUT-WEB-PANELI.md`)

- Korumalı bulut imajı (`Teks-Erp/docker/korumali/Dockerfile`) yeni `panel` aşamasıyla `/app/dist-web`'i HEP taşır;
  panel yalnız `WEB_DIST_DIR` doluyken sunulur (her iki compose dosyasında `${WEB_DIST_DIR:-}`, `.env.ornek` boş).
  `/app/dist-web` imzalı bütünlük listesinin dışındadır (`/app` root'a ait, salt-okunur; imaj özeti imzalı).
- Oturum çerezi `tekserp_oturum` (`HttpOnly; Secure; SameSite=Strict; Path=/`) yalnız panel kipinde VE giriş
  gövdesinde `clientType:"web"` iken basılır; giriş cevabında `token` yerine `cookieSession: true`. Çerezle gelen
  yazma isteği `X-TeksERP-CSRF: 1` ister (yoksa 403 `CSRF_REQUIRED`); çerez yalnız `Session.deviceType=WEB`
  oturumda kabul edilir. `Authorization` başlığı varsa çerez hiç okunmaz. Tek kaynak `src/lib/web-session-cookie.ts`.
- Çerez kipinde giriş: TOTP zorunlu (`assertSecondFactor`; 403 `TOTP_ENROLLMENT_REQUIRED` / 409 `TOTP_REQUIRED` /
  401 `TOTP_INVALID`) + yeni `web:access` izni (yoksa 403 `WEB_ACCESS_DENIED`). Lisans uçları çerezi tanır.
- Panel kipinde statik sunum: `index.html` ve SPA geri düşüşü `no-store`, özetli `assets/*` `immutable`, CSP
  `frame-ancestors 'none'` + `X-Frame-Options: DENY`; `/api/*` HTML'e düşmez.
- Web istemcisi (aynı imajda derlenir): token saklamaz, açılışta `/api/auth/me` ile oturumu yoklar, masaüstüne özgü
  eylemleri soluk gösterir, PDF'i tarayıcı yazdırmasına bırakır.
- Bekçiler: `test_web_cerez_oturumu`, `test_web_panel_sunumu`, `test_docker_hijyeni` §7o, `test_korumali_imaj`.

**Paket dışı (bilgi):** 2.15.7'den bu yana `patron/` (tek kimlik, tesis-db rol hizalama) ve `satici/` commit'leri
main'e indi; backend paketine girmez.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR — yalnız ekleme: bir izin kodu (`web:access`, katalogda; migration yok), bir ekran kataloğu
  satırı, giriş cevabında isteğe bağlı `cookieSession`. Çerez yolu yalnız panel kipinde ve `clientType:"web"`
  girişte devreye girer.
- **Eski istemci ne yapar:** masaüstü panel (1.6.6 ve öncesi) ve tablet `Authorization: Bearer` gönderir; davranışları
  değişmez. Panel kipi kapalıyken (varsayılan) web girişi bugünkü gibi JSON token alır — demo imajı geriye uyumlu.
  Web istemcisi sunucuyla aynı imajdan geldiği için sürüm kayması yok.
- **`minVersion` dokunuldu mu:** hayır.

## 4. Migration

- **Var mı:** HAYIR.
- **Toplam migration:** 392 (2.15.7 ile aynı). Farklı sayı = yanlış paket ya da yanlış veritabanı → DUR.
  (Paketleme anında yeniden sayılır.)
- **Prova:** gerekmez (şema değişmedi).
- **Geri alınabilir mi:** evet — şema değişmediği için 2.15.7 imajı aynı veritabanında açılır.

## 5. Kurulum notu

- **Beklenen kesinti:** güncellemede sunucu kısa süre kapalı kalır (yedek; migration yok); süre kurulumda ölçülür.
- **Sıra:** sunucu önce; masaüstü panel/tablet güncellemesi gerekmez.
- **Bu sürüme özel:** tarayıcı paneli kapalı gelir. Açmak ayrı ve bilinçli bir adımdır: (1) bir kullanıcıya panelden
  `web:access` izni ve iki adımlı doğrulama, (2) kurulumun `yapilandirma/.env` dosyasına `WEB_DIST_DIR=/app/dist-web`,
  (3) `docker compose up -d`. Kurulum yalnız HTTPS'li adresle (bulut) yapılır — çerez `Secure`'dür.
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Güncelleme programıyla yapılan güncellemede yeni sürüm açılmazsa önceki imaja kendiliğinden dönülür. Şema
değişmediğinden 2.15.7 imajı sorunsuz açılır. 2.15.7 imajında `/app/dist-web` yoktur: geri dönüşte
`WEB_DIST_DIR` satırı boşaltılır (tarayıcı paneli kapanır; masaüstü panel ve tablet etkilenmez).

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.15.8, sunucu ve veritabanı ayakta.
- Veritabanı: 392 migration bitmiş, sorunlu migration yok.
- İmajda `/app/dist-web/index.html` var (boyutu yazılır); `WEB_DIST_DIR` boşken kök adres panel sunmaz (bugünkü gibi).
- `/api/admin/health` `sistemHesabiMuhru` ve `auditProtection` 2.15.7'deki değerleriyle aynı.
- Masaüstü panelle giriş ve tabletle PIN girişi bugünkü gibi çalışıyor.
- (Panel açıldıysa) tarayıcıda: giriş + kod, liste, Excel, yazdır → PDF, soluk etiket düğmesi, çıkış; DevTools'ta
  `tekserp_oturum` çerezi `HttpOnly`/`Secure`/`SameSite=Strict`, localStorage'da token yok; `web:access`'siz
  kullanıcı 403 `WEB_ACCESS_DENIED` alıyor.
