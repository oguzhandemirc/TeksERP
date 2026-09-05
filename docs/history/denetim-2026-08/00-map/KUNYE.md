# Teknik Künye — repodan DOĞRULANDI (2026-08-28, dal `adnansahin`, HEAD ce8681d1)

| Alan | Değer | Kaynak |
|---|---|---|
| Runtime | Node **v22.19.0** (`.nvmrc` yok); TypeScript **^6.0.2** | `node -v`, `Teks-Erp/package.json` |
| HTTP | **Express ^5.2.1** (Express 5 → async handler hataları `next()`e otomatik gider; `express-async-errors`/`asyncHandler` YOK ve gerekmiyor — yine de doğrulanacak) | `package.json`, grep |
| ORM | **Prisma ^7.7.0** + `@prisma/adapter-pg` + `pg ^8.20` (driver adapter; Rust havuzu yok → P2024 üretilmez, çıplak pg Error → `classifyPoolTimeout` 503) | `src/lib/prisma.ts` |
| DB | PostgreSQL — **dev 18.6** (Postgres.app, localhost), **prod 16.9** (Windows native, SAHINSRV), docker-compose `postgres:16-alpine` (statement_timeout=50s, idle_in_transaction_session_timeout=300000) | `SELECT version()`, `ecosystem.config.js`, `docker-compose.yml` |
| relationMode | **verilmemiş → `foreignKeys` (varsayılan)** → DB'de gerçek FK var. `onDelete`: Cascade 42 · Restrict 14 · SetNull 3 | `prisma/schema.prisma` |
| Sayısal tipler | **Float 0**, Decimal 48 alan; 91 model, 45 enum; 196 migration (dev DB'de 195 uygulanmış) | grep, `_prisma_migrations` |
| İzolasyon | DB varsayılanı **read committed** (ÇALIŞTIRILARAK doğrulandı). Kodda `isolationLevel` yalnız 1 yerde: `shipping.service.ts:2610` (RepeatableRead). Global tx opsiyonu `maxWait 5000 / timeout 20000` (`lib/prisma.ts`, O3-1) | `SHOW default_transaction_isolation`, grep |
| Kilitler | `pg_advisory_xact_lock(int,int)` 2-argümanlı form, 8 kullanım noktası (namespace'ler: duplicate-guard 8021, batch 8022, permission-admin, merge, code-unique, shipment-locks, session-registry); `FOR UPDATE` 1 yer (`order.service.ts:2434`) | grep |
| Havuz | `pg.Pool max 30, idleTimeout 10dk, connectionTimeout 5s, options "-c timezone=UTC"` (LOAD-BEARING) | `src/lib/prisma.ts` |
| Süreç modeli | **PM2 `fork`, `instances: 1` — TEK PROCESS INVARIANT (pazarlık dışı, belgeli)**; presence / feature-flag cache / archive+backup scheduler process-local. Windows'ta SIGTERM yerine pm2 IPC `shutdown` mesajı; `kill_timeout 8000` | `ecosystem.config.js`, `src/server.ts` |
| Zamanlanmış işler | `src/jobs/`: archive-scheduler, backup-scheduler (sahada KAPALI — Windows Görev Zamanlayıcı alıyor), offsite-sweeper (rclone, saatlik), installation-identity, mdns-advertiser, permission-catalog / reason-preset-catalog / role-template-catalog uzlaştırıcıları, job-failure. Kütüphane YOK — `setInterval`/`setTimeout` (6 grep vuruşu) | `ls src/jobs`, grep |
| Kuyruk / mesajlaşma | **YOK** (BullMQ/Agenda/Redis yok). Yazıcı kuyruğu istemcide (mobil). Mobil OTA statik nginx | grep |
| Cache | **In-memory** (feature-flag cache, presence Map, reason-preset senkron önbelleği, discovery cache); Redis YOK | grep, `server.ts` |
| Çok şirketlilik | **DB-per-müşteri (tek tenant/DB)** — `companyId`/tenant kolonu YOK; `Branch` (şube) var: `Order.branchId` opsiyonel | CLAUDE.md, şema |
| Entegrasyonlar | Etiket yazıcı (PPLB/TCP, bwip-js), kantar/COM **simüle** (Faz 1), mDNS ilanı, `pg_dump`/`pg_restore`/`rclone` child process (yedek, DB kopyası/geri yükleme = uygulama içinden DDL!), CSV/XLSX içe aktarım (17 varlık), muhasebe export (CSV), mobil OTA manifest. **e-Fatura / banka / MES-PLC YOK** | `src/services`, `src/jobs` |
| Bekçi scriptleri | **366 adet `scripts/test_*.ts`**, koşucu `scripts/run-all-tests.ts` (sıralı, aynı dev DB, tip-kontrol geçidi `tsconfig.scripts.json`, `productionDbGate()`), jest/vitest YOK | `ls scripts`, `run-all-tests.ts` |
| Mass-assignment | `data: req.body` / `...req.body` grep: 0; `BaseController.sanitizeWriteData` DMMF tabanlı, boot'ta `assertBaseServiceGuards()` fail-closed | grep, `server.ts` |
| Raw SQL | `$queryRawUnsafe/$executeRawUnsafe` 19 kullanım (denetlenecek) | grep |
| Denetim veri kaynakları | **dev** `adnansahin_db` (195 migration; 296 top, 762 iş emri, 152.892 log — TEST KALINTISI VAR); **prod kopyası** `tekserp_saha_0825` (2026-08-25 yedeği, 190 migration; 2.431 top, 213 iş emri, 278 sipariş, 40 sevkiyat, 9 kullanıcı) — K2 sorguları BURADA koşar (salt-okunur). Canlı prod'a erişim YOK | psql |
| Önceki denetimler | `audit/FINDINGS.jsonl` 2026-08-09/10: 49 bulgu (14 açık, 26 düzeltildi, 8 reddedildi, 1 doğrulandı); `Teks-Erp/DB-MIMARI-DENETIM.md` 2026-07-08 (kritik yok; 5 yüksek → çoğu kapandı) | jq |
