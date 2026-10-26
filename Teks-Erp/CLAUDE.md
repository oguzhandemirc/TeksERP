# TeksERP — Backend (`Teks-Erp/`)

Express 5 + Prisma 7 + PostgreSQL. Domain kuralları kök `CLAUDE.md`; alan kuralları `docs/kurallar/<alan>.md`; desenler `docs/KOD-KURALLARI.md` + `docs/standart/BACKEND.md`; reçeteler `docs/RECETELER.md`; döngü `docs/GELISTIRME-DONGUSU.md`. Gerekçe ve ölçümler arşivde (2026-10-12 "CLAUDE.md kısaltma turu — Teks-Erp").

> `ARCHITECTURE.md` §7–§10 desen/gerekçe için okunur; envanter sayıları bayattır. **Sayıyı dokümana sabitleme**; kanonik kaynak `schema.prisma`, `permission-catalog.ts`, `role-template-catalog.ts`.

## Komutlar ve döngü

```bash
npm run dev                     # hot reload, port 4000; ajan/bekçi yolu: PORT=<port> npx tsx src/server.ts (hot reload YOK)
npm run build                   # tsc + scripts/build-araclar.mjs (dist/tools/*.cjs)
npm run seed · seed:fixtures    # temiz fabrika (yalnız admin) · iş fixture'ları
npm run prisma:generate         # şema değişince ZORUNLU
npm run prisma:migrate          # migrate deploy (dev DEĞİL)
npm run typecheck               # src/ · typecheck:scripts · *:plain = grep'lenebilir
npm test                        # productionDbGate + tip + migration kapısı + TÜM bekçiler (CI'da)
npx tsx scripts/run-all-tests.ts <ad-parçası>   # tek bekçi
```

- Pull sonrası: `npm install` → `prisma:generate` → `prisma:migrate`. `migrate dev` yalnız yeni migration yazmak için ve `--create-only` + `DropForeignKey` satırları silinerek (DEFERRABLE FK'lar).
- Prisma komutları `Teks-Erp/` içinden koşulur.
- tsc "temiz" hükmü ÇIKIŞ KODUNDAN verilir; grep için `*:plain`.
- `.env`: `PORT`, `DATABASE_URL`, `JWT_SECRET`; DB adı PROFİL değeridir, koda/dokümana sabitlenmez.
- Yalnız kendi başlattığın PID'i durdur ya da ayrı port kullan; `pkill -f tsx` YASAK.

## Katmanlar

**Routes → Controllers → Services → Prisma**, alt katman atlanmaz. Controller'sız inline handler normdur: route içinde Zod parse + servise delege, iş mantığı serviste; controller yalnız master-data CRUD (`BaseController`) ya da ≥4 uçlu aile için açılır (ölçüt `docs/standart/BACKEND.md`). **route/controller'da `prisma` import YASAK** (ESLint). Lint kapsamı `src` + `scripts` + `prisma`; gerekçeler `eslint.config.mjs` başlığında.

- `controllers/` HTTP + Zod · `services/` iş mantığı, transaction, `AuditService.log()` · `routes/` Swagger JSDoc + `verifyToken` + `requirePermission` · `middlewares/` (dizin kanonik).
- Master data CRUD `BaseController` + `BaseService` (`searchFields`); liste/cursor/özet tek where `buildListWhere`.
- Hata kodu `details.code`; kapalı modül 403 `MODULE_DISABLED`.

## İzin ve rol — katalog koda, atama panele

- Yeni izin = `src/constants/permission-catalog.ts`'e TEK satır; boot uzlaştırması DB'ye getirir, KİMSEYE ATAMAZ; bekçi `test_permission_catalog.ts`. Migration YAZMA; uzlaştırma yalnız ekler.
- Rol şablonları aynı üçlü (`role-template-catalog.ts` + job + `test_role_template_catalog.ts`); `mode:"all"` yalnız "Admin (Tam Yetki)"; kimlik `code`; sistem rolü pasifleştirilir, sert silinmez; muaflar `ROLE_COVERAGE_EXEMPT`'te gerekçeli.
- Mobil uç kapısı `requireAnyPermission('<web-izni>', ...MOBILE_X)`; kategori `web` izinler `admin:*` ile GELMEZ. Ayrıntı `docs/kurallar/yetki-izin.md`.

## Veritabanı kuralları (her zaman)

1. Her `@relation` kolonuna `@@index`. 2. Composite: eşitlik önce, range/order sonra. 3. Partial index ham SQL migration ile; partial unique için şemada `@@unique`. 4. Şema-dışı nesne `scripts/test_db_invariants.ts` envanterine yazılır; kırmızıya tepki silmek değil. 5. Yüksek hacim tablolar cursor pagination; `MAX_OFFSET=10000`. 6. Sorgulanan JSON için önce GIN. 7. `select`, `include` değil. 8. Karmaşık aggregation `$queryRaw`. 9. `createMany`. 10. Tx kısa, tx içinde dış I/O yok. 11. `tx.*` + `Promise.all` YASAK. 12. Büyük tabloya değen yeni uçta `EXPLAIN ANALYZE`. 13. Snapshot JSON listede çekilmez. 14. Canlıda index migration vardiya dışında; büyük tabloda migration başına `SET statement_timeout = 0;`.
- Elle migration `npx tsx scripts/apply-migration.ts <ad> [--apply]`; `migrate resolve --applied` SQL'in koştuğunu doğrulamaz. Ayrıntı `docs/kurallar/deploy-kurulum.md`.
- Zaman: her `DateTime` `@db.Timestamptz`; `PG_SESSION_OPTIONS` silinmez, `new Pool(` kuran her dosya geçirir; ham SQL'de çıplak `now()` (gerekçeli `-- tz-ok:`); fabrika günü `src/constants/time.ts`. Ayrıntı `docs/kurallar/raporlar.md`.
- Decimal kolonda JS float yok — DB-side increment ya da `Prisma.Decimal`.

## Operasyonel bakım (özet)

- `statement_timeout=50s` DB düzeyinde; yedek `backup.service.ts` (ön ekler yaşam döngüsüdür); geri yükleme backend'de DEĞİL; ölçülemeyen etkiye "ölçülemedi" yazılır, 0 değil. Ayrıntı `docs/kurallar/deploy-kurulum.md`.
- SystemLog arşivi otomatik; kalıcı sayaç `SystemLog`tan değil kolondan okunur. Mutabakat kırmızısında bölüm daraltılmaz.
- Bloat ölçümle (`index-health.sql`).

## Yeni endpoint kontrol listesi

- [ ] Yeni FK `@@index` · `prisma generate`
- [ ] Service: tx + `AuditService.log()` (tx dışında) · Route: `verifyToken` + `requirePermission(kod)` + Swagger
- [ ] Modül kapısı ADLANDIRILMIŞ (`module.middleware.ts`, `requireFinanceEnabled`); jenerik `requireModule("x")` YASAK
- [ ] `app.ts` mount · fiziksel DELETE yok · `any` yok
- [ ] Dış referans var-mı + `isActive` · `@unique` numara → `withBarcodeRetry`, sequence tx İÇİNDE
- [ ] Durum geçişi atomik claim; claim'den SONRA içerik tx içinde taze okunur
- [ ] Depo çuvalı içeriği `touchWarehouseSackTx`; PLANNED sevkiyat `touchShipmentPlannedTx`; içerik değişince `markSackContentChangedTx` (`Sack.notes` istisna)
- [ ] Eski istemci ne yapar? (altı sözleşme tetiği) → gerekirse `client-version-policy.ts` `minVersion`; bekçi `test_client_policy.ts`

## Bekçi (test) yazma sözleşmesi

Altyapı `scripts/test_*.ts` — jest/vitest kurma. Server'sız entegrasyon varsayılan; HTTP ayaklı bekçi sunucusuz bölümünü beyanla atlar (yeşil ≠ kapsandı; `scripts/bekci-http.ts`). HTTP bekçileri kendi geçici kullanıcısını yaratır.
- Fixture business-key ile; hardcoded UUID yok; veri `TEST-` ön ekli ve damgalı. Fason/kartela firması YALNIZ `scripts/fixture-subcontractor.ts`'ten. Yardımcı dosyaya `test_` ön eki verilmez.
- Ortamdaki veriye bağımlı olunmaz; sayım kontrollerine körlük zemini konur.
- Temizlik `finally`de, FK sırasıyla. Global durum yazan bekçinin ilk adımı `hedefDbEngeli()`; `SystemSetting` birebir geri yüklenir; muaf listesi keşifle kurulur ve iki yönlü denetlenir; bekçi kullanıcısı sert silinmez; RESTRICT FK'lı defter satırları (`rollVariance`, `warehouseMovement`) doğru sırayla temizlenir.
- Çıktı `check(label, ok)` + `=== Sonuç: N geçti, M başarısız ===` + `process.exitCode = fail > 0 ? 1 : 0` (yeni `process.exit(` yasak, `test_process_exit_kalibi`); `$disconnect()` + `pool.end()` + sunucu/zamanlayıcı kapatılır, süreç doğal çıkar.
- **Negatif sonda zorunlu**; yarış bekçisi elle açık tutulan tx ile kurulur. Harita `Teks-Erp/docs/BEKCI-HARITASI.md`; reçete `docs/RECETELER.md` § bekçi.

## Paketler

Yeni kütüphane `docs/standart/KUTUPHANELER.md`'ye karar kaydıyla girer (küme orada). `bonjour-service` 1.4.4 SABİT, tembel `require`. Paket `deploy/` ve `scripts/`i taşımaz; araçlar `dist/tools/*.cjs`.

## Sürüm gotcha'ları

Zod v4 `z.record(z.string(), z.unknown())` · Express 5 `req.params.id as string` · Prisma 7 şema değişince `prisma:generate` · şema motoru NATIVE (`docs/kurallar/deploy-kurulum.md`).
