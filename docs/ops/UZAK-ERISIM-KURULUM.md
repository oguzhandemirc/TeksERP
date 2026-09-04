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

### 1c) Hata sayfası — "Error 1033" yerine kendi sayfamız (önerilir)

Fabrika sunucusu ya da fabrikanın interneti kapalıyken kenar, ziyaretçiye
**"Error 1033 — Argo Tunnel error"** basar. Patron için bu cümle hiçbir şey
ifade etmez ve her seferinde bir telefon üretir.

⚠️ **Bu bir tünel ayarıyla ÇÖZÜLEMEZ.** `config.yml` yalnız `cloudflared`
koşarken okunur; sorunun tanımı zaten "cloudflared koşmuyor"dur. Sayfayı basacak
tek katman, fabrikadan bağımsız çalışan Cloudflare kenarıdır.

1. Zero Trust'ta değil, **Cloudflare ana panelinde**: Workers & Pages →
   **Create Worker** (ad: `<musteri>-erp-hata`).
2. İçeriği `deploy/uzak-erisim/cf-worker-hata-sayfasi.js` ile **değiştir** → Deploy.
3. Worker → Settings → **Domains & Routes** → Add route:
   `<musteri>-erp.etkiliyazilim.com/*` (zone: `etkiliyazilim.com`).

Doğrulama: fabrika sunucusunda `Stop-Service cloudflared` → adresi aç →
Türkçe **"Fabrika sunucusuna şu anda ulaşılamıyor"** sayfası çıkmalı →
`Start-Service cloudflared` → sayfa kendiliğinden geri gelmeli.

> ⚠️ **Access'i ETKİLEMEZ** — Access, isteği Worker'a vermeden ÖNCE koşar; kimlik
> duvarı yerinde kalır.
> ⚠️ `/api/*` isteklerine HTML DEĞİL **JSON** döner (503 +
> `details.code=ORIGIN_UNREACHABLE`). HTML dönseydi panel JSON ayrıştırma
> hatasına düşer ve kullanıcı yine "beklenmeyen hata" görürdü.
> ⚠️ Sayfa `no-store` ile döner. Aksi hâlde fabrika 2 dakika sonra açıldığında
> ziyaretçi hâlâ "kapalı" sayfasını görürdü — `always` başlığının 404'ü bir hafta
> önbelleklediği vakanın (Electron yayın sunucusu) birebir sınıfı.
> **Alternatif:** zone'un plânı **Custom Error Pages**'i (5xx/1xxx) destekliyorsa
> Worker yerine o da kullanılabilir; Worker plândan bağımsız çalıştığı için
> önerilen yol budur.

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

### 5) Satıcı hesabı (süperadmin) — `npm run superadmin:kur`

Modül anahtarlarını (Ticaret / İplik / Çoklu depo / Üretim …) **yalnız satıcı
hesabı** değiştirebilir. Hesap **sunucuda elle koşulan bir script'le** doğar.

> ⚠️ **2026-09-03 — `.env` YOLU KALDIRILDI.** Eski `SUPERADMIN_USERNAME` /
> `SUPERADMIN_PASSWORD_HASH` / `SUPERADMIN_PIN` / `SUPERADMIN_TOTP_SECRET` /
> `SUPERADMIN_FORCE_SYNC` satırları artık **hiçbir işe yaramaz**; boot job'ı
> onları OKUMAZ. Varsa **silin** — sırrı diskte kalıcılaştırmaktan başka bir şey
> yapmazlar; boot log'u da kalanları görürse uyarır (`[superadmin] ⚠️ Ortamda
> ARTIK KULLANILMAYAN … satır var` — yalnız **anahtar adı** basılır, değer asla). Gerekçe: iki doğuş yolu = iki sır yüzeyi; `.env` yolunda hash + PIN
> + TOTP sırrı yedeğe, `kur.ps1`in taşıdığı dosyaya ve ekran paylaşımına
> giriyordu, üstelik "FORCE_SYNC satırını sonra kaldırın" gibi unutulabilir bir
> adım gerektiriyordu.

```powershell
cd C:\Etkili-Yazilim\app
npm run superadmin:kur                # kurulum (idempotent — hesap varsa DOKUNMAZ)
npm run superadmin:kur -- --rotate    # parola + PIN + TOTP yenile
```

> ⚠️ **GERÇEK TERMİNAL ŞART — uzaktan koşuyorsan `-t` VER.** Script parolayı
> maskeleyerek sorar; girdi boru/dosya olduğunda hiçbir soru cevaplanamaz ve
> **süreç hata vermeden, zaman aşımına düşmeden bekler**. Doğrusu:
> `ssh -t sunucu 'cd C:\Etkili-Yazilim\app && npm run superadmin:kur'`,
> `docker exec -it <konteyner> npm run superadmin:kur` ya da doğrudan sunucu
> konsolu. `-t` unutulursa script artık **gürültülü hata verip çıkar**
> ("etkileşimli terminal ister") — eskiden sessizce donuyordu, yani kurulum
> tamamlanmamış olur ve kimse fark etmezdi. Kurulum betiğinden / pm2 / CI
> içinden çağırmayın.

Script sırayla sorar: **kullanıcı adı** (öneri `bakim` — nötr seçin, satıcıyı
çağrıştırmasın) · **parola** (iki kez, ekrana basılmaz) · **6 haneli hızlı giriş
PIN'i** (boş bırakılırsa üretilir). İki adımlı doğrulama sırrını üretir ve
`otpauth://` URI'siyle birlikte **terminalde QR olarak BİR KEZ** basar —
authenticator uygulamasıyla o an okutun.

> ⚠️ **Çıktı bir daha gösterilmez.** PIN + TOTP sırrı parola yöneticisinde
> tutulur, **fabrikaya VERİLMEZ**. Hiçbir dosyaya/log'a/audit yüküne yazılmaz;
> audit'e yalnız `SUPERADMIN_PROVISIONED` / `SUPERADMIN_ROTATED` izi düşer
> (sırsız, gerçek kullanıcı adı da yok).
> ⚠️ **Var olan bir kullanıcı YÜKSELTİLEMEZ.** Mevcut bir kullanıcı adı
> verilirse script hata verir: gizli hesap görünür bir hesaptan türetilemez —
> o kullanıcının geçmişi, oturumları ve audit satırları maskeli hesaba TAŞINAMAZ
> (audit maskesi satır düzeyindedir; taşınsaydı fabrikanın kendi kayıtları bir
> anda "Sistem Bakımı" adına geçerdi). Panelde düğme, API'de uç YOKTUR.
> ⚠️ **İkinci koşum hiçbir şeye dokunmaz** ("zaten kurulu", çıkış 0) — yoksa
> "bir daha çalıştırayım" refleksi satıcının elindeki parolayı öldürürdü.
> ⚠️ **RESTART GEREKMEZ.** Kilit defteri, hesabın olmadığı kurulumda her istekte
> tembel doğrulama yapar: hesap doğduğu AN kilit yürürlüğe girer.
> ⚠️ Hesap **hiç kurulmazsa** modül anahtarları bugünkü gibi `admin:settings`
> ile yazılmaya devam eder (emniyet supabı — kilitlenme yok). Boot log'unda
> `[superadmin] Satıcı hesabı yok — emniyet supabı devrede` satırı bunu söyler.

**ROTASYON** (`--rotate`): parola + PIN + TOTP sırrı **yenilenir** ve
`tokenVersion` artar → **açık oturumların hepsi anında düşer**. Kalıcı bir
"rotasyon bayrağı" YOKTUR; kaldırılması unutulacak bir satır bırakmaz.

> ⚠️ **KULLANICI ADI DEĞİŞMEZ** (giriş kimliğidir; sessizce değiştirmek satıcıyı
> bir sonraki girişte dışarıda bırakırdı). Ad gerçekten değişecekse hesap elle
> güncellenir.
> ⚠️ **PIN başka bir kullanıcıdaysa** rotasyon UYGULANMAZ — script hata verir ve
> hesaba hiçbir şey yazılmaz (`quickPin` sistem genelinde benzersiz).
> ⚠️ **Kurulu hesap yokken `--rotate`** hata verir; hesap YARATMAZ.

> ⚠️ **Hesabı KALDIRMA** (satıcı ilişkisi biterse):
> `UPDATE users SET "isSystemAccount"=false, "isActive"=false WHERE "isSystemAccount"=true;`
> + **`pm2 restart tekserp` ŞART**. Kilit defteri TEK YÖNDE tazelenir: yokluktan
> varlığa istek anında, varlıktan yokluğa yalnız restart'ta (fail-closed) —
> restart'sız bırakılırsa modül anahtarlarını restart'a kadar HİÇ KİMSE yazamaz.
> ⚠️ **Kabul edilmiş risk (F287):** `pg_dump` / `db-copy` bu hesabın düz PIN'ini
> de taşır; yedek indirebilen personel onu okuyabilir. Karşılığı hızlı rotasyondur
> (`--rotate`).

### Ayar şifresi (ikinci kapı) — opsiyonel, süperadmin yönetir

Tanımlıysa **ayar/bayrak kaydeden her istek** ikinci bir şifre sorar (açık
kalmış bir admin oturumundan ayar değişmesin). `.env`'de **DEĞİLDİR** — satıcı
hesabıyla girip tanımlanır:

```
PUT    /api/admin/settings-password   { "password": "<8-72 karakter, boşluksuz ASCII>" }  # tanımla / değiştir
DELETE /api/admin/settings-password                                          # kaldır (kapı uyur)
GET    /api/admin/settings-password                                          # tanımlı mı
```

> ⚠️ Üç uç da **yalnız satıcı hesabına** açıktır; fabrika yöneticisi için
> **404** döner (403 ucun varlığını doğrulardı).
> ⚠️ **Tanımlı değilse hiçbir istek şifre istemez** — mevcut kurulumlarda sıfır fark.
> ⚠️ **ŞİFRE YALNIZ BOŞLUKSUZ ASCII OLABİLİR (8–72 karakter).** Türkçe harf
> (ş/ğ/ü/ö/ç/ı) ve boşluk **reddedilir** — sebep teknik ve serttir: şifre
> `X-Settings-Password` başlığıyla taşınır, HTTP başlığı bu karakterleri
> taşıyamaz. Kabul edilseydi tanımlama 200 dönerdi ama **hiçbir istemci o
> şifreyi iletemezdi** ve fabrika, rotasyona kadar bütün ayar/bayrak
> ekranlarından kilitli kalırdı. Üst sınır 72'dir çünkü bcrypt yalnız ilk 72
> baytı karıştırır (daha uzunu sessizce kırpılırdı).
> ⚠️ Kapsam **beş yazma yüzeyi**: `PATCH /api/feature-flags` ·
> `PUT /api/feature-flags/documents-logo` · `PUT /api/admin/settings/:key` ·
> `PATCH /api/admin/backups/offsite` · `POST /api/admin/backups/offsite/authorize`.
> Son ikisi "yedek" ekranında yaşıyor ama `system_settings`e yazar ve
> **yedeklerin gideceği yeri** belirler — kapsamın yüklemi ekran değil, yazma.
> **Süperadmin muaftır** (kapıyı o kurar) ve yalnız belge tasarımı anahtarı
> taşıyan gövde (Belge Şablonları / Refakat Kartı) da muaftır — o ekranın
> personeli `admin:settings` taşımaz.
> ⚠️ **Unutulursa** yalnız satıcı yeniler/kaldırır; fabrikanın kendi başına
> sıfırlayacağı bir yol BİLİNÇLİ OLARAK yoktur (olsaydı kapı hiçbir şey korumazdı).
> ⚠️ Hatalı deneme sayısı **giriş kilidiyle AYNI şaltere** bağlıdır
> (`auth.pinLockoutEnabled`) ama **AYRI SAYAÇ** kullanır: ayar şifresini yanlış
> girmek kimsenin oturum açmasını engellemez, tersi de geçerlidir. Eşik aşılınca
> `429` + `Retry-After` başlığı + bekleme süresi döner; denetim kaydı (`SETTINGS_PASSWORD_LOCKED`)
> **kilidin kurulduğu anda bir kez** yazılır, her 429'da değil.
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
| 9 | Uzakta menü (☰) yalnız **Operasyonlar + Raporlar** taşır | Tanımlar/Sistem/Yetkilendirme YOK |

> ⚠️ **#6 ve #7 NASIL ÖLÇÜLÜR — `curl` ile ölçme (2026-09-04'te düzeltildi).**
> Access AÇIKKEN kimliksiz bir istek bizim sunucumuza HİÇ ULAŞMAZ: Cloudflare
> kendi giriş sayfasına **302** ile yönlendirir. Yani ham `curl` 404 yerine 302
> görür ve ölçüm "başarısız" sanılır — oysa hiçbir şey ölçülmemiştir.
> **Doğru yöntem:** Access'ten geçip panele girdikten SONRA aynı tarayıcıda F12 →
> Console → `fetch('/api/auth/login-quick-pin',{method:'POST'}).then(r=>r.status)`
> (beklenen `404`) ve `fetch('/api/devices/status').then(r=>r.status)` (`404`).
> Access KAPALI kurulumda (`CF_ACCESS_ENABLED=false`) düz `curl` de yeterlidir.

**En kritik yanlış yapılandırma:** `config.yml`de port yanlış yazılırsa (örn.
4000) tünel LAN dinleyicisine bağlanır ve **her uzak istek "LAN" sayılır** —
PIN girişi açılır, TOTP zorunluluğu düşer, HSTS basılmaz. Hiçbir hata vermez.
Ölçüm #6 tam olarak bunu yakalar: 404 yerine 401/403 görüyorsan port yanlıştır.

**Access'in gerçekten devrede olduğunu doğrula (yılda bir):** CF panelinden
politikayı geçici kaldır → uzak `/api` istekleri **403** dönmeli. Dönmüyorsa
`CF_ACCESS_AUD` yanlıştır ve ikinci katman fiilen yoktur.

---

## Uzaktan ne GÖRÜNÜR — özet görünümü (2026-09-04)

Uzaktaki panel, LAN'daki panelin **aynı derlemesidir** (`dist-web`) — ikinci bir
uygulama yoktur (ikizlemek "iki kopya, biri bayat" sınıfını doğururdu). Fark
KABUKTADIR: `#/boss` **özet görünümünü** açar ve orada sol üstteki **☰** menüsü
yalnız **Operasyonlar** ve **Raporlar** yüzeylerini çizer. Tanımlar, Sistem,
Yetkilendirme, Ön Muhasebe ve kişisel Ayarlar menüde YOKTUR; hash ile doğrudan
gidilirse *"Bu ekran özet görünümünde yok"* sayfası çıkar (boş ekran değil).

- ⚠️ **Bu bir GÖRÜNÜRLÜK kararıdır, izin kapısı DEĞİL.** Backend kapıları (izin,
  modül anahtarı, uzak denylist) aynen yerinde. "Menüde yok" ile "yetkisi yok"
  ayrı cümlelerdir — karıştırılırsa özet görünümü bir güvenlik yüzeyi sanılır ve
  gerçek kapılar gevşetilir. Yüzeyi gerçekten kapatmak isteyen kullanıcıya o
  izni VERMEZ.
- Liste TEK KAYNAKTAN türetilir: `Electron/src/lib/boss-menu.ts`. Menü ile kapı
  aynı yüklemden beslenir; yarın eklenen bir operasyon karosu burada
  kendiliğinden belirir. Bekçi: `Electron/src/lib/boss-menu.test.ts`.
- Tam yetkili bir kullanıcı özet görünümünde de fazlalık yüzey görmez; tam panele
  geçmek için başlıktaki düğmeyi kullanır (`#/` — kabuk değişir).

## Bilinen sınırlar

- **Fabrika sunucusu ya da interneti kapalıyken patron veri göremez.** Bilinçli:
  tünel yaklaşımının kabul edilen bedeli. **Ama artık "Error 1033" görmez** —
  Adım 1c'deki Worker kurulduysa Türkçe, ne yapması gerektiğini yazan bir sayfa
  çıkar. Verinin kendisini uzaktan ayakta tutmak ayrı bir iştir (okuma replikası;
  WireGuard taşıyıcısı ister, CF Tunnel PostgreSQL replikasyonunu taşımaz).
- **Kimlik zinciri üç adımlı** (Access OTP → parola → TOTP). Pratikte Access 24
  saat, ERP 8 saat sürer; rahatlama Access session süresinden gelir, katman
  azaltmaktan değil. **Oturum düşünce ne olur (2026-09-04'te ölçüldü):**
  ERP oturumu bitince tek toast + oturum-dışı ekrana geçiş olur ve `#/boss`
  korunduğu için giriş sonrası patron kendi ekranına döner. **Access** oturumu
  bitince `/api` istekleri 403 döner; eskiden panel buna *"Bu işlem için
  yetkiniz bulunmuyor"* diyordu — yetkiyle ilgisi olmayan, tamamen yanlış bir
  teşhis. Artık *"Uzaktan erişim oturumu doğrulanamadı. Sayfayı yenileyip
  Cloudflare girişini tekrarlayın."* + **Yenile** düğmesi gösterilir
  (`ACCESS_ASSERTION_*` kodu `details.code`te taşınır; bekçi
  `test_remote_access_guard` §5b2).
- **Mobil uygulama Access ile sürtüşür — AÇIK MADDE. Bugünkü ölçülen durum:**
  tabletler tünelden HİÇ geçmez (`EXPO_PUBLIC_API_URL` fabrika LAN adresidir),
  yani sahada bir sürtüşme YAŞANMIYOR. Bir tablet bilerek tünel adresine
  çevrilirse iki ayrı duvara toslar ve **ikisi de anlaşılır bir mesaj vermez**:
  ① Access açıksa her istek CF'in HTML giriş sayfasına yönlenir, uygulama JSON
  bekler → "beklenmeyen hata"; ② Access kapalı olsa bile `login-quick-pin`,
  `login-card`, `mobile-users` ve `/api/mobile/*` uzakta **404**'tür, yani
  yalnız kullanıcı adı + parola + TOTP ile girilebilir.
  ⚠️ **Bilinen ayrışma:** `GET /api/auth/login-methods` uzakta da `pin`/`card`
  yöntemlerini bildirir (uç `isRemote`e bakmaz) → giriş ekranı çalışmayacak
  düğmeler çizer. Bugün etkisi YOK (o yol kullanılmıyor); mobil gerçekten uzağa
  açılacaksa **ilk iş** bu ucun uzakta yöntemleri süzmesidir. Çözüm yönü: `/api/*`
  Access dışına alınıp yalnız SPA gatelenir ya da mobil için ayrı yol kurulur.

---

## İlgili

- `deploy/uzak-erisim/` — cloudflared şablonu + `cf-worker-hata-sayfasi.js`
- `deploy/.env.production.example` §2b — ortam değişkenleri
- `docs/ops/SUNUCU-ENVANTERI.md` — makine/port envanteri
- Bekçiler: `Teks-Erp/scripts/test_remote_access_guard.ts` · `test_totp.ts` ·
  `Electron/src/lib/boss-menu.test.ts` · `Electron/src/test/boss-shell.test.ts`
