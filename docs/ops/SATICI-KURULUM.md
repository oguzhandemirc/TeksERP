# Satıcı (lisans) sunucusu — tekserp-vds kurulum runbook'u

> **Durum (2026-09-29):** hazırlık satıcısı tekserp-vds'te **KURULU** — `ORTAM=hazirlik`, imaj `tekserp-satici:0ca31403525a`, `https://lisans-test.etkiliyazilim.com` yanıt veriyor; kurulum kaydı ve ölçümler §12 (o gün geri döngü kipi + tünel).
> **Portal tüneli KAPANDI (D5, 2026-10-05 — kodda ve bu runbook'ta):** portalın tek yolu internetten ERİŞİM ve yalnız ÜRETİM satıcısında ([`PORTAL-GENEL-ERISIM.md`](PORTAL-GENEL-ERISIM.md)); hazırlık satıcısının portalı YOK. VDS'teki hazırlık kurulumu §4a uygulanana dek eski imaj + geri döngü örtüsüyle koşar. Kullanıcıya kalan: §4a (VDS, "uygula" cümlesiyle) ve sudo gerektiren adımlar (§12 "sudo'suz kurulum").
> Yapıtlar: [`deploy/satici/`](../../deploy/satici/) (compose · Dockerfile · imaj derleme · yalıtım denetimi · VDS birimleri). Protokol: [`LISANS-PROTOKOLU.md`](../design/LISANS-PROTOKOLU.md). Alan kuralları: [`kurallar/lisans.md`](../kurallar/lisans.md). Sunucu envanteri: [`SUNUCU-ENVANTERI.md`](SUNUCU-ENVANTERI.md).
> **Üretim (2026-09-30):** `ORTAM=uretim` · `lisans.etkiliyazilim.com` — §13'te HAZIRLANDI, UYGULANMADI; anahtar töreni YAPILDI 2026-09-30 ([`URETIM-SATICI-TOREN.md`](URETIM-SATICI-TOREN.md) §7), üretim kökü + PAKET anahtarı güven çapasına yazıldı (çapa dilimi `lisans/capa`; açık yarılar §10).
> **Değişmez:** her VDS yazımından ÖNCE ve SONRA `deploy/vds-dogrula.sh` → *adnansahin baytları AYNI* (salt okuma, çıkış 0). Fark çıkarsa dur.

## 0. Kapsam

| Kurulur | Kurulmaz |
|---|---|
| `ORTAM=hazirlik` — `lisans-test.etkiliyazilim.com` (genel); portal YOK (tek portal üretimde, §4 · [`PORTAL-GENEL-ERISIM.md`](PORTAL-GENEL-ERISIM.md)) | Üretim kökü (`kok-<yıl>-<n>`, kullanıcı töreni) ve `lisans.etkiliyazilim.com` — **aynı** compose, `ORTAM=uretim` `.env`'iyle (`ornek-uretim.env`) ayrı proje: §13 |
| Hazırlık kökü `hazirlik-2026-1` (yalnız TEST/DEMO imzalar), ALT `alt-hazirlik-2026-1`, İNDİRME `ind-hazirlik-2026` | CF Worker (Faz 3a) |
| Portal web arayüzü (1f): satıcı arayüzü `/portal` (yalnız ERİŞİM dinleyicisinde, Access arkasında — bütün işlemler, kök parolalı imza formu dahil; portal-genel örtüsüyle, yalnız üretimde) · bayi arayüzü `/bayi` (genel) — imajın içinde (`/uygulama/web`, §2.2) | Fabrika verisi — satıcı DB'si yalnız lisans kayıtlarını taşır |
| Satıcının kendi PG16'sı + şifreli yedek döngüsü | |

Dokunulmayan: `tekserp-guncelleme` (compose · nginx · `html/` · `defter/`), `/srv/tekserp-yedek`, `/srv/tekserp-arsiv`. Traefik'e yalnız **bir ağ bağlantısı** eklenir (yeniden başlatmasız, §5.5).

## 1. Mimari

```
Cloudflare (proxy AÇIK) ─443─► Traefik (websecure, Origin CA *.etkiliyazilim.com)
                                  │  Host(`lisans-test.etkiliyazilim.com`)
                                  ▼  ağ: tekserp-satici-hazirlik-kenar (internal)
                            satici :4610 GENEL  (/v1/* · /q · /bayi/api · /saglik)
Tarayıcı ─► Cloudflare Access ─► Traefik Host(`portal.<alan>`) + ipallowlist(CF) ─► satici :4613 ERİŞİM (/portal/*, her istekte Access JWT; satıcı portalının bütün işlemleri açık-listede) — portalın TEK yolu; portal-genel üst dosyasıyla, yalnız üretimde
                            satici ◄─ ağ: …-ic (internal) ─► satici-db (PG16) ◄─ satici-yedek
patron (ayrı compose, PATRON_IC_IP) ─ ağ: …-ic-api (internal) ─► satici :4612 İÇ (/ic/v1/* · Bearer)
```

| Konteyner | İmaj | Kullanıcı | Bellek · CPU · süreç | Ağlar |
|---|---|---|---|---|
| `tekserp-satici-hazirlik` | `tekserp-satici:<sha>` (node 24, `node dist/server.js`) | 10001 | 384 MB · 0,75 · 200 | kenar (sabit IP) · ic · ic-api (sabit IP) — üçü internal, port yayını YOK |
| `tekserp-satici-hazirlik-db` | `postgres:16-alpine` (özetle sabit) | 70 | 256 MB · 0,5 · 100 | ic |
| `tekserp-satici-hazirlik-yedek` | `tekserp-satici-yedek:<sha>` (pg_dump 16 + `yedek-sifrele.cjs`) | 10001 | 128 MB · 0,25 · 50 | ic |
| `satici-goc` (profil `goc`, tek seferlik) | `tekserp-satici:<sha>` | 10001 | 384 MB · 0,5 · 100 | ic |
| `tekserp-satici-hazirlik-bildirim` (örtü `docker-compose.bildirim.yml`, §5c) | `tekserp-satici:<sha>` (aynı imaj, `node dist/notifications/sender-main.js`) | 10001 | 128 MB · 0,25 · 50 | ic · bildirim-cikis (TEK dış çıkış: yalnız tcp/443 + sabit DNS) |

**İç API (patron bulutu → satıcı, §5b):** satıcının üçüncü dinleyicisi `IC_API_IP:4612` yalnız `ic-api` köprüsünde (internal, port yayını YOK). Uygulama kapısı fail-closed: istek o soketten gelmeli VE kaynak adres `PATRON_IC_IP/32` olmalı (soket adresi; başlık okunmaz) → değilse 404; ardından ortak Bearer (docker secret `ic_api_belirteci`, sabit zamanlı) → yanlışsa 401. Sır dosyası yoksa/herkese açıksa/zayıfsa iç dinleyici hiç açılmaz (günlük: `iç API KAPALI`). Köprünün ağ geçidi (.1 = VDS'in kendisi) ve dinamik aralık kaynak sayılmaz — host kabuğu da, sonradan ağa katılan bir konteyner de iç API'ye ulaşamaz.

Hepsinde: kök FS **salt okunur** · `cap_drop: ALL` · `no-new-privileges` · docker soketi **bağlı değil** · `init`. Satıcı `web` ağına katılmaz: güncelleme/patron/kiracı konteynerleri satıcıya ağdan ulaşamaz, satıcı onlara ulaşamaz. Bu değişmezleri `deploy/satici/compose-denetle.mjs` ölçer (§2.4) — kuruluma o yeşil vermeden geçilmez.

**Port yayını yok:** satıcı host'a hiçbir port yayımlamaz (denetim ①). Genel yüz (4610) ve üretimde portal (4613) Traefik'ten kenar ağıyla, iç API (4612) `ic-api` köprüsünden gelir. Köprü ağları 100.64/10 ve 127/8 DIŞINDA seçilir (denetim ⑥): köprü ağ geçidinin adresi geri döngü/CGNAT sayan bir kaynak kapısını (iç API `IC_KAYNAK_AGLARI`) kandırmasın.

**Budama:** telemetri (nonce · yoklama · portal oturumu/işlem kimliği) satıcının süreç içi bakım işinde (`BAKIM_ARALIGI_SN`, `satici/sunucu/src/services/maintenance.ts`); satıcı `denetim` tablosu (ayak izi, yönetici kararı h: başarısız giriş 90 gün, diğeri 2 yıl) aynı bakım işine `lisans/satici-tamamlama` dilimiyle girer — varsayılanlar kodda, compose'a değişken gerekmez; yedek dosyaları `satici-yedek` döngüsünde — `YEDEK_SAKLA_GUN`'den eskiler silinir, her türün en yeni `YEDEK_EN_AZ` kopyası **asla** silinmez.

## 2. Mac'te hazırlık

### 2.1 Anahtarlar (bu dilimde üretildi — repo DIŞINDA)

| Ne | Nerede (Mac) | İzin |
|---|---|---|
| Hazırlık kökü (scrypt + AES-256-GCM parolalı) · ALT · İNDİRME · `portal-totp.key` · `etkinlestirme-kodu.pepper` · `modul-kasasi.key` | `~/.tekserp/satici-hazirlik/` | dizin 700 · dosyalar 600 |
| Kök parolası (rastgele, 43 karakter) | `~/.tekserp/sirlar/hazirlik-kok-parolasi.txt` | 600 |
| Yedek alıcısı `satici` — açık yarı | `~/.tekserp/satici-hazirlik-yedek-alici/satici.tkpub` | 644 |
| Yedek alıcısı — özel yarı (satıcı yedeklerini AÇAR) | `~/.tekserp/sirlar/satici-hazirlik-yedek-ozel.txt` | 600 |

Üretim komutları (tekrar gerekirse — var olan dosyanın üstüne YAZILMAZ, rotasyon yeni kid'dir). Parola dosyadan **stdin'e** gider; argv'ye, ortama, loga girmez:

```bash
cd satici/sunucu
P=~/.tekserp/sirlar/hazirlik-kok-parolasi.txt; D=~/.tekserp/satici-hazirlik
{ cat "$P"; cat "$P"; } | npx tsx scripts/anahtar.ts kok-uret --kid=hazirlik-2026-1 --dizin="$D"
cat "$P" | npx tsx scripts/anahtar.ts alt-uret --kid=alt-hazirlik-2026-1 --kok=hazirlik-2026-1 --dizin="$D"
cat "$P" | npx tsx scripts/anahtar.ts indirme-uret --kid=ind-hazirlik-2026 --kok=hazirlik-2026-1 --dizin="$D"
npx tsx scripts/anahtar.ts sirlar-uret --dizin="$D"   # portal-totp.key + etkinlestirme-kodu.pepper + modul-kasasi.key (varsa korunur)
```

- **Üç simetrik sır (F2 + 2d):** tek üreticisi `anahtar.ts sirlar-uret`tir; anahtar birimi VDS'te SALT OKUNUR olduğundan sunucu ve imajdaki CLI'lar (`portal-kullanici`, `modul-anahtari`) bunları YALNIZ OKUR — biri eksikse açılış yaratmaya kalkmadan açık TR hatayla durur (hangi dosyalar eksik + bu komut; fail-closed, bekçi `test_sunucu_sirlari`). `etkinlestirme-kodu.pepper` etkinleştirme kodunun DB özetini sırlar (HMAC): kaybolursa açık kodlar tanınmaz (yeniden üretilir); TOTP anahtarı kaybolursa portal TOTP'leri sıfırlanır; `modul-kasasi.key` kaybolursa kasa satırları açılamaz (kira modül anahtarı taşıyamaz). Üçü de kök dosyasıyla birlikte VDS dışı kopyaya girer.
- **Hız sınırı ve vekil (F2, D9):** `/v1/*` istemci IP'si başına ve kurulum başına sınırlıdır. İstemci IP'si `cf-connecting-ip`'ten YALNIZ güvenilen kenardan gelen bağlantıda okunur; satıcının soketi Traefik olduğundan compose `IC_VEKIL_AGLARI=${KENAR_AGI}` verir ve güven kararı Traefik'in `X-Forwarded-For`a yazdığı son halkaya (CF kenar adresi) göre verilir — Traefik gelen X-Forwarded-* başlıklarına güvenmez (varsayılan), kökene doğrudan vuran istek kendi adresiyle sayılır.

- **VDS dışı kopya (kullanıcı):** `hazirlik-2026-1.kok.json` + parolası USB'ye ve kâğıda (parola ayrı kâğıtta). Mac tek kopya olarak kalmamalı.
- **ALT rotasyonu:** sertifika `2027-03-28`'de biter → ondan önce Mac'te `alt-hazirlik-2026-2` üretilir, VDS'teki `anahtarlar/`a kopyalanır; satıcı anahtar deposunu bakım işinde (dakikada bir) yeniden okur, yeniden başlatma gerekmez. Eskisi örtüşme süresince kalır.
- Hazırlık kökü yalnız fabrika programının HAZIRLIK derlemesinin çapasındadır (`STAGING_ROOT_PUBLIC_KEYS`, yalnız TEST/DEMO; üretim derlemesi onu tanımaz — G3) — satıcı gömülü çapayı ortamının kipiyle kullanır: compose `GUVEN_CAPASI: ${ORTAM}` verir (`compose-denetle` ⑪ ölçer), `GUVEN_CAPASI_DOSYASI` **verilmez** (üretimde açılışı durdurur). Konteyner içi CLI'lar (`portal-kullanici` · `modul-anahtari ice-aktar` · `anahtar.ts indirme-belirteci`) kipi aynı ortamdan alır.

### 2.2 İmaj

```bash
deploy/satici/imaj-derle.sh                 # HEAD'den (git archive); kirli ağaç RED; linux/amd64
# → ~/.tekserp/satici-imaj/tekserp-satici-<sha>.tar.gz + .sha256 ; SATICI_IMAJ / SATICI_YEDEK_IMAJ satırlarını basar
```

VDS'te derleme YOK, kaynak VDS'e gitmez. Portal kullanıcı CLI'ı imajda derlenmiş durur (`dist-cli/scripts/portal-kullanici.js`). Web arayüzü (`satici/web`) Dockerfile'ın `web` aşamasında derleme makinesinin KENDİ mimarisinde derlenir (çıktı statik dosya, öykünme gerekmez); imaja yalnız `dist/` geçer → `/uygulama/web` (`PORTAL_WEB_DIZINI`). İmaj `src/`, `tsx`, web kaynağı ya da web `node_modules`'ü taşımaz (ölçüm §12).

### 2.3 Sunucunun `.env`'i

Hazırlıkta `deploy/satici/ornek.env`'den, üretimde `ornek-uretim.env`'den doldurulur (sır İÇERMEZ): ağlar §3'ten, imaj etiketleri §2.2'den. `COMPOSE_FILE`: hazırlıkta `docker-compose.yml[:docker-compose.bildirim.yml]` (portal örtüsü YOK), üretimde `docker-compose.yml:docker-compose.portal-genel.yml[:docker-compose.bildirim.yml]` (portal örtüsü ZORUNLU). `TAILNET_*` anahtarı yazılmaz (denetim Ⓚ).

### 2.4 Yalıtım denetimi — kurulumdan ÖNCE yeşil

```bash
node deploy/satici/compose-denetle.mjs --env-file <doldurulmuş .env>   # 0 temiz · 1 ihlal · 2 ölçülemedi
```

Ⓚ tünel kalıntısı yok (compose çözülmeden: `.env`'de `TAILNET_*` ve `COMPOSE_FILE`'da emekli `docker-compose.loopback.yml` yok; çözülmüş yapılandırmada `portal-tunel` servisi · `tailnet` ağı · `TAILNET_*`/`PORT_TAILNET` ortamı yok) · ① hiçbir servis port yayımlamaz · ② docker soketi yok · ③ salt okunur/yetenek yok/root değil/sınırlı · ③b HER serviste (yan konteynerler dahil) yalıtım gevşetmesi yok: `volumes_from` · `privileged` · `cap_add` · `pid`/`ipc`/`uts`/`userns_mode`/`cgroup` · `devices` · `runtime` · `sysctls` YASAK, `network_mode` YASAK (istisna yok), `security_opt` tam olarak `no-new-privileges:true` · ③c servis anahtarları tanınan kümede (bilinmeyen anahtar = ihlal); yapılandırma BÜTÜN profillerle çözülür (`--profile '*'`) ve `profiles` yalnız `satici-goc`ta tam `["goc"]` (başka profildeki servis denetimden saklanamaz) · ③d host bağları servis başına ALLOWLIST (hedef → `.env` değişkeni + salt okunurluk; DB yalnız kendi birimi): beyansız bağ, `.env`'deki değerden farklı kaynak, sistem yolu (`/` · `/etc` · `/root` · `/run` · `/var/run` · `/var/lib/docker` …), farklı değişkenlerin iç içe kaynakları ve bağın içinde kalan sır dosyası YASAK · ③e `group_add` yalnız `SIR_GID` (sayısal, ≥ 1000) ve yalnız sırrı okuyan beş serviste; birincil grup root olamaz · ④ kenar + ic internal, dış ağa katılım yok · ⑤ anahtar birimi salt okunur · ⑥ köprü ağları 100.64/10 ve 127/8 dışında · ⑥b kenarda dinamik aralık alt ağda, satıcının sabit adresi onun dışında · ⑥c her ağda IPv6 KAPALI (`enable_ipv6` · v6 alt ağı · ipv6 sürücü seçeneği yok — DOCKER-USER çıkış kuralları yalnız IPv4'ü daraltır) · ⑦ Traefik yalnız satıcıda ve kenar ağında, DB portsuz · ⑩ `GENEL_KOK_ADRESI` makinesi = Host kuralı · ⑪ `GUVEN_CAPASI_DOSYASI` yok (gömülü çapa) · ⑫ `--diger-env <öteki ortamın .env'i>` ile iki ortam çakışmaz (üretimde ZORUNLU, yoksa çıkış 2; §13.3) · Ⓞ örtüler: TEK PORTAL — portal-genel örtüsü üretimde ZORUNLU, hazırlıkta YASAK; satıcının ağ kümesi tam üç ağ (`kenar · ic · ic-api`, üçü internal), internal olmayan ağ yalnız örtünün çıkış ağı (tek üyeli), ⑦ BÜTÜN yönlendiricileri ölçer (hizmet portu emekli 4611 ve iç API 4612 olamaz) · ⑬ portal-genel (§13.9). Denetim `.env`'deki `COMPOSE_FILE`'ı okur (ya da çoklu `-f`). Negatif sondalar (docker soketi · `read_only` yok · anahtar rw · `web` ağı · 0.0.0.0 yayını · kenar internal değil · DB portu) her biri kırmızı verdi; ③b/③c'nin on örtüsü (incelemenin `satici-jwks: volumes_from: ["satici:ro"]`ı · `privileged` · `cap_add: [NET_ADMIN]` · `pid: "service:satici"` · `seccomp=unconfined` · beyansız `network_mode` · `userns_mode: host` · `devices` · `ulimits`), runbook kurguları (üretim + portal-genel `--diger-env` hazırlık · yalnız ana dosyalı hazırlık · hazırlık `--diger-env` üretim) ve tünel/tek portal sondaları (4611 yayını · `tailnet` ağı · `portal-tunel` servisi · `TAILNET_*` · emekli örtü · üretimde örtüsüz · hazırlıkta örtülü) her koşumda bekçi `satici/sunucu/scripts/test_compose_yalitimi.ts`te (docker yoksa ÖLÇÜLEMEDİ beyanı). Üretim öncesi sertleştirme sondaları da her koşumda bekçide (§4: `bakim` profilli privileged + host ağlı + soketli servis · `satici-yedek`e `/:/host` + `group_add: ["0"]` · yan konteynere başka servisin anahtar dizini · sır dizinini bağlayan yedek · `/etc` bağı · `SIR_GID=0` · `NODE_OPTIONS`/`HTTPS_PROXY`/`DB_HOST`/sağlayıcı kökü · çıkış ağını 172.31.200.0/28'e çeviren örtü · IPv6 — her biri kendi satırıyla ❌). Bildirim örtüsü açıksa Ⓑ0–Ⓑ8 + Ⓑ7b da koşar (§5c adım 4); patron ağlarıyla çakışma `--patron-env <patronun .env'i>` ister — verilmezse ÖLÇÜLMEDİ (üretimde çıkış 2).

## 3. VDS'i ölç (salt okuma)

```bash
ssh tekserp-vds 'docker version --format "{{.Server.Version}}"; docker compose version; docker network ls;
  docker network inspect $(docker network ls -q) --format "{{.Name}} {{range .IPAM.Config}}{{.Subnet}}{{end}}";
  ip -4 route; free -m; df -h /; ls /opt/stack/apps;
  docker inspect traefik --format "{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}"'
```

- `KENAR_AGI` / `IC_API_AGI` hiçbir mevcut ağla ve rota ile çakışmamalı (varsayılan `172.31.252.0/28` · `172.31.254.0/28`); ikisi de 100.64/10 ve 127/8 dışında.
- `KENAR_DINAMIK_ARALIK` (varsayılan `172.31.252.8/29`): Traefik kenar ağına DİNAMİK adresle katılır; dağıtım bu aralıkla sınırlı, satıcının sabit `KENAR_IP`'si aralığın DIŞINDA (denetim ⑥b). Aralık yokken Traefik satıcıdan önce bağlanınca ilk boş adresi — yani `KENAR_IP`'yi — aldı (kurulumda ölçüldü, §12).
- Bellek: mevcut üç konteyner ~320 MB tavanlı; satıcı üçlüsü +768 MB (3 GB makinede yer var — `free -m` ile ölç).

## 4. Portal yolu — tünel yok (D5, 2026-10-05)

Satıcı portalının TEK yolu internetten ERİŞİM'dir (Cloudflare Access + parola + TOTP, 4613 — [`PORTAL-GENEL-ERISIM.md`](PORTAL-GENEL-ERISIM.md)) ve YALNIZ ÜRETİM satıcısındadır (§13.9). Hazırlık satıcısının portalı YOKTUR: hazırlık yalnız satıcının kendi yeni sürümünü denemek içindir (otomatik test + ölçüm); ona fabrika bağlanmaz — testfabrika emekli, yeni test kurulumu üretim satıcısında "test" güncelleme grubunda sıfırdan kurulur, kaldırma ayrı adım (kullanıcı kararı 2026-10-05). Tailscale satıcı için KULLANILMAZ; VDS yönetimi SSH genel adresten (2222) sürer. Kod tarafında tailnet dinleyicisi (4611), `docker-compose.loopback.yml`, `portal-tunel`, `portal-baglan.mjs` ve `tekserp-satici-tailnet@` birimi kalktı; compose denetimi kalıntıyı Ⓚ ile reddeder.

### 4a. Eski (geri döngü kipli) kurulumu tünelsize çevirme — VDS YAZIMI, UYGULANMADI (kullanıcının "uygula" cümlesiyle)

`v() { ssh tekserp-vds "$@"; }` · `K=/opt/stack/apps/tekserp-satici-<ortam>`; kurulu her ortam için tekrarlanır. Docker işleri `oguzhan`ın docker grubuyla; iptables/systemd işleri sudo ister (etkileşimli `ssh -t`). Önkoşul: üretimde internet yolu doğrulanmış (giriş + pano + bir yazma + `ERISIM_YAZMA` denetim satırı) ve yeni imaj D5'i içeren main'den derlenmiş. **Yeni imaj ile yeni compose AYNI adımda iner:** eski loopback örtüsü yeni imajla kalırsa `portal-tunel` çökme döngüsüne girer.

| # | Adım | Doğrulama |
|---|---|---|
| 0 | **Salt okuma ölçümü (kilitlenme önlemi):** `v 'echo ok'` · `v 'systemctl is-enabled tailscaled 2>&1; ip -br link show tailscale0 2>&1; systemctl list-unit-files "tekserp-satici-tailnet@*" 2>&1'` · `v -t 'sudo sshd -T \| grep -Ei "^(port\|listenaddress)"; sudo ufw status \| grep 2222; sudo iptables -S DOCKER-USER'` · `v "grep -E '^(COMPOSE_FILE\|TAILNET_\|BILDIRIM_PORTAL_ADRESI\|PORTAL_HOST)' $K/.env"` · `v 'docker ps --format "{{.Names}}" \| grep satici'` · `deploy/vds-dogrula.sh` | SSH genel adresten açık; sshd 100.x'e bağlı DEĞİL; ufw 2222 tailscale0'a bağlı değil. **Biri farklıysa DUR** — sshd yalnız 100.x'te dinliyorsa Tailscale'e dokunmak SSH'ı keser |
| 1 | İkinci SSH oturumu iş boyunca açık kalır | kesinti olursa geri dönüş oradan |
| 2 | Yedek: `v "cd $K && docker compose exec -T satici-yedek /arac/yedek-dongusu.sh tek"` + dosya yedeği (`.env` · `docker-compose.yml` · `docker-compose.loopback.yml` · `docker-compose.portal-genel.yml` → `*.yedek-d5`; kök sahipliyse §12'deki yardımcı konteyner). Eski imaj SİLİNMEZ | `.tkenc` Mac'te açılır (§7) · `ls $K/*.yedek-d5` |
| 3 | Yeni imaj (§2.2 → §5.4) | imajda `/usr/local/lib/portal-tunel.cjs` YOK |
| 4 | Yeni `docker-compose.yml` (+ üretimde `docker-compose.portal-genel.yml`) kopyalanır, `docker-compose.loopback.yml` silinir. `.env`: `COMPOSE_FILE` üretimde `docker-compose.yml:docker-compose.portal-genel.yml[:docker-compose.bildirim.yml]`, hazırlıkta `docker-compose.yml[:docker-compose.bildirim.yml]` (hazırlıkta `PORTAL_HOST`/`CF_ACCESS_*` satırları da çıkar) · `TAILNET_*` satırları silinir · `BILDIRIM_PORTAL_ADRESI` üretimde `https://<PORTAL_HOST>/portal`, hazırlıkta boş · `SATICI_IMAJ`/`SATICI_YEDEK_IMAJ` yeni | Mac: `node deploy/satici/compose-denetle.mjs --env-file <.env kopyası> --diger-env <öteki ortamın .env'i> [--patron-env …]` → 0 ihlal; VDS: `docker compose config -q` |
| 5 | `v "cd $K && docker compose up -d --remove-orphans"` (GENEL birkaç saniye kesilir; fabrikalar yoklamayı tekrar dener) | `docker compose ps`: satıcı healthy, `portal-tunel` YOK; `SATICI_DINLIYOR genel=4610 ic=4612 erisim=4613` (hazırlıkta `erisim=kapali`), `tailnet` kelimesi YOK |
| 6 | `v "docker network rm tekserp-satici-<ortam>-tailnet"` (compose kullanılmayan ağı silmez) | `docker network ls \| grep tailnet` boş |
| 7 | Adım 0 birimi/kuralı gösterdiyse (sudo): `systemctl disable --now tekserp-satici-tailnet@<ortam>` · birim dosyası + `$K/tailnet-hazirla.sh` silinir · `daemon-reload` · DOCKER-USER'daki iki 4611/tailnet kuralı `-D` ile. Açılışta konteynerleri Docker'ın `restart: unless-stopped` politikası kaldırır | `sudo iptables -S DOCKER-USER \| grep 4611` boş |
| 8 | **Doğrulama:** internet `/saglik` 200 · `/portal/saglik` 404 · (üretim) tarayıcıda portal → e-posta kodu → parola + TOTP → pano + Sistem sağlığı kartı + bir okuma ve bir yazma · konteynerden `127.0.0.1:4611`e bağlantı `ECONNREFUSED` · host'ta `ss -ltn \| grep 4611` boş · fabrika yoklaması sürüyor · bildirim bağlantısı https adresini gösteriyor · `deploy/vds-dogrula.sh` ✅ AYNI · YENİ bir SSH oturumu açılıyor | hepsi ✓ |
| 9 | (K1) VDS'te Tailscale kuruluysa kaldırılır — yalnız adım 0'da SSH'ın 100.x'e bağlı olmadığı ölçüldüyse: `sudo tailscale down` → yeni SSH oturumu sınanır → `sudo apt-get remove tailscale` + `/etc/apt/sources.list.d/tailscale.list` | yeni SSH oturumu açılıyor; `ufw status` değişmedi |

**Geri dönüş** (adım 5–8 arasında): `*.yedek-d5` dosyaları yerine (eski `SATICI_IMAJ`) → `docker compose up -d --remove-orphans`; `tailnet` ağını compose yeniden yaratır, `portal-tunel` geri gelir. Göç olmadığı için DB uyumludur (`PortalDinleyici.TAILNET` enum değeri kaldı).

## 5. Kurulum (VDS YAZIMI — kullanıcının "uygula" cümlesiyle)

0. **Önce:** `deploy/vds-dogrula.sh` → ✅ (çıkış 0).
1. **Dizinler ve sahiplik** (`SIR_GID` .env'deki sayı; sunucuda bir grup olması gerekmez):

   ```bash
   K=/opt/stack/apps/tekserp-satici-hazirlik
   sudo install -d -m 755 -o root -g root $K $K/yedek-alici
   sudo install -d -m 700 -o 10001 -g 10001 $K/anahtarlar /srv/tekserp-satici-yedek/hazirlik
   sudo install -d -m 750 -o root -g 61061 $K/sirlar
   openssl rand -hex 32 | sudo tee $K/sirlar/db-parolasi >/dev/null   # ekrana BASILMAZ
   sudo chown root:61061 $K/sirlar/db-parolasi && sudo chmod 440 $K/sirlar/db-parolasi
   ```

2. **Dosyalar (Mac'ten):** `docker-compose.yml`, doldurulmuş `.env` (root 600), `satici.tkpub` (`$K/yedek-alici/`, 644). Hazırlıkta portal örtüsü KOPYALANMAZ.
3. **Anahtarlar** (ALT/İNDİRME özel yarıları düz metindir — geçici kopya shred'lenir):

   ```bash
   scp -rp ~/.tekserp/satici-hazirlik tekserp-vds:satici-anahtar-gecici   # -p: 700/600 korunur
   ssh -t tekserp-vds 'chmod 700 ~/satici-anahtar-gecici &&
     sudo install -m 600 -o 10001 -g 10001 ~/satici-anahtar-gecici/* /opt/stack/apps/tekserp-satici-hazirlik/anahtarlar/ &&
     shred -u ~/satici-anahtar-gecici/* && rmdir ~/satici-anahtar-gecici'
   ```

4. **İmaj:** `scp ~/.tekserp/satici-imaj/tekserp-satici-<sha>.tar.gz* tekserp-vds:/tmp/` → sunucuda `cd /tmp && sha256sum -c tekserp-satici-<sha>.tar.gz.sha256 && gunzip -c tekserp-satici-<sha>.tar.gz | sudo docker load && rm tekserp-satici-<sha>.tar.gz*`.
5. **Ağlar + Traefik bağlantısı (yeniden başlatmasız):**

   ```bash
   cd $K && sudo docker compose up --no-start          # ağlar + konteynerler yaratılır, hiçbiri başlamaz
   sudo docker network connect tekserp-satici-hazirlik-kenar traefik
   ```

   Kalıcılık: Traefik'in compose dosyasına (§3'te ölçülen dizin) `networks:` altına `tekserp-satici-hazirlik-kenar: {external: true}` ve traefik servisine aynı ağ eklenir — Traefik **şimdi yeniden başlatılmaz**; bir sonraki yeniden yaratılışında bağlantıyı dosyadan alır. (Geri alırken bu satır ağdan ÖNCE kaldırılır, yoksa Traefik açılmaz.)
6. **Göç** (geri alınamaz eşik; boş DB'de ilk kurulum): `sudo docker compose --profile goc run --rm satici-goc` → "All migrations have been successfully applied".
7. **Başlat:** `sudo docker compose up -d` → günlük `SATICI_DINLIYOR genel=4610 ic=4612 erisim=kapali` (sır yoksa `ic=kapali`; hazırlıkta portal yok). Açılışta konteynerleri Docker'ın `restart: unless-stopped` politikası kaldırır; ayrı birim gerekmez.

8. **İlk portal yöneticisi** (TTY; parola iki kez gizli; TOTP sırrı YALNIZ bu çıktıda — authenticator'a girip ekranı kapat, çıktıyı loga yönlendirme):

   ```bash
   sudo docker compose exec satici satici-baslat node dist-cli/scripts/portal-kullanici.js ekle \
     --kullanici=<ad> --ad-soyad="<Ad Soyad>" --rol=SATICI_YONETICI
   ```

   Kayıpta kurtarma kodu YOK: bir yönetici diğerini sıfırlar; yönetici yoksa aynı CLI `totp-sifirla` · `parola-sifirla` · `kilit-ac`.
9. **İlk yedek:** `sudo docker compose exec satici-yedek /arac/yedek-dongusu.sh tek` → `satici_<damga>.dump.tkenc` + `anahtarlar_<damga>.tar.tkenc`. Günlükteki "Yerel anahtar (yerel.tkkey) yok" uyarısı BEKLENİR: satıcıda yerel alıcı bilerek yoktur — VDS kendi yedeğini açamaz, açan özel yarı yalnız Mac'te (§7).
10. **Sonra:** `deploy/vds-dogrula.sh` → ✅ adnansahin AYNI.

## 5b. İç API (patron bulutu → satıcı) — sır, ağ, patronun katılması

VDS YAZIMIDIR (kullanıcının "uygula" cümlesiyle); S1 diliminde yazıldı, UYGULANMADI. Compose bu değişkenleri ZORUNLU tutar: §12'deki kurulum bir sonraki `compose up`tan önce 1–4'ü ister.

1. **Ağ ölçümü** (salt okuma, §3 gibi): `IC_API_AGI` başka köprü/rota ile çakışmaz — `sudo docker network inspect -f '{{.Name}} {{range .IPAM.Config}}{{.Subnet}}{{end}}' $(sudo docker network ls -q)` + `ip -4 route`. Sabit adresler (`IC_API_IP`, `PATRON_IC_IP`) alt ağda, `.1` (ağ geçidi = VDS) değil, `IC_API_DINAMIK_ARALIK` dışında.
2. **Sır** (ekrana BASILMAZ; satıcı ve patron aynı değeri taşır):

   ```bash
   K=/opt/stack/apps/tekserp-satici-hazirlik
   openssl rand -hex 32 | sudo tee $K/sirlar/ic-api-belirteci >/dev/null
   sudo chown root:61061 $K/sirlar/ic-api-belirteci && sudo chmod 440 $K/sirlar/ic-api-belirteci
   ```

   Herkese okunur (ör. 0644), 32 karakterden kısa ya da boşluklu sırda satıcı iç API'yi AÇMAZ (günlük `iç API KAPALI: …`, neden sırrı içermez).
3. **`.env`** (`ornek.env`): `IC_API_AGI` · `IC_API_IP` · `PATRON_IC_IP` · `IC_API_DINAMIK_ARALIK` · `IC_API_BELIRTEC_DOSYASI_HOST`. Mac'te `node deploy/satici/compose-denetle.mjs --env-file <.env>` → ⑧a–⑧e dahil yeşil; olmadan geçilmez.
4. **Satıcıyı yeniden yarat:** önce yedek (`sudo docker compose exec satici-yedek /arac/yedek-dongusu.sh tek`), sonra `sudo docker compose up -d satici` — `ic-api` ağı doğar, satıcı birkaç saniye kesilir (fabrikalar kira ömrü içinde etkilenmez). Günlük: `SATICI_DINLIYOR genel=4610 ic=4612 erisim=…` (hazırlıkta `kapali`, üretimde `4613`).
5. **Patron** (ayrı compose, [`PATRON-BULUTU-KURULUM.md`](PATRON-BULUTU-KURULUM.md) §4 · §10): ağ `tekserp-satici-hazirlik-ic-api: {external: true}`, servis ağında `ipv4_address: <PATRON_IC_IP>`; patronun `.env`i `SATICI_IC_API_AGI` · `SATICI_IC_API_IP` · `PATRON_IC_IP` değerlerini bu `.env`le AYNI taşır (patronun yalıtım denetimi `--satici-env` ile ölçer); sır patron dizininde AYRI bir kopya dosyadır (`sudo cp $K/sirlar/ic-api-belirteci <patron>/sirlar/`, root:<patron SIR_GID> 0440; docker secret — `.env`e ve `docker inspect`e girmez). Patron önbelleği (`KURULUM_ONBELLEK_DK`, 5) tazeliktir: satıcıya ulaşamazsa bayat kayıtla sürer, hiç dolmadıysa RED; satıcının 404'ü kaydı pasife çeker (401 çekmez).
6. **Sır rotasyonu:** yeni sır dosyaya → `sudo docker compose up -d --force-recreate satici` + patronun `.env`i + patron yeniden başlatılır. Arada patron 401 alır: bulut bayat kayıtla sürer, zil kaçar (fabrika her turda yine yoklar).
7. **İç API'yi kapatmak (ağ kalır):** `sudo truncate -s 0 $K/sirlar/ic-api-belirteci && sudo docker compose up -d --force-recreate satici` → `ic=kapali`; patron bayat kayıtla sürer.

## 5c. Bildirimler (satıcı → e-posta + Telegram) — yan konteyner

VDS YAZIMIDIR (kullanıcının "uygula" cümlesiyle); `lisans/bildirim` dilimi yazdı, UYGULANMADI. Yapıtlar: [`docker-compose.bildirim.yml`](../../deploy/satici/docker-compose.bildirim.yml) (örtü) · [`vds/bildirim-cikis.sh`](../../deploy/satici/vds/bildirim-cikis.sh) + [`vds/tekserp-satici-bildirim-cikis@.service`](../../deploy/satici/vds/tekserp-satici-bildirim-cikis@.service) (çıkış kuralları) · kod `satici/sunucu/src/notifications/`.

**Model:** satıcı anahtar tuttuğu için DIŞ BAĞLANTISIZ kalır. Olay — yeni destek talebi · kopya şüphesi (ve ikinci pencerede kira reddi) · taşıma talebi · DR devri · ses vermeyen kurulum (`BILDIRIM_SESSIZ_SAAT`, 24) · yaklaşan kira bitişi / lisans geçerlilik bitişi / taksit vadesi (`BILDIRIM_VADE_GUN`, 7) · planlı eylemin ve taksit gecikmesinin uygulanması · portaldan deneme — satıcının KENDİ tx'inde `bildirim` giden kutusuna kanal başına (EPOSTA · TELEGRAM) satır yazar; zamana bağlı olayları bakım işi `BILDIRIM_TARAMA_DK`da (15) bir tarar, tekillik anahtarı dönemi taşır (spam yok). Gönderimi `satici-bildirim` yapar: DB'ye YALNIZ `satici_bildirim` rolüyle (göç: `bildirim` SELECT + durum kolonlarında UPDATE; başka tablo YOK), satırı atomik claim eder, Resend HTTP API / Telegram Bot API'ye yalnız çıkış ağından gider; geçici hatada üstel geri çekilme (1 · 4 · 16 · 64 · 256 dk), 6 denemede HATA; 72 saatten eski bekleyen gönderilmez. **İçerik ALLOWLIST'tir** (kod + DB seddi): olay türü · müşteri › tesis › kurulum adı · lisans no/sınıf · (destekte) konu + talep no · tarih · portal bağlantısı — talep metni, ekran görüntüsü, sağlık ayrıntısı, açan kişinin adı GİTMEZ.

1. **Resend alan doğrulaması** (kullanıcı — Resend paneli + Cloudflare DNS): Resend → Domains → Add Domain → `etkiliyazilim.com` (bölge seçimi MX değerini belirler; ör. EU `eu-west-1`). Panelin verdiği ÜÇ kayıt Cloudflare'de **DNS only** (gri bulut) eklenir:

   | Tür | Ad | Değer | Ne için |
   |---|---|---|---|
   | TXT | `resend._domainkey` | panelin verdiği `p=MIGf…` | DKIM (imza `d=etkiliyazilim.com`) |
   | MX | `send` | `feedback-smtp.<bölge>.amazonses.com`, öncelik 10 | geri dönen posta (Return-Path) |
   | TXT | `send` | `v=spf1 include:amazonses.com ~all` | SPF — YALNIZ `send.` alt alanında |

   Posta kutusu **Zoho**'dadır (kök MX · SPF · DKIM · DMARC kurulu): Resend'in kayıtları yalnız `resend._domainkey` ve `send.` alt adlarındadır — **kök MX, kök SPF (`v=spf1 include:zoho… `) ve Zoho DKIM DEĞİŞMEZ**; Resend'in bounce alt alanı `send.` kök SPF'e dokunmaz. DMARC hizası DKIM'den gelir (`d=etkiliyazilim.com`). Panelde "Verify" → üçü yeşil. API Keys → **Sending access**, alan `etkiliyazilim.com` → `re_…` anahtarı BİR KEZ görünür: doğrudan 3. adımdaki sır dosyasına yazılır, Mac'te kopya tutulmaz. Gönderen `TeksERP Bildirim <bildirim@etkiliyazilim.com>` (posta kutusu gerekmez), alıcı `info@etkiliyazilim.com`.
2. **Telegram botu + grup + grup kimliği** (kullanıcı; değerler YALNIZ 3. adımdaki dosyalara yazılır): @BotFather → `/newbot` → ad + `…_bot` kullanıcı adı → bot belirteci (bir kez görünür). Hedef **sıradan grup**tur: grubu aç, botu ekle; gizlilik kipi açık bot yalnız komutu görür → grupta `/start@<bot_adı>` yaz. Grup kimliği (belirteç ekrana/geçmişe düşmeden): `read -rs T; curl -s "https://api.telegram.org/bot$T/getUpdates" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const u of JSON.parse(s).result||[]){const c=(u.message||u.my_chat_member||{}).chat;if(c)console.log(c.id,c.type,c.title)}})'; unset T` → `group` türündeki satırın kimliği (negatif tam sayı). **Süper gruba yükseltme** (yönetici ayarı/üye sınırı) kimliği DEĞİŞTİRİR: Bot API 400 + `migrate_to_chat_id` döner → gönderici satırı İLK denemede kalıcı HATA yapar (`TELEGRAM_SOHBET_TASINDI`, deneme tavanı tüketilmez) ve YENİ kimliği (yalnız sayı, sır değil) hata satırına, nabza (`docker inspect` sağlık çıktısı) ve portal Bildirimler kartına yazar; otomatik geçiş YOK — yeni kimlik grup kimliği dosyasına yazılır, `sudo docker compose up -d --force-recreate satici-bildirim`. Hız sınırında (429) gönderici `retry_after` süresince o kanala istek atmaz (deneme hakkı yanmaz).
3. **Sırlar ve kanal değerleri** (VDS; DOSYADA — `.env`e, koda, bu runbook'a değer YAZILMAZ; ekrana/geçmişe BASILMAZ; boş dosya = o kanal KAPALI):

   ```bash
   K=/opt/stack/apps/tekserp-satici-hazirlik
   openssl rand -hex 32 | sudo tee $K/sirlar/bildirim-db-parolasi >/dev/null
   for f in telegram-bot-belirteci telegram-grup-kimligi resend-api-anahtari; do sudo install -m 440 -o root -g 61061 /dev/null $K/sirlar/$f; done
   sudo chown root:61061 $K/sirlar/bildirim-db-parolasi && sudo chmod 440 $K/sirlar/bildirim-db-parolasi
   read -rs T && printf '%s' "$T" | sudo tee $K/sirlar/telegram-bot-belirteci >/dev/null; unset T
   read -rs G && printf '%s' "$G" | sudo tee $K/sirlar/telegram-grup-kimligi >/dev/null; unset G
   read -rs R && printf '%s' "$R" | sudo tee $K/sirlar/resend-api-anahtari >/dev/null; unset R
   ```

   Gönderici herkese okunur (o+r), biçimsiz (grup kimliği tam sayı değilse) ya da ikisi birden (ortam + dosya) verilmiş değeri kabul ETMEZ: o kanal kapalı kalır, günlük/nabız gerekçeyi değişken ADIYLA söyler (değeri değil).
4. **`.env`** ([`ornek.env`](../../deploy/satici/ornek.env) § Bildirim): `COMPOSE_FILE` sonuna `:docker-compose.bildirim.yml` · `BILDIRIM_CIKIS_AGI` (§3'teki gibi çakışma ölçülür; 100.64/10 ve satıcının/patronun ağları dışında) · dört DOSYA yolu (DB parolası · bot belirteci · grup kimliği · Resend anahtarı) · `BILDIRIM_EPOSTA_ALICI=info@etkiliyazilim.com` · `BILDIRIM_EPOSTA_GONDEREN="TeksERP Bildirim <bildirim@etkiliyazilim.com>"` (**tırnaklı** — `.env` kabukla da okunur, `<` yönlendirmedir) · `BILDIRIM_PORTAL_ADRESI` (üretimde `https://<PORTAL_HOST>/portal`; hazırlıkta portal olmadığı için BOŞ — iletide yalnız yol) · isteğe bağlı `BILDIRIM_DNS_1/2` (1.1.1.1 · 9.9.9.9). Satıcının eşikleri (`BILDIRIM_SESSIZ_SAAT` · `BILDIRIM_VADE_GUN` · `BILDIRIM_TARAMA_DK` · `BILDIRIM_SESSIZ_SINIFLAR`) varsayılanla kodda; değiştirmek satıcı konteynerinin ortamına ekleme ister. Mac'te `node deploy/satici/compose-denetle.mjs --env-file <.env> --patron-env <patronun .env'i>` yeşil olmadan geçilmez — örtünün maddeleri Ⓑ0–Ⓑ8 + Ⓑ7b: örtü dosyası ↔ `satici-bildirim` servisi · internal olmayan ağlar tam olarak örtü çıkış ağları, `bildirim-cikis`in tek üyesi gönderici · gönderici ağları tam `ic` + `bildirim-cikis`, satıcı/DB/göç/yedek çıkışa katılmaz · port/birim/Traefik etiketi/soket yok · tam dört kanal sırrı (başka serviste yok; `db_parolasi`/`ic_api_belirteci` göndericide yok) · ortam ALLOWLIST'i: `DB_KULLANICI=satici_bildirim`, sır yolları `/run/secrets/`, `DB_HOST`/`DB_ADI` ve sağlayıcı kökleri yalnız beklenen değer (`satici-db` · `satici` · `https://api.telegram.org` · `https://api.resend.com`), tanınmayan anahtar (`NODE_OPTIONS` · `HTTPS_PROXY` · düz sır · `DATABASE_URL` …) ihlal · satıcı imajı + `node dist/notifications/sender-main.js` · çıkış alt ağı 100.64/10 · 127/8 · satıcının ve patronun ağlarıyla çakışmaz (hazırlıkta `JWKS_CIKIS_AGI` 172.31.255.0/29 → bildirim .16/28) · Ⓑ7b `bildirim-cikis` alt ağı = `.env`'deki `BILDIRIM_CIKIS_AGI` = `bildirim-cikis.sh`in kural koyduğu ağ (tek ipam girdisi; örtü ağı başka alt ağa çevirirse kural boşa düşer) · `dns` iki sabit IPv4 = `bildirim-cikis.sh`in 53'ü açtığı adresler (betiğin varsayılanı + `.env`'deki `BILDIRIM_DNS_1/2`) · ⑥c her ağda IPv6 kapalı.
5. **Göç + rol girişi** (göç yeni imajla §5.6'daki gibi; ardından TEK SEFER, parola stdin'den):

   ```bash
   sudo cat $K/sirlar/bildirim-db-parolasi | sudo docker compose --profile goc run --rm -T satici-goc node dist/notifications/role-cli.js
   # → ✅ satici_bildirim: giriş açık · N tablo ölçüldü · yetki: YALNIZ bildirim SELECT + durum kolonlarında UPDATE
   ```

   Araç yetki kümesini önce ÖLÇER (her tablo × her yetki · kolon · dizi · öznitelik — REPLICATION dahil · rol üyeliği — `pg_read_server_files` · `pg_write_server_files` · `pg_execute_server_program` dahil HİÇBİRİ, yalnız üye rolde `satici_bildirim` · public dışı şema USAGE/CREATE ve public CREATE · veritabanı CREATE · public dışı şemada ya da SECURITY DEFINER/açık GRANT'lı fonksiyon EXECUTE): fazladan tek kalem varsa girişi AÇMAZ ve kalemi adıyla basar; gönderici her açılışta AYNI ölçümü kendi bağlantısından koşar ve fazlada DURUR. SCRAM doğrulayıcısı istemcide kurulur (düz parola sunucuya/sorgu günlüğüne gitmez). Parola döndürme: dosyayı yenile → aynı komut → `sudo docker compose up -d --force-recreate satici-bildirim`.
6. **Çıkış kuralları** (DOCKER-USER + INPUT; Docker köprü trafiğinde ufw'yi ATLAR):

   ```bash
   sudo install -m 755 -o root -g root bildirim-cikis.sh $K/          # Mac'ten kopyalanan
   sudo cp tekserp-satici-bildirim-cikis@.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now tekserp-satici-bildirim-cikis@hazirlik
   sudo iptables -S DOCKER-USER | grep -F "<BILDIRIM_CIKIS_AGI>"      # DNS RETURN ×4 · özel ağ DROP ×5 · tcp/443 RETURN · NEW DROP
   sudo iptables -S INPUT | grep -F "<BILDIRIM_CIKIS_AGI>"            # VDS'in kendisine NEW DROP
   sudo docker network inspect tekserp-satici-hazirlik-bildirim-cikis --format '{{.EnableIPv6}} {{range .IPAM.Config}}{{.Subnet}} {{end}}'
   # → false <BILDIRIM_CIKIS_AGI>   (tek alt ağ, betiğin daralttığıyla AYNI; true ise daemon varsayılanı v6 açıyor — kural v6'yı daraltmaz, DUR)
   ```

7. **Başlat:** `sudo docker compose up -d satici-bildirim` → günlük `BILDIRIM_GONDERICI_HAZIR eposta=acik telegram=acik`; `sudo docker inspect --format '{{json .State.Health}}' tekserp-satici-hazirlik-bildirim` → `healthy`, çıktıda kanal durumu. Sahip rolle (yanlış `DB_KULLANICI`) kalkan gönderici `FAZLA yetkili` diyerek DURUR.
8. **Doğrulama:**

   | Ölçüm | Beklenen |
   |---|---|
   | Portal → Bildirimler → **Deneme bildirimi gönder** (yalnız yönetici) | `info@` kutusuna e-posta + Telegram grubuna ileti; iki satır `Gönderildi`, kanal kartları `Çalışıyor` |
   | 5 dk dolmadan ikinci deneme (aynı kullanıcı) | `Deneme bildirimi kullanıcı başına 5 dakikada bir gönderilebilir; N sn sonra tekrar deneyin` (429 `HIZ_SINIRI`; satır yazılmaz) |
   | Bir sır dosyası boşken aynı deneme | o kanalın satırı `Kanal kapalı`, kartı `Kanal yapılandırılmamış`; diğer kanal gönderir |
   | Grup süper gruba yükseltildiyse deneme | Telegram satırı `Hata · TELEGRAM_SOHBET_TASINDI → <yeni kimlik>`, kart `Telegram sohbeti süper gruba taşındı` + yeni kimlik; nabızda aynı cümle — kimlik dosyası güncellenip servis yeniden yaratılınca deneme `Gönderildi` |
   | `sudo docker compose exec satici-bildirim node -e "fetch('http://1.1.1.1',{signal:AbortSignal.timeout(5000)}).then(()=>console.log('ACIK'),()=>console.log('KAPALI'))"` | `KAPALI` (443 dışı) |
   | aynı komut `http://<KENAR_IP>:4610/saglik` | `KAPALI` (satıcının dinleyicilerine ulaşamaz) |
   | `sudo docker compose exec satici node -e "fetch('https://api.telegram.org',{signal:AbortSignal.timeout(5000)}).then(()=>console.log('ACIK'),()=>console.log('KAPALI'))"` | `KAPALI` (satıcının kendisi DIŞARI ÇIKAMAZ) |
   | `sudo docker compose exec satici-db psql -U satici -d satici -Atc "SELECT has_table_privilege('satici_bildirim','kurulum','SELECT')"` | `f` |

9. **Geri alma:** `sudo docker compose rm -sf satici-bildirim` · `.env`den örtü eki çıkar · `sudo systemctl disable --now tekserp-satici-bildirim-cikis@hazirlik` (kuralları kaldırır) · girişi kapat: `sudo docker compose exec satici-db psql -U satici -d satici -c 'ALTER ROLE satici_bildirim NOLOGIN'`. Satıcı giden kutusuna yazmayı SÜRDÜRÜR (satırlar bekler; portal kanal kartı "Gönderici yanıt vermiyor"); göç geri alınmaz.

## 6. DNS (kullanıcı — Cloudflare)


`lisans-test` A → `80.253.255.188`, **proxy AÇIK (turuncu bulut)** — sertifika Origin CA `*.etkiliyazilim.com`, ona yalnız CF Edge güvenir (DNS-only'de istemci reddeder). Önbellek kuralı gerekmez (yanıtlar dinamik JSON, `Cache-Control: no-store`); zil (SSE) 25 sn kalp atışıyla CF'nin 100 sn boşta zaman aşımının altında kalır. İleride `lisans` kaydı üretim projesi için aynı biçimde. **Durum 2026-09-29:** `lisans-test` kaydı açık (CF adresleri döner); kurulumdan önce `/saglik` → `404` (Traefik'te yönlendirici yoktu), kurulumdan sonra `200 {"success":true}` (ölçüldü, §12).

## 7. Doğrulama (sonra)

| Ölçüm | Nereden | Beklenen |
|---|---|---|
| `curl -s https://lisans-test.etkiliyazilim.com/saglik` | internet | `{"success":true}` |
| `curl -s -o /dev/null -w '%{http_code}' https://lisans-test.etkiliyazilim.com/portal/saglik` | internet | `404` (portal genelde YOK) |
| `sudo docker compose logs satici \| grep '\[satici\] anahtar'` (son açılış) | VDS | boş — çapa · alt sertifika · künye uyarısı yok (hazırlıkta portal olmadığından anahtar sağlığı açılış günlüğünden; `lisans-devreye` 6.1 aynı ölçüm) |
| `curl -m 5 http://80.253.255.188:4611/` · VDS'te `ss -ltn \| grep 4611` | internet · VDS | zaman aşımı / reddedildi · boş (tünel dinleyicisi yok) |
| `sudo docker compose ps` | VDS | üçü `healthy` / `Up` |
| `sudo docker stats --no-stream` | VDS | sınırlar tablodaki gibi |
| `curl -sI https://guncelleme.etkiliyazilim.com/adnansahin/electron/latest.yml` + `vds-dogrula.sh` | Mac | 200 · adnansahin AYNI |
| Yedek açılır mı (aşağıda) | Mac | `pg_restore --list` dolu; anahtar arşivi Mac'teki dizinle bayt-eşit |
| `sudo docker compose logs satici \| grep SATICI_DINLIYOR` | VDS | `genel=4610 ic=4612 erisim=kapali` (sır yoksa `ic=kapali` + `iç API KAPALI`); `tailnet` kelimesi YOK |
| `curl -s -o /dev/null -w '%{http_code}' https://lisans-test.etkiliyazilim.com/ic/v1/zil` | internet | `404` (genel dinleyici iç yolu bilmez) |
| İç API kapısı — aşağıdaki geçici konteyner, `--ip <PATRON_IC_IP>` ile (patron henüz AYNI adreste çalışmıyorken) | VDS | Bearer'lı: `404 BULUNAMADI` (sıfır kurulum kimliği) · Bearer'sız: `401 IC_KIMLIK_GECERSIZ` |
| aynı komut `--ip` OLMADAN (dinamik adres) | VDS | ikisi de `404` (kaynak kapısı) |

İç API kapı ölçümü (satıcı imajının kendi Node'u; sır ekrana basılmaz):

```bash
sudo docker run --rm --network tekserp-satici-hazirlik-ic-api --ip <PATRON_IC_IP> --user 10001:10001 --group-add 61061 \
  -v $K/sirlar/ic-api-belirteci:/s:ro --entrypoint node tekserp-satici:<sha> -e '
  const b=require("fs").readFileSync("/s","utf8").trim(), u="http://<IC_API_IP>:4612/ic/v1/kurulum/00000000-0000-4000-8000-000000000000";
  (async()=>{for(const h of [{Authorization:"Bearer "+b},{}]){const r=await fetch(u,{headers:h});console.log(r.status,(await r.json()).details?.code)}})()'
```

**Yedeği Mac'e çekme ve açma** (dosyalar şifreli; özel yarı yalnız Mac'te):

```bash
ssh -t tekserp-vds 'install -d -m 700 ~/satici-yedek-cekim && sudo cp /srv/tekserp-satici-yedek/hazirlik/*.tkenc ~/satici-yedek-cekim/ && sudo chown -R "$USER" ~/satici-yedek-cekim'
scp 'tekserp-vds:satici-yedek-cekim/*' ~/.tekserp/satici-yedek-kopya/ && ssh tekserp-vds 'rm -rf ~/satici-yedek-cekim'
cd Teks-Erp && npx tsx scripts/yedek-sifrele.ts coz --girdi ~/.tekserp/satici-yedek-kopya/satici_<damga>.dump.tkenc \
  --cikti /tmp/satici.dump --anahtar ~/.tekserp/sirlar/satici-hazirlik-yedek-ozel.txt && pg_restore --list /tmp/satici.dump | head
```

(Yerel duman testinde ölçüldü: döküm açıldı, 24 tablo verisi; anahtar arşivi kaynakla bayt-eşit; yabancı anahtar `YANLIS_ANAHTAR`, çıkış 2.)

sudo'suz çekim (docker grubu yeter; dosya konteynerin kullanıcısıyla okunur, ara kopya yok): `ssh -p 2222 oguzhan@80.253.255.188 'cd /opt/stack/apps/tekserp-satici-hazirlik && docker compose exec -T satici-yedek cat /yedek/<dosya>' > ~/.tekserp/satici-hazirlik-yedek/<dosya>` — özet iki uçta `sha256sum`/`shasum -a 256` ile karşılaştırılır.

## 8. Geri alma

```bash
cd /opt/stack/apps/tekserp-satici-hazirlik
sudo docker compose down                                   # birim (satıcı DB'si) KALIR — silmek kullanıcı kararı
# Traefik compose'undaki kenar ağı satırı KALDIRILIR, sonra:
sudo docker network disconnect tekserp-satici-hazirlik-kenar traefik 2>/dev/null; sudo docker network rm tekserp-satici-hazirlik-kenar
```

İç API (§5b) geri alınırken önce patron ağdan çıkar (patron compose'undan `ic-api` satırı + `docker network disconnect`), sonra `compose down` ağı siler; yalnız kapatmak için §5b.7 yeter.

Traefik compose'unun kurulum öncesi hâli yanında durur: `/opt/stack/traefik/docker-compose.yml.yedek-20260929-satici` → geri alırken `sudo cp -p` ile yerine konur (ağ bağlantısı kesildikten SONRA değil, ağ silinmeden ÖNCE — dosya dış ağı andığı sürece Traefik yeniden yaratılamaz).

DNS kaydı (kullanıcı) · `docker rmi tekserp-satici:<sha> tekserp-satici-yedek:<sha>`. Sonunda `vds-dogrula.sh` → ✅. Güncelleme yayını geri almada hiç durmaz (Traefik yeniden başlatılmaz).

**Sürüm yükseltme:** yeni imaj (§2.2 + §5.4) → `exec satici-yedek … tek` (önce yedek) → `.env`'de etiket → `--profile goc run --rm satici-goc` → `sudo docker compose up -d`. Eski imaj bir sürüm boyunca kalır; geri dönüş = eski etiket + (göç geri alınamaz) yedekten geri yükleme.

## 9. Fabrika tarafı — `LICENSE_SERVER_URL`

Tek çözüm yeri `Teks-Erp/src/lib/license/vendor-url.ts` → `resolveVendorUrl` (açılışta `STARTUP_VENDOR`) (tek okuyucu; bekçi `test_lisans_satici_adresi`):

| `LICENSE_SERVER_URL` | Satıcı | Kullanım |
|---|---|---|
| verilmez / boş | `https://lisans.etkiliyazilim.com` (`DEFAULT_LICENSE_SERVER_URL`) | üretim kurulumları |
| `https://lisans-test.etkiliyazilim.com` | hazırlık satıcısı | thinkpad-1 / testfabrika |
| `kapali` | yok — dışarı hiç çıkılmaz | internetsiz kurulum, geliştirme |
| biçimsiz (yol · sorgu · kimlik bilgisi · döngü dışı `http`) | yok + açılışta uyarı | fail-closed |

Etkinleşmemiş kurulum hiçbir durumda dışarı istek atmaz (`test_lisans_motoru §2b`); etkinleştirme bir yönetici eylemidir ve **sözleşme kabulünden sonra** açılır (Ek-7 §5): panel Lisans ekranında önce kabul adımını gösterir, etkinleştirme isteği (çevrimiçi · QR · panel aktarması) kurulum imzalı kabul belgesini taşır; satıcı kabulsüz ya da tanımadığı metnin kabulüyle gelen etkinleştirmeyi 409 `KABUL_GEREKLI` ile reddeder, kabulü kurulum kaydına `SOZLESME_KABUL_EDILDI` olarak yazar (portal: kurulum → Kayıt → "Sözleşme kabulleri"). Kabul metni kataloğu (`kabul-katalogu.ts`, hukuk belgesinden üretilir) değişen sürümde satıcı fabrikadan ÖNCE yayınlanır; kabul adımı olmayan eski fabrika (backend) yeni satıcıya etkinleşemez. thinkpad-1: backend `.env`'ine `LICENSE_SERVER_URL=https://lisans-test.etkiliyazilim.com` + `pm2 restart` (thinkpad provası runbook'u). Hazırlık satıcısının imzaladığı HAK yalnız TEST/DEMO sınıfındadır; üretim kurulumu yanlışlıkla ona etkinleşse bile ÜRETİM HAK'ı alamaz (portalda kurulum kaydı da gerekir).

## 10. Anahtar künyesi (sır DEĞİL — açık yarılar)

| kid | Tür | Sınıflar | Açık anahtar (x) | Geçerlilik |
|---|---|---|---|---|
| `hazirlik-2026-1` | hazırlık kökü (parolalı) | TEST · DEMO | `705hChzAL045Gp-XoG6SaUKAW8muK1SFcW0Vpwhf-mo` | süresiz (çapada) |
| `alt-hazirlik-2026-1` | ALT (kira) | TEST · DEMO | anahtar künyesinde (`/portal/api`) | 2026-09-29 → 2027-03-28 |
| `ind-hazirlik-2026` | İNDİRME | TEST · DEMO | `olL5-kJO9x2ll70S07upNYejiB1-pim7IfU7wFPnGlw` (CF Worker, Faz 3a) | 2026-09-29 → 2027-09-29 |
| `satici` | yedek alıcısı (.tkenc) | — | parmak izi `9795275bc12a5faa` | — |
| `kok-2026-1` | ÜRETİM kökü (parolalı; tören 2026-09-30) | URETIM · TEST · DR · DEMO · BAYI · BARINDIRILAN | `sPveT3g3QhV8F_-xN2ZF0MVXFX1HHSiYzZ1GHYbPhEY` | süresiz (çapada) |
| `alt-2026-1` | ALT (kira, üretim) | kökün altı sınıfı | anahtar künyesinde (`/portal/api`) · ilk 8 `6goSeQri` | 2026-09-30 → 2027-03-29 |
| `ind-2026` | İNDİRME (üretim) | kökün sınıfları (`anahtar.ts` varsayılanı; künye sınıf yazmaz) | `ckusT12f_3VBSKC2b0nnB-UWbalN9BtlR5AOWaZbSwE` (CF Worker — `URETIM-SATICI-TOREN.md` §5.3) | 2026-09-30 → 2027-09-30 |
| `paket-2026` | PAKET — korumalı paketin bütünlük listesi (parolalı; tören 2026-09-30) | — (üretim kid'i; sınıf kısıtı yok) | `j7xjeBy3BGQu38IZrvaaJJFcQ0OJCp22z8fUNiYwaCM` | çapada; yıllık rotasyon (`paket-2027`) |
| `satici-uretim-mac` · `satici-uretim-kurtarma` | üretim satıcısı yedek alıcıları (.tkenc) | — | parmak izi `ff7b57fd2d1d2361` · `161678a8ce9dec7f` | — |

## 11. Açık riskler

- **`cf-connecting-ip` taklit edilebilir** — köken (VDS:443) yalnız Cloudflare IP'lerine açılana dek (Faz 3a) doğrudan köke gelen istek başlığı uydurabilir; etkisi yalnız IP başına hız sınırının aşılmasıdır (her `/v1` isteği kurulum imzalıdır).
- **Satıcı `denetim` budaması** (yönetici kararı h: başarısız giriş 90 gün, diğer denetim 2 yıl) bu dilimin tabanında YOK — `lisans/satici-tamamlama` dilimi getirir; imaj o dilim indikten sonraki HEAD'den derlenmezse denetim tablosu budanmadan büyür (kurulumdan önce `git log -- satici/sunucu/src/services/maintenance.ts` ile ölç).
- Traefik'in kalıcı ağ satırı Traefik compose'unu değiştirir (§5.5) — o dosya bu repoda değil (2026-09-29'da yazıldı, öncesi yanında `.yedek-20260929-satici`).
- **İç API ortak sırrı iki yerde** (satıcı secret dosyası root:SIR_GID 0440 · patronun kopyası root:<patron SIR_GID> 0440): VDS'te root her ikisini okur (kabul edilen — kök/konteyner kaçışı her şeyi açar). Sızarsa açığa çıkan yalnız allowlist'tir (kurulumların açık anahtarı + kid, durum, sınıf, patron bulutu hakkı/bitişi, tesis adı) ve zil çalınabilir (içerik taşımaz, kurulum başına hız sınırlı); kişisel/ticari veri yoktur. Çare rotasyon (§5b.6).
- Kök anahtar VDS'te (parolalı) — konteyner kaçışı kök dosyasını okur ama parolasız işe yaramaz; parola yalnız imza anında formdan alt sürece gider (plan §12). ⚠️ **Lisans v2 (kullanıcı kararı 2026-10-01):** bu risk kabulü kalkar — kök VDS'ten kaldırılır (Mac + Drive kopyaları doğrulandıktan SONRA, "uygula" cümlesiyle; A düzeni) ve G4 inince HAK'ı süreli, sınıflı, iptal edilebilir ara imzacı imzalar ([`LISANS-V2-CEVRIMDISI-KIRA.md`](../design/LISANS-V2-CEVRIMDISI-KIRA.md) §2.6).
- **Portal (yalnız üretim satıcısında, [`PORTAL-GENEL-ERISIM.md`](PORTAL-GENEL-ERISIM.md)):** tek yolu internetten Cloudflare Access + parola + TOTP; kökende her istekte Access JWT'si doğrulanır (köken 2026-09-30'da Cloudflare dışından doğrudan 200 veriyordu — ölçüldü; portal yönlendiricisine CF `ipallowlist` bağlanır). Satıcı dış bağlantısız KALIR: Access imza anahtarlarını yalnız çıkışlı `satici-jwks` yan konteyneri çeker ve paylaşılan dizine atomik yazar, satıcı salt okunur okur. Cloudflare'e ulaşılamazsa portal açılmaz (kabul, kullanıcı kararı 2026-10-05; fabrikalar etkilenmez, portal kullanıcısı kurtarma işleri SSH + `portal-kullanici` CLI'ıyla).
- **Bildirim göndericisi (§5c):** açılışta Docker `satici-bildirim`i çıkış birimi kuralları koymadan birkaç saniye önce başlatabilir — o pencerede çıkış tcp/443 ile sınırlı DEĞİLDİR (taşıdığı yalnız kendi DB rolü + iki kanal sırrıdır). PostgreSQL `NOTIFY`/`LISTEN`'i rol başına kısıtlamaz: gönderici rolü `satici_zil` kanalını dinleyip kurulum kimliği + konu (lisans/destek) görebilir ya da içeriksiz "şimdi yokla" zili çalabilir (kurulum başına hız sınırlı). Telegram'da `Idempotency-Key` yok: kilit süresi (2 dk) içinde çöken gönderici bir iletiyi ikinci kez yollayabilir (e-posta Resend anahtarıyla tekildir).

## 12. Kurulum kaydı — 2026-09-29 (hazırlık, geri döngü kipi)

> Tarihî kayıt: geri döngü kipi, `portal-tunel` ve tünelden ölçümler 2026-10-05'te emekli (D5, §4).

- **Taban:** `vds-dogrula.sh`'ın 09-28 11:08 tabanı adnansahin 1.3.7 yayınından (09-28 22:09, yayın defterinde) önce alınmıştı → betik o yayını fark gösterir, kurulumla ilgisi yok. Kurulumdan hemen önce aynı ölçümle yeni taban alındı (420 adnansahin dosyası · kök electron · defter/nginx/compose), kurulum sonrası **✅ AYNI**. `adnansahin/electron/latest.yml` 200, özet `ae919241…` önce/sonra aynı; Traefik yeniden başlatılmadı (`StartedAt` 2026-09-01, `RestartCount` 0).
- **VDS:** Docker 29.7.2 · compose v5.5.0 · 2972 MB bellek (kurulum öncesi kullanılabilir 2398, sonrası 2251 MB) · disk 55 GB boş · mevcut ağlar 172.17/18/19 (satıcınınkiler çakışmaz) · tailscaled yok.
- **sudo'suz kurulum:** `oguzhan`ın sudo'su parola ister (etkileşimsiz oturumda verilemez) ama hesap docker grubundadır. Kök sahipli yazımlar (yeni dizinler, sahiplikler, DB parolası, Traefik compose satırı) tek seferlik yardımcı konteynerle yapıldı (`tekserp-satici-yedek` imajı, `--network none`, yalnız hedef dizin bağlı); host yapılandırması (iptables, systemd, `/etc`) YAZILMADI — geri döngü kipi onları gerektirmez. `.env` oguzhan 0600 (sır içermez; `docker compose` sudo'suz okusun) · `sirlar/` 0711 root:61061 · `db-parolasi` 0440 root:61061 (64 hex, ekrana basılmadı) · `anahtarlar/` 0700 10001 (dört dosya 0600, Mac ile bayt-eşit) · `/srv/tekserp-satici-yedek/hazirlik` 0700 10001. Birim dosyası `$K/tekserp-satici-tailnet@.service` olarak durur; `/etc/systemd/system`'e kopyalanması ana kipe geçişte (sudo).
- **İletici gerekçesi (ölçüm):** `127.0.0.1`'e yayımlı porta host'tan gelen istek konteynerde `172.17.0.1` (köprü ağ geçidi) kaynağıyla göründü — tailnet kapısı onu 404'ler.
- **Kenar ağı çakışması:** Traefik satıcı başlamadan kenar ağına bağlanınca ilk boş adresi (`KENAR_IP` = `172.31.252.2`) aldı; bağlantı kesildi, compose'a `ip_range` + denetim ⑥b eklendi, ağlar yeniden yaratıldı → Traefik `172.31.252.9`. Docker `ip_range` verilince ağ geçidini aralığın ilk adresinden seçti (`172.31.252.8`; iç ağda işlevsiz).
- **Traefik:** compose'a iki satır (servis ağ listesi + dış ağ tanımı; yedek `docker-compose.yml.yedek-20260929-satici`), `docker compose config -q` yeşil; bağlantı `docker network connect` ile, yeniden başlatmasız. Bir sonraki `compose up -d` Traefik'i dosyadan aynı ağlarla yeniden yaratır.
- **Göç:** 3 migration. **Portal yöneticisi** `oguzhan` (SATICI_YONETICI) CLI ile (parola stdin'den; parola + TOTP sırrı yalnız Mac'te `~/.tekserp/sirlar/portal-yonetici-hazirlik.txt`, 0600 — authenticator'a girilir). **Kanal** `testfabrika` (tur `hazirlik`) portal API'siyle: tünelden giriş 200 → `POST /portal/api/kanallar` 201.
- **Doğrulama (internet):** `/saglik` 200 · `/v1/yokla` imzasız 401 `ISTEK_GECERSIZ` · `/v1/etkinlestir` boş 400 `GOVDE_GECERSIZ` · `/q` 200 · `/bayi/` 200 · `/portal`, `/portal/`, `/portal/saglik`, `/portal/api/oturum` 404 · köken `:4610`/`:4611` doğrudan ulaşılamaz. **Tünelden:** `/portal/saglik` 200 (`capa: gomulu · altGecerli: 1 · indirmeVar: true · uyariSayisi: 0 · denetimYazmaHatasi: 0`) · `/portal/` 200 + CSP · varlık 200 · oturumsuz API 401 · `/bayi/` 404. VDS host'undan kenar `/portal/saglik` 404 (genel dinleyici portalı sunmaz).
- **Kaynak:** satıcı 85 / 384 MB · DB 37 / 256 · yedek 1,4 / 128 · tünel 11 / 64; portal yayını yok (`ports` boş), host'ta 4610/4611 dinleyicisi yok; dördü de salt okunur kök FS, `cap_drop ALL`, 10001 (DB 70).
- **Yedek:** döngü açılışta ilk yedeği aldı + elle `tek`; `satici_20260929_164008.dump.tkenc` + `anahtarlar_20260929_164008.tar.tkenc` Mac'e (`~/.tekserp/satici-hazirlik-yedek/`, 0600) bayt-eşit çekildi ve özel yarıyla açıldı: 25 tablo verisi (`kanal`, `portal_kullanici` dahil), anahtar arşivi dört dosya kaynakla bayt-eşit.

## 13. Üretim satıcısı — `ORTAM=uretim` · `lisans.etkiliyazilim.com`

> **Durum:** HAZIRLANDI, UYGULANMADI (2026-09-30). Aynı `docker-compose.yml` + ZORUNLU `docker-compose.portal-genel.yml` (portalın tek yolu, §13.9), ayrı proje: `tekserp-satici-uretim` — konteyner/ağ/DB hacmi adları `ORTAM`'dan, host yolları · alt ağlar · sır grubu `.env`'den ([`deploy/satici/ornek-uretim.env`](../../deploy/satici/ornek-uretim.env)). Hazırlık satıcısı yerinde kalır; ikisi yan yana koşar.
> **adnansahin ETKİLENMEZ:** SAHINSRV'ye ve adnansahin kanalına hiçbir yazım yok; VDS'te `html/adnansahin/**` yalnız salt okunur `/yayin` bağıyla görünür (hazırlıkla aynı); DNS kaydı açılsa da etkinleşmemiş kurulum satıcıya istek atmaz (§9). Her VDS yazımından ÖNCE ve SONRA `deploy/vds-dogrula.sh` ✅; Traefik **yeniden başlatılmaz**.

### 13.0 Önkoşullar (kapı — biri yoksa DURULUR)

| Kapı | Ölçüm |
|---|---|
| Tören tamam | Mac: `node deploy/satici/uretim-toren.mjs dogrula` → ✅ ([`URETIM-SATICI-TOREN.md`](URETIM-SATICI-TOREN.md)) |
| Üretim kökü satıcının GÖMÜLÜ çapasında | `git grep -n "kok-2026-1" -- satici/sunucu/src/lisans-protokol/kok-anahtarlar.ts` → satır var (çapa dilimi indi). Yoksa satıcı ALT/İNDİRME'yi kullanmaz (`Kök kok-2026-1 güven çapasında yok`), `altGecerli: 0` |
| PAKET aracı + portal dalı indi | `git ls-files satici/sunucu/src/jwks-cekici.ts` → var (Dockerfile `test -f dist/jwks-cekici.js` kapısı; yoksa §13.2 imaj derlemesi durur) · PAKET aracı üretim kid'ini tanır ([`URETIM-SATICI-TOREN.md`](URETIM-SATICI-TOREN.md) §1.4) |
| vds-dogrula tabanı taze | `deploy/vds-dogrula.sh` → ✅ (fark varsa `LISANS-DEVREYE-ALMA-TESTFABRIKA.md` §1.2) |
| Hazırlığın `.env`'i Mac'te (sır içermez; ⑫ için) | `T=$(mktemp -d); ssh -p 2222 oguzhan@80.253.255.188 'cat /opt/stack/apps/tekserp-satici-hazirlik/.env' > $T/hazirlik-vds.env` |

Aşağıda (bash ve zsh'de aynı çalışır): `v() { ssh -p 2222 oguzhan@80.253.255.188 "$@"; }` · `K=/opt/stack/apps/tekserp-satici-uretim` · `SHA=<imaj sha>` · `Y=tekserp-satici-yedek:$SHA` (yardımcı konteyner imajı). Uzak betikler tırnaklı heredoc'la gider (`<<'UZAK'`): Mac'te hiçbir şey genişlemez, `K`/`Y`/`SHA` komut satırında verilir.

### 13.1 VDS'i ölç (salt okuma)

```bash
v 'docker network inspect $(docker network ls -q) --format "{{.Name}} {{range .IPAM.Config}}{{.Subnet}} {{end}}"; ip -4 route;
    free -m; df -h /; ls /opt/stack/apps; docker inspect traefik --format "{{.State.StartedAt}} {{.RestartCount}}";
    grep -n -A1 "tekserp-satici-hazirlik-kenar" /opt/stack/traefik/docker-compose.yml'
```

- `172.31.251.0/24` hiçbir ağ/rotayla çakışmamalı (bugün: 172.17–20 · hazırlık 172.31.252–254 · patron 172.31.250.0/28 + .16/28). Çakışırsa `ornek-uretim.env`'deki üç alt ağ başka bir /24'e taşınır.
- `free -m` kullanılabilir ≥ 1000 MB (üretim konteynerlerinin gerçek kullanımı 2026-09-30 tahmininde ~150 MB, tavanları 832 MB — o tahmin tüneli içeriyordu, `satici-jwks`i içermiyordu (tavan 96 MB) — tavanlar toplamı fiziksel belleği aşar; §13.10).
- Traefik `StartedAt`/`RestartCount` not edilir: kurulum boyunca DEĞİŞMEZ.
- Traefik compose'unda hazırlık kenar ağının satırları: bugün iki satır (servis `networks:` listesi + üst düzey tanım `{external: true}`) — §13.4-6 bu biçime göre.

### 13.2 İmaj (Mac)

Çapa commit'i `main`e indikten SONRA, temiz ağaçta: `deploy/satici/imaj-derle.sh` → `~/.tekserp/satici-imaj/tekserp-satici-<sha>.tar.gz` + `.sha256`, `SATICI_IMAJ` / `SATICI_YEDEK_IMAJ` satırları.

### 13.3 `.env` + yalıtım denetimi (Mac)

```bash
install -m 600 deploy/satici/ornek-uretim.env ~/.tekserp/satici-uretim-vds.env    # iki imaj satırını <sha> ile doldur
node deploy/satici/compose-denetle.mjs --env-file ~/.tekserp/satici-uretim-vds.env --diger-env $T/hazirlik-vds.env
```

Önce §13.9-1'in Access satırları `.env`'e girer (portal üretimde zorunlu; yer tutucuyla ⑬b ihlal verir). Beklenen: çıkış 0, `0 ihlal` ve **`ölçülmedi` YOK** (`--diger-env`siz üretim denetimi çıkış 2 verir; örnek şablonlarla 2026-10-05: 80 geçti, tek ihlal ⑬b — şablonun Access yer tutucuları): Ⓚ tünel kalıntısı yok · Ⓞ portal-genel örtüsü var · ⑬ portal maddeleri · her serviste ③b yalıtım gevşetmesi yok + ③c tanınan anahtarlar · ⑩ genel kök = Host · ⑪ gömülü çapa · ⑫a–f proje/DB hacmi/Host/sır grubu farklı, alt ağlar çakışmaz, anahtar/yedek/dosya/derleme/sır yolları ortak ya da iç içe değil (yalnız salt okunur `/yayin` ortak), portlar çakışmaz. Negatif sondalar (ölçüldü 2026-09-30, her biri çıkış 1): anahtar birimi hazırlığınki ⑫d · kenar ağı çakışık ⑫c · aynı `SIR_GID` ⑫a · genel kök hazırlığa ⑩ · ortak DB parola dosyası ⑫e · `ORTAM=hazirlik` kopyası ⑫a+⑫b · iç içe yedek dizini ⑫d · `GUVEN_CAPASI_DOSYASI` örtüsü ⑪.

### 13.4 Kurulum (VDS YAZIMI — kullanıcının "uygula" cümlesiyle)

0. **Önce:** `deploy/vds-dogrula.sh` → ✅.
1. **İmaj yükle** (başka konteynere dokunmaz):

   ```bash
   scp -P 2222 ~/.tekserp/satici-imaj/tekserp-satici-$SHA.tar.gz* oguzhan@80.253.255.188:/tmp/
   v "SHA=$SHA sh -s" <<'UZAK'
   cd /tmp && sha256sum -c "tekserp-satici-$SHA.tar.gz.sha256" && gunzip -c "tekserp-satici-$SHA.tar.gz" | docker load && rm "tekserp-satici-$SHA.tar.gz"*
   UZAK
   ```

2. **Dizinler + iki sır** (yardımcı konteyner, yalnız üç hedef yol bağlı; betik idempotent, var olan sırrı ezmez, sır basmaz):

   ```bash
   v "docker run --rm -i --network none --user 0 -e SIR_GID=61063 -v $K:/k -v /srv/tekserp-satici-yedek/uretim:/y \
        -v /srv/tekserp-satici-dosya/uretim:/d --entrypoint sh $Y -s" < deploy/satici/vds/uretim-hazirla.sh
   ```

   Beklenen: `db-parolasi: üretildi (0440 root:61063)` · `ic-api-belirteci: üretildi …` · `/k`: `anahtarlar` 10001:10001 700 · `derlemeler` 0:0 755 · `erisim-jwks` 10001:10001 755 (portal örtüsü açılana dek boş) · `sirlar` 0:61063 711 · `yedek-alici` 0:0 755 · `/y` `/d` 10001:10001 700.
3. **Dosyalar** (compose iki dosyası root 644 · `.env` oguzhan 600 — sudo'suz `docker compose` okusun · iki `.tkpub` 644):

   ```bash
   v 'install -d -m 700 ~/satici-uretim-gecici'
   scp -P 2222 deploy/satici/docker-compose.yml deploy/satici/docker-compose.portal-genel.yml ~/.tekserp/satici-uretim-vds.env \
     ~/.tekserp/satici-uretim/yedek-alici/*.tkpub oguzhan@80.253.255.188:satici-uretim-gecici/
   v "K=$K Y=$Y sh -s" <<'UZAK'
   set -eu
   docker run --rm --network none --user 0 -v "$HOME/satici-uretim-gecici:/g:ro" -v "$K:/k" --entrypoint sh "$Y" -c "
     install -m 644 -o 0 -g 0 /g/docker-compose.yml /g/docker-compose.portal-genel.yml /k/ &&
     install -m 644 -o 0 -g 0 /g/*.tkpub /k/yedek-alici/ &&
     install -m 600 -o $(id -u) -g $(id -g) /g/satici-uretim-vds.env /k/.env"
   rm -rf "$HOME/satici-uretim-gecici"
   cd "$K" && docker compose config -q && ls -lna "$K" "$K/yedek-alici"
   UZAK
   ```

4. **Anahtar birimi** — törenin `anahtarlar/` altı dosyası + PAKET ara kopyası (USB gelene dek; kullanıcı kararı; parolalı, satıcı okumaz, yedek döngüsü şifreli arşive alır). ALT/İNDİRME düz metin → geçici kopya shred'lenir:

   ```bash
   v 'install -d -m 700 ~/satici-anahtar-gecici'
   scp -P 2222 -p ~/.tekserp/satici-uretim/anahtarlar/* ~/.tekserp/satici-uretim/paket/paket-2026.paket.json \
     oguzhan@80.253.255.188:satici-anahtar-gecici/
   v "K=$K Y=$Y sh -s" <<'UZAK'
   set -eu
   docker run --rm --network none --user 0 -v "$HOME/satici-anahtar-gecici:/g:ro" -v "$K/anahtarlar:/a" --entrypoint sh "$Y" \
     -c 'install -m 600 -o 10001 -g 10001 /g/* /a/'
   shred -u "$HOME"/satici-anahtar-gecici/* && rmdir "$HOME/satici-anahtar-gecici"
   UZAK
   # Bayt eşitliği (iki taraf aynı biçimde: özet + ad, ada göre sıralı):
   v "docker run --rm --network none --user 0 -v $K/anahtarlar:/a:ro --entrypoint sh $Y -c 'cd /a && sha256sum * | sort -k2'" > $T/vds-anahtar.sha
   (cd ~/.tekserp/satici-uretim && for f in anahtarlar/* paket/paket-2026.paket.json; do echo "$(shasum -a 256 "$f" | cut -d' ' -f1)  $(basename "$f")"; done | sort -k2) | diff - $T/vds-anahtar.sha && echo "✅ anahtar birimi Mac ile bayt-eşit (7 dosya)"
   ```

   USB kopyası alındıktan sonra PAKET ara kopyasını kaldırmak (kullanıcı kararı): `v "docker run --rm --network none --user 0 -v $K/anahtarlar:/a --entrypoint rm $Y /a/paket-2026.paket.json"`.
5. **Ağlar + konteynerler (başlatmadan):** `v "cd $K && docker compose up --no-start"` → dört ağ (`tekserp-satici-uretim-kenar` · `-ic` · `-ic-api` · portal örtüsünün `-jwks-cikis`'i), DB hacmi `tekserp-satici-uretim-pg`, konteynerler yaratılır, hiçbiri başlamaz.
6. **Traefik bağlantısı (yeniden başlatmasız) + kalıcı satır:**

   ```bash
   v 'docker network connect tekserp-satici-uretim-kenar traefik'
   v "Y=$Y sh -s" <<'UZAK'
   set -eu
   D=/opt/stack/traefik; DAMGA=$(date +%Y%m%d_%H%M)
   docker run --rm --network none --user 0 -v "$D:/t" --entrypoint sh "$Y" -c "
     cp -p /t/docker-compose.yml /t/docker-compose.yml.yedek-$DAMGA-satici-uretim &&
     sed -e '/tekserp-satici-hazirlik-kenar/{p;s/tekserp-satici-hazirlik-kenar/tekserp-satici-uretim-kenar/}' /t/docker-compose.yml > /t/docker-compose.yml.yeni"
   diff "$D/docker-compose.yml" "$D/docker-compose.yml.yeni" || true      # BEKLENEN: yalnız iki eklenen satır (hazırlık satırlarının 'uretim' kopyası)
   docker compose --project-directory "$D" -f "$D/docker-compose.yml.yeni" config | grep -A2 -E '^  tekserp-satici-(hazirlik|uretim)-kenar:'   # ikisi de external: true
   UZAK
   ```

   Fark iki satırdan başkaysa ya da `external: true` ikisinde birden yoksa DUR, `.yeni`yi sil (tanım iki satırlıysa sed'in tek satır kopyası YAML'ı bozar — elle ekle). Uygunsa içerik yerinde yazılır (sahip/izin/inode korunur): `v "docker run --rm --network none --user 0 -v /opt/stack/traefik:/t --entrypoint sh $Y -c 'cat /t/docker-compose.yml.yeni > /t/docker-compose.yml && rm /t/docker-compose.yml.yeni'"`. Traefik bu satırları bir sonraki yeniden yaratılışında okur.
7. **Göç** (geri alınamaz eşik; boş DB): `v "cd $K && docker compose --profile goc run --rm satici-goc"` → "All migrations have been successfully applied".
8. **Başlat:** `v "cd $K && docker compose up -d"` → `satici` · `satici-db` · `satici-yedek` · `satici-jwks`; günlük `v "cd $K && docker compose logs satici | grep SATICI_DINLIYOR"` → `genel=4610 ic=4612 erisim=4613`. JWKS çıkış kuralı (sudo) ve Access/DNS: §13.9.
9. **Modül kasası** (anahtar SSH stdin'iyle konteynerin tmpfs `/tmp`'ine — VDS diskine düşmez — içe aktarılır, silinir; `compose run` KULLANILMAZ, sabit adresler çakışır):

   ```bash
   v 'docker exec -i tekserp-satici-uretim sh -c "umask 077; cat > /tmp/mk.json"' < ~/.tekserp/satici-uretim/modul-anahtarlari/depo.multiEnabled.1.json
   v 'docker exec tekserp-satici-uretim satici-baslat node dist-cli/scripts/modul-anahtari.js ice-aktar --dosya=/tmp/mk.json; docker exec tekserp-satici-uretim shred -u /tmp/mk.json'
   ```

   Beklenen: `✅ kasaya alındı: depo.multiEnabled 1. sürüm · mk-…` (künyedeki kid).
10. **İlk portal yöneticisi** (parola Mac'teki 0600 dosyadan stdin'e; TOTP sırrı ekrana değil 0600 dosyaya — authenticator'a oradan girilir):

    ```bash
    umask 077; P=~/.tekserp/sirlar/portal-yonetici-uretim.parola; openssl rand -base64 24 > $P
    { cat $P; cat $P; } | v 'docker exec -i tekserp-satici-uretim satici-baslat node dist-cli/scripts/portal-kullanici.js ekle --kullanici=<ad> --ad-soyad="<Ad Soyad>" --rol=SATICI_YONETICI' \
      > ~/.tekserp/sirlar/portal-yonetici-uretim.totp
    ```

    Kanal/müşteri/kurulum kayıtları bu runbook'un dışındadır (geçiş dilimi); adnansahin için HİÇBİR kayıt açılmaz.
11. **İlk yedek + Mac'e çekme + açma** (§13.7).
12. **Sonra:** `deploy/vds-dogrula.sh` → ✅ · Traefik `StartedAt`/`RestartCount` §13.1'deki gibi.

### 13.5 DNS (kullanıcı — Cloudflare)

`lisans` A → `80.253.255.188`, **proxy AÇIK** (Origin CA `*.etkiliyazilim.com`). Kayıttan ÖNCE kökenden ölçülebilir (sertifika yalnız CF'ye güvenilir → `-k`): `curl -sk --resolve lisans.etkiliyazilim.com:443:80.253.255.188 https://lisans.etkiliyazilim.com/saglik` → `{"success":true}`. Kayıt açılınca fabrikaların varsayılan satıcı adresi (`DEFAULT_LICENSE_SERVER_URL`) yanıt vermeye başlar; etkinleşmemiş kurulum yine hiç istek atmaz (adnansahin dahil).

### 13.6 Doğrulama

| Ölçüm | Nereden | Beklenen |
|---|---|---|
| `curl -s https://lisans.etkiliyazilim.com/saglik` | internet | `{"success":true}` |
| aynı kökte `/portal/saglik` · `/portal/` · `/ic/v1/zil` | internet | `404` (portal ve iç API genelde YOK) |
| `/v1/yokla` imzasız · `/v1/etkinlestir` boş gövde | internet | `401 ISTEK_GECERSIZ` · `400 GOVDE_GECERSIZ` |
| `/q` · `/bayi/` | internet | `200` |
| `/d/olmayan-belirtec` | internet | `404` + satıcının `Cache-Control: no-store` başlığı (Traefik'in kendi 404'ü değil) |
| Tarayıcı: `https://portal.etkiliyazilim.com` → e-posta kodu → §13.4-10 kullanıcısıyla parola + TOTP → pano | izinli e-posta | giriş 200; **Sistem sağlığı** kartı: Güven çapası Gömülü · **geçerli alt sertifika 1** · indirme anahtarı Var · anahtar uyarısı Yok · JWKS Taze ([`PORTAL-GENEL-ERISIM.md`](PORTAL-GENEL-ERISIM.md) §6) |
| `curl -m 5 http://80.253.255.188:4611/` · VDS'te `ss -ltn \| grep 4611` | internet · VDS | zaman aşımı/red · boş |
| `v "cd $K && docker compose ps"` · `docker stats --no-stream` | VDS | `satici` · `satici-db` · `satici-yedek` · `satici-jwks` `healthy`/`Up`; sınırlar compose'daki gibi |
| `curl -s https://lisans-test.etkiliyazilim.com/saglik` | internet | `{"success":true}` — hazırlık etkilenmedi |
| `curl -sI https://guncelleme.etkiliyazilim.com/adnansahin/electron/latest.yml` + `deploy/vds-dogrula.sh` | Mac | kurulum öncesiyle aynı durum kodu · adnansahin AYNI |
| İç API kapısı (§7'deki geçici konteyner, `--network tekserp-satici-uretim-ic-api --ip 172.31.251.35`, `<IC_API_IP>` = `172.31.251.34`) | VDS | Bearer'lı `404 BULUNAMADI` · Bearer'sız `401 IC_KIMLIK_GECERSIZ`; `--ip`siz ikisi de `404` |
| Yedek açılır mı (§13.7) | Mac | `pg_restore --list` dolu; anahtar arşivi `anahtarlar/` ile bayt-eşit |

### 13.7 Yedek döngüsü — iki alıcı (üçüncüsü Etkili Yazılım çevrimdışı anahtarı, töreni gelince)

Döngü hazırlıkla aynıdır (`yedek-dongusu.sh`: günde bir DB dökümü + anahtar birimi arşivi, ikisi de `.tkenc`; 30 gün, en az 7 kopya). Alıcılar `$K/yedek-alici/`: `satici-uretim-mac` (özel yarı yalnız Mac, rutin açma) · `satici-uretim-kurtarma` (özel yarı KÖK parolasıyla sarılı; Mac → USB). VDS kendi yedeğini AÇAMAZ ("Yerel anahtar (yerel.tkkey) yok" uyarısı BEKLENİR). Üçüncü alıcı (Etkili Yazılım çevrimdışı, [`YEDEK-SIFRELEME.md`](YEDEK-SIFRELEME.md) §2): açık yarısı `$K/yedek-alici/etkili.tkpub` olarak konunca bir sonraki yedekten itibaren alıcıdır (eskiler yeniden şifrelenmez).

```bash
v "cd $K && docker compose exec -T satici-yedek /arac/yedek-dongusu.sh tek && docker compose exec -T satici-yedek ls -1 /yedek"
install -d -m 700 ~/.tekserp/satici-uretim-yedek
for f in satici_<damga>.dump.tkenc anahtarlar_<damga>.tar.tkenc; do
  v "cd $K && docker compose exec -T satici-yedek cat /yedek/$f" > ~/.tekserp/satici-uretim-yedek/$f
done
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"; umask 077
(cd Teks-Erp && npx tsx scripts/yedek-sifrele.ts coz --girdi ~/.tekserp/satici-uretim-yedek/satici_<damga>.dump.tkenc \
  --cikti /tmp/satici-uretim.dump --anahtar ~/.tekserp/satici-uretim/yedek-ozel/satici-uretim-mac.txt) && pg_restore --list /tmp/satici-uretim.dump | head && rm -P /tmp/satici-uretim.dump
```

**Düzenli çekim:** yedekler VDS'te durur; VDS kaybında işe yaramazlar → haftada bir en yeni ikili Mac'e çekilir (yukarıdaki döngü, özetler iki uçta `sha256sum`/`shasum -a 256`).

### 13.8 Geri alma (ters sıra)

1. Patron üretime bağlandıysa ÖNCE hazırlığa geri döner ([`PATRON-BULUTU-KURULUM.md`](PATRON-BULUTU-KURULUM.md) §14.8) — patron bağlıyken `ic-api` ağı silinemez.
2. Traefik compose'u yedeğinden (ağ silinmeden ÖNCE — dosya dış ağı andığı sürece Traefik yeniden yaratılamaz): `v "docker run --rm --network none --user 0 -v /opt/stack/traefik:/t --entrypoint sh $Y -c 'cat /t/docker-compose.yml.yedek-<damga>-satici-uretim > /t/docker-compose.yml'"`.
3. `v "docker network disconnect tekserp-satici-uretim-kenar traefik; cd $K && docker compose down"` — DB hacmi `tekserp-satici-uretim-pg` ve dizinler KALIR (silmek kullanıcı kararı).
4. DNS kaydı (kullanıcı) · `v "docker rmi tekserp-satici:$SHA tekserp-satici-yedek:$SHA"` (hazırlık başka etiket kullanıyorsa) · sonunda `deploy/vds-dogrula.sh` → ✅.

Sürüm yükseltme hazırlıkla aynı (§8 "Sürüm yükseltme"), `cd $K` ile.

### 13.9 Portal — üretimde ZORUNLU örtü (portalın tek yolu)

Portal yalnız bu kurulumdadır (tek portal `portal.etkiliyazilim.com`; bugün hazırlığa bağlıysa buraya taşınır, hazırlıkta örtü ve Access satırları kaldırılır — §4a). Örtü `docker-compose.portal-genel.yml` satıcıya ağ EKLEMEZ; Access imza anahtarlarını `satici-jwks` yan konteyneri kendi `jwks-cikis` köprüsünden çekip `erisim-jwks/` dizinine yazar, satıcı o dizini SALT OKUNUR bağlar; ERİŞİM dinleyicisi 4613 kenar adresinde, yayımlanmaz. Cloudflare (Access uygulaması, DNS `portal` kaydı) ve JWKS çıkış kuralı [`PORTAL-GENEL-ERISIM.md`](PORTAL-GENEL-ERISIM.md) §2–§5'e göre, kullanıcının "uygula" cümlesiyle:

1. `.env`'deki portal satırları doldurulur (`ornek-uretim.env` § Portal GENEL ERİŞİMİ — §13.3'ten ÖNCE): `COMPOSE_FILE=docker-compose.yml:docker-compose.portal-genel.yml[:docker-compose.bildirim.yml]` · `PORTAL_HOST` · `CF_ACCESS_TAKIM_ALANI` · `CF_ACCESS_AUD` · `ERISIM_JWKS_DIZINI_HOST` (§13.4-2'de kuruldu) · `JWKS_CIKIS_AGI` (`172.31.251.48/29`, §13.1 ölçümüyle çakışmadığı doğrulanır); örtü dosyası `$K`e §13.4-3'te kopyalanır; bildirim örtüsü açıksa `BILDIRIM_PORTAL_ADRESI=https://<PORTAL_HOST>/portal`.
2. Mac'te `node deploy/satici/compose-denetle.mjs --env-file <.env> --diger-env <hazırlığın .env'i>` → kip satırında `örtü: portal-genel`, Ⓞ + ⑬a–f yeşil (PORT_ERISIM 4613 · ERISIM_BIND = kenar adresi · 4613 yayımlanmaz · Access ayarı biçimli · JWKS bağı satıcıda salt okunur / yan konteynerde yazılır, `create_host_path` yok · `satici-jwks` satıcı imajı + çekici giriş noktası, sırsız/bağsız/portsuz · `jwks-cikis` tek üyeli, internal değil · portal yönlendiricisi 4613'e, ipallowlist = `CLOUDFLARE_NETWORKS` birebir) ve `satici-jwks` dahil her serviste ③b/③c (örnek şablonlarla 72 geçti, 2026-09-30; yan konteynere `volumes_from` · `pid: service:` · `cap_add` gibi gevşetme bekçi `test_compose_yalitimi`de ❌). Negatif sondalar (ölçüldü 2026-09-30, portal dalının örtüsüyle; her biri çıkış 1): satıcıya çıkış ağı · `jwks-cikis` internal · 4613 yayını · JWKS bağı yazılır · yan konteynere anahtar birimi · eksik Cloudflare aralığı · portal hizmeti 4611 (emekli tünel portu) · genel yönlendirici hizmetsiz · biçimsiz AUD · `jwks-cikis`e ikinci üye · üçüncü yönlendirici · yan konteyner başka imaj · `create_host_path` açık.
3. §13.4-8'de `docker compose up -d` (imaj `dist/jwks-cekici.js`'yi taşımalı — Dockerfile `test -f` kapısı) → JWKS çıkış kuralı, DNS `portal` kaydının üretime geçişi ve Access uygulaması [`PORTAL-GENEL-ERISIM.md`](PORTAL-GENEL-ERISIM.md)'de.

### 13.10 Açık riskler

- **Bellek tavanları:** hazırlık + üretim satıcısı + patron + güncelleme tavanları toplamı (~3 GB) fiziksel belleği (2972 MB) aşar; gerçek kullanım düşüktür (§12, patron §13). Yük altında sorun görülürse hazırlık satıcısı durdurulabilir (kullanıcı kararı; testfabrika üretime geçtikten sonra).
- **PAKET ara kopyası VDS'te:** parolalı (paket parolası ≠ kök parolası); USB kopyası alınınca kaldırılabilir (§13.4-4). Kök parolası portalda yazıldığı için iki parola ayrıdır — portal ele geçse paket anahtarı açılmaz.
- **ALT sertifikası 180 gün:** bitişten önce rotasyon ([`URETIM-SATICI-TOREN.md`](URETIM-SATICI-TOREN.md) §6); satıcı anahtar birimini dakikada bir yeniden okur. ⚠️ Lisans v2 (G4) inince ALT · ara imzacı · İNDİRME 120 gün ve üç ayda bir `donem` töreni (L2-3).
- `cf-connecting-ip` taklidi ve kök anahtarın VDS'te (parolalı) durması §11'deki gibi (kök için ⚠️ lisans v2: A düzeniyle VDS'ten kaldırılır).

## 14. İlk kurulum dağıtımı — tek arşiv, derleme deposu, tek bağlantı

Portalda bir bağlantı BİR derleme dosyası verir ([`links.service.ts`](../../satici/sunucu/src/distribution/links.service.ts) `createLinkTx`); setup ise yanında backend zip + PG zip + `pg.json` (+ `etkili.tkpub`) ister. Müşteriye bu yüzden TEK arşiv gider (yönetici kararı 2026-10-02): setup + imzalı korumalı backend + PG paketi + `pg.json` (+ tkpub) + `SHA256SUMS` + `BENIOKU.txt`, kök düz.

### 14.1 Arşiv (Mac)

```bash
node deploy/kurulum/kurulum-arsivi.mjs --setup <dizin>/TeksERP-Kurulum-<sürüm>.exe \
  --backend <imzalı tekserp-backend-*.zip> --pg <postgresql-*.zip> --pg-kunye <imzalı pg.json> \
  [--tkpub <etkili.tkpub>] --musteri <kanal> --cikti <depo dışı dizin>
```

Çıktı `TeksERP-Kurulum-<kanal>-<backend sürümü>.zip` + `.sha256`. Çıkış 0 hazır · 1 kapı DUR (arşiv bırakılmaz) · 2 ÖLÇÜLEMEDİ. Setup'ın kararı arşivden ÖNCE verilir: adlar `kurulum.ps1 GirdiCoz` desenlerinden (metinden okunur), PAKET.json kanalı = `--musteri`, KORUMALI win-x64, hizmet adı + hizmet ikilileri, derlemenin çapa kipi = kanal `backend.guvenCapasi`, PROVA değil, imza `backend-bildirim.ts dogrula` ile kanalın gerçek çapasından (test çapası geçirilmez) + `--pg-kunye`, PG zip `pg-paketle.mjs --dogrula`, `pg.json` yükü bu zip'i ve kaydı gösterir, tkpub yalnız açık anahtar. Arşiv yeniden açılıp her girdi SHA256SUMS'a ve kaynağa karşı ölçülür (+ `unzip -t`). `--prova` imza kapılarını UYARIYA düşürür ve adı `-PROVA-IMZASIZ` yapar (yapı denemesi; müşteriye verilmez, `derleme-koy` üretime koymaz). Bekçi `node scripts/test_kurulum_arsivi.mjs`.

### 14.2 Satıcının derleme deposuna koy (KURU → kullanıcının "uygula" cümlesiyle)

```bash
node deploy/satici/derleme-koy.mjs --ortam uretim --dosya <cikti>/TeksERP-Kurulum-<kanal>-<sürüm>.zip            # KURU: yalnız okuma + plan
node deploy/satici/derleme-koy.mjs --ortam uretim --dosya <cikti>/TeksERP-Kurulum-<kanal>-<sürüm>.zip --uygula   # yazar
```

KURU: yerel denetim (sha256 · yanındaki `.sha256` · satıcının ad kuralı `storage.ts` `BUILD_NAME`/`BUILD_EXTENSIONS`ten · PROVA adı üretime RED) + VDS'te tek ssh ile YALNIZ OKUMA (`lisans-devreye/lib/ag.mjs` sözleşmesi): satıcının `/derlemeler` bağı (`<K>/derlemeler false` olmalı), yardımcı imaj (`<ortam>-yedek` konteynerinin imajı), dizin sahibi/izni (bugün `0:0 755`, §13.4-2), aynı adlı dosya, disk; sonra `--uygula`nın koşacağı komutların TAM listesi. `--uygula`: `deploy/vds-dogrula.sh` (önce, AYNI) → `~/derleme-koy-<damga>` → scp → `sha256sum -c` → yardımcı konteyner (`--network none --user 0`, yalnız `/g:ro` + depo) gizli ada `install -m 0644 -o <dizin sahibi>` + `ln` ile yayın (var olan dosya EZİLMEZ) → geçici dizin silinir → ölçüm (0644, özet, satıcı konteyneri görüyor mu) → `vds-dogrula.sh` (sonra, çıktısı öncekiyle birebir). Aynı adlı dosya: içerik aynıysa dokunulmaz, farklıysa DUR. Bekçi `node scripts/test_derleme_koy.mjs`. İlk KURU ölçüm (2026-10-02, üretim): bağ `/opt/stack/apps/tekserp-satici-uretim/derlemeler false` · yardımcı imaj `tekserp-satici-yedek:4467956b3db8` · dizin `0:0 755` · 3 dosya; `vds-dogrula` önce/sonra AYNI.

### 14.3 Portal: tek bağlantı

Kurulumlar → kurulum → **İlk kurulum → Bağlantı ver** → derleme listesinden arşiv (`GET /dagitim/derlemeler`) → `/d/<belirteç>`. Bağlantı doğarken sunucu dosyanın sha256'sını ve boyunu DONDURUR; dosya sonradan değişirse indirme 410 (`openVerified`) — bu yüzden depoya konan dosya ezilmez, yeni sürüm yeni addır. Müşteri: indir → arşive sağ tık **Tümünü ayıkla** → çıkan klasörde `TeksERP-Kurulum-<sürüm>.exe`.

### 14.4 Ölçülen sınırlar (tek dosya modeli)

| Konu | Ölçüm | Kaynak |
|---|---|---|
| Ad / uzantı | `^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$` + `exe msi apk zip tar gz`; uymayan dosya listelenmez | `storage.ts:39,42,89-92,101-115` |
| Boyut | derleme için tavan YOK (`DOSYA_AZAMI_MB` yalnız müşteri yüklemesi) — bağlantı doğarken akışla özetlenir | `config.ts:166` · `distribution-routes.ts:84` · `links.service.ts:86-88` |
| İçerik tipi | ilk kurulum indirmesi `application/octet-stream`, `Content-Disposition: attachment` (RFC 6266), `no-store` | `links.service.ts:142-143` · `distribution-public.ts:45-48,58-66` |
| Akış | belleğe alınmaz: önce gövde boy+özetle doğrulanır (tam okuma), sonra `pipeline` ile akar; hak indirme BAŞINDA tüketilir | `distribution-public.ts:76-89,116-127` |
| Zaman aşımı | satıcıda açık ayar yok (Node varsayılanı; yanıt akışına süre sınırı yok). Cloudflare üzerinden ~200 MB tek yanıt ÖLÇÜLMEDİ | — |
| Arşiv boyu | prova 202.317.746 B (setup ~6 MB + backend ~165 MB + PG 35,5 MB) | `~/.tekserp/demofabrika-paket/arsiv-prova/` |

Windows tarafı (koddan; Windows'ta GUI ile ÖLÇÜLMEDİ): arşivin İÇİNDEN çift tıklanan setup tek başına geçici dizine çıkar, yanındaki dosyaları göremez ve ön ölçüm engelleriyle ("TEK tekserp-backend-*.zip olmalı (bulunan: 0)" · "TEK postgresql-*.zip …" · "pg.json … yok", `tekserp-kurulum.iss` `OlcumEngelleri`) hiçbir şey yazmadan durur — `BENIOKU.txt` "önce Tümünü ayıkla" der. `SHA256SUMS`/`BENIOKU.txt` setup desenleriyle çakışmaz (bekçi §6c). "Tümünü ayıkla" internet işaretini (Zone.Identifier) çıkan dosyalara taşır: imzasız setup'ta SmartScreen "Ek bilgi → Yine de çalıştır" beklenir; backend/PG zip'lerini setup .NET `ZipFile` ve Rust doğrulayıcıyla açar (işaret taşımaz), betikler `-ExecutionPolicy Bypass` ile koşar. thinkpad-1'de Akıllı Uygulama Denetimi KAPALI (`VerifiedAndReputablePolicyState=0`, 2026-10-02) — açık bir makinede imzasız setup "Yine de çalıştır" seçeneği olmadan engellenir (Authenticode gelene dek açık risk).
