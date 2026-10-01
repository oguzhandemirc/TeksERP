# Bulut kurulum — müşteriye özel VDS (lisans sınıfı BARINDIRILAN)

> **Durum:** TASARIM (2026-10-01). Kod yazılmadı. Uygulama, bugünkü işler (Dağıtım v2, lisans v2, demofabrika) bittikten sonra başlar; dilim planı §9'da.
> **Bağlayıcı kararlar:** kullanıcı, 2026-10-01 (§0.1). Bu belge onları uygular, değiştirmez. Önerdiği teknik kararlar §0.2'de, yönetici onayına.
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

### 0.2 Bu belgenin önerdiği kararlar (yönetici onayına)

| # | Öneri | Gerekçe |
|---|---|---|
| T1 | Alt alan **kanal kodudur** (`<kanal>.etkiliyazilim.com`). Ayrılmış adlar listesi kurulumu durdurur (`lisans` · `lisans-test` · `portal` · `patron` · `guncelleme` · `www` · `mail` · `send` · `api` · `demo` …) | Müşteri kimliği tek kaynaktan gelir (`deploy/kanallar.json`). Birinci düzey alt alanı Cloudflare'in ücretsiz Universal SSL sertifikası kapsar, `x.y.etkiliyazilim.com` ise ücretli sertifika ister |
| T2 | Güncelleyici, **yan konteyner değil, konakta systemd hizmeti** olarak çalışır (Dağıtım v2'nin Rust güncelleyicisinin Linux arka ucu) | Docker API'ye erişim kök yetkisine eşdeğerdir. Soketi bir konteynere bağlamak, kök yüzeyini konteyner ağına açar. Konak hizmeti, Windows'taki SYSTEM hizmetinin birebir karşılığıdır (§4) |
| T3 | TLS'i `nginx-unprivileged` (özetle sabit imaj) sonlandırır. Traefik kullanılmaz | Tek arka uç için etiket keşfi gerekmez. Traefik'in istediği soket vekili ortadan kalkar. mTLS (AOP) ve gerçek IP çözümü nginx'te yerleşiktir |
| T4 | SSH genel internete kapalıdır. Yalnız tailnet ve anahtar kabul edilir. Acil durum kapısı sağlayıcının konsoludur (soru S1) | 2026-10-01 denetiminin kritik bulgusu (G1) internete açık SSH idi |
| T5 | Bütün imajlar (backend, PostgreSQL, nginx) **bizim CDN'imizden ve imzalı bildirimdeki özetle** gelir. Docker Hub'a çıkılmaz | Tek çıkış hedefi, tek güven zinciri. Kapı İndirme Worker'ıdır |
| T6 | Dış izleme, satıcı VDS'inde **yeni bir en az yetkili yan konteynerle** (`satici-gozcu`) yapılır. Uyarılar mevcut bildirim kanalından (e-posta + Telegram) gider (soru S3) | Bildirim altyapısı zaten var. Üçüncü taraf ve yurt dışı bağımlılık eklenmez |

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
                                                                                              │  SSH yalnız tailnet (genel 22/2222 KAPALI)   │
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
| Gelen diğer | 80, 22, 2222, 4000, 5432 kapalı. SSH yalnız `tailscale0` | ufw varsayılan RED, sshd `ListenAddress` tailnet |
| Çıkan, backend | Yalnız tcp/443 ve sabit iki DNS. Özel aralıklar (RFC 1918, 100.64/10, 169.254/16, VDS'in kendisi) **DROP** | `DOCKER-USER`, `cikis` ağının alt ağı. `deploy/satici/vds/bildirim-cikis.sh` kalıbı |
| Çıkan, postgres / yedek / kenar | YOK (internal ağlar) | compose |
| Çıkan, konak | apt, tailscale, CDN (güncelleyici), depo (SFTP) | — |

Backend'in dışarıya çıkan bütün istekleri kurulum anahtarıyla imzalıdır ve bugünkü kanallardan gider: lisans yoklaması ve zil (`lisans.`), patron eşitlemesi (`patron.`, `Teks-Erp/src/cloud-sync/cloud-url.ts`), indirme belirteci, döviz kuru işi.

### 1.4 Konak sertleştirmesi

| Alan | Ayar |
|---|---|
| Hesaplar | Tek yönetim hesabı (`etkili`): anahtarla girer, `sudo` parola ister, **`docker` grubunda değildir** (G2). Müşteriye kabuk verilmez. `root` doğrudan giremez. Yedek kopya hesabı kabuksuzdur |
| SSH | `PasswordAuthentication no` · `KbdInteractiveAuthentication no` · `PermitRootLogin no` · `AllowUsers etkili` · yalnız tailnet. Tailnet ACL'si: yalnız yönetici cihazları VDS'e; VDS tailnet'te hiçbir yere bağlanamaz (`tag:bulut-vds`) |
| Güncelleme | `unattended-upgrades` yalnız güvenlik yamaları. Yeniden başlatma gerekirse 04:30'da (gece yedeğinden sonra). Yeniden başlatma yoklama sağlık özetiyle görünür |
| Docker | Resmî depodan, sürümü sabit (`deploy/bulut/surumler.json`). `daemon.json`: `json-file` 20 MB × 5 · `ipv6: false` · `userland-proxy: false` · `no-new-privileges: true` · `live-restore: true` |
| Diğer | `fail2ban` (sshd, tailnet'te de ucuz) · `chrony` · `journald` 500 MB tavan · 2 GB swap · `/etc/machine-id` kurulumda tazelenir (sağlayıcı şablonundan kopya kimlik taşımasın, etkinleştirmeden önce) |

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
| 0 | Ön koşul | Kanal kaydında `bulut` bloğu var (alt alan = kanal, VDS IP, sağlayıcı, platform `linux-x64-oci`) ve `check-kanallar` yeşil. Portalda kurulum **BARINDIRILAN** sınıfında, kanala bağlı, etkinleştirme kodu hazır. Kanalda imzalı Linux sürümü yayında. Cloudflare belirteci `~/.tekserp/sirlar/` altında; yetkileri yalnız `etkiliyazilim.com` bölgesinde *DNS Edit* + *SSL and Certificates Edit*. Alt alan ayrılmış değil ve DNS'te kaydı yok | Herhangi biri yoksa DUR (fail-closed) |
| 1 | VDS'i ölç | Sağlayıcının ilk erişimiyle salt okuma: Ubuntu 24.04 LTS · x86_64 · ≥ 2 vCPU · ≥ 4 GB · ≥ 60 GB · saat senkronu · makine kimliği | Eşik altı → DUR |
| 2 | Sertleştir | §1.4: hesap ve anahtar → Tailscale (etiketli, tek kullanımlık auth anahtarıyla) → **önce tailnet üzerinden SSH ölçülür, sonra genel SSH kapanır** (kilitlenme önlemi) → ufw · fail2ban · unattended-upgrades · machine-id tazeleme | `sshd -T` beklenen değerler · dışarıdan 22/2222 kapalı |
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
| R2 | Taşıma yalnız HTTPS. HSTS ve en az TLS 1.2 (Cloudflare). Bulut APK profilinde açık metin trafiği kapalı. Panel adresi `https` olmak zorunda | HTTP (LAN). Kalıcı çözüm (kendinden imzalı TLS + sabitleme) ayrı iştir | G21 |
| R3 | İstemci IP'si yalnız beyanlı vekilden (kenarın sabit adresi) `CF-Connecting-IP` ile okunur. Başka kaynaktan gelen başlık yok sayılır | `CLIENT_IP_HEADER` yalnız beyanlı vekilde (aynı kural, farklı değer) | G14 |
| R4 | Genel hız sınırı açıktır. IPv6 anahtarı /64'tür. Tablo tavanlıdır, en eski atılır. **Fabrikanın bütün cihazları tek NAT IP'sinin arkasındadır:** IP tavanı geniş tutulur, asıl sınır hesap + cihaz ikilisidir. Giriş kilidi DB'de kalıcıdır, süreç yeniden başlayınca sıfırlanmaz | Genel sınır kapalı, kilit bellekte | G15 |
| R5 | Cihaz onayı zorunludur (`devicePairingRequired` bulutta sabit `true`, yazılamaz). Onayda cihaza ≥ 256 bitlik **cihaz sırrı** verilir. PIN, kart, personel listesi ve indirme belirteci istekleri cihaz kimliğiyle birlikte sırrı da taşır; DB'de sırrın yalnız özeti durur | Bayrak varsayılan kapalı; cihaz kimliği yalnız `x-device-id` başlığı | G21 |
| R6 | PIN ve kart özetli saklanır (her kurulumda, K-B6). Deneme sınırı hesap + cihaz başına (5 hata → 15 dk, artan). Yeni kart kodu ≥ 128 bit rastgeledir; bulutta kısa ya da eski kart kodu kabul edilmez | Özet aynı (G21-K). Kısa kodlar geçiş süresince kabul edilir | G21 |
| R7 | Kimliksiz uçlar daralır: personel listesi (`/api/auth/mobile-users`) ve giriş yöntemleri onaylı cihaz ister. Keşif uçları (`/api/discovery/*`) ve mDNS ilanı kapalıdır (404 / iş başlamaz). Public `/health`in donmuş 6 alanı aynen kalır, `/health/yerel` yalnız döngü adresine açıktır | Açık (LAN keşfi: `Teks-Erp/src/services/discovery.service.ts`, `Teks-Erp/src/jobs/mdns-advertiser.job.ts`) | G21 |
| R8 | JWT sırrını kurulum betiği üretir (64 bayt). Örnek ya da sızmış değerler ret listesiyle reddedilir. İzinler kullanıcı satırından tazelenir. Rotasyon prosedürü runbook'tadır | Ret listesi her kurulumda (çekirdek, G20 dilimi) | G20 |
| R9 | Bilinen parolalı seed yoktur. İlk yönetici rastgele parolayla ve zorunlu değişimle doğar. Parola politikası en az 10 karakterdir | Windows kurulumu bugünkü gibi; Docker seed'inin sabit parolası her yerde kalkar | G20 |
| R10 | Backend'in yerel ağ çıkışı kapalıdır (§1.3). Arka uçtan ağ yazıcısına RAW TCP (`label.nativeSendEnabled`, `Teks-Erp/src/services/helpers/printer-transport.ts`) ve ağ kantarı/metre bulutta **yazılamaz ve çizilmez**. Etiket panelden ya da tabletten basılır. Yazıcı IP'si özel aralık denetiminden geçer (SSRF) | Opt-in açık | — |
| R11 | Panelde ve tablette sunucu adresi kanal kaydından gömülü `https` adresidir. Değişiklik kullanıcı onayı ister | Keşif + elle adres | G21 |
| R12 | API yanıtlarında `Cache-Control: no-store`. Cloudflare'de host için önbellek BYPASS kuralı | Gerek yok | — |
| R13 | Yönetim erişimi yalnız tailnet ve anahtarla yapılır. Müşteriye kabuk yoktur. Destek amaçlı veri erişimi yalnız müşteri talebiyle olur ve kayda geçer (patron destek kalıbı) | Tailscale (bugün) | G1 · G2 |
| R14 | Gece şifreli yedek ve başka sağlayıcıdaki kopya **zorunludur**. Yapılandırılmamışsa kurulum bitmiş sayılmaz ve sağlık özeti kırmızı olur | İsteğe bağlı | — |
| R15 | Sırlar VDS'te doğar. `.env` root 0600'dür. Origin CA özel anahtarı VDS'ten çıkmaz. Hiçbir sır Mac'e, loga ya da kurulum durum dosyasına girmez | Sır hijyeni (çekirdek, aynı) | G22 |

Bulut sınıfının **değiştirmediği** çekirdek kurallar: lisans kapısı aniden durdurmaz ve veri erişimi her kademede açıktır · internet kesintisi lisansı kısaltmaz · iki adımlı giriş herkes için isteğe bağlıdır (2026-09-30 kararı; bulutta yeniden sorulacak, soru S6) · audit yalnız ayak izidir · tek backend süreci vardır.

## 4. Docker güncelleyicisi

### 4.1 Ortak sözleşme (Dağıtım v2)

Bulut güncelleyicisi, Dağıtım v2'nin **aynı sözleşmesine** bağlanır: `tekserp-surum` bildirimi (PAKET imzalı) · kanal bağı · kiranın `guncelleme` politikası (OTOMATIK · ONAYLI · DONDUR, pencere, sabitleme; K1 her şeyi ezer) · tek karar fonksiyonu `decideUpdate` · yoklamadaki güncelleme raporu · panelin "Sistem → Sunucu Güncellemeleri" ekranı · onay ucu ve niyet dosyası (yetki DEĞİL) · ortak test vektörleri. Satıcı ve portal tarafında yeni bir şey gerekmez, kurulum geçmişi ve filo görünümü aynen çalışır. Politika müşteri başına portalda ayarlanır, varsayılanı bugünkü `defaultUpdatePolicy()` (ONAYLI) kalır (soru S5).

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
5. İmaj içi bütünlük listesi açılışta ve günlük olarak native çekirdekte doğrulanır. Bugün bu bir borçtur (LINUX-DOCKER §8) ve **bulut sınıfının ön koşuludur** (G13).

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

Güncelleyici konakta systemd hizmeti olarak çalışır (`Restart=always`), aynı Rust crate'in Linux arka ucudur (T2). Dosya düzeni ve IPC Windows'takinin aynısıdır: `/var/lib/tekserp/guncelleme/{durum,niyet,is}`. Backend `durum/`u salt okunur bağlar, `niyet/`e yazar. Dosya adları ve biçimleri w2 §5 ile aynıdır. Güncelleyici ikilisi paketin içinde gelir; kendini güncelleme w2 §10'daki A/B şemasını izler (`.eski` ikili, 3 açılış sayacı). İşletim sistemi yamaları güncelleyicinin işi değildir (§1.4).

## 5. Yedek, başka sağlayıcıda kopya ve geri yükleme tatbikatı

### 5.1 Katmanlar

| Katman | Ne | Nerede | Saklama |
|---|---|---|---|
| Canlı | PostgreSQL birimi | Müşteri VDS'i | — |
| Gece yedeği | `pg_dump -Fc` → `pg_restore --list` doğrulaması → `.tkenc` (`docs/ops/YEDEK-SIFRELEME.md` biçimi) | VDS, `yedek` birimi | 30 gün, en yeni 3 kopya asla silinmez |
| Güncelleme öncesi | §4.4 adım 2 | VDS, güncelleyici dizini | Son 3 |
| Başka sağlayıcı | Aynı `.tkenc` dosyası, `rclone copy` (sync değil) ile SFTP | **Yedek deposu VDS'i** (Türkiye, müşteri VDS'lerinden farklı sağlayıcı, bütün bulut müşterilerine ortak) | 30 gün günlük + 12 ay aylık (`docs/ops/YEDEK-VPS-KURULUM.md` kalıbı) |

**Fidye yazılımına karşı direnç:** müşteri VDS'inin depodaki hesabı kabuksuz ve chroot'ludur, yalnız kendi `gelen/` dizinine yazabilir. Silemez ve arşivi göremez. Arşivi depodaki root zamanlayıcısı **kopyalar** (taşımaz). Depo ele geçirilirse içerik yine şifrelidir, çünkü çözme anahtarları depoda durmaz. Depo da §1.4 sertleştirmesinden geçer ve gözcünün listesine girer.

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
| RTO, VDS kaybı | 2–4 saat | Yeni VDS + betik + depodan döküm + lisans taşıma (yeni parmak izi; satıcı taşıma akışı) + DNS |

## 6. Kök CLAUDE.md istisna cümlesi (öneri)

**Bugün** (Kapılar ve sözleşme): "Fabrika sunucusuna GELEN port açılmaz (eski tünel 2026-09-30'da emekli) — dışarıyla tek bağ fabrikanın ÇIKAN imzalı kanallarıdır."

**Öneri:** "Fabrika sunucusuna GELEN port açılmaz; dışarıyla tek bağ fabrikanın ÇIKAN imzalı kanallarıdır. **Tek beyanlı istisna BARINDIRILAN sınıfıdır (bulut kurulum):** bizim yönettiğimiz VDS'te yalnız 443, yalnız Cloudflare kaynak adreslerinden ve Cloudflare istemci sertifikasıyla açılır; sınıfın sert kuralları sınıftan türer, kapatılamaz, SSH genel internete açılmaz — `docs/kurallar/<bulut alanı>`."

Aynı iniş commit'inde gelecekler (B0): `docs/kurallar` altında yeni alan dosyası `bulut-kurulum` (§3 tablosundaki her satır tek kural cümlesine ve bekçi adına dönüşür) · alan dizinine satır · arşive tarihli `[ÇEKİRDEK]` (sınıf yüklemi, istisna) ve `[PROFİL]` (eşik sayıları, sağlayıcı) etiketli not · `docs/kurallar/kesif-cihaz.md` ve `docs/kurallar/genel.md` içindeki ilgili cümlelere bulut ayrımı.

## 7. Sözleşme ve hukuk notları (avukata gidecek maddeler)

Taslaklar `docs/hukuk/` altında "avukat onayı bekliyor" damgasıyla yazılır (B10). Mevcut belgelerin genişletilmesi: `docs/hukuk/SON-KULLANICI-LISANS-SOZLESMESI.md`, `docs/hukuk/BAKIM-DESTEK-SOZLESMESI.md`, `docs/hukuk/VERI-ISLEME-EKI.md`, `docs/hukuk/KABUL-METNI.md`. Yeni belge: **Barındırma Hizmet Eki** (SLA dahil).

| # | Madde | Taslağın varsayımı | Avukata soru |
|---|---|---|---|
| H1 | İnternet kesintisi | Müşteri tarafındaki internet kesintisi hizmet kesintisi sayılmaz, S1 olmaz. Yedek internet tavsiye edilir. Kesintisiz üretim isteyene fabrika kurulumu önerilir (K-B2) | İfade sorumluluğu yeterince sınırlıyor mu? Kesinti yüzünden üretim kaybı talebine karşı dayanak |
| H2 | Erişilebilirlik | Tek VDS için dürüst hedef: ayda %99,5. Planlı bakım penceresi önceden duyurulur. Acil güvenlik yamasında plansız pencere hakkı saklıdır. Kademeli telafi uygulanır | Telafi kademeleri ve üst sınır |
| H3 | Veri konumu ve **Cloudflare** | VDS ve yedek deposu Türkiye'dedir. **Ancak bütün ERP trafiği Cloudflare kenarında açılıp yeniden şifrelenir** (ABD merkezli şirket). Bu, patron bulutu ekindeki §6.3 sorusunun aynısıdır, ama burada kapsam bütün iş verisi ve çalışan adlarıdır | KVKK md. 9 kapsamında aktarım sayılır mı? Standart sözleşme yeterli mi? K-B3 ile çelişki var mı? (Cevap olumsuzsa teknik seçenek: Cloudflare'siz doğrudan TLS; bedeli DDoS koruması ve köken gizliliğinin kaybı) |
| H4 | Roller | Müşteri veri sorumlusu, biz veri işleyeniz. VDS sağlayıcısı, yedek deposu sağlayıcısı ve Cloudflare alt işleyendir (adlı liste, değişiklikte 30 gün önce bildirim) | Sağlayıcı sözleşmelerinin KVKK yeterliliği |
| H5 | İşleten sorumluluğu | İşletim sistemi, yama, yedek ve izleme bizdedir. Sorumluluk son 12 ayın ücretiyle sınırlıdır, dolaylı zarar hariçtir. Veri kaybı RPO ile sınırlıdır | Sağlayıcı arızası mücbir sebep sayılır mı? |
| H6 | Erişim ve gizlilik | Personelimiz veriye yalnız talep ya da olay üzerine erişir, erişim kayda geçer, yazılı gizlilik yükümlülüğü vardır | — |
| H7 | Ödeme gecikmesi | Askıya alma kısıtlı kip demektir: okuma, rapor ve dışa aktarma açık kalır, **sunucu kapatılmaz** (çekirdek kural: veri erişimi her kademede açık) | Bulutta sunucu maliyeti sürerken bu yükümlülüğün süresi |
| H8 | Fesih, iade, imha | Fesihte şifreli döküm müşteri anahtarıyla teslim edilir. 30 gün sonra VDS ve depo kopyaları imha edilir, imha tutanağı tutulur | Saklama süresi ve ispat |
| H9 | İhlal bildirimi | 72 saat (`docs/hukuk/VERI-IHLALI-BILDIRIM-PROSEDURU.md`) | — |
| H10 | Lisans metni | "Kurulum ve tesis" kavramı bulutta VDS'e karşılık gelir. Kabul metninde sınıf listesine "Barındırılan" eklenir. "Saatte bir bağlanır" cümlesi bulutta "5 dakikada bir" olur | Metin farkının kabul kaydına etkisi |

## 8. Maliyet

Kural: kalıcı işletim yükü getiren seçenekte para (tek sefer + aylık), iş (gün) ve işletim (saat) sayıyla yazılır, ölçeğe göre hesaplanır. Fiyatlar KDV hariçtir ve 2026-10 sağlayıcı sayfalarından alınmıştır; **teklif alınarak doğrulanacak** (kaynaklar: https://www.vulut.com/blog/vds-fiyatlari-ve-satin-alma-rehberi · https://www.karekod.org/blog/vds-fiyatlari/ · https://www.natro.com/sunucu-kiralama/vds-sunucu · https://www.whtop.com/plans/turhost.com/135431).

### 8.1 Müşteri başına

| Kalem | Tek sefer | Aylık | Not |
|---|---|---|---|
| VDS, 2 vCPU · 4 GB · 60–80 GB NVMe | — | Ekonomik TR sağlayıcı 145–195 TL · kurumsal TR sağlayıcı (8 GB sınıfı 25–37 USD) ≈ **600–1.200 TL** (planlama değeri **800 TL**) | En büyük sahamızda DB 33 MB, döküm ~10 MB; 4 GB yeterli. Büyük müşteri için 4 vCPU · 8 GB, 250–1.450 TL |
| Yedek deposu payı | — | 15–40 TL (10 müşteri paylaşırsa) | Müşteri başına ~0,5–1 GB (30 günlük + 12 aylık) |
| Cloudflare | 0 | 0 | Ücretsiz plan: Origin CA, Universal SSL (birinci düzey alt alan), AOP, önbellek ve yapılandırma kuralları. Pro gerekirse bölge başına 20–25 USD, bütün müşteriler için tek |
| İzleme ve bildirim | 0 | 0 | Mevcut altyapı (Resend ücretsiz katmanı, Telegram) |
| Kurulum işçiliği | 1,5–2 sa | — | Betikle. Teslim ve eğitim hariç |
| İşletim işçiliği | — | **1,5–2,5 sa** | Uyarı inceleme, aylık tatbikat kaydı, güncelleme penceresi takibi, olay payı (yılda ~2 olay × 2 sa) |

**Doğrudan aylık maliyet ≈ 815–840 TL + 1,5–2,5 saat işçilik.** Fiyatlama tabanı için bilgi: aylık bulut bedeli ≥ VDS + depo payı + işletme saati + %20 risk payı.

### 8.2 Ortak ve ölçek

| Kalem | Aylık | Not |
|---|---|---|
| Yedek deposu VDS'i (başka TR sağlayıcı, 2 GB · 100–200 GB) | 150–400 TL | ~50 müşteriye kadar tek depo yeter |
| Tailscale | 0 ya da ~6 USD/kullanıcı | Ücretsiz Personal planı ticari kullanıma uygun değilse Starter (1–2 kullanıcı). Bugün SAHINSRV erişiminde de aynı soru açıktır |
| Test VDS'i (prova, §9 B11) | ~800 TL, 1 ay | Prova bitince kapatılır |

| Ölçek | Doğrudan aylık | İşletim | Yorum |
|---|---|---|---|
| 1 müşteri | ~1.200 TL (depo dahil) | 2 sa | Depo maliyeti tek müşteriye düşer |
| 10 müşteri | ~8.300 TL | 15–25 sa | Doğrusal |
| 50 müşteri | ~41.000 TL | 75–125 sa (≈ yarım kişi) | Bu eşikte çok kiracılı model (`docs/design/SAAS-TASARIM.md`) ve işletim otomasyonu yeniden tartılır |

**Geliştirme (tek sefer):** §9 toplamı ≈ 28–34 iş günü; paralel ajanlarla takvimde 2,5–3 hafta. **Maliyetsiz alternatif** diğer satış modelidir: fabrika kurulumunda donanım ve internet müşteridedir, bizim aylık doğrudan maliyetimiz 0'dır. Dış izleme için üçüncü taraf hizmet (0–10 USD/ay, kod 0, ama yurt dışı bağımlılık) ile kendi gözcümüz (~1 gün iş, 0 TL) arasındaki seçim soru S3'tedir.

## 9. Uygulama dilimleri

Bağımlılık: Dağıtım v2 (w2 iniş + D8) · lisans v2 (L2-10 parmak izi, G12 merdiveni) · G3 (çapa ayrımı) · G13 (imaj içi bütünlük) · G14 (bölge Full strict) · G20 · G21-K **önce** iner. Her dilim ayrı worktree'de, kendi `_test` DB'siyle çalışır. Testler hedefli koşulur, tam paket faz inişinde koşar. Model kullanıcı tercihi gereği Opus'tur.

| # | Dilim | İçerik | Bağımlı | Dosyalar (yeni olanlar uzantısız) | Bekçiler | Süre | Efor |
|---|---|---|---|---|---|---|---|
| B0 | Kural ve karar | §6 cümlesi · alan dosyası · arşiv notu · dizin satırı · RECETELER'e "yeni bulut müşterisi" reçetesi | — | kök CLAUDE.md · `docs/kurallar` · `docs/RECETELER.md` · arşiv | `check-docs` | 0,5 g | düşük |
| B1 | Sınıf tek kaynağı | Protokolde `CLOUD_SENDER_CLASSES = [URETIM, BARINDIRILAN]` (üç projede bayt-eşit ayna) · backend `bulutSinifi()` · eşitleme ön koşulu (`Teks-Erp/src/cloud-sync/eligibility.ts`), patron `installation-auth` ve satıcı zil hedefi aynı sabite bağlanır · panel/tablet sınıf rozeti | Lisans v2 inişi | `Teks-Erp/src/lib/bulut-sinifi` · `protocol/belgeler.ts` · patron/satıcı aynaları | yeni `test_bulut_sinifi_tek_kaynak` (AST: başka `BARINDIRILAN` karşılaştırması yok; iki sondalı) · `test_lisans_protokol_aynasi` · eşitleme ön koşulu testleri · patron `test_patron_kapila*` | 1,5 g | yüksek |
| B2a | Kimlik sertleştirmesi (backend) | R4–R9, R12: cihaz sırrı (onayda üretim, özet, istek doğrulama) · `devicePairingRequired` sınıfa kilitli · kimliksiz uçların daralması · keşif/mDNS kapanması · IPv6 /64 hız sınırı + DB'de kalıcı kilit · seed bulut kipi + `ilk-yonetici` · `no-store` | B1, G20, G21-K | `Teks-Erp/src/services/device.service.ts` · `Teks-Erp/src/services/auth.service.ts` · `Teks-Erp/src/middlewares/auth.middleware.ts` · göç (yalnız ekler) | yeni `test_bulut_kimlik` (her R için negatif + pozitif sonda) · `test_superadmin*` · `test_discovery_identity` · `test_db_invariants` | 3–4 g | çok yüksek |
| B2b | Kimlik sertleştirmesi (panel + tablet) | Cihaz sırrının güvenli depoda tutulması (Electron `safeStorage`, Android Keystore) · https zorunluluğu · bulut APK profili (açık metin kapalı) · adres değişimi onayı. "Eski istemci ne yapar": bulut yalnız yeni kurulumdur, eski istemci bağlanmaz; fabrikada sır istenmez | B2a | Electron güvenli depo + api istemcisi · mobil HAL/oturum · `build-apk` profili | Electron vitest · mobil jest · `test_mobil_enum_aynasi` | 2 g | yüksek |
| B3 | Arka uç LAN özellikleri | R10: ağ yazıcısı/kantar bayrakları bulutta çizilmez ve yazılamaz · yazıcı IP'si için özel aralık denetimi (kod katmanı; konak katmanı B5'te) | B1 | `printer-transport` · bayrak kataloğu · panel ayar ekranı | `test_bulut_lan_kapali` · bayrak reçetesi bekçileri | 1 g | yüksek |
| B4 | Linux güncelleyici | Sözleşme 5 (§4.2) + vektörler · Rust Linux arka ucu (compose, imaj yükleme, geçici anahtar) · `backend-yayinla.mjs --platform` · backend IPC kökü Linux yolu · Worker kapsamına Linux paketi | w2 iniş, D8 | w2 `native/tekserp-guncelleyici` · `protocol/guncelleme*` · `deploy/backend-yayinla.mjs` · `deploy/guncelleme-sunucusu/worker` | `test_guncelleme_protokol` (vektör) · cargo testleri (+ Linux senaryoları) · `test_backend_yayin` · `test_indirme_kapisi` | 5–7 g | çok yüksek |
| B5 | Bulut compose + kenar + konak | `deploy/bulut/`: compose, nginx (mTLS + gerçek IP), ipset/DOCKER-USER betiği + CF IP tazeleyicisi, çıkış kuralları, canlılık zamanlayıcısı, `surumler.json` · `compose-denetle` bulut kipi · AOP plan kapsamının ölçümü | B1 | `deploy/bulut/*` · `deploy/satici/compose-denetle.mjs` (ya da bulut kardeşi) | compose denetimi negatif sondalar · `test_compose_yalitimi` · `test_korumali_imaj` | 3 g | yüksek |
| B6 | Kurulum betiği | `deploy/bulut/kur.mjs`: kuru varsayılan, adım durumu, CF API istemcisi (belirteç 0600 dosyadan), ayrılmış adlar, `--devam`, `--geri-yukle`, geri alma · kanal kaydına `bulut` bloğu + `check-kanallar` şeması | B5, B4 (imaj yolu) | `deploy/bulut/kur.mjs` · `deploy/kanallar.json` · `scripts/lib/kanallar.mjs` · `scripts/check-kanallar.mjs` | yeni `test_bulut_kur` (sahte CF + sahte SSH ile kuru koşum, her DUR kapısına sonda) · `check-kanallar` | 3–4 g | yüksek |
| B7 | Yedek deposu ve tatbikat | Depo runbook'u (YEDEK-VPS kalıbı, başka sağlayıcı) · konakta kopya zamanlayıcısı · aylık otomatik tatbikat aracı + sağlık özetine sayaç (isteğe bağlı alan, satıcı önce yayınlanır) | B5 | `docs/ops` yeni runbook · `yedek-zamanlayici.sh` · `protocol/uclar.ts` | `test_yedek_sifreleme` · yeni `test_tatbikat_araci` · `test_lisans_yoklama_allowlist` | 2 g | yüksek |
| B8 | İzleme | Satıcıda sınıf başına eşikler + yeni olaylar (`BULUT_ULASILAMIYOR` · `BULUT_DUZELDI` · sertifika vadesi · tatbikat yaşı) · `satici-gozcu` yan konteyneri + `satici_gozcu` rolü (yetki ölçümlü açılış, bildirim rolü kalıbı) · compose denetimine gözcü maddeleri · portal kurulum kartında bulut bilgileri | B1 | `satici/sunucu/src/notifications/*` · `deploy/satici/docker-compose.gozcu.yml` · `deploy/satici/compose-denetle.mjs` · satıcı web | satıcı `test_bildirim_tarama` · yeni `test_gozcu_rolu` · compose denetimi | 3 g | yüksek |
| B9 | Kanal, yayın, belgeler | `docs/ops` bulut runbook'u (kurulum, güncelleme, geri yükleme, VDS kaybı, imha) · SUNUCU-ENVANTERI şablonu · panel/tablet bulut kanal profili | B6 | runbook + envanter | `check-docs` · `check-kanallar` | 1,5 g | orta |
| B10 | Hukuk taslakları | Barındırma Hizmet Eki + SLA · DPA ek maddeleri · kabul metni sınıf satırı (`kabul-metni-uret` ile yeniden üretim) | — | `docs/hukuk/*` | `test_lisans_kabul_metni` | 1 g + avukat | orta |
| B11 | Uçtan uca prova | Kısa süreli test VDS'imizde ("önce kendi sunucumuz"): kurulum → panel + gerçek tablet → güncelleme → zorla geri dönüş → yedek kopyası → üç tatbikat → VDS kaybı. En uzun rapor ve dışa aktarma süresi Cloudflare'in 100 sn sınırının altında mı ölçülür. Senaryo "BULUT" (adım başına yeşil/kırmızı + kanıt) | Hepsi | senaryo belgesi | senaryo + tam paket (faz inişi) | 2–3 g | yüksek |

**Kritik yol:** B0 → B1 → B5 → B6 → B11, paralelinde B4 (en uzun parça) ile B2a → B2b. B3, B7, B8, B9 ve B10 B1'den sonra paralel yürür. İlk müşteri B11 yeşil olmadan kurulmaz.

## 10. Kullanıcıya sorulacak açık sorular (yönetici sohbette şıklı sorar)

| # | Soru | Şıklar (önerilen ilk) |
|---|---|---|
| S1 | Bulut VDS'ine yönetim erişimi | **(A) Yalnız tailnet + anahtar, acil durumda sağlayıcı konsolu** · (B) genel 2222 portu, anahtar + fail2ban (tekserp-vds gibi) |
| S2 | Başka sağlayıcıdaki yedek kopyasının yeri | **(A) Türkiye'de farklı sağlayıcıda ortak bir yedek deposu VDS'i (150–400 TL/ay, toplam)** · (B) bizim tekserp-vds (yalnız sağlayıcısı müşteri VDS'lerinden farklıysa) · (C) yurt dışı nesne deposu, şifreli (KVKK sorusu avukata gider) |
| S3 | Dış izleme | **(A) Kendi gözcümüz, satıcı VDS'inde (~1 gün iş, 0 TL)** · (B) üçüncü taraf izleme hizmeti (0–10 USD/ay, yurt dışı) |
| S4 | VDS sağlayıcı sınıfı | **(A) Kurumsal TR sağlayıcı (~600–1.200 TL/ay, destek ve SLA'sı var)** · (B) ekonomik TR sağlayıcı (~150–250 TL/ay) |
| S5 | Bulut müşterisinde varsayılan güncelleme politikası | **(A) ONAYLI (fabrikayla aynı varsayılan)** · (B) OTOMATIK + Pazar gecesi penceresi |
| S6 | Bulutta yönetici ve satıcı hesabında iki adımlı giriş | (A) İsteğe bağlı kalsın (2026-09-30 kararı) · (B) Bulut sınıfında yönetici ve satıcı hesabına zorunlu olsun (internete açık sunucu; önceki kararı bu sınıf için değiştirir) |

Avukatın H3 cevabına bağlı bir karar daha var: Cloudflare kenarı aktarım sayılır ve dayanak kurulamazsa, Cloudflare'siz doğrudan TLS seçeneği (K-B4'ün yeniden açılması) o zaman sorulur.
