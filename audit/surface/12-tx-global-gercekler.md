# 12 — Transaction / Veri Katmanı GLOBAL GERÇEKLERİ

> **Bu dosya A3 (`CORE.veri-performans`) oturumunun ikinci çıktısıdır.**
> Amacı: her B fazı eşzamanlılık hücresinin bu sayıları **yeniden ölçmemesi** ve
> temelsiz bulgu yazmaması. Buradaki her satır 2026-08-09'da canlı dev DB'si
> (saha kopyası) ve kaynak okumasıyla **ölçülmüştür** — varsayım değildir.
> Bir sayı değişmişse ölçümü tekrarla ve bu dosyayı güncelle.

## 1. Süreç topolojisi — PAZARLIK DIŞI

Tek process. Tek `app.listen`, cluster / PM2-cluster / worker_threads **YOK**
(`server.ts:38-49` bu invariant'ı ve ona bağlı dört mekanizmayı listeliyor:
presence, feature-flag cache, archive-scheduler, backup-scheduler).

> **B hücrelerine kural:** "cluster'da bozulur" **YANLIŞ POZİTİFTİR**. In-memory
> durum bu kurulumda **doğru çalışır**. Meşru bulgu, invariant'ın *mekanik bekçisi
> olmaması*dır — ve o bugün de doğrudur, topolojiden bağımsızdır.

## 2. Transaction bütçesi — TEK DEĞER, HERKES İÇİN AYNI

| Ayar | Değer | Kaynak |
|---|---|---|
| `transactionOptions.maxWait` | **5.000 ms** | `lib/prisma.ts:90` |
| `transactionOptions.timeout` | **20.000 ms** | `lib/prisma.ts:91` |
| Per-call override | **HİÇ YOK** | tüm kod tabanı |
| Toplam `$transaction` | 115 (111'i interactive) | taban ölçümü |
| `isolationLevel` | hiçbir yerde verilmemiş → **READ COMMITTED** | tüm kod tabanı |

**Ölçüm:** `system_logs` içinde (en eski kayıt 2026-07-16, `system_log_archives`
**boş** yani hiç arşivlenmemiş) **P2028 / P2024 kodlu tek bir kayıt yok.**
Yani 20 sn bütçesi kayıtlı geçmişte **hiç aşılmamış**.

⚠️ **Ama "iz yok" ≠ "olmadı" değil, burada gerçekten "olmadı" demek** — çünkü
P2028/P2024 dalı **audit YAZIYOR** (`error.middleware.ts:446-453`, `recordId` =
kodun kendisi). Yani bu boşluk gerçek bir yokluktur. Aynı şey **tanınmayan diğer
Prisma kodları için geçerli DEĞİLDİR** (bkz. `F-CORE-OPS-002`: onlar audit'siz 400
dönüyor, dolayısıyla onların yokluğu kanıt değildir).

**Kayıtlı TEK tıkanıklık olayı:**
`2026-08-04T23:11:56Z · recordId=POOL_TIMEOUT · kind="acquire" · path=/api/auth/login`
— aşılan şey tx bütçesi değil, **havuzdan bağlantı ALMA** bütçesidir (5 sn).

⚠️ `tambur.controller.ts:39-41`'deki kesim tavanı yorumu bütçeyi **5 sn** sanıyor
(bayat — `F-CORE-VER-004`). Bir tavan/bütçe kararı verirken o yorumu kaynak alma.

## 3. Havuz

| Ayar | Değer |
|---|---|
| `max` | 30 |
| `idleTimeoutMillis` | 600.000 (10 dk) |
| `connectionTimeoutMillis` | 5.000 — **ALMA bütçesi**, soğuk connect dahil |
| PG `max_connections` | **100** (ölçüldü) |
| Oturum seçeneği | `-c timezone=UTC` — **SÜS DEĞİL**, adapter varsayımı (kök CLAUDE.md) |

Tek process × 30 = PG'nin 100 slotunun en fazla %30'u. Kalan 70 psql / pgAdmin /
`pg_dump` / db-copy içindir. **"Havuz küçük" / "max_connections yetmiyor" bulgusu
ölçüm olmadan YAZILMAZ** (`F-CORE-VER-005` bu sayıları kayda geçirdi).

Havuz zaman aşımı olduğunda audit kaydı olay anındaki `poolTotal/poolIdle/poolWaiting`
sayaçlarını da yazar (`error.middleware.ts:258-262`) — doygunluk mu soğuk connect mi
sorusu **bir sonraki olayda kesin** ayrılabilir.

⚠️ `recordPoolTimeout` **yalnız HTTP hata yolundan** çağrılıyor (`F-CORE-OPS-004`):
zamanlanmış işlerdeki havuz zaman aşımı `/health` sayacında **görünmez**.

## 4. Serileşme noktaları — bir tx'in BAŞKA tx'leri beklettiği yerler

### 4.1 Top barkod sayacı (SİSTEM GENELİ) — `F-CORE-VER-001`
`roll_barcode_counters`, **gün + tip başına TEK satır**.
`INSERT … ON CONFLICT DO UPDATE n = n + 1` → satır kilidi.
**`tx` verilirse kilit tx BOYUNCA tutulur.**

10 çağrı yeri ölçüldü:

| Client | Sayı | Yerler |
|---|---|---|
| **`tx`** (kilit tx boyunca) | **8** | `tambur.service.ts:965, 2330, 2970` · `inventory.service.ts:857, 3954` · `subcontractor.service.ts:453, 2770` · `workorder-batch-drop.service.ts:399` |
| havuz client (anlık) | 2 | `tambur.service.ts:1990, 2578` |

Tip ayrımı (`H`/`F`) contention'ı **böler** — farklı tipler ayrı satırdır. Ama
KK1 ham girişi (`H`) ile Tambur'un STOCK çıkışlı kesim çocukları (`H`) ve fason
sevk (`H`) **aynı satırda buluşur**.

### 4.2 Diğer advisory lock namespace'leri (çakışma kontrolü için)

| Namespace | Sahibi | Kaynak |
|---|---|---|
| `8021` | KK1 mükerrer giriş guard'ı | kök CLAUDE.md |
| `8022` | Parti no üretimi (`generateBatchNumberTx`) | kök CLAUDE.md |
| 1-argümanlı uzay | `session-registry`, `permission-management` | kök CLAUDE.md |

⚠️ `pg_advisory_xact_lock(int,int)` ile `(bigint)` **ayrı uzaylardır**, birbirini
görmezler. Yeni kilit eklerken bu tabloya yaz.

## 5. İstek başına taban DB maliyeti — `F-CORE-VER-002`

| Middleware | Sorgu | Önbellek |
|---|---|---|
| `verifyToken` | `user.findUnique` + `session.findUnique` = **2** | **YOK** (anlık iptal için bilinçli) |
| `verifyToken` | `session.updateMany` (lastSeenAt) | throttled: ≤1/dk/jti |
| `resolveDevice` | `device` çözümü = **1** (yalnız `x-device-id` varsa) | **YOK** |

Ölçülen middleware sırası: `helmet(0) → cors(1) → compression(2) → jsonParser(3) →
morgan(4) → latency(5) → resolveDevice(6) → swagger(7) → static(8) → router…`

⚠️ `resolveDevice` **statikten ÖNCE** — statik dosya isteği de cihaz sorgusu ödüyor.
⚠️ `jsonParser` **morgan/latency'den ÖNCE** — 400/413 istekleri hiçbir ölçüme düşmüyor (`F-CORE-OPS-003`).

Saha tabanı: **18 APPROVED cihaz** (ölçüldü), tablet 5 sn'de bir yokluyor
→ iş sorgusu başlamadan **~11 sorgu/sn**.

## 6. Hard delete ve FK silme davranışı

Canlı DB'de ölçülen FK `ON DELETE` dağılımı:

| Davranış | Adet |
|---|---|
| SET NULL (`n`) | **99** |
| RESTRICT (`r`) | 68 |
| CASCADE (`c`) | 40 |
| NO ACTION (`a`) | 2 |

> **Kural: SET NULL FK P2003 FIRLATMAZ.** Yani `BaseService.hardDelete`'in
> "bağlı kayıt var → 409" güvencesi **yalnız RESTRICT bağlar için** geçerlidir.
> SET NULL bağlar her serviste **AÇIKÇA sayılmak zorundadır**.

Bu kural kod tabanında **büyük ölçüde uygulanmış** (denetimde tek tek doğrulandı):

| Model | Hard delete | SET NULL guard'ı |
|---|---|---|
| Station / Machine / Route / DefectType | `guarded-hard-remove.ts` | ✔ (F1/F38/F211/F39 yorumlarıyla) |
| Item | kendi override'ı | ✔ (`work_orders.targetItemId`) |
| Device | kendi override'ı | ✔ (`peripheral_devices.deviceId` + pivot) |
| **Customer** | kendi override'ı | **✘ `rolls.labelCustomerId` EKSİK** → `F-CORE-VER-003` |
| Roll / Order / WorkOrder | fiziksel silme **YOK** (soft/arşiv) | uygulanamaz |
| Color / QualityGrade / ReturnReason / FabricProperty / CustomerBranch | `/permanent` ucu **YOK** | uygulanamaz |

## 7. Bu oturumda ÇÜRÜTÜLEN hipotezler (tekrar yazma)

1. **"Bilinmeyen Prisma kodu 500 döner"** → **HAYIR**, generic **400** döner
   (`error.middleware.ts:461`). Asıl sorun 400'ün kendisi + audit yokluğu.
2. **"Akış ortasında hata sürecı öldürür"** → **HAYIR**. Ölçüldü: errorHandler
   `ERR_HTTP_HEADERS_SENT` fırlatır, Express 5 yakalar, finalhandler soketi yok eder.
   `uncaughtException` **olmaz**, süreç ayakta kalır.
3. **"`BaseService.reactivate` nested alanları sessizce düşürüyor"** → **ULAŞILAMAZ KOD**.
   nestedCreateFields taşıyan dört modelin de kodu backend-authoritative ve her
   create'te taze; `existing` daima null (`F-CORE-VER-007`).
4. **"BaseService `safeFilters` cursor yolunda uygulanmıyor"** → **HAYIR**, iki yolda da
   uygulanıyor (`base.service.ts:288` ve `:344`).
5. **"`assertNameNotDuplicate` limitsiz findMany bir performans bulgusu"** → bugün **DEĞİL**;
   en büyük tablo `items` = **193 satır** (`F-CORE-VER-006`, eşik kaydı).
