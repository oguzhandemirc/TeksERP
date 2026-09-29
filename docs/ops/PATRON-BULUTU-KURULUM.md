# Patron bulutu — tekserp-vds kurulum runbook'u

> **Durum (2026-09-29):** YAZILDI, VDS'e **UYGULANMADI** — her VDS yazımı kullanıcının "uygula" cümlesiyle. Yerel duman (§2.5) yeşil; kayıt §12.
> Yapıtlar: [`deploy/patron/`](../../deploy/patron/) (compose · Dockerfile · imaj derleme · yalıtım denetimi · duman). Sözleşme: [`PATRON-BULUTU-ESITLEME.md`](../design/PATRON-BULUTU-ESITLEME.md). Alan kuralları: [`kurallar/patron-bulutu.md`](../kurallar/patron-bulutu.md) § Dağıtım. Emsal ve paylaşılan adımlar: [`SATICI-KURULUM.md`](SATICI-KURULUM.md) (satıcı ÖNCE kurulu olmalı — patron onun iç API ağına katılır).
> **Değişmez:** her VDS yazımından ÖNCE ve SONRA `Teks-Erp-wt/vds-dogrula.sh` → *adnansahin baytları AYNI* (salt okuma, çıkış 0). Fark çıkarsa dur. Traefik **yeniden başlatılmaz**.

## 0. Kapsam

| Kurulur | Kurulmaz |
|---|---|
| `ORTAM=uretim` — `patron.etkiliyazilim.com`: web sürümü `/` · hesap API'si `/api` · fabrika kanalı `/v1` | Bildirim çıkışı (B5: Expo/FCM/APNs/web push) — bu yığında dış ağ YOK (§11) |
| Patronun kendi PG16'sı + şifreli yedek döngüsü | Satıcı (ayrı compose, `SATICI-KURULUM.md`) · Traefik yapılandırması (yalnız bir ağ bağlantısı + iki satır) |
| Üç DB rolü (göç · uygulama · eşitleme) · ilk tesis + ilk tesis yöneticisi (CLI) | Mağaza uygulamaları (iOS/Android derlemesi) |

Dokunulmayan: `tekserp-guncelleme`, satıcı yığını (yalnız onun `ic-api` ağına **katılınır**), `/srv/tekserp-yedek`, `/srv/tekserp-arsiv`.

## 1. Mimari

```
Cloudflare (proxy AÇIK) ─443─► Traefik (websecure, Origin CA *.etkiliyazilim.com)
                                  │  Host(`patron.etkiliyazilim.com`) && !PathRegexp(`^/(ic|yonetim)(/|$)`)
                                  ▼  ağ: tekserp-patron-uretim-kenar (internal)
                         patron :4620 (BIND = kenar adresi)  / web · /api · /v1 · /saglik
                         patron ◄─ ağ: …-ic (internal) ─► patron-db (PG16) ◄─ patron-yedek
                         patron ── ağ: tekserp-satici-<ortam>-ic-api (satıcının, internal) ──► satıcı :4612 /ic/v1/*
```

| Konteyner | İmaj | Kullanıcı | Bellek · CPU · süreç | Ağlar |
|---|---|---|---|---|
| `tekserp-patron-uretim` | `tekserp-patron:<sha>` (node 24, `node dist/server.js`, web çıktısı `/uygulama/web`) | 10001 | 512 MB (yığın 320) · 0,75 · 200 | kenar (sabit IP) · ic · ic-api (sabit `PATRON_IC_IP`) |
| `tekserp-patron-uretim-db` | `postgres:16-alpine` (özetle sabit) | 70 | 384 MB (`shared_buffers` 96 MB) · 0,5 · 100 | ic |
| `tekserp-patron-uretim-yedek` | `tekserp-patron-yedek:<sha>` (pg_dump 16 + `yedek-sifrele.cjs`) | 10001 | 128 MB · 0,25 · 50 | ic |
| `patron-goc` (profil `goc`, tek seferlik) | `tekserp-patron:<sha>` | 10001 | 384 MB · 0,5 · 100 | ic |

**Kaynak gerekçesi (VDS 2 çekirdek / 2972 MB):** mevcut tavanlar — traefik 192 · socket-proxy 64 · güncelleme 64 · satıcı 384 + 256 + 128 + tünel 64 ≈ 1,15 GB (gerçek kullanım ~150 MB, `SATICI-KURULUM.md` §12). Patronun uzun ömürlü tavanı **1 GiB** (denetim ③ ölçer) → toplam tavan ≈ 2,2 GB, işletim sistemi + Docker'a ≥ 700 MB kalır. En ağır iş fabrika paketi: `/v1/esitle` gövdesi gzip açılmış ≤ 32 MB → JSON ayrıştırma ~100–160 MB yığın; 512 MB tavan + `--max-old-space-size=320` çöp toplayıcıyı OOM öldürmesinden ÖNCE devreye sokar. CPU sınırları rezervasyon değil tavandır (sıkıştırılabilir): patron dolu yükte bile satıcıyı ve güncelleme yayınını aç bırakamaz.

**Ağ kapıları:** kenar internal — patron dış dünyaya ancak Traefik'in içinden görünür, kendisi dışarı çıkamaz; Traefik bu ağa DİNAMİK adresle (`KENAR_DINAMIK_ARALIK`) katılır, patronun sabit `KENAR_IP`'si aralığın dışında (satıcı kurulumunda ölçülen "Traefik satıcının adresini kaptı" çakışması). Patron YALNIZ kenar adresinde dinler: `ic-api` ağından (satıcı ya da oraya katılan konteyner) patrona ulaşılamaz. `ic-api` satıcının ağıdır; patron oraya satıcının kaynak kapısının kabul ettiği tek `/32` ile (`PATRON_IC_IP`) katılır.

**Sırlar ve roller:** üç DB rolü üç docker secret'ı (root:`SIR_GID` 0440; `SIR_GID` satıcınınkinden AYRI — patron satıcının sırrını okuyamaz, tersi de). Göç rolü (`patron_goc`, PG kümesinin sahibi) yalnız DB · `patron-goc` · yedek konteynerine bağlanır; sunucu yalnız uygulama (`patron_uygulama`) ve eşitleme (`patron_esitleme`) rollerini alır ve RLS'i atlayabilen rolle KALKMAZ. İç API belirteci satıcının dosyasının patron dizinindeki **kopyasıdır** (ortak birim yok). `patron-baslat` URL'leri secret dosyalarından kurar — `docker inspect`te parola görünmez.

**Web sürümü:** `patron/uygulama` `expo export --platform web` çıktısı imajın içinde; sunucu `/` altında sunar (`src/http/web-static.ts`): `/api` · `/v1` altı asla HTML'e düşmez, iç ad alanları (`IC_ONEKLER`: `/ic`, `/yonetim`) hem uygulamada hem Traefik kuralında 404, CSP `unsafe-inline`'sız (satır içi stil açılışta özetlenir), `_expo/static` ve `assets/` `immutable`, giriş HTML'i `no-store`, uzantısız yol giriş HTML'ine düşer (istemci yönlendirmesi). Uygulama API adresini sayfanın kökeninden alır (`EXPO_PUBLIC_PATRON_API=koken`) — CORS gerekmez.

## 2. Mac'te hazırlık

### 2.1 Anahtar ve yedek alıcısı (repo DIŞINDA)

| Ne | Nerede (Mac) | İzin |
|---|---|---|
| `patron-totp.key` (TOTP sırlarının sarma anahtarı, 32 bayt base64url) | `~/.tekserp/patron-uretim/anahtarlar/` | dizin 700 · dosya 600 |
| Yedek alıcısı `patron` — açık yarı | `~/.tekserp/patron-uretim-yedek-alici/patron.tkpub` | 644 |
| Yedek alıcısı — özel yarı (patron yedeklerini AÇAR) | `~/.tekserp/sirlar/patron-uretim-yedek-ozel.txt` | 600 |

```bash
install -d -m 700 ~/.tekserp/patron-uretim/anahtarlar ~/.tekserp/patron-uretim-yedek-alici
node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url")+"\n")' \
  > ~/.tekserp/patron-uretim/anahtarlar/patron-totp.key && chmod 600 ~/.tekserp/patron-uretim/anahtarlar/patron-totp.key
cd Teks-Erp && npx tsx scripts/yedek-sifrele.ts anahtar-uret --ad patron --dizin ~/.tekserp/patron-uretim-yedek-alici \
  --ozel-cikti ~/.tekserp/sirlar/patron-uretim-yedek-ozel.txt
```

- Anahtar birimi VDS'te SALT OKUNUR: sunucu anahtarı açılışta üretemez — yoksa açılış DURUR (fail-closed). Anahtar **kaybolursa** buluttaki bütün TOTP sırları çözülemez → her hesap davetle sıfırlanır. Bu yüzden anahtar yedek döngüsüne de girer (şifreli, §7) ve VDS dışı kopyası (USB) kullanıcıdadır.
- Var olan dosyanın üstüne YAZILMAZ; rotasyon yeni anahtar = bütün hesapların yeniden daveti demektir (planlı iş, kullanıcı kararı).

### 2.2 İmaj

```bash
deploy/patron/imaj-derle.sh                 # HEAD'den (git archive); kirli ağaç RED; linux/amd64
# → ~/.tekserp/patron-imaj/tekserp-patron-<sha>.tar.gz + .sha256 ; PATRON_IMAJ / PATRON_YEDEK_IMAJ satırlarını basar
```

VDS'te derleme YOK, kaynak VDS'e gitmez. Web aşaması derleme makinesinin KENDİ mimarisinde koşar (çıktı statik dosya); imaja yalnız çıktı geçer. İmaj `src/`, `tsx`, uygulama kaynağı ya da uygulama `node_modules`'ü taşımaz; CLI'lar (`dist-cli/scripts/db-rolleri.js` · `tesis.js`) derlenmiş durur.

### 2.3 Sunucunun `.env`'i

`deploy/patron/ornek.env`'den doldurulur (sır İÇERMEZ): ağlar §3'ten, satıcı değerleri (`SATICI_IC_API_AGI` = `tekserp-satici-<ortam>-ic-api` · `SATICI_IC_API_IP` = satıcının `IC_API_IP` · `PATRON_IC_IP` = satıcının `PATRON_IC_IP`) **satıcının `.env`'inden**, imaj etiketleri §2.2'den.

### 2.4 Yalıtım denetimi — kurulumdan ÖNCE yeşil

```bash
node deploy/patron/compose-denetle.mjs --env-file <patron .env> --satici-env <satıcının .env'i>   # 0 temiz · 1 ihlal · 2 ölçülemedi
```

① port yayını yok · ② docker soketi yok · ③ salt okunur/yetenek yok/root değil/sınırlı + uzun ömürlü tavan ≤ 1 GiB · ④ kenar + ic internal, tek dış ağ satıcının ic-api'si ve ona yalnız `patron` · ⑤ anahtar birimi salt okunur · ⑥/⑥b aralıklar, patronun kenar adresi dinamik aralığın dışında · ⑦ Traefik yalnız patronda, kural Host + iç ad alanı dışlaması, `BIND` = kenar adresi, DB portsuz · ⑧ göç parolası sunucuya bağlı değil, ortamda düz sır yok · ⑨ satıcıyla uyum (ağ adı · `PATRON_IC_IP` · iç API adresi aynı; `SIR_GID` farklı; kenar ağı satıcının hiçbir ağıyla çakışmaz). Satıcının `.env`'i verilmezse ⑨ **ölçülemedi** (çıkış 2) — geçti sayılmaz. Not: Node `--env-file` bayrağını kendisi de okur; dosya yoksa betik açılmadan 9 ile çıkar (satıcı denetiminde de aynı).

### 2.5 Yerel duman — imajı VDS'e götürmeden önce

```bash
deploy/patron/imaj-derle.sh --platform linux/amd64 --yukle-yok   # arşivsiz, yalnız yerel imaj (VDS'in mimarisi; Mac'te öykünme)
deploy/patron/duman.sh kur <sha>       # proje tekserp-patron-duman · yalnız 127.0.0.1:18620 · kendi DB konteyneri
deploy/patron/duman.sh sifirla <sha>   # compose down -v YALNIZ bu proje + durum dizini (imajlar kalır — yeniden kur için)
deploy/patron/duman.sh kaldir <sha>    # compose down -v YALNIZ bu proje + YALNIZ bu iki imaj + durum dizini
```

`docker-compose.duman.yml` örtüsü Traefik ve satıcı olmadan koşturur (kenar internal değil + `127.0.0.1` yayını; ic-api projenin kendi internal ağı; `KURULUM_KAYNAGI=kayit`) — compose-denetle bu örtüyü bilerek reddeder. `duman.sh kur`: göç + roller → `tesis.js tesis-ac` + `kurulum-kaydet` (URETIM + `patron-bulut`, yazma kanalı açık abonelik ister) + `yonetici-davet` → HTTP ölçümleri (web kökü · varlık önbelleği · CSP · API/iç ad alanı 404 · konteynerdeki Traefik etiketi · ic-api adresinde dinleyici yok) → gerçek Chromium (`tarayici-duman.cjs`: CSP ihlali 0 · konsol hatası 0 · giriş formu çizildi; playwright paneldeki e2e kurulumundan) → uygulamanın kendi istemcisiyle duman (`patron/uygulama/scripts/duman.ts`: davet → parola → TOTP onayı → giriş → oturum/pano → gelen kutusu → iptal → çıkış) → `yedek-dongusu.sh tek` + özel yarıyla açma + `pg_restore --list` → `docker stats`.

## 3. VDS'i ölç (salt okuma)

```bash
ssh tekserp-vds 'docker version --format "{{.Server.Version}}"; docker compose version; free -m; df -h /;
  docker network inspect $(docker network ls -q) --format "{{.Name}} {{range .IPAM.Config}}{{.Subnet}} {{end}}"; ip -4 route;
  docker stats --no-stream --format "{{.Name}} {{.MemUsage}} {{.CPUPerc}}"; ls /opt/stack/apps;
  docker network inspect tekserp-satici-hazirlik-ic-api --format "{{range .IPAM.Config}}{{.Subnet}} {{.IPRange}}{{end}}"'
```

- `KENAR_AGI` (varsayılan `172.31.250.0/28`) hiçbir köprü/rota ile çakışmamalı (satıcı 172.31.252–254); 100.64/10 dışında.
- Satıcının `ic-api` ağı VAR olmalı (satıcı S1 ile `compose up` yapılmış, `SATICI-KURULUM.md` §5b) ve `PATRON_IC_IP` üzerinde başka konteyner olmamalı: `docker network inspect <ic-api> --format '{{range .Containers}}{{.Name}} {{.IPv4Address}} {{end}}'`.
- Bellek: `free -m` → kullanılabilir ≥ 1,3 GB değilse DUR (patron tavanı 1 GiB + pay). Ölçümü §12'ye yaz.

## 4. Kurulum (VDS YAZIMI — kullanıcının "uygula" cümlesiyle)

0. **Önce:** `Teks-Erp-wt/vds-dogrula.sh` → ✅ (çıkış 0).
1. **Dizinler ve sahiplik** (`SIR_GID` .env'deki sayı, satıcınınkinden AYRI; sunucuda grup olması gerekmez). `oguzhan`ın sudo'su parola ister: etkileşimsiz oturumda kök sahipli yazımlar satıcı kurulumundaki gibi tek seferlik yardımcı konteynerle yapılır (`--network none`, yalnız hedef dizin bağlı — `SATICI-KURULUM.md` §12 "sudo'suz kurulum").

   ```bash
   K=/opt/stack/apps/tekserp-patron-uretim
   sudo install -d -m 755 -o root -g root $K $K/yedek-alici
   sudo install -d -m 700 -o 10001 -g 10001 $K/anahtarlar /srv/tekserp-patron-yedek/uretim
   sudo install -d -m 750 -o root -g 61062 $K/sirlar
   for s in goc uygulama esitleme; do openssl rand -hex 32 | sudo tee $K/sirlar/$s-parolasi >/dev/null; done   # ekrana BASILMAZ
   sudo cp /opt/stack/apps/tekserp-satici-hazirlik/sirlar/ic-api-belirteci $K/sirlar/ic-api-belirteci          # satıcıyla AYNI değer, AYRI dosya
   sudo chown root:61062 $K/sirlar/* && sudo chmod 440 $K/sirlar/*
   ```

2. **Dosyalar (Mac'ten):** `docker-compose.yml`, doldurulmuş `.env` (0600), `patron.tkpub` (`$K/yedek-alici/`, 644).
3. **Anahtar** (geçici kopya shred'lenir):

   ```bash
   scp -rp ~/.tekserp/patron-uretim/anahtarlar tekserp-vds:patron-anahtar-gecici
   ssh -t tekserp-vds 'sudo install -m 600 -o 10001 -g 10001 ~/patron-anahtar-gecici/patron-totp.key /opt/stack/apps/tekserp-patron-uretim/anahtarlar/ &&
     shred -u ~/patron-anahtar-gecici/* && rmdir ~/patron-anahtar-gecici'
   ```

4. **İmaj:** `scp ~/.tekserp/patron-imaj/tekserp-patron-<sha>.tar.gz* tekserp-vds:/tmp/` → sunucuda `cd /tmp && sha256sum -c tekserp-patron-<sha>.tar.gz.sha256 && gunzip -c tekserp-patron-<sha>.tar.gz | sudo docker load && rm tekserp-patron-<sha>.tar.gz*`.
5. **Ağlar + Traefik bağlantısı (yeniden başlatmasız):**

   ```bash
   cd $K && sudo docker compose up --no-start           # ağlar + konteynerler yaratılır, hiçbiri başlamaz (ic-api yoksa burada DURUR)
   sudo docker network connect tekserp-patron-uretim-kenar traefik
   ```

   Kalıcılık: Traefik'in compose dosyasına (`/opt/stack/traefik/docker-compose.yml`; önce `cp -p … docker-compose.yml.yedek-<tarih>-patron`) `networks:` altına `tekserp-patron-uretim-kenar: {external: true}` ve traefik servisine aynı ağ eklenir, `docker compose config -q` yeşil — Traefik **şimdi yeniden başlatılmaz**; bir sonraki yeniden yaratılışında bağlantıyı dosyadan alır. (Geri alırken bu satır ağdan ÖNCE kaldırılır, yoksa Traefik açılamaz.)
6. **Göç + roller** (geri alınamaz eşik; boş DB'de ilk kurulum): `sudo docker compose --profile goc run --rm patron-goc` → "All migrations have been successfully applied" + `✅ roller hizalandı — DB patron · uygulama patron_uygulama · eşitleme patron_esitleme`. Her sürüm yükseltmesinde aynı komut (roller idempotent; yeni tablonun yetkisi `db-grants.ts`ten gelir).
7. **Başlat:** `sudo docker compose up -d` → üçü `healthy`/`Up`; günlük `PATRON_DINLIYOR port=4620 kurulumKaynagi=satici web=acik`.
8. **İlk tesis ve ilk tesis yöneticisi** (tesis kimliği SATICIDAN — fabrikanın HAK'ındaki `tesis.id`; burada uydurulmaz). Davet belirteci YALNIZ bu çıktıda, bir kez basılır — yöneticiye güvenli kanaldan iletilir, çıktı loga yönlendirilmez:

   ```bash
   sudo docker compose --profile goc run --rm patron-goc node dist-cli/scripts/tesis.js tesis-ac --tesis=<tesis uuid> --ad="<Firma>" [--saklama=13]
   sudo docker compose --profile goc run --rm patron-goc node dist-cli/scripts/tesis.js yonetici-davet --tesis=<tesis uuid> --eposta=<e-posta> --ad="<Ad Soyad>"
   ```

   Yönetici davetle `https://patron.etkiliyazilim.com/` üzerinden parolasını belirler, TOTP sırrını authenticator'a girer ve ilk kodla onaylar; ekibini kendisi davet eder. Kayıpta: `tesis.js yonetici-yeniden-davet`. Kurulum kaydı `KURULUM_KAYNAGI=satici` kipinde satıcı iç API'sinden dolar (CLI'yle kayıt gerekmez).
9. **İlk yedek:** `sudo docker compose exec patron-yedek /arac/yedek-dongusu.sh tek` → `patron_<damga>.dump.tkenc` + `anahtarlar_<damga>.tar.tkenc` ("Yerel anahtar (yerel.tkkey) yok" uyarısı BEKLENİR — VDS kendi yedeğini açamaz).
10. **Sonra:** `Teks-Erp-wt/vds-dogrula.sh` → ✅ adnansahin AYNI.

## 5. DNS (kullanıcı — Cloudflare)

`patron` A → `80.253.255.188`, **proxy AÇIK (turuncu bulut)** — sertifika Origin CA `*.etkiliyazilim.com`, ona yalnız CF Edge güvenir. Kayıt kurulumdan ÖNCE açılırsa `/saglik` 404 döner (Traefik'te yönlendirici yok, zararsız); sonra 200. Önbellek kuralı gerekmez: giriş HTML'i `no-store`, özetli varlıklar `immutable` (CF köken başlığına uyar), API `no-store`. Fabrikanın varsayılan bulut adresi zaten `https://patron.etkiliyazilim.com`'dur (`Teks-Erp/src/cloud-sync/cloud-url.ts`, `PATRON_CLOUD_URL`).

## 6. Doğrulama (sonra)

| Ölçüm | Nereden | Beklenen |
|---|---|---|
| `curl -s https://patron.etkiliyazilim.com/saglik` | internet | `{"success":true}` |
| `curl -sI https://patron.etkiliyazilim.com/` | internet | `200` · `text/html` · `cache-control: no-store` · `content-security-policy` (`unsafe-inline` YOK) · `x-frame-options: DENY` |
| giriş HTML'indeki `/_expo/static/js/web/entry-<özet>.js` | internet | `200` · `cache-control: public, max-age=31536000, immutable` |
| `/cariler/x` (istemci yönlendirmesi) | internet | `200` giriş HTML'i |
| `/api/yok` · `/v1/yok` | internet | `404` JSON `BULUNAMADI` (HTML değil) |
| `/ic/v1/zil` · `/yonetim` | internet | `404` (Traefik; yönlendirici bu yolları almaz) |
| `/v1/esitle` imzasız `POST` | internet | `401`/`400` JSON (fabrika kanalı imza ister) |
| `curl -m 5 http://80.253.255.188:4620/` | internet | zaman aşımı / reddedildi (port yayını yok) |
| Tarayıcıda `https://patron.etkiliyazilim.com/` | Mac | giriş ekranı; geliştirici konsolunda CSP ihlali YOK |
| `sudo docker compose ps` | VDS | üçü `healthy`/`Up` |
| `docker inspect tekserp-patron-uretim --format '{{index .Config.Labels "traefik.http.routers.tekserp-patron-uretim.rule"}}'` | VDS | kural `!PathRegexp(…^/(ic\|yonetim)(/\|$)…)` ile biter — tek `$` (compose `$$` kaçışı çözülmüş) |
| `sudo docker compose logs patron \| grep PATRON_DINLIYOR` | VDS | `kurulumKaynagi=satici web=acik` |
| Satıcı iç API'si patrondan | VDS | `docker exec tekserp-patron-uretim patron-baslat node -e "fetch('http://<IC_API_IP>:4612/ic/v1/kurulum/00000000-0000-4000-8000-000000000000',{headers:{Authorization:'Bearer '+process.env.SATICI_IC_API_BELIRTECI}}).then(r=>console.log(r.status))"` → `404` (kurulum yok, kapı geçildi); belirteçsiz `401` |
| `sudo docker stats --no-stream` | VDS | sınırlar tablodaki gibi; `free -m` kullanılabilir ≥ 300 MB |
| `curl -sI https://guncelleme.etkiliyazilim.com/adnansahin/electron/latest.yml` + `vds-dogrula.sh` | Mac | 200 · adnansahin AYNI |
| Yedek açılır mı (§7) | Mac | `pg_restore --list` dolu; anahtar arşivi Mac'teki `patron-totp.key` ile bayt-eşit |

Not: sırlar yalnız `patron-baslat`in başlattığı sürecin ortamındadır — `docker inspect` ve düz `docker exec` onları GÖRMEZ (yerel dumanda ölçüldü); iç API ölçümü bu yüzden `patron-baslat node …` ile koşar ve çıktısı yalnız durum kodudur, belirteç basılmaz.

## 7. Yedek — çekme, açma, geri yükleme

```bash
ssh -p 2222 oguzhan@80.253.255.188 'cd /opt/stack/apps/tekserp-patron-uretim && docker compose exec -T patron-yedek cat /yedek/<dosya>' > ~/.tekserp/patron-uretim-yedek/<dosya>
cd Teks-Erp && npx tsx scripts/yedek-sifrele.ts coz --girdi ~/.tekserp/patron-uretim-yedek/patron_<damga>.dump.tkenc \
  --cikti /tmp/patron.dump --anahtar ~/.tekserp/sirlar/patron-uretim-yedek-ozel.txt && pg_restore --list /tmp/patron.dump | head
```

Özet iki uçta `sha256sum`/`shasum -a 256` ile karşılaştırılır. **Geri yükleme** (boş DB'ye; kullanıcı kararı): roller küme düzeyindedir ve dökümde yoktur → `pg_restore --no-owner --no-acl -d patron` göç rolüyle, ardından `--profile goc run --rm patron-goc` rolleri ve yetkileri parolalarıyla yeniden kurar (RLS politikaları ve `FORCE` şemanın kendisindedir, dökümle gelir). Anahtar arşivi (`anahtarlar_<damga>.tar.tkenc`) `patron-totp.key`i taşır — o olmadan geri yüklenen hesapların TOTP sırları çözülmez.

## 8. Geri alma

```bash
cd /opt/stack/apps/tekserp-patron-uretim
sudo docker compose down                                   # birim (patron DB'si) KALIR — silmek kullanıcı kararı
# Traefik compose'undaki kenar ağı satırı KALDIRILIR (yedeği yanında), sonra:
sudo docker network disconnect tekserp-patron-uretim-kenar traefik 2>/dev/null; sudo docker network rm tekserp-patron-uretim-kenar tekserp-patron-uretim-ic
```

`compose down` satıcının `ic-api` ağına DOKUNMAZ (external) — yalnız patronun bağlantısı düşer. DNS kaydı (kullanıcı) · `docker rmi tekserp-patron:<sha> tekserp-patron-yedek:<sha>`. Sonunda `vds-dogrula.sh` → ✅. Fabrikalar etkilenmez: bulut adresine ulaşamayan eşitleme turu sessizce bir sonraki tura kalır (veri fabrikada; bulut okuma kopyasıdır).

**Sürüm yükseltme:** yeni imaj (§2.2 + §4.4) → `exec patron-yedek … tek` (önce yedek) → `.env`'de etiket → `--profile goc run --rm patron-goc` → `sudo docker compose up -d`. Eski imaj bir sürüm boyunca kalır; geri dönüş = eski etiket + (göç geri alınamaz) yedekten geri yükleme. Web sürümü imajla birlikte değişir; özetli varlık adları yeni olduğundan tarayıcı önbelleği temizlik gerektirmez.

## 9. Fabrika tarafı

Bulut adresinin tek okuyucusu `Teks-Erp/src/cloud-sync/cloud-url.ts` (`PATRON_CLOUD_URL`; verilmezse `https://patron.etkiliyazilim.com`, `kapali` → çıkış yok). Eşitleme yalnız `URETIM` sınıfı + `patron-bulut` hakkıyla gider; bulut da aynı koşulu ikinci kez ölçer (`SINIF_GONDEREMEZ` / `PATRON_BULUT_KAPALI`).

## 10. Satıcı iç API'si ile bağ

Satıcı tarafı `SATICI-KURULUM.md` §5b'dedir: ağ (`IC_API_AGI`), sabit adresler (`IC_API_IP`, `PATRON_IC_IP`), sır. Patron tarafı: `.env`'de aynı üç değer (§2.3) + sır dosyasının kopyası (§4.1). **Sır rotasyonu:** satıcıda yeni sır → `sudo cp` ile patron kopyası → `sudo docker compose up -d --force-recreate patron` (satıcı §5b.6 ile aynı pencerede). Arada patron 401 alır: önbellekteki bayat kayıtla sürer, zil kaçar (fabrika her turda yine yoklar). İç API'yi patron tarafında kapatmak: kopyayı boşalt (`truncate -s 0`) + `.env`'de `KURULUM_KAYNAGI=kayit` + yeniden yarat — kurulum kaydı o zaman CLI'yle (`tesis.js kurulum-kaydet`) tutulur.

## 11. Açık riskler

- **Hazırlık satıcısı yalnız TEST/DEMO imzalar**, patron eşitlemeyi yalnız `URETIM` sınıfından kabul eder → `SATICI_IC_API_AGI=tekserp-satici-hazirlik-ic-api` ile kurulu patron web/giriş/hesap yönetimi için doğrulanabilir, ama fabrikadan gerçek eşitleme **üretim satıcısı** (ayrı compose, `ORTAM=uretim`) kurulup patron onun ağına bağlanınca akar (ağ adı + iki adres + sır değişir, §10).
- **Bildirim çıkışı yok:** kenar/ic internal, ic-api internal → patron dış dünyaya bağlanamaz. B5 (Expo push · FCM · APNs · web push) dış çıkış ister: yalnız çıkışa izinli ayrı bir ağ ya da vekil — ayrı karar, bu yığında YOK (bilerek; ilk kurulum sıfır çıkışla başlar).
- **`cf-connecting-ip` taklit edilebilir** — köken (VDS:443) yalnız Cloudflare IP'lerine açılana dek doğrudan köke gelen istek başlığı uydurabilir; etkisi IP başına hız sınırının (giriş, `/v1`) atlatılmasıdır. Giriş ayrıca hesap başına kilitlidir (`GIRIS_ESIGI` → `KILIT_DK`), `/v1` her istek kurulum imzalıdır. Kalıcı çare satıcıyla aynı (Faz 3a, köken CF'ye kapatma).
- **`patron-totp.key` tek noktadır:** kaybı bütün hesapların yeniden daveti demektir → VDS dışı kopya (USB) + şifreli yedek (§7). Konteyner kaçışı anahtarı okur (kök FS salt okunur, yetenek yok; kabul edilen risk).
- **İç API sırrı iki dosyada** (satıcı `sirlar/` · patron `sirlar/`, ikisi de 0440 kendi grubuyla): VDS'te root ikisini okur (kabul). Sızarsa açığa çıkan yalnız satıcı allowlist'i (açık anahtar, sınıf, hak, tesis adı) ve içerik taşımayan zil.
- Traefik'in kalıcı ağ satırı Traefik compose'unu değiştirir (§4.5) — o dosya bu repoda değil; öncesi yanında `.yedek-<tarih>-patron`.

## 12. Kayıt — yerel duman (2026-09-29, VDS'e uygulanmadı)

- **İmaj:** `imaj-derle.sh --platform linux/amd64 --yukle-yok` (Apple Silicon'da öykünme; web aşaması yerel mimaride) → `tekserp-patron` ~800 MB açık boyut (satıcı 838 MB) · `tekserp-patron-yedek` 139 MB. İmajda `src/`, `tsx`, uygulama kaynağı, `metadata.json` YOK; `dist/`, `dist-cli/` (tesis · db-rolleri), `web/` (1,2 MB), kullanıcı 10001.
- **Göç + roller:** 1 migration (`20260929200000_ilk_sema`) · `✅ roller hizalandı — DB patron · uygulama patron_uygulama · eşitleme patron_esitleme`; sunucu iki çalışma rolüyle açıldı (RLS atlayamaz kapısı geçti).
- **HTTP (127.0.0.1):** `/saglik` 200 · `/` 200 `text/html` `no-store` · CSP `style-src 'self' 'sha256-47DEQ…' 'sha256-+R/ZC…'` (boş öge + Expo sıfırlama stili) · `entry-<özet>.js` `immutable` · `/cariler/x` 200 · `/api/yok` · `/v1/yok` · `/ic/v1/zil` · `/yonetim` 404 · `/api/oturum` 401 · `/v1/esitle` imzasız 401 `ISTEK_GECERSIZ` · konteyner etiketi `… !PathRegexp(`^/(ic|yonetim)(/|$)`)` (compose `$$` → tek `$`) · ic-api adresinde 4620 `ECONNREFUSED` (yalnız kenarda dinler).
- **Gerçek tarayıcı (Chromium):** İLK imajda sayfa STİLSİZ çizildi — CSP `style-src-elem inline` ihlali: react-native-web `<style id="react-native-stylesheet">` ögesini BOŞ yaratıp kuralları CSSOM'la ekler, boş içerikli satır içi öge de özet ister; öge engellendi (`sheet` null), bütün RNW kuralları düştü. curl başlıkları bunu göstermedi. Boş dizgenin özeti eklendi → 0 ihlal, 0 konsol hatası, stilli giriş ekranı. Ölçüm artık dumanın parçası (`tarayici-duman.cjs`, çıkış 0|1).
- **Uygulama dumanı** (uygulamanın kendi istemcisi, `patron/uygulama/scripts/duman.ts`): 13/13 — davet → parola → TOTP onayı → yanlış TOTP 401 `GIRIS_BASARISIZ` → giriş (17 izin) → oturum → pano 404 (eşitleme yok) → gelen kutusuna sipariş BEKLIYOR → aynı kimlikle tekrar aynı mesaj → durum → iptal → iptal tekrarı aynı sonuç → çıkış, eski belirteç 401. İlk koşum 8. adımda 403 `PATRON_BULUT_KAPALI` verdi: yazma kanalı tesisin açık aboneliğini ister → duman `kurulum-kaydet` (URETIM + `patron-bulut`) adımını aldı.
- **Sertlik:** kök FS ve `/anahtarlar` yazılamaz (`Read-only file system`) · `CapDrop=[ALL]` · `Memory=536870912` · `docker inspect` ortamında DB URL'i/belirteç YOK.
- **Yedek:** `yedek-dongusu.sh tek` → `patron_<damga>.dump.tkenc` + `anahtarlar_<damga>.tar.tkenc`; özel yarıyla açıldı, `pg_restore --list` 17 tablo verisi.
- **Kaynak (öykünme altında, boşta):** patron 172 / 512 MiB · DB 31 / 384 · yedek 6 / 128; süreç 12 · 9 · 3. VDS'te yerel mimaride daha düşük beklenir — kurulum sonrası `docker stats` bu satırın yanına yazılır.
- **Temizlik:** `duman.sh kaldir` → proje `tekserp-patron-duman` (konteyner · birim · ağ) ve yalnız iki `tekserp-patron*:<sha>` imajı silindi; satıcı imajları ve ortak `tekserp-local-db` konteynerine dokunulmadı.

