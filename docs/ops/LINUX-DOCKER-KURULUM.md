# Linux (Docker) kurulum runbook'u — korumalı backend imajı

> Faz 2f (lisans planı). Windows fabrika kurulumu (`deploy/kur.ps1`) bu belgeden ETKİLENMEZ.
> İmaj: `Teks-Erp/docker/korumali/Dockerfile` · kurulum dosyaları: `Teks-Erp/docker/korumali/docker-compose.yml`, `.env.ornek` · teslim: `Teks-Erp/docker/korumali/teslim-paketle.sh` · bekçi: `scripts/test_korumali_imaj.mjs` · kural: `docs/kurallar/deploy-kurulum.md`.

## 0. Ne teslim edilir

Teslim TEK dosyadır: `tekserp-backend-oci-<sürüm>.tar` (sıkıştırılmamış dış tar, üyeler düz ad; biçimin tek kaynağı `Teks-Erp/scripts/lib/oci-paket.ts`, `GUNCELLEYICI.md` §16 madde 9). Önce `tar -xf tekserp-backend-oci-<sürüm>.tar` ile boş bir dizine açılır; üyeleri:

| Dosya | Ne |
|---|---|
| `tekserp-korumali_<sürüm>_linux-amd64.tar.gz` | İMZALI imajın `docker save | gzip -n`'i — `docker load` açar (yeniden üretilebilir: aynı imaj aynı sha); imaj `/app`te kendi imzalı bütünlük listesini taşır (label `tr.tekserp.butunluk=<kid>`, §8); imzasız taban teslim edilmez |
| `docker-compose.yml` · `.env.ornek` | üç servis (postgres 16 · backend · yedek) ve ortam şablonu — `docker-compose.yml` GÜNCELLEYİCİLİ düzenin şablonudur (`docker-compose.guncelleyici.yml`, sürüm dolu: imaj `tekserp-korumali:<sürüm>`, açılışta göç YOK, güncelleme dizini bağları); ⚠ güncelleyicisiz elle kurulum (§2–§3) bu dosyayla açılmaz — elle kurulum depodaki `Teks-Erp/docker/korumali/docker-compose.yml`i kullanır; güncelleyicili düzen `kur` (yeni kurulum) ya da `gecis` (elle kurulumdan, §11) ile kurulur |
| `tekserp-guncelleyici` · `guncelleyici-kunye.json` | Linux güncelleyicisi (linux-x64 ELF, CI işi `guncelleyici-linux`; konakta `libssl3` ister — §1) ve künyesi — künye paketlemede imajın içinde ikiliden yeniden ölçülür |
| `PAKET-DOCKER.json` | künye — `tekserp-butunluk` yükü (imzalı kapsam = beş teslim dosyası, `platform: linux-x64-oci`, göç sayısı, güncelleyici sürüm/sha256, liste dosyasının özeti, imaj kimliği, runtime Node/V8, `.jsc` sha256) |
| `butunluk-liste.txt` | imzalı liste (2e-S biçimi `<sha256>\t<boyut>\t<yol>`; imza aracı teslim dosyalarını ölçüp yazar) |
| `PAKET-DOCKER.json.jws` | PAKET anahtarıyla imza (`teslim-paketle.sh` 2e aracıyla atar; anahtar yoksa paket üretilmez — §8) |
| `SHA256SUMS` | `sha256sum -c SHA256SUMS` ile doğrulanır |

İmajın içinde KAYNAK YOK: sunucu V8 bayt kodu (`/app/dist/server.jsc` + yükleyici), araçlar karartılmış tek dosya (`/app/dist/tools/*.cjs`), native lisans çekirdeği (`/app/native/`) ve onu yükleten imaj içi imzalı liste (`/app/butunluk-liste.txt` + `butunluk-zincir.jws` ya da `butunluk.jws`), prod `node_modules`, Prisma şema motoru `debian-openssl-3.0.x`, migration SQL. Süreç `10001:10001` (root değil); `/app` root'a ait ve salt-okunur; compose kök dosya sistemini salt-okunur açar (`/tmp` tmpfs).

## 1. Önkoşul

- Linux **x86_64**, Docker Engine 24+ ve `docker compose` v2 (başka mimaride öykünmeyle koşar — üretimde kullanılmaz).
- Güncelleyicili düzende konakta `libssl3` (OpenSSL 3; Ubuntu 22.04+ / Debian 12+ varsayılanı): paketteki `tekserp-guncelleyici` konakta koşar ve `libssl.so.3`e dinamik bağlıdır (glibc tabanı Ubuntu 22.04). Denetim: `ldd ./tekserp-guncelleyici | grep libssl.so.3`.
- `/etc/machine-id` dolu (systemd'li her dağıtımda var): parmak izinin F1'i buradan gelir (§5). Mac'teki (Docker Desktop) provada konakta bu dosya YOKTUR: `.env`e `TEKSERP_MAKINE_KIMLIGI=<geçici dosyanın mutlak yolu>` yazılır (yalnız prova; gerçek kurulumda boş kalır).
- Disk: imaj ≈ 1 GB açılmış; veri + yedek için ayrıca pay.
- **Bu yol fabrika ağı kurulumu DEĞİLDİR:** Docker kurulumunda fabrika ağı TLS'i yok, yalnız şifreli bağlanan panel ve tablet fabrika ağından bağlanamaz (§7). Fabrika içi kurulum Windows yoludur (`deploy/kur.ps1`).

## 2. İlk kurulum

```sh
tar -xf tekserp-backend-oci-<sürüm>.tar        # boş bir dizinde
sha256sum -c SHA256SUMS                         # sekiz satır da OK olmalı
docker load -i tekserp-korumali_<sürüm>_linux-amd64.tar.gz   # "Loaded image: tekserp-korumali:<etiket>"
cp .env.ornek .env && chmod 600 .env
# .env'i doldur: TEKSERP_IMAJ = load çıktısındaki etiket;
#   POSTGRES_PASSWORD = $(openssl rand -hex 24) · JWT_SECRET = $(openssl rand -hex 48)
#   TEKSERP_DINLE: 127.0.0.1 KALIR (§7 — 0.0.0.0 yazılmaz)
read -rs -p 'İlk yönetici parolası (en az 10 karakter): ' ILK_YONETICI_PAROLASI; echo; export ILK_YONETICI_PAROLASI
SEED_ON_EMPTY=1 docker compose up -d          # ilk ve YALNIZ ilk up: boş şemaya admin seed'i
unset ILK_YONETICI_PAROLASI
docker compose logs -f backend                 # [1/3] migration → [2/3] seed → [3/3] "Backend ayakta"
```

**Seed'den hemen sonra parolayı konteynerden temizle (zorunlu):** ilk `up`a verilen `ILK_YONETICI_PAROLASI` konteyner YENİDEN YARATILANA kadar ortamında durur ve `docker inspect` ile okunur; parola verilmediyse seed'in bastığı rastgele parola da o konteynerin günlüğünde (`docker compose logs`) kalır. Bayraksız `up -d` ortam değiştiği için backend'i yeniden yaratır (eski konteyner günlüğüyle birlikte silinir). Rastgele parola yolunda önce parolayı günlükten al ve ilk girişte değiştir, sonra bu adımı uygula.

```sh
grep -cE '^(SEED_ON_EMPTY|ILK_YONETICI_PAROLASI)=' .env   # 0 olmalı; değilse o satırları .env'den sil
docker compose up -d                                       # bayraksız: "Recreate … backend" görünür
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$(docker compose ps -q backend)" \
  | awk -F= '$1=="SEED_ON_EMPTY"{print} $1=="ILK_YONETICI_PAROLASI"{print $1, "uzunluk", length($2)}'
# beklenen: SEED_ON_EMPTY=0 · ILK_YONETICI_PAROLASI uzunluk 0 (parola ekrana basılmaz)
```

- Seed kapısı fail-closed (`Teks-Erp/docker/entrypoint.sh` §2): yalnız `users` tablosu BOŞ ve `SEED_ON_EMPTY=1` iken koşar; dolu DB'de bayrak kalsa da atlar. `SEED_ON_EMPTY` `.env`e YAZILMAZ.
- İlk yönetici (`admin`) sabit parolayla DOĞMAZ (G20): ya ilk `up`a `ILK_YONETICI_PAROLASI` (en az 10 karakter) kabuktan `read -rs` ile verilir — `.env`e ve komut satırına YAZILMAZ (komut geçmişine düşer) — ya da verilmezse seed 16 karakterlik rastgele parolayı `docker compose logs backend` çıktısında BİR KEZ basar. İki durumda da ilk girişte panel yeni parola ister (bu yapılmadan tablet girişi 403 alır). Seed `.env`teki `JWT_SECRET` bilinen/zayıf ise reddeder.
- Audit koruması (bir kez): `docker compose exec postgres psql -U tekserp -d tekserp -c "ALTER DATABASE tekserp SET teks.audit_guard = 'on'"` → `docker compose restart backend` (açılış günlüğündeki "KORUMA KAPALI" uyarısı gider).
- Satıcı hesabı (TTY şart): `docker compose exec -it backend node /app/dist/tools/superadmin-olustur.cjs` (2f duman provasında koşulmadı; araç imajda karartılmış olarak VAR).
- Doğrulama: `curl -fsS http://127.0.0.1:4000/health` → `"db":"UP"`; panelde Sistem → Lisans "Gözlem".
- Yerel sağlık (`/health/yerel`, lisans kademesi + bütünlük + çekirdek) yalnız konteynerin KENDİ döngü adresine cevap verir; konaktan `curl` Docker köprüsünden geldiği için 404 alır (tasarım gereği). Konteyner içinden ölçülür:
  `docker compose exec backend node -e "fetch('http://127.0.0.1:4000/health/yerel').then(async r=>console.log(r.status, await r.text()))"` → `200 … "db":"UP" … "lisans":{"kip":…,"butunluk":…,"cekirdek":…}`. İmzalı imajda beklenen `"cekirdek":"native"` ve `"butunluk":"GECERLI"`dir (§8 son madde); `cekirdek: yok` / `butunluk: GECERSIZ` görülürse imaj imzasız tabandır ya da `/app` değişmiştir — etkinleştirme yapılmaz, paket satıcıya geri bildirilir.

## 3. Güncelleme (yeni imaj)

1. Yeni paketi §2'deki gibi doğrula ve `docker load` et.
2. **Önce yedek:** `docker compose run --rm -e YEDEK_SIMDI=1 yedek` → günlükte `OK ...dump.tkenc` (şifreleme anahtarı henüz kurulmadıysa `OK ...dump` + `HATA SIFRELENEMEDI` — §4). Geri alma ölçüsü için eski etiketi (`grep ^TEKSERP_IMAJ= .env`) ve göç sayısını not et: `docker compose exec postgres psql -U tekserp -d tekserp -Atc 'select count(*) from _prisma_migrations'`.
3. **Compose dosyalarını hizala.** Paketteki `docker-compose.yml` güncelleyicili şablondur (§0) ve elle kuruluma KOPYALANMAZ: açılışta göç etmez ve olmayan `/var/lib/tekserp/guncelleme/{durum,niyet}` bağlarını ister (`create_host_path: false`), bu yüzden backend açılmaz. Elle kurulumun dosyaları, paketin `PAKET-DOCKER.json` `commit`indeki depodan alınır: `git show <commit>:Teks-Erp/docker/korumali/docker-compose.yml`. Bulutta `docker-compose.bulut-ornek.yml` dosyası `docker-compose.override.yml` adıyla konur (§10). Eski dosyalar ve `.env` `*.yedek-<damga>` adıyla saklanır. `.env.ornek`e yeni eklenen anahtarlar `.env`e de eklenir. Sonra `docker compose config` çıktısı eskisiyle karşılaştırılır: yalnız beklenen ortam satırları değişmeli (sırlar ekrana basılmaz). Bu adım atlanırsa yeni sürümün compose'a eklediği ortam değişkenleri backend'e HİÇ ulaşmaz; deneme VDS'te 2.14 → 2.15 güncellemesinde `TEKSERP_KURULUM_SINIFI` ve `TEKSERP_SUNUCU_ADI` bu yüzden eksik kaldı. Geri almak için `.yedek-` kopyaları yerine konur ve `docker compose up -d` koşulur.
4. `.env`de `TEKSERP_IMAJ`ı yeni etikete çevir → `docker compose up -d` (backend açılışta `migrate deploy` koşar; migration geri alınamaz eşiktir).
5. `/health` ve panel sürümü (`/api/admin/health` `version`) yeni sürümü gösterir.

**Göç aracı ve güncelleyicili düzen.** Göç tek başına da koşar: `docker compose run --rm --no-deps backend goc` (göç + şema denetimi, sunucu AÇMAZ; sonunda `GOC_TAMAM`, düşerse `Teks-Erp/docker/korumali/acilis-kodlari.json`daki kodla çıkar; `goc` bağı L5 sonrası imajlarda). Güncelleyicinin yönettiği kurulum ayrı şablonla açılır (`docker-compose.guncelleyici.yml`; tasarım `docs/design/GUNCELLEYICI-SAGLAMLIK.md` §1.2): orada backend açılışta göç ETMEZ (`TEKSERP_GOC_ACILISTA=0`), imajın göç kümesi veritabanınınkine eşit değilse açılmaz, ve `TEKSERP_GUNCELLEME_DIZINI=/var/lib/tekserp/guncelleme` ÜRETİM değeridir (geliştirme/test değil). Bu dosyadaki elle kurulum bugünkü gibi açılışta göçer.

**ASLA** `docker compose down -v` (birimleri — veri, lisans, yedek — SİLER; lisans gider → §9), `migrate reset`, elle seed.

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
- Konteynerde ölçülebilen etkenler: **F1** konağın `/etc/machine-id`'si (salt-okunur bağlanır; imaj kendi makine kimliğini TAŞIMAZ) · **F5** PostgreSQL `system_identifier` (`pg_data` birimi). **F2/F4** (DMI: `product_uuid`, `product_serial`/`board_serial`) servis kullanıcısına kapalı (root-only) ve **F3** (disk seri) overlay kök dosya sisteminde görünmez → üçü "ölçülemedi" beyan edilir ve paydadan çıkar (uyuşmazlık sayılmaz). Ama okunabilen yalnız İKİ etken kalır ve ikisi de güçlü değildir: bu **zayıf tanımadır** (okunabilen < 3 ya da okunabilen güçlü < 2 — `docs/design/LISANS-PROTOKOLU.md` K8, `docs/kurallar/lisans.md`). Konteyner sınıfında koruma = çevrimiçi tek etkin kurulum + konak makine kimliği.
- **Etkinleştirme sırası (panel, Sistem → Lisans):** ① ilk girişte parola değişimi (§2) · ② "Lisans sözleşmesi" kartında sözleşme kabulü (Ek-7; kabulsüz etkinleştirme satıcıda RED) · ③ etkinleştirme kodu → Etkinleştir · ④ konteynerde ilk denemenin BEKLENEN cevabı **409 `ZAYIF_TANIMA_ONAY_BEKLIYOR`** ("Bu sunucunun donanımı yeterince tanınamadı; etkinleştirme satıcı onayı bekliyor…"). Kod ve nonce TÜKETİLMEZ: satıcı portalda bu kurulumun zayıf tanımasını onaylar, kurulumcu AYNI kodla yeniden Etkinleştir'e basar. Onaylı kira `parmakIziKurali: zayif` taşır; eşleşen ≥ min(3, okunabilen) = 2, yani iki etkenin İKİSİ de tutmalıdır.
- Bu yüzden etkinleştirmeden SONRA konağın `/etc/machine-id`'si değiştirilmez ve `pg_data` birimi silinmez ya da yeniden yaratılmaz (F5 = PostgreSQL kümesinin kimliği; yedekten geri yükleme aynı kümeye yapıldığı için F5'i değiştirmez — §6). Bulut sunucusunda sağlayıcı şablonundan gelen `/etc/machine-id` etkinleştirmeden ÖNCE tazelenir (`docs/design/BULUT-KURULUM.md` §1.4).
- Ölçüm: duman provasında `GET /api/license/detay` → `parmakIzi.olculen = {f1:true, f2:false, f3:false, f4:false, f5:true}`.
- ⚠️ **Etkinleştirme yalnız imzalı imajla:** native çekirdek ZORUNLU derlenir (`server-kunye.json` `nativeZorunlu: true`) ve zorunlu kipte `.node` yalnız `/app`teki imzalı listeyle yüklenir (§8 son madde). İmzalı imajda `/health/yerel` `cekirdek: native`, `butunluk: GECERLI` döner ve yukarıdaki etkinleştirme sırası uygulanır. `cekirdek: yok` görülürse (imzasız taban ya da değişmiş `/app`) motor HAK/kira/parmak izi doğrulamalarında `CEKIRDEK_YOK` döner — etkinleştirme denenmez, kurulum gözlem kipinde kalır.

## 6. Geri alma

- **Yeni imaj göç İÇERMİYORSA** (göç sayısı §3.2'deki notla aynı): `.env` `TEKSERP_IMAJ`ı önceki etikete çevir → `docker compose up -d`.
- **Göç uygulandıysa geri alma = yedekten geri yükleme (kök kural) ve şema ÖNCE sıfırlanır.** `pg_restore --clean --if-exists` YETMEZ: yalnız dökümde OLAN nesneleri düşürür; yeni göçün eklediği tablo, tür ve dizinler yerinde kalır. Eski tablolara bağlı yeni bir yabancı anahtar varsa o tablonun düşürülmesi de durur ve geri yükleme yarım kalır. Kalan nesneler bir sonraki güncellemede aynı göçü "zaten var" hatasıyla düşürür. Doğru yol `docs/design/BULUT-KURULUM.md` §4.4'teki `GOC` telafisidir: çöz → `public` şemasını sıfırla → `pg_restore` → göç sayısı = önceki. Şema yalnız döküm çözülüp okunabildiği ölçüldükten SONRA sıfırlanır; sıfırlama + geri yükleme, doğrulanmış güncelleme öncesi yedekle yapılan geri yüklemenin kendisidir (`migrate reset` ya da elle seed DEĞİL).

```sh
docker compose stop backend yedek                       # bulutta kenar da (§10)
# özel anahtar geçici olarak ozel/ altına (sahibi 10001, 0600 — §4)
docker compose run --rm --no-deps -v "$PWD/ozel":/ozel:ro backend node /app/dist/tools/yedek-sifrele.cjs \
  coz --girdi /var/lib/tekserp/yedek/<güncelleme-öncesi>.dump.tkenc --cikti /var/lib/tekserp/yedek/geri.dump --anahtar /ozel/<ad>.tkkey
docker compose run --rm --no-deps yedek pg_restore --list /var/lib/tekserp/yedek/geri.dump | grep -c TABLE   # > 0 değilse DUR
docker compose exec postgres psql -U tekserp -d tekserp -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE' -c 'CREATE SCHEMA public'
docker compose run --rm --no-deps yedek pg_restore --no-owner -d tekserp /var/lib/tekserp/yedek/geri.dump   # uyarıları sakla
docker compose run --rm --no-deps yedek rm -f /var/lib/tekserp/yedek/geri.dump
docker compose exec postgres psql -U tekserp -d tekserp -Atc 'select count(*) from _prisma_migrations' -c 'show teks.audit_guard'
# göç sayısı §3.2'deki notla AYNI, audit_guard 'on' (veritabanı ayarı şema sıfırlamasından etkilenmez)
sed -i "s|^TEKSERP_IMAJ=.*|TEKSERP_IMAJ=<önceki etiket>|" .env && docker compose up -d
shred -u ozel/<ad>.tkkey
```

- Veritabanı silinip yeniden yaratılmaz (`dropdb`/`createdb`): veritabanı düzeyi ayarlar (`teks.audit_guard`) onunla gider. Küme (`pg_data` birimi) hiçbir durumda yeniden yaratılmaz (lisansın F5'i — §5).
- Bu telafiyi otomatik yapacak Docker güncelleyicisi (`docs/design/BULUT-KURULUM.md` §4) yazılmadı — borç; o gelene dek geri alma bu elle adımlardır. Tatbikat: `docs/ops/YEDEK-GERI-YUKLEME-TATBIKATI.md`.

## 7. Ağ ve güvenlik notları

- **API portu (4000) yalnız `127.0.0.1`de yayımlanır; `TEKSERP_DINLE` değiştirilmez.** Port şifresizdir ve Docker'ın yayımladığı port konağın güvenlik duvarının (ufw) ÖNÜNDEN geçer: `0.0.0.0` yazılırsa 4000 ufw "kapalı" dese bile bütün ağa — bulutta bütün internete — şifresiz açılır. Yeni kurulumun yalnız şifreli olması kuralı (`docs/kurallar/deploy-kurulum.md`, 2026-10-08) Docker'da da geçerlidir.
- **Docker kurulumunda fabrika ağı TLS'i (LAN TLS) YOK:** compose `LAN_TLS_MODE` geçirmez; 4443 yayını ve sertifika birimi yoktur. Bu yüzden yalnız şifreli bağlanan panel (1.6.0+) ve tablet (vc60+) fabrika ağındaki bir Docker kurulumuna **bağlanamaz**. Fabrika içi kurulum Windows yoludur (`deploy/kur.ps1`, `LAN_TLS_MODE=required`). Docker kurulumuna ağdan yalnız TLS'i sonlandıran bir vekil üzerinden bağlanılır; bizim yönettiğimiz bulut sunucusu için kalıp §10'dadır.
- **Vekil arkasında** `.env`e `TRUST_PROXY=1` ve `RATE_LIMIT_ENABLED=true` yazılır (compose ikisini de backend'e geçirir; §10 örneği kendisi koyar). Yazılmazsa Docker köprüsü ve vekil bütün istemcileri TEK adres gösterir: bir kişinin hatalı girişi herkesi kilitler, hız sınırı da kapalı kalır. `TRUST_PROXY=1` yalnız port `127.0.0.1`deyken ve vekil `X-Forwarded-For`u gerçek adresle EZERKEN güvenlidir. `true` istemcinin yazdığı başlığa güvenir; backend bu durumda uyarı basar. Vekilsiz kurulumda ikisi de boş kalır (bugünkü davranış).
- Postgres portu dışarı açılmaz (yalnız compose ağı). Uzak erişim tüneli 2026-09-30'da emekli (B6); patron erişimi patron bulutundandır.
- Servisler `cap_drop: ALL`, `no-new-privileges`, salt-okunur kök ile koşar; yazılabilir yerler yalnız birimler + `/tmp`.
- Web paneli (`WEB_DIST_DIR`) bu imajda YOK: panel Electron'dan ve tabletten bağlanır; `/` durum sayfasıdır.

## 8. İmza

- İmzalanan yük `PAKET-DOCKER.json`un TAMAMIDIR: `tekserp-butunluk` (`Teks-Erp/src/lib/license/integrity.ts` `IntegrityManifestSchema` — `v`, `paketId`, `urun: "backend-docker"`, `surum`, `derlemeTarihi`, `musteri`, `kapsam {dizinler: [], dosyalar: [<tar.gz>, docker-compose.yml, .env.ornek, tekserp-guncelleyici, guncelleyici-kunye.json]}`, `liste {sha256, boyut, dosyaSayisi}`; ek alanlar `platform`, `gocSayisi`, `imaj`, `sunucu`, `guncelleyici`, `commit` imzanın kapsamında). `teslim-paketle.sh` yalnız kapsamı yazar; imza aracı kapsamdaki dosyaları ölçer, `butunluk-liste.txt`i yazar, `liste` alanını künyeye koyar (2e-S biçimi, I6); kapsamdaki dosya eksikse imza atılmaz.
- İmza: PAKET anahtarı, JWS EdDSA, `typ` = `tekserp-butunluk` → `PAKET-DOCKER.json.jws`. `teslim-paketle.sh` künyeyi yazdıktan sonra 2e aracını çağırır (`npx tsx Teks-Erp/scripts/build-korumali-imza.ts belge --belge=<çıktı>/PAKET-DOCKER.json --anahtar=<dosya>`); anahtar `TEKSERP_PAKET_ANAHTARI` ile AÇIKÇA verilir, varsayılan yol yoktur (verilmezse betik durur; üretim anahtarı PAKET sertifikalı `pkt-*` zincirinden, 3.9 D5/D8); künye müşteri taşımaz. Anahtar yalnız Mac'te, CI'a girmez; anahtar yoksa ya da öz-denetim düşerse paket ÜRETİLMEZ. `.jws` ve `butunluk-liste.txt` SHA256SUMS'a girer (bekçi `test_docker_hijyeni` §5c · `test_lisans_butunluk` §6).
- Doğrulama sırası (kurulumda, `docker load`dan ÖNCE): JWS'i gömülü PAKET açık anahtarıyla doğrula → `butunluk-liste.txt`in boyu/özeti imzalı `liste`yle → listedeki her dosyanın sha256'sı → `imaj.arsiv` ≡ yüklenecek tar. Doğrulayıcı bugün native çekirdekte (`verifyIntegrity`); imaj DIŞINDA koşacak bir doğrulama aracı 2e ile birlikte tanımlanır.
- İmaj İÇİ bütünlük listesi (açılışta + günlük native denetimde): akış **imzasız taban → `imaj-imzala.mjs` → ince son katman**.
  1. Taban: müşteriye giden (üretim imzalı) taban YALNIZ CI'da doğar — `gh workflow run korumali-paket.yml --ref main`, iş `docker-linux-x64` (bkz. madde 4). Yerel derleme (`docker buildx build --platform linux/amd64 -f Teks-Erp/docker/korumali/Dockerfile --build-arg TEKSERP_COMMIT=$(git rev-parse HEAD) -t tekserp-korumali:<sürüm>-imzasiz --load .`) yalnız prova/test anahtarı içindir; Mac'te amd64 imaj derlenmez.
  2. İmza (Mac, PAKET anahtarı): `TEKSERP_PAKET_ANAHTARI=<anahtar> node Teks-Erp/docker/korumali/imaj-imzala.mjs tekserp-korumali:<sürüm>-imzasiz tekserp-korumali:<sürüm> [imza bayrakları]`. Betik `/app`i tabandan dışa verir, Windows korumalı paketinin AYNI aracını ve kapsamını çağırır (`build-korumali-imza.ts imzala --urun=backend-docker`, kapsam `integrity-scope.ts`), `butunluk-liste.txt` + `butunluk-zincir.jws` (`pkt-*`) ya da `butunluk.jws` (`paket-*`) yazar ve ikisini `FROM <taban>` + `COPY` (root, 0644) ile tek katman olarak ekler; label `tr.tekserp.butunluk=<kid>`. Parolayı yalnız imza aracı okur: `--parola-dosyasi` > Anahtar Zinciri kasası `tekserp/paket` (`scripts/lib/parola-kasasi.mjs`) > TTY > stdin.
  3. Öz-denetim: imzalı imajda, ağsız, salt-okunur kök ve `10001` kullanıcısıyla imajın KENDİ native çekirdeği her imzalı yükü `/app`e karşı doğrular; `GECERLI` değilse imzalı etiket silinir. Ardından `scripts/test_korumali_imaj.mjs --imaj=<…> --imzali` (K8 etiket + liste/yük, K9 `node_modules/.bin` yok). `teslim-paketle.sh` yalnız bu etiketli imajı paketler, künyeye `imaj.butunlukKid` yazar.
  4. Derleme kökeni (resmî yol): üretim kid'inde (`paket-*` / `pkt-*`) imza aracı CI kökeni ister.
     - CI: `korumali-paket.yml` işi `docker-linux-x64` (sırsız, `contents: read`) üretim çapalı native'i derler (`derle:linux:uretim`), tabanı `TEKSERP_COMMIT=github.sha` ile kurar, taban bekçisini koşar, `docker save | gzip -n` arşivini ve arşivden ölçülen künyeyi (`imaj-kunye.json`: commit · runId · runAttempt · surum · platform · configOzeti · diffIds · native/arşiv sha256) iki yapıt olarak yükler (`korumali-imaj-linux-x64`, `korumali-imaj-kunye-linux-x64`; 7 gün).
     - Mac: `gh run download <koşu> -n korumali-imaj-linux-x64` → `gunzip -c tekserp-korumali-imzasiz-linux-x64.tar.gz | docker load` → `imaj-imzala.mjs <taban> <imzalı> --ci-kosu=<koşu>`.
     - `--ci-kosu` PAROLA SORULMADAN ÖNCE: künye o koşudan indirilir, yerel taban `docker save` ARŞİVİNDEN ölçülür (`.Id` değil) ve `imaj-kokeni.mjs` hükmü verilir (künye koşusu = `--ci-kosu`, commit = koşunun commit'i = revision etiketi, diffIds + config özeti eşit, `linux/amd64`); tutmazsa ya da ölçülemezse RED. Ardından imza aracı koşuyu ölçer (iş akışı adı/yolu, `main` dalı, başarı, commit = `/app/dist/server-kunye.json`) ve imzalı yüke `ciKokeni {kip:"kosu"}` yazar.
     - Koşu `main`de ve TAMAMEN yeşil olmalı. İlk kullanım: 2026-10-10, koşu 38001714022, commit `20e3c6085`, imaj `tekserp-korumali:2.15.0` (`--ci-atla` gerekmedi).
     - `--ci-atla="<kullanıcının cümlesi>"` yalnız kullanıcının açık kararıyla kaçıştır. Prova: `node scripts/agir-is.mjs -- node Teks-Erp/docker/korumali/prova-imaj-butunluk.mjs` (test kökü, zincir-yalnız; dört negatif).
  5. Teslim paketi: `TEKSERP_PAKET_ANAHTARI=<anahtar> sh Teks-Erp/docker/korumali/teslim-paketle.sh tekserp-korumali:<sürüm> <güncelleyici-dizini> <çıktı-dizini>` — `<güncelleyici-dizini>` CI yapıtı `guncelleyici-linux-x64` (`tekserp-guncelleyici` + `guncelleyici-kunye.json`); etiket TAM `tekserp-korumali:<sürüm>` olmalı (compose onu ister), imzasız taban reddedilir (`test_korumali_imaj.mjs --imzali`). Çıktı repo DIŞI `tekserp-backend-oci-<sürüm>.tar` (ustar, sahip 0:0, Mac meta verisi yok); var olan paket EZİLMEZ.
  6. İmaj kimliği = CONFIG ÖZETİ, arşivden ölçülür (`npx tsx Teks-Erp/scripts/backend-bildirim.ts imaj-kimlik --arsiv=<imaj .tar.gz>`). `docker image inspect` `.Id`si KULLANILMAZ: containerd deposunda (Docker 29 varsayılanı) index özetidir.
  7. Yayın (kanal başına, yalnız Mac): `node deploy/backend-yayinla.mjs --grup=<grup> --urun=backend-oci --paket=<tar> --kuru` — bildirim aracı dış künyeyi, güncelleyici künyesini ve imajı ölçer; imzasız taban (label yok · son katman ince imza katmanı değil · imzalı liste/yük yok) DURUR. Gerçek yükleme `--kuru` olmadan aynı komutla (`YENI_ADRES_KAPISI` 3.9 D8 ile açık); `oncu`/`genel` terfisinde kaynak grubun `backend-oci/<sürüm>/` paketi bayt-eşit olmalı.

## 9. Birimler, kaldırma ve baştan kurma

> ⚠️ **`docker compose down -v` KURULUMU SİLER — LİSANS DAHİL.** `-v` dört kalıcı birimin dördünü de siler: `<proje>_pg_data` (bütün veri) · `<proje>_lisans` (kurulum anahtarı, kira) · `<proje>_yedek` (yedekler) · `<proje>_yedek_anahtar` (yedek şifreleme alıcısı). `<proje>` = `.env`deki `TEKSERP_PROJE` (yoksa `tekserp`). Lisans birimi silinince yeniden açılan kurulum YENİ bir kurulum anahtarıyla doğar; eski kod başka anahtarla etkin bir kuruluma bağlı olduğu için **409 `TASIMA_KODU_GEREKLI`** alır ve kurulum, satıcının onayladığı taşıma kodu (ya da yeni kod) olmadan yeniden etkinleşmez. Güncellemede, geri almada ve arızada `-v` VERİLMEZ.

```sh
docker volume ls --filter label=com.docker.compose.project=<proje>   # yalnız listeler
docker compose down                                                   # GÜVENLİ: konteyner + ağ gider, dört birim KALIR
docker compose up -d                                                  # aynı birimlerle aynı kurulum geri gelir
```

- **Kurulum başka sunucuya gidecekse** birim kopyalanmaz (lisans kopyası parmak izini tutturmaz, §5): son yedek alınır ve makine dışına çıkarılır (§4), panelden taşıma talebi açılır, yeni sunucuda satıcının onayladığı taşıma koduyla etkinleştirilir (`docs/kurallar/lisans.md` taşıma).
- **Tamamen kaldırma ya da deneme kurulumunu baştan kurma** (gerçek kurulumda yalnız son yedek makine dışına çıkarıldıktan sonra): birimler `-v` ile toptan değil, ADIYLA silinir — ne silindiği komutta görünür.

```sh
docker compose down
docker volume rm <proje>_pg_data <proje>_yedek <proje>_yedek_anahtar <proje>_lisans   # GERİ DÖNÜŞÜ YOK
```

- Yeniden kurulumda satıcıdan yeni etkinleştirme kodu ya da taşıma kodu istenir. Yalnız `<proje>_pg_data`yı silip lisans birimini tutmak lisansı KURTARMAZ: yeni küme yeni F5 demektir ve iki etkenli zayıf tanımada iki etkenin ikisi de tutmalıdır (§5); sözleşme kabulü de veritabanındadır. Bu yol ölçülmedi, kullanılmaz.

## 10. Bulut sunucusu (bizim yönettiğimiz): 443 kenarı

Yalnız bizim kurup yönettiğimiz sunucular içindir (deneme, demo, bulut kurulumu); müşteri yerindeki sunucuya gelen port AÇILMAZ (`docs/kurallar/deploy-kurulum.md`, 2026-10-08 gelen bağlantı istisnası). Örnek dosya `Teks-Erp/docker/korumali/docker-compose.bulut-ornek.yml` müşteri teslim paketine GİRMEZ (`teslim-paketle.sh` yalnız `docker-compose.yml` + `.env.ornek` taşır).

**Tasarımdan sapma (`docs/design/BULUT-KURULUM.md` T3 · §1.2 · §1.3):** tasarımdaki kenar `nginx-unprivileged` konteyneridir; Docker port yayınıyla (`0.0.0.0:443→8443`) dinler ve Cloudflare süzgeci `DOCKER-USER` + `ipset` ile kurulur. O kenar ve onu kuran araçlar yazılmadı. Bu örnek nginx'i **konak ağında** (`network_mode: host`) koşturur. Gerekçe: Docker'ın yayımladığı port ufw'nin ÖNÜNDEN geçer, konak ağındaki 443'e ise ufw'nin "yalnız Cloudflare" kuralları gerçekten uygulanır; `DOCKER-USER` betiği yazmadan aynı kapı elde edilir. Bedeli: kenar konağın ağını görür (yalnız 443'ü dinler; yetkileri `NET_BIND_SERVICE`/`SETUID`/`SETGID`/`CHOWN`a düşürülmüş, kök dosya sistemi salt okunur), imaj Docker Hub'dan etiketle gelir (T5'in özet sabitlemesi yok) ve Cloudflare istemci sertifikası (AOP) isteğe bağlıdır. Tasarımdaki kenar yazılınca bu örnek emekli olur.

1. **Ön koşul:** §2 tamam ve `curl -fsS http://127.0.0.1:4000/health` UP. ufw'de gelen varsayılanı RED, SSH portu açık. Cloudflare bölgesi **Full (strict)**. Ad tek düzeydir (`<ad>.etkiliyazilim.com`, Universal SSL) ve ayrılmış adlardan değildir (T1).
2. **Origin sertifikası** (özel anahtar sunucuda üretilir, sunucudan çıkmaz; kenar yetkisiz root olarak okuduğu için dosyalar root'a aittir):
   ```sh
   install -d -m 700 -o root -g root kenar/tls
   openssl req -new -newkey rsa:2048 -nodes -keyout kenar/tls/origin.key -out kenar/tls/origin.csr -subj "/CN=<ad>.etkiliyazilim.com"
   chmod 600 kenar/tls/origin.key
   ```
   CSR → Cloudflare: SSL/TLS → Origin Server → "Use my private key and CSR" → 15 yıl. Çıkan PEM `kenar/tls/origin.pem` olur. Origin sertifikasına yalnız Cloudflare güvenir: DNS kaydı **turuncu** (vekil açık) olmak ZORUNDADIR.
3. **Cloudflare aralıkları → ufw + nginx** (`kenar/cf-guncelle.sh`, root; boş liste gelirse hiçbir şeyi değiştirmez):
   ```sh
   #!/bin/sh
   set -eu
   cd "$(dirname "$0")"
   V4=$(curl -fsS https://www.cloudflare.com/ips-v4); V6=$(curl -fsS https://www.cloudflare.com/ips-v6)
   [ -n "$V4" ] && [ -n "$V6" ] || { echo "Cloudflare listesi boş geldi — değişiklik yok" >&2; exit 1; }
   { for ip in $V4 $V6; do echo "set_real_ip_from $ip;"; done; echo "real_ip_header CF-Connecting-IP;"; } > cloudflare-ips.conf
   for ip in $V4 $V6; do ufw allow proto tcp from "$ip" to any port 443 comment cloudflare >/dev/null; done
   ```
   Liste değişince eski ufw kuralları kendiliğinden silinmez (günlük tazeleme tasarımın işidir, §1.3). Betikten sonra `docker compose exec kenar nginx -s reload`.
4. **nginx** (`kenar/site.conf`). Tanınmayan ad (doğrudan IP, başka alan) el sıkışmada reddedilir. `X-Forwarded-For` Cloudflare'in verdiği gerçek adresle EZİLİR; istemcinin yazdığı başlık API'ye ulaşmaz (`TRUST_PROXY=1`in güvenli olma şartı, §7):
   ```nginx
   server { listen 443 ssl default_server; ssl_reject_handshake on; }
   server {
       listen 443 ssl;
       http2 on;
       server_name <ad>.etkiliyazilim.com;
       ssl_certificate     /etc/nginx/tls/origin.pem;
       ssl_certificate_key /etc/nginx/tls/origin.key;
       ssl_protocols TLSv1.2 TLSv1.3;
       include /etc/nginx/cloudflare-ips.conf;
       client_max_body_size 20m;
       location / {
           proxy_pass http://127.0.0.1:4000;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $remote_addr;
           proxy_set_header X-Forwarded-Proto https;
           proxy_read_timeout 120s;
       }
   }
   ```
5. **Aç:** kenar imajı önceden yerelde olmalı (`docker pull nginx:1.27-alpine`; örnekte `pull_policy: never` — güncelleyici düzenine geçişte §11 bunu zorunlu tutar) → `cp docker-compose.bulut-ornek.yml docker-compose.override.yml` → `docker compose config --quiet` → `docker compose up -d` → `docker compose exec kenar nginx -t`. Örnek, backend'e `TRUST_PROXY=1` + `RATE_LIMIT_ENABLED=true` + `TEKSERP_KURULUM_SINIFI=BARINDIRILAN` (bulutta ZORUNLU; fabrika kurulumunda boş kalır — `.env.ornek`) verir ve API portunu `.env`teki `TEKSERP_DINLE` ne olursa olsun yalnız `127.0.0.1`de yayımlar (`ports: !override`, compose v2.24+).
6. **Sına:** sunucuda `curl -fsS --resolve <ad>.etkiliyazilim.com:443:127.0.0.1 -k https://<ad>.etkiliyazilim.com/health` UP döner, `curl -sk https://127.0.0.1/health` el sıkışmada reddedilir. Bundan SONRA DNS A kaydı (turuncu) açılır. Dışarıdan: ad üzerinden `/health` UP; `--resolve <ad>…:443:<sunucu IP>` ile doğrudan IP zaman aşımına uğrar (ufw Cloudflare dışını düşürür).
   Mac'teki provada (Docker Desktop) konak ağı Linux sanal makinesinin ağıdır, Mac'in 443'ü DEĞİLDİR: Mac'ten `curl` bağlanamaz. Sınama kenarın içinden yapılır (nginx imajında `curl` var): `docker compose exec kenar curl -fsS --resolve <ad>:443:127.0.0.1 -k https://<ad>/health` UP · `docker compose exec kenar curl -sk https://127.0.0.1/health` çıkış 35 (el sıkışma reddi).
7. **Güncelleme ve geri alma:** paketteki `docker-compose.yml` güncelleyicili şablondur ve elle kuruluma konmaz. `docker-compose.yml` ile `docker-compose.override.yml` paketin commit'indeki depodan yenilenir (§3 madde 3); `kenar/` ve `.env` yerinde kalır. Geri almada (§6) `kenar` de durdurulur.
- Panel ve tablet bu ada internet kipinde bağlanır (genel CA, 443; tablet vc61+ — `docs/kurallar/kesif-cihaz.md`).

## 11. Güncelleyici düzenine geçiş (`gecis`)

Elle kurulmuş (§2) bir sunucuyu güncelleyici düzenine alır (plan `GUNCELLEYICI-SAGLAMLIK.md` §8.2; Windows D6'nın karşılığı). Veritabanına dokunulmaz, göç koşulmaz, proje adı ve birimler aynı kalır, imaj yeniden yüklenmez (yüklü etiket ölçülür, etiket kaydı yazılır).

1. **Önkoşul:** kurulu sürümün AYNI sürümlü imzalı paketi (`tekserp-backend-oci-<v>.tar`; `.env` `TEKSERP_IMAJ` = `tekserp-korumali:<v>` olmalı) ve paketteki ikili sunucuda; ikili `sha256sum` ile paketin `SHA256SUMS`ına karşı ölçülmeden çalıştırılmaz. Override (§10) kullanılıyorsa kenara `pull_policy: never` eklenir (birleşik yapılandırma kurallardan geçmeli): `sed -i '/^  kenar:/a\    pull_policy: never' docker-compose.override.yml`. Kurulu sürüm paketten ESKİYSE `gecis` DURUR (`aynı sürümün paketi gerekir`, çıkış 3) ve güncelleyici yerel paketle sürüm atlatmaz: önce §3 ile elle yeni sürüme geçilir, sonra aynı paketle `gecis` koşulur (deneme sunucusu 2.15.0 → 2.15.1, 2026-10-10).
2. **Kuru koşum (varsayılan):** `sudo ./tekserp-guncelleyici gecis --kok <elle kurulumun dizini> --tar <paket>` — envanter (proje, sürüm, override, PG imajı, eski backend'in sağlığı) + 10 kalemlik plan basar, hiçbir şey yazmaz. Birimler (`<proje>_pg_data`, `<proje>_lisans`) yoksa, sürüm tutmazsa, kök zaten güncelleyici düzenindeyse ya da birim kayıtlıysa DURUR.
3. **Uygula:** aynı komut + `--uygula --onay 10`. Kalemler: günlük (`<kök>/gecis/<damga>/gunluk.jsonl`) · iskelet (dizinler, `guncelleyici/ayar.json`, `yapilandirma/pg.env` = çalışan PG imajı, yedek alan) · paket `surumler/<v>` · `.env` → `yapilandirma/.env` (kopya), override → `yapilandirma/docker-compose.yerel.yml` · compose kuralları · imaj kaydı · `current` · yeni compose ile `up -d` + sağlık (sürüm aynı, lisans kötüleşmez) · eski `docker-compose.yml`, `.env`, override → `gecis/<damga>/geri/` · ikili `guncelleyici/` + `tekserp-guncelleyici.service`. Sağlıklı olana dek (birim başlamazsa da) her hata kendiliğinden geri alınır: eski dosyalar yerinde, eski compose ile `up -d`; yaratılanlar silinmez, `gecis/<damga>/geri-alinan/`e taşınır. Çıkış: 0 tamam · 3 durdu · 4 geri alındı · 5 geri alma eksik.
4. **Sonra her compose çağrısı** güncelleyicinin başıyla: `docker compose -p <proje> --project-directory <kök> -f <kök>/current/docker-compose.yml -f <kök>/yapilandirma/docker-compose.yerel.yml --env-file <kök>/yapilandirma/.env --env-file <kök>/yapilandirma/pg.env …` (yerel dosya yoksa o `-f` düşer). Kökteki `kenar/` yerinde kalır; yerel dosyadaki göreli yollar köke göre çözülür. Veri kökü `/var/lib/tekserp` sabittir (şablonun bağ kaynağı) — aynı konakta ikinci güncelleyicili kurulum bugün yok.
5. **Geri al:** `sudo tekserp-guncelleyici gecis --geri-al --kok <kök>` (KURU plan) → `--uygula --onay <N>`. Yalnız güncelleyici hiç işlem yapmadıysa (`/var/lib/tekserp/guncelleme/is/islem.jsonl` yok/boş) ve `current` hâlâ geçişin sürümündeyse; değilse geri alma elle/yedekten (§6).
6. **Kira yeri (düzeltildi, güncelleyici 0.2.4):** Linux'ta güncelleyici kirayı/HAK'ı backend'in `<proje>_lisans` Docker biriminden okur (`docker volume inspect --format '{{.Mountpoint}}' <proje>_lisans`); konakta `<kök>/lisans` kopyası/bağı YOKTUR. 0.2.3 bunu bilmez (`durum` `DONDURULDU/KIRA_YOK`, `onar` `KendiDogrulanmadi`) ⇒ 0.2.3'lü kurulumlar §11.1'deki geçişle 0.2.4'e alınır.

### 11.1 Mevcut 0.2.3 kurulumun 0.2.4'e geçişi (kira yeri düzeltmesi)

0.2.3 kirayı birimde göremediği için kendini güncelleyemez; iki yoldan biri. Aşağıda `<kök>` = kurulum dizini (örn. `/opt/tekserp/ders`), `<proje>` = compose proje adı (örn. `tekserp-ders`). **Bu bölüm bir tarifedir; sunucuya uygulama ayrı, kullanıcı onaylı adımdır.**

**Yol A — salt okunur bağ köprüsü (güncelleyici kendini yeniler):**
1. 0.2.4'lü güncelleyiciyi taşıyan backend sürümü grup kanalında yayınlanmış olmalı (yoksa B'ye geç).
2. Birimin konak yolunu ölç: `M=$(docker volume inspect --format '{{.Mountpoint}}' <proje>_lisans)` (genelde `/var/lib/docker/volumes/<proje>_lisans/_data`).
3. Köprü (root): `install -d -m 0700 <kök>/lisans && mount --bind "$M" <kök>/lisans && mount -o remount,bind,ro <kök>/lisans`. **Sembolik bağ ÇALIŞMAZ** (güvenilmez okuma bağı reddeder); bağ SALT OKUNURDUR, güncelleyici oraya yazmaz.
4. Güncelleyici tur atar (60 sn): `sudo <kök>/guncelleyici/tekserp-guncelleyici durum` artık `KIRA_YOK` değil; kanaldaki sürüm "önce güncelleyici" kuralıyla 0.2.4'e geçer.
5. Doğrula: `<veri>/guncelleme/is/kendi.json` `lkgSurum` = `0.2.4` ve `durum` sağlıklı.
6. Köprüyü kaldır: `umount <kök>/lisans && rmdir <kök>/lisans` (0.2.4 `<kök>/lisans`e bakmaz; kalması zararsız ama karışıklık yaratır). Köprü yeniden açılışta zaten düşer (kalıcı DEĞİL; `/etc/fstab`a yazılmaz).

**Yol B — elle güncelleme (§3):** köprü kurmadan yeni imzalı paketi §3 ile uygula; sonra `gecis` zaten yapılmışsa `<kök>/current` paketin 0.2.4 ikilisini taşır, hizmet yeniden başlatılınca (`systemctl restart tekserp-guncelleyici`) 0.2.4 çalışır. Doğrulama A.4–A.5 ile aynıdır.

**Geri dönüş:** köprü yalnız konak bağıdır, `umount` her an geri alır; birime ve veriye dokunulmaz.

**Ön denetim — güncelleme sunucusu adresi:** `<kök>/guncelleyici/ayar.json` `guncellemeSunucusu` grup yayınının kökü `https://indir.etkiliyazilim.com` olmalı (`deploy/dagitim.json` `indirmeKoku`). 0.2.3/0.2.4'ün `kur`/`gecis` varsayılanı ESKİ adrestir (`https://guncelleme.etkiliyazilim.com`, `--sunucu` verilmezse) ve orada `/<grup>/backend-oci/` yoktur → `durum` `MANIFEST_INDIRILEMEDI` (HTTP 404), karar `GUNCEL/ADAY_YOK`. 0.2.5'ten itibaren varsayılan indirme köküdür (`VARSAYILAN_SUNUCU`, eşliğini `test_kurulum_betikleri` §16 ölçer); var olan `ayar.json` OTOMATİK GÖÇ EDİLMEZ (güncelleyici yönetici ayarını yeniden yazmaz; eski adresli kurulumda `kur` yeniden koşulursa iskelet çelişkisinde DUR der) — eski kurulumda elle düzeltilir. Düzeltme: dosyanın `.yedek-<damga>` kopyası alınır, yalnız bu anahtar değiştirilir (sahip/kip korunur); güncelleyici ayarı her turda yeniden okur, yeniden başlatma gerekmez.

**Onay:** kirada `guncelleme.kip = ONAYLI` ise aday `HAZIR / ONAY_BEKLIYOR`da bekler; kurulum panelden onaylanır (Sistem → Güncellemeler "Şimdi kur" = `POST /api/guncelleme/onay` `{surum, zamanlama: HEMEN}`, `license:manage`).

**Uygulama kaydı (deneme sunucusu, 2026-10-10, UTC):** yedek (uygulama aracı `.tkenc` + `yedek-elle/…pre-2.15.2.dump`) → 19:34:50 köprü (A.3) → `KIRA_YOK` düştü, `MANIFEST_INDIRILEMEDI` (eski adres) → 19:46:43 `ayar.json` adresi düzeltildi → 19:50:36 indirme → 19:52:49 güncelleyici 0.2.3 → 0.2.4 kendini yeniledi (`kendi.json` `DOGRULANDI`, `lkgSurum 0.2.4`) → 19:57:09 panel onayı → 19:57:28 backend işlemi YEDEK adımında `YEDEK_HATASI` (`EACCES … /var/lib/tekserp/yedek-anahtar/ders.tkpub`) → 19:57:38 kendiliğinden geri döndü (2.15.1 UP, göç 374) → 20:06 köprü kaldırıldı; 0.2.4 kirayı birimden okuyor (karar `KUR`, politika kaynağı `KIRA`). **Backend 2.15.2'ye GEÇMEDİ:** güncelleyicinin araç konteyneri bağ taşıdığında `--user 0:0` alır, şablonun `cap_drop: ALL`ı yüzünden yetkisiz root, `yedek_anahtar` biriminin 0700 (10001) dizinini açamaz — yedek alıcısı kurulmuş her Linux kurulumunda backend güncellemesi 0.2.4'te YEDEK adımında geri döner. **Düzeltildi, güncelleyici 0.2.5 (`f9ca7d172`):** araca yetki eklenmez, alıcı güncelleyici tarafından birimden işlemin özel alanına kopyalanır; aynı sürümde Linux şema ön denetimi göç adlarını imajdan okur (önceden her tur `SEMA_OLCULEMEDI`) ve `kur` varsayılan sunucusu indirme köküdür. **Sonraki adım (deneme sunucusu, kullanıcı onaylı):** 0.2.5'i taşıyan 2.15.3 test grubuna yayınlanır → güncelleyici "önce güncelleyici" kuralıyla kendini 0.2.5'e yeniler (`kendi.json` `lkgSurum 0.2.5`) → backend adayı için panelden YENİ onay verilir (geri dönmüş sürüm kendiliğinden yeniden denenmez) → `yedek.json` `kurulumAlicisi = 1` ve günlükte `SEMA_OLCULEMEDI` olmadığı ölçülür.

Yeni kurulumda aynı adımları `kur --tar <paket> --proje <proje> [--uygula]` yapar (önkoşul `yapilandirma/.env`; tekrarlanabilir — ikinci koşum yapılacak bir şey bulmaz).
