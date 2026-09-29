# Satıcı (lisans) sunucusu — tekserp-vds kurulum runbook'u

> **Durum:** HAZIRLIK — yapıtlar repoda, anahtarlar Mac'te üretildi, VDS'e **henüz hiçbir şey yazılmadı**. VDS yazımı (§5), Cloudflare DNS kaydı (§6) ve Tailscale onayı (§4) **kullanıcı işidir**; plan onayı bunları kapsamaz (plan §11).
> Yapıtlar: [`deploy/satici/`](../../deploy/satici/) (compose · Dockerfile · imaj derleme · yalıtım denetimi · VDS birimi). Protokol: [`LISANS-PROTOKOLU.md`](../design/LISANS-PROTOKOLU.md). Alan kuralları: [`kurallar/lisans.md`](../kurallar/lisans.md). Sunucu envanteri: [`SUNUCU-ENVANTERI.md`](SUNUCU-ENVANTERI.md).
> **Değişmez:** her VDS yazımından ÖNCE ve SONRA `Teks-Erp-wt/vds-dogrula.sh` → *adnansahin baytları AYNI* (salt okuma, çıkış 0). Fark çıkarsa dur.

## 0. Kapsam

| Kurulur | Kurulmaz |
|---|---|
| `ORTAM=hazirlik` — `lisans-test.etkiliyazilim.com` (genel) + tailnet portalı | Üretim kökü (`kok-<yıl>-<n>`, kullanıcı töreni) ve `lisans.etkiliyazilim.com` — ileride **aynı** compose, `ORTAM=uretim` `.env`'iyle ayrı proje |
| Hazırlık kökü `hazirlik-2026-1` (yalnız TEST/DEMO imzalar), ALT `alt-hazirlik-2026-1`, İNDİRME `ind-hazirlik-2026` | CF Worker (Faz 3a) · portal web arayüzü (1f) |
| Satıcının kendi PG16'sı + şifreli yedek döngüsü | Fabrika verisi — satıcı DB'si yalnız lisans kayıtlarını taşır |

Dokunulmayan: `tekserp-guncelleme` (compose · nginx · `html/` · `defter/`), `/srv/tekserp-yedek`, `/srv/tekserp-arsiv`. Traefik'e yalnız **bir ağ bağlantısı** eklenir (yeniden başlatmasız, §5.5).

## 1. Mimari

```
Cloudflare (proxy AÇIK) ─443─► Traefik (websecure, Origin CA *.etkiliyazilim.com)
                                  │  Host(`lisans-test.etkiliyazilim.com`)
                                  ▼  ağ: tekserp-satici-hazirlik-kenar (internal)
                            satici :4610 GENEL  (/v1/* · /q · /bayi/api · /saglik)
Mac (tailnet) ─► 100.x.y.z:4611 (tailscale0) ─DNAT─► ağ: …-tailnet ─► satici :4611 TAILNET (/portal/*)
                            satici ◄─ ağ: …-ic (internal) ─► satici-db (PG16) ◄─ satici-yedek
```

| Konteyner | İmaj | Kullanıcı | Bellek · CPU · süreç | Ağlar |
|---|---|---|---|---|
| `tekserp-satici-hazirlik` | `tekserp-satici:<sha>` (node 24, `node dist/server.js`) | 10001 | 384 MB · 0,75 · 200 | kenar (sabit IP) · ic · tailnet (sabit IP) |
| `tekserp-satici-hazirlik-db` | `postgres:16-alpine` (özetle sabit) | 70 | 256 MB · 0,5 · 100 | ic |
| `tekserp-satici-hazirlik-yedek` | `tekserp-satici-yedek:<sha>` (pg_dump 16 + `yedek-sifrele.cjs`) | 10001 | 128 MB · 0,25 · 50 | ic |
| `satici-goc` (profil `goc`, tek seferlik) | `tekserp-satici:<sha>` | 10001 | 384 MB · 0,5 · 100 | ic |

Hepsinde: kök FS **salt okunur** · `cap_drop: ALL` · `no-new-privileges` · docker soketi **bağlı değil** · `init`. Satıcı `web` ağına katılmaz: güncelleme/patron/kiracı konteynerleri satıcıya ağdan ulaşamaz, satıcı onlara ulaşamaz. Bu değişmezleri `deploy/satici/compose-denetle.mjs` ölçer (§2.4) — kuruluma o yeşil vermeden geçilmez.

**Tailnet yayını neden böyle:** satıcının portal dinleyicisi joker adrese bağlanamaz (açılışta RED) ve kaynak ağı 100.64/10 · geri döngü dışındaysa 404 döner. Docker port yayını **yalnız VDS'in Tailscale IP'sine** yapılır; satıcı konteyneri tailnet ağındaki **sabit** IP'sine bağlanır. Dışarıdan tailscale0 üzerinden gelen istek DNAT'la kaynak adresi korunarak (100.x) girer. Docker'ın vekiliyle gelen istek (yerel/konteyner yolu) köprü ağ geçidinin adresini taşır; bu yüzden **köprü ağları 100.64/10'un DIŞINDA** seçilir — aksi hâlde vekilden gelen her istek tailnet kaynağı sayılır (ölçüldü, yerel duman testi: tailnet ağı 100.100.100.0/28 iken host'tan yayımlı porta gelen istek portalı 200 açtı; 172.31.253.0/28 iken 404 — denetim ⑥). VDS'in KENDİSİNDEN (host kabuğu) gelen istek Docker'ın NAT yoluna göre VDS'in kendi tailnet adresiyle de girebilir: host'taki bir kabuk kullanıcısı portal giriş ekranına ulaşabilir, girişi parola + TOTP korur (kabul edilen; §7'de ölçülüp yazılır). Üçüncü kat: `DOCKER-USER` zincirinde tailnet portuna yalnız `tailscale0`'dan gelinir, satıcının tailnet köprüsünden yeni dış bağlantı açılmaz (Docker yayımlı portlarda ufw'yi atlar; kural bu yüzden DOCKER-USER'da).

**Budama:** telemetri (nonce · yoklama · portal oturumu/işlem kimliği) satıcının süreç içi bakım işinde (`BAKIM_ARALIGI_SN`, `satici/sunucu/src/services/maintenance.ts`); satıcı `denetim` tablosu (ayak izi, yönetici kararı h: başarısız giriş 90 gün, diğeri 2 yıl) aynı bakım işine `lisans/satici-tamamlama` dilimiyle girer — varsayılanlar kodda, compose'a değişken gerekmez; yedek dosyaları `satici-yedek` döngüsünde — `YEDEK_SAKLA_GUN`'den eskiler silinir, her türün en yeni `YEDEK_EN_AZ` kopyası **asla** silinmez.

## 2. Mac'te hazırlık

### 2.1 Anahtarlar (bu dilimde üretildi — repo DIŞINDA)

| Ne | Nerede (Mac) | İzin |
|---|---|---|
| Hazırlık kökü (scrypt + AES-256-GCM parolalı) · ALT · İNDİRME · `portal-totp.key` | `~/.tekserp/satici-hazirlik/` | dizin 700 · dosyalar 600 |
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
```

- **VDS dışı kopya (kullanıcı):** `hazirlik-2026-1.kok.json` + parolası USB'ye ve kâğıda (parola ayrı kâğıtta). Mac tek kopya olarak kalmamalı.
- **ALT rotasyonu:** sertifika `2027-03-28`'de biter → ondan önce Mac'te `alt-hazirlik-2026-2` üretilir, VDS'teki `anahtarlar/`a kopyalanır; satıcı anahtar deposunu bakım işinde (dakikada bir) yeniden okur, yeniden başlatma gerekmez. Eskisi örtüşme süresince kalır.
- Hazırlık kökü fabrika programının güven çapasındadır (`ROOT_PUBLIC_KEYS`, yalnız TEST/DEMO) — satıcı gömülü çapayı kullanır, `GUVEN_CAPASI_DOSYASI` **verilmez**.

### 2.2 İmaj

```bash
deploy/satici/imaj-derle.sh                 # HEAD'den (git archive); kirli ağaç RED; linux/amd64
# → ~/.tekserp/satici-imaj/tekserp-satici-<sha>.tar.gz + .sha256 ; SATICI_IMAJ / SATICI_YEDEK_IMAJ satırlarını basar
```

VDS'te derleme YOK, kaynak VDS'e gitmez. Portal kullanıcı CLI'ı imajda derlenmiş durur (`dist-cli/scripts/portal-kullanici.js`).

### 2.3 Sunucunun `.env`'i

`deploy/satici/ornek.env`'den doldurulur (sır İÇERMEZ): `TAILNET_IP` §4'ten, ağlar §3'ten, imaj etiketleri §2.2'den.

### 2.4 Yalıtım denetimi — kurulumdan ÖNCE yeşil

```bash
node deploy/satici/compose-denetle.mjs --env-file <doldurulmuş .env>   # 0 temiz · 1 ihlal · 2 ölçülemedi
```

① port yalnız `satici`de ve yalnız 100.64/10 adresine · ② docker soketi yok · ③ salt okunur/yetenek yok/root değil/sınırlı · ④ kenar + ic internal, dış ağa katılım yok · ⑤ anahtar birimi salt okunur · ⑥ köprü ağları tailnet/geri döngü aralığı dışında · ⑦ Traefik yalnız satıcıda ve kenar ağında, DB portsuz. Negatif sondalar (docker soketi · `read_only` yok · anahtar rw · `web` ağı · 0.0.0.0 yayını · kenar internal değil · DB portu) her biri kırmızı verdi.

## 3. VDS'i ölç (salt okuma)

```bash
ssh tekserp-vds 'docker version --format "{{.Server.Version}}"; docker compose version; docker network ls;
  docker network inspect $(docker network ls -q) --format "{{.Name}} {{range .IPAM.Config}}{{.Subnet}}{{end}}";
  ip -4 route; free -m; df -h /; ls /opt/stack/apps;
  docker inspect traefik --format "{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}"'
```

- `KENAR_AGI` / `TAILNET_AGI` hiçbir mevcut ağla ve rota ile çakışmamalı (varsayılan `172.31.252.0/28` · `172.31.253.0/28`); ikisi de 100.64/10 dışında.
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

## 5. Kurulum (VDS YAZIMI — kullanıcının "uygula" cümlesiyle)

0. **Önce:** `Teks-Erp-wt/vds-dogrula.sh` → ✅ (çıkış 0).
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
10. **Sonra:** `Teks-Erp-wt/vds-dogrula.sh` → ✅ adnansahin AYNI.

## 6. DNS (kullanıcı — Cloudflare)

`lisans-test` A → `80.253.255.188`, **proxy AÇIK (turuncu bulut)** — sertifika Origin CA `*.etkiliyazilim.com`, ona yalnız CF Edge güvenir (DNS-only'de istemci reddeder). Önbellek kuralı gerekmez (yanıtlar dinamik JSON, `Cache-Control: no-store`); zil (SSE) 25 sn kalp atışıyla CF'nin 100 sn boşta zaman aşımının altında kalır. İleride `lisans` kaydı üretim projesi için aynı biçimde. **Durum 2026-09-29:** `lisans-test` kaydı açık (CF adresleri döner); satıcı kurulana dek `https://lisans-test.etkiliyazilim.com/saglik` → `404` (Traefik'te yönlendirici yok, ölçüldü) — §5 sonrası `200` olur.

## 7. Doğrulama (sonra)

| Ölçüm | Nereden | Beklenen |
|---|---|---|
| `curl -s https://lisans-test.etkiliyazilim.com/saglik` | internet | `{"success":true}` |
| `curl -s -o /dev/null -w '%{http_code}' https://lisans-test.etkiliyazilim.com/portal/saglik` | internet | `404` (portal genelde YOK) |
| `curl -s http://<TAILNET_IP>:4611/portal/saglik` | Mac (tailnet) | `200` · `capa: gomulu` · `altGecerli: 1` · `indirmeVar: true` · `uyariSayisi: 0` |
| aynı adres | VDS'in kendisi | ÖLÇ ve yaz: `404` (vekil/ağ geçidi) ya da `200` (NAT kaynağı VDS'in tailnet adresi) — ikisi de kabul; 200 ise host kullanıcısını parola + TOTP durdurur |
| `curl -m 5 http://80.253.255.188:4611/` | internet | zaman aşımı / reddedildi |
| `sudo docker compose ps` | VDS | üçü `healthy` / `Up` |
| `sudo iptables -S DOCKER-USER` | VDS | tailnet portu `! -i tailscale0 → DROP` + tailnet köprüsü `NEW → DROP` |
| `sudo docker stats --no-stream` | VDS | sınırlar tablodaki gibi |
| `curl -sI https://guncelleme.etkiliyazilim.com/adnansahin/electron/latest.yml` + `vds-dogrula.sh` | Mac | 200 · adnansahin AYNI |
| Yedek açılır mı (aşağıda) | Mac | `pg_restore --list` dolu; anahtar arşivi Mac'teki dizinle bayt-eşit |

Portal 200 yerine 404 dönüyorsa: kaynak adres korunmamıştır (DNAT değil vekil) — satıcının erişim günlüğündeki kaynak IP'ye bak (`docker logs tekserp-satici-hazirlik | grep portal`); köprü ağ geçidini tailnet listesine eklemek ÇÖZÜM DEĞİLDİR (host'taki her süreç portalı açar).

**Yedeği Mac'e çekme ve açma** (dosyalar şifreli; özel yarı yalnız Mac'te):

```bash
ssh -t tekserp-vds 'install -d -m 700 ~/satici-yedek-cekim && sudo cp /srv/tekserp-satici-yedek/hazirlik/*.tkenc ~/satici-yedek-cekim/ && sudo chown -R "$USER" ~/satici-yedek-cekim'
scp 'tekserp-vds:satici-yedek-cekim/*' ~/.tekserp/satici-yedek-kopya/ && ssh tekserp-vds 'rm -rf ~/satici-yedek-cekim'
cd Teks-Erp && npx tsx scripts/yedek-sifrele.ts coz --girdi ~/.tekserp/satici-yedek-kopya/satici_<damga>.dump.tkenc \
  --cikti /tmp/satici.dump --anahtar ~/.tekserp/sirlar/satici-hazirlik-yedek-ozel.txt && pg_restore --list /tmp/satici.dump | head
```

(Yerel duman testinde ölçüldü: döküm açıldı, 24 tablo verisi; anahtar arşivi kaynakla bayt-eşit; yabancı anahtar `YANLIS_ANAHTAR`, çıkış 2.)

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
- Traefik'in kalıcı ağ satırı Traefik compose'unu değiştirir (§5.5) — o dosya bu repoda değil.
- Kök anahtar VDS'te (parolalı) — konteyner kaçışı kök dosyasını okur ama parolasız işe yaramaz; parola yalnız imza anında formdan alt sürece gider (plan §12).
