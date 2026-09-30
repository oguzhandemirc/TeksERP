# Kendi PostgreSQL örneği — ilk kurulum · küçük sürüm güncellemesi · harici kip

> **Durum:** şartname (Dağıtım v2 · D4 dilimi, 2026-09-30). Uygulayanlar: **D5** ilk kurulum (setup.exe, §4) · **D2** küçük sürüm güncellemesi (Rust güncelleyici, §5) · **D6** harici kip ve kendi örneğe taşıma (§7). Büyük sürüm geçişi otomatik DEĞİLDİR: [`docs/ops/PG-BUYUK-SURUM-GECISI.md`](../ops/PG-BUYUK-SURUM-GECISI.md).
>
> **Tek kaynaklar (değer burada tekrarlanmaz, oradan okunur):** ikili sürüm/adres/özet `deploy/pg/pg-surumu.json` · hizmet/dizin/port/initdb/roller/bellek formülü `deploy/pg/pg-ornegi.json` · şablonlar `deploy/pg/postgresql.tekserp.conf.sablon` + `deploy/pg/pg_hba.conf.sablon` · diller arası altın vektörler `deploy/pg/pg-sablon-vektorleri.json`. Motor `deploy/pg/lib/pg-ornegi.mjs`; araçlar `deploy/pg/pg-ikili-dogrula.mjs` (indir/doğrula/sahne) ve `deploy/pg/pg-sablon.mjs` (üret/denetle). Bekçi `scripts/test_pg_ornegi.mjs` (CI doküman işi); ikinci ağdan indirme doğrulaması `.github/workflows/pg-ikili.yml`.
>
> **Kullanıcı kararı (2026-09-30 ~22:40):** makinede başka PostgreSQL olsa bile TeksERP kendi sabit sürümlü, AYRI PostgreSQL örneğini kurar.

## 0. Kararlar — tek bakışta

| Konu | Karar | Neden (ölçüm §1) |
|---|---|---|
| Sürüm | PostgreSQL **16** çizgisinin en güncel küçük sürümü, EDB'nin bugün yönlendirdiği derleme (bugün 16.15, derleme 4 — kayıtta) | Saha 16.9, geliştirme/test 16.15, CI `postgres:16`, patron/satıcı `postgres:16-alpine` — ana sürüm her yerde 16; 16'nın destek sonu 2028-11-09 |
| İkili | EDB **taşınabilir zip** (kurucu değil) | Kurucu SSH/masaüstsüz oturumda exit 1 verdi (runbook §2.1b); zip sessiz, dizin seçilebilir, yan yana açılabilir |
| Güven | Zip **imzasız** → sabitlenmiş boyut + SHA256 (iki ağdan ölçülür) + içerik denetimi + sahaya **bizim PAKET imzamızla** | §1: 13 zorunlu ikilinin hiçbirinde Authenticode yok |
| Collation | `initdb --encoding=UTF8 --locale=C --locale-provider=libc` | Sahadaki tek üretim DB'si C (döküm başlığı); katlama `COLLATE "C"`ye pinli, Türkçe sıralama kolon düzeyi ICU `tr_sort`; C varsayılanı index'leri libc/ICU sürümünden bağımsız tutar |
| ICU | ZORUNLU (derlemede var olmalı) | `tr_sort` = ICU `tr-u-kn`; ICU yoksa migration'ın libc yedeği Unix adı `tr_TR.UTF-8`'dir, o da yoksa Türkçe sıralama SESSİZCE atlanır (yalnız NOTICE) |
| Sayfa sağlaması | `--data-checksums` AÇIK | Sessiz disk bozulmasını okumada yakalar; PG 18'in varsayılanı; `pg_upgrade` iki kümede aynı ayarı ister |
| Kimlik doğrulama | Yalnız `scram-sha-256`; `pg_hba` tek satır `host all all 127.0.0.1/32 scram-sha-256` | trust/md5/ağ erişimi/replication yok |
| Dinleme | `listen_addresses='127.0.0.1'`, Unix soketi yok, `ssl=off` | Backend aynı makinede; PG için güvenlik duvarı kuralı açılmaz |
| Saat dilimi | Sunucu `timezone='UTC'`, `log_timezone='UTC'` | Fabrika dilimi bir PROFİL defteridir (`factory_timezone_periods`), veritabanı sunucusuna yazılmaz; backend oturumları zaten UTC (`PG_SESSION_OPTIONS`); göç (Prisma şema motoru) sunucu varsayılanıyla koşar → UTC, CI/geliştirme ile aynı |
| Hizmet | `TeksERP-PostgreSQL`, sanal hesap `NT SERVICE\TeksERP-PostgreSQL`, açılışta, çökünce yeniden başlar | Yönetici değil, ağ kimliği yok, parolasız; yalnız kendi dizinine yazar |
| Dizinler | İkili `C:\TeksERP\pgsql\<surum>-<derleme>\` · veri `C:\TeksERP\pgveri\` (başka sabit NTFS sürücü seçenek) · `C:\TeksERP\pgsql\bin` JUNCTION → etkin sürümün `bin`'i | Yan yana sürüm = geri dönüş; `PG_BIN_DIR`/`yedekle.ps1`/`bakim-rolu.ps1` bu yolu okur — sözleşme korunur |
| Port | 5432'den başla, meşgulse ilk boş (≤ 5499); kayıtlı port korunur; açıkça istenen port meşgulse DUR | Makinedeki başka PG'ye dokunulmaz, sessiz sapma yok |
| Roller | `postgres` (süper; parolası DPAPI dosyasında) · `tekserp` (uygulama, süper değil, DB sahibi) · `tekserp_bakim` (`bakim-rolu.ps1` ile birebir) | Süper kullanıcı parolası `.env`'e girmez |
| Küçük sürüm | Otomatik (güncelleyici, politika penceresinde): yan yana aç → durdur → hizmet yolunu değiştir → başlat → doğrula → sorunda eski yola dön | Veri dizini dokunulmaz; geri dönüş saniyeler |
| Büyük sürüm | OTOMATİK DEĞİL — runbook, kullanıcı penceresi | Katalog biçimi değişir; döküm/geri yükleme ya da `pg_upgrade` insan kararı |
| Harici kip | Bugünkü kurulumların PG'sine güncelleyici DOKUNMAZ; kendi örneğe taşıma isteğe bağlı, ayrı pencere | SAHINSRV ve thinkpad-1'in `postgresql-tekserp` hizmetleri |

## 1. Ölçümler (2026-09-30)

- **Resmî sürüm:** `https://www.postgresql.org/versions.json` → 16 çizgisi `latestMinor` 15, `relDate` 2026-08-13, `eolDate` 2028-11-09 (17.11 · 18.6 aynı gün).
- **EDB kaynağı:** `https://www.enterprisedb.com/download-postgresql-binaries` "Binaries from installer Version 16.15" Windows x86-64 bağlantısı `sbp.enterprisedb.com/getfile.jsp?fileid=1260572` → `get.enterprisedb.com/postgresql/postgresql-16.15-4-windows-x64-binaries.zip` (HTTP 302). Aynı sürümün dört derlemesi var: -1 (13 Ağu, 332 MB) · -2 (31 Ağu) · -3 (1 Eyl) · **-4 (18 Eyl, 371.449.528 bayt)**; -5 yok (403). S3/CloudFront, ETag çok parçalı (MD5 değil — bağımsız doğrulama vermez).
- **İndirme ve özet:** iki ayrı indirme (23:02 ve 23:20) aynı SHA256'yı verdi; değer `pg-surumu.json`'da. Üçüncü ağ: CI (`pg-ikili.yml`).
- **İmza:** PE sertifika dizini (Authenticode) `postgres.exe` · `pg_ctl.exe` · `initdb.exe` · `psql.exe` · `pg_dump.exe` · `pg_restore.exe` · `pg_upgrade.exe` · `libpq.dll` · `icuuc67.dll` · `libssl-3-x64.dll` · `lib/pg_trgm.dll`'de YOK; yalnız `stackbuilder.exe` "EnterpriseDB Corporation" imzalı. (Runbook §2.1b'nin 16.9 için ölçtüğü "zip ikilileri imzasız" 16.15-4'te de doğru.)
- **Gömülü sürüm dizgesi:** `postgres.exe` "PostgreSQL 16.15, compiled by Visual C++ build 1944, 64-bit"; `pg_ctl`/`initdb`/`pg_dump` "(PostgreSQL) 16.15" — doğrulayıcı dosya adına değil bu dizgeye bakar.
- **ICU:** 16.9-1, 16.15-1 ve 16.15-4 zip'lerinin hepsinde `bin/icu*67.dll` (merkezî dizin HTTP Range ile okundu). OpenSSL 3 (`libssl-3-x64.dll`).
- **Zip yapısı:** 21.727 girdi, açık 966 MB; `pgAdmin 4` 807 MB · `bin` 77 MB · `lib` 26,8 MB · `share` 24,3 MB · `doc` 16,6 MB · `include` 13 MB · `StackBuilder`. **Sahne** (sahaya giden alt küme: `bin` + `lib` + `share` + iki lisans, eksi StackBuilder GUI + 8 wx DLL + regresyon araçları + `.lib`): **1.593 dosya, 92,5 MB**; manifesto Node ve bağımsız Python uygulamasında bayt-eşit, `shasum -c` ile doğrulanabilir.
- **Uzantı:** `pg_trgm` (1.6) var ve `trusted = true` — süper olmayan DB sahibi kurar. Migration'ların kurduğu tek uzantı `pg_trgm` (369 migration tarandı).
- **Collation — saha:** fabrikanın 23 Eylül gece yedeğinin (custom döküm) başlığı "Dumped from database version: 16.9", `CREATE DATABASE <canlı DB> WITH TEMPLATE = template0 ENCODING = 'UTF8' LOCALE_PROVIDER = libc LOCALE = 'C'` (yalnız arşiv başlığı ve şema okundu, DB'ye bağlanılmadı). Aynı şemada `CREATE COLLATION public.tr_sort (provider = icu, locale = 'tr-u-kn')` ve `CREATE EXTENSION pg_trgm` — sahadaki EDB 16.9 derlemesi ICU'yu taşıyor.
- **Collation — geliştirme/test:** yerel sunucu Docker `postgres:16-alpine` 16.15: 166 DB'nin tamamı `en_US.utf8` libc, sunucu `TimeZone` UTC, 908 ICU collation. (Bilinen ayrışma — ARAMA-KATLAMA tasarımı katlamayı `COLLATE "C"`ye pinleyerek etkisizleştirdi.)
- **ICU'ya bağlı index'ler (katalogdan, salt okuma):** `permission_templates_name_key` · `permission_templates_name_lower_uq` · `label_templates_name_key` · `colors_nameFoldColor_key` — ICU sürümü değişirse bunlar yeniden kurulur (§5 U9; liste katalogdan türetilir, sabit yazılmaz).
- **Bellek formülü:** motor (tamsayı yüzde) ile `ilk-kurulum.ps1`'in `MbDeger` + runbook §6 formülü `pwsh`'ta 9 RAM değerinde birebir.
- **Ölçek:** 2026-09-11'de 5,3 MB döküm → 54 MB DB (arşiv); 23 Eylül dökümü 8,2 MB → ~85 MB DB tahmini (ölçülmedi).

## 2. Sürümü sabitleme ve yükseltme reçetesi

`pg-surumu.json` alanları: `surum` (X.Y) · `cizgi` (ana sürüm; değişimi otomatik değil) · `derleme` (EDB -N) · `yayinTarihi` · `destekSonu` · `yayin.win-x64` {`dosya`, `url` (yalnız `https://get.enterprisedb.com/postgresql/`), `boyut`, `sha256`, `arsivKok`, `icuSurum`, `imza` ("yok" | "authenticode" — ölçülür), `olcum`} · `sahne` {`dahil`, `haric`, `dosyaSayisi`, `boyut`, `icerikSha256`} · `zorunlu` {`ikililer`, `uzantilar`, `icu`} · `guncellemeSonrasi` (PG sürüm notunun istediği ek adımlar; boş dizi = yok).

**Yükseltme (küçük sürüm ya da yeni EDB derlemesi) — bir KARARDIR:**
1. `node scripts/test_pg_ornegi.mjs --ag` yeni küçük sürüm / yeni derleme olduğunu söyler (kırmızı değil, bildirim).
2. Aradaki her küçük sürümün PostgreSQL sürüm notu okunur; "güncellemeden sonra şunu koşun" diyen madde varsa `guncellemeSonrasi`'na yazılır (`{tur: "sql" | "reindex-icu", gerekce, …}`) — güncelleyici §5 U9'da uygular.
3. `node deploy/pg/pg-ikili-dogrula.mjs --olc --surum X.Y --derleme N` indirir, ölçer, kayda yapıştırılacak blokları basar; kayıt elle ve gözden geçirilerek güncellenir.
4. `node scripts/test_pg_ornegi.mjs` + `--sonda` yeşil; `node deploy/pg/pg-ikili-dogrula.mjs --indir` yeşil.
5. İtilince `pg-ikili.yml` GitHub'ın ağından yeniden indirir — aynı özet çıkmadan paketleme yok.
6. Windows duman işi (§9) yeşil; paket D1 hattından terfi kapısıyla kanallara.

## 3. Güven zinciri (imza / doğrulama yolu)

1. **Resmî kaynak:** EDB'nin indirme sayfasının yönlendirdiği `get.enterprisedb.com` (HTTPS). Başka adres kayıtta duramaz (bekçi §1).
2. **Sabitleme:** boyut + SHA256 kayıtta; sabitleyen makine ve CI iki ayrı ağdan aynı özeti ölçer (tek ağdan ölçülen özet o ağdaki araya girmeyi göremez).
3. **İçerik denetimi** (`pg-ikili-dogrula.mjs`): zorunlu ikililer var · her `.exe` "(PostgreSQL) <surum>" taşır · tek ICU sürümü = kayıt · `pg_trgm` dosyaları var · imza durumu kayıttakiyle aynı (EDB imzalamaya başlarsa kayıt güncellenir, sessiz geçmez) · sahne manifestosu kayıttaki özete eşit.
4. **İmzalı kökenle çapraz doğrulama (Windows işi, ölçülecek):** EDB'nin Authenticode imzalı kurucusu (`postgresql-<surum>-<derleme>-windows-x64.exe`, imzalayan EnterpriseDB) yalnız-çıkar kipinde açılır ve sunucu ikililerinin özetleri zip'inkilerle karşılaştırılır. Eşitse zip ikilileri EDB'nin kod imzasına bağlanır.
5. **Sahaya giden:** sahne (1.593 dosya + `TEKSERP-ICERIK.sha256`) bizim paketimiz olarak D1'in imza zarfıyla (PAKET anahtarı, Mac'te; anahtar CI'a girmez) yayınlanır. Setup/güncelleyici imzayı doğrular, açtıktan sonra her dosyayı manifestoya karşı ölçer, ancak ondan sonra kullanır. **Saha EDB'den doğrudan indirmez** — fabrikadan dışarı giden istek yalnız imzalı kanallardandır.

## 4. İlk kurulum (D5 uygular)

Sıra bağlayıcıdır; her adım ölçerek ilerler, ölçülemeyen adım DURUR (tahminle devam yok). Değerler `pg-ornegi.json`'dan okunur.

1. **Ön koşul:** Windows 10/11 ya da Server 2016+ x64, yönetici; RAM ≥ 2 GB (altında uyarı); hedef sürücüde ikili için ~100 MB + veri için yer.
2. **Veri dizini:** varsayılan `<kök>\pgveri` (`C:\TeksERP\pgveri`). Sihirbaz sabit yerel NTFS birimleri (DriveType 3) boş alanlarıyla listeler, `<X>:\TeksERP\pgveri` önerir; C:'de < 20 GB boşken başka birim daha genişse onu ön seçer (öneri, eşik ölçülmedi). Sessiz kip: cevap dosyası anahtarı. **Kurallar:** Program Files / `%TEMP%` / `<kök>\app` / `<kök>\pgsql` / `<kök>\backups` altında olamaz · ağ/çıkarılabilir sürücü olamaz · yol ASCII · dizin YOK ya da BOŞ olmalı — dolu dizinde initdb ASLA koşmaz, kurulum durur (veri silinmez).
3. **İkililer:** paket imzası + manifesto doğrulanır; `<kök>\pgsql\<surum>-<derleme>\` altına DOĞRUDAN açılır (`%TEMP%`'ten taşınan dosya TEMP'in "yalnız bu kullanıcı" iznini taşır — taşındıysa `icacls <dizin> /reset /T /Q`); her dosya `TEKSERP-ICERIK.sha256`'ya karşı ölçülür. İzin: SYSTEM + Administrators tam, hizmet hesabı ve Users yalnız okuma/çalıştırma — hizmet hesabı ikiliye YAZAMAZ.
4. **İstemci bağlantısı:** `<kök>\pgsql\bin` → `<surum>-<derleme>\bin` JUNCTION (`mklink /J`). Junction `Remove-Item -Recurse` ile silinmez (hedefi boşaltır) — `rmdir <yol>` ya da `[IO.Directory]::Delete(<yol>)`.
5. **Port:** meşgul kümesi üç kaynaktan: ① `Get-NetTCPConnection -State Listen -LocalPort <p>` (herhangi bir adreste dinleyen) ② `127.0.0.1:<p>`'ye bağlanma denemesi (Windows'un ayrılmış port aralıklarını da yakalar — `netsh int ipv4 show excludedportrange protocol=tcp`) ③ makinedeki her PostgreSQL hizmeti — `ImagePath`'i `pg_ctl … runservice` olan hizmetlerin `-D` dizininden `postgresql.auto.conf` > `postgresql.conf` `port` (yoksa 5432; okunamazsa 5432 meşgul sayılır) — durmuş hizmet de portu TUTAR. Seçim `portSec` kuralı (motor + vektörler): kayıtlı port → o; açık istenen meşgul → DUR; yoksa 5432…5499'da ilk boş.
6. **Parolalar:** `postgres`, `tekserp`, `tekserp_bakim` için 32 karakter, `parola.alfabe`'den reddetmeli örnekleme (modülo yanlılığı yok — `bakim-rolu.ps1 YeniParola` ile aynı). Hiçbiri argv'ye, günlüğe, audit'e, sürüm notuna girmez.
7. **initdb:** `postgres` parolası `<kök>\pg-setup\` altında ÖNCE ACL'lenmiş (SYSTEM + Administrators) geçici dosyaya yazılır → `<bin>\initdb.exe -D <veri> <initdb.argumanlar…> --pwfile=<dosya>` → dosya sonuç ne olursa olsun hemen silinir. initdb yönetici hesabında kısıtlı token'la kendini yeniden başlatır (runbook §2.1b tuzak 3). Çıkış 0 ve `<veri>\PG_VERSION` = `cizgi` olmalı.
8. **Yapılandırma:** RAM = `Win32_ComputerSystem.TotalPhysicalMemory` MB'a aşağı yuvarlanır; şablonlar doldurulur (`pg-sablon.mjs` ya da aynı vektörleri geçen yerel uygulama) → `<veri>\tekserp.conf` ve `<veri>\pg_hba.conf` (initdb'ninkinin yerine) UTF-8, BOM'suz, LF; `<veri>\postgresql.conf` sonuna `includeSatiri` BİR KEZ eklenir. Yazılan dosyalar aynı yasaklarla denetlenir (`pg-sablon.mjs --denetle`). `postgresql.auto.conf`'a yazılmaz.
9. **Hizmet kaydı (veri dizini ACL'inden ÖNCE — sanal hesabın SID'i hizmet doğunca var olur):** `<bin>\pg_ctl.exe register -N TeksERP-PostgreSQL -U "NT SERVICE\TeksERP-PostgreSQL" -D "<veri>" -S auto -w -t 120` (`-P` YOK: sanal hesap parolasızdır — Windows'ta ölçülecek, §9 W7) → `sc.exe config TeksERP-PostgreSQL DisplayName= "TeksERP PostgreSQL"` → `sc.exe failure TeksERP-PostgreSQL reset= 86400 actions= restart/60000/restart/60000/restart/300000`. `ImagePath` geri okunur: sürüm dizinini ve `-D "<veri>"`'yi taşımalı.
10. **Veri dizini izni:** `icacls <veri> /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "NT SERVICE\TeksERP-PostgreSQL:(OI)(CI)F" /T` — Users / Authenticated Users / Everyone YOK; `Get-Acl` ile ölçülür (ölçülemedi ≠ temiz). Veri dizini fabrikanın bütün verisidir: sır sınıfı.
11. **Başlat ve doğrula:** `Start-Service TeksERP-PostgreSQL` → `pg_isready -h 127.0.0.1 -p <port>` → `postgres` ile (parola çağrı başına ortamdan, SQL STDIN'den): `server_version` = kayıt · `listen_addresses` = 127.0.0.1 · `password_encryption` = scram-sha-256 · `TimeZone` = UTC · `data_checksums` = on · `template1` `datcollate`/`datctype` = C · `pg_collation`'da ICU var · `pg_settings.sourcefile` bu ayarlar için `tekserp.conf`. Negatif: parolasız bağlantı reddedilir.
12. **Roller ve DB** (`ilk-kurulum.ps1` + `bakim-rolu.ps1` anlamıyla aynı): parola SCRAM doğrulayıcısı olarak istemcide hesaplanır, psql'e STDIN'den, `SET log_statement = 'none'` ile. `CREATE ROLE tekserp WITH <roller.uygulama.ozellik> PASSWORD '<scram>'` → `CREATE DATABASE tekserp OWNER tekserp TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LOCALE 'C'` (açık yazılır, template1'e güvenilmez) → DB düzeyi üç ayar (`teks.*` süper kullanıcıyla) → bakım rolü (`CREATEDB NOSUPERUSER…`, `GRANT tekserp`, `GRANT pg_read_all_settings`, `GRANT SET ON PARAMETER teks.audit_guard`) ve `bakim-rolu.ps1` §5'teki yeni-kimlikle ölçüm. `pg_trgm`'i göç kurar (güvenilir uzantı; DB sahibi yeterli).
13. **Sırlar:** `app\.env` → `DATABASE_URL="postgresql://tekserp:<url-kodlu>@127.0.0.1:<port>/tekserp?schema=public"` (**`localhost` değil** — IPv6 çözülüp reddedilmesin) · `BACKUP_PG_USER/PASSWORD` = bakım rolü · `PG_BIN_DIR=<kök>/pgsql/bin` (hizmet ortamı D3). `postgres` parolası `.env`'e GİRMEZ: DPAPI LocalMachine (+ sabit uygulama entropisi) ile şifrelenip `<kök>\pg-setup\pg-yonetici.dpapi`'ye yazılır, dosya SYSTEM + Administrators; gösterme yalnız yerel yönetici konsolundan, ekrana (panele/buluta/günlüğe asla).
14. **Örnek kaydı:** `<kök>\pgsql\ornek.json` (§6); yazma SYSTEM + Administrators.
15. **Güvenlik duvarı:** PostgreSQL için GELEN kural AÇILMAZ.
16. **Antivirüs (öneri, ölçülmedi):** Defender dışlaması YALNIZ veri dizinine (`Add-MpPreference -ExclusionPath <veri>`) — gerçek zamanlı tarama WAL/checkpoint dosya adlandırmasını kilitleyebilir (PostgreSQL Windows wiki); ikililer dışlanmaz. Sihirbazda seçenek, varsayılan açık; bayi politikası kapatabilir.
17. **Tekrar koşum / onarım:** `ornek.json` varsa aynı port ve dizinler; dolu veri dizininde initdb yok; hizmet varsa yeniden kaydedilmez (`ImagePath` doğrulanır); `tekserp.conf`/`pg_hba.conf` yeniden üretilebilir (port/listen/bellek değişirse yeniden başlatma).
18. **Kaldırma:** hizmet durur + `pg_ctl unregister -N TeksERP-PostgreSQL` + ikili dizinleri silinir; **veri dizini ve `pg-setup` KORUNUR** (silmek ayrı, açık seçenek + ikinci onay).

## 5. Küçük sürüm güncellemesi (D2 uygular)

**Koşul:** `ornek.json` `kip: "kendi"` · manifestin istediği (sürüm, derleme) kuruludan farklı · aynı çizgi (`<veri>\PG_VERSION` = yeni `cizgi`; değilse RED → büyük sürüm runbook'u). Pencere/onay güncelleme politikasından (OTOMATİK · ONAYLI · DONDUR). Backend güncellemesiyle aynı koşuda ise PG adımı ÖNCE gelir; PG adımı başarısızsa backend'e dokunulmaz. Her adım yazılmadan önce durum günlüğüne düşer (çökme güvenli: açılışta devam ya da geri dön).

| # | Adım | Ölçüm / geri dönüş |
|---|---|---|
| U0 | PG paketini lisanslı kapıdan indir, imzayı doğrula | imza/özet tutmazsa DUR (hiçbir şey değişmedi) |
| U1 | `<kök>\pgsql\<yeni>\` altına yan yana aç (yarım kalmış önceki deneme manifestoya uymuyorsa silinip yeniden açılır), her dosyayı manifestoya karşı ölç, izni sıfırla | tutmazsa dizini sil, DUR |
| U2 | Ön kontrol: `<yeni>\bin\postgres.exe --version` = yeni sürüm · `<yeni>\bin\pg_controldata <veri>` okunur ("in production") · ICU: eski/yeni `icuuc<N>.dll` | okunamazsa DUR |
| U3 | Yedek: güncelleyicinin yedek adımı (şifreli, `pg_restore --list` doğrulamalı), ESKİ `bin` ile | yedek yoksa DUR |
| U4 | Backend hizmetini durdur (bağlantı kalmasın) | — |
| U5 | `Stop-Service TeksERP-PostgreSQL` (hızlı kapanış); `postmaster.pid` kalmadığını ölç | durmazsa: başlat, backend'i başlat, DUR |
| U6 | Hizmet yolunu değiştir: `ImagePath`'teki `<eski>` dizini `<yeni>` ile — `sc.exe config TeksERP-PostgreSQL binPath= "<yeni yol>"`; geri oku | → GERİ DÖN |
| U7 | `<kök>\pgsql\bin` junction'ı `<yeni>\bin`'e çevir; hedefi ölç | → GERİ DÖN |
| U8 | Başlat → `pg_isready` → `SHOW server_version` = yeni sürüm → yapılandırma sapması yok (§4.11 listesi) | → GERİ DÖN |
| U9 | ICU değiştiyse (ya da `guncellemeSonrasi` `reindex-icu` diyorsa) her uygulama DB'sinde, uygulama rolüyle, `SET statement_timeout = 0` altında: ICU collation'a bağlı index'leri katalogdan bul (`pg_index` ⋈ `pg_depend` ⋈ `pg_collation` `collprovider = 'i'`) → `REINDEX INDEX` → `ALTER COLLATION … REFRESH VERSION`; `guncellemeSonrasi` `sql` adımları | → GERİ DÖN (ICU yine değişirse U9 geri dönüşte de koşar) |
| U10 | Backend'i başlat → sağlık (/health + DB + lisans) | → GERİ DÖN |
| U11 | `ornek.json`: yeni sürüm, `oncekiIkiliDizin = <eski>`; bir önceki sürümün dizini geri dönüş için KALIR, daha eskiler silinir | — |

**GERİ DÖN:** PG'yi durdur → `ImagePath` ve junction `<eski>`'ye → başlat → `SHOW server_version` = eski → (ICU farklıysa U9) → backend'i başlat → sonucu "geri döndü, sebep: …" diye bildir. Küçük sürümler aynı disk biçimini kullanır, veri dizini değişmez; yedekten DB geri yükleme yalnız veri bozulması şüphesinde (beklenmez, insan kararı). Süre (tahmin, ölçülmedi): durdur + değiştir + başlat 10–30 sn, yedek 85 MB'lık DB'de < 1 dk.

## 6. Örnek kaydı — `<kök>\pgsql\ornek.json` (D1'in dondurduğu yerel sözleşmeye önerilir)

```json
{ "bicim": 1, "kip": "kendi", "hizmet": "TeksERP-PostgreSQL",
  "surum": "<X.Y>", "derleme": "<N>", "ikiliDizin": "C:\\TeksERP\\pgsql\\<X.Y>-<N>", "oncekiIkiliDizin": null,
  "veriDizini": "C:\\TeksERP\\pgveri", "port": 5432, "kuruldu": "<ISO-8601 UTC>", "guncellendi": null }
```

Harici kipte `kip: "harici"`, `hizmet` o hizmetin adı (ör. `postgresql-tekserp`), `ikiliDizin`/`veriDizini`/`port` ÖLÇÜLEREK yazılır; `surum` her koşumda `SHOW server_version`'dan okunur (dosyaya güvenilmez).

## 7. Harici PG kipi ve kendi örneğe taşıma (D6)

**Harici kip:** bugünkü kurulumlar — SAHINSRV `postgresql-tekserp` 16.9 (`D:\PostgreSQL\16`, veri `D:\PostgreSQL\data`, `C:\TeksERP\pgsql\bin` → o bin, `docs/ops/SUNUCU-ENVANTERI.md`) ve thinkpad-1'deki `postgresql-tekserp` (`docs/ops/SENARYO-YENI-MUSTERI.md` hazırlık tablosu, "Makine önkoşulları" satırı: "PostgreSQL 16 kurulu, betikler korur"). Kurallar:
- Güncelleyici harici PG'nin hizmetine, ikililerine, yapılandırmasına, portuna **dokunmaz**; PG küçük sürüm güncellemesi yapmaz.
- Yedek yine alınır: `PG_BIN_DIR` = `<kök>\pgsql\bin` junction'ı (harici bin'i gösterir); istemci ailesi sunucuyla uyumsuzsa `pg-tool.helper.ts` bugünkü gibi söyler.
- Backend manifesti `pg.enAz` sürümünü söyler; harici sunucu altındaysa backend güncellemesi REDDEDİLİR (fail-closed) ve panel sebebi gösterir (D7).
- Panel: "PostgreSQL: harici 16.9 — önerilen <kayıt> · kendi örneğe taşı (runbook)".

**Kendi örneğe taşıma — isteğe bağlı, ayrı pencere, kullanıcı kararı; önce thinkpad-1'de:**
1. Kendi örneği §4 ile yan yana kur (5432 harici tuttuğu için §4.5 kuralı 5433'ü seçer); roller ve boş DB hazır.
2. Güncel yedek + doğrulama; backend'i durdur (bundan sonra yazma yok).
3. Son döküm: YENİ `pg_dump` (kendi örneğin `bin`'i, sürüm ≥ harici) ile `-Fc`.
4. `pg_restore --no-owner --no-privileges -d tekserp` uygulama rolüyle (`ilk-kurulum.ps1 -Dump` kalıbı; kimlik ve offsite hedefi KORUNUR — bu bir TAŞIMA, kopya değil). DB düzeyi üç ayar yeniden kurulur (döküm taşımaz).
5. Doğrula: her tablonun satır sayısı iki tarafta eşit · `_prisma_migrations` sayısı eşit · `tr_sort` ICU ve `pg_trgm` var · `SELECT count(*) FROM pg_collation WHERE collname = 'tr_sort' AND collprovider = 'i'` = 1.
6. `.env` `DATABASE_URL` (127.0.0.1 + yeni port) + `BACKUP_PG_*`; `pgsql\bin` junction → kendi `bin`; backend hizmetinin bağımlılığı `TeksERP-PostgreSQL`.
7. Backend'i başlat → sağlık → panelde okuma + bir yazma denemesi.
8. Harici hizmet **Manuel + Durmuş** (SİLİNMEZ — geri dönüş yolu); `ornek.json` `kip: "kendi"`. Harici PG'nin kaldırılması ayrı kullanıcı kararı.

**Geri dönüş:** `.env` ve junction eski değerlere → harici hizmeti başlat → backend'i başlat. Taşımadan sonra yazılan veri eski tarafta YOKTUR: geri dönüş yalnız aynı pencerede (üretim yazısı başlamadan) ya da ters dökümle. **Süre:** dakika mertebesi (85 MB tahmini; thinkpad-1 provasında ölçülür). Collation iki tarafta C — arama/sıralama davranışı değişmez; aynı makine olduğu için lisans parmak izi değişmez.

## 8. D1'e istekler (manifest + dağıtım)

- Backend manifestinde `pg` bloğu: `{ cizgi, enAz, hedef: { surum, derleme, paket, boyut, sha256, icerikSha256, icuSurum } }`. Kendi kipte `hedef` kuruludan farklıysa §5; harici kipte yalnız `enAz` denetlenir.
- PG paketi kanalda backend paketinden AYRI dosya (93 MB'lık ikili her backend sürümünde yeniden taşınmasın): ör. `html/<kanal>/backend/pg/<surum>-<derleme>.zip` + imzalı künye (künye `icerikSha256`'yı taşır).
- `pgsql\ornek.json` (§6) yerel sözleşmeye.

## 9. CI ve Windows duman işi

**Var (bu dilim):** `.github/workflows/pg-ikili.yml` (ubuntu, `deploy/pg/**` değişince + elle): bekçi + sondalar · `--ag` yoklaması · indir + boyut/SHA256 + içerik + sahne · manifesto yapıtı. `ci.yml` doküman işi her push'ta ağsız bekçiyi koşar.

**Windows işi (D2/D5'in Windows koşucusu işine birleşir — tanım):**
- W1 `node deploy/pg/pg-ikili-dogrula.mjs --indir --sahne $env:RUNNER_TEMP\pg`
- W2 `Get-AuthenticodeSignature` zorunlu ikililerde `NotSigned` (kayıt `imza: "yok"`); `Valid` çıkarsa kayıt güncellenir.
- W3 İmzalı kökenle çapraz doğrulama (§3.4): kurucu `.exe`'nin imzası `Valid` + EnterpriseDB → yalnız-çıkar kipi (EDB/InstallBuilder seçeneği — **ölçülecek**) → `bin/*.exe` + `lib/*.dll` özetleri sahne manifestosuyla eşit.
- W4 `bin\postgres.exe --version` = "postgres (PostgreSQL) <surum>".
- W5 initdb (§4.7, kayıttaki argümanlar) → `PG_VERSION` = çizgi.
- W6 `node deploy/pg/pg-sablon.mjs --ram-mb <ölçülen> --port <portSec> --cikti <veri>` + include satırı; `--denetle` yeşil.
- W7 `pg_ctl register -N TeksERP-PostgreSQL-CI -U "NT SERVICE\TeksERP-PostgreSQL-CI" -S demand` (sanal hesapla `-P`'siz kayıt — **ölçülecek**) → veri dizini ACL (§4.10) → `Start-Service` → Running.
- W8 §4.11 listesi + `CREATE COLLATION tr_sort (provider = icu, locale = 'tr-u-kn-true')` ve `SELECT 'Çanakkale' < 'Cebeci' COLLATE tr_sort` = false · uygulama rolüyle (süper değil) `CREATE EXTENSION pg_trgm` · parolasız bağlantı RED · koşucunun LAN adresinden porta bağlantı RED.
- W9 Küçük sürüm provası: ikinci bir derleme yan yana → §5 U5–U8 → sürüm değişti → GERİ DÖN → eski sürüm.
- W10 Temizlik: durdur, `pg_ctl unregister`, dizinleri sil.

## 10. Açık / sonraki

- **Ölçülecek (Windows):** `pg_ctl register` + sanal hesap `-P`'siz · initdb kısıtlı token + hizmet-önce-ACL sırası · kurucunun yalnız-çıkar kipi (W3) · §5 süreleri · taşıma süresi (thinkpad-1).
- **Öneri (karar yok):** CI backend işinin PostgreSQL'i sahayla aynı collation'da (`POSTGRES_INITDB_ARGS: --locale=C`) koşması — bugün geliştirme/CI `en_US.utf8`, saha ve kendi örnek C; ayrışma katlama pini sayesinde etkisiz ama ancak ölçüldüğü kadar.
- Linux teslimi (Docker) kendi `postgres:16` imaj pinini taşır; küçük sürüm hizası ayrı iş (Linux güncelleyicisi kapsam dışı).
- `pg_stat_statements` (yavaş sorgu teşhisi) ayrı karar.
- Bekçinin commit kapısına bağlanması (`deploy/pg/**` → `test_pg_ornegi`, ~0,2 sn, DB'siz/ağsız) ve hızlı mandal kümesine alınması yönetici kararıdır.
