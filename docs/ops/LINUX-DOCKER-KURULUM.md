# Linux (Docker) kurulum runbook'u — korumalı backend imajı

> Faz 2f (lisans planı). Windows fabrika kurulumu (`deploy/kur.ps1`) bu belgeden ETKİLENMEZ.
> İmaj: `Teks-Erp/docker/korumali/Dockerfile` · kurulum dosyaları: `Teks-Erp/docker/korumali/docker-compose.yml`, `.env.ornek` · teslim: `Teks-Erp/docker/korumali/teslim-paketle.sh` · bekçi: `scripts/test_korumali_imaj.mjs` · kural: `docs/kurallar/deploy-kurulum.md`.

## 0. Ne teslim edilir

| Dosya | Ne |
|---|---|
| `tekserp-korumali_<sürüm>_linux-amd64.tar.gz` | `docker save | gzip -n` — `docker load` açar (yeniden üretilebilir: aynı imaj aynı sha) |
| `docker-compose.yml` · `.env.ornek` | üç servis (postgres 16 · backend · yedek) ve ortam şablonu |
| `PAKET-DOCKER.json` | künye — `tekserp-butunluk` yükü (imzalı kapsam = üç teslim dosyası, liste dosyasının özeti, imaj kimliği, runtime Node/V8, `.jsc` sha256) |
| `butunluk-liste.txt` | imzalı liste (2e-S biçimi `<sha256>\t<boyut>\t<yol>`; imza aracı teslim dosyalarını ölçüp yazar) |
| `PAKET-DOCKER.json.jws` | PAKET anahtarıyla imza (`teslim-paketle.sh` 2e aracıyla atar; anahtar yoksa paket üretilmez — §8) |
| `SHA256SUMS` | `sha256sum -c SHA256SUMS` ile doğrulanır |

İmajın içinde KAYNAK YOK: sunucu V8 bayt kodu (`/app/dist/server.jsc` + yükleyici), araçlar karartılmış tek dosya (`/app/dist/tools/*.cjs`), native lisans çekirdeği (`/app/native/`), prod `node_modules`, Prisma şema motoru `debian-openssl-3.0.x`, migration SQL. Süreç `10001:10001` (root değil); `/app` root'a ait ve salt-okunur; compose kök dosya sistemini salt-okunur açar (`/tmp` tmpfs).

## 1. Önkoşul

- Linux **x86_64**, Docker Engine 24+ ve `docker compose` v2 (başka mimaride öykünmeyle koşar — üretimde kullanılmaz).
- `/etc/machine-id` dolu (systemd'li her dağıtımda var): parmak izinin F1'i buradan gelir (§5).
- Disk: imaj ≈ 1 GB açılmış; veri + yedek için ayrıca pay.

## 2. İlk kurulum

```sh
sha256sum -c SHA256SUMS                         # dört satır da OK olmalı
docker load -i tekserp-korumali_<sürüm>_linux-amd64.tar.gz   # "Loaded image: tekserp-korumali:<etiket>"
cp .env.ornek .env && chmod 600 .env
# .env'i doldur: TEKSERP_IMAJ = load çıktısındaki etiket;
#   POSTGRES_PASSWORD = $(openssl rand -hex 24) · JWT_SECRET = $(openssl rand -hex 48)
#   TEKSERP_DINLE: varsayılan 127.0.0.1 (kapalı doğar) — fabrika ağına açmak için 0.0.0.0 ya da LAN IP'si
SEED_ON_EMPTY=1 docker compose up -d          # ilk ve YALNIZ ilk up: boş şemaya admin seed'i
docker compose logs -f backend                 # [1/3] migration → [2/3] seed → [3/3] "Backend ayakta"
```

- Seed kapısı fail-closed (`Teks-Erp/docker/entrypoint.sh` §2): yalnız `users` tablosu BOŞ ve `SEED_ON_EMPTY=1` iken koşar; dolu DB'de bayrak kalsa da atlar. `SEED_ON_EMPTY` `.env`e YAZILMAZ.
- İlk yönetici (`admin`) sabit parolayla DOĞMAZ (G20): ya ilk `up`a `ILK_YONETICI_PAROLASI='<en az 10 karakter>'` verilir (`.env`e YAZILMAZ — `SEED_ON_EMPTY=1 ILK_YONETICI_PAROLASI='…' docker compose up -d`) ya da verilmezse seed 16 karakterlik rastgele parolayı `docker compose logs backend` çıktısında BİR KEZ basar. İki durumda da ilk girişte panel yeni parola ister (bu yapılmadan tablet girişi 403 alır). Seed `.env`teki `JWT_SECRET` bilinen/zayıf ise reddeder.
- Audit koruması (bir kez): `docker compose exec postgres psql -U tekserp -d tekserp -c "ALTER DATABASE tekserp SET teks.audit_guard = 'on'"` → `docker compose restart backend` (açılış günlüğündeki "KORUMA KAPALI" uyarısı gider).
- Satıcı hesabı (TTY şart): `docker compose exec -it backend node /app/dist/tools/superadmin-olustur.cjs` (2f duman provasında koşulmadı; araç imajda karartılmış olarak VAR).
- Doğrulama: `curl -fsS http://127.0.0.1:4000/health` → `"db":"UP"`; panelde Sistem → Lisans "Gözlem".

## 3. Güncelleme (yeni imaj)

1. Yeni paketi §2'deki gibi doğrula ve `docker load` et.
2. **Önce yedek:** `docker compose run --rm -e YEDEK_SIMDI=1 yedek` → günlükte `OK ...dump.tkenc`.
3. `.env`de `TEKSERP_IMAJ`ı yeni etikete çevir → `docker compose up -d` (backend açılışta `migrate deploy` koşar; migration geri alınamaz eşiktir).
4. `/health` ve panel sürümü (`/api/admin/health` `version`) yeni sürümü gösterir.

**ASLA** `docker compose down -v` (birimleri — veri, lisans, yedek — SİLER), `migrate reset`, elle seed.

## 4. Yedek

- `yedek` servisi `deploy/yedekle.ps1`in ikizidir (`Teks-Erp/docker/korumali/yedek-zamanlayici.sh`): her gün `YEDEK_SAAT`te (Europe/Istanbul) `pg_dump -Fc` → `pg_restore --list` doğrulaması → `.tkenc` şifreleme → saklama (`YEDEK_SAKLAMA_GUN`, en yeni `YEDEK_EN_AZ` korunur). Kaçırılan yedek açılışta telafi edilir (ilk denetim `YEDEK_ILK_BEKLEME` sn sonra). Backend'in kendi zamanlayıcısı imajda KAPALI (`BACKUP_SCHEDULE_ENABLED=false`) — ikisi birden açık kalırsa gece iki döküm.
- **Şifreleme anahtarı (bir kez):** açık yarı `yedek_anahtar` birimine, özel yarı sunucu DIŞINA:
  `docker compose run --rm --no-deps -v <proje>_yedek_anahtar:/k -v "$PWD/ozel":/ozel backend node /app/dist/tools/yedek-sifrele.cjs anahtar-uret --ad <ad> --dizin /k --ozel-cikti /ozel/<ad>.tkkey` → `ozel/<ad>.tkkey` kâğıda/USB'ye, sunucudan silinir. Alıcı yoksa yedek DÜZ alınır ve günlüğe `HATA SIFRELENEMEDI` düşer (yedeksiz kalmaktan iyidir).
- Günlük: `docker compose logs yedek` ve birimdeki `backup.log`; panel Yedekler ekranı aynı birimi okur (`backupHealth`).
- Doğrulama: `... backend node /app/dist/tools/yedek-sifrele.cjs dogrula --girdi /var/lib/tekserp/yedek/<x>.dump.tkenc --anahtar /ozel/<ad>.tkkey` → `butunluk TAMAM`.
- Makine dışı kopya: `yedek` birimini (yalnız `.tkenc`) başka diske/sunucuya düzenli kopyalayın; anahtar birimi AYRI tutulur.

## 5. Lisans ve parmak izi

- Motor derleme varsayılanıyla **gözlem** kipinde açılır (hiçbir istek engellenmez). Etkinleştirme panelden (Sistem → Lisans); satıcı adresi `.env` `LICENSE_SERVER_URL`: boş = üretim lisans sunucusu (`https://lisans.etkiliyazilim.com`), `kapali` = dışarı hiç çıkılmaz, biçimsiz değer = adres yok (`Teks-Erp/src/lib/license/vendor-url.ts`); etkinleştirilmemiş kurulum her durumda dışarı istek atmaz.
- Lisans deposu `lisans` biriminde (`LICENSE_DIR=/var/lib/tekserp/lisans`, 0700). **Kopyalanmaz** — başka makineye taşınan kopya parmak izini tutturmaz; taşıma satıcı akışıyla (taşıma kodu).
- Konteynerde ölçülebilen etkenler: **F1** konağın `/etc/machine-id`'si (salt-okunur bağlanır; imaj kendi makine kimliğini TAŞIMAZ) · **F5** PostgreSQL `system_identifier` (`pg_data` birimi). **F2/F4** (DMI: `product_uuid`, `product_serial`/`board_serial`) servis kullanıcısına kapalı (root-only) ve **F3** (disk seri) overlay kök dosya sisteminde görünmez → üçü "ölçülemedi" beyan edilir, uyuşmazlık SAYILMAZ (`docs/design/LISANS-PROTOKOLU.md` karar kuralı). Konteyner sınıfında koruma = çevrimiçi tek etkin kurulum + konak makine kimliği.
- Ölçüm: duman provasında `GET /api/license/detay` → `parmakIzi.olculen = {f1:true, f2:false, f3:false, f4:false, f5:true}`.

## 6. Geri alma

- Uygulama: `.env` `TEKSERP_IMAJ`ı önceki etikete çevir → `docker compose up -d`. Yalnız yeni imaj migration İÇERMİYORSA güvenlidir.
- Migration uygulandıysa geri alma = **yedekten restore** (kök kural): backend'i durdur (`docker compose stop backend yedek`), §3.2'de alınan dökümü çöz (`yedek-sifrele.cjs coz`), `pg_restore --clean --if-exists` ile geri yükle, önceki imajla `up -d`. Tatbikat: `docs/ops/YEDEK-GERI-YUKLEME-TATBIKATI.md`.

## 7. Ağ ve güvenlik notları

- Postgres portu dışarı açılmaz (yalnız compose ağı). Backend portu varsayılan `127.0.0.1`e bağlanır.
- Docker köprüsü istemci adresini NAT'lar (giriş kilidi köprü adresini görür). Uzak erişim tüneli 2026-09-30'da emekli (B6); patron erişimi patron bulutundandır.
- Servisler `cap_drop: ALL`, `no-new-privileges`, salt-okunur kök ile koşar; yazılabilir yerler yalnız birimler + `/tmp`.
- Web paneli (`WEB_DIST_DIR`) bu imajda YOK: panel Electron'dan ve tabletten bağlanır; `/` durum sayfasıdır.

## 8. İmza

- İmzalanan yük `PAKET-DOCKER.json`un TAMAMIDIR: `tekserp-butunluk` (`Teks-Erp/src/lib/license/integrity.ts` `IntegrityManifestSchema` — `v`, `paketId`, `urun: "backend-docker"`, `surum`, `derlemeTarihi`, `musteri`, `kapsam {dizinler: [], dosyalar: [<tar.gz>, docker-compose.yml, .env.ornek]}`, `liste {sha256, boyut, dosyaSayisi}`; ek alanlar `imaj`, `sunucu`, `commit` imzanın kapsamında). `teslim-paketle.sh` yalnız kapsamı yazar; imza aracı kapsamdaki dosyaları ölçer, `butunluk-liste.txt`i yazar, `liste` alanını künyeye koyar (2e-S biçimi, I6); kapsamdaki dosya eksikse imza atılmaz.
- İmza: PAKET anahtarı, JWS EdDSA, `typ` = `tekserp-butunluk` → `PAKET-DOCKER.json.jws`. `teslim-paketle.sh` künyeyi yazdıktan sonra 2e aracını çağırır (`npx tsx Teks-Erp/scripts/build-korumali-imza.ts belge --belge=<çıktı>/PAKET-DOCKER.json --anahtar=<dosya>`); anahtar `TEKSERP_PAKET_ANAHTARI` ile AÇIKÇA verilir, varsayılan yol yoktur (verilmezse betik durur; üretim anahtarı PAKET sertifikalı `pkt-*` zincirinden, 3.9 D5/D8); künye müşteri taşımaz. Anahtar yalnız Mac'te, CI'a girmez; anahtar yoksa ya da öz-denetim düşerse paket ÜRETİLMEZ. `.jws` ve `butunluk-liste.txt` SHA256SUMS'a girer (bekçi `test_docker_hijyeni` §5c · `test_lisans_butunluk` §6).
- Doğrulama sırası (kurulumda, `docker load`dan ÖNCE): JWS'i gömülü PAKET açık anahtarıyla doğrula → `butunluk-liste.txt`in boyu/özeti imzalı `liste`yle → listedeki her dosyanın sha256'sı → `imaj.arsiv` ≡ yüklenecek tar. Doğrulayıcı bugün native çekirdekte (`verifyIntegrity`); imaj DIŞINDA koşacak bir doğrulama aracı 2e ile birlikte tanımlanır.
- İmaj İÇİ bütünlük listesi (açılışta + günlük): 2e'nin biçimiyle aynı belge `/app` ağacı için üretilir; imzalı liste imaja ince bir son katman olarak eklenir (derle → listeyi dışa ver → Mac imzalar → `FROM <imaj>` + `COPY` → yeni etiket). Bugün uygulanmadı — borç.
