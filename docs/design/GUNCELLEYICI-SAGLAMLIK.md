# Güncelleyici sağlamlık planı — tek ürün, iki arka uç (Windows hizmeti · Linux/Docker)

> **Durum:** PLAN (2026-10-08). Kod yazılmadı. Bu belge bir **uygulama planıdır**, sözleşme değildir. Sözleşme `docs/design/GUNCELLEYICI.md`dir (§1–§3 DONMUŞ, §4–§14 Windows yerel sözleşmesi). Her dilim indikçe buradaki kararlar oraya **bölüm olarak** taşınır (ör. `§4L Linux dizin düzeni`) ve burada "→ GUNCELLEYICI.md §x" diye kapanır. Bulut kurulumunun güncelleyici bölümü (`docs/design/BULUT-KURULUM.md` §4, dilim B4) bu planla **yer değiştirir**: B4 artık buradaki L-dilimleridir.
> **Hedef (kullanıcının cümlesi):** "Bu update programını sürekli güncellemek zorunda kalmayalım, bir kere yapalım hep iyi çalışsın; onlarca fabrikaya satış yapacağız." Ölçüte çevrilmiş hâli: **(H1)** her arızada insan eli değmeden ya tamamlanır ya eski hâline döner · **(H2)** güncelleyicinin kendisi nadiren değişir ve değiştiğinde kendini bozamaz · **(H3)** sözleşme ileriye uyumludur (eski güncelleyici yeni yayını bozmadan atlar, yeni güncelleyici eski kurulumda çalışır) · **(H4)** yüzlerce kurulumda kademeli, kendi kendini durduran yayılım · **(H5)** bunların hepsi **test vektörü ve arıza enjeksiyonuyla ölçülmüş** olur, söz olarak kalmaz.
> **Belge adı neden bu:** kapsam iki platformu birden kapsar (koordinatör kapsam genişlemesi 2026-10-08). Plan Windows'taki mevcut kodu da aynı ölçütle denetler; Linux yalnız ikinci arka uçtur. GUNCELLEYICI.md'ye ek bölüm olarak yazılmadı, çünkü o belge sözleşmedir ve DONMUŞ kısımları vardır. Plan, dilim sırası ve açık kararlar sözleşmenin içine girerse "ne bağlayıcı, ne niyet" ayrımı bulanıklaşır.
> **Okunan kaynaklar (origin/main `5fb46d862`):** `Teks-Erp/native/tekserp-guncelleyici` (26 modül, ~15,8 bin satır; `env.rs` platform özellikleri, `operation.rs` genel işlem sürücüsü, `engine.rs` tur, `selfupdate.rs` A/B, `windows/` SCM/DPAPI/iş nesnesi) · `tests/common` sahte dünya + `CrashFs` (her değiştiren işlemden önce öldürme) · `native/test-vektorleri` · `.github/workflows/native-windows.yml` · `Teks-Erp/docker/korumali` + `Teks-Erp/docker/entrypoint.sh` · `Teks-Erp/src/lib/license/protocol/paket-zinciri.ts` · `docs/design/PAKET-ANAHTARI-KOK-ALTINDA.md` (D7/D8) · `docs/design/TEK-ORTAK-PAKET.md` (gruplar `test → oncu → genel`) · satıcı `update-policy.service` · `gece/g13-butunluk` dalı ve worktree'si (imaj içi liste: `imaj-imzala.mjs`, ince son katman, yeni etiket).

## 0. Özet

**Mimari (üç cümle).** Tek Rust crate (`tekserp-guncelleyici`), ortak çekirdek (karar · doğrulama · işlem günlüğü · durum makinesi · IPC · kendini güncelleme) ve iki platform arka ucu: Windows (SCM + junction + DPAPI + iş nesnesi; bugünkü kod) ve Linux (konakta systemd hizmeti, root; Docker'ı **`docker` / `docker compose` komut satırıyla** yönetir; `current` sembolik bağı sürüm dizinini, sürüm dizini imzalı compose dosyasını gösterir). Linux paketi Windows'tan **ayrı bir ürün yolundan** yayınlanır (`/<grup>/backend-oci/`), böylece aynı güncelleme grubundaki Windows kurulumu Linux bildirimini hiç görmez. İki platform aynı işlem günlüğü biçimini, aynı durum/niyet dosyalarını, aynı hata kodlarını ve aynı test vektörlerini kullanır; farkı yalnız `Env` özelliklerinin uygulamaları taşır.

**Denetimin en önemli bulguları (Windows'ta bugün var, Linux'ta da olurdu):**

| # | Açık | Neden önemli | Kapanış |
|---|---|---|---|
| A1 | **Kendini güncelleme yalnız backend işlemi BAŞARILI olunca** (`engine.rs` → `maybe_self_update`) | Güncelleyicide backend'in başarısını engelleyen bir hata varsa (D7'deki `/health` → `/health/yerel` örneği tam buydu) düzeltmeyi taşıyan ikili **hiç yerleşmez**: kilitlenme. "Bir kere yap" ölçütünü en çok bu bozar | W1 |
| A2 | `.eski` ikili **ilk sağlıklı turda silinir** (`mark_healthy`) | Hata ancak sonraki güncellemede ortaya çıkarsa (gizli hata) dönülecek ikili kalmaz | W1 |
| A3 | **İşlem sürerken yeniden açılış yarışı:** sunucu adım 3–6 arasında yeniden başlarsa SCM backend'i (`gecikmeli otomatik`) güncelleyiciden ÖNCE ya da onunla yarışarak başlatabilir — `current` yeni sürümü, DB eski ya da yarım şemayı gösterirken | "Her son durumda tek backend + uyumlu şema" değişmezi son durumlarda korunuyor ama ARA durumda yeni kod eski şemada istemci yazısı kabul edebilir; geri dönüşte bu yazı kaybolur | W2 (bakım çiti) |
| A4 | Disk dolunca işlem günlüğü yazılamaz → `IC_HATA`; telafinin de diske ihtiyacı var | Disk dolu, H1'i bozan en olası saha arızasıdır | W3 (yedek alan dosyası) |
| A5 | Altyapı arızası (PG durmuş, Linux'ta Docker servisi çökmüş) adım hatası sayılıp telafiye gider; telafi de aynı altyapıya muhtaç olduğu için `HATA`ya düşer | `HATA` = insan; geçici bir altyapı kesintisi kalıcı insan işine dönüşmemeli | W3 |
| A6 | `HATA` son durumdur; yeni onay gelene dek hiçbir şey denenmez | Telafiler tekrarlanabilir yazılmıştır; geri dönüşü zamanla yeniden denemek güvenlidir | W3 |
| A7 | Asılı kalan (ölmeyen ama ilerlemeyen) güncelleyiciyi kimse yeniden başlatmaz; kalp atışı yalnız panelde görünür | Kilitlenen çağrı (ağ, araç) adım zaman aşımlarının dışında kalabilir | W3 (iç bekçi) |
| A8 | Aday her ~5 dk'da bir indirilir (§6.3 önbellek süresi) | 300 kurulumda ~86 bin istek/gün yalnız işaretçiye; CDN Worker'ının ücretsiz sınırı 100 bin/gün | W5 |
| A9 | Eski günlük/durum/niyet/ayar biçimlerini yeni ikilinin okuyabildiği ÖLÇÜLMÜYOR | H3; yarım işlemi bırakan sürüm ile sürdüren sürüm farklı olabilir (kendini güncelleme ONAY'da) | W0 |
| A10 | Bulut tasarımı (§4.2) Linux bildiriminin "yalnız Linux kanalında" yayınlanacağını varsayıyordu; grup modeli (2026-10-06) kanalları platformlar arasında ORTAK yaptı | Aynı `son.json`a iki platform yazamaz; eski Windows güncelleyicisi `platform: linux-x64-oci`yi `BELGE_SEMA` ile reddeder ve Windows filosu durur | L2 (ayrı ürün yolu) |
| A11 | Docker imajının açılış betiği her açılışta `migrate deploy` koşar (`entrypoint.sh`) ve compose `restart: unless-stopped` | Güncelleyicinin ayrı `GOC` adımı ve telafisi anlamsızlaşır; eski imaj yeniden başlarken yeni göçle karşılaşır | L5 |

**Ayrı Windows güncelleyici kurulumu sorusu (C):** önerilmez. Tek paket + kendini güncelleme kalır, ama A1/A2 kapatılır ("önce güncelleyici" kuralı ve son bilinen iyi ikili). Gerekçe §4.4'te.

## 1. Mimari

### 1.1 Ortak çekirdek ve platform arka ucu — bugünkü durum (ölçüldü)

Ayrım bugün **büyük ölçüde zaten var**: `lib.rs` başlığı "Çekirdek platformdan bağımsızdır (`env::Env` üzerinden dosya/hizmet/süreç/ağ/saat); Windows bağları `windows` modülünde" der ve kod buna uyar:

| Özellik (`env.rs`) | İş | Windows uygulaması | Linux'ta bugün |
|---|---|---|---|
| `Fs` | okuma (güvenilmez okuma dahil), atomik yazım, ekleme+boşaltma, bağlantı, boş alan, yabancı yazar | `RealFs` + `windows::{move_file_durable, free_space, foreign_writers}`, junction | `RealFs` derlenir (`#[cfg(unix)]` dalları var: sembolik bağ, `rename(2)`); `free_space` ve `foreign_writers` yok |
| `Services` | durum · başlat(arg) · durdur · çökme çıkış kodu · ImagePath oku/yaz | `WinServices` (SCM) | yok |
| `Procs` | çocuk süreç (zaman aşımı, ağaç sonlandırma) | iş nesnesi (`ChildTree`) | yok |
| `Net` | HTTP GET | `ureq` + `native-tls` (SChannel) | `ureq` TLS'siz (yalnız düz http — "geliştirme/test") |
| `Clock` · `Events` · `Protect` | saat · olay günlüğü · gizli veri sarma | sistem saati · Uygulama olay günlüğü · DPAPI (SYSTEM) | saat var; diğer ikisi yok |

Ortak olan ve hiç dokunulmayacak modüller: `decision` · `release` · `policy` · `trust` · `package` (zip + bütünlük) · `journal` · `operation` (genel sürücü) · `ipc` · `history` · `sema` · `version` · `codes` · `settings` · `download` · `selfupdate` (platform bağımsız kısmı). **Platforma sızmış çekirdek kodu (ayrıştırılacak):**

1. `health.rs` sağlığı `env.net.get("http://127.0.0.1:<PORT>/health/yerel")` ile ölçer. Linux'ta `/health/yerel` yalnız **konteynerin kendi döngü adresine** cevap verir (G13 dalı ölçtü: konaktan `curl` Docker köprüsünden gelir, 404) ⇒ sonda bir platform işi olur: yeni özellik `Saglik::yoklama(port) -> HttpResponse` (Windows: bugünkü HTTP · Linux: `docker compose exec -T backend node -e <tek satır fetch>` ve çıktının ilk satırı durum kodu).
2. `operation.rs` adımları `tekserp_hizmet::contract` dizin adlarını ve `runtime\node.exe` yolunu doğrudan kullanır (GOC, yedek araçları). Linux'ta araçlar **imajın içinden** koşar ⇒ `tools.rs` arkasına `Araclar` özelliği: `goc(hedef)` · `goc_sayisi()` · `bitmis_goc_adlari()` · `yedek_al(alicilar)` · `geri_yukle(dosya, anahtar)`. Windows uygulaması bugünkü kodun taşınmasıdır (davranış değişmez; aynı testler).
3. `pgminor.rs` ImagePath + junction ile çalışır. Linux'ta PG küçük sürümü = PG imaj etiketinin değişmesidir ⇒ `PgArkaUcu` özelliği (U5–U8'in platform işi). Linux'ta ilk sürümde PG küçük sürümü **kapalı** başlar (`pg.hedef` yalnız KONTEYNER kipinde ve ayrı dilimde açılır, L8).

Hedef dizin düzeni: `src/platform/{mod.rs, windows/, linux/}`; `#[cfg]` yalnız `platform/` altında ve `main.rs`te durur (bekçi `test_guncelleyici_platform_siniri`: çekirdek modüllerde `cfg(windows)`/`cfg(unix)`/`windows_sys` yok — AST/metin taraması, iki sonda).

### 1.2 Linux arka ucu (konak, systemd, root — BULUT-KURULUM T2)

**Konum gerekçesi (T2'yi aynen sürdürür):** Docker soketine erişim root'a eşdeğerdir; soketi bir konteynere bağlamak root yüzeyini konteyner ağına açar. Güncelleyici konakta root olarak çalışır ve Windows'taki LocalSystem hizmetinin birebir karşılığıdır. Backend konteynerde 10001 kullanıcısıyla, salt okunur kökle koşar; IPC dizinleri ona bağlanır.

**Docker'ı nasıl yönetir — karar: `docker` CLI ve `docker compose` eklentisi, `Procs` üzerinden.**

| Seçenek | Artı | Eksi | Karar |
|---|---|---|---|
| **CLI** (`docker`, `docker compose`) | Yeni Rust bağımlılığı YOK (bugünkü `Procs` + zaman aşımı + süreç grubu). Compose dosyası TEK beyan kalır (kurulumda da, elle müdahalede de, güncelleyicide de aynı dosya). Kullanılan alt küme küçük ve onlarca yıldır kararlı | Çıktı biçimi sürümle değişebilir | **SEÇİLDİ** |
| Engine API (Unix soketi) | Sürümlü API (`/v1.43/…`), makine okunur | `ureq` Unix soketi konuşmaz ⇒ ya yeni crate (hyper + yerel soket istemcisi) ya elle HTTP/1.1 + parçalı kodlama yazımı (hata yüzeyi); compose'un mantığını (ağ, birim, bağımlılık) yeniden yazmak gerekir — ikinci beyan doğar | RED |

**Çıktı biçimine bağımlılığı sınırlama kuralı:** güncelleyici CLI çıktısından yalnız şu alanları okur ve hepsini **Go şablonuyla tek değer** olarak ister (tablo/insan çıktısı ayrıştırılmaz): `docker image inspect --format '{{.Id}}'` · `docker inspect --format '{{.State.Status}}|{{.State.ExitCode}}|{{.RestartCount}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}'` · `docker compose ps -q <servis>` (yalnız kimlik). Başarı ölçüsü çıkış kodudur; metin YALNIZ günlüğe gider. Desteklenen Docker aralığı `deploy/bulut/surumler.json`da sabittir (BULUT §1.4); CI iki sürümde (sabit + bir sonraki büyük) koşar (T5 testi, §8).

**Compose ile ilişki — sürüm dizini Windows'la AYNI kalıp:**

```
/opt/tekserp/                                    (<KOK>; kök: root 0755)
  surumler/<sürüm>/                              imzalı paketin açılmış hâli: docker-compose.yml · PAKET-DOCKER.json(+jws/zincir) ·
                                                 butunluk-liste.txt · tekserp-guncelleyici (linux ikilisi) · guncelleyici-kunye.json
  surumler/.hazirlik-<sürüm>/                    açılmakta olan sürüm (Windows'la aynı ad)
  current -> surumler/<sürüm>                    sembolik bağ; değişimi rename(2) ile ATOMİK (`env.rs` unix dalı zaten böyle)
  yapilandirma/.env                              compose ortamı + backend sırları (root 0600; backend'e compose `env_file` ile)
  yapilandirma/pg.env                            TEKSERP_PG_IMAJ (PG küçük sürümünün tek yazarı güncelleyici — Windows ImagePath karşılığı)
  guncelleyici/tekserp-guncelleyici              asıl ikili (+ .yeni / .eski / .lkg) · ayar.json · gunluk/
  kurulum-gecmisi.jsonl                          Windows'la aynı biçim (`InstallRecordSchema`)
/var/lib/tekserp/guncelleme/
  niyet/      sahibi 10001, 0700 — backend yazar (konteynere rw bağlanır)
  durum/      root 0755, dosyalar 0644 — güncelleyici yazar (konteynere ro bağlanır)
  is/         root 0700 — güncelleyicinin özel alanı: islem.jsonl · indirme/ · hazir/ · ertele.json · kendi.json ·
              anahtar/<islemId>/ (root 0600) · yedek/<islemId>/ · kilit · yedek-alan (W3)
```

- `docker compose` HER çağrıda `-p <proje> -f /opt/tekserp/current/docker-compose.yml --env-file /opt/tekserp/yapilandirma/.env --env-file /opt/tekserp/yapilandirma/pg.env` ile koşar; proje adı `ayar.json`dan (Windows'taki `backendHizmeti` karşılığı; aynı konakta iki kanal = iki proje). Elle müdahale de aynı komutu kullanır (runbook tek satır verir).
- **GECIS = `current` bağının çevrilmesi** (Windows'la aynı `switch_link`). Compose dosyası sürümle birlikte gelir ve imzalıdır; yeni sürüm compose'a yeni ortam değişkeni, birim ya da sağlık ayarı getirebilir. BULUT §4.4'teki "`.env` içinde `TEKSERP_IMAJ` değiştir" yolu bırakılır: imaj etiketi ve compose ayrı ayrı değişseydi iki adımda iki şey değişirdi.
- Compose şablonu kuralları (L5'te bekçiyle): her serviste `pull_policy: never` (T5 — Docker Hub'a ÇIKILMAZ; eksik imaj "çekilmez", hata verir) · backend imajı `tekserp-korumali:<sürüm>` etiketiyle (güncelleyici her başlatmadan önce etiketin kimliğini bildirimdeki `imaj.kimlik`e karşı ölçer) · backend `restart: unless-stopped` (bkz. çit, §2.2) · `TEKSERP_GOC_ACILISTA=0` (açılışta göç YOK; göç yalnız güncelleyicinin `GOC` adımında) · `/var/lib/tekserp/guncelleme/{durum:ro,niyet:rw}` bağları + `TEKSERP_GUNCELLEME_DIZINI` · `TEKSERP_DOGRULAMA_KIPI: ${TEKSERP_DOGRULAMA_KIPI:-}`.

**`Services` Linux uygulaması (`DockerServices`):** ad = compose servis adı (`backend`, `postgres`, `kenar`).

| Yöntem | Linux karşılığı |
|---|---|
| `state` | `compose ps -q backend` → yoksa `Stopped`; varsa `docker inspect` `State.Status` (`running` · `restarting` → `StartPending` · `exited`/`created` → `Stopped`) |
| `start(name, ["--dogrulama"])` | `TEKSERP_DOGRULAMA_KIPI=1 compose up -d --no-deps --force-recreate backend`. Doğrulama kipinde backend `HOST=127.0.0.1`e zorlanır (§4.3 aynen) ⇒ konteynerin döngü adresinde dinler, yayımlı port ve kenar ona ULAŞAMAZ — Windows'taki "yalnız 127.0.0.1" yalıtımının Docker'da kendiliğinden karşılığı |
| `start(name, [])` | `compose up -d --no-deps --force-recreate backend` (ortamdan `TEKSERP_DOGRULAMA_KIPI` silinmiş) |
| `stop` | `compose stop -t <durdurmaZamanAsimiSn> backend` (SIGTERM → backend `gracefulShutdown`; konteynerde `TEKSERP_KAPANIS` sinyal kipindedir) |
| `crash_exit_code` | `State.Status = exited|restarting` ve `ExitCode ≠ 0` ⇒ kod (Windows'taki 10–14 yerine imajın açılış betiğinin beyanlı kodları; L5 tablosu) |
| `image_path` / `set_image_path` | backend için kullanılmaz; PG için `pg.env` okuma/yazma (L8) |

**Diğer Linux uygulamaları:** `Procs` → `std::process::Command` + `setsid`/süreç grubu, zaman aşımında `kill(-pgid, SIGKILL)`; güncelleyici öldüğünde çocukların ölmesi için `prctl(PR_SET_PDEATHSIG)` (libc zaten kilit dosyasında; yeni crate değil) — `docker compose run` istemcisi ölse bile konteyner yaşayabileceğinden araç konteynerleri `--name tekserp-arac-<islemId>-<adım>` alır ve devam/telafi önce aynı adlı konteyneri `docker rm -f` eder (yetim araç kalmaz) · `Protect` → sarma YOK, dosya `is/anahtar/` altında root 0600 (root = SYSTEM; DPAPI'nin buradaki eşdeğeri dizin izni) · `Events` → stderr (systemd günlüğü yakalar) + `logger -t tekserp-guncelleyici` YOK (yalnız stderr; journald yeter) · `free_space` → `statvfs` (hem `/opt/tekserp` hem Docker kökü `docker info --format '{{.DockerRootDir}}'`) · `foreign_writers` → sahip root değilse ya da grup/diğer yazabiliyorsa yabancı yazar (Windows DACL denetiminin karşılığı) · güvenilmez okuma → `O_NOFOLLOW` + `fstat` ile yeniden ölçüm.

**TLS (Linux) — karar: `ureq`in `native-tls` özelliği Linux'ta da açılır (sistem OpenSSL'i, sistem CA deposu).** `openssl-sys` zaten kilit dosyasında (Windows dışı hedefler için `native-tls` çözümünden); yeni crate eklenmez, yalnız hedef koşulu genişler. Sistem CA deposu `unattended-upgrades` ile güncel kalır — gömülü kök listesi (webpki-roots) bayatlardı. Risk: dinamik `libssl.so.3`; kurulum ön ölçümü onu arar, CI üç dağıtımda koşar (Ubuntu 22.04 · 24.04 · Debian 12). OpenSSL'in yeni bir ABI'si gelirse güncelleyici zaten paketle yeniden derlenir (§11 R3).

### 1.3 Ürün yolu ve platform (sözleşme 5 — A10'un çözümü)

- **Yeni ürün segmenti `backend-oci`:** `/<grup>/backend-oci/son.json` · `/<grup>/backend-oci/<sürüm>/…` · `/<grup>/backend-oci/pg/…`. `DOWNLOAD_PRODUCTS`a `backend-oci`; indirme belirteci `?urun=backend-oci` (yol öneki `/<grup>/backend-oci/`). Windows yolu (`/backend/`) **hiç değişmez** ⇒ eski Windows güncelleyicisi hiçbir zaman Linux bildirimi görmez; Linux güncelleyicisi Windows bildirimi görmez. BULUT §4.2'deki "yalnız Linux kanalında yayımlanır" varsayımının yerine geçer.
- Bildirim `platform: "linux-x64-oci"` (`UPDATE_PLATFORMS`a eklenir), `urun: "backend"` kalır (karar, rapor ve panel ürünü aynı görür); güncelleyici `platform`u kendi derleme hedefine eşit ister (`SURUM_PLATFORM` — yeni kod, sözleşme 5).
- Bildirime isteğe bağlı `imaj: {kimlik, etiket}` (`linux-x64-oci`de zorunlu, `win32-x64`te yasak — şema düzeyinde `superRefine`) ve `guncelleyici: {surum, sha256}` (isteğe bağlı, her iki platformda; §4.2'deki "önce güncelleyici" kuralının ön bilgisi — eski doğrulayıcı alanı atar).
- **Paket biçimi (Linux):** tek `tar` (sıkıştırılmamış dış kap; içteki imaj zaten gzip): `tekserp-korumali_<sürüm>_linux-amd64.tar.gz` (G13 sonrası **imzalı etiketin** `docker save` çıktısı) · `docker-compose.yml` · `PAKET-DOCKER.json` + `PAKET-DOCKER.json.jws` / `butunluk-zincir.jws` · `butunluk-liste.txt` · `tekserp-guncelleyici` (linux-x64, PAKET imzalı listede) · `guncelleyici-kunye.json`. Bütünlük listesi tar'ın ÜYELERİNİ kapsar (bugünkü Docker teslim künyesi biçimi, `docs/ops/LINUX-DOCKER-KURULUM.md` §8); bildirimin `paket.sha256`sı dış tar'ın özetidir.
- **G13 ile uyum:** `imaj.kimlik` = **imzalı son katmanlı** etiketin config özeti (`imaj-imzala.mjs`in ürettiği etiket), imzasız taban DEĞİL. Yayıncı (`backend-yayinla.mjs --urun=backend-oci`) imzasız tabanı reddeder: tar'daki imajın içinde `butunluk-liste.txt` + imzalı yük yoksa yayın DURUR. İmaj içi liste açılışta native çekirdekte doğrulanır (G13); güncelleyici yalnız dış zinciri (bildirim → tar → künye → imaj kimliği) doğrular, iç listeyi `DOGRULAMA` adımının `/health/yerel` `lisans.butunluk = GECERLI` koşuluyla dolaylı ölçer (§8.7 kuralı aynen: önce GECERLI idiyse sonra da GECERLI).

### 1.4 Değişmeyenler (iki platformda aynı, kodla zaten ortak)

Karar fonksiyonu (`decideUpdate` aynası), politika (OTOMATIK · ONAYLI · DONDUR, pencere aralıkları, sabitleme, K1), kira/HAK/iptal zinciri, PAKET zinciri + `pkt-*` sertifika + kid'li zincir dosyası seçimi (`select_chained`), niyet ve durum dosyalarının biçimi (§5), geçmiş, kurulum kaydı, yoklama raporu, panel ekranı, onay ucu, hata kodları (§12), "geri inme yok", "geri dönmüş sürüm yeni onaysız denenmez", şema hizası (`SEMA_ILERIDE`).

## 2. Durum makinesi ve işlem günlüğü

### 2.1 Genel kural (her adım için, iki platformda)

Her adım **ölç → yap → doğrula** biçimindedir ve şu dört özelliği taşır (W0'da her adım için tabloya bağlanır, testle ölçülür):

1. **Ön ölçüm sonucu günlükte:** adım, işi yapmadan önce dünyayı ölçer; dünya zaten hedef durumdaysa işi YAPMADAN `BITTI` yazar (tekrar = no-op). Bu, yarımda kalan adımın DEVAM'ının güvenli olmasının tek dayanağıdır.
2. **Son doğrulama:** iş bitince hedef durum yeniden ölçülür; ölçülemezse adım başarılı SAYILMAZ.
3. **Telafi de aynı üç parçalıdır** ve tekrarlanabilir (zaten hedefteyse no-op).
4. **Her bekleme zaman aşımlıdır** ve zaman aşımı adım koduna dönüşür; zaman aşımı dışında kalan tek çağrı yoktur (iç bekçi W3 bunu ölçer).

**Değişmez (aynen, §7):** her SON durumda (`BASARILI` · `GERI_DONDU`) tek backend + `current` ile uyumlu şema. **Yeni ara değişmez (A3 → W2):** işlem günlüğünde açık bir işlem varken backend'i güncelleyiciden başka hiçbir şey başlatamaz.

### 2.2 Adımlar — iki platformun tek tablosu

| # | Adım | Ölç (önce) | Yap — Windows | Yap — Linux | Doğrula | Telafi | Yarımda |
|---|---|---|---|---|---|---|---|
| 0 | `CIT` (yeni, W2) | backend başlangıç türü / yeniden başlatma politikası | backend hizmeti `SERVICE_DEMAND_START` (plan eski türü saklar) | gerek yok: `unless-stopped` + `compose stop` = Docker yeniden başlatmaz (açılışta da); ölçümü yine yazılır | tür ölçülür | eski tür geri yazılır (son adımda da, her son durumda) | DEVAM |
| 1 | `BACKEND_DURDUR` | backend durumu; plan (önceki hedef, göç sayısı, lisans görüntüsü, imaj kimliği) backend ÇALIŞIRKEN alınmış ve ISLEM satırında | SCM stop | `compose stop -t N backend` (+ bulut kenarı bakım sayfası: kenar backend'e ulaşamayınca 503 döner; ayrıca bir şey yapılmaz) | durmuş | eski `current` ile başlat + sağlık | DEVAM |
| 2 | `YEDEK` | `is/yedek/<islemId>/db.dump.tkenc` var ve `dogrula` geçiyor mu | `pg_dump -Fc` → `--list` → şifrele | `compose run --rm --no-deps --name tekserp-arac-<id>-yedek yedek <yedek aracı>` (aynı araç; çıktı `is/yedek/<islemId>/`e bağlanan birime) | `pg_restore --list` + `yedek-sifrele dogrula` | — | DEVAM (ölçüm geçerse no-op) |
| 3 | `GECIS` | `current` hedefi | junction çevir | symlink çevir (`rename(2)`) | hedef ölçülür | `current` → önceki | DEVAM |
| 4 | `GOC` | bitmiş + toplam göç sayısı, bitmiş ad kümesi | `<yeni>\runtime\node.exe … migrate deploy` | `compose run --rm --no-deps --name tekserp-arac-<id>-goc backend goc` (imajdaki göç aracı; `CONCURRENTLY` kuralı `entrypoint.sh`ten araca taşınır — L5) | sayılar + ad kümesi paketinkine eşit | DB değiştiyse: çöz → `public` sıfırla → `pg_restore` → sayı = önceki (aynı ölçü) | GERİ AL |
| 5 | `DOGRULAMA` | — | `--dogrulama` ile başlat | `TEKSERP_DOGRULAMA_KIPI=1 compose up -d --force-recreate backend` | `/health/yerel` (Linux: konteyner içinden) + imaj kimliği = bildirimdeki | durdur + yatıştır | DEVAM |
| 6 | `BASLAT` | — | durdur → normal başlat | `compose up -d --force-recreate backend` (kip değişkeni boş) | sürüm + DB sağlığı | durdur + yatıştır | DEVAM |
| 7 | `ONAY` | — | geçmiş · kurulum kaydı · budama · `CIT` kaldır | aynı + imaj budama (bu sürüm + bir önceki kalır, `docker image rm` yalnız `tekserp-korumali:*` ve kimliği bilinenler; `docker image prune` ÇAĞRILMAZ — başka projeye dokunmaz) | — | — | DEVAM |

**Yatıştırma (Linux):** çöken konteyneri Docker `unless-stopped` ile **hemen** (100 ms'den başlayıp ikiye katlanan aralıkla) yeniden başlatır; telafinin `compose stop`u konteyneri "kullanıcı durdurdu" durumuna geçirir ve yeniden başlatma döngüsü biter. Windows'taki "SCM kurtarmasını bekle, temiz durdur" penceresine gerek kalmaz ama ölçü aynıdır: telafi bittiğinde `state = Stopped` ve `RestartCount` artmıyor (2 ölçüm, 2 sn arayla).

**Açılış yarışı (A3) — Linux'ta neden doğal olarak kapalı, Windows'ta neden değil:** Docker `unless-stopped` konteyneri, `stop` ile durdurulmuşsa daemon ve konak yeniden başlasa da kendiliğinden BAŞLATMAZ; adım 1'den sonra backend'i yalnız güncelleyici başlatır. Windows'ta SCM, hizmeti başlangıç türüne göre her açılışta başlatır ⇒ adım 0 `CIT` gerekir. Çit, `GERI_DONDU` ve `BASARILI`da kaldırılır; `HATA`da kaldırılmaz (W3'ün kurtarma turu hâlâ sürüyorsa backend'i o başlatır).

### 2.3 Arıza kataloğu — her noktada ne olur

"Ne olur" sütunu iki platform için aynıdır; fark varsa belirtilir. **Sınıf:** G = geçici (bekle, adımı sürdür) · K = kesin (telafi → `GERI_DONDU`) · Ç = çökme (açılışta günlükten sürdür).

| Arıza | Nerede | Sınıf | Davranış | Kanıt (test) |
|---|---|---|---|---|
| Elektrik kesintisi / çekirdek paniği / `kill -9` | herhangi bir adım ya da telafi | Ç | açılışta yarım işlem: adım tablosundaki "yarımda" sütunu. Yırtık son satır atılır (bugün var) | `crash_restart` (sahte, var) + `kaos_guc_kesintisi` (gerçek VM'de, yeni) |
| Güncelleyicinin OOM ile ölmesi | herhangi | Ç | aynı. Linux birimi `OOMScoreAdjust=-900`; araç konteynerleri bellek tavanlı | `kaos_oom` (Linux, `systemctl kill -s KILL`) |
| Konak yeniden açılışı işlem ortasında | 1–6 | Ç | Windows: `CIT` sayesinde backend başlamaz; Linux: `unless-stopped`. Güncelleyici açılır → sürdürür | `acilis_yarisi` (sahte: "SCM açılışta başlatır" arızası, yeni) |
| Disk dolu — işlem günlüğü yazılamıyor | herhangi | G | **yedek alan dosyası** (`is/yedek-alan`, 64 MB, kurulumda doldurulmuş) silinir → günlük ve telafi için yer açılır → işlem GERİ AL'a döner (adım ilerletilmez); sonraki turlarda alan yeniden kurulur. Ön kontrol (§4.3) bunu nadir kılar | `disk_dolu_*` (sahte `Fs` ENOSPC enjeksiyonu her yazım noktasında, yeni) |
| Disk dolu — yedek sırasında | 2 | K | yarım döküm silinir → telafi (adım 1'in telafisi: eski backend başlar) → `GERI_DONDU/YEDEK_HATASI` | aynı + gerçek: küçük loop dosya sistemi (Linux CI) |
| Ağ kopması — indirme | hazırlık | G | sürdürülebilir indirme (bugün var); işlem başlamadan olur | `download_resumes_after_cut` (var) |
| Ağ kopması — işlem sırasında | 1–7 | — | işlem ağa ÇIKMAZ (aday uygulamadan hemen önce tazelenir, sonra ağ gerekmez) — tasarım gereği etkisiz | `ag_yok_islem_tamamlanir` (yeni) |
| Docker servisi çöktü / yanıt vermiyor (Linux) | 1–7 | G→K | `docker` "daemon'a bağlanılamıyor" çıkışı **altyapı bekleniyor** sayılır: adım `ALTYAPI_BEKLENIYOR` (bilgi, `durum.adim` değişmez) ile `altyapiBeklemeSn` (varsayılan 600) boyunca 10 sn aralıkla yeniden dener; süre dolarsa adım hatası → telafi; telafi de altyapı bekler (bkz. `HATA` kurtarması) | `docker_daemon_yok` (sahte + gerçek `systemctl stop docker`) |
| PostgreSQL ulaşılamıyor | 2, 4 | G→K | aynı altyapı bekleme kuralı (iki platform) | `pg_yok_*` (sahte, yeni) |
| Yarım indirme / bozuk paket | hazırlık | K | `PAKET_OZETI` · parça silinir · erteleme 15 dk × 4ⁿ (bugün var) | var |
| Bozuk imaj / `docker load` yarıda | hazırlık | K | yüklenen kimlik ≠ `imaj.kimlik` ⇒ etiket ve kimlik silinir (`PAKET_BAGI`), erteleme. Yarım `load` yalnız sarkık katman bırakır; güncelleyici kendi `load` öncesi/sonrası kimlik listesinin farkını siler (başka projeye dokunmaz) | `imaj_bozuk` (gerçek, Linux CI) |
| İmaj etiketi sonradan değiştirildi (root eli) | 5, 6 | K | her başlatmadan önce etiket → kimlik ölçülür; tutmazsa başlatılmaz → `GECIS_HATASI` → telafi | `imaj_etiketi_kaydi` |
| Göç hatası / 30 dk zaman aşımı | 4 | K | telafi: DB geri yükleme (bugün var) | `migration_failure_restores_database` (var) |
| Sağlık zaman aşımı / açılışta düşen sürüm | 5 | K | `SAGLIK_*` → telafi; düşen sürüm zaman aşımı BEKLENMEDEN (`SAGLIK_HIZMET_DUSTU`, Linux: `RestartCount` artıyor ya da `exited` + kod ≠ 0) | `startup_crash_rolls_back_early…` (var) + Linux eşi |
| Lisans kötüleşmesi (bütünlük, çekirdek, kademe) | 5 | K | §8.7 kuralı aynen | `license_regression_rolls_back` (var) |
| Telafinin kendisi düşer (ör. geri yükleme) | telafi | → HATA | **W3: `HATA` artık son durak değil.** Kurtarma turu: telafi zinciri 5 dk → 15 dk → 1 sa (tavan) aralıkla, süresiz yeniden denenir; her deneme günlüğe satır; panel ve yoklama raporu `HATA`yı görür (satıcı uyarısı); bir deneme biterse son durum `GERI_DONDU` olur ve `veriGeriYuklendi` doğru yazılır | `hata_kurtarma_turu` (sahte: geri yükleme N kez düşer sonra geçer, yeni) |
| Güncelleyici asılı kaldı (ölmüyor, ilerlemiyor) | herhangi | Ç | **iç bekçi (W3):** ana döngü her ilerlemede damga basar; ayrı iş parçacığı damga `adımZamanAsimi + 5 dk`dan eskiyse süreci `abort` eder → hizmet yöneticisi yeniden başlatır → günlükten sürdürülür. Linux'ta ek olarak systemd `WatchdogSec` + `sd_notify` (soket yazımı std ile; yeni crate yok) | `ic_bekci` (sahte saat) |

**`HATA`nın kalan anlamı (dürüst sınır):** yedek dosyası bozuk ya da çözülemiyor, ya da DB geri yüklemesi her denemede aynı kesin hatayla düşüyor. Bunlar insansız çözülemez; kurtarma turu yine de eski backend'i en az zararla **ayakta tutmaya** çalışır: `current` → eski ve göç başlamamışsa eski backend başlatılır (şema uyumlu); göç başlamış ve geri yükleme olmuyorsa backend BAŞLATILMAZ (eski kod + yeni şema değişmezi bozar), çit kalır, satıcıya `GUNCELLEME_BASARISIZ` + "insan gerekiyor" düşer.

### 2.4 İşlem günlüğünün kalıcılığı ve biçimi

- Satır biçimi bugünkü `{sira, islemId, adim, olay, zaman, veri}`; ISLEM satırına `v: 1` (yoksa 1 sayılır) ve `platform` eklenir. Adım adları iki platformda AYNIDIR (Linux'a özgü adım yok — fark adımın içindedir); yeni adım (`CIT`) eklenir, mevcut adın anlamı değişmez.
- **Eski günlüğü sürdürme (A9):** güncelleyici, KENDİSİNDEN ESKİ her sürümün bıraktığı yarım işlemi sürdürebilmelidir (kendini güncelleme ONAY'da ya da W1 ile işlemden ÖNCE olur; ikisinde de yarım işlem eski ikilinin günlüğü olabilir). Kural: adım listesi ISLEM satırının planından okunur (yoksa o sürümün sabit listesi — sürüm tablosu kodda); bilinmeyen adım adı → GERİ AL (fail-safe yön). Vektör: `native/test-vektorleri/guncelleyici-gunluk/` altında her yayınlanmış güncelleyici sürümünün her adımda yarım bıraktığı günlük; yeni ikili hepsini sonuca götürmeli (W0 bekçisi).

## 3. Hata kataloğu (ortak)

`GUNCELLEYICI.md` §12'deki kodlar iki platformda AYNEN kullanılır; rapor kodları (`UPDATE_RESULT_CODES`) değişmez — satıcının filo ekranı platform ayırmadan sayar. Yeni iç kodlar (yalnız ekler; her biri bir rapor koduna eşlenir, eşlemesiz kod `BILINMEYEN`):

| Yeni iç kod | Rapor kodu | Ne zaman |
|---|---|---|
| `ALTYAPI_BEKLENIYOR` (bilgi, `durum.bilgi`) | — | Docker/PG geçici olarak yok; adım bekliyor |
| `ALTYAPI_YOK` | `BASLATMA_HATASI` | altyapı bekleme süresi doldu |
| `IMAJ_KIMLIGI` | `PAKET_BAGI` | yüklenen ya da başlatılacak etiketin kimliği bildirimdekiyle tutmuyor |
| `IMAJ_YUKLENEMEDI` | `INDIRME_HATASI` | `docker load` çıkış ≠ 0 |
| `COMPOSE_HATASI` | `BASLATMA_HATASI` | compose dosyası ya da `.env` doğrulanamadı (`compose config -q`) |
| `CIT_HATASI` | `DURDURMA_HATASI` | Windows'ta başlangıç türü yazılamadı |
| `SURUM_PLATFORM` (sözleşme 5) | `IMZA_GECERSIZ` | bildirimin platformu ikilinin hedefi değil |
| `KURTARMA_SURUYOR` (bilgi) | — | `HATA` sonrası kurtarma turu (W3) |
| `GUNCELLEYICI_ONCE` (bilgi) | — | §4.2 — önce güncelleyici yerleşiyor |

Kodlar `codes.rs` + TS `UPDATE_RESULT_CODES` aynası + `guncelleme-rapor.json` vektörüyle tek commit'te iner (çekirdek kural: Rust aynası ve vektörler aynı commit).

## 4. Kendini güncelleme ve sözleşmenin dondurulması

### 4.1 Bugünkü A/B (iki platformda aynı mantık, ölçüldü)

`selfupdate.rs`: kurulu sürüm dizinindeki ikili imzalı listeyle doğrulanır → `.yeni`ye kopyalanır → **kopyanın** özeti listedekiyle tutmadan hiçbir ikili çalıştırılmaz → `kunye` (ad, sürüm, çapa kipi aynı) → çalışan → `.eski`, `.yeni` → asıl ad → çıkış 20 → hizmet yöneticisi yeni ikiliyle başlatır → açılış sayacı; doğrulanmadan 3. açılışı aşarsa `.eski` geri konur. Linux'ta çalışan ikili yeniden adlandırılabilir (inode); `Restart=always` çıkış 20'de de yeniden başlatır. **Kod platform bağımsızdır; Linux için yalnız `.exe` uzantısının kalkması ve hizmet kurtarma ayarının systemd karşılığı gerekir.**

### 4.2 Değişiklikler (W1 — iki platform)

1. **"Önce güncelleyici" (A1'in kapanışı):** paket `HAZIR` olduğunda (doğrulandı, açıldı, karar `KUR` · `ONAY_BEKLIYOR` · `PENCERE_BEKLIYOR` farketmez) paketteki güncelleyici ikilisi çalışandan YENİYSE, backend işleminden **önce** kendini güncelleme yapılır (`durum.bilgi = GUNCELLEYICI_ONCE`). Yeni ikili aynı paketi yeniden doğrular ve backend işlemini kendisi yürütür. Böylece güncelleyicinin backend yolundaki bir hatanın düzeltmesi, o hata yüzünden asla bloklanmaz. Koşullar: işlem günlüğünde açık işlem YOK; kurulu sürüm dizini (`current`) değil `surumler/<aday>` kaynak alınır (aday dizini zaten doğrulanmış); politika kendini güncellemeyi engellemez — `DONDUR`/K1 backend sürümünü dondurur, güncelleyicinin kendisi paketi kurmadan yalnız ikiliyi değiştirir. ⚠️ Bu, `DONDUR` kipinde bile ikili değişebilir demektir; ister misiniz → **Açık karar AK-3** (öneri: DONDUR'da da ikili güncellenir, K1'de güncellenmez).
2. **Son bilinen iyi (A2'nin kapanışı):** `.eski` ilk sağlıklı turda silinmez; `.lkg` ("son bilinen iyi") olarak kalır ve **yeni ikili bir backend işlemini BASARILI ya da GERI_DONDU ile sonuçlandırdığında** (yani uygulama yolunu uçtan uca koştuğunda) değiştirilir. Açılış sayacı kuralı aynen; buna ek olarak yeni ikili `HATA` ile biten ilk işleminde (W3 kurtarma turu da düşerse) `.lkg`ye döner ve işlemi o sürdürür (günlük biçimi ortak — §2.4).
3. **Doğrulama ölçütü sertleşir:** "ilk sağlıklı tur" = kilit alındı + günlük okundu + kira/HAK okundu + aday kararı verildi + `durum.json` yazıldı. Bugün yalnız turun bitmesi sayılıyor.

### 4.3 Hizmet tanımının kendisi (Windows SCM kaydı / Linux systemd birimi)

- **Windows (bugün):** güncelleyici her açılışta kendi SCM kurtarma ayarını beklenen değere getirir (yalnız farklıysa yazar) — sahaya kendini güncellemeyle gider. Aynı mekanizmaya backend hizmetinin başlangıç türü (çit) ve kurtarma ayarı eklenir.
- **Linux:** iki katmanlı birim.
  - **Taban birim** `/etc/systemd/system/tekserp-guncelleyici.service` — kurulumda bir kez yazılır, **DONMUŞTUR**: `ExecStart=/opt/tekserp/guncelleyici/tekserp-guncelleyici hizmet --kok /opt/tekserp --veri /var/lib/tekserp` · `Restart=always` · `RestartSec=10` · `StartLimitIntervalSec=0` (sonsuz yeniden deneme; Windows'ta "sayaç 1 günde sıfırlanır" karşılığı) · `KillMode=mixed`. Bu dosyayı güncelleyici HİÇ değiştirmez.
  - **Ek dosya** `tekserp-guncelleyici.service.d/50-tekserp.conf` — güncelleyici her açılışta kendi gömülü şablonuyla karşılaştırır, farklıysa yazar + `systemctl daemon-reload` (bir sonraki yeniden başlatmada etkin). Ek dosyaya yalnız **izin listesindeki anahtarlar** girebilir (`OOMScoreAdjust` · `WatchdogSec` · `LimitNOFILE` · `ProtectSystem`/`ReadWritePaths` sertleştirmesi · `Environment=` yalnız beyanlı adlar). `ExecStart`, `User`, `Restart` ASLA (bekçi `test_systemd_ek_izinli`: şablonu ayrıştırır, izin dışı anahtar → kırmızı; iki sonda). Bozuk bir ek dosya taban birimi geçersiz kılamaz: systemd tanımadığı anahtarı uyarıyla atlar, `ExecStart` taban birimdedir.
  - Backend için birim YOK: yaşam döngüsü Docker'dadır (`unless-stopped`); Docker'ın kendisi dağıtımın birimiyle açılır.

### 4.4 Ayrı Windows güncelleyici kurulumu (C) — değerlendirme ve öneri

Bugün: D5 setup ve D6 geçiş güncelleyici hizmetini kurar; ikili backend paketinin `runtime\`inde gelir (PAKET imzalı kapsam) ve A/B ile kendini günceller.

| Ölçüt | Ayrı setup (ayrı ürün, ayrı yayın) | Tek paket + kendini güncelleme (W1 ile) |
|---|---|---|
| Güncelleyici bozulursa kurtarma | Ayrı setup elle koşulur — **fabrika başına insan**; onlarca fabrikada H1'i bozar | A/B sayacı + `.lkg` (otomatik); hepsi düşerse aynı setup'ın "onar" yolu ikiliyi paketten yeniden yazar (bugün var: D5 onarımı) — ayrı setup'ın sunduğu tek şey zaten var |
| Kim günceller? | Yine güncelleyici kendini güncellemek zorunda (yoksa her sürümde insan) ⇒ A/B yolu ortadan kalkmaz, üstüne ikinci yayın yolu eklenir | tek yol |
| Sürüm çarpıklığı | güncelleyici N × backend M matrisi; hangi çiftin uyumlu olduğu ayrı sözleşme ister | ikili, birlikte test edildiği backend paketiyle gelir; "önce güncelleyici" ile aday paketin güncelleyicisi, kurulu backend'le çalışmak ZORUNDADIR — bu tek yönlü uyum §4.5'teki dondurma kuralıyla ve yükseltme matrisiyle (T2) ölçülür |
| İmza / kanal | ayrı ürün yolu (`/<grup>/guncelleyici/`), ayrı bildirim türü ya da `urun` değeri, ayrı yayın defteri, ayrı terfi, Worker deseni — sözleşme 5'e bir ürün daha | yok (aynı PAKET zinciri, aynı bildirim) |
| Güncelleyiciyi backend'den bağımsız düzeltebilmek | evet | evet — W1 ile: güncelleyici düzeltmesi bir backend yama sürümünde gelir, backend tarafı geri dönse bile ikili yerleşir |
| Hareketli parça | +1 yapıt, +1 yayın, +1 kurulum adımı, +1 test boyutu | değişmez |

**Öneri: tek setup + kendini güncelleme kalsın; W1 (önce güncelleyici + son bilinen iyi) yapılsın.** 1e'nin ön görüşüyle aynı yöne çıkıyor; ölçülen fark şu: ayrı setup'ın tek gerçek artısı "güncelleyiciyi backend'den bağımsız düzeltebilmek"ti ve bunu W1 ayrı yapıt olmadan sağlıyor. Ayrı setup gerektiren tek durum, güncelleyicinin **kendini güncelleme yolunun kendisinin** bozuk olmasıdır; buna karşı önlem ayrı setup değil, o yolun dondurulması (§4.5 madde 4) ve `.lkg`dir.

### 4.5 Sözleşmenin dondurulması — güncelleyici neden nadiren değişir

Güncelleyicinin değişmesini gerektiren şeyler sözleşmeden doğar; sözleşme şu kurallarla dondurulur (W0 bu kuralları sözleşme belgesine yeni bir "sözleşmenin dondurulması" bölümü olarak yazar ve bekçiye bağlar):

1. **Her dosya `v` taşır, okuyucu tanımadığı alanı atar** (bugün: bildirim, işaretçi, niyet, durum zaten böyle). Anlamı daraltan değişiklik `v`yi artırmaz — **yeni ad alır, eskisinin yanına yazılır** (D7/D8 zincir dosyalarının kanıtlanmış kalıbı: `son-zincir.json` `son.json`un yanında; eski okuyucu yeni adı hiç okumaz). Böylece eski güncelleyici yeni yayını "kibarca reddetmez", **hiç görmez** ve eski biçimde yayın sürdükçe çalışmaya devam eder.
2. **Yayıncı eski biçimi filo ölçüsüyle emekliye ayırır:** eski ad, satıcının yoklama raporlarında (`guncelleyici.surum`) o grubun bütün kurulumları yeni okuyucuya geçene dek yayınlanır. Yayın betiği bu ölçüyü satıcıdan okur ve eski adı erken bırakmayı REDDEDER (F1).
3. **Yeni güncelleyici eski kurulumda çalışır:** yeni ikili; eski `durum.json`u, eski günlüğü (§2.4), eski `ayar.json`u, eski niyeti ve eski backend'i (`/health/yerel`siz backend dahil — bugün var) okur. Vektör klasörleri: `guncelleyici-gunluk/` · `guncelleyici-durum/` (var) · yeni `guncelleyici-ayar/` · `guncelleyici-niyet/`. Her yayınlanmış biçim örneği sonsuza dek klasörde kalır (silinmez — bekçi sayının düşmediğini ölçer).
4. **Dondurulmuş çekirdek yol:** kendini güncelleme yolu (ikiliyi doğrula → kopyala → kopyayı doğrula → `kunye` → yer değiştir → sayaç) ve günlük sürdürme yolu, bu plandan sonra yalnız **güvenlik düzeltmesiyle** değişir; değişirse T2 matrisinde "eski ikili → yeni ikili → bir sonraki ikili" üç halkalı zincir koşulmadan yayın çıkmaz (yayın kapısı: güncelleyici sürümü değişen paket, paket kimliğinde `guncelleyici.surum` farkıyla tanınır ve `kendi_guncelleme_zinciri` kanıt dosyası ister).
5. **Bildirimdeki `minKaynakSurum` ile ara sürüme sabitleme** (bugün var) güncelleyici için de kullanılır: güncelleyici yolunu kıran (çok nadir) bir değişiklik iki adımda yayınlanır — önce yeni biçimi okuyan ikili eski biçimle, sonra yeni biçim.

### 4.6 Güncelleyici güncelleyiciyi bozamaz — değişmezler

- Doğrulanmamış bayt hiçbir zaman çalıştırılmaz (bugün var: kopyanın özeti).
- Çapa kipi geçmez (hazırlık ↔ üretim, G3; bugün var).
- Platform geçmez: `kunye.hedef` = çalışan ikilinin hedefi (yeni; Windows paketindeki ikili Linux'a yerleşmez ve tersi).
- Asıl adda her an çalıştırılabilir bir ikili vardır (iki yeniden adlandırma arasında ölüm: eski ikili asıl adda; bugün var).
- Ek dosya (Linux) taban birimin `ExecStart`ını değiştiremez (§4.3).
- Sayaç, `.lkg` ve kurtarma ayarı güncelleyicinin özel alanındadır (`is/kendi.json`), backend yazamaz.

## 5. Doğrulama zinciri (yükten önce)

Sıra iki platformda aynı halkalardan geçer; Linux'a özgü olan yalnız 5–7'dir.

1. **İşaretçi seçimi:** `son-zincir.json` (zincirli) adayları + kid'li `surum-zincir-<kid>.json` (D8, `select_chained`); zincirli aday yoksa eski `son.json`/`surum.json`. Belirsizlik ya da geçerli yok ⇒ FAIL-CLOSED (`SURUM_ISARETCI`).
2. **Bildirim:** JWS (`tekserp-surum`) → kid: `paket-*` gömülü çapa ya da `pkt-*` kök imzalı PAKET sertifikası (imza anında geçerli, `KABUL` toleransı 180 gün) → **PAKET iptal belgesi** (`paket-iptal.jws`, en yüksek `sira`; iptal edilmiş kid'in imzası geçmez) → şema → imzalayan = `paketImzaKid` → kanal (grup) = kiranınki → **platform = ikilinin hedefi** (sözleşme 5).
3. **Anahtar kümesi süzgeci:** hazırlık anahtarı yalnız HAK sınıfı TEST/DEMO'da; BARINDIRILAN ve ÜRETİM'de asla (G3).
4. **Disk ön kontrolü (indirmeden ÖNCE):** Windows bugünkü `paket × 3 + 2 GB`. Linux iki dosya sistemi ölçer: `/var/lib/tekserp` ≥ `paket.boyut × 2 + DB boyutu × 1,2 + 2 GB` (dış tar + açılmış kopya + güncelleme öncesi yedek) ve Docker kökü ≥ `imaj açılmış boyutu (bildirimde yoksa paket × 3) + 1 GB`. DB boyutu `pg_database_size` ile ölçülür (ölçülemezse 2 GB varsayılır). Yetmezse önce budama (aşağıda), sonra yeniden ölçüm; yine yetmezse `DISK_DOLU`, işlem BAŞLAMAZ.
5. **Paket:** dış tar boy + sha256 = bildirim (`PAKET_OZETI`) → tar yalnız `surumler/.hazirlik-<v>/`e, yalnız göreli düz dosya olarak açılır (sembolik bağ, aygıt, `..` RED — `PAKET_YOL`) → `PAKET-DOCKER.json` imzası (zincir dosyası öncelikli) + `butunluk-liste.txt` + listedeki her üyenin özeti → `checkPackageBinding` (paketId · ürün · sürüm · derleme anı · müşteri `null`/grup).
6. **İmaj:** `docker load -i <imaj tar>` YALNIZ 5 geçtikten sonra → yüklenen kimlik = `imaj.kimlik` (değilse `docker image rm` + `IMAJ_KIMLIGI`) → etiket `tekserp-korumali:<sürüm>` kimliğe bağlanır. `docker load` ağa çıkmaz (T5); compose `pull_policy: never` (§1.2) çekmeyi imkânsız kılar; ek olarak kurulum `daemon.json`a kayıt aynası YAZMAZ ve konakta `docker login` yoktur.
7. **Compose:** `docker compose -f surumler/.hazirlik-<v>/docker-compose.yml config -q` (biçim) + compose denetiminin bulut kipi kurallarının güncelleyiciye gömülü alt kümesi (servis başına `read_only`, `cap_drop: ALL`, `no-new-privileges`, port yalnız `kenar`da, soket bağı yok, `pull_policy: never`) — imzalı dosya bile bu kurallara uymuyorsa YÜKLENMEZ (savunma derinliği; `COMPOSE_HATASI`).
8. **Hazır işareti** (`is/hazir/<v>`) → `HAZIR`. Uygulamadan hemen önce işaretçi ve karar yeniden (bugün var).

**Budama (son N):**

| Ne | Windows | Linux | Ne zaman |
|---|---|---|---|
| Sürüm dizinleri | `current` + bir önceki | aynı | ONAY |
| İmajlar | — | `current`in imajı + bir önceki; yalnız `tekserp-korumali:*` ve kimliği bizim kayıtlarımızda olanlar | ONAY + disk ön kontrolü |
| Güncelleme öncesi yedekler | son 3 | son 3 (BULUT §5.1) | ONAY |
| Geçici yedek anahtarları | sonraki başarılı işleme dek | aynı | ONAY |
| İndirme parçaları | işlem başlamadan, aday değişince | aynı | tur |
| Hazırlık dizinleri / yarım `load` artığı | sonraki tur | aynı | tur |

## 6. Filo ölçeği

### 6.1 Bugün var olanlar (yeniden yazılmaz)

Güncelleme grupları `test → oncu → genel` (satıcı `Kanal`; kurulum bir gruba bağlı; terfi aynı baytları kopyalar ve işaretçiyi hedef grup için yeniden imzalar — TEK-ORTAK-PAKET S3) · kurulum başına politika (OTOMATIK · ONAYLI · DONDUR, pencere, sabitleme `hedefSurum`) · K1 (`yaptirim.guncellemeDonuk`, kurulum başına acil durdurma) · zil (politika değişince kurulum hemen yoklar) · yoklama raporu (`bekleyen` · `son` · `guncelleyici.surum`) · satıcı defteri `kurulum_kaydi` + olaylar `GUNCELLEME_TAMAMLANDI` · `GUNCELLEME_GERI_DONDU` · `GUNCELLEME_BASARISIZ` (giden kutusu → e-posta + Telegram).

Bu, gruplar düzeyinde zaten bir **kanarya → öncü → genel** zinciridir. Eksik olan: grubun İÇİNDE kademelendirme ve kendi kendini durdurma.

### 6.2 Dalga — güncelleyiciye DOKUNMADAN (F1)

**Mekanizma, var olan alanla:** satıcı her kiranın `guncelleme.hedefSurum`unu (sabitleme) basarken bir **dalga tavanı** uygular: `etkin hedef = min(insanın sabitlemesi, dalga tavanı)`. Dalgaya henüz girmemiş kurulumun kirasında `hedefSurum` = gruptaki bir önceki sürüm ⇒ güncelleyici `GUNCEL/HEDEF_ULASILDI` der ve indirmez. Sözleşme, güncelleyici ve backend DEĞİŞMEZ; eski güncelleyiciler de dalgaya uyar. (Portal insan sabitlemesini ve dalga tavanını ayrı gösterir; kirada ikisinin minimumu gider.)

- **Dalga ataması belirlenimlidir:** kurulum kimliğinin özeti → 0–99 kova; dalga sınırları sürüm başına (varsayılan öneri: `genel` grubunda %10 → %50 → %100; kurulum sayısı küçükken en az 1 kurulum). Öncü/test gruplarında dalga yok.
- **İlerleme olay tabanlıdır, takvim tabanlı değil:** bir sonraki dalga, mevcut dalgadaki kurulumların ≥ %80'i bu sürüm için bir SONUÇ bildirdiğinde (`son.hedefSurum = X`, sonuç ne olursa) ve eşik aşılmadıysa açılır. Pencere politikası gereği sonuç genellikle bir gecede gelir; ölçü sonuca bağlıdır, güne değil.
- **Otomatik durdurma:** bir sürümün dalgasında `GERI_DONDU` + `BASARISIZ` sayısı **≥ 2 kurulum ya da ≥ %10** (hangisi önce) olunca sürüm o grupta **DONAR**: dalga tavanı ilerlemez, satıcıya "yayılım durdu" bildirimi gider (yeni olay `GUNCELLEME_YAYILIM_DURDU`); zaten güncellenmiş kurulumlara dokunulmaz (geri inme yok). Çözme yalnız insan kararıyla (portalda gerekçeli; `kurulum_kaydi` karar satırı). Eşik sayıları açık karar AK-2.
- **Filo acil durdurma:** bir sürümü bütün gruplarda donduran tek düğme (dalga tavanı = sürüm öncesi, her kuruluma zil). Kurulum başına K1'den ayrı bir şeydir (K1 yaptırımdır, lisans yüzüne yansır); bu yalnız yayılımı durdurur. Zaten indirilmiş ama uygulanmamış paket, uygulamadan hemen önce yeni kiraya göre karar verilir (bugün var: aday ve karar tazelenir) — **ama** kira saatlik yenilenir, zil ile hızlanır; zil kaçarsa en kötü 1 sa gecikme kabul edilir (pencere içindeki kurulumlar için gerçek bir risk: acil durdurma "bundan sonra başlayacak olanları" durdurur, başlamış işlemi DURDURMAZ — başlamış işlem kendi sağlık ölçüsüyle biter ya da döner).

### 6.3 CDN yükü (A8, W5)

- **İşaretçi sorgusu:** bugün aday ≤ 5 dk'da bir tazelenir. Yeni kural: aday, (a) kira yenilendiğinde (saatlik + zil) ve (b) en geç 6 saatte bir, kurulum kimliğinden türeyen sabit bir kaydırmayla sorgulanır; `HAZIR` iken ve uygulamadan hemen önce bugünkü tazeleme aynen. 300 kurulum × 24 = ~7.200 istek/gün (bugün ~86 bin).
- **Paket:** sürüm dizini DEĞİŞMEZ ve uzun önbellekli (bugün var) ⇒ kaynağa POP başına bir kez gelir. Yüzlerce kurulumun aynı pencere başında birden indirmesi beklenmez: indirme pencereden BAĞIMSIZ, aday göründüğü anda (kaydırmalı) yapılır; pencere yalnız UYGULAMAyı başlatır.
- **Worker kotası:** belirteç doğrulaması her istekte Worker'dan geçer; ücretsiz katmanın günlük istek sınırı ölçülerek izlenir (F1: yayın defterinin yanında günlük sayım; %50'yi geçince uyarı). Linux paketi (imaj tar ~0,3–0,5 GB, ölçülecek) Windows zip'inden büyüktür; bant genişliği Cloudflare önbelleğinde maliyet doğurmaz, kaynak VDS'e yalnız önbellek ıskasında gelir.
- **İndirme kesilirse** sürdürülebilir indirme (Range) bugün var; Linux tar'ı için de aynı kod.

## 7. Gözlemlenebilirlik

| Yüzey | Windows (bugün) | Linux | Not |
|---|---|---|---|
| Durum dosyası `durum.json` + kalp atışı (`sonCanlilik`, `canlilikEsigiSn`) | `%ProgramData%\TeksERP\guncelleme\durum\` | `/var/lib/tekserp/guncelleme/durum/` → konteynere `ro` | biçim AYNI (§5.2); backend `TEKSERP_GUNCELLEME_DIZINI`den okur — Linux'ta bu değişken compose'da ÜRETİM değeridir (bugün "geliştirme/test" diye belgeli; L5 sözleşme cümlesini günceller) |
| Geçmiş `gecmis.jsonl` | aynı dizin | aynı dizin | aynı |
| Panel "Sistem → Sunucu Güncellemeleri" + onay ucu | var (D7) | DEĞİŞMEZ — aynı uçlar, aynı eşleme (`Teks-Erp/src/services/update-status.service.ts`) | yalnız yeni bilgi kodları (`ALTYAPI_BEKLENIYOR` · `KURTARMA_SURUYOR` · `GUNCELLEYICI_ONCE`) panelin "Bilgi" satırına düşer |
| Sunucu simgesi (`/health/tepsi`) | var | yok (bulutta masaüstü yok) | — |
| Güncelleyici günlüğü | `<KOK>\guncelleyici\gunluk\guncelleyici.log` (UTC, 10 MB × 10) | `/opt/tekserp/guncelleyici/gunluk/guncelleyici.log` aynı döndürme (`tekserp-hizmet` `RotatingLog`, platform bağımsız) **+** stderr → systemd günlüğü (BULUT §1.4: 500 MB tavan) | sır yok; araç çıktısındaki `şema://kullanıcı:parola@` maskelenir (bugün var) |
| Olay günlüğü | Uygulama olay günlüğü | systemd günlüğü (`SYSLOG_IDENTIFIER=tekserp-guncelleyici`) | düzeyler aynı |
| Backend/araç çıktısı | konak `logs\backend-*.log` | Docker `json-file` 20 MB × 5 (`daemon.json`); araç konteynerinin çıktısı güncelleyici günlüğüne süzülerek kopyalanır (son 200 satır) | — |
| Yoklama raporu → satıcı | var | aynı; platform satıcıda kurulumun kaydından (bulut kurulumu `BARINDIRILAN`, platform kanal kaydının `bulut.platform`unda) — yeni tel alanı gerekmez | filo ekranı platformu kendi kaydından gösterir |

**Satıcı uyarıları (F1):** `HATA` (bugün `GUNCELLEME_BASARISIZ`) · `KURTARMA_SURUYOR` 1 saatten uzun · güncelleyici `OLCULEMEDI`/`DURDU` 2 yoklamadan uzun · sürüm başına yayılım durdu. Hepsi var olan giden kutusundan (e-posta + Telegram); yeni kanal açılmaz.

**Tanı paketi (W4, iki platform):** `tekserp-guncelleyici tani --kok <KOK> [--veri <D>] --cikti <dosya.zip>` (zip yazımı var olan `zip` crate'iyle; yeni bağımlılık yok). İçerik: `durum.json` · `gecmis.jsonl` · `islem.jsonl` (son 5 işlem) · `kendi.json` · `ayar.json` · `ertele.json` · güncelleyici günlüğünün son 5 MB'ı · kurulu sürümlerin ve `current`in listesi · `kurulum-gecmisi.jsonl` son 20 satır · disk ölçümleri · hizmet/konteyner durumu (Windows: SCM durumu + başlangıç türü + kurtarma ayarı; Linux: `docker inspect` süzülmüş alanlar, Docker sürümü, systemd birim durumu) · `kunye`. **Girmez:** `.env` (yalnız ANAHTAR ADLARI), kira/HAK/iptal belgelerinin kendisi (yalnız sha256 + `kid` + bitiş), niyetteki belirteç (yalnız var/yok + bitiş), yedekler, geçici anahtarlar. Paketin içine `ICINDEKILER.txt` (her dosya + özet) yazılır. Paketi dışarı GÖNDERMEZ — fabrikadan dışarı giden her istek kurulum anahtarıyla imzalanır ve güncelleyici kurulum anahtarını kullanmaz; destek paketi Windows'ta yöneticiden, bulutta SSH ile alınır. (Sonraki adım, bu planın dışında: backend'in var olan hata raporu kanalı `durum.json`un süzülmüş özetini taşıyabilir.) Bekçi `tani_paketi_sir_tasimaz` (sahte dünyaya bilinen sırlar konur, paket baytlarında aranır; iki sonda).

## 8. Kurulum

### 8.1 Bulut (BULUT-KURULUM §2'ye bağlanış)

Tek komut kurulumunun (`deploy/bulut/kur.mjs`, B6) adım 6–7'si güncelleyiciyi kurar; L7 bu adımları B6'dan ÖNCE, tek başına çağrılabilir bir alt komut olarak yazar (B6 onu çağırır):

1. **İlk ikiliye güven (yumurta–tavuk):** güncelleyici ikilisi paketin İÇİNDEDİR. Mac'teki kurulum aracı paketi önce TS doğrulayıcıyla doğrular (aynı protokol kodu: zincir dosyası seçimi → bildirim → kanal/grup → tar özeti → künye imzası → listedeki her üye), ancak sonra VDS'e kopyalar. VDS'te ikili, listedeki sha256'sıyla `sha256sum` ölçülmeden çalıştırılmaz. İlk çalıştırma `kurulum-paket --tar <dosya> --hedef /opt/tekserp/surumler/<v>` olur ve ikili paketi KENDİ gömülü çapasıyla baştan doğrular (iki bağımsız doğrulayıcı aynı sonucu vermezse kurulum DURUR).
2. `tekserp-guncelleyici hizmet-kur --kok /opt/tekserp --veri /var/lib/tekserp --proje <proje>`: dizin iskeleti + sahiplik/izinler (§1.2 tablosu) · `ayar.json` (`guncellemeSunucusu` = `https://guncelleme.etkiliyazilim.com`, proje adı; ZORUNLU) · taban birim + ek dosya · `is/yedek-alan` (64 MB) · `daemon-reload`. Tekrarlanabilir (var olanı ölçer, farklıysa yazar).
3. `kurulum-paket` → `surumler/<v>` + `current` + `docker load` + kimlik ölçümü + compose doğrulaması (§5 halkaları aynen).
4. İlk göç: `compose run --rm backend goc` (açılışta göç yok kuralı ilk kurulumda da geçerli) → `compose up -d postgres backend yedek` (+ kenar) → `/health/yerel` konteyner içinden.
5. `systemctl enable --now tekserp-guncelleyici` → ilk tur: kira henüz yoksa `DONDURULDU/KIRA_YOK` (beklenen; etkinleştirme müşteri yetkilisinin ilk girişindedir, BULUT §2 adım 10).
6. Kurulum kaydı: güncelleyici sürümü = paketteki ikilinin `kunye.surum`u (kurulum aracı satıcı kurulum kaydına "betik sürümü" ile birlikte yazar).

### 8.2 Bugünkü elle Docker kurulumlarından geçiş (deneme VDS dahil)

`docs/ops/LINUX-DOCKER-KURULUM.md` §2 ile kurulmuş bir sunucuyu güncelleyici düzenine almak Windows'taki D6 geçişinin karşılığıdır (`gecis` alt komutu, L7): var olan `.env`deki `TEKSERP_IMAJ` → aynı sürümün imzalı paketi `surumler/<v>`e açılır (imaj zaten yüklüyse kimlik ölçülür, YENİDEN YÜKLENMEZ), `current` kurulur, `.env` `yapilandirma/`e taşınır. **Proje adı (`TEKSERP_PROJE`) DEĞİŞMEZ** — birim adları `<proje>_pg_data` · `<proje>_lisans` · `<proje>_yedek` · `<proje>_yedek_anahtar` aynı kalmalı (F5 = PG küme kimliği; lisans birimi = kurulum anahtarı; `LINUX-DOCKER-KURULUM` §9). Veritabanına dokunulmaz, göç koşulmaz; geçişin geri alınışı tek komuttur (`gecis --geri-al`: eski compose + `.env` yerine). Geçiş, veriyi taşıyan birimlere hiçbir yoldan yazmaz (bekçi: güncelleyici kaynağında `down -v` · `volume rm` · `system prune` · `image prune` dizgeleri YOK — `test_guncelleyici_yikici_docker_yok`, iki sonda).

### 8.3 Müşteri sunucusu (Linux fabrika sunucusu) — uygun mu?

Güncelleyici tarafında **engel yok:** gelen port açmaz, yalnız CDN'e ve (backend üzerinden) lisans sunucusuna çıkar; Tailscale istemez; root'ta koşan tek hizmettir; politika/pencere/onay fabrikadakiyle aynı. Engeller güncelleyicinin dışındadır: (1) Docker kurulumunda fabrika ağı TLS'i yok — yalnız şifreli bağlanan panel ve tablet bağlanamaz (`LINUX-DOCKER-KURULUM` §7); fabrika içi kenar (LAN sertifikası) ayrı iş · (2) kurulum aracı Mac + SSH'tır; müşteri yerinde kullanıcının kendisi kurar (kullanıcı kararı 2026-10-02) ⇒ yerinde çalışan bir kurulum betiği gerekir · (3) konteynerde parmak izi zayıf tanımadır (iki etken). Karar kullanıcının: **AK-1**.

## 9. Test stratejisi — "bir kere yap, hep çalışsın"ın kanıtı

İlke: H1–H3'ün her cümlesi bir **senaryoya**, her senaryo **iki platform profilinde** bir teste, her test bir **kapıya** bağlanır. Sahte dünya (hızlı, belirlenimli, her makinede) ispatın ana gövdesidir; gerçek platform testleri sahte dünyanın gerçeği doğru taklit ettiğini ölçer.

### 9.1 Katmanlar

| Katman | Ne ölçer | Nerede koşar | Neden orada |
|---|---|---|---|
| **K0 Vektörler** | TS ↔ Rust sözleşme aynası (bildirim · kira · karar · rapor · zincir seçimi · env · şema hizası) + yeni: sözleşme 5 · eski biçim klasörleri (`guncelleyici-gunluk/`, `-ayar/`, `-niyet/`, `-durum/`) | Mac (`cargo test`), CI ubuntu-latest + windows-latest | saf hesap; platformdan bağımsız |
| **K1 Sahte dünya** (`tests/common`, bugün ~30 senaryo) | durum makinesi, telafi, öldür-yeniden başlat, arıza enjeksiyonu | aynı üç yer | belirlenimli; bir PR'ı dakikada ölçer. Windows CI'ı yalnız NTFS junction/yeniden adlandırma gerçeği için ek değer katar |
| **K2 Gerçek platform dumanı** | sahte dünyanın varsaydığı platform davranışı gerçekte de öyle mi | Windows: windows-latest (`duman-windows.ps1`, gerçek SCM — bugün var) · Linux: ubuntu-latest (gerçek systemd + gerçek Docker; GitHub'ın Ubuntu makinelerinde ikisi de hazır) | hızlı, her PR'da; yeniden açılış ve güç kesintisi YAPAMAZ |
| **K3 Gerçek uçtan uca** | gerçek korumalı paket/imaj + gerçek PG + gerçek göçler + panel ekranı | Windows: thinkpad-1 (gerçek Windows 11, kendi PG örneği, bugünkü D-prova makinesi) · Linux: ubuntu-latest (elle tetiklenen iş) | windows-latest kalıcı hizmet ve yeniden açılış taşımaz; thinkpad sahaya en yakın Windows'tur |
| **K4 Yükseltme matrisi** | N→N+k, göçlü/göçsüz, geri dönüş, kendini güncelleme zinciri, eski↔yeni güncelleyici | sentetik sürüm zinciri: sahte dünyada (her PR) + gerçek platformda (Linux ubuntu-latest gecelik; Windows thinkpad, güncelleyici sürümü değişince) | gerçek eski sürümler yeniden derlenemez (bayt kodu V8'e kilitli); sentetik zincir aynı ikiliden, göç ve ikili sürümü farklı paketler üretir |
| **K5 Kaos / uzun koşu** | rastgele arıza altında yüzlerce döngüde değişmez hiç bozulmuyor mu | Linux: ubuntu-latest gecelik · gerçek güç kesintisi: deneme VDS (sağlayıcı panelinden sert yeniden başlatma) ve thinkpad (`shutdown /r /f /t 0` + fişten çekme) — elle, güncelleyici sürümü değişince | CI makinesi kendini yeniden başlatamaz; gerçek güç kesintisi yalnız gerçek makinede ölçülür |
| **K6 Deneme VDS provası** | bizim gerçek bulut düzenimizde ilk kurulum + ilk otomatik güncelleme | 213.142.134.226 (`deneme.etkiliyazilim.com`) | ilk BARINDIRILAN müşteriden önce şart (BULUT B11'in güncelleyici kısmı) |

**Mac'te ne koşar:** K0 + K1 (tam paket) ve sentetik sürüm zincirinin üretimi. Mac'teki Docker Desktop'ta konak systemd'si yoktur ve Linux sanal makinesi gizlidir ⇒ Linux arka ucunun gerçek testi Mac'te yapılmaz; Lima/UTM gibi yeni bir araç da eklenmez (GitHub Ubuntu makineleri yeter). Mac'te Docker katmanı için yalnız `duman-linux` betiğinin "güncelleyicisiz" bölümü (imaj yükle → kimlik → compose doğrula) koşabilir.

### 9.2 Sahte dünyanın iki profili (K1'in genişlemesi — W0/L4b)

Bugünkü `tests/common` Windows anlamını taklit eder (SCM kurtarması 5/5/30, junction). Senaryolar `senaryo(profil)` biçimine çevrilir ve **aynı senaryo iki profilde** koşar:

| Profil davranışı | Windows profili | Linux profili |
|---|---|---|
| Çöken hizmet | 5 sn sonra kurtarma (bugün var) | Docker `unless-stopped`: hemen, artan aralıkla; `stop` sonrası yok |
| Açılış (yeni "yeniden açılış" olayı) | backend başlangıç türü otomatikse başlatılır (çitle `demand` ⇒ başlatılmaz) | `stop` edilmiş konteyner başlamaz; edilmemiş başlar |
| Altyapı | PG hizmeti durabilir | PG konteyneri + Docker servisi durabilir (`daemon_down_for`) |
| Sağlık sondası | HTTP | `exec` (çıktı satırı) |

**Eklenecek arıza düğmeleri (`Faults`):** `enospc_at(k)` (k'ıncı yazımda ENOSPC — her yazım noktası için döngü) · `eio_at(k)` · `daemon_down_for(sn)` · `pg_down_for(sn)` · `hang_at(adım)` (iç bekçiyi ölçmek için çağrı dönmez) · `reboot_at(k)` (öldür + platformun açılış davranışı) · `clock_jump(±sa)` · `image_tag_tampered` · `restore_fails_times(n)` (HATA kurtarma turu) · `old_journal(sürüm, adım)` (eski güncelleyicinin yarım günlüğü). **Değişmez ölçer** (`assert_invariants`, bugün var) her senaryo sonunda iki profilde aynı kuralları ölçer: tek backend · `current` ↔ şema uyumu · yetim araç yok · düz döküm/anahtar yok · günlük kapalı · `durum.json` son durumla tutarlı · çit kaldırılmış (GERI_DONDU/BASARILI).

### 9.3 Ortak senaryo matrisi

Her satır iki profilde (W = Windows, L = Linux) koşar. "Kapı": **PR** = `native-windows.yml` + yeni `native-linux.yml` (yol süzgeci `Teks-Erp/native/**`, bugünküyle aynı) · **Gece** = gecelik iş · **Sürüm** = yayın kapısının istediği kanıt (§9.5).

| Senaryo | K1 (W+L) | K2 | K4/K5 gerçek | Test / bekçi adı | Kapı |
|---|---|---|---|---|---|
| Mutlu yol | var → iki profil | W var · L yeni | ✓ | `happy_path_updates_and_records` | PR |
| Her değiştiren işlemden önce öldür (başarı ve geri dönüş yolu) | var → iki profil | — | K5 rastgele | `kill_at_every_point_*` | PR |
| Geri alma sırasında çift öldürme | var → iki profil | — | — | `double_kill_during_recovery` | PR |
| Her yazım noktasında disk dolu | yeni | L: loop dosya sistemi | K5 | `disk_dolu_her_yazimda` | PR |
| Yeniden açılış her adımda (açılış yarışı, A3) | yeni | W: `sc config` + hizmet yeniden başlatma · L: `systemctl restart docker` | thinkpad + VDS gerçek yeniden açılış | `acilis_yarisi_her_adimda` | PR + Sürüm |
| Docker servisi / PG geçici yok | yeni | L: `systemctl stop docker` 60 sn | K5 | `altyapi_bekleme` | PR |
| Göç hatası → DB geri yükleme | var → iki profil | L yeni | K4 | `migration_failure_restores_database` | PR |
| Açılışta düşen sürüm | var → iki profil | L yeni | K4 | `startup_crash_rolls_back_early…` | PR |
| Lisans kötüleşmesi | var → iki profil | — | K3 | `license_regression_rolls_back` | PR |
| Telafi düşer → HATA → kurtarma turu | yeni | — | — | `hata_kurtarma_turu` | PR |
| Asılı çağrı → iç bekçi | yeni | L: `WatchdogSec` gerçek | — | `ic_bekci` | PR |
| Bozuk paket / bozuk imaj / etiket kaydı | paket var · imaj yeni | L: gerçek `docker load` | — | `imaj_bozuk` · `imaj_etiketi_kaydi` | PR |
| Ağ kesintisi (indirme sürer; işlem ağa çıkmaz) | var + yeni | — | K5 `iptables` | `download_resumes_after_cut` · `ag_yok_islem_tamamlanir` | PR |
| Kendini güncelleme: A/B, 3 açılış, kopya değişti, öteki çapa, öteki platform | var → + platform | W var · L yeni (gerçek rename + systemd yeniden başlatma) | K4 zinciri | `self_update.rs` + `kendi_platform_gecmez` | PR |
| Önce güncelleyici (backend geri dönse bile ikili yerleşir) | yeni | — | K4 | `once_guncelleyici` | PR + Sürüm |
| Son bilinen iyiye dönüş (gizli hata) | yeni | — | K4 | `lkg_donusu` | PR |
| Eski güncelleyicinin yarım günlüğünü yeni ikili sonuçlandırır | yeni (vektör klasörü) | — | K4 | `eski_gunluk_surdurulur` | PR |
| Eski güncelleyici + yeni yayın (zincir/yeni ad yanında) | var (D7 prova) → genişler | — | K4 | `prova-paket-zinciri` + `eski_okuyucu_yeni_yayin` | PR |
| N→N+5 (`minKaynakSurum` → ara sürüme sabitleme) | yeni | — | K4 | `atlamali_yukseltme` | Gece |
| Pencere sınırında başlayan işlem pencere kapansa da biter | var | — | — | `decision` vektörleri | PR |
| Dalga tavanı → `HEDEF_ULASILDI` (güncelleyici değişmeden) | vektör | — | — | `guncelleme-karar.json` yeni kayıtlar | PR |
| 100 döngülük kaos (rastgele öldürme · disk · Docker yeniden başlatma · ağ) | — | — | L gecelik | `kaos_uzun_kosu` | Gece |
| Gerçek güç kesintisi (adım 2, 4, 5, telafi ortası) | — | — | thinkpad · VDS (elle) | senaryo belgesi "GUC" | Sürüm |

### 9.4 Sentetik sürüm zinciri (K4 aracı — T2)

Gerçek eski backend sürümleri yeniden derlenemez (bayt kodu derleyen V8'e kilitli) ve göç geçmişi gerçek veriye bağlıdır. Bu yüzden matris **tek bir derlemeden** türetilmiş paket ailesiyle koşar: `t1 … t6` sürümleri aynı ikili/imajın üstüne **yalnız göç klasörü** (tablo ekle · kolon ekle · `CONCURRENTLY` dizin · bilerek düşen göç · uzun süren göç) ve **güncelleyici künye sürümü** farklı paketler olarak üretilir; test çapasıyla (`test-anchor` özelliği; üretim ikilisine girmez — bugün var) imzalanır ve `http://127.0.0.1` sunucusundan dağıtılır (test derlemesinde izinli — bugün var). Linux'ta imaj ailesi tek taban imaj + ince göç katmanıyla (G13'ün "ince son katman" yöntemiyle aynı) üretilir. Gerçek veriyle prova ayrıca: Windows'ta hazırlık kanalının gerçek yayınlanmış paketleri thinkpad'de, Linux'ta en eski canlı dökümün kopyası üzerinde (kök kural: şema provası en eski canlı dump'ta).

### 9.5 Yayın kapısı — kanıtsız güncelleyici sahaya çıkmaz

`deploy/backend-yayinla.mjs`, yayınlanacak paketteki güncelleyici ikilisinin sürümü yayındaki sürümünkinden farklıysa bir **kanıt dosyası** ister (`kanit/guncelleyici-<sürüm>.json`: commit · PR koşusu (K0–K2 yeşil) · gecelik koşu (K4/K5 yeşil) · gerçek prova satırları (thinkpad "GUC" ve VDS "GUC" — güncelleyici sürümü değiştiyse)). Kanıt yoksa yayın DURUR; kaçış yalnız kullanıcı cümlesiyle (`--terfi-atla` kalıbı). Güncelleyici değişmediyse (çoğu sürüm) kapı hiçbir şey istemez — "nadiren değişir" hedefinin ölçüsü de budur: yayın defteri güncelleyici sürümünün kaç yayında değiştiğini sayar.

## 10. Dilim planı

Büyüklük ölçüsü bir ajan bağlamıdır (ajanlar ~250 bin jetonda takılıyor): **K** (küçük) ≈ 60–100 bin · **O** (orta) ≈ 100–160 bin · **B** (büyük) ≈ 160–220 bin; B üstü dilim yazılmadı (bölündü). Her dilim kendi worktree'sinde; testler hedefli (dilimin bekçileri + `cargo test -p tekserp-guncelleyici`), tam paket faz inişinde.

| # | Dilim | Net çıktı | Bekçiler | Bağımlı | Boy |
|---|---|---|---|---|---|
| **W0** | Sözleşmenin dondurulması | GUNCELLEYICI.md'ye dondurma bölümü (§4.5 kuralları) · eski biçim vektör klasörleri (`guncelleyici-gunluk/` · `-ayar/` · `-niyet/`; bugünkü ve yayınlanmış her güncelleyici sürümünün her adımda yarım bıraktığı günlük — eski etiketlerden sahte dünyada üretilir) · ISLEM satırına `v` + `platform` · senaryoları `senaryo(profil)` biçimine çevirme iskeleti | `eski_gunluk_surdurulur` · vektör sayısı düşmez (cırcır, iki sonda) | — | O |
| **L1** | Platform sınırı (davranış değişmez) | `src/platform/{windows,linux}` · `Saglik` · `Araclar` · `PgArkaUcu` özellikleri · Linux saplamasıyla derlenir · `native-linux.yml` (ubuntu-latest: fmt + clippy + bütün `cargo test`) | `test_guncelleyici_platform_siniri` (çekirdekte `cfg`/`windows_sys` yok) · bütün mevcut testler aynen yeşil | W0 | O |
| **W1** | Önce güncelleyici + son bilinen iyi | §4.2 üç madde; `kunye.hedef` platform denetimi; `durum.bilgi = GUNCELLEYICI_ONCE` | `once_guncelleyici` · `lkg_donusu` · `kendi_platform_gecmez` · `self_update.rs` | L1 | O |
| **W2** | Bakım çiti (A3) | adım 0 `CIT` (Windows başlangıç türü; Linux ölçüm), plan + telafi + son durumlarda kaldırma, `reboot_at` arızası, `duman-windows.ps1` gerçek `sc config` ölçümü | `acilis_yarisi_her_adimda` (iki profil) | W1 | O |
| **W3a** | Disk | yedek alan dosyası, ENOSPC enjeksiyonu (`enospc_at`), §5 madde 4 disk formülü (Windows) | `disk_dolu_her_yazimda` | L1 | O |
| **W3b** | Altyapı bekleme + HATA kurtarma + iç bekçi | §2.3'ün üç satırı; `ALTYAPI_*` · `KURTARMA_SURUYOR` kodları (Rust + TS + rapor vektörü aynı commit'te) | `altyapi_bekleme` · `hata_kurtarma_turu` · `ic_bekci` · `test_guncelleme_protokol` | W2 | B |
| **W4** | Tanı paketi | `tani` alt komutu (iki platform) + runbook satırı | `tani_paketi_sir_tasimaz` | L1 | K |
| **W5** | CDN yükü | aday sorgusu kira yenilenmesine + 6 sa tavana + kurulum kaydırmasına bağlanır (§6.3) | sahte saatle istek sayımı (`aday_sorgu_sikligi`) | L1 | K |
| **L2a** | Sözleşme 5 — protokol | `backend-oci` ürünü · `linux-x64-oci` platformu · `imaj` · `guncelleyici` blokları · `SURUM_PLATFORM` · TS + Rust aynası + vektörler aynı commit'te | `test_guncelleme_protokol` · `sozlesme_vektorleri.rs` · `test_lisans_protokol_aynasi` | W0 | O |
| **L2b** | Sözleşme 5 — uçlar | satıcı belirteci `urun=backend-oci` · Worker yol öneki · backend `indirme-belirteci?urun=backend-oci` · `updater-ipc` Linux kökü · "eski istemci ne yapar" cevabı · **satıcı önce, Worker ilk Linux yayınından önce** | `test_indirme_kapisi` · satıcı testleri · `test_lisans_yoklama_allowlist` | L2a | O |
| **L3** | Linux paketi + yayıncı | teslim paketinin `backend-oci` biçimi (§1.3) · güncelleyicinin linux-x64 derlemesi CI'da (`korumali-paket.yml` ubuntu işi; Ubuntu 22.04 tabanı — eski glibc ileri uyumu) · `backend-yayinla.mjs --urun=backend-oci` (imzasız taban imajı RED) | `test_backend_yayin` · `test_docker_hijyeni` · `test_korumali_imaj` | L2a + **G13 inişi** | B |
| **L4a** | Linux arka ucu I | `Fs` eksikleri (`statvfs`, yabancı yazar, `O_NOFOLLOW`) · `Procs` (süreç grubu, `PDEATHSIG`) · `Protect` · `Events` · TLS (`native-tls` Linux hedefi) · Linux `Layout` | `linux_fs_guvenilmez_okuma` · `linux_procs_agac_olur` | L1 | O |
| **L4b** | Linux arka ucu II | `DockerServices` · `Araclar` (yedek/göç/geri yükleme araç konteynerleriyle) · adım eşlemesi (§2.2) · Linux profilli sahte dünya; matrisin K1 satırları iki profilde | §9.3'ün PR satırları (L profili) | L4a + L5 (araç komutları) | B |
| **L5** | İmaj / compose tarafı | `TEKSERP_GOC_ACILISTA` · `goc` aracı (`CONCURRENTLY` kuralı `entrypoint.sh`ten araca, tek yer) · compose şablonu kuralları (`pull_policy: never`, bağlar, kip değişkeni) · açılış çıkış kodları tablosu · `TEKSERP_GUNCELLEME_DIZINI` üretim cümlesi | `test_korumali_imaj` · compose denetimi yeni maddeler · `test_dogrulama_kipi` | L2a | O |
| **L6** | systemd + Linux kendini güncelleme | `hizmet-kur`/`hizmet-kaldir` Linux · taban birim + ek dosya izin listesi · `sd_notify`/`WatchdogSec` · `.exe`siz A/B | `test_systemd_ek_izinli` · `self_update.rs` (L profili) | L4a, W1 | O |
| **L7** | Kurulum ve geçiş araçları | §8.1 (kur.mjs adım 6–7'nin alt komutu) · §8.2 `gecis` / `gecis --geri-al` · runbook bölümü | `test_guncelleyici_yikici_docker_yok` · kuru koşum sondaları | L3, L4b, L5, L6 | B |
| **L8** | PG küçük sürümü (KONTEYNER kipi) | `pg.env` yazarı · U3–U11'in Docker karşılığı · ICU yeniden dizinleme aynen | `pg_minor.rs` L profili | L4b | O |
| **T1** | Linux gerçek dumanı (K2) | `duman-linux.sh` (ubuntu-latest: systemd birimi, gerçek compose, test imajları, yerel CDN, kill/Docker yeniden başlatma/loop disk) | `native-linux.yml` duman adımı | L4b, L5, L6 | O |
| **T2** | Yükseltme matrisi (K4) + yayın kapısı | sentetik sürüm zinciri aracı (iki platform) · kanıt dosyası · `backend-yayinla.mjs` kanıt kapısı | `test_backend_yayin` yeni sondalar · `atlamali_yukseltme` | W1, L4b | B |
| **T3** | Windows gerçek prova (thinkpad) | senaryo belgesi "GUC" (adım başına güç kesintisi + yeniden açılış) · betik · ilk kanıt satırları | senaryo (yeşil/kırmızı + kanıt) | W1–W3b | O |
| **T4** | Kaos / uzun koşu (K5) | gecelik iş · değişmez ölçer aracı (`degismez-olc`: tek backend, `current` ↔ imaj ↔ göç, yetim/sır yok) | `kaos_uzun_kosu` | T1 | O |
| **F1a** | Filo — satıcı | dalga tavanı (§6.2) · otomatik durdurma · filo acil durdurma · `GUNCELLEME_YAYILIM_DURDU` · Worker istek sayımı · eski biçim emeklilik ölçüsü (§4.5 madde 2) | satıcı servis testleri · bildirim taraması · `guncelleme-karar.json` | L2b | B |
| **F1b** | Filo — portal | dalga/sürüm görünümü, insan sabitlemesi ↔ dalga tavanı ayrı, gerekçeli çözme | portal testleri | F1a | O |
| **P1a** | Deneme VDS — ilk kurulum + ilk otomatik güncelleme (hazırlık çapası) | `test` grubunda TEST sınıflı kurulum; t1 → t2 OTOMATİK pencereyle; zorla geri dönüş (düşen göç); kısa kaos (öldür, `systemctl restart docker`, sağlayıcı panelinden sert yeniden başlatma) | senaryo "VDS-GUNCELLEME" | L7, T1, AK-4 | O |
| **P1b** | Deneme VDS — üretim çapası | üretim ikilisi + `pkt-*` sertifikalı imzalı gerçek Linux paketi; P1a senaryosunun tekrarı | aynı senaryo | **D8 töreni**, P1a | K |
| **P2** | Windows filosuna ilk yayın | W1–W5'li güncelleyiciyi taşıyan ilk backend sürümü (hazırlık → terfi) | yayın kapısı (§9.5) | T2, T3 | K |

**Paralellik:**

```
W0 ─┬─ L1 ─┬─ W1 ─ W2 ─ W3b ─┐
    │      ├─ W3a ───────────┤
    │      ├─ W4 · W5 ───────┤
    │      └─ L4a ─┬─ L6 ────┤
    └─ L2a ─┬─ L2b ─ F1a ─ F1b
            ├─ L5 ─┐         │
            │      └─ L4b ─┬─ L8
            └─ L3 (G13 ile)│
                           ├─ T1 ─ T4
                           ├─ T2 (W1 ile) ─┐
                    L7 (L3·L4b·L5·L6) ─ P1a ─ P1b (D8 töreni)
                    T3 (W1–W3b) ───────────┴─ P2
```

- Aynı anda en çok üç hat: **A** Windows/ortak (W-dilimleri `engine.rs`/`operation.rs`e dokunur — kendi aralarında SIRALI, çakışmasınlar diye) · **B** Linux (L4a/L6 yalnız `platform/linux` ve birim dosyaları; A ile çakışmaz) · **C** protokol + satıcı (L2a/L2b/F1 — Rust tarafı yalnız `release.rs`/`decision.rs` ve vektörler).
- L1 bir **saf yeniden düzenlemedir** ve W1'den önce iner; böylece W-dilimleri yeni düzende yazılır, Linux hattı onlardan sonra birleştirme acısı çekmez.

**Kullanıcı onayı / tören noktaları:**

1. Planın kendisi ve §11'deki açık kararlar (AK-1…AK-5) — W0'dan önce.
2. **L2b inişi = sözleşme kıran olmayan ama satıcı-önce sıralı yayın:** üretim satıcısı + Worker güncellemesi kullanıcının yayın onayıyla (surum-yayin reçetesi).
3. **P1a:** deneme VDS'e kurulum — AK-4 cevabıyla; sunucuya bağlanan dilim budur (bu plan sunucuya dokunmadı).
4. **P1b: PAKET imzası** — D8 töreninden (ilk gerçek `pkt-*` sertifikası, kullanıcı Mac'te, parola TTY) SONRA; Linux paketinin üretim imzası aynı törenin yayın adımıdır (`docs/ops/URETIM-SATICI-TOREN.md`).
5. **P2:** Windows'a W1'li güncelleyicinin ilk çıkışı terfi etiketiyle (sürüm notu kapısı). ⚠️ Sahadaki ESKİ güncelleyiciler A1 kuralıyla çalışır: yeni ikiliyi ancak bir backend güncellemesini BAŞARILI bitirince alırlar. Bu yüzden P2'nin taşıdığı backend sürümü göçsüz ve küçük tutulur (ilk geçişin başarısı en olası olsun); sonraki her yayın "önce güncelleyici" kuralından yararlanır.
6. İlk BARINDIRILAN müşteri: P1b + T2 + T3 + T4 yeşil olmadan kurulmaz (BULUT B11 kuralının güncelleyici karşılığı).

**Deneme VDS'e ilk kurulum ve ilk otomatik güncelleme provası: P1a** (hazırlık çapasıyla, D8'den bağımsız); üretim çapalı tekrarı P1b.

## 11. Kararlar

### 11.1 Teknik kararlar (bu planda verildi — gerekçesiyle)

| # | Karar | Gerekçe (kısa) | Yer |
|---|---|---|---|
| TK-1 | Docker'ı CLI ile yönet, Engine API'yi kullanma | yeni bağımlılık yok; compose tek beyan; alt küme dar ve tek değer biçimli | §1.2 |
| TK-2 | Linux TLS = `native-tls` (sistem OpenSSL + sistem CA deposu) | kilit dosyasına yeni crate girmez; CA'lar işletim sistemiyle tazelenir | §1.2 |
| TK-3 | Linux paketi ayrı ürün yolu `backend-oci` | gruplar platformlar arası ortak; eski Windows güncelleyicisi hiç etkilenmez | §1.3 |
| TK-4 | Linux'ta da sürüm dizini + `current` bağı; compose sürümle imzalı gelir | GECIS tek atomik değişim; Windows koduyla aynı | §1.2 |
| TK-5 | Göç yalnız güncelleyicinin adımında; imaj açılışında göç yok | ayrı telafi; eski imajın yeni şemayla karşılaşması önlenir (A11) | §2.2 |
| TK-6 | Bakım çiti (Windows başlangıç türü; Linux `unless-stopped`) | açılış yarışı (A3) | §2.2 |
| TK-7 | `HATA` son durak değil; kurtarma turu süresiz, geri çekilmeli | telafiler tekrarlanabilir; insan yalnız yedek bozuksa | §2.3 |
| TK-8 | Önce güncelleyici + son bilinen iyi | kilitlenme (A1) ve gizli hata (A2) | §4.2 |
| TK-9 | Sözleşme değişimi yeni ad + yanına yazım; eski ad filo ölçüsüyle emekli | D7/D8'de kanıtlanmış kalıp; eski okuyucu hiç bozulmaz | §4.5 |
| TK-10 | Dalga = satıcının var olan `hedefSurum` alanı | güncelleyici ve sözleşme değişmez | §6.2 |
| TK-11 | Mac'te Linux VM kurulmaz; gerçek Linux testi GitHub Ubuntu makinelerinde | yeni araç yok; systemd + Docker hazır | §9.1 |
| TK-12 | Linux PG küçük sürümü ilk sürümde kapalı, ayrı dilim (L8) | ilk provayı küçültür; ana sürüm zaten runbook | §1.1 |

### 11.2 Kullanıcıya sorulacak kararlar (sade dille)

- **AK-0 — Windows'ta güncelleme programı ayrı bir kurulum mu olsun?** Öneri: **Hayır.** Bugünkü gibi ERP'nin kurulum paketinin içinde gelsin ve kendini yenilesin. Ayrı kurulum, bozulduğunda her fabrikada birinin elle kurmasını gerektirir; ayrıca ikinci bir yayın ve imza işi doğurur. Onun yerine iki iyileştirme yapılır: güncelleme programı kendini ERP'den ÖNCE yeniler (kendi hatası kendi düzeltmesini engelleyemez) ve bir önceki sağlam hâlini her zaman yedekte tutar.
- **AK-1 — Linux kurulumunu müşterinin kendi fabrikasındaki sunucuya da satacak mıyız, yoksa yalnız bizim kiraladığımız bulut sunucularında mı?** Öneri: **Şimdilik yalnız bulut.** Güncelleme programı ikisine de uygun yazılır; fabrika içi Linux için ayrıca ağ şifrelemesi ve yerinde kurulum aracı gerekir, o ayrı bir iştir.
- **AK-2 — Yeni sürüm "genel" gruptaki fabrikalara hep birden değil sırayla gitsin mi?** Öneri: **Evet:** önce fabrikaların %10'u, sonuçlar gelince %50'si, sonra hepsi. Aynı sürüm 2 fabrikada (ya da gruptakilerin %10'unda) geri dönerse yayılım kendiliğinden dursun ve size haber gelsin; yeniden başlatmak sizin kararınız olsun. Sayılar uygun mu?
- **AK-3 — Güncellemesi "dondurulmuş" bir fabrikada güncelleme programının KENDİSİ yenilenebilsin mi?** (ERP'nin sürümü değişmez; yalnız güncelleyen küçük program yenilenir.) Öneri: **Evet;** yalnız lisans yaptırımıyla dondurulmuş fabrikada hayır.
- **AK-4 — Deneme sunucusundaki prova nasıl yapılsın?** Öneri: **Şu an kurulu ders paketinin yanına, ayrı klasör ve ayrı veritabanıyla** (ders paketine dokunulmaz). Sunucunun belleği iki kurulumu taşımazsa ayrıca sorulur.
- **AK-5 — Testler GitHub'ın Linux ve Windows makinelerinde koşsun mu?** (Her değişiklikte kısa, her gece uzun test.) Aylık ücretsiz süre aşılırsa küçük bir ücret çıkabilir. Öneri: **Evet;** gece testi yalnız güncelleme programı değiştiğinde koşar.

## 12. Riskler — "bir kere yap" nerede mümkün, nerede değil

**Mümkün olan (dondurulabilir çekirdek):** karar fonksiyonu, doğrulama zinciri, işlem günlüğü + telafi + değişmez, IPC dosya biçimleri, kendini güncelleme yolu. Bunlar dış dünyaya bağlı değildir; vektör + arıza enjeksiyonu + yükseltme matrisiyle bir kez ölçülür ve §4.5 kurallarıyla donar. Bu planın hedefi, güncelleyicinin **değişme nedenlerini** bu çekirdeğin dışına itmektir.

**Mümkün olmayan (dış dünyanın değiştirdiği) ve önlemi:**

| # | Risk | Neden "bir kere" ile çözülemez | Önlem |
|---|---|---|---|
| R1 | Docker / compose CLI davranışı değişir (bayrak emekliliği, çıktı) | Docker'ın yol haritası bizde değil | sabit sürüm (`deploy/bulut/surumler.json`), dar alt küme + tek değer biçimi, CI'da iki sürüm; desteklenmeyen sürümde güncelleyici işlem BAŞLATMAZ (bilgi kodu), fabrika eski sürümle çalışmaya devam eder; düzeltme W1 sayesinde insansız ulaşır |
| R2 | İşletim sistemi büyük sürümü (Ubuntu 24.04 → 26.04; Windows Server sürümleri) | sistem kütüphaneleri, systemd/SCM davranışı | bulutta büyük sürüm geçişi bizim runbook işimizdir (otomatik değil); CI dağıtım matrisi; ikili en eski desteklenen glibc'de derlenir |
| R3 | OpenSSL ABI'si (Linux) | dinamik bağ | ikili her güncelleyici sürümünde yeniden derlenir; kurulum ön ölçümü `libssl.so.3`ü arar; ABI değişirse yeni ikili eski ABI'li sisteme çıkmaz (`kunye` + platform etiketi) |
| R4 | Kök/PAKET anahtar dönemi | gömülü çapa ikilinin içindedir | dönem töreni + çift çapa (PAKET-ANAHTARI-KOK-ALTINDA); `pkt-*` sertifikaları çapayı değiştirmeden yeni imzacı ekler — güncelleyici değişimi gerektirmeyen yol budur |
| R5 | PostgreSQL ana sürüm geçişi | veri dizini biçimi değişir | bilinçli olarak OTOMATİK DEĞİL (runbook, insan); güncelleyici yalnız küçük sürüm |
| R6 | Hatalı göç (uzun kilit, yanlış veri göçü) | güncelleyicinin dışında, her sürümde yeni | güncelleyici geri döner (veri kaybı yok, kesinti var); göç bekçileri + en eski canlı dökümde prova + sentetik matriste "uzun göç" satırı |
| R7 | Kendini güncelleme yolunun kendisinde hata | A/B'yi de bozabilir | yol dondurulur (§4.5 madde 4), üç halkalı zincir kanıtı yayın kapısında, `.lkg`; son çare insan: Windows setup "onar", Linux `hizmet-kur` yeniden koşumu (SSH) |
| R8 | Saat sapması | kira ve pencere zamana bağlı | chrony/w32time; kira +10 dk toleransı; `clock_jump` arıza senaryosu |
| R9 | Büyük veritabanında geri yükleme süresi | DB büyüdükçe telafi uzar | yedek/geri yükleme zaman aşımları DB boyutundan türetilir (ölçülür, sabit değil); disk ön kontrolü DB boyutunu sayar |
| R10 | Veri birimi kaybı (Linux `pg_data` = lisans F5) | yanlış komut geri dönüşsüzdür | güncelleyici birimlere hiçbir yoldan dokunmaz; yıkıcı Docker komutu bekçisi (§8.2) |
| R11 | CDN/Worker kesintisi ya da kota | dış hizmet | güncelleme yalnız gecikir (fail-closed), fabrika etkilenmez; sorgu sıklığı düşürülür (W5); kota sayımı (F1a) |
| R12 | Windows'ta güvenlik yazılımının dosya kilitlemesi | üçüncü taraf | `DOSYA_KILITLI` bekler, ertelemesiz sürer (bugün var); thinkpad provasında Defender açık koşulur |

**Dürüst sonuç:** "Bir kere yap, hep çalışsın" güncelleyicinin **çekirdeği** için ulaşılabilir ve bu plan onu ölçüyle bağlar. Dış dünyaya bağlı yüzeyler (Docker, işletim sistemi, TLS kütüphanesi, anahtar dönemi, PG ana sürüm) zamanla değişecektir; onlar için hedef "hiç değişmesin" değil, **değiştiğinde güncelleyici güvenli tarafta beklesin, fabrika çalışmaya devam etsin ve düzeltme insan eli değmeden ulaşsın**tır. Bunu mümkün kılan iki parça W1 (önce güncelleyici + son bilinen iyi) ve §4.5'tir; ikisi olmadan her dış değişiklik fabrika başına elle müdahale demektir.
