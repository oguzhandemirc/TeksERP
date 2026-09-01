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
WEB_DIST_DIR="C:\Etkili-Yazilim\app\Electron\dist-web"
```

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

---

## Kabul ölçümü — kurulum sonrası ZORUNLU

Bu adımlar atlanırsa yanlış yapılandırma **sessiz** kalır.

| # | Ölçüm | Beklenen |
|---|---|---|
| 1 | LAN'dan `http://<lan-ip>:4000/api/auth/login-methods` | **200** |
| 2 | LAN yanıtında `Strict-Transport-Security` başlığı | **YOK** |
| 3 | Tabletten PIN ile giriş | **çalışır** |
| 4 | Dışarıdan `https://<musteri>-erp.etkiliyazilim.com` | Access e-posta OTP ekranı |
| 5 | Access'i geçtikten sonra parola + **TOTP** | giriş başarılı |
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
