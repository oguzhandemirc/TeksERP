# Backend `2.15.15`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk hedef yalnız `test` grubu (üyesi tek kurulum: bulut deneme sunucusu;
fabrika yok); öncü/genel gruba çıkış ayrı karar (terfi etiketi).
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** `test` grubunda yayındaki sürüm 2.15.14 (etiket `backend-v2.15.14` → `9833fdc6c`). Güncellenecek
her kurulumda sahadaki sürüm kurulumdan önce sağlık bilgisinden okunur.

Sürüm numarası: yama hanesi (otomatik, `scripts/backend-surum.mjs`).

## 1. Özet

İnternete açık (barındırılan) kurulum için güvenlik sertleştirmesi (VDS denetimi S1–S7) ve giriş kolaylıkları
(web 2FA tercihi, "bu cihazı hatırla", son kullanıcıyı hatırla), Gülkesim/Seyitoğlu prova küçükleri. Fabrika (LAN)
kurulumunda güvenlik maddelerinin davranışı bayt-aynıdır; yeni ayarların hepsi bugünkü davranışla doğar.

## 2. Ne değişti

Ölçüm: `backend-v2.15.14` (`9833fdc6c`) → `origin/main` @ `66db964ec`, ilk ebeveyn hattında 16 commit (#414–#429).
Alt proje farkı: `Teks-Erp/src` 75 dosya · `Electron/src` 95 dosya (web paneli imajda) · `mobil/src` 19 dosya
(bu turda tablet yayını YOK) · `patron/`, `satici/`, `okuma/` değişmedi · `deploy/bulut` 7 dosya (imaja girmez).

**Web girişinde iki adımlı doğrulama iki katman** — #418, #426, #429. Fabrika politikası `auth.webTotpPolicy`
(`REQUIRED` varsayılan | `USER_CHOICE`, yalnız süperadmin yazar) + kullanıcı tercihi `User.webTotpOptOut`
(parola + kodla kendi ucundan). #426: barındırılan sınıfta aynı kural masaüstü (Bearer) ve kanıtsız mobil parola
girişine de uygulanır; onaylı + HMAC kanıtlı saha cihazı ikinci faktör sayılır; süperadmin her kanalda kod verir.
TOTP'si olmayan hesapta kod gerekiyorsa 403 `TOTP_ENROLLMENT_REQUIRED`. #429: Seyitoğlu ayar paketi
`USER_CHOICE` yazar. LAN'da kural yok.

**"Bu cihazı N gün hatırla" + yeni cihaz bildirimi** — #423, #426. Ayar `auth.trustedDeviceDays` (0–90, varsayılan
0 = kapalı); web'de httpOnly çerez, masaüstünde gövde belirteci (safeStorage); DB'de yalnız HMAC özeti. Yeni tablo
`trusted_devices`, oturuma `newDevice`. Bildirim `kimlik.yeni-cihaz-girisi`. Uçlar `/api/auth/trusted-devices*`,
`/api/admin/users/:id/trusted-devices*`.

**Girişte son kullanıcıyı hatırla** — #425. Ayar `auth.rememberLastUser` (varsayılan kapalı); yalnız panel, yalnız
kullanıcı adı + görünen ad cihazda tutulur. Migration yok.

**Giriş koruması** — #421 (parola semaforu + worker, IPv6 /64, sabit süre; kuyruk dolunca 503 `SERVER_BUSY`),
#427 (internete açık kurulumda cihaz/kullanıcı/IP kovası ayrımı, `RATE_LIMIT_FACTORY_IPS`, kullanıcı adı başına
yumuşak bekleme 429 `LOGIN_THROTTLED` + `Retry-After`, yaygın parola reddi yeni parolada, yönteme göre kilit
kovası, Kullanıcılar → "Giriş kilitleri" ile yönetici kaldırması; bildirim `kimlik.supheli-giris-denemesi`).

**Cihaz/oturum ve bilgi yüzeyi** — #428. Bir kaynaktan bekleyen cihaz duyurusu tavanı (6.'sı 429), barındırılanda
`/api/discovery/identity` nötr ad/boş sürüm, `login-methods` lisans bayraklarını yalnız onaylı cihaza verir,
etiket test ucu yalnız RFC 1918 + 9100–9103, barındırılanda `nativeSendEnabled` kilitli; **barındırılanda bilinen ya
da zayıf `JWT_SECRET` açılışı DURDURUR** (D7; bkz. §5).

**Şifreli makine dışı yedek** — #422. Barındırılanda şifresiz yedek KRİTİK sayılır ve zile düşer; düz döküm
makine dışına gitmez; `/api/admin/backups` yanıtında `encryption.hostedRequired`. Makine dışı ÇEKME betikleri
`deploy/bulut/yedek-cek/` (imaja girmez).

**Bulut kenarı** — #419 (yalnız deploy/compose; backend kodu yok). Korumalı compose'lar `HTTPS_ENABLED` /
`CORS_ORIGINS` / `RATE_LIMIT_FACTORY_IPS` / `RATE_LIMIT_FACTORY_MULTIPLIER`i boş varsayılanla geçirir; bulut örneği
`HTTPS_ENABLED=true`, giriş 60 / yazma 600, kenar `muaf` bağlaması. Nginx şablonu + barındırma kontrol betiği.

**Tablet kuyruğu** — #420 (tablet kodu; bu turda yayınlanmaz) + ayar `auth.mobileOfflineLockDefer` (varsayılan
kapalı): bağlantı yokken tablet kilidi ertelenir.

**Küçükler** — #414 (ayar sekmesi açılışta "kaydedilmemiş" görünmüyor), #415 (mal kabulde sarf kalemi satırı; yanıtta
`totals.consumableLineCount`), #416 (taslak gelen belge silme düğmesi, Sarf Stoğu tarih/miktar biçimi, tablet brode
adet uyarısı), #417 (iki kartta da cari hesap varken müşteri birleştirme 409 yerine 200 + `followUps`; cari hesap
mezar kartta kalır, cari birleştirmesi ayrı ekrandan), #424 (kapalı modül menü/karoda yalnız süperadmine soluk,
diğerine gizli; yalnız panel).

**Güncelleyici ve hizmet konağı** — `tekserp-guncelleyici` 0.2.9, `tekserp-hizmet` 0.2.1 DEĞİŞMEDİ
(`scripts/test_guncelleyici_surum.mjs` yeşil, taban `backend-v2.15.14`). `deploy/pg`, `deploy/node-surumu.json`,
`deploy/kanallar.json`, `deploy/dagitim.json` değişmedi; `Teks-Erp/docker/korumali` compose'ları yalnız ek ortam
değişkeni (boş varsayılan).

`dist-web` (web paneli) imaja girer; masaüstü panel paketi bu turda YOK (yayındaki masaüstü panel 1.6.6).

## 3. Sözleşme

- **Kırıldı mı:** HAYIR. Uç kaldırma yok; var olan yanıtlara yalnız ek alan (`trustDeviceDays`,
  `trustedDeviceToken`, `releasable`, `followUps`, `hostedRequired`, `consumableLineCount`, `announcedFrom`); yeni
  hata kodları (`SERVER_BUSY` 503, `LOGIN_THROTTLED` 429, `TOTP_ENROLLMENT_REQUIRED` 403 Bearer'da) yalnız yük
  altında ya da barındırılan sınıfta doğar. LAN kurulumunda giriş cevapları bayt-aynı (`test_barindirma_ikinci_faktor`
  §1 dört kanalda ölçer).
- **Eski istemci ne yapar:**
  - Masaüstü panel 1.6.6, **barındırılan** sunucuda: politika `REQUIRED` iken TOTP'li hesap her girişte kod verir
    (409 `TOTP_REQUIRED` adımı eski panelde var; "bu cihazı hatırla" belirtecini saklamaz); TOTP'siz hesap 403
    kurulum ekranını görür. `USER_CHOICE` + kullanıcı tercihi kapalıysa kodsuz girer. LAN'da değişiklik yok.
    Yeni ayarları ve "Giriş kilitleri" düğmesini görmez; kilitli ayarı kaydederse 409 iletisini gösterir.
  - Tablet 1.4.3: onaylı + kanıtlı cihaz etkilenmez. Barındırılanda kanıtsız/onaysız parola girişi artık kod
    ister (1.4.0+ kodu sorar). Giriş 429/503'ü genel "çok fazla deneme / yoğun" iletisiyle gösterir; kayıt kaybı
    yok (yalnız giriş uçları). Yeni `mobileOfflineLockDefer` ayarını tanımaz.
  - Patron bulutu, satıcı: etkilenmez (eşlenen yeni projeksiyon yok).
- **`minVersion` dokunuldu mu:** hayır — `Teks-Erp/src/config/client-version-policy.ts` `backend-v2.15.14`e göre
  farksız; öneri: değişmesin.
- **Yeni ayarlar:** 4 ayar anahtarı (`auth.webTotpPolicy`, `auth.trustedDeviceDays`, `auth.rememberLastUser`,
  `auth.mobileOfflineLockDefer`); hepsi bugünkü davranışla doğar. Yeni izin kodu yok.

## 4. Migration

- **Var mı:** evet — `backend-v2.15.14`ten bu yana **2** yeni göç (2026-11-01 ölçüldü, `origin/main` @ `66db964ec`):
  `20261101133402_kullanici_web_totp_tercihi` (`users.webTotpOptOut BOOLEAN NOT NULL DEFAULT false` + CHECK
  `users_web_totp_opt_out_not_system_check`), `20261101144644_guvenilir_cihaz` (`sessions.newDevice BOOLEAN` boş
  kolon + yeni tablo `trusted_devices`, 2 FK, 2 indeks, 4 CHECK).
- İçerik: hepsi ADDITIVE; toplu UPDATE, DROP, SET NOT NULL (varsayılansız), tip değişimi YOK.
- **Toplam migration:** 459 (2.15.14'te 457). Paketleme anında yeniden sayılır.
- **Döküm provası YAPILDI (2026-11-01):** 2.15.14 provasının DB'si `tekserp_prova21514_test` (deneme yedeği
  `tekserp_pre-demo-iki-fabrika_20261101T084501Z.dump`, 457 göç düzeyinde, 15.476 top) üstünde `prisma migrate
  deploy` 2 göç, çıkış 0, duvar ~1 sn; toplam 459, yarım/geri alınmış 0. `migrate diff` farkı yalnız iki beyanlı
  DEFERRABLE FK (`rolls_/swatches_sackId_shipmentId_consistency_fkey`, önceki provalarla aynı).
- **Geri alınabilir mi:** göç geri alınmaz; eklenen tablo/kolonları eski imaj okumaz (bkz. §6).

## 5. Kurulum notu

- **Beklenen kesinti:** güncelleyici yedek + 2 göç + yeniden başlatma; tablo yeniden yazılmaz.
- **Sıra:** backend tek başına güvenli (bkz. §3). Patron bulutu/satıcı güncellemesi gerekmez.
- **Bu sürüme özel (deneme = barındırılan sınıf):**
  - **Kurmadan ÖNCE** sağlık bilgisinde `jwtSecret.status` `OK` olmalı (`/api/admin/health`, 2.15.14'te de var).
    `BILINEN`/`ZAYIF` ise 2.15.15 barındırılanda AÇILMAZ ve güncelleyici geri döner — önce sır döndürülür.
  - Kurulumdan sonra panel/masaüstü girişinde politika `REQUIRED` (varsayılan): TOTP'siz kullanıcılar kod kurulumu
    ekranını görür. Kullanıcı kararı "herkes kendi seçer" ise süperadmin Sistem → Şirket & Güvenlik → İnternetten
    Giriş'te `USER_CHOICE` seçer (Seyitoğlu paketi bunu taze kurulumda yazar; deneme DB'si paketi #429'dan önce aldı).
  - Play test tabletleri: onaylı ve kanıtlı tablet etkilenmez; onaysız cihazdan parola girişi kod ister.
  - Bulut örneği compose'u güncellenirse backend HSTS basar (`HTTPS_ENABLED=true`, Cloudflare TLS arkasında).
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Davranış geri alma: açılan ayar panelden KAPATILIR (veri silinmez). Sürüm geri alma: güncelleyiciyle yapılan
güncellemede yeni sürüm açılmazsa önceki imaja ve güncelleme öncesi yedeğe kendiliğinden dönülür. Kurulum başarılı
olduktan sonra geri dönmek gerekirse önceki imaj aynı veritabanıyla açılabilir (`trusted_devices` ve iki yeni kolon
okunmaz) — yalnız kullanıcı onayıyla. Grupta geri inme yok; düzeltme ileri sürümle. Etiket `backend-v2.15.15`
silinmez.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.15.15, sunucu ve veritabanı ayakta; güncelleyici durumu `BASARILI`; `jwtSecret` `OK`.
- Veritabanı: 459 migration bitmiş, sorunlu/yarım migration yok.
- Web paneli açılıyor; süperadmin girişi kod istiyor; İnternetten Giriş kartı politika + hatırlama süresini gösteriyor.
- Onaylı tablet 1.4.3 ile PIN girişi ve bir işlem bugünkü gibi.
- Konteyner günlüğünde yeni hata yok.

## Ek — operatör notu taslağı (`surum-notlari.json` biçimi; terfide onay)

Web paneli sürüm notu penceresini göstermez; kayıt masaüstü panel turunda `surum-notlari.json`a girer. Metin terfide
kullanıcı onayıyla donar.

```json
{
  "id": "2026-11-01b",
  "durum": "TASLAK — terfide kullanıcı onayı",
  "baslik": "İnternetten girişte güvenlik, cihazı ve kullanıcıyı hatırlama",
  "maddeler": [
    { "kapsam": "panel", "tip": "yeni", "metin": "İnternetten girişte iki adımlı doğrulama: fabrika zorunlu tutabilir ya da her kullanıcının kendi seçimine bırakabilir (Sistem → Şirket & Güvenlik → İnternetten Giriş). Kullanıcı tercihini Kullanıcı Tercihleri → İnternetten giriş'ten yapar." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Kod adımında \"Bu cihazı N gün hatırla\": işaretlenirse o cihazdan bu süre boyunca kod sorulmaz. Hatırlanan cihazlar Kullanıcı Tercihleri'nde listelenir ve kaldırılabilir; tanınmayan cihazdan girişte bildirim gelir." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Girişte son kullanıcıyı hatırla (ayar): giriş ekranında son giren hesap hazır gelir, yalnız parola sorulur; \"Başka hesapla giriş yap\" ile normal forma dönülür." },
    { "kapsam": "panel", "tip": "iyilestirme", "metin": "İnternetten erişilen sunucuda giriş denemeleri daha sıkı korunur; çok hatalı denemede kısa bekleme süresi çıkar. Yönetici, Kullanıcılar ekranındaki \"Giriş kilitleri\" düğmesiyle kilitleri görüp kaldırabilir." },
    { "kapsam": "panel", "tip": "iyilestirme", "metin": "İnternetten erişilen sunucuda yedekler şifreli değilse yedek durumu kırmızı görünür ve bildirim gelir." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Sarf stoğu açıksa mal kabulde \"Sarf satırı ekle\" ile kuşak, kurşun şeridi gibi sarf kalemleri girilir; top oluşmaz, miktar Sarf Stoğu'na işlenir." },
    { "kapsam": "panel", "tip": "iyilestirme", "metin": "Kapalı modüller menüde ve karolarda yalnız sistem yöneticisine soluk görünür; diğer kullanıcılar görmez." },
    { "kapsam": "panel", "tip": "duzeltme", "metin": "İki müşteri kartının ikisinde de cari hesap olsa da kartlar birleştirilebilir; cari hesapları sonra Cari Hesaplar → Birleştir'den birleştirirsiniz." },
    { "kapsam": "panel", "tip": "duzeltme", "metin": "Taslak gelen belge silinebilir; Sarf Stoğu tarih ve miktarları okunur biçimde; ayar sekmeleri açılışta \"kaydedilmemiş değişiklik\" göstermez." }
  ]
}
```
