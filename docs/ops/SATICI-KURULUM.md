# Satıcı (lisans) sunucusu — tekserp-vds kurulum runbook'u

> **Durum (2026-09-29):** hazırlık satıcısı tekserp-vds'te **KURULU** — `ORTAM=hazirlik`, **geri döngü kipinde** (§4a; Tailscale kullanıcı onayı bekliyor), imaj `tekserp-satici:0ca31403525a`, `https://lisans-test.etkiliyazilim.com` yanıt veriyor, portal Mac'ten `portal-baglan.mjs` ile. Kurulum kaydı ve ölçümler §12. Kullanıcıya kalan: Tailscale onayı (§4) ve ana kipe geçiş (§4a), sudo gerektiren adımlar (§12 "sudo'suz kurulum").
> Yapıtlar: [`deploy/satici/`](../../deploy/satici/) (compose · Dockerfile · imaj derleme · yalıtım denetimi · VDS birimi). Protokol: [`LISANS-PROTOKOLU.md`](../design/LISANS-PROTOKOLU.md). Alan kuralları: [`kurallar/lisans.md`](../kurallar/lisans.md). Sunucu envanteri: [`SUNUCU-ENVANTERI.md`](SUNUCU-ENVANTERI.md).
> **Değişmez:** her VDS yazımından ÖNCE ve SONRA `deploy/vds-dogrula.sh` → *adnansahin baytları AYNI* (salt okuma, çıkış 0). Fark çıkarsa dur.

## 0. Kapsam

| Kurulur | Kurulmaz |
|---|---|
| `ORTAM=hazirlik` — `lisans-test.etkiliyazilim.com` (genel) + tailnet portalı (+ isteğe bağlı genel portal `portal.<alan>`, Cloudflare Access — [`PORTAL-GENEL-ERISIM.md`](PORTAL-GENEL-ERISIM.md)) | Üretim kökü (`kok-<yıl>-<n>`, kullanıcı töreni) ve `lisans.etkiliyazilim.com` — ileride **aynı** compose, `ORTAM=uretim` `.env`'iyle ayrı proje |
| Hazırlık kökü `hazirlik-2026-1` (yalnız TEST/DEMO imzalar), ALT `alt-hazirlik-2026-1`, İNDİRME `ind-hazirlik-2026` | CF Worker (Faz 3a) |
| Portal web arayüzü (1f): satıcı arayüzü `/portal` (tailnet; genel portal kipinde ERİŞİM dinleyicisinde de, Access arkasında — kök parolalı imza formu orada açılmaz) · bayi arayüzü `/bayi` (genel) — imajın içinde (`/uygulama/web`, §2.2) | Fabrika verisi — satıcı DB'si yalnız lisans kayıtlarını taşır |
| Satıcının kendi PG16'sı + şifreli yedek döngüsü | |

Dokunulmayan: `tekserp-guncelleme` (compose · nginx · `html/` · `defter/`), `/srv/tekserp-yedek`, `/srv/tekserp-arsiv`. Traefik'e yalnız **bir ağ bağlantısı** eklenir (yeniden başlatmasız, §5.5).

## 1. Mimari

```
Cloudflare (proxy AÇIK) ─443─► Traefik (websecure, Origin CA *.etkiliyazilim.com)
                                  │  Host(`lisans-test.etkiliyazilim.com`)
                                  ▼  ağ: tekserp-satici-hazirlik-kenar (internal)
                            satici :4610 GENEL  (/v1/* · /q · /bayi/api · /saglik)
Mac (tailnet) ─► 100.x.y.z:4611 (tailscale0) ─DNAT─► ağ: …-tailnet ─► satici :4611 TAILNET (/portal/*)
Tarayıcı ─► Cloudflare Access ─► Traefik Host(`portal.<alan>`) + ipallowlist(CF) ─► satici :4613 ERİŞİM (/portal/*, her istekte Access JWT; kök parolalı uç 404) — yalnız portal-genel üst dosyasıyla
                            satici ◄─ ağ: …-ic (internal) ─► satici-db (PG16) ◄─ satici-yedek
patron (ayrı compose, PATRON_IC_IP) ─ ağ: …-ic-api (internal) ─► satici :4612 İÇ (/ic/v1/* · Bearer)
```

| Konteyner | İmaj | Kullanıcı | Bellek · CPU · süreç | Ağlar |
|---|---|---|---|---|
| `tekserp-satici-hazirlik` | `tekserp-satici:<sha>` (node 24, `node dist/server.js`) | 10001 | 384 MB · 0,75 · 200 | kenar (sabit IP) · ic · tailnet (sabit IP) · ic-api (sabit IP) |
| `tekserp-satici-hazirlik-db` | `postgres:16-alpine` (özetle sabit) | 70 | 256 MB · 0,5 · 100 | ic |
| `tekserp-satici-hazirlik-yedek` | `tekserp-satici-yedek:<sha>` (pg_dump 16 + `yedek-sifrele.cjs`) | 10001 | 128 MB · 0,25 · 50 | ic |
| `satici-goc` (profil `goc`, tek seferlik) | `tekserp-satici:<sha>` | 10001 | 384 MB · 0,5 · 100 | ic |

**İç API (patron bulutu → satıcı, §5b):** satıcının üçüncü dinleyicisi `IC_API_IP:4612` yalnız `ic-api` köprüsünde (internal, port yayını YOK). Uygulama kapısı fail-closed: istek o soketten gelmeli VE kaynak adres `PATRON_IC_IP/32` olmalı (soket adresi; başlık okunmaz) → değilse 404; ardından ortak Bearer (docker secret `ic_api_belirteci`, sabit zamanlı) → yanlışsa 401. Sır dosyası yoksa/herkese açıksa/zayıfsa iç dinleyici hiç açılmaz (günlük: `iç API KAPALI`). Köprünün ağ geçidi (.1 = VDS'in kendisi) ve dinamik aralık kaynak sayılmaz — host kabuğu da, sonradan ağa katılan bir konteyner de iç API'ye ulaşamaz.

Hepsinde: kök FS **salt okunur** · `cap_drop: ALL` · `no-new-privileges` · docker soketi **bağlı değil** · `init`. Satıcı `web` ağına katılmaz: güncelleme/patron/kiracı konteynerleri satıcıya ağdan ulaşamaz, satıcı onlara ulaşamaz. Bu değişmezleri `deploy/satici/compose-denetle.mjs` ölçer (§2.4) — kuruluma o yeşil vermeden geçilmez.

**Tailnet yayını neden böyle:** satıcının portal dinleyicisi joker adrese bağlanamaz (açılışta RED) ve kaynak ağı 100.64/10 · geri döngü dışındaysa 404 döner. Docker port yayını **yalnız VDS'in Tailscale IP'sine** yapılır; satıcı konteyneri tailnet ağındaki **sabit** IP'sine bağlanır. Dışarıdan tailscale0 üzerinden gelen istek DNAT'la kaynak adresi korunarak (100.x) girer. Docker'ın vekiliyle gelen istek (yerel/konteyner yolu) köprü ağ geçidinin adresini taşır; bu yüzden **köprü ağları 100.64/10'un DIŞINDA** seçilir — aksi hâlde vekilden gelen her istek tailnet kaynağı sayılır (ölçüldü, yerel duman testi: tailnet ağı 100.100.100.0/28 iken host'tan yayımlı porta gelen istek portalı 200 açtı; 172.31.253.0/28 iken 404 — denetim ⑥). VDS'in KENDİSİNDEN (host kabuğu) gelen istek Docker'ın NAT yoluna göre VDS'in kendi tailnet adresiyle de girebilir: host'taki bir kabuk kullanıcısı portal giriş ekranına ulaşabilir, girişi parola + TOTP korur (kabul edilen; §7'de ölçülüp yazılır). Üçüncü kat: `DOCKER-USER` zincirinde tailnet portuna yalnız `tailscale0`'dan gelinir, satıcının tailnet köprüsünden yeni dış bağlantı açılmaz (Docker yayımlı portlarda ufw'yi atlar; kural bu yüzden DOCKER-USER'da).

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
- Hazırlık kökü fabrika programının güven çapasındadır (`ROOT_PUBLIC_KEYS`, yalnız TEST/DEMO) — satıcı gömülü çapayı kullanır, `GUVEN_CAPASI_DOSYASI` **verilmez**.

### 2.2 İmaj

```bash
deploy/satici/imaj-derle.sh                 # HEAD'den (git archive); kirli ağaç RED; linux/amd64
# → ~/.tekserp/satici-imaj/tekserp-satici-<sha>.tar.gz + .sha256 ; SATICI_IMAJ / SATICI_YEDEK_IMAJ satırlarını basar
```

VDS'te derleme YOK, kaynak VDS'e gitmez. Portal kullanıcı CLI'ı imajda derlenmiş durur (`dist-cli/scripts/portal-kullanici.js`). Web arayüzü (`satici/web`) Dockerfile'ın `web` aşamasında derleme makinesinin KENDİ mimarisinde derlenir (çıktı statik dosya, öykünme gerekmez); imaja yalnız `dist/` geçer → `/uygulama/web` (`PORTAL_WEB_DIZINI`). İmaj `src/`, `tsx`, web kaynağı ya da web `node_modules`'ü taşımaz (ölçüm §12).

### 2.3 Sunucunun `.env`'i

`deploy/satici/ornek.env`'den doldurulur (sır İÇERMEZ): `TAILNET_IP` §4'ten, ağlar §3'ten, imaj etiketleri §2.2'den.

### 2.4 Yalıtım denetimi — kurulumdan ÖNCE yeşil

```bash
node deploy/satici/compose-denetle.mjs --env-file <doldurulmuş .env>   # 0 temiz · 1 ihlal · 2 ölçülemedi
```

① port yalnız `satici`de ve yalnız 100.64/10 adresine · ② docker soketi yok · ③ salt okunur/yetenek yok/root değil/sınırlı · ④ kenar + ic internal, dış ağa katılım yok · ⑤ anahtar birimi salt okunur · ⑥ köprü ağları tailnet/geri döngü aralığı dışında · ⑥b kenarda dinamik aralık alt ağda, satıcının sabit adresi onun dışında · ⑦ Traefik yalnız satıcıda ve kenar ağında, DB portsuz · Ⓛ geri döngü kipi (§4a): ① yerine portsuzluk + `TAILNET_BIND=127.0.0.1` + `portal-tunel` satıcının ad alanında, portsuz/birimsiz, köprü adresinde + tailnet internal; ana kipte geri döngü kalıntısı ❌. Denetim `.env`'deki `COMPOSE_FILE`'ı okur (ya da çoklu `-f`). Negatif sondalar (docker soketi · `read_only` yok · anahtar rw · `web` ağı · 0.0.0.0 yayını · kenar internal değil · DB portu) her biri kırmızı verdi.

## 3. VDS'i ölç (salt okuma)

```bash
ssh tekserp-vds 'docker version --format "{{.Server.Version}}"; docker compose version; docker network ls;
  docker network inspect $(docker network ls -q) --format "{{.Name}} {{range .IPAM.Config}}{{.Subnet}}{{end}}";
  ip -4 route; free -m; df -h /; ls /opt/stack/apps;
  docker inspect traefik --format "{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}"'
```

- `KENAR_AGI` / `TAILNET_AGI` hiçbir mevcut ağla ve rota ile çakışmamalı (varsayılan `172.31.252.0/28` · `172.31.253.0/28`); ikisi de 100.64/10 dışında.
- `KENAR_DINAMIK_ARALIK` (varsayılan `172.31.252.8/29`): Traefik kenar ağına DİNAMİK adresle katılır; dağıtım bu aralıkla sınırlı, satıcının sabit `KENAR_IP`'si aralığın DIŞINDA (denetim ⑥b). Aralık yokken Traefik satıcıdan önce bağlanınca ilk boş adresi — yani `KENAR_IP`'yi — aldı (kurulumda ölçüldü, §12).
- Bellek: mevcut üç konteyner ~320 MB tavanlı; satıcı üçlüsü +768 MB (3 GB makinede yer var — `free -m` ile ölç).

## 4. Tailscale (VDS) — resmî paket deposu

```bash
ssh -t tekserp-vds
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list
sudo apt-get update && sudo apt-get install -y tailscale
sudo tailscale up --hostname=tekserp-vds --accept-dns=false
# → bir giriş bağlantısı basar: KULLANICI tarayıcıda açıp makineyi tailnet'e onaylar
tailscale ip -4        # → TAILNET_IP
```

- `--accept-dns=false`: VDS'in çözümleyicisi değişmesin (mevcut servisler etkilenmez). SSH tailnet'ten AÇILMAZ (`--ssh` yok); yönetim 2222'den sürer.
- Yönetim konsolunda (kullanıcı): bu makinenin **anahtar süresi dolması kapatılır** (sunucu düğümü) ve ACL ile 4611'e yalnız bizim cihazlarımız (Mac) izinli olur.
- Tailscale kendi iptables zincirlerini ekler (`ts-input` · `ts-forward`); 80/443/2222 etkilenmez — §7'de `vds-dogrula.sh` + `curl https://guncelleme…` ile ölçülür.

### 4a. Geri döngü kipi — Tailscale onaylanana dek (bugünkü kurulum)

Tailscale kullanıcı onayı beklerken satıcı **geri döngü kipinde** koşar: `.env`'de `COMPOSE_FILE=docker-compose.yml:docker-compose.loopback.yml` (her `docker compose` komutu ikisini birden alır) ve `TAILNET_IP=127.0.0.1` (bu kipte kullanılmaz; ana dosyanın zorunlu alanı).

- Portal **hiçbir yere yayımlanmaz**; tailnet köprüsü **internal** olur (satıcının dış bağlantısı yok → DOCKER-USER kuralı ve `tekserp-satici-tailnet@` birimi bu kipte GEREKMEZ).
- Satıcının tailnet dinleyicisi konteynerin kendi `127.0.0.1`'ine bağlanır (`TAILNET_BIND`); `portal-tunel` (aynı imaj, `portal-tunel.cjs`) satıcının ağ ad alanında köprü adresini (`TAILNET_KONTEYNER_IP:4611`) dinleyip `127.0.0.1:4611`'e aktarır → portal kaynağı `127.0.0.1` görür. Bu kipte `TAILNET_LOOPBACK=1` ZORUNLUDUR: satıcı 127/8'i yalnız bu anahtarla tailnet sayar (F2; anahtarsız geri döngü kaynağı 404 alır).
- **Neden iletici:** port VDS'in `127.0.0.1`'ine yayımlansa bile Docker'ın vekili bağlantıyı köprü ağ geçidinin adresiyle konteynere taşır — kapı onu tailnet saymaz, portal 404 döner (§1; VDS'te yeniden ölçüldü §12). Ağ geçidini listeye eklemek ÇÖZÜM DEĞİLDİR.
- **Erişim (Mac):** `node deploy/satici/portal-baglan.mjs` → tarayıcıda `http://127.0.0.1:14611/portal/`. VDS'in sshd'si TCP yönlendirmeyi kapatır (`AllowTcpForwarding no`, `00-hardening.conf`) — `ssh -L` "administratively prohibited" döner; araç Mac'te yalnız `127.0.0.1`'i dinler, her bağlantıda bir SSH oturumu açıp VDS'te `nc -N 172.31.253.2 4611` koşturur (ortak ana bağlantı, ControlMaster). Köprü adresine yalnız VDS'in kendisi ulaşır (diğer köprülerden Docker yalıtımı düşürür); girişi parola + TOTP korur.
- **Satıcı yeniden başlarsa:** `portal-tunel` eski ağ ad alanında kalır (Docker `service:` ağ kipinin sınırı); öz denetimi hedefe üç kez (30 sn arayla) ulaşamayınca çıkar, `restart` onu yeni ad alanına bağlar — ölçüldü: `docker restart` sonrası portal 75 sn'de geri geldi.
- **Tailscale gelince (ana kipe geçiş):** §4 → `.env`'den `COMPOSE_FILE` satırı silinir, `TAILNET_IP=<tailscale ip -4>` → `node deploy/satici/compose-denetle.mjs --env-file <.env>` ana kipte yeşil → §5.7 birimi (`sudo systemctl enable --now tekserp-satici-tailnet@hazirlik`; DOCKER-USER kurallarını koyar ve `compose up -d` ile satıcıyı yeniden yaratır, `portal-tunel` artık tanımsız kalır → `sudo docker compose up -d --remove-orphans`). Yalıtım denetimi iki kipi tanır ve karıştırmaz (ana kipte `TAILNET_LOOPBACK`/`portal-tunel` kalıntısı ❌).

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

2. **Dosyalar (Mac'ten):** `docker-compose.yml`, doldurulmuş `.env` (root 600), `vds/tailnet-hazirla.sh` (root 755, `$K/`), `vds/tekserp-satici-tailnet@.service` (`/etc/systemd/system/`), `satici.tkpub` (`$K/yedek-alici/`, 644).
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
7. **Tailnet birimi** (DOCKER-USER kuralları + `compose up -d`; açılışta Tailscale geç gelirse satıcıyı sonradan kaldırır, Docker'ı BEKLETMEZ):

   ```bash
   sudo systemctl daemon-reload && sudo systemctl enable --now tekserp-satici-tailnet@hazirlik
   ```

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
4. **Satıcıyı yeniden yarat:** önce yedek (`sudo docker compose exec satici-yedek /arac/yedek-dongusu.sh tek`), sonra `sudo docker compose up -d satici` — `ic-api` ağı doğar, satıcı birkaç saniye kesilir (fabrikalar kira ömrü içinde etkilenmez). Günlük: `SATICI_DINLIYOR genel=4610 tailnet=4611 ic=4612`.
5. **Patron** (ayrı compose, [`PATRON-BULUTU-KURULUM.md`](PATRON-BULUTU-KURULUM.md) §4 · §10): ağ `tekserp-satici-hazirlik-ic-api: {external: true}`, servis ağında `ipv4_address: <PATRON_IC_IP>`; patronun `.env`i `SATICI_IC_API_AGI` · `SATICI_IC_API_IP` · `PATRON_IC_IP` değerlerini bu `.env`le AYNI taşır (patronun yalıtım denetimi `--satici-env` ile ölçer); sır patron dizininde AYRI bir kopya dosyadır (`sudo cp $K/sirlar/ic-api-belirteci <patron>/sirlar/`, root:<patron SIR_GID> 0440; docker secret — `.env`e ve `docker inspect`e girmez). Patron önbelleği (`KURULUM_ONBELLEK_DK`, 5) tazeliktir: satıcıya ulaşamazsa bayat kayıtla sürer, hiç dolmadıysa RED; satıcının 404'ü kaydı pasife çeker (401 çekmez).
6. **Sır rotasyonu:** yeni sır dosyaya → `sudo docker compose up -d --force-recreate satici` + patronun `.env`i + patron yeniden başlatılır. Arada patron 401 alır: bulut bayat kayıtla sürer, zil kaçar (fabrika her turda yine yoklar).
7. **İç API'yi kapatmak (ağ kalır):** `sudo truncate -s 0 $K/sirlar/ic-api-belirteci && sudo docker compose up -d --force-recreate satici` → `ic=kapali`; patron bayat kayıtla sürer.

## 6. DNS (kullanıcı — Cloudflare)


`lisans-test` A → `80.253.255.188`, **proxy AÇIK (turuncu bulut)** — sertifika Origin CA `*.etkiliyazilim.com`, ona yalnız CF Edge güvenir (DNS-only'de istemci reddeder). Önbellek kuralı gerekmez (yanıtlar dinamik JSON, `Cache-Control: no-store`); zil (SSE) 25 sn kalp atışıyla CF'nin 100 sn boşta zaman aşımının altında kalır. İleride `lisans` kaydı üretim projesi için aynı biçimde. **Durum 2026-09-29:** `lisans-test` kaydı açık (CF adresleri döner); kurulumdan önce `/saglik` → `404` (Traefik'te yönlendirici yoktu), kurulumdan sonra `200 {"success":true}` (ölçüldü, §12).

## 7. Doğrulama (sonra)

| Ölçüm | Nereden | Beklenen |
|---|---|---|
| `curl -s https://lisans-test.etkiliyazilim.com/saglik` | internet | `{"success":true}` |
| `curl -s -o /dev/null -w '%{http_code}' https://lisans-test.etkiliyazilim.com/portal/saglik` | internet | `404` (portal genelde YOK) |
| `curl -s http://<TAILNET_IP>:4611/portal/saglik` | Mac (tailnet) | `200` · `capa: gomulu` · `altGecerli: 1` · `indirmeVar: true` · `uyariSayisi: 0` |
| **geri döngü kipinde** aynı ölçüm: `portal-baglan.mjs` açıkken `curl -s http://127.0.0.1:14611/portal/saglik` · `/portal/` | Mac | aynı `200` gövdesi · giriş sayfası `200` (`TeksERP Satıcı Portalı`, CSP başlığı) |
| aynı adres | VDS'in kendisi | ÖLÇ ve yaz: `404` (vekil/ağ geçidi) ya da `200` (NAT kaynağı VDS'in tailnet adresi) — ikisi de kabul; 200 ise host kullanıcısını parola + TOTP durdurur |
| `curl -m 5 http://80.253.255.188:4611/` | internet | zaman aşımı / reddedildi |
| `sudo docker compose ps` | VDS | üçü `healthy` / `Up` |
| `sudo iptables -S DOCKER-USER` | VDS | tailnet portu `! -i tailscale0 → DROP` + tailnet köprüsü `NEW → DROP` |
| `sudo docker stats --no-stream` | VDS | sınırlar tablodaki gibi |
| `curl -sI https://guncelleme.etkiliyazilim.com/adnansahin/electron/latest.yml` + `vds-dogrula.sh` | Mac | 200 · adnansahin AYNI |
| Yedek açılır mı (aşağıda) | Mac | `pg_restore --list` dolu; anahtar arşivi Mac'teki dizinle bayt-eşit |
| `sudo docker compose logs satici \| grep SATICI_DINLIYOR` | VDS | `ic=4612` (sır yoksa `ic=kapali` + `iç API KAPALI`) |
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

Portal 200 yerine 404 dönüyorsa: kaynak adres korunmamıştır (DNAT değil vekil) — satıcının erişim günlüğündeki kaynak IP'ye bak (`docker logs tekserp-satici-hazirlik | grep portal`); köprü ağ geçidini tailnet listesine eklemek ÇÖZÜM DEĞİLDİR (host'taki her süreç portalı açar).

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
sudo systemctl disable --now tekserp-satici-tailnet@hazirlik
sudo docker compose down                                   # birim (satıcı DB'si) KALIR — silmek kullanıcı kararı
sudo iptables -D DOCKER-USER -d <TAILNET_KONTEYNER_IP>/32 -p tcp --dport 4611 ! -i tailscale0 -j DROP
sudo iptables -D DOCKER-USER -s <TAILNET_AGI> -m conntrack --ctstate NEW -j DROP
# Traefik compose'undaki kenar ağı satırı KALDIRILIR, sonra:
sudo docker network disconnect tekserp-satici-hazirlik-kenar traefik 2>/dev/null; sudo docker network rm tekserp-satici-hazirlik-kenar
```

İç API (§5b) geri alınırken önce patron ağdan çıkar (patron compose'undan `ic-api` satırı + `docker network disconnect`), sonra `compose down` ağı siler; yalnız kapatmak için §5b.7 yeter.

Traefik compose'unun kurulum öncesi hâli yanında durur: `/opt/stack/traefik/docker-compose.yml.yedek-20260929-satici` → geri alırken `sudo cp -p` ile yerine konur (ağ bağlantısı kesildikten SONRA değil, ağ silinmeden ÖNCE — dosya dış ağı andığı sürece Traefik yeniden yaratılamaz). Geri döngü kipinde DOCKER-USER kuralı ve birim YOKTUR (o iki satır atlanır); `compose down` `portal-tunel`i de kaldırır.

DNS kaydı (kullanıcı) · Tailscale (`sudo tailscale down`; kaldırma kullanıcı kararı) · `docker rmi tekserp-satici:<sha> tekserp-satici-yedek:<sha>`. Sonunda `vds-dogrula.sh` → ✅. Güncelleme yayını geri almada hiç durmaz (Traefik yeniden başlatılmaz).

**Sürüm yükseltme:** yeni imaj (§2.2 + §5.4) → `exec satici-yedek … tek` (önce yedek) → `.env`'de etiket → `--profile goc run --rm satici-goc` → `sudo docker compose up -d`. Eski imaj bir sürüm boyunca kalır; geri dönüş = eski etiket + (göç geri alınamaz) yedekten geri yükleme.

## 9. Fabrika tarafı — `LICENSE_SERVER_URL`

Tek çözüm yeri `Teks-Erp/src/lib/license/vendor-url.ts` → `resolveVendorUrl` (açılışta `STARTUP_VENDOR`) (tek okuyucu; bekçi `test_lisans_satici_adresi`):

| `LICENSE_SERVER_URL` | Satıcı | Kullanım |
|---|---|---|
| verilmez / boş | `https://lisans.etkiliyazilim.com` (`DEFAULT_LICENSE_SERVER_URL`) | üretim kurulumları |
| `https://lisans-test.etkiliyazilim.com` | hazırlık satıcısı | thinkpad-1 / testfabrika |
| `kapali` | yok — dışarı hiç çıkılmaz | internetsiz kurulum, geliştirme |
| biçimsiz (yol · sorgu · kimlik bilgisi · döngü dışı `http`) | yok + açılışta uyarı | fail-closed |

Etkinleşmemiş kurulum hiçbir durumda dışarı istek atmaz (`test_lisans_motoru §2b`); etkinleştirme bir yönetici eylemidir. thinkpad-1: backend `.env`'ine `LICENSE_SERVER_URL=https://lisans-test.etkiliyazilim.com` + `pm2 restart` (thinkpad provası runbook'u). Hazırlık satıcısının imzaladığı HAK yalnız TEST/DEMO sınıfındadır; üretim kurulumu yanlışlıkla ona etkinleşse bile ÜRETİM HAK'ı alamaz (portalda kurulum kaydı da gerekir).

## 10. Anahtar künyesi (sır DEĞİL — açık yarılar)

| kid | Tür | Sınıflar | Açık anahtar (x) | Geçerlilik |
|---|---|---|---|---|
| `hazirlik-2026-1` | hazırlık kökü (parolalı) | TEST · DEMO | `705hChzAL045Gp-XoG6SaUKAW8muK1SFcW0Vpwhf-mo` | süresiz (çapada) |
| `alt-hazirlik-2026-1` | ALT (kira) | TEST · DEMO | anahtar künyesinde (`/portal/api`) | 2026-09-29 → 2027-03-28 |
| `ind-hazirlik-2026` | İNDİRME | TEST · DEMO | `olL5-kJO9x2ll70S07upNYejiB1-pim7IfU7wFPnGlw` (CF Worker, Faz 3a) | 2026-09-29 → 2027-09-29 |
| `satici` | yedek alıcısı (.tkenc) | — | parmak izi `9795275bc12a5faa` | — |

## 11. Açık riskler

- **`cf-connecting-ip` taklit edilebilir** — köken (VDS:443) yalnız Cloudflare IP'lerine açılana dek (Faz 3a) doğrudan köke gelen istek başlığı uydurabilir; etkisi yalnız IP başına hız sınırının aşılmasıdır (her `/v1` isteği kurulum imzalıdır).
- **Satıcı `denetim` budaması** (yönetici kararı h: başarısız giriş 90 gün, diğer denetim 2 yıl) bu dilimin tabanında YOK — `lisans/satici-tamamlama` dilimi getirir; imaj o dilim indikten sonraki HEAD'den derlenmezse denetim tablosu budanmadan büyür (kurulumdan önce `git log -- satici/sunucu/src/services/maintenance.ts` ile ölç).
- Traefik'in kalıcı ağ satırı Traefik compose'unu değiştirir (§5.5) — o dosya bu repoda değil (2026-09-29'da yazıldı, öncesi yanında `.yedek-20260929-satici`).
- Geri döngü kipinde portal erişimi SSH oturumu + VDS'te `nc` ile (sshd TCP yönlendirmeyi kapatır) — kabuk erişimi olan her VDS hesabı köprü adresine zaten ulaşır; kapı parola + TOTP'tir. Tailscale ana kipi bunu kaldırır (§4a).
- **İç API ortak sırrı iki yerde** (satıcı secret dosyası root:SIR_GID 0440 · patronun kopyası root:<patron SIR_GID> 0440): VDS'te root her ikisini okur (kabul edilen — kök/konteyner kaçışı her şeyi açar). Sızarsa açığa çıkan yalnız allowlist'tir (kurulumların açık anahtarı + kid, durum, sınıf, patron bulutu hakkı/bitişi, tesis adı) ve zil çalınabilir (içerik taşımaz, kurulum başına hız sınırlı); kişisel/ticari veri yoktur. Çare rotasyon (§5b.6).
- Kök anahtar VDS'te (parolalı) — konteyner kaçışı kök dosyasını okur ama parolasız işe yaramaz; parola yalnız imza anında formdan alt sürece gider (plan §12).
- **Genel portal (isteğe bağlı, [`PORTAL-GENEL-ERISIM.md`](PORTAL-GENEL-ERISIM.md)):** portal internetten Cloudflare Access + parola + TOTP ile açılır; kökende her istekte Access JWT'si doğrulanır (köken 2026-09-30'da Cloudflare dışından doğrudan 200 veriyordu — ölçüldü; portal yönlendiricisine CF `ipallowlist` bağlanır). Satıcı dış bağlantısız KALIR: Access imza anahtarlarını yalnız çıkışlı `satici-jwks` yan konteyneri çeker ve paylaşılan dizine atomik yazar, satıcı salt okunur okur; kök parolası isteyen uçlar yalnız tailnet/geri döngüde kalır.

## 12. Kurulum kaydı — 2026-09-29 (hazırlık, geri döngü kipi)

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
