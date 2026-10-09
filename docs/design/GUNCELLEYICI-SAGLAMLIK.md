# Güncelleyici sağlamlık planı — tek ürün, iki arka uç (Windows hizmeti · Linux/Docker)

> **Durum:** PLAN (2026-10-08). Kod yazılmadı. **Kullanıcı kararları kapandı (2026-10-08, §11.2): AK-0…AK-5**; dilim planı (§10) bu kararlara göre yeniden kapsamlandı. Bu belge bir **uygulama planıdır**, sözleşme değildir. Sözleşme `docs/design/GUNCELLEYICI.md`dir (§1–§3 DONMUŞ, §4–§14 Windows yerel sözleşmesi). Her dilim indikçe buradaki kararlar oraya **bölüm olarak** taşınır (ör. `§4L Linux dizin düzeni`) ve burada "→ GUNCELLEYICI.md §x" diye kapanır. Bulut kurulumunun güncelleyici bölümü (`docs/design/BULUT-KURULUM.md` §4, dilim B4) bu planla **yer değiştirir**: B4 artık buradaki L-dilimleridir.
> **Hedef (kullanıcının cümlesi):** "Bu update programını sürekli güncellemek zorunda kalmayalım, bir kere yapalım hep iyi çalışsın; onlarca fabrikaya satış yapacağız." Ölçüte çevrilmiş hâli: **(H1)** her arızada insan eli değmeden ya tamamlanır ya eski hâline döner · **(H2)** güncelleyicinin kendisi nadiren değişir ve değiştiğinde kendini bozamaz · **(H3)** sözleşme ileriye uyumludur (eski güncelleyici yeni yayını bozmadan atlar, yeni güncelleyici eski kurulumda çalışır) · **(H4)** yüzlerce kurulumda kademeli, aşamaları insanın ilerlettiği ve başarısızlığı anında görünür kılan yayılım (AK-2) · **(H5)** bunların hepsi **test vektörü ve arıza enjeksiyonuyla ölçülmüş** olur, söz olarak kalmaz.
> **Belge adı neden bu:** kapsam iki platformu birden kapsar (koordinatör kapsam genişlemesi 2026-10-08). Plan Windows'taki mevcut kodu da aynı ölçütle denetler; Linux yalnız ikinci arka uçtur. GUNCELLEYICI.md'ye ek bölüm olarak yazılmadı, çünkü o belge sözleşmedir ve DONMUŞ kısımları vardır. Plan, dilim sırası ve açık kararlar sözleşmenin içine girerse "ne bağlayıcı, ne niyet" ayrımı bulanıklaşır.
> **Okunan kaynaklar (origin/main `5fb46d862`):** `Teks-Erp/native/tekserp-guncelleyici` (26 modül, ~15,8 bin satır; `env.rs` platform özellikleri, `operation.rs` genel işlem sürücüsü, `engine.rs` tur, `selfupdate.rs` A/B, `windows/` SCM/DPAPI/iş nesnesi) · `tests/common` sahte dünya + `CrashFs` (her değiştiren işlemden önce öldürme) · `native/test-vektorleri` · `.github/workflows/native-windows.yml` · `Teks-Erp/docker/korumali` + `Teks-Erp/docker/entrypoint.sh` · `Teks-Erp/src/lib/license/protocol/paket-zinciri.ts` · `docs/design/PAKET-ANAHTARI-KOK-ALTINDA.md` (D7/D8) · `docs/design/TEK-ORTAK-PAKET.md` (gruplar `test → oncu → genel`) · satıcı `update-policy.service` · `gece/g13-butunluk` dalı ve worktree'si (imaj içi liste: `imaj-imzala.mjs`, ince son katman, yeni etiket). **Plan yazıldıktan sonra main'e inenler (2026-10-08):** G13 imaj içi imzalı bütünlük listesi (`02df43f46` — `Teks-Erp/docker/korumali/imaj-imzala.mjs`, `butunluk-zincir.jws` ince son katmanda, `native.ts` zincirli dosyayı okur) · parola kasası (`scripts/lib/parola-kasasi.mjs`) · D7/D8 kid'li zincir adları.

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

**Ayrı Windows güncelleyici kurulumu sorusu (C):** **kullanıcı kararı AK-0 — ayrı setup YOK.** Tek paket + kendini güncelleme kalır, ama A1/A2 kapatılır ("önce güncelleyici" kuralı ve son bilinen iyi ikili). Gerekçe §4.4'te.

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

**Çıktı biçimine bağımlılığı sınırlama kuralı:** güncelleyici CLI çıktısından yalnız şu alanları okur ve hepsini **Go şablonuyla tek değer** olarak ister (tablo/insan çıktısı ayrıştırılmaz): `docker image inspect --format '{{json .RootFS.Layers}}'` (yüklenen etiketin diff_id listesi; arşivdeki config'in `rootfs.diff_ids`ine eşit olmalı) · `docker inspect --format '{{.State.Status}}|{{.State.ExitCode}}|{{.RestartCount}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}'` · `docker compose ps -q <servis>` (yalnız kimlik). Başarı ölçüsü çıkış kodudur; metin YALNIZ günlüğe gider. **İmaj kimliği = config özeti, ARŞİVDEN ölçülür** (`backend-bildirim.ts imaj-kimlik`, `oci-arsiv.ts`); `docker image inspect` `.Id`si kimlik olarak KULLANILMAZ — klasik depoda config özetidir ama containerd deposunda (Docker 29 varsayılanı) index özetidir (ölçüldü 2026-10-09, L3: ders imajı `.Id` `5854ca…` ≠ config `98741c…`; `GUNCELLEYICI.md` §16 madde 8). Desteklenen Docker aralığı `deploy/bulut/surumler.json`da sabittir (BULUT §1.4); CI iki sürümde (sabit + bir sonraki büyük) koşar (T5 testi, §8).

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

> → `GUNCELLEYICI.md` §16 (L2a, 2026-10-08): ürün yolu · platform · `imaj` · `guncelleyici` · `SURUM_PLATFORM` uygulandı; indirme öneki/belirteç/Worker L2b'de uygulandı (§16 madde 7: kurulum yalnız kendi platformunun backend dizinine belirteç alır).
> → L3 (2026-10-09): paket biçimi · `teslim-paketle.sh` · `backend-yayinla.mjs --urun=backend-oci` · linux-x64 güncelleyici CI işi uygulandı (`GUNCELLEYICI.md` §16 madde 8–10).

- **Yeni ürün segmenti `backend-oci`:** `/<grup>/backend-oci/son.json` · `/<grup>/backend-oci/<sürüm>/…` · `/<grup>/backend-oci/pg/…`. `DOWNLOAD_PRODUCTS`a `backend-oci`; indirme belirteci `?urun=backend-oci` (yol öneki `/<grup>/backend-oci/`). Windows yolu (`/backend/`) **hiç değişmez** ⇒ eski Windows güncelleyicisi hiçbir zaman Linux bildirimi görmez; Linux güncelleyicisi Windows bildirimi görmez. BULUT §4.2'deki "yalnız Linux kanalında yayımlanır" varsayımının yerine geçer.
- Bildirim `platform: "linux-x64-oci"` (`UPDATE_PLATFORMS`a eklenir), `urun: "backend"` kalır (karar, rapor ve panel ürünü aynı görür); güncelleyici `platform`u kendi derleme hedefine eşit ister (`SURUM_PLATFORM` — yeni kod, sözleşme 5).
- Bildirime isteğe bağlı `imaj: {kimlik, etiket}` (`linux-x64-oci`de zorunlu, `win32-x64`te yasak — şema düzeyinde `superRefine`) ve `guncelleyici: {surum, sha256}` (isteğe bağlı, her iki platformda; §4.2'deki "önce güncelleyici" kuralının ön bilgisi — eski doğrulayıcı alanı atar).
- **Paket biçimi (Linux):** tek `tar` `tekserp-backend-oci-<sürüm>.tar` (sıkıştırılmamış dış kap, üyeler düz ad, küme TAM — fazla/eksik üye RED; içteki imaj zaten gzip): `tekserp-korumali_<sürüm>_linux-amd64.tar.gz` (G13 sonrası **imzalı etiketin** `docker save` çıktısı; etiket TAM `tekserp-korumali:<sürüm>`) · `docker-compose.yml` (güncelleyicili şablon, sürüm dolu) · `.env.ornek` · `PAKET-DOCKER.json` + `PAKET-DOCKER.json.jws` (dış künyede tek imza: `paket-*` eski takım ya da `pkt-*` zincir) · `butunluk-liste.txt` · `tekserp-guncelleyici` (linux-x64, PAKET imzalı listede) · `guncelleyici-kunye.json` · `SHA256SUMS`. Biçimin tek kaynağı `Teks-Erp/scripts/lib/oci-paket.ts` (üreten `teslim-paketle.sh`, ölçen `backend-bildirim.ts --tar`). Bütünlük listesi tar'ın ÜYELERİNİ kapsar (bugünkü Docker teslim künyesi biçimi, `docs/ops/LINUX-DOCKER-KURULUM.md` §8); bildirimin `paket.sha256`sı dış tar'ın özetidir.
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

1. **"Önce güncelleyici" (A1'in kapanışı):** paket `HAZIR` olduğunda (doğrulandı, açıldı, karar `KUR` · `ONAY_BEKLIYOR` · `PENCERE_BEKLIYOR` farketmez) paketteki güncelleyici ikilisi çalışandan YENİYSE, backend işleminden **önce** kendini güncelleme yapılır (`durum.bilgi = GUNCELLEYICI_ONCE`). Yeni ikili aynı paketi yeniden doğrular ve backend işlemini kendisi yürütür. Böylece güncelleyicinin backend yolundaki bir hatanın düzeltmesi, o hata yüzünden asla bloklanmaz. Koşullar: işlem günlüğünde açık işlem YOK; kurulu sürüm dizini (`current`) değil `surumler/<aday>` kaynak alınır (aday dizini zaten doğrulanmış); politika kendini güncellemeyi engellemez — `DONDUR`/K1 backend sürümünü dondurur, güncelleyicinin kendisi paketi kurmadan yalnız ikiliyi değiştirir. **Kullanıcı kararı AK-3:** `DONDUR` kipinde ikili kendini YENİLER (backend sürümü değişmez); lisans yaptırımı (K1, `yaptirim.guncellemeDonuk`) varsa **hiçbir şey yenilenmez** — ne backend ne güncelleyici (bekçiler `dondur_kendini_yeniler` · `k1_hicbir_sey_yenilenmez`).
2. **Son bilinen iyi (A2'nin kapanışı):** `.eski` ilk sağlıklı turda silinmez; `.lkg` ("son bilinen iyi") olarak kalır ve **yeni ikili bir backend işlemini BASARILI ya da GERI_DONDU ile sonuçlandırdığında** (yani uygulama yolunu uçtan uca koştuğunda) değiştirilir. Açılış sayacı kuralı aynen; buna ek olarak yeni ikili `HATA` ile biten ilk işleminde (W3 kurtarma turu da düşerse) `.lkg`ye döner ve işlemi o sürdürür (günlük biçimi ortak — §2.4).
3. **Doğrulama ölçütü sertleşir:** "ilk sağlıklı tur" = kilit alındı + günlük okundu + kira/HAK okundu + aday kararı verildi + `durum.json` yazıldı. Bugün yalnız turun bitmesi sayılıyor.

> → `GUNCELLEYICI.md` §10 madde 1–4 (W1, 2026-10-09): üç madde + `kunye.hedef` platform denetimi + AK-3 uygulandı. Ölçümün açtığı borçlar §12 R13–R15'te: asıl adın boş kalması → W1b (§4.7; KAPANDI) · `.lkg`ye dönen eski ikilinin reddedilen sürümü bilmemesi → P2 ile yapısal kapanış · yayıncının `guncelleyici` bloğunu yazmaması → **KAPANDI 2026-10-09** (R15 dilimi; yayıncı bloğu paketteki ikiliden ölçerek yazar).

### 4.3 Hizmet tanımının kendisi (Windows SCM kaydı / Linux systemd birimi)

- **Windows (bugün):** güncelleyici her açılışta kendi SCM kurtarma ayarını beklenen değere getirir (yalnız farklıysa yazar) — sahaya kendini güncellemeyle gider. Aynı mekanizmaya backend hizmetinin başlangıç türü (çit) ve kurtarma ayarı eklenir.
- **Linux:** iki katmanlı birim.
  - **Taban birim** `/etc/systemd/system/tekserp-guncelleyici.service` — kurulumda bir kez yazılır, **DONMUŞTUR**: `ExecStart=/opt/tekserp/guncelleyici/tekserp-guncelleyici hizmet --kok /opt/tekserp --veri /var/lib/tekserp` · `Restart=always` · `RestartSec=10` · `StartLimitIntervalSec=0` (sonsuz yeniden deneme; Windows'ta "sayaç 1 günde sıfırlanır" karşılığı) · `KillMode=mixed`. Bu dosyayı güncelleyici HİÇ değiştirmez.
  - **Ek dosya** `tekserp-guncelleyici.service.d/50-tekserp.conf` — güncelleyici her açılışta kendi gömülü şablonuyla karşılaştırır, farklıysa yazar + `systemctl daemon-reload` (bir sonraki yeniden başlatmada etkin). Ek dosyaya yalnız **izin listesindeki anahtarlar** girebilir (`OOMScoreAdjust` · `WatchdogSec` · `LimitNOFILE` · `ProtectSystem`/`ReadWritePaths` sertleştirmesi · `Environment=` yalnız beyanlı adlar). `ExecStart`, `User`, `Restart` ASLA (bekçi `test_systemd_ek_izinli`: şablonu ayrıştırır, izin dışı anahtar → kırmızı; iki sonda). Bozuk bir ek dosya taban birimi geçersiz kılamaz: systemd tanımadığı anahtarı uyarıyla atlar, `ExecStart` taban birimdedir.
  - Backend için birim YOK: yaşam döngüsü Docker'dadır (`unless-stopped`); Docker'ın kendisi dağıtımın birimiyle açılır.

> → L6 (2026-10-09, arşiv §2026-10-09 Güncelleyici L6): taban birim `src/platform/linux/birim.rs` `taban_birim` — yukarıdakilere ek olarak `Type=notify` + `NotifyAccess=main` (her Linux ikilisi kilidi aldıktan sonra `READY=1` gönderir; bu da donmuş sözleşmedir), `After=network-online.target docker.service`, `--ad <birim adı>` ve W1b'nin iki onarım satırı (`ExecStartPre=-<kök>/guncelleyici/tekserp-guncelleyici.lkg onar --yalniz-asil-ad …` · `ExecStartPre=-<kök>/current/tekserp-guncelleyici onar --yalniz-asil-ad …`, §4.7 L-B). Ek dosya şablonu bugün `WatchdogSec=180` + `OOMScoreAdjust=-500`; `Environment=` beyanlı adları `RUST_BACKTRACE`; `ProtectSystem`/`ReadWritePaths` izinli ama şablonda YOK (açılırsa ek dosya dizini `ReadWritePaths`e girmeli, yoksa güncelleyici `/etc`e yazamaz — T1'de ölçülerek). Gözcü: `WATCHDOG=1` yalnız `max(döngü damgası, durum.json sonCanlilik)` `max(canlilikEsigiSn, 900 sn) + 60 sn`den tazeyken gider. Ek dosya READY'den SONRA hizalanır (başlatma işi sürerken `daemon-reload` yok). Gerçek systemd 255'te `native-linux.yml` dumanıyla ölçülür (`scripts/duman-systemd.sh`).

### 4.4 Ayrı Windows güncelleyici kurulumu (C) — değerlendirme ve öneri

Bugün: D5 setup ve D6 geçiş güncelleyici hizmetini kurar; ikili backend paketinin `runtime\`inde gelir (PAKET imzalı kapsam) ve A/B ile kendini günceller.

| Ölçüt | Ayrı setup (ayrı ürün, ayrı yayın) | Tek paket + kendini güncelleme (W1 ile) |
|---|---|---|
| Güncelleyici bozulursa kurtarma | Ayrı setup elle koşulur — **fabrika başına insan**; onlarca fabrikada H1'i bozar | A/B sayacı + `.lkg` (otomatik); ikili dışarıdan bozulursa (karantina, silinme, bozuk bayt, iki adlandırma arası ölüm) **karşılıklı onarım W1b (§4.7)** — `.lkg onar` zamanlanmış görevle (Windows) / taban birim satırıyla (Linux) insansız geri koyar; setup "onar" (bugün var: D5 onarımı) yalnız yönetici hizmet kaydını silmiş ya da devre dışı bırakmışsa (§4.7 madde 7, bilinçli) — ayrı setup'ın sunduğu tek şey zaten var |
| Kim günceller? | Yine güncelleyici kendini güncellemek zorunda (yoksa her sürümde insan) ⇒ A/B yolu ortadan kalkmaz, üstüne ikinci yayın yolu eklenir | tek yol |
| Sürüm çarpıklığı | güncelleyici N × backend M matrisi; hangi çiftin uyumlu olduğu ayrı sözleşme ister | ikili, birlikte test edildiği backend paketiyle gelir; "önce güncelleyici" ile aday paketin güncelleyicisi, kurulu backend'le çalışmak ZORUNDADIR — bu tek yönlü uyum §4.5'teki dondurma kuralıyla ve yükseltme matrisiyle (T2) ölçülür |
| İmza / kanal | ayrı ürün yolu (`/<grup>/guncelleyici/`), ayrı bildirim türü ya da `urun` değeri, ayrı yayın defteri, ayrı terfi, Worker deseni — sözleşme 5'e bir ürün daha | yok (aynı PAKET zinciri, aynı bildirim) |
| Güncelleyiciyi backend'den bağımsız düzeltebilmek | evet | evet — W1 ile: güncelleyici düzeltmesi bir backend yama sürümünde gelir, backend tarafı geri dönse bile ikili yerleşir |
| Hareketli parça | +1 yapıt, +1 yayın, +1 kurulum adımı, +1 test boyutu | değişmez |

**Karar (kullanıcı, AK-0, 2026-10-08): tek setup + kendini güncelleme; W1 (önce güncelleyici + son bilinen iyi) yapılır.** 1e'nin ön görüşüyle aynı yöne çıkıyor; ölçülen fark şu: ayrı setup'ın tek gerçek artısı "güncelleyiciyi backend'den bağımsız düzeltebilmek"ti ve bunu W1 ayrı yapıt olmadan sağlıyor. Ayrı setup gerektiren tek durum, güncelleyicinin **kendini güncelleme yolunun kendisinin** bozuk olmasıdır; buna karşı önlem ayrı setup değil, o yolun dondurulması (§4.5 madde 4) ve `.lkg`dir.

### 4.5 Sözleşmenin dondurulması — güncelleyici neden nadiren değişir

Güncelleyicinin değişmesini gerektiren şeyler sözleşmeden doğar; sözleşme şu kurallarla dondurulur (W0 bu kuralları sözleşme belgesine yeni bir "sözleşmenin dondurulması" bölümü olarak yazar ve bekçiye bağlar):

1. **Her dosya `v` taşır, okuyucu tanımadığı alanı atar** (bugün: bildirim, işaretçi, niyet, durum zaten böyle). Anlamı daraltan değişiklik `v`yi artırmaz — **yeni ad alır, eskisinin yanına yazılır** (D7/D8 zincir dosyalarının kanıtlanmış kalıbı: `son-zincir.json` `son.json`un yanında; eski okuyucu yeni adı hiç okumaz). Böylece eski güncelleyici yeni yayını "kibarca reddetmez", **hiç görmez** ve eski biçimde yayın sürdükçe çalışmaya devam eder.
2. **Yayıncı eski biçimi filo ölçüsüyle emekliye ayırır:** eski ad, satıcının yoklama raporlarında (`guncelleyici.surum`) o grubun bütün kurulumları yeni okuyucuya geçene dek yayınlanır. Yayın betiği bu ölçüyü satıcıdan okur ve eski adı erken bırakmayı REDDEDER (F1c).
3. **Yeni güncelleyici eski kurulumda çalışır:** yeni ikili; eski `durum.json`u, eski günlüğü (§2.4), eski `ayar.json`u, eski niyeti ve eski backend'i (`/health/yerel`siz backend dahil — bugün var) okur. Vektör klasörleri: `guncelleyici-gunluk/` · `guncelleyici-durum/` (var) · yeni `guncelleyici-ayar/` · `guncelleyici-niyet/`. Her yayınlanmış biçim örneği sonsuza dek klasörde kalır (silinmez — bekçi sayının düşmediğini ölçer).
4. **Dondurulmuş çekirdek yol:** kendini güncelleme yolu (ikiliyi doğrula → kopyala → kopyayı doğrula → `kunye` → yer değiştir → sayaç) ve günlük sürdürme yolu, bu plandan sonra yalnız **güvenlik düzeltmesiyle** değişir; değişirse T2 matrisinde "eski ikili → yeni ikili → bir sonraki ikili" üç halkalı zincir koşulmadan yayın çıkmaz (yayın kapısı: güncelleyici sürümü değişen paket, paket kimliğinde `guncelleyici.surum` farkıyla tanınır ve `kendi_guncelleme_zinciri` kanıt dosyası ister).
5. **Bildirimdeki `minKaynakSurum` ile ara sürüme sabitleme** (bugün var) güncelleyici için de kullanılır: güncelleyici yolunu kıran (çok nadir) bir değişiklik iki adımda yayınlanır — önce yeni biçimi okuyan ikili eski biçimle, sonra yeni biçim.

### 4.6 Güncelleyici güncelleyiciyi bozamaz — değişmezler

- Doğrulanmamış bayt hiçbir zaman çalıştırılmaz (bugün var: kopyanın özeti).
- Çapa kipi geçmez (hazırlık ↔ üretim, G3; bugün var).
- Platform geçmez: `kunye.hedef` = çalışan ikilinin hedefi (yeni; Windows paketindeki ikili Linux'a yerleşmez ve tersi).
- Asıl adda her an çalıştırılabilir bir ikili vardır — **W1b'de KAPANDI (2026-10-09; W-A + L-A + `onar`)**; W1 ölçümü: yol `çalışan → .eski` sonra `.yeni → asıl ad` diye iki ayrı yeniden adlandırmadır; ikisinin arasında süreç ölürse asıl ad BOŞ kalır (eski ikili `.eski`de, yeni `.yeni`de) ve açılışta asıl adı geri koyan yol yoktur — olamaz da, çünkü açılacak ikili asıl addadır (Windows'ta SCM ikiliyi bulamaz). Kapanışı W1b (§4.7: Windows'ta sürümlü ImagePath, Linux'ta tek atomik `rename(2)`, ikisinde de `.lkg onar`; §12 R13).
- Ek dosya (Linux) taban birimin `ExecStart`ını değiştiremez (§4.3).
- Sayaç, `.lkg` ve kurtarma ayarı güncelleyicinin özel alanındadır (`is/kendi.json`), backend yazamaz.

### 4.7 Karşılıklı onarım (W1b — kullanıcı kararı 2026-10-09) ✓

> **İNDİ 2026-10-09** (arşiv §2026-10-09 Güncelleyici W1b): `onar` çekirdeği (`src/onarim.rs`), W-A sürümlü ImagePath, L-A tek `rename(2)`, W-C görevi (`\TeksERP\<ad>-Onarim`, SYSTEM, açılış +2 dk + 15 dk), L-B gövdesi (L6'nın ölçen gövdesi kalktı, `onar` her biçimde onarım çekirdeğidir), dört kod; K1 `tests/onarim.rs` 14 senaryo iki yerleşimde, gerçek SCM/systemd dumanları CI'da yeşil. Uygulamanın plandan ayrıldığı yerler aşağıdaki maddelerde işlendi. Saha provası: `docs/ops/GUNCELLEYICI-ONARIM-PROVA.md` (senaryo 2 · 3 · 9'un gerçek satırları orada).

**Hedef:** güncelleyici ikilisi ya da hizmeti bozulduğunda (süreç ölümü, güç kesintisi, antivirüs, bozuk bayt) insan gerekmesin — setup "Onar" dahil. Kalıp Chrome'un kurtarma bileşenidir: **ürün, bozulan güncelleyicisini fark eder; onarımı doğrulanmış bir ikili yapar.** W1 ölçümünün açtığı "asıl ad boş kalır" borcu (§4.6, R13) bu dilimin kapsamıdır.

**Ölçümler (2026-10-09, kod okundu — varsayım değil):**

- **M1 — yer değiştirme iki adımlı, İKİ platformda da.** `selfupdate.rs` `stage_from`: `çalışan → .eski`, sonra `.yeni → asıl ad`; geri dönüş `swap_in` aynı kalıpta (`çalışan → .bozuk`, `yerine → asıl ad`). İkinci adım hata verirse eskisi geri konur; süreç ARADA ölürse asıl ad boş kalır. Gerçek `Fs::rename` = `durable_rename` (`platform/gercek.rs`). ⇒ Boşluk bugün Linux'ta da var. Linux'ta `rename(2)` hedefi atomik ezer ve çalışan süreç eski inode'da sürer, yani boşluk TEK adıma indirilerek kapatılabilir. Windows'ta çalışan imaj dosyasının üzerine yeniden adlandırma yapılamaz (bunun K2'de windows-latest'te ölçülmesi gerekir). Bu yüzden Windows'ta ya iki adım kaçınılmazdır ya da asıl adın kendisi değişmemelidir.
- **M2 — Windows hesapları.** Güncelleyici `LocalSystem` olarak çalışır, ImagePath sabittir (`<Kök>\guncelleyici\tekserp-guncelleyici.exe`; `deploy/hizmet/guncelleyici-hizmeti.ps1`). Dizine yalnız SYSTEM ve Administrators tam erişimlidir; geniş gruplar ve backend hesabının ACE'si açıkça çıkarılır. Backend `NT SERVICE\<ad>` sanal hesabıyla, en az ayrıcalıkla çalışır; program dizini ona salt okunurdur (`backend-hizmeti.ps1`). Hizmet DACL'i hiç yazılmıyor (`sdset` yok) ⇒ varsayılan güvenlik tanımı geçerli: hizmet hesapları güncelleyiciyi sorgular ama BAŞLATAMAZ. ⇒ Backend güncelleyiciyi ne yazabilir ne başlatabilir. Bu yalıtım bilinçlidir ve W1b onu GEVŞETMEZ.
- **M3 — Linux.** Güncelleyicinin durum dizini konteynere `ro` bağlanır (§7). Backend konak ikilisine erişemez ve erişmemelidir; yalnız gözler.
- **M4 — Kalp atışı zaten var.** `durum.json` `sonCanlilik` + `canlilikEsigiSn` alanlarını taşır; backend `update-status.service.ts` bunlardan `yanitVermiyor`u türetir, panel gösterir. Yoklama raporundaki `guncelleyici.durum` ∈ {`CALISIYOR`, `DURDU`, `YOK`, `OLCULEMEDI`} satıcıya gider.
- **M5 — Hizmet komut satırını değiştirme yeteneği zaten var.** PG küçük sürümü ImagePath'i değiştirir (`Services::set_image_path`); güncelleyici de kendi SCM kurtarma ayarını her açılışta hizalar (`recovery_drift`).
- **M6 — SCM kurtarma eylemleri** (yeniden başlat 10/10/30) yalnız süreç beklenmedik biterse işler. İkili YOKSA ya da imaj geçersizse hizmet hiç başlamaz ve kurtarma eylemi tetiklenmez (Windows'un belgelenmiş davranışı; K2'de ölçülecek).

**Roller.**
- **Güncelleyici → backend:** hizmeti, sürüm dizinini ve kurtarma ayarını onarır (bugün var); çit W2'de geliyor.
- **Backend (ürün) → güncelleyici:** GÖZLER ve GÖRÜNÜR KILAR, YAZMAZ (M2/M3). Kalp atışı eşiği aşılır ve hizmet yok/durmuşsa panelde uyarı çıkar, yoklama raporuyla satıcının filo görünümüne gider; sessiz kalmaz.
- **Onarıcı:** aynı ürünün `.lkg` ikilisi, yeni `onar` alt komutuyla. Onarılan ikiliden BAĞIMSIZ bir dosyadan çalışır. Yeni yapıt yok.

**Seçenekler — Windows**

| # | Seçenek | Artı | Eksi | Karar |
|---|---|---|---|---|
| W-A | Yeniden adlandırma yerine ImagePath'i SÜRÜMLÜ yola çevirmek: yeni ikili doğrulanıp `guncelleyici\s\<sürüm>\`e konur, tek kayıt yazımı (`ChangeServiceConfig`) hizmeti ona çevirir; geri dönüş = ImagePath'i `.lkg` yoluna çevirmek | Asıl ad boşluğu YAPISAL olarak kalkar: dosya hiç yer değiştirmez, kayıt yazımı tek adımdır. Yeni parça yok (M5) | Sabit yolu bilen 20 dosya sürümlü yolu tanımalı (ölçüldü: setup `.iss` · `kurulum.ps1` · `gecis.ps1` · `kaldir.ps1` · `guncelleyici-hizmeti.ps1` sapma ölçümü · `duman-windows.ps1` · paket kapsamı/kurulum bekçileri). Eski sürüm dizinleri budanmalı (son iki + `.lkg`) | **öneri** (önleme) |
| W-B | SCM `SC_ACTION_RUN_COMMAND` | SCM'in kendi mekanizması | Başlayamayan hizmette tetiklenmez (M6), yani boşluğu ve karantinayı kapatmaz; çalıştıracağı komut da yine bir dosyadır | RED (kapsamaz) |
| W-C | Zamanlanmış görev (SYSTEM; açılışta + 15 dakikada bir) `<lkg> onar` | Dış arızaları kapsar: karantina, silinme, bozuk bayt, durmuş hizmet | +1 hareketli parça: görev kaydı ve sapma ölçümü (setup kurar; güncelleyici her açılışta SCM kurtarma ayarıyla aynı mekanizmayla hizalar). Görevin kendisi de silinebilir; `.lkg` karantinadaysa kaynak sırası devreye girer | **öneri** (onarım) |
| W-D | Panelde "Onar" düğmesi (UAC yükseltmesiyle `onar`) | Yeni ayrıcalık yok | İnsan ister — hedefe aykırı | yalnız son çare: kaydı silinmiş ya da devre dışı hizmet (aşağıda) |

**Seçenekler — Linux**

| # | Seçenek | Artı | Eksi | Karar |
|---|---|---|---|---|
| L-A | Tek atomik `rename(2)`: `.eski` önce KOPYA ya da sabit bağ olarak alınır, sonra `.yeni → asıl ad` çalışanın üzerine yazar | Boşluk kalkar; yeni parça yok | `Fs`'e "üzerine yeniden adlandır" yeteneği gerekir (platform arka ucu; Windows kullanmaz) | **öneri** (önleme) |
| L-B | Donmuş taban birimde `ExecStartPre=-<lkg> onar --yalniz-asil-ad` (L6'da iki satır olarak İNDİ: önce `.lkg`, sonra `current/` ikilisi — madde 9'un geçişi ek satırla çözüldü, birim değişmeden; `onar` tek başına W1b öncesi ikililerde `tur` takma adı olduğundan `--yalniz-asil-ad` bayrağını tanıyan ikili tur KOŞMADAN çıkar — L6'dan itibaren her Linux ikilisi tanır; L6 gövdesi yalnız ölçerdi; W1b'de kalktı, `onar` her biçimde onarım çekirdeğidir — `--yalniz-asil-ad` yalnız hizmet durumuna bakmayı kapatır) | Silinme ve bozuk bayt her başlatmada onarılır; yeni dosya yok | Taban birim DONMUŞ olduğundan (§4.3) satır ilk Linux kurulumundan ÖNCE kesinleşmeli (L6/L7'den önce). Her başlatmada kısa bir süreç daha. `.lkg` de yoksa `-` öneki hatayı yutar, `ExecStart` düşer ve kaynak-yok uyarısı çıkar | **öneri** (onarım) |
| L-C | `OnFailure=` onarım birimi | Yalnız düşüşte koşar | `Restart=always` + `StartLimitIntervalSec=0` ile birim `failed` durumuna hiç girmeyebilir, yani tetiklenmeyebilir — **ölçüldü (L6, systemd 255, ubuntu-latest): TETİKLENİR** — `Restart=always` + `StartLimitIntervalSec=0` ile `/bin/false` ~8 sn'de 5 kez `OnFailure=` birimini koşturdu (her düşüşte, `failed`a girmeden); +1 birim | yedek (tetiklendiği ölçüldü; L-B'den sonra gerekirse) |
| L-D | systemd zamanlayıcısı (W-C'nin karşılığı) | İki platformda aynı model | +2 birim | RED (L-B yeter) |
| — | Konteynerden onarım | — | Backend konteyneri konak ikilisine yazamaz ve yazmamalı (M3, yalıtım) | RED |

**Hareketli parça bütçesi (öneri):** Windows'ta +1 zamanlanmış görev; Linux'ta taban birimde +1 satır. Yeni ikili, yeni ayrıcalık ve backend'e yeni yetki YOK. W-A olmadan W-C tek başına da boşluğu onarır, ama boşluk oluştuktan SONRA ve 15 dakikaya varan kesintiyle; W-A boşluğu hiç doğurmaz.

**`onar` alt komutu (iki platformda tek çekirdek; platforma özgü olan yalnız "hizmeti doğrulanmış ikiliye işaret et" adımı):**

1. **Kendi ölçümü:** ilk iş kendi dosyasının özetini `kendi.json` `lkgOzet` ile karşılaştırır. Tutmazsa hiçbir şey YAZMADAN çıkar ve görünür kod bırakır. Güven düzeyi bugünkü A/B'nin `.eski`yi çalıştırmasıyla aynıdır: SYSTEM/root'a özel dizin, `foreign_writers` ölçümü.
2. **Değişmez — doğrulanmamış bayt çalıştırılmaz:** hizmetin gösterdiği yere yalnız özeti imzalı listede tutan ikili konur (kendini güncellemede ayrıca: imzalı bildirim `guncelleyici.sha256` ilan ediyorsa paketteki ikili onunla tutmadan kopyalanmaz bile — R15). Linux'ta imzalı kaynak (`current/` · `surumler/<v>`) sürüm dizini bütünlük doğrulamasına (L4c) bağlıdır; o gelene dek Linux kaynağı yalnız `.lkg` ve `.eski`dir, taban birimin `current/` satırı kendini doğrulayamaz ve hiçbir şey yapmadan çıkar (çıkış 10). Kaynak sırası: `.lkg` (`lkgOzet`) → `.eski` → `current/runtime` (kurulu sürümün imzalı bütünlük listesi) → `surumler/<v>`. Her aday ayrıca `kunye` hedef ve çapa kipi denetiminden geçer (§4.6).
3. **Tetik:** hizmetin ikilisi (W-A'da ImagePath hedefi, L-A'da asıl ad) eksik ya da özeti doğrulanmış kümede değil → onarım; ikili sağlam ama hizmet durmuş VE kalp atışı eşiği aşılmış (`şimdi − sonCanlilik > canlilikEsigiSn`) → yalnız başlatma (o da onarım sayılır). Güncelleyicinin işlem kilidi alınamıyorsa hiçbir şey yapmaz; çalışan güncelleyiciyle yarışmaz.
4. **Onarım:** Windows'ta doğrulanmış kaynak `s\<sürüm>\`e KOPYALANIR ve ImagePath ona çevrilir (W-A; `.lkg` ImagePath'e ASLA verilmez — onarıcı kendi dosyasını hizmete vermez); Linux'ta asıl ada `.onarim` geçici kopyası + tek `rename(2)`. Ardından hizmet başlatılır. `is/onarim.json`a sayaç, zaman ve neden yazılır; günlüğe ve `durum.bilgi`ye `ONARILDI` düşer.
5. **Tavan (döngü yok):** 24 saatte en çok 3 onarım. Aşılırsa ONARMAZ; `ONARIM_TAVANI` görünür kod olarak panele ve satıcıya gider. Sayaç, tavana ulaşıldıktan sonraki ilk sağlıklı turda sıfırlanır (tavan altında sıfırlanmaz: her onarımı zaten sağlıklı bir tur izler, sıfırlansaydı sürekli bozulan ikili tavana hiç ulaşmazdı).
6. **Disk dolu:** W-A ve sabit bağ veri yazmaz. Kopya gerekir de yer yoksa `DISK_DOLU` verir; hiçbir şeyi silmez, yarım kopya bırakmaz.
7. **Hizmet kaydı silinmiş ya da "Devre dışı" yapılmış — BİLİNÇLİ KARAR: onarılmaz, görünür uyarı verilir.** Gerekçe: bunu yalnız yönetici yapabilir ve bilinçli bir eylemdir; geri almak yöneticiyle çatışmak olur, bakım eylemleriyle de karışır. İstisna: W2 çitinin kendi koyduğu "Devre dışı" (işareti `is/cit.json`) — onu çitin sahibi kaldırır. Uyarı en geç bir yoklama turunda panelde ve satıcı filo görünümünde görünür (`guncelleyici.durum` `YOK`/`DURDU`; ayrı `DEVRE_DISI` değeri gerekirse enum reçetesiyle — TS, Rust ve satıcı aynı commit'te). Çare: W-D (panel "Onar", UAC) ya da setup onarımı. Kullanıcı farklı karar verirse bu madde değişir.
8. **Yeni kodlar:** `ONARILDI` (bilgi) · `ONARIM_TAVANI` · `ONARIM_KAYNAK_YOK` · `GUNCELLEYICI_KAPALI` — Rust + TS + panel etiketi aynı commit'te. Deneme sonucu olmadıkları için RAPOR KODU DEĞİLLER (`gecmis.jsonl`a ve `UPDATE_RESULT_CODES`a girmez; satıcı `guncelleyici.durum` `DURDU`/`YOK` görür). Üç arıza kodunda panel onay SUNMAZ (`updaterDownReason`): durmuş güncelleyiciye yeni onay yolu açılmaz.
9. **Geçiş:** ilk W1b'li sürüm geldiğinde `.lkg` henüz W1b öncesi bir ikilidir ve `onar`ı tanımaz. Bu yüzden görev ve birim satırı yalnız `onar`ı bilen bir ikiliyi gösterir: o dönemde imzalı listedeki `current/runtime` ikilisini, `.lkg` W1b'li olunca da `.lkg`yi. Bu geçiş T2 halkasında ölçülür. **1e kararı (2026-10-09):** geçişte W1b ikilisi bozulursa onarım W1 `.lkg`yi koyar ve bu KALIR — `calisanOzet`li aday öne alınmaz: doğrulanmış kaynak önceliklidir, durum yalnız geçişe özgüdür ve sonraki tur W1b'yi yeniden yerleştirir (`onarim_eski_lkg_gecisi`).

**Test — gerçek hayat senaryoları (§9 katmanlarına bağlı).** W1b'nin **"bitti" ölçütü bu tablonun yeşil kanıtıdır.** Kanıt satırları §9.5 kanıt dosyasına `onarim` bölümü olarak girer; W1b'li güncelleyiciyi taşıyan sürüm kanıtsız yayınlanmaz.

| # | Gerçek hayat senaryosu | Beklenen | K1 sahte dünya (her PR) | CI — K2/K4/K5 (ubuntu-latest + windows-latest) | Gerçek — K3/K5/K6 | Kanıt |
|---|---|---|---|---|---|---|
| 1 | Kendini güncellemenin ve geri dönüşün HER adımında süreç ölür (iki yeniden adlandırma arası dahil) | Asıl ad / ImagePath her an doğrulanmış bir ikiliyi gösterir; enjeksiyonla boşluk yaratılırsa `onar` düzeltir | `asil_ad_bosluk_onarilir` · `kendi_guncelleme_her_adimda_oldur` (`crash_restart` döngüsünün bu yola genişlemesi) | K2: windows-latest gerçek SCM (`duman-windows.ps1` yeni bölüm, `taskkill /F` ara noktada) · ubuntu-latest gerçek systemd (`kill -9`) | — | cargo koşusu + CI koşu bağlantıları |
| 2 | Gerçek güç kesintisi aynı noktalarda | Açılışta hizmet ayağa kalkar ya da `onar` onarır; yarım dosya çalıştırılmaz | CrashFs: fsync'lenmemiş yazı kaybı modeli | — (CI yeniden açılış yapamaz) | Windows: thinkpad, T3 "GUC" senaryosuna yeni satırlar (`shutdown /r /f /t 0` + fişten çekme; kendini güncellemenin her adımında ve onarımın ortasında) · Linux: deneme VDS, P1a (sağlayıcı panelinden sert yeniden başlatma) | Senaryo satırı: zaman, adım, açılış sonrası `durum.json` + `sc qc` / `systemctl status` |
| 3 | Antivirüs/Defender asıl ikiliyi karantinaya alır ya da siler (Windows'ta en sık gerçek arıza) | ≤15 dk içinde `onar` (W-C) doğru kaynaktan geri koyar. `.lkg` de karantinadaysa sıradaki kaynak kullanılır | `ikili_silindi_onarilir` · `lkg_karantinada_sonraki_kaynak` | K2 windows-latest: Defender açık; dosya silinir + hizmet durur, görev elle (`schtasks /run`) ve zamanında tetiklenir | thinkpad: gerçek Defender açık, dosya Defender karantinası kalıbıyla taşınır | Olay günlüğü + `durum.json` `ONARILDI` |
| 4 | Bozuk bayt (yarım yazılmış dosya, disk hatası) | Özet tutmaz → o dosya ne çalıştırılır ne gösterilir; doğru kaynaktan geri konur | `onarim_dogrulanmamis_calistirmaz` (bayt çevrilmiş asıl ad ve `.lkg`; sahte dünyada çalıştırma kaydı bozuk dosyayı hiç görmez) · `bozuk_asil_ad_dogru_kaynaktan` | İki platformda gerçek dosya: son 4 KB kesilir | thinkpad bir kez | Koşu + çalıştırma kaydı |
| 5 | Hizmet kaydı silinmiş ya da yönetici "Devre dışı" yapmış | ONARILMAZ (madde 7); en geç bir yoklama turunda panel + satıcı uyarısı. W2 çit işareti istisnadır | `devre_disi_onarilmaz_gorunur` · `cit_isareti_istisna` | windows-latest `sc config start= disabled` / `sc delete` · ubuntu-latest `systemctl disable --now` / `mask` | thinkpad bir kez | Panel ekran görüntüsü + satıcı yoklama kaydı |
| 6 | `.lkg` de bozuk ya da yok | Kaynak sırası işler (`.eski` → `current/runtime` → `surumler/<v>`); hiçbiri yoksa `ONARIM_KAYNAK_YOK` panelde ve satıcıda görünür — sessiz kalmaz | `onarim_kaynak_sirasi` · `kaynak_yoksa_gorunur` | İki platform | — | Koşu + rapor vektörü |
| 7 | Disk dolu iken onarım | W-A / sabit bağ veri yazmadan onarır; kopya gerekirse `DISK_DOLU` — hiçbir şey silinmez, yarım kopya kalmaz | `onarim_disk_dolu` (`enospc_at` — W3a'dan; W3a sonra inerse W1b kendi enjeksiyonunu getirir) | ubuntu-latest küçük tmpfs · windows-latest küçük sanal disk (kurulabilirliği ölçülecek) | — | Koşu |
| 8 | Onarım döngüsü (bozuk ikili sürekli geri geliyor) | 24 saatte 3 onarım tavanı → `ONARIM_TAVANI` uyarısı; sonsuz döngü yok | `onarim_dongusu_tavanli` (sahte saat) | K5 gecelik kaos: 100 kez boz → tavanda durur | — | Gecelik koşu |
| 9 | Eski güncelleyici sürümünden onarım | W1b öncesi `.lkg` ile görev/birim `current/runtime`'ı gösterir; W1 → W1b → W1b+1 zincirinin her halkasında onarım çalışır | `onarim_eski_lkg_gecisi` | K4 sentetik zincir (T2): sahte dünya + gecelik iki platform | thinkpad: hazırlık kanalının gerçek paketleriyle (§9.4) | Gecelik koşu + prova satırı |

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

Bu, gruplar düzeyinde zaten bir **kanarya → öncü → genel** zinciridir. Eksik olan: grubun İÇİNDE kademelendirme ve başarısızlığın filo düzeyinde görünürlüğü. **Kendi kendini durdurma YAZILMAZ** (AK-2: aşamaları insan ilerletir).

### 6.2 Dalga — güncelleyiciye DOKUNMADAN, aşamalar ELLE (F1, AK-2)

**Mekanizma, var olan alanla:** satıcı her kiranın `guncelleme.hedefSurum`unu (sabitleme) basarken bir **dalga tavanı** uygular: `etkin hedef = min(insanın sabitlemesi, dalga tavanı)`. Dalgaya henüz girmemiş kurulumun kirasında `hedefSurum` = gruptaki bir önceki sürüm ⇒ güncelleyici `GUNCEL/HEDEF_ULASILDI` der ve indirmez. Sözleşme, güncelleyici ve backend DEĞİŞMEZ; eski güncelleyiciler de dalgaya uyar. (Portal insan sabitlemesini ve dalga tavanını ayrı gösterir; kirada ikisinin minimumu gider.)

- **Dalga ataması belirlenimlidir:** kurulum kimliğinin özeti → 0–99 kova; aşama sınırları sürüm başına (varsayılan: `genel` grubunda %10 → %50 → %100; kurulum sayısı küçükken en az 1 kurulum). Öncü/test gruplarında dalga yok.
- **Aşamayı İNSAN ilerletir (AK-2):** portalda sürüm × grup başına bir **aşama** alanı (0 = durdu · 1 = %10 · 2 = %50 · 3 = hepsi) ve "sonraki aşamaya geç" / "aşamayı geri çek" düğmeleri; her değişiklik gerekçelidir ve satıcının karar defterine (`kurulum_kaydi` karar satırı) yazılır. Yeni aşama kiraya bir sonraki yenilemede (saatlik) ya da zille hemen yansır. Takvim yok, otomatik geçiş yok.
- **Başarısızlık görünürlüğü (durdurmaz, uyarır):** portal her aşama için kurulum başına sonucu gösterir (TAMAMLANDI · GERI_DONDU · BASARISIZ · bekliyor; var olan olaylardan ve yoklama raporundan — yeni tel alanı yok). Bir sürümün dalgasında `GERI_DONDU` + `BASARISIZ` **≥ 2 kurulum ya da ≥ %10** olunca satıcıya **uyarı** gider (yeni olay `GUNCELLEME_DALGA_UYARI`, var olan giden kutusu → e-posta + Telegram); yayılım KENDİLİĞİNDEN DURMAZ — karar insanındır. Uyarı açıkken ya da aşamadaki kurulumların %80'inden azı sonuç bildirmişken "sonraki aşamaya geç" ek bir onay ister (gerekçe alanı zorunlu; engel değil, uyarı).
- **Durdurmak = aşamayı geri çekmek:** "aşama 0" o sürümün tavanını gruptaki bir önceki sürüme indirir (her kuruluma zil); "filo acil durdurma" ayrı bir mekanizma DEĞİLDİR, bütün gruplarda aşama 0'dır (tek alan, tek yol). Kurulum başına K1'den ayrıdır (K1 yaptırımdır, lisans yüzüne yansır; bu yalnız yayılımı durdurur). Zaten indirilmiş ama uygulanmamış paket, uygulamadan hemen önce yeni kiraya göre karar verilir (bugün var: aday ve karar tazelenir) — **ama** kira saatlik yenilenir, zil ile hızlanır; zil kaçarsa en kötü 1 sa gecikme kabul edilir (geri çekme "bundan sonra başlayacak olanları" durdurur, başlamış işlemi DURDURMAZ — başlamış işlem kendi sağlık ölçüsüyle biter ya da döner). Zaten güncellenmiş kurulumlara dokunulmaz (geri inme yok).
- **Neden otomatik ilerletme/durdurma YAZILMAZ (bayrakla kapalı da doğmaz):** kullanıcı istemedi (AK-2); kapalı bayrakla doğan kod, hiç koşmayan ama bakımı ve testi süren bir yoldur (bayrak reçetesi + iki kollu test + "açılınca ne olur" sorusu) — hareketli parçası en az olan seçenek hiç yazmamaktır. İleride istenirse ölçü (sonuç sayaçları) zaten vardır; eklenecek tek şey sayaçtan aşama alanına yazan bir karar katmanıdır, güncelleyici ve sözleşme yine değişmez.

### 6.3 CDN yükü (A8, W5)

- **İşaretçi sorgusu:** bugün aday ≤ 5 dk'da bir tazelenir. Yeni kural: aday, (a) kira yenilendiğinde (saatlik + zil) ve (b) en geç 6 saatte bir, kurulum kimliğinden türeyen sabit bir kaydırmayla sorgulanır; `HAZIR` iken ve uygulamadan hemen önce bugünkü tazeleme aynen. 300 kurulum × 24 = ~7.200 istek/gün (bugün ~86 bin).
- **Paket:** sürüm dizini DEĞİŞMEZ ve uzun önbellekli (bugün var) ⇒ kaynağa POP başına bir kez gelir. Yüzlerce kurulumun aynı pencere başında birden indirmesi beklenmez: indirme pencereden BAĞIMSIZ, aday göründüğü anda (kaydırmalı) yapılır; pencere yalnız UYGULAMAyı başlatır.
- **Worker kotası:** belirteç doğrulaması her istekte Worker'dan geçer; ücretsiz katmanın günlük istek sınırı ölçülerek izlenir (F1c: yayın defterinin yanında günlük sayım; %50'yi geçince uyarı). Linux paketi (imaj tar ~0,3–0,5 GB, ölçülecek) Windows zip'inden büyüktür; bant genişliği Cloudflare önbelleğinde maliyet doğurmaz, kaynak VDS'e yalnız önbellek ıskasında gelir.
- **İndirme kesilirse** sürdürülebilir indirme (Range) bugün var; Linux tar'ı için de aynı kod.

## 7. Gözlemlenebilirlik

| Yüzey | Windows (bugün) | Linux | Not |
|---|---|---|---|
| Durum dosyası `durum.json` + kalp atışı (`sonCanlilik`, `canlilikEsigiSn`) | `%ProgramData%\TeksERP\guncelleme\durum\` | `/var/lib/tekserp/guncelleme/durum/` → konteynere `ro` | biçim AYNI (§5.2); backend `TEKSERP_GUNCELLEME_DIZINI`den okur — Linux'ta bu değişken compose'da ÜRETİM değeridir ve tek kaynaktır (L5 compose · L2b `updater-ipc.ts` + `GUNCELLEYICI.md` eşleme cümlesi) |
| Geçmiş `gecmis.jsonl` | aynı dizin | aynı dizin | aynı |
| Panel "Sistem → Sunucu Güncellemeleri" + onay ucu | var (D7) | DEĞİŞMEZ — aynı uçlar, aynı eşleme (`Teks-Erp/src/services/update-status.service.ts`) | yalnız yeni bilgi kodları (`ALTYAPI_BEKLENIYOR` · `KURTARMA_SURUYOR` · `GUNCELLEYICI_ONCE`) panelin "Bilgi" satırına düşer |
| Sunucu simgesi (`/health/tepsi`) | var | yok (bulutta masaüstü yok) | — |
| Güncelleyici günlüğü | `<KOK>\guncelleyici\gunluk\guncelleyici.log` (UTC, 10 MB × 10) | `/opt/tekserp/guncelleyici/gunluk/guncelleyici.log` aynı döndürme (`tekserp-hizmet` `RotatingLog`, platform bağımsız) **+** stderr → systemd günlüğü (BULUT §1.4: 500 MB tavan) | sır yok; araç çıktısındaki `şema://kullanıcı:parola@` maskelenir (bugün var) |
| Olay günlüğü | Uygulama olay günlüğü | systemd günlüğü (`SYSLOG_IDENTIFIER=tekserp-guncelleyici`) | düzeyler aynı |
| Backend/araç çıktısı | konak `logs\backend-*.log` | Docker `json-file` 20 MB × 5 (`daemon.json`); araç konteynerinin çıktısı güncelleyici günlüğüne süzülerek kopyalanır (son 200 satır) | — |
| Yoklama raporu → satıcı | var | aynı; platform satıcıda kurulumun kaydından (bulut kurulumu `BARINDIRILAN`, platform kanal kaydının `bulut.platform`unda) — yeni tel alanı gerekmez | filo ekranı platformu kendi kaydından gösterir |

**Satıcı uyarıları (F1a/F1c):** `HATA` (bugün `GUNCELLEME_BASARISIZ`) · güncelleyici `OLCULEMEDI`/`DURDU` 2 yoklamadan uzun · sürüm başına dalga uyarısı `GUNCELLEME_DALGA_UYARI` (F1a) · `KURTARMA_SURUYOR` 1 saatten uzun (F1c — kod W3b'de doğar). Hiçbiri yayılımı durdurmaz (AK-2). Hepsi var olan giden kutusundan (e-posta + Telegram); yeni kanal açılmaz.

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

Güncelleyici tarafında **engel yok:** gelen port açmaz, yalnız CDN'e ve (backend üzerinden) lisans sunucusuna çıkar; Tailscale istemez; root'ta koşan tek hizmettir; politika/pencere/onay fabrikadakiyle aynı. Engeller güncelleyicinin dışındadır: (1) Docker kurulumunda fabrika ağı TLS'i yok — yalnız şifreli bağlanan panel ve tablet bağlanamaz (`LINUX-DOCKER-KURULUM` §7); fabrika içi kenar (LAN sertifikası) ayrı iş · (2) kurulum aracı Mac + SSH'tır; müşteri yerinde kullanıcının kendisi kurar (kullanıcı kararı 2026-10-02) ⇒ yerinde çalışan bir kurulum betiği gerekir · (3) konteynerde parmak izi zayıf tanımadır (iki etken). **Kullanıcı kararı AK-1: Linux/Docker kurulumu şimdilik YALNIZ bizim yönettiğimiz bulut sunucusunda (VDS); fabrika Linux sunucusu kapsam dışı.** Kapı açık bırakılır: güncelleyici kodunda "bulut mu" dalı yazılmaz (kurulum yeri güncelleyicinin bilgisi değildir; yalnız kurulum aracı ve kenar bulut biçimindedir), böylece fabrika Linux'u ileride yalnız yukarıdaki üç dış engelin işidir.

## 9. Test stratejisi — "bir kere yap, hep çalışsın"ın kanıtı

İlke: H1–H3'ün her cümlesi bir **senaryoya**, her senaryo **iki platform profilinde** bir teste, her test bir **kapıya** bağlanır. Sahte dünya (hızlı, belirlenimli, her makinede) ispatın ana gövdesidir; gerçek platform testleri sahte dünyanın gerçeği doğru taklit ettiğini ölçer.

### 9.1 Katmanlar

| Katman | Ne ölçer | Nerede koşar | Neden orada |
|---|---|---|---|
| **K0 Vektörler** | TS ↔ Rust sözleşme aynası (bildirim · kira · karar · rapor · zincir seçimi · env · şema hizası) + yeni: sözleşme 5 · eski biçim klasörleri (`guncelleyici-gunluk/`, `-ayar/`, `-niyet/`, `-durum/`) | Mac (`cargo test`), CI ubuntu-latest + windows-latest | saf hesap; platformdan bağımsız |
| **K1 Sahte dünya** (`tests/common`, bugün ~30 senaryo) | durum makinesi, telafi, öldür-yeniden başlat, arıza enjeksiyonu | aynı üç yer | belirlenimli; bir PR'ı dakikada ölçer. Windows CI'ı yalnız NTFS junction/yeniden adlandırma gerçeği için ek değer katar |
| **K2 Gerçek platform dumanı** | sahte dünyanın varsaydığı platform davranışı gerçekte de öyle mi | Windows: windows-latest (`duman-windows.ps1`, gerçek SCM — bugün var) · Linux: ubuntu-latest (gerçek systemd + gerçek Docker; GitHub'ın Ubuntu makinelerinde ikisi de hazır) | hızlı, her PR'da; yeniden açılış ve güç kesintisi YAPAMAZ |
| **K3 Gerçek uçtan uca** | gerçek korumalı paket/imaj + gerçek PG + gerçek göçler + panel ekranı | Windows: thinkpad-1 (gerçek Windows 11, kendi PG örneği, bugünkü D-prova makinesi) · Linux: ubuntu-latest (elle tetiklenen iş) | windows-latest kalıcı hizmet ve yeniden açılış taşımaz; thinkpad sahaya en yakın Windows'tur |
| **K4 Yükseltme matrisi** | N→N+k, göçlü/göçsüz, geri dönüş, kendini güncelleme zinciri, eski↔yeni güncelleyici | sentetik sürüm zinciri: sahte dünyada (her PR) + gerçek platformda (ubuntu-latest VE windows-latest gecelik — `guncelleyici-gece.yml`; thinkpad yalnız hazırlık kanalının gerçek paketleriyle prova, §9.4) | gerçek eski sürümler yeniden derlenemez (bayt kodu V8'e kilitli); sentetik zincir aynı ikiliden, göç ve ikili sürümü farklı paketler üretir |
| **K5 Kaos / uzun koşu** | rastgele arıza altında yüzlerce döngüde değişmez hiç bozulmuyor mu | ubuntu-latest gecelik (öldürme · disk · Docker yeniden başlatma · ağ) + windows-latest gecelik (öldürme · hizmet yeniden başlatma · disk) · gerçek güç kesintisi: deneme VDS (sağlayıcı panelinden sert yeniden başlatma) ve thinkpad (`shutdown /r /f /t 0` + fişten çekme) — elle, güncelleyici sürümü değişince | CI makinesi kendini yeniden başlatamaz; gerçek güç kesintisi yalnız gerçek makinede ölçülür |
| **K6 Deneme VDS provası** | bizim gerçek bulut düzenimizde ilk kurulum + ilk otomatik güncelleme | 213.142.134.226 (`deneme.etkiliyazilim.com`) — **AK-4: ders kurulumunun YANINA**, ayrı dizin (`/opt/tekserp-prova`), ayrı proje adı (ayrı birimler, ayrı PG) ve ayrı port; ders kurulumuna dokunulmaz, bellek iki kurulumu taşımazsa ayrıca sorulur | ilk BARINDIRILAN müşteriden önce şart (BULUT B11'in güncelleyici kısmı) |

**CI yeri (kullanıcı kararı AK-5, 2026-10-08):** otomatik testlerin hepsi GitHub Actions'ta, **ubuntu-latest VE windows-latest**'te koşar (repo açık, dakika ücretsiz; kullanıcı "yerele al" diyene dek). Üç iş akışı: `native-windows.yml` (var; PR) · `native-linux.yml` (yeni, T0; PR — fmt + clippy + bütün `cargo test`, T1'den sonra duman adımı) · `guncelleyici-gece.yml` (yeni, T0 iskelet; gecelik + elle tetik; ubuntu-latest × windows-latest matrisi: K4 sentetik zincir (T2) ve K5 kaos (T4); son 25 saatte `Teks-Erp/native/**` değişmediyse işi atlar — maliyet için değil, gürültüsüz yeşil için). thinkpad **yalnız gerçek derleme ve gerçek prova** içindir (K3 Windows, K5 güç kesintisi, T3 "GUC", §9.4 gerçek paket provası); CI'ın yerini tutmaz, CI de onunkini.

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

Her satır iki profilde (W = Windows, L = Linux) koşar. "Kapı": **PR** = `native-windows.yml` + yeni `native-linux.yml` (yol süzgeci `Teks-Erp/native/**`, bugünküyle aynı) · **Gece** = `guncelleyici-gece.yml` (ubuntu-latest × windows-latest) · **Sürüm** = yayın kapısının istediği kanıt (§9.5).

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
| Bozuk paket / bozuk imaj / etiket kaydı | paket var · imaj yeni | L: gerçek `docker load` | — | `imaj_bozuk` · `imaj_etiketi_kaydi` (L4c) | PR |
| Ağ kesintisi (indirme sürer; işlem ağa çıkmaz) | var + yeni | — | K5 `iptables` | `download_resumes_after_cut` · `ag_yok_islem_tamamlanir` | PR |
| Kendini güncelleme: A/B, 3 açılış, kopya değişti, öteki çapa, öteki platform | var → + platform | W var · L yeni (gerçek rename + systemd yeniden başlatma) | K4 zinciri | `self_update.rs` + `kendi_platform_gecmez` | PR |
| Önce güncelleyici (backend geri dönse bile ikili yerleşir) | yeni | — | K4 | `once_guncelleyici` | PR + Sürüm |
| Son bilinen iyiye dönüş (gizli hata) | yeni | — | K4 | `lkg_donusu` | PR |
| Eski güncelleyicinin yarım günlüğünü yeni ikili sonuçlandırır | yeni (vektör klasörü) | — | K4 | `eski_gunluk_surdurulur` | PR |
| Eski güncelleyici + yeni yayın (zincir/yeni ad yanında) | var (D7 prova) → genişler | — | K4 | `prova-paket-zinciri` + `eski_okuyucu_yeni_yayin` | PR |
| N→N+5 (`minKaynakSurum` → ara sürüme sabitleme) | yeni | — | K4 | `atlamali_yukseltme` | Gece |
| Pencere sınırında başlayan işlem pencere kapansa da biter | var | — | — | `decision` vektörleri | PR |
| Dalga tavanı → `HEDEF_ULASILDI` (güncelleyici değişmeden) | vektör | — | — | `guncelleme-karar.json` yeni kayıtlar | PR |
| 100 döngülük kaos (rastgele öldürme · disk · Docker yeniden başlatma · ağ) | — | — | L + W gecelik | `kaos_uzun_kosu` | Gece |
| Gerçek güç kesintisi (adım 2, 4, 5, telafi ortası) | — | — | thinkpad · VDS (elle) | senaryo belgesi "GUC" | Sürüm |

### 9.4 Sentetik sürüm zinciri (K4 aracı — T2)

Gerçek eski backend sürümleri yeniden derlenemez (bayt kodu derleyen V8'e kilitli) ve göç geçmişi gerçek veriye bağlıdır. Bu yüzden matris **tek bir derlemeden** türetilmiş paket ailesiyle koşar: `t1 … t6` sürümleri aynı ikili/imajın üstüne **yalnız göç klasörü** (tablo ekle · kolon ekle · `CONCURRENTLY` dizin · bilerek düşen göç · uzun süren göç) ve **güncelleyici künye sürümü** farklı paketler olarak üretilir; test çapasıyla (`test-anchor` özelliği; üretim ikilisine girmez — bugün var) imzalanır ve `http://127.0.0.1` sunucusundan dağıtılır (test derlemesinde izinli — bugün var). Linux'ta imaj ailesi tek taban imaj + ince göç katmanıyla (G13'ün "ince son katman" yöntemiyle aynı) üretilir. Gerçek veriyle prova ayrıca: Windows'ta hazırlık kanalının gerçek yayınlanmış paketleri thinkpad'de, Linux'ta en eski canlı dökümün kopyası üzerinde (kök kural: şema provası en eski canlı dump'ta).

### 9.5 Yayın kapısı — kanıtsız güncelleyici sahaya çıkmaz

`deploy/backend-yayinla.mjs`, yayınlanacak paketteki güncelleyici ikilisinin sürümü yayındaki sürümünkinden farklıysa bir **kanıt dosyası** ister (`kanit/guncelleyici-<sürüm>.json`: commit · PR koşusu (K0–K2 yeşil) · gecelik koşu (K4/K5 yeşil; GitHub Actions koşu bağlantıları, ubuntu-latest + windows-latest — AK-5) · gerçek prova satırları (thinkpad "GUC" ve VDS "GUC" — güncelleyici sürümü değiştiyse) · `onarim` bölümü: §4.7 senaryo tablosunun dokuz satırının kanıtı — onarım yolu ya da W1b değiştiyse)). Kanıt yoksa yayın DURUR; kaçış yalnız kullanıcı cümlesiyle (`--terfi-atla` kalıbı). **W1b ✓ (2026-10-09):** `onarim` bölümünün K1 + CI satırları hazır (`tests/onarim.rs` 14 senaryo · Windows dumanı §7 gerçek SCM + görev · Linux `duman-linux-onarim.sh` gerçek systemd: silinme + `kill -9`, kesik bayt, `mask`, tavan, tmpfs disk dolu); gerçek satırlar (senaryo 2 · 3 · 9) `docs/ops/GUNCELLEYICI-ONARIM-PROVA.md`yle kullanıcı provasından gelir. Güncelleyici değişmediyse (çoğu sürüm) kapı hiçbir şey istemez — "nadiren değişir" hedefinin ölçüsü de budur: yayın defteri güncelleyici sürümünün kaç yayında değiştiğini sayar.

## 10. Dilim planı

Büyüklük ölçüsü bir ajan bağlamıdır (ajanlar ~250 bin jetonda takılıyor): **K** (küçük) ≈ 60–100 bin · **O** (orta) ≈ 100–160 bin · **B** (büyük) ≈ 160–220 bin; B üstü dilim yazılmadı (bölündü). Her dilim kendi worktree'sinde; testler hedefli (dilimin bekçileri + `cargo test -p tekserp-guncelleyici`), tam paket faz inişinde.

| # | Dilim | Net çıktı | Bekçiler | Bağımlı | Boy |
|---|---|---|---|---|---|
| **W0** | Sözleşmenin dondurulması | GUNCELLEYICI.md'ye dondurma bölümü (§4.5 kuralları) · eski biçim vektör klasörleri (`guncelleyici-gunluk/` · `-ayar/` · `-niyet/`; bugünkü ve yayınlanmış her güncelleyici sürümünün her adımda yarım bıraktığı günlük — eski etiketlerden sahte dünyada üretilir) · ISLEM satırına `v` + `platform` · senaryoları `senaryo(profil)` biçimine çevirme iskeleti | `eski_gunluk_surdurulur` · vektör sayısı düşmez (cırcır, iki sonda) | — | O |
| **T0** | CI iskeleti (AK-5) | `native-linux.yml` (ubuntu-latest, PR, yol süzgeci `Teks-Erp/native/**`: fmt + clippy + bütün `cargo test` — bugünkü kod Mac'te zaten derleniyor) · `guncelleyici-gece.yml` iskeleti (gecelik + elle tetik; ubuntu-latest × windows-latest; bugün bütün `cargo test`i `--include-ignored` ile koşar, T2/T4 adımlarını sonra alır; 25 saatte native değişmediyse atlar) · yalnız `.github/workflows/` | iki iş akışının ilk yeşil koşusu · bilerek kırılan test → kırmızı (negatif sonda) | — | K |
| **L1** | Platform sınırı (davranış değişmez) | `src/platform/{windows,linux}` · `Saglik` · `Araclar` · `PgArkaUcu` özellikleri · Linux saplamasıyla derlenir (CI: T0'ın `native-linux.yml`i) | `test_guncelleyici_platform_siniri` (çekirdekte `cfg`/`windows_sys` yok) · bütün mevcut testler aynen yeşil (iki CI makinesinde) | W0 | O |
| **W1** ✓ | Önce güncelleyici + son bilinen iyi | §4.2 üç madde; `kunye.hedef` platform denetimi; `durum.bilgi = GUNCELLEYICI_ONCE`; AK-3 (`DONDUR`da ikili yenilenir, K1'de hiçbir şey) | `once_guncelleyici` · `lkg_donusu` · `kendi_platform_gecmez` · `dondur_kendini_yeniler` · `k1_hicbir_sey_yenilenmez` · `self_update.rs` | L1 | O |
| **W1b** ✓ | Karşılıklı onarım (kullanıcı kararı 2026-10-09; §4.7) — **İNDİ 2026-10-09** (arşiv §2026-10-09 Güncelleyici W1b; saha provası `docs/ops/GUNCELLEYICI-ONARIM-PROVA.md`) | İki alt dilim. **W1b-1 (O):** `onar` alt komutu (kendi ölçümü · kaynak sırası · tetik · tavan · görünür kodlar `ONARILDI` · `ONARIM_TAVANI` · `ONARIM_KAYNAK_YOK`, Rust + TS + rapor vektörü aynı commit'te) · Linux L-A tek atomik `rename(2)` · Windows W-A sürümlü ImagePath çekirdeği (`set_image_path`) · K1 senaryoları 1, 3–9 · **W1b-2 (O):** Windows kurulum yüzeyi — W-A'nın 20 sabit yol dosyası (setup · kurulum · geçiş · kaldırma · `guncelleyici-hizmeti.ps1` sapma ölçümü), W-C zamanlanmış görevi (kayıt + açılışta hizalama) · K2 dumanı (windows-latest + ubuntu-latest) · Linux L-B satırı L6'nın taban birimine (L6'dan ÖNCE kesinleşir, birim donmuştur). Gerçek prova satırları (§4.7 tablo 2, 3, 9) T3 ve P1a'ya eklenir | `asil_ad_bosluk_onarilir` · `kendi_guncelleme_her_adimda_oldur` · `onarim_dogrulanmamis_calistirmaz` · `ikili_silindi_onarilir` · `lkg_karantinada_sonraki_kaynak` · `bozuk_asil_ad_dogru_kaynaktan` · `devre_disi_onarilmaz_gorunur` · `cit_isareti_istisna` · `onarim_kaynak_sirasi` · `kaynak_yoksa_gorunur` · `onarim_disk_dolu` · `onarim_dongusu_tavanli` · `onarim_eski_lkg_gecisi`; **bitti = §4.7 senaryo tablosunun yeşil kanıtı** (§9.5 kanıt dosyası `onarim` bölümü) | W1 (W1b-2: W1b-1) | O + O |
| **W2** | Bakım çiti (A3) | adım 0 `CIT` (Windows başlangıç türü; Linux ölçüm), plan + telafi + son durumlarda kaldırma, `reboot_at` arızası, `duman-windows.ps1` gerçek `sc config` ölçümü | `acilis_yarisi_her_adimda` (iki profil) | W1 | O |
| **W3a** | Disk | yedek alan dosyası, ENOSPC enjeksiyonu (`enospc_at`), §5 madde 4 disk formülü (Windows) | `disk_dolu_her_yazimda` | L1 | O |
| **W3b** | Altyapı bekleme + HATA kurtarma + iç bekçi | §2.3'ün üç satırı; `ALTYAPI_*` · `KURTARMA_SURUYOR` kodları (Rust + TS + rapor vektörü aynı commit'te) | `altyapi_bekleme` · `hata_kurtarma_turu` · `ic_bekci` · `test_guncelleme_protokol` | W2 | B |
| **W4** ✓ | Tanı paketi | `tani` alt komutu (iki platform) + runbook satırı — **İNDİ 2026-10-09** (arşiv §2026-10-09 Güncelleyici W4; Linux ölçümleri L4b'nin `DockerServices`i gelene dek doğrudan `docker`/`systemctl`/`df` ile, fail-soft) | `tani_paketi_sir_tasimaz` | L1 | K |
| **W5** | CDN yükü | aday sorgusu kira yenilenmesine + 6 sa tavana + kurulum kaydırmasına bağlanır (§6.3) | sahte saatle istek sayımı (`aday_sorgu_sikligi`) | L1 | K |
| **L2a** | Sözleşme 5 — protokol | `backend-oci` ürünü · `linux-x64-oci` platformu · `imaj` · `guncelleyici` blokları · `SURUM_PLATFORM` · TS + Rust aynası + vektörler aynı commit'te | `test_guncelleme_protokol` · `sozlesme_vektorleri.rs` · `test_lisans_protokol_aynasi` | W0 | O |
| **L2b** | Sözleşme 5 — uçlar | satıcı belirteci `urun=backend-oci` · Worker yol öneki · backend `indirme-belirteci?urun=backend-oci` · `updater-ipc` Linux kökü · "eski istemci ne yapar" cevabı · **satıcı önce, Worker ilk Linux yayınından önce** | `test_indirme_kapisi` · satıcı testleri · `test_lisans_yoklama_allowlist` | L2a | O |
| **L3** ✓ | Linux paketi + yayıncı | teslim paketinin `backend-oci` biçimi (§1.3) · güncelleyicinin linux-x64 derlemesi CI'da (`korumali-paket.yml` ubuntu işi; Ubuntu 22.04 tabanı — eski glibc ileri uyumu; L4a sonrası `libssl-dev` + `libssl.so.3` bağı ölçülür) · `backend-yayinla.mjs --urun=backend-oci` (imzasız taban imajı RED) — **İNDİ 2026-10-09** (arşiv §2026-10-09 Güncelleyici L3; imaj kimliği = config özeti, açık noktalar orada) | `test_backend_yayin` · `test_docker_hijyeni` · `test_korumali_imaj` | L2a (G13 main'de, `02df43f46`) | B |
| **L4a** ✓ | Linux arka ucu I | `Fs` eksikleri (`statvfs`, yabancı yazar, `O_NOFOLLOW`) · `Procs` (süreç grubu, `PDEATHSIG`) · `Protect` · `Events` · TLS (`native-tls` Linux hedefi) · Linux `Layout` — **İNDİ 2026-10-09** (arşiv §2026-10-09 Güncelleyici L4a; Docker kökünün boş alanı L4b'ye kaldı) | `linux_fs_guvenilmez_okuma` · `linux_procs_agac_olur` | L1 | O |
| **L4b** ✓ | Linux arka ucu II | `DockerServices` · `Araclar` (yedek/göç/geri yükleme araç konteynerleriyle) · adım eşlemesi (§2.2) · Linux profilli sahte dünya; matrisin K1 satırları iki profilde — **İNDİ 2026-10-09** (arşiv §2026-10-09 Güncelleyici L4b; araç konteyneri adı `tekserp-arac-<proje>-<araç>` — plandan sapma, gerekçe orada; paket HAZIRLIĞI bu dilimde yoktu ⇒ L4c) | §9.3'ün PR satırları (L profili) | L4a + L5 (araç komutları) | B |
| **L4c** | Linux paket hazırlığı (§5 halka 2 platform kolu + 4–7; L4b'nin açık noktası — o güne dek Linux güncelleyici uçtan uca güncelleyemez, sahte dünyanın Linux profili zip hazırlığıyla yalnız ADIMLARI ölçer) | İki alt dilim. **L4c-1 (O) — paket:** motorun bildirim/işaretçi okuması arka ucun platformundan (`verify_release_manifest_on(.., linux-x64-oci)` + `backend-oci` ürün yolu; bugün çekirdek `WINDOWS_PLATFORM`la doğruluyor) · dış tar boy + sha256 = bildirim (`PAKET_OZETI`) → `surumler/.hazirlik-<v>/`e yalnız göreli DÜZ dosya, üye kümesi TAM (`oci-paket.ts` aynası; sembolik bağ · aygıt · `..` · fazla/eksik üye → `PAKET_YOL`) · `PAKET-DOCKER.json(.jws)` imzası (zincir öncelikli) + `butunluk-liste.txt` + her üyenin özeti + `check_package_binding` · Linux disk formülü (§5 madde 4: `/var/lib/tekserp` ve Docker kökü ayrı, `pg_database_size`) · sahte dünyanın Linux profili gerçek tar hazırlığıyla. Tar okuyucu: kilit dosyasında `tar` crate'i YOK — yerleşik ustar okuyucu (yalnız düz dosya; pax/GNU uzun ad başlığı RED) ya da kullanıcı onaylı yeni bağımlılık; karar dilimin başında. **L4c-2 (O) — imaj + compose:** imaj kimliği = config özeti ARŞİVDEN (`docker save` tar.gz içinden, `flate2` var; `.Id` KULLANILMAZ — L3 kararı) · `docker load -i` yalnız L4c-1 geçince, yüklenen etiketin `RootFS.Layers` = arşivdeki `rootfs.diff_ids`; tutmazsa `docker image rm` + `IMAJ_KIMLIGI`, yarım `load` artığı önce/sonra kimlik farkıyla silinir (başka projeye dokunmaz) · etiket `tekserp-korumali:<v>` · compose `config -q` + gömülü kural alt kümesi (`COMPOSE_HATASI`) · her `start`tan önce etiket → kimlik ölçümü (tutmazsa başlatılmaz → `GECIS_HATASI` → telafi) · yeni kodlar Rust + TS + rapor vektörü aynı commit'te · sahte `docker load`/`image inspect` + `image_tag_tampered` arızası | `imaj_bozuk` (gerçek `docker load`, Linux CI — `docker_gercek.rs`) · `imaj_etiketi_kaydi` · `linux_paket_yol_kacisi` · `linux_paket_uye_kumesi` · `compose_kurali_reddeder` · `sozlesme_vektorleri.rs` Linux bildirimi motor yolundan · `crash_restart` K1 satırları Linux profilinde tar + `load` hazırlığıyla · `test_guncelleme_protokol` (yeni kodlar) | L4b + L3 (L4c-2: L4c-1) | O + O |
| **L5** | İmaj / compose tarafı | `TEKSERP_GOC_ACILISTA` · `goc` aracı (`CONCURRENTLY` kuralı `entrypoint.sh`ten araca, tek yer) · compose şablonu kuralları (`pull_policy: never`, bağlar, kip değişkeni) · açılış çıkış kodları tablosu · `TEKSERP_GUNCELLEME_DIZINI` üretim cümlesi | `test_korumali_imaj` · compose denetimi yeni maddeler · `test_dogrulama_kipi` | — (`TEKSERP_GOC_ACILISTA` yoksa varsayılan BUGÜNKÜ davranış: açılışta göç; `0`ı yalnız güncelleyicili compose yazar. Şablonun paketteki yeri L3'te) | O |
| **L6** ✓ | systemd + Linux kendini güncelleme | `hizmet-kur`/`hizmet-kaldir` Linux · taban birim + ek dosya izin listesi · `sd_notify`/`WatchdogSec` · `.exe`siz A/B — **İNDİ 2026-10-09** (arşiv §2026-10-09 Güncelleyici L6; W1b onarım satırları taban birimde; tek adımlı `rename(2)` W1b'de) | `test_systemd_ek_izinli` · `self_update.rs` (L profili) | L4a, W1 | O |
| **L7** | Kurulum ve geçiş araçları | §8.1 (kur.mjs adım 6–7'nin alt komutu) · §8.2 `gecis` / `gecis --geri-al` · runbook bölümü | `test_guncelleyici_yikici_docker_yok` · kuru koşum sondaları | L3, L4b, L4c, L5, L6 | B |
| **L8** | PG küçük sürümü (KONTEYNER kipi) | `pg.env` yazarı · U3–U11'in Docker karşılığı · ICU yeniden dizinleme aynen | `pg_minor.rs` L profili | L4b | O |
| **T1** | Linux gerçek dumanı (K2) | `duman-linux.sh` (ubuntu-latest: systemd birimi, gerçek compose, test imajları, yerel CDN, kill/Docker yeniden başlatma/loop disk) · `native-linux.yml`e duman adımı | `native-linux.yml` duman adımı | T0, L4b, L4c, L5, L6 | O |
| **T2** | Yükseltme matrisi (K4) + yayın kapısı | sentetik sürüm zinciri aracı (iki platform) · `guncelleyici-gece.yml`de ubuntu-latest + windows-latest K4 adımı · kanıt dosyası (CI koşu bağlantıları) · `backend-yayinla.mjs` kanıt kapısı | `test_backend_yayin` yeni sondalar · `atlamali_yukseltme` | T0, W1, L4b, L4c (Linux kolu) | B |
| **T3** | Windows gerçek prova (thinkpad — gerçek güç kesintisi CI'da yapılamaz) | senaryo belgesi "GUC" (adım başına güç kesintisi + yeniden açılış) · betik · ilk kanıt satırları | senaryo (yeşil/kırmızı + kanıt) | W1–W3b | O |
| **T4** | Kaos / uzun koşu (K5) | `guncelleyici-gece.yml`de ubuntu-latest + windows-latest kaos adımı · değişmez ölçer aracı (`degismez-olc`: tek backend, `current` ↔ imaj ↔ göç, yetim/sır yok) | `kaos_uzun_kosu` (iki profil) | T1 (L) · W3b (W) | O |
| **F1a** | Filo — satıcı (AK-2: elle aşama) | sürüm × grup **aşama** alanı (şema + göç) · kova hesabı · kirada `etkin hedef = min(insan sabitlemesi, aşama tavanı)` (§6.2) · aşama ilerlet/geri çek uçları (gerekçeli, karar defteri satırı, zil) · aşama başına sonuç sayaçları · eşik **uyarısı** `GUNCELLEME_DALGA_UYARI` (durdurmaz) · otomatik ilerletme/durdurma YOK | satıcı servis testleri (tavan ↔ sabitleme minimumu, aşama 0 = durdur, eşikte uyarı ama tavan değişmez) · bildirim taraması · `guncelleme-karar.json` mevcut `HEDEF_ULASILDI`/`HEDEF_DISI` kayıtları aynen yeşil | — (güncelleyici ve sözleşme değişmez, TK-10) | O |
| **F1b** | Filo — portal | dalga/sürüm görünümü (aşama, kurulum başına sonuç, uyarı), insan sabitlemesi ↔ aşama tavanı ayrı, "sonraki aşamaya geç" / "geri çek" düğmeleri (gerekçe zorunlu; uyarı açıkken ya da sonuç < %80 iken ek onay) | portal testleri | F1a | O |
| **F1c** | Filo — ölçüler | Worker günlük istek sayımı (%50 uyarı) · eski biçim emeklilik ölçüsü yayın betiğinde (§4.5 madde 2) · `KURTARMA_SURUYOR` 1 sa uyarısı | satıcı testleri · `test_backend_yayin` emeklilik sondası | F1a, L2b, W3b | K |
| **P1a** | Deneme VDS — ilk kurulum + ilk otomatik güncelleme (hazırlık çapası) | `test` grubunda TEST sınıflı kurulum; t1 → t2 OTOMATİK pencereyle; zorla geri dönüş (düşen göç); kısa kaos (öldür, `systemctl restart docker`, sağlayıcı panelinden sert yeniden başlatma) | senaryo "VDS-GUNCELLEME" | L7, T1 (ikisi de L4c'ye bağlı — L4c olmadan Linux paketi hazırlanamaz) (AK-4 kapandı: ders kurulumunun yanına, §9.1 K6) | O |
| **P1b** | Deneme VDS — üretim çapası | üretim ikilisi + `pkt-*` sertifikalı imzalı gerçek Linux paketi; P1a senaryosunun tekrarı | aynı senaryo | **D8 töreni**, P1a | K |
| **P2** | Windows filosuna ilk yayın | W1–W5'li güncelleyiciyi taşıyan ilk backend sürümü (hazırlık → terfi) | yayın kapısı (§9.5) | T2, T3 | K |

**Paralellik — dalgalar (2026-10-08 kararlarından sonra):** bir dalgadaki dilimler birbirinin dosyalarına dokunmaz; dalga, bağımlılıkları inmiş dilimlerden oluşur.

| Dalga | Dilim (bağımlı) | Dokunduğu ana dosyalar | Boy |
|---|---|---|---|
| **1** | **W0** (—) | `docs/design/GUNCELLEYICI.md` (yeni dondurma bölümü) · `native/test-vektorleri/guncelleyici-{gunluk,ayar,niyet}/` · `tekserp-guncelleyici/src/journal.rs` (ISLEM `v` + `platform`) · `tests/common` (`senaryo(profil)` iskeleti) | O |
| 1 | **T0** (—) | yalnız `.github/workflows/{native-linux,guncelleyici-gece}.yml` | K |
| 1 | **F1a** (—) | `satici/sunucu/` (`update-policy.service.ts`, kira basımı, şema + göç, bildirim) | O |
| 1 | **L5** (—) | `Teks-Erp/docker/entrypoint.sh` · `Teks-Erp/docker/korumali/` (compose şablonu, `goc` aracı) · docker bekçileri | O |
| **2** | **L1** (W0) | `tekserp-guncelleyici/src/{env,health,operation,tools,pgminor,main}.rs` → `src/platform/` | O |
| 2 | **L2a** (W0) | `src/lib/license/protocol/` + satıcı aynası `satici/sunucu/src/lisans-protokol/` · `tekserp-guncelleyici/src/{release,decision,codes}.rs` · `test-vektorleri/guncelleme-*.json` | O |
| 2 | **F1b** (F1a) | `satici/web/` | O |
| **3** | **W1** (L1) | `engine.rs` · `selfupdate.rs` · `tests/` | O |
| 3 | **L4a** (L1) | yalnız `src/platform/linux/` | O |
| 3 | **L2b** (L2a) | satıcı belirteç ucu · `deploy/guncelleme-sunucusu/worker/` · backend `indirme-belirteci` · `updater-ipc` | O |
| 3 | **L3** (L2a; G13 main'de) | `deploy/backend-yayinla.mjs` · `.github/workflows/korumali-paket.yml` · teslim paketi betikleri | B |
| 3 | **W4** (L1) | yeni `src/tani.rs` + `main.rs`te tek alt komut satırı | K |

Sonrası sıralı hatlar: **W hattı** (`engine.rs`/`operation.rs` ortak — kendi içinde SIRALI) W1 → W1b → W2 → W3a → W3b → W5 · **L hattı** L4a → L6 (L4a + W1) · L4b (L4a + L5) → L4c (L4b + L3; L4c-1 → L4c-2) · L4b → L8 · L7 (L3 · L4b · L4c · L5 · L6) · **T** T1 (T0 · L4b · L4c · L5 · L6) → T4 (Linux kolu; Windows kolu W3b sonrası) · T2 (T0 · W1 · L4b · L4c) · T3 (W1–W3b) · **F** F1c (F1a · L2b · W3b) · **P** P1a (L7 · T1) → P1b (D8 töreni) · P2 (T2 · T3).

- Neden dalga 1 güvenli: W0 native çekirdeğe ve sözleşme belgesine, T0 yalnız iş akışlarına, F1a yalnız satıcı sunucusuna, L5 yalnız Docker imaj tarafına dokunur — ortak dosya yok. F1a'nın W0/L2a'ya bağı yoktur, çünkü dalga var olan `hedefSurum` alanıyla çalışır (TK-10); L5'in L2a'ya bağı yoktur, çünkü `TEKSERP_GOC_ACILISTA` yokken bugünkü davranış sürer.
- Dalga 2'de L1 ile L2a aynı crate'e girer ama ayrık modüllere: L1 platforma sızmış modülleri taşır, L2a karar/sürüm modüllerine ve vektörlere ekler; L2a `env.rs`/`main.rs`e DOKUNMAZ (dokunması gerekirse L1'den sonra sıralanır).
- L1 bir **saf yeniden düzenlemedir** ve W1'den önce iner; böylece W-dilimleri yeni düzende yazılır, Linux hattı onlardan sonra birleştirme acısı çekmez.

**Kullanıcı onayı / tören noktaları:**

1. Plan ve §11.2 kararları — **kapandı 2026-10-08** (AK-0…AK-5).
2. **L2b inişi = sözleşme kıran olmayan ama satıcı-önce sıralı yayın:** üretim satıcısı + Worker güncellemesi kullanıcının yayın onayıyla (surum-yayin reçetesi).
3. **P1a:** deneme VDS'e kurulum — AK-4 gereği ders kurulumunun yanına; sunucuya bağlanan dilim budur (bu plan sunucuya dokunmadı).
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
| TK-11 | Mac'te Linux VM kurulmaz; otomatik testler GitHub Actions ubuntu-latest + windows-latest'te (AK-5), thinkpad yalnız gerçek derleme/prova | yeni araç yok; systemd + Docker + gerçek SCM hazır; repo açık, dakika ücretsiz | §9.1 |
| TK-12 | Linux PG küçük sürümü ilk sürümde kapalı, ayrı dilim (L8) | ilk provayı küçültür; ana sürüm zaten runbook | §1.1 |
| TK-13 | Dalga aşamaları yalnız elle; otomatik ilerletme/durdurma kodu yazılmaz (kapalı bayrakla da doğmaz) | AK-2; kapalı bayrak = koşmayan ama bakımı süren yol; ölçü (sonuç sayaçları) yine yazılır, istenirse yalnız karar katmanı eklenir | §6.2 |

### 11.2 Kullanıcı kararları (2026-10-08 — kapandı)

| # | Soru (sade dille) | Karar | Plana etkisi |
|---|---|---|---|
| AK-0 | Windows'ta güncelleme programı ayrı bir kurulum mu olsun? | **Hayır** — tek setup, güncelleyici kendini yeniler | §4.4; W1 (önce güncelleyici + son bilinen iyi) |
| AK-1 | Linux kurulumu fabrikanın kendi sunucusuna da mı, yalnız bizim bulutumuza mı? | **Şimdilik yalnız bulut** (bizim yönettiğimiz VDS); fabrika Linux'u kapsam dışı, kapı açık | §8.3; güncelleyicide "bulut mu" dalı yazılmaz |
| AK-2 | Yeni sürüm gruptaki fabrikalara sırayla mı gitsin, nasıl ilerlesin? | **Kademeli, aşamaları kullanıcı portaldan ELLE ilerletir**; otomatik durdurma istenmedi | §6.2; F1a/F1b yeniden kapsamlandı, F1c ayrıldı; TK-13; başarısızlık uyarısı kalır, durdurmaz; acil durdurma = aşamayı geri çekmek + K1 (var) |
| AK-3 | Güncellemesi dondurulmuş fabrikada güncelleme programı kendini yenileyebilsin mi? | **Evet**; lisans yaptırımı (K1) varsa hiçbir şey yenilenmez | §4.2 madde 1; W1 bekçileri |
| AK-4 | Deneme sunucusundaki prova nasıl yapılsın? (1e kararı) | **Ders kurulumunun yanına**, ayrı dizin/proje adı/veritabanı/port | §9.1 K6; P1a |
| AK-5 | Testler nerede koşsun? | **GitHub Actions — ubuntu-latest VE windows-latest** (repo açık, ücretsiz), kullanıcı "yerele al" diyene dek; thinkpad yalnız gerçek derleme/prova | §9.1 "CI yeri"; T0 (yeni) · T1 · T2 · T4 |

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
| R7 | Kendini güncelleme yolunun kendisinde hata | A/B'yi de bozabilir | yol dondurulur (§4.5 madde 4), üç halkalı zincir kanıtı yayın kapısında, `.lkg`; dışarıdan bozulan ikiliyi karşılıklı onarım W1b (§4.7) insansız geri koyar (tavanlı, görünür); insan yalnız hizmet kaydı silinmiş/devre dışıysa (bilinçli) ya da hiçbir doğrulanmış kaynak kalmamışsa (`ONARIM_KAYNAK_YOK`, panel + satıcı): Windows setup "onar" / panel "Onar", Linux `hizmet-kur` yeniden koşumu (SSH) |
| R8 | Saat sapması | kira ve pencere zamana bağlı | chrony/w32time; kira +10 dk toleransı; `clock_jump` arıza senaryosu |
| R9 | Büyük veritabanında geri yükleme süresi | DB büyüdükçe telafi uzar | yedek/geri yükleme zaman aşımları DB boyutundan türetilir (ölçülür, sabit değil); disk ön kontrolü DB boyutunu sayar |
| R10 | Veri birimi kaybı (Linux `pg_data` = lisans F5) | yanlış komut geri dönüşsüzdür | güncelleyici birimlere hiçbir yoldan dokunmaz; yıkıcı Docker komutu bekçisi (§8.2) |
| R11 | CDN/Worker kesintisi ya da kota | dış hizmet | güncelleme yalnız gecikir (fail-closed), fabrika etkilenmez; sorgu sıklığı düşürülür (W5); kota sayımı (F1a) |
| R12 | Windows'ta güvenlik yazılımının dosya kilitlemesi | üçüncü taraf | `DOSYA_KILITLI` bekler, ertelemesiz sürer (bugün var); thinkpad provasında Defender açık koşulur |
| R13 | İki yeniden adlandırma arasında ölüm (W1 ölçümü) | `çalışan → .eski` ile `.yeni → asıl ad` ayrı adımlar; arada ölümde asıl ad boş, hizmet açılamaz — açılış kodu çalışamadığı için kendini onaramaz (§4.6 düzeltildi) | **KAPANDI 2026-10-09 (W1b, §4.7):** Windows'ta dosya hiç yer değiştirmez (sürümlü ImagePath W-A, tek kayıt yazımı), Linux'ta `.eski` kopya + tek atomik `rename(2)` (L-A); dışarıdan bozulan ikiliyi `onar` geri koyar (görev W-C / taban birim satırı L-B). Kanıt: `asil_ad_bosluk_onarilir` · `kendi_guncelleme_her_adimda_oldur` + CI dumanları |
| R14 | `.lkg`ye dönülen ESKİ ikili "reddedilen sürüm" kuralını bilmez (W1 ölçümü) | `reddedilenSurum`u yalnız W1'li ikili okur; W1 öncesi ikiliye dönülürse o, sonraki BASARILI işlemde aynı sürümü bir kez daha yerleştirir (döngü tur başına değil işlem başına) | **açık borç, yapısal geçiş**: eski ikilinin bilmediği kural ona öğretilemez; ilk W1'li sürüm (P2) sahaya çıkıp bir işlemi kanıtlayınca `.lkg` W1'li olur ve borç kendiliğinden kapanır. O zamana dek sınırı: işlem başına bir yeniden yerleştirme (P2'nin göçsüz küçük sürüm kuralı, §10 onay noktası 5) |
| R15 | `DONDUR`da kendini yenileme yalnız imzalı bildirimde `guncelleyici` bloğu varsa olur; yayıncı bu bloğu YAZMIYOR (ölçüldü 2026-10-09: `Teks-Erp/scripts/backend-bildirim.ts` `bildirimKur` yükü `guncelleyici`siz kurar, `yeniden-imzala` eski yükü kopyalar, `deploy/backend-yayinla.mjs` alanı hiç anmaz) | bugün `DONDUR`daki fabrikada ikili HİÇ yenilenmez (fail-closed: blok yoksa paket indirilmez); "önce güncelleyici" (madde 1) bloktan bağımsız, paket içeriğiyle çalışır | **KAPANDI 2026-10-09 (R15 dilimi; arşiv §2026-10-09 Güncelleyici R15):** yayıncı iki platformda bloğu paketteki ikiliden ÖLÇEREK yazar (tek kaynak `Teks-Erp/scripts/lib/guncelleyici-blok.ts`; Windows `runtime/tekserp-guncelleyici.exe` + `PAKET.json` `hizmetIkilileri`), ikilisiz Windows paketi imzalanmaz, `deploy/backend-yayinla.mjs` bloksuz bildirimde DURUR; `yeniden-imzala` bloğu yeniden ölçer (varsa aynı olmalı, yoksa ekler). Şema isteğe bağlı kaldı (sahadaki bloksuz bildirimler geçerli). Bekçiler `test_backend_yayin` §3U · `test_lisans_paket_anahtari` §8w · `self_update.rs` `dondur_yayinci_blogu` (vektör `guncelleme-yayinci.json`). Kalan: Rust bloğun `sha256`ını bugün kıyaslamıyor (yalnız `surum`; aday ikili imzalı listeyle zaten ölçülür) — W1b alanında |

**Dürüst sonuç:** "Bir kere yap, hep çalışsın" güncelleyicinin **çekirdeği** için ulaşılabilir ve bu plan onu ölçüyle bağlar. Dış dünyaya bağlı yüzeyler (Docker, işletim sistemi, TLS kütüphanesi, anahtar dönemi, PG ana sürüm) zamanla değişecektir; onlar için hedef "hiç değişmesin" değil, **değiştiğinde güncelleyici güvenli tarafta beklesin, fabrika çalışmaya devam etsin ve düzeltme insan eli değmeden ulaşsın**tır. Bunu mümkün kılan iki parça W1 (önce güncelleyici + son bilinen iyi) ve §4.5'tir; ikisi olmadan her dış değişiklik fabrika başına elle müdahale demektir.
