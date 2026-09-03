# Sunucu envanteri — hangi makine ne yapıyor

> Son güncelleme: **2026-09-01**. Yeni bir makine, kullanıcı, port ya da zamanlanmış
> iş eklendiğinde **buraya da yazılır** — aksi hâlde "bu port neden açık" sorusunun
> cevabı kimsede kalmaz.

---

## Makineler

| Makine | Adres | Rolü | Durum |
|---|---|---|---|
| **Fabrika sunucusu** | Fabrika LAN'ı (Windows) | ERP backend + PostgreSQL + yerel yedek | Canlı üretim |
| **tekserp-vds** | `80.253.255.188` | Güncelleme yayını + makine dışı yedek | **YENİ** (2026-09-01) |
| Eski yayın sunucusu | `91.217.119.138` | Güncelleme yayını (devrediliyor) + `demo` | Geçiş sürüyor |

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
| **4001** | ERP backend, **tünel dinleyicisi** | ⚠️ **YALNIZ `127.0.0.1`** — pratikte yalnız aynı makinedeki `cloudflared` |
| 5432 | PostgreSQL | `listen_addresses='127.0.0.1'` — yalnız yerel |

⚠️ **GELEN PORT AÇILMAZ.** Uzaktan erişim `cloudflared` servisiyle sağlanır ve
o **dışarı doğru** bağlanır; güvenlik duvarında hiçbir kural değişmez.

⚠️ **4001 `0.0.0.0`a AÇILAMAZ.** Uzak/LAN ayrımının tamamı bu porta LAN'dan
erişilememesine dayanıyor (`req.socket.localPort` → `req.isRemote`). Açılırsa
fabrikadaki herhangi biri kendini "uzak" gösterebilir ya da tersi olur; iki
yönde de kural seti sessizce yanlış uygulanır.

### Fabrika sunucusundaki servisler

| Servis | Ne yapar | Not |
|---|---|---|
| `pm2` → tekserp | ERP backend | **fork modu, tek instance** (tek-process invariant) |
| Görev Zamanlayıcı → `TeksERP-DB-Backup` | Gece yedeği 02:00 | Backend çökse de koşar |
| **`cloudflared`** | Uzaktan erişim tüneli | **YENİ (2026-09-01)** · Windows servisi · reçete: [`UZAK-ERISIM-KURULUM.md`](UZAK-ERISIM-KURULUM.md) |

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

/srv/tekserp-yedek/<fabrika>/gelen/     fabrika SFTP ile buraya yazar
/srv/tekserp-arsiv/<fabrika>/           root'a ait — fabrika ERİŞEMEZ
```

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
| **Patron (uzaktan, tünel)** | ✅ salt takip + dar yazma — Access OTP + parola + TOTP | ❌ | ❌ |
| **Fabrikanın yedek servisi** | ✅ | yalnız `gelen/`e **yazar** | ❌ |
| **Biz** | ✅ | ✅ | ✅ |
| **Sunucuyu ele geçiren** | — | ✅ | yalnız **şifreli** bloblar |

Yedek şifreleme parolası **sunucuda YOK** — fabrikada ve parola yöneticisinde.

---

## İlgili reçeteler

- [`UZAK-ERISIM-KURULUM.md`](UZAK-ERISIM-KURULUM.md) — patron modülü tüneli (Cloudflare Tunnel + Access)
- [`YEDEK-VPS-KURULUM.md`](YEDEK-VPS-KURULUM.md) — yedek mimarisi, ölçülen tuzaklar
- [`VDS-TASIMA.md`](VDS-TASIMA.md) — taşıma sırası ve geri dönüş
- [`ELECTRON-OTOMATIK-GUNCELLEME.md`](ELECTRON-OTOMATIK-GUNCELLEME.md) — panel güncellemesi
- [`MOBIL-UZAKTAN-GUNCELLEME.md`](MOBIL-UZAKTAN-GUNCELLEME.md) — tablet güncellemesi
- [`YEDEK-GERI-YUKLEME-TATBIKATI.md`](YEDEK-GERI-YUKLEME-TATBIKATI.md) — geri yükleme provası

## Açık iş

- [x] ~~Cloudflare Origin CA sertifikası~~ — **kuruldu 2026-09-01**, geçerlilik **2041-08-28**
      (`/opt/stack/traefik/certs/`, cert 644 · key 600, ikisi de root'a ait).
      Kurulumdan önce çift eşleşmesi hem yerelde hem sunucuda doğrulandı —
      eşleşmeyen bir çift TLS'i tamamen düşürür.
- [x] ~~DNS: `guncelleme` A kaydı → `80.253.255.188`~~ — **çevrildi ve doğrulandı**
      (işaretli istek yeni sunucunun erişim kaydında görüldü)
- [ ] **Cloudflare SSL kipi → "Full (strict)"** — şu an "Full": CF↔origin bacağı
      şifreli ama kimliği doğrulanmıyor. Gerçek Origin CA sertifikası artık
      yerinde olduğu için sıkılaştırılabilir.
- [ ] Fabrika sunucusuna rclone kurulumu (`YEDEK-VPS-KURULUM.md` §B) — sunucuya
      henüz tek yedek gelmedi
- [ ] Geri yükleme provası
- [ ] Eski sunucudaki yayın kopyasını kapat (~2026-09-08, bir haftalık geri dönüş)
- [ ] **Kod imzalama** — taşıma ihtimali düşürür, imza sonucu ortadan kaldırır
