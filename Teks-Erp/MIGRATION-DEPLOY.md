# Production Migration Deploy Notu

> ⚠️ **TARİHSEL — deploy yolu 2026-08-24'te değişti.** Aşağıdaki `git pull → build →
> migrate` akışı fabrikada **artık uygulanmıyor**: çalışan kurulum `C:\Etkili-Yazilim\app\`
> altındaki hazır pakettir ve `kur.ps1` ile kurulur (yedek + migrate + pm2 sırasını script
> yapar). Güncel akış **`docs/ops/DEPLOY-RUNBOOK.md §3`** + `deploy/README.md`. Bu dosyanın
> geri kalanı (gerekçeler, sıra teyidi, kontrol maddeleri) bilgi olarak duruyor.

Geliştirme (dev) DB'sine uygulanan migration'lar production'a (üretim DB'si
`TeksErpDb`, ya da hangi ortamsa) **`prisma migrate deploy` ile** taşınır.
`migrate dev` PRODUCTION'da ASLA çalıştırılmaz (reset riski).

## Standart deploy sırası (KANONİK)

```bash
# Production sunucuda, uygulama dizininde:
git pull                       # yeni migration dosyaları gelir
npm ci                         # ⚠️ `npm install` DEĞİL — aşağıya bak
npm run prisma:generate        # = prisma generate (client yenilensin; tsc buna karşı derler)
npm run build                  # tsc → dist/   ← DB'ye DOKUNMAZ; patlarsa TEMİZ ABORT
npm run prisma:migrate         # = prisma migrate deploy  ← GERİ ALINAMAZ, bu yüzden EN SON
pm2 restart tekserp-backend
pm2 save
```

> **⚠️ pm2 süreç adı `tekserp-backend`** (2026-08-15'te canlı `pm2 list` ile doğrulandı).
> Bu dosya eskiden `teks-erp-backend`, başka bir belge `tekserp-api` diyordu — **ikisi de
> YANLIŞ**. O adlarla komut `[PM2][ERROR] process not found` der ve **sıfır kodla çıkmaz
> ama hiçbir şey de yapmaz**: deploy eden "restart ettim" sanır, oysa migration uygulanmış
> hâlde ESKİ kod koşmaya devam eder. Kontrol: `pm2 list` çıktısındaki `name` sütunu.

> **⚠️ `npm ci`, `npm install` DEĞİL.** `package.json` caret taşır (`^7.7.0`); `npm install`
> o gün registry'de ne varsa ona çözer ve üretim deterministik olmaktan çıkar. `npm ci`
> `package-lock.json`'ı birebir kurar. **`--omit=dev` HİÇBİR KOŞULDA** — `prisma.config.ts`
> `ts-node`'a, veri göçü script'leri `tsx`'e (devDependency) bağlı. `npm ci` `node_modules`'ü
> sildiği için ardından `prisma:generate` zorunludur (yukarıdaki sırada zaten var).

> **Sürüme özel adımlar** (veri göçü, izin atama, duyuru) ayrı dosyalarda:
> `docs/ops/DEPLOY-2.7.0.md`. Migration'a ek olarak koşulması gereken bir veri göçü varsa
> onu ATLAMAK sessiz gerileme üretir — sürüm notunu okumadan deploy etme.

> **⚠️ `build`, `migrate`'ten ÖNCE (2026-07-30 kararı — sıra DÜZELTİLDİ).**
> Bu dosya eskiden `migrate → build` diyordu; `DEPLOY-RUNBOOK.md` ve
> `URETIM-KONTROL-LISTESI.md` ise `build → migrate`. Doğrusu **`build → migrate`**:
>
> | Sıra | `build` patlarsa | `migrate` patlarsa |
> |---|---|---|
> | generate→**migrate**→build | **DB göç etmiş, deploy edilebilir kod YOK** → ileri gitmek için tsc'yi sahada düzeltmek, geri gitmek için YEDEKTEN RESTORE gerekir | DB bozulmadı, temiz abort |
> | generate→**build**→migrate | **DB'ye hiç dokunulmadı, eski süreç koşuyor** (0 risk) | `dist/` yeni ama `pm2 restart` hiç olmadı → eski kod koşuyor, temiz abort |
>
> Kural: **geri alınamaz adım (`migrate deploy`) atomik cut-over'ın (`pm2 restart`)
> hemen öncesine.** `build` (tsc) DB'ye dokunmaz ve tip hatasıyla patlaması normaldir.
> `migrate` ile `restart` arasındaki pencerede ESKİ kod YENİ şemaya karşı koşar; bu
> yalnızca EKLEMELİ migration'larda (nullable kolon, enum değeri, index) güvenlidir —
> kolon/enum SİLEN bir migration varsa önce `pm2 stop`.

`migrate deploy` yalnız `_prisma_migrations` tablosunda OLMAYAN migration'ları,
dosya sırasıyla uygular. Idempotent — tekrar çalıştırmak güvenli.

> **Sıra teyidi (2026-06-13):** Yukarıdaki dört adım (`git pull → npm install →
> prisma:generate → prisma:migrate`) güncel package.json script'leriyle birebir
> uyumludur: `prisma:generate` = `npx prisma generate`, `prisma:migrate` =
> `npx prisma migrate deploy`. **`generate` her güncellemede gereklidir.**
> (2026-07-30: eskiden Windows installer yolunda Prisma client `build.ps1`
> derlemesinde `node_modules`'a gömüldüğü için `generate` atlanabiliyordu —
> installer kaldırıldı, artık tek yol var ve `generate` atlanamaz.)

> **glibc collation NOTU (sıralı numara üreticileri — düzeltildi):** Günlük/
> ardışık numara üreten servisler (sevkiyat `shipmentNo`=SVK, çuval `sackNo`=CV,
> sipariş `orderNumber`=SIP, iş emri `workOrderNumber`=IE, parti `batchNumber`=P,
> fason `dispatchNo`/`receiptNo`/`manifestNo`, müşteri/özellik `code`; tümü
> `PREFIX+GGAAYY+NNNN`) eskiden üst sınırı `lt: prefix + "￿"` (U+FFFF) ile
> arıyordu. Bu, U+FFFF'i "en yüksek karakter" sayar — macOS libc'de doğru, ama
> **Linux glibc** (ve glibc tabanlı üretim sunucuları) altında U+FFFF *ignorable*
> olduğundan o günün son numaraları aralık dışında kalır, "bugün kaç numara
> verildi" sorgusu eksik sayar ve **sevk/sipariş/çuval numaraları sessizce
> çakışırdı**. NİHAİ fix `gte: prefix` (her collation'da güvenli alt sınır +
> index seek) **+** `startsWith: prefix` (collation'dan bağımsız LIKE 'prefix%'
> tam-prefix filtresi) kombinasyonudur. Bu desen artık ortak
> `src/utils/code-format.ts` yardımcılarında (`dailyCodePrefix` + `nextDailySeq`)
> merkezîleşti; tüm günlük-numara üreticileri (shipping / order / workorder /
> batch / subcontractor / customer / fabric-property / kartela servisleri) bu
> yardımcıyı çağırır. Sonuç: production artık **Linux glibc'de güvenli**; CI'da
> bu bug 6 sevkiyat testini patlatmıştı, fix sonrası yeşil.
> **Eski sürüm Linux'a deploy edilmemelidir** (numara çakışması riski).
> (NOT: eski `AMB%05d`/`AMB{SIRA:5}` çuval manuel-kod şablonu 2026-07-12'de
> tümüyle kaldırıldı — çuval artık yalnız `sackNo`=CV ile yürür.)

## Elle yazılan migration'ı DEV'e uygulama (`db execute` + `migrate resolve`)

⚠️ **YALNIZ DEV.** Production'da TEK yol `migrate deploy`'dur (yukarıdaki kanonik sıra).

`prisma migrate dev` bu şemada YASAK: `sacks` tablosundaki 2 DEFERRABLE composite FK
datamodel'de temsil edilemediği için her diff'te DROP edilmek istenir
(`schema.prisma` `@@unique([id, shipmentId])` bloğu). Bu yüzden migration ELLE yazılır:

```bash
# 0) ÖNCE GİT — dosya UYGULANMADAN önce izlenir olmalı
git add prisma/migrations/<zaman>_<ad>/migration.sql

# 1) SQL'i dev DB'sine uygula   (Prisma 7: prisma.config.ts var → --schema VERİLMEZ)
npx prisma db execute --file prisma/migrations/<zaman>_<ad>/migration.sql

# 2) Prisma'ya "uygulandı" olarak bildir (deploy'da tekrar denemesin)
npx prisma migrate resolve --applied <zaman>_<ad>

# 3) DOĞRULA — 2. adım SQL'in koştuğunu doğrulaMAZ (aşağıdaki uyarı)
npx tsx scripts/test_migration_hygiene.ts
node ../scripts/check-migrations.mjs
psql "$DATABASE_URL" -c '\d+ <tablo>'      # kolon gerçekten var mı
```

> **⚠️ 0. ADIM NEDEN VAR (2026-07-30'da kaybedildi):** üç migration dev'e uygulandı
> ama git'e HİÇ girmedi. Dev tarafında her şey normal görünüyordu (dizinde var +
> `_prisma_migrations`'ta "uygulandı"); eksik olan tek şey commit'ti ve bunu hiçbir
> mekanizma söylemiyordu. `migrate deploy` yalnız dizindeki dosyaları uygular →
> production'da kolon/enum hiç oluşmaz, deploy "All migrations have been successfully
> applied" der ve o kolonu okuyan HER yol P2022/500 verir. Artık iki bekçi var:
> `npm run check:migrations` (git tarafı) + `scripts/test_migration_hygiene.ts` (DB tarafı).
>
> **⚠️ `migrate resolve --applied` SQL'İN KOŞTUĞUNU DOĞRULAMAZ** — yalnız
> `_prisma_migrations`'a `applied_steps_count = 0` ile satır yazar. `statement_timeout`
> ile yarıda kesilen bir DDL de sessizce "uygulandı" görünür (D-23). 3. adım bu yüzden
> **opsiyonel değildir**; `test_migration_hygiene.ts` elle-resolve edilmişleri listeler.

## ⚠️ Index-ağırlıklı migration'lar — VARDİYA DIŞINDA

`CREATE INDEX` büyük tabloda yazma kilidi alır (milyon satırda dakikalarca) ve
app DB'sinde `statement_timeout=50s` aktif olduğundan **uzun DDL 50s'de İPTAL olur**.
Yüz binlerce+ satıra index ekleyen migration'ın EN BAŞINA `SET statement_timeout = 0;`
konmalı (drift-free migration'lara elle eklenebilir) ve **gece/hafta sonu** deploy
edilmeli. Boş/yeni kurulumda risk yok.

İlgili index migration'ları (mevcut): `20260612100000_repartialize_after_native_uuid`,
`20260612102000_dashboard_report_date_indexes`,
`20260612120000_missing_fk_indexes_routestep_rollreturn`. Bunlar küçük/orta
tabloda hızlıdır ama hacim büyüdükçe yukarıdaki kural geçerlidir.
(`20260613101000_sack_manual_code_index` eskiden buradaydı ama `sacks.manualCode`
kolonu 2026-07-12'de düşürüldü — `20260712120000_drop_sack_manual_code`; index
artık DB'de yok.)

## Bu oturumda dev'e uygulanan, production'a gidecek migration'lar (2026-06-13)

| Migration | İçerik | Tablo boyutu/risk |
|---|---|---|
| `20260613100000_route_step_subcontractor_planning` | RouteStep'e fason alanları + 2 FK index | küçük (route_steps) — hızlı |
| `20260613101000_sack_manual_code_index` | sacks.manualCode index | orta — hacimde vardiya dışı |
| `20260613110000_shipment_destination` | ShipmentDestination enum + shipments.destination (default DOMESTIC) | ALTER + default — hızlı |
| `20260613111000_shipment_procedure_code` | shipments.procedureCode kolonu | hızlı |
| `20260613112000_machine_hardware` | machine_hardware tablosu + FK + unique index | yeni tablo — anında |

Hepsi geri-uyumlu (yeni kolon/tablo nullable veya default'lu); mevcut veriyi bozmaz.

> **Sonraki gelişme (tarihsel not):** Yukarıdaki tablodan iki migration daha sonra
> geri alındı — bu doküman güncel şemayı yansıtsın diye: `machine_hardware` tablosu
> `20260629130000_drop_machine_hardware` ile düşürüldü (saha donanımının tek kaynağı
> artık `PeripheralDevice`), `sacks.manualCode` index+kolonu ise
> `20260712120000_drop_sack_manual_code` ile kaldırıldı. Bu iki nesne **artık
> şemada yok** — deploy sırasında da migrate zinciri kendini düzeltir.

## Temiz-DB deploy provası — DOĞRULANDI (2026-06-13)

Boş bir `teks_deploy_probe` DB'sinde tam deploy provası koşuldu:

```bash
createdb teks_deploy_probe
DATABASE_URL="postgresql://.../teks_deploy_probe?schema=public" \
  JWT_SECRET="ci-test-secret-not-for-production" \
  npx prisma migrate deploy            # All migrations have been successfully applied.
DATABASE_URL="..." JWT_SECRET="..." npx prisma generate   # Prisma Client v7.7.0
dropdb teks_deploy_probe
```

Sonuç (prova tarihindeki durum): **51/51 migration hatasız uygulandı**
(`_prisma_migrations` → 51 finished, 0 rolled-back/yarım), Prisma Client v7.7.0
temiz üretildi. İlk kurulum `migrate deploy` yolu sıfırdan boş DB'de sorunsuz
çalışıyor. **Güncel migration sayısı bu provadan sonra arttı** — kanonik sayı her
zaman `prisma/migrations/` dizinidir (bu yazının tarihinde ~114, en yenisi
`20260714151000_dispatch_item_unique_dispatch_roll`); prova metodolojisi
(boş probe DB + `migrate deploy` + `generate` + `dropdb`) hâlâ geçerli.

## Seed (örnek veri)

`npm run seed` (= `npx prisma db seed` → `prisma/seed.ts`) dev verisini SIFIRLAYIP
yeniden kurar (production'da çalıştırılmaz; installer'da seed yalnız İLK kurulumda,
`.seeded` bayrağı yoksa koşar). Saha donanımı örnek satırları (istasyon yazıcıları,
RS232→BT metre girişleri, sevkiyat kantarı) `PeripheralDevice` modeline seed'lenir —
yalnız dev/test ortamında görünür. (Eski `MachineHardware` tablosu emekliye ayrıldı;
saha donanımının TEK kaynağı artık `PeripheralDevice`.) Production'da operatör/admin
kendi cihazlarını Electron **Cihaz Kaydı** (`PeripheralDevicesPage`) ekranından girer.
