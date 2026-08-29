# K7b — Hesap & Birim Noktaları (raporlar + pano + karneler) — HARİTA

Aşama ① KEŞİF · 2026-08-28 · dal `adnansahin`, HEAD `ce8681d1` · SALT-OKUNUR · yargı YOK, yalnız harita + HOTSPOT işareti.
Yollar repo köküne göre; `Teks-Erp/src/...` kısaltması `src/...`. Satır numaraları HEAD'deki dosyalardan (`cat -n`/`sed -n`) alındı.

**Kapsam:** `src/services/reports/*` (22 dosya, 5 303 satır) · `dashboard.service.ts` · `production-balance.service.ts` · `accounting-export.service.ts` · `work-session-activity.service.ts` · `latency-stats.service.ts` + `latency-persist.service.ts` + `middlewares/latency.middleware.ts` · bunları besleyen ortak temel: `constants/time.ts`, `lib/pg-session.ts`, `lib/prisma.ts`, `reports/_shared.ts`, `_breakdown.ts`, `_shipped.ts`, `helpers/coverage.helper.ts`, `helpers/order-line-scope.helper.ts`, `helpers/roll-finalize.helper.ts` (`loadProducedBuckets`), `batch.service.ts` (`K18_DEAD_STATUSES`), migration `20260809090000` (finalizedAt trigger'ı), rapor route'ları (`routes/reports/*`, `production-balance.routes`, `dashboard.routes`, `admin.routes` perf uçları, `work-session.routes`, `shipping.routes` accounting-export).
**Kapsam dışı (K7a'da):** çekirdek yazma yolları (currentQty/shippedQty/SackAllocation/RollVariance yazımları). Burada yalnız o alanları OKUYAN rapor noktaları haritalandı; K7a ile çakışan tanımlar §6'da çapraz listelendi.

**Yöntem:** (1) 22 rapor dosyası + 5 servis satır satır okundu; (2) zaman kolonu / gün-sınırı yöntemi / statü kümesi / yuvarlama / Decimal→Number her metrik için çıkarıldı; (3) `grep` ile `factoryDaySql|DATE_TRUNC|AT TIME ZONE|setHours|now()|findMany|LIMIT|take:|round1|Number(|::float` sayıldı (§1.4); (4) bekçi script'lerinin kontrol başlıkları grep'lendi (§9); (5) prod kopyası `tekserp_saha_0825` (190/195 migration — `orders.cancelledAt`, `order_lines.cancelledAt`, `cancelReasonCode` kolonları YOK) ve dev `adnansahin_db` üzerinde salt-okunur ölçüm (§8).

---

## 0. Özet (10 cümle)

1. Rapor katmanı **tek zaman sözleşmesi** taşıyor: `dateFrom/dateTo` MUTLAK AN (`_shared.ts:22-65`, `.strict()`, varsayılan "şu andan geri 30×24 saat"), gün sınırını İSTEMCİ çizer (`Electron/src/pages/Reports/_hooks/useReportDateRange.ts:13-33` yerel 00:00 / 23:59:59.999), rapor İÇİ günlük gruplama ise `factoryDaySql` (`constants/time.ts:70-72`, `DATE_TRUNC('day', col AT TIME ZONE 'Europe/Istanbul')`) ile fabrika gününe kesilir — oturum `-c timezone=UTC` (`lib/prisma.ts:72`, `lib/pg-session.ts:42`) olduğu için çıplak `DATE_TRUNC` UTC gününü verirdi; bekçi `test_report_day_boundary.ts:176-224` çıplak `DATE_TRUNC/CURRENT_DATE/setHours`'u tarar.
2. Dokuz rapor **on farklı zaman çıpası** kullanıyor (§5): `finalizedAt` (kalite/fire), `statusChangedAt` (stok yaşı), `dispatchedAt` (sevk), `RollReturn.createdAt` (iade), `Order.orderDate` (sipariş girişi/talep/teslim süresi/müşteri), `Order.completedAt` (OTIF), `Order.cancelledAt` (iptal), `RollError.detectedAt` (hata), `RollMovement.exitedAt/enteredAt` (WIP), `RollPlanDeviation.createdAt`, `SystemLog.createdAt`; **aynı kavram farklı kolonla ölçülen 3 yer** işaretlendi (§5.2).
3. **"Dönemde sevk edilen metraj" tek tanım iddiası (`_shipped.ts`) eksik:** Sevk & Termin Karnesi'nin **günlük serisi** (`shipment-scorecard.report.service.ts:130-137`) iade geri-eklemesiz ve doğrudan-sevksiz **NET** bir kopyadır; bekçi (`test_shipment_scorecard.ts:103-118`) günlük serinin toplamını kontrol etmiyor (H1).
4. **"Üretilen metraj" dört tanımlı** (§6.B): kalite/fire karnesi (`finalizedAt` + ¬K18 + `currentQty`, SCRAP ve SHIPPED dahil) ≠ iş emri listesi/detayı (`producedOutputWhere` + `initialQty`, fire hariç, A1 dahil) ≠ `computeWoMaterial.finished` (`producedInStepId` + {WAREHOUSE,A1_STOCK,SHIPPED,SCRAP}) ≠ pano "bugün biten" (hareket kapanışı ADEDİ). Fire ve kalite karnesinin evreni bekçide kilitli (`test_scrap_scorecard.ts:136-148`).
5. Kalite/fire evreninde bir **sızıntı ölçüldü**: `finalizedAt` yalnız final statüye GİRİŞTE yazılır (migration `20260809090000:79-86`) ve yeniden üretime alınan top (`WAREHOUSE→IN_PRODUCTION/AT_SUBCONTRACTOR`) damgayı KORUR; sorgu `status NOT IN K18` süzdüğü için o top eski dönemin karnesinde eski kalitesiyle SAYILMAYA DEVAM EDER — prod kopyasında 4 top (`T240826F0031/34/35/36`, §8.2) (H2).
6. CLAUDE.md kuralları kodda **doğrulandı** (§7): K18 dışlama + SCRAP dahil (`quality-scorecard:194`), `SHIPPED/CANCELLED` trigger dışı (`20260809090000:79-80`), `loadProducedBuckets` katalogdan + `isActive` süzgeci yok + `notIn: []` üretilmez (`roll-finalize.helper.ts:76-78`, `workorder.service.ts:1852-1862`), "1. KALİTE" gömülmez (`quality-scorecard:298-302`), fason atfı üç kova (`:175,:392-394`), ölü stok = eski ∧ siparişsiz (`stock-scorecard:250-261`), parti no daima aday listesi (`batch-trace:81-123`), yarı mamul arzdan düşülmez (`production-balance:430-433`).
7. **Aktif kalem (`cancelledAt IS NULL`) tek kaynağı** Prisma tarafında `ACTIVE_LINE` (`order-line-scope.helper.ts:26`), ham SQL'de ise **10 satırlık elle kopya** (customer-scorecard, customer.report ×4, demand-analysis, order-intake, order-cancellation ×2, shipment-scorecard) — AST bekçisi (`test_order_line_scope_single_source.ts:99-134`) ham SQL'i `FROM/JOIN order_lines` + 3 satırlık pencereyle denetliyor → kopyalar bekçili. **Fason "açık kalem" kuralının ham SQL kopyası** (`subcontract-scorecard:143-145,:195,:280-291`) ise bekçisiz: `test_fason_open_dispatch_single_source.ts` yalnız Prisma nesne literallerini tarar (§6.G).
8. Yuvarlama: raporlarda **iki ayrı `round1/pctOf` tanımı** (`_breakdown.ts:32-34` ↔ `quality-scorecard:219-220`, birebir) + 6 satır içi `Math.round(x*10)/10`; hepsi 0,1 m / %0,1 "yarım-yukarı" (JS `Math.round`, negatifte sıfıra doğru değil yukarı — `-0.05→-0`). SQL toplamları `::float`/`::float8` ile **PG tarafında double'a** çevrilip JS'te float toplanıyor (`_shipped:109`, quality `:177`, scrap `:151,:202`, return `:124`, wip `:96` …); Decimal aritmetiği yalnız `production-balance`, `open-order-coverage`, `accounting-export`, `order-intake.collect` (Decimal→`Number` son adımda).
9. **Performans (H ajanı, §8.4):** tavansız `findMany` 9 yerde — stok karnesi TÜM serbest topları belleğe alır (`stock-scorecard:138-165`, prod 533 top), müşteri karnesi TÜM müşteri×sipariş ömrünü her çağrıda tarar (`customer-scorecard:168-204`), talep analizi/sipariş karnesi dönemin tüm kalemlerini yükler, plan-sapma dönemin tüm satırlarını (detay 200'e kırpılır ama sorgu kırpılmaz), üretim dengesi tüm açık kalem + tüm canlı WO + `computeWoMaterial`'ın 6 sorgusu; muhasebe export'u 2 000 sevkiyat tavanlı ama iç içe çuval/top seçimi tavansız. `orders.orderDate/completedAt/cancelledAt` üzerinde **index YOK** (5 rapor bu kolonlarla süzüyor; bugün 278 sipariş).
10. Prod kopyası ölçümleri (§8): kalite/fire evreni 1 035 damgalı top (Ağustos 939 top / 55 276 m), çıpasız final top 4 (3 WAREHOUSE + 1 SCRAP), `statusChangedAt` NULL 39 (28'i IN_PRODUCTION), gece penceresi (21:00–24:00Z) rapor çıpalarında **0 satır** (yalnız `system_logs` 12/9 387) → gün-sınırı hatası bugün yalnız audit raporunda gözlenebilir; `roll_plan_deviations` 0 satır; `direct_shipments` 0; `RollReturn` 5 (iptal 0); fason kabul kalemlerinin 635/638'i `receivedQty` NULL (eski rejim → rapor `nr.currentQty` fallback'i, §6.D/H4).

---

## 1. Ortak temel

### 1.1 Zaman: oturum UTC, gün fabrika günü

| Katman | Kaynak | Ne yapar | Kanıt |
|---|---|---|---|
| pg havuzu | `options: PG_SESSION_OPTIONS` = `"-c timezone=UTC"` | Oturum saat dilimi UTC — `@prisma/adapter-pg` timestamptz okurken ofseti "+00:00" ile ezdiği için ZORUNLU; kaldırılırsa okumalar +3 sa, yazmalar −3 sa kayar (ölçülmüş, yorum) | `src/lib/prisma.ts:62-73`, `src/lib/pg-session.ts:9-42` |
| SQL gün kesme | `factoryDaySql(col)` → `DATE_TRUNC('day', col AT TIME ZONE 'Europe/Istanbul')::date` (`Prisma.raw`, literal metne gömülü — ifade istatistiği `sl_day_exact` ile birebir eşleşmesi için) | Takvim günü sorusu | `src/constants/time.ts:70-72`; ifade istatistiği prod+dev'de doğrulandı (`sl_day_exact` = aynı ifade, §8.3) |
| SQL ay kesme | `factoryMonthSql(col)` | Mevsimsellik serisi | `time.ts:89-91`; tek tüketici `demand-analysis:141` |
| JS gün başı | `factoryDayStart(at)` — `Intl.DateTimeFormat(timeZone: Europe/Istanbul)` + iki turlu ofset; süreç `TZ`'sinden bağımsız | Prisma `gte` filtresi için mutlak an | `time.ts:137-145`; tüketiciler: `dashboard.service.ts:46-48`, `tambur.service.ts:1431`, `tambur-undo.service.ts:765`, `shipping.service.ts:2044`, `jobs/backup-scheduler.ts:95`, `reports/_shared.ts:183-192` (ölü `eachDay`) |
| JS gün anahtarı | `factoryYmd` → `YYYY-MM-DD` | grafik kategorisi | `time.ts:148-151`; tüketici `_shared.ymdLocal:200-202` (çağıranı yok), `utils/code-format.ts:64` |
| `@db.Date` anahtarı | `factoryDayKeyUtcMidnight` — yerel Y/M/D + `Date.UTC` (adapter DATE kolonuna UTC gün-parçasını yazar) | latency günlük özet | `time.ts:160-163`; `latency-persist.service.ts:71-73` |
| Raporda `day` etiketi | `r.day.toISOString().slice(0,10)` — PG `date` → JS `Date` UTC gece yarısı (proje varsayımı, `plan-deviation:236` yorumu) | 8 rapor | quality `:433`, scrap `:389`, return `:241`, shipment `:198`, intake `:187`, cancellation `:287`, plan-dev `:237`, audit `:93`, latency `:77` |
| Mutlak pencere (tz-ok) | `EXTRACT(EPOCH FROM (now() − col))/86400.0` (SQL) · `(b − a)/86_400_000` (JS) | yaş / gecikme / süre — takvim günü DEĞİL | wip `:98,:100,:133,:156,:170`; subcontract `:203,:265`; stock `:156`; shipment `:108,:148`; customer-scorecard `:219,:228`; leadtime `:181`; cancellation `:186`; coverage `:203-206`; work-session-activity `:393,:408` |
| İstemci gün sınırı | `new Date(y, m, d, 0,0,0,0)` / `23,59,59,999` → `toISOString()` — **Electron makinesinin** saat dilimi | `dateFrom/dateTo` | `Electron/src/pages/Reports/_hooks/useReportDateRange.ts:13-33,:50-59` |

**Çözüm zinciri tek cümleyle:** kolonlar timestamptz (mutlak an) → oturum UTC → gün sorusu soran her yer ya `factoryDaySql` (SQL) ya `factoryDayStart` (JS) kullanır → istemcinin gönderdiği aralık uçları asla yeniden yuvarlanmaz (`_shared.ts:39-47` sözleşmesi, `accounting-export.ts:160-167` aynı sözleşme). Bekçi kapsamı: `test_report_day_boundary.ts:176-224` yalnız `DATE_TRUNC('day|week|month')`, `CURRENT_DATE`, `.setHours(` tarar — `now()` karşılaştırmaları, `toISOString().slice(0,10)`, `Math.floor(ms/86_400_000)` ve `getFullYear/getMonth/getDate` **taranmaz** (bilinçli: mutlak pencere; `free-document.service.ts:140`, `printed-document.service.ts:273`, `label-html.shared.ts:139` süreç-TZ'li duvar saati basıyor — belge yüzeyi, K-belge).

### 1.2 Tarih aralığı ve karşılaştırma sözleşmesi (`reports/_shared.ts`)

| Nokta | Kural | Satır |
|---|---|---|
| Şema | `dateFrom/dateTo` ISO datetime, `.strict()` (yanlış ad → 400) | `:22-27`, compare `:86-94` |
| Varsayılan | `from = now − 30×86_400_000 ms`, `to = now` — **mutlak**, gün başına yuvarlanmaz | `:49-54` |
| Sınır | `from > to` → 400; `to − from > 366 gün` → 400 | `:58-63` |
| `prev` | aynı uzunlukta, bitişi `primary.from − 1 ms` (bitişik, çakışmaz) | `:131-138` |
| `prevYear` | `setUTCFullYear(−1)` takvim yılı (29 Şubat → 1 Mart bilinen kayma) | `:140-146` |
| Zarf | `range` + opsiyonel `compareRange` ISO | `:157-170` |
| Snapshot raporlar | `resolveDateRange({})` ile zarf doldurulur ama sorgu tarih almaz (stok karnesi `inventory.routes:27`, kapsama `sales.routes:81`) | — |

### 1.3 Kırılım üreticisi ve yuvarlama (`reports/_breakdown.ts`)

- `round1 = Math.round(n*10)/10` (`:32`), `pctOf = whole>0 ? Math.round(part/whole*1000)/10 : 0` (`:33-34`) — payda 0 → **0 %** (`null` değil).
- `buildBreakdown` tek hücre kümesinden türetir, `row.qty` satır sonunda `round1` (`:49`), sıralama metraj DESC → adet DESC → ad `localeCompare("tr")` (`:53`). `attachPrev` önceki dönemde olmayan satıra **0** yazar (`:72-73`).
- **Kopya tanım:** `quality-scorecard.report.service.ts:219-220` aynı iki fonksiyonu yerel olarak yeniden tanımlar (`_breakdown` import etmez); `subcontract-scorecard:234,:334,:350`, `shipment-scorecard:186,:206`, `wip-scorecard:213` satır içi `Math.round(x*10)/10`. Electron da toplam satırlarını **yuvarlanmış satırları toplayıp yeniden yuvarlayarak** kurar (`Electron/src/pages/Reports/Sales/shipmentScorecard.ts:61-66`, `returnScorecard.ts:57-62`, `Inventory/stockScorecard.ts:70-71,:89`, `Sales/openOrderCoverage.ts:88-92` — burada yuvarlama YOK, ham float toplam) → sunucu özeti ile istemci "TOPLAM" satırı 0,1 m ayrışabilir (§10 sınır ötesi).

### 1.4 Grep sayıları (`--include='*.ts'`)

| Ölçüm | Sayı | Not |
|---|---|---|
| `factoryDaySql(` tüketicisi | 9 rapor sorgusu (quality, scrap, return, shipment, intake, cancellation, plan-dev, audit ×1 + production import'u kullanmıyor `:18`) | `production.report.service.ts:18` import var, **kullanım yok** (ölü import) |
| `factoryMonthSql(` | 1 (`demand-analysis:141`) | |
| `factoryDayStart(` | 7 dosya (§1.1) | |
| `AT TIME ZONE 'UTC'` ham SQL (`now() AT TIME ZONE 'UTC'` → `exitedAt`) | 11 yazma noktası (`workorder.service` ×4, `subcontractor.service` ×5, `kursun-bypass:2347`, `kursun-qc:896`) | timestamptz kolona timestamp yazımı — oturum UTC olduğu sürece doğru; K7a/K3 alanı (WIP süresi bu kolonu okur) |
| `now()` (rapor+pano+denge+export) | 16 | hepsi mutlak fark / eşik; `test_report_day_boundary` taramaz |
| `findMany(` (kapsam dosyaları) | 27 — `take:` taşıyan 8 (work-session-activity ×6, latency-persist ×2) | §8.4 |
| ham SQL `LIMIT` | 11 (operator-perf `${limit}`, batch-search `${limit}`, customer.report 200, audit 30/100, shipment overdue 25, wip 25+25, subcontract open 25, scrap LATERAL 1) | |
| `Number(` | 139 (en çok accounting-export 18, open-order-coverage 17, wip 16, shipment 12, production 10) | §4 |
| `::float`/`::float8` (PG tarafı double) | 31 | Decimal→double dönüşümü **SQL'de** |
| Decimal op (`.plus/.minus/.times/.div`) | 44 (open-order-coverage 15, accounting-export 15, production-balance 13, order-intake 1) | |
| `round1`/`pctOf` tanımı | 2 + 2 (kopya) ; satır içi `Math.round(*10)/10` 6 | §1.3 |

---

## 2. Uç envanteri (route → servis → izin)

| Uç | Servis fonksiyonu | Guard (route satırı) | Aralık | Karşılaştırma |
|---|---|---|---|---|
| `GET /api/reports/production/operator-performance` | `getOperatorPerformance(range, limit)` | `report:production` (`production.routes.ts:23,:91-101`; `limit` 1..200 default 50 `:95`) | `dateRangeSchema` | — |
| `GET …/production/traveler-trace?rollId` | `getTravelerTrace(rollId)` | aynı (`:128-137`) | yok | — |
| `GET …/production/wip` | `getWipScorecard(range)` | aynı (`:73-81`) | yalnız "geçen" bölümü | — |
| `GET …/production/batch-search?q` | `searchBatches(q)` | aynı (`:50-57`) | yok | — |
| `GET …/production/batch-trace/:batchId` | `getBatchTrace` | aynı (`:60-71`) | yok | — |
| `GET …/quality/scorecard` | `getQualityScorecard` | `report:quality` (`quality.routes.ts:20,:30-40`) | compare | prev/prevYear/custom |
| `GET …/quality/scrap-scorecard` | `getScrapScorecard` | aynı (`:46-56`) | compare | evet |
| `GET …/quality/plan-deviation-scorecard` | `getPlanDeviationScorecard` | aynı (`:66-80`) | compare | evet |
| `GET …/sales/shipment-scorecard` | `getShipmentScorecard` | `report:sales` (`sales.routes.ts:24,:32-42`) | compare | evet |
| `GET …/sales/return-scorecard` | `getReturnScorecard` | aynı (`:44-54`) | compare | evet |
| `GET …/sales/open-order-coverage` | `getOpenOrderCoverage()` | aynı (`:78-85`) | **yok (snapshot)** | — |
| `GET …/sales/order-intake` | `getOrderIntake` | aynı (`:117-127`) | compare | evet |
| `GET …/sales/demand-analysis` | `getDemandAnalysis` | aynı (`:161-171`) | compare | evet (aylık seri hariç) |
| `GET …/sales/order-leadtime` | `getOrderLeadTime` | aynı (`:205-214`) | dateRange | — |
| `GET …/sales/order-cancellation` | `getOrderCancellationScorecard` | aynı (`:244-253`) | dateRange | — |
| `GET …/inventory/scorecard` | `getStockScorecard()` | `report:inventory` (`inventory.routes.ts:16,:24-31`) | **yok (snapshot)** | — |
| `GET …/subcontract/scorecard` | `getSubcontractScorecard` | `report:subcontract` (`subcontract.routes.ts:18,:21-31`) | compare | evet |
| `GET …/customer/order-profile` | `getCustomerOrderProfiles()` | `report:customer` (`customer.routes.ts:20,:22-29`) | yok | — |
| `GET …/customer/scorecard` | `getCustomerScorecard` | aynı (`:64-74`) | compare | evet |
| `GET …/audit/system-log-summary`, `/user-activity` | `getSystemLogSummary`, `getUserActivity` | `report:audit` (`audit.routes.ts:19,:21-39`) | dateRange | — |
| `GET /api/production-balance?itemId=a,b` | `ProductionBalanceService.getBalance` | `workorder:read ∨ order:read` (`production-balance.routes.ts:37-40`) | yok | — |
| `GET /api/dashboard/defects/summary` · `/stations/live-state` | `DashboardService.*` | `quality:read` (`dashboard.routes.ts:26-29`) · `station:read` (`:58-61`) | "bugün" | — |
| `GET /api/shipping/accounting-export` | `buildDispatchAccountingExport(req)` | `shipping:read ∨ shipping:write ∨ report:sales` (`shipping.routes.ts:14,:206`) | `dateField` ∈ {createdAt, dispatchedAt}; `ids=` seçim modu | — |
| `GET /api/work-sessions/:id/activity` | `WorkSessionActivityService.list` | `admin:settings ∨ admin:users` (`work-session.routes.ts:117-121`) | oturum penceresi | — |
| `GET /api/admin/perf` · `/perf/history?days&route` | `latencySnapshot()` · `latencyHistory(days, route)` | `admin:settings` (`admin.routes.ts:722-736,:753-770`; `days` 1..90 default 14 `:738-741`) | — | — |

Tüm rapor route'ları tek dosya-içi `guard` dizisi (`const guard = [verifyToken, requirePermission(…)]` + spread) deseni — K5'in 2. kaynağı; buradaki liste K5 ile çapraz doğrulanmadı [VARSAYIM: K5 aynı satırları saydı].

---

## 3. Metrik envanteri (rapor bazında)

Sütunlar: **Konum** · **Tanım (düz Türkçe)** · **Kaynak tablo/alan** · **Zaman temeli** · **Dahil/hariç** · **Yuvarlama** · **D→N** (Decimal→Number: `SQL::float` = PG'de double; `Number()` = JS; Ç=çıktı için, A=dönüşümden sonra aritmetik) · **Tek kaynak?**

### 3.A Kalite Karnesi — `reports/quality-scorecard.report.service.ts`

| # | Konum | Tanım | Kaynak | Zaman | Dahil/hariç | Yuvarlama | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|---|
| A1 | `:146-215` `collectPeriod` | Dönemde üretimi biten topların kalite × kumaş × renk × fason firma hücreleri: `rollCount = COUNT(*)`, `qty = Σ currentQty` | `rolls` (`qualityGradeId`, `itemId`, `colorId`, `parentReceiptId`, `entrySource`, `currentQty`), `quality_grades`, `subcontractor_receipts` | `rolls.finalizedAt ∈ [from,to]` (`:192-193`) | `status NOT IN K18_DEAD_STATUSES` (`:194` — SUBCONTRACTOR_CONSUMED, TAMBUR_CONSUMED, KARTELA_CONSUMED, CANCELLED; `batch.service.ts:55-60`); **SCRAP, SHIPPED, IN_PRODUCTION, AT_SUBCONTRACTOR, STOCK, WAREHOUSE, A1_STOCK dahil** (damgası varsa) | yok (SQL) | `SUM(currentQty)::float` `:177` → `Number(r.qty ?? 0)` `:213` (A: JS'te toplanır `:337-357`) | kopya: `scrap-scorecard.producedTotal:200-209` (aynı WHERE, bekçili eşitlik) |
| A2 | `:298-302` | "En üst kalite" = `quality_grades` `sortOrder ASC` ilk satır; **`isActive` süzgeci YOK** | `quality_grades` | — | pasif kalite de aday | — | — | ikinci okuma `loadProducedBuckets` (`roll-finalize.helper.ts:76-78`, o da `isActive` süzmez) — iki farklı soru (sıra vs hedef statü) |
| A3 | `:309-321` daily | Gün başına toplam ve en-üst-kalite metrajı | `rolls`, `quality_grades` | `factoryDaySql('r."finalizedAt"')` `:311`; aralık `finalizedAt` `:316-317` | A1 ile aynı K18 süzgeci `:318` | `round1` `:434-435`; `pctOf` `:436` | `::float` `:312-313` → `Number` `:430-431` | A1 ile aynı süzgeç (elle kopya, bekçi "günlük seri toplamı = özet" `test_quality_scorecard.ts:186`) |
| A4 | `:325-330` `unanchoredRollCount` | Damgası olmayan final top sayısı | `rolls` | `finalizedAt IS NULL` | `status ∈ {WAREHOUSE, A1_STOCK, SCRAP}` | — | — | kapsam dürüstlüğü (prod: 4, §8.2) |
| A5 | `:334-379` grades | Kalite payı: `pct = qty/totalQty` (metraj ağırlıklı); kalitesizler `__UNGRADED__` sona | JS | — | — | `round1` `:373`, `pctOf` `:374,:377` | A | — |
| A6 | `:232-271` `buildBreakdown` + `:385-398` | Kumaş / renk / fason kırılımı: `topGradePct = topGradeQty/totalQty` | JS | — | fason üç kova: `subId` → `__SUB_UNKNOWN__` (`entrySource=SUBCONTRACTOR_RETURN` ve makbuz yok) → `__INHOUSE__` (`:392-394`) | `round1` `:262-265`, `pctOf` `:264` | A | scrap-scorecard `:303-306` aynı kural (kopya) |
| A7 | `:407-421` summary | `totalQty`, `gradedQty = total − ungraded`, `ungradedQty`, `topGrade.pct` | JS | — | — | `round1`, `pctOf` | A | — |

Notlar: metraj **`currentQty`** (topun şu anki metrajı; finalize anındaki değer saklanmıyor — dosya başlığı `:35-37`, bilinçli restatement). "1. KALİTE" koda gömülü değil (`:39-45`). Fason atfı için `entrySource` load-bearing (`:184-189`).

### 3.B Fire Karnesi — `reports/scrap-scorecard.report.service.ts`

| # | Konum | Tanım | Kaynak | Zaman | Dahil/hariç | Yuvarlama | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|---|
| B1 | `:124-197` `collectScrap` | Dönemde hurdaya ayrılan topların metrajı, kumaş/renk/fason/ilk-hata hücreleri; hata bağı `LEFT JOIN LATERAL … ORDER BY detectedAt, id LIMIT 1` (`:157-176`) | `rolls` (status SCRAP), `roll_errors`, `defect_types`, `subcontractor_receipts` | `rolls.finalizedAt` `:178-179` | `status = 'SCRAP'` `:177` (K18 sorusu yok — SCRAP zaten dışında) | yok | `::float` `:151` → `Number` `:195` (A) | — |
| B2 | `:200-209` `producedTotal` | Dönemde üretimi biten TOPLAM metraj (payda) | `rolls` | `finalizedAt` | `NOT IN K18` `:206` | — | `::float` `:202` → `Number` `:208` | **A1'in kopyası** (aynı WHERE; `test_scrap_scorecard.ts:136-148` eşitliği kilitler) |
| B3 | `:221-284` `collectDetections` | Dönemde TESPİT edilen hata ADEDİ; tür × istasyon; `cut/noCut/open` sayaçları | `roll_errors`, `work_order_steps`, `stations` | **`roll_errors.detectedAt`** `:249` (ayrı çıpa, ayrı birim: ADET) | tümü (isProcessed durumuna göre kovalar) | — | `Number(bigint)` | — |
| B4 | `:327-335` daily | Gün başına hurda metrajı + adedi | `rolls` | `factoryDaySql('r."finalizedAt"')` `:328` | `status='SCRAP'` | `round1` `:390` | `::float` | B1 ile aynı süzgeç |
| B5 | `:365-378` summary | `scrapPct = scrapQty / producedQty` (%) ; `defectsDetected`, `defectsOpen` | JS | — | — | `round1`, `pctOf` `:369` | A | — |

Notlar: hurda metrajı = `rolls.currentQty` — fire yolu (`inventory.service.softDelete` mode SCRAP, `:2997-2998`) **topun metrajına dokunmaz** (2955-3397 aralığında `currentQty/initialQty` yazımı yok; yalnız hareket kapanışı `qtyOut = qtyIn ?? currentQty` `:3238`) → prod'daki tek SCRAP top 300/300 m (§8.2). "Kesim kaybı" metriği bilinçli yok (`:17-23`).

### 3.C Nerede Takıldı (WIP) — `reports/wip-scorecard.report.service.ts`

| # | Konum | Tanım | Kaynak | Zaman | Dahil/hariç | Yuvarlama | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|---|
| C1 | `:85-106` waiting | İstasyon başına ANLIK bekleyen: `cnt = COUNT(*)` açık hareket, `qty = Σ qtyIn`, `oldestDays = MAX(now − enteredAt)/86400`, `avgDays = AVG(…)` | `roll_movements` (`exitedAt IS NULL`), `work_order_steps`, `stations` | **snapshot** (`now()`), tarih filtresi YOK | topun statüsüne bakılmaz (prod: 188 AT_SUBCONTRACTOR + 36 IN_PRODUCTION açık hareket, §8.2) | `round1` `:209-211` | `SUM(qtyIn)::float` `:96` → `Number` | pano `activeCount` (`dashboard.service.ts:92-98`) aynı kümeyi **DISTINCT rollId** ile sayar (adet farkı: hareket vs top) |
| C2 | `:108-120` passed | Dönemde istasyondan ÇIKAN hareket sayısı + ortalama kalış `AVG(exitedAt − enteredAt)` sn | `roll_movements` | `exitedAt ∈ [from,to]` `:118` | `exitedAt IS NOT NULL` | `avgDurationHours = round(avgSec/3600, 1)` `:213` | `Number` | 2026-08-01 öncesi çarpık süre notu `:22-27` |
| C3 | `:122-144` oldestWaiting | En uzun bekleyen 25 top: `qty = qtyIn`, `daysWaiting` | + `rolls`, `items`, `colors`, `work_orders` | `now() − enteredAt` | `LIMIT 25` | `round1` `:252-253` | `qtyIn::float` `:131` | — |
| C4 | `:149-178` neverStarted | Canlı (PLANNED/IN_PROGRESS) ve hiç hareketi olmayan iş emirleri + yaş `now − wo.createdAt` | `work_orders`, `roll_movements` | snapshot | `LIMIT 25` liste, sayaç sınırsız | `round1` | — | prod: 1 (§8.2) |
| C5 | `:220-243` summary | `avgWaitDays` **top ağırlıklı** = Σ(avgDays×cnt)/Σcnt (`:228-238`); `oldestDays` = max | JS | — | — | `round1` | A | — |

Not: `qtyIn` okunur, `qtyOut` HİÇ basılmaz (`:1-10`). Kısmi fason kabulde hareketin `qtyIn`'i değişmez [VARSAYIM] → fasonda kalan bakiye WIP'te tam metrajla görünür (§11 H-lite).

### 3.D İade Karnesi — `reports/return-scorecard.report.service.ts`

| # | Konum | Tanım | Kaynak | Zaman | Dahil/hariç | Yuvarlama | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|---|
| D1 | `:85-149` `collectReturns` | Dönemde iade alınan metraj/adet; müşteri × sebep (3 durumlu: katalog id / `__FREE_TEXT__` / `__NO_REASON__` `:109-118`) × kumaş × renk | `roll_returns` (`qty`, `itemId`, `colorId`, `reasonId`, `reasonText`, `customerId`), `return_reasons` | `roll_returns.createdAt` `:130-131` | `cancelledAt IS NULL` `:132` | — | `SUM(rr.qty)::float` `:124` → `Number` | — |
| D2 | `:190` payda | Aynı dönemde sevk edilen BRÜT metraj | `_shipped.shippedGrossTotal` | `shipments.dispatchedAt` (+ `direct_shipments.shippedAt`) | bkz. §3.E/E0 | — | — | **tek tanım** (`_shipped.ts`) |
| D3 | `:191-199` daily | Gün başına iade metrajı/adedi | `roll_returns` | `factoryDaySql('rr."createdAt"')` `:192` | `cancelledAt IS NULL` | `round1` | `::float` | D1 ile aynı süzgeç |
| D4 | `:219-232` summary | `returnPct = returnQty/shippedQty` (**kohort DEĞİL**: pay dönemde iade, payda dönemde sevk `:23-27`), `freeTextReasonCount`, `missingReasonCount` | JS | — | — | `round1`, `pctOf` `:223` | A | — |

### 3.E Sevk & Termin (OTIF) — `reports/shipment-scorecard.report.service.ts` + `reports/_shipped.ts`

| # | Konum | Tanım | Kaynak | Zaman | Dahil/hariç | Yuvarlama | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|---|
| E0 | `_shipped.ts:46-127` `collectShipped` | Dönemde sevk edilen **BRÜT** metraj, müşteri × kumaş × renk: ① `disp` = DISPATCHED sevkiyatlar (`:59-69`); ② canlı toplar `rolls r JOIN disp ON r.shipmentId` `qty = currentQty`, `cnt = 1` (`:72-73`); ③ iade geri-ekleme `roll_returns rr JOIN disp ON rr.fromShipmentId`, spec snapshot iadenin kendi satırından (`:76-78`); ④ doğrudan sevk topları `rolls.directShipmentId` (`:81-83`); ⑤ **mutabakat satırı** `ds.totalQty − Σ r2.currentQty` kumaş/renk NULL, `cnt = 0`, yalnız fark ≠ 0 ise (`:91-99`) | `shipments`, `rolls`, `roll_returns`, `direct_shipments`, `customers`, `items`, `colors` | `shipments.dispatchedAt ∈ [from,to]` `:68`; `direct_shipments.shippedAt ∈ [from,to]` `:83,:96` | `status='DISPATCHED'` (ikinci savunma `:61-67`); iade `cancelledAt IS NULL` `:78`; **top statüsü süzülmez** (`:72-73`) — prod: DISPATCHED sevkiyattaki tüm toplar SHIPPED (689), PLANNED'daki 12 WAREHOUSE `disp` ile elenir (§8.2) | yok (SQL) | `SUM(p.qty)::float` `:109` → `Number` `:124-125` | **TEK TANIM** — tüketiciler: shipment-scorecard `:128,:162`, return-scorecard `:190,:201`. Kopyalar §6.A |
| E1 | `_shipped.ts:130-133` `shippedGrossTotal` | Σ hücre qty (float) | — | — | — | — | A | — |
| E2 | `:99-121` `collectOtif` | Dönemde KAPANAN siparişlerin termin performansı: `total`, `onTime` (`completedAt ≤ deadline`), `withDeadline`, `noDeadline`, `lateDaysSum = Σ(completedAt − deadline)/86400`, `lateCount` | `orders` | **`orders.completedAt ∈ [from,to]`** `:113` | `status <> 'CANCELLED'` `:114`; terminsiz orandan çıkar ama sayılır | — | `Number(bigint)`; `lateDaysSum` double | — |
| E3 | `:130-137` daily | **Gün başına sevk metrajı = `shipments s JOIN rolls r ON r.shipmentId` `SUM(currentQty)`** — iade geri-eklemesi YOK, doğrudan sevk YOK | `shipments`, `rolls` | `factoryDaySql('s."dispatchedAt"')` `:131` | `status='DISPATCHED'` `:134` | `round1` `:199` | `::float` | **E0'ın NET kopyası** — Σdaily ≠ summary.shippedQty iade/direkt olan dönemde; bekçi kontrol etmiyor (`test_shipment_scorecard.ts:103-118` yalnız kırılım=özet) → **H1** |
| E4 | `:138-161` overdueOpen | Şu an termini geçmiş açık siparişler (25): `daysLate = (now − deadline)/86400`, `plannedQty = Σ aktif kalem quantity` (`:151-152`), `shippedQty = o.shippedQty` (sipariş başlığı) | `orders`, `order_lines`, `customers` | **snapshot** `deadline < now()` `:157` | `status ∈ {PENDING, APPROVED, PARTIAL_SHIPPED}` `:158` | `Math.round(x*10)/10` `:206`; `round1` `:207-208` | `::float` | `plannedQty` aktif kalemlerden, `shippedQty` sipariş başlığından (iptal kalemin sevki dahil, `order-status.helper` I2) — iki farklı küme yan yana |
| E5 | `:168-191` summary | `shippedQty = Σ cells.qty`, `shippedRollCount`, `onTimePct = onTime/withDeadline`, `avgLateDays = lateDaysSum/lateCount` | JS | — | — | `round1`, `pctOf`, satır içi round `:186` | A | — |

### 3.F Fason Karnesi — `reports/subcontract-scorecard.report.service.ts`

| # | Konum | Tanım | Kaynak | Zaman | Dahil/hariç | Yuvarlama | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|---|
| F1 | `:107-174` `collectDispatchItems` SQL | Sevk kalemi başına: `dispatchedQty`; `ret.qty = Σ COALESCE(sri.receivedQty, nr.currentQty)` (kabul defteri; NULL = eski kayıt → doğan topun **CANLI** `currentQty`'si `:141`); `firstReceivedAt = MIN(sr.receivedAt)`; `hasFull = BOOL_OR(NOT isPartial)`; `adj.netQty = Σ(SCRAP → −qty, diğer → +qty)` sapma defterinden (`source='SUBCONTRACTOR_RETURN' ∧ workOrderStepId = sd.stepId ∧ reversedAt IS NULL` `:161-167`); `remainderClosed` | `subcontractor_dispatch_items`, `subcontractor_dispatches`, `subcontractors`, `subcontractor_receipt_items`, `subcontractor_receipts`, `rolls`, `roll_variances` | **`subcontractor_dispatches.dispatchedAt ∈ [from,to]`** `:168-169` (sevk anı; kabul tarihi süzülmez) | `sd.cancelledAt IS NULL` `:170`; `sd.directShippedAt IS NULL` `:173`; makbuz `sr.cancelledAt IS NULL` `:150` | — | `dispatchedQty::float` `:124`, `SUM(...)::float` `:141,:161` → `Number` `:188,:199,:212` (A) | kapanış kuralı = `fason-open-dispatch.helper.ts:48-64`'ün ham SQL **kopyası** (bekçisiz, §6.G); sapma eşleşmesi `rollId+stepId` (`sourceRefId` kullanılmıyor) |
| F2 | `:176-216` JS toplama | Firma başına: `closedDispatchedQty` (yalnız `hasFull ∨ remainderClosed` `:195`), `returnedQty = ret + adj` (`:199`), `turnaroundSum/Count` = `(firstReceivedAt − dispatchedAt)/86_400_000` (`:203`), `openQty = Σ max(0, disp − ret)` açık kalemlerde (`:212`, çekme düzeltmesi girmez `:209-211`) | JS | — | — | — | A | — |
| F3 | `:220-236` `toRow` | `fireQty = closedDispatched − returned` (negatif olabilir), `firePct = fire/closedDispatched`, `avgTurnaroundDays` | JS | — | — | `round1`, `pctOf` `:230`, satır içi round `:234` | A | fason firesi ≠ Fire Karnesi (§6.D) |
| F4 | `:247-295` oldestOpen | Açık sevkler (25): `daysOpen = (now − dispatchedAt)/86400`, `openQty = Σ(dispatchedQty − Σ kısmi receivedQty)` | + `subcontractor_receipt_items` (yalnız `isPartial`) | snapshot (`now()`), tarih filtresi YOK | dört koşul: `cancelledAt IS NULL`, `directShippedAt IS NULL`, `remainderClosedAt IS NULL`, `NOT EXISTS tam makbuz` (`:280-291`) | round `:350`, `round1` `:352` | `::float` | helper `OPEN_OUTSTANDING` kuralının ikinci ham SQL kopyası |
| F5 | `:309-340` summary | Firma hücrelerinin Σ'sı; `firePct` toplamdan | JS | — | — | `round1`, `pctOf` | A | — |

### 3.G Stok & Ölü Stok — `reports/stock-scorecard.report.service.ts`

| # | Konum | Tanım | Kaynak | Zaman | Dahil/hariç | Yuvarlama | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|---|
| G1 | `:138-165` rows | Raftaki HER top (satır bazlı, LIMIT yok): `qty = currentQty`, `days = (now − statusChangedAt)/86400` (NULL → NULL), `width`, `status`, `entrySource` | `rolls`, `items`, `colors` | **snapshot**; yaş çıpası `rolls.statusChangedAt` `:154-156` | `status ∈ {WAREHOUSE, A1_STOCK, STOCK}` `:160`; `shipmentId IS NULL ∧ sackId IS NULL` `:163-164` (çuvaldaki mal raf değil) | — | `::float` `:149,:152,:156` → `Number` `:187-188` | prod: 533 satır (§8.2) |
| G2 | `:167-175` demandRows + `:193-199` | Spec başına açık talep = `Σ max(0, Number(quantity) − Number(shippedQty))` | `order_lines` | — | `order.status ∉ {CANCELLED, COMPLETED}` + `ACTIVE_LINE` `:170-173` | — | `Number()` sonra **float** çıkarma `:195` (A) | `production-balance.ts:230-233` Decimal ikizi (§6.C); K7a 4.1 ailesi |
| G3 | `:201-206` | `finished` = WAREHOUSE+A1_STOCK; `raw` = STOCK ∧ `entrySource ≠ SEMI_FINISHED`; `semi` = STOCK ∧ SEMI_FINISHED | JS | — | — | — | — | envanter `rollScope=RAW_STOCK_PURE/SEMI_FINISHED` ikizi (yorum `:202-204`) — o tarafın kodu K7a/K1 |
| G4 | `:209-217` | Spec başına siparişsiz metraj `max(0, stok − talep)`; spec anahtarı `itemId|colorId|width` (`:132-134`, float width) | JS | — | yalnız `finished` | — | A | spec anahtarı §6.I |
| G5 | `:220-244` byAge | Yaş kovaları `≤7 / ≤30 / ≤90 / 90+` (`:47-52`, `days <= max` `:233`); `agedQty` = `days > 90` (`:239`) — `days` tam 90,0 → "31–90" kovası ama `aged` DEĞİL (tutarlı) | JS | — | çıpasız (`days=null`) kovalara girmez, `unaged*` sayaçlarında (`:228-232`) | `round1`, `pctOf` `:242-243` | A | — |
| G6 | `:250-261` deadQty | **Ölü stok = eski (>90 gün) ∧ siparişsiz**: spec başına `min(eskiMetraj, siparişsizMetraj)` | JS | — | — | `round1` `:311` | A | CLAUDE.md "kesişim" kuralı burada yaşıyor |
| G7 | `:264-286` byItem, `:288-300` oldest | Kumaş başına adet/metraj/`oldestDays`/`uncoveredQty`; en eski 25 top (`slice(0,25)` — JS'te) | JS | — | — | `round1` | A | — |
| G8 | `:302-315` summary | `finishedQty/Count`, `rawQty/Count`, `semiQty/Count`, `agedQty`, `deadQty`, `deadStockDays=90`, `unagedCount/Qty` | JS | — | — | `round1` | A | Stok Karnesi ↔ Envanter sekmeleri ↔ Kanban aynı rakamı vermeli (CLAUDE.md 2026-08-27; bekçi `test_semi_finished_surfaces`) |

Not: `[status, statusChangedAt]` index'i bilinçli yok (`:32-38`); `statusChangedAt` NULL prod'da 39 top (28 IN_PRODUCTION — rapor dışı; 3 WAREHOUSE + 1 SCRAP çıpasız, §8.2).

### 3.H Plan-Sapma Karnesi — `reports/plan-deviation-scorecard.report.service.ts`

| # | Konum | Tanım | Kaynak | Zaman | Dahil/hariç | Yuvarlama | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|---|
| H1 | `:109-127` rows | Dönemin TÜM sapma satırları (Prisma `findMany`, `take` YOK, ilişkili roll/item/color/childRoll/workOrder/confirmedBy) | `roll_plan_deviations` + 5 ilişki | `createdAt ∈ [from,to]` `:107` | tümü | — | `Number(r.qtyM)` `:96,:141,:157,:203` | — |
| H2 | `:91-99` + `:129-130` | `confirmations = DISTINCT confirmationId`, `deviatedQtyM = Σ (imza başına TEK qtyM)` — çift sayım kilidi | JS | — | — | `round1` `:225` | A | bekçi `test_plan_deviation_scorecard.ts §1-§2` negatif sondalı |
| H3 | `:133-142` byField | Alan bazlı OLAY sayısı + metraj (satır bazlı, bilinçli) | JS | — | `field ∈ {color, width}`, diğer alan atlanır `:138-139` | `round1` `:227-228` | A | — |
| H4 | `:146-175` byOperator / byItemColor | İmza bazlı kırılım (`seen` kümesi) | JS | — | onaylayan bilinmiyor → `"—"/"Bilinmiyor"` | `round1` `:161` | A | — |
| H5 | `:179-192` daily | `factoryDaySql(per_conf."createdAt")` üzerinden `COUNT(DISTINCT confirmationId)`, `Σ qty` — iç sorgu `DISTINCT ON (confirmationId)` (`:185`) | SQL | fabrika günü | — | `round1` `:239` | `Number(Prisma.Decimal)` `:239` | — |
| H6 | `:194-206` detail | İlk 200 satır (`DETAIL_LIMIT` `:83`), sorgu kırpılmaz | JS | — | — | — | Ç | — |
| H7 | `:210-220` previous | İkinci `findMany` (yalnız `confirmationId, qtyM`) | — | compare | — | `round1` | A | — |

### 3.I Müşteri Karnesi — `reports/customer-scorecard.report.service.ts`

| # | Konum | Tanım | Kaynak | Zaman | Dahil/hariç | Yuvarlama | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|---|
| I1 | `:118-150` `collectPeriod` | Müşteri başına dönem: `orderCount`, `lineCount`, `qty = Σ quantity`, kumaş başına qty (`itemQty`) — Prisma `order.findMany` + `lines` (tavan yok) | `orders`, `order_lines`, `items` | **`orders.orderDate ∈ [from,to]`** `:121` | `status ≠ CANCELLED` `:122`; kalem `ACTIVE_LINE` `:127` | — | `Number(l.quantity)` `:142` (A, float Σ) | — |
| I2 | `:168-204` `collectLifetime` | TÜM GEÇMİŞ: `orderCount = COUNT(DISTINCT o.id)`, `qty = Σ ol.quantity`, `firstOrder/lastOrder = MIN/MAX orderDate` | `customers`, `orders`, `order_lines` (ham SQL) | tüm zaman | `c.mergedIntoId IS NULL` `:191`; `o.status <> 'CANCELLED'` `:188`; `ol.cancelledAt IS NULL` `:190` (ham SQL kopyası, bekçili) | `round1` `:199` | `::float8` `:184` | müşteri profili raporu (`customer.report.service`) FARKLI küme (§6.K) |
| I3 | `:219` `daysBetween` = `Math.floor((now − lastOrder)/86_400_000)`; `:226-231` `rhythm = span/(orderCount−1)`, en az 3 sipariş | JS | mutlak | — | `round1` `:230` | — | — | — |
| I4 | `:236-282` ranking + ABC | `sharePct = qty/totalQty`; `cumulativePct` = Σ yuvarlanmış `sharePct` (`:270-271`, `min(cum,100)`); A ≤80 / B ≤95 / C; Pareto kesme düzeltmesi `:277-282` | JS | — | — | `round1`, `pctOf` `:248` | A (yuvarlanmış payların birikimi) | demand-analysis `coreSpecCount` aynı desen `:237-243` |
| I5 | `:285-316` atRisk | `ratio = round1(days/interval) ≥ 2` | JS | — | `interval === null` → `insufficientHistory` | `round1` `:296` | A | — |
| I6 | `:319-340` summary | `aClassQtyPct = Σ A.totalQty / totalQty`, `dormantCount` (ömür var, dönemde yok) | JS | — | — | `pctOf`, `round1` | A | — |

### 3.J Müşteri Sipariş Profili — `reports/customer.report.service.ts`

| # | Konum | Tanım | Kaynak | Zaman | Dahil/hariç | Yuvarlama | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|---|
| J1 | `:24-118` tek SQL | Müşteri başına `order_count = COUNT(DISTINCT o.id)`, `line_count = COUNT(ol.id)`, `last_order_date = MAX(orderDate)`; en sık kumaş/renk/en (`DISTINCT ON … COUNT(*) DESC`); `LIMIT 200` `:104`; `order_count > 0` `:102` | `customers`, `orders`, `order_lines`, `items`, `colors` | tüm zaman | `c.isActive = true` `:52` (**`mergedIntoId` süzgeci yok**); **sipariş statüsü süzülmez** (CANCELLED dahil) `:49`; kalemler `cancelledAt IS NULL` `:51,:61,:72,:83` | — | `Number(bigint)`, `topWidth` `Number` `:115` | `orderCount` tanımı I2/§6.K ile ayrışık |

### 3.K Talep Analizi — `reports/demand-analysis.report.service.ts`

| # | Konum | Tanım | Kaynak | Zaman | Dahil/hariç | Yuvarlama | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|---|
| K1 | `:103-133` `collect` | Dönemin TÜM aktif kalemleri (Prisma, tavan yok): `qty = Number(quantity)`, spec = `itemId|colorId ?? "-"|width.toString() ?? "-"` (`:100-101`) | `order_lines`, `orders`, `items`, `colors` | `order.orderDate ∈ [from,to]` `:107` | `order.status ≠ CANCELLED` `:108`; `ACTIVE_LINE` `:111` | — | `Number(l.quantity)` `:131` (A) | spec anahtarı §6.I |
| K2 | `:139-161` `collectMonthly` | Son 24 ayın aylık talebi: `factoryMonthSql(o."orderDate")`, `Σ ol.quantity`, `COUNT(ol.id)` | ham SQL | **`orderDate ≥ now() − 24 months`** (mutlak) `:152`; gruplama fabrika ayı `:141` | `ol.cancelledAt IS NULL` `:148`; `o.status <> 'CANCELLED'` `:149` | `round1` `:158` | `::float8` `:142` | dönemden bağımsız (bilinçli `:13-17`) |
| K3 | `:173-243` | `totalQty`, spec listesi (`lineCount`, `customerCount` = Set, `qty`, `sharePct`), `coreSpecCount` = %80'e ulaşan spec sayısı (yuvarlanmış `sharePct` birikimi `:237-243`), `MAX_SPECS=300` kırpma + `specsOmitted` | JS | — | — | `round1`, `pctOf` | A | — |
| K4 | `:245-250` byItem/byColor | `_breakdown` ile, `countOf = 1` (kalem adedi) | JS | — | — | `round1` | A | — |
| K5 | `:253-265` summary | `itemCount`, `colorCount` (renkli kalemler), `colorlessQty` (renksiz talep) | JS | — | — | `round1` | A | — |

### 3.L Açık Sipariş Karşılanma — `reports/open-order-coverage.report.service.ts`

| # | Konum | Tanım | Kaynak | Zaman | Dahil/hariç | Yuvarlama | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|---|
| L1 | `:153` | Motor = `new ProductionBalanceService().getBalance()` (tüm spec'ler) | §3.Q | snapshot | — | — | — | **motor tek** (bilinçli; `order.service.getCoverageForLines` kullanılmaz `:12-18`) |
| L2 | `:175-248` | Spec havuzları (`depo`, `uretimde`) satırlara **aciliyet sırasıyla** (`byUrgency` `:105-113`: termin ASC, terminsiz sona → orderDate → orderNumber) dağıtılır: `need = line.remaining` (Decimal, `:184`), `fromWh = min(pool, need)`, `fromProd = min(prodPool, need − fromWh)`, `uncovered = need − fromWh − fromProd` (`:190-192`); durum HAZIR/KISMI/URETIM_GEREKLI (`:194-198`); `late = floor((now − deadline)/86_400_000)` (`:203-206`) | Decimal | mutabakat: `now` snapshot | `remaining ≤ 0` atlanır `:185` | `Math.floor` gün | Decimal → `Number` çıkışta (`:237-243`) | — |
| L3 | `:129-148` `bucketRows` | Müşteri/kumaş kovası: `uncovered = max(0, open − wh − prod)`, `coveragePct = (wh+prod)/open×100` (**Decimal** `:141-143`) | Decimal | — | — | `round1(Number(...))` | Ç | summary'deki `coveragePct` **float** ile hesaplanır (`:275-276`) — aynı formül iki aritmetik |
| L4 | `:259-282` summary | `openQty`, `fromWarehouseQty`, `fromProductionQty`, `uncoveredQty = max(0, open − wh − prod)`, `materialGapQty = Σ grp.malzemeAcigi` (`:176`), satır sayaçları, `overdueUncovered*`, `linesOmitted` (`MAX_DETAIL_LINES=500` `:34`) | Decimal/float | — | — | `round1` | A (`:276`) | bekçi `test_open_order_coverage.ts:132-136` özet = Σ satır |

### 3.M Sipariş Karnesi (giriş) — `reports/order-intake.report.service.ts`

| # | Konum | Tanım | Kaynak | Zaman | Dahil/hariç | Yuvarlama | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|---|
| M1 | `:111-169` `collect` | Dönemde açılan siparişler (Prisma, tavan yok, `lines` ACTIVE_LINE): `orderCount` (**iptaller DAHİL** `:132`), `cancelledCount` (`:141-144`), `lineCount`/`totalQty`/müşteri hücreleri (**iptaller HARİÇ**), `withDeadlineCount`; sipariş metrajı Decimal `plus` (`:148-150`) sonra `Number` (`:158`) | `orders`, `order_lines`, `customers`, `items` | **`orders.orderDate ∈ [from,to]`** `:113` | statü süzgeci YOK (adet), CANCELLED metraj dışı | `round1(totalQty)` `:167` | Decimal→`Number` `:155,:158` (A: float Σ `:159`) | — |
| M2 | `:172-191` `collectDaily` | Gün başına `COUNT(DISTINCT o.id)` + `Σ ol.quantity` | ham SQL | `factoryDaySql('o."orderDate"')` `:174` | `ol.cancelledAt IS NULL` `:180`; **`o.status <> 'CANCELLED'`** `:182` → günlük `orderCount` iptalleri DIŞLAR, özet `orderCount` DAHİL eder (Σdaily.orderCount ≠ summary.orderCount) | `round1` `:189` | `::float8` | — (§6.K, H-lite) |
| M3 | `:210-232` summary | `cancelledPct = cancelled/orderCount`, `activeOrderCount`, `avgOrderQty = totalQty/activeOrderCount`, `avgLinesPerOrder`, `customerCount` | JS | — | — | `pctOf`, `round1` `:211` | A | — |

### 3.N Sipariş → Teslim Süresi — `reports/order-leadtime.report.service.ts`

| # | Konum | Tanım | Kaynak | Zaman | Dahil/hariç | Yuvarlama | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|---|
| N1 | `:134-178` `collect` | Dönemde açılan siparişler: `firstShipAt = LEAST(MIN sevk dispatchedAt, MIN doğrudan shippedAt)` (`:143,:147-166`; kalem iptali süzülmez — `aktif-kalem-muaf` `:149-152,:161-162`), `completedAt`, kumaş listesi (aktif kalemler `:173`) | `orders`, `order_lines`, `sack_allocations`, `sacks`, `shipments` (DISPATCHED `:156`), `subcontractor_direct_ship_allocations`, `direct_shipments` | **`orders.orderDate ∈ [from,to]`** `:175` | `status <> 'CANCELLED'` `:176` | — | — | ilk sevk kaynağı `getOrderShipments` ile aynı iki kaynak (yorum `:128-133`) |
| N2 | `:181` `days`, `:94-98` `percentile` (nearest rank `ceil(p/100·n)`), `:100-111` `stats` | `firstShipDays = (firstShipAt − orderDate)/86_400_000`, `fullCloseDays = (completedAt − orderDate)/…`; medyan = p50, `p90`, `avg`, `min`, `max`; `MIN_SAMPLE=5` (`:35`, yalnız istemciye sinyal) | JS | mutlak | — | `round1` her değerde `:105-110,:195-196` | — | medyan tanımı: nearest-rank (çift n'de ALT orta) — order-cancellation `:244-247` aynı sonucu verir (`ceil(n/2)`) |
| N3 | `:219` | Çok kumaşlı sipariş her kumaşa sayılır (bilinçli `:215-218`) | JS | — | — | — | — | — |
| N4 | `:229` `openDays` | Hiç sevk görmemiş siparişin yaşı `now − orderDate` | JS | mutlak | — | `round1` | — | — |

### 3.O Sipariş İptal Karnesi — `reports/order-cancellation.report.service.ts`

| # | Konum | Tanım | Kaynak | Zaman | Dahil/hariç | Yuvarlama | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|---|
| O1 | `:130-145` rows | Dönemde iptal edilen siparişler: `qty = Σ aktif kalem quantity` (`:140-141`), `shippedQty = o.shippedQty` (başlık) | `orders`, `customers`, `order_lines` | **`orders.cancelledAt ∈ [from,to]`** `:144` (kolon prod kopyasında YOK — migration `20260826130100`) | `status='CANCELLED'` `:143` | — | `::float8` `:133-134` | — |
| O2 | `:146` `openedInPeriod` | Dönemde AÇILAN sipariş adedi (payda; TÜM statüler) | `orders` | `orderDate ∈ [from,to]` (**farklı çıpa**, yorum `:99`: "iki farklı küme, oran YAKLAŞIKTIR") | — | — | — | — |
| O3 | `:147` `undated` | `status='CANCELLED' ∧ cancelledAt IS NULL` (eski iptaller, dönem dışı) | `orders` | — | — | — | — | dev: 4/4 iptal damgasız (§8.3) |
| O4 | `:152-165` daily | `factoryDaySql('o."cancelledAt"')`, `COUNT(*)`, `Σ aktif kalem` | ham SQL | fabrika günü | O1 ile aynı | `round1` `:289` | `::float8` | — |
| O5 | `:184-234` döngü | `daysToCancel = round1(max(0, (cancelledAt − orderDate)/86_400_000))` `:186`; `afterShipmentCount/Qty` (`shipped > 0` `:191`); sebep kovası `cancelReasonCode ?? __NO_REASON__` (`:198`), etiket katalogdan (`reasonPreset` ORDER_CANCEL `:148-151,:170`) | JS | — | — | `round1` `:189-190` | A | — |
| O6 | `:237-242` + `:272-285` | Müşteri başına `cancelRatePct = count/opened` (payda `orderDate` bazlı `groupBy`) | Prisma | `orderDate` | — | `pctOf` | — | O2 ile aynı çıpa ayrımı |
| O7 | `:244-247` median | `sorted[min(ceil(n/2), n) − 1]` — çift n'de ALT orta | JS | — | — | `round1` | — | leadtime `percentile` ile aynı sonuç |
| O8 | `:250-271` summary/byReason | `reasonFillPct = withReason/count`, `sharePct` **adet** bazlı `:268` (metraj değil) | JS | — | — | `pctOf`, `round1` | A | — |

### 3.P Parti İzleme / Top İzleme / Operatör İş Hacmi / Denetim

| # | Konum | Tanım | Kaynak | Zaman | Dahil/hariç | Yuvarlama | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|---|
| P1 | `batch-trace.report.service.ts:81-123` `searchBatches` | Parti no `ILIKE %q%` VEYA topun barkodu (`normalizeScanCode`) → aday listesi: `rollCount = COUNT(r.id)`, `qty = Σ currentQty` (**tüm statüler**, CANCELLED/consumed dahil `:100`), `merged`; `ORDER BY createdAt DESC` (`:111`), `LIMIT 20` | `batches`, `work_orders`, `rolls` | — | — | `round1` `:120` | `::float` | parti no benzersiz değil → daima liste (CLAUDE.md) |
| P2 | `:125-246` `getBatchTrace` | `byStatus` (tüm statüler, `Σ currentQty`), `customers` = canlı bağ (`rolls.shipmentId`) **UNION** iade geri-eklemesi (`roll_returns.fromShipmentId`, `cancelledAt IS NULL` `:152-161`) → `shipmentCount = DISTINCT shipment`, `rollCount = DISTINCT roll`, `qty = Σ`, `lastDispatchedAt`; `returns`; `subcontractorDispatches` (**iptal edilenler `cancelled` bayrağıyla dahil** `:193-197`); `totals = Σ yuvarlanmış byStatus` (`:217-220`) | `rolls`, `shipments`, `roll_returns`, `customers`, `return_reasons`, `subcontractor_dispatches`/`_items` | — | sevk statüsü süzülmez (PLANNED sevkiyattaki top da "gitti" görünür [VARSAYIM: `rolls.shipmentId` PLANNED'da da dolu — prod'da 12 WAREHOUSE top PLANNED sevkiyata bağlı, §8.2]) | `round1` | `::float` | brüt kuralının izleme karşılığı |
| P3 | `production.report.service.ts:33-74` `getOperatorPerformance` | Operatör başına işlem adedi: `totalOps`, `kursun/qc2/tambur/subcontractorOps` | `roll_operations`, `users` | `roll_operations.createdAt ∈ [from,to]` `:57` | `inheritedFromParentRollId IS NULL` `:58` (Tambur kalıtım kopyaları dışı); `LIMIT ${limit}` | — | `Number(bigint)` | — |
| P4 | `:108-210` `getTravelerTrace` | Tek topun hareket (IN/OUT) + operasyon zaman çizelgesi: `qty = Number(qtyIn)` / `qtyOut ?? null` (`:163,:177`); top `initialQty/currentQty/width` `Number` (`:204-206`) | `rolls`, `roll_movements`, `roll_operations` | `enteredAt/createdAt ASC`; olaylar `at` ile JS sort (`:198`) | operasyon `inheritedFromParentRollId: null` `:140`; hareketlerde `take` yok (top başına sınırlı) | — | `Number(Decimal)` Ç | `qtyOut NULL` okuyucusu (K7a H5) |
| P5 | `audit.report.service.ts:22-99` `getSystemLogSummary` | `byAction` (LIMIT yok), `byTable` (LIMIT 30), `daily` (create/update/delete), `totalLogs = Σ byAction` (`:86`, ayrı COUNT yok) | `system_logs` | `createdAt ∈ [from,to]`; daily `factoryDaySql('"createdAt"')` `:74` — ifade istatistiği `sl_day_exact` ile eşleşir (§8.3) | — | — | `Number(bigint)` | — |
| P6 | `:114-154` `getUserActivity` | Kullanıcı başına C/U/D adedi + `MAX(createdAt)`; `LIMIT 100` | `system_logs`, `users` | `createdAt` | — | — | — | — |

### 3.Q Ürün Dengesi — `services/production-balance.service.ts` (K7a I19-I22'nin ayrıntısı; buradaki odak zaman/statü/tek kaynak)

| # | Konum | Tanım | Kaynak | Zaman | Dahil/hariç | Yuvarlama | Tip | Tek kaynak? |
|---|---|---|---|---|---|---|---|---|
| Q1 | `:189-263` talep | Açık kalemler (Prisma, tavan yok, 4 ilişki): `remaining = max(0, quantity − shippedQty)` (`:230-233`), `talep += remaining`, satır `open = remaining.floor()` (`:256`, tam metre) | `order_lines` (+`orders`, `customers`, `items`, `colors`, `requiredProperties`) | snapshot | `order.status ∉ {CANCELLED, COMPLETED}` `:191`; `ACTIVE_LINE` `:193`; `itemId` daraltması `readIdCondition` (`:146,:194`) | `floor` (satır) | Decimal | `stock-scorecard` G2 float ikizi; K7a 4.1 |
| Q2 | `:272-282` arz | `groupBy(itemId,colorId,width,status,entrySource)` `Σ currentQty` | `rolls` | snapshot | `status ∈ {WAREHOUSE, STOCK}` (**A1_STOCK arz DEĞİL**), `shipmentId IS NULL ∧ sackId IS NULL` | — | Decimal | Stok Karnesi `finished` A1_STOCK'u sayar (§6.M) |
| Q3 | `:285-324` üretimde | Canlı WO (`PLANNED/IN_PROGRESS`, `isActive`, `targetItemId` dolu): `inFlight = max(0, committed − finished)` (`computeWoMaterial`, `coverage.helper.ts:91-137`; `finished` = `producedInStepId ∈ WO ∧ status ∈ {WAREHOUSE, A1_STOCK, SHIPPED, SCRAP}` `:34-39`) | `work_orders` + helper'ın 6 sorgusu | snapshot | — | — | Decimal | K7a H9 (kartela/CANCELLED çıktı "bitmiş" sayılmaz) |
| Q4 | `:336-368` | Depo birebir spec (`specKey` `:32-39`, `Decimal(width).toString()`), `qty ≤ 0` atlanır (`:343`); `uretilecek = max(0, talep − depo − uretimde)` (`:365-368`); satır yalnız `talep>0 ∨ uretimde>0` ise (`:369`) | JS | — | — | — | Decimal | — |
| Q5 | `:385-436` grup | (ürün, renk) grubu: `ham` = sevksiz STOCK ∧ `entrySource ≠ SEMI_FINISHED`, `yariMamul` = SEMI_FINISHED; en-agnostik, renk-joker (`:418-424`); **`malzemeAcigi = max(0, uretilecek − (ham + yariMamul))`** (`:430-433`) | JS | — | — | — | Decimal | CLAUDE.md 2026-08-27 "arzdan DÜŞÜLMEZ" burada; bekçi `test_semi_finished_surfaces §2/§4` |

### 3.R Pano — `services/dashboard.service.ts`

| # | Konum | Tanım | Kaynak | Zaman | Dahil/hariç | Tip | Tek kaynak? |
|---|---|---|---|---|---|---|---|
| R1 | `:52-59` `getDefectsSummary` | `openCount = isProcessed=false` (tüm zaman), `todayCount = detectedAt ≥ bugün` | `roll_errors` | `factoryDayStart()` (`:46-48`) | — | int | fire karnesi `defectsOpen` (dönem içi tespit edilenlerin açığı `scrap-scorecard:244`) FARKLI küme (tüm zaman vs dönem) |
| R2 | `:86-91` `queueCount` | İstasyonun adımlarına `currentStepId` ile bağlı **tüm** toplar (statü süzgeci YOK) | `rolls`, `work_order_steps` | snapshot | prod: currentStepId yalnız IN_PRODUCTION(37)+AT_SUBCONTRACTOR(188) taşıyor (§8.2) | int | — |
| R3 | `:92-98` `activeCount` | Açık hareketli DISTINCT top | `roll_movements` | snapshot | — | int | WIP C1 (hareket sayısı) ikizi |
| R4 | `:99-105` `todayCompletedCount` (INTERNAL) | Bugün `exitedAt` dolan DISTINCT top | `roll_movements` | `exitedAt ≥ factoryDayStart()` | storno kapanışı (`qtyOut=0`) da sayılır [VARSAYIM: CANCELLED kapanışı `exitedAt` yazar — `roll-disposition.helper:334-337`] | int | "üretilen" ailesinin 4. tanımı (adet, hareket) §6.B |
| R5 | `:106-115` EXTERNAL | Bugün kabul edilen makbuz kalemi adedi (`sr.cancelledAt IS NULL`, `receivedAt ≥ bugün`) | `subcontractor_receipt_items`, `_receipts` | `receivedAt` | — | int | — |
| R6 | `:116-125` `todayDispatchedCount` | Bugün fason sevk kalemi adedi (`sd.cancelledAt IS NULL`, `dispatchedAt ≥ bugün`) | `subcontractor_dispatch_items`, `_dispatches` | `dispatchedAt` | `directShippedAt` süzülmez (bilinçli: sevk edildi) | int | — |
| R7 | `:126-135` RAW_QC | Bugün giren ham top: `entrySource ∈ {SUPPLIER_RECEIPT, MANUAL_ENTRY} ∧ colorId IS NULL ∧ createdAt ≥ bugün` | `rolls` | `createdAt` | **SEMI_FINISHED girişi ve renkli ham giriş sayılmaz** | int | mobil KK1 "Son Kayıtlar" kapsamı (yorum `:127-129`) — 2026-08-26 yarı mamul notu "mobil KK1 kendi yazdığı topu gizliyordu" (K-mobil) |

### 3.S Muhasebe Export — `services/accounting-export.service.ts`

| # | Konum | Tanım | Kaynak | Zaman | Dahil/hariç | Yuvarlama | D→N | Tek kaynak? |
|---|---|---|---|---|---|---|---|---|
| S1 | `:121-152` where | `listShipments` ile aynı `buildWhereClause` + `status = DISPATCHED` `:127` + müşteri CSV `readIdCondition` `:141-152` | `shipments` | — | — | — | — | filtre kopyası (yorum `:18-19`) |
| S2 | `:168-200` pencere | SEÇİM modu `ids=` (≤200 `:45`, UUID doğrulama) → tarih yok; DÖNEM modu: `effField ∈ {createdAt, dispatchedAt}` (varsayılan `dispatchedAt`), `effTo = dateTo ?? now`, `effFrom = dateFrom ?? effTo − 90 gün` (`DEFAULT_DAYS=90` `:49`), max 366 gün | — | **mutlak an**, istemci gün sınırı (`:160-167`) | — | — | — | `_shared.resolveDateRange` (30 gün) ile **farklı varsayılan pencere** (90 gün) |
| S3 | `:229-239` guard | `shipment.count + directShipment.count > 2000` → 400 | — | — | — | — | — | — |
| S4 | `:241-273` + `:318-448` sevk satırları | Sevkiyat başına: `sackCount`, `rollCount`, `totalMeters = Σ sack.rolls.currentQty` **+ iade geri-ekleme** (`roll_returns.fromShipmentId`, `cancelledAt: null` `:290-306,:369-382`), `totalKg = Σ sack.weightKg` (iade ile değişmez `:365-367`); ürün grubu anahtarı `itemId|colorId|width` (`:331`, `Number(width)`) | `shipments`, `sacks`, `rolls`, `roll_returns`, `items`, `colors` | satır tarihi `dispatchedAt ?? createdAt` (`:385`; DISPATCHED'da null yok, §8.2) | çuvaldaki top statüsü süzülmez (K7a 4.3 "SACK_ABSENT" ayrımı: burada yok) | yok — Decimal | Decimal `.plus` → `Number` `:404-405,:420,:627-628,:642-644` (Ç) | brüt kuralının 3. tüketicisi; `getDispatchReport` snapshot okur (`shipping:3180`), burası `RollReturn` |
| S5 | `:452-560` doğrudan sevk | `totalMeters = Σ ds.rolls.currentQty` (`:480-482`) — **`DirectShipment.totalQty` KULLANILMAZ**; `totalKg = 0`, `sackCount = 0`, `destination = 'DOMESTIC'` sabit (`:513`) | `direct_shipments`, `rolls` | `shippedAt` (dönem) / `createdAt` (`:223-224`) | — | — | Decimal → `Number` | Sevkiyatlar listesi `mapDirect.totalMeters = Number(d.totalQty)` (`shipping.service.ts:2426`), `_shipped` 3a+3b `totalQty`'ye mutabakat → **üç yüzey iki tanım** (§6.A) |
| S6 | `:566-606` iadeler | Seçim modunda `fromShipmentId ∈ ids`; dönem modunda **`roll_returns.createdAt ∈ [effFrom, effTo]`** (+ müşteri) — sevk satırlarıyla farklı çıpa (bilinçli `:10-16`) | `roll_returns` | `createdAt` | `cancelledAt: null` | — | `Number(rr.qty)` | — |
| S7 | `:620-645` icmal | `byCustomer` anahtarı **`customer.code || customer.name`** (`:424,:540`) — kod boşsa ada düşer; `byProduct` id-bazlı (F251 `:324-326`); `totals.returnMeters` | JS | — | — | — | Decimal → `Number` | — |

### 3.T İşlem Dökümü — `services/work-session-activity.service.ts`

| # | Konum | Tanım | Kaynak | Zaman | Dahil/hariç | Yuvarlama | D→N |
|---|---|---|---|---|---|---|---|
| T1 | `:184-186` pencere | `[session.startedAt, session.endedAt ?? now]` | `work_sessions` | mutlak | — | — | — |
| T2 | `:211-326` altı kaynak (her biri `take = 1001` `:187`) | ROLL_CREATED (`rolls.createdAt`, `createdMachineId/createdById` atfı `:202-209`), OPERATION (`roll_operations.createdAt`, `inheritedFromParentRollId: null`), MOVE_IN (`enteredAt`, yalnız `operatorId`), MOVE_OUT (`exitedAt`, makine ∨ operatör `:191-199`), ERROR (`detectedAt`, `detectedByUserId`), ROLL_CANCELLED (`system_logs` `tableName=ROLL ∧ newData.status='CANCELLED'` `:308-325`) | 6 tablo | pencere `gte/lte` | — | — | `toNum` (`Number(Decimal)`) `:357,:385-386,:403-404,:421` |
| T3 | `:390-410` MOVE_OUT | `stayMinutes = max(0, round((exitedAt − enteredAt)/60_000))` (`:408`, saat kayması → 0'a kırp) | JS | mutlak | — | `Math.round` dk | — |
| T4 | `:345-440` sıralama | `at ASC → phaseRank → id` (`:124-131`; `OP_RANK` `:107-113`, bilinmeyen op 8) | JS | — | — | — | — |
| T5 | `:442-454` | `truncated = events > 1000`; özet sayaçları **tüm** olaylardan (kırpılmış listeden değil, F225) | JS | — | — | — | — |

### 3.U Gecikme telemetrisi — `latency-stats.service.ts` / `latency-persist.service.ts` / `middlewares/latency.middleware.ts`

| # | Konum | Tanım | Yer | Zaman | Yuvarlama |
|---|---|---|---|---|---|
| U1 | `latency.middleware.ts:96-112` | Süre = `hrtime.bigint()` farkı / 1e6 ms; `finish` → statü, `close` (abort) → **499** (`:94,:109-110`); anahtar `METHOD + normalize(baseUrl+route.path)` (UUID/sayı/uzun opak segment → `:id` `:32-43`; 404 → `(eşleşmeyen)`, route'suz `/api/*` → normalize path, diğer → `(statik/diğer)` `:65-89`) | bellek | — | — |
| U2 | `latency-stats.service.ts:107-134` `recordLatency` | Route başına `count`, `errCount` (≥500), `maxMs`, logaritmik bucket sayaçları (`BUCKET_BOUNDS_MS` `:18-21`), `MAX_ROUTE_KEYS=500` → `(diğer)`; yavaş istek ring'i ≥1 000 ms, 50 kayıt | bellek (süreç) | `Date.now()` | `Math.round(ms)` ring'de |
| U3 | `:83-100` `percentileFromBuckets` | `target = ceil(count·p)`; kümülatif bucket ≥ target → `min(bucket üst sınırı, round(maxMs))`; +∞ → `maxMs` | saf | — | bucket üst sınırı (yaklaşık, yorum `:12-14`) |
| U4 | `latency-persist.service.ts:84-106` `noteLatencyDelta` | Aynı bucket hizasıyla delta biriktirir (`MAX_PENDING_KEYS=600`, `routeKey` 200 kr kırpma `:39,:85`); 5 dk'da bir `setImmediate(flush)` | bellek | `Date.now()` | — |
| U5 | `:113-184` `flushLatencyNow` | `day = factoryDayKeyUtcMidnight()` (`:71-73`); satır başına `findUnique → update(increment, max, bucket birleşimi max-uzunluk) / create` (`:124-157`); retention günde 1: `deleteMany(day < bugün − 90)` (`:167-180`, `setUTCDate`) | `endpoint_latency_daily` (`@db.Date`, unique `[day, routeKey]` — `schema.prisma:5247-5260`) | fabrika günü | `Math.round(maxMs)` |
| U6 | `:210-248` `latencyHistory` | Son N gün (`from = bugün − (N−1)` UTC-midnight) satırları (`take 60_000`), gün içinde route'lar **birleştirilip** persentil birleşik bucket'tan (`:244-245`) | DB | `day ≥ from` | — |
| U7 | `:251-262` `latencyHistoryRoutes` | Son N günde görülen route anahtarları (`distinct`, `take 2_000`) | DB | — | — |

Bu üçlü `express-api-audit` §6 YP kuralına göre **metrik toplayıcıdır**, scheduler değil (idempotent; atlanması/çift koşması zararsız) — K8 alanına satır önerilmez; yalnız `flushFailures/lastFlushError` sağlık sayacı (`:187-194`) `/api/admin/perf` cevabında görünür (`admin.routes.ts:731`).

---

## 4. DECIMAL → NUMBER / FLOAT dönüşüm haritası (kapsam)

| Yol | Nerede | Örnek | Not |
|---|---|---|---|
| **SQL tarafında double** (`::float`/`::float8`) | 31 vuruş: `_shipped:109`, quality `:177,:312-313`, scrap `:151,:202,:329`, return `:124,:193`, shipment `:132,:151,:153`, subcontract `:124,:141,:161,:269`, wip `:96,:131`, stock `:149,:152`, batch-trace `:96,:137,:167,:176,:192`, customer-scorecard `:184`, demand `:142`, intake `:176`, cancellation `:133-134,:155` | `SUM(numeric)::float` | PG `numeric → float8` yuvarlaması (15-17 anlamlı basamak; 12,3 ölçekli metraj kayıpsız); sonra JS'te `Number(r.qty ?? 0)` ve **float toplama** (`cells.reduce`) |
| **JS `Number(Decimal)` sonra aritmetik (A)** | quality `:213→:337-357`, scrap `:195→:343`, return `:147→:204`, shipment `:168`, subcontract `:188,:199,:212→:221`, wip `:209-241`, stock `:187,:195→:212-216,:220`, customer-scorecard `:142→:143-145`, demand `:131→:173,:200`, intake `:155,:158→:159`, plan-dev `:96,:141,:157`, open-order-coverage `:276` (yalnız summary pct) | `a.qty += q` | 1-ondalıklı saha verisinde fark gözlenmez; 3-ondalıklı girişte 0,1 m yuvarlama sonrası fark **teorik** (K7a §1.3: prod'da 3-ondalıklı satır 0) |
| **Decimal aritmetiği, çıkışta `Number` (Ç)** | production-balance (tamamı Decimal, `ApiResponse` serializer `Decimal.prototype.toJSON` — K7a §0.1), open-order-coverage `:116-119,:184-192,:212-214` → `Number` `:137-143,:237-243,:265-274`, accounting-export `:342,:348,:351,:371,:440-447,:482,:491,:496,:555-559,:594` → `Number` `:404-405,:420,:520,:536,:603,:627-635,:642-644`, order-intake `:148-150` → `Number` `:158` | `.plus()` | kayıpsız |
| **`Number(bigint)`** | tüm `COUNT(*)` çıktıları | — | 2^53 altı |
| **Genişlik** | stock `r.width::float` `:149` → `specKey` template; demand `width.toString()` `:101` (Decimal); production-balance `new Decimal(width).toString()` `:37`; accounting-export `Number(width)` `:358,:378,:485` | — | `"150"` ↔ `150` ↔ `"150"` — tamsayı ende eşit; `150.5` → `"150.5"` her üçünde |

Yuvarlama politikası (rapor katmanı): **sunucu 0,1 m / %0,1** (`round1`/`pctOf`, `Math.round` = yarım-yukarı, negatifte `Math.round(-0.05*10)/10 = -0`), gün/saat 0,1; `stayMinutes` tam dk; `open` (denge) tam metre **taban**; `daysBetween`/`late` tam gün **taban**; medyan/persentil nearest-rank. Ondalık kısıtı girişte yok (K7a §1.2). Electron "TOPLAM" satırı yuvarlanmış satırları toplar (§1.3).

---

## 5. ZAMAN TEMELİ TABLOSU

### 5.1 Metrik × kolon × gün-sınırı yöntemi × index

| Metrik / rapor | Zaman kolonu | Aralık süzgeci (uçlar) | Gün/ay gruplaması | "Bugün"/yaş | Index (şema) |
|---|---|---|---|---|---|
| Kalite Karnesi (A1-A7) | `rolls.finalizedAt` | istemci mutlak an (`>= from AND <= to`) | `factoryDaySql` (`:311`) | — | `@@index([finalizedAt])` PARTIAL `WHERE finalizedAt IS NOT NULL` (`schema:1785-1790`, migration `:33-35`) |
| Fire Karnesi hurda (B1,B4) | `rolls.finalizedAt` | aynı | `factoryDaySql` (`:328`) | — | aynı |
| Fire Karnesi tespit (B3) | `roll_errors.detectedAt` | aynı | — | — | `@@index([detectedAt])` |
| Sevk hacmi (E0,E1) | `shipments.dispatchedAt` + `direct_shipments.shippedAt` | aynı | — | — | `@@index([status, dispatchedAt])`, `@@index([shippedAt])` |
| Sevk günlük seri (E3) | `shipments.dispatchedAt` | aynı | `factoryDaySql` (`:131`) | — | aynı |
| OTIF (E2) | **`orders.completedAt`** | aynı | — | gecikme `completedAt − deadline` (mutlak) | **index YOK** (`orders`: `[status,createdAt]`, `deadline`, `createdAt`, `customerId`, `branchId`) |
| Geciken açık (E4) | `orders.deadline` | — | — | `deadline < now()` (mutlak) | `@@index([deadline])` |
| İade Karnesi (D1,D3) | `roll_returns.createdAt` | aynı | `factoryDaySql` (`:192`) | — | `@@index([createdAt])`, `[customerId, createdAt]` |
| Fason Karnesi (F1-F3) | `subcontractor_dispatches.dispatchedAt` (SEVK anı; kabul anı yalnız süre için) | aynı | — | süre `firstReceivedAt − dispatchedAt` (JS ms) | `@@index([dispatchedAt])`, `[subcontractorId, dispatchedAt]` |
| Fason açık sevkler (F4) | — (snapshot) | — | — | `now() − dispatchedAt` | — |
| WIP bekleyen (C1,C3-C5) | `roll_movements.enteredAt` (yaş) | **yok (snapshot)** | — | `now() − enteredAt` (SQL) | `@@index([enteredAt])`, `[exitedAt]` |
| WIP geçen (C2) | `roll_movements.exitedAt` | aynı | — | süre `exitedAt − enteredAt` | `@@index([exitedAt])` |
| Stok Karnesi (G1-G8) | `rolls.statusChangedAt` (yaş) | **yok (snapshot)** | — | `now() − statusChangedAt` (SQL) | **index YOK** (bilinçli, `:32-38`) |
| Plan-Sapma (H1-H7) | `roll_plan_deviations.createdAt` | Prisma `gte/lte` | `factoryDaySql` (`:180`) | — | `@@index([createdAt])`, `[field, createdAt]` |
| Müşteri Karnesi dönem (I1) | **`orders.orderDate`** | Prisma `gte/lte` | — | — | **index YOK** |
| Müşteri Karnesi ömür (I2-I5) | `orders.orderDate` (MIN/MAX) | tüm zaman | — | `Math.floor((now − last)/86_400_000)` (JS) | — |
| Sipariş profili (J1) | `orders.orderDate` (MAX) | tüm zaman | — | — | — |
| Talep Analizi (K1,K3-K5) | `orders.orderDate` | Prisma `gte/lte` (ilişki üzerinden) | — | — | **index YOK** |
| Talep aylık (K2) | `orders.orderDate` | `>= now() − 24 months` (mutlak) | **`factoryMonthSql`** (`:141`) | — | — |
| Sipariş Karnesi (M1-M3) | `orders.orderDate` | Prisma `gte/lte` | `factoryDaySql` (`:174`) | — | **index YOK** |
| Teslim Süresi (N1-N4) | `orders.orderDate` (başlangıç), `shipments.dispatchedAt`/`direct_shipments.shippedAt` (ilk sevk), `orders.completedAt` (kapanış) | `orderDate` aralık | — | JS ms farkı | orderDate/completedAt index YOK |
| İptal Karnesi (O1,O4,O5,O7) | **`orders.cancelledAt`** | ham SQL `>= <=` | `factoryDaySql` (`:153`) | `cancelledAt − orderDate` | **index YOK** (kolon dev'de var, prod kopyasında yok) |
| İptal paydası (O2,O6) | `orders.orderDate` | Prisma `gte/lte` | — | — | — |
| Operatör İş Hacmi (P3) | `roll_operations.createdAt` | ham SQL | — | — | `@@index([createdAt])`, `[operationType, createdAt]` |
| Parti İzleme (P1,P2) | `batches.createdAt` (sıra), `shipments.dispatchedAt` (MAX) | — | — | — | `batches @@index([createdAt])` |
| Denetim (P5,P6) | `system_logs.createdAt` | ham SQL | `factoryDaySql` (`:74`) + `sl_day_exact` istatistiği | — | `@@index([createdAt])`, `[userId, createdAt]` |
| Pano (R1,R4-R7) | `roll_errors.detectedAt`, `roll_movements.exitedAt`, `subcontractor_receipts.receivedAt`, `subcontractor_dispatches.dispatchedAt`, `rolls.createdAt` | `>= factoryDayStart()` (JS, tek uç) | — | "bugün" = fabrika günü başı | `receivedAt`, `dispatchedAt`, `exitedAt`, `detectedAt` index'li; `rolls [entrySource, createdAt]` |
| Ürün Dengesi (Q1-Q5) | — | **yok (snapshot)** | — | — | — |
| Kapsama raporu (L1-L4) | `orders.deadline` (aciliyet, gecikme) | yok | — | `Math.floor((now − deadline)/86_400_000)` (JS) | `deadline` index'li ama JS'te kullanılır |
| Muhasebe export (S2,S4-S6) | `shipments.dispatchedAt` ∨ `createdAt` (seçilebilir), `direct_shipments.shippedAt` ∨ `createdAt`, `roll_returns.createdAt` | istemci mutlak an; varsayılan **90 gün** | — | — | `[status, dispatchedAt]`, `[status, createdAt]` |
| İşlem Dökümü (T1-T3) | 6 kolon (`rolls.createdAt`, `roll_operations.createdAt`, `roll_movements.enteredAt/exitedAt`, `roll_errors.detectedAt`, `system_logs.createdAt`) | oturum penceresi | — | `stayMinutes` mutlak | `[createdMachineId]`, `[createdById]`, `[userId, createdAt]`, `[detectedByUserId, detectedAt]`, `[operatorId]`, `[machineId]` |
| Gecikme günlüğü (U5-U7) | `endpoint_latency_daily.day` (`@db.Date`) | `day >= bugün − N` | `factoryDayKeyUtcMidnight` (JS) | — | `@@unique([day, routeKey])` |

Oturum UTC ↔ yerel gün çözümü her satırda: aralık uçları **istemcinin ürettiği mutlak an** (Electron yerel gece yarısı → ISO; sunucu dokunmaz), gruplama **`AT TIME ZONE 'Europe/Istanbul'`** SQL literali, "bugün" **`Intl` tabanlı `factoryDayStart`**, yaş/süre **tz-bağımsız** fark. Prod kopyasında rapor çıpalarının hiçbiri gece penceresine (21:00–24:00Z) düşmüyor (§8.2 #21) → farkın gözlemlenebileceği tek veri `system_logs` (12 satır/30 gün).

### 5.2 Aynı kavram, farklı kolon (işaretli)

| Kavram | Yüzey A | Yüzey B | Fark |
|---|---|---|---|
| **"Sipariş ne zaman kapandı"** | OTIF `orders.completedAt` (`shipment-scorecard:113`) — "İlk COMPLETED'a düştüğü an" (`schema:1996`) | Teslim süresi `fullCloseDays` de `completedAt` (`order-leadtime:196`); **ama** `completedAt` yeniden açılan (storno → PARTIAL_SHIPPED) siparişte tazelenmez [VARSAYIM: şema yorumu "ilk"] | tutarlı kolon; semantik "ilk kapanış" |
| **"Sipariş ne zaman alındı"** | `orderDate` (intake/demand/leadtime/customer/cancellation paydası) | `orders_active_createdAt_idx` ve liste sıralaması `createdAt` (`schema:2027-2029`); Müşteri profili `MAX(orderDate)` | raporlar `orderDate`, listeler `createdAt` — bilinçli (`order-intake:9-14`) |
| **"İptal ne zaman oldu"** | İptal Karnesi `cancelledAt` | Sipariş Karnesi `cancelledPct` `orderDate` bazlı (`order-intake:141-144,:217`) | iki soru, iki kolon (dosya başlığı `:9-14`) — Σ tutmaz, belgeli |
| **"Fason işi ne zaman oldu"** | Fason Karnesi `sd.dispatchedAt` (dönem = sevk anı) | Pano EXTERNAL `sr.receivedAt` (bugün kabul); WIP geçen `rm.exitedAt` (fason adımı kapanışı) | Karne kabul tarihine göre süzmez → Ağustos'ta dönen Temmuz sevki Temmuz'un karnesine yazılır (bilinçli: "kapanmış kalem" mantığı `:9-16`) |
| **"Top ne zaman üretildi"** | Kalite/Fire `finalizedAt` | Tambur listesi `createdAt` (`tambur.service.ts:1422-1431` "ÜRETİM anı"); İşlem Dökümü `rolls.createdAt` (ROLL_CREATED = KK1 girişi); Pano RAW_QC `createdAt` | **Farklı kavramlar aynı sözcük**: karne "bitiş", liste/döküm "doğuş" |
| **"Raftaki mal kaç günlük"** | Stok Karnesi `statusChangedAt` | Envanter sekmeleri `updatedAt desc` (CLAUDE.md 2026-07-30 "Son İşlem") ; K7a `inventory.service.ts:2094 oldestDays = floor(ms/86_400_000)` (fasondaki stok özeti — hangi kolon? K7a'da "UTC gün sınırı" notu) | karne ayrı kolon (doğru), liste `updatedAt` (bilinçli, sıralama için) |
| **"Bugün"** | Pano `factoryDayStart()` (JS) | Raporlarda "bugün" yok; muhasebe export `effTo = now` | tek kaynak |
| **Sevk satırı tarihi (export)** | `dispatchedAt ?? createdAt` (`accounting-export:385`) | `_shipped` yalnız `dispatchedAt` | DISPATCHED'da `dispatchedAt` hep dolu (prod 0 null) → fark yok; fallback yalnız savunma |

---

## 6. KOPYA HESAP LİSTESİ (raporlar arası + K7a çekirdekle çakışan)

### 6.A "Dönemde / bu sevkiyatta sevk edilen metraj" — 8 yüzey, 3 semantik

| Yüzey | Konum | Canlı toplar | İade geri-ekleme | Doğrudan sevk | Süzgeç / not |
|---|---|---|---|---|---|
| `_shipped.collectShipped` (karne özet/kırılım) | `reports/_shipped.ts:59-99` | `Σ currentQty` (statü süzgeçsiz) | `RollReturn.qty` (`cancelledAt IS NULL`) | bağlı toplar **+ `totalQty`'ye mutabakat satırı** | DISPATCHED + `dispatchedAt` aralığı — **TEK TANIM** (tüketici: OTIF özeti, İade paydası) |
| Sevk günlük serisi | `shipment-scorecard.report.service.ts:130-137` | `Σ currentQty` | **YOK** | **YOK** | NET → Σdaily ≠ özet iade/direkt olan dönemde (**H1**) |
| Sevkiyat listesi satırı `attachTotals` | `shipping.service.ts:2569-2625` | `groupBy shipmentId Σ currentQty` | `groupBy fromShipmentId Σ qty` | satır `mapDirect.totalMeters = Number(d.totalQty)` (`:2426`) | RepeatableRead batch tx (K3); sayfa satırları |
| Muhasebe bandı `buildShipmentListSummary` | `shipping.service.ts:2694-2718` | `aggregate` | `aggregate` | `Σ DirectShipment.totalQty` | filtre kümesinin tamamı |
| Muhasebe export sevk satırları | `accounting-export.service.ts:318-448` | çuval içi `Σ currentQty` | `RollReturn` geri-ekleme | **`Σ ds.rolls.currentQty`** (`:480-482`) — `totalQty` DEĞİL | direkt metraj `_shipped`/liste ile **ayrışabilir** (topu sonradan kesilmiş/bağsız direkt sevkte); prod'da direkt sevk 0 |
| Sevkiyat detayı `getShipmentById` | `shipping.service.ts:2977-3054` (K7a 4.3) | `sk.rolls` | `prevSackId` ile | — | K7a |
| Belge içeriği `collectShipmentDocContent` | `shipping.service.ts:3435-3531` | `∖ SACK_ABSENT` | evet | — | K7a |
| Parti izleme müşteri listesi | `batch-trace.report.service.ts:152-172` | `rolls.shipmentId` (sevk statüsü süzgeçsiz) | `UNION roll_returns.fromShipmentId` | yok | parti bazlı; PLANNED sevkiyattaki top da "gitti" (prod: 12 WAREHOUSE top PLANNED'a bağlı) |

K7a ile çakışma: K7a 2.F/4.3 çuval toplamı; burada eklenen fark **direkt sevk metrajının üç kaynağı** (`totalQty` / `Σ rolls` / mutabakatlı) ve **günlük serinin NET olması**.

### 6.B "Üretilen metraj" — 4 tanım, 3 birim

| Tanım | Konum | Küme | Metraj alanı | Zaman | Fire/A1 |
|---|---|---|---|---|---|
| Karne evreni (kalite `totalQty` = fire `producedQty`) | `quality-scorecard:163-198`, `scrap-scorecard:200-209` | `finalizedAt` dolu ∧ `status ∉ K18` → WAREHOUSE, A1_STOCK, SCRAP, **SHIPPED**, ve damgası kalmış IN_PRODUCTION/AT_SUBCONTRACTOR/STOCK (H2) | `currentQty` (şu anki) | `finalizedAt` dönem | fire DAHİL, A1 dahil |
| İş emri "ÇIKAN" | `workorder.service.ts:1842-1866` (liste), `:2209-2220` (detay) | `producedOutputWhere` (`:1690-1720`: Tambur birinci nesil SPLIT çocukları + SPLIT olmayan {WAREHOUSE, A1_STOCK, SCRAP, SHIPPED, AT_KARTELA, KARTELA_CONSUMED}) | **`initialQty`** (üretim anı) | zaman çıpası yok (WO bazlı) | fire HARİÇ (`fireCodes`, katalog `targetStatus=SCRAP`; `null` kalite sağlam), A1 DAHİL (2026-08-21) |
| `computeWoMaterial.finished` (Ürün Dengesi "üretimde" paydası) | `coverage.helper.ts:34-39,:111-121` | `producedInStepId ∈ WO ∧ status ∈ {WAREHOUSE, A1_STOCK, SHIPPED, SCRAP}` | `currentQty` | yok | fire DAHİL; kartela çıktısı HARİÇ (K7a H9) |
| Pano "bugün biten" | `dashboard.service.ts:99-105` | bugün `exitedAt` dolan DISTINCT top (istasyon başına) | **adet** | `factoryDayStart` | storno kapanışı dahil [VARSAYIM] |

Kilit: kalite↔fire eşitliği bekçili (`test_scrap_scorecard:136-148`); liste↔detay aynı küme (`workorder:1830-1831` yorumu); dört tanım arası mutabakat **yok ve beklenmiyor** (farklı sorular) — ② için soru: kullanıcı "bu ay ne ürettik" için hangisine bakıyor (karne) ve WO detayı ile farkı ekranda yazılı mı.

### 6.C "Açık talep = istenen − sevk" — K7a'nın 13 noktasına 2 rapor noktası eklendi

| Konum | Aritmetik | `max(0)` | Statü süzgeci | Not |
|---|---|---|---|---|
| `production-balance.service.ts:230-233` | Decimal | evet | `order.status ∉ {CANCELLED, COMPLETED}` + `ACTIVE_LINE` | K7a I19 |
| `stock-scorecard.report.service.ts:193-199` | **float** `Number(quantity) − Number(shippedQty)` | evet | aynı | denge ile "BİREBİR" iddiası (`:166,:21-25`) — küme aynı, aritmetik farklı (1-ondalık veride eşit) |
| `open-order-coverage.report.service.ts:184` | `line.remaining` (dengeden) | — | — | motor tek |
| `shipment-scorecard:151-153` (geciken) | `plannedQty` (aktif kalem Σ) ve `shippedQty` (başlık) yan yana, fark alınmaz | — | `status ∈ {PENDING, APPROVED, PARTIAL_SHIPPED}` | iptal kalemin sevki `shippedQty`'de var, `plannedQty`'de yok → ekranda "sevk > planlanan" görünebilir |
| `order-cancellation:133-134` | `qty` aktif kalem Σ, `shippedQty` başlık | — | CANCELLED | aynı asimetri |
| `order-status.helper.ts:164-178` (K7a I2) `COMPLETED` kararı tolerans 5 m | — | — | — | K7a H17: karne/denge "açık" kalemi kapalı siparişte (COMPLETED) HİÇ görmez (`notIn COMPLETED`) — 4,9 m eksik kalem denge/kapsama/stok karnesinde de **talep değil** (tutarlı) |

### 6.D "Fire oranı" — 4 rakam, 4 tanım, aynı sözcük

| Yüzey | Formül | Küme | Konum |
|---|---|---|---|
| Fire Karnesi `scrapPct` | `Σ SCRAP.currentQty / Σ üretim.currentQty` | statü SCRAP, `finalizedAt` dönemi | `scrap-scorecard:369` |
| Kalite Karnesi "Fire" kalitesi payı | `Σ (gradeCode=FIRE).currentQty / totalQty` | kalite koduna göre (FIRE→SCRAP hedefli; 2026-08-20'den beri örtüşür) | `quality-scorecard:373-374` |
| İş emri detayı `producedRolls.fire` | `Σ (bucketOf(kalite)=fire).initialQty` | katalog `targetStatus=SCRAP` kodları | `workorder.service.ts:2209-2220` |
| Fason Karnesi `firePct` | `(closedDispatched − returned) / closedDispatched` | fason sevk kalemleri (kapanmış), sapma defteri düzeltmeli | `subcontract-scorecard:221-230` |
| Sapma defteri (K7a 2.N) | `RollVariance kind=SCRAP` satırları (TAMBUR_FINALIZE 2 satır 8,9 m prod) | olay bazlı | `roll-variance.helper` |

### 6.E "Çekme oranı" (fason)

| Yüzey | Formül | Konum |
|---|---|---|
| Mobil kabul ekranı | `pct = round1(|dönen − düşülen| / düşülen × 100)`, `significant = |diff| > 0.01`; uyarı `pct > tolerancePct` (bayrak `fasonShrinkWarnEnabled`, varsayılan %10; **artı yön de tabi**) | `mobil/src/screens/Modules/FasonKabul/receivePayload.helper.ts:175-198`; ayar `useFeatureFlags.ts:103-107` |
| Backend | yüzde hesabı YOK; yalnız sapma satırı yazımı (K7a 2.J `allocateShrink`) ve ayar şeması `feature-flag.routes.ts:145-149` (`min(0)` — 0 geçerli) | — |
| Fason Karnesi | kalem/firma bazlı `firePct` (yukarıda) — payda `dispatchedQty` (giden), mobilde payda `consumedTotal` (düşülen) → tam kabulde eşit, kısmi kabulde farklı taban | `subcontract-scorecard:230` |

### 6.F "Aktif kalem" (`cancelledAt IS NULL`) — 1 kaynak + 10 ham SQL kopyası (bekçili)

Prisma: `ACTIVE_LINE` (`order-line-scope.helper.ts:26`) — tüketiciler: stock `:172`, customer-scorecard `:127`, demand `:111`, intake `:123`, production-balance `:193`. Ham SQL kopyaları: customer-scorecard `:190`; customer.report `:51,:61,:72,:83`; demand `:148`; intake `:180`; cancellation `:141,:160`; shipment `:152`; leadtime `:173` (+ `aktif-kalem-muaf` `:149-152,:161-162`). Bekçi `test_order_line_scope_single_source.ts:99-134`: `FROM|JOIN order_lines` satırından itibaren 4 satırlık pencerede `cancelledAt` arar, muaf için önceki 6 satırda `aktif-kalem-muaf:` ister → 10 kopya + 2 muaf **kapsamda**. Kör nokta: pencere 4 satır — `WHERE` 5+ satır sonra yazılırsa yanlış pozitif (kırmızı, sessiz değil).

### 6.G "Fason açık/kapalı kalem" — helper + 2 ham SQL kopyası (bekçisiz)

| Yüzey | Kural | Konum |
|---|---|---|
| Tek kaynak (Prisma) | `OPEN_OUTSTANDING = cancelledAt null ∧ directShippedAt null ∧ items.some(remainderClosedAt null ∧ receiptItems.none(isPartial=false ∧ receipt.cancelledAt null))` | `helpers/fason-open-dispatch.helper.ts:48-64` |
| Fason Karnesi kapanış | `hasFull = BOOL_OR(NOT isPartial)` (makbuz `cancelledAt IS NULL`) ∨ `remainderClosedAt IS NOT NULL`; sevk `cancelledAt/directShippedAt IS NULL` | `subcontract-scorecard:143-145,:150,:170-173,:195` |
| Fason Karnesi açık liste | dört koşulun ham SQL'i | `:280-291` |
| Bekçi | `test_fason_open_dispatch_single_source.ts` yalnız TS nesne literallerinde `receiptItems→none→isPartial` zincirini tarar (`:74-130` AST) → ham SQL kopyaları **görünmez** | — |
| K7a H4 | WO detayı "Dönen" = makbuzlu kalemin tüm `dispatchedQty`'si (`workorder:2485-2495`) — karne ise `receivedQty`/fallback ile ölçer → aynı sevk için iki "dönen" | — |

### 6.H Yuvarlama yardımcıları — §1.3 (2 tanım + 6 satır içi + Electron toplamları)

### 6.I Spec anahtarı — 4 biçim (K7a 4.2'nin rapor ikizleri)

`production-balance:32-39` (`itemId|colorId ?? ""|Decimal.toString()`) · `stock-scorecard:132-134` (`itemId|colorId ?? ""|float ?? ""`) · `demand-analysis:100-101` (`itemId|colorId ?? "-"|Decimal.toString() ?? "-"`) · `accounting-export:331,:487` (`itemId|colorId ?? ""|Number(width) ?? ""`). Her harita kendi içinde tutarlı; çapraz birleştirme yalnız stock-scorecard (talep ↔ stok, aynı fonksiyon). Renk-joker / en-agnostik kuralı yalnız dengede (Q5), karnelerde **birebir** (stock `uncovered` renksiz ham talebi joker saymaz — bitmiş stok için doğru).

### 6.J Fason atfı üç kova — 2 kopya (quality `:175,:190-191,:392-394` ↔ scrap `:147,:155-156,:303-306`); ikisi de bekçili.

### 6.K "Sipariş adedi" — 4 sayım, 2 semantik

| Yüzey | CANCELLED | Küme | Konum |
|---|---|---|---|
| Sipariş Karnesi `summary.orderCount` | DAHİL | dönem (`orderDate`) | `order-intake:132` |
| Sipariş Karnesi `daily.orderCount` | HARİÇ | dönem | `order-intake:175,:182` → Σdaily ≠ summary |
| Müşteri Karnesi `orderCount` / `lifetimeOrderCount` | HARİÇ | dönem / ömür | `customer-scorecard:122,:188` |
| Müşteri Sipariş Profili `orderCount` | DAHİL | ömür, yalnız `isActive` müşteri | `customer.report:49,:52` |

### 6.L "Bugün / gün başı" — tek kaynak (`time.ts`), 4 türev (`factoryDaySql`, `factoryDayStart`, `factoryDayKeyUtcMidnight`, `factoryYmd`) + istemci ikizi (`useReportDateRange.ts`, renderer TZ'si).

### 6.M "Bitmiş stok / arz" — 3 küme

| Yüzey | Statüler | Ek süzgeç | Konum |
|---|---|---|---|
| Ürün Dengesi `depo` | WAREHOUSE (A1_STOCK **hariç**) | `shipmentId/sackId IS NULL`, `qty > 0` | `production-balance:276-278,:343-345` |
| Stok Karnesi `finished` | WAREHOUSE + **A1_STOCK** | `shipmentId/sackId IS NULL` (qty 0 dahil) | `stock-scorecard:127,:160-164,:201` |
| `getSpecAvailability.freeWarehouse` (K7a I15) | WAREHOUSE birebir | — | `order.service:1588-1642` |
| Kanban/Envanter "Bitmiş Depo" | WAREHOUSE (sekme) | — | K1/K7a |

Ayrışma: 2. kalite (A1_STOCK) Stok Karnesi'nde "bitmiş" sayılır, dengede arz değil → "depoda X m var" (karne) ile "depo = Y" (denge) prod'da bugün eşit (A1_STOCK 0 top) ama tanım farklı.

### 6.N Kalite kataloğu okumaları — `isActive` süzgeci hiçbirinde yok

`quality-scorecard:298-301` (sıra) · `roll-finalize.helper.ts:76-78` (`targetStatus` kovası, CLAUDE.md: bilinçli) · pasif kalite `sortOrder` en küçükse başlık metriği pasif kaliteye bağlanır (§11 H-lite). Prod/dev katalog: 1.KALITE(10, WAREHOUSE) · A1(20, **WAREHOUSE** — A1_STOCK değil; `returnTargetStatus` A1_STOCK) · FIRE(30, SCRAP), üçü aktif (§8.2 #6). `bucketOf("A1")` → `"warehouse"` (targetStatus WAREHOUSE) → WO detayında A1 topu `warehouse` kovasına yazılır, `a1` kovası boş kalır — sayım toplamı etkilenmez (ikisi de `totalMeters`'a girer) ama kova etiketi katalog ayarına bağlı (2026-08-21 notu "A1 SAYILIR" ile uyumlu).

---

## 7. CLAUDE.md kurallarının kodda yaşadığı yer (doğrulama tablosu)

| Kural (kök CLAUDE.md / arşiv 2026-08-09) | Kod | Doğrulandı mı | Bekçi |
|---|---|---|---|
| `Roll.finalizedAt/statusChangedAt` TRIGGER yazar; kaynak statü listesinde `SHIPPED/CANCELLED` bilerek YOK; damga üzerine yazılır | migration `20260809090000/migration.sql:45-96` (INSERT `:56-59`, UPDATE `:66-87`, kaynak `:79-80`, overwrite `:85`); trigger prod+dev'de mevcut (§8.3) | ✅ | `test_quality_scorecard` (SHIPPED negatif sonda), `test_db_invariants §6` |
| Kalite Karnesi `K18_DEAD_STATUSES` dışlar, `SCRAP` dışlamaz | `quality-scorecard:194,:318`; `K18` = `batch.service.ts:55-60` | ✅ | `test_quality_scorecard:161-174` |
| "1. KALİTE" koda gömülmez (`sortOrder`) | `quality-scorecard:298-302`; grep `"1.KALITE"` src/services/reports → 0 | ✅ | `test_quality_scorecard` kaynak taraması (arşiv notu) |
| Fason atfı ÜÇ kovalı (`entrySource` load-bearing) | `quality-scorecard:175,:392-394`; `scrap-scorecard:147,:303-306` | ✅ | `test_quality_scorecard:190-196`, `test_scrap_scorecard:171-176` |
| "Dönemde sevk edilen metraj" TEK tanım `_shipped.ts` | tüketici 2 (OTIF özet, İade paydası); **günlük seri kopya** (§6.A) | ⚠️ kısmen | `test_shipment_scorecard:111-118` (özet eşitliği) — daily kapsam dışı |
| Ölü stok = eski VE siparişsiz (kesişim) | `stock-scorecard:250-261` (`min(eski, siparişsiz)`) | ✅ | `test_stock_scorecard:125-141` |
| Parti no benzersiz değil → arama daima aday listesi; `batchNumber` ile sıralama yasak | `batch-trace:81-123` (`ORDER BY createdAt DESC :111`) | ✅ | `test_batch_trace` (içerik okunmadı) |
| Üretilen metraj = 1.kalite+A1, kalite kovası KATALOGDAN (`loadProducedBuckets`, `isActive` süzgeci YOK, `notIn: []` yok) | `roll-finalize.helper.ts:75-106` (`findMany` `isActive`siz `:76-78`; `bucketOf` bilinmeyen/null → `warehouse` `:95-101`); `workorder.service.ts:1842-1862` (`excludedGradeCodes.length ? … : []` `:1852-1862`, `OR qualityGrade null` `:1855`) | ✅ (rapor katmanı bu helper'ı kullanmaz — kalite karnesi kodu doğrudan `qg.code` ile çalışır) | `test_consistency_derived` (K7a alanı) |
| Yarı mamul arzdan DÜŞÜLMEZ, ayrı GÖSTERİLİR; `malzemeAcigi` ikisini birden düşer | `production-balance:418-433`; `stock-scorecard:205-206,:306-309` | ✅ | `test_semi_finished_surfaces §1-§4` |
| Brüt kuralı (iade geri-ekleme, `RollReturn` kaynağı, snapshot değil) — 5 tüketici | `_shipped:76-78`, `accounting-export:290-306,:369-382`, `shipping attachTotals:2604-2620`, `buildShipmentListSummary:2702-2712`, `getShipmentById`, belge (K7a) | ✅ | `test_return_scorecard:187-199`, `test_accounting_export`, `test_dispatch_report_gross` |
| `dateFrom/dateTo` MUTLAK AN, backend gün yuvarlaması yapmaz | `_shared.ts:39-47,:49-65`; `accounting-export:160-167`; `tambur.service:1432-1435` | ✅ | `test_report_day_boundary §1-§3` |
| Gün gruplaması fabrika günü (`factoryDaySql`), literal yalnız `time.ts`'te | 9 rapor + `sl_day_exact` | ✅ | `test_report_day_boundary §4-§5` |
| Aktif kalem tek kaynak (`ACTIVE_LINE`), GEÇMİŞ sorusu süzmez | §6.F | ✅ | `test_order_line_scope_single_source §1-§2` |
| Fason "açık+outstanding" tek kaynak | Prisma tarafı ✅; rapor ham SQL kopyası ⚠️ (§6.G) | ⚠️ | AST bekçisi ham SQL'i görmez |
| Kısmi kabul: kalem yalnız TAM satırla kapanır | `subcontract-scorecard:143-145,:195,:284-291` | ✅ | `test_subcontract_scorecard` (kısmi senaryo? §1 "açık kalem fire değil") |
| Çekme sapma defterinde; karne fire'ı defterden okur; `openQty`'ye GİRMEZ | `subcontract-scorecard:152-167,:199,:209-212` | ✅ | `test_subcontract_scorecard:160-167` (fire 4 m) |
| Plan-sapma çift sayım kilidi `confirmationId` | `plan-deviation:91-99,:129,:146-163,:179-192` | ✅ | `test_plan_deviation_scorecard §1-§6` (negatif sondalı) |
| İptal karnesi çıpası `cancelledAt`; damgasız eski iptaller ayrıca sayılır | `order-cancellation:143-147` | ✅ (dev: 4/4 damgasız) | `test_order_cancellation` (içerik okunmadı) |
| Sipariş görünürlüğü: liste/özet tek where (`buildListWhere`) | K7a I9 — rapor katmanı bunu kullanmaz (kendi where'i) | — | — |
| `getCoverageForLines` raporda KULLANILMAZ (havuz çift yazımı) | `open-order-coverage:12-18,:153` | ✅ | `test_open_order_coverage:111-113` (havuz sırayla) |

---

## 8. Saha ölçümleri (prod kopyası `tekserp_saha_0825`, salt-okunur) ve dev

### 8.1 Kapsam notu
Prod kopyası **190/195** migration: `orders.cancelledAt`, `orders.cancelReasonCode`, `order_lines.cancelledAt` **YOK** (`20260826130100`, `20260827100000`) → İptal Karnesi ve `ACTIVE_LINE` süzgeci kopyada **çalışmaz** (dev'de ölçüldü). `roll_plan_deviations`, `endpoint_latency_daily`, `roll_returns`, `direct_shipments`, `quality_grades`, `subcontractor_receipt_items.receivedQty/isPartial`, `remainderClosedAt`, `roll_variances.sourceRefId/reversedAt`, `rolls.finalizedAt/statusChangedAt` mevcut (`information_schema` sorgusu).

### 8.2 Prod kopyası sayıları (SQL: `audit/tools/sql-saha.sh -f scratchpad/k7b_saha.sql`, `k7b_saha2.sql`)

| # | Ölçüm | Sonuç | İlgili rapor |
|---|---|---|---|
| 1 | `rolls` statü dağılımı | SHIPPED 689 · SUBCONTRACTOR_CONSUMED 637 · STOCK 283 · WAREHOUSE 250 · CANCELLED 230 · AT_SUBCONTRACTOR 188 · TAMBUR_CONSUMED 116 · IN_PRODUCTION 37 · SCRAP 1 (A1_STOCK 0, KARTELA 0) | — |
| 2 | Çıpasız final top (`finalizedAt IS NULL`, final statü) | WAREHOUSE 3 · SCRAP 1 → `unanchoredRollCount = 4` | Kalite A4 |
| 3 | `statusChangedAt IS NULL` | IN_PRODUCTION 28 · TAMBUR_CONSUMED 6 · WAREHOUSE 3 · SCRAP 1 · CANCELLED 1 → Stok Karnesi `unagedCount` 3 | Stok G5 |
| 4 | `finalizedAt` dolu ama final DEĞİL | SHIPPED 689 · CANCELLED 91 (K18 → karne dışı) · TAMBUR_CONSUMED 4 (K18 dışı) · **AT_SUBCONTRACTOR 3 · IN_PRODUCTION 1 (karneye GİRER, H2)** | Kalite/Fire |
| 5 | `finalizedAt > statusChangedAt` | 0 | invariant |
| 6 | `quality_grades` | 1.KALITE (10, aktif, WAREHOUSE/WAREHOUSE) · A1 (20, aktif, **WAREHOUSE**/A1_STOCK) · FIRE (30, aktif, SCRAP/SCRAP) | §6.N |
| 7 | Damgalı toplarda `qualityGradeId` NULL | SHIPPED 0/689 · WAREHOUSE 0/247 · TAMBUR_CONSUMED 1/4 · CANCELLED 2/91 → karne `ungradedQty` ≈ 0 | Kalite A5 |
| 8 | `roll_returns` | 5 satır, iptal 0, sevkiyatsız 0 | İade, brüt |
| 9 | `direct_shipments` | 0 (mutabakat satırı doğamaz) | E0 ⑤, S5 |
| 10 | `shipments` | DISPATCHED 39 (`dispatchedAt` null 0) · PLANNED 1 (null 1) | E0 ikinci savunma |
| 11 | `orders` | APPROVED 235 · PARTIAL_SHIPPED 27 · COMPLETED 12 (`completedAt` hepsinde dolu) · CANCELLED 4; `deadline` NULL 0 | OTIF E2 (`noDeadline` 0), N1 |
| 12 | `roll_plan_deviations` | 0 satır | Plan-sapma (H1 boş) |
| 13 | `roll_movements` | açık 224 · kapalı 883 · negatif süre 0 · kapalı ∧ `qtyOut NULL` 14 (K7a H5) | WIP C1/C2, P4 |
| 14 | Açık hareketlerin top statüsü | AT_SUBCONTRACTOR 188 · IN_PRODUCTION 36 | WIP "bekleyen"in %84'ü fasonda |
| 15 | Fason kabul kalemleri | 638 kalem · `receivedQty` NULL **635** · `isPartial` 1 · `remainderClosedAt` 0 · `directShippedAt` 0 · iptal sevk 5 · `stepId` NULL 0 · `sourceDispatchItemId` NULL 0 | Fason F1 fallback (H4) |
| 16 | Legacy fallback tutarlılığı | 635 kalem: giden 76 676 m = doğan top `initialQty` Σ = **`currentQty` Σ 76 676 m** — doğan topların hepsi `SUBCONTRACTOR_CONSUMED` (fason→fason zinciri) | bugün eşit; kesilmiş doğan topta eşitlik bozulur |
| 17 | `roll_variances` | TAMBUR_FINALIZE SCRAP 2 (8,9 m) · RECORD_CORRECTION 36 (309,9 m) · TAMBUR_OVERCUT OVERAGE 37 (382,1 m); `SUBCONTRACTOR_RETURN` **0** | Fason `adj` boş |
| 18 | Aynı top + aynı adım birden fazla aktif fason sevk kalemi | 0 (dev 0) | F1 `adj` çift eşleşme riski bugün yok |
| 19 | `system_logs` | 10 485 satır, 2026-07-16 → 2026-08-25 | Denetim P5 |
| 20 | `endpoint_latency_daily` | 3 117 satır, 2026-07-16 → 2026-08-25, 311 route | U5-U7 |
| 21 | STOCK toplarının `entrySource` | SUPPLIER_RECEIPT 283 (SEMI_FINISHED 0) | Stok G3, Denge Q5 |
| 22 | Gece penceresi (UTC 21:00–24:00 = ertesi fabrika günü) | `rolls.finalizedAt` 0/1035 · `shipments.dispatchedAt` 0/39 · `roll_returns.createdAt` 0/5 · `orders.orderDate` 0/278 · `orders.completedAt` 0/12 · `roll_errors.detectedAt` 0/3 · `roll_movements.exitedAt` 0/883 · **`system_logs.createdAt` 12/9 387 (30 gün)** | §5 gün-sınırı |
| 23 | `orders.orderDate` UTC saat dağılımı | 05–15 arası (yerel 08–18); gece yarısı (00:00) girişi **yok** → `orderDate` elle tarih değil `now()` | M1, K2 |
| 24 | `rolls.shipmentId` ↔ `shipments.status` | DISPATCHED/SHIPPED 689 · PLANNED/WAREHOUSE 12 | E0 ②, P2 |
| 25 | `currentStepId` taşıyan toplar | AT_SUBCONTRACTOR 188 · IN_PRODUCTION 37 | Pano R2 |
| 26 | Hiç başlamamış canlı WO | PLANNED 1 | WIP C4 |
| 27 | `batches` | 198 parti, 106 farklı numara (P01…P99 dönen), merged 0 | P1 aday listesi zorunlu |
| 28 | `roll_errors` | 3 hata, 1 topta >1 hata, `detectedAtStepId` NULL 0 | B1 LATERAL |
| 29 | SCRAP top | `currentQty 300 = initialQty 300`, `finalizedAt` NULL, kalitesiz (eski yol) | Fire B1: karneye **girmez** (çıpasız) — `unanchored` 1 |
| 30 | `finalizedAt` aylık (K18 hariç) | 2026-07: 1 top / 452 m · 2026-08: 939 top / 55 276 m | karne evreni |
| 31 | Rafta serbest top (Stok Karnesi kümesi) | WAREHOUSE+STOCK sevksiz/çuvalsız ≈ 250−12+283 = 521 [VARSAYIM: A1 0] | G1 bellek |
| 32 | `order_lines.width` NULL | 0/281 | spec anahtarı |
| 33 | `customers` merged/inactive | 0/0/27 | I2, J1 süzgeç farkı bugün etkisiz |

### 8.3 Dev (`adnansahin_db`, 195 migration)

| Ölçüm | Sonuç |
|---|---|
| `orders` CANCELLED 4 — `cancelledAt` NULL 4/4 (`undatedCancelCount` = 4), `cancelReasonCode` dolu 0 | İptal Karnesi dönem raporu dev'de **boş** çıkar |
| `order_lines.cancelledAt` dolu 0/79 | `ACTIVE_LINE` bugün no-op |
| Çıpasız final top: SCRAP 2 · WAREHOUSE 2 | test kalıntısı |
| `roll_plan_deviations` 0 | — |
| `endpoint_latency_daily` 1 942 satır (2026-07-16 → 2026-08-28) | — |
| `sl_day_exact` ifade istatistiği: `date_trunc('day', ("createdAt" AT TIME ZONE 'Europe/Istanbul'))::date` — **`factoryDaySql` metniyle birebir** (prod'da da aynı) | Denetim raporu planı |
| trigger `rolls_stamp_production_timestamps` mevcut (prod+dev) | — |

### 8.4 Sınırsız `findMany` / bellekte toplama (H ajanı için)

| Konum | Ne yükler | Tavan | Bugünkü ölçek (prod) | Not |
|---|---|---|---|---|
| `stock-scorecard:138-165` | tüm serbest WAREHOUSE/A1/STOCK topları (satır bazlı, 10 kolon) | **yok** | ~521 satır | tüm türevler JS'te (`filter/reduce` ×12); index bilinçli yok (`:32-38`, tetik ~50k satır) |
| `stock-scorecard:167-175` | tüm açık kalemler (5 kolon) | yok | ≤281 | — |
| `production-balance:189-218` | tüm açık kalemler + 4 ilişki (`requiredProperties` dahil) | yok (`itemId` daraltması opsiyonel) | ≤281 | `open-order-coverage` her çağrıda tümünü çeker |
| `production-balance:285-301` + `computeWoMaterial` (`coverage.helper:91-137,:168-277`) | canlı WO'lar + adımları + tüm hareketleri (`distinct`) + aday toplar + makbuzlar (6 sorgu) | yok | canlı WO ~? (prod 213 WO toplam) | O(spec×arz) döngüsü index'e alındı (`:328-335`) |
| `customer-scorecard:119-131` | dönemin tüm siparişleri + aktif kalemleri + item adı | yok | ≤278 | + `collectLifetime` tüm müşteri×sipariş×kalem ham SQL (`:179-193`) her çağrıda |
| `demand-analysis:104-122` | dönemin tüm aktif kalemleri + 3 ilişki | yok (çıktı 300'e kırpılır) | ≤281 | + 24 aylık ham SQL |
| `order-intake:112-127` | dönemin tüm siparişleri + aktif kalemleri | yok | ≤278 | — |
| `plan-deviation:109-127` | dönemin tüm sapma satırları + 5 ilişki (`orderBy createdAt desc`) | **yok** (detay 200'e JS'te kırpılır `:194`) | 0 | 366 günlük aralıkta tümü belleğe |
| `order-leadtime:135-178` | dönemin tüm siparişleri + 3 LATERAL | yok | ≤278 | JS'te medyan sıralaması |
| `order-cancellation:130-145` | dönemin tüm iptalleri | yok | ~4 | + `reasonPreset.findMany` (`:148`) katalog |
| `accounting-export:241-273,:452-473` | ≤2 000 sevkiyat × çuval × top (iç içe `select`), `MAX_IDS 200` | 2 000 sevkiyat (`:42,:234`), iç içe toplar **tavansız** | 39 sevkiyat / 689 top | JS'te 4 harita; `returnBackfill` `in:` listesi 2 000 id |
| `work-session-activity:211-326` | 6 kaynak × `take 1001` | 1 001 × 6 | vardiya | `cancelRolls` ikinci `in:` sorgusu |
| `wip-scorecard:85-106` | tüm açık hareketler (GROUP BY istasyon — SQL'de) | — | 224 | JS'e yalnız istasyon satırları |
| `audit.report:54-83` | `system_logs` 3 tam-aralık taraması (action / table / daily) | aralık ≤366 gün | 10k (dev 152k) | `sl_day_exact` + `createdAt` index; ölçüm `SCALE-REPORT §8` (dosya `docs/history/` yerine başka yerde — bulunamadı, K-doc) |
| `latency-persist:210-220` | son N gün × route satırları | `take 60_000` | 3 117 | JS birleşim |
| `batch-trace:84-113` | `batches ILIKE %q%` (trgm index var `schema Batch`) + `EXISTS rolls.barcode` | `LIMIT 20` | 198 | — |
| `production.report:125-150` (traveler) | tek topun hareket/operasyonları | top başına | — | — |
| `_shipped:47-115` | 4 kollu UNION ALL + 2 korelasyonlu alt sorgu (`SUM r2.currentQty` **iki kez** `:92-94,:97-99`) | aralık | 39 sevkiyat | direkt sevk başına 2 alt sorgu |
| `scrap-scorecard:124-182` | SCRAP toplar × LATERAL (hata) | aralık | 1 | — |
| `subcontract-scorecard:107-174` | dönem sevk kalemleri × 2 LATERAL (makbuz Σ, sapma Σ) | aralık | 638 kalem | `roll_variances` `[rollId]`? (index listesi K2) |

---

## 9. Bekçi kapsamı (rapor katmanı) — neyi ölçüyor, neyi ölçmüyor

| Bekçi | Ölçtüğü | Ölçmediği (kör nokta) |
|---|---|---|
| `test_report_day_boundary.ts` (261) | JS yardımcıları TZ'den bağımsız §1; `factoryDaySql` canlı PG §2; audit `daily` gece yarısı §3; **kaçak `DATE_TRUNC('day/week/month')`/`CURRENT_DATE`/`.setHours(`** taraması §4 (`:176-224`); ifade istatistiği §5 | `now()`/`EXTRACT` mutlak farklar (bilinçli), `getFullYear/…` belge yüzeyleri, istemci hook'u, `toISOString().slice(0,10)` |
| `test_quality_scorecard.ts` (326, 30 kontrol) | metraj ağırlığı, K18 dışlama + SCRAP dahil, kırılım=özet, daily=özet, fason üç kova, compare; trigger SHIPPED negatif sondası | **rework (stale `finalizedAt`) topu** (H2); `isActive` kalite; `unanchored` sayacı |
| `test_scrap_scorecard.ts` (208) | çift sayım seddi (LATERAL), `producedQty = quality.totalQty`, iki çıpa, fason atfı, kırılım toplamları | — |
| `test_return_scorecard.ts` (266) | brüt payda (canlı+iade+direkt `:134-199`), iptal iade dışı, sebep 3 durum, kırılım/daily toplamları, compare | — |
| `test_shipment_scorecard.ts` (152) | sevk 1000 m, PLANNED sayılmaz, kırılım=özet (`:107-109`), **iki karne aynı sevk rakamı** (`:111-118`), terminsiz oran dışı, iptal sayılmaz, avgLate, compare | **daily Σ = özet** (H1); `overdueOpen` |
| `test_stock_scorecard.ts` (228) | ölü stok kesişim (fark ölçümü), çıpasız top, sevke okutulmuş top dışı, ham↔bitmiş↔yarı mamul, talep tanımı | A1_STOCK "bitmiş" sayımı; float talep aritmetiği |
| `test_subcontract_scorecard.ts` (215) | açık kalem fire değil, çok satırlı dönüş toplanır, direkt/iptal dışı, süre, açık liste, compare | legacy `receivedQty NULL` fallback (H4); sapma `adj` eşleşmesi; `directShippedAt` ile kısmi |
| `test_wip_scorecard.ts` (249) | snapshot tarih bağımsız, boş istasyon listede, ağırlıklı ortalama, en eski, hiç başlamamış WO | `qtyIn` vs kısmi kabul |
| `test_plan_deviation_scorecard.ts` (224) | imza/olay ayrımı §1-§3, dönem §4, kırılım §5, gün serisi §6, detay §7, compare §8 (negatif sondalı) | — |
| `test_open_order_coverage.ts` (178) | havuz sırayla dağıtım, durumlar, özet=Σsatır (`:132-134`), tavan aşımı gizlenmez, kovalar | `coveragePct` iki aritmetik |
| `test_dashboard.ts` (82) | şekil + `openCount` canlı artış | **"bugün" sınırı** (`factoryDayStart`) hiç ölçülmüyor; `queueCount` statü |
| `test_accounting_export.ts` (297), `test_accounting_direct_ship.ts` (202) | brüt satır/detay/icmal/iade, filtre scope; doğrudan sevk export+fiş | direkt `Σ rolls` ↔ `totalQty` ayrışması (fixture'da eşit) |
| `test_semi_finished_surfaces.ts` (190) | ham/yarı mamul ayrı, arzdan düşülmüyor, toplam korunuyor, mesaj | — |
| `test_latency_persist.ts` (301) | flush/merge/retention/history; **DB `day` = fabrika bugünü** (`:194-195`) | — |
| `test_order_intake` / `test_order_cancellation` / `test_demand_analysis` / `test_order_leadtime` / `test_customer_scorecard` / `test_batch_trace` / `test_reports` | **var, içerikleri okunmadı** (grep çıktısı kesildi) | Σdaily.orderCount ≠ summary.orderCount (M2) ölçülüyor mu bilinmiyor |
| `test_order_line_scope_single_source.ts` | Prisma + ham SQL aktif-kalem kopyaları (4 satır pencere), muaf gerekçesi zorunlu | — |
| `test_fason_open_dispatch_single_source.ts` | Prisma nesne literalleri (AST) | **ham SQL kopyaları** (§6.G) |
| `scale_report.ts` | `getStockScorecard`, `getShipmentScorecard`, `getSystemLogSummary`, `getUserActivity` süre ölçümü (`:29-31,:212-240`) | diğer 15 rapor ölçülmüyor |

---

## HOTSPOTLAR

② denetçilerinin öncelikle bakması gereken yerler (dosya:satır — neden). Sıra: rakam etkisi büyükten küçüğe. Hiçbiri bulgu değil; her biri "ölç ve karar ver" işaretidir.

1. **`src/services/reports/shipment-scorecard.report.service.ts:130-137` vs `src/services/reports/_shipped.ts:59-99`** — Sevk & Termin günlük serisi `shipments JOIN rolls` ile **NET** (iade geri-eklemesi ve doğrudan sevk yok) hesaplanırken başlık metriği `_shipped` ile **BRÜT+direkt**. İadeli/direkt sevkli dönemde grafik çubuklarının toplamı başlıktan küçük çıkar; bekçi `scripts/test_shipment_scorecard.ts:103-118` günlük seriyi toplamıyor. "TEK TANIM" iddiası (`_shipped.ts:2-7`, CLAUDE.md 2026-08-09) bu satırı kapsamıyor. Prod'da iade 5 satır, direkt 0 → fark bugün ≤ iade metrajı kadar.
2. **`src/services/reports/quality-scorecard.report.service.ts:192-194` + `scrap-scorecard:204-206` + migration `20260809090000/migration.sql:79-86`** — `finalizedAt` yalnız final statüye GİRİŞTE yazılır ve çıkışta (yeniden üretime alma: `WAREHOUSE → IN_PRODUCTION/AT_SUBCONTRACTOR`) SİLİNMEZ; karne süzgeci `status NOT IN K18` olduğu için o toplar **eski dönemde, eski kalitesiyle, ŞU ANKİ metrajıyla** sayılmaya devam eder (yeniden finalize olunca damga taşınır). Prod kopyasında 4 top (`T240826F0031/34/35/36`, 475 m, §8.2 #4/#31). Bekçi `test_quality_scorecard` bu geçişi sondalamıyor. Soru: ara dönemde "üretim" mi (evet, o dönemde bitmişti) yoksa "üretimden geri alındı" mı (restatement) — karar yazılı değil.
3. **`src/services/reports/subcontract-scorecard.report.service.ts:141`** — `COALESCE(sri."receivedQty", nr."currentQty")`: eski makbuz satırlarında (prod 635/638) "dönen metraj" doğan topun **CANLI** `currentQty`'si; yorum "tüketim anında eşit" der ama Tambur açık-kumaş kesimi (K7a 2.B `cutOpenFabric` yalnız `currentQty` düşer) ya da `finalizeWarehouseCut`/geri alma bu değeri değiştirir → legacy kalemlerde fire sonradan **şişer/söner**. Bugün 76 676 = 76 676 m (tümü fason→fason zincirinde `SUBCONTRACTOR_CONSUMED`); ilk Tambur kesimi yiyen legacy doğan topta eşitlik bozulur. Backfill (`receivedQty` NULL → `initialQty`?) hiç yazılmamış.
4. **`src/services/reports/subcontract-scorecard.report.service.ts:161-167`** — sapma düzeltmesi `rv.rollId = sdi.rollId AND rv.workOrderStepId = sd.stepId` ile eşlenir; `RollVariance.sourceRefId` (migration `20260821120000`, K7a: "terslemenin adresi") kullanılmaz. Aynı top aynı adıma iki kez sevk edilirse (kısmi kabul → yeniden sevk, iade → boyahaneye geri gönder) her iki kalem aynı sapmayı alır (çift). Bugün 0 çift (prod/dev), `SUBCONTRACTOR_RETURN` sapması 0 satır.
5. **`src/services/accounting-export.service.ts:480-482` vs `shipping.service.ts:2426` vs `_shipped.ts:81-99`** — doğrudan sevk metrajı üç yüzeyde iki tanım: export `Σ ds.rolls.currentQty`, Sevkiyatlar listesi ve `_shipped` `DirectShipment.totalQty` (denormalize, `_shipped` farkı mutabakat satırıyla kapatır). Bağlı top sonradan kesilirse/bağ kurulmamışsa muhasebe Excel'i ekrandan farklı metraj basar. Prod'da direkt sevk 0 — gözlemlenemez; `test_accounting_direct_ship` fixture'ında iki değer eşit.
6. **`src/services/reports/order-intake.report.service.ts:132,:141-144` vs `:175,:182`** — `summary.orderCount` iptalleri DAHİL sayar, `daily.orderCount` (`o.status <> 'CANCELLED'`) HARİÇ → Σgünlük ≠ özet adet; başlık notu (`:16-23`) metraj asimetrisini yazıyor, **adet** asimetrisini yazmıyor. `test_order_intake` okunmadı.
7. **`src/services/reports/quality-scorecard.report.service.ts:298-302`** — "en üst kalite" `quality_grades` `sortOrder ASC` ilk satır, `isActive` süzgeci yok; pasifleştirilmiş bir kalite en küçük `sortOrder`'ı taşıyorsa başlık metriği ona kilitlenir (bugün 3 kalite aktif). `loadProducedBuckets` (`roll-finalize.helper.ts:76-78`) de `isActive` süzmez — CLAUDE.md bunu bilinçli der; karne için aynı karar yazılı değil.
8. **`src/services/reports/stock-scorecard.report.service.ts:127,:201` vs `src/services/production-balance.service.ts:276,:344`** — Stok Karnesi `finished` = WAREHOUSE+A1_STOCK, Ürün Dengesi `depo` = yalnız WAREHOUSE (A1_STOCK arz değil) → 2. kalite top karnede "bitmiş depo"da, dengede hiçbir kovada değil (ne depo ne ham); `uncovered` hesabı 2. kaliteyi siparişe karşılık sayar. Prod'da A1_STOCK 0 top; katalogda A1 `targetStatus=WAREHOUSE` olduğu için bugün doğmuyor — `returnTargetStatus=A1_STOCK` (iade kalitesi) ile doğabilir.
9. **`src/services/reports/subcontract-scorecard.report.service.ts:143-145,:195,:280-291`** — fason "kapanmış/açık kalem" kuralının ham SQL kopyası; tek kaynak `helpers/fason-open-dispatch.helper.ts:48-64` ve AST bekçisi (`scripts/test_fason_open_dispatch_single_source.ts:74-130`) yalnız Prisma nesne literallerini tarar. Semantik bugün eşdeğer; helper'a beşinci koşul eklenirse karne sessizce ayrışır (2026-08-21 "22 kopyanın 4'ü eksikti" vakasının rapor ikizi).
10. **`src/services/reports/_shipped.ts:72-73`** — canlı toplar `rolls JOIN disp ON r.shipmentId` top statüsü süzülmeden; DISPATCHED sevkiyatta SHIPPED olmayan top (kısmi storno? iade `shipmentId` NULL'lar — K7a) kalırsa sayılır. Prod: DISPATCHED sevkiyatların tüm topları SHIPPED (689/689). `batch-trace:152-155` aynı JOIN'i **sevk statüsü süzmeden** yapar → PLANNED sevkiyattaki 12 WAREHOUSE top parti izlemede "müşteriye gitti" görünür.
11. **`src/services/dashboard.service.ts:86-91`** — `queueCount` `rolls.currentStepId` bağlı tüm toplar, statü süzgeci yok (`activeCount`/`todayCompleted` hareket bazlı). İptal/fire/kartela yolu `currentStepId`'yi temizliyor mu — prod'da yalnız canlı statüler taşıyor (§8.2 #25) ama guard'ın kodu bu haritada okunmadı [VARSAYIM]. `:126-135` RAW_QC sayacı `colorId IS NULL` ve `entrySource ∈ {SUPPLIER_RECEIPT, MANUAL_ENTRY}` → yarı mamul/renkli ham giriş "bugün giren" sayılmaz (2026-08-26 mobil KK1 gizleme vakasının pano ikizi).
12. **`src/services/reports/stock-scorecard.report.service.ts:193-199`** — talep `Number(quantity) − Number(shippedQty)` float; denge Decimal (`production-balance:230-233`); "BİREBİR" yorumu (`:166`) aritmetiği kapsamıyor. Prod verisi 1-ondalıklı → fark yok; kural ihlali (K7a §3.1 "dönüşüm sonrası aritmetik").
13. **`src/services/reports/shipment-scorecard.report.service.ts:151-153`, `order-cancellation:140-141,:134`** — `plannedQty/qty` aktif kalem Σ, `shippedQty` sipariş başlığı (iptal kalemin sevki dahil) → kalem iptali olan siparişte "sevk > planlanan" satırı. Kolon prod kopyasında yok; dev'de iptal kalem 0.
14. **`src/services/reports/customer.report.service.ts:49-52` vs `customer-scorecard:188-191`** — profil `order_count` CANCELLED dahil + yalnız `isActive` müşteri (`mergedIntoId` süzgeçsiz); karne CANCELLED hariç + `mergedIntoId IS NULL`. Aynı müşteri iki ekranda iki sipariş adedi. Prod: iptal 4, merged 0 → küçük fark.
15. **`src/services/reports/open-order-coverage.report.service.ts:141-143` vs `:275-276`** — `coveragePct` kovada Decimal `div`, özette float `*100/openNum`; aynı formül iki aritmetik (0,1 fark adayı büyük paydada; ölçülmedi).
16. **`src/services/reports/customer-scorecard.report.service.ts:267-273`, `demand-analysis:237-243`** — kümülatif pay **yuvarlanmış** `sharePct` (0,1) birikimiyle hesaplanır; 200+ satırda birikim hatası ±%1'e ulaşabilir ve ABC sınırı/`coreSpecCount` kayar (ölçülmedi; prod müşteri 27, spec ≤281).
17. **`src/services/reports/wip-scorecard.report.service.ts:96,:131`** — bekleyen metraj `qtyIn` (giriş metrajı); kısmi fason kabulde hareket `qtyIn` değişmez [VARSAYIM] → fasonda 49 m kalan kalem WIP'te 100 m "bekliyor". Prod: açık hareketlerin 188/224'ü AT_SUBCONTRACTOR; kısmi kabul 1 satır.
18. **Performans (H):** `stock-scorecard:138-165` tüm serbest toplar belleğe (tavan yok, index yok — tetik yazılı `:32-38`), `plan-deviation:109-127` dönemin tüm satırları 5 ilişkiyle (detay kırpması JS'te), `customer-scorecard:168-204` her çağrıda tam ömür taraması, `production-balance` + `computeWoMaterial` 8 sorgu (kapsama raporu her açılışta), `accounting-export` 2 000 sevkiyat × iç içe toplar; `orders.orderDate/completedAt/cancelledAt` index'siz (5 rapor). Bugünkü ölçek küçük (278 sipariş / 2 431 top); `scale_report.ts` yalnız 4 raporu ölçüyor.
19. **`src/services/reports/_shared.ts:172-202`** — `eachDay`/`ymdLocal` çağıransız (ölü kod; yorum bunu söylüyor `:174`); `production.report.service.ts:18` `factoryDaySql` ölü import. Bulgu değil, temizlik adayı.
20. **`src/services/accounting-export.service.ts:49,:181-182` vs `_shared.ts:15,:51-54`** — varsayılan pencere export'ta 90 gün, raporlarda 30 gün (ikisi de mutlak, ikisi de belgeli); istemci her zaman aralık gönderdiği için [VARSAYIM] görünmez.

---

## SINIR ÖTESİ NOTLAR

| Gözlem | Yönlendirme |
|---|---|
| Electron rapor sayfaları "TOPLAM" satırını sunucunun yuvarlanmış kırılım satırlarını toplayıp yeniden yuvarlayarak kurar (`Electron/src/pages/Reports/Sales/shipmentScorecard.ts:61-66`, `returnScorecard.ts:57-62`, `Inventory/stockScorecard.ts:70-71,:89`, `Subcontract/scorecard.ts:96`; `Sales/openOrderCoverage.ts:88-92` yuvarlamasız float) → özet (`summary.*`) ile tablo toplamı 0,1 m ayrışabilir; `reportExport.ts` tek spec kuralı (arşiv notu) bunu kapsıyor mu? | **K-Electron / istemci turu** |
| `useReportDateRange.ts:13-33` gün sınırını **renderer makinesinin** saat dilimiyle çizer (fabrika TZ değil); sunucu dokunmaz. Türkiye dışı bir masaüstü/uzak bağlantı raporu 3 saat kaydırır. | K-Electron |
| Mobil çekme yüzdesi (`receivePayload.helper.ts:175-198`) ↔ backend fason `firePct` (payda giden vs düşülen) — §6.E | K-mobil (fason kabul) |
| Pano RAW_QC "bugün giren" `colorId IS NULL ∧ entrySource ∈ {SUPPLIER_RECEIPT, MANUAL_ENTRY}` (`dashboard.service.ts:126-135`) — yarı mamul (`SEMI_FINISHED`) ve renkli ham giriş sayılmaz; mobil KK1 "Son Kayıtlar" kapsamıyla eşitliği 2026-08-26 sonrası yeniden doğrulanmalı | K-mobil / K1 |
| `finalizedAt` çıkışta silinmiyor (H2) — düzeltme trigger/migration ister (`prod_risk: yuksek` sınıfı); `restoreCancelledRoll` (`CANCELLED → *`) ve `quickStart` rework yolu damgaya dokunuyor mu? | **K2 (şema/trigger) + K7a (rework yazma yolu)** |
| `SubcontractorReceiptItem.receivedQty` NULL 635/638 (prod) — backfill yok; karne fallback'i canlı `currentQty` (H3) | **K2 / K7a (fason kabul yazımı)** |
| `orders.orderDate/completedAt/cancelledAt` index yok; `rolls.statusChangedAt` index bilinçli yok; `endpoint_latency_daily` retention DELETE (fiziksel silme istisnası, `latency-persist:172`) | **K2 / H** |
| `attachTotals` RepeatableRead batch tx (`shipping.service.ts:2569-2610`); `_shipped.ts` tek `$queryRaw` (tek ifade → tek anlık görüntü); `buildShipmentListSummary` 5 ayrı `aggregate` **`Promise.all` ile ayrı bağlantı/ayrı görüntü** (`:2698-2709`) — iade commit'i aralığa düşerse bant ile satırlar ayrışır (F-SEV-ESZ-002'nin muhasebe bandı ikizi) | **K3 (eşzamanlılık)** |
| `now() AT TIME ZONE 'UTC'` ile `exitedAt` yazan 11 ham SQL noktası (`workorder.service` ×4, `subcontractor.service` ×5, `kursun-bypass:2347`, `kursun-qc:896`) — oturum UTC'ye bağlı doğruluk; WIP/pano süreleri bu kolonu okur | K7a / K3 |
| Fason "açık kalem" AST bekçisi ham SQL'i görmüyor (§6.G); "aktif kalem" bekçisi görüyor — bekçi asimetrisi | K-bekçi (code-review §8) |
| `qtyOut NULL` 14 kapalı hareket (K7a H5) → `getTravelerTrace:177` `null` basar, `work-session-activity:403` `null`; WIP `qtyOut` okumaz (etkilenmez) | K7a |
| İş emri "ÇIKAN" (`workorder.service.ts:1842-1866`) `initialQty`, karne `currentQty` — aynı topun iki yüzeyde iki metrajı (§6.B) | K7a (iş emri metrikleri) |
| `Roll.finalizedAt` SHIPPED toplarda dolu (689) ve karne bunları `currentQty` ile sayar — iade edilip depoya dönen topun damgası korunur (trigger `SHIPPED→WAREHOUSE` dışı) → doğru; ama iade **kalite yeniden verirse** (`returnGradingEnabled`, `QualityGrade.returnTargetStatus`) damga ile kalite ayrışır (`finalizedAt` ≠ `qualityGradeId` olayı — trigger yorumu `:81-85` invariant'ı) | **K7a (iade kalite yazımı) + K2** |
| `docs/history/SCALE-REPORT.md` (audit raporu yorumunda referans, `audit.report.service.ts:29`) repo kökünde bulunamadı (`docs/history` dizini `Teks-Erp/` altında yok) — yolu K-doc doğrulasın | K-doc |

---

## KAPSANMAYAN / ERİŞİLEMEYEN

- **Bekçi içerikleri:** `test_order_intake.ts`, `test_order_cancellation.ts`, `test_demand_analysis.ts`, `test_order_leadtime.ts`, `test_customer_scorecard.ts`, `test_batch_trace.ts`, `test_reports.ts`, `test_timestamptz_contract.ts`, `test_latency_middleware.ts`, `test_latency_stats.ts`, `test_work_session*.ts` — varlıkları listelendi, kontrol satırları okunmadı (grep çıktısı 400 satırda kesildi). "Σdaily.orderCount = summary" (H6) ölçülüyor mu bilinmiyor.
- **Electron rapor sayfalarının hesapları** — yalnız `useReportDateRange.ts` ve `reduce(` vuruşları (59 satır, 17 dosya) grep düzeyinde; `reportExport.ts` (tek spec) okunmadı.
- **Mobil** — yalnız `receivePayload.helper.ts:160-200` (çekme yüzdesi) okundu; mobil pano/istatistik yüzeyleri yok sayıldı.
- **`shipping.service.ts` `getDispatchReport` (:3180-3300) ve `collectShipmentDocContent` (:3389-3531)** — K7a'ya bırakıldı; burada yalnız `attachTotals`/`buildShipmentListSummary` okundu.
- **`computeWoMaterial`/`computeWoInput` doğruluğu** (K7a H9/H18) — burada yalnız Ürün Dengesi'nin tüketimi haritalandı.
- **İptal Karnesi ve `ACTIVE_LINE` prod ölçümü** — kolonlar prod kopyasında yok (190/195 migration); dev'de iptal kalem 0, iptal sipariş damgasız 4/4 → rapor davranışı canlı veriyle ölçülemedi.
- **Plan-Sapma Karnesi canlı ölçümü** — prod ve dev'de 0 satır.
- **Doğrudan sevk (`DirectShipment`) yüzeyleri** — prod/dev'de 0 satır; `_shipped` ⑤ mutabakat satırı, export S5 ve liste `totalQty` ayrışması (H5) yalnız kod okumasıyla haritalandı.
- **`currentStepId` temizleme guard'ları** (iptal/fire/kartela yolları) — Pano `queueCount` için [VARSAYIM] bırakıldı; kod okunmadı.
- **Kısmi fason kabulde `RollMovement.qtyIn` davranışı** (H17) — `subcontractor.service` kabul yolu okunmadı [VARSAYIM].
- **`restoreCancelledRoll` / `quickStart` rework yolunun `finalizedAt`'e etkisi** — trigger UPDATE dalı yalnız statü değişiminde çalışır; uygulama kodu damgayı elle temizliyor mu bakılmadı (H2 için ② okumalı: `grep -rn "finalizedAt" src/services`).
- **Decimal→double hassasiyet ölçümü** — `::float` yolu teorik olarak 12,3 için kayıpsız; sayısal sonda koşulmadı.
- **Rapor uçlarının gerçek yanıt süreleri** — `scale_report.ts` koşulmadı (salt-okunur kural: script çalıştırmak DB'ye fixture yazar); §8.4 yalnız satır sayısı ve sorgu şekli.
- **`docs/history/SCALE-REPORT.md`** — bulunamadı (yol `Teks-Erp/docs/history` yok); audit raporunun perf notları doğrulanamadı.
- **`endpoint_latency_daily` retention DELETE'inin "soft delete" kuralı istisnası olarak belgelenip belgelenmediği** — CLAUDE.md istisna listesinde geçmiyor; K2/K8'e bırakıldı.
- **Canlı prod** — erişim yok; tüm sayılar 2026-08-25 kopyası.
