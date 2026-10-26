# Patron bulutu — tekserp-vds kurulum runbook'u

> **Durum (2026-10-16):** tekserp-vds'te **KURULU** — `tekserp-patron:e847c7a55f3e` (ilk kurulum `55203d9708ba`, yükseltmeler §13a · §13b · tesis DB geçişi `PATRON-TESIS-DB-GECIS.md` §6 · §13c · §13d · ad değişimi §15a), o gün hazırlık satıcısının iç API ağına bağlıydı (§11 ilk madde), `https://patron.etkiliyazilim.com` yanıt veriyor. Kurulum kaydı §13; yerel duman kaydı §12.
> **Ad değişimi (kullanıcı kararı 2026-10-16):** kullanıcıya görünen ad "TeksERP Yönetim", birincil alan adı
> `yonetim.etkiliyazilim.com`; `patron.etkiliyazilim.com` aynı yönlendiricide **KALICI takma ad** (kurulu fabrikalar
> `https://patron.etkiliyazilim.com/v1`'e eşitler — kapatılmaz). VDS'e UYGULANDI 2026-10-15 22:33Z = 2026-10-16 01:33 TSİ (§15a).
> **Hazırlık izleri temizlendi (2026-10-05):** hazırlık satıcısı emekli ve verisi silindi; patron iç API'si ÜRETİM satıcısına bağlı (ölçüldü 2026-10-05: ağ `tekserp-satici-uretim-ic-api`, `.env`'de hazırlık değeri yok — §14 uygulanmış). Deneme tesisi "Etkili Yazılım Hazırlık" (`c0f70948…`) önce PASİF yapıldı, sonra `tesis.js imha` ile imha edildi (hesap 1 · hesap audit'i 4 · tesis 1; imha kaydı `facility_destructions`ta, yedekten düşme 2026-11-09); patron üretim DB'sinde tesis 0. Eski hazırlık env yedeği (VDS) ve davet dosyası (Mac) silindi. §0–§13'teki hazırlık anlatımı (ağ adı, sır kopyası, deneme tesisi) tarihtir; `deploy/patron/ornek.env`teki hazırlık örneği kod işinde (3.1).
> Yapıtlar: [`deploy/patron/`](../../deploy/patron/) (compose · Dockerfile · imaj derleme · yalıtım denetimi · duman). Sözleşme: [`PATRON-BULUTU-ESITLEME.md`](../design/PATRON-BULUTU-ESITLEME.md). Alan kuralları: [`kurallar/patron-bulutu.md`](../kurallar/patron-bulutu.md) § Dağıtım. Emsal ve paylaşılan adımlar: [`SATICI-KURULUM.md`](SATICI-KURULUM.md) (satıcı ÖNCE kurulu olmalı — patron onun iç API ağına katılır).
> **v2 (0.2.0) yükseltme hazırlığı (2026-10-24):** §17 — UYGULANMADI; aday imaj `2bd3d7b0855e` (ikon fontu CSP düzeltmesi #100 dahil), yerel duman + tarayıcı dumanı yeşil (§17.2); eski aday `f80edf15df5b` BLOKE kaldı (§17.3).
> **Değişmez:** her VDS yazımından ÖNCE ve SONRA `deploy/vds-dogrula.sh` → *adnansahin baytları AYNI* (salt okuma, çıkış 0). Fark çıkarsa dur. Traefik **yeniden başlatılmaz**.

## 0. Kapsam

| Kurulur | Kurulmaz |
|---|---|
| `ORTAM=uretim` — `yonetim.etkiliyazilim.com` (birincil) + `patron.etkiliyazilim.com` (kalıcı takma ad), ikisi aynı yönlendirici: web sürümü `/` · hesap API'si `/api` · fabrika kanalı `/v1` | Bildirim çıkışı (B5: Expo/FCM/APNs/web push) — bu yığında dış ağ YOK (§11) |
| Patronun kendi PG16'sı + şifreli yedek döngüsü | Satıcı (ayrı compose, `SATICI-KURULUM.md`) · Traefik yapılandırması (yalnız bir ağ bağlantısı + iki satır) |
| Üç DB rolü (göç · uygulama · eşitleme) · ilk tesis + ilk tesis yöneticisi (CLI) | Mağaza uygulamaları (iOS/Android derlemesi) |

Dokunulmayan: `tekserp-guncelleme`, satıcı yığını (yalnız onun `ic-api` ağına **katılınır**), `/srv/tekserp-yedek`, `/srv/tekserp-arsiv`.

## 1. Mimari

```
Cloudflare (proxy AÇIK) ─443─► Traefik (websecure, Origin CA *.etkiliyazilim.com)
                                  │  (Host(`yonetim.etkiliyazilim.com`) || Host(`patron.etkiliyazilim.com`)) && !PathRegexp(`^/(ic|yonetim)(/|$)`)
                                  ▼  ağ: tekserp-patron-uretim-kenar (internal)
                         patron :4620 (BIND = kenar adresi)  / web · /api · /v1 · /saglik
                         patron ◄─ ağ: …-ic (internal) ─► patron-db (PG16) ◄─ patron-yedek
                         patron ── ağ: tekserp-satici-<ortam>-ic-api (satıcının, internal) ──► satıcı :4612 /ic/v1/*
                         patron ── ağ: tekserp-patron-uretim-cikis (internal DEĞİL, yalnız patron) ──► Expo push · web push (B5)
```

| Konteyner | İmaj | Kullanıcı | Bellek · CPU · süreç | Ağlar |
|---|---|---|---|---|
| `tekserp-patron-uretim` | `tekserp-patron:<sha>` (node 24, `node dist/server.js`, web çıktısı `/uygulama/web`) | 10001 | 512 MB (yığın 320) · 0,75 · 200 | kenar (sabit IP) · ic · ic-api (sabit `PATRON_IC_IP`) · cikis |
| `tekserp-patron-uretim-db` | `postgres:16-alpine` (özetle sabit) | 70 | 384 MB (`shared_buffers` 96 MB) · 0,5 · 100 | ic |
| `tekserp-patron-uretim-yedek` | `tekserp-patron-yedek:<sha>` (pg_dump 16 + `yedek-sifrele.cjs`) | 10001 | 128 MB · 0,25 · 50 | ic |
| `patron-goc` (profil `goc`, tek seferlik) | `tekserp-patron:<sha>` | 10001 | 384 MB · 0,5 · 100 | ic |

**Kaynak gerekçesi (VDS 2 çekirdek / 2972 MB):** mevcut tavanlar — traefik 192 · socket-proxy 64 · güncelleme 64 · satıcı 384 + 256 + 128 + tünel 64 ≈ 1,15 GB (gerçek kullanım ~150 MB, `SATICI-KURULUM.md` §12). Patronun uzun ömürlü tavanı **1 GiB** (denetim ③ ölçer) → toplam tavan ≈ 2,2 GB, işletim sistemi + Docker'a ≥ 700 MB kalır. En ağır iş fabrika paketi: `/v1/esitle` gövdesi gzip açılmış ≤ 32 MB → JSON ayrıştırma ~100–160 MB yığın; 512 MB tavan + `--max-old-space-size=320` çöp toplayıcıyı OOM öldürmesinden ÖNCE devreye sokar. CPU sınırları rezervasyon değil tavandır (sıkıştırılabilir): patron dolu yükte bile satıcıyı ve güncelleme yayınını aç bırakamaz.

**Ağ kapıları:** kenar internal — patron dış dünyaya ancak Traefik'in içinden görünür, kendisi dışarı çıkamaz; Traefik bu ağa DİNAMİK adresle (`KENAR_DINAMIK_ARALIK`) katılır, patronun sabit `KENAR_IP`'si aralığın dışında (satıcı kurulumunda ölçülen "Traefik satıcının adresini kaptı" çakışması). Patron YALNIZ kenar adresinde dinler: `ic-api` ağından (satıcı ya da oraya katılan konteyner) patrona ulaşılamaz. `ic-api` satıcının ağıdır; patron oraya satıcının kaynak kapısının kabul ettiği tek `/32` ile (`PATRON_IC_IP`) katılır. `cikis` (B5 bildirimleri, I6 kararı) internal OLMAYAN tek ağdır: yalnız patron katılır ve orada DİNLEMEZ (BIND = kenar adresi); DB · göç · yedek internal kalır (denetim ④). `BILDIRIM_KIPI` varsayılanı `kapali` (bugünkü davranış) — ağ açık dursa da `gercek` seçilmedikçe dışarı gönderim olmaz.

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

**Bildirimler `gercek` kipte açılacaksa (B5):** web push VAPID anahtar çifti anahtar biriminde ÖNCEDEN durmalıdır — birim konteynerde salt okunur, sunucu ilk açılışta üretemez. Mac'te bir kez üretilir, `patron-totp.key`le aynı dizine (600) konur ve §4 adım 3'te onunla birlikte kopyalanır (kaybı bütün web aboneliklerinin yenilenmesi demektir):

```bash
cd patron/sunucu && D=~/.tekserp/patron-uretim/anahtarlar npx tsx -e 'import("./src/push/vapid.ts").then((m) => m.VapidKeys.load(process.env.D, { create: true }))'
```

### 2.2 İmaj

```bash
deploy/patron/imaj-derle.sh                 # HEAD'den (git archive); kirli ağaç RED; linux/amd64
# → ~/.tekserp/patron-imaj/tekserp-patron-<sha>.tar.gz + .sha256 ; PATRON_IMAJ / PATRON_YEDEK_IMAJ satırlarını basar
```

VDS'te derleme YOK, kaynak VDS'e gitmez. Web aşaması derleme makinesinin KENDİ mimarisinde koşar (çıktı statik dosya); imaja yalnız çıktı geçer. İmaj `src/`, `tsx`, uygulama kaynağı ya da uygulama `node_modules`'ü taşımaz; CLI'lar (`dist-cli/scripts/db-rolleri.js` · `tesis.js`) derlenmiş durur.

### 2.3 Sunucunun `.env`'i

`deploy/patron/ornek.env`'den doldurulur (sır İÇERMEZ): `PATRON_HOST=yonetim.etkiliyazilim.com` + `PATRON_TAKMA_HOST=patron.etkiliyazilim.com` (ikisi de zorunlu; eksikse `compose config` durur, aynıysa denetim ⑦ kırmızı), ağlar §3'ten, satıcı değerleri (`SATICI_IC_API_AGI` = `tekserp-satici-<ortam>-ic-api` · `SATICI_IC_API_IP` = satıcının `IC_API_IP` · `PATRON_IC_IP` = satıcının `PATRON_IC_IP`) **satıcının `.env`'inden**, imaj etiketleri §2.2'den.

### 2.4 Yalıtım denetimi — kurulumdan ÖNCE yeşil

```bash
node deploy/patron/compose-denetle.mjs --env-file <patron .env> --satici-env <satıcının .env'i>   # 0 temiz · 1 ihlal · 2 ölçülemedi
```

① port yayını yok · ② docker soketi yok · ③ salt okunur/yetenek yok/root değil/sınırlı + uzun ömürlü tavan ≤ 1 GiB · ④ kenar + ic internal, tek dış ağ satıcının ic-api'si ve ona yalnız `patron`; internal olmayan tek ağ `cikis` ve ona yalnız `patron` · ⑤ anahtar birimi salt okunur · ⑥/⑥b aralıklar, patronun kenar adresi dinamik aralığın dışında · ⑦ Traefik yalnız patronda, kural Host + iç ad alanı dışlaması, `BIND` = kenar adresi, DB portsuz · ⑧ göç parolası sunucuya bağlı değil, ortamda düz sır yok · ⑨ satıcıyla uyum (ağ adı · `PATRON_IC_IP` · iç API adresi aynı; `SIR_GID` farklı; kenar ve çıkış ağları satıcının hiçbir ağıyla çakışmaz). Satıcının `.env`'i verilmezse ⑨ **ölçülemedi** (çıkış 2) — geçti sayılmaz. Not: Node `--env-file` bayrağını kendisi de okur; dosya yoksa betik açılmadan 9 ile çıkar (satıcı denetiminde de aynı).

### 2.5 Yerel duman — imajı VDS'e götürmeden önce

```bash
deploy/patron/imaj-derle.sh --platform linux/amd64 --yukle-yok   # arşivsiz, yalnız yerel imaj (VDS'in mimarisi; Mac'te öykünme)
deploy/patron/duman.sh kur <sha>       # proje tekserp-patron-duman · yalnız 127.0.0.1:18620 · kendi DB konteyneri
deploy/patron/duman.sh sifirla <sha>   # compose down -v YALNIZ bu proje + durum dizini (imajlar kalır — yeniden kur için)
deploy/patron/duman.sh kaldir <sha>    # compose down -v YALNIZ bu proje + YALNIZ bu iki imaj + durum dizini
```

`docker-compose.duman.yml` örtüsü Traefik ve satıcı olmadan koşturur (kenar internal değil + `127.0.0.1` yayını; ic-api projenin kendi internal ağı; `KURULUM_KAYNAGI=kayit`) — compose-denetle bu örtüyü bilerek reddeder. `duman.sh kur`: göç + roller → `tesis.js tesis-ac` + `kurulum-kaydet` (URETIM + `patron-bulut`, yazma kanalı açık abonelik ister) + `yonetici-davet` → HTTP ölçümleri (web kökü · varlık önbelleği · CSP · API/iç ad alanı 404 · konteynerdeki Traefik etiketi · ic-api adresinde dinleyici yok) → gerçek Chromium (`tarayici-duman.cjs`: CSP ihlali 0 · konsol hatası 0 · giriş formu çizildi · `//` ve `//cariler//x` sayfa hatasız çizilir; playwright paneldeki e2e kurulumundan) → uygulamanın kendi istemcisiyle duman (`patron/uygulama/scripts/duman.ts`: davet → parola → TOTP onayı → giriş → oturum/pano → gelen kutusu → iptal → çıkış) → `yedek-dongusu.sh tek` + özel yarıyla açma + `pg_restore --list` → `docker stats`.

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

0. **Önce:** `deploy/vds-dogrula.sh` → ✅ (çıkış 0).
1. **Dizinler ve sahiplik** (`SIR_GID` .env'deki sayı, satıcınınkinden AYRI; sunucuda grup olması gerekmez). `oguzhan`ın sudo'su parola ister: etkileşimsiz oturumda kök sahipli yazımlar satıcı kurulumundaki gibi tek seferlik yardımcı konteynerle yapılır (`--network none`, yalnız hedef dizin bağlı — `SATICI-KURULUM.md` §12 "sudo'suz kurulum").

   ```bash
   K=/opt/stack/apps/tekserp-patron-uretim
   sudo install -d -m 755 -o root -g root $K $K/yedek-alici
   sudo install -d -m 700 -o 10001 -g 10001 $K/anahtarlar /srv/tekserp-patron-yedek/uretim
   sudo install -d -m 711 -o root -g 61062 $K/sirlar     # 711: sudo'suz `docker compose` (oguzhan) sır dosyalarını çözebilsin — satıcı kalıbı; içerik yine 0440
   for s in goc uygulama esitleme; do openssl rand -hex 32 | sudo tee $K/sirlar/$s-parolasi >/dev/null; done   # ekrana BASILMAZ
   sudo cp /opt/stack/apps/tekserp-satici-hazirlik/sirlar/ic-api-belirteci $K/sirlar/ic-api-belirteci          # satıcıyla AYNI değer, AYRI dosya
   sudo chown root:61062 $K/sirlar/* && sudo chmod 440 $K/sirlar/*
   ⚠️ (2026-10-12, B6) `patron-tesis-db.key`/`tesis-rol-anahtari` ve `anahtarlar/patron-totp.key` diğerlerine açıksa patron **AÇILMAZ**; yükseltmeden önce `sudo stat -c '%a %U:%G %n'` ile bakın, gerekirse `chmod o-rwx`.
   ```

2. **Dosyalar (Mac'ten):** `docker-compose.yml`, doldurulmuş `.env` (0600), `patron.tkpub` (`$K/yedek-alici/`, 644).
3. **Anahtar** (geçici kopya shred'lenir):

   ```bash
   scp -rp ~/.tekserp/patron-uretim/anahtarlar tekserp-vds:patron-anahtar-gecici
   ssh -t tekserp-vds 'sudo install -m 600 -o 10001 -g 10001 ~/patron-anahtar-gecici/patron-totp.key $(ls ~/patron-anahtar-gecici/patron-vapid.json 2>/dev/null) /opt/stack/apps/tekserp-patron-uretim/anahtarlar/ &&
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

   Yönetici davetle `https://yonetim.etkiliyazilim.com/davet?davet=<belirteç>` üzerinden parolasını belirler, TOTP sırrını authenticator'a girer ve ilk kodla onaylar; ekibini kendisi davet eder. Kayıpta: `tesis.js yonetici-yeniden-davet` (tesiste AKTİF hesap yöneticisi varken REDDEDİLİR — o yönetici kendisi sıfırlar; tek aktif yönetici kendisi kayıpsa yalnız yazılı taleple `--zorla --talep=<talep no> --gerekce="…"`, ikisi de müşterinin bulut denetiminde görünür). Kurulum kaydı `KURULUM_KAYNAGI=satici` kipinde satıcı iç API'sinden dolar (CLI'yle kayıt gerekmez).
9. **İlk yedek:** `sudo docker compose exec patron-yedek /arac/yedek-dongusu.sh tek` → `patron_<damga>.dump.tkenc` + `anahtarlar_<damga>.tar.tkenc` ("Yerel anahtar (yerel.tkkey) yok" uyarısı BEKLENİR — VDS kendi yedeğini açamaz).
10. **Sonra:** `deploy/vds-dogrula.sh` → ✅ adnansahin AYNI.

### 4b. Güvenlik bildirimi (B3) — AYRI Telegram grubu

Patron sunucusu güvenlik olaylarını (fabrika kanalı imza/kurulum reddi 401 · hak reddi 403 · hesap girişi kilidi · hız sınırı · sır dosyası izni reddi) kendisi, doğrudan güvenlik grubuna yollar (giden kutusu yok; e-posta yok). Gürültü: sınıf başına dakikalık eşik, ilk ileti hemen, sonraki 5 dk tek iletide sayaçla, günde bir özet. Belirteç ya da grup kimliği boşsa kanal KAPALI: olaylar yalnız sayılır, açılış günlüğü `[patron] güvenlik bildirimi: KAPALI (…)` der (genel `/saglik` bunu BİLEREK taşımaz — internete açıktır).

Kullanıcının adımları (değerleri Claude'a VERMEYİN):

1. **Bot oluştur (bir kez; satıcı bildirimleri için bot zaten varsa onu kullanın):** Telegram'da `@BotFather` → `/newbot` → ad ve `..._bot` ile biten kullanıcı adı → verilen **bot belirtecini** (biçim `123456789:AA…`) kopyalayın. Belirteç SIRDIR: sohbete, e-postaya, repoya yazmayın.
2. **Güvenlik grubunu aç:** Telegram'da YENİ bir grup (ör. "TeksERP Güvenlik") — işletme bildirim grubundan AYRI; yalnız güvenlikten sorumlu kişileri ekleyin; botu gruba üye olarak ekleyin.
3. **Sohbet kimliğini al:** gruba herhangi bir ileti yazın (ör. `/start`), sonra tarayıcıda `https://api.telegram.org/bot<BELİRTEÇ>/getUpdates` açın → `"chat":{"id":-100…}` değerini alın (eksi işaretiyle, yalnız sayı). Grup sonradan süper gruba yükselirse kimlik değişir — gönderici günlüğü yeni kimliği söyler, dosyayı güncelleyin.
4. **Dosyaları yaz (VDS, `sirlar/`, root:SIR_GID 0440):** `sirlar/guvenlik-telegram-belirteci` (bot belirteci) ve `sirlar/guvenlik-telegram-grup` (sohbet kimliği); `.env`e `GUVENLIK_TELEGRAM_BOT_TOKEN_DOSYASI_HOST` · `GUVENLIK_TELEGRAM_CHAT_ID_DOSYASI_HOST` (örnekte yorumlu satırları açın). Kanal İSTEĞE BAĞLIDIR: değişkenler/dosyalar yoksa ya da boşsa compose yine açılır (boş `/dev/null` bağlanır), kanal KAPALI ve açılış günlüğü uyarır — mevcut kurulumda güncelleme için hiçbir dosya gerekmez.
5. **Yeniden başlat ve sına:** `docker compose up -d patron` → günlükte `[patron] güvenlik bildirimi: AÇIK` · ilk turda günlük özet gruba düşer.

## 5. DNS (kullanıcı — Cloudflare)

`yonetim` A → `80.253.255.188` ve `patron` A → `80.253.255.188`, ikisi de **proxy AÇIK (turuncu bulut)** — sertifika Origin CA `*.etkiliyazilim.com` (iki adı da kapsar; certresolver yok), ona yalnız CF Edge güvenir; CF kenar sertifikası (Universal SSL `*.etkiliyazilim.com`) da ikisini kapsar. `patron` kaydı KALICIDIR — silinmez, DNS-only'ye çevrilmez (kurulu fabrikaların eşitleme adresi). Kayıt kurulumdan ÖNCE açılırsa `/saglik` 404 döner (Traefik'te yönlendirici yok, zararsız); sonra 200. Önbellek kuralı gerekmez: giriş HTML'i `no-store`, özetli varlıklar `immutable` (CF köken başlığına uyar), API `no-store`. Fabrikanın varsayılan bulut adresi backend 2.15.10'dan itibaren `https://yonetim.etkiliyazilim.com`'dur (`Teks-Erp/src/cloud-sync/cloud-url.ts`, `PATRON_CLOUD_URL`); 2.15.9 ve öncesi kurulumlar `patron.`'a eşitler — takma ad bu yüzden kalıcıdır.

## 6. Doğrulama (sonra)

| Ölçüm | Nereden | Beklenen |
|---|---|---|
| `curl -s https://yonetim.etkiliyazilim.com/saglik` ve `curl -s https://patron.etkiliyazilim.com/saglik` | internet | ikisi de `{"success":true}` |
| `curl -sI https://yonetim.etkiliyazilim.com/` (ve `patron.`) | internet | `200` · `text/html` · `cache-control: no-store` · `content-security-policy` (`unsafe-inline` YOK) · `x-frame-options: DENY` |
| giriş HTML'indeki `/_expo/static/js/web/entry-<özet>.js` | internet | `200` · `cache-control: public, max-age=31536000, immutable` |
| `/cariler/x` (istemci yönlendirmesi) | internet | `200` giriş HTML'i |
| `/api/yok` · `/v1/yok` | internet | `404` JSON `BULUNAMADI` (HTML değil) |
| `/ic/v1/zil` · `/yonetim` | internet | `404` (Traefik; yönlendirici bu yolları almaz) |
| `/v1/esitle` imzasız `POST` | internet | `401`/`400` JSON (fabrika kanalı imza ister) |
| `curl -m 5 http://80.253.255.188:4620/` | internet | zaman aşımı / reddedildi (port yayını yok) |
| Tarayıcıda `https://yonetim.etkiliyazilim.com/` (`tarayici-duman.cjs`) | Mac | giriş ekranı; geliştirici konsolunda CSP ihlali YOK |
| `sudo docker compose ps` | VDS | üçü `healthy`/`Up` |
| `docker inspect tekserp-patron-uretim --format '{{index .Config.Labels "traefik.http.routers.tekserp-patron-uretim.rule"}}'` | VDS | kural `(Host(`yonetim…`) \|\| Host(`patron…`))` ile başlar, `!PathRegexp(…^/(ic\|yonetim)(/\|$)…)` ile biter — tek `$` (compose `$$` kaçışı çözülmüş) |
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
sudo docker network disconnect tekserp-patron-uretim-kenar traefik 2>/dev/null; sudo docker network rm tekserp-patron-uretim-kenar tekserp-patron-uretim-ic tekserp-patron-uretim-cikis
```

`compose down` satıcının `ic-api` ağına DOKUNMAZ (external) — yalnız patronun bağlantısı düşer. DNS kaydı (kullanıcı) · `docker rmi tekserp-patron:<sha> tekserp-patron-yedek:<sha>`. Sonunda `vds-dogrula.sh` → ✅. Fabrikalar etkilenmez: bulut adresine ulaşamayan eşitleme turu sessizce bir sonraki tura kalır (veri fabrikada; bulut okuma kopyasıdır).

**Sürüm yükseltme:** yeni imaj (§2.2 + §4.4) → `exec patron-yedek … tek` (önce yedek) → `.env`'de etiket → `--profile goc run --rm patron-goc` → `sudo docker compose up -d`. Eski imaj bir sürüm boyunca kalır; geri dönüş = eski etiket + (göç geri alınamaz) yedekten geri yükleme. Web sürümü imajla birlikte değişir; özetli varlık adları yeni olduğundan tarayıcı önbelleği temizlik gerektirmez.

## 9. Fabrika tarafı

Bulut adresinin tek okuyucusu `Teks-Erp/src/cloud-sync/cloud-url.ts` (`PATRON_CLOUD_URL`; verilmezse `https://patron.etkiliyazilim.com` — kalıcı takma ad, §5; `kapali` → çıkış yok). Eşitleme yalnız `URETIM` sınıfı + `patron-bulut` hakkıyla gider; bulut da aynı koşulu ikinci kez ölçer (`SINIF_GONDEREMEZ` / `PATRON_BULUT_KAPALI`).

## 10. Satıcı iç API'si ile bağ

Satıcı tarafı `SATICI-KURULUM.md` §5b'dedir: ağ (`IC_API_AGI`), sabit adresler (`IC_API_IP`, `PATRON_IC_IP`), sır. Patron tarafı: `.env`'de aynı üç değer (§2.3) + sır dosyasının kopyası (§4.1). **Sır rotasyonu:** satıcıda yeni sır → `sudo cp` ile patron kopyası → `sudo docker compose up -d --force-recreate patron` (satıcı §5b.6 ile aynı pencerede). Arada patron 401 alır: önbellekteki bayat kayıtla sürer, zil kaçar (fabrika her turda yine yoklar). İç API'yi patron tarafında kapatmak: kopyayı boşalt (`truncate -s 0`) + `.env`'de `KURULUM_KAYNAGI=kayit` + yeniden yarat — kurulum kaydı o zaman CLI'yle (`tesis.js kurulum-kaydet`) tutulur.

## 11. Açık riskler

- **(Tarih — 2026-10-05'ten beri hazırlık satıcısı yok, patron üretim satıcısına bağlı.)** **Hazırlık satıcısı yalnız TEST/DEMO imzalar**, patron eşitlemeyi yalnız `URETIM` sınıfından kabul eder → `SATICI_IC_API_AGI=tekserp-satici-hazirlik-ic-api` ile kurulu patron web/giriş/hesap yönetimi için doğrulanabilir, ama fabrikadan gerçek eşitleme **üretim satıcısı** (ayrı compose, `ORTAM=uretim`) kurulup patron onun ağına bağlanınca akar (ağ adı + iki adres + sır değişir, §10) — geçiş adımları §14.
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


## 13. Kayıt — VDS kurulumu (2026-09-30, `ORTAM=uretim`, hazırlık satıcısına bağlı)

- **Önce/sonra:** her VDS yazımının (dizin+sır · anahtar · imaj · `up --no-start` + ağ bağlantısı · göç · başlatma · satıcı kaydı · tesis/davet · yedek) önünde ve arkasında `vds-dogrula.sh` → ✅ adnansahin AYNI (420 dosya) · kök · defter/nginx/compose AYNI. `asama-dogrula --asama=1,2 --olc` önce ve sonra 7/7 + 12/12 UYUMLU. Traefik, `tekserp-guncelleme`, `docker-socket-proxy` yeniden başlatılmadı (StartedAt/RestartCount değişmedi).
- **§3 ölçüm:** Docker 29.7.2 · compose v5.5.0 · kullanılabilir 2253 MB · disk 54 GB boş · köprüler 172.17–172.20 + satıcı 172.31.252–254 → kenar `172.31.250.0/28` (dinamik `.8/29`) ve çıkış `172.31.250.16/28` çakışmaz; `ic-api` üzerinde yalnız satıcı (`.2`), `PATRON_IC_IP` `.3` boştu.
- **Hazırlık (Mac):** `patron-totp.key` + `patron-vapid.json` (VAPID, `BILDIRIM_KIPI=kapali` olsa da birim salt okunur olduğu için önceden) · yedek alıcısı `patron` (parmak izi `3dd3e2e16139c32a`) · imaj `imaj-derle.sh --platform linux/amd64` (arşiv 321 MB). `.env` = `ornek.env` + iki imaj etiketi; `compose-denetle --satici-env` 40 geçti / 0 ihlal.
- **sudo'suz kurulum:** kök sahipli yazımlar satıcı yedek imajıyla tek seferlik yardımcı konteynerde (`-u 0 --network none`, yalnız hedef yollar bağlı; `-v` eksik host dizinini root 755 yaratır). `sirlar/` 0711 root:61062 (§4.1 notu) · üç parola 64 hex + `ic-api-belirteci` kopyası (satıcınınkiyle bayt-eşit) 0440 root:61062 · `anahtarlar/` 0700 10001 (iki dosya 0600, Mac ile bayt-eşit) · `.env` oguzhan 0600 · `/srv/tekserp-patron-yedek/uretim` 0700 10001.
- **Traefik:** yalnız `docker network connect tekserp-patron-uretim-kenar traefik` (dinamik adres `172.31.250.9`). Traefik compose dosyasına kalıcılık satırı **YAZILMADI** (bu kurulumun kapsamı yalnız bağlantıya izin verdi) → Traefik bir gün yeniden YARATILIRSA patron yönlendiricisi düşer; satır §4.5'teki gibi eklenmeli (açık iş).
- **Traefik kalıcılığı (aynı gün, sonradan):** yukarıdaki açık iş kapandı — `/opt/stack/traefik/docker-compose.yml`e (yedek `docker-compose.yml.yedek-20260930-patron`, `cp -p`) traefik servisinin `networks:` listesine ve kök `networks:` altına `tekserp-patron-uretim-kenar: {external: true}` yardımcı konteynerle yazıldı (satıcı §12 kalıbı); `docker compose config -q` yeşil, ayrıştırılmış ağlar `socketproxy · web · satıcı-kenar · patron-kenar`; Traefik yeniden başlatılmadı/yaratılmadı (`StartedAt` 2026-09-01, `RestartCount` 0; kenar adresi `172.31.250.9` aynı); önce/sonra `vds-dogrula.sh` ✅ AYNI (420), `adnansahin/electron/latest.yml` 200 özet aynı, `patron.etkiliyazilim.com` 200; kurulumun sırsız durum günlükleri (`~/patron-goc.*`, `~/patron-imaj-yukle.*`) sır taramasından (0 isabet) sonra silindi.
- **Göç + roller:** 2 migration (`20260929200000_ilk_sema`, `20260930090000_bildirimler`) · `✅ roller hizalandı`. Açılış: `PATRON_DINLIYOR port=4620 kurulumKaynagi=satici web=acik` · `PATRON_BILDIRIM kip=kapali`.
- **Dış ölçüm (§6):** `/saglik` 200 · `/` 200 `no-store` + CSP (`unsafe-inline` yok) + `x-frame-options: DENY` · `entry-<özet>.js` `immutable` · `/cariler/x` 200 · `/api/yok` · `/v1/yok` 404 JSON · `/ic/v1/zil` · `/ic` · `/yonetim` 404 (Traefik) · `/api/oturum` 401 · imzasız `POST /v1/esitle` 401 `ISTEK_GECERSIZ` · köken `:4620` zaman aşımı · etiket kuralı tek `$`.
- **İç API:** patrondan sıfır UUID 404 `BULUNAMADI`, belirteçsiz 401 `IC_KIMLIK_GECERSIZ`; patronun ic-api adresinde 4620 `ECONNREFUSED`. Hazırlık satıcısında portalla açılan müşteri `Etkili Yazılım (hazırlık)` → tesis `Etkili Yazılım Hazırlık` (`c0f70948-9d5b-45dd-896c-f4ba346ee02b`) → kurulum TEST `patron-hazirlik` (`kurulumId eecfd6b7-3777-40e8-afa6-cbe16acbe7ab`, `ETKINLESMEDI`): patrondan okuma 200 (`v1`, tesis adı doğru, `moduller []`, `saklamaAy 13`).
- **Tesis + ilk yönetici:** `tesis-ac` (satıcının tesis kimliğiyle) + `yonetici-davet` (`hazirlik@etkiliyazilim.com`, 72 saat). Bağlantı `https://patron.etkiliyazilim.com/davet?davet=…` yalnız Mac'te `~/.tekserp/sirlar/patron-davet-hazirlik.txt` (0600); `POST /api/davet/incele` 200.
- **Tarayıcı:** `tarayici-duman.cjs <kök URL, SONUNDA / YOK>` → stilli giriş ekranı, uygulamanın kendi CSP ihlali 0; tek ihlal Cloudflare'in HTML'e enjekte ettiği Web Analytics beacon'ı (`static.cloudflareinsights.com`, `script-src 'self'` engelliyor) — bölge ayarıdır, kapatmak kullanıcı kararı. URL `/` ile biterse araç `//` açar ve uygulama `Failed to construct 'URL'` (expo-router `parseQueryParams`) ile çizilmez.
- **Yedek:** açılışta otomatik ilk tur + elle `tek` → `patron_20260930_011717.dump.tkenc` + `anahtarlar_…011717.tar.tkenc`; iki uç sha eşit, Mac'te özel yarıyla açıldı: `pg_restore --list` 20 tablo verisi, anahtar arşivi Mac ile bayt-eşit.
- **Kaynak (VDS, boşta):** patron 96 / 512 MiB (12 süreç) · DB 36 / 384 · yedek 3 / 128; kullanılabilir bellek 2118 MB.

### 13a. Sürüm yükseltme — `55203d9708ba` → `dd54c2526ecc` (2026-09-30, §8 kalıbı)

- **Kapsam:** B5 bildirim makbuzu · F1 liste araması + `//` → 301 + davet karekodu · B6 `POST /v1/hesap-kilitle` · tesis saat dilimi dönem alanları; tek göç `20260930150000_bildirim_makbuz` (yalnız ekler: `notifications.receipt_due_at` + indeks). `docker-compose.yml`, `ornek.env`, `Dockerfile`, `yedek-dongusu.sh`, `patron-baslat.sh` değişmedi (VDS'teki compose repoyla bayt-eşit) → sunucuda değişen yalnız `.env`'deki iki imaj etiketi. Satıcıya dokunulmadı.
- **Önce/sonra:** her VDS yazımının (imaj yükleme · göç · `.env` · `up -d`) önünde ve arkasında `vds-dogrula.sh` → ✅ adnansahin AYNI (420) · kök · defter/nginx/compose AYNI. Traefik, `tekserp-guncelleme`, `docker-socket-proxy` yeniden başlamadı (`StartedAt`/`RestartCount` aynı); Traefik'in patron kenar adresi `172.31.250.9` aynı.
- **Önce yedek:** `exec -T patron-yedek /arac/yedek-dongusu.sh tek` → `patron_20260930_100714.dump.tkenc` + `anahtarlar_…100714.tar.tkenc`; iki uç sha eşit, Mac'te özel yarıyla açıldı (`pg_restore --list` 20 tablo verisi; anahtar arşivi bayt-eşit). Geri dönüşün DB yarısı budur.
- **İmaj:** temiz ağaçtan `imaj-derle.sh --platform linux/amd64` (arşiv 320 MB) → scp → `sha256sum -c` + `docker load`; iki uçta imaj kimliği aynı (`sha256:03d0e4c172fa…` · yedek `sha256:3299f544b5fd…`). Eski `55203d9708ba` imajları VDS'te duruyor.
- **Göç `.env`'e dokunmadan:** `PATRON_IMAJ=tekserp-patron:dd54c2526ecc docker compose --profile goc run --rm --no-deps patron-goc` (kabuk değişkeni `.env`'i ezer; göç başarısız olsaydı `.env` eski kalırdı) → `Applying migration 20260930150000_bildirim_makbuz` · `All migrations have been successfully applied` · `✅ roller hizalandı`. Eski sunucu göç sonrası yeni kolonla sağlıklı kaldı (yalnız ekleyen göç).
- **Başlatma:** `.env` yerinde yeniden yazıldı (`cp -p` yedeği `~/p1-env-yedek-55203d9708ba`; fark yalnız iki etiket satırı; sahip/mod/inode aynı) → `docker compose up -d`: DB dokunulmadı, `patron` + `patron-yedek` yeniden yaratıldı; `PATRON_DINLIYOR port=4620 kurulumKaynagi=satici web=acik`, günlükte hata 0.
- **Dış ölçüm:** `/saglik` 200 · `/` 200 `no-store` + CSP (`unsafe-inline` yok) + `DENY` · yeni `entry-<özet>.js` `immutable` · `/api/yok` · `/v1/yok` 404 JSON · `/ic` · `/ic/v1/zil` · `/yonetim` 404 · `/api/oturum` 401 · imzasız `POST /v1/esitle` 401 · imzasız `POST /v1/hesap-kilitle` 401 `ISTEK_GECERSIZ` (önce 404 — uç yoktu) · köken `:4620` zaman aşımı · `adnansahin/electron/latest.yml` 200 özet aynı. Tarayıcı dumanı: CSP ihlali 0, konsol hatası 0 (CF beacon beyanlı istisna 2), giriş formu çizildi.
- **İç API:** patrondan hazırlık kurulumu (`eecfd6b7…`) 200 (tesis `c0f70948…` `Etkili Yazılım Hazırlık`, `ETKINLESMEDI`, `TEST`, `saklamaAy 13`) · sıfır UUID 404 · belirteçsiz 401 · patronun ic-api adresinde 4620 `ECONNREFUSED`.
- ⚠️ **Bulgu — `//` → 301 üretimde ETKİSİZ:** köken doğrudan (kenar adresi, 4620) `//` → 301 `/`, `/cariler//x?a=1` → 301 `/cariler/x?a=1` (uygulama doğru); ama Cloudflare üzerinden de, CF'siz doğrudan Traefik'e de `//` → 200. Traefik v3.5 `sanitizePath` (varsayılan açık; `traefik.yml`de ayar yok) yolu `/`e katlayıp iletiyor → istek uygulamaya tek eğik çizgiyle ulaşır, 301 hiç üretilmez; tarayıcı adres çubuğunda `//` kalır ve sayfa hâlâ `Failed to construct 'URL': Invalid URL` ile boş çizilir (gerçek Chromium ölçümü). Traefik ayarı ortak kenardır (adnansahin güncelleme sitesi de arkasında) → çare istemci tarafında aranmalı; Traefik'e dokunulmadı. **Kapandı → §13b** (istemci katlaması üretimde ölçüldü).
- **Kaynak (VDS, boşta):** patron 95 / 512 MiB (12 süreç) · DB 31 / 384 · yedek 1 / 128; kullanılabilir bellek 2112 MB; disk 53 GB boş.
- **Geri alma:** `.env`'e `~/p1-env-yedek-55203d9708ba` geri yazılır + `docker compose up -d` (eski imaj yerinde); göç geri alınamaz ama yalnız ekleyen bir kolon olduğundan eski sürüm onunla çalışır (ölçüldü); veri gerekirse `patron_20260930_100714` yedeğinden (§7).

### 13b. Sürüm yükseltme — `dd54c2526ecc` → `f446424bbedf` (2026-09-30, §8 kalıbı, göçsüz)

- **Kapsam:** yalnız web girişi — `patron/uygulama/entry.ts` + `src/web-path-fix.ts`: adres çubuğundaki fazla eğik çizgi yönlendiriciden ÖNCE `history.replaceState` ile katlanır (§13a bulgusunun çaresi). Sunucu kodu, Prisma şeması, `docker-compose.yml`, `ornek.env`, `Dockerfile`, yedek betikleri değişmedi → sunucuda değişen yalnız `.env`'deki iki imaj etiketi. Satıcıya dokunulmadı.
- **Önce/sonra:** her VDS yazımının (yedek · imaj aktarımı · `docker load` · `.env` · `up -d` · geçici dosya temizliği) önünde ve arkasında `vds-dogrula.sh` → ✅ adnansahin AYNI (420) · kök · defter/nginx/compose AYNI. Traefik, `tekserp-guncelleme`, `docker-socket-proxy` yeniden başlamadı (`StartedAt`/`RestartCount` aynı); Traefik'in patron kenar adresi `172.31.250.9` aynı; `adnansahin/electron/latest.yml` 200, özet önce/sonra aynı.
- **Önce yedek:** son yedek 1 sa 40 dk önceydi (24 sa içinde) ama kural gereği taze: `exec -T patron-yedek /arac/yedek-dongusu.sh tek` → `patron_20260930_114720.dump.tkenc` + `anahtarlar_…114720.tar.tkenc`; iki uç sha eşit, Mac'te özel yarıyla açıldı (`pg_restore --list` 20 tablo verisi; anahtar arşivindeki iki dosya Mac ile bayt-eşit); düz kopyalar güvenli silindi.
- **İmaj:** temiz ağaçtan `imaj-derle.sh --platform linux/amd64` (arşiv 325 MB) → scp → `sha256sum -c` + `docker load`; iki uçta imaj kimliği aynı (`sha256:60b718c2dabb…` · yedek `sha256:9e60fceae3a9…`). İmajdaki web paketi katlamayı taşıyor (yeni `entry-<özet>.js`); göç dizini `dd54c2526ecc` ile aynı üç migration.
- **Göç YOK:** DB'deki `_prisma_migrations` üç satır (`ilk_sema` · `bildirimler` · `bildirim_makbuz`, hepsi bitmiş/geri alınmamış) = imajdaki üç → `patron-goc` koşturulmadı.
- **Başlatma:** `.env` yerinde yeniden yazıldı (`cp -p` yedeği `~/p5-env-yedek-dd54c2526ecc`; fark yalnız iki etiket satırı; sahip/mod/inode aynı) → `docker compose up -d` (yalnız bu proje): DB dokunulmadı, `patron` + `patron-yedek` yeniden yaratıldı; `PATRON_DINLIYOR port=4620 kurulumKaynagi=satici web=acik`, günlükte hata 0; etiket kuralı tek `$`, salt okunur kök, `capDrop ALL`, 512 MiB, uid 10001, port yayını yok.
- **Dış ölçüm:** `/saglik` 200 · `/` 200 `no-store` + CSP (`unsafe-inline` yok) + `DENY` · yeni `entry-<özet>.js` `immutable` · `/cariler/x` 200 · `/api/yok` · `/v1/yok` 404 JSON · `/ic` · `/ic/v1/zil` · `/yonetim` 404 · `/api/oturum` 401 · imzasız `POST /v1/esitle` ve `POST /v1/hesap-kilitle` 401 `ISTEK_GECERSIZ` · köken `:4620` zaman aşımı.
- **Tarayıcı dumanı — ÜRETİMDE** (`tarayici-duman.cjs https://patron.etkiliyazilim.com`, öz sınama 11/11, çıkış 0): kök CSP ihlali 0 · konsol hatası 0 (CF beacon beyanlı istisna 2) · girdi 2; **`//` → son adres `/giris`, sayfa hatası 0, girdi 2** (yükseltmeden ÖNCE aynı araç: son adres `//`, `Failed to construct 'URL': Invalid URL`, girdi 0, çıkış 1) · `//cariler//x` → `/giris`, hata 0, girdi 2. Bağımsız denetim (ayrı Chromium betiği): `//` 200, yönlendirme 0, son adres `/giris`, sayfa hatası 0 ⇒ §13a bulgusu kapandı. Köken doğrudan (kenar adresi, 4620) `//` → 301 `/` sürüyor; üretimde Traefik `sanitizePath` katladığı için katlamayı istemci yapar.
- **İç API:** patrondan hazırlık kurulumu (`eecfd6b7…`) 200 (tesis `c0f70948…` `Etkili Yazılım Hazırlık`, `ETKINLESMEDI`, `TEST`, `saklamaAy 13`) · sıfır UUID 404 · belirteçsiz 401 · patronun ic-api adresinde 4620 `ECONNREFUSED`.
- **Kaynak (VDS, boşta):** patron 79 / 512 MiB (12 süreç) · DB 31 / 384 · yedek 1 / 128; kullanılabilir bellek 2133 MB; disk 53 GB boş. VDS'te üç imaj çifti duruyor (`f446424bbedf` · `dd54c2526ecc` geri alma · `55203d9708ba` iki sürüm eski — kaldırmak ayrı karar).
- **Geri alma:** `.env`'e `~/p5-env-yedek-dd54c2526ecc` geri yazılır + `docker compose up -d` (eski imaj yerinde; şema aynı, göç yok); veri gerekirse `patron_20260930_114720` yedeğinden (§7).

### 13c. Sürüm yükseltme — `a30833e666b6` → `83f837666826` (2026-10-15 14:06–14:07Z, §8 kalıbı, tek kimlik / çok tesis)

- **Kapsam:** tek kimlik çok tesis (`identities` merkezde; `login_routes` üyelik; `GET /api/oturum/tesisler` · `POST /api/oturum/gecis`), davet bağlantısı, ortak kimlik sıfırlama seddi, kimlik silme, çok tesisli cihaz; B3 güvenlik bildirimi (isteğe bağlı) · B6 sır dosyası izni fail-closed. Göç `20261015120000_tek_kimlik` (fail-closed: etkin hesap ya da giriş satırı varsa durur). `docker-compose.yml` DEĞİŞTİ (sunucuya iki isteğe bağlı `guvenlik_telegram_*` sırrı, yoksa `/dev/null`; eski compose yeni `patron-baslat` rol tablosuyla compose-denetle ⑩'u geçmezdi) → yeni compose + `.env`'de iki imaj etiketi. Yeni ZORUNLU değişken/sır YOK (`.env` anahtarları `ornek.env` ile aynı; güvenlik Telegram satırları yorumlu). Satıcıya dokunulmadı.
- **Önce ölçüm (salt okuma):** çalışan `a30833e666b6` (4 servis sağlıklı) · merkez 8 göç, yarım 0 · merkez `accounts` 0 · `login_routes` 0 · `sessions` 0 · `facilities` 0 · `facility_databases` 1 (`HAZIR`). **Yeni bilgi:** 2026-10-15 09:54Z'de imzalı fabrika isteğiyle doğmuş tesis `8716286a…` ("Merkez", DB `patron_t8716286a6afc4c86`): 8 göç, `accounts` 0, `login_routes` 0, `installations` 1, `projection_rows` 12, canlı eşitleme (`/v1/esitle` · `/v1/rapor/al` 200) → göç kapısı her iki DB'de geçer. B6: `sirlar/*` 0440 root:61062, `anahtarlar/*` 0600 10001 (diğerlerine kapalı). Bellek kullanılabilir 1792 MB · disk 45 GB boş.
- **Önce/sonra:** her VDS yazımının (imaj yükleme · yedek · compose/.env yedeği + yeni compose · durdurma + göç · `.env` + `up -d`) önünde ve arkasında `vds-dogrula.sh` → ✅ adnansahin AYNI (420) · kök · defter/nginx/compose AYNI (göç ile `.env` yazımı arasındaki ara ölçüm atlandı; ardından ✅). Traefik, `tekserp-guncelleme`, `docker-socket-proxy`, `tekserp-satici-uretim` yeniden başlamadı (`StartedAt`/`RestartCount` aynı); `adnansahin/electron/latest.yml` 200.
- **İmaj:** geçici worktree'den (`83f837666`, temiz) `imaj-derle.sh --platform linux/amd64` (arşiv 320 MB, sha `428d045f…`) → scp → `sha256sum -c` + `docker load`; iki uçta imaj kimliği aynı (`sha256:968d80ea…` · yedek `sha256:5c1c8702…`). Eski `a30833e666b6` imajları VDS'te duruyor.
- **Yerel duman (§2.5):** `duman.sh kur 83f837666826` → 9 göç + `✅ roller` + `PATRON_TESIS_GOC tesis=0 hata=0`, HTTP ölçümleri yeşil, yedek merkez + tesis dökümü açıldı (26 tablo verisi), hazırlayıcı 47/96 MiB `0 running`; uygulama dumanı 13/13 (worktree'de `node_modules` olmadığından elle, ana ağacın aynı commit'teki araçlarıyla) · Chromium dumanı CSP 0 · konsol 0. `compose-denetle --env-file <yeni .env> --satici-env <üretim satıcısının VDS .env'i>` → 50 geçti, 0 ihlal.
- **Önce yedek:** `exec -T patron-yedek /arac/yedek-dongusu.sh tek` → `patron_20261015_140339.dump.tkenc` + `anahtarlar_20261015_140339.tar.tkenc` + `tesis_8716286a-6afc-4c86-af01-4f595d789f54_20261015_140339.dump.tkenc`; üçünde iki uç sha eşit (`10906902…` · `ad30df93…` · `55dddc5b…`), Mac'te özel yarıyla açıldı: merkez ve tesis dökümü `pg_restore --list` 25 tablo verisi; anahtar arşivi (`patron-totp.key` · `patron-vapid.json`) Mac ile bayt-eşit; düz kopyalar güvenli silindi.
- **Dosyalar:** `.env` `cp -p` → `~/p6-env-yedek-a30833e666b6`; compose yedeği `docker-compose.yml.yedek-20261015_1706-a30833e666b6`; yeni compose ağsız yardımcı konteynerle (`--user 0`) yazıldı, repoyla bayt-eşit (`d378bb12…`), `config -q` eski `.env`'le yeşil.
- **Göç:** `docker compose stop patron patron-hazirla` (eski sunucu kiracı tablolarında düşen kolonlarla çalışamaz) → `.env`'e dokunmadan `PATRON_IMAJ=… PATRON_YEDEK_IMAJ=… docker compose --profile goc run --rm --no-deps patron-goc` → `Applying migration 20261015120000_tek_kimlik` · `All migrations have been successfully applied` · `✅ roller hizalandı` · `✅ 8716286a… patron_t8716286a6afc4c86: 1 göç uygulandı · şema 20261015120000_tek_kimlik` · `PATRON_TESIS_GOC tesis=1 hata=0` (10 sn). Göç günlüğü sır taramasından (0 isabet) sonra silindi.
- **Başlatma:** `.env` yerinde yeniden yazıldı (fark yalnız iki etiket satırı; sahip/mod/inode aynı) → `docker compose up -d`: DB dokunulmadı; `patron` · `patron-hazirla` · `patron-yedek` yeni imajla. Kesinti (durdurma → sağlıklı) ~40 sn; fabrika eşitlemesi 14:10Z'de yeniden 200. Günlük: `PATRON_DINLIYOR port=4620 kurulumKaynagi=satici web=acik` · `PATRON_BILDIRIM kip=kapali` · `güvenlik bildirimi: KAPALI` (Telegram dosyaları verilmedi — §4b, kullanıcı işi) · `PATRON_HAZIRLA izliyor aralik=10s`; dört konteyner `RestartCount` 0.
- **Sonra ölçüm (DB):** merkez ve tesis DB'si 9 göç, yarım 0, son `tek_kimlik` · `facility_databases` `HAZIR/20261015120000_tek_kimlik` · `identities` 0 · `login_routes` 0 · `patron_uygulama` yetkisi `accounts` f · `login_routes` t · `identities` t · tesis `accounts` 0, `projection_rows` 12.
- **Dış ölçüm (§6):** `/saglik` 200 · `/` 200 `no-store` + CSP (`unsafe-inline` yok) + `DENY` · yeni `entry-b329011e….js` `immutable` · `/cariler/x` 200 · `/api/yok` · `/v1/yok` 404 JSON `BULUNAMADI` · `/ic` · `/ic/v1/zil` · `/yonetim` 404 · `/api/oturum` 401 · imzasız `POST /v1/esitle` 401 `ISTEK_GECERSIZ` · imzasız `POST /v1/hesap-kilitle` 401 · **yeni:** oturumsuz `GET /api/oturum/tesisler` 401 `OTURUM_YOK` · oturumsuz `POST /api/oturum/gecis` 401 `OTURUM_YOK` · köken `:4620` zaman aşımı · köken doğrudan 443 403. Etiket kuralı tek `$`; yönlendirici `[-cf, -hiz] enabled`; Traefik ERR/WRN yok.
- **İç API:** patrondan sıfır UUID 404 · belirteçsiz 401 · patronun ic-api adresinde 4620 `ECONNREFUSED`.
- **Tarayıcı dumanı — ÜRETİMDE** (`tarayici-duman.cjs https://patron.etkiliyazilim.com`, çıkış 0): CSP ihlali 0 · konsol hatası 0 (CF beacon beyanlı istisna 2) · giriş formu çizildi · `//` ve `//cariler//x` → `/giris`, sayfa hatası 0.
- **Kaynak (VDS, boşta):** patron 108 / 512 MiB (12 süreç) · DB 48 / 384 · hazırlayıcı 19 / 96 · yedek 1 / 128; kullanılabilir bellek 1809 MB; disk 44 GB boş.
- **Geri alma:** göç GERİ ALINAMAZ ve eski sürüm yeni şemayla ÇALIŞMAZ (`accounts` sır kolonları düştü, `login_routes.email_digest` yok) → geri dönüş = `docker compose stop patron patron-hazirla` + `patron_20261015_140339` ve `tesis_8716286a…_20261015_140339` yedeklerinden geri yükleme (§7, kullanıcı kararı) + `cat ~/p6-env-yedek-a30833e666b6 > .env` + eski compose (`…yedek-20261015_1706-a30833e666b6`) + eski imajla `patron-goc` + `up -d`. Hesap 0 olduğundan ileri düzeltme (yeni imaj) tercih edilir.

### 13d. Sürüm yükseltme — `83f837666826` → `8fc40a01c14c` (2026-10-15 18:04Z, §8 kalıbı, göçsüz)

- **Kapsam:** `POST /api/oturum/hesap-sil` (kendini silme: parola + TOTP; bütün bağlı üyelikler ve kimliğe bağlı bekleyen davetler kapanır, kimlik PASİF) · yönetici arşivi hesabın cihazlarını pasife çeker. `deploy/patron/` ve `patron/sunucu/prisma` farkı YOK → göç yok, compose aynı (VDS'teki repoyla bayt-eşit `d378bb12…`); sunucuda değişen yalnız `.env`'deki iki imaj etiketi. Satıcıya dokunulmadı.
- **Önce ölçüm (salt okuma):** çalışan `83f837666826` (4 servis sağlıklı, `RestartCount` 0) · merkez ve tesis DB'si 9 göç, yarım 0 · `facility_databases` `HAZIR/20261015120000_tek_kimlik` · `identities` 0 · `login_routes` 0 · test-müşteri tesisi `8716286a…` (`patron_t8716286a6afc4c86`): `accounts` 0 (yönetici dahil hiç hesap yok), `sessions` 0, `installations` 1, `projection_rows` 13; fabrika eşitlemesi ~5 dk'da bir `/v1/esitle` · `/v1/rapor/al` 200. Bellek kullanılabilir 1781 MB · disk 45 GB boş.
- **Önce/sonra:** her VDS yazımının (imaj yükleme · yedek · `.env` + `up -d` · eski imaj silme) önünde ve arkasında `vds-dogrula.sh` → ✅ adnansahin AYNI (420) · kök · defter/nginx/compose AYNI. Traefik, `tekserp-guncelleme`, `docker-socket-proxy`, `tekserp-satici-uretim` yeniden başlamadı (`StartedAt`/`RestartCount` aynı); `adnansahin/electron/latest.yml` 200.
- **İmaj:** geçici worktree'den (`8fc40a01c`, temiz; `Teks-Erp/node_modules` ana ağaca bağ) `imaj-derle.sh --platform linux/amd64` (arşiv 321 MB, sha `f39537d6…`) → scp → `sha256sum -c` + `docker load`; iki uçta imaj kimliği aynı (`sha256:674a64eb…` · yedek `sha256:bcc46778…`).
- **Yerel duman (§2.5):** `duman.sh kur 8fc40a01c14c` → 9 göç + `✅ roller` + `PATRON_TESIS_GOC tesis=0 hata=0`, HTTP ölçümleri yeşil, Chromium CSP 0 · konsol 0, yedek merkez + tesis dökümü açıldı (26 tablo verisi), hazırlayıcı `0 running`; uygulama dumanı 13/13 (elle, `Teks-Erp/node_modules/.bin/tsx` ile); oturumsuz `POST /api/oturum/hesap-sil` 401 `OTURUM_YOK`; `duman.sh kaldir`.
- **Önce yedek:** `exec -T patron-yedek /arac/yedek-dongusu.sh tek` → `patron_20261015_180240.dump.tkenc` + `anahtarlar_20261015_180240.tar.tkenc` + `tesis_8716286a-6afc-4c86-af01-4f595d789f54_20261015_180240.dump.tkenc`; üçünde iki uç sha eşit (`1b780fd6…` · `12d6323e…` · `068d62de…`), Mac'te özel yarıyla açıldı: merkez ve tesis dökümü `pg_restore --list` 26 tablo verisi; anahtar arşivi (`patron-totp.key` · `patron-vapid.json`) Mac ile bayt-eşit; düz kopyalar silindi (`rm -P`).
- **Göç YOK:** imajdaki `prisma/migrations` 9 = DB'deki 9 (son `20261015120000_tek_kimlik`) → `patron-goc` koşturulmadı.
- **Başlatma:** `.env` `cp -p` → `~/p7-env-yedek-83f837666826`; yerinde yeniden yazıldı (fark yalnız iki etiket satırı; sahip/mod/inode aynı), `config -q` yeşil → `docker compose up -d`: DB dokunulmadı; `patron` · `patron-hazirla` · `patron-yedek` yeni imajla. Kesinti (komut → sağlıklı) ~18 sn; fabrika eşitlemesi 18:06:43Z'de yeniden 200. Günlük: `PATRON_DINLIYOR port=4620 kurulumKaynagi=satici web=acik` · `PATRON_BILDIRIM kip=kapali` · `güvenlik bildirimi: KAPALI` · `bakım: 96 satır budandı (saklama + telemetri)` · `PATRON_HAZIRLA izliyor aralik=10s`; hata 0; dört konteyner `RestartCount` 0.
- **Sonra ölçüm (DB):** merkez ve tesis DB'si 9 göç, yarım 0 · `facility_databases` `HAZIR/20261015120000_tek_kimlik`. Konteyner: etiket kuralı tek `$`, salt okunur kök, `capDrop ALL`, 512 MiB, uid 10001, port yayını yok.
- **Dış ölçüm (§6):** `/saglik` 200 · `/` 200 `no-store` + CSP (`unsafe-inline` yok) + `DENY` · yeni `entry-3331df7f….js` `immutable` · `/cariler/x` 200 · `/api/yok` · `/v1/yok` 404 JSON `BULUNAMADI` · `/ic` · `/ic/v1/zil` · `/yonetim` 404 · `/api/oturum` 401 · imzasız `POST /v1/esitle` ve `POST /v1/hesap-kilitle` 401 `ISTEK_GECERSIZ` · oturumsuz `GET /api/oturum/tesisler` · `POST /api/oturum/gecis` 401 `OTURUM_YOK` · **yeni:** oturumsuz `POST /api/oturum/hesap-sil` 401 `OTURUM_YOK` · köken `:4620` zaman aşımı · köken doğrudan 443 403. Traefik'te tek WRN: göç listesini okuyan geçici `docker run --rm` konteynerinin kaybolması (zararsız).
- **İç API:** patrondan sıfır UUID 404 · belirteçsiz 401 · patronun ic-api adresinde 4620 `ECONNREFUSED`.
- **Tarayıcı dumanı — ÜRETİMDE** (`tarayici-duman.cjs https://patron.etkiliyazilim.com`, çıkış 0): CSP ihlali 0 · konsol hatası 0 (CF beacon beyanlı istisna 2) · giriş formu çizildi · `//` ve `//cariler//x` → `/giris`, sayfa hatası 0.
- **Kaynak (VDS, boşta):** patron 100 / 512 MiB (12 süreç) · DB 48 / 384 · hazırlayıcı 25 / 96 · yedek 1 / 128; kullanılabilir bellek 1808 MB; disk 45 GB boş.
- **İmaj temizliği:** en eski `a30833e666b6` çifti silindi (önce/sonra `vds-dogrula` ✅); VDS'te kalan `8fc40a01c14c` + `83f837666826` (geri alma).
- **Geri alma:** göç yok, şema aynı → `cat ~/p7-env-yedek-83f837666826 > .env` + `docker compose up -d` (eski imaj yerinde); veri gerekirse `patron_20261015_180240` ve `tesis_8716286a…_20261015_180240` yedeklerinden (§7).

### 13e. Sürüm yükseltme — `e847c7a55f3e` → `5156f26d2259` (2026-10-26 17:07–17:12Z, §8 + §17.6 kalıbı, v2 / 0.2.0, 1 göç)

- **Kapsam:** patron sunucusu 0.2.0 (`docs/surumler/patron-sunucu-0.2.0.md`): değişim sayacı + uzun yoklama (`GET /api/degisim`), liste kimlik süzgeçleri/sipariş araması, v2 web ekranları (ikon fontu CSSOM, #100), R1-BULUT rapor sunumları, MAL-8 teklif/standart-maliyet projeksiyonları + iki izin kodu (kodda), N5 telefon push hazırlığı (bayrak KAPALI). Kaynak `origin/main` @ `5156f26d2` (#235). `git diff e847c7a55 5156f26d2 -- deploy/patron patron/sunucu/prisma`: compose ve Dockerfile AYNI (VDS compose `b972070a…` = repo), `ornek.env` tek yorum satırı, **1 göç** `20261022120000_degisim_sayaci`. Yeni zorunlu değişken yok; `.env`'de yalnız iki etiket. Satıcıya (`db021d06a0df`, bugün Y0) ve güncelleme sitesine dokunulmadı. Kullanıcının "uygula" cümlesi 12:40 (Y3: "Patron v2 VDS + Play").
- **Önce ölçüm (salt okuma, 17:02Z):** çalışan `e847c7a55f3e` (patron · hazirla · yedek `StartedAt` 2026-10-15T22:33:57Z, `RestartCount` 0; DB 09-30'dan beri) · merkez ve tesis DB'si (`patron_t8716286a6afc4c86`) 9 göç, yarım 0 · `facility_databases` 1 satır `HAZIR/20261015120000_tek_kimlik` · tesis `installations` 1 · `accounts` 2 · `sessions` 11 · `projection_rows` 6223 · `sync_state.last_package_at` 17:01:21Z, `app_version` **2.15.12** (fabrika yeni projeksiyonları göndermez — etkisiz). Bellek kullanılabilir 1728 MB · disk 44 GB boş. `docker` sudo'suz (oguzhan `docker` grubunda); compose değişmediği için root dosyası yazımı gerekmedi.
- **İmaj (Mac):** temiz worktree `chore/patron-yayin-1026` (origin/main @ `5156f26d2`; `docs/` değişikliği imaj kaynağı değil, sha main'de kalıcı olsun diye belge commit'i SONRA) `imaj-derle.sh --platform linux/amd64` → arşiv 325 295 612 bayt, sha256 `dcd92cfd3b29…` (`shasum -c` OK) → scp → VDS'te `sha256sum -c` OK + `docker load`; iki uçta imaj kimliği aynı (`sha256:a03917e1…` · yedek `sha256:37625313…`, amd64). İmajdaki göç 10.
- **compose-denetle (Mac):** `--env-file <üretim .env kopyası> --satici-env <üretim satıcısı .env kopyası>` → **51 geçti, 0 ihlal**; satıcı kopyası ölçümden sonra `rm -P`.
- **Yerel duman (§2.5, `duman.sh kur 5156f26d2259`, amd64 öykünme):** 10 göç · `✅ roller hizalandı` · `PATRON_TESIS_GOC tesis=0 hata=0` · `/` 200 `no-store` + CSP · `entry-ee2f64c8….js` `immutable` · `/api/yok` · `/v1/yok` · `/ic/v1/zil` · `/yonetim` 404 · `/api/oturum` 401 · oturumsuz `GET /api/degisim?since=0&bekle=0` 401 `OTURUM_YOK` · uygulama dumanı **13/13** · Chromium CSP 0 · konsol 0 · yedek `tek`: merkez + tesis dökümü 26 tablo verisi · hazırlayıcı `0 running` · patron 185 / 512 MiB. `duman.sh sifirla`.
- **Önce/sonra:** her VDS yazımının (yedek · imaj yükleme · `.env` + göç + `up -d` · eski imaj silme) önünde ve arkasında `vds-dogrula.sh` → ✅ adnansahin AYNI (420) · kök · defter/nginx/compose AYNI · satıcı yedeği taze (`20261026_162931`). Traefik, `tekserp-guncelleme`, `docker-socket-proxy`, `tekserp-satici-uretim*` yeniden başlamadı (`StartedAt` önce/sonra aynı; `tekserp-satici-uretim-bildirim` `RestartCount` 4, `StartedAt` 16:30:46Z — Y0 penceresinden, bu yükseltmeden önce).
- **Önce yedek (17:07:58Z):** `exec -T patron-yedek /arac/yedek-dongusu.sh tek` → `patron_20261026_170758.dump.tkenc` (`74d3cf5b…`) + `anahtarlar_20261026_170758.tar.tkenc` (`a97d13cd…`) + `tesis_8716286a-6afc-4c86-af01-4f595d789f54_20261026_170758.dump.tkenc` (`d8e10e6e…`); üçünde iki uç sha eşit, Mac'te özel yarıyla açıldı: merkez ve tesis dökümü `pg_restore --list` 26 tablo verisi; anahtar arşivi `patron-totp.key` + `patron-vapid.json`; düz kopyalar `rm -P`.
- **`.env`:** `cp -p` → `~/p9-env-yedek-e847c7a55f3e`; yerinde yeniden yazıldı (fark yalnız iki etiket satırı; inode/sahip/mod aynı `1062275 oguzhan 600`) → `config -q` yeşil. Compose dosyasına dokunulmadı.
- **Göç (eski sunucu çalışırken):** `docker compose --profile goc run --rm --no-deps patron-goc` → `Applying migration 20261022120000_degisim_sayaci` · `All migrations have been successfully applied` · `✅ roller hizalandı` · tesis `8716286a…`: `1 göç uygulandı · şema 20261022120000_degisim_sayaci` · `PATRON_TESIS_GOC tesis=1 hata=0`; çıkış 0; günlük sır taramasından (0 isabet) sonra silindi.
- **Başlatma:** `docker compose up -d` 17:11:49Z → `patron` sağlıklı 17:12:07Z: kesinti **~18 sn**; DB dokunulmadı; `patron` · `patron-hazirla` · `patron-yedek` yeni imajla, `RestartCount` 0. Günlük: `PATRON_DINLIYOR port=4620 kurulumKaynagi=satici web=acik` · `PATRON_BILDIRIM kip=kapali` · `güvenlik bildirimi: KAPALI` · `bakım: 977 satır budandı`; hata 0.
- **Sonra ölçüm (DB):** merkez ve tesis DB'si **10 göç**, yarım 0 · `facility_databases` `HAZIR/20261022120000_degisim_sayaci` · `sync_state.change_counter` 0 · `changed_projections` `[]` (DEFAULT'larla doğdu). Konteyner: etiket kuralı tek `$`, salt okunur kök, `capDrop ALL`, 512 MiB, uid 10001, port yayını yok.
- **Dış ölçüm (§6, iki adda AYNI):** `/saglik` 200 `{"success":true}` · `/` 200 `no-store` + CSP (`unsafe-inline` yok) + `DENY` · `entry-ee2f64c8….js` 200 `immutable` · `/cariler/x` 200 · `/api/yok` 404 JSON `BULUNAMADI` · `/v1/yok` · `/ic` · `/ic/v1/zil` · `/yonetim` 404 · `/api/oturum` 401 · **yeni:** oturumsuz `GET /api/degisim?since=0&bekle=0` 401 `OTURUM_YOK` · imzasız `POST /v1/esitle` 401 `ISTEK_GECERSIZ` · köken `:4620` zaman aşımı · köken doğrudan 443 (`--resolve`) 403.
- **İç API:** patrondan sıfır UUID belirteçli 404 · belirteçsiz 401 · patronun ic-api adresinde 4620 `ECONNREFUSED`.
- **Tarayıcı dumanı — ÜRETİMDE** (`tarayici-duman.cjs`, iki ad, çıkış 0): durum 200 · CSP ihlali 0 · konsol hatası 0 (CF beacon beyanlı istisna 2) · giriş formu "TeksERP Yönetim · E-posta · Parola · Devam · Davet kodum var" · ekran görüntüsünde logo ve buton ikonları ÇİZİLİ (#100 doğrulandı) · `//` ve `//cariler//x` → `/giris`, sayfa hatası 0.
- **Fabrika kanalı:** test-müşteri kurulumu (fabrika **2.15.12**) yükseltmeden sonra eşitledi: `POST /v1/esitle` 200 ×2 · `/v1/rapor/al` 200 ×2 (17:12Z sonrası; dört 401 bizim imzasız ölçüm isteğimiz) · tesis DB `sync_state.last_package_at` 17:11:26Z → **17:21:31Z**; `change_counter` 0 kaldı (paket yeni/değişmiş satır taşımadı — sayaç yalnız veri KABUL edildiğinde artar; 2.15.12 yeni projeksiyon göndermez). Günlükte hata 0.
- **Kaynak (VDS, boşta):** patron 104 / 512 MiB · DB 64 / 384 · hazırlayıcı 25 / 96 · yedek 1 / 128; kullanılabilir bellek 1765 MB; disk 44 GB boş.
- **İmaj temizliği:** en eski `83f837666826` çifti silindi (önce/sonra `vds-dogrula` ✅); VDS'te kalan `5156f26d2259` (çalışan) + `e847c7a55f3e` (geri alma) + `8fc40a01c14c` (sonraki yükseltmede silinir).
- **Geri alma:** göç geri alınmaz (iki DEFAULT'lu kolon; eski sunucu okumaz) → `cat ~/p9-env-yedek-e847c7a55f3e > .env` + `docker compose up -d` (eski imaj yerinde; compose aynı). Veri gerekirse `patron_20261026_170758` ve `tesis_8716286a…_20261026_170758` yedeklerinden (§7). v2 istemci eski bulutta `/api/degisim` 404 → yoklama kipi.

## 14. İç API kaynağını hazırlıktan ÜRETİM satıcısına çevirme

> **Durum:** HAZIRLANDI 2026-09-30; UYGULANMIŞ (ölçüldü 2026-10-05: patron `tekserp-satici-uretim-ic-api` ağında, hazırlık satıcısı ve ağı kaldırıldı — adım 8'deki deneme tesisi imha edildi, başlıktaki kutu). Patron aynı anda TEK satıcının `ic-api` ağına bağlanır (compose'da tek `ic-api` ağı); geçiş = ağ adı + iki adres + sır kopyası + patronun yeniden yaratılması. Önkoşul: üretim satıcısı kurulu ([`SATICI-KURULUM.md`](SATICI-KURULUM.md) §13, günlükte `ic=4612`). VDS yazımıdır — kullanıcının "uygula" cümlesiyle; önce ve sonra `deploy/vds-dogrula.sh` ✅, Traefik yeniden başlatılmaz.

`v() { ssh -p 2222 oguzhan@80.253.255.188 "$@"; }` · `P=/opt/stack/apps/tekserp-patron-uretim` · `Y=tekserp-satici-yedek:<üretim satıcısı sha>` (yardımcı konteyner) · `T=$(mktemp -d)`.

1. **Ölç (salt okuma):** `v "docker network inspect tekserp-satici-uretim-ic-api --format '{{range .Containers}}{{.Name}} {{.IPv4Address}} {{end}}'"` → yalnız `tekserp-satici-uretim 172.31.251.34/28` (`172.31.251.35` BOŞ); `v "grep -E '^(SATICI_IC_API_AGI|SATICI_IC_API_IP|PATRON_IC_IP|KURULUM_KAYNAGI)=' $P/.env"` → bugünkü hazırlık değerleri (not edilir: geri dönüş).
2. **Önce yedek:** `v "cd $P && docker compose exec -T patron-yedek /arac/yedek-dongusu.sh tek"`.
3. **`.env` (Mac'te hazırlanır, sır içermez):**

   ```bash
   v "cat $P/.env" > $T/patron-vds.env
   sed -e 's#^SATICI_IC_API_AGI=.*#SATICI_IC_API_AGI=tekserp-satici-uretim-ic-api#' -e 's#^SATICI_IC_API_IP=.*#SATICI_IC_API_IP=172.31.251.34#' \
       -e 's#^PATRON_IC_IP=.*#PATRON_IC_IP=172.31.251.35#' $T/patron-vds.env > $T/patron-uretim.env && diff $T/patron-vds.env $T/patron-uretim.env
   node deploy/patron/compose-denetle.mjs --env-file $T/patron-uretim.env --satici-env ~/.tekserp/satici-uretim-vds.env
   ```

   Beklenen: `diff` yalnız üç satır; denetim 0 ihlal (⑨ üretim satıcısının `.env`'iyle: ağ adı · `PATRON_IC_IP` · iç API adresi aynı, `SIR_GID` farklı, ağlar çakışmaz).
4. **Sır kopyası** (üretim satıcısının belirteci patron dizinine AYRI dosya olarak; eski kopya yanında kalır, içerik basılmaz):

   ```bash
   v "P=$P Y=$Y sh -s" <<'UZAK'
   set -eu
   docker run --rm --network none --user 0 -v /opt/stack/apps/tekserp-satici-uretim/sirlar:/s:ro -v "$P/sirlar:/p" --entrypoint sh "$Y" -c '
     cp -p /p/ic-api-belirteci /p/ic-api-belirteci.yedek-hazirlik &&
     cat /s/ic-api-belirteci > /p/ic-api-belirteci &&
     chown 0:61062 /p/ic-api-belirteci && chmod 440 /p/ic-api-belirteci &&
     cmp -s /s/ic-api-belirteci /p/ic-api-belirteci && echo "belirteç kopyası bayt-eşit (içerik basılmadı)"'
   UZAK
   ```

5. **`.env` yerinde** (sahip/izin/inode korunur; yedek ev dizininde):

   ```bash
   scp -P 2222 $T/patron-uretim.env oguzhan@80.253.255.188:patron-env-yeni
   v "P=$P sh -s" <<'UZAK'
   set -eu
   cp -p "$P/.env" "$HOME/patron-env-yedek-$(date +%Y%m%d_%H%M)" && cat "$HOME/patron-env-yeni" > "$P/.env" && rm "$HOME/patron-env-yeni"
   cd "$P" && docker compose config -q && echo "config yeşil"
   UZAK
   ```

6. **Yeniden yarat (yalnız patron):** `v "cd $P && docker compose up -d patron"` → patron üretim satıcısının `ic-api` ağına `172.31.251.35` ile katılır, hazırlığınkinden çıkar; DB ve yedek konteyneri dokunulmaz. Günlük: `PATRON_DINLIYOR … kurulumKaynagi=satici web=acik`.
7. **Doğrula:** patrondan iç API — `v "docker exec tekserp-patron-uretim patron-baslat node -e \"fetch('http://172.31.251.34:4612/ic/v1/kurulum/00000000-0000-4000-8000-000000000000',{headers:{Authorization:'Bearer '+process.env.SATICI_IC_API_BELIRTECI}}).then(r=>console.log(r.status))\""` → `404` (kapı geçildi); aynı komut başlıksız → `401` · `docker network inspect tekserp-satici-uretim-ic-api` → satıcı `.34` + patron `.35`; `tekserp-satici-hazirlik-ic-api` → yalnız hazırlık satıcısı · `curl -s https://patron.etkiliyazilim.com/saglik` → `{"success":true}` · sonra `deploy/vds-dogrula.sh` ✅.
8. **Etki ve geri dönüş:** hazırlıkta açılmış deneme tesisinin kurulumu (`eecfd6b7…`, TEST) üretim satıcısında YOK → patron ilk sorguda `404` alır ve kaydı pasife çeker (beklenen; §10). Gerçek tesisler üretim satıcısının tesis kimliğiyle `tesis-ac` ile açılır (geçiş dilimi). Geri dönüş: `.env` yedeği (`cat ~/patron-env-yedek-<damga> > $P/.env`) + `ic-api-belirteci.yedek-hazirlik` → `ic-api-belirteci` (aynı yardımcı konteyner kalıbı) → `docker compose up -d patron`. Üretim satıcısı geri alınacaksa bu dönüş ÖNCE yapılır (patron bağlıyken ağ silinemez; SATICI-KURULUM §13.8).

## 15. Ad değişimi — `yonetim.etkiliyazilim.com` birincil, `patron.` kalıcı takma ad (2026-10-16; UYGULANDI — kayıt §15a)

> Kullanıcı kararı 2026-10-16: kullanıcıya görünen ad "TeksERP Yönetim". Kod/dizin/izin adları `patron` kalır. Sıra
> önemli: DNS ve yönlendirici ÖNCE (uygulama yonetim'e gömülü — ad çözülmeden mağaza paketi giriş yapamaz), mağaza SONRA.
> VDS yazımıdır — kullanıcının "uygula" cümlesiyle; önce/sonra `deploy/vds-dogrula.sh` ✅, Traefik yeniden başlatılmaz.

1. **DNS (kullanıcı, Cloudflare):** `yonetim` A → `80.253.255.188`, proxy AÇIK (§5). `patron` kaydına DOKUNULMAZ.
   Kayıt yönlendiriciden önce açılırsa `yonetim.…/saglik` 404 döner (zararsız).
2. **İmaj:** `deploy/patron/imaj-derle.sh` (feat/yonetim-ad inişi sonrası `main` HEAD) → §2.2/§4.4 kalıbıyla VDS'e;
   web sürümü yeni adları (giriş başlığı, bildirim başlığı) imajla taşır; TOTP etiketi yalnız YENİ davetlerde "TeksERP Yönetim".
3. **`.env`:** `PATRON_HOST=yonetim.etkiliyazilim.com` + YENİ satır `PATRON_TAKMA_HOST=patron.etkiliyazilim.com` +
   imaj etiketleri; önce `cp -p .env ~/patron-env-yedek-<damga>`. Mac'te `compose-denetle.mjs --env-file <yeni .env> --satici-env …`
   → ⑦ "Host'lar .env'deki PATRON_HOST + PATRON_TAKMA_HOST" ✅.
4. **Yükselt:** §8 kalıbı (önce yedek → `--profile goc run --rm patron-goc` → `docker compose up -d`). Yönlendirici etiketi
   değiştiği için patron konteyneri yeniden yaratılır; Traefik etiketi kendisi okur.
5. **Doğrula:** `curl -s https://yonetim.etkiliyazilim.com/saglik` ve `https://patron.etkiliyazilim.com/saglik` → ikisi
   `{"success":true}`; `/v1/esitle` imzasız POST iki adda da 401/400; köken doğrudan (`--resolve yonetim…:443:<IP>`) 403;
   `tarayici-duman.cjs https://yonetim.etkiliyazilim.com` çıkış 0; fabrikadan bir eşitleme turu kabul (takma ad üzerinden).
6. **Gizlilik sayfası:** `deploy/gizlilik-sayfasi/vds-kur.sh` (kuru) → `--uygula` (conf değişti; `--html` YETMEZ) →
   `node deploy/gizlilik-sayfasi/olc.mjs` (`/yonetim-gizlilik` 200 + `/patron-gizlilik` 301). DNS adımı yok (aynı köken).
7. **Mağaza:** Play'de YENİ uygulama "TeksERP Yönetim" → `tekserp-yonetim-<sürüm>-vc1.aab` (`PATRON-MAGAZA-ANDROID.md` §3, §9).
8. **Geri dönüş:** `.env` yedeği + eski imaj etiketi → `docker compose up -d`; `yonetim` DNS kaydı kalabilir (yönlendirici
   yoksa 404). `patron` adı hiçbir adımda kapanmadığı için fabrikalar etkilenmez.

### 15a. Kayıt — ad değişimi üretimde, `8fc40a01c14c` → `e847c7a55f3e` (2026-10-15 22:33Z, §8 kalıbı, göçsüz)

- **Kapsam:** `main` `e847c7a55` (`feat/yonetim-ad` inişi; CI `38816338643` yeşil — ilk koşu `38814367124` main'den gelen `<svc>` yer tutucusuyla kırmızıydı, main'deki `c8c4f38fb` dala birleştirildi). Yönlendirici `(Host(yonetim) || Host(patron)) && !PathRegexp(ic|yonetim)`; web "TeksERP Yönetim". `patron/sunucu/prisma` farkı YOK; `docker-compose.yml` DEĞİŞTİ (yalnız yönlendirici kuralı + başlık yorumu) → yeni compose + `.env`'de `PATRON_HOST=yonetim.etkiliyazilim.com` + YENİ `PATRON_TAKMA_HOST=patron.etkiliyazilim.com` + iki imaj etiketi. DNS `yonetim` A → köken, proxy AÇIK (önceden açıldı); `patron` kaydına dokunulmadı. Satıcıya dokunulmadı.
- **Önce ölçüm (salt okuma):** çalışan `8fc40a01c14c` (4 servis sağlıklı) · merkez ve tesis DB'si (`patron_t8716286a6afc4c86`) 9 göç, yarım 0 · `facility_databases` `HAZIR/20261015120000_tek_kimlik` · tesis `accounts` 2 · `installations` 1 · `projection_rows` 13 · `sync_state.last_package_at` 22:18:05Z (fabrika 2.15.8). Bellek kullanılabilir 1757 MB · disk 46 GB boş.
- **Önce/sonra:** imaj yüklemesinin, `.env`/compose yazımının ve `up -d`nin önünde ve arkasında `vds-dogrula.sh` → ✅ adnansahin AYNI (420) · kök · defter/nginx/compose AYNI · satıcı yedeği taze. Traefik, `tekserp-guncelleme`, `docker-socket-proxy`, `tekserp-satici-uretim*` yeniden başlamadı (`StartedAt`/`RestartCount` aynı); `adnansahin/electron/latest.yml` 200.
- **İmaj:** feature worktree'sinden (`e847c7a55`, temiz — main'e hızlı ileri indi, aynı commit) `imaj-derle.sh --platform linux/amd64` (arşiv 321 MB, sha `e2b16346…`) → scp → `sha256sum -c` + `docker load`; iki uçta imaj kimliği aynı (`sha256:d170eb51…` · yedek `sha256:3a0753f8…`). İmajdaki göç 9 = DB'deki 9.
- **compose-denetle (Mac):** `--env-file <yeni .env> --satici-env <üretim satıcısının VDS .env'i>` → 51 geçti, 0 ihlal; ⑦ `Host'lar .env'deki PATRON_HOST + PATRON_TAKMA_HOST` ✅ (satıcı `.env` kopyası ölçümden sonra silindi).
- **Önce yedek:** `exec -T patron-yedek /arac/yedek-dongusu.sh tek` → `patron_20261015_223052.dump.tkenc` + `anahtarlar_20261015_223052.tar.tkenc` + `tesis_8716286a-6afc-4c86-af01-4f595d789f54_20261015_223052.dump.tkenc`; üçünde iki uç sha eşit (`88495440…` · `36a07d01…` · `c94791e8…`), Mac'te özel yarıyla açıldı: merkez ve tesis dökümü `pg_restore --list` 26 tablo verisi; anahtar arşivi (`patron-totp.key` · `patron-vapid.json`) Mac ile bayt-eşit; düz kopyalar silindi (`rm -P`).
- **Dosyalar:** `.env` `cp -p` → `~/p8-env-yedek-8fc40a01c14c`; compose yedeği `docker-compose.yml.yedek-20261015_2233-8fc40a01c14c`; yeni compose ağsız yardımcı konteynerle (`--user 0`) yazıldı, repoyla bayt-eşit (`b972070a…`). Yeni compose eski `.env`'le `config` VERMEZ (`PATRON_TAKMA_HOST gerekli`) — beklenen; çalışan konteynerler etkilenmedi. `.env` yerinde yeniden yazıldı (fark: `PATRON_HOST` + yeni `PATRON_TAKMA_HOST` + iki etiket; sahip/mod/inode aynı) → `config -q` yeşil.
- **Göç:** `docker compose --profile goc run --rm --no-deps patron-goc` (eski sunucu çalışırken; göç yok) → `No pending migrations to apply` · `✅ roller hizalandı` · tesis `güncel · şema 20261015120000_tek_kimlik` · `PATRON_TESIS_GOC tesis=1 hata=0`; günlük sır taramasından (0 isabet) sonra silindi.
- **Başlatma:** `docker compose up -d` 22:33:45Z → `patron` sağlıklı 22:34:04Z: kesinti (komut → sağlıklı) **~19 sn**; DB dokunulmadı; `patron` · `patron-hazirla` · `patron-yedek` yeni imajla. Günlük: `PATRON_DINLIYOR port=4620 kurulumKaynagi=satici web=acik` · `PATRON_BILDIRIM kip=kapali` · `güvenlik bildirimi: KAPALI` · `bakım: 109 satır budandı`; hata 0; üç konteyner `RestartCount` 0. Traefik'te tek WRN: geçici `patron-goc` konteynerinin kaybolması (zararsız).
- **Dış ölçüm (§6, iki adda AYNI):** `/saglik` 200 `{"success":true}` · `/` 200 `no-store` + CSP (`unsafe-inline` yok) + `DENY` · başlık `<title>TeksERP Yönetim</title>` · `entry-4a41bd78….js` 200 `immutable` (paket "TeksERP Yönetim" taşır) · `/cariler/x` 200 · `/api/yok` 404 JSON `BULUNAMADI` · `/ic` · `/ic/v1/zil` · `/yonetim` 404 · `/api/oturum` 401 · imzasız `POST /v1/esitle` 401 `ISTEK_GECERSIZ` · köken doğrudan 443 (`--resolve`) 403 · köken `:4620` zaman aşımı.
- **Cloudflare kenar dersi:** `yonetim` adının İLK önbellek dolumu (FRA, `cf-cache-status: HIT`) ~10 dk boyunca giriş paketini damla damla verdi (200 başlığı, gövde 20 sn'de 13–226 KB); aynı dosya `?v=` sorgusuyla, `patron` adıyla ve VDS'ten 0,5–0,8 sn'de tamdı → köken sağlam, sorun kenar dolumu. Belirtecin (`cloudflare-token.txt`) önbellek temizleme yetkisi YOK (10000) — temizlenemedi; ~22:45Z'de kendiliğinden düzeldi (1,4 MB 0,65 sn). Sonraki yeni alan adında ölçüm, açılıştan ~10 dk sonra tekrarlanır ya da Cloudflare panelinden "Purge by URL".
- **Tarayıcı dumanı — ÜRETİMDE** (`tarayici-duman.cjs`, iki ad, çıkış 0): durum 200 · CSP ihlali 0 · konsol hatası 0 (CF beacon beyanlı istisna 2) · giriş formu "TeksERP Yönetim · E-posta · Parola · Devam · Davet kodum var" · `//` ve `//cariler//x` → `/giris`, sayfa hatası 0.
- **Fabrika kanalı (takma ad):** test-müşteri kurulumu (2.15.8, `PATRON_CLOUD_URL` = `patron.` adı) yükseltmeden sonra eşitledi: `POST /v1/esitle` 200 ×3 · `/v1/rapor/al` 200 ×2 (22:34Z sonrası; iki 401 imzasız ölçüm isteğimiz) · tesis DB `sync_state.last_package_at` 22:18:05Z → **22:45:02Z**.
- **İç API:** patrondan sıfır UUID belirteçli 404 · belirteçsiz 401.
- **Kaynak (VDS, boşta):** patron 116 / 512 MiB · DB 47 / 384 · hazırlayıcı 26 / 96 · yedek 1 / 128; kullanılabilir bellek 1794 MB.
- **Gizlilik sayfası (§15 adım 6):** `vds-kur.sh` kuru ✅ → ilk `--uygula` ⛔ `yardımcı konteyner yazamadı` (`H: unbound variable`): gövdedeki yorumda `onceki/'de` tek tırnağı kapattı; yalnız `onceki/`ye kopya alınmıştı, html/conf yazılmadı, sayfa eski hâliyle yayında kaldı. Düzeltme: bu kaydın hemen öncesindeki commit "fix(gizlilik-sayfasi): keep apostrophes out of the sh -c body" (yorum + `test_gizlilik_sayfasi` §8 · sonda N42) → `--uygula` ✅ (konteyner içinden iki sayfa = repo · `/patron-gizlilik` → 301 · köken 403 · komşu ölçümü sonra ✅) → `olc.mjs` hepsi geçti: `/yonetim-gizlilik` 200 bayt-eşit + `#hesap-silme` · `/yonetim-gizlilik/` · `/patron-gizlilik` · `/patron-gizlilik/` → 301 `/yonetim-gizlilik`.
- **Play (§15 adım 7):** `tekserp-yonetim-1.0.2-vc1.aab` (sha `07c5e415…` `.sha256` ile eşit) → `com.etkiliyazilim.tekserp.yonetim` **dahili test** (`internal`) — yükleme + kanal ataması + commit; geri okuma `internal [completed: 1]` "1.0.2 (1)", diğer kanallar boş; sürüm notu tr-TR `PATRON-MAGAZA-ANDROID.md` §5.4 (170 karakter). Uygulama taslak değildi (`completed` kabul edildi). Yayın defteri `play-YAYIN-DEFTERI.tsv` satırı `yonetim-1.0.2-play-internal … vc1 yukle dogrulandi-completed`.
- **İmajlar:** VDS'te `e847c7a55f3e` (çalışan) + `8fc40a01c14c` (geri alma) + `83f837666826` (en eski — sonraki yükseltmede silinir).
- **Geri alma:** göç yok, şema aynı → `cat ~/p8-env-yedek-8fc40a01c14c > .env` + eski compose (`docker-compose.yml.yedek-20261015_2233-8fc40a01c14c`, yardımcı konteynerle) + `docker compose up -d` (eski imaj yerinde); `yonetim` adı o zaman 404 verir, `patron` adı hiç kapanmaz. Veri gerekirse `patron_20261015_223052` ve `tesis_8716286a…_20261015_223052` yedeklerinden (§7).

## 16. v2 (0.2.0) — ölçümler ve yayın hazırlığı (2026-10-24)

> Patron uygulaması v2 dalgasının (W1) ölçüm kayıtları ve backend 2.15.13 test grubu yayınının HAZIRLIĞI. Hiçbiri VDS'e, Play'e ya da dağıtım kanalına yazmadı. Dağıtım sırası: P5 N−1 sonucu **KABUL** → backend ile bulut arasında sıra şartı YOK (serbest).

### 16.1 Ölçüm — uçtan uca gecikme (yerel)

Düzenek: Senaryo P'nin gerçek fabrika backend'i (`tekserp_w1_test`) + gerçek patron bulutu (`tekserp_w1bulut_test`), lisans kira aralığı 5 dk; betik `Teks-Erp/scripts/olcum-patron-uctan-uca.ts` (CI'a bağlı değil). Gecikme = fabrikada `POST /api/orders` 201 → bir bulut hesabının `GET /api/degisim?since=…&bekle=25` uzun yoklamasının `degisenler` içinde `siparis` ile dönmesi. Bayrak `patronBulut.olayGudumluEnabled` AÇIK:

| Tekrar | Gecikme (ms) | Tetik |
|---|---|---|
| 1 | 3133 | periyodik (başlangıç tıkı aynı pencereye düştü) |
| 2 | 3291 | olay |
| 3 | 3236 | olay |
| 4 | 3358 | olay |
| 5 | 3110 | olay |
| **Özet** | **min 3110 · medyan 3236 · maks 3358** | hedef medyan ≤ 20 sn → SAĞLANDI |

- Bileşim: 3 sn debounce + ~0,2 sn tur/kabul; her tekrarda tek uzun yoklama yetti, sipariş bulutta.
- **15 sn aralık kapısının etkisi:** önceki olay turundan ~2 sn sonra gelen ikinci yazım 12623 ms'de göründü (ilki 3477 ms) → en kötü hâl ≈ 15 sn + tur.
- **Bayrak KAPALI (kanıt):** 25 sn'lik yoklama 25021 ms'de `degisenler: []` döndü, değişim sayacı 1→1, sipariş bulutta YOK; zorlanan emniyet (kira aralığı) turundan sonra bulutta VAR. ⇒ Bayrak kapalıyken davranış bugünkü gibi kira aralığına bağlıdır.

### 16.2 Ölçüm — olay turu maliyeti (sentetik, yerel)

Soru: olay turu en sık 15 sn'de bir koşar; büyük bir fabrikada bir turun DB maliyeti fabrikayı yavaşlatır mı? Betik `Teks-Erp/scripts/olcum-patron-olay-turu.ts` (CI'a bağlı değil; `dolgu` · `olc` · `kirilim`). Fabrika verisi KLONLANMADI.

**Hacim (sentetik, `tekserp_w1perf_test`):** `dolgu` kendi üreticisidir — tek işlemde `generate_series` INSERT'leri (FK/CHECK/tetikleyicilere uyar; damgalar 365 güne yayılı, hiçbiri gelecekte değil; doğuş tetikleyicileri — top durum olayı, üretim damgası, `shipment_orders` kirli işareti — gerçek yoldaki gibi çalışır, her 80. sevkli topun çuval değişimi `rolls_sync_parent_moved` işaretini doğurur). Kapılar kaçışsız: ad `^tekserp_[a-z0-9]*perf[a-z0-9]*_test$` · `hedefDbEngeli` · host yerel · `node scripts/test-db.mjs liste` KAYITLI açılış · başlangıçta `rolls = 0`. `seed-load-scale.ts` çağrılmaz (onun ad kapısını aşan yol patron kararıyla reddedildi). Negatif sondalar: `tekserp_w1_test` (ad) · uzak host · kayıtsız ad · 72 toplu kayıtlı DB → dördü de çıkış 2, yazma yok.

| Tablo | Satır | Tablo | Satır |
|---|---|---|---|
| `rolls` | 12.000 | `roll_movements` | 33.330 (ölçüm sonu 34.127) |
| `orders` | 2.200 | `order_lines` | 6.600 |
| `customers` / `cari_accounts` | 522 / 520 | `work_orders` / adımlar | 2.108 / 6.324 |
| `shipments` / `sacks` | 1.841 / 3.682 | `sync_marks` | 1.968 |

**Düzenek:** sahte bulut (yerel HTTP, `bulut-fikstur`), gerçek `runEventRound` (bayrak açık), ağ yok. Üç süre ayrı ölçülür: **duvar** (turun başı→sonu) · **sunucu** (`pg_stat_database.active_time` farkı; boşta 11 sn beklenerek okunur — PG istatistiği en geç 10 sn'de yazar) · **istemci DB toplamı** (her sorgunun gidiş-dönüşü toplanır; paralel sorguları üst üste ve macOS Docker ağ gecikmesini sayar → yükü ABARTIR, yalnız bilgi). İki koşum (2026-10-24; 1. koşumda sunucu ölçüsü yoktu), her seri 5 tekrar:

| Seri | Duvar ms (min · medyan · maks) | Sunucu ms (koşum 2) | SQL/tur (medyan) |
|---|---|---|---|
| (a) değişiklik yok | 1: 234 · 337 · 382 — 2: 199 · **225** · 293 | 95 · **130** · 185 | 297–301 |
| (b) tek sipariş değişti | 1: 203 · 269 · 340 — 2: 186 · 329 · 337 | 100 · 139 · 177 | 317–318 |
| (c) 100 top hareketi sonrası | 1: 234 · 316 · 376 — 2: 284 · 329 · 337 | 96 · 111 · 136 | 315–318 |
| İlk tam eşitleme (bir kez) | 1486 / 1577 (1 tur, 7 paket) | — | 473 |

**(d) 15 sn aralıkla 5 dk sürekli yazma** (saniyede 1 top hareketi + top damgası, 5 sn'de bir sipariş değişikliği; koşum 2: 20 tur, 357 hareket, 71 sipariş): tur duvarı medyan 273 ms (163–355) · DB'nin toplam sunucu süresi 3102 ms, yalnız-yazıcı penceresinin hızı (60 sn'de 237 ms) düşülünce turların payı **1929 ms → %0,64** · tur duvarı toplamı / duvar **%1,73** (koşum 1: %1,49) · istemci DB toplamı %6,14 (abartılı ölçü, yukarıda).

**Kırılım (nereye gidiyor):** 24 kayıt projeksiyonunun değişiklik taraması toplam 34–133 ms duvar, 118 SQL (projeksiyon başına 4–10; en pahalısı `cari-hesap` 4–21 ms) — tarama filigrandan sonrasına bakar; bu hacimde projeksiyon başına ≤ 21 ms. HER_TUR anlıkları tek başına 107–153 ms duvar, 171–182 SQL; modül birleşimleriyle ayrıştırma (`kirilim`, 3 tekrar, sunucu medyanı): yalnız `ozet` (üretimsiz) + `tesis` + `saglik` **111 ms / ~100 SQL** · + `ozet-finans` 116 ms · + `uretim-akisi` 146 ms · hepsi 121 ms. ⇒ Boş turun sunucu süresinin büyük kısmı her turda yeniden kurulan **`ozet` anlığıdır** (getFactoryOverview + dönem pencereleri); özet eşitse gönderilmez ama KURULUR.

**Karar:** (d) eşiği (≤ %2) **SAĞLANDI** — sunucu payı %0,64, duvar payı %1,73. (a) eşiği (≤ 200 ms) duvar saatinde **AŞILDI** (medyan 225 / 337 ms), sunucu süresinde sağlandı (130 ms). ⇒ **DB darboğazı YOK**: tur fabrikanın DB'sine 15 sn'de ~0,13 sn iş bindirir; duvar fazlası ~300 sorgunun gidiş-dönüşüdür (Linux kurulumda yerel soket bunu küçültür — ölçülmedi). **Öneri (kod değiştirilmedi; ayrı dilim):** (1) olay turunda HER_TUR anlıklarını yalnız kirli küme onların okuduğu tablolara değdiyse kur, değmediyse periyodik tıka bırak — boş/ilgisiz turun maliyeti tarama düzeyine (~118 SQL) iner; (2) `ozet`in ~100 sorgusunu dönem pencerelerini tek CTE'de toplayarak azalt.

### 16.3 Senaryo P ve bayrak açık bekçiler (yerel, 2026-10-24)

- **Senaryo P tam koşum** (`tekserp_w1_test` + bulut `tekserp_w1bulut_test`, origin/main `86247e657` + bu dalın termin düzeltmesi): **24 YEŞİL · 1 KISMİ (P14) · 0 KIRMIZI**, adımların toplamı 159 sn. Çıkış **1**: koşucu KISMİ'yi de "yeşil olmayan" sayar ve P14 sözleşme v1'de TANIM GEREĞİ KISMİ'dir (N−1 = v0 yok; karar fonksiyonu ölçülür, uçtan uca bant sözleşme v2'de). ⇒ sözleşme v1 kaldıkça Senaryo P'nin ulaşabileceği en iyi sonuç budur; "çıkış 0" beklentisi P14 KISMİ'yi kapsamaz.
- **İlk koşum KIRMIZIYDI (tarih çürümesi):** P5 gelen kutusu siparişi sabit `termin: "2026-10-15"` taşıyordu; tarih geçince fabrika iş kuralı "Termin tarihi sipariş tarihinden önce olamaz" ile reddetti → P5 ❌ ve P5'in sipariş kimliğine bağlı P24 ❌ (`invalid input syntax for type uuid: ""`). Düzeltme: termin koşum gününden 30 gün ileri fabrika günü, beklenen `deadline` `factoryDayStartOfKey(termin)` (`Teks-Erp/scripts/lib/senaryo-patron-adimlar-b.ts`). Ürün kodu değişmedi.
- **Bayrak açık bekçiler (yerel, 2026-10-24):** `test_bulut_olay_gudumlu` (`tekserp_w1_test`, bayrağı kendisi açar/kapatır) **39 geçti / 0** · bulutta `test_degisim_sayaci` (`tekserp_w1bulut_test`) **21 geçti / 0**.

### 16.4 Backend 2.15.13 → `test` grubu — yayın HAZIRLIĞI (2026-10-24; KOŞULMADI, kullanıcının "uygula" cümlesini bekler)

Kalıp: 2.15.12 test grubu yayını (2026-10-21; runbook + rapor `~/.tekserp/dokuma-prova-1021/dagitim-{runbook,raporu}.md`). Bu bölüm o kalıbın 2.15.13 farkını ve hazır komutları verir; adımların gerekçesi orada.

**Ölçülmüş başlangıç (2026-10-24, salt okuma):**

| Ölçü | Değer |
|---|---|
| Son backend etiketi | `backend-v2.15.12` → `9efa190ac`; `node scripts/backend-surum.mjs` → **2.15.13** |
| Kapsam (`backend-v2.15.12..origin/main`) | P4 olay güdümlü tur (`patronBulut.olayGudumluEnabled`, varsayılan KAPALI) + zil turu tüm projeksiyonlar · P5 `siparis`/`sevkiyat.musteriAdi`, `siparis-kalemi.urunAdi`/`renkAdi` (İŞLEM, opt-in) · panel: Sistem → Patron Bulutu ayar kategorisi. `Teks-Erp/src` 10 dosya; geri kalan commit'ler `patron/**` (pakete girmez) |
| Migration | **YOK** — HEAD 395 = etiket 395 |
| Native / güncelleyici / docker / pg / node | `git diff backend-v2.15.12 HEAD -- Teks-Erp/native deploy/pg deploy/node-surumu.json Teks-Erp/docker` BOŞ → güncelleyici 0.2.8 kalır |
| Kanal kayıtları | `deploy/kanallar.json` ve `deploy/dagitim.json` etiketten beri DEĞİŞMEDİ |
| Sürüm notu | main'de `docs/surumler/backend-2.15.13.md` (P4 + P5 taslakları W2'de tek taslakta birleşti; sürüm commit'inde 2026-10-26 bu ada taşındı, kullanıcı onayı test grubu yayını için) |

**Test grubunda kim var (ölçüldü):** `deploy/kanallar.json` grup üyeliği TAŞIMAZ — üç ESKİ kanal kaydı vardır: `adnansahin` (üretim, DONMUŞ — bu yayının hedefi DEĞİL), `testfabrika` (hazırlık, adnansahin aynası; emekli 2026-10-05), `demofabrika` (aynasız hazırlık; kanalı 2026-10-11'de kaldırıldı, blok bayt-donuk). Grup yayını hedefi `deploy/dagitim.json` `gruplar` (`test` kök · `oncu` ← test · `genel` ← oncu) + `indirmeKoku`'dan türer; kurulumun grubu satıcıdaki kiranın `kanal.kod` alanıdır (repoda yok). Bilinen tek `test` üyesi: **bulut deneme sunucusu** (`ssh tekserp-bulut-deneme`, 213.142.134.226, `/opt/tekserp/test-musteri`, kip ONAYLI; 2026-10-21'de kira `kanal.kod = test` ölçüldü — `SUNUCU-ENVANTERI.md`). Adnan Şahin kurulumu `adnansahin` eski kanalında / üretim satıcısında; `--grup=test` yolu ona hiç dokunmaz (kanal=test grep kalıbı her çıktıya uygulanır).

**Deneme için 2.15.13'ün anlamı:** deneme patron bulutuna bağlı (§15a: test-müşteri `PATRON_CLOUD_URL` = `patron.` adı). Kurulumdan sonra (a) bayrak KAPALI kaldıkça eşitleme bugünkü gibi kira aralığında; (b) P5 lookup kaynaklarının filigranı olmadığından İLK tur bağlı bütün sipariş/sevkiyat/kalem satırlarını yeni alanlarla yeniden gönderir (2.000 satır/kaynak/tur; DEVIR-P5) — N−1 bulut fazla alanı saklar (P5 N−1 KABUL), bulut önce şartı YOK; (c) olay turu yalnız kullanıcı panelden açarsa çalışır (aşağıda isteğe bağlı adım 7).

**Hazır komutlar (sıra 2.15.12 kalıbı; `<RUN>`/`<SURUM_SHA>` yayın anında ölçülür):**

```sh
# (0) ön koşul — izole worktree, ana ağaç KİRLİ
cd /Users/demirci/Documents/Projeler/Teks-Erp && git fetch origin --tags
gh pr list --state open; gh run list --branch main -L 3            # main CI yeşil
git worktree add ../Teks-Erp-wt/yayin-21513 -b chore/yayin-21513 origin/main
cd ../Teks-Erp-wt/yayin-21513 && (cd Teks-Erp && npm ci && npx prisma generate)
git diff --quiet 'backend-v2.15.12^{commit}' HEAD -- deploy/kanallar.json && echo "kanallar.json donuk"
node scripts/test_eski_kanal_donuk.mjs && node scripts/check-dagitim.mjs
git diff --stat 'backend-v2.15.12^{commit}' HEAD -- Teks-Erp/prisma/migrations Teks-Erp/native deploy/pg deploy/node-surumu.json Teks-Erp/docker   # BOŞ beklenir

# (1) sürüm commit'i — KULLANICI ONAYI: sürüm notu metni
node scripts/backend-surum.mjs                    # 2.15.13
node scripts/backend-surum.mjs --uygula           # Teks-Erp/package.json → 2.15.13
(cd docs/surumler && git mv 2.15.13-taslak.md backend-2.15.13.md)   # TASLAK başlığı kaldırılır, SABLON yedi başlık; göç YOK (395), sözleşme kırılmadı, minVersion dokunulmadı
(cd Teks-Erp && npx tsx scripts/test_surum_belgesi.ts)
git commit -F <mesaj>   # "docs(sürüm): backend 2.15.12 → 2.15.13 — sürüm commit'i (test grubu yayını)" → PR → CI 21/21 → merge = <SURUM_SHA>

# (2) korumalı paket CI'ı (yalnız workflow_dispatch; girdisi yok)
gh workflow run korumali-paket.yml --ref main
RUN=$(gh run list --workflow=korumali-paket.yml -L1 --json databaseId -q '.[0].databaseId')
gh run view $RUN --json headSha -q .headSha      # = <SURUM_SHA>; değilse DUR
gh run watch $RUN
D=~/.tekserp/korumali-derleme/p21513-$RUN; mkdir -p $D/{imaj,kunye,guncelleyici,teslim}
gh run download $RUN -n korumali-imaj-linux-x64 -D $D/imaj
gh run download $RUN -n korumali-imaj-kunye-linux-x64 -D $D/kunye
gh run download $RUN -n guncelleyici-linux-x64 -D $D/guncelleyici
gunzip -c $D/imaj/tekserp-korumali-imzasiz-linux-x64.tar.gz | docker load

# (3) imza + teslim (parola Anahtar Zinciri `tekserp/paket`; komuta yazılmaz)
export TEKSERP_PAKET_ANAHTARI=~/.tekserp/satici-uretim/donemler/20261009T194029Z/paket/pkt-2026-1.paket.json
node Teks-Erp/docker/korumali/imaj-imzala.mjs tekserp-korumali:2.15.13-imzasiz tekserp-korumali:2.15.13 --ci-kosu=$RUN 2>&1 | tee $D/imzala.log
sh Teks-Erp/docker/korumali/teslim-paketle.sh tekserp-korumali:2.15.13 $D/guncelleyici $D/teslim 2>&1 | tee $D/teslim.log

# (4) grup yayını — YALNIZ test; önce KURU
node deploy/backend-yayinla.mjs --grup=test --urun=backend-oci --paket=$D/teslim/tekserp-backend-oci-2.15.13.tar --kuru 2>&1 | tee $D/yayin-kuru.log
grep -c '/tekserp-indir/html/test/backend-oci' $D/yayin-kuru.log                       # > 0
grep -nE 'adnansahin|guncelleme\.etkiliyazilim|sahinsrv|192\.168\.1\.250|100\.107\.103\.79|/oncu/|/genel/' $D/yayin-kuru.log && echo "⛔ DUR" || echo "✓ kanal=test temiz"
grep -q 'göç 395' $D/yayin-kuru.log && echo "göç sayısı tamam"
node deploy/backend-yayinla.mjs --grup=test --urun=backend-oci --paket=$D/teslim/tekserp-backend-oci-2.15.13.tar 2>&1 | tee $D/yayin.log   # gerçek
node scripts/backend-surum.mjs --etiketle 2.15.13 && git ls-remote --tags origin backend-v2.15.13
node deploy/backend-yayinla.mjs --grup=test --urun=backend-oci --dogrula

# (5) deneme: ONAY_BEKLIYOR ölçümü (salt okuma) → kullanıcı panelden "Şimdi kur"
#     beklenen durum.json: <kurulu: 2.15.12 ya da 2.15.11 — 2.15.12 "Şimdi kur" kullanıcı adımıydı, yayın anında ölç> HAZIR 2.15.13 ONAY_BEKLIYOR ONAYLI None
# (6) kurulum sonrası: /health 2.15.13 · göç 395 / yarım 0 · durum.json son.sonuc BASARILI
#     patron bulutu: tesis DB `sync_state.last_package_at` kurulumdan sonra ilerler; ilk turlarda sipariş/sevkiyat satırları `musteriAdi` taşır
# (7) İSTEĞE BAĞLI (kullanıcı kararı): deneme web paneli → Sistem → Patron Bulutu → "Patron bulutuna anında gönder" AÇ
#     → yönetim uygulamasında bir sipariş açıp fabrikada değiştir; beklenen ≤ ~20 sn (§16.1 yerel ölçüm). Kapatmak geri almadır.
```

**Geri alma:** göç YOK → kurulduktan sonra sorun çıkarsa güncelleyicinin önceki imaja dönüşü veri geri yüklemesiz mümkündür; grupta geri inme yok, düzeltme ileri sürümle (2.15.14). Davranış sorunu için ilk adım bayrağı KAPATMAK (kod geri alınmaz). Etiket `backend-v2.15.13` silinmez.

**Bu bölümde koşulan:** yalnız salt okuma ölçümleri (`git`, `node scripts/backend-surum.mjs` yazdırma kipi, `deploy/*.json` okuma). Paket üretimi, imza, yayın, VDS/deneme erişimi YAPILMADI.

## 17. v2 (0.2.0) yükseltme — HAZIRLIK (2026-10-24)

> **UYGULANDI 2026-10-26 (kayıt §13e, imaj `5156f26d2259`).** Hazırlık notu olduğu gibi durur: Bu bölüm yazılırken VDS'e `ssh`/`scp`/`docker load`/`up` YAPILMADI; Play'e ve dağıtım kanalına dokunulmadı. İlk aday `f80edf15df5b` tarayıcı dumanında KIRMIZI'ydı (§17.3) → VDS'e GÖTÜRÜLMEZ. **Geçerli aday `2bd3d7b0855e`** (düzeltme #100 sonrası temiz main'den), §17.2 ölçümleri bu sha ile tekrarlandı ve yeşil.

### 17.1 Aday imaj (W4, Mac)

- **Kaynak:** temiz worktree'de `origin/main` @ `2bd3d7b08` (#100 web ikon fontu CSSOM önkaydı; W3 #99 ve öncesi dahil). `deploy/patron/imaj-derle.sh --platform linux/amd64` → çıkış 0.
- **Etiketler:** `PATRON_IMAJ=tekserp-patron:2bd3d7b0855e` · `PATRON_YEDEK_IMAJ=tekserp-patron-yedek:2bd3d7b0855e` (linux/amd64; etiket `org.opencontainers.image.revision=2bd3d7b0855e`).
- **Arşiv:** `~/.tekserp/patron-imaj/tekserp-patron-2bd3d7b0855e.tar.gz` (321 MB, 325 281 154 bayt) + `.sha256` · sha256 `a447990181a3b7a024fde0ff6d2ae95d73abf18bce1737706e7116f786f844bf` (`shasum -a 256 -c` OK) · imaj kimliği `sha256:5f30bd53…` · yedek `sha256:45df59a1…`. İmajdaki göç 10 (son `20261022120000_degisim_sayaci`).
- **Önceki (BLOKE) aday:** `f80edf15df5b` · arşiv `tekserp-patron-f80edf15df5b.tar.gz` sha256 `09b5df14…` — VDS'e götürülmez.
- **Değişmeyenler (`git diff e847c7a55 2bd3d7b08`):** `deploy/patron/` farkı YOK → compose ve `ornek.env` aynı; `.env`'de yeni anahtar yok, fark yalnız iki etiket satırı. `patron/sunucu/prisma` farkı tek göç.

### 17.2 Ölçümler (yerel)

- **compose-denetle:** `node deploy/patron/compose-denetle.mjs --env-file deploy/patron/ornek.env` → 44 geçti · 0 ihlal · 1 ölçülemedi (⑨ satıcıyla uyum: `--satici-env` verilmedi) · **çıkış 2**. Uygulamadan önce sunucunun gerçek `.env`'i + üretim satıcısının `.env`'iyle çıkış 0 şarttır (§2.4).
- **Yerel duman — geçerli aday (`deploy/patron/duman.sh kur 2bd3d7b0855e`, amd64 öykünme, W4):** 10 göç · `✅ roller hizalandı` · `PATRON_TESIS_GOC tesis=0 hata=0` · `/saglik` 200 · `/` 200 `no-store` + CSP · `entry-394cc9a4….js` `immutable` · `/cariler/x` 200 · `/api/yok` · `/v1/yok` · `/ic/v1/zil` · `/yonetim` 404 · `/api/oturum` 401 · oturumsuz `GET /api/degisim?since=0&bekle=0` 401 `OTURUM_YOK` · ic-api adresinde 4620 `ECONNREFUSED` · uygulama dumanı 13/13 · yedek `tek`: merkez + tesis dökümü 26 tablo verisi · hazırlayıcı `0 running` · bellek patron 188 / 512 MiB · DB 51 / 384 · hazırlayıcı 58 / 96 · yedek 5 / 128. `duman.sh sifirla` ile proje + birimler kaldırıldı (imajlar ve arşiv durur).
- **Tarayıcı dumanı — geçerli aday (`tarayici-duman.cjs`, Chromium) — ✅ çıkış 0:** durum 200 · **CSP ihlali 0 · konsol hatası 0** · beyanlı istisna 0 · girdi 2 · `//` ve `//cariler//x` → `/giris`, sayfa hatası 0. 8 sn bekleyen ek sonda: `ionicons:loaded`, `expo-generated-fonts` metni 0 bayt (kural CSSOM'da), CSP 0 · konsol 0; ekran görüntüsünde logo ve buton ikonları çizili.
- **İlk aday — yerel duman (`deploy/patron/duman.sh kur f80edf15df5b`, amd64 öykünme):** 10 göç (`20261022120000_degisim_sayaci` dahil) · `✅ roller hizalandı` · `PATRON_TESIS_GOC tesis=0 hata=0`; duman tesisi açıldıktan sonra merkez DB ve tesis DB'si (`patron_tf17a93b4…`) 10 göç, `sync_state.change_counter=0` · `changed_projections='[]'::jsonb` DEFAULT'larıyla. HTTP: `/saglik` 200 · `/` 200 `no-store` + CSP · `entry-2a494200….js` `immutable` · `/cariler/x` 200 · `/api/yok` · `/v1/yok` · `/ic/v1/zil` · `/yonetim` 404 · `/api/oturum` 401 · **yeni:** oturumsuz `GET /api/degisim?since=0&bekle=0` 401 `OTURUM_YOK` · Traefik etiketi tek `$` · ic-api adresinde 4620 `ECONNREFUSED`. Uygulama dumanı 13/13. Yedek (`tek`, elle — betik tarayıcı adımında durdu): merkez + anahtarlar + tesis dökümü, özel yarıyla açıldı, merkez ve tesis `pg_restore --list` 26 tablo verisi. Hazırlayıcı `0 running`. Bellek: patron 180 / 512 MiB · DB 84 / 384 · hazırlayıcı 58 / 96 · yedek 17 / 128 (öykünme altında). `duman.sh kaldir` ile proje, birimler ve iki imaj kaldırıldı (arşiv durur).
- **İlk aday — tarayıcı dumanı (`tarayici-duman.cjs`, Chromium) — ❌ çıkış 1:** CSP ihlali **1** (`style-src-elem inline`) · konsol hatası **5** (CSP iletisi + 4 × `6000ms timeout exceeded`) · giriş formu çizildi ama logo kutusundaki ikon BOŞ · `//` ve `//cariler//x` → `/giris`, sayfa hatası 0.

### 17.3 BLOKE (KAPANDI → #100, aday `2bd3d7b0855e`) — web'de ikon fontu CSP'ye takılıyordu (P1 #89'dan beri)

- **Kök neden:** v2 ekranları `@expo/vector-icons/Ionicons` kullanır (40 içe aktarma). Web'de ikon seti fontu `expo-font`un `ExpoFontLoader.web.js` `_createWebStyle`ıyla yükler: `<style id="expo-generated-fonts">` ögesine `@font-face{…}` **metin düğümü** ekler. Sunucu CSP'si (`patron/sunucu/src/http/web-static.ts` `webCsp`) `unsafe-inline` olmadan yalnız giriş HTML'indeki satır içi blokların ve BOŞ stilin özetine izin verir → kural engellenir, Ionicons hiç yüklenmez, `fontfaceobserver` 6 sn'de zaman aşar; web'de bütün ikonlar boş çizilir. Android etkilenmez (yerel font). v1 (`e847c7a55f3e`) ikon fontu kullanmıyordu; üretim tarayıcı dumanı CSP 0'dı (§15a).
- **Doğrulanan düzeltme yolu (sonda; kod değişmedi):** aynı duman yığınında Playwright `addInitScript` ile sayfa betiklerinden önce `id="expo-generated-fonts"` `<style>` yaratılıp `@font-face` kuralı CSSOM'la (`sheet.insertRule`) eklendi → `expo-font` kuralı bulur (`getFontFaceRulesMatchingResource`), metin düğümü eklemez → CSP ihlali 0 · konsol hatası 0 · logo ikonu çizildi (önkayıtsız koşu aynı sondada 1 ihlal + boş ikon). CSSOM'u CSP kısıtlamaz (`BOS_STIL_OZETI` yorumundaki react-native-web kalıbı).
- **Uygulanan düzeltme (#100, CSP gevşetilmedi):** `patron/uygulama/src/web-icon-font.ts` (`entry.ts`te yönlendiriciden önce) `Ionicons.font`un metro varlık URL'siyle kuralı expo-font'un kendi `<style>` sayfasına `insertRule`la yazar; web dışında dokunmaz. Kabul: tarayıcı dumanı CSP 0 · konsol 0 · ikon çizili (§17.2).
- **İlk öneri (tarihsel):** web'e özgü önkayıt modülü (`src/web-path-fix.ts` kalıbı) ilk çizimden önce `Ionicons.font` kaynağını `Asset.fromModule(...).uri` ile çözüp kuralı `insertRule`la ekler. Bekçi: CI'da web export sonrası Chromium CSP dumanı yok — bu açık ancak `tarayici-duman.cjs` ile yakalandı; düzeltme dilimi aynı ölçümü kabul şartı yapar.

### 17.4 Göç

- `20261022120000_degisim_sayaci`: `sync_state`e iki DEFAULT'lu kolon (`change_counter BIGINT NOT NULL DEFAULT 0` · `changed_projections JSONB NOT NULL DEFAULT '[]'`). Yeni tablo, rol ya da yetki yok. PG 16'da sabit DEFAULT'lu `ADD COLUMN` meta-veri işlemidir (kısa kilit, tablo yeniden yazılmaz).
- Komut: `sudo docker compose --profile goc run --rm --no-deps patron-goc` — merkez `migrate deploy` → roller → `tesis-db goc` ile her HAZIR tesis DB'si. Beklenen: `Applying migration 20261022120000_degisim_sayaci` · `All migrations have been successfully applied` · `✅ roller hizalandı` · her tesis için `1 göç uygulandı · şema 20261022120000_degisim_sayaci` · `PATRON_TESIS_GOC tesis=<N> hata=0`. Eski sunucu kolonları okumadığı için göç eski sunucu ÇALIŞIRKEN koşulabilir (§15a kalıbı). Göç geri alınmaz.

### 17.5 Dağıtım sırası

P5 N−1 sonucu **KABUL** (eski bulut yeni alanlı paketi 200 ile saklar) → sıra şartı YOK. **Önerilen:** (1) bulut 0.2.0 → (2) deneme fabrikası backend 2.15.13 (`test` grubu, §16.4) → (3) Play vc2 (kapalı test).
- **Bulut önce:** web v2 imajla birlikte yayına girer; vc2'nin uzun yoklaması (`GET /api/degisim`) hazır olur (eski bulutta 404 → istemci yoklama kipine düşer, kırılmaz ama "saniyeler" sözü tutulmaz). vc1 yeni bulutla değişmeden çalışır (yeni ucu çağırmaz; kolonlar ek). N−1 fabrikalar bugünkü gibi eşitler.
- **Fabrika ikinci:** olay güdümlü tur ve zil kapsamı ancak sayaçlı bulutta uçtan uca ~3 sn'lik yansımayı verir (§16.1); bayrak varsayılan KAPALI olduğundan kurulum tek başına davranış değiştirmez. P5 adları N−1 bulutta da saklanacağından bu sıra zorunlu değil, yalnız önerilir.
- **Play en son:** yükleme + inceleme günler sürer; kullanıcı vc2'yi aldığında bulut ve deneme fabrikası hazırdır, ilk açılış yeni arayüzü canlı veriyle (P5 adları dahil) gösterir.
- Adnan Şahin kurulumu 2.15.13 ALMAZ (donuk eski kanal); bulut yükseltmesi tek imaj olduğundan buluta bağlı BÜTÜN tesisleri birlikte etkiler — bağlı tesisler ve fabrika sürümleri önce-ölçümde sayılır.

### 17.6 VDS adımları (UYGULANDI 2026-10-26 — kayıt §13e; aday `2bd3d7b0855e` yerine temiz main `5156f26d2259`)

`K=/opt/stack/apps/tekserp-patron-uretim`. Her VDS yazımının ÖNCE ve SONRA `deploy/vds-dogrula.sh` → ✅ adnansahin AYNI; fark ya da ölçülemedi → DUR. Traefik, `tekserp-guncelleme`, `docker-socket-proxy`, `tekserp-satici-uretim*` yeniden BAŞLATILMAZ (`StartedAt`/`RestartCount` önce/sonra aynı; `adnansahin/electron/latest.yml` 200).

0. **Ön koşul:** §17.3 düzeltmesi main'de (#100 ✅); aday `2bd3d7b0855e` temiz worktree'den derlendi, §17.2'nin hepsi yeşil (tarayıcı CSP 0 · konsol 0 · ikon çizildi dahil ✅). Aday değişirse bu satır yeni sha ile yeniden ölçülür.
1. **Önce ölçüm (salt okuma):** çalışan etiket (`.env` `PATRON_IMAJ`; kayıtlı son `e847c7a55f3e` — §15a; farklıysa geri alma etiketi ölçülen değerdir) · dört servis sağlıklı, `RestartCount` · merkez ve her tesis DB'si 9 göç, yarım 0 · `facility_databases` HAZIR · bağlı tesis sayısı ve `sync_state.last_package_at` · bellek/disk · B6 sır dosyası izinleri (§4 uyarısı).
2. **compose-denetle (Mac):** `--env-file <yeni .env> --satici-env <üretim satıcısının .env'i>` → çıkış 0; satıcı `.env` kopyası ölçümden sonra silinir.
3. **İmaj yükleme:** `scp ~/.tekserp/patron-imaj/tekserp-patron-<sha>.tar.gz* tekserp-vds:/tmp/` → `sha256sum -c` + `gunzip -c … | sudo docker load` + arşivi sil; iki uçta imaj kimliği aynı.
4. **Önce yedek:** `sudo docker compose exec -T patron-yedek /arac/yedek-dongusu.sh tek` → merkez + anahtarlar + her tesis dökümü; Mac'e çek, iki uç sha eşit, özel yarıyla aç (`pg_restore --list`), düz kopyaları `rm -P` (§7).
5. **`.env`:** `cp -p .env ~/p9-env-yedek-<eski sha12>`; yerinde yeniden yaz (fark YALNIZ `PATRON_IMAJ` + `PATRON_YEDEK_IMAJ`; sahip/mod/inode aynı) → `sudo docker compose config -q`. Compose dosyasına dokunulmaz (fark yok).
6. **Göç:** §17.4 komutu (eski sunucu çalışırken). Hata → DUR: `up -d` YAPILMAZ, `.env` yedekten geri yazılır (eski kod yeni şemayla çalışır), insana rapor. Göç günlüğü sır taramasından (0 isabet) sonra silinir.
7. **Başlatma:** `sudo docker compose up -d` (~19 sn kesinti; DB dokunulmaz) → `PATRON_DINLIYOR port=4620 kurulumKaynagi=satici web=acik` · hata 0 · `RestartCount` 0.
8. **Sonra ölçüm:** merkez ve her tesis DB'si 10 göç, yarım 0, iki kolon · §6 dış ölçümleri iki adda (`yonetim.` · `patron.`) + yeni: oturumsuz `GET /api/degisim?since=0&bekle=0` 401 `OTURUM_YOK` · tarayıcı dumanı ÜRETİMDE iki adda (CSP 0 · konsol 0 · beacon beyanlı istisna · ikon çizildi) · fabrika eşitlemesi: `sync_state.last_package_at` ilerler, `change_counter` artar · kaynak (`docker stats`).
9. **İmaj temizliği:** VDS'teki en eski çift (`83f837666826`) silinir; yeni + önceki (geri alma) kalır. Önce/sonra `vds-dogrula.sh`.

### 17.7 Geri alma

Göç geri alınmaz; iki kolon DEFAULT'lu ve eski sunucu onları okumaz → eski kod yeni şemayla çalışır. Geri dönüş: `cat ~/p9-env-yedek-<eski sha12> > .env` (önceki `PATRON_IMAJ` / `PATRON_YEDEK_IMAJ`, kayıtlı son `tekserp-patron:e847c7a55f3e`) + `sudo docker compose up -d` (compose değişmediği için compose geri yüklemesi yok; eski imaj VDS'te). Web de eski sürüme döner; v2 istemci eski bulutta `/api/degisim` 404 alıp yoklama kipine düşer. Veri yalnız gerekirse 4. adımdaki yedeklerden (§7, kullanıcı kararı). Sonunda `vds-dogrula.sh` → ✅.
