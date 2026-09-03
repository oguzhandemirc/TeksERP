# Uzaktan erişim kurulumu — Cloudflare Tunnel + Access

> Patron modülünün taşıyıcısı. **Fabrika sunucusunda tek bir gelen port
> açılmaz**: `cloudflared` dışarı doğru bağlanır ve isteği `127.0.0.1`e bırakır.

**Kime lazım:** on-prem (fabrika) kurulumları. Bulut kurulumlarında backend
zaten internettedir — bu belgedeki hiçbir adım gerekmez, patron paneli oradan
doğrudan çalışır.

---

## Mimari — neden bu şekilde

```
Patron tarayıcısı
      │ HTTPS
      ▼
Cloudflare  ── Access (e-posta OTP) ──► Cf-Access-Jwt-Assertion enjekte edilir
      │ Tunnel (fabrika DIŞARI doğru bağlanır)
      ▼
Fabrika sunucusu — TEK Node process, İKİ dinleyici:
      ├── 0.0.0.0:4000    ← LAN (Electron paneli, tabletler)   · DEĞİŞMEZ
      └── 127.0.0.1:4001  ← yalnız cloudflared ulaşabilir      · isRemote = true
```

**Uzaklık soketten çözülür, `clientType`ten DEĞİL.** Gövdeden gelen bir alan
güvenlik sınırı olamaz: internetten gelen biri `clientType:"electron"` yazıp LAN
kurallarına (PIN girişi, TOTP muafiyeti) düşerdi. Kaynak isteğin kabul edildiği
yerel porttur ve o port yalnız `127.0.0.1`e bağlıdır → LAN'dan erişilemez,
dolayısıyla uydurulamaz. Paylaşılan sır yoktur (sızacak/rotasyona girecek bir
şey yok).

**İkinci katman Cloudflare Access JWT'si.** Uzak `/api` isteklerinde
`Cf-Access-Jwt-Assertion` başlığı RS256 + JWKS ile doğrulanır; **fail-closed**.
Bu yalnız derinlik savunması değil: Access politikası CF panelinden yanlışlıkla
kaldırılırsa kimlik duvarı sessizce düşerdi ve bunu hiçbir yerden göremezdik.
Burada uzak erişim **DURUR** — sessiz bir açık yerine gürültülü bir arıza.

---

## Kurulum

### 1) Cloudflare — tünel + Access

1. Zero Trust → Networks → Tunnels → **Create a tunnel** (adı: `<musteri>-erp`).
   Tünel ID'sini ve kimlik dosyasını (`<id>.json`) al.
2. Public hostname ekle: `<musteri>-erp.etkiliyazilim.com` → `http://127.0.0.1:4001`.
   CNAME kaydı otomatik doğar; DNS'te elle bir şey yapılmaz.
3. Zero Trust → Access → **Applications** → Self-hosted, aynı hostname.
   Policy: patron ve yetkili kişilerin **e-posta allowlist'i**.
   - **Session duration: 24 saat.** Kısa tutmak patronu her açılışta OTP'ye
     boğar; ERP oturumu zaten 8 saatte bir yeniden giriş istiyor.
   - Uygulamanın **AUD** etiketini not al (backend `.env`ine yazılacak).

> ⚠️ **Cloudflare proxy (turuncu bulut) AÇIK kalmalı** — bu kurulumun geri
> kalanıyla aynı gerekçe (`SUNUCU-ENVANTERI.md`).

### 1b) Access kullanmamayı seçerseniz (2026-09-02)

Access'i **kurmayabilirsiniz**. Sahada ölçülen gerekçe: her cihazda günde bir
e-posta kodu, bilgisayarla arası iyi olmayan bir kullanıcı için gerçek bir engel.

Bu durumda Adım 1'de **yalnız tüneli** kurun (Access application açmayın) ve
`.env`de Access alanları yerine tek satır yazın:

```ini
CF_ACCESS_ENABLED="false"
RATE_LIMIT_ENABLED="true"
```

**Ne kaybedersiniz:** ERP giriş ekranı doğrudan internete bakar. **Ne KAYBETMEZSİNİZ:**
şifre + TOTP (iki faktör) yerinde kalır, uzakta PIN/kart/cihaz/keşif uçları hâlâ
404 döner, HSTS hâlâ basılır, hız sınırı ve deneme kilidi çalışır. Access bir
kattı, tek kat değil.

⚠️ **Kapatma AÇIK BEYANLA olur.** Access alanlarını boş bırakmak duvarı kapatmaz,
**tüneli hiç açmaz**. Yazım hatası ya da unutulmuş bir satır kimlik duvarını
sessizce düşüremez. Kapalıyken açılış log'u her restart'ta uyarır — duvarsız bir
kurulum, duvarlı sanılan bir kurulumdan ayırt edilebilir olmalı.

### 2) Fabrika sunucusu — cloudflared

```powershell
# Kurulum (bir kez)
winget install --id Cloudflare.cloudflared

# Kimlik dosyası ve config'i yerleştir
mkdir C:\Etkili-Yazilim\cloudflared
# → <tünel-id>.json  ve  config.yml  (şablon: deploy/uzak-erisim/config.yml.ornek)

# SERVİS olarak kur — oturum açmadan, yeniden başlatmada kendi kalkar
cloudflared service install
Restart-Service cloudflared
Get-Service cloudflared
```

### 3) Fabrika sunucusu — backend `.env`

```ini
REMOTE_PORT="4001"
CF_ACCESS_TEAM_DOMAIN="firma.cloudflareaccess.com"
CF_ACCESS_AUD="<Access uygulamasının AUD etiketi>"
RATE_LIMIT_ENABLED="true"
WEB_DIST_DIR="C:\Etkili-Yazilim\app\dist-web"
```

> `dist-web` backend paketiyle BİRLİKTE gelir (`deploy/paketle.ps1`), yani
> `app\dist-web` altındadır ve sürümü API ile her zaman aynıdır.

Ardından `pm2 restart tekserp && pm2 save`. Boot banner'ında şu satır görünmeli:

```
  Uzaktan erişim: 127.0.0.1:4001 (cloudflared)
                  Access: firma.cloudflareaccess.com
```

Görünmüyorsa **uzaktan erişim kapalıdır** — üç değişkenden biri eksik ya da
geçersizdir (eksik yapılandırma "yarı açık" değil KAPALI demektir).

### 4) Patron kullanıcısı

1. Panel → Yetkilendirme → yeni kullanıcı, **"Patron (Uzaktan Takip)"** şablonu.
   Şablon boot uzlaştırmasıyla DB'ye gelir ama **kimseye ATANMAZ** — atama elle
   yapılır (*katalog koda, atama panele*).
2. Panel → kullanıcı → **"2FA kurulumu başlat"** → çıkan bağlantı patrona
   iletilir; patron 15 dk içinde QR'ı okutup ilk kodu girer ve **kurtarma
   kodlarını kaydeder** (bir daha gösterilmez).

> ⚠️ **Uzaktan giriş TOTP'siz kabul edilmez.** Kurulum penceresini yalnız
> `admin:users` taşıyan biri açabilir; "parola doğruysa kullanıcı kendi kursun"
> bilinçli olarak REDDEDİLDİ (parola sızmışsa saldırgan kendi telefonunu bağlar
> ve meşru sahibi kilitler — 2FA'nın koruduğu tek senaryo).

### 5) Satıcı hesabı (süperadmin) — `.env` satırları + restart

Modül anahtarlarını (Ticaret / İplik / Çoklu depo / Üretim …) **yalnız satıcı
hesabı** değiştirebilir. Hesap `.env`den doğar; `kur.ps1` mevcut `.env`i olduğu
gibi TAŞIR ama **güncellemez** → bu satırlar sunucuda **ELLE** eklenir, yoksa
hesap hiç doğmaz ve kimse fark etmez (izin kataloğu / rol şablonu vakalarının
aynı sınıfı).

```powershell
# 1) Parola hash'ini ÜRET (düz parola .env'e yazılmaz)
node -e "console.log(require('bcryptjs').hashSync(process.argv[1],10))" '<parola>'

# 2) C:\Etkili-Yazilim\app\.env dosyasına ekle (ÜÇÜ BİRLİKTE)
#    SUPERADMIN_USERNAME="bakim"
#    SUPERADMIN_PASSWORD_HASH="$2b$10$..."
#    SUPERADMIN_PIN="<6 hane>"
#    SUPERADMIN_TOTP_SECRET="<base32>"   # opsiyonel; uzaktan giriş için

pm2 restart tekserp && pm2 save
```

Boot log'unda `[superadmin] Satıcı hesabı oluşturuldu (sistem hesabı).`
görünmeli. Görünmüyorsa: değişkenlerden biri eksik/bozuktur — o durumda hata
`Sistem Kayıtları`na `JOB_FAILED:superadmin` olarak da düşer.
(Log satırı **kullanıcı adını basmaz**: aynı ad audit yüzeylerinde bilerek
gizleniyor, pm2 log'u ise fabrika sunucusunda okunabilir.)

> ⚠️ **Değerler fabrikaya VERİLMEZ**, parola yöneticisinde tutulur.
> ⚠️ **`ecosystem.config.js`'e YAZILMAZ** (git'e girer, sır taşımaz).
> ⚠️ Hesap **hiç yaratılmazsa** modül anahtarları bugünkü gibi `admin:settings`
> ile yazılmaya devam eder (emniyet supabı — kilitlenme yok). Hesap doğduğu AN
> kilit mutlaktır.
> ⚠️ **Rotasyon:** `SUPERADMIN_FORCE_SYNC=true` ile restart parola + PIN + TOTP
> sırrını `.env` değerlerine eşitler (TOTP satırı boşsa iki adımlı doğrulamayı
> TEMİZLER) ve eski oturumları düşürür — sonra bu satırı **kaldırın**.
> **`SUPERADMIN_USERNAME` DEĞİŞTİRİLMEZ** (giriş kimliğidir; sessizce
> değiştirmek satıcıyı bir sonraki girişte dışarıda bırakırdı): env'deki ad
> kayıtlıdan farklıysa boot log'una uyarı düşer ve
> `SUPERADMIN_CREDENTIALS_SYNCED` audit'i `usernameMismatch: true` taşır.
> `SUPERADMIN_PIN` başka bir kullanıcıda kullanılıyorsa rotasyon UYGULANMAZ:
> hesaba hiçbir şey yazılmaz, `JOB_FAILED:superadmin` izi doğar ve iş TEKRAR
> DENENMEZ (yapılandırma hatasıdır, geçici arıza değil).
> ⚠️ **Satırların `.env`'den kaldırılması kilidi AÇMAZ** — kilit `.env`'e değil
> DB satırına bakar (ölçüldü). Hesap durduğu sürece modül anahtarları yalnız
> satıcı hesabıyla yazılır.
> ⚠️ **Hesabı KALDIRMA** (satıcı ilişkisi biterse): `.env` satırlarını sil +
> `UPDATE users SET "isSystemAccount"=false, "isActive"=false WHERE "isSystemAccount"=true;`
> + **`pm2 restart tekserp` ŞART**. Kilit defteri TEK YÖNDE tazelenir: yokluktan
> varlığa istek anında, varlıktan yokluğa yalnız restart'ta (fail-closed) —
> restart'sız bırakılırsa modül anahtarlarını restart'a kadar HİÇ KİMSE yazamaz.
> ⚠️ **Kabul edilmiş risk (F287):** `pg_dump` / `db-copy` bu hesabın düz PIN'ini
> de taşır; yedek indirebilen personel onu okuyabilir. Karşılığı hızlı rotasyondur.

### Ayar şifresi (ikinci kapı) — opsiyonel, süperadmin yönetir

Tanımlıysa **ayar/bayrak kaydeden her istek** ikinci bir şifre sorar (açık
kalmış bir admin oturumundan ayar değişmesin). `.env`'de **DEĞİLDİR** — satıcı
hesabıyla girip tanımlanır:

```
PUT    /api/admin/settings-password   { "password": "<en az 8 karakter>" }   # tanımla / değiştir
DELETE /api/admin/settings-password                                          # kaldır (kapı uyur)
GET    /api/admin/settings-password                                          # tanımlı mı
```

> ⚠️ Üç uç da **yalnız satıcı hesabına** açıktır; fabrika yöneticisi için
> **404** döner (403 ucun varlığını doğrulardı).
> ⚠️ **Tanımlı değilse hiçbir istek şifre istemez** — mevcut kurulumlarda sıfır fark.
> ⚠️ Kapsam: `PATCH /api/feature-flags` · `PUT /api/feature-flags/documents-logo` ·
> `PUT /api/admin/settings/:key`. **Süperadmin muaftır** (kapıyı o kurar) ve
> yalnız belge tasarımı anahtarı taşıyan gövde (Belge Şablonları / Refakat Kartı)
> da muaftır — o ekranın personeli `admin:settings` taşımaz.
> ⚠️ **Unutulursa** yalnız satıcı yeniler/kaldırır; fabrikanın kendi başına
> sıfırlayacağı bir yol BİLİNÇLİ OLARAK yoktur (olsaydı kapı hiçbir şey korumazdı).
> ⚠️ Hatalı deneme sayısı **giriş kilidiyle AYNI şaltere** bağlıdır
> (`auth.pinLockoutEnabled`); eşik aşılınca `429` + bekleme süresi döner.
> ⚠️ Şifre `system_settings` içinde **bcrypt hash** olarak durur; ham ayar
> ucundan ne yazılabilir ne de listelenir (`GET /api/admin/settings` yükünde
> `security.` ile başlayan satır DÖNMEZ).

---

## Kabul ölçümü — kurulum sonrası ZORUNLU

Bu adımlar atlanırsa yanlış yapılandırma **sessiz** kalır.

| # | Ölçüm | Beklenen |
|---|---|---|
| 1 | LAN'dan `http://<lan-ip>:4000/api/auth/login-methods` | **200** |
| 2 | LAN yanıtında `Strict-Transport-Security` başlığı | **YOK** |
| 3 | Tabletten PIN ile giriş | **çalışır** |
| 4 | Dışarıdan `https://<musteri>-erp.etkiliyazilim.com` | Access kuruluysa e-posta OTP ekranı; kurulu değilse doğrudan ERP girişi |
| 5 | Parola + **TOTP** | giriş başarılı — ⚠️ kodsuz deneme `TOTP_REQUIRED` ile REDDEDİLMELİ |
| 6 | Dışarıdan `…/api/auth/login-quick-pin` | **404** |
| 7 | Dışarıdan `…/api/devices/status` | **404** |
| 8 | Uzak yanıtta `Strict-Transport-Security` | **VAR** |

**En kritik yanlış yapılandırma:** `config.yml`de port yanlış yazılırsa (örn.
4000) tünel LAN dinleyicisine bağlanır ve **her uzak istek "LAN" sayılır** —
PIN girişi açılır, TOTP zorunluluğu düşer, HSTS basılmaz. Hiçbir hata vermez.
Ölçüm #6 tam olarak bunu yakalar: 404 yerine 401/403 görüyorsan port yanlıştır.

**Access'in gerçekten devrede olduğunu doğrula (yılda bir):** CF panelinden
politikayı geçici kaldır → uzak `/api` istekleri **403** dönmeli. Dönmüyorsa
`CF_ACCESS_AUD` yanlıştır ve ikinci katman fiilen yoktur.

---

## Bilinen sınırlar

- **Fabrika sunucusu ya da interneti kapalıyken patron veri göremez** —
  Cloudflare "Error 1033" sayfası çıkar. Bilinçli: tünel yaklaşımının kabul
  edilen bedeli. Kalıcı çözüm bir okuma replikasıdır ve AYRI bir iştir
  (WireGuard taşıyıcısı ister; CF Tunnel PostgreSQL replikasyonunu taşımaz).
- **Kimlik zinciri üç adımlı** (Access OTP → parola → TOTP). Pratikte Access 24
  saat, ERP 8 saat sürer; rahatlama Access session süresinden gelir, katman
  azaltmaktan değil.
- **Mobil uygulama (Faz 2) Access ile sürtüşecek** — Access tarayıcı odaklıdır;
  native istemci servis token'ı ister ve o token APK'ya gömülü paylaşılan bir
  sır demektir. O gün ya `/api/*` Access dışına alınıp yalnız SPA gatelenir, ya
  mobil için ayrı bir yol kurulur. **Açık madde.**

---

## İlgili

- `deploy/uzak-erisim/` — cloudflared şablonu
- `deploy/.env.production.example` §2b — ortam değişkenleri
- `docs/ops/SUNUCU-ENVANTERI.md` — makine/port envanteri
- Bekçiler: `Teks-Erp/scripts/test_remote_access_guard.ts` · `test_totp.ts`
