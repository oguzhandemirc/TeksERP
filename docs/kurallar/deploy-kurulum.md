# Deploy · Kurulum · Migration
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/deploy-kurulum.md`.

[ÇEKİRDEK] her kurulumda aynı · [PROFİL] bu fabrikanın seçimi. Satır başı bekçi adları ayrıntıda.

## Ortak (backend + panel + tablet)

### Değişmezler

- [ÇEKİRDEK] Commit edilmemiş migration'ı yayınlama (`migrate deploy` sessiz atlar → P2022). Elle: git add → db execute → resolve --applied → DOĞRULA; araç `scripts/apply-migration.ts <ad> [--apply]`.
- [ÇEKİRDEK] Migration kendisinden SONRA doğan tabloya ALTER/INDEX/FK/INSERT yazmaz (`42P01`); ifadeyi sonraki yeni migration'a `IF NOT EXISTS` ile taşı; ölçüt BOŞ DB.
- [ÇEKİRDEK] `ALTER TYPE … ADD VALUE IF NOT EXISTS` kendi tek ifadeli dosyasında; yeni değeri kullanan ifade o dosyaya girmez (55P04). Devralınan ihlalli dosyaları DÜZELTME (checksum).
- [ÇEKİRDEK] Kısıt veri temizlenmeden aynı sürümde gelmez (expand → backfill → contract): mükerrerde RAISE NOTICE ile atla, deploy düşmesin; temizlik sonrası aynı dosya enforce eder.
- [ÇEKİRDEK] Prisma şema motoru NATIVE: Windows paketi `PRISMA_CLI_BINARY_TARGETS=windows`, `paketle.ps1` varlık+MZ kapısı, `kur.ps1 [1/9]`; yeşil prova "paket yeter" demez.
- [ÇEKİRDEK] "Platformdan bağımsız" notu hangi ikilileri kapsadığını açıkça söyler; tek boyuttaki bağımsızlığı genelleme.
- [ÇEKİRDEK] BACKEND ÖNCE; paket notu üç kapıyı sayar (migration? izin? APK/Electron?). İstemci yeni alanı göndermek zorundaysa (`confirmMismatch`) üçü birlikte, güvenli varsayılan varsa backend tek.
- [ÇEKİRDEK] Her `DateTime` `@db.Timestamptz`, UUID `@db.Uuid`; `PG_SESSION_OPTIONS` silinmez, `new Pool(` kuran her dosya geçirir.
- [ÇEKİRDEK] Prod'dan gelen "dev'de yapılacaklar" notunun repo/bekçi varsayımlarını uygulamadan önce ölç.
- [ÇEKİRDEK] Kök `.gitignore` sır/döküm sınıflarını kendi yoksayar (`.env*`, anahtar dosyaları, `tkenc`, `dump/`, `scripts/out/`, `deploy/**.env`); şablonlar açık; yeni sır sınıfını ÖNCE kök kalıba ekle.
- [ÇEKİRDEK] Müşteri yerindeki sunucuya gelen port AÇMA; bizim VDS/demo sunucumuz yayın yapar ve sertleştirmeyi taşır (`BULUT-KURULUM.md` §3, `PLAY-DEMO-SUNUCU.md`).
- [ÇEKİRDEK] Kurulum varsayılan yolları ASCII, boşluksuz: panel `<sürücü>\EtkiliYazilim\TeksERP` (`installer.nsh`, yalnız ilk kurulum), backend `C:\TeksERP[-sonek]`.
- [ÇEKİRDEK] Actions'ta Docker Hub imajı yalnız `mirror.gcr.io/library/<ad>`dan; derleyen işte `registry-mirrors: ["https://mirror.gcr.io"]`.

### Yasaklar

- [ÇEKİRDEK] PRODUCTION canlı ve tekil değil: migrate reset / reseed / toplu DELETE YASAK; rollback = restore; düzeltme script'i dry-run varsayılan, `--apply` öncesi her kaydı listeler.
- [ÇEKİRDEK] Konteyner seed'i yalnız `users` boş VE `SEED_ON_EMPTY=1`; çalışma imajı kaynak taşımaz; demo ağacı yalnız `deploy-demo-izin-listesi.txt`ten.
- [ÇEKİRDEK] Paket ve demo `main`'den; müşteri dalı YOK; `if (musteri === 'X')` yasak.
- [PROFİL] adnansahin DONDURULMUŞ kalır; bakım sürümünü yalnız kullanıcının açık cümlesiyle, yalnız `bakim/adnansahin-*` dalından, backend ve migration İÇERMEDEN çıkar; yeniden kurulum setup.exe + "yedekten kur", önce thinkpad-1'de prova. [ÇEKİRDEK] Ortak paket ona geriye uyum taşımaz. <sub>(arşiv:2026-11-04)</sub>
- [ÇEKİRDEK] `minVersion` sahadaki sürümden BÜYÜK olamaz, yalnız gerçek kırılmada; ÖNCE yeni istemci, SONRA minVersion'lı backend.

### Tuzaklar

- [ÇEKİRDEK] Altı sözleşme tetiğinde (uç · alan adı · tip/birim · zorunlu parametre · enum · izin) "eski istemci ne yapar" cevaplanır; bozulursa minVersion.

### Reçeteler

- [ÇEKİRDEK] Şema provası en eski canlı dump'ta: restore → migrate deploy → bekçiler → profil boot.
- [ÇEKİRDEK] `paketle.ps1 -Prova` etiket/sürüm belgesi yazmaz, sürüm `<s>-prova.<commit>`, `kur.ps1` `-ProvaKabul` ister; kirli ağaç paketine etiket yok.
- [ÇEKİRDEK] Yayın günü betiği `build-araclar.mjs` ARACLAR'a girer, pakette `node dist\tools\<ad>.cjs` ile koşar; ayrı araç paketi yok.
- [ÇEKİRDEK] Yayın günü `--apply` `--onay=<N>` + `--hedef=<db>` ister; çıplak `--apply` "Yazma YOK" ile düşer.
- [ÇEKİRDEK] `ilk-kurulum.ps1 -Dump` `-DumpAmaci Kopya|Tasima` ister (`Kopya` `installationId` yeniler, offsite boşaltır); amaçsız durur.
- [ÇEKİRDEK] DB ayarlarını (`teks.audit_guard`, `statement_timeout`, `idle_in_transaction_session_timeout`) restore'dan SONRA kur; `teks.*` superuser'la; farklı değeri ezme.
- [ÇEKİRDEK] Audit koruması "tam" yalnız uygulama rolü sahip/süper değil ve zincir sağlamken; değilse çalışır, `auditProtection.level = "kismi"`.
- [ÇEKİRDEK] PG sunucu ayarı `ilk-kurulum.ps1 -PgAyarla` (`ALTER SYSTEM`); bayraksız yalnız rapor; farklı değer ezilmez; restart yalnız `-PgYenidenBaslat`.
- [ÇEKİRDEK] Sırlı dosyalar yalnız SYSTEM+Administrators (SID, miras kesik), daraltma ölçülür; `kur.ps1` `%TEMP%`e sır yazmaz; parola argv'den gelmez.
- [ÇEKİRDEK] Sıfırdan kurulum `TeksERP-Backend-Boot` ve `TeksERP-DB-Backup` görevlerini kurar, ezmez; `yedekle.ps1` `.part` → `pg_restore --list` → `.dump`, saklama başarıdan sonra.
- [ÇEKİRDEK] Şifreleme niyeti tek kaynak `.env` `BACKUP_KEY_DIR` (yedek klasörü dışı); niyet varken düz döküm dışarı çıkmaz; parola yalnız TTY/`X-Backup-Password`.
- [ÇEKİRDEK] Yedek/geri yükleme/kopya süper kullanıcı istemez: `BACKUP_PG_USER` bakım rolü, `bakim-rolu.ps1` kurar; `postgres` olan kurulum aynen çalışır.
- [ÇEKİRDEK] Betikte sır argv'ye girmez (`PsqlStdin`, `ScramDogrulayici`); soru kapısı `SoruSorabilir`; `deploy/**/*.ps1` regex DUYARLI, duyarsız ise `IgnoreCase, CultureInvariant`.
- [ÇEKİRDEK] API gelen kuralı yalnız `Domain,Private` + `LocalSubnet`; `Tailscale-In` değiştirilmez; Windows paketi web paneli taşımaz, `WEB_DIST_DIR` yazılmaz.
- [ÇEKİRDEK] SSH'ta pm2 daemon yoksa `kur.ps1` durur (`-SshKabul`); iş `uzaktan-kos.ps1` ile SYSTEM görevine.
- [ÇEKİRDEK] Harici PG runbook §2.1b'ye göre kurulur (EDB masaüstünde, zip SHA256 kıyaslı, kısıtlı `initdb`, `icacls /reset /T`). [PROFİL] `D:\PostgreSQL\16`, veri `D:\PostgreSQL\data`.
- [ÇEKİRDEK] Kendi PG tek kaynaktan (`deploy/pg/*.json`, `*.sablon`): `127.0.0.1`, `scram-sha-256`, UTC, `--locale=C --data-checksums`; ana sürüm runbook'la; harici PG'ye güncelleyici dokunmaz.
- [ÇEKİRDEK] İlk kurulum arşivi yalnız `kurulum-arsivi.mjs`ten (müşteri/kanal argümansız); depoya `derleme-koy.mjs` (KURU, ezmez); setup yalnız `korumali-thinkpad.sh`te; müşteri grubu yalnız `terfi/<grup>/backend-v<s>`.
- [ÇEKİRDEK] Depodan silme yalnız `derleme-koy.mjs --kaldir`/`--yenile`, AKTİF bağlantı yokken ve Mac'e arşivlendikten sonra; depoda yalnız ortak arşiv.
- [ÇEKİRDEK] Veri düzelten yayın günü adımı migration değil: dry-run → çıktı → kullanıcı onayı → `--apply` → ikinci koşum 0; liste değişimi KULLANICI kararı.

## Backend

### Değişmezler

- [ÇEKİRDEK] Üç migration bekçisi de gerekir: `check:migrations` · `test_migration_hygiene` · `test_schema_drift`.
- [ÇEKİRDEK] DB'ye yazan bekçi `scripts/lib/hedef-db-kapisi`nden geçer.
- [ÇEKİRDEK] Sürüm politikası tek kaynak `CLIENT_VERSION_POLICIES`: `minVersion` KODDA, `GET /api/client-policy/:istemci` PUBLIC, istemci FAIL-OPEN, tanımsız 404.
- [ÇEKİRDEK] Şema değişince `npm run prisma:generate` ZORUNLU.
- [ÇEKİRDEK] `npm test` önce `tsconfig.scripts.json` tip geçidini koşar (kaçış `SKIP_TYPECHECK=1`).
- [ÇEKİRDEK] DB perf: FK index · eşitlik önce · tek composite · cursor + MAX_OFFSET=10000 · GIN · select · $queryRaw · createMany · EXPLAIN.
- [ÇEKİRDEK] `JWT_SECRET` tek yüklem `checkJwtSecret`: yok/kısa durdurur; zayıf sır mevcut kurulumu durdurmaz (`rotationRequired`), yeni kurulumu reddeder.
- [ÇEKİRDEK] İlk yönetici sabit parolayla doğmaz: `admin / 123123` yalnız `--gelistirme`; Docker `ILK_YONETICI_PAROLASI` ya da rastgele + `mustChangePassword`.
- [ÇEKİRDEK] Güncelleyici ayrı ürün değil: PAKET imzalı gelir, A/B ile kendini yeniler (`DONDUR`da da), K1'de hiçbir şey; dalga yalnız elle.
- [ÇEKİRDEK] Güncelleyici sözleşmesi donmuş: bilinmeyen alan atılır, bilinmeyen adım geri alınır, adım değişirse `v` artar; eski biçim vektörleri yalnız eklenir.
- [ÇEKİRDEK] Bildirim platformu okuyanın parametresi; başka platform yoluna yazma (`backend/` · `backend-oci/`); uyumsuz → `SURUM_PLATFORM`.
- [ÇEKİRDEK] Hedefe özgü kod yalnız `src/platform/`; günlük platformu farklıysa dokunma (`IC_HATA`).
- [ÇEKİRDEK] Linux güvenilmez okuma `O_NOFOLLOW` + açılan tutamaç ölçümü; çocuk süreç kendi grubunda + `PR_SET_PDEATHSIG`.
- [ÇEKİRDEK] Docker CLI'dan yalnız Go şablonlu tek değer oku; kendi `stop`unu çökme sayma; araç konteynerini önce `docker rm -f` ile temizle.
- [ÇEKİRDEK] Tanı paketi (`tani`) sır taşımaz, gönderilmez; yeni dosya `tani::Suzgec`ten.
- [ÇEKİRDEK] Güncelleyici backend işleminden ÖNCE kendini yeniler; farklı hedef/çapa kipini yerleştirmez; kanıtlı ikili `.lkg`, kanıtsız hata → dön ve reddet.
- [ÇEKİRDEK] systemd taban birimi yalnız `hizmet-kur`la; ayar yalnız `50-tekserp.conf` izin listesiyle; ikili `READY=1` gönderir.
- [ÇEKİRDEK] Hizmet ikilisi hiç boş kalmaz: Windows ImagePath tek yazımla, Linux tek `rename(2)`; `onar` 3/24 sa'te durur, devre dışı hizmeti onarmaz.
- [ÇEKİRDEK] Elle Docker kurulumu güncelleyiciye yalnız `gecis` ile (KURU → `--uygula --onay N`); birim/imaj silen komut yok; veri kökü `/var/lib/tekserp`.
- [ÇEKİRDEK] Linux teslim tar'ı yalnız `src/tar.rs` ile açılır, sapma `PAKET_YOL`; imza + bildirim bağı doğrulanır; `tar` crate'i ekleme.
- [ÇEKİRDEK] Linux kira/HAK `<proje>_lisans` biriminden okunur; konakta kopya yok, çözülemezse `KIRA_YOK`.
- [ÇEKİRDEK] Yan hizmet (`yedek`) yalnız yeni backend sağlıklıyken `--no-deps` ile eşitlenir; sonucu backend'i geri almaz.
- [ÇEKİRDEK] Araç konteynerine yetki (`cap_add`, başka `--user`) ekleme; veri konakta güvenilmez okumayla, imajdan ağsız salt okunur.
- [ÇEKİRDEK] Güvenilen dizin `GUVENILEN_DIZIN_KIPI` ile yaratılır, umask'a bırakılmaz.
- [ÇEKİRDEK] Bildirimin `guncelleyici` bloğunu elle yazma (`guncelleyici-blok.ts` ölçer); ölçülemeyen paket imzalanmaz.
- [ÇEKİRDEK] Disk dolunca `DISK_DOLU` + geri al; yedek alan yoksa işlem başlamaz; dönen sürüm yeni onaysız denenmez; ön kontrol `package::disk_needs`.
- [ÇEKİRDEK] Aday sorgusu kira yenilenince, onayda ve en geç 6 sa'te; uygulamadan önce 60 sn tazeleme; bayat aday gösterilmez.
- [ÇEKİRDEK] Onay niyete 5 dk sonra yazılır, arada `plannedOutage` duyurulur; istemci bağlantıyı bekler, `clientToken` kuralı değişmez; sayılar [PROFİL].
- [ÇEKİRDEK] OTOMATİK pencere kurulumu duyurulu `planlanan`dan önce başlamaz (`PENCERE_BEKLIYOR`); kapı Rust `decision::announce_gate`.
- [ÇEKİRDEK] `AGIR_TESTLER` commit kapısında koşmaz, CI'da tam; liste kullanıcı kararıyla; güncelleme adımına dokunan iş `native && npm test`.
- [ÇEKİRDEK] Yoğun tablolara (`rolls`, `machine_stop_events`, `machine_runs`, `system_logs`, `system_log_archives`, `sessions`) autovacuum eşiği migration'la; `FILLFACTOR` düşürme.
- [ÇEKİRDEK] Korumalı compose: postgres `shm_size: 256m`, her servis sınırlı `json-file` günlük.
- [ÇEKİRDEK] `premigrate_`: en yeni 3 kalır, 90 günden eskiler silinir, liste önce günlüğe; diğer yedek türleri hariç.
- [ÇEKİRDEK] Migration süper olmayan sahiple koşmalı: fonksiyonda `SET`, `ALTER SYSTEM`, `CREATE/ALTER ROLE`, `ALTER DATABASE … SET` yok; restore `--no-acl`.

### Yasaklar

- [ÇEKİRDEK] Canlı DB'de index migration'ı VARDİYA DIŞINDA; büyük tabloda `SET statement_timeout = 0;` ile başla.
- [ÇEKİRDEK] Backend'e paket ekleme, kendin yaz; istisna `bonjour-service` 1.4.4 ve `liquidjs` 10.30.0 SABİT.

### Tuzaklar

- [ÇEKİRDEK] `migrate resolve --applied` koşmayı doğrulamaz; `\d+` / `pg_enum` / `indisvalid` ile doğrula.
- [ÇEKİRDEK] `apply-migration.ts` hedefi `process.env.DATABASE_URL`den, adıyla basar, `current_database()` doğrular, `resolve` aynı URL.
- [ÇEKİRDEK] Yeni migration `--create-only`; iki DEFERRABLE FK'nın `DropForeignKey` satırları SİLİNİR.
- [ÇEKİRDEK] Prisma `Teks-Erp/` içinden ya da `--config Teks-Erp/prisma.config.ts`.
- [ÇEKİRDEK] timestamptz geri alma `SET timezone='UTC'; BEGIN;`; tip geçişi `USING c AT TIME ZONE 'UTC'`.
- [ÇEKİRDEK] `/health` PUBLIC, `auditGuard` yok; o `/api/admin/health`te.
- [ÇEKİRDEK] Kurulum talimatı `docs/surumler/backend-<sürüm>.md`den; önceki saha sürümünü TAHMİN ETME.
- [ÇEKİRDEK] `kur.ps1` çıkış kodlarını toplamaz, başarısızları adıyla raporlar.
- [ÇEKİRDEK] `[5/9]` taşıması `TasiIsrarla`; çıplak `Move-Item` yok.
- [ÇEKİRDEK] Betikler PS 5.1 + kısıtlı ilkede koşar: ASCII metin, `npm.cmd`, `NativeArg`, `-NoProfile -ExecutionPolicy Bypass -File`.
- [ÇEKİRDEK] Dev backend P2023'te `prisma generate` + restart; `pkill -f "tsx src/server.ts"` YASAK.
- [ÇEKİRDEK] Dış `FROM` `@sha256:` özetli, `uses:` 40-hex SHA + `# vX.Y.Z`, üst `permissions:` salt okur; özet ölçülür, uydurulmaz.
- [ÇEKİRDEK] SHA'lı `uses:` yalnız Dependabot (`github-actions`) taşır; npm/cargo Dependabot'a VERİLMEZ.
- [ÇEKİRDEK] Korumalı Node tek kaynak `deploy/node-surumu.json`; literal gömme; indirme `koruma-runtime-indir.mjs`, SHA tutmazsa dur.
- [ÇEKİRDEK] Korumalı pakette `kur.ps1 [2/9]` ecosystem'i paketin Node'una bağlar (`.onceki` önce, env aynen); okunamazsa durur.
- [ÇEKİRDEK] `kur.ps1` pm2 AD KAPISI: ad/kök/port çakışmasında ya da liste okunamazsa DURUR; yan yana yalnız açık ad + farklı PORT.
- [ÇEKİRDEK] `.jsc` OS+mimari+V8'e kilitli, hedefte üret; uyumsuzlukta exit 78; kaynak haritası pakete girmez; şema yorumsuz; `dist/tools` karartılır.
- [ÇEKİRDEK] `paket-<yıl>` ile yalnız CI kökeni ölçülmüş yapıtı imzala (`--ci-kosu`); kaçış yalnız kullanıcı cümlesiyle `--ci-atla`; thinkpad-1 `--derleme-kunyesi=`.
- [ÇEKİRDEK] Korumalı artefakt `retention-days: 1`; kaynak haritası ayrı artefakt olmaz.
- [ÇEKİRDEK] Native çekirdek kanal çapa kipiyle; uyuşmazsa paket yok; `paket-<yıl>` ↔ `paket-hazirlik*`; `kur.ps1 [1/9]` imzasız paketi kurmaz.
- [ÇEKİRDEK] `PAKET.json` üreticinin makine/kullanıcı adını taşımaz.
- [ÇEKİRDEK] Backend paketi ORTAK: kimlik `deploy/dagitim.json`, `backendKanal: null`; imza anahtarı varsayılan yoldan okunmaz.
- [ÇEKİRDEK] Linux teslimi imzalı korumalı imaj: `src`/`.map` yok, root değil, `/app` salt okunur; imzasız/eksik teslim yok; `down -v` YASAK.
- [ÇEKİRDEK] Korumalı Docker'da API yalnız `127.0.0.1`; `TRUST_PROXY=1` yalnız vekil arkasında; kaldırma birim adıyla; 443 kenarı yalnız bizim sunucuda.
- [PROFİL] Bulut 443 kenarı yalnız `kenar/site.conf.ornek`ten; Cloudflare hız kuralı ENGELLE; teslim `barindirma-kontrol.sh` çıkış 0.
- [PROFİL] Bulut yedeği yalnız ÇEKME ile (`*.dump.tkenc`, `rrsync -ro -no-del`); düz döküm geçmez; şifrelenemezse sağlık KRİTİK.
- [ÇEKİRDEK] Giriş/TOTP/lisans uçları IP başına 60/dk (429 `RATE_LIMITED`); genel kova yalnız `RATE_LIMIT_ENABLED=true`; barındırılanda `TRUST_PROXY=true` durdurur.
- [ÇEKİRDEK] `TEKSERP_GOC_ACILISTA`: yok/`1` göç, `0` göç yok ve küme eşit değilse açılmaz; `0`ı yalnız güncelleyicili compose yazar.
- [ÇEKİRDEK] OCI teslimi tek tar (`oci-paket.ts`, `teslim-paketle.sh`), `--urun=backend-oci`; imaj kimliği arşivden, `.Id` kullanılmaz.
- [PROFİL] Elle Docker güncellemesinde compose'u paketin `commit`inden yenile; güncelleyicili compose'u elle kuruluma KOYMA.
- [ÇEKİRDEK] Docker backend sahip rolle koşmaz: açılış `db-rol-gocu.cjs --uygula`; yapılamazsa `kismi`, fabrika DURMAZ; araç argümansız KURU.
- [ÇEKİRDEK] Windows rol göçü `db-rol-gocu --sahip`: URL yalnız `TEKSERP_PG_SUPER_URL`; argv'de URL/parola yok; aktivasyon 2.15.8.
- [ÇEKİRDEK] Konteynerde PID 1 açılış betiği, `exec tini -s --`; hiçbir imajda `dist/**/*.map` yok.
- [ÇEKİRDEK] `paketle.ps1 -Korumali` araçları paketin runtime node'uyla `.jsc`ye çevirir; `korumali-paket.yml` ve `kur.ps1` değişmez.
- [ÇEKİRDEK] Korumasız imaj: `.dockerignore` izin listesi, `USER node`, salt okunur kök, `cap_drop: ALL`, `no-new-privileges`; lisans kalıcı birimde.
- [ÇEKİRDEK] Backend hizmeti `TeksERP-Backend` sanal hesapla düşük yetkili; program dizini salt okunur; kayıt/izin yalnız `backend-hizmeti.ps1 -Uygula`; yol kaynağı `TEKSERP_KOK`.
- [ÇEKİRDEK] pm2 yolu DONDURULDU: kalır, çalışır, yalnız düzeltme alır; filoda pm2 kalmayınca kaldırılır.
- [ÇEKİRDEK] pm2 → hizmet yalnız `gecis.ps1` ile, DB'ye dokunmadan; bekleyen göçte durur; KURU → `-Uygula -Onay <N>`; sonra `-GeriAl`.
- [ÇEKİRDEK] Geçiş kanal kimliğini paketten çözer; `LICENSE_SERVER_URL` uyuşmazsa uygula DURUR.
- [ÇEKİRDEK] Kurulum lisans satıcısını KANALDAN alır; farklı elle değer engellemez, uyarır.
- [ÇEKİRDEK] YÖNETİCİ/SYSTEM ile koşan her dosya PAKET imzalı kapsamda (`paketle.ps1` üç listesi); imzasız çalıştırılabilir yok.
- [ÇEKİRDEK] Setup yalnız cevap toplar, `kurulum.ps1`i çağırır; sırlar yalnız anonim boruyla; cevap dosyası sırsız; kaldırma VERİYİ KORUR.
- [ÇEKİRDEK] Onarım kurulu sürümü ölçer; daha yeni sürüm kuruluysa dokunmadan durur.
- [ÇEKİRDEK] Kurulum başka kurulumu EZMEZ (`HizmetKokEngelleri`), onarım erişimi DARALTMAZ; GECISLI düzen setup'la onarılmaz.
- [ÇEKİRDEK] Müşteri kurulumu portu yalnız `LocalSubnet`e açar; Tailscale yok, `100.64.0.0/10` RED.
- [ÇEKİRDEK] Yeni kurulum `LAN_TLS_MODE=required` yazar: yalnız HTTPS 4443, API 127.0.0.1 kuralsız; onarım satıra dokunmaz; pm2 geçişi `dual`.
- [ÇEKİRDEK] Panel sunucu güncellemesi yüzeyleri karar üretmez: kaynak `GET /api/guncelleme/durum`, onay `POST /api/guncelleme/onay`; uç/izin yoksa sessiz.
- [ÇEKİRDEK] Paket şemanın gerisindeyse uygulanmaz (`SEMA_ILERIDE`); ölçüt göç ad kümesi; ölçülemezse `SEMA_OLCULEMEDI` bilgi.
- [ÇEKİRDEK] `.env` okuyucuları dotenv ile birebir (`envfile.rs`); zorunlu anahtar yoksa `AYAR_EKSIK`.
- [ÇEKİRDEK] G21-K PIN/kart göçü geri çevrilmez: `kur.ps1 -GeriAl` + yeni PIN/kart; `premigrate_` yalnız yeni veri yoksa.
- [ÇEKİRDEK] `<kök>\current` elle çevrilmez; geri dönüş `GERI_DONDU` ya da `gecis.ps1 -GeriAl`.
- [ÇEKİRDEK] Paket aracını elle koşarken `DOTENV_CONFIG_PATH` ve `LICENSE_DIR` AÇIKÇA ver.
- [ÇEKİRDEK] Linux imaj yalnız güncelleyicinin yüklemesiyle; elle `docker load`/`docker tag` yok.

### Reçeteler

- [ÇEKİRDEK] Pull sonrası: npm install → prisma:generate → prisma:migrate (deploy) → dev.
- [ÇEKİRDEK] Kopyaya geri yükle (`<canlı>_restore_<damga>`), doğrula, iki `RENAME` ile takas; `TEMPLATE template0` ŞART; silme allowlist'li.

### Ölçümler

- [ÇEKİRDEK] Havuz `pg.Pool max` 30'da KALIR; `max_connections` ≥ havuz + bakım payı.
- [ÇEKİRDEK] İndeks göçünün kilit süresi ölçülerek söylenir.
- [PROFİL] `statement_timeout=50s` `ALTER DATABASE` ile, migration ile DEĞİL; DB adını `.env`den doğrula.
- [ÇEKİRDEK] `npm run build` = `tsc && build-araclar.mjs`; `npm run seed` temiz kurulum seed'i.

## Panel (Electron)

### Değişmezler

- [ÇEKİRDEK] Electron kimliği KANALDAN, derlemede enjekte (`electron-paketle.sh`); ağaçta literal kimlik yok.

### Tuzaklar

- [ÇEKİRDEK] Electron'a yeni paket ONAY ister; `bonjour-service` `dependencies`'te.

## Tablet (mobil)

### Reçeteler

- [PROFİL] APK kaldır+kur cihaz kimliğini değiştirir (`devicePairingRequired` açıksa PENDING); native değişiklik APK, saf JS OTA.

## Geçersiz kılınan kurallar — bunlara UYMA

- adnansahin'e yerinde pm2 → hizmet geçişi YOK.
- "adnansahin hiçbir güncelleme almaz" → bakım sürümü istisnası: kullanıcı cümlesiyle, `bakim/adnansahin-*` dalından, backend/migration'sız panel/tablet bakım sürümü çıkabilir (2026-11-04).
- "`items`/`customers` partial yok" geçersiz (`nameFold_key` var).
- "`npm run seed` = test verisi" geçersiz.
- Fabrika `git pull` ile değil paketle güncellenir.
- nameFold mükerrerde NOTICE ile atlar (EXCEPTION değil).
- Tablet yalnız `devicePairingRequired` açıkken PENDING.

## Çözülmüş çelişkiler

- Süperadmin aracı pakete GİRER, `dist/server.js` import etmez.
- Yeni migration `--create-only` + `DropForeignKey` silme.

## Açık sorular

- `backend-v*` eksenini `test_surum.mjs` ölçüyor mu belirsiz.
- Pull-sonrası notunda terim tutarsızlığı.
- `Teks-Erp/CLAUDE.md` middlewares listesi bayat.

## Doğrulama turu ekleri (eski CLAUDE.md ↔ yeni yapı karşılaştırması, 2026-09-05)

- [ÇEKİRDEK] Restore kopyalarında otomatik retention ve `_old_` silme ucu YOK; temizlik elle (`isRestoreCopyName`).
- [ÇEKİRDEK] Sunucu simgesi yönetici istemez, güncelleyici dizinine dokunmaz; yalnız `GET /health/tepsi` okur.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad>` · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`. Harita `Teks-Erp/docs/BEKCI-HARITASI.md`.

Backend: `test_yedek_barindirma`, `test_migration_super_olmayan`, `test_db_rol_gocu`, `test_dagitim_sabitleme`, `test_bakim_isleri`, `test_sunucu_betikleri`, `test_thinkpad_kokeni`, `test_hizmet_duzeni`, `test_env_okuyucu`, `test_sema_hizasi`, `test_gecis`, `test_kurulum_betikleri`, `test_tepsi_durumu`, `test_paket_kapsami`, `test_bakim_rolu`, `test_deploy_log_rotation`, `test_deploy_move_retry`, `test_audit_depth`, `test_audit_followups`, `test_backend_surum`, `test_barcode_reservation`, `test_batch_number_format`, `test_cash_period_close`, `test_check_violation_mapping`, `test_client_policy`, `test_client_registry`, `test_db_copy`, `test_db_invariants`, `test_fold_contract`, `test_guarded_hard_remove`, `test_hard_delete_guard_coverage`, `test_master_data_merge_fk_coverage`, `test_master_data_merge_race`, `test_master_data_name_dup`, `test_migration_hygiene`, `test_mobile_update`, `test_module_grandfathering`, `test_offsite_sweep`, `test_phase6_reporterror_concurrency`, `test_qc2_idempotency`⚠️, `test_quality_scorecard`, `test_raw_sql_hygiene`, `test_record_provenance`, `test_report_day_boundary`, `test_roll_barcode`, `test_roll_entry_station`, `test_schema_drift`, `test_script_guards`, `test_timestamptz_contract`, `test_traveler_print_active_card`, `test_yarn_stock`, `test_docker_hijyeni`

Native (`cd Teks-Erp/native && npm test`): `tekserp-hizmet/tests/env_dosyasi_vektorleri.rs` · `tekserp-guncelleyici/tests/ayar_env.rs` · `tekserp-guncelleyici/tests/systemd_birimi.rs` · `tekserp-guncelleyici/tests/izin_umask.rs` · `tekserp-guncelleyici/tests/on_duyuru.rs` · `tekserp-guncelleyici/tests/linux_paket.rs` · `tekserp-guncelleyici/tests/sema_hizasi.rs` · `tekserp-guncelleyici/src/platform/linux/sys.rs` · `tekserp-guncelleyici/src/platform/linux/docker.rs` · `tekserp-guncelleyici/tests/docker_gercek.rs` · `tekserp-guncelleyici/tests/tani_paketi.rs` · `tekserp-guncelleyici/tests/self_update.rs` · `tekserp-guncelleyici/tests/disk_dolu.rs` · `tekserp-guncelleyici/tests/aday_sorgu_sikligi.rs`

Kök: `test_bulut_kenar.mjs` · `test_bulut_yedek_cek.mjs`

İstemci: `GuncellemeDugmesi.test.tsx`⚠️, `surum-notlari.test.ts`⚠️, `version-compare.test.ts`⚠️, `clients-utils.test.ts`, `update-check-interval.test.ts`, `update-feed-url.test.ts`, `update-gate-escape.test.ts`, `UpdateActions.test.tsx`, `appUpdate.service.test.ts`, `clientPolicy.service.test.ts`, `surumNotlari.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- Tarihli not listesi (2026-08-26 … 2026-11-01): `docs/kurallar/ayrinti/deploy-kurulum.md`.
