# TeksERP — Gerçekçi Yük/Ölçek Raporu (Faz C1)

**Tarih:** 2026-06-14
**DB:** `teks_loadtest` (geçici; ölçüm sonrası `dropdb` ile silindi — bu rapor kalıcı)
**Ortam:** PostgreSQL 17 (yerel macOS), `TZ=UTC`, `statement_timeout=0` (loadtest DB'sinde kapalı)
**Senaryo:** `ORDERS_PER_DAY=50 × DAYS=365 = 18.250 sipariş` (1 yıllık çalışma)
**Üreteç:** `Teks-Erp/scripts/seed-load-scale.ts` — `npm run seed` master-data üstüne, chunk'lı `createMany` (4000/insert), tarihler 1 yıla yayılmış, statüler gerçekçi dağıtılmış.
**Ölçüm:** `Teks-Erp/scripts/scale_report.ts` — her hot sorgu gerçek servis metoduyla N=20 koşu (p50/p95) + `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)`.

> **YÖNTEM NOTU:**
> - Aday sorgular **gerçek servis metotlarıyla** çağrıldı (HTTP'siz, doğrudan import). EXPLAIN için temsilci SQL kullanıldı.
> - p50/p95 = servis-seviyesi (Prisma + JS dönüşüm dahil); EXPLAIN `exec ms` = saf DB-içi. Bir servis metodu birden çok sorgu çalıştırıyorsa (örn. audit raporları **4 sorgu**) p50 **tüm alt-sorguların toplamıdır** → bu yüzden p50 ≫ tek EXPLAIN exec ms.
> - **Cache etkisi:** Soğuk-önbellek ilk koşumda `getSystemLogSummary` p50≈877 ms ölçüldü; ANALYZE+VACUUM sonrası **sıcak-önbellek** (steady-state, cache hit %99) p50≈296 ms. Aşağıdaki tablo **sıcak-önbellek** (gerçekçi steady-state) değerleridir; soğuk-pik ayrıca not edildi. Üretim sunucusu çoğunlukla sıcak çalışır ama soğuk başlangıç/yeniden başlatma sonrası ilk audit raporu yavaştır.

---

## 1. Üretilen Hacim (1 yıl, 50 sipariş/gün) — GERÇEK COUNT

| Tablo | Satır (50/gün, 1 yıl) | Satır/sipariş | **100/gün ekstrapolasyon (1 yıl)** |
|---|---:|---:|---:|
| orders | 18.250 | 1,0 | 36.500 |
| order_lines | 27.306 | ~1,5 | 54.600 |
| work_orders | 18.250 | 1,0 | 36.500 |
| work_order_steps | 54.750 | 3,0 | 109.500 |
| rolls | 54.750 | 3,0 | 109.500 |
| roll_operations | 158.070 | ~8,7 | 316.000 |
| roll_movements | 158.070 | ~8,7 | 316.000 |
| traveler_cards | 18.250 | 1,0 | 36.500 |
| traveler_card_scans | 109.500 | 6,0 | 219.000 |
| shipments | 8.076 | ~0,44 | 16.150 |
| shipment_orders | 8.076 | ~0,44 | 16.150 |
| sacks | 20.185 | ~1,1 | 40.370 |
| shipment_allocations | 10.889 | ~0,6 | 21.780 |
| **system_logs** | **427.779** | **~23,4** | **~855.500** |
| **TOPLAM** | **1.092.201** | ~60 | **~2,18 milyon** |

> NOT: Bu profil her sipariş için 1 WO + 3 adım + 3 top + ~8,7 op/hareket + 6 tarama + ~%44 sevkiyat üretir. ~21.800 top sevkiyat/çuvala bağlandı (gerçek sevk içeriği). Gerçek fabrikada oran biraz değişebilir; system_log/order oranı (~23,4) audit yoğunluğuna göre ±%30 oynar.

**DB disk boyutu (50/gün, 1 yıl):** `402 MB` (`pg_database_size`). Ekstrapolasyon:
- 100/gün, 1 yıl → ~**805 MB**
- 100/gün, 3 yıl → ~**2,4 GB**

ERP yerel sunucuda yıllarca çalışacağı için **disk darboğaz değil.**

### En büyük 10 tablo (heap + index)

| Tablo | Heap | Index | Toplam |
|---|---:|---:|---:|
| **system_logs** | 61 MB | **107 MB** | **168 MB** |
| roll_operations | 18 MB | 39 MB | 56 MB |
| roll_movements | 21 MB | 29 MB | 51 MB |
| traveler_card_scans | 15 MB | 21 MB | 35 MB |
| rolls | 12 MB | 19 MB | 30 MB |
| work_order_steps | 7 MB | 7,7 MB | 14 MB |
| work_orders | 3 MB | 3,4 MB | 6,5 MB |
| order_lines | 3,7 MB | 2,6 MB | 6,4 MB |
| sacks | 2,5 MB | 3,7 MB | 6,2 MB |
| orders | 2,8 MB | 3,0 MB | 5,9 MB |

> **Gözlem:** `system_logs` tek başına DB'nin ~%42'si (168 MB). İndeksleri (107 MB) heap'inden (61 MB) **büyük** — 4 index var: `[tableName,recordId]`, `[createdAt]`, `[category,createdAt]`, `[userId,createdAt]`. 6 ayda bir arşivleme (`POST /api/admin/system-logs/archive`) bu yüzden tasarlanmış ve **kritik** (Öneri B).

---

## 2. Hot Sorgu Performansı (sıcak-önbellek p50/p95 + EXPLAIN plan)

| # | Sorgu (gerçek servis) | p50 | p95 | Plan | EXPLAIN exec | Darboğaz? |
|---|---|---:|---:|---|---:|---|
| 1 | `dashboard.getStationsLiveState` | 32,1 ms | 81,6 ms | Seq Scan: stations(5)+rolls(NL join) | 17,8 ms | ✗ kabul edilebilir |
| 2 | `inventory.findAllRolls` (WAREHOUSE cursor) | **3,5 ms** | 7,0 ms | **Index** (`[status,createdAt]`) | 0,03 ms | ✗ mükemmel |
| 3 | `inventory.getRollStats` (groupBy) | 12,8 ms | 17,3 ms | Seq Scan: rolls (full-table aggregate) | 12,9 ms | ✗ optimal (WHERE yok) |
| 4 | `inventory.findAllRolls` (item.name contains) | 43,5 ms | 51,9 ms | Seq Scan: rolls (OR predicate) | 45,7 ms | △ tasarım gereği (not) |
| 5 | `inventory.findAllRolls` (barcode equals) | 45,2 ms* | 75,4 ms* | **Index** (barcode unique) | 0,8 ms | ✗ (servis ısınma yükü; DB hızlı) |
| 6 | `reports.getStockDistribution` | 34,5 ms | 71,0 ms | **Bitmap Index Scan: rolls** (`[colorId,status]`) | 13,1 ms | ✗ index kullanıyor |
| 7 | `reports.getOrderFulfillment` | 39,0 ms | 64,2 ms | Index (orders + LATERAL) | 29,9 ms | ✗ index'li |
| 8 | **`reports.getSystemLogSummary`** | **296,6 ms** | **496,5 ms** | **Parallel Seq Scan: system_logs ×4 sorgu** | 50,3 ms/scan | **✓ DARBOĞAZ** |
| 9 | `reports.getUserActivity` | 77,7 ms | 115,4 ms | Parallel Seq Scan: system_logs (tek) | 101,3 ms | △ orta (tek scan) |
| 10 | `SystemLog.list` (userId+DOMAIN, sayfa 1) | 1,6 ms | 1,9 ms | **Index** (`[userId,createdAt]`) | 0,2 ms | ✗ mükemmel |
| 11 | `SystemLog` derin sayfa (OFFSET 1000) | 2,4 ms | 3,3 ms | **Index** (`[userId,createdAt]`) | 1,9 ms | ✗ (cursor zaten önerilen) |
| 12 | `subcontractor receipts list` (items+newRoll) | 0,6 ms | 1,7 ms | Index | 0,005 ms | ✗ N+1 yok (§3) |
| 13 | `shipping.getShipmentById` (büyük sevk) | 3,5 ms | 9,1 ms | Prisma nested select (**18 sabit sorgu, N+1 YOK**) | — | ✗ N+1 yok (§3) |

\* #5'teki p50 ~45 ms, ısınma + servis-katmanı (parseQueryParams + buildRollWhere + Prisma round-trip) yüküdür; DB-içi gerçek maliyet **0,8 ms** (unique index seek). Süzgeç EXPLAIN exec'tir.

**Soğuk-önbellek farkı (yeniden başlatma sonrası ilk koşu):** `getSystemLogSummary` 877 ms / 1358 ms, `getUserActivity` 174 ms, `getStockDistribution` 75 ms, `getOrderFulfillment` 174 ms ölçüldü. Sıcak steady-state yukarıdaki tablodur; üretim çoğunlukla sıcak çalışır.

---

## 3. Hipotez Doğrulama (her biri EXPLAIN ile KANIT)

### ✓ DARBOĞAZ #1 — `getSystemLogSummary` 4× full-table scan (KANITLANDI)

**İddia:** SystemLog en hızlı büyüyen tablo; özet raporu yavaşlar.
**Kanıt:** Servis **4 ayrı sorgu** çalıştırıyor (total + byAction + byTable + daily). Her biri `WHERE createdAt >= now()-365d` ile **427.779 satırın ~%100'ünü** tarıyor:

```
Finalize GroupAggregate (actual time=49.1..50.3 rows=16)
  -> Gather Merge (Workers Launched: 2)
       -> Partial HashAggregate (actual time=46.7 rows=16 loops=3)
            -> Parallel Seq Scan on system_logs
                 (cost=0..10901 rows=178241) (actual rows=142593 loops=3)
                 Filter: ("createdAt" >= (now() - '365 days'::interval))
Execution Time: 50.330 ms   ← TEK sorgu (sıcak)
```

Tek sorgu 50 ms (sıcak); **4 sorgu toplamı → p50 296 ms, p95 496 ms** (soğukta 877/1358 ms). `@@index([createdAt])` **kullanılmıyor** çünkü predikat satırların ~%100'üyle eşleşiyor (düşük seçicilik → planner doğru olarak seq scan seçiyor; bu "eksik index" DEĞİL, beklenen davranış). 100/gün'de tablo 856k satır → bu rapor **~600 ms (sıcak) / ~2 s (soğuk)**'ye çıkar. Audit raporu nadir bir ekrandır ama bu süre fark edilir.

### △ ORTA #2 — `getUserActivity` tek full scan + users join

**Kanıt:** Tek `Parallel Seq Scan on system_logs` (142k×3=427k) + minik `users` hash join → 101 ms exec, p50 78 ms (sıcak). Tek geçiş olduğu için #1'in dörtte biri. Yıllık aralık tüm tabloyu kapsadığından index faydasız. 100/gün'de ~150 ms — kabul edilebilir.

### ✗ DARBOĞAZ DEĞİL — `getOrderFulfillment` LATERAL (hipotez ÇÜRÜTÜLDÜ — sıcakta)

Sıcak-önbellek p50 39 ms (soğukta 174 ms). `orders` index'ten okunuyor; `LATERAL (SUM order_lines)` her sipariş için çalışıyor ama 29,9 ms exec. 18k siparişte iyi; 100/gün'de ~60-80 ms.

### ✗ DARBOĞAZ DEĞİL — `getStockDistribution` (hipotez ÇÜRÜTÜLDÜ)

EXPLAIN'deki "Seq Scan" yalnız minik master tablolarda (`items`=1, `colors`=6 satır). Büyük `rolls` tablosu **`rolls_colorId_status_idx` Bitmap Index Scan** kullanıyor:

```
Bitmap Heap Scan on rolls r (actual rows=20389)
  Recheck Cond: (status = ANY ('{WAREHOUSE,STOCK,PRODUCED}'))
  -> Bitmap Index Scan on "rolls_colorId_status_idx" (actual time=0.6 rows=20389)
Execution Time: 13.075 ms
```

İndeks doğru çalışıyor → **darboğaz yok.**

### ✗ DARBOĞAZ DEĞİL — `findAllRolls` liste + stats + barcode (hipotez ÇÜRÜTÜLDÜ)

- WAREHOUSE cursor liste: `[status,createdAt]` composite → **0,03 ms** DB exec, p50 3,5 ms. Mükemmel.
- barcode equals: unique index seek → **0,8 ms** DB exec.
- getRollStats: `WHERE`'siz (status=ALL) full-table groupBy → seq scan **optimal** (tabloyu zaten tam okuması gerekiyor), 13 ms.
- item.name `contains`: seq scan on rolls — **bilinçli tasarım** (CLAUDE.md: barkod=equals hızlı, ürün adı=contains master join'de kabul). 46 ms exec; 54k rolls'ta tolere edilir, 100/gün 110k'da ~90 ms.

### ✗ N+1 YOK — `shipping.getShipmentById` (hipotez ÇÜRÜTÜLDÜ — query sayısı sayıldı)

`getShipmentById` Prisma **nested `select`** kullanıyor (rolls + sacks→rolls/swatches + orders→lines→item/color + allocations). Prisma log'larından **gerçek SQL sorgu sayısı = 18** sayıldı — bu **ilişki ağacı derinliği kadar SABİT**, satır sayısıyla **artmaz** (N+1 olsaydı top sayısı × sorgu olurdu). p50 3,5 ms. **N+1 yok.**

### ✗ N+1 YOK — `subcontractor receipts list` (items + newRoll)

Prisma `include: { items: { include: { newRoll } } }` → **3 sabit sorgu** (ana + 2 ilişki batch'i) sayıldı, N+1 değil. (Not: loadtest verisinde fason makbuzu üretilmedi → tablo boş; sorgu **yapısı** doğrulandı, satır arttıkça sabit sorgu sayısı korunur.)

### ✓ KORUMA AKTİF — `MAX_OFFSET=10000` guard

`buildPagination(300, 50)` (skip=14.950 > 10.000) → `AppError 400` fırlattı. **Guard çalışıyor.**

---

## 4. Sağlık Metrikleri

| Metrik | Değer | Yorum |
|---|---|---|
| Cache hit oranı (heap) | **%99,02** (hit=28,6M / read=284k) | Çalışan set RAM'e sığıyor |
| Dead-tuple (rolls) | %0 (0/54.750) | Taze yük; UPDATE/DELETE ağır kullanımda izlenmeli |
| Dead-tuple (system_logs) | %0 (0/427.779) | Append-only → düşük; arşivleme sonrası autovacuum gerekir |

---

## 5. Önerilen İyileştirmeler (Faz C2 girdisi)

> Yalnız **kanıtlanmış + ölçülebilir fayda** sağlayanlar. Her biri: değişiklik + neden + beklenen fayda + risk.

### Öneri A — `getSystemLogSummary` tek-geçiş aggregate (YÜKSEK öncelik) ✓ kanıtlı

- **Ne:** 4 ayrı full-scan'i **tek sorguya** birleştir. `total` + `byAction` + `byTable` + `daily` aynı `system_logs` taramasında `GROUPING SETS ((action), ("tableName"), (DATE_TRUNC('day',"createdAt")), ())` + `FILTER` ile tek geçişte çıkarılabilir (`audit.report.service.ts:getSystemLogSummary`).
- **Neden:** Bugün aynı 428k satır **4 kez** taranıyor (her biri ~50 ms sıcak / ~124 ms soğuk).
- **Beklenen fayda:** p50 296 ms → **~80-120 ms** (sıcak); soğuk 877 ms → ~250 ms (≈3-4× hızlanma). Plan değişmez (yine seq scan ama 1×).
- **Risk:** DÜŞÜK. Salt-okuma SQL; çıktı şekli aynı (`test_reports.ts` ile doğrulanır). GROUPING SETS okunabilirliği biraz düşürür.

### Öneri B — Audit log arşivleme politikasını işlet (YÜKSEK öncelik, operasyon) ✓ kanıtlı

- **Ne:** `POST /api/admin/system-logs/archive { monthsToKeep: 6 }`'yi gerçekten 6 ayda bir çalıştır (CLAUDE.md'de yazılı; otomasyon/cron önerilir).
- **Neden:** system_logs DB'nin %42'si (168 MB), index'i 107 MB. 100/gün'de yılda 856k → 3 yılda 2,5M+ satır; tüm audit yollarını ve disk/önbelleği baskılar.
- **Beklenen fayda:** Aktif tabloyu ~son 6 aya sınırlar → audit raporları stabil; index ~yarılanır.
- **Risk:** DÜŞÜK (mevcut, test edilmiş uç). Disiplin/otomasyon gerektirir.

### Öneri C — Audit raporlarına **dar varsayılan tarih aralığı** (ORTA) ✓ kanıtlı

- **Ne:** `getSystemLogSummary`/`getUserActivity` UI'sı 365 gün yerine **son 30 gün** default açılsın (servis zaten `DateRange` alıyor; default'u darut). 30 gün aralık `@@index([createdAt])`'i **kullanılabilir** kılar (yüksek seçicilik → index scan).
- **Neden:** Yıllık aralık tüm tabloyu kapsar (seq scan). 30 gün ~%8 satır → index seek.
- **Beklenen fayda:** Default açılış seq scan→index scan → p50 296 ms → **<100 ms**. Geniş aralık isteyen bilerek bekler.
- **Risk:** DÜŞÜK; UX kararı (default aralık değişimi) — kullanıcıya sorulmalı.

### Öneri D (İZLE, şimdi UYGULAMA)

- `getUserActivity` (p50 78 ms sıcak) henüz darboğaz değil; Öneri A/C zaten kapsar. Ayrı index/refactor **gereksiz** (over-engineering).
- `getStationsLiveState` (p50 32 ms) 5 istasyonlu nested-loop; istasyon sayısı küçük kaldıkça sorun yok. İzle.

### ÇÜRÜTÜLEN hipotezler — DOKUNMA (yanlış optimizasyon riski)

- `rolls` için ek index: liste (`[status,createdAt]`), stats (full groupBy), stok dağılımı (`[colorId,status]`), barkod (unique) **hepsi zaten index kullanıyor / optimal**. Yeni index = boşa yazma maliyeti.
- `getShipmentById` N+1: **yok** (18 sabit sorgu, Prisma nested select). Batch refactor gereksiz.
- `getStockDistribution` "seq scan": yalnız master tabloda; büyük tablo index'li. Dokunma.
- `getOrderFulfillment`: sıcakta 39 ms — darboğaz değil.

---

## 6. Özet

- **1 yıl × 50 sipariş/gün = ~1,09M satır, 402 MB.** 100/gün → ~2,18M satır, ~805 MB. Disk/önbellek **rahat** (cache hit %99).
- **Tek gerçek darboğaz:** `getSystemLogSummary` (4× full-scan, sıcak p50 296 ms / p95 496 ms, soğuk 877/1358 ms). 100/gün'de ~600 ms sıcak / ~2 s soğuk.
- **İkincil (orta):** `getUserActivity` (78 ms sıcak), yıllık aralıkta seq scan kaçınılmaz; dar default aralık çözer.
- **Geri kalan tüm hot yollar** (rolls liste/stats/barkod, stok dağılımı, sipariş karşılanma, audit liste/derin sayfa, sevkiyat detay) **index'li, hızlı, N+1 yok.** MAX_OFFSET guard aktif. Dead-tuple %0, cache hit %99.
- **Faz C2'de uygulanmaya değer:** Öneri A (tek-geçiş audit özeti) + Öneri B (arşivleme operasyonu) + Öneri C (dar default aralık). Diğer her şey için **darboğaz yok — dokunma.**

---

## 7. Faz C2 — Önerilerin uygulanma sonucu (BEFORE/AFTER + dürüst karar)

> §5 önerileri C2'de **ölçülerek** değerlendirildi. Sonuç: **uygulanacak faydalı KOD değişikliği YOK** — biri ölçümde regresyon çıktı, diğeri zaten mevcuttu. (before/after ölçümünün amacı tam olarak budur: teoride iyi görünen "fix"i körlemesine uygulamamak.)

### Öneri A — `getSystemLogSummary` tek-geçiş GROUPING SETS → **UYGULANMADI (ölçüm çürüttü)**
4 ayrı sorgu tek GROUPING SETS sorgusuna indirildi, aynı veride (400.000 system_log, 365-gün worst-case) A/B ölçüldü:

| Yaklaşım | p50 | p95 |
|---|---:|---:|
| ESKİ (4 ayrı sorgu) | **220 ms** | 301 ms |
| YENİ (1 GROUPING SETS) | 383 ms | 451 ms |

**GROUPING SETS ~%75 DAHA YAVAŞ (0,57×).** Neden: tek tarama olsa da 4 grouping-set + 3 `FILTER` agregatı tüm satırlarda hesaplanır; PostgreSQL'in 4 ayrı **paralel HashAggregate**'i daha verimli. Değişiklik **geri alındı**; orijinal davranış `test_reports.ts` ile doğrulandı.

### Öneri C — audit raporu dar default aralık → **ZATEN MEVCUT**
`src/services/reports/_shared.ts`: `DEFAULT_RANGE_DAYS = 30` → `resolveDateRange` boş `dateFrom`'da son 30 gün uygular. Production'da audit özeti varsayılan 30 günle çağrılır → yüksek seçicilik → `@@index([createdAt])` index scan (hızlı). §2'deki 296 ms, `scale_report.ts`'in **365-gün stres** çağrısıdır; gerçek default değil. Ek değişiklik gerekmez.

### Öneri B — audit arşivleme → operasyonel (kod yok)
`POST /api/admin/system-logs/archive { monthsToKeep: 6 }` mevcut; 6 ayda bir çalıştırma CLAUDE.md'de operasyonel disiplin olarak yazılı. Scheduler kapsam dışı.

### Faz C net sonucu (C2 ilk tur)
**Sistem ölçeğe hazır.** 1 yıl / 100 sipariş-gün (~2,18M satır, ~805 MB): tüm hot yollar index'li/hızlı, N+1 yok; production default'u (30 gün) zaten index kullanıyor. C2'nin **ilk turunda** denenen iki fix (GROUPING SETS tek-geçiş, sonradan paralelleştirme) ölçümde regresyon/nötr verdiği için uygulanmamıştı.

> **GÜNCELLEME (§8):** İlk tur "darboğaz adayı"nı yüzeyden ele aldı (tarama sayısı). **§8'de kök nedene inildi** — darboğazın %73'ü tek bir alt-sorguymuş (`daily`) ve sebebi eksik **ifade istatistiği** (planner diske-taşan tek-thread plan seçiyor). Düzeltilince worst-case **2,66× hızlandı** ve bu kez **kod + migration UYGULANDI** (ölçüldü, regresyon yok). Yani "kod değişikliği yok" sonucu §8 ile **aşıldı**.
```

---

## 8. Faz C2 — Gerçek çözüm: kök neden + UYGULANAN düzeltme (ÖLÇÜLDÜ)

> İlk tur (§7) darboğazı "4 tarama" diye yüzeyden okudu ve iki "tarama-azaltan" fix de regresyon verince durdu. Bu tur **kök nedene** indi: darboğaz tarama sayısı değil, **tek bir alt-sorgu** ve onun **kötü planı**.

### 8.1 Kök neden — `daily` alt-sorgusu maliyetin %73'ü, sebebi eksik ifade istatistiği

`getSystemLogSummary` 4 alt-sorgunun süresi **eşit değil** (430k satır, 365-gün, izolasyon probu p50):

| Alt-sorgu | p50 | Plan |
|---|---:|---|
| total (COUNT) | ~35 ms | paralel seq scan |
| byAction (GROUP BY action) | ~41 ms | **paralel** Partial HashAggregate → Gather (2 worker) |
| byTable (GROUP BY tableName LIMIT 30) | ~88 ms | paralel HashAggregate |
| **daily** (GROUP BY güne + 3 FILTER) | **~258–452 ms** | **tek-thread Sort+GroupAggregate, diske taşma** |

`daily` tek başına toplamın **~%73'ü**. EXPLAIN sebebi gösterdi: sorgu `GROUP BY DATE_TRUNC('day',"createdAt")::date` yapıyor; bu **ifadenin** distinct-değer istatistiği olmadığından planner her satırı ayrı grup sanıyor (`rows=430000`) → HashAggregate'i "çok büyük" zannedip **diske-taşan tek-thread Sort + GroupAggregate** seçiyor (`external merge Disk: 9312kB`). `byAction` ise gerçek kolon (`action`, 7 distinct, istatistik var) üzerinden **paralel in-memory HashAggregate** alıyor — 10× fark buradan.

### 8.2 Düzeltme 0 (ASIL KAZANÇ) — tam-eşleşen ifade istatistiği

`CREATE STATISTICS sl_day_exact ON ((DATE_TRUNC('day',"createdAt")::date)) FROM system_logs` (migration `20260614120000_system_log_daily_stats`). Planner artık gerçek günü (≤366) biliyor → `daily` de **byAction'ın paralel in-memory HashAggregate planına** geçiyor:

| `daily` tek-sorgu | Plan | EXPLAIN exec |
|---|---|---:|
| Önce | Sort+GroupAggregate, diske taşma, tek-thread | **258 ms** |
| Sonra | Parallel Seq Scan → HashAggregate → Gather (2 worker), bellekte 42 kB | **113 ms** |

> İlk turdaki ifade-stats denemesi (`DATE_TRUNC('day',"createdAt")` — `::date` cast'sız) ifade ağacı eşleşmediği için işe yaramamıştı; **tam eşleşme** (`::date` dahil) şarttır. ⚠️ daily sorgusunun ifadesi değişirse stats sessizce devre dışı kalır (yavaşlar, **doğru** sonuç verir) → migration'ı da güncelle.
> **Maliyet:** Yazma yoluna **SIFIR** — ifade istatistiği yalnız ANALYZE/autovacuum'da güncellenir, her INSERT'te değil. En hızlı büyüyen tabloya **index eklemeden** plan düzeltir (CLAUDE.md "hot tabloya index ekleme" uyarısıyla uyumlu).

### 8.3 Düzeltme 1+2 (kod) — derive-total + paralel sorgular

`audit.report.service.ts:getSystemLogSummary`:
1. **`total` sorgusu kaldırıldı** — `byAction` LIMIT'siz + `action` NOT NULL → `totalLogs = Σ byAction.count` (cebirsel olarak birebir). 4 tarama → 3.
2. **Kalan 3 sorgu `Promise.all` ile PARALEL** — base prisma client havuzlu (pg Pool max:30, **tx değil**) → ayrı connection'larda gerçekten eşzamanlı; süre ardışık-toplam yerine ~en-yavaş-sorgu. (Kural #11 yalnız tek-connection tx client'ı içindir.)

> Paralelleştirme **ancak Düzeltme 0 sonrası** kazanç: `daily` 452 ms ile baskınken onu hafif sorgularla eşzamanlı koşmak çekirdek/bellek-bandı için yarıştırıp **regresyon** veriyordu (probe: 0,78×) — bu yüzden ilk turda reddedilmişti. Stats `daily`'yi 113 ms'e indirip 3 sorguyu dengeleyince paralel **kazanca döndü**. SQL şekli değişmediği için (GROUPING SETS'in aksine) plan-regresyon riski yok.

### 8.4 BEFORE/AFTER — katkı ayrıştırması (aynı veri, 430k satır, 365-gün worst-case)

`scripts/bench_audit_final.ts` (stats'ı toggle ederek 3 senaryo, N=25, p50/min):

| Senaryo | p50 | min |
|---|---:|---:|
| **0) baseline** — 4 ardışık, stats yok (eski production) | 1064 ms | 654 ms |
| **1) +stats** — 4 ardışık + `sl_day_exact` | 498 ms | 330 ms |
| **2) +kod (final)** — 3 paralel + derive-total + stats | **400 ms** | **231 ms** |

- **0→1 (istatistik): 2,14× / 1,98×** ← asıl kazanç, kodda değil.
- **1→2 (kod): 1,24× / 1,43×** ← paralel + derive-total ek kazanç.
- **TOPLAM 0→2: 2,66× (p50) / 2,83× (min)** — worst-case ~1064 → ~400 ms.

> Mutlak ms değerleri §2'deki sıcak-önbellek 296 ms'ten yüksek; çünkü bu bench fresh-seed + eşzamanlı ölçüm yükü altında koştu (yüksek varyans). **Oranlar** ve **EXPLAIN exec** (daily 258→113 ms) temiz sinyal. Üretim default'u zaten 30 gün (index scan, <100 ms); bu kazanç **365-gün worst-case'i** (kullanıcı bilerek "1 yıl" seçince) iyileştirir.

### 8.5 Doğruluk + kapsam

- **Çıktı birebir korundu:** `bench_audit_summary.ts` 430k satırda eski (4-sorgu) ↔ yeni (servis) deep-equal → **AYNI** (total/byAction/byTable/daily). `test_reports.ts` **17/17** (total 0→3 derive-total doğrulandı). `tsc` temiz.
- **Uygulandı:** migration (dev'e `migrate deploy` ile) + servis kodu. `getUserActivity` aynı `daily`-tipi ifade kullanmaz → dokunulmadı (78 ms, darboğaz değil).
- **Teslim:** `bench_audit_summary.ts` (seed+A/B+doğruluk kapısı), `bench_audit_probe.ts` (paralellik izolasyonu), `bench_audit_final.ts` (katkı ayrıştırması).

---

> **Tekrar üretmek için:**
> ```bash
> dropdb teks_loadtest 2>/dev/null; createdb teks_loadtest
> export DATABASE_URL="postgresql://oad@localhost:5432/teks_loadtest?schema=public"
> export JWT_SECRET="ci-test-secret-not-for-production"; export TZ=UTC
> cd Teks-Erp && npx prisma migrate deploy && npm run seed
> ORDERS_PER_DAY=50 DAYS=365 npx tsx scripts/seed-load-scale.ts
> npx tsx scripts/scale_report.ts
> # §8 audit özeti çözümü (bench'ler system_logs'u kendi seed eder, ~430k):
> npx tsx scripts/bench_audit_summary.ts   # A/B + doğruluk kapısı (deep-equal)
> npx tsx scripts/bench_audit_probe.ts     # paralellik izolasyonu + EXPLAIN
> npx tsx scripts/bench_audit_final.ts     # katkı ayrıştırması (stats toggle)
> dropdb teks_loadtest
> ```
