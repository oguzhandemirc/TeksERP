# Geliştirme döngüsü — yerel çalışma

> Koddan çıkarıldı (anlama turu 2026-09-05). ⚠️ olanlar o güne dek belgesizdi. Sunucu süreci kuralı: `pkill -f "tsx src/server.ts"` YASAK — kendi başlattığın süreci PID ile durdur ya da ayrı port kullan (MODUL-BAYRAK-TASARIM §12-12).

## Adımlar

1. Node >= 22 kullan (backend engines şartı). <sub>(Teks-Erp/package.json:4-6 "engines": { "node": ">=22" }; .github/workflows/ci.yml:86 node-version: 22)</sub> — atlanırsa: Eski Node'da tsx/Prisma 7 çalışmaz; hata mesajı sürüm sebebini söylemez.
2. Dev veritabanı Docker konteyneri `tekserp-local-db` ayakta olmalı (55433->5432). <sub>(docker ps: 'tekserp-local-db  0.0.0.0:55433->5432/tcp  Up 2 days'; Teks-Erp/CLAUDE.md:138 aynı konteyneri adlandırır)</sub> — atlanırsa: Tüm bekçiler ECONNREFUSED'a düşer; run-all-tests bunu 'altyapı hatası' sayıp 1 kez yeniden dener (run-all-tests.ts:180-187), sonra kırmızı.
3. `Teks-Erp/.env` var olmalı ve DATABASE_URL yerel `tekserp_demo`yu göstermeli (PORT=4000). <sub>(Teks-Erp/.env:4-8 (PORT=4000, DATABASE_URL=...@localhost:55433/tekserp_demo, JWT_SECRET, BACKUP_DIR))</sub> — atlanırsa: src/lib/prisma.ts:19 'DATABASE_URL is not set' ile ÇÖKER (gürültülü); ama .env yanlış DB gösterirse bekçiler o DB'ye 1.539 deleteMany gönderir.
4. Komutlar `Teks-Erp/` dizini İÇİNDEN koşulur — dotenv CWD'ye bakar. <sub>(Teks-Erp/src/lib/prisma.ts:14 dotenv.config(); Teks-Erp/prisma.config.ts:14 loadEnv({ path: path.join(__dirname, ".env"))</sub> — atlanırsa: Kökten koşulan prisma komutu 'The datasource.url property is required in your Prisma config file' verir; mesaj config'i suçlar, gerçek sebep .env bulunamamasıdı
5. Şema/pull sonrası: npm install → npm run prisma:generate → npm run prisma:migrate (migrate deploy). <sub>(Teks-Erp/package.json:19-20 (prisma:generate = prisma generate, prisma:migrate = prisma migrate deploy); Teks-Erp/CLAUDE)</sub> — atlanırsa: generate atlanırsa TS 'Property X does not exist'; migrate atlanırsa runtime P2022 ve audit best-effort olduğu için log SESSİZCE kaybolur, sunucu ayakta kalır (
6. Pull'lanmış migration'ı `migrate deploy` uygular; `npx prisma migrate dev` KULLANILMAZ. <sub>(Teks-Erp/CLAUDE.md:112; Teks-Erp/CLAUDE.md:257 (`migrate dev` iki DEFERRABLE composite FK'yı her diff'te DROP etmek iste)</sub> — atlanırsa: migrate dev üretilen diff'te rolls_sackId_shipmentId_consistency + swatches FK'larını düşürür; bütünlük seddi sessizce kalkar.
7. İlk kurulumda seed İKİ komuttur: npm run seed + npm run seed:fixtures. <sub>(Teks-Erp/package.json:11-12; .github/workflows/ci.yml:95-105 (ayrı ve ZORUNLU adım: 'Bu adım eksikti → backend testlerin)</sub> — atlanırsa: PATOS/MAVI/MUS-001 iş fixture'ları doğmaz → 73 bekçi 'Seed fixture eksik' ile düşer; kök README'nin hızlı başlangıcı bu adımı hiç anmaz.
8. Seed TEK kullanıcı üretir: admin / 123123 (tam yetki). <sub>(Teks-Erp/prisma/seed.ts:128-135 (username: "admin", hashPassword("123123")); seed.ts:695 çıktı satırı 'Tam yetki (tek se)</sub> — atlanırsa: Kök CLAUDE.md'deki 'admin dışı tüm kullanıcılar test123' cümlesine güvenip var olmayan kullanıcıyla login denenir.
9. Seed komutu prisma.config.ts üzerinden ts-node ile koşar (tsx değil). <sub>(Teks-Erp/prisma.config.ts:20 seed: "npx ts-node --project prisma/tsconfig.json prisma/seed.ts")</sub> — atlanırsa: prisma/tsconfig.json silinirse/adı değişirse seed ilk satırda ölür; check-migrations GATE 5 yalnız package.json script'lerinin andığı dosyaları tarar.
10. Sunucu: `npm run dev` = nodemon + ts-node (hot reload); ajan/bekçi yolu ise `PORT=<port> npx tsx src/server.ts` (hot reload YOK). <sub>(Teks-Erp/package.json:9; Teks-Erp/scripts/test_settings_password.ts:64 ve test_superadmin.ts:68 ('PORT=4112 … npx tsx sr)</sub> — atlanırsa: tsx ile başlatılan sunucuda kaynak değişikliği yansımaz → HTTP ayaklı bekçi ESKİ kodu ölçer ve 'yeşil' der (test_superadmin.ts:79'da ölçüldü).
11. Varsayılan port 4000, host 0.0.0.0 (HOST/PORT env ile değişir). <sub>(Teks-Erp/src/server.ts:23 const PORT = process.env.PORT || 4000; server.ts:26 const HOST = process.env.HOST || "0.0.0.0")</sub> — atlanırsa: HOST=127.0.0.1 verilirse tablet LAN'dan bağlanamaz; belirti 'sunucu yok' gibi görünür.
12. Sunucuyu durdururken YALNIZ kendi PID'ini öldür; `pkill -f "tsx src/server.ts"` YASAK. PID: lsof -iTCP:4000. <sub>(docs/design/MODUL-BAYRAK-TASARIM.md:314-318 (§12-12); docs/history/GECE-KARARLARI-2026-09-03.md:15 (pid `lsof -iTCP:4000`)</sub> — atlanırsa: Aynı komut satırını paylaşan kullanıcının :4000 dev sunucusu da düşer (iki ajan, iki turda ölçüldü) ve kimse fark etmez.
13. Paralel ajan/oturum başına AYRI port ver (4100 paylaşımı sahte kırmızı üretti). <sub>(docs/design/MODUL-BAYRAK-TASARIM.md:317-318; docs/history/CLAUDE-NOT-ARSIVI.md:2053 (aynı port + aynı test DB → sahte kı)</sub> — atlanırsa: İki koşum birbirinin global ayarını ezer; bekçi kırmızısı gerçek regresyon sanılır.
14. Tam paket: `npm test` = tsx scripts/run-all-tests.ts (455 test_*.ts dosyası, SIRALI). <sub>(Teks-Erp/package.json:27; scripts/run-all-tests.ts:59-62 (readdirSync + /^test_.*\.ts$/); ls scripts/test_*.ts | wc -l → 455, ölçüldü 2026-09-05)</sub> — atlanırsa: -
15. `npm test` iki geçitten geçer: (1) productionDbGate — DATABASE_URL host'u localhost/127.0.0.1/::1/0.0.0.0 değilse DURUR (fail-closed), NODE_ENV/APP_ENV=production hiç geçmez; kaçış ALLOW_NONLOCAL_TEST_DB=1. (2) typecheckGate ~28sn. <sub>(scripts/run-all-tests.ts:102-165 (kapı), :174 çağrı, :142-146 YEREL kümesi, :148-155 kaçış, :111-118 production reddi; :)</sub> — atlanırsa: Kapı olmasa 1.539 deleteMany canlı DB'ye giderdi; tip hatası varken paket 'yeşil ama anlamsız' olurdu.
16. Tek bekçi iki yoldan koşar: `npx tsx scripts/test_X.ts` (kapı YOK) veya `npx tsx scripts/run-all-tests.ts <filtre>` (DB kapısı VAR, tip geçidi ATLANIR). <sub>(Teks-Erp/CLAUDE.md:356; scripts/run-all-tests.ts:170 (filter = process.argv[2]), :174-176 (kapı filtreden bağımsız, tipc)</sub> — atlanırsa: Doğrudan tek-dosya koşumu yanlış DATABASE_URL ile canlı veriye yazabilir; hiçbir uyarı çıkmaz.
17. SKIP_TYPECHECK=1 tip geçidini tamamen kapatır (acil kaçış). <sub>(scripts/run-all-tests.ts:176 (!process.env.SKIP_TYPECHECK); Teks-Erp/CLAUDE.md:88)</sub> — atlanırsa: Tip driftli test paketi yeşil raporlanır (2026-08-01'de 87 tip hatası bu şekilde gizlenmişti).
18. Bayrak/veri YAZAN bekçiler hedef-DB kapısından geçer: DB adı tekserp/tekserp_prod/adnansahin_db ise BEKCI_PROD_ONAY=1 istenir. <sub>(Teks-Erp/scripts/lib/hedef-db-kapisi.ts:13-17 (YAZILMASI_YASAK_DB), :29-37 (hedefDbEngeli); tüketiciler test_module_flag)</sub> — atlanırsa: Bayrak yazan bekçi fabrikanın modül anahtarlarını değiştirir; belirti günler sonra 403 olarak çıkar.
19. HTTP ayaklı 5 bekçi ayrı bir sunucu ister ve her biri KENDİ portunu bekler: finance 4100, module_flag_off 4101, superadmin 4104, settings_password 4112, module_profile 4122; TEST_API_URL ile değiştirilir. <sub>(scripts/test_finance_flag_off.ts:32 · test_module_flag_off.ts:90 · test_superadmin.ts:149 · test_settings_password.ts:13)</sub> — atlanırsa: Sunucu ayakta değilse HTTP bölümleri SESSİZCE atlanır (test_finance_flag_off.ts:114, test_module_flag_off.ts:517) — bekçi yeşil kalır, kapsam düşer.
20. Tip kontrolü iki kapsam: `npm run typecheck` (yalnız src/) ve `npm run typecheck:scripts` (scripts+prisma+src — npm test'in geçidi). Hüküm ÇIKIŞ KODUNDAN verilir, grep'ten değil. <sub>(Teks-Erp/package.json:23-26; tsconfig.json:15 include ["src/**/*"]; tsconfig.scripts.json:31 include [scripts,prisma,src)</sub> — atlanırsa: `| grep "error TS"` HİÇBİR ZAMAN eşleşmez → 6 tip hatası 'temiz' raporlandı (CLAUDE.md:77).
21. Elle yazılan migration `npx tsx scripts/apply-migration.ts <ad> [--apply]` ile uygulanır (dry-run varsayılan; git add → db execute → resolve → doğrula). <sub>(Teks-Erp/CLAUDE.md:258; Teks-Erp/scripts/apply-migration.ts:41-45 (.env'den DATABASE_URL okur))</sub> — atlanırsa: Migration dev'e uygulanır ama commit edilmez → production'da kolon hiç oluşmaz, deploy 'başarılı' der (2026-07-30 vakası).
22. Yerel hijyen: `npm run check:migrations` (untracked/modified migration, untracked test_*.ts, package.json'ın andığı eksik dosya) — değeri YEREL, CI'da hep yeşil. <sub>(Teks-Erp/package.json:30; scripts/check-migrations.mjs:20-33 (GATE 1-5), :39-40 ('Bu bekçinin değeri YERELDEDİR'))</sub> — atlanırsa: Commit edilmemiş migration/test temiz checkout'ta yok olur; CI'ın P2022 kapısı da kaybolur.
23. Üç projeyi tek komutta doğrula: `bash run-tests.sh` (+ `--tsc`). <sub>(run-tests.sh:22-24 (backend/Electron/mobil npm test), :26-30 (--tsc dalı))</sub> — atlanırsa: -
24. Commit kapısını BİR KEZ kur: `node scripts/hooks-kur.mjs` (`git config core.hooksPath .githooks`; durum `--durum`, kaldırma `--kaldir`). Kapı DEĞİŞENE ORANTILIDIR: dokunulan her alt proje için tip + lint + lint tavanı (`scripts/check-lint-baseline.mjs`) ve o projenin HIZLI test paketi (Electron vitest ~27 sn / mobil jest ~17 sn; backend bekçi paketi commit kadansında DEĞİL, PR/push öncesidir); `Teks-Erp/prisma|scripts` sahnelendiyse `check-migrations.mjs`, `.md` sahnelendiyse `check-docs.mjs` eklenir. Kaçış: `TEKSERP_HOOK_SKIP=1 git commit …` ya da `git commit --no-verify` — kaçış bir KARARDIR, commit mesajında söylenir. <sub>(scripts/hooks-kur.mjs:26-30; .githooks/pre-commit:4; scripts/hooks/pre-commit.mjs:32-35 (kaçış), :43-66 (adım kurgusu))</sub> — atlanırsa: `.git/hooks` versiyonlanmaz, yani kapı kurulmamış her klonda HİÇ git kapısı yoktur; 2026-09-05 ölçümünde main'de 9 tip hatası + 7 kırmızı test bir gün durdu ve CI de yakalamadı.
25. Electron dev: `cd Electron && npm run dev` (electron-vite dev, renderer 5174); API adresi VITE_API_BASE_URL, yoksa http://localhost:4000. <sub>(Electron/package.json:14; Electron/electron.vite.config.ts:50 server: { port: 5174 }; Electron/src/services/apiClient.ts)</sub> — atlanırsa: Electron'da yerel `.env` yok (ls: yalnız .env.example + .env.production) → dev fallback ile localhost:4000'e gider; backend kapalıysa panel boş ekran/ağ hatası 
26. mobil dev: `npx expo start` / `npx expo run:android` (BLE için native build ZORUNLU); `npm run dev` ayrıca `adb reverse tcp:8081 tcp:8081` koşar. <sub>(mobil/package.json:7-9; mobil/CLAUDE.md:9-17 ('BLE Expo Go'da çalışmaz'))</sub> — atlanırsa: Expo Go'da BLE ekranları sessizce çalışmaz; adb reverse yoksa Metro'ya bağlanamaz.
27. mobil API adresi: DEV'de Metro host'undan türetilir, yoksa EXPO_PUBLIC_API_URL, o da yoksa http://localhost:4000/api. <sub>(mobil/src/constants/api.ts:15-20 (devHost ? http://devHost:4000/api : envApiUrl ?? http://localhost:4000/api); mobil/.en)</sub> — atlanırsa: Emülatör/localhost dalında cihaz kendi localhost'una gider → 'sunucu yok' gibi görünür; EXPO_PUBLIC_API_URL verilmediği fark edilmez.

## ⚠️ Belgesizdi

- Dev DB'nin nasıl ayağa kalktığı hiçbir yerde YAZILI DEĞİL: `tekserp-local-db` konteynerini kuran/başlatan komut yok; ad yalnız bayatlık şerhi içinde geçiyor (Teks-Erp/CLAUDE.md:138). Yeni makinede döngü ilk adımda durur.
- Yerel ilk kurulumda `npm run seed:fixtures` ZORUNLU olduğu hiçbir kurulum talimatında yok — README.md:35 yalnız `npm run seed` der; zorunluluk yalnız CI yorumunda (.github/workflows/ci.yml:97-103) ve CLAUDE.md:393'te 'CI seed'i' parantezi olarak geçer.
- README.md:35 hızlı başlangıcı `npx prisma migrate dev` önerir; Teks-Erp/CLAUDE.md:112/257 aynı komutu iki DEFERRABLE FK'yı düşürdüğü için REDDEDER. İki doküman ters şey söylüyor, uzlaştıran cümle yok.
- Sunucuyu YENİDEN BAŞLATMANIN doğru yolu (kendi PID'ini sakla, `lsof -iTCP:4000`, ayrı port) yalnız tasarım dokümanı §12-12 ve gece raporlarında; hiçbir CLAUDE.md'de ya da geliştirme bölümünde yok.
- `npm run dev` (nodemon+ts-node, hot reload) ile pratikteki `npx tsx src/server.ts` (hot reload YOK) ayrımı hiçbir belgede yok; 'kaynağı değiştirdim, HTTP bekçisi hâlâ eski kodu ölçüyor' tuzağı yalnız test_superadmin.ts:79 yorumunda.
- HTTP ayaklı beş bekçinin ayrı sunucu istediği ve her birinin FARKLI varsayılan portu (4100/4101/4104/4112/4122) hiçbir dokümanda derli toplu yok; sunucu yoksa bölümlerin SESSİZCE atlandığı da yazılmamış.
- `BEKCI_PROD_ONAY=1` ve `ALLOW_NONLOCAL_TEST_DB=1` kaçış anahtarları yalnız kodda + arşiv/audit anlatısında; hiçbir geliştirme talimatında yok (`SKIP_TYPECHECK` sadece CLAUDE.md:88'de var).
- Tek-dosya bekçi koşumunun (`npx tsx scripts/test_X.ts`) productionDbGate'ten GEÇMEDİĞİ uyarısı yalnız audit haritasında (K11:27); CLAUDE.md:356 bu yolu uyarısız önerir.
- `Teks-Erp/.env.example:31` ve `example-env.txt:2` hâlâ `adnansahin_db@localhost:5432` gösteriyor — gerçek dev hedefi `tekserp_demo@localhost:55433` (.env:5). Şablonu kopyalayan yeni geliştirici var olmayan DB'ye bağlanır.
- mobil/CLAUDE.md:253-255 sabit `API_URL` örneği veriyor; gerçek çözüm zinciri (devHost → EXPO_PUBLIC_API_URL → localhost) src/constants/api.ts:15-20'de ve dokümanda hiç yok.
- mobil `npm run dev`in `adb reverse tcp:8081 tcp:8081` koştuğu mobil/CLAUDE.md komut listesinde yok (yalnız `npx expo start` var).
- Electron'da yerel `.env` bulunmadığı ve dev'in apiClient.ts:41 fallback'iyle localhost:4000'e gittiği yazılı değil; Electron/CLAUDE.md:27 bir `.env` varmış gibi anlatır.
- `prisma/tsconfig.json` üzerinden ts-node ile koşan seed yolu (prisma.config.ts:20) hiçbir belgede yok — seed'in neden tsx değil ts-node olduğu bilinmiyor.
- Tek bir 'geliştirme ortamı' belgesi YOK: adımlar dört CLAUDE.md, README, ARCHITECTURE, ci.yml, tasarım dokümanı ve gece raporlarına dağılmış.

## Belgelendiği yerler

- `Teks-Erp/CLAUDE.md` — tam
- `Teks-Erp/CLAUDE.md` — kısmi
- `README.md` — kısmi
- `Teks-Erp/ARCHITECTURE.md` — kısmi
- `Teks-Erp/ARCHITECTURE.md` — tam
- `Teks-Erp/.env.example` — bayat
- `Teks-Erp/example-env.txt` — bayat
- `Electron/CLAUDE.md` — tam
- `mobil/CLAUDE.md` — kısmi
- `mobil/CLAUDE.md` — bayat
- `Teks-Erp/API_TEST_GUIDE.md` — kısmi
- `run-tests.sh` — tam
- `.github/workflows/ci.yml` — tam
- `docs/design/MODUL-BAYRAK-TASARIM.md` — tam
- `docs/history/GECE-KARARLARI-2026-09-03.md` — hikâye-içinde
- `docs/history/CLAUDE-NOT-ARSIVI.md` — hikâye-içinde
- `audit/00-map/K11-bekci-envanteri.md` — tam
- `audit/surface/09-test-durumu.md` — hikâye-içinde
- `Teks-Erp/baslat.sh` — kısmi