# Demo Yayın Runbook — `demo.etkiliyazilim.com`

**Bu belge teorik değildir: 2026-08-14'te baştan sona uygulandı ve doğrulandı.**
Aşağıdaki her komut gerçekten koştu; çıkan iki tuzak da (§7) burada yazılı.

> ⚠️ Bu runbook YALNIZ demo ortamı içindir. Fabrika kurulumu Windows sunucuda,
> LAN'da, Docker'sız çalışır ve buradaki hiçbir adımdan etkilenmez.

---

## 1. Hedef mimari — neden nginx/pm2/certbot YOK

Sunucu boş bir VPS **değil**: üzerinde canlı komşular var (mail sunucusu, iki
WordPress, bir Next.js sitesi, Redis, MariaDB, PostgreSQL). Hepsi **Docker** ile
koşuyor ve önlerinde **Traefik v3.5** var.

Dolayısıyla:

| Klasik plan | Bu sunucudaki karşılığı |
|---|---|
| nginx vhost | Traefik **Docker etiketleri** |
| certbot | Sertifika **zaten var** (Cloudflare Origin CA, `traefik/dynamic/tls.yml`) |
| pm2 | `restart: unless-stopped` + healthcheck |
| apt install postgresql | Mevcut `postgres` konteyneri (PG 16.14) |

Hostta node/npm/pm2/nginx/psql **kurulu değil** ve kurulmamalı — yığının kuralı
her şeyin konteynerde olması.

⚠️ **TLS etiketinde `certresolver` YOK ve bu bilinçli:** `etkiliyazilim.com` bu
Cloudflare hesabının zone'unda olmadığı için DNS-01 çalışmıyor. Sertifika statik
olarak default store'a yükleniyor; `tls=true` yeter. (`certresolver=cloudflare`
yalnız hesabın kendi zone'undaki alan adları için — örn. `fztfatmadenizli.com.tr`.)

**Ağ tarafı zaten sertti** (bu iş kapsamında değiştirilmedi): UFW 80/443'ü
**yalnız Cloudflare IP aralıklarına** açıyor, SSH 2222'de ve **yalnız anahtarla**,
fail2ban çalışıyor.

---

## 2. Erişim

```bash
ssh yenisunucu        # ~/.ssh/config: oguzhan@91.217.119.138:2222, yenisunucu_ed25519
```

`oguzhan` parolasız sudo taşır. ⚠️ Eski notlardaki `root` + parola **geçersiz**:
22. port kapalı, parola girişi kapalı.

---

## 3. Tek origin kararı

Panel ve API **aynı adreste**: backend `WEB_DIST_DIR` ile panelin build'ini kendisi
servis ediyor (`app.ts` opt-in bloğu). Böylece CORS, mixed-content ve "sunucu
adresi ayarı" üçlüsü tamamen düşer. Panel HashRouter kullandığı için derin yol
sorunu da yok; yine de SPA fallback bloğu ileriye dönük duruyor.

---

## 4. Kurulum adımları (uygulanan sıra)

### 4.1 Veritabanı

```bash
ssh yenisunucu
# rol + veritabanı (İDEMPOTENT — mevcut fizyodb/postgres'e DOKUNMAZ)
sudo docker exec postgres psql -U postgres -c \
  "CREATE ROLE tekserp LOGIN PASSWORD '<parola>';"
sudo docker exec postgres psql -U postgres -c \
  "CREATE DATABASE tekserp_demo OWNER tekserp;"
# ⚠️ kök CLAUDE.md operasyonel kuralı — migration ile DEĞİL elle uygulanır
sudo docker exec postgres psql -U postgres -c \
  "ALTER DATABASE tekserp_demo SET statement_timeout = '50s';"
```

Parola `/opt/stack/apps/.tekserp-db-password` içinde (chmod 600).

### 4.2 Kaynağı gönder

```bash
# yerelden, depo kökünden:
rsync -az --delete \
  --exclude='.git' --exclude='node_modules' --exclude='mobil' \
  --exclude='dist' --exclude='dist-web' --exclude='out' \
  --exclude='.claude' --exclude='.env' \
  ./ yenisunucu:/opt/stack/apps/tekserp-demo/repo/
```

İmaj **sunucuda** derleniyor — "yerelde derledim, kopyaladım" sınıfı sürüm kayması
olmasın diye.

### 4.3 Ortam değişkenleri

`/opt/stack/apps/tekserp-demo/.env` (chmod 600). Kritik olanlar:

| Değişken | Neden |
|---|---|
| `DATABASE_URL` | Host **`postgres`** (konteyner adı), `127.0.0.1` DEĞİL — uygulama başka bir konteynerde |
| `WEB_DIST_DIR=/app/dist-web` | Panelin tek origin'den servisi |
| `TRUST_PROXY=1` | ⚠️ **En kritik.** Yoksa `req.ip` herkes için tek Cloudflare edge IP'si olur ve **ilk yanlış şifre demoyu herkese kapatır** |
| `SWAGGER_ENABLED=false` | API dokümanı internete açık kalmasın |
| `RATE_LIMIT_ENABLED=true` | Bağımlılıksız in-memory sliding-window |
| `BACKUP_DIR=/app/backups` | ⚠️ **Tanımsızsa yedek HİÇ alınmaz** |
| `DEMO_USER_PASSWORD` | Demo kullanıcısının şifresi (yoksa üretilip ekrana basılır) |

⚠️ `LOGIN_LOCKOUT_SCOPE` **elle verilmez**: `TRUST_PROXY` doluyken otomatik olarak
`ip+identity` (iki kovalı) moda geçer. Bkz. §6.

### 4.4 Derle, göç et, tohumla

```bash
cd /opt/stack/apps/tekserp-demo
sudo docker compose build
sudo docker compose run --rm --entrypoint sh app -c "npx prisma migrate deploy"
sudo docker compose run --rm --entrypoint sh app -c "npx tsx prisma/seed.ts"              # izin+rol kataloğu, admin
sudo docker compose run --rm --entrypoint sh app -c "npx tsx prisma/seed-ticaret-demo.ts" # demo verisi
```

⚠️ **Sıra önemli:** `seed.ts` izin ve rol kataloglarını kurar; demo seed'i
`WEB_TRADE` şablonunu ona atar. Ters sırada demo kullanıcı izinsiz kalır.

### 4.5 Cutover

```bash
# demo.etkiliyazilim.com ÖNCE placeholder'a bakıyordu. AYNI Host kuralını taşıyan
# iki Traefik router'ı belirsiz davranır → placeholder ÖNCE durdurulur.
cd /opt/stack/apps/etkiliyazilim-demo && sudo docker compose down
cd /opt/stack/apps/tekserp-demo      && sudo docker compose up -d
```

Placeholder **dosyaları silinmez** — geri dönüş yolu odur (§8).

---

## 5. Doğrulama (uygulandı, hepsi yeşil)

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://demo.etkiliyazilim.com/     # 200
curl -s https://demo.etkiliyazilim.com/health                                # status UP, db UP
curl -s -o /dev/null -w "%{http_code}\n" https://demo.etkiliyazilim.com/api-docs/  # 404 (kapalı olmalı)
sudo docker ps --filter name=tekserp-demo --format "{{.Status}}"             # (healthy)
```

Konteyner açılış banner'ı sertleştirmeyi ekrana basar; beklenen satır:

```
Sertleştirme: trustProxy=1 · cors=https://demo.etkiliyazilim.com
              swagger=kapalı · hsts=açık · girişKilidiKapsamı=ip+identity
              hızSınırı=açık (60sn · yazma 120 · giriş 10)
```

Uçtan uca: `POST /api/auth/login` → token; ardından depolar / toplar / sevkiyatlar
/ cariler / faturalar / kasa uçları 200 döndü, panel JS paketi (3.3 MB) indi.

---

## 6. ⚠️ Giriş kilidi — ters vekil arkasındaki asıl tuzak

`auth.controller` giriş kilidini `req.ip` ile anahtarlıyordu ve kodun kendi
yorumu bunun *fabrika LAN'ında her cihazın kendi IP'sini taşıdığı* varsayımına
dayandığını söylüyordu. Cloudflare + Traefik arkasında **herkes tek IP'den gelir**.

Çözüm iki kovalı kilit:

- `ip|kimlik` → normal bütçe (şifresini yanlış giren yalnız kendini kilitler)
- `ip` → **5× bütçe** (25 hatalı deneme; tek NAT ofisini engellemez ama 25 hesabı
  deneyen bir spray'i yakalar)

Kimlik **sır olmamalı**: şifre yolunda kullanıcı adı, kart/PIN yolunda cihaz
kimliği kullanılır. Kart kodunu anahtara yazmak hem sızıntı hem de "kova hiç
dolmaz, koruma sessizce kaybolur" demekti.

### ⚠️ 6b. AÇIK MADDE — gerçek istemci IP'si origin'e ULAŞMIYOR (ölçüldü)

`TRUST_PROXY` **1 ve 2 ile ayrı ayrı ölçüldü**; ikisinde de uygulama Cloudflare
kenar IP'sini görüyor, gerçek ziyaretçiyi değil:

```
benim genel IP : 176.43.198.27
TRUST_PROXY=1  → morgan: 172.68.194.171   (CF kenarı)
TRUST_PROXY=2  → morgan: 172.70.248.162   (CF kenarı)
```

**Sebep Express'te değil Traefik'te:** Traefik gelen `X-Forwarded-For`'u
güvenilmeyen kaynaktan geldiği için **siliyor** ve kendi gördüğü adresi (CF
kenarı) yazıyor. Cloudflare'in gönderdiği gerçek istemci IP'si o noktada
kayboluyor — hiçbir Express ayarı geri getiremez.

**Etkisi:** IP'ye dayanan iki mekanizma tüm ziyaretçileri tek kovada topluyor:
giriş kilidi ve hız sınırı. Paylaşımlı `demo` hesabında bu, birkaç yazım
hatasının herkesi kilitlemesi demekti.

**Şimdilik yapılan (yeterli, riski düşük):** kilit KAPATILMADI — kapatmak,
bilinen kullanıcı adı + paylaşılan şifreyle açık bir kaba kuvvet yüzeyi
bırakırdı. Eşikler demoya uyarlandı:

| Ayar | Değer | Neden |
|---|---|---|
| `auth.pinLockoutAttempts` | 30 | dürüst yazım hataları kilide ulaşmasın |
| `auth.pinLockoutPenaltySec` | 30 | ulaşırsa ceza kısa |
| `auth.pinLockoutEscalateAfter` | 20 | uzun cezaya kolay tırmanmasın |
| `auth.pinLockoutLongPenaltyMin` | 5 | 15 dk yerine 5 dk |

Hız sınırı (giriş 10/60 sn) ikinci hat olarak duruyor.

**KÖK ÇÖZÜM (kullanıcı onayı gerektirir, YAPILMADI):** Traefik'in
`entryPoints.websecure.forwardedHeaders.trustedIPs` listesine Cloudflare
aralıkları yazılır (sunucuda `/opt/stack/.cloudflare-ips` zaten mevcut, UFW
onu kullanıyor). Bu, gerçek istemci IP'sini tüm sitelere kazandırır ve
`TRUST_PROXY=2` doğru çalışmaya başlar.

⚠️ **Neden gece yarısı yapılmadı:** Traefik bu sunucudaki **paylaşımlı**
altyapıdır ve üzerinde kullanıcının canlı siteleri var (mail sunucusu, iki
WordPress, bir Next.js sitesi). `traefik.yml` STATİK yapılandırmadır → değişiklik
Traefik'in yeniden başlatılmasını ister; yazım hatası tüm siteleri birden
düşürür. Demoyu ayağa kaldırmak için gerekli değildi, bu yüzden karar
kullanıcıya bırakıldı.

---

## 7. Yolda çıkan iki tuzak (ikisi de düzeltildi)

1. **`prisma.config.ts` imaja kopyalanmamıştı.** Prisma 7 datasource URL'ini
   schema'dan değil o dosyadan okuyor → `migrate deploy` *"datasource.url property
   is required"* ile durdu. Belirti **derleme sırasında değil ilk deploy'da**
   çıkar.
2. **Yalnız `dist` yetmedi.** Seed script'leri TypeScript'tir ve `../src/services/…`
   üzerinden servis katmanını çağırır (ham insert yerine gerçek defter/bakiye/belge
   zincirini üretsinler diye) → `MODULE_NOT_FOUND`. Çalışma imajı artık `src`'yi de
   taşıyor (~5 MB).

Ayrıca imajda **`postgresql-client-16` PGDG deposundan** kuruluyor: Debian
bookworm'un kendi paketi v15 ve sunucu PG 16 → `pg_dump` *"server version
mismatch"* ile reddeder, yani **gece yedeği her gece sessizce başarısız olurdu.**

---

## 8. Geri alma

```bash
cd /opt/stack/apps/tekserp-demo      && sudo docker compose down
cd /opt/stack/apps/etkiliyazilim-demo && sudo docker compose up -d   # placeholder geri
```

Veritabanı kalır (`tekserp_demo`); silmek gerekirse:
`sudo docker exec postgres psql -U postgres -c "DROP DATABASE tekserp_demo;"`

---

## 9. Bilinen açıklar / sonraki adımlar

- **Offsite yedek yok.** Açılış log'u bunu söylüyor: `BACKUP_RCLONE_REMOTE boş —
  TÜM YEDEKLER VERİTABANIYLA AYNI DİSKTE.` Demo için kabul edilebilir, kalıcı
  kurulumda değil.
- **Firma adı fabrikanınki** (`Adnan Şahin Tekstil`). Yabancı müşteriye
  gösterilecekse Genel Ayarlar'dan değiştirilmeli.
- **Docker build cache ~30 GB** (çoğu komşu uygulamalardan). Disk sıkışırsa
  `sudo docker builder prune` — imajlara dokunmaz.
- Demo şifresi bu makinede `/opt/stack/apps/tekserp-demo/.env` içinde;
  değiştirmek için `DEMO_USER_PASSWORD` verip demo seed'i yeniden koştur.
