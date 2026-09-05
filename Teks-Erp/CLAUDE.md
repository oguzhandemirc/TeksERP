# TeksERP — Backend (`Teks-Erp/`)

Express 5 + Prisma 7 + PostgreSQL. Domain kuralları kök `CLAUDE.md`; alan kuralları `docs/kurallar/<alan>.md`; teknik desenler `docs/KOD-KURALLARI.md`; reçeteler `docs/RECETELER.md`. Bu dosya yalnız backend-geneli çalışma düzenini taşır (yeniden yazım 2026-09-05; önceki sürüm git `6695afc2`).

> Derin referans `ARCHITECTURE.md` — §7–§10 pattern/gerekçe içeriği değerlidir; §2–§6 envanter sayıları bayattır (ör. "~114 migration" → 232). **Sayıyı dokümana sabitleme**; kanonik kaynak `schema.prisma`, `permission-catalog.ts`, `role-template-catalog.ts`.

## Komutlar ve döngü

```bash
npm run dev                     # nodemon + ts-node (server.ts, hot reload) — port 4000; ajan/bekçi yolu: PORT=<port> npx tsx src/server.ts (hot reload YOK)
npm run build                   # tsc + scripts/build-araclar.mjs (dist/tools/*.cjs)
npm run seed                    # temiz fabrika (yalnız admin/123123)  ·  npm run seed:fixtures  # PATOS/MAVI/MUS-001 iş fixture'ları
npm run prisma:generate         # şema değişince ZORUNLU
npm run prisma:migrate          # migrate deploy — pull'lanmış migration'ı BU uygular (dev DEĞİL)
npm run typecheck               # yalnız src/ · typecheck:scripts = scripts/+prisma/+src/ · *:plain = grep'lenebilir
npm test                        # run-all-tests.ts — productionDbGate (yerel olmayan DATABASE_URL → DUR; kaçış ALLOW_NONLOCAL_TEST_DB=1) + tip kapısı (~28 sn) + TÜM bekçiler sıralı (saatler)
npx tsx scripts/run-all-tests.ts <ad-parçası>   # tek bekçi (tip kapısı atlanır; acil: SKIP_TYPECHECK=1)
npm run check:migrations · check:docs
```

- **Pull sonrası sıra:** `npm install` → `prisma:generate` → `prisma:migrate` → `dev`. `migrate dev` başkasının migration'ını almak için DEĞİL, yeni migration yazmak içindir ve her diff'te iki DEFERRABLE composite FK'yı (`rolls_sackId_shipmentId_consistency`, `swatches_…`) DROP etmek ister → `--create-only` + `DropForeignKey` satırlarını sil.
- **Prisma komutları `Teks-Erp/` içinden** (`prisma.config.ts` `.env`'i kendi dizinine sabitler; kökten `--config Teks-Erp/prisma.config.ts` ile de koşar, önerilmez).
- **tsc çıktısı boruda renklidir:** "temiz" hükmü ÇIKIŞ KODUNDAN (`npm run typecheck; echo $?`), grep'leyeceksen `*:plain`.
- **`.env`:** `PORT=4000`, `DATABASE_URL="postgresql://tekserp:<parola>@localhost:55433/tekserp_demo?schema=public"` (Docker `tekserp-local-db`), `JWT_SECRET`. DB adı PROFİL değeridir — koda/dokümana sabitleme (saha: `tekserp`). Ayrıntı: `docs/GELISTIRME-DONGUSU.md`.
- **Sunucu süreci:** yalnız kendi başlattığın PID'i durdur ya da ayrı port; `pkill -f tsx` YASAK.

## Katmanlar

**Routes → Controllers → Services → Prisma**, alt katman atlanmaz. Bilinçli istisna: ince read/ayar uçları controller'sız (route içinde Zod parse + servise delege) — iş mantığı yine serviste; **route/controller'da `prisma` import YASAK** — mekanik: ESLint `no-restricted-imports` (2026-09-05'te son ihlal `admin.routes.ts` giderildi, kapı yeşil).

- `controllers/` HTTP + Zod · `services/` (+`helpers/`, `reports/`) iş mantığı, transaction, `AuditService.log()` · `routes/` Swagger JSDoc + `verifyToken` + `requirePermission` · `middlewares/` (auth, rbac, error, device, uuid-param, latency, login-lockout, module, system-account, settings-password… — dizin kanonik) · `prisma/schema.prisma` (`@prisma/adapter-pg`; `clientToken @unique @db.Uuid` 15+ modelde).
- Master data CRUD için `BaseController` + `BaseService` (`searchFields`); liste/cursor/özet tek where `buildListWhere`.
- Hata kodu `details.code`; kapalı modül 403 `MODULE_DISABLED` (uzakta da 403); uzakta kapalı yollar 404 `REMOTE_DENIED` listesi.

## İzin ve rol — katalog koda, atama panele

- Yeni izin = `src/constants/permission-catalog.ts`'e TEK satır; boot uzlaştırması (`jobs/permission-catalog.job.ts`) DB'ye getirir, KİMSEYE ATAMAZ; AST bekçisi `test_permission_catalog.ts` katalogda olmayan kodu düşürür. Migration YAZMA (`20260801020000_…` emsal değil). Uzlaştırma yalnız ekler; kaldırma bilinçli veri migration'ıdır.
- Rol şablonları aynı üçlü: `role-template-catalog.ts` + `jobs/role-template-catalog.job.ts` + `test_role_template_catalog.ts`. `mode:"all"` yalnız "Admin (Tam Yetki)"; kimlik `code` (ad değil), `code=null` fabrikanındır; sistem rolü pasifleştirilir, sert silinmez; kapsam bekçisi Admin dışında koşar, muaflar `ROLE_COVERAGE_EXEMPT`'te gerekçeli ve iki yönlü denetlenir.
- Mobil ucun kapısı `requireAnyPermission('<web-izni>', ...MOBILE_X)`; mobil `types/permissions.ts` union'ı elle taşınır. Kategori `web` izinler (`settings:workstation`, `document-template:*`) `admin:*` ile GELMEZ. Ekran canlıda görünmüyorsa: satır DB'de mi → atanmış mı → yeniden giriş (JWT bayat). Ayrıntı: `docs/kurallar/yetki-izin.md`.

## Veritabanı kuralları (her zaman)

1. Her `@relation` kolonuna `@@index` (düşük trafik "kim yaptı" FK'ları hariç). 2. Composite sıra: eşitlik önce, range/order sonra; sık birlikte süzülen kolonlar tek composite. 3. Partial index ham SQL migration ile; şemada `@@index` bırak (predicate drift sayılmaz, index↔unique farkı SAYILIR → partial unique için `@@unique`). 4. Şema-dışı nesneler (partial index, CHECK, DEFERRABLE FK, statistics, `EXPRESSION_UNIQUES`) `scripts/test_db_invariants.ts` envanterinde; yeni nesne → envantere yaz, kırmızıya tepki silmek değil. 5. Yüksek hacim tablolar (`Roll`, `RollMovement`, `RollOperation`, `SystemLog`, `TravelerCardScan`) cursor pagination; `MAX_OFFSET=10000`. 6. JSON alan sorgulanacaksa GIN önce. 7. `select`, `include` değil. 8. Karmaşık aggregation `$queryRaw`. 9. `createMany`. 10. Tx kısa, dış I/O tx içinde yok (`idle_in_transaction_session_timeout=5min`). 11. `tx.*` + `Promise.all` YASAK (ESLint). 12. Yeni uç büyük tabloya değiyorsa `EXPLAIN ANALYZE`. 13. Snapshot JSON'ları listede çekme. 14. Canlıda index migration vardiya dışında; büyük tabloda `SET statement_timeout = 0;` migration başına (DB `statement_timeout=50s`).
- **Elle migration:** `npx tsx scripts/apply-migration.ts <ad> [--apply]` (git add → db execute → resolve → doğrula tek komutta). `migrate resolve --applied` SQL'in koştuğunu doğrulamaz; commit edilmemiş migration prod'da sessiz eksiktir. Bekçiler: `check-migrations.mjs` · `test_migration_hygiene.ts` · `test_schema_drift.ts` (üç ayrı soru). Ayrıntı: `docs/kurallar/deploy-kurulum.md`.
- **Zaman:** her `DateTime` `@db.Timestamptz` (bekçi `test_timestamptz_contract.ts`, tek bekçi — ikincisini yazma); `PG_SESSION_OPTIONS` (`-c timezone=UTC`) silinmez, `new Pool(` kuran her dosya geçirir; ham SQL'de çıplak `now()` tercih (gerekçeli `-- tz-ok:`; `test_raw_sql_hygiene.ts`); fabrika günü `src/constants/time.ts` (`factoryDaySql/…`, `test_report_day_boundary.ts`). Ayrıntı: `docs/kurallar/raporlar.md`.
- **Decimal** kolonda JS float yok — DB-side increment/decrement ya da `Prisma.Decimal`.

## Operasyonel bakım (özet)

- `statement_timeout=50s` DB-level, elle uygulanır; slow query log (>500 ms) yalnız üretimde.
- Yedekleme backend'de (`backup.service.ts`, `pg_dump` ayrı process, doğrulama, GÜN bazlı saklama + en yeni 3 dosya); sahada gece yedeğini Windows görevi alır, backend zamanlayıcısı kapalı. Yedek ön ekleri yaşam döngüsüdür (`tekserp_` rotasyona girer, `premigrate_`/`pre-restore_` girmez). Kopyaya geri yükleme `<canlı>_restore_<damga>` + iki RENAME; geri yükleme bilinçli olarak backend'de DEĞİL (`pm2 stop` + `pg_restore`); etki raporunda ölçülemeyen UPDATE hacmine "ölçülemedi" yazılır, 0 değil. `applied_steps_count` doğrulamada KULLANILMAZ.
- SystemLog arşivi otomatik (6 aydan eskisi 30 günde bir); kalıcı sayaç/rapor `SystemLog`tan değil kolondan okunur. `sessions/purge` 6 ayda bir. Mutabakat (`consistency-check.sql` + `test_consistency.ts`) `npm test`te; kırmızı üç şey olabilir (kod hatası · iş kararı bekleyen veri · sorgunun kör noktası) — bölümü daraltma.
- Bloat takvimle değil ölçümle (`index-health.sql` §8/§9 → `REINDEX CONCURRENTLY`).

## Yeni endpoint kontrol listesi

- [ ] Yeni FK için `@@index` · `prisma generate` koştu
- [ ] Service: transaction + `AuditService.log()` (tx dışında) · Controller: Zod + servis · Route: `verifyToken` + `requirePermission(kod)` + Swagger JSDoc (kod katalogda)
- [ ] Modüle aitse ADLANDIRILMIŞ kapı (`requireProductionEnabled` / `requireTicaretEnabled` / `requireIplikEnabled` / `requireDepoMultiEnabled`, `module.middleware.ts`); jenerik `requireModule("x")` YASAK; kapı gerekmiyorsa muaf listesinde gerekçeli
- [ ] `app.ts`'e `app.use("/api/...", routes)` · fiziksel DELETE yok · `any` yok · `tx` içinde `Promise.all` yok
- [ ] Dış referans ID'leri var-mı + `isActive` · `@unique` numara/barkod → `withBarcodeRetry` + sequence okuma tx İÇİNDE
- [ ] Durum geçişi → atomik claim (`updateMany WHERE {id, durum}` + `count===0 → 409`; claim'den SONRA içerik tx İÇİNDE taze okunur)
- [ ] Mobil dokunacaksa `requireAnyPermission(web, ...MOBILE_X)` · Decimal'de float yok
- [ ] Depo çuvalı içeriğine dokunuyorsa `touchWarehouseSackTx` (shipmentId IS NULL); PLANNED sevkiyat kümesi `touchShipmentPlannedTx`; içerik değişince `markSackContentChangedTx` (kg sıfırlama + `labelDirty`). **`Sack.notes` istisna** — guard uygulanmaz, ekleme (özellik 409'a düşer).
- [ ] Eski istemci ne yapar? (altı sözleşme tetiği: uç kaldırma · alan adı · tip/birim · zorunlu parametre · enum · izin) → gerekirse `client-version-policy.ts` `minVersion` (sahadakinden büyük olamaz; önce istemci yayınlanır). Mobilde iki eksen (`minVersion` + `minPaketTarihi`). Bekçi `test_client_policy.ts`.

## Bekçi (test) yazma sözleşmesi

Test altyapısı `scripts/test_*.ts` — jest/vitest YOK, kurma. Server'sız entegrasyon VARSAYILAN: servis + prisma doğrudan, HTTP yok. Beş bekçi ayrı sunucu ister ve kendi portunu bekler (finance 4100 · module_flag_off 4101 · superadmin 4104 · settings_password 4112 · module_profile 4122); sunucu yoksa o bölümler SESSİZCE atlanır — yeşil ≠ kapsandı. HTTP/0-izin bekçileri kendi geçici kullanıcısını `ensureTestAdmin`/fixture ile yaratır (seed şifresine güvenilmez).
- Fixture business-key ile; hardcoded UUID yazma; üretilen veri `TEST-` ön ekli, damgalı (partial UNIQUE seddi ikinci koşumu P2002'ye düşürür). Fason/kartela firması YALNIZ `scripts/fixture-subcontractor.ts`'ten (`ensureTestDyeHouse/…`, kalıcı, SİLME); "herhangi bir aktif firma bul" ÇÖZÜM DEĞİL. Yardımcı/fixture dosyasına `test_` ön eki verme.
- Ortamdaki veriye BAĞIMLI OLMA (`findFirst` ile "herhangi bir kayıt" üstüne test kurma — temiz CI DB'de düşer ya da vakumen yeşil kalır; `test_field_address`/`test_fason_visibility` emsali). Sayım kontrollerine körlük zemini koy (0 bulgu ≠ hiç bakılmadı).
- Temizlik `finally` içinde ve FK sırasına göre. Bayrak/global durum yazan bekçinin İLK adımı `hedefDbEngeli()` (`productionDbGate` KOŞUCUNUN kapısıdır, tek dosya doğrudan koşulunca çalışmaz — tek bekçi de `run-all-tests.ts <ad>` ile koşulur); değiştirilen `SystemSetting` `finally`de BİREBİR geri yüklenir; muaf listesi elle değil KEŞİFLE kurulur, her koşumda basılır ve iki yönlü denetlenir (ölü muaf da kırmızı); bekçinin yarattığı kullanıcı sert silinmez (`system_logs_userId_fkey`); fason kabulü yapan her cleanup `rollVariance.deleteMany` içerir (RESTRICT FK).
- Çıktı: `check(label, ok)` + `=== Sonuç: N geçti, M başarısız ===` + `process.exit(fail>0?1:0)` ya da `$disconnect()` + `pool.end()` (`$disconnect` tek başına yetmez, havuz 10 dk açık kalır → 180 sn zaman aşımı).
- **Negatif sonda zorunlu:** yeni bekçi, korunan davranış bozulunca KIRMIZI verdiği ölçülerek yazılır; sondanın kendisi kataloğa girebilecek gerçek kod kullanmaz. Yarış bekçisi elle açık tutulan tx ile kurulur; gate-tx promise'ine `await`ten önce no-op `.catch`.
- Alan → bekçi haritası: `Teks-Erp/docs/BEKCI-HARITASI.md`. Reçete: `docs/RECETELER.md` § bekçi.

## Paketler

Sadece izinli liste; alternatif tanıtma, yenisi için onay: `express dotenv cors helmet compression` · `prisma @prisma/client pg @prisma/adapter-pg` · `jsonwebtoken bcryptjs` · `zod` · `swagger-ui-express swagger-jsdoc` · `morgan` · `uuid` · `bwip-js` · `bonjour-service` (**1.4.4 SABİT**, tembel `require` + try/catch, tek dosya `jobs/mdns-advertiser.job.ts`) · `opentype.js` · `@faker-js/faker` (dev). Paket `deploy/` ve `scripts/`yi TAŞIMAZ; sunucu araçları `dist/tools/*.cjs`'e derlenir.

## Sürüm gotcha'ları

Zod v4 `z.record(z.string(), z.unknown())` · Express 5 `req.params.id as string` · Prisma 7 şema değişince `prisma:generate` · Prisma'nın iki motoru: şema motoru NATIVE (`docs/kurallar/deploy-kurulum.md`).
