# Deploy · Kurulum · Migration

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: anlama turu 2026-09-05 (kök `CLAUDE.md` + `docs/history/CLAUDE-NOT-ARSIVI.md` notlarından ayrıştırıldı). Hikâye, ölçüm ve gerekçe arşivde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> Hakem notu: 53 üye; 15'i deploy/kurulum çekirdeği (prod-canlı, kur.ps1/paketle.ps1, Prisma iki motor, migration disiplini, istemci sürüm politikası, timestamptz, izin uzlaştırması), kalanı 'Backend ÖNCE / APK gerekir' cümlesiyle sürüklenmiş başka küme notları. Bayat: Commands (build/seed satırları, --create-only şerhi yok), perf kuralı 4'ün 'items/customers partial yok' cümlesi, Pull-sonrası 'production'da da aynı komut' (prosedür artık paket), Electron paket tablosu. En riskli çelişki: kök 2026-09-04 notu 'superadmin aracı sunucu paketine girmez' derken paketle.ps1:148 aracı pakette ZORUNLU kılar (dist/tools) — cümle 'runtime'a girmez' olmalı; yanlış okunursa satıcı hesabı kurulamaz kalır. Kök 'Sürüm Yayınlama' backend paketleme/etiket eksenini (backend-v*) anlatmıyor. [doğrulandı: 53 üye, 5 kanıt kontrolü, 8 düzeltme]


## Ortak (backend + panel + tablet)


### Değişmezler

- **[ÇEKİRDEK]** Commit edilmemiş migration prod'da SESSİZ eksiktir: `migrate deploy` yalnız dizindeki dosyaları uygular, 'başarılı' der, kolonu okuyan her yol P2022 verir. Elle migration sırası git add → db execute → resolve --applied → DOĞRULA; mekanik: `npx tsx scripts/apply-migration.ts <ad> [--apply]`. · bekçi: `scripts/check-migrations.mjs (npm run check:migrations) · test_migration_hygiene · test_schema_drift — üç ayrı soru (Teks-Erp/CLAUDE.md), üçü de ağaçta` <sub>(CLAUDE.md:248)</sub>
- **[ÇEKİRDEK]** `ALTER TYPE … ADD VALUE IF NOT EXISTS` KENDİ TEK İFADELİ migration dosyasında yaşar; yeni değeri kullanan hiçbir ifade (INSERT · UPDATE · DEFAULT · CHECK · CAST) aynı dosyaya girmez ve `IF NOT EXISTS` atlanmaz — Prisma her dosyayı tek tx'te koşar, PG 55P04 canlıda `migrate deploy`i YARIDA bırakır ve dönüş yolu yedekten restore'dur. Devralınan ihlaller (12 dosyada `IF NOT EXISTS` yok, 8 dosyada karışık ifade) baseline'da DONAR ve **DÜZELTİLMEZ**: hepsi canlıda uygulanmıştır, içeriğini değiştirmek checksum'ı bozar ve sahada `migrate deploy`u durdurur — kural ileriye dönüktür. · bekçi: `scripts/test_migration_enum_add_value.ts` <sub>(arşiv:2026-09-12)</sub>
- **[ÇEKİRDEK]** Kısıt veri temizlenmeden aynı sürümde gelmez (expand → backfill → contract): sed migration'ı mükerrer varsa RAISE NOTICE ile ATLAR, deploy'u DÜŞÜRMEZ; temizlik sonrası aynı dosya yeniden koşulur (idempotent enforce); o güne dek `test_db_invariants` §1 kırmızı = 'enforce bekliyor' (bilerek). · bekçi: `Teks-Erp/scripts/test_db_invariants.ts §1 (kırmızı = enforce bekliyor)` <sub>(CLAUDE.md:78, arşiv:469, CLAUDE.md:84)</sub>
- **[ÇEKİRDEK]** Prisma'nın İKİ motoru var: sorgu WASM (platform-bağımsız), ŞEMA motoru (`migrate deploy`) NATIVE `schema-engine-<platform>`. Windows paketi `PRISMA_CLI_BINARY_TARGETS=windows`; `paketle.ps1` varlık + MZ kapısı, `kur.ps1 [1/9]` eşikten ÖNCE; yabancı motor atılır. Yeşil prova 'paket yeter' DEMEZ. · bekçi: `deploy/paketle.ps1 kapıları + deploy/kur.ps1 [1/9] — PowerShell kapıları, bekçi DEĞİL; [1/9]'u sondalayan bekçi YOK (ölçüldü 2026-09-13: kur.ps1'e değinen üç bekçinin hiçbiri [1/9]'a bakmıyor). Kesik alanın "negatif sondayla kırmızı gös…" iddiası ağaçtan DOĞRULANAMADI` <sub>(CLAUDE.md:112)</sub>
- **[ÇEKİRDEK]** 'Doğru cümlenin yanlış genellemesi' sınıfı: bir bileşenin bir boyutta platformdan bağımsız olması tüm alt bileşenleri için geçerli değildir — 'artık platformdan bağımsız' notu hangi ikilileri kapsadığını ve aynı paketin başka hangi ikilileri olduğunu söyler. <sub>(CLAUDE.md:112)</sub>
- **[ÇEKİRDEK]** Deploy sırası pazarlık dışı: BACKEND ÖNCE; sahada bir süre eski istemci koşar. Her paket notu üç kapıyı sayar (migration? izin? APK/Electron?). İstemci sunucunun İSTEDİĞİ yeni alanı göndermek zorundaysa (`confirmMismatch`) üçü BİRLİKTE; eksik alan güvenli varsayılana düşüyorsa backend tek gider. · bekçi: `yok (istemci politikası test_client_policy yalnız minVersion eksenini ölçer)` · Kapanır: `check-surum-notlari.mjs` her notun ÜÇ KAPI alanını (migration? izin? istemci?) zorunlu tuttuğunda — bugün yalnız `"migration"` bir anahtar kelime, alan değil (ölçüldü 2026-09-13). Sonda: üç alandan biri boş bir not → kırmızı. <sub>(CLAUDE.md:7, CLAUDE.md:67, CLAUDE.md:72)</sub>
- **[ÇEKİRDEK]** HER `DateTime` timestamptz: yeni alan `@db.Timestamptz` ZORUNLU, UUID kolon `@db.Uuid`. `@prisma/adapter-pg` OTURUMUN UTC OLDUĞUNU VARSAYAR → `PG_SESSION_OPTIONS` ('-c timezone=UTC') SÜS DEĞİL, SİLİNMEZ; `new Pool(` kuran her dosya geçirir (yoksa her tarih +3 saat kayar). `@db.Date` artık DÖRT alan. · bekçi: `Teks-Erp/scripts/test_timestamptz_contract.ts (TEK bekçi, dört cephe: DB · şema · sürücü · bileşik; iki yönlü = yazma/okuma turu, başlık §4)` <sub>(CLAUDE.md:285)</sub>
- **[ÇEKİRDEK]** Prod'dan gelen 'dev'de yapılacaklar' notunun TEŞHİSİ tutar; 'repoda şu var / şuraya yaz / şu bekçi yeter' cümleleri VARSAYIMDIR — uygulamadan önce her biri ölçülür (2026-08-25: 6'sı ölçümle düzeltildi). <sub>(CLAUDE.md:84)</sub>

### Yasaklar

- **[ÇEKİRDEK]** PRODUCTION CANLI ve TEKİL DEĞİL: her canlı kurulumda gerçek veri korunur — migrate reset / reseed / toplu DELETE YASAK; migration geri alınamaz kabul edilir (rollback = yedekten restore). Toplu veri düzeltme script'i dry-run varsayılan, --apply öncesi etkilenen her kaydı somut listeler. · bekçi: `yok (script başına dry-run deseni; kur.ps1 [7/9] 'GERI ALINAMAZ' yorumu :48)` · Kapanır: `argv'den --apply okuyan her script'in (popülasyon 27, ölçüldü 2026-09-13, yüklem grep -rlE 'argv.*--apply|--apply.*argv|includes("--apply")' scripts → 27; '--apply' dizgesi GEÇEN dosya 32 — aynı sayı değil) BAYRAKSIZ koşumda hiçbir yazma yoluna ulaşmadığını ölçen bir bekçi yeşil verip, bayraksız yazan sahte script sondasında kırmızı verince; yüklem 'audit çağrısı var mı' DEĞİL ulaşılan YAZMA YOLLARI (servis kapanışı dâhil) — literal arama setup-ticaret'i haksız yere ihlal gösterir` · Çapa: `test_apply_bayragi` · Öncül: ölçüldü <sub>(CLAUDE.md:119, CLAUDE.md:76)</sub>
- **[ÇEKİRDEK]** Fabrika paketi ve demo derlemesi `main`'den üretilir; müşteri dalı YOK (`adnansahin`, `feature/depo-mal-kabul` emekli); `if (musteri === 'X')` fork'un ilk sinyalidir, yasak — müşteri farkı yalnız bayrak profilinde yaşar. <sub>(CLAUDE.md:1, CLAUDE.md:1)</sub>
- **[ÇEKİRDEK]** `minVersion` sahadaki sürümden BÜYÜK OLAMAZ (en güncel istemci bile kapıda kalır, indirecek şey yok — kendini kurtaramayan tek arıza) ve yalnız GERÇEK kırılmada yükselir. Sıra: ÖNCE yeni istemci yayınlanır, SONRA minVersion'lı backend. · bekçi: `Teks-Erp/scripts/test_client_policy.ts (kayıt defterindeki her girdi)` <sub>(CLAUDE.md:7, CLAUDE.md:30)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** Altı sözleşme tetiği — uç kaldırıldı (404) · yanıt alan adı değişti (sessiz undefined) · tip/birim değişti (sessiz yanlış hesap) · zorunlu parametre (400) · enum'a değer ('altıncı enum' beş kez) · izin zorunlu (403) — 'eski istemci ne yapar' AÇIKÇA cevaplanır; bozulursa minVersion, değilse DOKUNMA. <sub>(CLAUDE.md:30)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Şema/migration işinde ölçüt en eski canlı kurulumun verisidir; prova o kurulumun dump'ı üstünde: dump restore → migrate deploy → bekçiler → profil boot. <sub>(CLAUDE.md:119)</sub>

## Backend


### Değişmezler

- **[ÇEKİRDEK]** Üç migration bekçisi üç ayrı soru sorar ve üçü de gerekir: `npm run check:migrations` (commit edildi mi) · `test_migration_hygiene.ts` (defter tutarlı mı) · `test_schema_drift.ts` (DB gerçekten şema gibi mi; iki bilinen DEFERRABLE FK dışındaki her fark kırmızı). · bekçi: `kendileri` <sub>(CLAUDE.md:248)</sub>
- **[ÇEKİRDEK]** DB'ye YAZAN bekçiler hedef-DB env-override kapısından geçer (`scripts/lib/hedef-db-kapisi`) — `.env` artık demo DB'yi gösterir, yazan test yanlış DB'ye düşmesin. · bekçi: `scripts/lib/hedef-db-kapisi.ts (kapının kendisi)` <sub>(CLAUDE.md:96)</sub>
- **[ÇEKİRDEK]** İstemci sürüm politikası tek kaynak `CLIENT_VERSION_POLICIES`: değer KODDA sabit (panelde ayar DEĞİL) · uç `GET /api/client-policy/:istemci` PUBLIC (giriş öncesi sorulur) · istemci FAIL-OPEN (bilinçli istisna) · tanımsız istemci 404, boş politika değil · yeni istemci defter satırı. · bekçi: `Teks-Erp/scripts/test_client_policy.ts` <sub>(CLAUDE.md:7)</sub>
- **[ÇEKİRDEK]** Şema değişikliği sonrası `npm run prisma:generate` ZORUNLU (Prisma 7). Aynı kural Commands, Pull-sonrası ve Version Gotchas'ta üç kez yazılı — tek satır yeter. <sub>(CLAUDE.md:400, CLAUDE.md:56, CLAUDE.md:101)</sub>
- **[ÇEKİRDEK]** Kök tsconfig yalnız `src/` (lint kapsamı 2026-09-05'te GENİŞLEDİ: `eslint src scripts prisma`) → `npm test` ÖN KOŞUL olarak `tsconfig.scripts.json` (scripts/+prisma/+src/, noEmit) geçidini koşar; tek test koşarken atlanır, acil kaçış `SKIP_TYPECHECK=1`. Build kök tsconfig ile; çıktıyı grepleyeceksen `typecheck:plain`. · bekçi: `Teks-Erp/scripts/run-all-tests.ts:176` <sub>(CLAUDE.md:86, CLAUDE.md:56)</sub>
- **[ÇEKİRDEK]** DB performans kuralları (14 madde): FK index zorunlu (audit FK'ları istisna) · composite'te eşitlik önce range sonra · sık birlikte filtre = tek composite · yüksek hacimde cursor + MAX_OFFSET=10000 · JSON sorgusuna GIN önce · include yerine select · aggregation $queryRaw · createMany · EXPLAIN. · bekçi: `yok (MAX_OFFSET guard runtime 400)` · Kapanır: KÜME olarak, tek cümleyle DEĞİL — 14 madde 14 ayrı yüklemdir ve *"mandalın tabanı ihlali ADIYLA söyleyebiliyorsa sayı değil KÜME olmalıdır"* burada da geçerli. Kapanma ölçüsü **N/14**; bugün N ÖLÇÜLMEMİŞ (anahtar kelime taraması sınırsız eşleşir — `GIN` 139 dosyada geçiyor, hiçbiri bekçi değil). İlk ölçülebilir adım: 14 maddeyi ayrı satıra bölüp her birine `bekçi:` yazmak; o satır inince bu küme satırı SİLİNİR. <sub>(CLAUDE.md:248)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Canlı DB'de index migration VARDİYA DIŞINDA deploy edilir (CREATE INDEX büyük tabloda yazma kilidi). App DB'de `statement_timeout=50s` aktif ve uzun DDL'i keser → yüz binlerce satıra index ekleyen migration'ın EN BAŞINA `SET statement_timeout = 0;`. <sub>(CLAUDE.md:248, CLAUDE.md:274)</sub>
- **[ÇEKİRDEK]** Backend izinli npm paketleri package.json ile birebir; kural 'paket ekleme, kendin yaz' (node-cron→setInterval, handlebars→kendi motor). Tek gerekçeli istisna `bonjour-service` 1.4.4 SABİT (^ yok — sonraki ana sürüm ESM-only olup require'ı sessizce kırar), tek dosyada tembel require + try/catch. <sub>(CLAUDE.md:152)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** `migrate resolve --applied` SQL'in KOŞTUĞUNU DOĞRULAMAZ (yalnız applied_steps_count=0 satırı yazar; 50s timeout'ta yarım kalan DDL ve hiç çalışmayan db execute de 'uygulandı' görünür) → resolve sonrası doğrulama (\d+ / pg_enum / pg_index.indisvalid) opsiyonel değil. · bekçi: `scripts/apply-migration.ts (doğrulama adımı içerir)` <sub>(CLAUDE.md:248, CLAUDE.md:280)</sub>
- **[ÇEKİRDEK]** `apply-migration.ts` hedefini ÖNCE `process.env.DATABASE_URL`den alır (`.env` yalnız yedek), hedefi ADIYLA basar, bağlandığı veritabanını `current_database()` ile doğrular ve `resolve` adımını AYNI URL'e kilitler. Gerekçe: SQL yolu `.env` dosyasını, `resolve` yolu Prisma üzerinden `process.env`i okuyordu → SQL bir veritabanına, defter işareti BAŞKASINA gitti (2026-09-12: DDL fabrikanın canlı yedeğine uygulandı, hedef test DB'siydi). · bekçi: `test_script_guards.ts §11` (`--apply` alan betik hedefi adıyla basar; tavan yalnız düşer) <sub>(arşiv:2026-09-12)</sub>
- **[ÇEKİRDEK]** `migrate dev` bu repoda her diff'te iki DEFERRABLE composite FK'yı (`rolls_sackId_shipmentId_consistency_fkey`, `swatches_...`) DROP etmek ister → yeni migration `--create-only` ile üretilir, `DropForeignKey` satırları SİLİNİR. Commands'taki çıplak `npx prisma migrate dev` satırı bu şerhi taşımaz. · bekçi: `Teks-Erp/scripts/test_db_invariants.ts (DEFERRABLE_FKS)` <sub>(CLAUDE.md:248, CLAUDE.md:101, CLAUDE.md:56)</sub>
- **[ÇEKİRDEK]** Prisma komutları `Teks-Erp/` İÇİNDEN koşulur; kökten koşulacaksa `--config Teks-Erp/prisma.config.ts`. 'The datasource.url property is required' hatası config'i değil .env'in bulunamamasını gösterir; prisma.config.ts dotenv'i kendi dizinine sabitler. <sub>(CLAUDE.md:101)</sub>
- **[ÇEKİRDEK]** timestamptz GERİ ALMASI ileri yönün aynası değil: iki tarih kolonunu karşılaştıran CHECK tip geçişinde oturum tz'sine duyarlı → geri alma script'i `SET timezone='UTC'; BEGIN;` ile başlar. `ALTER … TYPE timestamptz` USING'siz yazılmaz (`USING c AT TIME ZONE 'UTC'`); maliyet satırla doğrusal. <sub>(CLAUDE.md:285)</sub>
- **[ÇEKİRDEK]** Sağlık sondası: `/health` PUBLIC ve `auditGuard` alanı YOK — o alan `/api/admin/health`'te (verifyToken + admin:settings). Runbook/prod notundaki `/health | findstr auditGuard` hiç geçemez. <sub>(CLAUDE.md:84)</sub>
- **[ÇEKİRDEK]** Kurulum, paketi ÜRETENİN sohbetine değil `docs/surumler/backend-<sürüm>.md`ye dayanır: önceki saha sürümü · migration sayısı ve `[7/9]` beklentisi · sözleşme · geri alma · kurulum sonrası doğrulama listesi oradadır. Kurana talimat yazarken bu dosya kaynak alınır. ⚠️ Önceki saha sürümü TAHMİN EDİLMEZ (2026-09-10'da "2.9.6" denildi, sahadaki 2.9.7'ydi). · bekçi: `scripts/test_surum_belgesi.ts` <sub>(arşiv:2026-09-10 sürüm belgesi)</sub>
- **[ÇEKİRDEK]** `kur.ps1`de ÇIKIŞ KODLARI TOPLANMAZ: toplam bir kod değildir, hangi adımın düştüğünü söylemez ve negatif kod (Windows'ta olur) toplamı sıfıra çekip "hepsi başarılı" YALANI üretebilir → başarısızlar ADIYLA biriktirilir ve tek tek raporlanır. `pm2 delete` fresh kurulumda stderr'e "not found" yazar; satır BEKLENENdir ve çıkış kodu okunarak açıklanır (stderr yönlendirilemez). · bekçi: `scripts/test_deploy_log_rotation.ts §2` <sub>(arşiv:2026-09-10 kurulum notları)</sub>
- **[ÇEKİRDEK]** `pm2 delete` DÖNDÜĞÜNDE süreç henüz ölmemiş olabilir: kapanan node'un çalışma dizini `app\` ve tanıtıcı komut döndükten SONRA bırakılıyor → [5/9] taşıması ISRAR EDER (`TasiIsrarla`, 5 deneme × 1,5 sn) ve son denemede hatayı AYNEN fırlatır (yutulursa otomatik geri alma hiç koşmaz). Çıplak `Move-Item` yazılmaz — taşıyan dört yerin dördü de yardımcıdan geçer. 2026-09-07'de sahada bir kez düştü, önceki iki kurulumda yarış kazanılmıştı: **"çalışıyordu" bir kanıt değildi.** · bekçi: `scripts/test_deploy_move_retry.ts` <sub>(arşiv:2026-09-07 kurulum yarışı)</sub>
- **[ÇEKİRDEK]** UZUN KOŞAN dev backend başkasının migration'ıyla sessizce bayatlar: DB'ye gelen yeni enum değerini eski Prisma client P2023 ile okuyamaz, belirti 'uç 400 veriyor' — sebep ÜRETİLMİŞ CLIENT → `prisma generate` + restart. (`pkill -f "tsx src/server.ts"` YASAK — tasarım §12-12.) <sub>(arşiv:1377, CLAUDE.md:97)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Pull/yeni dev sonrası ZORUNLU sıra: npm install → prisma:generate → prisma:migrate (= migrate deploy) → dev. Pull'lanmış migration'ı `deploy` uygular, `dev` DEĞİL. generate atlanırsa TS derlenmez; migration atlanırsa P2022 ile audit sessizce kaybolur, sunucu çalışmaya devam eder. <sub>(CLAUDE.md:101, CLAUDE.md:56, CLAUDE.md:400)</sub>
- **[ÇEKİRDEK]** Kopyaya geri yükleme: yedek `<canlı>_restore_<damga>`ya yüklenir, doğrulanır, iki `ALTER DATABASE RENAME` ile takas (DATABASE_URL değişmez). Üç sezgiye aykırı kural: per-DB ayar OID'ye bağlı, rename ile TAŞINMAZ · `TEMPLATE template0` ŞART · `applied_steps_count` KULLANILMAZ. Silme allowlist'li. <sub>(CLAUDE.md:280)</sub>

### Ölçümler

- **[PROFİL]** [PROFİL] `statement_timeout=50s` DB-level `ALTER DATABASE` ile MANUEL uygulanır (migration ile değil). DB adı ortama göre: dev `tekserp_demo` (.env, port 55433), sahadaki Windows sunucu `tekserp` — adı dokümana sabitleme, `.env`'den doğrula. <sub>(CLAUDE.md:274, CLAUDE.md:96)</sub>
- **[ÇEKİRDEK]** Commands listesi BAYAT: `npm run build` = `tsc && node scripts/build-araclar.mjs` (ikinci adım yazılı değil); `npm run seed` 'test verisi' DEĞİL 'temiz fabrika kurulumu seed'i (tek kullanıcı admin + master data); listede yok: `test`, `superadmin:kur`, `seed:fixtures`, `check:migrations`. <sub>(CLAUDE.md:56)</sub>

## Panel (Electron)


### Değişmezler

- **[PROFİL]** [PROFİL] Electron paket kimliği (productName 'Adnan Şahin ERP' + appId `com.etkiliyazilim.adnan-sahin-erp`) SABİTTİR, müşteriyle türemez; `deploy/electron-paketle.sh` yalnız `shared/musteri.json` yazar. İkinci müşteride çözüm `if (musteri)` değil, kimliği musteri.json'dan türetmek (ayrı karar). <sub>(CLAUDE.md:1)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** Electron: yeni paket için ONAY. `bonjour-service` 1.4.4 sabit, `dependencies`'te durmak ZORUNDA (`externalizeDepsPlugin()` yalnız orayı okur; devDependencies'te kurulu uygulamada MODULE_NOT_FOUND); saf JS → rebuild/asarUnpack gerekmez. Tablo bayat: 4 paket eksik, `@electron/rebuild`. · bekçi: `Electron/src/test/discovery-ipc-contract.test.ts (bonjour yolu)` <sub>(CLAUDE.md:335)</sub>

## Tablet (mobil)


### Reçeteler

- **[PROFİL]** [PROFİL] APK elle kurulumunda imza uyuşmazlığı (OTA mührü) → kaldır+kur → cihaz kimliği değişir; `devicePairingRequired` AÇIKSA tablet PENDING düşer, onay ister (2026-09-04'ten beri KAPALIYSA APPROVED doğar) — sahaya çıkarken planlanır. Native değişiklik APK ister; saf JS OTA ile gider. · bekçi: `Teks-Erp/scripts/test_device_pairing_flag.ts (bayrak yolu)` <sub>(arşiv:1377, CLAUDE.md:108, CLAUDE.md:382)</sub>

## Geçersiz kılınan kurallar — bunlara UYMA

- **KISMI** `B:undated__database-performance-rules-her-zaman-uygula` → `R:2026-08-21__2026-08-21-namefold-db-seddi`: Perf kuralı 4'teki '`items`/`customers` partial'ı henüz YOK (gerekirse aynı yöntemle)' cümlesi geçersiz: 2026-08-21'den beri customers/items üzerinde partial UNIQUE (`<tablo>_nameFold_key`, `WHERE mergedIntoId IS NULL`) ve partial `mergedIntoId_idx` var; envanterde kayıtlı. Kuralın yöntem kısmı (şemada @@index bırak / @@unique kullan) yürürlükte. ✅ çürütmeden geçti
- **KISMI** `B:undated__commands` → `kök CLAUDE.md › Test Kullanıcıları › Düzeltme (2026-09-03) [küme dışı] + Electron/CLAUDE.md 'Test Kullanıcıları'`: Commands satırı `npm run seed # Test verisi yükle` bayat: seed 'temiz fabrika kurulumu seed'idir — tek kullanıcı admin/123123 + master data (kalite sınıfı, istasyon, ayar, yazıcı). Komut doğru, açıklama yanlış; 'test verisi' fixture'lar `seed:fixtures`/`seed:demo`/`seed:scenario` ayrı script'lerdir. ✅ çürütmeden geçti
- **KISMI** `B:undated__pull-sonrasi-senkronizasyon-yeni-dev-sonrasi` → `R:2026-08-25__2026-08-25-prod-un-uc`: Pull-sonrası notunun 'Production'da da aynı komut kullanılır' cümlesi yalnız KOMUT için doğru (migrate deploy); PROSEDÜR farklı: fabrika `git pull → npm run prisma:migrate` ile değil paketle (`paketle.ps1` → `kur.ps1 [7/9]`) güncellenir. 2026-08-25 §③ bu 'git pull → build' akışını DÖRT dokümanda tarihsel ilan etti. ✅ çürütmeden geçti
- **TAM** `R:2026-08-21__2026-08-21-namefold-db-seddi` → `A:2026-08-22__2026-08-22-sifirlama-rafa-kalkti`: nameFold migration'ının ilk sürümü 'mükerrer varken RAISE EXCEPTION' (deploy'u bloke eder) idi; 2026-08-22'de sıfırlama rafa kalkınca YUMUŞAK KAPI oldu — mükerrerli tabloda index NOTICE ile atlanır, deploy geçer, temizlik sonrası aynı dosya enforce eder. Deploy kuralı: kısıt veri temizlenmeden aynı sürümde gelmez. ⚠️ çürütücü itiraz etti — ihtiyatla
- **KISMI** `A:2026-08-26__2026-08-26-aksam-sebep-listesi` → `R:2026-09-04__2026-09-04-cihaz-onay-kapisi`: 2026-08-26 kurulum notu 'cihaz kimliği değişince tablet PENDING düştü, yönetici onayı istedi — sahaya çıkarken planlanmalı' o günkü kodu anlatır (her cihaz KOŞULSUZ PENDING doğuyordu). 2026-09-04'ten beri doğuş durumu bayraktan türer: `devicePairingRequired` KAPALIYSA cihaz APPROVED doğar, onay adımı yoktur; planlama adımı yalnız bayrak AÇIK kurulumda geçerli. ✅ çürütmeden geçti

## Çözülmüş çelişkiler

- `kök CLAUDE.md:104 — 2026-09-04 'En yetkili hesap GÖRÜNÜR' notu (küme dışı, süperadmin kümesi)` ↔ `Teks-Erp/scripts/build-araclar.mjs + deploy/paketle.ps1 + deploy/kur.ps1 (2026-09-04 ev provası BULGU-2)`: Kod: araç sunucu paketine GİRER (`dist/tools/superadmin-olustur.cjs`, paket kapısı zorunlu kılar) ama `src/` dışında ayrı derlenir ve `dist/server.js` onu HİÇ import etmez — yani 'sunucu RUNTIME'ına/route'a bağlanamaz' doğru, 'paketine girmez' yanlış. Kök cümle 'sunucu koduna girmez, pakette ayrı araç olarak durur' diye düzeltilmeli.
- `B:undated__commands` ↔ `B:undated__database-performance-rules-her-zaman-uygula`: Perf kuralı 4 geçerli: yeni migration `npx prisma migrate dev --create-only` ile üretilip DropForeignKey satırları elle silinir; Commands satırı şerhsiz ve eksik anlatıyor — `--create-only` notu Commands'a taşınmalı.

## Açık sorular

- Backend sürüm ekseni (`backend-v*`, scripts/backend-surum.mjs, commit 61d3651d 2026-09-04) kök 'Sürüm Yayınlama' bölümünde ve `scripts/test_surum.mjs` kapsamında yok — bekçi backend'i ölçüyor mu BELİRSİZ (surum.mjs:60 yalnız panel/tablet kalıbı).
- Pull-sonrası notu (Teks-Erp/CLAUDE.md:103) 'migrate dev atlanırsa … P2022' derken aynı not 'deploy uygular, dev DEĞİL' der — aynı not içinde terim tutarsızlığı; ezilme değil, metin düzeltmesi.
- Teks-Erp/CLAUDE.md:147 middlewares listesi bayat (15 dosyanın 8'i listede yok) — deploy kuralı değil, Architecture özeti; bu kümeden karar verilmedi.

## Doğrulama turu ekleri (eski CLAUDE.md ↔ yeni yapı karşılaştırması, 2026-09-05)

- **[ÇEKİRDEK]** Geri yükleme KOPYALARINDA otomatik retention YOKTUR ve `_old_` veritabanlarının silme ucu YOK — temizlik elle yapılır (silme allowlist'i `isRestoreCopyName`). <sub>(eski Teks-Erp/CLAUDE.md Operasyonel Bakım)</sub>

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (tek testte tip kapısı atlanır) · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`.

**Ne ölçtükleri, DB gerektirip gerektirmedikleri ve bayatlık işaretleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → bu alanın bölümü.** ⚠️ = orada gerekçesi yazılı bayatlık şüphesi.

Backend: `test_audit_depth`, `test_audit_followups`, `test_backend_surum`, `test_barcode_reservation`, `test_batch_number_format`, `test_cash_period_close`, `test_check_violation_mapping`, `test_client_policy`, `test_client_registry`, `test_db_copy`, `test_db_invariants`, `test_fold_contract`, `test_guarded_hard_remove`, `test_hard_delete_guard_coverage`, `test_master_data_merge_fk_coverage`, `test_master_data_merge_race`, `test_master_data_name_dup`, `test_migration_hygiene`, `test_mobile_update`, `test_module_grandfathering`, `test_offsite_sweep`, `test_phase6_reporterror_concurrency`, `test_qc2_idempotency`⚠️, `test_quality_scorecard`, `test_raw_sql_hygiene`, `test_record_provenance`, `test_report_day_boundary`, `test_roll_barcode`, `test_roll_entry_station`, `test_schema_drift`, `test_script_guards`, `test_timestamptz_contract`, `test_traveler_print_active_card`, `test_yarn_stock`

İstemci: `GuncellemeDugmesi.test.tsx`⚠️, `surum-notlari.test.ts`⚠️, `version-compare.test.ts`⚠️, `clients-utils.test.ts`, `update-check-interval.test.ts`, `update-feed-url.test.ts`, `update-gate-escape.test.ts`, `UpdateActions.test.tsx`, `appUpdate.service.test.ts`, `clientPolicy.service.test.ts`, `surumNotlari.test.ts`, `update-feed-url.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-08-26 · 2026-08-26 (akşam) — Sebep listesi büyüyünce Kaydet ekran dışında kalıyordu + sıra artık sürüklenerek KALICI — `CLAUDE-NOT-ARSIVI.md:1377-1444`
- 2026-09-04 · 2026-09-04 — [ÇEKİRDEK] Prisma'nın İKİ motoru var ve yalnız biri platformdan bağımsız — `CLAUDE-NOT-ARSIVI.md:2639-2681`