# TeksERP Backend — Kod İnceleme & Düzeltme Takip Dosyası

> **Bu dosya hem inceleme raporu hem de canlı düzeltme takip listesidir.**
> Her bulgunun başında **Durum** satırı var. Düzeltilen bulgu `✅ Düzeltildi` olarak
> işaretlenir, ne değiştirildiği + doğrulaması yazılır. Başka bir oturumda buradan
> bakıp kalınan yerden devam edilebilir.

**Tarih:** 2026-06-11 · **Kapsam:** `Teks-Erp/` (Express 5 + Prisma 7 + PostgreSQL, ~45k satır TS, 64 model, 173 index, 40 migration)

## Durum Lejantı
- ⬜ **Bekliyor** — henüz dokunulmadı
- 🔧 **Devam ediyor**
- ✅ **Düzeltildi** — tarih + değişen dosya/satır + doğrulama notu ile
- ⏭️ **Bilinçli kabul / Atlandı** — neden ile

## Yöntem & Dürüstlük Notu
Bu rapordaki **her bulgu, iddia edilen dosya/satırdaki gerçek kod okunarak bizzat doğrulanmıştır.**
(Kökteki eski `Teks-Erp/backend_risk_report.md`'nin aksine.) 4 paralel uzman inceleme + şemanın tam
okuması + en kritik 7 bulgunun elle ikinci doğrulamasıyla hazırlandı.

**Genel değerlendirme:** Codebase olgun ve iyi mühendislik ürünü. Cursor pagination, partial index'ler,
`statement_timeout`, `safeSortBy`/`safeFilters` enjeksiyon kalkanı, atomik claim guard'ları (shipping &
tambur), `withBarcodeRetry`, best-effort audit + `/health` sayacı, Decimal→number serileştirme zaten
**doğru**. Aşağıdakiler bu olgunluğun üstündeki **kalan boşluklar**dır.

---

## İLERLEME PANOSU

| # | Başlık | Kategori | Severity | Durum |
|---|---|---|---|---|
| BL-1 | Fason sevkte atomik claim yok → top iki firmaya gidebilir | Race | 🔴 Yüksek | ✅ |
| SEC-1 | Fason firma `isActive` doğrulanmıyor (sevk+kabul) | Validation | 🟡 Orta | ✅ |
| SEC-2 | Sipariş satırı `itemId`/property `isActive` doğrulanmıyor | Validation | 🟡 Orta | ✅ |
| SEC-3 | WO custom rota `stationId` `isActive` doğrulanmıyor | Validation | 🟡 Orta | ✅ |
| BL-2 | Fason sevk/kabul belge no `withBarcodeRetry` dışında | Race | 🟡 Orta | ✅ |
| PERF-1 | Fason dönüşü roll+movement tek-tek (`createMany` değil) | N+1 | 🟡 Orta | ✅ |
| PERF-2 | WO ayır/redye movement tek-tek | N+1 | 🟡 Orta | ✅ |
| BL-3 | `kursun-qc.finishStep` açık-movement yarışı | Race | 🟡 Orta | ✅ (+ prod. sibling ✅) |
| PERF-4 | Roll listesi offset modda koşulsuz `count()` | Query | 🟡 Orta | ⏭️ Ertelendi |
| PERF-6 | Her cihaz isteğinde `lastSeenAt` yazımı (throttle yok) | Perf | 🟡 Orta | ✅ |
| PERF-3 | Sevk iptali movement tek-tek update | N+1 | 🟢 Düşük | ✅ |
| PERF-5 | `getFeatureFlags` cache-miss'te 15 seri sorgu | Query | 🟢 Düşük | ✅ |
| SEC-4 | `user-preferences` JSON blob'unda boyut sınırı yok | Validation | 🟢 Düşük | ✅ |
| SEC-5 | Sayısal alanlarda üst sınır yok (P2020 UX) | Validation | 🟢 Düşük | ✅ |
| DB-1 | PK/FK `text` UUID (native `@db.Uuid` değil) | Şema | 🟡 Orta | ✅ |
| DB-2 | `rolls` tablosunda yazma amplifikasyonu | Şema | 🟢 Düşük | ⬜ İzle |
| ARCH-1 | `admin.routes` katman atlıyor (user CRUD) | Mimari | 🟡 Orta | ✅ |
| ARCH-2 | `create()`/`replace()` rota-adım mantığı kopyalanmış | Mimari | 🟡 Orta | 🔶 Kısmen (SEC-3 guard helper'a alındı; geniş dedup ⏭️) |
| ARCH-3 | Servis katmanı Express `Request`'e bağlı | Mimari | 🟢 Düşük | ⏭️ Ertelendi |
| BUG-1 | Fason picker IN_PRODUCTION topu HATALI gizliyor (dispatch'ten katı) | Bug | 🟡 Orta | ✅ |

---

# 1. Database Şeması ve Sorgu Optimizasyonu

### Olumlu (doğrulandı)
Şema referans kalitesinde: tüm FK'lerde `@@index`, eşitlik-önce composite sıralaması, null-yoğun
kolonlarda partial index, snapshot JSON'ların liste `select`'inden bilinçli dışlanması. N+1 *okuma*,
raporda zincirleme sorgu, liste sorgusunda snapshot çekme — yok.

### DB-1 🟡 — PK/FK kolonları `text` UUID; native `@db.Uuid` değil
**Durum:** ✅ Düzeltildi (2026-06-11, "tüm veri test verisi, serbest değiştir" onayıyla) — 208 kolona (`@id @default(uuid())` PK'ler + tüm `@relation` FK'leri + SystemLogArchive.id/userId) `@db.Uuid` eklendi (`scratch/add-uuid-native.mjs`). ATLANANLAR doğru kaldı: `recordId`, `batchSplitId` (formal FK değil), `PairingCode.code`, `SystemSetting.key`. Migration `20260611084953_native_uuid_pk_fk` (truncate→empty migrate→re-seed; Prisma text→uuid cast üretmiyor, test verisi olduğundan reset kabul).

**⚠️ RİPPLE — ham SQL cast'leri:** native uuid kolonu string param ile karşılaştıran ham SQL `operator does not exist: uuid = text` verir. 6 sorgu düzeltildi: `subcontractor.service` (cancel+receive: `::text[]`→`::uuid[]`, `${stepId}::uuid`), `kursun-qc.service` (finishStep `${step.id}::uuid`; priority `unnest ::uuid[]`), `workorder.service` (detach `IN(Prisma.join)`→`= ANY(${ids}::uuid[])` ×2). `reports/*` tarandı: temiz (tarih param + uuid=uuid join). **KURAL: yeni ham SQL'de uuid kolonu param ile karşılaştırılırken `${p}::uuid` / `${arr}::uuid[]` ŞART.**

**Risk:** `id String @id @default(uuid())` PostgreSQL'de `text` (~37 byte) yaratır, native `uuid` (16 byte)
değil. 64 tablo × yüz binlerce satır × ~170 index'in çoğu UUID FK üzerinde → index'ler ~2x büyük, daha az
shared_buffers'a sığar, join'lerde string karşılaştırması yavaş.

**Konum:** `prisma/schema.prisma` — her modelde PK + tüm FK kolonları (`@db.Uuid` yok).

**Çözüm:** Domain kuralı "tüm veri test verisi, geri-uyum derdine girme" → migration için ideal zaman.
PK + tüm FK'lere `@db.Uuid` ekle. Migration `text→uuid` cast üretir; büyük tabloda yazma kilidi alır →
vardiya dışı deploy + migration başına `SET statement_timeout = 0;` (CLAUDE.md §14). Boş kurulumda risksiz.
*(İstenmezse: bilinçli kabul edilebilir; "text'te kalıyoruz" notu yeterli.)*

### DB-2 🟢 — `rolls` tablosunda yazma amplifikasyonu (İZLE)
**Durum:** ⬜ İzle (acil değil)

**Risk:** `rolls` en yüksek-hacim + en sık güncellenen tablo; ~17 index'in ~8'i `status` içeriyor. Her
status UPDATE'i bu index'leri yeniden yazar → WAL, bloat, autovacuum baskısı. Okuma için bilinçli takas.

**Konum:** `schema.prisma:663-699`.

**Çözüm:** `scripts/index-health.sql` §8/§9 ile bloat ölç (takvimle değil). EXPLAIN ile hangi composite'in
gerçekten seçildiğini doğrula; kullanılmayanı düşür. Şimdilik sadece izle.

---

# 2. Mimari ve Business Logic (İş Mantığı)

### BL-1 🔴 — Fason sevkte atomik claim yok: aynı top eşzamanlı iki sevke girebilir
**Durum:** ✅ Düzeltildi (2026-06-11) — `subcontractor.service.ts:577` koşulsuz `updateMany` → atomik claim (`status:{in:[IN_PRODUCTION,STOCK]}` + `count` doğrulaması + `AppError.conflict`).

**Risk:** `subcontractor.dispatch` status kontrolünü transaction DIŞINDA yapıyor (satır 400 + 468-485),
sonra tx içinde status'u **koşulsuz** çeviriyor (satır 577). İki operatör aynı `IN_PRODUCTION` topu
eşzamanlı okutursa ikisi de geçer → top **iki dispatch kaydına** girer, `batchSplitId` ezilir. `kartela.dispatch`
bunu **doğru** yapıyor (claim + count guard) — bu bir tutarsızlık.

**Konum:** `src/services/subcontractor.service.ts:577` (guard `:400`+`:468-485`, tx başı `:493`).

**Çözüm:** Koşulsuz `updateMany`'yi atomik claim'e çevir (kartela.dispatch:294-306 deseni):
```ts
const claimed = await tx.roll.updateMany({
  where: { id: { in: dispatchRollIds }, status: { in: [RollStatus.IN_PRODUCTION, RollStatus.STOCK] } },
  data: { status: RollStatus.AT_SUBCONTRACTOR, batchSplitId: dispatch.id },
});
if (claimed.count !== dispatchRollIds.length)
  throw AppError.conflict("Toplardan biri bu sırada başka bir sevke alındı. Listeyi yenileyip tekrar deneyin.");
```
> İlgili: `subcontractor.receive` (`:1108`) dönüş rollerini guard'sız çeviriyor — aynı desen (düşük risk).

### BL-2 🟡 — Fason sevk/kabul belge no `withBarcodeRetry` ile sarılmamış
**Durum:** ✅ Düzeltildi (2026-06-11) — import eklendi; `dispatch()` (~501) ve `receive()` (~1077) tx'leri `withBarcodeRetry(() => prisma.$transaction(...))` ile sarıldı. Cancel tx'leri (766, 2344) sequence üretmediği için dokunulmadı.

**Risk:** `dispatchNo`/`receiptNo` `@unique`, `nextPrefixedSequence` ile tx içinde üretiliyor ama
`withBarcodeRetry` yok. Eşzamanlı iki sevk aynı `SD-YYMM-NNNNNN`'i hesaplar → ikinci commit P2002 ile
kullanıcıya hata olarak yansır. `kartela.dispatch` ve `shipping.createShipment` retry kullanıyor.

**Konum:** `src/services/subcontractor.service.ts:524` (dispatch), `:1053` (receive).

**Çözüm:** Her iki tx'i `withBarcodeRetry(() => prisma.$transaction(...))` ile sar.

### BL-3 🟡 — `kursun-qc.finishStep` açık-movement seti tx dışında okunuyor
**Durum:** ✅ Düzeltildi (2026-06-11) — `kursun-qc.service.ts:~620` raw `$executeRaw` (guard'sız) → `$queryRaw ... WHERE exitedAt IS NULL ... RETURNING`; dönen rollere göre createMany, `closed.length===0 → bail`. **KALAN:** `production.handleStepFinish` (`production.service.ts:354` + `helpers/roll-step.helper.ts:208` `openMovementForNextStep`) aynı şekle sahip — ⬜ bekliyor (Düşük öncelik, tek-roll yolu).

**Risk:** Açık movement'lar tx dışında okunuyor (577), raw UPDATE `movementIds`'e göre kapatıyor ama
`AND exitedAt IS NULL` predicate'i yok (623-630), sonraki adım `createMany`'si koşulsuz (634). İki eşzamanlı
`finishStep` → top çift açık IN movement ile çift ilerler. `length===0` guard'ı sadece sıralı retry'ı korur.

**Konum:** `src/services/kursun-qc.service.ts:577` → `:621-657`.

**Çözüm:** Okumayı tx içine al, atomik `updateMany({where:{...exitedAt:null}})` ile kapat, `count===0 → bail`
(createMany yapma).
> Aynı şekil: `production.handleStepFinish` (`production.service.ts:354` + `helpers/roll-step.helper.ts:208`).

### ARCH-1 🟡 — `admin.routes` katman atlıyor (route içinde iş mantığı)
**Durum:** ✅ Düzeltildi (2026-06-11) — user create/update/deactivate iş mantığı (conflict+hash+audit) `PermissionManagementService.createUser/updateUser/deactivateUser`'a taşındı; `admin.routes` user handler'ları sadece Zod + servis çağrısı. `userSelect`/`AuthService` import'u kaldırıldı. **+ dashboard:** `dashboard.routes` $queryRaw aggregation'ları → yeni `DashboardService.getDefectsSummary/getStationsLiveState`; route artık ince. (admin.routes'taki permission/template/log handler'ları zaten kendi servislerini kullanıyor.)

**Risk:** "Routes→Controllers→Services→Prisma" kuralına rağmen `admin.routes.ts` user CRUD'unu route
handler içinde yapıyor (Zod + prisma + hash + audit). `UserService` yok; mantık dağınık, test edilemez.

**Konum:** `src/routes/admin.routes.ts:112-141` (+`:144+`); `dashboard.routes.ts:96-166`; `auth.controller.ts:134,203,251`.

**Çözüm:** `UserService` çıkar; route sadece zincir kursun. Dashboard `$queryRaw`'ları `DashboardService`'e.

### ARCH-2 🟡 — `create()`/`replace()` rota-adım/allocation/hedef-ürün mantığını kopyalıyor
**Durum:** 🔶 Kısmen düzeltildi (2026-06-11) — **YAPILDI:** SEC-3 soft-delete guard'ı (istasyon/kategori/firma `isActive`, create+replace'te kopyaydı) tek `assertRouteRefsActive(finalSteps)` module-helper'ına alındı; iki metot da çağırıyor (workorder.service.ts, class öncesi). WO split/redye/fason testleri create+replace yollarını doğruluyor (26/0, 20/0, 18/0). **KALAN (⏭️):** geniş dedup — `resolveRouteSteps(data,{withStepIds})` + `resolveAllocations(data)` + `resolveTargetItem(...)`. Bunlar 386/546 satırlık iki metotta ince ayrışmalar içeriyor (replace step-id propagation + smart-merge); maintainability-only, regresyon riski yüksek. Ayrı oturumda karakterizasyon testiyle yapılmalı.

**Risk:** `workorder.service.ts` create (271-657) ve replace (2569-3115) blokları neredeyse birebir tekrar;
yazar "create() ile aynı" notu düşmüş, zaten ayrışmaya başlamışlar → drift riski.

**Konum:** `src/services/workorder.service.ts` create `285-369`, replace `2663-2738`.

**Çözüm:** `resolveRouteSteps`/`resolveAllocations`/`resolveTargetItem` helper'larını çıkar, ikisi de çağırsın.

### ARCH-3 🟢 — Servis katmanı Express `Request`'e bağlı (sızıntılı soyutlama)
**Durum:** ⏭️ Ertelendi (2026-06-11) — `BaseService.findAllCursor(req)` + birkaç servis `req.query` parse ediyor; düzeltmek `ListQuery` tipini tanımlayıp BaseService + tüm `findAll*` çağıranlarını + controller'ları değiştirmeyi gerektirir (geniş, çapraz-kesen). Düşük severity (bilinçli generic-CRUD tasarım sonucu). **Plan:** `ListQuery {limit,cursor,withTotal,filters,search,page,pageSize,sortBy,sortOrder}` tipini controller'da `parseQueryParams(req)`'ten üret, servislere düz nesne geçir; BaseService imzasını `req: Request` → `query: ListQuery` olarak değiştir. Ayrı oturum.

**Risk:** `BaseService.findAllCursor(req: Request)` `req.query`'yi kendi parse ediyor → servis job/test/başka
servisten sahte `req` olmadan çağrılamaz. (Generic CRUD'un bilinçli sonucu — düşük öncelik.)

**Konum:** `base.service.ts:234-262`; `inventory.service.ts:611,637`; `return.service.ts:374`; `color.service.ts:38`.

**Çözüm:** `req.query`'yi controller'da tipli `ListQuery`'ye parse edip servise düz nesne geçir.

---

# 3. Performans ve Ölçeklenebilirlik

### PERF-1 🟡 — Fason dönüşü: roll + movement tek-tek (`createMany` değil)
**Durum:** ✅ Düzeltildi (2026-06-11) — `subcontractor.service.ts` newRolls döngüsü → explicit `uuidv4()` id + 3 `createMany` (roll / rollProperty cross-product / rollMovement). 200 parça: ~400 INSERT → ~3 batch.

**Risk:** En sık fason-dönüş happy-path'i her parça için 2 seri INSERT + nested `properties.create`. Büyük
parti → tx uzar, kilit tutulur. DB kuralı #9 ihlali. Aynı dosya dispatch yolunda `createMany` kullanıyor.

**Konum:** `src/services/subcontractor.service.ts:1238-1290`. Etki: 200 parça → ~400 seri INSERT.

**Çözüm:** `barcode` null (sequence retry gerekmez) → `createMany` ile roll'lar, sonra movement'lar, sonra
`RollProperty`'ler batch.

### PERF-2 🟡 — WO ayır/redye: movement tek-tek
**Durum:** ✅ Düzeltildi (2026-06-11) — `workorder.service.ts:~1899` redye rewind döngüsü → tek `rollMovement.createMany`.

**Risk:** Partideki her roll için seri `rollMovement.create`; partide yüzlerce roll olabilir.

**Konum:** `src/services/workorder.service.ts:1858-1869`. Etki: 300-roll redye → 300 seri INSERT.

**Çözüm:** Tek `createMany` (satırlar `rollId`/`qtyIn`/`weightIn` dışında özdeş).

### PERF-3 🟢 — Sevk iptali: her açık movement ayrı UPDATE
**Durum:** ✅ Düzeltildi (2026-06-11) — `subcontractor.service.ts` cancelDispatch: findMany+per-row update → tek `$executeRaw UPDATE ... CASE WHEN notes IS NULL ... ELSE notes || ' | ' || tag`.

**Risk:** İptal edilen dispatch'in roll sayısı kadar seri UPDATE; her satırın `notes`'u kendi eski değerine bağlı.

**Konum:** `src/services/subcontractor.service.ts:769-787`. Etki: 200-roll iptali → 200 seri UPDATE.

**Çözüm:** Tek raw UPDATE + `COALESCE` string concat.

### PERF-4 🟡 — Roll listesi offset modunda koşulsuz `count()`
**Durum:** ⏭️ Ertelendi (2026-06-11) — backend-only güvenli düzeltilemiyor. `PaginatedResponse.total`/`totalPages` **zorunlu** alan (api.types.ts), Electron offset `list` (Rolls/service.ts:73) sayfa numarası için okuyor; count'u atlamak offset çağıranları kırar. Ana Rolls tablosu zaten cursor mode (`useDataTable` → ilk fetch'te `withTotal=true`). **Gerçek çözüm = kalan offset çağıranları cursor mode'a taşımak** (frontend koordineli iş). NOT: count `Promise.all` ile findMany'ye PARALEL → istek latency'sine eklenmiyor; maliyet DB CPU/IO. Düşük aciliyet.

**Risk:** Cursor yolu count'u `wantTotal` arkasına alıyor; offset yolu (default) her sayfada `roll.count({where})`
→ yüz binlerce satırda full scan.

**Konum:** `src/services/inventory.service.ts:679-688`.

**Çözüm:** Offset count'u `withTotal` arkasına al (cursor yolunu aynala).

### PERF-5 🟢 — `getFeatureFlags` cache-miss'te 15 ardışık sorgu
**Durum:** ✅ Düzeltildi (2026-06-11) — `getFeatureFlags` tek `findMany` ile tüm ayarları çekip in-memory client enjekte ediyor; reader'lar değişmeden map'ten okuyor (default/parse tek kaynak korundu). 4 reader'a (pricing/targetQuantity/rawWidth/partyCode) eksik `tx?` param eklendi.

**Risk:** Cache miss'te 15 seri `findUnique`. 30sn TTL sıklığı sınırlı tutuyor ama her ayar yazımı invalide ediyor.

**Konum:** `src/services/system-setting.service.ts:321-337`.

**Çözüm:** Tek `findMany({where:{key:{in:[...]}}})` → Map → reader'ları besle.

### PERF-6 🟡 — Her cihaz isteğinde `lastSeenAt` DB yazımı (throttle yok)
**Durum:** ✅ Düzeltildi (2026-06-11) — `device.service.ts:resolveDevice` `Map<deviceId,lastWriteMs>` + 60sn throttle; UPDATE yalnız son yazımdan 60sn geçtiyse. Map cihaz sayısıyla sınırlı.

**Risk:** `resolveDevice` her `x-device-id`'li istekte (üretim trafiğinin çoğu) bir read + koşulsuz `UPDATE
lastSeenAt`. Küçük-sıcak satırda sürekli yazma amplifikasyonu (churn/ölü tuple/WAL/autovacuum).

**Konum:** `device.middleware.ts:45,83` → `device.service.ts:291-294`.

**Çözüm:** `Map<deviceId, lastWriteMs>` ile throttle (son 60s'de yazıldıysa atla).

### Olumlu (doğrulandı)
MRP/kapsama batch'li `groupBy`+Map (N+1 yok); tüm `reports/*` `$queryRaw`; `presence.ts` lazy-prune;
feature-flag TTL+invalidate; archive-scheduler overlap-guard'lı; istek yolunda senkron `fs`/crypto yok.

---

# 4. Güvenlik ve Hata Yönetimi

> LAN-only/tek-fabrika duruşu gereği perimeter (CORS/rate-limit/HTTPS/şifre-policy) bilinçli kapsam dışı.

### Olumlu (doğrulandı)
`error.middleware.ts` P2002/P2003/P2025/P2020/P2022/P2014 + Zod + JSON-syntax'ı eşliyor, internals sızdırmıyor.
31 router'da her mutating route `verifyToken` + `:write`/`mobile:*` izni taşıyor — eksik yetki açığı yok.
Tüm `try/catch {}` blokları bilinçli best-effort.

### SEC-1 🟡 — Fason firma `isActive` doğrulanmıyor (sevk + kabul)
**Durum:** ✅ Düzeltildi (2026-06-11) — 4 spot: `subcontractor.service.ts:374,947` + `kartela.service.ts:189,438`. `select:{id,isActive}` + `if(!isActive) badRequest("... pasif durumda")` (order.service şube deseni).

**Risk:** Dört giriş noktası da firmanın varlığını kontrol ediyor ama `isActive`'ini değil → pasife alınmış
firmaya sevk/kabul yapılabilir. Soft-delete-entry hata sınıfı (CLAUDE.md'de işaretli).

**Konum:** `subcontractor.service.ts:374-377` (dispatch), `:929-933` (receive); `kartela.service.ts:189-192` (dispatch), `:435-438` (receive).

**Çözüm:** `select:{isActive:true}` + reddet (en azından iki dispatch yolunda):
```ts
if (!subcontractor || !subcontractor.isActive) throw AppError.badRequest("Fason firma bulunamadı veya pasif");
```

### SEC-2 🟡 — Sipariş satırı `itemId`/property `isActive` kontrolsüz yazılıyor
**Durum:** ✅ Düzeltildi (2026-06-11) — yeni `validateLineItems()` helper'ı (item + fabricProperty `isActive` batch doğrulama); `create()` ve `update()` içinde `validateLines`'tan sonra çağrılıyor.

**Risk:** `order.service` müşteri/şube/renkleri `isActive` ile doğruluyor ama `validateLines` yalnız qty/price
bakıyor; `itemId`/property hiç doğrulanmıyor → pasif ürün canlı sipariş satırına yazılır (var-olmayan UUID
zaten P2003; boşluk *pasif* kayıtlar).

**Konum:** `order.service.ts:217-240` (validateLines) + write `:739-751`; update `:896`.

**Çözüm:** Yazımdan önce `item.findMany({where:{id:{in},isActive:true}})` ile doğrula.

### SEC-3 🟡 — WO custom rota `stationId` `isActive` kontrolsüz
**Durum:** ✅ Düzeltildi (2026-06-11) — `create()` (~satır 332) VE `replace()` (~2758) içine station + subcontractorCategory + subcontractor `isActive` batch guard'ı eklendi (custom + şablon yolunu birlikte kapsar). NOT: blok iki yerde kopya → ARCH-2 refactor'unda `resolveRouteSteps` helper'ına taşınacak.

**Risk:** Template yolu `isActive` doğruluyor ama custom-route dalı istasyon aktifliğini kontrol etmiyor →
emekli istasyona işaret eden `WorkOrderStep`.

**Konum:** `workorder.service.ts:324-329` (build) → `:562-569` (write).

**Çözüm:** `finalSteps` kurulmadan `station.findMany({where:{id:{in},isActive:true}})` ile doğrula.

### SEC-4 🟢 — `user-preferences` JSON blob'unda boyut sınırı yok
**Durum:** ✅ Düzeltildi (2026-06-11) — `user-preference.controller.ts` şemasına `.refine(JSON.stringify(v).length <= 64_000)` eklendi.

**Risk:** `z.record(z.string(), z.unknown())` keyfi büyüklükte blob kabul ediyor. Self-scoped+LAN → düşük etki.

**Konum:** `src/controllers/user-preference.controller.ts:14`.

**Çözüm:** `.refine((v) => JSON.stringify(v).length < 64_000, "Tercih verisi çok büyük")`.

### SEC-5 🟢 — Sayısal alanlarda üst sınır yok (P2020 UX)
**Durum:** ✅ Düzeltildi (2026-06-11) — `.max(999_999_999)` (Decimal(12,3) tavanı) eklendi: inventory.controller (initialQty/weightKg/width), workorder.controller (width/targetQuantity/targetWeight × create+update), shipping.controller (weightKg), order.service.validateLines (qty/unitPrice).

**Risk:** Bütünlük açığı değil (P2020→400 temiz yakalanıyor). Sadece UX: `1e12` gibi değer DB'de generic
mesajla reddediliyor, alan-düzeyinde değil.

**Konum:** `inventory.controller.ts:17-20`, `order.service.ts:217-240`, `shipping.controller.ts:38`, `workorder.controller.ts:15-17`.

**Çözüm (opsiyonel cila):** `.max(999_999_999, "Değer çok büyük")` ekle.

> **Token iptali notu:** `User.tokenVersion` yok — pasif kullanıcının JWT'si süresi dolana dek geçerli. LAN'da düşük öncelik.

---

# Öncelikli Aksiyon Sırası (bu sırayla düzeltiliyor)

**Hemen (veri-bütünlüğü):** BL-1 → SEC-1 → SEC-2 → SEC-3 → BL-2
**Yakında (ölçek+tutarlılık):** PERF-1 → PERF-2 → BL-3 → PERF-4 → PERF-6
**Düşük öncelik:** PERF-3 → PERF-5 → SEC-4 → SEC-5
**Planlı (mimari+uzun-vade):** DB-1 → ARCH-1 → ARCH-2 → ARCH-3 → DB-2 (izle)

---

# DÜZELTME GÜNLÜĞÜ (Fix Log)

> Her düzeltme burada tarih + değişen dosya/satır + doğrulama (tsc/test) ile kaydedilir.

### 2026-06-11 — BL-1 ✅ Fason sevk atomik claim
- **Dosya:** `Teks-Erp/src/services/subcontractor.service.ts` (~satır 575-595)
- **Değişiklik:** `dispatch()` içindeki koşulsuz `tx.roll.updateMany({where:{id:{in}}})` → `status:{in:[IN_PRODUCTION,STOCK]}` guard'lı atomik claim; `claimed.count !== dispatchRollIds.length` ise `AppError.conflict` (409) ile tx rollback. Eşzamanlı çift sevki engeller.
- **Doğrulama:** `AppError.conflict` mevcut (app-error.ts:47). tsc bekleniyor (toplu kontrol sonda).

### 2026-06-11 — SEC-1 ✅ Fason firma isActive guard
- **Dosyalar:** `subcontractor.service.ts` (dispatch ~374, receive ~947), `kartela.service.ts` (dispatch ~189, receive ~438)
- **Değişiklik:** `findUnique`'lara `select:{id:true,isActive:true}` eklendi; existence sonrası `if(!subcontractor.isActive) throw AppError.badRequest("... pasif durumda")`. Pasife alınmış firmaya sevk/kabulü engeller.
- **Doğrulama:** Local `subcontractor` var'ı yalnız existence+isActive için kullanılıyor (grep ile teyit; diğer `subcontractor.` erişimleri farklı objelerde). tsc sonda.

### 2026-06-11 — SEC-2 ✅ Sipariş satırı itemId/property isActive
- **Dosya:** `order.service.ts` — yeni `validateLineItems()` (~satır 262), çağrılar `create()` (~678) ve `update()` (~943).
- **Değişiklik:** Satırlardan `itemId` + `requiredPropertyIds` toplanıp `item`/`fabricProperty` `isActive:true` ile batch doğrulanıyor; eksik → `AppError.badRequest`. Pasif ürün/özelliğin canlı sipariş satırına yazılmasını engeller.
- **Doğrulama:** `npx tsc --noEmit` → **TSC_OK** (BL-1+SEC-1+SEC-2 birlikte derlendi).

### 2026-06-11 — SEC-3 ✅ WO rota istasyon/kategori/firma isActive
- **Dosya:** `workorder.service.ts` — `create()` (~332) ve `replace()` (~2758) blokları.
- **Değişiklik:** `finalSteps` kurulduktan sonra `stationId`/`requiredCategoryId`/`plannedSubcontractorId` referansları `isActive:true` ile batch doğrulanıyor; eksik → `AppError.badRequest`. Şablon + custom rota ikisini de kapsar.
- **Bilinen borç:** Aynı blok iki metotta kopya → ARCH-2'de `resolveRouteSteps` helper'ına taşınacak.
- **Doğrulama:** `npx tsc --noEmit` → **TSC_OK**.

### 2026-06-11 — BL-2 ✅ Fason sevk/kabul withBarcodeRetry
- **Dosya:** `subcontractor.service.ts` — import (~19); `dispatch()` tx (~501) ve `receive()` tx (~1077) `withBarcodeRetry` ile sarıldı.
- **Değişiklik:** `SD-`/`SR-` belge no'ları @unique; eşzamanlı üretimde P2002 artık kullanıcıya hata yerine retry ile çözülüyor. Cancel tx'leri (sequence yok) atlandı. BL-1'in `AppError.conflict`'i P2002 olmadığı için retry'a girmez (doğru).
- **Doğrulama:** `npx tsc --noEmit` → **TSC_OK**.

### 2026-06-11 — PERF-1 ✅ Fason dönüşü createMany
- **Dosya:** `subcontractor.service.ts` — `receive()` newRolls döngüsü (~1267) + `uuid` import (~20).
- **Değişiklik:** Top başına `roll.create`+`rollMovement.create` (N+1, nested `properties.create`) → qty validate + `uuidv4()` id + `roll.createMany` + `rollProperty.createMany` (cross product) + `rollMovement.createMany`. 200 parça: ~400 INSERT → ~3 batch.
- **Doğrulama:** `npx tsc --noEmit` → **TSC_OK**.

### 2026-06-11 — PERF-2 ✅ WO redye movement createMany
- **Dosya:** `workorder.service.ts` redye rewind (~1899).
- **Değişiklik:** `for (const r of fresh) rollMovement.create` → tek `rollMovement.createMany`. 300-roll redye: 300 INSERT → 1 batch.
- **Doğrulama:** `npx tsc --noEmit` → **TSC_OK**.

### 2026-06-11 — BL-3 ✅ kursun-qc.finishStep atomik kapatma
- **Dosya:** `kursun-qc.service.ts` tx bloğu (~620).
- **Değişiklik:** `movementIds`-bazlı guard'sız `$executeRaw` close → `$queryRaw ... WHERE "workOrderStepId"=… AND "exitedAt" IS NULL ... RETURNING "rollId","qtyIn","weightIn"`. `closed.length===0 → moved:0 bail` (sonraki adım movement açılmaz). createMany + roll.updateMany yalnız `closedRollIds`. Eşzamanlı/çift finishStep'te her satır tek tx'e düşer.
- **KALAN follow-up:** ✅ `production.handleStepFinish` de düzeltildi (aşağıda).
- **Doğrulama:** `npx tsc --noEmit` → **TSC_OK**.

### 2026-06-11 — BL-3 sibling ✅ production.handleStepFinish atomik FINISH
- **Dosya:** `production.service.ts:handleStepFinish` (~401).
- **Değişiklik:** Açık movement kapatma `updateMany` count'u yakalandı (`closed.count===0 → finished=false`); count 0 ise `openMovementForNextStep` ÇAĞRILMAZ ve fonksiyon idempotent "zaten tamamlanmış" cevabı döner. `isRollActiveInStep` tx dışı okunduğundan iki eşzamanlı FINISH'in topu çift ilerletmesini engeller.
- **Doğrulama:** `npx tsc --noEmit` → **TSC_OK**.

### 2026-06-11 — PERF-4 ⏭️ Ertelendi (frontend koordinasyonu)
- `PaginatedResponse.total` zorunlu + offset çağıranlar okuyor → backend-only güvenli düzeltilemez. Count zaten findMany'ye paralel (latency'ye eklenmiyor). Gerçek çözüm: kalan offset çağıranları cursor mode'a taşı. Detay: PERF-4 bölümü.

### 2026-06-11 — PERF-6 ✅ device lastSeenAt throttle
- **Dosya:** `device.service.ts:resolveDevice`.
- **Değişiklik:** Koşulsuz fire-and-forget `lastSeenAt` UPDATE → `lastSeenWrites` Map + 60sn throttle (cihaz başına). Yazma amplifikasyonunu ~60x düşürür.
- **Doğrulama:** `npx tsc --noEmit` → **TSC_OK**.

### 2026-06-11 — PERF-5 ✅ getFeatureFlags tek sorgu
- **Dosya:** `system-setting.service.ts` — `getFeatureFlags` (~316) + 4 reader signature (603/615/629/642).
- **Değişiklik:** 15 ardışık `findUnique` → 1 `findMany` + in-memory `cacheClient` enjeksiyonu (reader'lar `tx?` param'ı üzerinden map'ten okur). Tüm 15 reader tek-`findUnique` olduğundan güvenli (kontrol edildi).
- **Doğrulama:** `npx tsc --noEmit` → **TSC_OK**.

### 2026-06-11 — SEC-4 ✅ + SEC-5 ✅ Validation cila
- **SEC-4:** `user-preference.controller.ts` — `preferencesSchema`'ya 64KB `.refine` boyut sınırı.
- **SEC-5:** `inventory.controller.ts` / `workorder.controller.ts` (create+update) / `shipping.controller.ts` / `order.service.ts:validateLines` — sayısal alanlara `.max(999_999_999)` (Decimal(12,3) tavanı) → DB P2020 yerine alan-düzeyinde net hata.
- **Doğrulama:** `npx tsc --noEmit` → **TSC_OK**.

### 2026-06-11 — PERF-3 ✅ Sevk iptali tek UPDATE
- **Dosya:** `subcontractor.service.ts` cancelDispatch (~793).
- **Değişiklik:** `findMany` + per-row `update` döngüsü → tek `$executeRaw` UPDATE (`CASE` ile notes concat, `exitedAt IS NULL` guard). 200-roll iptali: 200+1 sorgu → 1.
- **Doğrulama:** `npx tsc --noEmit` → **TSC_OK**.

### 2026-06-11 — ARCH-1 ✅ User CRUD servise taşındı
- **Dosyalar:** `permission-management.service.ts` (+`createUser`/`updateUser`/`deactivateUser` + `USER_SELECT`), `routes/admin.routes.ts` (3 handler delege + `userSelect`/`AuthService` import temizliği).
- **Değişiklik:** Route handler içindeki conflict-check + bcrypt hash + create/update + audit mantığı servise taşındı; route yalnız Zod + servis çağrısı. Davranış birebir aynı (bcrypt cost 10 = AuthService.hashPassword). Self-deactivation guard route'ta kaldı (HTTP concern).
- **Doğrulama:** `npx tsc --noEmit` → **TSC_OK**.

### 2026-06-11 — Ertelenenler (planlı, ayrı oturum)
- **PERF-4** ⏭️ frontend koordinasyonu (offset count opt-in).
- **DB-1** ⏭️ büyük `@db.Uuid` migration (vardiya dışı).
- **ARCH-2** ⏭️ workorder create/replace helper extraction (önce test).
- **ARCH-3** ⏭️ BaseService `req`→`ListQuery` (geniş contract).
- **DB-2** ⬜ izle (bloat ölç, kod değişikliği yok).
- **BL-3 alt-iş** ⏭️ `production.handleStepFinish` aynı atomik-kapatma deseni.
- **ARCH-1 kalan** ⬜ dashboard `$queryRaw` → DashboardService.

---

### 2026-06-11 — BUG-1 ✅ Fason picker IN_PRODUCTION düzeltmesi (doğrulama sırasında bulundu)
- **Dosya:** `inventory.service.ts:buildRollWhere` (`dispatchableForStepId` OR, ~537).
- **Risk:** Picker'ın at-step OR dalı yalnız `status: STOCK` kabul ediyordu; dispatch() ise at-step `STOCK|IN_PRODUCTION` kabul ediyor (guard:480). Sonuç: bu fason adımında fiilen ÜRETİMDEKİ (IN_PRODUCTION) toplar "Top Seç" picker'ında görünmüyordu → operatör sevk edemiyordu (picker dispatch'ten daha katıydı, kod yorumu da IN_PRODUCTION diyordu).
- **Değişiklik:** at-step dalı `status: { in: [STOCK, IN_PRODUCTION] }` → dispatch kuralının birebir aynısı.
- **Doğrulama:** `test_fason_dispatch_picker.ts` 10/1 → **11/0**; tsc temiz. (`inventory.service` artık değişti — eski "UNCHANGED" notu güncellendi.)

### 2026-06-11 — ARCH-1 (dashboard) ✅ DashboardService
- **Dosya:** yeni `services/dashboard.service.ts` (`getDefectsSummary`/`getStationsLiveState`); `routes/dashboard.routes.ts` ince route'a indirildi (prisma import kaldırıldı).

### 2026-06-11 — DB-1 ✅ native @db.Uuid (208 kolon) + ham SQL ripple
- **Şema:** `scratch/add-uuid-native.mjs` ile 208 PK/FK kolonuna `@db.Uuid`. Migration `20260611084953_native_uuid_pk_fk`. recordId/batchSplitId/code/key atlandı.
- **Ham SQL:** 6 sorguda `::text[]`→`::uuid[]` + `${param}::uuid` + `IN(Prisma.join)`→`= ANY(::uuid[])` (subcontractor×2, kursun-qc×2, workorder×2). reports temiz.
- **Doğrulama:** truncate→migrate→seed; tsc+lint temiz; `rolls.id`=uuid, `recordId`=text teyit; FK insert sanity OK.

### 2026-06-11 — Test fixture sertleştirme (re-seed sonrası)
- **Sorun:** 5 test seed uuid'lerini HARDCODE ediyordu (`ITEM="9d49919d…"`); re-seed yeni uuid üretince FK violation. Pre-existing fragility, DB-1 re-seed'i tetikledi.
- **Fix:** `test_consecutive_fason`, `test_wo_branch_redye`, `test_wo_branch_split`, `test_fason_parti_grouping` → `resolveFixtures()` ile business key'den (code/username) runtime çözüm. `test_order_filter_batch_check` Part B → kendi 2 ürün+2 renk+1 müşteriyi yaratıp siler (seed kompozisyonundan bağımsız).

### 2026-06-11 — ARCH-2 (kısmi) 🔶 SEC-3 guard helper
- **Dosya:** `workorder.service.ts` — yeni module-helper `assertRouteRefsActive(steps)`; create (~332) + replace (~2758) duplike guard blokları tek çağrıya indirildi (~70 satır → 2 çağrı).
- **Doğrulama:** tsc temiz; split 26/0, redye 20/0, fason 18/0 (create+replace yolları). Geniş create/replace dedup ⏭️ deferred.

## DOĞRULAMA ÖZETİ (2026-06-11)

**Statik:**
- `npx tsc --noEmit` → **TSC_OK** (her düzeltme sonrası tekrarlandı, hepsi temiz).
- `npm run lint` (eslint src) → **temiz** (0 hata; `tx.* + Promise.all` yasağı dahil).

**Canlı DB testleri (`adnansahin_db`):**
| Test | Kapsadığı düzeltme | Sonuç |
|---|---|---|
| `test_consecutive_fason.ts` | BL-1 (atomik claim), BL-2 (retry), PERF-1 (born-roll createMany) | ✅ 18/0 |
| `test_wo_branch_redye.ts` | PERF-2 (redye createMany) | ✅ 20/0 |
| `test_wo_branch_split.ts` | SEC-3 (replace guard), born-roll createMany | ✅ 26/0 |
| `test_qc2_idempotency.ts` | kursun-qc (@@unique idempotency) | ✅ geçti |
| `test_order_filter_batch_check.ts` | order servisi | ✅ 12/0 |
| `test_fason_parti_grouping.ts` | fason gruplama | ✅ 26/0 |
| `test_fason_dispatch_picker.ts` | BUG-1 (picker IN_PRODUCTION) | ✅ 11/0 (fix sonrası) |

**TÜM testler native-uuid şeması altında geçiyor** (yukarıdaki tablo DB-1 sonrası son koşumdur).
`test_fason_dispatch_picker` (b2) artık BUG-1 ile 11/0; `order_filter`/`parti_grouping` fixture sertleştirmesiyle 12/0 & 26/0.

**Değişen dosyalar:** **Servisler:** subcontractor, kursun-qc, order, workorder, production, device,
system-setting, kartela, permission-management, inventory, +yeni dashboard.service. **Controller:**
inventory, shipping, workorder, user-preference. **Route:** admin.routes, dashboard.routes. **Şema:**
schema.prisma (208 kolon `@db.Uuid`) + migration `20260611084953_native_uuid_pk_fk`. **Test fixture:**
5 script (resolveFixtures / self-sufficient Part B). Henüz commit edilmedi (çalışma ağacı, inceleme hazır).

**Kalan deferred:** ARCH-2 (workorder create/replace dedup — test kapsamı artık var, yapılabilir),
ARCH-3 (BaseService req→ListQuery — geniş/düşük değer), PERF-4 (offset count — frontend koordinasyonu),
DB-2 (izle).
