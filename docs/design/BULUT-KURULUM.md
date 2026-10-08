# Bulut kurulum — müşteriye özel VDS (lisans sınıfı BARINDIRILAN)

> **Durum:** TASARIM (2026-10-01). Kod yazılmadı. Uygulama, bugünkü işler (Dağıtım v2, lisans v2, demofabrika) bittikten sonra başlar; dilim planı §9'da.
> **Bağlayıcı kararlar:** kullanıcı, 2026-10-01 (§0.1; açık soruların cevapları K-B10…K-B15, ayrıntı §10). Bu belge onları uygular, değiştirmez. Teknik kararlar §0.2'de; T2 ve T3 yönetici onaylıdır. Açık kalan tek konu avukata giden H3'tür (§7.1).
> **Dayanak:** `docs/design/LISANS-KOD-KORUMA.md` §2 ve Faz 2f (Linux Docker yapıtı) · `docs/design/LISANS-PROTOKOLU.md` · `docs/design/LISANS-V2-CEVRIMDISI-KIRA.md` · `docs/design/PATRON-BULUTU.md` · Dağıtım v2 sözleşmesi `GUNCELLEYICI.md` (dal `dagitim/w2-taban`; bu belge yazılırken `main`de değil) · `docs/ops/LINUX-DOCKER-KURULUM.md` · `docs/ops/SATICI-KURULUM.md` · `docs/ops/PATRON-BULUTU-KURULUM.md` · `docs/ops/PORTAL-GENEL-ERISIM.md` · `docs/ops/YEDEK-SIFRELEME.md` · `docs/ops/YEDEK-VPS-KURULUM.md` · `docs/ops/SUNUCU-ENVANTERI.md` · 2026-10-01 güvenlik denetimi (repo dışı; burada yalnız G-numaraları ve gereksinim olarak anılır).
> **İlişki:** `docs/design/SAAS-TASARIM.md` çok kiracılı (tek API, DB-per-tenant) bir taslaktır ve uygulanmıyor. Bu belge onun yerine geçmez. Burada model **tek kiracılıdır**: müşteri başına bir VDS, aynı fabrika backend'i. SaaS taslağından yalnız SLA dürüstlüğü (§A3), sözleşme çerçevesi (§A4) ve fidye dirençli yedek (§C7) alındı.

## 0. Özet

Bulut kurulum, fabrika kurulumunun aynısıdır. Tek fark, backend ile PostgreSQL'in müşterinin fabrikasında değil, bizim kiraladığımız ve yönettiğimiz bir Türkiye VDS'inde koşmasıdır. Panel ve tablet `https://<kanal>.etkiliyazilim.com` adresine Cloudflare üzerinden bağlanır. Kod tabanı tektir. Ayrışma, imzalı HAK'taki `BARINDIRILAN` sınıfından ve kurulum anındaki yerel beyandan türeyen **tek bir yüklemle** olur. Bu yüklem, yerel ağda kabul ettiğimiz zayıflıkları internete açık sunucuda sert kurala çevirir (§3). Fabrika kurulumunda bugünkü davranış değişmez.

### 0.1 Kullanıcı kararları (2026-10-01, bağlayıcı)

| # | Konu | Karar |
|---|---|---|
| K-B1 | İşletim | VDS'i biz yönetiriz. Kurulum betikle otomatik yapılır. İşletim sistemi güncellemesi, yedek, izleme ve güvenlik bizdedir. Müşteriden aylık bulut hizmet bedeli alınır |
| K-B2 | İnternet kesintisi | İlk sürümde kabul edilir ve sözleşmeye yazılır. Yedek internet önerilir. Kesintisiz üretim isteyen müşteriye fabrika kurulumu önerilir. Tablet çevrimdışı kuyruğu gerekirse ayrı iş olur |
| K-B3 | Konum | Türkiye'de VDS. KVKK kapsamında yurt dışı aktarım olmaz |
| K-B4 | Erişim | Doğrudan HTTPS ve güvenlik duvarı (Cloudflare Tunnel değil), **Cloudflare proxy arkasında**. Köken yalnız Cloudflare adreslerini kabul eder |
| K-B5 | Adres | `musteriadi.etkiliyazilim.com`. DNS ve sertifika bizdedir |
| K-B6 | PIN ve kart | Bulutta yalnız onaylı cihazdan kabul edilir. Özetli saklanır, deneme sınırı vardır, kart kodu uzun ve tahmin edilemez. **Özetli saklama her kurulumda uygulanır** (G21-K dilimi) |
| K-B7 | Yedek | Şifreli gece yedeği ve başka sağlayıcıda kopya |
| K-B8 | Güncelleme | Fabrikadakiyle aynı politika (OTOMATIK · ONAYLI · DONDUR, müşteri başına). Güncelleyici imzalı Docker imajı çeker, sorunda geri döner |
| K-B9 | Patron bulutu | Bulut kurulum da fabrika kurulumuyla aynı eşitleme yolunu kullanır |
| K-B10 | Yönetim erişimi (S1) | SSH internetten **port 2222'de, yalnız anahtarla** açılır (tailnet önerisi seçilmedi): `PasswordAuthentication no` · `AllowUsers` · `MaxAuthTries` · fail2ban. Gerekçe: 2026-10-01 sabahı bizim VDS'te parola girişi kapatıldı; öncesinde 30 günde ~12.700 başarısız parola denemesi ölçülmüştü. Parola girişi kapalıyken kaba kuvvetin işe yarayacağı bir yol kalmaz |
| K-B11 | Yedek kopyası (S2) | Farklı bir TR sağlayıcıda, bütün bulut müşterilerine ortak yedek deposu VDS'i. Her müşteri yalnız kendi dizinine yazar |
| K-B12 | Dış izleme (S3) | Kendi gözcümüz (`satici-gozcu`, satıcı VDS'inde) |
| K-B13 | VDS paketi (S4) | **Müşteri seçer, iki paket vardır:** "Standart" (ekonomik TR sağlayıcı, ~150–250 TL/ay) ve "Kurumsal" (SLA'lı TR sağlayıcı, ~600–1.200 TL/ay). Kurulum betiği sağlayıcıdan bağımsızdır |
| K-B14 | Güncelleme varsayılanı (S5) | ONAYLI (fabrikadakiyle aynı varsayılan) |
| K-B15 | İki adımlı giriş (S6) | Bulutta da **isteğe bağlı** kalır (2026-09-30 kararı aynen). Açığı hız sınırı, kalıcı giriş kilidi ve onaylı cihaz kapatır (R4–R6) |

### 0.2 Teknik kararlar

| # | Karar | Gerekçe | Durum |
|---|---|---|---|
| T1 | Alt alan **kanal kodudur** (`<kanal>.etkiliyazilim.com`). Ayrılmış adlar listesi kurulumu durdurur (`lisans` · `lisans-test` · `portal` · `patron` · `guncelleme` · `www` · `mail` · `send` · `api` · `demo` …) | Müşteri kimliği tek kaynaktan gelir (`deploy/kanallar.json`). Birinci düzey alt alanı Cloudflare'in ücretsiz Universal SSL sertifikası kapsar, `x.y.etkiliyazilim.com` ise ücretli sertifika ister | öneri |
| T2 | Güncelleyici, **yan konteyner değil, konakta systemd hizmeti** olarak çalışır (Dağıtım v2'nin Rust güncelleyicisinin Linux arka ucu) | Docker API'ye erişim kök yetkisine eşdeğerdir. Soketi bir konteynere bağlamak, kök yüzeyini konteyner ağına açar. Konak hizmeti, Windows'taki SYSTEM hizmetinin birebir karşılığıdır (§4) | **✅ yönetici onayladı (2026-10-01)** |
| T3 | TLS'i `nginx-unprivileged` (özetle sabit imaj) sonlandırır. Traefik kullanılmaz | Tek arka uç için etiket keşfi gerekmez. Traefik'in istediği soket vekili ortadan kalkar. mTLS (AOP) ve gerçek IP çözümü nginx'te yerleşiktir | **✅ yönetici onayladı (2026-10-01)** |
| T4 | SSH erişimi K-B10'a göre kurulur (2222, yalnız anahtar). Tailnet önerisi kullanıcı tarafından seçilmedi | Denetimin kritik bulgusu (G1) parolayla açık SSH idi; anahtar zorunluluğu onu kapatır | kullanıcı kararı (K-B10) |
| T5 | Bütün imajlar (backend, PostgreSQL, nginx) **bizim CDN'imizden ve imzalı bildirimdeki özetle** gelir. Docker Hub'a çıkılmaz | Tek çıkış hedefi, tek güven zinciri. Kapı İndirme Worker'ıdır | öneri |
| T6 | Dış izleme, satıcı VDS'inde **yeni bir en az yetkili yan konteynerle** (`satici-gozcu`) yapılır. Uyarılar mevcut bildirim kanalından (e-posta + Telegram) gider | Bildirim altyapısı zaten var. Üçüncü taraf ve yurt dışı bağımlılık eklenmez | kullanıcı kararı (K-B12) |

### 0.3 Kapsam dışı

Çok kiracılı model (SaaS taslağı) · bulutta web paneli (`WEB_DIST_DIR`, bugün de yok) · tablet çevrimdışı kuyruğu (K-B2) · zamanda geri dönüş (PITR) · fabrika kurulumundan buluta veri taşıma (ilk müşteri gelince ayrı runbook olarak yazılır; yol: şifreli döküm, `--geri-yukle`, lisans taşıma akışı).

## 1. Mimari

### 1.1 Şema

```
 Fabrika (müşteri)                      Cloudflare (proxy AÇIK, Full strict, AOP)            Müşteri VDS'i (TR, Ubuntu 24.04, bizde)
 panel ─┐                                ┌──────────────────────────────────────┐            ┌─────────────────────────────────────────────┐
 tablet ┴─ HTTPS 443 ─────────────────►  │ <kanal>.etkiliyazilim.com             │ ─443 mTLS─►│ DOCKER-USER: yalnız CF IP'leri (ipset v4+v6) │
                                         │ Universal SSL · önbellek BYPASS       │            │  kenar (nginx, Origin CA, AOP doğrular)      │
                                         └──────────────────────────────────────┘            │    │ ağ: kenar (internal)                    │
                                                                                              │  backend (korumalı imaj, 4000, port YOK)     │
 Bizim VDS (tekserp-vds) ◄── imzalı yoklama/eşitleme/indirme (443, ÇIKAN) ──────────────────── │    │ ağ: veri (internal)                     │
  satıcı · patron · güncelleme · satici-gozcu ── /health (CF üzerinden, 60 sn) ──────────────► │  postgres 16 · yedek (gece .tkenc)           │
                                                                                              │  konak: tekserp-guncelleyici (systemd)      │
 Yedek deposu (BAŞKA TR sağlayıcı) ◄── SFTP yalnız ekle (gece) ─────────────────────────────── │  konak: yedek-kopya · canlılık zamanlayıcısı │
                                                                                              │  SSH 2222, yalnız anahtar (22 KAPALI)        │
                                                                                              └─────────────────────────────────────────────┘
```

### 1.2 Hizmetler

| Hizmet | Nerede | Kullanıcı | Ağ | Sınır | Not |
|---|---|---|---|---|---|
| `kenar` | konteyner, `nginx-unprivileged@sha256:…` | 101 | `kenar` + yayın `0.0.0.0:443→8443` | 64 MB · 0,25 CPU | Origin CA sertifikası + AOP istemci CA'sı salt okunur. `real_ip_header CF-Connecting-IP`, yalnız CF aralıklarından. `/health/yerel` ve vekil başlığı kuralları backend'de olduğu gibi kalır |
| `backend` | konteyner, korumalı imaj (`Teks-Erp/docker/korumali/Dockerfile`) | 10001 | `kenar` + `veri` + `cikis` | 1,5 GB · 1,5 CPU · 512 süreç | Salt okunur kök FS, `cap_drop: ALL`, `no-new-privileges`. `/etc/machine-id` salt okunur bağlanır (parmak izi F1) |
| `postgres` | konteyner, `postgres:16-bookworm@sha256:…` | 999 | `veri` (internal) | 1 GB | Port yayını YOK. `statement_timeout=50s` (bugünkü değer) |
| `yedek` | konteyner, korumalı imaj, `yedek-zamanlayici.sh` | 10001 | `veri` | 256 MB | Gece `pg_dump -Fc` → doğrulama → `.tkenc` (§5) |
| `tekserp-guncelleyici` | **konak**, systemd, root | root | konak | — | §4. Docker'ı yerel soketten yönetir. Durum/niyet dizinleri backend'e bağlanır |
| `yedek-kopya` | konak, systemd zamanlayıcısı | `tekserp-yedek` (kabuksuz) | konak → depo:SFTP | — | Yedek biriminden yalnız `.tkenc` okur. `rclone copy` (sync değil) |
| `canlilik` | konak, systemd zamanlayıcısı (2 dk) | root | — | — | Docker `unhealthy` konteyneri kendiliğinden yeniden başlatmaz. Bu zamanlayıcı backend'i 5 dk sağlıksız görürse yeniden başlatır (saatte en çok 3 kez, sonra yalnız uyarı) |

### 1.3 Ağ ve port

| Yön | Kural | Nerede uygulanır |
|---|---|---|
| Gelen 443 | Yalnız Cloudflare IPv4/IPv6 aralıkları. Liste günlük tazelenir, boş ya da biçimsiz gelen liste uygulanmaz (eski liste kalır, uyarı düşer) | `DOCKER-USER` + `ipset` (Docker yayımlı portlarda ufw'yi atlar). `docs/ops/SATICI-KURULUM.md` §1 kalıbı |
| Gelen 443, TLS | Cloudflare'in istemci sertifikası (AOP) yoksa el sıkışma reddedilir. Bölge SSL kipi **Full (strict)** | nginx `ssl_verify_client on` |
| Gelen 2222 (SSH) | Her yerden, yalnız anahtarla (K-B10). fail2ban: 3 hata / 10 dk → 1 sa yasak; tekrarlayana (`recidive`) 1 hafta | ufw (sshd konakta koşar, Docker'ın yayımladığı bir port değildir; ufw burada geçerlidir) |
| Gelen diğer | 80, 22, 4000, 5432 kapalı | ufw varsayılan RED |
| Çıkan, backend | Yalnız tcp/443 ve sabit iki DNS. Özel aralıklar (RFC 1918, 100.64/10, 169.254/16, VDS'in kendisi) **DROP** | `DOCKER-USER`, `cikis` ağının alt ağı. `deploy/satici/vds/bildirim-cikis.sh` kalıbı |
| Çıkan, postgres / yedek / kenar | YOK (internal ağlar) | compose |
| Çıkan, konak | apt, CDN (güncelleyici), depo (SFTP) | — |

> **Elle kurulumda sapma (2026-10-08):** tasarımdaki kenar (T3: yayımlı port + `DOCKER-USER`/`ipset`) ve araçları yazılana dek, bizim yönettiğimiz sunuculardaki elle Docker kurulumu nginx'i konak ağında koşturur; böylece 443'e ufw'nin "yalnız Cloudflare" kuralları gerçekten uygulanır (Docker'ın yayımladığı port ufw'nin önünden geçer). Örnek `Teks-Erp/docker/korumali/docker-compose.bulut-ornek.yml`, adımlar ve bedeli `docs/ops/LINUX-DOCKER-KURULUM.md` §10. Kenar yazılınca örnek emekli olur.

Backend'in dışarıya çıkan bütün istekleri kurulum anahtarıyla imzalıdır ve bugünkü kanallardan gider: lisans yoklaması ve zil (`lisans.`), patron eşitlemesi (`patron.`, `Teks-Erp/src/cloud-sync/cloud-url.ts`), indirme belirteci, döviz kuru işi.

### 1.4 Konak sertleştirmesi

| Alan | Ayar |
|---|---|
| Hesaplar | Tek yönetim hesabı (`etkili`): anahtarla girer, `sudo` parola ister, **`docker` grubunda değildir** (G2). Müşteriye kabuk verilmez. `root` doğrudan giremez. Yedek kopya hesabı kabuksuzdur |
| SSH (K-B10) | `Port 2222` (22 kapalı) · `PasswordAuthentication no` · `KbdInteractiveAuthentication no` · `PubkeyAuthentication yes` · `PermitRootLogin no` · `AllowUsers etkili` · `MaxAuthTries 3` · `LoginGraceTime 30`. Yalnız Ed25519 anahtar. Acil durum kapısı sağlayıcının web konsoludur |
| Güncelleme | `unattended-upgrades` yalnız güvenlik yamaları. Yeniden başlatma gerekirse 04:30'da (gece yedeğinden sonra). Yeniden başlatma yoklama sağlık özetiyle görünür |
| Docker | Resmî depodan, sürümü sabit (`deploy/bulut/surumler.json`). `daemon.json`: `json-file` 20 MB × 5 · `ipv6: false` · `userland-proxy: false` · `no-new-privileges: true` · `live-restore: true` |
| Diğer | `fail2ban` (`sshd` + `recidive`; anahtar zorunluyken bile gürültüyü ve günlük şişmesini keser) · `chrony` · `journald` 500 MB tavan · 2 GB swap · `/etc/machine-id` kurulumda tazelenir (sağlayıcı şablonundan kopya kimlik taşımasın, etkinleştirmeden önce) |

Bütün compose servislerinde yalıtım gevşetmesi yoktur. Bunu `deploy/satici/compose-denetle.mjs`'in bulut kipi ölçer (B5): salt okunur kök, yetenek yok, root değil, port yalnız `kenar`'da, soket bağlı değil, internal ağlar, IPv6 kapalı, çıkış alt ağı kuralla aynı.

### 1.5 İzleme ve uyarı

Üç katman. Uyarıların hepsi satıcının mevcut giden kutusuna düşer, oradan e-posta ve Telegram ile gönderilir (`docs/ops/SATICI-KURULUM.md` §5c). Yeni bildirim kanalı açılmaz.

| Katman | Ne ölçer | Nasıl | Uyarı |
|---|---|---|---|
| İçeriden (yoklama) | Sağlık özeti (`HealthSummarySchema`, `Teks-Erp/src/lib/license/protocol/uclar.ts`): yedek hükmü ve yaşı · makine dışı kopya · disk doluluğu · audit yazım hatası · havuz zaman aşımı · iş hataları · güncelleyici raporu | BARINDIRILAN kurulumda yoklama aralığı **5 dk** (portal ayarı). Satıcı, sınıf başına eşiklerle değerlendirir | Sessiz kurulum 15 dk (bugün sınıf eşiği 24 sa) · yedek yaşı > 26 sa · disk > %80 / %90 · makine dışı kopya eksik · güncelleme `GERI_DONDU` / `BASARISIZ` (D7 olayları) |
| Dışarıdan (gözcü) | `https://<kanal>.etkiliyazilim.com/health` Cloudflare üzerinden: durum kodu, 6 alanlı gövde, süre | `satici-gozcu` yan konteyneri (satıcı imajı, ayrı giriş noktası). DB rolü `satici_gozcu`: yalnız BARINDIRILAN kurulumların adres kolonu SELECT + `bildirim` INSERT. Çıkış yalnız tcp/443. 60 sn'de bir | 3 ardışık hata → `BULUT_ULASILAMIYOR` · düzelince `BULUT_DUZELDI` · Origin sertifikasının bitişine 30 ve 7 gün kala (bitiş tarihi kurulum kaydında) |
| Konakta | Konteyner sağlığı | `canlilik` zamanlayıcısı | Yeniden başlatma yoklama raporunda sayaç olarak görünür (`isHatalari`) |

## 2. Tek komutla kurulum

```
node deploy/bulut/kur.mjs --musteri=<kanal> --vds=<IPv4> [--uygula] [--devam] [--geri-yukle=<.tkenc>]
```

Komut Mac'te (yönetici makinesi) koşar. **Varsayılanı kuru koşumdur:** her adımı ölçer, ne yapacağını basar, hiçbir şeye yazmaz. `--uygula` ile yazar. Her adım ölç → yap → doğrula sırasıyla ilerler ve tekrarlanabilir. Durum `~/.tekserp/bulut/<kanal>/durum.json` dosyasında tutulur, yarıda kalan kurulum kaldığı adımdan sürer. Müşteri kodu argümandan, kanal kimlikleri `deploy/kanallar.json`dan gelir. Sırlar argv'ye, ekrana ve loga girmez.

| # | Adım | İş | Doğrulama (geçmezse DUR) |
|---|---|---|---|
| 0 | Ön koşul | Kanal kaydında `bulut` bloğu var (alt alan = kanal, VDS IP, paket `standart` · `kurumsal`, sağlayıcı, platform `linux-x64-oci`) ve `check-kanallar` yeşil. Sağlayıcı, yedek deposunun sağlayıcısıyla aynı değil (§5.1). Portalda kurulum **BARINDIRILAN** sınıfında, kanala bağlı, etkinleştirme kodu hazır. Kanalda imzalı Linux sürümü yayında. Cloudflare belirteci `~/.tekserp/sirlar/` altında; yetkileri yalnız `etkiliyazilim.com` bölgesinde *DNS Edit* + *SSL and Certificates Edit*. Alt alan ayrılmış değil ve DNS'te kaydı yok | Herhangi biri yoksa DUR (fail-closed) |
| 1 | VDS'i ölç | **Sağlayıcıdan bağımsız:** betik yalnız temiz Ubuntu 24.04 LTS, sabit IPv4 ve sağlayıcının verdiği ilk SSH erişimini ister; sağlayıcı API'si kullanılmaz, paket yalnız kayıttır. Salt okuma: x86_64 · ≥ 2 vCPU · ≥ 4 GB · ≥ 40 GB · saat senkronu · makine kimliği | Eşik altı → DUR |
| 2 | Sertleştir | §1.4: hesap ve anahtar → sshd ek dosyası (2222, yalnız anahtar) → **yeni porttan anahtarla giriş ayrı bir oturumda ölçülür, ancak ondan sonra 22 ve parola girişi kapanır** (kilitlenme önlemi) → ufw · fail2ban · unattended-upgrades · machine-id tazeleme | `sshd -T` beklenen değerler · dışarıdan 22 kapalı · 2222'de parola denemesi reddediliyor |
| 3 | Docker ve kenar kuralları | Docker CE (sabit sürüm), `daemon.json`, ipset + `DOCKER-USER` kuralları (systemd birimi), CF IP tazeleyicisi | `iptables -S DOCKER-USER` beklenen kurallar · liste boş değil |
| 4 | Cloudflare | **a)** CSR VDS'te üretilir, özel anahtar VDS'ten çıkmaz → Origin CA sertifikası (1095 gün) VDS'e döner · **b)** AOP istemci sertifikası (bizim CA'mız, host ya da bölge düzeyinde; plan kapsamı B5'te ölçülür) · **c)** bölge Full (strict) değilse host için Configuration Rule · **d)** host için önbellek BYPASS kuralı · **e)** DNS A kaydı, proxy açık, **EN SONA** (adım 9'dan önce, 7 yeşilken) | API yanıtları + sertifika zinciri |
| 5 | Sırlar | VDS'te üretilir (`openssl rand`), Mac'e gelmez: PostgreSQL parolası · JWT sırrı (64 bayt) · kimlik özeti anahtarı (PIN/kart, G21-K) · yerel yedek anahtarı (parolası bizim kasada). `musteri.tkpub` ve `etkili.tkpub` açık yarıları yüklenir. `.env` root 0600 | Ret listesi denetimi (G20) · dosya izinleri |
| 6 | İmajlar | Kanalın imzalı bildirimi → indirme belirteciyle paket → §4.3 doğrulama zinciri → `docker load` → yüklenen imaj kimliği = bildirimdeki | Zincirin herhangi bir halkası → DUR, imaj silinir |
| 7 | Compose | `deploy/bulut/docker-compose.yml` + `.env` → Mac'te `compose-denetle` bulut kipi (sunucunun `.env`iyle) yeşil → `postgres` → `backend` (`migrate deploy`) → `yedek` → `kenar` | Denetim yeşil · `/health/yerel` (konteyner içinden) `UP` |
| 8 | İlk veri ve hesaplar | Bulut kipinde seed bilinen parola ÜRETMEZ. `ilk-yonetici` aracı müşterinin yöneticisini rastgele 16+ karakterli geçici parola ve zorunlu değişimle yaratır; parola yalnız TTY'ye ve teslim kâğıdına yazılır. Satıcı hesabı `superadmin:kur` ile (`ssh -t` + `docker compose exec -it`; TTY şartı). `company.name` yalnız veriye yazılır | Hesaplar var · seed parolası yok |
| 9 | Duman (dışarıdan) | CF üzerinden `/health` 200 ve 6 alan · Mac'ten köke doğrudan 443 → bağlantı reddi · `/health/yerel` dışarıdan 404 · API yanıtında `Cache-Control: no-store` · `/api/discovery/*` 404 | Herhangi biri → DUR, DNS kaydı geri alınır |
| 10 | Lisans | Etkinleştirme kodu teslim kâğıdına yazılır. **Kabul ve etkinleştirme müşteri yetkilisinin ilk girişinde, panelde yapılır.** Sözleşmeyi müşteri adına biz kabul edemeyiz (sistem hesabıyla kabul açık bir denetim bulgusudur). `--devam` etkinleşmeyi ölçer. Konteynerde parmak izi F1 + F5'tir; K8 "zayıf tanıma" BARINDIRILAN kurulumda portalda kurulum açılırken bir kez onaylanır | `durum = ETKIN`, kip ve kademe beklenen |
| 11 | Patron bulutu | HAK `patron-bulut` taşıyorsa patronda tesis kaydı ve ilk tesis yöneticisi daveti (`patron/sunucu/scripts/tesis.ts`). Eşitleme fabrikadakiyle aynı yoldan kendiliğinden başlar (B1 sınıf kapısı genişlemesi ön koşul) | Patronda ilk paket alındı |
| 12 | Kayıt | Satıcı kurulum kaydına: VDS IP, sağlayıcı, alt alan, Origin sertifikası bitişi, betik sürümü. `docs/ops/SUNUCU-ENVANTERI.md` satırı. Gözcü listesi (veriden). Teslim kâğıdı: adres, ilk yönetici, etkinleştirme kodu, **müşteri yedek anahtarı (kâğıt ve USB)** | Gözcü ilk yeşil turu |

**Geri alma (kurulum yarıda):** müşteri verisi doğmadan önce yıkıcı geri alma serbesttir: DNS kaydı (ilk) → Origin sertifikası iptali → VDS'in sağlayıcı panelinden sıfırlanması. Müşteri ilk kaydı girdikten sonra kök kural geçerlidir: geri alma yedekten restore'dur. **Süre hedefi:** insan adımı yalnız 0 (portal) ve 12 (teslim); betik ~30–45 dk, çoğu bekleme. `--geri-yukle` aynı akışı koşar, adım 8'de boş şema yerine şifreli dökümü yükler (VDS kaybı ve taşıma, §5.4).

## 3. Bulut sınıfının açtığı güvenlik kuralları

**Tek kaynak:** `bulutSinifi()` = kurulum beyanı (`TEKSERP_KURULUM_TURU=bulut`, kurulum betiği yazar) **VEYA** geçerli HAK'ın sınıfı `BARINDIRILAN`. İkisinden biri yeterlidir. Böylece kurallar etkinleştirmeden önce de sert olur. Beyan "fabrika", HAK "BARINDIRILAN" derse yine sert kurallar uygulanır ve uyarı düşer. Yüklem tek bir yardımcıda yaşar. Başka yerde `sinif === "BARINDIRILAN"` karşılaştırması yasaktır, AST bekçisi ölçer (B1). Kurallar **sınıftan türer, profil bayrağından değil**: kapatılamaz, panelde kilitli görünür. Fabrika kurulumunda yüklem yanlıştır ve bugünkü davranış aynen kalır ("yeni davranışın varsayılanı bugünkü davranış" kuralı).

| # | Kural (bulutta) | Fabrika kurulumunda bugün | Denetim bağı |
|---|---|---|---|
| R1 | Köken yalnız Cloudflare IP'lerine açıktır, TLS'te AOP istemci sertifikası şarttır, SSL kipi Full (strict) olur. Doğrudan erişim bağlantı düzeyinde reddedilir | LAN'da HTTP 4000; gelen port açılmaz | G14 |
| R2 | Taşıma yalnız HTTPS. HSTS ve en az TLS 1.2 (Cloudflare). Tablet sürüm paketinde açık metin trafiği kapalıdır (manifest + ağ güvenlik yapılandırması) ve bulut adresine İNTERNET kipinde bağlanır: izinli üst alandaki ad, sistem güven deposu + ad eşleşmesi, 443, kullanıcı CA'sı hariç (`TABLET-GENEL-CA-BAGLANTI.md`, vc61+). Panel adresi `https` olmak zorunda | Tablet: şifreli + sabitli (LAN TLS, 4443) | G21 |
| R3 | İstemci IP'si yalnız beyanlı vekilden (kenarın sabit adresi) `CF-Connecting-IP` ile okunur. Başka kaynaktan gelen başlık yok sayılır | `CLIENT_IP_HEADER` yalnız beyanlı vekilde (aynı kural, farklı değer) | G14 |
| R4 | Genel hız sınırı açıktır. IPv6 anahtarı /64'tür. Tablo tavanlıdır, en eski atılır. **Fabrikanın bütün cihazları tek NAT IP'sinin arkasındadır:** IP tavanı geniş tutulur, asıl sınır hesap + cihaz ikilisidir. Giriş kilidi DB'de kalıcıdır, süreç yeniden başlayınca sıfırlanmaz | Genel sınır kapalı, kilit bellekte | G15 |
| R5 | Cihaz onayı zorunludur (`devicePairingRequired` bulutta sabit `true`, yazılamaz). Onayda cihaza ≥ 256 bitlik **cihaz sırrı** verilir. PIN, kart, personel listesi ve indirme belirteci istekleri cihaz kimliğiyle birlikte sırrı da taşır; DB'de sırrın yalnız özeti durur | Bayrak varsayılan kapalı; cihaz kimliği yalnız `x-device-id` başlığı | G21 |
| R6 | PIN ve kart özetli saklanır (her kurulumda, K-B6). Deneme sınırı hesap + cihaz başına (5 hata → 15 dk, artan). Yeni kart kodu ≥ 128 bit rastgeledir; bulutta kısa ya da eski kart kodu kabul edilmez | Özet aynı (G21-K). Kısa kodlar geçiş süresince kabul edilir | G21 |
| R7 | Kimliksiz uçlar daralır: personel listesi (`/api/auth/mobile-users`) ve giriş yöntemleri onaylı cihaz ister. Keşif uçları (`/api/discovery/*`) ve mDNS ilanı kapalıdır (404 / iş başlamaz). Public `/health`in donmuş 6 alanı aynen kalır, `/health/yerel` yalnız döngü adresine açıktır | Açık (LAN keşfi: `Teks-Erp/src/services/discovery.service.ts`, `Teks-Erp/src/jobs/mdns-advertiser.job.ts`) | G21 |
| R8 | JWT sırrını kurulum betiği üretir (64 bayt). Örnek ya da sızmış değerler ret listesiyle reddedilir. İzinler kullanıcı satırından tazelenir. Rotasyon prosedürü runbook'tadır | Ret listesi her kurulumda (çekirdek, G20 dilimi) | G20 |
| R9 | Bilinen parolalı seed yoktur. İlk yönetici rastgele parolayla ve zorunlu değişimle doğar. Parola politikası en az 10 karakterdir | Windows kurulumu bugünkü gibi; Docker seed'inin sabit parolası her yerde kalkar | G20 |
| R10 | Backend'in yerel ağ çıkışı kapalıdır (§1.3). Arka uçtan ağ yazıcısına RAW TCP (`label.nativeSendEnabled`, `Teks-Erp/src/services/helpers/printer-transport.ts`) ve ağ kantarı/metre bulutta **yazılamaz ve çizilmez**. Etiket panelden ya da tabletten basılır. Yazıcı IP'si özel aralık denetiminden geçer (SSRF) | Opt-in açık | — |
| R11 | Panelde ve tablette sunucu adresi elle yazılır ya da panelin QR'ından gelir; tablet tek ortak Play paketi olduğu için adres pakete GÖMÜLMEZ. Alan adı kanal kaydından (T1) türer. Adres değişikliği onaylıdır: tablette kaldır + yeniden ekle (kip kayda yazılı, kurulum kimliği değişirse bağlanmaz) | Keşif + elle adres | G21 |
| R12 | API yanıtlarında `Cache-Control: no-store`. Cloudflare'de host için önbellek BYPASS kuralı | Gerek yok | — |
| R13 | Yönetim erişimi yalnız 2222'den ve yalnız anahtarla yapılır (parola girişi kapalı, `MaxAuthTries 3`, `AllowUsers` tek hesap, fail2ban; K-B10). Müşteriye kabuk yoktur. Destek amaçlı veri erişimi yalnız müşteri talebiyle olur ve kayda geçer (patron destek kalıbı) | Tailscale (bugün) | G1 · G2 |
| R14 | Gece şifreli yedek ve başka sağlayıcıdaki kopya **zorunludur**. Yapılandırılmamışsa kurulum bitmiş sayılmaz ve sağlık özeti kırmızı olur | İsteğe bağlı | — |
| R15 | Sırlar VDS'te doğar. `.env` root 0600'dür. Origin CA özel anahtarı VDS'ten çıkmaz. Hiçbir sır Mac'e, loga ya da kurulum durum dosyasına girmez | Sır hijyeni (çekirdek, aynı) | G22 |

Bulut sınıfının **değiştirmediği** çekirdek kurallar: lisans kapısı aniden durdurmaz ve veri erişimi her kademede açıktır · internet kesintisi lisansı kısaltmaz · iki adımlı giriş bulutta da isteğe bağlıdır (2026-09-30 kararı, bulut için K-B15 ile teyit edildi; açığı R4–R6 kapatır) · audit yalnız ayak izidir · tek backend süreci vardır.

## 4. Docker güncelleyicisi

> **Yerini alan plan (2026-10-08):** bu bölüm ve dilim B4, `docs/design/GUNCELLEYICI-SAGLAMLIK.md`in L-dilimleriyle uygulanır. Oradaki farklar bağlayıcıdır: Linux paketi ayrı ürün yolundan (`/<grup>/backend-oci/`, gruplar platformlar arası ortak olduğu için) · GECIS `.env` değil `current` sembolik bağı (compose sürümle imzalı gelir) · göç imaj açılışında değil yalnız güncelleyicinin `GOC` adımında.

### 4.1 Ortak sözleşme (Dağıtım v2)

Bulut güncelleyicisi, Dağıtım v2'nin **aynı sözleşmesine** bağlanır: `tekserp-surum` bildirimi (PAKET imzalı) · kanal bağı · kiranın `guncelleme` politikası (OTOMATIK · ONAYLI · DONDUR, pencere, sabitleme; K1 her şeyi ezer) · tek karar fonksiyonu `decideUpdate` · yoklamadaki güncelleme raporu · panelin "Sistem → Sunucu Güncellemeleri" ekranı · onay ucu ve niyet dosyası (yetki DEĞİL) · ortak test vektörleri. Satıcı ve portal tarafında yeni bir şey gerekmez, kurulum geçmişi ve filo görünümü aynen çalışır. Politika müşteri başına portalda ayarlanır, varsayılanı bugünkü `defaultUpdatePolicy()` (ONAYLI) kalır (K-B14).

### 4.2 Sözleşme eki (sürüm 5, yalnız ekler)

| Alan | Bugün | Ek |
|---|---|---|
| `platform` | `UPDATE_PLATFORMS = ["win32-x64"]` | `linux-x64-oci`. Bildirimin platformu kanal kaydındakine eşit olmalıdır. Eski doğrulayıcı bu değeri tanımaz; bu yalnız Linux kanalında yayımlandığı için zararsızdır |
| `paket` | zip + paket içi `butunluk.jws` | Teslim paketi tar'ı: imaj (`docker save`) + `docker-compose.yml` + `.env.ornek` + `PAKET-DOCKER.json.jws` (bugünkü Docker teslimi, `docs/ops/LINUX-DOCKER-KURULUM.md` §8) |
| `imaj` (yeni, isteğe bağlı) | — | `{kimlik: <config özeti>, etiket}`. Yalnız `linux-x64-oci`de zorunludur |
| `pg.hedef` | KENDI kipte PG zip'i | Kip `KONTEYNER`: hedef = PostgreSQL imajının tar'ı + özeti. Küçük sürüm otomatik, ana sürüm yalnız runbook'la (aynı ilke) |
| `runtime` | `{node}` | Aynen (imajın Node'u) |

Tek kaynak yine `protocol/guncelleme*.ts` dosyalarıdır (w2). Rust aynası ve vektörler aynı commit'te iner (çekirdek kural).

### 4.3 Doğrulama zinciri (yükten önce)

1. Bildirim JWS'i → kanal → anahtar kümesi (sınıf süzgeci: hazırlık PAKET anahtarı BARINDIRILAN'a giremez, G3).
2. İndirilen paketin boyu ve sha256'sı = bildirimdeki.
3. Paket içi `PAKET-DOCKER.json.jws` → imzalı liste → listedeki her dosyanın özeti.
4. `docker load` → yüklenen imajın config özeti = `imaj.kimlik`. Değilse imaj silinir (`PAKET_BAGI`).
5. İmaj içi bütünlük listesi açılışta ve günlük olarak native çekirdekte doğrulanır (G13, uygulandı 2026-10-08 — LINUX-DOCKER §8 son madde): imza `imaj-imzala.mjs` ile ince son katmanda (`/app/butunluk-liste.txt` + `butunluk-zincir.jws`/`butunluk.jws`, label `tr.tekserp.butunluk`), imzalı etiket yalnız imajın kendi çekirdeğiyle öz-denetim `GECERLI` ise kalır; yükleyici zincirli listeyi kök çapasıyla okur. Teslim yalnız imzalı imajla; açık borç: Docker derlemesinin kayıtlı kökeni (üretim imzası bugün `--ci-atla` cümlesi ister).

### 4.4 Adımlar (Windows §8'in karşılığı)

| # | Adım | Linux/Docker işi | Telafi |
|---|---|---|---|
| 1 | `BACKEND_DURDUR` | Plan çalışırken ölçülür (önceki etiket, göç sayısı, lisans görüntüsü) → `compose stop backend` · kenar bakım sayfası (503) döner | Eski etiketle başlat + sağlık |
| 2 | `YEDEK` | `yedek` konteyneriyle `pg_dump -Fc` → doğrulama → `.tkenc`. Alıcılar: kurulumun alıcıları + işleme özgü geçici anahtar (konakta root 0600; Windows'taki DPAPI'nin karşılığı) | — |
| 3 | `GECIS` | Compose `.env` içindeki `TEKSERP_IMAJ` eskiden yeniye (geçici dosya + atomik ad değiştirme) | Eski etiket |
| 4 | `GOC` | Yeni imajla `compose run --rm backend` göç komutu (30 dk tavan) | Göç DB'yi değiştirdiyse: geçici anahtarla çöz → `public` şeması sıfırla → `pg_restore` → göç sayısı = önceki (aynı ölçü) |
| 5 | `DOGRULAMA` | Backend yalnız `veri` ağında, kenar kapalıyken başlar → konteyner içinden `/health/yerel` | Durdur |
| 6 | `BASLAT` | Normal başlatma + kenar açılır → sürüm ve DB sağlığı | Durdur |
| 7 | `ONAY` | Kurulum geçmişi + `gecmis.jsonl`. Bir önceki imaj kalır, daha eskiler silinir. Son 3 güncelleme yedeği kalır. Kendini güncelleme (§4.5) | — |

İşlem günlüğü, yarımda kalan işin sürdürülmesi, kilit ve "her son durumda tek backend + uyumlu şema" değişmezi w2 §7 ile aynıdır. Kesinti beklentisi: göçsüz sürümde 1–2 dk, göçlü sürümde göç süresi kadar. Bu süre, pencere politikasıyla gece saatine konur.

### 4.5 Konum ve kendini güncelleme

Güncelleyici konakta systemd hizmeti olarak çalışır (`Restart=always`), aynı Rust crate'in Linux arka ucudur (T2, yönetici onaylı). Dosya düzeni ve IPC Windows'takinin aynısıdır: `/var/lib/tekserp/guncelleme/{durum,niyet,is}`. Backend `durum/`u salt okunur bağlar, `niyet/`e yazar. Dosya adları ve biçimleri w2 §5 ile aynıdır. Güncelleyici ikilisi paketin içinde gelir; kendini güncelleme w2 §10'daki A/B şemasını izler (`.eski` ikili, 3 açılış sayacı). İşletim sistemi yamaları güncelleyicinin işi değildir (§1.4).

## 5. Yedek, başka sağlayıcıda kopya ve geri yükleme tatbikatı

### 5.1 Katmanlar

| Katman | Ne | Nerede | Saklama |
|---|---|---|---|
| Canlı | PostgreSQL birimi | Müşteri VDS'i | — |
| Gece yedeği | `pg_dump -Fc` → `pg_restore --list` doğrulaması → `.tkenc` (`docs/ops/YEDEK-SIFRELEME.md` biçimi) | VDS, `yedek` birimi | 30 gün, en yeni 3 kopya asla silinmez |
| Güncelleme öncesi | §4.4 adım 2 | VDS, güncelleyici dizini | Son 3 |
| Başka sağlayıcı | Aynı `.tkenc` dosyası, `rclone copy` (sync değil) ile SFTP | **Yedek deposu VDS'i** (Türkiye, müşteri VDS'lerinden farklı sağlayıcı, bütün bulut müşterilerine ortak; K-B11) | 30 gün günlük + 12 ay aylık (`docs/ops/YEDEK-VPS-KURULUM.md` kalıbı) |

**Fidye yazılımına karşı direnç:** müşteri VDS'inin depodaki hesabı kabuksuz ve chroot'ludur, yalnız kendi `gelen/` dizinine yazabilir. Silemez ve arşivi göremez. Arşivi depodaki root zamanlayıcısı **kopyalar** (taşımaz). Depo ele geçirilirse içerik yine şifrelidir, çünkü çözme anahtarları depoda durmaz. Depo da §1.4 sertleştirmesinden geçer ve gözcünün listesine girer.

**Sağlayıcı kuralı:** iki paket iki ayrı sağlayıcı anlamına gelebilir. Deponun sağlayıcısı, müşteri VDS'lerinin **hiçbirinin** sağlayıcısı olamaz. Kurulum betiği adım 0'da kanal kaydındaki sağlayıcıyı deponunkiyle karşılaştırır; aynıysa DURUR.

**Alıcılar (üç):** `musteri` (özel yarı müşteride, kâğıt + USB; "verilerimi al" hakkı) · `etkili` (bizim çevrimdışı anahtarımız; VDS kaybında geri yükleme bununla yapılır) · `yerel` (VDS'te, bizim kasadaki parolayla sarılı; rutin önizleme ve tatbikat için).

### 5.2 İzleme

Yedek yaşı ve makine dışı kopyanın durumu zaten sağlık özetindedir (`yedek.hukum`, `yasSaat`, `offsite.ok`, `eksikSayisi`). Eşikleri satıcı uygular (§1.5). Depo kendi `DURUM.txt` dosyasını üretir. Gözcü depo için yalnız canlılık ölçer.

### 5.3 Tatbikat

| Ne | Sıklık | Nasıl | Kayıt |
|---|---|---|---|
| Yerel geri yükleme (Faz A) | Aylık, otomatik | VDS'te son yedek geçici bir DB'ye (`tekserp_tatbikat`) açılır → göç sayısı + satır sayıları canlıyla karşılaştırılır → geçici DB silinir (`docs/ops/YEDEK-GERI-YUKLEME-TATBIKATI.md` Faz A) | Sağlık özetine yeni sayaç; satıcıda "tatbikat yaşı > 35 gün" uyarısı |
| Depodan geri yükleme | Üç ayda bir, insan | Depodaki kopya `etkili` anahtarıyla bizim test makinemizde açılır, aynı karşılaştırma yapılır | Tatbikat tablosu (süre, boyut, sonuç) |
| VDS kaybı | Altı ayda bir + ilk müşteriden önce | Boş test VDS'ine `kur.mjs --geri-yukle` → lisans taşıma → panel bağlanır | Ölçülen RTO sözleşmeye girer |

### 5.4 RPO ve RTO (ölçülmemiş hedef; sözleşmeye yalnız ölçülmüş sayı girer)

| | Hedef | Dayanak |
|---|---|---|
| RPO | ≤ 24 saat | Gece yedeği. Güncelleme öncesi yedek ek bir geri dönüş noktasıdır |
| RTO, DB bozulması (VDS sağlam) | 30–60 dk | Yerel yedekten restore |
| RTO, VDS kaybı | 2–4 saat | Yeni VDS + betik + depodan döküm + lisans taşıma (yeni parmak izi; satıcı taşıma akışı) + DNS. Yeni VDS'in teslim süresi pakete ve sağlayıcıya göre değişir |

## 6. Kök CLAUDE.md istisna cümlesi (öneri)

**Bugün** (Kapılar ve sözleşme): "Fabrika sunucusuna GELEN port açılmaz (eski tünel 2026-09-30'da emekli) — dışarıyla tek bağ fabrikanın ÇIKAN imzalı kanallarıdır."

**Öneri:** "Fabrika sunucusuna GELEN port açılmaz; dışarıyla tek bağ fabrikanın ÇIKAN imzalı kanallarıdır. **Tek beyanlı istisna BARINDIRILAN sınıfıdır (bulut kurulum):** bizim yönettiğimiz VDS'te yalnız 443, yalnız Cloudflare kaynak adreslerinden ve Cloudflare istemci sertifikasıyla açılır; sınıfın sert kuralları sınıftan türer, kapatılamaz; yönetim SSH'ı yalnız 2222'de ve yalnız anahtarla açılır — `docs/kurallar/<bulut alanı>`."

Avukat H3'te Cloudflare'siz yolu gerektirirse, cümlenin "yalnız Cloudflare kaynak adreslerinden…" kısmı §7.1'deki kipe göre yeniden yazılır.

Aynı iniş commit'inde gelecekler (B0): `docs/kurallar` altında yeni alan dosyası `bulut-kurulum` (§3 tablosundaki her satır tek kural cümlesine ve bekçi adına dönüşür) · alan dizinine satır · arşive tarihli `[ÇEKİRDEK]` (sınıf yüklemi, istisna) ve `[PROFİL]` (eşik sayıları, sağlayıcı) etiketli not · `docs/kurallar/kesif-cihaz.md` ve `docs/kurallar/genel.md` içindeki ilgili cümlelere bulut ayrımı.

## 7. Sözleşme ve hukuk notları (avukata gidecek maddeler)

Taslaklar `docs/hukuk/` altında "avukat onayı bekliyor" damgasıyla yazılır (B10). Mevcut belgelerin genişletilmesi: `docs/hukuk/SON-KULLANICI-LISANS-SOZLESMESI.md`, `docs/hukuk/BAKIM-DESTEK-SOZLESMESI.md`, `docs/hukuk/VERI-ISLEME-EKI.md`, `docs/hukuk/KABUL-METNI.md`. Yeni belge: **Barındırma Hizmet Eki** (SLA dahil).

| # | Madde | Taslağın varsayımı | Avukata soru |
|---|---|---|---|
| H1 | İnternet kesintisi | Müşteri tarafındaki internet kesintisi hizmet kesintisi sayılmaz, S1 olmaz. Yedek internet tavsiye edilir. Kesintisiz üretim isteyene fabrika kurulumu önerilir (K-B2) | İfade sorumluluğu yeterince sınırlıyor mu? Kesinti yüzünden üretim kaybı talebine karşı dayanak |
| H2 | Erişilebilirlik | Hedef pakete göre ayrı yazılır (K-B13): **Kurumsal** ayda %99,5, kademeli telafiyle · **Standart** sağlayıcı SLA'sı olmadığı için "en iyi çaba", düşük kademeli ya da telafisiz. Planlı bakım penceresi önceden duyurulur. Acil güvenlik yamasında plansız pencere hakkı saklıdır | Telafi kademeleri ve üst sınır; iki paketin farkı sözleşmede nasıl yazılır |
| H3 | Veri konumu ve **Cloudflare** | VDS ve yedek deposu Türkiye'dedir. **Ancak bütün ERP trafiği Cloudflare kenarında açılıp yeniden şifrelenir** (ABD merkezli şirket). Bu, patron bulutu ekindeki §6.3 sorusunun aynısıdır, ama burada kapsam bütün iş verisi ve çalışan adlarıdır | KVKK md. 9 kapsamında aktarım sayılır mı? Standart sözleşme yeterli mi? K-B3 ile çelişki var mı? Dayanak kurulamazsa §7.1 |
| H4 | Roller | Müşteri veri sorumlusu, biz veri işleyeniz. VDS sağlayıcısı, yedek deposu sağlayıcısı ve Cloudflare alt işleyendir (adlı liste, değişiklikte 30 gün önce bildirim) | Sağlayıcı sözleşmelerinin KVKK yeterliliği |
| H5 | İşleten sorumluluğu | İşletim sistemi, yama, yedek ve izleme bizdedir. Sorumluluk son 12 ayın ücretiyle sınırlıdır, dolaylı zarar hariçtir. Veri kaybı RPO ile sınırlıdır | Sağlayıcı arızası mücbir sebep sayılır mı? |
| H6 | Erişim ve gizlilik | Personelimiz veriye yalnız talep ya da olay üzerine erişir, erişim kayda geçer, yazılı gizlilik yükümlülüğü vardır | — |
| H7 | Ödeme gecikmesi | Askıya alma kısıtlı kip demektir: okuma, rapor ve dışa aktarma açık kalır, **sunucu kapatılmaz** (çekirdek kural: veri erişimi her kademede açık) | Bulutta sunucu maliyeti sürerken bu yükümlülüğün süresi |
| H8 | Fesih, iade, imha | Fesihte şifreli döküm müşteri anahtarıyla teslim edilir. 30 gün sonra VDS ve depo kopyaları imha edilir, imha tutanağı tutulur | Saklama süresi ve ispat |
| H9 | İhlal bildirimi | 72 saat (`docs/hukuk/VERI-IHLALI-BILDIRIM-PROSEDURU.md`) | — |
| H10 | Lisans metni | "Kurulum ve tesis" kavramı bulutta VDS'e karşılık gelir. Kabul metninde sınıf listesine "Barındırılan" eklenir. "Saatte bir bağlanır" cümlesi bulutta "5 dakikada bir" olur | Metin farkının kabul kaydına etkisi |

### 7.1 H3'e bağlı alternatif: Cloudflare'siz doğrudan TLS

Yalnız avukat, Cloudflare kenarındaki TLS açılımını dayanağı kurulamayan bir yurt dışı aktarımı sayarsa devreye girer. Kod değişmez; değişen yalnız kenarın kipi ve Cloudflare ayarlarıdır (kenar yapılandırmasında ikinci kip `dogrudan`). B5 bu kipi tasarım olarak taşır, uygulanması ~1 gün sürer, ek para gerektirmez.

| Konu | Cloudflare kipi (bugünkü tasarım) | Doğrudan kip |
|---|---|---|
| DNS | A kaydı, proxy açık | A kaydı, **yalnız DNS** (gri bulut). Köken IP'si herkese görünür |
| Sertifika | Cloudflare Origin CA | Let's Encrypt, ACME **HTTP-01**. Port 80 yalnız `/.well-known/acme-challenge/` için açılır, gerisi 443'e yönlenir. Yenileme konakta zamanlayıcıyla yapılır. DNS-01 seçilmez, çünkü Cloudflare API belirtecinin VDS'te durması gerekirdi |
| Gelen 443 | Yalnız CF IP'leri + AOP | Herkese açık. AOP ve IP listesi kalkar |
| Hız sınırı / bot | Cloudflare + köken | Yalnız köken: nginx `limit_req` + backend R4. İstemci IP'si doğrudan soketten okunur (R3'ün değeri değişir) |
| DDoS | Cloudflare | Yalnız sağlayıcının temel koruması. **Kabul edilen risk** |
| HSTS / TLS sürümü | Cloudflare | nginx |
| İstemciler | Değişmez | Değişmez (genel CA sertifikası, aynı adres) |
| Kurallar | R1 · R3 · R12 bugünkü hâliyle | R1 "yalnız 443 (+ ACME için 80)", R3 soket adresi, R12 yalnız `no-store` olur. §6'daki istisna cümlesi buna göre yeniden yazılır |

## 8. Maliyet

Kural: kalıcı işletim yükü getiren seçenekte para (tek sefer + aylık), iş (gün) ve işletim (saat) sayıyla yazılır, ölçeğe göre hesaplanır. Fiyatlar KDV hariçtir ve 2026-10 sağlayıcı sayfalarından alınmıştır; **teklif alınarak doğrulanacak** (kaynaklar: https://www.vulut.com/blog/vds-fiyatlari-ve-satin-alma-rehberi · https://www.karekod.org/blog/vds-fiyatlari/ · https://www.natro.com/sunucu-kiralama/vds-sunucu · https://www.whtop.com/plans/turhost.com/135431).

### 8.1 Müşteri başına, iki paket (K-B13)

| Kalem | Standart | Kurumsal | Not |
|---|---|---|---|
| VDS, 2 vCPU · 4 GB · 40–80 GB NVMe (aylık) | 145–250 TL (planlama **200 TL**) | 600–1.200 TL (planlama **800 TL**) | En büyük sahamızda DB 33 MB, döküm ~10 MB; 4 GB yeterli. Büyük müşteri (4 vCPU · 8 GB): standart ~250 TL, kurumsal 25–37 USD |
| Sağlayıcı SLA'sı ve desteği | Yok ya da sınırlı | Var (destek hattı, yedekli altyapı) | Bizim erişilebilirlik taahhüdümüz pakete göre yazılır (H2) |
| Yedek deposu payı (aylık) | 15–40 TL | 15–40 TL | Müşteri başına ~0,5–1 GB (30 günlük + 12 aylık); 10 müşteri paylaşırsa |
| Cloudflare | 0 | 0 | Ücretsiz plan: Origin CA, Universal SSL (birinci düzey alt alan), AOP, önbellek ve yapılandırma kuralları. Pro gerekirse bölge başına 20–25 USD, bütün müşteriler için tek |
| İzleme ve bildirim | 0 | 0 | Mevcut altyapı (Resend ücretsiz katmanı, Telegram) |
| Kurulum işçiliği (tek sefer) | 1,5–2 sa | 1,5–2 sa | Betik aynı ve sağlayıcıdan bağımsız. Teslim ve eğitim hariç |
| İşletim işçiliği (aylık) | 2–3 sa | 1,5–2,5 sa | Uyarı inceleme, aylık tatbikat kaydı, güncelleme penceresi takibi, olay payı. Ekonomik sağlayıcıda arıza ve destek bekleme payı daha yüksek (tahmin) |
| **Doğrudan aylık** | **≈ 215–240 TL + 2–3 sa** | **≈ 815–840 TL + 1,5–2,5 sa** | |

Fiyatlama tabanı için bilgi: aylık bulut bedeli ≥ VDS + depo payı + işletme saati + %20 risk payı. İki paket arasındaki fark yalnız sağlayıcıdır; yazılım, kurulum ve güvenlik kuralları aynıdır.

### 8.2 Ortak ve ölçek

| Kalem | Aylık | Not |
|---|---|---|
| Yedek deposu VDS'i (başka TR sağlayıcı, 2 GB · 100–200 GB) | 150–400 TL | ~50 müşteriye kadar tek depo yeter |
| Test VDS'i (prova, §9 B11) | ~200 TL, 1 ay | Standart paket sağlayıcısında; prova bitince kapatılır |
| Tailscale | 0 | Bulut VDS'leri için gerekmez (K-B10) |

| Ölçek | Hepsi standart (aylık) | Hepsi kurumsal (aylık) | İşletim | Yorum |
|---|---|---|---|---|
| 1 müşteri | ~600 TL (depo dahil) | ~1.200 TL (depo dahil) | 2–3 sa | Depo maliyeti tek müşteriye düşer |
| 10 müşteri | ~2.300 TL | ~8.300 TL | 15–30 sa | Doğrusal |
| 50 müşteri | ~10.800 TL | ~41.000 TL | 75–150 sa (≈ yarım kişi) | Bu eşikte çok kiracılı model (`docs/design/SAAS-TASARIM.md`) ve işletim otomasyonu yeniden tartılır |

**Geliştirme (tek sefer):** §9 toplamı ≈ 28–34 iş günü; paralel ajanlarla takvimde 2,5–3 hafta. **Maliyetsiz alternatif** diğer satış modelidir: fabrika kurulumunda donanım ve internet müşteridedir, bizim aylık doğrudan maliyetimiz 0'dır. Dış izlemede kendi gözcümüz seçildi (K-B12; ~1 gün iş, 0 TL). Üçüncü taraf hizmet (0–10 USD/ay) yurt dışı bağımlılık getirdiği için seçilmedi.

## 9. Uygulama dilimleri

Bağımlılık: Dağıtım v2 (w2 iniş + D8) · lisans v2 (L2-10 parmak izi, G12 merdiveni) · G3 (çapa ayrımı) · G13 (imaj içi bütünlük) · G14 (bölge Full strict) · G20 · G21-K **önce** iner. Her dilim ayrı worktree'de, kendi `_test` DB'siyle çalışır. Testler hedefli koşulur, tam paket faz inişinde koşar. Model kullanıcı tercihi gereği Opus'tur.

| # | Dilim | İçerik | Bağımlı | Dosyalar (yeni olanlar uzantısız) | Bekçiler | Süre | Efor |
|---|---|---|---|---|---|---|---|
| B0 | Kural ve karar | §6 cümlesi · alan dosyası · arşiv notu · dizin satırı · RECETELER'e "yeni bulut müşterisi" reçetesi | — | kök CLAUDE.md · `docs/kurallar` · `docs/RECETELER.md` · arşiv | `check-docs` | 0,5 g | düşük |
| B1 | Sınıf tek kaynağı | Protokolde `CLOUD_SENDER_CLASSES = [URETIM, BARINDIRILAN, DEMO]` (DEMO: karar 2026-10-03, HAK'ta `patron-bulut` varsa; üç projede bayt-eşit ayna) · backend `bulutSinifi()` · eşitleme ön koşulu (`Teks-Erp/src/cloud-sync/eligibility.ts`), patron `installation-auth` ve satıcı zil hedefi aynı sabite bağlanır · panel/tablet sınıf rozeti | Lisans v2 inişi | `Teks-Erp/src/lib/bulut-sinifi` · `protocol/belgeler.ts` · patron/satıcı aynaları | yeni `test_bulut_sinifi_tek_kaynak` (AST: başka `BARINDIRILAN` karşılaştırması yok; iki sondalı) · `test_lisans_protokol_aynasi` · eşitleme ön koşulu testleri · patron `test_patron_kapila*` | 1,5 g | yüksek |
| B2a | Kimlik sertleştirmesi (backend) | R4–R9, R12: cihaz sırrı (onayda üretim, özet, istek doğrulama) · `devicePairingRequired` sınıfa kilitli · kimliksiz uçların daralması · keşif/mDNS kapanması · IPv6 /64 hız sınırı + DB'de kalıcı kilit · seed bulut kipi + `ilk-yonetici` · `no-store` | B1, G20, G21-K | `Teks-Erp/src/services/device.service.ts` · `Teks-Erp/src/services/auth.service.ts` · `Teks-Erp/src/middlewares/auth.middleware.ts` · göç (yalnız ekler) | yeni `test_bulut_kimlik` (her R için negatif + pozitif sonda) · `test_superadmin*` · `test_discovery_identity` · `test_db_invariants` | 3–4 g | çok yüksek |
| B2b | Kimlik sertleştirmesi (panel + tablet) | Cihaz sırrının güvenli depoda tutulması (Electron `safeStorage`, Android Keystore) · https zorunluluğu · bulut APK profili (açık metin kapalı) · adres değişimi onayı. "Eski istemci ne yapar": bulut yalnız yeni kurulumdur, eski istemci bağlanmaz; fabrikada sır istenmez | B2a | Electron güvenli depo + api istemcisi · mobil HAL/oturum · `build-apk` profili | Electron vitest · mobil jest · `test_mobil_enum_aynasi` | 2 g | yüksek |
| B3 | Arka uç LAN özellikleri | R10: ağ yazıcısı/kantar bayrakları bulutta çizilmez ve yazılamaz · yazıcı IP'si için özel aralık denetimi (kod katmanı; konak katmanı B5'te) | B1 | `printer-transport` · bayrak kataloğu · panel ayar ekranı | `test_bulut_lan_kapali` · bayrak reçetesi bekçileri | 1 g | yüksek |
| B4 | Linux güncelleyici | Sözleşme 5 (§4.2) + vektörler · Rust Linux arka ucu (compose, imaj yükleme, geçici anahtar) · `backend-yayinla.mjs --platform` · backend IPC kökü Linux yolu · Worker kapsamına Linux paketi | w2 iniş, D8 | w2 `native/tekserp-guncelleyici` · `protocol/guncelleme*` · `deploy/backend-yayinla.mjs` · `deploy/guncelleme-sunucusu/worker` | `test_guncelleme_protokol` (vektör) · cargo testleri (+ Linux senaryoları) · `test_backend_yayin` · `test_indirme_kapisi` | 5–7 g | çok yüksek |
| B5 | Bulut compose + kenar + konak | `deploy/bulut/`: compose, nginx (mTLS + gerçek IP), ipset/DOCKER-USER betiği + CF IP tazeleyicisi, çıkış kuralları, canlılık zamanlayıcısı, `surumler.json` · `compose-denetle` bulut kipi · AOP plan kapsamının ölçümü | B1 | `deploy/bulut/*` · `deploy/satici/compose-denetle.mjs` (ya da bulut kardeşi) | compose denetimi negatif sondalar · `test_compose_yalitimi` · `test_korumali_imaj` | 3 g | yüksek |
| B6 | Kurulum betiği | `deploy/bulut/kur.mjs`: kuru varsayılan, adım durumu, **sağlayıcıdan bağımsız** (yalnız SSH + temiz Ubuntu), SSH'ın 2222'ye kilitlenmeden geçişi, CF API istemcisi (belirteç 0600 dosyadan), ayrılmış adlar, depo sağlayıcısı kapısı, `--devam`, `--geri-yukle`, geri alma · kanal kaydına `bulut` bloğu (paket dahil) + `check-kanallar` şeması | B5, B4 (imaj yolu) | `deploy/bulut/kur.mjs` · `deploy/kanallar.json` · `scripts/lib/kanallar.mjs` · `scripts/check-kanallar.mjs` | yeni `test_bulut_kur` (sahte CF + sahte SSH ile kuru koşum, her DUR kapısına sonda) · `check-kanallar` | 3–4 g | yüksek |
| B7 | Yedek deposu ve tatbikat | Depo runbook'u (YEDEK-VPS kalıbı, başka sağlayıcı) · konakta kopya zamanlayıcısı · aylık otomatik tatbikat aracı + sağlık özetine sayaç (isteğe bağlı alan, satıcı önce yayınlanır) | B5 | `docs/ops` yeni runbook · `yedek-zamanlayici.sh` · `protocol/uclar.ts` | `test_yedek_sifreleme` · yeni `test_tatbikat_araci` · `test_lisans_yoklama_allowlist` | 2 g | yüksek |
| B8 | İzleme | Satıcıda sınıf başına eşikler + yeni olaylar (`BULUT_ULASILAMIYOR` · `BULUT_DUZELDI` · sertifika vadesi · tatbikat yaşı) · `satici-gozcu` yan konteyneri + `satici_gozcu` rolü (yetki ölçümlü açılış, bildirim rolü kalıbı) · compose denetimine gözcü maddeleri · portal kurulum kartında bulut bilgileri | B1 | `satici/sunucu/src/notifications/*` · `deploy/satici/docker-compose.gozcu.yml` · `deploy/satici/compose-denetle.mjs` · satıcı web | satıcı `test_bildirim_tarama` · yeni `test_gozcu_rolu` · compose denetimi | 3 g | yüksek |
| B9 | Kanal, yayın, belgeler | `docs/ops` bulut runbook'u (kurulum, güncelleme, geri yükleme, VDS kaybı, imha) · SUNUCU-ENVANTERI şablonu · panel/tablet bulut kanal profili | B6 | runbook + envanter | `check-docs` · `check-kanallar` | 1,5 g | orta |
| B10 | Hukuk taslakları | Barındırma Hizmet Eki + SLA · DPA ek maddeleri · kabul metni sınıf satırı (`kabul-metni-uret` ile yeniden üretim) | — | `docs/hukuk/*` | `test_lisans_kabul_metni` | 1 g + avukat | orta |
| B11 | Uçtan uca prova | Kısa süreli test VDS'imizde ("önce kendi sunucumuz"; standart paket sağlayıcısında, ~200 TL): kurulum → panel + gerçek tablet → güncelleme → zorla geri dönüş → yedek kopyası → üç tatbikat → VDS kaybı. En uzun rapor ve dışa aktarma süresi Cloudflare'in 100 sn sınırının altında mı ölçülür. Senaryo "BULUT" (adım başına yeşil/kırmızı + kanıt) | Hepsi | senaryo belgesi | senaryo + tam paket (faz inişi) | 2–3 g | yüksek |

**Kritik yol:** B0 → B1 → B5 → B6 → B11, paralelinde B4 (en uzun parça) ile B2a → B2b. B3, B7, B8, B9 ve B10 B1'den sonra paralel yürür. İlk müşteri B11 yeşil olmadan kurulmaz.

## 10. Kararlar (açık soruların cevapları, kullanıcı 2026-10-01)

| # | Soru | Karar | Belgede |
|---|---|---|---|
| S1 | Yönetim erişimi | **İnternetten port 2222, yalnız anahtar** (tailnet önerisi yerine). fail2ban · `PasswordAuthentication no` · `AllowUsers` · `MaxAuthTries`. Gerekçe: bizim VDS'te parola girişi 2026-10-01 sabahı kapatıldı (30 günde ~12.700 başarısız deneme) | K-B10 · §1.3 · §1.4 · §2 adım 2 · R13 · §6 |
| S2 | Yedek kopyasının yeri | (A) Farklı TR sağlayıcıda ortak yedek deposu VDS'i, her müşteri yalnız kendi dizinine yazar | K-B11 · §5.1 |
| S3 | Dış izleme | (A) Kendi gözcümüz | K-B12 · §1.5 · B8 |
| S4 | VDS sağlayıcı sınıfı | **Müşteri seçer: "Standart" (~150–250 TL/ay) ve "Kurumsal" (SLA'lı, ~600–1.200 TL/ay).** Kurulum betiği sağlayıcıdan bağımsız | K-B13 · §2 · §5.1 · §7 H2 · §8 |
| S5 | Varsayılan güncelleme politikası | (A) ONAYLI | K-B14 · §4.1 |
| S6 | Bulutta iki adımlı giriş | **İsteğe bağlı** (2026-09-30 kararı aynen); yerine hız sınırı, kalıcı kilit, onaylı cihaz | K-B15 · §3 |
| — | Teknik sapmalar T2 (güncelleyici konakta) · T3 (TLS için nginx) | Yönetici onayladı | §0.2 |

**Açık kalan tek konu:** H3 (Cloudflare kenarı, KVKK md. 9) avukattadır. Dayanak kurulamazsa §7.1'deki doğrudan TLS kipine geçilir ve kullanıcıya K-B4'ün yeniden açılması sorulur.
