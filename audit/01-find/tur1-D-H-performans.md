# TUR 1 — D-H · Performans & Ölçeklenebilirlik [P5]

> Denetçi: D-H · Tarih: 2026-08-28 · Dal `adnansahin`, HEAD `ce8681d1`
> Veri kaynakları: **prod kopyası** `tekserp_saha_0825` (2026-07-16 → 2026-08-25, 190 migration) ve **dev** `adnansahin_db` — ikisi de `audit/tools/sql-*.sh` ile SALT-OKUNUR.
> Kontrol listesi: `Teks-Erp/teks-erp-denetim-promptu-v2.md` Bölüm 3-H (satır 620-631) + göreve eklenen 10 alt madde.

---

## 0. ÖLÇÜM ZEMİNİ — bulguları okumadan önce (üç uyarı)

**(0a) Bugünkü ölçek KÜÇÜK, ve bu bir bulgu değil bir bağlamdır.** Prod kopyasında tüm veritabanı **33 MB**; en büyük tablo `system_logs` 6.656 kB / 10.485 satır, `rolls` 2.688 kB / 2.431 satır. 40 günlük canlı kullanımda toplam **175.242 HTTP isteği** (311 uç), en yoğun gün 14.958 istek ≈ vardiya içinde ~25 istek/dk. Bu ölçekte "yavaş sorgu" diye bir şey yok — nitekim ölçtüm, yok (aşağıda EXPLAIN'ler 2 ms). Bu yüzden aşağıdaki bulguların **hiçbiri "bugün fabrika duruyor" demiyor**; hepsi ya (a) bugün ÖLÇÜLEN bir anomaliyi, ya (b) büyüme ile deterministik patlayan bir mekanizmayı anlatır ve her birinde tetikleyici eşik yazılıdır.

**(0b) `pg_stat_user_tables` / `pg_stat_user_indexes` sayaçları prod kopyasında GEÇERSİZ.** `pg_stat_database.stats_reset` NULL ve veritabanı bir `pg_restore` kopyası: sayaçlar **restore anından itibaren** birikiyor, yani bugün orada gördüğüm `seq_scan`/`idx_scan` değerlerinin ezici çoğunluğu **bu denetimin kendi sorgularıdır**. Somut kanıt: `users` tablosunda `seq_scan=1106 / idx_scan=0` — canlı uygulama her istekte `users.findUnique(id)` yapar, yani gerçek trafikte `idx_scan` binlerce olmalıydı. **Sonuç: "kullanılmayan indeks" listesi bu kopyadan ÜRETİLEMEZ** ve bu raporda hiçbir indeks "kullanılmıyor, DROP et" diye önerilmemiştir (bkz. D-H-12).

**(0c) Gecikme telemetrisi `res.on("finish")` ile ölçer** (`src/middlewares/latency.middleware.ts:109`), yani rakam **sunucu süresi + gövdenin sokete yazılma süresini birlikte** taşır. Aşağıda bu ayrımı ölçümle kapattım (D-H-01), ama telemetrinin kendisi bunu ayıramıyor ve bu başlı başına bir bulgudur (D-H-13).

### 0d. Prod deploy zaman çizelgesi (ölçüldü — `_prisma_migrations.finished_at`)
Bu tablo D-H-01'in nedensellik iddiasının dayanağıdır:

| Deploy anı (prod) | Kapsam |
|---|---|
| 2026-08-15 10:53 | sapma defteri, `finalizedAt` trigger'ı, özellik değer tipi, istasyon yetenek bayrakları |
| **2026-08-17 16:16** | `fabrika_talep_2026_08_17` + `wo_cancel_trail` + `traveler_card_doc_versions` (commit'ler `43a3dca5`, `7abad3d9`, `42c5112d`, `628247a2`) |
| 2026-08-24 18:21 | arama katlaması, audit/requestId, sebep katalogları, plan-sapma, fason kısmi kabul, merge soy bağı (24 migration) |
| 2026-08-25 13:21 | renk adı partial UNIQUE |

---

## 1. BULGULAR

### [D-H-01] `GET /api/rolls` 2026-08-17 deploy'undan sonra her gün 5-10 sn'lik kuyruk üretiyor — 2.431 satırlık bir tabloda, ve telemetri NEDENİNİ söyleyemiyor

| Şiddet | S2 | Kategori | H (büyük tabloda tarama / tavansız `findMany` / ağır liste ucu) | Öncelik | P1 | Modül | CORE / envanter | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Fabrikanın en çok kullanılan iş ekranı olan Envanter listesi (`GET /api/rolls`), **2026-08-18'den itibaren her gün** 1-13 kez 5 saniyeyi, üç kez de 10 saniyeyi aşmış; tepe değer **10.439 ms**. 2026-08-13'ten önce bu ucun ölçülen en yüksek değeri 800 ms'ydi. Aynı dönemde başka hiçbir uçta böyle bir kuyruk yok. Veri büyümesi bunu açıklamıyor (top sayısı düzgün artıyor, sıçrama yok) ve **veritabanı tarafı ölçüldü: 2 ms**. Yani maliyet uygulama katmanında ya da bekleme kuyruğunda; hangisi olduğunu bugünkü telemetri **yapısal olarak söyleyemez**.

**Kanıt — canlı telemetri (`endpoint_latency_daily`, prod kopyası).** Günlük kova dağılımı (kova sınırları `src/services/latency-stats.service.ts:18-21`):

```
    gün     | istek | 1-2.5sn | 2.5-5sn | 5-10sn | 10-30sn | maxMs
------------+-------+---------+---------+--------+---------+-------
 2026-08-11 |   389 |       0 |       0 |      0 |       0 |   448
 2026-08-12 |   274 |       0 |       0 |      0 |       0 |   789
 2026-08-13 |   377 |       5 |       1 |      0 |       0 |  3124
 2026-08-17 |   811 |       3 |       0 |      0 |       0 |  1972   <-- deploy günü 16:16
 2026-08-18 |   343 |       3 |       0 |      3 |       0 |  8809
 2026-08-19 |   537 |       7 |       0 |      2 |       0 |  8363
 2026-08-20 |   287 |       8 |       0 |     13 |       3 | 10439
 2026-08-21 |   362 |       7 |       0 |      4 |       0 |  8328
 2026-08-22 |   225 |       5 |       0 |      1 |       0 |  8468
 2026-08-24 |   321 |      12 |       0 |      6 |       0 |  8178
```
Dönem toplamı: **7.314 istek · 33'ü 2,5 sn üstü · 32'si 5 sn üstü · 3'ü 10 sn üstü.** Karşılaştırma: aynı dönemde `GET /api/work-orders` 8.800 istekte 2 kez, `GET /health` 62.644 istekte 0 kez 5 sn'yi aştı.

**Kanıt — DB tarafı maliyet DEĞİL (ölçüldü).** Prod kopyasına karşı `EXPLAIN (ANALYZE, BUFFERS)`:
- düz liste sayfası (`WHERE status='STOCK' ORDER BY "updatedAt" DESC LIMIT 101`): **Execution 0,3 ms / Planning 1,0 ms**
- `ROLL_LIST_INCLUDE.dispatchItems` eşdeğeri (500 top × `NOT EXISTS` + `row_number() PARTITION BY`): **Execution 1,98 ms / Planning 8,1 ms**
- arama yolu (barkod tam eşleşme + 4 ilişki `EXISTS`, `LIMIT 101`): **Execution 2,05 ms / Planning 13,0 ms**

**Kanıt — yanıt gövdesi (ölçüldü, prod kopyası verisiyle).** `src/services/inventory.service.ts:1500` `include = ROLL_LIST_INCLUDE` (11 ilişki: `item, color, operations[], createdBy, createdMachine, entryStation, properties[], shipment, sack, currentStep, dispatchItems[]`, tanım `:423-511`), `:1508` cursor modunda tavan **500**:
```ts
// inventory.service.ts:1505-1509
// Tavan MAX_PAGE_SIZE (500) ile hizalı: "tümünü indir" (fetchAll) 500'lük
// sayfa ister → 30k kayıt 60 istekte iner ...
const limit = Math.min(Math.max(1, rawLimit), 500);
```
`ROLL_LIST_INCLUDE` şeklinin birebir SQL karşılığını kurup 500 satırlık bir sayfa ürettim:
`500 satır = 1.214.711 bayt ham JSON` · `ortalama 2.427 B/top` · `en büyük satır 3.335 B`.

**Kanıt — taşıma da, serileştirme de, sıkıştırma da DEĞİL (ölçüldü).**
- `app.ts:117` `compression({ threshold: 1024 })` açık → aynı gövdenin gzip'i **74.630 bayt (16,3× küçülme)**. Fabrika LAN'ında 73 KB'lık bir gövde 8 saniye sürmez.
- Node ölçümü (Apple M-serisi, 20 tekrar): `JSON.stringify` **2,7 ms**, `gzipSync(level 6)` **5,0 ms**.
Yani 1,2 MB'lık en büyük sayfanın CPU maliyeti ~8 ms; ölçülen 8.300 ms'nin **binde biri**.

**Kanıt — geriye kalan aday kümesi ve neden daraltılamıyor.** Sunucu tarafında kalan üç aday: (1) Prisma sorgu motorunun 11 ilişkili 500 satırlık sonuç kümesini birleştirmesi, (2) havuzdan bağlantı bekleme (`connectionTimeoutMillis: 5000`, `lib/prisma.ts:71` — soğuk connect bu bütçeyi de kapsar, ve canlıda tam bu mekanizmayla iki olay yaşandığı `prisma.ts:35-36`'da yazılı), (3) eşzamanlı bir CPU işinin event loop'u tutması. **Telemetri üçünü de ayıramaz**, çünkü yavaş-istek defteri (`latency-stats.service.ts:131`) yalnız `{at, method, route, status, ms}` tutar — sorgu dizesi, `limit`, yanıt boyutu, cihaz, DB süresi YOK; üstelik bellekte ve restart'ta silinir.
**İpucu (kanıt değil, yön):** beş ayrı günün tepe değerleri `8809 / 8363 / 8328 / 8468 / 8178` — **±%4 içinde kümelenmiş**. Değişken iş miktarı böyle kümelenmez; sabit bütçeli bir bileşen (bağlantı alma bütçesi, istemci yeniden denemesi, TCP retransmit) kümelenir. Kök nedeni bulan ilk adım bu kümelenmeyi açıklamaktır.

**failure_mode.** Vardiya içinde bir operatör Envanter'de "Tüm listeyi indir"e basar (`Electron/src/hooks/useDataTable.ts:208-233` `fetchAll` — `EXPORT_LIMIT = 500`, cursor sonuna kadar, `guard < 1000` sayfa): sunucu her sayfada 500 topu 11 ilişkiyle belleğe kurar. Bugünkü 2.431 topta bu 5 istek; 5 yıl sonraki ~111.000 topta **222 istek × 1,2 MB = ~270 MB**'lık nesne üretimi, tek process'te sırayla. Bugün bile bu ucun günde 3-13 isteği 5 saniyeyi aşıyor ve operatör "Envanter takıldı" diyor; **hangi tıklamanın takıldığı hiçbir kayıtta yazılı değil.**

**Veride fiili ihlal (K2).** Yukarıdaki tablo (`SELECT day, count, buckets, "maxMs" FROM endpoint_latency_daily WHERE "routeKey"='GET /api/rolls'`). Payload ölçümü: `audit` scratchpad'inde `payload.sql` ile üretilen 500 satırlık JSON = 1.214.711 B, gzip 74.630 B.

**İş etkisi.** Envanter listesi Ham Stok / Yarı Mamul / Bitmiş Depo / Çuvalda / Arşiv sekmelerinin tamamının veri kaynağıdır; sevk hazırlığı ve top arama buradan yapılır. 8-10 sn'lik donma, operatörün ekranı yenilemesine → ikinci isteğe → kuyruğun uzamasına yol açar. Ölçek 5 katına çıktığında bugün 3/gün olan olay 15-40/gün olur.

**Öneri (2. tur).**
1. **Ölçümü ayır (ÖNCE bu).** `latencyMiddleware`'e sunucu-tamamlanma anını ekle: `res.on("finish")` yanına `res.writeHead`/ilk bayt anını yaz ve `slowRing` girdisine `bytes` + `dbMs` (Prisma `$on('query')` toplamı) + normalize edilmiş sorgu dizesi (`limit`, `mode`, `withTotal`, filtre anahtarları — DEĞERLER değil) ekle. Bu, bulgunun kök nedenini bir vardiyada kapatır ve D-H-13'ü de kapatır.
2. **Liste yükünü ikiye ayır.** `ROLL_LIST_INCLUDE`'un `dispatchItems` + `properties` + `operations` dalları yalnız bazı sekmelerde çiziliyor; `?include=` benzeri bir daraltma ile ihracat yolunun bunları hiç istememesi payload'ı ~%40 küçültür.
3. **İhracat yolunu listeden ayır.** `fetchAll` için ayrı, ilişkisiz/düz bir uç (`GET /api/rolls/export`, `select` daraltılmış, satır başına ~400 B) — liste ucunun tavanı 200'e inebilir.
4. `[PROD'DA ÇALIŞTIRMA YOK]` — migration/veri dokunuşu gerekmiyor.

**Kabul kriteri.** (a) Yavaş-istek defteri bir 5 sn+ olayında `dbMs`, `bytes` ve sorgu şeklini gösteriyor; (b) aynı filtre/sayfa boyutuyla ölçülen p99, bir vardiya boyunca 2 sn altında; (c) `GET /api/rolls` günlük 5 sn+ kova sayacı 0.

**Efor.** 2 gün (1 gün ölçüm ayırma + 1 gün payload daraltma).

**Önceki defter.** Doğrudan eşleşen kayıt yok. `F-CORE-VER-005` (havuz 30/5 sn, `acik`) bu bulgunun (2) numaralı adayıyla kesişir — K12 satır 24.

---

### [D-H-02] `rolls` / `work_order_steps` / `roll_movements` güncellemelerinin %99,4'ü HOT değil — her top güncellemesi 24 indeksin tamamını yeniden yazıyor

| Şiddet | S2 | Kategori | H (indeks bakım maliyeti / şişme) | Öncelik | P2 | Modül | CORE / envanter | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `rolls` tablosunda **24 indeks** var ve indekslerin toplam boyutu tablonun kendisinden büyük (prod: 1.360 kB indeks / 1.288 kB veri). Daha önemlisi: indekslenen kolonlar (`status`, `currentQty`, `currentStepId`, `updatedAt`, `finalizedAt`) hemen her güncellemede değiştiği için PostgreSQL **HOT (heap-only tuple) güncellemesi yapamıyor** — yani her `UPDATE`, satırın yeni sürümünü **24 indeksin hepsine** yazıyor. Ölçüldü: dev veritabanında 121.994 top güncellemesinin yalnız **777'si (%0,64)** HOT.

**Kanıt — `pg_stat_user_tables` (dev, gerçek kullanım geçmişi var):**
```
         relname          | n_tup_upd | n_tup_hot_upd | hot_pct | indeks
--------------------------+-----------+---------------+---------+-------
 rolls                    |    121994 |           777 |    0.6% |   24
 work_order_steps         |     27700 |           171 |    0.6% |    6
 roll_movements           |     17128 |             0 |    0.0% |    8
 -- karşılaştırma (sağlıklı) --
 work_orders              |     35578 |         28066 |   78.9% |   11
 sacks                    |     14962 |         12305 |   82.2% |    7
 order_lines              |      3825 |          3739 |   97.8% |    7
 sessions                 |      2681 |          2621 |   97.8% |    3
```
**Kanıt — sonuç şişme (dev, ölçüldü):** `rolls` **296 satır**, veri 944 kB, **indeksler 5.000 kB** (5,3×). Tek tek: `rolls_barcode_key` 864 kB (satır başına ~3 kB!), `rolls_status_itemId_colorId_width_idx` 808 kB, `rolls_status_currentQty_idx` 448 kB. `VACUUM` bu sayfaları yeniden kullanılabilir yapar ama **B-tree'yi küçültmez** (yalnız `REINDEX` küçültür) ve hiçbir tabloda `fillfactor`/autovacuum ayarı yok (`pg_class.reloptions` prod'da **tamamen boş**).

**Kanıt — mekanizma (kod + şema):** `rolls_status_updatedAt_idx (status, "updatedAt")` — `updatedAt` Prisma tarafından **her** güncellemede yazılır, yani HOT koşulu ("değişen kolonların hiçbiri indekste olmayacak") **hiçbir zaman** sağlanamaz. Bu indeks bilinçli eklenmiştir (kök `CLAUDE.md` 2026-07-30 kararı: envanter sekmeleri `updatedAt desc` sıralar, migration `20260730170000`, ölçüm 205 ms → 21 ms) — **bulgu indeksin varlığı değil, yazma tarafının hiç ölçülmemiş olmasıdır.** Ek olarak `rolls_stamp_production_timestamps` trigger'ı (satır bazlı) statü değişiminde `statusChangedAt` + `finalizedAt` yazar; `finalizedAt` de indekslidir.

**failure_mode.** Bir vardiyada 200 top KK1 → Kurşun → Tambur → Depo yolunu geçer; her top yol boyunca ~8-12 `UPDATE` alır (statü, `currentStepId`, `currentQty`, etiket damgası, not). 200 × 10 = 2.000 güncelleme, her biri 24 indeks girdisi = **48.000 indeks yazımı/gün**. Tablo 100.000 satıra çıktığında (5 yıl) aynı yük ölü satır + indeks şişmesi olarak birikir; `autovacuum` her turda 24 indeksi baştan sona taramak zorunda kalır ve vardiya içinde I/O dalgası üretir. Somut son nokta: bugün dev'de 296 satırlık tabloda barkod indeksi 864 kB; aynı oran 100.000 satırda REINDEX gerektiren bir yapıya döner ve `REINDEX` (CONCURRENTLY olmadan) tabloyu **kilitler**.

**Veride fiili ihlal (K2).** Yukarıdaki `n_tup_hot_upd` oranları (dev). **Prod'da ölçülemedi** — kopyada sayaçlar restore ile sıfırlandı (§0b); prod'daki güncelleme hacmi için vekil ölçüm: `system_logs` içinde `tableName='ROLL' AND action='UPDATE'` = **2.026 satır / 40 gün ≈ 50/gün** (audit yalnız iş düzeyi CUD'u sayar; gerçek `UPDATE` sayısı bundan yüksek). Yani prod'da şişme **bugün yavaş birikiyor** — dev'in 5,3× oranı test koşucusunun (366 bekçi scripti) ürettiği yapay churn'dür ve prod'a birebir taşınmaz. Taşınan şey **HOT oranıdır** (yapısal, veri hacminden bağımsız).

**İş etkisi.** Bugün görünmez. Etkisi 2-3 yıl içinde: gece yedeğinin (pg_dump) uzaması, autovacuum'un vardiya içine taşması, top listesinin indeks şişmesi yüzünden yavaşlaması.

**Öneri (2. tur).**
1. **ÖNCE ÖLÇ, sonra sil.** `rolls` üzerindeki 24 indeksin hangisinin işe yaradığı **yalnız canlı sunucuda** ölçülebilir: bir vardiya sonunda `SELECT indexrelname, idx_scan FROM pg_stat_user_indexes WHERE relname='rolls'` (salt-okunur). §0b yüzünden bu kararı prod kopyasından VERME.
2. Ölçüm sonrası aday birleştirme: `status` ön ekli dört ayrı composite (`status_createdAt`, `status_updatedAt`, `status_currentQty`, `status_itemId_colorId_width`) `index-health.sql` §4'ün "önek-yutulan" listesinde zaten yan yana çıkıyor; ikisi düşerse yazma maliyeti %8 azalır.
3. `ALTER TABLE rolls SET (autovacuum_vacuum_scale_factor = 0.05)` — şişmeyi erken toplasın. `[PROD'DA ÇALIŞTIRMA — vardiya dışı, geri alma: aynı komutla varsayılana (0.2) dön]`.
4. `fillfactor` düşürmek bu tabloda **işe yaramaz** (HOT'u engelleyen sayfa doluluğu değil, indekslenmiş kolonların değişmesidir) — önerme.

**Kabul kriteri.** Canlıda bir vardiya sonunda `idx_scan=0` çıkan indeksler belgelenmiş; en az iki indeks düşürülmüş ve `n_tup_hot_upd` oranının değişmediği (değişmemesi beklenir) + indeks toplam boyutunun düştüğü ölçülmüş.

**Efor.** 0,5 gün ölçüm + 0,5 gün migration.

**Önceki defter.** `Teks-Erp/scripts/index-health.sql` bu analiz için yazılmış ama §5'ten sonrası koşmuyor (bkz. D-H-08).

---

### [D-H-03] Sevk raporu, indekssiz bir kolon üzerinde doğrudan-sevk başına İKİ korelasyonlu alt sorgu koşuyor — özellik canlıda hiç kullanılmadığı için maliyet bugüne dek sıfır

| Şiddet | S2 | Kategori | H (indekssiz filtre + korelasyonlu alt sorgu) | Öncelik | P2 | Modül | Raporlar / sevkiyat | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** "Dönemde sevk edilen metraj"ın TEK KAYNAĞI olan `reports/_shipped.ts`, doğrudan sevkler (DirectShipment) için bir mutabakat satırı üretiyor ve bunu yaparken **aynı korelasyonlu alt sorguyu hem `SELECT` hem `WHERE` içinde iki kez** koşuyor. Alt sorgu `rolls."directShipmentId"` üzerinde filtreliyor — ve bu kolonun **indeksi YOK** (FK var, indeks yok). Yani rapor, dönemdeki her doğrudan sevk için `rolls` tablosunu iki kez tam tarayacak.

**Kanıt — kod (`Teks-Erp/src/services/reports/_shipped.ts:85-100`):**
```sql
-- 3b) MUTABAKAT SATIRI ...
SELECT ds."customerId", NULL::uuid, NULL::uuid, 0::int,
       ds."totalQty" - COALESCE((
         SELECT SUM(r2."currentQty") FROM rolls r2 WHERE r2."directShipmentId" = ds.id
       ), 0)
FROM direct_shipments ds
WHERE ds."shippedAt" >= $1 AND ds."shippedAt" <= $2
  AND ds."totalQty" <> COALESCE((
        SELECT SUM(r2."currentQty") FROM rolls r2 WHERE r2."directShipmentId" = ds.id
      ), 0)
```
**Kanıt — indeks yok (prod kopyası, `pg_constraint` × `pg_indexes` karşılaştırması):**
```
 tbl   | conname                        | cols                | rows
-------+--------------------------------+---------------------+------
 rolls | rolls_directShipmentId_fkey    | {directShipmentId}  | 2431
```
`rolls` üzerindeki 24 indeksin hiçbiri `directShipmentId` ile başlamıyor (`pg_indexes` tam listesi kontrol edildi). Aynı sorgunun 3a dalı da (`JOIN rolls r ON r."directShipmentId" = ds.id`) indekssiz.

**Kanıt — bugün maliyet SIFIR:** prod kopyasında `direct_shipments` = **0 satır**. Özellik (fasondan doğrudan müşteriye sevk) kodda tam, sahada hiç kullanılmamış. `_shipped.ts` `collectShipped`'i çağıran raporlar da canlıda 2-6 kez çağrılmış (`GET /api/reports/sales/shipment-scorecard` 2 istek, `.../order-fulfillment` 6 istek).

**failure_mode.** Fabrika doğrudan sevki kullanmaya başlar (ayda 50 doğrudan sevk) ve `rolls` 5 yılda ~111.000 satıra çıkar. Muhasebeci "Sevkiyat Karnesi"ni açar (aralık 30 gün): `50 × 2 = 100 tam `rolls` taraması × 111.000 satır = 11,1 milyon satır okuması`. Prod'da `statement_timeout = 50 sn`; bu sınır aşıldığında sorgu **iptal edilir** ve rapor ekranı hata verir — üstelik hata mesajı "57014 statement canceled" jenerik 500'e düşer (bkz. sınır ötesi not I). Aynı `collectShipped` İade Karnesi'nin paydasıdır (`shippedGrossTotal`), yani iki rapor birden kırılır.

**Veride fiili ihlal (K2).** Arandı, **0** — `direct_shipments` boş olduğu için ihlal fiilen doğamaz. Bu yüzden bulgu **K1** (kod + şema + indeks yokluğu teyit edildi; ihlal latent).

**İş etkisi.** Muhasebe ve satış karneleri, doğrudan sevk kullanılmaya başlandıktan sonra sessizce yavaşlar, sonra 50 sn'de kesilir. Kesilme raporun "0 metraj" göstermesiyle DEĞİL 500 ile biter (bu, doğru yönde bir davranış), ama sebep hiçbir yerde okunmaz.

**Öneri (2. tur).**
1. `CREATE INDEX CONCURRENTLY "rolls_directShipmentId_idx" ON rolls ("directShipmentId") WHERE "directShipmentId" IS NOT NULL;` — partial, çünkü prod'da kolonun %100'ü NULL (`rolls` null oranı ölçüldü: `shipmentId` %71,2, `sackId` %71,2 — `directShipmentId` bugün %100). `[PROD'DA ÇALIŞTIRMA — vardiya dışı; geri alma: `DROP INDEX CONCURRENTLY`]`.
2. Alt sorguyu **tek kez** hesapla: `LEFT JOIN LATERAL (SELECT SUM(...) ...) s ON true` ya da bir `WITH ds_rolls AS (SELECT "directShipmentId", SUM("currentQty") q FROM rolls WHERE "directShipmentId" IS NOT NULL GROUP BY 1)` CTE'si + join. Sonuç birebir aynı, tarama sayısı 2N → 1.
3. Aynı düzeltmeyi 3a dalına da uygula (join zaten indeksle ucuzlar).

**Kabul kriteri.** 100 sentetik doğrudan sevk + 50.000 top ile `EXPLAIN ANALYZE`: `Seq Scan on rolls` **yok**, `loops` 100 değil 1; `collectShipped` süresi 30 günlük aralıkta < 200 ms.

**Efor.** 0,5 gün.

**Önceki defter.** `SINIR-OTESI-YONLENDIRME.md` K7b satırı ("`_shipped` direkt sevk başına 2 korelasyonlu alt sorgu") bu bulguyu D-H'ye yönlendirmiş — burada indeks yokluğu ölçümüyle kapatıldı.

---

### [D-H-04] Barkod sayacı + parti no kilidi, sistem geneli serileşme noktası olarak uzun transaction'ların İÇİNDE tutuluyor — 2026-08-10'da yalnız BİR çağrı yeri düzeltildi, bekçi kalanların döngüde olduğunu göremiyor

| Şiddet | S3 | Kategori | H (sıcak satır / kilit kuyruğu) | Öncelik | P3 | Modül | Üretim / fason / envanter | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Top barkodu `roll_barcode_counters` satırındaki `ON CONFLICT DO UPDATE n = n + $1` ile üretilir; bu **satır kilidini alır ve transaction COMMIT edene kadar bırakmaz**. Helper'ın kendi sözleşmesi bunu büyük harflerle yazıyor ve ölçüm veriyor (`1345 ms` → `39 ms`, 34 kat). 2026-08-10 denetiminde Tambur yolu tx dışına taşındı; **kalan 7 çağrı yeri hâlâ tx içinde** ve bunlardan biri **döngü içinde**, üstelik bekçinin muaf listesi o satır için "döngüsüzdür" diye yanlış bir gerekçe yazıyor. Ayrıca parti no kilidi (`pg_advisory_xact_lock(8022, 1)`) **anahtarsız, sistem genelidir** ve en uzun tx'lerin ikisinde alınıyor.

**Kanıt — sözleşme (`src/services/helpers/roll-barcode.helper.ts:52-67`):**
```
⚠️ BU FONKSİYON TX DIŞINDA, tx AÇILMADAN ÖNCE ÇAĞRILMAK İÇİNDİR. Sayaç
satırının kilidi, artışı yapan transaction COMMIT edene kadar tutulur; ...
  sayaç tx İÇİNDE          → paralel istek 1345 ms bekliyor
  sayaç tx AÇILMADAN ÖNCE  → 39 ms (34 kat)
```
**Kanıt — kalan tx-içi çağrı yerleri (grep, 7 adet):** `inventory.service.ts:905` (KK1 ham giriş), `:4439` (kurtarma), `subcontractor.service.ts:517` (fason çıkış çocuğu), `:3046` (fason kabul, toplu), `workorder-batch-drop.service.ts:418`, `helpers/roll-finalize.helper.ts:172`, `helpers/roll-disposition.helper.ts:296`.

**Kanıt — BEKÇİNİN KÖR NOKTASI (yeni).** `scripts/test_barcode_reservation.ts:71-75`:
```ts
const KNOWN_TX_INTERNAL_SINGULAR: Record<string, number> = {
  "services/inventory.service.ts": 2, // KK1 tek top · 3954 tek top — ikisi de döngüsüz
  "services/subcontractor.service.ts": 1, // fason çıkış: sevk başına tek çocuk
};
```
ve hemen üstünde: *"Aşağıdaki iki dosyada tekil çağrı **döngüsüzdür** (tek top üretilir), o yüzden meşru."* **Bu iddia `subcontractor.service.ts` için YANLIŞ.** `generateRollBarcode(tx, "H")` `createFasonShipChild` içindedir (`subcontractor.service.ts:517`), o fonksiyonun tek çağrı yeri `:636`'dır ve **bir `for` döngüsünün gövdesindedir**:
```ts
// subcontractor.service.ts:627-637  (applyDirectShipSplits)
for (const rid of shipRollIds) {
  ...
  effective.push(await createFasonShipChild(tx, roll, q, stepId, userId, stepStationId));
}
```
Bekçi **çağrı YERİ sayar**, çağrı yerinin bir döngünün içinde olup olmadığını ölçmez — yani tam olarak korumak istediği şeye kördür (dosya başına 1 çağrı yeri var, ama çalışma zamanında N tur atıyor).

**Kanıt — parti no kilidi anahtarsız (`src/services/batch.service.ts:126`):**
```ts
await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BATCH_NUMBER_LOCK_NS}::int, ${BATCH_NUMBER_LOCK_KEY}::int)`;
```
`BATCH_NUMBER_LOCK_KEY` sabittir → **fabrikadaki tüm parti üretimi tek kuyruk**. `createBatchTx` çağrı yerleri arasında `subcontractor.service.ts:1140` ve `:1231` var; ikisi de `:1036`'daki fason sevk transaction'ının içinde ve o tx repodaki **en büyük ikinci tx** (12 doğrudan `await tx.*` + 9 tx-helper + 2 döngü, 264 satır).

**Kanıt — en büyük transaction'lar (mekanik sayım, 119 interaktif tx):**
```
skor  dosya:satır                              awaitTx  döngü  txHelper  satır
  22  tambur.service.ts:925                         16      3         6    360
  21  subcontractor.service.ts:1036                 12      2         9    264
  18  batch.service.ts:580                          15      5         3    247
  15  tambur.service.ts:3180                         9      0         6    214
```

**failure_mode.** Fasona sevk yapılırken (5 topun 3'ü kısmi metrajla bölünüyor): tx `createFasonShipChild`'ı 3 kez çağırır, ilk çağrıda `roll_barcode_counters` "H" satırının kilidi alınır ve **transaction'ın kalan ~20 ifadesi + parti üretimi + adım/WO güncellemeleri boyunca tutulur**. O sürede KK1 tabletinden ham top giren operatör (`inventory.service.ts:905`, aynı "H" satırı) kuyruğa girer; ekranda "kaydediliyor" döner. 2026-08-10 ölçümüne göre bu bekleme **saniye mertebesine** çıkabilir. Aynı anda Tambur'da kesim yapan operatör de parti no üretiyorsa (`8022` kilidi) o da bekler.

**Bugünkü olasılık — ölçüldü ve DÜŞÜK.** Prod'da: iş emri başına ortalama **5,1 top** (maks 22), fason sevk başına ortalama **4,3 kalem** (maks 21), 40 günde **195 fason sevk** (≈5/gün) ve **198 parti** (≈5/gün). Yani çakışma penceresi günde birkaç kez, saniyeler mertebesinde açılıyor ve tabletlerin aynı saniyeye denk gelme olasılığı düşük. **Bu yüzden S2 değil S3.** Şiddet artışının tetikleyicisi: parti/sevk büyüklüğünün 20'den 100'e çıkması ya da toplu kapanış dispozisyonu (`roll-disposition.helper.ts:296` — bir iş emrinin TÜM işlemdeki toplarına barkod üretir, ardından **top başına ayrı `tx.roll.update`** koşar, `:297-299`).

**Veride fiili ihlal (K2).** Arandı: prod'da havuz/kilit kaynaklı 500/503 kaydı **0** (`system_logs` içinde `POOL_TIMEOUT` prod kopyasında 0 — K12 satır 24 ile uyumlu). Yani bugüne dek kuyruk hissedilmemiş.

**İş etkisi.** Bugün: fark edilmez. Yarın (parti boyutu büyüdüğünde): KK1 ham giriş ekranı fason sevk yapılırken saniyelerce takılır ve operatör tuşa tekrar basar — 2026-08-03'te yaşanan mükerrer-top vakasının tetikleyicisi tam olarak buydu.

**Öneri (2. tur).**
1. **Bekçiyi düzelt (en ucuz, en değerli adım).** `test_barcode_reservation.ts`'e "çağrı yeri bir `for`/`while`/`.map` gövdesinde mi" kontrolü ekle (AST ya da metin tabanlı blok analizi). Bugünkü muaf-liste yorumu **kodun tersini söylüyor**; en azından yorumu düzelt.
2. `createFasonShipChild`'ın barkodunu döngüden çıkar: bölünecek top sayısı döngüden ÖNCE bilinir (`shipRollIds` + `rollShipQtys`) → `reserveRollBarcodes(tx, "H", n)` tek ifade (roll-finalize'da uygulanan desenin aynısı).
3. `roll-disposition.helper.ts:297-299`'daki top-başına `tx.roll.update` döngüsünü `updateMany`/`CASE`'e çevir — kilit süresi N round-trip'ten 1'e iner.
4. Parti no kilidini **günlük anahtara** shard'la (`hashtext(gün)`) — kısa rejimde sayaç zaten "en son kısa parti"den türüyor, gün bazlı kilit yeterlidir. `[Şema/migration YOK]`.

**Kabul kriteri.** Bekçi, `createFasonShipChild`'ı döngüden çıkarmadan **kırmızı** veriyor (negatif sonda). Ölçüm: 30 paralel KK1 girişi + eşzamanlı bir fason sevk → KK1 p95 < 100 ms **ve** havuz 30/30 sağlıklı (2026-08-10'un iki koşullu kabul kriteri korunur).

**Efor.** 1 gün.

**Önceki defter.** `F-CORE-VER-001` (K12 satır 20) — "KAPANMIŞ" damgalı; kalan 7 tx-içi çağrı yeri orada zaten listelenmiş. **Bu bulgu onu yeniden AÇMIYOR**; yeni kanıt bekçinin döngü körlüğü + parti kilidinin anahtarsızlığı + prod parti/sevk boyutu ölçümüdür. `F-IST-ESZ-001` (K12 satır 30) aynı kök nedenin Tambur ayağı, kapanmış.

---

### [D-H-05] Rapor katmanının tarih ekseni `orders` üzerinde indekssiz — yedi rapor sorgusu `orderDate`/`completedAt` ile filtreliyor, ikisinin de indeksi yok

| Şiddet | S3 | Kategori | H (indekssiz filtre) | Öncelik | P3 | Modül | Raporlar / sipariş | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Sipariş raporlarının tamamı `orders."orderDate"` (bazıları `orders."completedAt"`) tarih aralığıyla filtreliyor. `orders` tablosunda 9 indeks var ama **hiçbiri bu iki kolonu içermiyor** — her rapor sorgusu tam tarama yapıyor. Bugün 278 sipariş var, yani 80 kB; 5 yılda ~12.500 siparişte her rapor açılışı 4 MB'lık tarama.

**Kanıt — indeks listesi (prod kopyası, `pg_indexes` `orders`):** `pkey`, `branchId`, `clientToken` (partial), `customerId`, `deadline`, `manualClosedById`, `orderNumber` (unique), `orderNumber_trgm`, `status_createdAt`. **`orderDate` yok, `completedAt` yok, `cancelledAt` yok.**

**Kanıt — filtreleyen yerler (grep, 7 sorgu / 6 dosya):**
```
reports/order-cancellation.report.service.ts:146   orderDate: { gte, lte }   (count)
reports/order-cancellation.report.service.ts:238   orderDate: { gte, lte }   (findMany)
reports/order-intake.report.service.ts:113         orderDate: { gte, lte }
reports/order-intake.report.service.ts:181         o."orderDate" >= $1 ...   (raw)
reports/demand-analysis.report.service.ts:107      orderDate: { gte, lte }
reports/customer-scorecard.report.service.ts:121   orderDate: { gte, lte }
reports/order-leadtime.report.service.ts:175       o."orderDate" >= $1 ...   (raw)
reports/shipment-scorecard.report.service.ts:113   o."completedAt" >= $1 ...  (raw)
```
**Kanıt — fiilen seq scan (prod kopyası, `EXPLAIN ANALYZE`):**
```
Aggregate  (actual time=0.092..0.092 rows=1)
  ->  Seq Scan on orders  (actual time=0.007..0.080 rows=219)
        Filter: ("orderDate" >= (now() - '30 days'))
        Rows Removed by Filter: 59
```

**failure_mode.** Satış müdürü "Sipariş Alımı" karnesini 12 aylık aralıkla açar. 5 yıl sonra `orders` 12.500 satır: her açılışta tam tarama + `order_lines` (≈ 4 satır/sipariş = 50.000) ile join. Tek başına ölümcül değil ama aynı ekranda 4-6 rapor kartı yan yana çalıştığı için (her biri kendi `count` + `findMany` + raw sorgusuyla) toplam maliyet çarpılır. Kritik hâle geldiği eşik: 366 günlük aralık × 12.500 sipariş × 6 rapor.

**Veride fiili ihlal (K2).** Seq scan planı yukarıda (prod kopyası). Rapor uçlarının canlı kullanım sayısı **çok düşük** (`GET /api/reports/...` uçları toplamda 2-6 istek/40 gün) — yani sorun bugün hissedilmiyor çünkü **raporlar neredeyse hiç açılmıyor**.

**İş etkisi.** Bugün yok. Raporlar sahaya benimsendiğinde (paket 2026-08-09'da geldi, henüz kullanılmıyor) ilk fark edilen yavaşlık burası olur.

**Öneri (2. tur).**
`CREATE INDEX CONCURRENTLY "orders_orderDate_idx" ON orders ("orderDate");`
`CREATE INDEX CONCURRENTLY "orders_completedAt_idx" ON orders ("completedAt") WHERE "completedAt" IS NOT NULL;`
`[PROD'DA ÇALIŞTIRMA — vardiya dışı; geri alma: `DROP INDEX CONCURRENTLY`]`. ⚠️ Repoda **hiçbir migration `CREATE INDEX CONCURRENTLY` kullanmıyor** (K2b: 0/621) ve hiçbirinde `lock_timeout` yok — bu iki indeks o alışkanlığın kırılması için iyi bir başlangıç (bkz. sınır ötesi J).

**Kabul kriteri.** `EXPLAIN ANALYZE` yukarıdaki sorguda `Index Scan`; 12 aylık aralıkta `order-intake` raporu < 300 ms.

**Efor.** 0,5 gün.

**Önceki defter.** `SINIR-OTESI-YONLENDIRME.md` K7b: "`orders.orderDate/completedAt/cancelledAt` index yok" — bu bulgu onun ölçümle kapatılmış hâlidir.

---

### [D-H-06] `system_log_archives` sonsuza kadar büyüyor (hiçbir şey silmiyor) ve arşivleme yolu ne dev'de ne prod'da BİR KEZ bile gerçek satır taşımadı

| Şiddet | S3 | Kategori | H (sınırsız büyüyen tablo / arşiv stratejisi) | Öncelik | P3 | Modül | OPS / audit | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Audit arşivleyici doğru kurgulanmış: 6 aydan eski `system_logs` satırlarını 5.000'lik parti hâlinde `system_log_archives`'e **taşır** (silmez), ayda bir koşar, watchdog'u ve hata raporlaması var. İki boşluk var: (1) **arşiv tablosunun kendisinde saklama/bölümleme YOK** — oraya giren satır sonsuza dek kalır; (2) taşıma yolu **bugüne kadar hiç çalışmadı**, çünkü sistem 2026-07-16'da canlıya geçti ve 6 aydan eski satır henüz yok. İlk gerçek koşum ~2027-01-16'da olacak ve **hiç denenmemiş bir kod yolu** o gün ilk kez gerçek hacimle karşılaşacak.

**Kanıt — mekanizma.** `src/jobs/archive-scheduler.ts:21-25`: `MONTHS_TO_KEEP = 6`, `INTERVAL_DAYS = 30`, `CHECK_INTERVAL_MS = 24 sa`, `MAX_BATCHES_PER_RUN = 200`. `src/services/audit.service.ts:15` `ARCHIVE_BATCH_SIZE = 5000`; `:204-265` `archiveOlderThan` — tek tx içinde `SET LOCAL teks.audit_purge='on'` → `createMany(5000)` → `deleteMany(id IN (5000))`. Global tx bütçesi **20 sn** (`lib/prisma.ts:91`).

**Kanıt — arşivde saklama yok.** `grep -rn "systemLogArchive" src` → yalnız `createMany` (audit.service.ts:235) ve okuma; **hiçbir yerde `delete`/`deleteMany` yok.** Tablo üzerinde `system_log_archives_block_tamper` trigger'ı DELETE'i zaten engelliyor (statement-level).

**Kanıt — hiç koşmadı (K2, iki veritabanında da):**
```
prod kopyası: SELECT count(*) FROM system_log_archives  →  0
dev         : SELECT count(*) FROM system_log_archives  →  0
prod: system_settings['audit.lastArchiveAt'] = "2026-08-16T07:55:53.203Z"   ← zamanlayıcı KOŞTU
prod: SELECT min("createdAt") FROM system_logs → 2026-07-16 12:50           ← ama 6 aydan eski satır YOK
```
Yani zamanlayıcı sağlıklı çalışıyor ve 0 satır arşivliyor; **`createMany`/`deleteMany` dalı hiç girilmedi.**

**Kanıt — büyüme ölçümü (prod).**
```
haftalık system_logs üretimi:  548 / 510 / 249 / 1658 / 2200 / 4541 / 779(kısmi hafta)
son tam hafta (08-17..08-23) = 4.541 satır  →  ~649 satır/gün
satır başına: 421 B (heap ort.) · 634 B (indekslerle) · p99 734 B · maks 5.817 B
JSON kolonları: changes ort 23 B, oldData ort 26 B / maks 2.712 B, newData ort 260 B / maks 2.916 B
```
**5 yıl projeksiyonu (649/gün sabit kabul):**
| Tablo | 5 yıl sonunda | Boyut | Kim siliyor |
|---|---|---|---|
| `system_logs` (6 ay saklama + 30 gün arşiv aralığı → ~7 ay durağan hâl) | ~138.000 satır | ~88 MB | arşivleyici |
| `system_log_archives` | ~1.185.000 satır | **~750 MB** | **HİÇ KİMSE** |
| tüm DB (bugün 33 MB / 40 gün, doğrusal) | — | ~1,5 GB | — |

**failure_mode.** İki ayrı arıza:
- **(a) 2027-01-16 civarı, ilk gerçek arşiv koşumu.** ~20.000 satır taşınacak = 4 parti. Her parti tek tx içinde 5.000 satırlık `createMany` (JSONB dahil ~3,5 MB) + 5.000 elemanlı `IN` listesiyle `deleteMany`. Windows üzerindeki PG 16'da bu 20 sn tx bütçesini aşarsa tx geri sarılır, `reportJobFailure` bir `JOB_FAILED` satırı yazar ve iş **24 saat sonra aynı şekilde tekrar düşer** — sonsuza dek. Kimse bakmazsa `system_logs` büyümeye devam eder ve arıza yalnız `SystemLog` içinde bir satır olarak durur.
- **(b) 5. yıl.** `system_log_archives` 750 MB'a çıkar, gece `pg_dump`'ı ve off-site kopyayı o kadar büyütür; hiçbir saklama politikası onu küçültmez. ISO 27001 A.8.15 gereği log saklanmalı — ama **saklama süresi sonsuz değildir**; politika yazılı olmadığı için tablo "silinemez" muamelesi görüyor.

**Veride fiili ihlal (K2).** Yukarıdaki iki `count(*) = 0` ve `audit.lastArchiveAt` damgası.

**İş etkisi.** Bugün yok. 2027 başında sessiz bir zamanlayıcı arızası riski; 5 yılda yedek boyutu.

**Öneri (2. tur).**
1. **İlk koşumu simüle et (bugün yapılabilir, prod'a dokunmadan).** Dev'de 20.000 sentetik eski log üret → `archiveOlderThan`'ı koştur → tx süresini ölç. 20 sn'ye yaklaşıyorsa `ARCHIVE_BATCH_SIZE`'ı 5.000'den 1.000'e indir (`MAX_BATCHES_PER_RUN=200` × 1.000 = 200.000/koşum, hâlâ fazlasıyla yeterli).
2. **Arşiv tablosuna saklama politikası yaz.** Ya (a) `ARCHIVE_MONTHS_TO_KEEP` (ör. 60 ay) + aynı batch mekanizmasıyla gerçek `DELETE` (trigger muafiyeti `SET LOCAL teks.audit_purge` zaten var), ya (b) yıllık `PARTITION BY RANGE ("createdAt")` + eski bölümü `DETACH` + dosyaya dök. Karar iş kararıdır (mevzuat saklama süresi) — kod tarafı hazır, eksik olan **politika ve onu uygulayan tek satır**.
3. `MAX_BATCHES_PER_RUN` tükendiğinde (200 parti dolduğunda) iş sessizce biter ve kalan satırlar 30 gün bekler — bu davranışı log'a yaz.

**Kabul kriteri.** Dev'de 20.000 satırlık ilk-koşum simülasyonu tx bütçesinin **yarısının altında** tamamlanıyor; `system_log_archives` için bir saklama kararı `docs/`'ta yazılı ve kodda uygulanmış.

**Efor.** 1 gün (simülasyon + parti boyutu) + politika kararı sonrası 0,5 gün.

**Önceki defter.** `SINIR-OTESI-YONLENDIRME.md` K8 (I bölümü): "`system_log_archives` 0 satır" ve J bölümü H-3: "arşiv purge yolu canlıda hiç koşmadı (`SET LOCAL` aynı oturumda mı; 1M+ satır senaryosu)". Bu bulgu ikisini ölçümle birleştirir.

---

### [D-H-07] Manuel kodla ürün kaydeden her istek, `items` tablosunun TAMAMINI iki kez belleğe alıyor — ikincisi advisory kilit altında, transaction içinde

| Şiddet | S3 | Kategori | H (tavansız `findMany` / yazma yolunda O(n) tarama) | Öncelik | P3 | Modül | Master data | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Ürün (kumaş) oluşturma/güncelleme, manuel kod verildiğinde harf-duyarsız çakışma taraması yapıyor ve bunu **`WHERE` olmadan** `findMany` ile, yani tüm tabloyu JS'e çekerek yapıyor. Aynı tarama iki kez koşuyor: bir kez tx dışında (ucuz 409 için), bir kez tx içinde advisory kilidin ardından (nihai karar). Bugün 228 ürün var; ürün sayısı bir tekstil ERP'sinde binlere çıkar.

**Kanıt (`src/services/item.service.ts`):**
```ts
:180-183   existing = manualCode
             ? resolveReactivateTarget(manualCode,
                 await prisma.item.findMany({ select: ITEM_CODE_CANDIDATE_SELECT }))   // TÜM TABLO (tx dışı)
             : null;
:238-241   await lockCodeScopeTx(tx, ITEM_CODE_LOCK_SCOPE, manualCode);
           target = resolveReactivateTarget(manualCode,
                 await tx.item.findMany({ select: ITEM_CODE_CANDIDATE_SELECT }));      // TÜM TABLO (tx içi, kilit altında)
```
Aynı desen `label-template.service.ts` `findAvailableName` yolunda da var (tüm şablon adları).

**Kanıt — neden `WHERE` yok (gerekçe geçerli ama çözüm eksik).** Karşılaştırma **katlanmış** (`foldCodeForCompare`, Türkçe i-ailesi ASCII'ye) yapılıyor ve `items` üzerinde bu ifadeye karşılık gelen bir DB indeksi yok — `items_code_key` yalnız tam eşleşmeyi kapatıyor, katlanmış tekillikte DB'de karşılık **bilinçli olarak** yok (9 tarihsel satır seddi patlatırdı, `item.service.ts:232-236`). Yani tarama bir çare değil, bir **çaresizlik**tir; ve çaresizliğin bedeli hiçbir yerde ölçülmemiş.

**failure_mode.** Fabrika 5 yılda 4.000 kumaş kodu tanımlar. Bir kullanıcı elle kod girerek ürün kaydeder: sunucu 4.000 satırı (kod + id + isActive + ad) iki kez JS'e çeker (~600 KB), ikincisini `pg_advisory_xact_lock(code-unique-ns, hashtext(scope|kod))` altında yapar. Aynı kodu iki kişi aynı anda kaydetmeye çalışırsa ikincisi birincinin tüm taramasını bekler. Kayıt ekranı "kaydediliyor"da saniyelerce kalır. Fark edilme eşiği ≈ 5.000 satır (~1 MB × 2). **İçe aktarım (17 adaptör, Excel'den toplu ürün yükleme) bu yolu satır başına bir kez çağırırsa** 1.000 satırlık bir Excel = 1.000 × 2 tam tarama = 2 milyar satır okuması — burası gerçek patlama noktasıdır (import yolunun bu fonksiyonu çağırıp çağırmadığı bu turda doğrulanmadı, bkz. Kapsanmayan).

**Veride fiili ihlal (K2).** Arandı: prod `items` = **228 satır** (ölçüldü) → bugün tarama 228 satır, ~50 KB, ölçülemeyecek kadar ucuz. İhlal latent → **K1**.

**İş etkisi.** Bugün yok. Ürün kataloğu büyüdükçe ve toplu içe aktarım kullanıldıkça ürün kaydetme ekranı yavaşlar.

**Öneri (2. tur).**
1. `items`'a katlanmış kod için **ifade indeksi** ekle — renk tarafındaki `colors_nameFoldColor_key`/`tr_fold_color(name)` deseninin birebir ikizi (`code-format.foldCodeForCompare`'in SQL karşılığı zaten yazılabilir; `test_fold_contract.ts` JS≡SQL sözleşmesini kilitleyen bekçi mevcut). `[PROD'DA ÇALIŞTIRMA — index, UNIQUE DEĞİL: tarihsel 9 satır seddi patlatmasın]`.
2. Taramayı `WHERE fold(code) = fold($1)` ile tek satıra indir. Kilit altında kalan iş 1 satır okuması olur.
3. Aynı düzeltmeyi `label-template.findAvailableName` için de yap (aynı desen).

**Kabul kriteri.** 5.000 sentetik ürünle: manuel kodla ürün oluşturma p95 < 100 ms; `EXPLAIN` `Index Scan`; mevcut `test_master_data_name_dup` ve kod-tekillik bekçileri yeşil.

**Efor.** 1 gün.

**Önceki defter.** `F-CORE-VER-006` (K12 satır 25) **KAPANMIŞ** — ama o, `base.service`'teki **ad**-mükerrer taramasıydı ve `findFirst` + `nameFold` btree ile düzeltildi. Buradaki **kod** çakışma taraması aynı düzeltmeyi almamış: aynı hatanın ikinci yüzeyi.

---

### [D-H-08] Projenin kendi indeks teşhis aracı `index-health.sql` bozuk — 10 bölümün 6'sı hiç koşmuyor, ve §9 salt-okunur bir teşhis script'inin içinde `CREATE EXTENSION` çalıştırıyor

| Şiddet | S3 | Kategori | H (ölçüm aracı) | Öncelik | P4 | Modül | OPS / teşhis | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `Teks-Erp/scripts/index-health.sql`, tam da D-H-02'nin gerektirdiği kararı (hangi indeks düşürülebilir) vermek için yazılmış. Bugün **§5'te hata verip duruyor**: sorduğu `rolls."batchSplitId"` kolonu parti modeli yeniden tasarlanınca kaldırılmış. Dosyanın başındaki kullanım talimatı (`psql ... -f`) ON_ERROR_STOP kullanmadığı için §6-§10 koşar ama §5 sessizce boş döner; denetim aracıyla (`ON_ERROR_STOP=1`) ise **§5'ten sonrası hiç koşmaz**. Ayrıca §9 `CREATE EXTENSION IF NOT EXISTS pgstattuple;` içeriyor — yani "teşhis" adı altında **DDL yazan** bir script; salt-okunur bir oturumda hata verir, canlıda superuser ister.

**Kanıt — kırılma:**
```
psql:Teks-Erp/scripts/index-health.sql:100: ERROR:  column "batchSplitId" does not exist
LINE 5:   round(100.0 * count(*) FILTER (WHERE "batchSplitId"    IS ...
```
`scripts/index-health.sql:97` — kolon `rolls`'ta yok (prod kopyası ve dev, ikisinde de).
**Kanıt — DDL:** `scripts/index-health.sql:145` `CREATE EXTENSION IF NOT EXISTS pgstattuple;`
**Kanıt — kaçırılan bölümler:** §5 partial-index adayları · §6 status dağılımı · §7 cache hit oranı · §8 ölü satır/VACUUM tazeliği · §9 kesin bloat · §10 seq-scan oranı. Bunları elle koşturdum ve **hepsi anlamlı çıktı** — yani kaybedilen bilgi gerçek:
```
rolls null oranı:  shipmentId %71,2 · sackId %71,2 · parentRollId %57,2 · parentReceiptId %93,9 · batchId %17,3
rolls status dağılımı: SHIPPED %28,3 · SUBCONTRACTOR_CONSUMED %26,2 · STOCK %11,6 · WAREHOUSE %10,3 · CANCELLED %9,5 ...
```
(`status` beş ayrı indekste yer alıyor ve dağılım dengeli → composite'lerin seçiciliği makul; bu, D-H-02'nin "hangisi düşer" sorusuna doğrudan girdi.)

**failure_mode.** D-H-02'nin önerdiği "önce ölç" adımını yapmak isteyen kişi projenin kendi aracını koşturur, §5'te hata görür, ya devam eder (ve §5'i kaybeder) ya da aracı bozuk sanıp bırakır. Ölçüm yapılmadan indeks düşürülür ya da hiç düşürülmez.

**Veride fiili ihlal (K2).** Yukarıdaki hata mesajı, prod kopyasına karşı üretildi.

**İş etkisi.** Dolaylı: yanlış indeks kararı ya da karar verilememesi.

**Öneri (2. tur).**
1. `batchSplitId` satırını kaldır, yerine `batchId`'yi koy (ölçüm yukarıda: %17,3 null — partial index adayı DEĞİL, bu da bir bilgi).
2. §9'u ayrı bir dosyaya çıkar (`index-bloat-pgstattuple.sql`) ve başlığına "superuser + DDL gerektirir, salt-okunur DEĞİL" yaz. Ana dosya salt-okunur kalsın.
3. Şema değişikliklerinde bu dosyanın kırılmasını yakalayan bir bekçi: `scripts/` altındaki tanı SQL'lerini `EXPLAIN`-only modda koşturan tek satırlık kontrol (`test_diagnostic_sql_parses.ts`).

**Kabul kriteri.** `audit/tools/sql-saha.sh -f Teks-Erp/scripts/index-health.sql` hatasız ve 10 bölümün hepsini basıyor; bekçi `batchSplitId` geri konunca kırmızı veriyor.

**Efor.** 0,5 gün.

**Önceki defter.** Kayıt yok.

---

### [D-H-09] Toplu etiket üretimi event loop'u 25 etiketlik bloklar hâlinde kilitliyor — yield aralığı süreye değil SAYIYA bağlı; özellik canlıda hiç kullanılmadığı için bugüne dek görülmedi

| Şiddet | S3 | Kategori | H (CPU-bound iş, tek process) | Öncelik | P4 | Modül | Etiket / baskı | Kanıt seviyesi | **K2 (bench)** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Etiket üretimi tamamen senkron CPU işidir: her top için 2 `bwipjs.toSVG` çağrısı (Code128 + QR) ya da raster yolunda glif-glif tarama. Toplu baskıda kod her **25 topta bir** `setImmediate` ile event loop'a nefes aldırıyor — bu, 2026-08 denetiminde eklenmiş doğru bir önlem. Sorun: yield aralığı bir **sayı**, bir **süre bütçesi** değil; donanım ya da etiket karmaşıklığı değişince bloklama süresi sessizce büyür ve tek process'te bu **tüm fabrikanın** duraklaması demektir.

**Kanıt — ölçüm (Apple M-serisi, 50 tekrar; fabrika sunucusu Windows/native, muhtemelen 2-4× yavaş):**
```
raster 1bpp etiket (100×75 mm @203 dpi, 12 metin + code128 + qr): 5,5 ms/etiket
bwip toSVG (code128 + qrcode, top başına 2 çağrı):                4,08 ms/top
bwip toBuffer (PNG QR, printed-document yolu):                    3,25 ms/çağrı
```
**Kanıt — yield deseni (`src/services/label.service.ts:1122-1134`):**
```ts
// F178: her top buildRollRenderInput içinde bwipjs.toSVG'yi (Code128+QR) 2 SENKRON
// çağırır → çok sayıda topta event-loop starvation (istasyon donması). ~25 topta bir
// setImmediate ile check fazına dön ...
if (++yielded % 25 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
```
Aynı desen native toplu yolda da (`:1177` civarı).
**Hesap:** 25 top × 4,08 ms = **~102 ms kesintisiz blok** (bu makinede). Fabrika sunucusunda 200-400 ms. 200 toplu bir baskıda 8 blok → toplam ~0,8-3,2 sn, 400 ms'lik dilimler hâlinde. O dilimlerde `/health` dahil **her istek bekler**.

**Kanıt — bugün kullanılmıyor (K2).** Canlı telemetride toplu etiket ucu **hiç yok**; tekil yollar var: `POST /api/labels/rolls/:id/print` 2.569 istek (maks 795 ms), `GET /api/labels/rolls/:id/native` 2.575 istek (maks 706 ms), `POST /api/labels/rolls/:id/seed-snapshot` 2.557 istek. Yani sahada etiketler **tek tek** basılıyor.

**failure_mode.** Depo sorumlusu Bitmiş Depo'da 200 topu seçip "Toplu etiket bas"a basar. Sunucu ~1-3 saniye boyunca 400 ms'lik dilimlerde bloklanır; o sırada Tambur tabletinden gelen kart okutması ve KK1 girişi bekler, tablette "sunucuya ulaşılamıyor" eşiği (istemci timeout) tetiklenebilir ve operatör aynı topu tekrar okutur.

**Veride fiili ihlal (K2).** Bench ölçümü yukarıda; canlıda tetiklenmemiş (uç kullanılmıyor).

**İş etkisi.** Toplu etiket özelliği sahaya girdiği gün ortaya çıkar.

**Öneri (2. tur).**
1. Yield koşulunu **süreye** bağla: `if (Date.now() - lastYield > 30) { await setImmediate; lastYield = Date.now(); }` — donanımdan ve etiket karmaşıklığından bağımsız 30 ms tavan.
2. Toplu uçlara sunucu tarafı **tavan** koy (ör. 200 top/istek, aşımda net 400) — `createShipment sackIds .max(500)` ve `stats-batch .max(12)` emsalleri zaten var, desen kurulu.
3. `bwip-js` çıktısı barkod METNİNE göre deterministiktir → küçük bir LRU önbellek (barkod → SVG) tekrar basımda maliyeti sıfırlar.

**Kabul kriteri.** 200 toplu baskı sırasında ölçülen en uzun event-loop bloğu < 50 ms (`/health` `eventLoopLagMs` ile doğrulanabilir).

**Efor.** 0,5 gün.

**Önceki defter.** `SINIR-OTESI-YONLENDIRME.md` K9 H-8 ve K6 (`label.service.ts:1136/1194` yield) — buradaki katkı ölçülmüş ms değerleri ve "sayı değil süre" kuralı.

---

### [D-H-10] `apply-attribute-to-rolls` ucunun `rollIds` dizisinde tavan yok; kardeş ucu `recolorRollIds` 5.000 ile sınırlı — asimetri hem koruma hem tutarlılık boşluğu

| Şiddet | S3 | Kategori | H (tavansız girdi / top başına ayrı transaction) | Öncelik | P4 | Modül | İş emri | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Planlamacının "iş emrinin tüm açık kumaşlarını tek hamlede düzelt" ucu, gelen `rollIds` dizisine **hiçbir üst sınır koymuyor** ve her top için ayrı bir transaction + ayrı bir audit yazımı yapıyor. Aynı dosyadaki kardeş şema (`recolorRollIds`) `.max(5000)` taşıyor.

**Kanıt — asimetri (`src/controllers/workorder.controller.ts`):**
```ts
:247  recolorRollIds: z.array(z.string().uuid()).max(5000).optional(),
:265  const applyAttributeSchema = z.object({
:266    rollIds: z.array(z.string().uuid()).min(1, "En az bir top seçmelisiniz"),   // .max() YOK
```
**Kanıt — top başına tx (`src/services/workorder-link.service.ts:783-801`):**
```ts
for (const roll of rolls) {
  try { await inventoryService.applyManualProperties(roll.id, {...}, userId, engineOpts); updated++; }
  catch (err) { failed.push({...}); }
}
```
`applyManualProperties` kendi transaction'ını ve kendi audit satırını açar → N top = N tx + N audit.
**Kanıt — kısmi koruma var.** `:742-764`: toplar `whereRollsOfWorkOrder(workOrderId)` ile süzülür ve `rolls.length !== ids.length` ise 400. Yani saldırgan 25.000 rastgele UUID gönderemez (400 alır) — ama **400'den ÖNCE** `prisma.roll.findMany({ where: { id: { in: 25.000 uuid } } })` koşar (gövde sınırı `express.json({limit:"1mb"})` ≈ 25.000 UUID'ye izin verir).

**failure_mode.** (a) Meşru kullanım: 500 toplu bir iş emrinde planlamacı rengi düzeltir → 500 ayrı transaction + 500 audit satırı, HTTP isteği dakikalarca açık kalır, istemci 15 sn timeout'una (Electron `apiClient` global) düşer ve kullanıcı **işlemin durumunu bilemez** (yarısı yazılmış olabilir; parçalı sonuç `failed[]` ile dönüyor ama istemci onu hiç görmeyecek). (b) Kötü niyetli/yanlış istemci: 25.000 elemanlı `IN` listesiyle tek sorgu — PG parametre sınırının (65.535) altında kalır, çalışır, sonra 400 döner; maliyet boşa harcanmış tam tarama.
Ek yan etki: `AuditService.log` `newData.rollIds` alanına **tüm diziyi** yazar (`:812`) → 500 toplu bir düzeltme `system_logs` içine ~20 KB'lık tek satır koyar (D-H-06'nın maks satır ölçümü 5.817 B; bu onu 3-4 katına çıkarır).

**Veride fiili ihlal (K2).** Arandı: prod'da iş emri başına en fazla **22** top ölçüldü (`work_order_steps` × `roll_movements`), yani bugünkü meşru kullanım 22 turla sınırlı → **etki yok**. K1.

**İş etkisi.** Bugün yok; iş emri başına top sayısı büyüdüğünde (büyük müşteri siparişi) planlamacı ekranı "cevapsız" kalır.

**Öneri (2. tur).** `rollIds: z.array(...).min(1).max(5000)` (kardeşiyle simetrik); döngüyü 50'lik parçalara ayırıp her parçadan sonra ilerleme dönmek yerine, uzun iş için **202 + iş durumu** deseni (yedek alma ucunda zaten kullanılıyor, `backup.service.ts:387`). Audit `newData.rollIds`'i ilk 100 + `"…ve N tane daha"` ile sınırla.

**Kabul kriteri.** 5.001 id ile 400; 500 id ile istek < 15 sn ya da 202 + durum ucu.

**Efor.** 0,5 gün.

**Önceki defter.** `SINIR-OTESI-YONLENDIRME.md` K1a: "K1b H6 `applyAttributeSchema.rollIds` **tavansız** (`recolorRollIds ≤5000` ile asimetrik)" — burada ölçüm + audit yan etkisiyle kapatıldı.

---

### [D-H-11] 85 yabancı anahtar kolonunun indeksi yok — hepsi `*ById` iz kolonları; bugün zararsız, ama zararsızlığın sebebi yazılı değil

| Şiddet | S4 | Kategori | H (FK indeksi) | Öncelik | P5 | Modül | Şema geneli | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Prisma `relationMode="foreignKeys"` (varsayılan) ile çalıştığı için DB'de gerçek FK var; ama Prisma FK'ye **otomatik indeks koymaz** (bunu yapan MySQL'dir). Prod kopyasında **85 FK kolonu** hiçbir indeksin ön ekinde değil. İyi haber: **hepsi `createdById`/`updatedById`/`cancelledById`/`mergedById` gibi iz kolonları** — birleştirme motorunun dokunduğu asıl ana-veri FK'leri (`customerId`, `itemId`, `colorId`, `subcontractorId`) **tamamı indeksli** (ölçüldü: bu dört ebeveyn için indekssiz çocuk kolonu **0**).

**Kanıt (prod kopyası, `pg_constraint contype='f'` × `pg_indexes` ön ek karşılaştırması, ilk satırlar):**
```
 rolls              | rolls_cancelledById_fkey          | {cancelledById}     | 2431
 rolls              | rolls_directShipmentId_fkey       | {directShipmentId}  | 2431   <-- D-H-03
 rolls              | rolls_sackId_shipmentId_...       | {sackId,shipmentId} | 2431
 user_permissions   | user_permissions_grantedById_fkey | {grantedById}       |  353
 ... (toplam 85)
```
**Kanıt — neden bugün ısırmıyor:** İndekssiz FK'nin iki maliyeti vardır: (a) o kolonla filtreleyen sorgular, (b) **ebeveyn satırı silinirken** FK doğrulaması için çocuk tablonun tam taranması. (a) için: kod `createdById`/`entryStationId` ile filtreliyor ama o ikisinin indeksi **var** (`rolls_createdById_idx`, `rolls_entryStationId_idx`). (b) için: `users` tablosunda **fiziksel silme yok** — grep `prisma.user.delete` → 0; kullanıcı soft-delete + tombstone ile yönetiliyor. 12 adet `/:id/permanent` ucu var ama hiçbiri `users` için değil.
**İstisna:** `rolls.directShipmentId` gerçek bir sorgu kolonudur ve indekssizdir → **D-H-03'te ayrı bulgu**.

**failure_mode.** İki tetikleyici: (1) Bir gün `users` için kalıcı silme ucu eklenirse (KVKK "unutulma hakkı" talebi bunu gündeme getirir), tek bir kullanıcı silme işlemi **41 farklı tabloyu tam tarar**; `rolls` 100.000 satırdayken bu tek başına dakikalar sürer ve tabloları kilitler. (2) "Bu topu kim iptal etti" gibi bir filtre ekranı gelirse (`cancelledById`), 100.000 satırlık `rolls` her sorguda taranır.

**Veride fiili ihlal (K2).** 85 satırlık liste yukarıdaki sorguyla üretildi; `users` fiziksel silme yolu arandı → **0**.

**İş etkisi.** Bugün sıfır. Yazılmamış olan invariant: *"`users` fiziksel olarak silinmez; bu yüzden iz kolonlarına indeks konmadı."*

**Öneri (2. tur).** Kod değişikliği ÖNERME (85 indeks eklemek D-H-02'yi kötüleştirir — her indeks yazma maliyetidir). Bunun yerine: (a) invariantı `schema.prisma` başına ve `ARCHITECTURE.md`'ye yaz; (b) `users` için kalıcı silme ucu eklenmesini yakalayan bir bekçi (`test_hard_delete_guard_coverage.ts` zaten var — allowlist'e "users asla" satırı); (c) yalnız `rolls.directShipmentId` indekslensin (D-H-03).

**Kabul kriteri.** Invariant yazılı; bekçi `users` hard-delete eklenirse kırmızı.

**Efor.** 0,25 gün.

---

### [D-H-12] Sistem kendi sorgu maliyetini ölçemiyor: `pg_stat_statements` yok, kopyadaki indeks istatistikleri geçersiz — "hangi indeks işe yaramıyor" sorusu bugün CEVAPLANAMAZ

| Şiddet | S4 (ölçüm boşluğu) | Kategori | H (en pahalı sorgular / kullanılmayan indeksler) | Öncelik | P4 | Modül | OPS | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Kontrol listesinin iki maddesi ("en pahalı sorgular: `pg_stat_statements`", "kullanılmayan/mükerrer indeksler: `pg_stat_user_indexes`") bu turda **uygulanamadı** ve sebebi bir kusurdur, benim kısıtım değil.

**Kanıt.**
- Eklenti listesi: `plpgsql`, `unaccent`, `pg_trgm` — **`pg_stat_statements` YOK** (KUNYE ve saha kopyasında doğrulandı). Yani hiçbir ortamda "hangi sorgu ne kadar CPU yedi" verisi tutulmuyor.
- `pg_stat_database.stats_reset` prod kopyasında **NULL** ve tablo sayaçları restore'dan itibaren birikiyor: `users` `seq_scan=1106 / idx_scan=0` — canlıda her istekte `users.findUnique(id)` koşan bir sistemde bu **imkânsız**, dolayısıyla sayaçlar denetimin kendi sorgularını sayıyor.
- Sonuç: `index-health.sql` §2'nin ürettiği **100+ satırlık "kullanılmayan indeks"** listesi (ör. `system_logs_userId_createdAt_idx` 408 kB, `items_nameFold_trgm_idx`, `work_order_steps_workOrderId_status_idx`) bu kopyadan **karar için kullanılamaz**.

**failure_mode.** D-H-02'nin gerektirdiği "hangi indeksi düşürelim" kararı, ya hiç verilmez ya da yanlış istatistikle verilir; ikinci durumda gerçekten kullanılan bir indeks düşürülür ve bir liste ekranı sessizce yavaşlar.

**İş etkisi.** Dolaylı ama kalıcı: sistem büyüdükçe performans kararları tahminle verilir.

**Öneri (2. tur).**
1. **Canlıda `pg_stat_statements`'ı aç** — `shared_preload_libraries` gerektirir, yani **bir PostgreSQL restart'ı** demektir. `[PROD'DA ÇALIŞTIRMA — vardiya dışı; geri alma: satırı geri çıkar + restart]`. Maliyeti düşüktür (~%1-2 CPU), kazancı bu raporun tüm tahmin ettiği şeylerin ölçülebilir hâle gelmesidir.
2. Kısa vadede eklenti gerektirmeyen alternatif: bir vardiya sonunda canlıda `pg_stat_user_indexes` anlık görüntüsünü alıp `audit/data/`'ya kaydeden salt-okunur bir script (`scripts/snapshot_index_usage.sql`) + bunu ayda bir koşturma alışkanlığı. Fark iki anlık görüntü arasında okunur, `stats_reset` gerekmez.
3. `/health` içindeki havuz metrikleri (`poolWaitingMax`, `poolConnectsTotal`, `poolAcquireTimeouts`) **yalnız bellekte** ve her restart'ta sıfırlanıyor (`lib/pool-health.ts:80-81, 127-131`); `endpoint_latency_daily` deseninin aynısıyla günlük satıra kalıcılaştırılmalı. (Bu ayak I alanına da girer — sınır ötesi notlarda.)

**Kabul kriteri.** Canlıda `pg_stat_statements` aktif **ya da** aylık indeks-kullanım anlık görüntüsü alınıyor; D-H-02'nin kararı gerçek sayıyla veriliyor.

**Efor.** 0,5 gün (script) / 0,25 gün + restart penceresi (eklenti).

---

### [D-H-13] Yavaş-istek defteri, yavaşlığın SEBEBİNİ taşımıyor ve restart'ta siliniyor — sistemin tek ölçülen performans anomalisi kendi telemetrisiyle teşhis edilemiyor

| Şiddet | S3 | Kategori | H (ölçüm) — I ile kesişir | Öncelik | P3 | Modül | OPS / telemetri | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Telemetri katmanı iyi tasarlanmış (route normalizasyonu, kardinalite tavanı, bucket histogramı, günlük kalıcılaştırma, 90 gün saklama, kapanışta flush). Üç eksiği D-H-01'i çözümsüz bırakıyor: (1) süre `res.on("finish")`'e kadar ölçülür, yani sunucu işi ile gövde aktarımı **ayrılamaz**; (2) yavaş-istek defteri yalnız `{at, method, route, status, ms}` tutar — sorgu dizesi, yanıt boyutu, DB süresi, cihaz/kullanıcı yok; (3) defter **bellekte** ve 50 kayıtlık halka, restart'ta yok olur.

**Kanıt.**
```ts
// src/middlewares/latency.middleware.ts:107-110
res.on("finish", () => record(res.statusCode));
res.on("close",  () => record(CLIENT_ABORTED_STATUS));
// src/services/latency-stats.service.ts:47-53
export interface SlowRequestEntry { at: number; method: string; route: string; status: number; ms: number; }
// :131
slowRing.push({ at: Date.now(), method, route: routeKey, status, ms: Math.round(ms) });
// :26  SLOW_RING_SIZE = 50   (bellek; kalıcı değil)
```
Günlük kalıcı satır (`endpoint_latency_daily`) yalnız `count/errCount/maxMs/buckets` taşır (şema doğrulandı).

**failure_mode.** 2026-08-20'de `GET /api/rolls` 10.439 ms sürdü. Bugün, sekiz gün sonra, o isteğin **hangi filtreyle, kaç satır için, kaç bayt döndürerek, hangi cihazdan** geldiği hiçbir kayıtta yok; halka çoktan dönmüş, üstelik aradaki her deploy onu silmiş. Bu yüzden D-H-01'in kök nedeni bu turda kapatılamadı.

**Öneri (2. tur).** D-H-01 §Öneri-1 ile aynı iş: `slowRing` girdisine `bytes`, `dbMs`, normalize `query` (anahtarlar + `limit`/`mode`/`withTotal`; **değerler değil** — KVKK) ve `deviceId` ekle; halkayı `endpoint_latency_daily` yanında küçük bir kalıcı tabloya (`slow_requests`, 30 gün saklama) yaz. İlk baytı ayrı ölç (`res.writeHead` anı) → sunucu/aktarım ayrımı.

**Kabul kriteri.** Bir sonraki 5 sn+ olayında kayıt, sorgu şeklini ve DB payını gösteriyor.

**Efor.** 0,5 gün. **Sınır ötesi:** I alanı da bu satırı ilgilendirir.

---

### [D-H-14] Swagger şeması üretimde de import anında kuruluyor ve bellekte tutuluyor — `/api-docs` hiç mount edilmediği hâlde

| Şiddet | S4 | Kategori | H (boot maliyeti / bellek) | Öncelik | P6 | Modül | CORE / boot | Kanıt seviyesi | **K2 (bench)** |
|---|---|---|---|---|---|---|---|---|---|

**Kanıt.** `src/config/swagger.ts:55` `const swaggerSpec = swaggerJSDoc(options);` **modül gövdesinde**, koşulsuz. Prod kapısı ise ondan SONRA, fonksiyonun içinde: `:69 if (process.env.NODE_ENV === "production") return;`. `ecosystem.config.js:76` `NODE_ENV: "production"` → yani sahada spec kurulur, belleğe alınır ve **hiç kullanılmaz**. Kapsam: `routes/**` + `controllers/**`, **456 `@openapi` bloğu**. Ölçüm (bu makine, `tsx` ile modül yükleme): **339 ms**; fabrika sunucusunda ~1 sn.

**failure_mode.** Her `pm2 restart` (her deploy, her Windows yeniden başlatma) ~1 saniye boşa gider ve spec nesnesi süreç ömrü boyunca RAM'de kalır. Tek başına önemsiz; **açılış patlamasına** eklenir: `lib/prisma.ts:44-46` notu boot'ta havuzun 24 bağlantıya açıldığını ve `poolWaitingMax=7` olduğunu ölçmüş. Yani açılışta zaten kuyruk var; bir de 1 sn'lik senkron JSDoc ayrıştırma o kuyruğu uzatır.

**Öneri.** `swaggerSpec`'i `setupSwagger` içine lazy taşı (prod'da hiç üretilmesin). Bir satır.

**Kabul kriteri.** `NODE_ENV=production` ile boot süresinde ölçülebilir düşüş; dev'de `/api-docs` aynen çalışıyor.

**Efor.** 0,25 gün.

---

### [D-H-15] İstek yolundaki küçük senkron/tavansız noktalar (üçü bir arada)

| Şiddet | S4 | Kategori | H | Öncelik | P6 | Modül | çeşitli | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

Üçü de aynı sınıf, tek satırda topluyorum çünkü hiçbiri tek başına bulgu ağırlığında değil; birlikte bir alışkanlığı gösteriyor.

1. **`latency-persist` flush'ı N+1.** `src/services/latency-persist.service.ts:124-155`: her route anahtarı için ayrı `findUnique` + `update`/`create`. `MAX_PENDING_KEYS = 600`, flush 5 dakikada bir. Bugün ~30 aktif anahtar → 60 gidiş-dönüş/5 dk (önemsiz), ama `upsert` ile tek ifadeye inerdi. **`setImmediate` ile istek yolundan çıkarılmış olması doğru** (`:102-105`).
2. **`fs.readFileSync` HTTP handler'ında.** `src/routes/mobile-update.routes.ts:56` — OTA manifest'i senkron okunuyor. Manifest KB'lar mertebesinde ve bu uç LAN yedeği (asıl kanal nginx/VPS), ama desen yanlış: dosya büyürse event loop bloklanır. `fs.promises.readFile` tek satır.
3. **`listDbCopies` her GET'te cluster'ı tarıyor.** `src/services/db-copy.service.ts:836-900` + `routes/db-copy.routes.ts:55`: `probeCapabilities()` (yeni admin bağlantısı) + `pg_database_size()` **cluster'daki her DB için** (dizin yürüyüşü) + `pg_stat_activity` sayımı + `readCopyRecords()`. Admin ekranı, düşük hacim; ama `_old_`/`_restore_` kopyaları biriktikçe (dev'de var) her GET onlarca GB'lık dizin taraması yapar.

**failure_mode (en somut olan, 3 için).** Sistem yöneticisi "Veritabanı Kopyaları" ekranını açar; sunucuda 3 adet 1,5 GB'lık eski kopya vardır. `pg_database_size` her biri için dosya sistemini yürür → istek saniyeler sürer ve o sırada aynı process başka istek servis edemez (I/O beklemesi event loop'u bloklamaz ama admin bağlantısı havuz dışıdır ve PG tarafında iş üretir).

**Öneri.** (1) `upsert`; (2) `await fs.promises.readFile`; (3) `listDbCopies` sonucunu 30 sn önbellekle (feature-flag cache emsali) ya da boyut hesabını ayrı bir "yenile" tuşuna bağla.

**Efor.** 0,5 gün (üçü birlikte).

---

### [D-H-16] `verifyToken` iki bağımsız sorguyu SIRAYLA koşuyor — bilinçli tasarımın ölçülmemiş yarısı

| Şiddet | S4 | Kategori | H (istek başına taban maliyet) | Öncelik | P6 | Modül | CORE / kimlik | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** K12 (satır 160) bu maliyetin yeniden ölçülmesini ② CORE.veri-performans'a bırakmış; ölçüm burada.

**Kanıt — kod (`src/middlewares/auth.middleware.ts`):**
```ts
:74  const fresh   = await prisma.user.findUnique({ where: { id: payload.userId }, select: {...} });
:88  const session = await prisma.session.findUnique({ where: { jti: payload.jti }, select: {...} });
```
İkisi **birbirinden bağımsız** ve **sırayla** koşuyor; havuz client'ı olduğu için `Promise.all` meşru ve doğru olurdu (beceri §1: havuzdan alınan ayrı bağlantılar gerçekten paraleldir). Mobil isteklerde buna `resolveDevice` eklenir (`device.middleware.ts:53` → `DeviceService.resolveDevice`, `device.service.ts:365`) → **istek başına 3 sıralı gidiş-dönüş**.

**Kanıt — hepsi indeksli (prod kopyası):** `users_pkey`, `sessions_jti_key`, `devices_deviceId_key` — üçü de unique index seek.
**Kanıt — hacim:** 40 günde 175.242 istek; bunun 62.644'ü `/health` (kimliksiz). Kimlikli istek ≈ 112.000 → 40 günde ~336.000 ek sorgu, yani **~140 sorgu/dakika ortalama**, vardiya tepesinde ~1-2/sn. Her biri indeks seek (<1 ms yerel DB).
**Kanıt — yazma tarafı doğru throttle'lı:** `auth.middleware.ts:16-42` `lastSeenWrites` Map + 60 sn throttle + 5.000 girdide budama; `device.service.ts:376-390` aynı desen (`Device.lastSeenAt` + `WorkSession.lastActivityAt`), ikisi de fire-and-forget.

**failure_mode.** Bugün yok — ölçüm bunu söylüyor. Tetikleyici: tablet sayısı 5'ten 30'a çıkar ve yoklama aralığı kısalırsa (5 sn) istek başına 3 sıralı RTT, ağ gecikmesi 2 ms olan bir kurulumda 6 ms taban gecikme demektir; `Promise.all` bunu 2 ms'ye indirir. **Bugün değiştirmeye değmez**; kayda geçmesinin sebebi K12'nin talebi ve "birden fazla istemci gelirse buradan bakılır" işaretidir.

**Öneri.** Şimdilik **değişiklik önerilmiyor**. Cihaz sayısı 20'yi geçtiğinde `Promise.all([user, session])` (davranış birebir aynı, iki `throw` sırası korunmalı: `user` hatası `session` hatasından önce gelmeli).

**Efor.** 0,25 gün (gerektiğinde).

**Önceki defter.** `F-CORE-VER-002` (K12 satır 160) — "KAPANMIŞ ama defter kısmen"; bu satır o talebi kapatır.

---

## 2. Uygulanan kontrol listesi

### Bölüm 3-H (prompt satır 620-631)
| Madde | Durum |
|---|---|
| FK kolonlarında index var mı? (`relationMode` kontrolü) | **Uygulandı.** `relationMode` verilmemiş → `foreignKeys`, DB'de gerçek FK var; 85 indekssiz FK kolonu listelendi → **D-H-11** + `rolls.directShipmentId` → **D-H-03**. Merge ebeveynleri (customers/items/colors/subcontractors) **tam indeksli** (ölçüldü: 0 eksik). |
| En pahalı sorgular (`pg_stat_statements`) | **KAPSAM DIŞI — eklenti kurulu değil** (hiçbir ortamda). Bu bir kusur olarak **D-H-12**'ye yazıldı. Yerine 5 kritik sorgu şekli elle `EXPLAIN (ANALYZE, BUFFERS)` ile ölçüldü. |
| Büyük tablolarda sequential scan (`pg_stat_user_tables`) | **Uygulandı, ama sonuç GEÇERSİZ** — restore sonrası sayaçlar (§0b). Ölçülen tek gerçek seq scan: `orders."orderDate"` (**D-H-05**), EXPLAIN ile doğrulandı. |
| Kullanılmayan/mükerrer index'ler (`pg_stat_user_indexes`) | **Uygulandı, KARAR VERİLEMEDİ** — aynı sebeple (§0b). `index-health.sql` §2 100+ satır üretti; **hiçbiri DROP önerisine dönüştürülmedi** (kasıtlı). Mükerrer/önek-yutulan adaylar §4 ile listelendi (`rolls`'ta 4 `status`-önekli composite). → **D-H-02**, **D-H-12**. |
| Sınırsız büyüyen tablolar / arşiv stratejisi / 5 yıl | **Uygulandı.** `system_logs` (arşivli, durağan ~138k) · `system_log_archives` (**saklama YOK**, 5 yılda ~750 MB) · `endpoint_latency_daily` (90 gün saklama, tavanlı — **doğru**) · `roll_operations`/`roll_movements` (üretim hızına bağlı, küçük). Tüm DB 5 yıl ≈ 1,5 GB. → **D-H-06**. |
| Connection pool boyutu vs eşzamanlı tx; uzun tx'lerin pool'u kilitlemesi | **Uygulandı.** Havuz `max 30 / idle 10 dk / connectTimeout 5 sn`, tx `maxWait 5 sn / timeout 20 sn`; en uzun tx bütçesi merge **120 sn** (`master-data-merge.service.ts:64,711`) ama DB `statement_timeout` **50 sn** → tek ifade önce kesilir. Tükenme senaryosu ölçüldü: **tx içinde havuz client'ı kullanımı 0** (grep + elle doğrulama; tek eşleşme yorum satırıydı), dinamik fan-out `Promise.all(x.map(prisma…))` **1 yer ve `.max(12)` ile tavanlı**. Boot patlaması bilinen (24 bağlantı, `poolWaitingMax=7`, `prisma.ts:44-46`). **Havuz tükenmesi bulgusu YOK — bu iyi bir sonuç.** |
| Sıcak satır / kilit kuyruğu | **Uygulandı.** `roll_barcode_counters` (dev: 45 satır, 14.138 güncelleme, %100 HOT — tek indeksli, doğru kurulmuş) + `pg_advisory_xact_lock` 8 nokta; ikisi anahtarsız-global (`8022` parti, permission-admin, merge). → **D-H-04**. `SystemSetting` 30 sn TTL + tek sorgulu feature-flag cache (**doğru**), `presence` bellek Map (tek process, doğru). |
| `findMany()` sınırsız dönüş | **Uygulandı.** 530 `findMany` ayrıştırıldı; **463'ünde `take` yok**. `where`i de olmayan (tam tablo) **34 tanesi** tek tek incelendi: hepsi ana-veri kataloğu ya da dışa aktarım adaptörü (yüzler mertebesi) — **`items` kod taraması hariç** (**D-H-07**). Liste uçları tavanlı: `MAX_PAGE_SIZE=500`, `MAX_OFFSET=10000` (`utils/query-parser.ts:18,22`), cursor `limit ≤ 200` (base) / `≤ 500` (rolls). Toplu uçlar tavanlı: `sackIds .max(500)`, `stats-batch .max(12)`, `MAX_SELECTED_SACKS`, `MAX_SHIPMENTS=2000`, `MAX_ROWS_TO_MOVE=200.000`. **Tek tavansız toplu uç: `applyAttributeSchema.rollIds`** → **D-H-10**. |
| Ağır raporlar operasyonel DB'de mi | **Uygulandı.** Evet, aynı DB'de — ama tasarım disiplinli: 21 rapor servisinin **çoğu `$queryRaw` toplulaştırma** kullanıyor (JS'te groupBy yok), aralık **366 günle sınırlı** (`reports/_shared.ts:16,60`), yanlış parametre adı 400 veriyor (`.strict()`). Canlı kullanım **çok düşük** (uç başına 2-6 istek/40 gün) → maliyet sahada henüz ölçülmemiş. Tek yapısal kusur: **D-H-03** (indekssiz korelasyonlu alt sorgu) ve **D-H-05** (tarih ekseni indekssiz). |

### Göreve eklenen 10 alt madde
| # | Madde | Durum |
|---|---|---|
| 1 | Tablo boyutu + satır sayısı + seq/idx scan; restore sonrası istatistik uyarısı | **Uygulandı** — §0a/§0b, tam tablo raporda. |
| 2 | `scripts/index-health.sql` saha'da koş | **Uygulandı** — koştu ve **kırıldı** → **D-H-08**; §5-§10 elle koşturuldu. |
| 3 | FK kolonlarında index eksikliği listesi | **Uygulandı** — 85 satır, → **D-H-11**, **D-H-03**. |
| 4 | Sınırsız `findMany`/export/search/rapor + bellek tahmini | **Uygulandı** — 463 tavansız çağrı sınıflandırıldı; bellek tahmini ölçülmüş payload ile (2.427 B/top) → **D-H-01**, **D-H-07**, **D-H-10**. |
| 5 | `system_logs` büyümesi, archive ne siler, index, JSON boyutu, 5 yıl | **Uygulandı** — → **D-H-06** (tüm sayılar orada). |
| 6 | Havuz 30 vs 20 sn tx tavanı vs uzun işler; tükenme; `/health poolWaitingMax` | **Uygulandı** — tükenme senaryosu **doğrulanamadı (iyi haber)**; `poolWaitingMax` var ama **kalıcı değil** → **D-H-12** §3. |
| 7 | Sıcak satır: SystemSetting/flag cache, presence, session-registry kilidi, roll-finalize sayaç kilidi (kaç ms?) | **Uygulandı** — session-registry kilidi `hashtext(userId\|deviceType)` ile **anahtarlı** (global değil, doğru). Sayaç kilidi süresi: helper'ın sözleşmesindeki ölçüm (1345→39 ms) tek dokunuşluk; **bugünkü kilit süresi = (N+8) gidiş-dönüş**, N ölçüldü (prod maks 22) → ~50-100 ms. → **D-H-04**. |
| 8 | CPU-bound raster/PDF event loop'ta senkron mu; 5 tablet aynı anda | **Uygulandı** — bench ile ölçüldü → **D-H-09**. Toplu uçlar sahada **hiç kullanılmıyor** (telemetri). |
| 9 | En ağır 5 raporun sorgu şekli (join/aggregate/JS toplama) | **Uygulandı** — 21 rapor servisinin sorgu stili tablolandı; **JS'te toplama yok**, raw aggregate hâkim; iki yapısal kusur → **D-H-03**, **D-H-05**. |
| 10 | include derinliği / select eksikliği → aşırı veri | **Uygulandı** — `ROLL_LIST_INCLUDE` 11 ilişki / 2.427 B/satır ölçüldü (**D-H-01**); WO listesi `select` ile daraltılmış ve `batches` tavanlı (**doğru**); `operations`/`properties` tavansız ama fan-out ölçüldü (maks 3) → aşağıda "Doğru yapılanlar"ın sınırı olarak not edildi. |

---

## 3. Doğru yapılanlar (korunmalı kalıplar)

1. **Sayfalama tavanları merkezî ve gerekçeli.** `utils/query-parser.ts:18,22`: `MAX_PAGE_SIZE=500` **clamp etmiyor, 400 fırlatıyor** (sessiz daraltma yok) ve `MAX_OFFSET=10000` aşılınca 400 — "filtre kullanmaya zorla". Cursor pagination `utils/cursor.ts` tie-breaker'lı (`createdAt` + `id`) ve nullable sıralama kolonları için null-aware cursor var (`inventory.service.ts:1515-1520`). Bu, offset-pagination'ın klasik "sayfa 500'de sunucu ölür" arızasını baştan kapatıyor.
2. **Toplu uçlarda fan-out tavanı ve gerekçesi yazılı.** `stats-batch .max(12)` (`controllers/inventory.controller.ts:80-97`) — yorumda "her kalem KENDİ aggregate'ini paralel koşar, yani bu sayı doğrudan eşzamanlı havuz checkout'u demek (havuz tavanı 30)" yazıyor ve **eski 50 tavanı bilinçli olarak düşürülmüş**. Aynı disiplin `MAX_SHIPMENTS=2000` (üstelik **önce ucuz `count`, aşımda hiç yüklemeden 400** — `accounting-export.service.ts:227-238`), `MAX_SELECTED_SACKS`, `MAX_ROWS_TO_MOVE`.
3. **Transaction içinde havuz client'ı kullanımı SIFIR.** Mekanik olarak taradım: 119 interaktif tx içinde `prisma.*` çağrısı **yok** (tek eşleşme bir yorum satırıydı). `lib/prisma.ts` bu tuzağın bedelini ölçmüş ve yazmış ("30 eşzamanlı işlemin yalnız 3'ü tamamlandı"). Bu, en pahalı havuz arızasının kapıda tutulduğu anlamına gelir.
4. **`getRollStats` tek geçişte toplar.** `inventory.service.ts:1849-1854`: `groupBy(["status","qualityGrade"])` + `_count` + `_sum` → eskiden 3 ayrı tarama olan iş tek tarama; JS tarafı yalnız on'lar mertebesinde grup üzerinde `Decimal` toplama (float drift'i de önlenmiş).
5. **Rapor katmanı aralık tavanlı ve sunucu tarafında toplulaştırıyor.** `reports/_shared.ts`: varsayılan 30 gün, **maksimum 366 gün → 400**, `.strict()` ile yanlış parametre adı sessizce yok sayılmıyor. 21 rapor servisinin çoğu `$queryRaw` aggregate; "JS-tarafı groupBy yok" kuralı dosyanın başlığında yazılı ve tutulmuş.
6. **Dış süreç çağrıları disiplinli.** `helpers/pg-tool.helper.ts:98-137`: `timeout` + `killSignal: SIGKILL` + **stderr mutlaka tüketiliyor** (pipe dolup child'ın asılmasını önler) + 64 KB tavan + zaman aşımı ayrı raporlanıyor. `pg_dump`/`rclone` gibi işlerin en sık arızası (sessizce asılı kalma) burada kapalı.
7. **Telemetrinin kendisi tavanlı ve kalıcı.** `latency-persist`: 5 dk flush **istek yolundan `setImmediate` ile ayrılmış**, `MAX_PENDING_KEYS=600` kardinalite tavanı + `(diğer)` taşma kovası, 90 gün saklama, `gracefulShutdown`'da flush. `endpoint_latency_daily` bu denetimin en değerli kanıt kaynağı oldu — **bu tablo olmasaydı D-H-01 hiç bulunamazdı.**
8. **Barkod/parti sayaçlarının kilit SIRASI load-bearing olarak belgelenmiş ve bekçili.** `roll-barcode.helper.ts:52-72` ve `batch.service.ts:110-122` yalnız "ne yapıldığını" değil **ölçülen bedeli** yazıyor. D-H-04'ün eleştirisi bu disiplinin *eksik uygulanmasına*dır, disiplinin kendisine değil.
9. **Rapor/defter tabloları doğru indekslenmiş.** 2026-08 sonrası eklenen `roll_variances`, `roll_plan_deviations`, `roll_returns` tablolarının hepsinde tarih ekseni + kırılım kolonları indeksli (ölçüldü). Önceki denetimin (BACKEND-CODE-REVIEW-2 §162) işaret ettiği dört eksik indeks (`roll_movements.exitedAt`, `roll_errors.detectedAt/processedAt`, `roll_operations.createdAt`) **prod'da mevcut** — kapanmış.

---

## 4. Sınır ötesi notlar

| Hedef | Not |
|---|---|
| **I (hata/gözlemlenebilirlik)** | `D-H-13` doğrudan I'ya da aittir: yavaş-istek defteri kalıcı değil. Ayrıca `/health` havuz metrikleri (`poolWaitingMax`, `poolAcquireTimeouts`) **process-local ve restart'ta sıfırlanıyor** (`lib/pool-health.ts:80-81`) — `endpoint_latency_daily` deseni burada da uygulanabilir. `pool-health.ts:29-32` kendi kapsam boşluğunu yazmış: **zamanlayıcı işlerindeki havuz zaman aşımı sayaçta GÖRÜNMEZ.** |
| **I** | `statement_timeout` (50 sn) tetiklendiğinde PG `57014` döner; `error.middleware`'in bunu 503/anlamlı mesaja çevirip çevirmediği D-H kapsamı dışında ama **D-H-03'ün failure_mode'u tam buraya çıkıyor** (rapor 50 sn'de kesilir → kullanıcı ne gördü?). |
| **J (migration/kurtarma)** | Repoda **hiçbir migration `CREATE INDEX CONCURRENTLY` kullanmıyor** ve hiçbirinde `lock_timeout` yok. D-H-03 ve D-H-05'in önerdiği üç indeks canlı, dolu tablolara eklenecek → bu alışkanlığın kırılması gerekiyor. Ayrıca `scripts/index-health.sql:145` bir teşhis script'i içinde `CREATE EXTENSION` çalıştırıyor (D-H-08) — DDL/teşhis ayrımı J'nin konusu. |
| **J** | `pg_stat_statements` açmak `shared_preload_libraries` + **PostgreSQL restart** gerektirir (D-H-12) — deploy penceresi planlaması J'ye ait. |
| **D-A / D-D (eşzamanlılık / tx sınırları)** | D-H-04'ün bekçi kör noktası (`test_barcode_reservation.ts:71-75` "döngüsüzdür" iddiası `subcontractor.service.ts:517`/`:636` için YANLIŞ) eşzamanlılık tarafını da ilgilendirir: aynı kilit, aynı sıra. |
| **D-C (veri modeli)** | `rolls` üzerindeki 24 indeksin 5'i `status` içeriyor ve `status` dağılımı ölçüldü (SHIPPED %28,3 / SUBCONTRACTOR_CONSUMED %26,2 / STOCK %11,6 …) — composite seçicilik kararı için girdi. Ayrıca null oranları: `parentReceiptId` %93,9, `shipmentId`/`sackId` %71,2 → partial index adayları (bir kısmı zaten partial). |
| **D-F (API sözleşmesi)** | `applyAttributeSchema.rollIds` tavansızlığı (D-H-10) bir sözleşme kusuru olarak da okunabilir; ayrıca uzun süren toplu işlerin **202 + durum ucu** deseni yerine senkron HTTP kullanması istemci timeout'uyla çakışıyor. |
| **G (güvenlik)** | `express.json({limit:"1mb"})` bir kaynak-tüketim tavanıdır ve doğru konmuş; `import.routes` kendi `10mb` limitini kullanıyor — G'nin dosya yükleme maddesiyle kesişir. |
| **K (test)** | `test_barcode_reservation.ts` çağrı YERİ sayıyor ama çağrının döngüde olup olmadığını ölçmüyor (D-H-04) — "bekçi hatayla aynı yerde kör" sınıfının yeni bir örneği. `index-health.sql`'in kırılmasını yakalayan bekçi yok (D-H-08). |

---

## 5. KAPSANMAYAN / ERİŞİLEMEYEN

1. **Canlı prod sunucusuna erişim yok.** Tüm ölçümler 2026-08-25 tarihli kopyada ve dev'de yapıldı. Prod'un `max_connections`, `shared_buffers`, `statement_timeout`, autovacuum ayarları ve **gerçek `pg_stat_*` sayaçları** okunamadı. `statement_timeout=50 sn`'nin sahada gerçekten ayarlı olduğu önceki denetim kaydına dayanıyor `[VARSAYIM]`.
2. **`pg_stat_statements` yok** → "en pahalı sorgular" maddesi ölçümle değil, kod okuması + elle `EXPLAIN` ile kapatıldı (D-H-12).
3. **D-H-01'in kök nedeni kapatılamadı.** DB'nin sorumlu olmadığı, taşımanın sorumlu olmadığı, serileştirme/sıkıştırmanın sorumlu olmadığı **ölçümle** gösterildi; geriye kalan üç aday (Prisma sonuç birleştirme / havuz bekleme / event-loop çekişmesi) mevcut telemetriyle ayrılamıyor. Ayırmanın yolu D-H-01 §Öneri-1'de yazılı. Prisma'yı denetim oturumundan çalıştırmak `_BRIEF` kural 2'yi (yalnız iki SQL aracı) ihlal edeceği için denenmedi.
4. **Yük testi yapılmadı.** `scripts/load_test.ts` mevcut ama dev DB'ye yazar; salt-okunur kural gereği koşturulmadı. "5 tablet aynı anda etiket basarsa" senaryosu **hesapla** (ölçülmüş ms × eşzamanlılık) verildi, gerçek eşzamanlı koşumla değil.
5. **İçe aktarım (17 adaptör) yolunun `item.service` kod taramasını satır başına çağırıp çağırmadığı doğrulanmadı** — D-H-07'nin en kötü failure_mode'u buna bağlı; adaptör yolunun ayrı incelenmesi gerekiyor.
6. **Electron/mobil istemci tarafı ölçülmedi** (kapsam backend). D-H-01'in "istemci timeout'u / yeniden deneme" adayı bu yüzden kapatılamadı; `Electron/src/hooks/useDataTable.ts` yalnız kanıt olarak okundu.
7. **Bloat'ın kesin ölçümü (`pgstattuple`) yapılmadı** — eklenti yok ve kurmak DDL olurdu. D-H-02'nin şişme kanıtı `pg_relation_size` oranları + `n_tup_hot_upd` üzerinden dolaylıdır.
8. **`endpoint_latency_daily` 2026-08-25'ten sonrasını taşımıyor** (kopya tarihi). D-H-01'in son üç günde de sürüp sürmediği bilinmiyor.
