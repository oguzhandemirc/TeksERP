# Sunucu envanteri — hangi makine ne yapıyor

> Son güncelleme: **2026-10-08** (`tekserp-indir` kökeni; fabrika satırları 2026-09-29 SAHINSRV salt-okuma envanterinden). Yeni bir makine, kullanıcı, port ya da zamanlanmış
> iş eklendiğinde **buraya da yazılır** — aksi hâlde "bu port neden açık" sorusunun
> cevabı kimsede kalmaz.

---

## Makineler

| Makine | Adres | Rolü | Durum |
|---|---|---|---|
| **Fabrika sunucusu — adnansahin** | SAHINSRV, fabrika LAN'ı (Windows 10 Pro) | ERP backend + PostgreSQL + yerel yedek | Canlı üretim · uzak erişim **Tailscale** |
| **tekserp-vds** | `80.253.255.188` | Güncelleme yayını + makine dışı yedek hedefi | 2026-09-01'den beri yayın burada |
| Eski paylaşımlı sunucu | `91.217.119.138` (takma ad `yenisunucu` — adı yanıltıcı) | `demo` | Yayın 2026-09-01'de taşındı; demo burada kaldı (repo kaydı — sunucuda doğrulanmadı) |

> ⚠️ Çok müşteri notu — bu tablo **fabrika başına bir satır** taşımalıdır (`Fabrika sunucusu — <müşteri kodu>`), çünkü her kurulumun kendi LAN'ı, kendi tünel hostname'i (`<musteri>-erp.etkiliyazilim.com`), kendi yedek kullanıcısı (`fab-<müşteri>`) ve kendi yayın klasörü (`/<müşteri>/electron`, `/<müşteri>/mobil`) vardır. Aşağıdaki "Fabrika sunucusu — ağ / servisler" bölümleri **her fabrika için aynı şablondur** (4000 LAN · 4001 yalnız 127.0.0.1 · 5432 yerel) — şablon çekirdektir, satırlar müşteri başına çoğalır.

⚠️ Eski sunucu **paylaşımlı**: başka müşterilerin WordPress siteleri, `postgres`,
`mariadb`, `redis` orada koşuyor. Yeni VDS'in var oluş sebebi budur.
`demo.etkiliyazilim.com` bilinçli olarak orada kalıyor (müşteriye gösterim için;
2026-09-02'den beri `main`'den derlenir — `feature/depo-mal-kabul` dalı emekli).

---

## Fabrika sunucusu — ağ

| Port | Ne | Kim erişir |
|---|---|---|
| **4000** | ERP backend (HTTP) | Fabrika LAN'ı — panel + tabletler |
| 5432 | PostgreSQL | `listen_addresses='127.0.0.1'` — yalnız yerel |

⚠️ **GELEN PORT AÇILMAZ.** Uzaktan erişim **dışarı doğru** bağlanan bir ajanla
sağlanır; güvenlik duvarında hiçbir kural değişmez. **SAHINSRV'de bu ajan
Tailscale'dir** — `cloudflared` hizmeti YOK ve 4001 dinlemiyor (ölçüldü 2026-09-29).
Eski patron tüneli (cloudflared + 4001) 2026-09-30'da koddan kaldırıldı (B6); patron
patron bulutundan izler, fabrika buluta yalnız DIŞARI doğru imzalı istek atar.

### Fabrika sunucusundaki servisler

SAHINSRV'de ölçülen değerler (2026-09-29, salt okuma). Yeni kurulumda adlar
`ilk-kurulum.ps1`/`kur.ps1` varsayılanlarından gelir ve farklı olabilir:

| Servis | Ne yapar | Not |
|---|---|---|
| `pm2` → **`tekserp-backend-yeni`** | ERP backend (`C:\TeksERP\app`, `dist\server.js`, PORT 4000) | **fork modu, tek instance** (tek-process invariant) · daemon SYSTEM, `PM2_HOME=C:\TeksERP\pm2-home` |
| Hizmet `postgresql-tekserp` | PostgreSQL 16.9 | program `D:\PostgreSQL\16`, veri `D:\PostgreSQL\data`; `C:\TeksERP\pgsql\bin` o bin'e junction |
| Görev Zamanlayıcı → **`TeksERP-DB-Backup-Yeni`** | Gece yedeği **03:00** (`C:\TeksERP\yedekle.ps1`) | Backend çökse de koşar · ikinci kopya `E:\TeksERP-yedek` · eski `TeksERP-DB-Backup` görevi YOK (yeni kurulumda `ilk-kurulum.ps1` bu adla kurar) |
| Görev Zamanlayıcı → `TeksERP-Backend-Boot` | Açılışta `pm2-boot.cmd` → `pm2 resurrect` | SYSTEM |
| Hizmet `Tailscale` | Uzak erişim | `cloudflared` **YOK** |
| rclone → `gdrive` | Makine dışı yedek (backend'in saatlik süpürmesi) | Hedef Google Drive — tekserp-vds DEĞİL |

⚠️ **Sunucuda eski kalıntılar duruyor** (temizlik kararı kullanıcıda, lisans planı
Faz 0.7): `D:\tekserp-build\tekserp` Ağustos'tan kalma tam **git build klonu**
(`.env`'li; hiçbir şey bağlı değil — paket geliştirme makinesinde üretilir),
`C:\Etkili-Yazilim.SILINECEK-20260925` (eski kök), Haziran installer'ı kalıntıları.

---

## tekserp-vds — ayrıntı

**Ubuntu 24.04.1 LTS · 2 çekirdek · 3 GB RAM · 66 GB disk · Europe/Istanbul**

### Kullanıcılar — her biri dar bir iş için

| Kullanıcı | Yetki | Ne yapar |
|---|---|---|
| `oguzhan` | sudo, docker | Yönetim. `ssh tekserp-vds` |
| `yayinci` | **sudo YOK** | Yalnız `html/` ağacına yazar. `ssh tekserp-yayin` |
| `fab-adnansahin` | **kabuk YOK**, chroot | Yalnız `gelen/` dizinine SFTP ile yazar |
| `root` | — | **Doğrudan giriş KAPALI** (`PermitRootLogin no`) |

> Yayın neden `oguzhan` ile yapılmıyor: güncelleme dizinini ele geçiren biri,
> aynı hesapla sunucunun tamamını almasın diye. `SSH_HEDEF` bu yüzden
> `tekserp-yayin` kısayolunu (yani `yayinci`) kullanır.

### Ağ

| Port | Ne | Kim erişir |
|---|---|---|
| **2222** | SSH | Yalnız `AllowUsers`taki üç hesap, anahtarla |
| **80** | HTTP → HTTPS yönlendirme | Cloudflare |
| **443** | HTTPS (traefik) | Cloudflare |
| 8080 | traefik panosu | **Yalnız `127.0.0.1`** — SSH tüneli ile |
| 22 | — | **KAPALI** |

Güvenlik duvarı `ufw`, varsayılan gelen **deny**. `fail2ban` etkin
(3 hata / 10 dk → 1 saat ban) — parola girişi açık bırakıldığı için zorunlu.
Kurulum günü ölçüm: **11 saatte 1193 başarısız giriş denemesi**, ilk saatlerde
6 IP banlandı.

### Konteynerler

| Ad | İmaj | Bellek sınırı | İşi |
|---|---|---|---|
| `traefik` | traefik:v3.5 | 192m | TLS sonlandırma, yönlendirme |
| `docker-socket-proxy` | nginx:alpine | 64m | `docker.sock`u traefik'e **salt-okunur** verir |
| `tekserp-guncelleme` | nginx:alpine | 64m | Statik yayın (panel + tablet) |
| `tekserp-indir` | nginx:alpine (salt-okunur kök) | 64m | Tek ortak paketin indirme kökeni `indir.etkiliyazilim.com` (2026-10-08'den beri yayında; kapı önündeki Cloudflare Worker'da) |

Docker günlükleri: `json-file`, 20 MB × 5 dosya (sınırsız büyümeye karşı).

⚠️ ACME (Let's Encrypt) **bilerek yok**. Sertifika Cloudflare Origin CA;
Cloudflare API anahtarı bu makinede **durmuyor**. Servis etmediğimiz bir özellik
için fazladan bir sır tutmamak.

⚠️ **Cloudflare proxy (turuncu bulut) AÇIK kalmalı** — Origin CA'ya yalnız CF Edge
güvenir. DNS-only'ye çevrilirse `electron-updater` sertifikayı reddeder ve
güncelleme **sessizce** durur.

⚠️ **`html/` yalnız KAMUYA AÇIK dosyaları barındırır.** Yayın defteri ilk yazımda
oradaydı ve internete açıktı (ölçüldü: HTTP 200) — iç makine adlarını ve yayın
geçmişini sızdırıyordu. Ayrım nginx kuralıyla değil **dizinle** yapılır; kural
yazmak kırılgandır, yarın oraya konan ikinci bir iç dosya yine sızar.

### Dizinler

```
/opt/stack/traefik/                     traefik.yml · dynamic/ · certs/
/opt/stack/apps/tekserp-guncelleme/
├── html/adnansahin/electron/           Setup.exe · blockmap · latest.yml
├── html/adnansahin/mobil/              ota/ · apk/
├── defter/<musteri>-YAYIN-DEFTERI.tsv  kim/ne zaman/hangi sağlama
└── nginx/default.conf                  ⚠️ root'a ait — yayinci DEĞİŞTİREMEZ
/opt/stack/apps/tekserp-indir/          ayrı compose projesi `tekserp-indir` (kaynak deploy/guncelleme-sunucusu/indir/)
├── html/<grup>/{electron,mobil,backend}/  grup test · oncu · genel — yayinci (1001)
├── defter/                             yayın defteri, html/ DIŞINDA — yayinci (1001)
├── docker-compose.yml                  root — yayinci DEĞİŞTİREMEZ
└── nginx/default.conf                  root — yayinci DEĞİŞTİREMEZ

/srv/tekserp-yedek/<fabrika>/gelen/     fabrika SFTP ile buraya yazar
/srv/tekserp-arsiv/<fabrika>/           root'a ait — fabrika ERİŞEMEZ
```

**`tekserp-indir` (2026-10-08, repo `a92359530`):** yönlendirici `tekserp-indir` (`Host(indir.etkiliyazilim.com)`),
kendi kenar zinciri `tekserp-indir-cf` (Cloudflare ipallowlist) → `tekserp-indir-hiz` (`Cf-Connecting-Ip` başına
hız seddi); satıcının ara katmanlarına ve eski `tekserpguncelleme` yönlendiricisine bağlı DEĞİL. Köken yalnız
Cloudflare'i kabul eder (doğrudan `--resolve …:80.253.255.188` → 403; ölçüldü 2026-10-08). Kök sahipli dizinler,
`oguzhan`ın etkileşimsiz sudo'su olmadığından tek seferlik yardımcı konteynerle yazıldı
([`SATICI-KURULUM.md`](SATICI-KURULUM.md) §12 kalıbı). Kapı ve Cloudflare tarafı:
[`INDIRME-KAPISI-WORKER.md`](INDIRME-KAPISI-WORKER.md) §11.
**Geri alma:** önce Cloudflare'de DNS kaydı `indir` ve rota kaldırılır (ad çözülmez, kapısız pencere doğmaz);
sonra VDS'te `cd /opt/stack/apps/tekserp-indir && docker compose down`. Dizin SİLİNMEZ; eski
`tekserp-guncelleme` ve adnansahin bu adımlardan etkilenmez — her adımdan sonra adnansahin ölçümü koşulur.

### Zamanlanmış işler

| Ne zaman | Ne | Nerede |
|---|---|---|
| 15 dakikada bir | Yedek arşivleme + bütünlük + budama | `/etc/cron.d/tekserp-yedek` |
| Günlük | Güvenlik yamaları | `unattended-upgrades` |

---

## Saklama politikaları

| Ne | Süre | Nerede uygulanır |
|---|---|---|
| Fabrika yerel yedeği | 30 gün | `BACKUP_RETENTION_DAYS` (fabrika `.env`) |
| Sunucu günlük arşiv | 30 gün | `tekserp-yedek-arsivle` → `GUNLUK_SAKLA` |
| Sunucu aylık arşiv | 12 ay | `tekserp-yedek-arsivle` → `AYLIK_SAKLA` |
| `gelen/` aynası | 35 gün | fabrikanın penceresinden geniş — rclone yeniden yüklemesin |
| Electron paketleri | Son 5 sürüm | `electron-yayinla.sh` budama adımı |
| Docker günlükleri | 20 MB × 5 | `/etc/docker/daemon.json` |

---

## Erişim özeti — kim neye ulaşır

| | Fabrika sunucusu | tekserp-vds | Yedek arşivi |
|---|---|---|---|
| **Müşteri / fabrika personeli** | ✅ (kendi ERP'si) | ❌ | ❌ |
| **Patron (uzaktan, tünel)** | tasarım: salt takip + dar yazma — Access OTP + parola + TOTP · **SAHINSRV'de kurulu değil** | ❌ | ❌ |
| **Fabrikanın yedek servisi** | ✅ | yalnız `gelen/`e **yazar** | ❌ |
| **Biz** | ✅ | ✅ | ✅ |
| **Sunucuyu ele geçiren** | — | ✅ | yalnız **şifreli** bloblar |

Yedek şifreleme parolası **sunucuda YOK** — fabrikada ve parola yöneticisinde.

---

## İlgili reçeteler

- [`SUPERADMIN-KURULUM.md`](SUPERADMIN-KURULUM.md) — satıcı hesabı (süperadmin) ve ayar şifresi
- [`YEDEK-VPS-KURULUM.md`](YEDEK-VPS-KURULUM.md) — yedek mimarisi, ölçülen tuzaklar
- [`VDS-TASIMA.md`](VDS-TASIMA.md) — taşıma sırası ve geri dönüş
- [`ELECTRON-OTOMATIK-GUNCELLEME.md`](ELECTRON-OTOMATIK-GUNCELLEME.md) — panel güncellemesi
- [`MOBIL-UZAKTAN-GUNCELLEME.md`](MOBIL-UZAKTAN-GUNCELLEME.md) — tablet güncellemesi
- [`YEDEK-GERI-YUKLEME-TATBIKATI.md`](YEDEK-GERI-YUKLEME-TATBIKATI.md) — geri yükleme provası
- [`SATICI-KURULUM.md`](SATICI-KURULUM.md) — satıcı (lisans) sunucusu: ayrı compose projesi, port yayını yok, şifreli yedek; VDS'te yalnız üretim satıcısı (§13; portal örtüsü zorunlu) — hazırlık satıcısı 2026-10-05 emekli, verisi silindi (§0–§12 tarih)
- [`PORTAL-GENEL-ERISIM.md`](PORTAL-GENEL-ERISIM.md) — satıcı portalının internetten yolu (`portal.etkiliyazilim.com`): Cloudflare Access + parola + TOTP, kök parolası dahil bütün satıcı işlemleri (2026-10-04; 2026-10-05'ten beri portalın TEK yolu, yalnız üretim satıcısında — tünel D5'te kalktı); Cloudflare API sırası, DNS, doğrulama
- [`LISANS-DEVREYE-ALMA-TESTFABRIKA.md`](LISANS-DEVREYE-ALMA-TESTFABRIKA.md) — lisansı testfabrika'da devreye alma sırası; testfabrika emekli (kullanıcı kararı 2026-10-05, kaldırma ayrı adım), belge üretim satıcısında "test" grubunda kurulacak yeni test kurulumu için şablon (satıcı A2 imajı → yayıncı → korumalı backend → yayın → portal → gözlem kipinde etkinleştirme → Senaryo T); salt-okuma aşama doğrulayıcısı

## Açık iş

- [x] ~~Cloudflare Origin CA sertifikası~~ — **kuruldu 2026-09-01**, geçerlilik **2041-08-28**
      (`/opt/stack/traefik/certs/`, cert 644 · key 600, ikisi de root'a ait).
      Kurulumdan önce çift eşleşmesi hem yerelde hem sunucuda doğrulandı —
      eşleşmeyen bir çift TLS'i tamamen düşürür.
- [x] ~~DNS: `guncelleme` A kaydı → `80.253.255.188`~~ — **çevrildi ve doğrulandı**
      (işaretli istek yeni sunucunun erişim kaydında görüldü)
- [ ] **Köken Cloudflare'e kapalı DEĞİL** — 2026-09-30 ölçüldü (o gün `lisans-test` üzerinden; o kayıt 2026-10-05'te silindi, aynı köken): CF dışı IP'den `curl -sk --resolve lisans-test.etkiliyazilim.com:443:80.253.255.188 …/saglik` → 200; yeniden ölçüm `lisans.etkiliyazilim.com` ile yapılır. Satıcı portalının genel yönlendiricisi CF `ipallowlist` taşır ([`PORTAL-GENEL-ERISIM.md`](PORTAL-GENEL-ERISIM.md)); diğer yönlendiriciler için daraltma ayrı karar.
- [ ] **Cloudflare SSL kipi → "Full (strict)"** — şu an "Full": CF↔origin bacağı
      şifreli ama kimliği doğrulanmıyor. Gerçek Origin CA sertifikası artık
      yerinde olduğu için sıkılaştırılabilir.
- [ ] Fabrika sunucusundan tekserp-vds'e yedek (`YEDEK-VPS-KURULUM.md` §B) — SAHINSRV'de
      rclone VAR ama hedefi Google Drive (`gdrive`); VDS'e gelen yedek ölçülmedi
- [ ] Geri yükleme provası
- [ ] Eski sunucudaki yayın kopyasını kapat (~2026-09-08, bir haftalık geri dönüş)
- [ ] **Kod imzalama** — taşıma ihtimali düşürür, imza sonucu ortadan kaldırır
